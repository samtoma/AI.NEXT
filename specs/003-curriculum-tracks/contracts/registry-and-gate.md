# Contract: curriculum and course registries, the gate, and the student scope

**Files**: `app/src/lib/curricula.ts` (new), `app/src/lib/courses.ts` (new), `app/src/lib/subjects.ts`,
`app/src/lib/catalog.ts`, `app/src/lib/catalog-queries.ts`, `app/src/lib/module-order.ts`,
`app/src/lib/module-term.ts`
**ADR**: [0024](../../../docs/decisions/0024-curriculum-as-a-visibility-dimension.md) · **Enforces**:
FR-4001…FR-4004, FR-4006, FR-4009, FR-4015, FR-4101, FR-4203, FR-4212

## Registries

`lib/curricula.ts` and `lib/courses.ts` import nothing but types and each other, so that
`lib/catalog.ts` stays pure (ADR-0018). Their shapes are in [data-model.md](../data-model.md) §1.
Lookups:

```ts
curriculumOf(courseId: string): CurriculumId | null   // null: not a registry course → hidden
isKnownCurriculum(v: unknown): v is CurriculumId
coursesOf(curriculum: CurriculumId): readonly CourseDef[]
courseDef(courseId: string): CourseDef | null
gradeLabel(grade: string, curriculum: CurriculumId | null): string  // FR-4013; null → today's label
```

## The rule — `lib/catalog.ts` (pure)

```ts
isCourseVisible(courseId, student: { grade, curriculum }, rules, overrides): boolean
```

The rule is evaluated in this order. Every path that does not reach an explicit "yes" returns
`false`.
1. An override for `courseId` decides it, in both directions and across curricula (FR-4009).
2. If `curriculumOf(courseId)` is `null` or differs from `student.curriculum`, the course is hidden
   (FR-4002, FR-4006). An unknown `student.curriculum` therefore sees nothing but overrides (FR-4003).
3. If `canonicalGrade(student.grade)` is `null`, the course is hidden.
4. A `live` rule for (course, canonical grade) shows the course (FR-4101).
5. Otherwise the course is hidden.

**With the gate off** (`COURSE_GATING = false`, FR-4015), steps 3–5 become "loaded". The student
sees every loaded course of her own curriculum, plus overrides. Step 2 never switches off.

```ts
offeredCurricula(grade, rules, loadedCourseIds, gatingOn): CurriculumId[]   // FR-4004, pure
```

This is the one rule. `offeredCurricula` returns the curricula in registry order that have at least
one course with a `live` rule for the grade. With the gate off it uses the curricula with at least one
loaded course whose `grades` include it. Sign-up, the Google step, the console's per-grade line
(FR-4102) and the grade-change re-resolution (FR-4008) all call it. No reader re-derives it.

```ts
resolveInitialCurriculum(grade, submitted: string | undefined, offered): { curriculum, source }
```

This returns one of four results (FR-4005, privacy review F12):
- two or more offered, and `submitted` among them → `{ submitted, "chosen" }`;
- two or more offered, and `submitted` missing or not offered → an error the form shows;
- exactly one offered → `{ that one, "implied" }`, whatever was submitted;
- none offered → `{ "eg-national-en", "implied" }`.

When a submitted value was ignored because the grade no longer offers it, the caller records
`curriculum_resolved_from` on `account_created`.

## The student scope — `lib/catalog-queries.ts`

```ts
resolveStudentScope(db, studentId): Promise<StudentScope>
type StudentScope = {
  studentId; grade; curriculum; curriculumKnown: boolean;
  courses: ReadonlySet<string>;            // visible course ids
  lo(id): boolean; module(id): boolean;    // graph predicates (visibleGraphFor's)
  doc(sha256): boolean;                    // a source document behind a visible course
  courseForSubject(spineKey): string | null;  // the visible course of that subject; own curriculum first; null → 404
}
```

It makes **one** read of the student's grade, curriculum, rules and overrides, and **one** graph walk.
`visibleCoursesFor` and `visibleGraphFor` become thin wrappers, so their callers compile unchanged.
Every student-side reader takes the scope; the reader list is in plan A3.

## Order

- `COURSE_RANK`: registry order by curriculum, then subject, then course. `SUBJECT_RANK` is kept as
  an alias for one release.
- Inside a course, **the parts of one book section are consecutive, in part order** (FR-4312,
  `lib/book-sections.ts`). For a course with no parts this changes nothing.
- A list of one course uses `MODULE_ORDER` alone. A list of several courses puts `COURSE_RANK` first
  (FR-3217 extended by FR-4009).
- `TERM_RANK` is generated from every `CourseDef.terms`. For Prep-3 it is byte-identical.
  `termOfModule`, `moduleHeading` and `isGeoModule` take the course. A course with `terms: null`
  prints no "Term N ·" label (FR-4203).

## Guard tests (source scans, no database)

| Test | Fails when | Covers |
|---|---|---|
| `student-scope-guard.test.mts` | a function reachable from `(student)/**` or a non-console `api/**` route reads `graph_nodes`, `questions`, `visuals`, `source_documents` or `node_subject` without the scope and is not on the listed allow-list | FR-4006, FR-4202 |
| `course-literal-guard.test.mts` | a `"course:` literal appears outside `lib/courses.ts`, tests, fixtures and `scripts/capture-prompts.mts`; or `courseIdOfSpineKey` / `SUBJECTS[…].courseId` is used outside the registry and gate files | FR-4001, FR-4212 |
| `catalogue-order-guard.test.mts` (changed) | a multi-course list lacks `COURSE_RANK`; "one-subject" becomes "one-course" | FR-4009 |
| `catalog.test.mts` (extended) | the five-step rule is wrong in any branch, gate on or off; `offeredCurricula` or `resolveInitialCurriculum` is wrong | FR-4002…FR-4005, FR-4015 |
| `catalog-gate.test.mts` (extended) | a National and an American student each see anything but their own course, gate on **and** off; a tester's cross-curriculum override does not cross; **the tester's two maths courses interleave in any list** (privacy review F19) | FR-4006, FR-4009, SC-206 |
| `curricula-registry.test.mts` | a seed bundle or book config names a course not in `COURSES`, a `program:` edge disagrees with the curriculum, or a slug prefix collides | FR-4001, FR-4002 |
