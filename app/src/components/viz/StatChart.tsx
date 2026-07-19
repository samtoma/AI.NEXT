"use client";

/**
 * stat_chart — bar / sector (donut) / dot-plot with grow-in animation.
 * spec: {type:"bar"|"sector"|"dots", data:[{label,value}], animate:"grow",
 *        meanLine?:number}
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
  SERIES,
  VizError,
  arr,
  fmtNum,
  makeAnim,
  num,
  obj,
  str,
  useVizTimeline,
  type VizProps,
} from "./core";

interface Datum {
  label: string;
  value: number;
}

export function StatChart({ spec, animOn }: VizProps) {
  const data: Datum[] = arr(spec.data).map((raw, i) => {
    const d = obj(raw);
    return { label: str(d.label, `#${i + 1}`), value: Math.max(0, num(d.value, 0)) };
  });
  if (data.length === 0) throw new VizError("stat_chart: data must be non-empty");
  const type = spec.type === "sector" || spec.type === "dots" ? spec.type : "bar";
  const meanLine = Number.isFinite(num(spec.meanLine, NaN)) ? num(spec.meanLine) : null;
  const on = animOn && spec.animate !== "none";

  if (type === "sector") return <Sector data={data} on={on} />;
  if (type === "dots") return <Dots data={data} on={on} meanLine={meanLine} />;
  return <Bars data={data} on={on} meanLine={meanLine} />;
}

/* ---------------- vertical bars ---------------- */

function Bars({ data, on, meanLine }: { data: Datum[]; on: boolean; meanLine: number | null }) {
  const W = 320;
  const H = 210;
  const PAD_L = 30;
  const PAD_B = 26;
  const PAD_T = 18;
  const plotW = W - PAD_L - 12;
  const plotH = H - PAD_T - PAD_B;
  const maxV = Math.max(...data.map((d) => d.value), meanLine ?? 0, 1);
  const bw = Math.min(40, (plotW / data.length) * 0.62);
  const cx = (i: number) => PAD_L + (plotW / data.length) * (i + 0.5);
  const hOf = (v: number) => (v / maxV) * plotH;

  const meanAt = 0.4 + data.length * 0.3 + 0.3;
  const tl = useVizTimeline(meanAt + 0.9, on);
  const a = makeAnim(on, tl.ctrl);
  const [hover, setHover] = useState<number | null>(null);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="bar chart" className="block w-full">
      {/* baseline + faint rules */}
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={PAD_L} y1={H - PAD_B - plotH * f} x2={W - 12} y2={H - PAD_B - plotH * f}
          stroke={LINE_SOFT} strokeWidth="1" />
      ))}
      <line x1={PAD_L} y1={H - PAD_B} x2={W - 12} y2={H - PAD_B} stroke={INK} strokeOpacity="0.5" strokeWidth="1.2" />
      <text x={PAD_L - 4} y={PAD_T + 3} fontSize="6.5" textAnchor="end" fill={INK_FAINT} style={{ fontFamily: MONO }}>
        {fmtNum(maxV)}
      </text>

      <g key={tl.key}>
        {data.map((d, i) => {
          const hot = hover === i;
          const del = 0.4 + i * 0.3;
          return (
            <g key={i}>
              <rect
                x={cx(i) - bw / 2}
                y={H - PAD_B - hOf(d.value)}
                width={bw}
                height={Math.max(1.5, hOf(d.value))}
                rx={3}
                fill={hot ? ACCENT_DEEP : ACCENT}
                opacity={hot ? 1 : 0.85}
                style={a.grow(del, "y")}
              />
              <text
                x={cx(i)} y={H - PAD_B - hOf(d.value) - 5}
                fontSize="8" fontWeight="700" textAnchor="middle"
                fill={hot ? ACCENT_DEEP : INK_FAINT}
                style={{ fontFamily: MONO, ...a.fade(del + 0.45, 0.4) }}
              >
                {fmtNum(d.value)}
              </text>
            </g>
          );
        })}

        {meanLine != null && (
          <g>
            <line
              x1={PAD_L} y1={H - PAD_B - hOf(meanLine)} x2={W - 12} y2={H - PAD_B - hOf(meanLine)}
              stroke={GOLD} strokeWidth="1.4" strokeDasharray="5 4"
              pathLength={100}
              style={{ ...a.draw(meanAt, 0.7), strokeDasharray: on ? undefined : "5 4" }}
            />
            <text
              x={W - 12} y={H - PAD_B - hOf(meanLine) - 5}
              fontSize="7.5" fontWeight="700" textAnchor="end" fill={GOLD}
              style={{ fontFamily: MONO, ...a.fade(meanAt + 0.5) }}
            >
              mean = {fmtNum(meanLine)}
            </text>
          </g>
        )}
      </g>

      {/* x labels + hitboxes (static) */}
      {data.map((d, i) => (
        <g key={`l${i}`}>
          <text
            x={cx(i)} y={H - PAD_B + 12} fontSize="7.5" textAnchor="middle"
            fill={hover === i ? ACCENT_DEEP : INK} fontWeight={hover === i ? 700 : 500}
            style={{ fontFamily: MONO }}
          >
            {d.label.length > 11 ? `${d.label.slice(0, 10)}…` : d.label}
          </text>
          <rect
            x={cx(i) - (plotW / data.length) / 2} y={PAD_T} width={plotW / data.length} height={H - PAD_T}
            fill="transparent"
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
          />
        </g>
      ))}
    </svg>
  );
}

/* ---------------- sector (donut) ---------------- */

function Sector({ data, on }: { data: Datum[]; on: boolean }) {
  const W = 320;
  const H = 190;
  const CX = 92;
  const CY = H / 2;
  const R = 62;
  const total = data.reduce((s, d) => s + d.value, 0) || 1;

  const tl = useVizTimeline(0.5 + data.length * 0.55 + 0.6, on);
  const a = makeAnim(on, tl.ctrl);
  const [hover, setHover] = useState<number | null>(null);

  const polar = (deg: number, r: number): [number, number] => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [CX + r * Math.cos(rad), CY + r * Math.sin(rad)];
  };

  let acc = 0;
  const arcs = data.map((d, i) => {
    const a0 = (acc / total) * 360;
    acc += d.value;
    const a1 = (acc / total) * 360;
    const sweep = Math.min(a1 - a0, 359.9);
    const [x0, y0] = polar(a0, R);
    const [x1, y1] = polar(a0 + sweep, R);
    const large = sweep > 180 ? 1 : 0;
    return {
      d,
      i,
      frac: d.value / total,
      mid: a0 + sweep / 2,
      path: `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    };
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="sector chart" className="block w-full">
      {/* faint full ring */}
      <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--ink)" strokeOpacity="0.06" strokeWidth={26} />

      <g key={tl.key}>
        {arcs.map((s) => (
          <path
            key={s.i}
            d={s.path}
            fill="none"
            stroke={SERIES[s.i % SERIES.length]}
            strokeWidth={hover === s.i ? 30 : 26}
            opacity={hover === null || hover === s.i ? 0.9 : 0.35}
            pathLength={100}
            style={{ ...a.draw(0.5 + s.i * 0.55, 0.6), transition: "stroke-width 0.15s, opacity 0.2s" }}
          />
        ))}
        {/* center count */}
        <text x={CX} y={CY + 4} fontSize="11" fontWeight="700" textAnchor="middle" fill={INK}
          style={{ fontFamily: MONO, ...a.fade(0.3) }}>
          {fmtNum(total)}
        </text>

        {/* legend */}
        {arcs.map((s) => {
          const y = CY - ((data.length - 1) * 20) / 2 + s.i * 20;
          return (
            <g key={`lg${s.i}`} style={a.fade(0.6 + s.i * 0.55, 0.4)}>
              <rect x={178} y={y - 5} width={9} height={9} rx={2.5} fill={SERIES[s.i % SERIES.length]} />
              <text x={192} y={y + 3} fontSize="8" fill={hover === s.i ? ACCENT_DEEP : INK}
                fontWeight={hover === s.i ? 700 : 500} style={{ fontFamily: MONO }}>
                {s.d.label.length > 15 ? `${s.d.label.slice(0, 14)}…` : s.d.label}
              </text>
              <text x={W - 10} y={y + 3} fontSize="8" fontWeight="700" textAnchor="end" fill={INK_FAINT}
                style={{ fontFamily: MONO }}>
                {Math.round(s.frac * 100)}%
              </text>
            </g>
          );
        })}
      </g>

      {/* hitboxes on legend rows */}
      {arcs.map((s) => {
        const y = CY - ((data.length - 1) * 20) / 2 + s.i * 20;
        return (
          <rect key={`h${s.i}`} x={172} y={y - 9} width={W - 180} height={18} fill="transparent"
            onMouseEnter={() => setHover(s.i)} onMouseLeave={() => setHover(null)} />
        );
      })}
    </svg>
  );
}

/* ---------------- dot plot ---------------- */

function Dots({ data, on, meanLine }: { data: Datum[]; on: boolean; meanLine: number | null }) {
  const W = 320;
  const maxCount = Math.max(...data.map((d) => Math.round(d.value)), 1);
  if (maxCount > 24) throw new VizError("stat_chart dots: counts too large for a dot plot");
  const RDOT = 5;
  const PAD_B = 24;
  const H = Math.max(120, maxCount * (RDOT * 2 + 3) + PAD_B + 20);
  const cx = (i: number) => 30 + ((W - 60) / Math.max(data.length - 1, 1)) * i;

  // numeric labels → mean line lives on the label axis
  const numericLabels = data.map((d) => Number(d.label));
  const labelsNumeric = numericLabels.every((v) => Number.isFinite(v));
  let meanX: number | null = null;
  if (meanLine != null && labelsNumeric && data.length > 1) {
    const lo = Math.min(...numericLabels);
    const hi = Math.max(...numericLabels);
    if (hi > lo && meanLine >= lo && meanLine <= hi) {
      // interpolate position across the categorical slots by numeric value
      const t = (meanLine - lo) / (hi - lo);
      meanX = 30 + (W - 60) * t;
    }
  }

  let seq = 0;
  const totalDots = data.reduce((s, d) => s + Math.round(d.value), 0);
  const D = Math.min(0.35, 3.5 / Math.max(totalDots, 1));
  const tl = useVizTimeline(0.4 + totalDots * D + 1.2, on);
  const a = makeAnim(on, tl.ctrl);
  const [hover, setHover] = useState<number | null>(null);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="dot plot" className="block w-full">
      <line x1={16} y1={H - PAD_B} x2={W - 16} y2={H - PAD_B} stroke={INK} strokeOpacity="0.5" strokeWidth="1.2" />

      <g key={tl.key}>
        {data.map((d, i) => {
          const count = Math.round(d.value);
          return Array.from({ length: count }, (_, k) => {
            const del = 0.4 + seq++ * D;
            return (
              <circle
                key={`${i}-${k}`}
                cx={cx(i)}
                cy={H - PAD_B - 8 - k * (RDOT * 2 + 3)}
                r={RDOT}
                fill={hover === i ? ACCENT_DEEP : ACCENT}
                opacity={hover === null || hover === i ? 0.85 : 0.35}
                style={a.pop(del)}
              />
            );
          });
        })}

        {meanX != null && (
          <g>
            <line
              x1={meanX} y1={16} x2={meanX} y2={H - PAD_B}
              stroke={GOLD} strokeWidth="1.4" strokeDasharray="5 4"
              pathLength={100}
              style={{ ...a.draw(0.4 + totalDots * D + 0.3, 0.6), strokeDasharray: on ? undefined : "5 4" }}
            />
            <text x={meanX + 4} y={14} fontSize="7.5" fontWeight="700" fill={GOLD} style={{ fontFamily: MONO }}>
              mean = {fmtNum(meanLine!)}
            </text>
          </g>
        )}
      </g>

      {data.map((d, i) => (
        <g key={`l${i}`}>
          <text x={cx(i)} y={H - PAD_B + 13} fontSize="8" textAnchor="middle"
            fill={hover === i ? ACCENT_DEEP : INK} fontWeight={hover === i ? 700 : 500}
            style={{ fontFamily: MONO }}>
            {d.label}
          </text>
          <rect x={cx(i) - 14} y={10} width={28} height={H - 10} fill="transparent"
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        </g>
      ))}
    </svg>
  );
}
