-- ===========================================================================
-- 030 DOWN — remove the teaching toggle, the tester marks and the per-sitting
--            snapshot columns
--
-- Undoes `db/migrations/030-teaching-toggle-and-testers.sql`. Idempotent:
-- safe to run when everything is already absent, and safe to run twice.
--
-- ⚠ THIS IS NOT HOW TO TURN PROBING OFF. Set the switch to Off on the
-- console's Teaching page: it takes effect for every lesson that starts after
-- it, it is recorded, and turning it back on is one click. Run this file when
-- the FEATURE is being withdrawn.
--
-- ORDER: deploy a build without the toggle FIRST, then run this. A v0.7.0
-- build writes `sessions.probing` and `sessions.release_tag` whenever a
-- learning session opens; against a database without them every session open
-- fails, which (FR-2309) degrades to NULL-session attribution for every
-- student interaction until the build is replaced.
--
-- WHAT IS LOST — and none of it is something a student produced:
--   * every tester mark, with who made and removed it (`student_testers`);
--   * the switch's position and its whole change history;
--   * which release opened each session and whether it probed.
-- Attempts, mastery, conversations and the retry links migration 027 writes
-- are untouched. Take a dump first if any of it matters:
--
--   pg_dump -t student_testers -t teaching_settings -t teaching_setting_changes <db> > 030.sql
--   psql <db> -c "\copy (SELECT id, probing, release_tag FROM sessions WHERE release_tag IS NOT NULL) TO '030-snapshots.csv' CSV HEADER"
--
-- Dropping the two `sessions` columns takes an ACCESS EXCLUSIVE lock on
-- `sessions`, briefly, once. It is a rollback, run by hand, not a deploy step.
-- ===========================================================================

BEGIN;

DROP TRIGGER IF EXISTS sessions_snapshot_is_fixed ON sessions;
DROP FUNCTION IF EXISTS sessions_snapshot_is_fixed();

ALTER TABLE sessions DROP COLUMN IF EXISTS probing;
ALTER TABLE sessions DROP COLUMN IF EXISTS release_tag;

-- Nothing references these three tables, so no CASCADE — if something later
-- does, this should fail loudly rather than drop it silently (023's rule).
DROP TABLE IF EXISTS teaching_setting_changes;
DROP TABLE IF EXISTS teaching_settings;
DROP TABLE IF EXISTS student_testers;
-- Its trigger went with the table; the function is free-standing.
DROP FUNCTION IF EXISTS student_testers_close_once();

DO $verify$
BEGIN
  IF to_regclass('public.student_testers') IS NOT NULL
     OR to_regclass('public.teaching_settings') IS NOT NULL
     OR to_regclass('public.teaching_setting_changes') IS NOT NULL THEN
    RAISE EXCEPTION 'a teaching-toggle table survives the rollback';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'sessions'
                AND column_name IN ('probing', 'release_tag')) THEN
    RAISE EXCEPTION 'a snapshot column survives on sessions';
  END IF;
  RAISE NOTICE 'teaching toggle: removed. Deploy a build without it before re-applying 030.';
END
$verify$;

COMMIT;
