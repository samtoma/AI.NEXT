-- ADR-0009: an interactive widget is a question.
--
-- Three changes, all additive and idempotent.
--
-- 1. `question_type` learns 'widget'. The widget's kind, spec and diagnostic
--    predicates ride in `choices` — the same jsonb column that already carries
--    `misconception_id` per option for multiple choice, because a widget's
--    predicates ARE its distractors over a continuous answer space:
--
--      {"kind": "circle_builder",
--       "spec": {"element": "chord"},
--       "diagnostics": [
--         {"predicate": "ends-not-on-circle",
--          "misconception_id": "mc:geo1-1-2:chord-endpoints-off-circle"},
--         {"predicate": "chord-not-through-centre",
--          "misconception_id": "mc:geo1-1-2:chord-vs-diameter"}]}
--
--    `correct_answer` stays TEXT and holds the predicate that means "right"
--    (conventionally "ok"), mirroring migration 008's treatment of the typed
--    Arabic answers: the column keeps its type, the meaning is per question_type.
--
-- 2. `attempts.modality` separates widget evidence from question evidence.
--    Samuel's decision (ADR-0009 §1) is that widget attempts DO move BKT; this
--    column is what keeps that decision auditable, so every reported metric can
--    be recomputed with and without widgets and "did BKT do this, or did the
--    widgets?" stays answerable. Defaulting to 'question' backfills the 
--    existing rows correctly — everything recorded before this migration was a
--    question attempt.
--
-- 3. `questions.materialised_from` marks a row written by the app because a
--    student answered a model-composed inline widget, rather than by the
--    extraction pipeline. It holds the session id that produced it. Such rows
--    are always status='review' and reviewed_by=NULL: materialising is not
--    promotion (ADR-0009 §3).

BEGIN;

-- 1 ------------------------------------------------------------------
ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_question_type_check;
ALTER TABLE questions ADD CONSTRAINT questions_question_type_check
  CHECK (question_type IN ('mcq', 'numeric', 'short',
                           'irab', 'extract', 'lexical', 'rhetoric', 'spelling_fix',
                           'widget'));

-- 2 ------------------------------------------------------------------
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS modality text NOT NULL DEFAULT 'question';
ALTER TABLE attempts DROP CONSTRAINT IF EXISTS attempts_modality_check;
ALTER TABLE attempts ADD CONSTRAINT attempts_modality_check
  CHECK (modality IN ('question', 'widget'));

-- Every comparison metric is sliced by modality, so it is worth an index.
CREATE INDEX IF NOT EXISTS idx_attempts_modality
  ON attempts (modality, attempted_at);

-- 3 ------------------------------------------------------------------
ALTER TABLE questions ADD COLUMN IF NOT EXISTS materialised_from bigint;

-- A materialised row may never be born live. The selector must not serve one
-- student's improvised widget to the next student before a human has read it.
ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_materialised_not_live;
ALTER TABLE questions ADD CONSTRAINT questions_materialised_not_live
  CHECK (materialised_from IS NULL OR status <> 'live');

CREATE INDEX IF NOT EXISTS idx_questions_materialised
  ON questions (materialised_from) WHERE materialised_from IS NOT NULL;

COMMIT;
