import { sequential, withOperator } from "@/lib/db";
import { ENVIRONMENT } from "@/lib/env";
import { UTC_DAY, TODAY_UTC } from "@/lib/cost-queries";
import { courseName } from "@/lib/console-course-names";
import {
  BOOK_SECTIONS_SQL,
  sectionIndexFromRows,
  type BookSectionRow,
} from "@/lib/book-sections";
import { rollUpBySection, type SectionFigures } from "@/lib/content-admin";
import { slugOfLo } from "@/lib/lesson-slug";
import { COURSES, COURSE_IDS, compareCourses, courseDef, isCourseId } from "@/lib/courses";
import type { CurriculumId } from "@/lib/curricula";
import { LO_MODULE_JOIN, MODULE_ORDER } from "@/lib/module-order";
import { SUBJECTS } from "@/lib/subjects";
import {
  MASTERY_THRESHOLD,
  cite,
  costTileState,
  heatCell,
  pickDefaultCohort,
  schoolWeekOf,
  schoolYearStart,
  weekKey,
  weeksBetween,
  weekStart,
  monthTwoRetention,
  type CohortActivity,
  type CostTileState,
  type HeatCell,
  type SchoolWeek,
} from "@/lib/overview-rules";

/**
 * The cohort overview and the course/year heatmap (contracts/admin.md §8,
 * research A3/R13, ADR-0016 §3, FR-2507, FR-2407; feature 003 FR-4104,
 * decision 8).
 *
 * ---------------------------------------------------------------------------
 * THE KEY IS THREE COLUMNS AND THEY ARE NOT ONE AXIS
 * ---------------------------------------------------------------------------
 * `(course_id, grade, syllabus_version)`. `graph_edges.syllabus_version` is the
 * **curriculum year** ('2025-2026'); `students.grade` is the **student's
 * school year**; the course is **which book is being taught**. Conflating any
 * two of them produces a number that means nothing (research A3), so all
 * three travel together through every function here and appear together in
 * every heading on the page.
 *
 * **Keyed by COURSE, not subject, since 003** (FR-4104, decision 8). Until
 * then the key was `(subject, …)`, which was the same thing while each
 * subject had one course. The Grade 10 American maths course is the same
 * subject as Prep-3 maths, and a `subject = 'math'` cohort would have summed
 * the two books' objectives, attempts and mastery into one figure — the one
 * thing FR-4104 forbids. Every objective-scoped read below therefore filters
 * `node_subject.course_id`, never `node_subject.subject`.
 *
 * **A cohort's POPULATION is the students of that grade who follow that
 * course's curriculum** (`students.curriculum_system`, the course's curriculum
 * from the registry, `lib/courses.ts`). That is who the course's rules reach
 * (`lib/catalog.ts`, step 2), and it keeps the grade-scoped figures —
 * activation, weekly active, retention, session length, cost — from being one
 * population printed under two courses' names. For every student created
 * before 003 (all National) the numbers are exactly what they were. A student
 * whose stored curriculum the registry does not know is in no cohort, and a
 * course the registry does not know has none (FR-4002): nobody can see it.
 * A tester holding an exception for another curriculum's course is counted
 * with her own curriculum's cohorts, and her attempts on the other course are
 * not in its cohort — an exception is a preview, not enrolment.
 *
 * Time buckets are **school-year weeks** (`lib/overview-rules.ts`), never
 * calendar weeks.
 *
 * ---------------------------------------------------------------------------
 * EVERY FIGURE CITES ITS DEFINITION BY NAME
 * ---------------------------------------------------------------------------
 * `cite("active")`, `cite("retained")` and so on resolve against the dictionary
 * in `lib/overview-rules.ts`, and `cite` throws on a term that is not there. So
 * a figure here and its written definition on `/overview/definitions` cannot
 * come apart, and a new figure with no definition is a crash rather than a
 * number nobody agreed on. At n=200 that matters more than any of the figures.
 *
 * ---------------------------------------------------------------------------
 * THE SAME THREE RULES THE OTHER READ MODELS STATE
 * ---------------------------------------------------------------------------
 *  1. `withOperator`, never `withMaint` — these reads are cross-student by
 *     construction, and `ainext_app` under a student principal would return one
 *     child's row and call it a cohort.
 *  2. **Environment first, always** (constitution XI, FR-2407, FR-2109). Every
 *     query below filters `environment` before it groups by anything.
 *  3. **Sequential, never `Promise.all`** — one client per `withOperator`
 *     callback, and pg@9 removed the implicit queuing.
 *
 * **No individual content on any overview** (contracts/admin.md §8): every
 * value returned is a count, a share, a duration or a curriculum label. No
 * student name, no student id, no message, no attempt. That is also why all
 * four roles may read it.
 */

/* ------------------------------------------------------------------ types */

export type CohortKey = {
  /** a registry course id (`lib/courses.ts`) — the axis FR-4104 splits on */
  courseId: string;
  grade: string;
  syllabusVersion: string;
};

export type CohortOption = CohortKey & {
  /** the course's spine subject (`math`) — `pickDefaultCohort`'s last tiebreak */
  subject: string;
  /** the course's curriculum — the population is its students (see header) */
  curriculum: CurriculumId;
  /** Students of this grade and curriculum on this environment. The cohort's population. */
  students: number;
  /** "Mathematics — Grade 10 (American)" (`courseName`) */
  courseLabel: string;
};

export type Activation = {
  accounts: number;
  verified: number;
  firstSession: number;
};

export type WeeklyActive = {
  week: SchoolWeek;
  key: string;
  startsOn: string;
  activeStudents: number;
  sessions: number;
};

export type SessionLength = {
  medianMinutes: number | null;
  p90Minutes: number | null;
  sessions: number;
};

export type AttemptStats = {
  attempts: number;
  correct: number;
  /** null when there are no attempts — an accuracy over zero attempts is not 0%. */
  accuracy: number | null;
};

export type MasteryReach = {
  /** Median objectives at or above the threshold, across students with any evidence. */
  medianObjectives: number | null;
  studentsWithEvidence: number;
  /** objectives in THIS COURSE (the name predates 003's course key) */
  objectivesInSubject: number;
};

export type CostPerActive = {
  totalUsd: number;
  activeStudents: number;
  perActiveUsd: number | null;
  /** `cost_daily` holds CLOSED days only; today is never in it. Said, not hidden. */
  throughDay: string | null;
  /** Today's live total for THIS cohort, from `ai_interactions` directly —
   *  never stored, recomputed on every load, same UTC boundary `cost-queries.ts`
   *  uses for the cost page's own live-today half (`UTC_DAY`/`TODAY_UTC`,
   *  imported rather than re-derived). Present even when `perActiveUsd` is not
   *  null, so a reader can see today is never folded into it. */
  todayLiveUsd: number;
  todayLiveStudents: number;
  /** Has ANY cohort on this environment ever had a closed day rolled up? Not
   *  scoped to this cohort — see `costTileState` for why that distinction is
   *  the whole point of asking. */
  environmentHasAnyClosedDay: boolean;
  /** Which of the panel's four states applies — computed once here, from the
   *  three fields above, so the page renders a sentence instead of
   *  re-deriving "is this actually empty" next to the figures. */
  tileState: CostTileState;
};

export type HeatObjective = {
  loId: string;
  label: string;
  moduleOrdinal: number | null;
  loOrdinal: number | null;
};

export type Heatmap = {
  objectives: HeatObjective[];
  weeks: WeeklyActive["week"][];
  weekKeys: string[];
  /** `cells[loIndex][weekIndex]`. Dense — a week with no activity is a cell, not a gap. */
  cells: HeatCell[][];
};

/**
 * One lesson's cohort figures (003, FR-4319): every one a COUNT, so a book
 * section's figures are its parts' figures added (`rollUpBySection`). "Reached"
 * and "at the threshold" count (student, objective) pairs over the current
 * mastery rows, which is what makes them addable — a count of distinct
 * students could not be summed across parts without counting a child twice.
 */
export type LessonActivity = {
  objectives: number;
  attempts: number;
  correct: number;
  /** (student, objective) pairs with a current estimate */
  reached: number;
  /** …of which at or above the threshold */
  mastered: number;
};

export function addLessonActivity(a: LessonActivity, b: LessonActivity): LessonActivity {
  return {
    objectives: a.objectives + b.objectives,
    attempts: a.attempts + b.attempts,
    correct: a.correct + b.correct,
    reached: a.reached + b.reached,
    mastered: a.mastered + b.mastered,
  };
}

export type Overview = {
  environment: string;
  options: CohortOption[];
  selected: CohortKey | null;
  /** the selected course's curriculum — whose students the cohort counts */
  selectedCurriculum: CurriculumId | null;
  schoolYear: number;
  schoolYearStartsOn: string;
  currentWeek: SchoolWeek;
  activation: Activation;
  weekly: WeeklyActive[];
  retention: ReturnType<typeof monthTwoRetention>;
  sessionLength: SessionLength;
  attempts: AttemptStats;
  mastery: MasteryReach;
  cost: CostPerActive;
  heatmap: Heatmap;
  /** the course's lessons, catalogue order, with the cohort's figures (FR-4319) */
  byLesson: { lessonSlug: string; figures: LessonActivity }[];
  /** the same, rolled up into book sections — computed from the parts' rows */
  bySection: SectionFigures<LessonActivity>[];
  masteryThreshold: number;
};

/* ------------------------------------------------------------------ query */

export async function getOverview(
  operatorId: number,
  requested: Partial<CohortKey> & {
    /** a pre-003 `?subject=` link: the first registry course of that subject */
    subject?: string;
  } = {},
  nowMs: number = Date.now()
): Promise<Overview> {
  const now = new Date(nowMs);
  const year = schoolWeekOf(now).year;
  const yearStart = schoolYearStart(year);
  const weeks = weeksBetween(yearStart, now);

  // The registry's courses and their curricula, handed to SQL as two arrays
  // so every read can join a course to the curriculum whose students it
  // reaches. Registry constants, never input.
  const regCourses = [...COURSE_IDS];
  const regCurricula = regCourses.map((id) => COURSES[id].curriculum);

  return withOperator(operatorId, async (db) => {
    // The cohorts that EXIST, before anything is computed for one of them: a
    // (course, grade, syllabus) with students of that grade who follow the
    // course's curriculum. A console that offered a key with no students
    // behind it would draw an entire empty page and let the reader conclude
    // the product is unused.
    const optionRows = await db.query<{
      course_id: string;
      grade: string;
      syllabus_version: string;
      students: string;
    }>(
      `SELECT c.id AS course_id, st.grade, e.syllabus_version,
              count(DISTINCT st.id) AS students
         FROM graph_nodes c
         JOIN unnest($2::text[], $3::text[]) AS reg(course_id, curriculum)
           ON reg.course_id = c.id
         JOIN graph_edges e ON e.dst_id = c.id AND e.edge_type = 'part_of'
                           AND e.system_to IS NULL
         JOIN students st ON st.environment = $1
                         AND st.curriculum_system = reg.curriculum
        WHERE c.kind = 'course'
        GROUP BY c.id, st.grade, e.syllabus_version
        ORDER BY c.id, st.grade, e.syllabus_version`,
      [ENVIRONMENT, regCourses, regCurricula]
    );

    const options: CohortOption[] = optionRows.rows
      .filter((r) => isCourseId(r.course_id))
      .map((r) => {
        const def = courseDef(r.course_id)!;
        return {
          courseId: r.course_id,
          grade: r.grade,
          syllabusVersion: r.syllabus_version,
          subject: SUBJECTS[def.subject].key,
          curriculum: def.curriculum,
          students: Number(r.students),
          courseLabel: courseName(r.course_id),
        };
      })
      // registry order — curriculum, then subject, then course — then grade
      .sort(
        (a, b) =>
          compareCourses(a.courseId, b.courseId) ||
          a.grade.localeCompare(b.grade) ||
          a.syllabusVersion.localeCompare(b.syllabusVersion)
      );

    // The activity signal `pickDefaultCohort` (lib/overview-rules.ts) ranks on
    // — fetched whenever a cohort exists, because the fallback below is used
    // both for a bare `/overview` visit AND for a URL that names a cohort that
    // does not exist. Three small queries, `sequential`, never `Promise.all`.
    const [sessionByGradeRows, attemptsByCourseGradeRows, objectivesByCourseRows] =
      await sequential([
        // Sessions carry no course column, so this discriminates between
        // (grade, curriculum) populations, not between courses of one
        // curriculum taught to the same grade.
        () =>
          db.query<{ grade: string; curriculum: string; students_with_session: string }>(
            `SELECT st.grade, st.curriculum_system AS curriculum,
                    count(DISTINCT s.student_id) AS students_with_session
               FROM students st
               JOIN sessions s ON s.student_id = st.id AND s.environment = $1
              WHERE st.environment = $1
              GROUP BY st.grade, st.curriculum_system`,
            [ENVIRONMENT]
          ),
        () =>
          db.query<{ course_id: string; grade: string; attempts: string }>(
            `SELECT ns.course_id, st.grade, count(*) AS attempts
               FROM attempts at
               JOIN students st ON st.id = at.student_id
               JOIN questions q ON q.id = at.question_id
               JOIN node_subject ns ON ns.node_id = q.lo_id
              WHERE at.environment = $1 AND st.environment = $1
              GROUP BY ns.course_id, st.grade`,
            [ENVIRONMENT]
          ),
        () =>
          db.query<{ course_id: string; objectives: string }>(
            `SELECT course_id, count(*) AS objectives FROM node_subject GROUP BY course_id`,
            []
          ),
      ] as const);

    const sessionsByGrade = new Map(
      sessionByGradeRows.rows.map((r) => [`${r.grade}|${r.curriculum}`, Number(r.students_with_session)])
    );
    const attemptsByCourseGrade = new Map(
      attemptsByCourseGradeRows.rows.map((r) => [`${r.course_id}|${r.grade}`, Number(r.attempts)])
    );
    const objectivesByCourse = new Map(
      objectivesByCourseRows.rows.map((r) => [r.course_id, Number(r.objectives)])
    );

    const candidates: (CohortOption & CohortActivity)[] = options.map((o) => ({
      ...o,
      studentsWithSession: sessionsByGrade.get(`${o.grade}|${o.curriculum}`) ?? 0,
      attempts: attemptsByCourseGrade.get(`${o.courseId}|${o.grade}`) ?? 0,
      contentLoaded: objectivesByCourse.get(o.courseId) ?? 0,
    }));

    // A bare `/overview` names NO filter, so the smart pick is used whenever
    // nothing was actually requested, not only when a request matches nothing
    // (a plain `.find()` would return the first option — an ordering
    // accident, not a choice). A pre-003 `?subject=` link still works: it
    // means the first course of that subject, in registry order.
    const somethingRequested = Boolean(
      requested.courseId || requested.subject || requested.grade || requested.syllabusVersion
    );
    const selected = somethingRequested
      ? (options.find(
          (o) =>
            (!requested.courseId || o.courseId === requested.courseId) &&
            (!requested.subject || requested.courseId || o.subject === requested.subject) &&
            (!requested.grade || o.grade === requested.grade) &&
            (!requested.syllabusVersion || o.syllabusVersion === requested.syllabusVersion)
        ) ?? pickDefaultCohort(candidates))
      : pickDefaultCohort(candidates);

    if (!selected) {
      return emptyOverview(options, year, yearStart, now, weeks);
    }

    const key: CohortKey = {
      courseId: selected.courseId,
      grade: selected.grade,
      syllabusVersion: selected.syllabusVersion,
    };
    // Whose students this cohort counts: the course's curriculum (header).
    const curriculum = COURSES[key.courseId as keyof typeof COURSES].curriculum;

    // The week boundaries, as the END of each week — the instant a heatmap cell
    // is an as-of question about. Passed as an array so the SQL below can
    // `unnest` it rather than generating a series whose step has to agree with
    // the TypeScript one by luck.
    const weekEnds = weeks.map((w) => new Date(weekStart(w).getTime() + 7 * 86_400_000).toISOString());

    const [
      activation,
      weekly,
      retentionRows,
      lengths,
      attemptRows,
      masteryRows,
      costRows,
      liveTodayRows,
      environmentRolledRows,
      objectiveRows,
      heatRows,
      loAttemptRows,
      loMasteryRows,
      sectionRows,
    ] = await sequential([
      // ---- activation: three counts, each a strict subset (cite "activated")
      //
      // Scoped to the cohort's population — this grade, this curriculum — and
      // not to the course's objectives: a student who never opened a session
      // has touched no objective yet. Excluding them would make the funnel's
      // first step its own last step.
      () =>
        db.query<{ accounts: string; verified: string; first_session: string }>(
          `SELECT
             count(*)                                                       AS accounts,
             count(*) FILTER (WHERE a.email_verified_at IS NOT NULL)        AS verified,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM sessions s
                                             WHERE s.student_id = st.id
                                               AND s.environment = $1))     AS first_session
           FROM students st
           LEFT JOIN accounts a ON a.id = st.account_id
          WHERE st.environment = $1 AND st.grade = $2 AND st.curriculum_system = $3`,
          [ENVIRONMENT, key.grade, curriculum]
        ),

      // ---- weekly active (cite "active"): one session in the week is enough
      () =>
        db.query<{ week_start: Date; students: string; sessions: string }>(
          `SELECT w AS week_start,
                  count(DISTINCT s.student_id) AS students,
                  count(s.id) AS sessions
             FROM unnest($3::timestamptz[]) AS w
             LEFT JOIN sessions s
               ON s.environment = $1
              AND s.opened_at >= w
              AND s.opened_at <  w + interval '7 days'
              AND s.student_id IN (SELECT id FROM students
                                    WHERE environment = $1 AND grade = $2
                                      AND curriculum_system = $4)
            GROUP BY w
            ORDER BY w`,
          [ENVIRONMENT, key.grade, weeks.map((x) => weekStart(x).toISOString()), curriculum]
        ),

      // ---- retention (cite "retained"): the arithmetic is in overview-rules,
      //      so this query only fetches each student's first session and every
      //      session start. The definition must not live in SQL where the test
      //      cannot reach it.
      () =>
        db.query<{ student_id: string; first_at: Date; all_at: Date[] }>(
          `SELECT s.student_id, min(s.opened_at) AS first_at,
                  array_agg(s.opened_at ORDER BY s.opened_at) AS all_at
             FROM sessions s
             JOIN students st ON st.id = s.student_id
            WHERE s.environment = $1 AND st.environment = $1 AND st.grade = $2
              AND st.curriculum_system = $3
            GROUP BY s.student_id`,
          [ENVIRONMENT, key.grade, curriculum]
        ),

      // ---- session length (cite "session"), median and p90, in minutes.
      //      An OPEN session is measured to its last-seen-at, not to now: a tab
      //      left open overnight is not a six-hour study session.
      () =>
        db.query<{ median_min: string | null; p90_min: string | null; sessions: string }>(
          `SELECT
             percentile_cont(0.5) WITHIN GROUP (ORDER BY mins) AS median_min,
             percentile_cont(0.9) WITHIN GROUP (ORDER BY mins) AS p90_min,
             count(*) AS sessions
           FROM (
             SELECT extract(epoch FROM (coalesce(s.closed_at, s.last_seen_at) - s.opened_at)) / 60.0 AS mins
               FROM sessions s
               JOIN students st ON st.id = s.student_id
              WHERE s.environment = $1 AND st.environment = $1 AND st.grade = $2
                AND st.curriculum_system = $4
                AND s.opened_at >= $3
           ) q
          WHERE mins >= 0`,
          [ENVIRONMENT, key.grade, yearStart.toISOString(), curriculum]
        ),

      // ---- attempts and accuracy, over THIS COURSE's objectives only
      () =>
        db.query<{ attempts: string; correct: string }>(
          `SELECT count(*) AS attempts, count(*) FILTER (WHERE at.is_correct) AS correct
             FROM attempts at
             JOIN students st ON st.id = at.student_id
             JOIN questions q ON q.id = at.question_id
             JOIN node_subject ns ON ns.node_id = q.lo_id
            WHERE at.environment = $1 AND st.environment = $1
              AND st.grade = $2 AND ns.course_id = $3
              AND st.curriculum_system = $5
              AND at.attempted_at >= $4`,
          [ENVIRONMENT, key.grade, key.courseId, yearStart.toISOString(), curriculum]
        ),

      // ---- median objectives at the threshold (cite "mastered"). CURRENT
      //      mastery = the row with no system_to; the table is bitemporal and
      //      history is never overwritten.
      () =>
        db.query<{ median_objectives: string | null; students: string; objectives: string }>(
          `WITH per_student AS (
             SELECT m.student_id,
                    count(*) FILTER (WHERE m.score >= $4) AS mastered
               FROM mastery m
               JOIN students st ON st.id = m.student_id
               JOIN node_subject ns ON ns.node_id = m.lo_id
              WHERE m.environment = $1 AND st.environment = $1
                AND st.grade = $2 AND ns.course_id = $3
                AND st.curriculum_system = $5
                AND m.system_to IS NULL
              GROUP BY m.student_id
           )
           SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY mastered) AS median_objectives,
                  (SELECT count(*) FROM per_student) AS students,
                  (SELECT count(*) FROM node_subject WHERE course_id = $3) AS objectives
             FROM per_student`,
          [ENVIRONMENT, key.grade, key.courseId, MASTERY_THRESHOLD, curriculum]
        ),

      // ---- cost per active student. `cost_daily` (closed days) rather than the
      //      ledger, because the same rollup feeds the cost page and two sources
      //      for one dollar figure is how two pages disagree. Cost has no
      //      course column: it is the cohort POPULATION's spend.
      () =>
        db.query<{ total_usd: string | null; students: string; through_day: Date | null }>(
          `SELECT sum(cd.cost_usd) AS total_usd,
                  count(DISTINCT cd.student_id) AS students,
                  max(cd.day) AS through_day
             FROM cost_daily cd
             JOIN students st ON st.id = cd.student_id
            WHERE cd.environment = $1 AND st.environment = $1
              AND st.grade = $2 AND cd.day >= $3::date
              AND st.curriculum_system = $4`,
          [ENVIRONMENT, key.grade, yearStart.toISOString(), curriculum]
        ),

      // ---- cost: today's live spend for THIS cohort, straight off
      //      `ai_interactions` — the same UTC-day boundary `cost-queries.ts`
      //      uses for its own live-today half (`UTC_DAY`/`TODAY_UTC`,
      //      IMPORTED, not re-derived, so the two pages cannot draw that line
      //      in two places and quietly disagree). Population-scoped like
      //      `costRows` above.
      () =>
        db.query<{ live_usd: string | null; live_students: string }>(
          `SELECT coalesce(sum(ai.cost_usd), 0) AS live_usd,
                  count(DISTINCT ai.student_id) AS live_students
             FROM ai_interactions ai
             JOIN students st ON st.id = ai.student_id
            WHERE ai.environment = $1 AND st.environment = $1 AND st.grade = $2
              AND st.curriculum_system = $3
              AND ${UTC_DAY} = ${TODAY_UTC}`,
          [ENVIRONMENT, key.grade, curriculum]
        ),

      // ---- cost: has the rollup EVER closed a day on this ENVIRONMENT, for
      //      any cohort? Deliberately not cohort-scoped, unlike every query
      //      around it — `costRows.through_day` already answers "the most
      //      recent closed day for THIS cohort" and can be null while other
      //      cohorts have years of closed days. Without it, a cohort with
      //      genuinely nothing yet is indistinguishable from a rollup that has
      //      never run at all (`costTileState`, overview-rules.ts). A date,
      //      not a figure: it pools nothing.
      () =>
        db.query<{ through: string | null }>(
          `SELECT max(cd.day)::text AS through FROM cost_daily cd WHERE cd.environment = $1`,
          [ENVIRONMENT]
        ),

      // ---- the heatmap's rows: this COURSE's objectives in CATALOGUE order
      //      (FR-3217) — the lesson list's order, not alphabetical and not by
      //      id. One course, so `MODULE_ORDER` alone orders it (no course key
      //      needed in front, `catalogue-order-guard.test.mts`).
      () =>
        db.query<{
          lo_id: string;
          label: string;
          module_ordinal: number | null;
          lo_ordinal: number | null;
        }>(
          `SELECT lo.id AS lo_id, lo.label,
                  m.order_in_parent AS module_ordinal,
                  lo.order_in_parent AS lo_ordinal
             FROM node_subject ns
             JOIN graph_nodes lo ON lo.id = ns.node_id${LO_MODULE_JOIN}
            WHERE ns.course_id = $1
            ORDER BY ${MODULE_ORDER}`,
          [key.courseId]
        ),

      // ---- the heatmap's cells: for each (objective, week end), how many of
      //      the cohort had ANY evidence by then and how many were at or above
      //      the threshold. The as-of predicate is what makes this a history
      //      rather than a series of snapshots of today.
      () =>
        db.query<{ lo_id: string; week_end: Date; reached: string; mastered: string }>(
          `SELECT ns.node_id AS lo_id, w AS week_end,
                  count(DISTINCT m.student_id) AS reached,
                  count(DISTINCT m.student_id) FILTER (WHERE m.score >= $4) AS mastered
             FROM node_subject ns
             CROSS JOIN unnest($3::timestamptz[]) AS w
             LEFT JOIN mastery m
               ON m.lo_id = ns.node_id
              AND m.environment = $1
              AND m.system_from <= w
              AND (m.system_to IS NULL OR m.system_to > w)
              AND m.student_id IN (SELECT id FROM students
                                    WHERE environment = $1 AND grade = $2
                                      AND curriculum_system = $6)
            WHERE ns.course_id = $5
            GROUP BY ns.node_id, w`,
          [ENVIRONMENT, key.grade, weekEnds, MASTERY_THRESHOLD, key.courseId, curriculum]
        ),

      // ---- per objective, for the per-lesson and per-section figures
      //      (FR-4319): the cohort's attempts this school year…
      () =>
        db.query<{ lo_id: string; attempts: string; correct: string }>(
          `SELECT q.lo_id, count(*) AS attempts, count(*) FILTER (WHERE at.is_correct) AS correct
             FROM attempts at
             JOIN students st ON st.id = at.student_id
             JOIN questions q ON q.id = at.question_id
             JOIN node_subject ns ON ns.node_id = q.lo_id
            WHERE at.environment = $1 AND st.environment = $1
              AND st.grade = $2 AND ns.course_id = $3
              AND st.curriculum_system = $5
              AND at.attempted_at >= $4
            GROUP BY q.lo_id`,
          [ENVIRONMENT, key.grade, key.courseId, yearStart.toISOString(), curriculum]
        ),
      //      …and its CURRENT estimates (no system_to), reached and at threshold
      () =>
        db.query<{ lo_id: string; reached: string; mastered: string }>(
          `SELECT m.lo_id,
                  count(DISTINCT m.student_id) AS reached,
                  count(DISTINCT m.student_id) FILTER (WHERE m.score >= $4) AS mastered
             FROM mastery m
             JOIN students st ON st.id = m.student_id
             JOIN node_subject ns ON ns.node_id = m.lo_id
            WHERE m.environment = $1 AND st.environment = $1
              AND st.grade = $2 AND ns.course_id = $3
              AND st.curriculum_system = $5
              AND m.system_to IS NULL
            GROUP BY m.lo_id`,
          [ENVIRONMENT, key.grade, key.courseId, MASTERY_THRESHOLD, curriculum]
        ),
      // ---- the course's book sections (migration 034, `lib/book-sections.ts`)
      () => db.query(BOOK_SECTIONS_SQL, [[key.courseId]]),
    ] as const);

    /* ------------------------------------------------------------ shape it */

    const a = activation.rows[0];
    const attemptRow = attemptRows.rows[0];
    const attemptsN = Number(attemptRow?.attempts ?? 0);
    const correctN = Number(attemptRow?.correct ?? 0);

    const weeklyOut: WeeklyActive[] = weekly.rows.map((r) => {
      const w = schoolWeekOf(r.week_start);
      return {
        week: w,
        key: weekKey(w),
        startsOn: r.week_start.toISOString(),
        activeStudents: Number(r.students),
        sessions: Number(r.sessions),
      };
    });

    const retention = monthTwoRetention(
      retentionRows.rows.map((r) => ({
        firstSessionAt: r.first_at.toISOString(),
        sessionsAt: (r.all_at ?? []).map((d) => new Date(d).toISOString()),
      })),
      nowMs
    );

    const objectives: HeatObjective[] = objectiveRows.rows.map((r) => ({
      loId: r.lo_id,
      label: r.label,
      moduleOrdinal: r.module_ordinal,
      loOrdinal: r.lo_ordinal,
    }));

    // Per lesson, in the heatmap's catalogue order, then per book section.
    const loAttempts = new Map(loAttemptRows.rows.map((r) => [r.lo_id, r]));
    const loMastery = new Map(loMasteryRows.rows.map((r) => [r.lo_id, r]));
    const lessonOrder: string[] = [];
    const lessonFigures = new Map<string, LessonActivity>();
    for (const o of objectives) {
      const slug = slugOfLo(o.loId);
      const a = loAttempts.get(o.loId);
      const m = loMastery.get(o.loId);
      const one: LessonActivity = {
        objectives: 1,
        attempts: Number(a?.attempts ?? 0),
        correct: Number(a?.correct ?? 0),
        reached: Number(m?.reached ?? 0),
        mastered: Number(m?.mastered ?? 0),
      };
      const prev = lessonFigures.get(slug);
      if (!prev) lessonOrder.push(slug);
      lessonFigures.set(slug, prev ? addLessonActivity(prev, one) : one);
    }
    const byLesson = lessonOrder.map((lessonSlug) => ({
      lessonSlug,
      figures: lessonFigures.get(lessonSlug)!,
    }));
    // …and per book section: a split section's parts are one row, added up
    // from the parts' rows (FR-4319). A course with no store rows — every
    // National course until the loader writes them — gets one row per lesson.
    const sections = sectionIndexFromRows(sectionRows.rows as unknown as BookSectionRow[]);
    const bySection = rollUpBySection(byLesson, sections, addLessonActivity);

    const byCell = new Map<string, { reached: number; mastered: number }>();
    for (const r of heatRows.rows) {
      byCell.set(`${r.lo_id}|${r.week_end.toISOString()}`, {
        reached: Number(r.reached),
        mastered: Number(r.mastered),
      });
    }
    const cells: HeatCell[][] = objectives.map((o) =>
      weekEnds.map((end) => {
        const c = byCell.get(`${o.loId}|${end}`);
        return heatCell(c?.reached ?? 0, c?.mastered ?? 0);
      })
    );

    const costTotal = Number(costRows.rows[0]?.total_usd ?? 0);
    const costStudents = Number(costRows.rows[0]?.students ?? 0);
    const todayLiveUsd = Number(liveTodayRows.rows[0]?.live_usd ?? 0);
    const todayLiveStudents = Number(liveTodayRows.rows[0]?.live_students ?? 0);
    const environmentHasAnyClosedDay = environmentRolledRows.rows[0]?.through != null;
    const tileState = costTileState({
      cohortHasClosedSpend: costStudents > 0,
      todayLiveUsd,
      environmentHasAnyClosedDay,
    });

    // Citation side-effect on purpose: every term a figure below claims to
    // implement is resolved here, so a definition deleted from the dictionary
    // takes this page down loudly instead of leaving a number with no meaning.
    for (const term of ["week", "cohort", "session", "active", "mastered", "activated", "retained"]) {
      cite(term);
    }

    return {
      environment: ENVIRONMENT,
      options,
      selected: key,
      selectedCurriculum: curriculum,
      schoolYear: year,
      schoolYearStartsOn: yearStart.toISOString(),
      currentWeek: schoolWeekOf(now),
      activation: {
        accounts: Number(a?.accounts ?? 0),
        verified: Number(a?.verified ?? 0),
        firstSession: Number(a?.first_session ?? 0),
      },
      weekly: weeklyOut,
      retention,
      sessionLength: {
        medianMinutes:
          lengths.rows[0]?.median_min === null || lengths.rows[0]?.median_min === undefined
            ? null
            : Number(lengths.rows[0].median_min),
        p90Minutes:
          lengths.rows[0]?.p90_min === null || lengths.rows[0]?.p90_min === undefined
            ? null
            : Number(lengths.rows[0].p90_min),
        sessions: Number(lengths.rows[0]?.sessions ?? 0),
      },
      attempts: {
        attempts: attemptsN,
        correct: correctN,
        accuracy: attemptsN === 0 ? null : correctN / attemptsN,
      },
      mastery: {
        medianObjectives:
          masteryRows.rows[0]?.median_objectives == null
            ? null
            : Number(masteryRows.rows[0].median_objectives),
        studentsWithEvidence: Number(masteryRows.rows[0]?.students ?? 0),
        objectivesInSubject: Number(masteryRows.rows[0]?.objectives ?? objectives.length),
      },
      cost: {
        totalUsd: costTotal,
        activeStudents: costStudents,
        perActiveUsd: costStudents === 0 ? null : costTotal / costStudents,
        throughDay: costRows.rows[0]?.through_day
          ? new Date(costRows.rows[0].through_day).toISOString().slice(0, 10)
          : null,
        todayLiveUsd,
        todayLiveStudents,
        environmentHasAnyClosedDay,
        tileState,
      },
      heatmap: {
        objectives,
        weeks: weeklyOut.map((w) => w.week),
        weekKeys: weeklyOut.map((w) => w.key),
        cells,
      },
      byLesson,
      bySection,
      masteryThreshold: MASTERY_THRESHOLD,
    };
  });
}

/**
 * What the page renders when the curriculum carries no course with a subject —
 * a fresh database, essentially. Named rather than inlined so the "no cohort"
 * branch is visible in this file's shape.
 */
function emptyOverview(
  options: CohortOption[],
  year: number,
  yearStart: Date,
  now: Date,
  weeks: SchoolWeek[]
): Overview {
  return {
    environment: ENVIRONMENT,
    options,
    selected: null,
    selectedCurriculum: null,
    schoolYear: year,
    schoolYearStartsOn: yearStart.toISOString(),
    currentWeek: schoolWeekOf(now),
    activation: { accounts: 0, verified: 0, firstSession: 0 },
    weekly: [],
    retention: { eligible: 0, retained: 0, rate: null, tooRecent: 0 },
    sessionLength: { medianMinutes: null, p90Minutes: null, sessions: 0 },
    attempts: { attempts: 0, correct: 0, accuracy: null },
    mastery: { medianObjectives: null, studentsWithEvidence: 0, objectivesInSubject: 0 },
    cost: {
      totalUsd: 0,
      activeStudents: 0,
      perActiveUsd: null,
      throughDay: null,
      todayLiveUsd: 0,
      todayLiveStudents: 0,
      environmentHasAnyClosedDay: false,
      tileState: "no-spend",
    },
    heatmap: { objectives: [], weeks, weekKeys: weeks.map(weekKey), cells: [] },
    byLesson: [],
    bySection: [],
    masteryThreshold: MASTERY_THRESHOLD,
  };
}
