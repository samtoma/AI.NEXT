# G10 integration backlog (orchestrator's list)

## Pipeline integration (one agent, before the Chapter 8 pilot)
1. coverage_report.py: count only `scope == "chapter"` signed widget gaps (families agent).
2. load_generated_questions.py: accept typed answers (`short` + `choices.marker`), read `family` field, validate fresh bundles against the DB catalogue (don't overwrite `generated_by`).
3. G2 verdicts apply step (book-question reviewer stamps reach the DB).
4. S2 claims have no home: put them into lesson content bundles (`seed/content/<slug>.json`) where Noor reads them.
5. Prep-3 printed lesson titles live only in app `courses.ts`: move into book configs; loader writes `course_lessons.title`.
6. G10 book config `bundles`: `g10m-course.json` first (T364); parity constant null until T364.
7. Format alignment: manifest `exercises[].item_refs`, module `excluded_pages` (P1 vs P4); S0b `runs/<book>/maths/summary.json` (P8 vs P4); widget-gaps shape (done).
8. Prerequisite-edges stage for G10 (decision 7, pending Samuel).
9. Static book-figure display kind (decision 8, pending Samuel) — pipeline side + frontend.
10. Second blind mapper for chapter-distributed items (decision 9, pending Samuel).
11. Real-data dry run of the whole line on Chapter 8 with stubbed model calls (no spend).

## App integration
12. Migration renumbering on g10 after hotfix v0.9.3 takes 032 on main: g10 032→033, 033→034 (+ rollback files, apply-migrations floor, ci-migrations proof names, docs).
13. Local dev DB is behind (lacks 029–033; 029 fails until 014 re-run) — bring up to date once agents stop using it.
14. Copy review (product-designer): sign-up curriculum question, /welcome copy, console strings; scan for JSX missing-space bug ("Americancurriculum").
15. /welcome header shows study links + "Prep 3 · Mathematics"; contract status code 422 vs 400 alignment.
16. CourseCompleteness beside the switch (FR-4309, T308) — unassigned.
17. T423: CI proof for the misconception catalogue (run test DB class in migrations job).
18. Guard test: package.json test list has no joined entries (`mts""`).
19. Expression marker: wire into api/attempts + MathAnswerInput (T414–T417) after Samuel picks library (T413).
20. Marker keys for generated typed answers (values/interval/recurring) confirm with marker package.

## Docs (tech-writer)
21. Runbook: test command (`uv run --project services/extraction ...`), run paths, S7 two passes + flags, S5 args + assembler flags, `widgets/<book>/` dir owner.
22. contracts/pipeline-handoff.md: block contract, run shapes; merged-lesson slug/group_key rule (slug_section).
23. FR-4407 wording (decision 6); tier names basic/standard/advanced (not basic/core/stretch).
24. Tick tasks + traceability rows for WP-D/E/G/H/P*, FR-1111 row, FR-4409 evidence, CODEOWNERS stub, DEPLOY docs.
25. `traceability.py --write` for all gated specs at integration.

## Content follow-ups (Samuel)
26. Two new misconception entries: substitution-sign (lo:t2u1-1-3), vertex-sign (lo:u1-4-3).
27. Live widget stem wording "y = 2x + -1", "y = 1x^2 + 0x + -4" (Prep-3) — cosmetic cleanup.
28. Arabic phrases in G10 prompts (decision 4 pending).

## From the marker evaluation (2026-09-25)
29. Decision #12 (T413 → ADR-0025): built-in marker, no library (recommended). Then T414–T417: wire into api/attempts (dispatch on choices.marker only), MathAnswerInput UI, add answer-marker.test.mts to the test list.
30. S3 prompt rules: raised dot = multiplication (write \cdot in keys); 5 printed answers not in the asked form (1-5/15, 1-11/29n, 1-6/14, 1-10/3h, 1-10/3i); "product of primes" items (1-11/28) must carry a form check.
31. The 8 "write as a decimal" items need a decimal form requirement (per-question form flag).
32. Pilot: log every unreadable-input return to learn real student typing.

## From grouping-on-screens (2026-09-25)
33. Progress page (`app/(student)/dashboard/page.tsx`) doesn't render the section roll-up yet (data is there: TopicRow.sections).
34. LessonSession header: show the part ("1.7 Factorisation · part 2 of 3") — rest of T410; `lesson.provenance` is available.
35. Merged lesson numbering: prompts say "section 1.3", check-in says "1.2–1.3" — align.
36. BUG: check-in says "Ministry textbook" for Grade 10 — use the course's book reference.
37. Objective labels with maths print raw LaTeX on check-in, subject home and skill map — render maths.
38. Section roll-up line on RTL (Arabic) cards: wording for product-designer.
39. tsc: answer-marker.ts uses BigInt literals — tsconfig target; fix at wiring (BigInt() or target ES2020).
40. Decision #13 (Samuel): Arabic lessons' real printed names (e.g. "عِبادُ الرَّحمنِ") instead of the first objective "فهم النص والاستماع" — changes National prompts (prompt hold).

## From the docs agent's code verification (2026-09-26)
41. T372: SpineExplorer picks by subject, not course — a tester with a cross-curriculum exception sees two maths courses merged. Make it a course picker.
42. T406: "continue <section>" recommendation not wired into the practice plan (only LessonCheckIn); getSectionIndex() may be dead code.
43. T305: SubjectDef.courseId alias skipped (end state T397 reached) — tick with a note.
44. T387: full requirement status pass (OPEN → BUILT/PARTIAL/VERIFIED) for spec 003 after integration.
45. T308/T410: being handled by the app-fixes agent (course completeness; LessonSession part label) — verify.
46. CI: pin astral-sh/setup-uv@v5 to a commit SHA (supply chain); CI path filter widened to services/extraction/** (more CI minutes, intended).

## From the marker wiring (2026-09-26)
47. Practice loop (`StudentLoop.tsx`, ?mode=practice) has no maths input; a re-entry shows as "API 422". Add MathAnswerInput + re-entry handling there (important for G10 practice).
48. ChatCore (answers typed in chat during Socratic probing): a re-entry is logged and dropped, not shown to the student. Show the message.
49. Docs: contracts/answer-marker.md → "decimal" form, 422 {retry, form|reason, message}, extended exact/unit/coordinate rules, grade() now in lib/attempt-grading.ts; tick T414–T417; marker-evaluation.md §7.
50. Decision for Samuel + privacy: log unreadable student inputs (text) to learn typing patterns? Today only question + reason are logged.
51. Existing lint error ChatQuestionCard.tsx useRef(Date.now()) (also at HEAD).

## From the app fixes (2026-09-26)
52. Review question: Arabic prompts read "ara1-1 · عِبادُ الرَّحمنِ — عِبادُ الرَّحمنِ" (name twice, because the objective ref already carries it). Trim the ref? (a further prompt-hold change).
53. Review question: added language-contract line for G10 — "English only in this course: write no Arabic at all … even if the student writes in Arabic". Confirm.
54. devops: confirm the Dockerfile COPY of services/extraction/coverage into the image (console completeness panel reads it).
55. Product-designer: Arabic roll-up wording «الأجزاء المتقنة: 2 من 3» (provisional).
56. Cleanup at the end: scratch DBs ainext_fe_scratch, ainext_fe_scratch_ui, ainext_scratch_wpm_marker; delete scratch session token files (scratchpad/g10/fe/*-refresh-token.txt, scratchpad/wpm/).

## From widgets A (2026-09-26)
57. Pipeline `generate_widget_questions.py`: add polygon_builder / solid_scaler / box_plot_builder (and B's venn_builder / area_model / curve extensions) to `reachability()`, `READING_FIELDS`, `reading_agrees()` — mirror `widget-payloads.ts` cases + `widget-docs.ts` DOCS word for word.
58. Run the full 438-file National prompt capture on a scratch DB migrated to 034 after all widget work lands (widgets A relied on the no-DB golden + BY_UNIT untouched).
59. Box plot uses the book's quartile method (linear interpolation, rank = 1 + p(n−1)) — record in the pipeline doc / widget docs.

## From widgets B (2026-09-26)
60. lib/lesson.ts: a G10 unit whose bank holds a new curve family (hyperbola/exponential/sine/cosine/tangent) should ask mathWidgetDocsNamed for "curve_sketcher_g10" instead of "curve_sketcher" (documented, not wired). National prompts must stay byte-identical.
61. Predicate name `complement-inside-a` (lower-case, to pass the naming test), not the brief's `complement-inside-A` — make any spec text match.
62. widget-emission.test.mts predicate scanner is a regex heuristic (first `predicate:` → first `given:`/+400 chars) — fragile; new grading modules can trip it. Consider a real parse.
63. Pipeline reachability for B's kinds (extends #57): curveReachable() bounds; venn counts sum to total, no cOnly/complementC on 2 sets; area_model a,b whole, not both 0, |a|,|b|≤4.
64. Someone's local-dev.sh --reset removed app/.env.local mid-session — check it is back before local runs.

## In flight (2026-09-26, pilot day)
- S0b ch8: pass A (wf_ace9e326-ddf), pass B (wf_e4887b3b-cbd), A50 calibration (wf_2648747c-cf6).
- by-ref agent: packet-by-reference for S1/S2–S4/S5/S6/S7 (args ≤15 KB), dry run in by-ref mode.
- maths-input agent: #47 practice loop, #48 ChatCore re-entry, #60 curve_sketcher_g10 in lesson.ts.

## Done by the maths-input agent (2026-09-26)
- #47 practice loop: MathAnswerInput + 422 re-entry via lib/attempts-client.ts (not an attempt). DONE.
- #48 ChatCore: re-entry shown as a local note (never sent to model, not graded). DONE.
- #60 lesson.ts: hasG10CurveFamily → curve_sketcher_g10 docs; National + G10 goldens unchanged. DONE.
- T414–T417 ticked; traceability Rev. 4; FR-4320 left OPEN for T387. npm test 1353 pass / 45 skip / 0 fail; tsc clean; both builds OK.
65. Review question (queue for Samuel's branch review): #60 has no FR of its own. (a) inherit under FR-1209 [agent default], (b) new FR in 003, (c) note on frozen 001 FR-1209 row.
66. SC-212 DB replay (scripts/marker-eval/replay-attempts.mts) not run — needs a copy of the local DB.

## From the by-ref agent (2026-09-26)
- DONE: packet by reference (S1, S5 draft, S6, S7 ≤15 KB args); embedded-script copies for S2–S4 and S5 final
  (embed_workflow.py); clips lifted in by-ref mode (s5-v3, s6-v3, s7-v3); inline unchanged. 404 tests + dry run both modes.
67. AFTER S1 is assembled: make S0a's write of work/<book>/blocks.jsonl atomic AND stop the test suite / dry run from
    rewriting the real work dir (use a temp copy). Record embedded hashes per lesson in lesson-runs.
68. Q3 deferred: S1 prior_objectives into a shard (needed around chapter 5–7 of a full book).
69. S2–S4: run per-lesson copies (first g10m8s2-1 as the size check), not one 230 KB run.

## S1 fixes + answer 15 (2026-09-26) — built by the by-ref agent
- Faults 1–4 fixed at cause (s1-v5): bracketed anchors (prompt + tolerant strip recorded as anchor_written; same in
  lesson.workflow.js lesson-v3), "cite as:" kinds per line, Haiku per-kind "supports", reconciler evidence as plain text.
- Answer 15: finders read in-scope end-of-chapter items; G1 verdict `outside_items` (named, coverage g1_exceptions).
- 70. Orchestrator calls (to confirm at branch review): keep the extra G1 decision `unpractised` (owed, not a failure);
     FR-4303 gained one sentence + traceability note (no new FR); answer 14 = decision 35, answer 15 = decision 36.

## Isolation audit (2026-09-26, Samuel asked for reassurance)
- Verified ISOLATED: subjects shown, lesson content, practice + /api/attempts re-check, next lesson/check-in (per course),
  ask/chat content, mastery (ids can't collide: g10m prefix), no parent screen. Server-side filtering, not UI-only.
- Production AINEXT_COURSE_GATING = on (GitHub var, 2026-09-22) → grade + curriculum both enforced.
- Gaps → isolation-fix agent (in flight): 1 bridge hints ungated (lesson.ts:1515); 2 retrieval prereq hop ungated
  + guard test misses seed subdirs + loader allows cross-course edges; 3 scope guard per-file not per-function;
  4 /spine + subject card merge two maths courses for exception holders (T372); 5 session cache key lacks scope (3 h);
  6 home copy "Egyptian Ministry textbook / syllabus 2025–2026" shown to American students.
71. Code default AINEXT_COURSE_GATING=off (docker-compose) → with gate off, grade is ignored (curriculum still enforced).
    Samuel's call whether to flip the default to on / refuse to start without it.
- Pilot: 8.2 lesson run wf_29588ac2-069 $2.28; 8.1/8.3a/8.3b/8.4 launched (wf_73acc1d0-255, wf_e927fd12-ec1,
  wf_96486877-d35, wf_e23ef7b4-30b).
