-- ===========================================================================
-- 025 — in-product feedback: WHAT THE STUDENT THINKS OF US
--
-- Samuel's ask, 2026-09-22: "a feedback at end of session, thumbs up / down
-- and a text to be added so we know how did we do… also might have something
-- similar when we finish a lesson or after a long session… and the admin can
-- see, find a good place to have the global view, but also view per student".
-- Additive and idempotent. Safe to re-run; `scripts/local-dev.sh` does, on
-- every run, in filename order.
--
-- The requirements are **FR-2801…FR-2811** in
-- `specs/002-identity-and-admin-console/spec.md`, written on the same day and
-- stamped `[ADDED 2026-09-22]` there. They arrived WITH their code rather than
-- before it, exactly as FR-2701…FR-2711 did, and the spec says so; Samuel
-- asking for the capability is the authorisation, and nothing here is
-- back-dated.
-- ===========================================================================
--
-- ---------------------------------------------------------------------------
-- WHAT MAKES THIS TABLE DIFFERENT FROM EVERY OTHER TABLE IN THE SCHEMA
-- ---------------------------------------------------------------------------
-- `note` is **free text written by a fourteen-year-old**, at the end of a study
-- session, sometimes straight after being told what she did not understand. It
-- is the only column in this database that is unbounded prose from a child.
-- Every other student-written value in the schema is an attempt's answer, a
-- widget's payload or a chat turn aimed at the tutor — this one is aimed at
-- US, and a person who is asked "how did we do?" sometimes answers a different
-- question than the one asked.
--
-- Three consequences, all of them encoded below rather than remembered:
--
--  1. **It never reaches a model.** Not in a prompt, not in `retrievalBlock`,
--     not in a snapshot, not in the ask data block. The guarantee is a test
--     (`app/src/lib/feedback-isolation.test.mts`) rather than this comment: it
--     walks the import graph out of every prompt-building module and fails if
--     `lib/feedback-queries.ts` is reachable from any of them. It is the
--     student's opinion of the product, not learning material, and a note
--     folded into a tutor prompt would be the product answering a child's
--     complaint about itself.
--  2. **It reaches a human, by a path that is a surface rather than a
--     classifier.** See "NOTHING IS CLASSIFIED AUTOMATICALLY" below — that
--     section is the most important one in this file.
--  3. **Constitution VII, minimum collection.** A rating and an optional note
--     are facts about the PRODUCT. Getting them adds no personal datum: no
--     name, no contact, no age, nothing beyond the `student_id` the row needs
--     in order to be attributable at all, and `session_ref` so an operator
--     reading "this was confusing" can find out which lesson "this" was.
--
-- ---------------------------------------------------------------------------
-- NOTHING IS CLASSIFIED AUTOMATICALLY, AND THAT IS A DECISION, NOT AN OMISSION
-- ---------------------------------------------------------------------------
-- There is no keyword scan on this column. No regular expression, no word
-- list, no sentiment model, and **nothing here ever writes a `safety_flags`
-- row**. Three reasons, in the order they matter:
--
--   * A list of alarming words applied to teenagers produces false alarms in
--     bulk — "this lesson is killing me", "I hate fractions", a song lyric, a
--     joke between friends — and an operator who has dismissed nine of those
--     dismisses the tenth. The mechanism would end up *reducing* the chance a
--     real disclosure is read.
--   * It produces false comfort in the other direction. Distress that does not
--     use the vocabulary on the list reads as "clean" to a scanner, and a
--     surface that shows a green tick has told its reader something it does
--     not know.
--   * `safety_flags` is deliberately thin (FR-802, migration 009): flag type
--     and time, no excerpt, no transcript. A flag raised from a note would
--     therefore say "something happened to this child" while the words that
--     caused it sat in a different table — alarming without informing, which
--     is the worst available combination.
--
-- What is done instead is structural. **Every note is put in front of a human
-- by default**: `/feedback` in the console opens on the notes themselves,
-- newest first, in full and never truncated, each one naming the student and
-- the sitting it followed, and the Student 360 carries the same student's
-- notes in time order. No triage state, no "reviewed" tick, no queue that can
-- be marked done — because a queue with a done button is a queue people clear,
-- and the property wanted here is that the words stay visible.
--
-- The honest limit, stated rather than glossed: **this is a pull, not a
-- push.** Nothing pages anybody at 2 a.m. A note written on Friday is read
-- when an operator next opens the console. At pilot scale (tens of students,
-- three founders, a prompt a student meets at most once a fortnight) that is a
-- handful of notes a week and the right trade; at a scale where it is not,
-- the change is a notification on `alerts_sent`'s existing rails — a mail
-- saying *a note is waiting*, carrying no part of the note — and it is a
-- change to `scripts/alerts-sweep.mts`, not to this table.
--
-- ---------------------------------------------------------------------------
-- ONE ROW PER SITTING, AND WHY `session_ref` IS BOTH NULLABLE AND UNIQUE
-- ---------------------------------------------------------------------------
-- The partial unique index below is what makes "we never ask twice about the
-- same sitting" a property of the database rather than of the code that
-- happens to call it. It is also what makes the thumb-then-note interaction
-- one row: the thumb writes the row, the optional note UPDATEs it through
-- `ON CONFLICT`, and a child who types nothing leaves exactly what she did —
-- a rating — rather than two rows that have to be reconciled later.
--
-- The column is nullable anyway, for FR-2309's reason: a reference we cannot
-- establish is NULL and never a guess. Today the only writer always has one
-- (the endpoint resolves the student's own most recent sitting server-side and
-- refuses when there is none), so no NULL row exists yet. It stays nullable
-- because the alternative is a NOT NULL that would one day discard a child's
-- words because the sitting they followed could not be named, and a note is
-- the one thing here that must survive losing its context.
--
-- Postgres treats NULLs as distinct in a unique index, so a future NULL-session
-- row is not constrained by it. That is the right way round: the constraint
-- exists to stop DUPLICATE answers about ONE sitting, and rows with no sitting
-- are not duplicates of each other.
--
-- ---------------------------------------------------------------------------
-- `rating IS NULL` MEANS SHE CLOSED IT, AND THAT IS A DIFFERENT FACT
-- ---------------------------------------------------------------------------
-- Dismissal is a row, not the absence of one — the same argument ADR-0017 made
-- for the design variant: a preference about a person belongs to the person,
-- not to the browser. A dismissal kept in `localStorage` is lost on the school
-- computer, on a borrowed tablet and the first time site data is cleared, and
-- a child who said "not now" and is asked again the next evening has been told
-- that "not now" does not really exist. So the row is written server-side
-- against the student, it silences the prompt for the same fortnight an answer
-- does, and `rating IS NULL` is how it is recognised.
--
-- The CHECK constraint `feedback_note_needs_rating` follows from the surface:
-- the note box does not exist until a thumb has been pressed, so a note with
-- no rating is not a shape the product can produce and is refused rather than
-- stored as an anomaly nobody can interpret.
--
-- ---------------------------------------------------------------------------
-- 600 CHARACTERS
-- ---------------------------------------------------------------------------
-- Long enough for a real thing said in two or three sentences, in either
-- language — Arabic runs longer per idea than English, and a cap chosen for
-- English would silently be a tighter cap for two of the three live courses.
-- Short enough that the box reads as a remark rather than an essay a child
-- feels obliged to fill, and short enough that the console prints every note
-- IN FULL, with no "…more" link — a truncated note is a note somebody decides
-- not to expand.
--
-- The cap is stated in three places and this one is the last word: the
-- textarea's `maxLength` is a courtesy to the typist, the endpoint's check is
-- the gate, and this constraint is what holds if either is ever wrong.
--
-- ---------------------------------------------------------------------------
-- GRANTS, AND THE ONE THAT WILL LOOK LIKE AN OVERSIGHT
-- ---------------------------------------------------------------------------
--   * `ainext_app` gets SELECT, INSERT and UPDATE, all three scoped by policy
--     to `current_setting('app.student_id')`. SELECT because the cadence rule
--     has to read when this student was last asked; INSERT for the thumb;
--     UPDATE for the note that follows it. No DELETE: no surface offers a
--     child a delete control, so the privilege would have no caller, and a
--     privilege with no caller is only ever exercised by a bug.
--
--   * **`ainext_operator` gets SELECT and NOTHING ELSE**, and the verify block
--     below RAISEs if that ever stops being true. This is the deliberate part.
--     An operator who can UPDATE can change what a child said; an operator who
--     can DELETE can make an uncomfortable note stop existing. Those are the
--     exact two failures a feedback channel must not have — it is a record of
--     what the people we serve think of us, and a record its subject's employer
--     can edit is not a record. It is the same argument `operator_reads` makes
--     (FR-2306, "the audit its subject cannot erase") pointed the other way:
--     there the operator cannot erase evidence about themselves, here they
--     cannot erase evidence about the product.
--
--     The cost of that choice is real and is accepted: removing a note — a
--     child who wrote something and regrets it, a retention obligation, a
--     third party named in passing — is a `ainext_maint` job done by a human
--     who decided to do it, not a button somebody can reach while annoyed.
--
--   * `ainext_maint` is BYPASSRLS (017) and holds ALL PRIVILEGES, which is
--     what makes the paragraph above possible rather than merely strict.
--
-- Migration 017 opens with `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM
-- ainext_app, ainext_operator`, so on a re-run of the whole directory these
-- grants are stripped by 017 and restored here, in order — the same ordering
-- contract 023 relies on, and it is only safe because 025 sorts after 017 and
-- always runs.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS feedback (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Constitution XI: no fact about one stack may leak into another. "Did the
  -- students like it" is exactly the kind of figure somebody would otherwise
  -- pool across the frozen baseline and the comparison build and then quote as
  -- one number about neither.
  environment   text        NOT NULL,

  student_id    bigint      NOT NULL REFERENCES students(id),

  -- The sitting this followed. Nullable on FR-2309's rule; unique per student
  -- when present, which is what makes "never twice for one sitting" structural.
  session_ref   bigint      REFERENCES sessions(id),

  -- The lesson, when there was one. NULL for the practice loop, which has a
  -- plan rather than a lesson. **Derived server-side from `sessions.lo_id`**
  -- and never taken from a request body — the endpoint's whole payload is a
  -- moment, a thumb and a note, which is what keeps it impossible for a
  -- client to file its feedback against somebody else's lesson.
  --
  -- Deliberately the slug and NOT a foreign key to `graph_nodes`: a lesson is
  -- not a node in this schema (it is the prefix shared by a run of
  -- `learning_objective` ids — `lib/lesson.ts`'s `slugOfLo`), and even if it
  -- were, the feedback is about what the child experienced and must stay
  -- readable after a curriculum reload renames or removes the objectives.
  lesson_slug   text,

  -- Which course the sitting was in, so the console can answer "is the maths
  -- going better than the Arabic". Resolved once, at write time, by walking
  -- `sessions.lo_id` up through `teaches` and `part_of` to the course node.
  --
  -- **Stored rather than joined at read time, and that is the same argument
  -- `lesson_slug` makes.** The graph is reloadable: an extraction run can
  -- replace every objective id, at which point a read-time join would lose the
  -- subject of every note ever written. Denormalising one text column is the
  -- cheap way for a row to keep meaning what it meant. No foreign key, for
  -- migration 023's reason — a course id is a product fact that can outlive,
  -- or predate, any content behind it.
  course_id     text,

  -- Which of the three moments asked. `long_session` outranks the other two
  -- when the sitting ran long — see `app/src/lib/feedback-rules.ts`, which is
  -- where the precedence is decided and tested.
  trigger_kind  text        NOT NULL
                CHECK (trigger_kind IN ('lesson_completed','session_ended','long_session')),

  -- The whole interaction, when she presses one and stops there. NULL means
  -- she closed the prompt without answering — a different fact, and one we are
  -- required to remember so she is not asked again tomorrow.
  rating        text        CHECK (rating IN ('up','down')),

  -- A child's own words. See the header; this is the column the rest of the
  -- file is about.
  note          text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  -- Set when the note lands after the thumb. Equal to `created_at` until then,
  -- so "was this edited" is answerable without a second table.
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT feedback_note_needs_rating
    CHECK (note IS NULL OR rating IS NOT NULL),
  CONSTRAINT feedback_note_length
    CHECK (note IS NULL OR char_length(note) <= 600)
);

-- `trigger_kind` rather than `trigger`: TRIGGER is a keyword in every SQL
-- dialect this schema might ever be read by, and a column that needs quoting
-- in half the places it is written is a column that will eventually be written
-- wrong in the other half.
COMMENT ON TABLE feedback IS
  'The student''s own verdict on the product: a thumb, an optional note, and '
  'which of three moments asked. One row per sitting. NEVER reaches a model '
  '(app/src/lib/feedback-isolation.test.mts). Nothing classifies the note '
  'automatically — the human path is the console surface, see migration 025.';

COMMENT ON COLUMN feedback.note IS
  'Free text written by a minor. Read by operators on /feedback and the '
  'Student 360 and by nobody else; never in a prompt, a snapshot or the ask '
  'data block. No keyword scan, no classifier, no safety_flags row is derived '
  'from it — deliberately, and migration 025''s header says why.';

COMMENT ON COLUMN feedback.rating IS
  'up | down, or NULL when the student dismissed the prompt without answering. '
  'NULL is a recorded fact, not a missing one: it is what stops her being '
  'asked again for the next fortnight (lib/feedback-rules.ts).';

-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------

-- One answer per sitting. Also the ON CONFLICT target the endpoint upserts
-- through, which is how the thumb and the note that follows it become one row
-- instead of two.
CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_one_per_session
  ON feedback (environment, student_id, session_ref)
  WHERE session_ref IS NOT NULL;

-- The console's global list: newest first, within one environment.
CREATE INDEX IF NOT EXISTS idx_feedback_recent
  ON feedback (environment, created_at DESC);

-- Two readers: the Student 360 panel, and the cadence rule asking "when was
-- this student last asked anything". Both are (student, time desc).
CREATE INDEX IF NOT EXISTS idx_feedback_student_time
  ON feedback (student_id, created_at DESC);

-- No partial index on `note IS NOT NULL`, although the console's default view
-- is the notes. At pilot volume the whole table is a few hundred rows and the
-- planner reads it either way; an index chosen for a query shape that has run
-- twice is a guess that has to be maintained.

-- ---------------------------------------------------------------------------
-- 3. Grants and RLS (see the header for what each one does and does not permit)
-- ---------------------------------------------------------------------------

-- Start from nothing, so this file is the authority on who may touch this
-- table and a grant deleted from here disappears on the next run (017's rule,
-- and 023's application of it to a table it created itself).
REVOKE ALL ON feedback FROM ainext_app, ainext_operator;

GRANT SELECT, INSERT, UPDATE ON feedback TO ainext_app;
-- READ ONLY, on purpose. The header's "GRANTS" section is the argument.
GRANT SELECT                 ON feedback TO ainext_operator;
GRANT ALL PRIVILEGES         ON feedback TO ainext_maint;

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback FORCE  ROW LEVEL SECURITY;

-- The 017 idiom, verbatim: `true` so an unset setting is NULL rather than an
-- error, `nullif` so the empty string a reset leaves behind does not fail the
-- cast, and `student_id = NULL` being NULL rather than true is what makes NO
-- PRINCIPAL MEAN NO ROWS. Nothing reads this table before sign-in, so there is
-- no unprincipled window to reason about.
DROP POLICY IF EXISTS feedback_app_select ON feedback;
CREATE POLICY feedback_app_select ON feedback FOR SELECT TO ainext_app
  USING (student_id = nullif(current_setting('app.student_id', true), '')::bigint);

DROP POLICY IF EXISTS feedback_app_insert ON feedback;
CREATE POLICY feedback_app_insert ON feedback FOR INSERT TO ainext_app
  WITH CHECK (student_id = nullif(current_setting('app.student_id', true), '')::bigint);

-- USING *and* WITH CHECK: the first decides which row may be updated, the
-- second decides what it may be updated INTO. Without the second, an UPDATE
-- could move a row onto another student's id — the row would leave the
-- policy's view on the way out, which is precisely the shape of a bug that
-- reads as "the row vanished" rather than as "isolation failed".
DROP POLICY IF EXISTS feedback_app_update ON feedback;
CREATE POLICY feedback_app_update ON feedback FOR UPDATE TO ainext_app
  USING      (student_id = nullif(current_setting('app.student_id', true), '')::bigint)
  WITH CHECK (student_id = nullif(current_setting('app.student_id', true), '')::bigint);

-- FOR SELECT, not FOR ALL. Every other operator policy in 017 and 023 is
-- `FOR ALL … USING (true)`; this one is deliberately narrower, and the grant
-- above is narrower still. Two independent refusals for the same act, because
-- one of them is a habit.
DROP POLICY IF EXISTS feedback_operator ON feedback;
CREATE POLICY feedback_operator ON feedback FOR SELECT TO ainext_operator
  USING (true);

-- ainext_maint is BYPASSRLS (017), so it needs no policy; the absence of one
-- is why no other role reaches this table even by accident.

-- ---------------------------------------------------------------------------
-- 4. Verification — asserted, not assumed (the argument 020/021/022/023/024 make)
-- ---------------------------------------------------------------------------

DO $verify$
DECLARE
  note_check text;
BEGIN
  IF to_regclass('public.feedback') IS NULL THEN
    RAISE EXCEPTION 'the feedback table was not created';
  END IF;

  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'public.feedback'::regclass) THEN
    RAISE EXCEPTION
      'feedback needs ENABLE *and* FORCE row level security — without FORCE '
      'the owner reads every child''s words, which is the one thing this '
      'table''s grants are arranged to prevent';
  END IF;

  -- The student surface must be able to answer, to record a dismissal, and to
  -- attach a note to the thumb it already wrote. Any one missing turns the
  -- prompt into a control that does nothing.
  IF NOT has_table_privilege('ainext_app', 'feedback', 'SELECT')
     OR NOT has_table_privilege('ainext_app', 'feedback', 'INSERT')
     OR NOT has_table_privilege('ainext_app', 'feedback', 'UPDATE') THEN
    RAISE EXCEPTION
      'ainext_app cannot read, write or amend feedback — the prompt would '
      'render and then fail silently at the moment a student answered it';
  END IF;

  IF has_table_privilege('ainext_app', 'feedback', 'DELETE') THEN
    RAISE EXCEPTION
      'ainext_app can DELETE feedback — no student surface offers a delete '
      'control, so this privilege has no caller and can only be exercised by '
      'a bug';
  END IF;

  -- The operator can read every child's words. That is the feature.
  IF NOT has_table_privilege('ainext_operator', 'feedback', 'SELECT') THEN
    RAISE EXCEPTION
      'the console cannot read feedback — /feedback and the Student 360 panel '
      'would render empty, which reads as "nobody said anything"';
  END IF;

  -- …and can do nothing else to them. THIS is the assertion this file exists
  -- for: a child's own words about the product must not be editable or
  -- removable by the people the words are about.
  IF has_table_privilege('ainext_operator', 'feedback', 'INSERT')
     OR has_table_privilege('ainext_operator', 'feedback', 'UPDATE')
     OR has_table_privilege('ainext_operator', 'feedback', 'DELETE') THEN
    RAISE EXCEPTION
      'ainext_operator can write, change or delete feedback. It must hold '
      'SELECT and nothing else: an operator who can edit a note can change '
      'what a child said, and one who can delete it can make an uncomfortable '
      'note stop existing. Removing a row is a ainext_maint job a human '
      'decided to do, never a button on a console page.';
  END IF;

  -- One answer per sitting, enforced here rather than by whoever writes the
  -- next caller.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'idx_feedback_one_per_session'
  ) THEN
    RAISE EXCEPTION
      'the one-row-per-sitting index is missing — the prompt could then be '
      'answered twice for one session and the cadence rule would be the only '
      'thing standing between a child and being asked again';
  END IF;

  -- The cap is read rather than merely counted: a constraint that exists but
  -- permits an unbounded note would let the console meet a wall of text it is
  -- built to print in full.
  SELECT pg_get_constraintdef(oid) INTO note_check
    FROM pg_constraint WHERE conname = 'feedback_note_length';
  IF note_check IS NULL OR note_check NOT LIKE '%600%' THEN
    RAISE EXCEPTION
      'feedback_note_length is missing or no longer says 600 — found: %',
      coalesce(note_check, '(no constraint)');
  END IF;

  RAISE NOTICE
    'feedback: ready — % row(s), of which % carry a note and % were dismissals',
    (SELECT count(*) FROM feedback),
    (SELECT count(*) FROM feedback WHERE note IS NOT NULL),
    (SELECT count(*) FROM feedback WHERE rating IS NULL);
END
$verify$;

COMMIT;
