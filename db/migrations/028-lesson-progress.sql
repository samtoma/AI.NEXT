-- ===========================================================================
-- 028 — `student_progress`: the lesson each student is on, per course
--
-- ADR-0020, mastery-gated lesson progression (Tamer Deif). Written as
-- migration 012 / ADR-0012 on `wip/socratic-probing-route-b`; renumbered when
-- brought onto `main`, whose 012 is environment attribution and whose ADR-0012
-- is per-student isolation — which this file now also has to satisfy.
--
-- Additive and idempotent. Safe to re-run; `scripts/local-dev.sh` does, and
-- `deploy/apply-migrations.sh` does on every deploy, in filename order.
-- Rollback: `rollback/028-lesson-progress.down.sql`.
-- ===========================================================================
--
-- Before this, `/student` opened on a constant. The check-in derived its
-- lesson as `?lesson=` ?? first-row-of-the-catalogue ?? the hardcoded
-- DEFAULT_LESSON_SLUG "u1-1" — none of which read mastery, and nothing
-- anywhere read a date. This table is the missing persisted state: where a
-- student actually IS in a course.
--
-- WHY A POINTER AND NOT A DERIVATION. The mastered band (>= 0.75) is both
-- quickly reached and reversible: with DEFAULT_PARAMS two correct answers
-- take an LO from the 0.30 prior to 0.919, and from a mastered 0.98 two wrong
-- answers fall back to 0.517. A "current lesson" recomputed on every render
-- would therefore move BACKWARDS after a bad session, and the assigned card
-- would flicker between lessons run to run. The pointer advances once, when
-- the gate is first crossed, and is never walked back (ADR-0020 "Monotonic").
--
-- WHY PER COURSE AND NOT PER STUDENT. The check-in is subject-scoped
-- (`?subject=`), and the tree carries three courses. A single pointer per
-- student would let mastering a maths lesson move the Arabic one.
--
-- NOT bitemporal, deliberately — unlike `mastery`. This is a cursor, not
-- evidence: `advanced_at` records when it last moved, and `attempts` already
-- reconstructs the whole path if anyone needs it.
--
-- ---------------------------------------------------------------------------
-- WHAT CHANGED FROM THE BRANCH'S 012, AND WHY
-- ---------------------------------------------------------------------------
--  · ROW-LEVEL SECURITY, ENABLE + FORCE, with the per-student policy every
--    student table in migration 017 carries (ADR-0012). The branch predates
--    017 on `main`; without this the table would be the one student table a
--    forgotten WHERE could read across children.
--  · Grants: `ainext_app` SELECT/INSERT/UPDATE (the read, the first advance,
--    the later advances — never DELETE); `ainext_maint` ALL; `ainext_operator`
--    NOTHING. No console surface reads the pointer, and the console's
--    cross-student reads are enumerated per surface (`lib/auth/authorize.ts`
--    CROSS_STUDENT_READS, data-model §14): a grant with no surface behind it
--    is a read of children's data nobody asked for. When Student 360 wants to
--    show where a child is, that surface adds the grant, the policy and its
--    registry entry together.
--  · `environment`, NOT NULL, defaulting to 'mvp1' exactly as `mastery` does
--    (migration 012): constitution XI, every student-scoped row says which
--    build wrote it.
--  · `course_id` is NOT a foreign key to `graph_nodes`. Migrations 023 and 025
--    say why for course ids: a course is a product fact that can outlive or
--    predate the content behind it — and concretely, `load_seed.py --course`
--    deletes and re-inserts the course's subtree, which a FK from here would
--    make fail the day any student had advanced in that course.
--  · `student_id ... ON DELETE CASCADE`: a cursor means nothing without its
--    student, and `scripts/red-team-isolation.sh` / the smoke scripts delete
--    test students through `ainext_maint`.
--  · NO BACKFILL (Samuel, 2026-09-23 — ADR-0020 amendment). The branch seeded
--    a pointer for every existing student from their current mastery. Two
--    things were wrong with that, and one of them was a latent outage:
--      1. Migrations re-run on EVERY deploy (`deploy/apply-migrations.sh`, no
--         ledger). The seed ran again on every deploy until the table held a
--         row, and every row it wrote had to satisfy the `lesson_slug` CHECK
--         — which it never checked. One unexpected LO id in any course would
--         have failed the whole migration, which fails the deploy, and on the
--         2026-09-23 box that is the site down.
--      2. It did not implement the runtime rule. It jumped a student to the
--         lesson after the FURTHEST passing one, skipping unmastered earlier
--         lessons and ignoring prerequisites — a pointer the app itself could
--         never have produced.
--    Production holds only founder and test students, so every student starts
--    on the course's first lesson — the app's own fallback for a student with
--    no row — and advances by the runtime rule alone (lib/progression.ts).
--    The branch's comment claimed the backfill could read every student's
--    mastery because it "runs as the migration owner"; it could only because
--    that owner, `ainext`, is a SUPERUSER — the table owner is still subject
--    to FORCE ROW LEVEL SECURITY. Nothing here reads student data any more.
--  · RE-RUN TAKES NO TABLE LOCK. Every deploy re-applies this file while the
--    previous app is still serving. `ALTER TABLE ... ROW LEVEL SECURITY` and
--    `CREATE`/`DROP POLICY` take ACCESS EXCLUSIVE even when they change
--    nothing, so each is guarded by a catalogue check and runs only when the
--    database actually differs. The GRANT/REVOKE and COMMENT statements take
--    no lock that blocks a reader or a writer and stay unconditional, so a
--    hand-edited privilege converges back on the next deploy.

BEGIN;

CREATE TABLE IF NOT EXISTS student_progress (
  student_id   BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_id    TEXT   NOT NULL,
  lesson_slug  TEXT   NOT NULL CHECK (lesson_slug ~ '^[a-z0-9]{1,12}-[0-9]{1,3}$'),
  advanced_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  environment  TEXT   NOT NULL DEFAULT 'mvp1',
  PRIMARY KEY (student_id, course_id)
);

COMMENT ON TABLE student_progress IS
  'ADR-0020: the lesson each student is currently on, per course. Monotonic — advanced when every LO in the current lesson reaches 0.75, never walked back when mastery later drops. No row = the course''s first lesson. Student data: RLS forced (ADR-0012).';
COMMENT ON COLUMN student_progress.lesson_slug IS
  'LO-id prefix ("u1-1", "geo1-2"), matching lib/lesson-slug.ts SLUG_RE. Not an FK: a lesson is a lexical group of learning objectives, not a row.';
COMMENT ON COLUMN student_progress.course_id IS
  'Course node id. Deliberately not a foreign key (migrations 023/025): a scoped content reload replaces the course subtree.';

-- --- grants ------------------------------------------------------------------
-- The REVOKE also withdraws the operator SELECT an earlier draft of this file
-- granted, from any database that ran it.
REVOKE ALL ON student_progress FROM ainext_app, ainext_operator;
GRANT SELECT, INSERT, UPDATE ON student_progress TO ainext_app;
GRANT ALL PRIVILEGES         ON student_progress TO ainext_maint;

-- --- row-level security (ADR-0012), guarded so a re-run locks nothing ---------
DO $rls$
DECLARE
  -- The one policy this table carries. Compared, not assumed: a policy that
  -- exists with a different predicate is replaced, so a hand edit converges.
  want_qual text := '(student_id = (NULLIF(current_setting(''app.student_id''::text, true), ''''::text))::bigint)';
  have_qual text;
  have_check text;
  have_roles name[];
  have_cmd text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid = 'public.student_progress'::regclass) THEN
    ALTER TABLE student_progress ENABLE ROW LEVEL SECURITY;
  END IF;
  IF NOT (SELECT relforcerowsecurity FROM pg_class
           WHERE oid = 'public.student_progress'::regclass) THEN
    ALTER TABLE student_progress FORCE ROW LEVEL SECURITY;
  END IF;

  SELECT qual, with_check, roles, cmd
    INTO have_qual, have_check, have_roles, have_cmd
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'student_progress'
     AND policyname = 'student_progress_app';
  IF NOT FOUND
     OR have_cmd IS DISTINCT FROM 'ALL'
     OR have_roles IS DISTINCT FROM ARRAY['ainext_app']::name[]
     OR have_qual IS DISTINCT FROM want_qual
     OR have_check IS DISTINCT FROM want_qual THEN
    DROP POLICY IF EXISTS student_progress_app ON student_progress;
    CREATE POLICY student_progress_app ON student_progress FOR ALL TO ainext_app
      USING      (student_id = nullif(current_setting('app.student_id', true), '')::bigint)
      WITH CHECK (student_id = nullif(current_setting('app.student_id', true), '')::bigint);
  END IF;

  -- An earlier draft of this file gave the console a read-all policy. Gone
  -- with its grant (see the header); removed only where it still exists.
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'student_progress'
                AND policyname = 'student_progress_operator') THEN
    DROP POLICY student_progress_operator ON student_progress;
  END IF;
END
$rls$;

-- --- verify ------------------------------------------------------------------
DO $verify$
BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'public.student_progress'::regclass) THEN
    RAISE EXCEPTION
      'student_progress needs ENABLE *and* FORCE row level security (ADR-0012)';
  END IF;
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'student_progress') <> 1 THEN
    RAISE EXCEPTION
      'student_progress must carry exactly one policy, student_progress_app';
  END IF;
  IF NOT has_table_privilege('ainext_app', 'student_progress', 'SELECT')
     OR NOT has_table_privilege('ainext_app', 'student_progress', 'INSERT')
     OR NOT has_table_privilege('ainext_app', 'student_progress', 'UPDATE') THEN
    RAISE EXCEPTION
      'ainext_app cannot read or move the lesson pointer — the check-in would '
      'fall back to the first lesson for everybody and never advance';
  END IF;
  IF has_table_privilege('ainext_app', 'student_progress', 'DELETE') THEN
    RAISE EXCEPTION 'ainext_app can DELETE student_progress — the pointer is monotonic and no surface removes it';
  END IF;
  IF has_table_privilege('ainext_operator', 'student_progress', 'SELECT')
     OR has_table_privilege('ainext_operator', 'student_progress', 'INSERT')
     OR has_table_privilege('ainext_operator', 'student_progress', 'UPDATE')
     OR has_table_privilege('ainext_operator', 'student_progress', 'DELETE') THEN
    RAISE EXCEPTION
      'ainext_operator holds a privilege on student_progress. No console '
      'surface reads it; a read belongs with the surface that needs it and '
      'its entry in lib/auth/authorize.ts CROSS_STUDENT_READS';
  END IF;
  RAISE NOTICE 'student_progress: ready';
END
$verify$;

COMMIT;
