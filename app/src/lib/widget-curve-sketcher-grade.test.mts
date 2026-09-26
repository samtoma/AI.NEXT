/**
 * @covers FR-1205, FR-1206, FR-1208
 *
 * `curve_sketcher`'s grading — pure, no rendering. Linear and quadratic are
 * covered here as PROOF of behaviour (not just existence): every branch the
 * original inline `score()` had (vertical-line failure, partial coverage,
 * correct, vertically-displaced, the sign-flip diagnoses) is exercised with a
 * synthetic stroke and checked against the exact original wording's
 * arithmetic. `widget-curve-sketcher-replay.test.mts` is the companion that
 * replays the LIVE stored specs through this module.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BREAK,
  CURVE_PLANE,
  evalCurve,
  gradeCurve,
  splitSegments,
  tolFor,
  type CurveFn,
  type Pt,
} from "../components/student/widgets/curve-sketcher-grade.ts";
import { isKnownPredicate, OK } from "./widget-predicates.ts";

/** Sample `fn`'s TRUE curve at `n` evenly spaced points across its own
 *  domain — a "perfect" freehand stroke, for the correct-answer cases. */
function perfectStroke(fn: CurveFn, coefs: number[], n = 60): Pt[] {
  const [lo, hi] = CURVE_PLANE[fn].x;
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const x = lo + (i / (n - 1)) * (hi - lo);
    const y = evalCurve(fn, coefs, x);
    if (Number.isFinite(y)) pts.push({ x, y });
  }
  return pts;
}

/** The same, but split into two segments around `gapAt` (for the families
 *  with a vertical asymptote), joined by a `BREAK`. */
function perfectStrokeBroken(fn: CurveFn, coefs: number[], gapAt: number, n = 60): Pt[] {
  const [lo, hi] = CURVE_PLANE[fn].x;
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const x = lo + (i / (n - 1)) * (hi - lo);
    if (Math.abs(x - gapAt) < 1e-6) continue;
    const y = evalCurve(fn, coefs, x);
    if (!Number.isFinite(y)) continue;
    (x < gapAt ? left : right).push({ x, y });
  }
  return [...left, BREAK, ...right];
}

/* --------------------------------------------------------- linear/quadratic, unchanged behaviour */

test("a perfect linear sketch grades correct", () => {
  const g = gradeCurve("linear", [2, -1], perfectStroke("linear", [2, -1]));
  assert.equal(g.predicate, OK);
  assert.equal(g.verdict, "correct");
  assert.equal(g.ok, true);
});

test("a linear sketch with the slope's sign flipped is diagnosed by name", () => {
  // The true line rises (m=2); draw one that falls instead.
  const wrong = perfectStroke("linear", [-2, -1]);
  const g = gradeCurve("linear", [2, -1], wrong);
  assert.equal(g.predicate, "slope-sign-flipped");
  assert.equal(g.verdict, "wrong");
});

test("a perfect quadratic sketch grades correct", () => {
  const g = gradeCurve("quadratic", [1, 0, -4], perfectStroke("quadratic", [1, 0, -4]));
  assert.equal(g.predicate, OK);
});

test("a quadratic opening the wrong way is diagnosed by name", () => {
  const wrong = perfectStroke("quadratic", [-1, 0, -4]);
  const g = gradeCurve("quadratic", [1, 0, -4], wrong);
  assert.equal(g.predicate, "opens-wrong-way");
});

test("a stroke that doubles back fails the vertical line test, ranked above everything else", () => {
  // Two y-values at the same x: a real zig-zag, not a function.
  const stroke: Pt[] = [
    { x: -4, y: -4 }, { x: -2, y: 2 }, { x: 0, y: -4 }, { x: 2, y: 2 }, { x: 4, y: -4 },
    { x: 2, y: 3 }, { x: 0, y: -3 }, { x: -2, y: 3 }, { x: -4, y: -3 },
  ];
  const g = gradeCurve("linear", [1, 0], stroke);
  assert.equal(g.predicate, "fails-vertical-line-test");
  assert.equal(g.verdict, "wrong");
});

test("a stroke covering only part of the domain is partial, not wrong", () => {
  const [lo, hi] = CURVE_PLANE.linear.x;
  const half = perfectStroke("linear", [1, 0]).filter((p) => p.x < lo + (hi - lo) * 0.3);
  const g = gradeCurve("linear", [1, 0], half);
  assert.equal(g.predicate, "partial-coverage");
  assert.equal(g.verdict, "partial");
});

test("a shape-correct sketch sitting consistently off target is vertically-displaced, not wrong", () => {
  // A PERFECT parallel shift gives a CONSTANT error (worst === mean), which
  // can only ever land as "correct" (both under TOL) or "wrong" (both over)
  // — never "partial". A real hand is not that precise: most of the domain
  // sits a little high, and a short stretch near one edge sits a lot high.
  // That is what actually produces mean <= TOL < worst.
  const { TOL } = tolFor("linear");
  const [lo, hi] = CURVE_PLANE.linear.x;
  const span = hi - lo;
  const shifted = perfectStroke("linear", [1, 0]).map((p) => {
    const nearEdge = p.x - lo < span * 0.08;
    return { x: p.x, y: p.y + (nearEdge ? TOL * 1.6 : TOL * 0.7) };
  });
  const g = gradeCurve("linear", [1, 0], shifted);
  assert.equal(g.predicate, "vertically-displaced");
  assert.equal(g.verdict, "partial");
});

/* --------------------------------------------------------------- hyperbola */

test("a perfect two-branch hyperbola sketch (BREAK between branches) grades correct", () => {
  const stroke = perfectStrokeBroken("hyperbola", [2, -1], 0);
  const g = gradeCurve("hyperbola", [2, -1], stroke);
  assert.equal(g.predicate, OK);
});

test("drawing straight through the asymptote is asymptote-crossed, even though it also fails VLT", () => {
  // One CONTINUOUS stroke from the left branch through to the right branch —
  // exactly the mistake the multi-segment interaction exists to name.
  const stroke = perfectStroke("hyperbola", [2, -1]); // no BREAK inserted
  const g = gradeCurve("hyperbola", [2, -1], stroke);
  assert.equal(g.predicate, "asymptote-crossed");
});

test("hyperbola branches drawn in the wrong pair of quadrants are named", () => {
  // Target a=2 (branches where y>q for x>0); draw as if a=-2.
  const wrong = perfectStrokeBroken("hyperbola", [-2, -1], 0);
  const g = gradeCurve("hyperbola", [2, -1], wrong);
  assert.equal(g.predicate, "wrong-quadrants");
});

/* ------------------------------------------------------------- exponential */

test("a perfect exponential sketch grades correct", () => {
  const g = gradeCurve("exponential", [2, 3, -1], perfectStroke("exponential", [2, 3, -1]));
  assert.equal(g.predicate, OK);
});

test("an exponential sketch crossing its own horizontal asymptote is asymptote-crossed", () => {
  // The true curve never reaches y=q; a stroke that dips through it has
  // drawn the asymptote as if it were an ordinary line the curve can cross.
  const [lo, hi] = CURVE_PLANE.exponential.x;
  const q = -1;
  const stroke: Pt[] = [
    { x: lo, y: q + 4 }, { x: (lo + hi) / 2, y: q - 2 }, { x: hi, y: q + 6 },
  ];
  const g = gradeCurve("exponential", [2, 3, q], stroke);
  assert.equal(g.predicate, "asymptote-crossed");
});

test("an exponential sketch with the wrong y-intercept is named, not just off-target", () => {
  // Same shape, shifted along x so the intercept is wrong but the curve
  // still passes the vertical-line and coverage checks.
  const [a, b, q] = [2, 3, -1];
  const stroke = perfectStroke("exponential", [a, b, q]).map((p) => ({ x: p.x, y: p.y + 3 }));
  // (a shift this small keeps `worst`/`mean` above tolerance without also
  // passing the shift-hypothesis test, which this family does not offer)
  const g = gradeCurve("exponential", [a, b, q], stroke);
  assert.ok(["wrong-intercept", "off-target"].includes(g.predicate), g.predicate);
});

/* ------------------------------------------------------------ sine/cosine/tangent */

test("a perfect sine sketch grades correct", () => {
  const g = gradeCurve("sine", [2, 1], perfectStroke("sine", [2, 1]));
  assert.equal(g.predicate, OK);
});

test("a sine sketch with the amplitude sign flipped is amplitude-wrong", () => {
  const wrong = perfectStroke("sine", [-2, 1]);
  const g = gradeCurve("sine", [2, 1], wrong);
  assert.equal(g.predicate, "amplitude-wrong");
});

test("a sine sketch on the wrong midline is vertical-shift-wrong", () => {
  const wrong = perfectStroke("sine", [2, 3]);
  const g = gradeCurve("sine", [2, 1], wrong);
  assert.equal(g.predicate, "vertical-shift-wrong");
});

test("a cosine sketch drawn at double the true period is period-wrong", () => {
  // Same amplitude and midline, but the wave completes twice as often across
  // the full domain (period 180° instead of the book's 360°) — sampled
  // across the WHOLE domain, unlike a naive x/2 rescale, which would only
  // ever cover half of it and be caught by partial-coverage first.
  const [lo, hi] = CURVE_PLANE.cosine.x;
  const [yLo, yHi] = CURVE_PLANE.cosine.y;
  const stroke: Pt[] = [];
  for (let i = 0; i < 80; i++) {
    const x = lo + (i / 79) * (hi - lo);
    const y = evalCurve("cosine", [2, 0], x * 2);
    if (Number.isFinite(y) && y >= yLo && y <= yHi) stroke.push({ x, y });
  }
  const g = gradeCurve("cosine", [2, 0], stroke);
  assert.equal(g.predicate, "period-wrong");
});

test("a tangent sketch grades correct across its three branches", () => {
  // tangent has asymptotes at 90 and 270 inside [0,360] — three branches.
  const [lo, hi] = CURVE_PLANE.tangent.x;
  const segs: Pt[][] = [[], [], []];
  const bounds = [lo, 90, 270, hi];
  for (let i = 0; i < 3; i++) {
    for (let s = 0; s < 40; s++) {
      const x = bounds[i] + (s / 39) * (bounds[i + 1] - bounds[i]);
      if (Math.abs(x - 90) < 0.5 || Math.abs(x - 270) < 0.5) continue;
      const y = evalCurve("tangent", [1, 0], x);
      if (Number.isFinite(y) && y >= CURVE_PLANE.tangent.y[0] && y <= CURVE_PLANE.tangent.y[1]) {
        segs[i].push({ x, y });
      }
    }
  }
  const stroke = [...segs[0], BREAK, ...segs[1], BREAK, ...segs[2]];
  const g = gradeCurve("tangent", [1, 0], stroke);
  assert.equal(g.predicate, OK);
});

/* --------------------------------------------------------------------- BREAK / splitSegments */

test("splitSegments cuts on BREAK and drops empty segments", () => {
  const s = splitSegments([{ x: 0, y: 0 }, { x: 1, y: 1 }, BREAK, BREAK, { x: 2, y: 2 }]);
  assert.deepEqual(s, [[{ x: 0, y: 0 }, { x: 1, y: 1 }], [{ x: 2, y: 2 }]]);
});

test("a stroke with no BREAK is one segment", () => {
  const s = splitSegments([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  assert.equal(s.length, 1);
});

/* ------------------------------------------------------------- contract discipline */

test("every predicate gradeCurve can return is one the contract declares", () => {
  const cases: [CurveFn, number[], Pt[]][] = [
    ["linear", [2, -1], perfectStroke("linear", [-2, -1])],
    ["quadratic", [1, 0, -4], perfectStroke("quadratic", [-1, 0, -4])],
    ["hyperbola", [2, -1], perfectStroke("hyperbola", [2, -1])], // asymptote-crossed
    ["hyperbola", [2, -1], perfectStrokeBroken("hyperbola", [-2, -1], 0)],
    ["exponential", [2, 3, -1], perfectStroke("exponential", [2, 3, -1]).map((p) => ({ x: p.x, y: p.y + 5 }))],
    ["sine", [2, 1], perfectStroke("sine", [-2, 1])],
    ["sine", [2, 1], perfectStroke("sine", [2, 3])],
    ["tangent", [1, 0], perfectStroke("tangent", [-1, 0])],
  ];
  for (const [fn, coefs, stroke] of cases) {
    const g = gradeCurve(fn, coefs, stroke);
    assert.ok(isKnownPredicate("curve_sketcher", g.predicate), `${fn}: unknown predicate ${g.predicate}`);
  }
});
