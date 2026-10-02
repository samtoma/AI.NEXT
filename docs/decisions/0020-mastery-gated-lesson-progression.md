# ADR-0020 — Mastery-gated lesson progression replaces the constant lesson on `/student`

**Status**: Accepted — Samuel, 2026-09-23, by approving the merge onto `main` (accepted on Tamer's branch 2026-09-22) · **Amended** 2026-09-23 — no backfill; see [Amendment](#amendment-2026-09-23--no-backfill-and-what-complete-means)
**Renumbered**: written as ADR-0012 on `wip/socratic-probing-route-b` (Tamer Deif); `main` had already used 0012 for per-student isolation (RLS) and 0019 for the maths-bank rule, so this is ADR-0020 on `main`. The decision text below is unchanged except where it names a file that moved.
**Affects**: `app/src/app/(student)/student/page.tsx` · `app/src/lib/student-landing.ts` (`decideLanding` takes the pointer) · `app/src/lib/progression.ts`, `app/src/lib/progression-db.ts` · `app/src/lib/lesson-slug.ts` (`DEFAULT_LESSON_SLUG`) · `app/src/lib/lesson.ts` (`getLessonCatalog`) · `app/src/lib/checkin.ts` · `app/src/components/student/LessonCheckIn.tsx` · `db/migrations/028-lesson-progress.sql` (012 on the branch) and its rollback
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
accepted, temporary inconsistency. *(This hold has one recorded exception: [ADR-0021](./0021-runtime-teaching-toggle-and-testers.md)'s
2026-09-24 "reveal threshold" amendment, Samuel authorising one specific rule — not a reopening of the hold generally.)*
*(A second exception, narrower still — Samuel, 2026-09-25: "OK". The hold is lifted for **one label string
only**: `module:geo-u1`'s "Term 2 · Unit 4 — The Circle", which was "Unit 4 — The Circle" (FR-3218, migration
031, v0.9.2). It is curriculum data, not prompt text, but it reaches the model: the lesson data block,
`learnPrompt` and `reviewPrompt` of the four Unit-4 geometry lessons, the comprehension grader for them, and
the "Ingested units" line of every Ask-the-Spine surface — 22 of 438 captured prompt files, by that string and
nothing else. No prompt code changed; this is not a reopening of the hold.)*
*(A third exception, the same day — Samuel, 2026-09-25: "yes for sure, for decision 2, it is part of
the overall consistency, so please proceed". The hold is lifted for the **ordering of the Ask-the-Spine
context** (`lib/ask.ts` and the figure catalogue it reads, `getAllVisuals`), FR-3217: its objective list,
its unit list and its figure catalogue now follow the one catalogue order, split by subject (maths, Social
Studies, Arabic); its eight focus objectives stay "weakest first" with catalogue order breaking ties, so a new
maths student's focus is Unit 1's first eight objectives; and its prerequisite-edge list, which had no
order at all, reads in catalogue order of each end. The wording of every prompt is unchanged, and so is
every other prompt path — the lessons, the grader and the upload parser. 12 of 438 captured prompt files
change: the data and grounding of the six Ask surfaces.)*

*(A fourth exception — Samuel, 2026-09-25, choosing "Full fix + deploy" for hotfix v0.9.3. The hold is
lifted for **one sentence in the number-line widget's live-event note**: when a student marks the right
values with the wrong signs, the note now names that error ("right numbers, wrong signs … substitute a value
back in to check its sign"), as FR-1206 requires of a widget note. It is emitted only by the new
`sign-flipped` predicate. Every other widget note, and every system prompt, is unchanged.)*

*(A fifth and a sixth exception — Samuel, 2026-10-01: "I accept all the changes", on Tamer's
`tamer-mvp-fixes` review, released in v0.10.0. **Fifth — no "LO" to a student** (`f374c39`): "LO"/"LOs" in
prompt prose becomes "learning objective(s)", and one rule forbidding the abbreviation is appended to every
lesson's language contract and to the Ask-the-Spine prompt; data-table column headers keep "LO". 82 of 234
captured prompt files change, by those wording edits only; `probing-prompts.golden.json` was regenerated, so
the FR-3108 "probing Off changes nothing else" baseline is now this wording. **Sixth — the Your Progress
chat** (`ea51826`): the `spine_chat` surface is addressed to the student, never quizzes (no
`{{show_question}}`, and the panel draws no question card), and never quotes a mastery number; the
practice re-explain chat (`student_chat`) no longer calls itself a demo. 9 of 234 files change. Both are
deliberate cuts in the comparison data from v0.10.0. The lesson-prompt reframing this hold waits for is
still not done.)*

*(A seventh exception — Samuel, 2026-10-02: "I approve both, merge it as v0.11.0", on Tamer's
`tamer-graph-test` (the Your Progress Map, FR-3224). The Your Progress chat's (`spine_chat`) system prompt
gains **one static rule**: when the turn ends with a "MAP SELECTION RIGHT NOW" line, answer about that first
and name what it builds on and what builds on it. The line itself rides in the per-turn prompt, built
server-side from the curriculum the student can see (`lib/ask.ts` `mapFocusNote`); the browser sends only a
kind and an id. 3 of 234 captured prompt files change, by that one rule line. Every other prompt is
unchanged.)*

**Revisit when**: a date or school-calendar signal enters the system (the pointer
would then compete with it for authority over "today's lesson"); or the
prerequisite graph gains real lesson-level edges, at which point book order can
be replaced by a genuine topological walk; or the tutor-prompt reframing lands
and the self-paced framing becomes consistent end to end.

## Amendment 2026-09-23 — no backfill, and what "complete" means

Recorded when the branch was reviewed for the merge onto `main`. The Decision
section above is left as written; where the two differ, this section wins.

**No backfill (Samuel, 2026-09-23).** Migration 028 no longer seeds a pointer
for existing students. Production holds only founder and test students, so
every student starts on each course's first lesson — the app's own fallback for
a student with no row — and advances by the runtime rule alone. The backfill
was removed for two reasons:

- **It was a latent outage.** `deploy/apply-migrations.sh` re-applies every
  migration on every deploy, with no ledger. The seed re-ran on each deploy
  until the table held a row, and every row it wrote had to satisfy the
  `lesson_slug` CHECK, which it never checked. One unexpected objective id
  would have failed the migration, and a failed migration fails the deploy.
  Migration 008 took the site down on 2026-09-23 the same way: on a re-run, a
  CHECK constraint was violated by rows already in the table (`886b302`).
- **It did not follow the runtime rule.** It put a student on the lesson after
  the *furthest* passing one. That skipped unmastered earlier lessons and
  ignored prerequisites, so it produced pointers the app itself could never
  produce.

The Decision's **Backfill** bullet and the "a backfill" in Consequences → Cost
are therefore withdrawn. Rolling back 028 now loses every pointer outright, and
re-applying it restarts every student at the first lesson.

**What "complete" means (implementation note, same review).** "Terminal
state" above is implemented as follows: the card shows the completed state only
when the lesson is the course's **last** catalogue lesson **and every lesson
in the course** passes the gate. The first build used a different test, "no
later lesson has its prerequisites met". That is also true mid-course, whenever
every remaining lesson is still waiting on a prerequisite, so it told parked
students they had finished the whole course. A pointer with nothing ready ahead
now **parks without completing**. It moves again on the next gate-passing
attempt on its lesson once a later lesson is ready. The stricter "every lesson"
half is there because the banner says *"You've been through every topic
here"*: a pointer can reach the last lesson by skipping lessons that were not
ready. The cost is that the banner goes away if an earlier lesson later drops
below the gate. The pointer itself never moves back. Samuel may prefer the
looser "last lesson mastered" reading; if so, that is a one-line change in
`courseComplete` (`app/src/lib/progression.ts`).

**Stale pointers.** A stored slug that is no longer in the course's catalogue
(for example, after a content reload renamed a lesson) counts as the course's
first lesson, both on `/student` and when an attempt advances the pointer.
Before this, the page showed the first lesson but the advance never matched
it, so the student could not move again.

## Amendment 2026-09-30 — the gate is the ramp's second stage

**Status**: **Accepted** — proposed by Tamer Deif, 2026-09-30, on `tamer-mvp-fixes`; accepted by Samuel, 2026-10-01 ("I accept all the changes"), released in v0.10.0. Implemented behind one function, so it is one revert to undo.

**Why.** The gate above (every objective at 0.75) was reached by almost no one. A tester finished lesson 1-1 with a 95% report, saw the ramp stop on the third bar, and the "Revisit" row never appeared on the live site. The cause is structural, not a fault in mastery updates: "Quick review" scripts its questions from the first three objectives only (`lib/lesson.ts`, `data.los.slice(0, 3)`), 1-1 has four, and the strict gate needs all four at 0.75. A student can do everything right and the saved place never moves.

**Decision.** A lesson is *finished* — it moves the pointer and earns the "Revisit" row — when **both**:

1. **every objective has been attempted at least once** (`mastery > 0`; an attempted objective never reads 0, because every BKT update clamps to `MIN_SCORE`), and
2. **the lesson's average reaches "Getting there"**, the ramp's second stage (`GATE_MIN_STAGE = 2`, 0.35 and above) — the same average the card's ramp shows.

The first condition is the floor under the average. Without it, two well-answered objectives out of four average about 0.46 and would call half a lesson done. With one correct answer taking an objective to about 0.69 and two to about 0.92, the second condition needs roughly half the lesson answered well.

**What stays strict.** The course-complete banner ("You've been through every topic here") still requires every objective in every lesson at 0.75 (`lessonMastered`, used by `courseComplete`). The pointer moving on is a lower bar than telling a student they have finished the course.

**What this gives up, knowingly.** The Context above rejected averaging as a gate because 0.98 / 0.98 / 0.29 reads as mastered. This amendment accepts that for the pointer: a weak but attempted objective no longer holds a lesson back. Two things limit the harm: the attempted floor, and `PREREQ_GATE`, which still guards entry to later lessons per objective, so a hole a later lesson builds on parks the pointer rather than being walked past. Mastery is also reversible (two wrong answers take a 0.98 objective to about 0.52), so a lesson sitting near 0.35 can lose its "Revisit" row on a later render; the pointer itself never moves back.

**Trigger.** The pointer is re-checked after a correct answer **and after the first attempt on an objective** (`attemptCanCrossGate`). It used to be after a correct answer only, which was enough while passing needed a high score; with the attempted floor, a wrong first attempt on the last untouched objective can complete the gate, and was missed on a real sitting (Functions, both objectives attempted, average 0.56, pointer unmoved).

**Not fixed here.** "Quick review" still asks the first three objectives only, so on a four-objective lesson it can never supply the fourth attempt. The card's "hasn't come up yet" line names what is missing and points at the walk-through. Widening review to every objective changes the review prompt, which this ADR holds, so it needs its own approval.

**Affects.** `app/src/lib/progression.ts` (`lessonGatePassed`, new `lessonMastered`, `courseComplete`), `app/src/lib/progression.test.mts`; FR-3202 and FR-3203 amended and FR-3221 added in spec 002.
