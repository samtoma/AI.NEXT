-- ===========================================================================
-- 023 — course availability: WHICH COURSES A STUDENT MAY SEE AT ALL
--
-- Samuel's call, 2026-09-21. Additive and idempotent. Safe to re-run;
-- `scripts/local-dev.sh` does, on every run, in filename order.
--
-- ⚠ NO REQUIREMENT COVERS THIS YET. There is no FR for course availability and
-- none has been invented here or in `traceability.md` — CLAUDE.md calls that
-- "matrix laundering". This header is the record until a requirement lands.
-- ===========================================================================
--
-- WHAT THIS IS FOR. The console is to show all three subjects from the
-- registry (`app/src/lib/subjects.ts`) whether or not the spine holds any
-- content for them, so Samuel can see the product as it will be sold. That is
-- a console decision. The student side needs the opposite property: a subject
-- that is on the console must NOT thereby be on a child's screen. These two
-- tables are the seam between those two answers.
--
-- THE RULE IS EXPLICIT ALLOW, AND THAT IS THE WHOLE DESIGN. A course is
-- visible to a student only when a row here says `live` for it. **No row means
-- hidden.** The alternative — a `hidden` flag over an implicit default of
-- visible — fails in the one direction that matters: a course loaded by the
-- extraction pipeline at 2 a.m., or a registry entry added for a demo, would
-- be on a fourteen-year-old's screen before anybody decided it should be. A
-- missing row is the most likely state in the life of this table, so the
-- missing row has to be the safe one.
--
-- TWO LEVERS, AND THE SECOND ONE WINS.
--
--   course_availability    per (course, grade) — the broad rule. "Prep 3 sees
--                          maths." It is what Samuel actually manages.
--   student_course_access  per (student, course) — the exception, and it wins
--                          over the grade rule in BOTH directions. It is what
--                          lets one test student be given all three subjects
--                          without any of them reaching the pilot families,
--                          and what lets one student be cut off from a course
--                          that is otherwise live for their whole grade
--                          without inventing a per-student grade.
--
-- Precedence is decided in application code (`app/src/lib/catalog.ts`, a pure
-- module with unit tests) rather than in a view here, because the rule has to
-- be TESTABLE without a database and because the same rule is applied to
-- registry-derived courses the spine has never heard of.
--
-- `requires_plan` IS A SEAM, NOT A FEATURE. It exists so that the column does
-- not have to be added under time pressure the day a price is set. It is
-- ALWAYS NULL in this build, and **nothing DECIDES anything from it** — not
-- the student gate, not `lib/catalog.ts`, not a query that answers "may this
-- student see this course". Access is not gated on commercial status in this
-- release: FR-2404 forbids exactly that.
--
-- AMENDED 2026-09-22, because the original wording here said "nothing reads
-- it — not the console", and that stopped being true the same week. The
-- console now SELECTs the column once, in `courseCatalog`, to print it as a
-- read-only field labelled as recorded but in force nowhere. Showing an
-- operator what is stored is not the same act as letting it decide, and the
-- distinction is worth keeping in words because it is easy to lose: what is
-- forbidden is a commercial value reaching the visibility decision, not a
-- human reading the value. `app/src/lib/plan-gate.test.mts` is what holds the
-- line — it fails if the student gate's own `SELECT course_id, grade, state`
-- grows a column, if the value escapes `courseCatalog`, or if any student
-- surface so much as mentions it. `subscription-gate.test.mts` does the same
-- job for `students.subscription_status`.
--
-- WHY `environment` IS ON BOTH TABLES. Constitution XI: no fact about one
-- stack may leak into another, and "which courses are live" is a fact about a
-- stack. The comparison build and the frozen baseline must be able to disagree
-- about what is on, and a shared row would make one of them wrong silently.
--
-- WHY `grade` IS `text`. `students.grade` is `text` ('9', '10'), and a gate
-- that compared a smallint against it would either cast on every read or, on a
-- row with an unparseable grade, throw inside the query that decides whether a
-- child sees anything. Same type, exact comparison, no cast.
--
-- GRANTS, AND WHY THE TWO TABLES ARE NOT TREATED ALIKE:
--
--   * `course_availability` is NOT student data — it is a fact about the
--     curriculum, like `graph_nodes`. Migration 017 gives content tables
--     SELECT to both roles and no RLS at all; this follows that, plus
--     INSERT/UPDATE for `ainext_operator` alone. `ainext_app` must be able to
--     READ it (that is how the gate answers) and must never be able to widen
--     its own access: a student surface that could write this table could
--     unhide a course for itself.
--   * `student_course_access` IS student data — a per-child row — so it gets
--     the same ENABLE + FORCE row-level security and the same
--     `current_setting('app.student_id')` policy shape every student table in
--     017 has. Copied from there deliberately rather than invented: a second
--     idiom for the same guarantee is a second thing to get wrong.
--
-- Migration 017 opens with `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM
-- ainext_app, ainext_operator`, so on a re-run of the whole directory these
-- grants are stripped by 017 and restored here, in order. That is the intended
-- arrangement (017's own header says new tables grant their own or the console
-- reads nothing); it is only safe because 023 sorts after 017 and always runs.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The broad rule: per (course, grade)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS course_availability (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  environment   text        NOT NULL,
  course_id     text        NOT NULL,
  grade         text        NOT NULL,
  state         text        NOT NULL CHECK (state IN ('live','hidden')),
  -- The subscription seam. ALWAYS NULL in this build; nothing reads it.
  requires_plan text,
  -- Why this rule exists, in an operator's own words. Read by a human months
  -- later asking "who turned this off and what for".
  note          text,
  updated_by    bigint      REFERENCES operators(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (environment, course_id, grade)
);

-- `course_id` is NOT a foreign key to `graph_nodes`, and that is deliberate.
-- The console lists courses from the SUBJECT REGISTRY, not from the spine —
-- `course:prep3-arabic-ar` is a real product decision with zero rows behind it
-- today. A foreign key would make the rule for a course unrecordable until its
-- book had been extracted, which is precisely backwards: the decision about
-- who may see a subject comes BEFORE the content, not after it.
COMMENT ON TABLE course_availability IS
  'Explicit allow-list: a (course, grade) is visible to students only when a '
  'row here says live. No row means hidden. Written by the console as '
  'ainext_operator; read by the student gate as ainext_app '
  '(app/src/lib/catalog.ts). Not student data, so no RLS.';

-- ---------------------------------------------------------------------------
-- 2. The exception: per (student, course), and it outranks the grade rule
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS student_course_access (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  environment text        NOT NULL,
  student_id  bigint      NOT NULL REFERENCES students(id),
  course_id   text        NOT NULL,
  state       text        NOT NULL CHECK (state IN ('live','hidden')),
  note        text,
  updated_by  bigint      REFERENCES operators(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (environment, student_id, course_id)
);

COMMENT ON TABLE student_course_access IS
  'Per-student override of course_availability, winning in both directions '
  '(it can show a course the grade rule hides, and hide one it shows). '
  'Student data: RLS forced, ainext_app sees only its own principal''s rows.';

-- ---------------------------------------------------------------------------
-- 3. Grants and RLS
-- ---------------------------------------------------------------------------

-- Start from nothing, so this file is the authority on who may touch these two
-- tables and a grant deleted from here disappears on the next run (017's rule).
REVOKE ALL ON course_availability, student_course_access
  FROM ainext_app, ainext_operator;

-- The rule table: content-shaped. Both roles read; only the console writes.
GRANT SELECT               ON course_availability TO ainext_app;
GRANT SELECT, INSERT, UPDATE ON course_availability TO ainext_operator;
GRANT ALL PRIVILEGES       ON course_availability TO ainext_maint;

-- The override table: student data. The app READS its own row and never writes
-- one — granting a student surface INSERT here would let a bug, or a student,
-- write the row that unhides a course for that same student.
GRANT SELECT                         ON student_course_access TO ainext_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON student_course_access TO ainext_operator;
GRANT ALL PRIVILEGES                 ON student_course_access TO ainext_maint;

ALTER TABLE student_course_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_course_access FORCE ROW LEVEL SECURITY;

-- The 017 idiom, verbatim: `true` so an unset setting is NULL rather than an
-- error, `nullif` so the empty string a reset leaves behind does not fail the
-- cast, and `student_id = NULL` being NULL rather than true is what makes NO
-- PRINCIPAL MEAN NO ROWS. There is no unprincipled window here: unlike
-- `students` and `accounts`, nothing reads this table before sign-in.
DROP POLICY IF EXISTS student_course_access_app ON student_course_access;
CREATE POLICY student_course_access_app ON student_course_access FOR SELECT TO ainext_app
  USING (student_id = nullif(current_setting('app.student_id', true), '')::bigint);

DROP POLICY IF EXISTS student_course_access_operator ON student_course_access;
CREATE POLICY student_course_access_operator ON student_course_access FOR ALL TO ainext_operator
  USING (true) WITH CHECK (true);

-- ainext_maint is BYPASSRLS (017), so it needs no policy; the absence of one
-- is why no other role reaches this table even by accident.

-- ---------------------------------------------------------------------------
-- 4. Seed — today's behaviour, unchanged
-- ---------------------------------------------------------------------------
-- Maths stays live for grade 9 (Prep 3), which is every student in the pilot
-- and the only course in the spine. Nothing else is seeded: under explicit
-- allow, "nothing else is seeded" IS "nothing else is visible", which is the
-- state this feature is meant to start from.
--
-- BOTH environments are seeded rather than "the current one". A .sql file run
-- by psql has no access to `AINEXT_ENVIRONMENT`, and the alternatives were to
-- guess from existing rows (a fresh database has none, and would come up with
-- maths hidden from everybody) or to require a psql variable local-dev.sh does
-- not pass (so the migration would silently seed nothing). The environment set
-- is CLOSED and has exactly two members — `baseline` and `mvp1`, enumerated in
-- app/src/lib/env.ts — and this is a curriculum rule rather than a metric, so
-- writing the same rule for both pools nothing and mis-attributes nothing.
INSERT INTO course_availability (environment, course_id, grade, state, note)
SELECT env, 'course:prep3-math-en', '9', 'live',
       'Seeded by migration 023: the pre-existing behaviour, stated explicitly.'
  FROM unnest(ARRAY['baseline','mvp1']) AS env
ON CONFLICT (environment, course_id, grade) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Verification — asserted, not assumed (the argument 020/021/022 make)
-- ---------------------------------------------------------------------------

DO $verify$
BEGIN
  IF to_regclass('public.course_availability') IS NULL
     OR to_regclass('public.student_course_access') IS NULL THEN
    RAISE EXCEPTION 'course availability tables were not created';
  END IF;

  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'public.student_course_access'::regclass) THEN
    RAISE EXCEPTION
      'student_course_access needs ENABLE *and* FORCE row level security — '
      'without FORCE the owner reads every child''s overrides';
  END IF;

  -- The gate has to be able to answer, or every student sees nothing and the
  -- product looks broken rather than protected.
  IF NOT has_table_privilege('ainext_app', 'course_availability', 'SELECT')
     OR NOT has_table_privilege('ainext_app', 'student_course_access', 'SELECT') THEN
    RAISE EXCEPTION 'ainext_app cannot read the availability rules — the student gate cannot answer';
  END IF;

  -- The gate must not be able to widen itself.
  IF has_table_privilege('ainext_app', 'course_availability', 'INSERT')
     OR has_table_privilege('ainext_app', 'course_availability', 'UPDATE')
     OR has_table_privilege('ainext_app', 'course_availability', 'DELETE') THEN
    RAISE EXCEPTION
      'ainext_app can write course_availability — a student surface that can '
      'edit the allow-list is not gated by it';
  END IF;

  IF has_table_privilege('ainext_app', 'student_course_access', 'INSERT')
     OR has_table_privilege('ainext_app', 'student_course_access', 'UPDATE')
     OR has_table_privilege('ainext_app', 'student_course_access', 'DELETE') THEN
    RAISE EXCEPTION
      'ainext_app can write student_course_access — a student could grant '
      'themselves a course an operator hid';
  END IF;

  IF NOT has_table_privilege('ainext_operator', 'course_availability', 'UPDATE')
     OR NOT has_table_privilege('ainext_operator', 'student_course_access', 'INSERT') THEN
    RAISE EXCEPTION 'the console cannot set availability';
  END IF;

  RAISE NOTICE
    'course availability: ready — % grade rule(s), % student override(s)',
    (SELECT count(*) FROM course_availability),
    (SELECT count(*) FROM student_course_access);
END
$verify$;

COMMIT;
