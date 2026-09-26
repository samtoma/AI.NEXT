/**
 * @covers FR-1207, FR-1208
 *
 * THE BYTE-IDENTICAL PROOF for curve_sketcher's linear/quadratic path.
 *
 * `curve-sketcher-grade.ts` is an extraction, not a rewrite, of the scoring
 * that used to live inline in `CurveSketcher.tsx` (shipped through v0.9.3,
 * live for Prep-3 today). This file re-implements that PRE-REFACTOR
 * arithmetic verbatim, frozen, and replays every live curve_sketcher spec in
 * `services/extraction/seed/generated/widget-questions.json` — plus a set of
 * synthetic strokes built to hit every branch — through BOTH the frozen copy
 * and the current module, asserting identical verdicts, predicates and
 * numeric readouts. If the two ever disagree on a linear/quadratic input,
 * this fails; the five new families have no old copy to disagree with and
 * are exercised in `widget-curve-sketcher-grade.test.mts` instead.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gradeCurve, type Pt } from "../components/student/widgets/curve-sketcher-grade.ts";

/* ---------------------------------------------- the frozen pre-refactor copy */

const LIM = 5;
const SAMPLES = 41;
const TOL = 0.9;
const VLT = 0.7;
const MIN_COVER = 0.7;

type OldFn = "linear" | "quadratic";

const oldEval = (fn: OldFn, k: number[], x: number) =>
  fn === "linear" ? k[0] * x + k[1] : k[0] * x * x + k[1] * x + k[2];

function oldCrossings(stroke: Pt[], x: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < stroke.length; i++) {
    const p = stroke[i - 1];
    const q = stroke[i];
    if (p.x === q.x) continue;
    if ((p.x - x) * (q.x - x) > 0) continue;
    const t = (x - p.x) / (q.x - p.x);
    if (t >= 0 && t <= 1) out.push(p.y + t * (q.y - p.y));
  }
  return out;
}

/** The v0.9.3 `score()` body, unchanged, returning what this test needs
 *  instead of calling `setVerdict`/`onResult`. */
function oldScore(fn: OldFn, coefs: number[], stroke: Pt[]) {
  let covered = 0;
  let vltFails = 0;
  let sum = 0;
  let worst = 0;
  let signedSum = 0;

  for (let i = 0; i < SAMPLES; i++) {
    const x = -LIM + (i / (SAMPLES - 1)) * 2 * LIM;
    const truthY = oldEval(fn, coefs, x);
    if (truthY < -LIM || truthY > LIM) continue;
    const ys = oldCrossings(stroke, x);
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
    const x = -LIM + (i / (SAMPLES - 1)) * 2 * LIM;
    const ty = oldEval(fn, coefs, x);
    if (ty >= -LIM && ty <= LIM) inFrame++;
  }
  const cover = inFrame ? covered / inFrame : 0;
  const mean = covered ? sum / covered : Infinity;
  const bias = covered ? signedSum / covered : 0;

  let v: "correct" | "partial" | "wrong";
  let pred = "ok";

  if (vltFails > SAMPLES * 0.06) {
    v = "wrong";
    pred = "fails-vertical-line-test";
  } else if (cover < MIN_COVER) {
    v = "partial";
    pred = "partial-coverage";
  } else if (worst <= TOL) {
    v = "correct";
  } else if (mean <= TOL) {
    v = "partial";
    pred = Math.abs(bias) > TOL * 0.6 ? "vertically-displaced" : "off-target";
  } else if (fn === "quadratic") {
    v = "wrong";
    pred = "off-target";
    if (stroke.length >= 2) {
      const mid = stroke[Math.floor(stroke.length / 2)];
      const ends = (stroke[0].y + stroke[stroke.length - 1].y) / 2;
      const opensUp = mid.y < ends;
      if (opensUp !== coefs[0] > 0) pred = "opens-wrong-way";
    }
  } else {
    v = "wrong";
    pred = "off-target";
    if (stroke.length >= 2) {
      const rise = stroke[stroke.length - 1].y - stroke[0].y;
      const run = stroke[stroke.length - 1].x - stroke[0].x;
      if (run !== 0 && rise / run > 0 !== coefs[0] > 0) pred = "slope-sign-flipped";
    }
  }

  return { verdict: v, predicate: pred, mean, worst, cover, bias, vltFails };
}

function replay(fn: OldFn, coefs: number[], stroke: Pt[]) {
  const oldG = oldScore(fn, coefs, stroke);
  const newG = gradeCurve(fn, coefs, stroke);
  assert.equal(newG.verdict, oldG.verdict, `verdict drifted for ${fn} ${JSON.stringify(coefs)}`);
  assert.equal(newG.predicate, oldG.predicate, `predicate drifted for ${fn} ${JSON.stringify(coefs)}`);
  assert.ok(
    Number.isNaN(newG.mean) === Number.isNaN(oldG.mean) || Math.abs(newG.mean - oldG.mean) < 1e-9,
    `mean drifted for ${fn} ${JSON.stringify(coefs)}: ${newG.mean} vs ${oldG.mean}`
  );
  assert.ok(
    Math.abs(newG.worst - oldG.worst) < 1e-9,
    `worst drifted for ${fn} ${JSON.stringify(coefs)}: ${newG.worst} vs ${oldG.worst}`
  );
  assert.ok(
    Math.abs(newG.cover - oldG.cover) < 1e-9,
    `cover drifted for ${fn} ${JSON.stringify(coefs)}: ${newG.cover} vs ${oldG.cover}`
  );
  assert.equal(newG.vltFails, oldG.vltFails, `vltFails drifted for ${fn} ${JSON.stringify(coefs)}`);
}

/* -------------------------------------------------------- synthetic strokes */

function line(coefs: number[], n = 50): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const x = -LIM + (i / (n - 1)) * 2 * LIM;
    pts.push({ x, y: oldEval("linear", coefs, x) });
  }
  return pts;
}
function parabola(coefs: number[], n = 50): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const x = -LIM + (i / (n - 1)) * 2 * LIM;
    const y = oldEval("quadratic", coefs, x);
    if (y >= -LIM && y <= LIM) pts.push({ x, y });
  }
  return pts;
}

test("replay: a family of correct, partial and wrong linear strokes agree", () => {
  const targets = [[2, -1], [-1, 0], [0.5, 3], [-3, -2]];
  for (const coefs of targets) {
    replay("linear", coefs, line(coefs)); // correct
    replay("linear", coefs, line([-coefs[0], coefs[1]])); // slope flipped
    replay("linear", coefs, line(coefs).slice(0, 10)); // partial coverage
    replay("linear", coefs, line(coefs).map((p) => ({ x: p.x, y: p.y + 3 }))); // wrong, off-target
  }
});

test("replay: a family of correct, partial and wrong quadratic strokes agree", () => {
  const targets = [[1, 0, -4], [-1, 0, 3], [1, -2, -3], [2, 1, -1]];
  for (const coefs of targets) {
    replay("quadratic", coefs, parabola(coefs)); // correct
    replay("quadratic", coefs, parabola([-coefs[0], coefs[1], coefs[2]])); // opens wrong way
    replay("quadratic", coefs, parabola(coefs).slice(0, 8)); // partial coverage
  }
});

test("replay: a doubled-back stroke fails the vertical line test identically", () => {
  const stroke: Pt[] = [
    { x: -4, y: -4 }, { x: -2, y: 2 }, { x: 0, y: -4 }, { x: 2, y: 2 }, { x: 4, y: -4 },
    { x: 2, y: 3 }, { x: 0, y: -3 }, { x: -2, y: 3 }, { x: -4, y: -3 },
  ];
  replay("linear", [1, 0], stroke);
  replay("quadratic", [1, 0, -4], stroke);
});

/* ------------------------------------------- every LIVE curve_sketcher spec */

test("replay: every live curve_sketcher spec in the generated widget bank agrees", () => {
  const path = fileURLToPath(
    new URL("../../../services/extraction/seed/generated/widget-questions.json", import.meta.url)
  );
  const bundle = JSON.parse(readFileSync(path, "utf8")) as {
    questions: { id: string; choices: { kind: string; spec: Record<string, unknown> } }[];
  };
  const specs = bundle.questions.filter((q) => q.choices.kind === "curve_sketcher");
  assert.ok(specs.length > 0, "no live curve_sketcher specs found — is the seed path still correct?");

  for (const q of specs) {
    const fn = q.choices.spec.fn as OldFn;
    const coefs = q.choices.spec.coefs as number[];
    // A perfect sketch of the spec's own curve, and the "wrong" sketch its
    // own stored diagnostics name (sign of the leading coefficient flipped).
    const good = fn === "linear" ? line(coefs) : parabola(coefs);
    const flipped =
      fn === "linear"
        ? line([-coefs[0], coefs[1]])
        : parabola([-coefs[0], coefs[1], coefs[2]]);
    replay(fn, coefs, good);
    replay(fn, coefs, flipped);
  }
});
