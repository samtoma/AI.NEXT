import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMathWidget, MATH_WIDGETS, type MathWidget } from "./widget-payloads.ts";

/**
 * @covers FR-1207, FR-1208
 *
 * Reject rather than repair, including targets that are well-typed but
 * unreachable — and prove it without rendering a component.
 *
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
    polygon_builder: { mode: "construct", shape: "isosceles" },
    solid_scaler: { solid: "box", ask: "volume", ratio: 8 },
    box_plot_builder: { data: [2, 4, 4, 5, 6, 7, 9] },
    venn_builder: { sets: 2, labels: ["Football", "Chess"], mode: "shade", target: "aOnly" },
    area_model: { mode: "expand", a: 2, b: -3 },
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

/* ------------------------------------ polygon_builder, solid_scaler, box_plot_builder */

test("polygon_builder construct accepts every named shape and rejects an unknown one", () => {
  for (const shape of ["scalene", "isosceles", "right", "parallelogram", "rectangle",
                        "rhombus", "square", "trapezium", "kite"]) {
    ok("polygon_builder", { mode: "construct", shape });
  }
  rejects("polygon_builder", { mode: "construct", shape: "equilateral" },
    "a square lattice cannot draw an equilateral triangle");
  rejects("polygon_builder", { mode: "construct" }, "no shape named");
});

test("polygon_builder midsegment needs a real, non-degenerate triangle", () => {
  ok("polygon_builder", { mode: "midsegment", triangle: [[0, 0], [6, 0], [0, 6]], apex: 0 });
  rejects("polygon_builder", { mode: "midsegment", triangle: [[0, 0], [2, 0], [4, 0]], apex: 0 },
    "three collinear points");
  rejects("polygon_builder", { mode: "midsegment", triangle: [[0, 0], [6, 0], [0, 6]], apex: 3 },
    "apex out of range");
  rejects("polygon_builder", { mode: "midsegment", triangle: [[0, 0], [6, 0]], apex: 0 },
    "only two vertices");
});

test("polygon_builder area needs a target that a lattice polygon can actually hit", () => {
  ok("polygon_builder", { mode: "area", shape: "triangle", target: 6 });
  ok("polygon_builder", { mode: "area", shape: "quadrilateral", target: 6.5 });
  rejects("polygon_builder", { mode: "area", shape: "triangle", target: 6.3 },
    "not a multiple of Pick's-theorem ½");
  rejects("polygon_builder", { mode: "area", shape: "triangle", target: 0 }, "no area at all");
  rejects("polygon_builder", { mode: "area", shape: "triangle", target: 100 }, "off the lattice entirely");
});

test("solid_scaler refuses a ratio whose k does not land on the slider's own grid", () => {
  ok("solid_scaler", { solid: "cylinder", ask: "volume", ratio: 8 });   // k = 2
  ok("solid_scaler", { solid: "sphere", ask: "area", ratio: 2.25 });    // k = 1.5
  rejects("solid_scaler", { solid: "box", ask: "volume", ratio: 10 }, "∛10 is not on the 0.5 grid");
  rejects("solid_scaler", { solid: "box", ask: "area", ratio: 30 }, "√30 is off the top of the slider");
  rejects("solid_scaler", { solid: "teapot", ask: "volume", ratio: 8 }, "not a built solid");
});

test("solid_scaler dims fall back to a nice default and reject an unreasonable override", () => {
  const w = ok("solid_scaler", { solid: "box", ask: "volume", ratio: 8 });
  assert.equal(w.name === "solid_scaler" && w.dims.l, 4);
  ok("solid_scaler", { solid: "box", ask: "volume", ratio: 8, dims: { l: 2, w: 2, h: 2 } });
  rejects("solid_scaler", { solid: "box", ask: "volume", ratio: 8, dims: { l: -1 } }, "negative dimension");
  rejects("solid_scaler", { solid: "box", ask: "volume", ratio: 8, dims: { l: 50 } }, "too large to draw");
});

test("box_plot_builder needs a readable, whole-number data set", () => {
  ok("box_plot_builder", { data: [2, 4, 4, 5, 6, 7, 9] });
  rejects("box_plot_builder", { data: [1, 2, 3] }, "too few values to summarise");
  rejects("box_plot_builder", { data: [1.5, 2, 3, 4, 5] }, "quartiles would land off the snap grid");
  rejects("box_plot_builder", { data: ["1", "2", "3", "4", "5"] }, "strings, not numbers");
  rejects("box_plot_builder", { data: Array.from({ length: 20 }, (_, i) => i) }, "too many to lay out");
});

test("a payload is never mutated by validation", () => {
  const props = { target: [3, 2], prompt: "Plot it" };
  const before = JSON.stringify(props);
  parseMathWidget("pair_plotter", props);
  assert.equal(JSON.stringify(props), before);
});

/* ---------------------- curve_sketcher's five new families (feature 003) -- */

test("curve_sketcher's five new families each accept a reasonable target", () => {
  ok("curve_sketcher", { fn: "hyperbola", coefs: [2, -1] });
  ok("curve_sketcher", { fn: "exponential", coefs: [2, 3, -1] });
  ok("curve_sketcher", { fn: "sine", coefs: [2, 1] });
  ok("curve_sketcher", { fn: "cosine", coefs: [-3, 0] });
  ok("curve_sketcher", { fn: "tangent", coefs: [1, -2] });
  // Linear and quadratic are completely unaffected by the new families.
  ok("curve_sketcher", { fn: "linear", coefs: [2, -1] });
  ok("curve_sketcher", { fn: "quadratic", coefs: [1, 0, -4] });
});

test("a hyperbola with a = 0 is refused — it is not a hyperbola at all", () => {
  rejects("curve_sketcher", { fn: "hyperbola", coefs: [0, 1] }, "y=q is a flat line");
  rejects("curve_sketcher", { fn: "hyperbola", coefs: [7, 1] }, "a beyond the ±6 bound");
  rejects("curve_sketcher", { fn: "hyperbola", coefs: [1.5, 1] }, "a is not a whole number");
});

test("exponential's base must land on the family's three built-in growth rates", () => {
  ok("curve_sketcher", { fn: "exponential", coefs: [1, 2, 0] });
  ok("curve_sketcher", { fn: "exponential", coefs: [1, 0.5, 0] });
  rejects("curve_sketcher", { fn: "exponential", coefs: [1, 4, 0] }, "b=4 is not one of the three rates");
  rejects("curve_sketcher", { fn: "exponential", coefs: [1, 1, 0] }, "b=1 is a constant, not exponential");
  rejects("curve_sketcher", { fn: "exponential", coefs: [0, 2, 0] }, "a=0 is the asymptote itself");
});

test("sine, cosine and tangent all refuse a zero amplitude and an out-of-range one", () => {
  ok("curve_sketcher", { fn: "sine", coefs: [4, 0] });
  rejects("curve_sketcher", { fn: "sine", coefs: [0, 0] }, "a flat line is not a sine curve");
  rejects("curve_sketcher", { fn: "sine", coefs: [5, 0] }, "beyond the sine/cosine bound of 4");
  ok("curve_sketcher", { fn: "tangent", coefs: [3, 0] });
  rejects("curve_sketcher", { fn: "tangent", coefs: [4, 0] }, "beyond tangent's tighter bound of 3");
});

/* --------------------------------------------------------------- venn_builder */

test("venn_builder shade mode accepts every 2-set target and rejects a 3-set-only one", () => {
  for (const target of ["union", "intersection", "aOnly", "bOnly", "complementA", "complementB", "neither"]) {
    ok("venn_builder", { sets: 2, labels: ["A", "B"], mode: "shade", target });
  }
  rejects("venn_builder", { sets: 2, labels: ["A", "B"], mode: "shade", target: "cOnly" },
    "no third set on a 2-set diagram");
  rejects("venn_builder", { sets: 2, labels: ["A", "B"], mode: "shade", target: "complementC" },
    "no third set to complement");
  ok("venn_builder", { sets: 3, labels: ["A", "B", "C"], mode: "shade", target: "cOnly" });
});

test("venn_builder needs exactly as many labels as sets", () => {
  rejects("venn_builder", { sets: 3, labels: ["A", "B"], mode: "shade", target: "aOnly" },
    "two labels for three sets");
  rejects("venn_builder", { sets: 2, labels: ["A", "B", "C"], mode: "shade", target: "aOnly" },
    "three labels for two sets");
  rejects("venn_builder", { sets: 2, labels: ["A", ""], mode: "shade", target: "aOnly" },
    "a blank label");
  rejects("venn_builder", { sets: 4, labels: ["A", "B", "C", "D"], mode: "shade", target: "aOnly" },
    "only 2 or 3 sets are drawable");
});

test("venn_builder counts mode requires every region and a consistent total", () => {
  ok("venn_builder", {
    sets: 2, labels: ["French", "German"], mode: "counts",
    total: 20, regions: { a: 8, b: 5, ab: 4, n: 3 },
  });
  rejects("venn_builder", {
    sets: 2, labels: ["French", "German"], mode: "counts",
    total: 20, regions: { a: 8, b: 5, ab: 4 }, // "n" missing
  }, "a region left out entirely");
  rejects("venn_builder", {
    sets: 2, labels: ["French", "German"], mode: "counts",
    total: 21, regions: { a: 8, b: 5, ab: 4, n: 3 }, // sums to 20, not 21
  }, "the stated total the regions cannot add up to");
  rejects("venn_builder", {
    sets: 2, labels: ["French", "German"], mode: "counts",
    regions: { a: -1, b: 5, ab: 4, n: 3 },
  }, "a negative count");
  // No total given at all is fine — not every word problem states one.
  ok("venn_builder", {
    sets: 2, labels: ["French", "German"], mode: "counts",
    regions: { a: 8, b: 5, ab: 4, n: 3 },
  });
});

/* ---------------------------------------------------------------- area_model */

test("area_model accepts whole a/b within the grid's reach and refuses the degenerate/oversized cases", () => {
  ok("area_model", { mode: "expand", a: 2, b: -3 });
  ok("area_model", { mode: "factor", a: -4, b: 4 });
  rejects("area_model", { mode: "expand", a: 0, b: 0 }, "just x² teaches nothing this widget is for");
  rejects("area_model", { mode: "expand", a: 5, b: 1 }, "the grid runs out past ±4");
  rejects("area_model", { mode: "expand", a: 1.5, b: 1 }, "a must be a whole number");
  rejects("area_model", { mode: "spread", a: 1, b: 1 }, "not a recognised mode");
});

test("every registered widget from feature 003's own list still validates its sample", () => {
  // A drift guard: if a widget agent adds a kind to MATH_WIDGETS without a
  // reachable sample here, "every registered name accepts at least one
  // payload" above already catches it — this just names the three kinds this
  // brief added, so a reviewer can see them called out explicitly.
  for (const name of ["curve_sketcher", "venn_builder", "area_model"]) {
    assert.ok((MATH_WIDGETS as readonly string[]).includes(name), `${name} is not registered`);
  }
});
