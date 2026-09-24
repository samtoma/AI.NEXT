# AI.Next — where everything lives

Start here. This repository is the single reference for what we are building,
why, what is proven, and what is next. If a decision is not written down here,
it is not decided.

Regenerated 2026-09-20. The counts in this file are produced by
`./scripts/traceability.py`, which fails CI when they drift — an earlier
hand-maintained version of this map spent six weeks naming a superseded PRD and
a constitution two major versions out of date.

## Start here, by what you need

| You want to… | Read |
|---|---|
| Know where the project stands today | [`PROJECT_STATE.md`](PROJECT_STATE.md) — living status, updated as work lands |
| Know what we promised to build | [`specs/001-student-mvp1-delta/spec.md`](../specs/001-student-mvp1-delta/spec.md) — 90 functional requirements + 6 success criteria |
| Know what is actually **proven** | [`specs/001-student-mvp1-delta/traceability.md`](../specs/001-student-mvp1-delta/traceability.md) — every requirement, its status, and the evidence |
| Know **why** something is built that way | [`decisions/`](decisions/) — ADR-0001…0016 |
| Give feedback or report a problem | [`FEEDBACK.md`](FEEDBACK.md) |
| See what is coming next | [`ROADMAP.md`](ROADMAP.md) |
| Run it on your machine | [`LOCAL-DEV.md`](LOCAL-DEV.md) |
| Hand the work to a new session | [`NEXT-SESSION.md`](NEXT-SESSION.md) |

## 0. The authorities, in order

Conflicts resolve top-down. Samuel's explicit decision beats everything;
brainstorm material in the Google folder is context and never an authority.

| Question | Authority | Where |
|---|---|---|
| WHAT we build & why (product scope) | **PRD: AI Tutor — Student MVP v0.4** (Tamer Deif) | Drive `1gUAF0IyHRBr47k7aqiPxe9q22CJy8A7JwVqI405bRnk` |
| HOW we build (engineering principles) | **Constitution v3.1.1** | [`.specify/memory/constitution.md`](../.specify/memory/constitution.md) |
| Design philosophy (data spine) | Thesis, adopted by ADR-0001 | [`agentic-data-thesis.html`](../agentic-data-thesis.html) |
| Which product is under change | **ADR-0010** — one branch per solution *(amends ADR-0007's delivery model; its product scope stands)* | [`decisions/0007-student-mvp1-comparison-build.md`](decisions/0007-student-mvp1-comparison-build.md) |
| How it looks (visual language) | **The published Noor Play design system** — binding on every surface we build under constitution **Principle XII**; two variants, selected by grade per **ADR-0011** and **ADR-0017** | <https://claude.ai/artifact/SXTAsvPUCjU4ZMp5oZtM6J> · source material in [`design/handoffs/noor-play/`](design/handoffs/noor-play/) |

The **superseded** PRD v1.0 (parent-sold, Arabic-RTL, three subjects) still
governs the frozen baseline on `family-tutor`, and nothing else:
`AI.Next - Google Folder 17 Jul 2026/AI Tutor/PRD/PRD-ai-tutor-mvp.md`.


## Giving feedback or proposing a requirement

You do not need to read code, run anything, or know what an FR is.

| You want to | Use | It asks you |
|---|---|---|
| Report something you saw | the `feedback` skill, or [New issue](https://github.com/samtoma/AI.NEXT/issues/new/choose) | **Which version** you saw it on |
| Say the product *should* do something | the `requirement` skill | **Which version** it should land in |

Both refuse to file until the version is settled — feedback with no version cannot
be reproduced, and a requirement with no target cannot be scheduled. Neither
changes the spec: triage does, and every issue leaves triage with exactly one
outcome written on it ([FEEDBACK.md](FEEDBACK.md)).

Current release: **`PDR1-0-v0.4.0`**. History: [`CHANGELOG.md`](../CHANGELOG.md); per-release explainers in [`releases/`](releases/).
Branching rules: [BRANCHING.md](BRANCHING.md). Versioning: [VERSIONING.md](VERSIONING.md).

## Two products, one repository

| | Baseline — **frozen** | Comparison — **active** |
|---|---|---|
| Branch | `main` | `mvp1` |
| Spec | [`specs/000-baseline/`](../specs/000-baseline/) (31 requirements, shipped) | [`specs/001-student-mvp1-delta/`](../specs/001-student-mvp1-delta/) (96, in flight) |
| Mastery | Elo | Bayesian Knowledge Tracing |
| Receives changes | **no teaching-behaviour changes** | yes |

Both serve the identical Prep-3 Mathematics book. `parity_check.py` fails
loudly on drift — that is SC-001, and it is the premise the whole comparison
rests on.

## 1. Requirements & specification (Spec Kit)

The Spec Kit baseline set — the full as-built requirements of the shipped product:

- [`specs/000-baseline/spec.md`](../specs/000-baseline/spec.md) — the as-built
  requirements of the shipped baseline (31). Frozen; reported by the
  traceability tool but never gated, because it is history rather than work.
- [`specs/001-student-mvp1-delta/`](../specs/001-student-mvp1-delta/) — **the
  shipped feature** (`PDR1-0-v0.4.0`): `spec.md` (what), `plan.md` (how),
  `tasks.md` (135 tasks), `traceability.md` (what is proven), `decisions.md`
  (open questions Samuel has answered).
- [`specs/002-identity-and-admin-console/`](../specs/002-identity-and-admin-console/) —
  **the active feature** (specced 2026-09-20, **implemented 2026-09-21** on
  `feat/002-identity-and-admin-console`; not merged, not deployed): `spec.md` (70 FRs,
  14 SCs), `plan.md`, `research.md` + `research/`, `data-model.md`,
  `contracts/`, [`quickstart.md`](../specs/002-identity-and-admin-console/quickstart.md)
  (one command, both surfaces),
  [`traceability.md`](../specs/002-identity-and-admin-console/traceability.md) (rev. 2 —
  62 verified, 2 built, 13 partial, 2 open, 1 blocked, 4 deferred),
  [`SETUP.md`](../specs/002-identity-and-admin-console/SETUP.md) — **the hand-off: what
  only Samuel can provide**, `decisions.md` (Samuel's D1–D11), and
  `constitution-amendment-proposal.md` — Principle VII, v3.1.1 → v3.2.0, **awaiting his
  approval**, which the voice and audit work now assumes.
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
| [0012](decisions/0012-per-student-isolation-rls.md) | Per-student isolation is enforced by the database (Postgres row-level security) |
| [0013](decisions/0013-student-accounts-and-sign-in.md) | Student-owned accounts, parent-linkable, with Reletix-pattern sign-in |
| [0014](decisions/0014-admin-console-second-build-target.md) | The admin console is a second build target of one codebase |
| [0015](decisions/0015-interaction-timeline-and-replay.md) | One interaction timeline per student per session, replayed by reconstruction |
| [0016](decisions/0016-analytics-and-monitoring-posture.md) | Analytics and monitoring: three layers, one system of record |
| [0017](decisions/0017-two-variants-keyed-to-grade.md) | Two design-system variants, selected at runtime and keyed to grade *(amends ADR-0011)* |
| [0018](decisions/0018-course-availability.md) | Who may see which course, decided in the console |
| [0019](decisions/0019-serve-the-whole-maths-bank.md) | Serve the whole maths bank on the open site — generated and unreviewed items live, review status in the console only *(constitution v3.2.0, drops FR-907)* |
| [0020](decisions/0020-mastery-gated-lesson-progression.md) | Mastery-gated lesson progression replaces the constant lesson on `/student` *(Tamer Deif; amended 2026-09-23: no backfill)* |
| [0021](decisions/0021-runtime-teaching-toggle-and-testers.md) | Socratic probing becomes a console switch — On at the next sitting, Off at the next message — for test accounts first; Everyone locked until #53; the `teaching-controls` role |
| [0022](decisions/0022-console-signin-from-cloudflare-access.md) | Console sign-in from the Cloudflare Access identity — the verified JWT, never the plain header; fails closed; password kept as the fallback; a triple-locked dev picker locally *(amends ADR-0014)* |

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
- [`specs/001-student-mvp1-delta/traceability.md`](../specs/001-student-mvp1-delta/traceability.md)
  — every functional requirement mapped to the code that implements it and the evidence that
  proves it. Deliberately harsher than `tasks.md`: code that exists but has never been executed
  counts as *built*, not *verified*.
- [`docs/reviews/`](reviews/) — dated build reviews written to be presented. Snapshots, never
  edited after the fact; the two documents above are the ones that stay current.
- [`docs/design/noor/`](design/noor/) — source artboards for the Noor design canvas, and the
  record of the Master-vs-Play variant decision (ADR-0011, amended by ADR-0017: both ship,
  selected by grade).

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
