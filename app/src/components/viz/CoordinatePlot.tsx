"use client";

/**
 * coordinate_plot — points/segments appearing in sequence on a grid.
 * spec: {xRange, yRange, points:[{x,y,label?,color?}],
 *        segments:[[i,j] | {from:i,to:j,label?,dashed?}]?,
 *        polygons:[{points:[i,j,k,…], fill?}]?, axes:{x?,y?}?,
 *        quadrants:true|[4 names]?, notes:[{x,y,text}]?, scale:"numbers"|"none"?,
 *        animate:"plot-sequence"|"none", interactive:false|"click-to-plot"}
 * VIZ_SPEC v4 added labelled/dashed segments, shaded polygons, axis titles,
 * quadrant names, notes and scale:"none" (a derivation drawn with symbolic
 * points: no grid, no numbers to read off).
 */

import { useRef, useState } from "react";
import {
  ACCENT,
  ACCENT_DEEP,
  GOLD,
  INK_FAINT,
  INK_SOFT,
  MONO,
  VizError,
  arr,
  colorOf,
  fmtNum,
  makeAnim,
  num,
  obj,
  range2,
  str,
  useVizTimeline,
  type VizProps,
} from "./core";
import { PlaneFrame, makePlane, titleRoom, type AxisTitles } from "./plane";

interface Seg {
  i: number;
  j: number;
  label: string;
  dashed: boolean;
}

const QUADRANT_NAMES = ["first", "second", "third", "fourth"];

interface Pt {
  x: number;
  y: number;
  label: string;
  color: string;
}

export function CoordinatePlot({ spec, animOn }: VizProps) {
  const points: Pt[] = arr(spec.points).map((raw) => {
    const p = obj(raw);
    return {
      x: num(p.x),
      y: num(p.y),
      label: str(p.label),
      color: colorOf(p.color, ACCENT),
    };
  });
  const valid = (i: number) => Number.isInteger(i) && i >= 0 && i < points.length;
  const segments: Seg[] = arr(spec.segments)
    .map((s): Seg => {
      if (Array.isArray(s)) return { i: num(s[0], -1), j: num(s[1], -1), label: "", dashed: false };
      const o = obj(s);
      return { i: num(o.from, -1), j: num(o.to, -1), label: str(o.label), dashed: o.dashed === true };
    })
    .filter(({ i, j }) => valid(i) && valid(j) && i !== j);
  const polygons = arr(spec.polygons)
    .map((raw) => {
      const o = obj(raw);
      return { idx: arr(o.points).map((v) => num(v, -1)).filter(valid), fill: o.fill !== false };
    })
    .filter((g) => g.idx.length >= 3);
  const axes = obj(spec.axes);
  const titles: AxisTitles = { x: str(axes.x) || undefined, y: str(axes.y) || undefined };
  const quadrants =
    spec.quadrants === true
      ? QUADRANT_NAMES
      : arr(spec.quadrants).map((q) => str(q)).filter(Boolean);
  const notes = arr(spec.notes)
    .map((n) => obj(n))
    .map((n) => ({ x: num(n.x, NaN), y: num(n.y, NaN), text: str(n.text) }))
    .filter((n) => Number.isFinite(n.x) && Number.isFinite(n.y) && n.text);
  const bare = spec.scale === "none";
  const interactive = spec.interactive === "click-to-plot" || spec.interactive === true;
  // a plane with only its quadrants named, or notes, is a figure too (pp3u1-1 figure 7)
  if (points.length === 0 && !interactive && quadrants.length === 0 && notes.length === 0)
    throw new VizError("coordinate_plot: no points");



  // auto-widen the range so every point fits
  let [x0, x1] = range2(spec.xRange, [-6, 6]);
  let [y0, y1] = range2(spec.yRange, [-6, 6]);
  for (const p of points) {
    x0 = Math.min(x0, Math.floor(p.x) - 1);
    x1 = Math.max(x1, Math.ceil(p.x) + 1);
    y0 = Math.min(y0, Math.floor(p.y) - 1);
    y1 = Math.max(y1, Math.ceil(p.y) + 1);
  }
  const p = makePlane([x0, x1], [y0, y1], 300, 240, 16, titleRoom(titles));

  const on = animOn && spec.animate !== "none";
  const D_PT = 0.45;
  const segStart = 0.4 + points.length * D_PT;
  const tl = useVizTimeline(segStart + segments.length * 0.55, on);
  const a = makeAnim(on, tl.ctrl);

  // click-to-plot: student's own points live outside the looping layer
  const [mine, setMine] = useState<Pt[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!interactive || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const gx = ((e.clientX - rect.left) / rect.width) * p.W;
    const gy = ((e.clientY - rect.top) / rect.height) * p.H;
    // invert scales, snap to integer lattice
    const x = Math.round(p.x0 + ((gx - 16) / (p.W - 32)) * (p.x1 - p.x0));
    const y = Math.round(p.y0 + ((p.H - 16 - gy) / (p.H - 32)) * (p.y1 - p.y0));
    if (x < p.x0 || x > p.x1 || y < p.y0 || y > p.y1) return;
    setMine((m) => [...m.slice(-4), { x, y, label: "", color: GOLD }]);
  };

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${p.W} ${p.H}`}
        role="img"
        aria-label="coordinate plot"
        onClick={handleClick}
        className={`block w-full ${interactive ? "cursor-crosshair" : ""}`}
      >
        <PlaneFrame p={p} titles={titles} bare={bare} quadrants={quadrants.length ? quadrants : undefined} />

        {/* animated layer — remounts each cycle */}
        <g key={tl.key}>
          {polygons.map((g, k) => (
            <path
              key={`g${k}`}
              d={g.idx.map((i, n) => `${n === 0 ? "M" : "L"} ${p.sx(points[i].x).toFixed(1)} ${p.sy(points[i].y).toFixed(1)}`).join(" ") + " Z"}
              fill={g.fill ? points[g.idx[0]].color : "none"}
              fillOpacity={0.14}
              stroke="none"
              style={a.fade(segStart + segments.length * 0.55)}
            />
          ))}
          {points.map((pt, i) => {
            const d = 0.4 + i * D_PT;
            return (
              <g key={i}>
                <g style={a.pop(d)}>
                  <circle cx={p.sx(pt.x)} cy={p.sy(pt.y)} r="5.5" fill={pt.color} opacity="0.22" />
                  <circle cx={p.sx(pt.x)} cy={p.sy(pt.y)} r="2.8" fill={pt.color} />
                </g>
                <text
                  x={p.sx(pt.x) + 6}
                  y={p.sy(pt.y) - 5}
                  fontSize="7.5"
                  fontWeight="600"
                  fill={pt.color === ACCENT ? ACCENT_DEEP : pt.color}
                  style={{ fontFamily: MONO, ...a.fade(d + 0.15) }}
                >
                  {pt.label || (bare ? "" : `(${fmtNum(pt.x)},${fmtNum(pt.y)})`)}
                </text>
              </g>
            );
          })}
          {segments.map(({ i, j, label, dashed }, k) => {
            const d = segStart + k * 0.55;
            const X1 = p.sx(points[i].x), Y1 = p.sy(points[i].y);
            const X2 = p.sx(points[j].x), Y2 = p.sy(points[j].y);
            const len = Math.hypot(X2 - X1, Y2 - Y1) || 1;
            // label beside the segment's middle, on its normal — clear of the line by half
            // its width when the normal runs sideways (a vertical leg), ~3.6px per mono char
            const ux = -(Y2 - Y1) / len, uy = (X2 - X1) / len;
            const off = 8 + Math.abs(ux) * label.length * 3.6;
            const nx = ux * off, ny = uy * off;
            return (
              <g key={`s${k}`}>
                <line
                  x1={X1} y1={Y1} x2={X2} y2={Y2}
                  stroke={points[i].color}
                  strokeWidth={dashed ? 1.2 : 1.6}
                  strokeLinecap="round"
                  strokeDasharray={dashed ? "4 3" : undefined}
                  pathLength={dashed ? undefined : 100}
                  style={dashed ? a.fade(d, 0.5) : a.draw(d, 0.5)}
                />
                {label && (
                  <text
                    x={(X1 + X2) / 2 + nx} y={(Y1 + Y2) / 2 + ny + 3}
                    fontSize="7.5" fontWeight="600" textAnchor="middle"
                    fill={points[i].color === ACCENT ? ACCENT_DEEP : points[i].color}
                    style={{ fontFamily: MONO, ...a.fade(d + 0.4) }}
                  >
                    {label}
                  </text>
                )}
              </g>
            );
          })}
          {notes.map((n, k) => (
            <text
              key={`n${k}`}
              x={p.sx(n.x)} y={p.sy(n.y)}
              fontSize="7.5" textAnchor="middle" fill={INK_SOFT}
              style={{ fontFamily: MONO, ...a.fade(segStart + segments.length * 0.55 + 0.3) }}
            >
              {n.text}
            </text>
          ))}
        </g>

        {/* the student's own taps (never wiped by the loop) */}
        {mine.map((pt, i) => (
          <g key={`m${i}`} className="anim-pop">
            <circle cx={p.sx(pt.x)} cy={p.sy(pt.y)} r="5" fill="none" stroke={GOLD} strokeWidth="1.6" />
            <circle cx={p.sx(pt.x)} cy={p.sy(pt.y)} r="1.8" fill={GOLD} />
            <text
              x={p.sx(pt.x) + 6}
              y={p.sy(pt.y) + 8}
              fontSize="7"
              fontWeight="600"
              fill={GOLD}
              style={{ fontFamily: MONO }}
            >
              ({fmtNum(pt.x)},{fmtNum(pt.y)})
            </text>
          </g>
        ))}
      </svg>

      {interactive && (
        <div className="pointer-events-none absolute inset-x-0 bottom-1 flex items-center justify-between px-2">
          <span
            className="text-[8px] uppercase tracking-[0.14em]"
            style={{ fontFamily: MONO, color: INK_FAINT }}
          >
            ✳ tap the grid to plot
          </span>
          {mine.length > 0 && (
            <button
              onClick={() => setMine([])}
              className="pointer-events-auto rounded-full border border-line bg-card px-1.5 py-px text-[8px] uppercase tracking-[0.12em] text-ink-soft transition-colors hover:text-ink"
              style={{ fontFamily: MONO }}
            >
              ↺ clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
