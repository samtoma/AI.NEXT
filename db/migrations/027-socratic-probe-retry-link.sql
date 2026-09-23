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
--
-- RE-RUN TAKES NO LOCK ON `attempts`. Every deploy re-applies this file while
-- the previous app is still grading answers, and `attempts` is the hottest
-- table there is. `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` takes ACCESS
-- EXCLUSIVE even when the column is already there, and `CREATE INDEX IF NOT
-- EXISTS` takes SHARE (which blocks every INSERT) before it notices the index
-- exists — queued behind one long transaction, either stalls every answer on
-- the site. So each piece is added only when the catalogue says it is
-- missing: the first deploy pays one brief lock per piece, every later deploy
-- pays none. The FK is matched by what it does (this column, referencing
-- `attempts`, ON DELETE SET NULL), not by its name, and one that exists
-- without SET NULL is replaced.

BEGIN;

DO $add$
DECLARE
  col_attnum smallint;
  fk record;
  want_comment text :=
    'Socratic-probing prototype (507bb31, migration 027): the attempt this one is a confirmation-retry of, when stance_used = ''probe''. NULL for every ordinary attempt, and for every attempt while SOCRATIC_PROBING_ENABLED is false.';
BEGIN
  -- 1. The column.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'attempts'
       AND column_name = 'retry_of_attempt_id'
  ) THEN
    ALTER TABLE attempts ADD COLUMN retry_of_attempt_id BIGINT;
  END IF;

  SELECT attnum INTO col_attnum FROM pg_attribute
   WHERE attrelid = 'public.attempts'::regclass
     AND attname = 'retry_of_attempt_id' AND NOT attisdropped;

  -- 2. The self-reference, ON DELETE SET NULL. Any FK on this one column that
  --    does something else (a hand-made one, or 011's bare REFERENCES) is
  --    dropped so the right one can replace it.
  FOR fk IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.attempts'::regclass AND contype = 'f'
       AND conkey = ARRAY[col_attnum]
       AND NOT (confrelid = 'public.attempts'::regclass AND confdeltype = 'n')
  LOOP
    EXECUTE format('ALTER TABLE attempts DROP CONSTRAINT %I', fk.conname);
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.attempts'::regclass AND contype = 'f'
       AND conkey = ARRAY[col_attnum]
       AND confrelid = 'public.attempts'::regclass AND confdeltype = 'n'
  ) THEN
    ALTER TABLE attempts
      ADD CONSTRAINT attempts_retry_of_attempt_id_fkey
      FOREIGN KEY (retry_of_attempt_id) REFERENCES attempts(id) ON DELETE SET NULL;
  END IF;

  -- 3. The partial index, for "the retries of this attempt".
  IF to_regclass('public.idx_attempts_retry_of') IS NULL THEN
    CREATE INDEX idx_attempts_retry_of
      ON attempts(retry_of_attempt_id) WHERE retry_of_attempt_id IS NOT NULL;
  END IF;

  -- 4. The comment — rewritten only when it differs, so it too costs nothing
  --    on a re-run and still converges when this text is edited.
  IF col_description('public.attempts'::regclass, col_attnum)
       IS DISTINCT FROM want_comment THEN
    EXECUTE format('COMMENT ON COLUMN attempts.retry_of_attempt_id IS %L', want_comment);
  END IF;
END
$add$;

DO $verify$
BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'public.attempts'::regclass) THEN
    RAISE EXCEPTION
      'attempts is not ENABLE + FORCE row level security — migration 017 must '
      'have run first; this column must not land on an unprotected table';
  END IF;
  IF (SELECT count(*) FROM pg_constraint c
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
       WHERE c.conrelid = 'public.attempts'::regclass AND c.contype = 'f'
         AND a.attname = 'retry_of_attempt_id') <> 1 THEN
    RAISE EXCEPTION
      'attempts.retry_of_attempt_id must carry exactly one foreign key';
  END IF;
  IF to_regclass('public.idx_attempts_retry_of') IS NULL THEN
    RAISE EXCEPTION 'idx_attempts_retry_of is missing';
  END IF;
END
$verify$;

COMMIT;
