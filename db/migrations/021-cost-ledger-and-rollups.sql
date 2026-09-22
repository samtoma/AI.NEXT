-- ===========================================================================
-- 021 — the cost ledger tells the truth, and gets a daily rollup
--
-- data-model §12 · plan A7 · research A0 + A4.4 · FR-2401…FR-2403, FR-2407
-- Additive and idempotent. Safe to re-run; `scripts/local-dev.sh` does.
-- ===========================================================================
--
-- WHAT THIS FILE IS FOR. `ai_interactions` has recorded cost since migration
-- 009 and nothing read it until v0.4.0. Now that the console reports from it
-- and a price will be set against it, three things it does not say have to be
-- said, and one of them is that the number is not money.
--
--   1. `outcome` — a turn that burned tokens and then failed, timed out, was
--      refused, or was redacted by the sacred guard is a COST LINE, not a
--      missing row. Without this column the honest fix in the write path
--      (record the failure) would be indistinguishable from a successful turn.
--   2. `price_basis` + `priced_at` — the runtime is the Claude CLI on a
--      subscription, not an API key (research A4.4). `cost_usd` is an
--      IMPUTATION at published list price; no money left a bank account per
--      turn. Recording the basis per row is what stops a change to Anthropic's
--      list prices silently rewriting the history the unit economics are
--      computed from, and it is why every console figure says "imputed at list
--      price" rather than "spent".
--   3. `cost_daily` — the per-student time series FR-2401 asks for. A TABLE,
--      refreshed for CLOSED days and unioned with a live query for today, not a
--      view: a view would re-scan the highest-volume student table on every
--      console render, and `percentile_cont` over it is not cheap (plan A7).
--
-- `renderer_version`, the fourth column data-model §12 lists, landed in 020.
--
-- WHY THE DEFAULTS DIFFER. `outcome` and `price_basis` take defaults because
-- both are TRUE of every existing row: every pre-021 row that exists was
-- written on a success path, and every one of them stored the CLI's
-- `total_cost_usd`, which is exactly the list-price imputation
-- `cli-list-price` names. `priced_at` takes NO default, because nobody recorded
-- WHEN those rows were priced and a default would invent it — the same
-- reasoning 020 used for `renderer_version`. NULL means "not recorded".
--
-- THE BACKFILL, AND WHAT IT CANNOT REPAIR. The sacred-guard redaction path
-- inserted literal zeros for all four token counters and `cost_usd`
-- (api/ask/route.ts, fixed in this phase). Those rows are identifiable by their
-- assistant_message, which the guard writes verbatim, so they are marked
-- `outcome='redacted'` below. **Their token counts are gone** — the turn is
-- over and the CLI's usage line was discarded — so the backfill marks them and
-- does not pretend to reprice them. Rows written from here on carry the real
-- numbers.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The three ledger columns
-- ---------------------------------------------------------------------------

ALTER TABLE ai_interactions
  ADD COLUMN IF NOT EXISTS outcome     TEXT NOT NULL DEFAULT 'ok',
  ADD COLUMN IF NOT EXISTS price_basis TEXT NOT NULL DEFAULT 'cli-list-price',
  ADD COLUMN IF NOT EXISTS priced_at   TIMESTAMPTZ;

ALTER TABLE ai_interactions DROP CONSTRAINT IF EXISTS ai_interactions_outcome_check;
ALTER TABLE ai_interactions ADD CONSTRAINT ai_interactions_outcome_check
  CHECK (outcome IN ('ok','error','timeout','redacted','refused'));

COMMENT ON COLUMN ai_interactions.outcome IS
  'ok | error | timeout | redacted | refused. A turn that burned tokens and '
  'then failed is a cost line with its outcome, never a missing row (research A4.2).';

COMMENT ON COLUMN ai_interactions.price_basis IS
  'How cost_usd was arrived at. cli-list-price = the Claude CLI''s own '
  'total_cost_usd, which is an IMPUTATION at published list price and not money '
  'that left an account (research A4.4). Every console figure says so.';

COMMENT ON COLUMN ai_interactions.priced_at IS
  'When the imputation was made, so a later change to published list prices '
  'cannot silently rewrite this row''s history. NULL = written before 021.';

-- ---------------------------------------------------------------------------
-- 2. `cost_daily` — the per-student time series (data-model §12)
-- ---------------------------------------------------------------------------
-- No foreign key to `students` on purpose, matching `operator_reads`: this is a
-- derived accounting row and it must survive the deletion of its subject. It is
-- rebuilt from `ai_interactions` by app/scripts/rollup-cost-daily.mts, which is
-- the ONLY writer.
--
-- `surface_kind` is in the primary key because FR-2402 forbids blending AI
-- spend with upload/OCR spend. Separating them at ROW level is what makes an
-- accidental blend impossible rather than merely discouraged: there is no row
-- that holds both, so no query can sum one by mistake.

CREATE TABLE IF NOT EXISTS cost_daily (
  environment           TEXT   NOT NULL,
  student_id            BIGINT NOT NULL,
  day                   DATE   NOT NULL,
  surface_kind          TEXT   NOT NULL,
  turns                 INT    NOT NULL,
  input_tokens          BIGINT NOT NULL,
  output_tokens         BIGINT NOT NULL,
  cache_read_tokens     BIGINT NOT NULL,
  cache_creation_tokens BIGINT NOT NULL,
  cost_usd              NUMERIC(12,6) NOT NULL,
  latency_p50_ms        INT,
  latency_p95_ms        INT,
  errors                INT    NOT NULL DEFAULT 0,
  PRIMARY KEY (environment, student_id, day, surface_kind)
);

-- Both columns the rollup and the console need but the primary key does not
-- serve: the console asks "this environment, these N days, every student", and
-- the PK's leading (environment, student_id) cannot answer a day range across
-- students without a full scan.
CREATE INDEX IF NOT EXISTS idx_cost_daily_day ON cost_daily(environment, day);

-- Which price basis the rolled-up day was priced on, so a rollup row carries
-- the same label its source rows do and the console never has to assume it.
ALTER TABLE cost_daily
  ADD COLUMN IF NOT EXISTS price_basis TEXT NOT NULL DEFAULT 'cli-list-price',
  ADD COLUMN IF NOT EXISTS rolled_up_at TIMESTAMPTZ NOT NULL DEFAULT now();

COMMENT ON TABLE cost_daily IS
  'Per (environment, student, day, surface_kind) rollup of ai_interactions. '
  'Written ONLY by app/scripts/rollup-cost-daily.mts as ainext_maint, for '
  'CLOSED days; today is answered by a live query and never stored here '
  '(plan A7). Cost is imputed at list price, not money spent.';

-- ---------------------------------------------------------------------------
-- 3. Grants and row-level security (data-model §14)
-- ---------------------------------------------------------------------------
-- `ainext_app` gets NOTHING. A student surface has no reason to read a
-- cross-student accounting table, and the absence of a grant is a stronger
-- statement than a policy that would return nothing.

GRANT SELECT                ON cost_daily TO ainext_operator;
GRANT ALL PRIVILEGES        ON cost_daily TO ainext_maint;
REVOKE ALL PRIVILEGES       ON cost_daily FROM ainext_app;

ALTER TABLE cost_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_daily FORCE  ROW LEVEL SECURITY;

-- FORCE is what subjects the owner to the policies too (research R6.3); the
-- rollup runs as ainext_maint, which is BYPASSRLS and therefore unaffected.
DROP POLICY IF EXISTS cost_daily_operator ON cost_daily;
CREATE POLICY cost_daily_operator ON cost_daily FOR SELECT TO ainext_operator
  USING (true);
-- No ainext_app policy, deliberately. With FORCE on and no policy, the role
-- sees nothing even if a grant is added by mistake later.

-- ---------------------------------------------------------------------------
-- 4. Backfill: the redaction rows we can identify
-- ---------------------------------------------------------------------------
-- The marker is the exact string the guard writes (api/ask/route.ts). Matching
-- on it plus cost_usd = 0 is narrow enough that a real turn cannot be caught:
-- no model produces that sentence as its own answer, and a successful turn has
-- a non-zero cost. Anything ambiguous stays 'ok' — marking a turn redacted that
-- was not would be the same class of lie this migration exists to remove.

UPDATE ai_interactions
   SET outcome = 'redacted'
 WHERE outcome = 'ok'
   AND coalesce(cost_usd, 0) = 0
   AND surface_kind = 'chat'
   AND assistant_message LIKE '[REDACTED — sacred containment tripped%';

-- ---------------------------------------------------------------------------
-- 5. Verification
-- ---------------------------------------------------------------------------
-- Asserted rather than assumed, for the reason 020 states: a column the console
-- cannot select renders as an empty figure, which reads as "no activity"
-- instead of "missing grant".

DO $verify$
DECLARE redacted_rows INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'ai_interactions' AND column_name = 'outcome') THEN
    RAISE EXCEPTION 'ai_interactions.outcome was not added';
  END IF;

  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'ai_interactions' AND column_name = 'priced_at') <> 'YES' THEN
    RAISE EXCEPTION
      'ai_interactions.priced_at must stay NULLABLE — nobody recorded when a '
      'pre-021 row was priced, and a default would invent it';
  END IF;

  IF to_regclass('public.cost_daily') IS NULL THEN
    RAISE EXCEPTION 'cost_daily was not created';
  END IF;

  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'public.cost_daily'::regclass) THEN
    RAISE EXCEPTION 'cost_daily needs ENABLE *and* FORCE row level security';
  END IF;

  IF NOT has_table_privilege('ainext_operator', 'cost_daily', 'SELECT') THEN
    RAISE EXCEPTION 'the console cannot read cost_daily';
  END IF;

  IF NOT has_table_privilege('ainext_maint', 'cost_daily', 'INSERT') THEN
    RAISE EXCEPTION 'the rollup cannot write cost_daily';
  END IF;

  IF has_table_privilege('ainext_app', 'cost_daily', 'SELECT') THEN
    RAISE EXCEPTION
      'ainext_app can read cost_daily — a student surface has no business in a '
      'cross-student accounting table (data-model §14)';
  END IF;

  IF NOT has_column_privilege('ainext_app', 'ai_interactions', 'outcome', 'INSERT')
     OR NOT has_column_privilege('ainext_app', 'ai_interactions', 'price_basis', 'INSERT')
     OR NOT has_column_privilege('ainext_app', 'ai_interactions', 'priced_at', 'INSERT') THEN
    RAISE EXCEPTION 'the write path cannot set the new ledger columns';
  END IF;

  IF NOT has_column_privilege('ainext_operator', 'ai_interactions', 'outcome', 'SELECT') THEN
    RAISE EXCEPTION 'the console cannot read ai_interactions.outcome';
  END IF;

  SELECT count(*) INTO redacted_rows FROM ai_interactions WHERE outcome = 'redacted';
  RAISE NOTICE 'cost ledger: outcome/price_basis/priced_at present, cost_daily ready, % redacted row(s) marked', redacted_rows;
END
$verify$;

COMMIT;
