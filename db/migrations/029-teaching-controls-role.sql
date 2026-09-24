-- ===========================================================================
-- 029 — the `teaching-controls` operator role, granted ONCE to the operators
--       who exist the first time this file runs
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
-- review content. Today every console operator holds every role, so every
-- operator gets this one too — once.
--
-- THE VOCABULARY IS NOT WIDENED HERE. Migration 014 owns the CHECK on
-- `operator_roles.role`, re-runs on every deploy and re-adds it; it was
-- widened in place to five values (see its header). This file only asserts
-- that it has been, and refuses to grant a value the table would refuse.
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
-- So the one-time grant runs only when NO `operator_roles` row for
-- `teaching-controls` has EVER existed in this database — active or revoked.
-- `operator_roles` is append-only in practice (014: revoking stamps
-- `revoked_at`/`revoked_by` on the row, it never deletes it, and
-- `ainext_operator` holds no DELETE on it), so a revocation leaves the row
-- that proves the role was introduced, and the guard stays shut forever
-- after the first run. Proved on a scratch database: apply, revoke from one
-- operator, re-apply twice — that operator still lacks it (ADR-0021).
--
-- THE ONE WAY TO RE-ARM IT, NAMED RATHER THAN DISCOVERED: hard-deleting every
-- `teaching-controls` row (only `ainext_maint` or the owner can) — or deleting
-- every operator who ever held it, since `operator_roles` cascades from
-- `operators`. After that the next deploy would grant it again to whichever
-- operators then hold a role. Nothing in the product deletes those rows; the
-- rollback file does, deliberately, and says so.
--
-- WHO GETS IT. Every operator holding at least one ACTIVE role at that
-- moment — "a console operator with rights". An operator whose every role has
-- been revoked was stripped on purpose, and granting them a safety control
-- would be the re-grant trap in another form. Each grant carries
-- `granted_by = NULL` (no operator granted it: this file did) and gets a
-- `role_granted` security event with no actor and reason
-- `migration-029:teaching-controls`, so the Security page shows where it came
-- from.
--
-- A FRESH DATABASE has no operators when this first runs — the CI "First
-- operator" step and `local-dev.sh` create them afterwards. That is fine:
-- `app/scripts/bootstrap-operator.mts` grants all five roles to a new
-- operator, and the rows it writes are what then keep this guard shut.
--
-- NO TABLE LOCK ON RE-RUN. The guard is a SELECT; on every deploy after the
-- first it returns before any write. `operator_roles` is a small table read on
-- operator sign-in only, and the first run's INSERT takes the ordinary row
-- locks an INSERT takes.

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

  -- EVER, not now: see the header. A revoked row counts.
  IF EXISTS (SELECT 1 FROM operator_roles WHERE role = 'teaching-controls') THEN
    RAISE NOTICE 'teaching-controls: already introduced in this database — '
                 'nothing granted (a re-run never re-grants, ADR-0021)';
    RETURN;
  END IF;

  WITH granted AS (
    INSERT INTO operator_roles (operator_id, role, environment, granted_by)
    SELECT o.id, 'teaching-controls', o.environment, NULL
      FROM operators o
     WHERE EXISTS (SELECT 1 FROM operator_roles r
                    WHERE r.operator_id = o.id AND r.revoked_at IS NULL)
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
    -- A fresh database: no operator yet, so nothing is written and the guard
    -- above stays open. The bootstrap script grants all five roles to the
    -- first operator, and from then on its row keeps this guard shut.
    RAISE NOTICE 'teaching-controls: no operator holds a role yet — nothing to grant';
  ELSE
    RAISE NOTICE 'teaching-controls: introduced — granted once to % operator(s) '
                 'holding an active role', n_granted;
  END IF;
END
$grant$;

COMMIT;
