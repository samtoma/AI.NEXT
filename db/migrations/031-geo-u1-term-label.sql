-- ===========================================================================
-- 031 — `module:geo-u1` names its term: "Term 2 · Unit 4 — The Circle"
--
-- FR-3218 (Samuel, 2026-09-25). Data, not schema. Idempotent: safe to re-run;
-- `deploy/apply-migrations.sh` does, on every deploy, in filename order, and
-- so does `scripts/local-dev.sh`. Rollback:
-- `rollback/031-geo-u1-term-label.down.sql`.
-- ===========================================================================
--
-- WHY A MIGRATION FOR A LABEL. The label lives in the seed
-- (`services/extraction/seed/geo-unit1.json`), which is fixed in the same
-- change. But production's graph was loaded ONCE, at first boot (2026-09-23),
-- and a deploy does not reload `graph_nodes`; even a re-run of the loader
-- would keep the old text, because its node INSERT is
-- `ON CONFLICT (id) DO NOTHING` (`services/extraction/load_seed.py`). Without
-- this file the fix would reach every fresh database and never the one
-- students use.
--
-- WHAT IT CHANGES. One row, one column: the `label` of `module:geo-u1`, and
-- only while it still reads exactly the old value "Unit 4 — The Circle". Every
-- other Term 2 module already names its term ("Term 2 · Unit 1 — Equations",
-- "Term 2 · Unit 5 — Angles and Arcs in the Circle", …); this one did not,
-- although its own `syllabus_ref` is "Second Term — Geometry Unit 4" and it
-- starts on page 39 of the Term 2 book.
--
-- RE-RUNS CHANGE NOTHING, AND TAKE NO LOCK THAT BLOCKS A STUDENT (FR-3213).
-- The guard is a SELECT (ACCESS SHARE, which blocks no reader and no writer);
-- the UPDATE runs only when that SELECT finds the old text. After the first
-- deploy it never does, so no row is written and no row lock is taken. A
-- label somebody has since changed by hand is not the old text either, so it
-- is left as it is rather than overwritten.
--
-- A FRESH DATABASE (CI's `migrations` job; `local-dev.sh` before the loader
-- runs) holds no curriculum yet: the guard finds nothing, and the loader then
-- writes the new label from the fixed seed.
--
-- THE TWO STRINGS ARE WRITTEN AS UNICODE ESCAPES (U&'…': \00B7 is "·",
-- \2014 is "—"), so the comparison cannot depend on the client encoding of
-- whichever psql runs this file. A mis-decoded literal would never match, and
-- the fix would silently not happen.
--
-- WHAT READS THE LABEL. The check-in and its lesson picker, the Arabic/Social
-- check-in's maths rows, /gallery's groups, the console's Content page — and
-- the tutor: the lesson data block, `learnPrompt`, `reviewPrompt` and the
-- comprehension grader name the module of each Unit-4 geometry lesson, and
-- "Ask the Spine" lists every module under "Ingested units". Their
-- model-visible text changes by exactly this string. Nothing parses it: the
-- term the check-in prints comes from the module id (`app/src/lib/
-- module-term.ts`), and no integrity check reads node labels
-- (`parity_check.py` fingerprints counts and objective ids; `source_sha256`
-- is the PDF's hash, not the seed's).
--
-- `graph_nodes` keeps no history (only edges are bitemporal — db/schema.sql),
-- so the old text is kept here and in the rollback file, not in the table.
-- An in-place curriculum UPDATE has precedent: migration 007.

BEGIN;

DO $label$
BEGIN
  IF EXISTS (SELECT 1 FROM graph_nodes
              WHERE id = 'module:geo-u1'
                AND label = U&'Unit 4 \2014 The Circle') THEN
    UPDATE graph_nodes
       SET label = U&'Term 2 \00B7 Unit 4 \2014 The Circle'
     WHERE id = 'module:geo-u1'
       AND label = U&'Unit 4 \2014 The Circle';

    -- Asserted, not assumed.
    IF EXISTS (SELECT 1 FROM graph_nodes
                WHERE id = 'module:geo-u1'
                  AND label = U&'Unit 4 \2014 The Circle') THEN
      RAISE EXCEPTION 'module:geo-u1 still carries the old label after 031';
    END IF;
    RAISE NOTICE 'module:geo-u1: label now names its term (Term 2, Unit 4, The Circle)';
  ELSE
    RAISE NOTICE 'module:geo-u1: nothing to change';
  END IF;
END
$label$;

COMMIT;
