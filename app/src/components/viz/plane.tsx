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
  /** Inverse of sx/sy — SVG user-space back to plane coordinates. Needed by
   *  the interactive widgets (student/widgets/drag.ts): a pointer arrives in
   *  screen space, and the only correct way back to "which x did they mean"
   *  is through the same frame the figure was drawn with. */
  ix: (px: number) => number;
  iy: (py: number) => number;
  ticksX: number[];
  ticksY: number[];
}

export function makePlane(
  xr: [number, number],
  yr: [number, number],
  W = 300,
  H = 240,
  pad = 16,
  /** extra room beside the plot, for axis titles (VIZ_SPEC v4 `axes`) */
  extra: { left?: number; bottom?: number } = {}
): Plane {
  const [x0, x1] = xr;
  const [y0, y1] = yr;
  const pl = pad + (extra.left ?? 0);
  const pb = pad + (extra.bottom ?? 0);
  const sx = (x: number) => pl + ((x - x0) / (x1 - x0)) * (W - pl - pad);
  const sy = (y: number) => H - pb - ((y - y0) / (y1 - y0)) * (H - pb - pad);
  const ix = (p: number) => x0 + ((p - pl) / (W - pl - pad)) * (x1 - x0);
  const iy = (p: number) => y0 + ((H - pb - p) / (H - pb - pad)) * (y1 - y0);
  const ticks = (a: number, b: number) => {
    const step = niceStep(b - a);
    const out: number[] = [];
    for (let t = Math.ceil(a / step) * step; t <= b + 1e-9; t += step)
      out.push(Math.round(t * 1e6) / 1e6);
    return out;
  };
  return { W, H, x0, x1, y0, y1, sx, sy, ix, iy,
           ticksX: ticks(x0, x1), ticksY: ticks(y0, y1) };
}

/** Room `makePlane` needs beside the plot for these axis titles. */
export function titleRoom(titles?: AxisTitles): { left?: number; bottom?: number } {
  return { left: titles?.y ? 12 : 0, bottom: titles?.x ? 12 : 0 };
}

export interface AxisTitles {
  x?: string;
  y?: string;
}

/**
 * Static layer: fine grid, ink axes with arrowheads, mono tick labels.
 * VIZ_SPEC v4: `titles` names the axes in the book's words; `bare` drops the
 * grid and the number scale (a derivation drawn with symbolic points, where
 * no number may be read off); `quadrants` names the four quadrants, first
 * quadrant first, anticlockwise — a "\n" in a name starts a new line.
 */
export function PlaneFrame({
  p,
  titles,
  bare = false,
  quadrants,
}: {
  p: Plane;
  titles?: AxisTitles;
  bare?: boolean;
  quadrants?: string[];
}) {
  const zeroX = p.x0 <= 0 && p.x1 >= 0 ? p.sx(0) : null;
  const zeroY = p.y0 <= 0 && p.y1 >= 0 ? p.sy(0) : null;
  const axX = zeroY ?? p.sy(p.y0); // horizontal axis position
  const axY = zeroX ?? p.sx(p.x0); // vertical axis position
  const ticksX = bare ? [] : p.ticksX;
  const ticksY = bare ? [] : p.ticksY;
  // the centre of each quadrant's visible part: I upper right, then anticlockwise
  const qx = [(axY + p.sx(p.x1)) / 2, (p.sx(p.x0) + axY) / 2];
  const qy = [(p.sy(p.y1) + axX) / 2, (axX + p.sy(p.y0)) / 2];
  const qAt: [number, number][] = [[qx[0], qy[0]], [qx[1], qy[0]], [qx[1], qy[1]], [qx[0], qy[1]]];
  return (
    <g>
      {/* grid */}
      {ticksX.map((t) => (
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
      {ticksY.map((t) => (
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
      {titles?.x && (
        <text x={(p.sx(p.x0) + p.sx(p.x1)) / 2} y={p.H - 3} fontSize="7" fill={INK_SOFT} textAnchor="middle"
          style={{ fontFamily: MONO }}>
          {titles.x}
        </text>
      )}
      {titles?.y && (
        <text x={0} y={0} fontSize="7" fill={INK_SOFT} textAnchor="middle" style={{ fontFamily: MONO }}
          transform={`translate(7 ${(p.sy(p.y0) + p.sy(p.y1)) / 2}) rotate(-90)`}>
          {titles.y}
        </text>
      )}
      {quadrants?.slice(0, 4).map((q, i) => (
        <text key={`q${i}`} x={qAt[i][0]} y={qAt[i][1]} fontSize="7" fill={INK_SOFT} textAnchor="middle"
          style={{ fontFamily: MONO }}>
          {q.split("\n").map((line, k, all) => (
            <tspan key={k} x={qAt[i][0]} dy={k === 0 ? `${-(all.length - 1) * 0.6}em` : "1.2em"}>
              {line}
            </tspan>
          ))}
        </text>
      ))}
      {/* tick labels */}
      {ticksX.filter((t) => t !== 0).map((t) => (
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
      {ticksY.filter((t) => t !== 0).map((t) => (
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
