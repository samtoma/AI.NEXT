# Roadmap

> **Scope note (2026-09-16).** This roadmap was first derived on the `claude/tamer-…` branch, which
> predated the [ADR-0010](decisions/0010-one-branch-per-solution.md) Clarification. It has been
> re-cut: there is no longer a *comparison environment* to stand up, and no cross-build comparison to
> read. Each solution is its own long-lived branch, deploys on its own trigger, and the comparison is
> an observational judgement Samuel and Tamer make from live usage. `SC-002` — the simultaneous
> side-by-side view — is **dropped**, not pending.

Derived from the repository, not from ambition. Every line traces to a
requirement, a task or an ADR that already exists — and where something is not
yet decided, it says so rather than inventing a date.

Regenerate the inputs with `./scripts/traceability.py`.

> **Target**: late September 2026, the start of the Egyptian school year.
> **Pilot success** (PRD): 50 paying families, ≥60% month-2 retention,
> measurable score lift.

## Where we actually are

| | |
|---|---|
| Requirements in the active spec | 96 (85 FR + 11 SC), all traced |
| Verified | 58 — of which **9 have a test**; the other 49 rest on a session someone ran once |
| Blocked | 3 — and none of the three is blocked on engineering |
| Tasks | 99 of 143 complete |
| Nothing has met the box | No solution has been deployed; infrastructure is parked by decision (`T139`) |

**The critical path is three items, and two of them are not code.**

## v1.0 — the pilot build *(now → late September)*

Everything here is required before a real student sees this.

### The three hard gates

| Gate | What it needs | Owner | If it slips |
|---|---|---|---|
| **T067 — name the crisis-escalation recipient** | A human being, a channel, and a response expectation | **Samuel** | No real students. FR-601, FR-602, SC-010 all sit behind it. This is the single most blocking item in the project and it needs a decision, not a sprint |
| **Deploy the `PDR1-0` solution** | The OCI box, Cloudflare Access, `deploy/.env` | Engineering + Samuel | `FR-907` stays blocked and no student can reach the product. **Parked by Samuel until local work is finished** (`T139`) — deploy is manual-only, so this gate is closed by choice, not by obstacle. |
| **T107 — who performs the 10% content review** | A named human who knows Prep-3 maths | **Samuel** | 130 live questions and 100 refutations stay unreviewed. Permitted by ADR-0008 in a non-production deployment behind Access — not permitted in front of a real student. |

### Then, in dependency order

1. **Safety (Phase 11)** — unblocked the moment T067 lands. FR-601, FR-602.
2. **Parent surface** — FR-501, FR-502 are OPEN and are in the PRD's scope.
3. **Measurement** — SC-003, SC-005, SC-006 have their instrumentation and no
   report that consumes it. `SC-005` is the one that matters: the PRD calls the
   comprehension-to-retrieval conversion rate the single test of whether the core
   bet works, and nothing computes it. Per ADR-0010 this is now a per-solution
   measure, not a cross-build comparison (T135 — slice by `modality` too, now
   that widgets move mastery).
4. **Close the review loop on widgets** — T122. Twenty widget questions are
   queued for review and the review page cannot render a construction.

### Two requirements that are stale, not unbuilt

Both need Tamer, and both are cheap to fix and expensive to leave:

- **SC-004** measures "verified signups" after signups were replaced by the
  identity picker (decisions.md Q5). As written it can never be measured.
- **SC-011** forbids serving unreviewed questions that **ADR-0008 explicitly
  permits**. The criterion contradicts the constitution it is measured against.

## v1.1 — what the pilot will tell us to build *(post-launch)*

Deliberately thin. The point of a pilot is that this section is written
afterwards, from evidence, not now from opinion.

Committed already, because the gap is known rather than guessed:

- **Widget coverage** — 13 of 90 objectives carry a construction (T123).
- **Misconception coverage** — 201 of 250 book MCQs still cannot be diagnosed
  (T104). This is the highest-value content work in the repo: every mapped
  distractor turns a wrong answer into a targeted explanation.
- **Regression cover for what is only "verified once"** — 47 requirements are
  verified by a session nobody will repeat. The `@covers` annotation and
  `scripts/traceability.py` make that measurable; driving it down is the work.
- **The tutor has never chosen a widget** (T119). Eleven widgets and 48 stored
  constructions exist; whether a model reaches for the right one at a real
  teaching beat is unmeasured.
- **iPad** (T120) — the stated device target, never run on.

## v2 — deferred by explicit decision

Not forgotten. Each carries the decision that deferred it, so re-opening is a
decision rather than a rediscovery.

| Area | Requirements | Deferred by |
|---|---|---|
| **Billing** — trial, card payment, plans | FR-701…707, SC-007 | decisions.md Q7 — payments are out of this build |
| **Accounts** — self-signup, verification, sharing deterrence | FR-106, FR-604 | Identity is a picker, not auth (ADR-0007) |
| **Mid-year placement** by assessment | FR-306 | Never triaged — Samuel must build it or defer it explicitly |
| **Exam preparation** | FR-402 | Same |
| **Arabic and Social Studies** | the frozen verticals | PRD §14 non-goals for MVP 1.0; the code stays in the tree and reintroducible |

**FR-306 and FR-402 are the untidy ones.** They read as in-scope and nobody is
building them. An in-scope requirement nobody is building is worse than a
deferred one, because it makes the whole spec less believable.

## How this document stays true

It does not, automatically — this is the one artifact here that is still
hand-maintained, and it will drift like the others did. It is reviewed at
triage (see [`FEEDBACK.md`](FEEDBACK.md)), and anything promoted from an issue
with the `roadmap` label lands here under a named version.

The numbers at the top come from `./scripts/traceability.py`. If they disagree
with the tool, the tool is right.
