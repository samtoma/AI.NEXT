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
3. Bump `app/package.json` on that solution branch, move the Unreleased entries
   under the new version with the date, and tag: `PDR1-0-v0.2.0`.
4. Tags are per solution and prefixed with the branch, because the two solutions
   version independently and a bare `v0.2.0` would be ambiguous.
