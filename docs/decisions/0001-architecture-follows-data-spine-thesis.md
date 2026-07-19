# ADR-0001: Solution architecture follows the Agent-Native Data Spine thesis

- **Status:** Accepted
- **Date:** 2026-07-17
- **Decided by:** Samuel (CTO/Architect)

## Context
The PRD (§8) offered stack guidance (Next.js/React PWA + Postgres, "boring, fast to ship") while explicitly leaving the final technical call to the engineering co-founder. Samuel has a prior research thesis, `agentic-data-thesis.html` ("The Agent-Native Data Spine"), covering deterministic schema-driven extraction, entity resolution, bitemporal knowledge graphs, and provenance-tracked retrieval — with Chapter 15 specifying curriculum graphs and educational agents as a direct application, and Chapter 19 providing reference architectures, a build-vs-buy matrix, and MVP-cut discipline.

## Decision
Samuel directed (2026-07-17, verbatim): **"100% forget that [PRD stack guidance], depend on the dataspine document for designing our solution."**

The Agent-Native Data Spine thesis is the **design authority for the solution architecture**. The PRD remains authoritative on product scope only; its §8 stack guidance is discarded.

The four spine pillars map to the AI Tutor as follows:
1. **Deterministic extraction** → the content pipeline: ministry syllabus/textbooks/past papers ingested via content-addressable storage + schema-driven, span-cited extraction into the curriculum graph and question bank (thesis Ch. 2–3, applied per Ch. 15.5).
2. **Curriculum knowledge graph** → the Ch. 15.1 schema (LearningObjective/Module/Topic/Assessment nodes, PREREQUISITE_OF DAG) replaces the PRD's flat "topic graph"; "today's plan" = minimal-cost prerequisite-path walk (Ch. 15.4).
3. **Bitemporal edges** → syllabus/cohort versioning via edge attributes with valid intervals (Ch. 15.3 pattern 2 + Ch. 16), directly mitigating the PRD's High risk "syllabus may shift year to year"; mastery and attempts stored as append-only temporal facts, making the pilot's score-lift measurement an as-of query.
4. **Provenance** → every question carries citations to its source learning objective and syllabus document version ("based on LO 4.3.2 from the 2026 Grade-10 Math syllabus", Ch. 15.5); every explanation logged with canonical-solution version + model version, replayable.

Applied at **MVP-cut discipline** (thesis Ch. 19.6): build the spine components that pay off at pilot scale; do not build everything before shipping anything.

## Consequences
- The curriculum graph, provenance discipline, and temporal versioning become the defensibility asset — "build a spine, sell verticals" (Ch. 15.7).
- Concrete component selections (graph store, extraction tooling, app framework) are derived from the thesis's build-vs-buy matrix and proposed in `docs/architecture/spine-derived-architecture.md`, pending Samuel's confirmation (→ ADR-0002).
- The thesis does not cover the client application layer; the PWA framework choice remains a separate decision.
- Agent guidance (`CLAUDE.md`, `.claude/agents/`) updated: the thesis is design authority, no longer "research input only."
