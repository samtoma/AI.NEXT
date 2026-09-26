# Constitution amendment proposal — curriculum truth per course, and curriculum under minors' data

**Status: APPLIED, 2026-09-25.** Samuel approved it explicitly — *"Yes, update it (Recommended)"*
(third round, answer 7; `specs/003-curriculum-tracks/decisions.md` decision 28) — and the text below
was applied to `.specify/memory/constitution.md` verbatim the same day, v3.3.0 → v3.4.0, with the Sync
Impact Report given below (§"Proposed Sync Impact Report") copied into the constitution's header. This
file is now a historical record of that proposal, not a live proposal; read the constitution itself for
the current text. **Not committed to git** (worktree rule: no commits from this session).

**Proposed by:** the 003 "Curriculum Tracks" workstream, 2026-09-25. It drafts into governance what
Samuel's decisions of the same day ([decisions.md](./decisions.md)) change about the constitution's
wording.

**Base version:** **v3.3.0** (last amended 2026-09-24, ADR-0023). If the constitution moves before
this is approved, the target moves with it and this file says so, as 002's proposal did.

## What triggers it

1. **A non-ministry book.** *Additional Constraints* says *"Curriculum truth is the Egyptian ministry
   book"*. The Grade 10 American Mathematics course is built from Siyavula *Everything Maths* Grade 10,
   which is written for South Africa's CAPS curriculum. Once that course is served, the sentence is
   false for one course, and an agent reading it would conclude the course should not exist.
2. **A second drift constant.** *Additional Constraints* names one *"Comparison constant: Prep-3
   Mathematics (English), 2025-2026 ministry edition — 10 modules, 90 learning objectives, 112
   prerequisite edges, 450 questions, 212 visuals."* `parity_check.py` becomes per course (spec 003
   FR-4207). The Prep-3 constant is unchanged, and the G10 course gets its own.
3. **A new fact asked of a minor.** The curriculum is asked at sign-up when a grade has two or more
   (FR-4005). Principle VII lists "name, grade, and the interest signals the tutor actually uses". The
   privacy review ([privacy-review.md](./privacy-review.md) §1) finds the curriculum proportionate. It
   is a learning attribute that sits with grade and already exists in the student model (FR-302). It
   is also a weak proxy for fee-paying schooling (F1), and the review asks for one sentence closing
   off its pairing with a school name or address (F2).
4. **ADR-0019's scope.** Principle III's 2026-09-23 paragraph says *"everything in the maths bank is
   live"*. It was written when the maths bank was one course. Decision 9 extends it to the G10
   course, and the ADR-0019 note records that. The principle's wording should not leave "the maths
   bank" open to a narrower reading.
5. **A second manual content path.** Principle X says database content mutations happen *"only
   through the manual `refresh-content` workflow"*. Decision 17 adds a separate, manually started
   "Load a course" action: additive only, backed up and verified first, and refusing a course that is
   already present (FR-4208).

## Proposed version bump

**v3.3.0 → v3.4.0 (MINOR).** Item 1 materially expands what counts as curriculum truth: from one
ministry to "the book each course is built from". Items 2–5 are clarifications that would be PATCH on
their own, and they ride on the same MINOR. No principle is removed or redefined. **Samuel decides
the bump.** If he prefers, items 3–5 can land as a separate v3.3.1 PATCH first.

## Proposed text

### Additional Constraints — two lines replaced

> ~~Curriculum truth is the Egyptian ministry book, ingested by the sealed extraction pipeline with a
> coverage oracle; the graph carries prerequisite edges and human-curated cross-subject bridges
> only.~~
>
> **Curriculum truth is, per course, the book that course is built from** — the Egyptian ministry
> book for every National course, and for any other curriculum's course the book its course record
> names (for the Grade 10 American Mathematics course, Siyavula *Everything Maths* Grade 10, written
> for South Africa's CAPS curriculum). Each book is ingested by the extraction pipeline with a
> coverage oracle (ADR-0005, amended 2026-09-25), and the book's statement wins for its own course
> (Principle II). The graph carries prerequisite edges and human-curated cross-subject bridges only.
> A course belongs to exactly one curriculum (ADR-0024).

> ~~Comparison constant: Prep-3 Mathematics (English), 2025-2026 ministry edition — 10 modules, 90
> learning objectives, 112 prerequisite edges, 450 questions, 212 visuals.~~
>
> **Content constants are per course.** The drift guard (`parity_check.py`) holds each course to its
> own source fingerprint and counts. Prep-3 Mathematics (English), 2025-2026 ministry edition, keeps
> its constant: 10 modules, 90 learning objectives, 112 prerequisite edges, 450 questions, 212
> visuals. Each new course's constant is fixed from its approved manifest when it is loaded.

### Principle VII — one clarification added (PATCH)

> **Curriculum sits with grade.** Which curriculum a student follows — which book serves her school
> year — is part of "grade", not a new category of personal data. It is asked only when it changes
> what she is offered, and it is labelled flatly ("American", "National"), never as a tier. It is
> never sent to an anonymous analytics stream, and only an operator changes it. **It is never paired
> with a free-text school name, a school's address or any other fact that would identify the school a
> child attends.**

### Principle III — one clarification to the 2026-09-23 paragraph (PATCH)

> **everything in the maths bank is live** — *every maths course's bank: Prep-3 Mathematics, and the
> Grade 10 American Mathematics course (ADR-0019 note, 2026-09-25), where switching the course on in
> the console is the gate*: book questions still at `review`, …

### Principle X — the second manual path named (PATCH)

> Database content mutations happen only through **a manual content workflow** — `refresh-content`
> (replace or refresh a course that is already loaded) or **`load-course`** (add a course that is
> absent, and never touch one that is present) — each with typed confirmation, a `pg_dump` backup
> taken and verified first, and its one-line rollback printed. …

## Proposed Sync Impact Report

*(For the constitution header, in its own style. It is written here and not applied.)*

```
- Version change: 3.3.0 → 3.4.0 (MINOR — Additional Constraints' "curriculum
  truth" materially expanded from the Egyptian ministry book to "per course, the
  book that course is built from", with a per-course content constant; plus
  three clarifications: VII (curriculum sits with grade, never paired with a
  school), III (the maths bank means every maths course's bank), X (a second
  manual content path, load-course, additive only). No principle removed or
  redefined.)
- Amended by: Samuel (CTO, solution architect), 2026-09-25 — "I would take
  your recommendations" (specs/003-curriculum-tracks/decisions.md; ADR-0024;
  ADR-0005 amendment; ADR-0019 note).
- Templates requiring updates: none — the generic gates carry it.
- Follow-up TODOs:
  - Each new course's content constant MUST be recorded in parity_check.py from
    its approved manifest before its first load.
  - (carried) Principle III's suspension MUST still be revisited before any
    audience wider than the pilot.
```

## Noticed, not proposed

*Additional Constraints* also says *"Target cohort: 10–20 invited pilot students behind Cloudflare
Access."* ADR-0019 lifted the Access bound on noor.reletix.com on 2026-09-23, so the line is already
stale. This proposal leaves it alone, because correcting it is not a consequence of 003. It is listed
so the next amendment can take it.
