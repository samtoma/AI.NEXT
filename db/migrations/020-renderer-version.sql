-- ===========================================================================
-- 020 — which renderer produced this turn
--
-- ADR-0015 §3 · data-model §12 · FR-2304 · contracts/admin.md §5
-- Additive and idempotent. Safe to re-run; `scripts/local-dev.sh` does.
-- ===========================================================================
--
-- WHY. ADR-0015 chose option (b) for replay: store the payloads, pin the
-- renderer version, re-render on demand. The console does not keep a picture of
-- what the student saw — it keeps the message, the citations and the grounding,
-- and renders them again with the student's own components. That is cheap and
-- honest, and it has exactly one failure mode: the components change, and the
-- replay quietly shows something the student was never shown.
--
-- This column is the defence. Every turn records the app release that rendered
-- it, so a replay that no longer matches what the student saw **can be
-- recognised rather than believed**. The console marks a turn whose
-- `renderer_version` differs from the running release instead of presenting the
-- reconstruction as a recording. Without the column the drift is invisible, and
-- an invisible drift in a record an operator uses to judge whether the tutor
-- taught a child well is worse than no record.
--
-- WHY ONLY THIS COLUMN. data-model §12 lists four additions to
-- `ai_interactions`: `outcome`, `price_basis`, `priced_at` and
-- `renderer_version`. The first three are the COST ledger's and belong to the
-- phase that builds the cost views — adding them here would create three
-- columns nothing writes and nothing reads, which is the `sessions` mistake
-- ADR-0015 was written about. The timeline reads `outcome` if it is there and
-- falls back to 'ok' if it is not, so the two phases do not have to land
-- together.
--
-- NOT NULL is deliberately absent. Every row written before this migration was
-- rendered by an unrecorded version, and a DEFAULT would stamp them all with
-- today's release — asserting, falsely, that a turn from three weeks ago was
-- produced by code that did not exist. NULL means "not recorded", the console
-- says exactly that, and only the write path fills it in.
--
-- NO INDEX. Nothing filters or joins on it: it is read per turn, on rows
-- already selected by session. An index here would cost every insert on the
-- highest-volume student table to serve a query nobody makes.
-- ===========================================================================

BEGIN;

ALTER TABLE ai_interactions
  ADD COLUMN IF NOT EXISTS renderer_version TEXT;

COMMENT ON COLUMN ai_interactions.renderer_version IS
  'App release tag at write time (lib/env.ts RELEASE_TAG). NULL = not recorded '
  '(written before migration 020). Lets a reconstructed replay that no longer '
  'matches what the student saw be recognised rather than believed (ADR-0015 §3).';

-- --- verification ----------------------------------------------------------
-- The console reads this column as `ainext_operator`; the four write sites
-- write it as `ainext_app`. Both are asserted here rather than assumed, because
-- a column the console cannot select renders as "not recorded" on every row —
-- which looks like old data instead of a missing grant.

DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'ai_interactions'
                    AND column_name = 'renderer_version') THEN
    RAISE EXCEPTION 'ai_interactions.renderer_version was not added';
  END IF;

  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'ai_interactions' AND column_name = 'renderer_version') <> 'YES' THEN
    RAISE EXCEPTION
      'ai_interactions.renderer_version must stay NULLABLE — pre-020 rows were '
      'rendered by a version nobody recorded, and a default would claim otherwise';
  END IF;

  IF NOT has_column_privilege('ainext_operator', 'ai_interactions', 'renderer_version', 'SELECT') THEN
    RAISE EXCEPTION 'ainext_operator cannot read ai_interactions.renderer_version';
  END IF;

  IF NOT has_column_privilege('ainext_app', 'ai_interactions', 'renderer_version', 'INSERT') THEN
    RAISE EXCEPTION 'ainext_app cannot write ai_interactions.renderer_version';
  END IF;

  RAISE NOTICE 'ai_interactions.renderer_version present, nullable, readable by the console';
END
$verify$;

COMMIT;
