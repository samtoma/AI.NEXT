-- ===========================================================================
-- 030 — the runtime teaching toggle, tester accounts, and the per-sitting
--       snapshot on every learning session
--
-- ADR-0021 (Samuel, 2026-09-24). v0.6.0 merged Socratic probing behind a
-- compile-time constant, switched off. This file is the database half of
-- replacing that constant with a decision an operator makes in the console,
-- recorded when each sitting opens — and narrowed on every request after
-- (option B: Off reaches the next message, On the next sitting).
--
-- Additive and idempotent. Safe to re-run; `deploy/apply-migrations.sh` does,
-- on every deploy, in filename order, while the previous app is still serving.
-- Rollback: `rollback/030-teaching-toggle-and-testers.down.sql`.
-- ===========================================================================
--
-- FOUR THINGS.
--
--   1. `student_testers` — an operator marks a student account as a TEST
--      account from the Student 360, and removes the mark with one click.
--      One row per mark episode: marking inserts a row, removing it STAMPS
--      `unmarked_at`/`unmarked_by` on that row rather than deleting it, so
--      "who made this child a tester, when, and who took it off" survives the
--      removal. At most one open mark per (environment, student) — a partial
--      unique index, the same invariant shape as `idx_sessions_open_one`.
--      A trigger (§4b) makes the removal happen ONCE: `unmarked_at` and
--      `unmarked_by` may go from NULL to a value, and nothing else on the row
--      may change, ever — a removed mark is never reopened, and who made it
--      is never rewritten. It binds every role, the owner included.
--
--      It is a SEPARATE table and not a column on `students`, because
--      `ainext_app` holds table-level UPDATE on `students` (017: a student
--      edits her own profile). A `students.is_tester` column would therefore
--      be writable by the student surface under its own principal — which is
--      precisely what ADR-0021 forbids. Here `ainext_app` holds SELECT and
--      nothing else, RLS-forced to its own principal's rows: the student
--      surface can learn whether SHE is a tester (the resolver needs that)
--      and can never set it, for herself or anybody.
--
--   2. `teaching_settings` — one row per environment holding the console's
--      Socratic-probing position: `off` | `testers` | `everyone`. **No row
--      means off**, the same safe-missing-row rule as `course_availability`
--      (023): the most likely state of this table is "nobody has decided",
--      and that state must be the one that changes nothing. `everyone` is
--      admitted by the CHECK and REFUSED by the server while
--      `PROBING_EVERYONE_UNLOCKED` is false (`app/src/lib/socratic-probing.ts`,
--      issue #53): the lock is one code constant, not a migration, so lifting
--      it is one edit and re-locking it is one edit too.
--
--      `teaching_setting_changes` — every change, from → to, who and when.
--      Append-only by privilege: `ainext_operator` holds SELECT and INSERT and
--      nothing else, the shape `operator_reads` has for the same reason (an
--      audit the audited party can edit is decoration).
--
--   3. `sessions.probing` and `sessions.release_tag` — the SITTING'S
--      SNAPSHOT. Whether probing was on is resolved once, server-side, when
--      a learning session is created (`app/src/lib/sessions.ts`), and stored
--      on that row with the release that served it: the record of how the
--      sitting OPENED. Each later request narrows it by the switch and the
--      student's mark as they stand then (never widens it) — that is code,
--      not a column. Both nullable: every row written before v0.7.0 is NULL,
--      which reads as "not recorded" in the console and as OFF everywhere the
--      product decides anything.
--
--   4. A trigger that refuses any UPDATE changing either snapshot column —
--      for every role, the owner included. "The record of how a sitting
--      opened is never rewritten" is then a property of the table rather
--      than of the code that happens to write it today.
--
-- ---------------------------------------------------------------------------
-- GRANTS AND RLS — why the three tables are not treated alike
-- ---------------------------------------------------------------------------
--   * `teaching_settings` is a fact about the product, not about a student —
--     the shape `course_availability` has: read by both roles, written by the
--     console only, no row-level security. The student surface must READ it
--     (the resolver does, under the student's principal) and must never be
--     able to widen its own teaching.
--   * `teaching_setting_changes` is an operator audit: console SELECT/INSERT,
--     no student grant at all, RLS forced with operator-only policies so a
--     role added later inherits nothing by accident (017's auth_throttle
--     argument).
--   * `student_testers` IS student data — a per-child row — so ENABLE +
--     FORCE row-level security with the 017 `app.student_id` policy shape,
--     copied rather than invented. The console gets SELECT, INSERT and a
--     COLUMN-level UPDATE on the two "removed" columns only: removing a mark
--     is a privilege, rewriting who made it is not one anybody holds.
--
-- Migration 017 opens with `REVOKE ALL ON ALL TABLES ... FROM ainext_app,
-- ainext_operator` on every run, so these grants are stripped by 017 and
-- restored here, in order — 023/028's arrangement. `sessions` needs nothing
-- new: 017's table-level grants cover columns added later.
--
-- ---------------------------------------------------------------------------
-- RE-RUN TAKES NO TABLE LOCK ON A HOT TABLE
-- ---------------------------------------------------------------------------
-- `sessions` is written on every student interaction. `ALTER TABLE ... ADD
-- COLUMN IF NOT EXISTS` takes ACCESS EXCLUSIVE even when the column exists,
-- and `CREATE TRIGGER` takes SHARE ROW EXCLUSIVE, so each is issued only when
-- the catalogue says it is missing (027's rule): the first deploy pays one
-- brief lock per piece, every later deploy pays none. The same guard covers
-- RLS and policies on the two new tables (028's rule), and the partial unique
-- index. GRANT/REVOKE, COMMENT and CREATE OR REPLACE FUNCTION take no lock a
-- reader or writer of these tables waits on, and stay unconditional so a
-- hand-edited privilege converges on the next deploy. Nothing here backfills
-- anything, so nothing here can fail on data.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tester accounts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS student_testers (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  environment text        NOT NULL,
  -- CASCADE: a mark means nothing without its student, and the red-team and
  -- smoke scripts delete test students through `ainext_maint`.
  student_id  bigint      NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  -- Why, in the operator's own words ("Samuel's iPad test account").
  note        text,
  marked_by   bigint      REFERENCES operators(id),
  marked_at   timestamptz NOT NULL DEFAULT now(),
  unmarked_by bigint      REFERENCES operators(id),
  unmarked_at timestamptz,
  CONSTRAINT student_testers_unmark_after_mark
    CHECK (unmarked_at IS NULL OR unmarked_at >= marked_at)
);

COMMENT ON TABLE student_testers IS
  'ADR-0021: student accounts an operator has marked as TEST accounts, which '
  'Socratic probing reaches when the console switch is "Test accounts only". '
  'One row per mark; removal stamps unmarked_at/by and keeps the row. '
  'Student data: RLS forced; ainext_app reads its own row and writes nothing.';

DO $testers$
BEGIN
  IF to_regclass('public.idx_student_testers_open') IS NULL THEN
    CREATE UNIQUE INDEX idx_student_testers_open
      ON student_testers (environment, student_id) WHERE unmarked_at IS NULL;
  END IF;
  IF to_regclass('public.idx_student_testers_student') IS NULL THEN
    CREATE INDEX idx_student_testers_student
      ON student_testers (student_id, marked_at DESC);
  END IF;
END
$testers$;

-- ---------------------------------------------------------------------------
-- 2. The console switch, and its history
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS teaching_settings (
  environment      text        PRIMARY KEY,
  socratic_probing text        NOT NULL DEFAULT 'off'
                   CONSTRAINT teaching_settings_probing_check
                   CHECK (socratic_probing IN ('off','testers','everyone')),
  updated_by       bigint      REFERENCES operators(id),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE teaching_settings IS
  'ADR-0021: the console''s teaching switches, one row per environment. No row '
  'means off. "everyone" is admitted here and refused by the server while '
  'PROBING_EVERYONE_UNLOCKED is false (issue #53). Written by the console as '
  'ainext_operator under the teaching-controls role; read by the session '
  'resolver as ainext_app. Not student data, so no RLS.';

CREATE TABLE IF NOT EXISTS teaching_setting_changes (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  environment text        NOT NULL,
  setting     text        NOT NULL
              CONSTRAINT teaching_setting_changes_setting_check
              CHECK (setting IN ('socratic_probing')),
  -- NULL: there was no row yet, i.e. the default (off) nobody had chosen.
  from_value  text,
  to_value    text        NOT NULL,
  changed_by  bigint      NOT NULL REFERENCES operators(id),
  changed_at  timestamptz NOT NULL DEFAULT now(),
  note        text
);

COMMENT ON TABLE teaching_setting_changes IS
  'ADR-0021: every change to teaching_settings — from, to, who, when. '
  'Append-only by privilege: ainext_operator holds SELECT and INSERT only.';

DO $changes$
BEGIN
  IF to_regclass('public.idx_teaching_setting_changes_env') IS NULL THEN
    CREATE INDEX idx_teaching_setting_changes_env
      ON teaching_setting_changes (environment, changed_at DESC);
  END IF;
END
$changes$;

-- ---------------------------------------------------------------------------
-- 3. The per-sitting snapshot on `sessions` — added only when missing
-- ---------------------------------------------------------------------------

DO $snapshot$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'sessions'
       AND column_name = 'probing'
  ) THEN
    ALTER TABLE sessions ADD COLUMN probing boolean;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'sessions'
       AND column_name = 'release_tag'
  ) THEN
    ALTER TABLE sessions ADD COLUMN release_tag text;
  END IF;

  IF col_description('public.sessions'::regclass,
       (SELECT attnum FROM pg_attribute
         WHERE attrelid = 'public.sessions'::regclass AND attname = 'probing'))
     IS DISTINCT FROM
       'ADR-0021: whether Socratic probing was on when this learning session opened, resolved once and never changed; each request narrows it by the switch and the tester mark as they stand then (option B). NULL = opened before v0.7.0 (read as off).' THEN
    COMMENT ON COLUMN sessions.probing IS
      'ADR-0021: whether Socratic probing was on when this learning session opened, resolved once and never changed; each request narrows it by the switch and the tester mark as they stand then (option B). NULL = opened before v0.7.0 (read as off).';
  END IF;
  IF col_description('public.sessions'::regclass,
       (SELECT attnum FROM pg_attribute
         WHERE attrelid = 'public.sessions'::regclass AND attname = 'release_tag'))
     IS DISTINCT FROM
       'ADR-0021: the deployed release that opened this session (lib/env.ts RELEASE_TAG). NULL = opened before v0.7.0.' THEN
    COMMENT ON COLUMN sessions.release_tag IS
      'ADR-0021: the deployed release that opened this session (lib/env.ts RELEASE_TAG). NULL = opened before v0.7.0.';
  END IF;
END
$snapshot$;

-- ---------------------------------------------------------------------------
-- 4. The snapshot is write-once
-- ---------------------------------------------------------------------------
-- `BEFORE UPDATE OF probing, release_tag`, so it fires only on a statement
-- that names one of the two columns — the per-interaction `last_seen_at`
-- touch and the close never reach it. It applies to every role, the owner
-- included: nothing legitimate ever rewrites a lesson's snapshot, and the
-- rollback drops the trigger before it drops the columns.

CREATE OR REPLACE FUNCTION sessions_snapshot_is_fixed() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.probing IS DISTINCT FROM OLD.probing
     OR NEW.release_tag IS DISTINCT FROM OLD.release_tag THEN
    RAISE EXCEPTION
      'session %: probing and release_tag are fixed when a learning session opens (ADR-0021)',
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

DO $trigger$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.sessions'::regclass
       AND tgname = 'sessions_snapshot_is_fixed'
       AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER sessions_snapshot_is_fixed
      BEFORE UPDATE OF probing, release_tag ON sessions
      FOR EACH ROW EXECUTE FUNCTION sessions_snapshot_is_fixed();
  END IF;
END
$trigger$;

-- ---------------------------------------------------------------------------
-- 4b. A tester mark is closed once, and never reopened or rewritten
-- ---------------------------------------------------------------------------
-- The column grant below (UPDATE on `unmarked_by`, `unmarked_at` only) already
-- stops the console rewriting who made a mark. It does not stop it reopening
-- one (`SET unmarked_at = NULL`) or rewriting who removed it and when — and it
-- binds `ainext_operator` alone. This binds every role, the owner included:
-- the only UPDATE a row ever takes is its one removal, NULL → a value for
-- `unmarked_at` (with `unmarked_by`, or without it for a removal made outside
-- the console). Marking a student again is a NEW row, which is what keeps the
-- history of episodes honest. BEFORE UPDATE with no column list, so a
-- statement naming any column is checked. The rollback drops the table, and
-- the trigger with it, and then the function.

CREATE OR REPLACE FUNCTION student_testers_close_once() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.id          IS DISTINCT FROM OLD.id
     OR NEW.environment IS DISTINCT FROM OLD.environment
     OR NEW.student_id  IS DISTINCT FROM OLD.student_id
     OR NEW.note        IS DISTINCT FROM OLD.note
     OR NEW.marked_by   IS DISTINCT FROM OLD.marked_by
     OR NEW.marked_at   IS DISTINCT FROM OLD.marked_at THEN
    RAISE EXCEPTION
      'student_testers %: only unmarked_at/unmarked_by may change, once (ADR-0021)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.unmarked_at IS NOT NULL OR OLD.unmarked_by IS NOT NULL THEN
    IF NEW.unmarked_at IS DISTINCT FROM OLD.unmarked_at
       OR NEW.unmarked_by IS DISTINCT FROM OLD.unmarked_by THEN
      RAISE EXCEPTION
        'student_testers %: a removed mark stays removed — mark the student again instead (ADR-0021)',
        OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.unmarked_by IS NOT NULL AND NEW.unmarked_at IS NULL THEN
    RAISE EXCEPTION
      'student_testers %: unmarked_by is stamped together with unmarked_at (ADR-0021)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

DO $close_once$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.student_testers'::regclass
       AND tgname = 'student_testers_close_once'
       AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER student_testers_close_once
      BEFORE UPDATE ON student_testers
      FOR EACH ROW EXECUTE FUNCTION student_testers_close_once();
  END IF;
END
$close_once$;

-- ---------------------------------------------------------------------------
-- 5. Grants — start from nothing on these three tables (017's rule)
-- ---------------------------------------------------------------------------

REVOKE ALL ON student_testers, teaching_settings, teaching_setting_changes
  FROM ainext_app, ainext_operator;

-- The switch: the student surface reads it; only the console writes it.
GRANT SELECT                 ON teaching_settings TO ainext_app;
GRANT SELECT, INSERT, UPDATE ON teaching_settings TO ainext_operator;
GRANT ALL PRIVILEGES         ON teaching_settings TO ainext_maint;

-- The history: the console reads and appends. Nobody edits it.
GRANT SELECT, INSERT   ON teaching_setting_changes TO ainext_operator;
GRANT ALL PRIVILEGES   ON teaching_setting_changes TO ainext_maint;

-- The tester mark: the student surface reads ITS OWN (RLS below) and writes
-- nothing. The console marks, and removes by stamping the two "removed"
-- columns — column-level, so who marked and when cannot be rewritten.
GRANT SELECT                            ON student_testers TO ainext_app;
GRANT SELECT, INSERT                    ON student_testers TO ainext_operator;
GRANT UPDATE (unmarked_by, unmarked_at) ON student_testers TO ainext_operator;
GRANT ALL PRIVILEGES                    ON student_testers TO ainext_maint;

-- ---------------------------------------------------------------------------
-- 6. Row-level security, guarded so a re-run locks nothing (028's pattern)
-- ---------------------------------------------------------------------------

DO $rls$
DECLARE
  principal text := '(student_id = (NULLIF(current_setting(''app.student_id''::text, true), ''''::text))::bigint)';
  have_qual text;
  have_check text;
  have_roles name[];
  have_cmd text;
BEGIN
  -- --- student_testers ----------------------------------------------------
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.student_testers'::regclass) THEN
    ALTER TABLE student_testers ENABLE ROW LEVEL SECURITY;
  END IF;
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.student_testers'::regclass) THEN
    ALTER TABLE student_testers FORCE ROW LEVEL SECURITY;
  END IF;

  SELECT qual, with_check, roles, cmd INTO have_qual, have_check, have_roles, have_cmd
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'student_testers'
     AND policyname = 'student_testers_app';
  IF NOT FOUND
     OR have_cmd IS DISTINCT FROM 'SELECT'
     OR have_roles IS DISTINCT FROM ARRAY['ainext_app']::name[]
     OR have_qual IS DISTINCT FROM principal THEN
    DROP POLICY IF EXISTS student_testers_app ON student_testers;
    -- SELECT only: the policy is the second lock on a door the GRANT above
    -- already shut. With no principal it matches nothing (fail-closed).
    CREATE POLICY student_testers_app ON student_testers FOR SELECT TO ainext_app
      USING (student_id = nullif(current_setting('app.student_id', true), '')::bigint);
  END IF;

  SELECT qual, with_check, roles, cmd INTO have_qual, have_check, have_roles, have_cmd
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'student_testers'
     AND policyname = 'student_testers_operator';
  IF NOT FOUND
     OR have_cmd IS DISTINCT FROM 'ALL'
     OR have_roles IS DISTINCT FROM ARRAY['ainext_operator']::name[]
     OR have_qual IS DISTINCT FROM 'true'
     OR have_check IS DISTINCT FROM 'true' THEN
    DROP POLICY IF EXISTS student_testers_operator ON student_testers;
    -- Cross-student, as every console read of student data is; narrowed by
    -- the grants above (no DELETE, UPDATE on two columns).
    CREATE POLICY student_testers_operator ON student_testers FOR ALL TO ainext_operator
      USING (true) WITH CHECK (true);
  END IF;

  -- --- teaching_setting_changes -------------------------------------------
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.teaching_setting_changes'::regclass) THEN
    ALTER TABLE teaching_setting_changes ENABLE ROW LEVEL SECURITY;
  END IF;
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.teaching_setting_changes'::regclass) THEN
    ALTER TABLE teaching_setting_changes FORCE ROW LEVEL SECURITY;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'teaching_setting_changes'
                    AND policyname = 'teaching_setting_changes_operator_select'
                    AND cmd = 'SELECT' AND roles = ARRAY['ainext_operator']::name[]
                    AND qual = 'true') THEN
    DROP POLICY IF EXISTS teaching_setting_changes_operator_select ON teaching_setting_changes;
    CREATE POLICY teaching_setting_changes_operator_select ON teaching_setting_changes
      FOR SELECT TO ainext_operator USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'teaching_setting_changes'
                    AND policyname = 'teaching_setting_changes_operator_insert'
                    AND cmd = 'INSERT' AND roles = ARRAY['ainext_operator']::name[]
                    AND with_check = 'true') THEN
    DROP POLICY IF EXISTS teaching_setting_changes_operator_insert ON teaching_setting_changes;
    CREATE POLICY teaching_setting_changes_operator_insert ON teaching_setting_changes
      FOR INSERT TO ainext_operator WITH CHECK (true);
  END IF;
END
$rls$;

-- ---------------------------------------------------------------------------
-- 7. Verification — asserted, not assumed
-- ---------------------------------------------------------------------------

DO $verify$
BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'public.student_testers'::regclass) THEN
    RAISE EXCEPTION 'student_testers needs ENABLE *and* FORCE row level security (ADR-0012)';
  END IF;
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'public.teaching_setting_changes'::regclass) THEN
    RAISE EXCEPTION 'teaching_setting_changes needs ENABLE *and* FORCE row level security';
  END IF;

  -- The resolver has to be able to answer, or every session resolves OFF
  -- silently (it fails closed — lib/sessions.ts — which hides the fault).
  IF NOT has_table_privilege('ainext_app', 'teaching_settings', 'SELECT')
     OR NOT has_table_privilege('ainext_app', 'student_testers', 'SELECT') THEN
    RAISE EXCEPTION 'ainext_app cannot read the probing inputs — every lesson would resolve off';
  END IF;

  -- THE ONE THIS FILE EXISTS FOR: the student surface cannot make itself a
  -- tester, nor move the switch, nor touch the record of either.
  IF has_table_privilege('ainext_app', 'student_testers', 'INSERT')
     OR has_table_privilege('ainext_app', 'student_testers', 'UPDATE')
     OR has_table_privilege('ainext_app', 'student_testers', 'DELETE')
     OR has_any_column_privilege('ainext_app', 'student_testers', 'UPDATE') THEN
    RAISE EXCEPTION 'ainext_app can write student_testers — a student could mark herself a tester';
  END IF;
  IF has_table_privilege('ainext_app', 'teaching_settings', 'INSERT')
     OR has_table_privilege('ainext_app', 'teaching_settings', 'UPDATE')
     OR has_table_privilege('ainext_app', 'teaching_settings', 'DELETE') THEN
    RAISE EXCEPTION 'ainext_app can write teaching_settings — the student surface could switch probing on';
  END IF;
  IF has_table_privilege('ainext_app', 'teaching_setting_changes', 'SELECT')
     OR has_table_privilege('ainext_app', 'teaching_setting_changes', 'INSERT') THEN
    RAISE EXCEPTION 'ainext_app holds a privilege on teaching_setting_changes — it has none';
  END IF;

  -- The console can do its job and no more.
  IF NOT has_table_privilege('ainext_operator', 'teaching_settings', 'UPDATE')
     OR NOT has_table_privilege('ainext_operator', 'teaching_setting_changes', 'INSERT')
     OR NOT has_table_privilege('ainext_operator', 'student_testers', 'INSERT')
     OR NOT has_column_privilege('ainext_operator', 'student_testers', 'unmarked_at', 'UPDATE') THEN
    RAISE EXCEPTION 'the console cannot set the switch or mark a tester';
  END IF;
  IF has_table_privilege('ainext_operator', 'teaching_setting_changes', 'UPDATE')
     OR has_table_privilege('ainext_operator', 'teaching_setting_changes', 'DELETE') THEN
    RAISE EXCEPTION 'ainext_operator can edit the teaching-switch history — an audit its author can edit is decoration';
  END IF;
  IF has_table_privilege('ainext_operator', 'student_testers', 'DELETE')
     OR has_column_privilege('ainext_operator', 'student_testers', 'marked_by', 'UPDATE')
     OR has_column_privilege('ainext_operator', 'student_testers', 'marked_at', 'UPDATE') THEN
    RAISE EXCEPTION 'ainext_operator can delete a tester mark or rewrite who made it';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.sessions'::regclass
                    AND tgname = 'sessions_snapshot_is_fixed' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'sessions_snapshot_is_fixed is missing — a lesson''s snapshot could be rewritten';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.student_testers'::regclass
                    AND tgname = 'student_testers_close_once' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'student_testers_close_once is missing — a removed tester mark could be reopened';
  END IF;

  RAISE NOTICE 'teaching toggle: ready — probing % in % environment(s), % open tester mark(s)',
    coalesce((SELECT string_agg(environment || '=' || socratic_probing, ', ' ORDER BY environment)
                FROM teaching_settings), 'off (no row)'),
    (SELECT count(*) FROM teaching_settings),
    (SELECT count(*) FROM student_testers WHERE unmarked_at IS NULL);
END
$verify$;

COMMIT;
