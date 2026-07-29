"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SpineBridge, SpineLo, SpineSubject } from "@/lib/types";
import {
  SPINE_SUBJECT_KEYS,
  compareSpineSubjects,
  spineSubjectDef,
} from "@/lib/subjects";
import { masteryColor, pct } from "@/lib/mastery";

export type AsOf = "baseline" | "today";

const NODE_H = 106;
const MIN_W = 118;
const MAX_W = 198;
const GAP_MIN = 26;
const PAD = 10;
const ARC_HEADROOM = 96; // room above the first band for long-span prereq arcs
const BAND_LABEL_H = 34; // vertical room for a territory's label strip
const BAND_GAP = 58; // vertical gap between territories
const ROW_SPREAD = NODE_H + 34; // vertical spacing of stacked nodes in a column

/**
 * Territory order, labels and accents come from the subject registry — this
 * file used to carry its own two-entry copy of them (Wave 1.5). `null` is a
 * real band: LOs whose course is not in the registry are UNFILED and get their
 * own neutral territory instead of being drawn inside maths'.
 */
type BandKey = SpineSubject | null;

const UNFILED_BAND = {
  label: "غير مصنّف · unfiled",
  accent: "var(--ink-faint)",
  wash: "transparent",
  line: "var(--line)",
};

function bandMetaOf(key: BandKey) {
  const def = spineSubjectDef(key);
  return def
    ? {
        label: def.labelAr,
        accent: def.accent.color,
        wash: def.accent.wash,
        line: def.accent.line,
      }
    : UNFILED_BAND;
}

/** Registry order, with the unfiled band last. */
const BAND_ORDER: BandKey[] = [...SPINE_SUBJECT_KEYS, null];

interface Placed {
  lo: SpineLo;
  x: number;
  y: number; // top
  cy: number; // center
}

interface Band {
  subject: BandKey;
  yTop: number;
  yBottom: number;
}

/** Lay out one subject's LOs (barycentric, layered) in local band coordinates
 *  starting at cy=0. Prerequisite layout runs strictly WITHIN the territory. */
function layoutBand(group: SpineLo[], nLayers: number, xOf: (l: number) => number) {
  const byLayer: SpineLo[][] = Array.from({ length: nLayers }, () => []);
  for (const lo of group) byLayer[lo.layer]?.push(lo);
  const maxCount = Math.max(1, ...byLayer.map((c) => c.length));
  const bandH = maxCount * ROW_SPREAD;
  const midY = bandH / 2;

  const centers = new Map<string, number>();
  const placed: Placed[] = [];
  for (let layer = 0; layer < nLayers; layer++) {
    const col = byLayer[layer];
    if (col.length === 0) continue;
    const bary = (lo: SpineLo) => {
      const preds = lo.prereqIds
        .map((p) => centers.get(p))
        .filter((v): v is number => v !== undefined);
      return preds.length ? preds.reduce((a, b) => a + b, 0) / preds.length : midY;
    };
    col.sort((a, b) => bary(a) - bary(b) || a.orderInParent - b.orderInParent);
    const start = midY - ((col.length - 1) * ROW_SPREAD) / 2;
    col.forEach((lo, i) => {
      const cy = start + i * ROW_SPREAD;
      centers.set(lo.id, cy);
      placed.push({ lo, x: xOf(lo.layer), y: cy - NODE_H / 2, cy });
    });
  }
  return { placed, bandH };
}

function computeLayout(los: SpineLo[], width: number) {
  const nLayers = Math.max(1, Math.max(...los.map((l) => l.layer)) + 1);
  let nodeW = (width - 2 * PAD - GAP_MIN * (nLayers - 1)) / nLayers;
  nodeW = Math.max(MIN_W, Math.min(MAX_W, nodeW));
  const gap = Math.max(
    GAP_MIN,
    (width - 2 * PAD - nodeW * nLayers) / Math.max(1, nLayers - 1)
  );
  const canvasW = Math.max(width, 2 * PAD + nodeW * nLayers + gap * (nLayers - 1));
  const xOf = (layer: number) => PAD + layer * (nodeW + gap);

  const present = BAND_ORDER.filter((key) => los.some((l) => l.subject === key));

  const placed: Placed[] = [];
  const bands: Band[] = [];
  let cursor = PAD + ARC_HEADROOM;

  for (const key of present) {
    const group = los.filter((l) => l.subject === key);
    const { placed: local, bandH } = layoutBand(group, nLayers, xOf);
    const bodyTop = cursor + BAND_LABEL_H;
    for (const p of local) {
      p.cy += bodyTop;
      p.y += bodyTop;
      placed.push(p);
    }
    bands.push({ subject: key, yTop: cursor, yBottom: bodyTop + bandH });
    cursor = bodyTop + bandH + BAND_GAP;
  }

  const canvasH = Math.max(360, cursor - BAND_GAP + PAD);
  return { placed, bands, nodeW, canvasW, canvasH };
}

export function GraphCanvas({
  los,
  edges,
  bridges = [],
  asOf,
  selectedLoId,
  questionCounts,
  onSelect,
  citedIds,
  pulses,
  showTerritories = true,
}: {
  los: SpineLo[];
  edges: { src: string; dst: string }[];
  /** cross-subject associative links — rendered as dashed gold arcs */
  bridges?: SpineBridge[];
  asOf: AsOf;
  selectedLoId: string | null;
  questionCounts: Map<string, number>;
  onSelect: (id: string) => void;
  /** LOs cited by the AI in the current answer — soft viridian glow */
  citedIds?: Set<string>;
  /** id → nonce; bumping the nonce re-fires the pulse ring */
  pulses?: Record<string, number>;
  /** draw territory bands + labels (only meaningful in the "All" view) */
  showTerritories?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  const [activeBridge, setActiveBridge] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { placed, bands, nodeW, canvasW, canvasH } = useMemo(
    () => computeLayout(los, width),
    [los, width]
  );
  const posById = useMemo(
    () => new Map(placed.map((p) => [p.lo.id, p])),
    [placed]
  );
  const bandBySubject = useMemo(
    () => new Map(bands.map((b) => [b.subject, b])),
    [bands]
  );

  // only bridges whose BOTH endpoints are visible in this view
  const visibleBridges = useMemo(
    () => bridges.filter((b) => posById.has(b.src) && posById.has(b.dst)),
    [bridges, posById]
  );

  const scoreOf = (lo: SpineLo) => (asOf === "today" ? lo.current : lo.baseline);
  const bandMeta = bandMetaOf;

  return (
    <div ref={ref} className="thin-scroll overflow-x-auto">
      <div className="relative" style={{ width: canvasW, height: canvasH }}>
        {/* territory backdrops (behind everything) */}
        {showTerritories &&
          bands.map((b) => {
            const meta = bandMeta(b.subject);
            return (
              <div
                key={String(b.subject)}
                className="absolute rounded-xl"
                style={{
                  left: 4,
                  top: b.yTop,
                  width: canvasW - 8,
                  height: b.yBottom - b.yTop,
                  background: meta.wash,
                  border: `1px dashed ${meta.line}`,
                  zIndex: 0,
                }}
                aria-hidden
              />
            );
          })}

        {/* edges + bridges */}
        <svg
          className="absolute inset-0"
          width={canvasW}
          height={canvasH}
          fill="none"
          style={{ zIndex: 1 }}
          aria-hidden
        >
          <defs>
            <marker
              id="arr"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0.5 0.8 L7.2 4 L0.5 7.2" stroke="rgba(32,41,58,0.38)" strokeWidth="1.4" fill="none" />
            </marker>
            <marker
              id="arr-hot"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0.5 0.8 L7.2 4 L0.5 7.2" stroke="var(--accent)" strokeWidth="1.6" fill="none" />
            </marker>
          </defs>
          {edges.map((e, i) => {
            const s = posById.get(e.src);
            const t = posById.get(e.dst);
            if (!s || !t) return null;
            const sx = s.x + nodeW;
            const sy = s.cy;
            const tx = t.x;
            const ty = t.cy;
            const span = t.lo.layer - s.lo.layer;
            const dx = tx - sx;
            let d: string;
            if (span <= 1) {
              d = `M ${sx} ${sy} C ${sx + dx * 0.45} ${sy}, ${tx - dx * 0.45} ${ty}, ${tx} ${ty}`;
            } else {
              const bandTop = bandBySubject.get(s.lo.subject)?.yTop ?? 0;
              const arcY = Math.max(bandTop + 10, Math.min(sy, ty) - 100);
              d = `M ${sx} ${sy} C ${sx + dx * 0.22} ${arcY}, ${tx - dx * 0.22} ${arcY}, ${tx} ${ty}`;
            }
            const hot =
              selectedLoId !== null &&
              (e.src === selectedLoId || e.dst === selectedLoId);
            const dim = selectedLoId !== null && !hot;
            return (
              <path
                key={i}
                d={d}
                pathLength={1}
                stroke={hot ? "var(--accent)" : "rgba(32,41,58,0.3)"}
                strokeWidth={hot ? 2 : 1.3}
                strokeDasharray={span > 1 ? "0.015 0.008" : undefined}
                markerEnd={hot ? "url(#arr-hot)" : "url(#arr)"}
                style={{
                  opacity: dim ? 0.22 : 1,
                  transition: "opacity 0.35s ease, stroke 0.35s ease",
                }}
              />
            );
          })}

          {/* cross-subject bridges — rare dashed gold arcs spanning territories */}
          {visibleBridges.map((b, i) => {
            const a = posById.get(b.src)!;
            const z = posById.get(b.dst)!;
            // draw from the lower edge of the upper node to the top of the lower
            const [hi, lo] = a.cy <= z.cy ? [a, z] : [z, a];
            const x1 = hi.x + nodeW / 2;
            const y1 = hi.y + NODE_H;
            const x2 = lo.x + nodeW / 2;
            const y2 = lo.y;
            const my = (y1 + y2) / 2;
            const bow = Math.min(80, Math.abs(x2 - x1) * 0.25 + 24);
            const cx = (x1 + x2) / 2 + bow;
            const d = `M ${x1} ${y1} C ${cx} ${my}, ${cx} ${my}, ${x2} ${y2}`;
            const active = activeBridge === i;
            const touched =
              selectedLoId === b.src || selectedLoId === b.dst || active;
            const midx = (x1 + x2) / 2 + bow * 0.75;
            const midy = my;
            return (
              <g key={`bridge-${i}`} style={{ cursor: "pointer" }}>
                {/* wide invisible hit path */}
                <path
                  d={d}
                  stroke="transparent"
                  strokeWidth={18}
                  fill="none"
                  onMouseEnter={() => setActiveBridge(i)}
                  onClick={() => setActiveBridge(active ? null : i)}
                />
                <path
                  d={d}
                  className="anim-bridge"
                  stroke="var(--bridge-gold)"
                  strokeWidth={touched ? 2.6 : 1.8}
                  strokeDasharray="7 6"
                  fill="none"
                  strokeLinecap="round"
                  style={{
                    filter: touched
                      ? "drop-shadow(0 0 6px rgba(199,154,58,0.75))"
                      : "drop-shadow(0 0 3px rgba(199,154,58,0.45))",
                    transition: "stroke-width 0.2s ease",
                    pointerEvents: "none",
                  }}
                />
                <circle
                  cx={midx}
                  cy={midy}
                  r={touched ? 10 : 8}
                  fill="var(--card)"
                  stroke="var(--bridge-gold)"
                  strokeWidth={1.5}
                  onMouseEnter={() => setActiveBridge(i)}
                  onClick={() => setActiveBridge(active ? null : i)}
                  style={{ transition: "r 0.2s ease" }}
                />
                <text
                  x={midx}
                  y={midy + 3.5}
                  textAnchor="middle"
                  fontSize="10"
                  style={{ pointerEvents: "none" }}
                >
                  🔗
                </text>
              </g>
            );
          })}
        </svg>

        {/* territory labels */}
        {showTerritories &&
          bands.map((b) => {
            const meta = bandMeta(b.subject);
            return (
              <div
                key={`label-${String(b.subject)}`}
                dir="rtl"
                className="absolute inline-flex items-center gap-1.5 rounded-full border bg-card/85 px-2.5 py-1 backdrop-blur-sm"
                style={{
                  right: 12,
                  top: b.yTop + 4,
                  borderColor: meta.line,
                  zIndex: 3,
                }}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: meta.accent }}
                />
                <span
                  className="font-display text-[12.5px] font-semibold"
                  style={{ color: meta.accent }}
                >
                  {meta.label}
                </span>
              </div>
            );
          })}

        {/* nodes */}
        {placed.map(({ lo, x, y }, i) => {
          const score = scoreOf(lo);
          const color = masteryColor(score);
          const selected = lo.id === selectedLoId;
          const cited = citedIds?.has(lo.id) ?? false;
          const pulseNonce = pulses?.[lo.id];
          const dim = selectedLoId !== null && !selected &&
            !lo.prereqIds.includes(selectedLoId) &&
            !(posById.get(selectedLoId)?.lo.prereqIds ?? []).includes(lo.id);
          return (
            <button
              key={lo.id}
              onClick={() => onSelect(lo.id)}
              className="group absolute rounded-lg border text-left"
              style={{
                left: x,
                top: y,
                width: nodeW,
                height: NODE_H,
                borderColor: selected
                  ? "var(--ink)"
                  : cited
                    ? "var(--accent)"
                    : masteryColor(score, 0.55),
                backgroundColor: `color-mix(in srgb, ${color} ${selected ? 13 : 9}%, var(--card))`,
                boxShadow: selected
                  ? "0 0 0 1.5px var(--ink), 0 16px 28px -14px rgba(32,41,58,0.45)"
                  : cited
                    ? "0 0 0 1px var(--accent), 0 0 22px -4px rgba(22,102,92,0.5), 0 8px 20px -14px rgba(32,41,58,0.3)"
                    : "0 1px 2px rgba(32,41,58,0.06), 0 8px 20px -14px rgba(32,41,58,0.3)",
                opacity: dim && !cited ? 0.45 : 1,
                zIndex: selected ? 4 : 2,
                transform: selected ? "translateY(-2px)" : undefined,
                transition:
                  "background-color 0.5s ease, border-color 0.5s ease, opacity 0.35s ease, transform 0.25s ease, box-shadow 0.25s ease",
                animation: `pop-in 0.4s cubic-bezier(0.22,1,0.36,1) ${i * 45}ms both`,
              }}
            >
              {pulseNonce !== undefined && (
                <span key={pulseNonce} className="anim-cite-ring" aria-hidden />
              )}
              <div className="flex h-full flex-col px-2.5 pb-2 pt-2">
                <div className="flex items-center justify-between gap-1">
                  <span className="font-mono text-[9px] tracking-wider text-ink-faint">
                    {lo.id.replace("lo:u", "").replace("lo:", "")}
                  </span>
                  <span
                    className="rounded px-1 font-mono text-[9.5px] font-semibold text-paper transition-colors duration-500"
                    style={{ backgroundColor: color }}
                  >
                    {pct(score)}
                  </span>
                </div>
                <p
                  className="mt-1 line-clamp-3 flex-1 text-[11px] font-medium leading-[1.3] text-ink"
                  dir={spineSubjectDef(lo.subject)?.dir === "rtl" ? "rtl" : undefined}
                >
                  {lo.label}
                </p>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink/10">
                    <div
                      className="h-full rounded-full transition-all duration-700 ease-out"
                      style={{ width: pct(score), backgroundColor: color }}
                    />
                  </div>
                  <span className="font-mono text-[8.5px] text-ink-faint">
                    {questionCounts.get(lo.id) ?? 0}q
                  </span>
                </div>
              </div>
            </button>
          );
        })}

        {/* bridge rationale card */}
        {activeBridge !== null &&
          visibleBridges[activeBridge] &&
          (() => {
            const b = visibleBridges[activeBridge];
            const a = posById.get(b.src)!;
            const z = posById.get(b.dst)!;
            // the two endpoints in registry order (was: "the math one" and
            // "the social one" — a pairing only two subjects could satisfy)
            const [firstEnd, secondEnd] = [a.lo, z.lo].sort((p, q) =>
              compareSpineSubjects(p.subject, q.subject)
            );
            const secondDef = spineSubjectDef(secondEnd.subject);
            const midx = (a.x + z.x) / 2 + nodeW / 2;
            const midy = (a.cy + z.cy) / 2;
            const cardW = 300;
            const left = Math.max(
              8,
              Math.min(canvasW - cardW - 8, midx - cardW / 2)
            );
            return (
              <div
                className="anim-pop absolute"
                style={{
                  left,
                  top: midy - 8,
                  width: cardW,
                  zIndex: 6,
                }}
                onMouseLeave={() => setActiveBridge(null)}
              >
                <div
                  className="ledger-card overflow-hidden"
                  style={{ borderColor: "var(--bridge-gold)" }}
                >
                  <div
                    className="flex items-center gap-1.5 border-b px-3 py-1.5"
                    style={{
                      borderColor: "var(--gold-wash)",
                      background: "var(--gold-wash)",
                    }}
                  >
                    <span aria-hidden>🔗</span>
                    <span
                      dir="rtl"
                      className="font-display text-[12px] font-semibold"
                      style={{ color: "var(--gold)" }}
                    >
                      صلة بين مادتين
                    </span>
                  </div>
                  <div className="px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                      <button
                        onClick={() => {
                          onSelect(firstEnd.id);
                          setActiveBridge(null);
                        }}
                        className="rounded-md border border-line-soft px-2 py-1 text-left font-medium text-ink transition-colors hover:border-accent/50 hover:bg-accent-wash"
                      >
                        {firstEnd.label}
                      </button>
                      <span className="font-mono text-ink-faint">↔</span>
                      <button
                        dir={secondDef?.dir === "rtl" ? "rtl" : undefined}
                        onClick={() => {
                          onSelect(secondEnd.id);
                          setActiveBridge(null);
                        }}
                        className="rounded-md border border-line-soft px-2 py-1 text-right font-medium text-ink transition-colors hover:bg-[var(--bridge-far-wash)]"
                        style={
                          {
                            borderColor: secondDef?.accent.line,
                            // hover wash = the far subject's own accent
                            "--bridge-far-wash": secondDef?.accent.wash,
                          } as React.CSSProperties
                        }
                      >
                        {secondEnd.label}
                      </button>
                    </div>
                    <p
                      dir="rtl"
                      className="mt-2 text-[12.5px] leading-relaxed text-ink-soft"
                    >
                      {b.rationale}
                    </p>
                  </div>
                </div>
              </div>
            );
          })()}
      </div>
    </div>
  );
}
