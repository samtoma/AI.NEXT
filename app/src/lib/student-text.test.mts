/**
 * Internal ids never reach a student (UI clean-up, 2026-10-23) — the net under
 * the report's model-written text.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripInternalIds } from "./student-text.ts";

test("a bracket of objective ids goes whole", () => {
  assert.equal(
    stripInternalIds(
      "no evidence yet of Cartesian product formation (lo:u1-1-2), diagram representations (lo:u1-1-3), or the plane (lo:u1-1-4)"
    ),
    "no evidence yet of Cartesian product formation, diagram representations, or the plane"
  );
});

test("a bracket of several ids goes whole", () => {
  assert.equal(stripInternalIds("Ratios (lo:u2-1-1, lo:u2-1-2) need work"), "Ratios need work");
});

test("bare question and figure ids go too", () => {
  assert.equal(stripInternalIds("Missed q:pp3u7-2-2:w011 on the graph."), "Missed on the graph.");
  assert.equal(stripInternalIds("Read v:pp3u10-5:figure-16 well"), "Read well");
});

test("ordinary text and maths are left alone", () => {
  for (const s of ["Correctly judged (1,4) ≠ (4,1)", "ratio 4:9", "Solve for x: 2x = 6", "(a, b) = (x, y)"]) {
    assert.equal(stripInternalIds(s), s);
  }
});
