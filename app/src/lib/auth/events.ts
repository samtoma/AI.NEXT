/**
 * The security record — `auth_events` (data-model §10, contracts/analytics.md).
 *
 * Talent defines seven security events and emits three; `suspicious_activity`,
 * `password_changed`, `account_locked` and `permission_denied` are dead code
 * there, and there is no lockout logic anywhere to emit the third from (R1 §5).
 * That is the cautionary example FR-2501 was written against: **defining an
 * event is not emitting it**, which is why SC-106's test asserts emission from
 * the branch rather than existence in a union.
 *
 * Two rules this module enforces by shape rather than by discipline:
 *
 *  1. **`AuthEventName` is closed.** Eighteen names — the thirteen FR-2501
 *     requires plus the five we emit without being required to. A typo is a
 *     compile error, not a row nobody ever queries.
 *  2. **No password material, ever** (FR-2003). Not the attempted password, not
 *     its length, not a hash of it. `reason` is a short code from the caller;
 *     `password.ts` never hands one out, so there is nothing to forward.
 *
 * `recordAuthEvent` never throws. A security event that fails to write must not
 * turn a refused sign-in into a 500 — the refusal is the security behaviour and
 * the row is the record of it.
 *
 * The database import is deliberately lazy so this module can be loaded by
 * `node --test` without a pool, a DSN, or Next's module aliasing.
 */

/** The thirteen FR-2501 names, in the order contracts/analytics.md lists them. */
export const REQUIRED_EVENT_NAMES = [
  "successful_login",
  "failed_login",
  "account_locked",
  "lockout_cleared",
  "password_changed",
  "password_reset_requested",
  "email_verification_sent",
  "email_verification_succeeded",
  "session_revoked",
  "permission_denied",
  "cross_student_access_denied",
  "operator_login",
  "admin_transcript_viewed",
] as const;

/** Emitted, not required — the five in the same contract. */
export const ADDITIONAL_EVENT_NAMES = [
  "suspicious_activity",
  "oauth_login",
  "role_granted",
  "role_revoked",
  "password_reset_completed",
] as const;

/**
 * DEVIATION, named rather than smuggled: `contracts/auth.md`'s signup table
 * says the 409 branch emits `failed_signup`, and `contracts/analytics.md`'s
 * vocabulary — the closed list of 13 + 5 — does not contain that name. The two
 * contracts disagree. Dropping the row would lose the only signal that someone
 * is probing which addresses are taken; folding it into `failed_login` would
 * corrupt the sign-in failure counts the security view reads. So it is here, on
 * its own, visible, and flagged for Samuel to fold into one contract or the
 * other. It is NOT one of the thirteen SC-106 tests.
 */
export const ENDPOINT_EVENT_NAMES = ["failed_signup"] as const;

export const AUTH_EVENT_NAMES = [
  ...REQUIRED_EVENT_NAMES,
  ...ADDITIONAL_EVENT_NAMES,
  ...ENDPOINT_EVENT_NAMES,
] as const;

export type RequiredEventName = (typeof REQUIRED_EVENT_NAMES)[number];
export type AuthEventName = (typeof AUTH_EVENT_NAMES)[number];

export type AuthEventOutcome = "success" | "failure" | "denied";

export type AuthEventArgs = {
  event: AuthEventName;
  outcome?: AuthEventOutcome;
  actor?: { kind: "account" | "operator" | "anonymous"; id?: number };
  subject?: { kind: string; id?: number };
  /** A short code. Never a password, never a length, never a hash of one. */
  reason?: string;
  ip?: string | null;
  userAgent?: string | null;
};

/** The injection seam every branch that emits takes, so SC-106 can observe it. */
export type AuthEventRecorder = (e: AuthEventArgs) => Promise<void>;

/** A reason is an operational code, not prose, and not a place to put data. */
const REASON_MAX = 120;
const USER_AGENT_MAX = 400;

/**
 * INET rejects anything that is not an address, and a malformed
 * `X-Forwarded-For` must not be the thing that fails a sign-in refusal's audit
 * row. Anything unrecognisable becomes NULL.
 */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const first = raw.split(",")[0]!.trim();
  if (!first) return null;
  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/;
  const ipv6 = /^[0-9a-fA-F:]+$/;
  if (ipv4.test(first)) {
    return first.split(".").every((o) => Number(o) <= 255) ? first : null;
  }
  if (first.includes(":") && ipv6.test(first)) return first;
  return null;
}

/** Client address and user agent, from the headers a Cloudflare hop actually sets. */
export function requestMeta(req: Request): { ip: string | null; userAgent: string | null } {
  const h = req.headers;
  const ip =
    normalizeIp(h.get("cf-connecting-ip")) ??
    normalizeIp(h.get("x-forwarded-for")) ??
    normalizeIp(h.get("x-real-ip"));
  const ua = h.get("user-agent");
  return { ip, userAgent: ua ? ua.slice(0, USER_AGENT_MAX) : null };
}

/**
 * The ONLY producer of `cross_student_access_denied` (FR-2501 #11).
 *
 * It lives here rather than at each write path because its alert threshold is
 * **zero**: once RLS is on, a cross-student write should be structurally
 * impossible, so this row doubles as the running proof that isolation works
 * (research A5). One producer means one thing to grep for and one thing to
 * test. Every blocked cross-student WRITE calls this — the read side answers
 * 404 and records nothing, because RLS simply returned no row.
 */
export async function recordCrossStudentDenied(
  args: {
    actorAccountId?: number | null;
    targetStudentId: number;
    resource: string;
    ip?: string | null;
    userAgent?: string | null;
  },
  record: AuthEventRecorder = recordAuthEvent
): Promise<void> {
  await record({
    event: "cross_student_access_denied",
    outcome: "denied",
    actor:
      args.actorAccountId != null
        ? { kind: "account", id: args.actorAccountId }
        : { kind: "anonymous" },
    subject: { kind: "student", id: args.targetStudentId },
    reason: args.resource,
    ip: args.ip ?? null,
    userAgent: args.userAgent ?? null,
  });
}

/**
 * Write the `operator_reads` audit row AND its `admin_transcript_viewed` event,
 * in one call, so the two cannot come apart (FR-2501 #13, FR-2306).
 *
 * The audit its subject cannot erase: `operator_reads` grants the console role
 * SELECT and INSERT and no UPDATE or DELETE (data-model §14). An audit log the
 * audited party can edit is decoration.
 */
export async function recordOperatorRead(
  db: {
    query: (
      text: string,
      values?: readonly unknown[]
    ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  },
  args: {
    operatorId: number;
    studentId: number;
    sessionId?: number | null;
    surface: "student_360" | "session_timeline" | "session_replay";
    reason?: string | null;
    environment: string;
  },
  record: AuthEventRecorder = recordAuthEvent
): Promise<void> {
  await db.query(
    `INSERT INTO operator_reads
       (operator_id, student_id, session_id, surface, reason, environment)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      args.operatorId,
      args.studentId,
      args.sessionId ?? null,
      args.surface,
      args.reason ?? null,
      args.environment,
    ]
  );
  await record({
    event: "admin_transcript_viewed",
    outcome: "success",
    actor: { kind: "operator", id: args.operatorId },
    subject: { kind: "student", id: args.studentId },
    reason: args.surface,
  });
}

export async function recordAuthEvent(e: AuthEventArgs): Promise<void> {
  try {
    const [{ pool }, { ENVIRONMENT }] = await Promise.all([
      import("@/lib/db"),
      import("@/lib/env"),
    ]);
    await pool.query(
      `INSERT INTO auth_events
         (environment, event, outcome, actor_kind, actor_id,
          subject_kind, subject_id, reason, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        ENVIRONMENT,
        e.event,
        e.outcome ?? null,
        e.actor?.kind ?? null,
        e.actor?.id ?? null,
        e.subject?.kind ?? null,
        e.subject?.id ?? null,
        e.reason ? e.reason.slice(0, REASON_MAX) : null,
        e.ip ?? null,
        e.userAgent ?? null,
      ]
    );
  } catch (err) {
    // Observability, not behaviour — exactly as lib/analytics.ts treats its own
    // failures. The refusal already happened; this is the note about it.
    console.error(`[auth-events] failed to record ${e.event}:`, err);
  }
}
