-- Arabic vertical (ADR-0006), Wave B: the question-type CHECK learns the five
-- typed Arabic answer kinds. The value set mirrors `QuestionType` in
-- services/extraction/schemas.py — the Pydantic layer is the authority; this
-- constraint is the DB-side echo (same convention as migration 007 §4).
--
-- `correct_answer` stays TEXT: Arabic typed answers are stored in it as
-- tagged JSON ({"type":"irab", …slots}) written by load_seed.correct_answer_text
-- and parsed by the app per question_type. The slot grader lives in
-- app/src/lib/irab.ts.
--
-- Idempotent — safe to re-run, and it must NOT undo a later widening.
-- Migration 010 widens this same constraint with 'widget'. Every deploy
-- re-applies every migration, so an unconditional drop-and-re-add here
-- rebuilt the narrower 008 list on top of 010's. That was harmless while no
-- widget question existed, and it failed the moment one did (2026-09-23: the
-- migration refused, and the site stayed down until this guard). So the
-- constraint is rebuilt only when it does not yet accept the values this
-- migration introduces.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'questions'::regclass
       AND conname = 'questions_question_type_check'
       AND pg_get_constraintdef(oid) LIKE '%spelling_fix%'
  ) THEN
    ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_question_type_check;
    ALTER TABLE questions ADD CONSTRAINT questions_question_type_check
      CHECK (question_type IN ('mcq', 'numeric', 'short',
                               'irab', 'extract', 'lexical', 'rhetoric', 'spelling_fix'));
  END IF;
END $$;

COMMIT;
