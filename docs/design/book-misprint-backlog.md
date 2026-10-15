# Design: a "book misprint" kind in the console review backlog

**Status:** proposal (Tamer, 2026-10-15). Not built. It needs a requirement (a new FR beside
FR-4501…FR-4509 in `specs/003-curriculum-tracks/spec.md`, through the `requirement` skill) and
Samuel's answer to the questions at the end before any code is written.

## The problem

The pipeline finds mistakes the book itself prints, and today nobody can decide on them in one place.

- The Grade 10 G2 recommendation runs (`services/extraction/runs/g10-math/g2-chNN.recommended.json`)
  class each finding. **134 are about the book itself**: 120 `book error`, 11 `printed answer
  misaligned`, 3 `printed text damaged`. Each carries the AI's note and, for a wrong answer, a
  proposed correction (`if_corrected`, marked "NOT APPLIED").
- They reach people as a generated markdown file (`docs/WIP-g10-pilot/errata-g10.md`, "no person has
  read this yet"), not as something anyone can decide.
- The question is usually dropped from the bank (`verdict: exclude`, 105 of the 120 book errors).
  So a student never meets a perfectly good question whose only fault is a wrong printed key, and
  nobody records which mistakes are real.

Book record v2 already says what should happen instead: keep the text as printed, record a
`misprints` entry (`field`, `printed`, `intended`, `notes`) that a person confirms, let the scorer
accept either reading, and let the teaching layer use `intended`
(`services/extraction/groundtruth/README.md`, rule 8). The console needs a queue where that confirmation is made.

A worked example from the Grade 10 lesson that has ground truth: Exercise 1-1, question 7e
(`g10m1s3-1:Ex1-1:7e`, printed p.11) asks for the integers in a list. The book's answer is
`-3; 7; 11`; its own definition of the integers contains 0, so the answer should be `-3; 0; 7; 11`.
The pipeline excluded the question.

## What a book-misprint item is

**One backlog item per misprint finding** (one `printed` → `intended` pair on one record or part).
It is not a working-step flag. The step checker (`working_flag`) judges the book's *working*; this kind
judges anything the book prints that is wrong: an answer key, a stem, a figure label, a table cell.

| | |
|---|---|
| **kind** | `book_misprint`. Label "Book misprint". Scope line: *"Something the book prints that looks wrong: what it prints, what it must mean, and how we know. Students are never shown the misprint as correct."* |
| **ref** | The book-record id plus the field, `g10m1s3-1:exercise-1-1-q7:e#answer`. Until book records exist, the pipeline item id plus the field (`g10m1s3-1:Ex1-1:7e#answer`). |
| **fingerprint** | md5 of `field`, `printed`, `intended`, and the record's quote/anchor. Changing the proposed correction puts the item back in front of a reviewer (the same rule as `working_flag`). |
| **shown to the reviewer** | The record as the book prints it, with the printed page image (the console already shows book figures; the review tool shows the page). The misprinted field highlighted. **Printed** and **intended** side by side. The pipeline's evidence (`note`, `class`, confidence). Where the question stands now: excluded, held, or live. |
| **source** | **Now:** the G2 recommendation runs, class in {`book error`, `printed answer misaligned`, `printed text damaged`}, read from `runs/<book>/` the way `review-gate-files.ts` reads gate records and step-check flags. **Later:** the `misprints` entries in `services/extraction/book-records/<book>/*.json`, once the book-record writer exists (it folds those G2 findings into the book records, so there is one source). |
| **reason code** | `misprint_found`, "Book misprint, awaiting human" (with `ai_checked` as for every other AI finding). |

Not in this kind, because they are not the book's mistake: `stem damaged` and `typing error` (the
pipeline lost or mistyped something: an extraction fix, which already goes through G2's `fix`) and
`not grounded`, `marker cannot check`, `check too strict` (about our checks, not the book).

## The three decisions

The gate's stored vocabulary stays `approve` / `fix_requested` / `reject` (`review_decisions`); the
buttons say what they mean for this kind, as `working_flag`'s do (`decisionButton`, `decisionLabel`,
`decisionEffect` in `app/src/lib/review-gate.ts`).

| Stored | Button | Means | Effect |
|---|---|---|---|
| `approve` | **Misprint confirmed** | The book is wrong, and `intended` is right as proposed. | Recorded. The pipeline's next run writes the `misprints` entry into the book record as confirmed. What happens to the question is Q1 below. |
| `fix_requested` | **Misprint, different fix** | The book is wrong, but the proposed `intended` is not. The reviewer gives the correct `intended` (the gate's existing correction field, `MAX_CORRECTION`). | On the fix list the pipeline exports, as for any other kind. Comes back to the backlog when the pipeline has re-proposed. |
| `reject` | **Not a misprint** | The book is right. The pipeline misread it, or its own working was wrong. | Recorded. The finding is closed, and the question goes back through G2 as an ordinary item (its exclusion was based on a mistake). `canDecide` allows it; nothing is served, so nothing is retired. |

Who may decide: the operators holding `content-review` (Samuel, Tamer and Kamil), as for every kind
(FR-4502). Claim lock, append-only audit and counts by kind, course, chapter and reviewer are the
backlog's own and apply unchanged (FR-4503…FR-4505).

## What it takes to build

Modelled on how `working_flag` was added (migration 039, `lib/review-gate-working.ts`):

1. **Migration 04x** (number at build time): widen `review_decisions_item_kind_check` to admit
   `book_misprint`. Additive, idempotent, with a rollback. No new table: an item is derived on every read from
   its source file, and a decision is one more `review_decisions` row.
2. **`lib/review-gate-misprints.ts`** (pure): the shape it reads, grouping (one item per misprint),
   the fingerprint, and the item's text. Unit-tested on a copy of `g2-ch01.recommended.json`.
3. **`lib/review-gate-files.ts`**: read the source files for every maths book.
4. **`lib/review-gate.ts` / `review-gate-queries.ts`**: the kind, label, scope, buttons, effects and
   `canDecide` rules above; the item in the backlog query.
5. **The review page**: printed vs intended side by side, the misprinted field highlighted on the record.
6. **Pipeline import**: an export of `book_misprint` decisions (the existing fix-list export) and a step
   that writes confirmed misprints into the book records, and confirmed `intended` keys where Q1 allows.
7. Tests on all of it, and traceability rows for the new FR.

**Production.** Like gate records, the run files are not in the Docker image
(`review-gate-files.ts` header), so on the box the backlog would list no misprints. Either the image
carries `runs/<book>/g2-*.recommended.json` (later, `book-records/`), or the loader puts the findings
in the database. That choice comes with the build.

## Questions for Samuel

1. **What does "Misprint confirmed" do to the question?** Today a question with a wrong printed key
   is excluded. Options: (a) it stays excluded, and the confirmation only records the truth; (b) it
   comes back with the confirmed `intended` as its key, the book's printed key accepted too if a
   student copies it, and the tutor told the book has a misprint here; (c) as (b), but only after a
   second reviewer confirms. Recommended: **(b)**. It is how Chapter 8's errors were handled with
   your approval (decision 45), and it keeps good questions in the bank.
2. **May the tutor tell a student that the book has a misprint?** ("Your book prints −3; 7; 11 here;
   0 is an integer too, so it should be −3; 0; 7; 11.") Recommended: yes, for confirmed misprints only.
3. **Does this kind need a person before a student sees the corrected key, or after?** The backlog's
   rule (FR-4509) is that review comes after the content goes live. A corrected key changes what the
   book says. Recommended: **before**. A misprint item is the one kind where the correction waits for
   a human.
