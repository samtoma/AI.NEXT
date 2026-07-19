-- Parametric visuals: animated/interactive primitives referenced by data spec.
-- One renderer library in the app; hundreds of content items reference it.
CREATE TABLE IF NOT EXISTS visuals (
  id            TEXT PRIMARY KEY,          -- e.g. 'v:u2-1:ratio-intro'
  lo_id         TEXT NOT NULL REFERENCES graph_nodes(id),
  question_id   TEXT REFERENCES questions(id),  -- optional: tied to a question
  kind          TEXT NOT NULL,             -- primitive name, see services/extraction/VIZ_SPEC.md
  spec          JSONB NOT NULL,            -- parameters for the renderer
  caption       TEXT,
  source_page   INT,
  extraction_run_id BIGINT REFERENCES extraction_runs(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_visuals_lo ON visuals(lo_id);
