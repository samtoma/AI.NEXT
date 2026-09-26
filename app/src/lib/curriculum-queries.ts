import type { PoolClient } from "pg";

import { pool, sequential, withOperator, withPrincipal } from "./db";
import { COURSE_GATING, ENVIRONMENT } from "./env";
import { asCurriculumId, curriculumLabel, type CurriculumId } from "./curricula";
import {
  GRADES,
  canonicalGrade,
  offeredCurricula,
  resolveInitialCurriculum,
  type AvailabilityRule,
  type CurriculumSource,
} from "./catalog";
import { isValidGrade } from "./profile";

/**
 * A student's CURRICULUM — what a grade offers, who may change it, and the
 * record of every change (feature 003; migration 033;
 * `specs/003-curriculum-tracks/data-model.md` §2).
 *
 * The server half of screens later work builds: sign-up's curriculum question
 * and the one-screen step after a first Google sign-in (FR-4005, FR-4014), the
 * console's per-grade "offered" line (FR-4102), and the Student 360
 * curriculum editor with its history (FR-4105, FR-4010…FR-4012). None of those
 * screens exists yet; these functions are what they call.
 *
 * THE RULES, and where each is enforced:
 *
 *   · A curriculum is validated against the registry (`lib/curricula.ts`),
 *     server-side, never by a CHECK (migration 033 says why).
 *   · What a grade offers is ONE rule (`offeredCurricula`, lib/catalog.ts),
 *     read from this environment's live rules, so sign-up, the Google step and
 *     the console can never disagree (FR-4004; decision 1).
 *   · After sign-up only an operator changes a curriculum (decision 4), under
 *     `student-data` (FR-2707), recorded with who, when, from and to
 *     (FR-4012). The DATABASE enforces "only an operator" (FR-4017): the
 *     student-facing role holds no UPDATE on the curriculum columns at all.
 *   · The first-Google-sign-in step works ONCE (FR-4014, privacy review F10),
 *     through `complete_student_onboarding()`, which refuses a second call
 *     loudly — at the point of writing, not at redirect time.
 *   · A change deletes nothing (FR-4011): mastery and attempts are per
 *     objective and the progress pointer is per course, so the other
 *     curriculum's history stays where it is and switching back restores it.
 *   · The curriculum is first-party data only (FR-4016). Nothing here emits an
 *     event; `ga-curriculum-guard.test.mts` fails if `curriculum` ever joins
 *     the GA4 allow-lists.
 */

type Queryable = Pick<PoolClient, "query">;

/* ------------------------------------------------------------------ */
/* What a grade offers                                                 */
/* ------------------------------------------------------------------ */

/**
 * The inputs `offeredCurricula` needs, from ONE read: this environment's
 * rules while the gate is on, or the courses the spine holds while it is off
 * (FR-4015). Both are catalogue facts, not student data: `course_availability`
 * has no RLS and `ainext_app` may SELECT it (023), which is what lets the
 * anonymous sign-up page ask.
 */
async function offerInputs(
  db: Queryable
): Promise<{ rules: AvailabilityRule[]; loaded: string[] }> {
  if (!COURSE_GATING) {
    const res = await db.query(`SELECT id FROM graph_nodes WHERE kind = 'course'`);
    return { rules: [], loaded: res.rows.map((r) => String(r.id)) };
  }
  const res = await db.query(
    `SELECT course_id, grade, state FROM course_availability WHERE environment = $1`,
    [ENVIRONMENT]
  );
  return {
    rules: res.rows.map((r) => ({
      courseId: String(r.course_id),
      grade: String(r.grade),
      state: r.state === "live" ? ("live" as const) : ("hidden" as const),
    })),
    loaded: [],
  };
}

/** The curricula a grade offers today (FR-4004), in registry order. */
export async function offeredCurriculaFor(
  grade: string | null | undefined,
  db: Queryable = pool
): Promise<CurriculumId[]> {
  const { rules, loaded } = await offerInputs(db);
  return offeredCurricula(grade, rules, loaded, COURSE_GATING);
}

/**
 * Every grade's offer from ONE read, for the two anonymous-or-student screens
 * that ask the question: sign-up and the first-Google-sign-in step (FR-4005,
 * FR-4014). Catalogue facts only — curriculum ids, no course content and no
 * student — so it runs on the application pool with no principal, as
 * `offeredCurriculaFor` does. Keyed by the stored grade value.
 */
export async function offeredCurriculaEveryGrade(
  db: Queryable = pool
): Promise<Record<string, CurriculumId[]>> {
  const { rules, loaded } = await offerInputs(db);
  return Object.fromEntries(
    GRADES.map((g) => [g.value, offeredCurricula(g.value, rules, loaded, COURSE_GATING)])
  );
}

/**
 * Every grade's offer, for the console's per-grade "offered" line (FR-4102),
 * from ONE read.
 */
export async function offeredCurriculaByGrade(
  operatorId: number
): Promise<{ grade: string; curricula: CurriculumId[] }[]> {
  const { rules, loaded } = await withOperator(operatorId, offerInputs);
  return GRADES.map((g) => ({
    grade: g.value,
    curricula: offeredCurricula(g.value, rules, loaded, COURSE_GATING),
  }));
}

/* ------------------------------------------------------------------ */
/* The record (Student 360, FR-4105)                                   */
/* ------------------------------------------------------------------ */

export type CurriculumChange = {
  id: number;
  fromCurriculum: string;
  toCurriculum: string;
  toSource: CurriculumSource;
  /** the operator's display name; `null` when the product re-resolved it */
  changedBy: string | null;
  reason: "operator" | "grade_change_reresolved";
  note: string | null;
  changedAt: string;
};

export type StudentCurriculum = {
  /** as stored — an unknown value is shown, flagged, never hidden (FR-4003) */
  stored: string;
  curriculum: CurriculumId | null;
  known: boolean;
  label: string;
  source: CurriculumSource;
  /** a Google-created account whose grade-and-curriculum step is still owed */
  onboardingPending: boolean;
  /** every change after sign-up, newest first (FR-4012) */
  history: CurriculumChange[];
};

/**
 * One student's curriculum, how it was set, and its history — for the
 * Student 360, a `student-data` page (FR-4105).
 *
 * **No `operator_reads` row is written here**, for the reason `studentAccess`
 * gives (lib/catalog-queries.ts): the 360 page has already recorded its read
 * of this student in the same render. A caller anywhere else must record its
 * own.
 */
export async function studentCurriculum(
  operatorId: number,
  studentId: number
): Promise<StudentCurriculum | null> {
  const { student, history } = await withOperator(operatorId, async (db) => {
    const [s, h] = await sequential([
      () =>
        db.query(
          `SELECT curriculum_system, curriculum_source, onboarding_pending
             FROM students WHERE id = $1 AND environment = $2`,
          [studentId, ENVIRONMENT]
        ),
      () =>
        db.query(
          `SELECT c.id, c.from_curriculum, c.to_curriculum, c.to_source, c.reason,
                  c.note, c.changed_at, op.display_name AS changed_by
             FROM student_curriculum_changes c
             LEFT JOIN operators op ON op.id = c.changed_by
            WHERE c.student_id = $1 AND c.environment = $2
            ORDER BY c.changed_at DESC, c.id DESC`,
          [studentId, ENVIRONMENT]
        ),
    ] as const);
    return { student: s.rows[0], history: h.rows };
  });
  if (!student) return null;
  const stored = String(student.curriculum_system);
  const curriculum = asCurriculumId(stored);
  return {
    stored,
    curriculum,
    known: curriculum !== null,
    label: curriculumLabel(stored),
    source: student.curriculum_source === "chosen" ? "chosen" : "implied",
    onboardingPending: student.onboarding_pending === true,
    history: history.map((r) => ({
      id: Number(r.id),
      fromCurriculum: String(r.from_curriculum),
      toCurriculum: String(r.to_curriculum),
      toSource: r.to_source === "chosen" ? "chosen" : "implied",
      changedBy: (r.changed_by as string | null) ?? null,
      reason: r.reason === "grade_change_reresolved" ? "grade_change_reresolved" : "operator",
      note: (r.note as string | null) ?? null,
      changedAt: new Date(r.changed_at as string).toISOString(),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* The console's change (decision 4: only the console, after sign-up)  */
/* ------------------------------------------------------------------ */

export type CurriculumChangeResult =
  | { ok: true; changed: boolean; from: string; to: CurriculumId }
  | { ok: false; reason: "unknown_curriculum" | "no_such_student" };

/**
 * An operator sets one student's curriculum (FR-4010…FR-4012; decision 4).
 * The route that calls this authorises `student-data` first (FR-2707): it
 * names a person.
 *
 * Validated against the registry, never trusted. ONE unit of work, the
 * student row locked first: the change is recorded — attributed to this
 * operator, which migration 033's policy insists on — and made, as `chosen`.
 * Setting the curriculum a student already has records nothing and changes
 * nothing (`changed: false`).
 *
 * No grade rule is consulted: an operator may put a student in a curriculum
 * her grade does not offer today, for example ahead of switching its course
 * on. She then sees what that curriculum offers her grade, which may be
 * nothing, and the console's access panel says why (`studentAccess`).
 */
export async function setStudentCurriculum(
  operatorId: number,
  studentId: number,
  curriculum: unknown,
  note: string | null
): Promise<CurriculumChangeResult> {
  const to = asCurriculumId(curriculum);
  if (!to) return { ok: false, reason: "unknown_curriculum" };
  return withOperator(operatorId, async (db) => {
    const cur = await db.query(
      `SELECT curriculum_system FROM students WHERE id = $1 AND environment = $2 FOR UPDATE`,
      [studentId, ENVIRONMENT]
    );
    if (cur.rowCount === 0) return { ok: false, reason: "no_such_student" } as const;
    const from = String(cur.rows[0].curriculum_system);
    if (from === to) return { ok: true, changed: false, from, to } as const;
    await db.query(
      `INSERT INTO student_curriculum_changes
         (environment, student_id, from_curriculum, to_curriculum, to_source,
          changed_by, reason, note)
       VALUES ($1, $2, $3, $4, 'chosen', $5, 'operator', $6)`,
      [ENVIRONMENT, studentId, from, to, operatorId, note]
    );
    await db.query(
      `UPDATE students SET curriculum_system = $2, curriculum_source = 'chosen' WHERE id = $1`,
      [studentId, to]
    );
    return { ok: true, changed: true, from, to } as const;
  });
}

/* ------------------------------------------------------------------ */
/* The first-Google-sign-in step — once, ever (FR-4014)                */
/* ------------------------------------------------------------------ */

export type OnboardingResult =
  | {
      ok: true;
      grade: string;
      curriculum: CurriculumId;
      source: CurriculumSource;
      /** a known curriculum sent but not offered, for `account_created` (F12) */
      resolvedFrom: CurriculumId | null;
    }
  | {
      ok: false;
      reason: "invalid_grade" | "invalid_curriculum" | "curriculum_required" | "already_completed";
      /** what the grade offers, so the step can ask again */
      offered?: readonly CurriculumId[];
    };

/** SQLSTATE raised by `complete_student_onboarding` on a second call (033). */
const ONBOARDING_ALREADY_COMPLETED = "AN409";

/**
 * The student's own grade and curriculum, set once — the one-screen step after
 * a FIRST Google sign-in (FR-4014, FR-2006; decision 5). Called with the
 * student's principal, resolved by the route from the session; no student id
 * of the client's is ever used.
 *
 * Validation happens here, as the sign-up route does it: the grade against
 * `lib/profile.ts`, the curriculum against the registry and against what that
 * grade offers at this moment (`resolveInitialCurriculum`, FR-4005, privacy
 * review F12). The write is `complete_student_onboarding()` (migration 033), a
 * definer function that acts only on the acting student and only while her
 * step is pending, and RAISES otherwise — so "once" is the database's promise,
 * and a second submission is `already_completed`, never a silent success.
 */
export async function completeOnboarding(
  studentId: number,
  input: { grade: unknown; curriculum?: unknown }
): Promise<OnboardingResult> {
  if (!isValidGrade(input.grade)) return { ok: false, reason: "invalid_grade" };
  const grade = canonicalGrade(String(input.grade)) as string;
  const offered = await offeredCurriculaFor(grade);
  const resolved = resolveInitialCurriculum(input.curriculum, offered);
  if (!resolved.ok) return { ok: false, reason: resolved.error, offered: resolved.offered };
  try {
    await withPrincipal(studentId, (db) =>
      db.query(`SELECT complete_student_onboarding($1, $2, $3)`, [
        grade,
        resolved.curriculum,
        resolved.source,
      ])
    );
  } catch (err) {
    if ((err as { code?: string }).code === ONBOARDING_ALREADY_COMPLETED) {
      return { ok: false, reason: "already_completed" };
    }
    throw err;
  }
  return {
    ok: true,
    grade,
    curriculum: resolved.curriculum,
    source: resolved.source,
    resolvedFrom: resolved.resolvedFrom,
  };
}
