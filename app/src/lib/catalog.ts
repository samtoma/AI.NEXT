/**
 * Course availability — the RULES, with no database anywhere near them
 * (migration 023, Samuel's call of 2026-09-21; ADR-0018).
 *
 * Requirements: 002's FR-2701…FR-2711 (the course gate), and 003's
 * FR-4002 (a course with no curriculum is hidden), FR-4006 (a student's
 * curriculum scopes everything the gate scopes), FR-4009 (the exception wins
 * across curricula) and the kill-switch amendment (decision A: the switch
 * suspends operator rules, not curriculum scoping). This header used to say
 * "no requirement covers this yet"; FR-2701…FR-2711 have existed since
 * 2026-09-22, and the note was stale.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SEPARATE, PURE MODULE
 * ---------------------------------------------------------------------------
 * This is a gate on what a fourteen-year-old can reach, which puts it in the
 * small set of decisions that must be *proved* rather than observed working.
 * A rule that lives inside a SQL string can only be tested against a database,
 * which means in practice it is tested once and then trusted. Split out, the
 * whole decision is a few lines of arithmetic over plain objects and every
 * branch — including the ones that are hard to reach in a running system, like
 * "the student has no grade" or "her curriculum is not one we know" — is a test
 * that runs in `node --test` in milliseconds.
 *
 * `lib/catalog-queries.ts` is the other half: it fetches the rows and applies
 * what is decided here. It holds no rule of its own.
 *
 * ---------------------------------------------------------------------------
 * THE RULE: EXCEPTION, CURRICULUM, THEN EXPLICIT ALLOW
 * ---------------------------------------------------------------------------
 *   1. A per-student override, if one names the course, decides it outright —
 *      in BOTH directions, and ACROSS CURRICULA (FR-4009). It can show a course
 *      the grade rule hides (one test student gets all three subjects, or the
 *      other curriculum's maths, without exposing them to the pilot) and hide
 *      one the grade rule shows.
 *   2. Otherwise the course must belong to the student's own curriculum. A
 *      course's curriculum comes from the course registry (`lib/courses.ts`);
 *      one the registry does not know has none, and is hidden from every
 *      student (FR-4002). A student whose stored curriculum the registry does
 *      not know matches no course at all.
 *   3. Otherwise a `live` rule for (course, this student's grade) shows it.
 *   4. Otherwise it is HIDDEN. **No row means hidden**, and that is the whole
 *      design rather than an omission: the most likely state in this table's
 *      life is "nobody has recorded anything about this course yet", and a
 *      course the extraction pipeline loaded overnight must not be on a child's
 *      screen before a person decided it should be.
 *
 * THE KILL SWITCH (`AINEXT_COURSE_GATING`, FR-2709 as FR-4015 amends it;
 * decision A). With the switch off, the operators' GRADE RULES are suspended
 * and steps 3–4 become "the course is loaded"; steps 1 and 2 still apply. A
 * student sees every loaded course of HER curriculum, plus any exception.
 * That is defence in depth for a loaded book: with the switch off, the
 * American maths book still reaches no National student. The caller says
 * whether the switch is off (by passing `switchedOff`, with the loaded
 * courses), so this module reads no environment.
 *
 * Nothing here reads a commercial status, and nothing here CAN: look at the
 * signature of `isCourseVisible` — the student's grade and curriculum, the
 * rules, the overrides. There is no commercial input to pass it.
 * `course_availability.requires_plan` exists as a column and is always NULL;
 * access is not gated on subscription in this release (FR-2404, FR-2711). The
 * console prints the column so an operator can see it is empty
 * (`lib/catalog-queries.ts` `courseCatalog`), and `lib/plan-gate.test.mts`
 * scans this module and the student surfaces to keep that the only reader.
 */

// Relative imports with an explicit `.ts`, like `lib/overview-rules.ts` — this
// module is loaded by `node --test`, which has no `@/` alias. Everything
// reachable from here imports nothing with side effects, so the whole graph
// runs outside the bundler.
import { GRADES as GRADE_VALUES, LEGACY_PREP3 } from "./profile.ts";
import {
  CURRICULA,
  CURRICULUM_IDS,
  DEFAULT_CURRICULUM,
  asCurriculumId,
  curriculumGradeLabel,
  type CurriculumId,
} from "./curricula.ts";
import { COURSES, COURSE_IDS, compareCourses, curriculumOfCourse } from "./courses.ts";

export type CourseState = "live" | "hidden";

/** One row of `course_availability`, reduced to what the decision needs. */
export type AvailabilityRule = {
  courseId: string;
  grade: string;
  state: CourseState;
};

/** One row of `student_course_access`, same reduction. */
export type StudentOverride = { courseId: string; state: CourseState };

/** What the rule needs to know about the student: her year and her track. */
export type GateStudent = {
  grade: string | null | undefined;
  /** `students.curriculum_system` as stored — validated here, never trusted */
  curriculum: string | null | undefined;
};

/**
 * The kill switch, when it is OFF (FR-4015): the grade rules are suspended
 * and a course is available when it is LOADED — present in the spine. Absent
 * (`undefined`) means the switch is on and the rules decide.
 */
export type SwitchedOff = { loaded: ReadonlySet<string> };

/**
 * The grades the product knows, in order, with the labels an Egyptian parent
 * or operator uses. Prep 1–3 is the preparatory stage, Secondary 1–3 the
 * thanaweya years; the numeric value is what `students.grade` stores.
 *
 * The VALUES come from `lib/profile.ts`, which already owns the list the signup
 * form validates against, and the labels are the National curriculum's
 * (`lib/curricula.ts`). A curriculum-specific label is `gradeDisplayLabel`'s
 * second argument (FR-4013).
 */
export const GRADES: readonly { value: string; label: string }[] =
  GRADE_VALUES.map((value) => ({
    value,
    label: CURRICULA[DEFAULT_CURRICULUM].gradeLabels[value],
  }));

/**
 * The label for a stored grade — in the named curriculum's own words when one
 * is given ("Grade 10" in the American curriculum, "Secondary 1" in the
 * National one, FR-4013), the National label otherwise, which is what every
 * surface printed before 003. An unknown value keeps its own text rather than
 * being renamed into a grade it is not.
 */
export function gradeDisplayLabel(
  grade: string | null | undefined,
  curriculum?: string | null
): string {
  if (grade == null || grade === "") return "—";
  const canonical = canonicalGrade(grade);
  const known = canonical != null && (GRADE_VALUES as readonly string[]).includes(canonical);
  return known ? curriculumGradeLabel(canonical, curriculum) : String(grade);
}

/**
 * The stored grade in the one form the rules are keyed by.
 *
 * `students.grade` holds TWO spellings of the same year: the legacy PoC pinned
 * every student to the literal `"prep-3"` and the baseline database is full of
 * those rows, while a row created since reads `"9"` (lib/profile.ts). Under
 * explicit allow the difference is not cosmetic — a `prep-3` row compared
 * against a rule written for `9` matches nothing, and the student sees an empty
 * product with no error anywhere to explain it. They are the same year, so they
 * are the same key.
 *
 * Returns `null` for a missing or blank grade. `null` is not a grade to look
 * up; it is "we do not know what year this student is in", and under explicit
 * allow that means no grade rule can apply.
 */
export function canonicalGrade(grade: string | null | undefined): string | null {
  if (grade == null) return null;
  const trimmed = String(grade).trim();
  if (trimmed === "") return null;
  return trimmed === LEGACY_PREP3 ? "9" : trimmed;
}

/**
 * May this student see this course?
 *
 * The steps of the rule, in order (see the header), and every path that does
 * not reach an explicit "yes" returns false. `switchedOff` is the kill switch
 * (FR-4015); leave it out and the rules decide, which is the strict reading.
 */
export function isCourseVisible(
  courseId: string,
  student: GateStudent,
  rules: readonly AvailabilityRule[],
  overrides: readonly StudentOverride[],
  switchedOff?: SwitchedOff
): boolean {
  // 1. the exception, decisive in both directions and across curricula
  //    (FR-4009) — with the switch on or off ("plus any exception", FR-4015)
  const override = overrides.find((o) => o.courseId === courseId);
  if (override) return override.state === "live";

  // 2. the curriculum: the course's own (a course the registry does not know
  //    has none, FR-4002) against the student's (an unknown value matches
  //    nothing — default-deny, never "National by default", FR-4003). This
  //    step never switches off.
  const courseCurriculum = curriculumOfCourse(courseId);
  if (courseCurriculum === null) return false;
  if (asCurriculumId(student.curriculum) !== courseCurriculum) return false;

  // the kill switch: the grade rules are suspended; a loaded course of her
  // own curriculum is available
  if (switchedOff) return switchedOff.loaded.has(courseId);

  // 3. the broad rule, for this student's own year
  const canonical = canonicalGrade(student.grade);
  if (canonical === null) return false;
  const rule = rules.find(
    (r) => r.courseId === courseId && canonicalGrade(r.grade) === canonical
  );

  // 4. and the default, which is the point of the whole design
  return rule?.state === "live";
}

/**
 * Every course this student may see, from the same inputs.
 *
 * The candidate set is every course the registry knows, every course either
 * lever MENTIONS, and — with the switch off — every loaded course. A course
 * none of them knows never appears, by construction rather than by a filter
 * that could be forgotten.
 *
 * Sorted, for a deterministic result a test can assert on. The order is NOT
 * product order: the order courses are presented in belongs to the registry
 * (`lib/courses.ts`), and a caller that used this array to lay out a page
 * would be taking its sequencing from a gate.
 */
export function visibleCourseIds(
  student: GateStudent,
  rules: readonly AvailabilityRule[],
  overrides: readonly StudentOverride[],
  switchedOff?: SwitchedOff
): string[] {
  const candidates = new Set<string>([
    ...COURSE_IDS,
    ...rules.map((r) => r.courseId),
    ...overrides.map((o) => o.courseId),
    ...(switchedOff ? switchedOff.loaded : []),
  ]);
  return [...candidates]
    .filter((courseId) => isCourseVisible(courseId, student, rules, overrides, switchedOff))
    .sort();
}

/**
 * Which course a student means by `?subject=<spine key>` — THE subject →
 * course lookup, and the only one outside the registries
 * (`student-scope-guard.test.mts`).
 *
 * `?subject=` is the tutor's handoff vocabulary (`switch_subject`, the subject
 * home's cards, the check-in's links) and it names a SUBJECT, of which a
 * student can now reach more than one course (a tester with an exception for
 * the other curriculum's maths). So, in order:
 *
 *   1. a course of that subject she may see, her own curriculum's first, then
 *      registry order;
 *   2. none visible, but the registry has one: her own curriculum's, else the
 *      registry's first. The caller finds no lessons in it and answers 404 —
 *      exactly what `?subject=social` answered before 003 for a student who
 *      may not see Social Studies. "Hidden from you" and "never existed" stay
 *      one answer (FR-2706);
 *   3. a subject the registry does not know: `null`, which the landing reads
 *      as "no subject named", never as maths.
 *
 * `coursesOfSubject` is the registry's list for that key, in course order —
 * `coursesOfSpineKey` in `lib/subjects.ts` — passed in so this module does not
 * import the subject registry at runtime.
 */
export function courseForSubject(
  coursesOfSubject: readonly string[],
  visible: (courseId: string) => boolean,
  curriculum: string | null | undefined
): string | null {
  if (coursesOfSubject.length === 0) return null;
  const own = asCurriculumId(curriculum);
  const ranked = [...coursesOfSubject].sort(
    (a, b) =>
      Number(curriculumOfCourse(b) === own) - Number(curriculumOfCourse(a) === own) ||
      compareCourses(a, b)
  );
  return ranked.find(visible) ?? ranked[0];
}

/**
 * Which curricula a grade OFFERS (FR-4004; decision 1: "only when the grade
 * has live courses in two or more curricula, as decided in the console").
 *
 * A curriculum is offered for a grade when some registry course of it has a
 * `live` rule for that grade in this environment. With the kill switch off
 * (`gatingOn === false`, FR-4015), when some LOADED registry course of it is
 * written for that grade (`CourseDef.grades`). Registry order.
 *
 * ONE rule for sign-up, the first-Google-sign-in step, the console's per-grade
 * "offered" line (FR-4102) and the grade-change re-resolution (FR-4008), so
 * they can never disagree about what a grade offers. It reads the RULES only —
 * never an exception, which belongs to one student and says nothing about a
 * grade.
 */
export function offeredCurricula(
  grade: string | null | undefined,
  rules: readonly AvailabilityRule[],
  loadedCourseIds: ReadonlySet<string> | readonly string[],
  gatingOn: boolean
): CurriculumId[] {
  const canonical = canonicalGrade(grade);
  if (canonical === null) return [];
  const loaded = new Set(loadedCourseIds);
  const offers = (courseId: (typeof COURSE_IDS)[number]) =>
    gatingOn
      ? rules.some(
          (r) =>
            r.courseId === courseId &&
            canonicalGrade(r.grade) === canonical &&
            r.state === "live"
        )
      : loaded.has(courseId) &&
        (COURSES[courseId].grades as readonly string[]).includes(canonical);
  return CURRICULUM_IDS.filter((c) =>
    COURSE_IDS.some((id) => COURSES[id].curriculum === c && offers(id))
  );
}

/** How a curriculum came to be a student's (FR-4003). */
export type CurriculumSource = "chosen" | "implied";

/**
 * The curriculum a NEW account stores (FR-4005; privacy review F12) — at
 * sign-up and in the first-Google-sign-in step (FR-4014) — given what the
 * grade offers at the moment of writing (`offeredCurricula`) and what the
 * form sent:
 *
 *   · two or more offered, and the submitted one among them → it, `chosen`;
 *   · two or more offered, and nothing submitted, or one the grade no longer
 *     offers (an operator hid it after the page loaded) → `curriculum_required`:
 *     the form asks again. It is never stored as chosen at face value;
 *   · exactly one offered → that one, `implied`, whatever was sent — and when
 *     a different known curriculum was sent, `resolvedFrom` says so, for the
 *     caller to record on `account_created`;
 *   · none offered → National (`DEFAULT_CURRICULUM`), `implied`.
 *
 * A submitted value the registry does not know is ALWAYS refused
 * (`invalid_curriculum`), even where none is needed: a value that does not
 * exist is a bug to surface, not to ignore.
 */
export function resolveInitialCurriculum(
  submitted: unknown,
  offered: readonly CurriculumId[]
):
  | { ok: true; curriculum: CurriculumId; source: CurriculumSource; resolvedFrom: CurriculumId | null }
  | { ok: false; error: "invalid_curriculum" | "curriculum_required"; offered: readonly CurriculumId[] } {
  const blank = submitted == null || submitted === "";
  const asked = blank ? null : asCurriculumId(submitted);
  if (!blank && asked === null) return { ok: false, error: "invalid_curriculum", offered };
  if (offered.length >= 2) {
    if (asked && offered.includes(asked)) {
      return { ok: true, curriculum: asked, source: "chosen", resolvedFrom: null };
    }
    return { ok: false, error: "curriculum_required", offered };
  }
  const curriculum = offered.length === 1 ? offered[0] : DEFAULT_CURRICULUM;
  return {
    ok: true,
    curriculum,
    source: "implied",
    resolvedFrom: asked && asked !== curriculum ? asked : null,
  };
}

/**
 * What a GRADE CHANGE does to a curriculum (FR-4008; decision 4; privacy
 * review F11) — for the operator's grade edit today and the student's own
 * profile editor later (FR-2013):
 *
 *   · a CHOSEN curriculum never changes. If the new grade does not offer it,
 *     it is kept and `flagged` for an operator (only an operator changes a
 *     chosen curriculum);
 *   · an IMPLIED one is re-resolved by the FR-4005 rule when that rule has one
 *     answer: the single curriculum offered, or National when none is. When
 *     several are offered there is nobody to ask at launch (no student
 *     control), so it is kept — and flagged if it is not among them.
 *
 * `changed` is true only when the stored value must move; the caller records
 * that move in the curriculum history (FR-4012).
 */
export function resolveOnGradeChange(
  current: { curriculum: string | null | undefined; source: CurriculumSource },
  offered: readonly CurriculumId[]
): { curriculum: string; source: CurriculumSource; changed: boolean; flagged: boolean } {
  const known = asCurriculumId(current.curriculum);
  const stored = String(current.curriculum ?? DEFAULT_CURRICULUM);
  const isOffered = known !== null && offered.includes(known);
  if (current.source === "chosen") {
    return { curriculum: stored, source: "chosen", changed: false, flagged: !isOffered };
  }
  if (offered.length <= 1) {
    const next = offered.length === 1 ? offered[0] : DEFAULT_CURRICULUM;
    return { curriculum: next, source: "implied", changed: next !== stored, flagged: false };
  }
  return { curriculum: stored, source: "implied", changed: false, flagged: !isOffered };
}
