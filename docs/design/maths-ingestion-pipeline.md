# Design: one maths ingestion pipeline for every book

**Status:** proposal, being built (Tamer, 2026-10-16). Samuel decides the architecture (CLAUDE.md, authority rule 1);
this records Tamer's choices so far and what each stage adopts from the Grade 10 line, for Samuel to confirm or
change. An ADR amending ADR-0005 follows once he does.

**Goal.** One standard pipeline that ingests any maths book — an EPUB, a PDF with a text layer, or a PDF that is only
page images — run as a set of agent stages with a person reviewing at fixed points. Nothing Samuel built for the
Grade 10 book that would serve another book is thrown away: it is adopted as is, or run on book records through an
adapter.

## The decisions (Tamer, 2026-10-16)

| Question | Choice | Why |
|---|---|---|
| What every stage reads | **The book record** (`groundtruth/book-record.schema.json`, v2) | One shape for every source; scored against ground truth; the review tool already reads it. Samuel's stages run on it through adapters, as S4–S7 already do. |
| How agent steps run | **Workflow scripts** (`runbook/*.workflow.js`), the one source of truth | Samuel's way: run in Claude Code with the Workflow tool. The same script also runs from a shell (`workflow_runner.py`). |
| Objectives (S1) | **Samuel's two-reader S1** on book records | Two blind finders, a reconciler, two blind mappers and an evidence check catch filing errors a single reading makes. |
| Worked solutions (SW) | **Samuel's step checker** on the book's worked solutions | The tutor teaches from them: a wrong step must be caught, not taught. |

## The stages

| Stage | What it does | From Grade 10 | For a new book |
|---|---|---|---|
| **S0a** source adapter | The book into book records | `source_adapter.py` (EPUB + PDF text layer) | **Built.** `ingest.py route` switches on the book config: an EPUB goes through Samuel's `source_adapter.py`, then `epub_book_record.py` writes book records; otherwise the page images go through `extract_book_record.py` (`book-record.workflow.js`). A PDF text layer is reported, not used yet |
| **S0** lesson map | Lessons, their pages, the page offset | `build_manifest.py` from the EPUB index; gate G0 | EPUB: Samuel's manifest, unchanged. Page images: **built**, `book_record_lessons.py` (`lesson-map.workflow.js`) — two blind readings of the contents, the offset from probe pages, unit openers checked; a person approves (`approve`) |
| **S0b** maths | LaTeX for maths stored as images | `transcribe-maths.workflow.js`: three readings, md5 proof | EPUB with image maths: Samuel's S0b, unchanged (`maths_source: epub-images-md5`). Page images: **built**, `book_record_maths.py` (`maths-reading.workflow.js`) — every formula read again blind; disagreements go to the review tool's Maths reading task |
| **S1** objectives | The "can do" objectives and each item's objective | `objectives.workflow.js`: two finders, reconciler, two mappers, evidence check | Adopted, on book records |
| **S1** links | Prerequisite links between objectives | The linker and its independent checker inside S1 | Adopted, on book records |
| **G1** | A person approves the objectives | Samuel's gate | A review task in the review tool (approve, fix, reject per objective and per link) |
| **S2** statements | The book's definitions, rules, cautions | Claims, provenance check | The book record's statements, kept as built (they reach the tutor) |
| **S3** answers | Typing for the marker; blind re-solve; tiers | `lesson.workflow.js` S3 | Adopted step by step: the typing agent, answer rules, multi-part carry; blind re-solve and two-reading tiers already run |
| **SW** working | Step-check the book's worked solutions | `working-check.workflow.js`, `working_check.py` | Adopted on the book's worked examples; a wrong step goes to the Misprints task |
| **S4** figures | Redraw each figure, or record a gap | `lesson.workflow.js` S4 | Adopted unchanged; PDF figures cropped first (`crop_figures.py`) |
| **S5–S7** | Misconceptions, question families, widgets | `misconceptions`, `families`, `widgets` workflows | Adopted unchanged (`book_record_generation.py`); a book's printed contrasts count as remarks |
| **S8** coverage | Every sub-heading covered by what was produced | `lesson.workflow.js` S8 | Adopted, on book records |
| **Assembly** | The app's bundles | `assemble_lesson_bundle.py` | `compile_book_records.py`, converging on the assembly's own functions (multi-part, answer forms) |
| **Meter** | Cost per stage, lesson and model | `meter_run.py` → `runs/<book>/cost.jsonl` | Adopted: runs from the shell write the same ledger |
| **Load** | Into the database | `load_seed.py`, `load_generated_questions.py`, `load_misconceptions.py` | Adopted unchanged |
| **Review** | A person decides | Gates G0–G5 in the console | The local review tool's tasks (Label, Misprints, Maths reading, Generated answers, Generated content, Tiers, Objectives) |

## Running a new book

`uv run ingest.py plan <book> <unit>` (in `services/extraction/`) prints the unit's stages in order: the command
for each, whether its output is already on disk, and the gates where a person decides. `ingest.py route <book>`
says which source route the book takes and why. Nothing in either calls a model.

**The EPUB route** (Grade 10). Samuel's S0 (`source_adapter.py`), his G0 manifest and his S0b produce blocks,
figures and LaTeX; `epub_book_record.py write <book> <chapter>` turns them into book records, using his own
assignment of blocks to lessons (`assemble_objectives.assign_chapter`). Every block type maps to an item type;
exercises group by printed question with sub-questions as parts, each with its printed answer, the EPUB's worked
solution and the practice code; teacher-only notes are never carried over; a lesson with a maths image S0b has
not accepted is not written. End-of-chapter items are listed, not filed: S1's mappers place them. Tested on
Samuel's fixture; **not yet run on the real Grade 10 EPUB**, which is not on this machine (the PDF is). The config
names it, so `ingest.py` reports the book as blocked rather than quietly reading the PDF instead. Unlike the writer
book-records/README.md first described, it runs before S1 and does not fold G2's findings into misprints.

**The page-image route** (Prep 3). Trial on Unit 1, 2026-10-16:
- *S0 lesson map:* the proposal matched the hand-made Unit 1 map exactly (offset, slugs, references, titles,
  pages). It found that the PDF holds both terms with page numbers restarting, so it maps the first contents
  and says the rest needs its own run; a second part is added under its own `page_offset`, and its page
  images are kept apart from the first part's. About $1.85 over three trial runs while the rules were fixed.
- *Maths second reading:* 200 formulas read twice, 195 agree, 5 for review (one blank's dot count, and R
  against ℝ, which the first reading itself writes both ways). It also caught Example 4's solution recorded
  on the wrong page, until an item over a page break was offered both pages. $2.67.
- What it does not check: a `formula` field (the reader's compact form, not the print) and a worked example's
  `answer` (lifted from its solution, which is checked).

## What the book record adds to Grade 10's line

Ground truth and scoring; misprints, decided by a person; generated answers for prompts the book leaves unanswered;
figure crops for PDFs; two readings of every tier; the book's statements given to the tutor; the lesson smoke test.
