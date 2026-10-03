/**
 * Where a student left a lesson, and whether she gets it back.
 *
 * @covers FR-204
 *
 * The bug, in one sentence: pressing Finish halfway through a lesson deleted
 * the save, so starting the lesson again never offered "Continue where I left
 * off" (tester report against v0.11.0, 2026-10-03).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  RESUME_TTL_MS,
  SAVE_VERSION,
  clearLessonSaves,
  isEarlyFinish,
  parseSaved,
  resumeStep,
  storeKey,
  type KeyStore,
} from "./lesson-resume.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const NOW = 1_800_000_000_000;
const save = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    v: SAVE_VERSION,
    sid: "abc",
    messages: [{ role: "assistant", text: "Let's start." }],
    board: [],
    focusKey: null,
    covered: ["lo:1"],
    at: NOW - 1000,
    ...over,
  });

function memStore(init: Record<string, string> = {}): KeyStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
  };
}

test("a Finish before the lesson is over is early", () => {
  assert.equal(isEarlyFinish({ readyToFinish: false, coveredCount: 2, loCount: 5 }), true);
  assert.equal(isEarlyFinish({ readyToFinish: false, coveredCount: 0, loCount: 5 }), true);
});

test("a Finish after the recap, or with every objective covered, is an ending", () => {
  assert.equal(isEarlyFinish({ readyToFinish: true, coveredCount: 2, loCount: 5 }), false);
  assert.equal(isEarlyFinish({ readyToFinish: false, coveredCount: 5, loCount: 5 }), false);
});

test("a fresh save with a tutor message is offered, and keeps its endedEarly mark", () => {
  const s = parseSaved(save({ endedEarly: true }), NOW);
  assert.ok(s);
  assert.equal(s.sid, "abc");
  assert.equal(s.endedEarly, true);
});

test("nothing worth offering reads as null", () => {
  assert.equal(parseSaved(null, NOW), null);
  assert.equal(parseSaved("{not json", NOW), null);
  assert.equal(parseSaved("null", NOW), null);
  assert.equal(parseSaved(save({ v: SAVE_VERSION + 1 }), NOW), null);
  assert.equal(parseSaved(save({ sid: 7 }), NOW), null);
  assert.equal(parseSaved(save({ messages: [{ role: "user", text: "hi" }] }), NOW), null);
  assert.equal(parseSaved(save({ messages: [{ role: "assistant", text: "" }] }), NOW), null);
  assert.equal(parseSaved(save({ at: undefined }), NOW), null);
});

test("a save expires after a week", () => {
  assert.ok(parseSaved(save({ at: NOW - RESUME_TTL_MS }), NOW));
  assert.equal(parseSaved(save({ at: NOW - RESUME_TTL_MS - 1 }), NOW), null);
});

test("the resume prompt names the step she was on", () => {
  assert.equal(resumeStep([], 5), 1);
  assert.equal(resumeStep(["a", "b"], 5), 3);
  assert.equal(resumeStep(["a", "b", "c", "d", "e"], 5), 5);
});

test("the key is scoped by mode, lesson and student", () => {
  assert.equal(storeKey("learn", "m1-l2", 9), "ainext-lesson:learn:m1-l2:s9");
  assert.notEqual(storeKey("learn", "x", 1), storeKey("learn", "x", 2));
  assert.notEqual(storeKey("learn", "x", 1), storeKey("review", "x", 1));
});

test("sign-out clears every lesson save and nothing else", () => {
  const store = memStore({
    [storeKey("learn", "a", 1)]: save(),
    [storeKey("review", "b", 2)]: save(),
    "ainext-renewed-at": "123",
  });
  clearLessonSaves(store);
  assert.deepEqual([...store.data.keys()], ["ainext-renewed-at"]);
});

test("the lesson keeps an early Finish's save, in localStorage", () => {
  const src = read("../components/student/LessonSession.tsx");
  assert.doesNotMatch(src, /sessionStorage\./, "the save must survive closing the tab");
  assert.match(src, /isEarlyFinish\(/);
  assert.match(src, /endedEarly: true/);
});

test("an early Finish does not close the sitting as completed", () => {
  const src = read("../app/api/understanding/route.ts");
  assert.match(src, /body\.early === true/);
  assert.match(src, /!early\b[\s\S]{0,200}closeSession\(studentId, sessionId, "completed"\)/);
});

test("sign-out clears the saves before leaving", () => {
  const src = read("../components/NavLinks.tsx");
  assert.match(src, /clearLessonSaves\(localStorage\)[\s\S]{0,400}window\.location\.assign\("\/signin"\)/);
});
