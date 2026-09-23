# ADR-0019 — Serve the whole maths bank on the open site

**Status**: Accepted — Samuel, 2026-09-23, on finding the live site had none of the generated maths content
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
