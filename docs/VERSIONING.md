# Versioning — what carries a version, and what it means

Five things in this repo change independently. Giving them one version number
would be a lie about which of them moved, so they are versioned separately and
this file says how they relate.

| Thing | Scheme | Where | Changes when |
|---|---|---|---|
| **Constitution** | SemVer | `.specify/memory/constitution.md` | MAJOR = a principle removed or redefined · MINOR = added or materially expanded · PATCH = clarification. Amendments need Samuel's approval and a Sync Impact Report in the header. |
| **ADRs** | Sequential, immutable | `docs/decisions/NNNN-*.md` | Never edited after acceptance except to record that a **later** ADR amends them. A reversal is a new ADR, not a rewrite. |
| **Requirements** | Stable ids, amended in place | `specs/*/spec.md` + `traceability.md` | An FR id is permanent. Changing its meaning is an *amendment* stamped with the date and the ADR that caused it. Dropping one marks it DROPPED with a reason — ids are never reused. |
| **Solution release** | SemVer, per branch | `app/package.json` + `CHANGELOG.md` | MAJOR = a student-visible contract breaks · MINOR = a requirement moves to VERIFIED · PATCH = fixes with no requirement change. Each solution branch versions independently — they are separate products (ADR-0010). |
| **Content** | Digest, not a number | `parity_check.py` | The book set is identified by `source sha256` and its counts. A drift is a failure, not a version bump. |
| **Content bundles** | The database is the source of truth | `export_generated_content.py` → `seed/generated/` | Bundles are *exports* of state that was generated and reviewed, so **the review stamps travel with them**. This is why `--restore` exists and why it is forbidden on a freshly generated bundle: provenance is not something a generator gets to assert about itself. |

## Why requirements are not SemVer

A requirement is not an API. `FR-205` means the same thing on every branch and in
every conversation, and that stability is the whole point — it is the key that
joins an issue to a task to a test to a line in `traceability.md`. If the meaning
must change, the amendment is stamped and dated inside the row so the history is
readable, because someone reading a six-month-old issue needs to know which
version of the requirement it was filed against.

## The status vocabulary is part of the version

`traceability.md` defines: **VERIFIED** (executed here), **BUILT** (compiles,
never run), **PARTIAL**, **OPEN**, **BLOCKED**, **DEFERRED**, **DROPPED**.

The counting rule is that *a requirement is counted at its weakest part*. A
requirement is not "done" because code exists — `FR-205` was marked VERIFIED
while the feature was unreachable, and that mislabel was found by driving the
system rather than by reading the document. Treat VERIFIED as a claim that
someone ran it, and be willing to demote.

## Release procedure

1. Requirements move to VERIFIED in `traceability.md`, each with its proof.
2. `CHANGELOG.md` gets an entry under `## [Unreleased]`, written for a reader who
   does not know the codebase.
3. Bump `app/package.json` **and `package-lock.json`** on `main`, move the
   Unreleased entries under the new version with the date, and tag: `v0.5.0`.
4. **The tag is bare `vX.Y.Z` from v0.5.0 onward (changed 2026-09-22).**

   Tags used to be prefixed with the branch — `PDR1-0-v0.4.0` — because two
   solutions were both live and versioned independently, so a bare `v0.4.0`
   would not have said which product it named. `PDR1-0` was retired the day
   `main` became the single development branch, and a prefix naming a branch
   nobody can push to is worse than no prefix: it reads as a live thing.

   **The history is not rewritten.** `PDR1-0-v0.2.0`, `-v0.3.0` and `-v0.4.0`
   keep their names and keep pointing where they always did. `v0.5.0` is the
   next release of that same line; the changelog says so at the entry, because
   the break in the naming is exactly the kind of thing a reader six months out
   will otherwise misread as two unrelated products.

   If `family-tutor` is ever tagged, it takes `family-tutor-vX.Y.Z` — the rule
   was never "prefix everything", it was "say which product when it is
   ambiguous", and with one product that is developed it no longer is.
5. Write the release explainer into `docs/releases/<tag>.html` — the
   change-by-change page for the founders, who do not read diffs. The
   changelog says *what* changed; the explainer says what was reported, what
   was actually wrong, and what proves the fix.

### Step 3 usually needs a human

Agent sessions in the cloud execution environment can push commits to an
existing branch but get **HTTP 403 on any ref create or delete**. They cannot
create the tag. An agent that has done steps 1, 2 and the bump should say so and
hand over the exact command rather than reporting a release it could not finish:

```
git fetch origin main && git tag -a vX.Y.Z origin/main \
  -m "<one-line summary>" && git push origin vX.Y.Z
```

Tag `origin/main`, never a pinned SHA — the commit that records the pinned SHA
moves the head past it, so the instruction is stale before it is read.

## Branches

One branch per solution, both long-lived, neither an environment of the other
([ADR-0010](decisions/0010-one-branch-per-solution.md)).

| Branch | Solution | Rule |
|---|---|---|
| `main` | shared trunk | Default branch, still what CI deploys to `ainext.reletix.com`. **Not to be touched** — retiring it is a production change and has not been approved. |
| `family-tutor` | Founding Families — parent-sold, Arabic RTL, three subjects, Elo | Frozen, because nobody is working on it. Not frozen by an experiment's requirement — that obligation was withdrawn. |
| `PDR1-0` | Student MVP — student-facing, English, maths only, BKT | Active. Carries its own deploy trigger; deploy is manual-only while infrastructure is parked (`T139`). |
| `claude/*` | none | Working branches from agent sessions. Squash-merge into a solution branch and **delete**, or they accumulate and a second agent will commit to one you thought was gone. |

Each solution branch carries its own copy of `ci-cd.yml`, so editing one can never
change what another deploys. The cost is that the shared-box safety rails exist in
one copy per branch: **change a rail on every solution branch**, or the copy that
drifts is the one that prunes production's images.

## What is not versioned yet, and should be

- **The database schema.** Migrations are sequential (`001`…`010`) but nothing ties
  a schema state to a release tag, so "which migration is this deployment on" is
  answered by looking, not by reading.
- **The prompt kit.** Teaching behaviour changes when a prompt changes, and a
  prompt change is invisible in a diff of requirement statuses. The capture
  harness (`capture-prompts.mts`) can prove byte-identity but nothing versions it.
