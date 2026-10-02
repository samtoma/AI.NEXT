# Contract: the console for curricula

**Build**: `AINEXT_SURFACE=admin`. Every view passes through `authorize()` (002 FR-2106) and reads
through `ainext_operator`. The 002 obligations on every view (FR-2211, FR-2209) apply unchanged.
**Enforces**: FR-4101…FR-4105, FR-4010…FR-4012, FR-4212 (teaching page), FR-4309 (completeness)

## `/courses` — availability per curriculum, grade and course (role `content-review`)

`courseCatalog()` returns sections, not a flat grid:

```ts
type CourseCatalog = {
  gating: boolean;
  sections: Array<{
    curriculum: { id; label };                       // registry order
    gradeLabels: Record<Grade, string>;              // this curriculum's words (FR-4013)
    courses: Array<{
      id; label; book: { title; grades: Grade[] };   // grades the book is written for
      depth: CourseCompleteness;                     // FR-4309, below
      cells: Record<Grade, { state: "live" | "hidden" | "unset"; note; updatedBy; updatedAt }>;
    }>;
  }>;
  offered: Record<Grade, CurriculumId[]>;            // FR-4102 — offeredCurricula
};
```

- `POST /api/console/courses` validates `courseId` against `COURSES`, not `SUBJECT_IDS`. Its body and
  its role are otherwise unchanged (FR-2702, FR-2707).
- **Last live course of a curriculum for a grade (FR-4103).** When the change would leave a curriculum
  with no live course for a grade, the cell becomes an in-page question naming the course and
  "**N students** follow this curriculum in this grade and would have nothing to study". N is a
  count from a `CROSS_STUDENT_READS` entry owned by `content-review`, and no name or id appears.
  `course-count-guard.test.mts` scans the view and its copy and fails if a student name or id could
  be interpolated (privacy review F9).
- A `live` click on a grade the book is not written for asks in the page, like the empty-course
  question (FR-2710).
- Bulk actions work per section: "every National subject for Prep 3", "American Mathematics for
  every grade". Each is still one POST per cell.
- The page says what the kill switch does now: *"Gating off suspends these rules. Students still see
  only their own curriculum's courses."* (FR-4015). `scripts/course-gating.sh status` prints the
  same.

### `CourseCompleteness` (FR-4309)

```ts
{ chapters; lessons; objectives;
  bookQuestions: { live; held; bySolution: { book_worked; answer_anchored; teachers_guide } };
  workedExamplesOnly;                         // FR-4303 items kept as teaching material
  convertedToMcq;                             // FR-4303
  generated: { live; held; families };
  widget: { live; held };
  misconceptions: { total; withExplanation };
  underTierFloor: Array<{ loId; label; missing: Tier[] }>;   // FR-4305
  chaptersWithoutWidget: Array<{ moduleId; label }>;         // FR-4306
  drift: { status: "pass" | "fail" | "not-run"; checkedAt } }  // FR-4208 post-flight, F17
```

Every count is computed from the rows the view lists (FR-3212).

## Student 360 — curriculum (role `student-data`; opening it writes `operator_reads` as today)

The profile shows:
- "Curriculum: American (us-american-en) · chosen";
- a warning chip when the value is unknown, or when the grade no longer offers a chosen curriculum
  (FR-4008);
- the history (`student_curriculum_changes`, newest first).

The access panel lists every course grouped by curriculum, each with a reason: "her curriculum and
live for grade 10", "not her curriculum", "no rule", "hidden by rule", or "**exception — outside her
curriculum**" (FR-4105, privacy review F18).

### `POST /api/console/students/[id]/curriculum`

Registered in `lib/console-routes.ts` for `student-data` only and added to `matrix.test.mts`.

```jsonc
{ "curriculum": "us-american-en", "note": "School confirmed American curriculum" }
```

| Case | Result |
|---|---|
| role missing | `403`, `permission_denied` recorded (002) |
| unknown curriculum | `400 invalid_curriculum` |
| same as current | `409 no_change` |
| valid | In one transaction: `UPDATE students SET curriculum_system, curriculum_source='chosen'`, then INSERT `student_curriculum_changes (from, to, 'chosen', changed_by, 'operator', note)`. Returns `200` with the new record and the courses the student now sees. |

The editor asks in the page before posting, naming what the student will **stop** and **start**
seeing, and that progress is kept (FR-4010, FR-2710). No native dialog.

## Students list (roles `student-data`; `cost-billing` projection unchanged)

A "Curriculum" column is added to the `student-data` projection only. It is **not** added to the
`cost-billing` projection (privacy review F7).

## Overview — cohorts per course (FR-4104, decision 8)

The cohort key is `(course_id, grade, syllabus_version)`, where it was `(subject, grade, …)`. The
subject picker becomes a course picker grouped by curriculum. The heatmap covers one course's modules.

## Content, Cost, Feedback, `/pipeline`, `/gallery`

- **Content**: the switcher is over `COURSES` grouped by curriculum, not over `SUBJECT_IDS`. Held
  counts are per course.
- **Cost, Feedback**: figures are labelled by course. **Cost is reachable by `cost-billing` alone**, so
  curriculum and course appear there only as aggregate labels on totals. No per-student curriculum
  appears, and no join narrows to one student (privacy review F7).
- **`/pipeline`, `/gallery`**: `COURSE_RANK` order, and each list names its course.

## Teaching page (`/teaching`, role `teaching-controls`)

The page gains one line: *"Socratic probing can reach: Mathematics — Prep 3 (National). Not:
Mathematics — Grade 10 (American)."* It is derived from `CourseDef.probing` (FR-4212).
