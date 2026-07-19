"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SpineLo } from "@/lib/types";
import { masteryColor, pct } from "@/lib/mastery";

export type AsOf = "baseline" | "today";

const H = 470;
const NODE_H = 106;
const MIN_W = 118;
const MAX_W = 198;
const GAP_MIN = 26;
const PAD = 10;

interface Placed {
  lo: SpineLo;
  x: number;
  y: number; // top
  cy: number; // center
}

function computeLayout(los: SpineLo[], width: number, nodeCount: Map<string, number>) {
  const nLayers = Math.max(...los.map((l) => l.layer)) + 1;
  let nodeW = (width - 2 * PAD - GAP_MIN * (nLayers - 1)) / nLayers;
  nodeW = Math.max(MIN_W, Math.min(MAX_W, nodeW));
  const gap = Math.max(
    GAP_MIN,
    (width - 2 * PAD - nodeW * nLayers) / Math.max(1, nLayers - 1)
  );
  const canvasW = Math.max(width, 2 * PAD + nodeW * nLayers + gap * (nLayers - 1));
  const x = (layer: number) => PAD + layer * (nodeW + gap);

  const midY = H / 2;
  const centers = new Map<string, number>();
  const byLayer: SpineLo[][] = Array.from({ length: nLayers }, () => []);
  for (const lo of los) byLayer[lo.layer].push(lo);

  const placed: Placed[] = [];
  for (let layer = 0; layer < nLayers; layer++) {
    const group = byLayer[layer];
    const bary = (lo: SpineLo) => {
      const preds = lo.prereqIds
        .map((p) => centers.get(p))
        .filter((v): v is number => v !== undefined);
      return preds.length
        ? preds.reduce((a, b) => a + b, 0) / preds.length
        : midY;
    };
    group.sort((a, b) => bary(a) - bary(b) || a.orderInParent - b.orderInParent);

    if (group.length === 1) {
      const lo = group[0];
      // follow predecessors, drifting gently back toward center
      const cy = 0.72 * bary(lo) + 0.28 * midY;
      centers.set(lo.id, cy);
      placed.push({ lo, x: x(lo.layer), y: cy - NODE_H / 2, cy });
    } else {
      const spread = NODE_H + 78;
      const start = midY - ((group.length - 1) * spread) / 2;
      group.forEach((lo, i) => {
        const cy = start + i * spread;
        centers.set(lo.id, cy);
        placed.push({ lo, x: x(lo.layer), y: cy - NODE_H / 2, cy });
      });
    }
  }

  // Normalize: tall columns can extend past the nominal H in both directions.
  // Shift everything into positive space and size the canvas to actual content
  // (headroom on top for long-span arcs that bow above the nodes).
  const ARC_HEADROOM = 120;
  const minCy = Math.min(...placed.map((p) => p.cy));
  const maxCy = Math.max(...placed.map((p) => p.cy));
  const shift = PAD + ARC_HEADROOM + NODE_H / 2 - minCy;
  for (const p of placed) {
    p.cy += shift;
    p.y += shift;
    centers.set(p.lo.id, p.cy);
  }
  const canvasH = Math.max(
    H,
    maxCy - minCy + NODE_H + 2 * PAD + ARC_HEADROOM + 24
  );
  void nodeCount;
  return { placed, nodeW, canvasW, canvasH, centers };
}

export function GraphCanvas({
  los,
  edges,
  asOf,
  selectedLoId,
  questionCounts,
  onSelect,
  citedIds,
  pulses,
}: {
  los: SpineLo[];
  edges: { src: string; dst: string }[];
  asOf: AsOf;
  selectedLoId: string | null;
  questionCounts: Map<string, number>;
  onSelect: (id: string) => void;
  /** LOs cited by the AI in the current answer — soft viridian glow */
  citedIds?: Set<string>;
  /** id → nonce; bumping the nonce re-fires the pulse ring */
  pulses?: Record<string, number>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);

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

  const { placed, nodeW, canvasW, canvasH } = useMemo(
    () => computeLayout(los, width, questionCounts),
    [los, width, questionCounts]
  );
  const posById = useMemo(
    () => new Map(placed.map((p) => [p.lo.id, p])),
    [placed]
  );

  const scoreOf = (lo: SpineLo) => (asOf === "today" ? lo.current : lo.baseline);

  return (
    <div ref={ref} className="thin-scroll overflow-x-auto">
      <div
        className="relative"
        style={{ width: canvasW, height: canvasH }}
      >
        {/* edges */}
        <svg
          className="absolute inset-0"
          width={canvasW}
          height={canvasH}
          fill="none"
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
              const arcY = Math.max(26, Math.min(sy, ty) - 118);
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
        </svg>

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
                zIndex: selected ? 2 : 1,
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
                    {lo.id.replace("lo:u", "")}
                  </span>
                  <span
                    className="rounded px-1 font-mono text-[9.5px] font-semibold text-paper transition-colors duration-500"
                    style={{ backgroundColor: color }}
                  >
                    {pct(score)}
                  </span>
                </div>
                <p className="mt-1 line-clamp-3 flex-1 text-[11px] font-medium leading-[1.3] text-ink">
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
      </div>
    </div>
  );
}
