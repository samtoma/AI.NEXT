import { sequential, withOperator } from "@/lib/db";
import { ENVIRONMENT } from "@/lib/env";
import {
  CROSS_STUDENT_WINDOW_MS,
  IP_THRESHOLD,
  LOCK_THRESHOLD,
  OPERATOR_THRESHOLD,
} from "@/lib/alerts";

/**
 * The security view's read model (contracts/admin.md §7, research A5, ADR-0016
 * §6, FR-2502, FR-2509, SC-105).
 *
 * Six tiles, an explorable events list, the sign-in story and the operator-read
 * audit, all over `auth_events` and the tables that give its ids names. Nothing
 * here is cached, materialised or rolled up: SC-105 says an attempt is visible
 * within sixty seconds, and the cheapest way to be sure of that is to have
 * nothing between the page and the table. At pilot volume the whole view is
 * thirteen index scans (see the query count note on `getSecurityView` below).
 *
 * ---------------------------------------------------------------------------
 * THE LIST BECOMES EXPLORABLE — FILTERS, AND WHY THEY ARE ALL QUERY PARAMETERS
 * ---------------------------------------------------------------------------
 * Samuel's ask was blunt: the list is hard to work with, and he wants to filter
 * "who has opened this student's record, and sign in history". Both are already
 * `auth_events` rows wearing different hats, so nothing new is stored — the
 * events list gains dimensions (kind, who, outcome, when, page) that combine
 * with `AND`, and the operator-read audit gains the same "who" pair over its
 * own two columns. `page.console.tsx`'s `EventFilter`/`FilterLink` docblock
 * states the rule this file exists to serve: **a filter is a link carrying a
 * query parameter, never client state**, because an operator investigating an
 * incident needs to paste the URL that produced a result into a report, not
 * describe which buttons they clicked. `parseSecurityFilters` is the one place
 * a raw `searchParams` object becomes a typed, validated filter set — pure, so
 * it is exercisable without a database, same as `cost-model.ts`'s `periodOf`.
 *
 * **The sign-in story is a filtered MODE of this same list, not a second
 * table.** `signins=1` swaps the single-event equality for a curated
 * `event = ANY(...)` over the handful of kinds that make up "the sign-in
 * story" (successful and failed sign-ins on both surfaces, lockouts and their
 * release, session revocations) and turns off the single-event filter, which
 * would otherwise fight it over the same SQL slot. A second panel would have
 * needed its own pagination, its own "who" filter, its own empty-state copy —
 * every property this file already gives the list, duplicated and free to
 * drift from it. A mode costs one array constant and one query-string flag.
 *
 * ---------------------------------------------------------------------------
 * THE SAME THREE RULES `lib/cost-queries.ts` STATES, FOR THE SAME REASONS
 * ---------------------------------------------------------------------------
 *  1. **`withOperator`, never `withMaint`.** The reads are cross-student by
 *     construction — "who tried to get in" is a table with everybody in it — and
 *     `ainext_app` holds INSERT on `auth_events` and **no SELECT at all**, so a
 *     security view on the application role would render six empty tiles, which
 *     reads as "nothing happened" rather than as "misconfigured".
 *  2. **Environment first, always** (constitution XI, FR-2509). A security
 *     figure that blended the frozen baseline's sign-ins with the comparison
 *     build's would be a count about neither stack.
 *  3. **Sequential, never `Promise.all`.** Every query below shares ONE client
 *     inside the `withOperator` callback; pg@9 removed the implicit queuing
 *     that used to make concurrent calls on one client work (`lib/db.ts`).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DELIBERATELY DOES NOT SELECT
 * ---------------------------------------------------------------------------
 * `accounts.password_hash` — `ainext_operator` holds a column-level SELECT that
 * excludes it, so a query here asking for it would fail rather than succeed
 * quietly. No message, no transcript, no attempt, no mastery value: this is the
 * security surface, and a child's learning has no business on it. The only
 * student datum that appears is a display name beside an account id, because
 * FR-2211 forbids showing an identifier alone.
 *
 * And **no password material, in any tile** — `auth_events.reason` is a short
 * machine token by construction (migration 016) and is rendered as one.
 */

/* --------------------------------------------------------------- filters */

/**
 * The time-window vocabulary the list's "When" links offer, one hour to
 * everything. `24h` is the default: at pilot volume it is close enough to
 * "all" to rarely surprise a reader, and it is the window SC-105's own
 * sixty-second freshness claim is actually about — a security view that
 * defaulted to thirty days would bury this morning's attempt on page one
 * instead of making it the first row.
 */
export const TIME_WINDOWS = ["1h", "24h", "7d", "30d", "all"] as const;
export type TimeWindow = (typeof TIME_WINDOWS)[number];
export const DEFAULT_WINDOW: TimeWindow = "24h";

export const WINDOW_LABEL: Readonly<Record<TimeWindow, string>> = {
  "1h": "last hour",
  "24h": "last 24 hours",
  "7d": "last 7 days",
  "30d": "last 30 days",
  all: "all time",
};

const WINDOW_MS: Readonly<Record<Exclude<TimeWindow, "all">, number>> = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
};

/** The lower bound a window implies, or `null` for "all" — never filtered. */
function windowSince(w: TimeWindow, now: Date = new Date()): Date | null {
  if (w === "all") return null;
  return new Date(now.getTime() - WINDOW_MS[w]);
}

/**
 * `auth_events.outcome`'s actual vocabulary, read from the live table rather
 * than assumed (the brief's own instruction): `success`, `failure`, `denied`,
 * and nothing else. A fourth value would fail `parseSecurityFilters`'s
 * membership check and fall back to "everything" rather than silently filter
 * on a string nothing produces.
 */
export const OUTCOMES = ["success", "failure", "denied"] as const;
export type EventOutcome = (typeof OUTCOMES)[number];

export const OUTCOME_FILTER_LABEL: Readonly<Record<EventOutcome, string>> = {
  success: "Succeeded",
  failure: "Failed",
  denied: "Denied",
};

/**
 * "The sign-in story" (deliverable 3): not a new table, and not a new column
 * to `WHERE event = `. Chosen by reading what students and operators actually
 * *feel* as "signing in" — the mirrored student/operator pair for a clean
 * attempt (`successful_login` / `operator_login`), its failure, the lock a
 * run of failures causes and the lockout's own release, the session ending
 * before it expired, and the Google path. Left out on purpose: password
 * *changes* and *resets* are account-recovery events, not sign-ins, and
 * folding them in would make "the sign-in story" answer a bigger question
 * than the one Samuel asked.
 */
export const SIGNIN_EVENT_NAMES = [
  "successful_login",
  "operator_login",
  "failed_login",
  "account_locked",
  "lockout_cleared",
  "session_revoked",
  "oauth_login",
] as const;

/** Rows per page of the explorable list. ~50 — a screenful, not a cliff. */
export const PAGE_SIZE = 50;

export type SecurityFilters = {
  /** One `auth_events.event` name, or null. Forced null when `signins` is set. */
  event: string | null;
  /** The sign-in-story mode (deliverable 3) — see `SIGNIN_EVENT_NAMES` above. */
  signins: boolean;
  /** A student id — filters the list (their account's events, and anything
   *  about them) and the operator-read audit (whose record was opened). */
  student: number | null;
  /** An operator id — filters the list (their own actions and anything about
   *  them) and the operator-read audit (who did the opening). */
  operator: number | null;
  outcome: EventOutcome | null;
  window: TimeWindow;
  /** 1-based. Page 1 is never written to the URL — `hrefFor` in the page
   *  omits a param that already equals the default, same as `event=null`. */
  page: number;
};

/**
 * `searchParams` (untyped, possibly-array, possibly-absent) to a filter set
 * that is always valid. Pure — no database — so it is testable the way
 * `cost-model.ts`'s `periodOf` is, and it is the one place an unrecognised
 * value (a stale bookmark, a hand-edited URL, a typo) is decided rather than
 * discovered: it falls back to "no filter" or the default, never to an SQL
 * error surfaced as a 500 to an operator mid-incident.
 */
export function parseSecurityFilters(
  raw: Readonly<{ [key: string]: string | string[] | undefined }>
): SecurityFilters {
  const str = (key: string): string | null => {
    const v = raw[key];
    return typeof v === "string" && v !== "" ? v : null;
  };
  const posInt = (key: string): number | null => {
    const v = str(key);
    if (v === null) return null;
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
  };

  const windowRaw = str("window");
  const window: TimeWindow =
    windowRaw !== null && (TIME_WINDOWS as readonly string[]).includes(windowRaw)
      ? (windowRaw as TimeWindow)
      : DEFAULT_WINDOW;

  const outcomeRaw = str("outcome");
  const outcome: EventOutcome | null =
    outcomeRaw !== null && (OUTCOMES as readonly string[]).includes(outcomeRaw)
      ? (outcomeRaw as EventOutcome)
      : null;

  const signins = str("signins") === "1";

  return {
    event: signins ? null : str("event"),
    signins,
    student: posInt("student"),
    operator: posInt("operator"),
    outcome,
    window,
    page: posInt("page") ?? 1,
  };
}

/* ------------------------------------------------------------------ types */

export type SignInCounts = {
  failed24h: number;
  successful24h: number;
  failed7d: number;
  successful7d: number;
};

export type LockedAccount = {
  accountId: number;
  email: string;
  studentName: string | null;
  lockedUntil: string | null;
  accountStatus: string;
  failedAttempts: number;
  /** The `reason` on the most recent `account_locked` event, or null. */
  reason: string | null;
};

export type SourceIp = {
  ip: string;
  failures: number;
  distinctAccounts: number;
  lastAt: string;
};

export type SessionHealth = {
  activeStudentSessions: number;
  activeOperatorSessions: number;
  revoked7d: number;
};

export type OperatorDenial = {
  operatorId: number;
  operatorName: string;
  operatorEmail: string;
  denials1h: number;
  denials7d: number;
  lastAt: string;
  /** Deduplicated route codes from `reason`. An operational string, not prose. */
  routes: string[];
};

export type CrossStudentDenial = {
  authEventId: number;
  actorKind: string | null;
  actorId: number | null;
  reason: string | null;
  ip: string | null;
  occurredAt: string;
};

export type RecentEvent = {
  id: number;
  event: string;
  outcome: string | null;
  actorKind: string | null;
  actorId: number | null;
  actorLabel: string | null;
  subjectKind: string | null;
  subjectId: number | null;
  reason: string | null;
  ip: string | null;
  occurredAt: string;
};

export type AuditRow = {
  operatorId: number;
  operatorName: string;
  operatorEmail: string;
  studentId: number;
  studentName: string;
  surface: string;
  sessionId: number | null;
  occurredAt: string;
};

export type AlertFiring = {
  rule: string;
  key: string;
  windowStart: string;
  delivered: string;
  sentAt: string;
};

/** One person the "who" filters can name, for the link list and the chip. */
export type StudentOption = { id: number; name: string };
export type OperatorOption = { id: number; name: string; email: string };

export type SecurityView = {
  environment: string;
  signIns: SignInCounts;
  locked: LockedAccount[];
  topIps: SourceIp[];
  sessions: SessionHealth;
  operatorDenials: OperatorDenial[];
  crossStudent: CrossStudentDenial[];
  /** This page (`filters.page`) of the list, `filters` applied. */
  recent: RecentEvent[];
  audit: AuditRow[];
  alerts: AlertFiring[];
  /** Every distinct event name present in the last 30 days, for the "Kind" links —
   *  fixed to 30 days regardless of `filters.window`, so narrowing the window
   *  never makes a filter link disappear out from under the page it is on. */
  eventNames: string[];
  /** Every student and operator in this environment, for the "Who" links —
   *  small enough at pilot volume (n ≤ 200) to list in full rather than build
   *  a search input, the same call the students list itself makes (`console-
   *  queries.ts`'s header). A future volume that outgrows this is a plain GET
   *  form with a text field, still no client JavaScript, not a rewrite. */
  studentOptions: StudentOption[];
  operatorOptions: OperatorOption[];
  /** The filters actually applied (after `parseSecurityFilters` validated
   *  them), plus the names they resolved to — a page rendering a chip for
   *  `student=14` needs "QA Alpha" and must not run a second query to get it. */
  filters: SecurityFilters;
  studentFilterLabel: string | null;
  operatorFilterLabel: string | null;
  /** The true count for the current filter (deliverable 1: "not the page
   *  size") and the page geometry derived from it. */
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  /** The thresholds the tiles print, read from `lib/alerts.ts` so they cannot drift. */
  thresholds: {
    lock: number;
    ip: number;
    operator: number;
    crossStudentWindowHours: number;
  };
};

/** How many audit rows the panel shows — exported so the page can tell
 *  "the true count" from "the most recent AUDIT_LIMIT", the same distinction
 *  `AuditPanel.tsx` already draws for the Student 360's own copy of this list. */
export const AUDIT_LIMIT = 100;

/* ------------------------------------------------------------------ query */

/**
 * Thirteen queries, always — not "10, plus more per filter". Two resolve the
 * "who" link lists (every student, every operator) *before* the batch below,
 * because the list's own query needs a student id turned into an account id
 * as a bind parameter, which only the students query can supply: a value
 * baked into a WHERE clause has to exist before that clause is built, so it
 * cannot come from a step later in the same `sequential` tuple. Everything
 * after that is the six tiles' six queries plus the explorable list, ITS
 * total-count twin (so paging never shows a total that disagrees with the
 * rows), the audit, the alerts and the "Kind" link list — eleven, in the
 * tuple's original order. Fixed rather than filter-dependent because a page
 * whose query count depends on what was clicked is a page whose worst case
 * nobody measured.
 */
export async function getSecurityView(
  operatorId: number,
  filters: SecurityFilters
): Promise<SecurityView> {
  return withOperator(operatorId, async (db) => {
    const [studentsRes, operatorsRes] = await sequential([
      // "Who" link lists, resolved first — see the header above for why this
      // pair cannot simply be two more entries in the batch below: the list
      // query's own WHERE clause needs a student id resolved to an account id
      // as a *bind parameter*, and a bind parameter has to exist in plain JS
      // before the query that takes it is built, not merely before it runs.
      () =>
        db.query<{ id: string; display_name: string; account_id: string | null }>(
          `SELECT id, display_name, account_id FROM students
            WHERE environment = $1 ORDER BY display_name`,
          [ENVIRONMENT]
        ),
      // Operators carry no `environment` column (ADR-0014) — an operator's
      // roles are per-environment, not the operator's existence — so every
      // other query in this file that joins `operators` already omits the
      // filter, and this one matches them rather than inventing a new rule.
      () =>
        db.query<{ id: string; display_name: string; email: string }>(
          `SELECT id, display_name, email FROM operators ORDER BY display_name`
        ),
    ] as const);

    const studentFilter =
      filters.student != null
        ? (studentsRes.rows.find((r) => Number(r.id) === filters.student) ?? null)
        : null;
    const operatorFilter =
      filters.operator != null
        ? (operatorsRes.rows.find((r) => Number(r.id) === filters.operator) ?? null)
        : null;
    // The account a "student" filter resolves to. `null` when the filter is
    // off, and also when the student has no account (every legacy row) — in
    // which case the predicate below simply matches no sign-in ever, which is
    // correct: a student with no account has no sign-in to find.
    const studentAccountId =
      studentFilter?.account_id != null ? Number(studentFilter.account_id) : null;

    const since = windowSince(filters.window);
    const eventNameFilter = filters.signins ? null : filters.event;
    const signinKinds = filters.signins ? [...SIGNIN_EVENT_NAMES] : null;
    const offset = (filters.page - 1) * PAGE_SIZE;

    // Shared between the list and its total-count twin so the two can never
    // disagree about what "the current filter" means — see the type's own
    // comment on why the total has to be the true one, not the page size.
    // NOTE on $6/$7: the "no filter" gate is `$7::int IS NULL` — the STUDENT
    // id, not `$6` the account id it resolves to — because a student can be
    // filtered on with no account (every legacy row): `$6` is legitimately
    // NULL in that case while the filter is very much active, and gating on
    // it would have turned "show this student's events" into "show
    // everyone's" for exactly the students most worth checking on.
    const listWhere = `e.environment = $1
            AND ($2::timestamptz IS NULL OR e.occurred_at >= $2)
            AND ($3::text IS NULL OR e.event = $3)
            AND ($4::text[] IS NULL OR e.event = ANY($4))
            AND ($5::text IS NULL OR e.outcome = $5)
            AND ($7::int IS NULL OR (e.actor_kind = 'account' AND e.actor_id = $6)
                                 OR (e.subject_kind = 'student' AND e.subject_id = $7))
            AND ($8::int IS NULL OR (e.actor_kind = 'operator' AND e.actor_id = $8)
                                 OR (e.subject_kind = 'operator' AND e.subject_id = $8))`;
    const listParams = [
      ENVIRONMENT,
      since,
      eventNameFilter,
      signinKinds,
      filters.outcome,
      studentAccountId,
      filters.student,
      filters.operator,
    ];

    const [
      counts,
      locked,
      ips,
      sessions,
      denials,
      cross,
      recent,
      recentTotal,
      audit,
      alerts,
      names,
    ] = await sequential([
      // 1. Failed vs successful, 24h and 7d. One pass, four counts — the two
      //    windows share a scan because the 7-day predicate contains the 1-day
      //    one, and two queries here would be two scans of the same index.
      () =>
        db.query<{
          failed_24h: string;
          successful_24h: string;
          failed_7d: string;
          successful_7d: string;
        }>(
          `SELECT
             count(*) FILTER (WHERE event = 'failed_login'
                                AND occurred_at >= now() - interval '24 hours')  AS failed_24h,
             count(*) FILTER (WHERE event = 'successful_login'
                                AND occurred_at >= now() - interval '24 hours')  AS successful_24h,
             count(*) FILTER (WHERE event = 'failed_login')                       AS failed_7d,
             count(*) FILTER (WHERE event = 'successful_login')                   AS successful_7d
           FROM auth_events
          WHERE environment = $1
            AND occurred_at >= now() - interval '7 days'`,
          [ENVIRONMENT]
        ),

      // 2. Accounts currently locked, WITH REASON. The lock state lives on
      //    `accounts`; the reason lives on the event that set it, so the two
      //    are joined rather than one of them being guessed from the other.
      //    LEFT JOIN on students because an account can exist before its
      //    student row does, and a lock is still a lock.
      () =>
        db.query<{
          id: string;
          email: string;
          display_name: string | null;
          locked_until: Date | null;
          status: string;
          failed_attempts: number;
          reason: string | null;
        }>(
          `SELECT a.id, a.email, st.display_name, a.locked_until, a.status,
                  a.failed_attempts,
                  (SELECT e.reason FROM auth_events e
                    WHERE e.environment = a.environment
                      AND e.event = 'account_locked'
                      AND e.actor_kind = 'account'
                      AND e.actor_id = a.id
                    ORDER BY e.occurred_at DESC LIMIT 1) AS reason
             FROM accounts a
             LEFT JOIN students st ON st.account_id = a.id
            WHERE a.environment = $1
              AND (a.status = 'locked' OR (a.locked_until IS NOT NULL AND a.locked_until > now()))
            ORDER BY a.locked_until DESC NULLS LAST, a.id`,
          [ENVIRONMENT]
        ),

      // 3. Top source IPs by failed sign-ins, LAST HOUR. `host()` renders the
      //    INET without a netmask; the raw column would print `1.2.3.4/32`.
      //    `distinct_accounts` is what separates one child forgetting a
      //    password from somebody walking a list.
      () =>
        db.query<{
          ip: string;
          failures: string;
          distinct_accounts: string;
          last_at: Date;
        }>(
          `SELECT host(ip_address) AS ip, count(*) AS failures,
                  count(DISTINCT actor_id) AS distinct_accounts,
                  max(occurred_at) AS last_at
             FROM auth_events
            WHERE environment = $1
              AND event = 'failed_login'
              AND ip_address IS NOT NULL
              AND occurred_at >= now() - interval '1 hour'
            GROUP BY host(ip_address)
            ORDER BY count(*) DESC, max(occurred_at) DESC
            LIMIT 10`,
          [ENVIRONMENT]
        ),

      // 4. Active sign-in sessions, and revocations in 7 days. Students and
      //    operators counted separately: they are different populations and a
      //    single number would hide one operator behind two hundred students.
      () =>
        db.query<{ active_students: string; active_operators: string; revoked_7d: string }>(
          `SELECT
             count(*) FILTER (WHERE revoked_at IS NULL AND expires_at > now()
                                AND account_id IS NOT NULL)  AS active_students,
             count(*) FILTER (WHERE revoked_at IS NULL AND expires_at > now()
                                AND operator_id IS NOT NULL) AS active_operators,
             count(*) FILTER (WHERE revoked_at >= now() - interval '7 days') AS revoked_7d
           FROM auth_sessions
          WHERE environment = $1`,
          [ENVIRONMENT]
        ),

      // 5. `permission_denied` by operator. Both windows, because the alert
      //    fires on the 1-hour one and a reader wants to know whether this is
      //    new. The operator's NAME is joined here rather than on the page:
      //    FR-2211 forbids an identifier standing alone.
      () =>
        db.query<{
          operator_id: string;
          display_name: string;
          email: string;
          denials_1h: string;
          denials_7d: string;
          last_at: Date;
          routes: string[];
        }>(
          `SELECT e.actor_id AS operator_id, op.display_name, op.email,
                  count(*) FILTER (WHERE e.occurred_at >= now() - interval '1 hour') AS denials_1h,
                  count(*) AS denials_7d,
                  max(e.occurred_at) AS last_at,
                  array_agg(DISTINCT coalesce(e.reason, 'unknown')) AS routes
             FROM auth_events e
             JOIN operators op ON op.id = e.actor_id
            WHERE e.environment = $1
              AND e.event = 'permission_denied'
              AND e.actor_kind = 'operator'
              AND e.occurred_at >= now() - interval '7 days'
            GROUP BY e.actor_id, op.display_name, op.email
            ORDER BY count(*) FILTER (WHERE e.occurred_at >= now() - interval '1 hour') DESC,
                     count(*) DESC`,
          [ENVIRONMENT]
        ),

      // 6. The zero-threshold tile. Every occurrence, individually, over the
      //    same window the alert rule uses — the tile and the mail must never
      //    disagree about what "recent" means. 30 days as well as the hour,
      //    because a tile that only ever shows the last hour cannot tell
      //    "never happened" from "happened on Tuesday".
      () =>
        db.query<{
          id: string;
          actor_kind: string | null;
          actor_id: string | null;
          reason: string | null;
          ip: string | null;
          occurred_at: Date;
        }>(
          `SELECT id, actor_kind, actor_id, reason, host(ip_address) AS ip, occurred_at
             FROM auth_events
            WHERE environment = $1
              AND event = 'cross_student_access_denied'
              AND occurred_at >= now() - interval '30 days'
            ORDER BY occurred_at DESC
            LIMIT 50`,
          [ENVIRONMENT]
        ),

      // The explorable list (deliverable 1). `actor_label` resolves the
      // untyped `actor_id` through whichever table `actor_kind` names —
      // `auth_events` deliberately carries no foreign key (migration 016), so
      // the join is a CASE rather than a relation, and an id whose row is gone
      // stays readable as an id. `listWhere`/`listParams` are shared with the
      // count query directly below, by construction rather than by care.
      () =>
        db.query<{
          id: string;
          event: string;
          outcome: string | null;
          actor_kind: string | null;
          actor_id: string | null;
          actor_label: string | null;
          subject_kind: string | null;
          subject_id: string | null;
          reason: string | null;
          ip: string | null;
          occurred_at: Date;
        }>(
          `SELECT e.id, e.event, e.outcome, e.actor_kind, e.actor_id,
                  CASE e.actor_kind
                    WHEN 'operator' THEN (SELECT op.display_name FROM operators op WHERE op.id = e.actor_id)
                    WHEN 'account'  THEN (SELECT a.email FROM accounts a WHERE a.id = e.actor_id)
                    ELSE NULL
                  END AS actor_label,
                  e.subject_kind, e.subject_id, e.reason,
                  host(e.ip_address) AS ip, e.occurred_at
             FROM auth_events e
            WHERE ${listWhere}
            ORDER BY e.occurred_at DESC, e.id DESC
            LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
          listParams
        ),

      // The list's total, under the SAME filter — "the true total, not the
      // page size" (deliverable 1). Run as its own scan rather than a window
      // function over the paged query: `count(*) OVER()` would still cost a
      // full scan and would make the LIMIT/OFFSET query itself slower on
      // every page, not only the total; this way the common case (reading
      // page 1) pays for exactly two scans, not one slower one.
      () =>
        db.query<{ total: string }>(
          `SELECT count(*) AS total FROM auth_events e WHERE ${listWhere}`,
          listParams
        ),

      // The operator-read audit, shown HERE and not only on each student's page
      // (contracts/admin.md §7, deliverable 2). Operators see their own reads:
      // a log whose subject can be hidden from its own reader is a log with a
      // privileged class in it. Filtered by the SAME `student`/`operator`
      // params the list above takes — one "who" concept, not two — which is
      // what lets a single link from the Student 360 land here already
      // scoped: `/security?student=14` narrows this table on `student_id`
      // directly (no account-id translation needed; the audit already keys on
      // the student) and narrows the list above via the account it resolves.
      () =>
        db.query<{
          operator_id: string;
          operator_name: string;
          operator_email: string;
          student_id: string;
          student_name: string;
          surface: string;
          session_id: string | null;
          occurred_at: Date;
        }>(
          `SELECT r.operator_id, op.display_name AS operator_name, op.email AS operator_email,
                  r.student_id, st.display_name AS student_name,
                  r.surface, r.session_id, r.occurred_at
             FROM operator_reads r
             JOIN operators op ON op.id = r.operator_id
             JOIN students  st ON st.id = r.student_id
            WHERE r.environment = $1
              AND ($2::int IS NULL OR r.student_id = $2)
              AND ($3::int IS NULL OR r.operator_id = $3)
            ORDER BY r.occurred_at DESC
            LIMIT ${AUDIT_LIMIT}`,
          [ENVIRONMENT, filters.student, filters.operator]
        ),

      // What the sweep has actually fired, so the page can say whether anybody
      // was told. `ainext_operator` holds SELECT on this and no UPDATE or
      // DELETE (migration 022).
      () =>
        db.query<{
          rule: string;
          key: string;
          window_start: Date;
          delivered: string;
          sent_at: Date;
        }>(
          `SELECT rule, key, window_start, delivered, sent_at
             FROM alerts_sent
            WHERE environment = $1
            ORDER BY sent_at DESC
            LIMIT 20`,
          [ENVIRONMENT]
        ),

      // The filter control's options, derived from the data rather than from
      // the union type: an event name that exists in the table and not in the
      // list would be invisible, which is the one failure a security view
      // cannot have.
      () =>
        db.query<{ event: string }>(
          `SELECT DISTINCT event FROM auth_events
            WHERE environment = $1 AND occurred_at >= now() - interval '30 days'
            ORDER BY event`,
          [ENVIRONMENT]
        ),
    ] as const);

    const c = counts.rows[0];

    return {
      environment: ENVIRONMENT,
      signIns: {
        failed24h: Number(c?.failed_24h ?? 0),
        successful24h: Number(c?.successful_24h ?? 0),
        failed7d: Number(c?.failed_7d ?? 0),
        successful7d: Number(c?.successful_7d ?? 0),
      },
      locked: locked.rows.map((r) => ({
        accountId: Number(r.id),
        email: r.email,
        studentName: r.display_name,
        lockedUntil: r.locked_until?.toISOString() ?? null,
        accountStatus: r.status,
        failedAttempts: r.failed_attempts,
        reason: r.reason,
      })),
      topIps: ips.rows.map((r) => ({
        ip: r.ip,
        failures: Number(r.failures),
        distinctAccounts: Number(r.distinct_accounts),
        lastAt: r.last_at.toISOString(),
      })),
      sessions: {
        activeStudentSessions: Number(sessions.rows[0]?.active_students ?? 0),
        activeOperatorSessions: Number(sessions.rows[0]?.active_operators ?? 0),
        revoked7d: Number(sessions.rows[0]?.revoked_7d ?? 0),
      },
      operatorDenials: denials.rows.map((r) => ({
        operatorId: Number(r.operator_id),
        operatorName: r.display_name,
        operatorEmail: r.email,
        denials1h: Number(r.denials_1h),
        denials7d: Number(r.denials_7d),
        lastAt: r.last_at.toISOString(),
        routes: r.routes ?? [],
      })),
      crossStudent: cross.rows.map((r) => ({
        authEventId: Number(r.id),
        actorKind: r.actor_kind,
        actorId: r.actor_id === null ? null : Number(r.actor_id),
        reason: r.reason,
        ip: r.ip,
        occurredAt: r.occurred_at.toISOString(),
      })),
      recent: recent.rows.map((r) => ({
        id: Number(r.id),
        event: r.event,
        outcome: r.outcome,
        actorKind: r.actor_kind,
        actorId: r.actor_id === null ? null : Number(r.actor_id),
        actorLabel: r.actor_label,
        subjectKind: r.subject_kind,
        subjectId: r.subject_id === null ? null : Number(r.subject_id),
        reason: r.reason,
        ip: r.ip,
        occurredAt: r.occurred_at.toISOString(),
      })),
      audit: audit.rows.map((r) => ({
        operatorId: Number(r.operator_id),
        operatorName: r.operator_name,
        operatorEmail: r.operator_email,
        studentId: Number(r.student_id),
        studentName: r.student_name,
        surface: r.surface,
        sessionId: r.session_id === null ? null : Number(r.session_id),
        occurredAt: r.occurred_at.toISOString(),
      })),
      alerts: alerts.rows.map((r) => ({
        rule: r.rule,
        key: r.key,
        windowStart: r.window_start.toISOString(),
        delivered: r.delivered,
        sentAt: r.sent_at.toISOString(),
      })),
      eventNames: names.rows.map((r) => r.event),
      studentOptions: studentsRes.rows.map((r) => ({
        id: Number(r.id),
        name: r.display_name,
      })),
      operatorOptions: operatorsRes.rows.map((r) => ({
        id: Number(r.id),
        name: r.display_name,
        email: r.email,
      })),
      filters,
      studentFilterLabel: studentFilter?.display_name ?? (filters.student != null ? `#${filters.student}` : null),
      operatorFilterLabel: operatorFilter?.display_name ?? (filters.operator != null ? `#${filters.operator}` : null),
      pagination: {
        page: filters.page,
        pageSize: PAGE_SIZE,
        total: Number(recentTotal.rows[0]?.total ?? 0),
        totalPages: Math.max(1, Math.ceil(Number(recentTotal.rows[0]?.total ?? 0) / PAGE_SIZE)),
      },
      thresholds: {
        lock: LOCK_THRESHOLD,
        ip: IP_THRESHOLD,
        operator: OPERATOR_THRESHOLD,
        crossStudentWindowHours: CROSS_STUDENT_WINDOW_MS / 3_600_000,
      },
    };
  });
}
