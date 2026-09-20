# Constitution amendment proposal — Principle VII, driven by 002 Identity & Admin Console

**Status:** PROPOSED — awaiting Samuel's approval, 2026-09-20. Not yet an amendment. This file does
not edit `.specify/memory/constitution.md`; nothing here is binding until Samuel approves it there.

**Proposed by:** the 002 "Identity & Admin Console" workstream, 2026-09-20, drafting three of
Samuel's decisions into governance because they change what Principle VII permits.

**What triggers it:**
- **D10 (gender):** Samuel decided to collect gender at signup and use it to fix the tutor's
  language — the pilot's prompts default every student to masculine pronouns and vocatives
  (**63** masculine pronouns in `lib/lesson.ts` plus one `himself`, **21** in `lib/ask.ts`, **11** in
  `lib/checkin.ts`, including a masculine Arabic vocative offered to the model as the pattern to
  follow; `students` has no gender column today). *001's `traceability.md` §9 item 11 still cites the
  original figure of 23 for `lesson.ts`; the counts above are R3's, taken from the files.* Collecting
  a new datum about a minor needs a VII amendment, not a schema migration alone.
- **D7 (chat disclosure, full fidelity):** Samuel decided no disclosure screen is added at signup
  this release, and that the interaction record is kept at full fidelity rather than trimmed to a
  minimum — both are exceptions to a minimalism principle, so both need to be on the record as
  exceptions, not silently absorbed.
- **D1 / D6 (operator access to transcripts):** the admin console's `student-data` role can read a
  student's full interaction transcript. VII today only says what a *parent* may not see
  (transcripts) and that students never see each other's data; it says nothing about an operator
  reading a transcript at all. That gap needs closing before the console ships.

---

## A note on the base version

This proposal was originally drafted to target **v3.0.0 → v3.1.0**. That was correct at the time,
but `.specify/memory/constitution.md` has since advanced to **v3.1.0**
the same day, via a sibling, unrelated amendment: **Principle XII "Design System Authority"**
(Noor Play becomes the visual authority for every surface), recorded in the file's own Sync Impact
Report and in `docs/PROJECT_STATE.md` ("DESIGN SYSTEM PUBLISHED, AND MADE BINDING — constitution
v3.1.0 (2026-09-20)"). That amendment is unrelated to identity, gender, or operator access, and this
proposal does not touch Principle XII or its text.

Because that version number is already spent, this proposal targets **v3.1.0 → v3.2.0** instead — a
correction made directly here, not a silent change on my part.

---

## Proposed Sync Impact Report

*(in the constitution header's own style — this is what would be prepended to the header block on
approval)*

```
- Version change: 3.1.0 → 3.2.0 (MINOR — Principle VII "Minors' Data
  Minimalism" materially expanded. Gender added as a collected datum, used
  for address and voice only. Operator access to a student's full
  interaction record established as a named, logged privilege. No-signup-
  disclosure and deferred-parent-contact-capture recorded as time/condition-
  boxed exceptions. No principle redefined or removed.)
- Amended by: Samuel (CTO, solution architect), 2026-09-20 — decisions D1
  (student-owned account, parent view deferred), D7 (no signup disclosure,
  full-fidelity retention, responsibility his), D10 (collect gender to fix
  the tutor's assumed-male voice) for the 002 Identity & Admin Console
  workstream.
- Previous: 3.0.0 → 3.1.0 (MINOR — Principle XII "Design System Authority"
  ADDED, unrelated to this amendment. See "A note on the base version" in
  the 002 constitution-amendment-proposal.md for why this proposal is
  3.1.0 → 3.2.0 and not 3.0.0 → 3.1.0.)
- Modified principles:
  - VII Minors' Data Minimalism → collected data gains gender (address/voice
    only, never content gating, never third-party analytics); a named
    operator role (`student-data`) may read a student's transcript
    read-only, every read logged (who, whose, when) and the log itself
    retained; full interaction fidelity retained for now, Samuel's explicit
    decision, his responsibility, pending a retention policy; no signup
    disclosure this release (time/condition-boxed exception, Samuel,
    2026-09-20); parent contact capture deferred from signup this release
    (the link exists in the data model, capture and the parent view ship
    later); the picker clause narrowed to name that it binds only a
    solution that still uses a picker, since the Student MVP solution now
    has real accounts
- Added sections: none
- Unchanged: I, II, III, IV, V, VI, VIII, IX, X, XI, XII — this proposal
  touches only VII
- Templates requiring updates:
  - ✅ .specify/templates/plan-template.md — generic Constitution Check gate
    remains compatible
  - ✅ .specify/templates/spec-template.md — compatible as-is
  - ✅ .specify/templates/tasks-template.md — compatible as-is
- Follow-up TODOs:
  - A retention policy for full-fidelity interaction records (what is kept,
    how long, what is purged) MUST be set before this data is opened to any
    audience wider than the invited pilot and the current operator roster
  - The disclosure text is Samuel's to write; the no-disclosure exception
    reverts to requiring disclosure once he sets that text, or before any
    audience wider than the invited pilot, whichever comes first
  - **Egypt PDPL guardian consent is an external constraint on this
    principle, not a decision taken here.** Law 151/2020's executive
    regulations (Decree 816/2025, issued 2025-11-01, in force the next day)
    treat a child's data as sensitive in every case and require WRITTEN
    GUARDIAN CONSENT for under-15s; the grace period ends 2026-11-01, weeks
    after target launch, and our cohort is 14-15. This collides with the
    no-signup-disclosure exception above. D7 stands as Samuel's decision;
    what ships is consent fields and hooks with no interface and no
    enforcement (spec Open Decision 6, plan A11, research R15). An Egyptian
    data-protection opinion is owed before the pilot takes money. Owner:
    Samuel.
```

---

## Proposed text of Principle VII

### Current text (v3.1.0, unchanged since v2.0.0)

> ### VII. Minors' Data Minimalism
> Collect the minimum: name, grade, and the interest signals the tutor actually
> uses. Per the new PRD the student owns the account, with the parent as a linked
> view rather than the account holder; a parent contact SHOULD still be captured
> for every student as the working default until legal review says otherwise
> (PRD §9). Where identity is a picker rather than an account — as in the
> comparison PoC — it is explicitly NOT auth, MUST be validated server-side on
> every request, and MUST never be presented to a user as a login. Student
> conversations are never exposed to other students, and what a parent sees is
> limited to performance data, never transcripts.

### Proposed text (v3.2.0) — changed material in **bold**

> ### VII. Minors' Data Minimalism
> Collect the minimum: name, grade, **gender,** and the interest signals the
> tutor actually uses. **Gender is collected so the tutor addresses the student
> correctly — the tutor's prompts default every student to masculine pronouns
> and vocatives today, which is a defect, not a design choice. Gender MUST be
> used for address and voice only: never for content gating, and never sent to
> a third-party analytics tool.** Per the new PRD the student owns the account,
> with the parent as a linked view rather than the account holder; a parent
> contact SHOULD still be captured for every student as the working default
> until legal review says otherwise (PRD §9) — **capture is deferred from
> signup for the Student MVP release: signup collects email, password and
> gender only, the student-to-parent link exists in the data model, and parent
> contact capture and the parent view ship in a later release.** Where identity
> is a picker rather than an account — as in the comparison PoC — it is
> explicitly NOT auth, MUST be validated server-side on every request, and MUST
> never be presented to a user as a login. **The Student MVP solution now uses
> real, database-backed accounts; the picker clause above binds only a solution
> that still uses a picker, which today means the frozen baseline.** Student
> conversations are never exposed to other students, and what a parent sees is
> limited to performance data, never transcripts. **A named operator role,
> `student-data`, may read a student's full interaction record read-only for
> support and quality work. Every such read MUST be logged — who read it, whose
> record, and when — and that read log is itself retained. The interaction
> record is retained at full fidelity for now: an explicit decision by Samuel,
> who accepts responsibility for it, standing until a retention policy (what is
> kept, for how long, what is purged) is set — which MUST happen before this
> data is opened to any audience wider than the current operator roster. No
> disclosure that a student is talking to an AI is added at signup for this
> release; Samuel takes responsibility for that decision. This exception holds
> until Samuel sets the disclosure text, or before any audience wider than the
> invited pilot, whichever comes first — at that point disclosure at signup
> becomes required again.**

---

## Why MINOR not MAJOR

Nothing existing is removed or redefined: the minimum-collection rule stays the rule, the two
existing prohibitions (other students never see each other's data; parents never see transcripts)
stand unchanged, and the picker clause still says exactly what it said, only scoped to where it
still applies. What is added is a new collected datum with a stated purpose and limit, a new named
privilege with a logging obligation, and two exceptions that are explicitly bounded, attributed and
reversible rather than open-ended — the same shape Principle III's suspension already uses. That is
"materially expanded," the MINOR case in `docs/VERSIONING.md`, not a redefinition.

---

## What this does NOT change

- **II Grounded Teaching Only** — untouched; explanations still come only from stored canonical
  solutions and library entries, gender or no gender.
- **III The Review Gate** — untouched; `student-data` transcript access is a different thing from
  the content review gate, and `content-review` remains the safety control this proposal does not
  touch.
- **VI Cost Discipline** — untouched; per-student spend instrumentation is unaffected by what datum
  is collected or who may read a transcript.
- **VIII MVP Non-Goals** — untouched; multi-child parent accounts remain a non-goal. The
  student-to-parent link this proposal discusses is one student linkable to one parent contact, not
  a parent-owned account holding several children.
- **XI Solution Integrity** — untouched; the new operator-read log and the gender datum carry
  `environment` and stay inside one solution like every other table, which is XI already applying,
  not XI changing.

---

## How to apply on approval

1. Edit `.specify/memory/constitution.md`:
   - Prepend the block under "Proposed Sync Impact Report" above to the top of the header comment,
     with "Version change" / "Amended by" as written there (drop the word "Proposed").
   - Change the existing top entry's label from the live entry to a "Previous: 3.0.0 → 3.1.0 (…)"
     line, exactly as the file already chains every prior amendment.
   - Replace the body of `### VII. Minors' Data Minimalism` with the proposed text above, with the
     bold markers removed (they exist only to show the diff in this proposal).
   - Update the file's closing line to
     `**Version**: 3.2.0 | **Ratified**: 2026-08-02 | **Last Amended**: <approval date>`.
2. Commit message suggestion:
   `docs(constitution): amend Principle VII for gender, operator transcript access, and deferred
   disclosure (v3.1.0 → v3.2.0)` — body citing D1, D7, D10 and `specs/002-identity-and-admin-console/`.
3. Spec files that should then cite v3.2.0 (not v3.1.0) once this lands: `specs/002-identity-and-
   admin-console/spec.md`, `decisions.md` and `traceability.md` (all three currently drafted against
   this proposal, not yet the applied text), and `docs/PROJECT_STATE.md`'s constitution-version line.
