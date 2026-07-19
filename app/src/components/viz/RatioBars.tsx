"use client";

/**
 * ratio_bars — proportional horizontal bars growing; ratio & variation.
 * spec: {parts:[{label,value,color?}], compare:[{label,value}]?,
 *        animate:"grow", unit?:string}
 */

import { useState } from "react";
import {
  ACCENT,
  ACCENT_DEEP,
  GOLD,
  INK,
  INK_FAINT,
  LINE_SOFT,
  MONO,
  VizError,
  arr,
  colorOf,
  fmtNum,
  makeAnim,
  num,
  obj,
  str,
  useVizTimeline,
  type VizProps,
} from "./core";

interface Bar {
  label: string;
  value: number;
  color: string;
}

function parseBars(v: unknown, fallbackColor: (i: number) => string): Bar[] {
  return arr(v).map((raw, i) => {
    const b = obj(raw);
    return {
      label: str(b.label, `#${i + 1}`),
      value: Math.max(0, num(b.value, 0)),
      color: colorOf(b.color, fallbackColor(i)),
    };
  });
}

export function RatioBars({ spec, animOn }: VizProps) {
  const parts = parseBars(spec.parts, (i) => (i % 2 === 0 ? ACCENT : GOLD));
  if (parts.length === 0) throw new VizError("ratio_bars: parts must be non-empty");
  const compare = parseBars(spec.compare, (i) => (i % 2 === 0 ? ACCENT_DEEP : GOLD));
  const unit = str(spec.unit);

  const groups: Bar[][] = compare.length > 0 ? [parts, compare] : [parts];
  const maxVal = Math.max(...groups.flat().map((b) => b.value), 1);

  /* layout */
  const W = 320;
  const LABEL_W = 118;
  const BAR_H = 15;
  const ROW = 27;
  const GAP = 16; // between groups
  const rows = parts.length + compare.length;
  const H = 12 + rows * ROW + (compare.length ? GAP : 0) + 6;
  // reserve room for the widest value label so it never clips
  const unitStr = unit ? ` ${unit}` : "";
  const widestValue = Math.max(
    ...groups.flat().map((b) => (fmtNum(b.value) + unitStr).length)
  );
  const barMax = W - LABEL_W - 14 - Math.min(96, widestValue * 5.2 + 8);

  const on = animOn && spec.animate !== "none";
  const delayOf = (gi: number, i: number) =>
    0.35 + (gi * parts.length + i) * 0.4;
  const total = delayOf(groups.length - 1, groups[groups.length - 1].length - 1) + 0.8;
  const tl = useVizTimeline(total, on);
  const a = makeAnim(on, tl.ctrl);

  const [hover, setHover] = useState<string | null>(null);

  let y = 12;
  const rowsOut: React.ReactNode[] = [];
  const hitboxes: React.ReactNode[] = [];
  groups.forEach((group, gi) => {
    if (gi > 0) {
      rowsOut.push(
        <line
          key={`div${gi}`}
          x1={10} y1={y + GAP / 2 - 4} x2={W - 10} y2={y + GAP / 2 - 4}
          stroke={LINE_SOFT} strokeWidth="1" strokeDasharray="4 4"
        />
      );
      y += GAP;
    }
    group.forEach((b, i) => {
      const key = `${gi}-${i}`;
      const w = Math.max(2, (b.value / maxVal) * barMax);
      const d = delayOf(gi, i);
      const hot = hover === key;
      const yy = y;
      rowsOut.push(
        <g key={key}>
          <text
            x={LABEL_W - 8}
            y={yy + BAR_H / 2 + 3}
            fontSize="8"
            textAnchor="end"
            fill={hot ? ACCENT_DEEP : INK}
            fontWeight={hot ? 700 : 500}
            style={{ fontFamily: MONO }}
          >
            {b.label.length > 22 ? `${b.label.slice(0, 21)}…` : b.label}
          </text>
          {/* faint track */}
          <rect x={LABEL_W} y={yy} width={barMax} height={BAR_H} rx={BAR_H / 2}
            fill="var(--ink)" opacity="0.05" />
          <rect
            x={LABEL_W}
            y={yy}
            width={w}
            height={BAR_H}
            rx={BAR_H / 2}
            fill={b.color}
            opacity={hot ? 1 : 0.88}
            style={a.grow(d, "x")}
          />
          <text
            x={LABEL_W + w + 6}
            y={yy + BAR_H / 2 + 3}
            fontSize="8.5"
            fontWeight="700"
            fill={hot ? ACCENT_DEEP : INK_FAINT}
            style={{ fontFamily: MONO, ...a.fade(d + 0.5, 0.4) }}
          >
            {fmtNum(b.value)}
            {unit ? ` ${unit}` : ""}
          </text>
        </g>
      );
      hitboxes.push(
        <rect
          key={`h${key}`}
          x={0} y={yy - 4} width={W} height={ROW}
          fill="transparent"
          onMouseEnter={() => setHover(key)}
          onMouseLeave={() => setHover(null)}
        />
      );
      y += ROW;
    });
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="ratio bars" className="block w-full">
      <g key={tl.key}>{rowsOut}</g>
      {hitboxes}
    </svg>
  );
}
