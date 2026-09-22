# Specification Quality Checklist: Identity & Admin Console

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-20
**Feature**: [spec.md](../spec.md) · [decisions.md](../decisions.md) ·
[constitution-amendment-proposal.md](../constitution-amendment-proposal.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs) — *four deliberate exceptions, see Notes*
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain — **zero** in the spec; the genuinely undecided items
      are in "Open Decisions", which the consistency pass on 2026-09-20 extended from five to
      **thirteen** so that it is the complete list and `plan.md`'s "Open for Samuel" cites its
      numbering. Items 1–5 carry a working default in "Assumptions"; 6–13 carry the plan's default
      in the entry itself, and none blocks planning
- [x] Requirements are testable and unambiguous — *four fixed in iteration 1, see below*
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined — 44 Given/When/Then scenarios across eight testable
      stories; the ninth (P9) is deferred by design and says plainly that it is not testable this
      release
- [x] Edge cases are identified — nine, including the two that only exist because this feature
      creates them (two surfaces on one database; the demo-cast migration)
- [x] Scope is clearly bounded — an explicit deferred-by-design block (FR-2901…FR-2904) states what
      is designed for and not built, citing the decision that defers each
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification — *see Notes*

## Validation iterations

**Iteration 1 (2026-09-20)** — five items flagged, four fixed in the spec, one kept and documented:

1. **FR-2108 was not testable.** It required the list of deliberately cross-student reads to be
   "maintained and short enough to read" — a preference, not an obligation. **Fixed**: every such
   read must appear in one enumerated list, and a read not on that list must fail closed. That is
   checkable.
2. **FR-2502 and two scenario/narrative lines said "within seconds".** Vague where SC-105 already
   commits to a number. **Fixed**: all four now say one minute and cite SC-105.
3. **FR-2302 left the inactivity period undefined**, so "a session closed by inactivity" could not be
   tested. **Fixed**: the period must be stated and documented rather than discovered — the same
   shape as FR-2011's lockout threshold.
4. **FR-2211 was written as a judgement** ("readable by a founder who does not read code"). **Fixed**
   to three checkable facts: every figure carries its unit and period, every identifier appears
   beside its name, and no column heading is a field name.
5. **FR-2602 names concrete counts of gendered pronouns in named prompt files.** Flagged as
   implementation detail. **Kept deliberately**: the counts are the evidence that the requirement
   describes a defect rather than a preference, they are the number a reviewer will check the fix
   against, and the requirement itself is stated as an obligation on the product ("the tutor MUST
   address the student in the correct grammatical form"), not on any prompt's wording. Recorded in
   Notes. *(Note the counts also correct the figure this decision was originally based on — see
   `decisions.md` D10.)*

**Iteration 2 (2026-09-20)** — re-ran every item above. No vague qualifiers remain (checked for
"within seconds", "quickly", "as soon as", "reasonable", "appropriate"). All items pass. No third
iteration required.

## Notes

- **Deliberate naming exceptions**, all four carried from decisions already made rather than chosen
  here: **Google** as a sign-in option (D9, and a thing a student sees on the screen); **Cloudflare
  Access** (001 FR-907, an existing containment 001 already names in the same way); **`/spine`** as a
  route (a student-visible surface, named in 001 FR-1001 too, and the point of FR-2206 is precisely
  that this address does not move); and the four **role names** `content-review`, `evidence-access`,
  `student-data`, `cost-billing`, which are Samuel's own vocabulary from D4 and are the product's
  permission model, not an implementation of one. No table, column, library or framework is named
  anywhere in the requirements — the isolation block says "beneath the application" rather than
  naming the mechanism, and the plan owns that.
- **The "Why this feature exists" section quotes a `WHERE` clause.** It is narrative, explaining to a
  reader why the current arrangement is a convention rather than a guarantee. No requirement depends
  on it.
- **This spec depends on an unapproved governance change.** FR-2306, FR-2307, FR-2308 and
  FR-2601…FR-2606 state obligations that constitution v3.1.1 Principle VII does not currently
  sanction. `constitution-amendment-proposal.md` proposes the expansion (v3.1.1 → v3.2.0) and is
  **awaiting Samuel's approval**. `/speckit-plan` can proceed — the plan does not depend on the
  amendment — but **implementation of gender capture, operator transcript access and full-fidelity
  retention should not start until it lands**, because the resolution changes which requirements are
  legal to build. This is the same posture 001's checklist took on the v2.0.0 amendment.
- **Two corrections are carried in the spec rather than left in research.** The session record does
  not exist (FR-2301 says so in the requirement itself, so nobody plans a one-column migration), and
  the gendered-pronoun count is 63 rather than the 23 the original finding cited (FR-2602). Both are
  places where earlier drafts understated the work, and both are stated in the requirement
  so they cannot be lost between documents.
- **Critical-path dependency outside engineering**: Open Decisions 2 and 3 — the retention period and
  the disclosure text — are Samuel's, and both are gates on widening the audience beyond the invited
  pilot. No amount of engineering sequencing removes them.
