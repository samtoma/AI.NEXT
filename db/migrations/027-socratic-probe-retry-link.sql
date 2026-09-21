-- ===========================================================================
-- 027 — `attempts.retry_of_attempt_id`: the Socratic-probing retry link
--
-- Prototype: Socratic wrong-answer probing (Route B + Option 1), Tamer's
-- `507bb31`, first written as migration 011 on `wip/socratic-probing-route-b`
-- and renumbered to 027 when it was brought onto `main` (whose 011 is
-- learning sessions). NOT yet ruled on by Samuel — the feature it supports
-- ships behind `SOCRATIC_PROBING_ENABLED = false` (`app/src/lib/socratic-
-- probing.ts`), and while that is false nothing writes this column: the
-- attempt INSERT does not even name it.
--
-- Additive and idempotent. Safe to re-run; `scripts/local-dev.sh` does, on
-- every run, in filename order. Rollback: `rollback/027-socratic-probe-retry-
-- link.down.sql`.
-- ===========================================================================
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
-- before (bkt.ts, api/attempts/route.ts) — this column is read-side only.
--
-- ROW-LEVEL SECURITY: nothing new to do. `attempts` is already ENABLE + FORCE
-- with its per-student policies (migration 017), and a new column inherits
-- the table's policies and table-level grants. The route writes the link only
-- after reading the target attempt under the student's own principal, so a
-- link to another child's attempt is dropped rather than written (ADR-0012).
--
-- ON DELETE SET NULL, which 011 did not have: `services/extraction/
-- load_seed.py` deletes attempts for questions it replaces, and
-- `scripts/red-team-isolation.sh` deletes a probe student's attempts. A bare
-- self-reference would make either fail the day one retry pointed at a row it
-- was removing. A retry whose original is gone is still a retry.

BEGIN;

ALTER TABLE attempts
  ADD COLUMN IF NOT EXISTS retry_of_attempt_id BIGINT
  REFERENCES attempts(id) ON DELETE SET NULL;

COMMENT ON COLUMN attempts.retry_of_attempt_id IS
  'Socratic-probing prototype (507bb31, migration 027): the attempt this one is a confirmation-retry of, when stance_used = ''probe''. NULL for every ordinary attempt, and for every attempt while SOCRATIC_PROBING_ENABLED is false.';

CREATE INDEX IF NOT EXISTS idx_attempts_retry_of
  ON attempts(retry_of_attempt_id) WHERE retry_of_attempt_id IS NOT NULL;

DO $verify$
BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'public.attempts'::regclass) THEN
    RAISE EXCEPTION
      'attempts is not ENABLE + FORCE row level security — migration 017 must '
      'have run first; this column must not land on an unprotected table';
  END IF;
END
$verify$;

COMMIT;
