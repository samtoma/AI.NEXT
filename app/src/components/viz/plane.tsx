"use client";

/** Shared Cartesian frame: grid + axes + ticks, Ledger-ruled-paper style. */

import {
  INK_FAINT,
  INK_SOFT,
  LINE_SOFT,
  MONO,
  fmtNum,
  niceStep,
} from "./core";

export interface Plane {
  W: number;
  H: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  sx: (x: number) => number;
  sy: (y: number) => number;
  ticksX: number[];
  ticksY: number[];
}

export function makePlane(
  xr: [number, number],
  yr: [number, number],
  W = 300,
  H = 240,
  pad = 16
): Plane {
  const [x0, x1] = xr;
  const [y0, y1] = yr;
  const sx = (x: number) => pad + ((x - x0) / (x1 - x0)) * (W - 2 * pad);
  const sy = (y: number) => H - pad - ((y - y0) / (y1 - y0)) * (H - 2 * pad);
  const ticks = (a: number, b: number) => {
    const step = niceStep(b - a);
    const out: number[] = [];
    for (let t = Math.ceil(a / step) * step; t <= b + 1e-9; t += step)
      out.push(Math.round(t * 1e6) / 1e6);
    return out;
  };
  return { W, H, x0, x1, y0, y1, sx, sy, ticksX: ticks(x0, x1), ticksY: ticks(y0, y1) };
}

/** Static layer: fine grid, ink axes with arrowheads, mono tick labels. */
export function PlaneFrame({ p }: { p: Plane }) {
  const zeroX = p.x0 <= 0 && p.x1 >= 0 ? p.sx(0) : null;
  const zeroY = p.y0 <= 0 && p.y1 >= 0 ? p.sy(0) : null;
  const axX = zeroY ?? p.sy(p.y0); // horizontal axis position
  const axY = zeroX ?? p.sx(p.x0); // vertical axis position
  return (
    <g>
      {/* grid */}
      {p.ticksX.map((t) => (
        <line
          key={`gx${t}`}
          x1={p.sx(t)}
          y1={p.sy(p.y0)}
          x2={p.sx(t)}
          y2={p.sy(p.y1)}
          stroke={LINE_SOFT}
          strokeWidth="1"
        />
      ))}
      {p.ticksY.map((t) => (
        <line
          key={`gy${t}`}
          x1={p.sx(p.x0)}
          y1={p.sy(t)}
          x2={p.sx(p.x1)}
          y2={p.sy(t)}
          stroke={LINE_SOFT}
          strokeWidth="1"
        />
      ))}
      {/* axes */}
      <line x1={p.sx(p.x0) - 2} y1={axX} x2={p.sx(p.x1) + 4} y2={axX} stroke={INK_SOFT} strokeWidth="1.3" />
      <line x1={axY} y1={p.sy(p.y0) + 2} x2={axY} y2={p.sy(p.y1) - 4} stroke={INK_SOFT} strokeWidth="1.3" />
      <path d={`M ${p.sx(p.x1) + 4} ${axX} l -5 -2.6 v 5.2 z`} fill={INK_SOFT} />
      <path d={`M ${axY} ${p.sy(p.y1) - 4} l -2.6 5 h 5.2 z`} fill={INK_SOFT} />
      <text x={p.sx(p.x1) + 2} y={axX - 5} fontSize="8" fontStyle="italic" fill={INK_SOFT} textAnchor="end">
        x
      </text>
      <text x={axY + 6} y={p.sy(p.y1) + 2} fontSize="8" fontStyle="italic" fill={INK_SOFT}>
        y
      </text>
      {/* tick labels */}
      {p.ticksX.filter((t) => t !== 0).map((t) => (
        <text
          key={`tx${t}`}
          x={p.sx(t)}
          y={axX + 9}
          fontSize="6.5"
          fill={INK_FAINT}
          textAnchor="middle"
          style={{ fontFamily: MONO }}
        >
          {fmtNum(t)}
        </text>
      ))}
      {p.ticksY.filter((t) => t !== 0).map((t) => (
        <text
          key={`ty${t}`}
          x={axY - 4}
          y={p.sy(t) + 2.2}
          fontSize="6.5"
          fill={INK_FAINT}
          textAnchor="end"
          style={{ fontFamily: MONO }}
        >
          {fmtNum(t)}
        </text>
      ))}
    </g>
  );
}
