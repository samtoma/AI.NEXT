/**
 * The grid option and the three new modes (Tamer 2026-10-21): pair_plotter's
 * set of points, line_drawer's two-line system, product_builder's relation —
 * and a curve on the book's own interval. Every one is additive: a spec
 * without the new fields is read exactly as it was.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseMathWidget } from "./widget-payloads.ts";
import { DEFAULT_GRID, lineReachable, onGrid, parseGrid, snapToGrid } from "../components/student/widgets/grid.ts";
import { gradePoint, gradePoints } from "../components/student/widgets/pair-plotter-grade.ts";
import { gradeProduct, gradeRelation } from "../components/student/widgets/product-builder-grade.ts";
import { gradeLineEquation, gradeSystem, meeting } from "../components/student/widgets/line-drawer-grade.ts";

test("no grid field is the old −5..5 lattice; a malformed one is refused, never drawn wrong", () => {
  assert.deepEqual(parseGrid(undefined), DEFAULT_GRID);
  assert.deepEqual(parseGrid({ x: [-4, 4], y: [-4, 4], step: 0.5 }), { x: [-4, 4], y: [-4, 4], sx: 0.5, sy: 0.5 });
  assert.deepEqual(parseGrid({ x: [0, 60], y: [0, 20], step: [5, 2] }), { x: [0, 60], y: [0, 20], sx: 5, sy: 2 });
  assert.equal(parseGrid({ x: [-10, 10], y: [-10, 10], step: 0.5 }), null, "40 steps: too fine to tap");
  assert.equal(parseGrid({ x: [1, -1], y: [0, 1] }), null);
  assert.equal(parseGrid({ x: [-1.25, 2], y: [0, 1], step: 0.5 }), null, "an end off the grid");
});

test("grid points and snapping", () => {
  const g = parseGrid({ x: [-4, 4], y: [-4, 4], step: 0.5 })!;
  assert.ok(onGrid(g, [3, 2.5]));
  assert.ok(!onGrid(g, [3, 2.25]));
  assert.deepEqual(snapToGrid(g, 2.8, 2.6), [3, 2.5]);
  assert.ok(lineReachable(g, 0, 2.5), "y = 2½ on a half grid");
  assert.ok(!lineReachable(DEFAULT_GRID, 0, 2.5), "but not on the old lattice");
});

test("specs without the new fields parse exactly as before", () => {
  assert.deepEqual(parseMathWidget("pair_plotter", { prompt: "Plot the point (3,2)", target: [3, 2] }),
    { name: "pair_plotter", prompt: "Plot the point (3,2)", target: [3, 2] });
  assert.deepEqual(parseMathWidget("line_drawer", { mode: "equation", m: 2, b: -1 }),
    { name: "line_drawer", mode: "equation", prompt: "Draw the line", m: 2, b: -1 });
  assert.deepEqual(parseMathWidget("product_builder", { X: [1, 2], Y: [3] }),
    { name: "product_builder", prompt: "Tap all the pairs of X×Y", X: [1, 2], Y: [3] });
  assert.equal(parseMathWidget("line_drawer", { mode: "equation", m: 0, b: 2.5 }), null, "y = 2½ needs a grid");
});

test("pair_plotter: a point with a half in it, and a set of points", () => {
  const half = parseMathWidget("pair_plotter", { target: [3, 2.5], grid: { x: [-4, 4], y: [-4, 4], step: 0.5 } });
  assert.ok(half && half.name === "pair_plotter" && "target" in half && half.target[1] === 2.5);
  const set = parseMathWidget("pair_plotter", { targets: [[2, 3], [6, 2], [-2, -2], [-2, 1]], grid: { x: [-3, 7], y: [-3, 4] } });
  assert.ok(set && "targets" in set && set.targets.length === 4);
  assert.equal(parseMathWidget("pair_plotter", { targets: [[2, 3], [9, 2]], grid: { x: [-3, 7], y: [-3, 4] } }), null, "off the grid");
  assert.equal(parseMathWidget("pair_plotter", { targets: [[2, 3], [2, 3]] }), null, "a point twice");
});

test("pair_plotter grading: one point as before; a set by what its wrong points share", () => {
  assert.equal(gradePoint([2, 3], [2, 3]), "ok");
  assert.equal(gradePoint([3, 2], [2, 3]), "swapped-coordinates");
  assert.equal(gradePoint([-2, 3], [2, 3]), "wrong-quadrant");
  const T: [number, number][] = [[2, 3], [6, 2], [-2, -2]];
  assert.equal(gradePoints(T, T).ok, true);
  assert.equal(gradePoints([[2, 3], [6, 2]], T).predicate, "missing-points");
  assert.equal(gradePoints([[3, 2], [6, 2], [-2, -2]], T).predicate, "swapped-coordinates");
  assert.equal(gradePoints([[2, 3], [-6, 2], [-2, -2]], T).predicate, "wrong-quadrant");
  assert.equal(gradePoints([[2, 3], [6, 2], [-2, -2], [0, 0]], T).predicate, "extra-points");
});

test("line_drawer system: two lines in either order, each diagnosed as in equation mode", () => {
  const L: [{ m: number; b: number }, { m: number; b: number }] = [{ m: 2, b: -3 }, { m: -0.5, b: 2 }];
  assert.equal(gradeSystem([{ m: -0.5, b: 2 }, { m: 2, b: -3 }], L).ok, true, "either order");
  const g = gradeSystem([{ m: 2, b: -3 }, { m: -0.5, b: 1 }], L);
  assert.deepEqual([g.ok, g.predicate], [false, "intercept-wrong"]);
  assert.equal(gradeSystem([{ m: null, b: null }, { m: -0.5, b: 2 }], L).predicate, "vertical-line");
  assert.deepEqual(meeting(L[0], L[1]), [2, 1]);
  assert.equal(meeting({ m: -3, b: 5 }, { m: -3, b: 8 }), "parallel", "the book's 3x + y = 5, y + 3x = 8: ∅");
  assert.equal(gradeLineEquation(2, 1, 2, -1), "intercept-wrong");
  const sys = parseMathWidget("line_drawer", { mode: "system", lines: [{ m: -3, b: 4 }, { m: -3, b: 1.5 }], grid: { x: [-3, 3], y: [-2, 6], step: [1, 0.5] } });
  assert.ok(sys && sys.name === "line_drawer" && sys.mode === "system");
});

test("product_builder relation: a pair the rule leaves out is its own error", () => {
  assert.equal(gradeProduct(1, 0), "reversed-pairs", "the whole product: unchanged");
  assert.equal(gradeRelation(0, 1, 0), "extra-pairs");
  assert.equal(gradeRelation(1, 0, 0), "reversed-pairs");
  assert.equal(gradeRelation(0, 0, 2), "missing-pairs");
  const r = parseMathWidget("product_builder", { mode: "relation", X: [-1, 1, 2], Y: [2, 4, 6, 8], pairs: [[-1, 2], [1, 6], [2, 8]] });
  assert.ok(r && "pairs" in r && r.pairs.length === 3);
  assert.equal(parseMathWidget("product_builder", { mode: "relation", X: [1], Y: [2], pairs: [[2, 1]] }), null, "not in X×Y");
});

test("curve_sketcher on the book's interval: x² − 4x + 3 on [−1, 5]", () => {
  const c = parseMathWidget("curve_sketcher", { fn: "quadratic", coefs: [1, -4, 3], grid: { x: [-1, 5], y: [-2, 9] } });
  assert.ok(c && c.name === "curve_sketcher" && c.grid);
  assert.equal(parseMathWidget("curve_sketcher", { fn: "quadratic", coefs: [1, -4, 3], grid: { x: [-1, 5], y: [20, 30] } }), null, "the curve is not on that plane");
  assert.ok(parseMathWidget("curve_sketcher", { fn: "quadratic", coefs: [-1, 6, -11], grid: { x: [0, 6], y: [-12, 0] } }), "−x² + 6x − 11 on [0, 6]");
});

test("curve_sketcher grades on the spec's own plane as on its family's: within tolerance, off it, upside down", async () => {
  const { gradeCurve } = await import("../components/student/widgets/curve-sketcher-grade.ts");
  const plane = { x: [-1, 5] as [number, number], y: [-2, 9] as [number, number] };
  const f = (x: number) => x * x - 4 * x + 3;
  const stroke = (h: (x: number) => number) => Array.from({ length: 61 }, (_, i) => -1 + (6 * i) / 60).map((x) => ({ x, y: h(x) }));
  assert.equal(gradeCurve("quadratic", [1, -4, 3], stroke(f), plane).predicate, "ok");
  assert.equal(gradeCurve("quadratic", [1, -4, 3], stroke((x) => f(x) + 0.5), plane).predicate, "ok", "half a unit: a sketch");
  assert.equal(gradeCurve("quadratic", [1, -4, 3], stroke((x) => f(x) + 2), plane).ok, false);
  assert.equal(gradeCurve("quadratic", [1, -4, 3], stroke((x) => -f(x) + 6), plane).predicate, "opens-wrong-way");
});

/* ---------------- the two new kinds ---------------- */

test("arrow_builder: the arrows graded as a set, named by what the wrong ones share", async () => {
  const { gradeArrows } = await import("../components/student/widgets/arrow-builder-grade.ts");
  const R: [string, string][] = [["-1", "2"], ["1", "6"], ["2", "8"]];
  assert.equal(gradeArrows(R, R).ok, true);
  assert.equal(gradeArrows([["-1", "2"], ["1", "6"]], R).predicate, "missing-arrows");
  assert.equal(gradeArrows([...R, ["1", "4"]], R).predicate, "extra-arrows");
  // a relation ON a set: "a is the additive inverse of b" drawn backwards
  const S: [string, string][] = [["1", "2"], ["2", "3"]];
  assert.equal(gradeArrows([["2", "1"], ["3", "2"]], S).predicate, "arrows-reversed");
  assert.ok(parseMathWidget("arrow_builder", { X: ["Ali", "Mona"], Y: ["Science", "Art"], pairs: [["Ali", "Art"]] }), "words, not only numbers");
  assert.equal(parseMathWidget("arrow_builder", { X: [1, 2], Y: [3], pairs: [[3, 1]] }), null, "a pair not from X to Y");
});

test("region_shader: X × X for X = [−2, 3], and its two named errors", async () => {
  const { gradeRegion, regionText } = await import("../components/student/widgets/region-shader-grade.ts");
  const closed = { left: false, right: false, bottom: false, top: false };
  const T = { x: [-2, 3] as [number, number], y: [-2, 3] as [number, number], open: closed };
  assert.equal(gradeRegion(T, T), "ok");
  assert.equal(gradeRegion({ ...T, open: { ...closed, right: true } }, T), "edge-inclusion-wrong");
  const U = { x: [0, 4] as [number, number], y: [-1, 2] as [number, number], open: closed };
  assert.equal(gradeRegion({ x: [-1, 2], y: [0, 4], open: closed }, U), "region-swapped");
  assert.equal(gradeRegion({ x: [-2, 2], y: [-2, 3], open: closed }, T), "off-target");
  assert.equal(regionText({ ...T, open: { ...closed, left: true } }), "(-2, 3] × [-2, 3]");
  const w = parseMathWidget("region_shader", { x: [-2, 3], y: [-2, 3] });
  assert.ok(w && w.name === "region_shader" && !w.open.left);
  assert.equal(parseMathWidget("region_shader", { x: [-2, 7], y: [-2, 3] }), null, "off the board");
});
