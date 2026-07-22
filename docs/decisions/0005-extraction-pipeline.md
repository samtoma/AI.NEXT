# ADR-0005: The Extraction Line — an agentic, coverage-audited book-ingest pipeline

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decided by:** Samuel (CTO/Architect)

## Context
Review of Geography Unit-1 Lesson-2 revealed the tool covered one continent (Africa) of a
six-continent lesson, and that Unit-1 Lessons 1 & 3 were never authored. Root cause: there was
**no extraction pipeline** — `services/extraction/` had schemas + a loader + a stub variant
engine, but the seed JSON was hand-authored. Nothing could assert completeness. Samuel asked for
a repeatable agentic pipeline with automation, QA checkpoints, and cost-tiered model selection.

Full design: `docs/specs/extraction-pipeline.md`.

## Decisions (Samuel, via structured confirmation 2026-07-21)
1. **Build the extraction line** — a per-lesson conveyor (Stages 0–8): segment → outline/LO →
   claims → questions → visuals → independent verify → assemble+validate → human gate → load.
   The **coverage oracle** (Stage 5) is the load-bearing addition: checklist from the printed
   objectives/headings vs content actually produced. This is what makes the Africa gap
   structurally impossible to reship.
2. **First run scope: Geography Lesson 2 only** — recover the exact gap end-to-end and prove the
   line before scaling (thesis Ch. 19.6 MVP-cut). Unit-1 L1/L3 and the rest of term-1 follow in
   Phase B; a back-audit of existing math + the Africa skeleton is Phase C.
3. **Model strategy: tiered.** Haiku 4.5 for mechanical/high-volume stages (segmentation,
   headings, provenance spot-checks, variants); Sonnet 5 for Arabic-fidelity/reasoning stages
   (claims, question authoring, viz, adversarial re-solve). Grader instance ≠ author instance.
   Reconciles "quality over cost" (memory 2026-07-18) with the new cheap-model directive.
4. **Substrate: Claude Workflow now**, with per-stage prompts saved as a reusable runbook;
   harden into a durable Python service only if/when we ingest many books.

## Non-negotiables carried in
- Nothing reaches a student unreviewed (CLAUDE.md §3): pipeline output is *draft*; `verified`
  requires an independent re-solve; Samuel's Stage-7 approval flips `review → live`.
- LOs come verbatim from the printed أهداف الدرس box — the pipeline never invents objectives.
- Printed↔PDF page offset is computed once in Stage 0 and stored; all citations use printed pages.
- `--course` scoped load preserves the math spine and `relates_to` bridges.

## Consequences
- New artifacts: `services/extraction/manifest/` (Stage-0 output), `services/extraction/runbook/`
  (saved stage prompts), the Workflow harness script.
- The existing loader, schemas, and Pydantic/DAG validator are reused unchanged as Stages 6 & 8.
- Cost: ~$1–2 per lesson one-time (not per student); logged to `ai_interactions` like all LLM calls.
- Supersedes the hand-authoring approach implied by ADR-0004 Wave-1 ("skeleton lessons"); the
  skeleton remains valid as a spine-separation proof but is now flagged for re-extraction (Phase C).
