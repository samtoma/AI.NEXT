-- ===========================================================================
-- 038 DOWN — a family's parent is a book question again
--
-- Undoes `db/migrations/038-family-teaching-parent.sql`. Idempotent: safe to run
-- when 038 is already undone, and safe to run twice.
--
-- ORDER: deploy a build that does not read or write `questions.parent_kind`
-- FIRST (the loaders and the export write it, the console's review gate reads
-- it), then run this.
--
-- REFUSES, rather than loses data, while any question is modelled on a book
-- teaching item (`parent_kind = 'teaching'`): the foreign key this restores can
-- only point at a question, so such a row has nowhere to go. Retire and delete
-- those questions (or re-point them at a question parent) and run it again.
--
-- WHAT IS RESTORED: `questions.parent_question_id REFERENCES questions(id)`,
-- exactly as db/schema.sql declares it, and its name. WHAT IS REMOVED: the
-- `parent_kind` column and its two CHECKs, the three constraint triggers and
-- their functions. Nothing else is touched; no row changes (every existing row
-- was `question` before and after).
-- ===========================================================================

BEGIN;

DO $down$
DECLARE
  teaching int;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'questions'
                AND column_name = 'parent_kind') THEN
    EXECUTE $c$SELECT count(*) FROM questions WHERE parent_kind = 'teaching'$c$ INTO teaching;
    IF teaching > 0 THEN
      RAISE EXCEPTION
        '038 down refused: % question(s) are modelled on a book teaching item; the restored foreign key could '
        'not hold them. Retire and delete them (or give them a question parent), then run this again.', teaching;
    END IF;
  END IF;
END
$down$;

DROP TRIGGER IF EXISTS explanation_teaching_parent_kept ON explanation_library;
DROP TRIGGER IF EXISTS questions_parent_not_orphaned ON questions;
DROP TRIGGER IF EXISTS questions_parent_exists ON questions;
DROP FUNCTION IF EXISTS explanation_teaching_parent_kept();
DROP FUNCTION IF EXISTS questions_parent_not_orphaned();
DROP FUNCTION IF EXISTS questions_parent_exists();

DO $fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.questions'::regclass
                    AND conname = 'questions_parent_question_id_fkey') THEN
    ALTER TABLE questions ADD CONSTRAINT questions_parent_question_id_fkey
      FOREIGN KEY (parent_question_id) REFERENCES questions(id);
  END IF;
END
$fk$;

ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_teaching_parent_named;
ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_parent_kind_check;
ALTER TABLE questions DROP COLUMN IF EXISTS parent_kind;
COMMENT ON COLUMN questions.parent_question_id IS NULL;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'questions'
                AND column_name = 'parent_kind') THEN
    RAISE EXCEPTION 'questions.parent_kind still exists after 038 DOWN';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.questions'::regclass
                    AND conname = 'questions_parent_question_id_fkey') THEN
    RAISE EXCEPTION 'the parent foreign key was not restored by 038 DOWN';
  END IF;
  RAISE NOTICE '038 down: parent_kind removed; parent_question_id references questions(id) again';
END
$verify$;

COMMIT;
