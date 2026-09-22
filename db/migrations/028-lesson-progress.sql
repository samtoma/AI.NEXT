-- ===========================================================================
-- 028 — `student_progress`: the lesson each student is on, per course
--
-- ADR-0020, mastery-gated lesson progression (Tamer Deif). Written as
-- migration 012 / ADR-0012 on `wip/socratic-probing-route-b`; renumbered when
-- brought onto `main`, whose 012 is environment attribution and whose ADR-0012
-- is per-student isolation — which this file now also has to satisfy.
--
-- Additive and idempotent. Safe to re-run; `scripts/local-dev.sh` does, and
-- `deploy/apply-migrations.sh` does on every deploy, in filename order.
-- Rollback: `rollback/028-lesson-progress.down.sql`.
-- ===========================================================================
--
-- Before this, `/student` opened on a constant. The check-in derived its
-- lesson as `?lesson=` ?? first-row-of-the-catalogue ?? the hardcoded
-- DEFAULT_LESSON_SLUG "u1-1" — none of which read mastery, and nothing
-- anywhere read a date. This table is the missing persisted state: where a
-- student actually IS in a course.
--
-- WHY A POINTER AND NOT A DERIVATION. The mastered band (>= 0.75) is both
-- quickly reached and reversible: with DEFAULT_PARAMS two correct answers
-- take an LO from the 0.30 prior to 0.919, and from a mastered 0.98 two wrong
-- answers fall back to 0.517. A "current lesson" recomputed on every render
-- would therefore move BACKWARDS after a bad session, and the assigned card
-- would flicker between lessons run to run. The pointer advances once, when
-- the gate is first crossed, and is never walked back (ADR-0020 "Monotonic").
--
-- WHY PER COURSE AND NOT PER STUDENT. The check-in is subject-scoped
-- (`?subject=`), and the tree carries three courses. A single pointer per
-- student would let mastering a maths lesson move the Arabic one.
--
-- NOT bitemporal, deliberately — unlike `mastery`. This is a cursor, not
-- evidence: `advanced_at` records when it last moved, and `attempts` already
-- reconstructs the whole path if anyone needs it.
--
-- ---------------------------------------------------------------------------
-- WHAT CHANGED FROM THE BRANCH'S 012, AND WHY
-- ---------------------------------------------------------------------------
--  · ROW-LEVEL SECURITY, ENABLE + FORCE, with the per-student policy every
--    student table in migration 017 carries (ADR-0012). The branch predates
--    017 on `main`; without this the table would be the one student table a
--    forgotten WHERE could read across children.
--  · Grants to the three roles: `ainext_app` SELECT/INSERT/UPDATE (the read,
--    the first advance, the later advances — never DELETE); `ainext_operator`
--    SELECT (Student 360 may show where a child is); `ainext_maint` ALL.
--  · `environment`, NOT NULL, defaulting to 'mvp1' exactly as `mastery` does
--    (migration 012): constitution XI, every student-scoped row says which
--    build wrote it.
--  · `course_id` is NOT a foreign key to `graph_nodes`. Migrations 023 and 025
--    say why for course ids: a course is a product fact that can outlive or
--    predate the content behind it — and concretely, `load_seed.py --course`
--    deletes and re-inserts the course's subtree, which a FK from here would
--    make fail the day any student had advanced in that course.
--  · `student_id ... ON DELETE CASCADE`: a cursor means nothing without its
--    student, and `scripts/red-team-isolation.sh` / the smoke scripts delete
--    test students through `ainext_maint`.
--  · THE BACKFILL RUNS ONCE, and writes only what it knows. Migrations here
--    re-run on every deploy (there is no ledger); the branch's backfill would
--    have re-inserted a row for every student x every course on every deploy,
--    which contradicts its own rule that a read never creates progression
--    state. It now runs only while the table is empty, and inserts a row only
--    for a (student, course) where the student has already passed at least one
--    lesson — everybody else is on the first lesson by the app's own fallback,
--    with no row, as ADR-0020 intends.

BEGIN;

CREATE TABLE IF NOT EXISTS student_progress (
  student_id   BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_id    TEXT   NOT NULL,
  lesson_slug  TEXT   NOT NULL CHECK (lesson_slug ~ '^[a-z0-9]{1,12}-[0-9]{1,3}$'),
  advanced_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  environment  TEXT   NOT NULL DEFAULT 'mvp1',
  PRIMARY KEY (student_id, course_id)
);

COMMENT ON TABLE student_progress IS
  'ADR-0020: the lesson each student is currently on, per course. Monotonic — advanced when every LO in the current lesson reaches 0.75, never walked back when mastery later drops. Student data: RLS forced (ADR-0012).';
COMMENT ON COLUMN student_progress.lesson_slug IS
  'LO-id prefix ("u1-1", "geo1-2"), matching lib/lesson-slug.ts SLUG_RE. Not an FK: a lesson is a lexical group of learning objectives, not a row.';
COMMENT ON COLUMN student_progress.course_id IS
  'Course node id. Deliberately not a foreign key (migrations 023/025): a scoped content reload replaces the course subtree.';

-- --- grants ------------------------------------------------------------------
REVOKE ALL ON student_progress FROM ainext_app, ainext_operator;
GRANT SELECT, INSERT, UPDATE ON student_progress TO ainext_app;
GRANT SELECT                 ON student_progress TO ainext_operator;
GRANT ALL PRIVILEGES         ON student_progress TO ainext_maint;

-- --- row-level security (ADR-0012) -------------------------------------------
ALTER TABLE student_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_progress FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS student_progress_app ON student_progress;
CREATE POLICY student_progress_app ON student_progress FOR ALL TO ainext_app
  USING      (student_id = nullif(current_setting('app.student_id', true), '')::bigint)
  WITH CHECK (student_id = nullif(current_setting('app.student_id', true), '')::bigint);

DROP POLICY IF EXISTS student_progress_operator ON student_progress;
CREATE POLICY student_progress_operator ON student_progress FOR SELECT TO ainext_operator
  USING (true);

-- --- one-time backfill -------------------------------------------------------
-- Each existing student who has already passed a lesson starts on the lesson
-- AFTER the furthest catalogue lesson that passes the gate (capped at the
-- course's last), so a student who has been practising is not sent back to
-- lesson 1 on deploy. Runs as the migration owner (see apply-migrations.sh),
-- which is why it can read every student's mastery.
--
-- "Furthest" is catalogue order, reproduced exactly as lib/lesson.ts
-- MODULE_ORDER builds it: Term-1 algebra, then Term-2 algebra, then geometry,
-- and within a term by module order then LO order. lib/progression.ts owns the
-- ordering from here on; this block is a one-time snapshot of it.
INSERT INTO student_progress (student_id, course_id, lesson_slug)
WITH lesson_lo AS (
  SELECT
    regexp_replace(regexp_replace(lo.id, '^lo:', ''), '-[0-9]+$', '') AS slug,
    c.id AS course_id,
    lo.id AS lo_id,
    CASE
      WHEN m.id LIKE 'module:geo%' THEN 2
      WHEN m.id LIKE 'module:t2-%' THEN 1
      ELSE 0
    END AS term_rank,
    m.order_in_parent AS module_order,
    lo.order_in_parent AS lo_order
  FROM graph_nodes lo
  LEFT JOIN graph_edges e
    ON e.dst_id = lo.id AND e.edge_type = 'teaches' AND e.system_to IS NULL
  LEFT JOIN graph_nodes m ON m.id = e.src_id AND m.kind = 'module'
  LEFT JOIN graph_edges ec
    ON ec.src_id = m.id AND ec.edge_type = 'part_of' AND ec.system_to IS NULL
  LEFT JOIN graph_nodes c ON c.id = ec.dst_id AND c.kind = 'course'
  WHERE lo.kind = 'learning_objective' AND c.id IS NOT NULL
),
lesson AS (
  SELECT slug, course_id,
         min(term_rank)    AS term_rank,
         min(module_order) AS module_order,
         min(lo_order)     AS lo_order
  FROM lesson_lo
  GROUP BY slug, course_id
),
-- A lesson passes the gate only when EVERY one of its LOs is at >= 0.75.
-- An LO with no mastery row counts as 0 (never attempted).
passed AS (
  SELECT s.id AS student_id, ll.slug, ll.course_id
  FROM students s
  CROSS JOIN lesson_lo ll
  LEFT JOIN mastery ms
    ON ms.lo_id = ll.lo_id
   AND ms.student_id = s.id
   AND ms.system_to IS NULL
  GROUP BY s.id, ll.slug, ll.course_id
  HAVING bool_and(coalesce(ms.score, 0) >= 0.75)
),
ranked AS (
  SELECT s.id AS student_id, l.course_id, l.slug,
         row_number() OVER (
           PARTITION BY s.id, l.course_id
           ORDER BY l.term_rank, l.module_order NULLS LAST, l.lo_order, l.slug
         ) AS seq
  FROM students s CROSS JOIN lesson l
),
furthest AS (
  SELECT r.student_id, r.course_id, max(r.seq) AS seq
  FROM ranked r
  JOIN passed p
    ON p.slug = r.slug
   AND p.course_id = r.course_id
   AND p.student_id = r.student_id
  GROUP BY r.student_id, r.course_id
),
bounds AS (
  SELECT course_id, max(seq) AS max_seq FROM ranked GROUP BY course_id
)
SELECT r.student_id, r.course_id, r.slug
FROM ranked r
JOIN bounds b
  ON b.course_id = r.course_id
JOIN furthest f
  ON f.student_id = r.student_id AND f.course_id = r.course_id
WHERE r.seq = least(f.seq + 1, b.max_seq)
  AND NOT EXISTS (SELECT 1 FROM student_progress)
ON CONFLICT (student_id, course_id) DO NOTHING;

-- --- verify ------------------------------------------------------------------
DO $verify$
BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'public.student_progress'::regclass) THEN
    RAISE EXCEPTION
      'student_progress needs ENABLE *and* FORCE row level security (ADR-0012)';
  END IF;
  IF NOT has_table_privilege('ainext_app', 'student_progress', 'SELECT')
     OR NOT has_table_privilege('ainext_app', 'student_progress', 'INSERT')
     OR NOT has_table_privilege('ainext_app', 'student_progress', 'UPDATE') THEN
    RAISE EXCEPTION
      'ainext_app cannot read or move the lesson pointer — the check-in would '
      'fall back to the first lesson for everybody and never advance';
  END IF;
  IF has_table_privilege('ainext_app', 'student_progress', 'DELETE') THEN
    RAISE EXCEPTION 'ainext_app can DELETE student_progress — the pointer is monotonic and no surface removes it';
  END IF;
  IF has_table_privilege('ainext_operator', 'student_progress', 'INSERT')
     OR has_table_privilege('ainext_operator', 'student_progress', 'UPDATE')
     OR has_table_privilege('ainext_operator', 'student_progress', 'DELETE') THEN
    RAISE EXCEPTION 'ainext_operator must only read student_progress';
  END IF;
  RAISE NOTICE 'student_progress: ready — % row(s)', (SELECT count(*) FROM student_progress);
END
$verify$;

COMMIT;
