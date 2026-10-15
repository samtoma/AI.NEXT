# Book records from the extraction pipeline

What the pipeline read from each book, one file per lesson, in the book-record format
(`../groundtruth/book-record.schema.json`, `"role": "extraction"`):

    book-records/<book>/<lesson slug>.json        e.g. book-records/g10-math/g10m1s3-1.json

The lesson slug is the manifest's, so a file here and its ground truth in `../groundtruth/` share every
id and can be scored against each other record by record.

**Nothing writes here yet.** The book-record writer (a deterministic step after S1–S3 that turns
`blocks.jsonl`, the claims, the book questions and the objectives into book records) is still to
build. When it lands, it also turns the G2 recommendation runs' findings about the book itself
(classes `book error`, `printed answer misaligned`, `printed text damaged`) into `misprints` entries,
so a misprint is kept as printed with what is meant, instead of the question being dropped.

## Reviewing a file

The review tool opens these files beside the ground truth:

    python3 services/extraction/groundtruth/review/server.py

They are listed as `[extraction]`. An extracted record may be located by `anchor` (the pipeline's
block reference) instead of a quote. Misprints the pipeline proposes show on their record; the
"Has misprints" filter lists them. Confirming a record confirms its misprints; a wrong one is edited
or flagged. Check a file with `uv run --with jsonschema python ../groundtruth/validate.py <file>`.

The console's review backlog is where misprint decisions of record are meant to be made once it
reads book records: see `docs/design/book-misprint-backlog.md`.
