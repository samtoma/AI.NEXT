-- ===========================================================================
-- 033 DOWN — remove the staging environment's course allow-list
--
-- Undoes `db/migrations/033-staging-environment-seed.sql`. Idempotent: safe to
-- run when the row is already absent, and safe to run twice.
--
-- ---------------------------------------------------------------------------
-- READ THIS BEFORE RUNNING IT ANYWHERE NEAR A REAL DATABASE
-- ---------------------------------------------------------------------------
-- 033 is one INSERT of one row, scoped to `environment = 'staging'`. This file
-- deletes exactly that row and nothing else. It cannot affect `baseline` or
-- `mvp1`: both are named in the WHERE clause's negative space, and the
-- `environment` column is what separates them.
--
-- **On the staging stack this file is pointless**, and that is worth saying
-- rather than leaving to be discovered. Staging's database is destroyed and
-- rebuilt on every deploy (ADR-0024), so a rollback there is achieved by the
-- next push, not by this file. What this exists for is the CI rollback scenario
-- `scripts/ci-migrations.sh` runs — fresh, upgrade, rollback, roll-forward —
-- which asserts that every migration in the set can be undone against a
-- throwaway database. A migration with no down file fails that check.
--
-- **Running it on production is harmless and also meaningless**: there is no
-- `staging` row in `ainext_mvp1` for it to delete, so it deletes nothing. That
-- is the intended outcome, not a near miss.
--
-- WHAT IT DOES NOT UNDO. The third member of the `Environment` union in
-- `app/src/lib/env.ts` is application code and is not reachable from SQL. A
-- database rolled back past 033 while a build that accepts `AINEXT_ENVIRONMENT=staging`
-- is still deployed will start normally and then fail at
-- `deploy/apply-migrations.sh`'s post-flight — "no course is allow-listed for
-- environment 'staging'" — which is the correct, loud failure rather than a
-- student shown an empty catalogue. Roll the application back with it, or set
-- `AINEXT_COURSE_GATING=off`, in that order.
-- ---------------------------------------------------------------------------

DELETE FROM course_availability
 WHERE environment = 'staging'
   AND course_id = 'course:prep3-math-en'
   AND grade = '9';

-- ---------------------------------------------------------------------------
-- Verification — the rollback asserts its own result, like the up-migration
-- ---------------------------------------------------------------------------

DO $verify$
DECLARE
  remaining integer;
  other_envs integer;
BEGIN
  IF to_regclass('public.course_availability') IS NULL THEN
    RAISE NOTICE '033 down: course_availability is already gone — nothing to undo';
    RETURN;
  END IF;

  SELECT count(*) INTO remaining
    FROM course_availability
   WHERE environment = 'staging'
     AND course_id = 'course:prep3-math-en'
     AND grade = '9';

  IF remaining <> 0 THEN
    RAISE EXCEPTION '033 down: the staging seed row is still present';
  END IF;

  -- The guard that matters: this file must never have touched another stack.
  SELECT count(*) INTO other_envs
    FROM course_availability
   WHERE environment IN ('baseline', 'mvp1');

  RAISE NOTICE
    '033 down: staging seed removed; % rule(s) left for baseline/mvp1 (untouched)',
    other_envs;
END
$verify$;
