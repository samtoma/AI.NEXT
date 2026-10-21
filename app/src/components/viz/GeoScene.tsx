"use client";

/**
 * geo_scene — any straight-edge-and-circle figure, elements appearing in step
 * order (VIZ_SPEC v4: circle theorems, triangles, quadrilaterals, parallels).
 * spec: {elements:[{type:"circle"|"point"|"segment"|"chord"|"radius"|
 *        "diameter"|"tangent"|"polygon"|"arc"|"angle"|"label", ...fields,
 *        step:int}] | panels:[{label, elements}], animate:"sequence"}
 * The viewBox auto-fits the geometry (math orientation: y grows upward).
 *
 * MARKS ARE GIVENS (v4). A textbook figure states its facts with marks, not
 * words: `ticks` (equal lengths, on a segment or an arc), `parallel` (arrow
 * chevrons), an angle's `right` square and `arcs` (equal angles). They are
 * drawn in screen pixels at fixed sizes, so a mark reads the same on a small
 * figure as on a large one. `dashed`, `fill` and `arrow` cover construction
 * lines, shaded regions and rays.
 */

import { useRef, useState } from "react";
import { angleSpan as angleSpanOf, tidyGeoElements } from "@/lib/geo-tidy";
import {
  ACCENT,
  ACCENT_DEEP,
  GOLD,
  INK,
  INK_SOFT,
  MONO,
  VizError,
  arr,
  makeAnim,
  num,
  obj,
  str,
  usePrefersReducedMotion,
  useVizTimeline,
  type VizProps,
} from "./core";

type El = Record<string, unknown> & { type: string; step: number };
type P2 = [number, number];

const SEGMENT_TYPES = new Set(["segment", "chord", "radius", "diameter", "tangent"]);

/** Shade for fill:true regions — the accent at a wash, overlaps darken. */
const FILL_OPACITY = 0.14;
/** how far outside its arc an arc's label sits, in screen pixels */
const ARC_LABEL_PX = 12;
const DASH = "4 3";

// tidied before drawing (lib/geo-tidy): a crossed polygon goes round, a point
// written just off a crossing goes onto it. Element count and order are kept,
// so an index into spec.elements still names the same element.
const parseEls = (raw: unknown): El[] =>
  tidyGeoElements(
    arr(raw)
      .map((r, i) => {
        const e = obj(r);
        return { ...e, type: str(e.type), step: num(e.step, i + 1) };
      })
      .filter((e) => e.type !== "")
  );

const count = (v: unknown, max = 3): number => {
  const n = Math.round(num(v, 0));
  return n > 0 ? Math.min(n, max) : 0;
};

/**
 * What a student can do with a drawing (lib/figure-interactions; prototype).
 * Indices are into `spec.elements`; tones colour a graded answer.
 */
export interface GeoInteract {
  tappable?: number[];
  tappablePoints?: string[];
  selected?: number[];
  selectedPoints?: string[];
  tone?: Record<string, "ok" | "miss" | "extra">;
  onTap?: (index: number) => void;
  onTapPoint?: (label: string) => void;
  /** the point under the student's finger; positions arrive in figure units */
  drag?: {
    label: string;
    onDrag: (p: P2) => void;
    /** until the first move: a pulsing ring on the handle and, for a point
     *  that runs along a circle, a dashed arrow showing which way it goes */
    hint?: { arc?: { c: P2; r: number; fromDeg: number; toDeg: number } };
  };
  /** fit the frame to this spec, so it holds still while a point moves */
  fitSpec?: Record<string, unknown>;
}

/** A geo_scene the student acts on: drawn at its final frame, no loop. */
export function GeoSceneInteractive({
  spec,
  interact,
}: {
  spec: Record<string, unknown>;
  interact: GeoInteract;
}) {
  return (
    <GeoDrawing
      els={parseEls(spec.elements)}
      animate="none"
      animOn={false}
      interact={interact}
      fitEls={interact.fitSpec ? parseEls(interact.fitSpec.elements) : undefined}
    />
  );
}

export function GeoScene({ spec, animOn }: VizProps) {
  const panels = arr(spec.panels).map((p) => obj(p));
  if (panels.length > 0) {
    return (
      <div className={`grid gap-2 ${panels.length > 1 ? "grid-cols-2" : ""}`}>
        {panels.map((p, i) => (
          <figure key={i} className="m-0">
            {str(p.label) && (
              <figcaption className="text-center text-[10px] text-ink-soft" style={{ fontFamily: MONO }}>
                {str(p.label)}
              </figcaption>
            )}
            <GeoDrawing els={parseEls(p.elements)} animate={spec.animate} animOn={animOn}
              width={panels.length > 1 ? 180 : 300} />
          </figure>
        ))}
      </div>
    );
  }
  return <GeoDrawing els={parseEls(spec.elements)} animate={spec.animate} animOn={animOn} />;
}

/** `width` is the viewBox width: a panel drawn at half the page gets a
 *  smaller canvas, so its labels and marks keep their size on screen. */
function GeoDrawing({
  els,
  animate,
  animOn,
  width = 300,
  interact,
  fitEls,
}: {
  els: El[];
  animate: unknown;
  animOn: boolean;
  width?: number;
  interact?: GeoInteract;
  fitEls?: El[];
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState(false);
  const reduced = usePrefersReducedMotion();
  if (els.length === 0) throw new VizError("geo_scene: no elements");

  const firstCircle = els.find((e) => e.type === "circle");
  const circleOf = (e: El) => ({
    cx: num(e.cx, firstCircle ? num(firstCircle.cx, 0) : 0),
    cy: num(e.cy, firstCircle ? num(firstCircle.cy, 0) : 0),
    r: num(e.r, firstCircle ? num(firstCircle.r, 3) : 3),
  });
  const pt2 = (v: unknown): P2 | null => {
    if (!Array.isArray(v) || v.length < 2) return null;
    const x = num(v[0], NaN);
    const y = num(v[1], NaN);
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
  };
  const ptsOf = (e: El): P2[] => arr(e.points).map(pt2).filter((p): p is P2 => p !== null);

  /* bounding box over all geometry (world units, y up) */
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const feed = (x: number, y: number) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  for (const e of fitEls ?? els) {
    if (e.type === "circle" || e.type === "arc") {
      const { cx, cy, r } = circleOf(e);
      feed(cx - r, cy - r);
      feed(cx + r, cy + r);
    } else if (SEGMENT_TYPES.has(e.type)) {
      const f = pt2(e.from);
      const t = pt2(e.to);
      if (f) feed(...f);
      if (t) feed(...t);
    } else if (e.type === "polygon") {
      for (const p of ptsOf(e)) feed(...p);
    } else if (e.type === "point" || e.type === "label") {
      const x = num(e.x, NaN);
      const y = num(e.y, NaN);
      if (Number.isFinite(x) && Number.isFinite(y)) feed(x, y);
    } else if (e.type === "angle") {
      const at = pt2(e.at);
      if (at) feed(...at);
    }
  }
  if (!Number.isFinite(minX)) throw new VizError("geo_scene: no drawable geometry");
  if (maxX - minX < 1e-6) { minX -= 3; maxX += 3; }
  if (maxY - minY < 1e-6) { minY -= 3; maxY += 3; }
  const padW = (maxX - minX) * 0.16 + 0.5;
  const padH = (maxY - minY) * 0.16 + 0.5;
  minX -= padW; maxX += padW; minY -= padH; maxY += padH;

  const polar = (cx: number, cy: number, r: number, deg: number): P2 => [
    cx + r * Math.cos((deg * Math.PI) / 180),
    cy + r * Math.sin((deg * Math.PI) / 180),
  ];

  /* angle marks sit on their arms (lib/geo-tidy angleSpan) */
  const angleSpan = (e: El) => angleSpanOf(els, e);

  const W = width;
  const H_MIN = W * 0.53, H_MAX = W * 0.87;
  let H = Math.max(H_MIN, Math.min(H_MAX, (W * (maxY - minY)) / (maxX - minX)));
  let s = Math.min(W / (maxX - minX), H / (maxY - minY));

  /* labels render at fixed px sizes, so their world-unit extents depend on
     the scale: extend the bbox for text overhang, refit, repeat once so the
     new scale is accounted for. ~7px/char at the 8–8.5px mono sizes below. */
  const CHAR_W = 7;
  for (let pass = 0; pass < 2; pass++) {
    for (const e of fitEls ?? els) {
      const label = str(e.label ?? e.text);
      if (!label) continue;
      const w = label.length * CHAR_W;
      if (e.type === "point") {
        // start-anchored at sx(x)+6, baseline sy(y)-5 → extends right + up
        const x = num(e.x, NaN);
        const y = num(e.y, NaN);
        if (Number.isFinite(x)) maxX = Math.max(maxX, x + (6 + w) / s);
        if (Number.isFinite(y)) maxY = Math.max(maxY, y + 14 / s);
        continue;
      }
      // remaining label kinds are middle-anchored: half width each side
      let ax: number | null = null;
      if (e.type === "circle") {
        const { cx, cy, r } = circleOf(e);
        ax = cx;
        maxY = Math.max(maxY, cy + r + 15 / s); // label sits above the top
      } else if (e.type === "arc") {
        const { cx, cy, r } = circleOf(e);
        const a0 = num(e.startDeg, 0);
        const sweep =
          (((num(e.endDeg, 90) - a0) % 360) + 360) % 360 || 360;
        const [lx, ly] = polar(cx, cy, r + ARC_LABEL_PX / s, a0 + sweep / 2);
        ax = lx;
        // and room above or below for it
        minY = Math.min(minY, ly - 8 / s);
        maxY = Math.max(maxY, ly + 8 / s);
      } else if (SEGMENT_TYPES.has(e.type)) {
        const f = pt2(e.from);
        const t = pt2(e.to);
        if (f && t) ax = (f[0] + t[0]) / 2;
      } else if (e.type === "angle") {
        const at = pt2(e.at);
        if (at) {
          const [f, t] = angleSpan(e);
          ax = polar(at[0], at[1], 38 / s, (f + t) / 2)[0];
        }
      } else if (e.type === "label") {
        const x = num(e.x, NaN);
        if (Number.isFinite(x)) ax = x;
      }
      if (ax != null) {
        minX = Math.min(minX, ax - w / 2 / s);
        maxX = Math.max(maxX, ax + w / 2 / s);
      }
    }
    H = Math.max(H_MIN, Math.min(H_MAX, (W * (maxY - minY)) / (maxX - minX)));
    s = Math.min(W / (maxX - minX), H / (maxY - minY));
  }

  const ox = (W - s * (maxX - minX)) / 2;
  const oy = (H - s * (maxY - minY)) / 2;
  // rounded to 1/100 px: the server and the browser otherwise disagree in the last
  // float digit of a label's position, and React reports a hydration mismatch
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const sx = (x: number) => r2(ox + (x - minX) * s);
  const sy = (y: number) => r2(H - oy - (y - minY) * s); // flip: math y-up

  /* step timing — REAL steps: exposed to the board via stepTimes */
  const steps = [...new Set(els.map((e) => e.step))].sort((x, y) => x - y);
  const stepAt = new Map(steps.map((st, i) => [st, 0.4 + i * 0.65]));
  const stepTimes = steps.map((st) => stepAt.get(st) ?? 0.4);
  const on = animOn && animate !== "none";
  const tl = useVizTimeline(
    (stepTimes[stepTimes.length - 1] ?? 0.4) + 1.2,
    on,
    stepTimes
  );
  const a = makeAnim(on, tl.ctrl);

  /* ---- marks, in screen pixels along a screen-space direction ---- */

  /** n short strokes across a line at (px,py), the line running along (ux,uy). */
  const tickMarks = (px: number, py: number, ux: number, uy: number, n: number) => {
    const nx = -uy, ny = ux; // the line's normal
    const L = 4.5, GAP = 3;
    return Array.from({ length: n }, (_, k) => {
      const o = (k - (n - 1) / 2) * GAP;
      const cx = px + ux * o, cy = py + uy * o;
      return `M ${(cx - nx * L).toFixed(1)} ${(cy - ny * L).toFixed(1)} L ${(cx + nx * L).toFixed(1)} ${(cy + ny * L).toFixed(1)}`;
    }).join(" ");
  };
  /** n chevrons pointing along (ux,uy) — the book's parallel arrows. */
  const chevrons = (px: number, py: number, ux: number, uy: number, n: number) => {
    const nx = -uy, ny = ux;
    const L = 4.5, GAP = 3.5;
    return Array.from({ length: n }, (_, k) => {
      const o = (k - (n - 1) / 2) * GAP;
      const tx = px + ux * (o + 2.5), ty = py + uy * (o + 2.5); // the tip
      const bx = tx - ux * L, by = ty - uy * L;
      return `M ${(bx + nx * L * 0.8).toFixed(1)} ${(by + ny * L * 0.8).toFixed(1)} L ${tx.toFixed(1)} ${ty.toFixed(1)} L ${(bx - nx * L * 0.8).toFixed(1)} ${(by - ny * L * 0.8).toFixed(1)}`;
    }).join(" ");
  };
  /** a filled arrowhead with its tip at (px,py), pointing along (ux,uy). */
  const arrowHead = (px: number, py: number, ux: number, uy: number) => {
    const nx = -uy, ny = ux;
    const L = 7, Wd = 3.2;
    return `M ${px.toFixed(1)} ${py.toFixed(1)} L ${(px - ux * L + nx * Wd).toFixed(1)} ${(py - uy * L + ny * Wd).toFixed(1)} L ${(px - ux * L - nx * Wd).toFixed(1)} ${(py - uy * L - ny * Wd).toFixed(1)} Z`;
  };

  const render = (e: El, i: number) => {
    const d = stepAt.get(e.step) ?? 0.4;
    const key = `e${i}`;
    const label = str(e.label ?? e.text);
    const dashed = e.dashed === true;
    /** a dashed stroke cannot use the dash-offset draw-in: it fades in */
    const strokeIn = (dur: number) => (dashed ? a.fade(d, dur) : a.draw(d, dur));

    if (e.type === "circle") {
      const { cx, cy, r } = circleOf(e);
      return (
        <g key={key}>
          {e.fill === true && (
            <circle cx={sx(cx)} cy={sy(cy)} r={r * s} fill={ACCENT} fillOpacity={FILL_OPACITY}
              stroke="none" style={a.fade(d + 0.5)} />
          )}
          <circle
            cx={sx(cx)} cy={sy(cy)} r={r * s}
            fill="none" stroke={INK} strokeWidth="1.6"
            strokeDasharray={dashed ? DASH : undefined}
            pathLength={dashed ? undefined : 100} style={strokeIn(0.9)}
          />
          {label && (
            <text x={sx(cx)} y={sy(cy + r) - 6} fontSize="8" textAnchor="middle" fill={INK_SOFT}
              style={{ fontFamily: MONO, ...a.fade(d + 0.6) }}>
              {label}
            </text>
          )}
        </g>
      );
    }

    if (e.type === "polygon") {
      const pts = ptsOf(e);
      if (pts.length < 3) return null;
      const dPath = pts.map(([x, y], k) => `${k === 0 ? "M" : "L"} ${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`).join(" ") + " Z";
      return (
        <g key={key}>
          {e.fill === true && (
            <path d={dPath} fill={ACCENT} fillOpacity={FILL_OPACITY} stroke="none" style={a.fade(d + 0.5)} />
          )}
          <path
            d={dPath} fill="none" stroke={INK} strokeWidth="1.6" strokeLinejoin="round"
            strokeDasharray={dashed ? DASH : undefined}
            pathLength={dashed ? undefined : 100} style={strokeIn(0.9)}
          />
        </g>
      );
    }

    if (SEGMENT_TYPES.has(e.type)) {
      const f = pt2(e.from);
      const t = pt2(e.to);
      if (!f || !t) return null;
      const special = e.type === "tangent" ? GOLD : e.type === "chord" ? ACCENT : INK;
      const x1 = sx(f[0]), y1 = sy(f[1]), x2 = sx(t[0]), y2 = sy(t[1]);
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      // perpendicular offset for the label
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      // clear of the line by half the label's width when the normal runs sideways
      const off = 8 + Math.abs(uy) * label.length * 3.6;
      const nx = -uy * off;
      const ny = ux * off;
      const nTicks = count(e.ticks);
      const nPar = count(e.parallel);
      // both marks on one line: arrows before the middle, ticks after it
      const at = (frac: number): P2 => [x1 + dx * frac, y1 + dy * frac];
      const [tx, ty] = nPar ? at(0.62) : at(0.5);
      const [cx, cy] = nTicks ? at(0.38) : at(0.5);
      const arrow = e.arrow === "end" || e.arrow === "both" ? e.arrow : null;
      const markStyle = a.fade(d + 0.5);
      return (
        <g key={key}>
          <line
            x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={special} strokeWidth={e.type === "diameter" || e.type === "radius" ? 1.8 : 1.6}
            strokeLinecap="round" strokeDasharray={dashed ? DASH : undefined}
            pathLength={dashed ? undefined : 100} style={strokeIn(0.6)}
          />
          {nTicks > 0 && (
            <path d={tickMarks(tx, ty, ux, uy, nTicks)} fill="none" stroke={special}
              strokeWidth="1.4" strokeLinecap="round" style={markStyle} />
          )}
          {nPar > 0 && (
            <path d={chevrons(cx, cy, ux, uy, nPar)} fill="none" stroke={special}
              strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={markStyle} />
          )}
          {arrow && <path d={arrowHead(x2, y2, ux, uy)} fill={special} style={markStyle} />}
          {arrow === "both" && <path d={arrowHead(x1, y1, -ux, -uy)} fill={special} style={markStyle} />}
          {label && (
            <text x={mx + nx} y={my + ny + 3} fontSize="8" fontWeight="600" textAnchor="middle"
              fill={special === INK ? INK_SOFT : special}
              style={{ fontFamily: MONO, ...a.fade(d + 0.45) }}>
              {label}
            </text>
          )}
        </g>
      );
    }

    if (e.type === "point") {
      const x = num(e.x, NaN);
      const y = num(e.y, NaN);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return (
        <g key={key}>
          <g style={a.pop(d)}>
            <circle cx={sx(x)} cy={sy(y)} r="4.5" fill={ACCENT} opacity="0.2" />
            <circle cx={sx(x)} cy={sy(y)} r="2.3" fill={ACCENT_DEEP} />
          </g>
          {label && (
            <text x={sx(x) + 6} y={sy(y) - 5} fontSize="8.5" fontWeight="700" fill={INK}
              style={{ fontFamily: MONO, ...a.fade(d + 0.2) }}>
              {label}
            </text>
          )}
        </g>
      );
    }

    if (e.type === "arc") {
      const { cx, cy, r } = circleOf(e);
      const a0 = num(e.startDeg, 0);
      const a1 = num(e.endDeg, 90);
      const sweep = ((a1 - a0) % 360 + 360) % 360 || 360;
      const [px0, py0] = polar(cx, cy, r, a0);
      const [px1, py1] = polar(cx, cy, r, a0 + sweep);
      const large = sweep > 180 ? 1 : 0;
      // the label sits just outside the arc's middle, a fixed distance on screen — never a share of the radius,
      // which put a big circle's label well clear of the drawing (pp3u10-3 figure 1: its "100°" read as nobody's)
      const [lx, ly] = polar(cx, cy, r + ARC_LABEL_PX / s, a0 + sweep / 2);
      const nTicks = count(e.ticks);
      // an arc that only carries equal-arc ticks is the book's tick on the circle, not a highlighted arc: five
      // gold arcs left the one with the value indistinguishable. Highlighted: an arc with a label, or no marks.
      const highlight = !!label || nTicks === 0;
      // a tick on an arc crosses it at its middle: the tangent there is the line's direction
      const mid = ((a0 + sweep / 2) * Math.PI) / 180;
      const [mx, my] = polar(cx, cy, r, a0 + sweep / 2);
      return (
        <g key={key}>
          {highlight && (
            <path
              d={`M ${sx(px0).toFixed(1)} ${sy(py0).toFixed(1)} A ${r * s} ${r * s} 0 ${large} 0 ${sx(px1).toFixed(1)} ${sy(py1).toFixed(1)}`}
              fill="none" stroke={GOLD} strokeWidth="2.4" strokeLinecap="round"
              pathLength={100} style={a.draw(d, 0.7)}
            />
          )}
          {nTicks > 0 && (
            <path d={tickMarks(sx(mx), sy(my), -Math.sin(mid), -Math.cos(mid), nTicks)}
              fill="none" stroke={highlight ? GOLD : INK} strokeWidth="1.4" strokeLinecap="round" style={a.fade(d + 0.5)} />
          )}
          {label && (
            <text x={sx(lx)} y={sy(ly) + 3} fontSize="8" fontWeight="600" textAnchor="middle" fill={GOLD}
              style={{ fontFamily: MONO, ...a.fade(d + 0.5) }}>
              {label}
            </text>
          )}
        </g>
      );
    }

    if (e.type === "angle") {
      const at = pt2(e.at);
      if (!at) return null;
      const [a0, a1] = angleSpan(e);
      const X = sx(at[0]), Y = sy(at[1]);
      // screen-space unit vectors along each arm (y flipped)
      const u = (deg: number): P2 => [Math.cos((deg * Math.PI) / 180), -Math.sin((deg * Math.PI) / 180)];
      if (e.right === true) {
        const [ux, uy] = u(a0);
        const [vx, vy] = u(a1);
        const k = 9;
        const [lx, ly] = polar(at[0], at[1], 26 / s, (a0 + a1) / 2);
        return (
          <g key={key}>
            <path
              d={`M ${(X + ux * k).toFixed(1)} ${(Y + uy * k).toFixed(1)} L ${(X + (ux + vx) * k).toFixed(1)} ${(Y + (uy + vy) * k).toFixed(1)} L ${(X + vx * k).toFixed(1)} ${(Y + vy * k).toFixed(1)}`}
              fill="none" stroke={GOLD} strokeWidth="1.4" pathLength={100} style={a.draw(d, 0.4)}
            />
            {label && (
              <text x={sx(lx)} y={sy(ly) + 3} fontSize="8.5" fontWeight="700" textAnchor="middle" fill={GOLD}
                style={{ fontFamily: MONO, ...a.fade(d + 0.35) }}>
                {label}
              </text>
            )}
          </g>
        );
      }
      const nArcs = Math.max(1, count(e.arcs));
      const large = 0; // angleSpan: always the angle under 180°
      const rOuter = 22 + (nArcs - 1) * 3.5;
      const [lx, ly] = polar(at[0], at[1], (rOuter + 16) / s, (a0 + a1) / 2);
      return (
        <g key={key}>
          {Array.from({ length: nArcs }, (_, k) => {
            const rPx = 22 - (nArcs - 1) * 1.75 + k * 3.5;
            const [wx0, wy0] = polar(at[0], at[1], rPx / s, a0);
            const [wx1, wy1] = polar(at[0], at[1], rPx / s, a1);
            return (
              <path key={k}
                d={`M ${sx(wx0).toFixed(1)} ${sy(wy0).toFixed(1)} A ${rPx} ${rPx} 0 ${large} 0 ${sx(wx1).toFixed(1)} ${sy(wy1).toFixed(1)}`}
                fill="none" stroke={GOLD} strokeWidth="1.6"
                pathLength={100} style={a.draw(d, 0.5)}
              />
            );
          })}
          {label && (
            <text x={sx(lx)} y={sy(ly) + 3} fontSize="8.5" fontWeight="700" textAnchor="middle" fill={GOLD}
              style={{ fontFamily: MONO, ...a.fade(d + 0.35) }}>
              {label}
            </text>
          )}
        </g>
      );
    }

    if (e.type === "label") {
      const x = num(e.x, NaN);
      const y = num(e.y, NaN);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !label) return null;
      return (
        <text key={key} x={sx(x)} y={sy(y)} fontSize="8.5" fontWeight="600" textAnchor="middle"
          fill={INK} style={{ fontFamily: MONO, ...a.fade(d) }}>
          {label}
        </text>
      );
    }

    return null; // unknown element type — skip, never crash
  };

  /* ---- the interaction layer: hit areas on top of the drawing ---- */
  const toneOf = (k: string) => interact?.tone?.[k];
  // the widgets' figure marks (WidgetShell FIGURE_MARK): the right target in
  // mastery teal — dashed when it was missed — and a wrong pick grey, never red
  const TONE = { ok: "var(--noor-progress)", miss: "var(--noor-progress)", extra: "var(--play-inactive-border)" } as const;
  const arcPath = (e: El) => {
    const { cx, cy, r } = circleOf(e);
    const a0 = num(e.startDeg, 0);
    const sweep = ((num(e.endDeg, 90) - a0) % 360 + 360) % 360 || 360;
    const [px0, py0] = polar(cx, cy, r, a0);
    const [px1, py1] = polar(cx, cy, r, a0 + sweep);
    return `M ${sx(px0).toFixed(1)} ${sy(py0).toFixed(1)} A ${r * s} ${r * s} 0 ${sweep > 180 ? 1 : 0} 0 ${sx(px1).toFixed(1)} ${sy(py1).toFixed(1)}`;
  };
  const shapeOf = (e: El): string | null => {
    if (SEGMENT_TYPES.has(e.type)) {
      const f = pt2(e.from), t = pt2(e.to);
      return f && t ? `M ${sx(f[0]).toFixed(1)} ${sy(f[1]).toFixed(1)} L ${sx(t[0]).toFixed(1)} ${sy(t[1]).toFixed(1)}` : null;
    }
    return e.type === "arc" ? arcPath(e) : null;
  };
  const pointAt = (label: string): P2 | null => {
    const e = els.find((x) => x.type === "point" && str(x.label) === label);
    return e ? [num(e.x, 0), num(e.y, 0)] : null;
  };
  /** a pointer position, back into figure units through the same frame */
  const toWorld = (clientX: number, clientY: number): P2 | null => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const q = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return [minX + (q.x - ox) / s, minY + (H - oy - q.y) / s];
  };

  const layer = interact && (
    <g>
      {(interact.tappable ?? []).map((i) => {
        const e = els[i];
        const d = e && shapeOf(e);
        if (!d) return null;
        const tone = toneOf(String(i));
        const on = interact.selected?.includes(i);
        return (
          <g key={`t${i}`} onClick={() => interact.onTap?.(i)} style={{ cursor: interact.onTap ? "pointer" : undefined }}>
            {(on || tone) && (
              <path d={d} fill="none" stroke={tone ? TONE[tone] : ACCENT_DEEP} strokeWidth="5" strokeOpacity="0.45"
                strokeLinecap="round" strokeDasharray={tone === "miss" ? "5 4" : undefined} />
            )}
            {/* a wide invisible stroke: the line is easy to hit with a finger */}
            <path d={d} fill="none" stroke="transparent" strokeWidth="16" strokeLinecap="round" />
          </g>
        );
      })}
      {(interact.tappablePoints ?? []).map((l) => {
        const p = pointAt(l);
        if (!p) return null;
        const tone = toneOf(l);
        const on = interact.selectedPoints?.includes(l);
        return (
          <g key={`p${l}`} onClick={() => interact.onTapPoint?.(l)} style={{ cursor: "pointer" }}>
            {(on || tone) && (
              <circle cx={sx(p[0])} cy={sy(p[1])} r="8" fill="none" stroke={tone ? TONE[tone] : ACCENT_DEEP}
                strokeWidth="2" strokeDasharray={tone === "miss" ? "3 2" : undefined} />
            )}
            <circle cx={sx(p[0])} cy={sy(p[1])} r="13" fill="transparent" />
          </g>
        );
      })}
      {interact.drag && (() => {
        const p = pointAt(interact.drag.label);
        if (!p) return null;
        return (
          <g
            style={{ cursor: dragging ? "grabbing" : "grab", touchAction: "none" }}
            onPointerDown={(ev) => {
              (ev.target as Element).setPointerCapture?.(ev.pointerId);
              setDragging(true);
            }}
            onPointerMove={(ev) => {
              if (!dragging) return;
              const w = toWorld(ev.clientX, ev.clientY);
              if (w) interact.drag?.onDrag(w);
            }}
            onPointerUp={() => setDragging(false)}
            onPointerCancel={() => setDragging(false)}
          >
            {interact.drag.hint && (
              <circle cx={sx(p[0])} cy={sy(p[1])} r="14" fill="none" stroke={ACCENT_DEEP} strokeWidth="1.5"
                style={reduced ? undefined : { animation: "viz-pulse 1.4s ease-in-out infinite" }} />
            )}
            <circle cx={sx(p[0])} cy={sy(p[1])} r="9" fill={ACCENT} fillOpacity="0.25" stroke={ACCENT_DEEP} strokeWidth="1.5" />
            <circle cx={sx(p[0])} cy={sy(p[1])} r="16" fill="transparent" />
          </g>
        );
      })()}
      {interact.drag?.hint?.arc && (() => {
        const { c, r, fromDeg, toDeg } = interact.drag.hint.arc;
        const [x0, y0] = polar(c[0], c[1], r, fromDeg);
        const [x1, y1] = polar(c[0], c[1], r, toDeg);
        const ccw = toDeg > fromDeg;
        const rad = (toDeg * Math.PI) / 180;
        // the arc's direction of travel at its end, on screen (y flipped)
        // anticlockwise in the figure is (−sin θ, cos θ); on screen y flips: (−sin θ, −cos θ)
        const k = ccw ? 1 : -1;
        const ux = -k * Math.sin(rad), uy = -k * Math.cos(rad);
        return (
          <g pointerEvents="none">
            <path
              d={`M ${sx(x0).toFixed(1)} ${sy(y0).toFixed(1)} A ${(r * s).toFixed(1)} ${(r * s).toFixed(1)} 0 0 ${ccw ? 0 : 1} ${sx(x1).toFixed(1)} ${sy(y1).toFixed(1)}`}
              fill="none" stroke={ACCENT_DEEP} strokeWidth="1.6" strokeDasharray="4 3" strokeLinecap="round"
            />
            <path d={arrowHead(sx(x1), sy(y1), ux, uy)} fill={ACCENT_DEEP} />
          </g>
        );
      })()}
    </g>
  );

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="geometry scene" className="block w-full"
      style={interact?.drag ? { touchAction: "none" } : undefined}>
      <g key={tl.key}>{els.map(render)}</g>
      {layer}
    </svg>
  );
}
