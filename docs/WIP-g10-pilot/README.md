# WIP: Grade 10 American maths — Chapter 8 pilot handoff (2026-09-26)

Resume doc for the feature-003 branch `feat/003-curriculum-tracks-g10-american-math`, written when
the work moved from a local session to a cloud session. Read this first, then `docs/PROJECT_STATE.md`,
`specs/003-curriculum-tracks/` (spec, plan, tasks, traceability, decisions) and the files beside
this one:

- `samuel-answers.md` — Samuel's decisions 1–15 for this feature, in his words (recorded as
  decisions 22–36 in `specs/003-curriculum-tracks/decisions.md`).
- `integration-backlog.md` — every open follow-up (items 1–71), with what is done.
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

## STATUS UPDATE — 2026-09-26 (latest; supersedes the table below where they differ)

Local session paused for credit safety. Everything below is on disk in this worktree (uncommitted since the
WIP push 383510c unless Samuel commits it). Nothing is running.

| Stage | State | Run(s) | Cost |
|---|---|---|---|
| S0b maths | done, 853/853 accepted | A/B/C + calib | ≈ $82 (≈ $36 lost to limits) |
| S1 + G1 | done, G1 passed (Samuel) | wf_a70b525d-f44 | ≈ $14 |
| S2–S4 lessons + G2 | done, G2 passed (Samuel, answers 18–25) — 158 marked, 40 worked examples, 3 excluded | 5 runs in runs/g10-math/lessons/ | ≈ $27 |
| S5 draft | done (s5-v4) — 30 entries | wf_97ba80a6-9ad | $6.66 (+$4.59 superseded) |
| S6 families | done — 11 families, all graded PASS | author wf_41c0663f-36d, revise wf_c8f00d37-c28, grade wf_c9fa108d-2eb + wf_c2fc95f0-6ec | ≈ $8.6 |
| S7 widgets | done — 7 templates, 25 widgets reachable; 20 claims confirmed, 23 held for human review (decision 47) | author wf_816352f4-fbc + wf_62e29981-c0a, verify wf_dbca7b50-327 | ≈ $4.7 |
| S5 final | done — 29 confirmed, 2 dropped (UNSUPPORTED) | wf_ed8c8e80-51d | $5.88 |
| Assemble catalogue + generated bundles, load to scratch DB `ainext_pilot_g10_ch08`, coverage, parity | **next** | — | $0 (deterministic) |
| G3 (family sample + 23 widget claims page `runs/g10-math/g3-mappings-ch08.review.html`), G4 (catalogue), G5 go/no-go | pending Samuel | — | — |

Total metered so far ≈ $153 API-equivalent (`uv run meter_run.py summary --book g10-math`).
Samuel's answers 1–26 are in `samuel-answers.md`; decisions up to 47 in `specs/003-curriculum-tracks/decisions.md`.
App-side work done this session (uncommitted): curriculum-isolation fixes (decisions 37–38), `less_specific` /
`answer_only` support, inline align fix — see integration-backlog.md.

## Where the pilot stands

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

## Next steps, in order

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

## In-flight work that was stopped (partial edits are in this commit)

**Curriculum/grade isolation fixes** (an agent was mid-edit in `app/` — it had started rewriting the bridge
reader in `lib/subject-queries.ts`; `app/` may not type-check). The audit (2026-09-26) found, for an ordinary
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

Nothing below is committed since the WIP commit `383510c`; it is all on disk in this worktree
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
  `runs/g10-math/widgets/pending-review.json` (23 held, 20 active — decision 47); S5 input `runs/g10-math/widgets/s5-distractors.json` (9).
- G3 material: `runs/g10-math/g3-flags.json` (#3's tier), `runs/g10-math/g3-mappings-ch08.review.html` (the 23 held claims).
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
    --gap-report coverage/g10-math.widget-gaps.json --pending-review runs/g10-math/widgets/pending-review.json \
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
    --maths runs/g10-math/maths/summary.json --widget-gaps coverage/g10-math.widget-gaps.json --s5 $F --out coverage/g10-math.json
uv run parity_check.py --candidate "$AINEXT_DB_DSN" --all-courses
```
Checks after each code change: `AINEXT_TEST_PG="host=127.0.0.1 port=5432" uv run --with pytest python -m pytest -q tests/`,
`uv run dryrun_chapter.py --book g10-math --chapter 8` and `… --mode inline`, `python3 scripts/traceability.py --check` (repo root).

**3. Open decisions and backlog** (`docs/WIP-g10-pilot/integration-backlog.md`)
- Human gates still to pass: **G3** (10% sample + #3's tier flag, `g3-flags.json`), **G3 held mappings** (23 claims, decision 47),
  **G4** (catalogue sample). Widget gaps in `coverage/g10-math.widget-gaps.json` need Samuel's sign-off (FR-4306):
  s1-1-1, s1-1-3, s2-1-1, s3-1-1, s3-2-2 (line relationship classifier), s3-2-3 (collinearity checker), s4-1-3.
- Tier-floor gaps to list by name (FR-4305): s1-1-1 (no markable parent), s1-1-2 standard/advanced (diagram-dependent).
- Backlog open: **75** (Ex8-5:5 excluded pending review), **78** (step-level working checker, decide before fan-out),
  **80** (#3 re-authored and graded; its tier → G3). Closed this stretch: 76, 77, 79, 81, 82, 83.
- Fan-out notes: prompts s6-v5 and s7-v6 are unused so far (revise read rule, bare values, own-list ids, one
  predicate → one misconception, typed readings, bare predicate names).
