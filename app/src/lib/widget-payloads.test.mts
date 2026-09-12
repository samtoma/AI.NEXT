import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMathWidget, MATH_WIDGETS, type MathWidget } from "./widget-payloads.ts";

/**
 * Every one of these payloads is the sort of thing a language model produces
 * mid-stream. The contract under test is narrow and absolute: a payload either
 * validates into something the student can actually answer, or it returns null
 * and no widget renders. There is no third outcome, and in particular there is
 * no repair — a coerced near-miss is how a student gets marked wrong for a
 * right answer, which is the failure this layer exists to prevent.
 */

const ok = (name: string, props: Record<string, unknown>): MathWidget => {
  const w = parseMathWidget(name, props);
  assert.ok(w, `expected ${name} ${JSON.stringify(props)} to validate`);
  return w;
};

const rejects = (name: string, props: Record<string, unknown>, why: string) =>
  assert.equal(parseMathWidget(name, props), null, `should reject: ${why}`);

test("an unknown widget name is never rendered", () => {
  rejects("definitely_not_a_widget", { prompt: "hi" }, "unknown name");
  rejects("", {}, "empty name");
  // A social-studies widget reaching the maths dispatcher is a routing bug,
  // not something to render anyway.
  rejects("locate_on_map", { base: "egypt", target: "القاهرة" }, "other subject's widget");
});

test("every registered name accepts at least one payload", () => {
  const samples: Record<string, Record<string, unknown>> = {
    pair_plotter: { target: [3, 2] },
    product_builder: { X: [1, 2], Y: [3, 4] },
    line_drawer: { mode: "equation", m: 2, b: -1 },
    circle_builder: { element: "chord" },
    angle_setter: { ask: "inscribed", target: 35 },
    triangle_ratio: { ask: "tan", target: 0.75 },
    bar_builder: { ask: "mean", target: 6, n: 5 },
    number_line_marker: { mode: "points", range: [-6, 6], targets: [-2, 3] },
    ratio_balance: { mode: "direct", a: 3, b: 4, c: 9 },
    sample_space: { rule: { kind: "sum", op: "eq", value: 7 } },
    curve_sketcher: { fn: "quadratic", coefs: [1, 0, -4] },
  };
  for (const name of MATH_WIDGETS) {
    assert.ok(samples[name], `no sample payload for registered widget ${name}`);
    ok(name, samples[name]);
  }
});

test("a missing prompt falls back rather than rendering 'undefined' at a child", () => {
  const w = ok("circle_builder", { element: "tangent" });
  assert.match(w.prompt, /tangent/);
  assert.doesNotMatch(w.prompt, /undefined/);
});

/* ---------------- type confusion: the commonest model slip ---------------- */

test("numbers arriving as strings are rejected, not coerced", () => {
  rejects("pair_plotter", { target: ["3", "2"] }, "string coordinates");
  rejects("angle_setter", { ask: "inscribed", target: "35" }, "string angle");
  rejects("curve_sketcher", { fn: "linear", coefs: ["2", "1"] }, "string coefficients");
  rejects("ratio_balance", { mode: "direct", a: "3", b: 4, c: 9 }, "string term");
});

test("non-finite numbers are rejected", () => {
  rejects("pair_plotter", { target: [NaN, 2] }, "NaN coordinate");
  rejects("triangle_ratio", { ask: "tan", target: Infinity }, "infinite ratio");
  rejects("curve_sketcher", { fn: "linear", coefs: [1, NaN] }, "NaN coefficient");
});

test("arrays of the wrong length are rejected", () => {
  rejects("pair_plotter", { target: [3] }, "one coordinate");
  rejects("pair_plotter", { target: [3, 2, 1] }, "three coordinates");
  rejects("curve_sketcher", { fn: "quadratic", coefs: [1, 0] }, "quadratic needs three");
  rejects("curve_sketcher", { fn: "linear", coefs: [1, 0, -4] }, "linear takes two");
});

/* ---------------- reachability: well-typed but unanswerable -------------- */

test("a target off the grid is refused even though it is well-typed", () => {
  rejects("pair_plotter", { target: [9, 2] }, "outside the −5..5 grid");
  rejects("pair_plotter", { target: [1.5, 2] }, "not a lattice point");
});

test("an angle off the 5 degree snap could never be reached", () => {
  ok("angle_setter", { ask: "central", target: 80 });
  rejects("angle_setter", { ask: "central", target: 37 }, "handles snap to 5°");
  rejects("angle_setter", { ask: "inscribed", target: 180 }, "inscribed angle cannot be a straight line");
  rejects("angle_setter", { ask: "central", target: 0 }, "no angle at all");
});

test("sin and cos cannot reach 1 in a triangle that exists", () => {
  ok("triangle_ratio", { ask: "sin", target: 0.6 });
  rejects("triangle_ratio", { ask: "sin", target: 1 }, "leg would equal the hypotenuse");
  rejects("triangle_ratio", { ask: "cos", target: 1.2 }, "longer than the hypotenuse");
  rejects("triangle_ratio", { ask: "tan", target: 0 }, "a leg of zero is not a triangle");
  // tan is unbounded in principle but the legs stop at 12.
  ok("triangle_ratio", { ask: "tan", target: 12 });
  rejects("triangle_ratio", { ask: "tan", target: 13 }, "beyond the longest leg");
});

test("a balance whose fourth term is not a whole pan position is refused", () => {
  ok("ratio_balance", { mode: "direct", a: 3, b: 4, c: 9 });      // → 12
  ok("ratio_balance", { mode: "inverse", a: 6, b: 10, c: 4 });    // → 15
  rejects("ratio_balance", { mode: "direct", a: 3, b: 4, c: 10 }, "40/3 is not a whole term");
  rejects("ratio_balance", { mode: "direct", a: 1, b: 30, c: 1 }, "beyond the pan's range");
  rejects("ratio_balance", { mode: "direct", a: 0, b: 4, c: 9 }, "division by zero");
  rejects("ratio_balance", { mode: "direct", a: 3, b: -4, c: 9 }, "negative quantity");
});

test("a line whose points are not on the lattice is refused", () => {
  ok("line_drawer", { mode: "equation", m: 2, b: -1 });
  ok("line_drawer", { mode: "equation", m: 0.5, b: 3 });    // reciprocal of a whole number
  rejects("line_drawer", { mode: "equation", m: 2, b: 1.5 }, "fractional intercept");
  rejects("line_drawer", { mode: "equation", m: 0.3, b: 1 }, "no two lattice points on it");
  rejects("line_drawer", { mode: "points", through: [[1, 1], [1, 1]] }, "both handles on one point");
  rejects("line_drawer", { mode: "points", through: [[1, 1]] }, "only one point given");
});

test("a statistic outside what the bars can build is refused", () => {
  ok("bar_builder", { ask: "mean", target: 6, n: 5 });
  rejects("bar_builder", { ask: "mean", target: 14, n: 5 }, "bars stop at 10");
  rejects("bar_builder", { ask: "mode", target: 6.5, n: 5 }, "a mode is one of the values");
  rejects("bar_builder", { ask: "range", target: 3.5, n: 5 }, "a range of whole bars is whole");
  rejects("bar_builder", { ask: "mean", target: 6, n: 2 }, "too few bars");
  rejects("bar_builder", { ask: "mean", target: 6, n: 12 }, "too many bars to read");
  // A non-integer MEAN is fine — that is the interesting case.
  ok("bar_builder", { ask: "mean", target: 6.4, n: 5 });
});

test("number line targets must all sit inside the drawn range", () => {
  ok("number_line_marker", { mode: "points", range: [-6, 6], targets: [-2, 3] });
  rejects("number_line_marker", { mode: "points", range: [-6, 6], targets: [-2, 30] },
          "one target off the line rejects the set");
  rejects("number_line_marker", { mode: "points", range: [-6, 6], targets: [] }, "nothing to mark");
  rejects("number_line_marker", { mode: "interval", range: [-6, 6], from: 5, to: 2 }, "reversed interval");
  rejects("number_line_marker", { mode: "points", range: [6, -6], targets: [0] }, "reversed range");
  rejects("number_line_marker", { mode: "points", range: [-20, 20], targets: [0] }, "ticks would collide");
});

test("open and closed endpoints default to closed and only true opens them", () => {
  const a = ok("number_line_marker", { mode: "interval", range: [-6, 6], from: 2, to: 6 });
  assert.equal(a.name === "number_line_marker" && a.mode === "interval" && a.openFrom, false);
  const b = ok("number_line_marker", {
    mode: "interval", range: [-6, 6], from: 2, to: 6, openFrom: "yes",
  });
  // A truthy string is NOT true: > and ≥ differ by exactly this flag.
  assert.equal(b.name === "number_line_marker" && b.mode === "interval" && b.openFrom, false);
});

test("a quadratic with a = 0 is refused — it is a line wearing the wrong name", () => {
  rejects("curve_sketcher", { fn: "quadratic", coefs: [0, 2, 1] }, "not a parabola");
  ok("curve_sketcher", { fn: "linear", coefs: [0, 3] });   // a flat line is fine
});

test("the sample space rule is a NAMED rule, never a list of answer cells", () => {
  const w = ok("sample_space", { rule: { kind: "sum", op: "eq", value: 7 } });
  assert.equal(w.name === "sample_space" && w.rule.kind, "sum");
  rejects("sample_space", { rule: { kind: "total", op: "eq", value: 7 } }, "unknown rule kind");
  rejects("sample_space", { rule: { kind: "sum", op: "equals", value: 7 } }, "unknown operator");
  rejects("sample_space", { rule: ["sum", 7] }, "rule is not an object");
  rejects("sample_space", { rule: { kind: "sum", value: "7" } }, "string value");
  rejects("sample_space", { rule: { kind: "sum", value: 7 }, rows: 20 }, "grid too large");
  // `same` needs no value, and `op` defaults to equality.
  ok("sample_space", { rule: { kind: "same" } });
});

test("enumerated fields reject anything outside the enum", () => {
  rejects("circle_builder", { element: "secant" }, "not a constructible element here");
  rejects("circle_builder", {}, "no element named");
  rejects("bar_builder", { ask: "average", target: 6 }, "not a statistic name");
  rejects("line_drawer", { mode: "freehand", m: 1, b: 0 }, "not a line mode");
  rejects("curve_sketcher", { fn: "cubic", coefs: [1, 0, 0] }, "unsupported family");
});

test("a payload is never mutated by validation", () => {
  const props = { target: [3, 2], prompt: "Plot it" };
  const before = JSON.stringify(props);
  parseMathWidget("pair_plotter", props);
  assert.equal(JSON.stringify(props), before);
});
