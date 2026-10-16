# Ground truth: what the book prints

Human-reviewed records of everything a textbook prints in a lesson, built **from the book only**, so
extraction can be scored against it: recall per item type (definitions, rules, worked examples, every
exercise part), precision (nothing invented), and the item → objective mapping.

**Book only.** Nothing goes in here that the book does not print: no worked-out answers to exercises
the book leaves unanswered, no likely wrong answers, misconceptions, prerequisites, everyday examples
or teaching moves. Those are generated or expert content for a separate **teaching layer** whose
records point at book-record ids, carry their own source (generated or teacher) and their own review,
and are never used to score extraction. This two-layer split is proposed, pending Samuel's decision:
see [DECISION-NOTE-two-layers.md](DECISION-NOTE-two-layers.md).

## One format for ground truth and ingestion: the book record

The files here use the **book record** format (`"schema": "book-record"`, `"schema_version": 2`,
[book-record.schema.json](book-record.schema.json)), proposed as the format ingestion should also
produce. A ground-truth file (`"role": "ground_truth"`) is a book record whose records a person has
confirmed; an extractor's output is the same format with `"role": "extraction"`. Scoring compares two
book records of the same lesson, record by record, with no translation.

| Key | What it holds |
|---|---|
| `role` | `ground_truth` or `extraction` |
| `source_document` | Book, edition, file path, sha256, `page_offset` (PDF page = printed page + offset), licence |
| `lesson` | `slug`, `syllabus_ref`, `title`, `module` (unit or chapter), `pages` (printed range) |
| `items[]` | Everything the book prints on those pages, one record per printed thing, in page order |
| `learning_objectives[]` | "Can do" objectives, in the book's order (`order_in_parent`), each citing the items that teach it in `evidence`. An objective has no page of its own: its pages are its evidence's pages |
| `provenance`, `review` | Who or what drafted the file; its review status (`draft`, `in_review`, `flagged`, `reviewed`) |
| `open_questions`, `history` | Questions about the book; a log of changes to the file |

### Items

```json
{
  "id": "u1-1:example-2",
  "type": "worked_example",
  "lo": "u1-1:objective-2",
  "source_page": 8,
  "quote": "If X = {a , b}, Y = { -1 , 0 , 3) then find",
  "stem": "Example 2: X = {a, b}, Y = {-1, 0, 3}; find X × Y and Y × X. What do you notice?",
  "solution": ["…", "Y × X = {(-1, a), (-1, b), (0, a), (0, b), (3, 0), (3, b)}", "…"],
  "solution_provenance": "book_worked",
  "misprints": [
    { "field": "solution[1]", "printed": "(3, 0)", "intended": "(3, a)",
      "notes": "The table beside it prints (3, a)." }
  ],
  "provenance": { "by": "Claude, from the page images, 2026-10-07" }
}
```

Rules:

1. **One record per printed thing.** A worked example is one item with its `solution` steps, not a
   question plus step claims. An exercise is one item with `parts[]`; a part is identified by the
   item id plus its `label`. How to split is under [Counting](#counting).
2. **`type`**, one of:

   | Group | Types | Main text field |
   |---|---|---|
   | Statements | `definition`, `rule`, `caution`, `convention`, `method` (only a printed method box) | `claim` |
   | Prompts | `exercise`, `activity`, `open_prompt` (a printed "Why?" or "Think" with no printed answer) | `text`, with `parts[]` |
   | Worked material | `worked_example` | `stem`, with `solution[]` and `answer` |
   | Pictures | `figure`, `table` | `caption`; a table also has `header` and `rows` |
   | Other content | `key_term`, `printed_objective` | `term`, `text` |
   | Structure | `heading` (a printed section heading), `linking_text` (prose leading between items), `prior_knowledge` | `text` |

   The groups are only for reading; each type is stored separately. A numbered procedure printed
   without a method box stays `linking_text` (or in the record it explains).
3. **Text is Markdown with maths as `$...$`**, in the book's printed form (Siyavula's decimal comma
   stays a comma). A printed formula goes in `formula`; where a printed form needs reading,
   `notation.printed` and `notation.normalised` hold both.
4. **Locating an item:** `quote` is a few exact printed words a person can find, misprints and
   spelling slips included; `anchor` is the extractor's block reference. **Ground-truth files need a
   `quote` on every item**; extraction output may give an `anchor` instead. The books' full text is
   not copied here.
5. **Answers only where the book prints them.** `solution_provenance` is `book_printed`,
   `book_worked` (a worked example's printed solution) or `book_online` (the publisher's answer
   behind a Siyavula practice code, which goes in `code`). A printed answer that is a drawing is a
   `figure` (or `table`) record, and the item or part points at it with `answer_figure`.
6. **Things printed inside other things.** A figure or table inside an example, or a labelled prompt
   inside an example's frame, is its own record with `belongs_to` set to that example's id. A
   prompt that needs a figure printed apart from it ("the previous graphical net", "which of the
   following arrow diagrams") points at it with `uses_figure`; a figure the student is asked to
   draw is not linked.
   **Where a figure is printed (PDF books only):** `region` holds its box on its page,
   `[left, top, right, bottom]` as fractions of the page, so it can be cropped (`crop_figures.py`;
   `checked` says whether the crop passed its check). An EPUB ships each figure as its own image
   file and needs none. Neither field is scored.
7. **Tables** have `header` (the printed column headings, corner cell first) and `rows` (each row
   left to right, row label first), cells exactly as printed. Printed row and column titles go in the
   `caption`.
8. **Misprints are recorded, not corrected.** The text keeps what is printed; `misprints[]` on the
   item or part says where (`field`, e.g. `solution[1]`, `quote`, `caption`), what is `printed` and
   what is `intended`. The scorer accepts either reading at that spot, and the teaching layer uses
   `intended`. A misprint is entered by the person who spots it, usually while drafting or reviewing,
   and confirmed in review like any other field. Spelling slips in prose that change no meaning
   ('cartesiem') are transcribed as printed and need no entry.
9. **Every record carries `provenance`** (the extractor and version, or the person who drafted it)
   and, once reviewed, **`review`**: `status` (`confirmed` or `flagged` with a `reason`), `by`, `at`,
   and an `edits` log.

Field names follow the extraction data wherever they mean the same thing (`source_page`, `lo`,
`claim`, `stem`, `answer`, `solution`, `solution_provenance`, `caption`, `label`, `description`,
`order_in_parent`, `slug`, `module`, `syllabus_ref`).

### Ids

An id is `<lesson slug>:<local id>`, lower case. The teaching layer and student data will point at
these ids, so they must mean the same thing in every file and must not change.

**The lesson slug is the extraction pipeline's**, from the book's manifest or book config
(`services/extraction/manifest/`, `services/extraction/books/`): `u1-1` for Prep-3 Lesson 1-1,
`g10m1s3-1` for Grade 10 sections 1.2–1.3. An extracted book record and its ground truth then share
the slug, so scoring compares them by id with no translation, and the lesson's pages match the
manifest's `printed_pages`.

1. **Printed label and number → use them**, in kebab case: Example 2 → `example-2`, Worked example 3
   → `worked-example-3`, question 4 of Exercise 1-1 → `exercise-1-1-q4`. Use the printed number only
   when it is unique in the lesson.
2. **Printed label without a unique number → the label and a count**, through the whole lesson in
   page order: the four Drills are `drill-1` … `drill-4`; three "Think" prompts are `think-1` …
   `think-3`, even though the book numbers each box from 1.
3. **No printed label → the type and a count**, through the whole lesson in page order, never
   restarting per page: `definition-3`, `rule-7`, `figure-2`, `table-1`, `heading-1`,
   `linking-text-2`, `key-term-5`, `printed-objective-1`.
4. **If an id from rule 3 would equal one from rule 1 or 2**, prefix it with `unlabelled-`: an inline
   example in a book that also prints "Worked example 1" is `unlabelled-worked-example-1`.
5. **Learning objectives** are `objective-1`, `objective-2`, … in teaching order.
6. **Parts** are `<item id>:<label>`; a nested printed label is joined with a space as printed
   (Example 3's "First", sub-question A → label `First A`).
7. **Frozen once reviewed.** After a record is confirmed its id never changes and is never reused. A
   record found to be wrong is deleted and its id retired. (The ids in these files were renamed to
   this scheme on 2026-10-15, before anything pointed at them.)

`validate.py` checks that ids are unique and that every link (`lo`, `belongs_to`, `answer_figure`,
`evidence`) resolves.

### Counting

What becomes a record, so two people (or a person and an extractor) count the same lesson the same
way:

1. **Page furniture is not recorded:** running headers and footers, page numbers, the ministry
   footer, and pictures that teach nothing. A picture is recorded when the text refers to it or it
   carries maths.
2. **Headings are recorded** as `heading`: section and sub-section headings printed in the lesson.
   Box labels that only name the next item ("Example 2", "Drill") are part of that item, not
   headings.
3. **Prompts inside a worked example:** a prompt with its own printed label or box ("Think",
   "Notice", "Why?") is its own `open_prompt` with `belongs_to` the example. An unlabelled question
   inside the stem ("What do you notice?") stays in the stem.
4. **Statements:** each printed bullet, numbered point, or separately printed claim is its own
   record (a "We notice" box with five points is five records). Notation given with a definition
   stays in that definition's `notation`, not a record of its own.
5. **Exercises and drills:** each printed question number is one item; its lettered sub-questions
   are `parts`. A drill with letters only is one item with parts. "Drill" and "Exercise" are both
   `type: exercise`; the printed word is kept in the id.

## Status

| File | Book | Scope | Status |
|---|---|---|---|
| `prep3-math-en/unit1/lesson-1-1.json` | Prep 3 Mathematics, Term 1 (Egyptian MOETE) | Lesson 1-1 Cartesian product, printed pp.7–12 | **In review**; records added on 2026-10-15 are unreviewed |
| `g10-math/ch01/section-1.2-1.3.json` | Everything Maths Grade 10 v1.1 (Siyavula) | 1.2 The real number system, 1.3 Rational and irrational numbers, printed pp.6–12 | **Draft**, not reviewed |

Start a new file from `TEMPLATE.json`; `EXAMPLE-prep3-lesson-1-1.json` shows one real record of each
item type, including a table, misprints, `belongs_to` and `answer_figure`.

Check every file (schema and the rules above) with:

    uv run --with jsonschema python services/extraction/groundtruth/validate.py

## Reviewing: the Noor review tool

One local tool for every review task, one task at a time
([docs/design/review-console.md](../../../docs/design/review-console.md); the admin console is left as it is).
Run it from a terminal, then open http://127.0.0.1:3020:

    python3 services/extraction/groundtruth/review/server.py

Type your initials at the top. The home page has five tasks; pick one and you see only its items.

| Task | Status | What you do | Where it is saved |
|---|---|---|---|
| **Label extraction** | built | Check each extracted record against the page: confirm, correct, flag, mark a misprint, or label it not in the book. Partial is fine. | Labelled records go into this folder's ground truth (`<book>/…`, created on the first label) |
| **Misprints** | built | Decide every mistake the book prints: misprint confirmed, a different correction, or not a misprint | `<book>/misprint-decisions.json`, append-only (a changed mind is a new entry) |
| **Generated answers** | built | Review every answer `answer_gen.py` wrote for a prompt the book leaves unanswered: approve, "re-solve is right", needs fix (with the right answer), or reject | `services/extraction/reviews/<book>/generated-answers.json`, append-only |
| **Generated content** | built | Review every generated question, widget question, widget mapping, misconception and S4 figure, each beside the book item it was made from: approve, needs fix (with a note and a correction), or reject | `services/extraction/reviews/<book>/generated-content.json`, append-only |
| **Question tiers** | built | Choose the tier (basic, standard, advanced) where the two readings of a book question's tier disagree | `services/extraction/reviews/<book>/question-tiers.json`, append-only |

**Label extraction.** A lesson's records come from the pipeline's book record
(`services/extraction/book-records/<book>/<slug>.json`) when there is one. What you label is written into
the ground truth, and unlabelled records stay out of it. A lesson with no extraction yet (both lessons
today) is labelled in its ground-truth file directly. The bar shows how much of the lesson is labelled.
- **Confirm** (`c`) when it matches the book. Ground truth needs a quote, so an extracted item with only
  an anchor opens the editor first.
- **Edit** (`e`) to correct any field, or change the record's type. "Save and confirm" does both. Every
  edit is logged on the record.
- **Misprint** (`m`) when the book prints a mistake: pick the field, copy what is printed, write what is
  meant. The text stays as printed; the misprint then waits in the Misprints task.
- **Flag** (`f`) when it needs someone else's decision.
- **Not in the book** (in the edit form) when the extractor invented the record: it is listed in the
  ground truth's `not_in_book`, never as an item.
- `j`/`k` move, `u` undoes the mark. A missing record is added from the "Whole file" card.

**Misprints.** The list joins the pipeline's candidates (`book-records/<book>/misprint-candidates.json`,
made by `export_misprint_candidates.py`) with every misprint on a book record. For each one the page
shows what the book prints beside what it should be, and how we know.
- **Misprint confirmed** (`c`): it is wrong as proposed.
- **Different correction** (`d`): it is wrong, but it means something else, which you type in.
- **Not a misprint** (`n`): the book is right.

On a ground-truth record, a different correction or "not a misprint" also changes the record. What a
confirmed misprint does to the question students see is waiting on Samuel.

**Generated content.** It reads the files each book config names under `generated` (`services/extraction/books/<book>.json`):
the generated and widget question banks and the misconception catalogue. Each widget's "this pattern means that
misconception" rules are reviewed one by one as **widget mappings**. Small tabs switch between the kinds, and each
shows how many are left. Above every item is what it was made from in the book: a question's parent book question,
a misconception's book questions and what students answered on them, and the objective it teaches. The printed
page is shown beside it.
- **Figures** are every figure S4 redrew for a PDF book (`book_record_figures.py` →
  `services/extraction/teaching/<book>/visuals/`), one per book-record figure. The book's own crop of the figure
  (`work/<book>/figures/`) sits beside S4's drawing: a preview drawn from the spec's data (arrow maps, coordinate
  plots and function graphs; other kinds show the spec only), the points or arrows it draws, its caption and what it
  withholds. The preview warns when the app would drop a pair or a label is not at its point. A **gap** shows why S4
  did not draw the figure, the kind it needs, and any drawing S4's own compare step rejected.
- **Approve** (`a`), **Needs fix** (`f`: say what, and optionally suggest the correction), **Reject** (`x`).
- Each decision records the item's fingerprint, so an item the pipeline changes after you decided comes back as
  "changed since it was decided" (a figure S4 redraws included; which S4 run made it is not part of it).
- Nothing changes for students until a pipeline step reads the decisions. `compile_book_records.py` reads the
  figure decisions: a drawing you reject, or send back for a fix, is not shown, and its questions get the book's
  picture instead. The admin console is not touched.

**Generated answers.** `services/extraction/answer_gen.py` answers every exercise, activity, open prompt or
worked-example part a lesson's book record leaves unanswered:
1. One model call writes the answer and steps, using only the lesson's own definitions, rules and worked
   examples.
2. A second call solves blind.
3. Checks with no model compare the two answers and evaluate every numeric step.

Parts that need the printed figure get the page image. The answers go into the teaching layer
(`services/extraction/teaching/<book>/answers/<slug>.json`), never into the book record. Run it from
`services/extraction/`:

    uv run --with pymupdf answer_gen.py plan groundtruth/prep3-math-en/unit1/lesson-1-1.json
    uv run --with pymupdf answer_gen.py run  groundtruth/prep3-math-en/unit1/lesson-1-1.json --cap 5

`--cap` stops the run before it spends more than that many dollars. Lesson 1-1's 29 parts cost $0.57 in all.

In the task, "Needs attention first" lists what the checks could not settle: readings that disagree, a numeric
step that fails, a part the model could not answer. Drawings and explanations have no machine check and are
marked `?`. An answer is taught only once approved, and only when a pipeline step loads it; none does yet,
pending Samuel's ruling on project rule 3.

**Question tiers.** A tier is not printed in the book; it decides which questions a student practises at which
mastery (below 0.4 basic, below 0.7 standard, then advanced). `services/extraction/tier_questions.py` tiers every
exercise, worked-example, activity and open-prompt part with Grade 10's S3 rule, word for word: basic = one method
step; standard = a multi-step application of one method; advanced = methods combined, a word problem, or an
end-of-chapter item. Every part is read twice (Grade 10 re-reads one in five): once with its answer and worked
solution (Haiku, as S3 Typing) and once blind (Sonnet, as S3 Tier check). The tiers go into the teaching layer
(`services/extraction/teaching/<book>/tiers/<slug>.json`). From `services/extraction/`:

    uv run tier_questions.py run prep3-math-en u1-1 u1-2 u1-3 u1-4

Unit 1's 90 parts cost $0.23: 60 agreed, 30 disagreed. The task lists the disagreements with both readings, the
rule and the page: press `1`, `2` or `3`. Until you decide, `compile_book_records.py` uses the blind reading's tier
(Grade 10's rule: the check wins); an agreed tier is used as it is, and can be overruled from "All". A decision is
kept with the question's fingerprint, so a question whose text changes comes back. A tier is a teaching judgement,
not a review of the question: it never stamps `reviewed_by`.

Refresh the Grade 10 candidates after a new G2 run (from `services/extraction/`):

    uv run python groundtruth/export_misprint_candidates.py g10-math

Everything is a file in the repository, so a review is committed like any other change. The books are
not in git: put the PDFs in `docs/Source/` (or start the tool with `--pdf-dir`). macOS may block the tool
from reading `~/Downloads`.

## Scoring

`score_book_record.py <extraction> <ground truth> [--json OUT]` compares an extracted book record with the ground truth
of the same lesson. It matches records by id, then by type, page and the closest quote. It reports per item type:
found, missing, invented, a different type, different parts, a different printed answer (ignoring spacing). It also
reports which of the ground truth's misprints the extraction proposed. Records confirmed by a person are reported
separately, since a draft ground truth is a weaker yardstick. Records listed in `not_in_book` count as invented.
The review tool uses the same matching to show a lesson with both an extraction and ground truth record by record,
once each: the ground truth's version and its frozen id win.
