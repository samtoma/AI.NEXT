# AI.Next — AI Tutor PoC

## What this project is
AI.Next is a 3-founder edtech startup (founders: Samuel = CTO + solution architect, plus Sales and Product founders). This repo is the workspace for an AI tutor for Egyptian secondary students, built on a curriculum graph extracted from ministry textbooks.

**As of 2026-09-08 the repo runs a two-environment comparison (ADR-0007).** Read `specs/001-student-mvp1-delta/decisions.md` before making product assumptions — this is the single most common source of stale context in this repo.

| | Baseline — **frozen** | Comparison — **active development** |
|---|---|---|
| Branch / URL | `main` → ainext.reletix.com | `mvp1` → ainext-mvp1.reletix.com |
| Product | Parent-sold, Arabic RTL, 3 subjects, Elo mastery | Student-facing, English LTR, Math only, BKT mastery |
| Authority | PRD v1.0 (below) | **PRD: AI Tutor — Student MVP v0.4** (Tamer Deif, Drive `1gUAF0IyHRBr47k7aqiPxe9q22CJy8A7JwVqI405bRnk`) |

Both serve the **identical** Prep-3 Mathematics book (10 modules, 90 LOs, 112 prerequisite edges, 450 questions, 212 visuals) — content is the held-constant variable, and `parity_check.py` fails loudly on drift. The baseline receives **no** teaching-behaviour changes while the comparison runs.

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
Constitution **v2.0.0** is authoritative; these summarise it.
- **Bilingual by construction.** English LTR is the MVP 1.0 default; direction must never be hard-coded, and no Arabic-capable surface may be removed to achieve it. Equations render LTR inline in any direction. (The frozen baseline stays Arabic RTL.)
- **Device target:** iPad Safari (last 2 majors) + modern desktop. The low-end Android/3G target and the 1.5 MB gate are withdrawn for MVP 1.0 — 1.5 MB is now a guideline.
- **Cost:** no numeric ceiling binds until PRD §10 sets a price (the EGP 40 figure came from a withdrawn parent price band). Per-student spend instrumentation and per-surface turn caps remain mandatory; upload/OCR cost is metered separately.
- **Minors' data:** minimum only — name, grade, interests. In the comparison build identity is a **picker, not auth**; it is validated server-side and must never be presented as a login.
- **Comparison integrity:** content parity enforced, every event and ledger row tagged by environment, metrics never pooled, baseline frozen.

## Where we stand
Always read `docs/PROJECT_STATE.md` at the start of a session — it is the living status document (current phase, what's done, what's next, open questions). Update it when meaningful progress is made or decisions land. ADRs live in `docs/decisions/`.

## The team (subagents in .claude/agents/)
Engineering: `ai-engineer`, `backend-engineer`, `frontend-engineer`, `data-engineer`, `qa-engineer`, `devops-engineer`
Design: `product-designer`, `design-system-lead`
Cross-cutting: `security-privacy-officer`, `tech-writer`

Skills (in `.claude/skills/`): `project-status` (read/update project state), `adr` (record an architecture decision), `write-spec` (feature spec from PRD scope).

## Conventions
- Specs in `docs/specs/`, ADRs in `docs/decisions/` (format: `NNNN-short-title.md`), status in `docs/PROJECT_STATE.md`. **Documentation map: `docs/README.md`.**
- Product code: the Next.js app in `app/`, the extraction pipeline in `services/extraction/`, deploy stack in `deploy/` (see ADR-0002/0003/0005).
- Requirements: GitHub Spec Kit — constitution in `.specify/memory/constitution.md` (**v2.0.0**), baseline as-built spec set in `specs/000-baseline/`, active feature in `specs/001-student-mvp1-delta/`; new features via `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` into `specs/NNN-slug/`.
- Student- and parent-facing copy is **English** for MVP 1.0 (constitution v2.0.0 Principle V); the Arabic verticals stay in the tree and reintroducible. Internal docs and code are English.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
**`specs/001-student-mvp1-delta/plan.md`** — Student MVP 1.0 comparison build
(spec, decisions, research, data-model and contracts sit beside it in the same directory).
<!-- SPECKIT END -->
