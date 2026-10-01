# Feature Specification: Curriculum Tracks and the Grade 10 American Mathematics Course

**Feature Branch**: `feat/003-curriculum-tracks-g10-american-math` (from `main` at `v0.9.2`, brought up
to `v0.9.3` on 2026-09-25)
**Created**: 2026-09-25
**Status**: Approved in substance, planned, being built. **Rev. 2 (2026-09-25)**: every
`[NEEDS CLARIFICATION]` is resolved by Samuel's decisions of the same day
([decisions.md](./decisions.md)). **Rev. 3 (2026-09-25)**: Samuel's second answer, *"ok for all"*.
It confirms the adopted items, passes gate G0 (65 lessons) and adds requirements:
- book-section grouping (FR-4311…FR-4319);
- a maths-expression marker (FR-4320);
- maths-image transcription and the teacher-note rule (FR-4407, FR-4408);
- one source for the misconception catalogue (FR-4409).

It also moves canonical solutions to the EPUB's worked solutions (FR-4302). **Rev. 4 (2026-09-25)**:
Samuel's third round, thirteen answers taken one by one ([decisions.md](./decisions.md), decisions
23–34). It closes gate T413 (the marker is built in-house, [ADR-0025](../../docs/decisions/0025-answer-marker-build-in-house.md)),
approves the constitution amendment (applied, v3.3.0 → v3.4.0), and changes or adds:
- FR-4320's marking rules, confirmed with detail;
- a new pipeline stage that finds this book's prerequisite links (FR-4410);
- native figure types for figures no existing kind can draw (FR-4321);
- all six proposed new widget kinds approved (FR-4306);
- a restore mode for "Load a course" (FR-4208, FR-4210);
- FR-4407's third-reading rule for disagreeing maths transcriptions;
- FR-4205's per-course "Arabic touches" setting (the G10 course's prompts are English-only).

**2026-09-26 (S7 widget verification; decision 47)**: FR-4306 now states the blind verifier's rule, and
that a mapping it does not confirm is held for human review instead of refusing the widget.

**2026-09-26 (curriculum-isolation audit; decisions 37–38)**: FR-4011's last sentence and its edge case
now say an open conversation reads the new scope on its next turn; FR-4206 names a second expected
difference in the National prompts, the handoff line and the cross-subject connections for a student
who cannot see a subject (ADR-0020's eighth exception).

**2026-09-26 (Chapter 8 pilot, G1; decision 36)**: FR-4303 names one more fate an item can have — an
end-of-chapter item G1 rules outside its chapter is kept out of practice and listed in the coverage audit.

**2026-09-27 (G2 decisions 41 and 43–45, and decision 34, written in)**: FR-4320 now states the "true, but be
more precise" re-entry for a less specific choice (decision 41) and carries decision 24's detail; FR-4302 now
states answer-only marking and Samuel's approved corrections to the book's working (decisions 43–45); FR-4206 and
SC-207 name a third expected difference, the Arabic lessons' printed names (decision 34, ADR-0020's sixth
exception).

**2026-10-01 (answer 35)**: FR-4205 now says the American course shows no Arabic anywhere, console and
student, not only in its prompts; the G10 tutor's "write no Arabic at all" line stands (review B7: kept).

**2026-10-01 (answer 36)**: Decision 1 is **superseded** — *"yes the sign up should always ask"*
([decisions.md](./decisions.md)). FR-4004 and FR-4005 are rewritten: sign-up and the first-Google-sign-in
step now always ask which curriculum, naming every curriculum the product knows and pre-selecting none;
a curriculum with nothing live yet for the chosen grade is still offered and selectable, carrying a short
note that there is nothing to study there yet (the orchestrator's default, awaiting Samuel's
confirmation); the account is not created without an answer. FR-4102's console "offered" line and User
Story 3's scenarios and edge cases are reworded to match. Existing accounts are untouched. **Code is now
built and read** (2026-10-01, T434): both refusals answer `422`, not the `409`/`400` this revision and
`contracts/student-api.md` first said — corrected in both places; see the FR-4004, FR-4005 and FR-4102
rows of [traceability.md](./traceability.md).

**2026-10-01 (answer 37)**: Samuel, asked how to fill the Grade 10 course: *"I am on an early phase, and
I always always want to see the whole extraction appear… keep the student always full as if everything
has been reviewed… please consider and fan out the full book for me, and in the background create agents
with the review process so we can review from the console page"* ([decisions.md](./decisions.md),
decision 58; `docs/WIP-g10-pilot/samuel-answers.md`, answer 37). Five follow-ups the same day (decisions
56–58, lettered a–e in the answers file):
- **(a) Maths only, students always full.** Everything extracted for a maths course (Prep-3 or this one)
  reaches students as if reviewed; review status stays an operator fact. Social Studies and Arabic keep
  their existing review queue; Quran and hadith stay sealed (Principle IV). This sharpens, rather than
  changes, ADR-0019 and constitution III's existing "everything in the maths bank is live" rule — see the
  Constitution check, row III, below.
- **(b) A new internal review backlog** (new **FR-4501…FR-4507** below): every item without a human
  stamp is a console row; Samuel, Tamer and Kamil review one at a time; "reviewed" means only a human
  stamp (decision 54, answer 33) — an AI-only pass reads "AI-checked, awaiting human".
- **(c) Gates G1–G4 auto-pass during the fan-out** (FR-4302, FR-4410 amended below; FR-4306 unchanged;
  new **FR-4509**): a chapter is not held for a human to clear before its content reaches students; the
  automatic safety checks (broken maths, an answer that disagrees with the book, the parity guard) are
  not relaxed.
- **(d) A figure with no native type yet is shown as the book's own image, temporarily** (new **FR-4508**,
  TEMPORARILY reversing decision 50/answer 29 "native only, wait" for students): until the native type
  exists, the lesson is not held back for its figure; every stand-in is a backlog item.
- **(e) The full fan-out is approved**, ≈ $0.85–1.1k (decision 58e) — recorded in `plan.md` and
  `docs/PROJECT_STATE.md`.

**Code is in progress on this branch for all of FR-4501…FR-4509; none has file:line evidence yet**
(added when it lands). Two things this pass could not resolve and puts to Samuel: see *Open questions
for Samuel*, below.

**Status of the code.** Committed only as unreviewed WIP snapshots on the pushed feature branch (an
auto-snapshot job commits every 30 seconds, `[skip ci]`); nothing is reviewed by Samuel or merged to `main`.
**Authority level**: a **derived spec** (Spec Kit). It turns Samuel's direction and his decisions of
2026-09-25 and 2026-09-26 ([decisions.md](./decisions.md), 1–47) into testable obligations. The architecture
those decisions imply is recorded in
[ADR-0024](../../docs/decisions/0024-curriculum-as-a-visibility-dimension.md) (accepted 2026-09-25, "ok for
all").
**Input**: Samuel's direction, 2026-09-25, quoted where it is quoted:

- *"we need to digest this book"* — the Grade 10 Mathematics book, which Samuel names the
  **Grade 10 American Curriculum, Math**.
- *"When the user sign up for grade 10, they can have at the beginning choose: American, National,
  etc.. as much as we add Curriculum, and consider that in the console, to choose which subject for
  which grade, should be done also per curriculum."*
- *"I don't want to forget that we create the widgets, and the misconceptions, as well as the new
  questions to match the pattern we decided so generated questions and widgets is something that you
  have to consider in this cycle, and you can update the pipeline to include that as well, and
  please document that as well."*
- On objectives: *"for the objective of the book, you must find it for each lesson, it is a core
  part of our product, and our teaching methodology (don't write that as requirements yet)"*.
- On the options put to him: *"I would take your recommendations"* ([decisions.md](./decisions.md)).
- On the written spec, plan, tasks and the Grade 10 S0 report, the same day: *"ok for all"*. And on
  split sections: *"need good taging and understanding that it is like that, so when we recommend or
  suggest scoring etc... we consider them very related"* (decisions.md #18–#22).

> **Source book, one neutral line.** Siyavula *Everything Maths* Grade 10, version 1.1, in English;
> it is written for South Africa's CAPS curriculum. This spec uses Samuel's naming throughout.
>
> **How changes are marked.** *(changed rev. 2)* and *(changed rev. 3)* mean the requirement's text
> moved with Samuel's decisions; **[ADDED rev. 2]** and **[ADDED rev. 3]** mean the id is new. Every
> earlier id is kept: none is dropped or reused (`docs/VERSIONING.md`).
>
> **Product authority (unchanged)**: `PRD: AI Tutor — Student MVP` v0.4, Tamer Deif. The PRD's
> curriculum dimension already reads *"International primary; national English-medium a maybe"*
> (`specs/001-student-mvp1-delta/delta-matrix.md` §2), and 001 held it constant for its build. This
> feature is the first to vary it.
> **Feature being extended**: `specs/002-identity-and-admin-console/spec.md` — above all its course
> availability block, **FR-2701…FR-2711** ([ADR-0018](../../docs/decisions/0018-course-availability.md)),
> and the content patterns of `specs/001-student-mvp1-delta/spec.md` **FR-1101…FR-1115** and
> **FR-1201…FR-1211** ([ADR-0008](../../docs/decisions/0008-generated-question-bank.md),
> [ADR-0009](../../docs/decisions/0009-widgets-as-questions.md)).
> **Engineering authority**: `.specify/memory/constitution.md` **v3.4.0** (amended 2026-09-25 by
> [constitution-amendment-proposal.md](./constitution-amendment-proposal.md), approved as decision 28 and
> applied) and ADR-0001…ADR-0023, plus ADR-0024 and ADR-0025 (both accepted 2026-09-25) and the
> 2026-09-25/26 notes on ADR-0005, ADR-0019 and ADR-0020. *(Written v3.3.0 / "proposed, not applied" at
> rev. 1; corrected 2026-09-27.)*
> **Privacy review**: [privacy-review.md](./privacy-review.md) (security-privacy-officer, 2026-09-25).
> Its MUST findings are folded in: F11 into FR-4008; F14, F15 and F17 into FR-4208 and FR-4210;
> F4 into FR-4016; F8 into FR-4017; F10 into FR-4014; F13 into FR-4202; F7 into FR-4104. The
> implementation items (the Ask context's book list, `/dashboard`, `/`, the database privilege and the
> once-only guard) are tasks in [tasks.md](./tasks.md). Its SHOULD findings F12 and F18 are also in
> the text (FR-4005, FR-4105).

## Why this feature exists

**The course gate cannot say "American".** Since ADR-0018 a course reaches a student only when a
rule for their (course, grade) says it is live. That was enough while every book in the database came
from one curriculum. ADR-0018 named its own limit: *"A second dimension of visibility … which two
levers cannot express."* A second curriculum is exactly that. A grade-10 student following the
American curriculum and one following the National curriculum are in the same school year and must
see different courses.

**The product already records a curriculum, and nothing reads it.** Every student carries a
curriculum field, set to the Egyptian national value for everyone since 001 (FR-302), and shown on
the console's student page. No gate, list or prompt consults it. This feature makes it
load-bearing.

**Loading a book is not the same as having a course.** The Prep-3 Mathematics course that students
use is the book's 450 questions plus 543 generated questions, 49 widget questions and a
96-entry misconception catalogue, built over several phases (ADR-0008, ADR-0009). A book loaded
without those would run out at the advanced tier inside a week, the problem ADR-0008 measured, and
would give the tutor nothing grounded to say about a wrong answer. Samuel's instruction is that the
new course arrives with all of it, and that the pipeline produces it as part of the line rather than
as separate hand-run steps afterwards.

**Production does not pick up new content on deploy, and has no manual path either.** Production's
curriculum was loaded once, at first boot, and that step skips once three courses exist. The manual
`refresh-content` workflow still points at the frozen baseline's stack, not noor's
([research.md](./research.md) §2.5). A new course needs its own deliberate load step (decision 17),
or it exists on a laptop and nowhere else.

## Scope boundaries

**In scope:** curriculum as a dimension of what a student sees; the curriculum set at sign-up and
changed later by an operator; the console deciding availability per curriculum, grade and course;
the Grade 10 American Mathematics course, complete and hidden until switched on; grade 10 working end
to end; a manual "Load a course" action and `refresh-content` pointed at noor; the extraction pipeline
producing generated questions, widget questions and the misconception library, and its documentation.
**Added in rev. 3:**
- keeping a book section's parts together, for every curriculum (FR-4311…FR-4319);
- marking typed maths answers by equivalence (FR-4320);
- transcribing a book's maths images (FR-4407);
- one source of truth for the maths misconception catalogue, which touches live Prep-3 content
  (FR-4409).

**Added in rev. 4** (Samuel's third round, one-by-one, [decisions.md](./decisions.md) 23–34):
- the marker is built in-house, no library (T413 closed, [ADR-0025](../../docs/decisions/0025-answer-marker-build-in-house.md));
- a stage that finds this book's prerequisite links in the book, evidence-backed and independently
  checked (FR-4410);
- native figure types for figures no existing kind can draw (FR-4321);
- all six proposed new widget kinds approved in principle (FR-4306);
- a restore mode for "Load a course" (FR-4208, FR-4210);
- a third independent reading when two maths-transcription readings disagree, and the EPUB-only image
  rule (FR-4407);
- the G10 course's prompts are English-only, a per-course setting (FR-4205).

**Added 2026-10-01** (answer 37, decisions 56–58):
- an internal console review backlog for maths content with no human stamp, reviewed one at a time by
  `content-review` operators, goal zero (FR-4501…FR-4507);
- gates G1–G4 proceed on the AI checks' own recommendation during the fan-out, with every decision
  landing in that backlog (FR-4509);
- a figure with no native type yet shown as the book's own image, temporarily, instead of holding the
  lesson (FR-4508).

**Deliberately not written as requirements here:**

- **Learning objectives and the teaching methodology.** Samuel, 2026-09-25: *"don't write that as
  requirements yet."* The ingest derives each lesson's objectives from the book (decision 12). That
  is pipeline policy, recorded in the ADR-0005 amendment and `docs/specs/extraction-pipeline.md`
  §3.4, not an obligation in this spec. Where a requirement below counts coverage *per objective*
  (FR-4304, FR-4305, FR-4307), it uses the objective only as the unit the curriculum graph already
  attaches questions to — the same unit FR-1109 and ADR-0008's coverage floor use. It says nothing
  about what an objective is, how one is found or worded, or how it is taught.
- **Licensing, credit and attribution of the source book.** Samuel's team handles these outside the
  app. This spec adds no requirement about them. (The *generation* attribution constitution III
  requires on machine-written content is unrelated and still applies.)
- **A student-facing curriculum control.** At launch only an operator changes a curriculum
  (decision 4). A student control belongs with FR-2013's profile editor, when that is built.
- ~~**Grading of expressions, intervals and coordinate pairs.** A follow-up (decision 14).~~ **In
  scope since rev. 3** (decision 20, FR-4320). What stays out: proofs and sketches, which remain worked
  examples (FR-4303).
- **Courses shared by two curricula.** One course belongs to one curriculum (decision 2).
- National Grade 10 (Secondary 1) books, and any curriculum beyond National and American. The
  mechanism must take them without redesign (FR-4001); loading them is later work.
- Payment or plan gating (FR-2711 and the `requires_plan` seam are untouched).
- The Master design variant (ADR-0017's switch stays off; grade 10 renders Play, decision 7).
- Socratic probing on the G10 course (off at launch, decision 7).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — The Grade 10 book becomes a complete course, hidden until someone switches it on (Priority: P1)

Samuel runs the documented ingest on the Grade 10 book. The console then lists **Mathematics —
Grade 10 (American)** beside the existing courses, with its real depth: lessons, book questions and
their solutions, generated questions, widget questions and misconceptions, and any gaps named. No
student can see it. He marks one test account, which then sees the course and studies a lesson in
it: the tutor teaches from this book's pages, a wrong multiple-choice answer brings back the
refutation for that exact mistake, and a widget question grades a construction. When he is ready he
starts the "Load a course" action, and the same course appears on the live console, still hidden.
He switches it on for grade 10, where it is the only course live.

**Why this priority**: it is the thing Samuel asked for first ("we need to digest this book"), and it
is useful on its own. With today's content, grade 10 has no National course, so the existing
(course, grade) rule could already show this course to grade-10 students.

**Independent Test**: on a local database with the three National courses loaded, run the ingest and
the load for the Grade 10 book; confirm in the console that the course is listed with its depth and
is hidden; confirm that a grade-10 student sees nothing from it; give a test account an exception and
confirm that account can study a lesson end to end; confirm every National course, and the tutor's
instructions for it, are unchanged.

**Acceptance Scenarios**:

1. **Given** the book has been ingested and loaded, **When** an operator opens the console's course
   list, **Then** Mathematics — Grade 10 (American) is listed under the American curriculum with its
   depth by content kind, and it reads as hidden for every grade.
2. **Given** the course is loaded and no rule makes it live, **When** any student opens any student
   surface or requests one of its lessons directly, **Then** nothing from it appears and the direct
   request is answered exactly as for a course that does not exist.
3. **Given** a test account with an exception for the course, **When** it opens a lesson, **Then**
   the lesson follows the book's own order, every citation points to a page of this book, the tutor
   refers to "this book", and nothing names the Egyptian ministry textbook.
4. **Given** that test account answers a generated multiple-choice question wrongly, **When** the
   answer is graded, **Then** the attempt records the misconception its chosen option names, and the
   refutation served is the one for that misconception.
5. **Given** that test account completes a widget question, **When** it is graded, **Then** the
   result is recorded like any other attempt, and a wrong construction is diagnosed by name.
6. **Given** production holds the three National courses and real students, **When** an operator
   starts the "Load a course" action for this course, **Then** a backup is taken first, the rollback
   is printed, the course and all of its content arrive, the course is hidden, and every other course
   and every student's data is unchanged.
7. **Given** the course is already in production, **When** the action is started again, or a code
   deploy runs, **Then** nothing is reloaded, deleted or made visible.
8. **Given** the course is switched on for grade 10 at launch, **When** a grade-10 student opens the
   product, **Then** the American maths course is the only course they can reach, and Prep-3 maths is
   not among them. *(added rev. 2, decision 6)*

---

### User Story 2 — The next book goes through one documented line (Priority: P2)

The generated questions, widget questions and misconception catalogue for Prep-3 were each produced by
a separate script, run by hand after the book was extracted. For the Grade 10 book, and for every book
after it, they are stages of the same line. Someone who has never run it follows
`docs/specs/extraction-pipeline.md` and gets a complete course, with a report per stage of what was
produced, what was rejected and why, and what it cost.

**Why this priority**: it is how User Story 1's content is produced, and Samuel asked for it to be
updated and documented in this cycle. Without it the Grade 10 course is a one-off.

**Independent Test**: from the document alone, run the line on the Grade 10 book into a scratch
database; confirm each stage's report; run it again and confirm nothing is duplicated and no other
course changed.

**Acceptance Scenarios**:

1. **Given** the Grade 10 book and the pipeline documentation, **When** an engineer follows the
   document, **Then** the line produces book questions with canonical solutions, generated question
   families, widget questions and the misconception catalogue with refutations, without an
   undocumented step.
2. **Given** a completed run, **When** it is run again on the same book, **Then** no question,
   family, widget or misconception is duplicated, and every other course is untouched.
3. **Given** any stage rejects an item, **When** the run ends, **Then** its report names the item, the
   rule it failed and the stage, and the rejected item is not loaded.
4. **Given** a change to the pipeline for this feature, **When** the pipeline's own checks run,
   **Then** the Arabic self-check stays at 100% and the deterministic Arabic audit stays green.
5. **Given** a chapter no existing widget kind fits, **When** the widget stage runs, **Then** the
   chapter is on a widget-gap list for Samuel, and no new widget kind is built before he approves it.
   *(added rev. 2, decision 11)*

---

### User Story 3 — A student follows one curriculum, set at sign-up (Priority: P3) *(changed 2026-10-01, answer 36)*

A student signing up picks their grade. The next question always asks which curriculum their school
follows, naming every curriculum the product knows and pre-selecting none — including a curriculum with
nothing live yet for that grade, which carries a short note that there is nothing to study there yet. The
account is not created without an answer. From then on every list, lesson, progression, skill map,
practice plan and tutor conversation draws only on that curriculum's courses. A student who signs up
with Google gets one short screen for grade and curriculum before their first lesson.

**Why this priority**: it is the second half of Samuel's direction and the reason the course gate
needs a new dimension. *(Changed 2026-10-01, answer 36: Samuel reversed decision 1 — "yes the sign up
should always ask" — after the console showed no curriculum question for grade 10, where only American
is live.)* Sign-up asks at every grade, whatever is live there, so the scoping question is visible from
day one even where, as at launch, grade 10 has only one curriculum's course live.

**Independent Test**: with two curricula live for one grade (a fixture is enough), sign up at that
grade, choose one, and walk every student surface confirming no course of the other curriculum appears.
Sign up at a grade with only one curriculum live and confirm the question is still asked, naming every
curriculum, with the one that has nothing live there carrying the note, and confirm the chosen curriculum
is stored. Sign in with Google for the first time and confirm the one-screen step also always asks.

**Acceptance Scenarios**:

1. **Given** any grade, **When** a new student gives that grade at sign-up, **Then** they are asked to
   choose among every curriculum the product knows, pre-selecting none, and nothing else is added to
   sign-up. *(Changed 2026-10-01, answer 36: no longer conditioned on how many curricula have a live
   course for the grade.)*
2. **Given** a curriculum with nothing live for the grade a new student gave, **When** the question is
   shown, **Then** that curriculum is still listed and selectable, carrying a short note that there is
   nothing to study there yet *(the orchestrator's default; awaiting Samuel's confirmation)*, and
   choosing it stores it as the student's curriculum. *(Changed 2026-10-01, answer 36 — supersedes the
   former scenario 2, "they are not asked, and that curriculum is stored.")*
3. **Given** an American-curriculum grade-10 student, **When** they open the lesson list, the subject
   home, the skill map, the practice plan, the progress page or the home page, or ask the tutor
   anything, **Then** only American courses appear or are drawn on.
4. **Given** that student, **When** they request a National course's lesson by a pasted address,
   **Then** it answers exactly as a course that does not exist.
5. **Given** a student who existed before this feature, **When** they sign in, **Then** they see
   exactly what they saw before, and their curriculum reads as National.
6. **Given** a new account created through Google, **When** the sign-in completes, **Then** a single
   screen asks for grade, and for curriculum by the same always-ask rule as scenario 1, before any
   lesson. *(added rev. 2, decision 5; reworded 2026-10-01, answer 36)*

---

### User Story 4 — The console decides availability per curriculum, grade and course, and never pools curricula (Priority: P4)

On the course availability page Samuel sees courses grouped by curriculum, decides per grade whether
each is live, and sees for each grade which curricula have something live there *(changed 2026-10-01,
answer 36: sign-up itself now always offers every curriculum at every grade; this line shows what is
live, so an operator can see which curricula will carry sign-up's "nothing to study yet" note)*. On the
Content page, the Overview and every other console view, a figure for "Mathematics" always says which
course it counts; the Overview splits by course.

**Why this priority**: it is where the curriculum dimension is decided. Because a course belongs to
exactly one curriculum, the existing per-(course, grade) rule already carries most of the meaning;
this story makes the curriculum visible and stops figures from mixing two maths courses.

**Independent Test**: in the console, set one course live for a grade in each of two curricula and
confirm the per-grade "offered" line changes; open the Content page and the Overview and confirm no
figure counts two maths courses together.

**Acceptance Scenarios**:

1. **Given** the course availability page, **When** an operator opens it, **Then** courses are grouped
   under their curriculum, each section labels grades in its own curriculum's words, and each grade
   shows which curricula have something live for a new student of that grade *(changed 2026-10-01,
   answer 36: every grade's sign-up names every curriculum regardless; this line names what is live,
   not what will be asked)*.
2. **Given** an operator is about to hide the last live course of a curriculum for a grade that has
   students following it, **When** they make the change, **Then** the page first says how many
   students it leaves with nothing to study, as part of the page rather than a browser dialog.
3. **Given** the Content page or the Overview, **When** an operator narrows to Mathematics, **Then**
   they choose which course, and no figure combines the two. The Overview's cohorts are per course.
4. **Given** a student's console record, **When** an operator with `student-data` opens it, **Then**
   it shows the student's curriculum, its change history, and which courses the student can see and
   why.

---

### User Story 5 — An operator changes a student's curriculum, and the student loses nothing (Priority: P5) *(changed rev. 2, decision 4)*

A student who was stored as National turns out to follow the American curriculum at school. An
operator opens the student's console record and changes the curriculum. The page tells the operator
plainly which courses the student will stop and start seeing, and that progress is kept. Later the
operator switches it back, and the student finds their National progress exactly where they left it.
At launch the student has no control of their own for this.

**Why this priority**: a wrong curriculum must be correctable, and correcting it must not cost the
student their work. It is also the least used path.

**Independent Test**: as an operator, change the curriculum of a student with progress in one
curriculum; as the student, study in the new one; change it back; confirm the first curriculum's
mastery, saved places and history are unchanged and the second's are kept too, and that both
changes are in the student's console record.

**Acceptance Scenarios**:

1. **Given** an operator with `student-data` on a student's console record, **When** they change the
   curriculum, **Then** the page asks them to confirm in the page, naming what the student will stop
   and start seeing and that progress is kept.
2. **Given** a student with mastery and a saved place in a course, **When** their curriculum is
   changed and later changed back, **Then** that mastery, saved place and history are exactly as they
   left them.
3. **Given** a change, **When** it happens, **Then** no mastery is copied, merged or moved between
   courses, even between two maths courses.
4. **Given** a change, **When** an operator opens the student's console record, **Then** the change is
   listed with when, from which curriculum, to which, and which operator made it.
5. **Given** a signed-in student, **When** they look for a way to change their curriculum, **Then**
   there is none at launch.

### User Story 6 — Parts of one book section stay together (Priority: P1, ships with US1) **[ADDED rev. 3, decision 18]**

The Grade 10 book's section 1.7 Factorisation is three lessons long after G0's split. A student opens
"1.7 Factorisation · part 1 of 3". When they finish it, the product offers "Continue Factorisation",
not section 1.8. They are never moved to 1.8 until all three parts pass. The progress page reads
"Factorisation — 2 of 3 parts mastered". The skill map shows the three parts as one group. Asked about
part 2, Noor draws on part 1 as closely related material. The same holds for a merged lesson, which
names every section it covers, and for a promoted chapter introduction.

**Why this priority**: Samuel: *"need good taging and understanding that it is like that, so when we
recommend or suggest scoring etc... we consider them very related"*. G0 split five sections of the
Grade 10 book. Without grouping, a student could be moved from part 1 of Factorisation into the next
section, and scored and recommended as if the three parts were unrelated lessons. It numbers after
the rev. 2 stories so their task labels stay stable, and it ships with US1.

**Independent Test**: with a course holding one split section (the G10 course, or a fixture), walk a
student through part 1 and check each of the following: the recommendation, the progression hold, the
roll-up, the skill-map group, the section number and the console's per-section figures. Then confirm
a National course is unchanged.

**Acceptance Scenarios**:

1. **Given** a split section, **When** a student opens any of its parts, **Then** the printed section
   number, the section title and "part n of m" are shown.
2. **Given** a student who has passed part 1 of 3, **When** the product recommends what to do next,
   **Then** it offers the section's next part, named by the section ("Continue Factorisation").
3. **Given** a student who has passed parts 1 and 3 but not part 2, **When** their place moves on,
   **Then** it stays within the section, on part 2.
4. **Given** each part scored on its own objectives, **When** the progress page shows the section,
   **Then** it reads "2 of 3 parts mastered", and the section reads mastered only when all three are.
5. **Given** the skill map, **When** it is opened on the course, **Then** the three parts appear as one
   group labelled by the section.
6. **Given** a merged lesson (1.2 into 1.3; 5.2 + 5.3 + 5.4) or a promoted introduction (6.1, 7.1),
   **When** a student or an operator looks at it, **Then** it shows every section it covers, or that it
   is the chapter introduction.
7. **Given** the console, **When** an operator opens the course's content or overview figures,
   **Then** each can be read per lesson and per section.
8. **Given** a National course, in which no section is split or merged, **When** anything is shown or
   the tutor is prompted, **Then** it is unchanged.

---

### User Story 7 — A typed maths answer is marked by what it means (Priority: P1, ships with US1) **[ADDED rev. 3, decision 20]**

A student asked to factorise $x^2 - 9$ types $(x+3)(x-3)$; another types $(x-3)(x+3)$. Both are
marked correct. A third types $x^2 - 9$ and is told the question asks for the factorised form. A
decimal typed with a comma, a pair of values in either order, an interval, and a coordinate pair
written `(2; -1)` or `(2, -1)` are each marked by what they mean.

**Why this priority**: 54% of the Grade 10 book's exercise items cannot be marked today. 1,111 of them
have a maths-expression answer. Without a marker, most of the book is either unmarkable or forced into
multiple choice it was not written for. It numbers after the rev. 2 stories, and ships with US1.

**Independent Test**: run the marker over every Grade 10 printed answer, typed as printed and in
equivalent forms, and over wrong-form answers. Then replay every existing course's recorded attempts
through the attempts route and confirm identical outcomes.

**Acceptance Scenarios**:

1. **Given** an algebraic answer, **When** the student types an equivalent expression, **Then** it is
   marked correct.
2. **Given** a question that asks for a form (factorised, simplest form, a variable as subject),
   **When** the student types an equivalent answer in another form, **Then** it is not marked correct,
   and the student is told which form is asked.
3. **Given** an answer with several values, an interval or inequality, or a coordinate pair, **When**
   it is typed in any accepted notation (values in any order, decimal comma or point, `(x; y)` or
   `(x, y)`), **Then** it is marked by what it means.
4. **Given** an answer the marker cannot read, **When** it is submitted, **Then** the student is asked
   to re-enter it, and it is not marked wrong.
5. **Given** any question of an existing course, **When** it is answered, **Then** it is marked exactly
   as before.

### Edge Cases

- **A grade has no live course in any curriculum** (for example grade 7 today). *(Changed 2026-10-01,
  answer 36.)* Sign-up still asks, naming every curriculum; every one of them carries the "nothing to
  study here yet" note, since none is live for this grade. Whichever the student chooses is stored as
  chosen, and the student sees the product's existing empty state, as a new grade does today.
- **An operator's rule change leaves a student's curriculum with nothing live for their grade.** The
  student is not moved automatically. Only an operator changes a curriculum (decision 4). The student
  sees the empty state, and the console counts such students before the change (FR-4103) and lists
  them afterwards (FR-4105).
- **Existing grade-10 students stored as National.** At launch grade 10 has only the American course
  live (decision 6), so they would see nothing. Before switching the course on, an operator checks
  for them (the launch checklist, `quickstart.md`) and changes their curriculum if they are real
  students. Production holds only founder and test students today.
- **A student's grade changes and the new grade does not offer their chosen curriculum.** The
  curriculum is kept, and the console flags the student for an operator (FR-4008). An implied
  curriculum may be re-resolved instead, and the re-resolution is recorded.
- **The first-Google-sign-in step is submitted twice**, by a replayed request or a bug. The second
  submission is refused loudly and changes nothing (FR-4014). The step is never a way for a student
  to change a curriculum.
- **A test account with an exception for a course outside its curriculum.** It sees that course, the
  one sanctioned way across (FR-4009). A list that then holds two maths courses shows them apart,
  course by course, never interleaved.
- **The course gate is switched off.** Operator rules are suspended; curriculum scoping is not
  (FR-4015). A loaded American book still reaches only American-curriculum students.
- **The tutor or the upload parser is asked about something only the other curriculum's book
  covers.** It is out of the student's material. The tutor acknowledges, declines and redirects to
  the nearest material in the student's own courses (Principle II). It never grounds an answer in a
  course the student cannot see.
- **A chat is open when an operator changes the student's curriculum** *(changed 2026-09-26, decision
  37)*. The next turn reads the new scope: the open chat's snapshot is rebuilt under it, and a lesson
  whose course the student may no longer see is refused like any hidden course. The same holds for an
  exception granted or revoked, and a rule changed for her grade.
- **A book exercise whose answer is a maths expression, an interval or a coordinate pair.** It is a
  typed question marked by equivalence (FR-4320). A proof, a sketch or a "show that" stays a worked
  example. Multiple choice is used only where it is natural. Every item is counted by what became of
  it, and none is silently rewritten into a different question (FR-4303).
- **An equivalent answer in the wrong form**, such as the expanded form when the factorised form was
  asked. It is not marked correct, and the student is told which form is asked (FR-4320).
- **The book prints no answer for an exercise** (261 items in this book, mostly proofs and sketches).
  Its EPUB worked solution is canonical. It is verified against that solution alone and listed at the
  solutions gate, and most such items stay worked examples (FR-4302, FR-4303). Nothing is solved from
  scratch and served.
- **The printed answer, the EPUB solution and the blind re-solve do not all agree.** The item is held
  for Samuel at the solutions gate and never corrected silently: books have errata (FR-4302).
- **A student opens part 3 of a section by a direct link before passing part 2.** The explicit link
  wins, as it does today (FR-3206). The student's place still does not move past the section until
  part 2 passes (FR-4313).
- **A maths image neither transcription pass agrees on.** It goes to a human, and is never guessed
  (FR-4407). A lesson that needs it waits.
- **A note the book addresses to teachers** ("According to CAPS, …"). It is dropped before claims are
  extracted, and never reaches a student (FR-4408).
- **The book's own notation.** Decimal commas and `(x; y)` pairs are shown in the app's style; the
  book's vocabulary and word-problem contexts, the Rand included, stay as printed (FR-4308).
- **No existing widget kind fits a chapter.** The chapter goes on a widget-gap list for Samuel. A new
  kind is built only after he approves it (FR-4306).
- **The course is reloaded after students have studied it.** That is a content refresh (Principle X),
  which must keep their progress or refuse, saying what would be lost (FR-4210). It is never the
  "Load a course" action, which only ever adds.
- **Grade labels.** Grade 10 is "Secondary 1" in the National curriculum and "Grade 10" in the
  American one. One stored school year, labelled by curriculum where a curriculum is known (FR-4013).

## Requirements *(mandatory)*

> Obligations on the product, testable, written for a non-technical founder. They name no table,
> column, library or framework; `plan.md` owns that. The two curriculum ids are named because Samuel
> decided them (decision 3). Numbering starts at **FR-4001** so nothing collides with 000/001
> (`FR-0xx…FR-12xx`) or 002 (`FR-20xx…FR-34xx`): **FR-40xx** curriculum as a dimension · **FR-41xx**
> console · **FR-42xx** the Grade 10 American Mathematics course · **FR-43xx** content completeness ·
> **FR-44xx** the extraction pipeline · **FR-45xx** the internal review backlog (**[ADDED 2026-10-01,
> answer 37]**). Success criteria are **SC-2xx**, after 001's `SC-0xx` and 002's `SC-1xx`. Status is
> tracked in [traceability.md](./traceability.md), using the vocabulary in
> `docs/VERSIONING.md`. Every requirement below is OPEN.

### Curriculum as a dimension (FR-4001…)

- **FR-4001** *(changed rev. 2, decision 3)*: The product MUST hold curricula as a list that grows by
  adding an entry. Today it holds **National** (`eg-national-en`), which covers every Egyptian
  ministry book already loaded — Prep-3 Mathematics, Social Studies and Arabic — and **American**
  (`us-american-en`, shown as "American"), which covers the Grade 10 Mathematics course (FR-4201).
  Adding a third curriculum MUST need no change to how sign-up asks, how the gate decides or how the
  console is organised, beyond adding the curriculum and its courses.
- **FR-4002**: Every course MUST belong to exactly one curriculum. A course with no curriculum MUST
  be hidden from every student, failing closed as FR-2704 does for a course with no rule.
- **FR-4003** *(changed rev. 2)*: Every student MUST follow exactly one curriculum at a time, and the
  product MUST record how it was set: **chosen** (the student answered the sign-up question or the
  first-Google-sign-in step, or an operator set it) or **implied** (stored without asking, because
  the grade offered one curriculum or none). Students who existed before this feature were never
  asked and were only ever served National courses; they MUST read as National, implied, with no
  other data changed, and MUST see exactly what they saw before. A student whose curriculum value is
  not one the product knows MUST see no course except what an exception grants, and the console MUST
  flag the value as unknown.
- **FR-4004** *(resolved rev. 2 — was Q1; decision 1; superseded 2026-10-01 by answer 36 — see
  decisions.md)*: A grade **offers** a curriculum when at least one course of that curriculum is live
  for that grade, by the console's rules, in this environment. While the course gate is switched off
  (FR-4015), a grade offers a curriculum when one of its courses is written for that grade. **This rule
  no longer decides whether sign-up or the first-Google-sign-in step ask** — FR-4005 now always asks,
  naming every curriculum the product knows. It decides: which curriculum carries sign-up's "nothing to
  study here yet" note (FR-4005); the automatic resolution used when an implied curriculum is
  re-resolved on a grade change (FR-4008), which answer 36 does not touch; and the console's "offered"
  line (FR-4102). Those three readers MUST use this one rule, so they never disagree about what a grade
  offers.
- **FR-4005** *(changed rev. 2, decision 1; changed 2026-10-01, answer 36 — "yes the sign up should
  always ask")*: At sign-up, once a student has given their grade, the form MUST always ask which
  curriculum their school follows, naming **every curriculum the product knows**, not only the ones
  FR-4004 says the grade offers, and pre-selecting none. A curriculum with nothing live yet for the
  chosen grade MUST still be shown and selectable, carrying a short note that there is nothing to study
  there yet *(the orchestrator's default; Samuel has not yet confirmed this note's wording, or that it
  belongs at all)*. The server MUST reject a curriculum the product does not know, and MUST refuse to
  create the account when the curriculum answer is missing: an account is never created without one.
  The chosen curriculum is always stored as chosen. *(Privacy review F12's race condition — a curriculum
  the grade stopped offering between page load and submit — no longer arises here: every known
  curriculum is acceptable at sign-up regardless of whether anything is live for the grade.)*

  **For the automatic re-resolution of an implied curriculum when a grade changes** (FR-4008), which
  answer 36 does not touch, the FR-4004 "offered" rule still applies without asking: a grade that offers
  exactly one curriculum resolves to that one, implied; a grade that offers none resolves to National,
  implied.

  The question remains the only thing this feature adds to sign-up (FR-2002).

  *(Superseded text, decision 1: "a grade that offers two or more curricula MUST ask … naming only
  those curricula … A grade that offers exactly one MUST NOT ask … A grade that offers none MUST NOT
  ask." Kept here for the record; see decisions.md.)*
- **FR-4006** *(changed rev. 2)*: A student's curriculum MUST scope everything the course gate
  already scopes (FR-2705) and the readers that do not yet go through it: the lesson catalogue, the
  subject summaries, the lesson data, the progression and saved place, the skill map, the practice
  plan, the progress page, the home page's counts and book, the figures a lesson shows, the data
  given to the tutor, the Ask-the-Spine context and its list of books, matching an uploaded photo to
  course material, and answer checking. A course of another curriculum MUST be refused where the data
  is read, exactly as a hidden course is. A direct request for one MUST answer exactly as a course
  that does not exist (FR-2706).
- **FR-4007** *(changed rev. 2, decision 4)*: A student's curriculum MUST change only in three ways:
  an operator changes it (FR-4010); it is set at sign-up or in the first-Google-sign-in step; or an
  implied curriculum is re-resolved when the grade changes (FR-4008). It MUST NOT change
  automatically because an operator changed a rule. A student whose curriculum then offers
  them nothing live MUST see the empty state, which says that there is nothing to study yet.
- **FR-4008** *(changed rev. 2, decision 4; privacy review F11)*: When a student's grade changes after
  sign-up — by an operator, or later by the student's own profile editor (FR-2013) — a **chosen**
  curriculum MUST NOT change. If the new grade does not offer it, the curriculum MUST be kept and the
  student flagged for an operator on the console. Only an operator changes a chosen curriculum
  (decision 4, FR-4010). An **implied** curriculum MAY be re-resolved by the FR-4005 rule when the
  grade changes, and the re-resolution MUST be recorded (FR-4012). The first-Google-sign-in step sets
  grade and curriculum together (FR-4014).
- **FR-4009**: A per-student exception (FR-2703) MUST keep winning in both directions, including for
  a course outside the student's curriculum. That is the one sanctioned way a student sees another
  curriculum's course, for example a test account previewing it. Any list that then holds two courses
  of one subject MUST keep them apart, course by course, never interleaved (extending FR-3217's
  split by subject).
- **FR-4010** *(changed rev. 2, decision 4)*: At launch, only an operator holding `student-data`
  (FR-2707) MUST be able to change a student's curriculum, from the student's console record, among
  the curricula the product knows. The change MUST be confirmed in the page, not by a browser dialog
  (FR-2710), and the confirmation MUST name which courses the student will stop and start seeing and
  say that progress is kept. No student surface MUST offer a curriculum control at launch.
- **FR-4011** *(changed rev. 2, decision 4)*: Changing a student's curriculum MUST NOT delete, reset,
  copy, merge or transfer any progress. Mastery, attempts, saved places and history stay with the
  course they were earned in, and changing back MUST restore them exactly as left. No mastery moves
  between courses of different curricula, even courses of the same subject. *(Changed 2026-09-26,
  decision 37:)* A conversation already open MUST read the new scope on its next turn.
- **FR-4012** *(changed rev. 2, decision 4)*: Every change to a student's curriculum after sign-up
  MUST be recorded as history, not as a value overwritten: when, from which curriculum, to which,
  whether chosen or implied, and which operator (or "re-resolved by the product", FR-4008). The
  curriculum set at sign-up or in the first-Google-sign-in step MUST be recorded with the account's
  creation.
- **FR-4013**: A student's grade MUST remain one stored school year, shared by all curricula.
  Wherever a grade is shown beside a known curriculum, its label MUST be that curriculum's name for
  the year: grade 10 is "Grade 10" in the American curriculum and "Secondary 1" in the National one.
- **FR-4014** **[ADDED rev. 2, decision 5]**: A student whose account was created by a first Google
  sign-in MUST pass one screen that sets their grade and, by the FR-4005 rule, their curriculum,
  before any lesson opens. The screen MUST NOT ask for anything else, and it MUST end in the same
  signed-in state a password sign-up does (FR-2006). **It MUST work once per account** (privacy
  review F10). Whether the step is still pending MUST be a durable fact the server checks at the
  point of writing, not only at redirect time. A second submission MUST be refused with an error, not
  ignored silently, so that the step can never become a student-side way to change a curriculum
  (decision 4).
- **FR-4015** **[ADDED rev. 2 — adopted with "all recommendations", decisions.md A; confirmed by Samuel 2026-09-25]**: Switching the
  course gate off (FR-2709) MUST suspend the operators' rules and MUST NOT suspend curriculum
  scoping. With the gate off, a student sees every loaded course **of her own curriculum**, plus any
  exception. *(Amends FR-2709's "absent means ungated" for the curriculum dimension only.)*
- **FR-4016** **[ADDED rev. 2 — adopted with "all recommendations", decisions.md D; privacy review
  F1, F4]**: A student's curriculum MUST NOT be sent to the anonymous analytics stream, and MUST NOT
  be shown to any other student. It MAY be recorded in the product's own first-party event record. An
  automated test MUST fail if "curriculum" ever becomes an allowed anonymous-analytics event or
  property. Curricula MUST be labelled flatly and factually ("American", "National"), never framed as
  a tier ("premium", "international", "private-school").
- **FR-4017** **[ADDED rev. 2 — privacy review F8]**: The rule that only an operator changes a
  curriculum (decision 4) MUST be enforced by the database's own privileges, not only by the
  application. The student-facing application MUST hold no right to change a student's curriculum,
  or how it was set, except through the two one-time paths: creating the account at sign-up, and the
  once-only first-Google-sign-in step (FR-4014), which the database itself limits to once. A test
  MUST fail if the student-facing role gains that right.

### Console (FR-4101…)

- **FR-4101** *(changed rev. 2, decision 2)*: An operator MUST decide course availability per
  **curriculum, grade and course**. Because each course belongs to one curriculum, the existing rule
  per (course, grade) MUST stay the only rule, with no new rule store. The course availability page
  MUST group courses under their curriculum and label grades in that curriculum's words (FR-4013). A
  course's rule for a grade MUST apply only to students of that grade who follow that course's
  curriculum, or who hold an exception for it (FR-4009). Everything FR-2701…FR-2711 requires holds
  unchanged, except FR-2709 as FR-4015 amends it.
- **FR-4102** *(changed 2026-10-01, answer 36)*: The console MUST show, per grade, which curricula have
  at least one live course, by the one rule of FR-4004, so an operator can see which curricula sign-up's
  always-asked question (FR-4005) will show with the "nothing to study here yet" note for that grade,
  before changing a rule. *(Before answer 36 this line showed which curricula sign-up would ask among;
  now sign-up always names every curriculum, so this line shows what is live, not what is asked.)*
- **FR-4103**: Before a change hides the last live course of a curriculum for a grade that has
  students following it, the console MUST state, in the page (FR-2710), how many students it leaves
  with nothing to study. It MUST show a count only; the `content-review` role MUST NOT learn a
  student's name through it (FR-2707).
- **FR-4104** *(changed rev. 2, decision 8)*: No console figure may combine two courses of one
  subject. The **Overview MUST split its cohorts by course**. The Content page (FR-3212), the Cost and
  Feedback pages' per-subject figures, `/pipeline` and `/gallery` MUST each name the course they
  count. Any view that lets an operator select by subject or grade MUST also let them select the
  curriculum or course. On any page an operator without `student-data` can reach — the Cost page
  above all — a curriculum MUST appear only as an aggregate label on a figure, never as a fact about
  one student, and never joined to anything that narrows to one student (FR-2406; privacy review F7).
- **FR-4105** *(changed rev. 2, decision 4)*: A student's console record MUST show their curriculum,
  whether it was chosen or implied, flag a value the product does not know, flag a chosen curriculum
  the student's grade no longer offers (FR-4008), list its change history (FR-4012), and show which
  courses they can see and why: the grade rule, their curriculum, or an exception. An exception for a
  course outside the student's curriculum MUST be labelled as exactly that, never folded into the
  curriculum's own list (privacy review F18). The record MUST carry the curriculum change control of
  FR-4010. The students list MUST show each student's curriculum. All of this is student data, under
  the same role and read-recording rules as the rest of the record (FR-2306, FR-2406).

### The Grade 10 American Mathematics course (FR-4201…)

- **FR-4201** *(changed rev. 2, decision 3)*: The product MUST hold a **Grade 10 Mathematics course in
  the American curriculum** (`us-american-en`), built from the source book named at the top of this
  spec, in English. Students see it as Mathematics for grade 10, American curriculum. Its subject is
  Mathematics — the same subject as Prep-3 maths, taught from a different course.
- **FR-4202** *(resolved rev. 2 — was Q2; decision 9)*: The course MUST be hidden from every student
  until an operator switches it on in the console (FR-2704, FR-4101). Loading it, in any environment,
  MUST NOT make it visible, and no migration, seed, deploy or load action may write a live rule for
  it. **"Not visible" includes being named**: no reader may give a student who cannot see the course
  its title, its book, its chapters or its figures. That covers the tutor's list of source books, the
  home page's book, the progress page's topics, and figures fetched by id. Those readers MUST be
  scoped (FR-4006) before the book is loaded into any database that other students' traffic reaches,
  rehearsal copies and shared development databases included (privacy review §5, F13).
  **Switching it on is the only gate on its content**: ADR-0019's decision covers this course, so
  its whole bank — book questions, generated questions, widget questions and misconceptions,
  reviewed or not — is served once the course is live for a student. Review status stays in the data
  and is shown to operators only (FR-3211, FR-4310).
- **FR-4203**: The course's lessons MUST follow the book's own chapter and section order, and every
  reader of curriculum order MUST use that order for this course (FR-3217). The book has no school
  terms, so no label in this course may name a term. For this course, FR-3207's "the school's order"
  reads "the book's order".
- **FR-4204** *(changed rev. 2, decision 7)*: Grade 10 MUST work end to end wherever a grade is used:
  sign-up, the first-Google-sign-in step, the course gate, the console's grade columns and filters,
  the tutor's address of the student, the design-variant rule, progression, and every console figure
  keyed by grade. A grade-10 student MUST render the **Play** design while ADR-0017's Master switch is
  off. This MUST be shown with a real grade-10 student account, not assumed because the grade list
  already contains 10.
- **FR-4205** *(resolved rev. 2 — was Q3; decision 10; changed rev. 4, decision 30; widened 2026-10-01,
  answer 35)*: Everything the
  product tells a student, or gives the tutor, about where this course's material comes from MUST name
  this course's own source: the tutor's instructions for this course refer to "this book" and its
  pages, and never name the Egyptian ministry textbook, another course's book or another course's
  syllabus year. Every citation receipt in this course MUST resolve to a page of this book (Principle
  II). ADR-0020's prompt hold is lifted **for this course's prompts only**.

  **This course's prompts MUST be English-only**: no Egyptian-Arabic phrase or colloquialism, while the
  address term "Egyptian student" MUST be kept — the audience is still an Egyptian student, following a
  book written for another curriculum. This MUST be a **per-course setting** (an "Arabic touches" flag
  on `CourseDef`): unchanged (on) for every National course, off for this course only.

  **This course MUST show no Arabic anywhere** *(answer 35, 2026-10-01: "this is american course we said no
  arabic")*: no Arabic subject name, curriculum name, book wording ("كتاب الوزارة") or heading on any console
  or student surface for this course, its lessons, or the American curriculum. The same per-course setting
  governs it, chosen per course and never per subject (Prep 3 maths and this course share a subject).
  The tutor's instruction to write no Arabic at all, even when the student writes in Arabic, stands
  (consistency review B7: kept). The surfaces stay Arabic-capable (constitution V): every National
  course's Arabic is unchanged.
- **FR-4206**: Adding this course MUST NOT change any National course. What a National student sees,
  every student's progress, and the tutor's instructions for every existing course MUST be identical
  before and after, proven byte for byte with the prompt capture harness (Principle IX). This
  course's prompts are new captures, not changes to existing ones. **One difference is expected and
  deliberate**: the Ask context's list of source books. For a student who can see every loaded
  course it is byte-identical. For one who can see fewer, the hidden books stop being named —
  the privacy fix FR-4202 requires (privacy review §5.1). **Samuel acknowledged it on 2026-09-25**
  (decisions.md, second round). **A second difference is expected and deliberate** *(added
  2026-09-26, decision 38)*: for a student who cannot see a subject the lesson prompt's
  cross-subject rule would hand off to, that line offers no handoff to it (or, when no other subject
  is open, none at all), and a curated cross-subject connection into a course she cannot see is not
  given to the tutor. For a student who sees every course it touches, the prompt is byte-identical.
  Any handoff card to a closed subject that a reply still carries is removed before it reaches her.
  **A third difference is expected and deliberate** *(added 2026-09-27, decision 34; ADR-0020's sixth
  exception)*: a National Arabic lesson whose working title differs from the book's printed lesson name
  is shown, and given to the tutor, under the printed name (for example «عِبادُ الرَّحمنِ», not its first
  objective «فهم النص والاستماع»). Nothing else in those prompts changes, and every maths and Social
  Studies prompt stays byte-identical.
- **FR-4207**: The solution's content drift guard MUST know this book, by its source fingerprint and
  its counts, and MUST fail loudly if the loaded course drifts from them. It MUST keep guarding the
  Prep-3 Mathematics set exactly as it does today (Principle XI, FR-1103).
- **FR-4208** *(changed rev. 2, decision 17; changed rev. 4, decision 29)*: The course MUST reach
  production through a separate **"Load a course" action that an operator starts by hand**, never
  through a code deploy. The action MUST decide whether to act by **that course's own presence**, never
  by a total count of courses or questions. Before it writes anything it MUST take a backup, **verify
  that the backup can be read back**, and print its one-line rollback (privacy review F14). It MUST
  only add: if the course is already present it MUST change nothing and say so. After loading it MUST
  run the drift guard for every course and report pass or fail next to the course's completeness (F17).
  It MUST load this course with all of its content
  — book questions and solutions, generated questions, widget questions, the misconception catalogue
  and its explanations, and the book's figures — and leave every other course and every student's
  data unchanged. A deploy MUST NOT load the course and MUST NOT make it visible (Principle X).

  **The same action MUST also offer a `restore` mode** (decision 29): replaying a previously exported,
  reviewed bundle for a course, keeping each row's own status and review stamp (the same semantics
  `export_generated_content.py`'s bundles already carry, `docs/VERSIONING.md`). Restore MUST be gated
  by a **typed confirmation of the course id**, the same backup-first, verified-readback discipline as
  the load mode, and MUST refuse if the restore target's provenance does not match the course already
  present.
- **FR-4209**: The load MUST be rehearsable, as a dry run and on a copy of production, before it is run
  for real. Its result MUST be checkable afterwards from the console, through the course's
  completeness (FR-4309), without opening a database shell.
- **FR-4210** *(changed rev. 2, decision 17; changed rev. 4, decision 29)*: Any later change to a
  course that is already loaded is a content refresh (Principle X), and the manual refresh workflow
  MUST act on this product's own stack (noor), not the frozen baseline's. Retargeting it is a
  dependency of this requirement, not follow-up work (privacy review F15). A refresh MUST either keep
  every student's progress in the course or refuse, saying what would be lost. It MUST NOT discard or
  orphan progress silently. **Restoring a previously exported, reviewed bundle** (FR-4208's restore
  mode) is one such refresh path and MUST follow the same rule: it keeps every student's progress or
  refuses, naming what would be lost.
- **FR-4211** **[ADDED rev. 2, decision 6]**: At launch, the Grade 10 American Mathematics course MUST
  be the only course live for grade 10. Prep-3 Mathematics and every other National course MUST NOT
  be live for grade 10.
- **FR-4212** **[ADDED rev. 2, decision 7]**: At launch, Socratic probing MUST NOT run in this course,
  whatever the position of the teaching switch (FR-3101…FR-3111), and the console's teaching page
  MUST say which courses probing can reach.

### Content completeness of an ingested course (FR-4301…)

> What the Grade 10 course MUST contain when it is loaded. These follow the patterns already decided
> for Prep-3 Mathematics — ADR-0008 and FR-1101…FR-1115 for generated questions and misconceptions,
> ADR-0009 and FR-1201…FR-1211 for widgets — and say where this course differs. The scope note on
> objectives above applies to every requirement in this block.

- **FR-4301** *(changed rev. 2, decisions.md B; changed rev. 3, G0)*: Every chapter and section of the
  book MUST be in the course. **Each numbered teaching section is one lesson**. When the book's
  structure is approved (gate G0):
  - a section too long for one sitting may be split into parts along its own sub-headings;
  - a chapter introduction that teaches and carries practice may become a lesson;
  - a section with neither a worked example nor an exercise may be merged into its neighbour.

  Every such change keeps its book provenance (FR-4311). **G0 fixed the Grade 10 book at 65 lessons
  on 2026-09-25**: splits P1a–e, promotions P2a–b and merges P3a–b. The optional merges P3c and P3d
  were not applied. The pipeline's coverage
  audit MUST report none missing, and every sub-topic the book teaches in a section MUST have at least
  one question (the coverage oracle).
- **FR-4302** *(changed rev. 2, decision 13; changed rev. 3, decision 19)*: Every book question the
  course serves MUST have a canonical, step-by-step solution **taken from the book**, stored before any
  student sees it:
  - a worked example keeps the book's printed solution;
  - an exercise takes the **worked solution the book's EPUB edition carries for it**. All 2,531
    Grade 10 exercise items have one.

  Each item MUST be solved **blind** by a different checker. It counts as verified only when the blind
  answer agrees with the book's printed answer **and** with the final answer of the EPUB solution.
  Any disagreement MUST hold the item for Samuel at the solutions gate, and a printed answer MUST never
  be corrected silently. An item the book prints no answer for is verified against the EPUB solution
  alone and listed at the solutions gate.

  *(Amended 2026-10-01, decision 58c, answer 37c — maths only, during the fan-out.)* An item with **no
  disagreement** — the blind answer, the printed answer and the EPUB solution's final answer all agree,
  or the book prints no answer and the EPUB solution alone verifies it — MUST reach students as part of
  the live maths bank without waiting at the solutions gate for Samuel; it is entered in the internal
  review backlog instead (FR-4501), so a human still reads it, just not before a student does. A
  **genuine disagreement** between the printed answer, the EPUB solution and the blind re-solve is
  unchanged: this is the "answers vs the book" automatic safety check decision 58c names, and it still
  holds the item — never corrected silently, and a printed answer is never silently overwritten.

  Siyavula's Teacher's Guide is used only where it adds something the book and its EPUB lack. Each
  solution MUST record its source: the book's worked example, **the EPUB worked solution (not printed
  in the PDF)**, or the Teacher's Guide. Nothing is solved from scratch and served.

  *(Amended 2026-09-27, decisions 43–45, Samuel's G2 answers 22–25.)* At the solutions gate Samuel
  may also:
  - **mark an item on its answer only** when the book prints no working for it (`choices.answer_only`).
    The tutor then confirms, gives the answer and points to the lesson's worked examples. It MUST NOT
    present a working of its own or a method the book does not give;
  - **correct a typo in the book's working, or append a line to it**, where the final answer is right
    but a step is wrong or missing (for example a substituted point that is not the stem's, or a
    conclusion that stops short of the key). Each such change MUST be recorded on the item's G2 fix,
    with who approved it and when. The rest of the book's working MUST stay as printed, and the
    change is never presented to a student as the book's own history.
- **FR-4303** *(changed rev. 2, decision 14; changed rev. 3, decision 20)*: A book exercise whose
  answer is a maths expression, several values, an interval or inequality, a coordinate pair, an exact
  surd or a recurring decimal MUST be a **typed question marked by FR-4320**. Multiple choice MUST be
  used **only where it is natural** — a verbal or choice answer such as "irrational" or "rhombus" —
  with the printed answer as the key and distractors that name misconceptions (FR-4307). An item with
  no markable answer, such as a proof, a sketch or a "show that", MUST stay in the course as a worked
  example the tutor can teach from, not as a graded question. Every item MUST be counted by what became
  of it, and none reshaped silently into a different question. *(Amended 2026-09-26, decision 36.)* An
  end-of-chapter item the human reviewer rules, by name and with a reason, to be outside what its
  chapter teaches is one such fate: it MUST be kept out of practice, MUST NOT be dropped silently, and
  MUST be listed in the pipeline's coverage audit with the reviewer's name.
  *(Amended 2026-09-27, consistency review A1 and A9, approved by Samuel.)* A typed question's shown
  answer MUST be its marker key rendered, never the printed answer's text layer (which reads a printed
  9/11 as "9 11"); and a stem that asks for a form the book's rules name — "in the form $y = mx + c$" —
  MUST carry that form on its marker, so an equivalent answer in another form is returned for re-entry.
- **FR-4304** *(changed rev. 2, decision 16)*: The course's generated questions MUST follow the decided
  pattern (ADR-0008, FR-1101…FR-1107): families whose answer key is computed together with the stem;
  each item naming the book question it derives from; each multiple-choice distractor naming a
  misconception of the same objective; structural validation before load; loading and making live as
  two separate acts (FR-1104); and a reproducible sample of at least 10% of each bundle written to the
  review queue with its seed (FR-1105). Each family MUST be written as a **declarative spec that can be
  regenerated** from the repository, and no model-written code MAY be executed to produce it.
- **FR-4305**: The course MUST reach the **tier floor**: every objective carries at least one question
  at each of the three difficulty tiers, book and generated questions together. Any objective below
  the floor at load MUST be listed by name in the console and in the load report. *(This makes
  FR-1109's SHOULD a MUST for this course. ADR-0008 measured what happens without it: a student
  reaches the advanced tier within days and meets the same question again.)*
- **FR-4306** *(changed rev. 2, decision 11; changed rev. 4, decision 27)*: **Every chapter MUST have
  widget questions** (FR-1201's per-module rule). Widget questions MUST be questions (ADR-0009):
  attached to their place in the course, graded on the server by the property asked for (FR-1205), with
  each diagnostic mapped to a misconception, and meeting FR-1202…FR-1210. Where no existing widget kind
  fits a chapter's mathematics, the chapter MUST go on a widget-gap list, and **any new widget kind MUST
  be listed for Samuel's approval before it is built**. **Six new kinds are approved in principle**
  (decision 27): shape builder, extended curve sketcher, Venn diagram, box-plot builder, algebra tiles,
  3-D solid scaler. Each is still built only for the chapters the widget-gap list actually names it
  for, not built speculatively ahead of a named gap. An approved new kind is built under the published
  design system (Principle XII). *(amended 2026-09-26, decision 47)* Before it ships, every widget
  question MUST pass a **blind verifier** that sees only what the student sees: its target MUST be
  reachable on the instrument and its stem MUST read as its stored spec, or its template is refused. Each
  predicate → misconception mapping the verifier does **not** confirm MUST be **held for human review**:
  stored, but inactive — never shown to a student, never used as a diagnosis, and never given to the
  misconception stage as evidence — until a human keeps it (it becomes active) or drops it (it is
  deleted). A widget whose every mapping is held ships as a plain right/wrong widget. *(001's FR-1213 and
  FR-1218 are unchanged: a held mapping is not a diagnosis, so no refutation is owed for it; SC-204 counts
  active diagnostics.)* *(Noted 2026-10-01, decision 58c, answer 37c — not changed by it.)* This
  requirement already has the shape the internal review backlog (FR-4501) gives everything else: a
  widget ships live on the verifier's own checks, with any unconfirmed mapping held inactive until a
  human confirms it — now through that backlog rather than a page of its own.
- **FR-4307**: The course MUST carry a misconception catalogue written against this book's own
  objectives (FR-1111). It MUST cover the book's own distractors, the generated ones and the widget
  diagnostics, and include conceptual entries for confusions no distractor encodes (FR-1114). Every
  misconception a distractor or diagnostic points at MUST exist and MUST have a refutation that can be
  served (FR-1112, FR-3214). One error MUST have one entry within the course (FR-1115). *(Amended
  2026-10-01, decision 58c, answer 37c.)* During the fan-out, a misconception and its refutation reach
  students on the AI checks' own recommendation; each is a backlog item (FR-4501), not a human stamp,
  until Samuel, Tamer or Kamil confirms it.
- **FR-4308** *(changed rev. 2, decision 15)*: This course's content MUST be shown in the app's
  notation: a decimal comma becomes a decimal point, and a coordinate pair written `(x; y)` becomes
  `(x, y)`, everywhere a student sees the book's mathematics. The book's vocabulary and its
  word-problem contexts, the Rand included, MUST stay as printed. Misconceptions and refutations MUST
  answer within this book, and no refutation in this course may cite the other maths course's book.
  *(Amended 2026-09-27, consistency review A2 and A4, approved by Samuel.)* Every maths segment a student
  can be shown MUST parse in the app's own KaTeX: the assembly re-spaces the transcriptions' stripped
  whitespace (a command glued to letters, a control space, chained assignments) without touching their
  hash proofs, and both the load and the coverage audit refuse any segment that does not parse. In this
  book `(7,5)` is a bracketed decimal, so a comma group becomes a pair only where it is provably one (a
  side of an equation whose other side is a pair); any other whole-side `(a,b)` is read as the book's
  decimal and listed for G2.
- **FR-4309**: The console MUST show the course's completeness beside its availability switch:
  chapters and sections; objectives; book questions, live and held, with each kind of solution counted
  apart; generated questions; widget questions; misconceptions with and without an explanation; and
  every objective under the tier floor and every chapter without a widget. Every count MUST be
  computed from the rows shown (FR-3212), so a stocked course cannot be mistaken for a thin one
  (FR-2701).
- **FR-4310**: Every item's provenance MUST come from the one place provenance is derived (FR-1110):
  book question (with its solution's source), generated, or widget. It MUST be shown to operators
  only and never to a student (FR-3211).

### Book sections and their parts (FR-4311…FR-4319) **[ADDED rev. 3, decision 18]**

> Samuel, 2026-09-25: *"need good taging and understanding that it is like that, so when we recommend
> or suggest scoring etc... we consider them very related"*. These requirements hold for **every
> course in every curriculum**. A course whose lessons are each exactly one book section — every
> National course today — has no parts and no merges, so nothing it shows or tells the tutor changes
> (FR-4206).

- **FR-4311**: Every lesson of every course MUST carry, as data, where it comes from in its book:
  - the printed section number and title it covers;
  - for one part of a split section, that section and "part *n* of *m*";
  - for a lesson that merges sections, every section it covers;
  - for a promoted introduction, that it is the chapter's introduction.
- **FR-4312**: The parts of one section MUST be consecutive in the course's catalogue order, in part
  order, and every reader of curriculum order (FR-3217, FR-4203) MUST keep them so.
- **FR-4313**: Recommendations and the next-lesson logic MUST treat a section's parts as one unit.
  - A recommendation into a section a student has started names the section ("Continue
    Factorisation").
  - A student's place (FR-3202) MUST NOT move past the section until every part has passed the mastery
    gate. Inside the section, it moves to the first part not yet passed.

  An explicit link to a part still wins (FR-3206). *(Extends FR-3202; recorded in the ADR-0020 note of
  2026-09-25.)*
- **FR-4314**: Each part MUST be scored on its own objectives, as any lesson is. The section MUST also
  have a roll-up, "*k* of *m* parts mastered", and MUST read as mastered only when every part is.
- **FR-4315**: The skill map MUST show the parts of one section as one visible group, labelled by the
  section.
- **FR-4316**: The tutor's Ask context MUST treat sibling parts as closely related. While a student
  works in one part, the other parts of the same section are the nearest related material, ahead of
  other lessons.
- **FR-4317**: Part *n*−1 of a section MUST be a prerequisite of part *n*. The product adds this
  automatically, alongside the book's own prerequisites, and records it as added by the product rather
  than stated by the book.
- **FR-4318**: A student MUST always see a lesson's printed section number beside its title, with
  "part *n* of *m*" for a part. Where a course already shows its printed lesson number, as the National
  courses do, that display is unchanged.
- **FR-4319**: The console MUST report per lesson and per section: completeness (FR-4309), mastery and
  activity can each be read either way. A section's figures MUST be computed from its parts' rows.

### Marking typed maths answers (FR-4320) **[ADDED rev. 3, decision 20]**

- **FR-4320** *(confirmed rev. 4, decision 24, "as recommended")*: A typed answer MUST be marked by
  **mathematical equivalence**, on the server and deterministically, for:
  - algebraic expressions, including factorised and expanded forms;
  - equations;
  - several values, in any order;
  - intervals, inequalities and sets;
  - coordinate pairs;
  - exact surds and π;
  - recurring decimals.

  The marker MUST apply decision 15's normalisation to the student's answer and to the key alike: a
  decimal comma reads as a point, and `(x; y)` as `(x, y)`.

  Where a question asks for a particular form — factorised, simplest form, a named variable as the
  subject — the marker MUST also check the form, and an equivalent answer in another form MUST NOT be
  marked correct. This is the property asked for, as FR-1205 requires of widgets. The student is told
  which form is asked.

  An answer the marker cannot read MUST be returned for re-entry, never marked wrong. No language
  model is ever asked to mark. A question whose key is a number or a choice MUST be marked exactly as
  today, so every existing course's marking is unchanged (FR-C03) — with the one addition below for a
  choice question that lists less specific true options.

  Decision 24's detail (confirmed "as recommended", `marker-evaluation.md` §6):
  - `1/2x` is ambiguous and MUST always be returned as unreadable, never guessed;
  - a decimal answer to a question whose key is an exact value (a surd, π) is the wrong form
    (`wrong_form: exact`), not incorrect;
  - a fraction answered for a recurring-decimal key is accepted as equal, **except** where the question
    asks for a decimal ("write as a decimal"): there the fraction is the wrong form;
  - an answer of the wrong shape — a number for an interval question, an expression where an equation
    of a line is asked for — MUST be returned for re-entry, never marked wrong.

  *(Amended 2026-09-27, decision 41, Samuel's G2 answer 20.)* A choice question whose key is the most
  specific true answer MAY list the other options that are also true but less precise
  (`choices.less_specific`; for example "rhombus" where the key is "square"). Choosing one of those
  MUST be returned for re-entry with "true, but be more precise", never marked wrong. Every other
  choice is marked exactly as today.

### The extraction pipeline (FR-4401…)

- **FR-4401**: The ingest line (ADR-0005) MUST produce every content kind FR-4301…FR-4308 requires as
  stages of the same repeatable run: book questions with canonical solutions, generated question
  families, widget questions, and the misconception catalogue with refutations. Each stage MUST have
  its own validation gate. A course MUST arrive complete by running the line, not by hand-running
  separate steps afterwards.
- **FR-4402**: The line MUST ingest a book whose structure differs from the ministry books' —
  chapters and sections rather than units, lessons and terms, in English throughout — without a
  hand-authored skeleton. The book's structure MUST be fixed up front by the manifest stage and
  approved by a human before the rest of the run.
- **FR-4403**: Every stage MUST report what it produced, what it rejected and why, and what it cost.
  A rejected item MUST NOT be loaded. (Principle VI's instrumentation, applied to one-time
  generation spend.)
- **FR-4404**: Running the line again on the same book MUST NOT duplicate any question, family,
  widget or misconception. Loading one course MUST leave every other course untouched.
- **FR-4405**: Changing the pipeline for this feature MUST keep its existing guarantees: the Arabic
  self-check at 100%, the deterministic Arabic audit green (constitution quality gates), and the
  sacred-content gate unchanged (Principle IV). Existing bundles MUST still load unchanged.
- **FR-4406** *(changed rev. 2)*: The line MUST be documented so that the next book can be ingested
  from the document alone. `docs/specs/extraction-pipeline.md` MUST describe every stage, the new ones
  included — its gate, its model, its output — and the "Load a course" action (FR-4208). It MUST state
  its own authority level. Each stage's prompts MUST be saved in the pipeline's runbook.
- **FR-4407** *(changed rev. 4, decision 32)* **[ADDED rev. 3, decision 21]**: Where a source's
  mathematics exists only as images, the line MUST turn every unique image into text it can check
  before any later stage reads it.
  - There MUST be two independent transcriptions.
  - A transcription is accepted when it reproduces the image's own fingerprint, or when both passes
    agree.
  - **When the two independent readings disagree, a third independent reading MUST decide** the
    transcription, rather than holding the image; the third reading is itself cross-checked against
    the printed page's text before it is accepted.
  - Every accepted transcription MUST be cross-checked against the printed page's text.
  - **An image with no printed-page counterpart at all** — found only inside an EPUB worked solution —
    MUST be accepted on a hash match, on two agreeing readings, or on a third reading breaking a tie
    between the first two, by the same rule as any other image.
  - An image that meets none of these conditions MUST go to a human, and MUST never be guessed.

  The line MUST report how many images were accepted each way, including by a third reading.
- **FR-4408** **[ADDED rev. 3, decision 21]**: Material a source addresses to teachers, such as the
  EPUB's teacher's-guide notes, MUST be dropped before claims are extracted. It MUST never become a
  student-facing claim, question, solution step or refutation.
- **FR-4409** **[ADDED rev. 3, decision 22]**: The maths misconception catalogue MUST have one source of
  truth, the catalogue file the product loads (`seed/generated/misconceptions.json`).
  - The retired generator MUST NOT remain a second source.
  - The six Prep-3 entries only the generator held MUST reach the loaded catalogue, each with its
    refutation.
  - A live misconception id MUST never be renamed. A change of wording keeps its id, and a duplicate
    becomes an alias (FR-1115).
  - The catalogue's export MUST keep each entry's kind and aliases.

  Because this is live Prep-3 content, a catalogue change MUST pass its tests and the CI proof before
  it reaches students (FR-3214).

- **FR-4410** **[ADDED rev. 4, decision 25]**: For a book with no printed prerequisite map, the line
  MUST find each lesson's prerequisite links **in the book itself**. Every candidate link MUST cite the
  book evidence it rests on — a cross-reference, a "recall" note, a worked example that reuses an
  earlier method — and MUST NOT be inferred from outside curriculum knowledge. Each candidate link MUST
  be checked by a second, independent AI before it reaches a human. Samuel, or whoever owns the teaching
  methodology, approves each chapter's prerequisite links together with that chapter's objectives, at
  gate **G1**. This governs how a link is found and verified for a book like this one; it is written as
  a requirement, unlike the objectives-finding methodology (decision 12), because it is about
  prerequisite *links* between objectives already found, not about how an objective itself is defined.

  *(Amended 2026-10-01, decision 58c, answer 37c.)* During the fan-out, a chapter's links MUST move
  forward on the second AI's agreement alone — the chapter MUST NOT be held waiting for Samuel, Tamer or
  Kamil to clear it first; each kept link is a backlog item (FR-4501), confirmed afterwards. A link
  whose evidence is not at its cited anchor, that the second AI does not confirm, or that would close a
  cycle, is still refused automatically before it ever reaches a human — unchanged.

### Native figure types (FR-4321) **[ADDED rev. 4, decision 26]**

- **FR-4321**: Where the pipeline's visual stage finds a figure that no existing figure kind can draw
  (geometry diagrams, trigonometry graphs and 3-D solids are the kinds this book is expected to need),
  the course MUST NOT ship a static book image in its place. The figure's needed kind MUST be listed,
  with a count of how many figures of that kind occur and their sizes, on a **figure-gap inventory** for
  Samuel — the same gate decision 11 already sets for widget *questions* (FR-4306). Only a kind Samuel
  approves is built, as a native, parametric renderer under the published design system (Principle XII),
  the same discipline the existing VIZ kinds follow. Until a kind is approved, the figure stays on the
  gap list and the lesson it belongs to ships without it, exactly as a chapter without an approved
  widget kind ships without one. *(This supersedes the earlier assumption that an unmatched figure is
  "reported, not approximated" — see Assumptions, below.)* *(Amended 2026-09-27, consistency review A3
  and A8, approved by Samuel.)* A question whose stem shows a figure it does not have MUST be held at
  review, never live, until its figure exists; a figure MUST NOT draw the question's unknown — a point the
  question writes with a letter for a coordinate — anywhere, and one that does is withheld; its caption
  MUST NOT change the question, and MUST describe only what is drawn — a withheld point is never described
  as marked, shown or drawn *(amended 2026-09-27, Chapter 8 pilot)*. A figure the visual stage failed to produce (an agent error, not a kind
  no renderer can draw) is a coverage failure, re-run for that figure alone.

  *(TEMPORARILY reversed for students, 2026-10-01, decision 58d, answer 37d — see FR-4508.)* While a
  needed kind is on the gap list and not yet built, a **maths** course MAY show the book's own image in
  the figure's place instead of shipping the lesson without it, so the whole extraction can appear to
  Samuel now. This reverses only the first sentence above, and only for students of a maths course: the
  figure-gap inventory, the kind-by-kind approval gate, and the "never draws or reveals the unknown"
  rule two sentences above are all unchanged and still bind the stand-in image exactly as they bind a
  native one.

### The internal review backlog (FR-4501…FR-4509) **[ADDED 2026-10-01, decision 58, answer 37]**

> Samuel, on filling the Grade 10 course: *"keep the student always full as if everything has been
> reviewed… and in the background create agents with the review process so we can review from the
> console page."* This block is for maths courses only — Prep-3 Mathematics and the Grade 10 American
> course — and does not touch Social Studies' or Arabic's existing review queue, or the sacred-content
> gate (Principle IV). None of it has file:line evidence yet; see [tasks.md](./tasks.md) T436…T443.

- **FR-4501**: For every maths course, the console MUST hold a **backlog**: one row per content item
  that carries no human stamp (FR-4506 defines the stamp). The backlog MUST list, at minimum: a book
  question's canonical solution, or a correction to one (FR-4302); an orchestrator-applied stem fix
  (FR-4302); a generated question (FR-4304); a widget question and its predicate → misconception
  mapping, including one the blind verifier refused (FR-4306); a misconception entry (FR-4307); an
  objective or a prerequisite link (FR-4410); a figure shown as the book's own image because its native
  type does not exist yet (FR-4508); and a decision a gate reached on the AI checks' recommendation
  rather than a human's during the fan-out (FR-4509).
- **FR-4502**: An operator holding `content-review` MUST be able to review one backlog item at a time
  and record exactly one of three verdicts: **approve** (the human stamp FR-4506 requires; the item now
  reads reviewed), **fix requested** (a student sees the item completely unchanged; the flag travels
  with the item's export, FR-4208), or **reject** (the item stops being served to students — a live
  question reverts to held, a misconception or a figure stand-in stops being used — and stays in the
  data, attributed, never deleted). Only operators Samuel names for this role — Samuel, Tamer and Kamil,
  at launch — MAY record a verdict.
- **FR-4503**: The backlog MUST hold a **claim lock**: once an operator opens an item to review it, no
  second operator MAY be given that same item until the first releases it or records a verdict. A claim
  left open (the operator navigates away without deciding) MUST eventually release on its own, so an
  item can never stay claimed forever.
- **FR-4504**: Every verdict MUST be recorded as an **append-only audit** entry: which item, which
  operator, when, which verdict, and any note. No entry is ever overwritten; a changed mind is a new
  entry, not an edit to an old one.
- **FR-4505**: The console MUST show the backlog's size **by kind, by course, by chapter and by
  reviewer**, so the stated goal — an empty backlog — is a number operators watch fall, not an
  impression.
- **FR-4506** *(decision 54, answer 33)*: **"Reviewed" MUST mean only that a human stamp exists** —
  FR-4502's approve verdict, and nothing else. An item an AI check alone has passed, however many
  independent passes it had, MUST be shown in the console as **"AI-checked, awaiting human"**, never as
  "reviewed." No student surface MUST say "reviewed" or "unreviewed" about any item (unchanged from
  ADR-0019).
- **FR-4507**: This backlog covers **maths courses only**. Social Studies and Arabic MUST keep their
  existing review queue (the gate ADR-0019 did not touch), unaffected by this feature. Quran and hadith
  passages held by the sacred-content gate (Principle IV) MUST NOT appear in this backlog and MUST NOT
  be served regardless of any verdict recorded here.
- **FR-4508** *(decision 58d, answer 37d; TEMPORARILY reverses decision 50/answer 29 for students only;
  see FR-4321)*: While a figure's needed native type has not been approved and built, a maths course MAY
  show the book's own image in its place (`visuals.kind: "book_image"`, `stand_in: true`) rather than
  shipping the lesson without the figure. Every such stand-in MUST be a backlog item named "needs native
  figure" (FR-4501), so it is never forgotten once the native type is built and the image is replaced.
  FR-4321's own rule MUST still hold without exception: a stand-in image MUST NOT draw or reveal the
  question's own unknown or answer; one that does is withheld, and the lesson ships without it, exactly
  as FR-4321 already requires of a native figure.
- **FR-4509** *(decision 58c, answer 37c)*: During the fan-out to the rest of the book, the pipeline's
  gates **G1** (objectives and prerequisite links, FR-4410), **G2** (solution disputes, FR-4302), **G3**
  (the family and widget-mapping sample, FR-4306) and **G4** (misconceptions and refutations, FR-4307)
  MUST proceed on the AI checks' own recommendation rather than hold a chapter waiting for a human to
  clear it. Every decision reached this way MUST land in the backlog (FR-4501) as an auto-passed item,
  never counted as a human stamp. The pipeline's **automatic safety checks are unaffected**: broken
  maths, an answer that disagrees with the book (FR-4302), and the parity drift guard (FR-4207) still
  hold an item exactly as before this decision. *(This requirement names G1–G4 only, matching Samuel's
  answer 37c. Whether it also covers G5 — the dry-run delta, coverage, drift and cost go/no-go before
  production promotion, FR-4209 — is not decided; see Open questions for Samuel, below.)*

### Key Entities

Plain language; no field names. [data-model.md](./data-model.md) owns the mapping.

- **Curriculum** *(new)*: a named track of study a student follows — National, American — shown to
  students by that name. An extensible list; a new curriculum arrives with its first book.
- **Course** *(expanded)*: one subject for one grade in one curriculum, built from one source book.
  It now belongs to exactly one curriculum. Two courses may share a subject, as the two maths courses
  will.
- **Student** *(expanded)*: the curriculum they follow, alongside the grade they already carry. The
  curriculum field exists today (FR-302) and becomes load-bearing.
- **Curriculum change** *(new)*: one change of a student's curriculum — when, from, to, chosen or
  implied, and which operator, or "re-resolved by the product" for an implied curriculum on a grade
  change. It is history and is kept.
- **Course availability rule** and **Student course exception** *(unchanged in shape — ADR-0018)*:
  a rule's meaning narrows to students of that course's curriculum (FR-4101); an exception still wins
  in both directions (FR-4009).
- **Source book** *(existing)*: the document a course is built from, identified by its fingerprint and
  counts for the drift guard (FR-4207).
- **Book section** *(new, rev. 3)*: a numbered section of a source book, with its printed number and
  title. A lesson covers exactly one section, one part of one section, or several merged sections, or
  is a chapter introduction. The section groups its parts for recommendations, progression, scoring,
  the skill map and the console (FR-4311…FR-4319).
- **Answer type** *(expanded, rev. 3)*: how a question's answer is marked — a number, a choice, or a
  maths expression of a stated kind, with the form it must take where the question asks for one
  (FR-4320).
- **Book question, generated question, widget question, misconception and refutation**
  *(existing kinds)*: the content FR-4301…FR-4310 require for the new course, with a book question's
  solution now recording its source (FR-4302).

## Success Criteria *(mandatory)*

- **SC-201**: **100%** of the book's chapters and sections are present in the course, in the book's
  order, and the coverage audit reports **zero** sub-topics without a question.
- **SC-202**: **Zero** book questions reach a student without a canonical solution, and **zero** reach
  a student whose solution, printed answer and blind re-solve disagree.
- **SC-203**: **Every** objective in the course has at least one question at each of the three tiers
  when it is loaded, or is named on a list in the console. The target is an empty list.
- **SC-204**: **Every** chapter has at least one widget question, and **100%** of widget diagnostics
  and distractors point at a misconception that exists and has an explanation.
- **SC-205**: A new grade-10 American-curriculum student reaches their first streamed tutor message in
  the new course in under **5 minutes** from arriving (SC-101), with at most **one** question added to
  sign-up.
- **SC-206**: In a pass through every student surface as a student of each curriculum, with the gate
  on **and** off, **zero** items from a course of the other curriculum appear, and **100%** of direct
  requests for one answer as not found.
- **SC-207**: For every existing National course, the tutor's instructions are **byte-identical**
  before and after this feature across the whole prompt capture set, and a pre-existing student sees
  **no** difference on any surface — except the three differences FR-4206 names as expected and
  deliberate: the Ask book-list line, the handoff line for a student who cannot see a subject
  (decision 38), and the National Arabic lessons' printed names (decision 34, *added 2026-09-27*).
- **SC-208**: The "Load a course" action, rehearsed on a copy of production, changes **zero** rows
  belonging to other courses or to any student; started a second time it changes **zero** rows; and
  its printed rollback returns the copy to its exact prior state.
- **SC-209**: An operator changing a student's curriculum and back restores **100%** of prior progress
  in every course touched, checked across mastery, saved places and attempt history, and **both**
  changes appear in the student's history.
- **SC-210**: A second run of the pipeline on the same book adds **zero** items, and an engineer who
  has not run it before produces a loadable course from `docs/specs/extraction-pipeline.md` alone.
- **SC-211** **[ADDED rev. 3]**: For **every** split section, **zero** students are moved past it with a
  part not passed. The section's roll-up agrees with its parts' mastery in **100%** of sampled
  students.
- **SC-212** **[ADDED rev. 3]**: The marker marks correct **100%** of the Grade 10 printed answers typed
  as printed, and every equivalent form in the test set. It marks correct **zero** answers in a form
  the question does not accept. Every existing course's recorded attempts mark **identically** when
  replayed through it.
- **SC-213** **[ADDED rev. 3]**: **100%** of the book's unique maths images are accepted by fingerprint,
  by agreement or *(rev. 4, decision 32)* by a third reading that agrees with one of the first two, or
  are on a list for a human. **Zero** are guessed.
- **SC-214** **[ADDED 2026-10-01, decision 58b, answer 37b]**: The backlog's size is readable by kind,
  by course, by chapter and by reviewer at any time; **zero** items are ever claimed by two reviewers at
  once; **100%** of verdicts appear in the append-only audit with who and when. The design permits the
  stated goal — an empty backlog — to be reached; nothing in its own shape stops it.

## Constitution check

Against **v3.3.0**, as written at rev. 1–3. "Holds" means the feature complies as specified; anything else
is named. *(Note 2026-09-27: the amendment this check proposed was approved as decision 28 and applied —
the constitution is now **v3.4.0** — and T413 is decided (ADR-0025, built in-house). The rows are kept as
written; see the dated notes in rows IX and "Additional constraints".)*

| Principle | Result |
|---|---|
| **I — Architecture authority** | Holds. Samuel decided on 2026-09-25 ([decisions.md](./decisions.md)): the seventeen decisions, then *"ok for all"* (A–E confirmed, #18–#22 added). ADR-0024 records curriculum as a dimension, amending ADR-0018. The expression marker's library goes to Samuel before it is built (T413). |
| **II — Grounded teaching** | Holds: every served book question has a stored canonical solution taken from the book — its printed worked example or its EPUB worked solution — and blind re-solved against the printed answer and that solution (FR-4302); nothing is solved from scratch and served; teacher-only notes never become claims (FR-4408); citations resolve to this book (FR-4205); the tutor never grounds an answer in a course the student cannot see (FR-4006). |
| **III — Review gate** | Holds, **by decision 9**: ADR-0019's exception covers this course (ADR-0019 note, 2026-09-25). Switching the course on is the gate (FR-4202). Items are stored attributed and flagged; the 10% sample is drawn (FR-4304); review status is shown to operators only (FR-4310); the baseline exclusion stands. A PATCH clarification of III's wording is in the amendment proposal. **2026-10-01 (decision 58, answer 37a–c): already covers this pass's substance.** Principle III's text, amended 2026-09-25 (v3.4.0), already says "everything in the maths bank is live… Prep-3 Mathematics and the Grade 10 American Mathematics course alike… book questions still at `review`, pipeline-generated questions, widget questions and the misconception catalogue, whether a human has read them or not" and that "review status is an operator fact… a student surface shows neither 'reviewed' nor 'unreviewed'". That is answer 37a stated plainly, and this feature cites it rather than re-deciding it. What III's text does not yet name is this pass's **mechanism**: a per-item backlog an operator can reject from (pulling one item back, not the whole bank), and gates G1–G4 reaching their own decisions during extraction rather than waiting on a human. Neither contradicts III's text; a short PATCH would make both explicit rather than implicit. Proposed wording, **not decided**, is in *Open questions for Samuel*, below. |
| **IV — Sacred text** | Holds. Dormant for a mathematics course. The pipeline's sacred-content gate is unchanged (FR-4405). |
| **V — Bilingual by construction** | Holds. The course is English, LTR; the sign-up question, the Google step and the console copy are English. Direction stays switchable. Nothing Arabic-capable is removed. |
| **VI — Cost discipline** | Holds. Per-student spend instrumentation is untouched. The pipeline's one-time generation spend is reported per stage (FR-4403). |
| **VII — Minors' data** | Holds. Curriculum is a learning attribute already in the student model (FR-302), not a new personal datum. It is asked once, at sign-up or the Google step, with no student control at launch (FR-4005) *(changed 2026-10-01, answer 36: now always asked, naming every curriculum, rather than only when the grade offered a real choice)*, is labelled flatly and never leaves first-party data (FR-4016), and only an operator can change it, enforced by database privilege (FR-4017). The privacy review (F1, F5) names the residual risk: in Egypt, "American" is a weak proxy for fee-paying schooling. The amendment proposal adds a PATCH clarification that curriculum sits with grade and is never paired with a school name or address (F2). |
| **VIII — MVP non-goals** | Holds. An international curriculum is inside the PRD's stated curriculum dimension (delta-matrix §2). Nothing here touches a non-goal. Tamer owns the PRD and should be told that the dimension 001 held constant now varies. |
| **IX — Registry-driven subjects and prompt freeze** | Holds, **by decision 10**: National prompts are proven byte-identical (FR-4206); the G10 course's prompts are new captures, allowed by the ADR-0020 note of 2026-09-25. The subject registry keeps the teaching contract, and courses get their own registry (ADR-0024). Book-section grouping changes nothing for a course with no split or merged section (FR-4311…FR-4319), and the marker leaves numeric and choice marking unchanged (FR-4320). *(2026-09-27: FR-4206 now names three expected National differences — the Ask book-list line, the handoff line (decision 38) and the Arabic lessons' printed names (decision 34); and a choice question may list less specific true options for re-entry (FR-4320, decision 41), which no National question carries.)* |
| **X — Operational safety** | Holds, with a wording change proposed. Production gets the course only through the manual "Load a course" action — backed up, additive, re-runnable, never in a deploy (FR-4208) — and later changes go through `refresh-content`, now pointed at noor (FR-4210). X names `refresh-content` as the one content path, so the proposal adds the load action by name (PATCH). |
| **XI — Solution integrity** | Holds, with one change: the drift guard learns a second book (FR-4207). Curricula live inside one solution, so this is not cross-solution pooling. FR-4104 keeps courses apart anyway, because a figure mixing two maths courses means nothing. |
| **XII — Design system** | Holds. The sign-up question, the Google step, the console changes and any approved new widget kind are bound by the published Noor Play system. Grade 10 renders Play while ADR-0017's Master switch is off (decision 7, FR-4204). |
| **Additional constraints** | **Amendment proposed, not applied.** *"Curriculum truth is the Egyptian ministry book"* and the *"Comparison constant: Prep-3 Mathematics …"* line stop describing the product once a non-ministry book is served. [constitution-amendment-proposal.md](./constitution-amendment-proposal.md) proposes per-course curriculum truth and per-course drift constants (MINOR, v3.3.0 → v3.4.0). Samuel approves the wording and the bump. *(2026-09-25: approved, decision 28, and applied — constitution v3.4.0.)* |
| **Quality gates** | Holds: `tsc`, unit tests, production build, the prompt byte-identity capture (FR-4206), and the pipeline's Arabic self-check and audit (FR-4405). |

## Governance impact

**Written in this pass, for Samuel's read:**

1. **[ADR-0024](../../docs/decisions/0024-curriculum-as-a-visibility-dimension.md)** — curriculum as a
   visibility dimension, amending ADR-0018, with the production load path decided alongside it.
2. **ADR-0005 amendment** (2026-09-25) — derived objectives with at least two kinds of evidence, and
   the pipeline decisions 12–16.
3. **ADR-0019 note** (2026-09-25) — the G10 course is covered; switching it on is the gate. **A second
   note (2026-10-01, decision 58, answer 37)** extends it to the fan-out itself: gates G1–G4 proceed on
   the AI checks' own recommendation, and a new internal review backlog (FR-4501…FR-4509) replaces the
   pre-promotion human sign-off, maths only.
4. **ADR-0020 note** (2026-09-25) — an exception to the prompt hold for the G10 course's prompts only
   (numbered the **fifth** since 2026-09-27; the list is renumbered in one place in ADR-0020). Later
   exceptions from this feature: the **sixth**, National Arabic lessons' printed names (decision 34);
   the **seventh**, the G10 course's English-only setting (decision 30); the **eighth**, the handoff
   line and hidden bridge for a student who cannot see a subject (decision 38).
5. **[constitution-amendment-proposal.md](./constitution-amendment-proposal.md)** — approved as
   decision 28 and applied 2026-09-25 (v3.4.0).
6. **[ADR-0025](../../docs/decisions/0025-answer-marker-build-in-house.md)** — the expression marker is
   built in-house (decision 23, T413).

**Requirements elsewhere that this spec touches.** They are listed here and not edited. Each is
stamped in its own spec when this feature's rows move past OPEN, so the chain stays readable
([tasks.md](./tasks.md) T386).

| Requirement | What changes | By |
|---|---|---|
| 002 **FR-2002** — what sign-up captures | adds the curriculum question, always asked *(changed 2026-10-01, answer 36; was: only when there is a choice)* | FR-4005 |
| 002 **FR-2006** — Google sign-in ends in the same state | a first Google sign-in passes a grade-and-curriculum screen | FR-4014 |
| 002 **FR-2013** — changing grade later | grade set after sign-up sets curriculum in the same step; curriculum changes are operator-only at launch | FR-4008, FR-4010 |
| 002 **FR-2702, FR-2704…FR-2706** — the course gate | a rule applies only within the course's curriculum; the gate refuses other curricula where data is read, including four readers that are ungated today | FR-4006, FR-4101 |
| 002 **FR-2703** — per-student exception | unchanged, and stated to hold across curricula | FR-4009 |
| 002 **FR-2709** — the suspend switch | suspends rules but not curriculum scoping | FR-4015 |
| 002 **FR-3207** — maths in the school's order | reads "the book's order" for this course | FR-4203 |
| 002 **FR-3212** — Content page per subject | per course | FR-4104 |
| 002 **FR-3217** — one curriculum order, split by subject | also split by course where a list holds two courses of one subject | FR-4009, FR-4104 |
| 001 **FR-302** — student model holds curriculum system | becomes load-bearing | FR-4003, FR-4006 |
| 001 **FR-1109** — tier floor (SHOULD) | a MUST for this course | FR-4305 |
| 001 **FR-1201** — a widget per Prep-3 module | applied to this course per chapter | FR-4306 |
| 001 delta-matrix §2 — curriculum system *"held constant for this build"* | no longer held constant | this feature |
| [ADR-0018](../../docs/decisions/0018-course-availability.md) | amended by ADR-0024 | Governance item 1 |
| [ADR-0019](../../docs/decisions/0019-serve-the-whole-maths-bank.md) | extended to the G10 course | Governance item 3 |
| [ADR-0020](../../docs/decisions/0020-mastery-gated-lesson-progression.md) prompt hold | fifth exception, G10 prompts only; sixth, National Arabic lessons' printed names; seventh, G10 English-only; eighth, the handoff line for a student who cannot see a subject | Governance item 4 |
| 002 **FR-3202** — the place moves on when every objective passes | a section's parts are one unit: the place never moves past a section until every part passes | FR-4313; ADR-0020 note (rev. 3) |
| 001 **FR-C03** — deterministic server-side grading | typed maths answers marked by equivalence; numbers unchanged; choices unchanged except that a choice question listing less specific true options (`choices.less_specific`, decision 41) returns such a pick for re-entry — no existing question carries the flag, so every recorded attempt marks identically | FR-4320 |
| 001 **FR-C01** — grounded teaching, never solved from scratch | a question marked on its answer only (`choices.answer_only`, decision 43) reaches the tutor with an instruction to give the answer and point to the worked examples, never a working of its own; dated note on the FR-C01 row (2026-09-26), status unchanged | FR-4302 |
| 001 **FR-304** — explanation library, and its traceability row | the refutation workflow the row cites is retired; the library students get is the catalogue's refutations | FR-4409; row corrected 2026-09-25 |

## Assumptions

Working defaults the decisions left to the design. Each is reversible.

- **Existing students are National, and nothing is backfilled**: the stored value every student
  already has is the National id (FR-4003).
- **Grade is one school year across curricula; only its label differs** (FR-4013). Samuel's framing —
  sign up for grade 10, then choose a curriculum — puts grade first.
- **The curriculum list is maintained with the content**: a new curriculum arrives with its first
  book. Adding or renaming curricula from the console is not asked for and not specified.
- **"The pattern we decided" means ADR-0008's families with the three-tier floor, and ADR-0009's
  widgets as questions.** Decision 16 makes the family a declarative spec; nothing else changes.
- **The book's figures are extracted by the line's existing visual stage**, as for Prep-3. *(Superseded
  rev. 4, decision 26.)* A figure no existing figure kind can draw was assumed to be reported, not
  approximated; it is now a requirement — see **FR-4321** — that such a figure gets a native renderer
  once Samuel approves the kind, on a figure-gap inventory the same shape as the widget-gap list. Loading
  figures (FR-4208) and the drift guard counting them (FR-4207) are unchanged.

## Open questions for Samuel

**Open as of 2026-10-01** (none of these blocks the build; they are flagged so they are not lost):

1. **The "nothing to study here yet" note's wording** (FR-4005, answer 36): "Nothing to study here yet
   for {grade label}" is the orchestrator's default copy, on `CurriculumChoice.tsx`. Keep it, or word it
   differently — or decide a curriculum with nothing live for the grade should not carry a note at all?
2. **The `/pipeline` page's static explainer still has illustrative Arabic words**
   (`app/src/app/(console)/pipeline/page.console.tsx`, e.g. «أهداف الدرس», «بم تفسر») even when an
   operator is looking at the explainer with the American course selected — it is one fixed description
   of the pipeline concept, not scoped per course. Is this a gap against decision 56 ("no Arabic
   anywhere" for the American course), or is a console-only, operator-facing explainer page exempt
   because it describes the *pipeline*, not the *course*?
3. **The sacred-text containment guard's redaction message is hardcoded Arabic on every surface**
   (`app/src/app/api/ask/route.ts`, "النص الكريم لا يُكتب هنا…"), independent of a course's
   `arabicTouches` setting. In practice the guard never trips for the American course (it has no sealed
   scripture), so this is latent, not reachable — but it is not scoped by course either, unlike every
   other Arabic surface this feature touched. Worth a line scoping it, or leave as dead code for a
   course with no sacred content?
4. **A possible constitution PATCH, proposed wording only — not decided.** Principle III's text already
   says the whole maths bank is live regardless of review (see the Constitution check, row III, above).
   It does not yet name, in so many words, (a) that "reviewed" means only a human stamp, or (b) that an
   operator may pull back one item (reject) during the backlog review this feature adds, separately from
   revoking the whole course. A possible addition, after the 2026-09-23 extension's bullet list:
   > *"**Clarified 2026-10-01 (decision 58, answer 37a/b):** 'reviewed' means a human operator's own
   > stamp and nothing else — an automated check, however many independent passes it had, is never a
   > review. An operator MAY reject one item from this exception at any time, removing only that item
   > from what students are served, without reinstating the gate for anything else."*
   This is a proposal for Samuel's wording and approval, not an edit made to the constitution file.
5. **Does decision 58c's "gates G1–G4 auto-pass" also cover G5** (the dry-run delta, coverage, drift and
   cost ledger go/no-go before promoting a course to production, FR-4209, `tasks.md` T363)? Answer 37c
   names G1–G4 only; `tasks.md` T443 leaves G5 as a human gate until told otherwise, since it reads as a
   production-readiness check rather than a per-item content review — but that is this pass's inference,
   not something Samuel said directly.

**Every other question and confirmation raised in rev. 1 and rev. 2 is answered**
([decisions.md](./decisions.md)):
- Rev. 1: Q1 → FR-4004 (decision 1), Q2 → FR-4202 (decision 9), Q3 → FR-4205 (decision 10).
- Rev. 2, all answered on **2026-09-25** by *"ok for all"*:
  1. **Adopted items A–E: confirmed.** A (FR-4015) is confirmed: with the gate switched off,
     curriculum scoping stays on.
  2. **Privacy review F5: option (b) confirmed.** Anonymous analytics stay unconfigured until the cohort
     is larger. Configuring the measurement id would reopen the question.
  3. **The Ask book-list line: acknowledged.** For a National student who can see fewer than all
     loaded courses, the Ask context stops naming hidden books (FR-4206).

One choice is left to a later gate, not a question now: the expression marker's library or approach
is proposed to Samuel before it is built (tasks.md T413).
