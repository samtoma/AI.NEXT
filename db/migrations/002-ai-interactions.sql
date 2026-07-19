-- Ask the Spine: grounded AI chat interactions with per-turn cost instrumentation
-- (AI cost ceiling is a PRD hard requirement — instrument from day one)
CREATE TABLE IF NOT EXISTS ai_interactions (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id    BIGINT REFERENCES students(id),
  surface       TEXT NOT NULL,            -- 'spine_chat' | 'student_chat'
  turn_index    INT NOT NULL,
  user_message  TEXT NOT NULL,
  assistant_message TEXT NOT NULL,
  grounding     JSONB NOT NULL,           -- {lo_ids:[], question_ids:[], pages:[]} sent as context
  citations     JSONB,                    -- chips the model actually emitted
  model         TEXT NOT NULL,
  input_tokens  INT,
  output_tokens INT,
  cost_usd      NUMERIC(10,6),
  latency_ms    INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_interactions_student ON ai_interactions(student_id, created_at);
