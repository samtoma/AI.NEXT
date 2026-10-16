# Design: one review tool, four tasks

**Status:** proposal (Tamer, 2026-10-15). **Update, same day:** Tamer chose a separate tool over the admin console, kept local for now, and left the console as it is. The four tasks below are being built into the local review tool (`services/extraction/groundtruth/review/`). All four tasks are built. Generated answers is fed by `services/extraction/answer_gen.py` (piloted on Prep-3 Lesson 1-1: 29 parts, $0.57). Read "the console" below as "the review tool"; where this document says what changes in the console, nothing changes there yet. It replaces the earlier `book-misprint-backlog.md`. **Update, 2026-10-16:** a fifth task, **Question tiers**, lists the book questions whose two tier readings disagree (`tier_questions.py`, Grade 10's S3 rule read twice) for a person to choose basic, standard or advanced; it sits with the generated tasks, since a tier is a teaching judgement.
It is console work, so it needs requirements (beside FR-4501…FR-4509 in
`specs/003-curriculum-tracks/spec.md`, through the `requirement` skill) and Samuel's answers to the
questions at the end before any code is written.

## The decision

**The console is the one review tool.** A reviewer labels what the pipeline extracted, reviews
misprints, reviews generated answers and reviews generated content in the same place, under the same
sign-in, roles, claim lock and audit trail. The work is organised as **four separate tasks**. A
reviewer picks one and sees only that task's items, its own count and its own buttons. Nothing is
mixed into one queue.

The local ground-truth review tool (`services/extraction/groundtruth/review/`) stays as a stopgap for
labelling until the console's Label task exists. Then it is retired.

## Two kinds of review

| | **Labelling** (extracted) | **Review** (generated) |
|---|---|---|
| What the reviewer does | Checks what the pipeline **read from the book** against the printed page | Decides on what the pipeline **wrote** |
| Coverage | Partial is fine: label what you get to | Everything, every item |
| What it produces | **Ground truth**: the labelled records, the yardstick extraction is scored against | A verdict on the item: whether students get it, and on what terms |
| Tasks | 1. Label extraction · 2. Misprints | 3. Generated answers · 4. Generated content |

Misprints are extracted (the book printed them), but unlike the rest of labelling they change what a
student is taught. So they are their own task, and every one is reviewed.

## The four tasks

### 1. Label extraction

- **Unit of work:** one lesson's extraction book record (`services/extraction/book-records/<book>/<slug>.json`,
  `role: extraction`), shown record by record beside the printed page, as the local tool does today.
- **Actions:** **confirm** (it matches the book), **correct** (edit the fields), **flag** (needs someone
  else's decision, with a reason), **add** a missing record, **mark not in the book**.
- **Coverage:** the task shows "18 of 42 labelled" per lesson and per book. Unlabelled records are
  simply not ground truth yet.
- **Covers everything extracted:** items, statements, figures, tables, headings, worked examples, book
  questions, objectives and their evidence, prerequisite links. The backlog kinds that are extraction
  today move here and leave the generation queue: `book_question`, `worked_example`, `objective`,
  `prerequisite_link`.
- **Result:** each label is an append-only row in the database, keyed by book-record id. An export
  command writes the labelled records into `services/extraction/groundtruth/<book>/<slug>.json`
  (`role: ground_truth`), committed to git like any other change. The scorer reads those files.

### 2. Misprints

- **Unit of work:** one misprint: a `printed` → `intended` pair on one record or part, the field
  highlighted on the page.
- **Sources:** the pipeline's findings about the book itself. These are the G2 recommendation runs'
  `book error`, `printed answer misaligned` and `printed text damaged` (134 in Grade 10), plus
  step-checker flags on the book's own working (today's `working_flag` kind moves here). Later, the
  `misprints` entries the book-record writer proposes, which fold all of these into one source.
- **Actions:** **misprint confirmed** · **misprint, different correction** (the reviewer gives the
  right `intended`) · **not a misprint** (the book is right).
- **Coverage:** every one.
- **Result:** a confirmed misprint is written into the ground-truth record's `misprints`, so the scorer
  accepts either reading and the teaching layer uses `intended`. What it does to the question a
  student sees is question 1 below.

Example: Grade 10, Exercise 1-1, question 7e (`g10m1s3-1`, printed p.11). The book's answer is
`-3; 7; 11`, but its own set of integers contains 0, so the intended answer is `-3; 0; 7; 11`.

### 3. Generated answers

- **Unit of work:** one answer and worked solution the pipeline wrote for a book exercise the book
  leaves unanswered (Prep-3: all of them). It is shown beside the book's question and the page.
- **Source:** the answer-generation step (to build: generate, check with an independent re-solve,
  store as `source: generated` in the teaching layer, pointing at the book-record id).
- **Actions:** approve · fix requested (with the correction) · reject.
- **Coverage:** every one. Project rule 3 (the tutor teaches from stored, human-reviewed solutions)
  is what makes this queue the gate. Question 3 below asks whether it reviews before or after students
  see them.

### 4. Generated content

- **Unit of work:** today's generation kinds, unchanged: `generated_question` (S6 families),
  `widget_question` and `mapping_claim` (S7), `misconception` (S5 and its refutation).
  `figure_stand_in` stays here too, since it waits on a native figure to be built.
- **Actions and coverage:** as today (FR-4502): approve / fix requested / reject, every item.
- Each generated item also shows the book-record id it was made from, once the teaching layer links them.

### Gate sign-offs (Samuel only)

`gate_decision`, the gates G1–G5 that were passed on the AI's recommendation, is not a reviewer's
task. It stays a separate list that only Samuel decides, outside the four tasks.

## How the console is organised

- **Review** in the console nav opens a landing page with four cards: Label extraction, Misprints,
  Generated answers, Generated content. Each card shows its open count, and Label extraction also
  shows coverage. Gate sign-offs appear only for Samuel.
- Each task is its own route (`/review/label`, `/review/misprints`, `/review/answers`,
  `/review/generated`), with its own filters (course, chapter, lesson), its own claim lock and its own
  "next item" flow. Leaving a task is the only way to see another task's items.
- Per-reviewer counts stay (FR-4505), broken down by task.

## What changes from today

| Today | Proposed |
|---|---|
| One backlog with every kind mixed, filtered by kind | Four tasks, each with only its own kinds |
| Book questions, worked examples, objectives and links are gated like generated content | They are **labelled** as extraction; labels become ground truth |
| Step-checker flags are their own kind in the mixed backlog | They are part of **Misprints** |
| Book misprints are a markdown list nobody can decide on (`errata-g10.md`), and the questions are dropped | Every misprint is reviewed in **Misprints** and recorded in ground truth |
| Ground truth is labelled in a local Python page, one person at a time | Labelled in the console, many reviewers, exported to git |
| No generated answers exist | **Generated answers** task, once the step exists |

## What it takes to build

1. **The book-record writer**, so extraction book records exist (pipeline, deterministic; see
   `services/extraction/book-records/README.md`).
2. **Book records reachable from the console.** Load them into the database (preferred, because
   production cannot read the repo's run files), or ship them in the image.
3. **Label storage and export:** an append-only labels table keyed by book-record id, plus the export to
   `groundtruth/` files.
4. **The four routes and the landing page**, reusing the backlog's claim lock, audit and counts; the kinds
   regrouped as above; a migration only where a new kind or table needs one.
5. **The answer-generation step** for task 3.
6. Requirements and traceability for all of it.

## Questions for Samuel

1. **Served book questions.** Under labelling, a book question gets no approve/reject gate. When a
   reviewer corrects or flags one that students are being served, what happens to it? Options: (a)
   nothing until the pipeline re-runs; (b) a flag holds it back from students until it is resolved.
   Recommended: **(b) for a flag**; a correction goes to the pipeline's fix list.
2. **What a confirmed misprint does to its question.** (a) It stays excluded; (b) it comes back with
   the intended key, the printed key also accepted, and the tutor aware of the misprint; (c) as (b),
   after a second reviewer. Recommended: **(b)**, as Chapter 8's errors were handled with his approval
   (decision 45).
3. **Generated answers: review before or after students see them?** FR-4509 puts review after
   content goes live. A generated answer is the tutor's only source for that exercise.
   Recommended: **before**.
4. **May the tutor tell a student the book has a misprint?** Recommended: yes, for confirmed ones only.
