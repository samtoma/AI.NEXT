# Contract: Authentication

**Modules**: `app/src/app/api/auth/*` · `app/src/lib/auth/{password,tokens,cookies,session,events,throttle,google,email}.ts`
**Tables**: `accounts`, `auth_sessions`, `verification_tokens`, `password_resets`, `auth_throttle`, `auth_events`, `operators`
**Mirrors**: TalentReletix's endpoint list (`research/talent-reletix-auth.md` §2), with its two
documented gaps fixed rather than copied
**Replaces**: the picker — `GET /api/demo-students`, `POST /api/demo-students`, `lib/demo-student.ts`

## Cookies

| Cookie | Holds | Attributes | Lifetime |
|---|---|---|---|
| `ainext_at` | signed access token (JWT, HS256) | `HttpOnly`, `SameSite=Lax`, `Secure` outside dev, `Path=/` | 15 minutes |
| `ainext_rt` | opaque refresh token (32 random bytes, base64url) | `HttpOnly`, `SameSite=Lax`, `Secure` outside dev, **`Path=/api/auth`** | `least(now + 7d, issued_at + 30d)` |

**Both are HttpOnly** (FR-2007). No token is ever returned in a response body, put in a URL, a
redirect, a page parameter or `localStorage`. Access-token claims: `sub` (principal id), `knd`
(`student | operator`), `stu` (student id — students only), `sid` (`auth_sessions.id`), `env`.

## Endpoints

All responses are `application/json` unless stated. Every endpoint emits at least one `auth_events`
row; the event column names the vocabulary in [analytics.md](./analytics.md).

### `POST /api/auth/signup`

Body: `{ email, password, displayName, grade, gender?, interests?[] }` — and nothing else. No parent
contact, no phone, no address, no school, no free text (FR-2002, constitution VII).

| Outcome | Status | Body | Cookies | Events |
|---|---|---|---|---|
| created | `201` | `{ accountId, studentId, emailVerified: false }` | both set | `account_created` (first-party), `email_verification_sent` |
| email already registered | `409` | `{ error: "email_unavailable" }` | none | `failed_signup` |
| weak password / invalid field | `422` | `{ error, field }` | none | — |
| throttled | `429` | `{ error: "too_many_requests", retryAfter }` | none | `suspicious_activity` |

A `201` signs the student in immediately with an **unverified** account: they reach a screen saying
what is outstanding, and no lesson starts (FR-2004, spec Assumptions). Talent is inconsistent here —
it issues a token at signup and then refuses login until verified (R1 §2) — and this resolves it on
purpose.

### `GET /api/auth/verify?token=…`

`302` to `/student` on success, `302` to `/verify?state=expired` otherwise. **Never reveals whose
address the token belonged to.** Single-use: `consumed_at` is set in the same transaction.
Events: `email_verification_succeeded` (security) and `email_verified` (first-party, the activation
funnel — [analytics.md](./analytics.md)), or neither on a bad token.

### `POST /api/auth/resend-verification`

Body: `{ email }`. **Always `202`**, whether or not the address has an account (FR-2005's
non-enumeration rule applied here too). Throttled per email and per IP.
Event: `email_verification_sent` when one was actually sent.

### `POST /api/auth/login`

Body: `{ email, password }`.

| Outcome | Status | Body | Cookies | Events |
|---|---|---|---|---|
| success | `200` | `{ studentId, displayName, emailVerified }` | both set | `successful_login` |
| wrong password **or** no such account | `401` | `{ error: "invalid_credentials" }` | none | `failed_login` (`reason` recorded server-side only) |
| account locked | `423` | `{ error: "locked", until }` | none | `failed_login` |
| account disabled | `403` | `{ error: "disabled" }` | none | `failed_login` |
| throttled | `429` | `{ error: "too_many_requests", retryAfter }` | none | `suspicious_activity` |

**The `401` body and timing are identical for a wrong password and a non-existent address**
(FR-2005). The distinguishing detail goes to `auth_events.reason` and nowhere a client can see.
**Lockout**: the fifth failure within 15 minutes sets `locked_until = now() + 15 minutes` and emits
`account_locked` (FR-2011). Talent has no lockout at all and defines the event without ever emitting
it (R1 §5) — here a test asserts it fires (SC-106).

### `POST /api/auth/refresh`

No body; reads `ainext_rt`.

| Outcome | Status | Cookies | Events |
|---|---|---|---|
| rotated | `200` | both reissued; `rotated_from` = the presented hash | — |
| missing / unknown / expired / revoked | `401` | both cleared | — |
| **reuse of an already-rotated token** | `401` | both cleared | `suspicious_activity` + `session_revoked` — **every** session for that principal is revoked |

Reuse detection is a departure from Talent, whose own architecture document lists its absence as a
known gap (R1 §8). It is the one behaviour here that cannot be retrofitted cheaply, because it needs
`rotated_from` written from the first rotation onward.

### `POST /api/auth/logout` · `POST /api/auth/logout-all`

`204`. `logout` revokes the session matching the presented refresh cookie and clears both cookies; it
requires no valid access token, because revoking is always the safe direction. `logout-all` requires
a valid access token and revokes every non-revoked session for the principal.
Events: `session_revoked` (one row per session revoked).

### `GET /api/auth/sessions` · `DELETE /api/auth/sessions/{id}`

`GET` → `200 { sessions: [{ id, deviceName, ipAddress, lastUsedAt, createdAt, current: bool }] }` —
the caller's own non-revoked, unexpired sessions, **no token material** (FR-2009).
`DELETE` → `204`, or **`404` when the session belongs to someone else** — the same 404-not-403 rule
applied to a principal's own resource boundary, exactly as Talent does it (R1 §2).
Event: `session_revoked`.

### `POST /api/auth/forgot-password` · `POST /api/auth/reset-password`

`forgot-password` body `{ email }` → **always `202`** with the same message whether or not the
address is registered (FR-2010). Mail dispatch happens after the response is committed, in its own
error boundary, so a delivery failure cannot leak through the status.
Event: `password_reset_requested` when one was actually issued.

`reset-password` body `{ token, password }` → `200` on success (every session for the account is
revoked in the same transaction), `400` for an unknown, consumed or expired token. The enumeration
defence does not apply here: by this point the token is the secret, not the email.
Events: `password_reset_completed`, `password_changed`, `session_revoked` per revoked session.

### `GET /api/auth/me`

`200 { principal: "student" | "operator", studentId?, displayName, grade?, gender?, emailVerified,
roles?: string[] }`. `401` with no valid access token. Returns no session or token metadata — that is
`/sessions`' job.

### `GET /api/auth/google/login` · `GET /api/auth/google/callback`

`login` `302`s to Google with PKCE and a signed `state` cookie. `callback` exchanges the code,
verifies the ID token against Google's JWKS, then upserts by normalised email:

- **no account** → create with `google_sub`, `email_verified_at = now()` (Google is trusted to have
  verified it), no password;
- **account exists without `google_sub`** → **link** it rather than erroring (R1 §2);
- **account exists with a different `google_sub`** → `302` to `/signin?error=account_conflict`, and
  emit `suspicious_activity`.

Success ends at **the same session-creation path as a password login** and `302`s to `/student` with
both cookies set. **No token, id, name or picture ever appears in the redirect URL** — Talent's live
gap (R1 §2 point 4), and the reason this endpoint is specified rather than ported.
Events: `oauth_login`, plus `account_created` on a first sign-in.

## Operator authentication

Operators sign in through the **same endpoints on the console build only**, against `operators`
rather than `accounts`. The differences are three: there is no signup (operators are seeded or
granted, ADR-0014); `POST /api/auth/login` on the console emits **`operator_login`** with the roles
in effect (FR-2207); and an `accounts` credential presented to the console is refused and recorded
(`permission_denied`), never silently accepted as a student (FR-2205).

**AMENDED 2026-09-24 — [ADR-0022](../../../docs/decisions/0022-console-signin-from-cloudflare-access.md),
FR-3301…FR-3312.** With `AINEXT_CF_ACCESS_TEAM_DOMAIN` and `AINEXT_CF_ACCESS_AUD` set, the
**primary** operator sign-in is the Cloudflare Access identity, and the password path above is the
**fallback** (FR-3308). Console build only; the student build has none of the following.

### `GET /api/auth/cloudflare?next=…` *(console build only — `route.console.ts`)*

`/signin` forwards here once when the request carries `Cf-Access-Jwt-Assertion`. Verifies it (RS256,
the team's published keys, issuer = team domain, audience = the Access application AUD, `exp`/`nbf`,
30 s tolerance) and reads the email from the **verified** payload only — and only a plain-ASCII
address (`canonicalOperatorEmail`, the one comparison rule; anything else is `non_ascii_email`).
`Cf-Access-Authenticated-User-Email` is never read. Every answer but the first row is a `302`:

| Case | Answer | Cookies | Event (`reason`) |
|---|---|---|---|
| `Sec-Fetch-Dest` present and not `document` (an image, a frame, a prefetch) | `403`, empty — before anything is read | untouched | none |
| verified, active operator, no console session here | → `next` | both set (a new session, same machinery as `login`) | `operator_login` (`cloudflare-access:<roles>`) |
| verified, same operator already signed in here | → `next` | both set (refresh rotated, as `refresh` does) | none |
| verified, a **different** operator's session here | → `next` | both set (new session) | `session_revoked` for the old one (`cloudflare-access:identity_changed`), then `operator_login` |
| verified, no operator / disabled operator | → `/signin?cf=no_account` \| `disabled` | both cleared | `failed_login` (`cloudflare-access:no_operator:<email>` \| `cloudflare-access:disabled`); any other session here `session_revoked` |
| assertion missing, invalid, expired, wrong audience, non-ASCII address… | → `/signin?cf=invalid` | untouched | `failed_login` (`cloudflare-access:unverified:<code>`) — never any part of the token. **Budgeted**: 20 per client address and 200 in total per 15-minute window (`auth_throttle` scopes `cf_unverified_ip`, `cf_unverified_all`); the one that reaches each limit also writes `suspicious_activity` (`cloudflare-access:unverified_ip_throttled` / `…:unverified_flood`); beyond it, nothing is recorded and the answer is unchanged |
| feature off | → `/signin?cf=unavailable` | untouched | none |
| server error | → `/signin?cf=error` | both cleared | none |

`/signin` never forwards a request that carries `cf`, which is what makes the loop impossible. On
the console, `principal.ts` treats an operator session as signed out while a **verified** assertion
names a different address (FR-3305); a missing or unverifiable assertion changes nothing.

**Sign-out**: `POST /api/auth/logout` is unchanged; with the feature on, the console then sends the
browser to `/cdn-cgi/access/logout` **on the console's own hostname** (FR-3307) — not the team-wide
`https://<team>.cloudflareaccess.com/cdn-cgi/access/logout`, which leaves the console's Access cookie
valid for the 20–30 s revocation takes, long enough for the next request to sign the person back in.

**Per-request identity check**: bounded at 1 s (`IDENTITY_CHECK_BUDGET_MS`); a check that does not
finish in time is no proof and keeps the session.

### `POST /api/auth/dev-operator` *(local development only — `route.dev.console.ts`)*

Form body `operatorId`, `next`. **Absent from every production build** (`next.config.ts` adds the
`dev.console.ts` extension only outside production; `check:surface:admin` asserts its absence).
Refused with a bare `404` and `permission_denied` (`dev-picker:refused:<lock>`) unless all three hold:
`NODE_ENV !== "production"`, `AINEXT_DEV_OPERATOR_PICKER === "on"`, a request to this machine (Host
names loopback; Origin, when sent, a loopback origin — `null` refused as `null_origin`; the
recorded client address, when present, loopback). Otherwise `303` → `next` with both cookies and
`operator_login` (`dev-picker:<roles>`). **Those header checks are not proof** — a client writes
all of them; the third lock is real because `scripts/local-dev.sh` and `.claude/launch.json` bind
the console dev server to `127.0.0.1` whenever the flag is set (FR-3309).

## Cross-cutting rules

1. **Password material never leaves the hashing module.** Not in a log, an event, an error, a URL, a
   response body or `auth_events.reason` — not the password, not its length, not a hash of it
   (FR-2003).
2. **Timing.** The failure path performs a dummy hash when no account exists, so response time does
   not distinguish the two cases.
3. **Every event named in FR-2501 has a test asserting it was emitted** (SC-106, 13 of 13). Defining
   an event is not emitting it — four of Talent's seven are defined and never fire (R1 §5).
4. **Throttling applies to `/api/auth/*` only this release.** The rest of the product has no request
   limiting; `decisions.md` risk 2 records that as accepted, with Cloudflare Access as the only thing
   in front of the pilot.
5. **Verification gates learning, not signing in.** Every endpoint above works on an unverified
   account; `/api/ask`, `/api/attempts`, `/api/understanding` and `/api/uploads` return
   `403 { error: "email_unverified" }`.
6. **Phone + OTP (FR-2903) slots in here without a schema change**: a verified code creates an
   `auth_sessions` row through the same path, because the row records that a sign-in happened, not
   how (R1 §9).
