-- ADR-0012: per-student isolation is enforced by the DATABASE, not by whoever
-- remembered the WHERE clause. data-model.md §14 is the matrix this file
-- implements; plan A3 and research R6 are the mechanics.
--
-- ============================================================================
-- THE GOTCHA THAT DECIDES WHETHER ANY OF THIS IS REAL
-- ============================================================================
-- Superusers and BYPASSRLS roles bypass every policy unconditionally, and the
-- table owner bypasses them too unless FORCE ROW LEVEL SECURITY is set. Today
-- the app connects as `ainext` (the POSTGRES_USER, a superuser) on the box and
-- as $(whoami) locally — both superusers. So three things are load-bearing
-- TOGETHER, and shipping two of the three is worse than shipping none, because
-- the result looks protected and refuses nothing:
--
--   1. this file creates `ainext_app`, a non-superuser, non-owner role;
--   2. it ENABLEs and FORCEs row-level security on every table below;
--   3. DATABASE_URL is repointed at `ainext_app` — in scripts/local-dev.sh, in
--      deploy/docker-compose.local.yml and in deploy/docker-compose.mvp1.yml.
--
-- Until (3) lands the policies here are inert. The isolation proof
-- (app/scripts/rls-proof.sql) therefore runs AS `ainext_app`: run as the owner
-- or as a superuser it proves the opposite of what it claims.
--
-- ============================================================================
-- THE PRINCIPAL
-- ============================================================================
--   nullif(current_setting('app.student_id', true), '')::bigint
--
-- The `true` makes an unset setting return NULL instead of raising; the nullif
-- handles the empty string a reset leaves behind, which would otherwise fail
-- the cast. `student_id = NULL` is NULL, not true, so NO PRINCIPAL MEANS NO
-- ROWS — fail-closed by construction rather than by a default somebody chose.
-- It is set with SET LOCAL (set_config(..., true)) inside the transaction that
-- does the work, never session-level: a pooled connection outlives the request
-- that borrowed it, and a session-level setting is how one student's principal
-- survives into the next student's query (app/src/lib/db.ts).
--
-- ============================================================================
-- THE THREE ROLES
-- ============================================================================
--   ainext_app       the student surfaces. Policies apply. Not the owner.
--   ainext_operator  the console. The enumerated cross-student reads, and
--                    INSERT-only on operator_reads.
--   ainext_maint     BYPASSRLS. Loaders, parity_check.py, rollups, backfills,
--                    the bootstrap scripts. NEVER handed to the app.
--
-- Roles are cluster-wide, so CREATE ROLE cannot be wrapped in IF NOT EXISTS
-- (Postgres has no such form) — hence the DO block. **No passwords are set
-- here.** A migration that set one would write a known credential into git.
-- Local dev passwords are set by scripts/local-dev.sh (dev-only, equal to the
-- role name); the box's are an ALTER ROLE step in the deploy runbook, fed from
-- deploy/.env (see deploy/.env.example).
--
-- ============================================================================
-- TWO PLACES WHERE A PRINCIPAL CANNOT EXIST YET, AND WHAT GUARDS THEM INSTEAD
-- ============================================================================
-- Sign-in, signup, verification and refresh all run BEFORE there is a student
-- principal — that is what they are for. RLS cannot be the guard on the tables
-- they touch, so the guard is stated rather than pretended:
--
--   * `accounts`, `auth_sessions`, `verification_tokens`, `password_resets`
--     are visible to `ainext_app` on a connection with NO principal set, and
--     on a connection WITH one they narrow to that principal's own account.
--     So a signed-in request — which is every request that reaches student
--     data — cannot read another student's account, session list or tokens,
--     and the unauthenticated auth routes still work. The tokens are
--     unguessable secrets looked up by exact `token_hash` match and are never
--     listed by anything; `ainext_operator` gets no grant on either token
--     table at all, so no console surface can enumerate them.
--   * `students` is visible with no principal ONLY for rows that HAVE an
--     account (`account_id IS NOT NULL`), because sign-in must resolve an
--     account to its student before a principal can be built. Two consequences
--     worth naming: the retired picker-era cast (`account_id IS NULL`) is
--     unreachable from `ainext_app` in every direction, principal or not
--     (A10); and an unprincipled read of `students` is the one residual
--     cross-student read left in this design. It is bounded to name/grade/
--     interests — no email, no credential, no work — and the tightening path,
--     if it is ever wanted, is a SECURITY DEFINER resolver owned by
--     `ainext_maint` returning one id for one account.
--
-- `auth_events` is the mirror image: `ainext_app` gets INSERT and NO SELECT, so
-- the student surface writes the security record and can never read it back.
-- (Which means recordAuthEvent must not use RETURNING — RETURNING needs SELECT.)
-- `safety_flags` is the same shape for the same reason: a student writes a flag
-- about themselves and never reads their own flags.
--
-- ============================================================================
-- WHAT THIS FILE DOES NOT COVER
-- ============================================================================
-- Migration 018 creates `cost_daily` and the overview views. New tables do NOT
-- inherit these grants — 018 grants its own, or the console reads nothing.
--
-- Idempotent — safe to re-run. Re-running REVOKEs the app and operator roles
-- back to nothing first, so this file is the single authority on who may touch
-- what: a grant deleted from here disappears from the database on the next run.

BEGIN;

-- ===========================================================================
-- 1. Roles
-- ===========================================================================

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ainext_app') THEN
    CREATE ROLE ainext_app LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ainext_operator') THEN
    CREATE ROLE ainext_operator LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ainext_maint') THEN
    CREATE ROLE ainext_maint LOGIN;
  END IF;
END
$roles$;

-- Re-asserted on every run: a role that acquired SUPERUSER or BYPASSRLS by hand
-- would make every policy below decoration, silently.
ALTER ROLE ainext_app      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
ALTER ROLE ainext_operator NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
ALTER ROLE ainext_maint    NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;

DO $connect$
BEGIN
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO ainext_app, ainext_operator, ainext_maint',
    current_database());
END
$connect$;

-- USAGE on the schema, and on sequences. The sequence grant is the classic
-- omission: identity columns do not need it, but any `serial` added later
-- would, and an INSERT that fails on a sequence permission reads like a bug in
-- the application rather than a missing GRANT here.
GRANT USAGE ON SCHEMA public TO ainext_app, ainext_operator, ainext_maint;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ainext_app, ainext_operator;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ainext_maint;

-- The maintenance role does everything, everywhere, and bypasses every policy.
-- That is the whole point of it, and the whole reason the app never gets it.
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ainext_maint;

-- ===========================================================================
-- 2. Grants — start from nothing, so this file is the authority
-- ===========================================================================

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ainext_app, ainext_operator;

-- --- student-owned data ----------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON students             TO ainext_app;
GRANT SELECT, INSERT         ON attempts             TO ainext_app;   -- append-only
GRANT SELECT, INSERT, UPDATE ON mastery              TO ainext_app;   -- UPDATE = the bitemporal close
GRANT SELECT, INSERT, UPDATE ON sessions             TO ainext_app;
GRANT SELECT, INSERT         ON ai_interactions      TO ainext_app;   -- append-only
GRANT SELECT, INSERT         ON understanding_checks TO ainext_app;
GRANT SELECT, INSERT, UPDATE ON uploads              TO ainext_app;
GRANT SELECT, INSERT         ON analytics_events     TO ainext_app;   -- append-only
GRANT         INSERT         ON safety_flags         TO ainext_app;   -- write-only: never read back
GRANT SELECT, INSERT         ON explanation_log      TO ainext_app;
GRANT SELECT                 ON guardians            TO ainext_app;

-- --- credentials -----------------------------------------------------------
GRANT SELECT, INSERT, UPDATE         ON accounts            TO ainext_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth_sessions       TO ainext_app;
GRANT SELECT, INSERT, UPDATE         ON verification_tokens TO ainext_app;
GRANT SELECT, INSERT, UPDATE         ON password_resets     TO ainext_app;
GRANT SELECT, INSERT, UPDATE         ON auth_throttle       TO ainext_app;
GRANT         INSERT                 ON auth_events         TO ainext_app;  -- write-only

-- `operators` and `operator_roles`: NO GRANT AT ALL to ainext_app. A student
-- principal cannot discover that operators exist. The bootstrap script runs
-- under ainext_maint (scripts/local-dev.sh passes it the maintenance DSN).

-- --- content: readable by both, no policies, no RLS ------------------------
-- Curriculum is not student data, and parity_check.py must keep reading it.
GRANT SELECT ON graph_nodes, graph_edges, questions, visuals, misconceptions,
                explanation_library, source_documents, extraction_runs
  TO ainext_app, ainext_operator;

-- The one content write the student surface performs: an inline widget the
-- tutor improvised is materialised as a question on first attempt, always
-- status='review' and never 'live' (ADR-0009 §3, enforced by a CHECK in 010).
-- INSERT only — promotion is a review action and belongs to the console.
GRANT INSERT ON questions TO ainext_app;

-- --- the console -----------------------------------------------------------
GRANT SELECT ON students, attempts, mastery, sessions, ai_interactions,
                understanding_checks, uploads, analytics_events, safety_flags,
                explanation_log, guardians, auth_events, operators, operator_roles
  TO ainext_operator;

-- FR-2405: changing commercial status needs cost-billing and stamps who/when.
-- Column-level UPDATE makes "only the subscription columns" a privilege rather
-- than a promise the console keeps.
GRANT UPDATE (subscription_status, subscription_note,
              subscription_updated_at, subscription_updated_by)
  ON students TO ainext_operator;

-- FR-2003: no console query selects password_hash. Column-level SELECT is why
-- it cannot, rather than why it does not.
GRANT SELECT (id, email, google_sub, status, email_verified_at, failed_attempts,
              locked_until, last_login_at, login_count, environment, created_at)
  ON accounts TO ainext_operator;

-- The console signs its own operators in, so it writes auth_sessions as well as
-- reading them; and it updates operators' lockout bookkeeping. It never writes
-- operator_roles — no role grants roles this release (contracts/authorization).
GRANT SELECT, INSERT, UPDATE ON auth_sessions TO ainext_operator;
GRANT UPDATE                 ON operators     TO ainext_operator;
GRANT SELECT, INSERT, UPDATE ON auth_throttle TO ainext_operator;
GRANT         INSERT         ON auth_events   TO ainext_operator;

-- FR-2306: the audit its subject cannot erase. SELECT and INSERT, and no
-- UPDATE or DELETE to the role that writes it.
GRANT SELECT, INSERT ON operator_reads TO ainext_operator;

-- Content review is a safety control (constitution III, FR-2204): the console
-- moves a question or a library entry through the human gate.
GRANT UPDATE ON questions, explanation_library TO ainext_operator;

-- ===========================================================================
-- 3. ENABLE + FORCE row-level security
-- ===========================================================================
-- FORCE is what makes the owner subject to the policies too. Superusers still
-- bypass — that is not configurable — which is why the app must not be one.

DO $rls$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'students','attempts','mastery','sessions','ai_interactions',
    'understanding_checks','uploads','analytics_events','safety_flags',
    'explanation_log','guardians',
    'accounts','auth_sessions','verification_tokens','password_resets',
    'auth_throttle','auth_events','operators','operator_roles','operator_reads'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END
$rls$;

-- ===========================================================================
-- 4. Policies — one set per table
-- ===========================================================================
-- Every policy is DROPped first so this file can be re-run and so a policy
-- removed from here is removed from the database.

-- --- students --------------------------------------------------------------
DROP POLICY IF EXISTS students_app_select ON students;
CREATE POLICY students_app_select ON students FOR SELECT TO ainext_app
  USING (
    id = nullif(current_setting('app.student_id', true), '')::bigint
    -- the unauthenticated sign-in window; see the header
    OR (nullif(current_setting('app.student_id', true), '') IS NULL
        AND account_id IS NOT NULL)
  );

DROP POLICY IF EXISTS students_app_insert ON students;
CREATE POLICY students_app_insert ON students FOR INSERT TO ainext_app
  -- signup only: a request that already has a principal cannot create students
  WITH CHECK (nullif(current_setting('app.student_id', true), '') IS NULL);

DROP POLICY IF EXISTS students_app_update ON students;
CREATE POLICY students_app_update ON students FOR UPDATE TO ainext_app
  USING      (id = nullif(current_setting('app.student_id', true), '')::bigint)
  WITH CHECK (id = nullif(current_setting('app.student_id', true), '')::bigint);

DROP POLICY IF EXISTS students_operator ON students;
CREATE POLICY students_operator ON students FOR ALL TO ainext_operator
  USING (true) WITH CHECK (true);   -- narrowed to the subscription columns by GRANT

-- --- attempts (append-only) ------------------------------------------------
DROP POLICY IF EXISTS attempts_app ON attempts;
CREATE POLICY attempts_app ON attempts FOR ALL TO ainext_app
  USING      (student_id = nullif(current_setting('app.student_id', true), '')::bigint)
  WITH CHECK (student_id = nullif(current_setting('app.student_id', true), '')::bigint);

DROP POLICY IF EXISTS attempts_operator ON attempts;
CREATE POLICY attempts_operator ON attempts FOR SELECT TO ainext_operator USING (true);

-- --- mastery ---------------------------------------------------------------
DROP POLICY IF EXISTS mastery_app ON mastery;
CREATE POLICY mastery_app ON mastery FOR ALL TO ainext_app
  USING      (student_id = nullif(current_setting('app.student_id', true), '')::bigint)
  WITH CHECK (student_id = nullif(current_setting('app.student_id', true), '')::bigint);

DROP POLICY IF EXISTS mastery_operator ON mastery;
CREATE POLICY mastery_operator ON mastery FOR SELECT TO ainext_operator USING (true);

-- --- sessions --------------------------------------------------------------
DROP POLICY IF EXISTS sessions_app ON sessions;
CREATE POLICY sessions_app ON sessions FOR ALL TO ainext_app
  USING      (student_id = nullif(current_setting('app.student_id', true), '')::bigint)
  WITH CHECK (student_id = nullif(current_setting('app.student_id', true), '')::bigint);

DROP POLICY IF EXISTS sessions_operator ON sessions;
CREATE POLICY sessions_operator ON sessions FOR SELECT TO ainext_operator USING (true);

-- --- ai_interactions (append-only) -----------------------------------------
-- This is the table behind FR-2104: /pipeline's latest-turn read returned the
-- most recent tutor turn written by ANY student. With this policy the same
-- query under ainext_app with no principal returns nothing.
DROP POLICY IF EXISTS ai_interactions_app ON ai_interactions;
CREATE POLICY ai_interactions_app ON ai_interactions FOR ALL TO ainext_app
  USING      (student_id = nullif(current_setting('app.student_id', true), '')::bigint)
  WITH CHECK (student_id = nullif(current_setting('app.student_id', true), '')::bigint);

DROP POLICY IF EXISTS ai_interactions_operator ON ai_interactions;
CREATE POLICY ai_interactions_operator ON ai_interactions FOR SELECT TO ainext_operator USING (true);

-- --- understanding_checks --------------------------------------------------
DROP POLICY IF EXISTS understanding_checks_app ON understanding_checks;
CREATE POLICY understanding_checks_app ON understanding_checks FOR ALL TO ainext_app
  USING      (student_id = nullif(current_setting('app.student_id', true), '')::bigint)
  WITH CHECK (student_id = nullif(current_setting('app.student_id', true), '')::bigint);

DROP POLICY IF EXISTS understanding_checks_operator ON understanding_checks;
CREATE POLICY understanding_checks_operator ON understanding_checks FOR SELECT TO ainext_operator USING (true);

-- --- uploads ---------------------------------------------------------------
-- FR-2105: parseUpload runs under the principal it was started for. Its two
-- queries do not predicate on student_id at all; under this policy they cannot
-- reach another student's row even so.
DROP POLICY IF EXISTS uploads_app ON uploads;
CREATE POLICY uploads_app ON uploads FOR ALL TO ainext_app
  USING      (student_id = nullif(current_setting('app.student_id', true), '')::bigint)
  WITH CHECK (student_id = nullif(current_setting('app.student_id', true), '')::bigint);

DROP POLICY IF EXISTS uploads_operator ON uploads;
CREATE POLICY uploads_operator ON uploads FOR SELECT TO ainext_operator USING (true);

-- --- analytics_events ------------------------------------------------------
-- An anonymous event (student_id IS NULL) is WRITABLE by the app and readable
-- only by the console: a student has no business reading the anonymous stream,
-- and emit() must still be able to record a pre-account funnel step.
DROP POLICY IF EXISTS analytics_events_app_select ON analytics_events;
CREATE POLICY analytics_events_app_select ON analytics_events FOR SELECT TO ainext_app
  USING (student_id = nullif(current_setting('app.student_id', true), '')::bigint);

DROP POLICY IF EXISTS analytics_events_app_insert ON analytics_events;
CREATE POLICY analytics_events_app_insert ON analytics_events FOR INSERT TO ainext_app
  WITH CHECK (student_id = nullif(current_setting('app.student_id', true), '')::bigint
              OR student_id IS NULL);

DROP POLICY IF EXISTS analytics_events_operator ON analytics_events;
CREATE POLICY analytics_events_operator ON analytics_events FOR SELECT TO ainext_operator USING (true);

-- --- safety_flags (write-only for the app) ---------------------------------
DROP POLICY IF EXISTS safety_flags_app_insert ON safety_flags;
CREATE POLICY safety_flags_app_insert ON safety_flags FOR INSERT TO ainext_app
  WITH CHECK (student_id = nullif(current_setting('app.student_id', true), '')::bigint);

DROP POLICY IF EXISTS safety_flags_operator ON safety_flags;
CREATE POLICY safety_flags_operator ON safety_flags FOR SELECT TO ainext_operator USING (true);

-- --- explanation_log -------------------------------------------------------
-- It has NO student_id column (§4e-1). Its only path to a student is the
-- nullable attempt_id, so the policy is a subquery through `attempts` — which
-- is itself policed, so this narrows to the principal's own attempts without
-- restating the rule. A NULL attempt_id belongs to no student and is
-- operator-only.
DROP POLICY IF EXISTS explanation_log_app ON explanation_log;
CREATE POLICY explanation_log_app ON explanation_log FOR ALL TO ainext_app
  USING      (attempt_id IS NOT NULL AND attempt_id IN (SELECT id FROM attempts))
  WITH CHECK (attempt_id IS NOT NULL AND attempt_id IN (SELECT id FROM attempts));

DROP POLICY IF EXISTS explanation_log_operator ON explanation_log;
CREATE POLICY explanation_log_operator ON explanation_log FOR SELECT TO ainext_operator USING (true);

-- --- guardians (modelled, unfilled) ----------------------------------------
DROP POLICY IF EXISTS guardians_app ON guardians;
CREATE POLICY guardians_app ON guardians FOR SELECT TO ainext_app
  USING (student_id = nullif(current_setting('app.student_id', true), '')::bigint);

DROP POLICY IF EXISTS guardians_operator ON guardians;
CREATE POLICY guardians_operator ON guardians FOR SELECT TO ainext_operator USING (true);

-- --- accounts --------------------------------------------------------------
-- No principal: the auth routes, which need the whole table by email.
-- A principal: that principal's own account and nothing else.
DROP POLICY IF EXISTS accounts_app ON accounts;
CREATE POLICY accounts_app ON accounts FOR ALL TO ainext_app
  USING (
    nullif(current_setting('app.student_id', true), '') IS NULL
    OR id = (SELECT s.account_id FROM students s
              WHERE s.id = nullif(current_setting('app.student_id', true), '')::bigint)
  )
  WITH CHECK (
    nullif(current_setting('app.student_id', true), '') IS NULL
    OR id = (SELECT s.account_id FROM students s
              WHERE s.id = nullif(current_setting('app.student_id', true), '')::bigint)
  );

DROP POLICY IF EXISTS accounts_operator ON accounts;
CREATE POLICY accounts_operator ON accounts FOR SELECT TO ainext_operator USING (true);

-- --- auth_sessions ---------------------------------------------------------
-- FR-2009: a student lists and revokes only their own devices. Refresh and
-- operator sign-in both run before a student principal exists, hence the same
-- unprincipled window as `accounts`.
DROP POLICY IF EXISTS auth_sessions_app ON auth_sessions;
CREATE POLICY auth_sessions_app ON auth_sessions FOR ALL TO ainext_app
  USING (
    nullif(current_setting('app.student_id', true), '') IS NULL
    OR account_id = (SELECT s.account_id FROM students s
                      WHERE s.id = nullif(current_setting('app.student_id', true), '')::bigint)
  )
  WITH CHECK (
    nullif(current_setting('app.student_id', true), '') IS NULL
    OR account_id = (SELECT s.account_id FROM students s
                      WHERE s.id = nullif(current_setting('app.student_id', true), '')::bigint)
  );

DROP POLICY IF EXISTS auth_sessions_operator ON auth_sessions;
CREATE POLICY auth_sessions_operator ON auth_sessions FOR ALL TO ainext_operator
  USING (true) WITH CHECK (true);

-- --- verification_tokens, password_resets ----------------------------------
-- Consumed by exact token_hash match, never listed, never returned by any
-- route. data-model.md §14 asks for "never readable from a session-bearing
-- request"; this is that, with the one relaxation that a session-bearing
-- request may touch its OWN account's tokens — which is what a resend is.
DROP POLICY IF EXISTS verification_tokens_app ON verification_tokens;
CREATE POLICY verification_tokens_app ON verification_tokens FOR ALL TO ainext_app
  USING (
    nullif(current_setting('app.student_id', true), '') IS NULL
    OR account_id = (SELECT s.account_id FROM students s
                      WHERE s.id = nullif(current_setting('app.student_id', true), '')::bigint)
  )
  WITH CHECK (
    nullif(current_setting('app.student_id', true), '') IS NULL
    OR account_id = (SELECT s.account_id FROM students s
                      WHERE s.id = nullif(current_setting('app.student_id', true), '')::bigint)
  );

DROP POLICY IF EXISTS password_resets_app ON password_resets;
CREATE POLICY password_resets_app ON password_resets FOR ALL TO ainext_app
  USING (
    nullif(current_setting('app.student_id', true), '') IS NULL
    OR account_id = (SELECT s.account_id FROM students s
                      WHERE s.id = nullif(current_setting('app.student_id', true), '')::bigint)
  )
  WITH CHECK (
    nullif(current_setting('app.student_id', true), '') IS NULL
    OR account_id = (SELECT s.account_id FROM students s
                      WHERE s.id = nullif(current_setting('app.student_id', true), '')::bigint)
  );

-- --- auth_throttle ---------------------------------------------------------
-- Operational counters: a scope, a key, a window and a number. No student data
-- and nothing reports from it, so the policy is open to the two roles that
-- increment it. RLS is on anyway, so that a role added later inherits nothing
-- by accident.
DROP POLICY IF EXISTS auth_throttle_app ON auth_throttle;
CREATE POLICY auth_throttle_app ON auth_throttle FOR ALL TO ainext_app
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS auth_throttle_operator ON auth_throttle;
CREATE POLICY auth_throttle_operator ON auth_throttle FOR ALL TO ainext_operator
  USING (true) WITH CHECK (true);

-- --- auth_events (write-only for both, readable by the console) ------------
DROP POLICY IF EXISTS auth_events_app_insert ON auth_events;
CREATE POLICY auth_events_app_insert ON auth_events FOR INSERT TO ainext_app
  WITH CHECK (true);

DROP POLICY IF EXISTS auth_events_operator_insert ON auth_events;
CREATE POLICY auth_events_operator_insert ON auth_events FOR INSERT TO ainext_operator
  WITH CHECK (true);

DROP POLICY IF EXISTS auth_events_operator_select ON auth_events;
CREATE POLICY auth_events_operator_select ON auth_events FOR SELECT TO ainext_operator
  USING (true);

-- --- operators, operator_roles (no ainext_app policy at all) ---------------
DROP POLICY IF EXISTS operators_operator_select ON operators;
CREATE POLICY operators_operator_select ON operators FOR SELECT TO ainext_operator USING (true);

DROP POLICY IF EXISTS operators_operator_update ON operators;
CREATE POLICY operators_operator_update ON operators FOR UPDATE TO ainext_operator
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS operator_roles_operator_select ON operator_roles;
CREATE POLICY operator_roles_operator_select ON operator_roles FOR SELECT TO ainext_operator USING (true);

-- --- operator_reads --------------------------------------------------------
DROP POLICY IF EXISTS operator_reads_operator_select ON operator_reads;
CREATE POLICY operator_reads_operator_select ON operator_reads FOR SELECT TO ainext_operator USING (true);

DROP POLICY IF EXISTS operator_reads_operator_insert ON operator_reads;
CREATE POLICY operator_reads_operator_insert ON operator_reads FOR INSERT TO ainext_operator
  WITH CHECK (true);

-- ===========================================================================
-- 5. Refuse to finish if the application role could bypass all of the above
-- ===========================================================================

DO $verify$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT rolname, rolsuper, rolbypassrls FROM pg_roles
            WHERE rolname IN ('ainext_app','ainext_operator')
  LOOP
    IF r.rolsuper OR r.rolbypassrls THEN
      RAISE EXCEPTION
        'role % is superuser=% bypassrls=% — every policy in this migration '
        'would be decoration', r.rolname, r.rolsuper, r.rolbypassrls;
    END IF;
  END LOOP;

  RAISE NOTICE 'RLS: forced on 20 tables; ainext_app and ainext_operator are '
               'non-superuser and do not bypass. Repoint DATABASE_URL at '
               'ainext_app or none of this applies to the running app.';
END
$verify$;

COMMIT;
