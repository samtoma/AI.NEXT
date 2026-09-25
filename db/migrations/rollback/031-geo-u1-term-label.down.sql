-- ===========================================================================
-- 031 DOWN — `module:geo-u1` reads "Unit 4 — The Circle" again
--
-- Undoes `db/migrations/031-geo-u1-term-label.sql`. Idempotent: it changes the
-- label only while it reads exactly the new value "Term 2 · Unit 4 — The
-- Circle", so it is safe to run twice, and safe to run on a database 031 never
-- touched (or a fresh one with no curriculum).
--
-- ⚠ YOU PROBABLY DO NOT NEED THIS FILE. A label is not a schema: every older
-- build runs against the new text as it is. To roll the CODE back, revert the
-- merge and deploy (deploy/DEPLOY-MVP1.md, "Rolling back"); the previous
-- release has no 031 and leaves the label alone. What an older build then
-- shows:
--   · v0.9.1's check-in and lesson picker strip a leading "Term 2 · " and take
--     the term from the module id, so they render exactly what they rendered
--     before: "Term 2 · Unit 4", "The Circle";
--   · v0.9.1's Arabic/Social check-in prefixes a term onto a maths label as
--     stored, so its row for this module would read "Term 2 · Term 2 · Unit 4
--     — The Circle" — the double prefix that build already prints for Unit 5.
--     That is the one reason to run this file after a roll-back.
--
-- It does not touch the seed: a database loaded afterwards from a v0.9.2 or
-- later checkout gets the new label from `geo-unit1.json`, and the next
-- v0.9.2-or-later deploy re-applies 031 over this file's result.
--
-- WHAT IS LOST: nothing. The old and new strings are both in these two files.
-- The strings are Unicode escapes for the reason 031's header gives.
-- ===========================================================================

BEGIN;

DO $label$
BEGIN
  IF EXISTS (SELECT 1 FROM graph_nodes
              WHERE id = 'module:geo-u1'
                AND label = U&'Term 2 \00B7 Unit 4 \2014 The Circle') THEN
    UPDATE graph_nodes
       SET label = U&'Unit 4 \2014 The Circle'
     WHERE id = 'module:geo-u1'
       AND label = U&'Term 2 \00B7 Unit 4 \2014 The Circle';
    RAISE NOTICE 'module:geo-u1: label restored to the pre-031 text';
  ELSE
    RAISE NOTICE 'module:geo-u1: nothing to restore';
  END IF;
END
$label$;

COMMIT;
