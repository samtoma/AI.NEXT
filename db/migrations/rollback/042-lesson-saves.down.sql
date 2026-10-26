-- Rollback for 042 — lesson saves. Destroys every student's saved lesson place
-- (FR-204): the next visit to any lesson starts from the beginning. The app
-- from before 042 kept the place in the browser, so rolling the app back with
-- this restores that behaviour with an empty slate.
DROP TABLE IF EXISTS lesson_saves;
