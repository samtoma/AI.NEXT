# ADR-0003: Graph store — Postgres system of record, with a first-class demo layer

- **Status:** Accepted
- **Date:** 2026-07-17
- **Decided by:** Samuel (CTO/Architect)

## Context
Deep comparison delivered in `docs/architecture/graph-store-comparison.md`. Key facts: KuzuDB (thesis-endorsed) was abandoned by its sponsor in Oct 2025 and eliminated; our graph is <5k nodes so performance is not a differentiator; binding constraints are solo-CTO ops, mandatory backups (minors' data), zero budget, and two runtimes (Python service + Next.js app, ADR-0002).

## Decision
1. **Postgres is the single system of record.** The curriculum graph is modeled relationally as first-class node/edge tables carrying the Ch. 15.1 semantics (LearningObjective, Module, Topic, Question nodes; typed edges with `{edge_type, valid_from, valid_to, syllabus_version}`), traversed with recursive CTEs. Bitemporal via indexed timestamp-range columns (thesis Ch. 16.4 pattern 1). Schema discipline requirement: a future dedicated graph engine must be reachable as a projection, not a redesign.
2. **The "demo effect" is a P0 PoC deliverable** (Samuel: crucial for co-founders and investors at this stage). The PoC ships an **evidence-walk demo view** — the tutor-domain version of the thesis Ch. 19.6 demo: interactive curriculum-graph visualization (prerequisite DAG, mastery overlay per student) → click a learning objective → see its questions → click a question → see its span citation to the ministry book page → replay a generated explanation with its canonical-solution grounding. Built into the Next.js app so it runs anywhere (a pitch meeting, a laptop, offline), reading the Postgres graph directly. An AuraDB Free + Bloom snapshot remains an optional extra visual, not the primary demo path.

## Revisit triggers (adopt a dedicated graph engine when any fires)
- Multi-vertical spine reuse begins (Ch. 15.7)
- GraphRAG/semantic retrieval lands
- Graph exceeds ~1M edges
- DAG query complexity starts consuming real engineering time

## Consequences
- One database, one backup story, one hosting decision; both runtimes speak SQL.
- No Cypher: DAG traversals are recursive CTEs — acceptable at our scale; encapsulate them behind a small query module so they're written once.
- The demo view doubles as an internal QA/inspection tool (browse the graph, verify citations) — the interpretability moat made visible.
