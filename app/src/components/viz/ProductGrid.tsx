"use client";

/**
 * product_grid — X×Y grid cells filling in sequence with a count ticker.
 * spec: {X:[..], Y:[..], animate:"fill", showCount:true}
 * Cells fill x-major, matching how X×Y is listed in the textbook.
 */

import { useState } from "react";
import {
  ACCENT,
  ACCENT_DEEP,
  CARD,
  GOLD,
  INK,
  INK_FAINT,
  LINE,
  LINE_SOFT,
  MONO,
  VizError,
  arr,
  makeAnim,
  str,
  useVizTimeline,
  type VizProps,
} from "./core";

export function ProductGrid({ spec, animOn }: VizProps) {
  const X = arr(spec.X).map((v) => str(v, "?"));
  const Y = arr(spec.Y).map((v) => str(v, "?"));
  if (X.length === 0 || Y.length === 0) throw new VizError("product_grid: X and Y must be non-empty");
  if (X.length * Y.length > 48) throw new VizError("product_grid: too many cells");
  const showCount = spec.showCount !== false;
  const n = X.length * Y.length;

  /* layout */
  const CELL = Math.min(52, Math.max(38, 220 / X.length));
  const CELL_H = 26;
  const HEAD = 20; // X header row
  const SIDE = 34; // Y header col
  const TOP = showCount ? 24 : 8;
  const W = SIDE + X.length * CELL + 12;
  const H = TOP + HEAD + Y.length * CELL_H + 10;

  const on = animOn && spec.animate !== "none";
  const D = Math.min(0.45, 4.5 / n);
  const cellAt = (xi: number, yi: number) => 0.6 + (xi * Y.length + yi) * D;
  const total = cellAt(X.length - 1, Y.length - 1) + D;
  const tl = useVizTimeline(total, on);
  const a = makeAnim(on, tl.ctrl);

  const [hover, setHover] = useState<[number, number] | null>(null);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cartesian product grid" className="block w-full">
      {/* headers */}
      {X.map((x, i) => (
        <text
          key={`hx${i}`}
          x={SIDE + i * CELL + CELL / 2}
          y={TOP + HEAD - 7}
          fontSize="9"
          fontWeight={hover?.[0] === i ? 700 : 600}
          textAnchor="middle"
          fill={hover?.[0] === i ? ACCENT_DEEP : INK}
          style={{ fontFamily: MONO }}
        >
          {x}
        </text>
      ))}
      {Y.map((y, j) => (
        <text
          key={`hy${j}`}
          x={SIDE - 8}
          y={TOP + HEAD + j * CELL_H + CELL_H / 2 + 3}
          fontSize="9"
          fontWeight={hover?.[1] === j ? 700 : 600}
          textAnchor="end"
          fill={hover?.[1] === j ? ACCENT_DEEP : INK}
          style={{ fontFamily: MONO }}
        >
          {y}
        </text>
      ))}
      <text x={SIDE - 8} y={TOP + HEAD - 7} fontSize="7.5" textAnchor="end" fill={INK_FAINT}
        style={{ fontFamily: MONO }}>
        Y \ X
      </text>
      {/* frame rules */}
      <line x1={SIDE - 2} y1={TOP + HEAD - 2} x2={SIDE + X.length * CELL + 2} y2={TOP + HEAD - 2}
        stroke={LINE} strokeWidth="1" />
      <line x1={SIDE - 2} y1={TOP + HEAD - 2} x2={SIDE - 2} y2={TOP + HEAD + Y.length * CELL_H + 2}
        stroke={LINE} strokeWidth="1" />

      <g key={tl.key}>
        {/* cells fill in sequence */}
        {X.map((x, i) =>
          Y.map((y, j) => {
            const hot = hover?.[0] === i || hover?.[1] === j;
            return (
              <g key={`c${i}-${j}`} style={a.pop(cellAt(i, j))}>
                <rect
                  x={SIDE + i * CELL + 2}
                  y={TOP + HEAD + j * CELL_H + 2}
                  width={CELL - 4}
                  height={CELL_H - 4}
                  rx={4}
                  fill={hot ? "var(--accent-wash)" : CARD}
                  stroke={hot ? ACCENT : LINE_SOFT}
                  strokeWidth="1"
                  style={{ transition: "fill 0.15s, stroke 0.15s" }}
                />
                <text
                  x={SIDE + i * CELL + CELL / 2}
                  y={TOP + HEAD + j * CELL_H + CELL_H / 2 + 3}
                  fontSize="8"
                  fontWeight="600"
                  textAnchor="middle"
                  fill={hot ? ACCENT_DEEP : INK}
                  style={{ fontFamily: MONO }}
                >
                  ({x},{y})
                </text>
              </g>
            );
          })
        )}

        {/* count ticker */}
        {showCount && (
          <g>
            <text x={W - 72} y={14} fontSize="8" textAnchor="end" fill={INK_FAINT}
              style={{ fontFamily: MONO }}>
              n(X×Y) =
            </text>
            {on ? (
              <>
                {Array.from({ length: n - 1 }, (_, k) => (
                  <text
                    key={`t${k}`}
                    x={W - 66} y={14} fontSize="9.5" fontWeight="700" textAnchor="start"
                    fill={GOLD}
                    style={{
                      fontFamily: MONO,
                      animation: `viz-tick ${D}s linear ${0.6 + k * D + D * 0.75}s both`,
                    }}
                  >
                    {k + 1}
                  </text>
                ))}
                <text
                  x={W - 66} y={14} fontSize="9.5" fontWeight="700" textAnchor="start"
                  fill={ACCENT}
                  style={{
                    fontFamily: MONO,
                    animation: `viz-pop 0.4s cubic-bezier(0.22,1,0.36,1) ${cellAt(X.length - 1, Y.length - 1) + D * 0.75}s both`,
                    transformBox: "fill-box",
                    transformOrigin: "center",
                  }}
                >
                  {n} = {X.length}×{Y.length}
                </text>
              </>
            ) : (
              <text x={W - 66} y={14} fontSize="9.5" fontWeight="700" textAnchor="start"
                fill={ACCENT} style={{ fontFamily: MONO }}>
                {n} = {X.length}×{Y.length}
              </text>
            )}
          </g>
        )}
      </g>

      {/* hover hitboxes */}
      {X.map((_, i) =>
        Y.map((_, j) => (
          <rect
            key={`h${i}-${j}`}
            x={SIDE + i * CELL}
            y={TOP + HEAD + j * CELL_H}
            width={CELL}
            height={CELL_H}
            fill="transparent"
            onMouseEnter={() => setHover([i, j])}
            onMouseLeave={() => setHover(null)}
          />
        ))
      )}
    </svg>
  );
}
