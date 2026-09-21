-- ===========================================================================
-- 024 DOWN — remove the design-variant override
--
-- Undoes `db/migrations/024-design-variant.sql`. Idempotent: safe to run when
-- the columns are already absent, and safe to run twice.
--
-- ⚠ THIS IS NOT THE WAY TO PUT EVERYBODY BACK ON ONE SKIN. If the intent is
-- "stop offering the choice", the cheap reversal is in the application: the
-- control comes off the two settings surfaces and `layout.tsx` stops reading
-- the column. The rule keeps working, every stored preference stays recorded,
-- and turning the choice back on is a revert rather than a re-migration and a
-- hundred students re-entering a setting. Run this file when the FEATURE is
-- being withdrawn, not when it is being paused.
--
-- ---------------------------------------------------------------------------
-- WHAT RUNNING THIS DOES TO THE PRODUCT
-- ---------------------------------------------------------------------------
-- It returns every person to the **grade rule with no exception available**:
-- Preparatory → Play, Secondary → Master, unknown → Play, and on the console
-- the fixed Master default. Nothing renders unskinned and no page breaks on
-- appearance grounds — `lib/design-variant.ts` answers with an override of
-- `null` exactly as it does for the overwhelming majority of rows today.
--
-- The application must be rolled back WITH it, in this order:
-- `lib/design-variant-queries.ts` selects these columns on the document path,
-- so a build from after 024 pointed at a database from before it raises
-- `column "design_variant" does not exist` on the ROOT LAYOUT — which is to
-- say on every page of both surfaces at once, not on one feature. Deploy the
-- application first, then drop.
--
-- ---------------------------------------------------------------------------
-- WHAT IS LOST, AND WHY IT IS SMALL BUT NOT NOTHING
-- ---------------------------------------------------------------------------
-- Every student who deliberately moved herself off the variant her grade
-- implies loses that choice, silently, and meets the other skin on her next
-- sign-in. There is no attempt, no mastery estimate, no conversation and
-- nothing a child produced in these two columns — it is a presentation
-- preference — but it IS a preference a person expressed about her own
-- screen, and re-deriving it is impossible because the only record of it is
-- the column being dropped. The population is small enough to keep:
--
--   pg_dump -t students -t operators --data-only <db> > 024-variants.sql
--
-- or, narrower and easier to read back:
--
--   psql <db> -c "\copy (SELECT id, design_variant FROM students \
--     WHERE design_variant IS NOT NULL) TO '024-student-variants.csv' CSV"
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FILE DELIBERATELY DOES NOT UNDO
-- ---------------------------------------------------------------------------
--   * **No role is dropped and no pre-024 privilege is revoked.** The three
--     roles are migration 017's and are shared by every table in the schema.
--     Dropping a column takes ITS OWN column-level grants with it, which is
--     exactly the right scope, so this file does no revoking at all. Note the
--     asymmetry that follows: `ainext_app`'s TABLE-level UPDATE on `students`
--     and `ainext_operator`'s on `operators` were never 024's to grant and
--     stay exactly as 017 left them.
--   * **No CHECK constraint is dropped separately** — `DROP COLUMN` takes the
--     constraint that references it, and naming it here as well would fail on
--     the second run for no benefit.
--   * **Nothing in `globals.css`.** `[data-ds="play"]` and `[data-ds="master"]`
--     are still the two named variants and the grade rule still selects
--     between them; only the stored exception is gone.
--   * **Nothing in `traceability.md`.** FR-1011's status is Samuel's to set,
--     not a migration's, in either direction.
-- ===========================================================================

BEGIN;

-- No CASCADE, deliberately: neither column is referenced by a view, an index
-- or a generated column (024 created none), so there is nothing to cascade
-- through. If a later migration added a dependant, this should fail loudly
-- rather than drop it silently.
ALTER TABLE students  DROP COLUMN IF EXISTS design_variant;
ALTER TABLE operators DROP COLUMN IF EXISTS design_variant;

-- ---------------------------------------------------------------------------
-- Verification — asserted, not assumed (the argument 020/021/022/023 make)
-- ---------------------------------------------------------------------------

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name IN ('students','operators')
       AND column_name = 'design_variant'
  ) THEN
    RAISE EXCEPTION 'design_variant is still present after the rollback';
  END IF;

  -- The constraints must have gone with their columns rather than survived as
  -- orphans; if one is still here, the DROP did not do what this file claims.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname IN ('students_design_variant_check','operators_design_variant_check')
  ) THEN
    RAISE EXCEPTION 'a design_variant CHECK constraint outlived its column';
  END IF;

  -- The three roles are 017's and must survive: this file scopes itself to the
  -- two columns 024 added, and a rollback that removed a role would take every
  -- other table's grants with it.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ainext_app')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ainext_operator')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ainext_maint') THEN
    RAISE EXCEPTION
      'a migration 017 role is missing — this rollback must not touch roles';
  END IF;

  RAISE NOTICE
    'design variant: override removed. Everybody now follows the grade rule '
    '(Preparatory to play, Secondary to master, unknown to play) and the '
    'console is fixed on master. Deploy the pre-024 application FIRST — the '
    'root layout of both surfaces selects this column.';
END
$verify$;

COMMIT;
