-- The rest of the `students` delta, and the guardian link that nothing writes
-- yet (data-model.md §8 and §9; plan A9, A11; research R12, R15).
--
-- `gender` — three values, nullable, skippable at signup, editable afterwards
-- (FR-2013). It exists for ONE purpose and the purpose bounds the enumeration:
-- the tutor needs a form of address. Arabic grammatical gender is binary for
-- the vocative, the pronoun and the verb agreement the tutor needs, plus a
-- neutral register it can always fall back to — so three values, with nothing
-- spare to collect about a minor (Principle VII, constitution v3.1.1).
--
-- **NULL and 'unspecified' are different facts and both are kept.** NULL is a
-- picker-era student who was never asked; 'unspecified' is one who declined.
-- The tutor treats them identically (FR-2605's either-correct register); the
-- console does not, because "never asked" is fixable and "declined" is not.
--
-- `subscription_status` is a RECORD, never a gate (FR-2404). No student surface
-- reads it, it is never shown as a plan, and it is never described as a payment
-- having happened. Changing it needs `cost-billing` and stamps who and when
-- (FR-2405) — which is why the two audit columns are beside it rather than in a
-- log somewhere else.
--
-- The `guardian_*` columns and the `guardians` table SHIP EMPTY. Egypt's PDPL
-- executive regulations (Decree 816/2025) require written guardian consent for
-- under-15s from 2026-11-01, weeks after the pilot's target launch and inside
-- the window its success metric is measured over. That is Samuel's decision to
-- take, not this migration's (plan A11). What ships is the shape: fields and a
-- link, no UI, no enforcement, nothing presented to a student or a parent — so
-- that turning consent on later is a copy change over a migration that has
-- already run, rather than a schema change under a live pilot.
--
-- Idempotent — safe to re-run.

BEGIN;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS gender                  TEXT,
  ADD COLUMN IF NOT EXISTS subscription_status     TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS subscription_note       TEXT,
  ADD COLUMN IF NOT EXISTS subscription_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_updated_by BIGINT,
  -- modelled and never written this release (research R15)
  ADD COLUMN IF NOT EXISTS guardian_contact        TEXT,
  ADD COLUMN IF NOT EXISTS guardian_consent_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS guardian_consent_form   TEXT;

ALTER TABLE students DROP CONSTRAINT IF EXISTS students_gender_check;
ALTER TABLE students ADD CONSTRAINT students_gender_check
  CHECK (gender IS NULL OR gender IN ('female','male','unspecified'));

ALTER TABLE students DROP CONSTRAINT IF EXISTS students_subscription_status_check;
ALTER TABLE students ADD CONSTRAINT students_subscription_status_check
  CHECK (subscription_status IN ('none','trial','active','lapsed'));

ALTER TABLE students DROP CONSTRAINT IF EXISTS students_subscription_updated_by_fkey;
ALTER TABLE students ADD CONSTRAINT students_subscription_updated_by_fkey
  FOREIGN KEY (subscription_updated_by) REFERENCES operators(id);

COMMENT ON COLUMN students.gender IS
  'female | male | unspecified, or NULL for never asked. Reaches the prompt '
  'ONLY through the address block: no selector, difficulty or retrieval query '
  'reads it, and no event property or log line carries it (FR-2603, FR-2604).';

COMMENT ON COLUMN students.subscription_status IS
  'A record of what an operator was told, never a gate on anything a student '
  'can reach (FR-2404). No student-facing query reads this column.';

-- ---------------------------------------------------------------------------
-- guardians — modelled, nothing creates one.
--
-- `student_id UNIQUE` holds constitution VIII: one guardian link per student,
-- and a guardian is a LINK rather than an account holder. No login, no view, no
-- invitation flow (FR-2901, FR-2902). It is here so that the parent view, if it
-- is ever built, does not require re-cutting identity to hang off.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS guardians (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id   BIGINT NOT NULL UNIQUE REFERENCES students(id) ON DELETE CASCADE,
  contact      TEXT,
  relationship TEXT,
  linked_at    TIMESTAMPTZ,
  environment  TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
