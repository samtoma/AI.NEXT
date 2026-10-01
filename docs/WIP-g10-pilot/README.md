# WIP: Grade 10 American maths — Chapter 8 pilot handoff (2026-09-26)

Resume doc for the feature-003 branch `feat/003-curriculum-tracks-g10-american-math`, written when
the work moved from a local session to a cloud session. Read this first, then `docs/PROJECT_STATE.md`,
`specs/003-curriculum-tracks/` (spec, plan, tasks, traceability, decisions) and the files beside
this one:

- `samuel-answers.md` — Samuel's answers 1–26 for this feature, in his words. **Answer N is decision
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

## STATUS UPDATE — 2026-09-26, corrected 2026-09-27 (latest; everything from "Where the pilot stood" down to "Rebuilding" is the older state, kept for the record)

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

**Blocking, or for Samuel:**
1. **KaTeX: a stripped control space before digits.** Hash-proved S0b LaTeX writes the book's thousands space
   `\text{57\ 000\ 000}` as `\text{57\000\000}` (whitespace removed before hashing); KaTeX refuses `\0`, so
   `load_seed.py` refuses chapters 9 (8 items), 10 (1) and 13 (2) — 14 images today, more once the vision passes
   land. Fix in the assembly's re-spacing (`respace_latex`: a backslash followed by a digit is a control space,
   `\ `), owned by the engineer changing `assemble_lesson_bundle.py` today. Not a gate 37c passes: broken maths blocks.
2. **lo:g10m8s1-1-1 has no parent question.** Its six items are drawings G2 made teaching-only, so they are worked-
   example entries, not question rows; FR-1101 and `questions.parent_question_id REFERENCES questions(id)` need a
   question row. Run 001 gives the author those items (with the book's drawn answers) as models and parent
   candidates — without them it reported "infeasible" in the pilot — but a family it writes cannot load until Samuel
   decides: let a teaching item be a family's parent (loader + FR-1101 wording), or keep s1-1-1 as a named coverage
   exception. No widget kind plots given vertices (`polygon_builder` grades shape properties).
3. **The auto-pass verdicts** for G1 (`approve --verdicts`) and G2 (`lesson-runs --g2`; `"auto": true`, migration 035)
   come from the gates' auto-pass mode, in flight elsewhere; needed from run 6 (S1 ch01) on.
4. **Chapter 8's prerequisite links to chapters 1–7** (consistency review D4) need a links-only S1 pass after
   chapter 7's G1 (≈ $0.5–1); not built, not in the plan — decide whether to add it.
5. **Chapter 8 into the book's seed** (closing steps): copy the reviewed pilot bundle, or re-assemble it with the
   book-picture stand-ins (37d), deterministic, $0.
6. **Budget**: the top of the range passes $1.1k; the plan's rule is to stop and ask if the metered total does.
7. **Spec Kit**: the working checker (answer 30) needs its FR/traceability lines (tech-writer).

## PAUSED 2026-10-01 — Samuel: "be careful the usage will finish very soon, can you pause?"
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
