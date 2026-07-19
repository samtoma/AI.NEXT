# AI Tutor — Spine-Derived Architecture (Proposal)

- **Status:** Draft — pending Samuel's confirmation of component selections (→ ADR-0002)
- **Design authority:** `agentic-data-thesis.html` per ADR-0001
- **Product authority:** PRD v1.0 (scope, metrics, non-goals unchanged)
- **Date:** 2026-07-17

## 1. The spine applied to the tutor

```
┌─ 1. INGEST (content, not customers) ──────────────────────────────┐
│  Ministry syllabus docs, textbooks, official exam models,          │
│  past papers → object storage keyed by sha256(bytes)               │
│  Event: DocumentIngested {source_hash, doc_type, syllabus_year}    │
└───────────────────────────┬────────────────────────────────────────┘
                            ↓
┌─ 2. PARSE + EXTRACT (Ch. 2–3) ────────────────────────────────────┐
│  Arabic OCR/layout (buy, cloud) for scanned sources                │
│  Constrained-decoded LLM → typed objects (Pydantic-style schemas): │
│    Topic, LearningObjective, Question{stem, choices, canonical      │
│    solution steps, tier}, each field with {page, bbox} span        │
│  Immutable extraction artifact keyed by (source_hash, schema,      │
│  extractor_version)                                                │
└───────────────────────────┬────────────────────────────────────────┘
                            ↓
┌─ 3. HUMAN REVIEW GATE (PRD §7.4 — unchanged, now provenance-aware)┐
│  Admin tool shows extracted question + span citation to source     │
│  page. Approve/reject. Nothing unreviewed reaches a student.       │
│  LLM variant engine feeds the same gate (variant → PARENT_OF edge  │
│  to its seed; inherits LO links).                                  │
└───────────────────────────┬────────────────────────────────────────┘
                            ↓
┌─ 4. CURRICULUM GRAPH LOAD (Ch. 15.1 schema, adapted) ─────────────┐
│  (:Course {grade10-math})-[:PART_OF]->(:Program {bakaloreya})      │
│  (:Module)-[:PART_OF]->(:Course)                                   │
│  (:Module)-[:TEACHES]->(:LearningObjective)                        │
│  (:LearningObjective)-[:PREREQUISITE_OF]->(:LearningObjective)     │
│  (:LearningObjective)-[:ABOUT]->(:Topic)                           │
│  (:Question)-[:ASSESSES {tier}]->(:LearningObjective)              │
│  (:Question)-[:EXTRACTED_FROM {page,bbox}]->(:SourceDocument)      │
│  Syllabus versioning: edges carry {valid_from, valid_to,           │
│  syllabus_version} (Ch. 15.3 pattern 2 + Ch. 16) — 2026/27 vs      │
│  2027/28 syllabus coexist; queries filter by version. Cheap        │
│  re-mapping when the ministry shifts the syllabus.                 │
└───────────────────────────┬────────────────────────────────────────┘
                            ↓
┌─ 5. STUDENT STATE (temporal facts, append-only) ──────────────────┐
│  Attempt log: append-only, immutable (the defensibility asset)     │
│  Mastery: (:Student)-[:MASTERY {score, as_of}]->(:LearningObj)     │
│  history preserved → score lift at day 45 = as-of query vs         │
│  baseline diagnostic (Ch. 16 Q2/Q3), not a hand-built report       │
└───────────────────────────┬────────────────────────────────────────┘
                            ↓
┌─ 6. RETRIEVAL & GENERATION (Ch. 15.4–15.5) ───────────────────────┐
│  "خطة اليوم" = prerequisite-DAG walk from mastery state toward      │
│  weakest unmet LOs (minimal-cost path) + spaced review + stretch   │
│  Explanations: canonical-solution-grounded (PRD §6.3 unchanged),   │
│  logged with {question_id, solution_version, model, prompt_v} →    │
│  replayable. Every question carries its LO/syllabus citation —     │
│  surfaced to parents as trust signal ("aligned to official         │
│  2026/27 syllabus, section X").                                    │
└────────────────────────────────────────────────────────────────────┘
```

**What the spine changes vs the PRD's §8 sketch:** the flat hand-built "topic graph" becomes a real curriculum graph with LOs, prerequisite DAG, span-grounded source citations, and syllabus versioning; content ingestion becomes a deterministic extraction pipeline instead of manual entry; mastery/attempts become temporal facts. **What it does not change:** the core loop, the human review gate, canonical-solution grounding, Elo-style mastery arithmetic for MVP (BKT/IRT fits later on the Attempt log), and all PRD non-goals.

## 2. Build vs buy (from thesis Ch. 19.3, tutor-adapted)

| Component | Build/Buy | Notes |
|---|---|---|
| Arabic OCR + layout | **Buy** (cloud provider) | Commodity; needed only for scanned syllabus/past papers |
| Schema-driven extraction | **Build** | The moat: constrained decoding + typed schemas + span citations |
| Curriculum graph | **Build** on graph store (§3) | Operational core + defensibility |
| Entity resolution (Splink etc.) | **Skip for MVP** | No ER problem at pilot scale (thesis MVP-cut) |
| Vector/hybrid search | **Skip for MVP** | Retrieval is graph-structural (DAG walk), not semantic |
| Lakehouse, Dagster, Temporal | **Skip for MVP** | Thesis 19.6: "skip until you have data to analyze" |
| Explanation generation | **Buy** (LLM API) | Per PRD; grounded + cached + cost-instrumented |
| Admin/review UI | **Build** | The review gate is the trust moat made visible |

## 3. Component options needing Samuel's call (→ ADR-0002)

**A. Graph store** (thesis endorses Neo4j or KuzuDB; Ch. 15.3 notes the simple pattern needs no special DB features)
1. **KuzuDB embedded** — thesis-endorsed, Cypher, zero infra cost, fits pilot scale; embedded = fewer moving parts, but younger ecosystem.
2. **Neo4j AuraDB (free tier)** — thesis-endorsed, managed, mature tooling/visualization; external dependency + eventual cost.
3. **Postgres-modeled graph** (nodes/edges tables + recursive CTEs for the DAG) — one database for everything (app + graph + attempts); loses Cypher ergonomics, DAG queries are more verbose.

**B. Extraction runtime** — structured-output LLM API calls validated against typed schemas (Pydantic-style), dual-check on math content (extracted solution re-verified before review queue). Python service vs in-app-language library: depends on choice C.

**C. Application layer** — *not covered by the thesis*; needs a separate decision. The spine constrains it only via: PWA + RTL + <1.5 MB + offline queue (PRD NFRs) and clean access to the graph store.

## 4. Provenance discipline (applies regardless of A–C)
- Source documents immutable, content-addressed (sha256).
- Every Question node traces to source doc + page/bbox (seeds) or to its seed question (variants).
- Every explanation logged: question, canonical-solution version, model, prompt version, output, cache hit.
- Review decisions recorded with reviewer + timestamp.
- Attempt log append-only; mastery history never overwritten.
