-- The security record (ADR-0016, data-model.md §10, contracts/analytics.md
-- §Security, FR-2501…FR-2509).
--
-- `analytics_events` answers "what did the product do"; this table answers "who
-- tried to get in, and what was refused". The same fact is never written to
-- both — a sign-in is an auth_events row and not an analytics row — because a
-- security view that has to filter product funnel steps out of its source is a
-- security view nobody reads.
--
-- Two shapes here are deliberate and would look like omissions:
--
--  * **`actor_id` carries no foreign key.** A failed sign-in for an address
--    with no account has nothing to point at, and an event must survive the
--    deletion of its subject — the same reason a log store never holds foreign
--    keys into the business database it observes (R1 §5). `actor_kind` types
--    it: 'account' | 'operator' | 'anonymous'.
--  * **`event` has no CHECK.** The vocabulary is thirteen required names plus
--    five more (contracts/analytics.md), and it will grow; a CHECK would mean a
--    migration every time a new refusal is worth recording, and the failure
--    mode of a forgotten migration is an event that is NOT RECORDED — the exact
--    outcome this table exists to prevent. The application's union type is the
--    gate, and the test asserts emission rather than existence, because
--    defining an event is not emitting it (Talent defines seven and emits
--    three; that is the cautionary example FR-2501 was written against).
--
-- **No password material, ever** — not the attempted password, not its length,
-- not a hash of it. `reason` is a short machine token ('bad_password',
-- 'unknown_email', 'locked', the denied resource), never free text from a form.
--
-- The three indexes are the three questions the security view asks: what has
-- happened lately, how often does this kind of thing happen, and what has this
-- actor been doing. All three lead with `environment` or `actor_kind` because
-- metrics are never pooled across environments (Principle XI).
--
-- Idempotent — safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS auth_events (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  environment  TEXT NOT NULL,
  event        TEXT NOT NULL,
  outcome      TEXT,                  -- success | failure | denied
  actor_kind   TEXT,                  -- account | operator | anonymous
  actor_id     BIGINT,                -- accounts.id or operators.id — untyped on purpose
  subject_kind TEXT,
  subject_id   BIGINT,
  reason       TEXT,                  -- failure reason, denied resource, lock reason
  ip_address   INET,
  user_agent   TEXT,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE auth_events DROP CONSTRAINT IF EXISTS auth_events_outcome_check;
ALTER TABLE auth_events ADD CONSTRAINT auth_events_outcome_check
  CHECK (outcome IS NULL OR outcome IN ('success','failure','denied'));

ALTER TABLE auth_events DROP CONSTRAINT IF EXISTS auth_events_actor_kind_check;
ALTER TABLE auth_events ADD CONSTRAINT auth_events_actor_kind_check
  CHECK (actor_kind IS NULL OR actor_kind IN ('account','operator','anonymous'));

CREATE INDEX IF NOT EXISTS idx_auth_events_time
  ON auth_events(environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_events_event
  ON auth_events(environment, event, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_events_actor
  ON auth_events(actor_kind, actor_id, occurred_at DESC);

COMMENT ON TABLE auth_events IS
  'Append-only security record. 017 grants ainext_app INSERT and NO SELECT — '
  'the student surface writes here and can never read it back — and grants '
  'ainext_operator SELECT and no UPDATE or DELETE.';

COMMIT;
