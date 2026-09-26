/**
 * The course availability rules, and the switch that turns them off.
 *
 * The course gate's requirements exist now (002's FR-2701…FR-2711, and 003's
 * curriculum dimension), so this file says what it proves. The tests from
 * before 003 run unchanged in meaning, for a National student (`nat()`); the
 * 003 block below adds the curriculum step, the kill switch's new meaning,
 * the offer rule, the initial and grade-change resolutions, and the grade
 * labels.
 *
 * @covers FR-2702, FR-2703, FR-2704, FR-2709
 * @covers FR-4002, FR-4003, FR-4004, FR-4005, FR-4008, FR-4009, FR-4013, FR-4015
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
  courseForSubject,
  gradeDisplayLabel,
  isCourseVisible,
  offeredCurricula,
  resolveInitialCurriculum,
  resolveOnGradeChange,
  visibleCourseIds,
  type AvailabilityRule,
  type StudentOverride,
} from "./catalog.ts";
import { PREP3_ARABIC_AR, PREP3_MATH_EN, PREP3_SOCIAL_AR, US_G10_MATH_EN } from "./courses.ts";
import { resolveCourseGating } from "./env.ts";
import { coursesOfSpineKey } from "./subjects.ts";

const MATH = PREP3_MATH_EN;
const SOCIAL = PREP3_SOCIAL_AR;
const ARABIC = PREP3_ARABIC_AR;
const G10 = US_G10_MATH_EN;
const NATIONAL = "eg-national-en" as const;
const AMERICAN = "us-american-en" as const;

/** A National student of this grade — every student before 003. */
const nat = (grade: string | null | undefined) => ({ grade, curriculum: NATIONAL });
/** An American-curriculum student of this grade. */
const us = (grade: string | null | undefined) => ({ grade, curriculum: AMERICAN });

/** The pre-003 call shape, for a National student with the gate on. */
const v = (
  courseId: string,
  grade: string | null | undefined,
  rules: readonly AvailabilityRule[],
  overrides: readonly StudentOverride[]
) => isCourseVisible(courseId, nat(grade), rules, overrides);

/** The seeded state: maths live for Prep 3, nothing else recorded at all. */
const SEEDED: AvailabilityRule[] = [
  { courseId: MATH, grade: "9", state: "live" },
];

const NO_OVERRIDES: StudentOverride[] = [];

/* ------------------------------------------------------------------ */
/* Explicit allow                                                      */
/* ------------------------------------------------------------------ */

test("a live rule for the student's own grade shows the course", () => {
  assert.equal(v(MATH, "9", SEEDED, NO_OVERRIDES), true);
});

test("no row at all means hidden — the default the design rests on", () => {
  // Social studies is a real registry subject with no rule recorded. Nothing
  // says `hidden`; the ABSENCE is what hides it.
  assert.equal(v(SOCIAL, "9", SEEDED, NO_OVERRIDES), false);
  assert.equal(v(ARABIC, "9", SEEDED, NO_OVERRIDES), false);
});

test("a live rule for ANOTHER grade does not carry across", () => {
  // The rule is per (course, grade). A grade-9 rule must not show maths to a
  // grade-11 student, or the second lever is decoration.
  assert.equal(v(MATH, "11", SEEDED, NO_OVERRIDES), false);
});

test("an explicit hidden rule hides", () => {
  const rules: AvailabilityRule[] = [{ courseId: MATH, grade: "9", state: "hidden" }];
  assert.equal(v(MATH, "9", rules, NO_OVERRIDES), false);
});

test("an unknown course id is hidden", () => {
  // Not an error, not a throw: a course nobody has recorded anything about is
  // exactly the case default-deny exists for.
  assert.equal(
    v("course:invented-by-a-url", "9", SEEDED, NO_OVERRIDES),
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
  assert.equal(v(ARABIC, "9", SEEDED, overrides), true);
  // …and it grants nothing beyond the course it names.
  assert.equal(v(SOCIAL, "9", SEEDED, overrides), false);
});

test("an override HIDES a course the grade rule shows", () => {
  // The direction that is easy to forget and is the one that matters: an
  // override that could only ever grant would make "cut this student off"
  // impossible without changing the rule for their whole year.
  const overrides: StudentOverride[] = [{ courseId: MATH, state: "hidden" }];
  assert.equal(v(MATH, "9", SEEDED, overrides), false);
});

test("a null grade sees nothing — unless an override names the course", () => {
  assert.equal(v(MATH, null, SEEDED, NO_OVERRIDES), false);
  assert.equal(v(MATH, undefined, SEEDED, NO_OVERRIDES), false);
  assert.equal(v(MATH, "", SEEDED, NO_OVERRIDES), false);
  assert.equal(
    v(MATH, null, SEEDED, [{ courseId: MATH, state: "live" }]),
    true
  );
});

test("the legacy `prep-3` spelling is the same year as `9`", () => {
  // The baseline database is full of `prep-3` rows (lib/profile.ts). Without
  // the fold they match no rule and the student sees an empty product with no
  // error anywhere to explain it.
  assert.equal(v(MATH, "prep-3", SEEDED, NO_OVERRIDES), true);
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
  assert.deepEqual(visibleCourseIds(nat("9"), rules, NO_OVERRIDES), [MATH]);
  assert.deepEqual(visibleCourseIds(nat("10"), rules, NO_OVERRIDES), [ARABIC]);
  assert.deepEqual(visibleCourseIds(nat(null), rules, NO_OVERRIDES), []);
});

test("visibleCourseIds includes a course only an override names", () => {
  const out = visibleCourseIds(nat("9"), SEEDED, [{ courseId: ARABIC, state: "live" }]);
  assert.deepEqual(out, [ARABIC, MATH]); // sorted, not product order
});

test("an empty rule set shows nothing to anybody", () => {
  // The state of a freshly created database before the seed runs. It must be
  // "no courses", never "all courses".
  assert.deepEqual(visibleCourseIds(nat("9"), [], []), []);
});

/* ------------------------------------------------------------------ */
/* 003 — the curriculum step (FR-4002, FR-4003, FR-4006, FR-4009)       */
/* ------------------------------------------------------------------ */

/** Launch state (decision 6): Prep-3 maths live for grade 9, G10 for grade 10. */
const LAUNCH: AvailabilityRule[] = [
  { courseId: MATH, grade: "9", state: "live" },
  { courseId: G10, grade: "10", state: "live" },
];

test("003: a course reaches only students of its own curriculum", () => {
  assert.equal(isCourseVisible(G10, us("10"), LAUNCH, NO_OVERRIDES), true);
  // same grade, same live rule, other curriculum: hidden
  assert.equal(isCourseVisible(G10, nat("10"), LAUNCH, NO_OVERRIDES), false);
  // …and the other way round: a live National rule does not reach an American student
  const prep3For10: AvailabilityRule[] = [{ courseId: MATH, grade: "10", state: "live" }];
  assert.equal(isCourseVisible(MATH, us("10"), prep3For10, NO_OVERRIDES), false);
  assert.equal(isCourseVisible(MATH, nat("10"), prep3For10, NO_OVERRIDES), true);
});

test("003: an unknown or missing curriculum sees nothing but an exception (FR-4003)", () => {
  for (const curriculum of ["eg-national-ar", "EG-NATIONAL-EN", "", null, undefined, "american"]) {
    assert.equal(isCourseVisible(MATH, { grade: "9", curriculum }, LAUNCH, NO_OVERRIDES), false, String(curriculum));
    assert.deepEqual(visibleCourseIds({ grade: "9", curriculum }, LAUNCH, NO_OVERRIDES), [], String(curriculum));
  }
  const oddButExcepted = { grade: "9", curriculum: "not-a-curriculum" };
  assert.equal(isCourseVisible(MATH, oddButExcepted, LAUNCH, [{ courseId: MATH, state: "live" }]), true);
});

test("003: a course the registry does not know is hidden from everyone, even with a live rule (FR-4002)", () => {
  const rules: AvailabilityRule[] = [{ courseId: "course:loaded-overnight", grade: "9", state: "live" }];
  assert.equal(isCourseVisible("course:loaded-overnight", nat("9"), rules, NO_OVERRIDES), false);
  assert.equal(isCourseVisible("course:loaded-overnight", us("9"), rules, NO_OVERRIDES), false);
  assert.deepEqual(visibleCourseIds(nat("9"), rules, NO_OVERRIDES), []);
});

test("003: the exception still wins in both directions, across curricula (FR-4009)", () => {
  // a National test account previewing the American course
  const preview: StudentOverride[] = [{ courseId: G10, state: "live" }];
  assert.equal(isCourseVisible(G10, nat("9"), LAUNCH, preview), true);
  assert.deepEqual(visibleCourseIds(nat("9"), LAUNCH, preview), [MATH, G10].sort());
  // an American student cut off from her own course
  assert.equal(isCourseVisible(G10, us("10"), LAUNCH, [{ courseId: G10, state: "hidden" }]), false);
});

test("003: every National student sees exactly what the pre-003 rule showed her", () => {
  // The pre-003 rule, restated: override, else a live rule for her grade.
  const before = (c: string, g: string | null, rules: AvailabilityRule[], o: StudentOverride[]) => {
    const hit = o.find((x) => x.courseId === c);
    if (hit) return hit.state === "live";
    const cg = canonicalGrade(g);
    return cg !== null && rules.some((r) => r.courseId === c && canonicalGrade(r.grade) === cg && r.state === "live");
  };
  const ruleSets: AvailabilityRule[][] = [
    [],
    SEEDED,
    [{ courseId: MATH, grade: "9", state: "live" }, { courseId: SOCIAL, grade: "9", state: "live" }, { courseId: ARABIC, grade: "9", state: "live" }],
    [{ courseId: MATH, grade: "9", state: "hidden" }, { courseId: ARABIC, grade: "9", state: "live" }],
    [{ courseId: MATH, grade: "10", state: "live" }, { courseId: SOCIAL, grade: "8", state: "live" }],
  ];
  const overrideSets: StudentOverride[][] = [[], [{ courseId: ARABIC, state: "live" }], [{ courseId: MATH, state: "hidden" }]];
  for (const rules of ruleSets) {
    for (const o of overrideSets) {
      for (const g of ["7", "8", "9", "10", "11", "12", "prep-3", null]) {
        for (const c of [MATH, SOCIAL, ARABIC]) {
          assert.equal(v(c, g, rules, o), before(c, g, rules, o), `${c} grade ${g}`);
        }
      }
    }
  }
});

/* ------------------------------------------------------------------ */
/* 003 — the kill switch suspends rules, not curriculum (FR-4015)      */
/* ------------------------------------------------------------------ */

const ALL_LOADED = { loaded: new Set([MATH, SOCIAL, ARABIC, G10]) };
const NATIONAL_LOADED = { loaded: new Set([MATH, SOCIAL, ARABIC]) };

test("003: switched off, a student sees every LOADED course of her own curriculum", () => {
  assert.deepEqual(visibleCourseIds(nat("9"), [], [], ALL_LOADED), [ARABIC, MATH, SOCIAL].sort());
  assert.deepEqual(visibleCourseIds(us("10"), [], [], ALL_LOADED), [G10]);
  // a book that is not loaded is not available, switch or no switch
  assert.deepEqual(visibleCourseIds(us("10"), [], [], NATIONAL_LOADED), []);
  // and the American book, loaded, still reaches no National student
  assert.equal(isCourseVisible(G10, nat("10"), [], [], ALL_LOADED), false);
});

test("003: switched off, the rules are ignored — a hidden rule hides nothing, a missing one blocks nothing", () => {
  const rules: AvailabilityRule[] = [{ courseId: MATH, grade: "9", state: "hidden" }];
  assert.equal(isCourseVisible(MATH, nat("9"), rules, [], ALL_LOADED), true);
  assert.equal(isCourseVisible(SOCIAL, nat("11"), [], [], ALL_LOADED), true, "no rule for grade 11 at all");
  assert.equal(isCourseVisible(MATH, nat(null), [], [], ALL_LOADED), true, "no grade: the curriculum still scopes");
});

test("003: switched off, an exception still applies, both ways (\"plus any exception\")", () => {
  assert.equal(isCourseVisible(G10, nat("9"), [], [{ courseId: G10, state: "live" }], ALL_LOADED), true);
  assert.equal(isCourseVisible(MATH, nat("9"), [], [{ courseId: MATH, state: "hidden" }], ALL_LOADED), false);
});

test("003: switched off, an unknown curriculum or an unregistered loaded course still sees nothing", () => {
  assert.deepEqual(visibleCourseIds({ grade: "9", curriculum: "x" }, [], [], ALL_LOADED), []);
  const withStray = { loaded: new Set([MATH, "course:stray"]) };
  assert.deepEqual(visibleCourseIds(nat("9"), [], [], withStray), [MATH]);
});

/* ------------------------------------------------------------------ */
/* 003 — ?subject= means a course, in the student's scope               */
/* ------------------------------------------------------------------ */

test("003: courseForSubject — her own curriculum's visible course, else a course that 404s, never maths by default", () => {
  const maths = coursesOfSpineKey("math");
  assert.deepEqual(maths, [MATH, G10], "both maths courses, in course order");
  const sees = (...ids: string[]) => (c: string) => ids.includes(c);
  assert.equal(courseForSubject(maths, sees(MATH), NATIONAL), MATH);
  assert.equal(courseForSubject(maths, sees(G10), AMERICAN), G10);
  // a tester who can see both: her own curriculum's first
  assert.equal(courseForSubject(maths, sees(MATH, G10), NATIONAL), MATH);
  assert.equal(courseForSubject(maths, sees(MATH, G10), AMERICAN), G10);
  // a tester of one curriculum whose only visible maths is the other's
  assert.equal(courseForSubject(maths, sees(G10), NATIONAL), G10);
  // none visible: her own curriculum's (hidden, so the page answers 404)
  assert.equal(courseForSubject(maths, sees(), NATIONAL), MATH);
  assert.equal(courseForSubject(maths, sees(), AMERICAN), G10);
  // a subject her curriculum has no course of: the registry's, hidden → 404
  assert.equal(courseForSubject(coursesOfSpineKey("social"), sees(G10), AMERICAN), SOCIAL);
  // a subject the registry does not know: nothing named, never maths
  assert.equal(courseForSubject(coursesOfSpineKey("geography"), sees(MATH), NATIONAL), null);
  assert.equal(courseForSubject(coursesOfSpineKey(undefined), sees(MATH), NATIONAL), null);
});

/* ------------------------------------------------------------------ */
/* 003 — what a grade offers (FR-4004), and the two resolutions         */
/* ------------------------------------------------------------------ */

test("003: offeredCurricula — curricula with a LIVE course for the grade, registry order", () => {
  assert.deepEqual(offeredCurricula("9", LAUNCH, [], true), [NATIONAL]);
  assert.deepEqual(offeredCurricula("prep-3", LAUNCH, [], true), [NATIONAL]);
  assert.deepEqual(offeredCurricula("10", LAUNCH, [], true), [AMERICAN]);
  assert.deepEqual(offeredCurricula("11", LAUNCH, [], true), []);
  assert.deepEqual(offeredCurricula(null, LAUNCH, [], true), []);
  const both: AvailabilityRule[] = [...LAUNCH, { courseId: SOCIAL, grade: "10", state: "live" }];
  assert.deepEqual(offeredCurricula("10", both, [], true), [NATIONAL, AMERICAN], "National first");
  // a hidden rule offers nothing; nor does a course the registry does not know
  assert.deepEqual(
    offeredCurricula("10", [{ courseId: G10, grade: "10", state: "hidden" }, { courseId: "course:x", grade: "10", state: "live" }], [], true),
    []
  );
});

test("003: offeredCurricula with the switch off — a LOADED course written for the grade", () => {
  assert.deepEqual(offeredCurricula("9", [], [MATH, SOCIAL, ARABIC], false), [NATIONAL]);
  assert.deepEqual(offeredCurricula("10", [], [MATH, SOCIAL, ARABIC], false), [], "G10 not loaded");
  assert.deepEqual(offeredCurricula("10", [], [MATH, G10], false), [AMERICAN]);
  // the rules are not read at all
  assert.deepEqual(offeredCurricula("10", LAUNCH, [], false), []);
});

test("003: resolveInitialCurriculum — ask only on a real choice; never store a hidden one as chosen (FR-4005, F12)", () => {
  const two = [NATIONAL, AMERICAN] as const;
  assert.deepEqual(resolveInitialCurriculum(AMERICAN, two), { ok: true, curriculum: AMERICAN, source: "chosen", resolvedFrom: null });
  assert.deepEqual(resolveInitialCurriculum(undefined, two), { ok: false, error: "curriculum_required", offered: two });
  assert.deepEqual(resolveInitialCurriculum("", two), { ok: false, error: "curriculum_required", offered: two });
  // one offered: stored as implied, whatever was sent — and a known other one is noted
  assert.deepEqual(resolveInitialCurriculum(undefined, [AMERICAN]), { ok: true, curriculum: AMERICAN, source: "implied", resolvedFrom: null });
  assert.deepEqual(resolveInitialCurriculum(NATIONAL, [AMERICAN]), { ok: true, curriculum: AMERICAN, source: "implied", resolvedFrom: NATIONAL });
  // the one sent was hidden after the page loaded, and one remains: that one,
  // implied — never the hidden one as chosen — and the switch is noted
  assert.deepEqual(resolveInitialCurriculum(AMERICAN, [NATIONAL]), { ok: true, curriculum: NATIONAL, source: "implied", resolvedFrom: AMERICAN });
  // none offered: National, implied
  assert.deepEqual(resolveInitialCurriculum(undefined, []), { ok: true, curriculum: NATIONAL, source: "implied", resolvedFrom: null });
  // an unknown value is always refused, even where nothing is needed
  for (const offered of [[], [NATIONAL], two] as const) {
    assert.deepEqual(resolveInitialCurriculum("us-american", offered), { ok: false, error: "invalid_curriculum", offered });
  }
});

test("003: resolveOnGradeChange — a chosen curriculum is kept (and flagged), an implied one follows the grade (FR-4008)", () => {
  // chosen: never moves
  assert.deepEqual(resolveOnGradeChange({ curriculum: AMERICAN, source: "chosen" }, [NATIONAL]), {
    curriculum: AMERICAN, source: "chosen", changed: false, flagged: true,
  });
  assert.deepEqual(resolveOnGradeChange({ curriculum: AMERICAN, source: "chosen" }, [NATIONAL, AMERICAN]), {
    curriculum: AMERICAN, source: "chosen", changed: false, flagged: false,
  });
  // implied: the single offer, or National when none
  assert.deepEqual(resolveOnGradeChange({ curriculum: NATIONAL, source: "implied" }, [AMERICAN]), {
    curriculum: AMERICAN, source: "implied", changed: true, flagged: false,
  });
  assert.deepEqual(resolveOnGradeChange({ curriculum: AMERICAN, source: "implied" }, []), {
    curriculum: NATIONAL, source: "implied", changed: true, flagged: false,
  });
  assert.deepEqual(resolveOnGradeChange({ curriculum: NATIONAL, source: "implied" }, [NATIONAL]), {
    curriculum: NATIONAL, source: "implied", changed: false, flagged: false,
  });
  // implied, several offered: nobody to ask at launch — kept, flagged when not among them
  assert.deepEqual(resolveOnGradeChange({ curriculum: "x", source: "implied" }, [NATIONAL, AMERICAN]), {
    curriculum: "x", source: "implied", changed: false, flagged: true,
  });
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

test("003: a grade is named in the student's own curriculum's words (FR-4013)", () => {
  assert.equal(gradeDisplayLabel("10", AMERICAN), "Grade 10");
  assert.equal(gradeDisplayLabel("10", NATIONAL), "Secondary 1");
  assert.equal(gradeDisplayLabel("prep-3", AMERICAN), "Grade 9");
  // no curriculum, or one we do not know: the labels every surface printed before 003
  assert.equal(gradeDisplayLabel("10"), "Secondary 1");
  assert.equal(gradeDisplayLabel("10", "unknown"), "Secondary 1");
  assert.equal(gradeDisplayLabel("13", AMERICAN), "13");
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
