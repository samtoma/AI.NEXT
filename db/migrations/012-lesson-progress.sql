-- ADR-0012: mastery-gated lesson progression.
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
-- the gate is first crossed, and is never walked back (ADR-0012 "Monotonic").
-- Mastery may fall below the gate afterwards; this row does not follow it down.
--
-- WHY PER COURSE AND NOT PER STUDENT. The check-in is already subject-scoped
-- (`?subject=`), and the tree carries three courses. A single pointer per
-- student would let mastering a maths lesson move the Arabic one.
--
-- NOT bitemporal, deliberately — unlike `mastery`, which keeps every historical
-- row because the comparison has to be able to recompute a student's estimate
-- at a past instant. This is a cursor, not evidence: `advanced_at` records when
-- it last moved, and the attempt history in `attempts` already reconstructs the
-- whole path if anyone needs it.
--
-- Idempotent — safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS student_progress (
  student_id   BIGINT NOT NULL REFERENCES students(id),
  course_id    TEXT   NOT NULL REFERENCES graph_nodes(id),
  lesson_slug  TEXT   NOT NULL CHECK (lesson_slug ~ '^[a-z0-9]{1,12}-[0-9]{1,3}$'),
  advanced_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, course_id)
);

COMMENT ON TABLE student_progress IS
  'ADR-0012: the lesson each student is currently on, per course. Monotonic — advanced when every LO in the current lesson reaches 0.75, never walked back when mastery later drops.';
COMMENT ON COLUMN student_progress.lesson_slug IS
  'LO-id prefix ("u1-1", "geo1-2"), matching lib/lesson-slug.ts SLUG_RE. Not an FK: a lesson is a lexical group of learning objectives, not a row.';

-- BACKFILL (ADR-0012 "Backfill"): each existing student starts at the furthest
-- catalogue lesson that ALREADY passes the gate, else the course's first
-- lesson. Computed here rather than left to the app so that a student who has
-- been practising is not silently sent back to lesson 1 on deploy.
--
-- "Furthest" is catalogue order, and the catalogue order is reproduced here
-- exactly as lib/lesson.ts MODULE_ORDER builds it: Term-1 algebra, then Term-2
-- algebra, then geometry, and within a term by module order then LO order. The
-- term rank matters — both terms number their first unit 1, so without it the
-- two interleave (see MODULE_ORDER's own comment). The two must not drift — if
-- MODULE_ORDER changes, this backfill is already spent and the drift is
-- invisible, so lib/progression.ts owns the ordering from here on and this
-- block is a one-time snapshot of it.
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
-- An LO with no mastery row counts as 0 (never attempted), which is what
-- makes a half-done lesson fail the gate instead of averaging past it.
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
-- the furthest lesson that passes, per (student, course)
furthest AS (
  SELECT r.student_id, r.course_id, max(r.seq) AS seq
  FROM ranked r
  JOIN passed p
    ON p.slug = r.slug
   AND p.course_id = r.course_id
   AND p.student_id = r.student_id
  GROUP BY r.student_id, r.course_id
),
-- lesson count per course, for the terminal cap below
bounds AS (
  SELECT course_id, max(seq) AS max_seq FROM ranked GROUP BY course_id
)
-- The pointer is the lesson AFTER the furthest one passed — a student who has
-- mastered lessons 1..k is ON k+1, not back on k. `least(..., max_seq)` is the
-- terminal case (ADR-0012): a student who has passed everything parks on the
-- last lesson rather than falling out of the insert with no pointer at all.
-- No passed lesson at all -> seq 1, the course's first.
SELECT r.student_id, r.course_id, r.slug
FROM ranked r
JOIN bounds b
  ON b.course_id = r.course_id
LEFT JOIN furthest f
  ON f.student_id = r.student_id AND f.course_id = r.course_id
WHERE r.seq = least(coalesce(f.seq + 1, 1), b.max_seq)
ON CONFLICT (student_id, course_id) DO NOTHING;

COMMIT;
