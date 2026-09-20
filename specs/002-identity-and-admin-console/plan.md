# Implementation Plan: Identity & Admin Console

**Feature**: `002-identity-and-admin-console` | **Date**: 2026-09-20 | **Spec**: [spec.md](./spec.md)
**Decisions**: [decisions.md](./decisions.md) — Samuel's eleven answers (D1–D11), 2026-09-20
**ADRs**: [0012](../../docs/decisions/0012-per-student-isolation-rls.md) database-enforced isolation ·
[0013](../../docs/decisions/0013-student-accounts-and-sign-in.md) student-owned accounts ·
[0014](../../docs/decisions/0014-admin-console-second-build-target.md) second build target ·
[0015](../../docs/decisions/0015-interaction-timeline-and-replay.md) timeline & replay ·
[0016](../../docs/decisions/0016-analytics-and-monitoring-posture.md) analytics & monitoring posture
(landed 2026-09-20 while this plan was being written; A8 is cut against it)
**Constitution**: **v3.1.0** — Principle XII (Design System Authority) binds the console's UI from its
first screen. A **v3.2.0** amendment to Principle VII is drafted in
[constitution-amendment-proposal.md](./constitution-amendment-proposal.md) and is **awaiting Samuel**;
nothing in this plan presumes it has landed.

## Summary

Replace the student picker with real student-owned accounts (email + password, Google, email
confirmation, revocable sign-ins, throttling and lockout), move per-student isolation out of
remembered `WHERE` clauses and into Postgres row-level security, and give the operator surfaces a
deliberate home: an admin console built from this same codebase as a second build target, on its own
port and later its own hostname, behind Cloudflare Access *and* per-person accounts carrying four
roles, with one server-side authorisation seam. On top of that the console gets what Samuel asked to
see — each student's cost over time with AI and upload/OCR separated, a subscription status with no
payment system behind it, one ordered interaction timeline per session with read-only reconstructed
replay, an unremovable record of every operator read, a security view of every sign-in attempt, and
overviews per student, per subject and per school year. Gender is collected so the tutor stops
addressing every student as a boy. The parent link is modelled and not built; phone + OTP is designed
into the session model and not built; payment is not built.

**Three findings from reading the codebase that materially shape this work** — all from
[research/codebase-seams.md](./research/codebase-seams.md), each verified by reading the cited file:

1. **`sessions` is dead schema, so D6's one-column migration is not available.** Nothing in `app/src`
   inserts into or selects from `sessions`; `attempts.session_id` is never in the INSERT column list
   (`api/attempts/route.ts:177-179`), so every attempts row ever written has `session_id = NULL`.
   What the product calls a session is an ephemeral client string in three incompatible shapes —
   `grounding->>'chat_session'` on `ai_interactions`, `uploads.session_id TEXT`,
   `analytics_events.session_id TEXT` — against a `sessions.id BIGINT` nobody writes (seams §4). A
   session has to *exist* before a timeline can merge anything, and the correlation is lost at write
   time, which is why this is Phase 0 and not a tidy-up.
2. **There is one bare `Pool` and no seam to hang a principal on.** `app/src/lib/db.ts` is thirteen
   lines exporting `pool` (`max: 5`), called as `pool.query()` from ~15 modules; the only
   transaction-scoped path in the whole application is `app/src/app/api/attempts/route.ts:67-391`;
   and three writes — `emit`, `parseUpload`, `flagAuthoringGap` — run detached from any request, on
   whatever connection the pool hands out, often after the response has been sent (seams §3). RLS by
   `SET LOCAL` reaches none of that today.
3. **A cross-student content exposure exists right now.** `app/src/lib/pipeline-queries.ts:183-184`
   selects the most recent `ai_interactions` row — any student, with its `grounding` — and shows it
   on `/pipeline`, gated only by a build flag (seams §1). `GET /api/demo-students` returns every
   student's name, grade, interests and counters to anyone who reaches the app. Both are the picker
   era's contract working as designed; FR-2104 names them and closes them.

A fourth finding, smaller and sharper, decides how A3 is built: **in both the deployed stack and
local dev the application connects to Postgres as a superuser** (`POSTGRES_USER: ainext` in
`deploy/docker-compose.mvp1.yml`, `$(whoami)` in `scripts/local-dev.sh`). Superusers bypass row-level
security unconditionally. Writing policies without also creating a non-superuser application role
produces a system that looks protected and is not.

## Technical Context

**Language/Version**: TypeScript (Next.js 16.2.10 App Router, React 19.2.4, strict `tsc`) · Python ≥3.12 (loaders, parity check)
**Primary Dependencies (existing)**: `pg` ^8.22, `katex`, Tailwind v4 · Claude CLI (subscription, no API key) as AI runtime
**Primary Dependencies (new — decided in [research.md](./research.md))**: `@node-rs/argon2` (R1) · `jose` (R2) · `arctic` (R3) · `nodemailer` (R4). Four packages, all with a stated zero-dependency fallback.
**Storage**: PostgreSQL 17, one database per solution (`ainext_mvp1`), shared by both surfaces; uploads on a volume
**Testing**: `node --test` unit tests (**appended by hand** to `app/package.json`'s hardcoded `test` list — seams §9) · `scripts/traceability.py --check` · `app/scripts/capture-prompts.mts` byte-identity · a new red-team isolation check · a new event-emission suite (SC-106)
**Target Platform**: iPad Safari (last 2 majors) + modern desktop; two Node processes on one box
**Project Type**: web app + data pipeline monorepo — unchanged; the console is a second *build target*, not a second project
**Performance Goals**: sign-in round trip under a second; console views under two seconds at pilot volume; no regression in tutor time-to-first-token
**Constraints**: both surfaces share one database (D3) · the app must **not** connect as a superuser or as the table owner (see A3) · no new datastore, no Redis, no SIEM, no LRS (research A1/A3/A5) · every new table carries `environment` (XI) · console UI from published tokens (XII)
**Scale/Scope**: ~50 pilot families, ~200 students, one subject, 90 objectives; 8 migrations (`011`…`018`); ~25 new route handlers and views

## Constitution Check (v3.1.0)

*GATE: evaluated before Phase 0 and re-checked after Phase 1 design.*

| Principle | How this plan satisfies it | Status |
|---|---|---|
| **I** Architecture Authority | Every choice below is a proposal with alternatives in `research.md`; ADRs 0012–0015 record what Samuel already decided. Eleven items are listed in **Open for Samuel** rather than settled here. | ✅ |
| **II** Grounded Teaching | Untouched. No retrieval or grounding path changes except A9, which adds an address block and removes masculine defaults — voice, never content (FR-2603). | ✅ |
| **III** Review Gate (suspended, ADR-0007/0008) | Strengthened: `content-review` becomes a *role held by a named person* rather than a build flag, and granting, removing and exercising it is recorded (FR-2204). The suspension's bounding condition — behind Cloudflare Access, invited audience — is unchanged; the pilot stays behind Access on **both** surfaces (FR-2208). | ✅ |
| **IV** Sacred Containment | Dormant (mathematics only) and untouched. A7 *fixes* the redaction path's ledger write (`api/ask/route.ts:411` records zeros) — the guard's behaviour is not changed, only its accounting. | ✅ |
| **V** Bilingual by Construction | Signup, console and auth copy go through the existing locale/direction seam; gender address forms are specified for English **and** Arabic (FR-2602) so the Arabic surfaces stay reintroducible. | ✅ |
| **VI** Cost Discipline | Materially strengthened: per-student time series, AI vs upload/OCR kept separate, two live accounting defects fixed, and every figure labelled *imputed at list price* (A7, research A4). No numeric ceiling is introduced — none binds until PRD §10. | ✅ |
| **VII** Minors' Data Minimalism | **Three things this feature does are not covered by VII as written**: collecting gender, an operator reading a transcript, and full-fidelity retention with no signup disclosure. The amendment proposal (v3.2.0) is the record that would sanction them. Until Samuel approves it this is a **pending** gate, not a passed one. | ⚠️ pending v3.2.0 |
| **VIII** MVP Non-Goals | Multi-child parent accounts stay a non-goal; the parent link is one student ↔ one guardian, modelled and unfilled. Payment is a status field, explicitly not a payment system (FR-2404). | ✅ |
| **IX** Registry Discipline | A9 touches prompts, so the capture harness runs first — **and must be extended first**, because `api/understanding/route.ts:194-230` and `lib/uploads.ts:85-94` are not covered by it today (seams §8). Extending the harness is a task that precedes the prompt edits, not one that follows them. | ✅ |
| **X** Operational Safety | The second surface is a second process against the *same* solution's database. It never touches another solution: no compose project, volume, port or branch of `family-tutor`/`main` is read or written by anything here. Nothing in this workstream deploys to the box (D3). | ✅ |
| **XI** Solution Integrity | Every new table carries `environment`, and the **eight existing student-scoped tables that lack it** get it in `012` (seams §1). No view pools across environments; the three overview views are keyed and filtered by `environment` before they are keyed by anything else. | ✅ |
| **XII** Design System Authority | The console is built from `docs/design/handoffs/noor-play/tokens.css` and the published system: tokens never literals, every coloured background with its paired `on-` foreground, a departure is an ADR (FR-2209). The operator surfaces have had no design pass at all, so this is real work and is budgeted in P2 rather than assumed free. | ✅ |

**Gate result: PASS on eleven, PENDING on one.** Principle VII is the only gate this design cannot
satisfy from the constitution as it stands today. It is tracked below rather than waived.

### Complexity Tracking

| Violation | Why needed | Simpler alternative rejected because |
|---|---|---|
| **VII** — gender collected, operator transcript reads, full-fidelity retention, no signup disclosure | D10, D6 and D7 are Samuel's decisions; the tutor's assumed-male voice is a defect (95 occurrences across three prompt files), and the console's reason to exist is seeing what a student actually said | Not collecting gender leaves the defect; a redacted or summarised transcript makes the timeline useless for the question it exists to answer; adding a disclosure screen contradicts D7. The amendment proposal exists so this is sanctioned in writing rather than absorbed silently |
| Two credential tables (`accounts` and `operators`) | FR-2205 requires that a student account can *never* hold an operator role | One table with a `kind` column makes that guarantee a `WHERE` clause somebody remembered — the exact failure this feature exists to remove |
| Two route-scope flags for one release (`AINEXT_SURFACE` + `AINEXT_INTERNAL_SURFACES`) | ADR-0014 honours the old flag for one release so nothing breaks mid-migration | Removing it immediately would silently re-expose `/pipeline` on any deployment still setting it. Removal has a named owner and date (ADR-0014 Consequences) |
| A per-request `withPrincipal` wrapper that ~15 modules migrate onto | RLS needs a transaction-scoped principal and the codebase has exactly one transaction-scoped path | Leaving the bare `pool` export in place means the hole the policies were written to close stays open (ADR-0012 Consequences) |

## Architecture decisions proposed

### A1. Learning sessions become real — **Phase 0, because it loses data daily**

`sessions` stops being dead schema and becomes the durable learning-session row (ADR-0015 §1). It is
first because it is the only gap in this workstream that is destroying information right now: a turn
written today cannot later be tied to the lesson it belonged to, and no migration recovers that.

**Shape.** `sessions` keeps its `id` and `student_id` and gains `kind`
(`lesson_learn | lesson_review | practice | student_chat | spine_chat`), `surface`, `opened_at`,
`closed_at`, `close_reason` (`completed | inactivity | superseded | abandoned`), `client_key` (the
legacy `chatSession` string, for the transition), `lo_id`, and `environment`. The existing `plan
JSONB` column stays and becomes nullable — it was written for an assigned-question plan that never
shipped, and dropping a column nothing reads is churn for no gain.

**Lifecycle, across four routes.** `/api/ask`, `/api/attempts`, `/api/understanding` and
`/api/uploads` all call one helper, `lib/sessions.ts` → `currentSession(studentId, kind, opts)`,
which finds the student's open session or opens one. Close on explicit completion, on supersession
(a new session for the same student closes the previous one), or by inactivity — **30 minutes**,
documented not discovered (FR-2302), swept lazily on the next open plus once nightly. At most one
open session per student, which is what makes "exactly one session" (FR-2301) true rather than
aspirational.

**Events become real.** `session_started` and `session_ended` already exist in
`lib/analytics.ts`'s union with nothing durable behind them (seams §6). They now fire from the
lifecycle, carry the session's `id`, and `session_ended` carries `close_reason`.

**The transition, and the type reconciliation** (§4e-2, research A0.1). Session keys disagree by
type: `sessions.id`/`attempts.session_id` are `BIGINT`; `uploads.session_id` and
`analytics_events.session_id` are `TEXT`. Migration `011` adds a **new `BIGINT` FK column**
(`session_ref`) to `uploads` and `analytics_events`, adds `session_id BIGINT` to `ai_interactions`
and `understanding_checks`, and puts the missing FK on `attempts.session_id`. The backfill maps each
distinct legacy client string to one `sessions` row (`client_key`), so turns already written stay
correlated. The `TEXT` columns are retained during the transition and dropped in a later release once
`session_ref` is populated everywhere — they are the legacy client string and **must never be joined
to `sessions.id`**; the types disagree and a join that returned rows would be returning coincidences.

**Interactions with no session** are recorded with a NULL session and are visible as such
(FR-2309) — never attached to the nearest one.

### A2. Accounts, sessions, verification, reset, Google

Route handlers under `app/src/app/api/auth/*`, mirroring Talent's endpoint list (R1 §2) with its two
known gaps fixed (R1 §4b-1, §4b-3). Libraries are decided in `research.md` R1–R4.

- **Endpoints**: `signup`, `login`, `logout`, `logout-all`, `refresh`, `verify`, `resend-verification`,
  `forgot-password`, `reset-password`, `sessions` (list), `sessions/[id]` (revoke), `me`,
  `google/login`, `google/callback`. Full contract in [contracts/auth.md](./contracts/auth.md).
- **Both tokens in HttpOnly cookies.** `ainext_at` (access, 15 min, `Path=/`) and `ainext_rt`
  (refresh, `Path=/api/auth`), both `HttpOnly`, `SameSite=Lax`, `Secure` outside dev. Talent keeps
  its access token in `localStorage` behind a Bearer interceptor; Next route handlers read a cookie
  server-side, so there is no reason to put it anywhere a script can reach (FR-2007).
- **Rotation with reuse detection.** One `auth_sessions` row per device; the refresh token is stored
  as a sha256 hash and rotated in place, with the previous hash kept in `rotated_from`. Presenting an
  already-rotated token revokes **every** session for that principal and emits `suspicious_activity`
  + `session_revoked` (FR-2008). Talent's own architecture document lists the absence of this as a
  known gap; we do not inherit it.
- **Lockout.** `accounts.failed_attempts` and `locked_until`; **5 failed attempts in 15 minutes → 15
  minutes locked**, cleared by expiry or by an operator, both recorded (FR-2011). IP-level throttle
  at 20 failures in 15 minutes, in Postgres (research R5).
- **Google** ends at the same session-creation path as a password sign-in — never a token in a
  redirect URL, which is Talent's other live gap (R1 §2). Upsert by normalised email; a Google
  sign-in on an existing password account **links** it rather than erroring.
- **One authorisation seam**: `app/src/lib/auth/authorize.ts`. Every operator route and every console
  layout goes through it and nothing performs its own role check (FR-2106). Proxy (`proxy.ts` in
  Next 16, formerly middleware) does **cookie-presence redirects only** — the docs are explicit that
  proxy should not rely on shared modules, and the authorisation decision needs the database.

### A3. Row-level security — the mechanism, and the thing that would have made it decorative

Policies on every student-scoped table, principal set per request (ADR-0012). The mechanics:

- **Three database roles.** `ainext_app` — the application, **not** a superuser and **not** the table
  owner, holding only the grants its policies need. `ainext_operator` — the console's own connection,
  with the enumerated cross-student read policies and INSERT-only on `operator_reads`.
  `ainext_maint` — loaders, `parity_check.py`, rollups and data backfills, `BYPASSRLS`, never handed
  to the app.
- **The gotcha that decides the whole design.** Superusers and `BYPASSRLS` roles bypass policies
  unconditionally, and the table owner bypasses them unless `FORCE ROW LEVEL SECURITY` is set. The
  app connects as `ainext` (the `POSTGRES_USER`, a superuser) on the box and as `$(whoami)` locally.
  So migration `017` creates `ainext_app`, `ENABLE`s **and** `FORCE`s RLS on every student-scoped
  table, and `DATABASE_URL` is repointed — in `deploy/docker-compose.mvp1.yml`, in
  `deploy/docker-compose.local.yml` and in the `.env.local` that `scripts/local-dev.sh` writes. Until
  that repoint happens the policies are inert, which is exactly the failure that looks like success.
- **`withPrincipal(principal, fn)`** in `app/src/lib/db.ts`: check out a client, `BEGIN`,
  `SET LOCAL app.student_id = $1`, run the callback with that client, `COMMIT`, release. Transaction
  scoped, never session-scoped — a pooled connection outlives the request that borrowed it, and a
  session-level `SET` is how one student's principal survives into the next student's query.
- **Policies read `nullif(current_setting('app.student_id', true), '')::bigint`.** The `true` makes an
  unset setting return NULL rather than raise; the `nullif` handles the empty string a reset leaves
  behind. `student_id = NULL` is NULL, not true, so **no principal means no rows** — fail-closed by
  construction rather than by a default.
- **Per-table policies**, with `USING` for visibility and `WITH CHECK` for writes; append-only tables
  (`attempts`, `ai_interactions`, `analytics_events`, `auth_events`, `operator_reads`) get SELECT and
  INSERT and no UPDATE or DELETE grant at all. **`explanation_log` has no `student_id`** (§4e-1) — it
  hangs off a nullable `attempt_id`, so its policy is a subquery through `attempts`, and a row with a
  NULL `attempt_id` belongs to no student and is visible only to `ainext_operator`. The full matrix
  is in [data-model.md](./data-model.md) §14.
- **The three detached writes carry the principal explicitly.** `emit`, `parseUpload` and
  `flagAuthoringGap` each take a student id and open their own `withPrincipal` transaction.
  `parseUpload` is the sharp one: its two queries (`lib/uploads.ts:172-176`, `:188-191`) do not
  predicate on `student_id` at all today.
- **Pool sizing, and what must not hold a connection.** `max: 5` is sized for a pool lending a
  connection per query. Raise to **20** per process (two processes = 40 against Postgres 17's default
  100). Critically, `withPrincipal` wraps a *unit of work*, not a whole request: `/api/ask` streams
  for tens of seconds and must call it for the pre-turn reads and again for the ledger write, never
  across the model call. A connection held for the duration of an SSE turn is pool exhaustion with
  extra steps.
- **The two exposures close by name** (FR-2104). `pipeline-queries.ts`'s latest-turn read is deleted
  — reading extraction provenance is `evidence-access` and needs no student's turn on the page — and
  `GET /api/demo-students` is removed from the student build entirely, its create half replaced by
  signup. Both get a test that fails if they return.
- **404, not 403, on cross-student reads**; an explicit 403 plus a `cross_student_access_denied`
  event on cross-student **writes** (R1 §3). Under RLS the read side is nearly free — the row is not
  visible, so "not yours" and "not there" are the same answer.

### A4. The console as a second build target

`AINEXT_SURFACE` ∈ `student | admin`, read in `app/src/lib/env.ts` beside `ENVIRONMENT` and resolved
the same way (configuration only, throws on an invalid value).

**How the routes are excluded, and why this shape.** FR-605/FR-2201 is a *build-scope* obligation —
the routes "MUST NOT resolve in that build" — and a `notFound()` layout is a runtime assertion, not a
build fact. So:

- **Console routes are named `page.console.tsx` / `route.console.ts` / `layout.console.tsx`** and
  `next.config.ts` adds `console.tsx` / `console.ts` to `pageExtensions` **only** when
  `AINEXT_SURFACE=admin`. In the student build those files are not routes at all: they are absent
  from the route manifest, so FR-2201 is provable from a build artefact rather than from a runtime
  assertion. `tsx`/`ts` stay in both lists so `proxy.ts` and `instrumentation.ts` keep resolving —
  `pageExtensions` governs them too.
- **The reverse direction is runtime.** Student pages keep ordinary names and therefore exist in the
  admin build; a `(student)` route-group layout calls `notFound()` when `AINEXT_SURFACE=admin`. This
  is deliberately the weaker half and is stated as such: the direction that matters is a child
  reaching operator tooling, not an operator reaching a lesson page. Making it symmetric would mean
  renaming every route file in the app, which is churn against no threat.
- **Two artefacts from one repo**: `distDir` is `.next` for the student build and `.next-admin` for
  the console, derived from the same env var, so the two builds do not clobber each other and
  `next start` picks the right one. CI gains a second build job per solution branch (ADR-0014).
- **Locally**: student on `:3000`, console on `:3002`, one database, one `local-dev.sh` run
  (`--admin`, `--both`). **On the box, later**: a second compose service and hostname — not in this
  workstream (D3).
- **`AINEXT_INTERNAL_SURFACES` is honoured for one release**, with `AINEXT_SURFACE` taking precedence
  where both are set, then removed at the cut of the release after the console ships (ADR-0014,
  owner Samuel).

### A5. Roles and operator bootstrap

Four roles on operator accounts, per person, no role implying another, no role granting everything
(FR-2203): `content-review` (a **safety control** — constitution III, FR-2204), `evidence-access`,
`student-data`, `cost-billing`. `operator_roles` is one row per grant so each is separately
revocable, and grants and revocations are recorded.

**Bootstrap.** ADR-0014 decides Samuel is the first operator with all four roles, seeded once from a
configured email, idempotent on re-run — and records the mechanic this plan proposed: a bare `.sql`
file in the alphabetical migration glob cannot read an environment variable, so the seed is an
idempotent **script**, `app/scripts/bootstrap-operator.mts`, reading
`AINEXT_BOOTSTRAP_OPERATOR_EMAIL`, invoked by `scripts/local-dev.sh` and by the deploy runbook. It
seeds the operator row and its four role grants and **sets no password**: Samuel obtains one through
the ordinary reset flow, so no credential ever sits in a config file. Re-running grants nothing new.
Flagged in Open for Samuel.

### A6. Timeline, reconstructed replay, and the operator-read audit

- **A read model, not a table** (ADR-0015 §2): `app/src/lib/timeline.ts` merges `ai_interactions`,
  `attempts` (including widget outcomes via `modality`), `understanding_checks`, `uploads` and
  `mastery` movements into one time order for one (student, session). Sources stay authoritative;
  nothing is copied for the timeline's convenience. `explanation_log` enters through its attempt or
  not at all — it has no `student_id`.
- **Two-step access** (research A6). The session **list** shows metadata only — when, how long, which
  objectives, how many turns, cost, close reason. Opening a transcript is a deliberate action that
  writes an `operator_reads` row and emits `admin_transcript_viewed`
  ([contracts/analytics.md](./contracts/analytics.md) owns the event vocabulary).
- **Replay is reconstructed and says so.** Rendered with the same components the student saw, driven
  by the stored payload, labelled *"Reconstructed from stored records — not a recording of the
  student's screen"* persistently and visibly, never as a footnote (FR-2304). Each turn carries
  `renderer_version` (the app's release tag at write time) so a replay that no longer matches what
  the student saw can be recognised rather than believed.
- **Read-only** (FR-2305): replay opens no transaction that writes an attempt, moves a mastery
  estimate, or emits an event attributed to the student. The only write a replay causes is the
  operator-read row, attributed to the operator.
- **The audit cannot be erased by its subject.** `ainext_operator` holds INSERT and SELECT on
  `operator_reads` and no UPDATE or DELETE. It survives deletion of the student's account, because it
  records what an operator did (FR-2306).

### A7. Cost: per-student over time, honestly labelled

- **Per-student time series.** `cost_daily` — `(environment, student_id, day, surface_kind) → turns,
  tokens, imputed cost, p50/p95 latency, errors` — as a **table** refreshed nightly and on demand,
  unioned with a live query for today. A view was the first instinct and loses: `/admin/cost` already
  re-scans `ai_interactions` 30 days at a time for a cross-student report, and a per-student time
  series with percentiles multiplies that.
- **AI and upload/OCR stay separate** (FR-2402, VI): `surface_kind` already distinguishes them
  (`'chat' | 'understanding' | 'upload_parse'`); the console never blends them into one figure.
- **Two live accounting defects are fixed** (§4f-2, research A0, both re-verified in the tree):
  `ai_interactions.input_tokens` is written as `input + cache_creation + cache_read`
  (`api/ask/route.ts:446-447`) so `/admin/cost` mislabels it and any price arithmetic over-counts —
  it becomes uncached input only, with the two cache counters beside it as they already are; and the
  sacred-guard redaction path inserts literal zeros for all four counters and `cost_usd`
  (`api/ask/route.ts:411-412`) so spend is under-reported on exactly the turns most worth examining —
  it writes the real numbers.
- **The cost basis is recorded, not just the cost** (research A4.4). The runtime is the Claude CLI on
  a subscription, so `total_cost_usd` is an **imputation at published list price**, not money that
  left a bank account. New columns `price_basis` and `priced_at`; every console figure is labelled
  *imputed at list price*, never *spent*. An `outcome` column (`ok | error | timeout | redacted |
  refused`) makes a refusal that burned tokens a cost line rather than a missing row.
- **Subscription status is a record, never a gate**: `students.subscription_status`
  (`none | trial | active | lapsed`) plus who changed it and when; changing it requires
  `cost-billing` (FR-2405); `cost-billing` reads no student content, by the queries it is permitted
  (FR-2406).

### A8. Monitoring and analytics

Cut against **ADR-0016**, which fixes the posture — three layers, one wrapper module, three views, no
LRS, no observability platform — and leaves the allow-list's membership to this plan and
[contracts/analytics.md](./contracts/analytics.md).

- **`auth_events`** — Talent's vocabulary adopted verbatim where it fits, renamed where our tenancy
  differs (`cross_student_access_denied`), extended where Talent has a gap (research A5). All **13
  events FR-2501 names** are emitted, each with a test asserting it fires (SC-106); five more
  (`suspicious_activity`, `oauth_login`, `role_granted`, `role_revoked`,
  `password_reset_completed`) are emitted too. Every row carries `environment`.
- **Six-tile security view** with five alert rules, thresholds from research A5.
  `cross_student_access_denied` is the one rule at a **zero** threshold: under RLS it should be
  structurally impossible, so any occurrence is an attack or a bug the database caught — it doubles
  as the running proof that A3 works.
- **First-party events added.** `analytics_events` gains exactly two names — `account_created` and
  `email_verified` — because activation is a product-funnel question that belongs beside
  `session_started`. Everything else authentication-shaped lives in `auth_events`; the same fact is
  never written to both. `student_selected` is retired with the picker but kept in the type as
  deprecated, because rows carrying it exist.
- **GA4 is the audience layer only**, per research A1 — one wrapper module (`lib/ga.ts`), an
  11-event allow-list, consent defaults set **before** `config`, cookieless on authenticated student
  surfaces, **never loaded on the console**, no `user_id`, no Ads link, no Measurement Protocol. The
  wrapper is the only module that touches `gtag`, exactly as `lib/analytics.ts` owns the first-party
  insert today. FR-2505 is a design constraint, not a hope: nothing awaits it and nothing renders
  behind it.
- **Three overview views**, each keyed `(subject, grade, syllabus_version)` on school-year weeks
  anchored to the Egyptian school-year start: Student 360, cohort overview, subject/year heatmap
  (research A3). A written metric dictionary ships with them — at n=200 the difference between two
  defensible definitions of "active" exceeds any effect the pilot could detect.

### A9. Gender and the tutor's voice

- **`students.gender`** — recommended enumeration `female | male | unspecified`, skippable, captured
  at signup with its purpose stated at the point of capture (FR-2601). **Open Decision** — the
  enumeration is Samuel's (spec Open Decisions 1).
- **The address seam.** Three student-data reads feed two files' prompts today (seams §8): the shared
  gender-neutral retrieval bundle (`retrieval.ts:142-197`), plus `ask.ts:100-102` and `lesson.ts:197`
  each running their own display-name lookup for greeting text. `gender` joins `StudentProfile`,
  `retrievalBlock()` gains an **address block** carrying the correct forms for English and Arabic,
  and the two private lookups collapse onto the profile so there is one read and one place the voice
  is decided.
- **Then the defect is removed**: 63 masculine pronouns (+1 `himself`) in `lib/lesson.ts`, 21 in
  `lib/ask.ts`, 11 in `lib/checkin.ts`, including the masculine Arabic vocative at `lesson.ts:874`
  offered to the model as the pattern to follow. These are static template strings, not derived from
  any field — consistent with there being no gender signal to read.
- **Constitution IX comes first.** `app/scripts/capture-prompts.mts` covers the lesson and ask
  surfaces (and `checkin.ts` transitively, via `lesson.ts:837-838`) and does **not** cover
  `api/understanding/route.ts:194-230` or `lib/uploads.ts:85-94`. The harness is extended — which
  means factoring those two prompts into exported builders — **before** either is touched. Its job
  here is to prove *scope*: captures before and after show diffs only in the intended files, and none
  anywhere else.
- **Where gender must not go**: never content, difficulty or selection (FR-2603); never a third-party
  analytics tool, an event property, a log line or an error message (FR-2604, FR-2506). Where it is
  unknown, the tutor uses a form correct for either and never falls back to the masculine (FR-2605).

### A10. The demo cast

**Retire, do not seed accounts.** `students` gains `account_id` (nullable) and `status`
(`active | legacy`). The picker-era rows get `status='legacy'` and no account — seeding an account for
a synthetic student would create a credential nobody holds against an email that does not exist. RLS
then does the retirement for free: a row whose `account_id` is NULL is never matched by any student
principal, so it is unreachable from every student surface while staying fully visible to
`ainext_operator`. No history is deleted (FR-2014).

**One local consequence that matters tomorrow**: `scripts/local-dev.sh` seeds `'Omar (demo)'`, and
after this that student cannot be signed in as. The script gains a local-only, clearly-marked
pre-verified test account bound to that student, so local testing does not require working email.

### A11. PDPL guardian-consent fields — modelled, not enforced

Egypt's PDPL executive regulations (Decree 816/2025, in force 2025-11-02, grace ending **2026-11-01**)
treat a child's data as sensitive in every case and require written guardian consent for under-15s —
weeks after the pilot's target launch, and inside the window the pilot's own success metric is
measured over (research A2). **This collides with D7 and is not a decision to take here.** D7 stands.
What ships is the same shape D5 uses for payment: `students.guardian_consent_at`,
`guardian_consent_form`, `guardian_contact`, plus a `retention_class` per store — fields and hooks,
no UI, no enforcement, nothing presented to a student or a parent. Turning disclosure on later becomes
a copy change over a migration that has already run. **Routed to Samuel** with research A2's
recommendation: obtain an Egyptian data-protection opinion before the pilot takes money.

## Phasing

Ordered by what unblocks what, with P0 first because it is the only item losing data now.

| Phase | Delivers | Unblocks | Verification gate |
|---|---|---|---|
| **P0** Sessions are real | `011`; `lib/sessions.ts`; lifecycle in four routes; `session_started`/`ended` fire; legacy strings mapped | The timeline, per-session cost, replay, the cohort views | `tsc` · new session unit tests · **zero** new interactions with a NULL session after cutover, asserted by query · `capture-prompts` 0 diffs |
| **P1** Accounts, isolation, roles-in-data | `012`–`014`, `016`, `017`; auth routes; `withPrincipal`; policies; demo-cast retirement; the two exposures closed | Everything else — roles need accounts, the timeline needs an owner, cost needs a subject | `tsc` · **red-team isolation check** (every student route with a second student's ids → not-found; a deliberately unscoped read → zero rows) · psql RLS proof · 13 event-emission tests · `traceability.py --check` |
| **P2** The console surface | `AINEXT_SURFACE`; `pageExtensions`/`distDir` split; `authorize.ts`; operator bootstrap; existing operator surfaces re-homed and re-skinned to the tokens | Every console view below | Student build's route manifest contains no console route · role × surface matrix test, refusals included (SC-110) · both surfaces from one command (SC-111) |
| **P3** Student 360, timeline, replay, audit | `lib/timeline.ts`; the replay renderer; `operator_reads`; `renderer_version` | The teaching-evaluation harness (ROADMAP), not designed here | 100% of reads have a matching audit row over ≥20 sampled reads (SC-108) · replay writes nothing to the student's record |
| **P4** Cost and commercial status | `018`; ledger fixes; `cost_daily`; per-student time series; subscription status | Unit economics; the price PRD §10 will set | Per-student figures reconcile with the period total (SC-109) · a redacted turn shows a non-zero cost · `input_tokens` no longer includes cache tokens |
| **P5** Monitoring and analytics | Security view + alert rules; GA wrapper; the three overview views; the metric dictionary | Answering "is this working" from data | Every sign-in visible within 60s (SC-105) · zero identifiers in the GA stream, every event type inspected (SC-113) · full journey with GA blocked (SC-114) |
| **P6** Tutor voice, gender, consent fields | Harness extension **first**; address block; 95 occurrences removed; `guardian_*` fields | The defect that says every student is a boy | `capture-prompts` shows diffs **only** in `lesson.ts`, `ask.ts`, `checkin.ts` and the two newly-covered surfaces · 20 sampled turns per gender across lesson, chat and check-in (SC-112) |

**P1 is the hard gate.** No real student account should exist on any surface before the red-team
isolation check passes, because an account without enforced isolation is a login-shaped thing in front
of shared data — worse than a picker, because it implies a protection that is not there.

## Migrations

Three-digit prefixes are load-bearing: `scripts/local-dev.sh:107` and `deploy/local-initdb.sh:5` apply
`db/migrations/*.sql` by alphabetical glob, so `11-*.sql` would sort before `002-*.sql` (seams §11).
Every file follows the established conventions: `IF NOT EXISTS` on creates and column adds,
`DROP CONSTRAINT IF EXISTS` then `ADD CONSTRAINT`, multi-statement files wrapped in `BEGIN;`/`COMMIT;`,
and a header citing the ADR it implements.

| # | File | What |
|---|---|---|
| 011 | `011-learning-sessions.sql` | `sessions` becomes real; `session_id`/`session_ref` FKs on five tables; backfill from the legacy client strings (ADR-0015) |
| 012 | `012-environment-attribution.sql` | `environment` added and backfilled on the **eight** student-scoped tables that lack it: `students, attempts, mastery, sessions, safety_flags, uploads, understanding_checks, explanation_log` (XI, seams §1) |
| 013 | `013-accounts-and-auth-sessions.sql` | `accounts`, `auth_sessions`, `verification_tokens`, `password_resets`, `auth_throttle`; `students.account_id`, `students.status`; functional unique index on `lower(email)` (ADR-0013) |
| 014 | `014-operators-and-roles.sql` | `operators`, `operator_roles`, `operator_reads` (ADR-0014, ADR-0015 §4) |
| 015 | `015-students-gender-status-guardians.sql` | `students.gender`, `subscription_status` + audit columns, `guardian_*` consent fields, `guardians` (modelled, unfilled) |
| 016 | `016-auth-events.sql` | `auth_events` + indexes (research A5) |
| 017 | `017-rls-roles-and-policies.sql` | `ainext_app` / `ainext_operator` / `ainext_maint`; grants; `ENABLE` + `FORCE ROW LEVEL SECURITY`; one policy set per table (ADR-0012) — **last among the schema migrations, because every table it protects must exist first** |
| 018 | `018-cost-ledger-and-rollups.sql` | `ai_interactions.outcome`, `price_basis`, `priced_at`, `renderer_version`; `cost_daily`; the three overview views (research A4) |

## Risks

1. **RLS against a five-connection pool.** The accepted risk in `decisions.md` §3. Mitigated by
   sizing (20 per process), by scoping `withPrincipal` to a unit of work rather than a request, and
   by never holding a connection across a model call. Unproven under load; the pilot is 200 students,
   which is the reason it is survivable rather than the reason it is safe.
2. **The superuser bypass.** The single most likely way this ships looking correct and doing nothing.
   Mitigated by making the RLS proof a copy-pasteable `psql` step in `quickstart.md` run **as
   `ainext_app`**, and by a test that asserts zero rows with no principal set.
3. **Two Node processes, one database.** Connection budget doubles; `lib/session-cache.ts`'s
   in-memory map (TTL 3h, 200 entries, single process — seams §4) diverges between them. Low risk —
   it is a prompt-cache optimisation, not correctness — but it is the reason the rate limiter is in
   Postgres and not in memory (research R5).
4. **Email deliverability.** An account that cannot be verified is a support load with no support
   channel behind it (ADR-0013 Consequences). Mitigated by verification gating *learning* rather than
   *signing in*, by an always-available resend, and by SPF/DKIM/DMARC being a named prerequisite
   rather than an assumption.
5. **Secrets on the box.** `deploy/docker-compose.mvp1.yml` gains environment it has never carried:
   a JWT signing secret, Google client id and secret, SMTP credentials, the bootstrap operator email.
   They belong in `deploy/.env` (gitignored, already the pattern for `POSTGRES_PASSWORD`), never in
   compose, never in the repository. Rotation has no procedure yet — worth one before the console is
   deployed, which is a later release.
6. **Concurrent edits in this checkout.** A second session is editing `CLAUDE.md`,
   `.specify/memory/constitution.md`, `docs/PROJECT_STATE.md`, `docs/README.md`,
   `docs/decisions/0011-*`, `specs/001-student-mvp1-delta/{spec,traceability}.md` (FR-1001 rows only)
   and `docs/design/handoffs/noor-play/README.md` right now. Nothing in this plan writes to any of
   them; the CLAUDE.md plan pointer is deliberately left to a later agent.
7. **A test file that is never run.** `app/package.json`'s `test` script is a hardcoded list of
   eleven files, not a glob (seams §9). Every new `.test.mts` must be appended by hand or CI silently
   never runs it — which is how a suite that proves isolation becomes documentation in a worse format.
8. **Traceability registration — already done, so do not redo it.** The seams inventory flagged that
   `SPECS` gates what CI checks while `MATRIX`/`TASKS` were hardcoded to 001. Both were fixed on this
   branch on 2026-09-20 while this plan was being written: `SPECS` carries an `identity-admin` tuple
   with `gated=True`, and each spec's `tasks.md` is now looked up beside its own matrix. The residual
   risk is the opposite one — a task group that re-registers 002 and duplicates the tuple.

## What `/speckit-tasks` should generate

Task **groups**, in this order; each group's tasks carry the FR ids the group satisfies and at least
one test annotated `// @covers FR-nnnn`.

1. **Session lifecycle** — `011`; `lib/sessions.ts`; four route integrations; the backfill and its verification query; `session_started`/`session_ended` emission.
2. **Environment attribution** — `012` and the eight backfills, each asserted by a count.
3. **Credential core** — `013`/`016`; `lib/auth/{password,tokens,cookies,session,events,throttle}.ts`; fourteen route handlers; the throttle rules; the thirteen emission tests.
4. **Isolation** — `017`; `withPrincipal`; ~15 modules migrated off the bare `pool`; the three detached writes; the two named exposures closed; the red-team check; the psql proof.
5. **Demo-cast retirement** — `status='legacy'`; the local test account; `demo-student.ts` and `DemoStudentSwitcher.tsx` deleted with the picker.
6. **Build target** — `env.ts`; `next.config.ts`; the console file renames; `local-dev.sh --admin/--both`; the CI second build job; the student-manifest assertion.
7. **Authorisation** — `014`; `authorize.ts`; the bootstrap script; the role × surface matrix test; re-homing `/admin/*`, `/pipeline`, `/gallery`, `/dev/*`.
8. **Console shell** — layout, navigation, the token-based skin (XII), and FR-2211's readability obligations.
9. **Student 360 and timeline** — `lib/timeline.ts`; the session list; the two-step transcript open; `operator_reads`; `renderer_version`; the reconstruction label.
10. **Cost** — `018`; the two ledger fixes; `cost_daily` and its refresh; the per-student series; subscription status and its audit.
11. **Security and analytics** — six tiles and five alert rules; `lib/ga.ts` and its allow-list; the three overview views; the metric dictionary.
12. **Tutor voice** — the capture-harness extension **first**, then the address block, then the 95 occurrences, then the sampled-turn check.
13. **Tooling upkeep** — every new `.test.mts` appended to `app/package.json`'s hardcoded `test` list. (Registering 002 with `scripts/traceability.py` is **already done** — see Risks 8; do not add a second tuple.)

## Project Structure

### Documentation (this feature)

```text
specs/002-identity-and-admin-console/
├── spec.md                              # requirements (FR-20xx…FR-29xx, SC-1xx)
├── decisions.md                         # Samuel's eleven answers, D1–D11
├── plan.md                              # this file
├── research.md                          # Phase 0 — R1…R14
├── data-model.md                        # Phase 1 — entities, RLS matrix, migration mapping
├── quickstart.md                        # Phase 1 — how Samuel tests it today and tomorrow
├── constitution-amendment-proposal.md   # Principle VII, v3.1.0 → v3.2.0, awaiting approval
├── traceability.md                      # the matrix (written beside this plan, not by it)
├── contracts/
│   ├── auth.md            # every auth endpoint, cookies, statuses, events
│   ├── authorization.md   # roles × surfaces, the single seam, 404-not-403
│   ├── sessions.md        # learning-session lifecycle and what each surface sends
│   ├── admin.md           # console views and the read models behind them
│   └── analytics.md       # first-party additions, the GA wrapper, the allow-list
├── research/
│   ├── talent-reletix-auth.md
│   ├── codebase-seams.md
│   └── analytics-state-of-the-art.md
└── checklists/requirements.md
```

### Source code (repository root — real paths)

```text
app/
  next.config.ts                          # CHANGED: pageExtensions + distDir per AINEXT_SURFACE
  package.json                            # CHANGED: new deps; every new test appended to `test`
  proxy.ts                                # NEW: cookie-presence redirects only — never the auth decision
  scripts/
    capture-prompts.mts                   # CHANGED: covers understanding + upload prompts (IX)
    bootstrap-operator.mts                # NEW: idempotent first-operator seed (A5)
  src/
    app/
      api/auth/                           # NEW: signup, login, logout(-all), refresh, verify,
                                          #      resend-verification, forgot/reset-password,
                                          #      sessions, sessions/[id], me, google/{login,callback}
      api/ask/route.ts                    # CHANGED: session, withPrincipal, ledger fixes
      api/attempts/route.ts               # CHANGED: session FK written; principal on the existing txn
      api/understanding/route.ts          # CHANGED: session; prompt factored out for the harness
      api/uploads/route.ts                # CHANGED: session; detached parse carries the principal
      api/analytics/route.ts              # CHANGED: authenticated principal, session_ref
      api/demo-students/route.ts          # REMOVED from the student build (FR-2104)
      (student)/layout.tsx                # NEW: notFound() when AINEXT_SURFACE=admin
      signin/, signup/, verify/, reset/   # NEW: student auth screens
      console/                            # NEW: *.console.tsx — overview, students/[id] (360),
                                          #      students/[id]/sessions/[sid] (timeline + replay),
                                          #      cost, security, content, evidence, operators
      admin/, pipeline/, gallery/, dev/   # MOVED under the console build target
    lib/
      auth/authorize.ts                   # NEW: the single authorisation seam
      auth/{password,tokens,cookies,session,events,throttle,google,email}.ts   # NEW
      db.ts                               # CHANGED: withPrincipal(); pool max 20; bare pool retired
      env.ts                              # CHANGED: AINEXT_SURFACE; the FR-605 comment is now wrong
      sessions.ts                         # NEW: learning-session lifecycle (A1)
      timeline.ts                         # NEW: the merged read model (A6)
      cost-queries.ts                     # CHANGED: per-student time series, imputed-price labelling
      analytics.ts                        # CHANGED: two new events, session_ref, principal
      ga.ts                               # NEW: the GA4 wrapper and its allow-list
      student-context.ts                  # CHANGED: resolveStudentId() = the authenticated principal
      demo-student.ts                     # DELETED with the picker (its own header says it should be)
      pipeline-queries.ts                 # CHANGED: the cross-student latest-turn read deleted
      retrieval.ts, ask.ts, lesson.ts, checkin.ts   # CHANGED: address block; masculine defaults out
db/migrations/011…018-*.sql               # NEW (see Migrations)
scripts/
  local-dev.sh                            # CHANGED: ainext_app DSN, --admin/--both, local test account
  traceability.py                         # ALREADY DONE on this branch: 002 registered, gated
deploy/
  docker-compose.mvp1.yml                 # CHANGED: app connects as ainext_app; auth secrets; (console service is a later release)
  docker-compose.local.yml                # CHANGED: same repoint
.github/workflows/ci-cd.yml               # CHANGED: second build target per solution branch
```

**Structure Decision**: no new project, workspace or repository — one codebase, one database, two
build targets from one `next.config.ts` (ADR-0014), which keeps the session logic, the authorisation
seam and the design system in one copy instead of two that drift.

## Post-design constitution re-check

Two things the design changed rather than merely satisfied:

- **XI is strengthened by accident and it is worth saying so.** Adding `environment` to the eight
  tables that lack it means a per-student cost figure, a mastery trajectory and a session count can
  finally be filtered by environment at the source, rather than inferred from which rows happen to
  exist. Today only `ai_interactions` and `analytics_events` carry it.
- **III becomes queryable at the person level.** `content-review` as a recorded grant makes "who was
  permitted to let unreviewed content reach a child, and when" a query rather than an assumption —
  which is what makes the ADR-0007 suspension reversible by policy rather than by a rewrite.

And one the design did **not** resolve: **VII stays pending.** Three obligations — FR-2306,
FR-2307/FR-2308 and FR-2601…FR-2606 — are legal to build only once the v3.2.0 amendment is approved
in the constitution itself. The plan schedules them late (P3 and P6), which buys time; it does not
buy permission.

## Open for Samuel

Each carries a recommended default, so none of them blocks `/speckit-tasks`. **The spec's "Open
Decisions" is the canonical list and its numbering is cited here** — this section adds the
engineering default behind each, not a second list.

1. **The gender enumeration and whether it is skippable.** Recommend `female | male | unspecified`, skippable, with `unspecified` driving FR-2605's either-correct address. (**Spec Open Decision 1**.)
2. **Retention for full-fidelity records.** Research A6 proposes transcripts indefinite in the pilot then 24 months, uploads 90 days after parse, `analytics_events` 25 months, `auth_events` 12 months, GA4 14 months. **No precedent exists** — a proposal, not a default. (**Spec Open Decision 2**.)
3. **PDPL guardian consent vs D7.** Not a decision this plan takes. Recommend keeping D7, shipping the fields and hooks (A11), and obtaining an Egyptian data-protection opinion before the pilot takes money. (**Spec Open Decision 6**.)
4. **Cookieless GA on authenticated student surfaces.** Research A1's posture; A2 notes Samuel may have meant ordinary GA. The alternative's price is a persistent `client_id` on a minor's device. (**Spec Open Decision 7**.)
5. **Whether `lo_id` may go to GA4.** Excluded today because 90 objectives plus timestamps plus a persistent id reconstructs one child's learning path; `module_ordinal` keeps the shape. (**Spec Open Decision 8**.)
6. **Lockout thresholds.** Recommend 5 failures per account in 15 min → 15 min locked; 20 per IP in 15 min → IP throttled. FR-2011 requires they be documented. (**Spec Open Decision 9**.)
7. **The inactivity period that closes a session.** Recommend **30 minutes**; FR-2302 requires it be documented rather than discovered. (**Spec Open Decision 10**.)
8. **The operator bootstrap mechanic.** ADR-0014 now records the same mechanic: an idempotent script keyed on a configured email, seeding no password, because a `.sql` file in the alphabetical glob cannot read configuration. A5 owns the detail. (**Spec Open Decision 11**.)
9. **Whether the bootstrap uses Samuel's own email address.** ADR-0014's default says it does. (**Spec Open Decision 5**.)
10. **Asymmetric build-target exclusion.** Console routes absent from the student build at build time; student routes present in the console build and 404 at runtime. Recommend accepting it — symmetry costs a rename of every route file in the app. (**Spec Open Decision 12**.)
11. **`cost_daily` as a table rather than a view.** Recommend the table plus a live query for today; a view re-scans the highest-volume student table on every console render. (**Spec Open Decision 13**.)

**Spec Open Decisions 3 and 4** — the disclosure text, its owner and its date, and who owns the
anonymous-analytics measurement plan — are not listed above because neither has an engineering
default to offer. They are product decisions and they are Samuel's.

Outside this feature and unchanged: the PRD §10 price point, which would restore Principle VI's
numeric ceiling and put something real behind FR-2404; and the PRD §9 legal review, which bears on
items 2 and 3 above and blocks a paid cohort rather than this build.
