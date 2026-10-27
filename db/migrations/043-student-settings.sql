-- ===========================================================================
-- 043 — the student's own settings: name, grade, curriculum, and deleting
-- the account (FR-2013, FR-2310, FR-4010 as amended 2026-10-27)
--
-- Additive and idempotent. Safe to re-run; `scripts/local-dev.sh` does, and
-- `deploy/apply-migrations.sh` does on every deploy, in filename order.
-- Rollback: `rollback/043-student-settings.down.sql`.
-- ===========================================================================
--
-- THE PRODUCT OWNER'S CALLS (Tamer, 2026-10-27), which this file encodes:
--
--  · A student may change her own name and grade (FR-2013, never built
--    before this) and her own curriculum (FR-4010, amended: decision 4's
--    "only the console" is lifted).
--  · Changing a curriculum keeps progress per course, exactly as an operator
--    change always has (FR-4011): nothing is deleted, copied or merged, and
--    a curriculum with no progress yet starts fresh.
--  · Deleting the account is FR-2310's working default: immediate, and the
--    account goes with its interaction record.
--
-- WHY FUNCTIONS AND NOT COLUMN GRANTS
-- Migration 033 narrowed `ainext_app`'s UPDATE on `students` to one column
-- (design_variant) and asserts it, and `curriculum-privilege.test.mts` scans
-- the student surface for any other `UPDATE students`. Both stay true. Every
-- new student write goes through a SECURITY DEFINER function owned by
-- `ainext_maint` (BYPASSRLS, not a superuser), as 033's
-- `complete_student_onboarding` does, so each one is its own guard:
--
--  · it acts ONLY on `app.student_id` — the principal `withPrincipal` sets —
--    and a missing principal raises;
--  · search_path is pinned to pg_catalog and every table is schema-qualified,
--    so a caller cannot shadow `students`;
--  · a curriculum change is written to `student_curriculum_changes` in the
--    same statement list as the change itself (FR-4012), so the student
--    cannot change one without the other.
--
-- WHAT DELETION REMOVES, AND WHAT IT KEEPS
-- Removed, in dependency order: every row that is the student's interaction
-- record or progress (tutor turns, attempts and their explanation log,
-- mastery, understanding checks, uploads, homework, feedback, safety flags,
-- saved lesson places, progress, course exceptions, tester marks, guardian
-- record, curriculum history, sittings), then the student, then the account
-- (whose sign-ins, verification tokens and reset tokens cascade).
-- Kept, cut loose from the person:
--  · `analytics_events` — student_id and session_ref set NULL. The event
--    stream carries no content (contracts/analytics.md), and deleting it would
--    rewrite every metric already reported for the environment.
--  · `cost_daily` — a number per day with no foreign key and no name; spend
--    already incurred stays accounted for (constitution VI).
--  · `operator_reads` — MUST survive deletion (FR-2306).
--  · `auth_events` — the security record; subject_id is a bare number.
-- The function returns the uploaded files' storage paths so the caller can
-- remove them from disk after the transaction commits.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The history learns a third author: the student herself
-- ---------------------------------------------------------------------------
-- `changed_by` stays NULL for her (it names an operator); `reason = 'student'`
-- is what says who made it. The operator-named check is unchanged.

ALTER TABLE student_curriculum_changes
  DROP CONSTRAINT IF EXISTS student_curriculum_changes_reason_check;
ALTER TABLE student_curriculum_changes
  ADD CONSTRAINT student_curriculum_changes_reason_check
  CHECK (reason IN ('operator', 'grade_change_reresolved', 'student'));

ALTER TABLE student_curriculum_changes
  DROP CONSTRAINT IF EXISTS student_curriculum_changes_student_unnamed;
ALTER TABLE student_curriculum_changes
  ADD CONSTRAINT student_curriculum_changes_student_unnamed
  CHECK (reason <> 'student' OR changed_by IS NULL);

-- ---------------------------------------------------------------------------
-- 2. Name and grade (FR-2013), with FR-4008's re-resolution
-- ---------------------------------------------------------------------------
-- The application decides what FR-4008 asks for (`resolveOnGradeChange`, which
-- needs the live course rules) and passes the re-resolved curriculum, or NULL
-- for none. The function refuses to re-resolve a CHOSEN curriculum: a chosen
-- one never moves on a grade change.

CREATE OR REPLACE FUNCTION update_own_profile(
  p_display_name text,
  p_grade text,
  p_reresolve_to text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  acting bigint := nullif(current_setting('app.student_id', true), '')::bigint;
  cur record;
BEGIN
  IF acting IS NULL THEN
    RAISE EXCEPTION 'update_own_profile: no student principal'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_display_name IS NULL OR length(btrim(p_display_name)) = 0
     OR p_grade IS NULL OR length(btrim(p_grade)) = 0 THEN
    RAISE EXCEPTION 'update_own_profile: name and grade are required'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT curriculum_system, curriculum_source, environment
    INTO cur
    FROM public.students
   WHERE id = acting
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'update_own_profile: no such student'
      USING ERRCODE = 'no_data_found';
  END IF;

  UPDATE public.students
     SET display_name = btrim(p_display_name),
         grade        = p_grade
   WHERE id = acting;

  IF p_reresolve_to IS NOT NULL AND p_reresolve_to <> cur.curriculum_system THEN
    IF cur.curriculum_source <> 'implied' THEN
      RAISE EXCEPTION 'update_own_profile: a chosen curriculum is never re-resolved (FR-4008)'
        USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO public.student_curriculum_changes
      (environment, student_id, from_curriculum, to_curriculum, to_source,
       changed_by, reason, note)
    VALUES (cur.environment, acting, cur.curriculum_system, p_reresolve_to, 'implied',
            NULL, 'grade_change_reresolved', NULL);
    UPDATE public.students
       SET curriculum_system = p_reresolve_to
     WHERE id = acting;
  END IF;
END
$fn$;

ALTER FUNCTION update_own_profile(text, text, text) OWNER TO ainext_maint;
REVOKE ALL ON FUNCTION update_own_profile(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION update_own_profile(text, text, text) FROM ainext_operator;
GRANT EXECUTE ON FUNCTION update_own_profile(text, text, text) TO ainext_app;

COMMENT ON FUNCTION update_own_profile(text, text, text) IS
  '043 (FR-2013, FR-4008): the acting student sets her own name and grade; an '
  'implied curriculum the application re-resolved is recorded and moved in the '
  'same call. A chosen curriculum is never re-resolved.';

-- ---------------------------------------------------------------------------
-- 3. The curriculum (FR-4010 as amended, FR-4011, FR-4012)
-- ---------------------------------------------------------------------------
-- Validated against the registry by the application (`lib/curricula.ts` is the
-- only list). Setting the curriculum she already has records nothing and
-- returns false. Progress is never touched: it belongs to the course.

CREATE OR REPLACE FUNCTION change_own_curriculum(p_to text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  acting bigint := nullif(current_setting('app.student_id', true), '')::bigint;
  cur record;
BEGIN
  IF acting IS NULL THEN
    RAISE EXCEPTION 'change_own_curriculum: no student principal'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_to IS NULL OR length(btrim(p_to)) = 0 THEN
    RAISE EXCEPTION 'change_own_curriculum: a curriculum is required'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT curriculum_system, environment
    INTO cur
    FROM public.students
   WHERE id = acting
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'change_own_curriculum: no such student'
      USING ERRCODE = 'no_data_found';
  END IF;
  IF cur.curriculum_system = p_to THEN
    -- Re-choosing the curriculum she already has makes it chosen if it was
    -- only implied, which is a change of how it was set, not of what it is.
    UPDATE public.students SET curriculum_source = 'chosen' WHERE id = acting;
    RETURN false;
  END IF;

  INSERT INTO public.student_curriculum_changes
    (environment, student_id, from_curriculum, to_curriculum, to_source,
     changed_by, reason, note)
  VALUES (cur.environment, acting, cur.curriculum_system, p_to, 'chosen',
          NULL, 'student', NULL);
  UPDATE public.students
     SET curriculum_system = p_to,
         curriculum_source = 'chosen'
   WHERE id = acting;
  RETURN true;
END
$fn$;

ALTER FUNCTION change_own_curriculum(text) OWNER TO ainext_maint;
REVOKE ALL ON FUNCTION change_own_curriculum(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION change_own_curriculum(text) FROM ainext_operator;
GRANT EXECUTE ON FUNCTION change_own_curriculum(text) TO ainext_app;

COMMENT ON FUNCTION change_own_curriculum(text) IS
  '043 (FR-4010 amended 2026-10-27, FR-4011, FR-4012): the acting student '
  'chooses her own curriculum; the change is recorded with reason student. '
  'Progress stays with the course it was earned in.';

-- ---------------------------------------------------------------------------
-- 4. Deleting the account (FR-2310's working default)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION delete_own_account()
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  acting bigint := nullif(current_setting('app.student_id', true), '')::bigint;
  acct bigint;
  files text[];
BEGIN
  IF acting IS NULL THEN
    RAISE EXCEPTION 'delete_own_account: no student principal'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT account_id INTO acct FROM public.students WHERE id = acting FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'delete_own_account: no such student'
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT coalesce(array_agg(storage_path) FILTER (WHERE storage_path IS NOT NULL), '{}')
    INTO files
    FROM public.uploads
   WHERE student_id = acting;

  -- Kept, cut loose from the person.
  UPDATE public.analytics_events
     SET student_id = NULL, session_ref = NULL
   WHERE student_id = acting
      OR session_ref IN (SELECT id FROM public.sessions WHERE student_id = acting);

  -- The interaction record and progress, children first.
  DELETE FROM public.explanation_log
   WHERE attempt_id IN (SELECT id FROM public.attempts WHERE student_id = acting);
  DELETE FROM public.homework_asks        WHERE student_id = acting;  -- items, flags cascade
  DELETE FROM public.homework_items       WHERE student_id = acting;
  DELETE FROM public.homework_flags       WHERE student_id = acting;
  DELETE FROM public.feedback             WHERE student_id = acting;
  DELETE FROM public.ai_interactions      WHERE student_id = acting;
  DELETE FROM public.understanding_checks WHERE student_id = acting;
  DELETE FROM public.attempts             WHERE student_id = acting;
  DELETE FROM public.mastery              WHERE student_id = acting;
  DELETE FROM public.safety_flags         WHERE student_id = acting;
  DELETE FROM public.uploads              WHERE student_id = acting;
  DELETE FROM public.student_course_access WHERE student_id = acting;
  DELETE FROM public.student_progress     WHERE student_id = acting;
  DELETE FROM public.lesson_saves         WHERE student_id = acting;
  DELETE FROM public.student_testers      WHERE student_id = acting;
  DELETE FROM public.guardians            WHERE student_id = acting;
  DELETE FROM public.student_curriculum_changes WHERE student_id = acting;
  DELETE FROM public.sessions             WHERE student_id = acting;

  DELETE FROM public.students WHERE id = acting;
  -- auth_sessions, verification_tokens and password_resets cascade.
  IF acct IS NOT NULL THEN
    DELETE FROM public.accounts WHERE id = acct;
  END IF;

  RETURN files;
END
$fn$;

ALTER FUNCTION delete_own_account() OWNER TO ainext_maint;
REVOKE ALL ON FUNCTION delete_own_account() FROM PUBLIC;
REVOKE ALL ON FUNCTION delete_own_account() FROM ainext_operator;
GRANT EXECUTE ON FUNCTION delete_own_account() TO ainext_app;

COMMENT ON FUNCTION delete_own_account() IS
  '043 (FR-2310): the acting student deletes her account and its interaction '
  'record. Analytics events and cost rows are kept with the student removed; '
  'operator_reads and auth_events are kept (FR-2306). Returns upload paths.';

-- ---------------------------------------------------------------------------
-- 5. Verification — asserted, not assumed
-- ---------------------------------------------------------------------------

DO $verify$
DECLARE
  fn text;
  uncovered text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'update_own_profile(text,text,text)',
    'change_own_curriculum(text)',
    'delete_own_account()'
  ] LOOP
    IF NOT has_function_privilege('ainext_app', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'ainext_app cannot run % — the settings page cannot save', fn;
    END IF;
    IF has_function_privilege('ainext_operator', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'ainext_operator can run % — it is the student''s own action', fn;
    END IF;
    IF (SELECT r.rolname FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
         WHERE p.oid = ('public.' || fn)::regprocedure) IS DISTINCT FROM 'ainext_maint'
       OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = ('public.' || fn)::regprocedure) THEN
      RAISE EXCEPTION '% must be SECURITY DEFINER and owned by ainext_maint', fn;
    END IF;
  END LOOP;

  -- 033's promise still holds: no new column grant on students.
  IF has_column_privilege('ainext_app', 'students', 'curriculum_system', 'UPDATE')
     OR has_column_privilege('ainext_app', 'students', 'display_name', 'UPDATE')
     OR has_column_privilege('ainext_app', 'students', 'grade', 'UPDATE') THEN
    RAISE EXCEPTION 'ainext_app can UPDATE a students column directly — only the functions may';
  END IF;

  -- A table that points at students and that delete_own_account does not
  -- clear would make every deletion fail. Name it here, at deploy, instead.
  SELECT string_agg(c.conrelid::regclass::text, ', ')
    INTO uncovered
    FROM pg_constraint c
   WHERE c.contype = 'f'
     AND c.confrelid = 'public.students'::regclass
     AND c.conrelid::regclass::text NOT IN (
       'analytics_events', 'explanation_log', 'homework_asks', 'homework_items',
       'homework_flags', 'feedback', 'ai_interactions', 'understanding_checks',
       'attempts', 'mastery', 'safety_flags', 'uploads', 'student_course_access',
       'student_progress', 'lesson_saves', 'student_testers', 'guardians',
       'student_curriculum_changes', 'sessions');
  IF uncovered IS NOT NULL THEN
    RAISE EXCEPTION 'delete_own_account does not clear: % — add it to the function and this list', uncovered;
  END IF;

  RAISE NOTICE 'student settings: ready';
END
$verify$;

COMMIT;
