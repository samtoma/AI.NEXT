# ADR-0005: The Extraction Line — an agentic, coverage-audited book-ingest pipeline

- **Status:** Accepted · **Amended 2026-09-25** — derived objectives for books with no objectives box,
  and the v2 line for the Grade 10 book; see [Amendment](#amendment--samuel-2026-09-25-derived-objectives-and-the-v2-line)
  (accepted 2026-09-25, "ok for all"; not committed)
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

## Amendment — Samuel, 2026-09-25: derived objectives, and the v2 line

**Status of this amendment**: **accepted.** On 2026-09-25 Samuel answered the options in
`docs/specs/extraction-pipeline.md` §10: *"I would take your recommendations"*. After reading this
text and the Grade 10 S0 report the same day, he answered *"ok for all"*. The coordinating session
relayed both, recorded in `specs/003-curriculum-tracks/decisions.md` (#12–#16, #19, #20, #21, #22, and
A–C). Items 3 and 4 below were amended by the second answer and are stamped. **Not committed.**
The design it rests on is the v2 revision of `docs/specs/extraction-pipeline.md`.

**Why.** The fourth book, Siyavula *Everything Maths* Grade 10 (English; written for South Africa's
CAPS curriculum), prints **no objectives box**. The non-negotiable above — *"LOs come verbatim from
the printed أهداف الدرس box"* — cannot be met for it. Samuel's direction on objectives: *"you must
find it for each lesson, it is a core part of our product, and our teaching methodology (don't write
that as requirements yet)"*. So this is **pipeline policy recorded in an ADR, and deliberately not an
FR**. Spec 003 writes no requirement about objectives.

### What changes

1. **Objectives: printed where the book prints them, derived where it does not** (#12).
   - A book with an objectives box (`objectives_mode: "printed"`): unchanged. Objectives are
     transcribed verbatim, and none is invented.
   - A book without one (`objectives_mode: "derived"`): stage S1 derives each lesson's objectives
     **from the book only**. The CAPS document and outside knowledge are excluded.
   - Every derived objective cites **at least two kinds of evidence**, with a quote, anchor and
     printed page for each. At least one kind must be a worked example or an exercise, because an
     objective the book never demonstrates or practises cannot be assessed.
   - The kinds of evidence are: heading, chapter introduction, chapter summary, definition box,
     worked example, and exercise.
   - Two finders derive the list blind to each other; a reconciler aligns them. Every objective only
     one finder found, and every rule failure, goes to the human gate **G1** (per chapter) before any
     later stage runs.
   - The full rules — granularity 2–5 per lesson, the book's own terminology, every exercise item
     mapped to exactly one objective — are in `docs/specs/extraction-pipeline.md` §3.4.

   **The non-negotiable is restated**: the pipeline never invents an objective the book does not
   evidence.
2. **Generated questions, widget questions and misconceptions are stages of the line**, not hand-run
   scripts afterwards: S5 misconceptions and refutations (fail-closed verifier), S6 generated
   families, S7 widget questions. Each has an author and a different grader, and each passes the
   coverage audit (S8).
3. **Canonical solutions for exercises** (#13, **amended by #19 the same day**).
   - ~~Steps are derived to the printed answer; the Teacher's Guide where it prints a worked
     solution.~~
   - **The book's EPUB edition carries a worked solution for all 2,531 Grade 10 exercise items. Those
     are the canonical solutions**, transcribed through S0b, with a new provenance
     `book_worked_epub` (a book solution not printed in the PDF, which stays the citation authority).
   - Every item is **re-solved blind** by a different agent. It is `verified` only when the blind
     answer agrees with the **printed answer** and with the **EPUB solution's final answer**.
     - Any disagreement goes to gate G2, and a printed answer or book solution is never corrected
       silently.
     - An item with no printed answer (261) is checked against its EPUB solution alone and listed at
       G2.
   - The Teacher's Guide is used **only where it adds something**. Derivation to the printed answer
     (`answer_anchored`) is kept only for books without worked solutions.
4. **Answers the app cannot mark yet** (#14, **amended by #20 the same day**).
   - ~~Multiple choice where natural; the rest worked examples; expression grading a follow-up.~~
   - **A maths-expression marker is built in the app this cycle** (spec 003 FR-4320). It marks by
     equivalence, with form checks and #15's normalisation. S3 therefore types every item: `numeric`,
     `choice` (**multiple choice only where natural**), `expression`, or `not_markable`.
   - Proofs, sketches and "show that" items stay worked examples.
5. **Notation** (#15). At assembly, decimal commas are normalised to decimal points and `(x; y)` to
   `(x, y)`, the app's style. Vocabulary and word-problem contexts, the Rand included, stay as printed.
6. **Generated families are a declarative spec** (#16, the pipeline's option A). Families are
   instantiated deterministically by a safe evaluator, can be regenerated from the repository, and no
   model-written code is executed. The 35 existing Python families are unchanged.
7. **The lesson unit for a chapter-and-section book is one numbered section** (A). A section too long
   for one sitting is split along its own sub-headings, proposed by the manifest stage and approved at
   **G0**.
8. **The substrate stays Claude Workflow** (C), with a cost meter reading each run's transcripts.
   Every run output is committed under `services/extraction/runs/<book>/`, so a bundle can be replayed
   from committed run outputs.
9. **Maths-image transcription, S0b** (#21, added 2026-09-25).
   - The EPUB's maths is images: 8,561 unique PNGs, each named `md5(LaTeX)`, with no MathML or alt
     text. So "MathML → LaTeX" cannot be built.
   - Two independent vision passes transcribe each unique image. One is accepted when
     `md5(latex)` equals the file name, or when both passes agree, and is cross-checked against the PDF
     text layer.
   - The rest go to a human at gate **G0b**. None is guessed.
   - The edition check uses build markers plus the section and media codes, not the version string
     (the EPUB has none) or every item shortcode (the EPUB has none).
   - **Teacher notes** (the EPUB's 32 teacher's-guide notes) are dropped at S2.
10. **The misconception catalogue's single source, B19** (#22, added 2026-09-25).
    - `seed/generated/misconceptions.json`, the loaded file, is the source; `build_misconceptions.py`
      is retired.
    - The six `t2u3-1-2` entries only the generator held go live.
    - `seed/misconceptions-math.json` is deleted.
    - The export keeps `kind` and aliases.
    - No live id is ever renamed.
    - It touches live Prep-3 content, so it passes tests and a CI proof first.
11. **The loader never deletes student data** (B9, found stale 2026-09-25). A course reload is
    add-only by default, and refuses, saying what would be lost, rather than clearing misconceptions,
    explanations or attempts. That replaces the non-negotiable's older reading of "`--course` scoped
    load" as a subtree replace.
12. **Book provenance per lesson** (#18). The manifest and the bundles carry each lesson's printed
    section(s), "part *n* of *m*" for a split part, and the chapter-introduction tag. The app keeps a
    section's parts together (spec 003 FR-4311…FR-4319).

### What does not change

- Grader ≠ author on every model stage.
- Printed page numbers are the citation authority.
- A `--course` load leaves every other course untouched.
- The sacred-content lane stays in force for books that need it.
- Samuel's human gates stay batched checkpoints: G0 manifest, **G0b maths queue** (new), G1
  objectives, G2 solutions, G3 family sample, G4 refutations, G5 go / no-go. **G0 for Grade 10 passed
  on 2026-09-25 at 65 lessons**: splits P1a–e, promotions P2a–b and merges P3a–b. The optional merges
  P3c and P3d were not applied.

**Review posture.** ADR-0019's decision covers the Grade 10 course; switching the course on in the
console is the gate (ADR-0019 note, 2026-09-25). The 10% family sample is still drawn and read at G3.

### Consequences

- **Cost** rises from ADR-0005's ~$1–2 per lesson to about **$3.2 per lesson**, because objectives,
  families, widgets and misconceptions are now inside the line, and figures are about twice the
  assumed volume. S0b adds about $20–25 per book. **The Grade 10 book is about $210–230 one-time**
  (it was $120–190 before the S0 report). It is metered per stage. Samuel's standing call is quality
  over cost, with the meters on.
- **G1 is new work for a human**: approving every chapter's derived objectives, with their evidence,
  before anything else runs. It is the gate that keeps "derived" from drifting into "invented".
- **The build list is B1–B21** in `docs/specs/extraction-pipeline.md` §9, where each item's state is
  marked. Spec 003's `tasks.md` carries them.
