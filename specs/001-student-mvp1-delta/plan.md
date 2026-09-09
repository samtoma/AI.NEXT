# Implementation Plan: Student MVP 1.0 — Comparison Build

**Feature**: `001-student-mvp1-delta` | **Date**: 2026-09-08 | **Spec**: [spec.md](./spec.md)
**Decisions**: [decisions.md](./decisions.md) · **ADR**: [ADR-0007](../../docs/decisions/0007-student-mvp1-comparison-build.md)
**Constitution**: v2.0.0

## Summary

Stand up a **second, isolated environment** on the existing OCI box that serves the *same* Prep-3
Mathematics curriculum as `ainext.reletix.com` but implements the new PRD's student experience, so
the two can be compared on the PRD's own conversion metric with real pilot students.

The technical core is four changes to the teaching loop — **BKT replacing the Elo mastery update**,
an **explicit retrieval layer** where grounding is currently assembled ad hoc per surface, a
**generated misconception/refutation library** as first-class content, and **uploads with OCR** — plus
an English app shell, a per-topic dashboard, a parent view, and an analytics event layer that both
environments emit.

Three findings from reading the codebase materially shrink this work:

1. **BKT fits the existing storage.** `mastery.score` is already a bitemporal `REAL` in 0..1 with
   row-closing semantics, and the current Elo update (`new = old + K·(outcome − old)`, K=0.15, prior
   0.3) is an exponential moving average over exactly the evidence BKT consumes. We keep the table and
   the bitemporal pattern, add parameter and evidence columns, and swap the update function.
2. **The direction seam already exists.** `lib/subjects.ts` carries `dir` per subject and mathematics
   is already `dir: "ltr"` — maths is already taught in English. Principle V's "never hard-code
   direction" is satisfied by using the registry, not by new machinery.
3. **The prompt byte-identity harness can prove the baseline stays a baseline.**
   `app/scripts/capture-prompts.mts` already renders every surface's prompts and diffs them. It is
   exactly the tool needed to prove FR-908's instrumentation of the baseline is behaviour-neutral.

## Technical Context

**Language/Version**: TypeScript (Next.js 16 App Router, React 19, strict `tsc`) · Python ≥3.12 (pydantic v2, psycopg3)
**Primary Dependencies**: `pg`, `katex`, Tailwind v4 · `pydantic`, `psycopg[binary]` · Claude CLI (subscription, no API key) as AI runtime · Claude Workflows as pipeline orchestrator
**Storage**: PostgreSQL 17 per environment (separate volumes) + on-disk lesson content JSONs + a new uploads volume
**Testing**: `node --test` unit tests · prompt byte-identity capture · a new BKT property/unit suite · a new content-parity check
**Target Platform**: iPad Safari (last 2 majors) + modern desktop browsers; server on the shared OCI box
**Project Type**: web app + data pipeline monorepo (`app/` standalone, `services/extraction/` pipeline)
**Performance Goals**: streaming first token within a few seconds (PRD §6 — a target to tune, not a guarantee)
**Constraints**: content parity with the baseline; no `down -v` on the shared box; Cloudflare Access on both; cost instrumented per environment
**Scale/Scope**: 10–20 invited pilot families, one subject, 90 LOs, 450 questions

## Constitution Check (v2.0.0)

*GATE: evaluated before Phase 0 and re-checked after Phase 1 design.*

| Principle | How this plan satisfies it | Status |
|---|---|---|
| **I** Architecture Authority | Every choice below is a proposal with alternatives in `research.md`; ADR-0007 records what Samuel already decided. Nothing is locked without him. | ✅ |
| **II** Grounded Teaching | The retrieval layer *strengthens* this: grounding becomes one auditable composition step (`lib/retrieval.ts`) instead of per-surface assembly. Library entries are retrieved, never improvised at request time. | ✅ |
| **III** Review Gate (suspended) | Suspension applies **only** to generated explanation-library rows, only in this environment. Questions and canonical solutions keep the `status` lifecycle. Every generated row carries `reviewed=false` + generator attribution, and is countable. | ⚠️ by ADR-0007 |
| **IV** Sacred Containment | Dormant — no Arabic content in this environment. The guard stays compiled in and stays live on the baseline. No code is removed. | ✅ |
| **V** Bilingual by Construction | English LTR shell via the existing registry/locale seam; no page-level direction hard-coded; Arabic and Social Studies contracts remain in the tree and loadable. | ✅ |
| **VI** Cost Discipline | `ai_interactions` extended with an environment tag; per-surface turn caps retained; uploads and OCR metered as their own surface so their cost is visible separately from day one. | ✅ |
| **VII** Minors' Data | Name, grade, interests only. Picker validated server-side, never presented as login. Uploads treated as academic-task-only per FR-206. | ✅ |
| **VIII** MVP Non-Goals | No payments, no teacher tooling, no voice/video, no gamification, no native app. | ✅ |
| **IX** Registry Discipline | New subject behaviour goes through `lib/subjects.ts` and the prompt kits; the capture harness runs before any prompt-touching merge. | ✅ |
| **X** Operational Safety | Two compose projects, distinct volumes, distinct ports, distinct branches. Every operation names its environment. No `down -v`. | ✅ |
| **XI** Comparison Integrity | Parity check in CI and before each content refresh; environment tag on every event and ledger row; baseline frozen except behaviour-neutral instrumentation, proven by the capture harness. | ✅ |

**Gate result: PASS** with one recorded, ADR-justified deviation (III). Tracked in Complexity Tracking.

## Architecture decisions proposed

### A1. Two environments = two branches, two compose projects

The single hardest constraint is that **pushing `main` currently deploys**, and the baseline must stay
frozen. So environment identity is carried by branch:

| | Baseline (frozen) | Comparison (new) |
|---|---|---|
| Branch | `main` | `mvp1` (new long-lived) |
| Checkout on box | `/opt/reletix/AI.NEXT` | `/opt/reletix/AI.NEXT-mvp1` |
| Compose project | `ainext` | `ainext-mvp1` |
| App port (localhost) | `127.0.0.1:3100` | `127.0.0.1:3101` |
| Volumes | `ainext_pg`, `claude_cfg` | `ainext-mvp1_pg`, `ainext-mvp1_claude_cfg` |
| Hostname | `ainext.reletix.com` | *proposed* `ainext-mvp1.reletix.com` |
| Access policy | existing email allow-list | same policy, pilot emails added |

Compose's `name:` key namespaces volumes automatically, so the two databases cannot collide. The
existing `ci-cd.yml` gains a branch→environment matrix rather than a second copy of itself.

**Consequence to accept**: the box now runs two Postgres instances and two Next apps. Memory limits
(`db` 1g, `app` 2g) must be re-checked against the box before rollout — a research item.

**The one permitted change to `main`**: FR-908's analytics instrumentation, shipped as a single
narrow PR and proven behaviour-neutral with `capture-prompts.mts` (zero prompt diffs) before merge.

### A2. BKT replaces Elo, in place

`mastery` keeps its shape and bitemporal row-closing. Migration **009** adds:
`p_transit`, `p_guess`, `p_slip`, `p_init` (per-skill, defaulted), and `evidence JSONB` on the mastery
row so FR-301's "inspectable evidence that moved it" is satisfiable without a join.

The update moves out of `/api/attempts/route.ts` into `app/src/lib/bkt.ts` — a pure function, unit
testable, with the posterior-then-transit standard form. Starting parameters come from literature
defaults; notably the existing Elo prior of **0.3 is already a sane P(L₀)**, so cold-start behaviour
does not lurch.

Grading determinism is untouched — only the number that grading produces changes.

### A3. One retrieval seam

Today grounding is assembled inside `lib/ask.ts` and `lib/lesson.ts` separately. The PRD names the
retrieval layer as "the piece that doesn't exist yet". We introduce `app/src/lib/retrieval.ts` as the
single composition point: given (student, skill focus, trigger) it returns mastery on the nearest
skills, profile attributes, the candidate misconception and its library entry, and the graph slice —
and *only* that reaches the prompt kit. This is a refactor of existing behaviour plus new inputs, and
it is exactly what makes FR-303 testable.

### A4. Explanation library as content, generated by the existing conveyor

New tables `misconceptions` and `explanation_library` (migration 009). Entries are produced by a new
pipeline workflow (`services/extraction/runbook/refutation.workflow.js`) reusing the ADR-0005
conveyor — segment the LO, enumerate likely misconceptions, author worked example / faded /
contrasting case / refutation per misconception, verify against the canonical solution, assemble.

Per decisions.md Q8 these load **without** the human gate, but they load through the same loader with
`reviewed=false` and generator attribution, so the gate can be switched back on by policy, not by a
rewrite.

### A5. Uploads and OCR through the AI runtime we already have

The box already runs the Claude CLI on Samuel's subscription and it accepts images. Using it for
upload parsing avoids a new dependency, a new key and a new bill. `/api/uploads` stores the file on a
volume, extracts text/structure through the runtime, and hands the result to the retrieval layer.
Alternatives (Tesseract, a hosted OCR API) are weighed in `research.md`.

### A6. Analytics as its own thin layer

`analytics_events` table + `app/src/lib/analytics.ts` emitting the PRD §13 taxonomy, every row
carrying `environment`. Distinct from `ai_interactions`, which stays the cost/token ledger. The
headline metric (SC-005) is computed from `question_asked` / `retrieval_attempt_submitted` pairs.

## Project Structure

### Documentation (this feature)

```text
specs/001-student-mvp1-delta/
├── spec.md              # requirements (re-cut against decisions.md)
├── decisions.md         # Samuel's twelve scope answers
├── delta-matrix.md      # as-built vs to-be diff
├── plan.md              # this file
├── research.md          # Phase 0 — open technical questions resolved
├── data-model.md        # Phase 1 — schema delta (migration 009)
├── quickstart.md        # Phase 1 — how to stand the environment up
├── contracts/
│   ├── api.md           # new and changed endpoints
│   ├── bkt.md           # the mastery update contract
│   └── analytics.md     # event taxonomy with properties
└── checklists/requirements.md
```

### Source code (repository root — real paths)

```text
app/
  src/app/
    api/
      attempts/route.ts          # CHANGED: Elo update → bkt.update()
      ask/route.ts               # CHANGED: grounding via retrieval.ts; safety scan
      uploads/route.ts           # NEW: file intake + parse
      analytics/route.ts         # NEW: client event sink
    dashboard/page.tsx           # NEW: per-topic mastery (D1)
    parent/page.tsx              # NEW: read-only parent view (E1)
    student/                     # CHANGED: English shell, create-user captures grade+interests
  src/lib/
    bkt.ts                       # NEW: pure BKT update + params
    bkt.test.mts                 # NEW: unit/property tests
    retrieval.ts                 # NEW: the single grounding composition seam
    explanations.ts              # NEW: library lookup by skill+misconception
    analytics.ts                 # NEW: typed event emitter
    safety.ts                    # NEW: crisis detection + escalation dispatch
    uploads.ts                   # NEW: storage + parse orchestration
    subjects.ts                  # CHANGED: shell locale/direction default
    student-context.ts           # CHANGED: profile fields (interests, language)
db/
  migrations/009-mvp1-bkt-library-analytics.sql   # NEW
services/extraction/
  runbook/refutation.workflow.js # NEW: misconception + library conveyor
  assemble_refutations.py        # NEW: workflow output → SeedBundle
  parity_check.py                # NEW: content parity between environments (FR-904)
deploy/
  docker-compose.mvp1.yml        # NEW: second stack (project ainext-mvp1, port 3101)
  DEPLOY-MVP1.md                 # NEW: bootstrap + Cloudflare hostname steps
.github/workflows/
  ci-cd.yml                      # CHANGED: branch → environment matrix
```

**Structure Decision**: no new project or workspace. The comparison environment is the *same*
codebase on a different branch with a different compose project — which is what makes content parity
and code reuse cheap, and what lets a winning change be merged back rather than ported.

## Phasing

Ordered so the comparison becomes possible as early as possible.

| Phase | Delivers | Why here |
|---|---|---|
| **P0** Environment | Second stack live, empty, Access-gated, parity check green against a content load | Nothing can be compared until two URLs exist |
| **P1** Teaching core | BKT + retrieval seam + English shell | The hypothesis under test |
| **P2** Content | Refutation library generated and loaded | Makes P1's misconception path real |
| **P3** Measurement | Analytics both sides; baseline instrumentation PR to `main` | Comparison starts producing data |
| **P4** Experience | Uploads + OCR, dashboard, parent view | PRD experience completed |
| **P5** Safety | Crisis detection + escalation channel | **Gate: must land before real students** |

**P5 is a hard gate, not a tail.** FR-602 requires a human on the other end of the escalation channel
and that owner is unnamed (see research.md R4). Real students should not be on the environment before
both the code path and the human owner exist.

## Complexity Tracking

| Violation | Why needed | Simpler alternative rejected because |
|---|---|---|
| Review gate suspended for generated library content (Principle III) | No reviewer exists and the timeline is immediate (decisions.md Q8) | Waiting for an SME blocks the whole comparison; deriving from canonical solutions loses the misconception-specific teaching the PRD bets on |
| Any pilot parent can see any pilot student (FR-501) | Decisions.md Q11 chose the same picker as students, for simplicity | Per-student links or codes were offered and declined; acceptable only at invited-cohort scale, must not survive a public build |
| Two full stacks on one shared box | The comparison requires simultaneous live environments | A single stack with a feature flag would let the two builds share a database and contaminate both mastery data and the metric |
| `main` receives one change while "frozen" | Both sides must emit the same metric (FR-908) | Comparing against an uninstrumented baseline is not possible; mitigated by scope discipline and the byte-identity harness |

## Post-Design Constitution Re-Check

*Re-evaluated after Phase 1 (data-model.md, contracts/, quickstart.md).*

The design **strengthened** three principles rather than merely satisfying them:

- **II Grounded Teaching** — collapsing per-surface grounding into `lib/retrieval.ts` makes "what did
  the model see" a single auditable call rather than something reconstructed from two files.
- **III Review Gate** — `explanation_library.reviewed` turns the suspension into a queryable fact.
  `SELECT count(*) FROM explanation_library WHERE NOT reviewed` answers "how much unreviewed teaching
  is live" at any moment, so reinstating the gate is a policy change, not a rewrite.
- **VI Cost Discipline** — `ai_interactions.surface_kind` keeps upload/OCR image-token cost separable
  from teaching cost, so the new expensive path cannot hide inside a blended per-student figure.

Two findings that arrived during design and are recorded rather than smoothed over:

1. **Parity must compare `live` counts, not just totals** (research.md R3). A `--course` refresh
   demotes bulk-promoted questions back to `review` — PROJECT_STATE records this happening to Unit
   1's 29. Two environments could hold identical totals while serving different question sets. The
   parity check compares both, or Principle XI is not actually enforced.
2. **The clamp is load-bearing under BKT** (contracts/bkt.md invariant 3). Unclamped BKT saturates,
   and a saturated estimate cannot be revised by new evidence — which would make the new mastery model
   *worse* than the Elo one it replaces, in precisely the dimension the comparison measures. Retaining
   `[0.02, 0.98]` is a correctness requirement here, not inherited habit.

**Gate result: PASS.** The single deviation (Principle III) remains the ADR-0007 one, unchanged in
scope. No new violations were introduced by the design.

**Not resolvable from the repository, and still blocking:**

| Item | Blocks | Needs |
|---|---|---|
| Named human recipient for crisis escalation (research.md R4) | Real students on the environment — the P5 gate | **A person's name from Samuel** |
| Box memory headroom for a second stack (R5) | P0 rollout | A reading from the box |
| Hostname preference (R6) | P0 ingress step | Samuel, or accept `ainext-mvp1.reletix.com` |
