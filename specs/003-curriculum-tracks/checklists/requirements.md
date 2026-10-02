# Specification Quality Checklist: Curriculum Tracks and the Grade 10 American Mathematics Course

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-25 · **Re-validated**: 2026-09-25 (spec rev. 3, after Samuel's *"ok for all"*)
**Feature**: [spec.md](../spec.md) · [decisions.md](../decisions.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs). There are four deliberate
      exceptions; see Notes.
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain. Rev. 1's three are resolved by Samuel's decisions of
      2026-09-25: Q1 → FR-4004 (decision 1), Q2 → FR-4202 (decision 9), Q3 → FR-4205 (decision 10).
      One confirmation is owed, for the recommendations adopted without being named in the relayed
      list (decisions.md A–E). It does not block planning.
- [x] Requirements are testable and unambiguous. There are 63 FRs (44 from rev. 1, 6 added in
      rev. 2, 13 added in rev. 3), and each names what a tester would observe.
- [x] Success criteria are measurable (SC-201…SC-213)
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined. There are 41 Given/When/Then scenarios across seven
      stories (US6 and US7 added in rev. 3).
- [x] Edge cases are identified. There are twenty.
- [x] Scope is clearly bounded. *Scope boundaries* names what is deliberately not written:
      objectives and methodology, licensing, a student-facing curriculum control, expression grading,
      shared courses, other books and curricula, payments, Master, and probing on G10.
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification (see Notes)

## Notes

- **Deliberate implementation-adjacent references**:
  1. The two curriculum ids (`eg-national-en`, `us-american-en`) are named because Samuel decided
     them (decision 3).
  2. `docs/specs/extraction-pipeline.md` is named because documenting the line is itself a
     deliverable (FR-4406).
  3. The internal tools `/pipeline` and `/gallery` are named as surfaces, as 002 does.
  4. "The prompt capture harness" is named because Principle IX makes byte-identity the proof
     (FR-4206).
- **Objectives**: no FR concerns how a lesson's objectives are found, worded or taught. Decision 12
  is recorded as pipeline policy in the ADR-0005 amendment. Three FRs count coverage per objective
  (FR-4304, FR-4305, FR-4307), using the objective only as the graph's existing unit of attachment.
- **Licensing**: no FR concerns credit, attribution or licence, by instruction.
- **Rev. 1 iteration 1**: two issues fixed. Q2 gained an inline marker at FR-4202, and Q3 was
  reworded to cover both ways of registering the course.
- **Rev. 2**: rev. 1's ids are all kept. Text that moved is marked *(changed rev. 2)*, and new ids are
  marked **[ADDED rev. 2]**: FR-4014, FR-4015, FR-4016, FR-4017, FR-4211, FR-4212. None is dropped or reused.
- **Rev. 2, privacy pass** (`privacy-review.md`, 2026-09-25): FR-4017 is added. FR-4005, FR-4008,
  FR-4014, FR-4016, FR-4104, FR-4105, FR-4202, FR-4206, FR-4208 and FR-4210 are sharpened.
  FR-4008's contradiction with decision 4 (F11) is resolved in line with the decision: a chosen
  curriculum never moves on a grade change, and is flagged for an operator instead. No new question
  went to Samuel for that one. Two acknowledgements for Samuel are listed in the spec's open section
  (F5, and the Ask book-list line).
- **Rev. 3** (Samuel, 2026-09-25, *"ok for all"*):
  - Confirmations: A–E confirmed; privacy F5 option (b); the Ask book-list line acknowledged. The
    spec's open section is now empty.
  - New requirements: book-section grouping (FR-4311…FR-4319; allowed, because it is about
    tagging and progression, not objectives or methodology); the expression marker (FR-4320);
    maths-image transcription (FR-4407); teacher-only material dropped (FR-4408); one source for the
    catalogue (FR-4409).
  - Changed: FR-4301 (G0: 65 lessons), FR-4302 (EPUB solutions, three-way check) and FR-4303 (the
    marker; multiple choice only where natural).
  - New criteria: SC-211…SC-213.
  - Two sentences in FR-4320 go beyond Samuel's words, and are flagged for his eye:
    - the **form check** — an equivalent answer in a form the question did not ask for is not marked
      correct. Without it, "factorise" questions would accept the unfactorised expression;
    - "unreadable" answers are returned for re-entry rather than marked wrong.
  - One rule in FR-4302 goes beyond them too: an item with no printed answer is checked against its
    EPUB solution alone and listed at G2. It is the only way the three-way check can apply to such an
    item.

