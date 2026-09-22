/**
 * Email verification tokens (data-model §5).
 *
 * A row, hashed at rest, single-use. Talent makes its verification token a
 * stateless JWT with no row at all, so a leaked link there cannot be revoked —
 * only waited out for 24 hours (R1 §1). A row makes single-use enforceable and
 * revocation possible, and hashing it costs nothing.
 *
 * **Verification gates learning, not signing in** (contracts/auth.md
 * cross-cutting 5, Samuel's default). A student who never received the mail can
 * sign in and reach a screen that says what is outstanding, with a resend. The
 * alternative — Talent's, where signup hands out a token and login then refuses
 * until verified (R1 §2) — strands a fourteen-year-old behind a mail server
 * they cannot debug.
 *
 * **Consuming never reveals whose address the token belonged to** (FR-2004).
 * The route 302s either way; only the outcome differs, never the identity.
 */

import { generateToken, hashToken, verificationExpiry } from "./tokens.ts";
import type { AuthEventRecorder } from "./events.ts";
import type { Queryable } from "./throttle.ts";

export type IssuedToken = { token: string; expiresAt: Date };

/**
 * Issue a link for this account and emit `email_verification_sent`.
 *
 * Any outstanding token for the account is consumed first: two live links for
 * one address means the older one still works after the student asked for a new
 * one, which is the whole point of a resend.
 */
export async function issueVerificationToken(
  db: Queryable,
  accountId: number,
  environment: string,
  record: AuthEventRecorder,
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date()
): Promise<IssuedToken> {
  const token = generateToken();
  const expiresAt = verificationExpiry(now);
  await db.query(
    `UPDATE verification_tokens SET consumed_at = $2
      WHERE account_id = $1 AND consumed_at IS NULL`,
    [accountId, now]
  );
  await db.query(
    `INSERT INTO verification_tokens (account_id, token_hash, expires_at, environment)
     VALUES ($1, $2, $3, $4)`,
    [accountId, hashToken(token), expiresAt, environment]
  );
  await record({
    event: "email_verification_sent",
    outcome: "success",
    actor: { kind: "account", id: accountId },
    subject: { kind: "account", id: accountId },
    reason: "verification_link",
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { token, expiresAt };
}

export type ConsumeResult = { ok: true; accountId: number } | { ok: false };

/**
 * Spend a verification link.
 *
 * The UPDATE carries the single-use condition, so two clicks on the same link
 * from two tabs cannot both succeed — `consumed_at` is set in the same
 * statement that reads the row, which is what "in the same transaction" has to
 * mean to be worth anything.
 */
export async function consumeVerificationToken(
  db: Queryable,
  token: string,
  record: AuthEventRecorder,
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date()
): Promise<ConsumeResult> {
  const res = await db.query(
    `UPDATE verification_tokens SET consumed_at = $2
      WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > $2
      RETURNING account_id`,
    [hashToken(token), now]
  );
  const row = res.rows[0];
  if (!row) return { ok: false };
  const accountId = Number(row.account_id);
  await db.query(
    `UPDATE accounts SET email_verified_at = coalesce(email_verified_at, $2) WHERE id = $1`,
    [accountId, now]
  );
  await record({
    event: "email_verification_succeeded",
    outcome: "success",
    actor: { kind: "account", id: accountId },
    subject: { kind: "account", id: accountId },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true, accountId };
}

export type ResendTarget = { accountId: number; email: string };

/**
 * Who a resend is for — by account id (a signed-in student tapping the banner)
 * or by address (an anonymous caller typing it).
 *
 * The banner cannot send an address: `/api/auth/me` deliberately returns no
 * email, because a page that does not need a minor's address should not be
 * handed one. So the session path resolves it here, server-side, from the
 * principal — the address never makes the round trip in either direction.
 *
 * Returns null for an unknown account and for one already verified, so both
 * answer the same 202 with nothing sent.
 */
export async function resolveResendTarget(
  db: Queryable,
  by: { accountId: number } | { email: string }
): Promise<ResendTarget | null> {
  const res =
    "accountId" in by
      ? await db.query(
          `SELECT id, email FROM accounts WHERE id = $1 AND email_verified_at IS NULL`,
          [by.accountId]
        )
      : await db.query(
          `SELECT id, email FROM accounts
            WHERE lower(email) = lower($1) AND email_verified_at IS NULL`,
          [by.email]
        );
  const row = res.rows[0];
  if (!row) return null;
  return { accountId: Number(row.id), email: String(row.email) };
}

/**
 * The resend budget's key.
 *
 * Namespaced with `resend:` on purpose: the `account` scope is also where
 * `noteCredentialFailure` counts failed sign-ins under `accounts:<id>`, and
 * sharing that key would let tapping "send it again" five times lock the
 * account out of signing in.
 */
export function resendThrottleKey(accountId: number): string {
  return `resend:accounts:${accountId}`;
}

/** Milliseconds from account creation to verification — `email_verified`'s property. */
export async function elapsedSinceSignup(
  db: Queryable,
  accountId: number,
  now: Date = new Date()
): Promise<number | null> {
  const res = await db.query(`SELECT created_at FROM accounts WHERE id = $1`, [accountId]);
  const created = res.rows[0]?.created_at;
  if (!created) return null;
  return now.getTime() - new Date(created as string).getTime();
}
