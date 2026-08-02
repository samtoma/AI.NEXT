# AI.Next Tutor PoC — Documentation Map (A → Z)

Start here. Every document in this project, what it governs, and where it lives.
Last regenerated: 2026-08-02 (main `d6db088`, Spec Kit baseline).

## 0. The three authorities

| Question | Authority | Where |
|---|---|---|
| WHAT we build & why (product scope) | PRD | `AI.Next - Google Folder 17 Jul 2026/AI Tutor/PRD/PRD-ai-tutor-mvp.md` |
| HOW we build (engineering principles) | Constitution v1.0.0 | [`.specify/memory/constitution.md`](../.specify/memory/constitution.md) |
| Design philosophy (data spine) | Thesis (ADR-0001) | [`agentic-data-thesis.html`](../agentic-data-thesis.html) |

Conflicts resolve: Samuel's explicit decision > constitution/ADRs (engineering) >
PRD (product scope). Brainstorm materials in the Google folder are context only.

## 1. Requirements & specification (Spec Kit)

The Spec Kit baseline set — the full as-built requirements of the shipped product:

- [`specs/000-baseline/spec.md`](../specs/000-baseline/spec.md) — user stories,
  functional requirements (FR-001…FR-062), key entities, success criteria.
- [`specs/000-baseline/plan.md`](../specs/000-baseline/plan.md) — as-built
  architecture, constitution check, runtime/content flows, deployment topology.
- [`specs/000-baseline/data-model.md`](../specs/000-baseline/data-model.md) —
  Postgres schema, pydantic ingest contracts, content bundle shapes, id conventions.
- [`specs/000-baseline/contracts/api.md`](../specs/000-baseline/contracts/api.md) —
  the six API routes with request/response shapes and invariants.
- [`specs/000-baseline/contracts/chat-protocol.md`](../specs/000-baseline/contracts/chat-protocol.md)
  — citations, directives, widgets, sealed-passage pointers, sacred rules.
- [`specs/000-baseline/quickstart.md`](../specs/000-baseline/quickstart.md) —
  run/ship/extract in 5 minutes.

New features: run `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` — each
feature gets its own `specs/NNN-slug/` set, checked against the constitution.

## 2. Decisions (ADRs — `docs/decisions/`)

| ADR | Decision |
|---|---|
| [0001](decisions/0001-architecture-follows-data-spine-thesis.md) | Architecture follows the Agent-Native Data Spine thesis (PRD §8 stack discarded) |
| [0002](decisions/0002-ai-runtime-and-app-layer.md) | Claude as AI runtime; Next.js App Router app layer |
| [0003](decisions/0003-graph-store-postgres-plus-demo.md) | Postgres as the graph store; demo layer first-class |
| [0004](decisions/0004-social-studies-vertical.md) | Social Studies vertical (Wave-0: voice, grounding, sensitive content) |
| [0005](decisions/0005-extraction-pipeline.md) | The extraction line: agentic, coverage-audited book ingest |
| [0006](decisions/0006-arabic-language-vertical.md) | Arabic vertical: sealed texts, typed answers, containment |

## 3. Architecture (`docs/architecture/`)

- [system-design.md](architecture/system-design.md) — the system design overview.
- [system-design-deep-dive.md](architecture/system-design-deep-dive.md) — grounded /
  interpretable / replayable spine, in depth.
- [spine-derived-architecture.md](architecture/spine-derived-architecture.md) — how the
  architecture derives from the thesis.
- [graph-store-comparison.md](architecture/graph-store-comparison.md) — the ADR-0003
  evaluation record.

## 4. Feature & vertical specs (`docs/specs/`)

**Arabic vertical**: [proposal](specs/proposal-arabic-vertical.md) ·
[scout](specs/arabic-scout.md) · [extraction contract](specs/arabic-extraction-contract.md) ·
[verification](specs/arabic-verification.md) · [sensitive content](specs/arabic-sensitive-content.md) ·
[student experience](specs/arabic-student-experience.md) · [viz & widgets](specs/arabic-viz-widgets.md)

**Social Studies vertical**: [proposal](specs/proposal-social-studies.md) ·
[scout](specs/social-studies-scout.md) · [extraction contract](specs/social-extraction-contract.md) ·
[AI pipeline demands](specs/social-studies-ai-pipeline.md) ·
[interactions](specs/social-studies-interactions.md)

**Cross-cutting**: [extraction pipeline](specs/extraction-pipeline.md) ·
[multi-subject spine](specs/multi-subject-spine.md) ·
[multi-subject app](specs/multi-subject-app.md) ·
[rich content full-book](specs/rich-content-fullbook.md) ·
[tutor experience v2](specs/tutor-experience-v2.md)

## 5. Operations (`deploy/`)

- [`deploy/DEPLOY.md`](../deploy/DEPLOY.md) — box runbook: bootstrap, Cloudflare,
  safety rails, rollback, content refresh, gotchas.
- [`deploy/CICD.md`](../deploy/CICD.md) — why code and data are separate pipelines;
  runner setup; image hygiene.
- Workflows: `.github/workflows/ci-cd.yml` (push-to-main deploy),
  `.github/workflows/refresh-content.yml` (manual content modes with typed guards).

## 6. Living status

- [`docs/PROJECT_STATE.md`](PROJECT_STATE.md) — read at every session start; current
  phase, what's done, what's next, open questions, known debt.
- Findings register from the full-book review:
  `services/extraction/runbook/ar-review-report.md`.

## 7. Source material

- Ministry textbooks (gitignored): `docs/Source/*.pdf` (Math EN, Social AR, Arabic AR —
  prep-3, 2025-2026).
- Book manifest + page-offset maps: `services/extraction/manifest/`.
- Sealed offline Quran reference: `services/extraction/verify/ref-quran-25-63-70.json`.

## 8. Team & tooling

- Role agents: `.claude/agents/` (ai/backend/frontend/data/qa/devops engineers,
  product designer, design-system lead, security-privacy officer, tech writer).
- Skills: `adr`, `project-status`, `write-spec`, plus the `speckit-*` set
  (constitution/specify/plan/tasks/implement/clarify/analyze/checklist).
- Visual contract shared by pipeline and app: `services/extraction/VIZ_SPEC.md`.
