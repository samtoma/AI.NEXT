-- ===========================================================================
-- 026 — `runtime_health`: can the tutor teach, and when did anybody last look?
--
-- Samuel's call, 2026-09-22: "add the console check for lapsed sign-in."
-- Additive and idempotent. Safe to re-run; `scripts/local-dev.sh` does, on
-- every run, in filename order.
--
-- Requirements: **FR-3001…FR-3010**, added to
-- `specs/002-identity-and-admin-console/spec.md` on 2026-09-22 and traced in
-- its matrix §7d. Unlike migrations 023 and 025 this one is NOT shipping ahead
-- of its requirements — they were written in the same pass, and the spec block
-- says so.
-- ===========================================================================
--
-- THE INCIDENT THIS TABLE EXISTS BECAUSE OF. The tutor runs on Samuel's Claude
-- **subscription** through the bundled `claude` CLI, not on an API key. On the
-- live box that sign-in silently expired, and it was found only because
-- somebody ran the CLI by hand:
--
--     $ docker exec ainext-app-1 claude -p "reply with exactly: OK"
--     Failed to authenticate: OAuth session expired and could not be refreshed
--
-- The container had been up **seven weeks**. For some unknown part of that,
-- the product signed a student in, showed her her lessons and her progress,
-- and failed **every single tutor turn** — because sign-in, the console, lesson
-- browsing, mastery from stored attempts, analytics and the cost ledger all
-- keep working. Only `/api/ask`, `/api/understanding` and upload OCR spawn the
-- CLI. That is precisely what made it invisible, and it is why a health signal
-- that only reads error rates on the ordinary surfaces would have stayed green
-- for seven weeks.
--
-- ---------------------------------------------------------------------------
-- WHAT IS STORED, AND WHAT IS DELIBERATELY NOT
-- ---------------------------------------------------------------------------
-- One row per probe run, per environment. Six columns, and the restraint is
-- the design:
--
--   probe       which check ran. `claude_cli` is the only one today; the
--               column exists so the second one does not need a migration.
--               No CHECK constraint, for migration 016's reason: the failure
--               mode of a forgotten enum value is a health check that CANNOT
--               RECORD ITSELF, which is worse than an unfamiliar word in a
--               column.
--   ok          did it pass. A boolean, because the tile's first question is
--               a yes/no and deriving it from a code would mean every reader
--               re-deciding which codes count as failure.
--   code        a short machine-readable word — `ok`, `cli_missing`,
--               `not_signed_in`, `call_failed`, `timed_out`, `bad_output`,
--               `spawn_failed`. The vocabulary is declared in
--               `app/src/lib/claude-cli.ts` and is a contract: these words are
--               on disk, in alert mail and in a page's copy.
--   duration_ms how long the call took. A probe that passes in 400ms and one
--               that passes in 40 seconds are different facts about the box.
--   checked_at  when. UTC, like every timestamp the console prints.
--   environment constitution XI — see below.
--
-- **NO MODEL OUTPUT. NO STDERR. NOT ONE BYTE OF EITHER.** This is the hardest
-- rule on the table and it is worth the paragraph. The obvious convenience
-- would be a `detail TEXT` holding what the CLI actually said, and it is
-- exactly wrong: CLI diagnostics carry filesystem paths, home directories,
-- project names, and — for an authentication failure specifically — fragments
-- of the thing that failed to authenticate. A health table is read by more
-- people than a log, kept far longer, and granted to a console role. The
-- classifier in `lib/claude-cli.ts` reads that text in memory, returns one of
-- seven words, and drops it. If an operator needs more than the word, the
-- answer is to run the CLI on the box, not to have stored it here.
--
-- And **no student appears here at all** — no id, no name, no message, no
-- count of anybody's turns. The probe has no student; that is the point of it.
--
-- ---------------------------------------------------------------------------
-- WHY A HISTORY AND NOT ONE ROW PER PROBE
-- ---------------------------------------------------------------------------
-- A single upserted row would answer "is it broken now". The question an
-- operator actually asks at 9am is **"how long has it been like this?"**, and
-- the answer to that is the oldest failure in the current unbroken run — which
-- requires the run. `lib/runtime-health.ts` computes it (`failingSince`), and
-- the page prints "failing for 2 hours 15 minutes, since 09:10 UTC" instead of
-- a bare red light.
--
-- The history is bounded at **300 rows per (environment, probe)**, trimmed by
-- the probe itself in the same transaction as the insert. At the 15-minute
-- cadence that is just over three days, chosen to survive a weekend: a fault
-- that started on Friday night must not be reported as "since midnight". The
-- number is argued at length where it is declared (`PROBE_KEEP_ROWS`), and it
-- is declared in TypeScript rather than here because it is the probe that
-- enforces it — a constant in two languages is a constant that disagrees with
-- itself eventually.
--
-- ---------------------------------------------------------------------------
-- GRANTS — AND `ainext_app` HAS NO BUSINESS HERE AT ALL
-- ---------------------------------------------------------------------------
-- This is the table's sharpest property, so it is asserted in the verify block
-- rather than trusted:
--
--   ainext_maint     ALL. The probe is a script and scripts use `withMaint`
--                    (`lib/db.ts`). It is the only writer.
--   ainext_operator  SELECT and nothing else. The console reads the tile.
--                    No UPDATE and no DELETE: a health record the operator can
--                    rewrite is not a health record, which is migration 022's
--                    argument about `alerts_sent` applied to the same kind of
--                    fact.
--   ainext_app       **NOTHING.** Not INSERT, not SELECT.
--
-- That last one deserves its reason, because "the app knows when a turn fails,
-- so let it write here" is a genuinely tempting design and it is refused:
--
--   * A request handler must never spawn the CLI to find out (the probe costs
--     a model call; a page load that did that would bill a founder for
--     curiosity and would turn one slow CLI into a slow console).
--   * A student surface that could write a health row could write a FALSE one,
--     and the first thing anybody reaches for during an incident is the health
--     table. The blast radius of `ainext_app` is every request from the
--     internet; the blast radius of `ainext_maint` is a cron line.
--   * The app already leaves its evidence in the right place: `ai_interactions`
--     records `outcome` per turn (migration 021), and the console reads the
--     **passive** signal from there. Two signals, two tables, two writers, and
--     neither one can forge the other.
--
-- ---------------------------------------------------------------------------
-- WHY `environment` IS HERE
-- ---------------------------------------------------------------------------
-- Constitution XI, FR-2509: no fact about one stack may leak into another, and
-- "the tutor was reachable" is very much a fact about a stack — the two
-- environments can run different images, and the comparison build's CLI can be
-- signed out while the baseline's is fine. A shared row would make one of them
-- wrong silently, which is the failure mode this whole feature exists to end.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS runtime_health (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  environment TEXT        NOT NULL,
  probe       TEXT        NOT NULL,
  ok          BOOLEAN     NOT NULL,
  code        TEXT        NOT NULL,
  duration_ms INT,
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE runtime_health IS
  'One row per scheduled runtime probe. Written only by app/scripts/probe-runtime.mts '
  'as ainext_maint; read by the console''s Security view. Holds no model output, no '
  'stderr and nothing about any student.';

COMMENT ON COLUMN runtime_health.code IS
  'A short stable word from lib/claude-cli.ts: ok | cli_missing | not_signed_in | '
  'call_failed | timed_out | bad_output | spawn_failed. NEVER the CLI''s own text — '
  'diagnostics can carry a path or a credential fragment.';

COMMENT ON COLUMN runtime_health.duration_ms IS
  'How long the probe call took. NULL when it never got far enough to time.';

-- The console's only question of this table: "the newest readings for this
-- environment". Environment leads for the same reason it does on
-- `alerts_sent` — a health figure that blended two stacks would describe
-- neither (constitution XI, FR-2509) — and `probe` is in the key so a second
-- probe never has to scan the first one's rows.
CREATE INDEX IF NOT EXISTS idx_runtime_health_recent
  ON runtime_health(environment, probe, checked_at DESC);

-- ---------------------------------------------------------------------------
-- 2. Grants and RLS — the shape migrations 021/022 gave the maintenance tables
-- ---------------------------------------------------------------------------

ALTER TABLE runtime_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_health FORCE ROW LEVEL SECURITY;

GRANT SELECT ON runtime_health TO ainext_operator;
GRANT ALL PRIVILEGES ON runtime_health TO ainext_maint;
REVOKE ALL ON runtime_health FROM ainext_app;

-- The identity sequence is granted with the table by `GRANT ALL PRIVILEGES`
-- for an IDENTITY column, but `REVOKE ALL … FROM ainext_app` is written
-- explicitly rather than relying on the absence of a grant: `PUBLIC` privileges
-- and a future `GRANT … ON ALL TABLES` are both real ways for a role to
-- acquire access nobody intended, and a revoke that was already true costs
-- nothing.

DROP POLICY IF EXISTS runtime_health_operator_select ON runtime_health;
CREATE POLICY runtime_health_operator_select ON runtime_health FOR SELECT TO ainext_operator
  USING (true);

-- ainext_maint is BYPASSRLS (017), so it needs no policy of its own; the
-- absence of one is why no other role reaches this table even by accident.

-- ---------------------------------------------------------------------------
-- 3. Verification — asserted, not assumed (the argument 020…025 all make)
-- ---------------------------------------------------------------------------

DO $verify$
BEGIN
  IF to_regclass('public.runtime_health') IS NULL THEN
    RAISE EXCEPTION 'runtime_health was not created';
  END IF;

  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'public.runtime_health'::regclass) THEN
    RAISE EXCEPTION
      'runtime_health needs ENABLE *and* FORCE row level security — without '
      'FORCE the owner reads and writes it regardless of policy';
  END IF;

  -- The probe must be able to write, or the active signal is permanently
  -- silent and the tile says "unknown" forever while looking like a feature
  -- that works.
  IF NOT has_table_privilege('ainext_maint', 'runtime_health', 'INSERT')
     OR NOT has_table_privilege('ainext_maint', 'runtime_health', 'DELETE') THEN
    RAISE EXCEPTION
      'the probe cannot write or trim runtime_health — DELETE is needed too, '
      'because the probe bounds its own history';
  END IF;

  IF NOT has_table_privilege('ainext_operator', 'runtime_health', 'SELECT') THEN
    RAISE EXCEPTION 'the console cannot read runtime_health — the tile would render empty, '
                    'which reads as "healthy" rather than as "misconfigured"';
  END IF;

  IF has_table_privilege('ainext_operator', 'runtime_health', 'INSERT')
     OR has_table_privilege('ainext_operator', 'runtime_health', 'UPDATE')
     OR has_table_privilege('ainext_operator', 'runtime_health', 'DELETE') THEN
    RAISE EXCEPTION
      'ainext_operator can modify runtime_health — a health record the alerted '
      'party can rewrite is not a health record (migration 022''s argument)';
  END IF;

  -- THE ONE THIS TABLE IS REALLY ABOUT. The application role has no business
  -- here in either direction: it must not be able to read the health record
  -- (it is security bookkeeping) and above all it must not be able to WRITE
  -- one, because the first thing anybody reads during an incident is this
  -- table and a student surface that could forge a row could forge a green
  -- one. Four privileges, named individually so the failure message says
  -- which.
  IF has_table_privilege('ainext_app', 'runtime_health', 'SELECT') THEN
    RAISE EXCEPTION 'ainext_app can read runtime_health — it has no business here at all';
  END IF;
  IF has_table_privilege('ainext_app', 'runtime_health', 'INSERT') THEN
    RAISE EXCEPTION
      'ainext_app can INSERT into runtime_health — a request handler that can '
      'write the health record can write a false one, and the health record is '
      'the first thing read during an incident';
  END IF;
  IF has_table_privilege('ainext_app', 'runtime_health', 'UPDATE')
     OR has_table_privilege('ainext_app', 'runtime_health', 'DELETE') THEN
    RAISE EXCEPTION 'ainext_app can modify runtime_health — it has no business here at all';
  END IF;

  RAISE NOTICE
    'runtime_health: ready, % reading(s) on record. Nothing writes it but '
    'app/scripts/probe-runtime.mts; run `npm run probe:runtime` once to prove it.',
    (SELECT count(*) FROM runtime_health);
END
$verify$;

COMMIT;
