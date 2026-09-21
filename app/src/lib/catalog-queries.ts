import type { PoolClient } from "pg";

import { sequential, withOperator } from "./db";
import { COURSE_GATING, ENVIRONMENT } from "./env";
import { scoped, type Db } from "./student-context";
import {
  SUBJECTS,
  SUBJECT_IDS,
  type Subject,
  type SpineSubject,
  type TextDirection,
} from "./subjects";
import {
  GRADES,
  canonicalGrade,
  gradeDisplayLabel,
  isCourseVisible,
  visibleCourseIds,
  type AvailabilityRule,
  type CourseState,
  type StudentOverride,
} from "./catalog";

/**
 * Course availability — the DATABASE SEAM (migration 023, `lib/catalog.ts`).
 *
 * ⚠ NO REQUIREMENT COVERS THIS YET. No FR has been invented for it and
 * `traceability.md` was not touched; see the header of `lib/catalog.ts`.
 *
 * ---------------------------------------------------------------------------
 * THE SPLIT, AND WHY IT IS WORTH TWO FILES
 * ---------------------------------------------------------------------------
 * Every decision in this file was already made in `lib/catalog.ts`. What is
 * here is only which rows to fetch, under which role, and how to shape them —
 * so the rule that decides what a child can reach stays provable without a
 * database, and a change to this file cannot quietly change the rule.
 *
 * ---------------------------------------------------------------------------
 * TWO ROLES, AND THEY ARE NOT INTERCHANGEABLE
 * ---------------------------------------------------------------------------
 * `visibleCoursesFor` is the STUDENT side: it runs through `scoped`, on
 * `ainext_app`, under the caller's own unit of work when it has one. Its read
 * of `student_course_access` is policed by migration 023's RLS policy, so a
 * bug that passed the wrong student id returns that student's *own* overrides
 * and not another's — the database refuses, not the WHERE clause.
 *
 * The four console functions run through `withOperator` — `ainext_operator`,
 * whose cross-student visibility comes from grants rather than from a bypass.
 * The same SQL on the application connection returns nothing at all.
 *
 * `environment` is filtered before anything is grouped or decided
 * (constitution XI): the comparison build and the frozen baseline must be able
 * to disagree about which courses are on, and a rule read across both would
 * make one of them wrong in silence.
 *
 * One client means ONE QUERY AT A TIME (`lib/db.ts` `sequential`, pg@9). Every
 * multi-read below goes through it rather than `Promise.all`.
 */

/* ------------------------------------------------------------------ */
/* Student side — the gate's only database call                        */
/* ------------------------------------------------------------------ */

/**
 * The course ids this student may see. A `Set`, because every caller uses it
 * as a membership test and nothing should read an order out of it.
 *
 * Three small reads rather than one join: the student's grade, the grade rules
 * for this environment, and this student's own overrides have three unrelated
 * cardinalities, and joining them produces a cross product that has to be
 * de-duplicated in JavaScript anyway. Three indexed reads on an open client
 * are cheaper than that, and each one is legible on its own.
 *
 * **A missing student is an empty set**, not an error and not everything. The
 * one caller that can legitimately have no student — `scripts/capture-prompts`
 * — never reaches this function (see `courseGateFor` in `lib/lesson.ts`).
 *
 * **The kill switch is honoured HERE**, at the one place every student-side
 * gate asks its question, rather than at each of the five call sites. With
 * `AINEXT_COURSE_GATING` unset or `off` this answers "every course there is"
 * and every caller behaves exactly as it did before migration 023 — no branch
 * at the call site, nothing to forget, and nothing that can be half-disabled.
 */
export async function visibleCoursesFor(
  studentId: number,
  c?: PoolClient
): Promise<Set<string>> {
  return scoped(studentId, c, async (db) => {
    if (!COURSE_GATING) return allCourseIds(db);
    const { grade, rules, overrides } = await availabilityFor(db, studentId);
    return new Set(visibleCourseIds(grade, rules, overrides));
  });
}

/**
 * Every course that exists, from both places one can: the subject registry
 * (which knows courses the spine has never held) and `graph_nodes` (which
 * knows courses loaded before a registry entry caught up). Their union is what
 * "ungated" means, and it is a real set rather than a `has()` that always says
 * yes — a caller reading it as a list gets the truth either way.
 */
async function allCourseIds(db: Db): Promise<Set<string>> {
  const res = await db.query(
    `SELECT id FROM graph_nodes WHERE kind = 'course'`
  );
  return new Set([
    ...SUBJECT_IDS.map((id) => SUBJECTS[id].courseId),
    ...res.rows.map((r) => String(r.id)),
  ]);
}

/**
 * The same gate, expressed over GRAPH ids instead of course ids — for the
 * surfaces that read the spine directly and never see a `course_id` column.
 *
 * `/spine`, the practice plan and "Ask the Spine" all select every objective
 * and every live question in the database and reason over the graph. They are
 * the quietest way a hidden course could reach a student: no lesson to open
 * and no URL to guess, just a subject that is switched off appearing among the
 * objectives — and, on two of those three surfaces, its questions complete
 * with correct answers and canonical solutions.
 *
 * ONE walk of the graph and ONE read of the rules, turned into two predicates.
 * Not a query per row, for the obvious reason (ninety objectives is ninety
 * round trips) and a less obvious one: a check that can fail per row can also
 * PARTLY fail, and a page gated for eighty-nine objectives and not the
 * ninetieth is worse than one that is not gated at all, because it looks right.
 *
 * An objective or module that resolves to no course is refused, like an
 * unknown course id: explicit allow has one answer for anything it cannot
 * check. `studentId === null` is the prompt-capture harness — nobody to
 * refuse, so nothing is refused (see `courseGateFor` in `lib/lesson.ts`).
 */
export async function visibleGraphFor(
  db: Db,
  studentId: number | null
): Promise<{ lo: (id: string) => boolean; module: (id: string) => boolean }> {
  if (studentId == null) return { lo: () => true, module: () => true };

  const visible = await visibleCoursesFor(studentId, asClient(db));

  // LO ← module (`teaches`) → course (`part_of`), in one pass. LEFT joins so a
  // detached objective still produces a row, with a null course.
  const walk = await db.query(
    `SELECT lo.id AS lo_id, m.id AS module_id, c.id AS course_id
       FROM graph_nodes lo
       LEFT JOIN graph_edges e
         ON e.dst_id = lo.id AND e.edge_type = 'teaches' AND e.system_to IS NULL
       LEFT JOIN graph_nodes m ON m.id = e.src_id AND m.kind = 'module'
       LEFT JOIN graph_edges ec
         ON ec.src_id = m.id AND ec.edge_type = 'part_of' AND ec.system_to IS NULL
       LEFT JOIN graph_nodes c ON c.id = ec.dst_id AND c.kind = 'course'
      WHERE lo.kind = 'learning_objective'`
  );

  const los = new Set<string>();
  const modules = new Set<string>();
  for (const r of walk.rows) {
    if (r.course_id == null || !visible.has(r.course_id)) continue;
    los.add(String(r.lo_id));
    if (r.module_id != null) modules.add(String(r.module_id));
  }
  return { lo: (id) => los.has(id), module: (id) => modules.has(id) };
}

/**
 * A `PoolClient` to reuse, or `undefined` for "open your own unit of work".
 *
 * Handing a bare `Pool` to `visibleCoursesFor` would read
 * `student_course_access` with NO principal set, and migration 023's policy
 * answers that with zero rows — a silently WRONG answer (every override lost)
 * rather than an error. So a pool is reported as "no client" and the gate
 * opens its own principalled transaction instead.
 */
function asClient(db: Db): PoolClient | undefined {
  return "release" in db ? (db as PoolClient) : undefined;
}

/**
 * The three inputs the rule needs, fetched once. Shared by the student gate
 * and by the console's per-student view so the two can never disagree about
 * what the database says — only about who is allowed to ask.
 */
async function availabilityFor(
  db: Db,
  studentId: number
): Promise<{
  grade: string | null;
  rules: AvailabilityRule[];
  overrides: StudentOverride[];
}> {
  const [studentRes, ruleRes, overrideRes] = await sequential([
    () =>
      db.query(`SELECT grade FROM students WHERE id = $1`, [studentId]),
    () =>
      db.query(
        `SELECT course_id, grade, state FROM course_availability
          WHERE environment = $1`,
        [ENVIRONMENT]
      ),
    () =>
      db.query(
        `SELECT course_id, state FROM student_course_access
          WHERE environment = $1 AND student_id = $2`,
        [ENVIRONMENT, studentId]
      ),
  ] as const);

  return {
    // `canonicalGrade` folds the legacy `prep-3` spelling onto `9`; without it
    // every migrated row matches no rule and the student sees an empty product.
    grade: canonicalGrade(studentRes.rows[0]?.grade as string | undefined),
    rules: ruleRes.rows.map(asRule),
    overrides: overrideRes.rows.map((r) => ({
      courseId: String(r.course_id),
      state: asState(r.state),
    })),
  };
}

/**
 * A stored state, or `hidden` for anything else.
 *
 * The CHECK constraint in migration 023 already refuses a third value, so this
 * is the belt to that braces — and it fails in the direction that costs a
 * student a lesson rather than the one that shows a child a course nobody
 * approved.
 */
function asState(raw: unknown): CourseState {
  return raw === "live" ? "live" : "hidden";
}

function asRule(r: Record<string, unknown>): AvailabilityRule {
  return {
    courseId: String(r.course_id),
    grade: String(r.grade),
    state: asState(r.state),
  };
}

/* ------------------------------------------------------------------ */
/* Console — the catalogue Samuel actually manages                     */
/* ------------------------------------------------------------------ */

/**
 * One (course, grade) cell of the console's availability grid.
 *
 * The registry fields ride along because the console lists courses from
 * `lib/subjects.ts`, NOT from what the spine happens to hold: all three
 * subjects appear whether or not a book has been extracted for them, so the
 * product can be seen as it will be sold. `objectivesLoaded` is what keeps
 * that honest — a subject with nothing behind it renders "0 objectives
 * loaded" rather than looking as ready as maths.
 */
export type CourseCatalogRow = {
  courseId: string;
  /** registry id — the prompt-contract key (`math-en`) */
  subject: Subject;
  /** spine/DB key (`math`) — what `graph_nodes.subject` holds */
  spineKey: SpineSubject;
  label: string;
  labelAr: string;
  dir: TextDirection;
  book: string;
  grade: string;
  gradeLabel: string;
  state: CourseState;
  /**
   * `true` when a row exists for this (course, grade); `false` when `hidden`
   * is the DEFAULT rather than a decision. The console must be able to show
   * the difference: "nobody has decided" and "somebody decided no" are the
   * same state and very different facts.
   */
  explicit: boolean;
  note: string | null;
  /** LOs under this course in the spine — 0 for a registry-only subject. */
  objectivesLoaded: number;
  /** `status = 'live'` questions under those LOs. Nothing else is servable. */
  questionsLoaded: number;
  updatedBy: string | null;
  updatedAt: string | null;
};

/**
 * Every registry course × every grade, with its rule and its content depth.
 *
 * Eighteen rows today (three subjects, six grades) and the product of two lists
 * that grow slowly, so the grid is built in memory rather than by a SQL cross
 * join against a table of grades that does not exist.
 *
 * Content depth is per COURSE and repeated on that course's six grade rows:
 * the spine has no notion of a grade, and pretending otherwise would put a
 * number on the screen that no query behind it could produce.
 *
 * `requires_plan` is deliberately NOT selected. It is a column reserved for a
 * subscription decision nobody has taken; reading it here is how it acquires a
 * first reader and then a second (FR-2404 — commercial status gates nothing in
 * this release).
 */
export async function courseCatalog(
  operatorId: number
): Promise<CourseCatalogRow[]> {
  const { rules, depth } = await withOperator(operatorId, async (db) => {
    const [ruleRes, depthRes] = await sequential([
      () =>
        db.query(
          `SELECT ca.course_id, ca.grade, ca.state, ca.note, ca.updated_at,
                  op.display_name AS updated_by
             FROM course_availability ca
             LEFT JOIN operators op ON op.id = ca.updated_by
            WHERE ca.environment = $1`,
          [ENVIRONMENT]
        ),
      // course → module (`part_of`) → LO (`teaches`) → questions, the same
      // walk `lib/lesson.ts` does, LEFT-joined the whole way so a course with
      // no modules is a row of zeros instead of a missing row. Only `live`
      // questions are counted: a question in `review` is a decision not yet
      // taken and cannot be served to anybody (constitution III).
      () =>
        db.query(
          `SELECT c.id AS course_id,
                  count(DISTINCT lo.id) AS objectives,
                  count(DISTINCT q.id) FILTER (WHERE q.status = 'live') AS questions
             FROM graph_nodes c
             LEFT JOIN graph_edges ec
               ON ec.dst_id = c.id AND ec.edge_type = 'part_of' AND ec.system_to IS NULL
             LEFT JOIN graph_nodes m ON m.id = ec.src_id AND m.kind = 'module'
             LEFT JOIN graph_edges et
               ON et.src_id = m.id AND et.edge_type = 'teaches' AND et.system_to IS NULL
             LEFT JOIN graph_nodes lo ON lo.id = et.dst_id AND lo.kind = 'learning_objective'
             LEFT JOIN questions q ON q.lo_id = lo.id
            WHERE c.kind = 'course'
            GROUP BY c.id`
        ),
    ] as const);
    return { rules: ruleRes.rows, depth: depthRes.rows };
  });

  const byCell = new Map(
    rules.map((r) => [`${r.course_id} ${r.grade}`, r])
  );
  const byCourse = new Map(depth.map((d) => [String(d.course_id), d]));

  const out: CourseCatalogRow[] = [];
  // Registry order, so the console's grid reads in the same sequence as the
  // graph territories and the student home (`lib/subjects.ts` §SUBJECT_IDS).
  for (const subject of SUBJECT_IDS) {
    const def = SUBJECTS[subject];
    const d = byCourse.get(def.courseId);
    for (const g of GRADES) {
      const row = byCell.get(`${def.courseId} ${g.value}`);
      out.push({
        courseId: def.courseId,
        subject,
        spineKey: def.key,
        label: def.label,
        labelAr: def.labelAr,
        dir: def.dir,
        book: def.book,
        grade: g.value,
        gradeLabel: g.label,
        state: row ? asState(row.state) : "hidden",
        explicit: row != null,
        note: (row?.note as string | null) ?? null,
        objectivesLoaded: Number(d?.objectives ?? 0),
        questionsLoaded: Number(d?.questions ?? 0),
        updatedBy: (row?.updated_by as string | null) ?? null,
        updatedAt: row?.updated_at
          ? new Date(row.updated_at as string).toISOString()
          : null,
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Console writes                                                      */
/* ------------------------------------------------------------------ */

/**
 * Set (or change) the rule for one (course, grade).
 *
 * `updated_by` and `updated_at` are written in the SAME statement as the
 * state, so "a rule with no author" is not a state this function can produce —
 * the argument FR-2405 already makes about commercial status, applied to a
 * gate on what children can see, where it matters more.
 *
 * `ON CONFLICT … DO UPDATE` rather than a read-then-write: two operators on the
 * grid at once is not exotic, and a lost update on an allow-list is a course
 * that is on when somebody believes they turned it off.
 *
 * `requires_plan` is never written and stays NULL.
 */
export async function setGradeRule(
  operatorId: number,
  courseId: string,
  grade: string,
  state: CourseState,
  note: string | null
): Promise<void> {
  await withOperator(operatorId, (db) =>
    db.query(
      `INSERT INTO course_availability
         (environment, course_id, grade, state, note, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (environment, course_id, grade) DO UPDATE
          SET state      = EXCLUDED.state,
              note       = EXCLUDED.note,
              updated_by = EXCLUDED.updated_by,
              updated_at = now()`,
      [ENVIRONMENT, courseId, grade, state, note, operatorId]
    )
  );
}

/**
 * Set, change or CLEAR one student's exception.
 *
 * `state === null` DELETES the row, and that is the only way to clear one. The
 * alternative — a third state meaning "defer to the grade rule" — would put
 * two spellings of the same fact in the table, and `lib/catalog.ts` would have
 * to carry a branch for a value that means "ignore me". A missing row already
 * means exactly that.
 *
 * A DELETE is safe here in a way it is not on an audit table: this row is a
 * live permission, not a record of anything that happened. What was done to it,
 * and by whom, belongs in `operator_reads`-shaped history if it is ever wanted
 * — not in a tombstone the gate would then have to learn to skip.
 */
export async function setStudentOverride(
  operatorId: number,
  studentId: number,
  courseId: string,
  state: CourseState | null,
  note: string | null
): Promise<void> {
  await withOperator(operatorId, async (db) => {
    if (state === null) {
      await db.query(
        `DELETE FROM student_course_access
          WHERE environment = $1 AND student_id = $2 AND course_id = $3`,
        [ENVIRONMENT, studentId, courseId]
      );
      return;
    }
    await db.query(
      `INSERT INTO student_course_access
         (environment, student_id, course_id, state, note, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (environment, student_id, course_id) DO UPDATE
          SET state      = EXCLUDED.state,
              note       = EXCLUDED.note,
              updated_by = EXCLUDED.updated_by,
              updated_at = now()`,
      [ENVIRONMENT, studentId, courseId, state, note, operatorId]
    );
  });
}

/* ------------------------------------------------------------------ */
/* Console — one student's effective access, rule by rule              */
/* ------------------------------------------------------------------ */

/**
 * What THIS student can actually see, and why — for the Student 360.
 *
 * Three states per course rather than one, because the useful question on that
 * page is never "can she see Arabic" alone; it is "can she see Arabic, and is
 * that because of her grade or because somebody made an exception for her".
 * Collapsing them would leave an operator unable to tell an exception they
 * created from a grade rule that happens to agree with it.
 *
 * **No `operator_reads` row is written here.** This is not a second read of a
 * student: the 360 page has already recorded one for this student through
 * `getStudent360`'s `onRead`, in the same page render. A function called from
 * anywhere else must record its own, and that is the moment to give this one an
 * `onRead` parameter of its own rather than to leave the read unlogged.
 */
export type StudentAccessRow = {
  courseId: string;
  subject: Subject;
  label: string;
  labelAr: string;
  dir: TextDirection;
  /** the student's own grade, folded onto the canonical spelling */
  grade: string | null;
  gradeLabel: string;
  /** what the grade rule says on its own — `hidden` when there is no rule */
  gradeState: CourseState;
  /** `false` when `gradeState` is the default rather than a decision */
  gradeExplicit: boolean;
  /** the exception, or `null` when this student has none */
  override: CourseState | null;
  overrideNote: string | null;
  overrideBy: string | null;
  overrideAt: string | null;
  /** what the student actually gets — `lib/catalog.ts`, not a second rule */
  effectiveState: CourseState;
};

export async function studentAccess(
  operatorId: number,
  studentId: number
): Promise<StudentAccessRow[]> {
  const { grade, rules, overrides, overrideRows } = await withOperator(
    operatorId,
    async (db) => {
      const base = await availabilityFor(db, studentId);
      const detail = await db.query(
        `SELECT sca.course_id, sca.state, sca.note, sca.updated_at,
                op.display_name AS updated_by
           FROM student_course_access sca
           LEFT JOIN operators op ON op.id = sca.updated_by
          WHERE sca.environment = $1 AND sca.student_id = $2`,
        [ENVIRONMENT, studentId]
      );
      return { ...base, overrideRows: detail.rows };
    }
  );

  const byCourse = new Map(overrideRows.map((r) => [String(r.course_id), r]));

  return SUBJECT_IDS.map((subject) => {
    const def = SUBJECTS[subject];
    const rule = rules.find(
      (r) => r.courseId === def.courseId && canonicalGrade(r.grade) === grade
    );
    const o = byCourse.get(def.courseId);
    return {
      courseId: def.courseId,
      subject,
      label: def.label,
      labelAr: def.labelAr,
      dir: def.dir,
      grade,
      gradeLabel: gradeDisplayLabel(grade),
      gradeState: rule?.state ?? "hidden",
      gradeExplicit: rule != null,
      override: o ? asState(o.state) : null,
      overrideNote: (o?.note as string | null) ?? null,
      overrideBy: (o?.updated_by as string | null) ?? null,
      overrideAt: o?.updated_at
        ? new Date(o.updated_at as string).toISOString()
        : null,
      // Computed by the SAME function the student gate runs, so the console
      // cannot show an answer the product does not give.
      effectiveState: isCourseVisible(def.courseId, grade, rules, overrides)
        ? "live"
        : "hidden",
    };
  });
}
