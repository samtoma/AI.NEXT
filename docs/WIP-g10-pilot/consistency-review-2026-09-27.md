# Consistency review of the whole Grade 10 book work — 2026-09-27

Three read-only reviews (data end to end; specs/decisions/docs; code contracts + whole-book readiness), consolidated
by the orchestrator. Evidence (file:line) is in the reviewers' reports; the key ones are cited. Nothing here is live
in production: Grade 10 exists only on the feature branch and the local scratch DB `ainext_pilot_g10_ch08`.

## Verified consistent
- IDs and counts end to end: manifest → 13 objectives (G1: 11 moves, 3 outside) → 201 items → 158 marked questions +
  40 worked examples + 3 excluded → seed = DB for every question and worked example.
- Every G2 correction Samuel approved is in the seed and the DB (0 mismatches); every exclusion is absent everywhere.
- Grounding: all 158 canonical solutions come from the book (or approved corrections); nothing solved from scratch.
- Misconceptions: catalogue 29 = DB 29; every tag resolves; generated (110) and widget (25) content matches bundles,
  all in `review`; held widget claims are never read by the app.
- The six curriculum/grade isolation fixes are in place; `tsc` clean; app and pipeline test subsets pass.
- Samuel's answers 1–26 appear once each in the decisions log with the right numbering and meaning.
- Cost ledger: Chapter 8 = $153.30 API-equivalent.

## A. Must fix before Grade 10 goes live (a student would see it)
| # | Finding | Evidence | Fix |
|---|---|---|---|
| A1 | The shown "correct answer" is garbled on 29 questions: PDF text "9 11" renders as **911**, "y = 1 3 x + 3" as y=13x+3 (grading is right; display + tutor text wrong) | `ChatQuestionCard.tsx:386-400`, `lesson.ts:812` | derive `correct_answer` from the marker key; load check |
| A2 | ≈107 maths segments in 56 live items show red KaTeX errors: commands glued to letters (`\triangleABC`, `\timesm`, `\thereforey`) — incl. Samuel's approved corrections; "assign values" lines chained into one equation | S0b stores whitespace-stripped hash LaTeX (`accepted.json`) | deterministic re-spacing post-pass + KaTeX parse check at coverage and load (whole book) |
| A3 | Figures: 73 live questions say "[figure]"; 49 have no figure at all; question cards never display a question's figure (only the tutor's drawings); the visuals agent failed for all of lesson 8.2 and hit an "unknown objective" bug in 8.3b; the coverage check counts those errors as fine | `StudentLoop.tsx`, `ChatQuestionCard.tsx`, `viz_gaps`, coverage `figures` | re-run visuals; fix the bug; show the question's figure on the card; hold figure-dependent questions until their figure exists; coverage treats errors as failures |
| A4 | A coordinate pair became a decimal: `(-1,4)` → `(-1.4)` in a worked example (Ex8-6:46c) | `_DEC_COMMA`, `assemble_lesson_bundle.py:120` | treat `(int,int)` as a pair / ambiguous → G2 |
| A5 | 9 of 29 refutations leak internal ids ("Take q:g10m8s1-1-2:ex8-1-4"), cite figures the student can't see, or present G2 review history / Samuel's correction as "the book's own" | refutations text | patch the 9; keep G2 notes out of S5 packets; S5 rule "no ids, no review notes" |
| A6 | `answer_only` (Ex8-6:24a) is honoured by the tutor only; the wrong-answer card still says "let's look at it step by step" and shows "[figure]" | `route.ts:416/609`, `StudentLoop.tsx:431`, `ChatQuestionCard.tsx:483` | honour it on the cards and in the route |
| A7 | Multi-part stems garbled: "Show that: Calculate: $PS$" (Ex8-6:22c–e), "Show by calculation that: What type…" (21c) | two lead-ins concatenated (only chapter 8) | fix at G2 by hand |
| A8 | Some figures give the answer away (unknown point drawn at its answer: Ex8-3:5, 3:6, 6:8, 6:9, 6:12, 5:1) or draw it wrong (Ex8-4:15/16 at ±0.8 vs key ±0.5); some captions ask a different question | visuals | regenerate/repair those visuals; rule: never draw the unknown |
| A9 | "Write the equation in the form y = mx + c" accepts "3y + x = 11": all 97 marker specs have no `form` | marker specs | S3 rule mapping "in the form …" to `form`; coverage check |
| A10 | One widget can give a false "you swapped the points" diagnosis (untouched handle = swapped point) | `LineDrawer.tsx:102-105,183-186` | pipeline refuses such targets; app needs both points swapped |
| A11 | Console `/pipeline?course=…g10…` crashes (reads `choices` as a list) | `ReviewStage.tsx:43` | use `choiceOptions()` (15 min) |
| A12 | Family `quad-rotated-start` (10 questions, in review) has an ambiguous key and untagged distractors | S5 final stripped option C as legitimate | add to G3 flags; re-author |

Also seen in production (Prep 3, mild): 14 widget "mistake → misconception" links can never fire (e.g. the 4 ratio
widgets in u4-1-2 diagnose nothing) — no wrong content is shown, just plain "not quite". Same bug on 5 of Grade 10's
17 confirmed links. Fix: a per-mode "can emit" table enforced by the pipeline; re-map the dead rows.

## B. Decisions for Samuel (one at a time)
1. **"Load a course" restore** (decision 29, FR-4208/4210): as built it rolls the WHOLE database back to a backup —
   undoing students' progress since then — whereas the requirement says restore keeps every student's progress or
   refuses. Build the bundle-replay restore, or keep it as a "rollback" and amend the requirements?
2. **Course-gating default "off"**: with it off, grade is ignored, and every new Grade-10 sign-up is stored as American
   without being asked. Default "on", or refuse to start without the setting? (production has it on)
3. **Misconception tags on "true but less precise" options** can never fire (the re-entry comes first). Refuse such
   tags, or send the refutation with the re-entry message?
4. **What "reviewed" means**: 123 Grade-10 questions (and Prep 3, same loader) carry "ai dual-check (pending Samuel)",
   which the app counts as reviewed — so "unreviewed teaching seen" (SC-011) is undercounted. Change the loader or
   the contract?
5. **Decimal comma typed by a student** ("7,21") in a numeric question is marked wrong, not returned for re-entry
   (the numeric grader must stay identical for Prep 3). Change it for Grade 10 only?
6. **Lesson text about the book's notation** ("coordinates separated by a semicolon, e.g. A(1, 1)") now contradicts
   what it shows after FR-4308's conversion. Reword or drop those lines?
7. **Grade 10 "write no Arabic at all, even if the student writes in Arabic"** goes beyond decision 30 (no Egyptian
   phrases). Keep or narrow?
8. **FR-4410 (prerequisite links)** — keep as a requirement, or move to pipeline policy like the objectives method?
9. **The six new widget types were built before the gap list** existed (decision 27 said "only for chapters that name
   them") — confirm "built ahead".
10. **Step-level working checker** (backlog 78, ≈$70–125 for the book).
11. Still open from before: "draw figures from coordinates" has no marked question (tier floor); Ex8-5:5 detailed review.

## C. Requirements and documents out of sync (fix; no decision needed)
- FR-4206/SC-207 must name the Arabic-titles difference (decision 34); ADR-0020 wrongly says "no code change".
- FR-4320 must state the "less precise" re-entry (decision 41); FR-4302 must carry decisions 43–45 (answer-only,
  approved corrections).
- Cost figures disagree across docs (S0b "$24–44" vs $250–520 measured; S5 "$0.70/objective" was a pre-run projection —
  measured ≈ $1.3; book "$210–230" still in places).
- PROJECT_STATE.md is a day behind (commit status, 47 decisions, the pilot, open questions).
- ADR-0020's exception list is misnumbered ("fourth" twice) and misses the answer-only line; renumber consistently.
- Three decision-numbering schemes collide in code comments and the backlog ("decision 9" = answer 9 = #30).
- Pipeline doc/ADR-0005/runbook don't reflect the third reading, the second mapper, prerequisite links; stale prompt
  versions in the runbook.
- Tasks built but unticked (T303, T304, T357, T427, T428, T431, T432, T433); traceability "OPEN" means "not re-graded",
  not "not started" — say so or run T387.
- WIP README/backlog: stale parts; widget counts are now 17 active / 22 held (not 20/23).
- **The feature branch's last CI run failed** (traceability, build); every snapshot since carries [skip ci], so it's
  hidden. Run CI once deliberately.

## D. Before fanning out to the other 13 chapters (60 lessons)
1. **Figure policy (blocker)**: the rest of the book is far more figure-heavy (ch13: 153 figures, ch7: 157, ch6: 126;
   979 teaching figures). Native figure kinds are weeks of work; alternatively reopen static images (decision 8).
   Minimum: the hold rule + question-card figure display (≈1.5 days).
2. S0b: ≈5,160 images left — ≈$250 (batch 50) / $520 (batch 25); run passes one at a time; add the re-spacing +
   KaTeX check first.
3. Pair-vs-decimal ambiguity rule (A4); form rule (A9); per-mode widget table (A10/W1) + re-author 4 S7 lessons (≈$5).
4. S1 must go chapter by chapter after each G1 (links read earlier chapters); Chapter 8's links re-run after 1–7;
   shard the prior-objectives list (args would exceed 15 KB).
5. Run the never-used prompt versions (s6-v5, s7-v6) once on Chapter 8 (≈$15).
6. Book config: output paths into `seed/g10-math` + `seed/content`, `generated` and `parity` constants (T364).
7. Expect larger embedded scripts (≈200–250 KB); split per lesson if needed.
8. Human gates G1–G4 for 13 chapters put Samuel on the critical path.
9. Cost: ≈$0.85–1.1k one-time for the book, plus the working checker (≈$70–125) and the check run (≈$15).
