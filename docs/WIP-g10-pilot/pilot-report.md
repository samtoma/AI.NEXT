# Chapter 8 pilot — running notes (2026-09-26)

## S0b maths transcription
- Chapter 8: 853 equation images to transcribe; 431-ish proven by hash before any model; 422 sent to vision.
- Pass A (batch 25, wf_ace9e326-ddf): 422 read, 120 hash-claimed. Metered $38.27 total, of which $20.33 the
  successful agents and $17.95 agents killed by the usage limit (wasted).
- Pass B (batch 25, wf_e4887b3b-cbd): 422 read, 127 hash-claimed. $38.36 total: $22.10 useful, $16.26 wasted.
- Calibration A50 (batch 50, wf_2648747c-cf6), 100 images shared with A25: $4.53 total: $2.43 useful, $2.10 wasted.
- After A+B: ch8 accepted 558 hash + 282 agreement, 13 disputed → pass C (15 images incl. others).
- Batch 50 vs 25 on the same 100: correct 98 vs 99 (vs accepted); hash-proven 72 vs 74; agree with each other 99/100.
  Useful cost per image: batch 50 ≈ $0.024, batch 25 ≈ $0.048-0.052. → batch 50 halves the cost at ~same quality.
- Where the tokens go: cache reads (58-62M per pass) — agents probe md5 variants (~45 tool calls per batch).
- Book-wide extrapolation (useful spend only, batch 25): ~5,160 images still unread × 2 passes × $0.05 ≈ $520;
  at batch 50 ≈ $250. Plus pass C (~3%) and waste if limits hit mid-run.
- Usage-limit lesson: running 3 workflows + 2 agents at once hit the session limit; killed agents' tokens are lost
  (~$36 of $81 on S0b). Next stages: fewer concurrent runs.
- Pass C (wf_3467618f-f75): 15 images, 1 agent, $0.96. Result: 13 accepted by third reading, 2 by hash.
- **Chapter 8 maths: 853/853 accepted (558 hash, 282 agreement, 13 third reading), 0 unresolved → G0b not needed.**
- S0b total metered: ~$82.6 (A 38.27 + B 38.36 + C 0.96 + calib 4.53) of which ~$36 was lost to the usage limit.
- BOOK MISPRINT found (two independent readings agree): Worked example 8 "Points on a line", §8.3, p.303:
  m_AC = (3−7)/(3−3) = −4/−6 = 2/3 — denominator printed "3−3" (should be −3−3). Must not reach a student as a
  canonical step; flag at G1/G2.
- S1 note: chapter 8 is the first chapter processed, so prior_objectives is empty — links to chapters 1–7 can't be
  proposed in this pilot.

## S1 objectives (first real run)
- wf_02ba66d9-470: 28 agents, $6.82 (Find 2.77, Map 1.93, Reconcile 1.22, Links 0.41, Evidence/Haiku 0.33, Link check 0.15).
- Output: 12 objectives in 5 lessons (11 agreed between the two blind finders, 1 merged, 0 single); 16 G1 decisions owed.
- Assembler REJECTED the chapter — calibration faults, not content faults:
  1. g10m8s2-1 anchors returned in brackets "[WE1]" → not found;
  2. body paragraphs cited as "definition" evidence (rule wants definition blocks);
  3. Haiku evidence check judges every heading "does not support";
  4. backslash lost in quotes ("$text{1}$") → "not cited by either finder";
  5. 4 end-of-chapter items (Ex8-6:28a, 32e, 40c, 46d) mapped to no objective.
- Fix delegated (causes, not rules); S1 to be re-run (~$7).

## S1 rerun + G1
- wf_a70b525d-f44 (s1-v5): $7.16. 13 objectives (13 agreed), 54 evidence kept / 2 dropped; 1 link confirmed.
  1 mapper placeholder row ("none"/"none") set aside by a new assembler rule (tested). 19 decisions + 6 misfits.
- G1 passed 2026-09-26 by Samuel, "Approve as recommended": 11 placed, 3 outside (28a, 32e, 46d), 11 terms kept.
- S1 total: $13.97 (first run $6.82 rejected on calibration faults + rerun $7.16).

## S2–S4 lessons
- Embedded per-lesson scripts; 8.2 (32 items) launched first: wf_29588ac2-069 (87 KB script accepted by the tool).

## S2–S4 lesson runs so far (lesson-v3)
- 8.2 wf_29588ac2-069 $2.28 · 8.3a wf_e927fd12-ec1 $2.53 · 8.1 wf_73acc1d0-255 $2.17; 8.3b, 8.4 stopped (to re-run).
- Disputed items: 36 across the three runs (8.3a 20/25, 8.1 9/15). Causes found (calibration, not book errors):
  "book_final is not in the book solution" ×24; blind re-solve empty on 19 disputed items (10 with all pairs
  missing); PDF-text printed answers lose fraction layout ("9 11"); choice options = figure labels flagged;
  DATA BUG: `&amp;` HTML entities inside stored LaTeX align blocks (S0b accepted maths + solutions).
- Fix delegated to the pipeline engineer (2026-09-26); no rerun until fixed.

## S2–S4 lesson runs — lesson-v4 / collect-2 (fresh, 2026-09-26)
| lesson | run | items | agreed | disputed | no printed | typing problems | unchecked | cost |
|---|---|---|---|---|---|---|---|---|
| 8.1 g10m8s1-1 | wf_5c4f8379-422 | 15 | 9 | 0 | 6 | 0 | 0 | $1.84 |
| 8.2 g10m8s2-1 | wf_42c5b8f1-44f | 34 | 21 | 6 | 7 | 10 | 4 | $1.62 |
| 8.3a g10m8s3-1 | wf_926b9589-7de | 25 | 23 | 2 | 0 | 0 | 0 | $1.49 |
| 8.3b g10m8s3-2 | wf_88a986dd-b42 | 88 | 51 | 21 | 16 | 12 | 4 | $4.59 |
| 8.4 g10m8s4-1 | wf_8103a341-b40 | 39 | 23 | 8 | 8 | 18 | 0 | $1.68 |
| **total** | | **201** | **127** | **37** | **37** | **40** | **8** | **$11.22** |
- Earlier lesson-v3 runs ($6.98) superseded (harness relay + calibration faults) → runs/g10-math/lessons/superseded-lesson-v3/.
- Next: triage disputed/typing/unchecked into calibration faults (fix + re-collect from cache) vs genuine G2 items.

## Figure re-solve resumes (collect-3, 2026-09-26)
- Collection fixes (collect-3) + shared question figures attached to every part; 8.1 re-collected from cache ($0).
- Resumes: 8.2 $1.50 (23/4/7), 8.3a $1.03 (24/1/0), 8.3b $4.79 (61/11/16), 8.4 $1.26 (27/4/8) = $8.58.
- meter_run.py gained --resumed (a resume keeps its run id; only new agents are metered).
- Lesson stage total so far: $19.80 (fresh v4 $11.22 + resumes $8.58); superseded v3 runs $6.98.
- Chapter 8 now: 201 items ≈ 144 agreed, 20 disputed (genuine), 37 no printed answer → G2.

## Cost: calibrated projection (2026-09-26, before S5)
**The dry meter underestimates real runs ×5.5–6.3.** It prices each prompt once (shards spliced in) plus 15k
tokens of overhead; real agents re-read their context every turn (cache reads), read shard files, think, and
write long answers. Measured on this chapter:

| stage | real (clean run) | dry meter | real ÷ dry |
|---|---|---|---|
| S1 (s1-v5, wf_a70b525d-f44) | $7.16 | $1.14 | 6.3× |
| S2–S4 (five fresh lesson-v4 runs) | $11.22 | $2.03 | 5.5× |

**Chapter 8, still to spend** (dry meter scaled from the dry run's 15 stub objectives to the real 13, × 5.5–6.3):
S5 draft ≈ $2.7–3.1 · S6 ≈ $14.5–16.6 · S7 ≈ $1.7–2.0 · S5 final ≈ $5.8–6.6 → **≈ $25–29**, of which
**S5 ≈ $9 (≈ $0.70 per objective)**; allow S5 up to ~$14 (it writes long refutations).

**Decision 31's "$22–32" was mislabelled "per objective":** it was the whole-book S5 estimate (it sat inside the
$220–260 book total; per objective it would have been $3,700+). Corrected in `specs/003-curriculum-tracks/decisions.md`
and `docs/specs/extraction-pipeline.md` §5.

**Whole-book projection (Grade 10, one-time) ≈ $0.85–1.1k**, replacing the planned $220–260:

| stage | basis | projection |
|---|---|---|
| S0b maths | ~5,160 images still to read × 2 passes (this report, S0b section): batch 50 vs 25 | $250–520 |
| S1 objectives | $7.16 per 5-lesson chapter → $1.43/lesson × 65 lessons | ≈ $93 |
| S2–S4 lessons | $11.22 per 5 lessons (clean runs) → $2.24/lesson × 65 | ≈ $146 |
| S5–S7 | ≈ $2.1 per objective (S5 ≈ $0.70) × ≈ 170 objectives (2.6/lesson × 65) | ≈ $350 (S5 ≈ $120) |
| **total** | | **≈ $0.85–1.1k** |

Not in it: first-chapter overhead. This chapter actually spent more than the clean-run rates — S1 $13.98 (a
rejected first run), S2–S4 $26.78 (superseded lesson-v3 runs and the figure re-solve resumes), S0b ~$36 lost to
the usage limit — and wasted spend of that kind is avoidable, not projected. All figures are API-equivalent USD.

## S5 draft (wf_62d81fc7-ea9, 2026-09-26) — and why it should run again
- Metered **$4.59** vs the calibrated $2.7–3.1: real ÷ dry = **×9.4** for S5 (dry $0.49 at 13 objectives), above
  the ×5.5–6.3 of S1 and the lesson stage — S5 writes long refutations. Re-priced with ×9.4: S5 final ≈ $10–11,
  S5 total ≈ $15–16 for the chapter (≈ $1.2/objective, ≈ $200 for the book); S6 ≈ $14.5–25, S7 ≈ $1.7–3.
- 20 entries / 13 objectives, but its INPUTS were faulty (fixed at source, deterministic):
  1. no diagrams: shards showed "[figure]" and the author could open nothing else → every figure-label option
     (points A–E, shapes W–Z) stripped as "no named error" (s1-1-2: 0 entries / 12 stripped; s1-1-3: 1 / 9);
  2. five G2-corrected expression questions still carried the book's WRONG printed answer as their answer text
     (Ex8-4:20c, Ex8-6:18b, 37e, 31c, 47b — also in the pilot DB, now updated);
  3. every three-way disagreement fed as "evidence of a student error", including book errors G2 fixed and an
     item G2 excluded (Ex8-5:5 was used as "directional support");
  4. s1-1-1 skipped: its items are all worked examples, which S5 did not read as canonical solutions.
- lo:g10m8s3-2-1 (0 entries): its only evidence was the 37e disagreement (a book error G2 fixed, beside a wrong
  answer line) and two typos in the book's working it rightly refused to build on (Ex8-6:32d "Substitute
  A(−2; 2)" for A(−1; 7); Ex8-6:45a "9 − 5" for 9 − 4) — calibration, not a lack of evidence; the two typos are
  G2 items (the canonical working is taught).

## Recommendations for Samuel's go / no-go
- **78 — a step-level working checker (quality gap).** The three-way check compares FINAL answers only, so a typo
  inside the book's working passes whenever the final answer is right — and the tutor teaches that working. The
  S5 draft's author found two in one objective (Ex8-6:32d "Substitute A(−2; 2)" for A(−1; 7); Ex8-6:45a "9 − 5" for
  9 − 4; corrected by decision 45). Proposal: before G2, one agent per batch reads each canonical solution against
  its stem and flags any step that does not follow (a substituted value not in the stem, arithmetic that does not
  equal its next line, a sign that flips), each flag going to G2 like a disagreement — never corrected silently.
  A free deterministic pre-pass evaluates purely numeric aligned lines (it catches the 45a kind, not the 32d kind).
  **Cost, from the pilot's measured prices:** the blind re-solve cost $0.017 per item (5 fresh lesson runs:
  $3.43 / 201 items); a checker reads the whole solution and writes a verdict per step, so about 1.5–2.5× that:
  **≈ $0.025–0.045 per canonical solution** — ≈ $5–9 for Chapter 8's 198 (158 questions + 40 worked examples),
  ≈ $70–125 for the book's ≈ 2,800. It would fit in the lesson stage (S3) as a new call per batch.

## S5 misconceptions — draft (2026-09-26)
- First draft wf_62d81fc7-ea9 (s5-v3): 20 entries, $4.59 — superseded (no figures; book errors and G2-excluded items
  used as student-error evidence; worked examples ignored; wrong answer text on 5 corrected items).
- Re-run wf_97ba80a6-9ad (s5-v4, after G2 answers 23–25): 30 entries over 13 objectives, $6.66. s1-1-1 has 0 (its
  solutions are drawings only — flagged, not invented).

## S6 families + S7 widgets — author passes (2026-09-26)
- S6 author wf_41c0663f-36d (s6-v4): 11 families over 8 objectives, $3.75. Infeasible: s1-1-1 (no marked book
  question to parent — all its items are teaching-only) and s1-1-2 standard/advanced (diagram-dependent; a family
  can't carry a figure).
- S7 author wf_816352f4-fbc (s7-v4): 7 templates (pair_plotter ×4, line_drawer ×2, number_line_marker ×1), 6 gaps,
  $2.18. Integration gap found: the new widget kinds (polygon_builder etc.) were never registered for the pipeline
  (instrument/limits empty) — fixed (`s7-v5`: all 16 contract kinds registered, reachability = app's, kind by
  kind). Re-author g10m8s3-2 only (polygon_builder for s3-2-2); the other five gaps stand.
- For fan-out: S7 prompts are `s7-v6` (after the pilot's verify run was launched on an `s7-v5` copy): misconception
  ids from the objective's OWN list only, and one predicate → one misconception — the two author errors the
  pilot had to normalise (`--normalise-templates`). S6 refusals of the same mechanical kind: `families/normalise.py`.
- Widget gaps named by Chapter 8 (input to FR-4321 / decision 27 builds): multi-vertex figure plotter, vertex-labelling
  checker, distance ruler, gradient builder, two-line relationship classifier, diagonal-aware vertex solver.

## S5 final (2026-09-26)
- wf_ed8c8e80-51d (s5-v4): 29 entries CONFIRMED by the fail-closed verifier, 2 dropped UNSUPPORTED
  (s1-1-2 swaps-x-and-y-values: its citations pointed at the wrong options; one s3-2-3 entry). $5.88.
- S5 total (draft + final, incl. superseded draft): ≈ $17.1. s1-1-1 has no entries (drawings-only solutions).
