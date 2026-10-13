# ADR-0025 — Homework ask: Noor may work a student's own question, flagged as self-worked

**Status**: **Proposed — awaiting Samuel.** Raised by Tamer, 2026-10-13, with the homework-ask
design handoff (`design_handoff_home_ask`). Built on the prototype branch `proto/homework-ask`
only. **Nothing here may reach `staging` or `main` until Samuel accepts or amends it**, because
both deploy, and the behaviour below contradicts a principle that binds every deployed surface.
**Would amend**: [constitution](../../.specify/memory/constitution.md) v3.3.0 → v3.4.0 (Principle II,
a named exception for one surface).
**Affects** (on the prototype branch): `db/migrations/040-homework-asks.sql` (new) ·
`app/src/lib/homework*.ts` (new) · `app/src/app/api/homework/` (new) ·
`app/src/app/api/ask/route.ts` (the `homework` surface) · `app/src/lib/session-rules.ts`
(`homework` session kind) · `app/src/components/student/HomeAskCard.tsx`,
`HomeworkSession.tsx` (new) · `app/src/app/(student)/student/ask/[id]/page.tsx` (new)
**Related**: [ADR-0007](./0007-student-mvp1-comparison-build.md) /
[ADR-0019](./0019-serve-the-whole-maths-bank.md) (the two existing bounded exceptions to the review
gate — the pattern this follows) · [ADR-0023](./0023-turn-limits-observed-not-enforced.md) (the
`homework` surface inherits "observed, not enforced") · spec
[`specs/004-homework-ask/spec.md`](../../specs/004-homework-ask/spec.md)

## Context

Students say their main use for a tutor is homework help. The design handoff makes "Got a question?
Ask Noor" the first thing on the home page: the student types a question or attaches a file
(one question or a whole worksheet), Noor reads it back, the student picks a question, and Noor
walks them through it.

Principle II says the tutor **never solves from scratch** and that for a question outside the book
"the ungrounded answer must never be produced at all". A student's homework question is, almost
always, not a row in our question bank — so it has no stored canonical solution. Under Principle II
as written the feature could only ever answer "I can't help with that one yet" for most real
homework.

Three options were put to Tamer (2026-10-13):

1. **Ground on the nearest material** — teach from the matched objective's canonical solutions and
   library entries as a worked analogue, never the student's own numbers.
2. **Strict** — walk through only questions that match a bank question with a canonical solution;
   refuse the rest.
3. **Free solve, flagged** — Noor works the student's own question, says so, and builds the
   safeguards into the walkthrough instead of into the source.

Tamer chose **3** for the prototype.

## Decision (proposed)

On the `homework` surface only, Noor may work the student's own question without a stored
canonical solution, under these safeguards — each of which the prototype implements:

1. **Provenance is always visible.** Every homework question shows "Noor worked this out itself,
   so double-check the answer." The "Checked against the textbook" state is reserved for a future
   match to a reviewed solution and is never shown in this round.
2. **No answer is handed over.** Noor says "Here's how I'd set it up", never "The answer is", and
   leads one step at a time with the student doing the working.
3. **Every walkthrough ends with a check the student does**: "Put your answer back into the
   question." A wrong setup then shows up in the student's own arithmetic.
4. **Noor never guesses an unreadable read.** An unclear part of an uploaded question is shown as
   `▒▒` and the student is asked for just that part before either walkthrough can start.
5. **"That doesn't look right" makes Noor re-check, not agree.** Every press is logged as a flag
   (`homework_flags`) for review.
6. **No mastery credit** is taken from homework in this round, so an unreviewed working can never
   move a student's mastery. The matched objective is logged only.
7. **Maths only.** A question the reader classifies as another subject gets "I only cover Maths so
   far" and no walkthrough.
8. **Grounding still rides along**: the matched objective, its unit and the curriculum list are in
   the prompt, so Noor uses the book's methods and vocabulary when one fits, and cites it.

## Consequences

- Principle II gains its first exception that produces an answer without a stored source. That is
  a real change in what the product promises; the safeguards above are what make it defensible,
  and they are why the exception is per surface rather than general.
- Every homework turn is logged on its own surface (`ai_interactions.surface = 'homework'`,
  session kind `homework`), so its cost and its flag rate can be read separately from teaching.
- The flags table is the review queue for self-worked answers. Nothing reads it in the console yet.
- If Samuel rejects this, the branch can fall back to option 1 or 2 by changing the homework
  system prompt alone — the data model and the UI do not depend on which option is chosen.

## Open for Samuel

- Accept, amend (option 1 or 2), or reject.
- Whether the exception should be limited to environments other than production at first, as
  ADR-0007 did for unreviewed content.
