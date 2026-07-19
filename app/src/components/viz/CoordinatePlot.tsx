"use client";

/**
 * coordinate_plot — points/segments appearing in sequence on a grid.
 * spec: {xRange, yRange, points:[{x,y,label?,color?}], segments:[[i,j]]?,
 *        animate:"plot-sequence"|"none", interactive:false|"click-to-plot"}
 */

import { useRef, useState } from "react";
import {
  ACCENT,
  ACCENT_DEEP,
  GOLD,
  INK_FAINT,
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
import { PlaneFrame, makePlane } from "./plane";

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
  const segments: [number, number][] = arr(spec.segments)
    .map((s) => (Array.isArray(s) ? [num(s[0], -1), num(s[1], -1)] : [-1, -1]))
    .filter(
      ([i, j]) =>
        Number.isInteger(i) && Number.isInteger(j) &&
        i >= 0 && j >= 0 && i < points.length && j < points.length && i !== j
    ) as [number, number][];
  const interactive = spec.interactive === "click-to-plot" || spec.interactive === true;
  if (points.length === 0 && !interactive)
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
  const p = makePlane([x0, x1], [y0, y1], 300, 240);

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
        <PlaneFrame p={p} />

        {/* animated layer — remounts each cycle */}
        <g key={tl.key}>
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
                  {pt.label || `(${fmtNum(pt.x)},${fmtNum(pt.y)})`}
                </text>
              </g>
            );
          })}
          {segments.map(([i, j], k) => (
            <line
              key={`s${k}`}
              x1={p.sx(points[i].x)}
              y1={p.sy(points[i].y)}
              x2={p.sx(points[j].x)}
              y2={p.sy(points[j].y)}
              stroke={points[i].color}
              strokeWidth="1.6"
              strokeLinecap="round"
              pathLength={100}
              style={a.draw(segStart + k * 0.55, 0.5)}
            />
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
