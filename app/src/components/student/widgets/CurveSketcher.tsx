"use client";

/**
 * {{widget:curve_sketcher:{"prompt":"Sketch y = x² - 4","fn":"quadratic","coefs":[1,0,-4]}}}
 * {{widget:curve_sketcher:{"prompt":"Sketch y = -2x + 1","fn":"linear","coefs":[-2,1]}}}
 * {{widget:curve_sketcher:{"prompt":"Sketch y = 2/x - 1","fn":"hyperbola","coefs":[2,-1]}}}
 * {{widget:curve_sketcher:{"prompt":"Sketch y = 2·3^x - 1","fn":"exponential","coefs":[2,3,-1]}}}
 * {{widget:curve_sketcher:{"prompt":"Sketch y = 2sin(θ) + 1","fn":"sine","coefs":[2,1]}}}
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
 *
 * FIVE FAMILIES ADDED BESIDE THE ORIGINAL TWO (feature 003, the Grade 10
 * American course): hyperbola, exponential, sine, cosine, tangent. All the
 * grading arithmetic — including linear and quadratic's, moved rather than
 * changed — lives in the pure, React-free `curve-sketcher-grade.ts` module,
 * so it is testable without a browser (FR-1208) and so a replay of every live
 * curve_sketcher spec can prove the two original families are byte-identical
 * to what shipped in v0.9.3. Hyperbola and tangent are the two families with
 * more than one visible branch — a hyperbola's two halves, a tangent's three
 * across one period — and NEITHER can be drawn as a single unbroken gesture,
 * so this is also the first widget to use `useStroke`'s `multiSegment` mode:
 * lift the pointer, press again elsewhere, and the new segment joins the
 * first instead of erasing it.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { makePlane, PlaneFrame } from "../../viz/plane";
import { BUTTON_SECONDARY, BUTTON_TERTIARY } from "@/components/sticker";
import { WidgetShell, type Verdict, WIDGET_ACTIONS, WIDGET_WELL } from "./WidgetShell";
import { tidy, useStroke, type Pt } from "./drag";
import { OK, type WidgetOutcome } from "@/lib/widget-predicates";
import {
  CURVE_PLANE,
  describeCurve,
  gradeCurve,
  splitSegments,
  tolFor,
  type CurveFn,
} from "./curve-sketcher-grade";

export type { CurveFn };

/** Families whose visible domain has more than one disconnected branch — the
 *  ones that need `multiSegment` because a correct answer cannot be one
 *  unbroken gesture. */
const MULTI_BRANCH: ReadonlySet<CurveFn> = new Set(["hyperbola", "tangent"]);

export function CurveSketcher({
  prompt,
  fn,
  coefs,
  studentName,
  onResult,
}: {
  prompt: string;
  fn: CurveFn;
  coefs: number[];
  /** The signed-in student's display name, narrated into the [live event]
   *  line below in place of the retired "Omar" demo persona (FR-2602,
   *  ADR-0010 plan A10). Falls back to a name-free "the student" — never a
   *  guess — when a caller (dev fixture, admin replay) has none to give. */
  studentName?: string;
  onResult: (outcome: WidgetOutcome) => void;
}) {
  const who = studentName?.trim() || "the student";
  const multiSegment = MULTI_BRANCH.has(fn);
  const plane = CURVE_PLANE[fn];
  const W = 290;
  const H = 290;
  const p = useMemo(() => makePlane(plane.x, plane.y, W, H, 18), [plane.x, plane.y]);
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
    multiSegment,
  });

  const [lo, hi] = plane.x;
  const [yLo, yHi] = plane.y;

  const score = useCallback(() => {
    if (fired.current || stroke.length < 4) return;
    const g = gradeCurve(fn, coefs, stroke);
    fired.current = true;
    const want = describeCurve(fn, coefs);
    const { TOL } = tolFor(fn);

    let msg: string;
    let streamNote: string;

    if (g.predicate === "fails-vertical-line-test") {
      msg = `Your stroke doubles back — at some x values it gives two different y values, so it is not the graph of a function at all. Draw left to right without going back.`;
      streamNote = `✗ ${who}'s sketch failed the vertical line test (${g.vltFails} sample columns carried two y values) — worth revisiting what makes a relation a function`;
    } else if (g.predicate === "asymptote-crossed") {
      msg = `Your stroke runs straight through where this curve is undefined. That gap is the asymptote — the curve gets close to it but never crosses it. Lift your finger and draw the other side as its own stroke.`;
      streamNote = `✗ ${who}'s sketch ran through ${fn}'s asymptote as one continuous stroke, which no correct answer can do — worth revisiting what an asymptote means`;
    } else if (g.predicate === "partial-coverage") {
      msg = `That covers only about ${Math.round(g.cover * 100)}% of the visible curve — carry the sketch across the whole grid.`;
      streamNote = `~ ${who} sketched only ${Math.round(g.cover * 100)}% of the domain; the shape so far is ${tidy(g.mean, 2)} away from ${want}`;
    } else if (g.predicate === "ok") {
      msg = `That is ${want}. Average distance from the true curve: ${tidy(g.mean, 2)}.`;
      streamNote = `✓ ${who} sketched ${want} freehand — mean error ${tidy(g.mean, 2)}, worst ${tidy(g.worst, 2)}, within the ${TOL} tolerance`;
    } else if (g.verdict === "partial") {
      const where =
        g.predicate === "vertically-displaced"
          ? ` The whole sketch sits about ${tidy(Math.abs(g.bias), 1)} ${g.bias > 0 ? "high" : "low"}.`
          : " Most of it is right; one part drifts off.";
      msg = `The shape is right — ${want}.${where}`;
      streamNote = `~ ${who} sketched the right shape (${want}) but drifted: mean ${tidy(g.mean, 2)}, worst ${tidy(g.worst, 2)}${g.predicate === "vertically-displaced" ? `, biased ${g.bias > 0 ? "high" : "low"} by ${tidy(Math.abs(g.bias), 2)}` : ""}`;
    } else {
      // wrong, and worth naming why where a name exists.
      let why = "";
      if (g.predicate === "opens-wrong-way") {
        why = ` Your parabola opens the wrong way — check the sign of a.`;
      } else if (g.predicate === "slope-sign-flipped") {
        why = ` Your line leans the wrong way — check the sign of the slope.`;
      } else if (g.predicate === "wrong-quadrants") {
        why = ` Your branches sit in the wrong pair of quadrants — check the sign of a.`;
      } else if (g.predicate === "wrong-intercept") {
        why = ` Check where the curve crosses the y-axis: it should pass through (0, ${tidy(coefs[0] + coefs[2], 2)}).`;
      } else if (g.predicate === "amplitude-wrong") {
        why = ` The curve reaches the right distance from the midline in the wrong direction — check the sign of a.`;
      } else if (g.predicate === "period-wrong") {
        why = ` The curve repeats at the wrong rate for this function.`;
      } else if (g.predicate === "vertical-shift-wrong") {
        why = ` The whole curve is centred on the wrong midline — check the vertical shift.`;
      }
      msg = `Not yet — the target is ${want}.${why}`;
      streamNote = `✗ ${who}'s freehand sketch was ${tidy(g.mean, 2)} off on average (worst ${tidy(g.worst, 2)}) against ${want}.${why}`;
    }

    setVerdict(g.verdict);
    setNote(msg);
    onResult({
      correct: g.ok,
      predicate: g.ok ? OK : g.predicate,
      given: `freehand sketch, mean error ${tidy(g.mean, 2)}`,
      detail: streamNote,
    });
  }, [stroke, fn, coefs, onResult, who]);

  const path = (pts: Pt[]) =>
    pts.length < 2
      ? ""
      : pts
          .map((q, i) => `${i ? "L" : "M"} ${tidy(p.sx(q.x), 2)} ${tidy(p.sy(q.y), 2)}`)
          .join(" ");

  /** The stroke as one or more subpaths — a `multiSegment` widget's break
   *  markers become gaps in the drawing, never a chord across them. */
  const strokeSegments = useMemo(() => splitSegments(stroke), [stroke]);

  const visibleTruth = useMemo(() => {
    // Break the true curve wherever it leaves the frame (or is undefined —
    // an asymptote makes the value huge, which leaves the frame the same
    // way), so the reveal does not draw a false chord across the gap.
    const runs: Pt[][] = [];
    let cur: Pt[] = [];
    const evalAt = (x: number) => {
      // Local, tiny re-evaluation kept in step with `evalCurve` — importing
      // it here would duplicate nothing the module doesn't already export,
      // but `gradeCurve`'s own sampling is the one that matters for the
      // verdict, so this stays purely a drawing convenience.
      switch (fn) {
        case "linear":
          return coefs[0] * x + coefs[1];
        case "quadratic":
          return coefs[0] * x * x + coefs[1] * x + coefs[2];
        case "hyperbola":
          return coefs[0] / x + coefs[1];
        case "exponential":
          return coefs[0] * Math.pow(coefs[1], x) + coefs[2];
        case "sine":
          return coefs[0] * Math.sin((x * Math.PI) / 180) + coefs[1];
        case "cosine":
          return coefs[0] * Math.cos((x * Math.PI) / 180) + coefs[1];
        case "tangent":
          return coefs[0] * Math.tan((x * Math.PI) / 180) + coefs[1];
      }
    };
    for (let i = 0; i < 481; i++) {
      const x = lo + (i / 480) * (hi - lo);
      const y = evalAt(x);
      if (Number.isFinite(y) && y >= yLo && y <= yHi) cur.push({ x, y });
      else if (cur.length) {
        runs.push(cur);
        cur = [];
      }
    }
    if (cur.length) runs.push(cur);
    return runs;
  }, [fn, coefs, lo, hi, yLo, yHi]);

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
          <span className="text-ink">
            {multiSegment
              ? "sketch captured — lift and draw another branch, check it, or clear and redraw"
              : "sketch captured — check it, or clear and redraw"}
          </span>
        ) : (
          <span className="text-ink-faint">
            {multiSegment
              ? "press and drag each branch left to right; lift between branches"
              : "press and drag across the grid, left to right"}
          </span>
        )
      }
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="application"
        aria-label={prompt}
        className={`mx-auto block w-full max-w-[310px] ${WIDGET_WELL} ${
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

        {strokeSegments.map((seg, i) =>
          seg.length > 1 ? (
            <path
              key={i}
              d={path(seg)}
              fill="none"
              stroke={verdict === "correct" ? "var(--accent)" : "var(--gold)"}
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={drawing ? 0.85 : 1}
            />
          ) : null
        )}
      </svg>

      {!verdict && (
        <div className={WIDGET_ACTIONS}>
          {done && (
            <button
              type="button"
              onClick={() => {
                reset();
                setDone(false);
              }}
              className={BUTTON_TERTIARY}
            >
              clear
            </button>
          )}
          <button
            type="button"
            onClick={score}
            disabled={!done}
            className={BUTTON_SECONDARY}
          >
            Check my sketch
          </button>
        </div>
      )}
    </WidgetShell>
  );
}
