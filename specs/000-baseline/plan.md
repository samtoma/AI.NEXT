# Implementation Plan: AI.Next Tutor PoC — Baseline (As-Built)

**Branch**: `000-baseline` | **Date**: 2026-08-02 | **Spec**: [spec.md](./spec.md)
**Status**: As-built record of the system live at ainext.reletix.com (main `d6db088`)

> Retro-plan: this documents the architecture that exists, decision by decision
> (ADR-0001..0006), rather than proposing one. New features branch off this baseline
> with their own `specs/NNN-*/` set.

## Summary

A three-layer system: (1) an **agentic extraction line** that turns Egyptian ministry
textbooks into a validated, provenance-carrying curriculum graph plus rich lesson
content; (2) a **Postgres data spine** holding the graph, questions with canonical
solutions, per-student bitemporal mastery, and the AI cost ledger; (3) a **Next.js
mobile-web app** whose AI tutor teaches strictly from that spine through a directive
protocol (citations, widgets, sealed passages), with fail-closed sacred-text
containment. Deployed as a single OCI box behind Cloudflare Access; code and data ship
through deliberately separate pipelines.

## Technical Context

**Language/Version**: TypeScript (Next.js 16 App Router, React 19, strict tsc) · Python ≥3.12 (pydantic v2, psycopg3)
**Primary Dependencies**: `pg`, `katex`, Tailwind v4 (app) · `pydantic`, `psycopg[binary]` (pipeline) · Claude CLI (subscription, no API key) as AI runtime · Claude Workflows as extraction orchestrator
**Storage**: PostgreSQL 17 (system of record) + on-disk lesson content JSONs (`services/extraction/seed/content/`, shipped inside the app image) + tmpdir TTS mp3 cache
**Testing**: `node --test` (no framework) for إعراب grader, span anchoring, cookie resolution · `selfcheck_arabic.py` (contract self-check, 106 cases) · `audit_arabic.py` (deterministic full-book audit) · prompt byte-identity capture harness
**Target Platform**: mobile-web PWA, low-end Android over 3G (first load < 1.5 MB); server on a shared OCI box (co-tenant with prod talent app)
**Project Type**: web app + data pipeline monorepo (no npm workspace; `app/` standalone)
**Performance Goals**: streaming first token < ~2 s on the box; lesson surfaces optimistic-UI; per-surface turn caps bound cost
**Constraints**: Arabic RTL with LTR inline math; EGP 40/student/month AI ceiling; minors' data minimalism; review gate; sacred containment (constitution I–X)
**Scale/Scope**: PoC — 3 subjects, 69 lessons, 306 graph nodes, 1519 questions, ~50 pilot families at launch

## Constitution Check

| Principle | How this architecture satisfies it |
|---|---|
| I Architecture authority | Every layer traces to a Samuel-approved ADR; this plan cites them inline. |
| II Grounded teaching | Prompts are assembled server-side from graph slices only (`lib/ask.ts`, `lib/lesson.ts`); grounding snapshot cached per chat session for prompt-cache stability. |
| III Review gate | `questions.status` lifecycle (draft→review→live) enforced at load; serving queries filter `status='live'`. |
| IV Sacred containment | Store-side seal (`text_sha256`, dual-authority cross-check) + runtime guard (`lib/sacred-guard.ts`) + display-only components (`SealedPassageCard`) + `--approve-all` refusal. |
| V Arabic/low-end first | RTL layout per subject registry; Amiri Quran lazily loaded; no client framework beyond Next; widgets are tap-first SVG/DOM. |
| VI Cost discipline | `ai_interactions` ledger on every call; turn caps; thinking budget env-tunable; session spend meter. |
| VII Minors' data | Only name/grade in `students`; backups gitignored; seed-dump generator refuses real student rows. |
| VIII MVP non-goals | No auth, no native shell, no parent dashboard, no WhatsApp automation anywhere in the tree. |
| IX Registry discipline | `lib/subjects.ts` + `LESSON_PROMPTS`/`ASK_PROMPTS` kits; capture harness proves byte-identity on refactors. |
| X Operational safety | Separate code/data pipelines; loader behind compose profile; typed confirmations; backup+rollback on every mutation. |

## Architecture (by decision)

- **ADR-0001** — the Agent-Native Data Spine thesis is design authority: curriculum as
  a typed graph with provenance, bitemporal student state, agents grounded in slices.
- **ADR-0002** — AI runtime = Claude (CLI on the box, subscription-billed); app layer =
  Next.js App Router server components + a thin streaming API.
- **ADR-0003** — graph store = PostgreSQL (not a graph DB): `graph_nodes`/`graph_edges`
  with partial temporal indexes; demo layer (seeded students) first-class.
- **ADR-0004** — Social Studies vertical: Arabic voice contract, model-answer-only
  grounding, sensitive-content rules, map/timeline/chain widget catalog.
- **ADR-0005** — the extraction line: schema-first Pydantic contracts, tiered
  Haiku+Sonnet agent conveyor with a coverage oracle, human review gate before load.
- **ADR-0006** — Arabic vertical: sealed TextPassage lane (STORE/COMPARE-VERIFY/
  COMPARE-LOOSE normal forms), dual-authority Quran cross-check with FLAG-never-block,
  typed answers (إعراب slots) graded deterministically, runtime output containment.

### Runtime flow (one lesson turn)

```
student → /student?mode=learn (RSC: resolveStudentContext → getLessonData → getLessonContent)
       → LessonSession (client) → POST /api/ask (SSE)
            ├─ turn cap check (per surface, per student)
            ├─ grounding: buildLessonContext → system+data prompt (subject kit)
            ├─ spawn claude CLI (stream-json) → parse deltas
            ├─ sacred guard scan on accumulated text (96-char holdback)
            └─ log ai_interactions (tokens, cost, latency, citations)
       → ChatCore parses citations/directives → widgets grade → [live event] → next turn
       → finish → POST /api/understanding → understanding_checks + ReportCard
```

### Content flow (book → student)

```
PDF → runbook workflow (segment→text→artefacts→questions→interactives→verify→coverage)
    → assembler (Arabic: + dual-authority sacred lane, seal, graph edges, rule merge)
    → SeedBundle JSON (pydantic-validated, referential integrity, DAG check)
    → selfcheck + audit → git commit (bundles + content JSONs)
    → Actions refresh-content (preview → course) → loader container → Postgres (status=review)
    → review gate (promote; PoC: bulk promote-poc) → status=live → servable
```

## Project Structure (as-built)

```
app/                      # Next.js PWA — see contracts/api.md and data-model.md
  src/app/                # routes: /, /spine, /student, /gallery, /pipeline, /dev/*
  src/app/api/            # ask, attempts, understanding, visuals, tts, demo-students
  src/lib/                # registry, prompts, grounding, parsers, graders, guards
  src/components/         # chat/, student/ (+10 widgets), viz/ (19 primitives), spine/, pipeline/
  scripts/                # capture-prompts.mts + ts-resolver.mjs (byte-identity harness)
services/extraction/      # Python pipeline: schemas.py, load_seed.py, assemble_*.py,
                          # audit_arabic.py, selfcheck_arabic.py, arabic_text.py, runbook/*.workflow.js
db/                       # schema.sql + migrations 002..008 (007/008 idempotent) + bridges.sql
deploy/                   # compose stack (db/app/loader), Dockerfiles, refresh-content.sh,
                          # make-seed-dump.sh, DEPLOY.md, CICD.md
docs/                     # PROJECT_STATE, architecture/, decisions/ (ADRs), specs/
specs/000-baseline/       # this Spec Kit set
.specify/                 # Spec Kit memory (constitution) + templates
.claude/                  # 10 role agents, skills (incl. speckit-*), launch.json
```

## Deployment topology

- One OCI box, shared with prod talent app: compose project `ainext` — `db`
  (postgres:17, volume `ainext_pg`), `app` (Next standalone + bundled claude CLI,
  volume `claude_cfg` for the one-time OAuth login, bound 127.0.0.1:3100), `loader`
  (profile `tools`, never started by deploys).
- Ingress: token-managed cloudflared → ainext.reletix.com, locked by Cloudflare Access
  (email allow-list). No public port.
- CI/CD: GitHub Actions build (ubuntu) → deploy job on the self-hosted runner
  (`[self-hosted, oci]`, concurrency `deploy-oci`) → git reset + `compose up -d --build`
  → :3100 health gate → dangling-image prune only.
- Content: `refresh-content.yml` manual dispatch (status/preview/course/full-reseed/
  promote-poc) sharing the same concurrency group — a refresh and a deploy can never
  race.

## Cross-cutting design invariants

- **Fail visibly, never silently**: unresolvable passage ids render a red line; flagged
  sacred passages serve with «قيد المراجعة»; coverage gaps are logged, not swallowed.
- **The model never carries truth**: ids in, store bytes out — passages, questions,
  figures, and excerpts all resolve server/client-side from verified data.
- **Determinism where money or grades are involved**: attempt grading, إعراب slot diff,
  widget results, and audits are scripted; the LLM only teaches.
- **Byte-stable prompts**: grounding snapshots per session (prompt cache); registry
  refactors proven by capture diff.
- **Two page-offset regimes** for the Arabic book (T1 = PDF−1, T2 = PDF−61) encoded
  once, in the conveyor.

## Complexity Tracking

| Deviation | Why it exists | Simpler alternative rejected because |
|---|---|---|
| Content JSONs on disk (not in Postgres) | Read-only prose; shipping in the image gives atomic code+content versioning | Tables for prose would add migration surface with no query need (drift check guards the seam) |
| CLI backend instead of API SDK | Subscription billing, no key on the box | API key management + spend variance on a PoC box |
| `sessions` table unused | Plan assembly moved into `getStudentPlan` at request time | Dropping it is a data migration with no PoC payoff; tracked as debt |
| Typed answers as tagged JSON in `questions.correct_answer` TEXT | Reuses the existing column; app parses/grades client-side | A typed-answer table before the answer format stabilizes |
