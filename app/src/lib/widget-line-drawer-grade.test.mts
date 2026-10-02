/**
 * `line_drawer` points mode: `points-swapped` needs BOTH points swapped and
 * BOTH handles moved (consistency review 2026-09-27, A10). An untouched handle
 * that happens to sit on a target's swap must never produce "you swapped the
 * points".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { gradeLinePoints } from "../components/student/widgets/line-drawer-grade.ts";
import { OK, isKnownPredicate } from "./widget-predicates.ts";

const T = [[2, 5], [-1, 3]] as const;
const P = (x: number, y: number) => ({ x, y });
const MOVED = [true, true] as const;

test("the target pair, in either order, is correct", () => {
  assert.deepEqual(gradeLinePoints([P(2, 5), P(-1, 3)], T, MOVED), { ok: true, predicate: OK });
  assert.deepEqual(gradeLinePoints([P(-1, 3), P(2, 5)], T, MOVED), { ok: true, predicate: OK });
});

test("both points swapped, both handles moved → points-swapped (either pairing)", () => {
  assert.equal(gradeLinePoints([P(5, 2), P(3, -1)], T, MOVED).predicate, "points-swapped");
  assert.equal(gradeLinePoints([P(3, -1), P(5, 2)], T, MOVED).predicate, "points-swapped");
});

test("ONE swapped point is not a swap diagnosis", () => {
  assert.equal(gradeLinePoints([P(5, 2), P(-1, 3)], T, MOVED).predicate, "off-target");
  assert.equal(gradeLinePoints([P(5, 2), P(0, 0)], T, MOVED).predicate, "off-target");
});

test("an untouched handle never counts — the false diagnosis the review found", () => {
  // The widget opens at (-3,-2) and (1,1). Target (-2,-3) has the swap (-3,-2):
  // the first handle, never touched, used to be enough.
  const opening = [[-2, -3], [1, 4]] as const;
  assert.equal(gradeLinePoints([P(-3, -2), P(4, 1)], opening, [false, true]).predicate, "off-target");
  assert.equal(gradeLinePoints([P(-3, -2), P(4, 1)], opening, [true, true]).predicate, "points-swapped");
  assert.equal(gradeLinePoints([P(5, 2), P(3, -1)], T, [true, false]).predicate, "off-target");
});

test("every predicate it returns is line_drawer's, and the component grades through it", () => {
  for (const p of ["points-swapped", "off-target"]) assert.ok(isKnownPredicate("line_drawer", p), p);
  const src = readFileSync(
    fileURLToPath(new URL("../components/student/widgets/LineDrawer.tsx", import.meta.url)),
    "utf8"
  );
  assert.match(src, /gradeLinePoints\(pts, through, \[moved\.current\[0\], moved\.current\[1\]\]\)/);
  assert.doesNotMatch(src, /pts\[0\]\.x === t0\[1\]/, "the old one-handle swap test is gone");
});
