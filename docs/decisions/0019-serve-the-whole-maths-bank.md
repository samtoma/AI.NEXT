# ADR-0019 — Serve the whole maths bank on the open site

**Status**: Accepted — Samuel, 2026-09-23, on finding the live site had none of the generated maths content · **Note 2026-09-25** (accepted; on the feature branch, not merged): extended to the Grade 10 American maths course; see [the note](#note--samuel-2026-09-25-the-grade-10-american-maths-course-is-covered) · **Note 2026-10-01** (accepted; on the feature branch, not merged): extended to the fan-out process itself and a new internal review backlog; see [the note](#note--samuel-2026-10-01-answer-37-the-fan-out-itself-and-an-internal-review-backlog)
**Affects**: [constitution](../../.specify/memory/constitution.md) v3.1.1 → **v3.2.0** (Principle III) · `FR-907` in [`specs/001-student-mvp1-delta/spec.md`](../../specs/001-student-mvp1-delta/spec.md), **dropped** · the "Generated maths content" step in `.github/workflows/ci-cd.yml` · student-facing copy in `app/src/components/{chat,student}/` that claimed content was "reviewed"
**Related**: [ADR-0007](./0007-student-mvp1-comparison-build.md) and ADR-0008 (the exception this widens) · [ADR-0006](./0006-arabic-language-vertical.md) (the sacred-content gate this does not touch) · [ADR-0018](./0018-course-availability.md) (which course a student sees at all)

## Context

After the 2026-09-23 deploy, Samuel saw the console's Content page report zero generated questions.
The count was accurate. The first-boot step in the deploy loaded only the textbook questions, and
none of the three bundles local setup loads from `services/extraction/seed/generated/`:

| Maths | Laptop | noor.reletix.com |
|---|---|---|
| Book questions | 450 | 450 (421 live, 29 at review) |
| Generated questions | 543 | 0 |
| Widget questions | 49 | 0 |
| Misconceptions | 96 | 0 |

Loading them was not only a deploy fix. Constitution III allowed unreviewed generated content only
on a deployment "behind Cloudflare Access with an explicitly invited audience" (FR-907), and
noor.reletix.com is open. Of the 591 live generated and widget questions:

- 52 were read by a human.
- 413 were accepted through a sibling of the same template family.
- 126 have been read by nobody.

## Decision

In Samuel's words: *"let's change the rules, get everything live until I say otherwise, keep the
review status for the admin view only, I take the responsibility here, I need all, please proceed,
I manage the distribution myself directly."*

- **Everything in the maths bank is live on noor.reletix.com until Samuel revokes it.** That covers
  generated questions, widget questions, the misconception catalogue, and the 29 book questions
  that were still at `review`.
- **Review status is kept, never erased.** The generated bundles are replayed with `--restore`, so
  every row carries the status and review stamp it actually has. The 29 book questions go live
  with **no** reviewer stamp. Nothing asserts a review that did not happen (FR-1110).
- **Review status is shown to operators only.** The console's provenance badges are unchanged. On
  student surfaces, every line that told a student content was "reviewed" is now neutral ("worked
  solution", "grounded in the lesson"). The one "unreviewed" marker, behind the lesson's hidden
  debug receipts, is gone.
- **FR-907 is dropped.** The operator console keeps its own Access policy.
- **Not covered**:
  - Principle IV is untouched: the Arabic Quran and hadith passages held by the sacred-content
    gate stay held.
  - Social Studies and Arabic are not part of this decision.
  - The frozen baseline exclusion stands.

## Consequences

- **One-time load.** The deploy loads the bundles once, while the generated bank is missing, and
  never again. A later deploy cannot reload over live data or re-promote a question an operator
  has since held back. New generated content arrives through a content refresh, as before.
- **The cost is the one constitution III already names**, now reaching an audience nobody invited
  individually. An unreviewed question can be wrong in itself: a broken stem, or an answer key that
  disagrees with its own solution. A student can then be marked wrong for being right. The 10%
  human sample and the family validation reduce that risk; they do not remove it.
- **Revoking it is exact.** Every live maths question a human has not read lacks a reviewer
  stamp, so this puts exactly those back behind the gate:

  ```sql
  update questions q set status = 'review'
   where q.status = 'live' and q.reviewed_by is null
     and exists (select 1 from node_subject ns
                  where ns.node_id = q.lo_id and ns.course_id = 'course:prep3-math-en');
  ```

  Any rows added after this decision would need their own check before running it. The
  misconception catalogue has no status column; revoking it means removing the rows or gating their
  use, which is a separate change.

## Note — Samuel, 2026-09-25: the Grade 10 American maths course is covered

**Accepted ("ok for all"); on the feature branch, not merged.** On 2026-09-25 Samuel answered spec 003's question 2 — *"I would take your
recommendations"* ([decisions.md](../../specs/003-curriculum-tracks/decisions.md) #9). This decision
was written when the maths bank was one course, and its revocation query names only
`course:prep3-math-en`. **It now also covers the second maths course**, `course:us-g10-math-en`
(Siyavula *Everything Maths* Grade 10, American curriculum —
[ADR-0024](./0024-curriculum-as-a-visibility-dimension.md)).

- **Switching the course on in the console is the gate.** Once an operator makes the G10 course live
  for a grade, its whole bank is served to those students: book questions, generated questions,
  widget questions and its misconception catalogue, whether a human has read them or not.
- **Everything above still holds for it.**
  - Review status is kept and never erased.
  - Nothing is stamped as reviewed by this decision.
  - Status is shown to operators only.
  - The 10% family sample is still drawn and read (ADR-0005 amendment, gate G3).
  - Items the solutions gate disputed, and families rejected at G3, stay held.
- **How it reaches production.** The course's content is made live in the data before it is exported
  (the book questions without a reviewer stamp, as the 29 Prep-3 book questions were). The "Load a
  course" action replays the export with `--restore`. The course itself stays hidden until an
  operator's rule says otherwise (spec 003 FR-4202, FR-4208).
- **Revoking it** puts unread G10 items back behind the gate exactly as for Prep-3. Run the query
  above with `course_id = 'course:us-g10-math-en'`, or with `IN` both courses. Or simply hide the
  course in the console, which removes it from every student at once.

## Note — Samuel, 2026-10-01 (answer 37): the fan-out itself, and an internal review backlog

**Accepted; on the feature branch, not merged.** Asked how to fill the Grade 10 American course,
Samuel: *"I am on an early phase, and I always always want to see the whole extraction appear… keep the
student always full as if everything has been reviewed… please consider and fan out the full book for
me, and in the background create agents with the review process so we can review from the console
page."* ([`specs/003-curriculum-tracks/decisions.md`](../../specs/003-curriculum-tracks/decisions.md),
decision 58; [`docs/WIP-g10-pilot/samuel-answers.md`](../../docs/WIP-g10-pilot/samuel-answers.md),
answer 37.)

- **Extended to the fan-out process itself, not only to what the bank already holds.** The 2026-09-25
  note above covers the G10 course's bank once it is extracted and loaded. This note covers the
  **extraction run**: the pipeline's human-sign-off gates G1 (objectives and prerequisite links), G2
  (solution disputes), G3 (the family and widget-mapping sample) and G4 (refutations) now proceed on
  the AI checks' own recommendation while fanning out to the rest of the book, **maths only**. A chapter
  is not held waiting for Samuel, Tamer or Kamil to clear it before its content reaches students.
- **Automatic safety checks are not relaxed.** Broken maths, an answer that disagrees with the book (the
  printed answer, the EPUB solution and the blind re-solve must still agree), and the drift guard
  (`parity_check.py`) still hold an item exactly as before. Only the *human sign-off* step leaves the
  critical path; the pipeline's own checks do not.
- **A new, ongoing internal review backlog takes the pre-promotion gate's place**
  (`specs/003-curriculum-tracks/spec.md`, FR-4501…FR-4509). Every item with no human stamp — a
  solution, a correction, a generated question, a widget mapping, a misconception, an objective or
  prerequisite link, a figure shown as the book's own image for now — is a row in the console's
  backlog. Samuel, Tamer and Kamil review it one by one, **after** it is already live to students, not
  before: approve (the human stamp), fix requested (unchanged for the student, flagged for later), or
  reject (removed from students, never deleted). The goal is an empty backlog, not a gate nobody can
  pass in time.
- **"Reviewed" means only a human stamp** (decision 54, answer 33). An AI check that passed, however
  many independent passes, shows in the console as "AI-checked, awaiting human," never as "reviewed."
  This sharpens, rather than changes, what this ADR and constitution Principle III already said — review
  status was always an operator fact, never asserted to a student; this note makes explicit what counts
  as that fact, and names the one new way an item can be pulled back (reject) without reinstating the
  gate for anything else.
- **A figure the pipeline cannot yet draw natively is shown as the book's own image, temporarily**
  (`spec.md` FR-4508, reversing the 2026-09-27 "native only, wait" decision for students only — see
  decision 50/answer 29). Until its native renderer exists, the lesson is not held back for the figure.
  The figure-gap inventory and Samuel's kind-by-kind approval (FR-4321) are unchanged; this changes only
  what a student sees while waiting.
- **Still not covered, unchanged**: Social Studies and Arabic keep their existing review queue; Quran
  and hadith passages held by Principle IV stay held, always.
- **Open, not decided here**: whether this also covers **G5** — the dry-run delta, coverage, drift and
  cost ledger go/no-go before a course is promoted to production (`FR-4209`) — which reads as a
  production-readiness check rather than a per-item content review. Answer 37c named G1–G4 only; see
  `spec.md`'s *Open questions for Samuel*.
