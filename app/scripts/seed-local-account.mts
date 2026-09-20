/**
 * A pre-verified LOCAL-ONLY account for the seeded student (Samuel's default —
 * the demo cast retires to `status='legacy'` and this is what replaces the
 * picker for local work).
 *
 * **It refuses to run anywhere but a local machine.** Two conditions, both
 * required: `AINEXT_ENVIRONMENT=mvp1` and an `AINEXT_PUBLIC_URL` that starts
 * with `http://localhost`. A seeded account with a published password is a back
 * door, and the only thing standing between "convenient locally" and "a back
 * door on the box" is this check — so it is a refusal, not a warning.
 *
 * Idempotent: re-running rebinds and re-verifies rather than creating a second
 * account. Prints the credentials, loudly, because they are meant to be typed.
 *
 *   node --import ./scripts/ts-resolver.mjs scripts/seed-local-account.mts
 */

import { withMaint } from "../src/lib/db.ts";
import { hashPassword } from "../src/lib/auth/password.ts";

const EMAIL = "omar@local.test";
const PASSWORD = "omar-local-test";
const STUDENT_NAME = "Omar (demo)";

/**
 * Read RAW, not through `lib/env.ts`, on purpose. `env.ts` gives both of these
 * honest defaults — `ENVIRONMENT` falls back to `baseline` and `PUBLIC_URL` to
 * `http://localhost:3000` — which is right for the application and exactly
 * wrong for a guard, because an UNSET variable would then satisfy the localhost
 * check on a box. This one must fail closed on absence.
 */
const environment = (process.env.AINEXT_ENVIRONMENT ?? "").trim();
const publicUrl = (process.env.AINEXT_PUBLIC_URL ?? "").trim();

if (environment !== "mvp1" || !publicUrl.startsWith("http://localhost")) {
  console.error("seed-local-account: REFUSING TO RUN.");
  console.error(`  AINEXT_ENVIRONMENT = ${environment || "(unset)"} (must be "mvp1")`);
  console.error(`  AINEXT_PUBLIC_URL  = ${publicUrl || "(unset)"} (must start with http://localhost)`);
  console.error("  This script creates an account with a published password. It is local-only.");
  process.exit(1);
}

await withMaint(async (c) => {
  const hash = await hashPassword(PASSWORD);

  const existing = await c.query(`SELECT id FROM accounts WHERE lower(email) = lower($1)`, [EMAIL]);
  let accountId: number;
  if (existing.rows[0]) {
    accountId = Number(existing.rows[0].id);
    await c.query(
      `UPDATE accounts
          SET password_hash = $2, email_verified_at = coalesce(email_verified_at, now()),
              status = 'active', failed_attempts = 0, locked_until = NULL
        WHERE id = $1`,
      [accountId, hash]
    );
    console.log(`account ${EMAIL} already existed (id ${accountId}) — password and state reset`);
  } else {
    const created = await c.query(
      `INSERT INTO accounts (email, password_hash, email_verified_at, environment)
       VALUES ($1, $2, now(), $3) RETURNING id`,
      [EMAIL, hash, environment]
    );
    accountId = Number(created.rows[0].id);
    console.log(`created account ${EMAIL} (id ${accountId}), already verified`);
  }

  const student = await c.query(
    `SELECT id, account_id FROM students WHERE display_name = $1 ORDER BY id LIMIT 1`,
    [STUDENT_NAME]
  );
  if (!student.rows[0]) {
    console.error(`no student named "${STUDENT_NAME}" — run the seed loader first`);
    process.exit(1);
  }
  const studentId = Number(student.rows[0].id);
  const boundTo = student.rows[0].account_id == null ? null : Number(student.rows[0].account_id);
  if (boundTo != null && boundTo !== accountId) {
    console.error(
      `student ${studentId} is already bound to account ${boundTo}. Refusing to steal it.`
    );
    process.exit(1);
  }
  await c.query(`UPDATE students SET account_id = $2, status = 'active' WHERE id = $1`, [
    studentId,
    accountId,
  ]);
  console.log(`bound student ${studentId} ("${STUDENT_NAME}") to account ${accountId}`);
});

console.log("");
console.log("==========================================================");
console.log("  LOCAL ONLY — these credentials are in the repository.");
console.log("  Never seed this on the box, never reuse the password.");
console.log("");
console.log(`    email:    ${EMAIL}`);
console.log(`    password: ${PASSWORD}`);
console.log("==========================================================");
console.log("");
process.exit(0);
