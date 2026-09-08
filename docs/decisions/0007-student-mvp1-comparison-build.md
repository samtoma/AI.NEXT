# ADR-0007: Student MVP 1.0 — build it as a side-by-side comparison, on the same book

- **Status:** Accepted
- **Date:** 2026-09-08
- **Decided by:** Samuel (CTO/Architect), by questionnaire — twelve decisions recorded verbatim in
  `specs/001-student-mvp1-delta/decisions.md`
- **Supersedes on product scope:** `PRD-ai-tutor-mvp.md` v1.0 (the parent-sold Arabic MVP)
- **Amends:** constitution v1.0.0 → **v2.0.0**

## Context

A new product authority arrived: **`PRD: AI Tutor — Student MVP` v0.4** (Tamer Deif, drafted
2026-09-01, revised 09-03). It is not an increment on what we shipped. It moves the account owner from
the parent to the student, the delivery language from Arabic to English, the device target from
low-end Android on 3G to iPad and desktop, the mastery model from Elo to Bayesian Knowledge Tracing,
narrows to Mathematics only, and re-opens three things constitution v1.0.0 listed as binding
non-goals: the parent dashboard, mastery modelling, and a free-form ask-anything surface.

Rebuilding on that PRD blind would have left us unable to answer the only question that matters —
**is the new experience actually better at teaching?** The existing PoC is real, deployed, and teaches
a fully digested ministry book. Throwing that away to find out would be expensive; keeping it and
guessing would be worse.

The decisive observation is that we can hold the confounding variable still. The mathematics book
already in the spine — Prep-3, 2025-2026 ministry edition — is **already English-medium**, and prep-3
sits inside the PRD's grades 7-12 band. PRD §2 names the international system as primary but leaves
national English-medium open, "pending content sourcing", and PRD §3.1(6) asks whether to narrow to
one or two grades. So reusing our book is a legitimate reading of the PRD's own flexibility, not a
deviation from it — and it discharges what the PRD calls "arguably the largest pre-launch dependency
in this entire PRD" with content that already exists.

## Decision

Build the new PRD as a **second environment running beside the existing one**, on the identical
mathematics content, and compare them on the PRD's own headline metric.

**The constant.** Both environments serve the same book: 10 modules, 90 learning objectives, 112
`prerequisite_of` edges, 450 questions, 212 visuals — verified from the seed bundles, enforced by an
automated parity check that fails loudly on drift.

**The variable.** The whole PRD experience: BKT mastery replacing Elo, an explicit retrieval layer,
a misconception/refutation library, English LTR chrome, ask-anything, uploads with OCR, a per-topic
student dashboard, and a parent view. We accept that this cannot attribute a result to any single
change — we are comparing products, not isolating an algorithm.

**The measure.** The PRD §12 product-thesis metric: the share of explain/summarise interactions that
convert into a completed retrieval attempt. Real pilot students, both environments instrumented, every
event tagged by environment, never pooled.

**What we deliberately left out.** Authentication (a student picker with easy "create new user"
instead, which also holds identity constant across both sides), and trial/payments (PRD Epic G),
which tests commerce rather than teaching and would drag in the PRD §9 legal review.

**What we deliberately accept as risk.** Pipeline-generated explanation content ships **without human
review** — we have no reviewer at this stage. This is contained by keeping the environment behind
Cloudflare Access with an explicitly invited audience of 10–20 families, storing every generated entry
attributed and flagged unreviewed, and treating the suspension as reversible.

## Constitution changes (v1.0.0 → v2.0.0)

| Principle | Change |
|---|---|
| **III** Review Gate | Standard retained; **suspended** for pipeline-generated explanation content in the comparison environment only, under stated containment. Question banks and canonical solutions are not covered. |
| **V** Arabic-First, Low-End-First | Becomes **Bilingual by Construction, English-First for MVP 1.0**. English LTR default; direction never hard-coded; device target moves to iPad Safari and modern desktop; the 1.5 MB budget becomes a guideline. |
| **VI** Cost Discipline | Numeric EGP 40 ceiling detached — it derived from a parent-pays price band this PRD withdraws. Instrumentation stays mandatory; turn caps remain the operative bound; the number returns when PRD §10 sets a price. |
| **VII** Minors' Data Minimalism | Account ownership moves to the student with the parent as a linked view. Minimalism retained; "a picker is not auth" retained and made explicit. |
| **VIII** MVP Non-Goals | List replaced with PRD §14. Parent dashboard, mastery modelling and ask-anything are no longer non-goals; payments are out for this build. |
| **XI** Comparison Integrity | **New.** Content parity, environment attribution, a genuinely frozen baseline, no student data across environments. |

Unchanged: **I** Architecture Authority, **II** Grounded Teaching, **IV** Sacred Text Containment
(dormant in a math-only environment, never weakened), **IX** Registry discipline, **X** Operational
Safety (extended to two co-tenant environments).

## Consequences

**Good.** The expensive half is already built and carries over untouched — extraction pipeline,
curriculum graph, the 450-question bank, provenance and citations, deterministic grading, widget
library, deploy and content-refresh pipelines. The PRD's "skill taxonomy" and "prerequisite graph"
are our existing learning-objective nodes and prerequisite edges under different names, and its
"Q-matrix" is our question-to-LO tagging, so PRD §3.1 items 1–3 are already satisfied for this book.
Dropping authentication removes a large build and improves the experiment by holding identity
constant. If the comparison says the new direction loses, we still have a working product.

**Costly.** Unreviewed generated teaching content will reach real students — the largest quality risk
in the build, and it sits inside the very metric being measured. Any pilot parent can see any pilot
student's data, acceptable only at invited-cohort scale and never in a public build. The "frozen"
baseline is not entirely frozen: it needs the conversion metric instrumented, and that change must be
provably behaviour-neutral or it stops being a baseline. And running two stacks on one shared box
raises the blast radius of every operational mistake.

**Reversible.** Nothing here deletes the Arabic or Social Studies verticals — Principle V forbids
hard-coding direction precisely so they stay reintroducible. The review gate suspension is
condition-boxed and must be lifted before any wider audience. If the comparison favours the existing
product, the second environment is torn down and constitution v2.0.0 is revisited on the evidence.

## Alternatives considered

- **Amend nothing, build under a time-boxed exemption.** Cleaner governance and my recommendation
  before asking; Samuel chose to amend, on the grounds that the new PRD is the direction, not an
  experiment he expects to abandon.
- **Isolate the teaching mechanics** and hold the interface constant, so a metric difference could be
  attributed to the pedagogy alone. Rejected: it would not be the product the PRD describes.
- **Expert judgement instead of real students** — faster, no minors involved, no consent question.
  Rejected in favour of the PRD's own metric on a real cohort.
- **Hire a maths teacher to author the refutation library**, as the PRD literally requires. Deferred:
  no reviewer exists at this stage and the timeline is immediate.
