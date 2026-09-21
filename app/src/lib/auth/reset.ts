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

/**
 * Which table this reset belongs to.
 *
 * Both arms exist because ADR-0014 decides the seeded operator gets **no
 * password** — `bootstrap-operator.mts` writes the row and sets `password_hash`
 * NULL, so that no credential ever sits in a config file — and then says Samuel
 * obtains one "through the ordinary reset flow". Until migration 019 that flow
 * could not reach him: `password_resets.account_id` was NOT NULL with a foreign
 * key to `accounts`, and operators are deliberately a separate table
 * (data-model §7). The decision that keeps credentials out of configuration was
 * the decision locking the first operator out of the console.
 *
 * The arms never cross. A console reset consumes only an `operator_id` row and
 * a student reset only an `account_id` row, so a leaked token is useless on the
 * other surface even before RLS refuses it.
 */
export type ResetPrincipal = "account" | "operator";

function column(kind: ResetPrincipal): "account_id" | "operator_id" {
  return kind === "account" ? "account_id" : "operator_id";
}

export async function issueResetToken(
  db: Queryable,
  kind: ResetPrincipal,
  id: number,
  environment: string,
  record: AuthEventRecorder,
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date()
): Promise<IssuedReset> {
  const token = generateToken();
  const expiresAt = resetExpiry(now);
  const col = column(kind);
  await db.query(
    `UPDATE password_resets SET consumed_at = $2 WHERE ${col} = $1 AND consumed_at IS NULL`,
    [id, now]
  );
  await db.query(
    `INSERT INTO password_resets (${col}, token_hash, expires_at, environment)
     VALUES ($1, $2, $3, $4)`,
    [id, hashToken(token), expiresAt, environment]
  );
  await record({
    event: "password_reset_requested",
    outcome: "success",
    actor: { kind, id },
    subject: { kind, id },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { token, expiresAt };
}

export type ResetResult =
  | { ok: true; kind: ResetPrincipal; id: number; revoked: number }
  | { ok: false };

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
  kind: ResetPrincipal,
  record: AuthEventRecorder,
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date()
): Promise<ResetResult> {
  const col = column(kind);
  // The arm is part of the predicate, not a check afterwards: a student token
  // presented to the console (or the reverse) matches no row at all, so it
  // cannot even be consumed, let alone honoured.
  const res = await db.query(
    `UPDATE password_resets SET consumed_at = $2
      WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > $2
        AND ${col} IS NOT NULL
      RETURNING ${col} AS principal_id`,
    [hashToken(token), now]
  );
  const row = res.rows[0];
  if (!row) return { ok: false };
  const id = Number(row.principal_id);
  const hash = await hashPassword(newPassword);

  // `operators` has no `status` transition for lockout (data-model §7) — it
  // carries `locked_until` only — so the two UPDATEs differ by exactly that.
  await db.query(
    kind === "account"
      ? `UPDATE accounts
            SET password_hash = $2, failed_attempts = 0, locked_until = NULL,
                status = CASE WHEN status = 'locked' THEN 'active' ELSE status END
          WHERE id = $1`
      : `UPDATE operators
            SET password_hash = $2, failed_attempts = 0, locked_until = NULL,
                email_verified_at = coalesce(email_verified_at, now())
          WHERE id = $1`,
    [id, hash]
  );

  const revoked = await revokeAllForPrincipal(
    db,
    kind === "account" ? { accountId: id } : { operatorId: id },
    record,
    "password_reset",
    meta,
    now
  );
  await record({
    event: "password_reset_completed",
    outcome: "success",
    actor: { kind, id },
    subject: { kind, id },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  await record({
    event: "password_changed",
    outcome: "success",
    actor: { kind, id },
    subject: { kind, id },
    reason: "reset",
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true, kind, id, revoked };
}
