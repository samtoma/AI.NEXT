---
name: requirement
description: Propose a new requirement for the AI tutor, or change an existing one, targeted at a specific version. Use when someone says the product SHOULD do something it does not, that a requirement is wrong or stale, or that the spec has drifted from the PRD. Always establishes which requirement and which target version before filing.
---

# Propose or change a requirement

A requirement says **what** and **why**, never **how**. It is an obligation the
build can be audited against, not a feature name.

This skill files a proposal. **It does not create the requirement** — only Samuel's
triage does that, because a requirement is a commitment and the spec is where
commitments live (`docs/FEEDBACK.md`).

## The two versions this skill must separate

People conflate these constantly, and the difference decides where the issue goes:

| | Question | Answer is |
|---|---|---|
| **Observed on** | Which build made you notice? | A tag, a local build, or unknown |
| **Targeted for** | Which version should satisfy this? | A milestone — the next one, usually |

A requirement proposal **must** carry a *targeted for*. Feedback carries *observed
on*. When someone is really reporting a problem rather than proposing an
obligation, use the `feedback` skill instead.

## Step 1 — new requirement, or change to an existing one?

Ask. They are different issues with different consequences.

**Changing an existing requirement is the more serious of the two**, because an id
is permanent and something may already have been built against it. Get the id and
verify it is real:

```bash
grep -nE "^\| (FR|SC)-[0-9]+ " specs/001-student-mvp1-delta/traceability.md | grep -i "<keyword>"
```

If the id does not exist, say so and treat it as a new requirement instead.

Two changes are already known to be needed and are **Tamer's to make** — if the
user is raising either, say it is already identified and file against it:

- **`SC-004`** measures "verified signups" after signups became an identity
  picker. It cannot be measured as written.
- **`SC-011`** forbids serving unreviewed questions that ADR-0008 now explicitly
  permits. The prohibition is no longer the policy.

## Step 2 — which version is this targeted for

**Never assume.** Get the real milestones and ask with AskUserQuestion:

```bash
gh api "repos/samtoma/AI.NEXT/milestones?state=open" --jq '.[] | "\(.title) — \(.description)"'
```

Offer the open milestones, plus:

- **"Next version"** — resolve it to the actual open milestone, do not write the
  words "next version" into the issue.
- **"Later / not yet scheduled"** — a legitimate answer. It files with the
  `roadmap` label and lands in `docs/ROADMAP.md` at triage. Deferring is a
  decision and stays visible; it is not a soft no.

If the user is proposing something for a version that has already shipped, say
plainly that a shipped version cannot gain requirements — it targets the next one,
and if the shipped build is wrong *that* is a defect.

## Step 3 — make it a requirement, not a wish

Three things, and the third is the one people skip:

1. **The obligation.** One sentence, worded as MUST or SHOULD, naming the actor.
   *"The tutor MUST tell a student when it cannot read their uploaded page,
   rather than teaching from a guess."*
2. **Why — what breaks without it.** If nothing breaks, it is an idea rather than
   a requirement. That is fine; say so, and file it as feedback instead.
3. **How would we know it works.** The check that would move it to VERIFIED. Be
   concrete — a test, a query, a thing someone can do and see. **A requirement
   with no stated proof cannot ever be closed honestly**, and this repository
   gates on exactly that.

Push back once if the proposal is really a solution in disguise ("add a retry
button"). Ask what would go wrong without it, and write *that* as the obligation.

## Step 4 — file it

```bash
gh api repos/samtoma/AI.NEXT/issues \
  -f title="[req] Tutor must say when an upload is unreadable" \
  -f body="$(cat <<'BODY'
**Kind:** change to an existing requirement
**Requirement:** FR-205
**Observed on:** PDR1-0-v0.2.0
**Targeted for:** PDR1-0-v0.3.0
**Solution:** PDR1-0

### The obligation
...

### Why — what breaks without it
...

### How we would know it works
...
BODY
)" \
  -f 'labels[]=requirement' -f 'labels[]=needs-decision' \
  -F milestone=<milestone-number>
```

Get the milestone number from the API call in step 2. Then give the user the URL
and tell them plainly: **this is a proposal awaiting triage, not a commitment.**

## What happens next, so you can set expectations honestly

At triage the issue gets exactly one outcome, written on it: `accepted` (becomes a
numbered requirement with a row and tasks), `roadmap` (deferred to a named
version, stays open), `declined` (closed, with the reason recorded), or
`needs-decision` (waiting on Samuel).

Only after `accepted` does anyone touch the spec — on a branch named
`req/<id>-<slug>` off the solution branch, because editing `spec.md` and
`traceability.md` is a reviewed change and `CODEOWNERS` routes specs to Samuel and
Tamer. See `docs/BRANCHING.md`.

## Never do these

- **Never write to `spec.md` or `traceability.md` from this skill.** A proposal is
  not a requirement. CI gates on the matrix, and a speculative row breaks it.
- **Never allocate an `FR`/`SC` id.** Ids are permanent and are assigned at triage.
  Guessing the next free number races anyone else doing the same.
- **Never create a branch.** A proposal changes nothing yet.
- **Never file the same proposal twice.** Search first:
  `gh api "repos/samtoma/AI.NEXT/issues?state=all&labels=requirement" --jq '.[].title'`
- **Never decide.** If the user asks whether it will be built, the answer is that
  triage decides and the outcome will be written on the issue.
