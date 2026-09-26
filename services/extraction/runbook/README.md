# Runbook: ingesting a book, end to end

This is the operator's page for the extraction line.
- **Design:** `docs/specs/extraction-pipeline.md` (v2, decided 2026-09-25).
- **Decisions:** ADR-0005 (the line, with its 2026-09-25 amendment), ADR-0006 (Arabic), ADR-0008
  (generated bank), ADR-0009 (widgets as questions); `specs/003-curriculum-tracks/decisions.md`
  (#12–#16, #19–#22).
- **Product requirements it serves:** `specs/003-curriculum-tracks/spec.md` FR-4301…FR-4320 and
  FR-4401…FR-4409.

> **Status, 2026-09-25 (updated after Samuel's "ok for all").**
> - **[exists]**: the step runs from committed code.
> - **[on the branch]**: the code is written on `feat/003-curriculum-tracks-g10-american-math`, but is
>   not committed and not verified by anyone but its author.
> - **[verified]**: read and its own test suite run 2026-09-25 (`uv run --project services/extraction
>   --with pytest python -m pytest -q services/extraction/tests` — 272 passed, 47 skipped without a
>   database). This proves the code is real and its unit tests pass; it does **not** mean this stage has
>   been run end to end against the actual Grade 10 book — that is what the Chapter 8 pilot (§7) proves.
> - **[to build Bn]**: the build item in spec §9. The command shown is the intended interface, not a
>   working one.
> - **GATE**: the line stops until a human signs off. Gates are recorded in
>   `specs/003-curriculum-tracks/decisions.md` → *Gate record*.
>
> For Grade 10, **G0 is passed (65 lessons)**. S0a and S0 were done by the scouting scripts in
> `scratch_g10/` (report: `runbook/g10-s0-report.md`). B2 and B3 must reproduce that manifest.
>
> Review posture: ADR-0019 covers the maths bank of both maths courses. Switching a course on in the
> console is the gate (decision 9).

Every command runs from `services/extraction/` with `uv run` (dependencies are in
`pyproject.toml`). Workflows are Claude Code Workflow scripts. They **cannot write files**, so
after every workflow run, save its return value to the path given in the step and commit it.
Committed run outputs are what makes a bundle reproducible. After every workflow run, meter it
(step 8).

**Tests.** Run the whole suite from the repo root:

```sh
uv run --project services/extraction --with pytest python -m pytest -q services/extraction/tests
```

Individual test files' own docstrings document a per-file `uv run --with pytest …` or
`python -m unittest discover …` invocation from inside `services/extraction/` — either still works for
one file, but the command above is the one that runs everything in one pass and is what CI should use.
It needs no `conftest.py` or working-directory assumption: every test file puts `services/extraction`
on `sys.path` itself. Tests gated on a real database (`AINEXT_TEST_PG` set) are skipped without it —
expect passes plus a block of skips, not failures, when it is unset.

## Packet by reference: how a workflow gets its input

A workflow receives everything as the Workflow tool's `args`, and the operating session **types
those args into the tool call**. A workflow script cannot read a file (no fs, no Node APIs), so
until this existed a chapter's whole packet — 60 to 200 KB — had to be typed by hand. Every builder
below therefore has one flag, `--by-ref [DIR]` (S0b: `--batch-dir DIR`) [on the branch]:

- the builder writes the packet's big text to **shard files** in `DIR` (default
  `work/<book>/packets/<stage>-<tag>/`, gitignored: derived, regenerable) — one shard per unit of
  agent work, each **exactly** the text that unit's prompt used to carry inline — plus
  `manifest.json` (every file's sha256);
- it writes **compact args**: only what the script's control flow reads (ids, slugs, counts,
  partitions, options, hashes) plus `by_ref: {dir, stage, shards_sha256, files}`. By-ref args are
  written on one line: the file's content is exactly what to paste as the Workflow `args`;
- each prompt shows `[[file: <path>]]` where the text used to be, and tells the agent to read those
  files and open nothing else. The script never reads them; the agents do. Outputs of earlier agents
  in the same run are still passed inline, as before.

**The ≤ 15 KB rule.** Typed args must stay at or under **15,000 bytes** (`packet_ref.COMPACT_LIMIT`;
the builders print the size and warn above it): anything larger is too slow and error-prone to type.
A stage whose control flow would need more is restructured (S6 grade splits into parts) or runs as a
generated copy (below). Chapter 8 (dry run, stub data), args bytes: S0b A+B 3,782 · S0b C 1,195 ·
**S1 4,383** · S5 draft 4,795 · S6 author 5,370 · S6 grade 14,408 · S7 author 3,275 · S7 verify 1,763.

**By reference nothing is clipped** (decision of 2026-09-26, Q2). Inline prompts cut some blocks to
fit (S5's canonical solutions at 14,000 characters and evidence at 8,000; S6's book questions at
12,000, misconceptions at 4,000 and each judged instance at 5,000; S7's widget contract at 9,000,
which cut `venn_builder` and `area_model` off, and a lesson's objectives at 14,000). By reference
those shards are WHOLE; inline keeps its clips byte for byte, so old runs stay reproducible. Prompt
versions: `s5-v3`, `s6-v3`, `s7-v3` (S1 `s1-v3` has no clip).

**Args in the script: S2–S4 and S5 final** (decision of 2026-09-26, Q1 option A). Two stages cannot be
made small by reference: S2–S4, whose deterministic checks read every item's text inside the script
(which claims go to the provenance check, whether a typing agent's `book_final` is in the book
solution, the teacher-only echo check), and S5 final, whose script attaches every distractor and
carries every draft entry. For those the builder writes a **generated copy** of the runbook script
with the args embedded (`embed_workflow.py`), under `work/<book>/packets/embedded/` (gitignored),
and the operator runs it with `Workflow({scriptPath: <the copy>})` and **no args**:
- the copy is the runbook script with its one args line replaced: `export const meta` first and
  unchanged (the meter keys on its name), every prompt and check the runbook script's own;
- it records `embedded: {source, source_sha256, args_sha256, generated_sha256}`, echoed in the run's
  return value, so a saved run says which script ran; `generated_sha256` is the copy's own sha256
  with that one value written as zeros (`uv run embed_workflow.py verify <copy>` checks it, and that
  the runbook script has not changed since); a sidecar `<copy>.json` holds the same;
- a copy refuses args, and every downstream reader takes its run as the runbook script's run;
- resume a stopped run with the SAME copy: regenerating it with other inputs misses the cache;
- the copy holds the whole packet (for S2–S4, the book solutions, printed answers and teacher-only
  notes, as the args always did). No prompt names it; the same text is in `work/<book>/blocks.jsonl`.

**Blind rules hold by construction.** Every shard is written before any agent runs, so none holds an
agent's output; each prompt names only the shards whose text it used to carry, and
`tests/test_packet_ref.py` proves, per stage, that splicing the shards back into the by-ref prompts
gives the inline prompts. Stage by stage: S1 finders A/B read the lesson text in their own orders and
never each other's output; the link checker reads anchored text, never the linker's reasons; S6's
blind solver reads only instance stems (`solve/`), never the judge's sealed blocks (`judge/`); S7's
blind verifier reads stem, instrument and claimed diagnoses — no spec exists anywhere in its packet.

**Integrity.** The run echoes `by_ref` in its return value. S1's `packet_sha256` still covers the
whole packet, and `assemble_objectives.py assemble` re-renders the shards from today's inputs and
refuses a run whose `shards_sha256` differs. S6/S7 keep their shas (`spec_sha`, `stem_sha`,
`template_sha`) in the compact args, so the Python gates check them as before. Inline mode (no
flag) works exactly as before, and a workflow refuses args that carry both modes, or half of one.

The dry run (`uv run dryrun_chapter.py --book g10-math --chapter 8`, `--mode by-ref` by default,
`--mode inline` for the old way) runs every stage this way through the stub runtime — S2–S4 and S5
final as generated copies started with no args — and its stub agents read the shards their prompts
name. It never writes the book's real `work/<book>/` files: S0a runs into a scratch work directory
under the dry run's own root (the images by read-only symlink), and the test checks the real files'
modification times. S0a itself now writes every output atomically (a temporary file, then a rename),
so a stage reading `blocks.jsonl` never sees half of it.

## 0. Before you start

| What | Command / action | Status |
|---|---|---|
| Put the sources in place (gitignored) | Grade 10: `docs/Source/Gr10_Mathematics_Learner_Eng_v11.pdf` and `docs/Source/Gr10_Mathematics_Learner_Eng_CC-BY.epub`. Record `shasum -a 256` of both. The EPUB is not covered by `.gitignore` yet (`docs/Source/*.epub` should be added) | manual |
| Write the book config | `books/<book>.json` (spec §3.1): course id and curriculum per `specs/003-curriculum-tracks/contracts/pipeline-handoff.md` (Grade 10: `course:us-g10-math-en`, `us-american-en`, prefix `g10m`), `objectives_mode`, notation (decimal point, `(x, y)`), `sacred_content` | [verified] B1 `book_config.py` + the three National configs; the Grade 10 config is to write |
| Scratch database, never your working one | `createdb -T ainext_mvp1 ainext_ingest_<book>` then `export AINEXT_DB_DSN="host=127.0.0.1 dbname=ainext_ingest_<book>"` | [exists] (Postgres) |
| Baseline drift check before touching anything | `uv run parity_check.py --candidate "$AINEXT_DB_DSN" --all-courses` must be GREEN for every course | [verified] B10 |

## 1. Source adapter, manifest, maths transcription (once per book)

```sh
uv run source_adapter.py books/<book>.json          # [verified] B2
#   → work/<book>/blocks.jsonl (maths as image refs; teacher_only blocks marked),
#     work/<book>/figures/*.png, work/<book>/edition-check.json
#   exit 3 = the formats disagree on CONTENT → re-run with --pdf-only (spec §3.3)
uv run build_manifest.py books/<book>.json          # [verified] B3
#   → manifest/<book>.json (lessons with book provenance), manifest/<book>.review.html
```

What to check before G0:
- `edition-check.json` is `match`: build markers recorded, and the section codes and media codes
  set-equal. It is not a version-string or shortcode check (spec §3.3 step 6).
- Every body page has a printed number, and the offset regimes are listed. For Everything Maths
  Grade 10 v1.1 expect one regime: `printed = PDF − 11`.
- The lesson unit: one numbered section per lesson, with split, promotion and merge proposals flagged.

**GATE G0 (Samuel):** approve the manifest, the lesson unit, the offset regimes and the edition
verdict. Commit `manifest/<book>.json`. *Grade 10: passed 2026-09-25, 65 lessons
(`manifest/g10-math-american.json`).*

**S0b, maths transcription** (only for a source whose maths is images; Grade 10's is 8,561 unique
equation PNGs named `md5(LaTeX)`):

```sh
uv run assemble_maths.py vision-args <book> --pass AB --chapter 8 --batch-dir work/<book>/packets/s0b-AB   # [on the branch]
#   → compact args on stdout (Chapter 8: 3,782 bytes; one image list file per batch)
```

Run `runbook/transcribe-maths.workflow.js` [verified] B21 with those args (passes A and B, blind to
each other), then build the third reading's args with `--pass C --runs <the A+B run> --batch-dir
work/<book>/packets/s0b-C` and run it again. Save each return value to
`runs/<book>/maths/<pass>-<runId>.json`. (Without `--batch-dir` the image list is inline, ~120 KB.)

```sh
uv run assemble_maths.py books/<book>.json runs/<book>/maths/*.json    # [verified] B21
#   → runs/<book>/maths/accepted.json  {md5 → LaTeX, accepted_by: hash|agreement|human}
#     runs/<book>/maths/queue.json     images neither rule accepted, or the PDF cross-check contradicted
```

**GATE G0b (Samuel, or someone he names):** supply the LaTeX for every image on the queue. Nothing is
guessed. S1, S2 and S3 do not start until the queue is empty.

## 2. Objectives (per chapter)

```sh
uv run assemble_objectives.py s1-args <book> --chapter 8 --by-ref --out args/s1-ch08.json   # [on the branch]
#   → compact args (Chapter 8, s1-v5: see below) + shards in work/<book>/packets/s1-ch08/:
#     context.txt, lessons/<slug>.A.txt / .B.txt (the two finders' orders, each with the end-of-chapter
#     items in the lesson's scope) / .L.txt (the linker's), pool/b0001.txt …, anchors/a0001.txt …
```

- workflow: `runbook/objectives.workflow.js` [verified] B4 (by-ref [on the branch], prompts `s1-v5`),
  args = the file's content;
- save its return value to `runs/<book>/objectives/ch08-<runId>.json`.

```sh
uv run assemble_objectives.py books/<book>.json runs/<book>/objectives/ch08-*.json   # [verified] B5
#   → objectives/<book>/<lesson>.json, objectives/<book>/ch08.review.html, terminology-flags.json
```

The assembler rejects a chapter where:
- an objective lacks 2 evidence kinds, or lacks worked-example or exercise evidence;
- an exercise item is unmapped or mapped twice (an end-of-chapter item both blind mappers placed
  nowhere is reported with their reasons: G1 may place it with `move_items`, or rule it outside the
  chapter's objectives — below);
- a lesson has fewer than 2 or more than 5 objectives.

Prompts `s1-v4` (now `s1-v5`, below) [on the branch] carry the fixes from the Chapter 8 pilot (run `wf_02ba66d9-470`,
rejected): anchors are asked for without their brackets (and a bracketed known anchor is read without
them, recorded as `anchor_written`, by the workflow and the assembler alike); every text line says
which evidence kinds it may be cited as (`cite as: intro`), from rule 1's own table; the Haiku
evidence check judges each kind by what it can show (a heading names the topic, a summary line states
the fact); the reconciler reads the finders' evidence as plain text, not JSON, so LaTeX backslashes
survive. A run from before `s1-v4` cannot be assembled against today's packet (its `packet_sha256`
differs: the packet now carries the `cite` kinds): re-run S1.

**End-of-chapter items that fit no objective** — decision 36, Samuel's answer 15 (2026-09-26),
*"Both"* [on the branch]:
- (c) the finders (prompts `s1-v5`) also read the end-of-chapter items in their lesson's scope, each in
  its own order, and may cite one as exercise evidence, so a skill practised only there gets an
  objective; they never list one (the two blind mappers still place every end-of-chapter item). An
  objective no item ends up mapped to is a decision G1 owes (`unpractised`: move an item to it, drop it
  or acknowledge it).
- (b) G1 may rule a distributed item **outside this chapter's objectives**, in the verdicts file:
  ```json
  {"outside_items": {"Ex8-6:28a": {"why": "<the reviewer's reason, in their own words>"}}}
  ```
  Rule 2 is relaxed for that item only: it maps to no objective, is kept out of practice, and is
  recorded in `objectives/<book>/<lesson>.json` (`outside_items`, with the approver and date) and in
  `chNN.check.json`; `coverage_report.py` lists it as a named exception signed by the G1 approver
  (`g1_exceptions`), so S8 is GREEN for it only because of that verdict. A ruling with no reason, on a
  lesson's own item, or together with a move fails the chapter.

**GATE G1 (Samuel, or the methodology owner), per chapter:** review every `single` or disputed
objective, every terminology flag and every end-of-chapter item placed nowhere, then approve. Commit
`objectives/<book>/`.

## 3. Lesson conveyor: claims, book questions, visuals, verification (per lesson)

```sh
uv run embed_workflow.py lesson-args <book> --lessons g10m8s1-1,g10m8s2-1,g10m8s3-1,g10m8s3-2,g10m8s4-1   # [on the branch]
#   → work/<book>/packets/embedded/lesson.g10m8s1-1..g10m8s4-1.workflow.js: lesson.workflow.js with the
#     args (assemble_objectives.py lesson-args, ~190 KB for Chapter 8) embedded. Run it with
#     Workflow scriptPath and NO args. (--args-out A.json also writes the args, to read.)
```

There is no by-reference mode (the script's checks read the items' text), so the copy carries the
args: see "Args in the script" above. `assemble_objectives.py lesson-args … --out` still writes the
inline args, for reading or for a run with the runbook script itself.

- workflow: `runbook/lesson.workflow.js` [verified] B6, run as its generated copy;
- save its **whole** return value to `runs/<book>/lessons/<runId>.json` (plural "lessons" — one file
  per workflow call, however many lesson slugs it covered).

What it does that matters for review:
- **S2**: `teacher_only` blocks are dropped before any claim.
- **S3**: an exercise's canonical solution is **its EPUB worked solution** (`book_worked_epub`).
- **Blind re-solve**: it must agree with the printed answer **and** the EPUB solution.
- **Answer typing**: `numeric`, `choice` (only where natural), `expression` (with its kind and the form
  asked, for the app's marker) or `not_markable`, which becomes a worked example.

Resume a stopped run with the same script, the same args and `resumeFromRunId`. Cached agents return
instantly.

**Split the saved run into per-lesson files** before G2 or assembly read any of it:

```sh
uv run assemble_objectives.py lesson-runs <book> runs/<book>/lessons/<runId>.json [--g2 g2.json]
#   → runs/<book>/lesson/<slug>.json   (singular "lesson"; one file per lesson slug)
```

This is what `coverage_report.py` and `assemble_lesson_bundle.py` actually read (their `--runs`
default is `runs/<book>/lesson/`). Every split file is validated against `assemble_lesson_bundle.py`'s
own input models, so the handoff cannot drift silently; `--g2` folds in G2's verdicts on disputed
items before the split is written.

What to read in the output before G2:
- `verify.disagreements[]`: the three-way check failed (printed answer, EPUB solution, blind re-solve);
- `verify.no_printed_answer[]`: checked against the EPUB solution alone;
- `prov.unsupported[]`;
- `viz_gaps[]`;
- the per-lesson coverage oracle's `verdict`.

## 4. Misconceptions, generated families, widgets (per objective)

**S5, misconceptions.** Build the args, run the workflow — `runbook/misconceptions.workflow.js`
[exists] (by-ref [on the branch], prompts `s5-v2`) — and save its return value to
`runs/<book>/misconceptions/<stage>-<runId>.json`. S5 runs **twice**: once as a `draft` (before S6/S7
have added their distractors), once as `final` after they have, so FR-1115's "one error, one entry"
holds across all three sources:

```sh
uv run assemble_misconceptions.py --s5-args args/s5-draft.json --book <book> --stage draft --by-ref
#   → Chapter 8: 4,795 bytes; shards o/<objective>.questions.txt / .sources.txt (the canonical
#     solutions and the book's evidence, which both the author and the verifier read)
uv run assemble_misconceptions.py --s5-args args/s5-final.json --book <book> --stage final --by-ref --embed \
    --draft runs/<book>/misconceptions/draft-<runId>.json \
    --distractors runs/<book>/families/s5-distractors.json --distractors runs/<book>/widgets/s5-distractors.json
#   → the compact args are still ~66 KB (the script attaches every distractor and carries every draft
#     entry), so --embed also writes work/<book>/packets/embedded/misconceptions.s5-final.workflow.js:
#     run THAT with Workflow scriptPath and no args. Its agents read the whole (unclipped) shards.
```

```sh
uv run assemble_misconceptions.py runs/<book>/misconceptions/final-<runId>.json [more runs] \
    --book <book> --out seed/generated/<book>/misconceptions.json \
    [--bundle seed/generated/<book>/generated-questions.json] \
    [--bundle seed/generated/<book>/widget-questions.json] [--graph "$AINEXT_DB_DSN"] [--check]   # [exists]
```

`--bundle` (repeatable) cross-checks and strips distractor tags against S6/S7's output; `--graph`
proves the widget prerequisite rule (FR-1215); `--check` validates and reports without writing.
`--validate <catalogue.json> [--book <book>]` re-checks an already-assembled catalogue on its own.

**S6, generated families (declarative specs, decision 16).** Workflow: `runbook/families.workflow.js`
[exists] (by-ref [on the branch], prompts `s6-v2`) → `families/<book>/*.json`.

```sh
uv run generate_questions.py --families families/<book> --book <book> --catalogue runs/<book>/misconceptions/draft-<runId>.json \
    --author-args args/s6-author.json --by-ref            # mode author; Chapter 8: 5,370 bytes
#   → save to runs/<book>/families/author-<runId>.json, write each spec, then --check
uv run generate_questions.py --families families/<book> --book <book> \
    --grading-set runs/<book>/families/grading-set.json --grade-args args/s6-grade.json --by-ref \
    --s5-distractors runs/<book>/families/s5-distractors.json     # mode grade; Chapter 8: 14,408 bytes
#   → save to runs/<book>/families/grade-<runId>.json. The blind solver's shards (solve/) hold only the
#     stems; the judge's (judge/) hold the sealed blocks. If the args would pass 15 KB the builder
#     writes PARTS (s6-grade.part1.json …): run each, save each, pass every one to --grades.
```

```sh
uv run generate_questions.py --families families/<book> --course <course-id> \
    --out seed/generated/<book>/generated-questions.json            # [exists; --families is new]
```

**S7, widget templates — two passes, author then verify.** Workflow: `runbook/widgets.workflow.js`
[exists]:

1. `--author-args A.json --by-ref` (by-ref [on the branch], prompts `s7-v2`; Chapter 8: 3,275 bytes)
   writes the author pass's args — shards `contract.txt` and `lessons/<lesson>.txt`; run the workflow
   with them (`mode: "author"`: pick an existing kind only where it genuinely fits, write the template,
   or record the gap); save its return to `runs/<book>/widgets/author-<runId>.json`.
2. Pre-catalogue pass, so the reachability/prerequisite checks below have something to check against
   before S5's final catalogue is loaded:
   ```sh
   uv run generate_widget_questions.py --templates widgets/<book> --book <book> --dsn "$AINEXT_DB_DSN" \
       --gaps runs/<book>/widgets/author-*.json --pre-catalogue --verify-args V.json --by-ref \
       --s5-distractors runs/<book>/widgets/s5.json          # [exists]; --by-ref [on the branch]
   ```
3. Run the workflow again with V.json (`mode: "verify"`; Chapter 8: 1,763 bytes by ref): a different
   agent constructs an answer on the instrument from the stem alone, blind, and confirms each
   predicate is the error it names. Its shards `t/t001.txt …` hold stem, instrument and claimed
   diagnoses only — the by-ref packet has no spec at all. Save its return to
   `runs/<book>/widgets/verify-<runId>.json`.
4. Final pass, with S5's catalogue now loaded:
   ```sh
   uv run generate_widget_questions.py --templates widgets/<book> --book <book> --dsn "$AINEXT_DB_DSN" \
       --verdicts runs/<book>/widgets/verify-*.json --gaps runs/<book>/widgets/author-*.json \
       --gap-report coverage/<book>.widget-gaps.json \
       --out seed/generated/<book>/widget-questions.json     # [exists]
   ```

`--dsn` is **required** — the run refuses (exit 2) without it, because the prerequisite rule (FR-1215)
and the misconception catalogue are checked against the graph, never skipped. Every template's
`parent_question_id` is required and checked. S7 writes `coverage/<book>.widget-gaps.json`. **A new
widget kind is built only after Samuel approves it** (decision 11) — the six kinds of decision 27 are
approved in principle; each still needs the gap list to actually name a chapter for it before it is
built (T355–T357).

- The widget graph check (FR-1215) needs the new course's graph in the scratch DB. If step 6 has not
  run yet, run `load_seed.py --all --course <course-id>` against the scratch DB first, then this step.

`refutation.workflow.js` is **retired** (B18) [verified]. It refuses to run without
`{"allow_retired": true}` and is kept only as the reference design for B11.

## 5. Coverage audit

```sh
uv run coverage_report.py books/<book>.json        # [verified] B14 → coverage/<book>.json
```

The report must be **GREEN** on every integer equality (spec §3.11), including:
- S0b's unresolved count of 0;
- every item typed once;
- solution sources summing;
- every lesson carrying book provenance;
- no teacher-only block reaching a claim.

A RED line either goes back to the stage that owns it, or gets a signed exception written into
`coverage/<book>.json`. That exception needs a human's name.

## 6. Assemble, validate, dry-run (scratch database only)

```sh
uv run assemble_lesson_bundle.py --book <book> [--chapter N ...] [--manifest path] \
    [--objectives path] [--runs path] [--out path] [--report path.json] [--check]   # [verified] B8
#   --book        required: book name or path to its config JSON
#   --chapter     assemble only this chapter (repeatable)
#   --manifest    default: the book config's own manifest
#   --objectives  default: objectives/<book>/
#   --runs        default: runs/<book>/lesson/           (singular; see step 3's split)
#   --out         default: seed/<book>/                  → seed/<book>/chNN.json, seed/content/<slug>.json
#   --report      also write the assembly report JSON here
#   --check       assemble and validate, write nothing
uv run load_seed.py seed/<book>/*.json --validate-only                                   # [exists]
uv run load_seed.py --all --course <course-id> --dry-run                                 # [verified] B9, the honest preview (add-only)
uv run load_seed.py --all --course <course-id>                                           # [verified] B9, add-only; re-running changes nothing
AINEXT_ENVIRONMENT=mvp1 uv run load_misconceptions.py seed/generated/<book>/misconceptions.json --dry-run   # [exists]
AINEXT_ENVIRONMENT=mvp1 uv run load_misconceptions.py seed/generated/<book>/misconceptions.json            # [exists]
AINEXT_ENVIRONMENT=mvp1 uv run load_generated_questions.py seed/generated/<book>/generated-questions.json \
    --sample 10 --seed <N>                          # [exists] lands at 'review', writes *.review-queue.json
AINEXT_ENVIRONMENT=mvp1 uv run load_generated_questions.py seed/generated/<book>/widget-questions.json \
    --sample 10 --seed <N>                          # [exists]
uv run parity_check.py --candidate "$AINEXT_DB_DSN" --all-courses                  # [verified] B10, every course; Prep-3 maths still 10/90/112/450/212
uv run parity_check.py --candidate "$AINEXT_DB_DSN" --course <course-id>           # [verified] B10, the new course against its manifest
```

- **The drift check must stay GREEN for every existing course.** It is scoped per course (B10), so a
  second maths course no longer turns Prep-3 RED. If it does, that is real drift: do not "fix" it by
  editing `EXPECTED`.
- **Changing a course that students have used**: `load_seed.py --course <id> --update` applies content
  edits but refuses to change what an attempted question asks. `--replace` also prunes, and **refuses
  the whole load, saying what would be lost**, if student data, the catalogue, generated questions or
  another course still reference it. The loader never deletes or rewrites a student row [on the
  branch, B9].

## 7. Human review (G2, G3, G4)

```sh
uv run render_review_page.py seed/generated/<book>/generated-questions.json \
    --queue seed/generated/<book>/generated-questions.review-queue.json --out <scratch>/<book>-gen-review.html --sampled-only   # [exists]
uv run render_review_page.py …   # dossier modes for book questions and the catalogue   [verified] B17 (objectives and catalogue dossiers; the book-questions dossier mode is what T348 built and verified — recheck the specific --gate you need)
uv run apply_review_verdicts.py verdicts.json --dry-run      # [exists] names a reviewer; reject retires the family
uv run apply_review_verdicts.py verdicts.json                # [exists]
```

- **GATE G2 (Samuel):**
  - every book question whose three-way check disagreed (printed answer, EPUB solution, blind
    re-solve);
  - every item with no printed answer;
  - a 10% sample of `book_worked_epub` solutions.

  Nobody corrects a printed answer or a book solution silently.
- **GATE G3 (Samuel):** the 10% family-stratified sample of the generated and widget questions.
- **GATE G4 (Samuel):** a sample of refutations, and the count of refutations the verifier dropped.

## 8. Cost ledger and go / no-go

After **every** workflow run, record it. Then read the summary before G5:

```sh
uv run meter_run.py list-runs --name lesson                          # [verified] B16, find the run id
uv run meter_run.py record --book <book> --stage S3 --run <wf_id> [--lesson <slug>] --dry-run   # [verified] B16, preview
uv run meter_run.py record --book <book> --stage S3 --run <wf_id> [--lesson <slug>]             # [verified] B16, appends to runs/<book>/cost.jsonl
uv run meter_run.py summary --book <book> --by stage                 # [verified] B16, also: phase | lesson | model | agent | run
uv run meter_run.py prices                                           # [verified] B16, the price table in use
```

`--stage` is the spec stage the run implements (S0b, S1, S3, …). A resumed run is never billed
twice. An agent with no usage in its transcript is flagged `estimated`.

**GATE G5 (Samuel):** the dry-run delta, `coverage/<book>.json`, the drift check for every course,
the review verdicts and the cost ledger. He decides go or no-go. Promotion follows the review posture:
for the Grade 10 course, ADR-0019's note makes switching the course on the gate. Items held at G2 or
retired at G3 stay held.

Then export the reviewed state, so the review stamps travel with it:

```sh
AINEXT_ENVIRONMENT=mvp1 uv run export_generated_content.py --course <course-id> --out seed/generated/<book>/   # [verified] B15; --course is new
```

## 9. Production

A **new course** reaches production through the manually started **"Load a course"** GitHub action
(`specs/003-curriculum-tracks/contracts/load-course.md`), never through a deploy [to build, T324/T325]:

1. Actions → **Load a course** → course id, mode `dry-run`. Read the delta.
2. The same with mode `load`, confirm = the course id. It:
   - checks this course's own presence, and exits if it is there;
   - takes a backup, verifies that it reads back, and prints the rollback line;
   - runs `load_seed.py --all --course <id> --if-absent`, `load_misconceptions.py`, and
     `load_generated_questions.py --restore` for the exports;
   - runs the drift check for every course;
   - confirms that **no visibility rule** was written.
3. In the console's `/courses`, an operator switches the course on for the grades it serves.

A **change to a course that is already loaded** goes through `deploy/refresh-content.sh`,
**retargeted to noor's stack** [to build, T326]. It refuses rather than losing student data.

Commit, in the same change:
- `books/<book>.json`, `manifest/`, `objectives/`, `runs/<book>/` (including `maths/` and
  `cost.jsonl`);
- `seed/<book>/`, `seed/content/`, `seed/generated/<book>/`, `coverage/<book>.json`.

Update FRs and traceability in the same work (the Spec Kit rule).

---

## As built: how the existing books were produced

For reproduction and audit only. The details are in spec §2.

| Book | Commands actually run | Reproducible? |
|---|---|---|
| Prep-3 Maths (10 bundles) | none recorded. Ad-hoc Claude Code agents, 2026-07-18 → 20. `seed/geometry-structure.md` is the only note | no |
| Social Studies T1 | `rich-lesson.workflow.js` with args `{"only": ["soc1-1", …]}`, outputs saved by hand to `/tmp/fullbook.json` and `/tmp/rerun_soc21_23.json`; flagged claims pasted into `audit-claims.workflow.js` and the verdicts saved to `/tmp/audit_bad.json`; `python merge_final.py`; `uv run assemble_fullbook.py`. *(`merge_final.py` and `assemble_fullbook.py` now take paths as arguments, B20, on the branch)* | no (`/tmp` inputs are gone) |
| Arabic T1+T2 | `arabic-lesson.workflow.js` with args `{"only": […]}`, outputs in `runbook/ar-*.local.json`; `uv run assemble_arabic.py runbook/<run>.json --out seed/arabic-t1.json`; `arabic-book-review.workflow.js` → `ar-review-report.md` | mostly |
| Generated maths bank | `uv run generate_questions.py --out … --per-family <N>`; `load_generated_questions.py … --sample 10 --seed N`; review verdicts; `--promote`; later `export_generated_content.py` | as an export only |
| Widget bank | `uv run generate_widget_questions.py --out … [--dsn …]`, then the same load, review and export | as an export only |
| Misconception catalogue | `uv run build_misconceptions.py --out seed/misconceptions-math.json`, then loaded, exported, and edited by hand in the export. **Decided 2026-09-25 (B19)**: the loaded `seed/generated/misconceptions.json` becomes the single source; the generator is retired; its six missing `t2u3-1-2` entries are added; `seed/misconceptions-math.json` is deleted; no live id is renamed | the loaded file will be the source |
| Refutation library (`refutation.workflow.js`) | never produced output. **Retired** (B18): it refuses to run | n/a |

Loading all three National books on a fresh local database is what `scripts/local-dev.sh` step 3
does, and what `ci-cd.yml` "Curriculum (only when none is loaded)" does on first boot.
