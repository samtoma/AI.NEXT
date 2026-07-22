# Spec — The Extraction Line (agentic book-ingest pipeline)

Status: **approved 2026-07-21** (Samuel). Recorded as ADR-0005.
Design authority: `agentic-data-thesis.html` — Pillar I (schema-first, not text-first),
Ch. 15 (curriculum graph), Ch. 19.6 (MVP-cut: prove before scaling).

## Why this exists

Before this spec, "extraction" was a human (or Claude) reading the PDF and hand-authoring
seed JSON. There was **no pipeline** and therefore no stage that could assert completeness.
That is the direct cause of the Geography Unit-1 Lesson-2 gap: the book teaches landforms of
**six continents**; the hand-authored skeleton covered **one (Africa)** plus a comparison LO,
and nothing flagged the omission. Lessons 1 and 3 of the same unit were never authored at all.

The fix is not "author more JSON." It is to make ingest a **repeatable conveyor** where the
LLM fills a validated schema (never freeform), every fact is provenance-checked, every answer
is independently re-solved, and a **coverage oracle** proves every sub-topic on the page made
it into the graph.

## The unit of work

One **lesson (درس)**. The book is a list of lessons; each rides the identical conveyor.
That sameness is the repeatability. Fan-out across lessons = throughput.

## Stages

| # | Stage | In | Out | Model | Gate it enforces |
|---|---|---|---|---|---|
| 0 | Segment / TOC (once/book) | PDF TOC + openers | `manifest`: units→lessons→**printed page ranges** + printed↔PDF **offset** | Haiku | Fixes each lesson's full span up front (the Africa firewall) |
| 1 | Outline / LO (per lesson) | pages + **أهداف الدرس box** | LOs + module/topic + key_terms + **coverage checklist** | Haiku→Sonnet | LOs verbatim from the printed objectives box — not invented |
| 2 | Claim extraction (per LO) | that LO's pages | `ClaimStep[]` (evidence_page + facts) | Sonnet | Faithful-to-book; every claim cites a page |
| 3 | Question gen (per LO×tier) | LO + claims | questions + canonical solutions | Sonnet (variants Haiku) | Grounded in claims, never solved from scratch |
| 4 | Visual specs (per LO) | LO + claims | parametric map_scene/timeline/flow_chain | Sonnet | Only the approved primitives (VIZ_SPEC.md) |
| 5 | Independent verify (adversarial) | each Q/claim, **grader ≠ author** | `verified`; provenance pass/fail; **coverage audit** | Haiku (provenance) + Sonnet (re-solve) | Re-solve must agree; "Europe = 0 claims" → RED |
| 6 | Assemble + validate (per lesson) | stage 2–5 | `<lesson>.json` bundle | none | Existing Pydantic validator (refs, DAG, MCQ) — free |
| 7 | Human gate (Samuel, batched) | review dossier | approve → live | Samuel | CLAUDE.md §3: nothing unreviewed reaches a student |
| 8 | Load (deterministic) | approved bundle | DB, `--course` scoped | none | Idempotent; preserves `relates_to` bridges |

Stage 5's **coverage auditor** (checklist from Stage 1 vs content from Stages 2–4) is the
check that makes the Africa gap structurally impossible to ship again.

## Automation substrate

A **Claude Workflow** orchestrates Stages 1–6: `pipeline()` over lessons, each lesson through
the stage chain, adversarial-verify fan-out at Stage 5. Per-stage prompts are saved as a
runbook (`services/extraction/runbook/`) so the line re-runs on the next book with one command.
Human gates (Stage 0 manifest approval, Stage 7 dossier) stay as batched checkpoints.

Agent mapping: `data-engineer` (manifest, graph, loader) · `ai-engineer` (claim/question/viz
prompts + verification) · `qa-engineer` (coverage oracle + evals) · `tech-writer` (dossiers +
runbook) · `security-privacy-officer` (unchanged — no new PII).

## Model strategy (cheap where safe, quality where it counts)

- **Haiku 4.5** — segmentation, headings, provenance spot-checks, variants (mechanical/high-volume).
- **Sonnet 5** — claims, question authoring, viz specs, adversarial re-solve (Arabic fidelity + reasoning).
- Grader is always a *different* instance than the author (error diversity).
- Prompt-cache the lesson page-slice across all its LO calls; bounded thinking budget.
- Envelope: ~$1–2 per lesson fully extracted+verified; term-1 social book (~14 lessons) ≈ $15–30 one-time.

## Points to check (QA gates)

1. Manifest covers every TOC lesson; ranges contiguous, no gaps.
2. Printed↔PDF offset verified on ≥3 anchor pages.
3. Every printed objective → an LO; zero invented LOs.
4. **Coverage oracle**: every sub-topic has ≥1 claim AND ≥1 question. ← catches Africa
5. Provenance: every `evidence_page` actually contains its claim.
6. Independent re-solve agrees → `verified=true`; else review.
7. Faithful-to-book: no fact absent from its cited page.
8. Pydantic + DAG validator passes.
9. Arabic verbatim ministry wording; math LTR inline.
10. Cost/lesson within envelope; per-student projection < EGP 40.
11. `relates_to` bridges preserved across reloads.
12. Idempotent `--course` reload leaves other courses untouched.

## Rollout

- **Phase A** — Harness + manifest (approved), then one lesson end-to-end: **redo Geography
  Lesson 2, all six continents.** Recovers the gap and proves the line.
- **Phase B** — Fan out: Unit 1 L1 & L3, then remaining term-1 lessons.
- **Phase C** — Back-audit: run the coverage oracle over existing math bundles + the Africa
  skeleton → gap report → fix.
- **Phase D** — Freeze the line as the "ingest a new book" runbook.
