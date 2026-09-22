-- ADR-0013: a student reaches their own work by signing in, not by being picked
-- from a list. This is the credential half of that (data-model.md §3–§6, §8).
--
-- Five tables and two columns:
--
--  1. `accounts` — the credential. One account holds exactly one student
--     (`students.account_id UNIQUE`, below), which is FR-2001 expressed in the
--     database rather than in a comment. The unique index is on `lower(email)`
--     and is FUNCTIONAL on purpose: a raw INSERT that bypasses the application
--     must not be able to create a case-variant duplicate of an address that
--     already exists. Verification is ORTHOGONAL to sign-in — an unverified
--     account signs in and is refused a lesson (FR-2004), so `email_verified_at`
--     is a timestamp and not a status value.
--
--  2. `auth_sessions` — one row per signed-in device, for students AND
--     operators, distinguished by an exclusive-arc CHECK. One session model for
--     both is what lets phone + OTP arrive later without a schema change
--     (FR-2903), and the CHECK is what stops an operator session ever being
--     mistaken for a student's. Refresh rotates IN PLACE: the row keeps its
--     identity, `token_hash` is overwritten, the old hash moves to
--     `rotated_from`, and a token matching a `rotated_from` is a replay —
--     revoke every session for that principal (FR-2008).
--
--     **`operator_id` carries no foreign key here, and gains one in 014.**
--     `operators` does not exist yet and this file's subject is the account
--     side; splitting `auth_sessions` across two files, or creating `operators`
--     twice, would both be worse than adding one constraint in the migration
--     that owns the table it points at. 014 adds it with the same
--     DROP-then-ADD idiom used everywhere else in this directory.
--
--  3. `verification_tokens` and `password_resets` — hashed at rest, single-use,
--     one row each. A stateless token with no row cannot be revoked, only
--     waited out; a row makes single-use enforceable and makes "this link is
--     dead" a fact rather than a hope (data-model.md §5).
--
--  4. `auth_throttle` — fixed-window counters in Postgres, because there are
--     two Node processes against one database and an in-memory limiter would
--     give each its own budget (research R5). It carries NO `environment`
--     deliberately: operational state, not a record of anything.
--
--  5. `students.account_id` and `students.status` — the link, and the retirement
--     of the picker-era cast (A10, FR-2014). `status='legacy'` rows keep every
--     row of their history and simply have no account, so no student principal
--     can ever match them once 017's policies are in place.
--
-- **`environment` is NOT NULL with no default on every table created here**
-- (FR-2109, data-model.md §3–§10). Every INSERT must pass it. That is not an
-- oversight to be defaulted away: an auth row filed under the wrong environment
-- is a security record filed under the wrong environment.
--
-- No password material is ever stored outside `password_hash`, and nothing in
-- this file logs, indexes or reports it.
--
-- Idempotent — safe to re-run.

BEGIN;

-- 1 ------------------------------------------------------------------
-- accounts

CREATE TABLE IF NOT EXISTS accounts (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email           TEXT NOT NULL,
  password_hash   TEXT,                       -- Argon2id output + parameters; NULL for Google-only
  google_sub      TEXT UNIQUE,                -- Google's stable subject id
  status          TEXT NOT NULL DEFAULT 'active',
  email_verified_at TIMESTAMPTZ,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  last_login_at   TIMESTAMPTZ,
  login_count     INT NOT NULL DEFAULT 0,
  environment     TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_status_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_status_check
  CHECK (status IN ('active','locked','disabled'));

-- An account with neither a password nor a Google subject cannot be signed in
-- to by anyone, which makes it a row that looks like access and is not.
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_credential_present;
ALTER TABLE accounts ADD CONSTRAINT accounts_credential_present
  CHECK (password_hash IS NOT NULL OR google_sub IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_email_lower ON accounts(lower(email));

COMMENT ON COLUMN accounts.password_hash IS
  'Argon2id output including its parameters. Never selected by a console query '
  '(017 grants ainext_operator SELECT on every other column and not this one), '
  'never logged, never in an event, never in a URL (FR-2003).';

-- 2 ------------------------------------------------------------------
-- auth_sessions

CREATE TABLE IF NOT EXISTS auth_sessions (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id   BIGINT REFERENCES accounts(id) ON DELETE CASCADE,
  operator_id  BIGINT,                        -- FK added by 014; see the header
  token_hash   TEXT NOT NULL UNIQUE,          -- sha256 hex of the refresh token
  rotated_from TEXT,                          -- the previous hash; presenting it is a replay
  issued_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,          -- least(now + 7d, issued + 30d)
  revoked_at   TIMESTAMPTZ,
  user_agent   TEXT,
  device_name  TEXT,
  ip_address   INET,
  environment  TEXT NOT NULL
);

ALTER TABLE auth_sessions DROP CONSTRAINT IF EXISTS auth_sessions_one_principal;
ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_one_principal
  CHECK ((account_id IS NOT NULL) <> (operator_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_auth_sessions_account
  ON auth_sessions(account_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_auth_sessions_operator
  ON auth_sessions(operator_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_auth_sessions_rotated
  ON auth_sessions(rotated_from) WHERE rotated_from IS NOT NULL;

-- 3 ------------------------------------------------------------------
-- verification_tokens and password_resets — identical shape, different clocks
-- (24 hours and 1 hour). Both are consumed by exact token_hash match and never
-- listed.

CREATE TABLE IF NOT EXISTS verification_tokens (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id  BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  environment TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_verification_tokens_account ON verification_tokens(account_id);

CREATE TABLE IF NOT EXISTS password_resets (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id  BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  environment TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_resets_account ON password_resets(account_id);

-- 4 ------------------------------------------------------------------
-- auth_throttle

CREATE TABLE IF NOT EXISTS auth_throttle (
  scope        TEXT NOT NULL,                 -- account | ip | email
  key          TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count        INT NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, key, window_start)
);
CREATE INDEX IF NOT EXISTS idx_auth_throttle_window ON auth_throttle(window_start);

COMMENT ON TABLE auth_throttle IS
  'Fixed 15-minute windows, incremented by INSERT … ON CONFLICT DO UPDATE. '
  'Rows older than an hour are swept nightly. No environment column: this is '
  'operational state, and nothing reports from it (data-model.md §6).';

-- 5 ------------------------------------------------------------------
-- students: the account link and the commercial-era status column.

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS account_id BIGINT,
  ADD COLUMN IF NOT EXISTS status     TEXT NOT NULL DEFAULT 'active';

-- One account ↔ one student, in the database (FR-2001). UNIQUE admits many
-- NULLs, which is exactly right: the retired picker-era cast has no account.
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_account ON students(account_id);

ALTER TABLE students DROP CONSTRAINT IF EXISTS students_account_id_fkey;
ALTER TABLE students ADD CONSTRAINT students_account_id_fkey
  FOREIGN KEY (account_id) REFERENCES accounts(id);

ALTER TABLE students DROP CONSTRAINT IF EXISTS students_status_check;
ALTER TABLE students ADD CONSTRAINT students_status_check
  CHECK (status IN ('active','legacy'));

COMMENT ON COLUMN students.status IS
  'active | legacy. A legacy row is a picker-era student: every row of history '
  'kept, no account, and therefore unreachable from any student principal once '
  '017 is applied (A10, FR-2014). Nothing is deleted.';

COMMIT;
