-- Student MVP 1.0 comparison build (ADR-0007, constitution v2.0.0).
-- Schema delta for the `mvp1` environment: BKT mastery, the misconception /
-- explanation library, profile expansion, richer attempt diagnosis, the analytics
-- event layer, safety flags and uploads.
--
-- Two columns here also ship to the BASELINE environment, and only these two
-- (FR-908): analytics_events (the whole table) and ai_interactions.environment.
-- Everything else is mvp1-only.
--
-- The `attempts` table in schema.sql already carries the comment "designed to fit
-- BKT/IRT later" — this migration is that intent being cashed in.
--
-- Idempotent — safe to re-run.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. mastery: the Elo score becomes a BKT belief.
--
-- `score` keeps its name, its REAL type and its 0..1 range, so every existing
-- read path (lib/ask.ts, lib/lesson.ts, lib/mastery.ts colouring) keeps working
-- unchanged — it now reads P(L) instead of an Elo score. Only the update rule
-- changes (app/src/lib/bkt.ts). Bitemporal row-closing is untouched.
-- ---------------------------------------------------------------------------
ALTER TABLE mastery ADD COLUMN IF NOT EXISTS p_init    REAL NOT NULL DEFAULT 0.30;
ALTER TABLE mastery ADD COLUMN IF NOT EXISTS p_transit REAL NOT NULL DEFAULT 0.10;
ALTER TABLE mastery ADD COLUMN IF NOT EXISTS p_guess   REAL NOT NULL DEFAULT 0.20;
ALTER TABLE mastery ADD COLUMN IF NOT EXISTS p_slip    REAL NOT NULL DEFAULT 0.10;
ALTER TABLE mastery ADD COLUMN IF NOT EXISTS evidence  JSONB;

COMMENT ON COLUMN mastery.score IS
  'P(L) — probability the student knows this LO. Was an Elo-style score before ADR-0007.';
COMMENT ON COLUMN mastery.evidence IS
  'What moved this row: attempt/question ids, observation, prior, posterior, after_transit, misconception, confidence (FR-301).';

-- A degenerate parameter set inverts the meaning of the update rather than
-- failing loudly, so the schema refuses it (contracts/bkt.md invariant 5).
ALTER TABLE mastery DROP CONSTRAINT IF EXISTS mastery_bkt_params_sane;
ALTER TABLE mastery ADD CONSTRAINT mastery_bkt_params_sane CHECK (
  p_init    > 0 AND p_init    < 1 AND
  p_transit > 0 AND p_transit < 1 AND
  p_guess   > 0 AND p_guess   < 1 AND
  p_slip    > 0 AND p_slip    < 1 AND
  p_guess + p_slip < 1
);

-- ---------------------------------------------------------------------------
-- 2. misconceptions — the diagnosable error a refutation answers.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS misconceptions (
  id            TEXT PRIMARY KEY,                       -- misc:<lo>:<slug>
  lo_id         TEXT NOT NULL REFERENCES graph_nodes(id),
  label         TEXT NOT NULL,
  description   TEXT NOT NULL,                          -- what the student is doing wrong
  signal        TEXT,                                   -- how it is recognised in an answer
  generated_by  TEXT NOT NULL,                          -- generator attribution
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_misconceptions_lo ON misconceptions(lo_id);

-- ---------------------------------------------------------------------------
-- 3. explanation_library — typed teaching content.
--
-- `reviewed` is the whole governance story in one column. Constitution v2.0.0
-- Principle III is SUSPENDED for generated entries in this environment only:
-- they ship reviewed=false, attributed, behind Cloudflare Access. That makes
--   SELECT count(*) FROM explanation_library WHERE NOT reviewed
-- the answer to "how much unreviewed teaching is live" at any moment (SC-011),
-- and makes reinstating the gate a policy change rather than a rewrite.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS explanation_library (
  id               TEXT PRIMARY KEY,
  lo_id            TEXT NOT NULL REFERENCES graph_nodes(id),
  misconception_id TEXT REFERENCES misconceptions(id),  -- NULL for non-refutation types
  entry_type       TEXT NOT NULL CHECK (entry_type IN
                     ('worked_example','faded','contrasting_case','refutation')),
  content          JSONB NOT NULL,                      -- typed steps
  source_page      INT,                                 -- provenance (Principle II)
  generated_by     TEXT NOT NULL,
  reviewed         BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_by      TEXT,
  reviewed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- a refutation with nothing to refute is a bug, not a row
  CONSTRAINT explanation_refutation_needs_misconception CHECK (
    entry_type <> 'refutation' OR misconception_id IS NOT NULL
  )
);
CREATE INDEX IF NOT EXISTS idx_expl_lo_type ON explanation_library(lo_id, entry_type);
CREATE INDEX IF NOT EXISTS idx_expl_misconception ON explanation_library(misconception_id);
CREATE INDEX IF NOT EXISTS idx_expl_unreviewed ON explanation_library(reviewed) WHERE NOT reviewed;

-- ---------------------------------------------------------------------------
-- 4. students — profile expansion (FR-302).
-- An empty interests array is valid and means "colder start" (FR-203), not broken.
-- ---------------------------------------------------------------------------
ALTER TABLE students ADD COLUMN IF NOT EXISTS interests         TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE students ADD COLUMN IF NOT EXISTS interest_detail   JSONB;
ALTER TABLE students ADD COLUMN IF NOT EXISTS language_pref     TEXT NOT NULL DEFAULT 'en';
ALTER TABLE students ADD COLUMN IF NOT EXISTS curriculum_system TEXT NOT NULL DEFAULT 'eg-national-en';

ALTER TABLE students DROP CONSTRAINT IF EXISTS students_language_pref_check;
ALTER TABLE students ADD CONSTRAINT students_language_pref_check
  CHECK (language_pref IN ('en','ar','franco'));

-- ---------------------------------------------------------------------------
-- 5. attempts — richer diagnosis (FR-307).
-- `confidence` is nullable on purpose: low or unknown certainty must be RECORDED,
-- never coerced into a confident-looking number (PRD §8 low-confidence row).
-- ---------------------------------------------------------------------------
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS diagnosis_type   TEXT;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS misconception_id TEXT REFERENCES misconceptions(id);
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS stance_used      TEXT;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS confidence       REAL;

-- ---------------------------------------------------------------------------
-- 6. analytics_events — the measurement layer. SHIPS TO BOTH ENVIRONMENTS.
--
-- `environment` is written from configuration (app/src/lib/env.ts), never
-- inferred, so a misconfigured stack produces obviously-wrong data instead of
-- quietly pooled data. Metrics are never reported pooled (Principle XI).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics_events (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  environment  TEXT NOT NULL,
  event        TEXT NOT NULL,
  student_id   BIGINT REFERENCES students(id),
  session_id   TEXT,
  properties   JSONB NOT NULL DEFAULT '{}',
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_env_event_time
  ON analytics_events(environment, event, occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_student ON analytics_events(student_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_session ON analytics_events(session_id, occurred_at);

-- ---------------------------------------------------------------------------
-- 7. safety_flags — deliberately thin (FR-802).
-- Flag type and timestamp only. No transcript, no excerpt. This table exists to
-- prove a flag was raised and dispatched, not to store what a distressed child wrote.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS safety_flags (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id   BIGINT NOT NULL REFERENCES students(id),
  flag_type    TEXT NOT NULL CHECK (flag_type IN ('misconception_gap','needs_immediate_review')),
  dispatched   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_safety_flags_undispatched
  ON safety_flags(created_at) WHERE NOT dispatched;

-- ---------------------------------------------------------------------------
-- 8. uploads (FR-205).
-- 'unreadable' is a distinct state from 'failed' on purpose: they produce
-- different user-facing copy. Unreadable asks the student to retype or reshoot;
-- failed offers a retry. Never silently guess at an unreadable upload.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uploads (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id     BIGINT NOT NULL REFERENCES students(id),
  session_id     TEXT,
  file_type      TEXT NOT NULL,
  storage_path   TEXT NOT NULL,
  parse_status   TEXT NOT NULL CHECK (parse_status IN ('pending','parsed','failed','unreadable')),
  parsed_text    TEXT,
  linked_lo_id   TEXT REFERENCES graph_nodes(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uploads_student ON uploads(student_id, created_at);

-- ---------------------------------------------------------------------------
-- 9. ai_interactions — environment attribution + surface kind.
--
-- surface_kind separates upload/OCR image-token cost from teaching cost, so the
-- new expensive path cannot hide inside a blended per-student figure (Principle VI).
-- `environment` defaults to 'baseline' so the frozen environment is correct without
-- any code change there beyond the instrumentation PR.
-- ---------------------------------------------------------------------------
ALTER TABLE ai_interactions ADD COLUMN IF NOT EXISTS environment  TEXT NOT NULL DEFAULT 'baseline';
ALTER TABLE ai_interactions ADD COLUMN IF NOT EXISTS surface_kind TEXT;
CREATE INDEX IF NOT EXISTS idx_ai_interactions_env ON ai_interactions(environment, created_at);

COMMIT;
