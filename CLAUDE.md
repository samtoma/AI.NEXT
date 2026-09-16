# AI.Next — AI Tutor PoC

## What this project is
AI.Next is a 3-founder edtech startup (founders: Samuel = CTO + solution architect, plus Sales and Product founders). This repo is the workspace for an AI tutor for Egyptian secondary students, built on a curriculum graph extracted from ministry textbooks.

**As of 2026-09-13 the repo holds two solutions, one long-lived branch each (ADR-0010).** Neither is an environment of the other. Read `specs/001-student-mvp1-delta/decisions.md` and `docs/decisions/0010-one-branch-per-solution.md` before making product assumptions — this is the single most common source of stale context in this repo.

| | `family-tutor` — **frozen baseline** | `PDR1-0` — **active development** |
|---|---|---|
| Product | Parent-sold, Arabic RTL, 3 subjects, Elo mastery | Student-facing, English LTR, Math only, BKT mastery |
| Authority | PRD v1.0 (below) | **PRD: AI Tutor — Student MVP v0.4** (Tamer Deif, Drive `1gUAF0IyHRBr47k7aqiPxe9q22CJy8A7JwVqI405bRnk`) |
| Deploys to | ainext.reletix.com — **still served from `main` until T137 repoints it** | not yet deployed (Phase 3) |

`main` remains the default branch and the one CI currently deploys; `family-tutor` was branched from it and is identical. Retiring `main` is a production change and is deliberately not done — see ADR-0010 Open.

Both solutions today serve the same Prep-3 Mathematics book (10 modules, 90 LOs, 112 prerequisite edges, 450 questions, 212 visuals), and `parity_check.py` fails loudly if a solution drifts from the set it is meant to serve. **This is a per-solution drift guard, not a cross-solution contract:** the ADR-0010 Clarification withdrew content parity between solutions, so `PDR1-0` and `family-tutor` may diverge completely — different content, curriculum or subjects — without that being a defect.

⚠️ **Work in flight**: `docs/WIP-branch-per-solution.md` is the resume doc for the branch-per-solution refactor. Read it before touching phases 1, 3, 10 or 12.

- Superseded PRD (still the authority for the frozen baseline): `AI.Next - Google Folder 17 Jul 2026/AI Tutor/PRD/PRD-ai-tutor-mvp.md`
- **Design authority (ADR-0001):** `agentic-data-thesis.html` — the Agent-Native Data Spine thesis. The solution architecture derives from it (Ch. 15 curriculum graphs, Ch. 16 bitemporal, Ch. 19 reference architectures + MVP-cut discipline). Derived architecture: `docs/architecture/spine-derived-architecture.md`.
- Brainstorm materials: `AI.Next - Google Folder 17 Jul 2026/` — **context only, never a source of tech/design decisions**
- Target launch: late September 2026 (start of Egyptian school year). Pilot success = 50 paying families, ≥60% month-2 retention, measurable score lift.

## Authority rules (important)
1. **Samuel is the solution architect.** Agents propose options with trade-offs; Samuel decides. Never lock in an architecture, stack, or design decision without his explicit confirmation. Confirmed decisions are recorded as ADRs in `docs/decisions/`.
2. The PRD is authoritative on **product scope** (what/why) only. Its §8 stack guidance is **discarded per ADR-0001**: the data-spine thesis is the design authority for solution architecture, applied at MVP-cut discipline (thesis Ch. 19.6 — don't build everything before shipping anything).
3. **Grounded teaching always.** LLM explanations must come from stored canonical solutions or library entries, never solved from scratch. The human review gate still governs questions and canonical solutions. **Exception (ADR-0007, constitution III):** pipeline-generated explanation/refutation content ships unreviewed **in the comparison environment only**, flagged `reviewed=false`, bounded by Cloudflare Access. Never on the baseline.
4. Respect the MVP non-goals in the **new** PRD §14: no teacher tooling, no voice/video, no gamification, no native app, no non-card payments, Arabic and Social Studies deferred. Payments are out of this build too. Note what is **no longer** a non-goal: parent dashboard, mastery modelling, ask-anything.

## Non-negotiable product constraints
Constitution **v3.0.0** is authoritative; these summarise it.
- **Bilingual by construction.** English LTR is the MVP 1.0 default; direction must never be hard-coded, and no Arabic-capable surface may be removed to achieve it. Equations render LTR inline in any direction. (The frozen baseline stays Arabic RTL.)
- **Device target:** iPad Safari (last 2 majors) + modern desktop. The low-end Android/3G target and the 1.5 MB gate are withdrawn for MVP 1.0 — 1.5 MB is now a guideline.
- **Cost:** no numeric ceiling binds until PRD §10 sets a price (the EGP 40 figure came from a withdrawn parent price band). Per-student spend instrumentation and per-surface turn caps remain mandatory; upload/OCR cost is metered separately.
- **Minors' data:** minimum only — name, grade, interests. In the comparison build identity is a **picker, not auth**; it is validated server-side and must never be presented as a login.
- **Solution integrity** (constitution v3.0.0 Principle XI, re-cut by ADR-0010): a solution must not silently drift from the content set it is meant to serve (`parity_check.py`, a per-solution drift guard); every event and ledger row is tagged by environment and metrics are never pooled across environments or solutions; student data never crosses solutions. **Withdrawn:** cross-solution content parity and the frozen-baseline obligation — the two solutions may diverge completely, and the comparison is an observational judgement from live usage, not a system property.

## Where we stand
Always read `docs/PROJECT_STATE.md` at the start of a session — it is the living status document (current phase, what's done, what's next, open questions). Update it when meaningful progress is made or decisions land. ADRs live in `docs/decisions/`.

## The team (subagents in .claude/agents/)
Engineering: `ai-engineer`, `backend-engineer`, `frontend-engineer`, `data-engineer`, `qa-engineer`, `devops-engineer`
Design: `product-designer`, `design-system-lead`
Cross-cutting: `security-privacy-officer`, `tech-writer`

Skills (in `.claude/skills/`): `project-status` (read/update project state), `adr` (record an architecture decision), `write-spec` (feature spec from PRD scope).

**For the founders — no code knowledge needed:** `feedback` (file feedback on a version) and `requirement` (propose a new requirement or change one, targeted at a version). Both refuse to proceed until the version is established, because feedback with no version cannot be reproduced and a requirement with no target cannot be scheduled. Neither writes to the spec — triage does that (`docs/FEEDBACK.md`).

## Conventions
- Specs in `docs/specs/`, ADRs in `docs/decisions/` (format: `NNNN-short-title.md`), status in `docs/PROJECT_STATE.md`. **Documentation map: `docs/README.md`.**
- Branching: `docs/BRANCHING.md` — one branch per solution; feedback and requirement *proposals* never get a branch, accepted requirements get `req/<id>-<slug>`. Versioning: `docs/VERSIONING.md`. Current release: **`PDR1-0-v0.2.0`**.
- Product code: the Next.js app in `app/`, the extraction pipeline in `services/extraction/`, deploy stack in `deploy/` (see ADR-0002/0003/0005).
- Requirements: GitHub Spec Kit — constitution in `.specify/memory/constitution.md` (**v3.0.0**), baseline as-built spec set in `specs/000-baseline/`, active feature in `specs/001-student-mvp1-delta/`; new features via `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` into `specs/NNN-slug/`.
- Student- and parent-facing copy is **English** for MVP 1.0 (constitution v3.0.0 Principle V); the Arabic verticals stay in the tree and reintroducible. Internal docs and code are English.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
**`specs/001-student-mvp1-delta/plan.md`** — Student MVP 1.0 comparison build
(spec, decisions, research, data-model and contracts sit beside it in the same directory).
<!-- SPECKIT END -->
