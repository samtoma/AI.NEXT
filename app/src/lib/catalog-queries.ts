import type { PoolClient } from "pg";

import { sequential, withOperator } from "./db";
import { COURSE_GATING, ENVIRONMENT } from "./env";
import { scoped, type Db } from "./student-context";
import {
  SUBJECTS,
  coursesOfSpineKey,
  type Subject,
  type SpineSubject,
  type TextDirection,
} from "./subjects";
import { COURSES, COURSE_IDS, type CourseId } from "./courses";
import {
  CURRICULA,
  asCurriculumId,
  curriculumLabel,
  type CurriculumId,
} from "./curricula";
import {
  GRADES,
  canonicalGrade,
  courseForSubject,
  gradeDisplayLabel,
  isCourseVisible,
  visibleCourseIds,
  type AvailabilityRule,
  type CourseState,
  type StudentOverride,
  type SwitchedOff,
} from "./catalog";

/**
 * Course availability — the DATABASE SEAM (migration 023, `lib/catalog.ts`),
 * and THE STUDENT SCOPE (feature 003).
 *
 * Requirements: FR-2701…FR-2711 (002) and FR-4006/FR-4009 (003) — see the
 * header of `lib/catalog.ts`. (This note used to say no requirement covered
 * it; the course-gate FRs have existed since 2026-09-22.)
 *
 * ---------------------------------------------------------------------------
 * ONE STUDENT SCOPE PER REQUEST (003, decision 5 of the brief)
 * ---------------------------------------------------------------------------
 * `resolveStudentScope` answers, once, everything a student surface needs to
 * decide what she may be shown: her grade, her curriculum, the courses she may
 * see, and which course she means by `?subject=`. `resolveStudentGraphScope`
 * adds the same answer over graph ids (objectives, modules) and source books,
 * for the readers that walk the spine rather than a course. Every student page
 * and API reaches curriculum data through one of them — directly, or through
 * `visibleCoursesFor` / `visibleGraphFor`, which are now thin wrappers kept so
 * their existing callers read unchanged. `student-scope-guard.test.mts` fails
 * on a student surface that reads curriculum data without it.
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
/* Student side — the scope, and the gate's only database reads         */
/* ------------------------------------------------------------------ */

/**
 * What one student may be shown, decided once. `studentId === null` is the
 * prompt-capture harness (`scripts/capture-prompts.mts`), which has nobody to
 * refuse: its scope refuses nothing and `courses` is `null`, meaning
 * "ungated", never an empty set.
 */
export interface StudentScope {
  readonly studentId: number | null;
  /** her grade, folded onto the canonical spelling (`prep-3` → `9`) */
  readonly grade: string | null;
  /** her curriculum, validated against the registry; `null` = unknown */
  readonly curriculum: CurriculumId | null;
  /** `false` when the stored value is not one the registry knows (FR-4003) */
  readonly curriculumKnown: boolean;
  /** the value as stored, so an operator can see an unknown one */
  readonly storedCurriculum: string | null;
  /** every course she may see — `null` only for the ungated harness scope */
  readonly courses: ReadonlySet<string> | null;
  /** May she see this course? A course-less row is refused (FR-2704). */
  course(courseId: string | null | undefined): boolean;
  /**
   * Which course she means by `?subject=<spine key>` — `lib/catalog.ts`
   * `courseForSubject`, the only subject → course lookup outside the
   * registries. A known subject always yields a course id (a hidden one is
   * then refused like any hidden course); an unknown one yields `null`.
   */
  courseForSubject(spineKey: unknown): string | null;
}

/**
 * The one question a reader that is HANDED the scope asks of it: may she see
 * this course? A reader that takes a parameter of this type (or of
 * `StudentScope` / `StudentGraphScope`) is gated by its caller's scope and
 * cannot be called without one — `student-scope-guard.test.mts` accepts that,
 * function by function, as a reader that goes through the scope.
 */
export type CourseScope = Pick<StudentScope, "course" | "courses">;

/** The same scope over graph ids and source books (`resolveStudentGraphScope`). */
export interface StudentGraphScope extends StudentScope {
  /** a learning objective whose course she may see */
  lo(id: string): boolean;
  /** a module whose course she may see */
  module(id: string): boolean;
  /** a source book (by `source_documents.sha256`) behind a course she may see */
  doc(sha256: string | null | undefined): boolean;
  /**
   * The course of an objective she may see, or `null` — for an objective she
   * may not see, and always for the ungated harness scope, which has walked
   * nothing. It lets a reader keep two courses of one subject apart (FR-4009)
   * without a second walk of the graph.
   */
  courseOf(loId: string): string | null;
}

const UNGATED: StudentGraphScope = {
  studentId: null,
  grade: null,
  curriculum: null,
  curriculumKnown: false,
  storedCurriculum: null,
  courses: null,
  course: () => true,
  // No student, no curriculum: the registry's first course of the subject —
  // what `?subject=` meant before 003. Only the harness ever gets here.
  courseForSubject: (key) => courseForSubject(coursesOfSpineKey(key), () => true, null),
  lo: () => true,
  module: () => true,
  doc: () => true,
  courseOf: () => null,
};

/**
 * THE STUDENT SCOPE — her grade, her curriculum and the courses she may see,
 * from ONE read of the student, the rules for this environment and her own
 * exceptions. Every decision is `lib/catalog.ts`'s.
 *
 * **The kill switch is honoured HERE**, at the one place every student-side
 * gate asks its question, rather than at each call site. With
 * `AINEXT_COURSE_GATING` unset or `off` the grade rules are suspended and not
 * even read — but the student's curriculum still is, and still scopes, and
 * her exceptions still apply (FR-4015; decision A): she sees every LOADED
 * course of her own curriculum, plus any exception. No branch at the call
 * site, nothing to forget, and nothing that can be half-disabled.
 *
 * **A missing student is an empty scope**, not an error and not everything.
 *
 * `c`: the caller's unit of work when it has one. A bare `Pool` is treated as
 * "none" and a principalled unit is opened instead (`asClient`), because the
 * read of `student_course_access` with NO principal returns zero rows under
 * migration 023's policy — a silently WRONG answer, every exception lost.
 */
export async function resolveStudentScope(
  studentId: number | null,
  c?: Db
): Promise<StudentScope> {
  if (studentId == null) return UNGATED;
  return scoped(studentId, asClient(c), (db) => scopeOn(db, studentId));
}

async function scopeOn(db: Db, studentId: number): Promise<StudentScope> {
  const { grade, curriculum, rules, overrides, switchedOff } = await availabilityFor(
    db,
    studentId,
    COURSE_GATING
  );
  const courses: ReadonlySet<string> = new Set(
    visibleCourseIds({ grade, curriculum }, rules, overrides, switchedOff)
  );
  const course = (id: string | null | undefined) => id != null && courses.has(id);
  return {
    studentId,
    grade,
    curriculum: asCurriculumId(curriculum),
    curriculumKnown: asCurriculumId(curriculum) !== null,
    storedCurriculum: curriculum,
    courses,
    course,
    courseForSubject: (key) =>
      courseForSubject(coursesOfSpineKey(key), (id) => courses.has(id), curriculum),
  };
}

/**
 * The course ids this student may see. A `Set`, because every caller uses it
 * as a membership test and nothing should read an order out of it.
 *
 * A thin wrapper over `resolveStudentScope`, kept so the gate's five original
 * callers read as they did. A missing student is an empty set.
 */
export async function visibleCoursesFor(
  studentId: number,
  c?: PoolClient
): Promise<Set<string>> {
  const scope = await resolveStudentScope(studentId, c);
  return new Set(scope.courses ?? []);
}

/**
 * THE STUDENT SCOPE over GRAPH ids and source books — for the surfaces that
 * read the spine directly and never see a `course_id` column.
 *
 * `/spine`, the practice plan, "Ask the Spine", the progress page, the home
 * page and the figures API all select objectives, modules, questions, figures
 * or books across the whole database. They are the quietest way a hidden
 * course — or another curriculum's book — could reach a student: no lesson to
 * open and no URL to guess, just a subject that is switched off appearing
 * among the objectives, or a book's title in the tutor's context.
 *
 * ONE walk of the graph and ONE read of the course books, turned into three
 * predicates. Not a query per row, for the obvious reason (ninety objectives
 * is ninety round trips) and a less obvious one: a check that can fail per
 * row can also PARTLY fail, and a page gated for eighty-nine objectives and
 * not the ninetieth is worse than one that is not gated at all, because it
 * looks right.
 *
 * An objective or module that resolves to no course is refused, like an
 * unknown course id: explicit allow has one answer for anything it cannot
 * check. So is a book no visible course is built from. `studentId === null` is
 * the prompt-capture harness — nothing is refused (see `courseGateFor` in
 * `lib/lesson.ts`).
 */
export async function resolveStudentGraphScope(
  studentId: number | null,
  c?: Db
): Promise<StudentGraphScope> {
  if (studentId == null) return UNGATED;
  return scoped(studentId, asClient(c), async (db) => {
    const scope = await scopeOn(db, studentId);
    const visible = scope.courses ?? new Set<string>();

    // LO ← module (`teaches`) → course (`part_of`), in one pass. LEFT joins so
    // a detached objective still produces a row, with a null course.
    const [walk, books] = await sequential([
      () =>
        db.query(
          `SELECT lo.id AS lo_id, m.id AS module_id, c.id AS course_id
             FROM graph_nodes lo
             LEFT JOIN graph_edges e
               ON e.dst_id = lo.id AND e.edge_type = 'teaches' AND e.system_to IS NULL
             LEFT JOIN graph_nodes m ON m.id = e.src_id AND m.kind = 'module'
             LEFT JOIN graph_edges ec
               ON ec.src_id = m.id AND ec.edge_type = 'part_of' AND ec.system_to IS NULL
             LEFT JOIN graph_nodes c ON c.id = ec.dst_id AND c.kind = 'course'
            WHERE lo.kind = 'learning_objective'`
        ),
      // the book each course is built from (the loader stamps it on the node)
      () =>
        db.query(
          `SELECT id AS course_id, source_sha256 FROM graph_nodes WHERE kind = 'course'`
        ),
    ] as const);

    // objective → its course, for the visible ones only (the first open
    // `teaches` row wins, as everywhere else an objective is filed)
    const los = new Map<string, string>();
    const modules = new Set<string>();
    for (const r of walk.rows) {
      if (r.course_id == null || !visible.has(r.course_id)) continue;
      if (!los.has(String(r.lo_id))) los.set(String(r.lo_id), String(r.course_id));
      if (r.module_id != null) modules.add(String(r.module_id));
    }
    const docs = new Set<string>();
    for (const r of books.rows) {
      if (r.source_sha256 != null && visible.has(String(r.course_id))) {
        docs.add(String(r.source_sha256));
      }
    }
    return {
      ...scope,
      lo: (id) => los.has(id),
      module: (id) => modules.has(id),
      doc: (sha) => sha != null && docs.has(sha),
      courseOf: (id) => los.get(id) ?? null,
    };
  });
}

/**
 * The same gate over graph ids — `resolveStudentGraphScope`, under the name
 * its first three callers (`/spine`, the practice plan, the ask context) use.
 */
export async function visibleGraphFor(
  db: Db,
  studentId: number | null
): Promise<StudentGraphScope> {
  return resolveStudentGraphScope(studentId, db);
}

/**
 * A `PoolClient` to reuse, or `undefined` for "open your own unit of work".
 *
 * Handing a bare `Pool` to the scope would read `student_course_access` with
 * NO principal set, and migration 023's policy answers that with zero rows — a
 * silently WRONG answer (every override lost) rather than an error. So a pool
 * is reported as "no client" and the scope opens its own principalled
 * transaction instead.
 */
function asClient(db: Db | undefined): PoolClient | undefined {
  return db && "release" in db ? (db as PoolClient) : undefined;
}

/**
 * The inputs the rule needs, fetched once. Shared by the student scope and by
 * the console's per-student view so the two can never disagree about what the
 * database says — only about who is allowed to ask.
 *
 * `gatingOn === false` (the kill switch, FR-4015): the grade rules are
 * suspended, so they are not read; the loaded courses are read instead
 * (`switchedOff`). The student's curriculum and her exceptions are read
 * either way — neither switches off.
 */
async function availabilityFor(
  db: Db,
  studentId: number,
  gatingOn: boolean
): Promise<{
  grade: string | null;
  curriculum: string | null;
  rules: AvailabilityRule[];
  overrides: StudentOverride[];
  switchedOff: SwitchedOff | undefined;
}> {
  const [studentRes, ruleRes, overrideRes] = await sequential([
    () =>
      db.query(
        `SELECT grade, curriculum_system FROM students WHERE id = $1`,
        [studentId]
      ),
    // with the switch on, this environment's rules; with it off, the courses
    // the spine holds — the one read the kill switch always made
    () =>
      gatingOn
        ? db.query(
            `SELECT course_id, grade, state FROM course_availability
              WHERE environment = $1`,
            [ENVIRONMENT]
          )
        : db.query(`SELECT id FROM graph_nodes WHERE kind = 'course'`),
    () =>
      db.query(
        `SELECT course_id, state FROM student_course_access
          WHERE environment = $1 AND student_id = $2`,
        [ENVIRONMENT, studentId]
      ),
  ] as const);

  const row = studentRes.rows[0] as
    | { grade?: string | null; curriculum_system?: string | null }
    | undefined;
  return {
    // `canonicalGrade` folds the legacy `prep-3` spelling onto `9`; without it
    // every migrated row matches no rule and the student sees an empty product.
    grade: canonicalGrade(row?.grade ?? null),
    // As stored. The rule validates it; an unknown value matches no course.
    curriculum: row?.curriculum_system ?? null,
    rules: gatingOn ? ruleRes.rows.map(asRule) : [],
    overrides: overrideRes.rows.map((r) => ({
      courseId: String(r.course_id),
      state: asState(r.state),
    })),
    switchedOff: gatingOn
      ? undefined
      : { loaded: new Set(ruleRes.rows.map((r) => String(r.id))) },
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
  /** the course's own name (`lib/courses.ts`) — "Mathematics — Grade 10" */
  courseLabel: string;
  /** the one curriculum it belongs to (FR-4002, FR-4101) */
  curriculum: CurriculumId;
  /** that curriculum's name — "National", "American" */
  curriculumLabel: string;
  /** the grades the book is written for (information, not a gate) */
  courseGrades: readonly string[];
  /** registry id — the prompt-contract key (`math-en`) */
  subject: Subject;
  /** spine/DB key (`math`) — what `graph_nodes.subject` holds */
  spineKey: SpineSubject;
  label: string;
  labelAr: string;
  dir: TextDirection;
  book: string;
  grade: string;
  /** the grade in THIS course's curriculum's words (FR-4013) */
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
  /**
   * `course_availability.requires_plan` — **the subscription seam, shown and
   * enforced nowhere** (migration 023, ADR-0018).
   *
   * Always `null` in this build: nothing writes it and nothing outside this
   * console reads it. It is surfaced so an operator can SEE that the column
   * exists and is empty, rather than discovering it in a schema dump the day a
   * price is set — and `lib/plan-gate.test.mts` is what keeps "outside this
   * console" true, in the same shape `subscription-gate.test.mts` keeps
   * FR-2404 true for `subscription_status`. Reading a value in order to print
   * it is not gating on it; the moment a student surface reads this column,
   * that test fails.
   */
  requiresPlan: string | null;
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
 * `requires_plan` IS selected here, and only here (Samuel, 2026-09-22).
 *
 * It used to be deliberately unselected, on the argument that reading it is how
 * a column acquires a first reader and then a second. The argument was right
 * about the second reader and wrong about the first: an inert column nobody can
 * see is not safer than one an operator can see is empty — it is the same
 * column, with the day it gets a meaning left to a schema dump. So the console
 * reads it **to print it**, exactly as it reads `subscription_status` to print
 * that (FR-2404/FR-2405), and the boundary that actually matters — no student
 * surface, and no rule, may read it — is enforced by `lib/plan-gate.test.mts`
 * rather than by nobody having selected it yet. `lib/catalog.ts` still takes
 * grade, rules and overrides and nothing else; there is no commercial input to
 * the decision's signature, which is the property FR-2711 names.
 */
export async function courseCatalog(
  operatorId: number
): Promise<CourseCatalogRow[]> {
  const { rules, depth } = await withOperator(operatorId, async (db) => {
    const [ruleRes, depthRes] = await sequential([
      () =>
        db.query(
          `SELECT ca.course_id, ca.grade, ca.state, ca.note, ca.updated_at,
                  ca.requires_plan,
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
    rules.map((r) => [`${r.course_id}\x00${r.grade}`, r])
  );
  const byCourse = new Map(depth.map((d) => [String(d.course_id), d]));

  const out: CourseCatalogRow[] = [];
  // COURSE registry order (`lib/courses.ts`): curriculum, then subject, then
  // course — so the three National courses read in the sequence the subject
  // registry gave them, and every course of one curriculum sits together. A
  // course is listed whether or not its book is loaded (ADR-0018).
  for (const courseId of COURSE_IDS) {
    const course = COURSES[courseId];
    const subject: Subject = course.subject;
    const def = SUBJECTS[subject];
    const d = byCourse.get(courseId);
    for (const g of GRADES) {
      const row = byCell.get(`${courseId}\x00${g.value}`);
      out.push({
        courseId,
        courseLabel: course.label,
        curriculum: course.curriculum,
        curriculumLabel: CURRICULA[course.curriculum].label,
        courseGrades: course.grades,
        subject,
        spineKey: def.key,
        label: def.label,
        labelAr: def.labelAr,
        dir: def.dir,
        book: course.book,
        grade: g.value,
        gradeLabel: gradeDisplayLabel(g.value, course.curriculum),
        state: row ? asState(row.state) : "hidden",
        explicit: row != null,
        note: (row?.note as string | null) ?? null,
        // Printed by the console and read by nothing else — see the type.
        requiresPlan: (row?.requires_plan as string | null) ?? null,
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
  /** the course's own name — two maths courses are told apart by it */
  courseLabel: string;
  subject: Subject;
  label: string;
  labelAr: string;
  dir: TextDirection;
  /** the course's curriculum, and whether it is the student's own (FR-4105) */
  curriculum: CurriculumId;
  curriculumLabel: string;
  inStudentCurriculum: boolean;
  /** the student's own grade, folded onto the canonical spelling */
  grade: string | null;
  /** her grade, in her own curriculum's words (FR-4013) */
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
  /**
   * WHY, in one word an operator can read (FR-4105), in the order the rule
   * decides: an exception did — and one for a course OUTSIDE her curriculum is
   * named as such, so it is never read as her own (privacy review F18); the
   * course is another curriculum's; the kill switch has suspended the grade
   * rules and the course is available because it is loaded (or hidden because
   * it is not); or the grade rule said so, or said nothing.
   */
  reason:
    | "exception"
    | "exception-outside-curriculum"
    | "other-curriculum"
    | "switch-off"
    | "rule"
    | "no-rule";
};

export async function studentAccess(
  operatorId: number,
  studentId: number
): Promise<StudentAccessRow[]> {
  // The console always reads the levers, switch or no switch: an operator
  // must be able to see what is configured while it is suspended (FR-2709:
  // "leaves every configured rule in place").
  const { grade, curriculum, rules, overrides, loaded, overrideRows } = await withOperator(
    operatorId,
    async (db) => {
      const base = await availabilityFor(db, studentId, true);
      // what the kill switch would make visible, so the answer below is the
      // one the student gets whichever way the switch is set
      const courses = COURSE_GATING
        ? null
        : await db.query(`SELECT id FROM graph_nodes WHERE kind = 'course'`);
      const detail = await db.query(
        `SELECT sca.course_id, sca.state, sca.note, sca.updated_at,
                op.display_name AS updated_by
           FROM student_course_access sca
           LEFT JOIN operators op ON op.id = sca.updated_by
          WHERE sca.environment = $1 AND sca.student_id = $2`,
        [ENVIRONMENT, studentId]
      );
      return {
        ...base,
        loaded: courses ? new Set(courses.rows.map((r) => String(r.id))) : null,
        overrideRows: detail.rows,
      };
    }
  );

  const byCourse = new Map(overrideRows.map((r) => [String(r.course_id), r]));
  const switchedOff: SwitchedOff | undefined = loaded ? { loaded } : undefined;
  const own = asCurriculumId(curriculum);

  return COURSE_IDS.map((courseId: CourseId) => {
    const course = COURSES[courseId];
    const subject: Subject = course.subject;
    const def = SUBJECTS[subject];
    const rule = rules.find(
      (r) => r.courseId === courseId && canonicalGrade(r.grade) === grade
    );
    const o = byCourse.get(courseId);
    const inStudentCurriculum = own === course.curriculum;
    // The step of `isCourseVisible` that decided it, in its order.
    const reason: StudentAccessRow["reason"] = o
      ? inStudentCurriculum
        ? "exception"
        : "exception-outside-curriculum"
      : !inStudentCurriculum
        ? "other-curriculum"
        : !COURSE_GATING
          ? "switch-off"
          : rule
            ? "rule"
            : "no-rule";
    return {
      courseId,
      courseLabel: course.label,
      subject,
      label: def.label,
      labelAr: def.labelAr,
      dir: def.dir,
      curriculum: course.curriculum,
      curriculumLabel: curriculumLabel(course.curriculum),
      inStudentCurriculum,
      grade,
      gradeLabel: gradeDisplayLabel(grade, curriculum),
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
      effectiveState: isCourseVisible(courseId, { grade, curriculum }, rules, overrides, switchedOff)
        ? "live"
        : "hidden",
      reason,
    };
  });
}
