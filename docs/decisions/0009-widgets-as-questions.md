# ADR-0009 — An interactive widget is a question

**Status**: Accepted
**Date**: 2026-09-12
**Decider**: Samuel (CTO, solution architect)
**Extends**: ADR-0008 (generated question bank), ADR-0007 (comparison build)
**Amends**: FR-1211, which said widget outcomes must never move mastery

## Context

Phase 15 built eleven interactive widgets covering all ten modules of the Prep-3 Mathematics
book. They work: dragged in a real browser they grade correctly, accept every mathematically
valid answer, and return a diagnosis rather than a score.

They are also, architecturally, in the wrong place. Asked whether they bind to the generated
question bank, the misconception catalogue or the curriculum graph, the answer was no on all
three, and the reason is structural rather than an oversight:

| | Question bank | Widgets (as built) |
|---|---|---|
| Lives in | `questions` rows | inline JSON in a chat directive |
| Bound to | `lo_id`, provenance, `parent_question_id` | nothing |
| Graded by | `api/attempts`, server-side | the component, client-side |
| Diagnoses | distractor → `misconception_id` → refutation | English prose in a chat note |
| Reviewed | the 10% human gate (ADR-0008) | never |
| Moves mastery | yes | no |

Two consequences made this untenable rather than merely untidy.

**The same error is named twice, in two vocabularies.** `bar_builder` reports "that is the
MEDIAN, not the mean" as prose; the catalogue holds the same error as a row with a refutation
attached. The widget's version cannot pull that refutation, cannot be counted, and appears on no
operator surface. The catalogue covers all ten units — exactly the ten the widgets cover — and
the wiring between them is zero. `mc:u3-2-2:divisor-n-minus-one`, the misconception from
Samuel's own standard-deviation review, is precisely what `bar_builder`'s population-SD readout
is about, and they are not connected.

**Widget payloads are model-authored mathematics that reaches a student with no review gate.**
Not a breach of constitution III — a payload is a question *shape*, and the validator refuses
unreachable targets — but it sits outside the governance built for exactly this class of thing.

The schema then settles the design. `attempts.question_id` is **NOT NULL, foreign key to
`questions`**. A widget outcome cannot be recorded, diagnosed, counted, or made to move mastery
unless the widget is a row in `questions`. The only alternative is a second parallel attempts
table, which is worse than the present state.

## Decision

**A widget is a question.** `question_type = 'widget'`, with the widget's kind, spec and
diagnostics carried in `choices` — the same jsonb column that already carries
`misconception_id` per option for multiple choice.

The generalisation that makes this exact rather than analogical: **an MCQ's distractors are its
enumerated wrong answers, each tagged with a misconception. A widget's diagnostic predicates are
the same thing over a continuous answer space.** `circle_builder` already computes `endsOn`,
`throughCentre`, `secant` and `tangent`; those *are* its distractors. They stop producing prose
and start returning a predicate id, and the stored question maps predicate → misconception.

The client says what structurally happened. The server says what it means. Pedagogy becomes
reviewable data instead of code — which is the property that lets the human gate reach it.

### 1. Mastery — all widget attempts count, tagged by modality

Every widget attempt is evidence and updates BKT. `attempts` gains a `modality` column
(`question` | `widget`) so that every reported metric can be recomputed with and without widget
evidence, and the question "did BKT do this, or did the widgets?" stays answerable.

Rejected: excluding widget evidence to keep the comparison clean. A student who constructs six
correct chords has demonstrated mastery of chords, and a model that ignores it is not cleaner,
it is less accurate. Question supply is already a declared variable in this comparison
(ADR-0008 §Consequences); modality is the second, and it is declared the same way.

### 2. Authorship — stored preferred, inline allowed

The tutor pushes a stored, reviewed widget by id (`{{widget_ref:qw:…}}`), and may compose one
inline when nothing in the bank fits. This mirrors the `viz_ref` / `viz` duality the repo
already uses for figures, and keeps the tutor able to answer a beat the bank does not cover.

### 3. An inline widget materialises into a reviewable row on first attempt

These two decisions collide: an inline widget has no `questions` row, but an attempt requires
one. Resolved in the direction that loses nothing —

> When a student answers an inline, model-composed widget, it is **written to `questions`** as
> `source='variant'`, `status='review'`, `reviewed_by=NULL`, carrying the lesson's `lo_id` and
> the composing model in `source_note`.

So the tutor's improvisation becomes content: countable under FR-1108, tagged by the existing
provenance derivation (FR-1110), and queued for the same human gate as everything else
(ADR-0008). It is never written as `status='live'` — materialising is not promotion, and the
selector will not serve it to another student until a human has read it.

This is the part that makes the mastery decision safe. Unreviewed content can move a reported
number, which was true of generated questions from ADR-0008 onward; what this guarantees is that
nothing can move a number **without leaving a reviewable artefact behind**. Before this change,
the tutor's improvised mathematics simply evaporated after the beat.

## Consequences

Good:

- The widgets inherit the entire content pipeline, none of it rebuilt: `lo_id` binding to
  concepts and lessons, tier-based selection by the BKT selector (which has no `question_type`
  filter, so it picks widgets already), provenance tags, the 10% family-stratified review,
  `parent_question_id` lineage, content-parity coverage, diagnosis → refutation via
  `getLibraryEntries`.
- The misconception catalogue gains a second evidence source. A misconception previously
  reachable only through a multiple-choice distractor becomes reachable through a construction,
  which is a better signal: choosing a wrong option can be a guess, building a wrong figure
  rarely is.
- Widget questions can be *generated*, reviewed and versioned exactly like the 543 generated
  items — one predicate map per template family, validated once, inherited by every instance.

Costs, stated plainly:

- **Modality is a new variable in the comparison.** Every reported result must say whether
  widget evidence is included. The `modality` column makes that computable rather than a
  caveat, but it is one more thing that differs between the environments, on top of question
  supply.
- **The review queue will grow from two directions**, and the human gate (T107, still unowned)
  is already the bottleneck. Materialised inline widgets add to it. Mitigation: they are
  family-stratified like everything else, and a widget family validates in one read.
- The baseline receives none of this. It stays frozen (ADR-0007), so the comparison's widget
  axis is present-versus-absent, not better-versus-worse.

## Alternatives rejected

**Emit `misconception_id` in the widget's chat note and stop there.** The cheap version, and it
was explicitly rejected by Samuel in favour of the best one. It would have let a widget serve a
refutation while remaining invisible to attempts, mastery, provenance, parity and the review
gate — a diagnosis with no record that it happened.

**A separate `widget_attempts` table.** Avoids the NOT NULL FK, and duplicates every consumer:
two mastery paths, two provenance derivations, two parity checks, two admin screens. The
comparison exists to measure one system, not to maintain two halves of one.

**Stored-only widgets, no inline composition.** Strongest governance, and briefly attractive.
Rejected because coverage gaps become hard blocks: the tutor meets a beat the bank does not
cover and has nothing to offer, which is the failure the widgets were built to remove.
