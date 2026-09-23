/**
 * The Socratic-probing switch (Tamer's `507bb31`, merged dark).
 *
 * The property that matters is the negative one: with the switch in its
 * shipped position, merging the prototype changes nothing a student gets —
 * the card still reveals, the prompt is main's prompt byte for byte, and the
 * attempt route writes the row it always wrote. Each branch is also proved
 * with the switch ON, so turning it on later is one edit, not a rebuild.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SOCRATIC_PROBING_ENABLED,
  acceptedRetryOf,
  learnWrongAnswerRules,
  probingActive,
} from "./socratic-probing.ts";
import { learnPrompt } from "./lesson.ts";
import { addressForms, type Gender } from "./address.ts";
import type { LessonData } from "./types.ts";

const MASCULINE = /\b(he|him|his|himself)\b/i;

function lesson(gender: Gender): LessonData {
  return {
    slug: "u1-1",
    lessonRef: "1-1",
    title: "Cartesian product",
    moduleLabel: "Unit 1",
    courseId: "course:prep3-math-en",
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

test("the switch ships OFF", () => {
  assert.equal(SOCRATIC_PROBING_ENABLED, false);
});

test("off: no chat surface probes, lesson_learn included", () => {
  for (const s of ["lesson_learn", "lesson_review", "student_chat", "spine_chat", undefined]) {
    assert.equal(probingActive(s), false, String(s));
  }
});

test("on: only lesson_learn probes", () => {
  assert.equal(probingActive("lesson_learn", true), true);
  for (const s of ["lesson_review", "student_chat", "spine_chat", undefined]) {
    assert.equal(probingActive(s, true), false, String(s));
  }
});

test("off: the learn prompt carries main's wrong-answer rules and nothing of the prototype", () => {
  for (const g of ["female", "male", "unspecified", null] as Gender[]) {
    const p = learnPrompt(lesson(g));
    assert.ok(!p.includes("SOCRATIC"), `gender=${g}: SOCRATIC block leaked into the prompt`);
    assert.ok(!p.includes("answer_submitted"), `gender=${g}: answer_submitted leaked`);
    assert.ok(!p.includes("reveal_answer"), `gender=${g}: reveal_answer leaked`);
    assert.ok(
      p.includes("got it wrong: re-explain THAT exact point a different way"),
      `gender=${g}: main's re-explain rule is missing`
    );
  }
});

test("off: the rules are main's two lines exactly", () => {
  const a = addressForms("female", "Nour Adel");
  assert.equal(
    learnWrongAnswerRules(a, "figure / tap"),
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
  assert.equal(acceptedRetryOf(42), null);
  assert.equal(acceptedRetryOf("42"), null);
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
