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
| Requirements in the active spec | 96 (**90 FR + 6 SC**), all traced |
| Verified | 57 — of which **9 have a test**; the other 48 rest on a session someone ran once |
| Blocked | 3 — and none of the three is blocked on engineering |
| Tasks | 99 of 143 complete |
| Nothing has met the box | No solution has been deployed; infrastructure is parked by decision (`T139`) |

**The critical path is three items, and two of them are not code.**

> **Updated 2026-09-20, after `PDR1-0-v0.3.0` and `v0.4.0`.** Tamer's Prototype 1.1
> review — 37 issues — is answered: 17 closed with code, 20 open with a written
> answer. Nothing below changed as a result, because none of the three hard gates
> is a defect. Four things the fix pass added to the picture:
>
> - **The core bet is now addressed in code and unproven in behaviour.** `SC-005`
>   was OPEN with nothing built; the Socratic protocol (`775b6d8`) is now built and
>   cannot be judged, because item 3 below — the measurement gap — is also what
>   would tell us whether it worked. Those two items are now one item.
> - **Two shipped features have no requirement** (access gating, the Socratic
>   protocol). §9 of the traceability matrix, Samuel to own.
> - **The tutor prompts assume every student is male.** No gender column exists.
>   Not on any list before this; it belongs on the v1.0 path, not after it.
> - **A fourth stale requirement**, joining the two named at the foot of this
>   section: `FR-1010`'s signature animation was BUILT-and-unspent for a reason
>   nobody had noticed — nothing in the product rendered a band change at all.

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
3. **The teaching evaluation harness** — see the section below. It moved up the
   list on 2026-09-20 because it now blocks five named requirements
   (`FR-209`…`FR-213`) rather than an abstraction, and because `SC-005` turns
   out to be **mis-instrumented**, not merely unbuilt.
4. **Measurement** — SC-003, SC-006 have their instrumentation and no report
   that consumes it. Per ADR-0010 these are per-solution measures, not
   cross-build comparisons (T135 — slice by `modality` too, now that widgets
   move mastery).
5. **Close the review loop on widgets** — T122. Twenty widget questions are
   queued for review and the review page cannot render a construction.

### The teaching evaluation harness **[ADDED 2026-09-20]**

**The problem, stated plainly.** Change a function and `npm test` says pass or
fail. Change *how the tutor teaches* and nothing says anything at all. The only
way to know whether the tutor now asks before it explains is for a person to
read a lesson transcript and form an opinion. That does not scale, does not
repeat, and does not run in CI — so a regression in teaching quality is
invisible until somebody happens to notice it in a demo.

That is not hypothetical any more. `PDR1-0-v0.4.0` shipped **FR-209**…**FR-213**,
five requirements describing how the tutor teaches, and **all five are BUILT and
none can be promoted to VERIFIED**, because promotion needs evidence this build
cannot produce. The same gap is why feedback [#20](https://github.com/samtoma/AI.NEXT/issues/20)
(language mixing) and [#22](https://github.com/samtoma/AI.NEXT/issues/22)
(question drift) stay open after a fix landed for each.

**A finding that changes the shape of this work.** `SC-005` — the
comprehension-to-retrieval conversion the PRD calls the single test of the core
bet — is not merely unmeasured. It is **mis-instrumented**, and computing it from
today's events would produce a plausible wrong number:

| Event | Fires | Should mean |
|---|---|---|
| `explanation_delivered` | only when a **refutation** is served — a wrong answer matching a known misconception | every explanation the tutor gives |
| `retrieval_attempt_submitted` | on **every** graded attempt | the retrieval that follows an explanation |

The ratio of those two, as they fire today, is *all attempts over refutations
only*. It is not a conversion rate and nothing should be decided from it.

**Why FR-212 makes this solvable.** `SC-005` needs two identifiable moments: the
tutor explained, and the student retrieved. The second never existed as a
distinct thing — retrieval was any graded answer. FR-212 now **requires** a
lesson to end on a retrieval from memory, which creates exactly that moment. Emit
it, fix `explanation_delivered` to fire on every explanation, and the conversion
becomes computable for the first time.

#### Four layers, cheapest first

**1. Structural checks — no model, no cost, runs in CI.** More of FR-209…213 is
machine-checkable from a transcript than it first appears, because the protocol
already marks its own structure:

| Requirement | Structural check |
|---|---|
| FR-213 explain in steps | count `{{beat}}` markers inside a multi-step explanation |
| FR-210 open question is used | a message ending in a question with no interactive directive |
| FR-212 ends on retrieval | the last message before `{{finish_lesson}}` is an ask, not a recap |
| FR-211 asks for the working | at least one "how did you get there" ask per objective |

This is an ordinary test suite over recorded transcripts. It catches regressions
for free and it is where to start.

**2. Lesson fixtures — the recordings the checks run against.** A harness that
drives a scripted student (fixed profile, fixed lesson, scripted answers) end to
end against the real tutor and stores the transcript. Deterministic inputs mean
two runs are comparable. Six to ten fixtures covers the cases that matter: a
never-attempted lesson, a partly-mastered one, a wrong answer with a known
misconception, a partial answer with no final result, and a "still confused"
signal.

**3. LLM-as-judge — only for what structure cannot see.** FR-209's *did it elicit
before explaining* and FR-211's *did it work with the partial answer* need
judgement. Rubric-scored, structured output, one call per transcript.

> **The trap, and this repository has already been caught by it once.** A model
> grading model output reproduces the failure mode it is meant to catch — that is
> exactly why `T107` insists a **human** performs the 10% content review, after a
> model review produced a false rejection on a standard-deviation item. So the
> judge must itself be validated: a held-out set of human-labelled transcripts,
> and a measured agreement rate. **An unvalidated judge is not evidence, it is a
> second opinion from the same kind of thing that wrote the lesson.**

**4. Fix SC-005's instrumentation** — emit the FR-212 retrieval moment as its own
event, and make `explanation_delivered` fire on every explanation rather than
only on refutations. Separate from layers 1–3 and independently useful: it is
what turns the core bet from an opinion into a number.

#### What it unblocks

Five requirements (FR-209…FR-213) become promotable. `SC-005` becomes computable.
Feedback #20 and #22 become closeable. And every future change to teaching
behaviour — which is the product — stops shipping unverifiable.

**Sequencing.** Layers 1 and 2 are engineering and need no decision. Layer 3
needs a decision on who labels the human-graded set, which is the same question
as `T107` and probably the same person. Layer 4 is small and can go first if a
number is wanted sooner than a guarantee.

### Samuel's direction, 2026-09-20 — the next workstream **[SPECCED 2026-09-20 → `specs/002-identity-and-admin-console/`]**

Taken from his own words at the end of the `v0.4.0` session. **Recorded here so the
next session starts from it rather than rediscovering it.** None of it is specced,
none of it is started, and the full requirements are his to give.

**Now specced, and still not started.** `specs/002-identity-and-admin-console/plan.md` sequences it
in seven phases — P0 sessions become real (first, because it is the only gap losing data now), P1
accounts + row-level isolation + roles-in-data, P2 the console build target, P3 student 360 and
replay, P4 cost, P5 monitoring and analytics, P6 tutor voice and gender — and its **Open for Samuel**
list cites the spec's thirteen Open Decisions, of which item 6, the **Egypt PDPL guardian-consent
flag**, is a legal constraint on D7 routed to him rather than a decision anyone took here.

**1. An admin dashboard, as its own release.** Everything that is not the education
itself — the extraction pipeline, the evidence walk, content review, the gallery —
moves behind a real admin surface rather than being merely absent from the student
build. `FR-605` (shipped in `v0.4.0`) removed those routes from the student build;
this is the other half — giving them somewhere deliberate to live, with its own
version.

**2. Real signup and sign-in, with per-student isolation enforced in the backend.**
His words: *"each student will have his own separate env. now fully, and well from
the backend."* This is materially larger than un-deferring `FR-106`, and it is the
part to be careful about:

> **This reads as a multi-tenancy decision, and it needs an ADR before code.** Today
> every student shares one database and isolation is a `WHERE student_id = $1`
> clause. "His own separate environment, fully, from the backend" could mean row-level
> isolation enforced by the database rather than by queries, a schema or database per
> student, or something between. Those have very different costs, migration stories
> and per-student running costs, and the choice cannot be inferred from the sentence.
> **Samuel is bringing the full requirements** — the ADR goes with them, not before.

**3. Landing page, admin roles, and lesson resume ride with it.** `#6`, `#7`, `#8`,
`#9` and `#25` are all downstream of the same identity work and were already blocked
on it. They stop being blocked when this lands.

**Two decisions that are settled and should not be relitigated:**

- **BKT stays exactly as it is.** The mastery model, its parameters and its update
  rule are untouched until Samuel says otherwise. The `v0.4.0` display fix stands; the
  band moving two steps on two answers is a **known and accepted** property, not an
  open defect ([#17](https://github.com/samtoma/AI.NEXT/issues/17), closed).
- **The graph explorer stays a student surface.** `/spine` is not going behind the
  admin gate, and the lesson report keeps sending students to it. This unblocks
  [#15](https://github.com/samtoma/AI.NEXT/issues/15), which was waiting on exactly
  this question.

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
