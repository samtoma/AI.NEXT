# Feature Specification: AI.Next Tutor PoC — Baseline (As-Built)

**Feature Branch**: `000-baseline` (retro-spec of the shipped product; no feature branch)
**Created**: 2026-08-02
**Status**: Ratified baseline (documents the system live at ainext.reletix.com as of main `d6db088`)
**Input**: Samuel's directive: "have requirements for this project… generate a full documentation of this project from A to Z" — this spec captures WHAT the PoC does and for whom; the companion `plan.md` captures HOW.

> Product authority: `AI.Next - Google Folder 17 Jul 2026/AI Tutor/PRD/PRD-ai-tutor-mvp.md`.
> Engineering authority: `.specify/memory/constitution.md` v1.0.0 + ADR-0001..0006.
> This baseline spec supersedes neither; it consolidates them into testable requirements.

## Product Context

AI.Next sells an AI tutor for Egyptian secondary students directly to parents, positioned
as the affordable replacement for the private-tutoring subjects families had to cut.
Core loop: **diagnostic → adaptive daily practice → AI step-by-step explanation of every
mistake (grounded in human-approved canonical solutions) → weekly report to the parent.**
The PoC proves the loop end-to-end for prep-3 across three subjects — Mathematics
(English), Social Studies (Arabic), and Arabic Language (Arabic, with sealed sacred
texts) — on a live demo site behind Cloudflare Access.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — The after-school check-in and AI-led lesson (Priority: P1)

A student comes home from school, opens `/student`, picks who they are (demo profile),
picks a subject, and lands on today's lesson. If they understood nothing, they choose
«اشرحلي الدرس» and get a live, step-by-step AI lesson: short warm beats in Egyptian
Arabic (or English for math), one interactive ask per message (a tap widget, a live
question card, or a chat question), figures drawn inline, and — in Arabic literature
lessons — the sealed source text pinned at the top of the exchange with the tutor
highlighting the exact line it teaches. The session ends with an honest comprehension
report (score, verdict, strengths, gaps, next step).

**Why this priority**: this is the product — the pitch to parents is "a patient tutor
every afternoon". Everything else exists to feed or prove this loop.

**Independent Test**: open `/student?subject=arabic&lesson=ara2-1&mode=learn` as a fresh
demo student; complete the lesson to the report card. No other story required.

**Acceptance Scenarios**:

1. **Given** a fresh student on a lesson with sealed passages, **When** the session
   opens, **Then** the passages render first (from the verified store, with attestation
   for sacred text) before any tutor message, and the exchange starts scrolled to the top.
2. **Given** any tutor message, **When** it finishes streaming, **Then** it ends with
   something the student can act on (question, choice, widget, or question card) — never
   a bare statement or a pointer chip alone.
3. **Given** the tutor references the text, **When** it emits a span pointer, **Then**
   either an inline excerpt card (store bytes only) or a highlight in the pinned card
   appears — the model's own words are never rendered as passage text.
4. **Given** a student answers a live question card, **When** the answer is graded,
   **Then** grading is deterministic (server for questions, scripted slot-diff for
   إعراب), mastery updates transactionally, and the tutor's next beat reacts to the
   result.
5. **Given** the student taps «خلّص الدرس» or the arc completes, **When** the session
   ends, **Then** an understanding check is produced from the full transcript and stored.

---

### User Story 2 — Adaptive daily practice (Today's Plan) (Priority: P2)

A student who mostly followed the lesson chooses practice: the system assembles a short
plan from the curriculum graph weighted by their per-LO mastery, serves questions one at
a time, grades each attempt instantly, and on every mistake explains step-by-step from
the human-reviewed canonical solution — with citation receipts to the ministry book.

**Why this priority**: practice is the retention engine and the source of the mastery
signal that drives everything else; it must work but is reachable only after the lesson
surface exists.

**Independent Test**: `/student?mode=practice` — answer several questions including a
wrong answer; verify the explanation walks the canonical solution and mastery moves.

**Acceptance Scenarios**:

1. **Given** a wrong answer, **When** the result renders, **Then** the canonical
   solution steps are shown verbatim-faithful (never a fresh model solution) and an
   explanation row is logged.
2. **Given** repeated correct answers on an LO, **When** mastery updates (K = 0.15),
   **Then** the plan shifts toward weaker LOs; scores are never blended across subjects.

---

### User Story 3 — Ask the Spine (grounded Q&A everywhere) (Priority: P3)

On the graph explorer (`/spine`) and inside student surfaces, anyone can ask a free
question. The answer is assembled ONLY from the curriculum graph slice in scope (LOs,
edges, questions, canonical solutions), streams live with citation chips, and refuses
gracefully outside the book (acknowledge → decline → redirect). Cross-subject questions
get a warm handoff card, never a from-memory answer.

**Why this priority**: proves the grounding thesis interactively to investors and
parents; not on the student's critical path.

**Independent Test**: ask an in-book question (expect cited answer), an out-of-book
question (expect the redirect script), and a cross-subject question (expect the handoff).

**Acceptance Scenarios**:

1. **Given** any surface's chat, **When** the model's stream would contain a ≥4-word run
   of sealed sacred text, **Then** the stream is killed behind the holdback window, the
   student sees a redirect to the sealed card, and a redacted row is logged.
2. **Given** surface turn caps (student_chat 2, lesson_learn 14, lesson_review 5),
   **When** the cap is reached for THIS student, **Then** the server refuses further
   turns with a friendly cap message.

---

### User Story 4 — Demo student profiles and cold start (Priority: P4)

On the student home, a visible «👤» dropdown lets the demo audience pick who's studying
or create a new student («طالب جديد») in two seconds — then watch the cold-start
diagnostic story from zero. Hidden triple-tap variants exist on other surfaces. This is
a validated cookie, deliberately NOT auth (PRD §3), and every surface scopes sessions,
turn caps, and mastery to the selected student.

**Independent Test**: create a student, open a lesson, confirm zero-state; switch
students mid-flow and confirm no session or cap bleed-through.

**Acceptance Scenarios**:

1. **Given** a switched student, **When** the same lesson is reopened, **Then** the
   previous student's transcript never resumes (per-student session keys) and turn
   counts are per-student.

---

### User Story 5 — Investor/parent proof surfaces (Priority: P5)

`/` (overview with live stats), `/spine` (the Evidence Walk over the mastery-colored
graph), `/gallery` (every stored figure rendered live), `/pipeline` (the extraction
engine walk-through: source page → schema → human review → graph → one real grounded AI
turn). These pages tell the "every sentence from the ministry book, with receipts" story
without a login.

**Independent Test**: each page renders server-side from the live DB with no console
errors and no blended cross-subject scores.

---

### User Story 6 — Content operations without touching the box (Priority: P6)

Samuel refreshes curriculum content from the GitHub Actions tab: `status` (read-only),
`preview` (full rehearsal, rolled back), `course` (scoped subtree replace),
`full-reseed` (restore committed dump), `promote-poc` (bulk review→live, PoC only) —
each mutating mode demands a typed confirmation phrase, takes a pg_dump backup first,
and prints its one-line rollback. Code deploys (push to main) can never touch data.

**Independent Test**: run `preview` from Actions; verify before/after counts identical
and zero writes; run `status` and verify drift detection between image and checkout.

---

### Edge Cases

- Connection drop mid-lesson → session persists (sessionStorage, per student+mode+lesson)
  and offers «كمل من حيث وقفت» on return.
- Sacred passage whose authorities disagree → passage serves with «قيد المراجعة»
  attestation; hadith (no machine authority) always flagged for human review.
- `show_passage` with an id not in the lesson → visible failure line («النص ده مش متاح»),
  never a silent no-op; a quote that matches nothing highlights nothing (no invented text).
- Unknown `?subject=` → whole catalog, never silently the math course; lesson chips carry
  their subject so the picker never bounces a selection.
- CLI backend unavailable/timeout (90 s) → structured SSE error, cost row still logged.
- Malformed widget payload from the model → consumed silently, never rendered as raw
  protocol text; incomplete streaming directives held back from display.
- A student typing an answer while a question card is live → both paths grade and the
  tutor reacts to the latest `[live event]`.

## Requirements *(mandatory)*

### Functional Requirements

**Teaching core**
- **FR-001**: The system MUST serve an AI-led lesson (learn) and a 3-minute lock-it-in
  (review) per lesson, in the subject's registered voice, with per-message beat pacing
  and at most one interactive directive per message.
- **FR-002**: Every claim-bearing tutor statement MUST carry a citation receipt
  (`[[lo]]`/`[[q]]`/`[[page]]`) resolvable to graph provenance.
- **FR-003**: Mistake explanations MUST follow the human-reviewed canonical solution /
  model answer claim-steps exactly; final answers never change.
- **FR-004**: Out-of-book questions MUST get acknowledge → decline → redirect; the
  ungrounded answer must never be produced.
- **FR-005**: Lessons MUST end with a stored comprehension report (score 0–100, verdict,
  strengths, gaps, next step) derived from the full transcript.

**Sacred text (constitution IV)**
- **FR-010**: Sacred text MUST render only via the sealed-passage component from
  checksummed store bytes, with the dual-authority attestation line.
- **FR-011**: The runtime guard MUST scan every chat surface and fail closed on any
  ≥4-word LOOSE-folded run of sealed sacred text, behind a ≥96-char emission holdback.
- **FR-012**: The tutor MUST reference sacred text by آية number only; span pointers into
  sacred passages MUST use `unit` (printed mushaf or sequential number), never `quote`.
- **FR-013**: Passage span pointers MUST resolve against the verified store: excerpt
  cards and highlights render store bytes; unmatched pointers degrade to a plain
  refocus chip.

**Practice & grading**
- **FR-020**: Question attempts MUST grade deterministically server-side (numeric
  tolerance 1e-6, else normalized text compare) and update mastery transactionally
  (K = 0.15).
- **FR-021**: إعراب answers MUST grade client-side by scripted slot diff with partial
  credit and a computed diagnosis — no model call in the grading path.
- **FR-022**: Widgets MUST be tap-first (10 registered widget types), payload-validated,
  grounded in lesson data (gazetteer names, printed rule lines, verbatim glossary), and
  report results as `[live event]` lines the tutor must react to.

**Subjects & registry (constitution IX)**
- **FR-030**: All per-subject behavior (voice contract, prompt kit, widget catalog,
  direction, labels, accent) MUST live in the subject registry; adding a subject without
  authoring its contracts MUST fail loudly at build/runtime.
- **FR-031**: Cross-subject questions MUST produce a handoff card
  (`{{switch_subject}}`), never an inline answer; cross-subject links surface only as
  human-curated bridges, at most one gentle hint per lesson.

**Students & sessions**
- **FR-040**: Student identity is a server-validated demo cookie (NOT auth); every
  query, session key, turn cap, and spend meter MUST scope to the resolved student.
- **FR-041**: The student home MUST offer a visible profile picker with in-place
  creation (name 2–40 chars, grade pinned prep-3); lesson surfaces keep the hidden
  triple-tap variant.
- **FR-042**: Lesson sessions MUST survive reloads and connection drops
  (per-student+mode+lesson persistence with an explicit resume/restart choice).

**Cost & observability (constitution VI)**
- **FR-050**: Every AI call MUST log tokens, cost, latency, surface, and student to the
  `ai_interactions` ledger; lesson surfaces show a live session-spend meter in debug.
- **FR-051**: Server-enforced per-surface turn caps MUST bound spend per student.

**Ops (constitution X)**
- **FR-060**: Code deploys MUST flow: PR → main → self-hosted runner → build on box →
  health check; failed health checks leave the previous container serving.
- **FR-061**: Content mutations MUST flow through refresh-content modes with typed
  confirmation, automatic backup, printed rollback, and drift detection; the loader
  service is compose-profile-gated so a code deploy can never start it.
- **FR-062**: The ingest gate: `--approve-all` MUST refuse sacred bundles; new content
  enters at `review` status and reaches students only after promotion.

### Key Entities

- **Curriculum graph**: `graph_nodes` (course/module/lesson/LO/rule/passage… with
  subject stamp) + `graph_edges` (prerequisite, relates_to bridges) — the single source
  of teachable truth, every node carrying book provenance (page, snippet).
- **Question**: typed (mcq/numeric/irab/extract/lexical/rhetoric/spelling_fix…), with
  human-reviewed canonical solution / typed answer record, tier, status
  (review/live), and review attribution.
- **Sealed TextPassage**: kind (quran/hadith/prose/poetry), units (آيات/paragraphs) with
  printed numbers, `text_sha256` seal, verification verdict + authority diff, sacred flag.
- **Student**: display name, grade; owns attempts, per-LO mastery (bitemporal
  score history), understanding checks, ai_interactions rows.
- **Attempt / Mastery**: graded answer events driving the Elo-style per-LO score the
  plan assembler reads.
- **UnderstandingCheck**: end-of-lesson honest rating (mode, score, verdict, strengths,
  gaps, next step, turns).
- **AI interaction**: one ledger row per model call (surface, student, session, tokens,
  cost, latency, redaction flag).
- **Visual**: stored `{kind, spec}` figure (19 primitive kinds) attached to LOs,
  rendered by the parametric viz library, referenced by id from lessons.

## Success Criteria *(mandatory)*

### Measurable Outcomes

**Pilot (PRD)**
- **SC-001**: 50 paying families onboarded at launch (late September 2026).
- **SC-002**: ≥60% month-2 retention.
- **SC-003**: Measurable score lift on in-app diagnostics across the pilot cohort.

**Product/technical (as-built targets the PoC already demonstrates)**
- **SC-010**: A new demo student reaches a live AI lesson in under 30 seconds from the
  student home (pick/create profile → subject → lesson → streaming opening).
- **SC-011**: 100% of tutor claims carry resolvable citations; 0 ungrounded answers in
  release review sampling.
- **SC-012**: 0 sacred-text leaks: no ≥4-word sealed run ever reaches a client
  (guard verified by adversarial release review + audit sweep).
- **SC-013**: AI spend per student stays under the EGP 40/month ceiling at pilot usage
  patterns (ledger-verified; PoC telemetry in place from day one).
- **SC-014**: First load under 1.5 MB on the student surfaces (3G target).
- **SC-015**: Content coverage: all 69 lessons (math 33, social 16, Arabic 20) pickable
  and teachable; 1519/1519 questions servable post promote-poc.

## Assumptions

- The PoC runs behind Cloudflare Access for a known demo audience; public onboarding,
  payments, and parent WhatsApp reports are launch-scope, not PoC-scope (PRD §3 non-goals
  remain binding).
- Demo cookie identity is acceptable until the parent-owned phone+OTP account ships with
  the student PWA.
- The Claude subscription CLI backend (no API key on the box) remains the AI runtime for
  the PoC; per-call cost figures are estimates derived from token counts.
- The Egyptian ministry books (prep-3, 2025-2026 edition) are the sole curriculum truth;
  new editions re-enter through the extraction line and the review gate.
- Known debt is tracked, not hidden: ara2-3 lost sections pending re-run, ~30 uncovered
  printed drills, unit-opener pages, 4 flagged sacred passages awaiting the religious
  content owner, Wave C subject-blind footer copy, typed-answer parsing in
  `/api/attempts` (widgets grade client-side today).
