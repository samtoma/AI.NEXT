-- ===========================================================================
-- 027 DOWN — remove the Socratic-probing retry link
--
-- Undoes `db/migrations/027-socratic-probe-retry-link.sql`. Idempotent: safe
-- to run when the column is already absent, and safe to run twice.
--
-- WHAT IS LOST: the edges between the attempts of a probe cycle. The attempts
-- themselves, their `stance_used = 'probe'` tags and every mastery row stay.
-- While `SOCRATIC_PROBING_ENABLED` is false nothing has written this column,
-- so on a build that never turned probing on this loses nothing at all.
--
-- ORDER: turn the switch off (or deploy a build without the prototype) FIRST,
-- then run this. A build with probing ON names this column in its attempt
-- INSERT whenever a retry link is present, and that INSERT fails against a
-- database without it — a graded answer that errors instead of saving.
-- ===========================================================================

BEGIN;

DROP INDEX IF EXISTS idx_attempts_retry_of;
ALTER TABLE attempts DROP COLUMN IF EXISTS retry_of_attempt_id;

COMMIT;
