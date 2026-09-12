"use client";

/**
 * {{widget:circle_builder:{"prompt":"Draw a chord of circle M","element":"chord"}}}
 * element ∈ radius | chord | diameter | tangent
 *
 * A circle of radius 5 about the origin and two lattice handles the student
 * DRAGS to construct the named element.
 *
 * THE POINT OF THIS WIDGET IS THAT IT GRADES THE PROPERTY, NOT A POSITION.
 * There are twelve lattice points on this circle, so a chord has sixty-six
 * correct answers and a diameter has six, and every one of them is accepted.
 * A widget that stored one blessed pair of endpoints would be testing whether
 * the student guessed the author's chord — which is not what "chord" means,
 * and is precisely the misreading the definition work is trying to fix.
 *
 * The live panel is the teaching. Each defining property lights up as the
 * handles move — "both ends on the circle", "passes through the centre" — so
 * a student who drags a chord until it becomes a diameter SEES the second
 * property switch on, and the relationship between the two words is something
 * they watched happen rather than something they were told.
 *
 * The plane runs to ±7 rather than ±5 on purpose: it leaves room for the
 * tangents at (3,4) and (4,3), so "draw a tangent" has real answers that are
 * not all four axis-aligned ones.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { makePlane, PlaneFrame } from "../../viz/plane";
import { Handle, WidgetShell, type Verdict } from "./WidgetShell";
import { clamp, tidy, useDragSurface, useKeyNudge, type Pt } from "./drag";

const RAD = 5;
const LIM = 7;
const W = 300;
const H = 300;
/** Tangency is judged on a real distance, so it needs a real tolerance. */
const TOUCH_EPS = 0.15;

export type CircleElement = "radius" | "chord" | "diameter" | "tangent";

const WANTED: Record<CircleElement, string> = {
  radius: "a radius",
  chord: "a chord",
  diameter: "a diameter",
  tangent: "a tangent",
};

const onCircle = (p: Pt) => Math.abs(Math.hypot(p.x, p.y) - RAD) < 1e-9;
const atCentre = (p: Pt) => p.x === 0 && p.y === 0;

/** Perpendicular distance from the origin to the line through a and b. */
function distToLine(a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Infinity;
  return Math.abs(dx * a.y - dy * a.x) / len;
}

/** Does the segment a→b pass through the centre? */
const throughCentre = (a: Pt, b: Pt) =>
  Math.abs((b.x - a.x) * a.y - (b.y - a.y) * a.x) < 1e-9 &&
  Math.min(a.x, b.x) <= 0 && Math.max(a.x, b.x) >= 0 &&
  Math.min(a.y, b.y) <= 0 && Math.max(a.y, b.y) >= 0;

function clipToPlane(a: Pt, b: Pt): [Pt, Pt] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return null;
  let tMin = -Infinity;
  let tMax = Infinity;
  const slab = (p: number, d: number) => {
    if (d === 0) return p >= -LIM && p <= LIM;
    const t0 = (-LIM - p) / d;
    const t1 = (LIM - p) / d;
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

export function CircleBuilder({
  prompt,
  element,
  onResult,
}: {
  prompt: string;
  element: CircleElement;
  onResult: (note: string) => void;
}) {
  const p = useMemo(() => makePlane([-LIM, LIM], [-LIM, LIM], W, H, 18), []);
  const svgRef = useRef<SVGSVGElement>(null);
  const [pts, setPts] = useState<[Pt, Pt]>([
    { x: -2, y: -6 },
    { x: 2, y: -6 },
  ]);
  const [active, setActive] = useState(0);
  const held = useRef<number | null>(null);
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [note, setNote] = useState<string | null>(null);
  const fired = useRef(false);

  const snap = useCallback((v: Pt): Pt => {
    // Free lattice everywhere, EXCEPT: a handle dropped within half a unit of
    // the circle is pulled onto the nearest lattice point that is exactly on
    // it. Without that magnetism "put it on the circle" becomes a pixel hunt,
    // and the student's attention goes to their finger instead of the figure.
    const x = clamp(Math.round(v.x), -LIM, LIM);
    const y = clamp(Math.round(v.y), -LIM, LIM);
    const d = Math.hypot(x, y);
    if (d > 0 && Math.abs(d - RAD) < 1e-9) return { x, y };
    if (Math.abs(Math.hypot(v.x, v.y) - RAD) < 0.55) {
      const k = RAD / Math.hypot(v.x, v.y || 1e-9);
      const cand = { x: Math.round(v.x * k), y: Math.round(v.y * k) };
      if (onCircle(cand)) return cand;
    }
    return { x, y };
  }, []);

  const { dragging, surface } = useDragSurface({
    svgRef,
    toValue: (q) => ({ x: p.ix(q.x), y: p.iy(q.y) }),
    snap,
    onMove: (v) => {
      if (verdict) return;
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

  const [a, b] = pts;
  const props = useMemo(() => {
    const endsOn = onCircle(a) && onCircle(b);
    const oneCentre = (atCentre(a) && onCircle(b)) || (atCentre(b) && onCircle(a));
    const dist = distToLine(a, b);
    return {
      endsOn,
      oneCentre,
      centre: throughCentre(a, b),
      dist: tidy(dist, 2),
      tangent: Math.abs(dist - RAD) < TOUCH_EPS,
      // A line nearer the centre than the radius cuts the circle twice.
      secant: dist < RAD - TOUCH_EPS,
    };
  }, [a, b]);

  const check = useCallback(() => {
    if (fired.current) return;
    let ok = false;
    let why = "";

    if (element === "radius") {
      ok = props.oneCentre;
      if (!ok) {
        why = props.endsOn
          ? " — both ends are on the circle, so that is a chord; a radius runs from the CENTRE to the circle"
          : atCentre(a) || atCentre(b)
          ? " — one end is at the centre, but the other has not reached the circle"
          : " — neither end is at the centre; a radius must start there";
      }
    } else if (element === "chord") {
      ok = props.endsOn;
      why = ok ? "" : " — a chord joins two points that are both ON the circle";
    } else if (element === "diameter") {
      ok = props.endsOn && props.centre;
      if (!ok) {
        why = props.endsOn
          ? " — both ends are on the circle, so it is a chord, but it misses the centre; a diameter is the chord that passes THROUGH the centre"
          : " — a diameter has both ends on the circle and passes through the centre";
      }
    } else {
      ok = props.tangent;
      if (!ok) {
        why = props.secant
          ? ` — that line is ${props.dist} from the centre, less than the radius ${RAD}, so it cuts the circle at two points; that is a secant, not a tangent`
          : ` — that line is ${props.dist} from the centre, more than the radius ${RAD}, so it misses the circle completely; a tangent touches at exactly one point (distance = ${RAD})`;
      }
    }

    fired.current = true;
    setVerdict(ok ? "correct" : "wrong");
    const drew = `(${a.x},${a.y})–(${b.x},${b.y})`;
    setNote(
      ok
        ? `${drew} is ${WANTED[element]}.`
        : `${drew} is not ${WANTED[element]}${why.replace(/^ — /, " — ")}`
    );
    onResult(
      ok
        ? `✓ Omar constructed ${WANTED[element]} ${drew} on the circle builder (radius ${RAD}, centre M)`
        : `✗ Omar drew ${drew} when asked for ${WANTED[element]}${why}`
    );
  }, [element, props, a, b, onResult]);

  const nudge = useKeyNudge({
    step: 1,
    disabled: !!verdict,
    onNudge: (dx, dy) => {
      if (verdict) return;
      const at = active;
      setPts((cur) => {
        const v = { x: clamp(cur[at].x + dx, -LIM, LIM), y: clamp(cur[at].y + dy, -LIM, LIM) };
        const other = cur[at === 0 ? 1 : 0];
        if (v.x === other.x && v.y === other.y) return cur;
        const next: [Pt, Pt] = [cur[0], cur[1]];
        next[at] = v;
        return next;
      });
    },
    onCommit: check,
  });

  const seg = element === "tangent" ? clipToPlane(a, b) : null;
  const lattice = useMemo(() => {
    const out: Pt[] = [];
    for (let x = -RAD; x <= RAD; x++)
      for (let y = -RAD; y <= RAD; y++) if (onCircle({ x, y })) out.push({ x, y });
    return out;
  }, []);

  const Prop = ({ on, children }: { on: boolean; children: ReactNode }) => (
    <span className={on ? "text-accent-deep" : "text-ink-faint"}>
      {on ? "●" : "○"} {children}
    </span>
  );

  return (
    <WidgetShell
      kind={`circle · ${element}`}
      hint="drag both ends"
      prompt={prompt}
      verdict={verdict}
      feedback={note}
      footer={
        verdict ? null : (
          <span className="inline-flex flex-wrap justify-center gap-x-3 gap-y-1">
            {element === "tangent" ? (
              <>
                <span className="text-ink">distance from centre: {props.dist}</span>
                <Prop on={props.tangent}>= radius {RAD} (touches once)</Prop>
              </>
            ) : (
              <>
                <Prop on={props.endsOn}>both ends on the circle</Prop>
                <Prop on={props.oneCentre}>one end at the centre</Prop>
                <Prop on={props.centre}>passes through the centre</Prop>
              </>
            )}
          </span>
        )
      }
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="application"
        aria-label={prompt}
        className={`mx-auto block w-full max-w-[320px] rounded-md border border-line-soft bg-card-warm ${
          verdict ? "cursor-default" : "cursor-crosshair"
        }`}
        {...(verdict ? {} : surface)}
      >
        <PlaneFrame p={p} />

        {/* the circle */}
        <circle
          cx={p.sx(0)} cy={p.sy(0)}
          r={p.sx(RAD) - p.sx(0)}
          fill="var(--accent)" fillOpacity="0.05"
          stroke="var(--accent)" strokeWidth="1.8"
        />
        {/* the lattice points that sit exactly on it — the magnet targets,
            shown so the affordance is visible rather than discovered */}
        {!verdict && lattice.map((q) => (
          <circle key={`${q.x},${q.y}`} cx={p.sx(q.x)} cy={p.sy(q.y)} r="2"
                  fill="var(--accent)" opacity="0.3" />
        ))}
        {/* centre M */}
        <circle cx={p.sx(0)} cy={p.sy(0)} r="2.8" fill="var(--ink-soft)" />
        <text x={p.sx(0) + 6} y={p.sy(0) - 5} fontSize="10" fill="var(--ink-soft)"
              fontStyle="italic">M</text>

        {/* a tangent is a LINE, so it is drawn to the edges; the others are
            segments and stop at their endpoints */}
        {seg && (
          <line
            x1={p.sx(seg[0].x)} y1={p.sy(seg[0].y)}
            x2={p.sx(seg[1].x)} y2={p.sy(seg[1].y)}
            stroke={verdict === "correct" ? "var(--accent)" : "var(--gold)"}
            strokeWidth="1.4" strokeDasharray="4 3" opacity="0.5"
          />
        )}
        <line
          x1={p.sx(a.x)} y1={p.sy(a.y)} x2={p.sx(b.x)} y2={p.sy(b.y)}
          stroke={verdict === "correct" ? "var(--accent)" : "var(--gold)"}
          strokeWidth="2.4" strokeLinecap="round"
        />

        {pts.map((pt, i) => (
          <Handle
            key={i}
            cx={p.sx(pt.x)} cy={p.sy(pt.y)}
            color={verdict === "correct" ? "var(--accent)" : "var(--gold)"}
            label={i === 0 ? "End A" : "End B"}
            live={`${pt.x}, ${pt.y}${onCircle(pt) ? ", on the circle" : atCentre(pt) ? ", at the centre" : ""}`}
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
          That&apos;s {WANTED[element]}
        </button>
      )}
    </WidgetShell>
  );
}
