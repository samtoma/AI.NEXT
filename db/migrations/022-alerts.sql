-- ===========================================================================
-- 022 — `alerts_sent`: a rule fires once per window, not once per sweep
--
-- ADR-0016 §6 · plan A8 · contracts/admin.md §7 · research A5 · FR-2502
-- Additive and idempotent. Safe to re-run; `scripts/local-dev.sh` does.
-- ===========================================================================
--
-- WHAT THIS TABLE IS FOR. `app/scripts/alerts-sweep.mts` runs on a schedule
-- (every five minutes on the box) and re-evaluates five rules over
-- `auth_events`. Every one of them is a COUNT OVER A TRAILING WINDOW, so a
-- condition that is true at 10:00 is still true at 10:05 and at 10:10. Without
-- a memory the sweep would mail the same lockout twelve times an hour, and the
-- thing research A5 warns about — "a noisy alert means every alert gets
-- ignored" — would be built in by construction rather than risked.
--
-- So: one row per (rule, key, window_start), and a rule that finds its row
-- already there does nothing. The window is the sweep's own bucketing of time,
-- not the trailing window it counts over: `account_locked` counts five failures
-- in fifteen minutes and records its firing against the fifteen-minute bucket
-- the newest failure fell in, so a genuinely NEW burst in the next bucket
-- alerts again.
--
-- WHY THE PRIMARY KEY IS THE IDEMPOTENCY. `INSERT … ON CONFLICT DO NOTHING`
-- returning zero rows is the sweep's answer to "has this already fired?" — one
-- statement, atomic, and correct even if two sweeps overlap (a slow run and a
-- cron tick). A SELECT-then-INSERT would have a race in exactly the situation
-- an alert matters most: a burst.
--
--   rule          the rule's stable id — 'account_lock_burst',
--                 'ip_failure_burst', 'operator_permission_denied',
--                 'cross_student_access_denied', 'impossible_travel_shadow'.
--                 No CHECK, for migration 016's reason: the failure mode of a
--                 forgotten migration is an alert that is NOT SENT.
--   key           what the rule fired ABOUT — an account id, an IP, an
--                 operator id, an auth_events id. TEXT because the five rules
--                 key on four different kinds of thing and a typed column
--                 would mean five nullable ones.
--   window_start  the bucket. UTC, like every other timestamp the console
--                 prints.
--
-- `detail` carries the numbers the alert was built from, so a row is readable
-- months later without re-running the query that produced it. It holds counts,
-- ids and timestamps — never a password, never a reason string from a form,
-- never anything `auth_events` itself refuses to hold.
--
-- `ainext_maint` ONLY (plan A8). The sweep is a script and scripts use
-- `withMaint`. `ainext_app` must not read it — a student surface has no
-- business in the security bookkeeping — and `ainext_operator` is granted
-- SELECT so the console's security view can say WHEN a rule last fired without
-- being able to clear the record of it. No UPDATE, no DELETE, to anybody but
-- maintenance: an alert log the alerted party can erase is not a log.
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS alerts_sent (
  rule         TEXT        NOT NULL,
  key          TEXT        NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  environment  TEXT        NOT NULL,
  detail       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  delivered    TEXT        NOT NULL DEFAULT 'logged',
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (rule, key, window_start)
);

-- 'email' when a message was handed to lib/mail.ts, 'logged' when
-- AINEXT_ALERT_EMAIL is unset and the sweep printed instead. The distinction is
-- worth a column: "the rule fired and nobody was told" and "the rule fired and
-- Samuel was mailed" are different facts about the same night.
ALTER TABLE alerts_sent DROP CONSTRAINT IF EXISTS alerts_sent_delivered_check;
ALTER TABLE alerts_sent ADD CONSTRAINT alerts_sent_delivered_check
  CHECK (delivered IN ('email','logged'));

-- The console's question: "what has fired lately, in this environment".
-- Environment leads, because metrics are never pooled across environments
-- (constitution XI, FR-2509) and an alert is a metric about a stack.
CREATE INDEX IF NOT EXISTS idx_alerts_sent_recent
  ON alerts_sent(environment, sent_at DESC);

COMMENT ON TABLE alerts_sent IS
  'One row per (rule, key, window_start): the memory that makes the security '
  'sweep idempotent. Written by app/scripts/alerts-sweep.mts as ainext_maint '
  'and by nobody else; readable by ainext_operator so the console can show '
  'when a rule last fired (ADR-0016 §6, research A5).';

-- ---------------------------------------------------------------------------
-- Grants and RLS — the same shape migration 021 gave `cost_daily`
-- ---------------------------------------------------------------------------

ALTER TABLE alerts_sent ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts_sent FORCE ROW LEVEL SECURITY;

GRANT SELECT ON alerts_sent TO ainext_operator;
GRANT ALL PRIVILEGES ON alerts_sent TO ainext_maint;
REVOKE ALL ON alerts_sent FROM ainext_app;

DROP POLICY IF EXISTS alerts_sent_operator_select ON alerts_sent;
CREATE POLICY alerts_sent_operator_select ON alerts_sent FOR SELECT TO ainext_operator
  USING (true);

-- ainext_maint is BYPASSRLS (017), so it needs no policy of its own; the
-- absence of one is why no other role can reach the table even by accident.

-- ---------------------------------------------------------------------------
-- Verification — asserted, not assumed (the argument migrations 020/021 make)
-- ---------------------------------------------------------------------------

DO $verify$
BEGIN
  IF to_regclass('public.alerts_sent') IS NULL THEN
    RAISE EXCEPTION 'alerts_sent was not created';
  END IF;

  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'public.alerts_sent'::regclass) THEN
    RAISE EXCEPTION 'alerts_sent needs ENABLE *and* FORCE row level security';
  END IF;

  IF NOT has_table_privilege('ainext_maint', 'alerts_sent', 'INSERT') THEN
    RAISE EXCEPTION 'the sweep cannot write alerts_sent';
  END IF;

  IF NOT has_table_privilege('ainext_operator', 'alerts_sent', 'SELECT') THEN
    RAISE EXCEPTION 'the console cannot read alerts_sent';
  END IF;

  IF has_table_privilege('ainext_operator', 'alerts_sent', 'DELETE')
     OR has_table_privilege('ainext_operator', 'alerts_sent', 'UPDATE') THEN
    RAISE EXCEPTION
      'ainext_operator can modify alerts_sent — an alert log the alerted party '
      'can rewrite is not a log (FR-2306''s argument, applied here)';
  END IF;

  IF has_table_privilege('ainext_app', 'alerts_sent', 'SELECT') THEN
    RAISE EXCEPTION
      'ainext_app can read alerts_sent — a student surface has no business in '
      'the security bookkeeping';
  END IF;

  RAISE NOTICE 'alerts_sent: ready, % row(s) on record',
    (SELECT count(*) FROM alerts_sent);
END
$verify$;

COMMIT;
