-- Wave 1.5: Multi-Subject Spine
-- Cross-subject associative link (relates_to) + subject derivation + per-subject rating tag.

-- 1. widen the edge_type CHECK to allow relates_to, and add rationale.
ALTER TABLE graph_edges DROP CONSTRAINT IF EXISTS graph_edges_edge_type_check;
ALTER TABLE graph_edges ADD CONSTRAINT graph_edges_edge_type_check
  CHECK (edge_type IN ('part_of','teaches','prerequisite_of','about','relates_to'));
ALTER TABLE graph_edges ADD COLUMN IF NOT EXISTS rationale TEXT;

-- 2. node_subject: derive a learning objective's subject from its course lineage
--    (LO <-teaches- module -part_of-> course). relates_to is NEVER involved here.
CREATE OR REPLACE VIEW node_subject AS
SELECT lo.id AS node_id,
       c.id  AS course_id,
       CASE c.id
         WHEN 'course:prep3-social-ar' THEN 'social'
         WHEN 'course:prep3-math-en'   THEN 'math'
         ELSE 'other'
       END AS subject
FROM graph_nodes lo
JOIN graph_edges te ON te.dst_id = lo.id AND te.edge_type = 'teaches'
JOIN graph_edges pe ON pe.src_id = te.src_id AND pe.edge_type = 'part_of'
JOIN graph_nodes c  ON c.id = pe.dst_id AND c.kind = 'course'
WHERE lo.kind = 'learning_objective';

-- 3. per-subject rating rollups: tag each comprehension check with its subject.
ALTER TABLE understanding_checks ADD COLUMN IF NOT EXISTS subject TEXT;
UPDATE understanding_checks uc
SET subject = ns.subject
FROM node_subject ns
WHERE uc.lo_id = ns.node_id AND uc.subject IS NULL;
