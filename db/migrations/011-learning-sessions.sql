-- ADR-0015: one interaction timeline per student per session.
--
-- `sessions` has existed since schema.sql and has never held a row. What the
-- product calls a session today is an opaque string the browser invented, in
-- three incompatible shapes: `grounding->>'chat_session'` on ai_interactions,
-- `uploads.session_id` (TEXT), `analytics_events.session_id` (TEXT). None of
-- them is a row, so a tutor turn cannot be tied to the lesson it belonged to
-- except by timestamp proximity — a guess this migration exists to stop making.
--
-- Four changes, all additive and idempotent.
--
-- 1. `sessions` becomes the durable learning-session row: kind, surface, the
--    open/closed lifecycle, and the legacy client string kept as `client_key`
--    so turns already written stay correlated. `plan` becomes nullable — it was
--    written for an assigned-question plan that never shipped and nothing reads
--    it. `assigned_at` stays as the legacy creation stamp and equals
--    `opened_at` for every row written from here on.
--
--    `last_seen_at` is NOT in data-model.md §1 and is added deliberately: the
--    inactivity rule (FR-2302, 30 minutes) closes a session a stated time after
--    the LAST interaction, and neither `opened_at` nor `assigned_at` can answer
--    "when did this student last do something". Without it the sweep would have
--    to scan four interaction tables per open session to find out.
--
-- 2. The partial unique index is the invariant, not the decoration. At most one
--    open session per student is what makes FR-2301's "exactly one session"
--    true rather than aspirational, and it is what lets lib/sessions.ts open a
--    session by INSERT-and-handle-the-violation instead of check-then-insert.
--
-- 3. Session keys on the five tables that record interactions. Types disagree
--    today (`sessions.id` and `attempts.session_id` are BIGINT; the uploads and
--    analytics columns are TEXT), so the BIGINT reference is a NEW column
--    (`session_ref`) rather than a cast. The legacy TEXT columns are RETAINED
--    during the transition and dropped in a later release. They hold the client
--    string and MUST NEVER be joined to `sessions.id` — the types disagree and
--    a join that returned rows would be returning coincidences.
--
-- 4. Backfill: each distinct legacy client string becomes exactly one session
--    row. Rows with no client string keep a NULL session (FR-2309) — every
--    existing `attempts` row is in that category, and attaching it to the
--    nearest session in time is the guess ADR-0015 option (c) rejected.
--
-- Idempotent — safe to re-run.

BEGIN;

-- 1 ------------------------------------------------------------------
-- sessions: dead schema becomes the learning session.

ALTER TABLE sessions ALTER COLUMN plan DROP NOT NULL;

ALTER TABLE sessions
  -- DEFAULT 'student_chat' only so this ALTER cannot fail on a table that has
  -- rows; every write path passes `kind` explicitly (lib/sessions.ts).
  ADD COLUMN IF NOT EXISTS kind         TEXT NOT NULL DEFAULT 'student_chat',
  ADD COLUMN IF NOT EXISTS surface      TEXT,
  ADD COLUMN IF NOT EXISTS lo_id        TEXT,
  ADD COLUMN IF NOT EXISTS opened_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS closed_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS close_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS client_key   TEXT,
  -- Same safe default as lib/env.ts: an unconfigured stack must produce
  -- obviously-wrong attribution rather than quietly-plausible attribution
  -- (constitution Principle XI). Migration 012 owns the wider environment work.
  ADD COLUMN IF NOT EXISTS environment  TEXT NOT NULL DEFAULT 'baseline';

ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_kind_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_kind_check
  CHECK (kind IN ('lesson_learn','lesson_review','practice','student_chat','spine_chat'));

-- close_reason and closed_at are one fact in two columns: a session is open
-- with neither, or closed with both. A closed session with no reason would make
-- "did she finish, or did she walk away" (FR-2302) unanswerable.
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_close_reason_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_close_reason_check
  CHECK (
    (closed_at IS NULL AND close_reason IS NULL)
    OR (closed_at IS NOT NULL
        AND close_reason IN ('completed','inactivity','superseded','abandoned'))
  );

-- 2 ------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_open_one
  ON sessions(student_id) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_student_time
  ON sessions(student_id, opened_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_client_key
  ON sessions(student_id, client_key) WHERE client_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_idle
  ON sessions(last_seen_at) WHERE closed_at IS NULL;

-- 3 ------------------------------------------------------------------
-- Session keys on the five interaction tables. Nullable on purpose: FR-2309
-- requires an unattributable interaction to be recorded as belonging to no
-- session, and NOT NULL would force the write path to invent one.

ALTER TABLE ai_interactions      ADD COLUMN IF NOT EXISTS session_id  BIGINT;
ALTER TABLE understanding_checks ADD COLUMN IF NOT EXISTS session_id  BIGINT;
ALTER TABLE uploads              ADD COLUMN IF NOT EXISTS session_ref BIGINT;
ALTER TABLE analytics_events     ADD COLUMN IF NOT EXISTS session_ref BIGINT;

ALTER TABLE ai_interactions DROP CONSTRAINT IF EXISTS ai_interactions_session_id_fkey;
ALTER TABLE ai_interactions ADD CONSTRAINT ai_interactions_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES sessions(id);

ALTER TABLE understanding_checks DROP CONSTRAINT IF EXISTS understanding_checks_session_id_fkey;
ALTER TABLE understanding_checks ADD CONSTRAINT understanding_checks_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES sessions(id);

ALTER TABLE uploads DROP CONSTRAINT IF EXISTS uploads_session_ref_fkey;
ALTER TABLE uploads ADD CONSTRAINT uploads_session_ref_fkey
  FOREIGN KEY (session_ref) REFERENCES sessions(id);

ALTER TABLE analytics_events DROP CONSTRAINT IF EXISTS analytics_events_session_ref_fkey;
ALTER TABLE analytics_events ADD CONSTRAINT analytics_events_session_ref_fkey
  FOREIGN KEY (session_ref) REFERENCES sessions(id);

-- attempts.session_id has been a bare BIGINT with no FK since schema.sql, and
-- was never in the INSERT column list, so every row carries NULL.
ALTER TABLE attempts DROP CONSTRAINT IF EXISTS attempts_session_id_fkey;
ALTER TABLE attempts ADD CONSTRAINT attempts_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES sessions(id);

CREATE INDEX IF NOT EXISTS idx_ai_interactions_session   ON ai_interactions(session_id);
CREATE INDEX IF NOT EXISTS idx_understanding_session     ON understanding_checks(session_id);
CREATE INDEX IF NOT EXISTS idx_uploads_session_ref       ON uploads(session_ref);
CREATE INDEX IF NOT EXISTS idx_events_session_ref        ON analytics_events(session_ref);
CREATE INDEX IF NOT EXISTS idx_attempts_session          ON attempts(session_id);

-- 4 ------------------------------------------------------------------
-- Backfill. One session row per (student, distinct legacy client string).
--
-- `understanding_checks` never stored the client string itself — the client
-- does not even send one to /api/understanding (LessonSession.tsx:553). It is
-- reachable only through its grading turn's ledger row, whose grounding carries
-- both `chat_session` and `check_id`. That indirection is the whole reason a
-- check written today cannot be tied to the lesson that produced it.
--
-- Everything here is guarded by IS NULL / ON CONFLICT DO NOTHING, so a re-run
-- reports zeroes rather than duplicating anything.

DO $backfill$
DECLARE
  n_sessions   INT;
  n_ai         INT;
  n_understand INT;
  n_uploads    INT;
  n_events     INT;
BEGIN
  WITH legacy AS (
    SELECT student_id, client_key, kind, surface, environment, ts FROM (
      SELECT a.student_id,
             nullif(a.grounding->>'chat_session', '') AS client_key,
             CASE WHEN a.surface IN ('lesson_learn','lesson_review','student_chat','spine_chat')
                  THEN a.surface ELSE 'student_chat' END AS kind,
             a.surface,
             a.environment,
             a.created_at AS ts
        FROM ai_interactions a
       WHERE a.student_id IS NOT NULL
      UNION ALL
      -- uploads and analytics predate any per-surface record of what the
      -- student was doing, so the kind is the honest weakest claim.
      SELECT u.student_id, nullif(u.session_id, ''), 'student_chat', 'upload_intake',
             'mvp1', u.created_at
        FROM uploads u
      UNION ALL
      SELECT e.student_id, nullif(e.session_id, ''), 'student_chat', 'client_event',
             e.environment, e.occurred_at
        FROM analytics_events e
       WHERE e.student_id IS NOT NULL
    ) s
    WHERE s.client_key IS NOT NULL
  )
  INSERT INTO sessions (student_id, kind, surface, client_key, environment,
                        opened_at, last_seen_at, closed_at, close_reason, assigned_at)
  SELECT l.student_id,
         (array_agg(l.kind        ORDER BY l.ts))[1],
         (array_agg(l.surface     ORDER BY l.ts))[1],
         l.client_key,
         (array_agg(l.environment ORDER BY l.ts))[1],
         min(l.ts), max(l.ts), max(l.ts),
         -- Nothing closed these; they ended when the browser tab did.
         'abandoned', min(l.ts)
    FROM legacy l
   GROUP BY l.student_id, l.client_key
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n_sessions = ROW_COUNT;

  UPDATE ai_interactions a SET session_id = s.id
    FROM sessions s
   WHERE a.session_id IS NULL
     AND s.student_id = a.student_id
     AND s.client_key = nullif(a.grounding->>'chat_session', '');
  GET DIAGNOSTICS n_ai = ROW_COUNT;

  UPDATE understanding_checks uc SET session_id = a.session_id
    FROM ai_interactions a
   WHERE uc.session_id IS NULL
     AND a.session_id IS NOT NULL
     AND a.surface_kind = 'understanding'
     AND a.student_id = uc.student_id
     AND a.grounding->>'check_id' = uc.id::text;
  GET DIAGNOSTICS n_understand = ROW_COUNT;

  UPDATE uploads u SET session_ref = s.id
    FROM sessions s
   WHERE u.session_ref IS NULL
     AND s.student_id = u.student_id
     AND s.client_key = nullif(u.session_id, '');
  GET DIAGNOSTICS n_uploads = ROW_COUNT;

  UPDATE analytics_events e SET session_ref = s.id
    FROM sessions s
   WHERE e.session_ref IS NULL
     AND s.student_id = e.student_id
     AND s.client_key = nullif(e.session_id, '');
  GET DIAGNOSTICS n_events = ROW_COUNT;

  RAISE NOTICE 'backfill: % sessions from legacy client strings', n_sessions;
  RAISE NOTICE 'backfill: ai_interactions %, understanding_checks %, uploads %, analytics_events %',
               n_ai, n_understand, n_uploads, n_events;
  RAISE NOTICE 'backfill: attempts deliberately untouched — no client string was ever recorded '
               'on an attempt, and the nearest session in time is a guess (FR-2309)';
END
$backfill$;

COMMIT;
