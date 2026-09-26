# Traceability — Curriculum Tracks and the Grade 10 American Mathematics Course

**Status date**: 2026-09-25 (rev. 3, after Samuel's third round of decisions) · **Branch**:
`feat/003-curriculum-tracks-g10-american-math` (from `main` at `v0.9.2`), **not committed**
**Authority**: [spec.md](./spec.md) rev. 4 · [decisions.md](./decisions.md) (Samuel, 2026-09-25) ·
constitution [v3.4.0](../../.specify/memory/constitution.md) (amended 2026-09-25 —
[constitution-amendment-proposal.md](./constitution-amendment-proposal.md) applied) ·
[ADR-0024](../../docs/decisions/0024-curriculum-as-a-visibility-dimension.md) (drafted) ·
[ADR-0025](../../docs/decisions/0025-answer-marker-build-in-house.md) (T413 closed) · the 2026-09-25
notes on [ADR-0005](../../docs/decisions/0005-extraction-pipeline.md),
[ADR-0019](../../docs/decisions/0019-serve-the-whole-maths-bank.md) and
[ADR-0020](../../docs/decisions/0020-mastery-gated-lesson-progression.md) ·
**[privacy-review.md](./privacy-review.md)** (security-privacy-officer, 2026-09-25)

> **Rev. 2 (2026-09-25).** Samuel's second answer, *"ok for all"*, adds FR-4311…FR-4320,
> FR-4407…FR-4409 and SC-211…SC-213, and changes FR-4301, FR-4302 and FR-4303 (spec rev. 3). Code for
> several rows is now on the branch, written by other agents. **No row moved past OPEN in that
> revision**: nobody had recorded evidence against these requirements yet, and rows move only on
> evidence.
>
> **Rev. 3 (2026-09-25).** Samuel's third round, thirteen answers taken one by one, adds FR-4410 and
> FR-4321 and changes FR-4205, FR-4208, FR-4210, FR-4306, FR-4320 and FR-4407 (spec rev. 4). It also
> closes gate T413 (the marker: ADR-0025) and approves the constitution amendment (applied, v3.4.0).
> **One row moves past OPEN in this pass**: 73 of `tasks.md`'s tasks (128 total, after this round added
> seven) were checked against the actual code on the branch — read in full, with their own tests
> confirmed real and run (272 passed, 47 skipped without a database, 0 failed, across the whole
> `services/extraction/tests` suite; the app side has its own passing test runs cited per task). Every
> FR whose implementing tasks are now confirmed built could in principle move to
> BUILT, but that full pass is **T387's job, not done in this one** — only **FR-4409** is updated here,
> because the pipeline instructions for this pass named it specifically. The rest stay OPEN
> deliberately, so a partial re-grading does not read as a completed one; T387 should do the rest from
> the same evidence WP verification agents produced 2026-09-25, rather than re-deriving it.
>
> **Rev. 4 (2026-09-26).** T414–T417 (the expression marker and its three UI surfaces) checked against
> the actual code and ticked in `tasks.md`: `lib/answer-marker.ts`, `lib/attempt-grading.ts` and the
> route's marker dispatch in `api/attempts/route.ts` were already built and tested (T414–T416); T417's
> own text ("create `MathAnswerInput.tsx` and use it in `ChatQuestionCard.tsx`") was already true, but
> two more surfaces that take a typed maths answer — `StudentLoop.tsx` (`?mode=practice`) and
> `ChatCore.tsx` (a chat-typed answer during Socratic probing) — had no maths input, or dropped a 422
> re-entry silently instead of showing the marker's message. Both now go through the same
> `submitAttempt`/`AttemptRetryError` seam `ChatQuestionCard.tsx` already used. FR-4320's *Implementation*
> and *Proof* columns are updated below to name what actually exists and what was run (`answer-marker.test.mts`,
> `attempt-grading.test.mts`, `math-answer-input.test.mts`, and two new tests,
> `student-loop-marker.test.mts` and `chat-core-retry.test.mts`, plus a clean `npx tsc --noEmit` and a
> green full `npm test`). **Status stays OPEN**, deliberately, for the same reason Rev. 3 gave: moving a
> row past OPEN is T387's full re-grading pass, not a side effect of whoever next touches one FR — a
> partial re-grading here would read as a completed one. The one thing this pass does NOT re-verify is
> SC-212's recorded-attempts replay (`scripts/marker-eval/replay-attempts.mts`), which needs a copy of
> the local database; that stays for T387 or a dedicated DB-backed run.
>
> **The same pass also closed a `lib/widget-docs.ts` TODO that names no task or FR of its own**: a G10
> unit's live `curve_sketcher` bank is now checked for the five families `curve_sketcher_g10` documents
> (hyperbola, exponential, sine, cosine, tangent) — `lib/lesson.ts`'s new `hasG10CurveFamily` — and
> `mathProtocol` asks `mathWidgetDocsNamed` for that key instead of the original two-family one when it
> does. This is the widget catalogue `FR-1209` (`001-student-mvp1-delta`, frozen, VERIFIED) already
> governs, extended for a curriculum FR-1209 predates; no 003 row names it, so it is not filed against
> either matrix here rather than invent a placement for it — see the report to Samuel. Covered by
> `g10-curve-sketcher-family.test.mts`; the National and Grade 10 prompt goldens stay byte-identical
> (neither fixture's curve_sketcher questions use a G10 family), proven by `g10-prompts.test.mts` and
> `national-prompts.test.mts` passing unchanged.
>
> **Rev. 1 is the pre-implementation matrix, and every row is OPEN by construction.** The
> requirements and this matrix are written before any code, following `docs/BRANCHING.md`'s
> discipline. Rows move only when evidence exists, and the counting rule below applies from the first
> commit. The *Tasks* column names the `tasks.md` tasks that will produce each row's evidence. The
> *Privacy* column cites the finding in `privacy-review.md` where a requirement exists or was
> sharpened because of it.

This document answers one question per row: **for this requirement, what code exists, and what
actually proves it works?** It is deliberately harsher than the spec: a requirement whose code exists
but has never been executed is not done.

## Status vocabulary

| Status | Means |
|---|---|
| **VERIFIED** | Code exists **and** was executed in this environment — against a loaded database, a passing test, or a rendered page. |
| **BUILT** | Code exists and typechecks, but the thing that would prove it needs the box, the Claude runtime, or a browser session nobody has run. |
| **PARTIAL** | Some of the requirement is real; the rest is named in the Proof column. |
| **OPEN** | Not started. |
| **BLOCKED** | Cannot proceed here — the blocker is named. |
| **DEFERRED** | Out of scope by an explicit decision, with the decision cited. |
| **DROPPED** | Withdrawn; the id is kept forever and never reused. |

**Counting rule**: a requirement is counted once, at its weakest part (`docs/VERSIONING.md`).

## Privacy review findings and where each landed

| Finding | Level | Landed in | Tasks |
|---|---|---|---|
| F1 flat labels, never a tier | SHOULD | FR-4016 | T368 |
| F2 curriculum never paired with a school | SHOULD | constitution proposal, VII | T389 |
| F4 GA4 exclusion test | **MUST** | FR-4016 | T370 |
| F5 `grade=10` on anonymous analytics | SHOULD | spec Open question 2 (latent; option (b) assumed) | T301 |
| F7 curriculum on Cost only as an aggregate | **MUST** | FR-4104 | T378 |
| F8 database-enforced "console-only" | **MUST** | FR-4017 | T312, T313 |
| F9 no names through the headcount | SHOULD | FR-4103 | T376 |
| F10 once-only Google step | **MUST** | FR-4014 | T312, T369, T370 |
| F11 FR-4008 vs decision 4 | **MUST** | FR-4008 (resolved in line with decision 4) | T306 |
| F12 not-offered at submit | SHOULD | FR-4005 | T306, T368 |
| F13 readers scoped before any load | **MUST** | FR-4202 | T314–T319, T325 |
| §5.1 Ask context's book list | **MUST** | FR-4202, FR-4006, FR-4206 | T314 |
| §5.2 `/dashboard` | **MUST** | FR-4006 | T315 |
| §5.3 home `/` | **MUST** | FR-4006 | T316 |
| §5.4 `/api/visuals` | SHOULD | FR-4006 | T317 |
| F14 load gated on the course's own presence; verified backup | **MUST** | FR-4208 | T325, T327 |
| F15 `refresh-content` on noor | **MUST** | FR-4210 | T326 |
| F16 no new secret; manual only | SHOULD | contracts/load-course.md | T324 |
| F17 drift guard in the load's post-flight | NICE | FR-4208 | T325 |
| F18 out-of-curriculum exception labelled | SHOULD | FR-4105 | T380 |
| F19 tester's two maths courses never interleave | SHOULD | FR-4009 | T310 |
| F3, F6, F20 | NICE | noted; F20 (migration 007) is outside 003 | — |

---

## 1. Curriculum as a dimension — FR-4001…FR-4017

| FR | Requirement | Status | Implementation | Proof | Tasks · Privacy |
|---|---|---|---|---|---|
| FR-4001 | Curricula are an extensible list: National `eg-national-en`, American `us-american-en` | **OPEN** | planned: `lib/curricula.ts` | `curricula-registry.test.mts` | T304 |
| FR-4002 | Every course belongs to exactly one curriculum; none means hidden | **OPEN** | planned: `lib/courses.ts`, `isCourseVisible` step 2 | `catalog.test.mts` | T305, T306 |
| FR-4003 | Exactly one curriculum per student, recorded as chosen or implied; existing students National, implied; unknown value sees nothing and is flagged | **OPEN** | planned: `students.curriculum_source` (033) | `catalog.test.mts`; migration proof | T306, T312 |
| FR-4004 | One "offered" rule: a curriculum with a live course for the grade; gate off, a course written for it | **OPEN** | planned: `offeredCurricula` | `catalog.test.mts` | T306 |
| FR-4005 | Sign-up asks only when two or more are offered; one or none stored as implied; not-offered at submit resolved and recorded | **OPEN** | planned: signup page, form, route | route tests; US3 walk | T306, T368 · F12 |
| FR-4006 | Curriculum scopes every student reader, including four ungated today | **OPEN** | planned: `resolveStudentScope`; readers in WP-C | `student-scope-guard.test.mts`; `catalog-gate.test.mts`; SC-206 pass | T307, T314–T318, T371 · §5 |
| FR-4007 | A curriculum never changes because an operator changed a rule; empty state says so | **OPEN** | planned: no automatic path exists by construction | `catalog.test.mts`; US4 scenario 2 | T306, T375 |
| FR-4008 | A grade change never moves a chosen curriculum (kept, flagged); an implied one may re-resolve, recorded | **OPEN** | planned: `resolveOnGradeChange` | `catalog.test.mts` | T306 · **F11** |
| FR-4009 | Exceptions win across curricula; two courses of one subject are never interleaved | **OPEN** | planned: `isCourseVisible` step 1; `COURSE_RANK` | `catalog-gate.test.mts` (tester case) | T306, T309, T310 · F19 |
| FR-4010 | Console-only change at launch, by `student-data`, confirmed in the page; no student control | **OPEN** | planned: console route and `CurriculumEditor` | `matrix.test.mts`; US5 walk | T381, T382, T383 |
| FR-4011 | A change loses nothing; changing back restores everything | **OPEN** | planned: nothing deletes; progress is per course | SC-209 proof | T383 |
| FR-4012 | Every change after sign-up kept as history; the initial value on `account_created` | **OPEN** | planned: `student_curriculum_changes` (033) | US5 scenario 4 | T312, T368, T381 |
| FR-4013 | One school year across curricula; labels per curriculum | **OPEN** | planned: `gradeLabel(grade, curriculum)` | `catalog.test.mts` | T304, T306 |
| FR-4014 | First Google sign-in: one screen, once only, second submission refused | **OPEN** | planned: `onboarding_pending`, `complete_student_onboarding()`, `/welcome` | `onboarding.test.mts` | T312, T369, T370 · **F10** |
| FR-4015 | Kill switch suspends rules, not curriculum scoping | **OPEN** | planned: gate-off branch of the scope | `catalog-gate.test.mts` gate off | T307, T311 · A confirmed 2026-09-25 (T301) |
| FR-4016 | Curriculum never in anonymous analytics or shown to another student; flat labels | **OPEN** | planned: first-party `account_created` only | `ga-curriculum-guard.test.mts` | T368, T370 · **F4**, F1 |
| FR-4017 | Console-only enforced by database privilege | **OPEN** | planned: 033 revoke and column grants; the definer function | `curriculum-privilege.test.mts`; 033's `DO $verify$` | T312, T313 · **F8** |

## 2. Console — FR-4101…FR-4105

| FR | Requirement | Status | Implementation | Proof | Tasks · Privacy |
|---|---|---|---|---|---|
| FR-4101 | Availability per curriculum, grade and course; the (course, grade) rule unchanged; sections per curriculum | **OPEN** | planned: `courseCatalog` sections; `CourseAvailabilityGrid` | US4 scenario 1 | T308, T375 |
| FR-4102 | Per grade, which curricula sign-up offers | **OPEN** | planned: `courseCatalog.offered` | US4 scenario 1 | T308, T375 |
| FR-4103 | Headcount before hiding a curriculum's last live course; count only | **OPEN** | planned: `lastLiveCourseHeadcount` via `CROSS_STUDENT_READS` | `course-count-guard.test.mts`; US4 scenario 2 | T308, T374, T375, T376 · F9 |
| FR-4104 | No figure pools two courses; Overview split by course; Cost aggregate-only | **OPEN** | planned: overview cohort key; content, cost, feedback labels | US4 scenario 3 | T377, T378 · **F7** |
| FR-4105 | Student 360: curriculum, source, flags, history, access reasons with out-of-curriculum exceptions labelled; list column | **OPEN** | planned: Student 360, `console-queries.ts` | US4 scenario 4 | T380 · F18 |

## 3. The Grade 10 American Mathematics course — FR-4201…FR-4212

| FR | Requirement | Status | Implementation | Proof | Tasks · Privacy |
|---|---|---|---|---|---|
| FR-4201 | The course exists: `course:us-g10-math-en`, curriculum `us-american-en`, subject Mathematics | **OPEN** | planned: `CourseDef`; the pipeline's bundles | registry test; console listing | T305, T364 |
| FR-4202 | Hidden until switched on; not named to anyone who cannot see it; switching on is the gate (ADR-0019 note) | **OPEN** | planned: default-deny, scoped readers, load writes no rule | `student-scope-guard.test.mts`; load post-flight "0 visibility rows" | T314–T319, T325 · **F13**, §5 |
| FR-4203 | Book order; no term labels | **OPEN** | planned: `terms: null`; bundle order | `catalogue-order-guard.test.mts`; walk | T309, T372 |
| FR-4204 | Grade 10 end to end; renders Play | **OPEN** | planned: all grade readers | a real grade-10 account on iPad Safari | T373, T393 |
| FR-4205 | This course names its own book and pages; its own prompts only (ADR-0020 note) | **OPEN** | planned: `CourseDef` facts; G10 captures | capture goldens | T320, T321, T323 |
| FR-4206 | National prompts and surfaces byte-identical; the Ask book-list line the one expected difference | **OPEN** | planned: facts moved verbatim | full capture compare | T320, T323 · §5.1 |
| FR-4207 | Drift guard per course | **OPEN** | planned: `parity_check.py --course` | pytest; load post-flight | T340, T364 |
| FR-4208 | Manual "Load a course": presence by id, verified backup, add-only, post-flight drift, never in a deploy | **OPEN** | planned: `load-course.yml`, `load-course.sh` | rehearsal on a scratch copy (SC-208) | T324, T325, T330 · **F14**, F17 |
| FR-4209 | Rehearsable; checkable from the console | **OPEN** | planned: dry-run mode; completeness view | T366 rehearsal | T325, T366 |
| FR-4210 | `refresh-content` on noor; keeps progress or refuses | **OPEN** | planned: `stack` input; refusal on student data | refresh rehearsal | T326 · **F15** |
| FR-4211 | At launch, G10 is the only course live for grade 10 | **OPEN** | an operator's rules in production | T392 checklist | T392 |
| FR-4212 | Probing off for G10 at launch; teaching page says which courses it reaches | **OPEN** | planned: `CourseDef.probing` | probing test; teaching page | T322, T379 |

## 4. Content completeness — FR-4301…FR-4310

| FR | Requirement | Status | Implementation | Proof | Tasks · Privacy |
|---|---|---|---|---|---|
| FR-4301 | Every chapter and section present; one section, one lesson, with G0's splits, promotions and merges (65 lessons, 2026-09-25); no sub-topic without a question | **OPEN** | the G0-approved manifest (scouting code); B3 to reproduce it | G0 record (decisions.md); `coverage/g10-math.json` GREEN | T333, T345, T352 ✔, T362, T402, T403 |
| FR-4302 | Canonical solutions from the book: its printed worked examples and its **EPUB worked solutions** (`book_worked_epub`); blind re-solve must agree with the printed answer and the EPUB solution; disputes held; source recorded; Teacher's Guide only where it adds | **OPEN** | planned: S3 in `lesson.workflow.js`; `solution_provenance` | G2 dossier; coverage counts by source | T336, T337, T361 |
| FR-4303 | Maths-expression answers become typed questions marked by FR-4320; multiple choice only where natural; proofs and sketches stay worked examples; counted (amended 2026-09-26, decision 36: an end-of-chapter item ruled outside its chapter at G1 is kept out of practice and listed, named, in the coverage audit) | **OPEN** | planned: S3 answer typing | coverage counts; console completeness | T337, T345, T414 |
| FR-4304 | Generated families per ADR-0008, as declarative specs; 10% sample | **OPEN** | planned: `generate_questions.py --families` | pytest; G3 sample file | T343, T361 |
| FR-4305 | Tier floor per objective, or listed by name | **OPEN** | planned: S6 gap list; completeness view | coverage; console list | T343, T362, T375 |
| FR-4306 | Widget questions for every chapter; new kinds only with Samuel's OK | **OPEN** | planned: S7; widget-gap list | gap list; T356 decision record | T344, T355, T356, T357 |
| FR-4307 | Misconception catalogue for this book; every tag has a refutation; one error, one entry | **OPEN** | planned: S5 fail-closed | coverage equality (FR-1112) | T341, T342, T361 |
| FR-4308 | App notation; vocabulary and contexts as printed; refutations cite this book only | **OPEN** | planned: assembly normalisation | coverage normalisation counts | T338 |
| FR-4309 | Completeness beside the switch, computed from the rows shown | **OPEN** | planned: `CourseCompleteness` | US1 scenario 1 | T308, T375 |
| FR-4310 | Provenance from one place; operators only | **OPEN** | planned: `lib/provenance.ts` extended | existing provenance tests extended | T308, T380 |

## 4a. Native figure types — FR-4321 **[ADDED rev. 4, decision 26]**

| FR | Requirement | Status | Implementation | Proof | Tasks · Privacy |
|---|---|---|---|---|---|
| FR-4321 | A figure no existing kind can draw gets a native renderer, on a figure-gap inventory for Samuel's OK first, never a static approximated image | **OPEN** | planned: extend S4's `viz-gaps.json` reporting to count occurrences and sizes per needed kind | figure-gap inventory; approval record | T429 |

## 4b. Book sections and the expression marker — FR-4311…FR-4320 **[ADDED rev. 2]**

| FR | Requirement | Status | Implementation | Proof | Tasks · Privacy |
|---|---|---|---|---|---|
| FR-4311 | Every lesson, every course and curriculum, carries its book provenance (sections, part n of m, merged sections, chapter introduction) | **OPEN** | planned: the book-sections store (migration 034), bundle schema, loader | load checks; National courses carry one-section provenance | T400, T401, T402, T404 |
| FR-4312 | A section's parts consecutive in catalogue order | **OPEN** | planned: `lib/book-sections.ts`, `module-order.ts` | `book-sections.test.mts`; `catalogue-order-guard.test.mts` | T405 |
| FR-4313 | Parts are one unit for recommendations and the next lesson; never past a section until every part passes | **OPEN** | planned: `progression.ts`, `progression-db.ts`, the practice plan | progression tests; US6 scenarios 2–3 | T406 · extends FR-3202; ADR-0020 note |
| FR-4314 | Per-part scoring; section roll-up "k of m", mastered only when every part is | **OPEN** | planned: `book-sections.ts` roll-up; subject home, progress page | `book-sections.test.mts`; SC-211 | T405, T407 |
| FR-4315 | Skill map shows parts as one group | **OPEN** | planned: `spine-layout.ts`, `SpineExplorer.tsx` | `spine-layout.test.mts`; US6 scenario 5 | T409 |
| FR-4316 | Ask context treats sibling parts as closely related; unchanged for a course with no parts | **OPEN** | planned: `lib/ask.ts` | capture proof: National prompts byte-identical | T408 |
| FR-4317 | Automatic part n−1 → n prerequisites, recorded as product-added | **OPEN** | planned: derived from the store, never written as book edges | `book-sections.test.mts` | T404, T405 |
| FR-4318 | Printed section number (and part n of m) always shown; National display unchanged | **OPEN** | planned: `LessonCheckIn`, `LessonSession`, `SubjectHome` | US6 scenario 1; National walk | T410 |
| FR-4319 | Console reports per lesson and per section | **OPEN** | planned: `content-admin.ts`, `overview-queries.ts` | US6 scenario 7 | T411 |
| FR-4320 | Typed maths answers marked by equivalence, with form checks and decision-15 normalisation; unreadable → re-enter; numbers and choices unchanged | **OPEN** *(Rev. 4: code built, re-grading is T387's)* | built: `lib/answer-marker.ts` (the engine, ADR-0025), `lib/attempt-grading.ts` (`markAnswer`, the route's dispatch), `lib/attempts-client.ts` (`submitAttempt`/`AttemptRetryError`, the one client seam), `MathAnswerInput.tsx` — wired into all three typed-answer surfaces: `ChatQuestionCard.tsx`, `StudentLoop.tsx` (`?mode=practice`) and `ChatCore.tsx` (a chat-typed answer during Socratic probing) | `answer-marker.test.mts`, `attempt-grading.test.mts`, `math-answer-input.test.mts`, `student-loop-marker.test.mts`, `chat-core-retry.test.mts` all pass; `npx tsc --noEmit` clean; full `npm test` green (1353 passed, 45 skipped without a database, 0 failed). Not re-verified here: SC-212's recorded-attempts DB replay (`scripts/marker-eval/replay-attempts.mts`) | T413–T417 |

## 5. The extraction pipeline — FR-4401…FR-4409

| FR | Requirement | Status | Implementation | Proof | Tasks · Privacy |
|---|---|---|---|---|---|
| FR-4401 | One run produces every content kind, each stage gated | **OPEN** | planned: B4–B13 | Chapter 8 pilot through S11 | T334–T344, T353 |
| FR-4402 | A chapter-and-section English book, no hand skeleton; structure approved first | **OPEN** | planned: B2, B3; gate G0 | manifest and G0 record | T332, T333, T352 |
| FR-4403 | Per-stage report of produced, rejected and cost | **OPEN** | planned: B14, B16 | `runs/g10-math/cost.jsonl` | T345, T347 |
| FR-4404 | Re-run adds nothing; other courses untouched | **OPEN** | planned: B9, B15 | double run on scratch (SC-210) | T339, T346 |
| FR-4405 | Arabic self-check 100%, Arabic audit green, sacred gate unchanged, old bundles unchanged | **OPEN** | planned: B7 byte-identical dumps | `selfcheck_arabic.py`, `audit_arabic.py` | T336 |
| FR-4406 | Documented well enough to ingest the next book from the doc alone | **OPEN** | `docs/specs/extraction-pipeline.md` v2 and `runbook/README.md`, **brought up to date 2026-09-25** (T350 ✔) | SC-210 fresh-engineer run — not yet done | T350 ✔ |
| FR-4407 | Maths images turned into checked text: two independent passes, hash or agreement, PDF cross-check, queue for a human, never guessed | **OPEN** | planned: `transcribe-maths.workflow.js`, `assemble_maths.py` (B21) | `test_assemble_maths.py`; S0b counts (SC-213) | T418–T421 |
| FR-4408 | Teacher-only material dropped before claims; never student-facing | **OPEN** | planned: `teacher_only` block (B2), dropped at S2 (B6) | coverage equality: 0 teacher blocks reaching a claim | T332, T337 |
| FR-4409 | One source for the maths misconception catalogue; six entries live; no live id renamed; export keeps kind and aliases; tests + CI proof | **BUILT** *(was OPEN; verified 2026-09-25 — T342, T422)* | B19: `seed/generated/misconceptions.json` is the single source; `build_misconceptions.py` retired; `seed/misconceptions-math.json` deleted (confirmed by `git status`); the six `t2u3-1-2` entries are in, each with a refutation; `export_generated_content.py` keeps `kind` and `aliases` on round trip | `services/extraction/tests/test_misconception_catalogue.py` (asserts the live id set is a superset, the six entries are present, aliases unchanged); `test_export_generated_content.py`'s round-trip tests. **Not yet VERIFIED**: T423's CI proof (loading the catalogue twice into a scratch database in CI) has not run, and T424's local rehearsal against the Prep-3 bank has not run — this is what would close it | T342, T422, T423, T424 |
| FR-4410 | A stage finds this book's prerequisite links in the book, evidence-backed; a second AI checks each; approved at G1 with the objectives | **OPEN** | planned: `objectives.workflow.js` / `assemble_objectives.py` (WP-P2) | G1 record | T428 |

## 6. Success criteria — SC-201…SC-213

| SC | Criterion | Status | Implementation | Proof | Tasks |
|---|---|---|---|---|---|
| SC-201 | 100% of chapters and sections, in order; zero sub-topics without a question | **OPEN** | the coverage audit | `coverage/g10-math.json` | T362 |
| SC-202 | Zero served book questions without a solution or with a disagreeing re-solve | **OPEN** | S3 and G2 | coverage and G2 record | T361 |
| SC-203 | Tier floor met, or named | **OPEN** | S6 and completeness | console list empty | T362 |
| SC-204 | Every chapter has a widget question; 100% of tags resolve to explained misconceptions | **OPEN** | S5–S7 | coverage equalities | T362 |
| SC-205 | Grade-10 sign-up to first tutor message under 5 minutes, at most one added question | **OPEN** | US3 | stopwatch walk | T393 |
| SC-206 | Zero cross-curriculum items on any surface, gate on and off | **OPEN** | the scope | SC-206 pass | T373 |
| SC-207 | National prompts byte-identical; no visible difference for existing students | **OPEN** | A7 | capture compare | T323 |
| SC-208 | The load changes zero other rows; a second run changes zero; rollback exact | **OPEN** | A8 | rehearsal on a scratch copy | T330 |
| SC-209 | Change and change back restores 100% of progress; both changes in history | **OPEN** | A5, A6 | scratch-database proof | T383 |
| SC-210 | A second pipeline run adds zero; a fresh engineer succeeds from the doc alone | **OPEN** | A9 | double run; fresh run | T350, T353 |
| SC-211 | No student moved past a split section with a part not passed; roll-ups agree with parts | **OPEN** | A12 | progression tests; US6 walk | T406, T412 |
| SC-212 | Marker: 100% of printed answers and equivalents correct, 0 wrong-form correct, existing attempts identical on replay | **OPEN** | A13 | `answer-marker.test.mts`; attempts replay | T415, T416 |
| SC-213 | 100% of unique maths images accepted by fingerprint or agreement, or queued for a human; 0 guessed | **OPEN** | B21 | S0b report | T419, T421 |

## 7. What is unresolved, and who owns it

Rev. 1's items 1–3 are **closed**. They are struck through below rather than deleted, so the record
shows how each was closed.

| # | Item | Owner | Why it matters |
|---|---|---|---|
| 1 | ~~decisions.md A–E adopted under "all recommendations"~~ **Confirmed 2026-09-25** ("ok for all", T301) | Samuel | A: the kill switch keeps curriculum scoping (FR-4015) |
| 2 | ~~Privacy review F5~~ **Option (b) confirmed 2026-09-25**: anonymous analytics stay unconfigured until the cohort is larger | Samuel | Configuring the measurement id reopens it |
| 3 | ~~The Ask book-list line~~ **Acknowledged 2026-09-25** | Samuel | FR-4206's one expected difference |
| 4 | ADR-0024 and the notes on ADR-0005, 0018, 0019 and 0020 are accepted ("ok for all") but not committed | **Samuel** (T388) | The commit is his |
| 5 | ~~The constitution amendment proposal~~ **Approved and applied 2026-09-25** (third round, answer 7: *"Yes, update it (Recommended)"*; decisions.md decision 28). `.specify/memory/constitution.md` is v3.4.0. T389 is still unticked (a human-gate checkbox no agent marks), but the substance is done | **Samuel**, explicitly | Done |
| 6 | ~~The expression marker's library or approach~~ **Decided 2026-09-25**: build in-house, no library (third round, answer 2; [ADR-0025](../../docs/decisions/0025-answer-marker-build-in-house.md); T413 gate record) | **Samuel** | Done |
| 7 | **G0b and G2 human time**: S0b's queue, and the three-way disagreements across 2,531 items | **Samuel** | The critical path of the ingest run; the Chapter 8 pilot sizes it |
| 8 | **B19 touches live Prep-3 content** | Engineering, then Samuel at merge | Tests and the CI proof (T423) before merge (FR-4409) |
| 9 | **The book's licence terms** | Samuel's team, outside the app | Out of scope by instruction; recorded so it is not lost |
| 10 | **Stale comments in migrations 027 and 028** describe a loader that deletes on reload | the app and devops agents (T425, T426) | They now contradict the add-only, refusing loader. Also `deploy/refresh-content.sh:261`, `deploy/DEPLOY.md:136`, `ci-cd.yml:610`, `local-dev.sh:162` |

---

## 10. Counts

<!-- GENERATED by scripts/traceability.py --write. Do not edit by hand:
     the next run overwrites it. Change the spec or the rows instead. -->

| | Count |
|---|---|
| Functional requirements | **65** |
| Success criteria | **13** |
| Traced (every one needs a row) | **78 / 78** |
| — verified | 0 |
| — built | 1 |
| — partial | 0 |
| — open | 77 |
| — blocked | 0 |
| — deferred | 0 |
| Requirements a test declares | **48** |
| Tasks complete / total | **72 / 128** |

**Of 0 requirements marked VERIFIED, 0 have an automated test declaring them.** The remaining 0 were verified by running the product — a browser session, a query against a loaded database — which is real evidence and is not re-checked on any later commit. That gap is the honest measure of this build's regression risk, and it is the number to drive down.

Counted from the artifacts by `scripts/traceability.py`, which fails CI when the spec, the matrix and the tests disagree. The hand-maintained table this replaced had drifted five requirements out of date, and an entire deferred block had no row at all.

The frozen baseline (`specs/000-baseline/`) defines 31 more requirements. It shipped and is not under change (ADR-0007), so it is reported by the tool but never gated — it has no matrix of its own yet.
