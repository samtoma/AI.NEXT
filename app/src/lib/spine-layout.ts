/**
 * The skill map's geometry (`/spine`), as pure functions.
 *
 * No React, no DOM, no database: every function here is a function of its
 * arguments. That is what lets the layout be unit-tested on the real maths
 * graph (`spine-layout.test.mts`) and drawn outside the app for review, and it
 * is why this file imports nothing but a type. `components/spine/GraphCanvas`
 * renders what these return; `lib/queries.ts` layers the graph with
 * `computeLayers` before it ever reaches the client.
 *
 * Moved here from GraphCanvas.tsx (layout, edge curves, occlusion) and
 * queries.ts (layering) for v0.9.1 without changing the edge geometry or the
 * card dimensions. What DID change is the column placement — see
 * `layoutSpine`.
 */
import type { SpineLo } from "./types";

export const NODE_H = 124; // three clamped title lines + the fill + the count
export const MIN_W = 200; // the build spec's card, not a cell in a fixed canvas
export const MAX_W = 232;
export const GAP_MIN = 34;
export const PAD = 16;
export const ARC_HEADROOM = 84; // room above the first row for long-span arcs
export const ROW_SPREAD = NODE_H + 34;

/**
 * What the layout reads off a topic, and nothing else. Narrow on purpose: the
 * tests and the review renders build these from the seed files without
 * inventing mastery scores, and a field the layout does not declare is a field
 * it cannot quietly start depending on.
 */
export type LayoutLo = Pick<SpineLo, "id" | "layer" | "prereqIds" | "catalogRank">;

export interface Placed<L extends LayoutLo = SpineLo> {
  lo: L;
  x: number;
  y: number; // top
  cy: number; // center
}

export type Pt = { x: number; y: number };

/* ------------------------------------------------------------------ */
/* Layering                                                            */
/* ------------------------------------------------------------------ */

/** Longest-path layering over the prerequisite DAG: a topic's column is one
 *  more than its deepest prerequisite's. */
export function computeLayers(
  ids: string[],
  edges: { src: string; dst: string }[]
): Map<string, number> {
  const layer = new Map<string, number>(ids.map((id) => [id, 0]));
  // relax |V| times (tiny graph — simplicity over cleverness)
  for (let i = 0; i < ids.length; i++) {
    let changed = false;
    for (const { src, dst } of edges) {
      const cand = (layer.get(src) ?? 0) + 1;
      if (cand > (layer.get(dst) ?? 0)) {
        layer.set(dst, cand);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return layer;
}

/* ------------------------------------------------------------------ */
/* Column placement                                                    */
/* ------------------------------------------------------------------ */

/** Two barycentres closer than this are a tie. They are averages of card
 *  centres, and an average of the same heights summed in a different order
 *  can differ in the last bit — which must not be what decides a card's
 *  place. The tie then falls to catalogue order, which never varies. */
const BARY_EPS = 1e-6;

/** Average height of a topic's already-placed prerequisites, or null when it
 *  has none on screen — layer 0, and the odd orphan later on. */
function barycentre(lo: LayoutLo, centers: Map<string, number>): number | null {
  let sum = 0;
  let n = 0;
  for (const p of lo.prereqIds) {
    const c = centers.get(p);
    if (c === undefined) continue;
    sum += c;
    n++;
  }
  return n ? sum / n : null;
}

/**
 * Packed, centred columns over the whole subject (FR-3216).
 *
 * Each prerequisite-depth column is sorted — by the barycentre of its
 * already-placed prerequisites, then by catalogue rank (FR-3215), then by id —
 * and placed as an evenly spaced stack, one `ROW_SPREAD` apart, centred on one
 * midline the whole map shares. The barycentre only ORDERS a column; it never
 * moves a card off the stack. A topic whose prerequisites are not on screen
 * (every topic in the first column) sorts after the anchored ones, in
 * catalogue order — so the first column reads Unit 1, Unit 2, … Term 2,
 * geometry, exactly as the lesson list does.
 *
 * WHY (Samuel, 2026-09-24): before v0.6.0 the map read "nice and sequential";
 * after it, it "looks random". He chose the ordered, list-like reading over
 * the floating tree, and FR-3216 restores the pre-v0.6.0 packing
 * (`layoutBand`, 886b302) inside Tamer's redesign — cards, washes, edges,
 * arcs, headroom and interaction are all his and are unchanged. The order
 * half of "random" was a separate defect: ties on `orderInParent`, a
 * per-module position, fell through to whatever order Postgres returned
 * (FR-3215 fixes it at the query).
 *
 * The canvas is sized so nothing clips: the tallest column's top card sits
 * one `ARC_HEADROOM` below the canvas top (the room long-span arcs rise
 * into), every shorter column is centred on the same line, and the canvas
 * ends one `PAD` below the lowest card.
 *
 * SUPERSEDED 2026-09-24 (FR-3216) — the v0.6.0 rationale, kept because it
 * names the real cost of what this restores:
 *
 * > Each node sits AT its barycentre — the average height of the topics it
 * > builds on — pushed down only as far as it takes to stop it overlapping the
 * > node above it in its own column. The previous version used the barycentre
 * > to ORDER a column and then threw the values away, re-centring every column
 * > on the tallest one's midline. On 90 topics that reserved the full height of
 * > the widest layer for all of them: a five-node column got a thirteen-node
 * > column's worth of canvas, the void went above and below it, and the tree
 * > drifted away from the parents it was supposed to sit beside. Packing to the
 * > barycentre keeps a child next to its prerequisite and gives the voids back.
 *
 * That trade is accepted knowingly: a short column does sit in the middle of a
 * tall canvas, and GraphCanvas opens the pane on the first column so the map
 * never opens on blank paper.
 */
export function layoutSpine<L extends LayoutLo>(
  los: readonly L[],
  width: number,
  /**
   * The book section each topic belongs to as a part (FR-4315), or null. When
   * given, a column's members of one section are placed together — see
   * `gatherSections`. Omitted (every map with no split section — every
   * National subject) the placement is exactly the one described above.
   */
  groupOf?: (id: string) => string | null
) {
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

  const byLayer: L[][] = Array.from({ length: nLayers }, () => []);
  for (const lo of los) byLayer[lo.layer]?.push(lo);

  // The common midline: where the tallest column's stack is centred when its
  // top card sits one headroom below the canvas top.
  const tallest = Math.max(1, ...byLayer.map((c) => c.length));
  const midY = PAD + ARC_HEADROOM + NODE_H / 2 + ((tallest - 1) * ROW_SPREAD) / 2;

  const centers = new Map<string, number>();
  const placed: Placed<L>[] = [];
  for (let layer = 0; layer < nLayers; layer++) {
    const col = byLayer[layer];
    if (col.length === 0) continue;
    const bary = new Map(col.map((lo) => [lo.id, barycentre(lo, centers)]));
    col.sort((a, b) => {
      const ba = bary.get(a.id) ?? Infinity;
      const bb = bary.get(b.id) ?? Infinity;
      // NaN when both are unanchored (Infinity - Infinity): a tie, as meant.
      if (Math.abs(ba - bb) > BARY_EPS) return ba < bb ? -1 : 1;
      return (
        a.catalogRank - b.catalogRank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      );
    });
    const stack = groupOf ? gatherSections(col, groupOf) : col;
    const start = midY - ((stack.length - 1) * ROW_SPREAD) / 2;
    stack.forEach((lo, i) => {
      const cy = start + i * ROW_SPREAD;
      centers.set(lo.id, cy);
      placed.push({ lo, x: xOf(lo.layer), y: cy - NODE_H / 2, cy });
    });
  }

  const canvasH =
    placed.length === 0
      ? 420
      : Math.max(420, Math.max(...placed.map((p) => p.y + NODE_H)) + PAD);
  return { placed, nodeW, canvasW, canvasH, midY };
}

/* ------------------------------------------------------------------ */
/* Book sections as groups (feature 003, FR-4315)                      */
/* ------------------------------------------------------------------ */

/**
 * One column, sorted, with each book section's members gathered where its
 * first member already stands, in the order they were sorted — so a split
 * section's cards in that column sit together and can be framed as one group.
 * Every card that is not a part keeps its relative order, and a column with
 * no part in it comes back in exactly the sorted order (the packed-column
 * rule of FR-3216 is untouched: this only reorders WITHIN the stack).
 */
export function gatherSections<L extends LayoutLo>(
  col: readonly L[],
  groupOf: (id: string) => string | null
): L[] {
  const out: L[] = [];
  const placed = new Set<string>();
  for (const lo of col) {
    if (placed.has(lo.id)) continue;
    const key = groupOf(lo.id);
    if (key == null) {
      out.push(lo);
      placed.add(lo.id);
      continue;
    }
    for (const m of col) {
      if (!placed.has(m.id) && groupOf(m.id) === key) {
        out.push(m);
        placed.add(m.id);
      }
    }
  }
  return out;
}

/** The frame's margin round its cards, and the room above them for its label. */
export const FRAME_PAD = 7;
export const FRAME_LABEL_H = 19;

/**
 * A book section's frame on the map: one per run of vertically adjacent cards
 * of the SAME section in one column. The derived part n-1 → n prerequisites
 * put each part a column to the right of the one before, so a split section
 * reads as a short staircase of framed runs, each labelled.
 *
 * Sized to stay inside the 34px between rows: 26px above the top card (the
 * margin and the label) and 7px below the bottom one, so two frames stacked
 * in one column never overlap and no frame ever covers a card it does not
 * hold.
 */
export interface SectionFrame {
  key: string;
  /** the framed topics, top to bottom */
  loIds: string[];
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The frames for `placed` — the output of `layoutSpine` called with the same
 * `groupOf`, whose cards are listed column by column, top to bottom. Empty
 * when no card has a section.
 */
export function sectionFrames(
  placed: readonly Placed<LayoutLo>[],
  nodeW: number,
  groupOf: (id: string) => string | null
): SectionFrame[] {
  const frames: SectionFrame[] = [];
  let run: Placed<LayoutLo>[] = [];
  let runKey: string | null = null;
  const close = () => {
    if (runKey != null && run.length > 0) {
      const first = run[0];
      const last = run[run.length - 1];
      const y = first.y - FRAME_PAD - FRAME_LABEL_H;
      frames.push({
        key: runKey,
        loIds: run.map((p) => p.lo.id),
        x: first.x - FRAME_PAD,
        y,
        width: nodeW + 2 * FRAME_PAD,
        height: last.y + NODE_H + FRAME_PAD - y,
      });
    }
    run = [];
    runKey = null;
  };
  let prev: Placed<LayoutLo> | null = null;
  for (const p of placed) {
    const key = groupOf(p.lo.id);
    const continues =
      key != null &&
      key === runKey &&
      prev != null &&
      prev.lo.layer === p.lo.layer &&
      Math.abs(p.y - prev.y - ROW_SPREAD) < 1e-6;
    if (!continues) close();
    if (key != null) {
      runKey = key;
      run.push(p);
    }
    prev = p;
  }
  close();
  return frames;
}

/* ------------------------------------------------------------------ */
/* Edges                                                               */
/* ------------------------------------------------------------------ */

/**
 * One edge's cubic, as its four control points.
 *
 * Extracted so the drawn path and the occlusion test below are literally the
 * same curve. Inlining the `d` string and eyeballing a second approximation
 * for the hit test is how a line ends up dashed while passing through clear
 * air, or solid while buried under a card.
 */
export function edgeCurve(
  s: Placed<LayoutLo>,
  t: Placed<LayoutLo>,
  nodeW: number
): [Pt, Pt, Pt, Pt] {
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

export const curvePath = (c: [Pt, Pt, Pt, Pt]) =>
  `M ${c[0].x} ${c[0].y} C ${c[1].x} ${c[1].y}, ${c[2].x} ${c[2].y}, ${c[3].x} ${c[3].y}`;

export function cubicAt(c: [Pt, Pt, Pt, Pt], u: number): Pt {
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
export const OCCLUSION_SAMPLES = 32;

/**
 * Which edges pass behind a card that is not one of their own endpoints, by
 * index into `edges`.
 *
 * Sampled rather than solved: a cubic-vs-rectangle intersection has a
 * closed form, and it is far more code than this problem is worth on a
 * graph where the answer only has to be right to the nearest few pixels.
 * The endpoints are skipped because every edge starts and ends flush
 * against a card by construction — testing them would dash all 112.
 *
 * Worst case here is 112 edges x 32 samples x 90 cards, which sounds
 * alarming and is about a millisecond of integer comparisons; it is not
 * worth a spatial index.
 */
export function occludedEdges(
  edges: readonly { src: string; dst: string }[],
  placed: readonly Placed<LayoutLo>[],
  nodeW: number
): Set<number> {
  const posById = new Map(placed.map((p) => [p.lo.id, p]));
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
}
