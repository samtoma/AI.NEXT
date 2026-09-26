import { crossStudentReadAllowed } from "@/lib/auth/authorize";
import {
  canonicalGrade,
  isCourseVisible,
  type AvailabilityRule,
  type CurriculumSource,
  type StudentOverride,
  type SwitchedOff,
} from "@/lib/catalog";
import { COURSES, COURSE_IDS, type CourseId } from "@/lib/courses";
import { CURRICULUM_IDS, asCurriculumId, type CurriculumId } from "@/lib/curricula";
import { sequential, withOperator, type OperatorRole } from "@/lib/db";
import { COURSE_GATING, ENVIRONMENT } from "@/lib/env";
import { studentFeedback, type FeedbackNote } from "@/lib/feedback-queries";
import { sessionWallClockMs } from "@/lib/timeline-rules";
import { readSessionTurnLimits } from "@/lib/turn-threshold-queries";
import type { SessionTurnLimit } from "@/lib/turn-thresholds";

/**
 * The narrow client shape `withOperator` hands a callback, and the only shape
 * an `onRead` audit callback needs. Declared once here rather than inlined at
 * each call site so a read model and its audit row cannot drift into two
 * different ideas of what a database handle is.
 */
type Db = {
  query: (
    text: string,
    values?: readonly unknown[]
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
};

/**
 * The console's read models (contracts/admin.md view 1, FR-2108, FR-2211).
 *
 * Every query here runs under `withOperator` — `ainext_operator`, whose
 * cross-student visibility comes from migration 017's grants and policies
 * rather than from a bypass. Run the same SQL on the application connection
 * and it returns nothing at all: `ainext_app` has no policy that matches a row
 * belonging to a student who is not the principal, and no principal is set.
 * That is the intended difference and it is why the console has its own DSN.
 *
 * **`environment` is filtered before anything is grouped** (constitution XI,
 * FR-2407, FR-2109). A student list that blended the frozen baseline with the
 * comparison build would not be a longer list; it would be a wrong one, and a
 * cost figure computed over it would be a plausible wrong number used to set a
 * price.
 *
 * **Two projections, one query** (contracts/authorization.md): `student-data`
 * sees the whole row; `cost-billing` sees the commercial subset. The contract
 * says the `cost-billing` projection of this view carries no content column —
 * **this view has no content column in either projection**, which is stated
 * rather than left to be noticed: there is no message, no transcript, no
 * preview and no turn count of a conversation anywhere in it. What the
 * projection actually drops is gender and email-verification, which are the
 * student's own facts rather than the commercial ones, plus the link into
 * Student 360, which `cost-billing` may not open at all.
 *
 * The period is 30 days and every figure that depends on it says so on the
 * page. Cost is **imputed at list price** and is labelled that way wherever it
 * is rendered (research A4.4): the runtime is a Claude subscription, so no
 * money left a bank account per turn.
 *
 * n ≤ 200 in the pilot, so the per-student subqueries below are deliberate:
 * they keep the shape readable and the row count honest (a student with no
 * sessions is a row with a zero, never a missing row). At a volume where that
 * stops being true, P4's `cost_daily` rollup is the thing to join to.
 */

export const LIST_PERIOD_DAYS = 30;

export type StudentListProjection = "full" | "cost";

export type StudentListRow = {
  id: number;
  displayName: string;
  grade: string;
  /** `null` renders as "not set" — never as an assumed value (A9, FR-2605). */
  gender: string | null;
  /** `legacy` is the picker-era cast, retired by A10 and kept for its history. */
  studentStatus: string;
  /** `null` when the student has no account at all (every legacy row). */
  accountStatus: string | null;
  emailVerified: boolean | null;
  subscriptionStatus: string;
  /**
   * `students.curriculum_system` as stored, and how it was set (FR-4105) —
   * **the `full` projection only.** In the `cost` projection both are `null`
   * because they were never SELECTED: `cost-billing` reads no per-student
   * curriculum anywhere (FR-2406, privacy review F7), and a value that is not
   * read cannot be printed by mistake. `console-curriculum.test.mts` holds it.
   */
  curriculum: string | null;
  curriculumSource: CurriculumSource | null;
  /** Latest of the account's last sign-in and the last session opened. */
  lastSeenAt: string | null;
  sessionsInPeriod: number;
  /** US dollars, imputed at list price, over the period. */
  costUsdInPeriod: number;
};

/**
 * The curriculum columns, for the `student-data` projection only (FR-4105,
 * privacy review F7). A fragment rather than a SELECT-then-null, so the cost
 * projection's query does not carry the column at all.
 */
const CURRICULUM_COLUMNS = `st.curriculum_system, st.curriculum_source,`;

export type StudentList = {
  rows: StudentListRow[];
  projection: StudentListProjection;
  periodDays: number;
  environment: string;
};

export async function getStudentList(
  operatorId: number,
  projection: StudentListProjection,
  periodDays: number = LIST_PERIOD_DAYS
): Promise<StudentList> {
  const full = projection === "full";
  const rows = await withOperator(operatorId, async (db) => {
    const res = await db.query(
      `SELECT st.id,
              st.display_name,
              st.grade,
              ${full ? CURRICULUM_COLUMNS : ""}
              st.gender,
              st.status              AS student_status,
              st.subscription_status,
              a.status               AS account_status,
              (a.email_verified_at IS NOT NULL) AS email_verified,
              GREATEST(
                a.last_login_at,
                (SELECT max(ss.opened_at) FROM sessions ss
                  WHERE ss.student_id = st.id AND ss.environment = $1)
              ) AS last_seen_at,
              (SELECT count(*) FROM sessions ss
                WHERE ss.student_id = st.id AND ss.environment = $1
                  AND ss.opened_at >= now() - ($2 || ' days')::interval
              ) AS sessions_in_period,
              (SELECT coalesce(sum(ai.cost_usd), 0) FROM ai_interactions ai
                WHERE ai.student_id = st.id AND ai.environment = $1
                  AND ai.created_at >= now() - ($2 || ' days')::interval
              ) AS cost_usd_in_period
         FROM students st
         LEFT JOIN accounts a ON a.id = st.account_id
        WHERE st.environment = $1
        -- Most recently seen first: the question this list answers on a
        -- Tuesday morning is "who is using it", not "who signed up first".
        -- NULLS LAST keeps the never-seen at the bottom rather than the top.
        ORDER BY last_seen_at DESC NULLS LAST, st.display_name ASC`,
      [ENVIRONMENT, String(periodDays)]
    );
    return res.rows;
  });

  return {
    projection,
    periodDays,
    environment: ENVIRONMENT,
    rows: rows.map((r) => ({
      id: Number(r.id),
      displayName: String(r.display_name ?? ""),
      grade: String(r.grade ?? ""),
      curriculum: full && r.curriculum_system != null ? String(r.curriculum_system) : null,
      curriculumSource: full
        ? r.curriculum_source === "chosen"
          ? "chosen"
          : "implied"
        : null,
      gender: full ? ((r.gender as string | null) ?? null) : null,
      studentStatus: String(r.student_status ?? "active"),
      accountStatus: (r.account_status as string | null) ?? null,
      emailVerified: full ? Boolean(r.email_verified) : null,
      subscriptionStatus: String(r.subscription_status ?? "none"),
      lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at as string).toISOString() : null,
      sessionsInPeriod: Number(r.sessions_in_period ?? 0),
      costUsdInPeriod: Number(r.cost_usd_in_period ?? 0),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Student 360 — the profile header only, in P2                        */
/* ------------------------------------------------------------------ */

export type StudentProfileCard = {
  id: number;
  displayName: string;
  grade: string;
  gender: string | null;
  interests: string[];
  languagePref: string;
  curriculumSystem: string;
  studentStatus: string;
  accountStatus: string | null;
  emailVerified: boolean | null;
  subscriptionStatus: string;
  /** The operator's own note, if one was left. Never a payment reference (FR-2404). */
  subscriptionNote: string | null;
  subscriptionUpdatedAt: string | null;
  /** The operator who last changed it, by name (FR-2405). */
  subscriptionUpdatedBy: string | null;
  createdAt: string;
  lastSeenAt: string | null;
};

/**
 * The profile fields, as P2 read them on their own.
 *
 * **The function that read them is gone; the shape is not.** In P2 this page
 * was a profile header and an honest label saying the rest was P3's, so the
 * query was a profile query. `getStudent360` below now reads the profile in
 * the same transaction as the other ten result sets and the audit row, and a
 * second function that read the profile alone would be a second answer to
 * "what is on this page" — kept only because deleting a type is scarier than
 * deleting a query. The type stays because it is what `Student360.profile` is.
 */
/* ================================================================== */
/* Student 360 — the whole record, in one transaction (P3)            */
/* ================================================================== */

/**
 * Everything contracts/admin.md §2 lists, read in ONE `withOperator`
 * transaction with the audit row that records the read.
 *
 * **One transaction, not eleven calls.** The page needs eleven result sets and
 * an `operator_reads` row. If the audit were written by a twelfth call, a crash
 * between the tenth read and the audit would serve a child's whole record with
 * no record of who saw it — which is the exact failure FR-2306 exists to
 * prevent. Everything therefore commits together or not at all, and the audit
 * callback runs only after the profile row has come back: a 404 writes nothing,
 * because nothing was read.
 *
 * **Periods.** Mastery, attempts, cost and flags are **all time**, not a
 * window: this is the student's record, not a dashboard, and "accuracy over the
 * last 30 days" answers a question nobody asked when the pilot is eight weeks
 * long. Every figure the page renders says which period it covers regardless
 * (FR-2211), and "since the record was created" is a period.
 */
export type MasteryPoint = { at: string; score: number };

export type MasteryTrack = {
  loId: string;
  /** The objective's human label; the id is shown beside it, never alone. */
  loLabel: string | null;
  /** The current estimate — the open bitemporal row, or the last closed one. */
  current: number;
  /** First estimate, so "moved from → to" is readable without the chart. */
  first: number;
  /** `score` by `system_from` — the BKT trajectory, free from the bitemporal rows. */
  points: MasteryPoint[];
  lastMovedAt: string;
};

export type ObjectiveAccuracy = {
  loId: string | null;
  loLabel: string | null;
  attempts: number;
  correct: number;
  widgetAttempts: number;
  /** Milliseconds, summed `attempts.time_ms`. Null when none was recorded. */
  timeMs: number | null;
  lastAttemptAt: string | null;
};

export type TimeOnTask = {
  /** Summed `attempts.time_ms` — time inside questions. */
  attemptMs: number;
  /** How many attempts contributed; the rest recorded no duration. */
  attemptsWithTime: number;
  attemptsTotal: number;
  /** Summed wall clock of CLOSED sessions only. */
  sessionWallClockMs: number;
  closedSessions: number;
  openSessions: number;
};

export type HelpSeeking = {
  /** Tutor turns grouped by the objective the session was about. */
  byObjective: { loId: string | null; loLabel: string | null; turns: number }[];
  turnsWithNoSession: number;
  uploads: number;
  uploadsParsed: number;
};

export type MisconceptionCount = {
  id: string;
  label: string | null;
  count: number;
  lastSeenAt: string;
};

export type CheckOutcome = {
  id: number;
  sessionId: number | null;
  loId: string;
  loLabel: string | null;
  mode: string;
  score: number;
  verdict: string;
  createdAt: string;
};

export type CostToDate = {
  usd: number;
  turns: number;
  firstTurnAt: string | null;
  lastTurnAt: string | null;
};

/** FR-2508: the table deliberately holds nothing else, and nor does this. */
export type SafetyFlag = { flagType: string; occurredAt: string };

export type SignIn = {
  event: string;
  outcome: string | null;
  occurredAt: string;
  /** Present only when the event carried one; never inferred. */
  ip: string | null;
};

export type OperatorReadRow = {
  operatorName: string;
  operatorEmail: string;
  surface: string;
  sessionId: number | null;
  occurredAt: string;
  reason: string | null;
};

export type Student360 = {
  profile: StudentProfileCard;
  mastery: MasteryTrack[];
  accuracy: ObjectiveAccuracy[];
  timeOnTask: TimeOnTask;
  helpSeeking: HelpSeeking;
  misconceptions: MisconceptionCount[];
  checks: CheckOutcome[];
  cost: CostToDate;
  safetyFlags: SafetyFlag[];
  signIns: SignIn[];
  audit: OperatorReadRow[];
  /**
   * This student's own feedback, newest first (FR-2809, migration 025).
   *
   * It rides on the 360 rather than on a panel that fetches for itself,
   * because the 360 is already one `withOperator` transaction and a second
   * connection for one small read on a page this heavy would be a cost with
   * no property behind it. The read itself lives in `lib/feedback-queries.ts`
   * — the one module that touches the table — and is called with this unit of
   * work's client.
   */
  feedback: FeedbackNote[];
  sessionCount: number;
  environment: string;
};

/** How many rows the two history panels show before they stop. */
const HISTORY_LIMIT = 25;

export async function getStudent360(
  operatorId: number,
  studentId: number,
  onRead: (db: Db) => Promise<void>
): Promise<Student360 | null> {
  return withOperator(operatorId, async (db) => {
    const profileRow = await db.query(
      `SELECT st.id, st.display_name, st.grade, st.gender, st.interests,
              st.language_pref, st.curriculum_system, st.status AS student_status,
              st.subscription_status, st.created_at, st.account_id,
              -- FR-2405: the status is never shown without who last changed it
              -- and when. An operator id resolves to a name here rather than on
              -- the page, so a status with an author cannot render as a status
              -- with nobody's.
              st.subscription_note, st.subscription_updated_at,
              op.display_name AS subscription_updated_by,
              a.status AS account_status,
              (a.email_verified_at IS NOT NULL) AS email_verified,
              GREATEST(
                a.last_login_at,
                (SELECT max(ss.opened_at) FROM sessions ss
                  WHERE ss.student_id = st.id AND ss.environment = $2)
              ) AS last_seen_at
         FROM students st
         LEFT JOIN accounts a ON a.id = st.account_id
         LEFT JOIN operators op ON op.id = st.subscription_updated_by
        WHERE st.id = $1 AND st.environment = $2`,
      [studentId, ENVIRONMENT]
    );
    const p = profileRow.rows[0];
    if (!p) return null;
    const accountId = p.account_id == null ? null : Number(p.account_id);

    // Eleven independent reads, one shared client: `Promise.all` here would
    // fan them out concurrently on the SAME `PoolClient`, which pg tolerates
    // today by queuing them and pg@9 refuses outright. `sequential` keeps the
    // fixed-order, fixed-type tuple this destructure relies on and just runs
    // them one at a time instead.
    const [
      masteryRes,
      accuracyRes,
      timeRes,
      helpRes,
      uploadRes,
      miscRes,
      checkRes,
      costRes,
      flagRes,
      signInRes,
      auditRes,
    ] = await sequential([
      // Mastery is BITEMPORAL, so the trajectory is already stored: every
      // revision of an estimate is its own row with its own `system_from`
      // (admin.md §2 — "free"). Nothing is recomputed and nothing is sampled.
      () =>
        db.query(
          `SELECT m.lo_id, m.score, m.system_from, m.system_to, n.label AS lo_label
           FROM mastery m
           LEFT JOIN graph_nodes n ON n.id = m.lo_id
          WHERE m.student_id = $1 AND m.environment = $2
          ORDER BY m.lo_id ASC, m.system_from ASC, m.id ASC`,
          [studentId, ENVIRONMENT]
        ),
      () =>
        db.query(
          `SELECT q.lo_id, n.label AS lo_label,
                count(*)                                   AS attempts,
                count(*) FILTER (WHERE a.is_correct)       AS correct,
                count(*) FILTER (WHERE a.modality = 'widget') AS widget_attempts,
                sum(a.time_ms)                             AS time_ms,
                max(a.attempted_at)                        AS last_attempt_at
           FROM attempts a
           LEFT JOIN questions q   ON q.id = a.question_id
           LEFT JOIN graph_nodes n ON n.id = q.lo_id
          WHERE a.student_id = $1 AND a.environment = $2
          GROUP BY q.lo_id, n.label
          ORDER BY attempts DESC, q.lo_id ASC`,
          [studentId, ENVIRONMENT]
        ),
      // The two time numbers come back as two columns from two tables and are
      // never added together (admin.md §2). One is time inside questions, the
      // other is how long the sittings lasted; their difference is reading,
      // thinking and walking away, which is why blending them destroys both.
      () =>
        db.query(
          `SELECT
           (SELECT coalesce(sum(a.time_ms), 0) FROM attempts a
             WHERE a.student_id = $1 AND a.environment = $2)            AS attempt_ms,
           (SELECT count(*) FROM attempts a
             WHERE a.student_id = $1 AND a.environment = $2
               AND a.time_ms IS NOT NULL)                               AS attempts_with_time,
           (SELECT count(*) FROM attempts a
             WHERE a.student_id = $1 AND a.environment = $2)             AS attempts_total,
           (SELECT coalesce(sum(extract(epoch FROM (s.closed_at - s.opened_at)) * 1000), 0)
              FROM sessions s
             WHERE s.student_id = $1 AND s.environment = $2
               AND s.closed_at IS NOT NULL)                              AS wall_ms,
           (SELECT count(*) FROM sessions s
             WHERE s.student_id = $1 AND s.environment = $2
               AND s.closed_at IS NOT NULL)                              AS closed_sessions,
           (SELECT count(*) FROM sessions s
             WHERE s.student_id = $1 AND s.environment = $2
               AND s.closed_at IS NULL)                                  AS open_sessions,
           (SELECT count(*) FROM sessions s
             WHERE s.student_id = $1 AND s.environment = $2)             AS sessions_total`,
          [studentId, ENVIRONMENT]
        ),
      () =>
        db.query(
          `SELECT s.lo_id, n.label AS lo_label, count(ai.id) AS turns
           FROM ai_interactions ai
           JOIN sessions s         ON s.id = ai.session_id
           LEFT JOIN graph_nodes n ON n.id = s.lo_id
          WHERE ai.student_id = $1 AND ai.environment = $2
          GROUP BY s.lo_id, n.label
          ORDER BY turns DESC`,
          [studentId, ENVIRONMENT]
        ),
      () =>
        db.query(
          `SELECT
           (SELECT count(*) FROM uploads u
             WHERE u.student_id = $1 AND u.environment = $2)             AS uploads,
           (SELECT count(*) FROM uploads u
             WHERE u.student_id = $1 AND u.environment = $2
               AND u.parse_status = 'parsed')                            AS uploads_parsed,
           -- FR-2309: an interaction with no session is shown AS having none.
           (SELECT count(*) FROM ai_interactions ai
             WHERE ai.student_id = $1 AND ai.environment = $2
               AND ai.session_id IS NULL)                                AS turns_no_session`,
          [studentId, ENVIRONMENT]
        ),
      () =>
        db.query(
          `SELECT a.misconception_id, mc.label, count(*) AS n,
                max(a.attempted_at) AS last_seen_at
           FROM attempts a
           LEFT JOIN misconceptions mc ON mc.id = a.misconception_id
          WHERE a.student_id = $1 AND a.environment = $2
            AND a.misconception_id IS NOT NULL
          GROUP BY a.misconception_id, mc.label
          ORDER BY n DESC, last_seen_at DESC`,
          [studentId, ENVIRONMENT]
        ),
      () =>
        db.query(
          `SELECT u.id, u.session_id, u.lo_id, u.mode, u.score, u.verdict,
                u.created_at, n.label AS lo_label
           FROM understanding_checks u
           LEFT JOIN graph_nodes n ON n.id = u.lo_id
          WHERE u.student_id = $1 AND u.environment = $2
          ORDER BY u.created_at DESC
          LIMIT ${HISTORY_LIMIT}`,
          [studentId, ENVIRONMENT]
        ),
      () =>
        db.query(
          `SELECT coalesce(sum(ai.cost_usd), 0) AS usd, count(*) AS turns,
                min(ai.created_at) AS first_at, max(ai.created_at) AS last_at
           FROM ai_interactions ai
          WHERE ai.student_id = $1 AND ai.environment = $2`,
          [studentId, ENVIRONMENT]
        ),
      // FR-2508: type and time. `dispatched` is deliberately NOT selected —
      // the console is not the human channel and must not become a place a
      // flag is triaged, or the separate immediate path quietly becomes a
      // queue somebody checks on Monday.
      () =>
        db.query(
          `SELECT f.flag_type, f.created_at
           FROM safety_flags f
          WHERE f.student_id = $1 AND f.environment = $2
          ORDER BY f.created_at DESC
          LIMIT ${HISTORY_LIMIT}`,
          [studentId, ENVIRONMENT]
        ),
      () =>
        accountId == null
          ? Promise.resolve({ rows: [] as Record<string, unknown>[], rowCount: 0 })
          : db.query(
              `SELECT e.event, e.outcome, e.occurred_at, e.ip_address
               FROM auth_events e
              WHERE e.environment = $2
                AND e.actor_kind = 'account' AND e.actor_id = $1
              ORDER BY e.occurred_at DESC
              LIMIT ${HISTORY_LIMIT}`,
              [accountId, ENVIRONMENT]
            ),
      // The audit panel: who has opened this student's record (admin.md §7 —
      // "an audit nobody can see is an audit nobody checks"). It shows the
      // reader their own reads too, which is the point.
      () =>
        db.query(
          `SELECT r.surface, r.session_id, r.occurred_at, r.reason,
                o.display_name, o.email
           FROM operator_reads r
           LEFT JOIN operators o ON o.id = r.operator_id
          WHERE r.student_id = $1 AND r.environment = $2
          ORDER BY r.occurred_at DESC
          LIMIT ${HISTORY_LIMIT}`,
          [studentId, ENVIRONMENT]
        ),
    ] as const);

    // Outside the `sequential` tuple rather than inside it, because it is not a
    // query written here: `lib/feedback-queries.ts` owns every statement that
    // touches `feedback`, and keeping that true is what lets
    // `feedback-isolation.test.mts` make a claim about one file instead of a
    // claim about the whole codebase. It still runs on THIS client, so it is
    // one more statement in the same transaction.
    const feedbackRows = await studentFeedback(db, studentId, HISTORY_LIMIT);

    // Written last and inside the same transaction as all of the above.
    await onRead(db);

    const t = timeRes.rows[0] ?? {};
    const c = costRes.rows[0] ?? {};
    const h = uploadRes.rows[0] ?? {};

    return {
      profile: {
        id: Number(p.id),
        displayName: String(p.display_name ?? ""),
        grade: String(p.grade ?? ""),
        gender: (p.gender as string | null) ?? null,
        interests: (p.interests as string[] | null) ?? [],
        languagePref: String(p.language_pref ?? "en"),
        curriculumSystem: String(p.curriculum_system ?? ""),
        studentStatus: String(p.student_status ?? "active"),
        accountStatus: (p.account_status as string | null) ?? null,
        emailVerified: p.email_verified == null ? null : Boolean(p.email_verified),
        subscriptionStatus: String(p.subscription_status ?? "none"),
        subscriptionNote: (p.subscription_note as string | null) ?? null,
        subscriptionUpdatedAt: p.subscription_updated_at
          ? new Date(p.subscription_updated_at as string).toISOString()
          : null,
        subscriptionUpdatedBy: (p.subscription_updated_by as string | null) ?? null,
        createdAt: new Date(p.created_at as string).toISOString(),
        lastSeenAt: p.last_seen_at ? new Date(p.last_seen_at as string).toISOString() : null,
      },
      mastery: groupMastery(masteryRes.rows),
      accuracy: accuracyRes.rows.map((r) => ({
        loId: (r.lo_id as string | null) ?? null,
        loLabel: (r.lo_label as string | null) ?? null,
        attempts: Number(r.attempts ?? 0),
        correct: Number(r.correct ?? 0),
        widgetAttempts: Number(r.widget_attempts ?? 0),
        timeMs: r.time_ms == null ? null : Number(r.time_ms),
        lastAttemptAt: r.last_attempt_at
          ? new Date(r.last_attempt_at as string).toISOString()
          : null,
      })),
      timeOnTask: {
        attemptMs: Number(t.attempt_ms ?? 0),
        attemptsWithTime: Number(t.attempts_with_time ?? 0),
        attemptsTotal: Number(t.attempts_total ?? 0),
        sessionWallClockMs: Number(t.wall_ms ?? 0),
        closedSessions: Number(t.closed_sessions ?? 0),
        openSessions: Number(t.open_sessions ?? 0),
      },
      helpSeeking: {
        byObjective: helpRes.rows.map((r) => ({
          loId: (r.lo_id as string | null) ?? null,
          loLabel: (r.lo_label as string | null) ?? null,
          turns: Number(r.turns ?? 0),
        })),
        turnsWithNoSession: Number(h.turns_no_session ?? 0),
        uploads: Number(h.uploads ?? 0),
        uploadsParsed: Number(h.uploads_parsed ?? 0),
      },
      misconceptions: miscRes.rows.map((r) => ({
        id: String(r.misconception_id ?? ""),
        label: (r.label as string | null) ?? null,
        count: Number(r.n ?? 0),
        lastSeenAt: new Date(r.last_seen_at as string).toISOString(),
      })),
      checks: checkRes.rows.map((r) => ({
        id: Number(r.id),
        sessionId: r.session_id == null ? null : Number(r.session_id),
        loId: String(r.lo_id ?? ""),
        loLabel: (r.lo_label as string | null) ?? null,
        mode: String(r.mode ?? ""),
        score: Number(r.score ?? 0),
        verdict: String(r.verdict ?? ""),
        createdAt: new Date(r.created_at as string).toISOString(),
      })),
      cost: {
        usd: Number(c.usd ?? 0),
        turns: Number(c.turns ?? 0),
        firstTurnAt: c.first_at ? new Date(c.first_at as string).toISOString() : null,
        lastTurnAt: c.last_at ? new Date(c.last_at as string).toISOString() : null,
      },
      safetyFlags: flagRes.rows.map((r) => ({
        flagType: String(r.flag_type ?? ""),
        occurredAt: new Date(r.created_at as string).toISOString(),
      })),
      signIns: signInRes.rows.map((r) => ({
        event: String(r.event ?? ""),
        outcome: (r.outcome as string | null) ?? null,
        occurredAt: new Date(r.occurred_at as string).toISOString(),
        ip: r.ip_address == null ? null : String(r.ip_address),
      })),
      audit: auditRes.rows.map((r) => ({
        operatorName: String(r.display_name ?? "an operator since removed"),
        operatorEmail: String(r.email ?? ""),
        surface: String(r.surface ?? ""),
        sessionId: r.session_id == null ? null : Number(r.session_id),
        occurredAt: new Date(r.occurred_at as string).toISOString(),
        reason: (r.reason as string | null) ?? null,
      })),
      feedback: feedbackRows,
      sessionCount: Number(t.sessions_total ?? 0),
      environment: ENVIRONMENT,
    };
  });
}

/**
 * One row per objective, with its estimates in order.
 *
 * Done in TypeScript rather than in SQL because the shape is a nesting, not an
 * aggregate: a `json_agg` would produce the same thing less legibly and would
 * have to be un-parsed here anyway. The rows arrive already ordered by
 * `(lo_id, system_from)`, so this is a single pass.
 */
function groupMastery(rows: Record<string, unknown>[]): MasteryTrack[] {
  const byLo = new Map<string, MasteryTrack>();
  for (const r of rows) {
    const loId = String(r.lo_id ?? "");
    const score = Number(r.score ?? 0);
    const at = new Date(r.system_from as string).toISOString();
    const existing = byLo.get(loId);
    if (!existing) {
      byLo.set(loId, {
        loId,
        loLabel: (r.lo_label as string | null) ?? null,
        current: score,
        first: score,
        points: [{ at, score }],
        lastMovedAt: at,
      });
      continue;
    }
    existing.points.push({ at, score });
    existing.current = score;
    existing.lastMovedAt = at;
  }
  // Most-moved first: an objective with one estimate has no trajectory to
  // read, and the reason to open this panel is to see where a student is
  // moving. Ties fall back to the current estimate, lowest first — the
  // objective that needs attention.
  return [...byLo.values()].sort(
    (a, b) => b.points.length - a.points.length || a.current - b.current
  );
}

/* ================================================================== */
/* The session list (contracts/admin.md §3) — metadata only            */
/* ================================================================== */

export type SessionListRow = {
  id: number;
  kind: string;
  surface: string | null;
  loId: string | null;
  loLabel: string | null;
  openedAt: string;
  closedAt: string | null;
  closeReason: string | null;
  wallClockMs: number | null;
  turns: number;
  attempts: number;
  /** Distinct objectives touched by the attempts in the session. */
  objectivesTouched: number;
  costUsd: number;
  /** The release that opened it (ADR-0021); null = opened before v0.7.0. */
  releaseTag: string | null;
  /** Its probing snapshot (ADR-0021); null = opened before v0.7.0. */
  probing: boolean | null;
  /**
   * A conversation in it at or past its surface's reply threshold, counted to
   * the end of this session (ADR-0023, FR-3405); null when none was. A count,
   * not content — the list stays metadata only.
   */
  turnLimit: SessionTurnLimit | null;
};

/**
 * Metadata only, **and that is the point** (admin.md §3, research A6).
 *
 * Not one message, not one preview, not one first line. Opening this list is
 * not a transcript read, so it writes **no `operator_reads` row** — which is
 * what keeps the audit's unit meaningful. If browsing a student's sessions
 * logged a read, every row in `operator_reads` would mean "somebody looked at a
 * list", the surfaces that mean "somebody read a child's conversation" would be
 * lost in them, and the one panel that makes ADR-0014's highest-privilege role
 * grantable would stop being worth reading.
 *
 * That guarantee is only true because there is nothing here to read. Adding a
 * content column to this view is not a UI change; it is a change to what the
 * audit means, and it needs the audit row added in the same commit.
 */
export async function getStudentSessions(
  operatorId: number,
  studentId: number
): Promise<{ student: { id: number; displayName: string }; rows: SessionListRow[] } | null> {
  return withOperator(operatorId, async (db) => {
    const who = await db.query(
      `SELECT id, display_name FROM students WHERE id = $1 AND environment = $2`,
      [studentId, ENVIRONMENT]
    );
    if (!who.rows[0]) return null;

    const res = await db.query(
      `SELECT s.id, s.kind, s.surface, s.lo_id, s.opened_at, s.closed_at, s.close_reason,
              s.release_tag, s.probing,
              n.label AS lo_label,
              (SELECT count(*) FROM ai_interactions ai
                WHERE ai.session_id = s.id AND ai.environment = $2)        AS turns,
              (SELECT count(*) FROM attempts a
                WHERE a.session_id = s.id AND a.environment = $2)          AS attempts,
              (SELECT count(DISTINCT q.lo_id) FROM attempts a
                 JOIN questions q ON q.id = a.question_id
                WHERE a.session_id = s.id AND a.environment = $2)          AS objectives_touched,
              (SELECT coalesce(sum(ai.cost_usd), 0) FROM ai_interactions ai
                WHERE ai.session_id = s.id AND ai.environment = $2)        AS cost_usd
         FROM sessions s
         LEFT JOIN graph_nodes n ON n.id = s.lo_id
        WHERE s.student_id = $1 AND s.environment = $2
        ORDER BY s.opened_at DESC`,
      [studentId, ENVIRONMENT]
    );
    // The turn-threshold chips (FR-3405): one more read on the same client,
    // after the one above has finished, never beside it (`lib/db.ts`).
    const limits = await readSessionTurnLimits(db, studentId);

    return {
      student: {
        id: Number(who.rows[0].id),
        displayName: String(who.rows[0].display_name ?? ""),
      },
      rows: res.rows.map((r) => {
        const openedAt = new Date(r.opened_at as string).toISOString();
        const closedAt = r.closed_at ? new Date(r.closed_at as string).toISOString() : null;
        return {
          id: Number(r.id),
          kind: String(r.kind ?? ""),
          surface: (r.surface as string | null) ?? null,
          loId: (r.lo_id as string | null) ?? null,
          loLabel: (r.lo_label as string | null) ?? null,
          openedAt,
          closedAt,
          closeReason: (r.close_reason as string | null) ?? null,
          wallClockMs: sessionWallClockMs(openedAt, closedAt),
          turns: Number(r.turns ?? 0),
          attempts: Number(r.attempts ?? 0),
          objectivesTouched: Number(r.objectives_touched ?? 0),
          costUsd: Number(r.cost_usd ?? 0),
          releaseTag: (r.release_tag as string | null) ?? null,
          probing: r.probing == null ? null : r.probing === true,
          turnLimit: limits.get(Number(r.id)) ?? null,
        };
      }),
    };
  });
}

/** The operator's own name and roles, for the console header. */
export async function getOperatorCard(
  operatorId: number
): Promise<{ displayName: string; email: string } | null> {
  return withOperator(operatorId, async (db) => {
    const res = await db.query(
      `SELECT display_name, email FROM operators WHERE id = $1`,
      [operatorId]
    );
    const r = res.rows[0];
    if (!r) return null;
    return { displayName: String(r.display_name ?? ""), email: String(r.email ?? "") };
  });
}

/* ================================================================== */
/* Feature 003 — curricula on the console                              */
/* ================================================================== */

/**
 * Per (curriculum, grade), HOW MANY students would have nothing to study if
 * that curriculum had no live course for that grade (FR-4103; privacy review
 * F9; contracts/console.md).
 *
 * `/courses` asks this before a change hides the last live course of a
 * curriculum for a grade: the cell turns into an in-page question stating the
 * number. **A count and nothing else.** `/courses` is `content-review`'s page,
 * and that role must not learn a student's name or id from a content decision
 * (FR-2707) — so the query SELECTs a grade, a curriculum and `count(*)`, the
 * return type holds numbers only, and `course-count-guard.test.mts` fails if
 * this function or the view that prints it could carry a name or an id.
 *
 * **Gated by `CROSS_STUDENT_READS`** (`last_live_course_headcount`, owned by
 * `content-review`): an operator without the role gets `null` and no query
 * runs. It is a deliberate cross-student read, so it is enumerated, not
 * implicit (FR-2108).
 *
 * What "nothing to study" means, exactly: with the curriculum's last live
 * course for the grade hidden, no grade rule shows her anything of her own
 * curriculum, so she sees only what an exception grants (`lib/catalog.ts`,
 * step 1). A student who holds ANY live exception still has something and is
 * not counted; one who holds none is. A retired picker-era record
 * (`status = 'legacy'`) has no account and studies nothing either way, so it
 * is not counted. Grades are folded onto the canonical spelling (`prep-3` is
 * grade 9), and a stored curriculum the registry does not know is left out —
 * no rule can reach that student anyway (FR-4003).
 *
 * No `operator_reads` row: nothing here names a student, which is the whole
 * point of the entry's "count only".
 */
export type CurriculumHeadcounts = Partial<Record<CurriculumId, Record<string, number>>>;

export async function lastLiveCourseHeadcount(
  operatorId: number,
  roles: readonly OperatorRole[]
): Promise<CurriculumHeadcounts | null> {
  if (!crossStudentReadAllowed("last_live_course_headcount", roles)) return null;
  const rows = await withOperator(operatorId, async (db) => {
    const res = await db.query(
      `SELECT st.grade, st.curriculum_system, count(*) AS students
         FROM students st
        WHERE st.environment = $1
          AND coalesce(st.status, 'active') <> 'legacy'
          AND NOT EXISTS (
                SELECT 1 FROM student_course_access sca
                 WHERE sca.environment = $1
                   AND sca.student_id = st.id
                   AND sca.state = 'live')
        GROUP BY st.grade, st.curriculum_system`,
      [ENVIRONMENT]
    );
    return res.rows;
  });
  return foldHeadcounts(rows);
}

/** `lastLiveCourseHeadcount`'s arithmetic, pure: (grade, curriculum, n) rows
 *  folded onto canonical grades and known curricula. Exported for its test. */
export function foldHeadcounts(rows: readonly Record<string, unknown>[]): CurriculumHeadcounts {
  const out: CurriculumHeadcounts = {};
  for (const r of rows) {
    const curriculum = asCurriculumId(r.curriculum_system);
    const grade = canonicalGrade(r.grade == null ? null : String(r.grade));
    if (!curriculum || !grade) continue;
    const byGrade = (out[curriculum] ??= {});
    byGrade[grade] = (byGrade[grade] ?? 0) + Number(r.students ?? 0);
  }
  return out;
}

/**
 * What one student WOULD see under each curriculum the registry knows — for
 * the Student 360's curriculum editor, which must name the courses she will
 * stop and start seeing before anything is written (FR-4010, FR-2710).
 *
 * Decided by `isCourseVisible` itself (`lib/catalog.ts`), over this
 * environment's rules and her own exceptions, exactly as the student gate
 * decides it — so the confirmation cannot promise an answer the product does
 * not give. With the kill switch off, "live" is "loaded" (FR-4015), as it is
 * for her. `current` is what she sees today with the value AS STORED, so an
 * unknown value correctly sees only what an exception grants (FR-4003).
 *
 * **No `operator_reads` row**, for the reason `studentAccess` gives
 * (`lib/catalog-queries.ts`): its callers are the Student 360, which has
 * already recorded this read in the same render, and the curriculum endpoint
 * that the 360 posts to. A caller anywhere else must record its own.
 */
export type CurriculumProjection = {
  /** her grade, canonical (`prep-3` → `9`), or null when she has none */
  grade: string | null;
  /** `students.curriculum_system` as stored */
  stored: string;
  /** registry courses she sees today, registry order */
  current: CourseId[];
  /** registry courses she would see if her curriculum were each of these */
  byCurriculum: Record<CurriculumId, CourseId[]>;
};

export async function curriculumProjection(
  operatorId: number,
  studentId: number
): Promise<CurriculumProjection | null> {
  const read = await withOperator(operatorId, async (db) => {
    const who = await db.query(
      `SELECT grade, curriculum_system FROM students WHERE id = $1 AND environment = $2`,
      [studentId, ENVIRONMENT]
    );
    if (!who.rows[0]) return null;
    const [ruleRes, overrideRes, loadedRes] = await sequential([
      () =>
        db.query(`SELECT course_id, grade, state FROM course_availability WHERE environment = $1`, [
          ENVIRONMENT,
        ]),
      () =>
        db.query(
          `SELECT course_id, state FROM student_course_access
            WHERE environment = $1 AND student_id = $2`,
          [ENVIRONMENT, studentId]
        ),
      () =>
        COURSE_GATING
          ? Promise.resolve({ rows: [] as Record<string, unknown>[] })
          : db.query(`SELECT id FROM graph_nodes WHERE kind = 'course'`),
    ] as const);
    return {
      student: who.rows[0],
      rules: ruleRes.rows,
      overrides: overrideRes.rows,
      loaded: loadedRes.rows,
    };
  });
  if (!read) return null;
  const rules: AvailabilityRule[] = read.rules.map((r) => ({
    courseId: String(r.course_id),
    grade: String(r.grade),
    state: r.state === "live" ? "live" : "hidden",
  }));
  const overrides: StudentOverride[] = read.overrides.map((r) => ({
    courseId: String(r.course_id),
    state: r.state === "live" ? "live" : "hidden",
  }));
  const switchedOff: SwitchedOff | undefined = COURSE_GATING
    ? undefined
    : { loaded: new Set(read.loaded.map((r) => String(r.id))) };
  const grade = canonicalGrade(read.student.grade == null ? null : String(read.student.grade));
  const stored = String(read.student.curriculum_system ?? "");
  return projectCurricula({ grade, stored, rules, overrides, switchedOff });
}

/** `curriculumProjection`'s decision, pure — every registry course through
 *  the gate's own `isCourseVisible`, once per curriculum. Exported for its test. */
export function projectCurricula(input: {
  grade: string | null;
  stored: string;
  rules: readonly AvailabilityRule[];
  overrides: readonly StudentOverride[];
  switchedOff?: SwitchedOff;
}): CurriculumProjection {
  const sees = (curriculum: string) =>
    COURSE_IDS.filter((id) =>
      isCourseVisible(id, { grade: input.grade, curriculum }, input.rules, input.overrides, input.switchedOff)
    );
  return {
    grade: input.grade,
    stored: input.stored,
    current: sees(input.stored),
    byCurriculum: Object.fromEntries(CURRICULUM_IDS.map((c) => [c, sees(c)])) as Record<
      CurriculumId,
      CourseId[]
    >,
  };
}

/**
 * The registry courses this database holds, grouped by curriculum, for the
 * console footer (003, T378, FR-4104): the shell used to print "Prep-3
 * Mathematics" on every page, which stopped being the whole truth the day a
 * second curriculum's book could be loaded. Corpus data (`graph_nodes`), no
 * student anywhere; a course the registry does not know is left out.
 */
export async function loadedCurricula(
  operatorId: number
): Promise<{ curriculum: CurriculumId; courses: CourseId[] }[]> {
  const ids = await withOperator(operatorId, async (db) => {
    const res = await db.query(`SELECT id FROM graph_nodes WHERE kind = 'course'`);
    return new Set(res.rows.map((r) => String(r.id)));
  });
  return CURRICULUM_IDS.map((curriculum) => ({
    curriculum,
    courses: COURSE_IDS.filter((id) => ids.has(id) && COURSES[id].curriculum === curriculum),
  })).filter((g) => g.courses.length > 0);
}

