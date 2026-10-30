/**
 * Every student-facing tutor prompt carries the safety block, last, so it
 * overrides the rhythm and lesson rules above it; the report carries its rule
 * (docs/specs/safety-standard.md). The goldens pin the exact bytes; this pins
 * that no surface was left out.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { learnPrompt, reviewPrompt } from "./lesson.ts";
import { askSystemPrompt } from "./ask.ts";
import { homeworkSystemPrompt } from "./homework-prompt.ts";
import { buildUnderstandingPrompt } from "./understanding-prompt.ts";
import { addressForms } from "./address.ts";
import { SAFETY_REPORT_RULE, SAFETY_RULES } from "./safety-prompt.ts";
import type { LessonData } from "./types.ts";

const LOS = [{ id: "lo:u1-1-1", label: "Ordered pairs", description: "The ordered pair (a, b).", sourcePage: 8, mastery: 0.4 }];

const lesson: LessonData = {
  slug: "u1-1",
  lessonRef: "1-1",
  title: "Cartesian product",
  moduleLabel: "Unit 1",
  courseId: "course:prep3-math-en",
  subject: "math-en",
  los: LOS,
  questions: [],
  visuals: [],
  mapBases: [],
  docTitle: null,
  studentName: "Nour Adel",
  studentId: 7,
  grade: "10",
  gender: null,
};
const a = addressForms(null, "Nour Adel");

const surfaces: Record<string, string> = {
  learn: learnPrompt(lesson, false),
  "learn, probing on": learnPrompt(lesson, true),
  review: reviewPrompt(lesson),
  "ask, student chat": askSystemPrompt("student_chat", "Nour Adel", "math-en", a),
  "ask, social studies": askSystemPrompt("student_chat", "Nour Adel", "social-ar", a),
  "ask, progress map": askSystemPrompt("spine_chat", "Nour Adel", null, a),
  homework: homeworkSystemPrompt({ student: "Nour", question: "Find x.", label: null, mode: "walk", objective: null, fromUpload: false }),
};

for (const [name, prompt] of Object.entries(surfaces)) {
  test(`${name}: ends with the safety block`, () => {
    assert.ok(prompt.endsWith(`\n\n${SAFETY_RULES}`));
  });
}

test("the lesson report carries the report rule", () => {
  const p = buildUnderstandingPrompt({ mode: "learn", los: LOS, studentName: "Nour Adel", grade: "10", lessonRef: "1-1", title: "Cartesian product", moduleLabel: "Unit 1", transcript: [] });
  assert.ok(p.includes(SAFETY_REPORT_RULE));
});

test("the block names no phone number until decision D1", () => {
  assert.doesNotMatch(SAFETY_RULES, /\d{3}/);
});
