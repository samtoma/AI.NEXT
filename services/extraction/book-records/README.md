# Book records from the extraction pipeline

What the pipeline read from each book, one file per lesson, in the book-record format
(`../groundtruth/book-record.schema.json`, `"role": "extraction"`):

    book-records/<book>/<lesson slug>.json        e.g. book-records/g10-math/g10m1s3-1.json

The lesson slug is the manifest's, so a file here and its ground truth in `../groundtruth/` share every
id and can be scored against each other record by record.

**Prep-3 maths is written by `../extract_book_record.py`** (the book has no EPUB and almost no text layer, so the
extraction line's own source adapter cannot read it). It reads each printed page as an image, one model call per
page, then assigns ids, links and page-break continuations itself, draws the objectives in one more call per
lesson, and validates the result. The lessons and their printed pages are in `<book>/lessons.json`; Unit 1 is
mapped and extracted (`u1-1` … `u1-4`, printed pp.7–23, ≈ $0.25 per lesson). From `services/extraction/`:

    uv run --with pymupdf --with jsonschema extract_book_record.py run prep3-math-en u1-2 --cap 3
    uv run --with pymupdf --with jsonschema extract_book_record.py run prep3-math-en --all --cap 10

A lesson already extracted is skipped unless `--force`. Each run is logged in `<book>/extraction-runs.jsonl`.
Score a lesson against its ground truth with `../groundtruth/score_book_record.py <extraction> <ground truth>`;
Lesson 1-1 (ext-v3): 98% of the ground truth's records found, 100% of the confirmed ones, 3 of its 4 misprints.

**From book records to the tutor:** `../compile_book_records.py` compiles lessons into the bundles the app
already loads (`compiled/<book>/`). For a compiled lesson only the new content is used: the book record's
objectives (`u1-1:objective-3` becomes `lo:u1-1-3`) and the book's own exercises and worked examples, with answers
printed or generated (approved, or agreed by both readings). Today's questions, figures, generated questions,
widgets, misconceptions and links for that lesson are left out; every other lesson is unchanged. Marking uses
what the app has: numbers by its number check, values, points and sets by its marker, names and yes/no by its
plain check. What could not become a question is listed in `compiled/<book>/compile-report.json`. How Noor teaches
does not change; the book's statements are not used yet.

The compile step also does what the old assembly did on the way to the tutor, and refuses to write a bundle that
fails:
- **notation**, by the book's printed notation (`printed_notation.decimal` in the book config, default "point"):
  list commas spaced, `(x; y)` → `(x, y)`, the Arabic separators read as commas, aligned maths made inline;
- **KaTeX**: everything a student or the tutor reads, rendered with the app's own KaTeX. A question that fails is
  held; an objective that fails stops the compile;
- **guards**: every bundle validated against the app's bundle model, unknown fields or values refused, and no
  misprint's printed text allowed into a question it was corrected for;
- **identity**: lessons no existing bundle holds (a new curriculum) get their own program, course and module nodes.
  The report warns when the course is not in the app's course registry or a lesson has no title.

After loading, check that the app can teach every compiled lesson (from `app/`):

    DATABASE_URL=postgres://ainext_app:ainext_app@127.0.0.1:5432/<database> \
      node --import ./scripts/ts-resolver.mjs scripts/lesson-smoke.mts ../services/extraction/compiled/<book>/compile-report.json

A trial database with Unit 1 compiled:

    uv run compile_book_records.py prep3-math-en u1-1 u1-2 u1-3 u1-4
    # then load compiled/prep3-math-en/unit1.json with the book's other bundles, and the compiled generated
    # files, into a separate database; run Noor with the `bookrecord-trial` launch entry (port 3013)

A book that has an EPUB and a text layer (Grade 10) is meant to get its book records from the extraction line
instead: a deterministic writer after S1–S3 that turns `blocks.jsonl`, the claims, the book questions and the
objectives into book records, and folds the G2 findings about the book (`book error`, `printed answer
misaligned`, `printed text damaged`) into `misprints`. That writer is still to build.

## What else lives here

`<book>/misprint-candidates.json`: the pipeline's findings about mistakes the book itself prints, for the
review tool's Misprints task. It is made by `../groundtruth/export_misprint_candidates.py` from the G2
recommendation runs, and re-running it never touches decisions.

## Reviewing

The Noor review tool (`python3 services/extraction/groundtruth/review/server.py`) opens these files in
two of its tasks:
- **Label extraction:** labelling a lesson's records writes them into its ground truth.
- **Misprints:** deciding misprints.

See `../groundtruth/README.md`, "Reviewing". An extracted record may be located by `anchor` (the
pipeline's block reference) instead of a quote; ground truth needs a quote, so the tool asks for one
when you confirm it. Check a file with `uv run --with jsonschema python ../groundtruth/validate.py <file>`.
