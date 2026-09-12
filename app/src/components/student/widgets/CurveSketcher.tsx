"use client";

/**
 * {{widget:curve_sketcher:{"prompt":"Sketch y = x² - 4","fn":"quadratic","coefs":[1,0,-4]}}}
 * {{widget:curve_sketcher:{"prompt":"Sketch y = -2x + 1","fn":"linear","coefs":[-2,1]}}}
 *
 * Freehand. The student draws the curve with a finger or a mouse and the
 * sketch is scored against the real one.
 *
 * WHAT IS BEING MARKED IS THE SHAPE, NOT THE PRECISION. A sketch is not a plot
 * and marking it like one would punish exactly the students this is meant to
 * help. The tolerance is roughly one grid square, and what actually gets
 * reported is the structure: which way a parabola opens, where it crosses,
 * whether a line rises or falls. A student whose parabola is the right shape
 * half a unit low has understood the function; one whose parabola opens the
 * wrong way has not, and no amount of tidiness fixes that.
 *
 * THE VERTICAL LINE TEST IS ENFORCED BY THE INSTRUMENT. If the stroke doubles
 * back so that one x carries two different y values, the sketch is rejected
 * with that reason — because it is not the wrong function, it is not a
 * function at all. That is the defining property from Unit 1 showing up as a
 * physical constraint on the student's own hand three units later, which is
 * the kind of connection a worked example cannot make.
 *
 * Partial credit is real here and says what was right: "the shape and the
 * turning point are right, the whole sketch sits about a unit high" is a
 * different lesson from "wrong".
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { makePlane, PlaneFrame } from "../../viz/plane";
import { WidgetShell, type Verdict } from "./WidgetShell";
import { tidy, useStroke, type Pt } from "./drag";

const LIM = 5;
const W = 290;
const H = 290;
const SAMPLES = 41;
/** About one grid square — a sketch, not a plot. */
const TOL = 0.9;
/** Two y values this far apart at one x means the stroke doubled back. */
const VLT = 0.7;
/** Below this share of the domain the sketch is a fragment, not an answer. */
const MIN_COVER = 0.7;

export type CurveFn = "linear" | "quadratic";

const evalFn = (fn: CurveFn, k: number[], x: number) =>
  fn === "linear" ? k[0] * x + k[1] : k[0] * x * x + k[1] * x + k[2];

/** Every y at which the stroke crosses the vertical line at x. */
function crossings(stroke: Pt[], x: number): number[] {
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

function describe(fn: CurveFn, k: number[]): string {
  if (fn === "linear")
    return `a straight line ${k[0] > 0 ? "rising" : k[0] < 0 ? "falling" : "flat"}, crossing the y-axis at ${tidy(k[1], 2)}`;
  const vx = -k[1] / (2 * k[0]);
  return `a parabola opening ${k[0] > 0 ? "upwards" : "downwards"}, turning at (${tidy(vx, 2)}, ${tidy(evalFn(fn, k, vx), 2)})`;
}

export function CurveSketcher({
  prompt,
  fn,
  coefs,
  onResult,
}: {
  prompt: string;
  fn: CurveFn;
  coefs: number[];
  onResult: (note: string) => void;
}) {
  const p = useMemo(() => makePlane([-LIM, LIM], [-LIM, LIM], W, H, 18), []);
  const svgRef = useRef<SVGSVGElement>(null);
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [note, setNote] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const fired = useRef(false);

  const { stroke, drawing, reset, surface } = useStroke({
    svgRef,
    toValue: (q) => ({ x: p.ix(q.x), y: p.iy(q.y) }),
    minGap: 2.5,
    disabled: !!verdict,
    onDone: () => setDone(true),
  });

  const truth = useMemo(() => {
    const pts: Pt[] = [];
    for (let i = 0; i < 241; i++) {
      const x = -LIM + (i / 240) * 2 * LIM;
      pts.push({ x, y: evalFn(fn, coefs, x) });
    }
    return pts;
  }, [fn, coefs]);

  const score = useCallback(() => {
    if (fired.current || stroke.length < 4) return;
    let covered = 0;
    let vltFails = 0;
    let sum = 0;
    let worst = 0;
    let signedSum = 0;

    for (let i = 0; i < SAMPLES; i++) {
      const x = -LIM + (i / (SAMPLES - 1)) * 2 * LIM;
      const truthY = evalFn(fn, coefs, x);
      // A sample the real curve leaves the frame at cannot be drawn, so it is
      // not held against the student.
      if (truthY < -LIM || truthY > LIM) continue;
      const ys = crossings(stroke, x);
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
      const ty = evalFn(fn, coefs, x);
      if (ty >= -LIM && ty <= LIM) inFrame++;
    }
    const cover = inFrame ? covered / inFrame : 0;
    const mean = covered ? sum / covered : Infinity;
    const bias = covered ? signedSum / covered : 0;

    fired.current = true;
    let v: Verdict;
    let msg: string;
    let streamNote: string;
    const want = describe(fn, coefs);

    if (vltFails > SAMPLES * 0.06) {
      v = "wrong";
      msg = `Your stroke doubles back — at some x values it gives two different y values, so it is not the graph of a function at all. Draw left to right without going back.`;
      streamNote = `✗ Omar's sketch failed the vertical line test (${vltFails} sample columns carried two y values) — worth revisiting what makes a relation a function`;
    } else if (cover < MIN_COVER) {
      v = "partial";
      msg = `That covers only about ${Math.round(cover * 100)}% of the visible curve — carry the sketch across the whole grid.`;
      streamNote = `~ Omar sketched only ${Math.round(cover * 100)}% of the domain; the shape so far is ${tidy(mean, 2)} away from ${want}`;
    } else if (worst <= TOL) {
      v = "correct";
      msg = `That is ${want}. Average distance from the true curve: ${tidy(mean, 2)}.`;
      streamNote = `✓ Omar sketched ${want} freehand — mean error ${tidy(mean, 2)}, worst ${tidy(worst, 2)}, within the ${TOL} tolerance`;
    } else if (mean <= TOL) {
      v = "partial";
      const where = Math.abs(bias) > TOL * 0.6
        ? ` The whole sketch sits about ${tidy(Math.abs(bias), 1)} ${bias > 0 ? "high" : "low"}.`
        : " Most of it is right; one part drifts off.";
      msg = `The shape is right — ${want}.${where}`;
      streamNote = `~ Omar sketched the right shape (${want}) but drifted: mean ${tidy(mean, 2)}, worst ${tidy(worst, 2)}${Math.abs(bias) > TOL * 0.6 ? `, biased ${bias > 0 ? "high" : "low"} by ${tidy(Math.abs(bias), 2)}` : ""}`;
    } else {
      v = "wrong";
      // Name the structural error rather than the distance.
      let why = "";
      if (fn === "quadratic") {
        const mid = stroke[Math.floor(stroke.length / 2)];
        const ends = (stroke[0].y + stroke[stroke.length - 1].y) / 2;
        const opensUp = mid.y < ends;
        if (opensUp !== coefs[0] > 0)
          why = ` Your parabola opens ${opensUp ? "upwards" : "downwards"}; this one opens ${coefs[0] > 0 ? "upwards" : "downwards"}, because a is ${coefs[0] > 0 ? "positive" : "negative"}.`;
      } else {
        const rise = stroke[stroke.length - 1].y - stroke[0].y;
        const run = stroke[stroke.length - 1].x - stroke[0].x;
        if (run !== 0 && rise / run > 0 !== coefs[0] > 0)
          why = ` Your line ${rise / run > 0 ? "rises" : "falls"}; with a slope of ${tidy(coefs[0], 2)} it should ${coefs[0] > 0 ? "rise" : "fall"}.`;
      }
      msg = `Not yet — the target is ${want}.${why}`;
      streamNote = `✗ Omar's freehand sketch was ${tidy(mean, 2)} off on average (worst ${tidy(worst, 2)}) against ${want}.${why}`;
    }

    setVerdict(v);
    setNote(msg);
    onResult(streamNote);
  }, [stroke, fn, coefs, onResult]);

  const path = (pts: Pt[]) =>
    pts.length < 2
      ? ""
      : pts
          .map((q, i) => `${i ? "L" : "M"} ${tidy(p.sx(q.x), 2)} ${tidy(p.sy(q.y), 2)}`)
          .join(" ");

  const visibleTruth = useMemo(() => {
    // Break the true curve wherever it leaves the frame, so the reveal does
    // not draw a false chord across the top of the grid.
    const runs: Pt[][] = [];
    let cur: Pt[] = [];
    for (const q of truth) {
      if (q.y >= -LIM && q.y <= LIM) cur.push(q);
      else if (cur.length) {
        runs.push(cur);
        cur = [];
      }
    }
    if (cur.length) runs.push(cur);
    return runs;
  }, [truth]);

  return (
    <WidgetShell
      kind="curve sketcher"
      hint="draw with your finger"
      prompt={prompt}
      verdict={verdict}
      feedback={note}
      onReset={
        verdict
          ? undefined
          : done
          ? () => {
              reset();
              setDone(false);
            }
          : undefined
      }
      resetLabel="Clear and redraw"
      footer={
        verdict ? null : done ? (
          <span className="text-ink">sketch captured — check it, or clear and redraw</span>
        ) : (
          <span className="text-ink-faint">press and drag across the grid, left to right</span>
        )
      }
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="application"
        aria-label={prompt}
        className={`mx-auto block w-full max-w-[310px] rounded-md border border-line-soft bg-card-warm ${
          verdict ? "cursor-default" : "cursor-crosshair"
        }`}
        {...(verdict ? {} : surface)}
      >
        <PlaneFrame p={p} />

        {/* the true curve, revealed only after the verdict */}
        {verdict &&
          visibleTruth.map((run, i) => (
            <path
              key={i}
              d={path(run)}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
              strokeDasharray="5 3"
              opacity="0.7"
            />
          ))}

        {stroke.length > 1 && (
          <path
            d={path(stroke)}
            fill="none"
            stroke={verdict === "correct" ? "var(--accent)" : "var(--gold)"}
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={drawing ? 0.85 : 1}
          />
        )}
      </svg>

      {!verdict && (
        <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2">
          {done && (
            <button
              type="button"
              onClick={() => {
                reset();
                setDone(false);
              }}
              className="min-h-[36px] rounded-md border border-line px-3 font-mono text-[10.5px] text-ink-soft transition-colors hover:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/45"
            >
              clear
            </button>
          )}
          <button
            type="button"
            onClick={score}
            disabled={!done}
            className="min-h-[36px] rounded-md border border-accent/45 bg-accent-wash px-3.5 font-display text-[13px] font-medium text-accent-deep transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/45"
          >
            Check my sketch
          </button>
        </div>
      )}
    </WidgetShell>
  );
}
