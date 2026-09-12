# ADR-0008 — Generate the question bank, review a 10% sample

**Status**: Accepted
**Date**: 2026-09-10
**Decider**: Samuel (CTO, solution architect)
**Supersedes**: the question-bank carve-out in ADR-0007 / constitution v2.0.0 Principle III
**Constitution**: amended to **v2.1.0** by this decision

## Context

The comparison build replaced Elo with Bayesian Knowledge Tracing. Measured on the same
answer sequence, BKT reaches the `advanced` tier after **two** correct answers where the Elo
model needed **six**. The question selector is unchanged — same file, same thresholds — so
the practical effect is that students arrive at the top of the difficulty ladder three times
faster than before.

What is waiting for them there is thin. Counted against the live bank:

| | |
|---|---|
| Live questions | 450 — basic 140, standard 192, advanced 118 |
| Objectives with all three tiers | 79 of 90 |
| Objectives with **no** advanced question | **5** |
| Objectives with **exactly one** advanced question | **52** |

`pickQuestion` prefers the target tier and then the least-drilled item. Once the single
advanced item for an objective is spent, a student the model places at 98% is served the
standard or basic question again. The thinnest objectives are concentrated in Unit 1, which
is where a Prep-3 student begins: *Relation on a set* has one question in total.

Elo largely hid this, because students rarely reached `advanced` at all. BKT surfaces it in
the first week — which means the comparison would be measuring, in part, a bank that runs out
rather than a teaching model that works.

Constitution v2.0.0 Principle III explicitly excluded question banks from the review-gate
suspension. There is no mathematics reviewer on the team, so under that rule the gap could
not be closed before the pilot.

## Decision

**Generate questions to fill the tier gaps, ship them unreviewed in the comparison
environment, and have Samuel review a 10% sample.**

In his words: *"I am ok to add unreviewed content by math, I will review 10% of the questions
you generate… we have to have more questions based on the different levels, the bank of data
and questions and skills need to be improved, this is a mandatory step."*

Four conditions travel with it.

1. **The book stays the constant; the generated bank is an extension.** `parity_check.py` now
   fingerprints only questions whose `source` is `seed` or `authored` — the 450 items that
   came out of the ministry textbook. Generated items (`source='variant'`) are counted and
   reported but never compared, and the check now **fails loudly if any generated row appears
   in the baseline**, which is a governance breach rather than a parity problem.
2. **Two acts, two decisions.** The loader lands rows as `status='review'`. Making them
   visible to students requires `--promote`, explicitly.
3. **The sample is drawn, not claimed.** `--sample 10 --seed N` writes the selected ids to a
   review-queue file. Size and membership are auditable after the fact.
4. **Every generated item names its parent.** `parent_question_id` points at the reviewed book
   question it was derived from, so a defect found in the sample can be traced to its family
   and that family retired as a unit rather than the whole bank being distrusted.

## Consequences

**Question supply becomes a variable in the comparison.** The baseline exhausts its advanced
tier; the comparison environment does not. That is a real change to what the experiment
measures, and it must be stated whenever the result is: some part of any measured difference
is "the student was asked a question at their level" rather than "the tutor taught better."
Samuel accepted this — it is consistent with decisions.md Q4, where the variable was already
the whole PRD experience rather than a single change.

**The failure mode is worse than it was for explanations.** An unreviewed explanation is
wrong about a question a human approved. An unreviewed question can be wrong in itself: a
broken stem, an answer key that disagrees with its own worked solution, a distractor that is
also correct. A student who trusts the product then practises an error and is marked wrong
for being right. A 10% sample reduces that risk. It does not remove it, and no claim in this
repository should imply that it does.

**What structural validation can and cannot catch.** The loader rejects a tier the selector
cannot ask for, an MCQ whose correct answer is not among its own choices, duplicate choice
text, an empty canonical solution, and a distractor naming a misconception that belongs to a
different objective. It cannot catch mathematics that is plausible and wrong. That is exactly
what the human sample is for, and it is why the sample is a condition of this decision rather
than a nice-to-have.

**One genuine gain beyond coverage.** Generated distractors carry a `misconception_id`. That
makes a wrong answer *diagnostic*: it selects the matching refutation entry from the
explanation library directly, without a classifier that does not exist yet. It is the first
thing on this branch that closes the loop between the Phase 6 library and the questions
students actually answer.

## Alternatives considered

**Do nothing and accept repeats.** The spec already permits it — *"the product repeats or
stops honestly; it does not generate unreviewed questions to fill the gap."* Rejected: on a
seven-week pilot with BKT's pacing, the ceiling is reached early enough that "the bank ran
out" would contaminate the result rather than merely limit it.

**Author the new items by hand.** Correct and safe, and blocked on the same missing person as
the crisis-escalation channel: there is no mathematics SME on the team.

**Extend both environments symmetrically.** Preserves parity perfectly, and is forbidden by
the bounding condition that has held since ADR-0007 — unreviewed content never reaches
`ainext.reletix.com`.

## Open

- **Volume and pacing.** This decision authorises the direction; it does not fix how many
  items to generate. First target is the coverage floor: every objective carries at least one
  item per tier. Beyond that, generation should follow measured exhaustion rather than a
  round number.
- **What happens when the sample finds a defect.** The retire-the-family rule above is the
  proposal, not yet a ratified policy. It needs a decision the first time a review rejects
  something.

## Resolved since

- **Student-facing disclosure (2026-09-12).** Samuel: keep it hidden for the pilot. Telling a
  student that a question is machine-written would change how she answers it, and that change
  lands inside the metric being measured. Provenance stays fully visible on operator surfaces
  (`/admin/content`, `/spine`). This is explicitly a pilot-scoped decision: promoting the
  environment to any wider audience already requires reinstating the review gate, and disclosure
  should be settled in the same act rather than inherited by default.
- **Generation moved from hand-authoring to template families (2026-09-12).** The first bundle was
  twelve hand-written items. That does not scale to the volume the coverage gap needs, and more
  importantly it does not scale the *review*: a 10% sample of freely authored items leaves every
  unread item an independent risk. Template families change what the sample means — every item in
  a family shares one structure and differs only in sampled numbers, and the answer key is computed
  by the same code that writes the stem, so the key cannot disagree with the question. Reading one
  instance validates the family. The residual risk moves from "this item is wrong" to "this family
  is uniformly wrong", which is rarer, more visible in a sample, and retirable in one act.
