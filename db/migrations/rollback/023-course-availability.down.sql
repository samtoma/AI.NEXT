-- ===========================================================================
-- 023 DOWN — remove the course availability gate
--
-- Undoes `db/migrations/023-course-availability.sql`. Idempotent: safe to run
-- when the tables are already absent, and safe to run twice.
--
-- ⚠ THIS IS NOT THE PREFERRED WAY TO TURN THE GATE OFF. Set
-- `AINEXT_COURSE_GATING=off` (app/src/lib/env.ts) and restart: the gate stops
-- applying, the rules stay recorded, and turning it back on is one variable
-- rather than a re-migration and a re-entry of every decision an operator has
-- made. Run this file when the FEATURE is being withdrawn, not when it is
-- being paused.
--
-- ---------------------------------------------------------------------------
-- WHAT RUNNING THIS DOES TO THE PRODUCT
-- ---------------------------------------------------------------------------
-- It returns the product to **every course visible to every student** — the
-- pre-023 behaviour, where a course reached a child as soon as it was loaded
-- into the spine and no rule existed that could say otherwise. Note that the
-- application must be rolled back WITH it: `lib/catalog-queries.ts` reads
-- these tables, so a build from after 023 pointed at a database from before it
-- raises `relation "course_availability" does not exist` on every student
-- surface. With `AINEXT_COURSE_GATING` unset or `off` that read never happens,
-- which is the order to do this in: switch the gate off, deploy, then drop.
--
-- ---------------------------------------------------------------------------
-- WHY DROPPING THESE TWO TABLES IS SAFE, AND WHAT IS LOST
-- ---------------------------------------------------------------------------
-- **No student data lives in either table.** `course_availability` is a
-- curriculum fact. `student_course_access` is keyed by `student_id`, which is
-- what makes it student data for the purposes of RLS — but every row in it was
-- written by an OPERATOR about a student, not by a student. There is no
-- attempt, no mastery estimate, no conversation and nothing a child produced;
-- dropping it loses configuration and nothing that could be re-derived only
-- from a person. That is the whole difference between this file and, say, a
-- rollback of `attempts`, which would not be written at all.
--
-- What IS lost is every decision an operator recorded: which courses were on
-- for which grades, which students held an exception, who set each one and
-- when, and the notes they left. None of it is recoverable after the drop.
-- Take a dump first if any of it is worth keeping:
--
--   pg_dump -t course_availability -t student_course_access <db> > 023-rules.sql
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FILE DELIBERATELY DOES NOT UNDO
-- ---------------------------------------------------------------------------
--   * **No role is dropped and no pre-023 privilege is revoked.** `ainext_app`,
--     `ainext_operator` and `ainext_maint` are created by migration 017 and are
--     shared by every table in the schema; a `REVOKE` here aimed at "023's
--     grants" would be aimed at roles that exist for everything else. Dropping
--     a table takes its own grants and policies with it, which is exactly the
--     right scope, so this file does no revoking at all.
--   * **No RLS state is changed anywhere else.** 023 enabled row-level
--     security on one table, and that table is being dropped.
--   * **`AINEXT_COURSE_GATING` is not touched** — it lives in the environment,
--     not in the database. Unset it (or set it to `off`) as part of the same
--     change, or the next deploy of a post-023 build fails on a missing table.
--   * **Nothing in `traceability.md`** — course availability has no FR and
--     none was invented for it, so there is no matrix entry to retract.
-- ===========================================================================

BEGIN;

-- Order matters only for readability: neither table is referenced by anything
-- else (023 deliberately declared no foreign key INTO them), so there are no
-- dependants to CASCADE through — and CASCADE is not used here for exactly
-- that reason. If a later migration added a dependant, this should fail loudly
-- rather than drop it silently.
DROP TABLE IF EXISTS student_course_access;
DROP TABLE IF EXISTS course_availability;

-- ---------------------------------------------------------------------------
-- Verification — asserted, not assumed (the argument 020/021/022/023 make)
-- ---------------------------------------------------------------------------

DO $verify$
BEGIN
  IF to_regclass('public.course_availability') IS NOT NULL THEN
    RAISE EXCEPTION 'course_availability is still present after the rollback';
  END IF;

  IF to_regclass('public.student_course_access') IS NOT NULL THEN
    RAISE EXCEPTION 'student_course_access is still present after the rollback';
  END IF;

  -- The three roles are 017's and must survive: this file scopes itself to the
  -- two tables 023 created, and a rollback that removed a role would take
  -- every other table's grants with it.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ainext_app')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ainext_operator')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ainext_maint') THEN
    RAISE EXCEPTION
      'a migration 017 role is missing — this rollback must not touch roles';
  END IF;

  RAISE NOTICE
    'course availability: removed. Every course is now visible to every '
    'student again. Set AINEXT_COURSE_GATING=off (or unset it) before '
    'deploying a build that still reads these tables.';
END
$verify$;

COMMIT;
