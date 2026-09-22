-- Constitution v3.1.1 Principle XI (ADR-0007, ADR-0010): every row says which
-- environment produced it.
--
-- Ten tables hold student-scoped data. Two of them — `analytics_events` and
-- `ai_interactions` — have carried `environment` since migration 009, because
-- those are the two the comparison reports from. The other eight never got it,
-- so a row in `attempts` or `mastery` cannot say which build wrote it. That is
-- survivable only while one build exists; it stops being survivable the moment
-- the comparison is read, because a metric that cannot be split by environment
-- is a metric that has quietly been pooled (data-model.md §13, FR-2109).
--
-- DEFAULT 'mvp1' rather than 'baseline'. Migration 011 chose 'baseline' for
-- `sessions` for a good reason — it matches lib/env.ts, whose unconfigured
-- default is the frozen stack — and this file deliberately does NOT change it
-- (the `ADD COLUMN IF NOT EXISTS` below is a no-op on `sessions` and is kept
-- only so the set of eight reads as one list). For the other seven the default
-- is 'mvp1' because THESE MIGRATIONS EXIST ON THIS BRANCH AND NOWHERE ELSE
-- (ADR-0010): a row written into a database that has run 012 was, by
-- construction, written by the PDR1-0 build. Nothing on `family-tutor` ever
-- sees this file.
--
-- The backfill is the ADD COLUMN itself: a NOT NULL DEFAULT fills every
-- existing row in one pass. The explicit UPDATEs below exist for the one case
-- the ADD cannot cover — a column added by hand, nullable, before this file was
-- applied — and report zero on every normal run. `sessions` keeps whatever
-- value 011's backfill derived from the source rows; guessing 'mvp1' over a
-- value that was derived from evidence would be replacing a fact with a
-- default.
--
-- Idempotent — safe to re-run.

BEGIN;

ALTER TABLE students             ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'mvp1';
ALTER TABLE attempts             ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'mvp1';
ALTER TABLE mastery              ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'mvp1';
ALTER TABLE safety_flags         ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'mvp1';
ALTER TABLE uploads              ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'mvp1';
ALTER TABLE understanding_checks ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'mvp1';
ALTER TABLE explanation_log      ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'mvp1';

-- Already added by 011, with DEFAULT 'baseline' and a backfill from the source
-- rows. This line is a deliberate no-op: the eighth table of the eight.
ALTER TABLE sessions             ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'baseline';

DO $attribution$
DECLARE
  t    TEXT;
  n    INT;
  tot  INT := 0;
BEGIN
  -- Only reachable if the column pre-existed as nullable. A normal run prints
  -- nothing but the summary zero.
  FOREACH t IN ARRAY ARRAY['students','attempts','mastery','safety_flags',
                           'uploads','understanding_checks','explanation_log','sessions']
  LOOP
    EXECUTE format('UPDATE %I SET environment = ''mvp1'' WHERE environment IS NULL', t);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      RAISE NOTICE 'environment: backfilled % row(s) in %', n, t;
      tot := tot + n;
    END IF;

    -- A NULL must not be reachable again once the column exists: a forgotten
    -- INSERT has to fail, not produce an unattributable row (FR-2509).
    EXECUTE format('ALTER TABLE %I ALTER COLUMN environment SET NOT NULL', t);
  END LOOP;

  RAISE NOTICE 'environment: % row(s) repaired across the eight student-scoped tables', tot;
END
$attribution$;

COMMIT;
