# Feedback — how an observation becomes a requirement

The repository is the reference. That only works if there is a defined path
from "I noticed something" to "the spec says so and a test proves it" — and if
the path is short enough that people actually use it.

**Nothing is decided in a chat message.** If it matters, it ends up here.

## The path

```
  Issue            Triage              Spec                 Traceability
  (anyone)    →   (Samuel)      →   (an FR/SC id)    →   (status + evidence)
  the inbox       weekly            the commitment        the proof
```

Four steps, and the middle one is the one that matters: **triage decides
whether an observation becomes a commitment.** Most feedback should not. An
inbox that turns everything into a requirement produces a spec nobody believes.

### 1. Raise it — anyone, 2 minutes

[New issue](https://github.com/samtoma/AI.NEXT/issues/new/choose). Four
templates, chosen by what you have rather than what you know:

| Template | For | Typically |
|---|---|---|
| **Product feedback** | The experience — what a student would feel | Tamer |
| **Market / customer feedback** | What a real parent or school said | Kamil |
| **Defect** | Something is broken, wrong or unsafe | Anyone |
| **Requirement change** | The *spec* is wrong, not the code | Anyone → Samuel |

Write what you saw, not what you think we should build. The observation
survives being wrong about the cause; a proposed solution usually does not.

### 2. Triage — Samuel, weekly

Every open issue gets exactly one outcome, and the outcome is written on the
issue:

| Outcome | Label | What happens |
|---|---|---|
| Becomes a requirement | `accepted` | Gets an **FR/SC id** in the active spec, a row in the traceability matrix, and tasks. The issue closes with a link to the id. |
| Becomes a defect | `defect` | A task in `tasks.md`. No new requirement — an existing one is being violated, and the issue names which. |
| Deferred to a later version | `roadmap` | Moves to [`ROADMAP.md`](ROADMAP.md) under a named version. **Not closed** — deferred is a decision, and it stays visible. |
| Declined | `declined` | Closed **with the reason written down**. A declined idea with a recorded reason stops being re-raised every six weeks. |
| Needs a decision | `needs-decision` | Blocked on Samuel. If it sits here more than two weeks it is really `declined` and should say so. |

### 3. Promote — the only way a requirement is born

An accepted issue becomes a numbered requirement in
[`specs/001-student-mvp1-delta/spec.md`](../specs/001-student-mvp1-delta/spec.md),
in the block its subject belongs to, worded as an obligation (MUST / SHOULD)
rather than a feature name. It cites the issue it came from.

Then it needs a row in the traceability matrix — **`./scripts/traceability.py
--check` fails CI until it has one.** A requirement with no row is a promise
nobody can audit, so the build refuses it.

### 4. Prove it

The row carries a status and the evidence. `VERIFIED` means it was actually
exercised — a browser session, a query against a loaded database, a passing
test — and the row says which. The strongest form adds `@covers FR-nnn` to a
test, because that is the only evidence re-checked on every commit.

## What this is deliberately not

- **Not a backlog tool.** Issues are an inbox; the spec is the commitment and
  `tasks.md` is the work. An issue that has been promoted is closed, not kept
  open as a tracking ticket in parallel with the thing it produced.
- **Not a place for design discussion.** Options with trade-offs go to Samuel,
  and the decision becomes an [ADR](decisions/). An issue thread is where a
  decision goes to be forgotten.
- **Not a substitute for talking.** Raise it in conversation if that is faster —
  then write the issue, because the conversation is not the record.

## For Tamer and Kamil specifically

You do not need to read the code, run anything, or know what an FR is.

- **Tamer** — you own product scope. The PRD is the authority on *what*, and
  where the spec has drifted from it, that is a **Requirement change** issue,
  not a bug. Two are already live and waiting on a decision: SC-004 measures
  "verified signups" after signups were replaced by an identity picker, and
  SC-011 forbids serving unreviewed questions that ADR-0008 now explicitly
  permits.
- **Kamil** — market feedback is the input this product has least of. Raw
  quotes are worth more than summaries, and an objection we cannot answer is
  worth more than praise. Price especially: the EGP 40 ceiling was withdrawn
  and nothing has replaced it, so PRD §10 is an open hole with real
  consequences for what we can afford to spend per student.

## The honest state of this, today

This process is **new as of 2026-09-15 and has never been run**. No issue has
been triaged through it. It is a proposal that happens to be written down —
the first real triage round is what will show whether the labels are the right
ones, and they should be changed when they are not.
