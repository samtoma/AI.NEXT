-- ===========================================================================
-- 036 DOWN — remove the console review gate's record and claims
--
-- Undoes `db/migrations/036-review-gate.sql`. Idempotent: safe to run when
-- both tables are already absent, and safe to run twice.
--
-- ORDER: deploy a build without the console's `/review` page FIRST, then run
-- this. A build with it reads and writes both tables on every visit to
-- `/review`; against a database without them that page (and its two endpoints)
-- fail, and nothing else does — no student surface reads either table.
--
-- WHAT IS LOST: every human review decision recorded through the console —
-- who approved, asked for a fix or rejected which item, when, with what note
-- and what it changed — and every open claim. Take a dump first; it is the
-- only copy of who reviewed what:
--
--   pg_dump -t review_decisions <db> > 036-review-decisions.sql
--
-- WHAT IS NOT TOUCHED: the EFFECTS those decisions wrote to content stay where
-- they are — a question's human stamp (`questions.reviewed_by/_at`), a
-- rejected question's `status = 'retired'`, a widget claim moved into
-- `choices.diagnostics`, a library entry's `reviewed` flag. They are content,
-- the student surface reads them as it always has, and undoing them is not a
-- schema operation. Roles are not revoked from anything else: dropping a table
-- takes its own grants with it.
-- ===========================================================================

BEGIN;

-- Nothing references these tables, so no CASCADE — if something later does,
-- this should fail loudly rather than drop it silently (023's rule).
DROP TABLE IF EXISTS review_claims;
DROP TABLE IF EXISTS review_decisions;
-- Its trigger went with the table; the function is free-standing.
DROP FUNCTION IF EXISTS review_decisions_append_only();

DO $verify$
BEGIN
  IF to_regclass('public.review_decisions') IS NOT NULL
     OR to_regclass('public.review_claims') IS NOT NULL THEN
    RAISE EXCEPTION 'a review-gate table survives the rollback';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'review_decisions_append_only') THEN
    RAISE EXCEPTION 'review_decisions_append_only() survives the rollback';
  END IF;
END
$verify$;

COMMIT;
