-- Wave 1.5: curated cross-subject bridges (relates_to edges).
-- Idempotent: wipes and re-inserts all relates_to edges. Re-apply after any
-- full reload (TRUNCATE path) — scoped --course reloads preserve relates_to.
--
-- Honesty note: only GENUINE connections between CURRENTLY-LOADED objectives.
-- With Term-1 skeleton lessons (world relief + French campaign) loaded, the two
-- real bridges both connect to coordinate geometry. More unlock in Wave 2 when
-- the location (الموقع الفلكي), map-scale (مقياس الرسم), and economic-data
-- geography lessons load: lat/long↔ordered-pairs, scale↔ratio, tables↔statistics.

DELETE FROM graph_edges WHERE edge_type = 'relates_to';

INSERT INTO graph_edges (src_id, dst_id, edge_type, syllabus_version, rationale) VALUES
  ('lo:u1-1-4', 'lo:soc1-2-1', 'relates_to', '2025-2026',
   'تحديد موقع مكان على الخريطة بخطوط الطول والعرض هو نفس فكرة تحديد نقطة بزوجٍ مرتب (س، ص) في المستوى الإحداثي — نقرأ الموقع بإحداثيين مرجعيين. · Locating a place on a map by lat/long is the same idea as locating a point by an ordered pair (x, y).'),
  ('lo:u5-1-1', 'lo:soc3-2-2', 'relates_to', '2025-2026',
   'خط سير الحملة سلسلة من النقاط المحددة على الخريطة، وقياس المسافة بينها هو نفس مبدأ البُعد بين نقطتين في الهندسة التحليلية. · A campaign route is a chain of located points; measuring the distance between them is the same principle as distance between two points in coordinate geometry.');
