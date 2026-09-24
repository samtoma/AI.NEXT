/**
 * Socratic probing's rules (Tamer's `507bb31`; runtime since v0.7.0, ADR-0021).
 *
 * Two properties matter more than the rest:
 *
 *  1. **The resolver's truth table**, stated here by hand and NOT derived from
 *     the function it checks — position × tester × course × surface, with the
 *     "everyone" lock both engaged and lifted. A table computed from
 *     `resolveProbing` would pass for any `resolveProbing`.
 *  2. **Off is v0.6.0.** With `enabled = false` every helper returns exactly
 *     what the switched-off build returned: the card reveals, the prompt's
 *     wrong-answer lines are main's two, and a retry link in the request is
 *     dropped. (`probing-prompts.test.mts` holds the whole-prompt version.)
 *
 * @covers FR-3101
 * @covers FR-3103
 * @covers FR-3104
 * @covers FR-3107
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PROBING_COURSE_ID,
  PROBING_EVERYONE_LOCK_NOTE,
  PROBING_EVERYONE_UNLOCKED,
  PROBING_SETTINGS,
  PROBING_SURFACE,
  acceptedRetryOf,
  asProbingSetting,
  effectiveProbing,
  effectiveSetting,
  learnWrongAnswerRules,
  probingActive,
  probingCouldApply,
  resolveProbing,
  settingChangeRefusal,
  type ProbingSetting,
} from "./socratic-probing.ts";
import { learnPrompt } from "./lesson.ts";
import { addressForms, type Gender } from "./address.ts";
import type { LessonData } from "./types.ts";

const MASCULINE = /\b(he|him|his|himself)\b/i;

const MATHS = "course:prep3-math-en";
const COURSES = [MATHS, "course:prep3-social-ar", "course:prep3-arabic-ar", null] as const;
const SURFACES = ["lesson_learn", "lesson_review", "practice", "student_chat", "spine_chat", null] as const;

/**
 * THE TABLE, by hand. Read each line as the brief Samuel approved:
 *   off                    → never
 *   testers                → tester AND maths AND lesson_learn
 *   everyone, UNLOCKED     → maths AND lesson_learn
 *   everyone, LOCKED (#53) → as testers (the lock narrows what is stored)
 */
function expected(
  setting: ProbingSetting,
  unlocked: boolean,
  tester: boolean,
  course: string | null,
  surface: string | null
): boolean {
  const mathsLesson = course === MATHS && surface === "lesson_learn";
  switch (setting) {
    case "off":
      return false;
    case "testers":
      return tester && mathsLesson;
    case "everyone":
      return unlocked ? mathsLesson : tester && mathsLesson;
  }
}

test("the constants ship as approved: Everyone locked, maths only, learn mode only", () => {
  assert.equal(PROBING_EVERYONE_UNLOCKED, false, "Everyone stays locked until #53 is closed");
  assert.equal(PROBING_COURSE_ID, MATHS);
  assert.equal(PROBING_SURFACE, "lesson_learn");
  assert.deepEqual([...PROBING_SETTINGS], ["off", "testers", "everyone"]);
  assert.match(PROBING_EVERYONE_LOCK_NOTE, /#53/);
});

test("resolver truth table: 3 positions × lock × tester × 4 courses × 6 surfaces", () => {
  let cells = 0;
  let on = 0;
  for (const setting of PROBING_SETTINGS) {
    for (const unlocked of [false, true]) {
      for (const tester of [false, true]) {
        for (const course of COURSES) {
          for (const surface of SURFACES) {
            const got = resolveProbing(
              { setting, isTester: tester, courseId: course, surface },
              unlocked
            );
            const want = expected(setting, unlocked, tester, course, surface);
            assert.equal(
              got,
              want,
              `${setting}${setting === "everyone" ? (unlocked ? "/unlocked" : "/locked") : ""} ` +
                `tester=${tester} course=${course} surface=${surface}: expected ${want}`
            );
            cells++;
            if (got) on++;
          }
        }
      }
    }
  }
  assert.equal(cells, 3 * 2 * 2 * 4 * 6);
  // Exactly the cells that should be on: testers (1 per lock state = 2),
  // everyone locked (1), everyone unlocked (2: tester or not). Five in 288.
  assert.equal(on, 5, "probing is on in exactly five cells of the table");
});

test("the shipped default (the lock engaged) is the one the product runs on", () => {
  // `resolveProbing` without its second argument uses the constant.
  const base = { courseId: MATHS, surface: "lesson_learn" as const };
  assert.equal(resolveProbing({ ...base, setting: "off", isTester: true }), false);
  assert.equal(resolveProbing({ ...base, setting: "testers", isTester: true }), true);
  assert.equal(resolveProbing({ ...base, setting: "testers", isTester: false }), false);
  assert.equal(resolveProbing({ ...base, setting: "everyone", isTester: false }), false,
    "a stored Everyone must not reach a non-tester while #53 is open");
  assert.equal(resolveProbing({ ...base, setting: "everyone", isTester: true }), true);
});

test("the lock: Everyone is refused as a change, and read as Test accounts when stored", () => {
  assert.equal(settingChangeRefusal("everyone"), "everyone_locked");
  assert.equal(settingChangeRefusal("everyone", false), "everyone_locked");
  assert.equal(settingChangeRefusal("everyone", true), null);
  for (const s of ["off", "testers"] as const) {
    assert.equal(settingChangeRefusal(s), null, `${s} is always allowed`);
    assert.equal(settingChangeRefusal(s, true), null);
  }
  assert.equal(effectiveSetting("everyone"), "testers");
  assert.equal(effectiveSetting("everyone", true), "everyone");
  assert.equal(effectiveSetting("testers"), "testers");
  assert.equal(effectiveSetting("off"), "off");
});

test("a stored value is read closed: anything unrecognised is off", () => {
  assert.equal(asProbingSetting("testers"), "testers");
  assert.equal(asProbingSetting("everyone"), "everyone");
  for (const bad of [null, undefined, "", "on", "TESTERS", 1, true, {}]) {
    assert.equal(asProbingSetting(bad), "off", String(bad));
  }
});

test("probingCouldApply is the resolver with the course assumed maths", () => {
  for (const setting of PROBING_SETTINGS) {
    for (const tester of [false, true]) {
      for (const surface of SURFACES) {
        assert.equal(
          probingCouldApply({ setting, isTester: tester, surface }),
          resolveProbing({ setting, isTester: tester, courseId: MATHS, surface })
        );
      }
    }
  }
  // With the switch Off it is false for everyone, so no course is ever looked up.
  assert.equal(probingCouldApply({ setting: "off", isTester: true, surface: "lesson_learn" }), false);
});

test("the use-time rule only narrows: never turns a stored false (or NULL) on", () => {
  for (const course of COURSES) {
    for (const surface of SURFACES) {
      assert.equal(effectiveProbing(false, surface, course), false);
      assert.equal(effectiveProbing(null, surface, course), false, "pre-v0.7.0 session");
      assert.equal(effectiveProbing(undefined, surface, course), false);
      assert.equal(
        effectiveProbing(true, surface, course),
        course === MATHS && surface === "lesson_learn",
        `stored true on ${course}/${surface}`
      );
    }
  }
});

test("off: no chat surface probes, lesson_learn included", () => {
  for (const s of ["lesson_learn", "lesson_review", "student_chat", "spine_chat", undefined]) {
    assert.equal(probingActive(s, false), false, String(s));
  }
});

test("on: only lesson_learn probes", () => {
  assert.equal(probingActive("lesson_learn", true), true);
  for (const s of ["lesson_review", "student_chat", "spine_chat", undefined]) {
    assert.equal(probingActive(s, true), false, String(s));
  }
});

function lesson(gender: Gender): LessonData {
  return {
    slug: "u1-1",
    lessonRef: "1-1",
    title: "Cartesian product",
    moduleLabel: "Unit 1",
    courseId: MATHS,
    subject: "math-en",
    los: [
      {
        id: "lo:u1-1-1",
        label: "Ordered pairs",
        description: "The ordered pair (a, b).",
        sourcePage: 8,
        mastery: 0.4,
      },
    ],
    questions: [],
    visuals: [],
    mapBases: [],
    docTitle: null,
    studentName: "Nour Adel",
    studentId: 7,
    grade: "9",
    gender,
  } as LessonData;
}

test("off: the learn prompt carries main's wrong-answer rules and nothing of the prototype", () => {
  for (const g of ["female", "male", "unspecified", null] as Gender[]) {
    const p = learnPrompt(lesson(g), false);
    assert.ok(!p.includes("SOCRATIC"), `gender=${g}: SOCRATIC block leaked into the prompt`);
    assert.ok(!p.includes("answer_submitted"), `gender=${g}: answer_submitted leaked`);
    assert.ok(!p.includes("reveal_answer"), `gender=${g}: reveal_answer leaked`);
    assert.ok(
      p.includes("got it wrong: re-explain THAT exact point a different way"),
      `gender=${g}: main's re-explain rule is missing`
    );
  }
});

test("on: the learn prompt carries the probing block, voiced for the student", () => {
  for (const g of ["female", "male", "unspecified", null] as Gender[]) {
    const p = learnPrompt(lesson(g), true);
    assert.ok(p.includes("SOCRATIC PROBING"), `gender=${g}`);
    assert.ok(p.includes("{{answer_submitted:"), `gender=${g}`);
  }
});

test("off: the rules are main's two lines exactly", () => {
  const a = addressForms("female", "Nour Adel");
  assert.equal(
    learnWrongAnswerRules(a, "figure / tap", false),
    `- From the SECOND message on: open with one warm beat reacting to her latest [live event]. If she got it wrong: re-explain THAT exact point a different way (grounded in the canonical steps), walking her toward the correct answer, in the same upbeat tone — never open with the correct letter.
- After a "لسه مش فاهم" / still-confused signal: re-explain from a DIFFERENT angle, and the next check MUST be a basic-tier question or a tap widget (figure / tap) — never a harder question.`
  );
});

test("on: the probing block is voiced through the address seam (FR-2602)", () => {
  for (const g of ["unspecified", null] as Gender[]) {
    const on = learnWrongAnswerRules(addressForms(g, "Nour Adel"), "figure", true);
    assert.ok(on.includes("SOCRATIC PROBING"));
    assert.ok(!MASCULINE.test(on), `gender=${g}: a masculine form survived: ${on.match(MASCULINE)}`);
  }
  const her = learnWrongAnswerRules(addressForms("female", "Nour Adel"), "figure", true);
  assert.ok(/\bher own mistake\b/.test(her));
});

test("off: a retry link in the request body is ignored", () => {
  assert.equal(acceptedRetryOf(42, false), null);
  assert.equal(acceptedRetryOf("42", false), null);
});

test("on: only a positive integer id survives", () => {
  assert.equal(acceptedRetryOf(42, true), 42);
  for (const bad of ["42", -1, 0, 1.5, null, undefined, {}]) {
    assert.equal(acceptedRetryOf(bad, true), null, String(bad));
  }
});

// Above 2^53 a JSON number stops naming one integer: 2^53 + 1 parses as 2^53,
// so an id that large could link a retry to a NEIGHBOURING attempt. Only a
// safe integer is an id this route can trust.
test("on: an id beyond the safe-integer range is refused", () => {
  assert.equal(acceptedRetryOf(Number.MAX_SAFE_INTEGER, true), Number.MAX_SAFE_INTEGER);
  assert.equal(acceptedRetryOf(2 ** 53, true), null);
  assert.equal(acceptedRetryOf(Number.POSITIVE_INFINITY, true), null);
});
