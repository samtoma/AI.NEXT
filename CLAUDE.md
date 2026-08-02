# AI.Next — AI Tutor PoC

## What this project is
AI.Next is a 3-founder edtech startup (founders: Samuel = CTO + solution architect, plus Sales and Product founders). This repo is the workspace for the **AI Tutor MVP ("Founding Families" pilot)**: a mobile-web AI tutor for Egyptian secondary students (grade 10 math, Arabic, new Bakaloreya curriculum), **sold directly to parents**, positioned as the affordable replacement for the tutoring subjects families had to cut.

Core loop: **Diagnostic → adaptive daily practice → AI step-by-step explanation of every mistake (grounded in human-approved canonical solutions) → weekly WhatsApp report to the parent.**

- PRD (product authority, approved): `AI.Next - Google Folder 17 Jul 2026/AI Tutor/PRD/PRD-ai-tutor-mvp.md`
- **Design authority (ADR-0001):** `agentic-data-thesis.html` — the Agent-Native Data Spine thesis. The solution architecture derives from it (Ch. 15 curriculum graphs, Ch. 16 bitemporal, Ch. 19 reference architectures + MVP-cut discipline). Derived architecture: `docs/architecture/spine-derived-architecture.md`.
- Brainstorm materials: `AI.Next - Google Folder 17 Jul 2026/` — **context only, never a source of tech/design decisions**
- Target launch: late September 2026 (start of Egyptian school year). Pilot success = 50 paying families, ≥60% month-2 retention, measurable score lift.

## Authority rules (important)
1. **Samuel is the solution architect.** Agents propose options with trade-offs; Samuel decides. Never lock in an architecture, stack, or design decision without his explicit confirmation. Confirmed decisions are recorded as ADRs in `docs/decisions/`.
2. The PRD is authoritative on **product scope** (what/why) only. Its §8 stack guidance is **discarded per ADR-0001**: the data-spine thesis is the design authority for solution architecture, applied at MVP-cut discipline (thesis Ch. 19.6 — don't build everything before shipping anything).
3. Nothing unreviewed reaches a student: every question and canonical solution passes a human review gate. LLM explanations must be grounded in canonical solutions, never solved from scratch.
4. Respect MVP non-goals (PRD §3): no ML infra, no native app, no chat-tutor surface, no parent dashboard, no WhatsApp API automation.

## Non-negotiable product constraints
- Arabic RTL throughout; math rendered correctly in RTL context (equations LTR inline, Egyptian textbook convention).
- Low-end Android + 3G first: first load < 1.5 MB, optimistic UI, session survives connection drops.
- AI cost ceiling: < EGP 40/student/month; instrument per-student token spend from day one.
- Minors' data: collect the minimum (name, grade, phone); parent owns the account.

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
- Requirements: GitHub Spec Kit — constitution in `.specify/memory/constitution.md` (v1.0.0), baseline as-built spec set in `specs/000-baseline/`; new features via `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` into `specs/NNN-slug/`.
- All student- and parent-facing copy is Arabic; internal docs and code are English.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
<!-- SPECKIT END -->
