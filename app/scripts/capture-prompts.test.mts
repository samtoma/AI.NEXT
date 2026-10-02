/**
 * Smoke test for constitution IX's proof mechanism.
 *
 * The harness was broken at HEAD — `scripts/ts-resolver.mjs` could not resolve
 * `next/headers`, so `node scripts/capture-prompts.mts` died before rendering
 * anything, and every gate that "ran" it was comparing one crash with another.
 * A crash nobody notices is the failure mode this file exists to prevent: it
 * imports the capture module (proving it loads at all) and asserts it still
 * enumerates the surfaces it is supposed to cover — including the comprehension
 * grader and the upload parser, which were outside the harness until P6.
 *
 * It deliberately does NOT run a capture: that needs a database, and a test
 * that quietly skips when one is missing is worth less than one that always
 * runs. The capture itself is exercised by the before/after diff in the phase's
 * own gate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ASK_PICKS,
  ASK_SURFACES,
  DATA_PICK_COURSES,
  GRADER_TRANSCRIPT,
  capture,
  coursePick,
  surfacePlan,
} from "./capture-prompts.mts";
import { COURSES, US_G10_MATH_EN } from "../src/lib/courses.ts";
import { stubFor } from "./ts-resolver.mjs";

test("the capture module loads without a database or a request", () => {
  assert.equal(typeof capture, "function");
});

test("it enumerates both lesson modes, every ask surface and the grounding", () => {
  const plan = surfacePlan();
  assert.ok(plan.includes("lesson:<slug>:learn"));
  assert.ok(plan.includes("lesson:<slug>:review"));
  // the fixed National picks, plus one data-driven pick per surface for the
  // courses of other curricula (feature 003)
  assert.equal(
    plan.filter((s) => s.startsWith("ask:")).length,
    (ASK_PICKS.length + 1) * ASK_SURFACES.length
  );
  // the observer surface with no question in scope, and a question on both
  assert.ok(plan.includes("ask:spine_chat:none"));
  assert.ok(plan.includes("ask:student_chat:q:geo1-1-1:001"));
});

test("the two surfaces P6 added are in the plan", () => {
  const plan = surfacePlan();
  for (const s of [
    "understanding:learn",
    "understanding:review",
    "understanding:retry",
    "upload:parse",
  ]) {
    assert.ok(plan.includes(s), `harness no longer covers ${s}`);
  }
});

test("the grader transcript is fixed input, not a recorded session", () => {
  assert.ok(GRADER_TRANSCRIPT.length > 0);
  assert.ok(GRADER_TRANSCRIPT.some((m) => m.role === "note"));
});

test("the next/headers stub is offered to the capture entrypoint and nobody else", () => {
  assert.ok(stubFor("next/headers", "capture-prompts.mts"));
  for (const other of [
    "rollup-cost-daily.mts",
    "alerts-sweep.mts",
    "bootstrap-operator.mts",
    "seed-local-account.mts",
    "",
  ]) {
    assert.equal(
      stubFor("next/headers", other),
      null,
      `${other || "(no entrypoint)"} must resolve the real next/headers`
    );
  }
  assert.equal(stubFor("next/server", "capture-prompts.mts"), null);
});

// @covers FR-4205, FR-4206
test("feature 003: the National picks stay fixed; every other curriculum's course picks from its own data", () => {
  // the National picks are exactly the ones every capture since P6 has rendered
  assert.deepEqual([...ASK_PICKS], [null, "q:geo1-1-1:001", "q:soc1-1:africa:01"]);
  // no National course is picked from data, so a National capture is unchanged
  for (const id of DATA_PICK_COURSES) {
    assert.notEqual(COURSES[id as keyof typeof COURSES].curriculum, "eg-national-en", id);
  }
  assert.ok(DATA_PICK_COURSES.includes(US_G10_MATH_EN), "the Grade 10 course is captured");
});

test("a course's own pick: its first live question in catalogue order, an answerable one before a widget", () => {
  const los = ["lo:a-1-1", "lo:a-1-2", "lo:b-1-1"];
  const q = (id: string, lo_id: string, question_type = "mcq") => ({ id, lo_id, question_type });
  assert.equal(coursePick(los, []), null);
  assert.equal(coursePick(los, [q("q:x", "lo:other")]), null, "a question outside the course is never picked");
  assert.equal(coursePick(los, [q("q:b", "lo:b-1-1"), q("q:a2", "lo:a-1-2")]), "q:a2", "catalogue order, not id order");
  assert.equal(
    coursePick(los, [q("q:w", "lo:a-1-1", "widget"), q("q:n", "lo:a-1-2", "numeric")]),
    "q:n",
    "an answerable question before a widget construction"
  );
  assert.equal(coursePick(los, [q("q:w2", "lo:a-1-2", "widget"), q("q:w1", "lo:a-1-1", "widget")]), "q:w1");
});
