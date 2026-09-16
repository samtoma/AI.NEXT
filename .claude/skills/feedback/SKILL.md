---
name: feedback
description: File feedback on a released version of the AI tutor — something you saw using it, good or bad, or something a real parent, school or buyer said. Use when anyone reports an experience, an observation, a complaint, praise, or market input. Always establishes WHICH VERSION the feedback is about before filing anything.
---

# Feedback on a version

Turns an observation into a GitHub issue that triage can act on. **You do not need
to read code to use this.**

Feedback is an *observation*, not a commitment. It does not change the spec, does
not create a requirement, and does not touch a branch. Triage decides what it
becomes — see `docs/FEEDBACK.md`.

## Step 1 — establish which version, and never skip this

**A piece of feedback with no version attached is close to useless**: it cannot be
reproduced, it cannot be closed by a fix, and six weeks later nobody knows whether
it still applies. Ask before anything else.

Get the real list — never invent version numbers:

```bash
git tag -l 'PDR1-0-*' --sort=-creatordate
gh api repos/samtoma/AI.NEXT/milestones --jq '.[] | "\(.title) [\(.state)]"'
```

Then **ask the user with AskUserQuestion** — do not guess, and do not assume "the
latest". Offer the tags you found, plus these two, which are real answers:

- **"Local build"** — they ran `./scripts/local-dev.sh` themselves. Also ask for
  the commit: `git rev-parse --short HEAD`. A local build is not a version, and
  the feedback must say so rather than implying a release is broken.
- **"Not sure"** — accept it. Record `version: unknown` and say in the issue that
  it needs establishing at triage. **An honest "unknown" beats a guessed tag**,
  because a wrong version sends someone to reproduce against the wrong build.

If the repository has **no** `PDR1-0-*` tag, stop and say so: there is nothing to
give feedback *on* yet, and someone needs to cut a version first
(`docs/VERSIONING.md`).

## Step 2 — which kind of feedback

Ask if it is not obvious from what they said:

| Kind | It is this when | Labels |
|---|---|---|
| **Product** | About the experience — what a student or parent would feel | `feedback`, `product`, `triage` |
| **Market** | What a real parent, school or buyer actually said | `feedback`, `market`, `triage` |
| **Defect** | Something is broken, wrong, or unsafe | `defect`, `triage` |

A defect is different from the other two: it violates a requirement that already
exists. If you can find the `FR`/`SC` id it violates in
`specs/001-student-mvp1-delta/traceability.md`, name it. If no requirement covers
it, **say so in the issue** — that gap is itself the finding, and it becomes a
requirement proposal rather than a bug.

## Step 3 — capture what they saw, not what they think we should build

Ask for: **where** (which screen or moment), **what happened**, **what they
expected instead**, and **how much it matters**.

Write it in their words. An observation survives being wrong about the cause; a
proposed solution usually does not. If they offer a fix, keep it — but put it
under a "They suggested" heading, clearly separated from what was observed.

For **market** feedback, push for the raw quote. What a parent actually said is
worth more than a summary of it, and an objection nobody can answer is worth more
than praise.

## Step 4 — file it

Use `gh api` rather than `gh issue create`: it does not shell out to git, so it
works even where the local git is broken.

```bash
gh api repos/samtoma/AI.NEXT/issues \
  -f title="[product] Widget handles jump when you tab between them" \
  -f body="$(cat <<'BODY'
**Version:** PDR1-0-v0.2.0
**Surface:** /dev/widget-questions
**Severity:** annoying but workable

### What happened
...

### What I expected
...
BODY
)" \
  -f 'labels[]=feedback' -f 'labels[]=product' -f 'labels[]=triage'
```

The body **must** open with the version line. Then give the user the issue URL.

## Never do these

- **Never invent an `FR` or `SC` id.** Only triage creates requirements. Naming a
  requirement that does not exist puts a fake id into a matrix that CI checks.
- **Never edit `spec.md` or `traceability.md`.** Feedback is an inbox, not a
  commitment.
- **Never create a branch.** An observation changes nothing in the repository.
- **Never promise the feedback will be acted on.** Most feedback should not become
  a requirement, and saying otherwise makes triage look like a rejection.
- **Never file a duplicate without checking.** Search first:
  `gh api "repos/samtoma/AI.NEXT/issues?state=all&labels=feedback" --jq '.[].title'`
  If it exists, add a comment to that issue instead — a second voice on the same
  observation is stronger evidence than a second issue.
