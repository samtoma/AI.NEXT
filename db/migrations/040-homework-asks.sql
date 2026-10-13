-- ===========================================================================
-- 040 — homework asks (spec 004, ADR-0025 — PROPOSED, prototype branch only)
--
-- A student's own question, typed or uploaded, split into the questions it
-- holds. Additive and idempotent; safe to re-run.
--
--   homework_asks   one per "Ask Noor" send
--   homework_items  one per question found in it (FR-3604)
--   homework_flags  one per "That doesn't look right" (FR-3612)
--
-- Every table carries student_id and environment (Principle XI) and is under
-- the same row-level-security policy shape as `uploads` (migration 017).
-- ===========================================================================

CREATE TABLE IF NOT EXISTS homework_asks (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id   BIGINT NOT NULL REFERENCES students(id),
  environment  TEXT   NOT NULL,
  source       TEXT   NOT NULL CHECK (source IN ('typed','upload')),
  upload_id    BIGINT REFERENCES uploads(id),
  typed_text   TEXT,
  -- reading: waiting on the upload parse and/or the split
  -- ready: items exist · unreadable: nothing readable · failed: retryable
  status       TEXT   NOT NULL DEFAULT 'reading'
                      CHECK (status IN ('reading','ready','unreadable','failed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((source = 'typed' AND typed_text IS NOT NULL) OR (source = 'upload' AND upload_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_homework_asks_student ON homework_asks(student_id, created_at);

CREATE TABLE IF NOT EXISTS homework_items (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ask_id       BIGINT NOT NULL REFERENCES homework_asks(id) ON DELETE CASCADE,
  student_id   BIGINT NOT NULL REFERENCES students(id),
  environment  TEXT   NOT NULL,
  position     INT    NOT NULL,
  label        TEXT,
  -- the question as read; each unreadable span is the literal token ▒▒
  text         TEXT   NOT NULL,
  -- one entry per ▒▒, in order: {"ask": "What is that number?", "answer": null}
  gaps         JSONB  NOT NULL DEFAULT '[]',
  subject      TEXT   NOT NULL DEFAULT 'maths' CHECK (subject IN ('maths','other')),
  lo_id        TEXT   REFERENCES graph_nodes(id),
  status       TEXT   NOT NULL DEFAULT 'open' CHECK (status IN ('open','active','done')),
  mode         TEXT   CHECK (mode IS NULL OR mode IN ('walk','check')),
  edited       BOOLEAN NOT NULL DEFAULT false,
  done_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ask_id, position)
);
CREATE INDEX IF NOT EXISTS idx_homework_items_ask ON homework_items(ask_id, position);

CREATE TABLE IF NOT EXISTS homework_flags (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id     BIGINT NOT NULL REFERENCES students(id),
  environment    TEXT   NOT NULL,
  item_id        BIGINT NOT NULL REFERENCES homework_items(id) ON DELETE CASCADE,
  -- the Noor message the student disagreed with, as shown
  tutor_message  TEXT   NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_homework_flags_item ON homework_flags(item_id);

-- The homework surface is a session kind of its own (FR-3614), so its
-- sittings, cost and flags read apart from teaching.
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_kind_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_kind_check
  CHECK (kind IN ('lesson_learn','lesson_review','practice','student_chat','spine_chat','homework'));

-- --- privileges + row-level security (the migration 017 shape) -------------
GRANT SELECT, INSERT, UPDATE ON homework_asks, homework_items TO ainext_app;
GRANT SELECT, INSERT         ON homework_flags                TO ainext_app;
GRANT SELECT ON homework_asks, homework_items, homework_flags  TO ainext_operator;

DO $rls$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['homework_asks','homework_items','homework_flags']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_app', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO ainext_app
         USING      (student_id = nullif(current_setting(''app.student_id'', true), '''')::bigint)
         WITH CHECK (student_id = nullif(current_setting(''app.student_id'', true), '''')::bigint)',
      t || '_app', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_operator', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO ainext_operator USING (true)',
      t || '_operator', t);
  END LOOP;
END
$rls$;
