-- ===========================================================================
-- 019 — the reset flow ADR-0014 depends on, for operators
--
-- ADR-0014 (roles and operator bootstrap) · ADR-0013 (sign-in) · data-model §5
-- Additive and idempotent. Safe to re-run; `scripts/local-dev.sh` does.
-- ===========================================================================
--
-- WHAT IS WRONG TODAY. ADR-0014 decides that the seeded operator gets no
-- password: `app/scripts/bootstrap-operator.mts` writes the row and its four
-- role grants and sets `password_hash` to NULL on purpose, so that **no
-- credential ever sits in a config file, a compose file or a shell history**.
-- Samuel obtains one "through the ordinary reset flow".
--
-- That flow cannot reach him. `password_resets.account_id` is `NOT NULL` with a
-- foreign key to `accounts`, and operators are deliberately a separate table
-- (data-model §7: a student account must NEVER be able to hold an operator
-- role, which a `kind` discriminator would reduce to a WHERE clause somebody
-- remembered). So the seeded operator can never obtain a password, and the one
-- decision that keeps credentials out of configuration is the decision that
-- locks the first operator out of the console.
--
-- THE SHAPE. The same exclusive arc `auth_sessions` already uses (§4): exactly
-- one of `account_id` / `operator_id` is set, enforced by a CHECK rather than by
-- the code that writes it. One session model and now one reset model serve both
-- principals, which is what lets phone + OTP slot in later (FR-2903, R1 §9)
-- without another table.
--
-- `ON DELETE CASCADE` on both arms: a reset token is meaningless once its
-- subject is gone, and it is the one row here that should NOT outlive them —
-- unlike `auth_events` and `operator_reads`, which record what happened and
-- carry no FK at all.
--
-- THE GRANTS. `ainext_operator` had none on `password_resets`: the console's
-- own connection could not issue or consume a reset. They mirror `ainext_app`'s
-- (SELECT, INSERT, UPDATE — never DELETE; a consumed token is marked, not
-- removed, so "was this link already used" stays answerable). RLS is ENABLEd
-- and FORCEd on this table, so a grant without a policy still returns nothing —
-- both are below.
-- ===========================================================================

BEGIN;

-- --- 1. the exclusive arc --------------------------------------------------

ALTER TABLE password_resets ALTER COLUMN account_id DROP NOT NULL;

ALTER TABLE password_resets
  ADD COLUMN IF NOT EXISTS operator_id BIGINT REFERENCES operators(id) ON DELETE CASCADE;

ALTER TABLE password_resets DROP CONSTRAINT IF EXISTS password_resets_one_principal;
ALTER TABLE password_resets ADD CONSTRAINT password_resets_one_principal CHECK (
  (account_id IS NOT NULL) <> (operator_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_password_resets_operator
  ON password_resets(operator_id) WHERE operator_id IS NOT NULL;

-- --- 2. grants and policy for the console's connection ---------------------
-- `ainext_app` keeps exactly what it had. `ainext_operator` gets the same three
-- verbs, because on the console build the reset routes run on that connection
-- (lib/db.ts `authPool()`): `ainext_app` has no grant at all on `operators`.

GRANT SELECT, INSERT, UPDATE ON password_resets TO ainext_operator;

-- The console never sets `app.student_id`; its principal is a role, not a row.
-- The policy is therefore scoped to the arm it is allowed to touch — an
-- operator connection has no business issuing or consuming a STUDENT's reset,
-- and this is what stops it doing so by typo.
DROP POLICY IF EXISTS password_resets_operator ON password_resets;
CREATE POLICY password_resets_operator ON password_resets FOR ALL TO ainext_operator
  USING (operator_id IS NOT NULL)
  WITH CHECK (operator_id IS NOT NULL);

-- --- 3. verification -------------------------------------------------------

DO $verify$
BEGIN
  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'password_resets' AND column_name = 'account_id') <> 'YES' THEN
    RAISE EXCEPTION 'password_resets.account_id is still NOT NULL — operators cannot reset';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'password_resets' AND column_name = 'operator_id') THEN
    RAISE EXCEPTION 'password_resets.operator_id was not added';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'password_resets_one_principal') THEN
    RAISE EXCEPTION 'the exactly-one-of CHECK is missing';
  END IF;

  IF NOT has_table_privilege('ainext_operator', 'password_resets', 'SELECT')
     OR NOT has_table_privilege('ainext_operator', 'password_resets', 'INSERT')
     OR NOT has_table_privilege('ainext_operator', 'password_resets', 'UPDATE') THEN
    RAISE EXCEPTION 'ainext_operator cannot read/write password_resets';
  END IF;

  IF has_table_privilege('ainext_operator', 'password_resets', 'DELETE') THEN
    RAISE EXCEPTION 'ainext_operator must not be able to DELETE a consumed reset token';
  END IF;

  RAISE NOTICE 'password_resets: operator arm added, ainext_operator granted S/I/U';
END
$verify$;

COMMIT;
