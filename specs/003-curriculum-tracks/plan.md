# Implementation Plan: Curriculum Tracks and the Grade 10 American Mathematics Course

**Feature**: `003-curriculum-tracks` | **Branch**: `feat/003-curriculum-tracks-g10-american-math` (from
`main` at `v0.9.2`) | **Date**: 2026-09-25 | **Spec**: [spec.md](./spec.md) (rev. 3)
**Decisions**: [decisions.md](./decisions.md). Samuel, 2026-09-25: *"I would take your
recommendations"*, given as seventeen numbered decisions plus five adopted recommendations (A–E).
Then, the same day, *"ok for all"*: A–E confirmed, G0 passed at 65 lessons, and decisions #18–#22
(book-section grouping, EPUB solutions, an expression marker, S0b maths transcription, the
catalogue's single source).
**Research**: [research.md](./research.md) (app architect) · `docs/specs/extraction-pipeline.md` v2
(pipeline; §9 build list B1–B21, with each item's state) · `services/extraction/runbook/g10-s0-report.md`
(the Grade 10 S0 report) · [privacy-review.md](./privacy-review.md) (security-privacy-officer)
**ADRs**: [0024](../../docs/decisions/0024-curriculum-as-a-visibility-dimension.md) (accepted
2026-09-25, not committed), plus 2026-09-25 notes on [0005](../../docs/decisions/0005-extraction-pipeline.md),
[0019](../../docs/decisions/0019-serve-the-whole-maths-bank.md) and
[0020](../../docs/decisions/0020-mastery-gated-lesson-progression.md)
**Constitution**: **v3.3.0**. An amendment to v3.4.0 is proposed in
[constitution-amendment-proposal.md](./constitution-amendment-proposal.md) and **not applied**.
**Status**: rev. 2 of the plan (2026-09-25). Being built on the branch by other agents; **not committed**.

## Summary

Make curriculum a dimension of what a student sees, and deliver the first non-National course.

- **Curricula**: an app registry holds National (`eg-national-en`) and American (`us-american-en`).
- **Courses**: a new course registry, split from the subject registry, gives every course exactly one
  curriculum.
- **Students**: the existing `students.curriculum_system` column becomes load-bearing.
- **The gate**: it stays keyed by (course, grade). It gains one rule, "not her curriculum, not
  visible", which an exception overrides and the kill switch does not.
- **Scope**: one per-request student scope feeds every student reader, including the four that are
  ungated today. The privacy review found that three of those would name the new book to every
  student the moment it is loaded, so scoping them is a **precondition of any load**.
- **Sign-up**: asks for a curriculum only when a grade has live courses in two or more curricula. A
  first Google sign-in gets a once-only grade-and-curriculum step.
- **Changing a curriculum** is console-only. Migration 033 makes that a database fact.
- **The console**: groups `/courses` by curriculum and splits the Overview by course.

The Grade 10 book (Siyavula *Everything Maths* Grade 10, written for South Africa's CAPS curriculum)
goes through the v2 extraction line:
- objectives derived from the book (pipeline policy, ADR-0005 amendment, not an FR);
- maths images transcribed first (S0b): two blind passes, accepted by hash or agreement (#21);
- canonical solutions taken from the book, its printed worked examples and its **EPUB worked
  solutions**, blind re-solved against the printed answer and the EPUB solution (#19);
- declarative generated families;
- widget questions for every chapter;
- a fail-closed misconception catalogue;
- G0 fixed at **65 lessons**, and each lesson carries its book provenance.

Two app capabilities come with it, for every course:
- **book-section grouping** (#18): a split section's parts are taught together, recommended and
  progressed as one unit, scored with a roll-up, and shown as one group;
- a **maths-expression marker** (#20) for the 1,111 answers the app cannot mark today.

The maths misconception catalogue gets one source of truth (#22). That is live Prep-3 content, so it
goes through tests and a CI proof.

It reaches production through a new, manually started **"Load a course"** action: gated on that
course's presence, backed up and verified first, additive only, and never part of a deploy. At launch
it is the only course live for grade 10. It renders Play, probing is off for it, and ADR-0019's "all
content live" covers it once switched on.

## Technical Context

**Language/Version**: TypeScript (Next.js App Router, `app/`); Python 3.12 under `uv`
(`services/extraction/`); Bash and GitHub Actions YAML (`deploy/`, `.github/workflows/`); SQL
(Postgres 16).
**Primary Dependencies**: unchanged. There is no new library; the registries are plain modules. The
pipeline stays on Claude Workflow (decisions.md C).
**Storage**: Postgres, one database per stack. Migration **033** only; migration 023's tables are
untouched.
**Testing**: `node --test` suites (`*.test.mts`, `@covers FR-…`); source-scan guard tests; pytest for
the pipeline; `scripts/ci-migrations.sh all` (fresh ×3, upgrade from v0.9.2, rollback onto v0.9.2);
the prompt capture harness (`app/scripts/capture-prompts.mts`) for byte-identity; `selfcheck_arabic.py`
and `audit_arabic.py`; `./scripts/traceability.py --check`.
**Target Platform**: the OCI box (noor.reletix.com + admin-noor.reletix.com); iPad Safari and desktop
for the student product.
**Project Type**: web application (student build + console build of one codebase) plus an offline
ingest pipeline.
**Performance Goals**: `resolveStudentScope` makes one read and one graph walk per request, the same
queries the gate makes today. There is no new per-request query.
**Constraints**:
- Prep-3 and other National prompts stay byte-identical (FR-4206).
- No CHECK on curriculum values.
- Migration 023 is untouched.
- The load is never in a deploy.
- Readers are scoped before any load.
**Scale/Scope**: 2 curricula, 4 courses. About 19 importers of the subject→course lookup (research
§7). The G10 book is 14 chapters, about 62 lessons and about 170 objectives. Estimated effort is
≈ 8–11 agent-days of app work plus the pipeline B-items and the ingest run.

## Constitution Check (v3.3.0) — gate before build

| Principle | Status | How |
|---|---|---|
| I Architecture authority | ✅ | Samuel decided (decisions.md); ADR-0024 drafted for his read; A–E flagged |
| II Grounded teaching | ✅ | FR-4302 (solutions stored, derived to the printed answer, blind re-solve); FR-4205 (this book's pages); scoped readers (A3) |
| III Review gate | ✅ | ADR-0019 note (decision 9); stamps kept honest (pipeline-handoff "Status at export"); 10% sample at G3 |
| IV Sacred text | ✅ | Dormant for maths; the pipeline's sacred-content lane unchanged (FR-4405) |
| V Bilingual | ✅ | English LTR; `labelAr` in both registries; nothing Arabic removed |
| VI Cost | ✅ | Per-stage pipeline cost ledger (B16); per-student instrumentation unchanged |
| VII Minors' data | ✅ | Curriculum sits with grade; asked only on a real choice; first-party only (FR-4016); console-only by privilege (FR-4017); PATCH proposed |
| VIII Non-goals | ✅ | None touched |
| IX Registry + prompt freeze | ✅ | Registry split (A1); byte-identity capture proof (A7); G10 prompts under the ADR-0020 note |
| X Operational safety | ✅ with wording | Load action: manual, verified backup, additive, presence-gated (A8); `refresh-content` retargeted to noor; PATCH proposed to name it |
| XI Solution integrity | ✅ | Drift guard per course (B10); environment on every new row; no pooling across courses (FR-4104) |
| XII Design system | ✅ | Every new surface on Play tokens; grade 10 = Play (ADR-0017 switch off) |
| Additional constraints | ⚠ proposal | "Curriculum truth" per course; per-course content constants — **proposal, not applied**. Build does not wait for it; the release does (T389) |

### Complexity tracking

| Addition | Why needed | Simpler alternative rejected because |
|---|---|---|
| A second manual content workflow (`load-course`) | decision 17; `refresh-content` replaces a subtree, and a new course needs an add-only path | a deploy step writes data from a code deploy (X); `refresh-content` alone cannot refuse a present course by design |
| An append-only curriculum history table | FR-4012 "every change", and FR-2708's lesson that current-value columns lose history | research D6's two columns keep only the latest change |
| A `SECURITY DEFINER` function for the Google step | FR-4014/FR-4017: once-only enforced by the database | a column grant to `ainext_app` cannot say "once" (privacy review F10) |

## Architecture — decided, with the file each piece lives in

### A1. Registries: curricula, courses, subjects (ADR-0024; decisions 2, 3, E)

- New `lib/curricula.ts` and `lib/courses.ts` ([data-model.md](./data-model.md) §1). `SubjectDef.courseId`
  is removed, so `lib/subjects.ts` keeps the teaching contract only.
- `COURSE_RANK` replaces `SUBJECT_RANK`, which stays as an alias for one release. `TERM_RANK` is
  generated from `CourseDef.terms`.
- A registry cross-check test compares the seed bundles and the book configs against `COURSES`.
- Stale "no requirement covers this" headers in `lib/catalog.ts`, `lib/catalog-queries.ts` and
  `(console)/courses/page.console.tsx` are corrected in the same work (research §6.3).

### A2. The gate and the student scope (FR-4002…FR-4006, FR-4009, FR-4015)

[contracts/registry-and-gate.md](./contracts/registry-and-gate.md):
- the five-step `isCourseVisible`;
- the pure functions `offeredCurricula` and `resolveInitialCurriculum`;
- `resolveStudentScope`, with `visibleCoursesFor` and `visibleGraphFor` as wrappers;
- the kill switch suspends rules, not scoping.

### A3. Readers (FR-4006, FR-4202) — four are preconditions of any load

The auto-correct readers need no change once A2 lands: lesson catalogue, lesson data gating,
attempts, practice plan gating and progression. Six readers need changes:

| Reader | File | Change | Privacy review |
|---|---|---|---|
| **Ask context's source-book list** | `lib/ask.ts` (`docRes`, the source line) | list only books behind visible courses (`scope.doc`); syllabus line from the course | **MUST, §5.1 — precondition of any load** |
| **Progress page** | `lib/dashboard.ts`, `app/api/dashboard/route.ts` | gate through the scope; `COURSE_RANK` | **MUST, §5.2** |
| **Home** | `lib/queries.ts` `getHomeStats` | counts and book scoped; deterministic book pick | **MUST, §5.3** |
| **Figures by id** | `app/api/visuals/route.ts`, `lib/visuals.ts` | gate by the figure's objective | SHOULD, §5.4; done in the same package |
| Skill map | `lib/queries.ts`, `lib/spine-lo-query.ts`, `components/spine/SpineExplorer.tsx` | picker by course; the course's own book, not `LIMIT 1` | — |
| Subject home, landing, check-in | `lib/subject-queries.ts`, `lib/student-landing.ts`, `(student)/student/page.tsx`, `components/student/{SubjectHome,LessonCheckIn}.tsx` | roll up by course; `scope.courseForSubject`; per-course term model | — |

**Order that matters**: the first four ship, pass `student-scope-guard.test.mts`, and are in the
running image (the image label in [contracts/load-course.md](./contracts/load-course.md)) **before**
the G10 book is loaded into any shared database, rehearsal copies included (FR-4202, F13). A private
scratch database that no other student's traffic touches is exempt, and the pipeline's S10
validation uses one.

### A4. Sign-up and the Google step (FR-4005, FR-4014, FR-4016, FR-4017)

[contracts/student-api.md](./contracts/student-api.md):
- the sign-up question, asked only when two or more curricula are offered;
- `curriculum_required`, `invalid_curriculum`;
- the `onboarding_pending` redirect and 403;
- `/welcome` and `POST /api/auth/onboarding`, through the once-only definer function (409 on a second
  call);
- `account_created` gains curriculum fields, first-party only;
- `ga-curriculum-guard.test.mts`.

### A5. Console (FR-4101…FR-4105, FR-4010…FR-4012, FR-4212)

[contracts/console.md](./contracts/console.md):
- `/courses` in curriculum sections, with the per-grade offered line and the last-live-course
  headcount (count only);
- Student 360: curriculum fact, source, flags, history and editor, with access reasons that label
  out-of-curriculum exceptions;
- the new `student-data` route;
- the students-list column, excluded from the `cost-billing` projection;
- Overview cohorts per course;
- Content, Cost and Feedback labelled by course, with Cost aggregate-only;
- `/pipeline` and `/gallery` in `COURSE_RANK` order;
- the teaching page names the courses probing reaches.

### A6. Migration 033 (FR-4003, FR-4012, FR-4014, FR-4017)

[data-model.md](./data-model.md) §2, in one file:
- `students.curriculum_source` and `students.onboarding_pending`;
- `student_curriculum_changes` (append-only, forced RLS);
- `complete_student_onboarding()` (`SECURITY DEFINER`, once-only);
- `REVOKE UPDATE ON students FROM ainext_app`, followed by `GRANT UPDATE (design_variant)` (a
  column-level revoke cannot narrow 017's table-wide grant);
- `GRANT UPDATE (curriculum_system, curriculum_source)` to `ainext_operator`;
- a `DO $verify$` block asserting each privilege.

It is idempotent: every statement is `IF NOT EXISTS`, `CREATE OR REPLACE`, or a grant that is safe to
repeat. It sorts after 017 and 023, so 017's re-run re-grants and 033 narrows again, every deploy.
The rollback is in data-model §4. CI proves fresh ×3, upgrade from v0.9.2 and rollback onto v0.9.2.
After rollback, v0.9.2's 017 restores the table-wide grant, which is what v0.9.2 expects.

### A7. Per-course teaching facts and the G10 prompts (FR-4205, FR-4206, FR-4212; ADR-0020 note)

- `bookName`, `syllabusLine`, `fallbackVizId`, `lessonTitles` and `isGeoLesson` move from the maths
  prompt kit (`lib/lesson.ts`) to `CourseDef`. `LESSON_PROMPTS` stays keyed by subject and reads the
  course's facts.
- **Prep-3 keeps the exact string "Egyptian ministry textbook"** and its fallback figure. The whole
  capture set before and after is **byte-identical** for every existing path.
- G10 capture files are new, and refer to "this book" and its pages.
- `lib/socratic-probing.ts`: `PROBING_COURSE_ID` becomes `CourseDef.probing`, so probing stays on for
  Prep-3 and off for G10.
- The review-mode widget moment offers only the lesson's own unit's widgets for G10 (FR-1209). For
  Prep-3 it is untouched, to stay byte-identical.

### A8. Content paths to production (FR-4207…FR-4210; decision 17)

[contracts/load-course.md](./contracts/load-course.md):
- `load-course.yml` and `deploy/load-course.sh`: presence by the course's own id, preconditions
  including the scoped-readers image label, verified backup, additive load, and a post-flight drift guard
  for every course;
- `refresh-content` retargeted to noor, refusing silent student-data loss;
- the `ci-cd.yml` first-boot gates changed to specific course ids;
- the misconception sync per loaded book;
- `local-dev.sh` loads each course if absent;
- a runbook section in `deploy/DEPLOY-MVP1.md`.

### A9. The v2 extraction line (FR-4301…FR-4310, FR-4401…FR-4409; ADR-0005 amendment)

Build list **B1–B21** (`docs/specs/extraction-pipeline.md` §9, which marks each item's state),
split into eight packages with disjoint files (tasks.md phase 4, WP-P1…WP-P8). Code for B1, B9, B10,
B16, B18 and B20 is on the branch, unverified. Decisions fixed by Samuel:
- derived objectives with at least two kinds of evidence (#12);
- **S0b**: the EPUB's 8,561 unique equation images transcribed by two blind passes. Accepted on
  `md5(latex) == filename` or on agreement, and cross-checked against the PDF text layer; the rest are
  queued for G0b (#21);
- the **revised edition check**: build markers, plus the section and media codes;
- **canonical solutions from the EPUB** (`book_worked_epub`), with three-way verification (#19,
  amending #13);
- `teacher_only` blocks dropped at S2 (#21);
- answer typing for the marker, with multiple choice only where natural and proofs and sketches kept
  as worked examples (#20, amending #14);
- **B19**: the loaded catalogue is the single source, with six entries added and no id renamed
  (#22);
- notation normalised, contexts kept (#15);
- declarative families (#16);
- widget-gap list for Samuel's OK before any new kind is built (#11);
- one numbered section is one lesson (B);
- the pipeline stays on Workflow (C).

`docs/specs/extraction-pipeline.md` §10 records each decision as taken, and the runbook is current
(T350, done 2026-09-25). The revised one-time cost is about **$210–230** for the book.

### A12. Book sections and their parts (FR-4311…FR-4319; decision 18; ADR-0020 note)

- **Data.** Each lesson's book provenance comes from the manifest and the bundles:
  - the printed section number(s) and title;
  - "part *n* of *m*" for a split part;
  - every covered section for a merged lesson;
  - a chapter-introduction flag.

  It is stored in a small **content** table (proposed: migration 034 `course_lessons`,
  [data-model.md](./data-model.md) §2). The National courses get one row per lesson with one section
  each, which is what makes the rule hold for every curriculum with no change in what they show.
- **Rules**, pure, in a new `lib/book-sections.ts`:
  - section key and part order;
  - the roll-up "*k* of *m*";
  - "may the place move past this section?";
  - the derived part *n*−1 → *n* prerequisites. These are **derived at read time and never written
    into `graph_edges`**, so the book's own edges stay exactly the book's.
- **Readers**:
  - catalogue order keeps parts consecutive;
  - progression and the practice plan treat a section as one unit (FR-4313, extending FR-3202);
  - the subject home and progress page show the roll-up;
  - the skill map groups the parts;
  - the Ask context ranks siblings first;
  - lesson headers show the printed number;
  - the console reports per section.
- **Invariant**: a course with no split or merged section reads, renders and prompts exactly as before.
  That is proven by the capture harness and the catalogue-order tests.

### A13. The maths-expression marker (FR-4320; decision 20)

[contracts/answer-marker.md](./contracts/answer-marker.md).
- A new, pure, server-side `lib/answer-marker.ts`, called by `api/attempts/route.ts` **only** for
  questions whose stored answer type is a maths expression. Numbers and choices keep today's `grade()`
  path byte for byte.
- The answer spec travels in the question's existing `choices` JSON (`{"marker": {...}}`), the same
  way widgets carry their spec (ADR-0009). **No `question_type` CHECK is widened**, which avoids the
  migration re-run pattern that caused the 2026-09-23 outage (`886b302`).
- **The library or approach is Samuel's call at T413.** The candidates are in the contract. The
  evaluation runs all 1,111 Grade 10 expression answers plus a wrong-form set.
- **Form checks** (factorised, simplest, subject of a formula) are part of the marker, not an
  afterthought. Equivalence alone would mark an unfactorised answer to "factorise" as correct.
- The student's input is a typed maths field in the question card, rendered left to right in any
  direction, in Play tokens.

### A10. Ingest run and launch sequence (US1, FR-4211)

**Human gates**: G0 manifest (**passed 2026-09-25, 65 lessons**) → G0b maths queue → G1 objectives,
per chapter → G2 solutions → G3 family sample → G4 refutations → G5 go / no-go.

0. **S0b** on the whole book, then G0b.

1. **Pilot**: Chapter 8, analytical geometry, end to end (pipeline §7) on a private scratch database.
2. **Fan out** to all 14 chapters.
3. **G5**.
4. **Promote per the ADR-0019 note, and export.**
5. **Local load**, after A3 is in the build.
6. **Load-a-course dry run**, then a **rehearsal on a copy of production**.
7. **Real load.**
8. **Operator rules**: G10 live for grade 10; Prep-3 maths and every other National course **not**
   live for grade 10 (FR-4211). Any grade-10 student stored as National is checked and moved by an
   operator (spec Edge Cases).
9. **Walk a grade-10 account** on iPad Safari.

### A11. Ids — pinned here, used by both sides

[contracts/pipeline-handoff.md](./contracts/pipeline-handoff.md):

| Thing | Value |
|---|---|
| Course | `course:us-g10-math-en` |
| Curriculum | `us-american-en` |
| Program node | `program:us-american-en` |
| Book key | `g10-math` |
| Slugs | `g10m<ch>s<sec>-<part>` |
| Modules | `module:g10m-cNN` |

The pipeline config's `course:g10-math-en` placeholder becomes `course:us-g10-math-en`.

## Phasing

| Phase | What | Gate to leave it |
|---|---|---|
| **0 — Foundations** | A1, A2, A6 (registries, gate, scope, 033) | `tsc`; guard tests green; `ci-migrations.sh all` green; Prep-3 capture byte-identical |
| **1 — Load safety** | A3's four MUST readers, the marker, A8's action and `refresh-content` retarget | `student-scope-guard` green with an **empty** allow-list for the four; load dry-run on a scratch copy |
| **2 — Pipeline v2** | A9 (B1–B21), in parallel with phases 0–1 (disjoint files); B19 through its CI proof | pytest + self-check 100% + Arabic audit green; S0b queue empty; Chapter 8 pilot through S11 on scratch |
| **3 — Student and console surfaces** | A3 rest, A4, A5, A7, **A12 (grouping), A13 (marker)** | acceptance scenarios US3–US7; capture byte-identity; matrix test; attempts replay identical |
| **4 — Ingest run** | A10 steps 1–5 | G0…G5 signed; coverage GREEN or signed; drift constant recorded |
| **5 — Launch** | A10 steps 6–9 | SC-201…SC-213; traceability rows moved; Samuel's go |

## Migrations

| # | File | Idempotent | Rollback | Notes |
|---|---|---|---|---|
| 033 | `db/migrations/033-curriculum-tracks.sql` | yes | `rollback/033-curriculum-tracks.down.sql` | No change to 023's tables; no CHECK on curriculum values; `curriculum_source` has a closed two-value CHECK that will never widen |
| 034 *(proposed)* | `db/migrations/034-book-sections.sql` | yes | `rollback/034-book-sections.down.sql` | A content table of lessons with book provenance (A12). No RLS; loader-written. It widens no existing CHECK |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| The Ask context names the G10 book to every student once it is loaded anywhere shared (privacy review §5.1) | certain without A3 | A3 is phase 1, and the load script refuses without the image label (T319, T325) |
| 033's narrower grant breaks an app write to `students` nobody listed | low; one writer found | `curriculum-privilege.test.mts` scans `UPDATE students SET` columns against 033's list |
| Prep-3 prompts drift while facts move to `CourseDef` | medium | full capture set byte-identical before merge (Principle IX); a golden check in CI |
| Nineteen subject→course importers; one missed means a 404 or a merged list | medium | `course-literal-guard` and `student-scope-guard` make a miss a test failure |
| G1 (objectives) and G2 (solutions) need hours of Samuel's time across 14 chapters | high | the Chapter 8 pilot first; per-chapter batches; review pages (B5, B17) |
| New widget kinds wait on Samuel's OK and are frontend work | medium | the gap list goes early (T355); chapters without an approved kind are listed as gaps, and FR-4306 allows the gap list |
| A code rollback after launch shows every course live for grade 10 to every grade-10 student | low | ADR-0024 Consequences: hide the American course or turn the gate on first |
| `grade=10` on anonymous analytics acts as a curriculum flag (privacy review F5) | latent (analytics unconfigured) | option (b) **confirmed 2026-09-25**: analytics stay unconfigured until the cohort is larger |
| The marker marks an equivalent answer in the wrong form correct, or rejects a right one | medium | form checks in the contract; the full Grade 10 answer set plus wrong-form negatives as tests; a replay proves existing marking unchanged (SC-212) |
| A maths transcription is wrong and agreed by both passes | low–medium | the PDF text-layer cross-check; the hash oracle where it applies; the three-way check at S3 catches a wrong solution line |
| B19 changes live Prep-3 content | medium | ids never renamed; tests; the CI proof (T423) and a local rehearsal (T424) before merge |
| Grouping changes what a National student sees | low | National lessons are one section each; capture and catalogue-order proofs require identity |
| The book's licence terms (CC BY-ND) and derived content | out of scope | routed to Samuel's team (decisions.md); the design does not depend on it |

## Project Structure

### Documentation (this feature)

```text
specs/003-curriculum-tracks/
├── spec.md                              # rev. 2
├── decisions.md                         # Samuel's 17 decisions + A–E
├── research.md                          # app architect (Phase 0)
├── privacy-review.md                    # security-privacy-officer
├── plan.md                              # this file
├── data-model.md                        # Phase 1
├── contracts/
│   ├── registry-and-gate.md
│   ├── student-api.md
│   ├── console.md
│   ├── load-course.md
│   ├── pipeline-handoff.md
│   └── answer-marker.md                 # rev. 2 of the plan
├── quickstart.md                        # Phase 1
├── tasks.md                             # Phase 2
├── traceability.md                      # gated by scripts/traceability.py
├── constitution-amendment-proposal.md   # not applied
└── checklists/requirements.md
docs/decisions/0024-curriculum-as-a-visibility-dimension.md   # + notes on 0005, 0018, 0019, 0020
```

### Source code (real paths; new files marked +)

```text
app/src/lib/          curricula.ts+ courses.ts+ book-sections.ts+ answer-marker.ts+ subjects.ts catalog.ts catalog-queries.ts
                      progression.ts progression-db.ts spine-layout.ts
                      module-order.ts module-term.ts lesson.ts ask.ts socratic-probing.ts
                      dashboard.ts queries.ts visuals.ts spine-lo-query.ts subject-queries.ts
                      student-landing.ts student-context.ts console-queries.ts overview-queries.ts
                      content-admin.ts pipeline-queries.ts console-routes.ts auth/google.ts auth/principal.ts
app/src/app/          (auth)/signup/page.student.tsx (auth)/welcome/page.student.tsx+
                      api/auth/{signup,onboarding+,google/callback}/route.ts api/dashboard/route.ts
                      api/visuals/route.ts (student)/student/page.tsx layout.tsx
                      (console)/{courses,students/[id],content,cost,feedback,teaching}/…
                      api/console/{courses,students/[id]/courses,students/[id]/curriculum+}/route.console.ts
app/src/components/   auth/SignupForm.tsx auth/OnboardingForm.tsx+ console/CourseAvailabilityGrid.tsx
                      console/CourseAccessEditor.tsx console/CurriculumEditor.tsx+ spine/SpineExplorer.tsx
                      student/{SubjectHome,LessonCheckIn}.tsx
db/migrations/        033-curriculum-tracks.sql+  rollback/033-curriculum-tracks.down.sql+  034-book-sections.sql+ (proposed)
app/src/components/chat/  ChatQuestionCard.tsx MathAnswerInput.tsx+
deploy/               load-course.sh+ refresh-content.sh DEPLOY-MVP1.md
.github/workflows/    load-course.yml+ refresh-content.yml ci-cd.yml
scripts/              local-dev.sh course-gating.sh traceability.py
services/extraction/  books/<g10 config>+ book_config.py+ source_adapter.py+ build_manifest.py+
                      assemble_objectives.py+ assemble_lesson_bundle.py+ assemble_misconceptions.py+
                      coverage_report.py+ meter_run.py+ schemas.py load_seed.py parity_check.py
                      generate_questions.py generate_widget_questions.py export_generated_content.py
                      load_generated_questions.py load_misconceptions.py render_review_page.py
                      merge_final.py assemble_fullbook.py runbook/*.workflow.js
                      runbook/transcribe-maths.workflow.js+ assemble_maths.py+ seed/generated/misconceptions.json
```

**Structure decision**: nothing new at the top level. The feature lives in the existing app, migration,
deploy and pipeline trees. The only new directories are the per-book trees under
`services/extraction/` (`books/`, `seed/g10-math/`, `seed/generated/g10-math/`, `runs/g10-math/`,
`objectives/g10-math/`, `coverage/`).

## Post-design constitution re-check

The design adds no violation. **X** gains a second manual path that is narrower than the one it
names, with the wording proposed. **VII** gains database enforcement it did not have for any column
before. **IX**'s byte-identity proof is a merge gate. **Additional constraints** stay a proposal
until Samuel approves it; the release, not the build, waits on it (T389).

## Agent context

The coordinating session repointed `CLAUDE.md`'s plan reference to this file on 2026-09-25. This
workstream did not edit `CLAUDE.md`.

## Open for Samuel

Nothing blocks the build. Three decisions are due at their gates:
1. **T413**: the expression marker's library or approach, proposed with its test results.
2. **T388**: committing ADR-0024 and the notes. The wording was accepted on 2026-09-25 ("ok for all").
3. **T389**: the constitution amendment. "Ok for all" answered the written documents, but this plan
   does not treat it as approval to edit the constitution. That needs his explicit word.
