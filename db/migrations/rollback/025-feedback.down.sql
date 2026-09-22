-- ===========================================================================
-- 025 DOWN — remove in-product feedback
--
-- Undoes `db/migrations/025-feedback.sql`. Idempotent: safe to run when the
-- table is already absent, and safe to run twice.
--
-- ⚠ THIS IS NOT THE WAY TO STOP ASKING. If the intent is "take the prompt
-- down", the cheap reversal is in the application: `FeedbackPrompt` comes off
-- the report card and the practice summary, or `mayAsk` is made to answer no.
-- Every note already written stays readable in the console, and turning the
-- prompt back on is a revert. Run this file when the FEATURE is being
-- withdrawn, not when it is being paused.
--
-- ---------------------------------------------------------------------------
-- WHAT IS LOST, AND WHY IT IS NOT LIKE LOSING A PREFERENCE
-- ---------------------------------------------------------------------------
-- 024's rollback loses a skin choice. This one loses **things children wrote
-- about us in their own words** — the only unbounded prose from a student
-- anywhere in this schema, and the only record of anybody's opinion of the
-- product that was not filtered through a founder. It cannot be re-derived
-- from anything: there is no transcript of it, no analytics row carrying it
-- (deliberately — see 025's header), and no copy anywhere else.
--
-- **Take it first, and take it as data rather than as a screenshot:**
--
--   pg_dump -t feedback --data-only <db> > 025-feedback.sql
--
-- or, readable by a person rather than by psql:
--
--   psql <db> -c "\copy (SELECT f.created_at, s.display_name, f.trigger_kind, \
--     f.rating, f.lesson_slug, f.note FROM feedback f \
--     JOIN students s ON s.id = f.student_id ORDER BY f.created_at) \
--     TO '025-feedback.csv' CSV HEADER"
--
-- The second one needs `ainext_maint`: `ainext_operator` can read `feedback`
-- but this export joins it to `students`, and doing it as a superuser on the
-- box is the ordinary way a founder gets a spreadsheet out of this database.
--
-- **And if a note in there was a disclosure, the export is not the answer to
-- it.** Deleting a table does not undo having been told something. Read the
-- notes before running this, not afterwards.
--
-- ---------------------------------------------------------------------------
-- THE ORDER IS APPLICATION FIRST, THEN DROP
-- ---------------------------------------------------------------------------
-- `lib/feedback-queries.ts` selects this table from three places, one of which
-- is a console page an operator opens directly. A build from after 025 pointed
-- at a database from before it answers `relation "feedback" does not exist` on
-- `/feedback`, on the Student 360 and — the one that matters — on the student's
-- own report card, because the prompt asks whether to render before it renders.
-- That last failure is softened in the endpoint (it answers "do not ask" on any
-- error, so a lesson still ends cleanly), which makes the mis-ordering quiet
-- rather than harmless. Deploy the application first, then drop.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FILE DELIBERATELY DOES NOT UNDO
-- ---------------------------------------------------------------------------
--   * **No role is dropped and no pre-025 privilege is revoked.** The three
--     roles are migration 017's and are shared by every table in the schema.
--     `DROP TABLE` takes its own table-level grants, its policies and its
--     indexes with it, which is exactly the right scope, so this file does no
--     revoking at all.
--   * **No policy or index is dropped separately** — `DROP TABLE` takes both,
--     and naming them here would fail on the second run for no benefit.
--   * **Nothing in `sessions` or `students`.** 025 added no column to either;
--     it only references them, and a dropped referencing table leaves a
--     referenced one untouched.
--   * **Nothing in `traceability.md`.** FR-2801…FR-2811's statuses are
--     Samuel's to set, not a migration's, in either direction.
-- ===========================================================================

BEGIN;

-- No CASCADE, deliberately: nothing depends on `feedback` — no view, no
-- foreign key pointing at it, no generated column (025 created none). If a
-- later migration added a dependant, this should fail loudly rather than drop
-- it silently, because whatever that dependant is, it holds a copy of the one
-- thing in this table that cannot be reconstructed.
DROP TABLE IF EXISTS feedback;

-- ---------------------------------------------------------------------------
-- Verification — asserted, not assumed (the argument 020/021/022/023/024 make)
-- ---------------------------------------------------------------------------

DO $verify$
BEGIN
  IF to_regclass('public.feedback') IS NOT NULL THEN
    RAISE EXCEPTION 'feedback is still present after the rollback';
  END IF;

  -- The policies must have gone with the table rather than survived as
  -- orphans; if one is still here, the DROP did not do what this file claims.
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'feedback') THEN
    RAISE EXCEPTION 'a feedback policy outlived its table';
  END IF;

  -- The three roles are 017's and must survive: this file scopes itself to the
  -- one table 025 added, and a rollback that removed a role would take every
  -- other table's grants with it.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ainext_app')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ainext_operator')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ainext_maint') THEN
    RAISE EXCEPTION
      'a migration 017 role is missing — this rollback must not touch roles';
  END IF;

  -- `sessions` and `students` were referenced, never altered. If either is
  -- gone, something other than this file has run.
  IF to_regclass('public.sessions') IS NULL OR to_regclass('public.students') IS NULL THEN
    RAISE EXCEPTION
      'sessions or students is missing — 025 only referenced them and this '
      'rollback must not have reached either';
  END IF;

  RAISE NOTICE
    'feedback: removed. No student is asked how the product is doing any '
    'more, and every note anybody wrote is gone with the table — if it was '
    'not exported first, it is not recoverable. Deploy the pre-025 '
    'application FIRST: the report card asks this table whether to render.';
END
$verify$;

COMMIT;
