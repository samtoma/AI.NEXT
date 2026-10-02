-- ===========================================================================
-- 036 — the console review gate: an append-only record of every human review
--       decision, and a short claim so two reviewers never hold one item
--
-- Feature 003. Samuel's answer 37 (2026-10-01): "let's prepare in the console a
-- review gate, just internal and the aim will be that the console has zero
-- backlog, so I, Tamer and Kamil will be reviewing one by one … keep the
-- student always full as if everything has been reviewed". Answer 33: only a
-- HUMAN stamp is a review (migration 035 put AI checks in their own columns).
-- Additive and idempotent. Safe to re-run; `deploy/apply-migrations.sh` does,
-- on every deploy, in filename order, while the previous app is still serving.
-- Rollback: `rollback/036-review-gate.down.sql`.
-- ===========================================================================
--
-- WHAT THE BACKLOG IS. It is NOT stored. It is derived on every read by the
-- console (`app/src/lib/review-gate*.ts`) from the content tables themselves —
-- every maths question with no human stamp, every widget predicate→misconception
-- claim, every misconception, worked example, objective and prerequisite link,
-- every `book_image` figure stand-in — and from the pipeline's auto-passed
-- gate records (answer 39: Samuel's to sign; read from its run files) — minus
-- what a human has decided here. A
-- stored backlog would be a second copy of the content's state that the
-- loaders would have to keep in step; deriving it means a reload that changes
-- an item puts it straight back in front of a human.
--
-- TWO TABLES.
--
--   1. `review_decisions` — one row per human decision: approve, fix
--      requested or reject, with a note (required unless approving), an
--      optional suggested correction, who (operator id AND the display name
--      the stamp was written with), when, and the environment.
--        · `item_kind` + `item_ref` name the item (a question id; a widget
--          claim "q:…|predicate|mc:…"; a misconception, entry, objective or
--          figure id; a link "src>dst"; a gate decision "<book>/<id>"). Content ids are not foreign keys: the
--          loaders replace content, and a decision must outlive the row it
--          was about — it is the audit of what a person saw and said.
--        · `item_fingerprint` is a hash of the content the reviewer saw. The
--          console treats a decision as current only while the item still
--          hashes the same: a reload or a pipeline fix that changes the item
--          puts it back in the backlog ("changed since <who> approved it"),
--          and a "fix requested" leaves the fix list by itself once the item
--          has actually changed.
--        · `snapshot` is that content, compact, so the record reads on its
--          own after the content has moved on; `changes` is exactly what the
--          decision wrote (before → after), e.g. a question's stamp, its
--          status going to 'retired', a claim moving into `diagnostics`.
--      APPEND-ONLY, for every role, the owner included: a trigger refuses
--      UPDATE and DELETE. The console holds SELECT and INSERT, and the INSERT
--      policy only admits a row in the name of the operator on the transaction
--      (`app.operator_id`, set by `withOperator`) — a reviewer cannot record a
--      decision as somebody else. This table IS the audit of the review gate
--      (FR-2204: exercising `content-review` is recorded).
--
--   2. `review_claims` — "this reviewer has this item open", one row per item,
--      expiring after a few minutes (the app asks for 10). The console's
--      "next item" takes the oldest open item nobody else holds, and an
--      operator holds one item at a time. RLS does the exclusivity: a claim
--      may be written only in the operator's own name, and another
--      operator's claim may be taken over or removed only once it has
--      expired. Ephemeral: losing every row loses nothing but who is looking
--      at what this minute.
--
-- NOTHING A STUDENT SEES IS HERE. `ainext_app` holds no privilege on either
-- table (asserted below), and the student build has no route that reads them.
-- The effects a decision has on content (a human stamp, a retired question, a
-- widget claim activated) are written by the console to the content tables it
-- already holds UPDATE on (017/018), and the student surface reads those as it
-- always has — review status itself stays an operator fact (ADR-0019).
--
-- DEPENDS ON 035. The gate's meaning of "reviewed" is 035's: `reviewed_by` is a
-- human stamp and nothing else, AI checks live in `ai_checked_by`, safety holds
-- in `hold_reason`. Asserted below, so a database that has 036 without 035
-- fails here rather than counting AI checks as human reviews.
--
-- RE-RUNS: `CREATE TABLE IF NOT EXISTS`, indexes / trigger / RLS / policies
-- created only when the catalogue says they are missing or differ (030's
-- idiom), GRANT/REVOKE unconditional so a hand-edited privilege converges on
-- the next deploy (017's rule). Nothing is backfilled, so nothing can fail on
-- data. The two CHECKs that are value lists (`item_kind`, `decision`) are the
-- gate's own vocabulary and are created WITH the table, on an empty table;
-- widening one is a new migration, never a re-run of this one.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. 035 first
-- ---------------------------------------------------------------------------

DO $requires$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'questions'
         AND column_name IN ('ai_checked_by', 'hold_reason', 'review_note')) <> 3 THEN
    RAISE EXCEPTION '036 needs 035 (questions.ai_checked_by / hold_reason / review_note): '
                    'without it an AI check would read as a human review';
  END IF;
END
$requires$;

-- ---------------------------------------------------------------------------
-- 1. The decisions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS review_decisions (
  id                   bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  environment          text        NOT NULL,
  item_kind            text        NOT NULL
                       CONSTRAINT review_decisions_item_kind_check
                       CHECK (item_kind IN ('book_question', 'generated_question',
                                            'widget_question', 'mapping_claim',
                                            'misconception', 'worked_example',
                                            'objective', 'prerequisite_link',
                                            'figure_stand_in', 'gate_decision')),
  item_ref             text        NOT NULL CHECK (length(item_ref) BETWEEN 1 AND 400),
  course_id            text        NOT NULL,
  module_id            text,
  lo_id                text,
  item_fingerprint     text        NOT NULL CHECK (length(item_fingerprint) BETWEEN 1 AND 128),
  decision             text        NOT NULL
                       CONSTRAINT review_decisions_decision_check
                       CHECK (decision IN ('approve', 'fix_requested', 'reject')),
  note                 text        CHECK (note IS NULL OR length(note) <= 2000),
  suggested_correction text        CHECK (suggested_correction IS NULL
                                          OR length(suggested_correction) <= 8000),
  snapshot             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  changes              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  operator_id          bigint      NOT NULL REFERENCES operators(id),
  -- The name the human stamp was written with, as it read at the time.
  operator_name        text        NOT NULL,
  decided_at           timestamptz NOT NULL DEFAULT now(),
  -- A fix request or a rejection says why, or it is not actionable.
  CONSTRAINT review_decisions_note_unless_approve
    CHECK (decision = 'approve' OR length(btrim(coalesce(note, ''))) > 0)
);

COMMENT ON TABLE review_decisions IS
  'Migration 036 (answer 37): every human decision of the console review gate — '
  'approve / fix_requested / reject — on one backlog item, with the content '
  'fingerprint and snapshot the reviewer saw and exactly what the decision '
  'changed. Append-only for every role (trigger); the console inserts only in '
  'its own operator''s name (RLS). The backlog itself is derived, never stored.';

-- WIDENED ONCE, before this file shipped anywhere: 'gate_decision' (Samuel's
-- answer 39 — every auto-passed pipeline gate is a backlog item for him) was
-- added after the first draft of this file reached a developer's database.
-- Guarded: the CHECK is replaced only when its definition lacks the value,
-- and replacing it only ever WIDENS the list, so every existing row passes.
-- A re-run finds it current and takes no lock.
DO $widen$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.review_decisions'::regclass
                    AND conname = 'review_decisions_item_kind_check'
                    AND pg_get_constraintdef(oid) LIKE '%gate_decision%') THEN
    ALTER TABLE review_decisions DROP CONSTRAINT IF EXISTS review_decisions_item_kind_check;
    ALTER TABLE review_decisions ADD CONSTRAINT review_decisions_item_kind_check
      CHECK (item_kind IN ('book_question', 'generated_question', 'widget_question', 'mapping_claim',
                           'misconception', 'worked_example', 'objective', 'prerequisite_link',
                           'figure_stand_in', 'gate_decision'));
  END IF;
END
$widen$;

DO $decision_idx$
BEGIN
  IF to_regclass('public.idx_review_decisions_item') IS NULL THEN
    CREATE INDEX idx_review_decisions_item
      ON review_decisions (environment, item_kind, item_ref, decided_at DESC);
  END IF;
  IF to_regclass('public.idx_review_decisions_operator') IS NULL THEN
    CREATE INDEX idx_review_decisions_operator
      ON review_decisions (environment, operator_id, decided_at DESC);
  END IF;
  IF to_regclass('public.idx_review_decisions_open_fixes') IS NULL THEN
    CREATE INDEX idx_review_decisions_open_fixes
      ON review_decisions (environment, decided_at DESC) WHERE decision <> 'approve';
  END IF;
END
$decision_idx$;

-- Append-only, for every role. BEFORE UPDATE OR DELETE with no column list, so
-- any statement naming any column is refused; TRUNCATE is a table-level act
-- only the owner holds, and the rollback drops the table instead.
CREATE OR REPLACE FUNCTION review_decisions_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION
    'review_decisions is append-only (migration 036): a decision is never edited or removed — record a new one'
    USING ERRCODE = 'check_violation';
END
$fn$;

DO $append_only$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.review_decisions'::regclass
       AND tgname = 'review_decisions_append_only'
       AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER review_decisions_append_only
      BEFORE UPDATE OR DELETE ON review_decisions
      FOR EACH ROW EXECUTE FUNCTION review_decisions_append_only();
  END IF;
END
$append_only$;

-- ---------------------------------------------------------------------------
-- 2. The claims
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS review_claims (
  environment text        NOT NULL,
  item_kind   text        NOT NULL,
  item_ref    text        NOT NULL,
  -- CASCADE: a claim means nothing without its operator.
  operator_id bigint      NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  claimed_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  PRIMARY KEY (environment, item_kind, item_ref),
  CONSTRAINT review_claims_expires_after_claim CHECK (expires_at > claimed_at)
);

COMMENT ON TABLE review_claims IS
  'Migration 036: which reviewer has which backlog item open, until expires_at. '
  'One row per item; an operator writes claims only in their own name and may '
  'take over or remove another''s only once it has expired (RLS). Ephemeral.';

DO $claim_idx$
BEGIN
  IF to_regclass('public.idx_review_claims_operator') IS NULL THEN
    CREATE INDEX idx_review_claims_operator ON review_claims (operator_id);
  END IF;
END
$claim_idx$;

-- ---------------------------------------------------------------------------
-- 3. Grants — start from nothing on both tables (017's rule)
-- ---------------------------------------------------------------------------

REVOKE ALL ON review_decisions, review_claims FROM ainext_app, ainext_operator;

-- The console reads the record and appends to it. Nobody edits it.
GRANT SELECT, INSERT                 ON review_decisions TO ainext_operator;
-- The console takes, renews and releases claims.
GRANT SELECT, INSERT, UPDATE, DELETE ON review_claims    TO ainext_operator;
-- Scripts (the fix-request export, backfills) read everything.
GRANT ALL PRIVILEGES ON review_decisions, review_claims TO ainext_maint;

-- ---------------------------------------------------------------------------
-- 4. Row-level security, guarded so a re-run locks nothing (030's pattern)
-- ---------------------------------------------------------------------------
-- `app.operator_id` is set per transaction by `withOperator` (app/src/lib/db.ts).
-- With no operator on the transaction the expression is NULL, every WITH CHECK
-- fails and no write lands — fail-closed.

DO $rls$
DECLARE
  me   text := '(operator_id = (NULLIF(current_setting(''app.operator_id''::text, true), ''''::text))::bigint)';
  mine_or_expired text := '((operator_id = (NULLIF(current_setting(''app.operator_id''::text, true), ''''::text))::bigint) OR (expires_at <= now()))';
  pol record;
  want record;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.review_decisions'::regclass) THEN
    ALTER TABLE review_decisions ENABLE ROW LEVEL SECURITY;
  END IF;
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.review_decisions'::regclass) THEN
    ALTER TABLE review_decisions FORCE ROW LEVEL SECURITY;
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.review_claims'::regclass) THEN
    ALTER TABLE review_claims ENABLE ROW LEVEL SECURITY;
  END IF;
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.review_claims'::regclass) THEN
    ALTER TABLE review_claims FORCE ROW LEVEL SECURITY;
  END IF;

  FOR want IN
    SELECT * FROM (VALUES
      ('review_decisions', 'review_decisions_operator_select', 'SELECT', 'true',          NULL::text),
      ('review_decisions', 'review_decisions_operator_insert', 'INSERT', NULL,            me),
      ('review_claims',    'review_claims_operator_select',    'SELECT', 'true',          NULL),
      ('review_claims',    'review_claims_operator_insert',    'INSERT', NULL,            me),
      ('review_claims',    'review_claims_operator_update',    'UPDATE', mine_or_expired, me),
      ('review_claims',    'review_claims_operator_delete',    'DELETE', mine_or_expired, NULL)
    ) AS w(tbl, name, cmd, qual, chk)
  LOOP
    SELECT p.cmd, p.roles, p.qual, p.with_check INTO pol
      FROM pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename = want.tbl AND p.policyname = want.name;
    IF NOT FOUND
       OR pol.cmd IS DISTINCT FROM want.cmd
       OR pol.roles IS DISTINCT FROM ARRAY['ainext_operator']::name[]
       OR pol.qual IS DISTINCT FROM want.qual
       OR pol.with_check IS DISTINCT FROM want.chk THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', want.name, want.tbl);
      EXECUTE format('CREATE POLICY %I ON %I FOR %s TO ainext_operator', want.name, want.tbl, want.cmd)
        || CASE WHEN want.qual IS NOT NULL THEN format(' USING (%s)', want.qual) ELSE '' END
        || CASE WHEN want.chk  IS NOT NULL THEN format(' WITH CHECK (%s)', want.chk) ELSE '' END;
    END IF;
  END LOOP;
END
$rls$;

-- ---------------------------------------------------------------------------
-- 5. Verification — asserted, not assumed
-- ---------------------------------------------------------------------------

DO $verify$
BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'public.review_decisions'::regclass)
     OR NOT (SELECT relrowsecurity AND relforcerowsecurity
               FROM pg_class WHERE oid = 'public.review_claims'::regclass) THEN
    RAISE EXCEPTION '036: review_decisions and review_claims need ENABLE *and* FORCE row level security';
  END IF;

  -- THE ONE THIS FILE EXISTS FOR, from the student side: review status is an
  -- operator fact (ADR-0019). The student surface can neither read nor write it.
  IF has_table_privilege('ainext_app', 'review_decisions', 'SELECT')
     OR has_table_privilege('ainext_app', 'review_decisions', 'INSERT')
     OR has_table_privilege('ainext_app', 'review_claims', 'SELECT')
     OR has_table_privilege('ainext_app', 'review_claims', 'INSERT')
     OR has_any_column_privilege('ainext_app', 'review_decisions', 'SELECT')
     OR has_any_column_privilege('ainext_app', 'review_claims', 'SELECT') THEN
    RAISE EXCEPTION '036: ainext_app holds a privilege on the review gate — review status must never reach a student surface';
  END IF;

  -- The console can do its job …
  IF NOT has_table_privilege('ainext_operator', 'review_decisions', 'INSERT')
     OR NOT has_table_privilege('ainext_operator', 'review_decisions', 'SELECT')
     OR NOT has_table_privilege('ainext_operator', 'review_claims', 'INSERT')
     OR NOT has_table_privilege('ainext_operator', 'review_claims', 'DELETE') THEN
    RAISE EXCEPTION '036: the console cannot record a decision or hold a claim';
  END IF;
  -- … and the effects it writes need the content grants 017/018 already give it.
  IF NOT has_column_privilege('ainext_operator', 'questions', 'reviewed_by', 'UPDATE')
     OR NOT has_column_privilege('ainext_operator', 'questions', 'status', 'UPDATE')
     OR NOT has_column_privilege('ainext_operator', 'questions', 'choices', 'UPDATE')
     OR NOT has_column_privilege('ainext_operator', 'explanation_library', 'reviewed', 'UPDATE') THEN
    RAISE EXCEPTION '036: ainext_operator cannot write a review''s effect (questions stamp/status/choices, library reviewed)';
  END IF;
  -- … and no more: an audit its author can edit is decoration.
  IF has_table_privilege('ainext_operator', 'review_decisions', 'UPDATE')
     OR has_table_privilege('ainext_operator', 'review_decisions', 'DELETE') THEN
    RAISE EXCEPTION '036: ainext_operator can edit or delete a review decision';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.review_decisions'::regclass
                    AND tgname = 'review_decisions_append_only' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '036: review_decisions_append_only is missing — a decision could be rewritten';
  END IF;

  RAISE NOTICE '036 review gate: ready — % decision(s) recorded, % claim(s) open',
    (SELECT count(*) FROM review_decisions),
    (SELECT count(*) FROM review_claims WHERE expires_at > now());
END
$verify$;

COMMIT;
