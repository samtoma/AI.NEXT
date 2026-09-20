# Branching — what gets a branch, and what deliberately does not

The short version: **a branch is for a change to the repository.** An observation
is not a change. A proposal is not a change. Most of what flows through this
project should never create one.

## The long-lived branches

One per solution, kept indefinitely, neither an environment of the other
([ADR-0010](decisions/0010-one-branch-per-solution.md)).

| Branch | Solution | Rule |
|---|---|---|
| `main` | shared trunk | Default branch; still what CI deploys to `ainext.reletix.com`. **Not to be touched.** Retiring it is a production change and has not been approved (`T137`). |
| `family-tutor` | Founding Families — parent-sold, Arabic RTL, three subjects, Elo | Frozen because nobody is working on it. |
| `PDR1-0` | Student MVP — student-facing, English, maths only, BKT | Active. Carries its own `ci-cd.yml` and its own deploy trigger. |

Each solution branch carries its own copy of the workflow, so editing one can
never change what another deploys. The cost: the shared-box safety rails exist in
one copy per branch — **change a rail on every solution branch**, or the copy that
drifts is the one that prunes production's images.

## What gets a branch

| Thing | Branch? | Where it lives instead |
|---|---|---|
| **Feedback** — someone saw something | **No** | A GitHub issue. `feedback` skill. |
| **Requirement proposal** — the spec should say X | **No** | A GitHub issue. `requirement` skill. |
| **Triage outcome** — accepted / declined / deferred | **No** | A label and a comment on the issue. |
| **Accepted requirement** — the spec now says X | **Yes** | `req/<id>-<slug>` |
| **Implementation** — code that satisfies a requirement | **Yes** | `feat/<task>-<slug>` or `fix/<id>-<slug>` |
| **Content review verdicts** | **No** | Data files (`*.verdicts.json`), loaded by the pipeline. |
| **An agent's working session** | **Yes, briefly** | `claude/<slug>` — squash-merge and **delete**. |

The line is worth stating because it is the one people get wrong: **a proposal is
not a commitment, so it does not get a branch.** Branching on every idea produces
a repository full of half-specs nobody merged, and a spec that says things nobody
agreed to.

## Branch naming

```
req/FR-205-upload-unreadable     a requirement changed or added, after triage
feat/T141-engagement-signal      implementation of a task
fix/FR-205-anchored-regex        a defect against a named requirement
claude/<slug>                    an agent session — temporary, always deleted
```

Prefix with the id wherever one exists. It is what makes `git log` searchable by
requirement six months later, and it is the same key the issue, the matrix row and
the test annotation use.

## The lifecycle, end to end

```
  issue          triage           req/ branch         feat/ branch        tag
  (anyone)   →   (Samuel)    →    spec + matrix   →   code + test    →    release
  no branch      no branch        reviewed            reviewed            PDR1-0-vX.Y.Z
```

1. **Issue.** Feedback or proposal. No branch, no spec edit.
2. **Triage.** One of five outcomes, written on the issue. Still no branch.
3. **`req/` branch.** Only for `accepted`. Adds the `FR`/`SC` to `spec.md` and a
   row to `traceability.md`. `CODEOWNERS` routes `specs/` to Samuel and Tamer, and
   `./scripts/traceability.py --check` fails CI if the row is missing or orphaned.
   Merge this **before** implementation starts — the requirement is the contract,
   and writing the contract after the code is how a build passes its own exam.
4. **`feat/` branch.** Implementation, plus a test carrying `@covers FR-nnn` where
   one is possible. The PR template asks for requirement, task, ADR and proof.
5. **Tag.** When requirements move to VERIFIED, the changelog names them and the
   solution is tagged `PDR1-0-vX.Y.Z`. See [VERSIONING.md](VERSIONING.md).

Steps 3 and 4 can be one branch for something small. They should not be one branch
for anything contested, because the argument about *what we promised* is a
different argument from *does this code work*, and merging them means having both
at once.

## Versions, and the two questions that get confused

- **Observed on** — which build someone saw something on. Belongs to feedback. A
  git tag, a local build with its commit, or honestly `unknown`.
- **Targeted for** — which version should satisfy a requirement. Belongs to
  proposals. A GitHub **milestone**, which is how a version becomes a thing
  requirements can be assigned to before it exists.

A shipped version cannot gain requirements. If a shipped build is wrong, that is a
defect against a requirement it already had.

## Agent working branches — the rule that was learned the hard way

On 2026-09-15 a cloud agent session committed to `claude/tamer-shared-drive-access-ddpypu`,
a branch that had been renamed to `PDR1-0` two days earlier and deleted. It
produced a day of genuinely good work — a computed traceability tool, CI gates —
in parallel with, and invisible to, the work on `PDR1-0`. Reconciling the two cost
more than either.

**So: squash-merge an agent branch into its solution branch and delete it, the
same day.** A branch that still exists is a branch something will commit to. If an
agent session is long-running, point it at the solution branch by name and confirm
that name is still current before it starts.

### The v0.3.0 absorption, and one deliberate exception to the squash rule

On 2026-09-20 three branches were merged into `PDR1-0`: `wip/q3-q4-explore`
(the Noor Play skin plus ten Prototype 1.1 fixes), `claude/noor-play-design-system`
(absorbed with no net change — `wip/q3-q4-explore` was cut from it and carried a
later draft of the same triage document) and `claude/widget-render-fixes`.

They were **merged, not squashed**, against the rule above. The reason is
specific and does not generalise: the closing comment on each of GitHub issues
#16, #19, #21, #26, #31, #40, #41 and #42 cites an individual commit SHA as its
fix evidence. Squashing would have made all eight unreachable from `PDR1-0` and
broken the trail from the issue to the change that closed it. **Squash by
default; merge when something outside the repository points at a commit inside
the branch.**

### Deleting a branch may need a human

Agent sessions running in the cloud execution environment can push commits to an
existing branch but get **HTTP 403 on any ref create or delete** — no tags, no
branch deletion. So an agent can absorb a branch and cannot finish the job.

Whoever is cleaning up after a merge like the one above runs:

```
git push origin --delete wip/q3-q4-explore \
                         claude/noor-play-design-system \
                         claude/widget-render-fixes
```

All three are ancestors of `PDR1-0`, so nothing is lost. If they are still on the
remote, that is why.

## What is deliberately not here

- **No `develop` branch.** Two solutions that release independently do not share
  an integration branch; it would only re-create the coupling ADR-0010 removed.
- **No release branches.** A tag on the solution branch is the release. Backporting
  to a pilot with fewer than 50 families is not worth a branch that must be
  maintained.
- **No forks for internal work.** Tamer's fork exists and is fine for reading;
  contributions come as branches on the main repository so CI and `CODEOWNERS`
  apply to them.
