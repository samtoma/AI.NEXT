-- ===========================================================================
-- 034 — book sections: every lesson's provenance in its book, as data
--
-- Feature 003, decision 18 (Samuel, 2026-09-25: "need good taging and
-- understanding that it is like that, so when we recommend or suggest scoring
-- etc... we consider them very related"). FR-4311 (the store), FR-4317 (part
-- prerequisites, derived from it); `specs/003-curriculum-tracks/data-model.md`
-- §2 "Book sections"; plan A12, which names the table `course_lessons`.
-- Additive and idempotent. Safe to re-run; `deploy/apply-migrations.sh` does,
-- on every deploy, in filename order, while the previous app is still serving.
-- Rollback: `rollback/034-book-sections.down.sql`.
-- ===========================================================================
--
-- WHY A TABLE. A lesson has no row of its own anywhere: it is the lexical
-- group of objectives sharing an id prefix (`lo.id LIKE 'lo:<slug>-%'`,
-- `app/src/lib/lesson-slug.ts`). So there was nowhere to say that
-- `g10m1s7-2` is "1.7 Factorisation, part 2 of 3", that `g10m1s3-1` covers
-- both 1.2 and 1.3, or that `g10m6s1-1` is chapter 6's introduction. This is
-- that place: ONE ROW PER LESSON, per course.
--
--   course_id       the course (`course:…`), NOT a foreign key — like 023's
--                   tables, a course is registered in app code before (and
--                   independently of) its content being loaded
--   lesson_slug     the lesson; PRIMARY KEY (course_id, lesson_slug)
--   title           the lesson's own title
--   sections        the printed section numbers it covers, in book order
--                   ({"1.2","1.3"} for merge P3a; one element otherwise)
--   section_titles  their printed titles, element for element
--   part_n, part_of "part n of m" — set only for a part of a split section
--   chapter_intro   a promoted chapter introduction (P2a, P2b)
--   group_key       the printed section a part belongs to ("1.7")
--
-- CONTENT, NOT STUDENT DATA. Nothing here is about a child: no RLS, SELECT
-- for the student surface and the console, and only the loader writes it
-- (`services/extraction/load_seed.py`, as `ainext_maint`, task T404).
--
-- ---------------------------------------------------------------------------
-- WHAT THE APP DOES WITH IT (app/src/lib/book-sections.ts)
-- ---------------------------------------------------------------------------
-- The parts of ONE split section — rows sharing (course_id, group_key) with
-- part_n set — are one unit: taught consecutively, never left until every
-- part passes the mastery gate (FR-4313), rolled up "k of m parts mastered"
-- (FR-4314). Part n-1 is a prerequisite of part n (FR-4317), DERIVED AT READ
-- TIME from part_n. It is never written into `graph_edges`, so the book's own
-- prerequisite edges stay exactly the book's and need no "origin" column.
--
-- A lesson with NO part is its own unit, whatever its group_key says. That is
-- deliberate and it is what keeps every National course exactly as it is:
-- the Prep-3 maths book prints "Lesson 3-1" for both u3-1 and t2u3-1, and
-- "Lesson 4-1" for both u4-1 and geo1-1, so a store that grouped by group_key
-- alone would weld two unrelated lessons together the moment the loader wrote
-- one-section rows for them. A lesson with no row at all is also its own
-- unit, so this file changes nothing any student sees until the loader
-- writes a split section.
--
-- ---------------------------------------------------------------------------
-- RE-RUNS CHANGE NOTHING AND NARROW NOTHING (FR-3213)
-- ---------------------------------------------------------------------------
--   * `CREATE TABLE IF NOT EXISTS`: the CHECKs below are created WITH the
--     table, on an empty table, once. A re-run never re-adds one over rows
--     already there — the pattern that took the site down on 2026-09-23
--     (migration 008 re-adding a narrow CHECK over rows 010 had widened,
--     `886b302`) cannot happen here.
--   * Every CHECK is STRUCTURAL — "part n of m" has 1 <= n <= m, the two
--     part columns are set together, and each section number has its title.
--     None is a list of values, so none will ever need widening. There is no
--     CHECK on slugs, section numbers or course ids.
--   * The partial unique index is created only when the catalogue says it is
--     missing (030's idiom), so a re-run takes no lock on the table.
--   * GRANT/REVOKE are unconditional, so a hand-edited privilege converges on
--     the next deploy (017's rule). They take no lock a reader waits on.
--   * Nothing is backfilled and no other table is touched, so nothing here can
--     fail on data.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The store
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS course_lessons (
  course_id      text     NOT NULL,
  lesson_slug    text     NOT NULL,
  title          text     NOT NULL,
  sections       text[]   NOT NULL,
  section_titles text[]   NOT NULL,
  part_n         smallint,
  part_of        smallint,
  chapter_intro  boolean  NOT NULL DEFAULT false,
  group_key      text     NOT NULL,
  PRIMARY KEY (course_id, lesson_slug),
  -- FR-4311: a lesson says which printed section(s) it covers, each with its
  -- printed title. Structural: element for element, at least one.
  CONSTRAINT course_lessons_sections_titled
    CHECK (cardinality(sections) >= 1
           AND cardinality(sections) = cardinality(section_titles)),
  -- "part n of m": both or neither, and 1 <= n <= m.
  CONSTRAINT course_lessons_part_pair
    CHECK ((part_n IS NULL) = (part_of IS NULL)),
  CONSTRAINT course_lessons_part_range
    CHECK (part_n IS NULL OR (part_n >= 1 AND part_n <= part_of))
);

COMMENT ON TABLE course_lessons IS
  'Book provenance of every lesson (feature 003, FR-4311): the printed '
  'section(s) it covers, "part n of m" for a split section, and whether it is '
  'a promoted chapter introduction. Content, not student data: no RLS, read by '
  'ainext_app and ainext_operator, written by the loader only (ainext_maint). '
  'Part n-1 -> part n prerequisites are derived from it at read time and never '
  'written to graph_edges (FR-4317; app/src/lib/book-sections.ts).';

-- Two lessons cannot both be "part 2" of the same section. Structural, like
-- the CHECKs; built once, on the first run, when the table is new and empty.
DO $index$
BEGIN
  IF to_regclass('public.course_lessons_one_part_n') IS NULL THEN
    CREATE UNIQUE INDEX course_lessons_one_part_n
      ON course_lessons (course_id, group_key, part_n)
      WHERE part_n IS NOT NULL;
  END IF;
END
$index$;

-- ---------------------------------------------------------------------------
-- 2. Grants — content-shaped, like 017's curriculum tables
-- ---------------------------------------------------------------------------
-- Start from nothing, so this file is the authority on who may touch the
-- table and a grant deleted from here disappears on the next run (017's rule).
-- 017's `GRANT ALL ... ON ALL TABLES ... TO ainext_maint` runs BEFORE this
-- file and so cannot cover a table this file creates on its first run: the
-- loader's grant is written here explicitly.
REVOKE ALL ON course_lessons FROM ainext_app, ainext_operator;
GRANT SELECT         ON course_lessons TO ainext_app, ainext_operator;
GRANT ALL PRIVILEGES ON course_lessons TO ainext_maint;

-- ---------------------------------------------------------------------------
-- 3. Verification — asserted, not assumed
-- ---------------------------------------------------------------------------

DO $verify$
BEGIN
  IF to_regclass('public.course_lessons') IS NULL
     OR to_regclass('public.course_lessons_one_part_n') IS NULL THEN
    RAISE EXCEPTION 'course_lessons or its one-part-n index was not created';
  END IF;

  -- Readable by the student surface (progression, the subject home, the
  -- progress page, the Ask context) and by the console (per-section figures).
  IF NOT has_table_privilege('ainext_app', 'course_lessons', 'SELECT')
     OR NOT has_table_privilege('ainext_operator', 'course_lessons', 'SELECT') THEN
    RAISE EXCEPTION 'course_lessons is not readable by ainext_app and ainext_operator';
  END IF;

  -- Written by the loader alone. A student surface that could write it could
  -- declare any lesson "part 1 of 1" and walk itself out of a section.
  IF has_table_privilege('ainext_app', 'course_lessons', 'INSERT')
     OR has_table_privilege('ainext_app', 'course_lessons', 'UPDATE')
     OR has_table_privilege('ainext_app', 'course_lessons', 'DELETE')
     OR has_table_privilege('ainext_operator', 'course_lessons', 'INSERT')
     OR has_table_privilege('ainext_operator', 'course_lessons', 'UPDATE')
     OR has_table_privilege('ainext_operator', 'course_lessons', 'DELETE') THEN
    RAISE EXCEPTION 'course_lessons is writable by ainext_app or ainext_operator — only the loader writes it';
  END IF;
  IF NOT has_table_privilege('ainext_maint', 'course_lessons', 'INSERT')
     OR NOT has_table_privilege('ainext_maint', 'course_lessons', 'UPDATE') THEN
    RAISE EXCEPTION 'the loader (ainext_maint) cannot write course_lessons';
  END IF;

  -- Content has no row security; a policy here would silently hide rows from
  -- a role that holds SELECT.
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.course_lessons'::regclass) THEN
    RAISE EXCEPTION 'course_lessons has row level security — it is content, not student data';
  END IF;

  RAISE NOTICE 'book sections: ready — % lesson row(s) in % course(s); % split section(s)',
    (SELECT count(*) FROM course_lessons),
    (SELECT count(DISTINCT course_id) FROM course_lessons),
    (SELECT count(*) FROM (SELECT 1 FROM course_lessons WHERE part_n IS NOT NULL
                            GROUP BY course_id, group_key) s);
END
$verify$;

COMMIT;
