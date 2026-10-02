---
description: "Task list for 003 — Curriculum Tracks and the Grade 10 American Mathematics Course"
---

# Tasks: Curriculum Tracks and the Grade 10 American Mathematics Course

**Input**: [spec.md](./spec.md) (rev. 4, with its 2026-09-26/27 and 2026-10-01 amendments) · [plan.md](./plan.md) ·
[data-model.md](./data-model.md) · [contracts/](./contracts/) · [research.md](./research.md) ·
[privacy-review.md](./privacy-review.md) · [decisions.md](./decisions.md) (decisions 1–61) ·
`docs/specs/extraction-pipeline.md` §9 (B1–B21)
**Status**: 2026-10-01. Rev. 2 (2026-09-25, after Samuel's *"ok for all"*) added the phases up to
8c; Phase 9b (T427–T433) came with the third round of decisions; Phase 9c (T434) adds answer 36's
reversal of decision 1 (sign-up always asks), now **built and ticked**; Phase 9d (T435–T443) adds
answer 35's no-Arabic-anywhere clean-up (T435, **built and ticked**) and answer 37's internal review
backlog and full fan-out (T436–T443, **built and ticked 2026-10-01**); Phase 9e (T444–T448) records the
whole-book outline and the step checker (built, ticked) and a teaching item as a family's parent (T448, **not built**).
G0 is passed; for the Chapter 8 pilot,
G1 and G2 are passed (decisions.md, *Gate record*). Code is on the branch, which since 2026-10-02 is `origin/main` at
v0.11.0 plus one squashed commit (tagged `g10-progress-map`, pushed; the old history of snapshot commits is under the tag
`g10-old-graph-view`; decision 67) — nothing is reviewed by Samuel or merged to `main`. A task is ticked only
when its evidence exists. Where code exists but nobody has verified it, the task says so and stays
unticked.
**Tests**: this feature asks for them. The spec names guard tests, and the constitution's gates
require byte-identity captures and migration proofs. Every test file declares what it proves with
`// @covers FR-…` (or `# @covers` in Python), so `scripts/traceability.py` can see it.

**Numbering**: tasks are **T301–T448** (planned as T301–T399; T400–T433 were added with rev. 2's and the
third round's work; T434 with answer 36 on 2026-10-01; T435–T443 with answers 35 and 37 the same day; T444–T448 with answers 38, 30 and 40 on 2026-10-01, later).
Spec 001 uses T001–T143, and `scripts/traceability.py` reads
task ids from every spec's `tasks.md` into one set, so 003 starts at T301 to keep each id unique
across the repository. That matters when an id is cited in an issue or a commit.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, and no dependency on an incomplete task)
- **[USn]**: the user story it serves (spec.md)
- **(WP-x)**: the work package that owns the files. One agent works one package at a time, and **two
  packages never edit the same file** (table below).
- ⛔ **HUMAN GATE**: needs Samuel, or a founder with the runbook. No agent may mark it done.

## Work packages and file ownership

The packages are disjoint by file. When a task needs a file another package owns, it waits on that
package's task (named in *Dependencies*) and does not edit the file itself.

| WP | Agent | Owns (and only these) |
|---|---|---|
| **WP-A** Registry & gate | backend-engineer | `app/src/lib/{curricula.ts,courses.ts,subjects.ts,catalog.ts,catalog-queries.ts,module-order.ts,module-term.ts,env.ts,book-sections.ts}`, `app/src/lib/book-sections.test.mts`, `scripts/course-gating.sh`, and their tests: `catalog.test.mts`, `catalog-gate.test.mts`, `curricula-registry.test.mts`, `student-scope-guard.test.mts`, `course-literal-guard.test.mts`, `catalogue-order-guard.test.mts` |
| **WP-B** Migrations 033–034 | backend-engineer (data) | `db/migrations/033-curriculum-tracks.sql`, `db/migrations/rollback/033-curriculum-tracks.down.sql`, `db/migrations/034-book-sections.sql` and its rollback, the comments in `db/migrations/027-*.sql` and `028-*.sql`, `app/src/lib/curriculum-privilege.test.mts`, `scripts/ci-migrations.sh` (only if the proof needs a new case) |
| **WP-C** Student readers | backend-engineer | `app/src/lib/{ask.ts,dashboard.ts,queries.ts,visuals.ts,spine-lo-query.ts,subject-queries.ts,student-landing.ts,progression.ts,progression-db.ts}`, `app/src/app/api/{dashboard,visuals}/route.ts`, `app/src/app/(student)/student/page.tsx`, `app/src/app/layout.tsx` |
| **WP-D** Sign-up & Google step | frontend-engineer + backend-engineer | `app/src/app/(auth)/signup/page.student.tsx`, `app/src/app/(auth)/welcome/page.student.tsx` (new), `app/src/components/auth/{SignupForm.tsx,OnboardingForm.tsx}`, `app/src/app/api/auth/{signup,onboarding,google/callback,me}/route.ts`, `app/src/lib/auth/{google.ts,principal.ts}`, `app/src/lib/student-context.ts`, `app/src/lib/ga-curriculum-guard.test.mts` (new), `app/src/lib/onboarding.test.mts` (new) |
| **WP-E** Teaching facts & G10 prompts | ai-engineer | `app/src/lib/{lesson.ts,socratic-probing.ts}`, `app/scripts/capture-prompts.mts`, the prompt golden and capture files, `app/src/lib/probing-prompts.golden.json` |
| **WP-F** Student components | frontend-engineer | `app/src/components/spine/SpineExplorer.tsx`, `app/src/components/student/{SubjectHome.tsx,LessonCheckIn.tsx,LessonSession.tsx}`, `app/src/components/chat/{ChatQuestionCard.tsx,MathAnswerInput.tsx}`, `app/src/lib/spine-layout.ts` |
| **WP-M** Expression marker **(new, rev. 2)** | backend-engineer | `app/src/lib/answer-marker.ts` (new), `app/src/lib/answer-marker.test.mts` (new), `app/src/app/api/attempts/route.ts`, and the marker library's entry in `app/package.json` and `package-lock.json` (after T413; coordinate with any other dependency change) |
| **WP-G** Console | frontend-engineer + backend-engineer (console) | `app/src/components/console/{CourseAvailabilityGrid.tsx,CourseAccessEditor.tsx,CurriculumEditor.tsx}`, `app/src/app/(console)/{courses,students,overview,content,cost,feedback,teaching,pipeline,gallery}/**`, `app/src/app/(console)/layout.console.tsx`, `app/src/app/api/console/{courses,students/[id]/courses,students/[id]/curriculum}/route.console.ts`, `app/src/lib/{console-queries.ts,overview-queries.ts,content-admin.ts,pipeline-queries.ts,console-routes.ts}`, `app/src/lib/auth/{authorize.ts,matrix.test.mts}`, `app/src/lib/course-count-guard.test.mts` (new) |
| **WP-H** Deploy & load | devops-engineer | `.github/workflows/{load-course.yml,refresh-content.yml,ci-cd.yml}`, `deploy/{load-course.sh,refresh-content.sh,Dockerfile,DEPLOY-MVP1.md}`, `scripts/local-dev.sh` |
| **WP-P1** Source & manifest | data-engineer | `services/extraction/{book_config.py,source_adapter.py,build_manifest.py}`, `services/extraction/books/` |
| **WP-P2** Objectives stage | ai-engineer | `services/extraction/runbook/objectives.workflow.js`, `services/extraction/assemble_objectives.py` |
| **WP-P3** Lesson line & schemas | ai-engineer + data-engineer | `services/extraction/runbook/lesson.workflow.js`, `services/extraction/schemas.py` |
| **WP-P4** Assembly, loader, drift guard | data-engineer | `services/extraction/{assemble_lesson_bundle.py,load_seed.py,parity_check.py}` |
| **WP-P5** Misconceptions | ai-engineer | `services/extraction/runbook/{misconceptions,refutation}.workflow.js`, `services/extraction/{assemble_misconceptions.py,assemble_refutations.py,build_misconceptions.py}`, `services/extraction/seed/generated/misconceptions.json`, `services/extraction/seed/misconceptions-math.json` (to delete), `services/extraction/tests/test_misconception_catalogue.py` (new) |
| **WP-P8** Maths transcription (S0b) **(new, rev. 2)** | ai-engineer + data-engineer | `services/extraction/runbook/transcribe-maths.workflow.js` (new), `services/extraction/assemble_maths.py` (new), `services/extraction/tests/test_assemble_maths.py` (new) |
| **WP-P6** Families & widgets | ai-engineer | `services/extraction/{generate_questions.py,generate_widget_questions.py,variant_engine.py}`, `services/extraction/families/`, `services/extraction/runbook/{families,widgets}.workflow.js` |
| **WP-P7** Coverage, exports, meter, review | data-engineer | `services/extraction/{coverage_report.py,export_generated_content.py,load_generated_questions.py,load_misconceptions.py,meter_run.py,render_review_page.py,merge_final.py,assemble_fullbook.py}` |
| **WP-PDOC** Pipeline docs | pipeline auditor; **tech-writer from 2026-09-25** | `docs/specs/extraction-pipeline.md`, `services/extraction/runbook/README.md`, `services/extraction/VIZ_SPEC.md` |
| **WP-I** The ingest run | ai-engineer + data-engineer, gated by Samuel | `services/extraction/{manifest/g10-math-american.json,objectives/g10-math/,runs/g10-math/,seed/g10-math/,seed/generated/g10-math/,coverage/}` |
| **WP-W** New widget kinds (only if approved) | frontend-engineer | `app/src/components/student/widgets/<NewKind>.tsx`, `contracts/widget-predicates.json`, the widget validator and renderer registration files |
| **WP-Q** Verification | qa-engineer | `scripts/curriculum-smoke.sh` (new); no product files |
| **WP-DOC** Docs & governance | tech-writer | `specs/003-curriculum-tracks/**`, `docs/decisions/0024-*`, notes on 0005/0018/0019/0020, `docs/PROJECT_STATE.md`, `docs/README.md`, `CHANGELOG.md`, `docs/releases/`, stamps in `specs/00{1,2}-*/spec.md` and `traceability.md`, and `.specify/memory/constitution.md` **only after Samuel approves** |

---

## Phase 1: Setup

- [x] T301 ⛔ HUMAN GATE — Samuel confirms decisions.md **A–E** and picks privacy review F5 (a) or (b); record the answers in `specs/003-curriculum-tracks/decisions.md` (WP-DOC). FR-4015's build waits on A. **Done 2026-09-25**: *"ok for all"* — A–E confirmed, F5 (b); see the gate record.
- [ ] T302 [P] Run the read-only production checks in research.md Appendix A: `gh variable get AINEXT_COURSE_GATING`, today's `course_availability` rows for grade 10, every student's `curriculum_system` and grade, and the loaded courses and books. Record the results in this feature's section of `docs/PROJECT_STATE.md` (the v0.12.0 section once the release is made; the label was "v0.10" until 2026-10-02, when `main` took that number) (WP-Q runs them, WP-DOC records them).
- [x] T303 [P] Pin the Grade 10 ids from `contracts/pipeline-handoff.md` in the G10 book config under `services/extraction/books/` and in `services/extraction/manifest/g10-math-american.json` (replacing its `course_id` placeholder): `course:us-g10-math-en`, `us-american-en`, `math`, `"10"`, `["g10m"]`, `objectives_mode: "derived"`, notation `point`/`comma` (WP-P1). **Verified 2026-09-27**: `services/extraction/books/g10-math.json` carries `course_id: "course:us-g10-math-en"`, `curriculum: "us-american-en"`, `subject: "math"`, `grade: "10"`, `id_prefixes: ["g10m"]`, `objectives_mode: "derived"`, `notation: {decimal: "point", pair_separator: "comma"}`; the manifest carries the same `course_id`, `curriculum` and `objectives_mode` (no placeholder left).

---

## Phase 2: Foundational (blocks every story)

**⚠️ No story work starts until T304–T313 are done.** These tasks create the registries, the gate
and the migration every reader depends on.

- [x] T304 (WP-A) Create `app/src/lib/curricula.ts` per data-model §1: the `CurriculumId` union, labels, `labelAr`, `gradeLabels`, `programNodeId` and order; `DEFAULT_CURRICULUM`; `isKnownCurriculum`. **Verified 2026-09-27**: `curricula.ts` exports `CURRICULA` (label, `labelAr`, description, `gradeLabels`, `programNodeId`; the key order is the listing order), `CurriculumId`, `CURRICULUM_IDS`, `DEFAULT_CURRICULUM = "eg-national-en"`, `asCurriculumId`, `isKnownCurriculum`, `curriculumLabel`, `curriculumGradeLabel`; `curricula-registry.test.mts` (12 tests) passes.
- [ ] T305 (WP-A) Create `app/src/lib/courses.ts` with all four `CourseDef`s. Prep-3 facts are copied **verbatim** from `lib/lesson.ts`, `lib/module-order.ts` and `lib/socratic-probing.ts`; the G10 entry follows data-model §1. Derive `SubjectDef.courseId` from it as a **deprecated alias**, so the ~19 importers still compile until their own packages move them (T397 removes it). **Verified 2026-09-25, not ticked**: `courses.ts` exists with all four `CourseDef`s and the Prep-3 facts genuinely look copied verbatim (matching lesson titles, "Egyptian ministry textbook", the fallback figure id). But `subjects.ts` has no `SubjectDef.courseId` alias at all — it was removed outright, not deprecated — so the code is already at T397's end state without T305's transitional step ever existing. No importer is broken by this (none was found still reading `.courseId`), but the task as written is not what shipped; note it rather than tick it, and consider whether T397 should simply absorb this task.
- [x] T306 (WP-A) Rewrite `isCourseVisible` in `app/src/lib/catalog.ts` as the five-step rule, and add `offeredCurricula` and `resolveInitialCurriculum`, both pure. Add `resolveOnGradeChange` for FR-4008: a chosen curriculum is kept and flagged, an implied one is re-resolved. Add `gradeLabel(grade, curriculum)` for FR-4013. Correct the stale "no requirement" header. Contract: `contracts/registry-and-gate.md`.
- [x] T307 (WP-A) Add `resolveStudentScope` in `app/src/lib/catalog-queries.ts`, with one read and one graph walk. `visibleCoursesFor` and `visibleGraphFor` become wrappers. The gate-off branch keeps curriculum scoping (FR-4015). Add `courseForSubject`.
- [ ] T308 (WP-A) Add the console read models in `app/src/lib/catalog-queries.ts`: `courseCatalog` as curriculum sections with `CourseCompleteness` and `offered`; `studentAccess` with reasons, including "exception — outside her curriculum"; `lastLiveCourseHeadcount` (count only). Contract: `contracts/console.md`. The headcount reads through the `CROSS_STUDENT_READS` entry T374 adds (WP-G owns `authorize.ts`); until then its test uses the entry's name. **Verified 2026-09-25, not ticked**: `studentAccess` with reasons (including the out-of-curriculum exception label) is real. But `courseCatalog` is a flat `CourseCatalogRow[]`, not curriculum sections; `CourseCompleteness` does not exist anywhere in `app/src` (`traceability.md` still marks FR-4309 OPEN, consistent with this); there is no `offered` field on the catalog output (FR-4102 is what T375 seems to have covered a different way — check before assuming FR-4102 needs T308's version); and `lastLiveCourseHeadcount` is real, tested and wired through `CROSS_STUDENT_READS`, but lives in `lib/console-queries.ts`, not `catalog-queries.ts`. T375's console page may already read what it needs some other way — worth checking against `contracts/console.md` before rebuilding this.
- [x] T309 (WP-A) Add `COURSE_RANK` in `app/src/lib/module-order.ts`, keeping the `SUBJECT_RANK` alias. Generate `TERM_RANK` from `CourseDef.terms`, byte-identical SQL for Prep-3. `app/src/lib/module-term.ts` functions take the course, and a course without terms gets no term label.
- [x] T310 [P] (WP-A) Tests with `@covers`:
  - extend `catalog.test.mts`: every branch of the five steps, gate on and off, both new pure functions and `resolveOnGradeChange`;
  - extend `catalog-gate.test.mts`: a National and an American student each see only their own course, gate on **and** off; a tester's cross-curriculum override; **the tester's two maths courses never interleave** (privacy review F19);
  - new `curricula-registry.test.mts`: bundles and book configs checked against `COURSES`, and slug-prefix uniqueness.
- [x] T311 [P] (WP-A) Update `app/src/lib/env.ts`'s gating comment and `scripts/course-gating.sh status` to state the new meaning: off suspends rules, not curriculum scoping (FR-4015).
- [x] T312 [P] (WP-B) Write `db/migrations/033-curriculum-tracks.sql` and its rollback per data-model §2 and §4:
  - `curriculum_source` and `onboarding_pending`;
  - `student_curriculum_changes` (append-only, forced RLS);
  - `complete_student_onboarding()` (`SECURITY DEFINER`, pinned `search_path`, once-only, raises on a second call);
  - `REVOKE UPDATE ON students FROM ainext_app` then `GRANT UPDATE (design_variant)`;
  - `GRANT UPDATE (curriculum_system, curriculum_source)` to `ainext_operator`;
  - a `DO $verify$` block for every privilege.

  Before choosing the column list, search every `UPDATE students` in `app/src`.
- [x] T313 (WP-B) Add `app/src/lib/curriculum-privilege.test.mts` (`@covers FR-4017`). It fails if a non-console `UPDATE students SET <col>` names a column outside 033's `ainext_app` list, or if 033 stops revoking. Then run `./scripts/ci-migrations.sh all` (fresh ×3, upgrade from v0.9.2, rollback onto v0.9.2) and record the result.

**Checkpoint**: `tsc --noEmit`, `npm test` and the migrations proof are green, and the Prep-3 capture set is still byte-identical (nothing in the prompts has moved yet).

---

## Phase 3: User Story 1, part A — the course in the app, and a load that cannot leak (Priority: P1) 🎯 MVP

**Goal**: the app can hold the G10 course without naming it to anyone who cannot see it, and
production has a safe way to receive it.
**Independent test**: load a **fixture** second course into a scratch database. Confirm no National
student's Ask context, home page, progress page or figure fetch names it. Run the load action's dry
run, real run, second run and rollback against it.

### The four readers the privacy review makes preconditions of any load (MUST, §5)

- [x] T314 [P] [US1] (WP-C) Gate the Ask context's source-book list through `scope.doc` in `app/src/lib/ask.ts`, and take the syllabus line from the course (privacy review §5.1, FR-4202, FR-4006). Check the capture set: for a student who sees every loaded National course the line is byte-identical; for one who sees fewer, hidden books stop being named. That is the intended fix and is recorded in the T323 capture notes.
- [x] T315 [P] [US1] (WP-C) Gate `/dashboard` through the scope, with `COURSE_RANK`, in `app/src/lib/dashboard.ts` and `app/src/app/api/dashboard/route.ts` (privacy review §5.2).
- [x] T316 [P] [US1] (WP-C) Scope the home page's counts and book, and the skill map's book, to visible courses with a deterministic pick, in `app/src/lib/queries.ts` (`getHomeStats`, and the `source_documents LIMIT 1` at `:87` and `:181`) (privacy review §5.3).
- [x] T317 [P] [US1] (WP-C) Gate figures by their objective in `app/src/app/api/visuals/route.ts` and `app/src/lib/visuals.ts`. Put `/gallery` in `COURSE_RANK` order in the same file (privacy review §5.4).
- [x] T318 [US1] (WP-A) Add `student-scope-guard.test.mts` (`@covers FR-4006, FR-4202`). The allow-list carries a reason per entry, and **none of T314–T317's readers may appear on it**. Depends on T314–T317.
- [x] T319 [US1] (WP-H) Add the image label `org.ainext.features="curriculum-scope"` in `deploy/Dockerfile`, in the same release as T314–T318. `load-course.sh` checks it on the running container with `docker inspect` (`contracts/load-course.md` step 2).

### Per-course teaching facts and the G10 prompts (ADR-0020 note)

- [x] T320 [US1] (WP-E) In `app/src/lib/lesson.ts`, read `bookName`, `syllabusLine`, `fallbackVizId`, `lessonTitles` and `isGeoLesson` from `CourseDef`. Prep-3 keeps "Egyptian ministry textbook" and its fallback figure exactly. Depends on T305.
- [x] T321 [US1] (WP-E) Set the G10 prompt facts: "this book" and its pages, the course's own syllabus line, and a review widget moment offering only the lesson's own unit's widgets (FR-1209). Add G10 fixtures to `app/scripts/capture-prompts.mts` (FR-4205). The only edit to `app/src/lib/courses.ts` is the G10 entry's values, made after T305 lands and coordinated with WP-A.
- [x] T322 [P] [US1] (WP-E) In `app/src/lib/socratic-probing.ts`, replace `PROBING_COURSE_ID` with `CourseDef.probing`: Prep-3 on, G10 off. Add a test with `@covers FR-4212`.
- [x] T323 [US1] (WP-E) Byte-identity proof: capture every existing prompt path before and after, and confirm they are identical. Record the one expected difference (T314's hidden-book line, only for a student who sees fewer than all loaded courses). Commit the G10 goldens as new files (`@covers FR-4205, FR-4206`, SC-207).

### The production load path (decision 17)

- [x] T324 [P] [US1] (WP-H) Create `.github/workflows/load-course.yml` per `contracts/load-course.md`: `workflow_dispatch` only, `deploy-oci` concurrency, noor's stack, inputs passed as environment variables, and input checks before the box is touched.
- [x] T325 [US1] (WP-H) Create `deploy/load-course.sh` per the contract:
  - presence checked by **the course's own id**;
  - preconditions: the bundles exist, no visibility row, and the image label;
  - a `pg_dump` backup **verified with `pg_restore --list`**, and the rollback line printed;
  - the loader steps;
  - post-flight: `parity_check.py` for every course, and **0** visibility rows;
  - the exit codes. (FR-4208, privacy review F14, F17)
- [x] T326 [P] [US1] (WP-H) Retarget `.github/workflows/refresh-content.yml` and `deploy/refresh-content.sh` to noor with a `stack` input defaulting to `mvp1`. `course` mode uses the loader's `--update`, or `--replace`, which **refuses the whole load, saying what would be lost**, when student data, the catalogue, generated questions or another course still reference it. No option deletes student data (FR-4210, privacy review F15, B9).
- [x] T327 [P] [US1] (WP-H) In `.github/workflows/ci-cd.yml`:
  - gate first boot on **the three National course ids**, not `≥ 3`;
  - gate the generated-maths step on Prep-3's own rows, not `GEN ≥ 590`;
  - sync each book's misconception catalogue only when that book's course is present.
- [x] T328 [P] [US1] (WP-H) In `scripts/local-dev.sh`, load each course if absent, never touching a present one. The G10 course loads only when its bundles exist and the scoped readers are in the source (T318 green).
- [x] T329 [US1] (WP-H) Add a "Loading a course" section to `deploy/DEPLOY-MVP1.md`: dry run, real run, reading the post-flight, rollback, then setting the rule, written for a founder at midnight.
- [ ] T330 [US1] (WP-Q) Rehearse `deploy/load-course.sh` against a scratch copy with a **fixture** course: dry run, load, a second run that changes nothing, then restore from the printed line. Diff every other course's rows and every student's rows, which must show zero changes (SC-208).

**Checkpoint**: loading a second course into a shared database names it to nobody who cannot see it, and production has a manual, verified, add-only path.

---

## Phase 4: User Story 2 — the next book goes through one documented line (Priority: P2)

**Goal**: build list B1–B20 (`docs/specs/extraction-pipeline.md` §9). **Runs in parallel with
phases 2–3**, because the files are disjoint; it depends only on T303.
**Independent test**: from the document alone, run the line on Chapter 8 into a **private scratch
database**; run it twice; confirm no duplicates and every other course untouched; the Arabic
self-check is 100% and the Arabic audit green.

- [x] T331 [P] [US2] (WP-P1) **B1**: `services/extraction/book_config.py` reads `books/<book>.json`, and workflows take everything from `args`. *(Code on the branch 2026-09-25 — `book_config.py` and the three National configs, with tests in `services/extraction/tests/test_book_config.py`. Not verified and not ticked; the G10 config is T303.)*
- [x] T332 [US2] (WP-P1) **B2** *(revised 2026-09-25, decision 21)*: `services/extraction/source_adapter.py` parses the EPUB into typed blocks: headings, prose, worked examples with their steps, exercise items with their EPUB worked solutions, figures, and **maths as image references** (the EPUB has no MathML, LaTeX or alt text). A new `teacher_only` block type holds the teacher's-guide notes, which S2 drops (FR-4408). It builds the PDF page map from the text layer, aligns EPUB blocks on section codes, media codes, worked-example numbers and exercise labels, identifies each item by (exercise label, question number, sub-part index), and crops figures per PDF Form XObject or takes the EPUB PNG. **Edition check**: build markers plus set equality of the 172 section codes and 78 media codes — not the version string (the EPUB has none) and not every item shortcode (EPUB-less). The PDF-only fallback hinges on content agreement, not on how the maths is encoded. The maths text itself comes from S0b (T418–T421).
- [x] T333 [US2] (WP-P1) **B3**: `services/extraction/build_manifest.py` — the manifest, a lesson-split proposal (one numbered section per lesson, decisions.md B), the per-lesson inventory and the manifest review page. It must reproduce the scouting manifest G0 approved, apply G0's decisions (T402) and write each lesson's book provenance (FR-4311).
- [x] T334 [P] [US2] (WP-P2) **B4**: `services/extraction/runbook/objectives.workflow.js` — two blind finders, a reconciler and a Haiku evidence check (ADR-0005 amendment #12). *Pipeline policy, not an FR.*
- [x] T335 [US2] (WP-P2) **B5**: `services/extraction/assemble_objectives.py` and the objectives review page. It checks deterministically that every objective has **at least two kinds of evidence**, at least one of them a worked example or an exercise, and that every exercise item maps to exactly one objective.
- [x] T336 [P] [US2] (WP-P3) **B7**: `services/extraction/schemas.py` — generalise `ClaimStep`, add `Question.solution_provenance` (`book_worked`, **`book_worked_epub`** — an EPUB worked solution not printed in the PDF, decision 19 — `teachers_guide`, and `answer_anchored` kept for books with no worked solutions), an answer type with its asked-for form (FR-4320), each lesson's book provenance (FR-4311, T401), `mc:` ids, and `family` as a field. Existing bundles must still dump byte-identically, and `selfcheck_arabic.py` must stay at 100% (FR-4405).
- [x] T337 [US2] (WP-P3) **B6** *(revised 2026-09-25, decisions 19–21)*: `services/extraction/runbook/lesson.workflow.js` covers S2–S4 and the S8 oracle. It reads the maths from S0b's accepted transcriptions (T419).
  - **S2**: claims, with `teacher_only` blocks dropped (FR-4408).
  - **S3**: the canonical solution of an exercise **is its EPUB worked solution**, transcribed. A worked example keeps its printed solution.
  - A **blind re-solve** by a different agent must agree with **both** the printed answer and the EPUB solution's final answer. An item with no printed answer is checked against the EPUB solution alone and listed for G2. The Teacher's Guide is used only where it adds something (FR-4302).
  - **Answer typing**: a number, a choice (only where natural), or a maths expression of a stated kind and form, marked by FR-4320. Proofs, sketches and "show that" items become worked examples (FR-4303).
  - **S4**: visuals, about 13 per lesson.
- [x] T338 [US2] (WP-P4) **B8**: `services/extraction/assemble_lesson_bundle.py` — one bundle per chapter, with ids minted per `contracts/pipeline-handoff.md`, lesson titles, the `program:us-american-en` edge, and **notation normalised**: decimal comma → point, `(x; y)` → `(x, y)`, contexts kept (decision 15, FR-4308).
- [x] T339 [P] [US2] (WP-P4) **B9** *(revised 2026-09-25)*: `services/extraction/load_seed.py` — course maps driven by book config; **add-only by default**; `--if-absent` changes nothing when the course exists (FR-4208); `--update` applies content edits but refuses to change what an attempted question asks; `--replace` prunes and **refuses the whole load**, saying what would be lost, when student data, the misconception catalogue, generated questions or another course still reference what would go (FR-4210). **It never deletes or rewrites a student row, a misconception or an explanation.** `source='seed'` is accepted, and the program edge is written. *(Code on the branch 2026-09-25, with tests in `services/extraction/tests/test_load_seed.py`. Not verified and not ticked.)*
- [x] T340 [P] [US2] (WP-P4) **B10**: `services/extraction/parity_check.py --course` — a constant per course. Prep-3 stays 10/90/112/450/212, and G10's comes from its approved manifest (FR-4207). Add a pytest with `@covers FR-4207`. *(Code on the branch 2026-09-25 — `--course` / `--all-courses`, tests in `test_parity_check.py`. Not verified and not ticked; the G10 constant waits for T364.)*
- [x] T341 [P] [US2] (WP-P5) **B11**: `services/extraction/runbook/misconceptions.workflow.js` (fail-closed verifier, `mc:` ids) and `services/extraction/assemble_misconceptions.py`, merging to one error, one entry across S5, S6 and S7 (FR-4307).
- [x] T342 [US2] (WP-P5) **B18 + B19** *(revised 2026-09-25, decision 22)*:
  - **B18**: `refutation.workflow.js` is retired. It refuses to run without `allow_retired`; the code is on the branch, not verified. `assemble_refutations.py` is retired with it.
  - **B19**: `seed/generated/misconceptions.json` becomes the **single source** (FR-4409):
    - add the **six `t2u3-1-2` entries** that only `build_misconceptions.py` held, each with its refutation, so they go live;
    - move the refutation house style from `build_misconceptions.py`'s docstring into `docs/specs/extraction-pipeline.md` §3.8 (WP-PDOC — done 2026-09-25);
    - retire `build_misconceptions.py`;
    - **delete `seed/misconceptions-math.json`**;
    - **never rename a live id**.
  - Add `services/extraction/tests/test_misconception_catalogue.py`. It asserts that the live id set before is a subset of the set after, that the six new entries are present with refutations, that aliases are unchanged, and that every distractor stamp still resolves (`@covers FR-4409`). This is live Prep-3 content, so T423's CI proof must pass before it merges.
- [x] T343 [P] [US2] (WP-P6) **B12, option A (decision 16)**: a **declarative family spec** and a safe evaluator in `services/extraction/generate_questions.py` (`--families <dir>`), in `services/extraction/families/`, plus `services/extraction/runbook/families.workflow.js` (author and blind instance grader). No model-written code is executed, and the 35 Python families are unchanged (FR-4304).
- [x] T344 [US2] (WP-P6) **B13**: `services/extraction/generate_widget_questions.py --templates`, with `--dsn` **required** and `parent_question_id` set. It writes `coverage/<book>.widget-gaps.json`. Plus `services/extraction/runbook/widgets.workflow.js` (FR-4306).
- [x] T345 [P] [US2] (WP-P7) **B14**: `services/extraction/coverage_report.py` — the §3.11 integer equalities, including notation-normalised counts and each solution source counted separately.
- [x] T346 [P] [US2] (WP-P7) **B15**: `export_generated_content.py --course`, per-book `seed/generated/<book>/`, and course-scoped counts in `load_generated_questions.py` and `load_misconceptions.py`.
- [x] T347 [P] [US2] (WP-P7) **B16**: `services/extraction/meter_run.py` — a cost ledger per stage, so every run reports its cost (FR-4403). *(Code on the branch 2026-09-25 — `meter_run.py record | summary | list-runs | prices`, tests in `test_meter_run.py`. Not verified and not ticked.)*
- [x] T348 [P] [US2] (WP-P7) **B17**: `services/extraction/render_review_page.py` — dossier modes for objectives, book questions (derived to the printed answer, with disputes) and the catalogue.
- [x] T349 [P] [US2] (WP-P7) **B20**: replace `/tmp` paths with arguments in `services/extraction/merge_final.py` and `assemble_fullbook.py`. *(Code on the branch 2026-09-25 — `merge_final.py --base/--rerun/--audit/--out`, `assemble_fullbook.py <input>`. Not verified and not ticked.)*
- [x] T350 [US2] (WP-PDOC) In `docs/specs/extraction-pipeline.md`, mark every §10 decision as taken: D1 → #12, D2 → B, D3 → #13 amended by #19, D4 → #14 amended by #20, D5 → #15, D6 → #16, D7 → #9, D8 → #3, D9 → C, D10 routed. Document the "Load a course" action, state the authority level, and bring `services/extraction/runbook/README.md` up to date command by command (FR-4406). **Done 2026-09-25 by the tech-writer**, together with S0b, the EPUB solutions, B19, the refusing loader and G0's 65 lessons.

- [x] T418 [P] [US2] (WP-P8) **B21 — S0b maths transcription** (decision 21, FR-4407): `services/extraction/runbook/transcribe-maths.workflow.js`.
  - Two **independent** vision passes over each unique equation image (8,561 for this book), each blind to the other.
  - A transcription is accepted when `md5(latex)` equals the image's file name, or when both passes agree after normalisation.
  - Every accepted transcription is cross-checked against the PDF text layer's maths spans (Computer Modern fonts) for digits and letters.
- [x] T419 [US2] (WP-P8) **B21**: `services/extraction/assemble_maths.py`.
  - It builds the accepted map `{image md5 → LaTeX, how accepted}` from the run outputs, re-verifies every hash acceptance, and writes the queue of images neither rule accepted.
  - It reports counts by acceptance route (FR-4407, SC-213).
  - `services/extraction/tests/test_assemble_maths.py` covers it with `@covers FR-4407`.
- [x] T422 [P] [US2] (WP-P7) **B19, export side** (decision 22): `services/extraction/export_generated_content.py` keeps each misconception's `kind` and `aliases` on export, so a round trip through the database loses neither (FR-4409). Add a test.

**Checkpoint**: pipeline pytest green, self-check 100%, Arabic audit green; the Chapter 8 pilot runs S0a–S11 on a private scratch database.

---

## Phase 5: User Story 1, part B — the ingest run, the human gates, the production load (Priority: P1)

**Goal**: the complete G10 course, loaded to production and **hidden**.
**Depends on**: phase 4 (the line), and T318 and T325 (a safe load). Every "load into a shared
database" step also depends on T318.

- [x] T351 [US1] (WP-I) Run S0a and S0 on the whole book. Write `services/extraction/manifest/g10-math-american.json` (a draft already exists from scouting) and the edition check. The Teacher's Guide is scouted for worked solutions. **Done 2026-09-25 by scouting code** (`services/extraction/scratch_g10/`, report `runbook/g10-s0-report.md`), not by the B2/B3 builds, which must reproduce it (T332, T333). Scouting the Teacher's Guide is superseded: the EPUB carries a worked solution for every item (decision 19).
- [x] T352 [US1] ⛔ HUMAN GATE **G0** — Samuel approves the manifest, the lesson split and the edition verdict. Record it in `specs/003-curriculum-tracks/decisions.md` → *Gate record*. **Passed 2026-09-25: 65 lessons.** Splits P1a–e, promotions P2a–b and merges P3a–b are applied; P3c and P3d are not.
- [ ] T420 [US1] (WP-I) Run **S0b** (T418, T419) on the whole book. Commit `services/extraction/runs/g10-math/maths/` and the accepted map. Log the cost with `meter_run.py record --stage S0b`.
- [ ] T421 [US1] ⛔ HUMAN GATE **G0b** — Samuel, or someone he names, resolves every image on S0b's queue. No image is guessed (FR-4407). Record it in `specs/003-curriculum-tracks/decisions.md` → *Gate record*.
- [ ] T403 [US1] (WP-I) Regenerate `services/extraction/manifest/g10-math-american.json` with G0 applied, using the B3 build (T333, T402): **65 lessons**, each with its book provenance (FR-4311). Confirm the counts against `runbook/g10-s0-report.md` §3.5.
- [ ] T353 [US1] (WP-I) **Pilot, Chapter 8**: S1 → S11 on a **private scratch database**, with every run output committed under `services/extraction/runs/g10-math/`.
- [ ] T354 [US1] ⛔ HUMAN GATES **G1–G5 for the pilot chapter**. Samuel reviews the objectives, disputed solutions, the family sample, the refutations, then gives go or no-go. The pilot's findings go back into WP-P packages as fixes before fan-out. Record it in `specs/003-curriculum-tracks/decisions.md` → *Gate record*.
- [ ] T355 [US1] (WP-I) Run S7 across all chapters and produce the **widget-gap list**, with the kind each gap would need.
- [ ] T356 [US1] ⛔ HUMAN GATE — Samuel approves or declines each proposed **new widget kind** (decision 11, FR-4306). Record each answer in `specs/003-curriculum-tracks/decisions.md`.
- [ ] T357 [P] [US1] (WP-W) Build each **approved** kind: component, `contracts/widget-predicates.json` entry, validator and renderer registration. It uses Play tokens only and follows FR-1202–FR-1210. Then re-run S7 for its chapters. Skip this task if T356 approves none. **Checked 2026-09-27, not ticked**: all six kinds of decision 27 are built in the app — `PolygonBuilder.tsx` (shape builder), `SolidScaler.tsx` (3-D solid scaler), `BoxPlotBuilder.tsx`, `VennBuilder.tsx`, `AreaModel.tsx` (algebra tiles) and the curve sketcher's five G10 families — with contract entries in `contracts/widget-predicates.json` and pipeline registration (`generate_widget_questions.py`, `s7-v5`). Two things keep it open: (1) they were built **before** T355's gap list existed, whereas decision 27 and FR-4306 say each kind is built only for the chapters that list names — whether "built ahead" stands is **Samuel's decision** (open question in `docs/PROJECT_STATE.md`); (2) "re-run S7 for its chapters" has run for Chapter 8 only.
- [ ] T358 [US1] (WP-I) Fan out: run S1 per chapter.
- [ ] T359 [US1] ⛔ HUMAN GATE **G1** per chapter — derived objectives with their evidence (ADR-0005 amendment). Record it in `specs/003-curriculum-tracks/decisions.md` → *Gate record*.
- [ ] T360 [US1] (WP-I) Run S2–S4 and S8 per lesson, then S5–S7 per objective, across the book.
- [ ] T361 [US1] ⛔ HUMAN GATES **G2** (solution disputes, a 10% sample of derived solutions), **G3** (the 10% family-stratified sample; rejecting one retires its family) and **G4** (refutations). Record it in `specs/003-curriculum-tracks/decisions.md` → *Gate record*.
- [ ] T362 [US1] (WP-I) The coverage audit comes back **GREEN**, or with exceptions Samuel signed. Objectives under the tier floor and chapters without widgets are listed (FR-4305, FR-4306).
- [ ] T363 [US1] ⛔ HUMAN GATE **G5** — go or no-go on the dry-run delta, coverage, drift for every course, and the cost ledger. Record it in `specs/003-curriculum-tracks/decisions.md` → *Gate record*.
- [ ] T364 [US1] (WP-I) Promote per the ADR-0019 note, following "Status at export" in `contracts/pipeline-handoff.md`. Then `export_generated_content.py --course course:us-g10-math-en`. Commit the bundles, the exports and the run outputs. Record G10's drift constant (T340).
- [ ] T365 [US1] (WP-Q) Load locally with `scripts/local-dev.sh` after T318 and T328. Walk US1 scenarios 1–5 with a test account holding an exception.
- [ ] T366 [US1] ⛔ HUMAN GATE — Samuel deploys the release that carries phases 2–3. A deploy loads no course. Then he runs **Actions → Load a course** in `dry-run` mode, and then as a **rehearsal on a copy of production** (FR-4209). Record it in `specs/003-curriculum-tracks/decisions.md` → *Gate record*.
- [ ] T367 [US1] ⛔ HUMAN GATE — Samuel runs **Actions → Load a course** in `load` mode (confirm = the course id). Check the post-flight: every course's drift check passes, **0** visibility rows, and the console shows the course's completeness (US1 scenarios 6–7). Record it in `specs/003-curriculum-tracks/decisions.md` → *Gate record*.

**Checkpoint**: the course is in production, complete and hidden. No student can see or name it.

---

## Phase 6: User Story 3 — a student follows one curriculum, set at sign-up (Priority: P3)

**Goal**: the curriculum is set at sign-up and in the Google step, and it scopes every student surface.
**Independent test**: US3 acceptance scenarios 1–6, with two curricula live in one grade as a fixture.

- [x] T368 [P] [US3] (WP-D) Sign-up:
  - in `app/src/app/(auth)/signup/page.student.tsx`, compute `offered` for every grade;
  - in `app/src/components/auth/SignupForm.tsx`, show the curriculum question after grade only when two or more are offered, with nothing pre-selected and flat labels;
  - in `app/src/app/api/auth/signup/route.ts`, return `invalid_curriculum` and `curriculum_required`, resolve with `resolveInitialCurriculum`, and add the curriculum fields to `account_created` (first-party only) (FR-4005, FR-4016).

  **Superseded 2026-10-01 (answer 36, reverses decision 1):** the question is no longer conditional on
  `offered` having two or more entries — it is always shown, naming every curriculum. This task's code is
  ticked for what it built under the old rule; T434 carries the change to the new one.
- [x] T369 [US3] (WP-D) The first-Google-sign-in step:
  - in `app/src/lib/auth/google.ts` and `app/src/app/api/auth/google/callback/route.ts`, set `onboarding_pending` on a created account and redirect to `/welcome`;
  - create `app/src/app/(auth)/welcome/page.student.tsx` and `app/src/components/auth/OnboardingForm.tsx`;
  - create `app/src/app/api/auth/onboarding/route.ts`, which calls `complete_student_onboarding()` and answers **409 on a second call**;
  - while pending, redirect every student page and answer 403 on student APIs, through the principal in `app/src/lib/auth/principal.ts`;
  - `app/src/app/api/auth/me/route.ts` and `app/src/lib/student-context.ts` expose `curriculum`, `curriculumKnown` and `onboardingPending` (FR-4014, FR-4017; privacy review F10). Depends on T312.
- [x] T370 [P] [US3] (WP-D) Tests:
  - `app/src/lib/ga-curriculum-guard.test.mts` (`@covers FR-4016`): "curriculum" is never in `GA_EVENTS` or `GA_PROPS` (privacy review F4);
  - `app/src/lib/onboarding.test.mts` (`@covers FR-4014`): a second submission gets 409, pending blocks lessons, and a returning Google sign-in is unaffected.
- [x] T371 [P] [US3] (WP-C) Remaining readers:
  - `app/src/lib/spine-lo-query.ts`: the skill map by course;
  - `app/src/lib/subject-queries.ts`: roll up by course, and read the last check through the objective;
  - `app/src/lib/student-landing.ts` and `app/src/app/(student)/student/page.tsx`: `scope.courseForSubject`, counting courses rather than subjects;
  - `app/src/app/layout.tsx`: the strapline comes from the student's own courses.

  **Re-verified 2026-09-26 (isolation audit): three of these four bullets were ticked before they were
  true** — `subject-queries.ts` still rolled up by subject and read the last check by its subject tag,
  `student-landing.ts` still counted subjects, and the skill map still filtered by subject. All three are
  now built, under T372's note below, where the proof is listed. The strapline bullet was already true.
- [x] T372 [P] [US3] (WP-F) Student components:
  - `app/src/components/spine/SpineExplorer.tsx`: a course picker, and never a merged maths view;
  - `app/src/components/student/SubjectHome.tsx`: cards keyed by course;
  - `app/src/components/student/LessonCheckIn.tsx`: term labels from the course's term model, none for G10, and links resolved in scope.

  **Verified 2026-09-25, not ticked**: `SubjectHome.tsx` and `LessonCheckIn.tsx` are done. But
  `SpineExplorer.tsx` implements a **subject** picker, not a course picker, and "never a merged maths
  view" is not actually guaranteed: `lib/module-order.ts`'s own header comment records, as an open,
  acknowledged gap, that a tester holding a cross-curriculum exception (FR-4009) would see the skill map
  and subject home **merge the two maths courses**. That is a real edge case this task was meant to
  close, still open. Fix `SpineExplorer.tsx` to pick by course, and either close the tester-merge gap or
  route it through FR-4009's decision explicitly rather than leaving it as an unticked comment.

  **Done 2026-09-26 (isolation audit, gap 4) — the tester-merge gap is closed, not routed.** The merge was
  in the readers T371 was ticked for, so they were fixed first: `lib/subject-queries.ts` rolls up per
  **course** (one card per course, course order, the last check read through its objective), and
  `getSpineData` files every objective under its course (`SpineLo.courseId`, from the gate's own walk,
  `StudentGraphScope.courseOf`) and returns `SpineData.courses`, each with **its own book**
  (`sourceBooksFor`). `SpineExplorer.tsx` picks by course — for a student with one course per subject the
  picker's entries, order and labels are the subject picker's — and a page citation or a question's
  provenance names the book of the course on screen, not the first course's. `SubjectHome.tsx` keys cards by
  course; when two share a subject the card links `?subject=…&lesson=<its first lesson>`, and
  `student/page.tsx` takes the course from a named lesson of that subject. `lib/student-landing.ts` counts
  courses (T371's own wording), so a tester whose only courses are two maths books gets the home, not a
  check-in mixing both. Proof: `catalog-gate.test.mts` and `student-landing.test.mts` (fake client);
  `curriculum-scope-db.test.mts` against Postgres (two cards, two maps, each map's book); the order
  guard's premises now name the course keys (`catalogue-order-guard.test.mts`). `LessonCheckIn.tsx` was
  already done and is unchanged.
- [ ] T373 [US3] (WP-Q) Walk US3 scenarios 1–6, and run the SC-206 pass: every student surface as a National and as an American student, with the gate **on and off**, and direct requests answering as not found. Record the result in `specs/003-curriculum-tracks/traceability.md` (WP-DOC).

---

## Phase 7: User Story 4 — the console, per curriculum, grade and course (Priority: P4)

**Goal**: `/courses` in sections, an offered line per grade, no figure that pools courses.
**Independent test**: US4 acceptance scenarios 1–4.

- [x] T374 [P] [US4] (WP-G) Add the `lastLiveCourseHeadcount` entry to `CROSS_STUDENT_READS` in `app/src/lib/auth/authorize.ts`, owned by `content-review` and count only. Unblocks T308's read.
- [x] T375 [US4] (WP-G) `/courses`:
  - in `app/src/components/console/CourseAvailabilityGrid.tsx` and `app/src/app/(console)/courses/page.console.tsx`: curriculum sections, grade labels in each curriculum's words, the per-grade offered line, the in-page headcount question (no names), the in-page question for a grade the book is not written for, per-section bulk actions and the new kill-switch sentence;
  - in `app/src/app/api/console/courses/route.console.ts`: validate against `COURSES`;
  - correct the stale header (FR-4101…FR-4103).
- [x] T376 [P] [US4] (WP-G) Add `app/src/lib/course-count-guard.test.mts` (`@covers FR-4103`). It fails if the `/courses` view or its copy could interpolate a student's name or id (privacy review F9).
- [x] T377 [P] [US4] (WP-G) Overview: in `app/src/lib/overview-queries.ts` and `app/src/app/(console)/overview/page.console.tsx`, make the cohort key `(course_id, grade, syllabus_version)` and the picker a course picker (FR-4104, decision 8).
- [x] T378 [P] [US4] (WP-G) Content, Cost, Feedback, `/pipeline`:
  - the Content page (`app/src/lib/content-admin.ts`) switches over `COURSES` grouped by curriculum;
  - Cost and Feedback label by course, with **Cost aggregate-only** (privacy review F7);
  - `app/src/lib/pipeline-queries.ts` uses `COURSE_RANK`;
  - the footer in `app/src/app/(console)/layout.console.tsx` names the loaded curricula (FR-4104).
- [x] T379 [P] [US4] (WP-G) Teaching page: `app/src/app/(console)/teaching/page.console.tsx` names the courses probing can reach, from `CourseDef.probing` (FR-4212).
- [x] T380 [US4] (WP-G) Student 360 and the students list:
  - in `app/src/components/console/CourseAccessEditor.tsx` and `app/src/app/(console)/students/[id]/page.console.tsx`: access reasons, with an out-of-curriculum exception labelled as such (privacy review F18);
  - the curriculum fact with its source, the unknown and not-offered flags, and the history list;
  - in `app/src/lib/console-queries.ts`: a curriculum column in the `student-data` projection only (FR-4105).

---

## Phase 8: User Story 5 — an operator changes a curriculum, and the student loses nothing (Priority: P5)

**Goal**: console-only curriculum change, recorded, lossless.
**Independent test**: US5 acceptance scenarios 1–5 and SC-209.

- [x] T381 [US5] (WP-G) Create `app/src/app/api/console/students/[id]/curriculum/route.console.ts` per `contracts/console.md`. One transaction updates the student and inserts a history row, answering `no_change`, `invalid_curriculum` or `403`. Register it in `app/src/lib/console-routes.ts` for `student-data`, and add it to `app/src/lib/auth/matrix.test.mts` (`@covers FR-4010`). Depends on T312.
- [x] T382 [US5] (WP-G) Create `app/src/components/console/CurriculumEditor.tsx`. It confirms in the page, naming the courses the student will stop and start seeing, and says progress is kept. Mount it in Student 360 (FR-4010, FR-2710).
- [ ] T383 [US5] (WP-Q) Prove SC-209 against a scratch database. Give a student progress in one course, change the curriculum, study, change it back. Mastery, saved place and attempts are identical, and two history rows exist. Confirm no student surface offers a curriculum control (US5 scenario 5).

---

## Phase 8b: User Story 6 — parts of one book section stay together (Priority: P1, ships with US1) **[ADDED 2026-09-25, decision 18]**

**Goal**: FR-4311…FR-4319, for every curriculum.
**Independent test**: US6 acceptance scenarios 1–8, on a course with a split section (the G10 course or a fixture) and on a National course, which must be unchanged.

- [x] T400 [US6] (WP-B) Write `db/migrations/034-book-sections.sql` and its rollback per data-model §2 "Book sections". It adds a content table of lessons with their book provenance, with no RLS, SELECT for both roles, and writes by the loader only. It must be re-runnable and never narrow anything (FR-3213). If a better placement is found, record it in data-model.md before building.
- [x] T401 [P] [US6] (WP-P3) Add each lesson's book provenance to the bundle schema in `services/extraction/schemas.py`: sections (number and title), part n of m, chapter introduction (FR-4311). Coordinated with T336 in the same file.
- [x] T402 [US6] (WP-P1) In `services/extraction/build_manifest.py`, apply G0's decisions — splits P1a–e, promotions P2a–b, merges P3a–b — and write each lesson's book provenance into the manifest.
- [x] T404 [US6] (WP-P4) Write lesson provenance to the book-sections store from `services/extraction/assemble_lesson_bundle.py` and `services/extraction/load_seed.py`. The National courses' lessons get one-section provenance from their existing slugs and titles, which is what makes FR-4311 hold for every curriculum. Part *n*−1 → part *n* prerequisites are **derived** from the store (data-model §2), never written into `graph_edges` as if the book said them (FR-4317).
- [x] T405 [P] [US6] (WP-A) Add `app/src/lib/book-sections.ts` (new, pure) and `app/src/lib/book-sections.test.mts`: the section key, part order, the roll-up "*k* of *m*", "may the place move past this section?", and the derived part prerequisites. Keep parts consecutive in `app/src/lib/module-order.ts` (FR-4312, FR-4314, FR-4317; `@covers`).
- [ ] T406 [US6] (WP-C) In `app/src/lib/progression.ts`, `app/src/lib/progression-db.ts` and `app/src/lib/queries.ts` (the practice plan), the place never moves past a section until every part passes, and a recommendation into a started section is named by the section (FR-4313). Add tests. The rule reduces to today's for a course with no parts. **Verified 2026-09-25, not ticked**: the core gate — `progression.ts`'s `nextPlaceBySection`/`advanceTarget` and `progression-db.ts`'s `advanceIfMastered` — is real, tested, and does hold the place inside a started section until every part passes. But "a recommendation into a started section is named by the section" is not wired into `queries.ts`'s practice plan at all; it exists only inside `components/student/LessonCheckIn.tsx`'s own client-side logic (T410's file), which builds its own section index rather than going through `progression-db.ts`. `progression-db.ts`'s exported `getSectionIndex()` — documented in its own comment as being for the check-in page — has no callers anywhere in `app/src` outside its test file: it looks like it was written for this purpose and never wired in. Finish wiring the practice plan (or retarget this task's practice-plan half to wherever the recommendation is actually meant to surface) before ticking.
- [x] T407 [P] [US6] (WP-C) Add the section roll-up to `app/src/lib/subject-queries.ts` and `app/src/lib/dashboard.ts` (FR-4314).
- [x] T408 [US6] (WP-C) In `app/src/lib/ask.ts`, make sibling parts the nearest related material (FR-4316). Run the capture proof: every National prompt is byte-identical, because no National section has parts (FR-4206).
- [x] T409 [P] [US6] (WP-F) Show a section's parts as one group on the skill map, in `app/src/lib/spine-layout.ts` and `app/src/components/spine/SpineExplorer.tsx` (FR-4315). **Re-done 2026-10-02 on the Your Progress Map** (main v0.11.0 replaced the column map this was first built on; Samuel chose to port it, not drop it): the parts of a split section are a contiguous arc of their chapter's ring, drawn as a tray behind it and named from the lessons level on — `app/src/lib/skill-map.ts` (`placeSections`, `sectionNameOf`, `annularSectorPath`), `skill-map-labels.ts`, `app/src/components/spine/SkillMap.tsx`, `SpineExplorer.tsx`, `app/src/lib/section-label.ts` (`sectionGroupsOf`, `lessonNamesOnMap`); tested by `skill-map-sections.test.mts`, including the proof that a map with no split section equals main's v0.11.0 map. The frame code in `spine-layout.ts` was retired with the column map (that file is main's again).
- [ ] T410 [P] [US6] (WP-F) Show the printed section number and "part *n* of *m*" in `app/src/components/student/{LessonCheckIn,LessonSession,SubjectHome}.tsx`. The National courses' existing lesson numbers are unchanged (FR-4318). **Verified 2026-09-25, not ticked**: `LessonCheckIn.tsx` and `SubjectHome.tsx` are done — both show the printed section number and "part *n* of *m*" correctly. `LessonSession.tsx`'s header shows only `lessonTitle()`'s title; `lib/lesson.ts`'s `printedLabel(book).partLabel` is computed but never read by `LessonSession.tsx`, so the part label is silently dropped on the one surface a student is actually looking at while working the lesson. One-line fix, but real: the file has zero references to "part" or book provenance today.
- [x] T411 [P] [US6] (WP-G) Add per-lesson and per-section figures to `app/src/lib/content-admin.ts`, `app/src/lib/overview-queries.ts` and the Content and Overview pages (FR-4319).
- [ ] T412 [US6] (WP-Q) Walk US6 scenarios 1–8 and record the SC-211 result in `specs/003-curriculum-tracks/traceability.md` (WP-DOC records it).

---

## Phase 8c: User Story 7 — a typed maths answer is marked by what it means (Priority: P1, ships with US1) **[ADDED 2026-09-25, decision 20]**

**Goal**: FR-4320. The contract is [contracts/answer-marker.md](./contracts/answer-marker.md).
**Independent test**: US7 acceptance scenarios 1–5, and SC-212's replay of every existing course's attempts.

- [x] T413 [US7] ⛔ HUMAN GATE — **the marker's library or approach.** WP-M evaluates the candidates in `contracts/answer-marker.md` against the 1,111 Grade 10 maths-expression answers and a set of wrong-form answers, and proposes one with its results. Samuel decides. If he accepts, WP-DOC records it as ADR-0025. Record it in `specs/003-curriculum-tracks/decisions.md` → *Gate record*.
- [x] T414 [US7] (WP-M) Write `app/src/lib/answer-marker.ts` per the contract:
  - normalisation of the answer and the key, following decision 15;
  - equivalence for each answer kind;
  - form checks;
  - "unreadable, re-enter".

  It is deterministic, calls no model, and runs on the server only (FR-4320).
- [x] T415 [P] [US7] (WP-M) Write `app/src/lib/answer-marker.test.mts` (`@covers FR-4320`, SC-212):
  - every Grade 10 printed answer typed as printed, and in equivalent forms;
  - wrong-form negatives for "factorise", "simplify" and "make *x* the subject";
  - decimal commas and `(x; y)` pairs;
  - unreadable input;
  - numeric and choice keys that must mark exactly as `grade()` does today.
- [x] T416 [US7] (WP-M) In `app/src/app/api/attempts/route.ts`, use the marker **only** for questions whose stored answer type is a maths expression. Numbers and choices keep today's path. Replay every recorded attempt of the existing courses from a copy of the local database and show identical results (SC-212).
- [x] T417 [P] [US7] (WP-F) Create `app/src/components/chat/MathAnswerInput.tsx` and use it in `app/src/components/chat/ChatQuestionCard.tsx`:
  - typed maths entry, rendered left to right in any direction (Principle V);
  - Play tokens only;
  - an iPad Safari keyboard that works;
  - the "which form is asked" and "please re-enter" messages from the route.

  **Note, 2026-09-26**: `ChatQuestionCard.tsx` was the only surface wired. Two more take a typed maths
  answer and both dropped a 422 re-entry silently: `StudentLoop.tsx` (`?mode=practice`) had no maths input
  at all for a `choices.marker` question and showed a re-entry as a raw "API 422" thrown error; `ChatCore.tsx`
  graded a chat-typed answer (`{{answer_submitted:…}}`) through the same route but only `console.error`ed a
  re-entry, so a student who typed an unreadable or wrong-form answer in chat saw no reaction at all. Both
  now go through `lib/attempts-client.ts`'s `submitAttempt`/`AttemptRetryError` seam, the same one
  `ChatQuestionCard.tsx` already used: `StudentLoop.tsx` renders `MathAnswerInput` for a marked question and
  keeps the student's typed text on a re-entry (never counted as an attempt); `ChatCore.tsx` shows the
  marker's message as a local, model-invisible note (`{ role: "note", kind: "say", localOnly: true }`).
  Covered by `student-loop-marker.test.mts` and `chat-core-retry.test.mts`.

---

## Phase 9: Polish, governance and launch

- [ ] T384 (WP-A) Final guards:
  - add `course-literal-guard.test.mts`: no `"course:` literal outside the registry, and no `courseIdOfSpineKey` or `SUBJECTS[…].courseId` outside the listed files;
  - make `catalogue-order-guard.test.mts` "one-course";
  - these land after every importer has moved (T314–T317, T320–T322, T371–T372, T375–T380).
- [ ] T385 [P] (WP-Q) Write `scripts/curriculum-smoke.sh`: sign-up at grades 9 and 10; the scope pass; operator change and back; the Google step's 409; the load action's dry run against a scratch copy; `traceability.py --check`. It exits non-zero on any failure.
- [ ] T386 (WP-DOC) Stamp the requirements this feature touches, in `specs/001-student-mvp1-delta/spec.md`, `specs/002-identity-and-admin-console/spec.md` and their `traceability.md`: FR-2002, FR-2006, FR-2013, FR-2702, FR-2704…FR-2706, FR-2703, FR-2709, FR-3207, FR-3212, FR-3217, FR-302, FR-1109, FR-1201, and the 001 delta-matrix §2 row. Use the table in spec.md *Governance impact*.
- [ ] T387 (WP-DOC) Move `specs/003-curriculum-tracks/traceability.md` rows from OPEN to BUILT, PARTIAL or VERIFIED as evidence lands, never ahead of it. Run `./scripts/traceability.py --write --spec curriculum-tracks` and `--check`.
- [ ] T388 ⛔ HUMAN GATE — Samuel accepts ADR-0024's wording and the notes on ADR-0005, ADR-0018, ADR-0019 and ADR-0020, then commits them. Record it in `specs/003-curriculum-tracks/decisions.md` → *Gate record*.
- [ ] T389 ⛔ HUMAN GATE — Samuel approves or edits `constitution-amendment-proposal.md`. After approval only, WP-DOC applies it to `.specify/memory/constitution.md` with the Sync Impact Report. **The release waits on this; the build does not.** Record it in `specs/003-curriculum-tracks/decisions.md` → *Gate record*.
- [ ] T390 (WP-DOC) Release: a `CHANGELOG.md` entry, the version bump to `v0.12.0` in `app/package.json` and `package-lock.json`, `docs/releases/v0.12.0.html`, `docs/README.md`'s map, and `docs/PROJECT_STATE.md`. **Version number set 2026-10-02 by Samuel (answer 47, decision 68: "T390 should be v0.12.0")**: this task planned `v0.10.0`, but `main` has since released its own `v0.10.0` (2026-10-01) and `v0.11.0` (2026-10-02). Nothing is bumped yet (`app/package.json` reads 0.11.0); the task stays open until the release.
- [ ] T391 ⛔ HUMAN GATE — Samuel tells Tamer, the PRD owner, that the curriculum dimension 001 held constant now varies (spec Constitution check, VIII). Record it in `specs/003-curriculum-tracks/decisions.md` → *Gate record*.
- [ ] T392 ⛔ HUMAN GATE **Launch** — in production `/courses`:
  - set **Mathematics — Grade 10 (American) live for grade 10**;
  - confirm Prep-3 Mathematics and every National course are **not** live for grade 10 (FR-4211);
  - check for grade-10 students stored as National and move any real one through Student 360.

  Record it in `specs/003-curriculum-tracks/decisions.md` → *Gate record*.
- [ ] T393 ⛔ HUMAN GATE — a founder signs up a grade-10 test account on **iPad Safari** and walks US1 scenario 8 and US3 scenarios 2–4 on the live site (constitution, "live verification is part of done"). Record it in `specs/003-curriculum-tracks/decisions.md` → *Gate record*.

- [ ] T423 (WP-H) **CI proof for the misconception catalogue** (decision 22). In `.github/workflows/ci-cd.yml`'s migrations job, load `seed/generated/misconceptions.json` into the scratch database **twice**. Assert no duplicate, that the six `t2u3-1-2` entries are present, and that no live id from the previous release's catalogue is missing (FR-4409, FR-3214). T342 may not merge before this is green.
- [ ] T424 [P] (WP-Q) Rehearse the catalogue change on a copy of the local database with the Prep-3 bank. Load it before and after, compare id sets and distractor stamps, and confirm a student's recorded misconception ids still resolve.
- [ ] T425 [P] (WP-B) Correct the comments in `db/migrations/027-socratic-probe-retry-link.sql` (`:35`) and `db/migrations/028-lesson-progress.sql` (`:56–57`, `:106`). They still describe a loader that deletes attempts on a course reload. It now adds only, and refuses rather than deleting (T339). This is a comment change only, and re-run safe.
- [ ] T426 [P] (WP-H) Correct the other descriptions of the old deleting loader: `deploy/refresh-content.sh:261`, `deploy/DEPLOY.md:136`, `.github/workflows/ci-cd.yml:610` and `scripts/local-dev.sh:162`. Each says a `--course` load "replaces the course's subtree". It now adds only by default, and `--replace` refuses rather than losing student data (B9). The wording is folded into T326 and T327 where those tasks already edit the same files.

### Reserved

- T394–T399 are reserved for fixes found by the multi-agent review before merge (constitution,
  *Development Workflow*). T397 is pre-assigned: remove the deprecated `SubjectDef.courseId` alias
  once T384 is green.
- [ ] T397 (WP-A) Remove the deprecated `SubjectDef.courseId` alias and `courseIdOfSpineKey` from `app/src/lib/subjects.ts` once T384 is green. **Note, 2026-09-25**: T305's verification found `subjects.ts` already carries no `courseId` alias and no `courseIdOfSpineKey` — the code went straight to this task's end state without the transitional alias T305 asked for ever existing. Confirm nothing still expects the alias (T305's note) before closing this as moot; if confirmed moot, mark it DROPPED rather than done, since nobody ran it.

---

## Phase 9b: Third round of decisions — T427–T433 **[ADDED 2026-09-25, decisions 23–34]**

Samuel answered thirteen more questions one by one the same day
([decisions.md](./decisions.md), "Third round"). T413 (the marker) is recorded above, in Phase 8c,
and is now passed. These are the remaining build items that round adds.

- [x] T427 [US2] (WP-P2) **Second blind mapper for chapter-end exercises** (decision 33, S1's design):
  `services/extraction/runbook/objectives.workflow.js` carries the flag (`args.options.second_mapper`;
  it was `false` when this task was written, 2026-09-25). Turn it on for Grade 10; wire a second,
  independent mapper's item→objective assignment for the 1,228 chapter-end items alongside the existing
  one, and surface any disagreement at gate **G1**, next to the chapter's objectives, rather than
  trusting a single mapper's assignment. Extend `assemble_objectives.py`'s rule-2 check
  (`tests/test_objectives.py`'s `test_rule2_every_item_to_exactly_one_objective`) accordingly.
  **Verified 2026-09-27**: the flag now defaults to `true` (`objectives.workflow.js:111`) and the
  workflow runs two blind mappers; `assemble_objectives.py` records every disagreement as a
  `mappers_disagree` decision G1 owes, shown on the G1 page;
  `test_the_second_mapper_is_required_and_its_disagreement_goes_to_g1` passes (`test_objectives.py`).
  Used in the Chapter 8 pilot: 132 end-of-chapter items distributed by two blind mappers, G1 passed.
- [x] T428 [US2] (WP-P2) **G10's prerequisite-link stage** (decision 25, new FR-4410): the pipeline
  finds this book's prerequisite links in the book itself, each cited to the evidence it rests on
  (a cross-reference, a "recall" note, a worked example reusing an earlier method — never inferred from
  outside curriculum knowledge). A second, independent AI checks each candidate link before it reaches
  a human. Samuel approves each chapter's prerequisite links together with that chapter's objectives, at
  gate **G1**. New stage in `objectives.workflow.js` / `assemble_objectives.py`, or a sibling stage —
  WP-P2's call which. **Verified 2026-09-27**: inside S1 — the workflow's linker and an independent
  link checker (`links: true` by default); `assemble_objectives.py` keeps a link only with its quote at
  its anchor and the checker's agreement, sends backward links and a dead linker to G1 as decisions,
  refuses cycles, writes kept links as `prerequisites` (assembled as `prerequisite_of` edges) and lists
  every link, kept or dropped, on the G1 page. `test_objectives.py`'s three link tests pass. Used in the
  Chapter 8 pilot: 1 link confirmed and kept at G1. (Chapter 8 ran first, so it could propose no link
  to Chapters 1–7; its links are re-run after those chapters pass G1.)
- [ ] T429 [US1] (WP-P7 for the inventory; WP-W for any approved kind) **The figure-gap inventory**
  (decision 26, new FR-4321): extend S4's `viz-gaps.json` reporting so a figure no existing kind can
  draw is not just recorded but counted by the native kind it would need (geometry diagram, trig graph,
  3-D solid, or another), with how many figures of that kind occur and their sizes. Put the inventory to
  Samuel before any native figure type is built — the same gate decision 11 already sets for widget
  questions (T355/T356). No figure ships as an approximated static image in place of an unmatched kind.
- [x] T430 [US1] (WP-H) **"Load a course"'s restore mode** (decision 29; FR-4208, FR-4210 amended):
  add a `restore` mode to `.github/workflows/load-course.yml` / `deploy/load-course.sh` — replays a
  previously exported, reviewed bundle for a course, keeping each row's own status and review stamp,
  gated by a **typed confirmation of the course id**, with the same backup-first, verified-readback
  discipline as the load mode, refusing if the restore target's provenance does not match the course
  already present. **Samuel's answer 27 (2026-09-27): "Build the safe restore"** — the bundle replay,
  keeping every student's progress or refusing; the whole-database mode stays, renamed `rollback`.
  **Done 2026-09-28.** Modes `restore-dry-run` → `restore-rehearse` → `restore [export_ref]`
  (`deploy/load-course.sh` step 8; the workflow's `export_ref` input; `CONFIRM` re-checked on the box).
  The replay is `services/extraction/restore_course_bundle.py`: provenance from the new
  `export-record.json` that `export_generated_content.py --course` now writes (course, book, source
  document, sha256 of each file) — no record, an edited file, another course or book, a different
  source document, or a moved id → refused; any content row the replay would remove, or any question
  whose asked-or-accepted content it would change, that a student row names (every text/JSON column
  of every student table) → refused, naming it; otherwise one REPEATABLE READ transaction that
  commits only if every student table is identical before and after and the course re-exports to
  the restored bytes; backup first via `ops_backup`; post-flight read-back, drift guard, other courses
  byte-identical, (rehearse) student tables byte-identical. The old whole-database mode is
  `rollback`, behaviour unchanged; `restore <file>` is refused with the new spelling. Proof:
  `services/extraction/tests/test_load_course_restore.py` (21 tests: restore_course_bundle.py
  directly, including the real Prep-3 bank round trip, and the real `load-course.sh` end to end via
  `tests/fake_docker` — dry run, rehearse, restore, refusals, rollback), wired into `ci-cd.yml`'s
  migrations job. Runbook: `deploy/DEPLOY-MVP1.md` → "Restoring a course from its export".
  **Not yet run on the box**, and no committed export carries a record yet: the first restore point
  of each course is its next `--course` export.
- [x] T431 [US1] (WP-E) **The per-course "Arabic touches" setting** (decision 30; FR-4205 amended): add
  an `arabicTouches` (or similarly named) flag to `CourseDef`, `true` for every National course
  (unchanged) and `false` for G10. Where G10's prompts are built, no Egyptian-Arabic phrase or
  colloquialism is used; the address term "Egyptian student" is kept regardless of the flag. Extend the
  byte-identity capture (T323) to prove National prompts are unaffected. **Verified 2026-09-27**:
  `CourseTutorFacts.arabicTouches` in `lib/courses.ts` (`true` for the National courses, `false` for
  G10); `lib/lesson.ts` swaps each Arabic touch for an English one when it is off.
  `g10-prompts.test.mts` (no Arabic script in any G10 render; "an Egyptian grade-10 student" kept in
  all four address registers), `national-prompts.test.mts` (unchanged) and `lesson-names.test.mts`
  pass. **Open for Samuel, not part of this tick**: the language line the code adds for G10 ("write no
  Arabic at all … even if the student writes to you in Arabic") goes further than decision 30's "no
  Egyptian-Arabic phrases" (integration backlog 53).
- [x] T432 [US2] (WP-P3, coordinate with WP-DOC) **Arabic lesson titles from the book's own printed
  names** (decision 34; ADR-0020's ninth exception, numbered the fifth until 2026-09-27 and the sixth until 2026-10-02): where a
  National Arabic lesson's working title differs from the book's own printed section name, retitle it
  to the book's name. This is a content change to the already-loaded Arabic bundles, not new pipeline
  code; commit the retitled bundle and add the affected lessons' prompts to the byte-identity capture
  set as new, deliberately-changed goldens (not a regression), per ADR-0020's ninth exception.
  **Verified 2026-09-27**: the printed names are in `services/extraction/books/prep3-arabic-ar.json`
  (`lesson_titles`, identical to the bundles' `syllabus_ref` titles); `load_seed.py` writes them to
  `course_lessons.title`; the app reads them only for the Arabic course
  (`CourseTutorFacts.bookLessonTitles`, `shownTitles`). `national-prompts.test.mts` proves the
  deliberate change: with the loader's rows in the store, exactly five Arabic renders change, each by
  the title only (for example «فهم النص والاستماع» → «عِبادُ الرَّحمنِ»), and every maths and Social
  Studies render stays the v0.9.2 golden. Not yet done: the full 438-file capture over a real
  database (integration backlog 58). Open review question: the lesson data line now names the lesson
  twice (backlog 52).
- [x] T433 [US2] (WP-P8) **The third-reading rule for disagreeing maths transcriptions** (decision 32;
  FR-4407 amended): extend `services/extraction/runbook/transcribe-maths.workflow.js` and
  `services/extraction/assemble_maths.py` (B21) so that when S0b's two independent readings disagree, a
  **third** independent reading decides, instead of holding the image; the third reading is itself
  cross-checked against the printed page's text before acceptance. Also implement the **EPUB-only image**
  rule: an image with no printed-page counterpart (found only inside an EPUB worked solution) is
  accepted on a hash match, on two agreeing readings, or on the third reading, by the same rule as any
  other image. Extend `tests/test_assemble_maths.py`'s `@covers FR-4407` cases and the route-count report
  (SC-213) to include the third-reading route. **Verified 2026-09-27**: `transcribe-maths.workflow.js`
  runs pass C alone, blind to A and B, on the images they did not agree on
  (`assemble_maths.py vision-args --pass C --runs …`); `assemble_maths.py` accepts a third reading only
  when it agrees with A or with B (two of three), then cross-checks it against the PDF text layer; an
  image used only in an EPUB worked solution (class `solution_only`) follows the same rule and is
  reported per class (`routes_by_class`). The summary counts `accepted_by_third_reading`. Three
  third-reading tests in `test_assemble_maths.py` pass. Used in the Chapter 8 pilot: 13 images accepted
  by the third reading, 853/853 accepted, 0 queued.

---

## Phase 9c: Fourth round of decisions — T434 **[ADDED 2026-10-01, answer 36]**

**Source**: `docs/WIP-g10-pilot/samuel-answers.md`, answer 36 — *"yes the sign up should always ask"* —
reversing decision 1, after the console showed no curriculum question for grade 10, where only American
is live. Recorded in [decisions.md](./decisions.md) as a supersession of decision 1 (no new decision
number assigned).

- [x] T434 [US3] (WP-D) Sign-up and the Google step always ask which curriculum (FR-4004, FR-4005
  changed 2026-10-01): remove the "two or more offered" gate before showing the question in
  `app/src/components/auth/SignupForm.tsx` and `app/src/app/(auth)/welcome/page.student.tsx` /
  `OnboardingForm.tsx`; list every curriculum the product knows (the full registry from
  `lib/curricula.ts`), pre-selecting none; a curriculum with nothing live for the chosen grade is still
  shown and selectable, carrying a short note that there is nothing to study there yet *(the
  orchestrator's default; awaiting Samuel's confirmation of the note, or that it belongs at all)*. In
  `app/src/app/api/auth/signup/route.ts` and `app/src/app/api/auth/onboarding/route.ts`, the curriculum
  field becomes required: missing answers `409 curriculum_required` naming every known id (not only
  offered ones), an unknown id still answers `400 invalid_curriculum`, and any known id is stored as
  `chosen` whether or not FR-4004 says the grade offers it. Drop the `curriculum_resolved_from` write
  on `account_created` (the race it covered no longer arises, per
  [contracts/student-api.md](./contracts/student-api.md)). Update `offeredCurricula`/
  `resolveInitialCurriculum` call sites and their tests (T370's `ga-curriculum-guard.test.mts` and
  `onboarding.test.mts`) for the new behaviour. Supersedes T368's "only when two or more are offered" and
  T369's offered-gated Google step. Walk US3's scenarios again (T373) and record the result in
  `traceability.md` once this lands; the main session ticks this task with that evidence.

  **Verified 2026-10-01**: built exactly as above, with one correction the code already made and this
  task's own text had wrong — both refusals answer **422**, not 409/400 (`curriculumRefusal`,
  `app/src/lib/auth/onboarding.ts`; `contracts/student-api.md` corrected to match). `SignupForm.tsx` and
  `OnboardingForm.tsx` render `app/src/components/auth/CurriculumChoice.tsx` (every registry curriculum,
  radio group, nothing pre-selected, the "nothing to study here yet" note per unoffered option, flat
  labels); `resolveInitialCurriculum` in `app/src/lib/catalog.ts` is now the three-outcome function
  `contracts/registry-and-gate.md` describes (blank → `curriculum_required`, unknown → `invalid_curriculum`,
  known → always `chosen`); the signup and onboarding routes call `offeredCurriculaFor` fresh at submit
  time only to carry the offer back on a refusal, never to gate what may be chosen; `curriculum_resolved_from`
  is gone from `account_created` (`data-model.md` noted). `app/src/app/(console)/courses/page.console.tsx`'s
  `OfferedLine` (FR-4102) states the new rule in its own copy. Proof: `catalog.test.mts`
  ("resolveInitialCurriculum — always chosen when known, required when blank, invalid when unknown
  (2026-10-01 reversal)"); `onboarding.test.mts` ("sign-up always asks the curriculum, after grade, with
  none pre-selected"); `onboarding-db.test.mts` (the real `completeOnboarding` path against Postgres,
  always `chosen`); `curriculum-queries.test.mts`. Evidence recorded on the FR-4004/FR-4005/FR-4102 rows
  of `traceability.md` (rev. 8). US3's scenarios (T373) and SC-206 are still to be walked.

---

## Phase 9d: Fifth round of decisions — T435–T443 **[ADDED 2026-10-01, answers 35 and 37]**

- [x] T435 [US1] (WP-E, WP-A, WP-G) **No Arabic anywhere in the American course** (decision 56, answer
  35, "this is american course we said no arabic"): extend T431's per-course `arabicTouches` setting
  beyond the tutor's prompts to every surface — the curriculum's own label, the course's Arabic subtitle
  wherever a course name is shown, and a cross-subject bridge FROM a G10 lesson. **Verified 2026-10-01**:
  `app/src/lib/curricula.ts` (`CurriculumDef.labelAr` optional, American carries none); `app/src/lib/subjects.ts`
  (`courseLabelAr`, `labelOfSpineKey` — `null` for a course whose tutor carries no Arabic, never falling
  back to the shared subject's Arabic name); `app/src/lib/catalog-queries.ts` (`labelAr: string | null` on
  both the catalog row and the student-access row); `app/src/components/console/CourseAvailabilityGrid.tsx`
  and `app/src/app/(console)/students/[id]/page.console.tsx` (print `labelAr` only when non-null);
  `app/src/lib/lesson.ts` (`bridgeBlock(bridges, arabic = true)` — a bridge FROM a G10 lesson carries no
  Arabic regardless of the other end); `app/src/components/student/StudentLoop.tsx` (`arabicTouches?: boolean`
  prop) and `app/src/app/(student)/student/page.tsx` (computed `true` only while some visible course still
  has Arabic touches). Proof: `curricula-registry.test.mts` ("the American curriculum has no Arabic
  name; National keeps its", "the American course prints no Arabic subject name"); `g10-prompts.test.mts`
  ("a cross-subject bridge FROM a Grade 10 lesson carries no Arabic either"); `national-prompts.test.mts`
  unchanged. Evidence recorded on the FR-4205 row of `traceability.md` (rev. 8).

### Answer 37 — fill the Grade 10 course, and build its internal review gate (decisions 56–58)

New requirements, FR-4501…FR-4509 (`specs/003-curriculum-tracks/spec.md`). **Ticked 2026-10-01 (tech-writer),
each against the code read in the worktree** — nothing was run in that pass; the suites last reported green in
the handoffs in `docs/WIP-g10-pilot/README.md` (pytest 644 passed, app `npm test` 0 failures, DB tests 20/20,
`tsc` clean). The FR rows stay OPEN until T387; the file:line evidence is on the FR-4501…FR-4509 rows of
`traceability.md`. The review-gate tests declare `@covers FR-2204`, not the new FRs.

- [x] T436 [US1] (WP-G, WP-P7) **The backlog itself** (FR-4501, FR-4507, FR-4509): a console view,
  `review_backlog` (or similar) holding one row per item without a human stamp, across book questions
  and corrections, orchestrator stem fixes, generated questions, widget questions and mapping claims
  (including AI-refused ones), misconceptions, objectives and prerequisite links, figure stand-ins
  (T442), and the gate decisions G1–G4 now reach on the AI checks' own recommendation during the
  fan-out (T443) — maths courses only (Prep-3 and G10); Social Studies, Arabic and sealed Quran/Hadith
  content never appear in it.
  **Built, read 2026-10-01**: the backlog is **derived, never stored** (`db/migrations/036-review-gate.sql` header, rollback
  `rollback/036-review-gate.down.sql`): `app/src/lib/review-gate.ts` (`ITEM_KINDS`: book question, generated question,
  widget question, mapping claim, misconception, worked example, objective, prerequisite link, figure stand-in, gate
  decision) and `review-gate-queries.ts` (`deriveAll`, `loadBacklog`; maths objectives only); the console page
  `app/src/app/(console)/review/page.console.tsx` with `components/console/{ReviewDesk,ReviewItemView}.tsx`; `/review` is
  `content-review` only (`lib/console-routes.ts`). Proof: `review-gate.test.mts`, `review-gate-db.test.mts`. **Not done:** the
  step checker's flag files (T447) are not yet read into the backlog.
- [x] T437 [US1] (WP-G) **Review verdicts** (FR-4502): approve / fix requested / reject, restricted to
  `content-review` holders (Samuel, Tamer, Kamil); reject stops a question reaching students without
  deleting it; fix requested changes nothing a student sees and is exportable with the item.
  **Built, read 2026-10-01**: `review-gate.ts` (`DECISIONS`, `canDecide`, `decisionEffect`, `planClaimApprove`,
  `planClaimReject`); `review-gate-queries.ts` (`nextFor`, `decide`, `fixList`); `app/src/app/api/console/review/route.console.ts`
  (`authorize({ role: "content-review" })`) and `review/fix-requests/route.console.ts` (the exportable fix list). Proof:
  `review-gate-db.test.mts` (approve signs; reject retires; a fix request leaves students unchanged and is exported).
- [x] T438 [US1] (WP-G) **Claim lock** (FR-4503): an item claimed by one reviewer is not handed to a
  second until released or decided; a stale claim (the reviewer navigates away) eventually releases.
  **Built, read 2026-10-01**: migration 036's `review_claims` (row-level security: an operator writes a claim only in their
  own name; another's is taken over only once expired) and `review-gate-queries.ts` (`claimItem`, `CLAIM_MINUTES = 10`,
  `releaseOtherClaims`, `activeClaims`). Proof: `review-gate-db.test.mts` ("two reviewers never get the same item", "racing for
  one item…").
- [x] T439 [US1] (WP-B, WP-G) **Append-only audit** (FR-4504): item, operator, when, verdict, note —
  never overwritten; a changed mind is a new row.
  **Built, read 2026-10-01**: migration 036's `review_decisions` — the trigger `review_decisions_append_only` refuses UPDATE and
  DELETE for every role, the INSERT policy admits a row only in the operator's own name, and the migration's verify block
  asserts both, plus that `ainext_app` holds no privilege on either table. Proof: `review-gate-db.test.mts` ("the record is
  append-only, written only in the operator's own name, and closed to students").
- [x] T440 [US1] (WP-G) **Backlog counts** (FR-4505): by kind, course, chapter and reviewer, on the
  console page the backlog lives on.
  **Built, read 2026-10-01**: `review-gate.ts` (`summarize` → `BacklogSummary`: by kind, by course and chapter, open by reason;
  `doneShare`), `review-gate-queries.ts` (`reviewerStats`, `overview`), shown on the `/review` page. Proof:
  `review-gate.test.mts`; the page was not browser-walked in this pass.
- [x] T441 [US1] (WP-G, WP-P7) **"Reviewed" means a human stamp only** (FR-4506, decision 54, answer
  33): an AI-only pass reads "AI-checked, awaiting human" in the console, never "reviewed"; no student
  surface says either word (unchanged from ADR-0019).
  **Built, read 2026-10-01**: `db/migrations/035-human-review-stamps.sql` (`ai_checked_by`, `ai_checked_at`, `hold_reason`,
  `review_note`; CHECK `questions_held_not_live`; rollback round-trips); `services/extraction/review_policy.py` and the loaders
  that stopped writing AI checks into `reviewed_by`; app `lib/review-gate.ts` (`stampKind`, `isHumanStamp`), `lib/provenance.ts`,
  `lib/content-admin.ts`, `(console)/content/page.console.tsx`. Applied to the pilot database only. Proof:
  `tests/test_review_policy.py`, `review-status-scan.test.mts`. Still to do: Prep 3 gets it "with its next release"; two stamp
  classifications await Samuel (README, students-full handoff).
- [x] T442 [US1] (WP-P4, WP-P7) **Book-image stand-ins** (FR-4508, decision 58d, answer 37d — TEMPORARY
  reversal of decision 50/answer 29 for students): where no native figure type exists yet (FR-4321),
  load the figure as `visuals.kind: "book_image"`, `stand_in: true`, instead of shipping the lesson
  without it; register each as a backlog item "needs native figure" (T436). Keep FR-4321's existing
  rule — a stand-in that would draw or reveal the question's own unknown or answer is withheld, same as
  today, and the lesson ships without it in that one case.
  **Built, read 2026-10-01**: `assemble_lesson_bundle.py` (`book_image` stand-ins, `book_picture_reveals`, hold reason
  `figure_reveals_answer`, `--no-book-pictures`), `schemas.py`, `coverage_report.py` (`book_pictures`); app
  `components/viz/{BookImage,Visual,VizCard,kind-meta}`, `render-viz-widget.tsx`, `lib/question-figures.ts` (`bookImageOf`);
  pictures in `app/public/book-figures/g10-math/`. Chapter 8 pilot database: 30 stand-ins, 9 held. Proof:
  `test_assemble_lesson_bundle.py`, `test_review_policy.py` (`BookPictures`), `question-figures.test.mts`. **Left:** the
  figure-gaps file's rule text still says "never a static book image"; the pictures directory holds ~420 files from another run.
- [x] T443 [US1] (WP-P2, WP-P3, WP-P4, WP-P5) **Gates G1–G5 auto-pass during the fan-out, each decision marked for Samuel in the console** (FR-4509,
  decision 58c, answer 37c; G5 and "for Samuel" added by decision 60, answer 39): `objectives.workflow.js` / `assemble_objectives.py` (G1, FR-4410),
  `lesson.workflow.js` / `assemble_lesson_bundle.py` (G2, FR-4302), the widget stage (G3, FR-4306 —
  unchanged, decision 47 already has this shape) and the misconceptions stage (G4, FR-4307) each
  proceed on their own AI checks' recommendation rather than wait for a human per chapter; every
  decision reached this way is written as an auto-passed backlog item (T436), not a human stamp.
  Automatic safety checks are NOT relaxed: broken maths, an answer that disagrees with the book
  (FR-4302's printed-answer/EPUB-solution/blind-resolve disagreement), and the drift guard
  (`parity_check.py`) still hold an item exactly as before. **G5 is covered too** (decision 60, answer 39, 2026-10-01): it auto-passes like G1–G4, each decision is
  marked for Samuel and only his account clears it, and passing deploys nothing.
  **Built, read 2026-10-01**: `services/extraction/auto_pass_gates.py` (one subcommand per gate, G1–G5, each writing an
  `ainext.gate-decision/1` record to `runs/<book>/gates/<g>-chNN.json`, signed "auto-pass G<n> (AI recommendation)"); app
  `lib/review-gate-records.ts`, `review-gate-files.ts`, `review-gate-queries.ts` (`isGateOwner`; `decide` refuses a gate decision
  unless it is Samuel's account) → backlog kind `gate_decision`. Chapter 8 records: `runs/g10-math/gates/{g3,g4,g5}-ch08.json`.
  The KaTeX `\0` control-space fix (`respace_latex`'s `_digit_escapes`, test added; Chapter 8's assembly byte-identical) removes the
  cause of the broken-maths refusal of chapters 9, 10 and 13; those chapters have not been re-loaded to confirm. Proof: `test_review_policy.py` (`AutoPassGates`), `test_assemble_lesson_bundle.py`, `review-gate-records.test.mts`.
  **Caveat:** both Chapter 8 dry runs predate the last `auto_pass_gates` rewrite and that fix and have not been re-run.

### Answers 38, 30 and 40 — the whole book, the step checker, a teaching item as parent (decisions 59, 51, 61)

Phase 9e, **added 2026-10-01** by the tech-writer. T444…T447 record code that was already built and was read
against the worktree for this pass; T448 is decided and **not built**.

- [x] T444 [US1] (WP-B, WP-P1) **The course outline store and its loader** (FR-4322, decision 59, answer 38):
  `db/migrations/037-course-outline.sql` (`course_outline`, a content table, no row-level security, SELECT for
  `ainext_app` and `ainext_operator`, writes only by `ainext_maint`; rollback `rollback/037-course-outline.down.sql`)
  and `services/extraction/load_course_outline.py` (`uv run load_course_outline.py --book g10-math`, `--dry-run`,
  `--check`; built from the G0 manifest, refusing an ungated or another course's manifest). Proof:
  `services/extraction/tests/test_course_outline.py`.
- [x] T445 [US1] (WP-C, WP-E) **The outline's rules, reads and the server refusal** (FR-4322, FR-4323, FR-4324, FR-4006):
  `app/src/lib/course-outline.ts` (the rules, pure) and `course-outline-queries.ts` (the reads, only for courses already
  gated); `app/src/lib/lesson.ts` (`resolveLessonLos` refuses a listed-but-unprepared slug; `isUnpreparedLesson`);
  `app/src/app/api/ask/route.ts` (refused before a session, a turn count or a model call; `404 not_found`). Proof:
  `course-outline.test.mts`, `course-outline-guard.test.mts`, `catalog-gate.test.mts`.
- [x] T446 [US1] (WP-F, WP-C) **The outline on the student surfaces** (FR-4323, FR-4325, FR-4326, FR-4327, FR-4206):
  `components/student/LessonCheckIn.tsx` (the whole-book list open by default, "Being prepared" entries that link nowhere),
  `components/student/SubjectHome.tsx` ("{ready} of {total} lessons ready"), `components/spine/SpineExplorer.tsx` (the
  "Being prepared" strip), `lib/subject-queries.ts`, `lib/queries.ts`, `app/(student)/student/page.tsx`. Proof:
  `whole-book-render.test.mts` (National renders the same bytes), `course-outline.test.mts`. **Not covered:** no test
  renders the skill map's strip itself.
- [x] T447 [US2] (WP-P2, WP-PDOC) **The step-level working checker** (FR-4411, decision 51, answer 30):
  `services/extraction/working_check.py`, `runbook/working-check.workflow.js` (prompts `sw-v1`),
  `tests/test_working_check.py`; Chapter 8 run (`wf_957393ec-d74`): 192 solutions, 21 flagged, metered $31.0, flags in
  `runs/g10-math/working-check/ch08.flags.json`. **Open under this task:** the console does not read the flag files into
  the backlog (T436); the 25 flags are unclassified; calibration `sw-v2` is in progress and the cost is 3–5× the
  estimate (README handoff).
- [ ] T448 [US1] (WP-P6, WP-P4, WP-B, WP-G) **A book teaching item as a family's parent** (FR-4304, proposed FR-1101
  wording; decision 61, answer 40) — **code in progress, not built**; a family-parent agent works from the plan in
  `docs/WIP-g10-pilot/README.md` ("Handoff — family-parent agent (answer 40)"): migration 038 (`questions.parent_kind`,
  the foreign key replaced by a trigger), `families/spec.py`, `generate_questions.py`, `load_generated_questions.py`, the review
  desk's "Generated from" line (`review-gate-queries.ts`, `ReviewItemView.tsx`). Needed by lo:g10m8s1-1-1 (run
  `001-s6-author-ch08-s111`). Tick it when the migration is applied to a scratch database, its tests pass and 001's
  FR-1101 row is stamped.

---

## Dependencies & execution order

```text
Phase 1 (T301–T303)
   │
   ├──► Phase 2 Foundational (WP-A T304–T311, WP-B T312–T313) ──┐
   │                                                             │
   └──► Phase 4 Pipeline (WP-P1…P7, WP-PDOC) — parallel ─────────┤
                                                                 ▼
        Phase 3 US1-A: readers T314–T318 ──► marker T319 ──► load path T324–T330
                       prompts T320–T323 (after T305)
                                                                 │
        Phase 5 US1-B: T351…T367 (needs Phase 4 + T318 + T325) ◄─┘
        Phase 6 US3 (after Phase 2; T369 after T312)
        Phase 7 US4 (after Phase 2; T375 after T308 + T374)
        Phase 8 US5 (after T312 + T380)
        Phase 9 (T384 after every importer moved; T392–T393 last)
        Phase 9c: T434 (after T368, T369 — reverses their "offered ≥ 2" gate) — DONE
        Phase 9d: T435 (after T431 — widens "English-only" to "no Arabic anywhere") — DONE
                  T436–T443 (after Phase 4 — the fan-out and its backlog; T442 after T355/T356's
                  figure-gap work, T443 after the pilot's own G1–G4 passes for Chapter 8)
        Phase 9e: T444 (after G0's manifest and migration 037) → T445 → T446; T447 (after the Chapter 8 bundle exists);
                  T448 (needs migration 038 and the loader change; blocks run 001 and lo:g10m8s1-1-1's family)
```

- **G0 → the pipeline's lesson unit**: T402 and T403 apply G0's 65 lessons before any S1 run (T358). S0b (T418–T421) comes before S1–S3 read any maths.
- **Grouping**: T400 (store) → T401, T404 (write it) → T405 (pure rules) → T406–T411 (readers and surfaces). A National course must read the same before and after.
- **Marker**: T413 (Samuel picks the approach) → T414 → T415, T416 → T417. S3's answer typing (T337) must write the marker's answer spec.
- **Catalogue (B19)**: T342 and T422 → T423 (CI proof) → merge. It touches live Prep-3 content.
- **Hard ordering from the privacy review**: T314–T318 (and T319 in the running image) come **before**
  any G10 load into a shared database: T365, T366, T367. Private scratch databases (T353, T360) are
  exempt.
- **WP-A → WP-E**: T320 and T321 wait on T305, because both touch the facts `courses.ts` carries.
  WP-E edits only the G10 entry's values, after WP-A has handed the file over.
- **WP-B → WP-D, WP-G**: T369 and T381 need 033's function and grants (T312).
- **US3–US5 are independent of each other** once Phase 2 is done, so three agents can take them at once.
- **Launch (T392)** needs everything above, and T389 if Samuel wants the constitution amended before
  the release.

## Parallel examples

```text
# Right after Phase 1 — five agents, disjoint files:
WP-A: T304 → T305 → T306 → T307 → T308 → T309, then T310/T311
WP-B: T312 → T313
WP-P1: T331 → T332 → T333        WP-P3: T336 → T337        WP-P6: T343 → T344
# After Phase 2 — four more:
WP-C: T314, T315, T316, T317 (all [P])      WP-H: T324, T326, T327, T328 (all [P]) → T325 → T329
WP-E: T320 → T321 → T322 → T323             WP-D: T368 → T369 → T370
```

## Implementation strategy

1. **MVP = US1**: Phases 1–3, then 5. The G10 course is in production, complete and hidden, and a
   test account can study it through an exception. That alone is Samuel's first ask ("digest this
   book"). With decision 6's rules it is also nearly enough to launch grade 10, because the existing
   (course, grade) rule plus curriculum scoping already routes grade-10 sign-ups to it.
2. **Then US3** (sign-up and scoping), then **US4** (console), then **US5** (operator change). Each is
   independently testable and shippable.
3. **Launch** (T392) only after US3 and US4. Sign-up must store the curriculum, and the console must
   show it, before a real grade-10 family arrives.
