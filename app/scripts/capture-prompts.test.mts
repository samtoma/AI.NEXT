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
  GRADER_TRANSCRIPT,
  capture,
  surfacePlan,
} from "./capture-prompts.mts";
import { stubFor } from "./ts-resolver.mjs";

test("the capture module loads without a database or a request", () => {
  assert.equal(typeof capture, "function");
});

test("it enumerates both lesson modes, every ask surface and the grounding", () => {
  const plan = surfacePlan();
  assert.ok(plan.includes("lesson:<slug>:learn"));
  assert.ok(plan.includes("lesson:<slug>:review"));
  assert.equal(
    plan.filter((s) => s.startsWith("ask:")).length,
    ASK_PICKS.length * ASK_SURFACES.length
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
