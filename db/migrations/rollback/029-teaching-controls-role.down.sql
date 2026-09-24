-- ===========================================================================
-- 029 DOWN — withdraw the `teaching-controls` operator role
--
-- Undoes `db/migrations/029-teaching-controls-role.sql`. Idempotent: safe to
-- run when no such row exists, and safe to run twice.
--
-- WHY THIS DELETES ROWS FROM AN APPEND-ONLY TABLE. `operator_roles` keeps
-- revoked grants as history and nothing in the product deletes from it. This
-- file does, deliberately, because a build from before v0.7.0 CANNOT be
-- deployed while any `teaching-controls` row exists: its migration 014 re-adds
-- the four-value CHECK on every deploy, and Postgres refuses to add a CHECK
-- that an existing row violates — the deploy stops, and on the box that is the
-- site down. So rolling the RELEASE back needs this run first; rolling only
-- the feature back (keeping the v0.7.0 build) does not need it at all.
--
-- WHAT IS LOST: who held `teaching-controls`, and when it was granted or
-- revoked. The `role_granted` security events migration 029 wrote stay in
-- `auth_events` (they record that it happened, and nothing reads them to
-- decide anything). Take a dump first if the grant history matters:
--
--   pg_dump -t operator_roles <db> > 029-operator-roles.sql
--
-- WHAT IT DOES NOT DO:
--   * It does not narrow 014's CHECK back to four values. Whichever build is
--     deployed next re-runs its own 014, which sets the vocabulary it knows.
--   * It re-arms 029's one-time grant: with no `teaching-controls` row left,
--     re-applying 029 grants the role again to every operator holding a role.
--     That is the correct behaviour for "the feature is back", and it is why
--     this file is for withdrawing the role, not for revoking it from one
--     person — do THAT with an UPDATE stamping `revoked_at`/`revoked_by`.
--   * The switch in `teaching_settings` (030) is untouched: without the role
--     nobody can change it, and it stays where it was left.
-- ===========================================================================

BEGIN;

DELETE FROM operator_roles WHERE role = 'teaching-controls';

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM operator_roles WHERE role = 'teaching-controls') THEN
    RAISE EXCEPTION 'teaching-controls rows survive the rollback';
  END IF;
  RAISE NOTICE 'teaching-controls: withdrawn. A pre-v0.7.0 build may now be deployed.';
END
$verify$;

COMMIT;
