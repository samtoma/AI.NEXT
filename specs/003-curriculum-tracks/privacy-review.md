# Privacy & security review — 003 Curriculum Tracks (design stage)

**Reviewer**: security-privacy-officer agent, 2026-09-25. **Read-only — no code changed.**
**Scope**: `specs/003-curriculum-tracks/spec.md` (Draft, Q1–Q3 open) and `research.md` (options for
Samuel, nothing decided) against the code as it exists today on this branch. Nothing in 003 is built
yet; every finding below is either (a) a gap in the *design* that should be closed before `plan.md`
is written, or (b) a defect in *existing* code that this feature makes newly exploitable or newly
important, because loading a second book changes what several already-ungated readers hand out.
**Format**: MUST (blocks this feature reaching a real grade-10 family), SHOULD (fix in the same
work; ship without it only if Samuel accepts the residual risk, recorded in the owed ADR-0024),
NICE (worth doing, not blocking).

---

## 1. Principle VII — is a curriculum choice acceptable to collect?

**Yes, with conditions.** `students.curriculum_system` already exists (migration 009,
`db/migrations/009-mvp1-bkt-library-analytics.sql:100`) and FR-302 already names "curriculum
system" as part of the student model — this is not a new category of data, it is an existing column
becoming load-bearing. It is a *learning* attribute (which book a student studies), not an identity
attribute, and constitution VII's list is "name, grade, and the interest signals the tutor actually
uses" — curriculum sits with grade, not beside it as a seventh field.

The real risk, which `research.md` §6.1 already names correctly: **American curriculum in Egypt is a
weak but real proxy for fee-paying schooling.** Recording it for a named minor is recording a
soft socio-economic signal that name+grade+phone alone do not carry.

- **F1 — SHOULD.** Ask it only when it changes what the child is offered (FR-4005 already says
  this — a grade with one curriculum stores it silently) and go further: the console's per-grade
  "offered" display (FR-4102) and the sign-up copy should never frame curriculum as a tier
  ("premium", "international", "private-school track"). Keep the labels flat and factual —
  "American" / "National" — exactly as `research.md` §3 item 3 already plans. Worth stating
  explicitly in `spec.md`'s Requirements, not left to copywriting judgement, because this is the one
  place the product itself could amplify the signal Samuel didn't ask it to encode.
- **F2 — SHOULD.** `spec.md`'s Governance impact already owes a constitution VII PATCH
  ("curriculum is part of grade — which book serves that year"). Recommend the amendment also say,
  in one sentence, that curriculum is *never* to be paired with a free-text school name or address —
  closing off the obvious way this minimal fact turns into an identifying one later. Nothing in 003
  proposes that pairing; naming the boundary now costs nothing and is cheap insurance against a
  future feature adding "which school" as a "quick" analytics enrichment.
- **F3 — NICE.** `curriculum_system`'s existing format mixes system and language
  (`eg-national-en`) — `research.md` D1.3 already flags this. Not a privacy issue on its own; note
  it only because a values list that isn't obviously an enum (no CHECK, per D6's own reasoning) is
  easier to accidentally free-text into later. Keep it registry-validated in application code as
  designed (D1.3 recommendation A) — do not let a future "quick fix" accept an arbitrary string.

No MUST here. The choice itself is proportionate; the two SHOULDs are about keeping the *product's
framing* of it minimal, which is squarely Principle VII territory.

---

## 2. Analytics — must never reach GA4 or any third party

**Today's guard holds structurally**, and it is a good pattern: `GA_EVENTS` (11 names) and
`GA_PROPS` (5 names, `app/src/lib/ga.ts:63-95`) are closed allow-lists; anything else is dropped
with a `console.warn` (`ga.ts:242-268`). `curriculum` is in neither list. `account_created` — the
event `research.md` D2 proposes adding a `curriculum` property to — is **not** one of the 11 GA
events at all (`ga.ts:56-62`'s own comment names it as deliberately excluded, "identity-shaped").
So the first-party write (`emit({ event: "account_created", ..., properties: { method, grade } })`,
`app/src/app/api/auth/signup/route.ts:156-160`, and `google/callback/route.ts:109-115`) is the only
place `curriculum` would land, and `lib/analytics.ts`'s `emit` writes to the first-party
`analytics_events` table only — it never touches `gtag`.

- **F4 — MUST.** When D2's analytics change lands (`grade` and `curriculum` on `account_created`),
  add `curriculum` to nothing in `ga.ts`. Add a one-line test alongside the existing
  `ga.test.mts`/`ga-console-guard.test.mts` asserting `"curriculum"` is never a member of `GA_PROPS`
  and never a member of `GA_EVENTS` — the same shape the file already uses for `lo_id`
  (`ga.ts:82-87`'s comment: "Samuel may yet decide `lo_id` is fine ... one entry in this array").
  Curriculum should get the opposite comment: never becomes fine, because unlike `lo_id` it is a
  proxy for something about the family, not the curriculum graph. This is cheap and closes the loop
  the existing architecture already opened for `lo_id` — don't let curriculum drift into the same
  array by the same reasoning that was written for a different field.
- **F5 — SHOULD.** A subtler channel: `grade` **is** already an allowed `GA_PROP`
  (`ga.ts:89-95`) and already rides on ordinary lesson events (`session_started`, `unit_started`,
  etc.). Per Q1's option A (the one `research.md` recommends), **grade 10 will offer only American**
  until a National grade-10 course also exists. For as long as that holds, `grade=10` in GA4 is a
  de-facto curriculum flag for a single-digit pilot cohort — not identity by itself, but a real
  inference channel for anyone with GA4 access, sitting on top of an already-small population
  (target pilot is 50 families total). Consent defaults reduce but do not remove this:
  `consentDefaults("student-auth")` denies `analytics_storage` (`ga.ts:173-180`), so no persistent
  GA cookie/user id is set for signed-in students, but GA4 Consent Mode v2 still receives the event
  and its parameters (including `grade`) per-request, with IP and timestamp, as a cookieless ping —
  denial changes what Google can *link*, not whether it *receives* the value.
  **Fix**: while grade 10 is single-curriculum, either (a) omit the `grade` property from GA4 events
  for grade 10 specifically, or (b) hold off enabling GA4 at all until `AINEXT_GA_MEASUREMENT_ID` is
  set (today it is unconfigured — PROJECT_STATE.md S7/S22 — so this is latent, not live). Whichever
  Samuel picks, record it: this is exactly the kind of "small numbers" disclosure risk a later,
  larger cohort makes moot, and a 50-family pilot makes real.
- **F6 — NICE.** `research.md` §6.1(b) is right that curriculum must "keep it first-party, never a
  GA4 property" — recommend that exact sentence, or F4's test, be cited directly in `spec.md`'s
  FR-4005/FR-4006 block so the obligation is traceable to a requirement number rather than living
  only in the architect's research notes.

No change needed to `lib/analytics.ts` itself — the first-party table is the correct home for
`curriculum`, and `emit()`'s existing environment-stamping (never client-settable, `analytics.ts:9-10`)
already satisfies Principle XI for this new property.

---

## 3. Console — who may see or change a student's curriculum

Maps cleanly onto the five existing roles (`content-review`, `evidence-access`, `student-data`,
`cost-billing`, `teaching-controls` — `app/src/lib/db.ts:52-58`), and FR-4101/FR-4105 already draw
the right line:

- **Per-grade rule** (which curricula/courses are live for a grade) → `content-review`, same as
  today's course gate (ADR-0018). Correct: this is a decision about a subject, not a person.
- **One student's curriculum** (the record, and any editor) → `student-data`, same as every other
  fact about a named student (FR-2306, FR-2707). Correct, and `research.md` D3 already plans it this
  way ("Student 360: … with an editor (`student-data`)").
- **`cost-billing` must not see it.** FR-2406 is explicit that `cost-billing` gets no student
  content at all, and the code already enforces this at the page level: Student 360
  (`app/src/app/(console)/students/[id]/page.console.tsx`) is reachable only via `consoleAccess`
  against `console-routes.ts`'s role list for `/students/[id]`, and `cost-billing` alone never
  reaches that route (confirmed by the doc comment at `page.console.tsx:60-66`, "An operator
  holding `cost-billing` alone never reaches this page at all"). A curriculum fact added to that
  same page inherits the same exclusion automatically — **provided it is added to Student 360 and
  nowhere `cost-billing` can reach alone.**
  - **F7 — MUST.** Do not surface curriculum on `/cost` or `/feedback` even as a label/filter
    without checking those pages' own role lists first. `cost-billing`'s per-subject figures on
    `/cost` (FR-4104 asks these to "name the curriculum and course they count") must show curriculum
    as an aggregate label on a cost figure, never as a per-student fact and never joined against
    anything that could narrow to one student — the same discipline `turn-threshold-queries.ts:260`
    already documents for `cost-billing` needing `student-data` as well before any single-student
    number is shown. Aggregate-by-curriculum cost totals are fine; "this student is American
    curriculum" reachable from the cost page is not, and `/cost` is exactly the page `cost-billing`
    reaches alone.
- **Audit trail.** `research.md` D6's migration 033 sketch adds `curriculum_updated_at` and
  `curriculum_updated_by` and a comment "017 REVOKEs ALL each run; 033 sorts after it and re-grants."
  This is the right pattern (it mirrors `subscription_updated_by`/`subscription_updated_at`,
  `db/migrations/017-rls-roles-and-policies.sql:194-196`). One gap:
  - **F8 — MUST.** `db/migrations/017-rls-roles-and-policies.sql:150` grants `ainext_app`
    **table-wide** `UPDATE` on `students` (`GRANT SELECT, INSERT, UPDATE ON students TO
    ainext_app`) — not column-scoped. `curriculum_system` already exists and is already covered by
    that blanket grant. The proposed migration 033 (`research.md` §4 D6) only adds a **column-level**
    `UPDATE` grant to `ainext_operator`; it does not `REVOKE` `ainext_app`'s existing, broader
    ability to write `curriculum_system` (or the two new audit columns, which inherit the same
    blanket grant the moment they're added to `students`). Compare `subscription_status`
    (`017:194-196`, `GRANT UPDATE (subscription_status, ...) ON students TO ainext_operator`) —
    that column is *never* granted to `ainext_app` at all, which is why FR-2405's "cost-billing only"
    rule is a database fact, not just an application-code discipline. Curriculum should get the same
    treatment: `REVOKE UPDATE (curriculum_system, curriculum_updated_at, curriculum_updated_by) ON
    students FROM ainext_app` in migration 033, alongside the grant to `ainext_operator`. Today
    nothing exploits the gap because no student-facing endpoint writes `curriculum_system` — but
    FR-2013's own editor (grade/gender/interests self-service) is still unbuilt (PARTIAL,
    `specs/002-identity-and-admin-console/traceability.md:288`), and Samuel's decision above is
    explicit: **"changing a student's curriculum is console-only at launch."** The database should
    enforce that the day the column-level grants are written, not rely on every future engineer who
    touches a `students` UPDATE query remembering to exclude three columns by hand. This is exactly
    the ADR-0012 design principle ("row/column-level security enforced by the database, a forgotten
    filter returning nothing") applied to a column instead of a row — enforce it the same way.
    (See §4 for the one narrow case — the first-Google-sign-in step — that legitimately needs
    `ainext_app` to write `curriculum_system` once, and why that needs its own narrower grant plus
    an application-level "already set" guard rather than reopening the blanket one.)
- **F9 — SHOULD.** FR-4103 (console must state a headcount before hiding the last live course of a
  curriculum for a grade) already carries FR-2707's rule forward correctly ("count only, no name"
  reaches `content-review`). Worth a guard test analogous to the existing role-matrix test
  (`lib/auth/matrix.test.mts`) once built, scanning that the new curriculum-grouped `/courses` view
  and its confirmation copy never interpolate a student's name or id into a string `content-review`
  can read — the same shape `student-scope-guard.test.mts` (`research.md` D4 guard 1) is already
  planned for readers; role leakage through a count is a smaller but real version of the same bug
  class.

---

## 4. Sign-up and Google flows

### CSRF
Both auth cookies are `SameSite=Lax`, `HttpOnly` (`app/src/lib/auth/cookies.ts:52,83,100,112`),
which is the correct baseline for JSON POST endpoints reached only by same-origin `fetch` — a
cross-site form post or a `<script src>` on another origin cannot attach the session cookie to a
state-changing request. `/api/auth/signup` itself needs no CSRF token (it is unauthenticated — no
session exists yet to forge). This is existing, adequate protection and 003 does not weaken it.

### Open redirect (`safeNext`, FR-2015)
Already fixed, 2026-09-24, and fixed correctly. `app/src/components/auth/next-param.ts:41-57`
rejects control characters, parses against a placeholder origin, and re-checks the *parsed result*
for `//` (closing the exact bypass — `/%09/evil.example` — that a prefix check alone missed). 003
introduces no new `?next=`-shaped parameter; nothing here needs to change. Confirmed the sign-up
page (`app/src/app/(auth)/signup/page.student.tsx:29`) and the form
(`app/src/components/auth/SignupForm.tsx:53`) both route through `safeNext`.

### The one-screen step after a first Google sign-in — the real gap
This is genuinely new attack surface and it is **not yet designed carefully enough** in
`research.md` D2's one paragraph ("redirect once to a small grade and curriculum step... needs a
student-writable endpoint for grade and curriculum, a subset of FR-2013").

- **F10 — MUST.** Samuel's decision is explicit: *"Changing a student's curriculum is console-only
  at launch (operator action, recorded)."* A plain "student-writable endpoint for grade and
  curriculum" contradicts that the moment it is reachable more than once. Today's Google callback
  (`app/src/app/api/auth/google/callback/route.ts:109-115`) already distinguishes `created` (new
  account) from a returning sign-in — that is the right signal to gate on, but a signal checked at
  redirect time is not a signal enforced at the endpoint. Nothing currently in the schema records
  "this student has never been asked" as a durable, server-checkable fact (no `onboarded_at`,
  no `curriculum_chosen_at` — confirmed by search: no such column or flag exists on `students`
  today). Without one, the write endpoint itself cannot tell "first Google sign-in, asking for the
  first time" apart from "signed-in student calling the endpoint again a week later to pick a
  different curriculum" — which is precisely the self-service change Samuel just said is
  console-only. **Concrete fix**: the endpoint must check a durable per-student flag (e.g., "has
  `curriculum_system` and `grade` ever been explicitly set by this student" / a `curriculum_chosen_at
  IS NULL` guard already implied by FR-4003's "chosen vs. implied" distinction) and refuse a second
  write with something other than a silent no-op, so a bug here fails loud rather than becoming a
  quiet bypass of the console-only rule. Grant `ainext_app` a narrow column-level `UPDATE` on
  `curriculum_system`/`grade` scoped to this one endpoint's use (not reopening the blanket grant
  §3/F8 asks to close), and enforce "only once" in application code with a `WHERE curriculum_system
  IS NULL OR <implied-sentinel>` clause so even a replayed request is a no-op rather than a second
  chosen-curriculum write.
- **F11 — MUST.** `research.md` §4 D2 also flags a **real inconsistency worth resolving before
  `plan.md`, not after**: FR-4008 says a *self-service* grade change (FR-2013, student-initiated)
  MUST re-resolve curriculum when the new grade doesn't offer the current one — "asked if several
  are offered, implied if one is." Read literally, this lets a student bounce their own curriculum
  by changing grade away and back, entirely without an operator, which is a different door to the
  same room Samuel just said is console-only. FR-4007's edge case explicitly protects a **chosen**
  curriculum from being "moved or re-asked" when an *operator* changes a rule — but FR-4008 does not
  carry the same protection against a grade change forcing re-resolution of a curriculum the student
  *chose*. Recommend `spec.md` states plainly whether FR-4008's re-resolution can override a chosen
  (not implied) curriculum, or whether it should be narrowed to implied curricula only, with a chosen
  one requiring the settings flow (FR-4010) or an operator either way. This is a genuine spec
  contradiction, not an implementation bug — it needs Samuel's answer, and belongs beside Q1–Q3 as a
  fourth open question rather than left for an engineer to resolve by convention during `plan.md`.
- **F12 — SHOULD.** Whatever endpoint FR-4005/D2 builds for the sign-up-time question, validate the
  submitted `curriculum` **twice**: against the closed registry (a value that doesn't exist is
  always rejected — `research.md` D2 already says this) **and, separately, log/monitor but do not
  block** submissions where the value is a known curriculum but not one the grade currently offers
  (an operator hid it between page load and submit, as D2 notes) — resolve those server-side to
  "not offered → treat as none selected, resolve at next visit" (FR-4007's own mechanism) rather
  than silently accepting a hidden curriculum's id at face value. This avoids a student landing with
  a curriculum recorded that no rule currently serves, indistinguishable from a data-entry bug.

---

## 5. Isolation — can a student of one curriculum reach another's course by URL or API?

Ranked by what actually leaks, worst first. None of these five is a defect introduced by 003 —
`research.md` §2.3 and §10 already found all five — but **loading a second, differently-curriculum'd
book is what turns three of them from "harmless with one course" into "a real cross-curriculum and
content-embargo leak."** This section exists to rank them for `plan.md`, because not all five carry
equal urgency.

1. **`lib/ask.ts` — the Ask-the-Spine "source book" line — MUST, and time-sensitive.**
   `docRes` (`ask.ts:129`, `SELECT sha256, title, publisher, edition, grade, subject FROM
   source_documents ORDER BY ingested_at, sha256`) is read **unfiltered** by the course gate — of
   the eight reads in `askContextOn`, only `losRes`, `qRes`, `edgesRes`, `modulesRes` and
   `allVisuals` are narrowed by `gate` (`ask.ts:198-234`); `docRes` is not one of them, and `docs =
   docRes.rows` (`ask.ts:236`) carries every ingested book straight into the prompt. The fallback
   branch fires the instant a second book exists and no specific question is in scope:
   `"Source books (all ingested): ${docs.map(d => `"${d.title}" — ${d.publisher} (${d.subject}, grade
   ${d.grade})`).join("; ")}. Syllabus 2025–2026."` (`ask.ts:305-312`). **This means the Grade 10
   American Mathematics book's title, publisher and grade reach the tutor's context — and from there,
   plausibly, the student's own chat — for *every* National student's ordinary Ask-the-Spine turn,
   the moment the book is ingested into the shared database, regardless of the console gate, and
   before any operator ever flips the course live.** This directly violates FR-4202 ("Loading it, in
   any environment, MUST NOT make it visible"), FR-4006 (curriculum must scope "the data given to the
   tutor, the Ask-the-Spine context"), and Principle II (never ground in what the student cannot see).
   It is also the highest-severity item here because it requires no attacker action at all — an
   ordinary National student asking an ordinary question triggers it. **Fix** (already scoped as
   D4 row 8 in `research.md`, elevate it to a blocking precondition of FR-4208's production load
   rather than a nice-to-have reader fix): gate `docRes`/`docs` through `scope.doc` exactly as the
   other seven reads are gated, **before** the Grade 10 book is ingested into any database another
   student's traffic touches — including a local/shared dev database, since the same code path
   applies there too.
2. **`/dashboard` + `/api/dashboard` (`lib/dashboard.ts:37-100`, `getTopicBreakdown`) — MUST.**
   Entirely ungated by course. The query joins `graph_edges`/`graph_nodes` with no course or gate
   filter, so it returns every loaded course's module and LO **labels** (not just counts) as
   "not started," including the LO names of a curriculum the signed-in student cannot otherwise
   reach. Requires authentication (`requireStudent`-equivalent — confirmed via the route pattern
   used elsewhere) but not course-scoping. Once G10 loads, any signed-in National student's
   `/dashboard` names Grade 10 American Mathematics chapters, and vice versa. Directly violates
   FR-4006 (progress page is explicitly in its scoped-reader list). **Fix**: gate exactly as D4 row
   14 recommends, and treat it as a precondition of switching the course live, not a follow-up.
3. **Home `/` (`lib/queries.ts:64-110`, `getHomeStats`) — MUST.** Corpus-wide `los`/`questions`
   counts (not curriculum-scoped) and `source_documents LIMIT 1` with **no `ORDER BY`**
   (`queries.ts:87`) — non-deterministic once a second book exists, and able to hand back the Grade
   10 book's title/publisher/grade on an ordinary National student's home page before Samuel's
   "hidden until switched on" reveal. Same class of bug as #1, smaller blast radius (one card, not
   every Ask turn). **Fix**: D4 row 15 — scope counts and the document pick to the student's visible
   courses.
4. **`/api/visuals` (`app/src/app/api/visuals/route.ts`) — SHOULD.** Requires a signed-in student
   (`requireStudent()`, confirmed at `route.ts:20-27`) but performs **no course or LO-visibility
   check** on either `?id=` or `?lo=` — any authenticated student can fetch any stored figure by id,
   including a hidden/embargoed course's diagrams, by guessing or observing the id pattern
   (`v:<prefix>:<n>`, confirmed in `research.md` §2.4 item 5). Lower severity than #1–#3 because it
   requires deliberate enumeration and carries no answer text — but it is figures from an
   unreleased/embargoed book, which is exactly the content FR-4202 says loading must not expose.
   **Fix**: D4 row 16 — gate by the figure's LO through the same scope helper.
5. **`/api/attempts` — already fixed, confirmed, not a residual finding.** `research.md` §2.3
   confirms this is gated today (`app/api/attempts/route.ts:199-202`) after being one of the three
   leaks ADR-0018 itself names as the reason default-deny exists. No action needed; listed here only
   so the ranking above reads as complete rather than as an omission.

**F13 — MUST, tying #1–#3 together.** `spec.md`'s FR-4208 (the production load) and FR-4202
("hidden until switched on") together imply that *loading* the book is supposed to be safe even
before an operator's deliberate switch. Items #1 and #3 show that today it is not — loading alone,
independent of the console gate, changes what every existing student's tutor and home page can name.
Recommend `plan.md` treat "gate `lib/ask.ts`'s document read and `lib/queries.ts`'s home-page
document pick by the student's visible courses" as a **precondition of running the Grade 10 load at
all** — including a rehearsal load on a copy of production (FR-4209) — not as one row in a general
reader-hardening table to get to eventually. Loading the book into *any* database other students'
traffic touches, before this is fixed, already breaches FR-4202's own "loading it MUST NOT make it
visible" — the current code makes it visible through the tutor even with zero console rule written.

---

## 6. The "Load a course" production action

FR-4208 (spec.md) is explicit and correct in what it demands: backup first, printed rollback,
additive-only, safe to re-run, no visibility written. `research.md` D5's recommended mechanism (L1,
an additive CI deploy step, "if `graph_nodes` has no row with that course id, load it") gets the
**additive** part right, but as sketched does not yet meet FR-4208's own backup requirement, and the
existing precedent it's modeled on (`ci-cd.yml`'s "Curriculum (only when none is loaded)" step,
`.github/workflows/ci-cd.yml:602-628`) has the same gap today.

- **F14 — MUST.** The current "Curriculum (only when none is loaded)" step
  (`ci-cd.yml:614`, `if [ "$N" -ge 3 ]; then ... exit 0`) and the "Generated maths content" step
  (`ci-cd.yml:650-654`, `if [ "$GEN" -ge 590 ]; then ... exit 0`) both gate on **total counts**, not
  on the specific course/content's presence, and **neither takes a `pg_dump` backup before running.**
  Their safety argument is "the loader only adds rows when the subtree is absent" — true of the
  loader's code today, per `load_seed.py:611-654`'s cited behavior, but that is a property of one
  script staying correct, not a property the deploy step itself verifies or can recover from if
  violated. Compare `deploy/refresh-content.sh`, which **is** how the codebase defines "safe content
  mutation" (constitution X, `refresh-content.sh:11`: "Everything that writes takes a pg_dump backup
  FIRST"). The Grade 10 load step should follow `refresh-content.sh`'s pattern, not the two existing
  first-boot steps' weaker one: (a) check the **specific course id's absence**
  (`SELECT 1 FROM graph_nodes WHERE id = 'course:us-g10-math-en'`), not a total count — a total-count
  gate silently stops protecting anything the moment a course is added or removed for any other
  reason and the count drifts from what the check-writer assumed; (b) take a `pg_dump` backup
  immediately before the loader runs, every time, even though the loader is believed additive-only —
  FR-4208 already asks for exactly this, and the cost is small next to what a wrong flag or a loader
  regression would do to real students' attempts and mastery (`load_seed.py:19-23`'s own documented
  failure mode: "Student attempts/mastery referencing the deleted content are deleted with a printed
  warning" — the failure mode this guards against is not hypothetical, it's the documented behavior
  of the same tool run with the wrong argument); (c) print the one-line rollback path per FR-4208,
  using the backup just taken.
- **F15 — MUST.** `research.md` §2.5 and §10 item 5 both confirm `refresh-content.yml`/`.sh` — the
  **only** backed-up, typed-confirmation, constitution-X-compliant manual content path in this
  codebase — targets the **frozen baseline stack** (`APP_DIR: /opt/reletix/AI.NEXT`, database
  `ainext_poc`), not noor's (`AI.NEXT-mvp1` / `ainext_mvp1`). FR-4210 (a later *reload* of this
  course once students have studied it — a near-certainty for a book this size) is a "content
  refresh" under Principle X and explicitly requires exactly this kind of workflow. Today there is
  **no such path to the environment this feature ships to.** Recommend retargeting (or duplicating)
  `refresh-content.yml`/`.sh` to noor's stack be treated as a **dependency of FR-4210**, not
  optional follow-up work — without it, the first time this course needs a real correction after
  students have used it, the only available lever is the unbacked, count-gated first-boot pattern
  F14 already flags as insufficient, applied to a database that by then has real student data in it.
- **F16 — SHOULD.** GitHub Actions secrets: the existing pattern is sound (self-hosted runner,
  secrets injected as job env vars, `build` runs on GitHub-hosted runners with no secrets even on
  forked PRs — confirmed `ci-cd.yml:14-30`'s trigger block separates `build`/`pull_request` from the
  secret-bearing deploy path). The new load step needs no new secret — it reuses the loader's
  existing DB role credentials. Confirm it stays inside the same gated `deploy` job
  (`needs: [build, migrations]`, manual-only per the file's own header comment) rather than becoming
  a separately triggerable step; nothing in `research.md` D5 suggests otherwise, this is a
  keep-it-that-way note for whoever writes the actual YAML.
- **F17 — NICE.** `parity_check.py` keyed by course id (D5's own precondition list, `research.md`
  §4 D5) is also a security-adjacent control here, not just a content one: it is what will notice if
  the Grade 10 load step ever partially applies or drifts. Worth explicitly listing "the drift guard
  passes for both courses" as one of the load step's own post-flight checks (FR-4209 already asks
  for a console-visible completeness check; add the drift guard's own pass/fail next to it).

---

## 7. Anything else

- **F18 — SHOULD.** `spec.md` FR-4009 (a test-account exception can cross curricula, "the one
  sanctioned way") is the correct design — it reuses `student_course_access`, which already has
  `ENABLE`+`FORCE ROW LEVEL SECURITY` and a per-principal policy
  (`db/migrations/023-course-availability.sql:170-187`), and `ainext_app` already holds SELECT-only
  on it (no student-facing write path exists, confirmed `023:157-160`). No change needed here; flag
  only that when the console UI groups courses by curriculum (D3), the exception editor must keep
  showing an out-of-curriculum exception clearly labelled as such (not silently folded into the
  student's "own" curriculum's section) — otherwise an operator reviewing Student 360 could lose
  track of which access is the rule and which is the one deliberate override, which is exactly the
  kind of operator confusion ADR-0018's "every change is recorded... who turned this off and what
  for" was written to prevent.
- **F19 — SHOULD.** `research.md` §2.4 item 4 notes that a second English maths course makes
  `BY_SPINE_KEY`'s subject→course mapping ambiguous, and D4's `courseForSubject(key)` resolves it
  within the student's own scope. Worth one explicit test case in whatever guard suite ships with
  003: a **tester account holding a cross-curriculum override** for a second course of the same
  subject must never have the two courses' content interleaved in one list (FR-4009's own "never
  interleaved" rule) — this is the one case where isolation-by-curriculum is deliberately
  bypassed for one account, so it is also the one case most likely to accidentally leak the *other*
  curriculum's content into the *tester's own* single merged view if a reader forgets to split by
  course rather than by subject. `research.md` §5 flags this generally; naming it as a specific test
  case is cheap now and expensive to reconstruct later.
- **F20 — NICE.** Not a 003 defect: `db/migrations/007-*.sql` NULLs any
  `understanding_checks.subject` outside `('math','social','arabic')` on **every deploy**
  (`research.md` §10 item 6, confirmed pattern matches the `886b302` outage this repo's own commit
  log names — migration 008 re-adding a narrow CHECK over rows 010 had widened). This is a latent
  trap for the *next* feature that introduces a fourth spine key, not this one (003 deliberately
  keeps the spine key `math`, per D1.2 recommendation ii) — flagging it here only so it is on record
  before someone hits it, since this review already had to trace the exact failure shape once for
  F14.

---

## Summary for `plan.md` and the owed ADR-0024

Nothing above blocks *specifying* 003 further — `spec.md`'s requirements are, with F11's
contradiction resolved, privacy-sound as written. It blocks **building without these fixes**:

- **F4, F8, F10, F13/F14/F15** are pre-conditions of FR-4208's production load, not follow-on work —
  three of them (F4, F8, F10) are about who can write `curriculum_system` and to GA4, and two
  (F13, F14/F15) are about the load step itself being unable to make good on FR-4208's own backup
  and FR-4202's own "loading MUST NOT make it visible" promises as currently sketched.
- **F1 leak in `lib/ask.ts` (item 1 of §5) is the single highest-severity finding**: it requires no
  attacker, fires on ordinary use, and already breaches FR-4202 the moment the book is ingested
  anywhere shared — recommend it gate the Grade 10 ingest itself, not just the eventual console
  switch-on.
- **F11** (FR-4008 vs. the console-only decision) needs Samuel's answer before `plan.md`, alongside
  Q1–Q3 already in `spec.md`.
