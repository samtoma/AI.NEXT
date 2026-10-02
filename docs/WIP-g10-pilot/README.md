# WIP: Grade 10 American maths — resume doc (Chapter 8 pilot handoff 2026-09-26; full book complete 2026-10-02)

Resume doc for the feature-003 branch `feat/003-curriculum-tracks-g10-american-math`, written when
the work moved from a local session to a cloud session and kept current since. **Start at "Full book complete — 2026-10-02"
below the standing rules: it is the current state and the current open-decisions list.** The sections after it are the
chronological history (the Chapter 8 pilot, the fan-out plan, and one note per problem found), kept for the record. Read
this first, then `docs/PROJECT_STATE.md`,
`specs/003-curriculum-tracks/` (spec, plan, tasks, traceability, decisions) and the files beside
this one:

- `samuel-answers.md` — Samuel's answers 1–45 for this feature, in his words (44 and 45 added 2026-10-02). **Answer N is decision
  N + 21** in `specs/003-curriculum-tracks/decisions.md` (answer 2 → decision 23 … answer 24 → decision
  45; answer 25 extends decision 45, so decision 46 is unused; answer 26 → decision 47). Answer 1, the
  v0.9.3 hotfix, is not a decision of this feature. (This line used to say "decisions 1–15 … recorded
  as decisions 22–36", which was wrong; corrected 2026-09-27.)
- `integration-backlog.md` — every follow-up (items 1–83), each marked with its status where known.
- `pilot-report.md` — the Chapter 8 pilot's numbers and costs so far.
- `g1-ch8-verdicts.json` — the G1 verdicts Samuel approved (the applied copy is
  `services/extraction/runs/g10-math/objectives/g1-ch08.verdicts.json`).

## Standing rules from Samuel (they bind the cloud session too)

- **Review before commit/push.** Summarise every change and wait for his OK before committing or
  pushing anything; deploy only on his explicit go, and only through GitHub CI
  (`ci-cd.yml` workflow_dispatch), never by hand. This WIP branch was pushed at his explicit request.
- **Never push to `main`.** Coordinate with the peer session "Comment accuracy on noor.reletix.com"
  before any push to main or deploy.
- **One question at a time.** Ask Samuel decisions as single questions with a recommendation.
- **Spec Kit is the bible.** Every dev change updates FRs + traceability in the same work
  (`python3 scripts/traceability.py --check`). Objectives methodology is **not** to be written as a
  requirement yet.
- **Licensing is out of scope** (Samuel's team handles CC-BY/attribution outside the app).
- **Quality over cost** in trade-offs; keep the cost meter running (`meter_run.py`).
- **Prompt hold (ADR-0020):** National (Prep-3) tutor prompts must stay byte-identical
  (`national-prompts.test.mts`); any change needs a named exception.
- Never print secret values; never type passwords or sign in for Samuel.

## Full book complete — 2026-10-02 (tech-writer; read this section first)

*Authority: a status record, not a decision. Written from the orchestrator's run log (2026-10-01 to 2026-10-02), the gate records in
`services/extraction/runs/g10-math/gates/` (g1–g5 per chapter), the coverage reports in `services/extraction/coverage/`,
`uv run meter_run.py summary --book g10-math`, and read-only queries against the pilot database. Where a figure comes from my own
read-only check and not from a record, the text says so. Decisions are in `specs/003-curriculum-tracks/decisions.md`; Samuel's own words are in
`samuel-answers.md`. Everything below this section is the history that led here; where it disagrees with this section, this section wins.
Objective ids are written without the `lo:g10m` prefix (`5s6-1-3` is `lo:g10m5s6-1-3`).*

### Where it stands

- All 14 chapters of Siyavula *Everything Maths* Grade 10 have been through the pipeline and each has a G5 record. The result exists only in the
  **local pilot database `ainext_pilot_g10_ch08`** (course `course:us-g10-math-en`). **Nothing is deployed and nothing is on `main`.** The branch is not
  merged: `origin/main` has 16 commits it lacks (v0.11.0 was released today) and the branch had 662 that `origin/main` lacks when I counted, almost all auto-snapshots.
- Every gate G1–G5 on Chapters 1–7 and 9–14 was an AI auto-pass (decisions 58c and 60). A person decided only Chapter 8's G1 and G2 (Samuel, 2026-09-26).
  So **no person has read the live book questions, the generated questions, the widget questions, the misconception entries or the errata list**. The console
  review backlog is how a person will, and it is the next job (decision 58b, FR-4501…FR-4509).
- **Content in the pilot database, read 2026-10-02.** Book questions: **2,090 live, 64 held for review, 41 rejected**. Generated questions (S6 families):
  **3,137 live** (314 of 336 authored families passed grading; the others were not loaded). Widget questions (S7): **99 live, 4 retired**. Misconception
  entries: **300**. All 65 lessons of the book have objectives loaded. The drift guard (`parity_check.py`) is GREEN for the course: 14 modules,
  211 objectives, 294 prerequisite edges, **2,154 questions in the bundles** (= 2,090 live + 64 held; rejected and retired rows are not counted, answer 45), 616 visuals.
- **Coverage.** Thirteen of the 14 chapters are RED on **completeness only** (two checks: every objective has evidence, and every objective has a live item
  at each of its three tiers); every safety check passes. Chapter 11 is GREEN. Per-chapter detail is in the second table below, and what to do about it is
  open decision 3.
- **Step-level working check (sw-v3, two passes per solution):** 2,556 solutions checked, 300 flags on 270 of them, saved per chapter in
  `runs/g10-math/working-check/chNN.flags.json`. The console reads them as backlog items (migration 039, `app/src/lib/review-gate-working.ts`). A flag is
  never a correction.
- **Errata:** the AI line found 102 printed answers that look wrong and 20 questions whose text was damaged in extraction, chapters 1–7 and 9–14
  (`errata-g10.md`, regenerated today). A question with a wrong printed answer was left out of the bank, never corrected.
- **Cost** (metered ledger `runs/g10-math/cost.jsonl`, API-equivalent, prices as of 2026-10-01): the orchestrator reported 280 runs, 4,394 agents, about
  1.2 billion tokens, about $943. **`meter_run.py summary` today reads 284 runs and $952.70** (see "Could not reconcile", below). By stage: S0b maths
  transcription $285.94, step checker $158.71, S6 families $134.65, S5 misconceptions $122.79, S2–S4 lessons $116.08 (+ $3.00 S4), S1 objectives $73.51,
  S7 widgets $38.72, G2 recommendations $14.77, S0b calibration $4.53. About $153 of the total was spent before the fan-out, on the Chapter 8 pilot
  (metered 2026-09-27); the fan-out itself is therefore about $800, inside the ≈ $0.85–1.1k approved (decision 58e).

### Per chapter: what is in the database

Read from the pilot database on 2026-10-02. "Prerequisite links" counts edges whose destination objective is in the chapter. "Families" is live generated items,
with families that passed grading of those authored (from the run log; Chapter 8 from the pilot).

| Ch | Title | Lessons | Objectives | Prereq. links | Book questions live / held / rejected | Families: live items (passed of authored) | Widgets live | Misconceptions |
|---|---|---|---|---|---|---|---|---|
| 1 | Algebraic expressions | 8 | 29 | 24 | 517 / 6 / 27 | 428 (43 of 45) | 7 | 30 |
| 2 | Exponents | 3 | 9 | 21 | 152 / 0 / 3 | 139 (14 of 15) | 0 | 8 |
| 3 | Number patterns | 1 | 5 | 6 | 75 / 1 / 2 | 140 (14 of 14) | 0 | 4 |
| 4 | Equations and inequalities | 6 | 19 | 30 | 259 / 6 / 9 | 250 (25 of 26) | 20 | 18 |
| 5 | Trigonometry | 5 | 18 | 30 | 210 / 8 / 0 | 150 (15 of 16) | 6 | 23 |
| 6 | Functions | 9 | 37 | 64 | 217 / 22 / 0 | 690 (69 of 78) | 24 | 82 |
| 7 | Euclidean geometry | 4 | 13 | 19 | 103 / 8 / 0 | 250 (25 of 27) | 3 | 19 |
| 8 | Analytical geometry (the pilot) | 5 | 13 | 1 | 149 / 9 / 0 | 110 (11 of 11) | 21 (+ 4 retired) | 29 |
| 9 | Finance and growth | 4 | 15 | 19 | 133 / 0 / 0 | 200 (20 of 22) | 1 | 17 |
| 10 | Statistics | 5 | 16 | 18 | 80 / 0 / 0 | 180 (18 of 20) | 7 | 24 |
| 11 | Trigonometry | 1 | 3 | 10 | 24 / 0 / 0 | 70 (7 of 7) | 1 | 4 |
| 12 | Euclidean geometry | 1 | 2 | 0 | 6 / 0 / 0 | 20 (2 of 2) | 0 | 0 |
| 13 | Measurements | 6 | 14 | 26 | 74 / 1 / 0 | 210 (21 of 21) | 1 | 18 |
| 14 | Probability | 7 | 18 | 26 | 91 / 3 / 0 | 300 (30 of 32) | 8 | 24 |
| | **Book** | **65** | **211** | **294** | **2,090 / 64 / 41** | **3,137** | **99 (+ 4)** | **300** |

"Held" = status `review` (an automatic hold: the answer disagrees across the three sources, the marker cannot read the key, or the figure reveals the
answer). "Rejected" = excluded by the G2 recommendation run (a book error or damaged stem), kept in the database for the audit trail and never served.
Chapter 12 has no misconception entries (a proof chapter; S5 produced none) and no prerequisite links (open decision 12).

### Per chapter: gates, coverage and what is missing

G5 is `pass_with_holds` on every chapter except Chapter 11 (`pass`); each says GO "for the fan-out on the dev/pilot database (deploys and promotes nothing)".
G1 is `pass_with_holds` on every chapter with a G1 record except Chapter 9 (`pass`); Chapter 8's G1 was Samuel's and is in `decisions.md`. The completeness columns list the objectives the two coverage checks name. **For Chapters 1–4 these are
from my own read-only `coverage_report.py --check` on 2026-10-02, not from the G5 record** — those records are older than the changes described under
"Could not reconcile". Chapter 8's are from its own G5 record (2026-10-01 07:16Z). Chapters 5–7 and 9–14 are from their G5 records.

| Ch | G1 notes (rulings by an AI line unless marked) | No book question / no claim (objective evidence) | Tier gaps (no live item at the tier) | Step-check flags (solutions) |
|---|---|---|---|---|
| 1 | `1s6-1-4` dropped, 23 items re-homed to `1s6-1-2` (20) and `1s6-1-3` (3) | no claim: `1s4-1-2`, `1s5-1-2`, `1s7-2-4`, `1s7-3-4` | `1s6-1-3` basic; `1s8-1-4` basic and advanced | 55 (53) |
| 2 | none | no claim: `2s4-1-4` | `2s4-1-1` advanced | 8 (8) |
| 3 | none | no claim: `3s2-1-5` | none | 8 (8) |
| 4 | Ex4-7:6q ruled outside the chapter | no claim: `4s3-1-3` | none | 33 (31) |
| 5 | `5s6-1-3` dropped, 19 items to `5s6-1-1`; `5s8-1-4` kept on one finder's evidence, acknowledged as unpractised (no book item uses 0° or 90°) | no book question: `5s3-1-3`, `5s5-1-4`, `5s6-1-3`, `5s6-1-4`, `5s8-1-4`; no claim: `5s5-1-4`, `5s6-1-3`, `5s6-1-4` | those five, at all three tiers | 31 (25) |
| 6 | Ex6-8:28a ruled outside | no book question: `6s2-1-1`, `6s2-1-4`, `6s3-1-4`, `6s6-1-1`, `6s6-3-1`, `6s6-3-2`; no claim: `6s7-1-3` | `6s1-1-1` standard; `6s6-3-3` basic; those six no-book-question objectives at all three tiers | 38 (38) |
| 7 | `7s4-1-2` and `7s4-1-3` dropped, 22 items to `7s4-1-1` (lesson 7.4 keeps two objectives) | no book question: `7s3-1-2` | `7s3-1-2`, all three | 23 (20) |
| 8 | Samuel's own G1 (2026-09-26): 3 items ruled outside | no book question: `8s1-1-1` | `8s1-1-1` all three; `8s1-1-2` standard and advanced; `8s4-1-2` advanced | 27 (25) |
| 9 | none | no claim: `9s3-1-4` | `9s4-1-4` advanced | 14 (13) |
| 10 | none | no book question: `10s2-1-2`, `10s2-1-3`, `10s4-1-3`, `10s5-1-2`; no claim: `10s2-1-4` | `10s1-1-2` standard; the four no-book-question objectives at all three tiers | 13 (11) |
| 11 | none | none (G5 `pass`, 23 of 23 checks hold) | none | 0 (0) |
| 12 | `12s1-1-3` dropped, 7 items to `12s1-1-2`; 0 of 6 prerequisite links kept | no book question: `12s1-1-1` (proofs) | `12s1-1-1`, all three | 6 (6) |
| 13 | `13s1-1-2` dropped, 7 items and Ex13-7:27a to `13s1-1-1`; **lesson 13.1 keeps one objective, CHECK LATER** | no book question: `13s3-2-3`, `13s4-1-2` | those two, all three | 29 (18) |
| 14 | none | no book question: `14s2-1-2`, `14s5-1-2`; no claim: `14s3-1-3` | `14s2-1-2`, `14s5-1-2` all three; `14s3-1-1`, `14s7-1-2` advanced | 15 (14) |

In the G1 column a dropped objective is named by its id before the drop. Where later objectives followed it in the lesson they were renumbered, so the same id
in the coverage columns names a different objective: in Chapter 5 the old `5s6-1-4` and `5s6-1-5` are now `5s6-1-3` and `5s6-1-4`; in Chapter 7 the old `7s4-1-4` is now `7s4-1-2`.

Totals I derived from the table: **33 objectives** fail the evidence check (22 have no book question, 14 have no claim, 3 are in both), and **33 objectives**
lack at least one tier (79 of 633 objective-tier slots). Chapters 2, 3 and 12 also carry a "module widgets" check that holds only because G3 auto-signed the
chapter's widget gaps ("not signed by a person").

### Fixes that landed (2026-10-01 evening to 2026-10-02)

Each is built and tested by an agent, unreviewed by a person. Where to look is in brackets.

- **Worked-example step titles lost their maths.** S0a read a step's heading without its equation images, so "Divide both sides by [expression]" reached the bank as
  "Divide both sides by". 138 of 571 titles, 81 worked examples, 209 images. Found 2026-10-01 evening; the source adapter now keeps them and `repair_step_titles.py`
  repaired saved runs, bundles and the database with no model call: Chapters 1–4 and 8 on 2026-10-01 (61 files, 382 strings; database: 32 questions and 4 entries,
  `canonical_solution` only), Chapters 5, 6, 7, 9 and 10 on 2026-10-02 (Chapter 5 was a text-only database reload). Chapter 11's S1 run, made on the old text, was
  refused at assembly (packet hash differs) and re-run on the repaired packet ($1.82). Not rewritten, only listed: S1 evidence quotes, S2 claims, S5 flags, step-check
  flags. [runbook §12; `work/g10-math/backups/step-title-repair-*`]
- **Notation rules.** (1) The book's coordinate pair `(x; y)` is written `(x, y)` in every field a student reads, not only in question text: objective labels and
  descriptions, a figure's drawn text, and widget templates (pipeline normalisation `coordinate-notation`). Chapter 5 failed the coverage `notation` safety check on
  eight spans before this. (2) A set's list commas get a space, `\{1, 2, 3\}`, so the notation check no longer reads `1,2` as a decimal comma (normalisation
  `set-list-spacing`; Chapter 14's two Venn templates, 10 spans). (3) A set of comma pairs, the book's `\{(1,1);(1,2);…\}`, had been read as a set of decimals and was
  stored as `\{(1.1), (1.2), …\}`, a wrong sample space that the check could not see; fixed in `_set_pair_commas` (counter `pair_in_set`), one question (Ex14-8:22a) changed. [runbook §13]
- **Nested `$` inside `\text{}` and a stray environment (Chapter 13).** `\text{cm$^{3}$}` broke the app's maths splitter and failed the KaTeX gate at close-out; the assembly
  now writes `\text{cm}^{3}` (47 strings in Chapter 13; Chapters 1–12 unaffected). The same pass repairs one doubled `align`/`\end{answer}` in Ex13-4-1b
  (`repair_stray_environment`; **it edits the book's text in one question and is easy to veto**). An earlier cousin, the escaped `\$` in Chapter 9, was fixed 2026-10-01
  (`escaped_dollars_normalised`). [`assemble_lesson_bundle.normalise_nested_dollars`; the Chapter 9 section at the end of this file]
- **Parity counts servable rows only** (Samuel, answer 45, decision 66): rejected and retired questions, and the visuals attached only to them, are not counted. This
  unblocked Chapter 5's G5 (database 1,433 questions against the bundles' 1,392; 212 visuals against 209; the difference was the 41 rejected rows and 3 picture visuals).
  [`parity_check.py`; FR-4207 amended, FR-904 cross-note]
- **G1 rule 4 relaxed once, with a note** (Samuel, answer 44, decision 65): a lesson may keep one objective when G1 dropped another under a recorded ruling; it is a
  warning marked CHECK LATER, never a pass without a ruling. First use: lesson 13.1. [`assemble_objectives.rule4_check_later`; FR-4509 amended; open decision 2]
- **S6 family spec fixes**, each recorded in the spec file's `notes` as a `PIPELINE NORMALISATION` line (41 spec files carry one such line in all; find them with
  `grep -rl "PIPELINE NORMALISATION" services/extraction/families/g10-math services/extraction/widgets/g10-math`): Chapter 9, a conditional formatter in `percentdeposit`
  and an `n ≤ 10` integer-overflow bound in `increase-years`; Chapter 10, four families whose `context` was cleared to null (open decision 10); Chapter 6, eight
  families (one `context`-null; five `values` markers written `a = x; q = y` rewritten `[x, y]`; two equation markers `f(x)=` rewritten `y=`); the family engine's earlier
  fixes (recurring-decimal reader, `distinct_by_choices`, let-guard, decimal form, plain-comma `values` key, slug renames) are in the dated Chapter 1–4 notes further down this file.
- **S7 template fixes:** the reserved word `from` as a field name in five double-inequality and shift templates (Chapter 4 ×3, Chapter 6 ×2) renamed `from_v`; a stray null key
  `parent_question_id_note` removed from a Chapter 9 template. Both recur (open decision 11).
- **Chapters 6 and 9: S5 drafts re-run** on the corrected bundles (2026-10-02 07:04Z): the first drafts had been built before the G2 recommendations and the step-title repair.
  The superseded runs are archived in `runs/g10-math/records/*.superseded.record.json` and metered; the re-runs cost $7.56 (Chapter 6) and $2.44 (Chapter 9). Quality over
  cost, answer 42. Chapters 1–5 were not re-run (open decision 24).
- **G2 recommendations applied to every chapter except 8** (Chapters 1–5 on 2026-10-01, 6–14 on 2026-10-02): `fanout.py close-chapter` now runs the recommendation
  stage; the 41 rejected book questions (all in Chapters 1–4) come from it.
- **Step checker adopted at `sw-v3`** (two passes, calibrated 2026-10-01: 16 of 16 real flags found, 0 false, $0.052 a solution), after `sw-v1` cost 3–5× its estimate on
  Chapter 8. The book total is $158.71, not the ≈ $430 the sw-v1 rate projected.

### Open decisions after the full-book run

*This list replaces "Blocking, or for Samuel" (below, in the 2026-10-01 fan-out plan). It is deduplicated. Group A needs Samuel; B is content waiting for a reader;
C is engineering and records. Where to look is in brackets.*

**A. Needs Samuel**

1. **Exercise-only objectives: a standing policy.** Where an objective's only evidence is end-of-chapter exercises (G1 rule 1 fails), an orchestrator (AI) ruling dropped it and
   re-homed its items: Chapter 1 `1s6-1-4`, Chapter 5 `5s6-1-3` (later objectives renumber), Chapter 7 `7s4-1-2` and `7s4-1-3`, Chapter 12 `12s1-1-3`, Chapter 13 `13s1-1-2`
   (five chapters, six objectives, 78 items re-homed; Ex13-7:27a, which no mapper placed, was placed beside them). Wanted: either a named G1 rule ("drop and re-home") or another handling (keep the objective with
   a note; a new S1 pass per lesson), plus a reconciler fix. **Chapter 7 is the clearest case:** the finders did cite the theorem statement (summary `b03019`) for both dropped
   objectives, but the reconciler left it out and the evidence check never saw it, so an S1 reconcile and evidence-check re-run for that one lesson would likely keep them (a model call,
   not made). Chapter 7's G1 also lists four similarity-statement items placed on `7s4-1-1` as the weakest fit of the 22, and pool items Ex7-8:25, 33a and 35b for review. [`gates/g1-ch01|05|07|12|13.json`, `for_review`]
2. **CHECK LATER (decision 65): lesson `g10m13s1-1` (13.1, area of plane figures) has one objective, by ruling.** Is 13.1 really one objective, or does it get a second
   (a new S1 run for the lesson) or merge with a neighbour? [`objectives/g10-math/ch13.check.json` and `g10m13s1-1.json` (`check_later`); first `for_review` entry of `gates/g1-ch13.json`]
3. **Completeness holds: accept as signed exceptions, or fill?** 33 objectives fail the evidence check and 33 lack a tier (table above). G5 recorded them as findings,
   "not fixed" (answer 37c: a completeness check lists the gap and does not block). A person can sign an exception in the chapter's coverage file (`exceptions`), or the gap is
   filled with new families, widgets or questions. Chapters 5, 6 and 10 hold most of it. The console's completeness panel should read `summary.auto_passed` (asked 2026-10-01; not
   verified). [`gates/g5-chNN.json` `decisions`; `coverage/g10-math.chNN.json`]
4. **Widget gaps and new widget kinds.** G3 auto-signed each chapter's widget gaps, which FR-4306 says a person approves. The per-chapter gap files list **315 gaps and 156 distinct
   proposed new widget kinds** (counted by name on 2026-10-02); none is approved (T356, decision 27). Confirm that auto-passing the gaps is acceptable, and say which kinds to build.
   [`coverage/g10-math.chNN.widget-gaps.json`; `gates/g3-chNN.json`]
5. **`(x; y)` is burned into book pictures.** The text now says `(x, y)`; the book's own pictures, shown as stand-ins until a native figure exists (decision 58d), still print
   `(x; y)`: 69 stand-ins in Chapter 5, likely more in Chapter 8 (not counted). A student sees both. Leave until native figures replace them, hold those questions, or redraw?
   [log 2026-10-02T06:54Z; `app/public/book-figures/g10-math/`; runbook §13]
6. **A choice question with more than five options.** Chapter 6 Ex6-2:7a–f ("which of the six graphs A–F is y = …?") was excluded because the pipeline caps a choice at 2–5 options
   (typing prompt, `choiceProblems`, `assemble_lesson_bundle.choice_option_problems`; not `schemas.py`, not the database). The app's marker already marks a single-letter
   `expression` key, so typing them that way would work (it is how Ex3-1:3 went live; Ex3-1:18 is excluded for six options and could go the same way). Ex6-2:7f also looks like
   a book error (graph C has slope 1/4; no graph is y = x/2). Raise the cap or retype? [`gates/g2-ch06.json`; runbook §3]
7. **Multi-letter marker variables.** Chapter 5 Ex5-4:2a, 2b, 2c and 3 (`AC`, `AD`, `MN`, a side's name) are excluded: `schemas.AnswerSpec` allows one letter, a subscripted letter or a
   Greek name, while the app's marker reads `AC` as one symbol. Either the contract grows `[A-Z]{2,3}` or the agent splits the variables. [this file, "Chapter 5 re-collected and closed"]
8. **Marker and evaluator gaps.** Each currently excludes or holds an item rather than mark it wrongly. (a) The app's marker cannot read a degree sign inside an inequality or interval
   key (`60^{\circ}<\theta<300^{\circ}`: Chapter 6 Ex6-6:17, Ex6-8:42–44, 55a, Ex6-6:20a). (b) Lists of points and lists of equations have no marker kind (Chapter 6: nine and four items).
   (c) The oracle reads "… % per annum" as a different value, so Chapter 9 Ex9-2:8 and Ex9-2:9 (keys 4,3 and 1,8, which the agent's own derivation confirms) stay excluded by the collector's
   identity guard. (d) The S6 evaluator's `parse_plain` does not read `f(x) =` (the app does). (e) A `values` marker is a multiset, so it accepts swapped values (`a`, `q`; Chapter 6).
   Widen the marker (an `AnswerSpec` contract change) or leave held? [this file, "Chapter 6 re-collected and closed"; `gates/g2-ch09.json`; log 2026-10-02T07:30Z]
9. **Widget stem: spacing-only equivalence.** The set-list rule extends when an edited stem counts as "the same stem" for the blind verifier: a whitespace-only change inside maths in a
   stem no longer forces re-verification (`verified_version`, `carried_verification`). Confirm. [runbook §13; log 2026-10-02T07:55Z]
10. **Chapter 10: four families have `context: null`.** The author wrote a fixed word-problem situation into `context`; the pipeline cleared it so the family passes the §3.9 rule
    ("a word problem's context is fixed, only numbers vary", `docs/specs/extraction-pipeline.md` §3.9, `families/spec.py`). Confirm that reading (the `context-null` note is on each spec
    file). [`families/g10-math/ch10/g10m10s1-1-1--*.json`]
11. **Proposed pipeline changes, not applied.** S6 `AUTHOR_RULES` lines (integer overflow; `context` only when the situation is word for word fixed); `spec.py` looking through a
    conditional expression (`IfExp`) so the numeric-hole check sees a formatter; per-family reporting in `generate_questions --check`; and an automatic rename of the reserved word
    `from` in `normalise_templates` plus an S7 author rule against reserved field names (it recurred in Chapters 4 and 6). [log 2026-10-02T07:11Z, 07:18Z, 07:22Z]
12. **Prerequisite links.** Chapter 12 has none: the independent checker judged all 6 proposed links UNCLEAR because the source objectives had no description; a link re-check with
    descriptions would likely keep the congruence → parallelogram-proof link (a model call, not made). Chapter 8 has one link and none to or from any other chapter: the links-only
    S1 pass after Chapter 7's G1 (≈ $0.5–1, consistency review D4) was never built or decided. [`gates/g1-ch12.json`; `consistency-review-2026-09-27.md` D4]
13. **Chapter 7 midsegment widget template** (`g10m7s4-1-1`): the blind verifier found its 7 instances unreachable because the stem omits the triangle's third vertex; only the
    kite, square and rhombus instances (3) are live. Fix or retire. [S7 verify run `wf_783d65e5-6bf`]
14. **Interval display key** (Chapter 6, possibly Chapter 4): the S6 key renderer prints an interval marker as `(lo, hi)` whatever its open/closed flags, so the grader correctly refused
    `tpl:g10m6s1-1-1:bounded-to-interval`; the family was not loaded. **An agent is fixing this now.** [log 2026-10-02T07:32:35Z]

**B. Content waiting for a reader**

15. **The errata list**: 102 printed answers that look wrong, 20 damaged questions. [`errata-g10.md`]
16. **Stem repairs live in the bank**, each carrying a `review_note` that says "stem fixed … not Samuel" (counted in the database on 2026-10-02): Chapter 1 four, Chapter 4 two, Chapter 5 one,
    Chapter 7 one, and eight in Chapter 8 from the multi-part carry-over. The Chapter 1 item `q:g10m1s8-1-2:ex1-10-2p` changes a digit (7 to 11): read it first.
    [this file, "The G2 recommendations applied to Chapters 1–4", (d); "Multi-part exercises"]
17. **20 live generated questions whose model question was rejected**: the 10 variants of family `common-factor-monic` (parent Ex1-8:11, whose printed answer is wrong) and 10 of
    `factor-a` (parent Ex4-7:12s). [same section, (a)]
18. **Ex1-9:17 has no correct key in the book** (the extra `abc` term is in the EPUB's own worked line too); the typing agent's correction was refused. [`errata-g10.md`]
19. **Smaller flags from the run log, not traced to a fix:** the Chapter 2 teaching text of `2s4-1-3` states 2(1)^{1/2} + 1 = 2 (should be 3; a book or transcription slip); Chapter 4 Ex4-7:1h
    has (k+2) in the question and (k+3) in the solution; a Chapter 4 answer, −22/6, is not in lowest terms (the marker accepts equivalents); Chapter 5 `5s8-1-4` is unpractised.
20. **Titles with the step-title root cause that the log says were not changed** (2026-10-01T18:52Z): 20 Chapter 6 heading titles, 7 box titles, 2 Chapter 13 worked-example titles. No
    later line says they were; I could not verify. Check the database text.
21. **The 300 step-check flags** (above), and the multi-part exercises whose later part refers to an earlier one by words only (Chapter 1: 8, Chapter 8: 16;
    `runs/g10-math/multipart-ch01.json`, `multipart-ch08.json`).

**C. Engineering and records**

22. **`lo:g10m8s1-1-1` still has nothing live.** Under answer 40 three families (`plot-a-vertex`, `vertex-on-axis`, `vertical-side`; 30 items) were authored and graded
    (`work/g10-math/fanout/families-s111/`), but the database holds no row for the objective, and Chapter 8's G5 (2026-10-01 07:16Z) still lists it with no book question and no live item
    at any tier. They need loading (the code is built: migration 038, `parent_kind`), then G3 and coverage again. T448 is still unticked and its spec records are pending: FR-1101 (spec 001),
    FR-4304, `data-model.md`, `plan.md` migration 038 row, ADR-0008 §4, `extraction-pipeline.md` §3.9/§3.10, the constitution line ~203 (this file, "Done — 2026-10-01 (family-parent agent)").
23. **Book-level closing steps were not run** (`runs/g10-math/fanout-plan.json` → `closing_steps`). (a) Chapter 8's bundle is only at `services/extraction/work/g10-math/pilot/seed/g10m-c08.json`;
    `work/` is gitignored, so **Chapter 8's seed is not on the branch**, and `seed/g10-math/` holds Chapters 1–7 and 9–14 only (decision in the plan: copy it as reviewed, or re-assemble it
    with the book-picture stand-ins). (b) The whole-book export `seed/generated/g10-math/book-export/` does not exist; `seed/generated/g10-math/export/` is the pilot's 13-objective export.
    (c) `books/g10-math.json` still has `status: ingest` and `parity: null` (T364), so `parity_check.py --all-courses` skips this course; G5 reads the loaded config
    `runs/g10-math/fanout/loaded/g10-math.json` instead. (d) No whole-book coverage report (`coverage/g10-math.book.json`). Without (a)–(c) the course cannot be exported for "Load a course".
24. **S5 misconception drafts for Chapters 1–5 were built before the G2 recommendations went in** (live book questions rose by 34, 16, 4, 12 and 15 afterwards) and were not re-run, whereas
    Chapters 6 and 9 were. No decision is recorded either way. At ≈ $1.3 an objective, quality over cost (answer 42) points to a re-run; it is Samuel's call. [log 2026-10-02T07:04:36Z]
25. **Records older than the database.** The G5 records of Chapters 1–4 (2026-10-01 17:40–18:07Z) predate the G2 recommendations, the step-title repair and the servable-only parity rule; Chapter 8's
    (07:16Z) predates the fan-out; Chapter 14's (stamped 2026-10-02 07:49Z) may predate one text-only reload, the pair-in-set fix, logged at 07:55Z. Re-run `auto_pass_gates.py g5` for them, or the book-level closing run, so the
    records match the database.
26. **The app's maths splitter knows no nesting and no escaped dollar** (`components/TeXRenderer.tsx` splits on `/(\$[^$]+\$)/g`; the same split is in `lib/math-text.ts`, `lib/voice.ts`,
    `lib/tts/sanitize.ts`). The pipeline works around both at assembly; the root cause is in the app. Read-aloud is silent at the new `\textdollar` sign. `load_seed` also counts KaTeX
    errors in held questions. [log 2026-10-02T07:15Z; this file, "Escaped dollar signs"]
27. **Spec Kit debt.** FRs and traceability rows still owed for: the family-engine changes (recurring-decimal reader, `distinct_by_choices`, let-guard, decimal form, plain-comma `values` key,
    `s6-v6` prompt, normalise rename rule), the coverage liveness fix (37a), the widened COLLECT-6 comparator, the G1 exercise-only ruling (decision 1 above), the multi-part rule (FR-4303 needs
    the rule itself; this file, "Multi-part exercises"), the G2-recommendation stage, the assembly rules of runbook §§12–13, and the notation rules. Servable-only parity (FR-4207) and rule 4 (FR-4509)
    were written by their agents. Not done in this pass: other agents were editing `specs/003-curriculum-tracks/traceability.md` and the FR text that day. [log 2026-10-01T17:26:46Z, "SPEC-KIT TODO"]
28. **`decisions.md` numbering gap, 62–64.** Answers 41, 42 and 43 (2026-10-01: continue the fan-out on Sonnet 5.5; keep the quality, the credit was raised; a later part of a multi-part exercise
    carries the book's earlier value) are decisions 62, 63 and 64 by the N + 21 rule and are not entered in the decisions table, which jumps from 61 to 65. [`specs/003-curriculum-tracks/decisions.md`;
    `samuel-answers.md` 41–43]
29. **Merge with `main` before any PR.** `origin/main` is 16 commits ahead (v0.11.0, 2026-10-02). A trial merge (`git merge-tree`, nothing written to the tree) reports **15 conflicts**: `app/package.json`,
    `docs/PROJECT_STATE.md`, `specs/002-identity-and-admin-console/traceability.md`, and in app code `ask.ts`, `lesson.ts`, `progression.ts`, `queries.ts`, `types.ts`, `attempts-client.ts`,
    `socratic-probing.ts`, `StudentLoop.tsx`, `SpineExplorer.tsx`, `spine-order-scan.test.mts`, plus two files `main` deleted and this branch changed (`spine/GraphCanvas.tsx`, `spine/LoPanel.tsx`: the
    new Your Progress Map replaced them). **`docs/decisions/0020-mastery-gated-lesson-progression.md` merges with no conflict but wrongly:** both sides number prompt-hold exceptions "fifth", "sixth"
    and "seventh" for different exceptions (this branch: a new course's prompts, the book's names, English only; `main`: Tamer's Your Progress chat and the map's selection), so a clean merge would
    leave duplicates. The branch's "v0.10" label is also taken: `main` already has v0.10.0 (2026-10-01) and v0.11.0, and `tasks.md` T390 still plans a bump to v0.10.0. The branch's CI is red at its last
    run (`383510c`, 2026-09-26) and has been hidden since by `[skip ci]`. T423/T424 (the catalogue's CI proof and rehearsal) are due before merge because the work touches live Prep-3 content. No migration
    collides (`main` has none after 032; this branch has 033–039).

### Could not reconcile or verify

- **Cost.** The orchestrator's figure (280 runs, ≈ $943) and the ledger today (284 runs, $952.70) differ by 4 runs and about $10. I did not find which runs were added. The meter also flags five runs as
  incomplete (`wf_2648747c-cf6`, `wf_ace9e326-ddf`, `wf_e4887b3b-cbd`, `wf_957393ec-d74`, `wf_bfd09dab-0e6`; the last two were stopped and resumed on 2026-10-01) and marks S0b, SW and S0b calibration as
  including unpriced tokens, so the dollar total is a floor. The agent count (4,394) is not in `meter_run.py summary`; I did not recompute it.
- **"All 14 chapters through G5"** is true in the sense that each has a G5 record; the records for Chapters 1–4, 8 and 14 are older than later changes (open decision 25). My own read-only coverage check
  for Chapters 1–4 differs from the recorded G5 only for Chapter 1 (objective evidence 25 of 29, not 24; tier floor 84 of 87, not 83), because the G2 recommendations later put one more of its objectives' questions live.
  I could not check Chapter 8 the same way (its inputs are the pilot's own, outside the fan-out layout).
- **Run-log lines that are malformed**, nothing material: two `SAVED+APPLIED g2rec-ch13/ch14` lines carry a literal `$(date -u +%FT%TZ)` instead of a time (they fall between 07:15Z and 07:17Z), and one line begins
  `20:05 s6-grade-ch02` (the 2026-10-01 17:03Z–17:08Z window).
- **Chapter 12's prerequisite check** is described two ways in the record: "the source objectives have no description" (`checks`) and "it could not see the chapter-7 congruence objective's description"
  (`for_review`). Same event, one root cause (no objective descriptions reached the checker).
- **Chapter 6 live count:** the log says 216 live at load, the database says 217 (239 rows either way). The extra row went live in a later step; I did not trace which.
- **PROJECT_STATE.md and `tasks.md` lag the code** on T448 (built, per the family-parent agent), migration 039 and the console reading the step-check flags; PROJECT_STATE is updated by this pass, `tasks.md` is not (an agent owns it today).

## STATUS UPDATE — 2026-09-26, corrected 2026-09-27 (superseded by "Full book complete — 2026-10-02" above; everything from "Where the pilot stood" down to "Rebuilding" is the older state, kept for the record)

Local session paused for credit safety on 2026-09-26. **Commit status (corrected 2026-09-27):** the work
is not only on disk. After the WIP push `383510c`, an auto-snapshot job has been committing the worktree
every 30 seconds as `wip(003): auto-snapshot … [skip ci]`, and those commits are on the pushed branch
`origin/feat/003-curriculum-tracks-g10-american-math`. None of it is reviewed by Samuel or merged.
**CI on this branch is red and hidden:** the last CI run on the branch, at `383510c` (2026-09-26 07:52Z),
failed its `traceability` and `build` jobs; every snapshot since carries `[skip ci]`, so no CI has run
since. `python3 scripts/traceability.py --check` passes locally (2026-09-27); run CI once deliberately
before any review.

| Stage | State | Run(s) | Cost |
|---|---|---|---|
| S0b maths | done, 853/853 accepted | A/B/C + calib | ≈ $82 (≈ $36 lost to limits) |
| S1 + G1 | done, G1 passed (Samuel) | wf_a70b525d-f44 | ≈ $14 |
| S2–S4 lessons + G2 | done, G2 passed (Samuel, answers 18–25) — 158 marked, 40 worked examples, 3 excluded | 5 runs in runs/g10-math/lessons/ | ≈ $27 |
| S5 draft | done (s5-v4) — 30 entries | wf_97ba80a6-9ad | $6.66 (+$4.59 superseded) |
| S6 families | done — 11 families, all graded PASS | author wf_41c0663f-36d, revise wf_c8f00d37-c28, grade wf_c9fa108d-2eb + wf_c2fc95f0-6ec | ≈ $8.6 |
| S7 widgets | done — 7 templates, 25 widgets reachable. The verifier confirmed 20 claims and refused 23 (decision 47); after the S5-dropped misconception was reconciled, the loaded bundle has **17 active mappings and 22 held** for human review, counted per widget (`seed/generated/g10-math/widget-questions.json`; 11 widgets plain right/wrong). 7 widget gaps (below) | author wf_816352f4-fbc + wf_62e29981-c0a, verify wf_dbca7b50-327 | ≈ $4.7 |
| S5 final | done — 29 confirmed, 2 dropped (UNSUPPORTED) | wf_ed8c8e80-51d | $5.88 |
| Assemble catalogue + generated bundles, load to scratch DB `ainext_pilot_g10_ch08`, coverage, parity | **done 2026-09-27** — see "Run 2026-09-27" and "Reload 2026-09-27" at the end of this file (coverage RED on two items that wait for decisions; parity GREEN) | — | $0 (deterministic) |
| G3 (family sample + 22 held widget claims page `runs/g10-math/g3-mappings-ch08.review.html`), G4 (catalogue), G5 go/no-go | pending Samuel | — | — |

Total metered so far $153.30 API-equivalent (`uv run meter_run.py summary --book g10-math`).
Samuel's answers 1–26 are in `samuel-answers.md`; decisions up to 47 in `specs/003-curriculum-tracks/decisions.md`.
App-side work done this session (in the WIP snapshots, unreviewed): curriculum-isolation fixes (decisions 37–38),
`less_specific` / `answer_only` support, inline align fix — see integration-backlog.md. The consolidated
review of 2026-09-27 (`consistency-review-2026-09-27.md`) lists what must be fixed before Grade 10 goes live
and the decisions owed to Samuel.

## Where the pilot stood on the morning of 2026-09-26 (superseded by the status update above)

| Stage | State |
|---|---|
| G0 manifest (65 lessons) | passed 2026-09-25 |
| S0b maths, chapter 8 | done — 853/853 formulas accepted (558 hash, 282 agreement, 13 third reading); G0b not needed |
| S1 objectives, chapter 8 | done — 13 objectives, all agreed by both blind finders; run `wf_a70b525d-f44` |
| **G1, chapter 8** | **passed 2026-09-26 by Samuel** ("Approve as recommended"); gate record in `specs/003-curriculum-tracks/decisions.md` |
| S2–S4 lessons | 8.2, 8.1, 8.3a done and saved in `services/extraction/runs/g10-math/lessons/`; **8.3b and 8.4 were stopped mid-run and must be re-run** (a Workflow resume only works in the session that started it) |
| S5–S7, assemble/load, coverage, G2–G5 | not started |

Cost so far (API-equivalent, `services/extraction/runs/g10-math/cost.jsonl`): S0b ≈ $82.6 (≈ $36 of it lost
to usage-limit kills), S1 ≈ $14.0 (one rejected run + the rerun), lessons 8.2 $2.28, 8.3a $2.53, 8.1 $2.17.

## Next steps as they stood then (superseded — all five were done on 2026-09-26; do not re-run them)

The current next steps are the open gates and decisions in the status update above, in "3. Open decisions
and backlog" below, and in `consistency-review-2026-09-27.md`.

1. **Investigate the "disputed" rate in the lesson runs before G2.** 8.3a: 20 of 25 items disputed; 8.1: 9 of 15
   disputed + 6 no printed answer. Seen causes: the blind re-solve came back `missing` for figure-dependent items
   (does the blind solver get the figure?); printed answers read from the PDF text layer lose fraction layout
   (`"9 11"` for 9/11); typing checks flag a key vs a sentence-form final answer. These are verification
   calibration faults (like S1's first run), not book errors — fix the causes, never weaken the rule.
2. Re-run lessons 8.3b and 8.4:
   `uv run embed_workflow.py lesson-args g10-math --lessons g10m8s3-2` (and `g10m8s4-1`), then run the generated
   `work/g10-math/packets/embedded/lesson.<slug>.workflow.js` with the Workflow tool and no args.
   Save each return value to `runs/g10-math/lessons/<runId>.json` and meter it
   (`meter_run.py record --book g10-math --stage S2-S4 --lesson <slug> --run <runId>`).
3. Split into per-lesson files: `uv run assemble_objectives.py lesson-runs g10-math runs/g10-math/lessons/<runId>.json`.
4. G2 for Samuel (disputed solutions), including the **book misprint**: Worked example 8, §8.3, p.303 prints
   m_AC = (3−7)/(3−3) — two independent readings agree; it must not reach a student as a canonical step.
5. S5 draft → S6 families → S7 widgets (author, verify) → S5 final → assemble → load into a **scratch DB only** →
   `coverage_report.py` → report output and actual cost to Samuel. Runbook: `services/extraction/runbook/README.md`.

## Rebuilding the local working files in a new environment

`services/extraction/work/` and `docs/Source/*.epub` are gitignored by design. Download Siyavula
"Everything Maths Grade 10" v1.1 (EPUB and PDF) from siyavula.com into `docs/Source/`, then
`uv run source_adapter.py books/g10-math.json` and `uv run build_manifest.py books/g10-math.json`
(see the runbook §1). Packets for S1 and the lesson copies are regenerated by their builders.
Some saved run files name figure paths under the original machine's worktree; the builders
re-derive them from `work/`.

## In-flight work that was stopped at `383510c` — since finished

**Done later on 2026-09-26** (integration backlog, "Isolation fixes — DONE"; spec 003 traceability rev. 5):
all six gaps below are fixed, Samuel answered the two questions they raised (answers 16–17, decisions
37–38), `tsc` is clean and the app's tests pass. The paragraph below is the state at `383510c`, kept for the
record. The one question still open is the `AINEXT_COURSE_GATING` default (last paragraph).

**Curriculum/grade isolation fixes** (at `383510c` an agent was mid-edit in `app/` — it had started rewriting
the bridge reader in `lib/subject-queries.ts`, and `app/` did not type-check there). The audit (2026-09-26) found, for an ordinary
student with course gating on (production: `AINEXT_COURSE_GATING=on`), curricula and grades isolated on every
teaching surface, with these gaps to close before Grade 10 goes live:
1. `lesson.ts` cross-subject bridge hints are read without the course gate (`getLessonBridges`); the "social"
   handoff should not be offered when that course is not visible.
2. `retrieval.ts` follows one prerequisite link without the gate; the scope-guard test misses `seed/<book>/`
   subdirectories; the loader should refuse cross-course prerequisite edges.
3. The student-scope guard classifies whole files as scoped — make it per function.
4. `/spine` (SpineExplorer) and the subject home card merge two maths courses for a student granted the
   other curriculum's maths by an operator — make them per course (task T372); page citations on /spine must
   use the page's own course's book.
5. `session-cache.ts` key lacks a course-scope fingerprint (revocation reaches an open chat only after ≤3 h).
6. Home page copy says "Egyptian Ministry textbook / syllabus 2025–2026" to American students.
Rule: if a fix changes any National golden prompt line, stop and report instead of updating the golden.
**Open question for Samuel:** the code default for `AINEXT_COURSE_GATING` is "off" (grade ignored when off;
curriculum still enforced) — make "on" the default, or refuse to start without it?

## Pipeline state at pause (2026-09-26) — Chapter 8 pilot, after S5 final

Everything below is on disk in this worktree and, since `383510c`, in the unreviewed `[skip ci]` auto-snapshot commits on the pushed branch
(`.claude/worktrees/g10`). Paths are relative to `services/extraction/` unless they start with `docs/` or `specs/`.

**1. Files a new session needs**
- Book config for the pilot: `work/g10-math/pilot/books/g10-math.json` (bundles → the pilot seed). Pilot seed:
  `work/g10-math/pilot/seed/{g10m-course.json,g10m-c08.json,content/}`. `work/` is gitignored — do not delete it.
- Lesson runs (final split, collect-4): `runs/g10-math/lesson/`; drafts `runs/g10-math/lesson-draft/`. G2 verdicts:
  `runs/g10-math/g2.json` (Samuel); G2 page `runs/g10-math/g2-ch08.review.html`. Objectives: `objectives/g10-math/`.
  Maths summary: `runs/g10-math/maths/summary.json`.
- S5: draft `runs/g10-math/misconceptions/draft-wf_97ba80a6-9ad.json`; FINAL `runs/g10-math/misconceptions/final-wf_ed8c8e80-51d.json`
  (29 confirmed, 2 dropped UNSUPPORTED: s1-1-2 swaps-x-and-y-values and one s3-2-3 entry).
- S6: 11 specs `families/g10-math/*.json` (all pass `--check`; two carry a PIPELINE NORMALISATION note, two are
  revise v2). Runs: `runs/g10-math/families/{author-wf_41c0663f-36d,grade-wf_c9fa108d-2eb,grade-wf_c2fc95f0-6ec,revise-wf_c8f00d37-c28}.json`.
  S5 input written: `runs/g10-math/families/s5-distractors.json` (12, graded families only).
- S7: 7 templates `widgets/g10-math/*.json` (two carry a PIPELINE NORMALISATION note). Runs:
  `runs/g10-math/widgets/{author-wf_816352f4-fbc,author-wf_62e29981-c0a,verify-wf_dbca7b50-327}.json`; merged author
  record `runs/g10-math/widgets/author-merged.json` (pass ONLY this to `--gaps`); held-mapping queue
  `runs/g10-math/widgets/pending-review.json` (22 held; 17 active mappings in the bundle — decision 47; the verifier's first count was 23 refused, 20 confirmed); S5 input `runs/g10-math/widgets/s5-distractors.json` (9).
- G3 material: `runs/g10-math/g3-flags.json` (#3's tier), `runs/g10-math/g3-mappings-ch08.review.html` (the 22 held claims, re-rendered 2026-09-27).
- Packets and embedded copies (all runs above are done): `work/g10-math/packets/` and `work/g10-math/packets/embedded/`.
- Scratch DB (127.0.0.1 ONLY): `host=127.0.0.1 port=5432 dbname=ainext_pilot_g10_ch08`. Loaded: the pilot seed (G10 course,
  Chapter 8) and G2's verdicts (stamps); parity GREEN. NOT loaded yet: the S5 catalogue, S6/S7 bundles.
- Code/doc changes of this stretch (uncommitted): `generate_widget_questions.py` (six kinds registered, reachability,
  readings, merge, normalise, decision 47 hold/review), `generate_questions.py` (`--revise-args`, `blind_plain`, graded-only
  S5 distractors), `families/normalise.py`, `widget_spec.py`, `assemble_misconceptions.py`, `render_review_page.py`
  (`--flags`, `--gate g3-mappings`), `runbook/{widgets,families}.workflow.js` (s7-v6, s6-v5 — unused so far), tests,
  `runbook/README.md`, `docs/specs/extraction-pipeline.md`, `specs/003-curriculum-tracks/{spec,decisions,traceability}.md`.

**2. Remaining commands to finish Chapter 8, in order** (from `services/extraction/`; no model calls)
```sh
export AINEXT_DB_DSN="host=127.0.0.1 port=5432 dbname=ainext_pilot_g10_ch08"
B=work/g10-math/pilot/books/g10-math.json; F=runs/g10-math/misconceptions/final-wf_ed8c8e80-51d.json
G="--graph work/g10-math/pilot/seed/g10m-c08.json --graph work/g10-math/pilot/seed/g10m-course.json"
# a. the catalogue, then load it
uv run assemble_misconceptions.py $F --book $B --out seed/generated/g10-math/misconceptions.json $G
uv run load_misconceptions.py seed/generated/g10-math/misconceptions.json --course course:us-g10-math-en
# b. S6 and S7 outputs (graded / verified only; S7 holds unconfirmed mappings — decision 47)
uv run generate_questions.py --families families/g10-math --book $B --catalogue seed/generated/g10-math/misconceptions.json \
    --grades runs/g10-math/families/grade-wf_c9fa108d-2eb.json runs/g10-math/families/grade-wf_c2fc95f0-6ec.json \
    --out seed/generated/g10-math/generated-questions.json --floor-report coverage/g10-math.tier-floor.json
uv run generate_widget_questions.py --templates widgets/g10-math --book $B \
    --verdicts runs/g10-math/widgets/verify-wf_dbca7b50-327.json --gaps runs/g10-math/widgets/author-merged.json \
    --gap-report coverage/g10-math.ch08.widget-gaps.json --pending-review runs/g10-math/widgets/pending-review.json \
    --out seed/generated/g10-math/widget-questions.json
#    (the S5-dropped swaps-x-and-y-values drops plot-the-point's swapped-coordinates diagnostic; wrong-quadrant stays)
# c. reconcile the tags against the catalogue
uv run assemble_misconceptions.py $F --book $B --out seed/generated/g10-math/misconceptions.json \
    --bundle seed/generated/g10-math/generated-questions.json --bundle seed/generated/g10-math/widget-questions.json $G
# d. load both bundles for review (status review, 10% queue)
uv run load_generated_questions.py seed/generated/g10-math/generated-questions.json --course course:us-g10-math-en --sample 10 --seed 20260926 --catalogue-only
uv run load_generated_questions.py seed/generated/g10-math/widget-questions.json --course course:us-g10-math-en --sample 10 --seed 20260926 --catalogue-only
# e. gate pages: G3 (sample + flags), G3 held mappings (all 23), G4
uv run render_review_page.py --gate g3 --bundles seed/generated/g10-math/generated-questions.json \
    --bundles seed/generated/g10-math/widget-questions.json --catalogue seed/generated/g10-math/misconceptions.json \
    --flags runs/g10-math/g3-flags.json --out runs/g10-math/g3-ch08.review.html
uv run render_review_page.py --gate g3-mappings --mappings runs/g10-math/widgets/pending-review.json --out runs/g10-math/g3-mappings-ch08.review.html
uv run render_review_page.py --gate g4 --catalogue seed/generated/g10-math/misconceptions.json --s5 $F --out runs/g10-math/g4-ch08.review.html
# f. after Samuel's G3/G4 verdicts: held mappings → re-run step b's S7 line with --mapping-review <held-mappings export>,
#    step c, then reload the widget bundle; then apply G3 and promote
uv run apply_review_verdicts.py <g3 verdicts export>.json
uv run load_generated_questions.py seed/generated/g10-math/generated-questions.json --course course:us-g10-math-en --promote --sample 0 --catalogue-only
uv run load_generated_questions.py seed/generated/g10-math/widget-questions.json --course course:us-g10-math-en --promote --sample 0 --catalogue-only
# g. export, coverage audit, drift guard
uv run export_generated_content.py --course course:us-g10-math-en --out-dir seed/generated/g10-math/export --dsn "$AINEXT_DB_DSN"
uv run coverage_report.py --book g10-math --chapter 8 --objectives objectives/g10-math --runs runs/g10-math/lesson \
    --seed work/g10-math/pilot/seed --content work/g10-math/pilot/seed/content --generated seed/generated/g10-math/export \
    --maths runs/g10-math/maths/summary.json --widget-gaps coverage/g10-math.ch08.widget-gaps.json --s5 $F --out coverage/g10-math.json
uv run parity_check.py --candidate "$AINEXT_DB_DSN" --all-courses
```
Checks after each code change: `AINEXT_TEST_PG="host=127.0.0.1 port=5432" uv run --with pytest python -m pytest -q tests/`,
`uv run dryrun_chapter.py --book g10-math --chapter 8` and `… --mode inline`, `python3 scripts/traceability.py --check` (repo root).

**3. Open decisions and backlog** (`docs/WIP-g10-pilot/integration-backlog.md`)
- Human gates still to pass: **G3** (10% sample + #3's tier flag, `g3-flags.json`), **G3 held mappings** (16 claims, decision 47),
  **G4** (catalogue sample). The **8** widget gaps in `coverage/g10-math.ch08.widget-gaps.json` need Samuel's sign-off (FR-4306):
  s1-1-1, s1-1-3, s2-1-1, s3-1-1 (gradient formula builder), s3-1-2 (coordinate-from-gradient solver; its template
  is held), s3-2-2 (line relationship classifier), s3-2-3 (collinearity checker), s4-1-3.
  (The pilot report's earlier "6 gaps … the other five stand" predates the re-author of g10m8s3-2, which
  replaced the s3-2-3 template with a collinearity-checker gap.)
- Tier-floor gaps to list by name (FR-4305): s1-1-1 (no markable parent), s1-1-2 standard/advanced (diagram-dependent).
- Backlog open: **75** (Ex8-5:5 excluded pending review), **78** (step-level working checker, decide before fan-out),
  **80** (#3 re-authored and graded; its tier → G3). Closed this stretch: 76, 77, 79, 81, 82, 83.
- Fan-out notes: prompts s6-v5 and s7-v6 are unused so far (revise read rule, bare values, own-list ids, one
  predicate → one misconception, typed readings, bare predicate names).

**Run 2026-09-27 (deterministic steps a–d and g done; gates open).** Loaded into `ainext_pilot_g10_ch08`
(`AINEXT_ENVIRONMENT=mvp1`, as the dry run sets it): 29 misconceptions (35 book options stamped); 110 generated
items from 11 families and 25 widget questions, all `status=review` (17 active mappings, 22 held — the S5-dropped
swaps-x-and-y-values took one active and one held; 11 widgets plain right/wrong). The G3 held-mappings page is
re-rendered (22). Coverage RED: objective_evidence (s1-1-1 has no book question), tier_floor (generated items
are not live until G3; s1-1-1 and s1-1-2 standard/advanced below the floor), notation (107 figure point labels
"P(2;1)" in the pilot seed — the assembly now normalises them; clearing it needs the pilot seed re-assembled and
reloaded, then G2's verdicts and the catalogue re-applied). Parity: National GREEN. The Chapter 8 gap report is
`coverage/g10-math.ch08.widget-gaps.json`; `coverage/g10-math.widget-gaps.json` is the whole-book file (the six
approved kinds; figure_inventory reads it) — never write a chapter's report over it.
**Reload 2026-09-27 (figure labels).** Pilot seed re-assembled (only 92 `visuals[].spec.points[].label` changed,
e.g. `P(2;1)` → `P(2, 1)`); `load_seed --update` updated 38 visuals, questions unchanged; G2 and the catalogue
re-applied (no change); generated content not reloaded (nothing it depends on changed). Coverage RED on two
decisions only — objective_evidence (s1-1-1) and tier_floor (pre-G3) — notation holds. Parity GREEN. The course
gate row, the operator and roles, and course_lessons are unchanged (fingerprinted before and after).

**Consistency review A1–A4/A8/A9 applied (2026-09-27, pipeline side).** Pilot seed re-assembled and reloaded
(`--replace`): 120 glued LaTeX commands re-spaced, 19 assignment chains split, 0 KaTeX errors; every typed
answer is its key rendered; Ex8-6:46c's pair fixed (2 whole-side `(a,b)` listed for G2: Ex8-4:9, Ex8-4:12); Ex8-6:46b
carries `form: {subject: y}`; 16 figures that drew the unknown withheld; 59 book questions showing `[figure]` without
one held at review (99 live). Re-run plan `runs/g10-math/visual-reruns.plan.json` (34 figures, 4 lessons); copies
`work/g10-math/packets/embedded/lesson-visuals.<lesson>.workflow.js`; merge with `merge_visual_reruns.py`, then
re-assemble, `load_seed --replace`, `apply_review_verdicts --g2`, `load_misconceptions`, export, coverage.
**Visuals re-runs merged; 7 G2 stem fixes in (2026-09-27).** Re-split from `runs/g10-math/lessons/wf_*.json` with
`g2.json` (7 items changed), the four re-runs re-merged, re-assembled, reloaded (`--replace`): 105 book questions live,
53 held at review for a missing figure, 0 KaTeX errors, coverage RED only on objective_evidence and tier_floor;
parity GREEN; tester setup unchanged. Next copies: `lesson-visuals-v6.<lesson>.workflow.js` (18 figures,
plan `runs/g10-math/visual-reruns-v6.plan.json`), `widgets.s7-author-r3.workflow.js` (g10m8s3-1, s7-v7),
`widgets.s7-verify-r2.workflow.js` (s3-2-1 with the replacement instance, staged in
`work/g10-math/pilot/widgets-staged/` — copy it into `widgets/g10-math/` only after the verify returns).
**v6 visuals, S7 r3 and verify r2 in (2026-09-27, ≈$1.52 metered).** Four lesson-v6 re-runs merged
(`runs/g10-math/visual-reruns/`; gaps left: 8.2 Ex8-6:38a → polygon_scene, 8.3a WE4 → segment-attached label,
8.3b Ex8-6:29a — Compare rejected, the spec drew A,B,D where the image shows A,B,C). Caption rule (lesson-v7 +
assembly `fix_caption` + coverage `captions`): a caption describes only what is drawn — 4 captions fixed (8.4's
three "midpoint M marked", 8.3b Ex8-6:18c's tick marks). S7: g10m8s3-1 re-authored → no template, two gaps
(gradient_formula_builder, coordinate_from_gradient_solver); s3-2-1 installed with its replacement instance and
accepted on the fresh verify (a re-verification at the current sha now overrides a stale `verified_as`);
points-swapped unconfirmed on all three → held. Pilot reloaded: **119 book questions live, 39 held at review**
(26 by the figure gate, 13 G2-accepted but figureless); 21 widget questions from 6 templates in review
(4 retired, the held s3-1-2 template); mappings 9 active / 16 held (G3 page re-rendered); 8 widget gaps in
`coverage/g10-math.ch08.widget-gaps.json`. Coverage RED only on objective_evidence (s1-1-1) and tier_floor
(pre-G3); parity GREEN; tester setup unchanged.

## Fan-out plan — 2026-10-01 (data-engineer; preparation only, nothing launched, nothing spent)

**Approved by Samuel, 2026-10-01** (`samuel-answers.md` 37a–e): fan out the other 13 chapters (≈ $0.85–1.1k);
gates G1–G4 auto-pass on the AI checks' recommendation, every decision into the console backlog (37c); the book's own
picture stands in for a figure no native type draws (37d). Answer 30: the step-level working checker, re-run on Chapter 8.

**Where everything is** (paths relative to `services/extraction/`):
- The plan: `runs/g10-math/fanout-plan.json` — 190 runs in launch order; each has its embedded copy, what it reads,
  expected agents, cost range, dependencies, the deterministic `before`/`after` commands, where to save the return
  value and the meter command; checkpoints are marked; `closing_steps` finish the book.
- Per-chapter inventory: `runs/g10-math/fanout/inventory.json`. The driver: `fanout.py` (`inventory`, `plan`,
  `prepare <run-id>` / `prepare --ready`, `status`, `config <ch>` / `config --final`, `write-specs`).
- Copies to launch: `work/g10-math/packets/embedded/fanout/NNN-<run>.workflow.js` — `Workflow({scriptPath})` with
  NO args; NNN is the plan order. A run whose inputs do not exist yet is prepared later by `fanout.py prepare <id>`,
  which refuses, naming what is missing, until then.

**Per chapter** (from the EPUB extraction and the G0 manifest; objectives estimated at Chapter 8's 2.6 per lesson):

| Ch | Title | Lessons (sections) | Worked ex. | Items (lessons + end of ch. + shared) | Solutions | Maths images (unique / still to read) | Figures (book / in solutions) | Objectives (est.) | S0b group |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Algebraic expressions | 8 (1.2–1.8) | 21 | 554 (343 + 211) | 575 | 1416 / 880 | 6 / 0 | 21 | g1 |
| 2 | Exponents | 3 (2.2–2.4) | 13 | 152 (73 + 79) | 165 | 421 / 327 | 2 / 0 | 8 | g2 |
| 3 | Number patterns | 1 (3.2) | 3 | 90 (43 + 47) | 93 | 399 / 261 | 12 / 2 | 3 | g2 |
| 4 | Equations and inequalities | 6 (4.2–4.7) | 19 | 270 (169 + 101) | 289 | 1059 / 666 | 17 / 31 | 16 | g3 |
| 5 | Trigonometry | 5 (5.2–5.8) | 12 | 240 (160 + 80) | 252 | 842 / 657 | 69 / 19 | 13 | g4 |
| 6 | Functions | 9 (6.1–6.7) | 25 | 347 (142 + 164 + 41) | 372 | 1266 / 757 | 128 / 82 | 23 | g5 |
| 7 | Euclidean geometry | 4 (7.1–7.4) | 8 | 159 (75 + 84) | 167 | 639 / 355 | 155 / 23 | 10 | g6 |
| 8 | Analytical geometry (pilot, done) | 5 (8.1–8.4) | 13 | 191 (59 + 132) | 204 | 857 / 0 | 58 / 33 | 13 | — |
| 9 | Finance and growth | 4 (9.2–9.5) | 12 | 135 (75 + 60) | 147 | 546 / 328 | 3 / 0 | 10 | g6 |
| 10 | Statistics | 5 (10.1–10.5) | 14 | 102 (51 + 51) | 116 | 650 / 321 | 23 / 20 | 13 | g7 |
| 11 | Trigonometry | 1 (11.1) | 5 | 33 (6 + 27) | 38 | 174 / 55 | 18 / 22 | 3 | g7 |
| 12 | Euclidean geometry | 1 (12.1) | 1 | 40 (15 + 25) | 41 | 230 / 104 | 25 / 7 | 3 | g7 |
| 13 | Measurements | 6 (13.1–13.4) | 20 | 100 (51 + 49) | 120 | 462 / 272 | 136 / 18 | 16 | g8 |
| 14 | Probability | 7 (14.1–14.7) | 8 | 118 (41 + 77) | 126 | 368 / 177 | 40 / 34 | 18 | g8 |

S0b: 5,160 images still to read, each assigned to the first chapter that uses it (none of Chapter 8's re-read),
in 8 groups at batch 50: g1 880 (18 batches), g2 588, g3 666, g4 657, g5 757, g6 683, g7 480, g8 449.

**The order** (≤ 2 runs at a time, never two S0b runs at once; simulated with the pilot's run durations):
1. `001-s6-author-ch08-s111` (S6 for lo:g10m8s1-1-1, the main session's request; ≈ $0.6–1.5) and `002-wcheck-ch08`
   (the working checker on Chapter 8's 192 solutions with working; ≈ $5.8–9.6) — together.
2. S0b by group, pass A → pass B → third reading C (prepared after A and B are saved), g1 (chapter 1) first.
3. S1 chapter by chapter (1–7, 9–14), each after its group's S0b and the previous chapter's G1 auto-pass; prior
   objectives travel by reference (backlog 68).
4. Chapter 1 end to end: its 8 lesson runs → G2 auto-pass → assembly → working check → S5 draft → S6 author/grade
   and S7 author/verify → S5 final → load, coverage, parity. **Go / no-go checkpoint at run 40 (≈ 6.4 h in)**: no other
   chapter's lessons start before it (S0b and S1 continue meanwhile).
5. The other 12 chapters in chapter order, the same chain; the working checks run alongside.

Checkpoints marked in the plan: after run 1 (did s1-1-1 get a family?), run 2 (read every working-check flag before
any other chapter's check), S0b g1 (per-image cost vs $0.024), S1 ch01 (auto-pass verdicts cover every owed
decision), the first lesson run (script size, dispute rate, cost per item), and chapter 1 complete (go / no-go).

**Cost** (API-equivalent; the pilot's measured unit costs, `UNIT_COST` in `fanout.py`):

| Stage | Low | High | Basis |
|---|---|---|---|
| S0b | $260 | $378 | 5,160 images × 2 passes × $0.024–0.035, + pass C on ≈ 3.6% |
| S1 | $78 | $108 | $1.30–1.80 per lesson (60) |
| S2–S4 | $140 | $250 | $0.056–0.10 per item (≈ 2,500) |
| S5 | $151 | $207 | $0.96–1.32 per objective (≈ 157) |
| S6 | $104 | $143 | $0.66–0.90 per objective |
| S7 | $57 | $79 | $0.36–0.50 per objective |
| Working checker (SW) | $81 | $135 | $0.03–0.05 per solution (≈ 2,700, Chapter 8 included) |
| **Total** | **$870** | **$1,299** | + 10–15% contingency (re-authors, visual re-runs, resumes) |

Without the working checker the book's stages come to $789–1,164: the top is ≈ $65 above 37e's $1.1k. The dry runs
× the pilot's real/dry ratios agree (chapter 5: S1 ≈ $6.5, S2–S4 ≈ $13, S5 ≈ $12.6, S6 ≈ $9.2, S7 ≈ $3.2). Wall
clock: ≈ 22.5 h of run time on two lanes, plus checkpoints and the deterministic steps — 2–3 working days.

**Chapter 8 is not re-run and its outputs are not overwritten**: the full book's S0b assembly goes to
`runs/g10-math/maths/book/` (the pilot's `accepted/queue/summary.json` stay); new chapters write
`families|widgets/g10-math/chNN/`, `seed/generated/g10-math/chNN/`, `runs/g10-math/g2-chNN.json`; the whole-book
export is `seed/generated/g10-math/book-export/`; the scratch DB is a new `ainext_fanout_g10` (never
`ainext_pilot_g10_ch08`). The only Chapter 8 runs are the two the plan starts with.

**Built for it (unreviewed, in the auto-snapshots):** `fanout.py` + `tests/test_fanout.py`; `working_check.py` +
`runbook/working-check.workflow.js` + `tests/test_working_check.py` (backlog 78); the S1 prior-objectives shard
(`assemble_objectives.py`, `runbook/objectives.workflow.js`, `tests/test_packet_ref.py`; backlog 68); S0b and S1 echo
`embedded` so they can run as copies (`transcribe-maths.workflow.js`, `objectives.workflow.js`,
`tests/test_embed_workflow.py`); the S0b self-probe command quoted (the worktree path has spaces;
`assemble_maths.py`); the dry run's no-widget-template path (`dryrun_chapter.py`). Prompts adopted: s1-v5,
lesson-v7/collect-5, s5-v5, s6-v5, s7-v7 (the current runbook scripts; the pilot ran older ones).

**Checks (2026-10-01):** dry runs (`dryrun_chapter.py`, stubbed, no spend) pass for chapters 1–8, 11, 12, 14; chapters
9, 10 and 13 stop at the load's KaTeX gate (first blocker below). Pipeline suite: 618 pass; 6 fail in modules being
changed in parallel (loader status policy, migration 035 stamps, the book-picture VIZ kind, a new coverage check) —
none in a file this work touched. `scripts/traceability.py --check` OK.

**Blocking, or for Samuel:** *(rewritten 2026-10-02. The current, deduplicated list is "Open decisions after the full-book run" under
"Full book complete — 2026-10-02", near the top of this file. What became of the eight items that stood here on 2026-10-01:)*

1. *KaTeX: a stripped control space before digits* — **fixed** 2026-10-01 (`respace_latex`, `_digit_escapes`: a backslash followed by a digit becomes `\ `).
2. *`lo:g10m8s1-1-1` has no parent question* — **decided** (answer 40, decision 61) and **built** (migration 038, `parent_kind`); its three families were authored and graded but are
   **not loaded** — open decision 22.
3. *The auto-pass verdicts for G1 and G2* — **built** and used for every chapter's G1 to G5 (`auto_pass_gates.py`).
4. *Chapter 8's prerequisite links to chapters 1–7* — **still open**, never built or decided — open decision 12.
5. *Chapter 8 into the book's seed* — **still open**: Chapter 8's bundle is only under the gitignored `work/` tree — open decision 23.
6. *Budget* — the ledger reads $952.70 for the whole book including the pilot, inside the approved ≈ $0.85–1.1k for the fan-out; no stop was needed.
7. *Spec Kit: the working checker's FR* — written (FR-4411, decision 51). Later pipeline changes still owe FRs — open decision 27.
8. *CHECK LATER, lesson `g10m13s1-1`* — **still open** — open decision 2.

## PAUSED 2026-10-01 — Samuel: "be careful the usage will finish very soon, can you pause?"
*(History, resolved: Samuel resumed the fan-out the same day, answer 41, and it ran to the end of the book. The two runs named below finished; see "Full book complete — 2026-10-02" near the top.)*
Everything stopped on purpose (usage about to run out). Nothing is lost; the auto-snapshot loop (no model use) keeps
committing to the feature branch.
- **Fan-out held** (Samuel dismissed "keep going until the whole book is done?" — wait for his instruction before
  launching anything). Plan: `services/extraction/runs/g10-math/fanout-plan.json` + the "Fan-out plan" section above;
  driver `uv run fanout.py status`.
- **Two runs stopped mid-way — RESUME, don't relaunch** (completed agents come back cached, not re-billed):
  - 002 working check, Chapter 8: `Workflow({scriptPath: "<worktree>/services/extraction/work/g10-math/packets/embedded/fanout/002-wcheck-ch08.workflow.js", resumeFromRunId: "wf_957393ec-d74"})`
  - 003 S0b pass A, chapter group 1: `Workflow({scriptPath: "<worktree>/services/extraction/work/g10-math/packets/embedded/fanout/003-s0b-A-g1.workflow.js", resumeFromRunId: "wf_bfd09dab-0e6"})`
  - Resume only from the SAME session (resume is same-session); from a new session, read each run's journal
    (`~/.claude/projects/-Users-samueltoma-Documents-Claude-Projects-AI-Enthusiasts-PoC-Tutor-School-V1/5dd6b4ce-c4c4-4eab-b8f8-5465c092db24/subagents/workflows/<run id>/journal.jsonl`)
    and hand-author a continuation over the items not yet done. Meter after completion with
    `uv run meter_run.py record --book g10-math --stage SW|S0b --run <wf id> --resumed`.
- **Decided, not built yet:** answer 40 (a teaching item may parent a family → fills 8.1 "Drawing figures from
  coordinates"; run 001 is prepared); spec FRs for the whole-book outline (decision 59; code done).
- **Agent model rule:** pass `model: "sonnet"` to every agent (Samuel, 2026-10-01).
- **Local previews:** Grade 10 student :3010 / console :3011 (DB `ainext_pilot_g10_ch08`), hotfix v0.9.4 student
  :3012 / console :3013 (DB `ainext_hotfix_v094`). The v0.9.4 hotfix still awaits Samuel's review before commit/PR.

## Handoff — students-full agent, paused 2026-10-01

Samuel's answers 33 and 37a–d (+ 39: G5 auto-pass and gate records). **Done** (all uncommitted work is in the auto-snapshots; nothing reviewed by Samuel):
- **Migration 035** `db/migrations/035-human-review-stamps.sql` (+ `rollback/035-…down.sql`): `questions.ai_checked_by/ai_checked_at/hold_reason/review_note`, legacy `reviewed_by` strings split (AI → ai_checked_by, notes → review_note, figure mark → hold_reason, `(G2 hold)` → human_hold), CHECK `questions_held_not_live`; idempotent; rollback round-trips (only bulk-promotion times are lost). Applied to `ainext_pilot_g10_ch08`. No gate table (the console reads record files).
- **Policy** `services/extraction/review_policy.py`; loaders: `load_seed.py` (maths always live unless an automatic hold; never writes reviewed_by), `load_generated_questions.py` (maths implies `--promote`, `--review` opt-out; reload never revives retired/rejected or a human hold; human stamp kept only if content unchanged), `apply_review_verdicts.py` (human stamp only; auto verdicts → ai_checked_by), `export_generated_content.py`, `restore_course_bundle.py`, `dryrun_chapter.py`, `generate_questions.py`, `assemble_objectives.py` (auto G2 signer), `scripts/local-dev.sh`, `scripts/local-docker.sh`.
- **Book pictures** (`assemble_lesson_bundle.py`: `book_image` stand-ins, `book_picture_reveals`, hold reasons, `--no-book-pictures/--figures-out/--figures-dir`; `schemas.py` `book_image` + `Question.hold_reason`; `coverage_report.py` `book_pictures` check + `--public`). App: `components/viz/BookImage.tsx`, `Visual.tsx`, `VizCard.tsx`, `kind-meta.ts`, `render-viz-widget.tsx` (refuses composed book_image), `lib/question-figures.ts` (`bookImageOf`), `lib/provenance.ts` + `content-admin.ts` + console content page (only human stamps count; "AI-checked, awaiting human").
- **Pilot DB** (Ch. 8): generated 110 + widgets 21 promoted live (4 retired stay retired); 30 book_image stand-ins attached (14 images in `app/public/book-figures/g10-math/`), 9 held `figure_reveals_answer` (38b, 38c, 38e, 40a, 40d, 44a, 45a, 29c, 31a); seed live 149/158. G2 re-applied; G3 auto applied (`work/g10-math/pilot/g3-ch08.auto.json`). Coverage RED only on objective_evidence (s1-1-1) and tier_floor (s1-1-1, s1-1-2 std/adv, **s4-1-2 advanced — new, because 29c/31a are held**); parity GREEN (all courses; G10 matches its bundles).
- **Auto-pass** `services/extraction/auto_pass_gates.py` g1 (`--approve`) / g2 (`--lesson-run`, `--recommend`) / g3 / g4 / g5; records in the console's `ainext.gate-decision/1` shape (`app/src/lib/review-gate-records.ts`) under `services/extraction/runs/<book>/gates/<g>-chNN.json` (pilot: g3/g4/g5-ch08.json, parsed OK by the console's parser). Documented in `services/extraction/runbook/README.md` §7a/§7b.
- **KaTeX `\0` fix** in `respace_latex` (`_digit_escapes`: `\` + digit → `\ `), Chapter 8 assembly byte-identical, test added.
- Tests: new `tests/test_review_policy.py`; updated test_course_lessons, test_g2_verdicts, test_load_generated_questions, test_schemas_v2, test_coverage_report, test_objectives, test_assemble_lesson_bundle; app `question-figures.test.mts`, `review-status-scan.test.mts`, `console-curriculum(-db).test.mts`. Last results: pytest 644 passed; app `npm test` 0 fail; DB tests 20/20; `tsc` clean; eslint clean on touched files; both dry runs rc=0 (GREEN, parity GREEN) — dry runs were BEFORE the final auto_pass_gates rewrite and the `\0` fix.

**Half-done / left**: re-run both dry runs after the last edits; FR/traceability updates for the tech-writer (answers 33/37/39: review semantics, `hold_reason`, book_image stand-ins, auto-pass records — answer 29 temporarily reversed); `coverage/g10-math.figure-gaps.json` rule text still says "never a static book image". Somebody's assembly at 09:53 wrote ~420 more images into `app/public/book-figures/g10-math/` (other chapters, default `--figures-out`) — check with the fan-out agent. Decisions for Samuel: the 9 reveal holds (and s4-1-2 advanced tier), family-propagated G3 stamps counted as human, `samuel (poc bulk)`/`local-dev` treated as not-a-review, G1 auto ruling "outside" items (answer 15b wanted a named human).

Verify:
```sh
cd services/extraction
AINEXT_TEST_PG="host=127.0.0.1 port=5432" uv run --with pytest python -m pytest -q tests/
uv run dryrun_chapter.py --book g10-math --chapter 8 && uv run dryrun_chapter.py --book g10-math --chapter 8 --mode inline
uv run parity_check.py --candidate "host=127.0.0.1 port=5432 dbname=ainext_pilot_g10_ch08" --all-courses
cd ../../app && npm test && npx tsc --noEmit
```

## PAUSED AGAIN 2026-10-01 — app restart for Sonnet 5.5
*(History, resolved: after the restart the alias `sonnet` resolved to claude-sonnet-5-5 (verified 2026-10-01 08:05Z) and every run since used it.)*
Samuel: Sonnet 5.5 exists; the app needs a restart to get it. Every pipeline script and agent asks for the alias
`sonnet` (newest Sonnet the app knows), so after the restart everything runs on Sonnet 5.5 with no code change.
**Check first after the restart:** a new agent's transcript should show the new model id (the old one was
`claude-sonnet-5`) — e.g. `grep -o '"model":"[^"]*"' <agent transcript>`.
- Done and saved: **002** working check Ch 8 (`wf_957393ec-d74`, $31.0 metered — 3–5× the estimate; calibration
  sw-v2 in progress, see its handoff note), collected → `runs/g10-math/working-check/ch08.flags.json` (21 flagged).
- Stopped mid-way (resume if the session id is the same, else continue from the journal):
  - **003** S0b pass A, group 1 — `wf_bfd09dab-0e6`, script `work/g10-math/packets/embedded/fanout/003-s0b-A-g1.workflow.js`
  - **001** S6 author for lo:g10m8s1-1-1 — `wf_b6ba10e8-7d3`, script `.../fanout/001-s6-author-ch08-s111.workflow.js`
  - `Workflow({scriptPath, resumeFromRunId})` replays finished agents from cache. NOTE: a resume after the model
    changes re-runs nothing that finished; agents still to run will run on the new Sonnet.
- Agents told to stop with handoff notes: spec records (outline/checker/answer 40), family parent (answer 40),
  working-checker calibration (sw-v2). Re-launch them on `model: "sonnet"` from their notes.

## Handoff — working-checker calibration (sw-v2), paused 2026-10-01

Stopped for the app restart (Sonnet 5.5) before any book-source verification or code change was made. Re-launch
on `model: "sonnet"` (now 5.5) from this note; nothing here needs the old model specifically.

**Flag classification: not started.** Read in full: the run record (`runs/g10-math/working-check/ch08-wf_957393ec-d74.json`,
$30.996817 metered, 192 solutions, 1086 Sonnet calls' worth of input/output tokens dominated by 29.2M cache_read +
6.4M cache_write + 911K output — consistent with the Facts' "agents opened figure images and pixel-measured
coordinates, several wrote long notes") and the collected flags (`runs/g10-math/working-check/ch08.flags.json`:
169 consistent, 21 flagged solutions / 25 flags, 2 unclear). Also read `working_check.py` (sw-v1: precheck/args/collect
CLI, the free numeric pre-check evaluator, `render_shard`/`has_working`) and `runbook/working-check.workflow.js`
(sw-v1: one Sonnet agent per solution, no tool-call cap, no cost guardrail on image opens) and confirmed the
Chapter 8 shard packet is on disk at `work/g10-math/packets/fanout/wcheck-ch08/` (+ `.args.json`, `.precheck.json`)
for source lookups. **Zero of the 25 flags have been checked against the book source yet** — none should be
treated as REAL/REAL-BUT-ELSEWHERE/FALSE until that pass runs. First-glance candidates worth prioritising when
resumed (unverified): the `q:g10m8s1-1-3:ex8-1-5` / `ex8-6-3` pair (flagged `final_answer`, key "D" vs working's
"shape Z" — named in the task Facts as possibly a missing-MCQ-options defect, i.e. REAL-BUT-ELSEWHERE rather than
a working error) and the `q:*:we01`/`ex8-4-19b`/`ex8-6-17` label/wrong_value flags (point swapped for another
point's coordinates — the kind of error the free numeric pre-check cannot catch by design, so these look like the
genuine value of the agent pass). Full flag id list for the resumed pass: `ex8-6-36c` (s2-1-1), `ex8-6-26`×2
(s3-2-2, steps 4 and 5), `ex8-6-38d` (s3-2-2), `ex8-6-46c` (s3-2-2), `ex8-6-42d` (s3-2-3), `ex8-6-27`×2 (s4-1-1,
steps 1 and 2), `ex8-1-5` (s1-1-3), `ex8-6-3` (s1-1-3), `ex8-6-24a` (s2-1-1), `ex8-6-42a` (s2-1-1), `we01`×2
(s2-1-1, steps 2 and 5), `ex8-4-10` (s3-2-2), `ex8-4-19b`×2 (s3-2-2, steps 2 and 4), `ex8-4-1b` (s3-2-2),
`ex8-6-42e` (s3-2-2), `ex8-6-44d` (s3-2-2), `ex8-4-5` (s3-2-3), `ex8-6-17` (s4-1-1), `ex8-6-24c` (s4-1-1), `we10`
(s4-1-1), `ex8-6-46e` (s4-1-3).

**sw-v2: no code changed.** No edits to `working_check.py`, `runbook/working-check.workflow.js`, or
`tests/test_working_check.py`. Design not finalised, but the cost breakdown above points at the fix matching the
task brief: gate figure-image opens behind "the working's claim depends on a figure value not in the text" rather
than letting every agent open images by default, add a hard tool-call cap, keep notes short, and consider a Haiku
pre-screen (consistent-looking solutions skip Sonnet) with Sonnet only on candidates — mirroring the pipeline's
other Haiku-for-yes/no stages. "Flag, never correct" is unchanged. Version bump (`PROMPTS_VERSION`, workflow
`meta`) still needed once the prompt changes.

**Left, in order:** (1) verify all 25 flags against `work/g10-math/packets/fanout/wcheck-ch08/s/*.txt` (and the
EPUB source where a shard's figure reference needs it) and classify with one-line evidence each; (2) write sw-v2
in both files + bump `prompts_version` to `sw-v2`; (3) `uv run fanout.py status` to confirm no S0b run is mid-flight
before touching any other chapter's embedded working-check copy, then regenerate the not-yet-launched ones from
`runs/g10-math/fanout-plan.json` via `fanout.py prepare <id>` / `embed_workflow.py`; (4) add/extend
`tests/test_working_check.py` for sw-v2 and run `AINEXT_TEST_PG="host=127.0.0.1 port=5432" uv run --with pytest
python -m pytest -q tests/` plus the Chapter 8 dry run, offline only (no Workflow launch, no paid model call);
(5) update the fan-out plan's cost estimate for the checker; (6) report flag table + sw-v2 diff + new cost/solution
+ test results + a re-run-Chapter-8-or-keep-sw-v1 recommendation. No commit/push/stash/reset — the loop
auto-snapshots every 30s.

### Update 2026-10-01 (qa-engineer, after the restart): calibration done, sw-v2 built, nothing paid

**Done.** All 25 flags read one by one against the book's own equation images (`work/g10-math/equations/<md5>.png`),
the figures, the sibling exercise parts (`blocks.jsonl`) and the seed. Result, saved as
`services/extraction/runs/g10-math/working-check/ch08.calibration.json` (labels, one line of evidence each, a 51-solution subset):

| | flags | solutions | ids |
|---|---|---|---|
| REAL (the book's working/key, a student meets it) | **18** | 16 | ex8-6-36c (rhombus ⇒ "square"), ex8-6-26 ×2 (m_PR for m_PQ; PR⊥QR), ex8-6-38d (1−4 for 1−5), ex8-6-42d (−2 for 2), ex8-6-24a (the book's solution is only a sketch), ex8-6-42a (missing +), ex8-4-10 ("solve for x"), ex8-4-19b ×2 (AB/BC labels swapped), ex8-4-1b (m_AB×1/m_CD ≠ −1 is false as printed), ex8-6-42e (equal diagonals ⇒ "square"), ex8-6-44d ((3) for (−3)), ex8-4-5 (m_PR for m_PQ), ex8-6-17 (−2−2 for −2+2), ex8-6-24c (M_QR for M_PR), we10 (x₁ for x₂), ex8-6-46e ((8;12) = (x_p/2; y_p/2)) |
| REAL-BUT-ELSEWHERE | **5** | 3 | ex8-6-27 ×2 and we01 ×2: the **question text** is misprinted (ex8-6-27 says N is the mid-point of BC, the working — right — uses AB; we01 says Q where the figure and working say T); ex8-6-46c: m_MN is derived in sibling part 46a and the working relies on it |
| FALSE | **2** | 2 | ex8-1-5, ex8-6-3 ("key D vs shape Z") |

False-flag rate **2 / 25 = 8 %** (2 / 21 solutions), and both are the **shard's** fault, not the model's: the seed has the options (D = shape Z; the
book prints "shape Z") but `render_shard` never printed `choices`, so the agent saw a bare "D". The Facts' guess ("the A–D options may be missing
from the stem: a real content defect") is therefore wrong: the content is fine. Every REAL and REAL-BUT-ELSEWHERE defect is the book's own — the
equation images show them as printed — not an extraction error. 23 of 25 flags were worth a human's time; the 2 "unclear" (ex8-6-39d, ex8-6-44b)
are correct: their stems name points (S, T; E) defined in earlier parts.

**Findings for others.** (1) data-engineer: the assembly serves each part of a multi-part exercise alone, so some stems name points an earlier part
defines (39d, 44b, and 46c's m_MN): one systematic defect, not three; ex8-6-24a has no worked solution at all (sketch only) — answer-only or
teaching-only is a content decision; the two stem misprints (27, we01) are the book's. (2) tech-writer (I did not touch `specs/`): decision 51, FR-4411 (`spec.md:1156`,
`traceability.md:357`) and `tasks.md:718` still say "one blind agent **per solution**", prompts `sw-v1`, "≈ $0.03–0.05/solution" and "calibration in progress, none classified":
now one agent per batch of ≤ 8 solutions, prompts `sw-v2`, sw-v1 measured $0.161 (the $0.03–0.05 is sw-v2's modelled target), 25 flags classified as above; FR-4411 should also say a flag
records whether the fault sits in a step or in the question text (`where`) and that a numeric-key solution with no calculation is flagged for free (the stub rule).

**Why $31.0.** Re-priced from the 207 agent transcripts (matches the meter to the cent): cache writes 6.4 M tokens = **$16.1 (52 %)**, cache reads
29.2 M = $5.8, output 0.91 M of which 0.78 M thinking = **$9.1 (29 %)**. Every agent pays ~30 K cache-write and ~95 K cache-read tokens (the harness's
skills list, CLAUDE.md, tool list) before it reads a shard: **$0.094 per agent**, 65 % of a no-figure agent ($0.137). Figures were only $4–5 (86 opens
in 66 agents, +$0.063 per such agent). So one agent per solution cannot reach $0.05 whatever the prompt says; the fix is to share the fixed cost.

**sw-v2** (`PROMPTS_VERSION`, workflow `meta`/prompts, `working_check.py`; tests `tests/test_working_check.py`, `tests/test_fanout.py`):
- one agent per **batch of 8** solutions (`--batch`), `effort: medium` (`--effort`), `--model` (so a Haiku comparison on the subset is one flag, no code);
- the shard prints **OPTIONS** and what a letter key stands for (`D (shape Z)`); a figure is offered only if the question text gives < 2 points, and a
  batch opens ≤ 3 images in one turn, reading printed labels only (no pixel measuring); the tool budget is in the prompt (the `agent()` hook has no turn cap);
- notes only on flags (`why` ≤ 25 words, `expected` ≤ 12 words naming a value, never a rewritten step; `note` only for "unclear"); new `where` = working | question |
  unsure, so a stem misprint reads as one (ex8-6-27, we01); a multi-part id's dependence on an earlier part ⇒ "unclear", never a flag;
- free **stub rule**: a numeric-key question whose working has no maths and never states a digit of the key is flagged without a model (catches ex8-6-24a);
  with the 3 numeric typos the free checks alone already catch 4 of the 16 real solutions;
- `collect` records the prompts version the RUN used, `where`, `checked_ids`; new `working_check.py calibrate --truth … --flags …` (recall of the real
  defects, returning false flags, controls flagged for a human) and `args --only <calibration.json>` (the 51-solution subset);
- Haiku pre-screen **not built**: after batching the fixed cost is ~$0.012 a solution, a silent Haiku miss costs a real defect, and its recall on the
  label/sign typos is unmeasured; `--model haiku` on the subset answers it for ≈ $0.3.

**Cost (API-equivalent).** sw-v1 measured **$0.161 / solution**. sw-v2 is MODELLED, not metered: ≈ **$0.035 expected, range $0.032–0.05** (fixed
$0.094 ÷ 8, + thinking 1–2 K tokens a solution at medium, + ≤ 3 images a batch). Whole book (2,705 solutions, 342 agents instead of 2,705): **$86–135**
(`fanout-plan.json` SW stage; unchanged in total because the plan's old $0.03–0.05 was right as a target and wrong as a mechanism: sw-v1 on the same
book would have been ≈ $435). Chapter 8 re-run: 24 agents, ≈ $6–10; the 51-solution subset: 7 agents, ≈ $1.5–2.

**Packets and plan.** No SW run other than `wcheck-ch08` was prepared, so there was nothing to regenerate; the plan's `wcheck-chNN` entries now say sw-v2
(agents = ⌈solutions/8⌉, 5 min a wave). Chapter 8's sw-v1 packet, args, pre-check and copy are untouched (the saved flags were collected from them; the
old copy now shows "stale" in `embed_workflow.py verify`, deliberately). Built beside them, not launched: `work/g10-math/packets/embedded/fanout/002-wcheck-ch08-v2.workflow.js`
(full chapter; the plan's `wcheck-ch08` entry now points here) and `002a-wcheck-ch08-cal.workflow.js` (the 51-solution calibration subset, args
`work/g10-math/packets/fanout/wcheck-ch08-cal.args.json`). `fanout.py prepare wcheck-ch08` now writes `…-v2` beside, never over. `fanout.py plan` was regenerated:
only SW entries and the shifted simulated schedule changed (unprepared runs' `order`/copy names moved; prepared copies keep theirs; S0b g1 and the S6 s111 packets were not touched).
Offline validation: pytest 684 passed; both Chapter 8 dry runs rc=0 (parity GREEN); the v2 copies run end to end under the stub runtime with a truth-driven responder
(192 shards in 24 batches and the 51-subset in 7: 0 problems, collect → calibrate = recall 1.0, 0 false repeats).

**Recommendation.** Keep sw-v1's Chapter 8 flags (they are the classified record; its 18+5 real findings go to the backlog now). Before wcheck-ch01, run the
51-solution subset on sw-v2 (≈ $1.5–2), `collect`, and `working_check.py calibrate` must show recall 1.0 on the 16 real solutions, 0 returning false flags,
and a metered cost ≤ $0.06 a solution; read any flagged control (28 of them, 16 multiple-choice shown their options for the first time). A full Chapter 8
sw-v2 re-run is then optional (≈ $6–10; its only extra value is the 16 MCQ and the stub rule). If recall drops, try batch 5 and effort high before going back to one agent per solution.

### Update 2026-10-01 (qa-engineer, after the two sw-v2 calibration runs): sw-v3, two passes, an unbiased set

Main session ran my calibration copies on Sonnet 5.5: **002a** (batch 8 / medium) **$0.96 = $0.019 a solution**, agents alone caught **12 of 16** real
solutions (13 with the free stub rule); **002b** (batch 5 / high) **$1.38 = $0.027**, **14 of 16**. Zero false flags, zero agent flags outside the known-defect set, in either.

**Why both missed Ex8-4:19b (read from the agents' transcripts).** The shard was right (its picture was offered); the prompt was the cause. 19b's points A, B, C exist only
in its figure, the prompt said to open a figure "ONLY if a value … is in no text", and both agents wrote that the values "are not stated in the text … I'd need the
figure" and then **reconstructed B(2,−4), C(−5,2), A(8,3) from the working itself**: with labels back-solved from the numbers, the swapped AB/BC labels look right
("consistent without opening the figure"). A circular check. Fixed in **sw-v3** (not a shard or gating fault; the gate offers the figure correctly): an offered figure is **read in the
agent's first turn with the shards** (the prompt names it per solution, so no discretion and no extra turn), back-solving a figure's values is forbidden, and a TRACE rule makes
every substituted number and every label be matched to its source. The other misses differed between the runs (36c, 17, 24a's stub in a; 46e in b): lapses of a shallow pass,
the agents' thinking shows 8 solutions skimmed in one paragraph, and they are what an independent second pass catches.

**The truth set is biased.** `ch08.calibration.json` is sw-v1's own findings: sw-v1 scores 100% against it by construction, so v2 looks worse next to it than it is, and it holds no defect
that no run found (now stated in the file's `bias` field). The two v2 runs finding nothing outside it (0 on 28 controls) is evidence, not proof: all three runs share one model's blind spots.
**New: `working_check_mutate.py`** builds an unbiased set: known-good solutions outside the subset (sw-v1 consistent) with ONE injected defect each, the truth known by construction:
wrong coordinate in the question, one label swapped, one sign flipped (in a line the free pre-check cannot see), the key changed, a point renamed in the question (the we01 misprint).
Operators leave the free pre-check unchanged; ids look organic (`…:ex8-9-101`); bases never share a run with their original. 40 mutants (8 per class) + the 51 originals = **91 solutions**,
truth `runs/g10-math/working-check/ch08.mutants.json` (regenerated byte-identically by a test).

**Recommendation (quality first).** Whole book: **two independent blind sw-v3 passes, batch 5 / effort high, pass B reshuffled (no batch shared with pass A), flags unioned**,
plus the free pre-check. Evidence: the existing pair's union is **15/16 by the agents**; the pair's overlap (11) matches independent misses (expected 10.5), so two passes at ≈ 87% each
should miss ≈ 0.25 of 16 once the systematic 19b gap is closed. Cost, MODELLED until the pair is metered: **≈ $0.054–0.07 a solution, $146–190 for the book's 2,705** (plan SW stage was $86–135, so +$60 on a $875–1,300 plan).
Alternatives: batch 8 / medium + batch 5 / high pair ≈ $0.047 ($127; measured union 15/16); one pass batch 5 / high ≈ $0.03 ($81, measured 14/16); one agent per solution ≈ $0.16 ($435: no evidence it beats batches,
its 100% is the bias above). A third pass on another model would decorrelate further (Opus ≈ 2.5× a Sonnet pass) — not built; `--model` takes sonnet|haiku only.

**What changed.** `working_check.py`: prompts `sw-v3`; defaults batch 5 / effort high; `args --pass-id --order shuffled --order-seed --aliases`, `figs`/`fig_dir` in the args (the prompt names each figure);
`collect` takes several passes (union, `passes` per flag, `also_kinds`, `single_pass_ids`); `calibrate` adds agents-only recall, per-pass recall, "flagged or unclear" for lost-context defects, and `--mutants` (recall by operator).
`runbook/working-check.workflow.js` (sw-v3 prompt, `figs`, `pass_id`, `order`); `working_check_mutate.py` + `tests/test_working_check_mutate.py`; `fanout.py` (the plan's wcheck runs are two passes; `prepare` builds both, Chapter 8 beside the sw-v1 packet).
**Built, not launched** (`work/g10-math/packets/embedded/fanout/`): **`002c-wcheck-ch08-cal2-A.workflow.js`** and **`002d-wcheck-ch08-cal2-B.workflow.js`** (91 solutions, 19 agents each, 22 figures read; ≈ $2.5 a pass, $5 the pair),
and the full-chapter pair `002-wcheck-ch08-v2.workflow.js` / `002-wcheck-ch08-v2-B.workflow.js` (the plan's `wcheck-ch08`). Args `wcheck-ch08-cal2-{A,B}.args.json`; the bundle is `work/g10-math/pilot/mutants/g10m-c08.cal2.json`.
Score the pair: `working_check.py collect --args …cal2-A.args.json --args …cal2-B.args.json --runs <A run> <B run> --out …` then `working_check.py calibrate --truth ch08.calibration.json --mutants ch08.mutants.json --flags …`.
Pass criteria before wcheck-ch01: all 16 real solutions caught by the agents (union), injected-defect recall per class reported (expect ≥ 0.9 overall; a class below 0.8 needs a prompt change), 0 returning false flags, ≤ $0.07 a solution for the pair.
Offline validation: pytest (all), both copies run end to end under the stub runtime with a truth-driven responder (union plumbing, per-pass and per-class scoring); the two passes share 0 of 19 batches.

## Handoff — family-parent agent (answer 40), paused 2026-10-01

Stopped on the coordinator's word (app restart for Sonnet 5.5), mid-investigation, before any file was
written. **Nothing applied to the pilot DB — no migration exists yet, nothing was run against
`ainext_pilot_g10_ch08` or any scratch DB.**

**Done (research only, no edits):**
- Read answer 40 and confirmed the shape of the fix: `questions.parent_question_id TEXT REFERENCES
  questions(id)` (`db/schema.sql:86`) is a hard FK that cannot point at the explanation-library row a
  teaching-only item actually lives in. `lo:g10m8s1-1-1`'s six drawings are stored (once assembled) as
  `explanation_library` rows (migration 009), id `expl:<lo tail>:<slug>` — e.g.
  `expl:g10m8s1-1-1:ex8-6-4a` — never as `questions` rows, per `assemble_lesson_bundle.py`'s own id table
  (`q:<lo tail>:we03 | q:<lo tail>:ex8-2-5b` for a markable item, `expl:<lo tail>:we03 | expl:<lo
  tail>:ex8-2-5b` for "a not-markable item: teaching material, not a question row, FR-4303").
- Read the prepared candidate shard the author will see:
  `services/extraction/work/g10-math/packets/fanout/s6-author-ch08-s111/o/g10m8s1-1-1.book-questions.txt`
  — each of the six items carries BOTH a `q:`-shaped `id` (e.g. `q:g10m8s1-1-1:ex8-6-4a`, even though no
  such question row exists) AND the real `library_entry` (`expl:g10m8s1-1-1:ex8-6-4a`), plus
  `teaching_only: true`. The embedded packet
  (`work/g10-math/packets/embedded/fanout/001-s6-author-ch08-s111.workflow.js`) is frozen at an OLDER
  prompt that never mentions `teaching_only`/`library_entry`/`parent_kind` — so whatever the author
  writes to `parent_question_id` is not guaranteed to be the `expl:` id. **Not edited** (it is a packet;
  told not to touch it). `runbook/families.workflow.js` (the live script, not frozen, safe to edit later)
  was read but not yet changed either.
- Traced every file that enforces or reads the parent link, confirming the task's list and sizing the
  work: `db/schema.sql` (the FK), `families/spec.py` (`QID_RE`/`check_spec`, `TOP_KEYS`,
  `FamilySpec.parent`), `generate_questions.py` (`Item` dataclass/`as_question`, `build_item` in
  `families/spec.py` which actually assembles `common = dict(..., parent_question_id=spec.parent, ...)`),
  `load_generated_questions.py` (`validate()`, the INSERT column list ~line 444–465 — `parent_kind` is
  not a column yet and the `ON CONFLICT DO UPDATE` clause never touches `parent_question_id`, so adding
  `parent_kind` the same way, INSERT-only, matches existing behaviour), and the app readers:
  `app/src/lib/review-gate-queries.ts` (`questionPayload`: `LEFT JOIN questions p ON p.id =
  q.parent_question_id` — degrades to a null `parentStem` for a teaching parent today, not a crash, but
  loses the "what was this modelled on" context the reviewer needs) plus
  `app/src/components/console/ReviewItemView.tsx` (`Fact label="Generated from"`),
  `app/src/lib/review-gate.ts` (`QuestionPayload.parentId/parentStem`), and the plain-display-only readers
  `app/src/lib/content-admin.ts`, `app/src/lib/queries.ts`, `app/src/lib/lesson.ts`,
  `app/src/lib/types.ts` (`Provenance.parentQuestionId`), `app/src/components/spine/QuestionModal.tsx`,
  `app/src/app/(console)/content/page.console.tsx` — these last ones just print the id string and are not
  strictly broken by an `expl:` value, but were in scope to annotate with the kind.
- Confirmed migration numbering: **038** is free, rollback alongside it, and
  `deploy/apply-migrations.sh`'s floor comment/check (`172–176`) needs `36` → `37` only if 038 lands.
  Confirmed grants need no change (`questions`/`explanation_library` already carry table-level
  SELECT/UPDATE for `ainext_app`/`ainext_operator`, migration 017 — no column-level restriction on
  `questions` that a new column would fall outside of).

**Decided but NOT written (the plan for whoever resumes this):**
1. **Migration 038** (+ `rollback/038-*.down.sql`): add `questions.parent_kind TEXT NOT NULL DEFAULT
   'question' CHECK (parent_kind IN ('question','teaching'))`; drop the blanket
   `questions_parent_question_id_fkey`; replace it with a `BEFORE INSERT OR UPDATE OF
   parent_question_id, parent_kind` trigger that checks existence in `questions(id)` when
   `parent_kind='question'`, or in `explanation_library(id) WHERE entry_type='worked_example'` when
   `parent_kind='teaching'` (a trigger, not a second FK column, because Postgres has no either-or FK —
   two nullable FK columns was the other option considered and rejected: it would mean touching every
   writer twice instead of once). Existing rows get `parent_kind='question'` for free from the column
   default — no backfill statement needed, no behaviour change for any existing family.
2. **`families/spec.py`**: add `EXPL_RE = re.compile(r"^expl:([a-z0-9-]+):[A-Za-z0-9._-]+$")`,
   `PARENT_KINDS = ("question", "teaching")`, `"parent_kind"` to `TOP_KEYS`, a `FamilySpec.parent_kind`
   property defaulting to `"question"` (so every existing spec file, which has no `parent_kind` key, is
   unchanged), and in `check_spec` pick `QID_RE` or `EXPL_RE` by `parent_kind` before the existing
   lo-tail-match check. **Must keep the exact substring "not a question of"** in the question-kind
   error — `tests/test_family_spec.py::RefusedSpecs.test_each_rule` asserts on it — and give the
   teaching-kind mismatch a parallel but distinct message ("not a teaching item of").
3. **`generate_questions.py`**: add `parent_kind: str = "question"` to the `Item` dataclass and to the
   dict `as_question()` builds. **`families/spec.py::build_item`**: add `parent_kind=spec.parent_kind` to
   its `common` dict (one line, next to the existing `parent_question_id=spec.parent`).
4. **`load_generated_questions.py`**: add `parent_kind` validation in `validate()` (unknown kind refused;
   a `teaching`-kind id must match the `expl:` shape, a `question`-kind id the `q:` shape) and one more
   column in the INSERT list/VALUES (`q.get("parent_kind") or "question"`) — INSERT-only, not added to
   the `ON CONFLICT DO UPDATE SET` clause, matching how `parent_question_id` itself is already excluded
   from that clause today (a reload never changes what a family was modelled on).
5. **App**: widen `review-gate-queries.ts`'s `questionPayload` join to
   `LEFT JOIN questions p ON p.id = q.parent_question_id AND q.parent_kind = 'question'` plus
   `LEFT JOIN explanation_library te ON te.id = q.parent_question_id AND q.parent_kind = 'teaching'`,
   select `q.parent_kind`, and for the teaching case read `te.content->0->>'text_md'` as `parent_stem`
   (the first content element of a book-extracted teaching entry is always `{"kind": "problem",
   "text_md": <the original stem>}` — confirmed at `assemble_lesson_bundle.py` around its `fate ==
   "teaching"` branch). Add `parentKind` to `QuestionPayload` (`review-gate.ts`) and show it in
   `ReviewItemView.tsx`'s `Fact label="Generated from"` (e.g. "Generated from (teaching item)"). The
   other four plain-display readers are lower priority — they just print the id string, which is already
   self-describing via its `expl:`/`q:` prefix — but add `parentKind` through `types.ts`,
   `content-admin.ts`, `queries.ts`, `lesson.ts` for consistency if time allows.
6. **Tests to write**: `tests/test_family_spec.py` (a `parent_kind: "teaching"` + `expl:` parent spec
   loads and instantiates; an unknown `parent_kind` value is refused by `check_spec`); a
   `load_generated_questions.py` test (teaching-kind question with an `expl:` parent loads; an unknown
   `parent_kind` is refused before any DB write); a DB-level test for migration 038 (insert with
   `parent_kind='teaching'` pointing at a real `explanation_library` row succeeds; pointing at a
   nonexistent row, or at one with `entry_type != 'worked_example'`, is rejected by the trigger; every
   existing `parent_kind='question'` row and insert is unaffected) — run on a **scratch DB first**, per
   the task's instruction, before anything touches `ainext_pilot_g10_ch08`. Re-run both Chapter 8 dry
   runs (`--mode` default and `--mode inline`) after, to confirm nothing else moved.
7. **Spec IDs for the tech-writer**: FR-1101 (the parent is "a book question" today; needs "a book
   question or a book teaching item"), and whatever traceability row cites the
   `parent_question_id REFERENCES questions(id)` FK by name.

Nothing here was applied — no file was edited (this handoff is the only write this agent made), no
migration was created, no test was run. The next agent should re-read `services/extraction/
work/g10-math/packets/fanout/s6-author-ch08-s111/o/g10m8s1-1-1.book-questions.txt` and
`db/schema.sql:71-92` before starting, to confirm nothing moved under it during the restart.

### Done — 2026-10-01 (family-parent agent, answer 40)

**Built, tested, and applied to the local pilot DB (`ainext_pilot_g10_ch08`) after a clean pass on a scratch
clone of it.** A generated family's parent is now a book question OR a book teaching item, with the kind stored.
Nothing was launched, no model was called, no packet or embedded copy under `work/g10-math/packets/` was touched.

- **Representation.** `questions.parent_question_id` keeps its name and holds the book item's id; the new
  `questions.parent_kind` (`'question'` default | `'teaching'`) says which table that id names — a `questions`
  row (`q:…`) or a `worked_example` of `explanation_library` (`expl:…`, what a not-markable item becomes). The
  kind is declared in the spec, the bundle and the row, never inferred from the id's prefix. Every existing row
  and family takes the default and is unchanged (row md5 identical before/after on the pilot DB; no key is
  written to a bundle or an export unless the kind is `teaching`, so every committed file stays byte for byte).
- **Migration 038** (`db/migrations/038-family-teaching-parent.sql`, `rollback/038-family-teaching-parent.down.sql`):
  the column + two CHECKs; the blanket FK is replaced by three CONSTRAINT triggers (not the BEFORE trigger the
  plan above sketched): `questions_parent_exists` (the parent exists in the table its kind names; a teaching
  parent must be a worked example), `questions_parent_not_orphaned` and `explanation_teaching_parent_kept`
  (a parent is never deleted, renamed or retyped from under its children). AFTER ROW, DEFERRABLE INITIALLY
  IMMEDIATE, error class `foreign_key_violation` — the FK's own semantics, including its end-of-statement timing.
  Idempotent, lock-free on re-run (030's rule). Rollback refuses while any teaching-kind row exists.
  `deploy/apply-migrations.sh` floor 36 → 37 (037 files, 002-038).
- **Pipeline.** `families/spec.py` (`parent_kind`, `EXPL_RE`, `parent_problems`, `resolve_teaching_parent`; the
  question-kind messages are unchanged); `generate_questions.py` (`Item.parent_kind`, written to a row only when
  `teaching`; `book_parents`, `parent_problems_in_book` — `--check` now refuses a teaching parent that is not a
  book worked example, and names the `expl:` twin of a question-shaped id); `load_generated_questions.py`
  (kind/id-shape validation before any write, `missing_parents` refuses the whole bundle in words, `parent_kind`
  INSERT-only like `parent_question_id`); `export_generated_content.py` + `restore_course_bundle.py` (the kind
  round-trips; `_norm` treats absent as `question`); `fanout.py` (`write-specs` makes the kind explicit —
  see below; the s1-1-1 shard items gain `parent_question_id`/`parent_kind` for a re-prepare; the plan text no
  longer says "BLOCKED at load").
- **The in-flight S6 author** was shown each drawing under the id it would have as a question
  (`q:g10m8s1-1-1:ex8-6-4a`) and its prompt predates `parent_kind`, so it will most likely write that id with no
  kind. `fanout.py write-specs <run.json> --into work/g10-math/fanout/families-s111` rewrites it, and says so on
  stdout, to `expl:g10m8s1-1-1:ex8-6-4a` + `"parent_kind": "teaching"` (only when the spec declares no kind, and
  only when the book's bundles hold that worked example; `--book <config>` overrides the pilot config). Anything
  it cannot resolve is written as the author wrote it and `--check` refuses it in words. Walked end to end on a
  fabricated author run against the real pilot bundles: landing → `--check` exit 0 → 3 instances validate and
  their parents exist in the pilot DB.
- **App.** `review-gate-queries.ts` joins the parent by its kind (a teaching item's stem is its entry's `problem`
  element, array-guarded); `QuestionPayload.parentKind`; `ReviewItemView.tsx` says "a book teaching item
  (worked example), not a book question". A teaching-parent family is a live, unstamped generated question,
  so it is in the backlog (answer 37a/37b) — asserted in `review-gate-db.test.mts`. The four plain-display readers
  (`content-admin.ts`, `queries.ts`, `lesson.ts`, `types.ts`) print the id string and were left alone: the
  `q:`/`expl:` prefix is self-describing.
- **Tests.** New `services/extraction/tests/test_family_teaching_parent.py` (22: spec accepted / unknown kind /
  mismatch / other objective / existing unchanged; landing; loader; migration idempotent and trigger behaviour;
  live load with no stamp; whole-bundle refusal; export writes the kind only when `teaching`; restore puts it
  back, is a no-op the second time, and refuses a missing teaching parent) and a new case in
  `app/src/lib/review-gate-db.test.mts`. Pipeline suite 684 passed (baseline 644 before this work, the rest are
  other agents' new tests); app `npm test` 1539/1539 with `AINEXT_SCRATCH_PG` set (1474 + 65 skipped without);
  `npx tsc --noEmit` clean; both Chapter 8 dry runs (by-ref and `--mode inline`) exit 0 with output identical to
  the pre-change run apart from scratch DB names (meter total $14.2778 both); `scripts/ci-migrations.sh all`
  against v0.9.3 (empty ×3, upgrade ×2, rollback-then-HEAD) passed; `scripts/traceability.py --check` OK.
- **Not done, on purpose.** `runbook/families.workflow.js` was NOT edited (a prompt, an ai-engineer matter;
  the pipeline does not depend on it; it would also make the one existing embedded copy "stale"): its
  `FORMAT_RULES` could learn `parent_kind` in a future `s6-v6`. Widget templates (`generate_widget_questions.py`)
  still take only a `q:` parent; the database accepts either. Spec/doc amendments are the tech-writer's (list in
  the agent's report): FR-1101 (001), FR-4304 (003), 003 `data-model.md` "Planned, not built — questions.parent_kind",
  `plan.md` migration row 038, `tasks.md` T448 (tick), the 003 traceability row for FR-1101, ADR-0008 §4,
  `docs/specs/extraction-pipeline.md` §3.9/§3.10, constitution line ~203.

## Multi-part exercises: a part carries what it depends on — 2026-10-01 (data-engineer; before any other chapter is assembled)

**The defect** (the sw-v2 calibration, "findings for others"): the line serves each part of a multi-part exercise on its
own, so a later part's words (or its worked answer) can name points or values only an earlier part gives — 39d "Prove
that ST ∥ PR" (S, T are 39b's mid-points), 44b's "= E" (44a), 46c's m_MN (46a). One systematic defect, not three.
**The rule** is `services/extraction/multipart.py` (docs: `runbook/README.md` §11): over a question's parts in book order
— the shared preamble was already carried (the packet's `item_stem` puts the set's instruction and the question's header
in front of every part) — a part carries, straight after the preamble and in the book's own words, **R1** the names an
earlier part introduces ("S and T are the mid-points of PQ and QR", with the point's key when the earlier part is a
marked question), **R2** the preamble's unknown points/variables an earlier marked part works out (`N(x;y)` → "N=(3, 5)",
`U(6;a)` → "a=5"), **R3** a gradient its worked answer uses without working out ("m_MN=−1/3"). Deterministic; never solves
or invents (G2's keys, the book's words); a carry that would state the part's own answer, a held/excluded/teaching/unkeyed
source, or a name in words no pattern reads is **listed, not guessed**. Wired in three places: `assemble_objectives.lesson-args`
(R1 names only — S2–S4's blind solver and typing check now read what a student will; 39c was "undefined" for want of this),
`assemble_lesson_bundle.py` (all rules, whole chapter, across lessons; report `stem_carry`), `apply_review_verdicts.py --g2`
(the human-stamp note). **Chapter 8, reloaded** (assembly → `load_seed --update` → G2 re-applied; scratch DB
`ainext_pilot_g10_ch08` only): **17 stems changed** (8 question rows + 9 teaching entries); the diff against the previous
seed is exactly those 17, status, stamps and hold reasons untouched; 0 KaTeX errors; coverage RED only on the same two
decisions as before (objective_evidence s1-1-1; tier_floor s1-1-1, s1-1-2 std/adv, s4-1-2 adv); both Chapter 8 dry runs
rc=0 and parity GREEN. Examples — 39d: "…$R(1,-2)$ . **$S$ and $T$ are the mid-points of $PQ$ and $QR$.** Prove that
$ST\parallel PR$ ."; 44b: "…[figure] **$E(\frac12,-\frac32)$ is the mid-point of $BD$.** Prove that $ABCD$ is a
parallelogram."; 46c: "…[figure] **$m_{MN}=-\frac13$.** Show that $AB\parallel MN$ ."; also 36b/36c (N=(3,5)), 38d/38e,
42c/42d, 44d, 45b (a=5), 41b (t=−1), 34d/35c/32b/44f (gradients), 35d. **Human stamps:** four carried rows had a G2
stamp (35c, 36b, 41b, 45b): the stamp stays and the review note now reads "stem fixed by pipeline carry-over (…) — not
Samuel", which the console shows as "changed after a human signed it" (the orchestrator-stem-fix rule); an auto-pass leaves
no such note. **Unresolved — for the review backlog** (`runs/g10-math/multipart-ch08.json`, each with the earlier parts'
words and keys): 16 parts — `refers_by_words` 13 (8-4:20b, 20c; 8-6:24d, 25e, 29b, 30c, 30e, 31d "Hence", 32b, 35d, 37e,
42d, 42e; 32b/35d/42d are also partly carried), `no_source` 4 gradients no earlier part asks for (30e m_AB, which is also a `refers_by_words`, 43d m_AB,
44d m_BD, 44f m_BD). Not detectable by any rule and not listed: a worked answer that uses a bare number from an earlier part
(46e uses A and B from 46c). **For others:** qa-engineer — a sw-v2 re-run on Chapter 8 will no longer say "unclear" for
39d/44b nor REAL-BUT-ELSEWHERE for 46c (the saved sw-v1 flags and `work/.../wcheck-ch08` packets are untouched);
tech-writer (I did not touch `specs/`) — FR-4303 says none is "reshaped silently into a different question": the carry is
recorded (report + review note), but the requirement needs the rule itself (suggested: a part of a multi-part exercise
MUST be served with what it depends on — the names an earlier part introduces and the values it works out — in the book's
words, every changed stem recorded, anything the rule cannot settle listed for a human) and a traceability row; Samuel —
whether values given in a stem (R1 key, R2, R3) are what he wants for the tutor's grounded explanations (they make the
book's working traceable to the stem, and make the part slightly easier than the book's standalone question), and the 16
listed parts.

## Chapter 1 first lessons — the checkpoint, COLLECT-6 / lesson-v8, and the G2 auto-pass — 2026-10-01 (data-engineer)

Four lessons are finished (g10m1s3-1 `wf_cab88c79-c65`, s4-1 `wf_791f61b5-0bb`, s5-1 `wf_6ffd9ec1-5d6`, s6-1 `wf_796b7644-0fb`;
308 items, 56 agents, $6.36 metered). No Workflow was launched and no model was called by this work.

**The 8 validation errors of g10m1s3-1** were not a defect of the run: the saved answers were enough. Four choice items
(Ex1-1:4c, 4g, 8a, 8e) were typed with a key no option carries (the typing agent *invented* the options "rational, integer" and
"rational, integer, whole number and natural number" around a compound answer, or keyed a two-part answer "555; rational"); four
(Ex1-11:5c–f) were "which of these 14 numbers are …?" typed as a choice with the whole list as options (`'ABCDE'[5]` was `undefined`:
options without a key, answer `None`). `RunItem` refused them, so G2's draft page could not even be written. Fix, deterministic and tested
(`tests/test_typing_seam.py`): an item the pipeline flagged and G2 has not ruled on — or has excluded — need not be well formed; an accept,
a fix or a hold requires the full shape again.

**Two systemic defects the checkpoint found** (both in the collection, fixed as COLLECT-6, tests `tests/test_lesson_collect6.py`):
1. *`book_final is not in the book solution`* fired on 23 of s3-1's 96 items, none wrong: a classification's book solution is a sentence and
   the typing agent copies it with a parenthetical dropped. It made 23 items "disputed" (unchecked, not a book disagreement) and, because
   the auto-pass excludes every typing problem, would have excluded them. A final is now in the solution when it is an ordered subsequence
   of it with no skipped negation; a verbal choice settles by the option each source names (no judge).
2. *Invented options.* `options_source: "lesson"` was stretched to constructed responses: s5-1's 28 of 34 items were MCQs of the form
   "3 and 4 / 4 and 5 / 5 and 6" (also "3,0 / 3,1 / 3,2"), the book printing no options. Refused now (a closed set is one-word categories the
   stem or lesson names); typed again from the book's printed key where it is plainly a number (`numeric`) or numbers (`expression`, kind
   `values`, key `4; 5`); anything else keeps the problem and G2 decides. 32 items were typed again in these four lessons.

**Re-collected, not re-run** (`recollect_lessons.py`, journals replayed with identical prompts; the oracle reused when only the answer types
differ; judge verdicts reused for 164 pairs; two new pairs on Ex1-1:1a would need a live judge, but that item is excluded for its figure-label
options anyway): `runs/g10-math/lessons/recollected/<wf_id>.json`. **lesson-v8** (typing prompt only; `runbook/lesson.workflow.js`) is for the
runs still to come: s7-1, s7-2, s7-3, s8-1 and the other chapters. Their copies in `work/g10-math/packets/embedded/fanout/` carry lesson-v7 /
collect-5 and are NOT touched here: prepare them again (`uv run fanout.py prepare lesson-g10m1s7-1` …) before launching. Re-collect before
bumping a prompt (the earlier runs cannot be recollected by a later script).

**G2 auto-pass** (`auto_pass_gates.py g2 … --into runs/g10-math/g2-ch01.json --split`; the pilot's `g2.json` untouched; record
`runs/g10-math/gates/g2-ch01.json`, `ainext.gate-decision/1`; per-lesson finals in `runs/g10-math/lesson/`): 22 exclude (typing problems:
19 in s3-1), 4 accept (s4-1, no printed answer and the blind re-solve agreed), 23 held with no verdict (three-way disagreement), 4 typed not
markable (teaching, no verdict owed), 32 retyped listed. By fate of the 308 items: 256 verified, 23 held, 22 excluded, 7 teaching.
Also fixed: `auto_pass_gates.py g1 --approve` called `approve` without `--maths` (it read the PILOT's `maths/accepted.json`; now the book's
own `maths/book/accepted.json`, with `--objectives-dir`); `fanout.py`'s G1 stamp now is `auto-pass G1 (AI recommendation)` (the console and
`review_policy.is_auto` only know "auto-pass …") and the plan runs `auto_pass_gates.py g1/g2` itself. `auto_pass_gates.py g2` reads no maths
(nothing in it does); `--maths` is forwarded to the `lesson-runs` step `--split` runs.

## g10m1s7-3 would not split: a marker kind its form cannot carry — 2026-10-01 (data-engineer)

`lesson-runs g10-math runs/g10-math/lessons/wf_552eebe2-d46.json --draft` stopped on Ex1-9:11 ("Factorise: $25x^{3}+1$", answer
`(\sqrt[3]{25}x+1)((\sqrt[3]{25})^2x^2-\sqrt[3]{25}x+1)`): the typing agent called it marker kind `surd` with form `factorised`, and
`schemas.AnswerSpec` refuses `factorised` / `expanded` on anything but an expression or an equation (and a subject form on anything but an
equation), so the whole lesson's draft was not written. No model was called; no Workflow launched; `work/g10-math/packets/` not touched.

**Fix** (collection, deterministic; `runbook/lesson.workflow.js`, COLLECT-6; README §3): where the key is plainly algebra in its declared
variables, the KIND becomes `expression` (`equation` when the key has an `=`), the key is kept exactly, and the retype is recorded
(`typing_retyped`, rule `kind-for-form`; `verify.retyped`; the G2 gate record says why). Where the key cannot settle it (interval, coordinates,
list of values, no variable in the key, `decimal` on a surd) the item carries the form-and-kind problem and is held. `simplest` is untouched.
`assemble_lesson_bundle.marker_spec_problems` is the same line in the Python seam for a run an older collection made (flag only; the auto-pass
reads it too). Tests: `tests/test_lesson_collect6.py::KindForForm`, `tests/test_typing_seam.py::MarkerKindForForm`.

**The app's marker reads it**: `\sqrt[3]{25}` inside an `expression` key passes `validateKey`, marks the key, a reordering and a commuted
first factor correct, `25x^3+1` `wrong_form`, and the sign-flipped factorisation `incorrect`; `marker_check.mjs` reads all 44 markers of the
re-collected lesson with nothing rejected or unreadable.

**Status.** Re-collected (no model call): `runs/g10-math/lessons/recollected/wf_552eebe2-d46.json`; `lesson-runs --draft` on it wrote
`runs/g10-math/lesson-draft/g10m1s7-3.json` (pending G2: Ex1-9:17, a printed-answer misprint). Ex1-9:11 is now typed correctly but is still
**disputed**, rightly, not by typing: the blind solver said "cannot be factorised" (it would not factorise over the rationals), the book and its
EPUB factorise over the reals with a cube root of 25. G2 should accept the book's key. No other saved run had an incoherent marker, so
g10m1s7-2 (`wf_5acb7902-ff6`) is unaffected and was not re-collected. The collection is still `collect-6` (same day; the fan-out plan names it);
a lesson-v8 / collect-6 copy prepared before this change lacks the rule — re-collect its run (`recollect_lessons.py`), it is never a re-run.

## Chapter 1 closed up to its remaining runs — G2 for all 8 lessons, assembly, the working check and the S5 draft prepared — 2026-10-01 (data-engineer)

No Workflow launched, no model call, nothing loaded into any database (a dry-run load only). All commands from `services/extraction/`.

**G2 auto-pass, the whole chapter** (`auto_pass_gates.py g2 … --chapter 1 --into runs/g10-math/g2-ch01.json --split`, ONE gate record `runs/g10-math/gates/g2-ch01.json`,
all eight lesson runs; s3-1 s4-1 s5-1 s6-1 and s7-3 from `runs/g10-math/lessons/recollected/`, s7-1 s7-2 s8-1 as saved — `recollect_lessons.py --dry-run` shows today's script
changes nothing for them). The earlier 26 verdicts are preserved byte for byte (merge, not overwrite); the pilot's `g2.json` untouched. The four new lessons: **s7-1** 6 exclude
(typing problems), 5 held (three-way disagreement); **s7-2** 1 exclude, 2 held; **s7-3** 1 exclude (Ex1-9:17: printed answer carries an extra abc term), 3 held (Ex1-9:11, 24, 25), 1 typed again
(Ex1-9:11, `kind-for-form`: the key kept exactly); **s8-1** 5 exclude, 14 held. Chapter: 39 verdicts by the checks' rule (35 exclude, 4 accept), **47 held**, 4 teaching (typed not markable), 33 typed again.
Finals `runs/g10-math/lesson/g10m1s*.json`: 575 items (96, 53, 34, 125, 89, 41, 44, 93). **Ex1-9:11 stays held**: the rule has no accept for a three-way disagreement (the blind solver said "cannot be factorised",
the book factorises over the reals with ∛25); it is for Samuel, or for a G2 recommendation. Of the 47 held, **42 have the printed answer and the book's worked solution equivalent** and only the blind solver differs,
2 have the printed answer differing from the book solution, 1 all three different, 2 all equivalent but still listed — a G2 recommendation agent over the 47 would be the quick way to put most of them live (not in the plan's estimate).

**Assembly** (`assemble_lesson_bundle.py --book g10-math --chapter 1 --report runs/g10-math/fanout/assembly-ch01.json` → `seed/g10-math/g10m-course.json`, `g10m-c01.json`, `seed/content/g10m1s*.json`; the
book's seed paths, never the pilot's): 8 lessons, **29 objectives**, 30 nodes, 54 edges, **533 book questions** (415 expression, 71 numeric, 47 choice; tiers 184 basic / 280 standard / 69 advanced), 7 worked-example entries
(teaching), 234 claims, 42 items not a question (35 excluded at G2 + 7 teaching). **480 live, 53 held**: 47 `answer_mismatch` (the G2 holds above), 6 `unanswerable` (the app's marker cannot mark the key: Ex1-1:7c `√-1` and 7f `14/0`
are not numbers; 7b has an ellipsis; **7d, 10d, Ex1-3:3 carry `\overline{…}`, which the app's marker cannot read at all** — `answer-marker.ts` `fromLatex` turns `\overline{x}` into `x_bar` and the tokenizer refuses `_`; the
bracketed form `0.11(4145)` it does read; a fix is `out.push(/^\d+$/.test(a) ? "(" + a + ")" : a + "_bar")` in its `overline`/`bar` case, an app change for backend-engineer, with its marker tests — not made here). **3 book-picture stand-ins** (Ex1-2:3a–c share one image;
none reveals the answer), 0 held for figure, **KaTeX errors 0**, 14 glued commands re-spaced. **Carried stems 0** (R1–R3 are geometry rules; Chapter 1 has none); **8 parts listed unresolved** for the backlog
(`runs/g10-math/multipart-ch01.json`; all `refers_by_words`: Ex1-11:25b–d "from above", Ex1-2:3c "using you answers", 4b "using you answer", 4c "with your answer", Ex1-4:6c "from the previous", 6d "from earlier").
`load_seed.py … --validate-only` passes (533 questions, 480 verified).
**Fixed on the way:** (1) the typing agent copied 25 questions' keys as the EPUB wrote them, `$(a-3)(a+3)$`; the app's marker refuses the `$` and the assembly held them all "unanswerable" for a delimiter — `unwrap_math_delimiters`
removes one enclosing `$…$` pair at assembly (report `marker_keys_unwrapped`; tests in `tests/test_assemble_lesson_bundle.py`); held-by-marker went 31 → 6. (2) `multipart.py` did not see "Using you answers" (the book's typo): now listed.

**The database.** `ainext_pilot_g10_ch08` is the load target (Samuel's preview), so `fanout.py`'s `FANOUT_DB` now defaults to it (`AINEXT_FANOUT_DB` overrides; the scratch `ainext_fanout_g10` was never created) and the plan
was regenerated (only the DSN text in the steps, three `prepared` flags and the new objective counts changed). **Backup before any chapter-1 load:** `pg_dump -Fc` →
`services/extraction/work/g10-math/backups/pilot-before-ch01.dump` (719,766 bytes, 568 TOC entries, gitignored; a copy in the session scratchpad; DB then held 2,403 questions, unchanged since). **The plan's load line was wrong**: it
used `load_seed.py --all --course … --book …`; `load_seed` has no `--book`, and `--all --course` refuses `books/g10-math.json` while its status is `ingest`. The load is by path, add-only; **dry run against the pilot DB succeeded**:
+30 nodes, +54 edges, **+533 questions (+480 live, +53 review)**, +3 visuals, +8 course lessons, +7 explanation entries, attempts and mastery untouched (rolled back; DB unchanged). **Order matters**: the book-bundle load must come
BEFORE `prepare s7-author-ch01` — the S7 author reads the DB's graph and, unfiltered, would have authored Chapter 8's 13 objectives again; `prep_s7_author` now passes `--only-lessons <the chapter's lessons>` (and refuses, naming them,
a chapter not loaded yet).

**Estimates.** The plan costed Chapter 1 at 21 objectives; the approved G1 files hold **29** (chapter 2: 9 against 8). `fanout.py inventory` now counts objectives from the approved files once G1 has passed
(`objectives_counted`): the plan's S5/S6/S7 for chapter 1 rose from $41.6–57.1 to $57.4–78.9 in total, the plan from $934–1,353 to $956–1,383 (as of this note).

**`fanout.py close-chapter N`** (new; `--dry-run` lists the runs and commands): G2 auto-pass + split, assembly, config, validation, then prepares and verifies the chapter's working check and S5 draft and prints the numbers above.
Idempotent (run again on chapter 1: seed, content, G2 file, finals and copies byte-identical). Chapter 2: `--dry-run` only (it found its three saved runs: `wf_40177b3c-94d`, `wf_aa060013-9f1`, `wf_89dbc00a-57a`); the real run for chapter 2
was not made by this agent (the shell refused it as a change to the shared chapter-2 files) — the main session runs `uv run fanout.py close-chapter 2`, or says so and it will be run here.

**Prepared, verified (`embed_workflow.py verify` OK on every copy), not launched** — `work/g10-math/packets/embedded/fanout/`: `030-s5-draft-ch01.workflow.js` (stage S5, 29 objectives; args by reference);
`044-wcheck-ch01.workflow.js` + `044-wcheck-ch01.part2.workflow.js` (pass A, 300 + 240 solutions) and `044-wcheck-ch01-B.workflow.js` + `044-wcheck-ch01-B.part2.workflow.js` (pass B reshuffled, 300 + 240; no batch shared with A) (stage SW):
540 solutions, 108 agents a pass, 3 figures offered, 0 free pre-check flags; ≈ $29–38. After the runs: `working_check.py collect --args` every part's args (A, A.part2, B, B.part2) `--runs` the four saved files `--out runs/g10-math/working-check/ch01.flags.json`.
S6/S7 (author, grade, verify) and S5 final cannot be prepared before the S5 draft is saved (and, for S7, chapter 1 loaded).

## S0b agreement recognises semantically null differences — 2026-10-01 (data-engineer)

Image `bde9de9fa698b641b04fd37ff2dc1fed` (ch.3, the remainder table of lesson g10m3s2-1) sat "unresolved" after three blind readings that
agree on every value: A and C differed in `{7}^{1}` vs `7^{1}` (a brace round one token), B in its rule markup (`{|l|l}` + `\Big|` for
`{|l|l|}`). `assemble_maths.normalise` (the agreement key; FR-4407: nothing is guessed, this only recognises readings that already agree) now
also drops, and ONLY these, semantically null differences: braces round a single letter, whole number, Greek letter or one parenthesised
expression when the group stands alone (`{7}^{1}`, `{12}^{2}`, `{(3x)}^{2}`; never a group that is a command's/script's argument or holds
several tokens: `x^{12}`, `{a+b}^{2}`, `\frac{7}{5}` keep theirs), doubled and outer braces; `\bigl`/`\Biggr` sizes and the null delimiters
`\left.` `\right.`; `\tfrac` `\cfrac`; `\hspace`, `\phantom`, `\enspace` … and `\\[2pt]`; an array/tabular's column spec (`{|l|l|}`, `{c|c}`,
`{@{}c@{}}`), `\hline`/`\cline`, and a vertical rule drawn as a cell's UNBALANCED leading/trailing bar (`…=2\Big|`; a balanced `|x|`, a bar
mid-cell and a `\left.…\right|` evaluation bar are kept); the minus sign spelt U+2212 (`−` is `-`; an en dash is not touched). Also fixed: a
row separator followed by a space (`\\ x`) lost one backslash to the `\ ` rule, so `a\\ b` never agreed with `a\\b`. A command that takes no
argument (`\cdot{h}`) no longer holds its following group as an argument. Digits, signs, operators, exponents, fraction structure and the
decimal comma are never touched: `tests/test_assemble_maths.py::Normalise` pins both halves, and 28,539 digit/sign and 86,233 structural
mutations of the 6,386 accepted transcriptions produced no false agreement (normalise is idempotent on all of them).

**Effect** on the 14 saved A/B/C runs: agreement 560 → 564, unresolved 2164 → 2163 (images that agreed after normalisation only; none lost,
none re-read by any model). Newly accepted: `bde9de9f…`, the blocked image, by agreement of A and B. Three more, `1555e56c…`, `86f0bd28…`,
`ed18dc6a…` (U+2212 and `\cdot{\text{h}}`), had ALREADY been accepted by a third reading (pass C's text; third reading 15 → 12); with A and B now
agreeing, the assembly takes the first rule that applies, agreement, and stores pass A's text instead of C's (same maths under the key; the
differences are spacing inside `\text{}` and the minus glyph). No other accepted image changed route or text. `lesson-g10m3s2-1` now prepares.

## The G2 recommendation run — prepared for Chapters 1 and 2, not launched — 2026-10-01 (data-engineer)

No Workflow launched, no model call, nothing loaded, no G2 file or DB row touched. Answers 37a and 42 (students always full, quality first, every
decision recorded for Samuel's review): the items the G2 auto-pass **held** (a three-way disagreement) or **excluded** (a typing problem) get a
recommended verdict each, as the Chapter 8 pilot's per-item G2 recommendations did, now as a stage. Runbook §7c; code `services/extraction/g2_recommend.py`,
`runbook/g2-recommend.workflow.js` (prompts `g2rec-v1`), `g2rec_identity.mjs`; `auto_pass_gates.py g2-recommend-args | g2-recommend-collect`; tests
`tests/test_g2_recommend.py` (70; the whole suite is green: 1068 passed).

**How it works.** One Sonnet agent (effort high) per batch of 8 sees each item's stem, figure, the book's own working, printed answer, EPUB final answer, blind
answer, the three-way pairs, the typed shape and typing problems, and recommends accept / fix (the item's new typing, only the book's own answer re-typed) / hold /
exclude with a class, a confidence (`low` = "your call"), a reason and the book span it rests on. One independent agent per batch of verdicts that would put a
question live derives the answer from the stem first and only then judges the key (it is not shown the first agent's reasoning or the blind answer). The collector
(deterministic) refuses to put anything live that: quotes no span of the item's own book text; would not pass `RunItem` / the choice-option and marker-spec rules;
is a key the app's marker cannot read; is NOT equal to the stem's expression or to the answer the book states (the app's own marker, `g2rec_identity.mjs`, no model:
a typing agent's silent correction of a book's answer is refused, it is Samuel's to approve, decisions 43-45); repairs a stem by more than a few characters; or is not
confirmed by the verifier. Everything else becomes `hold` / `exclude` with the reason. An exclude may carry the agent's own derivation (`if_corrected`), never applied.
The gate record (`g2 --recommend`) lists every low-confidence recommendation for Samuel beside the holds and exclusions.

**What the data says before any agent runs** (the app's own marker on the typed key against the stem's expression, for the items whose stem is "Simplify / Expand /
Factorise: …"): Chapter 1, 31 items: key equal to the stem's expression for 7, **NOT equal for 24** (23 of them held); Chapter 2, 5 items: equal 2, not equal 3
(Ex2-1:38, 39, Ex2-2:9). So the "42 of the 47 held have the printed answer and the book's worked solution equivalent, only the blind solver differs" in the note above
**does not mean 42 accepts**: of the 28 held items of that kind, 23 are items where the blind solver was right and the book's printed answer and EPUB answer are both
wrong for the stem as extracted (hand-checked at random points for all of 23f, 23h, 26a, 25b, 2v, 3d, Ex1-8:11 and 21, Ex1-9:24, Ex1-6:13, 30k, 31k, 31l, 3h, 3i, 3l, 3n,
3t, 2g, 2j). Some are the book's own errors (Ex1-10:3h: its own working has "5(t-3) - (t-3)" where "- (t-2)" is meant, so its 4t-12 is wrong, 4t-13 is right);
some are stems the extraction damaged where the book's working shows the intended text (Ex2-1:38: the working's first line has a minus the stem lost, and the book's
51/49 is right for it; Ex1-10:2m, 2o, 31m likewise: a lost exponent, a sign, a lost letter). Expect: a modest number of accepts (the "(i)/(ii)" classification items 10a/10b/17a-j
with the unmarked part named, Ex1-9:11 and 25, Ex1-5:15, Ex1-6:14), a few stem repairs (low confidence, `stem_fix_by` "not Samuel"), and a long exclusion list with the
right answers beside it — an errata list for the book. **Ex1-9:17 is not a "likely fix to the book's worked key":** the extra `abc` term is in the EPUB's own worked line too,
so the book has no correct key; the typed key is the typing agent's correction, which the collector refuses to put live (an exclude with `if_corrected` for Samuel).

**Prepared, verified (`embed_workflow.py verify` OK), in `work/g10-math/packets/embedded/fanout/`** (args beside them in `work/g10-math/packets/fanout/g2rec-chNN.args.json`):
`g2rec-ch01.workflow.js` (82 items: 47 held + 35 excluded; 11 recommending + up to 11 verifying agents; modelled ≈ $4-14) and `g2rec-ch02.workflow.js` (20 items:
3 + 17; 3 + up to 3 agents; ≈ $1-4). Run each with `Workflow({scriptPath})` and NO args (a copy refuses args), save to `runs/g10-math/g2rec/chNN-<runId>.json`, meter with
`meter_run.py record --book g10-math --stage G2R --run <runId>`. `fanout.py close-chapter N` now prepares `g2rec-chNN` for every chapter (it already did for Chapter 3 when the
chapters were closed) and, once `runs/g10-math/g2-chNN.recommended.json` exists, passes it to G2 (`--recommend`): without it every re-run recomputes the checks' own rule and
undoes the recommendation.

**Apply, per chapter** (the commands `g2-recommend-args` prints): `g2-recommend-collect … --out runs/g10-math/g2-chNN.recommended.json`; `auto_pass_gates.py g2 … --recommend … --into
runs/g10-math/g2-chNN.json --split`; assemble and validate (or `fanout.py close-chapter N`); and, because **Chapters 1 and 2 are both loaded in `ainext_pilot_g10_ch08`** (ch1: 483 live,
47 `answer_mismatch`, 3 `unanswerable`; ch2: 136 live, 3 `answer_mismatch`), a fresh `pg_dump` and then `load_seed.py … --course course:us-g10-math-en --update --dry-run` (and the same
without it: adds the newly live questions, releases the held ones the recommendation accepts, applies the typed fixes and stem repairs to unattempted rows) and `apply_review_verdicts.py --g2
runs/g10-math/g2-chNN.json --book g10-math --runs runs/g10-math/lesson` (stamps `ai_checked_by`, rejects what was excluded). **Order:** a chapter's working check and S5 draft are built from the assembled bundle, which a recommendation changes, so the recommendation belongs BEFORE them;
Chapters 1 and 2's working checks have already run (`working-check/ch01-A/B`, `ch02-A/B`), so after applying a recommendation run a **delta working check on the newly live
questions only**: `g2-recommend-collect … --ids-out runs/g10-math/g2rec/chNN.live-ids.json`, then `working_check.py args … --only <that file>`, pass A and pass B reshuffled (the exact
commands are in the list `g2-recommend-args` prints). The newly live questions' working has not been step-checked until then. (For a chapter closed from now on, close-chapter prepares the recommendation copy beside the working check's and the S5 draft's, but it is not in the plan's run list, so
nothing orders it: launch it first, apply it, re-run `close-chapter N`, and only then launch the working check.)

## Chapter 3 re-collected, Chapter 4 re-closed: the key-vs-printed comparison read labels, sentences, ±, fractions and relations — 2026-10-01 (data-engineer)

No Workflow launched, no model call, nothing loaded into any database. All commands from `services/extraction/`. `work/g10-math/packets/` was
written only by `fanout.py close-chapter 3` (chapter 3's own copies); chapter 4's copies were NOT re-prepared (see "To do" below).

**What was wrong.** G2's auto-pass excluded 24 of 93 items of g10m3s2-1 and, after Chapter 4 closed, 75 of its 88 owed items: almost all correct answers the
typing check (`checkTyping`, `runbook/lesson.workflow.js`) could not match to what the book printed: `T4 = −28,1; T5 = …` for the key `-28,1; -33,1; -38,1`, `T1 = −3
and T2 = 3` for `-3; 3`, a numeric key `\frac{9}{10}` ("not a number"), `There are 5 tricycles and 2 bicycles.` for `5; 2`, `b = ±8` for `-8; 8`, an interval or an
inequality list whose print carries a number line's axis or the next part's answer, and "book_final is not in the book solution" on a solution that writes the same
equation the other way round, `\text{and}` without its spaces, or a relation inside an aligned array. The rules are in `runbook/README.md` §3 (COLLECT-6, "A key against an
answer the book printed another way") and pinned in `tests/test_lesson_collect6.py` (`ValueLabels`, `FractionKeys`, `ListsFromSentences`, `Relations`, `InTheBookSolution`:
true matches AND the real mismatches: `a>0; a∈ℕ` for `a > 7; a ∈N`, `b < -4` for `b > 4`, another bracket, a bound, a constraint the key drops, an extra number, a reordered
sequence, `8` for `±8`, `2πr` for `2r`). It only ever accepts a key whose every value, relation, sign and bracket is in the printed answer and which states nothing else.
The Python side (`assemble_lesson_bundle.py`, `assemble_objectives.py`) compares no key with a printed answer; nothing there needed the rule.
**Strictness, measured:** `NoSingleEditIsAccepted` generates every one-character change (a digit, a dropped sign, a relation or bracket turned over) of 20 true matches, 727
keys, and none of the 707 edits is accepted; over Chapters 1–4's 228 accepted values / relation keys, 6,642 such edits (outside the repo, same function) produced 0 false accepts. No item of
Chapters 1–4 GAINED a typing problem from this change.

**Two findings that are not comparison bugs.**
1. The app's NUMERIC grader reads a key "a/b" with `parseFloat` (`attempt-grading.ts`: `-5/3` is −5), so a correct "-5/3" or "-1.6667" is marked wrong. Chapter 3's
   assembled bundle had TWO such live questions (ex3-1-16a `-5/3`, ex3-1-17a `-1/2`); the pipeline accepted `a/b` as numeric. A numeric key that is a fraction (`\frac{9}{10}`,
   `-\frac{3}{8}`, `-5/3`) is now typed again as an `expression` (the app's marker marks 9/10, 0.9 and 18/20 for `\frac{9}{10}`, and `-1.6667` for `-5/3` is `wrong_form`),
   key kept exactly, recorded (`typing_retyped`, rule `fraction-key`). No numeric `a/b` is left in any assembled seed bundle.
2. Three more kinds the app's marker cannot read were held "unanswerable" at assembly, or would have been once their items stopped being excluded: `T_n=4n-1` typed
   `expression` (its expression kind refuses an `=`; ten Chapter 3 questions), a list typed `surd`, an inequality list typed `equation` / `values` (the equation kind says "not an equation").
   Each is typed again under the kind the app's own marker reads (checked in the tests against `app/src/lib/answer-marker.ts`): rules `kind-for-equation`, `kind-for-list`,
   `kind-for-relations`; the key is never touched. Marker variables are told by name (`λ` → `\lambda`) and π is not a variable (the seam refused both: Ex4-5:8, 5, 13, 15).

**Before → after** (the saved runs re-collected with `recollect_lessons.py`, replayed 14 / 9 / 12 / 10 / 9 / 8 / 11 agent calls with identical prompts; judge verdicts reused pair by pair):

| | typing problems | G2 auto-pass: exclude / held / accept | questions (live) | held by reason |
|---|---|---|---|---|
| Chapter 3 (g10m3s2-1) | 24 → 5 | 24 / 3 / 0 → **5 / 6 / 0** (6 teaching, 12 typed again) | 58 (47) → **77 (71)** | answer_mismatch 3, unanswerable 8 → answer_mismatch 6, unanswerable **0** |
| Chapter 4 (6 lessons) | 75 → 19 | 75 / 10 / 13 → **19 / 18 / 15** (23 typed again) | 210 (196) → **266 (247)** | answer_mismatch 8, unanswerable 4, unverified 2 → 16, 1, 2 |

Chapter 3 re-collected: `runs/g10-math/lessons/recollected/wf_535efd2b-e80.json`; close-out `uv run fanout.py close-chapter 3`: G2 `runs/g10-math/g2-ch03.json`, record
`runs/g10-math/gates/g2-ch03.json`, finals `runs/g10-math/lesson/g10m3s2-1.json`, `seed/g10-math/g10m-c03.json`, `seed/content/g10m3s2-1.json`. Its prepared copies CHANGED
(more live questions): `068-s5-draft-ch03` (sha 648d9edd… → c862809e…), `069-wcheck-ch03` (26531ed2… → 7269d81b…), `069-wcheck-ch03-B` (64b32da8… → 5870a8fd…; 88 solutions, 38 agents a pass); a new
`g2rec-ch03` copy came with the close-out (the other agent's G2 recommendation step). Chapter 4's six runs re-collected the same way (`runs/g10-math/lessons/recollected/wf_05e1710e-e45`,
`wf_6b3d6321-e16`, `wf_54133f0c-3d5`, `wf_81e5c379-43e`, `wf_04e9155b-ab6`, `wf_c49a4f2c-b4b`); G2, assembly, config and the validate-only load were run exactly as `close-chapter 4` does them.

**Idempotence: a re-run of the close-out does NOT recompute an auto G2 verdict for an item that is no longer owed** (`auto_pass_gates.g2_merge` only touches owed items, so an old
auto "exclude" stays and the item stays excluded). The chapter's auto verdicts were dropped first (`g2-ch03.json` 24 → 0, `g2-ch04.json` 88 → 0 auto entries; there was no human verdict in either; backups
are in the session scratchpad), then the close-out recomputed them. After that both close-outs are idempotent: seed, content, G2 file, finals and (chapter 3) the prepared copies are byte-identical on a
second run (the gate record differs only in `decided_at`). **Any chapter re-collected later needs the same step** (drop the auto entries of its `g2-chNN.json`, keep a person's).

**Still excluded, with the reason.** Chapter 3 (5): Ex3-1:3 and Ex3-1:18 (a letter of a list in the stem, 8 and 6 options: the "2–5 options" rule is the pipeline's — typing prompt, `choiceProblems`,
`assemble_lesson_bundle.choice_option_problems` — not `schemas.py` (≥ 2 only) nor the database; the app's marker already marks a single-letter `expression` key, "C" correct and "c" incorrect, so typing them
`expression` would work; not widened here), Ex3-1:14a and Ex3-2:3 (one option, "no common difference", a phrase answer; no marker kind reads a phrase), Ex3-2:12a (the book's own misprint: printed
`77` for −77). Chapter 4 (19): Ex4-3:2, Ex4-7:4, 6m, 6n, 6o (options "infinitely many solutions" / "infinite solutions" named neither in the stem nor in the lesson), Ex4-3:4l and 4m ("x can be any real
number …", a verbal answer beside a relation), Ex4-2:3e (the printed answer has a stray "b": a book typo the typing agent corrected), Ex4-4:19, 20, 21 ("book_final" is the agent's own wording of a
solution that is glued, has a typo, or — Ex4-4:20 — names the wrong object; Ex4-4:21's solution also computes z = 26 and states 36), Ex4-5:15 (a flattened cube root the signature cannot order), Ex4-7:8a and 12t (the printed
answer adds a restriction, `, b ≠ 0`, the key lacks), Ex4-6:4b and Ex4-7:11b (REAL mismatches: the key says 0 where the book says 7, `<` where it says `>`), Ex4-6:4c and 4d (the key drops `b ∈ R` / `a ∈ N`:
for 4d that changes the answer set), Ex4-7:13 (the solution is a figure). Held for a person (G2 recommendation): the rest — mostly blind-solver disagreements where printed ≡ book; Ex4-6:1a (the book prints "x < −1 and
x ≥ 6", which is empty), Ex4-7:9c ("−1 < x ≤ −2", empty) and Ex4-6:2j (key [1; 12], blind [−12; 1]) look like book errors. Ex3-2:10c, Ex3-2:17b and Ex4-5:5, 7, 9 are held only because their blind~book pair has no
verdict yet (4 + 3 pairs: a judge call of a few cents would settle them; `recollect_lessons.py` reports them as needing a live judge and leaves them `unclear`).

**Chapters 1 and 2 (loaded; NOT reloaded). If they were re-collected with today's script:** Chapter 1 — g10m1s8-1 Ex1-11:37b flips exclude → live-able (typing OK, agreed; kind `values` → `interval`, which the app's marker reads), Ex1-11:37a
keeps its typing problem (a flattened fraction after `≠`; see below) but its kind would change too, Ex1-10:4c drops one of four problems and stays excluded; the other seven lessons change nothing (the four
lesson-v7 runs cannot be re-collected with today's script, their prompts differ; run with the prompt check waived they change nothing either). Chapter 2 — 11 items now excluded for "numeric key \frac{…} is not a
number" would pass typing and be typed `expression`: g10m2s2-1 Ex2-4:1q, 1r, 1s, 1z, 2a, 2b, 2l and g10m2s4-1 Ex2-4:3d, 3g, 3n, 3p (all `agreed` except 3p, `disputed`). Nothing else in either chapter changes.

**Cosmetic, not mine to fix:** `auto_pass_gates.g2_retyped` writes the basis "the options were the typing agent's inventions, not the book's" for every rule but `kind-for-form`; for `fraction-key`, `kind-for-list`,
`kind-for-relations` and `kind-for-equation` the gate record's reason text is wrong (the decision line itself is right). It wants a branch per rule.

**Tests.** `uv run --with pytest python -m pytest -q tests/` (AINEXT_TEST_PG set): 34 tests added in `tests/test_lesson_collect6.py` (26 → 60), one assertion changed in `tests/test_lesson_collect2.py` (a numeric fraction is no longer "not a number" but typed again as an expression, and still does not read as a decimal printed answer); 24 of the 34 fail on this morning's script and the other 10 (the pins on what must stay refused) pass on both. Whole suite, one run: 1,060 passed, 1 skipped, **1 failed**: `test_dryrun_chapter::ChapterEightDryRun` — `psql` exit 3 on `db/migrations/017-rls-roles-and-policies.sql` in the scratch database, i.e. a collision on the cluster-wide roles with two other agents' pytest runs in this worktree at the same moment, not the collection (run alone afterwards, with the last edit in, `tests/test_dryrun_chapter.py`: 2 passed, both modes). Both Chapter 8 dry runs standalone, before the last edit (a comment and an escape; the test above covers them after it): `uv run dryrun_chapter.py --book g10-math --chapter 8` and `--mode inline`, exit 0, coverage GREEN (23 checks, 0 fail), drift guard GREEN for every course.

**To do (main session).** (1) Chapter 4's `081-s5-draft-ch04` and `082-wcheck-ch04` copies (20:08) were prepared BEFORE this and hold the old live set (196 live questions, now 247), and `g2rec-ch04`
does not exist yet: `uv run fanout.py close-chapter 4` (now idempotent; it re-prepares all three) before they launch, unless a run is already in flight on them — that is why I did not. (2) Every lesson copy prepared before this
change (chapters 5+) carries the old collection: re-collect its run afterwards (`recollect_lessons.py`, no model call), never re-run it. (3) The COLLECT_VERSION is still `collect-6` (same day, as for kind-for-form).

## One-command `advance` and `ready` for the fan-out — 2026-10-01 (data-engineer)

`uv run fanout.py advance <run-id> --wf <wf_id> [--task-output F] [--resumed] [--dry-run] [--running …]` does, for a finished Workflow run, what the main session did by
hand: save the return value (`save_to`) and the wrapper (`runs/g10-math/records/`), meter it (`--stage`/`--lesson` read from the plan, append-once), run the plan's after-steps for that
kind of run, prepare and verify every run whose dependencies are now saved, and print a one-JSON summary (what was saved and metered with its cost, the key numbers of each step, warnings, the first
failing step, the runs prepared / skipped / not ready, and the READY scripts in plan order). `uv run fanout.py ready [--running …] [--prepare] [--paths]` lists only what can be launched. Code:
`fanout_advance.py` (the CLI is wired in `fanout.py`); tests `tests/test_fanout_advance.py` (86 tests, no model call, no DB; one real `pg_dump` helper check was run by hand into a scratch dir); documented in `runbook/README.md` §10 ("Advancing a finished run").
**Kinds covered:** S0b A/B/C, S1 (G1), lessons (+ `close-chapter` when the chapter's lessons are all saved), the working check (both passes, every part), S5 draft (+ the chapter's load after a fresh `pg_dump`), S6 author / grade (parts),
S7 author / verify, S5 final (+ G3, G4, coverage, parity, G5). **Left manual:** launching, G0b, a G1 ruling, the G2-recommendation runs (`g2rec-chNN`, not plan runs: `ready` lists a prepared one under `extra_ready` and holds the chapter's check and S5 draft behind it),
S6/S7 contingency re-runs, killed runs (advance refuses a run that is not `completed`), the book-level closing steps.

**What it learned from the main session and the other agents today.** (1) G1 never re-assembles an approved chapter (it re-derives the rejected state and overwrites the approved files — it did on chapter 5): approved → left alone, even with `--redo`; verdicts on disk newer than the run →
`approve --verdicts` of them; a BLOCKED G1 (an exercise-only objective, rule 1) stops with the gate's BLOCKED lines and is never resolved by the driver. (2) `assemble_maths.py assemble` exits 4 whenever the book's maths is not complete: normal mid-fan-out, not a failure (found by running the real
command in a sandbox copy). (3) A copy whose runbook script changed (`s6-v6`, the lesson collector) is `stale` in `ready` and still launchable; a copy that exists is never re-prepared (`--refresh-stale` is opt-in). (4) `families.normalise` now renames colliding slugs and exits 1 with UNRESOLVED for chapters 1, 2, 8: a stop, not a
retry. (5) The chapter-1 go/no-go (`s5-final-ch01` in front of other chapters' lessons) is lifted by default, as the main session lifted it.

**Plan text fixed in `fanout.py` (the plan JSON regenerated, only `after` / `before` / `workflow` / `prepared` changed):** S7 verify's after-step needs `--catalogue <the chapter's S5 draft> --pre-catalogue` (without them WIDGET TEMPLATES REJECTED, no `s5-distractors-chNN.json`, S5 final stays NotReady); S5 final's coverage line needs
`--generated seed/generated/g10-math/chNN` (else it reads the pilot's top-level bundles); G3 takes `--widget-gaps coverage/g10-math.chNN.widget-gaps.json` (and runs before coverage); G5 is the last step, `--book-config runs/g10-math/fanout/loaded/g10-math.json`, a config that lists every bundle in the pilot DB and gains each
chapter's seed bundle when it loads (the driver does that at the S5 draft's load step); the generated-bundle sequence the main session loaded chapter 1 with (catalogue pass 1 `--catalogue-only`, pass 2 `--drop-undiagnosed-widgets --widget-gaps` + the `s5_reconciled` assertion, loads with `--dsn … --catalogue-only --seed 20261001`, G4 `--run`, then coverage → G5 → parity); the families workflow label `s6-v6` (the finished `s6-author-ch08-s111` run keeps `s6-v5`: it ran with it).

**Checked.** The real commands were run in a sandbox copy of `services/extraction/` against saved runs (S0b assembly, lesson drafts, working-check collect, S6 specs, the real meter reproduced a ledger line to the cent, `pg_dump` + `pg_restore -l`), and a test asserts every flag the driver passes exists in the target script's own `--help`.
`--dry-run` on the real chapter-1 `s5-final` result lists the whole chain without running it. **The first live `s5-final` through `advance` should be `--dry-run`ned first** (the chain was built from the plan and the runbook; the main session had processed chapters 1 and 2 by hand).

## G2 recommendation run — the Map crash, ch03/ch04 copies, and what a widened COLLECT-6 does to a run in flight — 2026-10-01 (data-engineer)

**The crash** (`g2rec-ch02`, run `wf_4a4cf562-7e2`: `d.got.get is not a function`, after all 6 agents had run). The real runtime returns `pipeline()` results serialized, so a `Map` a stage
returned arrived as `{}`; the stub kept live objects and the tests passed. Fixed in `runbook/g2-recommend.workflow.js`: every stage returns plain JSON (`Object.fromEntries`), every
reader goes through `at(m, k)` (a Map or an object). `tests/workflow_stub.mjs` now serializes pipeline results, as the runtime does (fixture `serialize_stages`: `"all"` default, every stage and the
returned array; `"final"`, only the returned array: the reported crash exactly; `false`, live objects). Against the old copy `final` reproduces the TypeError after the 6 agent calls and `all` silently loses every
verification; the new copy passes in all three modes with the same result (`test_stage_results_are_plain_json_whatever_the_runtime_does_with_them`, and `test_the_stub_really_serializes_pipeline_results` guards the
guard). **Resume is safe:** the old and new copies make the same agent calls in the same order with byte-identical label, phase, model, effort, prompt and opts (schema included), checked on all 22 (ch01) and 6 (ch02)
calls with a responder that exercises every verifier-prompt branch; the args are identical (`args_sha256` equal), only `source_sha256` and `generated_sha256` differ. Regenerated, verified, NOT launched: `g2rec-ch01`
(`adaba4fe6b10…`), `g2rec-ch02` (`3e1ee442ff70…`), `g2rec-ch03` (`5a40cf358041…`, 11 items), `g2rec-ch04` (`59db27150f51…`, 37 items). Resume ch02 from `wf_4a4cf562-7e2` and ch01 from `wf_b1bdbb34-3f1`
with `Workflow({scriptPath, resumeFromRunId})` on the files as they are; do not run `g2-recommend-args --embed` or `close-chapter` on chapters 1 or 2 before their run is saved.

**The gate record's reason text** (`auto_pass_gates.py`, `RETYPE_BASIS`): each retype rule now has its own reason (`numeric`/`values` the options one, `kind-for-form`, `fraction-key`, `kind-for-list`, `kind-for-relations`,
`kind-for-equation`, `kind-from-key`); a rule the table does not know gets a neutral sentence, never "the options were the typing agent's inventions"; a test fails when `lesson.workflow.js` writes a rule the table lacks
(it caught `kind-from-key`, added while this was being written).

**What COLLECT-6 widened does to the runs in flight, rehearsed in a scratch directory (nothing shared was written; counts depend on the lesson runs only, not on the agents).** `recollect_lessons.py` on Chapter 2's three runs:
typing problems 10 → 3 (g10m2s2-1) and 7 → 0 (g10m2s4-1); the G2 re-run then drops ten earlier auto exclusions (Ex2-4:1q 1r 1s 1z 2a 2b 2l 3d 3g 3n) and leaves 3 by rule, 7 held. The eleventh, Ex2-4:3p, stays owed (disputed); Ex2-3:4, Ex2-4:4, Ex2-4:5 go from excluded
to disputed with six pairs needing a live judge. Chapter 1: **only Ex1-11:37b** changes (g10m1s8-1: typing 5 → 4); **g10m1s3-1, s4-1, s5-1, s6-1 cannot be re-collected any more** (`recollect_lessons.py`: "prompt(s) changed since the recorded run":
their typing agents ran with the lesson-v7 prompt and the script now carries v8), so their existing `recollected/` files stay as they are and the widened rules do not reach them without live typing calls.
Two code changes make the order safe: `auto_pass_gates.py g2` drops an AUTO verdict for an item of a given lesson that is no longer owed (`g2_merge(scope=…)`; before, the old exclusion outlived its typing problem;
a person's verdict is never dropped), and refuses to apply a `g2_recommend.py` recommendation for an item that is no longer owed; `g2-recommend-collect` skips such items (`no_longer_owed`) and refuses, per item, one whose judged
facts changed since the agents saw it (`stale_items`: stem, working, printed/EPUB/blind answers, figure, typed key, options; the shape of the typing and the checks' pair verdicts are not facts), found from the run's copy sha256
(each copy's packet is now archived beside it, `g2rec-archive/`). New: `auto_pass_gates.py g2-recommend-delta` lists the assembled bundle's solutions the chapter's working check never covered (`checked_ids`).

**The sequence, for Chapters 1 and 2** (from `services/extraction/`; ch2 shown, ch1 the same with its eight runs and `g2-ch01`):
1. Resume both runs (above); save to `runs/g10-math/g2rec/chNN-<runId>.json`; `meter_run.py record --book g10-math --stage G2R --run <runId>`.
2. `uv run recollect_lessons.py runs/g10-math/lessons/wf_40177b3c-94d.json runs/g10-math/lessons/wf_aa060013-9f1.json runs/g10-math/lessons/wf_89dbc00a-57a.json --dry-run`, then without `--dry-run`. (Chapter 1: its eight saved runs; four refuse, as above; only `wf_2cd2d32d-a3f` changes.)
3. `uv run auto_pass_gates.py g2 g10-math --chapter 2 --lesson-run runs/g10-math/lessons/recollected/wf_40177b3c-94d.json --lesson-run runs/g10-math/lessons/recollected/wf_aa060013-9f1.json --lesson-run runs/g10-math/lessons/recollected/wf_89dbc00a-57a.json --into runs/g10-math/g2-ch02.json --split --maths runs/g10-math/maths/book/accepted.json --run "<ids>"` (no `--recommend`: the checks decide first; the record's evidence now names the recollected runs).
4. `uv run auto_pass_gates.py g2-recommend-collect g10-math --chapter 2 --run runs/g10-math/g2rec/ch02-<runId>.json --out runs/g10-math/g2-ch02.recommended.json`. Expect ch2: 10 owed, 7 recommended, **10 no longer owed, 3 stale** (Ex2-3:4, Ex2-4:4, Ex2-4:5); ch1: 81 owed, 1 no longer owed (Ex1-11:37b), 0 stale.
   The stale ones: `uv run auto_pass_gates.py g2-recommend-args g10-math --chapter 2 --only-missing runs/g10-math/g2-ch02.recommended.json --embed work/g10-math/packets/embedded/fanout/g2rec-ch02-missing.workflow.js` (a new name: never over a copy whose run is saved), run it, collect both runs (`--run` twice).
5. The same `g2` line as 3 plus `--recommend runs/g10-math/g2-ch02.recommended.json`; `assemble_lesson_bundle.py --book g10-math --chapter 2 --report runs/g10-math/fanout/assembly-ch02.json`; `load_seed.py … --validate-only`.
6. DB (both chapters are loaded): `pg_dump`, `load_seed.py … --course course:us-g10-math-en --update --dry-run` and without, `apply_review_verdicts.py --g2 runs/g10-math/g2-ch02.json --book g10-math --runs runs/g10-math/lesson` (dry run first).
7. `uv run auto_pass_gates.py g2-recommend-delta g10-math --chapter 2 --out runs/g10-math/g2rec/ch02.delta-ids.json`, then `working_check.py args … --only` that file, pass A and pass B. The delta covers the eleven newly-live fraction questions too, not only what the recommendation made live.

## Chapter 5 re-collected and closed: plain-text finals against a LaTeX solution, whole values, the degree sign's HTML entity — 2026-10-01 (data-engineer)

No Workflow launched, no model call, nothing loaded into a database, `auto_pass_gates.py` untouched. All commands from `services/extraction/`. Chapter 5's five lesson runs
(`wf_3d2ef40a-c31` s3-1, `wf_cbad03dc-4b1` s5-1, `wf_26d2329d-0c0` s6-1, `wf_67e3bf3c-697` s7-1, `wf_796e9e13-512` s8-1) re-collected into `runs/g10-math/lessons/recollected/`.

**The class** (g10m5s7-1, trigonometry "solving problems": 80 typing problems of 88 items, 75 of them "book_final is not in the book solution", none wrong): the typing agent copies the
final as PLAIN TEXT — `x ≈ 76,60`, `θ ≈ 26,6°`, `α ≈ 23,96°`, `h ≈ 10`, `≈80,1°`, `sin B̂ = AC/AB = AD/BD`, `∴Areaof△ABC=16944units²` — and the solution is LaTeX: `x&\approx\text{76,60}`
(decimal comma inside `\text{}`), `\approx`, `^{\circ}`, `\hat{B}`, `\frac{AC}{AB}`, `\triangleABC`, and the unrounded value (`\text{76,60444...}`) in the working. `lesson.workflow.js`
(COLLECT-6, rules in `runbook/README.md` §3 and the script's header; tests `ApproximateFinals`, `ChapterFiveForms`, `NoSingleEditOfAFinal` in `tests/test_lesson_collect6.py`):
signs are read alike (`≈` `°` hats, function names glued by the EPUB — `\sinA` —, a simple fraction as a/b, `△` `∴` `²`), **digits never**: a final is found only as a WHOLE VALUE (`hasValue`):
`76,6` is not in `76,60`, `76,61`, `77,60`, `x = 76,60` (the solution says ≈), `x ≈ 7,72` against a working that only says `7,723645...`, `h ≈ 1` in `h ≈ 10`, `x=2` in `x=2/3`, `5` in `-5`
are all still refused — and `NoSingleEditOfAFinal` refuses every one-digit edit of each accepted final (the same match was a substring before, for every chapter; no item of chapters 1–4
gained a problem). Also: a Greek letter, `≈` and a trigonometric ratio (`\sin45°=`) are LABELS; a worked chain's last link is its answer (`sin Â = opp/hyp = CB/AC`); `a = 4(−24) = −96` is −96;
a list of words against the sentence that names them (`$a$ is the adjacent side $b$ is …`: as many `$x$` labels as words); a sentence's units (`9,96 mm and 8,35 mm`, `8,7 cm, 5,65 cm and 5,65 cm`:
units are no word, no number, and not a number's order); a plain "therefore"; and a typing that named NO marker kind (10 fractions of s8-1) takes the key's (`kind-from-key`, recorded).

**The 13 judge pairs (Ex5-5:1–5, Ex5-6:1a–c, Ex5-8:17a,b,d,e,g, all blind~printed): my own regression, now fixed.** In the recorded run they were settled by the SIGNATURE route and never went to a judge
(no verdict was ever recorded): blind `\theta \approx 42{,}07^{\circ}` against the printed `42,07°`. Last round's signature kept Greek letters visible (so `2\pi r` is not `2r`), and `\theta` as a label on the
blind answer then stopped matching. A Greek letter (and `≈`) in the label position is a label again (`stripLhs`, `VALUE_LABEL`, the signature without its left side), and `tests/test_lesson_collect6.py::ApproximateFinals::
test_a_greek_label_on_the_blind_answer_is_a_label_not_a_difference` pins it (π inside a value is still visible). With the fix **no blind~printed pair needs a judge**. What does need one: **21 blind~book pairs of s7-1** (items whose
book_final was missing and is now present: mostly the blind solver's own different answer, e.g. Ex5-4:1a blind 37,31 against 36,11; a few format differences, Ex5-8:10a `x = 35` against `≈35°`). A Workflow resume of `lesson.g10m5s7-1`
(`recollect_lessons.py --resume-preview` logic, run against a throwaway copy of today's script, since the prepared `089-lesson-g10m5s7-1` carries the OLD collection) would replay 11 calls
(claims, typing ×3, blind ×6, tier) and run LIVE: `S3:judge` (≈ $0.14), `S4:viz` ×3 and `S4:compare` (≈ $2.2 of figures nothing changed in) and `S8:oracle` (≈ $0.10): **≈ $2.44 of the recorded $3.76**. The chapter does not need
it: those items are already disputed by the blind solver and are held for G2. (s6-1's 10 pairs, which today's script first sent to the judge, are settled deterministically now: a trigonometric ratio is a label.)

**Re-collect, before → after, typing problems** (per lesson; items agreed / disputed after):
s3-1 21 → 5 (8 / 3, 15 without a printed answer); s5-1 2 → 2 (52 / 3); s6-1 10 → 1 (40 / 0); s7-1 80 → 3 (63 / 24; unchecked 75 → 0); s8-1 12 → 0 (35 / 2). Total 125 → 11.

**Close-out** (`uv run fanout.py close-chapter 5`; there was no `g2-ch05.json`, so no stale auto verdict to drop): G2 auto-pass **12 accept, 15 exclude, 27 held, 9 teaching (typed not markable)**, 15 typed again (10 `kind-from-key`, 5 fractions). Assembly:
**223 questions, 195 live**, 27 held `answer_mismatch`, 1 `unanswerable` (ex5-7-9a `(-24, -7); (-48, -14)`: not a coordinate pair to the app's marker), 29 excluded/teaching, KaTeX errors 0. Idempotent: a second run gave byte-identical
G2, assembly, seed and copies (the seed's input hash moves when the script is edited). **It first failed `load_seed --validate-only`**: 28 stems and solutions of s5-1, s6-1 and s7-1 carry the numeric HTML reference `&#176;` inside their maths
(`$\cos30&#176;=$`); KaTeX refuses the `&`. `assemble_lesson_bundle.unescape_entities` (new, through `respace_tree`; report field `html_entities_unescaped`; `tests/test_assemble_lesson_bundle.py::HtmlEntityTest`) makes a reference the character it names,
`^{\circ}` inside `$…$`; nothing else is touched. The EPUB source (`source_adapter.py`) still has them.
Prepared, verified, not launched: `work/g10-math/packets/embedded/fanout/097-wcheck-ch05.workflow.js` + `097-wcheck-ch05-B.workflow.js` (237 solutions, 102 agents a pass, ≈ $13.6–17.6), `092-s5-draft-ch05.workflow.js` (13 agents, ≈ $5.6–7.7),
`g2rec-ch05.workflow.js` (42 items, 12 agents, ≈ $2.4–7.5).

**Still excluded, 15:** Ex5-1:4 (the key lists three ratios, the agent's book_final only the last), Ex5-1:6 and Ex5-8:1a–c (options "not all in the stem"), Ex5-2:1v, 1y and Ex5-6:1g, 1k, 1m (closed-set options "real" / "undefined" / "solution exists" named neither in the stem nor in the lesson), Ex5-3:5b
(a choice with no key), and **Ex5-4:2a, 2b, 2c, 3 — a NEW class for Samuel: multi-letter marker variables** (`AC`, `AD`, `MN`: a side's name). `schemas.AnswerSpec` (and the contract) allow a single letter, a subscripted letter or a Greek name; the app's own marker accepts `AC` as one symbol and
even marks the plain `AC/AB=AD/BD` correct, but with the contract's single letters `A`, `B`, `C`, `D` the plain form is unreadable (only `\frac{AC}{AB}=…` is marked). Either the contract grows `[A-Z]{2,3}` or the agent's variables are split; not done here.

**Chapters 1–4 (nothing reloaded, nothing re-closed):** with today's script chapters 3 and 4 change nothing (0 items; the recollected files are as last round's, only their script sha would move). Chapter 1: Ex1-11:37b flips (typing OK, kind `values` → `interval`; 37a only its kind), Ex1-10:4c stays excluded; the other lessons nothing. Chapter 2:
14 items now excluded would pass typing: g10m2s2-1 Ex2-4:1q, 1r, 1s, 1z, 2a, 2b, 2l and g10m2s4-1 Ex2-4:3d, 3g, 3n, 3p (fractions typed `expression`) plus Ex2-3:4, Ex2-4:4, Ex2-4:5 ("therefore x ≈ 1,49": a plain "therefore"); all `agreed` but Ex2-4:3p.

**Tests (Chapter 5 round):** `tests/test_lesson_collect6.py` 60 → 73 (`ApproximateFinals` 4, `ChapterFiveForms` 8, `NoSingleEditOfAFinal` 1; the pins on what stays refused pass on last round's script too, the rest fail on it),
`tests/test_assemble_lesson_bundle.py::HtmlEntityTest` 3. Whole suite, one run: **1,126 passed, 1 skipped, 0 failed** (including `ChapterEightDryRun`, both modes). Containment still accepts any statement the solution itself makes (a working line):
over the 1,175 accepted finals of chapters 1–5, 38,430 one-digit edits, 348 are accepted for that reason (last round's script: 470 of 36,135 for 1,098 finals) — a final is not required to be the solution's LAST line.

## The G2 recommendations applied to Chapters 1–4 (loaded) and Chapter 5 (seed only) — 2026-10-01 (data-engineer)

Each chapter in the order the sequence above gives: re-collect (only where the collect had changed), G2 without `--recommend`, `g2-recommend-collect`, G2 with `--recommend --split`, assemble, validate, `pg_dump`,
`load_seed --update` (dry run first), `apply_review_verdicts --g2`, delta working-check copies. Every verdict is an AI recommendation (`ai_checked_by` "auto-pass G2 (AI recommendation) (G2 accept|fix|hold|exclude)";
`reviewed_by` untouched: the pilot DB's 35 human stamps are Chapter 8's); a stem repair carries `review_note` "stem fixed by auto-pass G2 recommendation (g2rec-v1) — not Samuel". Nothing went live that the
independent verifier had not confirmed; no book answer was changed.

| chapter | live before → after | not live before → after | rows rejected (book errors, damaged stems, partial answers) | recommended / owed | the DB |
|---|---|---|---|---|---|
| 1 | 483 → **517** (+34) | 50 (47 answer_mismatch, 3 unanswerable) → 6 (3 unverified, 3 unanswerable) | 27 | 81 / 81 (22 accept, 12 fix, 3 hold, 44 exclude) | loaded: 17 added, 4 stems repaired |
| 2 | 136 → **152** (+16) | 3 → 0 | 3 | 7 / 7 (3 accept, 4 exclude) | loaded: 16 added |
| 3 | 71 → **75** (+4) | 6 → 1 unverified | 2 | 11 / 11 | loaded: 1 added, 1 retyped |
| 4 | 247 → **259** (+12) | 19 → 6 (5 unverified, 1 unanswerable) | 9 | 37 / 37 | loaded: 8 added, 3 updated |
| 5 | seed: 195 → **210** (+15) | seed: 28 → 8 (7 unverified, 1 unanswerable) | 14 not emitted, 9 added | 42 / 42 | **not loaded** (the advance driver loads it) |

Backups (before each chapter's load, `pg_restore -l` read back): `work/g10-math/backups/pilot-before-g2rec-ch01.dump`, `-ch02`, `-ch03`, `-ch04` (about 1 MB each). Chapter 2's three "stale" items turned out not to be owed any more
with today's collect (Ex2-3:4, Ex2-4:4, Ex2-4:5 are agreed now), so no `--only-missing` run was needed. Chapters 3 and 4 were re-collected first (the collect had changed: 5474a2758d84 → 11ac17d5aa35) and owed the same items.
Delta working-check copies (A and B, not launched), `work/g10-math/packets/embedded/fanout/wcheck-chNN-g2rec-A|B.workflow.js`: ch01 18 solutions, ch02 16, ch03 1, ch04 8, ch05 10 (ch05: for after its load; its working check ran on the earlier seed).

**Found and fixed on the way (all small, all tested).** (1) Five "product of prime factors" items recommended `hold` stopped Chapter 1's whole assembly: the assembly puts the book's asked form on the marker spec and the app rejects a form it
does not know. Such an item, and any held item whose spec the marker rejects, is now `exclude` (a rejected spec is fatal, an unreadable KEY only holds the question). (2) Ex1-11:37a's working uses `\begin{gather*}`, which KaTeX draws only in display mode and which
refused the bundle: `assemble_lesson_bundle.normalise` now writes `gathered` for `gather*`, as it already wrote `aligned` for `align*` (presentation only). (3) The gate record listed teaching items "for review"; it no longer does.
(4) New `auto_pass_gates.py g2-recommend-errata` writes the errata list: `docs/WIP-g10-pilot/errata-g10.md` (61 printed answers that look wrong and 10 damaged questions, chapters 1–5).

**For Samuel.** (a) 20 live generated questions have a rejected parent: the 10 variants of family `common-factor-monic` (parent Ex1-8:11, whose printed answer 2(x+1)(x+10) is wrong) and the 10 of `factor-a` (parent Ex4-7:12s). They were blind-graded
on their own; they are listed here because their model question is a book error. (b) The S5 draft running for Chapter 5 was built from the seed BEFORE this: it saw the 27 held questions' working, of which 14 are now not used. (c) Ex3-1:3 ("C") went live as an expression key: the app's marker reads every capital
letter A–Z as a symbol (it marks itself correct and another letter incorrect, is case-sensitive, and `E` is not Euler's e; only an undeclared `U` fails, being the union sign), so the held reason the agent gave for Ex3-1:18 ("E may read as Euler's constant") is wrong: it was excluded for six options, and could be
typed as an expression like Ex3-1:3. (d) Four stem repairs are live in Chapter 1 and some more in Chapters 4 and 5, each marked for your review; 2p changes a digit (7 to 11) and is the one to look at first. (e) The verifier refused, conservatively, items whose key has two correct FORMS
(WE3 and Ex1-11:26c: a fraction and a mixed number): the marker marks equivalent values correct, so these are probably fine to accept.

## The delta working checks reach the console — 2026-10-01 (data-engineer)

The five delta working checks (ch01 18 solutions, ch02 16, ch03 1, ch04 8, ch05 10) had been collected into `runs/g10-math/working-check/chNN.g2rec.flags.json`, but the console's backlog reads only the canonical
`chNN.flags.json`, so their flags were invisible. Fixed the right way: `working_check.py collect --merge-into <canonical>` (and a standalone `working_check.py merge --base … --delta …`) merges a delta into the canonical
file, which now covers every live solution; a `delta_runs` list records each merge; no app change (the console ignores keys it does not know, and it deliberately reads no non-canonical flags file, because the
calibration files are not backlog). Applied to chapters 1–5 (originals kept in the session scratchpad, every original flag verified unchanged and in the same order). The printed `g2-recommend-args` sequence and
runbook §7c now carry the merge as a standard step; `tests/test_g2_recommend.py::DeltaMerge`.

## Chapter 6 re-collected and closed: figure labels, units inside a relation, a sentence that states the equation — 2026-10-01 (data-engineer)

Chapter 6 (functions) closed with 168 questions, 144 live and **92 of its 97 flagged items excluded** by G2 (111 not-markable teaching items aside). 57 of the 92 were false: the typing check compared a correct key with a correct printed answer
written another way. `lesson.workflow.js` (still `collect-6`; the collection is deterministic, so the nine saved runs were re-collected with `recollect_lessons.py`, **no model call, no Workflow launch, no DB write**), `tests/test_lesson_collect6.py`
(`ChapterSixForms`, plus 10 more cases in `NoSingleEditIsAccepted`).

| class (the 92) | before | after | what changed |
|---|---|---|---|
| "options said to be a figure's labels are not all single labels" | 38 | **0** | a figure's label may be a function label (`f(x)`, `g(x)`, `y(t)`, `s(t)`) as well as a letter; mixing the two in one list is refused; options the figure does not print are still refused |
| key vs printed answer, units inside a relation or set | 29 | 13, all real | `0 m ≤ s(t) ≤ 10 m` and `The domain is 0 s ≤ t ≤ 20 s. It represents…` read as the key's relation: ONE unit per bound, never a letter the key itself uses as a variable, set braces and `Domain:`/`Range:` labels and a capital point name dropped; a changed bound, a changed relation or an extra constraint is refused |
| `a=-1; q=1` against a sentence that states both and then the equation | 2 | **0** | `assignedList` stops at the first "so / therefore / hence / thus" |
| 6-option lists, options not in the stem, closed-set options named neither in stem nor lesson | 21 | 21 | left, as asked: the 2–5 cap is Samuel's call |
| `book_final is not in the book solution` | 2 | 1 | Ex6-8:27a (a typo in the book's own solution) stays |

Also read alike now (each with a pin that a changed digit, sign, relation or function stays refused): `\sin`/`\cos`/`\tan` are their letters, so **sin and cos are different answers** (the old signature dropped every command and made them the same); a trigonometric ratio
(`sinθ=`, `cosθ/sinθ=`) is a label of ONE side only, stripped against a side that names no trigonometric function; the EPUB's glued `\thereforeh`, `\lex`, and the text layer's `◦` for the degree sign; `and` between non-letters; `…, en y=…`.

**Chapter 6, before → after.** G2: 92 excluded → **35** (5 accept, 12 held, 69 teaching, 8 retyped unchanged). Assembly: **168 → 225 questions, 144 → 196 live**, held 24 → 29 (answer_mismatch 11, unanswerable 14, figure_reveals_answer 3, unverified 1),
KaTeX errors 0, validation passes. Copies re-prepared, **not launched**: `109-wcheck-ch06` A and B (150 agents, 331 solutions, about $20.1–26.0), `108-s5-draft-ch06` (23 agents, about $9.9–13.7), `g2rec-ch06` (12 agents, 47 items, about $2.4–7.5). `close-chapter 6` re-run a second and a third time:
the G2 file, the seed and the copies are identical (only the provenance hashes and the new report counter move). `g2-ch06.json`: the 97 auto entries were dropped first (no human verdict existed).

**Still excluded, 35.** 21 option-class (above). 14 others, all genuine: Ex6-4:6b (key "yes" against a printed sentence: a yes/no choice), Ex6-8:27a (typo in the book's solution), Ex6-8:31c (key "6; 9" against "6 R 5 coins and 9 R 2 coins": the denominations are part of the answer), and a **run of printed
answers that do not belong to the question they sit beside**: Ex6-6:14a, 14b, 15, 16 (the printed answer is the previous part's: a θ-interval for a question whose key is a function), 18a, 18c, 18d, 19a–d (counts and coordinate lists shifted by one part). Those need a person or a book-answer realignment, not a looser check.

**Held by the app's marker, 20 (was 15)**: keys no marker kind reads. Nine are lists of points (`(-0.63, 0); (0.63, 0)`, `A(90°, 1); B(90°, -1)…`, `(-3, 12); (2, 2)`: "not a coordinate pair"), four are lists of equations (`x+y=15; y=x+3`, `y=-2x; y=x^2-3`, `y = 0; x = 0`: "more than one '='"), six carry a degree sign the reader
cannot take (`60^{\circ}<\theta<300^{\circ}` and a set-builder under kind `interval`, Ex6-6:17, Ex6-8:42–44, 55a, and the point list of Ex6-6:20a: "unexpected ')'"), one is an inequality with no variable (`0 \le s(t) \le 10`, Ex6-1:8b). They stay held (not live). Whether the marker grows a point-list / equation-list kind or a degree-aware interval is a backend and Samuel decision
(the `AnswerSpec` contract); nothing was added here. **The judge:** 4 pairs (Ex6-8:27f, 27g: blind~book and book~printed) have no recorded verdict and need a live judge, as in the main session's first recollect; those two items are held.

**What the chapter-6 rules do to chapters 1–5 — a whole-corpus A/B.** Every pair of every saved lesson run, chapters 1–9, original and recollected files (5,901 pairs when first run, 6,002 at the end as more runs landed: the same 35 differences), settled by the script of the end of the Chapter 5 round and by today's: 5,866 identical;
the tool is kept, `node tests/settle_ab.mjs <old script> <new script>` (exit 1 on a regression); **0 pairs that were settled became unsettled**; 12 pairs that went to a judge now settle (4 in chapter 5:
Ex5-7:1c book~printed, 7a blind~book, 8e blind~book and book~printed; 8 in chapter 6, `f(x)=-3,5cos θ`-type forms); 23 only change their route label, same verdict (the `◦` sign now reads as `°` before the signature). **No item of chapters 1–5 changes its typing outcome**; the recollected files of chapters 1–5 are not rewritten (chapter 5's copies and G2 file are in flight). *A catch worth keeping:* the first draft of the
function-name rule sent 9 pairs of 6 chapter-5 items (flattened chains `AC AB = AD BD`, `=\frac{1}{\sqrt{2}}` finals, `cosθ/sinθ=`) to the judge, 3 of them with no recorded verdict; the A/B found them and `tests/test_lesson_collect6.py::ChapterSixForms::test_a_trigonometric_label_is_stripped_against_a_side_that_names_none` pins them.
Four chapter-1 runs (g10m1s3-1, 4-1, 5-1, 6-1) cannot be re-collected at all any more: the typing prompts changed with `lesson-v8` (13:17) after they were recorded (12:53); their recollected files stand as the main session left them.

## Escaped dollar signs: `\$` inside maths cut the app's maths splitter (Chapter 9) — 2026-10-01 (data-engineer)

`close-chapter 9` failed `load_seed --validate-only`: `KaTeX cannot parse $\text{\$ — Unexpected character: '\'` on the exchange-rate lessons (g10m9s5-1: `$\text{\$ 7.00}$`, `$\text{\$1}&=\text{R11.42}\\…$`, `( $\$$ )`, `$\$\text{12}$`).

**Root cause, and where.** KaTeX reads `\$` fine. The **app's splitter does not**: `components/TeXRenderer.tsx` splits on `text.split(/(\$[^$]+\$)/g)` (its own comment: "no escaped-dollar handling needed for this corpus"), so the `$` of a `\$` closes the segment, KaTeX is handed half a command, and **every later `$…$` of the same string
pairs its dollars the wrong way round** (the whole stem is garbled, not one symbol). The same unescaped split sits in four more places: `lib/math-text.ts` (`hasMath`, `plainMath`), `lib/voice.ts` and `lib/tts/sanitize.ts`. `katex_check.mjs` mirrors the app, which is why it caught this. So the right fix is at assembly, not in the validator (which stays strict, and a test
pins that it still flags a raw `\$`), and not in five app splitters.

**The fix.** `assemble_lesson_bundle.normalise_dollars` (first step of `respace_tree`, so the entity and re-spacing passes that follow also split on well-formed segments): a dollar sign is written without a `$` character — `\text{\textdollar}` in running maths, `\textdollar{}` inside a `\text{…}` group (KaTeX 0.17 defines `\textdollar` in text mode only; the `{}` keeps the space or letter after it), and the segment
`$\text{\textdollar}$` in prose. The scan honours the escape, so `\\$` (a line break, then the closing `$`: `…\\$`, which Chapter 1's solutions carry) is not touched. `_KNOWN['textdollar']` is pre-set so the re-spacer does not split the new command into `\text dollar`. Counted like `html_entities_unescaped`: the report's **`escaped_dollars_normalised`** (chapter 9: 9; chapter 6: 0; no other chapter's seed carries a raw `\$`). `tests/test_assemble_lesson_bundle.py::EscapedDollarTest` (8: the forms, nothing else touched, undoing the rewrite gives the input back, idempotent, the app's own split and KaTeX refuse the raw form and accept the new one, the text between segments still pairs, a bundle and a lesson-content file, the entity pass after it).

**Scan, every seed bundle.** `seed/g10-math/g10m-c01…c06`, `c09` and all 71 `seed/content` files (chapters 7 and 8 have no seed bundle in this worktree): a raw `\$` occurred only in chapter 9 (5 strings, 9 signs: 2 stems, 3 worked-example/content steps); none now. The lesson-run files keep theirs (`blind_answer`s and the S2 `quote`; not student-facing, not touched). **Also found, not changed:** a LONE unescaped `$` in prose — "the American dollar ($)" in g10m9s5-1's exposition and a claim (3 strings): harmless today (no other `$` in the string, so the app prints it), but it would pair with the next `$…$` if one were added.
**`close-chapter 9`** re-run: exit 0, KaTeX errors 0, **132 questions, 126 live** (the 2 stems the first run held as `katex_error` are live: 124 → 126), held 6 (answer_mismatch), G2 exclude 10 / held 6 / teaching 3 (the same as the first run: nothing stale, the G2 file is identical). Copies prepared, **not launched**: `130-wcheck-ch09` A and B (60 agents, 137 solutions, about $7.94–10.29), `129-s5-draft-ch09` (10 agents, about $4.32–5.94), `g2rec-ch09` (4 agents, 16 items, about $0.8–2.5).
For frontend: the speech and plain-text paths drop an unknown command (`\textdollar`), so a read-aloud of those stems is silent at the sign; a one-line mapping to "dollar" in `lib/voice.ts`, `lib/tts/sanitize.ts` and `plainSegment` would speak it. Not done: it is app code.
