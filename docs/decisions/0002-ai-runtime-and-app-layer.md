# ADR-0002: AI pipeline runtime and application layer

- **Status:** Accepted
- **Date:** 2026-07-17
- **Decided by:** Samuel (CTO/Architect)

## Context
ADR-0001 set the data-spine thesis as design authority. Three component selections were proposed in `docs/architecture/spine-derived-architecture.md` §3: extraction/AI runtime, application layer, and graph store. Samuel decided the first two; the graph store is deferred pending a deep comparison study (→ ADR-0003).

## Decisions
1. **Extraction/AI pipeline runtime: Python service.** Schema-driven extraction, the variant engine, and the explanation service run as a Python service using Pydantic-typed schemas — matching the thesis's constrained-decoding + typed-schema pattern directly, with the strongest extraction/eval ecosystem. Trade-off accepted: a second runtime alongside the app.
2. **Application layer: Next.js/React** for the student PWA and internal admin tool. Largest ecosystem for RTL, math rendering, and PWA/offline needs; fastest agent-assisted iteration. Trade-off accepted: bundle discipline required to hold the < 1.5 MB first-load budget (enforced in CI).

## Also decided (product-scope note)
The PoC proceeds with the **official ministry Prep-3 Mathematics Student's Book, English edition (2025–2026)** (`docs/Source/Math_En_Prp3_Tr1_2.pdf`) as first ingestion source. Samuel's direction: **keep English** — many Egyptian schools teach math/science in English — with the Arabic version to follow later. This adjusts the PRD's Arabic-first spearhead for the PoC phase; parent-facing report language to be revisited at pilot prep.

## Consequences
- Repo will contain `app/` (Next.js) and `services/extraction/` (Python) once scaffolded.
- Graph store choice (ADR-0003) must be accessible from both runtimes (Python writes during ingestion; app reads for session planning).
- Explanation/variant prompts, eval harnesses, and content pipeline live Python-side; qa-engineer's AI evals target that service.
