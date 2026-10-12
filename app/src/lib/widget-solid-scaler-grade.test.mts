/**
 * @covers FR-1205, FR-1206, FR-1207, FR-1208
 *
 * `solid_scaler`'s geometry (volume and surface area of the five solids) and
 * its ratio-based grading — pure, no rendering.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gradeAreaScale, gradeVolumeScale, isReachableK, solidGeometry, K_MAX, K_MIN,
} from "../components/student/widgets/solid-scaler-grade.ts";
import { OK, isKnownPredicate } from "./widget-predicates.ts";

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

/* ------------------------------------------------------------- geometry */

test("a box's volume and surface area are exact", () => {
  const g = solidGeometry("box", { l: 4, w: 3, h: 2 });
  assert.equal(g.volume, 24);
  assert.equal(g.areaTotal, 52); // 2(12+8+6)
  assert.equal(g.areaPartial, 40); // one 4×3 base left out
  assert.equal(g.hasBase, true);
});

test("a cylinder r=1,h=1 gives clean multiples of π", () => {
  const g = solidGeometry("cylinder", { r: 1, h: 1 });
  assert.ok(close(g.volume, Math.PI));
  assert.ok(close(g.areaTotal, 4 * Math.PI));
  assert.ok(close(g.areaPartial, 3 * Math.PI)); // one circular base left out
});

test("a 3-4-5 cone (r=3,h=4,slant=5) gives clean multiples of π", () => {
  const g = solidGeometry("cone", { r: 3, h: 4 });
  assert.ok(close(g.volume, 12 * Math.PI));
  assert.ok(close(g.areaTotal, 24 * Math.PI)); // base 9π + lateral 15π
  assert.ok(close(g.areaPartial, 15 * Math.PI)); // the base left out
});

test("a square pyramid whose slant is also a 3-4-5 triangle is exact", () => {
  // s=6 (half-base 3), h=4 → slant 5
  const g = solidGeometry("pyramid", { s: 6, h: 4 });
  assert.equal(g.volume, 48);
  assert.equal(g.areaTotal, 96); // base 36 + lateral 60
  assert.equal(g.areaPartial, 60); // the base left out
});

test("a sphere has no base to leave out", () => {
  const g = solidGeometry("sphere", { r: 3 });
  assert.ok(close(g.volume, 36 * Math.PI));
  assert.ok(close(g.areaTotal, 36 * Math.PI));
  assert.equal(g.areaPartial, g.areaTotal);
  assert.equal(g.hasBase, false);
});

/* --------------------------------------------------- the slider's own grid */

test("the slider's stops are exactly every half from 0.5 to 4", () => {
  for (let k = K_MIN; k <= K_MAX; k += 0.5) assert.ok(isReachableK(k), `k=${k} should be reachable`);
  assert.ok(!isReachableK(0.75));
  assert.ok(!isReachableK(0));
  assert.ok(!isReachableK(4.5));
});

/* --------------------------------------------------------------- grading */

test("volume: k = ∛ratio is correct", () => {
  assert.equal(gradeVolumeScale(8, 2).predicate, OK);
  assert.equal(gradeVolumeScale(27, 3).predicate, OK);
  assert.equal(gradeVolumeScale(1, 1).predicate, OK);
});

test("volume: setting k to the ratio itself is the linear misconception", () => {
  const g = gradeVolumeScale(8, 8);
  assert.equal(g.ok, false);
  assert.equal(g.predicate, "volume-scaled-by-k");
});

test("volume: anything else is the generic predicate", () => {
  const g = gradeVolumeScale(8, 3);
  assert.equal(g.ok, false);
  assert.equal(g.predicate, "off-target");
});

test("area: k = √ratio, with every base counted, is correct", () => {
  assert.equal(gradeAreaScale(4, 2, true).predicate, OK);
  assert.equal(gradeAreaScale(9, 3, true).predicate, OK);
});

test("area: k = √ratio but a base left out is wrong-formula-part", () => {
  const g = gradeAreaScale(4, 2, false);
  assert.equal(g.ok, false);
  assert.equal(g.predicate, "wrong-formula-part");
});

test("area: setting k to the ratio itself is the linear misconception, even with the base included", () => {
  const g1 = gradeAreaScale(4, 4, true);
  assert.equal(g1.predicate, "area-scaled-by-k");
  const g2 = gradeAreaScale(4, 4, false);
  assert.equal(g2.predicate, "area-scaled-by-k");
});

test("area: anything else is the generic predicate", () => {
  const g = gradeAreaScale(4, 3, true);
  assert.equal(g.ok, false);
  assert.equal(g.predicate, "off-target");
});

test("every predicate this grader can return is in solid_scaler's vocabulary", () => {
  const cases = [
    gradeVolumeScale(8, 8),
    gradeVolumeScale(8, 3),
    gradeAreaScale(4, 2, false),
    gradeAreaScale(4, 4, true),
    gradeAreaScale(4, 3, true),
  ];
  for (const c of cases) {
    assert.ok(isKnownPredicate("solid_scaler", c.predicate), `unknown predicate: ${c.predicate}`);
  }
});
