# Codebase Seams — 002 Identity & Admin Console

**Feature**: `002-identity-and-admin-console` | **Date**: 2026-09-20 | **Author**: R3 (search agent)
**Purpose**: an exact inventory of every seam this workstream touches, with `path:line` references,
so `plan.md`/`tasks.md` are grounded in the repository as it exists today (branch
`req/identity-and-admin-console`, off `PDR1-0` @ `ddfdc47`). No speculation: every claim below was
verified by reading the cited file. Where something was looked for and not found, this says so.

---

## 1. Student-scoped data access

Tables confirmed student-scoped from `db/schema.sql` + `db/migrations/*.sql`, with their
`environment` status:

| Table | Defined in | Has `environment`? |
|---|---|---|
| `students` | schema.sql:104 | **No** |
| `attempts` | schema.sql:111 | **No** |
| `mastery` | schema.sql:122 | **No** |
| `sessions` | schema.sql:131 | **No** |
| `ai_interactions` | migrations/002:3, widened 009 | **Yes** (009 §9, default `'baseline'`) |
| `analytics_events` | migrations/009 §6 | **Yes** (`NOT NULL`, no default — always stamped) |
| `safety_flags` | migrations/009 §7 | **No** |
| `uploads` | migrations/009 §8 | **No** |
| `understanding_checks` | migrations/003:4 | **No** |
| `explanation_log` | schema.sql:139 | **No** |

Migration 009's own header is explicit that this is deliberate today: *"Two columns here also ship to
the BASELINE environment, and only these two (FR-908): `analytics_events` (the whole table) and
`ai_interactions.environment`. Everything else is mvp1-only."* Constitution XI ("every new table
carries `environment`") means **eight of ten** student-scoped tables need it added by this workstream's
migrations, not just the two new auth tables.

### Queries filtered by `student_id`, by file (globs: `app/src/lib/*.ts`, `app/src/app/api/**/route.ts`,
`app/src/app/**/page.tsx`)

No `page.tsx` file touches `student_id` directly — every page calls into `lib/*.ts`. Counts below are
occurrences of the literal `student_id` (grep `-c`), not distinct queries:

| File | Count | Lines |
|---|---|---|
| `app/src/lib/queries.ts` | 6 | 45, 48, 148, 168, 342, 349 |
| `app/src/lib/uploads.ts` | 6 | 47, 65, 173, 177, 198, 224 |
| `app/src/lib/cost-queries.ts` | 5 (1 query, cross-student by design) | 114, 121, 123, 152 |
| `app/src/lib/student-context.ts` | 3 (roster query, all-students by design) | 36, 38, 40 |
| `app/src/app/api/attempts/route.ts` | 3 | 178, 217, 247 |
| `app/src/app/api/ask/route.ts` | 3 | 127, 406, 457 |
| `app/src/lib/dashboard.ts` | 2 | 49, 53 |
| `app/src/lib/lesson.ts` | 2 | 143, 211 |
| `app/src/lib/retrieval.ts` | 2 | 79, 122 |
| `app/src/lib/subject-queries.ts` | 2 | 67, 79 |
| `app/src/app/api/understanding/route.ts` | 2 | 263, 287 |
| `app/src/lib/analytics.ts` | 1 | 66 |
| `app/src/lib/ask.ts` | 1 | 88 |
| `app/src/lib/explanations.ts` | 1 | 125 |
| `app/src/lib/pipeline-queries.ts` | 1 | 159 |

All of the above are correctly `WHERE student_id = $n` scoped (verified by reading each site).
`ask.ts:100`, `lesson.ts:197`, `queries.ts:55/171/356` also do `SELECT ... FROM students WHERE id = $1`
— scoped by primary key, not the `student_id` column name, so they don't appear in the grep above but
are equally single-student.

### Queries on a student-scoped table that do NOT filter by student (candidate RLS leaks)

1. **`app/src/lib/pipeline-queries.ts:183-184`**, inside `getPipelineData()` (line 110) —
   `SELECT id, surface, model, ... , grounding, created_at FROM ai_interactions ORDER BY created_at
   DESC LIMIT 1`. This returns the single most recently-written AI turn — **including real
   `grounding`** (via the outer SELECT, not shown here but the same row) — from **whichever student
   last used the product**, to the `/pipeline` page. `/pipeline` is gated only by the build-time
   `INTERNAL_SURFACES` flag (`app/src/app/pipeline/page.tsx:217`), not by any per-person role. This is
   the single most concrete cross-student content exposure in the repo today, and it is exactly the
   class of read D6's "operator-read audit" and D4's `evidence-access`/`student-data` role split exist
   to govern.
2. **`app/src/lib/cost-queries.ts:113-126`** (`perStudent`) and `:83-110` (`totals`/`bySurface`/`byKind`)
   — deliberately cross-student, environment-scoped aggregates for `/admin/cost`. By design for a cost
   surface, but today gated only by `INTERNAL_SURFACES`, not by D4's `cost-billing` role. Under RLS
   this needs an explicit operator-role bypass/aggregation policy, since a naive per-student RLS policy
   would make these queries return nothing.
3. **`app/src/lib/content-admin.ts:49`** — `(SELECT count(*) FROM attempts a WHERE a.question_id =
   q.id) AS attempts` inside `getContentAdminView()` — a per-question attempt **count** across all
   students, for `/admin/content`. Same role-gating note as #2; count-only, not per-student content.
4. **`app/src/lib/student-context.ts:34-45`**, `listDemoStudents()`, called directly by
   `GET /api/demo-students` (`app/src/app/api/demo-students/route.ts:33-35`) — returns **every**
   student's id, display name, grade, interests and live attempt/mastery counters to any caller who can
   reach the app (Cloudflare Access is the only gate). This is not a bug in today's scope (PRD-approved
   picker), but it is precisely the seam D1 (accounts) replaces: today there is no concept of "my own
   student row" at the data-access layer at all — the roster endpoint's contract *is* "all students."
5. **`app/src/lib/uploads.ts:172-176`** (`SELECT student_id, storage_path FROM uploads WHERE id = $1`,
   inside `parseUpload`) and **`:188-191`** (`UPDATE uploads SET parse_status = $2, parsed_text = $3
   WHERE id = $1`) — neither predicates on `student_id`. Safe today only because `uploadId` is a
   server-generated primary key reached exclusively from `storeUpload`'s own return value
   (`app/src/app/api/uploads/route.ts:64,74`) — but `parseUpload` is invoked **fire-and-forget**
   (`void parseUpload(uploadId)`, line 74), detached from the request that resolved a student. Under an
   RLS design where the principal is set per-connection for the lifetime of one request, this detached
   background call has no student principal in scope when it later runs. `GET /api/uploads/[id]`
   (`app/src/app/api/uploads/[id]/route.ts:36`) is correctly scoped, by contrast:
   `getParsedUpload(uploadId, studentId)` filters on both columns.

---

## 2. The identity seam

- **Cookie**: `ainext_demo_student` (`app/src/lib/demo-student.ts:19`), plain, non-httpOnly,
  non-signed, 30-day max-age (`:22`). Client-writable by design — `demo-student.ts:5-17` states in
  block comment: *"THIS IS A DEMO AFFORDANCE, NOT AUTH… when [real auth] does, THIS FILE GOES AWAY."*
- **`app/src/lib/demo-student.ts`** (client-safe half, no `pg`/`next/headers`): `DEMO_STUDENT_COOKIE`,
  `DEMO_STUDENT_COOKIE_MAX_AGE`, `DEFAULT_STUDENT_ID = 1`, `pickStudentId()` (pure validation function,
  unit-tested by `demo-student.test.mts`, `@covers FR-105`), `shortName()`, `arabicGreetingName()`.
- **`app/src/lib/student-context.ts`** (server half): `listDemoStudents()` (:28-59, the roster +
  counters), `rawCookie()` (:62-69), `resolveStudentId()` (:75-81), `resolveStudentContext()`
  (:84-100, id+name+full roster), `getStudentProfile(studentId)` (:121-146, the FR-302 profile used by
  retrieval). Never throws by design — every function degrades to the default student rather than
  erroring.
- **`app/src/components/DemoStudentSwitcher.tsx`** — client component, two variants: hidden
  triple-tap (`visible=false`, no chrome, "students must not discover this") and a visible "who's
  studying?" dropdown (`visible=true`, used on `/dashboard` and `/student`). Writes the cookie directly
  via `document.cookie` (:104-106) and calls `router.refresh()`. Also contains the "Create new user"
  form that POSTs to `/api/demo-students`.
- **`app/src/app/api/demo-students/route.ts`** — `GET` returns `listDemoStudents()` verbatim (roster,
  no auth beyond Cloudflare Access, per header comment :14-28); `POST` inserts a new `students` row
  (name 2-40 chars, grade required, interests optional) and fires `student_created` analytics.
- **Consumers of `resolveStudentId()`** (10 files): `app/src/app/page.tsx`,
  `app/src/app/pipeline/page.tsx`, `app/src/app/api/ask/route.ts`,
  `app/src/app/api/understanding/route.ts`, `app/src/app/api/uploads/route.ts`,
  `app/src/app/api/uploads/[id]/route.ts`, `app/src/app/api/dashboard/route.ts`,
  `app/src/app/api/attempts/route.ts`, `app/src/app/api/analytics/route.ts`, and
  `app/src/lib/student-context.ts` itself (re-export).
- **Consumers of `resolveStudentContext()`** (4 files, all pages that render the switcher):
  `app/src/app/spine/page.tsx`, `app/src/app/student/page.tsx`, `app/src/app/dashboard/page.tsx`,
  plus `student-context.ts` itself.
- **Consumers of `getStudentProfile()`** (2 files): `app/src/lib/retrieval.ts:23,149` (the one
  place the retrieved profile enters the prompt pipeline) and `student-context.ts` itself.

This is the whole surface D1/D9 must replace: one client-writable cookie, one server-side validator
against `students`, one roster endpoint with no per-person concept at all.

---

## 3. The DB connection seam

- **`app/src/lib/db.ts`** — single module-level `Pool` (max 5 connections), memoized on
  `globalThis` outside production (`:3-13`) to survive Next.js hot-reload. `DATABASE_URL` from env,
  falling back to a local default. No transaction wrapper, no request-scoped client, no `SET LOCAL`
  anywhere in the repo (confirmed: `grep -rn "SET LOCAL"` across `app/src` returns nothing).
- **Every module reads via the shared singleton**: `pool.query(...)` is called directly from ~15
  files (`analytics.ts`, `ask.ts`, `cost-queries.ts`, `content-admin.ts`, `dashboard.ts`,
  `explanations.ts`, `lesson.ts`, `queries.ts`, `pipeline-queries.ts`, `student-context.ts`,
  `retrieval.ts`, `subject-queries.ts`, `uploads.ts`, plus the route handlers themselves) — there is
  no injected client, no per-request wrapper, no dependency-injection seam to hang a principal on.
- **The one exception**: `app/src/app/api/attempts/route.ts:67` — `const client = await
  pool.connect()`, then `BEGIN` (:69), several `client.query(...)` calls, `COMMIT` (:284), `ROLLBACK`
  on error paths (:117, 131, 387), and `client.release()` in a `finally` block (:391). This is the
  **only** genuine transaction/connection-scoped code path in the app. It is the natural anchor point
  for `SET LOCAL app.<principal> = …` if RLS is implemented via session variables — but it is one route
  out of ~15 data-access modules, so RLS cannot assume a connection-scoped principal is generally
  available; most call sites would need restructuring (each `lib/*.ts` function currently imports the
  bare `pool`, not a per-request client) or an RLS design that doesn't depend on `SET LOCAL` at all
  (e.g. a validated bound parameter checked by policy, or `SET ROLE`/`SET application_name` per
  checkout with a `pool.on('connect', …)` reset hook).
- **Fire-and-forget calls compound this**: `void emit(...)` (analytics), `void parseUpload(uploadId)`
  (uploads), `void flagAuthoringGap(...)` (explanations) each call `pool.query()` independently,
  frequently *after* the triggering request has already returned a response, on whatever connection the
  pool happens to hand out — never the same connection (or transaction) as the original request. Any
  `SET LOCAL`-based principal would not be in effect for these.

**Conclusion for ADR-0012**: "all access goes through `pool.query()`" is true for ~14 of ~15
data-access modules; `attempts/route.ts` is the sole exception, and even it doesn't cover the
fire-and-forget writes that originate from inside its own request.

---

## 4. The ledger write sites

Four `INSERT INTO ai_interactions` sites, all writing to the same 16-column table
(`db/migrations/002-ai-interactions.sql` + `005` + `009 §9`):

| Site | Lines | `surface` | `surface_kind` | Notes |
|---|---|---|---|---|
| `app/src/app/api/ask/route.ts` (redacted/sacred-guard path) | 404-424 | `surface` var (`spine_chat`\|`student_chat`\|`lesson_learn`\|`lesson_review`) | `'chat'` | zeroed cost/tokens |
| `app/src/app/api/ask/route.ts` (success path) | 455-480 | same | `'chat'` | real usage |
| `app/src/app/api/understanding/route.ts` | 285-312 | `'understanding_check'` (literal) | `'understanding'` | **no** `cache_read_tokens`/`cache_creation_tokens` columns — asymmetric with `ask/route.ts`'s column list |
| `app/src/lib/uploads.ts` (`parseUpload`) | 196-210 | `'upload_parse'` (literal) | `'upload_parse'` | **no** cache-token columns either |

`surface_kind` values in use, repo-wide: `'chat'`, `'understanding'`, `'upload_parse'` (no others
found — `grep -rn "surface_kind"` across `app/src` returns only these four write sites plus
`cost-queries.ts`'s read path).

### Does `sessions.id` reach `attempts` today? No — and nothing reaches `sessions` at all.

`sessions` (`id, student_id, plan, assigned_at, completed_at`, `db/schema.sql:131-136`) has **zero**
application code touching it: `grep -rln "\bsessions\b"` across `app/src/**/*.ts(x)` returns nothing
that inserts or selects from the table (the only hits are a code comment in
`app/src/app/api/demo-students/route.ts:17` and a UI label in `app/src/app/admin/cost/page.tsx:165`).
`attempts.session_id` (a bare `BIGINT`, no `NOT NULL`, no `FK`) is **never included** in the `INSERT
INTO attempts` column list (`app/src/app/api/attempts/route.ts:177-179`: `student_id, question_id,
given_answer, is_correct, time_ms, attempted_at, diagnosis_type, misconception_id, stance_used,
confidence, modality` — no `session_id`), so every `attempts` row written by this app has
`session_id = NULL`.

What the app calls a "session" today is an **ephemeral client-generated opaque string**, never
persisted as its own row:
- `ask/route.ts`: `chatSession` (`body.chatSession`, ≤64 chars, `:106`), stored only inside
  `grounding->>'chat_session'` JSONB on the `ai_interactions` row; used to count prior turns for the
  cap check (`:125-129`).
- `understanding/route.ts`: same `chatSession` (`:178`), stored at `grounding.chat_session` (`:298`).
- `uploads.ts`/`uploads/route.ts`: `sessionId` (`form.get("sessionId")`, `route.ts:62`), written
  straight into `uploads.session_id` (a free `TEXT` column, not an FK) at `uploads.ts:65-67`.
- `analytics_events.session_id` (`TEXT`): populated from `emit({ sessionId })` — either `null`
  (server-triggered emits) or a client-supplied string via `POST /api/analytics`
  (`app/src/app/api/analytics/route.ts:39`).

**This is the single biggest surprise in this inventory**: D6 says *"`session_id`
is added to `ai_interactions` (approved)"* as if there is a live `sessions.id` for it to correlate
against. There isn't. The plan needs to decide whether `ai_interactions.session_id` (a) finally becomes
the first real producer/consumer of the `sessions` table, or (b) correlates against the existing
ephemeral `chatSession`/`sessionId` strings instead (in which case "session" in the timeline/replay
sense is not the same thing as the `sessions` table row at all). Either is workable, but D6's
phrasing understates that `sessions` is currently dead schema, not a populated table missing one join.

- **`app/src/lib/session-cache.ts`** — in-memory `Map`, keyed by `snapshotKey` (`surface|chatSession|
  studentId|lesson|questionId|wrongAnswer`), TTL 3h, capped at 200 entries (`:16-17`), single
  Node process only. Its own header comment (`:11-14`) already flags this: *"a deployed runtime would
  key this in Redis/postgres alongside `ai_interactions`."* Relevant to the second build target: two
  separate Next processes (student :3000, admin :3002) would each hold an independent cache — low risk
  since it's a prompt-cache optimisation, not correctness-bearing, but worth a plan note.

---

## 5. The build-scope seam (FR-605)

- **`app/src/lib/env.ts`** — `ENVIRONMENT` (`baseline|mvp1`, from `AINEXT_ENVIRONMENT`, throws on an
  invalid value rather than silently defaulting, `:20-28`) and `INTERNAL_SURFACES` (boolean, from
  `AINEXT_INTERNAL_SURFACES`, defaults to `!IS_MVP1`, `:60-65`). Header comment (`:44-49`) is explicit:
  *"This is NOT a permission system… Roles need accounts."*
- **`app/src/app/admin/layout.tsx`** (`:12-15`) and **`app/src/app/dev/layout.tsx`** (`:24-29`, forced
  `dynamic = "force-dynamic"` so the gate is evaluated at request time, not baked in at build) both
  `notFound()` when `!INTERNAL_SURFACES`.
- **`app/src/app/pipeline/page.tsx:217`** and **`app/src/app/gallery/page.tsx:21`** self-gate the same
  way (no shared layout for these two, unlike `/admin` and `/dev`).
- **`app/src/components/NavLinks.tsx`** — `MVP1_LINKS` (`/student` "Study", `/dashboard` "Where you
  stand") always shown; `INTERNAL_LINKS` (`/spine` "Evidence Walk", `/admin/content` "Content",
  `/pipeline` "Pipeline") appended only when `internal=true`. **`/admin/cost` and `/gallery` are not in
  any nav list** — reachable only by typed URL. `/dev/*` pages each self-document "Not linked from
  anywhere."

### Every route under `app/src/app/`, one line each

| Route | Kind | Today |
|---|---|---|
| `/` (`page.tsx`) | page | Investor landing + student stats; mixes public copy with `resolveStudentId()`-scoped numbers |
| `/spine` (`page.tsx`) | page | Curriculum graph explorer — **stays student-facing, not behind the console** (`decisions.md`) |
| `/student` (`page.tsx`) | page | Main student study loop (lessons, chat, widgets) |
| `/dashboard` (`page.tsx`) | page | Per-topic mastery ("Where you stand") |
| `/admin/content` (`page.tsx`) | page, `INTERNAL_SURFACES`-gated | Content provenance / review-gate view — operator |
| `/admin/cost` (`page.tsx`) | page, `INTERNAL_SURFACES`-gated | AI cost by function/kind/student — operator, unlinked from nav |
| `/pipeline` (`page.tsx`) | page, self-gated | Extraction-pipeline explainer, reads a cross-student `ai_interactions` row — operator |
| `/gallery` (`page.tsx`) | page, self-gated | Visual-primitive gallery, unlinked from nav — operator |
| `/dev/lesson-content` (`page.tsx`) | page, `INTERNAL_SURFACES`-gated | Dev harness, static fixture, unlinked |
| `/dev/math-widgets` (`page.tsx`) | page, `INTERNAL_SURFACES`-gated, client component | Dev harness / widget review surface, unlinked |
| `/dev/social-fixture` (`page.tsx`) | page, `INTERNAL_SURFACES`-gated, client component | Dev harness, fixture data, unlinked |
| `/dev/widget-questions` (`page.tsx`) | page, `INTERNAL_SURFACES`-gated | Dev harness reading the live `questions` table, unlinked |
| `/api/analytics` (`route.ts`) | route | Client event sink, allow-listed events, student-scoped |
| `/api/ask` (`route.ts`) | route | SSE tutor chat — student-facing |
| `/api/attempts` (`route.ts`) | route | Practice grading + BKT update — student-facing |
| `/api/dashboard` (`route.ts`) | route | Topic breakdown JSON — student-facing |
| `/api/demo-students` (`route.ts`) | route | Roster + create — shared/identity (becomes accounts) |
| `/api/tts` (`route.ts`) | route | Neural speech — student-facing |
| `/api/understanding` (`route.ts`) | route | Comprehension rating — student-facing |
| `/api/uploads` (`route.ts`) | route | Upload intake — student-facing |
| `/api/uploads/[id]` (`route.ts`) | route | Upload status, student-scoped — student-facing |
| `/api/visuals` (`route.ts`) | route | Visual lookup — shared (lessons + gallery) |
| `app/src/app/layout.tsx` | root layout | Nav, fonts, `IS_MVP1`/`INTERNAL_SURFACES`-conditioned chrome — shared |

---

## 6. The analytics seam

- **`app/src/lib/analytics.ts`** — `AnalyticsEvent` union (`:20-40`, **16** values — *corrected
  2026-09-20 by the consistency pass: this line originally said 14, and the names listed below are
  and always were sixteen; `contracts/analytics.md` is the count of record*, incl.
  `student_created`, `student_selected`, `session_started/ended`, `unit_started/completed`,
  `lesson_step_viewed`, `question_asked`, `explanation_delivered`, `retrieval_attempt_started/
  submitted`, `upload_submitted`, `dashboard_viewed`, `parent_view_opened`, `safety_flag_raised`,
  `button_click`). `emit()` (`:58-74`) always stamps `environment` server-side, ignoring any client
  value; never throws. `CLIENT_EMITTABLE` allow-list (`:77-84`, 6 events) gates what
  `POST /api/analytics` will accept via `isClientEmittable()`.
- **`app/src/app/api/analytics/route.ts`** — the client sink; rejects non-allow-listed events
  (`:27-32`), resolves `studentId` server-side (`:34`), passes `sessionId`/`properties` through as-is.
- **`emit(...)` call sites** (file:line, 5 distinct callers plus the sink itself):
  `app/src/app/api/demo-students/route.ts:80`, `app/src/app/api/uploads/route.ts:66`,
  `app/src/app/api/attempts/route.ts:338` and `:355`, `app/src/app/api/analytics/route.ts:36`.
  `app/src/components/DashboardViewed.tsx` and `app/src/components/DemoStudentSwitcher.tsx` call
  `fetch("/api/analytics", …)` client-side rather than `emit()` directly.
- **GA / client script tag**: **not found**. `app/src/app/layout.tsx` (181 lines) has no `<Script>`
  import, no `gtag`, no `googletagmanager.com` reference — `grep` for all of these across the file
  returns nothing. D8's "GA in the product too, anonymously" is a net-new insertion; the layout's
  `<head>`/`<body>` structure (`:136` onward) is the natural insertion point.

---

## 7. Cost seam

- **`app/src/lib/cost-queries.ts`** exports exactly one function: **`getCostView(windowDays = 30)`**
  (`:75-160`), returning `{ environment, totalCostUsd, totalTurns, bySurface[], byKind[],
  perStudent[], windowDays }`. All four internal queries are scoped to `environment = $1 AND
  created_at >= now() - ($2 || ' days')::interval` (`:79-81`) — environment-scoped, never
  student-scoped by default (deliberately: it's a cross-student report).
- **`app/src/app/admin/cost/page.tsx`** — renders `getCostView()`; its own header comment (`:12-16`)
  states plainly: *"Reports only. It sets no budget and enforces no ceiling."*
- **`surface_kind` values in use**: `'chat'`, `'understanding'`, `'upload_parse'` (see §4).
- **Turn-cap logic** (constitution VI's "server-enforced per-surface turn caps"): lives entirely in
  `app/src/app/api/ask/route.ts` — `TURN_CAPS` (`:33-47`, per-`Surface` limits: `spine_chat: null`,
  `student_chat: 2`, `lesson_learn: 18`, `lesson_review: 5`) and the count check against
  `ai_interactions` at `:125-138`. A separate daily cap exists for uploads:
  `DAILY_UPLOAD_CAP = 10` (`app/src/lib/uploads.ts:22`), enforced in
  `app/src/app/api/uploads/route.ts:55-60`. **No per-student dollar budget or subscription cap exists
  anywhere** — confirmed by grep (`spend.meter`, `spendMeter`, `SpendMeter` all return nothing).
- **Spend visibility today** ("in-session spend meter" per constitution VI): a client-side running
  total, not a server cap — `app/src/components/chat/ChatCore.tsx:275`
  (`messages.reduce((s,m) => s + (m.meta?.costUsd ?? 0), 0)`) and per-turn display at `:1130`; plus
  `app/src/components/student/ReportCard.tsx:223` for the understanding-check cost. This satisfies the
  constitution's wording but is purely observational, client-computed, and not persisted per student
  beyond the `ai_interactions` rows themselves.

---

## 8. Tutor voice / gender seam (D10)

`students` has no gender column (confirmed, §1). Gendered-pronoun counts (`grep -noiE
"\b(he|him|his)\b"`, word-boundary, whole file):

| File | he/him/his | Lines (sample) |
|---|---|---|
| `app/src/lib/lesson.ts` | **63** (+1 `himself`) | 548, 577, 579, 601-602, 615, 680, 687, 752, 770, 824-834 (dense block), 842, 850-852, 869-880 |
| `app/src/lib/ask.ts` | **21** | 306, 421-426, 467, 485, 492-494, 497, 502-507 |
| `app/src/lib/checkin.ts` | **11** | 89, 91, 115-116, 120-121, 125, 130-131 |

**Discrepancy found**: `specs/001-student-mvp1-delta/traceability.md:313` (item 11, the citation
D10 relies on) says *"23 masculine pronouns in `lib/lesson.ts` alone."* The current count is **63**
(he/him/his) or **64** including `himself` — nearly 3× the cited figure. Either the file grew
materially since that review finding was written, or the original count used a narrower method (e.g.
one function, not the whole file). The plan should re-derive this number from the file as it stands
rather than repeating "23."

**The masculine Arabic vocative example** cited in D10: `app/src/lib/lesson.ts:874` — a
closing-line example embedded in a prompt-instruction string: `"تمام يا بطل — كده خلصنا…"` ("*O
champion/hero*," masculine vocative), offered to the model as the pattern to follow.

**Where the student profile is injected into prompts — not a single place.** `retrieval.ts:142-169`
(`retrieve()`) does call `getStudentProfile()` (`:149`) and render it via `retrievalBlock()`
(`:180-197`), which is already gender-neutral (grade, language, interests only — no pronoun). But
**`ask.ts` and `lesson.ts` each also run their own separate, narrower profile query**, independent of
`retrieval.ts`'s bundle: `ask.ts:100-102` (`SELECT display_name FROM students WHERE id = $1`) and
`lesson.ts:197` (`SELECT display_name, grade FROM students WHERE id = $1`). Both `ask.ts` and
`lesson.ts` do call `retrieve()`/`retrievalBlock()` too (imported at `ask.ts:2`, `lesson.ts:4`), so
there are effectively **three** student-data reads feeding two files' prompts: the shared
gender-neutral retrieval bundle, plus each file's own display-name/grade lookup used for greeting
text. The 95 gendered-pronoun occurrences above are **hardcoded in static prompt template strings**
(e.g. `learnPrompt()` `lesson.ts:813`, `reviewPrompt()` `lesson.ts:857`), not derived from any
per-student field — consistent with "no gender signal exists to read."

**`capture-prompts.mts` coverage**: `app/scripts/capture-prompts.mts` captures every
`lesson.getLessonCatalog()` × `{learn, review}` via `buildLessonContext()` (`:36-47`) and every
`ask.buildAskContext()` combination for `spine_chat`/`student_chat` (`:52-65`). Because
`checkin.ts`'s `learnOpeningFrame()`/`deriveMasteryStage()` are called from inside `lesson.ts:837-838`
(`learnPrompt`), `checkin.ts`'s gendered text **is** transitively captured via the lesson system-prompt
snapshots. **Not covered**: `app/src/app/api/understanding/route.ts`'s own inline grading
`systemPrompt`/`basePrompt` (`:194-230`, built directly in the route, never routed through
`lesson.ts`/`ask.ts`) and `app/src/lib/uploads.ts`'s `PARSE_PROMPT` (`:85-94`) — neither is reachable
by the capture harness, so a gender-language change there would not be provable byte-identical by
constitution IX's mechanism without extending the script. No `app/src/lib/prompts/` directory exists
(checked — not found); prompt text lives inline in `lesson.ts`/`ask.ts`/`checkin.ts`/the two route
files above.

---

## 9. Local dev & deploy seam

- **`scripts/local-dev.sh`** (241 lines, idempotent, 7 numbered steps): preflight (node/npm/uv-or-venv/
  claude CLI, `:37-75`) → Postgres create-if-missing (`:78-97`) → schema + migrations applied via
  `for m in "$ROOT"/db/migrations/*.sql` glob, **alphabetical order** (`:107-110`) → curriculum content
  load (`:112-135`) → generated content restore (`:137-169`) → a seed demo student if none exists,
  `'Omar (demo)'` (`:171-188`) → parity check (`:190-196`) → writes `app/.env.local` with
  `DATABASE_URL` + `AINEXT_ENVIRONMENT=mvp1` only, **no `AINEXT_INTERNAL_SURFACES`** (`:200-211`,
  so it falls back to `env.ts`'s default of `!IS_MVP1` = off) → `npm run dev` on the Next default port
  **3000** (no `PORT`/`-p` set, `:238`).
- **`deploy/docker-compose.mvp1.yml`** — project `ainext-mvp1`, `app` service on host
  `127.0.0.1:3101` → container `3000` (`:66-69`), `db` on an internal-only network, one `loader`
  tools-profile service. Env vars set on `app`: `DATABASE_URL`, `AINEXT_THINKING_BUDGET`, `NODE_ENV`,
  `AINEXT_ENVIRONMENT=mvp1`, `CLAUDE_CONFIG_DIR`. **No `AINEXT_SURFACE` anywhere** (confirmed — the
  flag proposed in ADR-0014 does not exist yet in any compose file, Dockerfile, or CI workflow).
- **`deploy/docker-compose.local.yml`** — project `ainext-local`, `db` seeded on first boot only via
  mounted `db/schema.sql` as `00-schema.sql` + `db/migrations` mounted read-only and applied by
  **`deploy/local-initdb.sh`** (`for m in /docker-entrypoint-initdb.d/migrations/*.sql`, also
  alphabetical, `:5-8`). `app` on host **3000** → container `3000` (`:63-64`).
- **`deploy/Dockerfile`** — two-stage build (`node:22-bookworm-slim`), build context is the **repo
  root** (comment `:2-4`: the server reads `services/extraction/seed/content/*.json` and
  `public/maps/*.json` at request time via `process.cwd()`). `ENV PORT=3000` hardcoded (`:24`);
  `next start` (via `npm run start`) will honour a `PORT` env var override at container-run time since
  Next's CLI reads it — no code change needed to rebind, only compose-level env/port-mapping changes.
- **`.github/workflows/ci-cd.yml`** — build job (`npm ci` → `tsc --noEmit` → `npm run build` →
  `npm test`) on every push/PR touching `app/**` etc.; `traceability` job runs
  `./scripts/traceability.py --check` and `--write` (drift gate); `deploy` job is
  **`workflow_dispatch`-only** (a push never deploys, per Samuel's 2026-09-13 note in the file's own
  comments), single branch (`PDR1-0`), single target (`/opt/reletix/AI.NEXT-mvp1`, project
  `ainext-mvp1`, port `3101`). No build-arg/env for a second surface exists today.

**Least-surface admin target**: given the above, the smallest change to stand up a second build
target locally is (a) a third compose service (or a parallel compose file) reusing
`deploy/Dockerfile` unchanged, with `AINEXT_SURFACE=admin` + `PORT=3002` in its `environment:` block
and `"127.0.0.1:3002:3002"` (or `:3000` internal, remapped) in `ports:`, plus (b) `scripts/local-dev.sh`
gaining a second `.env.local`-equivalent (or a documented manual `PORT=3002 AINEXT_SURFACE=admin npm
run dev` invocation) — nothing in the Dockerfile or compose files needs restructuring to support a
second target, since both already parameterise `DATABASE_URL`/`AINEXT_ENVIRONMENT` per-service.

- **`app/package.json` scripts** — `dev`: `next dev`; `build`: `next build`; `start`: `next start`;
  `test`: **a hardcoded, explicit list of 11 `.test.mts` files** (not a glob) — confirmed identical
  to `find app/src -name "*.test.mts"` (11 files, matches exactly). Any new `.test.mts` file this
  workstream adds **must be appended to this list by hand**, or `npm test`/CI silently never runs it.

---

## 10. Test & traceability seam

### `*.test.mts` files and their `@covers` lines (all 11, verified against `package.json`'s `test` script)

| File | `@covers` |
|---|---|
| `app/src/lib/bkt.test.mts:12` | `FR-301, FR-307` |
| `app/src/lib/demo-student.test.mts:2` | `FR-105` |
| `app/src/lib/engagement.test.mts:4` | `FR-207` |
| `app/src/lib/widget-docs.test.mts:7` | `FR-1201, FR-1209` |
| `app/src/lib/widget-emission.test.mts:8` | `FR-1213` |
| `app/src/lib/widget-format.test.mts:6` | `FR-1210` |
| `app/src/lib/widget-payloads.test.mts:6` | `FR-1207, FR-1208` |
| `app/src/lib/widget-predicates.test.mts:18` | `FR-1213` |
| `app/src/components/viz/arabic.test.mts` | none found |
| `app/src/lib/arithmetic.test.mts` | none found |
| `app/src/lib/irab.test.mts` | none found |

### `scripts/traceability.py` — exactly what must change

`SPECS` list, **lines 51-56** (the list itself closes at 56, with `MATRIX`/`TASKS`
constants immediately following at 57-58):
```python
SPECS = [
    ("baseline", ROOT / "specs/000-baseline/spec.md",
     ROOT / "specs/000-baseline/traceability.md", False),
    ("mvp1", ROOT / "specs/001-student-mvp1-delta/spec.md",
     ROOT / "specs/001-student-mvp1-delta/traceability.md", True),
]
```
The 4-tuple is `(name, spec.md path, traceability.md path, gated: bool)`. Registering 002 means adding
a third tuple pointing at `specs/002-identity-and-admin-console/{spec.md,traceability.md}` with
`gated=True` (CI's `--check` must fail on drift). **Additional finding**: `MATRIX` (`:57`) and
`TASKS` (`:58`) are hardcoded to **001 only** — used by `--write` to
refresh the generated-counts block (`:274-291`) and by the task cross-reference regex (`:163-164`).
Adding 002 to `SPECS` makes it *reported and gated*, but the `--write` auto-refresh and
task-cross-reference features stay 001-only unless `MATRIX`/`TASKS` are also generalised (e.g. to a
per-spec dict) — worth a line in the plan so "register 002" isn't assumed to be a one-tuple change.
`TEST_GLOBS` (`:56`, sic — actually the line above `SPECS`) already includes
`"app/src/**/*.test.mts"`, so **no glob change is needed** for TypeScript tests to be discovered by the
traceability tool itself — only `package.json`'s hardcoded `test` script (§9) needs manual upkeep.

### 001's `checklists/` and `contracts/` conventions

- `specs/001-student-mvp1-delta/checklists/requirements.md` — the speckit spec-quality checklist
  format: `## Content Quality` / `## Requirement Completeness` / `## Feature Readiness` sections of
  `- [x]` items, followed by a numbered `## Validation iterations` log with dated entries explaining
  any deliberately-kept exception.
- `specs/001-student-mvp1-delta/contracts/` holds **three** files: `api.md`, `bkt.md`, `analytics.md`.
  Format: `# Contract: <Name>` header, a `**Module**: ... **Table**: ...` (or `**Tests**:`,
  `**Replaces**:`) metadata line, then prose + tables describing the interface/behavior delta from
  baseline (e.g. `analytics.md` is an event-name → trigger → properties table; `bkt.md` opens with a
  TypeScript interface block and the math).

---

## 11. Migrations

| File | One line |
|---|---|
| `002-ai-interactions.sql` | Creates `ai_interactions` (chat ledger, per-turn cost columns) |
| `003-understanding-checks.sql` | Creates `understanding_checks` (comprehension rating) |
| `004-visuals.sql` | Creates `visuals` (parametric figure specs) |
| `005-cache-columns.sql` | Adds `cache_read_tokens`/`cache_creation_tokens` to `ai_interactions` |
| `006-relates-to-and-subject.sql` | Widens `graph_edges.edge_type`, adds `node_subject` view v1 (hardcoded course→subject CASE) |
| `007-course-subject-column.sql` | Replaces the hardcoded CASE with `graph_nodes.subject` column + `node_subject` view v2; wrapped in `BEGIN/COMMIT` |
| `008-arabic-question-types.sql` | Widens `questions.question_type` CHECK for 5 Arabic answer kinds |
| `009-mvp1-bkt-library-analytics.sql` | Largest migration: BKT params on `mastery`, `misconceptions`, `explanation_library`, student profile columns, `attempts` diagnosis columns, creates `analytics_events` + `safety_flags` + `uploads`, adds `environment`/`surface_kind` to `ai_interactions` |
| `010-widgets-as-questions.sql` | Adds `'widget'` question type, `attempts.modality`, `questions.materialised_from` |

**Conventions, confirmed across all 9 files**: every `CREATE TABLE` uses `IF NOT EXISTS`; every
`ALTER TABLE ADD COLUMN` uses `IF NOT EXISTS`; every constraint change is `DROP CONSTRAINT IF EXISTS`
**then** `ADD CONSTRAINT` (never a bare `ADD CONSTRAINT`, which would fail on re-run); multi-statement
migrations (007, 008, 009, 010) wrap in `BEGIN;`/`COMMIT;`; single/short ones (002-006) do not. Every
file opens with a comment citing the ADR or feature it implements (e.g. `009`: "Student MVP 1.0
comparison build (ADR-0007, constitution v2.0.0)"; `010`: "ADR-0009: an interactive widget is a
question."). This is the template the plan's `011…015` migrations must follow.

**Application order**: both `scripts/local-dev.sh:107` and `deploy/local-initdb.sh:5` apply
`db/migrations/*.sql` via a bash glob, **sorted alphabetically** — there is no explicit ordering file
or manifest. Because all filenames use a zero-padded 3-digit prefix (`002`…`010`), alphabetical order
already equals numeric order. **This means `011`, `012`, `013`, `014`, `015` (not `11`, `12`, …) is
load-bearing**, not stylistic — a 2-digit `11-*.sql` would sort *before* `002-*.sql` alphabetically and
silently break the sequence. `plan.md`'s migration table follows the same convention.

---

*End of inventory.*
