-- ===========================================================================
-- 041 DOWN — a stopped turn is no longer its own outcome
--
-- Undoes `db/migrations/041-stopped-turn-outcome.sql`: puts
-- `ai_interactions_outcome_check` back to migration 021's five outcomes and
-- `homework_asks_status_check` back to migration 040's four statuses.
-- Idempotent: safe to run when 041 is already undone, and safe to run twice.
--
-- ORDER: deploy a build that does not write `stopped` FIRST, then run this.
--
-- THE EXISTING ROWS ARE RELABELLED, NOT DELETED. A stopped turn is a cost
-- line and deleting it would make the ledger lie about spend, so its outcome
-- becomes `error` — which is what the pre-041 code recorded for the same
-- event. That re-introduces the runtime-health noise 041 removed, for the
-- relabelled rows only. A stopped homework ask becomes `failed`.
-- ===========================================================================

BEGIN;

UPDATE ai_interactions SET outcome = 'error' WHERE outcome = 'stopped';

ALTER TABLE ai_interactions DROP CONSTRAINT IF EXISTS ai_interactions_outcome_check;
ALTER TABLE ai_interactions ADD CONSTRAINT ai_interactions_outcome_check
  CHECK (outcome IN ('ok','error','timeout','redacted','refused'));

COMMENT ON COLUMN ai_interactions.outcome IS
  'ok | error | timeout | redacted | refused. A turn that burned tokens and '
  'then failed is a cost line with its outcome, never a missing row (research A4.2).';

DO $hw$
BEGIN
  IF to_regclass('public.homework_asks') IS NOT NULL THEN
    UPDATE homework_asks SET status = 'failed' WHERE status = 'stopped';
    ALTER TABLE homework_asks DROP CONSTRAINT IF EXISTS homework_asks_status_check;
    ALTER TABLE homework_asks ADD CONSTRAINT homework_asks_status_check
      CHECK (status IN ('reading','ready','unreadable','failed'));
  END IF;
END
$hw$;

COMMIT;
