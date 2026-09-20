/**
 * Seed the first operator (ADR-0014, plan A5).
 *
 * A bare `.sql` file in the alphabetical migration glob cannot read an
 * environment variable, and the first operator's address is configuration — so
 * the seed is a script rather than migration 019. It is invoked by
 * `scripts/local-dev.sh` and by the deploy runbook.
 *
 * **It sets no password.** Samuel obtains one through the ordinary reset flow,
 * so no credential ever sits in a config file, a compose file or a shell
 * history. Re-running grants nothing new: the operator row is upserted by
 * lower(email) and each of the four roles is skipped if it is already held.
 *
 * Runs under `ainext_maint` (BYPASSRLS) because `operators` and `operator_roles`
 * have no grant to `ainext_app` at all — a student principal cannot even see
 * that operators exist (data-model §14).
 *
 *   node --import ./scripts/ts-resolver.mjs scripts/bootstrap-operator.mts
 */

import { withMaint } from "../src/lib/db.ts";
import { BOOTSTRAP_OPERATOR_EMAIL, ENVIRONMENT } from "../src/lib/env.ts";

const ROLES = ["content-review", "evidence-access", "student-data", "cost-billing"] as const;

const email = BOOTSTRAP_OPERATOR_EMAIL;
if (!email) {
  console.error(
    "AINEXT_BOOTSTRAP_OPERATOR_EMAIL is unset. Refusing to guess who the first operator is."
  );
  process.exit(1);
}

const environment = ENVIRONMENT;
const displayName =
  (process.env.AINEXT_BOOTSTRAP_OPERATOR_NAME ?? "").trim() || (email.split("@")[0] ?? "Operator");

await withMaint(async (c) => {
  const existing = await c.query(`SELECT id FROM operators WHERE lower(email) = lower($1)`, [
    email,
  ]);

  let operatorId: number;
  if (existing.rows[0]) {
    operatorId = Number(existing.rows[0].id);
    console.log(`operator ${email} already exists (id ${operatorId}) — left untouched`);
  } else {
    const created = await c.query(
      `INSERT INTO operators (email, display_name, status, environment)
       VALUES ($1, $2, 'active', $3) RETURNING id`,
      [email, displayName, environment]
    );
    operatorId = Number(created.rows[0].id);
    console.log(`created operator ${email} (id ${operatorId}) with NO password`);
    console.log(`  → set one with the ordinary reset flow; nothing here holds a credential`);
  }

  for (const role of ROLES) {
    const held = await c.query(
      `SELECT 1 FROM operator_roles
        WHERE operator_id = $1 AND role = $2 AND revoked_at IS NULL`,
      [operatorId, role]
    );
    if (held.rows.length > 0) {
      console.log(`  role ${role}: already held — skipped`);
      continue;
    }
    await c.query(
      `INSERT INTO operator_roles (operator_id, role, environment) VALUES ($1, $2, $3)`,
      [operatorId, role, environment]
    );
    // Recorded, because a grant nobody can see later is a grant nobody can
    // audit — and `content-review` in particular is a safety control
    // (constitution III, FR-2204). Written directly rather than through
    // lib/auth/events.ts: that module writes as `ainext_app`, and this script
    // is the one path that runs as `ainext_maint`.
    await c.query(
      `INSERT INTO auth_events
         (environment, event, outcome, actor_kind, actor_id, subject_kind, subject_id, reason)
       VALUES ($1, 'role_granted', 'success', 'operator', $2, 'operator', $2, $3)`,
      [environment, operatorId, `bootstrap:${role}`]
    );
    console.log(`  role ${role}: granted`);
  }
});

console.log("bootstrap-operator: done");
process.exit(0);
