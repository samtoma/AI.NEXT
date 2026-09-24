-- ===========================================================================
-- 029 DOWN — withdraw the `teaching-controls` operator role
--
-- Undoes `db/migrations/029-teaching-controls-role.sql`. Idempotent: safe to
-- run when no such row exists, and safe to run twice.
--
-- ⚠ YOU PROBABLY DO NOT NEED THIS FILE. v0.6.1 and every later release guard
-- migration 014: its CHECK on `operator_roles.role` is rebuilt only when it
-- lacks one of that release's roles, so a v0.7.0 database holding
-- `teaching-controls` rows can take a v0.6.1 redeploy as it is. To roll the
-- FEATURE back, set the /teaching switch to Off (no deploy). To roll the CODE
-- back, revert the merge and deploy. deploy/DEPLOY-MVP1.md, "Rolling back".
--
-- WHY IT EXISTS: v0.6.0 AND EARLIER. Their 014 drops and re-adds a four-value
-- CHECK unconditionally on every deploy, and Postgres refuses to add a CHECK
-- an existing row violates — the deploy stops, and on the box that is the
-- site down. Redeploying one of those builds after v0.7.0 therefore needs
-- this run first. Never do that by choice (the runbook says so).
--
-- WHY THIS DELETES ROWS FROM AN APPEND-ONLY TABLE. `operator_roles` keeps
-- revoked grants as history and nothing in the product deletes from it. This
-- file does, deliberately, for the reason above.
--
-- WHAT IS LOST: who held `teaching-controls`, and when it was granted or
-- revoked. TAKE A DUMP FIRST — it is the only way that state comes back:
--
--   psql <db> -c "\copy (SELECT * FROM operator_roles WHERE role = 'teaching-controls') TO '029-operator-roles.csv' CSV HEADER"
--
-- and after the next roll-forward (v0.7.0 or later) put it back exactly:
--
--   psql <db> -c "\copy operator_roles FROM '029-operator-roles.csv' CSV HEADER"
--
-- WHAT IT DOES NOT DO:
--   * It does not touch `auth_events`. The `role_granted` security events
--     migration 029 and the bootstrap script wrote (reasons
--     `migration-029:teaching-controls`, `bootstrap:teaching-controls`) stay,
--     and 029 reads them: re-applying 029 after this file grants the role to
--     NOBODY — above all not to an operator it had been revoked from. That
--     is why the dump above is how the grants come back.
--   * It does not narrow 014's CHECK back to four values. Whichever build is
--     deployed next re-runs its own 014, which sets the vocabulary it needs.
--   * The switch in `teaching_settings` (030) is untouched: without the role
--     nobody can change it, and it stays where it was left.
--   * It is not how to revoke the role from one person — do THAT with an
--     UPDATE stamping `revoked_at`/`revoked_by` on their row.
-- ===========================================================================

BEGIN;

DELETE FROM operator_roles WHERE role = 'teaching-controls';

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM operator_roles WHERE role = 'teaching-controls') THEN
    RAISE EXCEPTION 'teaching-controls rows survive the rollback';
  END IF;
  RAISE NOTICE 'teaching-controls: withdrawn. A v0.6.0-or-earlier build may now be deployed; restore the dump after the next roll-forward.';
END
$verify$;

COMMIT;
