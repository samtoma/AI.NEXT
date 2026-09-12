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
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { makePlane, PlaneFrame } from "../../viz/plane";
import { Handle, WidgetShell, type Verdict } from "./WidgetShell";
import { clamp, tidy, useDragSurface, useKeyNudge, type Pt } from "./drag";

const R = 5;
const W = 280;
const H = 280;

type Mode = "equation" | "points";

/** Where the infinite line through a and b leaves the visible rectangle. */
function clipToPlane(a: Pt, b: Pt): [Pt, Pt] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return null;
  // Parameterise a + t·d and keep the t-window where both coords stay inside.
  let tMin = -Infinity;
  let tMax = Infinity;
  const slab = (p: number, d: number) => {
    if (d === 0) return p >= -R && p <= R;
    const t0 = (-R - p) / d;
    const t1 = (R - p) / d;
    tMin = Math.max(tMin, Math.min(t0, t1));
    tMax = Math.min(tMax, Math.max(t0, t1));
    return true;
  };
  if (!slab(a.x, dx) || !slab(a.y, dy)) return null;
  if (tMin > tMax) return null;
  return [
    { x: a.x + tMin * dx, y: a.y + tMin * dy },
    { x: a.x + tMax * dx, y: a.y + tMax * dy },
  ];
}

function equationOf(a: Pt, b: Pt): { m: number | null; b: number | null; text: string } {
  if (a.x === b.x) return { m: null, b: null, text: `x = ${a.x}` };
  const m = tidy((b.y - a.y) / (b.x - a.x));
  const c = tidy(a.y - m * a.x);
  const mPart = m === 1 ? "x" : m === -1 ? "−x" : m === 0 ? "" : `${fmt(m)}x`;
  if (m === 0) return { m, b: c, text: `y = ${fmt(c)}` };
  const cPart = c === 0 ? "" : c > 0 ? ` + ${fmt(c)}` : ` − ${fmt(Math.abs(c))}`;
  return { m, b: c, text: `y = ${mPart}${cPart}` };
}

const fmt = (v: number) => {
  const r = tidy(v, 2);
  return Number.isInteger(r) ? String(r) : String(r).replace("-", "−");
};

const same = (u: number, v: number) => Math.abs(u - v) < 1e-6;

export function LineDrawer({
  prompt,
  mode,
  m: targetM,
  b: targetB,
  through,
  onResult,
}: {
  prompt: string;
  mode: Mode;
  m?: number;
  b?: number;
  through?: [[number, number], [number, number]];
  onResult: (note: string) => void;
}) {
  const p = useMemo(() => makePlane([-R, R], [-R, R], W, H, 20), []);
  const svgRef = useRef<SVGSVGElement>(null);
  // Opening position is deliberately NOT on the answer and not symmetric:
  // a widget that starts solved teaches nothing.
  const [pts, setPts] = useState<[Pt, Pt]>([
    { x: -3, y: -2 },
    { x: 1, y: 1 },
  ]);
  const [active, setActive] = useState(0);
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [note, setNote] = useState<string | null>(null);
  const fired = useRef(false);
  /** Which handle this drag grabbed; null between drags. */
  const held = useRef<number | null>(null);

  const snap = useCallback((v: Pt): Pt => {
    const x = clamp(Math.round(v.x), -R, R);
    const y = clamp(Math.round(v.y), -R, R);
    return { x, y };
  }, []);

  const moveActive = useCallback(
    (v: Pt) => {
      if (verdict) return;
      setPts((cur) => {
        const other = cur[active === 0 ? 1 : 0];
        // Two handles on one lattice point is not a line. The move is refused
        // rather than silently collapsing the figure into a dot.
        if (v.x === other.x && v.y === other.y) return cur;
        const next: [Pt, Pt] = [cur[0], cur[1]];
        next[active] = v;
        return next;
      });
    },
    [active, verdict]
  );

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
        const d0 = Math.hypot(v.x - pts[0].x, v.y - pts[0].y);
        const d1 = Math.hypot(v.x - pts[1].x, v.y - pts[1].y);
        i = d1 < d0 ? 1 : 0;
        held.current = i;
        setActive(i);
      }
      const at = i;
      setPts((cur) => {
        const other = cur[at === 0 ? 1 : 0];
        if (v.x === other.x && v.y === other.y) return cur;
        const next: [Pt, Pt] = [cur[0], cur[1]];
        next[at] = v;
        return next;
      });
    },
    onCommit: () => {
      held.current = null;
    },
  });

  const eq = equationOf(pts[0], pts[1]);
  const seg = clipToPlane(pts[0], pts[1]);

  const check = useCallback(() => {
    if (fired.current) return;
    let ok = false;
    let diagnosis = "";

    if (mode === "points" && through) {
      const [t0, t1] = through;
      const hit = (a: Pt, t: number[]) => a.x === t[0] && a.y === t[1];
      ok =
        (hit(pts[0], t0) && hit(pts[1], t1)) ||
        (hit(pts[0], t1) && hit(pts[1], t0));
      if (!ok) {
        const swapped =
          (pts[0].x === t0[1] && pts[0].y === t0[0]) ||
          (pts[1].x === t1[1] && pts[1].y === t1[0]);
        diagnosis = swapped
          ? " — the coordinates are the right numbers in the wrong order (x first, then y)"
          : "";
      }
    } else {
      // Graded on the LINE, so any two points on it are accepted.
      if (eq.m === null) {
        ok = false;
        diagnosis = " — that is a vertical line, which has no slope and cannot be written y = mx + c";
      } else {
        const tm = targetM ?? 0;
        const tb = targetB ?? 0;
        ok = same(eq.m, tm) && same(eq.b ?? 0, tb);
        if (!ok) {
          if (same(eq.m, tm)) {
            diagnosis = ` — the slope is right, but the line sits at c = ${fmt(eq.b ?? 0)} instead of ${fmt(tb)}; it is parallel to the one asked for`;
          } else if (tm !== 0 && same(eq.m, -tm)) {
            diagnosis = ` — the slope has the right size and the wrong SIGN (${fmt(eq.m)} instead of ${fmt(tm)}); the line leans the other way`;
          } else if (tm !== 0 && eq.m !== 0 && same(eq.m, 1 / tm)) {
            diagnosis = ` — the slope is upside down: run over rise (${fmt(eq.m)}) instead of rise over run (${fmt(tm)})`;
          }
        }
      }
    }

    fired.current = true;
    setVerdict(ok ? "correct" : "wrong");
    const drew =
      mode === "points"
        ? `(${pts[0].x},${pts[0].y}) and (${pts[1].x},${pts[1].y})`
        : eq.text;
    const want =
      mode === "points" && through
        ? `(${through[0][0]},${through[0][1]}) and (${through[1][0]},${through[1][1]})`
        : equationOf({ x: 0, y: targetB ?? 0 }, { x: 1, y: (targetM ?? 0) + (targetB ?? 0) }).text;
    setNote(ok ? `That is ${drew}.` : `You drew ${drew}; the target is ${want}.`);
    onResult(
      ok
        ? `✓ Omar drew ${drew} correctly on the line drawer (target ${want})`
        : `✗ Omar drew ${drew} on the line drawer instead of ${want}${diagnosis}`
    );
  }, [mode, through, pts, eq, targetM, targetB, onResult]);

  const nudge = useKeyNudge({
    step: 1,
    disabled: !!verdict,
    onNudge: (dx, dy) =>
      moveActive({
        x: clamp(pts[active].x + dx, -R, R),
        y: clamp(pts[active].y + dy, -R, R),
      }),
    onCommit: check,
  });

  return (
    <WidgetShell
      kind="line drawer"
      hint="drag either point"
      prompt={prompt}
      verdict={verdict}
      feedback={note}
      footer={
        verdict ? null : (
          <>
            <span className="text-ink">{eq.text}</span>
            {eq.m !== null && (
              <span className="ml-2 text-ink-faint">
                slope {fmt(eq.m)} · through ({pts[0].x},{pts[0].y}) and ({pts[1].x},{pts[1].y})
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
        className={`mx-auto block w-full max-w-[300px] rounded-md border border-line-soft bg-card-warm ${
          verdict ? "cursor-default" : "cursor-crosshair"
        }`}
        {...(verdict ? {} : surface)}
      >
        <PlaneFrame p={p} />

        {/* the target, shown only once the answer is in */}
        {verdict === "wrong" && mode !== "points" && targetM !== undefined && (() => {
          const t = clipToPlane(
            { x: 0, y: targetB ?? 0 },
            { x: 1, y: targetM + (targetB ?? 0) }
          );
          return t ? (
            <line
              x1={p.sx(t[0].x)} y1={p.sy(t[0].y)}
              x2={p.sx(t[1].x)} y2={p.sy(t[1].y)}
              stroke="var(--accent)" strokeWidth="1.6"
              strokeDasharray="5 3" opacity="0.55"
            />
          ) : null;
        })()}
        {verdict === "wrong" && mode === "points" && through && (
          <g opacity="0.6">
            {through.map(([tx, ty]) => (
              <circle key={`${tx},${ty}`} cx={p.sx(tx)} cy={p.sy(ty)} r="6"
                      fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeDasharray="3 2" />
            ))}
          </g>
        )}

        {/* the student's line */}
        {seg && (
          <line
            x1={p.sx(seg[0].x)} y1={p.sy(seg[0].y)}
            x2={p.sx(seg[1].x)} y2={p.sy(seg[1].y)}
            stroke={verdict === "correct" ? "var(--accent)" : "var(--gold)"}
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        )}

        {pts.map((pt, i) => (
          <Handle
            key={i}
            cx={p.sx(pt.x)}
            cy={p.sy(pt.y)}
            color={verdict === "correct" ? "var(--accent)" : "var(--gold)"}
            label={`Point ${i + 1}`}
            live={`${pt.x}, ${pt.y}`}
            dragging={dragging && active === i}
            locked={!!verdict}
            onKeyDown={(e) => {
              setActive(i);
              nudge(e);
            }}
          />
        ))}
      </svg>

      {!verdict && (
        <button
          type="button"
          onClick={check}
          className="mx-auto mt-2.5 block min-h-[40px] rounded-md border border-accent/45 bg-accent-wash px-4 font-display text-[13px] font-medium text-accent-deep transition-colors hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/45"
        >
          That&apos;s my line
        </button>
      )}
    </WidgetShell>
  );
}
