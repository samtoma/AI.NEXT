-- Rollback for 040 — homework asks. Destroys every homework ask, question and flag.
DROP TABLE IF EXISTS homework_flags;
DROP TABLE IF EXISTS homework_items;
DROP TABLE IF EXISTS homework_asks;
DELETE FROM sessions WHERE kind = 'homework';
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_kind_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_kind_check
  CHECK (kind IN ('lesson_learn','lesson_review','practice','student_chat','spine_chat'));
-- NOTE: migration 011 also lists 'homework'; revert that line too or the next
-- deploy re-adds it (harmless — it permits a kind nothing writes).
