-- ===========================================================================
-- 033 DOWN — remove the once-only Google step, the curriculum history, the two
--            `students` columns, and the narrowed student UPDATE grant
--
-- Undoes `db/migrations/033-curriculum-tracks.sql` (data-model.md §4).
-- Idempotent: safe to run when everything is already absent, and safe to run
-- twice.
--
-- ORDER: deploy a build without feature 003 FIRST, then run this. A 003 build
-- reads `curriculum_source` and `onboarding_pending` on every student request
-- and calls `complete_student_onboarding()`; against a database without them
-- those reads fail.
--
-- ⚠ READ THIS BEFORE ROLLING BACK THE CODE, not only this file (ADR-0024,
-- Consequences). On a build older than 003 nothing reads
-- `students.curriculum_system`: the gate is (course, grade) alone. An
-- American-curriculum grade-10 student would then see every course live for
-- grade 10, and a National one would see the American course if it is live for
-- their grade. Before redeploying an older build, set the American course
-- hidden for every grade on /courses, or turn `AINEXT_COURSE_GATING` on and
-- leave no American rule live.
--
-- WHAT IS LOST — and none of it is something a student produced:
--   * every recorded change's who, when, from and to
--     (`student_curriculum_changes`);
--   * whether each student's curriculum was chosen or implied
--     (`students.curriculum_source`);
--   * which Google-created accounts still owe their grade-and-curriculum step
--     (`students.onboarding_pending`). After a re-deploy of 003 they read as
--     not pending: they keep the grade and curriculum they have.
-- What is NOT lost: `students.curriculum_system` itself. It predates 033
-- (migration 009) and stays, with every student's current value. Attempts,
-- mastery, progress pointers and conversations are untouched. Take a dump
-- first if the history matters:
--
--   pg_dump -t student_curriculum_changes <db> > 033-history.sql
--   psql <db> -c "\copy (SELECT id, curriculum_source, onboarding_pending FROM students) TO '033-students.csv' CSV HEADER"
--
-- Dropping the two `students` columns takes an ACCESS EXCLUSIVE lock on
-- `students`, briefly, once. It is a rollback, run by hand, not a deploy step.
--
-- GRANTS: `ainext_app`'s table-wide UPDATE on `students` is restored — the
-- state migration 017 leaves on its own, and what v0.9.2 expects — together
-- with 024's column grant, and `ainext_operator`'s UPDATE on the curriculum
-- columns is removed. 017 would restore the table-wide grant on the next
-- deploy of any build anyway; doing it here means the database is right
-- between this file and that deploy.
-- ===========================================================================

BEGIN;

DROP FUNCTION IF EXISTS complete_student_onboarding(text, text, text);

-- Nothing references this table, so no CASCADE — if something later does,
-- this should fail loudly rather than drop it silently (023's rule).
DROP TABLE IF EXISTS student_curriculum_changes;

-- The operator's column grant goes before the column it names.
DO $revoke$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'students'
                AND column_name = 'curriculum_source') THEN
    REVOKE UPDATE (curriculum_system, curriculum_source) ON students FROM ainext_operator;
  ELSE
    REVOKE UPDATE (curriculum_system) ON students FROM ainext_operator;
  END IF;
END
$revoke$;

ALTER TABLE students DROP COLUMN IF EXISTS onboarding_pending;
ALTER TABLE students DROP COLUMN IF EXISTS curriculum_source;

-- The student surface's UPDATE on `students`, as 017 grants it (table-wide),
-- and 024's column grant, which 033's table-level REVOKE had re-issued.
GRANT UPDATE ON students TO ainext_app;
GRANT UPDATE (design_variant) ON students TO ainext_app;

DO $verify$
BEGIN
  IF to_regclass('public.student_curriculum_changes') IS NOT NULL THEN
    RAISE EXCEPTION 'student_curriculum_changes survives the rollback';
  END IF;
  IF to_regprocedure('public.complete_student_onboarding(text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'complete_student_onboarding survives the rollback';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'students'
                AND column_name IN ('curriculum_source', 'onboarding_pending')) THEN
    RAISE EXCEPTION 'a 033 column survives on students';
  END IF;
  IF NOT has_table_privilege('ainext_app', 'students', 'UPDATE') THEN
    RAISE EXCEPTION 'ainext_app did not get its table-wide UPDATE on students back';
  END IF;
  IF has_column_privilege('ainext_operator', 'students', 'curriculum_system', 'UPDATE') THEN
    RAISE EXCEPTION 'ainext_operator can still UPDATE students.curriculum_system';
  END IF;
  -- The column itself predates 033 and must still be there.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'students'
                    AND column_name = 'curriculum_system') THEN
    RAISE EXCEPTION 'students.curriculum_system is gone — it belongs to migration 009, not 033';
  END IF;
  RAISE NOTICE '033 rolled back: history, function and two columns dropped; students.curriculum_system kept';
END
$verify$;

COMMIT;
