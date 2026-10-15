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
   inside an example's frame, is its own record with `belongs_to` set to that example's id.
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

## Reviewing

**Stopgap.** The console is to become the one review tool, with labelling extraction as one of its
four tasks (`docs/design/review-console.md`); this local page is used until that exists.

Run the review tool from a terminal, then open http://127.0.0.1:3020:

    python3 services/extraction/groundtruth/review/server.py

It opens the ground truth here and the pipeline's own book records (`services/extraction/book-records/`,
listed as `[extraction]`; add other folders with `--records DIR`). The badge beside the file says which
one you are reviewing. It shows each record next to the book page it comes from; an extracted record
with no quote shows its `anchor` instead, and the **Has misprints** filter lists every record carrying
a misprint. Type your initials, then for each record:

- **Confirm** (`c`) when it matches the book.
- **Edit** (`e`) to correct any field, add or remove fields, or change the record's type, for example
  a rule that is really a learning objective. Changing to `learning_objective` moves the record to
  that section, renames its main text field and updates links to it. "Save and confirm" does both
  at once. Every edit is logged on the record.
- **Misprint** (`m`) when the book prints a mistake: pick the field, copy what is printed, write what
  is meant. The record's text is left as printed.
- **Flag** (`f`) when it needs someone else's decision.
- `j`/`k` move, `u` undoes the mark. Missing items are added from the "Whole file" card with an id
  that follows the scheme above; records that are not in the book are deleted from the edit form.

Every change is saved straight into the JSON file, so a review is committed like any other change.
The books are not in git: put the PDFs in `docs/Source/` (or start the tool with `--pdf-dir`).
macOS may block the tool from reading `~/Downloads`.

## Scoring (to build)

A script that compares an extracted book record with the reviewed one for the same lesson and
reports, per item type: found, missing, invented, wrong objective, and field differences (answers,
solution steps, notation, table cells). Where a reviewed record lists a misprint, either the printed
or the intended reading counts as found, and the report says which the extractor gave. It should run
in CI against reviewed files only.
