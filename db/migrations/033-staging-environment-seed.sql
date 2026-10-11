-- ===========================================================================
-- 033 — the staging environment's course allow-list
--
-- Samuel's call, 2026-10-11, recorded as ADR-0024. Additive and idempotent.
-- Safe to re-run; `scripts/local-dev.sh` does, on every run, in filename order.
--
-- ⚠ NO REQUIREMENT COVERS A STAGING ENVIRONMENT. None has been invented here
-- or in `traceability.md` — CLAUDE.md calls that "matrix laundering". The record
-- is ADR-0024, and §9 item 18 of `specs/001-student-mvp1-delta/traceability.md`
-- names it as shipped-without-a-requirement with Samuel as owner.
-- ===========================================================================
--
-- WHY THIS MIGRATION HAS TO EXIST AT ALL.
--
-- Migration 023 made course visibility EXPLICIT ALLOW: a student sees a course
-- only where a row says `live` for her (course, grade), and **no row means
-- hidden**. It seeded that rule for the only two environments that then
-- existed, and said so in its own comment: "The environment set is CLOSED and
-- has exactly two members — `baseline` and `mvp1`, enumerated in
-- app/src/lib/env.ts".
--
-- ADR-0024 added a third, `staging`. Nothing about 023 is wrong; it is simply
-- that a brand-new environment inherits the safe answer, and the safe answer is
-- "nothing is visible". On a stack that is wiped and rebuilt on every deploy
-- that failure arrives every single time, and it arrives twice over:
--
--   1. A student on staging would sign in and be shown an empty catalogue.
--   2. `deploy/apply-migrations.sh` refuses to finish when `AINEXT_COURSE_GATING`
--      is on and no `live` row exists for `$AINEXT_ENVIRONMENT` — by design, so
--      that "every student locked out" is a failed deploy rather than a quiet
--      Sunday evening. Staging runs with the gate ON (a staging stack that
--      bypasses the gate is not testing the product), so without this seed the
--      deploy fails at the migration step, correctly and every time.
--
-- WHY A MIGRATION RATHER THAN A STEP IN THE DEPLOY WORKFLOW. The same argument
-- 023 makes for itself and `migrate` makes for being a compose service: a
-- curriculum rule that lives only in `.github/workflows/` is absent the moment
-- somebody brings the stack up by hand, which is a documented operation on this
-- box. The rule belongs with the schema that enforces it.
--
-- WHY IT SEEDS THE SAME ROW `mvp1` HAS. Staging exists to show the product as
-- production serves it, so its allow-list starts as production's. It is a
-- starting point and not a constraint: the console writes this table, so an
-- operator may turn courses on or off on staging afterwards without touching
-- this file — and `ON CONFLICT DO NOTHING` means a later deploy will not undo
-- their decision. That is deliberate, and it is the opposite of what a
-- `DO UPDATE` here would do.
--
-- WHAT IT DELIBERATELY DOES NOT SEED. `teaching_settings` (migration 030) is
-- one row per environment and "no row means off", so staging comes up with
-- Socratic probing off, exactly as `baseline` and `mvp1` each did until an
-- operator chose otherwise. Seeding a teaching behaviour to match production
-- would be inventing a decision nobody made for this stack. Same for
-- `student_testers`: no rows, nobody is a tester.
--
-- `environment` carries no CHECK constraint on any of these tables — it is
-- free text with a UNIQUE/PRIMARY KEY on the composite. So this migration adds
-- no DDL and changes no constraint; it is one row.
-- ---------------------------------------------------------------------------

INSERT INTO course_availability (environment, course_id, grade, state, note)
VALUES (
  'staging',
  'course:prep3-math-en',
  '9',
  'live',
  'Seeded by migration 033 (ADR-0024): staging starts from production''s allow-list.'
)
ON CONFLICT (environment, course_id, grade) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Verification — asserted, not assumed (the argument 020/021/022/023 make)
-- ---------------------------------------------------------------------------

DO $verify$
DECLARE
  live_count integer;
BEGIN
  IF to_regclass('public.course_availability') IS NULL THEN
    RAISE EXCEPTION
      'course_availability does not exist — migration 023 must run before 033';
  END IF;

  SELECT count(*) INTO live_count
    FROM course_availability
   WHERE environment = 'staging' AND state = 'live';

  -- Zero is the only failure. More than one is fine and expected over time:
  -- an operator may have turned further courses on through the console, and
  -- this migration must never read that as drift.
  IF live_count = 0 THEN
    RAISE EXCEPTION
      'no live course rule for environment ''staging'' after seeding — the '
      'staging deploy would come up with every student shown an empty catalogue';
  END IF;

  RAISE NOTICE 'staging course gate: ready — % live rule(s)', live_count;
END
$verify$;
