# ADR-0024 — Curriculum is a dimension of what a student sees

**Status**: **Accepted.** Samuel, 2026-09-25: first *"I would take your recommendations"*, answering
the options in `specs/003-curriculum-tracks/research.md`, the pipeline design's §10 and spec 003's
three questions. Then, having read this text, *"ok for all"*. The coordinating session relayed both
([decisions.md](../../specs/003-curriculum-tracks/decisions.md)). The five recommendations marked ⚑
(decisions.md A–E) were **confirmed** in the second answer. **Not committed** (T388).
**Amends**: [ADR-0018](./0018-course-availability.md) — adds the curriculum dimension ADR-0018 named
as its own revisit trigger, and changes what its kill switch suspends (⚑).
**Related**: [ADR-0005](./0005-extraction-pipeline.md) (amended the same day for derived objectives) ·
[ADR-0017](./0017-two-variants-keyed-to-grade.md) (grade 10 renders Play) ·
[ADR-0019](./0019-serve-the-whole-maths-bank.md) (note of the same day: covers the G10 course) ·
[ADR-0020](./0020-mastery-gated-lesson-progression.md) (note of the same day: the G10 prompts) ·
constitution v3.3.0 Principles I, VII, IX, X, XI · the privacy review,
`specs/003-curriculum-tracks/privacy-review.md` (its MUST findings shape the grants, the once-only
step, the reader order and the load's gate).
**Affects** (planned, nothing built): new `app/src/lib/curricula.ts` and `app/src/lib/courses.ts`;
`app/src/lib/subjects.ts` (loses `courseId`); `app/src/lib/catalog.ts`,
`app/src/lib/catalog-queries.ts`; `app/src/lib/module-order.ts`, `app/src/lib/module-term.ts`;
sign-up and Google sign-in; the console's `/courses`, Student 360, Overview and Content pages;
`db/migrations/033-curriculum-tracks.sql`; a new `.github/workflows/load-course.yml` and
`deploy/load-course.sh`; `.github/workflows/refresh-content.yml` and `deploy/refresh-content.sh`;
`services/extraction/load_seed.py` and `parity_check.py`; `FR-4001`…`FR-4212` in
[spec 003](../../specs/003-curriculum-tracks/spec.md).

## Context

Samuel, 2026-09-25: *"When the user sign up for grade 10, they can have at the beginning choose:
American, National, etc.. as much as we add Curriculum, and consider that in the console, to choose
which subject for which grade, should be done also per curriculum."* The first new curriculum arrives
with a book: Siyavula *Everything Maths* Grade 10, which Samuel names the "Grade 10 American
Curriculum, Math" (the book is written for South Africa's CAPS curriculum). The three Egyptian Prep-3
books are "National".

ADR-0018 keys visibility by (course, grade), plus a per-student exception, with a missing rule meaning
hidden. It named its own limit: *"A second dimension of visibility — per school, per cohort, per
term — which two levers cannot express."* A curriculum is that second dimension: a grade-10
American-curriculum student and a grade-10 National one are in the same school year and must see
different books.

The research found four facts that shaped the options:

1. **The student's curriculum already has a column.** `students.curriculum_system`, `NOT NULL DEFAULT
   'eg-national-en'`, has existed since migration 009. Nothing decides anything from it, so every
   existing student is already "National".
2. **The subject registry maps each subject to exactly one course** (`lib/subjects.ts`). A second maths
   course would 404 on every subject link and merge into one "Mathematics" bucket on every summary,
   the Overview and the drift guard.
3. **The course gate is the right seam.** Every gated student read goes through `visibleCoursesFor`.
   Four student readers do not, and one of them (`/dashboard`) already shows hidden courses' modules.
4. **Production cannot receive a fourth course.** The first-boot load skips once three courses exist,
   re-running `--course` on a present course deletes students' attempts and mastery, and the manual
   `refresh-content` workflow targets the frozen baseline's stack, not noor's.

## Options considered

**Where a curriculum is defined.**
1. **An app registry** (`lib/curricula.ts`), with the graph's `program:` node as an echo — chosen.
   It follows Principle IX's registry pattern and ADR-0018's "the console lists every course the
   product recognises, from the registry". It is testable without a database.
2. A `curricula` table — the console would still need labels before content exists, so the registry
   is needed anyway and becomes a second source.
3. Graph `program:` nodes alone — content-driven, so a curriculum would exist only once a book is
   loaded, which is backwards for the console. Not every bundle declares one.

**How a course relates to a curriculum and a subject.**
1. Course-as-subject (a new `math-am-en` subject) — rejected. It models no curriculum, invents a
   subject that is not one, and trips migration 007, which on every deploy NULLs any
   `understanding_checks.subject` outside `('math','social','arabic')`.
2. **Split registry** — chosen. `lib/subjects.ts` keeps the teaching contract (voice, widgets,
   prompts). A new `lib/courses.ts` holds each course: book, curriculum, subject, grades, term model,
   book name, probing, titles. The spine key stays `math`.

**Where the rule lives.**
1. **Curriculum comes from the course; the rule key stays (course, grade)** — chosen (decision 2). It
   needs no change to `course_availability` or `student_course_access`, so every rollback stays safe.
2. Curriculum in the rule key — rejected. It would change migration 023's unique constraint, which
   023's own `ON CONFLICT` target and the previous release's rollback proof both depend on. It is
   needed only if one course must be offered to two curricula under different rules, which decision 2
   excludes.

**How a new course reaches production.**
1. An additive "load if absent" step in every deploy — rejected by decision 17. It would be data
   written by a code deploy, against Principle X.
2. **A separate, manually started "Load a course" action** — chosen (decision 17): backup first,
   additive only, re-runnable, never part of a deploy.
3. SQL in a migration — rejected. It skips the loader's validation and provenance checks.

## Decision

**Every course belongs to exactly one curriculum. A student follows exactly one curriculum. A student
sees a course only if it is her curriculum's course and a rule says it is live for her grade, or if
an exception for her names it.**

Pinned:

- **Curricula** live in an app registry, `lib/curricula.ts`: id, label, grade labels, program node.
  **National = `eg-national-en`**, label "National", grade labels "Prep 1…Secondary 3"; its program
  node is the existing `program:bakaloreya-track`. **American = `us-american-en`**, label "American",
  grade labels "Grade 7…Grade 12"; its program node is `program:us-american-en` (decision 3).
- **Courses** live in `lib/courses.ts`. The Grade 10 course is **`course:us-g10-math-en`**, subject
  `math`, curriculum `us-american-en`, grades `["10"]`, no term model, probing off (decision 7). Its
  lesson ids use the prefix `g10m`, which starts with neither `geo` nor `t2`, so the Prep-3 term rules
  can never misread it. The loader writes `course part_of program:us-american-en` as the graph echo,
  and a test checks the registry against the seed bundles.
- **The student's curriculum** is the existing `students.curriculum_system`. Existing students keep
  `eg-national-en`, with no backfill. **No CHECK constraint on its values**: a CHECK would have to be
  widened for every new curriculum, and re-running an old narrow version on deploy is the pattern that
  caused the 2026-09-23 outage (`886b302`). The value is validated in app code; an unknown value
  matches no course and the console flags it.
- **The gate.** `isCourseVisible` gains two inputs, the student's curriculum and the course's
  curriculum. It checks them in this order:
  1. an exception decides outright, in both directions and across curricula;
  2. a course of another curriculum is hidden;
  3. otherwise a `live` rule for (course, grade) shows the course;
  4. otherwise the course is hidden.

  One per-request **student scope** (`resolveStudentScope`) feeds every student reader, the four
  ungated ones included. Source-scan guard tests fail on an ungated reader, on a subject→course lookup
  outside the scope, and on a `"course:` literal outside the registry.
- **⚑ The kill switch** (`AINEXT_COURSE_GATING=off`) suspends operators' rules and **not** curriculum
  scoping. With it off, a student sees every loaded course of her own curriculum, plus exceptions.
  This amends ADR-0018's "a variable that is absent means show everything", and FR-2709 with it
  (FR-4015). It is defence in depth for the load step: a loaded American book reaches nobody outside
  that curriculum whatever the switch says.
- **Sign-up** asks "Which curriculum does your school follow?" after grade, **only when the grade has
  live courses in two or more curricula** (decision 1). One curriculum is stored without asking; none
  stores National. A first Google sign-in gets one screen for grade and curriculum (decision 5).
- **Changing a curriculum is console-only at launch** (decision 4), under `student-data`, confirmed in
  the page. It deletes nothing: attempts and mastery are per objective and the lesson pointer is per
  course, so changing back restores everything. Every change is kept as history in an append-only
  table (plan A6), not as an overwritten value. That table goes beyond research D6's two columns; the
  reason is FR-2708's gap, where current-value columns lost every change but the latest.
- **Chosen or implied is recorded** (`students.curriculum_source`). A chosen curriculum is never moved
  by a rule change or a grade change; it is flagged for an operator instead. An implied one may be
  re-resolved when the grade changes (FR-4008; privacy review F11).
- **"Console-only" is a database fact, not a convention** (privacy review F8). Migration 017 grants
  `ainext_app` table-wide `UPDATE` on `students`, and in Postgres a column-level `REVOKE` does not
  remove a table-level grant. So migration 033, which runs after 017 on every deploy:
  - revokes `ainext_app`'s table-wide `UPDATE` on `students`;
  - re-grants `UPDATE` on an explicit list of columns, which excludes `curriculum_system`,
    `curriculum_source` and `onboarding_pending`;
  - grants `UPDATE (curriculum_system, curriculum_source)` to `ainext_operator`.

  The first-Google-sign-in step writes through one `SECURITY DEFINER` function. The function sets
  grade and curriculum for the calling student only while `onboarding_pending` is true, clears the
  flag in the same statement, and raises an error on a second call (F10).
- **Readers that name a book are scoped before any load** (privacy review §5, F13). These are the Ask
  context's source-book list, the home page's book, `/dashboard`'s topics and `/api/visuals`. Loading
  the G10 book into any database other students' traffic reaches is blocked until all of them go
  through the student scope.
- **The console** groups `/courses` by curriculum, with grade labels in each curriculum's words and a
  per-grade line naming what sign-up will offer. The Overview splits cohorts **by course**
  (decision 8), and every other operator figure names its course.
- **Launch scope** (decision 6): the G10 course is the only course live for grade 10; Prep-3 maths is
  not live for grade 10. Grade 10 renders Play (decision 7).
- **Production load** (decision 17): `.github/workflows/load-course.yml`, `workflow_dispatch` only,
  runs `deploy/load-course.sh` against noor's stack (`/opt/reletix/AI.NEXT-mvp1`, database
  `ainext_mvp1`). The script:
  - decides by **that course's own presence** (`graph_nodes` row with that id), never by a total count
    — the first-boot steps' weakness (privacy review F14);
  - refuses when the course is already present;
  - takes a `pg_dump` backup, **verifies it reads back** (`pg_restore --list`), and prints the
    one-line restore before writing anything;
  - loads the book bundles with `--course`, which on an absent course only adds rows;
  - loads the course's misconceptions and its generated and widget bundles with `--restore`, so
    review stamps travel;
  - writes **no** `course_availability` row, so the course stays hidden;
  - runs `parity_check.py` for every course afterwards and prints pass or fail (F17);
  - has a dry-run mode, and requires the course id retyped as confirmation.

  `refresh-content` is retargeted to noor's stack (FR-4210). A deploy never loads a course.
- **⚑ Analytics**: the curriculum is recorded in the first-party `account_created` event only, never as
  an anonymous analytics property (FR-4016).

## Consequences

**The two gate tables do not change, and that is what keeps rollback cheap.** Migration 033 adds:
- the change-history table;
- two columns on `students` (`curriculum_source`, `onboarding_pending`);
- the once-only function;
- the column-level grants.

Its rollback drops the table, the function and the two columns, and restores 017's table-wide grant.
It loses who changed a curriculum and when, and whether a curriculum was chosen or implied. It loses
nothing a student produced. **Rolling back the code is the
dangerous half, and it has to be named:** old code reads no curriculum, so an American student would
see every course live for grade 10. Before rolling back, hide the American course or turn the gate on.

**Nineteen files change their subject→course lookups.** Research counted about 19 importers of
`SUBJECTS[…].courseId` or `courseIdOfSpineKey`. Each becomes a scoped lookup, and a guard test stops
the old pattern returning. `SUBJECT_RANK` becomes `COURSE_RANK` (curriculum, then subject, then
course), with the old name kept as an alias for one release. FR-3217's "one-subject" lists become
"one-course" lists.

**Prep-3 must stay byte-identical, and the proof is the capture harness.** Per-course facts — book
name, fallback figure, lesson titles, term model, the geometry test — move from the maths prompt kit
to `CourseDef`. Prep-3 keeps the exact string "Egyptian ministry textbook". G10 prompts are new
capture files, which the ADR-0020 note of the same day permits.

**The kill switch now means something narrower.** Operators who have learnt "gating off shows
everything" need to hear that it now shows everything *in the student's own curriculum*. The console's
`/courses` page and `scripts/course-gating.sh` say so.

**Nobody is asked the curriculum question at launch.** With decision 6's rules, grade 10 has live
courses in one curriculum only. The question appears on its own the first time an operator makes two
curricula live in one grade. That is the intended behaviour; it is written here so that "sign-up
never asks" is not mistaken for a bug.

**There is now a second manual content path.** Principle X names `refresh-content` as the way content
changes. The load action is a second, deliberately narrower path: additive only, and refusing a course
that is present. The constitution amendment proposal names it (PATCH).

**What would trigger revisiting.**
- **A course offered to two curricula under different rules** — for example the ministry Arabic book
  for American-track students. Decision 2 excludes it today; it needs curriculum in the rule key, and a
  new table rather than a changed one.
- **A student following two curricula at once.** Exceptions cover single courses; a whole second
  track would need a set, not a value.
- **A student-facing curriculum control.** This arrives with FR-2013's profile editor. The history
  table and the confirmation already assume an actor who is not an operator could be added.
- **Non-Egyptian grade structures.** ADR-0017 named these as a trigger for its grade key. The numbers
  still line up (grade 10 is grade 10); only labels differ, and `lib/curricula.ts` carries them. A
  curriculum whose years do not map onto 7–12 would break that.
