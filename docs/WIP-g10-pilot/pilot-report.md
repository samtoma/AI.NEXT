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
