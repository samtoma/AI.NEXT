# Ground truth: what the book prints

Human-reviewed records of everything a textbook prints in a lesson, built **from the book only**, so
extraction can be scored against it: recall per item type (definitions, rules, worked examples, every
exercise part), precision (nothing invented), and the item → objective mapping.

**Book only.** Nothing goes in here that the book does not print: no worked-out answers to exercises
the book leaves unanswered, no likely wrong answers, misconceptions, prerequisites, everyday examples
or teaching moves. Those are generated or expert content that needs its own review pipeline, and
they are never used to score extraction.

## One format for ground truth and ingestion: the book record

The files here use the **book record** format (`"schema": "book-record"`), proposed as the format
ingestion should also produce (pending Samuel's decision). A ground-truth file is a book record whose
records a person has confirmed; scoring compares two book records of the same lesson, record by
record, with no translation.

| Key | What it holds |
|---|---|
| `source_document` | Book, edition, file path, sha256, `page_offset` (PDF page = printed page + offset), licence |
| `lesson` | `slug`, `syllabus_ref`, `title`, `module` (unit or chapter), `pages` (printed range) |
| `items[]` | Everything the book prints on those pages, one record per printed thing |
| `learning_objectives[]` | "Can do" objectives, in the book's order (`order_in_parent`), each citing the items that teach it in `evidence` |
| `provenance`, `review` | Who or what drafted the file; its review status (`draft`, `in_review`, `flagged`, `reviewed`) |
| `open_questions`, `history` | Questions about the book; a log of changes to the file |

### Items

```json
{
  "id": "g9-1-1:notice-5",
  "type": "rule",
  "lo": "g9-1-1:obj-1",
  "source_page": 7,
  "quote": "If (a , b) = (x , y) then a = x , b = y",
  "claim": "Equal ordered pairs have equal first projections and equal second projections.",
  "formula": "$(a,b) = (x,y) \\Rightarrow a = x,\\ b = y$",
  "provenance": { "by": "Claude, from the page images, 2026-10-07" },
  "review": { "status": "confirmed", "by": "TD", "at": "2026-10-08" }
}
```

Rules:

1. **One record per printed thing.** A worked example is one item with its `solution` steps, not a
   question plus step claims. An exercise is one item with `parts[]`; a part is identified by the
   item id plus its `label`.
2. **Ids follow the book's numbering** where it prints one (`we-2`, `ex-1`, `drill-1`); unnumbered
   items are numbered in page order.
3. **`type`**, one of:

   | Group | Types | Main text field |
   |---|---|---|
   | Statements | `definition`, `rule`, `caution`, `convention`, `method` (only a printed method box) | `claim` |
   | Prompts | `exercise`, `activity`, `open_prompt` (a printed "Why?" or "Think" with no printed answer) | `text`, with `parts[]` |
   | Worked material | `worked_example` | `stem`, with `solution[]` and `answer` |
   | Other content | `figure`, `key_term`, `printed_objective` | `caption`, `term`, `text` |
   | Structure | `linking_text`, `prior_knowledge` | `text` |

   The groups are only for reading; each type is stored separately.
4. **Text is Markdown with maths as `$...$`**, in the book's printed form (Siyavula's decimal comma
   stays a comma). A printed formula goes in `formula`; where a printed form needs reading,
   `notation.printed` and `notation.normalised` hold both.
5. **Locating an item:** `quote` (a few exact words a person can find) and/or `anchor` (the
   extractor's block reference). At least one is required. The books' full text is not copied here.
6. **Answers only where the book prints them.** `solution_provenance` is `book_printed`,
   `book_worked` (a worked example's printed solution) or `book_online` (the publisher's answer
   behind a Siyavula practice code, which goes in `code`).
7. **Every record carries `provenance`** (the extractor and version, or the person who drafted it)
   and, once reviewed, **`review`**: `status` (`confirmed` or `flagged` with a `reason`), `by`, `at`,
   and an `edits` log.

Field names follow the extraction data wherever they mean the same thing (`source_page`, `lo`,
`claim`, `stem`, `answer`, `solution`, `solution_provenance`, `caption`, `label`, `description`,
`order_in_parent`, `slug`, `module`, `syllabus_ref`).

## Status

| File | Book | Scope | Status |
|---|---|---|---|
| `prep3-math-en/unit1/lesson-1-1.json` | Prep 3 Mathematics, Term 1 (Egyptian MOETE) | Lesson 1-1 Cartesian product, printed pp.7–12 | **In review** |
| `g10-math/ch01/section-1.2-1.3.json` | Everything Maths Grade 10 v1.1 (Siyavula) | 1.2 The real number system, 1.3 Rational and irrational numbers, printed pp.6–12 | **Draft**, not reviewed |

Start a new file from `TEMPLATE.json`; `EXAMPLE-prep3-lesson-1-1.json` shows one real record of each
item type.

## Reviewing

Run the review tool from a terminal, then open http://127.0.0.1:3020:

    python3 services/extraction/groundtruth/review/server.py

It shows each record next to the book page it comes from. Type your initials, then for each record:

- **Confirm** (`c`) when it matches the book.
- **Edit** (`e`) to correct any field, add or remove fields, or change the record's type, for example
  a rule that is really a learning objective. Changing to `learning_objective` moves the record to
  that section, renames its main text field and updates links to it. "Save and confirm" does both
  at once. Every edit is logged on the record.
- **Flag** (`f`) when it needs someone else's decision.
- `j`/`k` move, `u` undoes the mark. Missing items are added from the "Whole file" card; records
  that are not in the book are deleted from the edit form.

Every change is saved straight into the JSON file, so a review is committed like any other change.
The books are not in git: put the PDFs in `docs/Source/` (or start the tool with `--pdf-dir`).
macOS may block the tool from reading `~/Downloads`.

## Scoring (to build)

A script that compares an extracted book record with the reviewed one for the same lesson and
reports, per item type: found, missing, invented, wrong objective, and field differences (answers,
solution steps, notation). It should run in CI against reviewed files only.
