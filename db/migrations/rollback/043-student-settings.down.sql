-- Rollback for 043 — the student's own settings. Removes the three functions,
-- so the settings page can no longer save a name, grade or curriculum, or
-- delete an account. Deletions already made are not undone.
--
-- The reason check goes back to 033's two values ONLY if no row says
-- 'student'; otherwise it is left wide and a NOTICE says so, because
-- rewriting a student's own recorded change as an operator's would falsify
-- the history (FR-4012).
BEGIN;

DROP FUNCTION IF EXISTS delete_own_account();
DROP FUNCTION IF EXISTS change_own_curriculum(text);
DROP FUNCTION IF EXISTS update_own_profile(text, text, text);

ALTER TABLE student_curriculum_changes
  DROP CONSTRAINT IF EXISTS student_curriculum_changes_student_unnamed;

DO $narrow$
BEGIN
  IF EXISTS (SELECT 1 FROM student_curriculum_changes WHERE reason = 'student') THEN
    RAISE NOTICE 'student_curriculum_changes holds student-made rows; reason check left at three values';
  ELSE
    ALTER TABLE student_curriculum_changes
      DROP CONSTRAINT IF EXISTS student_curriculum_changes_reason_check;
    ALTER TABLE student_curriculum_changes
      ADD CONSTRAINT student_curriculum_changes_reason_check
      CHECK (reason IN ('operator', 'grade_change_reresolved'));
  END IF;
END
$narrow$;

COMMIT;
