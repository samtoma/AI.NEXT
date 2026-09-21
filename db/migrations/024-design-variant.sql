-- ===========================================================================
-- 024 — the design-system variant override: WHICH SKIN A PERSON GETS
--
-- ADR-0017 (Accepted, Samuel, 2026-09-20), FR-1011. Additive and idempotent.
-- Safe to re-run; `scripts/local-dev.sh` does, on every run, in filename order.
-- ===========================================================================
--
-- WHAT THIS IS FOR. The published design system has two variants over one
-- semantic token set — **Play** (ages 10–16) and **Master** (15–18) — and the
-- product picks one per page render. The KEY IS GRADE: Preparatory → Play,
-- Secondary → Master, with Play as the answer whenever the grade is unknown.
-- That rule needs no storage at all; it is arithmetic over a column that has
-- been in `students` since the first migration. What needs storage is the
-- EXCEPTION, and these two columns are it.
--
-- WHY THE OVERRIDE IS A COLUMN AND NOT BROWSER STORAGE. ADR-0017 is explicit:
-- the override is "stored server-side against the student, not in browser
-- storage, and it survives sign-out — a student who chose the other skin finds
-- it again on the next device and the next session". Two reasons, and the
-- second is the load-bearing one:
--
--   * A preference kept in `localStorage` is lost on the school computer, on a
--     borrowed phone, and the first time a browser clears site data. A
--     fifteen-year-old who deliberately moved herself to the restrained skin
--     and finds the cartoon one again on her sister's tablet has been told
--     that the setting does not really exist.
--   * The variant must be resolved **before first paint**, server-side, and
--     carried on the document element. A value the server cannot see cannot be
--     in the first HTML response, so a browser-stored override could only be
--     applied after hydration — which is exactly the visible skin flip
--     ADR-0017 calls "a defect, not a loading state". The storage location and
--     the no-flip property are the same decision.
--
-- WHY NULL MEANS "FOLLOW THE RULE", AND WHY THAT IS NOT THE SAME AS 'play'.
-- Both columns are nullable and NULL is the overwhelmingly common state: it
-- means nobody has expressed a preference, so the grade rule decides. An
-- override that happens to say `play` is a different fact — it is a Secondary
-- student who CHOSE the younger variant — and it must survive somebody later
-- correcting her grade. Collapsing the two would make "clear my override" and
-- "set my override to the value the rule would have given me" indistinguish-
-- able, and the first of those is a thing a person genuinely wants to do.
-- There is deliberately no third enum value meaning "defer": a missing value
-- already means exactly that, and a second spelling of one fact is how
-- `lib/design-variant.ts` would acquire a branch for a value meaning "ignore
-- me" (the argument migration 023 makes about `student_course_access`).
--
-- WHY THE CHECK CONSTRAINT IS WORTH HAVING when the application already
-- narrows the value (`asDesignVariant`, `lib/design-variant.ts`): the column's
-- value ends up verbatim in an HTML attribute that selects a stylesheet block.
-- A third value would match NEITHER `[data-ds="play"]` NOR `[data-ds="master"]`
-- in `app/src/app/globals.css`, and the document would render the frozen
-- baseline's Ledger identity — the one appearance that is supposed to mean "no
-- variant was chosen at all". A bad row would not look like an error; it would
-- look like a design decision somebody else made.
--
-- WHY `operators` GETS THE SAME COLUMN. Constitution XII binds every surface
-- this repository builds, the console included. The console is skinned, and
-- its default is **Master** rather than Play — an operator tool is not a
-- children's surface, and nobody on `/students` or `/cost` has a grade for the
-- rule to read. The column is that operator's own preference about their own
-- console, nothing more: it is not a fact about any student, it names nobody,
-- and no student surface can read it (`ainext_app` holds no privilege on
-- `operators` at all — migration 017, and the verify block below re-checks it).
--
-- ⚠ WHAT THIS MIGRATION DOES NOT MAKE TRUE. **Master's anatomy is not
-- published.** Its component guidelines, type scale and motion spec do not
-- exist yet; what exists is a colour theme. ADR-0017's Consequences say that
-- until that anatomy lands, no Secondary cohort should be onboarded — the
-- grade rule would route them to a half-specified variant. This file ships the
-- storage for the mechanism; it is not evidence that Master is finished.
--
-- NO BACKFILL, ON PURPOSE. Every existing row keeps NULL and therefore keeps
-- the appearance it has today: the pilot cohort is Prep 3, the rule sends Prep
-- 3 to Play, and Play is the skin those students are already looking at. A
-- migration that wrote `'play'` into every row would convert "the rule decided"
-- into "every student personally chose Play", which is a lie about a hundred
-- people's preferences and would then have to be undone student by student.
--
-- GRANTS, AND THE HONEST LIMIT OF EACH:
--
--   * `ainext_app` may UPDATE `students.design_variant` — it is the student's
--     own preference about her own screen, so unlike every other console-owned
--     column the student surface writes this one herself. Migration 017 gives
--     `ainext_app` table-level UPDATE on `students` already, so the column
--     grant below is redundant TODAY; it is written anyway so that this file
--     states the privilege the feature needs, and so narrowing 017's grant to
--     a column list later (as it already is for `ainext_operator`) does not
--     silently take the setting away. Which ROW she may write is not this
--     grant's business and never was: migration 017's `students_app_update`
--     policy scopes every student UPDATE to `current_setting('app.student_id')`,
--     so the database refuses another child's row rather than the WHERE clause.
--   * `ainext_operator` may UPDATE `operators.design_variant`. **Row scoping
--     here is the application's, not the database's, and that is stated rather
--     than glossed:** migration 017's `operators_operator_update` policy is
--     `USING (true)`, because the console must update ANY operator's lockout
--     bookkeeping during a sign-in that has no principal yet. The endpoint
--     therefore writes `WHERE id = $1` with an id taken from `authorize()` and
--     never from a request body (`api/console/profile/appearance/route.console.ts`).
--     The blast radius if that were ever got wrong is one colleague's console
--     colours, which is why this is an acceptable place for the weaker
--     guarantee and `students` is not.
--   * `ainext_maint` inherits ALL PRIVILEGES from 017 and is granted nothing
--     new here.
--
-- Note the ordering contract this shares with 023: migration 017 opens with
-- `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ainext_app, ainext_operator`,
-- so on a re-run of the whole directory these grants are stripped by 017 and
-- restored here, in order. This file **does not revoke anything** — unlike 023
-- it adds columns to tables 017 owns, and a `REVOKE ALL` aimed at "024's
-- grants" would be aimed at every other column's.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The student's own override
-- ---------------------------------------------------------------------------

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS design_variant TEXT;

-- DROP-then-ADD rather than `ADD CONSTRAINT IF NOT EXISTS` (which Postgres
-- does not have for table constraints): this is migration 015's idiom for the
-- same job, and it makes the file the authority on what the constraint says
-- rather than leaving an older spelling of it in place on a re-run.
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_design_variant_check;
ALTER TABLE students ADD CONSTRAINT students_design_variant_check
  CHECK (design_variant IS NULL OR design_variant IN ('play','master'));

COMMENT ON COLUMN students.design_variant IS
  'play | master, or NULL for "follow the grade rule" (ADR-0017, FR-1011). '
  'The student''s own choice, written by the student surface and by nobody '
  'else; it wins over the Preparatory/Secondary rule whenever it is set. It '
  'is a presentation preference, not a fact about the student: nothing in '
  'retrieval, selection, mastery, cost or analytics may read it.';

-- ---------------------------------------------------------------------------
-- 2. The operator's own console preference
-- ---------------------------------------------------------------------------

ALTER TABLE operators
  ADD COLUMN IF NOT EXISTS design_variant TEXT;

ALTER TABLE operators DROP CONSTRAINT IF EXISTS operators_design_variant_check;
ALTER TABLE operators ADD CONSTRAINT operators_design_variant_check
  CHECK (design_variant IS NULL OR design_variant IN ('play','master'));

COMMENT ON COLUMN operators.design_variant IS
  'play | master, or NULL for the console default, which is master — an '
  'operator tool is not a children''s surface and no operator has a grade '
  'for the rule to read (ADR-0017, FR-1011). One operator''s preference '
  'about their own console; it is not a fact about any student.';

-- ---------------------------------------------------------------------------
-- 3. Grants (see the header for what each one does and does not guarantee)
-- ---------------------------------------------------------------------------

GRANT UPDATE (design_variant) ON students  TO ainext_app;
GRANT UPDATE (design_variant) ON operators TO ainext_operator;

-- ---------------------------------------------------------------------------
-- 4. Verification — asserted, not assumed (the argument 020/021/022/023 make)
-- ---------------------------------------------------------------------------

DO $verify$
DECLARE
  student_check  text;
  operator_check text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'students'
       AND column_name = 'design_variant'
  ) THEN
    RAISE EXCEPTION 'students.design_variant was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'operators'
       AND column_name = 'design_variant'
  ) THEN
    RAISE EXCEPTION 'operators.design_variant was not created';
  END IF;

  -- Nullable is the DESIGN, not an oversight: NULL is "follow the rule", and
  -- it is the state every existing row is in. A NOT NULL default would have
  -- recorded a preference nobody expressed.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name IN ('students','operators')
       AND column_name = 'design_variant'
       AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION
      'design_variant must stay nullable — NULL is "follow the grade rule", '
      'which is not the same fact as an override that happens to say play';
  END IF;

  -- The constraint text is read rather than merely counted: a constraint that
  -- exists but permits a third value would let a row through that renders as
  -- the frozen baseline's identity on a child's screen (see the header).
  SELECT pg_get_constraintdef(oid) INTO student_check
    FROM pg_constraint WHERE conname = 'students_design_variant_check';
  SELECT pg_get_constraintdef(oid) INTO operator_check
    FROM pg_constraint WHERE conname = 'operators_design_variant_check';

  IF student_check IS NULL OR operator_check IS NULL THEN
    RAISE EXCEPTION 'a design_variant CHECK constraint is missing';
  END IF;
  IF student_check NOT LIKE '%play%' OR student_check NOT LIKE '%master%'
     OR operator_check NOT LIKE '%play%' OR operator_check NOT LIKE '%master%' THEN
    RAISE EXCEPTION
      'a design_variant CHECK does not name both variants — students: %, operators: %',
      student_check, operator_check;
  END IF;

  -- The student must be able to change her own skin, or the setting is a
  -- control that does nothing.
  IF NOT has_column_privilege('ainext_app', 'students', 'design_variant', 'UPDATE') THEN
    RAISE EXCEPTION
      'ainext_app cannot write students.design_variant — the student''s own '
      'preference would be unsettable from the only surface she has';
  END IF;

  -- …and must be able to read it back, or "resolved before first paint" has
  -- nothing to resolve from.
  IF NOT has_column_privilege('ainext_app', 'students', 'design_variant', 'SELECT') THEN
    RAISE EXCEPTION 'ainext_app cannot read students.design_variant';
  END IF;

  IF NOT has_column_privilege('ainext_operator', 'operators', 'design_variant', 'UPDATE')
     OR NOT has_column_privilege('ainext_operator', 'operators', 'design_variant', 'SELECT') THEN
    RAISE EXCEPTION 'the console cannot read or set its own operator''s variant';
  END IF;

  -- Migration 017's rule, re-checked from this side: a student principal must
  -- not learn that operators exist, and a new column is exactly the kind of
  -- change that quietly grants a whole table.
  IF has_table_privilege('ainext_app', 'operators', 'SELECT')
     OR has_column_privilege('ainext_app', 'operators', 'design_variant', 'SELECT') THEN
    RAISE EXCEPTION
      'ainext_app can read operators — migration 017 gives the student role no '
      'privilege on that table at all, and 024 must not have widened it';
  END IF;

  RAISE NOTICE
    'design variant: ready — % student override(s), % operator preference(s); '
    'every other row follows the grade rule',
    (SELECT count(*) FROM students  WHERE design_variant IS NOT NULL),
    (SELECT count(*) FROM operators WHERE design_variant IS NOT NULL);
END
$verify$;

COMMIT;
