import { sequential, withOperator } from "@/lib/db";
import { ENVIRONMENT } from "@/lib/env";
import { UTC_DAY, TODAY_UTC } from "@/lib/cost-queries";
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
 * The cohort overview and the subject/year heatmap (contracts/admin.md §8,
 * research A3/R13, ADR-0016 §3, FR-2507, FR-2407).
 *
 * ---------------------------------------------------------------------------
 * THE KEY IS THREE COLUMNS AND THEY ARE NOT ONE AXIS
 * ---------------------------------------------------------------------------
 * `(subject, grade, syllabus_version)`. `graph_edges.syllabus_version` is the
 * **curriculum year** ('2025-2026'); `students.grade` is the **grade the
 * ministry book is written for**; `subject` is what is being taught. Conflating
 * any two of them produces a number that means nothing (research A3), so all
 * three travel together through every function here and appear together in
 * every heading on the page.
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
  subject: string;
  grade: string;
  syllabusVersion: string;
};

export type CohortOption = CohortKey & {
  /** Students of this grade on this environment. The cohort's population. */
  students: number;
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

export type Overview = {
  environment: string;
  options: CohortOption[];
  selected: CohortKey | null;
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
  masteryThreshold: number;
};

/* ------------------------------------------------------------------ query */

export async function getOverview(
  operatorId: number,
  requested: Partial<CohortKey> = {},
  nowMs: number = Date.now()
): Promise<Overview> {
  const now = new Date(nowMs);
  const year = schoolWeekOf(now).year;
  const yearStart = schoolYearStart(year);
  const weeks = weeksBetween(yearStart, now);

  return withOperator(operatorId, async (db) => {
    // The cohorts that EXIST, before anything is computed for one of them. A
    // console that offered a key with no students behind it would draw an
    // entire empty page and let the reader conclude the product is unused.
    const optionRows = await db.query<{
      subject: string;
      grade: string;
      syllabus_version: string;
      students: string;
      course_label: string;
    }>(
      `SELECT c.subject, st.grade, e.syllabus_version,
              count(DISTINCT st.id) AS students, c.label AS course_label
         FROM graph_nodes c
         JOIN graph_edges e ON e.dst_id = c.id AND e.edge_type = 'part_of'
                           AND e.system_to IS NULL
         CROSS JOIN students st
        WHERE c.kind = 'course' AND c.subject IS NOT NULL
          AND st.environment = $1
        GROUP BY c.subject, st.grade, e.syllabus_version, c.label
        ORDER BY c.subject, st.grade, e.syllabus_version`,
      [ENVIRONMENT]
    );

    const options: CohortOption[] = optionRows.rows.map((r) => ({
      subject: r.subject,
      grade: r.grade,
      syllabusVersion: r.syllabus_version,
      students: Number(r.students),
      courseLabel: r.course_label,
    }));

    // The activity signal `pickDefaultCohort` (lib/overview-rules.ts) ranks on
    // — fetched whenever a cohort exists, because the fallback below is used
    // both for a bare `/overview` visit AND for a URL that names a cohort that
    // does not exist, and either way "options[0]" was the alphabetical
    // accident this query replaces. Three small, well-understood queries
    // rather than one query with three correlated subqueries: this file's own
    // rule is `sequential`, never `Promise.all`, and a query nobody can read
    // at a glance is a worse trade than three more round trips at this scale
    // (a handful of cohorts, not a hot path). Run even with zero options —
    // `pickDefaultCohort([])` is `null` regardless, and a conditional skip
    // here would be a second place the "no cohort at all" case has to be
    // remembered.
    const [sessionByGradeRows, attemptsBySubjectGradeRows, objectivesBySubjectRows] =
      await sequential([
        // Sessions carry no subject column, so this can only ever
        // discriminate between GRADES, not between subjects taught to the
        // same grade — see the field's own comment in overview-rules.ts.
        () =>
          db.query<{ grade: string; students_with_session: string }>(
            `SELECT st.grade, count(DISTINCT s.student_id) AS students_with_session
               FROM students st
               JOIN sessions s ON s.student_id = st.id AND s.environment = $1
              WHERE st.environment = $1
              GROUP BY st.grade`,
            [ENVIRONMENT]
          ),
        () =>
          db.query<{ subject: string; grade: string; attempts: string }>(
            `SELECT ns.subject, st.grade, count(*) AS attempts
               FROM attempts at
               JOIN students st ON st.id = at.student_id
               JOIN questions q ON q.id = at.question_id
               JOIN node_subject ns ON ns.node_id = q.lo_id
              WHERE at.environment = $1 AND st.environment = $1
              GROUP BY ns.subject, st.grade`,
            [ENVIRONMENT]
          ),
        () =>
          db.query<{ subject: string; objectives: string }>(
            `SELECT subject, count(*) AS objectives FROM node_subject GROUP BY subject`,
            []
          ),
      ] as const);

    const sessionsByGrade = new Map(
      sessionByGradeRows.rows.map((r) => [r.grade, Number(r.students_with_session)])
    );
    const attemptsBySubjectGrade = new Map(
      attemptsBySubjectGradeRows.rows.map((r) => [`${r.subject}|${r.grade}`, Number(r.attempts)])
    );
    const objectivesBySubject = new Map(
      objectivesBySubjectRows.rows.map((r) => [r.subject, Number(r.objectives)])
    );

    const candidates: (CohortOption & CohortActivity)[] = options.map((o) => ({
      ...o,
      studentsWithSession: sessionsByGrade.get(o.grade) ?? 0,
      attempts: attemptsBySubjectGrade.get(`${o.subject}|${o.grade}`) ?? 0,
      contentLoaded: objectivesBySubject.get(o.subject) ?? 0,
    }));

    // A bare `/overview` names NO filter, so every field above is vacuously
    // true for every option and a plain `.find()` would return the array's
    // FIRST entry — `options`' own `ORDER BY subject` — which is the exact
    // alphabetical accident this deliverable exists to remove (arabic sorts
    // before math). So the smart pick is used whenever nothing was actually
    // requested, not only when a request matches nothing.
    const somethingRequested = Boolean(
      requested.subject || requested.grade || requested.syllabusVersion
    );
    const selected = somethingRequested
      ? (options.find(
          (o) =>
            (!requested.subject || o.subject === requested.subject) &&
            (!requested.grade || o.grade === requested.grade) &&
            (!requested.syllabusVersion || o.syllabusVersion === requested.syllabusVersion)
        ) ?? pickDefaultCohort(candidates))
      : pickDefaultCohort(candidates);

    if (!selected) {
      return emptyOverview(options, year, yearStart, now, weeks);
    }

    const key: CohortKey = {
      subject: selected.subject,
      grade: selected.grade,
      syllabusVersion: selected.syllabusVersion,
    };

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
    ] = await sequential([
      // ---- activation: three counts, each a strict subset (cite "activated")
      //
      // Grade-scoped and not subject-scoped on purpose, and this is the one
      // place the three-part key cannot be fully honoured: a student who never
      // opened a session has touched no objective, so they have no subject yet.
      // Excluding them would make the funnel's first step its own last step.
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
          WHERE st.environment = $1 AND st.grade = $2`,
          [ENVIRONMENT, key.grade]
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
                                    WHERE environment = $1 AND grade = $2)
            GROUP BY w
            ORDER BY w`,
          [ENVIRONMENT, key.grade, weeks.map((x) => weekStart(x).toISOString())]
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
            GROUP BY s.student_id`,
          [ENVIRONMENT, key.grade]
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
                AND s.opened_at >= $3
           ) q
          WHERE mins >= 0`,
          [ENVIRONMENT, key.grade, yearStart.toISOString()]
        ),

      // ---- attempts and accuracy, over this subject's objectives only
      () =>
        db.query<{ attempts: string; correct: string }>(
          `SELECT count(*) AS attempts, count(*) FILTER (WHERE at.is_correct) AS correct
             FROM attempts at
             JOIN students st ON st.id = at.student_id
             JOIN questions q ON q.id = at.question_id
             JOIN node_subject ns ON ns.node_id = q.lo_id
            WHERE at.environment = $1 AND st.environment = $1
              AND st.grade = $2 AND ns.subject = $3
              AND at.attempted_at >= $4`,
          [ENVIRONMENT, key.grade, key.subject, yearStart.toISOString()]
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
                AND st.grade = $2 AND ns.subject = $3
                AND m.system_to IS NULL
              GROUP BY m.student_id
           )
           SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY mastered) AS median_objectives,
                  (SELECT count(*) FROM per_student) AS students,
                  (SELECT count(*) FROM node_subject WHERE subject = $3) AS objectives
             FROM per_student`,
          [ENVIRONMENT, key.grade, key.subject, MASTERY_THRESHOLD]
        ),

      // ---- cost per active student. `cost_daily` (closed days) rather than the
      //      ledger, because the same rollup feeds the cost page and two sources
      //      for one dollar figure is how two pages disagree.
      () =>
        db.query<{ total_usd: string | null; students: string; through_day: Date | null }>(
          `SELECT sum(cd.cost_usd) AS total_usd,
                  count(DISTINCT cd.student_id) AS students,
                  max(cd.day) AS through_day
             FROM cost_daily cd
             JOIN students st ON st.id = cd.student_id
            WHERE cd.environment = $1 AND st.environment = $1
              AND st.grade = $2 AND cd.day >= $3::date`,
          [ENVIRONMENT, key.grade, yearStart.toISOString()]
        ),

      // ---- cost: today's live spend for THIS cohort, straight off
      //      `ai_interactions` — the same UTC-day boundary `cost-queries.ts`
      //      uses for its own live-today half (`UTC_DAY`/`TODAY_UTC`,
      //      IMPORTED, not re-derived, so the two pages cannot draw that line
      //      in two places and quietly disagree). Grade-scoped like `costRows`
      //      above: cost has no subject column, so it has never been a
      //      three-key figure the way mastery and attempts are.
      () =>
        db.query<{ live_usd: string | null; live_students: string }>(
          `SELECT coalesce(sum(ai.cost_usd), 0) AS live_usd,
                  count(DISTINCT ai.student_id) AS live_students
             FROM ai_interactions ai
             JOIN students st ON st.id = ai.student_id
            WHERE ai.environment = $1 AND st.environment = $1 AND st.grade = $2
              AND ${UTC_DAY} = ${TODAY_UTC}`,
          [ENVIRONMENT, key.grade]
        ),

      // ---- cost: has the rollup EVER closed a day on this ENVIRONMENT, for
      //      any cohort? Deliberately not grade-scoped, unlike every query
      //      around it — `costRows.through_day` already answers "the most
      //      recent closed day for THIS cohort" and can be null while other
      //      grades have years of closed days. This is the other half:
      //      without it, a cohort with genuinely nothing yet is
      //      indistinguishable from a rollup that has never run at all, and
      //      those need different sentences (`costTileState`,
      //      overview-rules.ts).
      () =>
        db.query<{ through: string | null }>(
          `SELECT max(cd.day)::text AS through FROM cost_daily cd WHERE cd.environment = $1`,
          [ENVIRONMENT]
        ),

      // ---- the heatmap's rows: this subject's objectives in SYLLABUS order
      //      (module ordinal, then the objective's own), not alphabetical and
      //      not by id.
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
             JOIN graph_nodes lo ON lo.id = ns.node_id
             LEFT JOIN graph_edges te ON te.dst_id = lo.id AND te.edge_type = 'teaches'
                                     AND te.system_to IS NULL
             LEFT JOIN graph_nodes m ON m.id = te.src_id AND m.kind = 'module'
            WHERE ns.subject = $1
            ORDER BY m.order_in_parent NULLS LAST, lo.order_in_parent NULLS LAST, lo.id`,
          [key.subject]
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
                                    WHERE environment = $1 AND grade = $2)
            WHERE ns.subject = $5
            GROUP BY ns.node_id, w`,
          [ENVIRONMENT, key.grade, weekEnds, MASTERY_THRESHOLD, key.subject]
        ),
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
    masteryThreshold: MASTERY_THRESHOLD,
  };
}
