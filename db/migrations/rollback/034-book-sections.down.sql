-- ===========================================================================
-- 034 DOWN — remove the book-sections store
--
-- Undoes `db/migrations/034-book-sections.sql`. Idempotent: safe to run when
-- the table is already absent, and safe to run twice.
--
-- ORDER: deploy a build without book-section grouping FIRST, then run this. A
-- build with it reads `course_lessons` when a correct answer crosses the
-- mastery gate (`app/src/lib/progression-db.ts`, `advanceIfMastered`), and
-- against a database without the table that read fails. The attempt itself is
-- still recorded — the advance runs under a SAVEPOINT in
-- `app/src/app/api/attempts/route.ts` — but no pointer moves until the build
-- and the database agree again.
--
-- WHAT IS LOST: every lesson's book provenance — which printed section(s) it
-- covers, "part n of m", and which lessons are chapter introductions. All of
-- it was written by the loader from the course's manifest and bundles, so
-- nothing a student or an operator produced is lost, and re-running the
-- loader (`deploy/load-course.sh`) after re-applying 034 writes it again.
--
-- WHAT IS NOT TOUCHED:
--   * `graph_edges`. The part n-1 -> part n prerequisites were never written
--     there (FR-4317): they are derived from this table at read time, so
--     dropping it removes them with it and leaves the book's own edges exactly
--     as the book states them.
--   * Progress pointers (`student_progress`, migration 028), mastery and
--     attempts. A pointer inside a split section stays where it is; under the
--     rolled-back build, the next advance walks the catalogue as if every
--     part were its own lesson, which is the pre-034 rule.
--   * Roles. Dropping a table takes its own grants with it; no role is
--     revoked from anything else (023 DOWN's reasoning).
-- ===========================================================================

BEGIN;

DROP TABLE IF EXISTS course_lessons;

DO $verify$
BEGIN
  IF to_regclass('public.course_lessons') IS NOT NULL THEN
    RAISE EXCEPTION 'course_lessons still exists after 034 DOWN';
  END IF;
  RAISE NOTICE '034 down: course_lessons dropped (or was already absent)';
END
$verify$;

COMMIT;
