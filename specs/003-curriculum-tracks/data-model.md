# Data model — 003 Curriculum Tracks

**Authority level**: derived design for [plan.md](./plan.md). The shapes are pinned by
[ADR-0024](../../docs/decisions/0024-curriculum-as-a-visibility-dimension.md) (drafted) and
Samuel's decisions ([decisions.md](./decisions.md)). Column-level detail may move while the backend
package builds migration 033. When it does, this file is updated in the same work.

Nothing below changes `course_availability` or `student_course_access` (migration 023). That is
deliberate (decision 2): it keeps every rollback in CI's migration proof safe.

## 1. In app code (registries, no database)

### Curriculum — `app/src/lib/curricula.ts` (new)

| Field | Type | Notes |
|---|---|---|
| `id` | `CurriculumId` = `"eg-national-en" \| "us-american-en"` | Closed union; adding one is a compile error everywhere a `Record<CurriculumId, …>` must be completed. |
| `label` | string | "National", "American" — flat, never a tier (FR-4016). |
| `labelAr` | string | For Arabic-capable surfaces (Principle V). |
| `gradeLabels` | `Record<Grade, string>` | National: Prep 1…Secondary 3 (today's `GRADE_LABELS`). American: Grade 7…Grade 12 (FR-4013). |
| `programNodeId` | string | National: `program:bakaloreya-track` (exists). American: `program:us-american-en` (new, written by the loader). |
| `order` | number | Registry order: National first. Used by the console's sections and `COURSE_RANK`. |

`DEFAULT_CURRICULUM = "eg-national-en"`: the existing column default, so existing students already hold
it (FR-4003). *(Changed 2026-10-01, answer 36: no longer the value sign-up stores silently when a grade
offers none — FR-4005 now always asks there. It remains the value an implied curriculum automatically
re-resolves to on a grade change, FR-4008, when the new grade offers no curriculum.)*

### Course — `app/src/lib/courses.ts` (new)

*Aligned 2026-09-25 with the shape WP-A wrote in `app/src/lib/courses.ts`; the code is the authority
for field names.*

| Field | Type | Prep-3 maths | G10 American maths |
|---|---|---|---|
| id (the key) | string, `^course:[a-z0-9-]+$` | `course:prep3-math-en` | **`course:us-g10-math-en`** |
| `subject` | `Subject` (registry) | `math-en` | `math-en` (spine key `math`, never a new key: migration 007) |
| `curriculum` | `CurriculumId` | `eg-national-en` | `us-american-en` |
| `grades` | string[] — information, not a gate | `["9"]` | `["10"]` |
| `label` | string (console) | "Mathematics — Prep 3" | "Mathematics — Grade 10" |
| `book` | string | the ministry book's title | "Everything Maths — Grade 10 (Siyavula)" |
| `terms` | `{ rules: TermRule[]; defaultTerm } \| null` | geometry → term 2 (rank 2), `t2-` → term 2 (rank 1), default term 1: today's `TERM_RANK` | `null` (no terms, FR-4203) |
| `probing` | boolean; exactly one course may be `true` | `true` (today's `PROBING_COURSE_ID`) | `false` (decision 7, FR-4212) |

**Prompt-facing facts per course.** These are the tutor's book name (Prep-3: exactly `"Egyptian
ministry textbook"`), the syllabus line, the fallback figure, lesson titles and the geometry-lesson
test. They are keyed by course. Whether they sit on `CourseDef` or in the prompt kit keyed by course
id is WP-E's choice (T320). The requirement is that Prep-3's values stay byte-identical (FR-4206)
and G10's refer to "this book" (FR-4205).

Social Studies and Arabic get a `CourseDef` each, carrying exactly today's values.

`SubjectDef.courseId` is **removed**. Every `SUBJECTS[…].courseId` and `courseIdOfSpineKey` reader
moves to a scoped lookup (research §5). Guard test 2 stops them returning.

**Derived**: `COURSE_RANK`, meaning registry order by curriculum, then subject, then course.
`SUBJECT_RANK` stays as an alias for one release. `TERM_RANK`'s SQL CASE is generated from every
course's `terms`, byte-identical for Prep-3.

**Invariants** (the registry cross-check test, no database needed):
1. Every course in `services/extraction/seed/**` or `services/extraction/books/*.json` is in `COURSES`,
   with the same subject and curriculum.
2. A bundle's `course part_of program:` edge, if present, matches its curriculum's `programNodeId`.
3. Lesson-slug prefixes are unique across all courses. No prefix starts with `geo` or `t2` except
   Prep-3's own.
4. Module ids of a course without terms never start `module:geo` or `module:t2-`.

## 2. In the database

### `students` — existing table, two new columns (migration 033)

| Column | Type | Status | Meaning |
|---|---|---|---|
| `curriculum_system` | `text NOT NULL DEFAULT 'eg-national-en'` | **exists** (009) | The student's curriculum id. **No CHECK**: validated in app code against the registry, and an unknown value matches no course (FR-4003). |
| `curriculum_source` | `text NOT NULL DEFAULT 'implied'` | **new** | `'chosen'` (answered at sign-up or in the Google step, or set by an operator) or `'implied'` (stored without asking). Existing rows become `'implied'` through the default. The value set is small and closed, so a CHECK is safe here, unlike a curriculum CHECK: nothing will ever widen it. |
| `onboarding_pending` | `boolean NOT NULL DEFAULT false` | **new** | True only for an account created by a first Google sign-in, until the grade-and-curriculum step completes (FR-4014). Existing rows and password sign-ups are false. |

### `student_curriculum_changes` — new, append-only (migration 033)

One row per change after sign-up (FR-4012). The shape follows 030's `teaching_setting_changes`.

| Column | Type | Notes |
|---|---|---|
| `id` | `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY` | |
| `environment` | `text NOT NULL` | No default (002 FR-2109). |
| `student_id` | `bigint NOT NULL REFERENCES students(id) ON DELETE CASCADE` | |
| `from_curriculum` | `text NOT NULL` | |
| `to_curriculum` | `text NOT NULL` | |
| `to_source` | `text NOT NULL CHECK (to_source IN ('chosen','implied'))` | |
| `changed_by` | `bigint REFERENCES operators(id)` | NULL only when the product re-resolved an implied curriculum (FR-4008). |
| `reason` | `text NOT NULL CHECK (reason IN ('operator','grade_change_reresolved'))` | |
| `note` | `text` | The operator's own words. |
| `changed_at` | `timestamptz NOT NULL DEFAULT now()` | |

**Privileges.** ENABLE and FORCE row-level security, with 017's per-student policy idiom, because
these are per-child rows. `ainext_operator` gets SELECT and INSERT; `ainext_app` gets nothing. There
is no UPDATE or DELETE for anyone, so the table is append-only by privilege. A grade-change
re-resolution by the student's own editor would run as `ainext_app`, but that editor does not exist
yet (FR-2013 PARTIAL). When it does, it writes through a definer function, not a grant.

### The initial value at sign-up

The initial value is written by the INSERT that creates the student (`ainext_app` keeps INSERT) and
recorded on the first-party `account_created` event: `properties: { method, grade, curriculum,
curriculum_source }`. It never goes to GA4 (FR-4016). *(Changed 2026-10-01, answer 36 — supersedes the
`curriculum_resolved_from` property this row used to describe: sign-up now always asks and names every
curriculum, so a chosen curriculum is never resolved away from what the student picked. `account_created`
no longer carries `curriculum_resolved_from`; see [contracts/student-api.md](./contracts/student-api.md).)*

### Privileges on `students` — "console-only" as a database fact (FR-4017, privacy review F8)

Migration 017 re-runs every deploy and issues `GRANT SELECT, INSERT, UPDATE ON students TO
ainext_app`, which is table-wide. **In Postgres a column-level `REVOKE` does not remove a table-level
grant.** So 033, which sorts after 017, does the following on every run:

```sql
REVOKE UPDATE ON students FROM ainext_app;                 -- the table-wide grant 017 just re-issued
GRANT  UPDATE (design_variant) ON students TO ainext_app;  -- the only column the student app writes today
GRANT  UPDATE (curriculum_system, curriculum_source) ON students TO ainext_operator;
-- DO $verify$: has_column_privilege('ainext_app','students','curriculum_system','UPDATE') IS FALSE,
--              …'curriculum_source'… IS FALSE, …'onboarding_pending'… IS FALSE;
--              has_column_privilege('ainext_app','students','design_variant','UPDATE') IS TRUE.
```

The column list for `ainext_app` must be **every column the student app updates today**. A search on
2026-09-25 found one, `design_variant` (`lib/design-variant-queries.ts:219`); the subscription route is
the console's. The backend package re-runs that search before writing 033. `curriculum-privilege.test.mts`
scans `app/src` for `UPDATE students SET <col>` outside console files and fails on a column not in
033's list, so a future writer cannot be broken silently by the narrower grant.

### The once-only Google step — `complete_student_onboarding(p_grade text, p_curriculum text)`

A `SECURITY DEFINER` function owned by `ainext_maint`, with `search_path` pinned and
`EXECUTE` granted to `ainext_app` only. The steps:

1. Read the acting student from `current_setting('app.student_id')`. Missing means raise.
2. `UPDATE students SET grade = p_grade, curriculum_system = p_curriculum,
   curriculum_source = <'chosen' if asked, else 'implied'>, onboarding_pending = false
   WHERE id = <acting> AND onboarding_pending`. *(Note, 2026-10-01, answer 36: the route always calls
   this with `'chosen'` now — `resolveInitialCurriculum` no longer returns `'implied'` on the sign-up
   or onboarding path, since a missing answer is refused rather than resolved. `'implied'` survives
   only for a pre-reversal row, and for `resolveOnGradeChange`'s re-resolution of one of them when the
   grade changes (FR-4008) — a different function, not this one.)*
3. **Zero rows updated raises `onboarding_already_completed`.** A second call fails loudly and never
   succeeds as a no-op (FR-4014, F10).

The function validates neither grade nor curriculum. The route validates both against the registry
and the offered rule before calling it, as the sign-up route does.

### Graph and content (loaded by the pipeline and the load action, not by migrations)

- `graph_nodes`: `program:us-american-en` (kind `program`), `course:us-g10-math-en` (kind `course`),
  modules `module:g10m-cNN`, lessons and objectives `lo:g10m<ch>s<sec>-<part>-<n>`, with `course
  part_of program:us-american-en`.
- `node_subject` (007): subject `math`, course `course:us-g10-math-en`.
- `source_documents`: one row for the learner PDF, which is the citation authority, with `grade = '10'`,
  the real title and publisher, and `language = 'en'`. The EPUB hash and the Teacher's Guide hash are
  in the manifest and the extraction run.
- `questions`: the book questions (`source = 'seed'`), generated items (`'variant'`) and widget items
  (`question_type = 'widget'`), each with `lo_id` inside the course. A question marked by the
  expression marker keeps `question_type = 'short'` and carries its answer spec in `choices`
  (`{"marker": {...}}`, [contracts/answer-marker.md](./contracts/answer-marker.md)). **No
  `question_type` CHECK is widened**, because re-run migrations narrowing a widened CHECK caused the
  2026-09-23 outage. **Where a solution came from** (FR-4302) — `book_worked`, **`book_worked_epub`**
  (an EPUB worked solution, not printed in the PDF), `teachers_guide`, or `answer_anchored` (kept for
  books without worked solutions) — lives in the pipeline's
  `solution_provenance` field (B7) and is recorded in `source_note` in a fixed form that
  `lib/provenance.ts` parses. **No new column** unless the console's count (FR-4309) cannot be computed
  from that. If it cannot, the backend package adds a nullable `solution_provenance text` in 033 with
  no CHECK.
- `misconceptions`, `explanation_library`: the course's catalogue, `mc:` ids scoped to its objectives.

**What the load never writes**: a `course_availability` row (FR-4202).

### Book sections — proposed migration 034 (FR-4311…FR-4319, decision 18)

A lesson today is a lexical group of objectives (`lo.id LIKE 'lo:<slug>-%'`), with no row of its own,
so there is nowhere to attach a lesson's book provenance. **Proposed**: one small **content** table,
shaped like `graph_nodes`. It is not student data: there is no RLS, both roles have SELECT, and only
the loader writes it. The backend package may place it elsewhere, provided the change is recorded here
first.

| Column | Type | Meaning |
|---|---|---|
| `course_id` | `text NOT NULL` | the course (not a foreign key, like migration 023's tables) |
| `lesson_slug` | `text NOT NULL` | the lesson; `PRIMARY KEY (course_id, lesson_slug)` |
| `title` | `text NOT NULL` | the lesson's title |
| `sections` | `text[] NOT NULL` | printed section numbers covered, in order (`{"1.2","1.3"}` for merge P3a) |
| `section_titles` | `text[] NOT NULL` | their printed titles |
| `part_n`, `part_of` | `smallint NULL` | set only for a part of a split section (1 of 3 …) |
| `chapter_intro` | `boolean NOT NULL DEFAULT false` | a promoted introduction (P2a, P2b) |
| `group_key` | `text NOT NULL` | the section a part belongs to (`"1.7"`); equals the single section for any other lesson |

- **National courses** get one row per lesson, with one section each and no parts, derived from their
  existing slugs and titles. That is what makes FR-4311 hold for every curriculum, with nothing they
  show changing.
- **Part prerequisites** (FR-4317) are **derived at read time** from `group_key` and `part_n`:
  every objective of part *n*−1 is treated as a prerequisite of part *n*'s objectives. They are
  **never written into `graph_edges`**, so the book's own edges stay exactly the book's and nothing
  needs an "origin" column.
- **Re-runnable**: `CREATE TABLE IF NOT EXISTS`, no CHECK that could narrow, and grants repeated safely
  (FR-3213). The rollback drops the table and loses only loader-written content.

### Course outline — migration 037 (FR-4322…FR-4327, decision 59) — **built**

The whole book's structure, before its content is prepared. **Not** more rows in `course_lessons` (034):
that table is the provenance of the lessons that *are* loaded and the content loader prunes it
(`load_seed.py --replace`), it has no chapter or reading order, and every reader of it treats a row as a
lesson that exists. One content table of its own, written by `services/extraction/load_course_outline.py`
from the book's manifest and read only by `lib/course-outline-queries.ts`. No row-level security;
`ainext_app` and `ainext_operator` hold SELECT, only `ainext_maint` writes (asserted in the migration).
Rollback: `rollback/037-course-outline.down.sql`.

| Column | Type | Meaning |
|---|---|---|
| `course_id` | `text NOT NULL` | the course (not a foreign key, like 034); `PRIMARY KEY (course_id, lesson_slug)` |
| `lesson_slug` | `text NOT NULL` | the lesson, as the pipeline mints it (`g10m<ch>s<sec>-<part>`) |
| `module_id`, `module_label`, `module_order` | `text`, `text`, `integer` | the chapter node it becomes when loaded (`module:g10m-c01`), its label ("Chapter 1 — Algebraic expressions") and its place in the book |
| `book_order` | `integer NOT NULL` | the lesson's place in the whole book, 1…N — the reading order; `UNIQUE (course_id, book_order)` |
| `title`, `sections`, `section_titles`, `part_n`, `part_of`, `chapter_intro`, `group_key` | as 034 | the same book provenance, with the same meaning, so an unprepared lesson is named as it will be once loaded |
| `page_from`, `page_to` | `integer NULL` | its printed pages |
| `source`, `loaded_at` | `text`, `timestamptz` | where the row came from (the manifest and its gate), and when |

- **Readiness is not stored.** There is no "prepared" column. A lesson is prepared exactly when its
  objectives are loaded in the student's gated catalogue (`getLessonCatalog`, `lib/lesson.ts`), derived at
  read time by `lib/course-outline.ts`. The fan-out needs no extra step, and a lesson can never read as
  prepared while having nothing to teach (constitution II).
- **Gating is the reader's.** An outline is read only for course ids the caller has already gated, so a
  student sees the titles of a book she may see and of no other (FR-4006). A National course has no rows and
  is rendered exactly as before (FR-4206).
- **Re-runnable**: `CREATE TABLE IF NOT EXISTS`, structural CHECKs created with the table, the unique
  index only when missing, grants repeated (FR-3213).

### Review stamps and the review gate — migrations 035 and 036 (FR-4501…FR-4509) — **built**

- **035** `db/migrations/035-human-review-stamps.sql` adds `questions.ai_checked_by`, `ai_checked_at`,
  `hold_reason` and `review_note`, and splits the legacy `reviewed_by` strings: an AI check goes to
  `ai_checked_by`, a free note to `review_note`, a figure mark to `hold_reason`. `reviewed_by` now holds a
  human's stamp and nothing else (FR-4506). CHECK `questions_held_not_live`. Rollback
  `rollback/035-human-review-stamps.down.sql` round-trips; only bulk-promotion times are lost.
- **036** `db/migrations/036-review-gate.sql` adds `review_decisions` (append-only by trigger; one row per
  human verdict with a content fingerprint, a snapshot and exactly what changed) and `review_claims`
  (ephemeral, one row per item, expiring). **The backlog itself is not stored**: the console derives it on
  every read from the content tables and from the pipeline's gate records, minus what a human has decided
  (FR-4501). `ainext_app` holds no privilege on either table, so review status never reaches a student
  surface (ADR-0019). Depends on 035 and fails without it. Rollback `rollback/036-review-gate.down.sql`.

### Planned, not built — `questions.parent_kind` (migration 038, decision 61, T448)

For a family modelled on a book **teaching item** (FR-4304): `questions.parent_kind text NOT NULL DEFAULT
'question'` with values `question` | `teaching`, and the foreign key on `parent_question_id` replaced by a
trigger that checks the id against `questions` or against the worked-example rows of `explanation_library`
by kind. Existing rows take the default and change in no way. **Not built, no migration exists**: the plan is
in `docs/WIP-g10-pilot/README.md` ("Handoff — family-parent agent (answer 40)"), and this section is updated
in the same work as the migration.

### Unchanged, stated so nobody changes them by accident

- `course_availability (environment, course_id, grade, state, …)` keeps its UNIQUE key and its
  migration 023 `ON CONFLICT` target.
- `student_course_access` keeps its forced RLS and its SELECT-only grant to `ainext_app`.
- `student_progress (student_id, course_id)` (028) is already per course, which is why changing a
  curriculum loses nothing (FR-4011).
- `understanding_checks.subject`: the spine key stays `math`, so migration 007's clean-up never fires
  on G10 rows.

## 3. State: a student's curriculum

```
                 sign-up / Google step (once)
   (none) ──────────────────────────────────────► chosen | implied
                                                      │
          operator changes it (student-data, FR-4010) │  → chosen, history row
          ◄───────────────────────────────────────────┤
                                                      │
      grade changes: chosen → kept, flagged (FR-4008)  │
                     implied → may re-resolve          │  → implied, history row (reason
                                                      │     grade_change_reresolved)
      operator hides a course → nothing changes (FR-4007); empty state; console counts and flags
```

## 4. Rollback (`db/migrations/rollback/033-curriculum-tracks.down.sql`)

The rollback:
- drops `complete_student_onboarding`;
- drops `student_curriculum_changes`;
- drops `students.curriculum_source` and `students.onboarding_pending`;
- revokes the operator's column grant;
- re-grants `UPDATE ON students TO ainext_app`, which 017 would also do on its next run.

`curriculum_system` **stays**, because it predates 033. What is lost: every change's who and when, and
whether each curriculum was chosen or implied. Nothing a student produced is lost. **Before rolling
back the code**, hide the American course or turn the gate on (ADR-0024, Consequences).
