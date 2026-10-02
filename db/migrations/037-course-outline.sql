-- ===========================================================================
-- 037 — course outline: every chapter and lesson of a book, before its
--       content is prepared
--
-- Feature 003. Samuel, 2026-10-01, for the Grade 10 American maths course:
-- "I want the students to see all chapters as well not only 8!". The book's
-- whole structure is known (the S0 manifest, gate G0 passed 2026-09-25: 14
-- chapters, 65 lessons), while its content reaches the database one chapter
-- at a time as the pipeline prepares it. This is where the structure lives so
-- a student can see the whole book in order, with the lessons that are not
-- prepared yet shown as such.
--
-- Additive and idempotent. Safe to re-run; `deploy/apply-migrations.sh` does,
-- on every deploy, in filename order, while the previous app is still serving.
-- Rollback: `rollback/037-course-outline.down.sql`.
-- ===========================================================================
--
-- WHY A TABLE OF ITS OWN, AND NOT MORE ROWS IN `course_lessons` (034).
--
--   * `course_lessons` is the provenance of the lessons that ARE loaded, and
--     the content loader owns it: `load_seed.py --replace` prunes every row
--     its bundles no longer carry. Outline rows for lessons whose bundles do
--     not exist yet would be pruned by the next chapter load — or would have
--     to be re-carried by every load, which is a step the fan-out must not
--     need.
--   * It has no chapter, no chapter title and no reading order; a lesson slug
--     does not sort into book order ("g10m10s1-1" < "g10m1s3-1").
--   * Every reader of it (the progression walk, the Ask context, the console)
--     reads its rows as lessons that exist. An outline row is a lesson that
--     does NOT exist to be taught yet; putting it there would make each of
--     those readers learn the difference.
--
-- So this table is written by its own loader from the book's manifest
-- (`services/extraction/load_course_outline.py`), and nothing but the outline
-- readers reads it (`app/src/lib/course-outline-queries.ts`, rules in
-- `app/src/lib/course-outline.ts`).
--
-- ---------------------------------------------------------------------------
-- READINESS IS NOT STORED (the point of the design)
-- ---------------------------------------------------------------------------
-- There is no "prepared" column. A lesson is prepared exactly when its
-- objectives are loaded — when `getLessonCatalog` (app/src/lib/lesson.ts)
-- finds objectives `lo:<slug>-<n>` filed under a module of the course, which
-- is the same rule that has always decided what a lesson IS. The app derives
-- it at read time by comparing this table with the student's gated catalogue.
-- So the fan-out needs no extra step: the moment `load_seed.py` loads a
-- chapter, its lessons become startable, and a lesson can never be shown as
-- prepared while having nothing to teach (constitution II — grounded teaching
-- always).
--
-- ---------------------------------------------------------------------------
-- THE COLUMNS
-- ---------------------------------------------------------------------------
--   course_id        the course (`course:…`), NOT a foreign key — 034's rule:
--                    a course is registered in app code independently of its
--                    content being loaded
--   lesson_slug      the lesson, exactly as the pipeline mints it
--                    (`g10m<ch>s<sec>-<part>`); PRIMARY KEY with course_id
--   module_id        the module node the chapter becomes when it is loaded
--                    (`module:g10m-c01`)
--   module_label     the label that node takes ("Chapter 1 — Algebraic
--                    expressions", `assemble_lesson_bundle.py`'s rule)
--   module_order     the chapter's place in the book (1…14)
--   book_order       the lesson's place in the whole book (1…65) — THE
--                    reading order; unique per course
--   title, sections, section_titles, part_n, part_of, chapter_intro,
--   group_key        the lesson's book provenance, the same columns and the
--                    same meaning as `course_lessons` (034), so the app names
--                    an unprepared lesson exactly as it will name it once it
--                    is loaded ("1.7 · part 2", "1.2–1.3")
--   page_from,
--   page_to          its printed pages
--   source           where the row came from: the manifest and its gate
--
-- CONTENT, NOT STUDENT DATA, and not environment-tagged — like every content
-- table (034, 017): the database is the environment. No RLS; SELECT for the
-- student surface and the console; only the loader (`ainext_maint`) writes.
-- Gating is the reader's: an outline is read only for courses the student may
-- see (`lib/course-outline.ts`), so curriculum isolation is unchanged.
--
-- ---------------------------------------------------------------------------
-- RE-RUNS CHANGE NOTHING AND NARROW NOTHING (034's discipline, FR-3213)
-- ---------------------------------------------------------------------------
--   * `CREATE TABLE IF NOT EXISTS`, CHECKs created WITH the table, once, on an
--     empty table — a re-run never re-adds a CHECK over existing rows.
--   * Every CHECK is structural; none is a list of values.
--   * The unique index is created only when the catalogue says it is missing.
--   * GRANT/REVOKE unconditional, so a hand-edited privilege converges.
--   * Nothing is backfilled and no other table is touched.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The store
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS course_outline (
  course_id      text     NOT NULL,
  lesson_slug    text     NOT NULL,
  module_id      text     NOT NULL,
  module_label   text     NOT NULL,
  module_order   integer  NOT NULL,
  book_order     integer  NOT NULL,
  title          text     NOT NULL,
  sections       text[]   NOT NULL,
  section_titles text[]   NOT NULL,
  part_n         smallint,
  part_of        smallint,
  chapter_intro  boolean  NOT NULL DEFAULT false,
  group_key      text     NOT NULL,
  page_from      integer,
  page_to        integer,
  source         text     NOT NULL,
  loaded_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, lesson_slug),
  CONSTRAINT course_outline_orders_positive
    CHECK (module_order >= 1 AND book_order >= 1),
  -- the same structural shape as course_lessons (034)
  CONSTRAINT course_outline_sections_titled
    CHECK (cardinality(sections) >= 1
           AND cardinality(sections) = cardinality(section_titles)),
  CONSTRAINT course_outline_part_pair
    CHECK ((part_n IS NULL) = (part_of IS NULL)),
  CONSTRAINT course_outline_part_range
    CHECK (part_n IS NULL OR (part_n >= 1 AND part_n <= part_of)),
  CONSTRAINT course_outline_pages
    CHECK (page_from IS NULL OR page_to IS NULL OR page_from <= page_to)
);

COMMENT ON TABLE course_outline IS
  'Every chapter and lesson of a course''s book, in reading order, from its '
  'manifest (feature 003; Samuel 2026-10-01, "see all chapters"). Readiness '
  'is NOT stored: a lesson is prepared when its objectives are loaded, derived '
  'at read time (app/src/lib/course-outline.ts). Content, not student data: no '
  'RLS, read by ainext_app and ainext_operator, written by '
  'services/extraction/load_course_outline.py (ainext_maint) only.';

-- One lesson per place in the book. Structural; built once, on the first run.
DO $index$
BEGIN
  IF to_regclass('public.course_outline_book_order') IS NULL THEN
    CREATE UNIQUE INDEX course_outline_book_order
      ON course_outline (course_id, book_order);
  END IF;
END
$index$;

-- ---------------------------------------------------------------------------
-- 2. Grants — content-shaped, exactly 034's
-- ---------------------------------------------------------------------------
REVOKE ALL ON course_outline FROM ainext_app, ainext_operator;
GRANT SELECT         ON course_outline TO ainext_app, ainext_operator;
GRANT ALL PRIVILEGES ON course_outline TO ainext_maint;

-- ---------------------------------------------------------------------------
-- 3. Verification — asserted, not assumed
-- ---------------------------------------------------------------------------

DO $verify$
BEGIN
  IF to_regclass('public.course_outline') IS NULL
     OR to_regclass('public.course_outline_book_order') IS NULL THEN
    RAISE EXCEPTION 'course_outline or its book-order index was not created';
  END IF;

  IF NOT has_table_privilege('ainext_app', 'course_outline', 'SELECT')
     OR NOT has_table_privilege('ainext_operator', 'course_outline', 'SELECT') THEN
    RAISE EXCEPTION 'course_outline is not readable by ainext_app and ainext_operator';
  END IF;

  -- Written by the loader alone. A student surface that could write it could
  -- list a lesson that does not exist in the book.
  IF has_table_privilege('ainext_app', 'course_outline', 'INSERT')
     OR has_table_privilege('ainext_app', 'course_outline', 'UPDATE')
     OR has_table_privilege('ainext_app', 'course_outline', 'DELETE')
     OR has_table_privilege('ainext_operator', 'course_outline', 'INSERT')
     OR has_table_privilege('ainext_operator', 'course_outline', 'UPDATE')
     OR has_table_privilege('ainext_operator', 'course_outline', 'DELETE') THEN
    RAISE EXCEPTION 'course_outline is writable by ainext_app or ainext_operator — only the loader writes it';
  END IF;
  IF NOT has_table_privilege('ainext_maint', 'course_outline', 'INSERT')
     OR NOT has_table_privilege('ainext_maint', 'course_outline', 'UPDATE')
     OR NOT has_table_privilege('ainext_maint', 'course_outline', 'DELETE') THEN
    RAISE EXCEPTION 'the loader (ainext_maint) cannot write course_outline';
  END IF;

  IF (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.course_outline'::regclass) THEN
    RAISE EXCEPTION 'course_outline has row level security — it is content, not student data';
  END IF;

  RAISE NOTICE 'course outline: ready — % lesson row(s) in % course(s)',
    (SELECT count(*) FROM course_outline),
    (SELECT count(DISTINCT course_id) FROM course_outline);
END
$verify$;

COMMIT;
