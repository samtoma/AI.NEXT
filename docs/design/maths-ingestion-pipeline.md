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
| **S0a** source adapter | The book into book records | `source_adapter.py` (EPUB + PDF text layer) | One adapter that switches on the source: EPUB (Samuel's), PDF text layer, page images (`extract_book_record.py`) — each writing book records |
| **S0** lesson map | Lessons, their pages, the page offset | `build_manifest.py` from the EPUB index; gate G0 | A scout agent proposes the map from the contents and lesson headers; a person approves it |
| **S0b** maths | LaTeX for maths stored as images | `transcribe-maths.workflow.js`: three readings, md5 proof | On when the source's maths is images (an EPUB like Siyavula's); a second blind reading for page-image books |
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
| **Review** | A person decides | Gates G0–G5 in the console | The local review tool's tasks (Label, Misprints, Generated answers, Generated content, Tiers, Objectives) |

## What the book record adds to Grade 10's line

Ground truth and scoring; misprints, decided by a person; generated answers for prompts the book leaves unanswered;
figure crops for PDFs; two readings of every tier; the book's statements given to the tutor; the lesson smoke test.
