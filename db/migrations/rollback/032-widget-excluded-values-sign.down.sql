-- ===========================================================================
-- 032 DOWN — q:t2u2-2-1:w001–w003 hold their pre-032 (sign-flipped) targets
--            again
--
-- Undoes `db/migrations/032-widget-excluded-values-sign.sql`. Idempotent: it
-- changes a row only while its targets read exactly the corrected set 032
-- writes, so it is safe to run twice, and safe to run on a database 032 never
-- touched (or a fresh one with no questions).
--
-- ⚠ YOU ALMOST CERTAINLY DO NOT WANT THIS FILE. It puts back an answer key
-- that marks a correct student wrong and the sign error right — the defect
-- 032 exists to remove. To roll the CODE back, revert the merge and deploy
-- (deploy/DEPLOY-MVP1.md, "Rolling back"); the previous release has no 032
-- and leaves these rows alone, and it runs correctly against them:
--   · v0.9.2's `NumberLineMarker` grades against whatever `spec.targets`
--     holds, so it marks the ROOTS right — which is correct;
--   · it never emits `sign-flipped`, so the extra diagnostic is never matched
--     and is inert; a sign-flipped answer is then reported as
--     `missed-values`, as it was before.
-- The one thing an older build cannot do with 032's rows is RE-LOAD them:
-- v0.9.2's `widget_spec.validate_widget` rejects a predicate its contract does
-- not declare, so an export taken after 032 and restored through v0.9.2's
-- loader is refused ("predicate 'sign-flipped' is not one number_line_marker
-- can emit"). That is the only reason to run this file.
--
-- WHAT IT RESTORES, per row, only while `spec.targets` reads the corrected
-- set: `spec.targets` back to the pre-032 set, and the exact diagnostic 032
-- adds (`sign-flipped` → `mc:u1-1-1:transposition-sign`) removed. Every other
-- diagnostic stays, in its order. A row somebody has changed by hand since is
-- not the corrected set, so it is left alone.
--
-- It does not touch the seed: a database loaded afterwards from a v0.9.3 or
-- later checkout gets the corrected rows from `widget-questions.json`, and the
-- next v0.9.3-or-later deploy re-applies 032 over this file's result.
--
-- WHAT IS LOST: nothing. Both sets of values are in these two files.
-- ===========================================================================

BEGIN;

DO $restore$
DECLARE
  r record;
  restored int := 0;
BEGIN
  FOR r IN
    SELECT v.id, v.wrong::jsonb AS wrong, v.correct::jsonb AS correct
      FROM (VALUES
        ('q:t2u2-2-1:w001', '[-2, 3]', '[-3, 2]'),
        ('q:t2u2-2-1:w002', '[-4, 1]', '[-1, 4]'),
        ('q:t2u2-2-1:w003', '[-5, 2]', '[-2, 5]')
      ) AS v(id, wrong, correct)
  LOOP
    IF EXISTS (SELECT 1 FROM questions
                WHERE id = r.id
                  AND choices #> '{spec,targets}' = r.correct) THEN
      UPDATE questions
         SET choices = jsonb_set(
               jsonb_set(choices, '{spec,targets}', r.wrong),
               '{diagnostics}',
               coalesce(
                 (SELECT jsonb_agg(e.d ORDER BY e.n)
                    FROM jsonb_array_elements(choices -> 'diagnostics') WITH ORDINALITY AS e(d, n)
                   WHERE e.d <> '{"predicate": "sign-flipped", "misconception_id": "mc:u1-1-1:transposition-sign"}'::jsonb),
                 '[]'::jsonb))
       WHERE id = r.id
         AND choices #> '{spec,targets}' = r.correct;
      restored := restored + 1;
      RAISE NOTICE '%: targets restored to the pre-032 %', r.id, r.wrong;
    END IF;
  END LOOP;

  IF restored = 0 THEN
    RAISE NOTICE 'q:t2u2-2-1:w001-w003: nothing to restore';
  END IF;
END
$restore$;

COMMIT;
