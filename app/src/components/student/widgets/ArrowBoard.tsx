"use client";

/**
 * The arrow-diagram drawing board: two columns of set elements; the student
 * taps an element of X, then where it goes in Y, and an arrow is drawn (a
 * drawn arrow is tapped again to take it away). After grading, the student's
 * own arrows stay where they drew them — right ones in the correct ink, wrong
 * ones grey and dashed — and, on `reveal`, the arrows they missed draw
 * themselves in.
 *
 * Shared by the `arrow_builder` widget and the arrow-diagram figure task
 * (InteractiveFigure ArrowsStep), so a diagram is drawn the same way wherever
 * a student meets one. Arrows are [index in X, index in Y].
 */

import { useState } from "react";
import { cx } from "@/components/sticker";
import { FIGURE_MARK } from "./WidgetShell";
import { useReducedMotion } from "./drag";
import { FigureSvg } from "@/components/viz/figure-svg";

const AW = 300;
const AROW = 44; // a 52px finger target at the board's width
const PILL_H = 30;
const COL_W = 92;
const X_COL = 14;
const Y_COL = AW - 14 - COL_W;
const HEAD = 22;

export type IArrow = [number, number];
const same = (a: IArrow, b: IArrow) => a[0] === b[0] && a[1] === b[1];

export function ArrowBoard({
  X,
  Y,
  drawn,
  onToggle,
  graded,
  reveal,
  yName = "Y",
}: {
  X: string[];
  Y: string[];
  drawn: IArrow[];
  /** add or remove one arrow; absent once graded */
  onToggle?: (a: IArrow) => void;
  /** after the check: which drawn arrows are wrong, and which were missed */
  graded?: { extra: IArrow[]; missed: IArrow[] } | null;
  /** draw the missed arrows in */
  reveal?: boolean;
  /** the right column's name: "X" for a relation on X */
  yName?: string;
}) {
  const reduced = useReducedMotion();
  const [from, setFrom] = useState<number | null>(null);
  const live = !!onToggle && !graded;

  const rows = Math.max(X.length, Y.length);
  const H = HEAD + rows * AROW + 8;
  const cy = (len: number, i: number) => HEAD + ((rows - len) * AROW) / 2 + i * AROW + AROW / 2;
  const x1 = X_COL + COL_W + 3;
  const x2 = Y_COL - 5;
  const curve = ([i, j]: IArrow) => {
    const ya = cy(X.length, i), yb = cy(Y.length, j), mx = (x1 + x2) / 2;
    return `M ${x1} ${ya} C ${mx} ${ya}, ${mx} ${yb}, ${x2} ${yb}`;
  };
  const tapX = (i: number) => live && setFrom((f) => (f === i ? null : i));
  const tapY = (j: number) => {
    if (!live || from === null) return;
    onToggle!([from, j]);
    setFrom(null);
  };

  const arrow = (a: IArrow, ink: "draft" | "hit" | "extra" | "missed", k: number) => {
    const stroke = ink === "draft" ? "var(--accent)" : ink === "extra" ? FIGURE_MARK.wrong : FIGURE_MARK.correct;
    const dashed = ink === "extra" || ink === "missed";
    const animate = ink === "missed" && !reduced;
    return (
      <g key={`${ink}${a[0]}-${a[1]}`}>
        <path
          d={curve(a)}
          fill="none"
          stroke={stroke}
          strokeWidth={ink === "extra" ? 1.4 : 2}
          strokeDasharray={dashed && !animate ? "4 3" : undefined}
          pathLength={animate ? 100 : undefined}
          style={animate ? { strokeDasharray: 100, animation: `viz-draw 0.8s cubic-bezier(0.4,0,0.2,1) ${0.3 + k * 0.45}s both` } : undefined}
        />
        <path
          d={`M ${x2 + 1} ${cy(Y.length, a[1])} l -6 -3 v 6 z`}
          fill={stroke}
          style={animate ? { animation: `viz-fade 0.2s ease ${0.3 + k * 0.45 + 0.7}s both` } : undefined}
        />
        {/* a fat invisible stroke so a drawn arrow can be tapped away */}
        {ink === "draft" && live && (
          <path d={curve(a)} fill="none" stroke="transparent" strokeWidth={14} className="cursor-pointer" onClick={() => onToggle!(a)} />
        )}
      </g>
    );
  };

  const pill = (set: string[], i: number, side: "X" | "Y") => {
    const x = side === "X" ? X_COL : Y_COL;
    const y = cy(set.length, i);
    const picked = side === "X" && from === i;
    const tappable = live && (side === "X" || from !== null);
    return (
      <g
        key={`${side}${i}`}
        role="button"
        tabIndex={tappable ? 0 : -1}
        aria-pressed={side === "X" ? picked : undefined}
        aria-label={side === "X" ? (picked ? `${set[i]} in X, selected: now pick where it goes` : `Start an arrow from ${set[i]}`)
          : from !== null ? `Arrow from ${X[from]} to ${set[i]}` : `${set[i]} in ${yName}`}
        onClick={() => (side === "X" ? tapX(i) : tapY(i))}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          if (side === "X") tapX(i);
          else tapY(i);
        }}
        className={cx("group focus-visible:outline-none", tappable && "cursor-pointer")}
      >
        {/* the full row is the target, not the 30px pill */}
        <rect x={x - 6} y={y - AROW / 2} width={COL_W + 12} height={AROW} fill="transparent" />
        <rect x={x} y={y - PILL_H / 2} width={COL_W} height={PILL_H} rx={PILL_H / 2}
          fill={picked ? "var(--card-warm)" : "var(--card)"} stroke={picked ? "var(--ink)" : "var(--line)"}
          strokeWidth={picked ? 2 : 1} />
        <rect x={x - 3} y={y - PILL_H / 2 - 3} width={COL_W + 6} height={PILL_H + 6} rx={PILL_H / 2 + 3}
          fill="none" stroke="var(--gold)" strokeWidth={2} className="opacity-0 group-focus-visible:opacity-100" />
        <text x={x + COL_W / 2} y={y + 4} className="fig-label" fontWeight="600" textAnchor="middle" fill="var(--ink)"
          style={{ fontFamily: "var(--stack-mono)" }}>
          {set[i]}
        </text>
      </g>
    );
  };

  return (
    <FigureSvg viewBox={`0 0 ${AW} ${H}`} className="block w-full" role="group" aria-label="Arrow diagram you draw">
      <text x={X_COL + COL_W / 2} y={HEAD - 8} className="fig-label" fontWeight="600" textAnchor="middle"
        fill="var(--accent-deep)" style={{ fontFamily: "var(--stack-mono)" }}>X</text>
      <text x={Y_COL + COL_W / 2} y={HEAD - 8} className="fig-label" fontWeight="600" textAnchor="middle"
        fill="var(--accent-deep)" style={{ fontFamily: "var(--stack-mono)" }}>{yName}</text>
      {drawn.map((a, k) => arrow(a, graded ? (graded.extra.some((b) => same(a, b)) ? "extra" : "hit") : "draft", k))}
      {reveal && graded && graded.missed.map((a, k) => arrow(a, "missed", k))}
      {X.map((_, i) => pill(X, i, "X"))}
      {Y.map((_, j) => pill(Y, j, "Y"))}
    </FigureSvg>
  );
}
