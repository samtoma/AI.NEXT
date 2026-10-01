-- ===========================================================================
-- 039 DOWN — the review gate stops admitting a flagged working step
--
-- Undoes `db/migrations/039-review-gate-working-flag.sql`: puts
-- `review_decisions_item_kind_check` back to 036's ten kinds. Idempotent: safe
-- to run when 039 is already undone, and safe to run twice.
--
-- ORDER: deploy a build that does not offer `working_flag` items FIRST (the
-- console would otherwise fail on the first decision it takes on one), then run
-- this.
--
-- REFUSES, rather than loses data, while any `working_flag` decision is on
-- record. `review_decisions` is append-only for every role — a decision is
-- never edited or removed — so such a row cannot be deleted to make room, and
-- narrowing the CHECK over it would either fail or leave a row the table's own
-- rule says cannot exist. Keep 039 (it only widens a list) or take a dump and
-- drop the whole gate with `036-review-gate.down.sql`.
-- ===========================================================================

BEGIN;

DO $down$
DECLARE
  n bigint;
BEGIN
  IF to_regclass('public.review_decisions') IS NULL THEN
    RETURN;
  END IF;
  SELECT count(*) INTO n FROM review_decisions WHERE item_kind = 'working_flag';
  IF n > 0 THEN
    RAISE EXCEPTION
      '039 down refused: % working_flag decision(s) are recorded and review_decisions is append-only. '
      'Keep 039, or dump the table and drop the gate with 036-review-gate.down.sql.', n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.review_decisions'::regclass
                AND conname = 'review_decisions_item_kind_check'
                AND pg_get_constraintdef(oid) LIKE '%working_flag%') THEN
    ALTER TABLE review_decisions DROP CONSTRAINT review_decisions_item_kind_check;
    ALTER TABLE review_decisions ADD CONSTRAINT review_decisions_item_kind_check
      CHECK (item_kind IN ('book_question', 'generated_question', 'widget_question', 'mapping_claim',
                           'misconception', 'worked_example', 'objective', 'prerequisite_link',
                           'figure_stand_in', 'gate_decision'));
  END IF;
END
$down$;

DO $verify$
BEGIN
  IF to_regclass('public.review_decisions') IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.review_decisions'::regclass
                    AND conname = 'review_decisions_item_kind_check'
                    AND pg_get_constraintdef(oid) LIKE '%working_flag%') THEN
    RAISE EXCEPTION 'review_decisions still admits working_flag after the rollback';
  END IF;
END
$verify$;

COMMIT;
