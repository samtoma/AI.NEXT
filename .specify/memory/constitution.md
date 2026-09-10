<!--
Sync Impact Report
- Version change: 2.0.0 → 2.1.0 (MINOR — Principle III's standing exception
  widened to generated questions, with a sampling obligation attached; no
  principle redefined or removed)
- Previous: 1.0.0 → 2.0.0 (MAJOR — four principles redefined, one added)
- Amended by: Samuel (CTO, solution architect), 2026-09-10 — "I am ok to add
  unreviewed content by math, I will review 10% of the questions you generate"
  (ADR-0008). The tier coverage that prompted it: 5 of 90 objectives had no
  advanced question at all and 52 had exactly one, while BKT reaches the
  advanced tier three times faster than the Elo model it replaced.
- Ratified by: Samuel (CTO, solution architect), 2026-09-08, on adopting
  `PRD: AI Tutor — Student MVP` v0.4 (Tamer Deif) as the product authority
- Modified principles:
  - III The Review Gate → "The Review Gate (Suspended for the Comparison PoC)" —
    the gate remains the standard; it is explicitly suspended for pipeline-generated
    explanation content in the comparison environment only, under stated containment
  - V Arabic-First, Low-End-First → "Bilingual by Construction, English-First for
    MVP 1.0" — English LTR default, direction never hard-coded, device target moves
    to iPad Safari + modern desktop
  - VI Cost Discipline → ceiling detached from the withdrawn EGP 250–400 parent
    pricing; instrumentation stays non-negotiable, the number returns with pricing
  - VII Minors' Data Minimalism → account ownership moves to the student per the new
    PRD; minimalism and "the picker is not auth" both retained
  - VIII MVP Non-Goals → non-goal list replaced with the new PRD §14 list; the
    parent dashboard, mastery modelling and ask-anything are no longer non-goals
- Added sections:
  - XI Comparison Integrity (new principle — content parity, environment tagging,
    a genuinely frozen baseline)
- Unchanged: I Architecture Authority, II Grounded Teaching Only, IV Sacred Text
  Containment, IX Registry-Driven Subjects, X Operational Safety (extended to two
  environments)
- Templates requiring updates:
  - ✅ .specify/templates/plan-template.md — generic Constitution Check gate remains
    compatible
  - ✅ .specify/templates/spec-template.md — compatible as-is
  - ✅ .specify/templates/tasks-template.md — compatible as-is
- Follow-up TODOs:
  - Principle III's suspension is reversible and MUST be revisited before any
    audience wider than the invited pilot cohort
  - Principle VI's numeric ceiling MUST be restored once the PRD §10 price point lands
-->

# AI.Next Tutor Constitution

## Core Principles

### I. Architecture Authority (Samuel Decides)
Samuel (CTO, solution architect) decides every architecture, stack, and design
question. Agents and contributors MUST propose options with trade-offs and MUST
NOT lock in a decision without his explicit confirmation. Confirmed decisions
are recorded as ADRs in `docs/decisions/` (`NNNN-short-title.md`). The
Agent-Native Data Spine thesis (`agentic-data-thesis.html`, adopted by
ADR-0001) is the design authority for solution architecture, applied at
MVP-cut discipline (thesis Ch. 19.6: don't build everything before shipping
anything). The PRD is authoritative on product scope (what/why) only; its
stack guidance is discarded per ADR-0001.

### II. Grounded Teaching Only
The AI tutor never solves from scratch. Every explanation MUST be grounded in
a canonical solution, model answer, printed rule line, or library entry
retrieved from the store — never produced from the model's own memory — and
claim-bearing statements carry citation receipts (`[[lo:…]]` / `[[q:…]]` /
`[[page:…]]`). For questions outside the book the tutor MUST acknowledge →
decline → redirect to the nearest in-book material; the ungrounded answer must
never be produced at all. The book's statement wins even when the model
believes the world disagrees. The new PRD strengthens this principle rather
than weakening it: retrieval happens before the model is called, never after.

### III. The Review Gate (Suspended for the Comparison PoC)
The standard remains: nothing unreviewed reaches a student, and the gate
machinery — review status, promotion, attribution — stays in place and
enforced by default.

**Standing exception, authorized by Samuel 2026-09-08 (ADR-0007):** for the
comparison environment only, pipeline-generated explanation and refutation
content ships without human review, because no reviewer exists at this stage.
This exception is bounded and MUST remain so:
- it applies ONLY to the comparison environment, never to `ainext.reletix.com`;
- that environment stays behind Cloudflare Access with an explicitly invited
  audience, so unreviewed content never reaches an uninvited person;
- every generated entry MUST be stored attributed and flagged unreviewed, so
  what was never gated is always answerable from the data;
- it is reversible: promoting the environment to any wider audience requires
  reinstating the gate first.

**Extended, authorized by Samuel 2026-09-10 (ADR-0008):** the exception now
also covers **pipeline-generated questions and their canonical solutions**, on
the same bounded terms, plus two additional ones that the larger blast radius
requires:

- **A 10% human sample, drawn reproducibly.** Samuel reviews a random sample of
  every generated bundle rather than the whole bank. The sample is drawn by the
  loader from a recorded seed and written to a review queue, so its size and
  membership are auditable rather than asserted.
- **Every generated item names the reviewed item it derives from**
  (`parent_question_id`), so a defect found in the sample can be traced to the
  family it came from and that family retired as a unit.

The bounding conditions above hold unchanged and are load-bearing here: the
comparison environment only, behind Access, attributed, flagged unreviewed,
reversible. The loader enforces the first of those in code and refuses to run
against any environment that is not `mvp1`.

**What this exception costs, stated plainly so it is never mistaken for free.**
An unreviewed explanation is wrong *about* a question a human approved; an
unreviewed question can be wrong *in itself* — a broken stem, an answer key
that disagrees with its own solution, a distractor that is also correct. A
student who trusts the product then practises an error and is marked wrong for
being right. The 10% sample reduces that risk; it does not remove it. Nothing
in this exception permits generated content on `ainext.reletix.com`, and
promoting the comparison environment to any wider audience still requires
reinstating the full gate first.

### IV. Sacred Text Containment (NON-NEGOTIABLE)
Quran and Hadith text reaches a student surface ONLY from the sealed,
checksummed verified store: fetched by citation from two independent
authorities and cross-verified; any mismatch is a FLAG for a human religious
content owner — never a silent fix, never a block that hides the text's
status. The model never types scripture — not in prose, not in any widget or
directive payload; it points by آية number. A runtime output guard
(`lib/sacred-guard.ts`) scans every chat surface and fails closed (kills the
stream behind a holdback window) on any ≥4-word run of sealed sacred text.
Sacred bundles are never bulk-approved (`--approve-all` refuses them).
This principle is dormant in a mathematics-only environment but is never
weakened, and reactivates in full the moment Arabic content is served.

### V. Bilingual by Construction, English-First for MVP 1.0
The product is bilingual by construction, not by retrofit. For MVP 1.0 the
delivery language is **English, rendered LTR**, per the new PRD. Direction and
language MUST remain switchable at the layout level: no page-level direction
may be hard-coded, and no Arabic-capable surface may be removed to achieve the
English default. Mathematics instruction was already delivered in English; what
changes is chrome, navigation and copy. Equations render LTR inline in any
direction, per Egyptian textbook convention. Device targets are iPad Safari
(last two major versions) and modern desktop browsers; the low-end Android and
3G targets of v1.0 are withdrawn, and the < 1.5 MB first-load budget becomes a
guideline rather than a gate. The Arabic and Social Studies verticals already
built remain first-class and reintroducible.

### VI. Cost Discipline
Per-student token spend MUST be instrumented from day one — the
`ai_interactions` ledger, the in-session spend meter, and per-environment
attribution — and cost visibility is never optional. The v1.0 ceiling of EGP 40
per student per month was derived from a parent-pays price band the new PRD
withdraws; no numeric ceiling binds until PRD §10 sets a price point, at which
point one MUST be restored here. Until then: uploads, OCR and ask-anything add
unbudgeted per-student cost, and the server-enforced per-surface turn caps
remain the operative bound on worst-case spend.

### VII. Minors' Data Minimalism
Collect the minimum: name, grade, and the interest signals the tutor actually
uses. Per the new PRD the student owns the account, with the parent as a linked
view rather than the account holder; a parent contact SHOULD still be captured
for every student as the working default until legal review says otherwise
(PRD §9). Where identity is a picker rather than an account — as in the
comparison PoC — it is explicitly NOT auth, MUST be validated server-side on
every request, and MUST never be presented to a user as a login. Student
conversations are never exposed to other students, and what a parent sees is
limited to performance data, never transcripts.

### VIII. MVP Non-Goals Are Binding
Per the new PRD §14, MVP 1.0 ships without: teacher tooling and classroom
features, content-authoring/rubric tools, voice or video tutoring, gamification
(leaderboards, streaks), multi-child parent accounts, native phone or tablet
apps, full WCAG compliance (baseline accessibility only), non-card payment
methods, and the Arabic and Social Studies subjects (deferred, not deleted).
For the comparison build specifically, trial and payments (PRD Epic G) are also
out of scope. Scope creep into a non-goal requires a PRD change, not an
engineering decision. Note what is no longer a non-goal: the parent dashboard,
per-skill mastery modelling, and a free-form ask-anything surface are all now
in scope.

### IX. Registry-Driven Subjects & Prompt-Freeze Discipline
Per-subject behavior (voice, widgets, prompts, grading) lives in the subject
registry (`app/src/lib/subjects.ts`) and per-subject prompt kits — never in
scattered `subject === "…"` conditionals. Any cross-subject refactor MUST
prove byte-identity of unchanged subjects' prompts with the capture harness
(`app/scripts/capture-prompts.mts`) before merging. Adding a subject must fail
loudly (compile error / thrown contract) until its voice and prompts are
deliberately authored.

### X. Operational Safety
Pushing `main` deploys to the live site — merges to main are deliberate acts.
Database content mutations happen only through the manual `refresh-content`
workflow with typed confirmation phrases; every mutating run takes a pg_dump
backup first and prints its one-line rollback. On the box: never
`docker compose down -v` (it destroys the volume holding the one-time Claude
login). A normal code deploy can never touch data. With two environments
co-tenant on one box, every operation MUST name its target environment
explicitly, and an operation against one MUST NOT restart, redeploy or mutate
the other.

### XI. Comparison Integrity
While a comparison is running, its validity is a first-class engineering
constraint:
- **Content parity.** Both environments serve the identical curriculum set —
  same source document, same counts of modules, learning objectives,
  prerequisite edges, questions and visuals — verified by an automated check
  that fails loudly on drift.
- **Environment attribution.** Every analytics event, ledger row and cost
  record identifies which environment produced it. Metrics are never pooled
  across environments.
- **A frozen baseline stays frozen.** The environment being compared against
  receives no teaching-behaviour changes for the duration. The one permitted
  change is metric instrumentation, which MUST be provably behaviour-neutral.
- **Student data does not cross environments.** Each owns its own students and
  mastery history.

## Additional Constraints

- Stack (ADR-0002..0005): Next.js App Router app (`app/`), PostgreSQL
  curriculum graph (`graph_nodes` / `graph_edges` / `questions`), Python
  extraction pipeline (`services/extraction/`) orchestrated with Claude
  Workflows, OCI single-box deploy behind Cloudflare Access with a self-hosted
  GitHub runner — now hosting two isolated stacks side by side.
- Curriculum truth is the Egyptian ministry book, ingested by the sealed
  extraction pipeline with a coverage oracle; the graph carries prerequisite
  edges and human-curated cross-subject bridges only.
- Comparison constant: Prep-3 Mathematics (English), 2025-2026 ministry
  edition — 10 modules, 90 learning objectives, 112 prerequisite edges, 450
  questions, 212 visuals.
- Target cohort: 10–20 invited pilot students behind Cloudflare Access.

## Development Workflow & Quality Gates

- Read `docs/PROJECT_STATE.md` at session start; update it when meaningful
  progress lands. Specs live in `docs/specs/`, ADRs in `docs/decisions/`,
  Spec Kit artifacts in `.specify/` and `specs/`.
- Changes reach main by PR; merges deploy. Substantial changes get a
  multi-agent review (find → adversarially verify) before merge; release
  blockers are fixed, not waived.
- Quality gates for app changes: `tsc --noEmit`, unit tests, production
  build, and — when prompts are touched — the byte-identity capture. Pipeline
  changes keep `selfcheck_arabic.py` at 100% and the deterministic audit
  (`audit_arabic.py`) green.
- Live verification is part of done: student-visible changes are exercised in
  the browser (or on the live site after deploy), not assumed.

## Governance

This constitution codifies practices enforced by CLAUDE.md, the PRD, and the
ADR chain; where documents conflict, the ADR chain and this constitution win on
engineering practice, the PRD wins on product scope, and Samuel's explicit
decision wins over both. Amendments: propose in a PR that updates this file
plus any dependent templates, state the semantic version bump (MAJOR =
principle removed/redefined, MINOR = principle added or materially expanded,
PATCH = clarification), and obtain Samuel's approval. Exceptions MUST be
time-boxed or condition-boxed, attributed, reversible, and recorded here or in
an ADR — Principle III's suspension is the current example.

**Version**: 2.1.0 | **Ratified**: 2026-08-02 | **Last Amended**: 2026-09-10
