# Phase 0 Research — Identity & Admin Console

**Feature**: `002-identity-and-admin-console` | **Date**: 2026-09-20
**Purpose**: resolve every technical unknown in [plan.md](./plan.md) before design. Each item states
a decision, why, and what else was weighed. Per constitution v3.1.1 Principle I these are
**proposals** — Samuel decides.

Three studies already landed and are **cited, not repeated**. Where one of them already decided
something, this file records the decision and points at the section; nothing here re-derives it.

| Study | What it settles | Cited as |
|---|---|---|
| [research/talent-reletix-auth.md](./research/talent-reletix-auth.md) | The sign-in pattern D9 names, verified against Talent's code rather than its architecture document | **R1-doc** |
| [research/analytics-state-of-the-art.md](./research/analytics-state-of-the-art.md) | GA4 posture, PDPL, learning-analytics views, LLM cost, auth monitoring, replay | **R2-doc** |
| [research/codebase-seams.md](./research/codebase-seams.md) | Every seam this workstream touches, with `path:line` | **R3-doc** |

---

## R1. Argon2id in Node

**Decision**: **`@node-rs/argon2`**, Argon2id, parameters pinned in one module
(`app/src/lib/auth/password.ts`) with a comment naming the source and the date they were set. Start
at OWASP's minimum-viable Argon2id configuration — memory 19 MiB, iterations 2, parallelism 1 — and
re-check the cheat sheet at implementation time rather than trusting this line six months from now.

**Rationale**: D9 names Argon2id, and Talent gets it through `passlib`'s Argon2 backend
(R1-doc §1). In Node the two real options differ on one operational fact:
`@node-rs/argon2` ships prebuilt napi-rs binaries, and `argon2` builds through `node-gyp`.
`deploy/Dockerfile`'s runtime stage is `node:22-bookworm-slim` with no compiler toolchain — adding
`python3`, `make` and `g++` to build one hashing library is a bigger change to the image than the
library is worth, and it is the kind of change that breaks on the next base-image bump. 19 MiB × a
pool of concurrent sign-ins is a few hundred megabytes at worst, comfortably inside the `app`
service's 2 g limit.

**Alternatives considered**: `argon2` (node-gyp) — rejected on the toolchain, above. `bcrypt` —
rejected: D9 says Argon2id, and bcrypt silently truncates at 72 bytes. `node:crypto`'s `scrypt` — a
genuinely boring zero-dependency memory-hard KDF, and the **named fallback** if the native module
misbehaves on the box; rejected as primary only because one hashing vocabulary across Samuel's two
products is worth more than saving a dependency.

---

## R2. JWT and cookie handling

**Decision**: **`jose`** for signing and verifying, HS256, one secret from
`AINEXT_AUTH_SECRET`. The access token is a 15-minute JWT in an HttpOnly cookie carrying
`sub` (principal id), `knd` (`student | operator`), `stu` (student id, students only), `sid`
(auth-session id) and `env`. The refresh token is **not** a JWT: 32 bytes from
`crypto.randomBytes`, stored only as a sha256 hash, path-scoped to `/api/auth`.

**One departure from Talent worth stating**: Talent decodes the JWT and then does a second database
read to confirm the user still exists (`deps.py:58-61`, R1-doc §3), costing a round trip per request.
We get that property nearly free: every request touching student data already opens a `withPrincipal`
transaction (R6), so the principal row is loaded **inside** it — one indexed read on a connection we
already hold, and lockout, revocation and deletion take effect within one request rather than fifteen
minutes.

**Rationale**: `jose` is ESM, dependency-free, uses WebCrypto, and works unchanged in Next 16's Node
runtime. A high-entropy random refresh token does not need to be a JWT — it needs to be unguessable,
storable as a hash and revocable, which a random string is and a JWT is not (R1-doc §1, same call).

**Alternatives considered**: `jsonwebtoken` — CJS, callback-shaped, larger surface; no benefit here.
A pure opaque access token with a session lookup per request — viable, and nearly what we do; the
signature check is kept because it rejects a forged or expired cookie before any connection is
checked out, which matters under the pool constraints in R7. Asymmetric signing (RS256/EdDSA) —
rejected: one service signs and the same service verifies, so a public key buys nothing.

---

## R3. Google OAuth

**Decision**: **hand-rolled authorization-code flow with `arctic` + `jose`**, ending at the same
session-creation path as a password sign-in. `arctic` supplies the Google provider preset, PKCE and
state handling; `jose` verifies Google's ID token against their JWKS; the upsert rule is Talent's —
match on normalised email, **link** an existing password account rather than erroring on it
(R1-doc §2).

Two of Talent's behaviours are deliberately **not** mirrored: the callback never puts a token in the
redirect URL, and an OAuth login creates a session row like any other. Talent does neither
(R1-doc §2 point 4: no `create_session`, token as a plaintext query parameter), which leaves its
Google users with no working refresh path and their access token in browser history and proxy logs.

**Rationale**: Auth.js (NextAuth v5) is the obvious alternative and it wants to own the session, the
adapter and the callback surface. We already own all three, for reasons that are not stylistic: the
session row is the thing FR-2009 lists and revokes, the same row phone+OTP must slot into later
(FR-2903, R1-doc §9), and the sign-in is what sets the RLS principal. Adopting a framework that
owns session creation means fighting it at every one of those points.

**Alternatives considered**: Auth.js — rejected above; also beta churn against a Next 16 app.
`openid-client` — heavier, and certified OIDC conformance is not needed for one provider.
Zero dependencies (fetch against Google's discovery document, `jose.jwtVerify` against their JWKS) —
about eighty lines, and the **named fallback** if `arctic` is unwelcome; rejected as the primary
because PKCE and state handling written by hand is exactly where this class of bug lives.

---

## R4. Email delivery for verification and reset

**Decision**: **SMTP through the Mailu instance already running on the box**, via `nodemailer`, from
a dedicated `noreply@` mailbox on a sending domain with SPF, DKIM and DMARC records — the same
delivery path Talent uses, on the same host. **Locally, no mail server**: the default transport
writes the verification and reset links to the server console, and a Mailpit container is available
in a compose profile for anyone who wants to see the rendered message.

**Rationale**: the box already sends mail and already has the reputation, the TLS and the operational
story. A hosted provider means a new vendor, a new key, a monthly bill and — the part that decides it
— a minor's email address crossing a border to a third-party processor, precisely the transfer
R2-doc §A2 says needs a licence and an adequacy assessment under PDPL. Console output is the local
default because it makes "sign up and verify" a two-command loop with nothing to install.

**Consequence, stated rather than discovered**: email that does not arrive is an account that cannot
be verified, with no support channel behind it (ADR-0013 Consequences). Two mitigations are part of
the design, not additions to it: verification gates **learning**, not **signing in** (spec
Assumptions), so a student who never got the mail reaches a screen that says why; and the resend is
always available and rate-limited rather than hidden behind a timer.

**Alternatives considered**: Resend or Postmark — rejected on vendor, bill and cross-border transfer;
the fallback if Mailu's deliverability proves poor, and then the PDPL question comes with it. Direct
SMTP from the app to recipients — rejected: no reputation, and large providers drop it. A magic link
instead of a password — out of scope; D9 chose email + password, and phone + OTP is the designed-for
later option (FR-2903).

---

## R5. Rate limiting without Redis

**Decision**: a **Postgres-backed fixed-window counter** — `auth_throttle(scope, key, window_start,
count)` with an atomic upsert-and-increment — plus durable lockout state on the account row
(`failed_attempts`, `locked_until`). Rules, from R2-doc §A5: **≥5 failed sign-ins for one account in
15 minutes → lock that account for 15 minutes**, emitting `account_locked`; **≥20 failed sign-ins
from one IP in 15 minutes → throttle that IP**. Applied to `/api/auth/*` only this release.

**Rationale**: the deciding fact is that there are **two Node processes** — the student surface and
the console — against **one database** (D3, ADR-0014). An in-memory limiter gives each process its
own budget, so a threshold of five becomes a threshold of ten and nobody notices until it matters.
A row per auth attempt is a trivial write at pilot volume, and it is durable across the container
restarts that a small box does routinely. Talent has no rate limiter at all and records it as a known
gap (R1-doc §8); this is the gap we decline to inherit.

**Alternatives considered**: Redis — rejected: a new service on a shared box to hold counters that
fit in a table with tens of rows. An in-memory LRU per process — rejected on the two-process
correctness problem above. Cloudflare rate limiting at the edge — real and useful, but it is not in
this repository, it cannot see which account failed, and it disappears the day Access is removed.

---

## R6. RLS mechanics with `pg`

**Decision**: `SET LOCAL` inside a transaction scoped to a **unit of work** (R7), a non-superuser
application role, and `FORCE ROW LEVEL SECURITY` on every student-scoped table. Concretely:

```sql
-- policy shape (one per table; see data-model.md §14 for the matrix)
CREATE POLICY attempts_student ON attempts
  FOR SELECT TO ainext_app
  USING (student_id = nullif(current_setting('app.student_id', true), '')::bigint);
```

```ts
// withPrincipal, in app/src/lib/db.ts
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT set_config('app.student_id', $1, true)", [String(studentId)]);
  const out = await fn(client);
  await client.query("COMMIT");
  return out;
} catch (e) { await client.query("ROLLBACK"); throw e; }
finally { client.release(); }
```

Four mechanics decided rather than assumed:

1. **`SET LOCAL`, never a session-level `SET`.** A pooled connection outlives the request that
   borrowed it. `SET LOCAL` (equivalently `set_config(..., true)`, which takes a bind parameter and
   so needs no string interpolation) reverts on `COMMIT` or `ROLLBACK`, which is exactly the
   lifetime we want. A session-level setting is how one student's principal survives into the next
   student's query.
2. **`current_setting(name, true)` with `nullif`.** The second argument makes a missing setting
   return NULL instead of raising; `nullif(..., '')` handles the empty string a reset leaves behind,
   which would otherwise fail the `::bigint` cast. The result is that **no principal matches no
   rows** — `student_id = NULL` is NULL, not true. Fail-closed by construction.
3. **The application must not connect as the owner or as a superuser.** This is the finding that
   decides whether any of this works. **Superusers and `BYPASSRLS` roles bypass policies
   unconditionally; the table owner bypasses them unless `FORCE ROW LEVEL SECURITY` is set.** Today
   `deploy/docker-compose.mvp1.yml` runs the app as `POSTGRES_USER: ainext` — a superuser — and
   `scripts/local-dev.sh` connects as `$(whoami)`, also a superuser (R3-doc §9). Writing policies
   without creating `ainext_app` and repointing `DATABASE_URL` produces a system that looks protected
   and is not.
4. **`SET ROLE` is not used per request** — it would have to be reset on every checkout and it
   entangles the connection's identity with the request's. Three static roles plus a settable
   principal is the smaller idea: `ainext_app` (policies apply), `ainext_operator` (the enumerated
   cross-student reads, INSERT-only on `operator_reads`), `ainext_maint` (`BYPASSRLS`, for loaders,
   `parity_check.py`, rollups and backfills, never handed to the app).

`USING` governs which rows `SELECT`, `UPDATE` and `DELETE` can see; `WITH CHECK` governs what an
`INSERT` or `UPDATE` may produce. Append-only tables get SELECT and INSERT grants and no UPDATE or
DELETE grant at all, so the invariant is enforced by privilege rather than by convention.

**Alternatives considered**: a validated bound parameter checked by the policy (no session variable) —
rejected: it needs every query to pass the principal, which is the forgotten-`WHERE` problem wearing a
new hat. Connection-per-student — rejected at 200 students against a 5-connection pool.
Schema-per-student — ADR-0012's option (b), rejected there and retained as the migration path.

---

## R7. Pool sizing, and what must never hold a connection

**Decision**: `max: 20` per process, and `withPrincipal` wraps a **unit of work**, not a request.

**Rationale**: `max: 5` is sized for a pool that lends a connection per query (R3-doc §3). The moment
a principal must be set, a connection is held for the duration of a transaction — and the naive
reading, "one transaction per request", is a trap here: `/api/ask` streams a tutor turn over SSE for
tens of seconds. Five concurrent lessons would exhaust the pool while doing almost no database work.
So the ask path calls `withPrincipal` for its pre-turn reads, releases, runs the model, and calls it
again for the ledger write. Twenty connections × two processes is forty against Postgres 17's default
`max_connections` of 100, leaving room for the loader, `psql` and the rollup job.

**Alternatives considered**: PgBouncer in transaction mode — the textbook answer, compatible with
`SET LOCAL` (which is part of why `SET LOCAL` and not a session `SET`); rejected for now as a new
component on a shared box, and named as the escalation if connection pressure appears. Keeping
`max: 5` and holding per request — rejected on the SSE math above.

---

## R8. Learning-session lifecycle rules

**Decision**: a session opens on the first interaction of a study stretch and closes on completion,
on supersession, or after **30 minutes** of inactivity. At most one open session per student.
`close_reason ∈ ('completed', 'inactivity', 'superseded', 'abandoned')`, so a session the student
finished is distinguishable from one the timeout closed (FR-2302). The sweep runs lazily — the next
`currentSession()` call closes the student's stale session — plus once nightly beside the cost
rollup, so a student who never returns still gets a closed row.

**Rationale**: 30 minutes is the ordinary web-analytics session window and, more usefully here, it is
longer than the pause a student takes to work a problem on paper and shorter than a school day.
FR-2302 requires that the number be documented rather than discovered, which is the actual
obligation — the exact value is cheap to change and is in Open for Samuel. "At most one open session"
is what makes FR-2301's "exactly one session" true rather than aspirational; without it, a student
with a lesson tab and a chat tab produces two open sessions and every later merge has to guess.

**Alternatives considered**: one session per surface — rejected: it reproduces today's problem, where
"which session" has several defensible answers. Closing only on explicit completion — rejected: the
spec's own edge case names the laptop that shuts mid-lesson. A cron job as the only sweeper —
rejected: there is no scheduler on the box today, and a lazy sweep needs none.

---

## R9. Second build target in Next 16

**Decision**: **build-time exclusion by `pageExtensions`, organised with route groups, with separate
`distDir`s.** In `app/next.config.ts`:

```ts
const surface = process.env.AINEXT_SURFACE === "admin" ? "admin" : "student";
export default {
  pageExtensions: surface === "admin"
    ? ["console.tsx", "console.ts", "tsx", "ts"]
    : ["tsx", "ts"],
  distDir: surface === "admin" ? ".next-admin" : ".next",
} satisfies NextConfig;
```

Console routes are named `page.console.tsx`, `route.console.ts`, `layout.console.tsx`. In the student
build those basenames are not `page`/`route`/`layout`, so they are **not routes**: they never reach
the route manifest. Student pages keep ordinary names and exist in both builds; a `(student)`
route-group layout calls `notFound()` when the surface is `admin`.

**Rationale**: FR-605 — carried unchanged as FR-2201 — is a *build-scope* obligation: those routes
"MUST NOT resolve in that build, so a guessed or shared URL reaches nothing". A `notFound()` layout
is a runtime assertion, and ADR-0014 rejected option (a) for exactly that reason. `pageExtensions`
is the mechanism Next documents for deciding which files are routes, it applies to the App Router,
and it makes FR-2201 provable from a build artefact rather than from a runtime check — which is a
stronger proof than the one FR-605 has today. `distDir` keeps the two `next build` runs from
clobbering each other, and `next start` reads the same config so it serves the matching artefact.

**The asymmetry is deliberate and is stated rather than smoothed over.** The console-in-student
direction is build-time; the student-in-console direction is runtime. Symmetry would mean renaming
every route file in the application to carry a surface suffix, and the threat it defends against is
an operator reaching a lesson page — not a child reaching operator tooling.

**One documented trap**: `pageExtensions` also governs `proxy.ts` and `instrumentation.ts`. Both
lists keep `ts` and `tsx`, so those keep resolving; dropping the defaults from the admin list would
silently disable the proxy.

**Alternatives considered**: a `notFound()` layout alone — rejected as above; it is the runtime half
we accept only in the direction that does not matter. Two Next applications in one repo — rejected by
ADR-0014 option (b). A build script that moves the other surface's tree before `next build` —
rejected: it breaks `next dev`, and a build that mutates the working tree eventually commits.
`basePath` or a rewrite — neither removes a route from a build.

---

## R10. Running both surfaces locally

**Decision**: `scripts/local-dev.sh` gains `--admin` (console only, `:3002`) and `--both` (student on
`:3000` in the background, console on `:3002` in the foreground, one trap killing both on Ctrl-C).
Default behaviour is unchanged. Three additions to what it already does: it writes `DATABASE_URL`
pointed at **`ainext_app`** rather than `$(whoami)`, it runs the idempotent operator bootstrap, and
it creates a **local-only, pre-verified test account** bound to the seeded `'Omar (demo)'` student.

**Rationale**: D3 makes a trivial local run a requirement, not a convenience, and US8 tests it from a
clean checkout. The `ainext_app` repoint is not cosmetic — without it RLS is inert locally (R6.3) and
every isolation test passes for the wrong reason. The pre-verified test account exists because A10
retires the demo cast from every student surface: without it, the first thing Samuel would hit
tomorrow is a lesson he can no longer reach.

**Alternatives considered**: two `.env.local` files — rejected: Next reads one, and the difference
between surfaces is two variables on a command line. A compose service for the console locally —
useful later on the box; on a laptop it is a container to rebuild on every file change.

---

## R11. GA4 configuration

**Decided by R2-doc §A1 and §A2; recorded here, not re-derived.** Three layers: `analytics_events` is
the system of record, GA4 is the **audience layer only**, no self-hosted product analytics this
release. Per surface: granted-with-advertising-denied on public pages, **all four consent signals
denied (cookieless) on authenticated student surfaces**, **never loaded on the console**. No
`user_id`, no Ads link, no Google Signals, no Measurement Protocol, enhanced-measurement `page_view`
off with a manual send whose query string is stripped, retention 14 months with reset-on-activity
off, two properties (`baseline`, `PDR1-0`) never pooled.

**The plan adds only the module contract**: one wrapper (`app/src/lib/ga.ts`) owns every `gtag` call,
accepts R2-doc §A1's **eleven-event allow-list** with properties drawn only from `surface`, `subject`,
`grade`, `module_ordinal`, `environment`, and drops anything else with a console warning — the same
shape `lib/analytics.ts` already has. Contract: [contracts/analytics.md](./contracts/analytics.md).

**Two confirmations are owed, not settled** (R2-doc "Open for Samuel" 2 and 4): whether cookieless is
what "anonymously" meant, and whether `lo_id` may go after all. Both are in plan.md's Open list.

---

## R12. The gender enumeration

**Decision**: recommend **`female | male | unspecified`** on `students.gender`, with a CHECK
constraint, skippable at signup, editable afterwards (FR-2013), and `unspecified` driving FR-2605's
either-correct form of address. **This is a recommendation, not a decision** — spec Open Decision 1
reserves it for Samuel.

**Rationale**: the datum exists for one purpose and the purpose bounds it. Arabic grammatical gender
is binary for the address forms the tutor needs — a vocative, a pronoun, a verb agreement — so the
tutor needs exactly two registers plus a neutral one it can always fall back to. Three values give
that with nothing spare. A larger enumeration would collect more about a minor than the stated
purpose consumes, which is the thing Principle VII exists to prevent and the thing the v3.2.0
amendment is careful to bound ("used for address and voice only"). `unspecified` rather than "prefer
not to say" because it is also the honest value for the retired demo cast, which has no answer rather
than a withheld one.

**What the neutral register actually is**, so it is not left to the prompt author: in English, address
by name with no third-person pronoun about the student; in Arabic, the name without a gendered
vocative, avoiding second-person forms that would have to agree. Arabic is specified now even though
MVP 1.0 ships English (Principle V), and the masculine vocative at `lib/lesson.ts:874` is exactly
what that clause protects against.

**Alternatives considered**: a free-text field — rejected outright: unbounded personal data about a
minor, and unusable for choosing a grammatical register. Inferring gender from the display name —
rejected: wrong often enough to be insulting, and it is a profile inference about a child nobody
asked for. Not collecting it and asking the tutor to stay neutral always — the honest fallback if
Samuel declines the datum, and worth naming: it fixes the defect (no student is addressed as a boy
by default) without fixing the goal (a girl is addressed correctly).

---

## R13. The three analytics views

**Decided by R2-doc §A3; recorded here with the definitions the plan needs.** Keyed
`(subject, grade, syllabus_version)` — `graph_edges.syllabus_version` is the curriculum year,
`students.grade` is the grade the ministry book is written for, and they are not the same axis — on
**school-year weeks anchored to the Egyptian school-year start**, never calendar weeks, or month-2
retention splits across a January boundary and reports two halves of a number.

1. **Student 360** — one student, `student-data` role, every transcript open audited. Profile, BKT
   trajectory per objective (free: `mastery` is already bitemporal), attempts and accuracy,
   time-on-task as **two** numbers (`attempts.time_ms` and session wall-clock, never blended),
   sessions, help-seeking, misconception frequency, understanding-check outcomes, imputed cost,
   subscription status, safety flags (type and time only), last seen, a link to the timeline.
2. **Cohort overview** — activation, weekly-active by school-year week, month-2 retention as the
   pilot defines it, median and p90 session length, attempts and accuracy, median objectives at the
   mastery threshold, cost per active student. R2-doc's warning is carried into the contract: the
   SC-005 funnel is **not displayed** until `explanation_delivered` fires for more than refutations.
3. **Subject/year heatmap** — 90 objectives × school-year weeks, cell = share of the cohort at or
   above the mastery threshold, with **"never reached" rendered distinctly from "reached and
   failing"**. That distinction is the view's entire point.

**A metric dictionary ships with them** — one written definition each for active, session,
time-on-task, mastered, retained, activated. At n=200 the difference between two defensible
definitions of "active" exceeds any effect the pilot could detect, which makes the dictionary
cheaper and more load-bearing than any of the three views.

**Alternatives considered** (R2-doc §A3): xAPI 2.0 with a self-hosted LRS, IMS Caliper, xAPI-shaped
statements without an LRS, a bought learning-analytics product — all rejected there, with a named
revisit trigger: a ministry, school or LMS integration.

---

## R14. Retention — **an Open Decision, recorded not chosen**

**R2-doc §A6 proposes**: transcripts indefinite for the pilot (D7) and 24 months in steady state;
uploads **90 days after parse**, keeping `parsed_text`; `analytics_events` 25 months;
`auth_events` 12 months; GA4 14 months (not a choice — GA's maximum).

**The plan's position**: these numbers have **no precedent in this project and no owner**, so the
plan ships the *mechanism* and not the values — a `retention_class` per store, an
`environment`-scoped deletion path, and a per-student export and erasure path, all unexercised.
FR-2307 already names the decision as **owed**, due before any audience wider than the invited pilot.
Inventing a number here would turn an owed decision into a shipped default.

**One sub-question that needs Samuel specifically** (R2-doc "Open for Samuel" 3): what erasure means
for `mastery`, which is bitemporal and is the only record the pilot's learning claims rest on.
R2-doc recommends erasing transcripts and uploads and pseudonymising aggregate mastery. Decide before
the first request, not during it.

---

## R15. PDPL guardian-consent fields

**Decision**: model them, do not enforce them, route the decision to Samuel.
`students.guardian_consent_at`, `guardian_consent_form`, `guardian_contact`, alongside the
`guardians` table FR-2901 already requires as architecture-only. No UI, no gate, nothing shown to a
student or a parent, nothing that contradicts D7.

**Rationale**: R2-doc §A2 establishes that Egypt's PDPL executive regulations (Decree 816/2025, in
force 2025-11-02) treat a child's data as sensitive in every case and require **written guardian
consent for under-15s**, with the grace period ending **2026-11-01** — weeks after the pilot's target
launch, and inside the window its own success metric is measured over. Our cohort is 14–15, so the
stricter rule governs. That collides with D7, which is Samuel's decision and stands. The resolution
that costs nothing and forecloses nothing is the one D5 already uses for payment status: ship the
fields, so turning disclosure and consent on later is a copy change over a migration that has already
run rather than a schema change under time pressure.

**What is owed**: an Egyptian data-protection opinion before the pilot takes money. R2-doc is explicit
that a 200-record pilot's position under the licensing exemption is **not** a conclusion to draw from
secondary sources.

**Alternatives considered**: building the consent flow now — rejected: it is the disclosure screen D7
declines, and half of it is worse than either. Doing nothing until counsel answers — rejected: the
fields cost a column each now, and a migration on a live table under a deadline later.

---

## Summary of what still blocks

| # | Item | Blocks | Resolvable by |
|---|---|---|---|
| R14 | Retention values, and what erasure means for `mastery` | A wider audience than the invited pilot (FR-2307) | **Samuel** |
| R15 | PDPL guardian consent vs D7 | A paid cohort, not this build | **Samuel + an Egyptian data-protection opinion** |
| R12, R11, R8 | The gender enumeration · cookieless GA and `lo_id` · the 30-minute window | Nothing — each ships with a safe recommendation and relaxes with one change | Samuel, at his convenience |

Everything else is decided and ready for Phase 1 design.
