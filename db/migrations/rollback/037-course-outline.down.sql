-- ===========================================================================
-- 037 DOWN — remove the course outline
--
-- Undoes `db/migrations/037-course-outline.sql`. Idempotent: safe to run when
-- the table is already absent, and safe to run twice.
--
-- ORDER: none needed. The app reads `course_outline` only after asking the
-- catalogue whether it exists (`OUTLINE_PRESENT_SQL`, app/src/lib/
-- course-outline-queries.ts), and with no table it shows exactly what it showed
-- before 037: the prepared lessons only, and no unprepared slug to refuse.
--
-- WHAT IS LOST: the list of chapters and lessons not prepared yet. All of it
-- was written by `services/extraction/load_course_outline.py` from the book's
-- manifest, so nothing a student or an operator produced is lost; re-applying
-- 037 and re-running the loader writes it again.
--
-- WHAT IS NOT TOUCHED: every content table (`graph_nodes`, `course_lessons`,
-- `questions`, …) and every student table. Prepared lessons are prepared
-- because their objectives are loaded, not because of a row here.
-- ===========================================================================

BEGIN;

DROP TABLE IF EXISTS course_outline;

DO $verify$
BEGIN
  IF to_regclass('public.course_outline') IS NOT NULL THEN
    RAISE EXCEPTION 'course_outline still exists after 037 DOWN';
  END IF;
  RAISE NOTICE '037 down: course_outline dropped (or was already absent)';
END
$verify$;

COMMIT;
