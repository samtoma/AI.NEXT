"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SpineLo } from "@/lib/types";
import { spineSubjectDef } from "@/lib/subjects";
import { masteryStage, masteryPhrase } from "@/lib/mastery";
import { MasteryFill } from "./MasteryFill";

export type AsOf = "baseline" | "today";

const NODE_H = 124; // three clamped title lines + the fill + the count
const MIN_W = 200; // the build spec's card, not a cell in a fixed canvas
const MAX_W = 232;
const GAP_MIN = 34;
const PAD = 16;
const ARC_HEADROOM = 84; // room above the first row for long-span arcs
const ROW_SPREAD = NODE_H + 34;

/** Unlit card border — never ink, never a shadow. */
const UNLIT_BORDER = "#B4AECB";
/** Edges: one flat lilac, 2.5px, no arrowheads and no labels. */
const EDGE = "#C9C2E0";

/**
 * The card's own wash, one per stage — the SAME five colours the fill uses,
 * laid on at wash strength.
 *
 * The screen you stare at for minutes needs to answer "where am I strong?"
 * from across the room, and a six-pixel bar four segments wide does not.
 * The old Evidence Walk got that part right: it tinted the whole node by
 * mastery. What it got wrong was pairing the tint with a percentage badge,
 * and mixing a CONTINUOUS hue, so two topics in the same band looked
 * different. This is the banded version of the same idea — five discrete
 * washes off `--mastery-0…4`, so the card and its fill can never disagree
 * about which band a topic is in.
 *
 * The percentages are tuned per pigment, not set on a straight line: amber
 * and the tan a step above it are near neighbours by design, so the tan
 * needs roughly twice the strength before the two read apart, while teal is
 * the heaviest of the five and lands in the same lightness family at 22%.
 * Measured, the five come out #FFFFFF · #FDF2E2 · #F3E4CD · #E2EDE1 ·
 * #D1EAE6 — even steps to the eye. All stay above ~80% white, which keeps
 * ink body text over 12:1: the wash is a second carrier for the band,
 * never a contrast risk.
 *
 * This is the one place the build spec's token list is not followed to the
 * letter: it names leaf #EAF7DF "fill for the strongest stage", which was
 * right when stage 4 was the ONLY tinted card. Now that every stage carries
 * a wash, the top of the ramp wears the ramp's own top colour instead of a
 * green borrowed from outside it.
 */
const STAGE_WASH = [
  "var(--card)", // 0 · not started — plain white, the only untinted card
  "color-mix(in srgb, var(--mastery-1) 14%, var(--card))",
  "color-mix(in srgb, var(--mastery-2) 30%, var(--card))",
  "color-mix(in srgb, var(--mastery-3) 26%, var(--card))",
  "color-mix(in srgb, var(--mastery-4) 22%, var(--card))",
] as const;

interface Placed {
  lo: SpineLo;
  x: number;
  y: number; // top
  cy: number; // center
}

type Pt = { x: number; y: number };

/**
 * One edge's cubic, as its four control points.
 *
 * Extracted so the drawn path and the occlusion test below are literally the
 * same curve. Inlining the `d` string and eyeballing a second approximation
 * for the hit test is how a line ends up dashed while passing through clear
 * air, or solid while buried under a card.
 */
function edgeCurve(s: Placed, t: Placed, nodeW: number): [Pt, Pt, Pt, Pt] {
  const p0 = { x: s.x + nodeW, y: s.cy };
  const p3 = { x: t.x, y: t.cy };
  const dx = p3.x - p0.x;
  if (t.lo.layer - s.lo.layer <= 1) {
    return [
      p0,
      { x: p0.x + dx * 0.45, y: p0.y },
      { x: p3.x - dx * 0.45, y: p3.y },
      p3,
    ];
  }
  // A multi-layer span arcs over the columns it skips rather than ploughing
  // through them — the arc is the FIRST defence against occlusion; the dash
  // is what admits the cases it cannot clear.
  const arcY = Math.max(PAD, Math.min(p0.y, p3.y) - 86);
  return [
    p0,
    { x: p0.x + dx * 0.22, y: arcY },
    { x: p3.x - dx * 0.22, y: arcY },
    p3,
  ];
}

const curvePath = (c: [Pt, Pt, Pt, Pt]) =>
  `M ${c[0].x} ${c[0].y} C ${c[1].x} ${c[1].y}, ${c[2].x} ${c[2].y}, ${c[3].x} ${c[3].y}`;

function cubicAt(c: [Pt, Pt, Pt, Pt], u: number): Pt {
  const v = 1 - u;
  const a = v * v * v,
    b = 3 * v * v * u,
    d = 3 * v * u * u,
    e = u * u * u;
  return {
    x: a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x,
    y: a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y,
  };
}

/** How many points along a curve get tested for occlusion. 32 puts a sample
 *  every ~7px on a typical one-layer span — finer than a card is wide, so a
 *  card cannot sit between two samples and be missed. */
const OCCLUSION_SAMPLES = 32;

/**
 * Barycentric layered layout over the whole subject.
 *
 * The screen is subject-wide by definition now (build spec 01), so there is
 * one graph, not a stack of per-subject territories: the dashed band
 * backdrops, their labels and the cross-subject bridge arcs came off with the
 * rest of the graph metadata. `SpineData` still carries `bridges`, and the
 * layered DAG still drives x — a multi-subject view is a different screen.
 *
 * Each node sits AT its barycentre — the average height of the topics it
 * builds on — pushed down only as far as it takes to stop it overlapping the
 * node above it in its own column. The previous version used the barycentre
 * to ORDER a column and then threw the values away, re-centring every column
 * on the tallest one's midline. On 90 topics that reserved the full height of
 * the widest layer for all of them: a five-node column got a thirteen-node
 * column's worth of canvas, the void went above and below it, and the tree
 * drifted away from the parents it was supposed to sit beside. Packing to the
 * barycentre keeps a child next to its prerequisite and gives the voids back.
 */
function layout(los: SpineLo[], width: number) {
  const nLayers = Math.max(1, Math.max(...los.map((l) => l.layer)) + 1);
  let nodeW = (width - 2 * PAD - GAP_MIN * (nLayers - 1)) / nLayers;
  nodeW = Math.max(MIN_W, Math.min(MAX_W, nodeW));
  const gap = Math.max(
    GAP_MIN,
    (width - 2 * PAD - nodeW * nLayers) / Math.max(1, nLayers - 1)
  );
  const canvasW = Math.max(
    width,
    2 * PAD + nodeW * nLayers + gap * (nLayers - 1)
  );
  const xOf = (layer: number) => PAD + layer * (nodeW + gap);

  const byLayer: SpineLo[][] = Array.from({ length: nLayers }, () => []);
  for (const lo of los) byLayer[lo.layer]?.push(lo);

  const centers = new Map<string, number>();
  const placed: Placed[] = [];
  for (let layer = 0; layer < nLayers; layer++) {
    const col = byLayer[layer];
    if (col.length === 0) continue;
    /** Average height of this node's already-placed prerequisites, or null
     *  when it has none on screen — layer 0, and the odd orphan later on. */
    const bary = (lo: SpineLo): number | null => {
      const preds = lo.prereqIds
        .map((p) => centers.get(p))
        .filter((v): v is number => v !== undefined);
      return preds.length
        ? preds.reduce((a, b) => a + b, 0) / preds.length
        : null;
    };
    // Anchored nodes first, in barycentre order; unanchored ones keep the
    // book's own order and fall in behind whatever precedes them.
    col.sort(
      (a, b) =>
        (bary(a) ?? Infinity) - (bary(b) ?? Infinity) ||
        a.orderInParent - b.orderInParent
    );
    let cursor: number | null = null;
    for (const lo of col) {
      // The first node in a column is free; every one after it has to clear
      // the one above by a full row.
      const floor = cursor === null ? -Infinity : cursor + ROW_SPREAD;
      const cy = Math.max(bary(lo) ?? (cursor === null ? 0 : floor), floor);
      cursor = cy;
      centers.set(lo.id, cy);
      placed.push({ lo, x: xOf(lo.layer), y: cy - NODE_H / 2, cy });
    }
  }
  if (placed.length === 0) {
    return { placed, nodeW, canvasW, canvasH: 420 };
  }

  // Normalise: the first column starts at -Infinity + ROW_SPREAD, and later
  // columns float wherever their parents put them, so the whole graph is
  // shifted into the canvas once at the end rather than being anchored twice.
  const top = Math.min(...placed.map((p) => p.y));
  const shift = PAD + ARC_HEADROOM - top;
  for (const p of placed) {
    p.y += shift;
    p.cy += shift;
  }
  for (const [id, cy] of centers) centers.set(id, cy + shift);

  const canvasH = Math.max(
    420,
    Math.max(...placed.map((p) => p.y + NODE_H)) + PAD
  );
  return { placed, nodeW, canvasW, canvasH };
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
  /** topics Noor referenced in the answer she is writing — a passing ring */
  citedIds?: Set<string>;
  /** id → nonce; bumping the nonce re-fires the ring */
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
    () => layout(los, width),
    [los, width]
  );
  const posById = useMemo(
    () => new Map(placed.map((p) => [p.lo.id, p])),
    [placed]
  );

  /* No scroll-into-view on mount: `layout` normalises the graph so its
     topmost node sits one headroom below the canvas origin, which puts the
     start of the map at the pane's own scroll origin. That was not true while
     columns were centred on the tallest one — the first layer landed ~600px
     into a 2000px canvas and the map opened on blank paper, which is what the
     scroll-on-mount was there to hide. */

  /**
   * Which edges pass behind a card that is not one of their own endpoints.
   *
   * Sampled rather than solved: a cubic-vs-rectangle intersection has a
   * closed form, and it is far more code than this problem is worth on a
   * graph where the answer only has to be right to the nearest few pixels.
   * The endpoints are skipped because every edge starts and ends flush
   * against a card by construction — testing them would dash all 112.
   *
   * Recomputed only when the layout does. Worst case here is 112 edges x 32
   * samples x 90 cards, which sounds alarming and is about a millisecond of
   * integer comparisons; it is not worth a spatial index.
   */
  const occluded = useMemo(() => {
    const rects = placed.map((p) => ({
      id: p.lo.id,
      x1: p.x,
      y1: p.y,
      x2: p.x + nodeW,
      y2: p.y + NODE_H,
    }));
    const hit = new Set<number>();
    edges.forEach((e, i) => {
      const s = posById.get(e.src);
      const t = posById.get(e.dst);
      if (!s || !t) return;
      const c = edgeCurve(s, t, nodeW);
      for (let k = 1; k < OCCLUSION_SAMPLES; k++) {
        const pt = cubicAt(c, k / OCCLUSION_SAMPLES);
        for (const r of rects) {
          if (r.id === e.src || r.id === e.dst) continue;
          if (pt.x >= r.x1 && pt.x <= r.x2 && pt.y >= r.y1 && pt.y <= r.y2) {
            hit.add(i);
            return;
          }
        }
      }
    });
    return hit;
  }, [edges, placed, posById, nodeW]);

  const stageOf = (lo: SpineLo) => {
    const score = asOf === "today" ? lo.current : lo.baseline;
    // A topic she has never touched is stage 0 on its own merit, not because
    // the cold-start prior happens to band low — same rule the check-in card
    // and the dashboard apply.
    return masteryStage(score, score > 0);
  };

  return (
    <div ref={ref} className="thin-scroll h-full overflow-auto p-4">
      <div className="relative" style={{ width: canvasW, height: canvasH }}>
        {/* edges — plain lines, no arrowheads, no direction labels */}
        <svg
          className="absolute inset-0"
          width={canvasW}
          height={canvasH}
          fill="none"
          style={{ zIndex: 1 }}
          aria-hidden
        >
          {edges.map((e, i) => {
            const s = posById.get(e.src);
            const t = posById.get(e.dst);
            if (!s || !t) return null;
            const d = curvePath(edgeCurve(s, t, nodeW));
            const touched =
              selectedLoId !== null &&
              (e.src === selectedLoId || e.dst === selectedLoId);
            const dim = selectedLoId !== null && !touched;
            return (
              <path
                key={i}
                d={d}
                stroke={touched ? "var(--ink)" : EDGE}
                strokeWidth={2.5}
                strokeLinecap="round"
                /* Dashed = this line runs behind a card on its way across.
                   A solid line that vanishes under one card and reappears
                   from under another reads as two unrelated links; the dash
                   says "same line, it goes behind that". It carries no
                   direction and no meaning about the relationship — the
                   build spec's "no arrowheads, no directional labels" is
                   about semantics, and this is legibility. */
                strokeDasharray={occluded.has(i) ? "9 7" : undefined}
                style={{
                  opacity: dim ? 0.3 : 1,
                  transition: "opacity 0.35s ease, stroke 0.35s ease",
                }}
              />
            );
          })}
        </svg>

        {/* topic cards */}
        {placed.map(({ lo, x, y }, i) => {
          const stage = stageOf(lo);
          const lit = stage > 0;
          const selected = lo.id === selectedLoId;
          const cited = citedIds?.has(lo.id) ?? false;
          const pulseNonce = pulses?.[lo.id];
          const dim =
            selectedLoId !== null &&
            !selected &&
            !lo.prereqIds.includes(selectedLoId) &&
            !(posById.get(selectedLoId)?.lo.prereqIds ?? []).includes(lo.id);
          const count = questionCounts.get(lo.id) ?? 0;
          return (
            <button
              key={lo.id}
              /* The internal id stays in the DOM for debugging and for tests
                 to hang off — never on the face of the card (build spec 02,
                 DO NOT #2). */
              data-lo-id={lo.id}
              onClick={() => onSelect(lo.id)}
              aria-label={`${lo.label} — ${masteryPhrase(stage)}, ${count} questions`}
              /* `items-stretch` is NOT redundant with the flex default.
                 WebKit's UA stylesheet overrides `align-items` on a <button>,
                 so a button used as a flex container does not stretch its
                 children across the cross axis the way every other element
                 does. On the card that silently collapses the mastery fill —
                 its segments are `flex-1` off a zero basis, so with no
                 stretch they shrink to their 1.5px borders and the bar
                 renders as four dots in the corner. Chromium stretches and
                 looks correct, which is exactly how this shipped: iPad
                 Safari is a hard device target (constitution, devices), and
                 it is the browser that gets it wrong. */
              className="group play-pressable absolute flex flex-col items-stretch gap-2 text-start"
              style={{
                left: x,
                top: y,
                width: nodeW,
                height: NODE_H,
                padding: "12px 14px",
                borderRadius: 16,
                border: `2.5px solid ${
                  lit || selected || cited ? "var(--ink)" : UNLIT_BORDER
                }`,
                background: STAGE_WASH[stage],
                // Sticker treatment is what "you have started this" looks
                // like: an unlit card is a flat outline with no shadow, and
                // the first lit segment buys the ink edge and the hard
                // offset. Selection lifts the same sticker; it never
                // introduces a second visual language.
                boxShadow: selected
                  ? "5px 5px 0 var(--ink)"
                  : lit || cited
                    ? "var(--play-shadow-sm)"
                    : "none",
                opacity: dim && !cited ? 0.45 : 1,
                zIndex: selected ? 4 : 2,
                transition:
                  "opacity 0.35s ease, box-shadow 0.15s ease, background 0.5s ease, border-color 0.5s ease",
                animation: `pop-in 0.4s cubic-bezier(0.22,1,0.36,1) ${Math.min(i, 24) * 30}ms both`,
              }}
            >
              {pulseNonce !== undefined && (
                <span key={pulseNonce} className="anim-cite-ring" aria-hidden />
              )}
              {/* The clamp lives on a CHILD, never on the flex item itself:
                  a flex item blockifies `display:-webkit-box` to `flow-root`
                  and the line clamp silently stops applying — the title then
                  gets cut by the card's overflow at whatever height the flex
                  line leaves it, mid-line and with no ellipsis. */}
              <span className="min-h-0 flex-1 overflow-hidden">
                <span
                  className="line-clamp-3 font-display text-[0.92rem] font-bold leading-[1.3] text-ink"
                  dir={
                    spineSubjectDef(lo.subject)?.dir === "rtl"
                      ? "rtl"
                      : undefined
                  }
                >
                  {lo.label}
                </span>
              </span>
              {/* Belt and braces with the `items-stretch` above: an explicit
                  width means the bar is correct even if something later
                  re-centres or re-starts this card's cross axis. */}
              <MasteryFill stage={stage} className="w-full" />
              {/* The numeral sits in its own span so an Arabic build can wrap
                  it dir="ltr" without touching the sentence around it. */}
              <span className="font-read text-[0.76rem] leading-none text-ink-soft">
                <span dir="ltr">{count}</span> questions
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
