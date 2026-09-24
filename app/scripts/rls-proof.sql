-- The isolation proof (ADR-0012, quickstart.md "Prove RLS", SC-102).
--
--   psql "$DATABASE_URL" -f app/scripts/rls-proof.sql
--
-- **It must be run as `ainext_app`.** Your own account is a Postgres superuser,
-- and superusers bypass row-level security unconditionally, so this file run as
-- $(whoami) proves the opposite of what it claims. The first block refuses to
-- continue if the connected role could bypass a policy — a proof that cannot
-- fail is not a proof.
--
-- Three questions, in the order that matters:
--
--   1. With NO principal, what does an unscoped read return?   → must be 0
--   2. With a principal, does that student see their own work? → their count
--   3. With a DIFFERENT principal, does the answer change?     → their count
--
-- The first is the whole decision. A test that passes because the WHERE clause
-- was present proves nothing about RLS; this one deliberately omits it.

\set ON_ERROR_STOP on
\timing off

\echo ''
\echo '=== 0. Who is connected (this must not be a superuser) ==================='

SELECT current_user AS role,
       rolsuper     AS is_superuser,
       rolbypassrls AS bypasses_rls
  FROM pg_roles WHERE rolname = current_user;

DO $guard$
DECLARE r RECORD;
BEGIN
  SELECT rolsuper, rolbypassrls INTO r FROM pg_roles WHERE rolname = current_user;
  IF r.rolsuper OR r.rolbypassrls THEN
    RAISE EXCEPTION
      'connected as %, which bypasses row-level security. Reconnect as '
      'ainext_app: psql "postgres://ainext_app@127.0.0.1:5432/ainext_mvp1"',
      current_user;
  END IF;
END
$guard$;

\echo ''
\echo '=== 1. No principal: every student-scoped table must answer 0 ============'

SELECT 'attempts'             AS table_name, count(*) AS rows_visible FROM attempts
UNION ALL SELECT 'ai_interactions',      count(*) FROM ai_interactions
UNION ALL SELECT 'uploads',              count(*) FROM uploads
UNION ALL SELECT 'understanding_checks', count(*) FROM understanding_checks
UNION ALL SELECT 'mastery',              count(*) FROM mastery
UNION ALL SELECT 'sessions',             count(*) FROM sessions
UNION ALL SELECT 'analytics_events',     count(*) FROM analytics_events
UNION ALL SELECT 'explanation_log',      count(*) FROM explanation_log
UNION ALL SELECT 'student_progress',     count(*) FROM student_progress
UNION ALL SELECT 'student_testers',      count(*) FROM student_testers
ORDER BY 1;

\echo ''
\echo '--- the deliberately unscoped read (FR-2104: this is what /pipeline did) --'

SELECT id, student_id, surface, left(user_message, 40) AS user_message
  FROM ai_interactions
 ORDER BY created_at DESC
 LIMIT 5;

DO $unscoped$
DECLARE n BIGINT;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM attempts
    UNION ALL SELECT 1 FROM ai_interactions
    UNION ALL SELECT 1 FROM uploads
    UNION ALL SELECT 1 FROM understanding_checks
    UNION ALL SELECT 1 FROM mastery
    UNION ALL SELECT 1 FROM student_progress
    UNION ALL SELECT 1 FROM student_testers
  ) s;
  IF n <> 0 THEN
    RAISE EXCEPTION 'PROOF FAILED: % row(s) visible with no principal set', n;
  END IF;
  RAISE NOTICE 'no principal, no rows — fail-closed (FR-2101)';
END
$unscoped$;

\echo ''
\echo '=== 2. With a principal: student 1 sees student 1 ========================'

BEGIN;
SELECT set_config('app.student_id', '1', true) AS principal;
SELECT 'attempts' AS table_name, count(*) AS rows_visible FROM attempts
UNION ALL SELECT 'ai_interactions', count(*) FROM ai_interactions
UNION ALL SELECT 'sessions',        count(*) FROM sessions
ORDER BY 1;
SELECT id, display_name, grade, status FROM students;
ROLLBACK;

\echo ''
\echo '=== 3. A different principal is a different answer ======================='

BEGIN;
SELECT set_config('app.student_id', '2', true) AS principal;
SELECT 'attempts' AS table_name, count(*) AS rows_visible FROM attempts
UNION ALL SELECT 'ai_interactions', count(*) FROM ai_interactions
UNION ALL SELECT 'sessions',        count(*) FROM sessions
ORDER BY 1;
ROLLBACK;

\echo ''
\echo '=== 4. The principal does not survive the transaction ===================='
-- SET LOCAL reverts on COMMIT/ROLLBACK. If this returned rows, a pooled
-- connection would be carrying one student''s principal into the next
-- student''s query.

SELECT count(*) AS rows_visible_after_rollback FROM attempts;

\echo ''
\echo '=== 5. What this role must not be able to reach =========================='
-- Expected: "permission denied" on each. Run them by hand; they are listed
-- rather than executed because ON_ERROR_STOP would end the script.
\echo '  SELECT * FROM operators;        -- no grant at all to ainext_app'
\echo '  SELECT * FROM auth_events;      -- INSERT only: written, never read back'
\echo '  SELECT * FROM safety_flags;     -- INSERT only: a student never reads their own flags'
\echo '  DELETE FROM attempts;           -- append-only by privilege, not by convention'
\echo ''

\echo '=== 6. The student surface cannot change how it is taught (ADR-0021) ======'
-- Executed, not listed: each refusal is caught and asserted, and a write that
-- SUCCEEDS fails the proof. Under student 1's own principal, which is the
-- strongest position ainext_app is ever in.
--
--   · a tester mark is written by an operator and never by ainext_app — not
--     for herself, not for anybody (migration 030 grants SELECT only);
--   · the console switch cannot be moved from the student surface;
--   · the switch's history is not even readable;
--   · a learning session's probing snapshot cannot be rewritten once it is
--     open — by the trigger, which refuses this for every role.

BEGIN;
SELECT set_config('app.student_id', '1', true) AS principal;

DO $teaching$
DECLARE n bigint;
BEGIN
  -- She can READ whether she is a tester (the resolver needs to) …
  SELECT count(*) INTO n FROM student_testers;
  RAISE NOTICE 'student_testers readable under her own principal: % row(s)', n;

  -- … and cannot write one, in any form.
  BEGIN
    INSERT INTO student_testers (environment, student_id) VALUES ('mvp1', 1);
    RAISE EXCEPTION 'PROOF FAILED: ainext_app marked itself a tester';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'refused: INSERT INTO student_testers (her own mark)';
  END;
  BEGIN
    UPDATE student_testers SET unmarked_at = now() WHERE student_id = 1;
    RAISE EXCEPTION 'PROOF FAILED: ainext_app updated a tester mark';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'refused: UPDATE student_testers';
  END;
  BEGIN
    DELETE FROM student_testers WHERE student_id = 1;
    RAISE EXCEPTION 'PROOF FAILED: ainext_app deleted a tester mark';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'refused: DELETE FROM student_testers';
  END;

  -- There is no tester column on students for the profile UPDATE to reach.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'students' AND column_name ILIKE '%tester%') THEN
    RAISE EXCEPTION 'PROOF FAILED: a tester column on students is writable by ainext_app';
  END IF;

  -- The switch.
  BEGIN
    INSERT INTO teaching_settings (environment, socratic_probing) VALUES ('mvp1', 'everyone');
    RAISE EXCEPTION 'PROOF FAILED: ainext_app wrote the teaching switch';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'refused: INSERT INTO teaching_settings';
  END;
  BEGIN
    UPDATE teaching_settings SET socratic_probing = 'everyone';
    RAISE EXCEPTION 'PROOF FAILED: ainext_app moved the teaching switch';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'refused: UPDATE teaching_settings';
  END;
  BEGIN
    SELECT count(*) INTO n FROM teaching_setting_changes;
    RAISE EXCEPTION 'PROOF FAILED: ainext_app read the switch history';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'refused: SELECT FROM teaching_setting_changes';
  END;

  -- The snapshot on her own open-or-closed session.
  BEGIN
    UPDATE sessions SET probing = NOT coalesce(probing, false)
     WHERE id = (SELECT id FROM sessions ORDER BY id DESC LIMIT 1);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN
      RAISE NOTICE 'skipped: student 1 has no session to try the snapshot trigger on';
    ELSE
      RAISE EXCEPTION 'PROOF FAILED: ainext_app rewrote a session''s probing snapshot';
    END IF;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'refused: UPDATE sessions SET probing (the snapshot is fixed at open)';
  END;
  BEGIN
    UPDATE sessions SET release_tag = 'forged'
     WHERE id = (SELECT id FROM sessions ORDER BY id DESC LIMIT 1);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN
      RAISE NOTICE 'skipped: student 1 has no session to try the release trigger on';
    ELSE
      RAISE EXCEPTION 'PROOF FAILED: ainext_app rewrote a session''s release tag';
    END IF;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'refused: UPDATE sessions SET release_tag';
  END;

  RAISE NOTICE 'teaching controls: the student surface can read its own mark and change nothing';
END
$teaching$;
ROLLBACK;
\echo ''
