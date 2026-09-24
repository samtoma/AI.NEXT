/**
 * Signing an operator in WITHOUT a password — from a proven identity
 * (Cloudflare Access) or, on a laptop only, from the dev picker (ADR-0022,
 * FR-3301…FR-3312).
 *
 * **It ends at exactly the same place a password sign-in does.** The session is
 * `createAuthSession` — the same `auth_sessions` row, the same 7-day sliding /
 * 30-day absolute expiry, the same refresh-token rotation afterwards — and the
 * cookies are written by the same `accessCookie` / `refreshCookie` calls with
 * the console's names. A console session started this way cannot be told apart
 * from one started with a password by anything downstream of it, which is the
 * point: `principal.ts`, `authorize()` and every role check stay the one seam
 * they are (FR-2106). What differs is only what proved the person, and that is
 * written into the sign-in's own audit row.
 *
 * **The audit rows.** `operator_login` is the console's sign-in event
 * (contracts/analytics.md #12) and the Security page's sign-in story counts it,
 * so a Cloudflare sign-in emits THAT, not a new name — a second name would split
 * every operator sign-in count in two. What proved the person goes first in
 * `reason`, then the roles in effect (FR-2207): `cloudflare-access:<roles>` or
 * `dev-picker:<roles>`. The password path keeps writing the bare role list, as
 * it always has. The address the proof carried IS the operator's own address
 * (matched by `canonicalOperatorEmail`: ASCII only, ignoring case), so
 * `actor_id` names it; a refusal has no
 * operator to point at, so it carries the proven address in `reason` instead —
 * the one place an address is written into this table, and it is an operator's
 * or would-be operator's, never a student's. No token of any kind is recorded.
 *
 * **The proven person wins** (FR-3305). If this browser already holds a console
 * session for a different operator, that session is ended — revoked in the
 * database and recorded as `session_revoked` with reason
 * `<method>:identity_changed` — before the proven person's session starts. The
 * same happens when the proven person has no console account, or a disabled
 * one: whoever that other session belonged to, it was not theirs.
 *
 * **Same operator, existing session**: nothing new is created. The refresh
 * token is rotated exactly as `/api/auth/refresh` would rotate it — this is the
 * path an access cookie's 15-minute expiry takes on the console once Access is
 * on — so the session list stays "the places I am signed in" rather than
 * growing a row every quarter of an hour.
 *
 * Like `session.ts`, every function takes its database handle and its event
 * recorder, so each branch is a unit test against a fake pool
 * (`operator-signin.test.mts`).
 */

import { canonicalOperatorEmail } from "./cf-access.ts";
import type { AuthEventRecorder } from "./events.ts";
import {
  createAuthSession,
  loadOperatorRoles,
  rotateRefreshToken,
  type OperatorRole,
  type SessionMeta,
} from "./session.ts";
import { hashToken } from "./tokens.ts";
import type { Queryable } from "./throttle.ts";

export type OperatorSigninMethod = "cloudflare-access" | "dev-picker";

/** Who is being signed in: by the proven address, or (dev picker) by id. */
export type OperatorIdentity = { email: string } | { operatorId: number };

/** What this browser already holds on the console, if anything. */
export type CurrentConsoleSession = {
  /** The console refresh cookie (`ainext_crt`), which `/api/auth/*` receives. */
  refreshToken?: string | null;
  /** `sid` from a still-valid console access cookie, when there is one. */
  accessSessionId?: number | null;
};

export type OperatorSigninOutcome =
  | {
      kind: "ok";
      operatorId: number;
      roles: OperatorRole[];
      sessionId: number;
      token: string;
      expiresAt: Date;
      /** True when a new session was started; false when the existing one was rotated. */
      created: boolean;
      /** The other operator's session that was ended to make way, if any. */
      ended: { operatorId: number; sessionId: number } | null;
    }
  /** Same operator, still-valid access cookie and no refresh cookie: nothing to do. */
  | { kind: "unchanged"; operatorId: number }
  | { kind: "no_account"; ended: { operatorId: number; sessionId: number } | null }
  | { kind: "disabled"; operatorId: number; ended: { operatorId: number; sessionId: number } | null };

type OperatorRow = { id: number; status: string };
type LiveSession = { id: number; operatorId: number };

async function loadOperator(db: Queryable, who: OperatorIdentity): Promise<OperatorRow | null> {
  // No `password_hash`: this path never needs it and should never hold it.
  if ("email" in who) {
    const want = canonicalOperatorEmail(who.email);
    if (!want) return null;
    // SQL finds the candidate through the unique index's own rule; the row
    // counts only if `canonicalOperatorEmail` — the rule `principal.ts` applies
    // on every later request — agrees it is the same address. Otherwise the
    // route would sign in a session the next request unseats: a loop (F7).
    const res = await db.query(
      `SELECT id, status, email FROM operators WHERE lower(email) = lower($1)`,
      [want]
    );
    const r = res.rows[0];
    if (!r || canonicalOperatorEmail(r.email) !== want) return null;
    return { id: Number(r.id), status: String(r.status) };
  }
  const res = await db.query(`SELECT id, status FROM operators WHERE id = $1`, [who.operatorId]);
  const r = res.rows[0];
  return r ? { id: Number(r.id), status: String(r.status) } : null;
}

/**
 * The console session this browser holds, if it is live. The refresh cookie is
 * the key that matters (it is what can mint more access), and a valid access
 * cookie's `sid` is the fallback for a browser that somehow has one without the
 * other. Student sessions never match: `operator_id IS NOT NULL`.
 */
async function currentLiveSession(
  db: Queryable,
  current: CurrentConsoleSession,
  now: Date
): Promise<(LiveSession & { via: "refresh" | "access" }) | null> {
  if (current.refreshToken) {
    const res = await db.query(
      `SELECT id, operator_id FROM auth_sessions
        WHERE token_hash = $1 AND operator_id IS NOT NULL
          AND revoked_at IS NULL AND expires_at > $2
        LIMIT 1`,
      [hashToken(current.refreshToken), now]
    );
    const r = res.rows[0];
    if (r) return { id: Number(r.id), operatorId: Number(r.operator_id), via: "refresh" };
  }
  if (current.accessSessionId != null && Number.isFinite(current.accessSessionId)) {
    const res = await db.query(
      `SELECT id, operator_id FROM auth_sessions
        WHERE id = $1 AND operator_id IS NOT NULL
          AND revoked_at IS NULL AND expires_at > $2
        LIMIT 1`,
      [current.accessSessionId, now]
    );
    const r = res.rows[0];
    if (r) return { id: Number(r.id), operatorId: Number(r.operator_id), via: "access" };
  }
  return null;
}

async function endSession(
  db: Queryable,
  session: LiveSession,
  reason: string,
  record: AuthEventRecorder,
  meta: SessionMeta,
  now: Date
): Promise<{ operatorId: number; sessionId: number } | null> {
  const res = await db.query(
    `UPDATE auth_sessions SET revoked_at = $2
      WHERE id = $1 AND revoked_at IS NULL
      RETURNING id, operator_id`,
    [session.id, now]
  );
  const row = res.rows[0];
  if (!row) return null;
  await record({
    event: "session_revoked",
    outcome: "success",
    actor: { kind: "operator", id: session.operatorId },
    subject: { kind: "auth_session", id: session.id },
    reason,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { operatorId: session.operatorId, sessionId: session.id };
}

/** How the refusal names who was refused. An id for the picker, the proven address otherwise. */
function refusedWho(who: OperatorIdentity): string {
  return "email" in who ? who.email.trim().toLowerCase() : `#${who.operatorId}`;
}

export async function signInOperator(
  db: Queryable,
  who: OperatorIdentity,
  method: OperatorSigninMethod,
  current: CurrentConsoleSession,
  record: AuthEventRecorder,
  meta: SessionMeta,
  now: Date = new Date()
): Promise<OperatorSigninOutcome> {
  const operator = await loadOperator(db, who);
  const live = await currentLiveSession(db, current, now);

  if (!operator) {
    await record({
      event: "failed_login",
      outcome: "failure",
      actor: { kind: "anonymous" },
      reason: `${method}:no_operator:${refusedWho(who)}`,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
    const ended = live
      ? await endSession(db, live, `${method}:identity_has_no_account`, record, meta, now)
      : null;
    return { kind: "no_account", ended };
  }

  if (operator.status !== "active") {
    await record({
      event: "failed_login",
      outcome: "failure",
      actor: { kind: "operator", id: operator.id },
      reason: `${method}:disabled`,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
    const ended = live
      ? await endSession(db, live, `${method}:identity_disabled`, record, meta, now)
      : null;
    return { kind: "disabled", operatorId: operator.id, ended };
  }

  // Same person, already signed in on this browser.
  if (live && live.operatorId === operator.id) {
    if (live.via === "refresh" && current.refreshToken) {
      const rotated = await rotateRefreshToken(
        db,
        current.refreshToken,
        meta,
        record,
        now,
        "admin"
      );
      if (rotated.kind === "rotated") {
        return {
          kind: "ok",
          operatorId: operator.id,
          roles: await loadOperatorRoles(db, operator.id),
          sessionId: rotated.sessionId,
          token: rotated.token,
          expiresAt: rotated.expiresAt,
          created: false,
          ended: null,
        };
      }
      // Lost a race with another tab's rotation (or tripped reuse detection,
      // which has already revoked and recorded everything). Either way the
      // old session is gone; the proven person gets a fresh one below.
    } else {
      return { kind: "unchanged", operatorId: operator.id };
    }
  }

  // Somebody else's session on this browser: the proven person wins.
  const ended =
    live && live.operatorId !== operator.id
      ? await endSession(db, live, `${method}:identity_changed`, record, meta, now)
      : null;

  const roles = await loadOperatorRoles(db, operator.id);
  const session = await createAuthSession(db, { operatorId: operator.id }, meta, now);

  // Cloudflare proved the address with a one-time PIN, which is a verification
  // in every sense the password path's `email_verified_at` means. The dev
  // picker proves nothing, so it touches nothing.
  if (method === "cloudflare-access") {
    await db.query(
      `UPDATE operators SET email_verified_at = coalesce(email_verified_at, $2) WHERE id = $1`,
      [operator.id, now]
    );
  }

  await record({
    event: "operator_login",
    outcome: "success",
    actor: { kind: "operator", id: operator.id },
    reason: `${method}:${roles.join(",") || "no_roles"}`,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return {
    kind: "ok",
    operatorId: operator.id,
    roles,
    sessionId: session.id,
    token: session.token,
    expiresAt: session.expiresAt,
    created: true,
    ended,
  };
}

/**
 * A refusal the sign-in route records BEFORE any database work: the assertion
 * was missing or did not verify. Anonymous, because nothing was proven — and
 * the reason is the verifier's short code, never any part of the token.
 */
export async function recordUnverifiedAssertion(
  reason: string,
  record: AuthEventRecorder,
  meta: { ip?: string | null; userAgent?: string | null }
): Promise<void> {
  await record({
    event: "failed_login",
    outcome: "failure",
    actor: { kind: "anonymous" },
    reason: `cloudflare-access:unverified:${reason}`,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
}
