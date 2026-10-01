# Traceability — Curriculum Tracks and the Grade 10 American Mathematics Course

**Status date**: 2026-09-27 (rev. 6; rev. 3 was the last full re-read of the rows) · **Branch**:
`feat/003-curriculum-tracks-g10-american-math` (from `main` at `v0.9.2`, brought up to `v0.9.3`),
committed only as unreviewed WIP snapshots on the pushed branch — not reviewed, not merged
**Authority**: [spec.md](./spec.md) rev. 4 with its 2026-09-26/27 amendments · [decisions.md](./decisions.md)
(Samuel, 2026-09-25 and 2026-09-26, decisions 1–47) ·
constitution [v3.4.0](../../.specify/memory/constitution.md) (amended 2026-09-25 —
[constitution-amendment-proposal.md](./constitution-amendment-proposal.md) applied) ·
[ADR-0024](../../docs/decisions/0024-curriculum-as-a-visibility-dimension.md) (accepted 2026-09-25) ·
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
> **Rev. 5 (2026-09-26) — the curriculum-isolation audit.** Samuel's standing requirement that each
> curriculum and each grade stay isolated during teaching; a read-only audit found six gaps, all fixed
> server-side in this pass. **Evidence is added to FR-4006, FR-4009, FR-4202, FR-4205 and FR-4206 below;
> no status moves** (T387's rule, as Rev. 3 and 4 gave it). What was built, per gap:
> (1) the tutor's cross-subject bridges (`getLessonBridges`) now require BOTH ends' courses in the
> student's scope, and the `{{switch_subject:…}}` handoff is offered only to a subject with a course she
> may see (`crossSubjectRule`, `lib/lesson.ts`); (2) retrieval's one prerequisite hop is filtered by her
> scope (`nearestSkillMastery`, `lib/retrieval.ts`), the seed check reads every subdirectory and walks
> multi-level `part_of`, and `services/extraction/load_seed.py` refuses a prerequisite joining two courses
> unless `ALLOWED_CROSS_COURSE_PREREQUISITES` (empty) names it; (3) `student-scope-guard.test.mts` checks
> each **function** of a scoped file, not the file — it flags the pre-fix `getLessonBridges` and
> `nearestSkillMastery` when run on the old source; (4) T372 (see tasks.md); (5) the Ask/lesson snapshot
> key carries a scope fingerprint, so a scope change reaches an open chat on its next turn — this
> contradicted FR-4011's last sentence; **Samuel chose "next turn" (decision 37) and the FR now says so**;
> (6) the signed-in home page takes its book and syllabus wording from the courses she may see
> (`CourseDef.homeCopy`, `sourceWordingFor`). Proof run: `npx tsc --noEmit` clean; `npm test` 1412 tests,
> 0 failed (1362 passed and 50 skipped without a database; 1412 passed with `AINEXT_SCRATCH_PG` set,
> including the five new database cases in `curriculum-scope-db.test.mts`);
> `services/extraction/tests/test_cross_course_prereq.py` 10/10 against a scratch Postgres; both builds
> exit 0. **Both prompt goldens are byte-identical** (`national-prompts.test.mts`, `g10-prompts.test.mts`
> unchanged and passing): their fixtures render with no student, whose scope refuses nothing.
> **Same day, after Samuel's answers 16–17 (decisions 37–38):** FR-4011 and its edge case reworded
> ("next turn"); the handoff/bridge difference for a student who cannot see a subject allowed as
> ADR-0020's seventh exception (renumbered the **eighth** on 2026-09-27) and written into FR-4206; and a server-side filter
> (`lib/handoff-filter.ts`, wired into `/api/ask` for every delta and the ledger's copy) removes any
> `{{switch_subject:…}}` card to a subject she may not open (`handoff-filter.test.mts`). Separately, a
> display-only `align`/`align*` inside `$...$` is rewritten to `aligned` before KaTeX renders it
> (`lib/math-text.ts` `inlineSafeTex`, `components/TeXRenderer.tsx`; `tex-inline-align.test.mts`) — a
> rendering safety net for older content, filed against no FR.
>
> **Rev. 6 (2026-09-27) — documents brought level with decisions 34, 41 and 43–45; no status moves.**
> The spec now writes in what the code already does: FR-4320 states the "true, but be more precise"
> re-entry for a less specific choice (decision 41) and decision 24's detail; FR-4302 states answer-only
> marking and Samuel's approved corrections to the book's working (decisions 43–45); FR-4206 and SC-207
> name the third expected National difference, the Arabic lessons' printed names (decision 34). The
> FR-4302, FR-4320, FR-4206, SC-207, FR-4407, FR-4410 and SC-213 rows below cite the evidence that
> already exists for those. In `tasks.md`, T303, T304, T427, T428, T431, T432 and T433 are ticked
> after their code and tests were read and run (40 pipeline tests in `test_assemble_maths.py` and
> `test_objectives.py`; 45 app tests in `curricula-registry`, `lesson-names`, `national-prompts`,
> `g10-prompts`, `question-flags` and `answer-only-prompts`, all passing). ADR-0020's exceptions are
> renumbered in one list: the G10 course's prompts are the fifth, Arabic lesson names the sixth, G10
> English-only the seventh, the handoff line the eighth.
>
> **What OPEN means in this matrix today.** The vocabulary below defines OPEN as "not started", and
> that was true at rev. 1. It is no longer true for most rows: code and passing tests exist behind
> about forty rows still marked OPEN. Until T387 re-grades them, **OPEN here means "not yet re-graded
> (T387)", not "not started"** — read each row's *Implementation* and *Proof* columns, and `tasks.md`'s
> ticks, for what exists. Where an *Implementation* cell still says "planned:", the file may well exist
> now.
>
> **Rev. 6 (2026-09-27) — the consistency review's app-side fixes that needed no decision** (`docs/WIP-g10-pilot/consistency-review-2026-09-27.md`). A6 → FR-4302 / 001 FR-C01, A10 → 001 FR-1206, A11 → FR-4104 (evidence on those rows; no status moves). **Two have no requirement, and none is invented**: **A3** — a question's own figure on its card, and the "[figure]" placeholder never printed (`lib/question-figures.ts`, `components/viz/QuestionFigures.tsx`; the readers attach `figures` from `visuals.question_id`; `question-figures.test.mts`, `curriculum-scope-db.test.mts`) — no FR says a question's figure is shown with it; and **I4** — the Grade 10 home card says "Mathematics — Grade 10", not the book node's title (`CourseDef.cardLabel`; `catalog-gate.test.mts`). **W1** — every widget question's diagnostics use predicates its mode can emit — is proven on the repo's Prep-3 and Grade 10 banks by `widget-can-emit-bank.test.mts` against the contract's v2 `can_emit` table (FR-4307, 001 FR-1206). Both prompt goldens unchanged.
>
> **Rev. 6, pipeline side (data-engineer, 2026-09-27) — A5, A7, A10, A12 and W1** (no status moves; evidence on the FR-4302, FR-4304, FR-4306 and FR-4307 rows). **A5** → FR-4307 (+ FR-4302's "never presented to a student as the book's own history"): 9 of 29 refutations patched as pipeline normalisations beside the run (`runs/g10-math/misconceptions/final-wf_ed8c8e80-51d.normalisations.json`, 13 patches, who and why; `assemble_misconceptions.apply_normalisations`, fail-closed on the exact text), refused at assembly for every catalogue (`leak_problems` in `validate_catalogue`), S5 packets carry no G2 note and mark a corrected solution (`s5_args`), prompt `s5-v5`; the catalogue reloaded into `ainext_pilot_g10_ch08`. **A7** → FR-4302/FR-4303: seven stems (Ex8-6:21c, 21d, 22a–22e) get their own lead-in only, as orchestrator-applied G2 fixes in `runs/g10-math/g2.json` (`stem_fix_by`; flagged for Samuel at G3/G4). **A12** → FR-4304: `quad-rotated-start` flagged for G3 (`runs/g10-math/g3-flags.json`). **W1 + A10** → FR-4306 (and 001's FR-1213): the contract's per-mode `can_emit` table, derived from the widgets' grading code and mirrored in `app/src/lib/widget-predicates.ts` (`WIDGET_CAN_EMIT`, `canEmit`; `widget-predicates.test.mts`), enforced by `widget_spec.validate_widget` on active and held mappings; S7 prompts `s7-v7` (instruments = `widget-docs.ts` DOCS word for word for every kind; the table in the author's contract and, kind-level, the verifier's packet); a "points" target or its swap on LineDrawer's opening handle is refused (`opening_collisions`). Grade 10: 5 active + 9 held dead mappings dropped (`--normalise-templates`: `drop-dead-predicate`, `drop-opening-instance`, verdicts carried by `verified_as`), `gradient-to-missing-coord` held out (`widgets/g10-math/_held--…`), bundle 25 → 20 widgets (17/22 → 11/13 active/held), five rows retired in the scratch DB. **Prep 3 (LIVE)**: the 14 dead mappings corrected in `seed/generated/widget-questions.json` and the legacy templates (record: `widget-questions.corrections.json`) — not shipped: production needs a data migration in a release, on Samuel's go.
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
| F12 not-offered at submit | SHOULD | FR-4005 — **moot since 2026-10-01, answer 36**: sign-up now always asks and accepts any known curriculum regardless of what the grade offers, so this race no longer arises | T306, T368, T434 |
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
| FR-4001 | Curricula are an extensible list: National `eg-national-en`, American `us-american-en` | **OPEN** | built: `lib/curricula.ts` (`CURRICULA` with labels, `labelAr`, `gradeLabels`, `programNodeId`, key order; `DEFAULT_CURRICULUM`, `asCurriculumId`, `isKnownCurriculum`) — T304 ticked 2026-09-27 | `curricula-registry.test.mts` (12 tests, passing 2026-09-27) | T304 |
| FR-4002 | Every course belongs to exactly one curriculum; none means hidden | **OPEN** | planned: `lib/courses.ts`, `isCourseVisible` step 2 | `catalog.test.mts` | T305, T306 |
| FR-4003 | Exactly one curriculum per student, recorded as chosen or implied; existing students National, implied; unknown value sees nothing and is flagged | **OPEN** | planned: `students.curriculum_source` (033) | `catalog.test.mts`; migration proof | T306, T312 |
| FR-4004 | One "offered" rule: a curriculum with a live course for the grade; gate off, a course written for it | **OPEN** | planned: `offeredCurricula` | `catalog.test.mts` | T306 |
| FR-4005 | Sign-up asks only when two or more are offered; one or none stored as implied; not-offered at submit resolved and recorded | **OPEN** | planned: signup page, form, route | route tests; US3 walk | T306, T368 · F12 |
| FR-4006 | Curriculum scopes every student reader, including four ungated today | **OPEN** | planned: `resolveStudentScope`; readers in WP-C. **2026-09-26 (isolation audit)**: "the data given to the tutor" now also gated at its two readers that reached outside the lesson — `getLessonBridges` (`lib/subject-queries.ts`, both ends' courses, required `CourseScope` parameter) and `nearestSkillMastery` (`lib/retrieval.ts`, one hop filtered by course); the handoff rule offers only visible subjects (`crossSubjectRule`, `lib/lesson.ts`); the session snapshot is keyed by `scopeFingerprint` (`lib/session-cache.ts`, `api/ask/route.ts`); the loader refuses cross-course prerequisites (`load_seed.py`) | `student-scope-guard.test.mts` (now per function; negative control on the pre-fix shape); `catalog-gate.test.mts` (bridge gate); `session-cache.test.mts` (scope in key); `handoff-filter.test.mts` (a card to a closed subject removed, every stream split, the route wired — decision 38); `curriculum-scope-db.test.mts` (bridges, handoff, retrieval hop against Postgres); `test_cross_course_prereq.py`; SC-206 pass still owed | T307, T314–T318, T371 · §5 |
| FR-4007 | A curriculum never changes because an operator changed a rule; empty state says so | **OPEN** | planned: no automatic path exists by construction | `catalog.test.mts`; US4 scenario 2 | T306, T375 |
| FR-4008 | A grade change never moves a chosen curriculum (kept, flagged); an implied one may re-resolve, recorded | **OPEN** | planned: `resolveOnGradeChange` | `catalog.test.mts` | T306 · **F11** |
| FR-4009 | Exceptions win across curricula; two courses of one subject are never interleaved | **OPEN** | planned: `isCourseVisible` step 1; `COURSE_RANK`. **2026-09-26**: the subject home and the skill map no longer merge a tester's two maths courses — one card and one map per course (`getSubjectSummaries`, `getSpineData` `courses`, `SpineExplorer.tsx`), the landing counts courses (T372) | `catalog-gate.test.mts` (tester case; two cards); `student-landing.test.mts`; `curriculum-scope-db.test.mts` (two cards, two maps against Postgres) | T306, T309, T310, T372 · F19 |
| FR-4010 | Console-only change at launch, by `student-data`, confirmed in the page; no student control | **OPEN** | planned: console route and `CurriculumEditor` | `matrix.test.mts`; US5 walk | T381, T382, T383 |
| FR-4011 | A change loses nothing; changing back restores everything | **OPEN** | planned: nothing deletes; progress is per course. **2026-09-26 (decision 37)**: the last sentence now reads "an open conversation reads the new scope on its next turn" — the session snapshot is keyed by the student's scope (`lib/session-cache.ts` `scopeFingerprint`, `api/ask/route.ts`) | SC-209 proof; `session-cache.test.mts` (a changed scope is a changed key) | T383 |
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
| FR-4104 | No figure pools two courses; Overview split by course; Cost aggregate-only | **OPEN** | planned: overview cohort key; content, cost, feedback labels | US4 scenario 3 | T377, T378 · **F7** · **2026-09-27 (consistency review A11; status unchanged)**: `/pipeline` for the Grade 10 course no longer crashes — its review card read `choices` as a list; `lib/pipeline-queries.ts` now reads the options through `choiceOptions` (a typed answer lists none). Proof: `question-flags.test.mts` |
| FR-4105 | Student 360: curriculum, source, flags, history, access reasons with out-of-curriculum exceptions labelled; list column | **OPEN** | planned: Student 360, `console-queries.ts` | US4 scenario 4 | T380 · F18 |

## 3. The Grade 10 American Mathematics course — FR-4201…FR-4212

| FR | Requirement | Status | Implementation | Proof | Tasks · Privacy |
|---|---|---|---|---|---|
| FR-4201 | The course exists: `course:us-g10-math-en`, curriculum `us-american-en`, subject Mathematics | **OPEN** | planned: `CourseDef`; the pipeline's bundles | registry test; console listing | T305, T364 |
| FR-4202 | Hidden until switched on; not named to anyone who cannot see it; switching on is the gate (ADR-0019 note) | **OPEN** | planned: default-deny, scoped readers, load writes no rule. **2026-09-26**: a bridge or a prerequisite hop can no longer name a hidden course's objective to the tutor (see FR-4006) | `student-scope-guard.test.mts`; `curriculum-scope-db.test.mts` (the G10 bridge never reaches a National prompt); load post-flight "0 visibility rows" | T314–T319, T325 · **F13**, §5 |
| FR-4203 | Book order; no term labels | **OPEN** | planned: `terms: null`; bundle order | `catalogue-order-guard.test.mts`; walk | T309, T372 |
| FR-4204 | Grade 10 end to end; renders Play | **OPEN** | planned: all grade readers | a real grade-10 account on iPad Safari | T373, T393 |
| FR-4205 | This course names its own book and pages; its own prompts only (ADR-0020 note) | **OPEN** | planned: `CourseDef` facts; G10 captures. **2026-09-26**: the signed-in home page's "extracted from the Egyptian Ministry textbook" / "syllabus 2025–2026" now come from her courses (`CourseDef.homeCopy`, `sourceWordingFor`); a `/spine` page citation and a question's provenance name the book of the course on screen (`SpineData.courses`). **Decision 30 (English-only), T431**: `CourseTutorFacts.arabicTouches` in `lib/courses.ts` — `true` for every National course, `false` for G10; `lib/lesson.ts` swaps the Arabic touches for English ones and adds a language line when it is off | capture goldens; `curriculum-scope-db.test.mts` (home wording per student; each map's own book); `g10-prompts.test.mts` (no Arabic script in any G10 render; "an Egyptian grade-10 student" kept in all four address registers); `lesson-names.test.mts`; `national-prompts.test.mts` unchanged | T320, T321, T323, T372, T431 |
| FR-4206 | National prompts and surfaces byte-identical, except three expected differences: the Ask book-list line, the handoff line (decision 38), the Arabic lessons' printed names (decision 34) | **OPEN** | planned: facts moved verbatim. **2026-09-26**: the isolation fixes leave both goldens byte-identical and a National home page reads the same words (`NATIONAL_HOME`). **A second expected difference, allowed by Samuel (decision 38; ADR-0020's eighth exception, numbered the seventh until 2026-09-27) and now in the FR**: for a student who cannot see a subject, her lesson prompt's CROSS-SUBJECT line offers no handoff to it and a hidden course's bridge drops out; a handoff card to a closed subject is also removed from the reply server-side (`lib/handoff-filter.ts`). **A third, decision 34 (ADR-0020's sixth exception), written into the FR 2026-09-27**: the Arabic lessons take the book's printed names from `course_lessons.title` (`services/extraction/books/prep3-arabic-ar.json` `lesson_titles`, written by `load_seed.py`; read through `CourseTutorFacts.bookLessonTitles` in `lib/courses.ts` and `shownTitles`) | full capture compare — **not yet re-run over a real database** (integration backlog 58); `national-prompts.test.mts` (the v0.9.2 golden unchanged with no stored titles; with the loader's rows in the store, exactly five Arabic renders change, each by the title only) and `g10-prompts.test.mts` passing; `lesson-names.test.mts` | T320, T323, T432 · §5.1 |
| FR-4207 | Drift guard per course | **OPEN** | planned: `parity_check.py --course` | pytest; load post-flight | T340, T364 |
| FR-4208 | Manual "Load a course": presence by id, verified backup, add-only, post-flight drift, never in a deploy; a `restore` mode replaying a reviewed export, typed course id, provenance-checked | **OPEN** | planned: `load-course.yml`, `load-course.sh`. **2026-09-28 (T430; status unchanged — not yet run on the box)**: the restore mode is built — `restore-dry-run` / `restore-rehearse` / `restore [export_ref]` replay one course's committed export (`restore_course_bundle.py`), each row keeping its own status and review stamp; typed course id (the workflow, and `CONFIRM` again on the box); backup first (`ops_backup`) and a read-back verified inside the transaction and again after it; refused on provenance — no `export-record.json` (now written by `export_generated_content.py --course`), a file whose sha256 differs from its record, another course or book, a different source document, a moved id. The old whole-database `restore` is now `rollback`, behaviour unchanged | rehearsal on a scratch copy (SC-208); `test_load_course_restore.py` (restore puts back statuses and stamps; provenance refusals; the real `load-course.sh` end to end through `tests/fake_docker`: dry run, rehearse, restore, typed id, rollback) | T324, T325, T330, T430 · **F14**, F17 |
| FR-4209 | Rehearsable; checkable from the console | **OPEN** | planned: dry-run mode; completeness view | T366 rehearsal | T325, T366 |
| FR-4210 | `refresh-content` on noor; keeps progress or refuses; so does restoring a reviewed export | **OPEN** | planned: `stack` input; refusal on student data. **2026-09-28 (T430; status unchanged)**: the restore path keeps every student's progress or refuses naming what would be lost — any content row it would remove, and any question whose asked-or-accepted content it would change, that a row of any student table names (FK or JSON), refuses the whole restore with the row and the counts; the replay commits only if every student table is identical before and after it, inside its transaction | refresh rehearsal; `test_load_course_restore.py` (refusals for an attempted question, a session's plan, a cited misconception, a re-worded attempted question; student tables byte-identical after a restore) | T326, T430 · **F15** |
| FR-4211 | At launch, G10 is the only course live for grade 10 | **OPEN** | an operator's rules in production | T392 checklist | T392 |
| FR-4212 | Probing off for G10 at launch; teaching page says which courses it reaches | **OPEN** | planned: `CourseDef.probing` | probing test; teaching page | T322, T379 |

## 4. Content completeness — FR-4301…FR-4310

| FR | Requirement | Status | Implementation | Proof | Tasks · Privacy |
|---|---|---|---|---|---|
| FR-4301 | Every chapter and section present; one section, one lesson, with G0's splits, promotions and merges (65 lessons, 2026-09-25); no sub-topic without a question | **OPEN** | the G0-approved manifest (scouting code); B3 to reproduce it | G0 record (decisions.md); `coverage/g10-math.json` GREEN | T333, T345, T352 ✔, T362, T402, T403 |
| FR-4302 | Canonical solutions from the book: its printed worked examples and its **EPUB worked solutions** (`book_worked_epub`); blind re-solve must agree with the printed answer and the EPUB solution; disputes held; source recorded; Teacher's Guide only where it adds | **OPEN** | planned: S3 in `lesson.workflow.js` (COLLECT-2/-3: missing answers, and a blind answer given without the figure, are *unchecked*, never a book dispute; `recollect_lessons.py` re-collects a saved run with no model call); `solution_provenance`. **Decisions 43–45, written into the FR 2026-09-27**: `choices.answer_only` (`schemas.MarkerChoices`, `assemble_lesson_bundle.py`, `load_seed.py`; `lib/question-flags.ts` gives the tutor the answer-only instruction in place of the solution steps in the lesson bank, the Ask context and the probe note); Samuel's approved corrections to the book's working are G2 fixes in `services/extraction/runs/g10-math/g2.json` (Ex8-6:36b one line appended; Ex8-6:32d two lines; Ex8-6:45a), and nothing else in those workings changes; G2 attribution (2026-09-27): a fix someone else applied on top of the reviewer's verdict is stamped apart — `samuel_verdict` → `reviewer_verdict`, `stem_fix_by` (lesson runs and `apply_review_verdicts --g2`) | G2 dossier (`render_review_page.py --gate g2 --recommend`); coverage counts by source; `test_lesson_collect2.py`, `test_recollect_g2.py`; `test_g2_choices.py` (answer-only needs the key agreed by printed and blind; an answer-only fix leaves the book's solution alone); `answer-only-prompts.test.mts`, `question-flags.test.mts`. The G2 gate record in `decisions.md` (T354); `test_g2_verdicts.py` (a fix someone else applied keeps the reviewer's own verdict) | T336, T337, T361, T354 · **2026-09-27 (consistency review A6; status unchanged)**: an `answer_only` question (decision 43) — no working in the book — is honoured beyond the prompts: `/api/attempts` sends its card no steps and no library entry (`answerOnly: true`), the explanation log records the answer and the pointer, and `ChatQuestionCard.tsx` / `StudentLoop.tsx` show right/wrong, the answer and "look back at this lesson's worked examples". ⚠ This FR's text still says every book question has a step-by-step solution; carrying decision 43 into it is the review's item C (documents), not done here. Proof: `question-flags.test.mts` · **2026-09-27 (consistency review A7, data-engineer; status unchanged)**: the stems of Ex8-6:21c, 21d and 22a–22e carried two part lead-ins joined together ("Show that: Calculate: $PS$"); each keeps only its own (21: 'Show by calculation that:' for a–b; 22: 'Show that:' for a–b, 'Calculate:' for c–d), as orchestrator-applied G2 fixes (`stem` fields, `stem_fix_by`) in `runs/g10-math/g2.json`, flagged for Samuel at G3/G4 — `assemble_objectives.lesson_runs` validates all seven. ⚠ `lesson_runs`/`apply_review_verdicts --g2` stamp the file-level `by` (Samuel) on every item: until they honour an item's own `by`, these stems travel under his name in the run files and the DB stamp |
| FR-4303 | Maths-expression answers become typed questions marked by FR-4320; multiple choice only where natural; proofs and sketches stay worked examples; counted (amended 2026-09-26, decision 36: an end-of-chapter item ruled outside its chapter at G1 is kept out of practice and listed, named, in the coverage audit) | **OPEN** | planned: S3 answer typing (`lesson-v4`: a choice's options may be a figure's labels, checked as single labels); consistency review A1/A9 (2026-09-27): the answer text is the marker key rendered (`assemble_lesson_bundle.answer_text`), the book's form rules reach the marker (`apply_form_rules`, `books/g10-math.json` subject rule; S3 collect-5) | coverage counts; console completeness; `test_lesson_collect2.py`; `test_assemble_lesson_bundle.py` (ConsistencyReviewTest A1/A9); coverage `answer_text`, `asked_forms`; load refuses a mismatch (`load_seed.display_problems`) | T337, T345, T414 |
| FR-4304 | Generated families per ADR-0008, as declarative specs; 10% sample | **OPEN** | planned: `generate_questions.py --families`; `families/normalise.py` fixes the two mechanical `--check` refusals (a redundant top-level answer, a param named like a built-in) and records each in the spec's notes, never inside `--check` | pytest (`test_family_normalise.py`: same items number for number; every `families/g10-math` spec passes `--check`); G3 sample file | T343, T361 · **2026-09-27 (consistency review A12)**: `tpl:g10m8s1-1-3:quad-rotated-start` flagged for G3 in `runs/g10-math/g3-flags.json` — option C is a legitimate naming (S5 final stripped its tag; the book allows any starting vertex), 20 distractors untagged; recommendation: reject and re-author |
| FR-4305 | Tier floor per objective, or listed by name | **OPEN** | planned: S6 gap list; completeness view | coverage; console list | T343, T362, T375 |
| FR-4306 | Widget questions for every chapter; new kinds only with Samuel's OK | **OPEN** | planned: S7; widget-gap list. Every kind in `contracts/widget-predicates.json` — the six of decision 27 included — is registered in `generate_widget_questions.py` (instrument text from `widget-docs.ts` word for word, reachability ported from `parseMathWidget`/`curveReachable`, blind-reading rules; prompts `s7-v5`); decision 47: the blind verifier refuses a template only for an unreachable target, a stem that reads otherwise or no verdict — an unconfirmed mapping is held (`choices.pending_review`), inactive until a human keeps or drops it on the G3 held-mappings page (`render_review_page.py --gate g3-mappings`, `--mapping-review`) | gap list; T356 decision record; `test_widget_templates.py` (pipeline reachability = app reachability, kind by kind, via node; the DOCS text checked word for word; `HeldMappings`, `BlindVerdicts`); `test_render_review_page.py` (g3-mappings); `test_assemble_misconceptions.py` (a held-only widget reconciles) | T344, T355, T356, T357 · **2026-09-27 (consistency review W1 + A10, data-engineer; status unchanged)**: `contracts/widget-predicates.json` v2 carries each kind's `can_emit` table (per mode / ask / element / fn / shape / solid / target / clues, derived from the widgets' grading code, each kind naming its source), mirrored in `app/src/lib/widget-predicates.ts` (`WIDGET_CAN_EMIT`, `canEmit`) and checked by `widget-predicates.test.mts` (exact sync; only declared predicates; every listed predicate appears in the grading code; the two declared-but-never-emitted predicates named). `widget_spec.validate_widget` refuses an active or held mapping its question cannot emit; S7 `s7-v7`: every instrument is the app's DOCS text word for word (line_drawer's paraphrase had told the author a "points" question is graded on the line), the author's contract carries the table, the blind verifier gets the kind-level table (never the question's mode). A10: `opening_collisions` refuses a "points" target or its swap on LineDrawer's opening handle (read from the component by the test). Grade 10 dead mappings: 5 active (s3-1-2:w001 ×2, w004; s3-2-1:w001, w002) + 9 held, dropped by `--normalise-templates` (`drop-dead-predicate`, `drop-opening-instance`; `verified_as` carries the verifier's verdicts across a removal-only change, `carried_verification`; a template re-verified at its current sha is judged on those verdicts, not the stale carry — `NormalisedAfterVerification`); `wt:g10m8s3-1-2:gradient-to-missing-coord` has no mapping left and is held out for re-authoring; the false "graded on the line" step removed from `line-through-two-points`. Prep 3 (LIVE, 001 FR-1213): 14 dead mappings (geo2-2-2 w001–w009, geo1-1-1:w002, u4-1-2 w001/w002/w004/w006) corrected in the export and the legacy templates, not shipped. Proof: `test_widget_templates.py` (`WhatAQuestionCanEmit`, `OpeningHandles`, `NormalisedAfterVerification`, DOCS word for word for all 16 kinds), `test_packet_ref.py`, `test_family_widget_workflows.py`, `test_export_generated_content.py` (the corrected export round-trips byte for byte) |
| FR-4307 | Misconception catalogue for this book; every tag has a refutation; one error, one entry | **OPEN** | planned: S5 fail-closed | coverage equality (FR-1112) | T341, T342, T361 · **2026-09-27 (consistency review A5, data-engineer; status unchanged)**: nothing a student reads in the catalogue names a question id or book reference, a page number, a numbered figure, or review history (`assemble_misconceptions.leak_problems`, fail-closed in `validate_catalogue` for every catalogue — Prep 3's has none); 9 of the pilot's 29 entries patched as pipeline normalisations beside the S5 run (13 patches, who and why, `provenance.normalisations`), the catalogue re-validated (notation included) and reloaded into `ainext_pilot_g10_ch08` (29 entries, 0 leaks); S5 packets carry no G2 note and mark a corrected solution as not the book's own (`s5_args`); prompt `s5-v5` states the rule for the author and the verifier. Proof: `test_assemble_misconceptions.py` (`WhatAStudentReads`, `S5PromptRule`), `test_stage_figures.py` · **2026-09-27 (consistency review W1; status unchanged)**: every widget diagnostic in Grade 10's bank (bundle, and the export less retired) uses a predicate its widget's mode can emit (`contracts/widget-predicates.json` v2 `can_emit` / `canEmit`), so every tag's refutation can actually be served. Proof: `widget-can-emit-bank.test.mts` (passes; negative control included) |
| FR-4308 | App notation; vocabulary and contexts as printed; refutations cite this book only | **OPEN** | planned: assembly normalisation (`align*` written as `aligned` for inline KaTeX); consistency review A2/A4 (2026-09-27): S0b LaTeX re-spaced at assembly by the app's KaTeX (`katex_check.mjs`, accepted.json untouched), a comma pair only where provable (else listed for G2), figure point labels normalised | coverage normalisation counts; `test_lesson_collect2.py`; coverage `katex` = 0 and `notation`; load refuses a KaTeX error; `test_assemble_lesson_bundle.py` (A2/A4), `test_coverage_report.py` | T338 |
| FR-4309 | Completeness beside the switch, computed from the rows shown | **OPEN** | planned: `CourseCompleteness` | US1 scenario 1 | T308, T375 |
| FR-4310 | Provenance from one place; operators only | **OPEN** | planned: `lib/provenance.ts` extended | existing provenance tests extended | T308, T380 |

## 4a. Native figure types — FR-4321 **[ADDED rev. 4, decision 26]**

| FR | Requirement | Status | Implementation | Proof | Tasks · Privacy |
|---|---|---|---|---|---|
| FR-4321 | A figure no existing kind can draw gets a native renderer, on a figure-gap inventory for Samuel's OK first, never a static approximated image | **OPEN** | planned: extend S4's `viz-gaps.json` reporting to count occurrences and sizes per needed kind; consistency review A3/A8 (2026-09-27): a question showing [figure] with no figure is held at review (assembly, `load_seed.figure_gate`, `apply_review_verdicts --g2`); a figure drawing the unknown is withheld (`visual_gives_answer`); failed figures re-run alone (lesson.workflow.js `visuals_only`, `merge_visual_reruns.py`); coverage fails on pipeline-error gaps; lesson-v6: an exercise figure withholds its unknown by name (`withheld`) and draws the rest, Compare accepts exactly that omission; a worked example's figure may show its answer; every shown element is drawn or the figure is a gap naming the missing kind; the figure gate releases a held question when its figure arrives; lesson-v7: a caption describes only what is drawn — assembly drops a clause describing a withheld point as marked/shown (`fix_caption`), coverage `captions` fails on one | figure-gap inventory; approval record; `test_assemble_lesson_bundle.py` (A3/A8), `test_lesson_workflow.py` (VisualsRerun), `test_g2_verdicts.py`; coverage `figures`; `test_lesson_workflow.py` (withheld, worked example), `test_course_lessons.py` (figure gate hold and release); `test_assemble_lesson_bundle.py` + `test_coverage_report.py` (captions) | T429 |

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
| FR-4320 | Typed maths answers marked by equivalence, with form checks and decision-15 normalisation; unreadable or wrong shape → re-enter (decision 24's detail); numbers unchanged; choices unchanged except a less specific true option → re-enter (decision 41, in the FR since 2026-09-27) | **OPEN** *(Rev. 4: code built, re-grading is T387's)* | built: `lib/answer-marker.ts` (the engine, ADR-0025), `lib/attempt-grading.ts` (`markAnswer`, the route's dispatch), `lib/attempts-client.ts` (`submitAttempt`/`AttemptRetryError`, the one client seam), `MathAnswerInput.tsx` — wired into all three typed-answer surfaces: `ChatQuestionCard.tsx`, `StudentLoop.tsx` (`?mode=practice`) and `ChatCore.tsx` (a chat-typed answer during Socratic probing) | `answer-marker.test.mts`, `attempt-grading.test.mts`, `math-answer-input.test.mts`, `student-loop-marker.test.mts`, `chat-core-retry.test.mts` all pass; `npx tsc --noEmit` clean; full `npm test` green (1353 passed, 45 skipped without a database, 0 failed). Not re-verified here: SC-212's recorded-attempts DB replay (`scripts/marker-eval/replay-attempts.mts`). **Decisions 41/43 (G2, 2026-09-26): the re-entry rule extends to a less specific TRUE option** — an mcq's `choices.less_specific` (and a marker question's `choices.answer_only`), contract `contracts/pipeline-handoff.md`; pipeline side validated in `tests/test_g2_choices.py` (run item, assembly, `schemas.McqChoices`/`MarkerChoices`, loader shape). **App side, built 2026-09-26**: `lib/question-flags.ts` reads both shapes (`choiceOptions`, `lessSpecificKeys` — a key that is not an option or is the answer key is dropped with a server-log warning, never a crash — and `isAnswerOnly`); `markAnswer` returns a less specific pick as a `less_specific` re-entry (422, nothing recorded, no mastery effect, "That's true — but there's a more precise name for it. Try again."); `submitAttempt` raises it as `AttemptRetryError`; the message shows on the lettered options in `ChatQuestionCard.tsx` and `StudentLoop.tsx` (`ReentryNote.tsx`) and as a local note in `ChatCore.tsx`; `mcqChoices` and the route's distractor diagnosis read `{options}`. `answer_only`: the lesson question bank, the Ask context's question in scope and the Socratic probe's live-event note carry `ANSWER_ONLY_INSTRUCTION` instead of the working (grounded teaching — constitution Principle II, 001 FR-C01). Proof: `question-flags.test.mts`, `answer-only-prompts.test.mts` (real builders over the fake pool, both contract shapes); National and G10 prompt goldens unchanged | T413–T417 |

## 5. The extraction pipeline — FR-4401…FR-4409

| FR | Requirement | Status | Implementation | Proof | Tasks · Privacy |
|---|---|---|---|---|---|
| FR-4401 | One run produces every content kind, each stage gated | **OPEN** | planned: B4–B13 | Chapter 8 pilot through S11 | T334–T344, T353 |
| FR-4402 | A chapter-and-section English book, no hand skeleton; structure approved first | **OPEN** | planned: B2, B3; gate G0 | manifest and G0 record | T332, T333, T352 |
| FR-4403 | Per-stage report of produced, rejected and cost | **OPEN** | planned: B14, B16 | `runs/g10-math/cost.jsonl` | T345, T347 |
| FR-4404 | Re-run adds nothing; other courses untouched | **OPEN** | planned: B9, B15 | double run on scratch (SC-210) | T339, T346 |
| FR-4405 | Arabic self-check 100%, Arabic audit green, sacred gate unchanged, old bundles unchanged | **OPEN** | planned: B7 byte-identical dumps | `selfcheck_arabic.py`, `audit_arabic.py` | T336 |
| FR-4406 | Documented well enough to ingest the next book from the doc alone | **OPEN** | `docs/specs/extraction-pipeline.md` v2 and `runbook/README.md`, **brought up to date 2026-09-25** (T350 ✔) | SC-210 fresh-engineer run — not yet done | T350 ✔ |
| FR-4407 | Maths images turned into checked text: two independent passes, hash or agreement, a third reading where they disagree (decision 32), PDF cross-check, queue for a human, never guessed | **OPEN** | `transcribe-maths.workflow.js` (passes A, B and C), `assemble_maths.py` (B21; an aligned derivation's hash form proven, stored with a real `&`; the third reading accepts only two of three; an image used only in an EPUB solution, class `solution_only`, follows the same rule and is reported per class in `routes_by_class`) | `test_assemble_maths.py` (incl. the three third-reading tests), `test_lesson_collect2.py`; S0b counts (SC-213). **Chapter 8 pilot, 2026-09-26**: 853/853 accepted — 558 hash, 282 agreement, 13 third reading, 0 queued (`runs/g10-math/maths/summary.json`) | T418–T421, T433 |
| FR-4408 | Teacher-only material dropped before claims; never student-facing | **OPEN** | planned: `teacher_only` block (B2), dropped at S2 (B6) | coverage equality: 0 teacher blocks reaching a claim | T332, T337 |
| FR-4409 | One source for the maths misconception catalogue; six entries live; no live id renamed; export keeps kind and aliases; tests + CI proof | **BUILT** *(was OPEN; verified 2026-09-25 — T342, T422)* | B19: `seed/generated/misconceptions.json` is the single source; `build_misconceptions.py` retired; `seed/misconceptions-math.json` deleted (confirmed by `git status`); the six `t2u3-1-2` entries are in, each with a refutation; `export_generated_content.py` keeps `kind` and `aliases` on round trip | `services/extraction/tests/test_misconception_catalogue.py` (asserts the live id set is a superset, the six entries are present, aliases unchanged); `test_export_generated_content.py`'s round-trip tests. **Not yet VERIFIED**: T423's CI proof (loading the catalogue twice into a scratch database in CI) has not run, and T424's local rehearsal against the Prep-3 bank has not run — this is what would close it | T342, T422, T423, T424 |
| FR-4410 | A stage finds this book's prerequisite links in the book, evidence-backed; a second AI checks each; approved at G1 with the objectives | **OPEN** | `objectives.workflow.js` (S1's linker and independent link checker, `links: true` by default) and `assemble_objectives.py` (links kept only with evidence at their anchor and the checker's agreement; a backward link or a dead linker is a decision G1 owes; kept links written as `prerequisites` and assembled as `prerequisite_of` edges; the G1 page lists every link, kept or dropped) | `test_objectives.py` (links evidenced, checked and never between parts; a link whose quote is not at its anchor or that G1 drops is not kept; backward links and a dead linker go to G1). G1 record, Chapter 8 (T354/T359): 1 link (distance → points on a line) confirmed by the checker and kept | T428 |

## 6. Success criteria — SC-201…SC-213

| SC | Criterion | Status | Implementation | Proof | Tasks |
|---|---|---|---|---|---|
| SC-201 | 100% of chapters and sections, in order; zero sub-topics without a question | **OPEN** | the coverage audit | `coverage/g10-math.json` | T362 |
| SC-202 | Zero served book questions without a solution or with a disagreeing re-solve | **OPEN** | S3 and G2 | coverage and G2 record | T361 |
| SC-203 | Tier floor met, or named | **OPEN** | S6 and completeness | console list empty | T362 |
| SC-204 | Every chapter has a widget question; 100% of tags resolve to explained misconceptions | **OPEN** | S5–S7 | coverage equalities | T362 |
| SC-205 | Grade-10 sign-up to first tutor message under 5 minutes, at most one added question | **OPEN** | US3 | stopwatch walk | T393 |
| SC-206 | Zero cross-curriculum items on any surface, gate on and off | **OPEN** | the scope | SC-206 pass | T373 |
| SC-207 | National prompts byte-identical; no visible difference for existing students — except FR-4206's three expected differences (incl. the Arabic lessons' printed names, decision 34, added 2026-09-27) | **OPEN** | A7 | capture compare (the full 438-file capture over a real database is not yet re-run — integration backlog 58); `national-prompts.test.mts` | T323, T432 |
| SC-208 | The load changes zero other rows; a second run changes zero; rollback exact | **OPEN** | A8 | rehearsal on a scratch copy | T330 |
| SC-209 | Change and change back restores 100% of progress; both changes in history | **OPEN** | A5, A6 | scratch-database proof | T383 |
| SC-210 | A second pipeline run adds zero; a fresh engineer succeeds from the doc alone | **OPEN** | A9 | double run; fresh run | T350, T353 |
| SC-211 | No student moved past a split section with a part not passed; roll-ups agree with parts | **OPEN** | A12 | progression tests; US6 walk | T406, T412 |
| SC-212 | Marker: 100% of printed answers and equivalents correct, 0 wrong-form correct, existing attempts identical on replay | **OPEN** | A13 | `answer-marker.test.mts`; attempts replay | T415, T416 |
| SC-213 | 100% of unique maths images accepted by fingerprint, agreement or a third reading, or queued for a human; 0 guessed | **OPEN** | B21 | S0b report; Chapter 8: 853/853, 0 guessed, 0 queued (the rest of the book, ≈ 5,160 images, not yet read) | T419, T421, T433 |

## 7. What is unresolved, and who owns it

Rev. 1's items 1–3 are **closed**. They are struck through below rather than deleted, so the record
shows how each was closed.

| # | Item | Owner | Why it matters |
|---|---|---|---|
| 1 | ~~decisions.md A–E adopted under "all recommendations"~~ **Confirmed 2026-09-25** ("ok for all", T301) | Samuel | A: the kill switch keeps curriculum scoping (FR-4015) |
| 2 | ~~Privacy review F5~~ **Option (b) confirmed 2026-09-25**: anonymous analytics stay unconfigured until the cohort is larger | Samuel | Configuring the measurement id reopens it |
| 3 | ~~The Ask book-list line~~ **Acknowledged 2026-09-25** | Samuel | FR-4206's one expected difference |
| 4 | ADR-0024 and the notes on ADR-0005, 0018, 0019 and 0020 are accepted ("ok for all"). They sit on the feature branch only as unreviewed WIP snapshots, not reviewed or merged | **Samuel** (T388) | The reviewed commit and the merge are his |
| 5 | ~~The constitution amendment proposal~~ **Approved and applied 2026-09-25** (third round, answer 7: *"Yes, update it (Recommended)"*; decisions.md decision 28). `.specify/memory/constitution.md` is v3.4.0. T389 is still unticked (a human-gate checkbox no agent marks), but the substance is done | **Samuel**, explicitly | Done |
| 6 | ~~The expression marker's library or approach~~ **Decided 2026-09-25**: build in-house, no library (third round, answer 2; [ADR-0025](../../docs/decisions/0025-answer-marker-build-in-house.md); T413 gate record) | **Samuel** | Done |
| 7 | **G0b and G2 human time**: S0b's queue, and the three-way disagreements across 2,531 items | **Samuel** | The critical path of the ingest run. The Chapter 8 pilot sized it (2026-09-26): G0b not needed (0 queued after the third reading); G2 took 71 recommended items, 11 of them "your call", for 201 book items |
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
| Requirements a test declares | **51** |
| Tasks complete / total | **85 / 128** |

**Of 0 requirements marked VERIFIED, 0 have an automated test declaring them.** The remaining 0 were verified by running the product — a browser session, a query against a loaded database — which is real evidence and is not re-checked on any later commit. That gap is the honest measure of this build's regression risk, and it is the number to drive down.

Counted from the artifacts by `scripts/traceability.py`, which fails CI when the spec, the matrix and the tests disagree. The hand-maintained table this replaced had drifted five requirements out of date, and an entire deferred block had no row at all.

The frozen baseline (`specs/000-baseline/`) defines 31 more requirements. It shipped and is not under change (ADR-0007), so it is reported by the tool but never gated — it has no matrix of its own yet.
