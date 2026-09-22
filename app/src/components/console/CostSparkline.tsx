/**
 * One student's daily imputed cost over the period, drawn small.
 *
 * Inline SVG, **design tokens only**, no charting library and no client
 * JavaScript — the same reasoning `Sparkline` (the BKT trajectory) states: one
 * of these per row on a page that may carry two hundred rows, to draw a
 * polyline over thirty points.
 *
 * ---------------------------------------------------------------------------
 * THE SCALE IS SHARED ACROSS THE TABLE, AND THAT IS THE WHOLE POINT
 * ---------------------------------------------------------------------------
 * A per-row auto-scaled sparkline is the classic way to make a cost table lie:
 * the child who cost two cents and the child who cost two dollars both get a
 * line from floor to ceiling, and the eye compares the shapes. So every row is
 * drawn against the SAME ceiling — the highest single day any student had in
 * the period — and the ceiling is printed once above the column. A row that
 * hugs the floor really did cost almost nothing.
 *
 * Colour carries no verdict. An expensive student is not a bad one, and the
 * console has no red in it (constitution XII): the line is the accent ink like
 * every other line, and the state is in the numbers beside it.
 *
 * **Today is drawn differently** — a hollow marker on the last point — because
 * today's figure comes from a live query over a day that is not over. A solid
 * dot would claim a finished day.
 */

import type { SeriesPoint } from "@/lib/cost-model";

const W = 108;
const H = 24;
const PAD = 2;

export function CostSparkline({
  points,
  ceilingUsd,
  label,
}: {
  /** The period's whole axis, oldest first — `denseSeries` output. */
  points: readonly SeriesPoint[];
  /** The largest single-day figure anywhere in the table. Shared by every row. */
  ceilingUsd: number;
  /** Read to a screen reader in place of the drawing. */
  label: string;
}) {
  if (points.length === 0) return null;

  // A flat floor when nothing was spent anywhere: dividing by zero would put
  // every line at the top, which reads as "everyone spent the maximum".
  const top = ceilingUsd > 0 ? ceilingUsd : 1;
  const y = (usd: number) => PAD + (1 - Math.min(1, Math.max(0, usd / top))) * (H - 2 * PAD);
  const x = (i: number) =>
    points.length === 1 ? W / 2 : PAD + (i / (points.length - 1)) * (W - 2 * PAD);

  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.costUsd).toFixed(1)}`)
    .join(" ");
  const lastIndex = points.length - 1;
  const last = points[lastIndex]!;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      role="img"
      aria-label={label}
      className="shrink-0 overflow-visible"
    >
      {/* The shared ceiling and the zero floor, so the reader can see the line
          is not auto-scaled to its own row. */}
      <line x1={0} y1={y(top)} x2={W} y2={y(top)} className="stroke-line-soft" strokeWidth={1} />
      <line x1={0} y1={y(0)} x2={W} y2={y(0)} className="stroke-line-soft" strokeWidth={1} />
      {points.length > 1 && (
        <path d={d} fill="none" className="stroke-accent" strokeWidth={1.5} strokeLinejoin="round" />
      )}
      {last.live ? (
        // Hollow: today is not over, and the figure is a live query rather
        // than a stored day.
        <circle
          cx={x(lastIndex)}
          cy={y(last.costUsd)}
          r={2.5}
          fill="none"
          className="stroke-accent"
          strokeWidth={1.5}
        />
      ) : (
        <circle cx={x(lastIndex)} cy={y(last.costUsd)} r={2} className="fill-accent" />
      )}
    </svg>
  );
}
