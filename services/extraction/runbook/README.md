# Runbook: ingesting a book, end to end

This is the operator's page for the extraction line.
- **Design:** `docs/specs/extraction-pipeline.md` (v2, decided 2026-09-25).
- **Decisions:** ADR-0005 (the line, with its 2026-09-25 amendment), ADR-0006 (Arabic), ADR-0008
  (generated bank), ADR-0009 (widgets as questions); `specs/003-curriculum-tracks/decisions.md`
  (#12–#16, #19–#22; and, as they touch the line, #25 prerequisite links, #31 S5 per objective, #32 the
  third reading, #33 the second mapper, #36 items outside a chapter, #39–#45 the G2 answers, #47 held
  widget mappings). Samuel's answers from the third round on are in
  `docs/WIP-g10-pilot/samuel-answers.md`: answer N is decision N + 21.
- **Product requirements it serves:** `specs/003-curriculum-tracks/spec.md` FR-4301…FR-4321 and
  FR-4401…FR-4410.

> **Status, 2026-09-25 (updated after Samuel's "ok for all"; commit wording corrected 2026-09-27).**
> - **[exists]**: the step runs from committed code on `main`.
> - **[on the branch]**: the code is on `feat/003-curriculum-tracks-g10-american-math`, committed only
>   as unreviewed WIP snapshots, and not verified by anyone but its author.
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
> **Chapter 8 pilot (2026-09-26/27)**: S0b (853/853 accepted, G0b not needed), S1 and **G1 passed**,
> S2–S4 and **G2 passed**, S5, S6 and S7 run, and the results loaded into the scratch database
> `ainext_pilot_g10_ch08`; G3, G4 and G5 are still to come. Metered: $153.30 (`runs/g10-math/cost.jsonl`).
> Where it stands: `docs/WIP-g10-pilot/README.md`.
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
uv run assemble_maths.py assemble <book> runs/<book>/maths/*.json [--human runs/<book>/maths/human.json]   # [verified] B21
#   → runs/<book>/maths/accepted.json  {md5 → LaTeX, accepted_by: hash|agreement|third_reading|human}
#     runs/<book>/maths/queue.json     images no rule accepted, or the PDF cross-check contradicted
#     runs/<book>/maths/summary.json   counts per route: accepted_by_hash, accepted_by_agreement,
#                                      accepted_by_third_reading, resolved_at_g0b, unresolved,
#                                      awaiting_third_reading; per class in routes_by_class (SC-213)
```

Run `assemble` after passes A and B (it lists what pass C must read), and again after pass C. The
third reading (decision 32) accepts an image only when C agrees with A or with B — two of three, never
one. An image used only inside an EPUB worked solution (`solution_only`) follows the same rule and,
being printed nowhere in the PDF, is not cross-checked. Chapter 8: 853/853 accepted — 558 hash,
282 agreement, 13 third reading — so G0b was not needed.

**An aligned derivation's hash.** The book names an `align*` image `md5` of its lines **without** the
environment and with `&` written as the HTML entity `&amp;` (its source was HTML-escaped before hashing;
proven on the hash-accepted Chapter 8 images). `assemble_maths.py` proves a transcription by either form
(`hash_forms`) and **stores** it canonical: real `&`, inside `\begin{align*}…\end{align*}` (`canonical`).
No entity is ever stored. `md5check` answers the canonical form too.

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

**The second mapper and the prerequisite links** (decisions 33 and 25) run inside the same workflow, on
by default (`second_mapper: true`, `links: true`). Two blind mappers each place every end-of-chapter
item; where they disagree, the assembler records a `mappers_disagree` decision on the G1 page. The
linker proposes the prerequisite links the book itself evidences (a recall, a reference back, a method
used before), each quoting its evidence, and an independent checker judges each one; the assembler
keeps a link only with its quote at its anchor and the checker's agreement, and lists every link, kept
or dropped, on the G1 page. A link may point only to this chapter or to earlier chapters that passed
G1, so a chapter's links are re-run once the chapters before it have passed.

**GATE G1 (Samuel, or the methodology owner), per chapter:** review every `single` or disputed
objective, every terminology flag, every end-of-chapter item placed nowhere, every item the two mappers
placed differently, and every prerequisite link (keep or drop), then approve. Commit
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
- **Answer typing**: `numeric`, `choice` (only where natural; its options come from the stem, from the
  labels of a figure of the item, or from the lesson's closed set), `expression` (with its kind and the
  form asked, for the app's marker) or `not_markable`, which becomes a worked example.

Resume a stopped run with the same script, the same args and `resumeFromRunId`. Cached agents return
instantly.

**Launch or resume a workflow only in a turn whose latest user message is the go-ahead for it.** The
Workflow harness relays the operator's latest message to every agent and tells it that message wins; the
Chapter 8 pilot's 8.1 and 8.3a (and the stopped 8.3b and 8.4) were launched under an unrelated question and
their blind solvers answered that question instead of the items. COLLECT-2 detects it and asks once more,
but only a clean launch prevents it.

**lesson-v4** (`PROMPTS_VERSION`, 2026-09-26): a choice's options may be the labels a figure of the
item shows ("Which point lies at (5; −4)?", A–E; shape W–Z): `options_source: "figure"`. The check: the
item has a figure; every option is one label (a letter, with an index or a prime), all after the same
optional word, which the stem uses ("shape Z"); no label repeats. The book gives no figure's label set as
data, so membership is not checked here — the blind re-solve reads the figure and must pick the printed
label. Only the typing prompt changed, but typing is the first S3 call: on a resume only S2 replays.

**COLLECT-2** (`COLLECT_VERSION`, 2026-09-26; no prompt changed by it, so on its own a resume would replay
every agent except the judge, whose pair list the collection decides). Deterministic only:
- "book_final is in the book solution" reads each line of an aligned derivation with its left side
  (`d&=\sqrt{45}\\&\approx 6,71` states `d\approx 6,71`), ignores `&`, and checks every maths segment of
  a final written as a sentence. A final the solution does not contain is still refused.
- The three-way comparison reads a sentence final by its maths span, a printed list's "and" as its comma,
  a named or flattened left side (`m_{AC}=`, `mAC =`), an equation either way round, and
  `\frac{-a}{b}` as `-\frac{a}{b}`. One value is still never the answer of two (`x=3` vs `x=2 or x=3`).
- A typing or blind batch that left items unanswered, or answered off task, is asked again **once** for
  the missing items only (label `…:again`). Whatever is still missing goes to `verify.unchecked`
  (`[{ref, missing}]`) and `verify.off_task`; the item stays `disputed` but is **unchecked**, never a
  disagreement between the book's sources — re-run it, do not send it to G2 as a book error.

**COLLECT-3** (2026-09-26, the five lesson-v4 runs; deterministic only, the prompts are unchanged):
- the typing check reads a named point ("M (1; 0)" is (1; 0)), a chain of names ("dAC = dBD = √26"), a
  key typed as a set of values ("3; 9" is "x = 3 or x = 9"), a sentence final whose maths names things,
  "and" as a list's comma on either side, and an alignment `&` copied into a final; a numeric key's
  number is the one after the answer's last "=" ("f(2) = 5" states 5);
- "book_final is in the book solution" accepts a final listing several statements when EACH is in the
  solution, a worked chain L=…=R the solution holds as L=R (arithmetic only — "x = 2 or x = 3" and a
  list of equations are never chains), `{m}_{AB}`, and a value the solution states as a segment of its own;
- typing and the blind solver both calling an item not markable (a proof) is agreement, not a missing check;
- a stem that refers to a figure the blind solver was not given: a blind answer that does not agree is
  UNCHECKED (re-solve it), never a book dispute. The cause — a question's shared figure ("Given the
  following diagram: [figure]") was not attached to its parts — is fixed in `lesson-args`;
- three pairwise verdicts that contradict each other are flagged `inconsistent` (the judge got one wrong).

**Re-collect a saved run, no model call** (when only the collection changed):

```sh
uv run recollect_lessons.py runs/<book>/lessons/<runId>.json … [--dry-run]    # [on the branch]
#   → runs/<book>/lessons/recollected/<runId>.json  (the saved run is never overwritten)
uv run recollect_lessons.py runs/<book>/lessons/<runId>.json … --resume-preview
#   → what a Workflow resume with today's generated copy would replay, run live, and cost
```

It runs today's script, with the saved run's own args, through the stub runtime, every agent answered
from the run's journal. It reuses an answer only when today's script sends the recorded prompt (from the
agent's transcript), and a judge verdict only for the same pair id with the same two answers; anything
else is reported (and stays `unclear`/unchecked), never guessed. A collection change usually changes the
JUDGE's prompt (the pairs it is sent), which is why a Workflow resume would run the judge and everything
after it live, and this does not.

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
  an entry with `unchecked` was never checked (a missing answer), not a book dispute;
- `verify.unchecked[]` and `verify.off_task[]` (COLLECT-2): non-empty means re-run those items;
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

**What a student reads carries no bookkeeping (consistency review 2026-09-27, A5; prompts `s5-v5`).** A label,
description, signal or refutation step that names a question id or book reference (`q:…`, `ex8-1-4`,
`Ex8-6:21c`), a page number, a numbered figure, or review history (a reviewer's note, a gate, a correction,
our own re-solve) is refused at assembly for every catalogue (`leak_problems` in `validate_catalogue`). The S5
packet no longer carries G2's notes (a disagreement is "our own independent re-solve answered X; the book's
answer is Y"), and a canonical solution G2 corrected is marked "CORRECTED … not the book's own working"; both
prompts state the rule. A run whose text leaks is fixed as a **pipeline normalisation** beside it —
`runs/<book>/misconceptions/<run stem>.normalisations.json` (`{"format": "ainext.s5-normalisations/1", "run",
"patches": [{id, field, from, to, by, why}]}`) — applied every time that run is assembled, fail-closed on the
exact `from` text, and recorded on the entry (`provenance.normalisations`). Chapter 8: 13 patches on 9 entries.

**What S5, S6 and S7 are shown (s5-v4, s6-v4, s7-v4; the Chapter 8 S5 draft).** A book question whose stem
shows `[figure]` names its image files (from the lesson runs: `assemble_misconceptions.figures_by_question`),
and the agents may open them — S5's author and verifier ("Figure(s): …"), S6's author (`figures` on each book
question), S7's author (`figures` on each anchor). A widget template's stem may never point at a `[figure]`
(`check_template`): the student and the blind verifier see only the instrument. S5 also reads the book's
teaching items (worked examples) as canonical solutions, and treats a three-way disagreement as evidence of a
STUDENT error only when G2 kept the book's answer and the re-solve really differed (`g2.changed`, which
`lesson-runs --g2` now records for a fix). A marked question's answer text is never a printed answer G2
corrected (assembly).

**S7 before any catalogue is loaded (the Chapter 8 pilot).** S7's author and verifier read misconceptions from
the scratch database, which holds none of the new book's until S5 final is assembled and loaded. Pass the S5
DRAFT run with `--catalogue runs/<book>/misconceptions/draft-<runId>.json` to both `--author-args` and
`--verify-args`: its entries are overlaid on the database's (`CatalogueOverlay`), so the author can name them
and the verifier reads their labels. **Notation in the catalogue (FR-4308)** is enforced where it is assembled
(`validate_catalogue`, fail-closed): no decimal comma outside a bracket, no `(x; y)` pair. S5 writes in the
app's notation, so its text is never passed through the bundle's book-notation normaliser (that would read the
pair `(-2,3)` as the decimal −2.3).

**S6, generated families (declarative specs, decision 16).** Workflow: `runbook/families.workflow.js`
[exists] (by-ref [on the branch], prompts `s6-v2`) → `families/<book>/*.json`.

```sh
uv run generate_questions.py --families families/<book> --book <book> --catalogue runs/<book>/misconceptions/draft-<runId>.json \
    --author-args args/s6-author.json --by-ref            # mode author; Chapter 8: 5,370 bytes
#   → save to runs/<book>/families/author-<runId>.json, write each spec, then --check. Two refusals are
#     mechanical and fixed by the pipeline, recorded in the spec's notes as a PIPELINE NORMALISATION (a
#     redundant top-level "answer" beside marker.answer; a param named like a built-in):
#       uv run python -m families.normalise families/<book>/<file>.json …   (--dry-run to preview)
#     every other refusal goes back to the author; hold that spec out as families/<book>/_held--<file>.json
#     and re-author it alone, through the shared revise prompt (s6 prompts unchanged), with its reasons:
#       uv run generate_questions.py --families families/<book> --book <book> --revise-args A.json \
#           --revise families/<book>/_held--<file>.json … --revise-problem <family id> "<reason>" …
#     (the check's own reasons are added for you); the run returns `revised` — write it back without the
#     _held-- prefix, --check it, and grade it
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
   or record the gap); save its return to `runs/<book>/widgets/author-<runId>.json`. To re-author some
   lessons only (prompts `s7-v5`, after the six kinds of decision 27 were registered), add
   `--only-lessons g10m8s3-2[,…]`: the packet holds those lessons and nothing else. Then merge the runs,
   OLDEST FIRST — a lesson's record in a later run replaces its earlier one whole (templates and gaps
   together) — and write the templates from the merge (no database; never overwrites, and refuses while a
   superseded template file is still in the directory):
   ```sh
   uv run generate_widget_questions.py --merge-author-runs runs/<book>/widgets/author-<old>.json \
       runs/<book>/widgets/author-<new>.json --merged runs/<book>/widgets/author-merged.json \
       --write-templates widgets/<book>
   ```
   and pass only `author-merged.json` to `--gaps` below (every file given to `--gaps` contributes its gaps).
   Before S5 final, write S7's mappings again WITH `--verdicts`: only verified templates and CONFIRMED
   mappings reach S5 (the pre-catalogue file holds every mapping, refused ones included). Decision 47: a
   mapping the verifier did not confirm is held (`choices.pending_review`), not dropped — add
   `--pending-review runs/<book>/widgets/pending-review.json` and render the **G3 held-mappings page**
   (part of gate G3): `uv run render_review_page.py --gate g3-mappings --mappings runs/<book>/widgets/pending-review.json
   --out runs/<book>/g3-mappings-chNN.review.html`. Its export goes to the final pass as
   `--mapping-review <file>` (keep → active, drop → deleted); then re-reconcile the tags with
   `assemble_misconceptions.py … --bundle` as usual. The same for S6: `--s5-distractors` with
   `--grades` holds only the families the blind grade passed.
   Two author errors the pre-catalogue pass refuses are fixed mechanically and recorded in the template's
   notes: a diagnostic naming a misconception outside the objective and its prerequisites (dropped while an
   own one remains, FR-1215), and a predicate mapped twice (its first mapping kept):
   `uv run generate_widget_questions.py --dsn … --catalogue <S5 draft> --normalise-templates <files> [--dry-run]`.
   Anything else goes back to the author. From `s7-v6` the author prompt states both as rules (ids from the
   objective's own list only; one predicate, one misconception), so fan-out should rarely need them.
   **What a question can emit (consistency review 2026-09-27, W1 and A10; prompts `s7-v7`).** A kind declares
   more predicates than one question reports: `contracts/widget-predicates.json` gives each kind a `can_emit`
   table per mode / ask / element / fn (derived from the widget's grading code, mirrored in the app's
   `widget-predicates.ts`), and `validate_widget` refuses an active or held mapping its question cannot emit.
   A `line_drawer` "points" target, or its swap, on the position a handle opens at (`OPENING_HANDLES`) is
   refused too. Every instrument is the app's `widget-docs.ts` DOCS text word for word. Two more normalisations,
   first needed AFTER the blind verifier had judged Chapter 8: `drop-dead-predicate` (only while another mapping
   remains) and `drop-opening-instance` (only while another instance remains). Each records the template as it
   was verified (`verified_as`), and a change that only removed mappings, instances or solution steps keeps its
   verdicts (`carried_verification`; the bundle lists it under `carried_verification`) — any other edit needs
   the verifier again. A template left with no mapping goes back to the author: move it aside as
   `widgets/<book>/_held--<file>.json` (Chapter 8: `gradient-to-missing-coord`).
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

- **Aligned derivations render inline.** The app renders every `$…$` inline with KaTeX, which draws
  `align*` only in display mode (inline it shows a red error span whose escaped source reads `&amp;`).
  The bundle writes `align*` inside `$…$` as `aligned` (counted as `aligned`, presentation only), and
  the coverage audit fails (`residual_notation`) on any display-only environment left in a bundle.
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

  G2's page must show items whose typing G2 has still to fix, which the real split refuses. So:

  ```sh
  uv run assemble_objectives.py lesson-runs <book> <run> --draft        # → runs/<book>/lesson-draft/ (pending_g2 listed; assembly refuses a draft)
  uv run render_review_page.py --gate g2 --book <book> --chapter 8 --runs runs/<book>/lesson-draft \
      --recommend runs/<book>/g2-ch08.recommended.json --out runs/<book>/g2-ch08.review.html
  uv run render_review_page.py --gate g2 --book <book> --export <page>.verdicts.json \
      --recommend runs/<book>/g2-ch08.recommended.json --out runs/<book>/g2.json   # the page's export → G2's file
  uv run assemble_objectives.py lesson-runs <book> <run> --g2 runs/<book>/g2.json   # the real split
  ```

  G2's file is `{"by": "<reviewer>", "items": {"<lesson>:<ref>": {"verdict": "accept"|"fix"|"hold"|"exclude",
  "note": "…", "fields": {…}}}}` (what `lesson-runs --g2` and `apply_review_verdicts.py --g2` read). A
  recommendations file has the same shape, unsigned, plus `class`, `confidence` (`low` = the maths is
  checked but the verdict is a content decision — the page marks it "your call", with `why_low`). On the
  page, Fix with an empty note takes the recommended `fields`; Fix with a note of your own is listed as a
  TODO until its fields are written. A resumed Workflow run appends to its journal:
  `recollect_lessons.py` reads each label's LATEST agent.

  Two G2-only fields (decisions 41 and 43, contract `specs/003-curriculum-tracks/contracts/pipeline-handoff.md`):
  a choice item's `less_specific: [option keys]` (other TRUE options, returned for re-entry, never wrong; the
  question's `choices` becomes `{"options": […], "less_specific": […]}`), and an expression item's
  `answer_only: true` (no book working: marked on the answer, no step-by-step explanation; needs printed =
  blind, and the solution is left as the book has it). The run item, assembly and the schema check both.
- **GATE G3 (Samuel):** the 10% family-stratified sample of the generated and widget questions.
- **GATE G4 (Samuel):** a sample of refutations, and the count of refutations the verifier dropped.

### 7a. Review stamps, maths always full, book pictures (migration 035; answers 33, 37a, 37d)

- **Only a human stamp is a review** (answer 33). `questions.reviewed_by` holds a human's stamp and
  nothing else; no loader writes it. An AI check goes to `ai_checked_by` / `ai_checked_at`
  (`ai dual-check` on a book question two independent AI readings confirmed; `ai blind grade (S6)`,
  `ai widget verify (S7)` on generated rows; `auto-pass G<n> (AI recommendation) …` from §7b). Text that
  is not a stamp ("stem fixed by orchestrator … — not Samuel", "promoted without review: …") goes to
  `review_note`. Migration 035 split every older `reviewed_by` string that way, once.
- **A maths course is always full** (answer 37a). `load_seed.py` and `load_generated_questions.py`
  load a maths course (book config `subject: math`) **live**, as if reviewed; the console's backlog is
  every row with no human stamp. On a maths question `status = 'review'` now means only *an automatic
  safety check holds it*, and `hold_reason` says which: `figure_missing`, `figure_reveals_answer`,
  `katex_error`, `answer_mismatch`, `unanswerable`, `unverified`, `sacred`, or `human_hold` (a human's
  G2 hold / G3 "fix" — the one reason no loader releases). A later load that removes the cause (the
  figure or a book picture arrives) releases the question. Social Studies and Arabic are unchanged:
  `review` with no reason is their queue, awaiting a human; Quran/Hadith stay sealed (`sacred`).
  `load_generated_questions.py --review` keeps the old two-act load for a maths bundle.
- **Book picture for now** (answer 37d; temporarily reverses answer 29 for students). The assembly
  (`assemble_lesson_bundle.py`) gives a book question whose figure no native kind drew a `book_image`
  stand-in — `{src: "/book-figures/<book>/<file>", alt, stand_in: true, native_kind_needed}`, id
  `v:<lesson>:bk-<item>` — from the item's own EPUB image (`work/<book>/figures/`), copies the image to
  `app/public/book-figures/<book>/` (the app serves it; no other host), and the question goes live. It
  stays in the console backlog as "needs native figure" until a native visual replaces it. A book
  picture that **draws the question's unknown** (the point asked for, or a point whose letters are
  asked: `book_picture_reveals`) is never shown: the question is held as `figure_reveals_answer`.
  `--no-book-pictures` restores answer 29's native-only rule; `--figures-out` / `--figures-dir`
  override the paths. Coverage's `book_pictures` check fails on a stand-in that is not servable.

### 7b. Auto-pass the gates during the fan-out (answer 37c; G5 too, answer 39)

`auto_pass_gates.py` writes the AI checks' recommendation as the gate's verdict — signed
`auto-pass G<n> (AI recommendation)`, marked `"auto": true`, **never a human stamp** (the loaders put it
in `ai_checked_by`) — and records every decision for Samuel's review in the console. The **automatic
safety checks still block**: a G1 pipeline failure, a G2 item nothing supports a verdict for (held
`answer_mismatch` / `unverified`), the figure gates, a coverage *safety* check, parity. A human verdict
already in a gate's file is never overwritten. Nothing here deploys or promotes anything to production.

```sh
# G1 — objectives: owed decisions on the AI line's recommendation (a pipeline failure blocks, exit 1);
#      --approve then runs `assemble_objectives.py approve … --by "auto-pass G1 (AI recommendation)"`
uv run auto_pass_gates.py g1 <book> --chapter 9 --approve
# G2 — book questions: a human verdict stands; else the recommendation file's; else the checks' own rule
#      (no printed answer + re-solve agreed with the book's solution → accept; typing problem → exclude);
#      a three-way disagreement gets no verdict and stays held
uv run auto_pass_gates.py g2 <book> --chapter 9 --lesson-run runs/<book>/lessons/<runId>.json \
    [--recommend runs/<book>/g2-ch09.recommended.json]                      # → runs/<book>/g2.json
uv run assemble_objectives.py lesson-runs <book> runs/<book>/lessons/<runId>.json --g2 runs/<book>/g2.json
#      … assemble, load, then:
uv run apply_review_verdicts.py --g2 runs/<book>/g2.json --book <book>               # auto items → ai_checked_by
# G3 — generated sample accepted on S6/S7; held predicate claims stay held (no --mapping-review step)
uv run auto_pass_gates.py g3 <book> --chapter 9 --queue seed/generated/<book>/generated-questions.review-queue.json \
    --queue seed/generated/<book>/widget-questions.review-queue.json --widgets seed/generated/<book>/widget-questions.json
uv run apply_review_verdicts.py runs/<book>/g3-ch09.auto.json                        # adds to ai_checked_by
# G4 — the catalogue S5's verifier kept (a record)
uv run auto_pass_gates.py g4 <book> --chapter 9 --catalogue seed/generated/<book>/misconceptions.json \
    --s5 runs/<book>/misconceptions/final-<run>.json
# G5 — go/no-go on coverage + the drift guard for every course + cost (exit 1 = NO-GO)
AINEXT_DB_DSN=<the load's database> uv run auto_pass_gates.py g5 <book> --chapter 9 \
    --coverage coverage/<book>.json [--book-config <the loaded book config>] [--dryrun <report>]
```

Every subcommand takes `--run <name>` (recorded as the decision's `run`) and `--gates-dir`. Loads for a
maths course need no `--promote` any more (it is implied); `--promote` still works.

**Gate decision records** — the shape the console's review gate reads
(`app/src/lib/review-gate-records.ts`, format `ainext.gate-decision/1`). One JSON file per gate and
scope, `runs/<book>/gates/<id>.json` with id `g<n>-chNN` (or `g<n>-book`); a re-run replaces it, and the
console fingerprints the content, so a changed decision is back in front of Samuel. Each becomes one
backlog item of kind `gate_decision` that only Samuel can decide.

| field | meaning |
|---|---|
| `format`, `gate`, `book`, `id` | `"ainext.gate-decision/1"`, `G1`–`G5`, the book, `g<n>-chNN` (the item is `<book>/<id>`) |
| `chapter`, `run` | the chapter (null for a whole-book decision); the run it belongs to (optional) |
| `decided_at`, `by`, `auto` | UTC ISO time (`Z`); always `"auto-pass G<n> (AI recommendation)"`; always `true` — never a person |
| `outcome` | `pass`, `pass_with_holds` (something was held, excluded or left for a person), or `blocked` (iff `blocked` is non-empty) |
| `summary` | one sentence |
| `decisions[]` | `{key, decision, detail?, basis?}` per decision taken (G3 also lists each held predicate claim; G2 each item left held) |
| `checks[]` | `{name, state, detail?}`: the automatic and AI checks the decision rests on (G5: every coverage check and the drift guard per course, and the cost) |
| `evidence[]` | `{label, path}`, repository-relative: verdict files, the check/coverage files, the review page, the other gates' records |
| `blocked[]` | what did NOT auto-pass (a G1 pipeline failure, a coverage safety check, parity) |
| `course_id`, `for_review[]` | extra (the console ignores them): the course; what Samuel should read first |

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
the review verdicts and the cost ledger. He decides go or no-go. During the fan-out it is auto-passed
(`auto_pass_gates.py g5`, §7b) on those same inputs and recorded for his review; that GO is for the
dev/pilot database only. Promotion follows the review posture:
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

### Consistency review 2026-09-27 (A1–A4, A8, A9): what the assembly, load and audit now enforce

- **Answer text** (A1): a typed question's `answer` is its marker key rendered (`answer_text`), never the printed
  text layer; `load_seed.py` refuses a mismatch and the audit counts it (`answer_text`).
- **LaTeX** (A2): the assembly re-spaces S0b's whitespace-stripped LaTeX with the app's KaTeX as the judge
  (`katex_check.mjs`; `runs/<book>/maths/accepted.json` and its hash proofs are untouched) and splits chained
  coordinate assignments; `load_seed.py` refuses, and the audit counts (`katex`), any segment KaTeX cannot parse.
- **Pairs** (A4): `(a,b)` becomes a pair only where the other side of its equation is a pair; any other whole-side
  `(a,b)` is read as the book's decimal and listed for G2 (assembly report `ambiguous_pairs_for_g2`).
- **Figures** (A3, A8): a figure that draws the question's unknown is withheld; a question showing `[figure]` with no
  figure is held at review (assembly, `load_seed.py` figure gate, `apply_review_verdicts.py --g2`); a gap whose reason
  is a pipeline error fails the audit (`figures`). Re-run S4 alone for the failed or withheld figures:
  ```sh
  uv run embed_workflow.py lesson-args <book> --lessons <slug> --visuals-only runs/<book>/visual-reruns.plan.json \
      --out work/<book>/packets/embedded/lesson-visuals.<slug>.workflow.js     # run with scriptPath, no args
  uv run merge_visual_reruns.py <the run's return>.json                          # into runs/<book>/lesson/
  ```
  then re-assemble and reload (`load_seed.py … --replace` prunes a withheld figure).
- **Forms** (A9): `answer_rules.forms_from_stem` may name `"form": "subject", "subject": "y"` ("in the form y = …");
  the assembly puts it on the marker and S3 (collect-5) does too; the audit counts a miss (`asked_forms`).
- **lesson-v6 visuals** (2026-09-27): an EXERCISE figure names the unknown it leaves out in `withheld` and draws
  the rest (Compare accepts exactly that omission); a worked example's figure is drawn whole; every element a figure
  shows is drawn, or the figure is a gap whose `needed_kind` says exactly what is missing. The figure gate marks
  what it holds (`[held: figure missing]`) and a load that brings the figure puts exactly those back live.
- **G2 attribution**: an item another agent fixed on top of Samuel's verdict carries `samuel_verdict` and `stem_fix_by`
  in g2.json; the lesson runs and the DB stamp say both ("Samuel Toma (G2 accept); stem fixed by …").
- **Dry runs**: one at a time per chapter — `dryrun_chapter.py` holds `work/<book>/dryrun/.chNN.lock` and a second
  run waits for it.

## 10. The full-book fan-out and the step-level working checker (2026-10-01)

**The fan-out** (Samuel's answer 37e; plan and inventory in `docs/WIP-g10-pilot/README.md` → "Fan-out plan"):

```sh
uv run fanout.py inventory             # runs/<book>/fanout/inventory.json: per chapter lessons, items, maths, figures
uv run fanout.py plan                  # runs/<book>/fanout-plan.json: every run in order, inputs, agents, cost, steps
uv run fanout.py prepare <run-id>      # its packet and its copy work/<book>/packets/embedded/fanout/NNN-<run>.workflow.js
uv run fanout.py prepare --ready       # every run whose inputs now exist
uv run fanout.py status                # prepared / saved / metered, per run
uv run fanout.py config <chapter>      # the per-chapter config S5–S7 read (bundles: course + that chapter)
uv run fanout.py config --final [--write]   # T364: the whole book's `generated` + `parity`, once every bundle exists
```

Every run is a generated copy (`embed_workflow.py`), launched with `Workflow({scriptPath})` and NO args, at most two at
a time and never two S0b passes at once. S0b and S1 copies echo `embedded` like the others. S1 by reference now
carries an earlier chapter's objectives as shards (`prior.txt`, `prior/<id tail>.txt`; args `prior_by_ref`), so a late
chapter's args stay small. A chapter whose S6 author writes no family, or whose S7 author writes no template, skips
the grade / verify run, and its widget bundle is not written (the gap report alone) — never an unverified bundle.

**The step-level working checker** (answer 30; stage `SW`, prompts `sw-v3` since the Chapter 8 calibration of
2026-10-01), per assembled chapter bundle, as TWO independent blind passes (A, then B reshuffled) whose flags are unioned:

```sh
uv run working_check.py precheck --seed seed/<book>/<prefix>-cNN.json          # free: the pre-check only
uv run working_check.py args --book <book> --seed seed/<book>/<prefix>-cNN.json --chapter N --pass-id A \
    --by-ref work/<book>/packets/fanout/wcheck-chNN --out A.json --embed <copy>.workflow.js         # parts past 300 solutions
uv run working_check.py args … --pass-id B --order shuffled --order-seed 11 \
    --by-ref work/<book>/packets/fanout/wcheck-chNN-B --out B.json --embed <copy>-B.workflow.js      # `fanout.py prepare` does both
#   [--batch 5] [--effort high] [--model sonnet] [--only <ids.json | calibration.json>] [--aliases mutants.json]
# run both copies (≤ 2 runs at a time); save each to runs/<book>/working-check/chNN-<A|B>-<runId>.json; meter --stage SW
uv run working_check.py collect --args A.json --args B.json --runs <A run>.json <B run>.json \
    --out runs/<book>/working-check/chNN.flags.json
uv run working_check.py calibrate --truth runs/<book>/working-check/chNN.calibration.json \
    --mutants runs/<book>/working-check/chNN.mutants.json --flags <flags.json>
uv run working_check_mutate.py --seed <bundle> --calibration <calibration.json> --out-bundle <b.json> --out-truth <m.json>
```

One Sonnet agent per BATCH of up to 5 canonical solutions (book questions and worked-example entries with working)
reads each one's question, its multiple-choice options, its figure when the question text does not give the points,
the key and the numbered steps, and reports every step that does not follow (a value not the question's or the
figure's, arithmetic, a sign, a label, a copy error, a last step that is not the key, or a conclusion the steps do not
support), says whether the fault sits in a step or in the question text, and never re-solves its own way or
corrects. Every offered figure is READ in the first turn, with the shards (the prompt names it); the agent is told
never to reconstruct a figure's values from the working (sw-v2 did, and missed Ex8-4:19b in both calibration runs).
Why batches: sw-v1 (one agent per solution) metered $0.161 per solution on Chapter 8, of which ~$0.094 is the
harness's fixed cost per agent (~30K cache-write and ~95K cache-read tokens before a shard is read); a batch shares
it. The tool budget is an instruction in the prompt (the `agent()` hook has no turn cap): the metered run checks it.
Why two passes: the Chapter 8 calibration runs (51 solutions) caught 12 (batch 8 / medium, $0.019 a solution) and
14 (batch 5 / high, $0.027) of the 16 real solutions with the agents alone, and the two missed different ones, so
their union misses only the figure case: independent passes find what a shallow one skipped. A flag both passes
raised (`passes: ["A", "B"]`) outranks one raised by a single pass; every flag goes to a human either way. The free
pre-check evaluates purely numeric relation chains (rounding with "=" to the places shown, mixed numbers, a stated
contradiction and "= undefined" are not flags), and flags a numeric-key question whose working never calculates (the
"stub" rule); it sits beside the shards, never in a prompt. Every flag, with its sources (agent, numeric, stub), is a
backlog item for a human; the content is not changed.
`runs/<book>/working-check/chNN.calibration.json` holds a chapter's classified flags (REAL / REAL-BUT-ELSEWHERE /
FALSE) and a 51-solution subset. It is sw-v1's OWN findings, so it flatters sw-v1 (100% by construction):
`working_check_mutate.py` builds the unbiased set — known-good solutions outside the subset with one injected defect
each (a changed coordinate, a swapped label, a flipped sign, a changed key, a renamed point in the question), the
truth written down — and `calibrate --mutants` scores recall by defect class. Run both on a new prompt version, or a
new model, before it checks a book.
