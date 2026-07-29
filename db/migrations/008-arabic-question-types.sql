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
-- Idempotent — safe to re-run.

BEGIN;

ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_question_type_check;
ALTER TABLE questions ADD CONSTRAINT questions_question_type_check
  CHECK (question_type IN ('mcq', 'numeric', 'short',
                           'irab', 'extract', 'lexical', 'rhetoric', 'spelling_fix'));

COMMIT;
