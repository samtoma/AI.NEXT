# Specification Quality Checklist: Student MVP 1.0 — Delta from the PoC Baseline

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-08
**Feature**: [spec.md](../spec.md) · [delta-matrix.md](../delta-matrix.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs) — *two deliberate exceptions, see Notes*
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain — resolved into "Open Decisions" with working defaults
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded — content constant stated numerically and verifiably
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification — *see Notes*

## Validation iterations

**Iteration 1 (2026-09-08)** — two items flagged, both resolved as deliberate and documented rather
than removed:

1. **FR-301 names Bayesian Knowledge Tracing**, which reads as an algorithm choice rather than a
   user-facing requirement. **Kept deliberately**: the PRD names BKT explicitly as a product
   requirement (Epic C1, §5 MasteryEstimate), and it is the primary variable under comparison against
   the baseline's Elo model — so naming it *is* the requirement, not an implementation leak. The
   testable surface is stated behaviourally: a probability in [0,1] with an inspectable evidence
   trail. Recorded as Open Decision 3.
2. **FR-902 names volumes, ports and hostnames.** **Kept deliberately**: the comparison environment is
   itself infrastructure, requested in those terms by Samuel, and the isolation guarantees are the
   requirement rather than a suggested design. Sizing, naming and topology remain open for
   `/speckit-plan`.

No further iterations required.

## Notes

- This is a **delta spec**: it differences an approved new PRD against a ratified as-built baseline
  (`specs/000-baseline/spec.md`). It deliberately restates carried-over baseline requirements as
  FR-C01..C05 rather than silently assuming them, so the comparison build cannot quietly drop the
  grounding, review-gate or cost-ledger guarantees.
- **Blocking governance item**: the spec conflicts with four ratified constitution principles (V, VI,
  VII, VIII). Per Constitution Principle I these are Samuel's to resolve. `/speckit-plan` should not
  run until that decision lands, because the resolution changes which requirements are even legal to
  build.
- **Critical-path dependency outside engineering**: FR-304's reviewed explanation/refutation library
  needs a mathematics subject-matter expert. No amount of engineering sequencing removes it.
