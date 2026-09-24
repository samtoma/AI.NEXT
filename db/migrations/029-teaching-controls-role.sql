-- ===========================================================================
-- 029 — the `teaching-controls` operator role, granted ONCE to the active
--       `content-review` holders who exist the first time this file runs
--
-- ADR-0021 (Samuel, 2026-09-24). Additive and idempotent. Safe to re-run;
-- `deploy/apply-migrations.sh` does, on every deploy, in filename order, and
-- so does `scripts/local-dev.sh`. Rollback:
-- `rollback/029-teaching-controls-role.down.sql`.
-- ===========================================================================
--
-- WHAT THE ROLE IS FOR. The console's Socratic-probing switch (`/teaching`,
-- migration 030) decides how the tutor teaches a child who answers wrongly.
-- It is a safety control in the same sense `content-review` is (ADR-0014),
-- and Samuel asked for it to be its OWN role rather than folded into
-- `content-review`, so it can be narrowed later without touching who may
-- review content. It is granted where `content-review` already is — once.
--
-- THE VOCABULARY IS NOT WIDENED HERE. Migration 014 owns the CHECK on
-- `operator_roles.role`, re-runs on every deploy and rebuilds it only when it
-- lacks one of the five values (see its header). This file only asserts that
-- it admits `teaching-controls`, and refuses to grant a value the table would
-- refuse.
--
-- ---------------------------------------------------------------------------
-- THE RE-RUN TRAP, AND WHY THE GUARD IS "EVER", NOT "NOW"
-- ---------------------------------------------------------------------------
-- Every migration re-runs on every deploy (no ledger — apply-migrations.sh
-- says why). A grant written as "give every operator teaching-controls if they
-- lack it" would silently hand it BACK, on the next deploy, to an operator
-- Samuel had deliberately removed it from — the exact failure the CI "First
-- operator" step is gated against for the other four roles.
--
-- So the one-time grant runs only when the role has NEVER been introduced in
-- this database, and "introduced" is read from TWO records, either of which
-- shuts the guard for good:
--
--   1. any `operator_roles` row for `teaching-controls`, active or revoked.
--      The table is append-only in practice (014: revoking stamps
--      `revoked_at`/`revoked_by`, it never deletes, and `ainext_operator`
--      holds no DELETE on it), so a revocation leaves the row that proves
--      the role was introduced;
--   2. any `auth_events` row whose reason is `migration-029:teaching-controls`
--      (written below, one per grant) or `bootstrap:teaching-controls`
--      (written by `app/scripts/bootstrap-operator.mts`). `auth_events` is
--      the append-only security record (016/017: INSERT for the app roles,
--      no UPDATE or DELETE for either), and — the reason it is read at all —
--      `rollback/029-teaching-controls-role.down.sql` deletes the
--      `operator_roles` rows and leaves these alone. So "roll back 029, then
--      roll forward" does NOT re-grant the role, least of all to an operator
--      it had been revoked from. Whoever held it before the rollback gets it
--      back from the dump the runbook says to take (deploy/DEPLOY-MVP1.md,
--      "Rolling back"), not from this file.
--
-- Proved on a scratch database (ADR-0021): introduce, revoke from one
-- operator, re-apply twice — still revoked; then rollback/029 and re-apply —
-- still revoked, and nothing granted to anybody.
--
-- THE ONE WAY TO RE-ARM IT, NAMED RATHER THAN DISCOVERED: hard-deleting every
-- `teaching-controls` row from `operator_roles` AND every `auth_events` row
-- carrying one of those two reasons. Only `ainext_maint` or the owner can do
-- either, nothing in the product or in any rollback file does both, and doing
-- it is erasing a security record — so it is a decision, not an accident.
--
-- WHO GETS IT. Every ACTIVE operator (`status = 'active'`) holding an ACTIVE
-- `content-review` grant at that moment — the role `teaching-controls` is
-- split out of. A disabled operator, or one whose `content-review` had been
-- revoked, was stripped of the safety control this one comes from on purpose;
-- granting them its successor would be the re-grant trap in another form.
-- Today every console operator holds every role, so nobody who could move
-- the switch under `content-review` loses the ability. Each grant carries
-- `granted_by = NULL` (no operator granted it: this file did) and gets a
-- `role_granted` security event with no actor and reason
-- `migration-029:teaching-controls`, so the Security page shows where it came
-- from — and that row is record 2 above.
--
-- A FRESH DATABASE has no operators when this first runs — the CI "First
-- operator" step and `local-dev.sh` create them afterwards. That is fine:
-- `app/scripts/bootstrap-operator.mts` grants all five roles to a new
-- operator, and the rows it writes (both records) then keep this guard shut.
-- The same holds for a database whose operators exist but none of whom holds
-- an active `content-review`: nothing is granted and nothing is recorded, so
-- the guard stays open until the first deploy at which somebody does.
--
-- NO TABLE LOCK ON RE-RUN. The guard is two SELECTs (the second a scan of
-- `auth_events`, which takes ACCESS SHARE and blocks no writer); on every
-- deploy after the first it returns before any write. The first run's INSERTs
-- take the ordinary row locks an INSERT takes.

BEGIN;

DO $grant$
DECLARE
  n_granted int := 0;
BEGIN
  -- The vocabulary has to admit the role first (014). Asserted, not assumed:
  -- an INSERT that failed the CHECK would fail the deploy with a message about
  -- a constraint, several files away from the cause.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.operator_roles'::regclass
       AND conname = 'operator_roles_role_check'
       AND pg_get_constraintdef(oid) LIKE '%teaching-controls%'
  ) THEN
    RAISE EXCEPTION
      'operator_roles_role_check does not admit teaching-controls — migration 014 '
      'must carry the five-role vocabulary (ADR-0021) before this file can run';
  END IF;

  -- EVER, not now: see the header. A revoked row counts, and so does the
  -- security record of any earlier grant — which is what survives
  -- rollback/029 deleting the rows.
  IF EXISTS (SELECT 1 FROM operator_roles WHERE role = 'teaching-controls')
     OR EXISTS (SELECT 1 FROM auth_events
                 WHERE reason IN ('migration-029:teaching-controls',
                                  'bootstrap:teaching-controls')) THEN
    RAISE NOTICE 'teaching-controls: already introduced in this database — '
                 'nothing granted (a re-run never re-grants, ADR-0021)';
    RETURN;
  END IF;

  WITH granted AS (
    INSERT INTO operator_roles (operator_id, role, environment, granted_by)
    SELECT o.id, 'teaching-controls', o.environment, NULL
      FROM operators o
     WHERE o.status = 'active'
       AND EXISTS (SELECT 1 FROM operator_roles r
                    WHERE r.operator_id = o.id
                      AND r.role = 'content-review'
                      AND r.revoked_at IS NULL)
    RETURNING operator_id, environment
  ), recorded AS (
    INSERT INTO auth_events
      (environment, event, outcome, actor_kind, actor_id, subject_kind, subject_id, reason)
    SELECT g.environment, 'role_granted', 'success', NULL, NULL, 'operator', g.operator_id,
           'migration-029:teaching-controls'
      FROM granted g
    RETURNING 1
  )
  SELECT count(*) INTO n_granted FROM recorded;

  IF n_granted = 0 THEN
    -- A fresh database: no qualifying operator yet, so nothing is written and
    -- the guard above stays open. The bootstrap script grants all five roles
    -- to the first operator, and from then on its rows keep this guard shut.
    RAISE NOTICE 'teaching-controls: no active operator holds content-review yet — nothing to grant';
  ELSE
    RAISE NOTICE 'teaching-controls: introduced — granted once to % active operator(s) '
                 'holding content-review', n_granted;
  END IF;
END
$grant$;

COMMIT;
