# ADR-0012 — Mastery-gated lesson progression replaces the constant lesson on `/student`

**Status**: Accepted — Samuel, 2026-09-22
**Affects**: `app/src/app/student/page.tsx` · `app/src/lib/lesson-slug.ts` (`DEFAULT_LESSON_SLUG`) · `app/src/lib/lesson.ts` (`getLessonCatalog`) · `app/src/lib/checkin.ts` · `app/src/components/student/LessonCheckIn.tsx` · a new `db/migrations/012-*` progress table
**Does not affect**: the tutor prompts in `app/src/lib/lesson.ts` (`learnPrompt`, `reviewPrompt`) — deliberately, see Consequences

## Context

`/student` always opened on lesson **1-1**, for every student, on every visit.

The landing check-in derives its lesson as
`lessonSlug ?? (courseId ? lessons[0]?.slug : undefined)`, falling through to the
hardcoded `DEFAULT_LESSON_SLUG = "u1-1"`. Both branches are constants: the first
is the first row of the catalogue in curriculum order, the second is a literal.
Neither reads mastery, and nothing anywhere reads a date. The card that the UI
describes as *assigned* ("the UI assigns, it never asks the student to browse")
was assigning the same lesson forever.

Mastery **is** computed, per learning objective, by BKT on every graded attempt —
but it is consumed only *after* the lesson is already fixed, to pick which door
to recommend (reteach vs refresh) and to fill the ramp. It never selected the
lesson.

The same investigation established that **finishing a lesson had no meaning**.
`{{finish_lesson}}` only arms a button; tapping it writes one
`understanding_checks` row (an LLM-graded 0–100 score, verdict, strengths, gaps,
`next_step`) which no selector reads. There is no completion flag anywhere in the
schema, and resume state is `sessionStorage` only. Finishing and abandoning left
identical system state.

Three constraints shaped the decision:

- **The prerequisite graph branches.** Edges are LO→LO; there is no lesson node.
  Collapsed to lesson level the seed data has 202 prerequisite edges — 131
  within-lesson, 71 cross-lesson — and `u1-1` alone unlocks **four** lessons
  (`u1-2`, `u1-4`, `u5-1`, `t2u1-1`). Math has four roots with no prerequisites
  at all (`u1-1`, `u2-1`, `u3-1`, `u3-2`). "The next lesson on the graph" is not
  a value the graph can return.
- **The mastered band is reached fast and is reversible.** Band cut is ≥ 0.75.
  With `DEFAULT_PARAMS`, two correct answers take an LO from the 0.30 prior to
  **0.919**; from a mastered 0.98, two wrong answers fall to **0.517**. Anything
  recomputed per render would oscillate.
- **Averaging hides holes.** `deriveMasteryStage` averages LO scores, so
  0.98 / 0.98 / **0.29** reads as "mastered" — acceptable for a display ramp,
  not as a gate that advances a student past an objective.

## Options considered

**How "next" is chosen**

1. **Book order, prerequisite-gated** — predictable, matches the student's own
   textbook, explainable to a parent / cons: ignores individual readiness
   ordering.
2. **Readiness frontier** (lift `getStudentPlan`'s weakest-eligible rule to
   lesson level) — adapts to the individual / cons: jumps across units in an
   order the student will not recognise from the book.
3. **Unlock, don't assign** — least disruptive, preserves choice / cons: the main
   card still is not "your lesson", so the original defect survives.

**What counts as mastered**

1. **Every LO ≥ 0.75** — closes the averaging hole / cons: slower to advance.
2. **Stage 4 (average ≥ 0.75)** — one definition of mastered product-wide / cons:
   one weak objective can be carried by two strong ones.
3. **Every LO ≥ 0.75 plus a `got_it` report** — finally wires
   `understanding_checks` into something / cons: blocks students who practise
   without running a full lesson to its report.

**Where the advance lives**

1. **Persisted pointer** — stable, auditable, gives "finishing" real semantics /
   cons: a migration.
2. **Derived per render** — no migration / cons: the assigned lesson moves
   *backwards* when mastery drops; the card flickers between lessons.

## Decision

**`/student` opens on a persisted lesson pointer, held per student per subject,
that advances when every learning objective in the current lesson reaches 0.75.**

Pinned parameters:

- **Pointer**: `(student_id, course_id) → lesson_slug`. Per **subject**, not per
  student — the check-in is already subject-scoped via `?subject=`, and a single
  pointer would let mastering a maths lesson move the Arabic one.
- **Gate**: *every* LO in the lesson at `mastery.score ≥ 0.75`, not the average.
  0.75 is the existing `mastered` band cut in `lib/mastery.ts`, unchanged, so the
  gate and the ramp can never disagree about the word.
- **Advance rule**: on first crossing the gate, move the pointer to the next
  lesson in `getLessonCatalog` order (`MODULE_ORDER`) whose prerequisites are
  met, reusing the existing `PREREQ_GATE = 0.5` on prerequisite LOs.
- **Monotonic**: the pointer advances once and is never walked back by later
  wrong answers. Mastery may fall below the gate afterwards; the pointer does
  not follow it down.
- **Terminal state**: at the last lesson of a course the pointer parks and the
  card renders a completed state. The picker stays available. It does **not**
  fall back to the weakest lesson for review — that would turn "finished the
  course" into "you're behind on something".
- **Backfill**: the migration computes each existing student's initial pointer as
  the furthest catalogue lesson already passing the gate, else the course's first
  lesson.
- **An explicit `?lesson=` still wins.** Auto-advance never overrides a
  selection — the regression in the 2026-07-30 field report ("picking another
  lesson brings me back") must not return.

**Framing**: the product is **self-paced**. The app owns the sequence and no
longer claims to know what school taught today. Check-in copy changes
accordingly ("How did today's lesson go?" → a self-paced equivalent).

## Consequences

**Enabled.** Progression exists for the first time: the pointer is the missing
persisted state that gives "finishing a lesson" something to mean. Mastery
becomes load-bearing on the landing surface rather than decorative. The per-LO
gate makes advancement defensible to a parent — a student is never carried past
an objective by two strong siblings.

**Cost.** A schema migration and a backfill. A fourth notion of "next" enters a
codebase that already holds three that disagree — `getStudentPlan`'s
weakest-eligible frontier, the prose rule in `lib/ask.ts`, and catalogue order.
This ADR does not unify them; that debt is now explicit and should be paid by
extracting one shared selector before a fifth appears.

**Deliberately excluded: the tutor prompts do not change.** The school-day
premise is load-bearing in `learnPrompt` ("just came home from school"),
`reviewPrompt` ("came home saying he understood today's lesson COMPLETELY"), the
hidden session-starter, and the grader's session description — 17 sites in all.
Self-paced framing contradicts them, and **review mode is *defined* by that
premise**: without school, "I understood everything at school" stops being
something a student can mean, and the door becomes "I already know this, check
me" — a re-spec of one of the two doors, not a string swap. Prompt edits also
move teaching behaviour, and ADR-0010 keeps metrics unpooled across solutions, so
a mid-stream prompt change wants its own deliberate cut. **Samuel, 2026-09-22:
"do not make changes to the prompt for now."** The check-in card and the tutor
therefore disagree about the premise until that follow-up lands; this is a known,
accepted, temporary inconsistency.

**Revisit when**: a date or school-calendar signal enters the system (the pointer
would then compete with it for authority over "today's lesson"); or the
prerequisite graph gains real lesson-level edges, at which point book order can
be replaced by a genuine topological walk; or the tutor-prompt reframing lands
and the self-paced framing becomes consistent end to end.
