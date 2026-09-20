/**
 * Password reset tokens (data-model §5).
 *
 * Same shape as verification — a row, hashed at rest, single-use — with a
 * one-hour life instead of a day. Talent stores its reset token in plaintext
 * (R1 §1); a database read there is a password reset for every pending user.
 *
 * Two asymmetries worth stating, both deliberate:
 *
 *  · **`forgot-password` answers identically whether or not the address is
 *    registered** (FR-2010) — the one enumeration defence Talent also gets
 *    right, and the reason mail dispatch happens after the response in its own
 *    error boundary: a delivery failure must not leak through the status.
 *  · **`reset-password` does not apply that defence**, and says plainly that a
 *    token is unknown, spent or expired. By that point the token is the secret,
 *    not the email, and a vague error here only strands the person holding a
 *    valid link that expired ten minutes ago.
 *
 * Completing a reset **revokes every session for the account** in the same
 * transaction. A password is reset because it may be known to someone else;
 * leaving their existing sign-ins alive makes the reset cosmetic.
 */

import { hashPassword } from "./password.ts";
import { generateToken, hashToken, resetExpiry } from "./tokens.ts";
import type { AuthEventRecorder } from "./events.ts";
import type { Queryable } from "./throttle.ts";
import { revokeAllForPrincipal } from "./session.ts";

export type IssuedReset = { token: string; expiresAt: Date };

export async function issueResetToken(
  db: Queryable,
  accountId: number,
  environment: string,
  record: AuthEventRecorder,
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date()
): Promise<IssuedReset> {
  const token = generateToken();
  const expiresAt = resetExpiry(now);
  await db.query(
    `UPDATE password_resets SET consumed_at = $2 WHERE account_id = $1 AND consumed_at IS NULL`,
    [accountId, now]
  );
  await db.query(
    `INSERT INTO password_resets (account_id, token_hash, expires_at, environment)
     VALUES ($1, $2, $3, $4)`,
    [accountId, hashToken(token), expiresAt, environment]
  );
  await record({
    event: "password_reset_requested",
    outcome: "success",
    actor: { kind: "account", id: accountId },
    subject: { kind: "account", id: accountId },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { token, expiresAt };
}

export type ResetResult = { ok: true; accountId: number; revoked: number } | { ok: false };

/**
 * Spend a reset link and set the new password.
 *
 * Order matters: the token is consumed by the same UPDATE that reads it, the
 * hash is written, then every session dies. A failure anywhere in between rolls
 * back with the caller's transaction, so there is no state where the token is
 * spent and the password is unchanged.
 */
export async function completeReset(
  db: Queryable,
  token: string,
  newPassword: string,
  record: AuthEventRecorder,
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date()
): Promise<ResetResult> {
  const res = await db.query(
    `UPDATE password_resets SET consumed_at = $2
      WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > $2
      RETURNING account_id`,
    [hashToken(token), now]
  );
  const row = res.rows[0];
  if (!row) return { ok: false };
  const accountId = Number(row.account_id);

  await db.query(
    `UPDATE accounts
        SET password_hash = $2, failed_attempts = 0, locked_until = NULL,
            status = CASE WHEN status = 'locked' THEN 'active' ELSE status END
      WHERE id = $1`,
    [accountId, await hashPassword(newPassword)]
  );

  const revoked = await revokeAllForPrincipal(
    db,
    { accountId },
    record,
    "password_reset",
    meta,
    now
  );
  await record({
    event: "password_reset_completed",
    outcome: "success",
    actor: { kind: "account", id: accountId },
    subject: { kind: "account", id: accountId },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  await record({
    event: "password_changed",
    outcome: "success",
    actor: { kind: "account", id: accountId },
    subject: { kind: "account", id: accountId },
    reason: "reset",
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true, accountId, revoked };
}
