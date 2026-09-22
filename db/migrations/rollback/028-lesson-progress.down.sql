-- ===========================================================================
-- 028 DOWN — remove the lesson pointer
--
-- Undoes `db/migrations/028-lesson-progress.sql`. Idempotent: safe to run when
-- the table is already absent, and safe to run twice.
--
-- WHAT IS LOST: where each student is in each course. Not evidence — mastery
-- and attempts are untouched — but the monotonic cursor cannot be re-derived
-- exactly afterwards (re-running 028 backfills from CURRENT mastery, which may
-- have fallen below the gate since a student advanced).
--
-- ORDER: deploy a build without progression FIRST, then run this. A build
-- with progression reads this table on /student; against a database without
-- it the check-in read fails. (The attempt route is protected: its advance
-- runs under a SAVEPOINT and a failure there never loses the graded attempt.)
-- ===========================================================================

BEGIN;

DROP TABLE IF EXISTS student_progress;

COMMIT;
