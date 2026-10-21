"use client";

/**
 * {{widget:line_drawer:{"prompt":"Draw the line y = 2x - 1","mode":"equation","m":2,"b":-1}}}
 * {{widget:line_drawer:{"prompt":"Draw the line through (-2,1) and (3,4)","mode":"points","through":[[-2,1],[3,4]]}}}
 *
 * Two lattice handles the student DRAGS; the line through them is drawn to the
 * edges of the plane and its equation updates live underneath.
 *
 * Two modes because a line is asked for in two different ways in this book,
 * and they are not the same task. "Through these points" is a plotting
 * exercise and the handles ARE the answer. "Draw y = 2x − 1" is a modelling
 * exercise where any two points on the line are right — so it is graded on the
 * LINE, not on the handles, and a student who picks (0,−1) and (1,1) is as
 * correct as one who picks (−2,−5) and (3,5). Grading the handles in that mode
 * would mark the better answer wrong.
 *
 * The wrong answers are diagnosed rather than merely counted: an inverted
 * slope is run-over-rise, a negated slope is a sign slip, and a right slope
 * with a wrong intercept is a line drawn parallel to the truth. Each is a
 * different lesson and the note carries which one so the tutor can teach it.
 *
 * {{widget:line_drawer:{"prompt":"Find the solution set graphically","mode":"system","lines":[{"m":2,"b":-3},{"m":-0.5,"b":2}]}}}
 *
 * Two additions (Tamer 2026-10-21), both absent by default. `grid` (grid.ts)
 * sets the range and the step, so y = 2½ or a line reaching 8 can be drawn.
 * The SYSTEM mode puts two lines on one board — four handles, two colours —
 * for "find the solution set graphically": each line is diagnosed exactly as
 * in equation mode (line-drawer-grade.ts), in either order, and once both are
 * right the board reads off where they meet, or that they never do.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { makePlane, PlaneFrame } from "../../viz/plane";
import { BUTTON_SECONDARY } from "@/components/sticker";
import { Handle, WidgetShell, type Verdict, WIDGET_ACTIONS, WIDGET_WELL } from "./WidgetShell";
import { tidy, useDragSurface, useKeyNudge, type Pt } from "./drag";
import { lineText, numText } from "./format";
import { OK, type WidgetOutcome } from "@/lib/widget-predicates";
import { gradeLineEquation, gradeLinePoints, gradeSystem, meeting, type TargetLine } from "./line-drawer-grade";
import { DEFAULT_GRID, isDefaultGrid, snapToGrid, type Grid } from "./grid";

const W = 280;
const H = 280;

type Mode = "equation" | "points" | "system";

/** Where the infinite line through a and b leaves the visible rectangle. */
function clipToPlane(a: Pt, b: Pt, g: Grid): [Pt, Pt] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return null;
  // Parameterise a + t·d and keep the t-window where both coords stay inside.
  let tMin = -Infinity;
  let tMax = Infinity;
  const slab = (p: number, d: number, lo: number, hi: number) => {
    if (d === 0) return p >= lo && p <= hi;
    const t0 = (lo - p) / d;
    const t1 = (hi - p) / d;
    tMin = Math.max(tMin, Math.min(t0, t1));
    tMax = Math.min(tMax, Math.max(t0, t1));
    return true;
  };
  if (!slab(a.x, dx, g.x[0], g.x[1]) || !slab(a.y, dy, g.y[0], g.y[1])) return null;
  if (tMin > tMax) return null;
  return [
    { x: a.x + tMin * dx, y: a.y + tMin * dy },
    { x: a.x + tMax * dx, y: a.y + tMax * dy },
  ];
}

function equationOf(a: Pt, b: Pt): { m: number | null; b: number | null; text: string } {
  if (a.x === b.x) return { m: null, b: null, text: lineText(null, 0, a.x) };
  const m = tidy((b.y - a.y) / (b.x - a.x));
  const c = tidy(a.y - m * a.x);
  return { m, b: c, text: lineText(m, c) };
}

/** Slopes here are ratios of whole lattice steps, so they are ALWAYS exact
 *  fractions — never a rounded decimal in a readout a student is reading the
 *  gradient off. */
const fmt = (v: number) => numText(v);
const ptText = (q: Pt) => `(${fmt(q.x)},${fmt(q.y)})`;

/** Each line's colour on a two-line board; a one-line board keeps gold. */
const INK = ["var(--gold)", "var(--accent-deep)"];

/** Where the handles open: never on the answer and not symmetric (a widget
 *  that starts solved teaches nothing). The default grid keeps the original
 *  (-3,-2) and (1,1), which the pipeline's opening-collision rule knows. */
function opening(g: Grid, mode: Mode): Pt[] {
  const at = (fx: number, fy: number): Pt => {
    const [x, y] = snapToGrid(g, g.x[0] + fx * (g.x[1] - g.x[0]), g.y[0] + fy * (g.y[1] - g.y[0]));
    return { x, y };
  };
  const first = isDefaultGrid(g) ? [{ x: -3, y: -2 }, { x: 1, y: 1 }] : [at(0.2, 0.3), at(0.6, 0.6)];
  return mode === "system" ? [...first, at(0.25, 0.8), at(0.75, 0.4)] : first;
}

const wantText = (t: TargetLine) => equationOf({ x: 0, y: t.b }, { x: 1, y: t.m + t.b }).text;

const DIAGNOSIS: Record<string, (got: { m: number | null; b: number | null }, t: TargetLine) => string> = {
  "vertical-line": () => " — that is a vertical line, which has no slope and cannot be written y = mx + c",
  "intercept-wrong": (got, t) => ` — the slope is right, but the line sits at c = ${fmt(got.b ?? 0)} instead of ${fmt(t.b)}; it is parallel to the one asked for`,
  "slope-sign-flipped": (got, t) => ` — the slope has the right size and the wrong SIGN (${fmt(got.m ?? 0)} instead of ${fmt(t.m)}); the line leans the other way`,
  "slope-inverted": (got, t) => ` — the slope is upside down: run over rise (${fmt(got.m ?? 0)}) instead of rise over run (${fmt(t.m)})`,
};

export function LineDrawer({
  prompt,
  mode,
  m: targetM,
  b: targetB,
  through,
  lines,
  grid: g = DEFAULT_GRID,
  studentName,
  onResult,
}: {
  prompt: string;
  mode: Mode;
  m?: number;
  b?: number;
  through?: [[number, number], [number, number]];
  /** system mode: the two lines whose crossing is the solution set */
  lines?: [TargetLine, TargetLine];
  grid?: Grid;
  /** The signed-in student's display name, narrated into the [live event]
   *  line below in place of the retired "Omar" demo persona (FR-2602,
   *  ADR-0010 plan A10). Falls back to a name-free "the student" — never a
   *  guess — when a caller (dev fixture, admin replay) has none to give. */
  studentName?: string;
  onResult: (outcome: WidgetOutcome) => void;
}) {
  const who = studentName?.trim() || "the student";
  const p = useMemo(() => makePlane(g.x, g.y, W, H, 20), [g.x, g.y]);
  const svgRef = useRef<SVGSVGElement>(null);
  const [pts, setPts] = useState<Pt[]>(() => opening(g, mode));
  const [active, setActive] = useState(0);
  /** The handle the keyboard moves, read at the key press: `active` from the
   *  render would still name the previously focused handle on the first press
   *  after switching, and move the wrong one. */
  const activeRef = useRef(0);
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [note, setNote] = useState<string | null>(null);
  const fired = useRef(false);
  /** Which handle this drag grabbed; null between drags. */
  const held = useRef<number | null>(null);
  /** Whether each handle has been moved at all — an untouched handle is never
   *  evidence of a swap (line-drawer-grade.ts). */
  const moved = useRef<boolean[]>(pts.map(() => false));
  const partner = (i: number) => (i % 2 === 0 ? i + 1 : i - 1);

  const snap = useCallback((v: Pt): Pt => {
    const [x, y] = snapToGrid(g, v.x, v.y);
    return { x, y };
  }, [g]);

  /** Move handle i to v — refused when it would sit on its own line's other
   *  handle: two handles on one point is not a line, and the move is refused
   *  rather than silently collapsing the figure into a dot. */
  const place = useCallback((i: number, v: Pt) => {
    setPts((cur) => {
      const other = cur[partner(i)];
      if (v.x === other.x && v.y === other.y) return cur;
      const next = [...cur];
      next[i] = v;
      if (v.x !== cur[i].x || v.y !== cur[i].y) moved.current[i] = true;
      return next;
    });
  }, []);

  const { dragging, surface } = useDragSurface({
    svgRef,
    toValue: (q) => ({ x: p.ix(q.x), y: p.iy(q.y) }),
    snap,
    onMove: (v) => {
      if (verdict) return;
      // Which handle is being moved is decided ONCE, on the press, by
      // proximity; the rest of the drag stays with it. Re-deciding every move
      // would let a fast drag past the midpoint hand the pointer to the other
      // handle mid-gesture.
      let i = held.current;
      if (i === null) {
        let best = Infinity;
        pts.forEach((q, k) => {
          const d = Math.hypot((v.x - q.x) / g.sx, (v.y - q.y) / g.sy);
          if (d < best) { best = d; i = k; }
        });
        held.current = i;
        activeRef.current = i!;
        setActive(i!);
      }
      place(i!, v);
    },
    onCommit: () => {
      held.current = null;
    },
  });

  const eqs = [equationOf(pts[0], pts[1]), ...(mode === "system" ? [equationOf(pts[2], pts[3])] : [])];
  const eq = eqs[0];

  const check = useCallback(() => {
    if (fired.current) return;
    let ok = false;
    let diagnosis = "";
    let pred = "off-target";
    let drew = eq.text;
    let want = "";

    if (mode === "points" && through) {
      // Both handles must have been moved AND both be swapped before the
      // diagnosis fires (line-drawer-grade.ts; consistency review A10).
      const g = gradeLinePoints(pts, through, [moved.current[0], moved.current[1]]);
      ok = g.ok;
      if (!ok) {
        pred = g.predicate;
        diagnosis =
          g.predicate === "points-swapped"
            ? " — the coordinates are the right numbers in the wrong order (x first, then y)"
            : "";
      }
      drew = `${ptText(pts[0])} and ${ptText(pts[1])}`;
      want = `${ptText({ x: through[0][0], y: through[0][1] })} and ${ptText({ x: through[1][0], y: through[1][1] })}`;
    } else if (mode === "system" && lines) {
      const gr = gradeSystem([eqs[0], eqs[1]], lines);
      ok = gr.ok;
      drew = `${eqs[0].text} and ${eqs[1].text}`;
      want = `${wantText(lines[0])} and ${wantText(lines[1])}`;
      if (!ok) {
        pred = gr.predicate;
        const k = gr.each[0] !== OK ? 0 : 1;
        const why = DIAGNOSIS[gr.predicate]?.(eqs[k], lines[gr.pairing[k]]) ?? "";
        diagnosis = ` — ${k === 0 ? "the first" : "the second"} line${why || " matches neither line asked for"}`;
      }
    } else {
      // Graded on the LINE, so any two points on it are accepted.
      const t = { m: targetM ?? 0, b: targetB ?? 0 };
      pred = gradeLineEquation(eq.m, eq.b, t.m, t.b);
      ok = pred === OK;
      diagnosis = ok ? "" : DIAGNOSIS[pred]?.(eq, t) ?? "";
      want = wantText(t);
    }

    fired.current = true;
    setVerdict(ok ? "correct" : "wrong");
    let meets = "";
    if (ok && mode === "system" && lines) {
      const at = meeting(lines[0], lines[1]);
      meets = at === "parallel" ? " They are parallel: no point lies on both, so the solution set is ∅."
        : at === "same" ? " They are the same line: every point on it is a solution."
        : ` They meet at ${ptText({ x: at[0], y: at[1] })}: the solution set is {${ptText({ x: at[0], y: at[1] })}}.`;
    }
    setNote(ok ? `That is ${drew}.${meets}` : `You drew ${drew}; the target is ${want}.`);
    onResult({
      correct: ok,
      predicate: ok ? OK : pred,
      given: drew,
      detail: ok
        ? `✓ ${who} drew ${drew} correctly on the line drawer (target ${want})${meets}`
        : `✗ ${who} drew ${drew} on the line drawer instead of ${want}${diagnosis}`,
    });
  }, [mode, through, lines, pts, eq, eqs, targetM, targetB, onResult, who]);

  const nudge = useKeyNudge({
    step: 1,
    disabled: !!verdict,
    // one press is one grid step along that axis
    onNudge: (dx, dy) => {
      const i = activeRef.current;
      place(i, snap({ x: pts[i].x + dx * g.sx, y: pts[i].y + dy * g.sy }));
    },
    onCommit: check,
  });

  const targets: TargetLine[] =
    mode === "system" && lines ? lines : mode === "equation" && targetM !== undefined ? [{ m: targetM, b: targetB ?? 0 }] : [];

  return (
    <WidgetShell
      kind="line drawer"
      hint={mode === "system" ? "drag the four points" : "drag either point"}
      prompt={prompt}
      verdict={verdict}
      feedback={note}
      footer={
        verdict ? null : mode === "system" ? (
          <>
            <span style={{ color: INK[0] }}>{eqs[0].text}</span>
            <span className="ml-3" style={{ color: INK[1] }}>{eqs[1].text}</span>
          </>
        ) : (
          <>
            <span className="text-ink">{eq.text}</span>
            {eq.m !== null && (
              <span className="ml-2 text-ink-faint">
                slope {fmt(eq.m)} · through {ptText(pts[0])} and {ptText(pts[1])}
              </span>
            )}
          </>
        )
      }
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="application"
        aria-label={prompt}
        className={`mx-auto block w-full max-w-[300px] ${WIDGET_WELL} ${
          verdict ? "cursor-default" : "cursor-crosshair"
        }`}
        {...(verdict ? {} : surface)}
      >
        <PlaneFrame p={p} />

        {/* the target, shown only once the answer is in */}
        {verdict === "wrong" && targets.map((t, k) => {
          const c = clipToPlane({ x: 0, y: t.b }, { x: 1, y: t.m + t.b }, g);
          return c ? (
            <line
              key={k}
              x1={p.sx(c[0].x)} y1={p.sy(c[0].y)}
              x2={p.sx(c[1].x)} y2={p.sy(c[1].y)}
              stroke="var(--accent)" strokeWidth="1.6"
              strokeDasharray="5 3" opacity="0.55"
            />
          ) : null;
        })}
        {verdict === "wrong" && mode === "points" && through && (
          <g opacity="0.6">
            {through.map(([tx, ty]) => (
              <circle key={`${tx},${ty}`} cx={p.sx(tx)} cy={p.sy(ty)} r="6"
                      fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeDasharray="3 2" />
            ))}
          </g>
        )}

        {/* the student's line(s) */}
        {eqs.map((_, k) => {
          const seg = clipToPlane(pts[2 * k], pts[2 * k + 1], g);
          return seg ? (
            <line
              key={k}
              x1={p.sx(seg[0].x)} y1={p.sy(seg[0].y)}
              x2={p.sx(seg[1].x)} y2={p.sy(seg[1].y)}
              stroke={verdict === "correct" ? "var(--accent)" : INK[k]}
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          ) : null;
        })}

        {/* where two right lines meet: the solution set */}
        {verdict === "correct" && mode === "system" && lines && (() => {
          const at = meeting(lines[0], lines[1]);
          return Array.isArray(at) ? (
            <circle cx={p.sx(at[0])} cy={p.sy(at[1])} r="5" fill="var(--accent)" stroke="var(--card)" strokeWidth="1.5" />
          ) : null;
        })()}

        {pts.map((pt, i) => (
          <Handle
            key={i}
            cx={p.sx(pt.x)}
            cy={p.sy(pt.y)}
            color={verdict === "correct" ? "var(--accent)" : INK[mode === "system" ? Math.floor(i / 2) : 0]}
            label={mode === "system" ? `Line ${Math.floor(i / 2) + 1}, point ${(i % 2) + 1}` : `Point ${i + 1}`}
            live={`${fmt(pt.x)}, ${fmt(pt.y)}`}
            dragging={dragging && active === i}
            locked={!!verdict}
            onKeyDown={(e) => {
              activeRef.current = i;
              setActive(i);
              nudge(e);
            }}
          />
        ))}
      </svg>

      {!verdict && (
        <div className={WIDGET_ACTIONS}>
          <button type="button" onClick={check} className={BUTTON_SECONDARY}>
            {mode === "system" ? "Those are my lines" : <>That&apos;s my line</>}
          </button>
        </div>
      )}
    </WidgetShell>
  );
}
