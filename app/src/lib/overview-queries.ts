import { sequential, withOperator } from "@/lib/db";
import { ENVIRONMENT } from "@/lib/env";
import {
  MASTERY_THRESHOLD,
  cite,
  heatCell,
  schoolWeekOf,
  schoolYearStart,
  weekKey,
  weeksBetween,
  weekStart,
  monthTwoRetention,
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

    const selected =
      options.find(
        (o) =>
          (!requested.subject || o.subject === requested.subject) &&
          (!requested.grade || o.grade === requested.grade) &&
          (!requested.syllabusVersion || o.syllabusVersion === requested.syllabusVersion)
      ) ?? options[0] ?? null;

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
    cost: { totalUsd: 0, activeStudents: 0, perActiveUsd: null, throughDay: null },
    heatmap: { objectives: [], weeks, weekKeys: weeks.map(weekKey), cells: [] },
    masteryThreshold: MASTERY_THRESHOLD,
  };
}
