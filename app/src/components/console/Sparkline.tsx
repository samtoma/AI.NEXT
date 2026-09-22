/**
 * A BKT trajectory, drawn from the bitemporal rows that already exist
 * (contracts/admin.md §2 — "free: `mastery` is bitemporal, plot `score` by
 * `system_from`").
 *
 * Inline SVG, no charting library, no client JavaScript. The console is an
 * internal tool for three founders and one of these appears per objective on a
 * page that may carry ninety of them; a charting library would be ~50 KB and a
 * hydration boundary each to draw a polyline over eight points.
 *
 * **The axis is fixed at 0…1 and labelled.** An auto-scaled sparkline is the
 * classic way to make a trajectory lie: a student who moved from 0.42 to 0.44
 * and one who moved from 0.1 to 0.9 both get a line from floor to ceiling, and
 * the reader compares the shapes. The band is therefore the full probability
 * range every time, and the first and last values are printed beside it so the
 * figure is readable without the picture.
 *
 * Colour is a token and carries no verdict. A trajectory is not good or bad —
 * it is where a fourteen-year-old currently is — so it is drawn in the accent
 * ink like any other line, with no red anywhere in the console (constitution
 * XII, and the same no-red rule the student surface holds itself to).
 */

export type SparkPoint = { at: string; score: number };

const W = 96;
const H = 22;
const PAD = 1.5;

export function Sparkline({
  points,
  label,
}: {
  points: readonly SparkPoint[];
  /** Read to a screen reader in place of the drawing. */
  label: string;
}) {
  if (points.length === 0) return null;

  // One point is a dot, not a line: drawing a flat segment would assert a
  // period of stability that was never observed.
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const y = (score: number) => PAD + (1 - clamp(score)) * (H - 2 * PAD);
  const x = (i: number) =>
    points.length === 1 ? W / 2 : PAD + (i / (points.length - 1)) * (W - 2 * PAD);

  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.score).toFixed(1)}`).join(" ");
  const last = points[points.length - 1]!;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      role="img"
      aria-label={label}
      className="shrink-0 overflow-visible"
    >
      {/* The 0…1 band, so the reader can see the line is not auto-scaled. */}
      <line x1={0} y1={y(1)} x2={W} y2={y(1)} className="stroke-line-soft" strokeWidth={1} />
      <line x1={0} y1={y(0)} x2={W} y2={y(0)} className="stroke-line-soft" strokeWidth={1} />
      {points.length > 1 && (
        <path d={d} fill="none" className="stroke-accent" strokeWidth={1.5} strokeLinejoin="round" />
      )}
      <circle cx={x(points.length - 1)} cy={y(last.score)} r={2} className="fill-accent" />
    </svg>
  );
}
