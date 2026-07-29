-- Wave A of the multi-subject app (docs/specs/multi-subject-app.md §2):
-- the database stops encoding product facts about subjects.
--
-- Migration 006 derived a learning objective's subject from a hardcoded,
-- two-armed CASE over course ids:
--
--     CASE c.id WHEN 'course:prep3-social-ar' THEN 'social'
--               WHEN 'course:prep3-math-en'   THEN 'math'
--               ELSE 'other' END
--
-- so a third course silently became 'other' — a value no TypeScript type
-- admitted, which the graph, the per-subject averages and the subject filter
-- each mishandled differently. Samuel's call: an explicit subject column on
-- the course, backfilled once, with the view reading the data instead of
-- restating the catalogue in SQL.
--
-- Courses live in `graph_nodes` (kind='course'); there is no separate
-- `courses` table, so the column lands there and is constrained to course rows.
--
-- Idempotent — safe to re-run.

BEGIN;

-- 1. the column. Nullable, and only meaningful on courses.
ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS subject TEXT;

COMMENT ON COLUMN graph_nodes.subject IS
  'Subject key of a course node (math|social|arabic|…). The app''s subject '
  'registry (app/src/lib/subjects.ts) is the authority on the value set; a '
  'course whose subject the registry does not know renders as UNFILED, never '
  'as maths. NULL on every non-course node.';

ALTER TABLE graph_nodes DROP CONSTRAINT IF EXISTS graph_nodes_subject_scope_check;
ALTER TABLE graph_nodes ADD CONSTRAINT graph_nodes_subject_scope_check
  CHECK (subject IS NULL OR kind = 'course');

-- 2. backfill the courses that exist today. Deliberately keyed by id: this is
--    the ONE place the mapping is stated, and it runs once. New courses carry
--    their subject from the loader / a follow-up migration, not from a parser.
UPDATE graph_nodes SET subject = 'math'
 WHERE kind = 'course' AND id = 'course:prep3-math-en'   AND subject IS DISTINCT FROM 'math';
UPDATE graph_nodes SET subject = 'social'
 WHERE kind = 'course' AND id = 'course:prep3-social-ar' AND subject IS DISTINCT FROM 'social';

-- 3. node_subject now READS the column. Same shape as migration 006
--    (node_id, course_id, subject) so every existing query keeps working.
--    A course with no subject yields NULL — the app treats that as UNFILED and
--    handles it explicitly, which is the point of the whole wave. The old
--    'other' sentinel is gone.
CREATE OR REPLACE VIEW node_subject AS
SELECT lo.id AS node_id,
       c.id  AS course_id,
       c.subject AS subject
FROM graph_nodes lo
JOIN graph_edges te ON te.dst_id = lo.id AND te.edge_type = 'teaches'
JOIN graph_edges pe ON pe.src_id = te.src_id AND pe.edge_type = 'part_of'
JOIN graph_nodes c  ON c.id = pe.dst_id AND c.kind = 'course'
WHERE lo.kind = 'learning_objective';

-- 4. per-subject rating rows accept the Arabic vertical (ADR-0006).
--    `understanding_checks.subject` is a denormalized copy of the course's
--    subject, so guard it against typos. Any legacy value outside the set
--    (e.g. 006's 'other') is cleared rather than blocking the constraint.
--    NOTE: this list must be widened whenever a subject is added to
--    app/src/lib/subjects.ts — it is the one DB-side echo of that registry.
UPDATE understanding_checks
   SET subject = NULL
 WHERE subject IS NOT NULL AND subject NOT IN ('math', 'social', 'arabic');

ALTER TABLE understanding_checks DROP CONSTRAINT IF EXISTS understanding_checks_subject_check;
ALTER TABLE understanding_checks ADD CONSTRAINT understanding_checks_subject_check
  CHECK (subject IS NULL OR subject IN ('math', 'social', 'arabic'));

COMMIT;
