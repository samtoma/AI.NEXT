<!--
Sync Impact Report
- Version change: (template) → 1.0.0
- Modified principles: n/a (initial ratification — template placeholders replaced)
- Added sections:
  - Core Principles I–X (codified from CLAUDE.md authority rules, PRD v-approved,
    ADR-0001..0006, docs/PROJECT_STATE.md — no new principles invented)
  - Additional Constraints (stack + product constants)
  - Development Workflow & Quality Gates
  - Governance
- Removed sections: none (template slots all filled)
- Templates requiring updates:
  - ✅ .specify/templates/plan-template.md — generic Constitution Check gate is
    compatible; no principle-specific edits required
  - ✅ .specify/templates/spec-template.md — compatible as-is
  - ✅ .specify/templates/tasks-template.md — compatible as-is
- Follow-up TODOs: none deferred
-->

# AI.Next Tutor PoC Constitution

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
a human-reviewed canonical solution, model answer, or printed rule line from
the ministry book, and claim-bearing statements carry citation receipts
(`[[lo:…]]` / `[[q:…]]` / `[[page:…]]`). For questions outside the book the
tutor MUST acknowledge → decline → redirect to the nearest in-book material —
the ungrounded answer must never be produced at all. The book's statement wins
even when the model believes the world disagrees.

### III. The Review Gate
Nothing unreviewed reaches a student: every question and canonical solution
passes a human review gate before serving. PoC exception (explicitly
authorized by Samuel, 2026-08-02): a one-time bulk `promote-poc` marked all
576 review-status questions live, attributed `samuel (poc bulk promote)`, with
a pg_dump backup and printed rollback. The gate machinery remains in place and
reactivates for all newly ingested content.

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

### V. Arabic-First, Low-End-First
The product is Arabic RTL throughout; equations render LTR inline per Egyptian
textbook convention. Targets are low-end Android on 3G: first load < 1.5 MB,
optimistic UI, sessions survive connection drops. All student- and
parent-facing copy is Arabic (Egyptian colloquial voice, one language contract
per subject in the registry); internal docs and code are English.

### VI. Cost Discipline
AI cost ceiling: < EGP 40 per student per month. Per-student token spend is
instrumented from day one (the `ai_interactions` ledger and the in-session
spend meter). Standing PoC call (Samuel, 2026-07-18): choose quality in
trade-offs, but the meters keep running — cost visibility is never optional.

### VII. Minors' Data Minimalism
Collect the minimum: name, grade, phone. The parent owns the account. Auth is
a PRD §3 non-goal for the MVP; the demo-student cookie is explicitly NOT auth,
is validated server-side against the students table on every request, and MUST
never be presented as a login.

### VIII. MVP Non-Goals Are Binding
Per PRD §3, the MVP ships without: ML infrastructure, a native app, a
free-form chat-tutor surface beyond the grounded lesson/ask flows, a parent
dashboard, or WhatsApp API automation. Scope creep into a non-goal requires a
PRD change, not an engineering decision.

### IX. Registry-Driven Subjects & Prompt-Freeze Discipline
Per-subject behavior (voice, widgets, prompts, grading) lives in the subject
registry (`app/src/lib/subjects.ts`) and per-subject prompt kits — never in
scattered `subject === "…"` conditionals. Any cross-subject refactor MUST
prove byte-identity of unchanged subjects' prompts with the capture harness
(`app/scripts/capture-prompts.mts`) before merging. Adding a subject must fail
loudly (compile error / thrown contract) until its voice and prompts are
deliberately authored.

### X. Operational Safety
Pushing `main` deploys to the live site (ainext.reletix.com) — merges to main
are deliberate acts. Database content mutations happen only through the manual
`refresh-content` workflow with typed confirmation phrases; every mutating run
takes a pg_dump backup first and prints its one-line rollback. On the box:
never `docker compose down -v` (it destroys the volume holding the one-time
Claude login). A normal code deploy can never touch data.

## Additional Constraints

- Stack (as decided in ADR-0002..0005): Next.js App Router PWA (`app/`),
  PostgreSQL curriculum graph (`graph_nodes` / `graph_edges` / `questions`),
  Python extraction pipeline (`services/extraction/`) orchestrated with Claude
  Workflows, OCI single-box deploy behind Cloudflare Access with a self-hosted
  GitHub runner.
- Curriculum truth is the Egyptian ministry book, ingested by the sealed
  extraction pipeline with a coverage oracle; the graph carries prerequisite
  edges and human-curated cross-subject bridges only.
- Target cohort and launch: Egyptian secondary students (current content:
  prep-3 math, social studies, Arabic), 50 founding families, launch late
  September 2026.

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

This constitution codifies practices already enforced by CLAUDE.md, the PRD,
and ADR-0001..0006; where documents conflict, the ADR chain and this
constitution win on engineering practice, the PRD wins on product scope, and
Samuel's explicit decision wins over both. Amendments: propose in a PR that
updates this file plus any dependent templates, state the semantic version
bump (MAJOR = principle removed/redefined, MINOR = principle added or
materially expanded, PATCH = clarification), and obtain Samuel's approval.
Exceptions (like the promote-poc gate bypass) MUST be time-boxed, attributed,
reversible, and recorded here or in an ADR.

**Version**: 1.0.0 | **Ratified**: 2026-08-02 | **Last Amended**: 2026-08-02
