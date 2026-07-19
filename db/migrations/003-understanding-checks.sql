-- Comprehension rating at the end of an AI-led learn/review session.
-- The AI grades the DISCUSSION (structured output), not just the answers;
-- stored separately from Elo mastery (which tracks question attempts).
CREATE TABLE IF NOT EXISTS understanding_checks (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id    BIGINT NOT NULL REFERENCES students(id),
  lo_id         TEXT NOT NULL REFERENCES graph_nodes(id),
  mode          TEXT NOT NULL CHECK (mode IN ('learn','review')),
  score         INT NOT NULL CHECK (score BETWEEN 0 AND 100),
  verdict       TEXT NOT NULL CHECK (verdict IN ('got_it','nearly','needs_work')),
  strengths     JSONB,                 -- what the discussion showed he understands
  gaps          JSONB,                 -- specific misconceptions observed
  next_step     TEXT,                  -- one concrete recommendation
  turns         INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_understanding_student ON understanding_checks(student_id, created_at);
