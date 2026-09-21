/**
 * The course availability rules, and the switch that turns them off.
 *
 * **No `@covers` annotation.** This capability has no FR — see the header of
 * `lib/catalog.ts`. Annotating it against a requirement it does not have would
 * launder the traceability matrix rather than report the gap, which is what
 * CLAUDE.md asks for explicitly.
 *
 * What is being proved here is the DEFAULT, in both of the places this feature
 * has one, because they point in opposite directions and both are deliberate:
 *
 *   · a missing ROW means the course is hidden — default-deny, so a subject
 *     nobody has approved cannot reach a child;
 *   · a missing VARIABLE means the gate does not apply at all — default-allow,
 *     so a stack that never configured it does not lock every student out of
 *     the course they are paying to study.
 *
 * A test suite that only exercised the happy path would pass identically if
 * either default were inverted.
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  GRADES,
  canonicalGrade,
  gradeDisplayLabel,
  isCourseVisible,
  visibleCourseIds,
  type AvailabilityRule,
  type StudentOverride,
} from "./catalog.ts";
import { resolveCourseGating } from "./env.ts";

const MATH = "course:prep3-math-en";
const SOCIAL = "course:prep3-social-ar";
const ARABIC = "course:prep3-arabic-ar";

/** The seeded state: maths live for Prep 3, nothing else recorded at all. */
const SEEDED: AvailabilityRule[] = [
  { courseId: MATH, grade: "9", state: "live" },
];

const NO_OVERRIDES: StudentOverride[] = [];

/* ------------------------------------------------------------------ */
/* Explicit allow                                                      */
/* ------------------------------------------------------------------ */

test("a live rule for the student's own grade shows the course", () => {
  assert.equal(isCourseVisible(MATH, "9", SEEDED, NO_OVERRIDES), true);
});

test("no row at all means hidden — the default the design rests on", () => {
  // Social studies is a real registry subject with no rule recorded. Nothing
  // says `hidden`; the ABSENCE is what hides it.
  assert.equal(isCourseVisible(SOCIAL, "9", SEEDED, NO_OVERRIDES), false);
  assert.equal(isCourseVisible(ARABIC, "9", SEEDED, NO_OVERRIDES), false);
});

test("a live rule for ANOTHER grade does not carry across", () => {
  // The rule is per (course, grade). A grade-9 rule must not show maths to a
  // grade-11 student, or the second lever is decoration.
  assert.equal(isCourseVisible(MATH, "11", SEEDED, NO_OVERRIDES), false);
});

test("an explicit hidden rule hides", () => {
  const rules: AvailabilityRule[] = [{ courseId: MATH, grade: "9", state: "hidden" }];
  assert.equal(isCourseVisible(MATH, "9", rules, NO_OVERRIDES), false);
});

test("an unknown course id is hidden", () => {
  // Not an error, not a throw: a course nobody has recorded anything about is
  // exactly the case default-deny exists for.
  assert.equal(
    isCourseVisible("course:invented-by-a-url", "9", SEEDED, NO_OVERRIDES),
    false
  );
});

/* ------------------------------------------------------------------ */
/* The override wins — in both directions                              */
/* ------------------------------------------------------------------ */

test("an override SHOWS a course no grade rule mentions", () => {
  // The whole reason the second lever exists: one test student gets Arabic
  // without Arabic going live for anybody else's grade.
  const overrides: StudentOverride[] = [{ courseId: ARABIC, state: "live" }];
  assert.equal(isCourseVisible(ARABIC, "9", SEEDED, overrides), true);
  // …and it grants nothing beyond the course it names.
  assert.equal(isCourseVisible(SOCIAL, "9", SEEDED, overrides), false);
});

test("an override HIDES a course the grade rule shows", () => {
  // The direction that is easy to forget and is the one that matters: an
  // override that could only ever grant would make "cut this student off"
  // impossible without changing the rule for their whole year.
  const overrides: StudentOverride[] = [{ courseId: MATH, state: "hidden" }];
  assert.equal(isCourseVisible(MATH, "9", SEEDED, overrides), false);
});

test("a null grade sees nothing — unless an override names the course", () => {
  assert.equal(isCourseVisible(MATH, null, SEEDED, NO_OVERRIDES), false);
  assert.equal(isCourseVisible(MATH, undefined, SEEDED, NO_OVERRIDES), false);
  assert.equal(isCourseVisible(MATH, "", SEEDED, NO_OVERRIDES), false);
  assert.equal(
    isCourseVisible(MATH, null, SEEDED, [{ courseId: MATH, state: "live" }]),
    true
  );
});

test("the legacy `prep-3` spelling is the same year as `9`", () => {
  // The baseline database is full of `prep-3` rows (lib/profile.ts). Without
  // the fold they match no rule and the student sees an empty product with no
  // error anywhere to explain it.
  assert.equal(isCourseVisible(MATH, "prep-3", SEEDED, NO_OVERRIDES), true);
  assert.equal(canonicalGrade("prep-3"), "9");
  assert.equal(canonicalGrade("  9  "), "9");
  assert.equal(canonicalGrade(""), null);
  assert.equal(canonicalGrade(null), null);
});

/* ------------------------------------------------------------------ */
/* The set form                                                        */
/* ------------------------------------------------------------------ */

test("visibleCourseIds returns only what the rules allow", () => {
  const rules: AvailabilityRule[] = [
    { courseId: MATH, grade: "9", state: "live" },
    { courseId: SOCIAL, grade: "9", state: "hidden" },
    { courseId: ARABIC, grade: "10", state: "live" },
  ];
  assert.deepEqual(visibleCourseIds("9", rules, NO_OVERRIDES), [MATH]);
  assert.deepEqual(visibleCourseIds("10", rules, NO_OVERRIDES), [ARABIC]);
  assert.deepEqual(visibleCourseIds(null, rules, NO_OVERRIDES), []);
});

test("visibleCourseIds includes a course only an override names", () => {
  const out = visibleCourseIds("9", SEEDED, [{ courseId: ARABIC, state: "live" }]);
  assert.deepEqual(out, [ARABIC, MATH]); // sorted, not product order
});

test("an empty rule set shows nothing to anybody", () => {
  // The state of a freshly created database before the seed runs. It must be
  // "no courses", never "all courses".
  assert.deepEqual(visibleCourseIds("9", [], []), []);
});

/* ------------------------------------------------------------------ */
/* Grades                                                              */
/* ------------------------------------------------------------------ */

test("the grade list carries Egyptian labels for the six stored values", () => {
  assert.deepEqual(
    GRADES.map((g) => g.value),
    ["7", "8", "9", "10", "11", "12"]
  );
  assert.equal(GRADES.find((g) => g.value === "9")?.label, "Prep 3");
  assert.equal(gradeDisplayLabel("prep-3"), "Prep 3");
  // An unrecognised value keeps its own text rather than being renamed into a
  // grade it is not.
  assert.equal(gradeDisplayLabel("13"), "13");
  assert.equal(gradeDisplayLabel(null), "—");
});

/* ------------------------------------------------------------------ */
/* The kill switch (AINEXT_COURSE_GATING)                              */
/* ------------------------------------------------------------------ */

const ORIGINAL = process.env.AINEXT_COURSE_GATING;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.AINEXT_COURSE_GATING;
  else process.env.AINEXT_COURSE_GATING = ORIGINAL;
});

test("an ABSENT variable leaves the gate off", () => {
  // The asymmetry with default-deny above, and it is the point of the switch:
  // a stack that has not configured the gate must not lock every student out
  // of their own course. For a tutoring product the safe failure is "too much
  // visible", not "a child cannot reach their lesson on a Sunday evening".
  delete process.env.AINEXT_COURSE_GATING;
  assert.equal(resolveCourseGating(), false);
  process.env.AINEXT_COURSE_GATING = "";
  assert.equal(resolveCourseGating(), false);
  process.env.AINEXT_COURSE_GATING = "   ";
  assert.equal(resolveCourseGating(), false);
});

test("`on` enforces the gate", () => {
  for (const raw of ["on", "ON", " On ", "true", "1"]) {
    process.env.AINEXT_COURSE_GATING = raw;
    assert.equal(resolveCourseGating(), true, `expected ${JSON.stringify(raw)} to enable`);
  }
});

test("`off` disables it explicitly", () => {
  for (const raw of ["off", "OFF", "false", "0"]) {
    process.env.AINEXT_COURSE_GATING = raw;
    assert.equal(resolveCourseGating(), false, `expected ${JSON.stringify(raw)} to disable`);
  }
});

test("an unparseable value throws rather than picking a side", () => {
  // "The gate is in a state nobody chose" is not a thing to resolve by
  // guessing — the same rule AINEXT_ENVIRONMENT applies to itself.
  process.env.AINEXT_COURSE_GATING = "yes-please";
  assert.throws(() => resolveCourseGating(), /AINEXT_COURSE_GATING/);
});
