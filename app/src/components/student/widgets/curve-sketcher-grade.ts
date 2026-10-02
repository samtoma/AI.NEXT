/**
 * Grading for `curve_sketcher` — pure, so it is tested without rendering
 * (FR-1208). `CurveSketcher.tsx` calls this and builds the words around it;
 * `widget-emission.test.mts` reads this file as part of that widget, so a
 * predicate emitted here is held to the contract like one emitted in the
 * component.
 *
 * LINEAR AND QUADRATIC ARE THE ORIGINAL ARITHMETIC, MOVED, NOT CHANGED. This
 * module is a straight extraction of what used to live inline in
 * `CurveSketcher.tsx` (the shipped Prep-3 widget, through v0.9.3): same
 * samples, same tolerances, same ordered checks, same predicate names. Five
 * families are added beside it — hyperbola, exponential, sine, cosine,
 * tangent (feature 003, the Grade 10 American course) — each reachable
 * on its own family-appropriate plane (`CURVE_PLANE`), never on the
 * linear/quadratic one. `curve-sketcher-replay.test.mts` re-runs every live
 * curve_sketcher spec in
 * `services/extraction/seed/generated/widget-questions.json` through this
 * module and checks the verdict against a frozen copy of the pre-refactor
 * arithmetic, so "additive only" is a tested claim rather than a promise.
 *
 * THE ASYMPTOTE PROBLEM. A hyperbola has two branches and a tangent has
 * three across one visible period; none of them can be drawn as a single
 * unbroken freehand stroke without cutting through where the function is
 * undefined. `drag.ts`'s `useStroke` gained an opt-in `multiSegment` mode for
 * exactly this (a lift-and-continue gesture, encoded as a `BREAK` sentinel
 * point in the returned array) — off by default, so the original
 * single-gesture contract for linear and quadratic is untouched. Every
 * function here that walks a stroke does it through `splitSegments` /
 * `crossingsAt`, which treat a `BREAK` as "the pointer left the glyph", not
 * as "the function is discontinuous there" — that distinction is what
 * `asymptote-crossed` actually tests: did one CONTINUOUS gesture cross the
 * asymptote, which no correct answer can do.
 */

import { OK } from "@/lib/widget-predicates";

export interface Pt {
  x: number;
  y: number;
}

export type CurveFn =
  | "linear"
  | "quadratic"
  | "hyperbola"
  | "exponential"
  | "sine"
  | "cosine"
  | "tangent";

/** A lift-of-the-pointer marker inside a `multiSegment` stroke array. Never
 *  produced by the single-gesture path (linear, quadratic), so `splitSegments`
 *  on one of those strokes always returns exactly one segment. */
export const BREAK: Pt = { x: NaN, y: NaN };
const isBreak = (p: Pt) => Number.isNaN(p.x) || Number.isNaN(p.y);

/** A raw stroke, cut at every `BREAK`, empty segments dropped. */
export function splitSegments(stroke: readonly Pt[]): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  for (const p of stroke) {
    if (isBreak(p)) {
      if (cur.length) out.push(cur);
      cur = [];
    } else {
      cur.push(p);
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Number of coefficients each family takes — the reachability layer
 *  (`widget-payloads.ts`) and the component both read this so the shape
 *  cannot drift between validation and rendering. */
export const CURVE_COEF_COUNT: Record<CurveFn, number> = {
  linear: 2,
  quadratic: 3,
  hyperbola: 2,
  exponential: 3,
  sine: 2,
  cosine: 2,
  tangent: 2,
};

/**
 * The plane each family is sketched on. Linear and quadratic keep the
 * original −5..5 square byte-for-byte. The trig families use DEGREES on the
 * x-axis — the book's own unit for this course, and the reason their domain
 * is 0..360 rather than a signed lattice — and hyperbola/exponential get more
 * headroom because a branch or a tail leaves a −5..5 frame almost at once.
 */
export const CURVE_PLANE: Record<CurveFn, { x: [number, number]; y: [number, number] }> = {
  linear: { x: [-5, 5], y: [-5, 5] },
  quadratic: { x: [-5, 5], y: [-5, 5] },
  hyperbola: { x: [-6, 6], y: [-6, 6] },
  exponential: { x: [-4, 4], y: [-2, 10] },
  sine: { x: [0, 360], y: [-5, 5] },
  cosine: { x: [0, 360], y: [-5, 5] },
  tangent: { x: [0, 360], y: [-8, 8] },
};

/** Fixed period, in the x-axis's own unit, per the Grade 10 book's own
 *  convention. This course does not vary a "b" stretch factor, so period is
 *  a property of the family, not a parameter a spec carries — which is what
 *  makes `period-wrong` a nameable, single-cause error rather than "the
 *  numbers are off". */
export const CURVE_PERIOD: Record<"sine" | "cosine" | "tangent", number> = {
  sine: 360,
  cosine: 360,
  tangent: 180,
};

/** x-values where this family is undefined — the asymptotes a correct
 *  sketch must never be drawn through in one unbroken gesture. Empty for
 *  every family with no vertical asymptote. */
export function verticalAsymptotes(fn: CurveFn): number[] {
  if (fn === "hyperbola") return [0];
  if (fn === "tangent") return [90, 270];
  return [];
}

export function evalCurve(fn: CurveFn, k: readonly number[], x: number): number {
  switch (fn) {
    case "linear":
      return k[0] * x + k[1];
    case "quadratic":
      return k[0] * x * x + k[1] * x + k[2];
    case "hyperbola":
      return k[0] / x + k[1];
    case "exponential":
      return k[0] * Math.pow(k[1], x) + k[2];
    case "sine":
      return k[0] * Math.sin((x * Math.PI) / 180) + k[1];
    case "cosine":
      return k[0] * Math.cos((x * Math.PI) / 180) + k[1];
    case "tangent":
      return k[0] * Math.tan((x * Math.PI) / 180) + k[1];
  }
}

/** The words for "what this curve is", used in the feedback line. Linear and
 *  quadratic text is byte-identical to the original inline `describe()`. */
export function describeCurve(fn: CurveFn, k: readonly number[]): string {
  if (fn === "linear")
    return `a straight line ${k[0] > 0 ? "rising" : k[0] < 0 ? "falling" : "flat"}, crossing the y-axis at ${tidy(k[1], 2)}`;
  if (fn === "quadratic") {
    const vx = -k[1] / (2 * k[0]);
    return `a parabola opening ${k[0] > 0 ? "upwards" : "downwards"}, turning at (${tidy(vx, 2)}, ${tidy(evalCurve(fn, k, vx), 2)})`;
  }
  if (fn === "hyperbola")
    return `a hyperbola y = ${tidy(k[0], 2)}/x ${k[1] >= 0 ? "+" : "−"} ${tidy(Math.abs(k[1]), 2)}, with branches in the pair of quadrants ${k[0] > 0 ? "where x and y − " + tidy(k[1], 2) + " share a sign" : "where x and y − " + tidy(k[1], 2) + " have opposite signs"}`;
  if (fn === "exponential")
    return `an exponential curve through (0, ${tidy(k[0] + k[2], 2)}), levelling towards y = ${tidy(k[2], 2)}`;
  const period = CURVE_PERIOD[fn as "sine" | "cosine" | "tangent"];
  const name = fn === "sine" ? "sin" : fn === "cosine" ? "cos" : "tan";
  return `y = ${tidy(k[0], 2)} ${name} θ ${k[1] >= 0 ? "+" : "−"} ${tidy(Math.abs(k[1]), 2)}, period ${period}°`;
}

/** Round to `dp` decimal places, killing floating-point lint before it
 *  reaches a label — copied rather than imported so this module has no
 *  dependency on the interaction layer (`drag.ts`) and stays trivially
 *  importable from a Python-free, React-free test. */
function tidy(v: number, dp = 4): number {
  return Math.round(v * 10 ** dp) / 10 ** dp;
}

/** Every y at which one segment's polyline crosses the vertical line at x —
 *  the original `crossings()`, generalised over several segments. A `BREAK`
 *  never contributes a crossing (there is no segment either side of it to
 *  interpolate across), which is exactly the point: a gap is a gap. */
export function crossingsAt(segments: readonly Pt[][], x: number): number[] {
  const out: number[] = [];
  for (const seg of segments) {
    for (let i = 1; i < seg.length; i++) {
      const p = seg[i - 1];
      const q = seg[i];
      if (p.x === q.x) continue;
      if ((p.x - x) * (q.x - x) > 0) continue;
      const t = (x - p.x) / (q.x - p.x);
      if (t >= 0 && t <= 1) out.push(p.y + t * (q.y - p.y));
    }
  }
  return out;
}

/** True if some segment's own polyline crosses `asymptoteX` mid-segment —
 *  i.e. the pointer was down on both sides of it without lifting. */
function segmentCrossesVertical(segments: readonly Pt[][], asymptoteX: number): boolean {
  return segments.some((seg) =>
    seg.some((p, i) => i > 0 && (seg[i - 1].x - asymptoteX) * (p.x - asymptoteX) < 0)
  );
}

/** True if the drawn stroke crosses its family's horizontal asymptote
 *  anywhere — only meaningful for exponential, whose true curve never
 *  reaches y = q let alone crosses it, so ANY crossing is the error. */
function crossesHorizontalAsymptote(fn: CurveFn, k: readonly number[], segments: readonly Pt[][]): boolean {
  if (fn !== "exponential") return false;
  const asy = k[2];
  return segments.some((seg) =>
    seg.some((p, i) => i > 0 && (seg[i - 1].y - asy) * (p.y - asy) < 0)
  );
}

const SAMPLES = 41;
/** Below this share of the domain the sketch is a fragment, not an answer —
 *  unit-independent, so it is the same literal for every family. */
const MIN_COVER = 0.7;

/** The tolerance pair `gradeCurve` grades this family against, for a message
 *  that wants to quote it (the original "within the 0.9 tolerance" line).
 *  Linear and quadratic are the exact original literals — see `gradeCurve`. */
export function tolFor(fn: CurveFn): { TOL: number; VLT: number } {
  if (fn === "linear" || fn === "quadratic") return { TOL: 0.9, VLT: 0.7 };
  const [yLo, yHi] = CURVE_PLANE[fn].y;
  return { TOL: (yHi - yLo) * 0.09, VLT: (yHi - yLo) * 0.07 };
}

/** Matches `WidgetShell`'s `Verdict` without importing it — this module has
 *  no React dependency, by design (FR-1208: testable without rendering). */
export type CurveVerdict = "correct" | "partial" | "wrong";

export interface CurveGrade {
  ok: boolean;
  verdict: CurveVerdict;
  /** `ok`, or one of curve_sketcher's predicates. `off-target` is reachable
   *  from BOTH `partial` (the shape is right, closely, in no nameable way)
   *  and `wrong` (nothing nameable fired) — `verdict` is what tells them
   *  apart; the predicate string alone does not. */
  predicate: string;
  /** Mean / worst absolute error over the samples the stroke covered. */
  mean: number;
  worst: number;
  /** Mean SIGNED error — its sign is which way the sketch sits off target. */
  bias: number;
  /** Fraction of the visible truth curve the stroke covered. */
  cover: number;
  /** Sample columns that failed the vertical-line test. */
  vltFails: number;
  /** Sample columns tested — always `SAMPLES`; carried on the result so the
   *  component can reproduce the original message's own count/percent text
   *  without a second constant to keep in sync. */
  samples: number;
}

/** Mean absolute error of the drawn stroke against an arbitrary hypothesis
 *  function, over the same sample columns `gradeCurve` uses — the tool
 *  `gradeCurve` uses to tell "wrong sign of a" from "wrong shift" from
 *  "wrong period" apart once a sketch is confirmed wrong, by seeing which
 *  single-cause rewrite of the target would have matched the stroke. */
function meanErrorAgainst(
  hypothesis: (x: number) => number,
  segments: readonly Pt[][],
  domain: readonly [number, number]
): number | null {
  const [lo, hi] = domain;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const x = lo + (i / (SAMPLES - 1)) * (hi - lo);
    const hy = hypothesis(x);
    if (!Number.isFinite(hy)) continue;
    const ys = crossingsAt(segments, x);
    if (ys.length === 0) continue;
    const y = ys.reduce((s, v) => s + v, 0) / ys.length;
    sum += Math.abs(y - hy);
    n++;
  }
  return n === 0 ? null : sum / n;
}

/**
 * Grade one freehand stroke against `fn`/`coefs`. Pure — no React, no DOM;
 * `stroke` is plane-space points, `BREAK`-separated when the gesture was
 * lifted and resumed (multi-branch families only).
 */
export function gradeCurve(fn: CurveFn, coefs: readonly number[], stroke: readonly Pt[]): CurveGrade {
  const [lo, hi] = CURVE_PLANE[fn].x;
  const [yLo, yHi] = CURVE_PLANE[fn].y;
  // Linear and quadratic keep the ORIGINAL literals — 0.9 and 0.7 over a
  // Y-span of 10 — rather than a value re-derived from the span, so a float
  // rounding difference can never move `worst <= TOL` across its boundary
  // for a spec that shipped before this module existed.
  const { TOL, VLT } = tolFor(fn);

  const segments = splitSegments(stroke);
  let covered = 0;
  let vltFails = 0;
  let sum = 0;
  let worst = 0;
  let signedSum = 0;

  for (let i = 0; i < SAMPLES; i++) {
    const x = lo + (i / (SAMPLES - 1)) * (hi - lo);
    const truthY = evalCurve(fn, coefs, x);
    // A sample the real curve leaves the frame at, or that sits exactly on an
    // asymptote, cannot be drawn, so it is not held against the student.
    if (!Number.isFinite(truthY) || truthY < yLo || truthY > yHi) continue;
    const ys = crossingsAt(segments, x);
    if (ys.length === 0) continue;
    covered++;
    if (Math.max(...ys) - Math.min(...ys) > VLT) vltFails++;
    const y = ys.reduce((s, v) => s + v, 0) / ys.length;
    const err = y - truthY;
    signedSum += err;
    sum += Math.abs(err);
    worst = Math.max(worst, Math.abs(err));
  }

  let inFrame = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const x = lo + (i / (SAMPLES - 1)) * (hi - lo);
    const ty = evalCurve(fn, coefs, x);
    if (Number.isFinite(ty) && ty >= yLo && ty <= yHi) inFrame++;
  }
  const cover = inFrame ? covered / inFrame : 0;
  const mean = covered ? sum / covered : Infinity;
  const bias = covered ? signedSum / covered : 0;

  // `v`/`pred` — the same two names, and the same "set once, return once at
  // the bottom" shape, the original inline `score()` used, so the ordered
  // checks below read exactly like the arithmetic they replace.
  let v: CurveVerdict;
  let pred: string = OK;

  // Asymptote-crossed outranks the vertical-line test: a hyperbola or a
  // tangent drawn straight through where it is undefined ALSO fails VLT in
  // the frame's terms (two branches on either side of x=0 read as "one x,
  // many y" once you sample near it), and the more specific, more teachable
  // name wins.
  const asyXs = verticalAsymptotes(fn);
  if (
    asyXs.some((ax) => segmentCrossesVertical(segments, ax)) ||
    crossesHorizontalAsymptote(fn, coefs, segments)
  ) {
    v = "wrong";
    pred = "asymptote-crossed";
  } else if (vltFails > SAMPLES * 0.06) {
    v = "wrong";
    pred = "fails-vertical-line-test";
  } else if (cover < MIN_COVER) {
    v = "partial";
    pred = "partial-coverage";
  } else if (worst <= TOL) {
    v = "correct";
    pred = OK;
  } else if (mean <= TOL) {
    v = "partial";
    pred = Math.abs(bias) > TOL * 0.6 ? "vertically-displaced" : "off-target";
  } else if (fn === "quadratic") {
    // Wrong, and worth naming why. Every branch from here only runs once the
    // sketch has already missed by more than `mean <= TOL` allows.
    v = "wrong";
    pred = "off-target";
    const seg = segments[0] ?? [];
    if (seg.length >= 2) {
      const mid = seg[Math.floor(seg.length / 2)];
      const ends = (seg[0].y + seg[seg.length - 1].y) / 2;
      const opensUp = mid.y < ends;
      if (opensUp !== coefs[0] > 0) pred = "opens-wrong-way";
    }
  } else if (fn === "linear") {
    v = "wrong";
    pred = "off-target";
    const seg = segments[0] ?? [];
    if (seg.length >= 2) {
      const rise = seg[seg.length - 1].y - seg[0].y;
      const run = seg[seg.length - 1].x - seg[0].x;
      if (run !== 0 && rise / run > 0 !== coefs[0] > 0) pred = "slope-sign-flipped";
    }
  } else if (fn === "hyperbola") {
    v = "wrong";
    pred = "off-target";
    const [a, q] = coefs;
    const right = crossingsAt(segments, hi / 2);
    const left = crossingsAt(segments, lo / 2);
    const rightSideOk = right.length === 0 || Math.sign(right[0] - q) === Math.sign(a);
    const leftSideOk = left.length === 0 || Math.sign(left[0] - q) === -Math.sign(a);
    if ((right.length || left.length) && !rightSideOk && !leftSideOk) pred = "wrong-quadrants";
  } else if (fn === "exponential") {
    v = "wrong";
    pred = "off-target";
    const [a, , q] = coefs;
    const drawn0 = crossingsAt(segments, 0);
    if (drawn0.length) {
      const y0 = drawn0.reduce((s, val) => s + val, 0) / drawn0.length;
      if (Math.abs(y0 - (a + q)) > TOL) pred = "wrong-intercept";
    }
  } else {
    // sine, cosine, tangent — decide which single-cause rewrite of the
    // target best explains the drawn stroke, in the order the contract
    // names them.
    v = "wrong";
    pred = "off-target";
    const [a, q] = coefs;
    const domain = CURVE_PLANE[fn].x;
    const shiftHypothesis = (x: number) => evalCurve(fn, [a, q + bias], x);
    const shiftResid = meanErrorAgainst(shiftHypothesis, segments, domain);
    const flippedHypothesis = (x: number) => evalCurve(fn, [-a, q], x);
    const flippedResid = meanErrorAgainst(flippedHypothesis, segments, domain);
    const altPeriodK = fn === "tangent" ? 0.5 : 2;
    const periodHypothesis = (x: number) => evalCurve(fn, [a, q], x * altPeriodK);
    const periodResid = meanErrorAgainst(periodHypothesis, segments, domain);
    if (shiftResid !== null && shiftResid <= TOL) pred = "vertical-shift-wrong";
    else if (flippedResid !== null && flippedResid <= TOL) pred = "amplitude-wrong";
    else if (periodResid !== null && periodResid <= TOL) pred = "period-wrong";
  }

  return { mean, worst, bias, cover, vltFails, samples: SAMPLES, ok: v === "correct", verdict: v, predicate: pred };
}
