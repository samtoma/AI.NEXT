-- ===========================================================================
-- 033 — curriculum tracks: how a student's curriculum was set, who may change
--       it, the record of every change, and the once-only Google step
--
-- Feature 003 (Samuel, 2026-09-25: "I would take your recommendations").
-- `specs/003-curriculum-tracks/data-model.md` §2 is the design; plan A6;
-- FR-4003, FR-4012, FR-4014, FR-4017; privacy review F8 and F10. Additive and
-- idempotent. Safe to re-run; `deploy/apply-migrations.sh` does, on every
-- deploy, in filename order, while the previous app is still serving.
-- Rollback: `rollback/033-curriculum-tracks.down.sql`.
-- ===========================================================================
--
-- WHAT IS ALREADY THERE. `students.curriculum_system` has existed since
-- migration 009 (`TEXT NOT NULL DEFAULT 'eg-national-en'`), so every student
-- created before 003 already reads "National". What 003 changes is that the
-- value now DECIDES something — which courses a student may see
-- (`app/src/lib/catalog.ts`) — and a value that decides what a child sees must
-- not be writable by whoever happens to hold an UPDATE on the row.
--
-- FOUR THINGS.
--
--   1. Two columns on `students`:
--        `curriculum_source` — 'chosen' (answered at sign-up or in the Google
--          step, or set by an operator) or 'implied' (stored without asking).
--          Every existing row becomes 'implied' through the default: they were
--          never asked (FR-4003). A closed two-value CHECK — unlike a
--          curriculum CHECK, nothing will ever widen it.
--        `onboarding_pending` — true only for an account created by a first
--          Google sign-in, until its grade-and-curriculum step completes
--          (FR-4014). Every existing row, and every password sign-up, is false.
--
--   2. `student_curriculum_changes` — every change to a student's curriculum
--      AFTER sign-up: from, to, chosen or implied, by which operator, and why
--      (FR-4012). The value set at sign-up is recorded with the account's
--      creation (`account_created`, first-party), not here. Append-only by
--      privilege: nobody holds UPDATE or DELETE. The shape follows 030's
--      `teaching_setting_changes`.
--
--   3. `complete_student_onboarding(grade, curriculum, source)` — the ONLY way
--      the student surface can write its own curriculum, and it works ONCE
--      (FR-4014, privacy review F10). A SECURITY DEFINER function owned by
--      `ainext_maint`, with its search_path pinned and EXECUTE granted to
--      `ainext_app` alone. It updates the acting student's row only while
--      `onboarding_pending` is true, clears the flag in the same statement,
--      and RAISES when nothing was pending: a second call fails loudly and is
--      never a silent no-op. Whether the step is still pending is therefore a
--      durable fact checked at the point of writing, not at redirect time. It
--      validates neither the grade nor the curriculum: the route validates both
--      against the registry and the offered rule first (`lib/catalog.ts`
--      `resolveInitialCurriculum`), as the sign-up route does.
--
--   4. "Only an operator changes a curriculum" as a DATABASE fact (FR-4017,
--      privacy review F8). Migration 017 re-runs every deploy and issues
--      `GRANT SELECT, INSERT, UPDATE ON students TO ainext_app` — table-wide,
--      which covers `curriculum_system` and every column added later. A
--      column-level REVOKE cannot narrow a table-level grant in Postgres. So
--      this file, which sorts after 017, REVOKEs the table-wide UPDATE and
--      grants back only the one column the student surface writes today:
--      `design_variant` (`app/src/lib/design-variant-queries.ts`; a search of
--      every `UPDATE students` in `app/src` on 2026-09-25 found no other, and
--      `app/src/lib/curriculum-privilege.test.mts` fails if one appears).
--      INSERT is untouched: sign-up creates the row, with its curriculum.
--      `ainext_operator` gains UPDATE on `curriculum_system` and
--      `curriculum_source`, nothing else new.
--
-- ---------------------------------------------------------------------------
-- DELIBERATELY NO CHECK ON CURRICULUM VALUES
-- ---------------------------------------------------------------------------
-- Neither `students.curriculum_system` nor the history's from/to columns is
-- constrained to a list. Curricula are validated in application code against
-- the registry (`app/src/lib/curricula.ts`), exactly as `students.grade` is. A
-- CHECK would have to be widened for every new curriculum, and migrations
-- re-run on every deploy: 007 NULLs `understanding_checks.subject` outside its
-- list on each run, and on 2026-09-23 migration 008 re-adding a narrow CHECK
-- over rows 010 had widened took the site down (`886b302`). An unknown stored
-- value matches no course (default-deny, FR-4003).
--
-- The CHECKs this file does write (`curriculum_source`, the history's
-- `to_source` and `reason`) are closed vocabularies created only when missing,
-- so a re-run never re-adds them over rows a later file widened.
--
-- ---------------------------------------------------------------------------
-- GRANTS AND RLS on the history, and why
-- ---------------------------------------------------------------------------
--   * It IS student data — a per-child row — so ENABLE + FORCE row-level
--     security.
--   * `ainext_app` gets NOTHING: the student surface neither reads nor writes
--     it. A grade-change re-resolution by the student's own profile editor
--     (FR-4008, when FR-2013's editor exists) will write through a definer
--     function, not a grant.
--   * `ainext_operator` reads every row (Student 360, FR-4105 — a
--     `student-data` page) and inserts rows attributed to ITSELF: the insert
--     policy binds `changed_by` to the acting operator (`app.operator_id`,
--     set by `withOperator` in `app/src/lib/db.ts`), so an operator cannot
--     record a change under somebody else's name.
--
-- Migration 017 opens with `REVOKE ALL ON ALL TABLES ... FROM ainext_app,
-- ainext_operator` and re-grants `students` table-wide on every run, so the
-- grants below are stripped by 017 and restored here, in order —
-- 023/028/030's arrangement. It is only safe because 033 sorts after 017 and
-- always runs. For the moments between the two files in one deploy the app
-- holds 017's table-wide grant, exactly as every release before 003 did.
--
-- ---------------------------------------------------------------------------
-- RE-RUN TAKES NO TABLE LOCK ON A HOT TABLE
-- ---------------------------------------------------------------------------
-- `students` is read on every request. `ALTER TABLE ... ADD COLUMN` takes
-- ACCESS EXCLUSIVE even when the column exists, so each is issued only when
-- the catalogue says it is missing (027/030's rule): the first deploy pays one
-- brief lock per column (a constant default rewrites nothing), every later
-- deploy pays none. The same guard covers the new table's indexes and
-- ENABLE/FORCE. GRANT/REVOKE, the new table's policies, COMMENT and
-- CREATE OR REPLACE FUNCTION stay unconditional so a hand-edited privilege or
-- policy converges on the next deploy. Nothing here backfills anything, so
-- nothing here can fail on data.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. `students`: how the curriculum was set, and the pending Google step
-- ---------------------------------------------------------------------------

DO $columns$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'students'
                    AND column_name = 'curriculum_source') THEN
    ALTER TABLE students
      ADD COLUMN curriculum_source text NOT NULL DEFAULT 'implied'
      CONSTRAINT students_curriculum_source_check
      CHECK (curriculum_source IN ('chosen', 'implied'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'students'
                    AND column_name = 'onboarding_pending') THEN
    ALTER TABLE students
      ADD COLUMN onboarding_pending boolean NOT NULL DEFAULT false;
  END IF;
END
$columns$;

COMMENT ON COLUMN students.curriculum_source IS
  'Feature 003 (FR-4003): chosen — answered at sign-up or in the first Google '
  'sign-in step, or set by an operator; implied — stored without asking. Rows '
  'from before 003 are implied. Written by sign-up (INSERT), by '
  'complete_student_onboarding(), and by the console.';
COMMENT ON COLUMN students.onboarding_pending IS
  'Feature 003 (FR-4014): true only for an account created by a first Google '
  'sign-in until its grade-and-curriculum step completes. '
  'complete_student_onboarding() clears it, once.';

-- ---------------------------------------------------------------------------
-- 2. The history of every change after sign-up
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS student_curriculum_changes (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- No default (FR-2109): the writer names its stack.
  environment     text        NOT NULL,
  -- CASCADE: a change means nothing without its student, and the red-team and
  -- smoke scripts delete test students through `ainext_maint` (030's reason).
  student_id      bigint      NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  from_curriculum text        NOT NULL,
  to_curriculum   text        NOT NULL,
  to_source       text        NOT NULL
                  CONSTRAINT student_curriculum_changes_to_source_check
                  CHECK (to_source IN ('chosen', 'implied')),
  -- The operator who made the change. NULL only for a change the product made
  -- itself: an implied curriculum re-resolved on a grade change (FR-4008).
  changed_by      bigint      REFERENCES operators(id),
  reason          text        NOT NULL
                  CONSTRAINT student_curriculum_changes_reason_check
                  CHECK (reason IN ('operator', 'grade_change_reresolved')),
  -- The operator's own words (FR-2708's rule, applied here).
  note            text,
  changed_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_curriculum_changes_operator_named
    CHECK (reason <> 'operator' OR changed_by IS NOT NULL)
);

COMMENT ON TABLE student_curriculum_changes IS
  'Feature 003 (FR-4012): every change to students.curriculum_system after '
  'sign-up — from, to, chosen or implied, which operator, why. Append-only by '
  'privilege: ainext_operator holds SELECT and INSERT (as itself); ainext_app '
  'holds nothing. Student data: RLS forced.';

DO $indexes$
BEGIN
  IF to_regclass('public.idx_student_curriculum_changes_student') IS NULL THEN
    CREATE INDEX idx_student_curriculum_changes_student
      ON student_curriculum_changes (student_id, changed_at DESC);
  END IF;
END
$indexes$;

-- ---------------------------------------------------------------------------
-- 3. The once-only first-Google-sign-in step
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER, owned by `ainext_maint` (BYPASSRLS, not a superuser), so
-- `ainext_app` needs no UPDATE on the two curriculum columns and gets none.
-- Because the owner bypasses row-level security, the function is its own
-- guard: it acts only on `app.student_id` — the principal `withPrincipal`
-- sets — and a missing principal raises. search_path is pinned to pg_catalog
-- and every table name is schema-qualified, so a caller cannot shadow
-- `students` with an object of its own.

CREATE OR REPLACE FUNCTION complete_student_onboarding(
  p_grade text,
  p_curriculum text,
  p_source text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  acting bigint := nullif(current_setting('app.student_id', true), '')::bigint;
  updated integer;
BEGIN
  IF acting IS NULL THEN
    RAISE EXCEPTION 'complete_student_onboarding: no student principal'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.students
     SET grade              = p_grade,
         curriculum_system  = p_curriculum,
         curriculum_source  = p_source,
         onboarding_pending = false
   WHERE id = acting
     AND onboarding_pending;
  GET DIAGNOSTICS updated = ROW_COUNT;

  -- Once per account (FR-4014): nothing pending is a refusal, never a no-op.
  IF updated = 0 THEN
    RAISE EXCEPTION 'onboarding_already_completed'
      USING ERRCODE = 'AN409',
            HINT = 'Only an operator changes a curriculum after the first answer (FR-4010).';
  END IF;
END
$fn$;

ALTER FUNCTION complete_student_onboarding(text, text, text) OWNER TO ainext_maint;
REVOKE ALL ON FUNCTION complete_student_onboarding(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_student_onboarding(text, text, text) FROM ainext_operator;
GRANT EXECUTE ON FUNCTION complete_student_onboarding(text, text, text) TO ainext_app;

COMMENT ON FUNCTION complete_student_onboarding(text, text, text) IS
  'Feature 003 (FR-4014, FR-4017): the first-Google-sign-in step sets the '
  'acting student''s grade and curriculum ONCE, while onboarding_pending; a '
  'second call raises onboarding_already_completed (SQLSTATE AN409).';

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------

-- The history: start from nothing (017's rule). The console reads and
-- appends; the student surface holds nothing.
REVOKE ALL ON student_curriculum_changes FROM ainext_app, ainext_operator;
GRANT SELECT, INSERT ON student_curriculum_changes TO ainext_operator;
GRANT ALL PRIVILEGES ON student_curriculum_changes TO ainext_maint;

-- `students`: the student surface's UPDATE, narrowed to the one column it
-- writes (FR-4017). A table-level REVOKE also removes 024's column grant on
-- design_variant, which is why it is granted back here.
REVOKE UPDATE ON students FROM ainext_app;
GRANT UPDATE (design_variant) ON students TO ainext_app;

-- The console: the curriculum and how it was set, and nothing else new (017
-- keeps the subscription columns).
GRANT UPDATE (curriculum_system, curriculum_source) ON students TO ainext_operator;

-- ---------------------------------------------------------------------------
-- 5. Row-level security on the history
-- ---------------------------------------------------------------------------
-- ENABLE/FORCE only when missing (027/030's rule). The policies are dropped
-- and re-created on every run (023's idiom) so a hand-edited one converges:
-- the lock that takes is on this table alone, which only the console touches.

DO $rls$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid = 'public.student_curriculum_changes'::regclass) THEN
    ALTER TABLE student_curriculum_changes ENABLE ROW LEVEL SECURITY;
  END IF;
  IF NOT (SELECT relforcerowsecurity FROM pg_class
           WHERE oid = 'public.student_curriculum_changes'::regclass) THEN
    ALTER TABLE student_curriculum_changes FORCE ROW LEVEL SECURITY;
  END IF;
END
$rls$;

-- The console reads every row…
DROP POLICY IF EXISTS student_curriculum_changes_operator_select ON student_curriculum_changes;
CREATE POLICY student_curriculum_changes_operator_select ON student_curriculum_changes
  FOR SELECT TO ainext_operator USING (true);

-- …and records changes as ITSELF. With no operator set, the comparison is NULL
-- and the insert is refused.
DROP POLICY IF EXISTS student_curriculum_changes_operator_insert ON student_curriculum_changes;
CREATE POLICY student_curriculum_changes_operator_insert ON student_curriculum_changes
  FOR INSERT TO ainext_operator
  WITH CHECK (changed_by = nullif(current_setting('app.operator_id', true), '')::bigint);

-- ainext_maint is BYPASSRLS (017), so it needs no policy; ainext_app has no
-- grant, and no policy names it.

-- ---------------------------------------------------------------------------
-- 6. Verification — asserted, not assumed
-- ---------------------------------------------------------------------------

DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'students'
                    AND column_name = 'curriculum_source')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'students'
                       AND column_name = 'onboarding_pending') THEN
    RAISE EXCEPTION 'students.curriculum_source / onboarding_pending are missing';
  END IF;

  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'public.student_curriculum_changes'::regclass) THEN
    RAISE EXCEPTION 'student_curriculum_changes needs ENABLE *and* FORCE row level security';
  END IF;

  -- THE ONE THIS FILE EXISTS FOR (FR-4017): the student surface cannot change
  -- a curriculum, or how it was set, or the pending step, by any grant.
  IF has_table_privilege('ainext_app', 'students', 'UPDATE') THEN
    RAISE EXCEPTION 'ainext_app still holds a table-wide UPDATE on students — it covers curriculum_system';
  END IF;
  IF has_column_privilege('ainext_app', 'students', 'curriculum_system', 'UPDATE')
     OR has_column_privilege('ainext_app', 'students', 'curriculum_source', 'UPDATE')
     OR has_column_privilege('ainext_app', 'students', 'onboarding_pending', 'UPDATE') THEN
    RAISE EXCEPTION 'ainext_app can UPDATE a curriculum column — only an operator may (FR-4017)';
  END IF;
  -- …while every write it makes today still works.
  IF NOT has_column_privilege('ainext_app', 'students', 'design_variant', 'UPDATE')
     OR NOT has_table_privilege('ainext_app', 'students', 'INSERT') THEN
    RAISE EXCEPTION 'ainext_app lost a students privilege it needs (design_variant, or sign-up''s INSERT)';
  END IF;
  IF has_table_privilege('ainext_app', 'student_curriculum_changes', 'SELECT')
     OR has_table_privilege('ainext_app', 'student_curriculum_changes', 'INSERT') THEN
    RAISE EXCEPTION 'ainext_app holds a privilege on student_curriculum_changes — it has none';
  END IF;

  -- The once-only step: callable by the student surface, by nobody else, and
  -- running as the non-superuser maintenance role.
  IF NOT has_function_privilege('ainext_app', 'complete_student_onboarding(text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ainext_app cannot run complete_student_onboarding — the Google step cannot finish';
  END IF;
  IF has_function_privilege('ainext_operator', 'complete_student_onboarding(text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ainext_operator can run complete_student_onboarding — it is the student''s step';
  END IF;
  IF (SELECT r.rolname FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
       WHERE p.oid = 'public.complete_student_onboarding(text,text,text)'::regprocedure)
     IS DISTINCT FROM 'ainext_maint'
     OR NOT (SELECT prosecdef FROM pg_proc
              WHERE oid = 'public.complete_student_onboarding(text,text,text)'::regprocedure) THEN
    RAISE EXCEPTION 'complete_student_onboarding must be SECURITY DEFINER and owned by ainext_maint';
  END IF;

  -- The history is append-only, and the console can do its job.
  IF has_table_privilege('ainext_operator', 'student_curriculum_changes', 'UPDATE')
     OR has_table_privilege('ainext_operator', 'student_curriculum_changes', 'DELETE') THEN
    RAISE EXCEPTION 'the curriculum history can be edited — an audit its author can edit is decoration';
  END IF;
  IF NOT has_column_privilege('ainext_operator', 'students', 'curriculum_system', 'UPDATE')
     OR NOT has_column_privilege('ainext_operator', 'students', 'curriculum_source', 'UPDATE')
     OR NOT has_table_privilege('ainext_operator', 'student_curriculum_changes', 'INSERT') THEN
    RAISE EXCEPTION 'the console cannot change a curriculum';
  END IF;

  RAISE NOTICE 'curriculum tracks: ready — students by curriculum: %; % recorded change(s); % pending Google step(s)',
    coalesce((SELECT string_agg(curriculum_system || '/' || curriculum_source || '=' || n, ', '
                                ORDER BY curriculum_system, curriculum_source)
                FROM (SELECT curriculum_system, curriculum_source, count(*) AS n
                        FROM students GROUP BY 1, 2) s),
             'none'),
    (SELECT count(*) FROM student_curriculum_changes),
    (SELECT count(*) FROM students WHERE onboarding_pending);
END
$verify$;

COMMIT;
