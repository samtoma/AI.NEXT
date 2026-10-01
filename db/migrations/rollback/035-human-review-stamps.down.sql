-- ===========================================================================
-- 035 DOWN — fold the review columns back into reviewed_by, then drop them
--
-- Undoes `db/migrations/035-human-review-stamps.sql`. Idempotent: safe to run
-- when the columns are already absent, and safe to run twice.
--
-- ORDER: deploy a build that does not read or write `ai_checked_by`,
-- `ai_checked_at`, `hold_reason` or `review_note` FIRST (the loaders write
-- them, the console's review gate reads them), then run this.
--
-- WHAT IS RESTORED: the pre-035 strings, as the previous loaders wrote them and
-- the previous readers parse them —
--   * an "ai dual-check" row with no human stamp gets back
--     "ai dual-check (pending Samuel)" (and its time as reviewed_at);
--   * a human stamp gets its notes back after "; " ("Samuel Toma (G2 accept);
--     stem fixed by orchestrator …", "…; held: its figure is missing");
--   * a bulk promotion gets its stamp back ("samuel (poc bulk)");
--   * a 'review' row held for a missing figure by the LOADER (no G2 note) gets
--     " [held: figure missing]" back, so the previous loader's figure gate
--     still releases exactly the rows it held.
--
-- WHAT IS LOST: every other hold reason (the status stays 'review', which is
-- what the previous build relies on), any AI check other than "ai
-- dual-check" (an "auto-pass G<n>" is not a review, so it is NOT written into
-- reviewed_by — the previous build would read any non-NULL value as one), and
-- the time of a bulk promotion (035 keeps no time for "promoted without
-- review"; its reviewed_at comes back NULL). Round-tripped on a copy of the
-- Chapter 8 pilot database: every other reviewed_by/reviewed_at is restored
-- byte for byte.
-- Nothing a student produced is touched; no status changes.
-- ===========================================================================

BEGIN;

DO $down$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'questions'
                    AND column_name = 'ai_checked_by') THEN
    RAISE NOTICE '035 down: the review columns are already absent — nothing to do';
    RETURN;
  END IF;

  -- The fold-back is written as dynamic SQL so this file still parses (and does
  -- nothing) on a database where the columns are already gone.
  EXECUTE $fold$
    UPDATE questions q
       SET reviewed_by =
             nullif(concat_ws('; ',
                       coalesce(q.reviewed_by,
                                CASE WHEN q.ai_checked_by = 'ai dual-check'
                                     THEN 'ai dual-check (pending Samuel)' END,
                                substring(q.review_note FROM '^promoted without review: ([^;]*)')),
                       nullif(regexp_replace(coalesce(q.review_note, ''),
                                             '^promoted without review: [^;]*(; )?', ''), ''))
                    || CASE WHEN q.status = 'review' AND q.hold_reason = 'figure_missing'
                                 AND coalesce(q.review_note, '') !~* 'held: its figure is missing'
                            THEN ' [held: figure missing]' ELSE '' END, ''),
           reviewed_at = CASE WHEN q.reviewed_by IS NOT NULL THEN q.reviewed_at
                              WHEN q.ai_checked_by = 'ai dual-check' THEN q.ai_checked_at
                              ELSE q.reviewed_at END
     WHERE q.ai_checked_by IS NOT NULL OR q.review_note IS NOT NULL OR q.hold_reason IS NOT NULL
  $fold$;
END
$down$;

-- The gate decision records go with it; the JSON files under
-- services/extraction/runs/<book>/gates/ still hold every one.
DROP TABLE IF EXISTS gate_decisions;

ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_held_not_live;
ALTER TABLE questions DROP COLUMN IF EXISTS ai_checked_by;
ALTER TABLE questions DROP COLUMN IF EXISTS ai_checked_at;
ALTER TABLE questions DROP COLUMN IF EXISTS hold_reason;
ALTER TABLE questions DROP COLUMN IF EXISTS review_note;

COMMENT ON COLUMN questions.reviewed_by IS NULL;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'questions'
                AND column_name IN ('ai_checked_by', 'ai_checked_at', 'hold_reason', 'review_note'))
     OR to_regclass('public.gate_decisions') IS NOT NULL THEN
    RAISE EXCEPTION '035 down: a review column is still on questions';
  END IF;
  RAISE NOTICE '035 down: review columns folded back into reviewed_by and dropped (or were already absent)';
END
$verify$;

COMMIT;
