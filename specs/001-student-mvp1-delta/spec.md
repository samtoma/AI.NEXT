# Feature Specification: Student MVP 1.0 — Delta from the PoC Baseline

**Feature Branch**: `001-student-mvp1-delta`
**Created**: 2026-09-08
**Status**: Draft — requirements delta only, no implementation
**Input**: Samuel's directive: go through the new PRD, build the requirements delta and diff between what we have and what we will have, holding the curriculum content constant at the same mathematics book already digested, and stand up a replica URL so both versions can be compared side by side.

> **Product authority (new)**: `PRD: AI Tutor — Student MVP` v0.4, Tamer Deif, Google Drive
> `1gUAF0IyHRBr47k7aqiPxe9q22CJy8A7JwVqI405bRnk` (created 2026-09-01, revised 2026-09-03).
> **Baseline being differenced against**: `specs/000-baseline/spec.md` (as-built at main `f0cb192`,
> live at `ainext.reletix.com`).
> **Engineering authority**: `.specify/memory/constitution.md` **v2.0.0** + ADR-0001..**0007**.
> **Scope decisions**: `decisions.md` in this directory — twelve answers from Samuel (2026-09-08),
> which this spec has been re-cut against. Requirements dropped or changed by those answers are marked
> **[DEFERRED]** or **[REVISED]** rather than deleted, so the diff against the PRD stays legible.

## Why this feature exists

The new PRD is not an increment on the PoC — it is a different product wearing the same name. It
moves the buyer from the parent to the student, the language from Arabic-first to English-first, the
device from low-end Android on 3G to iPad and desktop, the mastery model from Elo to Bayesian
Knowledge Tracing, and it re-opened four principles of constitution v1.0.0 — since resolved by
amending it to v2.0.0 (ADR-0007).

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

### User Story 1 — Pick who I am (or create me) and reach a taught skill (Priority: P1) **[REVISED]**

A pilot student opens the site, picks themselves from a dropdown, and is in. If they are new, one
short "create new user" step takes a name, a grade and a few interests, and drops them straight into
a mathematics lesson already shaped by those answers. No password, no verification code, no waiting.

**Why this priority**: it is the way in, so nothing else is reachable without it. Samuel's decision
(decisions.md Q5) replaced the PRD's Epic A signup with the simplest possible picker — which also
holds identity constant across both environments and so makes the comparison cleaner, not weaker.

**Independent Test**: from a clean browser, create a new student and reach the first streamed tutor
message in under a minute, with no operator intervention beyond the Access invite.

**Acceptance Scenarios**:

1. **Given** the site behind Cloudflare Access, **When** a visitor arrives, **Then** they see a
   dropdown of existing pilot students plus a visible "create new user" action — never a login form.
2. **Given** "create new user", **When** it is completed, **Then** it captures name, grade (7-12) and
   interests, and the student is immediately usable; interests may be skipped without blocking.
3. **Given** a selected student, **When** they reach their first lesson, **Then** the subject is
   mathematics without a subject picker, and content reflects the captured grade.
4. **Given** a returning visitor, **When** they revisit, **Then** their last selected student is
   remembered and their position restored, without re-entering anything.
5. **Given** any request, **When** the selected student is resolved, **Then** it is validated
   server-side, and the picker is never presented to a user as a login.

---

### User Story 2 — Learn a skill, with the tutor adapting to what I actually know (Priority: P2)

A student works through a unit one step at a time. When they get something wrong, the tutor does not
solve it fresh — it diagnoses the misconception and teaches from a stored library entry written for
that specific misconception. Their per-skill mastery updates as probabilistic evidence, and the next
thing they are shown is chosen from that estimate and the prerequisite graph.

**Why this priority**: this is the product thesis and the primary variable under comparison. It is
where the new build most differs from the baseline: Elo point-scores become Bayesian mastery
probabilities, and ad-hoc grounding slices become an explicit retrieval layer.

**Independent Test**: run one student through a unit containing a deliberately seeded misconception;
verify the refutation served is a stored library entry (never improvised at request time), that
mastery is expressed as a probability that moves with evidence, and that the next item selected
changes as a result.

**Acceptance Scenarios**:

1. **Given** a student attempt, **When** it is graded, **Then** mastery for the tagged skill updates
   as a probability in [0,1] carrying the evidence that moved it, not an opaque score.
2. **Given** a wrong answer matching a known misconception, **When** the tutor responds, **Then** it
   serves the stored library entry for that misconception and never improvises a novel refutation at
   request time.
3. **Given** no library entry exists for the detected misconception, **When** the tutor
   responds, **Then** it gives the standard correct explanation and raises an authoring-gap flag —
   it does not invent a refutation and present it as settled.
4. **Given** the model's confidence in a skill tag is low, **When** the attempt is logged, **Then**
   the low confidence is recorded and the response stays general rather than asserting false
   certainty.
5. **Given** any tutor turn, **When** it is composed, **Then** the retrieval layer supplied the
   student's mastery on the nearest skills, their grade, their language preference and the relevant
   stored library content — and the model saw no ungrounded material.

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

### User Story 6 — Trial, payment, and plan management (Priority: P6) **[DEFERRED]**

> **Deferred by decisions.md Q7.** Payments test commerce, not teaching, and would pull in the PRD §9
> legal review that blocks a paid cohort. Retained here in full so the scope is re-openable without
> re-deriving it.

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
**FR-9xx** comparison environment, **FR-10xx** design system. Baseline requirements referenced as
`B/FR-0xx` are from `specs/000-baseline/spec.md`.

Implementation status for every requirement below — what code exists and what actually proves it
works — is tracked in [traceability.md](./traceability.md), which is deliberately harsher than this
document: a requirement whose code exists but has never been executed does not count as done there.

### Carried over unchanged (the constant)

- **FR-C01**: Grounded teaching (`B/FR-002`, `B/FR-003`, `B/FR-004`) MUST hold unchanged: every
  explanation traces to reviewed material, claims carry citation receipts, out-of-scope questions are
  declined rather than answered.
- **FR-C02** *(revised — constitution v2.0.0 Principle III)*: The review gate machinery MUST remain
  in place and enforced by default for question banks and canonical solutions. It is **suspended for
  pipeline-generated explanation and refutation content in this environment only** (decisions.md Q8):
  such content ships without human review, MUST be stored attributed and flagged unreviewed, MUST
  never be served by `ainext.reletix.com`, and the suspension MUST be lifted before any audience wider
  than the invited pilot cohort.
- **FR-C03**: Deterministic server-side grading with transactional mastery updates (`B/FR-020`) MUST
  hold; only the mastery *model* changes (FR-301), not the determinism of grading.
- **FR-C04**: Per-call AI cost, token, latency and student logging (`B/FR-050`) MUST hold and MUST
  additionally tag the environment (FR-901).
- **FR-C05**: Operational safety (`B/FR-060`, `B/FR-061`) MUST hold for both environments: code
  deploys cannot mutate data, content mutations take a backup and print a rollback.

### Identity & onboarding **[REVISED — replaces PRD Epic A]**

- **FR-101** *(revised)*: Student identity MUST be a picker: a dropdown of existing students plus an
  in-place "create new user" action. No password, no email or SMS verification, no session
  credentials. The baseline's picker pattern (`B/FR-041`) is reused deliberately, so identity is
  identical on both sides of the comparison.
- **FR-102** *(revised)*: The selected student MUST be validated server-side on every request, and
  every query, session key, turn cap and spend meter MUST scope to the resolved student
  (`B/FR-040`). The picker MUST never be presented to a user as a login.
- **FR-103**: "Create new user" MUST capture grade (7-12) and seed the student model with it.
- **FR-104**: "Create new user" MUST offer interest capture across five categories plus free-text
  "Other", with an optional follow-up detail for Sports and Music, skippable without blocking.
- **FR-105**: The last selected student MUST be remembered across visits, restoring their position
  (FR-204) without re-entry.
- **FR-106** *(deferred)*: PRD A1/A2/A4 self-signup with email or phone and verification is
  **[DEFERRED]** — reachable only through the Cloudflare Access invite list (FR-907).

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
- **FR-208** *(revised)*: The interface MUST render English left-to-right by default. Direction and
  language MUST remain switchable at the layout level — no page-level direction may be hard-coded and
  no Arabic-capable surface may be removed to achieve the English default, so the Arabic and Social
  Studies verticals stay reintroducible (constitution v2.0.0 Principle V). Mathematics instruction is
  already delivered in English today; this requirement covers chrome, navigation and copy.

### Student model & retrieval (PRD Epic C, §4)

- **FR-301**: Per-skill mastery MUST be represented as a probability updated from attempt evidence
  (Bayesian Knowledge Tracing), replacing the baseline's Elo-style point score (`B/FR-020`, K=0.15).
  Both the estimate and the evidence that moved it MUST be inspectable.
- **FR-302**: The student model MUST hold, at minimum: per-skill mastery, grade, language preference,
  curriculum system, interests and interest detail.
- **FR-303**: A retrieval layer MUST assemble, before any model call: the student's mastery on the
  nearest relevant skills, their profile attributes, and the stored library content for the likely
  misconception. The model MUST NOT receive ungrounded material.
- **FR-304** *(revised — decisions.md Q8)*: An explanation library MUST exist as first-class content,
  typed as worked example, faded variant, contrasting case or refutation. Entries are
  **pipeline-generated and ship without human review at this stage**; each MUST carry generation
  attribution, a `reviewed: false` flag, and a review slot that a human can later fill. Entries MUST
  be authored ahead of time and retrieved — never improvised inside a student's turn.
- **FR-305**: Where no library entry exists for a detected misconception, the system MUST serve the
  standard correct explanation and raise an authoring-gap flag.
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

- **FR-501** *(revised)*: A parent MUST reach a read-only view of the same performance data as
  FR-401 through the same student picker used by students (decisions.md Q11), and MUST NOT have access
  to lesson or chat transcripts. **Accepted limitation**: any pilot parent can therefore see any pilot
  student's data. This is acceptable only at invited-cohort scale behind Access and MUST NOT survive
  into any public build.
- **FR-502**: Threshold alerts (prolonged inactivity, sustained struggle on a topic) MUST be
  delivered to the linked parent in supportive, non-punitive wording.

### Safety & integrity (PRD Epic F)

- **FR-601**: The system MUST never encourage, assist with or normalise self-harm, and MUST respond
  supportively and point toward appropriate help when distress is expressed.
- **FR-602**: Crisis flags MUST reach a human channel immediately, on a path separate from routine
  analytics.
- **FR-603**: A student's conversations and personal data MUST NOT be exposed to other students, and
  data shared with a parent MUST be limited to FR-501's scope.
- **FR-604** *(deferred)*: PRD F2 account-sharing deterrence is **[DEFERRED]** — there are no
  accounts to share in this build, and the audience is an invited list behind Access.

### Billing (PRD Epic G, §10) **[DEFERRED — decisions.md Q7]**

> None of FR-701..707 is built for the comparison. Kept for re-opening.


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
- **FR-907**: The new environment MUST sit behind Cloudflare Access with an explicitly invited
  audience (decisions.md Q9). This containment is what makes FR-C02's review-gate suspension
  acceptable; unreviewed content MUST never be reachable by an uninvited person.
- **FR-908**: The baseline environment MUST be instrumented to emit the same conversion metric
  (SC-005), and that change MUST be provably behaviour-neutral — metric-only, no teaching change —
  or the baseline stops being a baseline (constitution v2.0.0 Principle XI).

### Design system & visual language **[ADDED 2026-09-10]**

The *Nour Design System v0.2* handoff (Drive `1eAJeMHy5m3D-FhS8RAv2KMg5F6eO0QOM`) is the visual
authority for this environment. These requirements exist because it was possible to ship a
behaviour that violated a stated product rule — the Phase 8 dashboard's burnt-sienna mastery ramp —
with nothing in the requirement set able to catch it. They are written as product constraints, not
as styling preferences: each one names a student-visible behaviour with a reason behind it.

- **FR-1001**: The comparison environment MUST apply the Nour design system. The frozen baseline
  MUST remain visually unchanged, so the visual language is never a confounding variable in the
  comparison (Principle XI).
- **FR-1002**: **No red and no coral may appear in the product palette.** A wrong answer MUST grey
  out and invite a retry rather than being marked in a warning colour. The persona's stated fear is
  looking stupid, and a red screen is what that fear looks like.
- **FR-1003**: Mastery MUST be presented as named bands alongside the value, never by colour alone,
  so the scale survives greyscale, colour-vision deficiency and a screen reader.
- **FR-1004**: An objective or topic with **no attempt evidence** MUST NOT be rendered in a lit
  mastery band. A cold-start prior and a practised score of the same value must be visually
  distinguishable.
- **FR-1005**: Text MUST never be rendered in a light colour on the amber action fill, and a screen
  MUST carry at most one dominant accent.
- **FR-1006**: Where both scripts appear together, Arabic and English MUST render at equal size and
  weight, each carrying its own direction. Spacing between them MUST come from layout, never from
  direction-relative margins.
- **FR-1007**: Arabic MUST never be set in the monospace stack and MUST never be letter-spaced.
- **FR-1008**: Equations MUST render left-to-right inline regardless of page direction.
- **FR-1009**: The product MUST NOT contain leaderboards, class ranking, peer comparison, streak
  shaming, or "you're behind" framing on any surface.
- **FR-1010**: The single signature motion MUST be reserved for a proficient → mastered transition,
  and MUST respect `prefers-reduced-motion`.

**Open decision (Samuel's, per Principle I)**: the handoff ships two variants — *master* (15–18)
and *Play* (10–16) — and forbids mixing them in one build. Prep-3 is 14–15 and sits inside both.
**Master is implemented**, on the reasoning that the comparison already varies BKT against Elo and a
second visual variable is a confound. Reversal is a token swap.

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
  refutation, with generation attribution, a `reviewed` flag (false at this stage) and an unfilled
  reviewer slot.
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
- **SC-011** *(revised)*: No unreviewed **question or canonical solution** is servable in either
  environment. Generated explanation-library content is exempt in the comparison environment only
  (FR-C02), MUST be flagged `reviewed: false` in storage, and MUST be countable — we can state at any
  time exactly how much unreviewed content is live and to whom.

## Governance Impact — RESOLVED

Samuel's decision (decisions.md Q10): *"I want to proceed with this new PRD so go for it and update
the principles."* The constitution was therefore **amended to v2.0.0** rather than exempted, and the
decision is recorded in **ADR-0007**.

| Principle | Resolution in v2.0.0 |
|---|---|
| **III** Review Gate | Standard retained; suspended for pipeline-generated explanation content in this environment only, attributed, flagged, reversible |
| **V** Arabic-First, Low-End-First | Became *Bilingual by Construction, English-First for MVP 1.0* — English LTR default, direction never hard-coded, iPad + desktop targets |
| **VI** Cost Discipline | Numeric EGP 40 ceiling detached (it derived from a withdrawn parent price band); instrumentation and turn caps remain binding; the number returns with PRD §10 pricing |
| **VII** Minors' Data Minimalism | Student-owned per the PRD; minimalism retained; "a picker is not auth" made explicit |
| **VIII** MVP Non-Goals | List replaced with PRD §14; parent dashboard, mastery modelling and ask-anything are no longer non-goals; payments out for this build |
| **XI** Comparison Integrity | **New principle** — content parity, environment attribution, a genuinely frozen baseline, no student data across environments |

Unchanged: I, II, IV (dormant here, never weakened), IX, X (extended to two co-tenant environments).

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

All twelve questions are answered in `decisions.md`. Nothing blocks planning.

What remains open is deliberately outside this build: the PRD §10 price point (a business decision,
and the trigger for restoring Principle VI's numeric ceiling), the PRD §9 legal review of minors'
data, terms and parental consent (blocks a paid cohort, not this comparison), and whether the
constitution's Principle III suspension is lifted or the direction is abandoned — which the
comparison itself is meant to inform.
