# TalentReletix auth & admin-observability pattern reference

Source: `samtoma/TalentReletix` (private), read exclusively via
`gh api repos/samtoma/TalentReletix/contents/<path> --jq .content | base64 -d`. No clone, no
code copied into this repo — this is a pattern reference for `specs/002-identity-and-admin-console/`
(ADR-0012, ADR-0013, ADR-0014). All line numbers below are as of the `master` branch on
2026-09-20.

Files read in full: `backend/app/core/security.py`, `backend/app/core/session.py`,
`backend/app/api/deps.py`, `backend/app/api/v1/auth.py` (all 13 endpoints),
`backend/app/api/v1/google_auth.py`, `backend/app/api/v1/sso.py` (Microsoft — read for the same
upsert pattern, not separately requested but confirms it), `backend/app/models/models.py`,
`backend/app/core/security_logger.py`, `backend/app/core/logging_middleware.py`,
`backend/app/core/llm_logging.py`, `backend/app/models/log_models.py`,
`docs/architecture/SECURITY_ARCHITECTURE.md`, `docs/architecture/OBSERVABILITY.md`,
`docs/architecture/DATA_ARCHITECTURE.md`, `frontend/src/context/AuthContext.jsx`,
`frontend/src/components/admin/tabs/SecurityTab.jsx`, `.../LLMMonitoringTab.jsx`,
`backend/app/api/v1/admin.py` (2601 lines — grepped for `@router.*`/`def`, then read the
relevant sections). Also read `backend/app/api/v1/applications.py`, `jobs.py`, `interviews.py`,
`cv.py`, `departments.py` to verify the 404-not-403 and role-check claims against real code
rather than the docs, since the docs and code disagree in places (noted below).

---

## 1. Account & session model

**`User`** (`models.py:69-98`): `id, email (unique, case-insensitive via a functional index —
see below), full_name, hashed_password, is_active (bool), status, role, department, company_id,
sso_provider, sso_id, is_verified (bool), profile_picture, feature_flags (JSON text),
login_count (int, default 0), permissions (JSON text)`. No lockout fields (no
`failed_login_count`, no `locked_until`) — see §5.

- **Hashing**: `passlib.CryptContext(schemes=["argon2"])` (`security.py:51`) — Argon2id via
  passlib's default. Never plaintext, never reversible.
- **Encryption**: a Fernet key (`ENCRYPTION_KEY`) is wired up in `security.py:37-41` for
  encrypting sensitive fields (used elsewhere for `CalendarConnection.access_token` /
  `refresh_token`, not for the auth tables themselves).
- **Case-insensitive email**: the column type lowercases on write; a *second*, independent
  guarantee is a Postgres functional unique index — `Index("ix_users_email_lower",
  func.lower(User.email), unique=True)` (`models.py:111`) — so a raw INSERT that bypasses the
  ORM still cannot create a case-variant duplicate. Worth mirroring verbatim.
- **`UserStatus`** (`models.py:20-24`): `active | deactivated | suspended | pending`. `pending`
  is used for the domain-based company-join gate (§2), not for email-unverified — verification
  is tracked separately on `is_verified`.

**`UserSession`** (`models.py:308-335`) — one row per device/login, not per token:
```
id, user_id (FK, CASCADE), token_hash (sha256 hex, 64 chars, unique, indexed),
expires_at, created_at, last_used_at, user_agent, ip_address (45 chars, IPv6-safe),
device_name (heuristic string parse of user_agent), is_revoked (bool), revoked_at
```
The raw refresh token is `secrets.token_urlsafe(32)` (`session.py:7-9`); only
`hashlib.sha256(token).hexdigest()` is ever stored (`session.py:11-13`) — **not** a bcrypt/argon2
hash, because it's a high-entropy random token, not a password. **Rotation is in-place**:
`rotate_session()` (`session.py:64-83`) does not create a new row — it overwrites
`token_hash` and pushes `expires_at` forward on the *same* `UserSession` row. So the "sessions"
list a user sees (`GET /sessions`) is genuinely one row per logged-in device, continuously
rotated, not a growing table of every refresh.

**`PasswordResetToken`** (`models.py:254-265`): `id, token (uuid4 string, unique), user_id (FK
CASCADE), expires_at, used (bool), created_at`. Token is a bare `uuid.uuid4()` string
(`auth.py:604`), not hashed at rest — lower-value than a session token (single-use, 1h TTL) but
worth deciding deliberately rather than copying.

**No dedicated email-verification-token table.** Verification tokens are just JWTs with
`{"sub": email, "type": "verification"}`, 24h expiry, signed with the *same* `SECRET_KEY` as
access tokens (`auth.py:138-141`, `:371`). `verify_email` (`auth.py:378-399`) decodes and checks
`type == "verification"`, then flips `user.is_verified = True`. Stateless — nothing to revoke if
a verification email leaks, other than waiting out the 24h.

**`UserInvitation`** (`models.py:339-376`): the company-admin-invites-a-teammate flow —
`email, token, role, department, company_id, status (pending|sent|accepted|expired|cancelled),
sent_at, expires_at, accepted_at, invited_by, invited_user_id, email_sent, email_sent_at,
email_error, extra_metadata`. Not exercised by anything in scope for AI.NEXT's MVP 1 release
(no company concept), but its shape is the closest analog to a future parent-invite flow
(D1, deferred).

**Lifetimes and cookie attributes — code is authoritative, not the architecture doc**
(`security.py:26-35`):
```python
ACCESS_TOKEN_EXPIRE_MINUTES = 15
REFRESH_TOKEN_EXPIRE_DAYS = 30
REFRESH_TOKEN_SLIDING_WINDOW_DAYS = 7   # rotate_session() extends by this, not by 30d, on each use
REFRESH_TOKEN_COOKIE_PATH = "/api/auth"
REFRESH_TOKEN_COOKIE_SECURE = os.environ.get("ENVIRONMENT","development") != "development"
REFRESH_TOKEN_COOKIE_HTTPONLY = True
REFRESH_TOKEN_COOKIE_SAMESITE = "lax"
```
**Correction to `SECURITY_ARCHITECTURE.md` itself**: that doc's
auth table (line 56) says "Access 24h... `SameSite=Strict`". The code says 15 minutes and
`SameSite=lax`. The doc is stale; I trust the code (confirmed independently by the frontend's
own comment in `AuthContext.jsx:60` — *"This threshold MUST be less than
ACCESS_TOKEN_EXPIRE_MINUTES (15 min)"* — and by its refresh-scheduling math, which only makes
sense at 15 minutes).

**Bigger correction, load-bearing for ADR-0013**: D9's phrasing (`decisions.md`; "short-lived access
token + rotating refresh token in HttpOnly cookies") overstates what Talent does. Only the
**refresh** token is an HttpOnly cookie. The **access** token is returned in the JSON response
body (`Token` schema, `auth.py:37-49`) and the SPA stores it in `localStorage`, attaching it
itself as `Authorization: Bearer <token>` on every request via an axios interceptor
(`AuthContext.jsx:92-95, 331-339`). `deps.py:13` confirms: `OAuth2PasswordBearer(tokenUrl=...)`
reads the header, not a cookie. This is a real XSS exposure surface in Talent (any script
injection can read `localStorage.token`) — not something to mirror. AI.NEXT's Next.js route
handlers can read an HttpOnly cookie server-side directly, so there is no architectural reason
to put the access token anywhere a client script can reach it. **Recommendation for
ADR-0013: both tokens HttpOnly, not just the refresh token.**

**Lockout**: there is no account-lockout mechanism despite `account_locked` existing as a named
security event (§5) — see there for why.

**`login_count`**: incremented on every successful login, both password (`auth.py:274`) and
Google OAuth (`google_auth.py:156`) — a simple counter, no other telemetry attached to it.

---

## 2. Flows, step by step

**Signup** (`POST /auth/signup`, `auth.py:52-194`)
1. 400 if the email already exists (`get_user_by_email`).
2. 400 if the email's domain is a public mailbox provider (gmail/yahoo/outlook/hotmail/
   icloud/protonmail — `is_public_email_domain()`, `core/constants.py`) — public-domain users
   cannot self-create a company; they need an invitation.
3. Domain extracted from the email; `Company` looked up by `domain`.
   - No existing company → new `Company` row created, this user becomes `role=admin`,
     `status=active`.
   - Existing company → this user becomes `role=interviewer`, `status=pending`, and a
     background task emails every existing admin of that company a pending-approval notice.
4. Verification JWT (24h) queued as a background email regardless of branch.
5. Pending users get **no access token** (empty string) and a `pending_approval: true` flag in
   the response; non-pending users get a 15-minute access token immediately (i.e. **you are
   logged in before you verify your email** — verification gates nothing at signup time, only
   surfaces later if some other check requires `is_verified`).
6. Structured audit log (`auth_logger`, not `security_logger`) either way.

**Email verification** (`GET /verify?token=`, `auth.py:378-399`)
1. 400 `INVALID_TOKEN_MSG` if the JWT doesn't decode, or `type != "verification"`.
2. 404 if the `sub` email doesn't match a user.
3. `is_verified = True`. No session created, no redirect logic here (frontend handles it).

**Login** (`POST /auth/login`, `auth.py:196-336`)
1. 401 if the user doesn't exist or the password doesn't verify — logs `failed_login` either
   way, same message, same status (no user-enumeration signal on this path).
2. 403 if `is_active` is false ("Account is deactivated") — logs `failed_login`.
3. 403 if `is_verified` is false ("Email not verified") — logs `failed_login`. **Note**: this
   means an unverified user who never clicks the email link cannot log in after their first
   session expires, but the signup flow above *did* hand them a working access token — an
   internal inconsistency worth deciding on purpose for AI.NEXT rather than inheriting.
4. On success: new 15-minute access token; a `UserSession` row created (`create_session`);
   `login_count` incremented; both an `ActivityLog` row and an `auth_logger` action logged;
   `SecurityLogger.log_successful_login` fired; refresh-token cookie set with the attributes
   from §1.

**Refresh** (`POST /auth/refresh`, `auth.py:401-492`)
1. 401 if no refresh cookie.
2. 401 (and the invalid cookie is cleared) if `validate_refresh_token` finds no matching,
   unrevoked, unexpired `UserSession`.
3. 401 if the session's user no longer exists; 403 if `is_active` is false.
4. Otherwise: `rotate_session()` (in-place, §1) issues a new refresh token and slides the
   expiry to `now + 7 days`; a fresh 15-minute access token is minted; both go back to the
   client (new cookie + JSON body). Any unhandled exception is caught and turned into a
   generic 500 (`auth.py:487-492`) rather than leaking internals.

**Logout / logout-all**
- `POST /auth/logout` (`auth.py:494-505`): revokes *only* the session matching the current
  refresh cookie (if any), clears the cookie. No auth required — a stolen/expired cookie can
  still be used to revoke itself, which is fine since revoking is the safe direction.
- `POST /auth/logout-all` (`auth.py:507-517`, **requires** `get_current_user`, i.e. a valid
  access token): bulk-updates every non-revoked `UserSession` row for the user.

**Sessions list / revoke**
- `GET /auth/sessions` (`auth.py:519-538`): lists the caller's own non-revoked, unexpired
  sessions — id, device_name, ip_address, last_used_at, created_at. No token material returned.
- `DELETE /auth/sessions/{id}` (`auth.py:540-557`): 404 if the session doesn't exist **or**
  belongs to someone else (`UserSession.user_id == current_user.id` is baked into the query —
  the same 404-not-403 pattern as §4, applied to a user's own resource boundary).

**Forgot / reset password**
- `POST /auth/forgot-password` (`auth.py:583-638`): **always** returns the same
  "if an account exists..." message whether or not the email is registered — the one deliberate
  user-enumeration defense in this file, called out in the code's own comments as `AUTH-007`.
  If the user exists: a `uuid4` token, 1h expiry, stored in `PasswordResetToken`; the reset
  email is dispatched from inside a background task with its own try/except so a delivery
  failure can never leak through this endpoint's response (comment cites `AUTH-012`).
- `POST /auth/reset-password` (`auth.py:641-704`): 400 for a token that doesn't exist, is
  already used, or is expired (three distinct messages — this endpoint does *not* apply the
  enumeration defense, since by this point the token itself is the secret, not the email). On
  success: password updated, `is_verified` force-set true, and if the user's status was
  `pending` (i.e. they came from an invitation) it flips to `active` and the matching
  `UserInvitation` is marked `accepted`. An `ActivityLog(action="password_reset")` row is
  written — **not** `SecurityLogger.log_password_change`, which exists but is never called
  (§5).

**Google OAuth** (`GET /auth/google/login`, `GET /auth/google/callback`, `google_auth.py`)
1. `/login` redirects to Google via `fastapi_sso.GoogleSSO`.
2. `/callback` exchanges the code; on any SSO failure it **redirects** to
   `{FRONTEND_URL}/login?error=sso_failed&details=...` rather than raising — errors surface as
   a frontend query param, not an HTTP error status.
3. Upsert rule: look up by normalized email.
   - Not found: public-domain block re-applied (redirect `error=public_domain`); otherwise a
     new `User` is created with `sso_provider="google"`, `sso_id=<google id>`,
     `is_verified=True` (SSO is trusted to have verified the email already), a random 20-char
     password nobody will ever use, and the same domain → company → admin-or-pending logic as
     password signup.
   - Found: if the user had no `sso_id` yet, this login **links** the account
     (`sso_provider`/`sso_id`/`is_verified` set) rather than erroring on a pre-existing
     password account with the same email.
4. **Asymmetry worth flagging**: unlike password login, the OAuth callback **never calls
   `create_session`** — no `UserSession` row, no refresh cookie. It mints only the 15-minute
   access token and puts it, plus user id/role/name/picture, as **plaintext query-string
   parameters on the redirect URL** (`google_auth.py:185-196`). That means Google-authenticated
   users have no working `/auth/refresh` path (nothing to refresh from) and their access token
   is exposed in browser history, any referrer-forwarding proxy, and server access logs on the
   redirect hop. This is a gap to design out, not mirror: an OAuth login should end at the same
   `create_session` + HttpOnly-cookie call as password login, with the frontend receiving
   *only* a redirect and no token in the URL.
5. Microsoft SSO (`sso.py`) follows an identical shape (own upsert, own random-password,
   own token-in-URL redirect) — confirms this is a consistent pattern across providers, not a
   one-off.

**`GET /me`** (`auth.py:559-581`): requires `get_current_user`; returns id, email, role,
company_id, department, is_active, a `version` string (company's `last_data_update`, used by
the frontend to know when to invalidate cached company-scoped data), and `feature_flags`. No
session/token metadata is returned here — that's `/sessions`' job.

---

## 3. Authorisation

`get_current_user` (`deps.py:15-63`): decodes the bearer JWT, requires a `sub` claim, maps
`jwt.ExpiredSignatureError` to a distinct 401 message, any other `JWTError` or malformed token
to a generic 401, then does one more DB hit to confirm the user still exists (`deps.py:58-61`)
— so a JWT signed before a user was deleted stops working immediately rather than surviving
until its `exp`. A second variant, `get_current_user_flexible` (`deps.py:65-102`), accepts the
token as a query parameter as a fallback for iframe contexts where headers can't be set —
noted only because it's a real widening of the attack surface (token in a URL again) that
exists for a narrow embedding use case; nothing in AI.NEXT's plan needs this.

**`require_role` does not exist as a reusable primitive.** `SECURITY_ARCHITECTURE.md:48,104`
both assert `Depends(require_role(...))` as the enforcement mechanism. It is not in `deps.py`,
not in `security.py`, and a full-repo code search for `def require_role` returns nothing —
**the documentation describes a pattern the code does not actually have.** What the code
actually does, verified in `applications.py`, `jobs.py`, `interviews.py`, `departments.py`,
`admin.py`:
- A single reusable helper, `require_super_admin(current_user)` (`admin.py:246-249`), called
  at the top of every one of admin.py's ~19 endpoints. It is the *only* generic role guard in
  the codebase, and it checks exactly one role.
- Everywhere else, role checks are ad hoc and inline per endpoint —
  `if current_user.role == UserRole.INTERVIEWER: ... raise HTTPException(403, ...)`
  (`applications.py:163-170`), `if current_user.role not in (...): raise HTTPException(403,
  "Not authorized to create jobs")` (`jobs.py:657`), repeated with small variations in at
  least six more places. There is no shared decorator, dependency factory, or central role
  matrix enforced in code — `docs/wiki/ROLE_PERMISSIONS.md` (referenced but not required
  reading here) is the closest thing to a source of truth, and it is documentation, not code.

**Implication for AI.NEXT (D4, four roles)**: do not defer building a real `requireRole(...)`
primitive the way Talent did. Talent has exactly one enforced role (`super_admin`, gating the
entire admin surface as a monolith) plus scattered, inconsistent per-endpoint role checks
everywhere else, and its own architecture doc misdescribes what's actually enforced. AI.NEXT's
four roles need a single, testable guard used identically at every admin route from day one.

**The 404-not-403 rule is real, well-established, and internally named** (`TEN-002` — cited
at `jobs.py:41`, `interviews.py:359,461`) but it is narrower than "cross-tenant reads return
404": it applies specifically to **lookups**, where the company filter is baked directly into
the query (`db.query(Job).filter(Job.id==job_id, Job.company_id==current_user.company_id)
.first()`, `jobs.py:469`) so a cross-company id and a nonexistent id are indistinguishable —
both just `.first() is None` → 404. **Mutations behave differently on purpose**: a write
endpoint typically looks up the target *without* the tenant filter first (so it can give an
honest 404 when the id is simply wrong), then explicitly compares `target.company_id !=
current_user.company_id` and, if so, calls `_deny_cross_company()` (`applications.py:84-104`),
which **logs a `cross_company_access_denied` security event and raises 403** — a deliberate,
audited signal, not a silent 404. `interviews.py:359-365` has the read-path version narrated
in its own comment: *"Company ownership check — 404 to avoid leaking that the interview
exists."*

**Frontend `RoleProtected` is explicitly not a boundary** — `SECURITY_ARCHITECTURE.md:104`
states it plainly: *"Frontend `RoleProtected` hides UI but is not the security boundary."* It
exists in `frontend/src/AppRoutes.jsx` purely to avoid rendering controls a user shouldn't see;
every actual enforcement point is server-side as described above.

---

## 4. Isolation — the correction

Samuel's words were "row level security … same as reletix." **Verified: TalentReletix does
not use Postgres RLS.** Evidence:
- `docs/architecture/DATA_ARCHITECTURE.md:73-74` states it directly: *"`company_id` is on
  every tenant table — every query filters on it (recently hardened by PR #63 IDOR fixes)."*
  No mention of `ROW LEVEL SECURITY` or `CREATE POLICY` anywhere in that document or
  `SECURITY_ARCHITECTURE.md`.
- Every model that needs tenant scoping carries a plain `company_id` FK column
  (`models.py`: `User.company_id:79`, `Job.company_id:156`, `CV.company_id:196`, via
  `Department`/`Application`/`Interview` transitively through their parent).
- Every read/write path I opened (`applications.py`, `jobs.py`, `interviews.py`, `cv.py`,
  `departments.py`) enforces tenancy by adding `.filter(X.company_id ==
  current_user.company_id)` to the SQLAlchemy query, or by an explicit equality check after
  the fetch (§3). This is **application-code filtering**, not a database-enforced guarantee —
  a forgotten filter on a new endpoint returns another company's rows rather than nothing.
- `SECURITY_ARCHITECTURE.md:44` confirms this was a real, exploited-in-development gap: *"PR
  #63 closed cross-company IDOR (`applications.py`, `interviews.py`, `cv.py`,
  `departments.py`)"* — i.e. the current filter-everywhere discipline exists **because** an
  IDOR was found and fixed by hand, not because the database ever refused the query.
- I grepped for RLS explicitly (`ROW LEVEL SECURITY`, `CREATE POLICY`, `ENABLE ROW LEVEL
  SECURITY`) across the Alembic migration history via GitHub code search and found nothing.

Samuel's *intent* — a database-enforced guarantee where "a forgotten filter returns nothing,
never another student's rows" — is **stronger than what Talent has**, not a description of it.
State this plainly in `0012-per-student-isolation-rls.md`: AI.NEXT is not adopting Talent's
isolation model, it is fixing the exact class of bug (PR #63) that Talent's model already
proved it's vulnerable to, by moving the guarantee into Postgres.

---

## 5. Security-event vocabulary

All routed through `SecurityLogger` (`security_logger.py`) → `AuditLogger("security")`
→ Redis `logs_queue` → `unified_log_worker` → `system_logs` (component `audit.security`,
per the module's own docstring at `security_logger.py:16,28`). Seven static methods exist;
**only three are ever called from live request-handling code** — the other four are defined,
unit-tested (`backend/tests/test_security_logger.py`), and otherwise dead:

| Event (`action=`) | Fields carried | Actually called from |
|---|---|---|
| `failed_login` | `user_email, company_id, ip_address, user_agent, failure_reason` | `auth.py` login, 3 call sites (bad credentials / deactivated / unverified) — **live** |
| `successful_login` | `user_id, user_email, company_id, ip_address` | `auth.py:297` login success — **live** |
| `cross_company_access_denied` | `user_id, user_email, company_id (attacker's), target_company_id, resource ("type:id"), attempted_action, ip_address, severity="high"` | `applications.py:_deny_cross_company` and equivalents in `interviews.py` — **live** |
| `suspicious_activity` | `user_id, ip_address, severity, activity_type, **details` | defined only — **never called** |
| `password_changed` | `user_id, user_email, company_id, ip_address` | defined only — **never called** (reset-password writes a plain `ActivityLog` instead, §2) |
| `account_locked` | `user_id, user_email, company_id, lock_reason` | defined only — **never called**; there is no lockout logic anywhere to call it from |
| `permission_denied` | `user_id, company_id, resource, attempted_action, ip_address` | defined only — **never called**; the ~403s scattered through `jobs.py`/`applications.py`/`interviews.py` (§3) raise `HTTPException` directly and do not also log |

**Practical reading for AI.NEXT**: the vocabulary is a good list of *names* to reuse, but
Talent is proof that defining an event is not the same as emitting it. FR-2501 should require
each listed event to have a passing test asserting it fires, not just exist as a static method.

**Request-id middleware**: `LoggingMiddleware` (`logging_middleware.py:54-224`) generates a
`uuid4` per request (`request.state.request_id`), strips `authorization`/`cookie`/`x-api-key`
from logged headers, skips health/docs/metrics paths and a hand-maintained list of LLM-endpoint
path fragments (so those go to `llm_logs` instead, via a separate call site — not through this
middleware), and pushes one JSON log line per request to Redis from a bounded thread pool
(`LOG_THREAD_POOL_SIZE`, default 2) so logging never blocks the response. On an unhandled
exception it logs the stack trace and **re-raises** — the middleware observes, it doesn't
swallow.

**How events reach the logs DB**: every logger (security, LLM, request/response) pushes JSON
to the same Redis list `logs_queue`; a single Celery worker (`unified_log_worker.py`, not
read directly but referenced consistently across `OBSERVABILITY.md` and `DATA_ARCHITECTURE.md`)
pops, validates, and inserts into `system_logs` or `llm_logs` depending on a `log_type`/`kind`
field in the payload, in the **separate** `talent_reletix_logs` Postgres database (same
instance, different DB — §7). A malformed payload is dropped with a stdout warning rather than
re-queued, specifically to avoid a poison-message loop.

---

## 6. LLM cost logging

`LLMLogger.log_llm_operation()` (`llm_logging.py:56-143`) is the single call site every model
call is expected to go through. It takes `action, model, tokens_used|tokens_input+tokens_output,
latency_ms, streaming, error_type/message, metadata`, computes `cost_usd` from a **hardcoded
in-code pricing table** for OpenAI models only (`llm_logging.py:165-186` — gpt-4o-mini,
gpt-4o, gpt-4-turbo, gpt-4, gpt-3.5-turbo, two embedding models; anything else silently gets no
cost), and pushes to the same `logs_queue` with `log_type: "llm"`.

**The `llm_logs` table does not have flat columns for most of this**, despite
`DATA_ARCHITECTURE.md:86` listing `tokens_input, tokens_output, latency_ms, streaming, model` as
if they were columns. The actual model (`log_models.py:50-78`) only has:
```
id, created_at, level, component ("llm"), action, message,
user_id, company_id, interview_id, error_type, error_message,
extra_metadata (JSONB), deployment_version, deployment_environment
```
`model`, every token count, `latency_ms`, `streaming`, and `cost_usd` all live **inside**
`extra_metadata` as a JSON blob built by `llm_logging.py:96-113`. `admin.py`'s
`get_llm_metrics` (`admin.py:2053-2360`, `require_super_admin`-gated) confirms this the hard
way: it fetches every matching row and **loops in Python** parsing `extra_metadata` to
accumulate tokens/cost, rather than running a SQL aggregate over real columns
(`admin.py:2112-2122` onward). This is a real cost/scale limitation in Talent's design, not
just a docs typo — flag it as something to *not* repeat.

**What the LLM Monitoring tab actually shows** (`LLMMonitoringTab.jsx`): total operations
(all-time + last-24h), total/input/output tokens, average latency (all-time + 24h), error rate
%, an "operations by model" grid, and a recent-operations table (time, action, model, tokens,
latency, success/error, user). **`cost_usd` is computed server-side but never rendered in this
tab** — no dollar figure appears anywhere in the UI despite the backend calculating it per
operation. The company filter dropdown is a hardcoded stub (`<option value="1">Company
1</option>`, with a `// TODO: Fetch companies dynamically` comment,
`LLMMonitoringTab.jsx:55-57`) — a concrete example of "ugly but functional" admin tooling that
AI.NEXT should not read as a bar to clear, only as evidence that an admin tool this shape is
acceptable to ship.

**AI.NEXT is already ahead of this pattern**: `ai_interactions` (per `docs/PROJECT_STATE.md`
facts) has flat `input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
cost_usd, latency_ms` columns per row. Keep that; it is strictly better than Talent's
JSONB-blob-plus-Python-loop approach and should be the basis for AI.NEXT's own cost dashboard,
with the one correction of actually displaying `cost_usd` to the admin, which Talent's own
tab conspicuously does not.

---

## 7. Admin observability

Nine tabs (`frontend/src/components/admin/tabs/`): `OverviewTab, LogsTab, ErrorsTab,
ActivityLogsTab, AlertsTab, SecurityTab, LLMMonitoringTab, HealthHistoryTab, InvitationsTab`.
`SecurityTab.jsx` renders whatever event list it's handed (action, severity badge, user,
company, target company, resource, attempted action, IP, a JSON metadata expando) — it has no
endpoint of its own; it's fed by the same `/admin/logs` list filtered to the security
component, consistent with `security_logger.py`'s own docstring example query.

**Every endpoint in `admin.py` gates on `require_super_admin(current_user)`** — I grepped all
of them; there is exactly one role permitted into any admin surface. AI.NEXT's four-role model
(D4) has no analog in Talent to mirror here — this has to be designed from scratch, not copied
(§9).

Confirmed endpoint list (grepped `@router.` in `admin.py`, full-file): `/logs` (GET, paginated + filtered
by level/component/action/company/user/date-range/text-search/has_error),
`/logs/stats`, `/logs/cleanup` (DELETE), `/invitations` (GET), `/invitations/stats`,
`/metrics`, `/errors`, `/health`, `/ux-analytics`, `/visitor-analytics`, `/database/stats`,
`/health/history`, `/business-metrics`, `/ws/monitoring` (a WebSocket — live push, not
polling), `/thresholds` (GET *and* POST — the only admin config surface that's writable),
`/llm/metrics`, `/activity-logs`, `/alerts`, `/sync/embeddings` (POST — an operational trigger,
not a read surface). `get_system_logs` (`admin.py:253-393`) is the fullest example of the
pattern: batch-fetches user/company names to avoid N+1s after the log query, returns
paginated results with a total count for the frontend's pager.

---

## 8. Known gaps Talent itself admits

Direct from `SECURITY_ARCHITECTURE.md`'s "Known gaps and remediation owners" table
(`:155-166`), condensed to what's relevant here:

- **No application-level rate limiter** anywhere — not on `/auth/*`, not on `/public/*`.
- **Refresh token rotation is not fully server-enforced**: the doc calls out that a leaked
  refresh cookie can be used to mint new tokens until it naturally expires; there is no
  single-use/jti-based invalidation beyond the in-place rotation already described (§1) — i.e.
  rotation happens, but nothing detects or punishes *reuse* of an already-rotated-away token
  (no "refresh token reuse ⇒ revoke the whole session family" logic).
- **CORS defaults to `allow_origins=["*"]`** in code; production only avoids this because the
  compose environment overrides it — a config-drift risk, not a code guarantee.
- **`/debug/*` endpoints exist behind an env flag only**, not a role check.
- No CV-file encryption at rest; no tamper-evident log store (logs are ordinary mutable
  Postgres rows); accessibility gaps in modals — noted for completeness, not relevant to auth.

None of these should be inherited. AI.NEXT's plan should at minimum: put a rate limiter on
`/auth/*` from the start (FR-2101/2501 territory), make refresh-token-reuse detection part of
the session design (D9's "designed now" phone+OTP path is a natural place to add a
reuse-triggers-revoke-all rule that Talent never built), and never let CORS/env-flag defaults
be the only thing standing between `/admin` and the internet — Cloudflare Access (D3) is
already stronger than anything Talent has here.

---

## 9. Mapping to AI.NEXT

| Talent concept | AI.NEXT equivalent | Forced differences |
|---|---|---|
| `User` (email+password, `company_id`, `role`) | `Student` account (D1) — email/password now, phone+OTP later (D9) | No `company_id`; the tenant/principal is the **student**, not a company. Add `gender` (D10), a `parent_id` nullable FK (D1, link only — no parent login yet), and a subscription/payment **status** field distinct from account status (D5 — Talent has nothing like this on `User`). Minors: store minimum (constitution VII) — no `full_name`-equivalent beyond display name already in `students`, no free-text `permissions`/`feature_flags` blobs. |
| `Company` (tenant boundary, domain-gated signup) | **None.** | AI.NEXT has no multi-tenant company concept — isolation is per-student (D2), not per-organization. The entire domain-extraction / auto-create-company / pending-admin-approval flow (§2) has no analog and should not be ported. |
| `UserSession` (hashed refresh token, in-place rotation, device metadata, revoke one/all) | A `sessions`-equivalent table, same shape, keyed to `student_id` | Direct port of the *pattern* — hash the token, rotate in place, keep device/IP metadata, support revoke-one and revoke-all. This is the one piece of Talent's design with no forced change. |
| `PasswordResetToken` | Same pattern, keyed to `student_id` | Consider hashing the token at rest (Talent doesn't) since AI.NEXT's data-minimum posture (VII) argues for treating even a 1h single-use token as worth protecting. |
| Stateless JWT email-verification token | Same pattern (JWT, `type` claim, no DB row) is fine | No change forced. |
| `UserInvitation` | Deferred architecture-only equivalent for the parent link (D1, FR-2901) | Not built this release. When built: a parent-facing token (email, not company-role), with acceptance creating the parent↔student link, never a login for the parent. |
| `get_current_user` (JWT decode + DB existence check, bearer header) | Next.js middleware/route-handler: decode an **HttpOnly** access-token cookie (not a header the client reads) + DB check, **and** set the RLS principal on the connection for the request (D2) | Two things Talent's version doesn't do: (a) access token never touches client-readable storage (§1 correction); (b) authenticating the request is not enough by itself — every DB transaction must also set `app.current_student_id` (or equivalent) so RLS policies apply. Talent has no second half here because it has no RLS. |
| Ad hoc `if current_user.role == X: raise 403` scattered per endpoint, plus one `require_super_admin` helper | A single `requireRole(...)` guard used identically at every admin route, covering all four roles (D4) from day one | Talent's own architecture doc claims a `require_role(...)` factory that the code doesn't have (§3) — a documentation/reality gap AI.NEXT should make structurally impossible by having exactly one guard, tested, and no inline role checks anywhere else. |
| 404-not-403 on cross-tenant **reads**; explicit 403 + security log on cross-tenant **writes** | Same rule, same asymmetry, applied to `student_id` instead of `company_id` | Direct port. With RLS (D2) the read-path 404 becomes almost free — a cross-student row simply isn't visible to the query at all, no manual filter to forget. The write-path explicit-403-and-log discipline (`_deny_cross_company` → `_deny_cross_student` or similar) still has to be written by hand, since RLS blocks the write but something still has to translate a blocked write into a 403 instead of a generic DB error, and log it. |
| Google OAuth: upsert-by-`normalize_email`, link an existing password account on first SSO login, `sso_provider`/`sso_id` columns | Same upsert rule, if/when Google sign-in is added for parents or students | **Do not** copy the token-in-URL-redirect pattern (§2) or the "OAuth login skips `create_session`" asymmetry — an OAuth login must end at the same session-creation + HttpOnly-cookie path as password login. Not required for D9's MVP 1 scope (email+password first) but the upsert *rule* is worth keeping when it lands. |
| `security_logger.py` event vocabulary (7 named events, 3 wired up) | Same event *names*, translated to student-scoped nouns (`cross_student_access_denied`, etc.) | Every event AI.NEXT lists must actually fire, with a test proving it (§5, §8) — Talent's four dead event types are the cautionary example, not the pattern to mirror. |
| `LoggingMiddleware` (`request_id`, header redaction, async-via-Redis) | Same pattern in Next.js middleware | No forced change; this is boring infrastructure Talent got right. |
| `LLMLogger` → `llm_logs` (JSONB-blob metadata, Python-loop aggregation, hardcoded OpenAI pricing, cost never shown in the UI) | Keep AI.NEXT's existing `ai_interactions` flat-column design (input/output/cache tokens, `cost_usd`, `latency_ms` as real columns) | Already better than Talent's approach — do not regress to a JSONB blob. Build the admin cost dashboard to *show* `cost_usd` (Talent's own tab omits it, §6), and since AI.NEXT uses the Claude CLI (no per-call API pricing response the way OpenAI's SDK gives one), the cost-calculation step has to be sourced differently — from Claude's own usage/cost reporting rather than a hardcoded price table guessed from a model name string. |
| Two Postgres databases (business + logs), same instance | Plan-level decision (out of scope for this doc) — worth considering for `/admin/logs` write volume once analytics events (D8) are high-frequency | Not a forced difference, a design option to weigh in `plan.md`: it buys blast-radius isolation (a runaway logging query can't starve the business DB's connection pool) at the cost of a second connection string and no cross-DB foreign keys (Talent's `system_logs`/`llm_logs` already have none, by design — `log_models.py`'s own comment: *"No Foreign Keys to Main DB"*). |
| Nine admin tabs, all gated by one role (`super_admin`) | Same tab *shapes* (Logs, Errors, Security, LLM Monitoring, Activity/Timeline, Alerts, Health, Overview), gated per-tab by AI.NEXT's four roles, not one | `content-review` and `evidence-access` need nothing Talent's admin has an analog for (question/content review, extraction provenance) — those are new. `student-data` maps closest to Activity Logs + a new interaction-timeline/replay view (D6) — Talent's `ActivityLogsTab` is company-wide activity, not a single-subject replay; AI.NEXT's version is a much deeper, more sensitive surface and needs its own operator-read audit log (D6: *every admin read of a student's transcript is itself logged*) with no Talent analog at all. `cost-billing` maps to LLM Monitoring + the existing `/admin/cost` view, extended per-student (D5). No `InvitationsTab` equivalent needed yet (parent-link is architecture-only, D1). |
| Phone + OTP (not in Talent; a note for D9) | A new `otp_codes`-equivalent table (student_id, code_hash, expires_at, used, attempts), verified once, then **falls into the exact same `create_session`/`UserSession` path as password or OAuth login** | No session-table schema change required to add this later — the session model is already provider-agnostic in Talent's design (a `UserSession` row doesn't care *how* the login happened, only that it did). This is the strongest argument for porting the `UserSession` shape verbatim now: D9's phone+OTP slots in without touching it. |
