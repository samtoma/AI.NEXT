-- ===========================================================================
-- 039 — the review gate learns one more kind of item: a flagged working step
--
-- Feature 003. FR-4411 (the step-level working checker) says its flags go to
-- the backlog and are NEVER silently corrected; FR-4501 lists "a working step
-- the step-level checker flagged" among the backlog's items. The console now
-- reads the checker's `runs/<book>/working-check/chNN.flags.json` and shows one
-- item per flagged solution (`app/src/lib/review-gate-working.ts`), decided
-- like any other item — which means `review_decisions.item_kind` has to admit
-- the new kind, `working_flag`.
--
-- Additive and idempotent. Safe to re-run; `deploy/apply-migrations.sh` does,
-- on every deploy, in filename order, while the previous app is still serving.
-- Rollback: `rollback/039-review-gate-working-flag.down.sql`.
-- ===========================================================================
--
-- WHY A NEW MIGRATION AND NOT AN EDIT OF 036. 036 says it plainly: its two
-- value-list CHECKs are the gate's vocabulary, "created WITH the table, on an
-- empty table; widening one is a new migration, never a re-run of this one".
-- 036 was widened in place once (for 'gate_decision') only because it had not
-- left a developer's database yet; a database that already ran it would never
-- see that edit.
--
-- WHAT IS NOT HERE. No new table and no new column. A flagged step is derived
-- on every read from the checker's file and the solution's own row, the way
-- every other backlog item is derived (036's header); a decision on it is one
-- more `review_decisions` row (ref = the solution id, "q:…" or "expl:…"), whose
-- fingerprint covers the solution's text and what was flagged in it, so a
-- correction that lands puts it back in front of a reviewer and takes it off
-- the fix list by itself. A flag has no effect on content, so there is no
-- grant to widen: `ainext_operator` already holds SELECT and INSERT on
-- `review_decisions`, and `ainext_app` still holds nothing.
--
-- RE-RUNS: the CHECK is replaced only when its definition lacks the value, and
-- replacing it only ever WIDENS the list, so every existing row passes. A
-- re-run finds it current and takes no lock.

BEGIN;

DO $requires$
BEGIN
  IF to_regclass('public.review_decisions') IS NULL THEN
    RAISE EXCEPTION '039 needs 036 (review_decisions): the review gate has no record to widen';
  END IF;
END
$requires$;

DO $widen$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.review_decisions'::regclass
                    AND conname = 'review_decisions_item_kind_check'
                    AND pg_get_constraintdef(oid) LIKE '%working_flag%') THEN
    ALTER TABLE review_decisions DROP CONSTRAINT IF EXISTS review_decisions_item_kind_check;
    ALTER TABLE review_decisions ADD CONSTRAINT review_decisions_item_kind_check
      CHECK (item_kind IN ('book_question', 'generated_question', 'widget_question', 'mapping_claim',
                           'misconception', 'worked_example', 'objective', 'prerequisite_link',
                           'figure_stand_in', 'working_flag', 'gate_decision'));
  END IF;
END
$widen$;

DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.review_decisions'::regclass
                    AND conname = 'review_decisions_item_kind_check'
                    AND pg_get_constraintdef(oid) LIKE '%working_flag%'
                    AND pg_get_constraintdef(oid) LIKE '%gate_decision%') THEN
    RAISE EXCEPTION '039: review_decisions does not admit working_flag (and every earlier kind) after the widening';
  END IF;
  -- Still nothing on a student surface: 036's rule, asserted again where the table is touched.
  IF has_table_privilege('ainext_app', 'review_decisions', 'SELECT')
     OR has_table_privilege('ainext_app', 'review_decisions', 'INSERT') THEN
    RAISE EXCEPTION '039: ainext_app holds a privilege on review_decisions — review status must never reach a student surface';
  END IF;
  RAISE NOTICE '039 review gate: working_flag admitted — % decision(s) of that kind recorded',
    (SELECT count(*) FROM review_decisions WHERE item_kind = 'working_flag');
END
$verify$;

COMMIT;
