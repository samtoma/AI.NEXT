-- ===========================================================================
-- 041 — a turn the student stopped is its own outcome, not a failure
--
-- The Stop button (lesson chat, homework help, the understanding check, the
-- /spine panel, photo-upload reading). A student who no longer wants a reply
-- can interrupt it; the server kills the model process and the partial reply
-- she already saw is kept.
--
-- Additive and idempotent. Safe to re-run; `deploy/apply-migrations.sh` does,
-- on every deploy, in filename order, while the previous app is still serving.
-- Rollback: `rollback/041-stopped-turn-outcome.down.sql`.
-- ===========================================================================
--
-- WHY A NEW OUTCOME. Before this, a client abort killed the CLI and the close
-- handler then classified the dead process as `error` — so every stopped turn
-- was a failure in the console's passive runtime-health signal (FR-3006,
-- `app/src/lib/runtime-health.ts`), and enough of them in a row would page an
-- operator about a tutor that was working perfectly. A stopped turn is the
-- product doing what the student asked.
--
-- WHAT `stopped` MEANS TO EACH READER.
--   · cost (`cost_daily`, `lib/cost-queries.ts`): IT IS A COST LINE. The input
--     side and whatever output streamed before the kill were really spent; the
--     row carries the partial counters the stream reported, priced like a
--     redacted turn.
--   · runtime health: NOT a failure — `FAILING_OUTCOMES` stays error|timeout,
--     the same treatment `redacted` and `refused` already get.
--   · turn thresholds (`lib/turn-threshold-queries.ts`): not a delivered reply
--     (`outcome = 'ok'` only), exactly as before.
--
-- `homework_asks.status` gains `stopped` too (migration 040's vocabulary): an
-- ask whose reading the student stopped is neither `failed` (which tells her
-- to retry) nor `unreadable`.
-- ===========================================================================

BEGIN;

ALTER TABLE ai_interactions DROP CONSTRAINT IF EXISTS ai_interactions_outcome_check;
ALTER TABLE ai_interactions ADD CONSTRAINT ai_interactions_outcome_check
  CHECK (outcome IN ('ok','error','timeout','redacted','refused','stopped'));

COMMENT ON COLUMN ai_interactions.outcome IS
  'ok | error | timeout | redacted | refused | stopped. A turn that burned tokens and '
  'then failed is a cost line with its outcome, never a missing row (research A4.2). '
  'stopped = the student pressed Stop: a cost line, never a failure (migration 041).';

DO $hw$
BEGIN
  IF to_regclass('public.homework_asks') IS NOT NULL THEN
    ALTER TABLE homework_asks DROP CONSTRAINT IF EXISTS homework_asks_status_check;
    ALTER TABLE homework_asks ADD CONSTRAINT homework_asks_status_check
      CHECK (status IN ('reading','ready','unreadable','failed','stopped'));
  END IF;
END
$hw$;

DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.ai_interactions'::regclass
                    AND conname = 'ai_interactions_outcome_check'
                    AND pg_get_constraintdef(oid) LIKE '%stopped%') THEN
    RAISE EXCEPTION 'ai_interactions.outcome does not admit stopped';
  END IF;
  RAISE NOTICE 'stopped turn outcome: admitted';
END
$verify$;

COMMIT;
