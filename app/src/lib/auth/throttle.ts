/**
 * Rate limiting and lockout, in Postgres, because there are two Node processes.
 *
 * The deciding fact (research R5) is that the student surface and the console
 * are two processes against one database. An in-memory limiter gives each its
 * own budget, so a threshold of five quietly becomes a threshold of ten and
 * nobody notices until the day it matters. A row per attempt is a trivial write
 * at pilot volume and survives the container restarts a small box does
 * routinely.
 *
 * The numbers are Samuel's, stated rather than discovered (FR-2011):
 *   · **5 failed sign-ins for one account in 15 minutes → locked for 15 minutes**,
 *     emitting `account_locked`.
 *   · **20 failed sign-ins from one IP in 15 minutes → throttled**, emitting
 *     `suspicious_activity`.
 *   · A lockout that has expired is cleared the next time it is observed, and
 *     that clearing emits `lockout_cleared` — an event nothing would ever fire
 *     if expiry were left to a `WHERE locked_until < now()` somewhere.
 *
 * Fixed windows, not sliding: `window_start` is the current 15-minute boundary,
 * so the counter is one atomic `INSERT … ON CONFLICT DO UPDATE` with no read
 * first and no race to lose. The cost is the usual fixed-window edge — up to
 * two windows' worth of attempts across a boundary — which at 5 and 20 is not
 * the difference between safe and unsafe.
 *
 * Every function here takes its database handle as a parameter and its event
 * recorder as a parameter. That is what makes the lockout branch testable
 * without a database (SC-106) instead of testable only in production.
 */

import type { AuthEventRecorder } from "./events.ts";

export const WINDOW_MS = 15 * 60 * 1000;
export const LOCKOUT_MS = 15 * 60 * 1000;
export const ACCOUNT_FAILURE_LIMIT = 5;
export const IP_FAILURE_LIMIT = 20;

/** The minimum a caller needs from `pg` — so a test can pass an object literal. */
export type Queryable = {
  query: (
    text: string,
    values?: readonly unknown[]
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
};

export type PrincipalTable = "accounts" | "operators";

/**
 * The counters this table keeps. `scope` is free text in the schema
 * (migration 013 comments `account | ip | email`); this union is the list.
 * The two `cf_unverified_*` scopes (ADR-0022, security review F11) count
 * console sign-in assertions that did not verify — per address and in total —
 * so that the RECORD of them cannot be flooded. They are separate from `ip` on
 * purpose: a misconfigured Access application must not spend an operator's
 * password-sign-in budget and lock them out of the fallback.
 */
export type ThrottleScope = "account" | "ip" | "email" | "cf_unverified_ip" | "cf_unverified_all";

/** The current fixed window's start: `now` floored to a 15-minute boundary. */
export function windowStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS);
}

/** Seconds until the current window rolls over — what `retryAfter` reports. */
export function retryAfterSeconds(now: Date): number {
  const end = windowStart(now).getTime() + WINDOW_MS;
  return Math.max(1, Math.ceil((end - now.getTime()) / 1000));
}

export function lockedUntil(now: Date): Date {
  return new Date(now.getTime() + LOCKOUT_MS);
}

/** A lockout is in force only while its deadline is still ahead of us. */
export function isLocked(until: Date | null | undefined, now: Date): boolean {
  return until != null && until.getTime() > now.getTime();
}

/** Expired, but still recorded on the row — the state that owes a `lockout_cleared`. */
export function lockoutExpired(until: Date | null | undefined, now: Date): boolean {
  return until != null && until.getTime() <= now.getTime();
}

export function limitReached(count: number, limit: number): boolean {
  return count >= limit;
}

/** Atomic increment of one fixed-window counter. Returns the new count. */
export async function bumpThrottle(
  db: Queryable,
  scope: ThrottleScope,
  key: string,
  now: Date = new Date()
): Promise<number> {
  const res = await db.query(
    `INSERT INTO auth_throttle (scope, key, window_start, count)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (scope, key, window_start)
     DO UPDATE SET count = auth_throttle.count + 1
     RETURNING count`,
    [scope, key, windowStart(now)]
  );
  return Number(res.rows[0]?.count ?? 1);
}

/** Read a counter without touching it — the pre-flight check on a request. */
export async function peekThrottle(
  db: Queryable,
  scope: ThrottleScope,
  key: string,
  now: Date = new Date()
): Promise<number> {
  const res = await db.query(
    `SELECT count FROM auth_throttle WHERE scope = $1 AND key = $2 AND window_start = $3`,
    [scope, key, windowStart(now)]
  );
  return Number(res.rows[0]?.count ?? 0);
}

/**
 * Is this address already over its budget for this window?
 *
 * Checked BEFORE the credential is looked at, so a sprayed attack costs one
 * indexed read rather than one Argon2id verification per guess.
 */
export async function ipOverLimit(
  db: Queryable,
  ip: string | null,
  now: Date = new Date()
): Promise<{ over: boolean; retryAfter: number }> {
  if (!ip) return { over: false, retryAfter: 0 };
  const count = await peekThrottle(db, "ip", ip, now);
  return { over: limitReached(count, IP_FAILURE_LIMIT), retryAfter: retryAfterSeconds(now) };
}

/** Count one failure against the address, and say whether that tipped it over. */
export async function noteIpFailure(
  db: Queryable,
  ip: string | null,
  record: AuthEventRecorder,
  meta: { userAgent?: string | null } = {},
  now: Date = new Date()
): Promise<boolean> {
  if (!ip) return false;
  const count = await bumpThrottle(db, "ip", ip, now);
  if (!limitReached(count, IP_FAILURE_LIMIT)) return false;
  await record({
    event: "suspicious_activity",
    outcome: "denied",
    actor: { kind: "anonymous" },
    reason: "ip_throttled",
    ip,
    userAgent: meta.userAgent ?? null,
  });
  return true;
}

/** Same budget, counted per email so one address cannot spray many accounts. */
export async function emailOverLimit(
  db: Queryable,
  email: string,
  now: Date = new Date()
): Promise<{ over: boolean; retryAfter: number }> {
  const count = await peekThrottle(db, "email", email, now);
  return { over: limitReached(count, IP_FAILURE_LIMIT), retryAfter: retryAfterSeconds(now) };
}

export type LockoutResult = { locked: boolean; until: Date | null; failures: number };

/**
 * Count one failed credential against an account and lock it at the fifth.
 *
 * `failed_attempts` on the row is kept in step with the windowed counter so the
 * console's security view can show it without joining the throttle table, which
 * is operational state and reports nothing (data-model §6).
 */
export async function noteCredentialFailure(
  db: Queryable,
  table: PrincipalTable,
  id: number,
  record: AuthEventRecorder,
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date()
): Promise<LockoutResult> {
  const failures = await bumpThrottle(db, "account", `${table}:${id}`, now);
  if (!limitReached(failures, ACCOUNT_FAILURE_LIMIT)) {
    await db.query(`UPDATE ${table} SET failed_attempts = $2 WHERE id = $1`, [id, failures]);
    return { locked: false, until: null, failures };
  }
  const until = lockedUntil(now);
  // `operators` has no status column transition for lockout in data-model §7 —
  // it carries `locked_until` only — so the status flip is accounts-only.
  const sql =
    table === "accounts"
      ? `UPDATE accounts SET failed_attempts = $2, locked_until = $3, status = 'locked'
           WHERE id = $1 AND status <> 'disabled'`
      : `UPDATE operators SET failed_attempts = $2, locked_until = $3 WHERE id = $1`;
  await db.query(sql, [id, failures, until]);
  await record({
    event: "account_locked",
    outcome: "denied",
    actor: { kind: table === "accounts" ? "account" : "operator", id },
    subject: { kind: table === "accounts" ? "account" : "operator", id },
    reason: `failed_attempts:${failures}`,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { locked: true, until, failures };
}

/**
 * Clear an expired lockout and say so — the only place `lockout_cleared` comes
 * from on the automatic path (FR-2501 #4). Returns true when it actually fired,
 * so a caller can tell "was locked, now isn't" from "was never locked".
 */
export async function clearExpiredLockout(
  db: Queryable,
  table: PrincipalTable,
  id: number,
  until: Date | null,
  record: AuthEventRecorder,
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date()
): Promise<boolean> {
  if (!lockoutExpired(until, now)) return false;
  const sql =
    table === "accounts"
      ? `UPDATE accounts SET locked_until = NULL, failed_attempts = 0,
           status = CASE WHEN status = 'locked' THEN 'active' ELSE status END
           WHERE id = $1`
      : `UPDATE operators SET locked_until = NULL, failed_attempts = 0 WHERE id = $1`;
  await db.query(sql, [id]);
  await record({
    event: "lockout_cleared",
    outcome: "success",
    actor: { kind: table === "accounts" ? "account" : "operator", id },
    subject: { kind: table === "accounts" ? "account" : "operator", id },
    reason: "expired",
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return true;
}

/**
 * A clean sign-in zeroes the counter — the window is about CONSECUTIVE failure.
 *
 * Zeroed with an UPDATE, not removed with a DELETE, for a grant reason and a
 * transaction reason, and the second one is the sharp one:
 *
 *  · `ainext_app` holds SELECT, INSERT and UPDATE on `auth_throttle` and **no
 *    DELETE** (migration 017) — the upsert needs UPDATE, so zeroing is already
 *    within the grants the counter requires.
 *  · A DELETE here raised `permission denied`, and **a caught SQL error inside a
 *    transaction is not a caught error**: Postgres has already aborted the
 *    transaction, so the JS `catch` swallowed the cause and every later
 *    statement failed with "current transaction is aborted". The symptom was a
 *    500 on the first correct password after a password reset — a sign-in that
 *    should have worked, failing for a tidy-up nobody needed. Verified live
 *    against `ainext_app`, 2026-09-20.
 *
 * The row itself is left to expire with its window and the nightly sweep
 * (data-model §6): it is operational state and reports nothing.
 */
export async function clearFailures(
  db: Queryable,
  table: PrincipalTable,
  id: number
): Promise<void> {
  await db.query(`UPDATE ${table} SET failed_attempts = 0, locked_until = NULL WHERE id = $1`, [id]);
  await db.query(
    `UPDATE auth_throttle SET count = 0 WHERE scope = 'account' AND key = $1`,
    [`${table}:${id}`]
  );
}
