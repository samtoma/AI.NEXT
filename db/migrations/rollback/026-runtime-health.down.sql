-- ===========================================================================
-- 026 DOWN — remove the runtime health record
--
-- Undoes `db/migrations/026-runtime-health.sql`. Idempotent: safe to run when
-- the table is already absent, and safe to run twice.
--
-- ⚠ THIS IS NOT THE WAY TO STOP PROBING. If the intent is "stop making the
-- call" — because it is noisy, or because somebody wants the subscription
-- quiet for an hour — the cheap reversal is the **cron line**: comment it out
-- and nothing runs. The console then shows `unknown` with the age of the last
-- reading beside it, which is the correct and honest thing for it to show
-- while nobody is looking. Run this file when the FEATURE is being withdrawn,
-- not when the probe is being paused.
--
-- ---------------------------------------------------------------------------
-- WHAT IS LOST, AND WHY IT IS SMALLER THAN 025'S LOSS AND BIGGER THAN 024'S
-- ---------------------------------------------------------------------------
-- 025's rollback loses children's own words and can never be re-derived. This
-- one loses **up to three days of "was the tutor reachable"** — which nothing
-- else in the schema records, and which cannot be reconstructed afterwards
-- either. The difference is that it is machine-written, bounded and about a
-- program rather than about a person: three days from now the same probe would
-- have produced three days of new rows.
--
-- Take it first if an incident is open, because "failing since" is the one
-- question a post-mortem asks that only these rows can answer:
--
--     psql <db> -c "\copy (SELECT checked_at, environment, probe, ok, code, \
--       duration_ms FROM runtime_health ORDER BY checked_at) \
--       TO '026-runtime-health.csv' CSV HEADER"
--
-- `ainext_operator` can run that (SELECT is its whole grant); `ainext_app`
-- cannot, and that refusal is the table's point rather than an inconvenience.
--
-- **What is NOT lost**: the passive signal. `ai_interactions.outcome` keeps
-- recording what real turns did, migration 021 owns it, and nothing here
-- touches it. After this rollback the console can still say "the last fifty
-- tutor turns all failed" — it just cannot say anything at all about a night
-- when nobody was online, which is exactly the gap 026 was written to close.
--
-- ---------------------------------------------------------------------------
-- THE ORDER IS APPLICATION FIRST, THEN DROP — AND THE FAILURE IS QUIET
-- ---------------------------------------------------------------------------
-- `lib/security-queries.ts` selects this table as one of fifteen queries
-- inside ONE `withOperator` transaction. A build from after 026 pointed at a
-- database from before it does not degrade gracefully: the missing relation
-- aborts the transaction, and `/security` — the page an operator opens when
-- they suspect something is wrong — fails to render **entirely**, taking the
-- sign-in tiles, the lockout list and the cross-student banner down with the
-- health tile nobody was asking for.
--
-- That is the worst possible moment for this page to be blank, so: deploy the
-- pre-026 application FIRST, then drop. The same ordering rule as 025, with a
-- sharper consequence.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FILE DELIBERATELY DOES NOT UNDO
-- ---------------------------------------------------------------------------
--   * **No role is dropped and no pre-026 privilege is revoked.** The three
--     roles are migration 017's and are shared by every table in the schema.
--     `DROP TABLE` takes its own table-level grants, its policy and its index
--     with it, which is exactly the right scope, so this file does no revoking.
--   * **Nothing in `ai_interactions`.** 026 added no column to it and does not
--     read it; the passive signal is migration 021's and survives untouched.
--   * **Nothing in `alerts_sent`.** The `tutor_unreachable` rule's firings are
--     rows in 022's table, and they stay: an alert that was sent was sent, and
--     erasing the record of it while removing the thing that raised it is how
--     a history stops being one. The rule itself stops evaluating when the
--     application is rolled back, which is the application's business.
--   * **No cron line is removed** — this file cannot reach a crontab. A probe
--     left scheduled against a dropped table fails loudly every fifteen
--     minutes into `/var/log/noor-probe.log`, which is noisy and is strictly
--     better than failing silently. Remove the line.
--   * **Nothing in `traceability.md`.** FR-3001…FR-3010's statuses are
--     Samuel's to set, not a migration's, in either direction.
-- ===========================================================================

BEGIN;

-- No CASCADE, deliberately: nothing depends on `runtime_health` — no view, no
-- foreign key pointing at it, no generated column (026 created none). If a
-- later migration added a dependant, this should fail loudly rather than drop
-- it silently.
DROP TABLE IF EXISTS runtime_health;

-- ---------------------------------------------------------------------------
-- Verification — asserted, not assumed (the argument 020…025 all make)
-- ---------------------------------------------------------------------------

DO $verify$
BEGIN
  IF to_regclass('public.runtime_health') IS NOT NULL THEN
    RAISE EXCEPTION 'runtime_health is still present after the rollback';
  END IF;

  -- The policy must have gone with the table rather than survived as an
  -- orphan; if it is still here, the DROP did not do what this file claims.
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'runtime_health') THEN
    RAISE EXCEPTION 'a runtime_health policy outlived its table';
  END IF;

  -- The three roles are 017's and must survive: this file scopes itself to the
  -- one table 026 added, and a rollback that removed a role would take every
  -- other table's grants with it.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ainext_app')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ainext_operator')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ainext_maint') THEN
    RAISE EXCEPTION
      'a migration 017 role is missing — this rollback must not touch roles';
  END IF;

  -- The passive signal is not 026's and must be intact: if `ai_interactions`
  -- or its `outcome` column is gone, something other than this file has run,
  -- and the console has just lost the OTHER half of the health picture.
  IF to_regclass('public.ai_interactions') IS NULL THEN
    RAISE EXCEPTION
      'ai_interactions is missing — 026 never touched it and this rollback '
      'must not have reached it';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'ai_interactions' AND column_name = 'outcome') THEN
    RAISE EXCEPTION
      'ai_interactions.outcome is missing — that is migration 021''s column and '
      'the passive half of the health signal depends on it';
  END IF;

  -- `alerts_sent` keeps whatever the tutor_unreachable rule already sent.
  IF to_regclass('public.alerts_sent') IS NULL THEN
    RAISE EXCEPTION
      'alerts_sent is missing — this rollback must not reach migration 022''s '
      'record of what was already mailed';
  END IF;

  RAISE NOTICE
    'runtime_health: removed. Nothing now answers "can the tutor teach" on a '
    'night when no student is online — the passive signal in ai_interactions '
    'survives and needs traffic to say anything. Remove the probe''s cron line, '
    'and deploy the pre-026 application FIRST: /security reads this table '
    'inside the same transaction as its sign-in tiles.';
END
$verify$;

COMMIT;
