-- Prototype: Socratic wrong-answer probing (Route B + Option 1),
-- branch wip/socratic-probing-route-b. NOT yet ruled on by Samuel (see the
-- open grounding question in that branch's brief) — this column only makes
-- the probe cycle reconstructible from `attempts`, it does not itself decide
-- the open question.
--
-- Links a confirmation-retry attempt back to the attempt it is confirming
-- (the wrong answer that put the LO into confirmation-pending, or the prior
-- retry in the same cycle if it took more than one). `stance_used = 'probe'`
-- (no CHECK constraint on that column — see its origin, migration 009) tags
-- every attempt taken during a probe cycle regardless of outcome; this column
-- is the edge between them, not just a second tag for the same fact.
--
-- Mastery is untouched by this migration and by the feature it supports:
-- every probe-cycle attempt still writes `mastery`/`attempts` exactly as
-- before (bkt.ts, api/attempts/route.ts) — this column is read-side only,
-- for analytics and for the client to reconstruct pending state on reload.
--
-- Idempotent — safe to re-run.

BEGIN;

ALTER TABLE attempts ADD COLUMN IF NOT EXISTS retry_of_attempt_id BIGINT REFERENCES attempts(id);

COMMENT ON COLUMN attempts.retry_of_attempt_id IS
  'Socratic-probing prototype (wip/socratic-probing-route-b): the attempt this one is a confirmation-retry of, when stance_used = ''probe''. NULL for every ordinary attempt.';

CREATE INDEX IF NOT EXISTS idx_attempts_retry_of
  ON attempts(retry_of_attempt_id) WHERE retry_of_attempt_id IS NOT NULL;

COMMIT;
