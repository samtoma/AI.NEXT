# Feature Specification: Student MVP 1.0 — Delta from the PoC Baseline

**Feature Branch**: `001-student-mvp1-delta`
**Created**: 2026-09-08
**Status**: Draft — requirements delta only, no implementation
**Input**: Samuel's directive: go through the new PRD, build the requirements delta and diff between what we have and what we will have, holding the curriculum content constant at the same mathematics book already digested, and stand up a replica URL so both versions can be compared side by side.

> **Product authority (new)**: `PRD: AI Tutor — Student MVP` v0.4, Tamer Deif, Google Drive
> `1gUAF0IyHRBr47k7aqiPxe9q22CJy8A7JwVqI405bRnk` (created 2026-09-01, revised 2026-09-03).
> **Baseline being differenced against**: `specs/000-baseline/spec.md` (as-built at main `f0cb192`,
> live at `ainext.reletix.com`).
> **Engineering authority**: `.specify/memory/constitution.md` v1.0.0 + ADR-0001..0006 — **note that
> this delta conflicts with four ratified principles; see "Governance Impact" below. Per Principle I
> those conflicts are Samuel's to resolve, not this spec's.**

## Why this feature exists

The new PRD is not an increment on the PoC — it is a different product wearing the same name. It
moves the buyer from the parent to the student, the language from Arabic-first to English-first, the
device from low-end Android on 3G to iPad and desktop, the mastery model from Elo to Bayesian
Knowledge Tracing, and it re-opens four things the current constitution lists as binding non-goals.

Rebuilding blind would leave us unable to answer the only question that matters: **is the new
experience actually better at teaching?** So this build holds the one variable that would otherwise
contaminate the comparison — **the curriculum content** — completely constant, and changes only the
experience around it. Same book, same year, same 450 questions. Two URLs. One honest comparison.

## Scope Constant — the content that must NOT change

The comparison is only valid if both environments teach identical material. The constant is the
mathematics book already digested on `main`:

| Property | Value (verified from `services/extraction/seed/*.json`) |
|---|---|
| Source document | Mathematics — Student's Book, Preparatory Year Three (Terms 1 & 2) |
| Publisher / edition | Egypt Ministry of Education & Technical Education, CACD — 2025-2026 |
| Language / grade | English / prep-3 |
| Modules | 10 |
| Learning objectives | 90 |
| `prerequisite_of` edges | 112 |
| Questions | 450 |
| Visuals | 212 |
| Bundles | unit1–5, geo-unit1, t2-unit12, t2-unit3, geo-unit2a, geo-unit2b |

**This satisfies the new PRD's own scope more cleanly than it first appears.** PRD §2 names the
international system as the confirmed primary target but records national **English-medium** delivery
as an open maybe with "the final system pending content sourcing", and PRD §3.1(6) asks whether to
narrow from grades 7-12 to one or two grades. Prep-3 is English-medium already and sits inside the
7-12 band, so holding content constant is a legitimate reading of the PRD's stated flexibility rather
than a deviation from it. It also answers PRD §3's largest pre-launch dependency — the content
pipeline — with content that already exists, reviewed, with provenance.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Sign up, get set up, and reach a first taught skill (Priority: P1)

A student finds the product, creates an account with an email address or phone number, verifies it,
picks their grade, optionally picks a few interests, and lands in a mathematics lesson that is
already adapted to them. No demo picker, no shared login, no team member handing them a profile.

**Why this priority**: this is the activation spine. Every other story is unreachable without it, and
it is the single largest gap between the PoC (a cookie labelled explicitly "NOT auth") and a product
a stranger can sign up for. PRD Epics A1–A4, B1.

**Independent Test**: from a clean browser, complete signup through verification to the first
streamed tutor message, with no operator intervention. Delivers a usable single-student product even
if nothing else in this spec ships.

**Acceptance Scenarios**:

1. **Given** a visitor with no account, **When** they sign up with an email address or a phone
   number, **Then** an unverified account is created and the product is unusable until the emailed
   link or SMS code is confirmed.
2. **Given** a verified new account, **When** onboarding runs, **Then** grade (7-12) is captured as
   a required step and interests as a skippable one, and skipping interests still produces a fully
   usable account.
3. **Given** onboarding is complete, **When** the student reaches their first lesson, **Then** the
   subject is mathematics without a picker (single-subject launch) and the opening content reflects
   the captured grade.
4. **Given** a returning student, **When** they revisit on the same device, **Then** they are still
   logged in and resume where they left off rather than re-entering credentials.

---

### User Story 2 — Learn a skill, with the tutor adapting to what I actually know (Priority: P2)

A student works through a unit one step at a time. When they get something wrong, the tutor does not
solve it fresh — it diagnoses the misconception and teaches from a human-reviewed library entry for
that specific misconception. Their per-skill mastery updates as probabilistic evidence, and the next
thing they are shown is chosen from that estimate and the prerequisite graph.

**Why this priority**: this is the product thesis and the primary variable under comparison. It is
where the new build most differs from the baseline: Elo point-scores become Bayesian mastery
probabilities, and ad-hoc grounding slices become an explicit retrieval layer.

**Independent Test**: run one student through a unit containing a deliberately seeded misconception;
verify the refutation served is a reviewed library entry, that mastery is expressed as a probability
that moves with evidence, and that the next item selected changes as a result.

**Acceptance Scenarios**:

1. **Given** a student attempt, **When** it is graded, **Then** mastery for the tagged skill updates
   as a probability in [0,1] carrying the evidence that moved it, not an opaque score.
2. **Given** a wrong answer matching a known misconception, **When** the tutor responds, **Then** it
   serves the reviewed library entry for that misconception and never improvises a novel refutation.
3. **Given** no reviewed library entry exists for the detected misconception, **When** the tutor
   responds, **Then** it gives the standard correct explanation and raises an authoring-gap flag —
   it does not invent a refutation and present it as settled.
4. **Given** the model's confidence in a skill tag is low, **When** the attempt is logged, **Then**
   the low confidence is recorded and the response stays general rather than asserting false
   certainty.
5. **Given** any tutor turn, **When** it is composed, **Then** the retrieval layer supplied the
   student's mastery on the nearest skills, their grade, their language preference and the relevant
   reviewed content — and the model saw no ungrounded material.

---

### User Story 3 — Ask anything, upload my own material, never get the answer handed to me (Priority: P3)

A student photographs a worksheet or a page of their own handwriting, or types a question, and gets
taught through it. If what they uploaded looks like graded homework, the tutor guides instead of
answering — uploading is not a way around the guardrail.

**Why this priority**: the PRD calls this the signature trust moment, and it is the most-requested
real usage pattern. It is entirely absent from the baseline, which has no upload path at all.

**Independent Test**: upload a photographed worksheet and ask for the answer; verify guided teaching
rather than a solution, and that the same guardrail holds for typed questions.

**Acceptance Scenarios**:

1. **Given** an uploaded image or PDF, **When** it is processed, **Then** the tutor grounds its
   explanation in that material, and incidental personal detail visible in the image is neither
   retained nor commented on.
2. **Given** an upload that reads as graded assignment work, **When** the student asks for the
   answer, **Then** the guide-don't-answer behaviour applies exactly as it does for typed questions.
3. **Given** an unreadable or partially unreadable upload, **When** parsing fails, **Then** the
   product says so plainly and asks the student to retype or reshoot — it never silently guesses.
4. **Given** an unsupported file type or a failed upload, **When** the error surfaces, **Then** the
   student gets a specific message and a retry, and the rest of the lesson stays usable.
5. **Given** a question outside mathematics, **When** the student asks it, **Then** the tutor is
   honest that it is outside what it covers rather than improvising ungrounded content.

---

### User Story 4 — See where I stand, and prepare for the exam (Priority: P4)

A student opens a dashboard that shows strength and weakness by topic rather than one blended number,
and can turn that into an exam-prep plan weighted by high-yield topics and their own prioritised
weaknesses. A student joining mid-year is placed at their real level instead of starting from zero.

**Why this priority**: this is what converts a trial into a subscription and what a parent is shown.
It depends on mastery data existing, so it follows Story 2.

**Independent Test**: drive a student to uneven mastery across topics, then verify the dashboard
reflects that unevenness and the exam-prep view prioritises the weak topics.

**Acceptance Scenarios**:

1. **Given** attempts across several topics, **When** the dashboard renders, **Then** performance is
   broken down per topic/unit and never presented only as a single aggregate.
2. **Given** a student joining after the school year started, **When** placement runs, **Then** the
   learning plan is adjusted to measured level rather than assuming a zero start.
3. **Given** a student in exam prep, **When** guidance is produced, **Then** it names likely chapters
   and question types and orders work by the student's own weaknesses.

---

### User Story 5 — A parent can see how their child is doing (Priority: P5)

A parent gets read-only visibility of the same per-topic performance the student sees, plus alerts
when their child has not studied for a while or is stuck on a topic. Supportive in tone, never
punitive, never a surveillance feed of conversations.

**Why this priority**: in this market the parent usually pays, so this underwrites conversion — but
the PRD deliberately keeps it light, and it is the epic most likely to be cut under time pressure.

**Independent Test**: link a parent to a student, verify they see performance data and receive a
threshold alert, and verify they cannot read lesson transcripts.

**Acceptance Scenarios**:

1. **Given** a linked parent, **When** they open their view, **Then** they see performance data only
   — never conversation content.
2. **Given** a student inactive beyond the threshold or struggling on a topic, **When** the alert
   fires, **Then** its wording is supportive and non-punitive.

---

### User Story 6 — Trial, payment, and plan management (Priority: P6)

A student uses the product free for 14 days. Before the trial ends they are reminded once. Because
the parent usually holds the card, the student can send a payment link by WhatsApp or email instead
of needing the card themselves.

**Why this priority**: monetisation must be proven before a paid cohort, but it teaches us nothing
about whether the tutoring works — which is what this comparison is for.

**Independent Test**: run an account from trial start through the reminder, expiry, payment link and
a successful and a failed payment.

**Acceptance Scenarios**:

1. **Given** a trial expiring one day out, **When** the student logs in, **Then** they get one
   in-product reminder plus one message to their email or phone — one reminder, not a drip.
2. **Given** a trial that ends mid-lesson, **When** the student is working, **Then** they finish the
   current session and the gate applies before the next one starts.
3. **Given** a failed payment, **When** the student returns, **Then** the account reads
   "trial expired, payment failed" with a retry path — never a silent lockout.
4. **Given** a student who wants a parent to pay, **When** they choose that, **Then** a shareable
   payment link goes out over WhatsApp or email and completing it activates the student's account.

---

### User Story 7 — Two environments, one book, an honest comparison (Priority: P7)

Samuel (and the founders) can open the existing experience and the new one side by side, on two
URLs, both teaching the identical mathematics book, and form a judgement about which teaches better.

**Why this priority**: this is the reason the whole feature is scoped this way. Without it the
rebuild is just a rewrite; with it, it is an experiment. It is P7 only because it is verifiable the
moment Story 2 is real.

**Independent Test**: load both URLs; run the same lesson on each; confirm both serve the same
content set and that a parity check passes.

**Acceptance Scenarios**:

1. **Given** both environments running, **When** the parity check runs, **Then** it confirms
   identical source document, module, learning-objective, prerequisite-edge, question and visual
   counts, and fails loudly on any drift.
2. **Given** the new environment, **When** it is deployed or refreshed, **Then** the existing
   environment's database, content and one-time AI runtime login are provably untouched.
3. **Given** a comparison session, **When** an observer moves between the two URLs, **Then** both
   are reachable at the same time behind the same access control, neither replacing the other.

---

### User Story 8 — Instrumented from day one (Priority: P8)

An analyst can answer whether students activate, come back, convert comprehension into practice, and
pay — for either environment — without asking an engineer to write a query.

**Why this priority**: the comparison needs a measurement layer or it degenerates into opinion. Last
because the events are only meaningful once the flows they instrument exist.

**Independent Test**: complete one full student journey and verify every event in the schema fired
with its properties, tagged with which environment produced it.

**Acceptance Scenarios**:

1. **Given** any tracked interaction, **When** the event is recorded, **Then** it carries which
   environment it came from, so the two builds are never compared on pooled data.
2. **Given** a safety flag, **When** it is raised, **Then** it reaches a human channel immediately
   and does not sit in the routine analytics queue.

---

### Edge Cases

- **Content parity drifts** — a refresh loads a different bundle set into one environment. The parity
  check must fail and the comparison must be treated as void until re-established.
- **BKT cold start** — a brand-new student has no evidence on any skill. Placement (Story 4) or a
  documented prior must cover this; the tutor must not present a guess as measured mastery.
- **Mastery already exists in the baseline environment** — student data does not migrate between
  environments; each environment's students are its own. Cross-environment student identity is out
  of scope.
- **A student shares their login** — simultaneous sessions from very different devices or locations
  are flagged or limited, acknowledged as a deterrent and not a guarantee.
- **A student expresses distress** — escalates immediately to a human channel, while the interface
  stays supportive and never makes the student feel reported on.
- **Network drops mid-response** — the last message is retried or resumed; the student's place in the
  conversation is not silently lost.
- **A skill has no reviewed content at all** — the unit is not offered rather than served ungrounded.
- **The 450-question bank is exhausted for a skill** — the product repeats or stops honestly; it does
  not generate unreviewed questions to fill the gap.
- **Trial expires while a parent payment link is in flight** — access decision must be deterministic
  and explained to the student.

## Requirements *(mandatory)*

Numbering marks provenance: **FR-1xx** accounts, **FR-2xx** learning core, **FR-3xx** student model,
**FR-4xx** progress, **FR-5xx** parent, **FR-6xx** safety, **FR-7xx** billing, **FR-8xx** analytics,
**FR-9xx** comparison environment. Baseline requirements referenced as `B/FR-0xx` are from
`specs/000-baseline/spec.md`.

### Carried over unchanged (the constant)

- **FR-C01**: Grounded teaching (`B/FR-002`, `B/FR-003`, `B/FR-004`) MUST hold unchanged: every
  explanation traces to reviewed material, claims carry citation receipts, out-of-scope questions are
  declined rather than answered.
- **FR-C02**: The human review gate (`B/FR-062`) MUST hold: no unreviewed question or explanation
  reaches a student.
- **FR-C03**: Deterministic server-side grading with transactional mastery updates (`B/FR-020`) MUST
  hold; only the mastery *model* changes (FR-301), not the determinism of grading.
- **FR-C04**: Per-call AI cost, token, latency and student logging (`B/FR-050`) MUST hold and MUST
  additionally tag the environment (FR-901).
- **FR-C05**: Operational safety (`B/FR-060`, `B/FR-061`) MUST hold for both environments: code
  deploys cannot mutate data, content mutations take a backup and print a rollback.

### Accounts & onboarding (PRD Epic A)

- **FR-101**: The system MUST let a student create an account with either an email address or a phone
  number, one credential set per account, with no shared family or classroom login.
- **FR-102**: The system MUST require verification (emailed confirmation or SMS code) before the
  account is usable.
- **FR-103**: The system MUST capture grade (7-12) as a required onboarding step and seed the student
  model with it.
- **FR-104**: The system MUST offer interest capture across five categories plus free-text "Other",
  with an optional follow-up detail for Sports and Music, and MUST allow the whole step to be skipped
  without blocking account completion.
- **FR-105**: The system MUST keep a returning student logged in across visits without re-entering
  credentials, and MUST restore their position (FR-204).
- **FR-106**: Student identity MUST be a real authenticated account. The baseline's demo-student
  cookie (`B/FR-040`, `B/FR-041`) MUST NOT be the identity mechanism in this build.

### Learning core (PRD Epic B)

- **FR-201**: The system MUST walk a student through the curriculum one unit at a time, in sequenced
  steps.
- **FR-202**: The system MUST let a student ask a question at any point and receive guided teaching —
  never a direct answer to what reads as graded work, whether typed or uploaded.
- **FR-203**: The tutor MUST frame explanations against a student's interests only where a real
  captured or volunteered signal exists, and MUST NOT invent an interest to seem relatable.
- **FR-204**: The system MUST return a student who stopped mid-lesson to where they left off, not to
  the start of the unit.
- **FR-205**: The system MUST accept image (JPEG/PNG) and PDF uploads from anywhere in the lesson and
  ground its explanation in them, on a best-effort parsing basis that is honest about failure.
- **FR-206**: Uploaded material MUST be used only for the academic task; incidental personal detail
  MUST NOT be retained or commented on.
- **FR-207**: Tutor tone MUST adapt to grade level and to how engaged the student currently appears.
- **FR-208**: The interface MUST render English left-to-right as the primary delivery language for
  this build, without a forced page-level direction that would block Arabic being reintroduced later.

### Student model & retrieval (PRD Epic C, §4)

- **FR-301**: Per-skill mastery MUST be represented as a probability updated from attempt evidence
  (Bayesian Knowledge Tracing), replacing the baseline's Elo-style point score (`B/FR-020`, K=0.15).
  Both the estimate and the evidence that moved it MUST be inspectable.
- **FR-302**: The student model MUST hold, at minimum: per-skill mastery, grade, language preference,
  curriculum system, interests and interest detail.
- **FR-303**: A retrieval layer MUST assemble, before any model call: the student's mastery on the
  nearest relevant skills, their profile attributes, and the reviewed content for the likely
  misconception. The model MUST NOT receive ungrounded material.
- **FR-304**: A human-reviewed explanation library MUST exist as first-class content, typed as worked
  example, faded variant, contrasting case or refutation, each carrying reviewer attribution and
  review timestamp.
- **FR-305**: Where no reviewed refutation exists for a detected misconception, the system MUST serve
  the standard correct explanation and raise an authoring-gap flag.
- **FR-306**: A student joining mid-year MUST be placed by assessment rather than assumed to start
  from zero.
- **FR-307**: Every attempt MUST record the diagnosis type, misconception identifier where known, the
  teaching stance used, and the system's confidence — including when confidence is low.

### Progress & assessment (PRD Epic D)

- **FR-401**: The student dashboard MUST break performance down by topic/unit, never presenting only
  a single aggregate figure.
- **FR-402**: Exam preparation MUST combine high-yield topic and question-pattern guidance with the
  student's own prioritised weaknesses.

### Parent (PRD Epic E)

- **FR-501**: A linked parent MUST get read-only access to the same performance data as FR-401, and
  MUST NOT have access to lesson or chat transcripts.
- **FR-502**: Threshold alerts (prolonged inactivity, sustained struggle on a topic) MUST be
  delivered to the linked parent in supportive, non-punitive wording.

### Safety & integrity (PRD Epic F)

- **FR-601**: The system MUST never encourage, assist with or normalise self-harm, and MUST respond
  supportively and point toward appropriate help when distress is expressed.
- **FR-602**: Crisis flags MUST reach a human channel immediately, on a path separate from routine
  analytics.
- **FR-603**: A student's conversations and personal data MUST NOT be exposed to other students, and
  data shared with a parent MUST be limited to FR-501's scope.
- **FR-604**: The system MUST apply a technical deterrent against account sharing by flagging or
  limiting simultaneous sessions from markedly different devices or locations, documented as a
  deterrent rather than a guarantee.

### Billing (PRD Epic G, §10)

- **FR-701**: The system MUST provide a 14-day free trial, after which continued use requires payment.
- **FR-702**: The system MUST accept card payment via a hosted, tokenised provider checkout such that
  raw card data never reaches our servers.
- **FR-703**: The system MUST let a student send a payment link to a parent by WhatsApp or email.
- **FR-704**: The system MUST send exactly one trial-ending reminder, in-product on login and to the
  student's email or phone.
- **FR-705**: The system MUST let a student finish the session in progress when a trial expires, and
  gate the next one.
- **FR-706**: A failed payment MUST move the account to an explained "trial expired, payment failed"
  state with a retry path, never a silent lockout.
- **FR-707**: A plans page MUST show available plans and allow upgrade, downgrade, cancellation and
  viewing trial/billing status.

### Analytics (PRD Epic H, §13)

- **FR-801**: The system MUST emit the PRD §13 event taxonomy — signup, onboarding completion, login,
  session start/end, unit start/complete, lesson step viewed, question asked, retrieval attempt
  started/submitted, upload submitted, dashboard viewed, plans page viewed, trial started/expired,
  payment initiated/succeeded/failed, subscription cancelled, safety flag raised, button click.
- **FR-802**: Safety-flag events MUST carry no detail beyond the flag type.

### Comparison environment (Samuel's directive)

- **FR-901**: Every analytics event, AI-interaction ledger row and cost record MUST identify which
  environment produced it, so the two builds are never compared on pooled data.
- **FR-902**: The new environment MUST run as a separate isolated stack alongside the existing one:
  its own database volume, its own internal port, its own public hostname, behind the same access
  control.
- **FR-903**: Both environments MUST be reachable simultaneously; standing up or refreshing the new
  one MUST NOT interrupt, modify or redeploy the existing one.
- **FR-904**: Both environments MUST be loadable from the same content bundles, and an automated
  parity check MUST verify identical source document, module count, learning-objective count,
  prerequisite-edge count, question count and visual count, failing loudly on drift.
- **FR-905**: The new environment MUST NOT serve Arabic Language or Social Studies content; the
  comparison is mathematics-only on both sides.
- **FR-906**: Provisioning the new environment MUST NOT remove volumes on the shared box, and MUST
  leave the existing environment's one-time AI runtime login intact.

### Key Entities

New or materially changed relative to the baseline; unchanged baseline entities (curriculum graph,
question, visual, attempt) carry over as-is.

- **Account** *(new)*: verified email or phone credential, verification state, session and device
  history. Replaces the baseline's demo-cookie identity.
- **StudentProfile** *(expanded)*: grade, language preference, curriculum system, interests and
  interest detail, communication style. Baseline held only display name and grade.
- **MasteryEstimate** *(replaces baseline Mastery)*: per student per skill, a probability with the
  evidence trail that moved it. Baseline held an Elo-style point score.
- **ExplanationLibraryEntry** *(new)*: per skill, typed worked example / faded / contrasting case /
  refutation, with reviewer attribution and review timestamp.
- **Misconception** *(new)*: the diagnosable error a refutation answers, referenced from attempts.
- **Upload** *(new)*: student file, type, parse result, the skill it was linked to.
- **ParentLink** *(new)*: parent contact, access type, the student it grants read-only visibility of.
- **Subscription** *(new)*: plan, status (trial/active/cancelled/expired), trial end date, tokenised
  payment method reference.
- **AnalyticsEvent** *(new)*: typed event name, properties, environment tag.
- **SafetyFlag** *(new)*: flag type and timestamp only, on the escalation path, deliberately thin.

## Success Criteria *(mandatory)*

### The comparison itself

- **SC-001**: Both environments serve provably identical curriculum content — same source document
  and same counts of modules, learning objectives, prerequisite edges, questions and visuals — with
  the check automated and re-runnable on demand.
- **SC-002**: A reviewer can move between the two experiences on the same lesson within one sitting,
  with no data, session or content bleed between them.
- **SC-003**: Every metric below can be reported per environment, never pooled.

### Product (from PRD §12, applied to this build)

- **SC-004**: At least 70% of verified signups complete onboarding and start a lesson within 24 hours.
- **SC-005**: The comprehension-to-retrieval conversion rate — the share of explain/summarise
  interactions that become a completed practice attempt — is measurable per environment from day one
  and is the headline comparison metric between the two builds.
- **SC-006**: Day-7 and day-30 retention are reported per environment for registered and active
  students.
- **SC-007**: Trial-to-paid conversion, time-to-upgrade and post-trial churn are measurable end to
  end without manual reconciliation.

### Integrity (non-negotiable, carried from the baseline)

- **SC-008**: Zero ungrounded explanations in release-review sampling; 100% of claim-bearing tutor
  statements carry resolvable citations.
- **SC-009**: Zero instances of a direct answer served to material identified as graded work,
  including via upload.
- **SC-010**: Every crisis flag raised in testing reaches the human channel within the same session,
  and none are found sitting in the routine analytics queue.
- **SC-011**: No unreviewed question or explanation is servable to a student in either environment.

## Governance Impact — conflicts requiring Samuel's decision

Per Constitution Principle I these are recorded, not resolved, here. **This spec does not amend the
constitution and must not be read as doing so.** Four ratified principles conflict with the new PRD:

| Principle | Ratified v1.0.0 | New PRD v0.4 | Nature of conflict |
|---|---|---|---|
| **V — Arabic-First, Low-End-First** | Arabic RTL throughout; low-end Android on 3G; first load < 1.5 MB | English-first; iPad Safari + desktop; Android tablets explicitly not optimised; good wifi assumed | Direct reversal |
| **VII — Minors' Data Minimalism** | Parent owns the account; auth is a non-goal | Student owns the account and signs up themselves; parent is a linked secondary view | Direct reversal |
| **VIII — MVP Non-Goals Are Binding** | No ML infrastructure, no parent dashboard, no free-form chat-tutor surface | BKT mastery (C1), parent dashboard (E1), ask-anything (B3) all in scope | Three non-goals re-opened |
| **VI — Cost Discipline** | < EGP 40 per student per month | No ceiling stated; uploads and OCR add unbudgeted per-student cost | Ceiling unaddressed |

Principles II (grounded teaching), III (review gate) and IX (registry discipline) are **reinforced**
by the new PRD, not weakened — its refutation-library and retrieval-first requirements are stricter
versions of what we already enforce. Principle IV (sacred containment) does not arise in a
mathematics-only build but remains in force for the baseline environment.

**Recommendation**: amend the constitution to v2.0.0 (MAJOR — principles redefined) as part of
accepting this delta, rather than shipping against principles the build knowingly violates. The
alternative — a time-boxed, attributed exemption recorded in an ADR, as was done for `promote-poc` —
is available and is Samuel's call.

## Assumptions

- **Content sourcing is answered by reuse.** The new PRD's largest pre-launch dependency (§3, a
  subject-matter expert authoring a taxonomy, prerequisite graph, item bank and explanation library)
  is satisfied for this build by the already-extracted, already-reviewed prep-3 mathematics content.
  Only the explanation/refutation library (FR-304) is genuinely new authoring work.
- **Our curriculum graph is the PRD's skill graph.** The PRD's "skill taxonomy" and "prerequisite
  graph" map onto the existing `graph_nodes` learning objectives and `prerequisite_of` edges; the
  question-to-LO tagging is the PRD's Q-matrix. This is a naming difference, not a rebuild.
- **Billing runs in provider test mode** in the comparison environment; no real charges are taken
  from a comparison cohort, and price points remain unset pending the business decision the PRD
  defers.
- **Students do not migrate between environments.** Each environment owns its own accounts and
  mastery data; comparing the two means comparing cohorts or sessions, not one student's history.
- **Grade band is prep-3 only** for the comparison, following the PRD's own §3.1(6) suggestion to
  narrow, and forced by the constant content.
- **Arabic is deferred, not deleted.** FR-208 requires that no forced page-level direction is
  introduced, so the Arabic and Social Studies verticals already built remain reintroducible.
- **The existing environment is frozen** for the duration of the comparison; changing it mid-flight
  would invalidate the baseline side.
- **Legal review is out of scope for this spec** but blocks a real paid cohort: PRD §9 flags Egypt's
  Law No. 151/2020, terms and privacy policy addressing minors, and parental consent as unresolved
  legal questions, not product ones.

## Open Decisions

Recorded for Samuel; each has a working default so the spec is complete without them.

1. **Constitution amendment vs. exemption** (see Governance Impact). *Default assumed*: amendment to
   v2.0.0 accompanying this delta.
2. **Parent access model** — the PRD's own open question in E1: does a parent get their own login, or
   view through a link/code tied to the student's account? This changes the Account and ParentLink
   entities. *Default assumed*: link/code tied to the student account, as the lighter build consistent
   with "kept lightweight".
3. **Whether the mastery model is part of the experiment or a constant** — FR-301 swaps Elo for BKT
   because the PRD calls for it, but that makes the learning algorithm and the interface change
   together, so a comparison cannot attribute a difference to either alone. *Default assumed*: follow
   the PRD (BKT), and accept that the comparison measures the whole experience rather than isolating
   the algorithm.
