-- ===========================================================================
-- 028 DOWN — remove the lesson pointer
--
-- Undoes `db/migrations/028-lesson-progress.sql`. Idempotent: safe to run when
-- the table is already absent, and safe to run twice.
--
-- WHAT IS LOST: where each student is in each course. Not evidence — mastery
-- and attempts are untouched — but the monotonic cursor cannot be re-derived
-- afterwards: 028 has no backfill (ADR-0020 amendment, 2026-09-23), so
-- re-running it creates an EMPTY table and every student is back on each
-- course's first lesson, advancing again from there by the runtime rule.
--
-- ORDER: deploy a build without progression FIRST, then run this. A build
-- with progression reads this table on /student; against a database without
-- it the check-in read fails. (The attempt route is protected: its advance
-- runs under a SAVEPOINT and a failure there never loses the graded attempt.)
-- ===========================================================================

BEGIN;

DROP TABLE IF EXISTS student_progress;

COMMIT;
