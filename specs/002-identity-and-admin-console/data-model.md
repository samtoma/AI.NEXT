# Data Model Delta — Identity & Admin Console

**Feature**: `002-identity-and-admin-console` | **Date**: 2026-09-20
**Migrations**: `db/migrations/011`…`018` (mapped in §15)
**Applies to**: the `PDR1-0` solution's database only. These migrations exist on this branch and
nowhere else; `family-tutor` keeps the picker it shipped with (ADR-0010, ADR-0013 Consequences).

Baseline is `db/schema.sql` + migrations `002`–`010`; this documents only the delta. Conventions
follow the nine existing migrations exactly (R3-doc §11): `IF NOT EXISTS` on every create and column
add, `DROP CONSTRAINT IF EXISTS` then `ADD CONSTRAINT`, `BEGIN;`/`COMMIT;` on multi-statement files,
a header citing the ADR. `R1-doc`, `R2-doc`, `R3-doc` are the three studies under `research/`, named
as in [research.md](./research.md).

## 1. `sessions` — dead schema becomes the learning session

The table exists (`db/schema.sql:131-136`) and **has never held a row** (R3-doc §4). It keeps its
`id` and `student_id`; `plan` becomes nullable — it was written for an assigned-question plan that
never shipped and nothing reads it.

```sql
ALTER TABLE sessions ALTER COLUMN plan DROP NOT NULL;
ALTER TABLE sessions
  -- kind IN (lesson_learn | lesson_review | practice | student_chat | spine_chat)
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'student_chat',
  ADD COLUMN IF NOT EXISTS surface TEXT,
  ADD COLUMN IF NOT EXISTS lo_id TEXT REFERENCES graph_nodes(id),
  ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  -- close_reason IN (completed | inactivity | superseded | abandoned)
  ADD COLUMN IF NOT EXISTS close_reason TEXT,
  ADD COLUMN IF NOT EXISTS client_key TEXT,     -- the legacy chatSession string
  ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'mvp1';

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_open_one ON sessions(student_id) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_student_time ON sessions(student_id, opened_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_client_key
  ON sessions(student_id, client_key) WHERE client_key IS NOT NULL;
```

**`assigned_at` stays** as the legacy creation timestamp; `opened_at` is what the lifecycle writes and
the timeline orders by, and the two are equal for every row this feature creates.

**State transitions.** `open` (`closed_at IS NULL`) → `closed`, one way — a reopened session makes
"how long did this sitting last" unanswerable. Opened by the first interaction of a study stretch;
closed `completed` (lesson/practice finished or explicitly ended), `inactivity` (30 minutes, R8),
`superseded` (the student opened a new one), or `abandoned` (an operator or the nightly sweep closing
a stranded row). **The partial unique index enforces at most one open session per student** — the
invariant that makes FR-2301's "exactly one session" true rather than aspirational.

## 2. Session keys on the five tables that record interactions

Types disagree today: `sessions.id` and `attempts.session_id` are `BIGINT`; `uploads.session_id` and
`analytics_events.session_id` are `TEXT` (R2-doc §A0.1). Reconciled by adding a **new BIGINT column**
rather than by casting.

```sql
ALTER TABLE ai_interactions      ADD COLUMN IF NOT EXISTS session_id  BIGINT REFERENCES sessions(id);
ALTER TABLE understanding_checks ADD COLUMN IF NOT EXISTS session_id  BIGINT REFERENCES sessions(id);
ALTER TABLE uploads              ADD COLUMN IF NOT EXISTS session_ref BIGINT REFERENCES sessions(id);
ALTER TABLE analytics_events     ADD COLUMN IF NOT EXISTS session_ref BIGINT REFERENCES sessions(id);
ALTER TABLE attempts DROP CONSTRAINT IF EXISTS attempts_session_id_fkey;
ALTER TABLE attempts ADD CONSTRAINT attempts_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES sessions(id);
```

**Backfill**: one `sessions` row per distinct legacy client string per student —
`grounding->>'chat_session'` for `ai_interactions` and `understanding_checks`, `uploads.session_id`,
`analytics_events.session_id` — with `opened_at`/`closed_at` from the first and last row in the group
and `close_reason='abandoned'`. `attempts.session_id` is NULL on every existing row and stays NULL:
no evidence exists to reconstruct it, and guessing by timestamp proximity is what ADR-0015 option (c)
rejected. **Nullable on purpose** — FR-2309 requires an unattributable interaction to be recorded as
belonging to no session, and `NOT NULL` would force the write path to invent one. **The legacy `TEXT`
columns are retained during the transition and dropped in a later release**; they are the client
string and must never be joined to `sessions.id`.

## 3. `accounts` — the credential

```sql
CREATE TABLE IF NOT EXISTS accounts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL,
  password_hash TEXT,                              -- NULL for a Google-only account
  google_sub TEXT UNIQUE,                          -- Google's stable subject id
  status TEXT NOT NULL DEFAULT 'active',           -- active | locked | disabled
  email_verified_at TIMESTAMPTZ, failed_attempts INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ, last_login_at TIMESTAMPTZ, login_count INT NOT NULL DEFAULT 0,
  environment TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT accounts_status_check CHECK (status IN ('active','locked','disabled')),
  CONSTRAINT accounts_credential_present CHECK (password_hash IS NOT NULL OR google_sub IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_email_lower ON accounts(lower(email));
```

The **functional unique index on `lower(email)`** is copied verbatim from Talent (R1-doc §1): a raw
INSERT bypassing the application must not be able to create a case-variant duplicate. `password_hash`
holds Argon2id output and its parameters (research R1). **State transitions**: `active` ⇄ `locked`
(automatic on 5 failures in 15 minutes, cleared by expiry or an operator, both recorded);
`active | locked` → `disabled` (deliberate, one-way this release). Verification is orthogonal —
`email_verified_at IS NULL` permits signing in and refuses starting a lesson (FR-2004).

## 4. `auth_sessions` — one row per signed-in device

```sql
CREATE TABLE IF NOT EXISTS auth_sessions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id  BIGINT REFERENCES accounts(id)  ON DELETE CASCADE,
  operator_id BIGINT REFERENCES operators(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,   -- sha256 hex of the refresh token
  rotated_from TEXT,                   -- the previous hash; presenting it = reuse
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ,
  user_agent TEXT, device_name TEXT, ip_address INET, environment TEXT NOT NULL,
  CONSTRAINT auth_sessions_one_principal CHECK (
    (account_id IS NOT NULL) <> (operator_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_account ON auth_sessions(account_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_auth_sessions_rotated ON auth_sessions(rotated_from) WHERE rotated_from IS NOT NULL;
```

**The exclusive-arc CHECK is the point**: one session model serves students and operators, so adding
phone + OTP later needs no schema change (FR-2903, R1-doc §9), while an operator session can never be
mistaken for a student's.

**Rotation is in place** (Talent's shape, R1-doc §1): the row keeps its identity, `token_hash` is
overwritten and the old value moves to `rotated_from`. `expires_at = least(now() + 7 days, issued_at
+ 30 days)` — Talent's sliding window inside an absolute cap, so a session cannot live forever by
being used. **Reuse detection is a departure from Talent, which has none** (R1-doc §8): a token
matching a `rotated_from` revokes **every** session for that principal and emits
`suspicious_activity` + `session_revoked` (FR-2008). **Lifecycle**: `active` → `rotated` (same row) →
`revoked` (logout, logout-all, the student's own list, an operator, or reuse) → `expired` (passive).

## 5. `verification_tokens` and `password_resets`

```sql
CREATE TABLE IF NOT EXISTS verification_tokens (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,       -- issued + 24h
  consumed_at TIMESTAMPTZ, environment TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- password_resets: identical shape, expires_at = issued + 1h
```

**Both are hashed at rest and both are rows.** Talent stores the reset token in plaintext and makes
the verification token a stateless JWT with no row at all, so a leaked verification link cannot be
revoked — only waited out for 24 hours (R1-doc §1). A row makes single-use enforceable and revocation
possible; hashing costs nothing (R1-doc §9 recommends it). **Single-use**: `consumed_at IS NOT NULL`
or `expires_at < now()` rejects; an expired link offers a new one and never reveals whose address it
was (FR-2004, edge cases).

## 6. `auth_throttle` — rate limiting without Redis

```sql
CREATE TABLE IF NOT EXISTS auth_throttle (
  scope TEXT NOT NULL,              -- account | ip | email
  key TEXT NOT NULL, window_start TIMESTAMPTZ NOT NULL, count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, key, window_start)
);
```

Fixed 15-minute windows, atomic `INSERT … ON CONFLICT DO UPDATE SET count = auth_throttle.count + 1`.
Durable across restarts and shared by both Node processes (research R5); rows older than an hour are
swept nightly. It carries **no `environment`** deliberately — operational state, not a record of
anything, and nothing reports from it.

## 7. `operators` and `operator_roles`

```sql
CREATE TABLE IF NOT EXISTS operators (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL, display_name TEXT NOT NULL, password_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active',            -- active | disabled
  email_verified_at TIMESTAMPTZ, failed_attempts INT NOT NULL DEFAULT 0, locked_until TIMESTAMPTZ,
  environment TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_operators_email_lower ON operators(lower(email));

CREATE TABLE IF NOT EXISTS operator_roles (
  operator_id BIGINT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  role TEXT NOT NULL, granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by BIGINT REFERENCES operators(id),
  revoked_at TIMESTAMPTZ, revoked_by BIGINT REFERENCES operators(id),
  environment TEXT NOT NULL,
  PRIMARY KEY (operator_id, role, granted_at),
  CONSTRAINT operator_roles_role_check CHECK (
    role IN ('content-review','evidence-access','student-data','cost-billing',
             'teaching-controls'))   -- fifth added 2026-09-24, ADR-0021
);
```

**A separate table from `accounts`, not a `kind` column** — FR-2205 says a student account can *never*
hold an operator role, and a discriminator column makes that guarantee a `WHERE` clause somebody
remembered, which is the class of bug this feature exists to remove. The cost is duplicated
credential logic, paid down by sharing the same library functions.

**One row per grant, never updated in place**, so a revoked grant stays visible with who revoked it
and when (FR-2204). Active set is `revoked_at IS NULL`. **No role implies another and none grants
everything** (FR-2203): "Samuel holds all five" is five rows, not an "all" role. The fifth,
`teaching-controls` (2026-09-24, ADR-0021, FR-3102), gates the console's teaching switch; migration
029 granted it once to every active operator then holding `content-review`, and never again — its
guard also reads the `auth_events` trail, so withdrawing the role (`rollback/029`) and deploying
again does not re-grant it. `014` rebuilds the CHECK only when it lacks one of the five (the v0.6.1
guard), so an older build's `014` leaves a wider vocabulary alone.

## 8. `students` — account link, gender, commercial status, guardian hooks

```sql
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS account_id BIGINT UNIQUE REFERENCES accounts(id),
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS gender TEXT,
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS subscription_note TEXT,
  ADD COLUMN IF NOT EXISTS subscription_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_updated_by BIGINT REFERENCES operators(id),
  -- the three guardian columns are modelled and never written this release (research R15)
  ADD COLUMN IF NOT EXISTS guardian_contact TEXT,
  ADD COLUMN IF NOT EXISTS guardian_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS guardian_consent_form TEXT,
  ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'mvp1';

-- status IN ('active','legacy')
-- gender IN ('female','male','unspecified')          -- RECOMMENDED; Samuel's call (Open Decision 1)
-- subscription_status IN ('none','trial','active','lapsed')
```

`account_id UNIQUE` is **one account ↔ one student** in the database, not in a comment (FR-2001).

**`gender` is nullable and `unspecified` is a value** — different facts: NULL is a picker-era student
who was never asked, `unspecified` is one who declined. Both take FR-2605's either-correct register,
so the tutor treats them identically; the console does not, because "never asked" is fixable and
"declined" is not.

**`subscription_status` is a record, never a gate** (FR-2404): no student surface reads it, it is
never shown as a plan, and it is never described as a payment having happened. Changing it needs
`cost-billing` and writes `subscription_updated_by`/`_at` (FR-2405). **The three `guardian_*` columns
ship empty** so that turning consent on later is a copy change over a migration that has already run
(research R15); nothing writes them and no UI mentions them.

## 9. `guardians` — modelled, nothing creates one

```sql
CREATE TABLE IF NOT EXISTS guardians (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id BIGINT NOT NULL UNIQUE REFERENCES students(id) ON DELETE CASCADE,
  contact TEXT, relationship TEXT, linked_at TIMESTAMPTZ,
  environment TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`student_id UNIQUE` holds constitution VIII: one guardian link per student, and a guardian is a link
rather than an account holder. **No login, no view, no invitation flow** (FR-2901, FR-2902). It is
here so the parent view does not require re-cutting identity later.

## 10. `auth_events` — the security record

```sql
CREATE TABLE IF NOT EXISTS auth_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  environment TEXT NOT NULL, event TEXT NOT NULL,
  outcome TEXT,                          -- success | failure | denied
  actor_kind TEXT, actor_id BIGINT,      -- accounts.id or operators.id, untyped on purpose
  subject_kind TEXT, subject_id BIGINT,
  reason TEXT,                           -- failure_reason, denied resource, lock reason
  ip_address INET, user_agent TEXT, occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_events_time  ON auth_events(environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_events_event ON auth_events(environment, event, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_events_actor ON auth_events(actor_kind, actor_id, occurred_at DESC);
```

**`actor_id` carries no foreign key on purpose.** A failed sign-in for an address with no account has
no row to point at, and an event must survive the deletion of its subject — the same reason Talent's
log tables carry no FKs to its business database (R1-doc §5). `actor_kind` types it. **Vocabulary**:
the thirteen FR-2501 names plus five more, mapped in
[contracts/analytics.md](./contracts/analytics.md). **No password material, ever** — not the attempted
password, not its length, not a hash of it.

## 11. `operator_reads` — the audit its subject cannot erase

```sql
CREATE TABLE IF NOT EXISTS operator_reads (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operator_id BIGINT NOT NULL REFERENCES operators(id),
  student_id BIGINT NOT NULL,   -- NO foreign key: it outlives the student (FR-2306)
  session_id BIGINT,            -- NULL for a 360 open, set for a transcript open
  surface TEXT NOT NULL,        -- student_360 | session_timeline | session_replay
  reason TEXT, environment TEXT NOT NULL, occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_operator_reads_student  ON operator_reads(student_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_operator_reads_operator ON operator_reads(operator_id, occurred_at DESC);
```

**`student_id` deliberately carries no FK.** FR-2306 requires the record to survive deletion of the
student's account, because it records what an operator did, not who the student was: `ON DELETE
CASCADE` would erase the audit with its subject and a restricting FK would block the deletion.
**Unerasable by privilege, not by policy text**: `ainext_operator` gets `SELECT` and `INSERT` and
**no `UPDATE` or `DELETE`** (§14). An audit log the audited party can erase is decoration
(ADR-0015 §4).

## 12. `ai_interactions`, `cost_daily`, and the ledger fixes

```sql
ALTER TABLE ai_interactions
  ADD COLUMN IF NOT EXISTS outcome          TEXT NOT NULL DEFAULT 'ok',
  ADD COLUMN IF NOT EXISTS price_basis      TEXT NOT NULL DEFAULT 'cli-list-price',
  ADD COLUMN IF NOT EXISTS priced_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS renderer_version TEXT;
-- outcome IN ('ok','error','timeout','redacted','refused')

CREATE TABLE IF NOT EXISTS cost_daily (
  environment TEXT NOT NULL, student_id BIGINT NOT NULL,
  day DATE NOT NULL, surface_kind TEXT NOT NULL,
  turns INT NOT NULL, input_tokens BIGINT NOT NULL, output_tokens BIGINT NOT NULL,
  cache_read_tokens BIGINT NOT NULL, cache_creation_tokens BIGINT NOT NULL,
  cost_usd NUMERIC(12,6) NOT NULL,
  latency_p50_ms INT, latency_p95_ms INT, errors INT NOT NULL DEFAULT 0,
  PRIMARY KEY (environment, student_id, day, surface_kind)
);
```

**Two write-path defects are fixed at the same time, in code not schema** (research A0, both
re-verified): `input_tokens` stops being `input + cache_creation + cache_read`
(`api/ask/route.ts:446-447`) and becomes uncached input only, the two cache counters beside it as
they already are; and the sacred-guard redaction path stops writing literal zeros
(`api/ask/route.ts:411-412`), recording real tokens and cost with `outcome='redacted'`.

**`price_basis` and `priced_at` exist because the runtime is a subscription, not an API key**
(research A4.4): `cost_usd` is an imputation at published list price, not money that left a bank
account, and every console figure says so. **`cost_daily` is a table** — refreshed for closed days,
unioned with a live query for today — because a view would re-scan the highest-volume student table
on every render and the percentiles are not cheap. **`renderer_version`** is the app's release tag at
write time, so a replay that no longer matches what the student saw can be recognised rather than
believed (ADR-0015 §3).

## 13. `environment` on the eight tables that lack it

Constitution XI, R3-doc §1. Eight of ten student-scoped tables have no `environment`: `students`,
`attempts`, `mastery`, `sessions`, `safety_flags`, `uploads`, `understanding_checks`,
`explanation_log`. Migration `012` adds it to all eight with `DEFAULT 'mvp1'` — correct because these
migrations exist only on this branch — backfills, and keeps the default so a forgotten INSERT cannot
produce a NULL.

## 14. RLS policy matrix

Roles: **`ainext_app`** (student surfaces; principal `app.student_id`), **`ainext_operator`** (the
console — role checks in the application, the database grants the read), **`ainext_maint`**
(`BYPASSRLS`; loaders, `parity_check.py`, rollups, backfills — never the app). `ENABLE` **and**
`FORCE ROW LEVEL SECURITY` on every table below, because the owner bypasses otherwise (research R6.3).

| Table | `ainext_app` | `ainext_operator` | Notes |
|---|---|---|---|
| `students` | S/U where `id = app.student_id` | S all; U only `subscription_*` | `status='legacy'` rows have no account, so no principal ever matches them (A10) |
| `accounts` | S/U where `id = students.account_id` for the principal | S all, no password_hash in any console query | insert only via the unauthenticated signup path, which runs as `ainext_maint`-equivalent under a dedicated grant |
| `auth_sessions` | S/U/D where the row is the principal's | S all | a student lists and revokes only their own (FR-2009) |
| `verification_tokens`, `password_resets` | no grant | no grant | consumed only by the auth routes under their own grant; never readable from a session-bearing request |
| `attempts` | S/I where `student_id = app.student_id` | S all | append-only: no U/D grant to anyone but `ainext_maint` |
| `mastery` | S/I/U where `student_id = app.student_id` | S all | U is the bitemporal row-close, not a mutation of history |
| `sessions` | S/I/U where `student_id = app.student_id` | S all | |
| `ai_interactions` | S/I where `student_id = app.student_id` | S all | append-only; the `/pipeline` cross-student read is deleted (FR-2104) |
| `understanding_checks` | S/I where `student_id = app.student_id` | S all | |
| `uploads` | S/I/U where `student_id = app.student_id` | S all | `parseUpload` runs under the principal it was started for (FR-2105) |
| `analytics_events` | S/I where `student_id = app.student_id` **or** `student_id IS NULL` | S all | append-only; anonymous rows are writable, readable only by the operator role |
| `safety_flags` | I where `student_id = app.student_id` | S all | students never read their own flags |
| `explanation_log` | S/I where `attempt_id IN (SELECT id FROM attempts)` — i.e. through the policy already on `attempts` | S all | **no `student_id` column** (§4e-1); a NULL `attempt_id` belongs to no student and is operator-only |
| `auth_events` | no grant | S all | written by the auth routes under their own grant; append-only |
| `operator_reads` | no grant | **S + I only, no U, no D** | the audit its subject cannot erase (FR-2306) |
| `operators`, `operator_roles` | **no grant at all** | S; I/U only through the role-granting path | a student principal cannot see that operators exist |
| `cost_daily` | no grant | S all | written by `ainext_maint` |
| `guardians` | S where `student_id = app.student_id` | S all | nothing writes it this release |
| content tables (`graph_nodes`, `graph_edges`, `questions`, `visuals`, `misconceptions`, `explanation_library`) | S | S | **no policies** — curriculum is not student data, and `parity_check.py` must keep reading it |
| `course_availability` *(023, added after this matrix)* | S | S/I/U | **no policies** — a (course, grade) rule is product configuration, not student data (ADR-0018) |
| `student_course_access` *(023)* | S where `student_id = app.student_id` | S/I/U/D all | a per-student override of the course gate, set from the console |
| `feedback` *(025)* | S/I/U where `student_id = app.student_id` | S all | read by the console's Feedback page |
| `student_progress` *(028, ADR-0020)* | S/I/U where `student_id = app.student_id` — **no D** | **no grant** | the lesson pointer is monotonic, so nothing deletes it; no console surface reads it, so the operator has no read to enumerate (add the grant, the policy and a `CROSS_STUDENT_READS` entry together when one does) |
| `student_testers` *(030, ADR-0021)* | **S only**, where `student_id = app.student_id` | S/I all; U only `unmarked_at`, `unmarked_by`; **no D** | the test-account mark; the student surface reads its own (the probing resolver needs it) and can never set it — the reason it is not a `students` column (FR-3107). A trigger (`student_testers_close_once`, every role) lets the two "removed" columns go from NULL to a value once and nothing else change, so a removed mark is never reopened or rewritten |
| `teaching_settings` *(030)* | S | S/I/U | **no policies** — the teaching switch is product configuration, like `course_availability`; no row means off |
| `teaching_setting_changes` *(030)* | **no grant** | **S + I only** | the switch's history, append-only by privilege (FR-3110) |
| `sessions.probing`, `sessions.release_tag` *(030)* | written at INSERT only | S | the per-lesson snapshot; a trigger refuses any UPDATE of either, for every role (FR-3105) |

**The enumerated cross-student reads** (FR-2108) are exactly the `ainext_operator` "S all" rows above
plus `cost_daily`; a read not on this list fails closed, because `ainext_app` has no policy that
permits it. The list also lives in one place in the application — `lib/auth/authorize.ts` names the
surface that may perform each.

## 15. Migration mapping

| Migration | Entities |
|---|---|
| `011-learning-sessions.sql` | §1 `sessions`; §2 session keys on five tables; the backfill |
| `012-environment-attribution.sql` | §13 — the eight backfills |
| `013-accounts-and-auth-sessions.sql` | §3 `accounts`; §4 `auth_sessions`; §5 tokens; §6 `auth_throttle`; `students.account_id`, `students.status` |
| `014-operators-and-roles.sql` | §7 `operators`, `operator_roles`; §11 `operator_reads` |
| `015-students-gender-status-guardians.sql` | §8 remaining `students` columns; §9 `guardians` |
| `016-auth-events.sql` | §10 `auth_events` |
| `017-rls-roles-and-policies.sql` | §14 — roles, grants, `ENABLE`/`FORCE`, every policy |
| `018-cost-ledger-and-rollups.sql` | §12 `ai_interactions` columns, `cost_daily`, the three overview views |
| `029-teaching-controls-role.sql` | the fifth role, granted once to active `content-review` holders (ADR-0021) — the vocabulary itself is widened in `014` |
| `030-teaching-toggle-and-testers.sql` | `student_testers`, `teaching_settings`, `teaching_setting_changes`, `sessions.probing` / `release_tag` and their trigger (ADR-0021) |

`017` is late because every table it protects must exist first; `011` is first because it is the only
gap losing data now (ADR-0015, plan.md P0).

## Entity relationships (delta only)

```
accounts 1─1 students ─1─* sessions ─1─* { ai_interactions, attempts,
                                           understanding_checks, uploads, analytics_events }
accounts 1─* auth_sessions *─1 operators   (exclusive arc — exactly one side set)
accounts 1─* verification_tokens, password_resets   ·   students 1─0..1 guardians (unfilled)
students 1─* mastery (bitemporal) · 1─* safety_flags · 1─* cost_daily (rollup, no FK)
operators 1─* operator_roles · 1─* operator_reads ─*─ students (by id, NO FK, outlives deletion)
attempts 1─* explanation_log               (the only path explanation_log has to a student)
```

## Validation rules from the requirements

- **FR-2001**: `students.account_id UNIQUE` — one account holds exactly one student.
- **FR-2003**: `password_hash` is Argon2id output; no console query selects it, and it appears in no log, event, error or URL.
- **FR-2004**: `email_verified_at IS NULL` refuses a lesson start and permits a sign-in; verification tokens are single-use and expire at 24 hours.
- **FR-2005 / FR-2010**: sign-in failure and forgot-password answer identically whether or not the address exists — enforced in the route, asserted by a test.
- **FR-2008**: `token_hash UNIQUE`; presenting a `rotated_from` value revokes every session for that principal.
- **FR-2011**: 5 failures per account in 15 minutes → `locked_until = now() + 15 minutes`; throttle and lock both emit events.
- **FR-2014**: every picker-era student ends `status='legacy'`, `account_id IS NULL`; no row deleted, no history removed.
- **FR-2101 / FR-2102**: no principal ⇒ no rows, by `nullif(current_setting(...))` returning NULL. The principal comes from the verified cookie, never a request parameter.
- **FR-2105**: `emit`, `parseUpload` and `flagAuthoringGap` each take an explicit student id.
- **FR-2109 / FR-2509**: `environment NOT NULL` on every table created here and on the eight backfilled.
- **FR-2203**: the `operator_roles.role` CHECK admits exactly five values (four until 2026-09-24; `teaching-controls` per ADR-0021); there is no "all" role.
- **FR-2301 / FR-2302**: the partial unique index permits one open session per student; `close_reason` distinguishes `completed` from `inactivity`.
- **FR-2306**: `operator_reads` has no FK to `students` and no UPDATE or DELETE grant to the role that writes it.
- **FR-2402**: `surface_kind` keeps `upload_parse` separable from `chat` and `understanding` at row level, so no query blends them by accident.
- **FR-2404**: no student-facing query reads `subscription_status`; a test asserts it.
- **FR-2603 / FR-2604**: no selector, difficulty or retrieval query reads `gender`; it reaches the prompt only through the address block, and no event property or log line carries it.
