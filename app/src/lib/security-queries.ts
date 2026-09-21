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
 * Six tiles, a recent-events table and the operator-read audit, all over
 * `auth_events` and the three tables that give its ids names. Nothing here is
 * cached, materialised or rolled up: SC-105 says an attempt is visible within
 * sixty seconds, and the cheapest way to be sure of that is to have nothing
 * between the page and the table. At pilot volume the whole view is four index
 * scans.
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

export type SecurityView = {
  environment: string;
  signIns: SignInCounts;
  locked: LockedAccount[];
  topIps: SourceIp[];
  sessions: SessionHealth;
  operatorDenials: OperatorDenial[];
  crossStudent: CrossStudentDenial[];
  recent: RecentEvent[];
  audit: AuditRow[];
  alerts: AlertFiring[];
  /** Every distinct event name present in the window, for the filter control. */
  eventNames: string[];
  /** The thresholds the tiles print, read from `lib/alerts.ts` so they cannot drift. */
  thresholds: {
    lock: number;
    ip: number;
    operator: number;
    crossStudentWindowHours: number;
  };
};

/** How many rows the recent-events table and the audit show. */
export const RECENT_LIMIT = 200;
const AUDIT_LIMIT = 100;

/* ------------------------------------------------------------------ query */

/**
 * @param eventFilter one `auth_events.event` name, or null for all of them.
 */
export async function getSecurityView(
  operatorId: number,
  eventFilter: string | null = null
): Promise<SecurityView> {
  return withOperator(operatorId, async (db) => {
    const [
      counts,
      locked,
      ips,
      sessions,
      denials,
      cross,
      recent,
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

      // The recent-events table. `actor_label` resolves the untyped `actor_id`
      // through whichever table `actor_kind` names — `auth_events` deliberately
      // carries no foreign key (migration 016), so the join is a CASE rather
      // than a relation, and an id whose row is gone stays readable as an id.
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
            WHERE e.environment = $1
              AND ($2::text IS NULL OR e.event = $2)
            ORDER BY e.occurred_at DESC, e.id DESC
            LIMIT ${RECENT_LIMIT}`,
          [ENVIRONMENT, eventFilter]
        ),

      // The operator-read audit, shown HERE and not only on each student's page
      // (contracts/admin.md §7). Operators see their own reads: a log whose
      // subject can be hidden from its own reader is a log with a privileged
      // class in it.
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
            ORDER BY r.occurred_at DESC
            LIMIT ${AUDIT_LIMIT}`,
          [ENVIRONMENT]
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
      thresholds: {
        lock: LOCK_THRESHOLD,
        ip: IP_THRESHOLD,
        operator: OPERATOR_THRESHOLD,
        crossStudentWindowHours: CROSS_STUDENT_WINDOW_MS / 3_600_000,
      },
    };
  });
}
