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

The objectives call (step 3) also says which figure a prompt needs (`uses_figure`). ext-v3 filed every item one
objective early (the model counted objectives from 0, the code from 1); ext-v4 numbers them from 1 and refuses an
answer that counts from 0. Redraw a saved record's objectives, filing and figure links, with no page read (≈ $0.03
a lesson):

    uv run --with jsonschema extract_book_record.py objectives prep3-math-en u1-1 u1-2 u1-3 u1-4

**Figures of a PDF book, printed-answer checks and tiers.** An EPUB ships each figure as an image file; this PDF
does not (its pages are built from image tiles and vector paths). For a book whose config has a PDF and no EPUB, in
this order (figures ≈ $0.11 each, Unit 1: 24; the checks and tiers a few cents a lesson):

    uv run --with pymupdf --with pillow --with jsonschema crop_figures.py run prep3-math-en u1-1 u1-2 u1-3 u1-4
    uv run book_record_figures.py run prep3-math-en u1-1 u1-2 u1-3 u1-4
    uv run --with pymupdf answer_gen.py check-printed book-records/prep3-math-en/u1-1.json   # each lesson
    uv run tier_questions.py run prep3-math-en u1-1 u1-2 u1-3 u1-4

1. `crop_figures.py` places each figure's box on the page (a gridded page, then a close-up), crops it at 200 dpi
   to `work/<book>/figures/<id>.png` and checks the crop edge by edge; the box is the record's `region`
   (`checked: false` lists a crop that never passed; `--failed` tries those again).
2. `book_record_figures.py` is Grade 10's S4, unchanged: it writes the same embedded copy of
   `runbook/lesson.workflow.js` in visuals-only mode, from the book records and the crops. `args` writes the copy
   for Claude Code (Workflow scriptPath, no args; then `accept` the saved return); `run` runs it here through the
   workflow runtime with each agent answered by the `claude` CLI (`runbook/cli_responder.mjs`). The drawings and
   gaps go to the teaching layer, `teaching/<book>/visuals/<slug>.json`.
3. `answer_gen.py check-printed` re-solves every printed answer blind (Grade 10's S3 rule: the solver never sees
   the item's printed solution, answer or page, only its figure crops), compares, and sends what the comparison
   cannot settle to a judge: `teaching/<book>/printed-checks/<slug>.json`. Unit 1: 18 of 18 agree.
4. `tier_questions.py` tiers every book question with Grade 10's S3 rule, read twice (with the answer and steps,
   and blind): `teaching/<book>/tiers/<slug>.json`. Disagreements wait in the review tool's Question tiers task;
   compile uses a person's choice, else the agreed tier, else the blind reading's. Unit 1: 26 basic, 18 standard,
   5 advanced live questions (was all "standard").

**From book records to the tutor:** `../compile_book_records.py` compiles lessons into the bundles the app
already loads (`compiled/<book>/`). For a compiled lesson only the new content is used: the book record's
objectives (`u1-1:objective-3` becomes `lo:u1-1-3`) and the book's own exercises and worked examples, with answers
printed or generated (approved, or agreed by both readings). Today's questions, figures, generated questions,
widgets, misconceptions and links for that lesson are left out; every other lesson is unchanged. Marking uses
what the app has: numbers by its number check, values, points and sets by its marker, names and yes/no by its
plain check. What could not become a question is listed in `compiled/<book>/compile-report.json`.

**The book's statements reach the tutor** (Tamer, 2026-10-16: book-record lessons only, learn and review mode). The
compile writes each lesson's definitions, rules, cautions, conventions, printed methods, key terms and prior
knowledge, by objective, misprints corrected and in the app's notation, to `compiled/<book>/content/<slug>.json`
(Unit 1: 62). The maths tutor then gets them as "THE BOOK'S STATEMENTS", and its grounding rule lets a claim come
from them as well as from objective descriptions and worked solutions: define a term in the book's words, cite the
page, never state a rule the book does not print; a review correction may quote the book's rule
(`app/src/lib/book-statements.ts`). The app reads them only from the folder `AINEXT_BOOK_STATEMENTS_DIR` names: the
`bookrecord-trial` launch entry sets it; unset, as everywhere else, every prompt is byte-identical, and Grade 10's
extracted claims (`seed/content/`) are never read. The smoke test fails if a lesson has statements that the tutor is
not given while the folder is set.

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

A trial database with Unit 1 compiled (`ainext_bookrecord_trial`; Noor with the `bookrecord-trial` launch entry,
port 3013):

    uv run compile_book_records.py prep3-math-en u1-1 u1-2 u1-3 u1-4
    AINEXT_DB_DSN=postgres://ainext_maint:ainext_maint@127.0.0.1:5432/ainext_bookrecord_trial AINEXT_ENVIRONMENT=mvp1 \
      uv run load_seed.py compiled/prep3-math-en/unit1.json seed/unit2.json seed/unit3.json seed/unit4.json seed/unit5.json \
        seed/geo-unit1.json seed/t2-unit12.json seed/t2-unit3.json seed/geo-unit2a.json seed/geo-unit2b.json \
        --course course:prep3-math-en --replace
    AINEXT_DB_DSN=… uv run apply_review_verdicts.py --book-reviews compiled/prep3-math-en/review-stamps.json

`--replace` matters: a question whose id changed (its objective was refiled) is retired, never left live. The
stamps are the review tool's decisions (Generated answers), each as the human stamp of the question it decided
(`reviewed_by "TD (answer approved, review tool)"`); a rejection retires the question, a fix request holds it.
Figures are reviewed too (Generated content → Figures): the compile leaves out an S4 drawing that was rejected or
sent back for a fix, so its questions get the book's picture, and lists every figure decision in the report
(`figure_reviews`) and in `review-stamps.json` (`figures`). No row is stamped from those: the visuals table has no
review columns.
Unit 1 today: 49 live book questions (13 with the book's picture, 11 with an S4 drawing), 11 worked examples in the
library, 0 held, 11 stamped; the compile report lists the rest, with why.

**S1 objectives and prerequisite links, then G1 (Tamer, 2026-10-16: Samuel's two-reader S1 for every book).**
`../book_record_objectives.py run <book> <chapter> <lessons…>` builds S1's chapter packet from the book records (every
anchor a book-record id; a unit is a chapter) and runs Samuel's `objectives.workflow.js` unchanged — two blind finders,
a reconciler, two blind mappers, an evidence check, his linker and its independent checker — then his own checks
(`assemble_objectives.evaluate_chapter`) into `teaching/<book>/objectives/ch<NN>.json`. A person decides every
objective, link and question in the review tool's **Objectives (G1)** task; `apply <book> <chapter>` then writes only
what was approved: the objectives and each item's objective into the book records, the kept links into
`teaching/<book>/links/`, which compile turns into the app's `prerequisite_of` edges. Unit 1 ($1.48): 14 objectives
(6 fail Samuel's evidence rule and wait for G1), 2 links confirmed of 13 proposed, 17 questions.

**SW, the book's worked solutions step by step.** `../book_record_checks.py sw <book> <chapter> <lessons…>` runs
Samuel's working checker (`working_check.py`, `working-check.workflow.js`) on the compiled bundle and exports every
flag on the book's own working to `misprint-candidates.json`, the Misprints task. Unit 1 ($1.01, 60 solutions): 54
consistent, 1 flag (Example 2 prints (3, 0) for (3, a): the misprint the ground truth records), 5 unclear (their
points are only in a figure).

**Costs** of every run from the shell are written to Samuel's ledger, `runs/<book>/cost.jsonl` (the line
`meter_run.py` writes for a Claude Code run): `uv run meter_run.py summary --book <book> --by phase`.

**Generation: S5 misconceptions, S6 question families, S7 widget questions.** Grade 10's own steps, run on the
compiled bundles by `../book_record_generation.py` (the same builders and embedded workflow copies; a book-config
view, `work/<book>/bookrecord/<book>.json`, points the S6/S7 commands at the compiled lessons; S7 reads the trial
database). In the runbook's order (runbook/README.md §4):

    uv run book_record_generation.py s5 prep3-math-en u1-1 u1-2 u1-3 u1-4 --stage draft
    uv run book_record_generation.py s6-author prep3-math-en u1-1 … --catalogue <draft run>   # then s6-grade
    uv run book_record_generation.py s7-author prep3-math-en u1-1 … --catalogue <draft run>   # then s7-verify
    uv run book_record_generation.py s5 prep3-math-en u1-1 … --stage final --draft <draft run> \
        --distractors runs/<book>/families/s5-distractors.json --distractors runs/<book>/widgets/s5-distractors.json
    # then the runbook's two-pass assembly (assemble_misconceptions.py --catalogue-only, load, the S6/S7 bundles,
    # the --bundle pass) into teaching/<book>/generated/; compile adds those rows to the compiled generated files

S5 keeps only entries the book's evidence supports. This book prints no caution box and no multiple choice, so the
adapter also gives S5 its printed contrasts and "Notice that" lines as remarks. Unit 1 ($5.81 in all): 6
misconceptions on 5 objectives; 9 of 12 families pass the blind grade (84 questions; 7 more families held: 6 have
no book question to build on, 1 a template error); 1 widget question (S7 found 11 gaps, a list for Samuel: arrow
diagrams, parabola plotting, rule-based pair selection; 3 widgets lost their only diagnostic and were left out).
Unit 1 now has 134 live questions, 10 of 18 objectives practised, most in two or three tiers.

**A second course for the same book.** `books/prep3-parallel.json` (`course:prep3-parallel-math-en`, registered
in `app/src/lib/courses.ts`, status `ingest`) is the Prep-3 maths book ingested by this pipeline as its own course,
so it can sit beside the launch course. Its lessons carry the `pp3` prefixes (`pp3u1-1`), so its objectives never
collide with the launch course's. Nothing is built for it yet; it stays hidden until an operator makes it live
for a grade on the console (no availability row is hidden).

A book that has an EPUB and a text layer (Grade 10) is meant to get its book records from the extraction line
instead: a deterministic writer after S1–S3 that turns `blocks.jsonl`, the claims, the book questions and the
objectives into book records, and folds the G2 findings about the book (`book error`, `printed answer
misaligned`, `printed text damaged`) into `misprints`. **Built as `../epub_book_record.py`** (2026-10-16), in a
simpler form: it runs before S1 (objectives come from S1 and G1, as for page-image books) and does not fold G2's
findings yet. `../ingest.py plan g10-math 1` gives the order. Not run on the real EPUB, which is not on this machine.

**Page-image books, before the page reader:** `../book_record_lessons.py` proposes `lessons.json` from the
contents pages (`lessons.proposed.json`, approved with `approve`), and after it `../book_record_maths.py` reads
every formula a second time, blind (`maths-reading/<lesson>.json`, decided in the review tool's Maths reading
task, written back with `apply`).

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

**Before a load (2026-10-17: the steps Grade 10 had that this line lacked).** After compile, in order:
`../book_record_coverage.py <book> <unit>` (Samuel's coverage audit on book records: GREEN, or a person signs each
exception in `coverage/<book>.unit<NN>.book-records.json`); `../book_record_g2.py run <book> <unit>` when compile held a
book question (his G2 recommender; compile applies what an independent agent confirmed); `../book_record_gonogo.py
report`, then a person's `decide … go`; then `../book_record_load.py <book> <unit> --dsn … --go` (validate, preview every
loader rolled back, load, stamp, parity). `--scratch` loads a database on this machine without G5, for S7 and the
fan-out. `../ingest.py run <book> <units…>` runs units in parallel up to the first gate a person owes. Compile now
also carries what an earlier part of a question defines into a part asked alone (his `multipart.py`).
