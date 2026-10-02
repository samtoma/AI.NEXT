# 003 — Curriculum tracks: research and design options

**Status**: Research and options for Samuel. **Nothing here is decided.** Every recommendation is a
proposal (constitution I). When Samuel decides, the decision goes into an ADR (next free number:
ADR-0024), and the requirements go into `spec.md` beside this file.
**Branch**: `feat/003-curriculum-tracks-g10-american-math` (from `main` at v0.9.2), uncommitted.
**Author**: app architect (backend), 2026-09-25.
**Scope**: the app, the database and the deploy path. The book's extraction is covered by
`services/extraction/**` and `docs/specs/extraction-pipeline.md` (other agents). §8 lists what this
design needs from that work.

---

## 0. Summary

Samuel, 2026-09-25 (verbatim):

> "When the user sign up for grade 10, they can have at the beginning choose: American, National,
> etc.. as much as we add Curriculum, and consider that in the console, to choose which subject for
> which grade, should be done also per curriculum."

The first new curriculum is "Grade 10 American Curriculum, Math", from Siyavula *Everything Maths*
Grade 10. The three Egyptian Prep-3 books (maths, Social Studies, Arabic) are "National".

**What the code shows:**

1. **The student's curriculum already has a column.** `students.curriculum_system TEXT NOT NULL
   DEFAULT 'eg-national-en'` has existed since migration 009 (line 100). It has no CHECK constraint.
   `getStudentProfile` reads it and the console's Student 360 prints it, but nothing decides
   anything from it. Every existing student is therefore already "National". FR-302 already
   requires the student model to hold a "curriculum system".
2. **Grade 10 is already a valid grade** (`lib/profile.ts:43`, `"7"…"12"`). The course gate is
   keyed by (course, grade) (migration 023). What breaks is everything that assumes **one course
   per subject**.
3. **The subject registry maps each subject to exactly one course** (`lib/subjects.ts:129`,
   `BY_SPINE_KEY` at `:246`). `?subject=math` always resolves to `course:prep3-math-en`
   (`(student)/student/page.tsx:124`). A second maths course therefore returns a 404 on every
   picker link, on the subject home card and on the tutor's `switch_subject` handoff. It is also
   merged into one "math" bucket in the subject summaries, the skill map, the console Overview and
   `parity_check.py`.
4. **The course gate is the right seam.** Every gated student read goes through
   `visibleCoursesFor` (`lib/catalog-queries.ts:84`). If the curriculum check lives in the pure rule
   (`lib/catalog.ts:128`), those readers become curriculum-aware without changing their own code.
   Four student readers are **not** gated today (§2.3), and one of them (`/dashboard`) already shows
   hidden courses' modules.
5. **Adding a fourth course to production is not possible with the current deploy steps.** The
   first-boot step skips once there are three courses (`ci-cd.yml:614`). Re-running
   `--course` on a course that is already present deletes students' attempts and mastery
   (`load_seed.py:19-23`). The manual `refresh-content` workflow targets the frozen baseline stack
   (`/opt/reletix/AI.NEXT`, database `ainext_poc`), not noor's.

**Recommendations, in one line each:**

| # | Decision | Recommendation |
|---|---|---|
| D1 | Data model | Split the registry into **subjects** (voice, widgets, prompts) and **courses** (book, curriculum, grades). Add a **curriculum registry** in app code. Store the student's curriculum in the **existing** `curriculum_system` column. One curriculum per student; exceptions use the existing per-student override. |
| D2 | Sign-up | Ask "Which curriculum does your school follow?" after grade, **only when the chosen grade offers more than one curriculum**. Add a one-screen grade and curriculum step after a **first Google sign-in**. |
| D3 | Console gate | Keep the rule keyed by **(course, grade)**, because each course belongs to one curriculum. Group the `/courses` grid into **one section per curriculum**. Add a curriculum editor to Student 360. |
| D4 | Readers | Add the curriculum match to `isCourseVisible` (the override still wins). Resolve one **student scope** per request, used by every student reader. Add **guard tests** that fail on an ungated reader, on a subject→course lookup outside the scope helper, and on a `course:` literal outside the registry. |
| D5 | Production load | Add a deploy step that loads a course **only when that course is absent**. It adds rows and never deletes. Later changes to that course go through `refresh-content`, retargeted to noor's stack. |
| D6 | Migration | **Migration 033** is small. It grants the console UPDATE on `students.curriculum_system` and records who changed it and when. It adds **no CHECK** on curriculum values, for the 007 reason in §6. `course_availability` is not changed, so the rollback stays safe. |

**Size**: about 8–11 agent-days before review, not counting the book's extraction (§7).
**Privacy**: curriculum is **not PII**. It is still a new question asked of a minor, and it hints at
school type (§6.1). **Solution integrity**: no student data crosses solutions. Metrics should not
pool two curricula's maths books into one number (§6.2).

---

## 1. Scope and vocabulary

- **Curriculum** (Samuel's word; "track" in the feature name): a school system a student follows.
  Examples: National (Egyptian ministry), American. Samuel's phrase "as much as we add Curriculum"
  means the design must handle **N curricula**, not two.
- **Course**: one book, stored as a `graph_nodes` row of `kind='course'` with its subtree. It is the
  unit the gate, the progression pointer and the loader already work in.
- **Subject**: the teaching contract: language and voice, widgets, grounding rules and prompt kit
  (`lib/subjects.ts`, `LESSON_PROMPTS` in `lib/lesson.ts:941`). Grade 10 American maths and Prep-3
  National maths are **the same subject** (English maths) taught from **different courses**.
- **Grade**: the school year as a number, 7–12 (`students.grade`, text). US grade 10 and Egyptian
  Secondary 1 are the same age band, so **the number does not depend on the curriculum. Only its
  label does** ("Secondary 1" or "Grade 10").

The PRD agrees with this direction. ADR-0007 records that the Student MVP PRD names "International
(IGCSE/American), National-English as fallback" (`docs/decisions/0007-prd-supersession-student-mvp.md:52`).
The existing Prep-3 maths book was used because it was the English-medium content already in hand.

---

## 2. What the code does today

### 2.1 Grades, end to end

| Where | What it does | Evidence |
|---|---|---|
| Vocabulary | `GRADES = ["7","8","9","10","11","12"]`; legacy `"prep-3"` accepted | `app/src/lib/profile.ts:43`, `:51-57` |
| Labels | Egyptian labels only: `"9": "Prep 3"`, `"10": "Secondary 1"` | `app/src/lib/catalog.ts:77-84` |
| Fold | `canonicalGrade("prep-3") → "9"` | `app/src/lib/catalog.ts:112-117` |
| Sign-up form | `<SelectInput id="grade" defaultValue="9">`, "Grade {g}" for each | `app/src/components/auth/SignupForm.tsx:154-161` |
| Sign-up API | `isValidGrade(body.grade)`; `INSERT INTO students (display_name, grade, …)` | `app/src/app/api/auth/signup/route.ts:66-67`, `:98-101` |
| Google sign-up | Always writes grade **9**: *"This build serves exactly one curriculum — Prep-3 Mathematics"* | `app/src/lib/auth/google.ts:113-119`, `:186` |
| Profile editing | **None.** FR-2013 is PARTIAL: *"no editor for any of the four fields"* | `specs/002-identity-and-admin-console/traceability.md:288` |
| Student profile read | Reads `grade` **and `curriculum_system`** (fallback `"eg-national-en"`) | `app/src/lib/student-context.ts:203-217` |
| Curriculum column | `ADD COLUMN IF NOT EXISTS curriculum_system TEXT NOT NULL DEFAULT 'eg-national-en'` | `db/migrations/009-mvp1-bkt-library-analytics.sql:100` |
| Console | Student 360 prints `<Fact k="Curriculum" v={s.curriculumSystem} />` | `app/src/app/(console)/students/[id]/page.console.tsx:155` |
| Design variant | `"10": "secondary"` → Master, but Master is hidden, so Play | `app/src/lib/design-variant.ts:178-185`; ADR-0017 Amendment |
| Tutor prompt | *"an Egyptian ${gradeAdj} student who just came home from school"*; capture default grade `"10"` | `app/src/lib/lesson.ts:1063`, `:516` |
| Gate | `course_availability.grade` is `text`, matched exactly after `canonicalGrade` | `db/migrations/023-course-availability.sql:70-73`, `:107` |

**Takeaway.** Grade 10 is supported end to end as a *value*. Nothing that is labelled or narrated
knows the curriculum, and the only path into grade 10 is the password sign-up form.

### 2.2 The course gate (migration 023, ADR-0018, FR-2701…FR-2711)

- **Two levers, default-deny.** `course_availability` holds rules per `(environment, course_id,
  grade)`, with `UNIQUE (environment, course_id, grade)` (`023:116`). `student_course_access` holds
  a per-student exception with RLS forced (`023:135-187`). Migration 023 seeds maths live for grade 9
  in both environments (`023:208-212`).
- **The rule is pure.** `isCourseVisible(courseId, grade, rules, overrides)`
  (`lib/catalog.ts:128-147`) works in three steps. An override decides outright. Otherwise a `live`
  rule for (course, canonical grade) shows the course. Otherwise the course is hidden.
- **One database seam.** `visibleCoursesFor(studentId)` (`lib/catalog-queries.ts:84-93`) is the
  only student-side call. `visibleGraphFor` (`:134-164`) turns the same answer into LO and module
  predicates for the graph-wide readers.
- **Kill switch.** With `AINEXT_COURSE_GATING` unset or `off`, the gate returns `allCourseIds` (the
  registry courses plus every loaded course) (`:89`, `:102-110`). Every student then sees every
  loaded course (FR-2709). Production's value is a GitHub repository variable
  (`ci-cd.yml:351`), and `deploy/TAKEOVER.md:375-404` recommends `on`. **Its current production
  value cannot be read from the repo** (Q2).
- **The console builds its grid from the registry, not the spine.** `courseCatalog` loops
  `SUBJECT_IDS × GRADES` (`catalog-queries.ts:371-374`). The POST route checks a course id against
  `SUBJECT_IDS.map(id => SUBJECTS[id].courseId)` (`app/src/app/api/console/courses/route.console.ts:44`).
  `studentAccess` iterates `SUBJECT_IDS` (`catalog-queries.ts:550`).

**Can the (course, grade) rules be reused as (curriculum, grade, course)?** Yes, if each course
belongs to exactly one curriculum. The curriculum is then a property of the course, and a
(course, grade) cell *is* a (curriculum, subject, grade) decision. It is not enough if one course
must be offered to two curricula under different rules. One example is the ministry Arabic book for
American-track students, which Egyptian international schools may also teach. §4 D3 prices both
cases. Changing the rule key has a trap: every deploy re-runs migration 023, whose seed is
`ON CONFLICT (environment, course_id, grade) DO NOTHING` (`023:212`). Replacing that unique
constraint makes 023 fail on the next deploy, and makes the previous release fail CI's rollback
proof.

### 2.3 Where a student's course or subject scopes data

Gated readers call the course gate. Ungated readers do not.

| Reader | File | Scoped by | Gated? |
|---|---|---|---|
| Lesson catalogue | `lib/lesson.ts:190-253` (`getLessonCatalog`), gate at `:226` | course, via `courseGateFor` (`:180-188`) | yes |
| Lesson data | `lib/lesson.ts:347-500` (`getLessonData`), gate at `:387` | course | yes |
| Progression pointer | `lib/progression-db.ts:114-200`; table `student_progress (student_id, course_id)` `028:92-99` | **course**, already right | via the gated catalogue |
| Landing decision | `lib/student-landing.ts:121,132,158` | `courseId` from `?subject=`, subject count | via the gated catalogue |
| Subject home | `lib/subject-queries.ts:57-183` | **subject**: `bySubject` (`:115`); last check by `understanding_checks.subject` (`:160`) | yes (`:69`, `:121`) |
| Practice plan | `lib/queries.ts:389-...` (`getStudentPlan`), gate at `:446` | LO predicate | yes |
| Skill map `/spine` | `lib/queries.ts:117-...`, gate at `:205`; picker by **subject** in `components/spine/SpineExplorer.tsx:82-96` | LO predicate; subject picker | yes, but `source_documents LIMIT 1` at `:181` is not |
| Ask-the-Spine context | `lib/ask.ts:107-...`, gate at `:201-234` | LO/module predicates | **partly**: every book in `source_documents` is listed (`:168-169`, `:305-312`) |
| Attempts | `app/api/attempts/route.ts:199-202` | course | yes |
| Progress page `/dashboard` + `/api/dashboard` | `lib/dashboard.ts:37-100` (`getTopicBreakdown`) | every module of every course | **no** |
| Home `/` | `lib/queries.ts:64-110` (`getHomeStats`) | corpus-wide counts, `source_documents LIMIT 1` (`:77`, `:87`) | **no** |
| Figures | `app/api/visuals/route.ts:37,54` → `lib/visuals.ts:112-135` | none | **no** (figures only, no answers) |
| Check-in | `components/student/LessonCheckIn.tsx:134-138`, `:469`, `:733`, `:869` | `?subject=` links; Term from module id | n/a (renders gated data) |
| Subject handoff | `components/student/LessonSession.tsx:1442`; `SubjectHome.tsx:162` | `?subject=<key>` | resolved by the page |
| Console Student 360 | `lib/console-queries.ts:328-560`; `studentAccess` | by student (all LOs) | operator |
| Console Overview | `lib/overview-queries.ts:189-203` (options), `:241-248`, `:402-404` | cohort key **(subject, grade, syllabus_version)** | operator |
| Console Cost / Feedback | `(console)/cost/page.console.tsx:663`; `(console)/feedback/page.console.tsx:157-160` | label by subject | operator |
| Console Content | `(console)/content/page.console.tsx:44-47` | switcher over `SUBJECT_IDS` | operator |
| Console `/pipeline`, `/gallery` | `lib/pipeline-queries.ts`, `lib/visuals.ts:80` | `SUBJECT_RANK` order | operator |

### 2.4 Assumptions the new book breaks

1. **`MODULE_ORDER`'s term rank.** `TERM_RANK` is `WHEN m.id LIKE 'module:geo%' THEN 2 WHEN m.id
   LIKE 'module:t2-%' THEN 1 ELSE 0` (`lib/module-order.ts:98-102`). A Siyavula chapter whose module
   id starts `geo` would sort after every other chapter. With any other prefix every chapter gets
   term 0 and sorts by `m.order_in_parent`, which is correct, but only because the ids happen to
   avoid those two prefixes. The check-in prints the term from the id as well: `termOfModule`
   and `termOfSlug` (`lib/module-term.ts:32-39`), `moduleHeading` (`:48-49`), `isGeoModule`
   (`LessonCheckIn.tsx:731`) and `isGeoLesson` (`lib/lesson.ts:528`). **Every G10 chapter would
   read "Term 1 · …"**. The book has no Egyptian terms.
2. **`SUBJECT_RANK` and `lib/subjects.ts` are keyed by subject, one course each.**
   `REGISTRY_COURSES = SUBJECT_IDS.map(id => SUBJECTS[id].courseId)` (`module-order.ts:126`). A course
   the registry does not know sorts after every known subject (`:146-152`). If the G10 course is
   registered as a second maths course, the one-subject readers that
   `catalogue-order-guard.test.mts` accepts can now hold two books. Mixed-subject lists are fine
   once `SUBJECT_RANK` ranks courses. The subject picker and the skill map's one-subject view
   (`SpineExplorer.tsx:82-96`, `SPINE_LO_SQL` at `lib/spine-lo-query.ts:34`, ordered by
   `MODULE_ORDER` alone) would **merge both maths books into one "Mathematics" view**. Chapter 1 of
   G10 would interleave with Unit 1 of Prep 3. Under one curriculum per student this happens only
   to a student given both books by override (a tester), but the subject summaries, the Overview
   heatmap and `parity_check.py` merge them for **every** operator.
3. **`PROBING_COURSE_ID = "course:prep3-math-en"`** (`lib/socratic-probing.ts:91`, checked at
   `:162` and `:202`; printed on `/teaching`). Probing never runs on the G10 course. That is the
   safe failure, but it needs a decision (Q9). The probing strings are English maths, so G10 could
   use them.
4. **English and Arabic variants.** The registry ties language, direction, the Arabic label and the
   book to the *subject*. A second English maths course (or a future Arabic-medium National maths
   book, which would also be spine key `math`) cannot be expressed: `BY_SPINE_KEY` would map
   `math` to two registry ids. The Arabic chrome (`labelAr`, `labelArShort`) names the subject, so
   two maths courses both read «الرياضيات» on Arabic surfaces.
5. **`prep3` literals** (student-visible first):
   - chrome: `"Prep 3 · Mathematics"` (`app/src/app/layout.tsx:147`),
     `"Prep-3 Mathematics · MOETE 2025–2026"` (`layout.tsx:168`, `(console)/layout.console.tsx:144`);
   - prompts: `bookName: () => "Egyptian ministry textbook"` for **every** `math-en` lesson
     (`lib/lesson.ts:946`), so a Siyavula lesson would tell the tutor it is teaching from the
     Egyptian ministry book. `fallbackVizId: "v:geo1-1:001"` (`:950`), a Prep-3 figure id, becomes
     the example in any G10 lesson with no figure (`:720`). `"Syllabus 2025–2026"` is hard-coded in
     the Ask source line (`lib/ask.ts:309`, `:312`);
   - catalogue: `LESSON_TITLES` covers Prep-3 slugs only (`lib/lesson.ts:100-120`), so G10 lessons
     would take their first objective's label as the title;
   - defaults: `DEFAULT_LESSON_SLUG = "u1-1"` (`lib/lesson-slug.ts:20`) and
     `GOOGLE_DEFAULT_GRADE = "9"` (`lib/auth/google.ts:119`);
   - loader and guards: `COURSE_SUBJECTS` (`services/extraction/load_seed.py:237-241`) and
     `parity_check.py`, which counts `node_subject WHERE subject = 'math'` (`:54`, `:112-115`)
     against the Prep-3 constant (`:42-48`). **Loading G10 maths makes the Prep-3 drift guard
     fail.**
6. **Identifier shape.** A lesson is a lexical group: `lo.id LIKE 'lo:<slug>-%'`
   (`lib/lesson-slug.ts:12-18`). `SLUG_RE = /^[a-z0-9]{1,12}-[0-9]{1,3}$/` (`:22`), and the same
   pattern is a CHECK on `student_progress.lesson_slug` (`028:95`). Slugs must be **unique across
   every course**. `progression-db` builds `bySlug` over all courses (`progression-db.ts:60-78`),
   so a repeated slug merges lessons of two books. `module-order.ts:130` throws on a course id
   outside `^course:[a-z0-9-]+$`. The loader refuses a bundle that redefines a node outside its own
   course subtree (`load_seed.py:611-626`). A G10 bundle that declares `topic:algebra` fails that
   check.

### 2.5 How content reaches production

- **Migrations** run on every deploy with no ledger. `deploy/apply-migrations.sh` re-applies every
  file in filename order, one transaction per file. CI's `migrations` job
  (`scripts/ci-migrations.sh all`) proves three things: HEAD applied three times on an empty
  database; upgrade from the previous release; and the previous release's migrations applied twice
  over HEAD's schema and data, then HEAD again (rollback). If the gate is on and no rule is live,
  the deploy fails (`apply-migrations.sh:370-393`).
- **Curriculum**: a CI deploy step runs "only when none is loaded" (`ci-cd.yml:603-640`). It exits
  when `count(*) from graph_nodes where kind='course'` is **≥ 3** (`:614`), so a fourth course
  **never loads**. `scripts/local-dev.sh:179` has the same `-ge 3` check.
- **The loader's `--course` mode replaces a subtree.** It deletes the course's nodes, questions and
  visuals, and *"Student attempts/mastery referencing the deleted content are deleted with a
  printed warning"* (`load_seed.py:19-23`). On a course that is **absent** the subtree is empty.
  Nothing is deleted and the load only adds rows (`load_seed.py:611`, `:652-654`). A shared
  `program:` ancestor is re-declared with `ON CONFLICT DO NOTHING` (`course_ancestors`, `:451`).
- **Generated maths** is a one-time step (`ci-cd.yml:650-690`) that promotes only
  `course:prep3-math-en` book questions (ADR-0019). The **misconception catalogue** is upserted on
  every deploy (`:697-704`). That is the precedent for a data step that runs every deploy and is
  idempotent.
- **Manual content path**: `refresh-content.yml` sets `APP_DIR: /opt/reletix/AI.NEXT` (`:43`) and
  `deploy/refresh-content.sh` works on database `ainext_poc` (`:67`). **That is the frozen baseline
  stack.** noor runs in `/opt/reletix/AI.NEXT-mvp1` with database `ainext_mvp1`
  (`ci-cd.yml:257-259`). So constitution X's rule that content changes go through the manual
  workflow has no working path to noor today.
- **Hidden until enabled**: the gate is default-deny, so a newly loaded course is hidden until an
  operator writes a `live` rule. This holds **only while `AINEXT_COURSE_GATING` is on**.

---

## 3. What breaks for grade 10

Order: a student's path first, then operators, then the platform.

1. **No curriculum is ever asked.** Every grade-10 sign-up is stored as `eg-national-en`.
2. **Google sign-up cannot reach grade 10.** It always writes grade 9 (`google.ts:119`), and no
   student-facing editor exists (FR-2013 PARTIAL).
3. **What a grade-10 student sees today is whatever is live for grade 10.** Samuel's recorded
   intent was *"the default is that they are all subject per grade available"*
   (`CourseAvailabilityGrid.tsx:58-59`), and bulk actions exist for exactly that. If they were used,
   grade-10 students are being taught the **Prep-3 book**. The production rows need checking
   (Appendix A).
4. **`?subject=math` means Prep-3.** For a grade-10 American student with only the G10 course
   visible, the picker links (`LessonCheckIn.tsx:137-138`, `:733`), the subject-home card
   (`SubjectHome.tsx:162`) and the tutor's handoff (`LessonSession.tsx:1442`) all resolve to
   `course:prep3-math-en`. `decideLanding` then returns `refused` (`student-landing.ts:132`), which
   is a **404**.
5. **"Term 1 ·" on every chapter** in the check-in (§2.4.1).
6. **The tutor misnames the book.** It is told "Egyptian ministry textbook" (`lesson.ts:946`), may
   be shown a Prep-3 figure id as an example (`:950`), and the Ask context lists every ingested book
   (`ask.ts:305-312`).
7. **`/dashboard` shows other courses' modules as "not started"**, whichever curriculum the student
   is in (ungated, `dashboard.ts:37-100`). This is already true today for hidden Arabic and Social
   Studies modules.
8. **The home plate and `/spine` header show an arbitrary book** (`source_documents LIMIT 1`, with
   no ORDER BY, `queries.ts:87`, `:181`).
9. **Labels.** Grade-10 American students would see Egyptian grade labels ("Secondary 1") wherever
   `gradeDisplayLabel` or the variant picker's reason line is shown. The header says
   "Prep 3 · Mathematics" (`layout.tsx:147`).
10. **First Secondary cohort.** Grade 10 is on the Master side of ADR-0017. Master is hidden, so
    these students get Play, which was designed for ages 10–16. ADR-0017's amendment allows this
    but says nobody should be onboarded "expecting Master" (Q10).
11. **Operators cannot tell the two maths courses apart.** `/courses`, `/content`, `/cost` and
    `/feedback` label a course by its subject ("Mathematics"). The Overview cohort
    `(subject, grade)` pools grade-10 National and grade-10 American students, and its maths heatmap
    merges both books (`overview-queries.ts:189-203`, `:402-404`).
12. **Platform.** `parity_check.py` fails once G10 maths is loaded. The first-boot step never loads
    a fourth course. Re-running `--course` on it would delete student data.

---

## 4. Design options

### D1 — Data model

#### D1.1 Where a curriculum is defined

| Option | Shape | For | Against |
|---|---|---|---|
| **a. App registry** `lib/curricula.ts` | `{ id, label, labelAr, gradeLabels, programNodeId }`, a closed list derived like `SUBJECTS` | Matches constitution IX (registry-driven subjects) and ADR-0018 (*"the console lists every course the product recognises, from the subject registry rather than from what the spine happens to hold"*). Pure and testable without a database. The compiler finds every `Record<CurriculumId, …>`. | Adding a curriculum needs a code change and a deploy. That is acceptable: it also needs labels, and usually prompts. |
| b. `curricula` DB table | `id, label, …` with FKs from `students` | Referential integrity without a value CHECK, since new rows are INSERTed and nothing is widened | The console needs labels before content exists, so the registry is needed anyway and becomes a second source. The table would need grants, RLS reasoning and seeding in every environment. |
| c. Graph `program` nodes | `course part_of program:<curriculum>`; the schema already allows `kind='program'` (`db/schema.sql:37-38`), and `program:bakaloreya-track` "Egyptian National Curriculum" exists (`seed/unit1.json`) | The thesis shape (Ch. 15: program → course → module → LO). The loader already treats programs as shared ancestors. | Not everything is wired: `arabic-t1.json` and `social-t1.json` have no `part_of program` edge. It is content-driven, so a curriculum would only exist once a book is loaded, which is the wrong way round for the console. No app code reads it. |

**Recommendation: a**, with **c as the graph echo.** The loader writes `course part_of
program:<id>` for each new course, and a test cross-checks the registry against the seed bundles
(no database needed). SQL readers that need the curriculum get it the way `SUBJECT_RANK` gets the
subject: from a CASE built from the registry. No DB column is needed.

#### D1.2 How a course relates to a curriculum and a subject

| Option | Shape | For | Against |
|---|---|---|---|
| i. **Course-as-subject** (fast hack) | Add `"math-am-en"` to `SUBJECTS` with a new spine key such as `math-am` | Most readers are subject-keyed, so `?subject=`, the subject home, the Overview and `SUBJECT_RANK` would split correctly for free. About one day of work. | It models no curriculum, so sign-up and the console still need one. It invents a subject that is not one: the handoff rule only knows `"math"` or `"social"` (`lesson.ts:699`). **Migration 007 re-runs every deploy and NULLs any `understanding_checks.subject` outside `('math','social','arabic')`** (`007:66-72`). The rollback proof would do the same. The registry grows as subjects × curricula × grades. |
| ii. **Split registry** (recommended) | `lib/subjects.ts` keeps the teaching contract. A new `lib/courses.ts` holds `CourseDef { id, subject, curriculum, grades, label, labelAr, book, dir, termModel, probing, lessonTitles?, fallbackVizId }`. `SubjectDef.courseId` is removed. | Matches the domain. The spine key stays `math`, so 007, the `understanding_checks` CHECK, `switch_subject` and the prompt kits are untouched. Per-course facts (book name, terms, probing, titles) get one home. Handles N curricula. | About 19 files import `SUBJECTS[..].courseId` or `courseIdOfSpineKey` (grep count). Each subject→course lookup must be replaced by a **student-scoped** one (D4). |

**Recommendation: ii.** For the first curriculum, each course has **one** curriculum. If Samuel
answers Q1 "shared courses are coming", `curriculum` becomes `curricula: CurriculumId[]` without
touching any table.

#### D1.3 Where the student's curriculum is stored

| Option | For | Against |
|---|---|---|
| **A. The existing `students.curriculum_system`** | It already exists, is `NOT NULL DEFAULT 'eg-national-en'`, has **no CHECK**, and is read by `getStudentProfile` and Student 360. **Every existing student is already National, with no backfill.** FR-302 already names it. | The value format mixes system and language (`eg-national-en`). That is accurate for the loaded National set, which is what a Language-school student studies. |
| B. A new `students.curriculum` column | A clean name | Two columns for one fact, or a migration to retire 009's. A backfill, even an instant one, is one more thing a re-run must be safe for. |
| C. Derived from the courses a student can see | No stored state | Circular: the gate needs the curriculum to decide which courses are visible. |

**Recommendation: A.** Curriculum ids are validated in app code against the registry, never by a
CHECK (§4 D6). **An unknown value matches no course** and the student sees only what overrides
grant (default-deny, the ADR-0018 rule). Student 360 flags it as "unknown curriculum". Ids to
decide (Q4): keep `eg-national-en` for National; new ids follow `<country>-<system>-<language>`,
for example `us-american-en`.

#### D1.4 One curriculum or several; changing it later

- **One curriculum per student** (recommended). The existing per-student course override already
  covers exceptions, such as an American-track student who also takes the ministry Arabic book
  (`student_course_access`, FR-2703, *"wins … in both directions"*). A `student_curricula` set
  table would add a second multi-valued lever for the same job.
- **Changing it later**: (1) **now**, from the console's Student 360, under the `student-data` role
  (it names a person, FR-2707), recording who changed it and when; (2) **later**, by the student
  from `/settings` when FR-2013's editor is built.
- **What a change does**: it **deletes nothing**. Attempts and mastery are per LO and the pointer
  is per course (`028:92-99`), so the old curriculum's history stays and switching back restores
  it. A chat already open keeps its session snapshot until it ends (`lib/session-cache.ts`), which
  is acceptable and should be stated in the spec.

### D2 — Sign-up

**Where the choice sits.** After "Which grade are you in?" (`SignupForm.tsx:154`), ask "Which
curriculum does your school follow?". The first answer decides whether the second question
appears.

**When a grade has one curriculum.** "Offered" is computed server-side in the signup page (a
server component, `(auth)/signup/page.student.tsx`) and passed to the form as
`{ grade → curriculumIds[] }`. Two options:

| Option | Rule | For | Against |
|---|---|---|---|
| **a. From the gate** (recommended) | Curriculum C is offered for grade G when some course of C has a `live` rule for G in this environment. With the gate off, when some course of C lists G in its registry `grades`. | What sign-up offers is what the student will actually find. Hiding American G10 in the console also removes it from sign-up. | One cheap read of `course_availability` (content-shaped, readable by `ainext_app`, no RLS) on an anonymous page. It reveals which curricula are live, which is catalogue information, not student data. |
| b. From the registry only | Static `grades` per curriculum | No database read | Offers a curriculum whose course is hidden, so the student signs up into an empty home. |

- **Two or more offered**: a required radio with National listed first. No pre-selection, because
  a wrong silent default for a child is worse than one extra tap.
- **Exactly one offered**: no question; store that one. The alternative is a read-only line naming
  it (Q5).
- **None offered**: store `eg-national-en`. The student lands on the existing "nothing yet" home
  (`SubjectHome` with `[]`), exactly as a new grade does today.
- **Server**: `/api/auth/signup` accepts `curriculum`, validated as a *known* id. It does not have
  to be *offered*, because an operator can hide a course between page load and submit. Missing
  means `eg-national-en`.
- **Existing students**: already `eg-national-en` (D1.3), so they need nothing.
- **Google**: after a Google sign-in that **created** the account (`GoogleUpsert.created`,
  `google.ts:104-106`), redirect once to a small grade and curriculum step before the first
  lesson. This also fixes the documented `GOOGLE_DEFAULT_GRADE` deviation for grade. It needs a
  student-writable endpoint for grade and curriculum, a subset of FR-2013. `ainext_app` already has
  UPDATE on `students` (`017:150`).
- **Analytics**: `account_created` gains `curriculum`
  (`signup/route.ts:156-160`, `google/callback/route.ts:113`), in the **first-party table only**.
  It must never be sent as a GA4 property (`lib/ga.ts`, ADR-0016).
- **Requirements touched**: FR-2002 (the fields signup captures; curriculum is new), FR-2006 (a
  Google sign-in ends in the same state as a password one, so both must set a curriculum), FR-2013,
  FR-302.

### D3 — The console gate, per curriculum

| Option | Rule key | For | Against |
|---|---|---|---|
| **A. Curriculum comes from the course** (recommended) | Unchanged: `(environment, course_id, grade)`. Visible means: override, else **course's curriculum = student's curriculum** and a live rule for (course, grade). | **No change to `course_availability` or `student_course_access`**, so every rollback stays safe. The grid can show "which subject for which grade, per curriculum" exactly, because each course sits in one curriculum section. | A course shared by two curricula would show one toggle in two sections. It could not be live for American grade 10 and hidden for National grade 10. |
| B. Curriculum in the rule key | `(environment, curriculum, course_id, grade)` | Can express per-curriculum rules for a shared course | Altering 023's unique constraint breaks 023's own `ON CONFLICT` target on the next deploy, and the previous release in the rollback proof (§2.2). Doing it safely means a **new table** (`curriculum_course_availability`), a one-time copy of today's rules as National, repointing the deploy check (`apply-migrations.sh:374-375`), and leaving 023's table as dead weight. About 2 more days. |

**Recommendation: A.** Move to B only if Q1's answer is "yes, soon".

**Gate semantics (either option).** `isCourseVisible` gains the student's curriculum and a
course→curriculum lookup. The override still wins in both directions, so a tester can be given the
other curriculum's course. `lib/catalog.ts` stays pure; the lookup comes from `lib/courses.ts`,
which imports nothing.

**What the kill switch suspends (decision, Q2).** Recommendation: `AINEXT_COURSE_GATING=off`
suspends **operator rules only**. Curriculum scoping stays in force, so with the switch off a
student sees every loaded course **of her own curriculum**. This is defence in depth for §D5: with
the switch off, a loaded American book still reaches nobody outside that curriculum. It changes
FR-2709's wording ("every course visible"), so it is Samuel's call.

**Console UI change on `/courses`.**

- **One section per curriculum** (registry order), each with a heading such as "National —
  Egyptian ministry" and its courses as rows. Columns stay grades 7–12. Each section shows grade
  labels in its own vocabulary: "Prep 3" or "Secondary 1" for National, "Grade 9" or "Grade 10" for
  American.
- **Bulk actions per section**: "every National subject for Prep 3" and "American Mathematics for
  every grade". This replaces today's column bulk across all subjects (`CourseAvailabilityGrid.tsx:117-123`).
  Each action is still one POST per cell to the same endpoint.
- **Course cell text**: course label, book, curriculum, and the grades the book is written for.
  Honesty rule: a `live` click on a grade the book is not written for asks in the page, like the
  empty-course question (FR-2710).
- `courseCatalog` iterates `COURSES` grouped by curriculum instead of `SUBJECT_IDS`
  (`catalog-queries.ts:371`). The POST route validates against `COURSES`
  (`courses/route.console.ts:44`).
- **Student 360**: "Curriculum: American (us-american-en)", with an editor (`student-data`), plus
  `curriculum_updated_by` and `curriculum_updated_at`. The access panel (`studentAccess`) lists
  every course grouped by curriculum, and its effective state gives the reason: "not her
  curriculum", "no rule", "hidden by rule", or "exception".
- **Students list**: add a curriculum column (`getStudentList`, `console-queries.ts:88-136`).

### D4 — Readers, and keeping "one source"

**The seam.** Add `resolveStudentScope(db, studentId)` in `lib/catalog-queries.ts`. It returns
`{ studentId, grade, curriculum, courses: Set<string>, lo(id), module(id), doc(sha),
courseForSubject(key) }`, built from **one** read of grade, curriculum, rules and overrides plus
**one** graph walk, the same reads `visibleCoursesFor` and `visibleGraphFor` do today. Both of those
become thin wrappers over it, so their existing callers keep compiling.

- `courseForSubject(key)` replaces `courseIdOfSpineKey` on every student surface. It returns the
  visible course of that subject: the student's own curriculum's course when there are two (a
  tester's override); `null` when there is none, which is a 404 as today (FR-2706).
- **Keep `?subject=<spineKey>` in URLs.** It is the tutor's handoff vocabulary
  (`chat-parse.ts:120`) and existing links survive. The page resolves it within the student's scope.

**Guard tests**, in the same shape as `catalogue-order-guard.test.mts` and `plan-gate.test.mts`
(source scans with a written allow-list):

1. `student-scope-guard.test.mts`: any function reachable from `(student)/**` or a non-console
   `api/**` route that reads `graph_nodes`, `questions`, `visuals`, `source_documents` or
   `node_subject` must go through the scope, or appear on the allow-list with a reason. Today this
   test would flag `dashboard.ts`, `getHomeStats`, `lib/visuals.ts` and `ask.ts`'s document read.
2. `courseIdOfSpineKey` and `SUBJECTS[…].courseId` are forbidden outside `lib/courses.ts`,
   `lib/catalog*.ts` and a listed set of console files.
3. No `"course:` string literal in `app/src` outside `lib/courses.ts`, tests, fixtures and
   `scripts/capture-prompts.mts`. This catches the next `PROBING_COURSE_ID`.
4. `catalogue-order-guard`: "one-subject" becomes **"one-course"**. `SUBJECT_RANK` is renamed
   `COURSE_RANK` (registry order: curriculum, then subject, then course), with the old name kept as
   an alias for one release.
5. **Wiring test**: extend `catalog-gate.test.mts` with a National student and an American student.
   Each must see exactly their own course, with the gate on **and** off, and a tester override must
   cross curricula.
6. **Registry cross-check** (no database): every course defined in `services/extraction/seed/*.json`
   is in `COURSES`. Its `part_of program:` edge, if present, matches its curriculum. Its
   module and slug prefixes are unique across all courses.

**Term model.** Move the term rules onto `CourseDef.termModel`: `{ prefixes: {geo: 2, "t2-": 1} }`
for Prep-3 maths, and `null` for courses without Egyptian terms. `TERM_RANK`'s CASE is generated
from all courses' prefixes, so SQL behaviour is unchanged for Prep-3. `termOfModule`,
`moduleHeading` and `isGeoModule` take the course, and a course without terms prints no "Term N ·"
eyebrow. FR-3217 and FR-3218 stay true for Prep-3; the byte-identical captures prove it.

**Prompts (constitution IX, ADR-0020's hold).** Per-course `bookName` (Prep-3 keeps the exact string
`"Egyptian ministry textbook"`), `fallbackVizId`, `lessonTitles` and `isGeoLesson` come from
`CourseDef`. **Prep-3 captures must stay byte-identical.** G10 captures are **new files**. They
still need Samuel's go under the prompt hold (Q8). The Ask source line lists only books behind
visible courses (via `scope.doc`), and "Syllabus 2025–2026" comes from the course.

### D5 — The production load step

| Option | How | For | Against |
|---|---|---|---|
| **L1. Additive deploy step** (recommended for the first load) | New step after "Curriculum": for each course in `COURSES` that has bundles in `seed/`, **if `graph_nodes` has no row with that id**, run `loader --all --course <id>`, then print that course's objectives, live and held counts. | Idempotent: the second run sees the course and skips. **Adds rows only**: an absent course has an empty subtree, so nothing is deleted. It cannot delete student data. It follows the "only when none is loaded" pattern of the two existing one-time steps. **Hidden** by default-deny, and by curriculum scoping even if the switch is off (D3). | It is data written by a code deploy. Constitution X says *"A normal code deploy can never touch data"*. The two first-boot steps are the precedent, but this needs Samuel's explicit OK and a line in the ADR. |
| L2. Manual `refresh-content` | `course` mode: backup, typed confirmation, subtree replace | Constitution X as written; a human decides | **It targets the frozen baseline stack today** (§2.5). It must be retargeted to `AI.NEXT-mvp1` and `ainext_mvp1` first, which is a real change and a pre-existing gap. |
| L3. SQL in a migration | Content in `db/migrations` | Runs every deploy "for free" | Skips the loader's validation, provenance, sacred-content and collision checks. Migrations are schema (031's one-label fix is the exception). **Rejected.** |

**Recommendation: L1** for the first load, and **retarget L2** for every later change to a course
that has students. The step must **never** run `--course` on a course that is present.
`local-dev.sh` gets the same per-course "load if absent" check, replacing `-ge 3` at `:179`.

**Preconditions, in order:** production gate **on**, or curriculum scoping made independent of the
switch; the course in `COURSES` and `COURSE_SUBJECTS`; `parity_check.py` keyed by course id, with
`course:prep3-math-en` keeping its constant and G10 getting its own; no `course_availability` row
for the new course, so the deploy writes no visibility.

**Questions not promoted.** Loader rule: `verified` → `live` (stamped `ai dual-check (pending
Samuel)`), otherwise `review`. ADR-0019's CI promotion names only `course:prep3-math-en`
(`ci-cd.yml:674-679`). Whether the G10 bank is also "live by rule" is Q7.

### D6 — Migration plan and rollback

**Option A needs one small migration, 033 (`033-curriculum-tracks.sql`):**

```sql
-- Idempotent; re-run every deploy (apply-migrations.sh).
ALTER TABLE students ADD COLUMN IF NOT EXISTS curriculum_updated_at timestamptz;
ALTER TABLE students ADD COLUMN IF NOT EXISTS curriculum_updated_by bigint REFERENCES operators(id);
-- 017 REVOKEs ALL each run; 033 sorts after it and re-grants (023's arrangement).
GRANT UPDATE (curriculum_system, curriculum_updated_at, curriculum_updated_by)
  ON students TO ainext_operator;
-- DO $verify$ … the grant exists; ainext_app has no UPDATE on curriculum_updated_by … $verify$
```

**Deliberately no CHECK on `curriculum_system` values.** Migration 007 re-runs every deploy and
NULLs every `understanding_checks.subject` outside its list before re-adding its CHECK
(`007:66-72`). The 2026-09-23 outage was the same pattern: 008 re-adding a narrow CHECK over rows
that 010 had widened (`886b302`). A curriculum CHECK would have to be widened for every new
curriculum, and each re-run of the old narrow version would either fail the deploy or tempt the
same "clean up" UPDATE. The value is validated in app code, as `students.grade` already is.

**Rollback** (`rollback/033-curriculum-tracks.down.sql`): revoke the column grant and drop the two
audit columns. This loses the record of *who* changed a curriculum and *when*, not anything a
student produced. `curriculum_system` **stays**, because it predates 033 (009). **Name the
consequence:** on old code nothing reads the curriculum, so an American student would see every
course live for grade 10. Before rolling back, set American courses to hidden or turn the gate on.

**CI proof** (`scripts/ci-migrations.sh all`): fresh ×3, upgrade from v0.9.2, and v0.9.2's
migrations over 033's schema twice, then HEAD. None of 009, 017, 018 or 023 touches the new columns
or grants in a way a re-run breaks. 017's `REVOKE ALL … FROM ainext_operator` removes the column
grant each time, and 033 restores it in order.

**Option B** (curriculum in the rule key) would add a new table
`curriculum_course_availability (environment, curriculum_id, course_id, grade, state, note,
updated_by, updated_at, UNIQUE (environment, curriculum_id, course_id, grade))`. It would need an
idempotent one-time copy of today's rules as National, RLS reasoning copied from 023 (content-shaped:
no RLS, `ainext_app` SELECT only), and the deploy check repointed. Its rollback drops the new table
and loses every per-curriculum rule set since. That is configuration, not student output, but
Samuel would re-enter it.

---

## 5. Every reader that must become curriculum-aware

"Auto" means correct once `isCourseVisible` and the scope are, with no edit to the reader.

| # | Reader | File(s) | Change | Auto? |
|---|---|---|---|---|
| 1 | Course gate rule | `lib/catalog.ts:128-173` | curriculum match; override still wins | — (the change) |
| 2 | Gate seam | `lib/catalog-queries.ts:84-164` | `resolveStudentScope`; gate-off keeps curriculum scoping | — |
| 3 | Lesson catalogue | `lib/lesson.ts:190-253` | none | **auto** |
| 4 | Lesson data | `lib/lesson.ts:347-500` | none for gating; per-course `bookName`, `fallbackVizId`, titles | gating auto |
| 5 | Attempts | `app/api/attempts/route.ts:199` | none | **auto** |
| 6 | Practice plan | `lib/queries.ts:389-` | `COURSE_RANK` tie-break | gating auto |
| 7 | Skill map | `lib/queries.ts:117-`, `lib/spine-lo-query.ts:34`, `SpineExplorer.tsx:82-96` | picker by course; `COURSE_RANK`; the course's own document, not `LIMIT 1` (`:181`) | gating auto |
| 8 | Ask context | `lib/ask.ts:107-330` | gate the document list (`:168`, `:305-312`); syllabus per course | LOs auto |
| 9 | Subject home | `lib/subject-queries.ts:57-183`, `SubjectHome.tsx` | roll up **by course**; last check by course through the LO; key cards by course | gating auto |
| 10 | Landing | `(student)/student/page.tsx:124,163-198`, `lib/student-landing.ts:89-158` | `scope.courseForSubject(subject)`; count courses, not subjects | no |
| 11 | Check-in | `LessonCheckIn.tsx:134-138,469,731-733,869` | term model per course; links resolved in scope | no |
| 12 | Subject handoff | `LessonSession.tsx:1442`, `ChatCore.tsx:1416` | no change; the page resolves it (row 10) | via 10 |
| 13 | Progression | `lib/progression-db.ts` | none if slugs are unique across courses (guard 6) | **auto** |
| 14 | Progress `/dashboard` | `lib/dashboard.ts:37-100`, `app/api/dashboard/route.ts` | **gate it** (pre-existing leak); `COURSE_RANK` | no |
| 15 | Home `/` | `lib/queries.ts:64-110` | scope counts and document to visible courses | no |
| 16 | Figures API | `app/api/visuals/route.ts`, `lib/visuals.ts:112-135` | gate by the figure's LO | no |
| 17 | Probing | `lib/socratic-probing.ts:91,162,202`; `/teaching` page | `CourseDef.probing` flag; G10 off until Q9 | no |
| 18 | Chrome | `layout.tsx:147,168`; `layout.console.tsx:144` | strapline from the student's course(s); console footer names every loaded curriculum or none | no |
| 19 | Sign-up | `SignupForm.tsx`, `api/auth/signup/route.ts`, `(auth)/signup/page.student.tsx` | D2 | no |
| 20 | Google | `lib/auth/google.ts:119,186`, `api/auth/google/callback/route.ts:113` | D2 onboarding step | no |
| 21 | Profile read | `lib/student-context.ts:196-225`, `lib/auth/principal.ts` (`/api/auth/me`) | expose curriculum (already read in context) | no |
| 22 | Console `/courses` | `catalog-queries.ts:323-401`, `CourseAvailabilityGrid.tsx`, `courses/route.console.ts:44` | D3 sections; validation against `COURSES` | no |
| 23 | Student 360 access | `catalog-queries.ts:528-579`, `students/[id]/courses/route.console.ts` | all courses by curriculum with a reason; validation | no |
| 24 | Student 360 profile | `students/[id]/page.console.tsx:155`, `console-queries.ts:328-560` | label and editor (student-data); mastery grouped by course | no |
| 25 | Students list | `console-queries.ts:88-136` | curriculum column | no |
| 26 | Overview | `lib/overview-queries.ts:189-203,241-248,402-404` | cohort key gains the **course** (or curriculum) | no |
| 27 | Content | `(console)/content/page.console.tsx:44-47`, `lib/content-admin.ts:90` | switcher over `COURSES` grouped by curriculum | no |
| 28 | Cost, Feedback | `(console)/cost/page.console.tsx:663`, `(console)/feedback/page.console.tsx:157-160` | label by course | no |
| 29 | `/pipeline`, `/gallery` | `lib/pipeline-queries.ts`, `lib/visuals.ts:80` | `COURSE_RANK` | no |
| 30 | Catalogue order | `lib/module-order.ts:98-152`, `lib/module-term.ts` | `COURSE_RANK`; term model from `COURSES` | no |
| 31 | Loader | `load_seed.py:237-241` | `COURSE_SUBJECTS` gains the course (`math`) | no (extraction) |
| 32 | Drift guard | `parity_check.py:42-54,112-115` | key by course id; one constant per course | no (extraction) |
| 33 | Deploy and local | `ci-cd.yml:603-640`, `scripts/local-dev.sh:179` | D5 per-course "load if absent" | no |
| 34 | Deploy check | `deploy/apply-migrations.sh:370-393` | none under A; repoint under B | — |

---

## 6. Principles, decisions and requirements touched

### 6.1 Minors' data (constitution VII): security-privacy-officer should review

- **Curriculum is not PII.** It does not identify a child on its own or combined with name and
  grade. It is a coarse category, and FR-302 already puts "curriculum system" in the student model.
- **It is still a new question asked of a minor.** FR-2002 lists what signup captures and forbids
  "school". A curriculum is not a school, but it is a weak **socio-economic proxy**, because
  international-curriculum schooling in Egypt is fee-paying. So:
  (a) only ask it where it changes what the child gets (D2's "two or more offered" rule);
  (b) keep it first-party, never a GA4 property;
  (c) never show it to another student;
  (d) VII's list ("name, grade, and the interest signals") should gain a PATCH clarification that
  the curriculum is part of "grade" (which book serves that year), or the ADR should say so.
- Changing a child's curriculum is a `student-data` act (FR-2707), recorded with operator and time.

### 6.2 Solution integrity (constitution XI)

- No student data crosses solutions. `course_availability.environment` and `students.environment`
  are unchanged. The frozen `family-tutor` baseline is unaffected.
- **Pooling within one solution.** XI forbids pooling across environments and solutions. Two
  curricula are not two solutions, but one maths heatmap over two different books means nothing.
  The Overview cohort should include the course (D5 row 26).
- **Drift guard**: `parity_check.py` must be keyed by course. Otherwise the Prep-3 constant fails
  as soon as G10 loads, and anyone "fixing" it by raising the numbers would hide real drift.

### 6.3 Other principles, ADRs and requirements

| Item | Effect |
|---|---|
| Constitution, Additional Constraints: *"Curriculum truth is the Egyptian ministry book"* | Siyavula is not a ministry book. Needs a **MINOR** amendment: "the book of the course's curriculum". |
| Constitution II (grounded teaching) | Unchanged. The tutor teaches what **this** book says, which is why the book name in the prompt must be true (row 4). |
| Constitution III and ADR-0019 | "The whole maths bank is live" names Prep-3 maths in its CI step. Whether it extends to G10 is Q7. The default-deny gate protects either way. |
| Constitution IV | Dormant for maths; untouched. |
| Constitution IX and ADR-0020's prompt hold | Prep-3 captures byte-identical; G10 prompt files are new and need Samuel's go (Q8). |
| Constitution X | The L1 deploy step is a bounded exception to "a normal code deploy can never touch data" (Q11). |
| Constitution XII and ADR-0017 | Grade 10 is Secondary, so Master, which is hidden, so Play. First Secondary cohort (Q10). ADR-0017 anticipated "non-Egyptian grade structures" as a revisit trigger. The grade numbers still line up, only the labels differ. |
| ADR-0018, FR-2701/2702/2704/2705/2709 | Amended: curriculum dimension; the switch suspends rules but not scoping (Q2). FR-2705's reader list grows by the four ungated readers. |
| FR-2002, FR-2006, FR-2013, FR-302 | D2. |
| FR-3217, FR-3218 | "One subject" becomes "one course". Term eyebrow only for courses with terms. |
| Stale headers | `lib/catalog.ts:5`, `lib/catalog-queries.ts:27`, `(console)/courses/page.console.tsx:19` still say "NO REQUIREMENT COVERS THIS", but FR-2701…FR-2711 exist. Fix them in the same work (Spec Kit rule). |

---

## 7. Size estimate

For one agent-engineer with tests, before multi-agent review. The book's extraction and its content
QA are **not** included.

| Piece | Size | Agent-days |
|---|---|---|
| Registry split (`lib/courses.ts`, `lib/curricula.ts`, about 19 importers) | M | 1–1.5 |
| Gate and scope helper, pure-rule tests, wiring test, guard scans | M | 1–1.5 |
| Student readers (rows 7–16, 18) | M–L | 1.5–2 |
| Per-course prompt facts and capture proof | S | 0.5 |
| Sign-up, Google step, API, analytics | M | 1–1.5 |
| Console (rows 22–29), including the `/courses` sections and the Student 360 editor | M–L | 1.5–2 |
| Migration 033, rollback, post-flight check | S | 0.5 |
| Load step (CI and local), `parity_check` by course, loader map | S–M | 0.5–1 (shared with extraction) |
| ADR-0024, constitution amendment, FRs in `spec.md`, traceability | S–M | 0.5–1 |
| **Total** | **L** | **≈ 8–11** |

Option B instead of A for D3 adds about 2 days. The fast hack in D1.2(i) takes about 1 day but
leaves D2 and D3 undone and sets up the 007 data-loss trap.

---

## 8. What this design needs from the extraction work (for `spec.md` and the pipeline docs)

These are constraints, not id choices. The spec owns the final ids.

1. **Course id** matches `^course:[a-z0-9-]+$` (`module-order.ts:130`). It encodes the curriculum
   so a future National G10 maths does not collide. Example: `course:us-g10-math-en`.
2. **Lesson and LO ids**: `lo:<prefix>-<lesson>-<n>`, where `<prefix>` is `[a-z0-9]{1,12}`
   (`SLUG_RE`, `028:95`), unique across every course, and **not starting `geo` or `t2`**. Example:
   `lo:us10c3-2-1` gives slug `us10c3-2`.
3. **Module ids** must not match `module:geo%` or `module:t2-%`. **Topic, question and visual ids**
   must be namespaced, or the loader's collision guard refuses them (`load_seed.py:611-626`).
4. **Subject key `math`** in `COURSE_SUBJECTS`. **Not** a new spine key (D1.2(i)).
5. A **`program:<curriculum>` node** with `course part_of program` (the D1.1 graph echo).
6. `source_document.grade` of `'10'`, the real title and publisher, and `language: 'en'`.
7. **Lesson titles** in the bundle or in `CourseDef.lessonTitles`. Otherwise the check-in shows the
   first objective's label.
8. **Naming**: Siyavula *Everything Maths* is written to South Africa's CAPS syllabus. Calling it
   "American" is a product decision (Q3). The tutor will teach CAPS content, because the book wins
   (constitution II).

---

## 9. Questions for Samuel

1. **Shared courses.** Will any course be offered to more than one curriculum with *different*
   visibility per curriculum, for example the ministry Arabic book for American-track students?
   No: D3 option A. Yes, soon: option B (about 2 more days, new table).
2. **The kill switch.** Should curriculum scoping stay in force when `AINEXT_COURSE_GATING` is off?
   (Recommended: yes. It amends FR-2709.) And what is production's value today
   (`gh variable get AINEXT_COURSE_GATING --repo samtoma/AI.NEXT`)?
3. **Naming.** Siyavula is CAPS (South African). Should the curriculum be labelled "American",
   "International", or something else?
4. **Ids.** Keep `eg-national-en` for National (every student already has it). Use `us-american-en`
   for the new one?
5. **Sign-up with one curriculum offered**: store it silently, or show a read-only line? And is the
   one-screen grade and curriculum step after a first Google sign-in acceptable?
6. **Changing a student's curriculum**: console only (`student-data`) for now, with student
   self-service when FR-2013's editor is built?
7. **Review of the G10 bank.** Does ADR-0019's "whole maths bank live" extend to it, or do its
   `review` questions stay unserved?
8. **Prompt hold (ADR-0020).** OK to add G10 prompt files, with Prep-3 captures byte-identical? And
   to make the book name per course, with Prep-3 keeping "Egyptian ministry textbook" word for word?
9. **Probing** on the G10 course: off until #53 closes, or allowed for testers like Prep-3?
10. **Design variant.** The first Secondary cohort gets Play while Master is hidden. Acceptable?
11. **Production load.** The additive "load if absent" deploy step (an exception to constitution X,
    with first-boot precedent), or retarget `refresh-content` to noor first and load by hand?
12. **Constitution amendments.** "Curriculum truth" becomes per course (MINOR), plus the VII
    clarification (PATCH). Approve for the ADR?
13. **Grades at launch.** American grade 10 only? And should grade-10 **National** students keep
    seeing Prep-3 maths, if today's rules make it live for grade 10?
14. **Overview.** Split the cohort by course (recommended) or by curriculum?

---

## 10. Pre-existing defects found in passing (not caused by this feature)

1. **`/dashboard` is ungated** (`lib/dashboard.ts:37-100`, also `/api/dashboard`). It lists every
   loaded course's modules as "not started", including hidden Arabic and Social Studies ones. This
   is an FR-2705 gap.
2. **The Ask context lists every ingested book** (`lib/ask.ts:168-169`, `:305-312`). Hidden books'
   titles reach the tutor, and **loading any new book changes every student's Ask prompt**. This
   collides with ADR-0020's hold.
3. **`source_documents LIMIT 1` with no ORDER BY** on `/` and `/spine` (`lib/queries.ts:87`, `:181`)
   is non-deterministic with three books loaded.
4. **`/api/visuals` serves any figure by id**, ungated. Figures only, no answers.
5. **`refresh-content` targets the frozen baseline stack** (`refresh-content.yml:43`,
   `refresh-content.sh:67`). There is no manual content path onto noor.
6. **Migration 007 NULLs any `understanding_checks.subject` outside `('math','social','arabic')` on
   every deploy** (`007:66-72`). This is a latent data-loss trap for any fourth spine key.
7. **Stale "no requirement" headers** on the course gate (§6.3).

---

## Appendix A — Read-only checks to run on production before building

```sql
-- the gate's current rules (what a grade-10 student sees today)
SELECT course_id, grade, state, note, updated_at FROM course_availability
 WHERE environment = 'mvp1' ORDER BY course_id, grade;
-- every student's curriculum and grade (expect eg-national-en everywhere)
SELECT curriculum_system, grade, count(*) FROM students
 WHERE environment = 'mvp1' GROUP BY 1, 2 ORDER BY 1, 2;
-- courses and books loaded
SELECT id, subject FROM graph_nodes WHERE kind = 'course';
SELECT sha256, title, grade, subject, ingested_at FROM source_documents ORDER BY ingested_at;
```

Plus `gh variable get AINEXT_COURSE_GATING --repo samtoma/AI.NEXT`.
