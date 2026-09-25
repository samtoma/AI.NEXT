-- ===========================================================================
-- 032 — the excluded values of q:t2u2-2-1:w001–w003 are the roots, not their
--       negatives
--
-- v0.9.3 hotfix (FR-1207, FR-1206). Data, not schema. Idempotent: safe to
-- re-run; `deploy/apply-migrations.sh` does, on every deploy, in filename
-- order, and so does `scripts/local-dev.sh`. Rollback:
-- `rollback/032-widget-excluded-values-sign.down.sql`.
-- ===========================================================================
--
-- THE DEFECT. Three live widget questions on `lo:t2u2-2-1` ask the student to
-- mark every value x cannot take in 1/((x + r)(x + s)). Their answer key,
-- `choices.spec.targets`, held the SHIFTS r and s where the values excluded
-- are the ROOTS −r and −s:
--
--   q:t2u2-2-1:w001   1/((x − 2)(x + 3))   stored [−2, 3]   correct [−3, 2]
--   q:t2u2-2-1:w002   1/((x + 1)(x − 4))   stored [−4, 1]   correct [−1, 4]
--   q:t2u2-2-1:w003   1/((x − 5)(x + 2))   stored [−5, 2]   correct [−2, 5]
--
-- So a student who answered correctly was marked wrong — shown the wrong set
-- drawn on the line as "the answer" — and was served the refutation for
-- stopping after one root; one who made the sign error was marked right.
-- Their stems and canonical solutions were always correct ("Here that is
-- x = 2 and x = −3"). Cause: `services/extraction/generate_widget_questions.py`,
-- family `domain-excluded`, stored `sorted([r, s])` instead of
-- `sorted([-r, -s])`, fixed in the same change. Production held 0 attempts on
-- these three when the defect was found (2026-09-25). A blind reading of all
-- 48 stored widget stems found no other disagreement
-- (`app/src/lib/widget-bank-stems.test.mts` now keeps it that way).
--
-- WHY A MIGRATION. The seed (`services/extraction/seed/generated/
-- widget-questions.json`) is fixed in the same change. But production's
-- generated bank was loaded ONCE, at first boot, by the deploy step that acts
-- only while the bank is missing, so a deploy never reloads it. Without this
-- file the fix would reach every fresh database and never the one students
-- use.
--
-- WHAT IT CHANGES. Three rows, one column (`choices`), two keys inside it:
--   · `spec.targets` — the correct excluded values, the roots;
--   · `diagnostics` — gains `sign-flipped` → `mc:u1-1-1:transposition-sign`,
--     first. `sign-flipped` is new in v0.9.3's `number_line_marker` vocabulary
--     (`contracts/widget-predicates.json`): it fires when every wrong mark is
--     the negative of a missed value, which is exactly the answer these rows
--     used to REQUIRE. Without it that answer would now be diagnosed as
--     `missed-values` and served "the value you found genuinely does break the
--     fraction" — false for a student who found neither. The misconception is
--     on `lo:u1-1-1`, a prerequisite of `lo:t2u2-2-1` (FR-1215, checked against
--     the graph by the generator), and has been in the catalogue since first
--     boot. The existing `missed-values` mapping is kept, unchanged.
-- Nothing else: not the stem, the solution (already correct, so
-- `solution_version` stays 1), the status or the review stamps.
--
-- ONLY OVER THE WRONG VALUES. Each row is updated only while its stored
-- targets still equal exactly the sign-flipped set above. A row somebody has
-- since corrected by hand is not the old set, so it is left as it is. If its
-- `diagnostics` already carry a `sign-flipped` entry, that entry is kept and
-- none is added.
--
-- RE-RUNS CHANGE NOTHING, AND TAKE NO LOCK THAT BLOCKS A STUDENT (FR-3213).
-- The guard is a SELECT (ACCESS SHARE, which blocks no reader and no writer);
-- the UPDATE runs only when that SELECT finds the wrong set. After the first
-- deploy it never does, so no row is written and no row lock is taken.
--
-- A FRESH DATABASE (CI's `migrations` job; `local-dev.sh` before the loader
-- runs) holds no questions yet: every guard finds nothing, and the loader then
-- writes the corrected rows from the fixed seed.
--
-- WHAT READS IT. `NumberLineMarker` grades against `spec.targets` and draws
-- them as "the answer" after a wrong check; `api/attempts` maps the predicate
-- the widget reports to a misconception through `diagnostics`. No prompt reads
-- either: the tutor's question catalogue shows a widget row as
-- "(construction: number_line_marker)" (`app/src/lib/lesson.ts`).
--
-- `questions` keeps no history, so the old values are kept here and in the
-- rollback file, not in the table. The numbers are plain JSON; nothing here
-- depends on the client encoding.

BEGIN;

DO $fix$
DECLARE
  r record;
  fixed int := 0;
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
                  AND choices #> '{spec,targets}' = r.wrong) THEN
      UPDATE questions
         SET choices = jsonb_set(
               jsonb_set(choices, '{spec,targets}', r.correct),
               '{diagnostics}',
               CASE
                 WHEN choices -> 'diagnostics' @> '[{"predicate": "sign-flipped"}]'::jsonb
                   THEN choices -> 'diagnostics'
                 ELSE '[{"predicate": "sign-flipped", "misconception_id": "mc:u1-1-1:transposition-sign"}]'::jsonb
                      || coalesce(choices -> 'diagnostics', '[]'::jsonb)
               END)
       WHERE id = r.id
         AND choices #> '{spec,targets}' = r.wrong;

      -- Asserted, not assumed.
      IF EXISTS (SELECT 1 FROM questions
                  WHERE id = r.id
                    AND choices #> '{spec,targets}' = r.wrong) THEN
        RAISE EXCEPTION '% still holds the sign-flipped targets % after 032', r.id, r.wrong;
      END IF;
      fixed := fixed + 1;
      RAISE NOTICE '%: targets % -> %, sign-flipped diagnosed', r.id, r.wrong, r.correct;
    END IF;
  END LOOP;

  IF fixed = 0 THEN
    RAISE NOTICE 'q:t2u2-2-1:w001-w003: nothing to change';
  END IF;
END
$fix$;

COMMIT;
