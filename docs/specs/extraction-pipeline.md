# Spec — The Extraction Line (agentic book-ingest pipeline)

| | |
|---|---|
| **v1** | approved 2026-07-21 (Samuel), recorded as ADR-0005. Its stage table is kept verbatim in Appendix A. |
| **v2 (this revision)** | 2026-09-25. **Approved by Samuel**: first *"I would take your recommendations"*, then *"ok for all"*, recorded in `specs/003-curriculum-tracks/decisions.md` (#12–#16, #19–#22, B, C) and the ADR-0005 amendment. **Gate G0 passed the same day: 65 lessons.** **Being built**: §9 marks each build item's state. It has two parts: an audit of how the line really worked before v2 (§2), and the design for the fourth book, *Everything Maths Grade 10* (Siyavula, v1.1, English), and for later books (§3 to §9). §10 records the decisions taken. |
| **Authority level** | **Decided design** for the pipeline, under ADR-0005 as amended 2026-09-25. It is not a product requirement: product obligations live in `specs/003-curriculum-tracks/spec.md` (FR-43xx, FR-44xx). §3.4 (objectives) is pipeline policy by Samuel's explicit instruction, never an FR. |
| **Maintained by** | the pipeline auditor (v2 draft); the tech-writer from 2026-09-25 |
| **Design authority** | `agentic-data-thesis.html`: Pillar I (schema-first, not text-first), Ch. 15 (curriculum graph), Ch. 19.6 (MVP-cut). |
| **Runbook** | `services/extraction/runbook/README.md` (command by command, with the human gates marked) |

Samuel's direction for this cycle, 2026-09-25: *"I don't want to forget that we create the widgets,
and the misconceptions, as well as the new questions to match the pattern we decided so generated
questions and widgets is something that you have to consider in this cycle, and you can update the
pipeline to include that as well, and please document that as well."* On objectives: *"for the
objective of the book, you must find it for each lesson, it is a core part of our product, and our
teaching methodology (don't write that as requirements yet)"*. So §3.4 describes a **pipeline
stage**. It is not a product requirement, and no FR is derived from it.

On the written design and the Grade 10 S0 report, the same day: *"ok for all"*. That answer passed gate
G0 at 65 lessons, moved canonical solutions to the EPUB's worked solutions, and added a maths-image
transcription stage (S0b). It also added a maths-expression marker in the app, and settled the
misconception catalogue's single source (B19).

---

## 1. Why this exists

Before v1, "extraction" meant a human, or Claude, reading the PDF and writing the seed JSON by hand.
No stage could check that the output was complete. That is how Geography Unit 1 Lesson 2 shipped
covering one continent out of six. The answer was a **repeatable conveyor**:

- the LLM fills a validated schema instead of writing free text;
- every fact is checked against its source page;
- every answer is solved again by a different agent;
- a **coverage oracle** proves that every sub-topic on the page reached the graph.

v2 keeps that and adds what the product now needs from every book: **objectives found for every
lesson**, and three stages that until now were run by hand, outside any workflow:
**generated questions**, **widget questions**, and **misconceptions with their refutations**.

---

## 2. As built: audit (2026-09-25, from code and git history)

### 2.1 What produced each book

| Book (course) | What produced it | Runbook workflow | Bundle(s) | Reproducible from the repo? |
|---|---|---|---|---|
| Prep-3 Maths EN (`course:prep3-math-en`), 10 modules, 90 LOs, 450 book questions, 212 visuals | **Ad-hoc Claude Code agents, 2026-07-18 → 07-20, before the line existed** (commits `f69e593`, `bfc567e`) | **none** | `seed/unit1..5.json`, `geo-unit1.json`, `geo-unit2a/b.json`, `t2-unit12.json`, `t2-unit3.json` | **No.** No prompts, no manifest, no run output. The only record is `seed/geometry-structure.md`, a scout note. |
| Social Studies T1 AR (`course:prep3-social-ar`), 762 questions | `rich-lesson.workflow.js` → hand-saved `/tmp` files → `audit-claims.workflow.js` → `merge_final.py` → `assemble_fullbook.py` | `extract-lesson` (Phase A proof, soc1-2 only), then `rich-lesson` + `audit-claims` | `seed/social-t1.json` + `seed/content/soc*.json` (supersedes `social-skeleton.json`) | **No.** The run outputs lived in `/tmp` and are not in the repo (`merge_final.py:11,16,24`; `assemble_fullbook.py:112`). |
| Arabic T1+T2 (`course:prep3-arabic-ar`), 20 lessons, 307 questions | `arabic-lesson.workflow.js` → `assemble_arabic.py` (with the sealed Quran lane), then `arabic-book-review.workflow.js` | `arabic-lesson`, `arabic-book-review` | `seed/arabic-t1.json`, `arabic-t2.json`, `seed/content/ara*.json` | **Mostly.** The run outputs are committed as `runbook/*.local.json`. |
| Maths generated bank, 543 questions | `generate_questions.py` (35 template families written by hand in Python), then exported **from the DB** | none | `seed/generated/generated-questions.json` | **As an export only.** It does not reproduce from the generator (see G4 in §2.9). |
| Maths widget bank, 48 questions | `generate_widget_questions.py` (templates written by hand in Python) | none | `seed/generated/widget-questions.json` (a DB export) | As an export. |
| Maths misconception catalogue, 97 entries | `build_misconceptions.py` (entries written by hand in Python), then exported from the DB and edited by hand | none (`refutation.workflow.js` exists but never produced output) | `seed/generated/misconceptions.json` | **No.** The generator and the loaded catalogue have diverged (see G6 in §2.9). |
| Coverage top-up, 4 questions | hand-authored (T142 / FR-1109) | none | `seed/generated/coverage-basics.json` | Static file. |

"591 generated maths questions" means 543 template-generated questions plus 48 widget questions.
The 4 coverage-basics items are counted separately.

### 2.2 Prep-3 Maths: how the 450 book questions and 212 visuals were made

- **Provenance header.** Every maths bundle names its producer as a Claude Code session, not a
  line:
  - `unit1.json`: *"claude-fable-5 via claude-code (human review gate: Samuel)"*, `poc-1`;
  - Units 2–5 and geometry: *"claude via claude-code (unitN / geometry / angles-arcs-A/B /
    t2-algebra / t2-probability agent)"*, `poc-2` / `poc-3`.
- **Page map.** Set by hand in `seed/geometry-structure.md`: the PDF holds two Student's Books, and
  for Term 2 `PDF = printed + 73` (checked on 5 anchors). There is no manifest file.
- **Objectives.** The agents derived them from the sub-headings. The label is the heading and the
  description summarises the content, with a `source_page`, for example `seed/unit3.json`
  `lo:u3-1-1`. No evidence trail was kept and nothing derived them a second time independently. In
  other words, the Prep-3 maths LOs were already *found from the book* in the §3.4 sense, but
  informally.
- **Questions.** **All 450 are agent-written, not copied from the book.** Every `source_note`
  begins "Original question; …" or "Original variant of Example …". The canonical solutions were
  written by the agents too. 421 of the 450 carry `verified=true` from an independent re-solve,
  which `load_seed.py:700` loads as `live` with `reviewed_by='ai dual-check (pending Samuel)'`.
  The other 29 went live under ADR-0019 with no reviewer stamp.
- **Visuals.** 212 parametric specs, written against `VIZ_SPEC.md` v1 (nine maths kinds). None is
  an image.
- **Back-audit.** ADR-0005's Phase C back-audit of maths was never recorded as done
  (`PROJECT_STATE.md` still lists it as *Next*).

### 2.3 Social Studies

- **`extract-lesson.workflow.js`** is ADR-0005's Phase A. It hard-codes the PDF path (`:13`), one
  lesson's LOs, and six continents with a hand-written `must` checklist, and runs
  Claims → Questions → Verify (Sonnet re-solve on redacted answers + Haiku provenance) → Coverage.
- **`rich-lesson.workflow.js`** (Phase B) is the whole-book conveyor.
  - It hard-codes the PDF (`:14`), the offset (`pdf = printed + 7`, `:17`) and a 14-lesson table
    (`:19-34`).
  - Its default run is `['soc1-1']` (`:37`).
  - Segment (Sonnet) reads the objectives **verbatim from «أهداف الدرس»** (`:96`), then per
    sub-topic runs claims → questions → blind re-solve + provenance, then widgets, then the
    coverage oracle.
  - Everything it returns is **returned to the calling session**; Workflow scripts cannot write
    files.
- **`audit-claims.workflow.js`** has the claims Haiku flagged pasted inline (`:8`). Collecting
  them from the provenance output was a step done by hand, and it is not in the repo.
- **`merge_final.py`** and **`assemble_fullbook.py`** read `/tmp` paths and a hard-coded lesson
  list.
- **`manifest/social-prep3-t1.json`** is the only Stage-0 manifest in the repo.

### 2.4 Arabic

- **`arabic-lesson.workflow.js`**, the ten-stage conveyor from ADR-0006:
  - segment → text capture → language artefacts → questions → interactives → blind إعراب
    re-derivation + provenance → coverage with integer equalities and `OUT_OF_SCOPE`;
  - two page-offset regimes are hard-coded (`:17-24`), and the same table is duplicated in
    `arabic-book-review.workflow.js:17-39`;
  - run outputs are committed.
- **`assemble_arabic.py`** runs the sacred lane: raw fetches from two Quran authorities, diffed,
  then sealed with `text_sha256`.
- **`arabic-book-review.workflow.js`** is a 22-agent audit: per-lesson auditors, a graph review and
  a completeness critic. Its findings are in `runbook/ar-review-report.md`. The ten re-run
  candidates it names have no recorded re-run.
- **Known debt.** Non-scripture text is captured at K=1, where the contract asks for K=2/3
  (`assemble_arabic.py` docstring).

### 2.5 Generated questions: the decided pattern

These are the rules ADR-0008 and its 2026-09-12 *Resolved since* entry settled, and how the code
applies them:

1. **Template families, not free authoring.**
   - A family is a Python function registered with `@family(fid, lo_id, parent, page)`
     (`generate_questions.py:171`).
   - It samples numbers and **computes the answer key with the same code that writes the stem**,
     so the key cannot disagree with the question.
   - Reading one instance validates the whole family.
2. **Every item names its parent**: `parent_question_id` points at a reviewed book question.
3. **Distractors carry a `misconception_id`**, so a wrong option is a diagnosis (FR-1107). The
   keyed option never carries one (`verify()`, `:1184`).
4. **Deterministic re-check of the output.**
   - `verify()` rejects an empty stem, a numeric answer that is not a number, a key missing from
     the choices, duplicate choice text, and unbalanced `$` delimiters.
   - `rebalance_keys()` (`:1226`) spreads the correct answer evenly across A–D.
5. **Two acts: load, then promote.**
   - `load_generated_questions.py` forces `source='variant'` and `reviewed_by NULL`, and refuses
     to run unless `AINEXT_ENVIRONMENT=mvp1`.
   - Rows land at `review`; `--promote` is a separate act.
   - `--sample 10` draws a 10% sample that is **stratified by family**: at least one item per
     family, with the family parsed out of the `source_note` text (`:293-300`).
6. **A verdict travels to the family.**
   - `apply_review_verdicts.py` stamps `<reviewer> (sampled)` on the items a human read, and
     `<reviewer> (family <tpl> via <qid>)` on their siblings.
   - `reject` retires the whole family.
7. **Coverage first.** Every objective carries at least one live item per tier (FR-1109).
   "Applications" (word-problem) objectives that could not be templated without producing
   nonsense were written by hand (`coverage-basics.json`).
8. **The DB is the source of truth.** The committed bank is an export
   (`export_generated_content.py`), replayed with `--restore`, which keeps the review stamps.

Current state: 35 families (31 of them at 16 items, although the generator's default is
`--per-family 10`, `:1263`), plus 12 hand-written first-bundle items with no family. 36 of the 90
LOs are covered. 465 of the 543 carry a review stamp: 52 sampled, the rest through their family.

### 2.6 Widget questions (ADR-0009)

- **A widget is a question.**
  - `question_type='widget'`, `correct_answer='ok'`.
  - `choices = {kind, spec, diagnostics:[{predicate, misconception_id}]}` (`widget_spec.py`).
  - The predicate vocabulary is **one contract**, `contracts/widget-predicates.json`: 11 kinds,
    from which the app's TypeScript is generated.
- **Templates.** Written by hand as `t(...)` calls and loops in `generate_widget_questions.py`.
- **The prerequisite rule (FR-1215).** A diagnostic may name a misconception on the question's own
  LO or on any transitive prerequisite of it. This is checked against the live graph, **but only
  when `--dsn` is passed** (`:318`, `:333`). Without it the graph checks are skipped silently.
- **48 questions** over 13 LOs, **all with `parent_question_id = NULL`**. FR-1101 says every
  generated item names its parent; nothing records that widgets are exempt.
- **Two different "interactive" systems exist:**
  - question widgets, the maths kinds above;
  - content-file interactives: `locate_on_map`, `term_match`, `timeline_builder`,
    `chain_builder`, and the Arabic `extract_spans` / `hamza_seat` / `style_purpose` /
    `irab_builder`, stored in `seed/content/*.json` by the Social and Arabic conveyors and read by
    `app/src/lib/lesson-content.ts`.

  `VIZ_SPEC.md` documents neither of them.

### 2.7 Misconceptions and refutations

- **What shipped: `build_misconceptions.py`.** 99 `mc(...)` entries, written by hand in Python and
  grounded in each LO's description and the book-derived distractors. Each entry has:
  - `kind`: `book_distractor`, `conceptual` (FR-1114) or `generated_distractor`, with `aliases`
    folding in the generator's older ids (FR-1115);
  - a stepwise refutation in the decided house style (`mc()` docstring, `:61-66`): *step 1 names
    what the student was thinking without calling it stupid; the last step leaves them with the
    move that works*;
  - `maps`, which stamp book choices by **exact choice text**.

  No independent verifier ran on these entries.
- **What is loaded: `seed/generated/misconceptions.json`.** 97 entries, a DB export that was then
  edited by hand in `89d7a3a`. `load_misconceptions.py` loads it on every deploy (`ci-cd.yml`) and
  on every `local-dev.sh` run. It covers **42 of 90 LOs**.
- **What never shipped: `refutation.workflow.js`**, the fail-closed library conveyor for Phase 6.
  - It reads `MANIFEST` and `LO_FILTER` as injected globals (`:49`). The Workflow runtime only
    injects `args`, so the script throws as written.
  - `seed/refutations-math.json`, the output `assemble_refutations.py` expects, **exists nowhere
    in git history**.
  - Its ids are `misc:<lo>:<slug>` (`:245`, and `schemas.py:857`); the shipped catalogue uses
    `mc:`.
  - `specs/001…/traceability.md` still cites it as the BUILT implementation of FR-304.

### 2.8 Loaders, validators, checks and the review page

| Tool | What it does | Notes |
|---|---|---|
| `schemas.py` | Pydantic `SeedBundle`: referential integrity, a DAG check on `prerequisite_of`, MCQ key among the choices, Arabic typed answers, `VIZ_KINDS` (`:799`) | `ClaimStep.claim_ar` and `evidence_kind ∈ {text, map, concept_box, enrichment_box}` (`:79-86`) are Social-shaped |
| `load_seed.py` | Validates, then loads `--all` or `--course` (scoped subtree replace); sacred gate; `--dry-run` | Hard-coded `COURSE_SUBJECTS` (`:237`), `BUNDLE_ORDER` (`:313`), `SUPERSEDED_BY` (`:334`) |
| `load_generated_questions.py` | Structural validation (FR-1106); `--sample`, `--promote`, `--restore`; mvp1 guard | Family identity parsed from `source_note` |
| `load_misconceptions.py` | Upserts the catalogue, writes refutations to `explanation_library`, stamps book distractors by text, folds aliases | Not course-scoped |
| `export_generated_content.py` | DB → the three generated bundles | Exports **all** variant rows and **all** misconceptions, not course-scoped |
| `merge_final.py`, `assemble_fullbook.py` | Social merge and assembly | `/tmp` paths, one-off |
| `assemble_arabic.py`, `audit_arabic.py`, `selfcheck_arabic.py` | Arabic assembly, audit, and the byte-identical self-check | |
| `build_lo_manifest.py` | Flattens the 10 maths bundles for the refutation workflow | Bundle list hard-coded (`:26-30`) |
| `parity_check.py` | Per-solution drift guard: the book fingerprint against `EXPECTED` (`:42`), generated counts disclosed but not compared | Scoped by **subject = 'math'** (`:54`); `source_sha` is the **first-ingested document in the whole DB** (`:102-103`) |
| `render_review_page.py` | Human review page for a generated bundle (stem, choices, key, solution, each distractor's misconception) | Only for generated bundles; no page exists for objectives, book questions or the catalogue |
| `apply_review_verdicts.py` | Applies the sampled verdicts; the family rule | |
| `variant_engine.py` | A stub with the sacred-content guard | Never wired to a model |

### 2.9 Automated, hand-run and hand-authored

| | Automated (workflow or deterministic script) | Run by hand (a human or agent stitching steps together) | Written by hand (content typed into code or JSON) |
|---|---|---|---|
| Maths book | Loader and validator | Everything else | Bundles, objectives, 450 questions and solutions, 212 visual specs |
| Social | Claims → questions → verify → coverage (`rich-lesson`) | Saving outputs to `/tmp`, collecting flagged claims, merge, assembly | Manifest, the Phase-A `must` checklists |
| Arabic | Conveyor, sacred-lane fetch and diff, book review | Choosing re-runs from the review report | Lesson and offset tables in two workflows |
| Generated questions | Instantiation, `verify()`, key balancing, sampling, loading | Choosing `--per-family`; the export-and-edit cycle | **All 35 families** and the 12 first items, the 4 coverage items |
| Widgets | Build, contract validation, graph check (if `--dsn`) | Everything around it | **All templates** |
| Misconceptions | Loading, alias folding, distractor stamping | The export-and-edit cycle | **All 99/97 entries and their refutations** |

**Where the decided patterns are recorded:**
- ADR-0008, including its *Resolved since* entry (template families);
- ADR-0009 (widgets as questions);
- `specs/001-student-mvp1-delta/spec.md` FR-1101…1115 and FR-1201…1219;
- **the docstrings** of `generate_questions.py`, `generate_widget_questions.py`,
  `build_misconceptions.py` (the refutation house style is recorded **only** there),
  `load_generated_questions.py` and `apply_review_verdicts.py`.

Before this revision, none of it appeared in this spec.

**Gaps found**

| # | Gap | Evidence |
|---|---|---|
| G1 | The maths book was never produced by the line. It has no manifest, no saved prompts, no coverage audit, and the Phase C back-audit never ran | §2.2 |
| G2 | Social cannot be reproduced: the run outputs lived in `/tmp`; the flagged-claims list was pasted by hand | `merge_final.py:11-24`, `audit-claims.workflow.js:8` |
| G3 | Every workflow hard-codes an absolute PDF path into the **main checkout** (`docs/Source/*.pdf`, gitignored), plus lesson and offset tables. None of them runs in a worktree or on a new book without editing | `extract-lesson:13`, `rich-lesson:14`, `arabic-lesson:15` |
| G4 | The generated bank does not reproduce from its generator: the family size differs (16 live, default 10) and the run flags were not recorded. The export became the source of truth | `export_generated_content.py` docstring |
| G5 | Widget questions have no parent, despite FR-1101. The graph check is optional | §2.6 |
| G6 | Two misconception catalogues have diverged. `build_misconceptions.py` holds 6 `t2u3-1-2` entries the loaded catalogue lacks, and the loaded catalogue holds 4 entries with no generator source. Id schemes also conflict: `mc:` (shipped) vs `misc:` (schema, refutation workflow). No independent verifier has ever run on a shipped refutation | §2.7 |
| G7 | `refutation.workflow.js` cannot run (`MANIFEST` global) and has never produced output, yet traceability calls FR-304 BUILT on it | §2.7 |
| G8 | **Ingest cost has never been metered.** ADR-0005 says runs are "logged to `ai_interactions`", but Workflow runs write nothing there | ADR-0005 Consequences |
| G9 | `load_seed.py --course` deletes a course's questions, including its generated and widget rows, but **not** its `misconceptions` / `explanation_library` rows. Both reference `graph_nodes` without cascade, so a course refresh after the catalogue is loaded should fail on the node delete (found by reading, not reproduced). If it succeeds, it silently drops the course's generated bank, and `refresh-content.sh` never reloads generated content | `load_seed.py:512-546`, `migrations/009:52,73` |
| G10 | `parity_check.py` is scoped by subject. A second maths course is counted into the Prep-3 fingerprint and turns it RED | `parity_check.py:54,102` |
| G11 | ADR-0005's Stage-7 dossier was never produced for maths. The human review surface covers only generated bundles | §2.8 |
| G12 | The v1 stage table does not match what was built: Stage 0 is hand-written or absent from every workflow; Stage 1 runs on Sonnet (not Haiku→Sonnet); Stage 6 lives outside the workflow; the coverage oracle is an LLM verdict with no integer equalities, except in Arabic | §2.3–2.4 |
| G13 | `VIZ_SPEC.md` documents neither the widget kinds nor the content-file interactives | §2.6 |

**Since this audit (later on 2026-09-25, on the branch, not committed; re-verified 2026-09-25, third
round — §9's Build list is the current state of record):**
- **G7** is closed by retiring `refutation.workflow.js` (B18). It now refuses to run. **Verified.**
- **G8**: `meter_run.py` exists (B16). **Verified.**
- **G9**: `load_seed.py` is add-only by default, and a course reload refuses rather than deleting (B9).
  **Verified.**
- **G10**: `parity_check.py` is scoped per course (B10). **Verified.**
- **G2**: `/tmp` paths are arguments (B20). **Verified** — no code path names `/tmp`.
- **G3**: the book configs and argument-driven workflows are started (B1) — every stage now takes its
  book, manifest and lessons from `args`, with no hard-coded path anywhere in the line. **Verified.**
- **G6** was decided (B19, decision 22) and is now **built and verified**: the six `t2u3-1-2` entries
  are live, the generator is retired, `seed/misconceptions-math.json` is deleted. T423's CI proof
  (loading the catalogue twice into a scratch database) is still to run before this merges.
- **G13**: `VIZ_SPEC.md` was extended.
- **G1**: the maths book still was never produced by this line — that remains true of Prep-3
  regardless of what B1–B21 now do for the *next* book; ADR-0005's Phase C back-audit is still
  outstanding (§7 step 6).
- **G4** and **G5**: the generated bank and widget bank are, respectively, byte-identical to their
  35-family source (B12, verified) and correctly refusing without `--dsn` (B13, verified) — the parts of
  these gaps that were about missing guardrails are closed. Reproducing the *exact* Prep-3 bundles from
  a from-scratch run is still unproven, because nobody has run the full v2 line on Prep-3 (§7 step 6,
  the back-port).
- **G11**: the review-page dossier now has modes for objectives, book questions and the catalogue (B17,
  verified) — this closes the gap for future books; no dossier has been produced for the *existing*
  maths bundles retroactively.
- **G12**: the v1 stage table mismatch is superseded by v2's own stage table (§3.2), which is what every
  new book (including Grade 10) now runs against.

§9 carries each item's state.

---

## 3. The v2 line

### 3.1 Unit of work and book configuration

The unit of work is still **one lesson**. For a chapter-and-section book the lesson is **one
numbered teaching section** (decided, decisions.md B). G0 may split a section into parts, promote a
chapter introduction that teaches, or merge a section that has no practice (§3.3). Each book gets one
committed configuration file, `services/extraction/books/<book>.json`, read by `book_config.py` (B1),
so no workflow ever again hard-codes a path, a lesson table or an offset. The three National books
have theirs. The Grade 10 book's (T303) looks like this:

```jsonc
{
  "config_version": 1,
  "book": "g10-math",
  "course_id": "course:us-g10-math-en",     // specs/003 contracts/pipeline-handoff.md
  "curriculum": "us-american-en",
  "subject": "math",                        // the spine key; never a new one (migration 007)
  "grade": "10",
  "language": "en", "direction": "ltr",
  "id_prefixes": ["g10m"],                  // lesson slug g10m<ch>s<sec>-<part>, see §3.3
  "sources": {
    "pdf":  "docs/Source/Gr10_Mathematics_Learner_Eng_v11.pdf",        // citation authority
    "epub": "docs/Source/Gr10_Mathematics_Learner_Eng_CC-BY.epub",     // structure, prose, worked solutions
    "teacher_pdf": null                     // only where it adds something (decision 19)
  },
  "objectives_mode": "derived",             // "printed" for books with an objectives box (Egyptian)
  "maths_source": "epub-images-md5",        // S0b: equation PNGs named md5(LaTeX), decision 21
  "notation": { "decimal": "point", "pair_separator": "comma" },   // decision 15: normalise
  "sacred_content": false
}
```

The source files are gitignored. The EPUB is currently excluded only by a local
`.git/info/exclude`, so `.gitignore` should gain `docs/Source/*.epub` (S0 report anomaly 15).

### 3.2 Stages

| # | Stage | In | Out | Model | Author ≠ grader | Gate |
|---|---|---|---|---|---|---|
| S0a | **Source adapter** (per book) | EPUB + PDF | `work/<book>/blocks.jsonl`, figure crops, `edition-check.json` | none (deterministic) | n/a | Edition match, or fall back to PDF only |
| S0 | **Manifest** (per book) | blocks | `manifest/<book>.json`: modules → lessons → printed ranges, offset, per-lesson inventory, **each lesson's book provenance** (sections, part *n* of *m*, chapter introduction) | Haiku (box and figure classification only) | n/a | **G0 (human)** — passed for Grade 10, 2026-09-25 |
| S0b | **Maths transcription** (per book) *(new, decision 21)* | the unique equation images | `runs/<book>/maths/`: `{md5 → LaTeX, how accepted}` and the queue of unresolved images | Sonnet ×2 (vision), blind to each other + deterministic hash check + PDF text-layer cross-check | two independent passes | **G0b (human)** for the queue |
| S1 | **Objectives** (per lesson) | lesson blocks + chapter intro and summary + exercises | objectives, each with evidence anchors, plus a map from exercise item to objective | Sonnet ×2 blind + Sonnet reconciler + Haiku evidence check | two blind finders | **G1 (human, per chapter)** |
| S2 | **Claims** (per objective) | lesson blocks, **teacher-only blocks dropped** | definitions, rules, methods and conventions, each citing an anchor and a printed page | Sonnet + deterministic containment + Haiku provenance | provenance by a different agent | |
| S3 | **Book questions** (per lesson) | worked examples, exercise items **with their EPUB worked solutions**, printed answers | questions whose canonical solution is the book's own (printed worked example, or the EPUB worked solution), typed for marking | Sonnet blind re-solve + Haiku typing and tiering; no derivation step | blind re-solve, three-way | G2 |
| S4 | **Visuals** (per lesson) | figure crops (PDF Form XObjects or EPUB PNGs) + claims | parametric VIZ specs from approved kinds only | Sonnet (vision) + Haiku render-compare | yes | |
| S5 | **Misconceptions + refutations** (per objective) | objectives, book questions, S6 and S7 distractors, the book's caution boxes | catalogue in the `load_misconceptions.py` shape | Sonnet author + Sonnet fail-closed verifier | yes | G4 (sample) |
| S6 | **Generated question families** (per objective × tier gap) | objectives, book questions, catalogue | family specs, instantiated deterministically | Sonnet author + deterministic instantiate and verify + Sonnet blind instance grader | yes | **G3 (10% family-stratified)** |
| S7 | **Widget questions** (per objective, per module) | objectives, the predicate contract, catalogue, the graph | widget templates, then widget questions | Sonnet author + deterministic contract and graph checks + Sonnet reachability verifier | yes | with G3 |
| S8 | **Coverage audit** (per lesson and per book) | S0–S7 | `coverage/<book>.json`, integer equalities + oracle | deterministic + Sonnet oracle + Sonnet completeness critic (per chapter) | n/a | must be GREEN or have a signed-off exception |
| S9 | **Assemble** (per chapter) | S1–S7 | `seed/<book>/*.json`, `seed/content/<slug>.json`, `seed/generated/<book>/*` | none | n/a | Pydantic + DAG |
| S10 | **Validate and dry-run** | bundles | `--validate-only`, `--dry-run` delta, parity for **every existing course unchanged** | none | n/a | **G5 (human go / no-go)** |
| S11 | **Load** | approved bundles | DB (`--course`), catalogue, generated bank (`review`, then `--promote` as a separate act) | none | n/a | |

Order and dependencies:
- S0b comes after S0 and before anything that reads maths: S1, S2 and S3 all do.
- S5, S6 and S7 depend on S1 and S3.
- S5 runs first, as a draft. S6 and S7 then add their distractor and predicate misconceptions to
  it, and S5's verifier runs over the final catalogue. This keeps FR-1115's "one error, one entry"
  true across all three sources.
- S2 through S4 fan out per lesson; S5 through S7 fan out per objective.

### 3.3 S0a Source adapter, S0 manifest and S0b maths transcription

*Revised 2026-09-25 from the Grade 10 S0 report (`services/extraction/runbook/g10-s0-report.md`),
which found that the EPUB carries no machine-readable maths and a worked solution for every exercise
item. Decisions 19 and 21.*

**What each format gives.**

| | PDF (learner book v1.1) | EPUB (a September 2015 build of the same text) |
|---|---|---|
| Citation authority | **yes**: printed page numbers | no page mapping at all |
| Structure and prose | text layer, with maths flattened (`25\n45` for 25/45) | clean XHTML, one file per numbered section, `h2`/`h3` codes |
| Maths | Computer Modern glyph runs in the text layer; usable as a cross-check, not as a source | **16,388 equation images, 8,561 unique**, each named `md5(LaTeX)`; no MathML, LaTeX or alt text |
| Exercise answers | the **printed answer appendix** (final answers; 2,270 of 2,531 items) | a **worked solution for all 2,531 items** (`div.solution`) |
| Item identity | per-item shortcodes (1,984) | none; items are identified by (exercise label, question number, sub-part index) |
| Figures | 761 placements as Form XObjects (exact boxes) | 764 PNGs already cropped, plus 231 in solutions |
| Teacher material | none in the body | **32 `div.teachers-guide` notes** addressed to teachers |

**Adapter steps (S0a, B2), all deterministic:**
1. **Hash both files** and register the PDF as the `source_documents` row (the citation authority).
   The EPUB hash goes into the manifest and the extraction run.
2. **Build the PDF page map** from every page's text layer, and read running heads, not bookmarks:
   the back-matter bookmarks point one page early. For Grade 10 there is one regime,
   `printed = PDF − 11`, true on all 497 folioed pages.
3. **Parse the EPUB into typed blocks**:
   - `heading`, `para`, `box`, `figure`, `summary_item`;
   - `worked_example` (with its `workstep`s);
   - `exercise_item` (problem + **worked solution**);
   - **`teacher_only`** (the teacher's-guide notes, which S2 drops: FR-4408);
   - maths kept as **image references** (`equation/<md5>.png`), to be replaced by S0b's accepted
     LaTeX.

   The step "MathML → LaTeX, or the image alt text" in the earlier draft **cannot be built**, because
   neither exists in this file.
4. **Align EPUB blocks to PDF pages** on anchors both formats carry: the 172 section codes (`EMA…`),
   the 78 media codes, worked-example numbers, and exercise labels with question numbers. Worked
   examples and exercises have no EPUB ids, so the manifest uses ordinal locators
   (`file::div.worked_example[k]`).
5. **Figures**: crop each PDF Form XObject's placement (no region detection), or take the EPUB PNG
   directly.
6. **Edition check** (`edition-check.json`), revised:
   - **build markers** of both files (producer, dates, identifiers), recorded rather than required to
     match. The EPUB has no version string, so "same version string" cannot be a rule;
   - **set equality of the 172 section codes and the 78 media codes**. The EPUB has no item
     shortcodes, so "every shortcode" cannot be a rule;
   - section titles and order, worked-example counts per chapter, exercise-set labels, and a seeded
     sample of paragraphs, stems and worked-example questions;
   - printed answers found inside the EPUB solutions wherever they can be tested.

   **The PDF-only fallback hinges on content agreement**, not on how the maths is encoded. For
   Grade 10 the verdict is *same content, different packaging*, so there is no fallback.

**S0b, maths transcription (B21, decision 21).** For each **unique** equation image, deduplicated
(8,561 for Grade 10, not 16,388):
1. **Recover what can be recovered deterministically first.** Hash candidate strings (single symbols,
   and every number in the PDF text layer as `\text{n}`) and keep every exact `md5(latex) == filename`
   match. The S0 report reproduced 583 unique images (30.5% of references) this way.
2. **Two independent vision passes** over the rest, each blind to the other, both at 2× upscale.
3. **Accept** a transcription when `md5(latex)` equals the file name (exact), **or** when both passes
   agree after normalisation.
4. **Cross-check** every accepted transcription's digits and letters against the PDF text layer's maths
   spans, which are identifiable by their Computer Modern fonts (CMMI, CMSY, CMR, CMEX, MSBM).
5. **Queue** every image neither rule accepts, or that the cross-check contradicts, for a human at gate
   **G0b**. Never guess one (FR-4407). A lesson that needs a queued image waits for it.

Long aligned derivations (714 exercise solutions are one image over 100 px tall) will rarely hash
exactly, so they rest on agreement. The report counts acceptance per route (SC-213).

**Grade 10 facts** (from the S0 report):
- 14 chapters and 81 numbered sections: 59 teaching sections, 8 introductions and 14 chapter summaries.
- 174 worked examples, 87 exercise sets and 1,058 questions.
- **2,531 exercise items**, of which 1,187 (47%) sit in end-of-chapter sets that S1 must map to
  lessons.
- The printed answer appendix covers 2,270 items. The 261 without a printed answer are proofs,
  sketches, "represent", "show that" and tables.
- The "Past exam papers" print no answers and are not in the EPUB.
- 764 figures, about 13 per lesson.
- Decimal comma (`3,317`) and `(x; y)` notation throughout.
- §6.8 runs pp.214–233.
- Chapter 2 is numbered differently in the EPUB ("2.5 Exponential equations"). The PDF's numbering
  wins.

**The lesson unit, and G0's decisions for Grade 10.** One numbered section is one lesson (decisions.md
B). Split, promotion and merge rules:
- **Split** a section over 12 printed pages, or one teaching more than 3 separately exercised methods,
  along its own sub-headings.
- **Promote** an introduction that teaches and carries practice.
- **Merge** a section with neither a worked example nor an exercise item into its neighbour: an
  objective needs such evidence (§3.4, rule 1).

**G0, passed 2026-09-25 (Samuel), fixed Grade 10 at 65 lessons:**

| | Change | Result |
|---|---|---|
| P1a | 1.7 Factorisation, split | parts 1–3: common factors, difference of squares and grouping (Ex 1-5, 1-6, 1-7) · trinomials (Ex 1-8) · sum and difference of cubes (Ex 1-9) |
| P1b | 6.6 Trigonometric functions, split | parts 1–3: sine · cosine and comparison · tangent. S1 distributes its one set, 6-6 |
| P1c | 8.3 Gradient of a line, split | parts 1–2: gradient between two points (Ex 8-3) · straight lines (Ex 8-4) |
| P1d | 13.2 Right prisms and cylinders, split | parts 1–2: surface area (Ex 13-2) · volume (Ex 13-3) |
| P1e | 13.3 Right pyramids, cones and spheres, split | parts 1–2: surface area (Ex 13-4) · volume (Ex 13-5) |
| P2a | 6.1 introduction, promoted | lesson `g10m6s1-1` (Ex 6-1, 36 items) |
| P2b | 7.1 introduction, promoted | lesson `g10m7s1-1` (WE 1, Ex 7-1, 19 items) |
| P3a | 1.2 merged into 1.3 | one lesson covering sections 1.2 and 1.3 |
| P3b | 5.2 + 5.3 + 5.4 merged | one lesson covering sections 5.2, 5.3 and 5.4 |
| P3c, P3d | 14.4 + 14.5, 14.6 + 14.7 | **not applied** (optional) |

**Book provenance on every lesson** (decision 18, FR-4311): the manifest and the bundles record, per
lesson, the printed section number(s) and title, and "part *n* of *m*" for a split part. They record
every section of a merged lesson, and the chapter-introduction tag for a promoted introduction. The
app uses this to keep a section's parts together: consecutive order, one recommendation unit, a
roll-up score, one skill-map group, sibling context for Noor, automatic part *n*−1 → *n*
prerequisites, and the printed number on screen. National books carry the same record, with one
section per lesson.

**Ids.** These keep every app rule intact:
- course `course:us-g10-math-en`;
- lesson slug `g10m<ch>s<sec>-<part>`, for example `g10m6s6-2` for part 2 of 6.6. This matches
  `SLUG_RE` in `app/src/lib/lesson-slug.ts:22`. A merged lesson's slug takes the number of its
  **`slug_section`** — the section that carries the practice (a worked example or an exercise), not
  necessarily the first one listed — for example `g10m1s3-1` for the 1.2+1.3 merge takes section 1.3's
  number, because 1.3 is the one with the exercise;
- LO `lo:g10m6s3-1-<n>`;
- module `module:g10m-c06`. It must not start with `module:geo` or `module:t2-`;
- `order_in_parent` is the chapter number;
- questions `q:<lo tail>:we03`, `q:<lo tail>:ex4-2-3b` (with the PDF shortcode, where there is one,
  in `source_note`), `…:g001-<fam>` (generated), `…:w001` (widget);
- misconceptions `mc:<lo tail>:<slug>`, the shipped convention.

**The manifest** (`manifest/g10-math-american.json` for Grade 10) records the following:
- the book, both hashes, the offset regime and its verification;
- modules → lessons, with book provenance, printed range, section codes, worked examples, exercise
  sets with item locators, figures, boxes and printed-answer locations;
- the end-of-chapter items awaiting S1.

**Gate G0** approves the manifest, the lesson unit and the edition verdict before any content stage
runs. **Gate G0b** approves S0b's queue.

### 3.4 S1 Objectives: finding each lesson's objectives in the book

*This is pipeline design (Samuel, 2026-09-25: not to be written as requirements yet).*

This book prints no objectives box. The Egyptian books do (أهداف الدرس), and ADR-0005's
non-negotiable "LOs come verbatim from the printed objectives box" cannot be met here. S1 therefore
**derives** each lesson's objectives from the book and makes every one of them cite where it came
from. For a book that does print objectives (`objectives_mode: "printed"`), S1 transcribes them
verbatim, as before, and skips the derivation.

**The evidence S1 may use.** It uses the book only. The CAPS curriculum document and outside
knowledge are excluded.

| Evidence kind | Example anchor | What it signals |
|---|---|---|
| `heading` | "4.4 Solving simultaneous equations", sub-heading "Solving by substitution" (`EMA…`) | the unit of content |
| `intro` | the chapter's "x.1 Introduction" text | what the chapter says it will teach |
| `summary` | "Chapter summary" bullets (§1.9) | what the book considers the result |
| `definition` | definition and key-concept boxes | the vocabulary an objective must use |
| `worked_example` | "Worked example 3: Converting decimal numbers to fractions", p.10 | a skill **demonstrated** |
| `exercise` | "Exercise 1 – 1", item 9 (`2DBQ`): *"Write the following as fractions"* | a skill **practised**; the instruction verb gives the observable behaviour |

**What each objective record holds:**
```jsonc
{ "id": "lo:g10m1s3-1-2",
  "statement": "Convert a terminating or recurring decimal to a fraction",   // student-can form, the book's terms
  "label": "Decimals to fractions",
  "evidence": [
    {"kind": "heading",        "anchor": "EMA6",           "printed_page": 10, "quote": "Converting terminating decimals into rational numbers"},
    {"kind": "worked_example", "anchor": "WE1.3",          "printed_page": 10, "quote": "Converting decimal numbers to fractions"},
    {"kind": "exercise",       "anchor": "Ex1-1:9 (2DBQ)", "printed_page": 11, "quote": "Write the following as fractions"} ],
  "exercise_items": ["Ex1-1:9a", "Ex1-1:9b", "…"],
  "derivation": "derived", "confidence": "agreed" }
```

**Rules the stage enforces** (the reconciler and the deterministic checker reject violations):
1. **Grounded.** Every objective cites at least 2 evidence items of different kinds, and **at
   least one of them is `worked_example` or `exercise`**. An objective the book never demonstrates
   or practises cannot be assessed and is not emitted. Every quote must appear at its anchor and
   printed page (the Haiku evidence check, after a deterministic substring test on the EPUB
   block).
2. **It partitions the practice.** Every exercise item in the lesson, and every end-of-chapter
   item assigned to it, maps to **exactly one** objective. An item that fits none is reported.
   This map is what S3 and the coverage audit count against.

   **A second, independent mapper checks this map for the chapter-end items** (decision 33,
   2026-09-25, third round: *"Yes, double-check"*). 1,228 of Grade 10's 2,531 exercise items sit in
   end-of-chapter sets a lesson does not directly contain, so a single mapper's assignment is not
   self-evidently right the way an in-lesson item's is. `objectives.workflow.js` already carries the
   option for this (`args.options.second_mapper`, currently `false` — set it `true` for Grade 10, T427).
   A second mapper produces its own item→objective assignment, blind to the first, and any
   disagreement is surfaced at **G1** next to the objectives themselves rather than trusted silently.

   **End-of-chapter items that fit no objective** (decision 36, Samuel's answer 15, 2026-09-26, from
   the Chapter 8 pilot, where both mappers placed Ex8-6:28a, 32e, 40c and 46d nowhere): *"Both"*.
   - **(c) The finders also read the end-of-chapter items in their lesson's scope** (the items whose
     "may go to" includes the lesson), each finder in its own reading order, so a skill practised only
     there can get its own objective. A finder may cite such an item as `exercise` evidence; it never
     lists one in `exercise_items`: the two blind mappers still place every end-of-chapter item.
     Rule 1 is unchanged for such an objective (two kinds of evidence, one of them practice). An
     objective no item ends up mapped to is a decision G1 owes (move an item to it, drop it, or
     acknowledge it). Prompts `s1-v5`.
   - **(b) G1 may rule a distributed item "outside this chapter's objectives"** (`outside_items` in
     the G1 verdicts, with a reason). Rule 2 is relaxed **only** under that named verdict: the item
     maps to no objective, is kept out of practice, is recorded in the lesson records with who, when
     and why, and is listed by the coverage audit (§3.11) as a named exception signed by the G1
     approver. It is never dropped silently; a ruling without a reason, on a lesson's own item, or
     together with a move, fails the chapter.
3. **Book terminology.** The statement uses the book's own terms (for example "gradient",
   "surd", "mid-point"), never a translation into another curriculum's vocabulary. Terms that
   differ from Egyptian usage are **flagged** into `terminology-flags.json` for human review. S1
   does not rewrite them.
4. **Granularity.** 2 to 5 objectives per lesson, the band ADR-0006 §4 settled for Arabic (and
   Prep-3 maths averages 2.6). A verb such as "understand" is replaced by the observable behaviour
   the exercises ask for.
5. **Independence.**
   - Two Sonnet finders derive the list **blind to each other**, with different framings. Finder
     A starts from headings and summary; finder B starts from worked examples and exercises.
   - The reconciler aligns them and labels each objective `agreed` (both found it), `merged`
     (one covers several of the other's) or `single` (only one found it).
   - Every `single` objective and every rule failure goes to the human reviewer at G1.
6. **Order.** Objectives are numbered in the order the book teaches them. `order_in_parent` is
   the position inside the module, following the maths convention `MODULE_ORDER` relies on.

**Output:**
- `objectives/<book>/<lesson>.json`;
- the LO nodes in the bundle: `label`, `description` = statement, `source_page` = first evidence
  page, `syllabus_ref` = the section number. The evidence stays in the objectives file, which
  needs no schema or DB change. Decided (§10 D1): it stays in the files for now;
- a per-chapter review page.

**Gate G1:** before any claim is extracted, a human (Samuel, or whoever owns the teaching
methodology) approves each chapter's objectives. Objectives drive every later stage.

### 3.5 S2 Claims

The maths claim types are:
- `definition`;
- `rule` (a law, identity or theorem as printed);
- `method` (the steps of a procedure, taken from the worked examples);
- `convention` (notation, rounding, units);
- `caution` (the book's own "note" and "important" boxes; these are S5 evidence).

**Teacher-only material is dropped before any claim is made** (decision 21, FR-4408). The EPUB's
`teacher_only` blocks — for Grade 10, 32 teacher's-guide notes such as *"According to CAPS, the
rational exponent law is introduced in Grade 11 …"* — never become a claim, a question, a solution
step or a refutation.

Each claim cites its anchor and printed page and is tied to one objective. It is checked in two
steps:
1. A **deterministic containment test** against the EPUB block, for quoted or near-quoted claims.
2. **Haiku provenance** for paraphrases (the `supported` pass from `extract-lesson`). Anything
   unsupported goes to a Sonnet re-audit, the `audit-claims` pattern, now fed automatically.

`ClaimStep` is generalised (`claim` + `lang`, with `claim_ar` kept as an alias; evidence kinds
extended). Existing bundles must still dump byte-identically (`selfcheck_arabic.py` style).

### 3.6 S3 Book questions: grounded, never solved from scratch

*Revised 2026-09-25 (decisions 19 and 20). The EPUB carries a worked solution for every exercise
item, so the earlier draft's "derive steps to the printed answer" becomes "take the book's own
solution and check it three ways".*

| Source item | Stem | Canonical solution | Answer | `solution_provenance` |
|---|---|---|---|---|
| Worked example | QUESTION, verbatim | SOLUTION steps, verbatim (printed in the PDF) | the book's final line | `book_worked` |
| Exercise item | the item, verbatim (a sub-part expanded with its stem) | **the EPUB worked solution**, transcribed through S0b | the printed answer (appendix) where there is one | **`book_worked_epub`**: a book solution that is not printed in the PDF, which is the citation authority |
| Exercise item, Teacher's Guide adds something | as above | the Teacher's Guide's worked solution, **only where it adds something** the book and its EPUB lack | as above | `teachers_guide` |
| *(books without worked solutions)* | | steps derived to the printed answer from the lesson's methods | printed answer | `answer_anchored`, kept for such books; **not expected for Grade 10** |

- **Three-way verification** (FR-4302). A second Sonnet agent solves each item **blind**, with the
  answer and every solution redacted. The item is `verified=true` only when the blind answer, the
  **printed answer** and the **EPUB solution's final answer** all agree.
  - Any disagreement drops the item to `review`, with all three shown at G2.
  - A printed answer or an EPUB solution the re-solve disputes is **never corrected silently**:
    books have errata, and the human decides.
  - An item with **no printed answer** (261 for Grade 10) is checked against the EPUB solution alone
    and listed at G2. Most of them are proofs or sketches, which become worked examples anyway.
- **Answer typing** (decision 20; FR-4303, FR-4320). Haiku classifies each item's answer, and a
  deterministic check confirms it:
  - `numeric` (after decision 15's normalisation);
  - `choice`: verbal or choice answers ("irrational", "rhombus"). **Multiple choice only here, where
    it is natural.** Distractors come from S5 and S6. The options are the stem's own alternatives,
    the labels of a figure of the item ("Which point lies at (5; −4)?", from `lesson-v4`: each option
    one label; the blind re-solve reads the figure), or the lesson's closed set;
  - `expression`, with its kind (algebraic, factorised, equation, several values, interval,
    inequality or set, coordinates, surd or π, recurring decimal) and **the form the question asks
    for** (factorised, simplest, subject of a formula). This is marked by the app's expression marker
    (specs/003 FR-4320). The key is stored in the marker's canonical form;
  - `not_markable`: proofs, sketches, "show that", "represent", "complete the table". These stay
    **worked examples**, which is teaching material and not a graded question.

  The S0 report's typing of the printed answers is the starting estimate for Grade 10: 267 integer,
  632 more after normalisation, 258 verbal or choice, **1,111 maths expressions**, and 261 with no
  printed answer.
- **Tiering.** Haiku assigns a tier against a written rubric (basic = one method step; standard =
  a multi-step application of one method; advanced = methods combined, a word problem, or an
  end-of-chapter item). Sonnet spot-checks 20%.
- **Source value.** Verbatim book items load as `source='seed'`. `authored` stays for agent-written
  items. `parity_check` counts both as book.

### 3.7 S4 Visuals

- Sonnet looks at each figure crop together with its claims and emits a parametric spec, **only
  from kinds that exist** in `VIZ_KINDS` and the renderer.
- A figure no existing kind can express is recorded in `viz-gaps.json` with its anchor. It is not
  forced into the nearest kind. Likely gaps: hyperbola, exponential and trig graphs
  (`function_graph` is linear and quadratic only), Venn diagrams, box-and-whisker plots, 3-D
  solids, and triangle or quadrilateral scenes (`geo_scene` is circle-centred).
- Haiku compares a render of the spec with the crop.
- New kinds are frontend work plus a `VIZ_SPEC.md` version bump.
- **Volume** (Grade 10): 764 book figures, about 13 per lesson, not the 6 first assumed. Crops come
  from each PDF Form XObject's placement, or straight from the EPUB PNG. S4 costs about twice the first
  estimate (§5).

### 3.8 S5 Misconceptions and refutations, the decided pattern made a stage

**Sources, each cited:**
- book distractors, where the book has multiple choice (few in this book);
- the book's caution and "important" boxes;
- worked-example remarks;
- S6 family distractors and S7 widget predicates;
- the recurring wrong turns the S3 blind re-solves expose.

**Shape:** exactly what `load_misconceptions.py` loads today:
- `id` (`mc:`), `lo_id`, `label`, `description`;
- `signal`, present **only when the error can be recognised from a final answer** (the
  `refutation.workflow.js` rule);
- `kind` ∈ {`book_distractor`, `conceptual`, `generated_distractor`}, with `aliases`;
- `refutation[]`;
- `maps[]`, which stamp choices by exact text.

**Authoring rules:**
- The **house style** from `build_misconceptions.py`: step 1 names the student's thinking without
  calling it stupid, and the last step leaves them with the move that works.
- The refutation argues against **that** error using the canonical method, and must not correct
  the student with a convention the book does not teach (FR-1114).
- At most 4 per objective, and fewer is correct.

**Verification:** fail-closed, the `refutation.workflow.js` design.
- A different Sonnet agent works each refutation against the canonical solutions and returns
  `CONFIRMED`, `CONTRADICTS_CANONICAL`, `UNSUPPORTED` or `UNCLEAR`.
- Anything other than `CONFIRMED` is dropped from the catalogue. The drop is logged, never
  shipped.
- A distractor or predicate whose misconception was dropped loses its tag rather than pointing at
  nothing (FR-1112).

**Output:** `seed/generated/<book>/misconceptions.json`, loaded with `load_misconceptions.py`.

**The catalogue's single source (B19, decision 22, FR-4409).** For the maths catalogue that is live
today:
- **`seed/generated/misconceptions.json` is the single source of truth.** It is the file the product
  loads on every deploy (FR-3214).
- **`build_misconceptions.py` is retired.** Its refutation house style is recorded here: step 1 names
  what the student was thinking without calling it stupid, and the last step leaves them with the move
  that works. It is not a second source.
- **The six `t2u3-1-2` entries** that only the generator held are added to the JSON, each with its
  refutation, **and go live**.
- **`seed/misconceptions-math.json` is deleted.**
- **The export keeps `kind` and `aliases`**, so a round trip through the database loses neither.
- **A live id is never renamed.** Changed wording keeps its id, and a duplicate becomes an alias
  (FR-1115).
- This is live Prep-3 content, so the change passes its tests and a CI proof before it merges: the
  catalogue is loaded twice into a scratch database with no duplicate, the six entries are present,
  and no previous id is missing.

### 3.9 S6 Generated question families, the decided pattern made a stage

**Target** (FR-1109): every objective has at least one live item per tier, counting book and
generated items together. The gap list comes from S3's tiered bank. Volume beyond the floor
follows measured exhaustion, never a quota.

**A family, per ADR-0008, has:**
- one objective;
- one parent book question (`parent_question_id`);
- sampled parameters with constraints;
- a stem template;
- an answer **computed from the parameters**;
- solution step templates computed the same way;
- MCQ distractors as expressions, each with its `misconception_id`.

**Authoring** (decided, §10 D6: a declarative spec): Sonnet writes the family, and code instantiates it
deterministically: the existing `verify()`, rejection of duplicate stems, and `rebalance_keys()`.

**Independent check:** a *different* Sonnet agent solves 3 sampled instances per family blind. If
any computed key disagrees with it, the whole family is rejected. It also judges whether each
distractor really is the mistake it claims to be.

**Word-problem objectives:**
- Contexts are fixed and written into the family; only the numbers vary.
- Where a family cannot be written without nonsense, the stage emits a small set of one-off items
  (`coverage-basics` style), each verified by blind re-solve and each flagged `authored`.

**Loading:**
- `load_generated_questions.py` as today: `review` first, a 10% family-stratified sample
  (`--sample 10 --seed N`), `render_review_page.py`, then `apply_review_verdicts.py` (**gate
  G3**), then `--promote`.
- The family becomes a **field** on each item rather than text parsed out of `source_note`.

### 3.10 S7 Widget questions, the decided pattern made a stage

- **Kind.** For each objective, Sonnet picks a widget kind **from `contracts/widget-predicates.json`**
  if one genuinely fits. Otherwise it records a widget gap.
- **Content.** It writes the stem, the spec, a canonical solution, and the diagnostics: predicate
  → `misconception_id`, likeliest error first.
- **Deterministic checks, all mandatory:**
  - `widget_spec.validate_widget` (predicate names from the contract);
  - reachability (the FR-1207 rule: no target the instrument cannot hit) — `parseMathWidget` and
    `curveReachable` ported for every contract kind, cross-checked against the TypeScript kind by kind;
    two rules are stricter than the app and say so (a `sample_space` event with no outcome, a
    `venn_builder` clue that is not its set's size);
  - the FR-1215 prerequisite rule **against the graph** — S10 runs this on a scratch DB, so
    `--dsn` stops being optional;
  - `parent_question_id` set to the objective's anchor book question, closing G5.
- **Independent check:** a different Sonnet agent solves each widget blind in words ("what
  construction satisfies this?"). It confirms the target is reachable and that every predicate's
  misconception is the error that construction reveals. **Decision 47 (specs/003 FR-4306):** an
  unreachable target, a stem that reads otherwise, or no verdict refuses the template; a mapping the
  checker does not confirm is **held** (`choices.pending_review`, with its reason) — inactive: never
  shown, never a diagnosis, never S5 evidence — until a human keeps or drops it on the G3 held-mappings
  page (`render_review_page.py --gate g3-mappings`, exported as `--mapping-review`).
- **Coverage:** at least one widget per module (FR-1201), or a signed-off **widget gap report**.
  The 11 Prep-3 kinds were built for Prep-3 topics; the six kinds of decision 27 (polygon_builder,
  solid_scaler, box_plot_builder, venn_builder, area_model, curve_sketcher's five G10 families) are
  app components outside this line, registered for it with the instrument text the tutor is given
  (`widget-docs.ts`), their reachability rules and their blind-reading fields (`s7-v5`).
- **Output:** the same row shape as today, loaded through the same loader and review gate.

### 3.11 S8 Coverage audit

**Integer equalities**, computed by `coverage_report.py`:

| Check | Must equal |
|---|---|
| Body pages in the manifest | the pages assigned to lessons + the pages excluded with a reason |
| Worked examples in the manifest | worked-example book questions + those excluded with a reason |
| Exercise items (including end-of-chapter) | items mapped to exactly one objective; the unmapped count must be 0, except an end-of-chapter item G1 ruled "outside this chapter's objectives" (decision 36, answer 15 (b)): it is listed as a named exception signed by the G1 approver, and the audit is GREEN for it only because of that verdict |
| Mapped exercise items | book questions + items excluded with a reason (no printed answer, ungradable type, disputed) |
| Objectives | objectives with ≥ 1 claim, ≥ 1 book question, and ≥ 1 worked-example or exercise evidence |
| Objectives × tiers | cells with ≥ 1 item, book or generated (FR-1109) |
| Modules | modules with ≥ 1 widget question + widget gaps signed off (FR-1201) |
| Distractors and predicates carrying a misconception | those whose misconception has a refutation (FR-1112) |
| Figures in the manifest | visuals + viz gaps with a reason |
| Unique maths images (S0b) | accepted by hash + accepted by agreement + resolved at G0b; the unresolved count must be 0 |
| Exercise items | `numeric` + `choice` + `expression` + `not_markable` (each item typed exactly once) |
| Book questions by solution source | `book_worked` + `book_worked_epub` + `teachers_guide` (+ `answer_anchored`, expected 0 for Grade 10) |
| Lessons | lessons carrying book provenance; each split section's parts consecutive and numbered 1..*m* |
| `teacher_only` blocks | blocks dropped at S2; the count reaching a claim must be 0 |

**On top of the equalities:**
- the per-lesson **coverage oracle** (Sonnet) compares each sub-heading's content with the claims
  and questions produced (the "Africa detector");
- a per-chapter **completeness critic** asks what the whole run missed (the
  `arabic-book-review` pattern).

A RED audit blocks assembly unless a human signs the exception into the coverage file.

### 3.12 S9–S11 Assemble, validate, load

**Assemble.** `assemble_lesson_bundle.py` writes one bundle per chapter to `seed/<book>/`, with:
- the source document (the PDF) and the EPUB hash in the manifest and extraction run;
- `external_node_refs` to the course node;
- normalisation of notation per the book config (§10 D5: decimal point, `(x, y)`; contexts kept);
- `seed/content/<slug>.json` for the read surface, if the app should show exposition (§8,
  assumption 4).

Generated artefacts go to `seed/generated/<book>/`.

**Validate** on a scratch database:
1. `load_seed.py --validate-only`.
2. `load_seed.py --all --course <new course> --dry-run`, then the real load.
3. `load_misconceptions.py --dry-run`, then the real load.
4. `load_generated_questions.py` (lands at `review`, draws the sample).
5. `generate_widget_questions.py --dsn` (graph checks).
6. `parity_check.py` **once per existing course**: Prep-3 maths still at 10 / 90 / 112 / 450 /
   212, and the new course against the counts its manifest expects.

**Gate G5:** Samuel sees the dry-run delta, the coverage report, parity for every course and the
review verdicts, and says go or no-go.

**Load in production** (decision 17; specs/003 FR-4208, FR-4210, `contracts/load-course.md`):
- **A new course** goes through the manually started **"Load a course"** GitHub action
  (`.github/workflows/load-course.yml` → `deploy/load-course.sh`). It checks the **course's own
  presence**, not a count, and does nothing if the course is there. It takes a `pg_dump` backup,
  **verifies it reads back**, and prints the one-line rollback. Then it runs:
  1. `load_seed.py --all --course <id> --if-absent`, which only adds rows;
  2. `load_misconceptions.py` for the book's catalogue;
  3. `load_generated_questions.py --restore` for the reviewed exports.

  Afterwards it runs `parity_check.py` for every course, and confirms that **no visibility rule** was
  written: the course stays hidden until an operator switches it on. It is never part of a deploy.
- **A change to a course that is already loaded** goes through `refresh-content`, retargeted to noor's
  stack. A reload **refuses** rather than deleting student data, a misconception or an explanation
  (`load_seed.py --replace`, B9).

### 3.13 Human gates

| Gate | When | Who | What they see | What they decide |
|---|---|---|---|---|
| **G0** | after S0 | Samuel | the manifest, the lesson split, the edition check, the offset regimes | Approve the lesson unit; approve PDF-only fallback if the formats disagree. **Grade 10: passed 2026-09-25, 65 lessons** (§3.3) |
| **G0b** | after S0b | Samuel, or someone he names | every equation image neither pass nor the hash accepted, or the cross-check contradicted | Supply the LaTeX. Nothing is guessed |
| **G1** | after S1, per chapter | Samuel or the methodology owner | objectives with evidence, `single` and disputed objectives, terminology flags | Approve, edit or drop objectives |
| **G2** | after S3 | Samuel (there is no maths SME) | every three-way disagreement (printed answer, EPUB solution, blind re-solve), every item with no printed answer, and a 10% sample of `book_worked_epub` solutions | Accept, fix or exclude |
| **G3** | after S6 and S7 | Samuel | the 10% family-stratified sample (`render_review_page.py`) | `accept` / `fix` / `reject` (reject retires the family) |
| **G4** | after S5 | Samuel | every dropped refutation (count only) and a 10% sample of kept ones | Accept, or send back |
| **G5** | before S11 | Samuel | the dry-run delta, coverage, parity for all courses, the cost ledger | Go / no-go. Promotion follows the ADR-0019 note (§10 D7): switching the course on is the gate |

---

## 4. Substrate

- **Stay on Claude Workflow** (ADR-0005 decision 4), with every workflow reading its book, lessons
  and manifest from `args` and never from hard-coded constants or injected globals.
- Workflows cannot write files, so each run's return value is saved by the operating session to
  `services/extraction/runs/<book>/<stage>/<runId>.json` and **committed**, as the Arabic runs
  are. This fixes G2: every bundle becomes a replay of committed run outputs through committed
  assemblers.
- Resume uses the Workflow's `resumeFromRunId`: same script and same args mean a cache hit.
- Deterministic stages (S0a, S0 minus classification, instantiation, S8 equalities, S9–S11) are
  Python under `uv`.
- **When to leave Workflow.** With a fourth book arriving, ADR-0005's "harden into a Python
  service when we ingest many books" is close. The trade (§10 D9, decided (a): stay on Workflow for now):
  - an API harness gets exact per-call token metering and the Batch API (50% off every token);
  - it costs the build of a harness;
  - it loses the Workflow progress UI and resume.

## 5. Models and cost (API-equivalent, per lesson)

Prices checked on 2026-09-25 against the `claude-api` reference, per million tokens:

| Model | Id | Input | Output | Cache read | Cache write |
|---|---|---|---|---|---|
| Haiku 4.5 | `claude-haiku-4-5` | $1 | $5 | 0.1× input | 1.25× (5-minute TTL) |
| Sonnet 5 | `claude-sonnet-5` | $2 | $10 | 0.1× input | 1.25× (5-minute TTL) |
| Opus 5 (only the PDF-only fallback, for disputed maths transcription) | `claude-opus-5` | $5 | $25 | | |

**Assumptions** (first draft; the Grade 10 S0 report's measured volumes follow the table):
- A lesson is about 8 printed pages, 3 worked examples, 30 exercise sub-items, 6 figures and 3
  objectives.
- Each agent call carries about 15k tokens of overhead.
- The EPUB text of a lesson is about 12k tokens.
- A PDF page given to the model as a page is about 2.5k tokens. **This is an estimate; S0 measures
  it with `count_tokens` on 3 pages.**

| Stage | Model(s) | Calls per lesson | ≈ $ per lesson |
|---|---|---|---|
| S0a Source adapter | none | 0 | 0.00 |
| S0 Manifest | Haiku (about $0.50 per book) | n/a | 0.01 |
| **S0b Maths transcription** *(new; revised 2026-09-25, third round)* | Sonnet (vision) ×2 blind + reconcile, once per book: about 1.7M image tokens and 0.5M LaTeX tokens per pass, plus a third reading (decision 32) whenever the first two disagree | per book | **$24–44 per book**, depending on the batch setting (§4's Batch-API option); the exact figure is fixed after the Chapter 8 pilot measures how often a third reading is needed |
| S1 Objectives | Sonnet ×2 blind, Sonnet reconcile, Haiku evidence | 4 | 0.30 |
| S2 Claims | Sonnet, deterministic containment + Haiku provenance | 2 | 0.20 |
| S3 Book questions | ~~Sonnet derivation (batched ×3)~~ (dropped: the EPUB supplies the solutions), Sonnet blind re-solve (×3, about 1.4× the items), Haiku typing and tier | 5 | 0.55 |
| S4 Visuals | Sonnet (vision), Haiku render-compare — about 13 figures per lesson, not 6 | 2 | **0.30** |
| S5 Misconceptions + refutations | Sonnet catalogue, Sonnet refutations, Sonnet verify | 3 | 0.30 (per lesson; see below for the per-objective figure) |
| S6 Generated families | Sonnet author, Sonnet blind instance grader | 2–4 | 0.25 |
| S7 Widget questions | Sonnet author, Sonnet reachability verifier | 2 | 0.12 |
| S8 Coverage | deterministic, Sonnet oracle, chapter critic amortised | 1–2 | 0.12 |
| S9–S11 | none | 0 | 0.00 |
| **Total** | | **about 25** | **≈ $2.0** |

**Totals and reading of the estimate** *(revised 2026-09-25, decision 21, from the S0 report §6)*:
- Measured volumes for Grade 10:
  - 65 lessons, and 2,531 items (about 43 per lesson once the end-of-chapter items are spread);
  - 764 figures (about 13 per lesson);
  - 6.4 pages per lesson;
  - 8,561 unique maths images.
- Per lesson: about **$3.2**, with S4 doubled and S1 enlarged by the end-of-chapter mapping. Dropping
  S3's derivation step roughly cancels the extra re-solves.
- **Revised again, 2026-09-25, third round (decisions 31–32):** misconception verification runs **per
  objective** (decision 10, "per topic"). This section first said "$22–32 **per objective**" for S5: a
  **mislabel** (corrected 2026-09-26) — $22–32 was the S5 estimate for the **whole book** (it sits inside the
  $220–260 book total below; per objective it would have been $3,700+ for ~170 objectives). The Chapter 8
  pilot measures S5 at **≈ $0.70 per objective** (draft + final, dry meter calibrated ×5.5–6.3 against the
  pilot's real runs), ≈ $120 projected for the book. S0b is **$24–44 per book**, depending on the Chapter-8-pilot's
  batch-setting decision (above), not the earlier fixed $20–25.
- **The total for Grade 10 was planned at about $220–260 one-time**, including S0b and the S5 figure.
  Earlier drafts said $120–190, then $210–230. **The Chapter 8 pilot's meter replaces it (2026-09-26):
  ≈ $0.85–1.1k one-time** — S0b $250–520 (batch 50 vs 25), S1 ≈ $93, S2–S4 ≈ $146, S5–S7 ≈ $350
  (S5 ≈ $120 of it) — projected from the pilot's measured runs and the dry meter calibrated ×5.5–6.3
  (`docs/WIP-g10-pilot/pilot-report.md`, "Cost: calibrated projection").
- The PDF-only fallback is not needed for Grade 10. It would have cost $30–90 per book.
- Batch pricing (§10 D9 option b) would lower S0b toward the bottom of its $24–44 range. The decision is
  to stay on Workflow.
- This sits above ADR-0005's $1–2 envelope because objectives, generated families, widgets and
  misconceptions are now inside the line. Samuel's standing call is quality over cost, with the
  meters on.
- The cost is one-time per book, not per student.

**The meter (fixes G8; B16, on the branch).** `meter_run.py` finds a Workflow run's record and each
agent's transcript under `~/.claude/projects/…`. It de-duplicates API calls by message id, prices
input, cache writes, cache reads and output with the table above, and appends one line per run to
`runs/<book>/cost.jsonl`. The commands:
- `record --book <book> --stage <S#> --run <wf_id> [--lesson <slug>] [--dry-run]`;
- `summary --book <book> [--by stage|phase|lesson|model|agent|run]`;
- `list-runs [--name <workflow>]`;
- `prices`.

Per-call usage is present in the transcripts (verified 2026-09-25 on this repository's own runs). An
agent with no usage is counted from its text and flagged `estimated`; a missing transcript marks the
run incomplete. A resumed run is never billed twice. G5 shows the ledger.

## 6. QA gates (points to check)

v1's twelve points, with these changes and additions:

1. The manifest covers every table-of-contents section. Ranges are contiguous, and every body page
   is either assigned to a lesson or excluded with a reason.
2. The printed-to-PDF offset is verified on **every** page's text-layer number, not on 3 anchors.
   Regimes are recorded and exceptions listed.
3. *(changed)* **Printed objectives:** every printed objective becomes an LO, and none is invented.
   **Derived objectives:** every objective satisfies the §3.4 rules. It passes dual-blind
   agreement or is approved at G1.
4. The coverage oracle is backed by the §3.11 integer equalities.
5. Provenance: every anchor and page contains its quote or claim.
6. *(changed 2026-09-25)* **Three-way agreement** before `verified=true`: the blind re-solve, the
   printed answer and the EPUB worked solution's final answer. An item with no printed answer agrees
   with its EPUB solution and is listed at G2.
7. Faithful to the book: no fact is absent from its cited page, and no answer is used that the book
   does not print unless it is flagged.
8. Pydantic + DAG validation passes, and existing bundles still dump byte-identically.
9. *(changed)* **The source's own terminology**: Egyptian ministry wording for the Egyptian books,
   the printed term for this one. Divergences from Egyptian usage are flagged, not rewritten. Maths
   renders LTR inline.
10. *(changed)* The cost ledger is present for every run. There is no numeric ceiling
    (constitution VI).
11. `relates_to` bridges are preserved across reloads.
12. *(strengthened)* An idempotent `--course` reload leaves every other course untouched, and
    **`parity_check.py` is GREEN for every existing course**. A reload is add-only by default and
    **refuses**, saying what would be lost, rather than deleting student data, misconceptions,
    explanations or generated questions (G9, B9).
13. *(new; revised 2026-09-25)* **Edition check**: build markers recorded; section codes and media codes
    set-equal; titles, worked examples and exercise labels agree; the fallback turns on content
    agreement, not on the maths encoding.
14. *(new)* **Every generated item names its parent**, widgets included. Every family has passed
    its blind instance grader.
15. *(new)* **One error, one entry** (FR-1115) across S5, S6 and S7. Every tagged distractor or
    predicate has a refutation (FR-1112). Every refutation is `CONFIRMED` by a different agent.
16. *(new)* Every run output is committed under `runs/`, and every bundle is reproducible from run
    outputs plus assemblers.
17. *(new, decision 21)* **Every unique maths image is transcribed**, accepted by hash or by two-pass
    agreement and cross-checked against the PDF text layer, or resolved at G0b. None is guessed.
18. *(new, decision 21)* **No teacher-only block reaches a claim**, a question, a solution or a
    refutation.
19. *(new, decisions 18 and 20)* Every lesson carries its book provenance, with a split section's parts
    consecutive and numbered 1..*m*. Every exercise item is typed exactly once for marking.

## 7. Rollout for Grade 10

1. **G0 on the whole book.** S0a and S0 run for the whole book first; nothing else starts before
   G0. **Done 2026-09-25**: S0a and S0 were scouted by hand (`runbook/g10-s0-report.md`). G0 passed at
   65 lessons. B2 and B3 must reproduce that manifest.
2. **S0b on the whole book**, then G0b for its queue. Every later stage reads maths.
3. **Prove the line on one chapter end to end, S1 to S11.** Proposed: Chapter 8, Analytical
   geometry. It is 4 sections (5 lessons, since §8.3 splits at G0), maps onto existing widget kinds
   (`line_drawer`, `pair_plotter`) and VIZ kinds (`coordinate_plot`), and mostly has numeric
   answers the app can grade.
4. **Fan out.** Run S1 with G1 per chapter, then S2–S8 per lesson, then S5–S7 per objective.
5. **Assemble, run G5 once, load** through the "Load a course" action (§3.12).
6. **Back-port where it pays.** Run S8's equalities, S5's fail-closed verifier and S7's graph check
   over the Prep-3 maths bank: this is ADR-0005's Phase C, still outstanding.

## 8. Assumptions from the Egyptian books that this book breaks

| # | Assumption | Where it is baked in | What breaks |
|---|---|---|---|
| 1 | Objectives are printed (أهداف الدرس) and copied verbatim | ADR-0005 non-negotiables; `rich-lesson.workflow.js:96`; `arabic-lesson` SEGMENT | There is no box. §3.4 derives them (§10 D1, decided: #12) |
| 2 | One PDF is the only source, and one `source_document` per bundle | `schemas.SourceDocument`, `load_seed.resolve_source_docs` | The EPUB is a second source. It is recorded in the manifest and the extraction run; the bundle cites the PDF |
| 3 | Offsets are found by hand from 3 anchors, and hard-coded in each workflow | `rich-lesson:17`, `arabic-lesson:17-24`, `extract-lesson:14`, `geometry-structure.md` | Computed per page by S0a and read from the manifest |
| 4 | Prompts, schemas and content files are Arabic-shaped | `ClaimStep.claim_ar`, `KeyTerm.term_ar/definition_ar`, `evidence_kind` enum (`schemas.py:79-86,821`); `lesson-content.ts` fields `*_ar` and "Arabic prose"; Arabic `RULES` in the Social and Arabic workflows | English maths needs a generalised claim and content shape. Changing the app's content types is not pipeline work |
| 5 | A lesson is an LO-id prefix; the default lesson is `u1-1`; titles come from a hard-coded map | `lesson-slug.ts:20-22`, `lesson.ts:100` `LESSON_TITLES` | The ids in §3.3 satisfy `SLUG_RE`. Titles must come from the LO or module label, which is the app's fallback today |
| 6 | Term rank is inferred from module ids `module:geo%` / `module:t2-%` | `app/src/lib/module-order.ts:98-100` | This book has no terms. `module:g10m-cNN` gets rank 0 and orders by chapter number, which is correct, **provided** no module id ever starts with `module:geo`. Chapters 7/12 (geometry) and 5/11 (trigonometry) are split on purpose and must stay in chapter order |
| 7 | One course per subject | `subjects.ts:126-129` (`SUBJECTS.math.courseId`), `load_seed.COURSE_SUBJECTS`, `parity_check.COURSE_SUBJECT='math'` | A second maths course either has no subject (loaded as UNFILED) or turns Prep-3 parity RED. **Owned by specs/003-curriculum-tracks**; `parity_check` moves to course scope (B10) |
| 8 | Three courses, one generated bank | `local-dev.sh:179` (`≥ 3` courses), `ci-cd.yml:620-626` (fixed course list), `:657` (`GEN ≥ 590`), `:664` (`MC < 90`); `export_generated_content.py` exports everything | A fourth course is never loaded on first boot. The generated bank of a new book is never deployed (§3.12) |
| 9 | Answers are a decimal-point number, or an exact string, or an MCQ key | `app/src/app/api/attempts/route.ts:39-62` | The book prints `3,317` and `(x; y)`. 1,111 answers are maths expressions and 261 have no printed answer (proofs, sketches). **Decided:** notation normalised (#15), and an expression marker built in the app this cycle (#20, specs/003 FR-4320) |
| 10 | Book questions are agent-written "original variants" (`source='authored'`) | every maths `source_note` | Verbatim book items become `source='seed'` |
| 11 | Canonical solutions exist, or are written by the extracting agent | Prep-3 practice | The learner PDF prints final answers only, but **the EPUB carries a worked solution for every item**. **Decided:** those are the canonical solutions, `book_worked_epub` (#19, §3.6) |
| 12 | 11 widget kinds and 9 maths VIZ kinds cover the syllabus | `contracts/widget-predicates.json`, `VIZ_KINDS` | G10 functions, Venn diagrams, box plots, 3-D measurement and triangle geometry need new kinds (frontend) |
| 13 | Sacred-content lane | `load_seed.sacred_gate`, `variant_engine.assert_variable` | Not applicable (`sacred_content:false`). It still runs and passes trivially |
| 14 | Egyptian context in word problems and in the tutor | Prep-3 books; `MATH_EN_CONTRACT` | Finance uses the Rand and South African contexts. **Decided:** kept as printed (#15) |
| 15 | The misconception catalogue is mined from book multiple choice | `build_misconceptions.py` (250 book MCQs; retired by B19) | This book has little multiple choice. Sources shift to caution boxes, family distractors, widget predicates and re-solve errors (§3.8) |
| 17 | The book's text carries its maths | every workflow reads page text | The EPUB's maths is images named `md5(LaTeX)`; S0b transcribes them (#21) |
| 18 | The book's text is all for students | — | The EPUB carries 32 notes addressed to teachers; S2 drops them (#21, FR-4408) |
| 16 | $1–2 per lesson | ADR-0005 | About $3.2 per lesson with the new stages, and about $210–230 for the Grade 10 book including S0b (§5) |

## 9. Build list

**Sizes:** S ≤ half a day, M = 1–2 days, L = 3–5 days. **State, revised 2026-09-25 (third round)**:
every item below was **verified** the same day — read in full, its own tests confirmed real (not
stubs) and run (`uv run --project services/extraction --with pytest python -m pytest -q
services/extraction/tests`: 272 passed, 47 skipped without a database, 0 failed). **Verified** means
exactly that: the code and its unit tests are real and pass. It does **not** mean the stage has been
run end to end against the actual Grade 10 book — that is the Chapter 8 pilot (§7), still to come — and
it does **not** mean the code is committed: everything below is still on
`feat/003-curriculum-tracks-g10-american-math`, uncommitted. Spec 003's `tasks.md` carries each item as
a task (T331–T349, T418–T422), ticked where verified.

**Pipeline** (`services/extraction/**`):

| # | Change | New or changed | Size | State |
|---|---|---|---|---|
| B1 | `books/<book>.json` book config + `book_config.py` reader. Workflows take everything from `args` | new | S | **verified** for all four books (`tests/test_book_config.py`) |
| B2 | `source_adapter.py`: EPUB parse into typed blocks, with **maths as image references** (no MathML exists) and a **`teacher_only`** block type; the PDF page map from the text layer and running heads; block alignment on section codes, media codes, worked-example numbers and exercise labels; item ids by (label, question, sub-part); figure crops per Form XObject or the EPUB PNG; the **revised edition check** (§3.3 step 6); the PDF-only fallback on content disagreement only | new | L | **verified** (`tests/test_source_adapter.py`, 324 lines, incl. a `Grade10Outputs` check against real S0a output) |
| B3 | `build_manifest.py`: S0 from blocks, the lesson unit with G0's splits, promotions and merges applied, **each lesson's book provenance**, the per-lesson inventory, a manifest review page | new | M | **verified**; `tests/test_build_manifest.py` proves it reproduces the committed, G0-approved manifest byte for byte |
| B4 | `runbook/objectives.workflow.js`: two blind finders, reconciler, Haiku evidence check | new | M | **verified** — real S1 Find/Reconcile/Map/Evidence phases, `args.options.second_mapper` already present (off; decision 33 turns it on, T427) |
| B5 | `assemble_objectives.py` + the objectives review page (rules 1, 2 and 4 of §3.4 checked deterministically) | new | M | **verified** (`tests/test_objectives.py`, rules 1/2/4/5 each have their own test) |
| B6 | `runbook/lesson.workflow.js`: S2 (claims; teacher-only blocks dropped), **S3 with the EPUB worked solutions as canonical and three-way verification**, answer typing for the marker, S4 visuals, S8 oracle, all from `args`. Existing workflows untouched | new | L | **verified** (`tests/test_lesson_workflow.py`) |
| B7 | `schemas.py`: generalise `ClaimStep` (`claim`, `lang`, extended `evidence_kind`, `claim_ar` alias); `Question.solution_provenance` (`book_worked`, **`book_worked_epub`**, `teachers_guide`, `answer_anchored`); an **answer type** with its asked-for form; **lesson book provenance**; `Misconception.id` accepts `mc:`; `family` as a field. Existing bundles byte-identical (self-check) | changed | M | **verified**, incl. `test_the_arabic_selfcheck_stays_at_100_percent` |
| B8 | `assemble_lesson_bundle.py`: run outputs → per-chapter `SeedBundle` + content files; id minting; notation normalisation per config (decision 15); lesson provenance written | new | M | **verified** |
| B9 | `load_seed.py`: course maps from book configs; **add-only by default**; `--if-absent` (the "Load a course" contract); `--update` refuses to change what an attempted question asks; **`--replace` refuses the whole load, saying what would be lost**, when student data, the misconception catalogue, generated questions or another course still reference what it would prune. **It never deletes or rewrites a student row, a misconception or an explanation.** Accepts `source='seed'`; a full unscoped reload refuses while real students exist unless `--wipe-students` | changed | M | **verified** (`tests/test_load_seed.py`) |
| B10 | `parity_check.py --course` / `--all-courses`: fingerprint and `EXPECTED` per course, `source_sha` per course (G10) | changed | S | **verified** (`tests/test_parity_check.py`, `@covers FR-4207`); the G10 constant is recorded after G5 |
| B11 | `runbook/misconceptions.workflow.js` (S5, fail-closed, `mc:` ids, reads `args`) + `assemble_misconceptions.py` (writes the `load_misconceptions.py` shape; one-error-one-entry merge across S5, S6 and S7) | new | M | **verified** |
| B12 | S6 families, **option A (decided, #16)**: a declarative family spec + a safe evaluator in `generate_questions.py` (`--families <dir>`; the 35 Python families unchanged) + `runbook/families.workflow.js` (author + blind instance grader) | new + changed | L | **verified** — `families/evaluator.py` never calls `eval`/`exec`/`compile`, parses with `ast.parse`; `tests/test_family_reproduction.py` proves the 35 hand-written families are byte-identical |
| B13 | `generate_widget_questions.py --templates <dir>` (JSON templates), `--dsn` **required**, `parent_question_id` set, widget-gap report (new kinds go to Samuel first, #11) + `runbook/widgets.workflow.js` | changed + new | M | **verified** — `--dsn` genuinely refuses (exit 2) without it |
| B14 | `coverage_report.py`: the §3.11 integer equalities, including S0b, answer typing, solution sources, lesson provenance and teacher-only blocks | new | M | **verified** (`tests/test_coverage_report.py`) |
| B15 | `export_generated_content.py --course`, per-book `seed/generated/<book>/`, **`kind` and `aliases` kept on export** (#22), course-scoped counts in `load_generated_questions.py` / `load_misconceptions.py` | changed | S–M | **verified** — `--course` and course-scoped SQL both confirmed |
| B16 | `meter_run.py`: cost ledger from Workflow transcripts (G8) | new | S–M | **verified**, all four subcommands (`tests/test_meter_run.py`) |
| B17 | `render_review_page.py`: dossier modes for objectives, book questions (three-way disagreements) and the catalogue | changed | M | **verified** — `--gate {g1,g2,g3,g4}` |
| B18 | Retire `refutation.workflow.js` and `assemble_refutations.py` in favour of B11 (G7). FR-304's traceability row corrected (2026-09-25) | changed | S | **verified**: both refuse to run without `allow_retired` |
| B19 | **The catalogue's single source (decided, #22)**: `seed/generated/misconceptions.json` is the source; `build_misconceptions.py` retired; the six `t2u3-1-2` entries added and live; `seed/misconceptions-math.json` deleted; no live id renamed; tests + a CI proof (§3.8) | changed | S | **verified** — the six entries are in, `seed/misconceptions-math.json` is actually gone (`git status`), `tests/test_misconception_catalogue.py` covers it; **T423's CI proof is still to run before this merges** |
| B20 | `merge_final.py` / `assemble_fullbook.py`: `/tmp` paths become arguments (Social hygiene, G2) | changed | S | **verified** — no code path names `/tmp` (`tests/test_pipeline_paths.py`) |
| **B21** | **S0b maths transcription (#21, amended by decision 32's third reading)**: `runbook/transcribe-maths.workflow.js` (two blind vision passes over unique equation images) + `assemble_maths.py` (hash acceptance, agreement, PDF text-layer cross-check, the G0b queue, counts) | new | M | **verified** for the two-pass design (`tests/test_assemble_maths.py`, `@covers FR-4407`); **the third-reading rule and the EPUB-only image rule (decision 32) are not yet built — T433** |

**Outside the pipeline** (specs/003, owned by the app agents):
- the course registry with more than one course per subject (`lib/courses.ts`, `COURSE_RANK`), which
  is on the branch;
- the per-course "load if absent" in `local-dev.sh`, and the first-boot gates in `ci-cd.yml`;
- the **"Load a course"** action and `refresh-content` on noor (FR-4208, FR-4210);
- the **maths-expression marker** in `api/attempts` (FR-4320): equivalence, form checks, and decision
  15's normalisation on input. Multiple choice only where natural;
- **book-section grouping** in the app (FR-4311…FR-4319): the lesson-provenance store, progression,
  roll-up, skill map, Ask context and console;
- the lesson-content types (`lesson-content.ts`, `*_ar` fields);
- new VIZ renderers and new widget components with their contract entries, **each approved by Samuel
  first**.

## 10. Decisions — taken 2026-09-25

The options below were put to Samuel on 2026-09-25. His answers: *"I would take your
recommendations"*, then, after G0 and the S0 report, *"ok for all"*. The record is
`specs/003-curriculum-tracks/decisions.md`; the ADR is ADR-0005's 2026-09-25 amendment.

| # | Question | Decided |
|---|---|---|
| D1 | Derived objectives for books without an objectives box | **(a)**: derived per §3.4, with dual-blind agreement and G1; at least two kinds of evidence (#12). Pipeline policy, not an FR. The evidence stays in `objectives/` files for now |
| D2 | Lesson unit | **(a)**: one numbered section = one lesson (B). **G0 applied P1a–e, P2a–b, P3a–b: 65 lessons**; P3c/d not applied |
| D3 | Canonical solutions for exercises | ~~(a) answer-anchored derivation + (b) Teacher's Guide~~ (#13), **amended by #19**: the **EPUB's worked solutions** are canonical (`book_worked_epub`), blind re-solved against the printed answer and the EPUB solution; the Teacher's Guide only where it adds something |
| D4 | Items the app cannot grade | ~~multiple choice where natural, the rest as worked examples~~ (#14), **amended by #20**: a **maths-expression marker** is built in the app this cycle; multiple choice only where natural; proofs and sketches stay worked examples |
| D5 | Notation and context | **(a)**: decimal comma → point and `(x; y)` → `(x, y)`; vocabulary and word-problem contexts (the Rand) kept as printed (#15) |
| D6 | How S6 families are authored | **(a)**: declarative spec + safe evaluator; can be regenerated; no generated code executed (#16) |
| D7 | Review posture for this book | ADR-0019 covers the G10 course; switching the course on in the console is the gate (#9). The 10% sample is still drawn |
| D8 | The book | Confirmed: Siyavula *Everything Maths* Grade 10 v1.1, written for South Africa's CAPS curriculum, named the "Grade 10 American Curriculum, Math" (#3) |
| D9 | Substrate | **(a)**: stay on Workflow, with `meter_run.py` (C) |
| D10 | *(flag only)* | Licensing and attribution are outside this spec and outside the app; routed to Samuel's team. The design does not depend on the answer |
| D11 | Maths source (new) | **S0b**: transcribe the unique equation images with two blind passes, accepted by hash or agreement, cross-checked against the PDF text layer; the edition check uses build markers plus section and media codes (#21). About $210–230 for the book |
| D12 | The misconception catalogue (new) | **B19** as recommended (#22) |

---

## Appendix A: the v1 stage table (approved 2026-07-21, ADR-0005)

| # | Stage | In | Out | Model | Gate it enforces |
|---|---|---|---|---|---|
| 0 | Segment / TOC (once per book) | PDF TOC + openers | `manifest`: units → lessons → **printed page ranges** + printed↔PDF **offset** | Haiku | Fixes each lesson's full span up front (the Africa firewall) |
| 1 | Outline / LO (per lesson) | pages + **أهداف الدرس box** | LOs + module/topic + key_terms + **coverage checklist** | Haiku→Sonnet | LOs verbatim from the printed objectives box, not invented |
| 2 | Claim extraction (per LO) | that LO's pages | `ClaimStep[]` (evidence_page + facts) | Sonnet | Faithful to the book; every claim cites a page |
| 3 | Question gen (per LO × tier) | LO + claims | questions + canonical solutions | Sonnet (variants Haiku) | Grounded in claims, never solved from scratch |
| 4 | Visual specs (per LO) | LO + claims | parametric map_scene / timeline / flow_chain | Sonnet | Only the approved primitives (VIZ_SPEC.md) |
| 5 | Independent verify (adversarial) | each question and claim, **grader ≠ author** | `verified`; provenance pass/fail; **coverage audit** | Haiku (provenance) + Sonnet (re-solve) | Re-solve must agree; "Europe = 0 claims" → RED |
| 6 | Assemble + validate (per lesson) | stages 2–5 | `<lesson>.json` bundle | none | Existing Pydantic validator (refs, DAG, MCQ) |
| 7 | Human gate (Samuel, batched) | review dossier | approve → live | Samuel | CLAUDE.md §3: nothing unreviewed reaches a student |
| 8 | Load (deterministic) | approved bundle | DB, `--course` scoped | none | Idempotent; preserves `relates_to` bridges |

v1 rollout: Phase A (Geography Lesson 2) done; Phase B (the Social Studies term) done; **Phase C
(back-audit of the maths bundles) not done**; Phase D (freeze the line as the "ingest a new book"
runbook) is what this revision and `runbook/README.md` start.
