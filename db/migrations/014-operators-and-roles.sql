-- ADR-0014 (the console is a second build target) and ADR-0015 §4 (the audit
-- its subject cannot erase). data-model.md §7 and §11.
--
-- Three tables and one constraint left over from 013.
--
--  1. `operators` — a SEPARATE table from `accounts`, not a `kind` column on
--     it. FR-2205 says a student account can never hold an operator role; a
--     discriminator column makes that guarantee a WHERE clause somebody
--     remembered, which is the class of bug this whole feature exists to
--     remove. The cost is duplicated credential logic, and it is paid down by
--     sharing the same library functions rather than the same table.
--
--  2. `operator_roles` — ONE ROW PER GRANT, never updated in place, so a
--     revoked grant stays visible with who revoked it and when (FR-2204). The
--     active set is `revoked_at IS NULL`. The CHECK admits exactly FIVE values
--     and there is deliberately no "all" role (FR-2203): "Samuel holds all
--     five" is five rows.
--
--     The fifth, `teaching-controls`, was added 2026-09-24 (ADR-0021): it
--     gates the console's Socratic-probing switch, split out of
--     `content-review` so it can be narrowed on its own. It is added HERE,
--     in the vocabulary's own file, and not in the migration that grants it
--     (029), because this file re-runs on every deploy and re-adds its CHECK:
--     had 029 widened the constraint instead, the next deploy would re-apply
--     this narrower four-value CHECK over rows holding the fifth and fail —
--     the deploy stops, and on the box that is the site down.
--     ⚠ The corollary: a build from BEFORE v0.7.0 cannot be redeployed onto a
--     database that holds a `teaching-controls` row, for exactly that reason.
--     `rollback/029-teaching-controls-role.down.sql` removes those rows first.
--
--  3. `operator_reads` — who opened whose record. Two things in it are
--     deliberate and look like mistakes:
--
--       * `student_id` carries NO foreign key. The record must survive the
--         deletion of the student's account (FR-2306) because it records what
--         an OPERATOR did, not who the student was. ON DELETE CASCADE would
--         erase the audit together with its subject, and a restricting FK would
--         block a deletion we have promised to honour.
--       * there is no UPDATE or DELETE grant to `ainext_operator` (017). An
--         audit log the audited party can edit is decoration.
--
--  4. `auth_sessions.operator_id` gains its foreign key here, now that
--     `operators` exists. 013 created the column without it and says why.
--
-- Idempotent — safe to re-run.

BEGIN;

-- 1 ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS operators (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email           TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  password_hash   TEXT,                 -- NULL until the first reset-flow sign-in (A5)
  status          TEXT NOT NULL DEFAULT 'active',
  email_verified_at TIMESTAMPTZ,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  environment     TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE operators DROP CONSTRAINT IF EXISTS operators_status_check;
ALTER TABLE operators ADD CONSTRAINT operators_status_check
  CHECK (status IN ('active','disabled'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_operators_email_lower ON operators(lower(email));

COMMENT ON COLUMN operators.password_hash IS
  'NULL is the normal state of a freshly bootstrapped operator: the seed sets '
  'no password so that no credential is ever written into a config file (A5). '
  'The first one arrives through the ordinary reset flow.';

-- 2 ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS operator_roles (
  operator_id BIGINT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by  BIGINT REFERENCES operators(id),
  revoked_at  TIMESTAMPTZ,
  revoked_by  BIGINT REFERENCES operators(id),
  environment TEXT NOT NULL,
  PRIMARY KEY (operator_id, role, granted_at)
);

ALTER TABLE operator_roles DROP CONSTRAINT IF EXISTS operator_roles_role_check;
ALTER TABLE operator_roles ADD CONSTRAINT operator_roles_role_check
  CHECK (role IN ('content-review','evidence-access','student-data','cost-billing',
                  'teaching-controls'));

-- The active set, and the shape every role check reads.
CREATE INDEX IF NOT EXISTS idx_operator_roles_active
  ON operator_roles(operator_id, role) WHERE revoked_at IS NULL;

COMMENT ON TABLE operator_roles IS
  'One row per grant, append-only in practice: revoking sets revoked_at/_by on '
  'the existing row rather than deleting it, so the history of who could do '
  'what, when, survives (FR-2204). content-review is a SAFETY control '
  '(constitution III) and is never described in the product as content '
  'management.';

-- 3 ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS operator_reads (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operator_id BIGINT NOT NULL REFERENCES operators(id),
  student_id  BIGINT NOT NULL,      -- NO foreign key: it outlives the student (FR-2306)
  session_id  BIGINT,               -- NULL for a 360 open, set for a transcript open
  surface     TEXT NOT NULL,        -- student_360 | session_timeline | session_replay
  reason      TEXT,
  environment TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE operator_reads DROP CONSTRAINT IF EXISTS operator_reads_surface_check;
ALTER TABLE operator_reads ADD CONSTRAINT operator_reads_surface_check
  CHECK (surface IN ('student_360','session_timeline','session_replay'));

CREATE INDEX IF NOT EXISTS idx_operator_reads_student
  ON operator_reads(student_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_operator_reads_operator
  ON operator_reads(operator_id, occurred_at DESC);

-- 4 ------------------------------------------------------------------
-- The constraint 013 could not add yet.
ALTER TABLE auth_sessions DROP CONSTRAINT IF EXISTS auth_sessions_operator_id_fkey;
ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_operator_id_fkey
  FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE CASCADE;

COMMIT;
