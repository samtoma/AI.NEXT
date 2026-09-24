# Feature Specification: Identity & Admin Console

**Feature Branch**: `req/identity-and-admin-console`
**Created**: 2026-09-20
**Status**: Implemented, not merged and not deployed — phases P0–P6 landed on
`feat/002-identity-and-admin-console` on 2026-09-21. *(Was "Draft — requirements only, no
implementation"; corrected 2026-09-22, when this spec also gained the course-availability
requirements, which were written after their code and are stamped as such.)*
**Last amended**: 2026-09-24 (turn limits) — **FR-3401…FR-3406** added ([ADR-0023](../../docs/decisions/0023-turn-limits-observed-not-enforced.md), turn limits become observed thresholds, not an enforced cap); superseded 001's `FR-051`. Before that, 2026-09-24 (fix pass 2) — **FR-2015** added (sign-in redirects stay on the site — a security fix); **FR-3105** (a sitting that stopped probing never starts again), FR-3106, FR-3107 and FR-3111 amended in place, each marked. Before that, 2026-09-24 (fix pass) — **FR-3105** (Off reaches the next message, On the next sitting — Samuel's option B), FR-3102, FR-3106, FR-3107, FR-3108, FR-3110, FR-3111 and FR-3202 amended in place, each marked. Before that, 2026-09-24 — **FR-3101…FR-3111** (teaching controls and testers, [ADR-0021](../../docs/decisions/0021-runtime-teaching-toggle-and-testers.md), migrations 029–030), and **FR-3201…FR-3214** (what v0.6.0 shipped without a requirement, written down). Earlier: 2026-09-22 — **FR-2701…FR-2711** added ([ADR-0018](../../docs/decisions/0018-course-availability.md)), then **FR-2801…FR-2811** (in-product feedback, migration 025), then **FR-3001…FR-3010** (runtime health, migration 026)
**Input**: Samuel's brainstorm decisions D1–D11 (2026-09-20). Replace the student picker with real
student-owned accounts and move per-student isolation from a remembered `WHERE` clause into the
database. Give the operator surfaces a deliberate home — an admin console on its own build target,
with per-person roles, per-student cost, a replayable interaction timeline, sign-in monitoring and
analytics.

> **Product authority (unchanged)**: `PRD: AI Tutor — Student MVP` v0.4, Tamer Deif, Drive
> `1gUAF0IyHRBr47k7aqiPxe9q22CJy8A7JwVqI405bRnk`. This feature changes no product scope; it supplies
> the identity layer PRD Epic A always assumed and the operator tooling the PRD never covered.
> **Feature being extended**: `specs/001-student-mvp1-delta/spec.md`, shipped as `PDR1-0-v0.4.0`.
> **Engineering authority**: `.specify/memory/constitution.md` **v3.1.1** + ADR-0001..0011, plus
> **ADR-0012** (Per-student isolation is enforced by the database), **ADR-0013** (Student-owned
> accounts, parent-linkable, with Reletix-pattern sign-in), **ADR-0014** (The admin console is a
> second build target of one codebase), **ADR-0015** (One interaction timeline per student per
> session, replayed by reconstruction) and **ADR-0016** (Analytics and monitoring: three layers, one
> system of record) — all five accepted 2026-09-20.
> **Scope decisions**: `decisions.md` in this directory — eleven answers from Samuel (2026-09-20),
> which this spec is cut against. Requirements in 001 that this supersedes are stamped in place there
> rather than deleted, so the chain stays legible.
> **Governance**: `constitution-amendment-proposal.md` here proposes that Principle VII be materially
> expanded (v3.1.1 → v3.2.0). It is **awaiting Samuel's approval**; nothing in it binds until he
> approves it in the constitution itself.
>
> **Amended 2026-09-24 (v0.8.0)**: **FR-3301…FR-3312** — console sign-in from the Cloudflare Access
> identity ([ADR-0022](../../docs/decisions/0022-console-signin-from-cloudflare-access.md)), placed
> after FR-2211 in *Admin console & roles* because it is how an operator reaches that console.
>
> **Amended 2026-09-24 (v0.9.0 in progress)**: **FR-3401…FR-3406** — Samuel: *"remove the limits,
> make them highlight in the admin console, we need to know how often those limits are triggered"*
> ([ADR-0023](../../docs/decisions/0023-turn-limits-observed-not-enforced.md)). No surface refuses a
> turn for count any more; the three per-surface numbers survive as named, observed thresholds shown
> in the console. Supersedes 001's `FR-051`.

## Why this feature exists

**A build switch cannot tell people apart.** FR-605 shipped in `PDR1-0-v0.4.0` and did what it
promised: the extraction pipeline, the content review queue, the gallery and the developer harnesses
stopped resolving in the student build, so a guessed URL reaches nothing. What it cannot do is
distinguish one person from another — its own source comment says so. FR-606 asked for the real
thing, per-person authorisation with roles, and has been **BLOCKED** since it was written, on FR-106,
which is **DEFERRED**. Three requirements — self-signup, account-sharing deterrence, operator roles —
are blocked on one missing thing: accounts.

**Isolation today is a `WHERE` clause somebody remembered.** Every query touching a student's data
carries `WHERE student_id = …` because whoever wrote it remembered to; there is no single place the
rule could be applied once. Adequate for five demo students behind an invite list, inadequate for
real accounts — and not hypothetical. The operator pipeline view reads **the most recent tutor turn
written by any student, with its grounding**, and shows it: a conversation, not a counter. The roster
endpoint behind the picker returns **every student's name, grade, interests and progress counters**
to anyone who can reach the app. Both are the picker era's contract working as designed; neither
survives real accounts.

**The founders need to see the product now, at startup stage.** Samuel's explicit call: he wants to
see what each student costs, what each student actually said and was told, and who is trying to sign
in — at full fidelity, with disclosure his responsibility rather than a blocker. That is a decision
with a cost, stated as one here (D7, and the accepted risks in `decisions.md`) rather than smoothed
over. What it buys is the ability to answer "is this teaching working, and what does it cost per
student?" from data instead of opinion — the question the whole `PDR1-0` solution exists to answer.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — I make my own account and see only my own world (Priority: P1)

A student creates an account with an email address and a password, confirms the email, signs in and
lands in a mathematics lesson. Signup asks for name, grade, gender and interests. From then on the
tutor addresses them correctly, everything they see is theirs, and no other student is listed.

**Why this priority**: nothing else here exists without it — roles need accounts, isolation needs a
principal, the timeline needs an owner, cost needs a subject. It has blocked three requirements.

**Independent Test**: from a clean browser, create an account, confirm the email, sign in, reach the
first streamed tutor message, and confirm no surface names or lists another student.

**Acceptance Scenarios**:

1. **Given** a visitor with no account, **When** they complete signup, **Then** the product captures
   email, password, display name, grade and gender, offers interests as optional, and asks for
   nothing else — no parent contact, no phone number, no free-text profile.
2. **Given** a new account, **When** the student tries to start a lesson before confirming their
   email, **Then** they are told plainly what is outstanding and offered a resend, and no lesson
   starts.
3. **Given** a confirmed account, **When** the student signs in, **Then** they reach their own lesson
   and their sign-in survives a reload and a browser restart without re-entering anything.
4. **Given** a student whose gender is recorded as female, **When** the tutor addresses her anywhere
   — lesson, chat, check-in, dashboard copy — **Then** the form of address is correct for her in both
   English and Arabic, with no masculine default.
5. **Given** a signed-in student, **When** they open any part of the product, **Then** no name,
   count, list or figure belonging to another student is on the page or in anything it fetched.
6. **Given** a student checking where they are signed in, **When** they open account settings,
   **Then** they see each active sign-in with device and last-used time and can end one or all.

---

### User Story 2 — A forgotten filter cannot leak (Priority: P2)

An engineer adds an endpoint and forgets to scope it to the signed-in student. Instead of serving
another student's rows, it returns nothing. A student who edits an identifier in a URL to point at
someone else's lesson, upload or attempt is told it does not exist — not that it is forbidden.

**Why this priority**: it is what makes P1 worth having. Accounts without enforced isolation are a
login-shaped thing in front of shared data — worse than a picker, because it implies a protection
that is not there.

**Independent Test**: run a deliberately unscoped read against each kind of student data and confirm
it returns nothing; then, as one student, request a second student's records by identifier through
every student-facing route and confirm each answers as not-found.

**Acceptance Scenarios**:

1. **Given** a request touching student data with no student established, **When** it runs, **Then**
   it returns nothing and changes nothing — never everything.
2. **Given** student A signed in, **When** they request a record belonging to student B, **Then** the
   product answers exactly as it would for a record that does not exist.
3. **Given** student A signed in, **When** they attempt to change a record belonging to student B,
   **Then** it is refused, A sees a plain refusal, and the attempt is recorded as a security event
   naming who attempted what.
4. **Given** the operator pipeline view, **When** an operator opens it, **Then** it no longer shows
   the most recent tutor turn written by whichever student last used the product.
5. **Given** any student surface, **When** it asks for a list of students, **Then** there is no such
   list to get — the all-students roster is not reachable from a student build at all.
6. **Given** work done after a request has finished — parsing an upload, recording an event —
   **When** it writes, **Then** it writes under the student it was started for and under no other.

---

### User Story 3 — An operator gets in with a role; a student cannot get in at all (Priority: P3)

Samuel opens the console on its own address, signs in with his own operator account and sees the
surfaces his roles permit. A second operator holding only content-review sees the review queue and
nothing else. A student who types the console's address reaches nothing, signed in or not.

**Why this priority**: FR-606 unblocked. Content-review is a safety control, not an administrative
convenience — it governs the human gate the unreviewed-content exception depends on (constitution
III, 001 FR-C02). A role attaches to an account, so it follows P1 and P2.

**Independent Test**: seed two operator accounts with different roles and one student account; try
every console surface as each; confirm the permitted set matches the roles exactly, that refusals
come from one place, and that the student build has no console in it.

**Acceptance Scenarios**:

1. **Given** the student build, **When** any console address is requested, **Then** it does not
   resolve — the console is absent from that build, not hidden from its navigation.
2. **Given** the console build, **When** an unauthenticated visitor arrives, **Then** they get a
   sign-in and nothing else; no console data renders before a role is established.
3. **Given** a signed-in student account, **When** it reaches the console, **Then** it is refused and
   the refusal is recorded; a student account can never hold an operator role.
4. **Given** an operator holding only `content-review`, **When** they open the console, **Then** they
   see the content review surface and are refused everywhere else, each refusal recorded.
5. **Given** a console surface added later, **When** a request reaches it, **Then** it passes the
   same single authorisation check as every other — a surface cannot decide for itself.
6. **Given** the curriculum graph explorer (`/spine`), **When** a student opens it, **Then** it works:
   it is a student surface and does not move behind the console.

---

### User Story 4 — One student, everything, and the look itself is recorded (Priority: P4)

An operator with the `student-data` role opens one student and sees profile, mastery, sessions, cost
to date, sign-in history, and one ordered timeline of everything in a session — tutor turns, answers,
understanding checks, uploads, mastery movement — replayable as the student saw it. Opening that
record writes a line saying who opened whose record and when, which the operator cannot remove.

**Why this priority**: what Samuel asked for, and the most sensitive surface this product has ever
had. P4 because it needs accounts, isolation and roles beneath it.

**Independent Test**: drive a student through a session with a wrong answer, an understanding check,
an upload and a mastery move; open them in the console; confirm each appears in the timeline in
order, that replay says it is reconstructed, and that a read record names the operator.

**Acceptance Scenarios**:

1. **Given** a student who has used the product, **When** an operator opens them, **Then** one page
   shows profile, mastery by topic, sessions, cost to date, subscription/payment status and sign-in
   history.
2. **Given** one session, **When** the timeline renders, **Then** tutor turns, answers, understanding
   checks, uploads, widget outcomes and mastery movements appear in a single time order, not as
   separate lists the reader must merge by eye.
3. **Given** a replayed session, **When** it renders, **Then** it shows what the student saw and is
   labelled a reconstruction rather than presented as a recording.
4. **Given** a replay, **When** an operator moves through it, **Then** nothing is written into the
   student's record — no attempt, no mastery movement, no event attributed to the student.
5. **Given** an operator opening a student's record, **When** the page loads, **Then** a read record
   is written naming operator, student, time and what was opened, and it cannot be edited or deleted
   by the operator who caused it.
6. **Given** an operator holding only `cost-billing`, **When** they attempt a transcript, **Then**
   they are refused, the refusal is recorded, and no content is returned.

---

### User Story 5 — What each student costs, and where they stand commercially (Priority: P5)

Samuel opens the cost view and sees total spend for a period, spend per student over time, and AI
spend separated from upload and OCR spend. Each student carries a subscription/payment status he can
read and set — with no payment system behind it and nothing pretending there is one.

**Why this priority**: cost visibility is a standing constitutional obligation (VI) that today stops
at a 30-day cross-student view, with no per-student time series and no commercial status at all.

**Independent Test**: run three students with different usage including one upload; confirm each has
its own cost, that AI and upload/OCR totals are separate, and that a subscription status changes
nothing about access.

**Acceptance Scenarios**:

1. **Given** a student with at least one interaction, **When** the cost view renders, **Then** they
   have a cost figure, and the per-student figures reconcile with the overall total for that period.
2. **Given** a student who has uploaded material, **When** their cost is shown, **Then** AI spend and
   upload/OCR spend are separate figures, not one blended number.
3. **Given** a period selector, **When** an operator changes it, **Then** per-student cost is shown
   over time, not only as one window total.
4. **Given** a student whose subscription status is set to any value, **When** they use the product,
   **Then** nothing about their access changes — the status is a record, not a gate.

---

### User Story 6 — Who is trying to get in (Priority: P6)

Every sign-in attempt — successful or failed, student or operator — is recorded and visible in a
security view within a minute. Repeated failures throttle and then lock the account for a stated
period, and the lockout is itself an event somebody can see.

**Why this priority**: once accounts exist, sign-in is the front door. The pattern being mirrored has
no lockout at all, and four named security events defined and never emitted; copying that copies the
bug.

**Independent Test**: attempt sign-in with a good password, a bad password, an unconfirmed account
and a locked account; confirm each produces its named event, visible within a minute, with a test
asserting it fires.

**Acceptance Scenarios**:

1. **Given** any sign-in attempt, **When** it completes, **Then** an event is recorded naming the
   outcome and appears in the console's security view within one minute.
2. **Given** repeated failures on one account, **When** the threshold is crossed, **Then** further
   attempts are refused for a stated period and a lockout event is recorded.
3. **Given** a locked account, **When** the period passes or an operator clears it, **Then** the
   student can sign in again and the clearing is itself recorded.
4. **Given** a failed sign-in for an email with no account, **When** the product answers, **Then**
   the answer is indistinguishable from a wrong password on an account that exists.
5. **Given** every event name this feature defines, **When** the test suite runs, **Then** each has a
   test asserting it was actually emitted — defining it is not enough.

---

### User Story 7 — Overviews that answer a founder's question (Priority: P7)

A founder asks: how many students are active this week, how are they doing per subject, how does this
school year compare with the last, which topics are stalling? The console answers from the
first-party event stream. A separate anonymous product-analytics stream gives the coarse web
behaviour the first-party stream is not shaped for, carrying no identifier and no content.

**Why this priority**: it is the observational judgement ADR-0010 left us with — the comparison is
made from live usage, so the views showing live usage are the instrument. The events mean nothing
until P1–P5 produce them.

**Independent Test**: complete one student journey end to end; confirm every first-party event fired
with its environment tag, that per-student, per-subject and per-school-year views reflect it, and
that the anonymous stream carried nothing identifying the student.

**Acceptance Scenarios**:

1. **Given** any recorded interaction, **When** the event is stored, **Then** it names which
   environment produced it, and no view pools figures across environments or solutions.
2. **Given** the anonymous analytics stream, **When** any event is sent, **Then** it carries no
   student identifier, no message content, no email, no name and no gender.
3. **Given** a browser blocking that stream entirely, **When** a student uses the product, **Then**
   the full journey works unchanged — no blocked request degrades a lesson.
4. **Given** a school year of data, **When** the overview renders, **Then** it can be broken down per
   student, per subject and per school year.

---

### User Story 8 — Run both surfaces on my machine with one command (Priority: P8)

Samuel runs one command and gets a working student surface and a working admin console against the
same local database, today and tomorrow, without reading a deployment guide. Deploying the console to
the shared box is a later step and is not part of this.

**Why this priority**: D3 makes it a requirement, not a convenience — the console cannot be reviewed
or iterated on if standing it up is a project. Verifiable the moment P3 is real.

**Independent Test**: from a clean checkout on a machine with no prior state, run the documented
command and reach both surfaces in a browser, the console refusing an unauthenticated visitor and the
student surface serving a lesson.

**Acceptance Scenarios**:

1. **Given** a clean checkout, **When** the documented command runs once, **Then** both surfaces are
   reachable locally and the shared database is prepared, with no further manual steps.
2. **Given** both running locally, **When** an operator signs into the console, **Then** the student
   surface is unaffected and neither surface can serve the other's pages.
3. **Given** a first run with no operator account, **When** it completes, **Then** there is a
   documented, repeatable way to obtain the first operator account, and running it again does not
   create a second one.

---

### User Story 9 — A parent can be linked, later (Priority: P9) **[DEFERRED — architecture only, D1]**

> **Not built in this release.** The account model, the data model and these requirements are shaped
> so the parent link and the parent view can be added without re-cutting identity. Phone and
> one-time-code sign-in is in the same position: designed for, not built. Retained in full so the
> scope is re-openable without re-deriving it.

A parent is linked to one student, receives a read-only view of that student's performance data, and
never sees a transcript. A student signs in with a phone number and a one-time code instead of an
email and a password, and ends in exactly the same signed-in state.

**Why this priority**: the parent usually pays, so the link underwrites conversion — but the PRD
keeps the parent light, 001 already deferred the payment path, and building a second audience before
the first has accounts is how identity gets re-cut twice.

**Independent Test**: not testable this release. When built: link a parent, verify performance data
is visible and transcripts are not, and verify a phone sign-in produces the same session record as a
password sign-in.

---

### Edge Cases

- **The confirmation link has expired.** The student is told plainly and offered a new one on the
  spot. An expired link never signs anybody in, and never reveals whose address it was.
- **The account locks while a lesson is open.** The student's place is preserved and restored on the
  next sign-in; a lockout must never present as a crash or a blank page.
- **An operator holding only `cost-billing` opens a pasted transcript link.** Refused, recorded as a
  permission denial, nothing returned — not a preview, not a length, not a turn count.
- **A student's account is deleted while an operator reads their timeline.** The read stops and says
  the record is gone; nothing is silently substituted. The operator-read records already written
  survive, because they record what an operator did, not who the student was.
- **A session is never closed** — the laptop shuts mid-lesson. Sessions must be closable by rule
  (inactivity), and one closed that way distinguishable from one the student finished.
- **Anonymous analytics is blocked by the browser or an extension.** The product is entirely
  unaffected: no lesson, lesson step, upload or console view may depend on a third-party script.
- **Two surfaces share one database.** Neither may serve the other's pages, an operator action must
  never be attributable to a student, and a student action never to an operator.
- **The picker-era students — the demo cast — are already in the database**, with no email, password
  or gender. Each is either claimed by a real account or retired from every student surface; their
  history is retained and stays visible in the operator views, and with gender unknown the tutor
  addresses them in a form correct for either until it is set.
- **An interaction arrives that cannot be attributed to a session.** Recorded as belonging to no
  session and visible as such — never attached to whichever session happens to be nearest.

## Requirements *(mandatory)*

> These are obligations on the product, testable, written for a non-technical founder. They name no
> table, column, library or framework — `plan.md` and `data-model.md` own that. **[DEFERRED — Dn]**
> marks what is designed for and not built, citing the decision that defers it. Numbering: **FR-20xx**
> accounts and sign-in · **FR-21xx** isolation and authorisation · **FR-22xx** console and roles ·
> **FR-23xx** timeline and replay · **FR-24xx** cost and status · **FR-25xx** monitoring and analytics
> · **FR-26xx** tutor voice and gender · **FR-27xx** course availability · **FR-28xx** in-product feedback · **FR-29xx** deferred · **FR-30xx** runtime health · **FR-31xx** teaching controls and testers · **FR-32xx** shipped in v0.6.0 without a requirement, written afterwards.
> (**FR-30xx** rather than continuing into 29xx: that block is "deferred by design" and has been
> since rev. 1, so a live requirement inside it would be read as deferred by anybody scanning.)
> `FR-1xx…FR-12xx` are from
> `specs/001-student-mvp1-delta/spec.md`. Implementation status is tracked in `traceability.md` here,
> deliberately harsher: code that exists but has never run is not done.

### Accounts & sign-in (FR-2001…)

- **FR-2001**: A student MUST own their own account, and one account MUST hold exactly one student.
  The product MUST NOT offer any way to become a different student.
- **FR-2002**: Signup MUST capture email address, password, display name, grade and gender, and MUST
  offer interests as optional and skippable without blocking (carrying FR-104 unchanged). It MUST NOT
  ask for a parent contact, phone, address, school or free-text profile this release (constitution
  VII).
- **FR-2003**: A password MUST be stored only in a form that cannot be turned back into the password,
  and MUST never appear in a log, an event, an error message or a web address.
- **FR-2004**: A student MUST confirm their email address before the account can be used for
  learning. Until then the product MUST say plainly what is outstanding and offer to send the
  confirmation again. A confirmation link MUST expire, and an expired one MUST offer a new one.
- **FR-2005**: A student MUST be able to sign in with email and password. A failed sign-in MUST NOT
  reveal whether the address has an account, nor which of the two was wrong.
- **FR-2006**: A student MUST be able to sign in with Google. One email address MUST resolve to one
  account however they signed in, and a Google sign-in MUST end in the same signed-in state as a
  password sign-in.
- **FR-2007**: The credentials that keep a student signed in MUST NOT be readable by any script
  running on the page, nor placed in a web address, redirect or page parameter that reaches a browser
  history or a server log.
- **FR-2008**: The credential authorising each request MUST be short-lived and renewable without
  asking the student to sign in again. The renewal credential MUST be replaced on each use, MUST be
  revocable on its own, and reusing one already replaced MUST end every sign-in for that account.
- **FR-2009**: A student MUST be able to see every place they are signed in — device and last-used
  time — and end one or all. *(What remains of 001's FR-604 account-sharing deterrence: not a
  guarantee, but the student's own visibility and control.)*
- **FR-2010**: A student who has forgotten their password MUST be able to set a new one from their
  email address. The reset MUST be single-use, MUST expire, and the request MUST answer identically
  whether or not the address has an account.
- **FR-2011**: Repeated failed sign-in attempts on one account MUST be slowed and then refused for a
  stated period. Threshold and period MUST be documented rather than discovered, and both throttling
  and lockout MUST be recorded as events (FR-2501).
- **FR-2012**: A student MUST be able to sign out, ending that sign-in immediately rather than
  waiting for a credential to expire.
- **FR-2013**: A student MUST be able to change display name, grade, gender and interests after
  signup, and a change MUST take effect in the tutor's next turn (FR-2606).
- **FR-2014**: The picker-era student records — the demo cast — MUST NOT remain reachable from any
  student surface once accounts exist. Each MUST be either claimed by a real account or retired from
  every student surface. Their learning and interaction history MUST be retained and stay visible in
  the operator views; nothing in this migration may delete history silently.
- **FR-2015** **[ADDED 2026-09-24 — security fix, fix pass 2]**: After signing in or signing up —
  and when an already-signed-in visitor opens either page — the product MUST send the browser only
  to a page on **its own site**, on both the student product and the console. A destination carried
  in the link (`?next=`) that would leave the site, however it is spelled — another host, a
  scheme, `//host`, a backslash, a tab or newline a browser would strip, or `.`/`..` segments that
  resolve to `//host` — MUST be replaced by the page's own default destination. *(Written with its
  fix: `?next=/%09/evil.example` was reaching another site from noor.reletix.com.)*

### Isolation & authorisation (FR-2101…)

- **FR-2101**: Per-student isolation MUST be enforced beneath the application, so a read or write of
  student data carrying no student scope returns nothing and changes nothing. A missing scope MUST
  fail closed, and application-level filtering MUST NOT be the only thing between one student's data
  and another's (ADR-0012).
- **FR-2102**: Every request MUST establish which student it acts for before touching student data,
  and that MUST be the single source of the scope. No part of the product may take the acting student
  from a value the browser supplied.
- **FR-2103**: A student's attempt to **read** another student's record MUST be answered exactly as a
  record that does not exist — "not yours" and "not there" MUST be indistinguishable. An attempt to
  **change** another student's record MUST be refused explicitly and recorded as a security event
  naming who attempted what (FR-2501).
- **FR-2104**: The two cross-student exposures that exist today MUST be closed by name and covered by
  tests that fail if they return: the operator pipeline view's read of the most recent tutor turn
  written by any student, and the all-students roster behind the picker. Neither may be reachable
  from a student build.
- **FR-2105**: Work performed after a student's request has finished — parsing an upload, recording
  an event, flagging a gap — MUST carry the same student scope as the request that started it, and
  MUST NOT be able to write under any other student.
- **FR-2106**: Every operator surface MUST pass through one server-side authorisation point. A
  surface MUST NOT decide its own access, and adding one MUST NOT be possible without passing that
  check. There MUST be exactly one such check, covered by tests asserting a refusal for every role
  that should not reach each surface.
- **FR-2107**: Hiding a control, omitting a link or not rendering a page MUST NOT be relied on as
  authorisation, and MUST NOT be described as such anywhere in the product or its documentation.
- **FR-2108**: A read that is deliberately across students — a cost total, a content count, an
  overview — MUST be a named, role-gated exception with an owner, never the absence of a scope. Every
  such read MUST appear in one enumerated list, and a read not on that list MUST fail closed.
- **FR-2109**: Every record this feature creates MUST identify which environment produced it, no view
  may pool figures across environments or solutions, and student data MUST NOT cross solutions
  (constitution XI).

### Admin console & roles (FR-2201…)

- **FR-2201**: The student build MUST NOT contain the admin console; its addresses MUST NOT resolve
  in that build, so a guessed or shared link reaches nothing. *(Carries 001 FR-605 unchanged: a
  build-scope obligation that MUST NOT be presented or relied on as authorisation.)*
- **FR-2202**: Reaching any operator surface MUST require a signed-in operator account holding a role
  that permits it. *(This closes 001 FR-606, blocked on accounts since it was written.)* Build scope
  and per-person authorisation are both required; neither substitutes for the other.
- **FR-2203**: Operator roles MUST be **`content-review`**, **`evidence-access`**, **`student-data`**
  and **`cost-billing`**, granted per person and deliberately. No role MUST imply another, and there
  MUST be no role that grants everything by default.
- **FR-2204**: `content-review` is a **safety control**, not an administrative convenience: it
  controls the human gate the unreviewed-content exception depends on (constitution III, 001 FR-C02).
  Granting, removing and exercising it MUST be recorded, and the product MUST NOT describe it as a
  content-management permission.
- **FR-2205**: A student account MUST NOT be able to hold an operator role or reach the console. An
  attempt MUST be refused and recorded (FR-2501).
- **FR-2206**: The curriculum graph explorer (`/spine`) MUST remain a student surface and MUST NOT
  move behind the console.
- **FR-2207**: Operator access MUST be a distinct, recorded path: every operator sign-in MUST be
  recorded with the roles in effect, separately identifiable from a student sign-in.
- **FR-2208**: For the pilot, the console MUST remain behind the invited-audience access control
  (001 FR-907) **in addition to** operator accounts, not instead of them.
- **FR-2209**: The console's visual language MUST come from the published design system, like every
  other surface this repository builds (constitution XII, 001 FR-1001). An internal tool may lag the
  system; it MUST NOT diverge from it on purpose.
- **FR-2210**: Both surfaces MUST be runnable on one machine with a single documented command against
  one local database, with no manual steps beyond it. Obtaining the first operator account MUST be
  documented and repeatable, and running the command again MUST NOT create a second one.
- **FR-2211**: Every console view MUST be readable without reading code: every figure carries its
  unit and the period it covers, every identifier is shown beside the name it belongs to, and no
  column heading is a field name.

### Console sign-in from Cloudflare Access (FR-3301…) **[ADDED 2026-09-24 — ADR-0022]**

> **Samuel, 2026-09-24**: *"the email verification is done through cloudflare, can you use this
> email from cloudflare"*. That is the authorisation; these twelve were written with their code, in
> the same change, and nothing here is back-dated. Numbered **FR-33xx** because FR-31xx and FR-32xx
> were taken by the v0.7.0 blocks written the same day.
>
> **What this amends, stated honestly.** No FR in this spec says an operator signs in *with a
> password* — FR-2202 and FR-2207 say "a signed-in operator account" and "every operator sign-in",
> and both still hold word for word. The password path for operators is specified only in
> `contracts/auth.md` §Operator authentication, and **that section is AMENDED** (password becomes
> the fallback, FR-3308). **FR-2208** — Access in front of the console *in addition to* operator
> accounts — is unchanged and now carries more weight: Access admits, and also proves which operator
> row; the row is still required. Implementation status is in `traceability.md`, §3b.
>
> "The access control" below is the invited-audience control FR-2208 names — Cloudflare Access on
> the console's hostname for the pilot.
>
> **Amended 2026-09-24, before merge — a security review of the branch.** FR-3301, FR-3305,
> FR-3306, FR-3307, FR-3309, FR-3311 and FR-3312 each gained a sentence, marked *[review]*; no
> requirement was withdrawn or weakened. The review's findings and what was done about each are in
> ADR-0022 (*Amended*, *Accepted risks*, *Open decision for Samuel*).

- **FR-3301**: When the access control in front of the console has proven the visitor's email
  address, the console MUST sign the visitor in as the operator with that address — without a
  password and without a form. *[review]* Such a sign-in MUST be started only by the visitor's own
  top-level navigation, never by a resource another page embeds (an image, a frame, a prefetch).
- **FR-3302**: The proof MUST be the access control's **signed** statement, verified before it is
  believed: the signature against the control's own published keys, the issuer, the application the
  statement was issued for, and its period of validity. An unsigned statement of the address — a
  plain header anyone reaching the origin could set — MUST NOT be trusted, alone or as a fallback.
- **FR-3303**: A proven address with no operator account, or with a disabled one, MUST be refused
  with a page that says so plainly — that this identity has no console account — and MUST NOT start
  a session. The refusal MUST be recorded, naming the proven address.
- **FR-3304**: A sign-in by proof MUST start the same kind of session a password sign-in starts —
  the same lifetime, renewal and revocation — and MUST be recorded as an operator sign-in with the
  roles in effect (FR-2207) **and the method that proved the person**. No part of the proof itself
  MAY be recorded.
- **FR-3305**: **The proven person wins.** If the browser already holds a console session for a
  different operator, that session MUST be ended, and recorded as ended, before the proven person is
  signed in. A console session MUST NOT be honoured while a verified proof names somebody else.
  *[review]* The check made on every console request MUST be bounded in time; a check that cannot
  finish within its bound counts as no proof (FR-3306) — it neither ends the session nor signs
  anybody in.
- **FR-3306**: It MUST fail closed. A missing proof, one that does not verify, one that has expired,
  one issued for another application, keys that cannot be fetched, or a configuration that is
  incomplete MUST NOT sign anybody in; where a sign-in was attempted the refusal MUST be recorded,
  and the visitor MUST be offered FR-3308's fallback. An unverifiable proof MUST NOT end an
  existing session — only a verified proof of somebody else does (FR-3305). *[review]* The record
  of refused, unverifiable proofs MUST be bounded — per client address and in total, per window —
  so that requests which never passed the access control cannot flood it; exceeding the bound MUST
  itself be recorded once, and MUST NOT change the answer the visitor gets.
- **FR-3307**: Signing out of the console MUST end the console session **and** the access control's
  own session, so that the next request does not silently sign the same person back in.
  *[review]* The access control's session MUST end for the console's own hostname at once, not after
  a propagation delay during which a request could still carry the old proof.
- **FR-3308**: Password sign-in MUST remain available as a fallback for when the proof cannot be
  used. It MUST NOT be presented as the primary path while a verified proof is present. *(Samuel may
  withdraw the fallback later; that is a separate decision.)*
- **FR-3309**: For local development only, the console MAY offer a list of operators to sign in as
  without a credential, and only when **all three** hold: the build is not a production build, an
  explicit local-only switch is on, and the request is to the local machine. The server MUST enforce
  all three, not only the page; a production build MUST NOT contain the capability at all, and this
  MUST be checked against the build itself. Every such sign-in MUST be recorded as one. *[review]*
  "To the local machine" MUST rest on the development server accepting connections only from the
  local machine whenever the switch is on; request headers, which a client writes, MUST NOT be
  taken as proof of it on their own, and a request that declines to name its origin MUST be
  refused.
- **FR-3310**: The student surface MUST NOT read, act on, or offer a route for the access control's
  identity in any form, signed or unsigned.
- **FR-3311**: Which access-control team and which application the console trusts MUST be
  configuration, not code, and MUST NOT be treated as secrets. Absent configuration MUST mean the
  feature is off, and switching it off MUST need no code change. *[review]* A malformed value MUST
  fail the deployment loudly rather than silently switching the feature off.
- **FR-3312**: The proven address MUST be matched to an operator exactly, ignoring only letter case —
  no domain-wide rule, no prefix, no automatic creation of an operator. *[review]* The address MUST
  be plain ASCII — a proven address outside ASCII MUST be treated as unverified — and every part of
  the console that compares addresses MUST use one rule, so that no two of them can disagree about
  whom an address belongs to.

### Interaction timeline & replay (FR-2301…)

- **FR-2301**: Every recorded interaction MUST belong to exactly one learning session, and a learning
  session MUST exist as a durable record of its own. **Today none does** — nothing creates one, and
  the identifier the product passes around is a temporary string the browser made up. This is new
  work, not a join that was overlooked (ADR-0015).
- **FR-2302**: A learning session MUST open when a student begins learning and close on completion,
  or after a stated period of inactivity. One closed by inactivity MUST be distinguishable from one
  the student finished, and the inactivity period MUST be documented rather than discovered.
- **FR-2303**: An operator MUST be able to see one ordered timeline per student per session, merging
  tutor turns, answers and attempts, understanding checks, uploads, widget outcomes and mastery
  movements in a single time order.
- **FR-2304**: An operator MUST be able to replay a session as the student experienced it, rendered
  from what the student saw. It MUST be labelled a **reconstruction** wherever it appears and MUST
  NOT be presented as a recording of the screen.
- **FR-2305**: A replay MUST be read-only: opening or moving through one MUST NOT write an attempt,
  move a mastery estimate, emit an event attributed to the student, or change anything else in the
  student's record.
- **FR-2306**: Every operator read of a student's record MUST be recorded — which operator, which
  student, when, and what was opened. That record MUST NOT be editable or removable by the operator
  who caused it, and MUST survive deletion of the student's account.
- **FR-2307**: The interaction record MUST be retained at full fidelity rather than trimmed to a
  minimum (D7). A retention decision — what is kept, for how long, what is purged — is **owed** and
  MUST be made before this data is opened to any audience wider than the invited pilot and the
  current operator roster.
- **FR-2308**: No disclosure screen about the AI tutor is added at signup this release (D7, Samuel's
  decision, his responsibility). The exception is bounded: it reverts to requiring disclosure when he
  sets the disclosure text, or before any audience wider than the invited pilot, whichever comes
  first. The product MUST NOT add consent or disclosure copy in the meantime.
- **FR-2309**: An interaction that cannot be attributed to a session MUST be recorded as belonging to
  no session and be visible as such. It MUST NOT be attached to the nearest session.
- **FR-2310**: Deleting a student's account MUST remove the account and its interaction record
  together and leave no transcript reachable without an owner. An operator viewing a deleted student
  MUST be told the record is gone rather than shown a partial one. *(Working default pending
  FR-2307's retention decision — see Open Decisions.)*

### Cost & per-student status (FR-2401…)

- **FR-2401**: The console MUST show what each student has cost, over time and not only as a single
  window total. Every student with at least one interaction MUST have a cost figure.
- **FR-2402**: AI spend and upload/OCR spend MUST be metered and reported separately, never blended
  into one number (constitution VI).
- **FR-2403**: The console MUST show overall cost for a period alongside the per-student figures, and
  the per-student figures MUST reconcile with that total.
- **FR-2404**: Each student MUST carry a subscription and payment status an operator can read. There
  is **no payment system behind it** this release: it MUST NOT gate access, MUST NOT be shown to a
  student as a plan, and MUST NOT be described anywhere as a payment having happened.
- **FR-2405**: Changing a student's subscription or payment status MUST require the `cost-billing`
  role, and every change MUST be recorded with who changed it and when.
- **FR-2406**: `cost-billing` MUST NOT grant access to any student's content — not a transcript, an
  upload, a message preview, or a turn count of a conversation.
- **FR-2407**: Cost figures MUST identify which environment produced them and MUST NOT be pooled
  across environments or solutions (FR-2109, constitution XI).

### Monitoring & analytics (FR-2501…)

- **FR-2501**: Every security and sign-in event this feature names MUST actually be emitted, and each
  MUST have a test asserting it fires. Defining an event without emitting it does not satisfy this.
  The named set is: sign-in succeeded, sign-in failed, account locked, lockout cleared, password
  changed, password reset requested, email confirmation sent, email confirmation completed, sign-in
  session revoked, permission denied, cross-student access denied, operator sign-in, operator read of
  a student record.
- **FR-2502**: The console MUST have a security view showing sign-in attempts over time, failures,
  lockouts and denials, with an attempt visible there within one minute of happening (SC-105).
- **FR-2503**: The first-party event stream remains the record of what the product did (001 FR-801,
  FR-901). Every event MUST carry its environment, and no reported metric may come from anywhere
  else.
- **FR-2504**: Anonymous product analytics MAY be used in addition to the first-party stream (D8). It
  MUST carry no student identifier, no message or lesson content, no email, no name and no gender —
  event names and coarse properties only.
- **FR-2505**: The product MUST NOT degrade when the anonymous analytics is blocked, fails to load or
  is removed. No lesson, lesson step, upload, dashboard or console view may depend on it.
- **FR-2506**: No datum collected about a minor under constitution VII — name, grade, gender,
  interests, contact — MUST be sent to a third-party analytics tool in any form, including derived or
  hashed.
- **FR-2507**: The console MUST offer overviews per student, per subject and per school year, so a
  founder can ask how a cohort is doing without an engineer writing a query.
- **FR-2508**: A safety flag MUST continue to reach a human channel immediately, on a path separate
  from routine analytics, carrying no detail beyond the flag type (001 FR-602, FR-802). Nothing in
  the console's new visibility changes that.
- **FR-2509**: Every record and event this feature creates MUST carry its environment (constitution
  XI) — the account, session, security-event, operator-read and cost records included.

### Tutor voice & gender (FR-2601…)

- **FR-2601**: The product MUST capture the student's gender at signup and MUST state at the point of
  capture what it is for: so the tutor addresses them correctly.
- **FR-2602**: The tutor MUST address the student in the correct grammatical form for their gender on
  every surface that addresses them — lesson, chat, check-in, and any copy that speaks to the student
  — in both English and Arabic. **Today it does not**: the tutor's instructions assume every student
  is male, in 63 places in the lesson prompt (plus one `himself`), 21 in the ask prompt and 11 in the
  check-in prompt, including a masculine Arabic vocative offered to the model as the pattern to
  follow. That is a defect, not a design choice.
- **FR-2603**: Gender MUST NOT affect what content is selected, how difficult it is, how mastery is
  estimated, or any other teaching decision. It governs address and voice only.
- **FR-2604**: Gender MUST NOT be sent to any third-party analytics tool (FR-2506) and MUST NOT
  appear in any event property, log line or error message.
- **FR-2605**: Where a student's gender is not known — a picker-era student, or one who has not set
  it — the tutor MUST use a form of address correct for either, and MUST NOT fall back to the
  masculine form.
- **FR-2606**: A change to a student's gender MUST take effect in the tutor's next turn, without
  signing out or starting a new session.

### Course availability (FR-2701…) **[ADDED 2026-09-22 — ADR-0018]**

> **These eleven were written after their code, and the record has to say so.** The capability
> shipped on 2026-09-21 in `c58cb02` and `c510cf7`; both commits state plainly that no FR covered
> it and that inventing one unasked would be the laundering `CLAUDE.md` warns about. **Samuel
> asked for the requirements to be written on 2026-09-22**, which is the authorisation, and this
> is the date they were written. Nothing here is back-dated and nothing here preceded the code it
> describes. The decision itself is [ADR-0018](../../docs/decisions/0018-course-availability.md),
> accepted 2026-09-21.
>
> Why they belong in this spec: the decision is made in the admin console, by an operator holding a
> role this feature defines, and the student-side gate is enforced by the same "fail closed" rule
> FR-2101 establishes for student data. Implementation status is in `traceability.md` here, §11.

- **FR-2701**: The console MUST list every course the product recognises, whether or not any
  content has been loaded for it, and MUST state each course's real depth beside it — how many
  objectives and how many questions — so an empty course cannot be mistaken for a stocked one.
- **FR-2702**: An operator MUST be able to decide, per course and per school year, whether students
  of that year may see that course.
- **FR-2703**: An operator MUST be able to set an exception for one named student on one course.
  The exception MUST win over the year's rule **in both directions**: it can show a course the year
  cannot see, and hide one the year can.
- **FR-2704**: A course MUST be visible to a student **only** when a rule says it is live for them.
  The absence of any rule MUST mean hidden. No default, no inference from whether content has been
  loaded, and no course reaching a student because a pipeline put a book in the database.
- **FR-2705**: The refusal MUST be enforced where the data is read, not by what the interface
  chooses to render. Every read that can return a course's material MUST apply it — the lesson
  catalogue, the subject summaries, the lesson data itself, the curriculum graph explorer, the
  practice plan and the data block handed to the tutor. Filtering a list MUST NOT be relied on or
  described as the gate.
- **FR-2706**: A direct request for a hidden course — a pasted address, an edited identifier, a
  practice mode — MUST answer exactly as a request for a course that does not exist. The answer MUST
  NOT allow a reader to tell a course that is switched off from one that was never there.
- **FR-2707**: Deciding a year's rule and deciding one student's access MUST require **different
  roles**: the year's rule belongs to `content-review`, because it is a decision about a subject;
  one student's access belongs to `student-data`, because it names a person. The content role MUST
  NOT learn a student's name through this feature (FR-2203, FR-2406).
- **FR-2708**: Every change to a rule or an exception MUST record which operator made it and when,
  and MUST let that operator say in their own words why, so the reason is readable months later by
  somebody who was not there.
- **FR-2709**: The whole gate MUST be suspendable by a single documented switch that leaves every
  configured rule in place, so turning it back on is one change rather than a re-entry of every
  decision. When that switch is absent the gate MUST NOT be in force: for a tutoring product the
  safe failure is too much visible, never a student locked out of her own course by a variable
  nobody set. Both defaults — a missing rule meaning hidden, a missing switch meaning ungated —
  MUST be documented where they are implemented, because the asymmetry is deliberate and reads as a
  bug when it is not written down.
- **FR-2710**: Where the console asks an operator to confirm a consequential change, the question
  MUST be part of the page. A confirmation the surrounding browser can suppress MUST NOT be relied
  on: a suppressed dialogue answers "no" silently, and the control then fails without saying why.
- **FR-2711**: Whether a student may see a course MUST NOT depend on any commercial status. The
  subscription seam this feature leaves in the data model MUST stay unread by every gate, console
  view and student surface (FR-2404, FR-2904).

### In-product feedback (FR-2801…) **[ADDED 2026-09-22]**

> **These eleven were written with their code, on the day Samuel asked for the capability, and the
> record has to say so.** No FR covered "ask the student how we did" before 2026-09-22; **Samuel
> asking for it on 2026-09-22 is the authorisation**, and these were written in the same pass as
> `db/migrations/025-feedback.sql`. Nothing here is back-dated, and nothing here preceded the code
> it describes. The pattern is FR-2701…FR-2711's — see that block's own note — with one difference
> worth stating: those eleven were written two days *after* their code shipped, and these were
> written beside it.
>
> Why they belong in this spec rather than in 001: the operator half is two console views defined by
> this feature, behind a role this feature defines, and the student half is written by a surface
> that exists because this feature's identity layer does. 001's FR-905 is **deliberately BLOCKED**
> and is Samuel's to resolve; nothing here touches it.
>
> Implementation status is in `traceability.md` here, §7c.

- **FR-2801**: The product MUST ask a student, in their own words and not a survey's, how the
  product is doing — offered at the end of a lesson, at the end of a practice plan, and after a
  long sitting. Those three moments MAY be one mechanism, and the record MUST say which of the
  three asked, so "did the long sittings feel worse?" is answerable.
- **FR-2802**: What a student writes about the product MUST NOT reach a model. It MUST NOT appear
  in any prompt, in any cached prompt prefix, in any snapshot, or in the data block handed to the
  tutor. It is the student's opinion of us, not learning material, and the guarantee MUST be
  enforced by a test rather than by a convention.
- **FR-2803**: The prompt MUST NOT block. No modal, no overlay, no "answer this to continue". The
  flow MUST behave identically whether it is answered, dismissed or ignored, and the prompt MUST
  appear only where the student has already finished what she was doing.
- **FR-2804**: A single rating MUST be a complete answer. A written note MUST be optional, offered
  only after a rating, and MUST NOT be demanded, implied to be required, or required in order to
  dismiss the prompt.
- **FR-2805**: A student who dismisses the prompt MUST be remembered — server-side, against the
  student, not in browser storage — and MUST be left alone for the same period as one who answered.
  A dismissal MUST NOT overwrite an answer already given.
- **FR-2806**: How often a student is asked MUST be a written rule with stated numbers, not an
  emergent behaviour: at most once per stated period, never twice about the same sitting, and not
  at all before the student has enough experience of the product to be judging it rather than one
  lesson. The rule MUST be implemented as a tested function and MUST be readable by an operator
  without reading code.
- **FR-2807**: The written note MUST have a stated maximum length. Text beyond it MUST be refused
  with the limit named, never silently shortened — a note cut mid-sentence would be stored as
  something the student did not write.
- **FR-2808**: An operator MUST be able to see the whole picture in one place: ratings and their
  ratio over time, split by which moment asked and by subject, and the written notes themselves,
  newest first, each one naming the student and linking to the sitting it followed. **The notes
  MUST be what the view opens on**, not something reached through a filter.
- **FR-2809**: An operator MUST be able to see one student's own feedback, in time order, on that
  student's record.
- **FR-2810**: A student's own words MUST NOT be editable or removable by an operator. Removing one
  MUST require a deliberate act outside the console.
- **FR-2811**: A written note MUST NOT be classified automatically. No keyword scan, no sentiment
  score and no safety flag may be derived from it. The product MUST instead make every note visible
  to a human by default, and MUST state plainly, on the surface where they are read, that nothing
  has read them first and that nothing will raise an alarm.

### Runtime health — can the tutor teach? (FR-3001…) **[ADDED 2026-09-22]**

> **These ten were written with their code, on the day the lapse was found.** No requirement
> covered "the product must be able to tell an operator that the tutor cannot teach" before
> 2026-09-22; **Samuel asking for it — "add the console check for lapsed sign-in" — is the
> authorisation**, and these were written in the same pass as `db/migrations/026-runtime-health.sql`,
> the probe and the console tile. Nothing here is back-dated, and nothing here preceded the code it
> describes. The pattern is FR-2801…FR-2811's rather than FR-2701…FR-2711's.
>
> **What happened.** The tutor runs on Samuel's Claude **subscription** through the bundled `claude`
> CLI. On the live box that sign-in silently expired, and it was found only because somebody ran the
> CLI by hand — after the container had been up **seven weeks**. For some unknown part of that, the
> product signed a student in, showed her lessons and her progress, and failed **every single tutor
> turn**. Sign-in, the console, lesson browsing, mastery from stored attempts, analytics and the cost
> ledger all kept working, which is exactly what made it invisible.
>
> Why they belong in this spec rather than in 001: the surface is the admin console this feature
> defines, behind a role this feature defines, and the obligation is the same one FR-2501…FR-2509
> already carry — the founders must be able to see that something is wrong without being told by a
> customer. 001's FR-905 is **deliberately BLOCKED** and is Samuel's to resolve; nothing here
> touches it.
>
> Implementation status is in `traceability.md` here, §7d.

- **FR-3001**: The product MUST check, on a schedule and without waiting for a student, that the
  tutor can actually answer. The check MUST run even when nobody is using the product, because the
  failure it exists to catch is invisible to every other signal and a quiet night is exactly when
  it is most likely to go unnoticed.
- **FR-3002**: The check MUST exercise **the same path the product teaches through**, including the
  way the product proves who it is. A check that reached the tutor differently would report on
  something no student ever uses, and a green result from it would be worse than no result at all.
- **FR-3003**: A failure MUST be recorded as a short, fixed word that distinguishes **at least**:
  the tutor program being absent, the sign-in having lapsed, the call itself failing for a passing
  reason, and no answer arriving in time. These MUST NOT be collapsed into one "it is broken",
  because each one is a different person's job and a single word would send the wrong one.
- **FR-3004**: What the tutor program says about its own failure MUST NOT be stored or written to a
  record anybody can read. It can contain a file path, a machine's layout or part of a credential.
  Only the short word above may be kept.
- **FR-3005**: The check MUST NOT be able to hang. It MUST give up after a stated time, and giving
  up MUST be recorded as a failure with its own word rather than as a check that did not happen.
- **FR-3006**: A tutor turn that failed MUST leave a record **even when it failed before costing
  anything**. A lapsed sign-in fails instantly and for free, so a record kept only when money was
  spent is blind to precisely the fault this block exists for. The cost of such a turn MUST be
  reported as *not known* rather than as zero.
- **FR-3007**: The console MUST state, in one place, three things and MUST NOT collapse them:
  **(a)** the last check's verdict **together with how old it is** — a check that has not run
  recently MUST read as *unknown*, MUST NOT read as healthy, and MUST look different from both a
  pass and a failure; **(b)** what real tutor turns have actually been doing, so a live failure
  shows even when the check has not run; **(c)** in plain words, **what still works** while the
  tutor cannot teach — because "the tutor is down" reads as "everything is down" and would cause
  the wrong response.
- **FR-3008**: Where the tutor cannot teach because the sign-in has lapsed, the console MUST say
  plainly that only Samuel can restore it and MUST name the procedure. Where the cause is anything
  else, it MUST NOT say that — a remedy that does not match the diagnosis costs an evening and
  teaches the reader to distrust the next one.
- **FR-3009**: A tutor that cannot teach MUST raise an alarm by the same means the other alerts use,
  and MUST NOT raise one on a single failed check. The number of consecutive failures required MUST
  be a stated, justified figure rather than an emergent one.
- **FR-3010**: Reading the health of the tutor MUST NOT itself call the tutor. Opening the console
  MUST never spend money or wait on the tutor program, because the page is opened precisely when
  something is already wrong.

### Teaching controls and testers (FR-3101…) **[ADDED 2026-09-24 — ADR-0021]**

> **Written with their code, on the day Samuel approved the feature.** v0.6.0 brought Tamer's
> Socratic-probing prototype onto `main` switched off behind a compile-time constant, and the
> Socratic teaching protocol has been named in `CLAUDE.md` as shipped with no requirement. **Samuel
> approving the runtime toggle on 2026-09-24 is the authorisation for these eleven** — they state the
> switch, who may move it, who it reaches and what it must leave untouched. They do not retro-cover
> the rest of the Socratic protocol (001 §9 still names that), and nothing here is back-dated.
>
> **What probing is, in one sentence**: when a student answers a maths question wrongly in a lesson,
> the tutor asks a guiding question first instead of the card showing the worked solution
> straight away. Issue #53 lists what it still gets wrong, and is why "everyone" is locked.
>
> **When a change reaches a student** (Samuel, 2026-09-24, option B): Off applies to the student's
> next message; On applies from their next sitting. FR-3105 states it.
>
> Implementation status is in `traceability.md` here, §7e.

- **FR-3101**: The console MUST offer a switch for Socratic probing with exactly three positions —
  **Off**, **Test accounts only**, **Everyone** — and MUST treat the absence of any recorded choice
  as **Off**, so a new environment changes nothing until somebody decides.
- **FR-3102**: Moving the switch MUST require a dedicated operator role, **separate from content
  review**, so who may change how a child is taught can be narrowed on its own. Every **active**
  operator who held **content review** — the role it is split from — when the role was introduced
  MUST receive it once, and nobody else. A later deploy MUST NOT give it back to an operator it was
  removed from, and neither may withdrawing the role and deploying again. *(Amended 2026-09-24,
  fix pass: was "every operator who held a role".)*
- **FR-3103**: **Everyone** MUST be unavailable until the known probing defects are fixed (#53): the
  console MUST show it disabled with the reason beside it, the server MUST refuse it whoever asks,
  and a stored **Everyone** MUST act as **Test accounts only** while it is locked. Unlocking it MUST
  be one deliberate change, not a migration.
- **FR-3104**: Probing MUST apply only to **maths lessons in learn mode**. Social Studies, Arabic,
  review mode, practice and open chat MUST never probe, whatever the switch says, because none of
  its wording exists for them.
- **FR-3105**: Whether a sitting may probe MUST be decided **by the server when the sitting
  starts**, and recorded with it; that record MUST never be rewritten. Each request in the sitting
  MUST then probe only if the sitting started with probing on **and** the switch and the student's
  test-account mark, as they stand at that request, still allow it **and neither has changed since
  the sitting started**. So switching **Off** — or removing a student's mark — MUST apply to the
  student's **next message**, even mid-lesson; and switching **On** MUST apply only from the
  student's **next sitting**: a sitting that started with probing off MUST never start probing, and
  a sitting that has stopped probing MUST never start again — switching Off and back On, or
  removing the mark and adding it back, leaves it off until the student's next sitting. *(Amended
  2026-09-24, Samuel's option B: was "decided once when the lesson starts; a change reaches only
  lessons that start afterwards". Amended again 2026-09-24, fix pass 2: "and neither has changed
  since the sitting started" added, because the rule as first written let Off-then-On resume a
  sitting mid-lesson — On applying before the next sitting.)*
- **FR-3106**: Everything that behaves differently under probing — the tutor's instructions, whether
  a question card reveals the worked solution, and how the answer is recorded — MUST follow the
  server's answer for that request (FR-3105) and **never anything the student's device sends**. When
  that answer turns to Off mid-sitting, a card holding back its answer and worked solution MUST show
  them, and the next wrong answer MUST be handled exactly as with probing Off — **including when the
  student's message is refused by the lesson's turn limit**. A response that is not about the lesson —
  an answer recorded outside the lesson's sitting — MUST NOT change what the student's device holds.
  *(Amended 2026-09-24, fix pass 2: the turn-limit case and the "not about the lesson" case added.)*
- **FR-3107**: An operator holding **both** the student-data role and the teaching-controls role
  MUST be able to mark a student account as a **test account**, and remove the mark in one action,
  from that student's page; **neither role alone may**, and the page MUST say beside the control that
  only accounts the team owns may be marked, never a real student. *(Amended 2026-09-24, fix pass:
  was student-data alone; every operator held every role that day, so nobody lost access.)* Who marked it, who removed it and when MUST be
  recorded and kept after removal, and a removed mark MUST stay removed — marking the student again
  is a new mark, never the old one reopened or rewritten. A removal MUST NOT accept a note it cannot
  keep: a note sent with a removal MUST be refused, never silently dropped. *(Added 2026-09-24, fix
  pass 2.)* **No student surface may be able to set or remove the mark**, for the student or anyone
  else.
- **FR-3108**: With probing **Off**, the tutor's instructions MUST be **byte-identical** to what
  they were before the switch existed — proved against a golden capture of every learn and review
  prompt and against a full capture of 438 model inputs — and the question card and the record of
  every answer MUST take the pre-switch code paths, selected by the same server-declared boolean.
  Only that is claimed identical: the tutor's stream gains a first frame declaring probing, and each
  session row gains the release and the probing record. *(Reworded 2026-09-24, fix pass: was "exactly
  what they got before … word for word", which overreached.)*
- **FR-3109**: Every lesson MUST record **which release served it** and **whether probing applied**,
  and the server MUST log both when the lesson starts. The release MUST come from the build actually
  deployed, not from a version number that two builds share.
- **FR-3110**: The console MUST show, on every page, the **deployed release** and the **current
  probing position** — and, when the position cannot be read, MUST say it is **unknown** rather than
  fail the page. It MUST show who last changed the position and when, to any operator holding at
  least one role. Every change MUST be recorded — from, to, who, when — and listed, and nothing in
  the console may edit or remove that record; the note kept with a change MUST be marked as not
  the place to name a student, because every role reads it.
- **FR-3111**: A student's session list, timeline and replay MUST show, for each sitting, the
  release that served it and whether probing was on when it **started** — and MUST say that probing
  applies to maths learn-mode turns only and that a sitting which started with it on stops probing
  once the switch is changed or the student's mark is removed, and does not start again in that
  sitting (FR-3105). They MUST say "not recorded" for sittings from before it was recorded, rather
  than guessing. *(Amended 2026-09-24, fix pass 2: was "follows the switch from then".)*

### Shipped in v0.6.0 without a requirement — now written (FR-3201…) **[ADDED 2026-09-24]**

> **Written after the code, and saying so.** v0.6.0 (2026-09-23) brought Tamer's work onto `main`
> together with the day's fixes, and several of the things it shipped had no requirement at all —
> 001's matrix names two of them (§9 items 16 and 17) and asks for them to be written or recorded as
> ADR-only, and **not** filed under an existing FR. **Samuel asked for them to be written on
> 2026-09-24**, from the approved decision and the code as it actually behaves; that is the
> authorisation. They are two days younger than the code, and the matrix rows (§7f) say which
> evidence came from a signed-in run of the v0.6.0 build that morning, which from unit tests, and
> which from the deploy log.
>
> Placed here rather than in 001 because 001 is the shipped v0.4.0 delta and its FR blocks are
> closed; the surfaces are the same product.

**Lesson progression ([ADR-0020](../../docs/decisions/0020-mastery-gated-lesson-progression.md))**

- **FR-3201**: Each student MUST have their own saved place in each course, separate per course, and
  no student's place may be read or changed by any other student's request.
- **FR-3202**: A student's place MUST move on when **every** objective in the lesson they are on
  reaches the mastery gate, to the next lesson in course order whose prerequisites that student has
  met — never onto a lesson whose prerequisites are not met; unready lessons are skipped. *(Reworded
  2026-09-24, fix pass: "never past a lesson they are not ready for" said the opposite of what the
  code does.)*
- **FR-3203**: A student's place MUST never move backwards. When nothing later is ready yet it MUST
  stay where it is, and the course MUST read as complete only when the student is on its last lesson
  and every lesson has passed the gate.
- **FR-3204**: A saved place that no longer names a lesson the student can see MUST read as the
  course's first lesson, and advance from there by the same rule.
- **FR-3205**: No student's place may be guessed from history: everyone MUST start on a course's
  first lesson and advance only by the rule above.
- **FR-3206**: An explicit link to a lesson MUST win over the saved place, and the saved place MUST
  never open a course the student is not allowed to see.
- **FR-3207**: Maths lessons MUST run in the school's order — Term 1 before Term 2.

**The `/spine` skill map ("How you're doing", `b9df1e1`)**

- **FR-3208**: Each topic on the skill map MUST show a plain band word and a fill, and MUST NOT show
  a student a percentage or an internal identifier.
- **FR-3209**: Noor MUST sit in a panel beside the map. Below 1024px wide (iPad portrait) the topic
  panel MUST dock full width under the map and Noor MUST collapse to a bar.
- **FR-3210**: The map MUST work without a pointer: a topic opens from the keyboard with focus on its
  heading, Escape closes it and returns focus to the topic, and a panel that has been dragged MUST be
  returnable to its place by a control, not only by dragging.

**The rest of v0.6.0**

- **FR-3211**: No student surface may say whether content was reviewed. Review status is an operator
  fact, shown in the console only ([ADR-0019](../../docs/decisions/0019-serve-the-whole-maths-bank.md));
  what a student may be told is where a question came from.
- **FR-3212**: The console's Content page MUST say which subject it is counting: an operator MUST be
  able to narrow it to one subject, the questions held back MUST be counted on the page, and every
  count MUST be computed from the rows shown, so a figure cannot disagree with its own table.
- **FR-3213**: Every database migration MUST be re-runnable on every deploy without failing, MUST
  NOT re-apply a narrower definition over a wider one, and MUST NOT take a lock that blocks students
  when it has nothing to change.
- **FR-3214**: The misconception catalogue MUST re-sync on every deploy without duplicating anything
  or changing a question's status, and every live misconception MUST have an explanation.

### Turn limits observed, not enforced (FR-3401…) **[ADDED 2026-09-24 — ADR-0023]**

> Samuel, 2026-09-24, verbatim: *"remove the limits, make them highlight in the admin console, we
> need to know how often those limits are triggered."* Until this decision `api/ask/route.ts`
> refused a student's turn once a conversation reached a per-surface cap (`student_chat` 2,
> `lesson_learn` 18, `lesson_review` 5, `spine_chat` uncapped) and locked the input. That refusal is
> gone. The three numbers are not gone — they move to a named constant and become **observed
> thresholds**: crossing one changes nothing for the student and is counted and shown to an operator.
> [ADR-0023](../../docs/decisions/0023-turn-limits-observed-not-enforced.md) is the record; these six
> requirements are what the code is held to. They supersede 001's `FR-051`.

- **FR-3401**: No surface MUST refuse a student's turn because of how many replies the conversation
  has had. A student MUST never see a limit message or a locked input on account of a reply count.
- **FR-3402**: Each surface's threshold — `student_chat` 2, `lesson_learn` 18, `lesson_review` 5,
  `spine_chat` none — MUST be one named constant, read by the console and by the review-mode finish
  nudge, so the number is defined once and the nudge and the console can never disagree about it.
- **FR-3403**: The Cost page MUST show, for the chosen period and per surface: how many conversations
  there were, how many **reached** their threshold (count and share), how many **went past** it, and
  the highest reply count seen — and MUST be visually highlighted whenever any conversation in the
  period reached a threshold.
- **FR-3404**: The Cost page MUST list the most recent conversations that reached a threshold, each
  linked to its session wherever one is recorded.
- **FR-3405**: The session list, the session timeline and replay MUST each mark a session whose
  conversation reached its threshold, in the product's attention treatment — amber, never red
  (FR-1002).
- **FR-3406**: A threshold crossing MUST be counted per environment, using the same conversation key
  and the same "delivered reply" definition the old cap used — surface, chat session and student;
  `outcome = 'ok'` in `ai_interactions` — and MUST NOT be pooled across environments or solutions
  (constitution XI).

### Deferred by design — architecture only (FR-2901…)

> Designed for, not built. None may be implemented this release; the point of stating them is that
> the account, session and data model must not make them expensive later.

- **FR-2901** **[DEFERRED — D1]**: A student account MUST be linkable to one parent. The link MUST
  exist in the data model this release; capturing a parent contact and building the link flow do not.
  One student per account stands: **multi-child parent accounts remain a non-goal** (constitution
  VIII), and a parent is a linked view rather than an account holder (constitution VII).
- **FR-2902** **[DEFERRED — D1]**: The parent view is not built. When it is, it MUST show performance
  data only and MUST NOT show lesson or chat transcripts (001 FR-501, FR-603). The picker-based
  parent access 001 described is withdrawn with the picker itself.
- **FR-2903** **[DEFERRED — D9]**: Sign-in with a phone number and a one-time code MUST fit the same
  session model as email-and-password and Google sign-in, so adding it later needs no change to how a
  sign-in is recorded, listed or revoked.
- **FR-2904** **[DEFERRED — D5]**: Payment is not built; only FR-2404's status record ships. Later
  payment work MUST attach to that status rather than introduce a second commercial state, and 001's
  deferred billing requirements (FR-701…FR-707) remain deferred.

### Key Entities

Plain language; no field names. `data-model.md` owns the mapping.

- **Account** *(new)*: how one student proves they are themselves — email address, an irreversible
  form of a password or a linked Google identity, whether the email is confirmed, whether it is
  locked. Replaces the picker's browser cookie entirely.
- **Student (learning record)** *(expanded)*: who the student is to the tutor — display name, grade,
  gender, language preference, curriculum system, interests — plus everything their learning
  produces. Exactly one Account, and a link slot for one Guardian that nothing fills.
- **Operator & Role** *(new)*: a named person who may reach the console and the roles they hold,
  granted one at a time and each separately revocable. An Operator is never a Student.
- **Session (learning session)** *(new)*: one stretch of learning by one student — when it opened,
  how it closed, everything recorded inside it. **Nothing populates one today**; creating this record
  is part of this feature's work (ADR-0015).
- **Interaction record** *(expanded)*: one thing that happened in a session — a tutor turn, answer,
  understanding check, upload, widget outcome or mastery movement — with its time, student, session,
  cost where it has one, and the environment that produced it.
- **Operator-read record** *(new)*: one operator looking at one student's record — who, whose, when,
  what was opened. Written by the product, never by the operator, not removable by them.
- **Sign-in event** *(new)*: one attempt to sign in, or one security-relevant outcome — succeeded,
  failed, locked, revoked, denied — with time, account where known, and enough context for a security
  view to be useful. Carries no password material.
- **Cost record** *(expanded)*: what a student's activity cost, AI spend split from upload/OCR spend,
  attributable to a student, a session and a period, tagged by environment.
- **Guardian link** *(new, deferred)*: one parent connected to one student, read-only, performance
  data only. Modelled this release; nothing creates one.
- **Course availability rule** *(new, added 2026-09-22 — ADR-0018)*: one decision about one course
  for one school year — live or hidden — with the operator who set it, when, and why in their own
  words. Its absence is a decision too: no rule means hidden.
- **Student course exception** *(new, added 2026-09-22 — ADR-0018)*: one decision about one course
  for one named student, outranking the year's rule in both directions. A live permission rather
  than a record of anything the student did, so clearing it removes it.
- **Teaching switch** *(new, added 2026-09-24 — ADR-0021)*: one position per environment for
  Socratic probing — off, test accounts only, everyone — with who last moved it and when, and every
  earlier position kept as a change from one to the next. No record means off.
- **Test-account mark** *(new, added 2026-09-24 — ADR-0021)*: one operator's statement that one
  student account is a test account, with who made it, when and why; removing it stamps who removed
  it rather than erasing it.
- **Lesson snapshot** *(new, added 2026-09-24 — ADR-0021)*: two facts fixed on a learning session
  when it opens — the release that served it and whether probing applied — never changed afterwards.

## Success Criteria *(mandatory)*

### Identity and isolation

- **SC-101**: A new student goes from arriving to their first streamed tutor message in under
  **5 minutes**, including email confirmation, with no operator intervention.
- **SC-102**: **100%** of student-scoped reads are covered by an automated check that fails when a
  read carries no student scope. It runs in continuous integration and blocks a merge.
- **SC-103**: **Zero** rows belonging to another student are reachable from any student surface in a
  red-team pass that tries every student-facing route with a second student's identifiers.
- **SC-104**: A cross-student read is indistinguishable from a request for a record that does not
  exist, in **100%** of sampled attempts across every student-facing route.

### The console

- **SC-105**: Every sign-in attempt, successful or failed, is visible in the console's security view
  within **60 seconds**.
- **SC-106**: Every event named in FR-2501 has a passing test asserting it was emitted — **13 of 13**,
  with none defined and unemitted.
- **SC-107**: A student's full session is reconstructable end to end for **100%** of sessions started
  after the cutover, with every interaction in the session attributable to it.
- **SC-108**: **100%** of operator reads of a student's record have a matching read record, verified
  by sampling at least 20 reads.
- **SC-109**: Cost to date is available for **every** student with at least one interaction, and
  per-student cost reconciles with the period total to within rounding.
- **SC-110**: An operator holding one role reaches exactly the surfaces that role permits and is
  refused everywhere else — **100%** of role/surface combinations tested, refusals included.

### The product, and the founders' ability to run it

- **SC-111**: Both surfaces run locally from a clean checkout after **one** documented command, in
  under **10 minutes** on a developer machine.
- **SC-112**: The tutor uses the correct form of address in **100%** of sampled turns for each
  gender, over at least 20 turns per gender across lesson, chat and check-in.
- **SC-113**: **Zero** student identifiers, message content or personal data appear in the anonymous
  analytics stream, verified by inspecting every event type it sends.
- **SC-114**: A full student journey — signup, lesson, question, upload, practice attempt, dashboard
  — completes unchanged with the anonymous analytics blocked at the browser.

## Governance Impact

**Constitution v3.1.1** is the engineering authority for this spec. Two principles bear directly:

- **Principle XII (Design System Authority)** applies as written and needs no amendment — it already
  binds every surface this repository builds, internal tools included, so the console is bound from
  its first screen (FR-2209).
- **Principle VII (Minors' Data Minimalism)** does **not** cover three things this feature does:
  collecting gender, an operator reading a student's transcript, and retaining the interaction record
  at full fidelity with no disclosure at signup. An amendment expanding VII is drafted in
  **`constitution-amendment-proposal.md`** here, targeting **v3.1.1 → v3.2.0** (MINOR — materially
  expanded; nothing redefined or removed), status **awaiting Samuel's approval**. Nothing here
  presumes it has landed: FR-2306, FR-2307, FR-2308 and FR-2601…FR-2606 state the obligations the
  amendment would sanction, and the amendment is the record that makes them legal to build.

**Requirements superseded in `specs/001-student-mvp1-delta/spec.md`**, stamped in place there rather
than deleted:

| 001 requirement | Was | Superseded by |
|---|---|---|
| **FR-106** — self-signup with verification | DEFERRED | **FR-2001…FR-2011** — accounts, confirmation and sign-in ship; phone and OTP stay deferred (FR-2903) |
| **FR-501** — parent view through the student picker | REVISED, accepting that any parent sees any student | **FR-2901, FR-2902** — the picker is withdrawn; the parent link is modelled, the view deferred |
| **FR-604** — account-sharing deterrence | DEFERRED, "there are no accounts to share" | **FR-2009** — the student sees and can end every place their account is signed in |
| **FR-606** — per-person operator authorisation | BLOCKED on FR-106 | **FR-2202, FR-2203, FR-2204** — unblocked; four roles, one authorisation point, content-review named as a safety control |
| **FR-051** — server-enforced per-surface turn caps MUST bound spend | KEEP (baseline, `specs/000-baseline/spec.md`) | **FR-3401…FR-3406** — no surface refuses a turn for count any more; the same three numbers survive as named, observed thresholds shown in the console ([ADR-0023](../../docs/decisions/0023-turn-limits-observed-not-enforced.md)) |

Noted, not superseded: **FR-105** carries over, with "last selected student" becoming "the signed-in
student"; **FR-603** is unchanged in substance, with FR-2101…FR-2103 moving enforcement beneath the
application and FR-2306 adding that an operator's read is itself recorded. **FR-605** is carried
unchanged as FR-2201 — the build-scope obligation survives, now beside the authorisation it was never
able to provide.

## Assumptions

Working defaults where Samuel has not decided. Each is reversible; none blocks planning.

- **Email and password is the sign-in that ships**, with Google as the alternative; phone and
  one-time code is designed for and deferred (FR-2903), per D9.
- **Email confirmation gates learning, not signing in.** A student can sign in to an unconfirmed
  account and see what is outstanding, but cannot start a lesson. Refusing the sign-in outright
  strands a student who closed the tab, and the pattern being mirrored is inconsistent on this point.
- **Lockout is temporary**, clearing on its own after a stated period as well as by an operator. A
  permanent lockout on a minor's account with nobody on call at 9pm is a support problem.
- **The first operator account is Samuel's**, created by a repeatable setup step keyed on a
  configured email address and holding all four roles — ADR-0014's stated default.
- **Gender is a small fixed set of options** presented plainly, with a "prefer not to say" that
  leaves the tutor in FR-2605's either-correct form. The exact enumeration is Samuel's.
- **Deleting an account deletes the interaction record with it** (FR-2310), the safest default until
  FR-2307's retention decision is made.
- **Both surfaces share one database.** Two databases is a plan-level option, not a product
  requirement; nothing here assumes either.
- **Cloudflare Access stays in front of the pilot** for both surfaces (FR-2208) — additional defence,
  not a replacement. Removing it is a separate decision with its own release.
- **The console is for founders, not customers**: no support ticketing, no bulk operations on
  students — those would be a later feature.

## Open Decisions

Only what Samuel has not decided. Everything else is settled by `decisions.md` or the ADR chain.
**This is the complete list**, and `plan.md`'s "Open for Samuel" cites these numbers rather than
keeping a second one. Items 1–5 are product or governance decisions; 6–13 carry a recommended
default from the plan, so none of them blocks planning or task generation.

1. **The gender enumeration, and whether it can be skipped.** Working default in Assumptions. It
   changes what the tutor must handle in FR-2605 and what the Principle VII amendment sanctions.
2. **The retention period for full-fidelity interaction records.** FR-2307 names the decision as owed
   and does not make it; it is due before any audience wider than the invited pilot and the current
   operator roster. The constitution amendment carries the same follow-up.
3. **The disclosure text, its owner and its date.** D7 defers the disclosure screen and Samuel takes
   responsibility. FR-2308 bounds the exception: it reverts when he sets the text, or before a wider
   audience, whichever comes first. Neither text nor date exists yet.
4. **Who owns the anonymous product-analytics measurement.** D8 asked for it and for a
   state-of-the-art study; that study informed the plan and **ADR-0016** (accepted 2026-09-20).
   Undecided is who defines the measurement plan — which questions it answers, which coarse
   properties it may carry. A product decision, not an engineering one.
5. **Whether the first operator seeding uses Samuel's own email address.** ADR-0014's default says it
   does. Recorded because it is a production credential decision he may want to make differently, not
   because the ADR is in doubt.
6. **Guardian consent, against D7.** Egypt's data-protection regulations treat a child's data as
   sensitive in every case and require written guardian consent for under-15s, with the grace period
   ending **2026-11-01** — weeks after target launch. D7 says no disclosure and no consent at signup,
   and **D7 stands**; this records the conflict rather than resolving it. Plan default: ship the
   consent fields and hooks with no interface and no enforcement — the same shape FR-2404 uses for
   payment — and obtain an Egyptian data-protection opinion before the pilot takes money. Bears on
   FR-2307, FR-2308 and FR-2901, and carried as a follow-up in the Principle VII amendment proposal.
7. **Whether the anonymous stream may set a persistent identifier on a student's device.** Plan
   default: it may not on any signed-in student surface — no cookie, no cross-page identifier — and
   it is never loaded on the console at all. D8 may have meant an ordinary install; the price of that
   is a persistent identifier on a minor's device.
8. **Whether the objective a student is working on may go to the anonymous stream.** Plan default:
   no — 90 objectives plus timestamps plus a persistent identifier reconstructs one child's learning
   path. It is curriculum metadata and arguably harmless, which is why it is a decision and not a
   rule.
9. **The failed-sign-in threshold and the lockout period.** Plan default: five failures on one
   account within fifteen minutes, locked for fifteen minutes; twenty failures from one source in
   fifteen minutes, that source slowed. FR-2011 requires the numbers be documented, not the numbers
   themselves.
10. **The period of inactivity that closes a learning session.** Plan default: **30 minutes**.
    FR-2302 requires it be stated rather than discovered; the value is cheap to change.
11. **How the first operator account is created.** ADR-0014 says a seeded step keyed on a configured
    email address. Plan default: a repeatable script rather than a database migration, because a
    migration cannot read configuration, and it sets no password — Samuel obtains one through the
    ordinary reset flow. A mechanical departure from the ADR's wording, not a substantive one.
12. **The console's absence from the student build is one-directional.** Plan default: console
    surfaces are absent from the student build at build time (the stronger half, and the one FR-2201
    asks for), while student surfaces exist in the console build and refuse at runtime. Making it
    symmetric would mean renaming every route file in the product against a threat nobody named.
13. **Whether per-student cost over time is stored or computed on demand.** Plan default: stored and
    refreshed, with today's figures computed live. Computing the whole series on demand re-reads the
    largest table on every console view. Invisible to a reader of FR-2401; it decides whether the
    view is usable.

Outside this feature and unchanged: the PRD §10 price point (which would restore Principle VI's
numeric ceiling and put something real behind FR-2404's status), and the PRD §9 legal review of
minors' data, terms and parental consent — which bears directly on FR-2307 and FR-2308 and blocks a
paid cohort, not this build.
