"use client";

/**
 * number_line — points/intervals sweeping onto a line.
 * spec: {range:[min,max], points:[{x,label?}], intervals:[{from,to,open?}]?,
 *        animate:"sweep"}
 * Labels containing ✓ tint viridian, ✗ tint rust (the seed files use both).
 */

import {
  ACCENT,
  ACCENT_DEEP,
  INK,
  INK_FAINT,
  MONO,
  RUST,
  VizError,
  arr,
  fmtNum,
  makeAnim,
  niceStep,
  num,
  obj,
  range2,
  str,
  useVizTimeline,
  type VizProps,
} from "./core";

export function NumberLine({ spec, animOn }: VizProps) {
  const points = arr(spec.points)
    .map((raw) => {
      const p = obj(raw);
      return { x: num(p.x, NaN), label: str(p.label) };
    })
    .filter((p) => Number.isFinite(p.x));
  const intervals = arr(spec.intervals)
    .map((raw) => {
      const iv = obj(raw);
      return { from: num(iv.from, NaN), to: num(iv.to, NaN), open: iv.open === true };
    })
    .filter((iv) => Number.isFinite(iv.from) && Number.isFinite(iv.to) && iv.from < iv.to);
  if (points.length === 0 && intervals.length === 0)
    throw new VizError("number_line: needs points or intervals");

  // range: spec wins, else fit the content
  const xsAll = [...points.map((p) => p.x), ...intervals.flatMap((iv) => [iv.from, iv.to])];
  const fitLo = Math.min(...xsAll);
  const fitHi = Math.max(...xsAll);
  const slack = Math.max((fitHi - fitLo) * 0.1, 1);
  const [r0, r1] = range2(spec.range, [fitLo - slack, fitHi + slack]);

  const W = 320;
  const PAD = 22;
  const LINE_Y = 62;
  const H = 108;
  const sx = (x: number) => PAD + ((x - r0) / (r1 - r0)) * (W - 2 * PAD);
  const step = niceStep(r1 - r0);
  const ticks: number[] = [];
  for (let t = Math.ceil(r0 / step) * step; t <= r1 + 1e-9; t += step)
    ticks.push(Math.round(t * 1e6) / 1e6);

  const on = animOn && spec.animate !== "none";
  const sorted = [...points].sort((p, q) => p.x - q.x);
  const ptAt = (i: number) => 0.5 + intervals.length * 0.7 + i * 0.45;
  const total = ptAt(sorted.length) + 0.6;
  const tl = useVizTimeline(total, on);
  const a = makeAnim(on, tl.ctrl);

  const tone = (label: string) =>
    label.includes("✗") ? RUST : label.includes("✓") ? ACCENT_DEEP : INK;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="number line" className="block w-full">
      {/* the line with arrowheads */}
      <line x1={8} y1={LINE_Y} x2={W - 8} y2={LINE_Y} stroke={INK} strokeOpacity="0.65" strokeWidth="1.3" />
      <path d={`M ${W - 8} ${LINE_Y} l -6 -3 v 6 z`} fill={INK} fillOpacity="0.65" />
      <path d={`M 8 ${LINE_Y} l 6 -3 v 6 z`} fill={INK} fillOpacity="0.65" />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={sx(t)} y1={LINE_Y - 3.5} x2={sx(t)} y2={LINE_Y + 3.5} stroke={INK} strokeOpacity="0.5" strokeWidth="1" />
          <text x={sx(t)} y={LINE_Y + 15} fontSize="7" textAnchor="middle" fill={INK_FAINT}
            style={{ fontFamily: MONO }}>
            {fmtNum(t)}
          </text>
        </g>
      ))}

      <g key={tl.key}>
        {/* intervals sweep on as bands above the line */}
        {intervals.map((iv, i) => {
          const x0 = Math.max(sx(iv.from), 8);
          const x1 = Math.min(sx(iv.to), W - 8);
          const y = LINE_Y - 12 - i * 12;
          return (
            <g key={`iv${i}`}>
              <rect
                x={x0} y={y - 4} width={Math.max(x1 - x0, 2)} height={8} rx={4}
                fill={ACCENT} opacity={0.22 - i * 0.04}
                style={a.grow(0.5 + i * 0.7, "x")}
              />
              {/* endpoint markers */}
              <circle cx={x0} cy={y} r="3" fill={iv.open ? "var(--card)" : ACCENT}
                stroke={ACCENT} strokeWidth="1.4" style={a.pop(0.5 + i * 0.7 + 0.45)} />
              <circle cx={x1} cy={y} r="3" fill={iv.open ? "var(--card)" : ACCENT}
                stroke={ACCENT} strokeWidth="1.4" style={a.pop(0.5 + i * 0.7 + 0.55)} />
            </g>
          );
        })}

        {/* points drop onto the line, labels alternating above/below */}
        {sorted.map((p, i) => {
          const above = i % 2 === 0;
          const lift = above ? intervals.length * 12 : 0; // clear the bands
          const c = tone(p.label);
          const d = ptAt(i);
          return (
            <g key={`p${i}`}>
              <g style={a.pop(d)}>
                <circle cx={sx(p.x)} cy={LINE_Y} r="5.5" fill={c} opacity="0.2" />
                <circle cx={sx(p.x)} cy={LINE_Y} r="2.8" fill={c} />
              </g>
              {p.label !== "" && (
                <g style={a.fade(d + 0.2, 0.35)}>
                  <line
                    x1={sx(p.x)} y1={above ? LINE_Y - 6 : LINE_Y + 6}
                    x2={sx(p.x)} y2={above ? LINE_Y - 20 - lift : LINE_Y + 20}
                    stroke={c} strokeWidth="0.8" opacity="0.5"
                  />
                  <text
                    x={sx(p.x)} y={above ? LINE_Y - 24 - lift : LINE_Y + 30}
                    fontSize="7.5" fontWeight="600" textAnchor="middle" fill={c}
                    style={{ fontFamily: MONO }}
                  >
                    {p.label}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
