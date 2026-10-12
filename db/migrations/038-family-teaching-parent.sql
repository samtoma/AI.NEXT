-- ===========================================================================
-- 038 — a generated family may be modelled on a book TEACHING item
--
-- Feature 003. Samuel's answer 40, 2026-10-01: a generated question family may
-- be modelled on a book teaching item, not only on a book question row. The
-- case that forced it is Chapter 8's `lo:g10m8s1-1-1` "Drawing figures from
-- coordinates": the book gave it six items, all drawings, and G2 made them
-- teaching-only (an answer that is a drawn figure cannot be marked), so the
-- objective has NO question row — and a family's parent had to be one
-- (`questions.parent_question_id REFERENCES questions(id)`, FR-1101).
--
-- Additive and idempotent. Safe to re-run; `deploy/apply-migrations.sh` does,
-- on every deploy, in filename order, while the previous app is still serving.
-- Rollback: `rollback/038-family-teaching-parent.down.sql`.
-- ===========================================================================
--
-- THE REPRESENTATION
--
--   questions.parent_question_id   unchanged: the id of the book item the row
--                                  was derived from (the column keeps its
--                                  name; renaming it would touch every reader
--                                  and every committed bundle for no gain)
--   questions.parent_kind          NEW. What that id names, EXPLICITLY:
--                                    'question'  a row of `questions`, id
--                                                `q:<lo tail>:<item>`
--                                                (the default: every row
--                                                that exists, every family
--                                                written before answer 40)
--                                    'teaching'  a worked example of
--                                                `explanation_library`, id
--                                                `expl:<lo tail>:<item>` — the
--                                                row a not-markable book item
--                                                becomes (assemble_lesson_
--                                                bundle.py, FR-4303)
--
-- The kind is stored, never inferred from the id's prefix: a reader that has
-- to guess is a reader that guesses wrong the day an id scheme changes, and
-- the spec and the bundle say it in the same words (`parent_kind`).
--
-- WHY A TRIGGER, NOT A SECOND FOREIGN KEY. Postgres has no either-or foreign
-- key: one column cannot reference two tables. The alternative, a second
-- nullable column `parent_teaching_id REFERENCES explanation_library(id)` with
-- an at-most-one CHECK, gives native FKs and no PL/pgSQL — and costs a second
-- column that every writer (the generator, the loader, export, restore) and
-- every reader (the console, three more) would carry in place of one id plus a
-- kind, and splits "what was this derived from?" across two columns for
-- ever. One id + one kind keeps the question answerable from one place.
--
-- WHAT THE FOREIGN KEY DID, AND WHAT TAKES ITS PLACE. The old FK did three
-- things; the three constraint triggers below do the same three, for either
-- kind, with the same error class (foreign_key_violation, SQLSTATE 23503):
--   1. a row naming a parent that does not exist is refused
--      (`questions_parent_exists`: AFTER INSERT / UPDATE OF the two columns);
--   2. a question that is somebody's parent cannot be deleted or renamed
--      (`questions_parent_not_orphaned`);
--   3. nor can a worked example that is somebody's parent
--      (`explanation_teaching_parent_kept` — new: there was no table for the
--      FK to guard on this side before).
-- They are CONSTRAINT triggers, AFTER ROW, DEFERRABLE INITIALLY IMMEDIATE: like
-- the FK they fire at the end of the statement, so a statement that deletes a
-- parent together with its children, or an UPDATE that sets the id and the
-- kind together (restore_course_bundle.py), sees the finished state, not the
-- middle of it.
--
-- A teaching parent must be a `worked_example` entry: that is what a book
-- teaching item is. A refutation, a faded example or a contrasting case is
-- the tutor's, not the book's.
--
-- WHAT IS NOT CHECKED HERE. That the parent is on the question's own
-- objective: the old FK never checked it either; the family spec does
-- (families/spec.py), and the loader reports a parent that is not there.
--
-- ---------------------------------------------------------------------------
-- EVERY EXISTING ROW IS UNCHANGED
-- ---------------------------------------------------------------------------
-- `parent_kind` defaults to 'question', which is exactly what every existing
-- row's parent is (or NULL, which is still no parent). No UPDATE, no backfill
-- statement. Postgres 11+ adds a NOT NULL column with a constant default
-- without rewriting the table.
--
-- ---------------------------------------------------------------------------
-- RE-RUN TAKES NO LOCK ON A HOT TABLE (030's rule)
-- ---------------------------------------------------------------------------
-- `questions` is read on every student turn. `ALTER TABLE ... ADD COLUMN IF
-- NOT EXISTS` and `DROP CONSTRAINT IF EXISTS` take ACCESS EXCLUSIVE even when
-- they find nothing to do, and `CREATE TRIGGER` takes SHARE ROW EXCLUSIVE, so
-- each is issued only when the catalogue says it is needed: the first deploy
-- pays one brief lock per piece, every later deploy pays none. CREATE OR
-- REPLACE FUNCTION and COMMENT take no lock a reader waits on and stay
-- unconditional. No grant changes: the new column is covered by 017's
-- table-level grants on `questions`, and the trigger functions run with the
-- invoking role's own rights, which already include SELECT on both tables.
-- The one write the student role makes to `questions` (a materialised widget,
-- app/src/app/api/attempts/route.ts) names no parent, so no trigger fires.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The kind
-- ---------------------------------------------------------------------------

DO $kind$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'questions'
                    AND column_name = 'parent_kind') THEN
    ALTER TABLE questions ADD COLUMN parent_kind TEXT NOT NULL DEFAULT 'question';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.questions'::regclass
                    AND conname = 'questions_parent_kind_check') THEN
    ALTER TABLE questions ADD CONSTRAINT questions_parent_kind_check
      CHECK (parent_kind IN ('question', 'teaching'));
  END IF;
  -- a teaching parent is a named one: the kind alone says nothing
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.questions'::regclass
                    AND conname = 'questions_teaching_parent_named') THEN
    ALTER TABLE questions ADD CONSTRAINT questions_teaching_parent_named
      CHECK (parent_kind = 'question' OR parent_question_id IS NOT NULL);
  END IF;
END
$kind$;

COMMENT ON COLUMN questions.parent_question_id IS
  'The book item this row was derived from (FR-1101): a row of questions when parent_kind = ''question'' '
  '(id q:…), a worked example of explanation_library when parent_kind = ''teaching'' (id expl:…). '
  'Existence is checked by the questions_parent_exists constraint trigger (migration 038), which '
  'replaced the foreign key to questions(id).';
COMMENT ON COLUMN questions.parent_kind IS
  'What parent_question_id names, stored and never inferred from the id: ''question'' (the default) '
  'or ''teaching'' — a book teaching item, for an objective whose book items are all teaching material '
  '(Samuel''s answer 40, 2026-10-01; migration 038).';

-- ---------------------------------------------------------------------------
-- 2. The checks the foreign key used to make, for both kinds
-- ---------------------------------------------------------------------------

-- A row's parent exists, in the table its kind names.
CREATE OR REPLACE FUNCTION questions_parent_exists() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.parent_kind = 'teaching' THEN
    IF NOT EXISTS (SELECT 1 FROM public.explanation_library e
                    WHERE e.id = NEW.parent_question_id AND e.entry_type = 'worked_example') THEN
      RAISE EXCEPTION
        'question %: its teaching parent % is not a worked example in explanation_library (migration 038)',
        NEW.id, NEW.parent_question_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.questions p WHERE p.id = NEW.parent_question_id) THEN
    RAISE EXCEPTION
      'question %: its parent question % does not exist (migration 038)',
      NEW.id, NEW.parent_question_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NULL;
END
$fn$;

-- A question that is somebody's parent is neither deleted nor renamed.
CREATE OR REPLACE FUNCTION questions_parent_not_orphaned() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id = OLD.id THEN
      RETURN NULL;
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.questions c
              WHERE c.parent_kind = 'question' AND c.parent_question_id = OLD.id) THEN
    RAISE EXCEPTION
      'question % is the parent of other questions and cannot be % (migration 038)',
      OLD.id, CASE TG_OP WHEN 'DELETE' THEN 'deleted' ELSE 'renamed' END
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NULL;
END
$fn$;

-- A worked example that is somebody's parent is neither deleted, renamed nor retyped.
CREATE OR REPLACE FUNCTION explanation_teaching_parent_kept() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id = OLD.id AND NEW.entry_type = OLD.entry_type THEN
      RETURN NULL;
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.questions c
              WHERE c.parent_kind = 'teaching' AND c.parent_question_id = OLD.id) THEN
    RAISE EXCEPTION
      'worked example % is the teaching parent of generated questions and cannot be changed that way (migration 038)',
      OLD.id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NULL;
END
$fn$;

DO $triggers$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.questions'::regclass AND tgname = 'questions_parent_exists') THEN
    CREATE CONSTRAINT TRIGGER questions_parent_exists
      AFTER INSERT OR UPDATE OF parent_question_id, parent_kind ON questions
      DEFERRABLE INITIALLY IMMEDIATE
      FOR EACH ROW WHEN (NEW.parent_question_id IS NOT NULL)
      EXECUTE FUNCTION questions_parent_exists();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.questions'::regclass AND tgname = 'questions_parent_not_orphaned') THEN
    CREATE CONSTRAINT TRIGGER questions_parent_not_orphaned
      AFTER DELETE OR UPDATE OF id ON questions
      DEFERRABLE INITIALLY IMMEDIATE
      FOR EACH ROW
      EXECUTE FUNCTION questions_parent_not_orphaned();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.explanation_library'::regclass
                    AND tgname = 'explanation_teaching_parent_kept') THEN
    CREATE CONSTRAINT TRIGGER explanation_teaching_parent_kept
      AFTER DELETE OR UPDATE OF id, entry_type ON explanation_library
      DEFERRABLE INITIALLY IMMEDIATE
      FOR EACH ROW
      EXECUTE FUNCTION explanation_teaching_parent_kept();
  END IF;
END
$triggers$;

-- ---------------------------------------------------------------------------
-- 3. The foreign key goes — only now that its replacements are in place
-- ---------------------------------------------------------------------------
-- (Same transaction: there is no moment at which a parent is unchecked.)

DO $fk$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.questions'::regclass
                AND conname = 'questions_parent_question_id_fkey') THEN
    ALTER TABLE questions DROP CONSTRAINT questions_parent_question_id_fkey;
  END IF;
END
$fk$;

-- ---------------------------------------------------------------------------
-- 4. Verification — asserted, not assumed
-- ---------------------------------------------------------------------------

DO $verify$
DECLARE
  bad int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'questions'
                    AND column_name = 'parent_kind' AND is_nullable = 'NO') THEN
    RAISE EXCEPTION 'questions.parent_kind is missing or nullable after 038';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.questions'::regclass
                AND conname = 'questions_parent_question_id_fkey') THEN
    RAISE EXCEPTION 'the old parent foreign key is still on questions after 038';
  END IF;
  IF (SELECT count(*) FROM pg_trigger
       WHERE NOT tgisinternal
         AND tgname IN ('questions_parent_exists', 'questions_parent_not_orphaned',
                        'explanation_teaching_parent_kept')) <> 3 THEN
    RAISE EXCEPTION 'the three parent constraint triggers are not all present after 038';
  END IF;
  -- nothing the foreign key allowed is now an orphan: every existing parent still exists
  SELECT count(*) INTO bad
    FROM questions c
   WHERE c.parent_question_id IS NOT NULL
     AND ((c.parent_kind = 'question'
           AND NOT EXISTS (SELECT 1 FROM questions p WHERE p.id = c.parent_question_id))
       OR (c.parent_kind = 'teaching'
           AND NOT EXISTS (SELECT 1 FROM explanation_library e
                            WHERE e.id = c.parent_question_id AND e.entry_type = 'worked_example')));
  IF bad > 0 THEN
    RAISE EXCEPTION '% question(s) name a parent that does not exist after 038', bad;
  END IF;
  RAISE NOTICE '038: parent_kind in place; every existing parent is a question and exists';
END
$verify$;

COMMIT;
