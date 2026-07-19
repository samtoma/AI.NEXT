-- AI Tutor PoC — spine-shaped schema (ADR-0001, ADR-0003)
-- Postgres is the single system of record. Curriculum graph modeled as
-- first-class node/edge tables (thesis Ch. 15.1 semantics); bitemporal via
-- timestamp-range columns (Ch. 16.4 pattern 1); provenance on every fact.

-- ============ PROVENANCE LAYER ============

-- Immutable, content-addressed source documents (thesis Pillar IV)
CREATE TABLE source_documents (
  sha256        TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  publisher     TEXT NOT NULL,          -- e.g. 'Egypt MOETE / CACD'
  edition       TEXT,                   -- e.g. '2025-2026'
  language      TEXT NOT NULL,          -- 'en' | 'ar'
  grade         TEXT NOT NULL,          -- e.g. 'prep-3'
  subject       TEXT NOT NULL,          -- e.g. 'mathematics'
  file_path     TEXT,                   -- local path (not in git)
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Immutable extraction artifacts keyed by (source, schema, extractor version)
CREATE TABLE extraction_runs (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_sha256      TEXT NOT NULL REFERENCES source_documents(sha256),
  extractor          TEXT NOT NULL,     -- e.g. 'claude-fable-5 via claude-code'
  extractor_version  TEXT NOT NULL,
  schema_version     TEXT NOT NULL,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at        TIMESTAMPTZ
);

-- ============ CURRICULUM GRAPH (Ch. 15.1) ============
-- Node kinds: program | course | module | learning_objective | topic

CREATE TABLE graph_nodes (
  id            TEXT PRIMARY KEY,        -- e.g. 'lo:prep3-math:1-1-2'
  kind          TEXT NOT NULL CHECK (kind IN
                  ('program','course','module','learning_objective','topic')),
  label         TEXT NOT NULL,
  description   TEXT,
  syllabus_ref  TEXT,                    -- official syllabus reference
  order_in_parent INT,
  -- provenance
  source_sha256 TEXT REFERENCES source_documents(sha256),
  source_page   INT,
  extraction_run_id BIGINT REFERENCES extraction_runs(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Typed edges with syllabus versioning (Ch. 15.3 pattern 2) and
-- bitemporal columns (Ch. 16): valid_* = real-world truth,
-- system_* = when we knew it. system_to IS NULL = current belief.
CREATE TABLE graph_edges (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  src_id        TEXT NOT NULL REFERENCES graph_nodes(id),
  dst_id        TEXT NOT NULL REFERENCES graph_nodes(id),
  edge_type     TEXT NOT NULL CHECK (edge_type IN
                  ('part_of','teaches','prerequisite_of','about')),
  syllabus_version TEXT NOT NULL,        -- e.g. '2025-2026'
  valid_from    DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to      DATE,                    -- NULL = still true
  system_from   TIMESTAMPTZ NOT NULL DEFAULT now(),
  system_to     TIMESTAMPTZ,             -- NULL = current belief
  extraction_run_id BIGINT REFERENCES extraction_runs(id)
);
CREATE INDEX idx_edges_src ON graph_edges(src_id, edge_type) WHERE system_to IS NULL;
CREATE INDEX idx_edges_dst ON graph_edges(dst_id, edge_type) WHERE system_to IS NULL;

-- ============ QUESTION BANK ============

CREATE TABLE questions (
  id            TEXT PRIMARY KEY,        -- e.g. 'q:prep3-math:1-1:007'
  lo_id         TEXT NOT NULL REFERENCES graph_nodes(id),
  tier          TEXT NOT NULL CHECK (tier IN ('basic','standard','advanced')),
  question_type TEXT NOT NULL CHECK (question_type IN ('mcq','numeric','short')),
  stem          TEXT NOT NULL,           -- markdown + LaTeX
  choices       JSONB,                   -- for mcq: [{key,text}]
  correct_answer TEXT NOT NULL,
  -- canonical solution: human-approved ground truth (hard requirement)
  canonical_solution JSONB NOT NULL,     -- [{step, text_md}]
  solution_version   INT NOT NULL DEFAULT 1,
  -- lifecycle: nothing with status != 'live' is ever served to a student
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN
                  ('draft','review','live','rejected','retired')),
  source        TEXT NOT NULL CHECK (source IN ('seed','variant','authored')),
  parent_question_id TEXT REFERENCES questions(id),  -- variants → their seed
  -- provenance (span citation to source document)
  source_sha256 TEXT REFERENCES source_documents(sha256),
  source_page   INT,
  source_note   TEXT,                    -- e.g. 'inspired by Example 3, lesson 1-1'
  extraction_run_id BIGINT REFERENCES extraction_runs(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by   TEXT,
  reviewed_at   TIMESTAMPTZ
);
CREATE INDEX idx_questions_lo ON questions(lo_id, tier) WHERE status = 'live';

-- ============ STUDENTS & LEARNING STATE ============

CREATE TABLE students (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  display_name  TEXT NOT NULL,
  grade         TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only. The defensibility asset (PRD §6.2): designed to fit BKT/IRT later.
CREATE TABLE attempts (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id    BIGINT NOT NULL REFERENCES students(id),
  question_id   TEXT NOT NULL REFERENCES questions(id),
  session_id    BIGINT,
  given_answer  TEXT,
  is_correct    BOOLEAN NOT NULL,
  time_ms       INT,
  attempted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_attempts_student ON attempts(student_id, attempted_at);

-- Temporal mastery: history preserved, never overwritten (Ch. 16).
-- Current mastery = row with system_to IS NULL. Day-45 score lift = as-of query.
CREATE TABLE mastery (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id    BIGINT NOT NULL REFERENCES students(id),
  lo_id         TEXT NOT NULL REFERENCES graph_nodes(id),
  score         REAL NOT NULL,           -- Elo-style, 0..1 normalized
  system_from   TIMESTAMPTZ NOT NULL DEFAULT now(),
  system_to     TIMESTAMPTZ              -- NULL = current
);
CREATE INDEX idx_mastery_current ON mastery(student_id, lo_id) WHERE system_to IS NULL;

CREATE TABLE sessions (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id    BIGINT NOT NULL REFERENCES students(id),
  plan          JSONB NOT NULL,          -- assigned question ids + rationale mix
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ
);

-- Every explanation logged and replayable (Pillar IV)
CREATE TABLE explanation_log (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attempt_id    BIGINT REFERENCES attempts(id),
  question_id   TEXT NOT NULL REFERENCES questions(id),
  solution_version INT NOT NULL,
  model         TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  wrong_answer  TEXT,
  output_md     TEXT NOT NULL,
  grounded_ok   BOOLEAN NOT NULL DEFAULT true,  -- false → fell back to canonical
  cached        BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
