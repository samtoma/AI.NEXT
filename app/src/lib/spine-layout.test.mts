/**
 * The skill map's layout (`lib/spine-layout.ts`), on the real maths graph.
 *
 * Samuel, 2026-09-24: before v0.6.0 the map read "nice and sequential"; since,
 * it "looks random". Two causes, two requirements:
 *
 *  · FR-3215 — one order. Columns tie-break on `catalogRank` (`MODULE_ORDER`,
 *    the lesson list's order), never on `orderInParent`, a per-module
 *    position nine maths objectives share. The first column must read
 *    Unit 1 → Unit 2 → Unit 3 → Unit 4 → … → Term 2 → geometry.
 *  · FR-3216 — packed, centred columns. Each column is an evenly spaced stack,
 *    one `ROW_SPREAD` apart, centred on one midline, ordered by prerequisite
 *    barycentre and then catalogue rank.
 *
 * The graph is the ten maths seed files the loader reads (see
 * `spine-maths-fixture.mts`), so these fail if the curriculum changes shape
 * under the layout. No database; the SQL half of FR-3215 is
 * `spine-order-scan.test.mts` (source) and `spine-order-db.test.mts`
 * (scratch database, opt-in).
 *
 * @covers FR-3215
 * @covers FR-3216
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ARC_HEADROOM,
  GAP_MIN,
  MAX_W,
  MIN_W,
  NODE_H,
  PAD,
  ROW_SPREAD,
  computeLayers,
  edgeCurve,
  layoutSpine,
  type LayoutLo,
  type Placed,
} from "./spine-layout.ts";
import { loadMathsGraph, type MathsLo } from "./spine-maths-fixture.mts";

const IPAD_LANDSCAPE = 1180;
const graph = loadMathsGraph();

/** Columns of a layout, each top to bottom. */
function columns<L extends LayoutLo>(placed: Placed<L>[]): Placed<L>[][] {
  const cols: Placed<L>[][] = [];
  for (const p of placed) (cols[p.lo.layer] ??= []).push(p);
  for (const c of cols) c.sort((a, b) => a.cy - b.cy);
  return cols;
}

/** Seeded PRNG (mulberry32), so a failing shuffle is reproducible. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled<T>(xs: readonly T[], rand: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const positions = (placed: Placed<LayoutLo>[]) =>
  new Map(placed.map((p) => [p.lo.id, `${p.x},${p.y}`]));

/* -------------------------------------------------------------- fixture */

test("the fixture is the maths map: 90 topics, 112 prerequisites, 15 columns, the tallest 13", () => {
  assert.equal(graph.los.length, 90);
  assert.equal(graph.edges.length, 112);
  const { placed } = layoutSpine(graph.los, IPAD_LANDSCAPE);
  const cols = columns(placed);
  assert.equal(cols.length, 15);
  assert.equal(Math.max(...cols.map((c) => c.length)), 13);
  assert.equal(placed.length, 90, "every topic is placed, none dropped");
});

/* --------------------------------------------------- FR-3215: one order */

test("the first column reads in catalogue order: Unit 1, Unit 2, Unit 3, Unit 3, Unit 4, geometry", () => {
  const { placed } = layoutSpine(graph.los, IPAD_LANDSCAPE);
  const first = columns(placed)[0].map((p) => p.lo);
  assert.deepEqual(
    first.map((lo) => lo.moduleId),
    [
      "module:u1",
      "module:u2",
      "module:u3",
      "module:u3",
      "module:u4",
      "module:geo-u1",
    ]
  );
  // …which is catalogue order, top to bottom — not the book-position order
  // (`orderInParent`), which ties across modules.
  const ranks = first.map((lo) => lo.catalogRank);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  assert.ok(
    new Set(first.map((lo) => lo.orderInParent)).size < first.length,
    "the fixture really does tie on orderInParent in the first column"
  );
});

test("every column is ordered by prerequisite barycentre, then catalogue rank", () => {
  const { placed } = layoutSpine(graph.los, IPAD_LANDSCAPE);
  const cy = new Map(placed.map((p) => [p.lo.id, p.cy]));
  for (const col of columns(placed)) {
    const bary = (lo: MathsLo) => {
      const ys = lo.prereqIds.map((id) => cy.get(id)!).filter((v) => v !== undefined);
      return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : Infinity;
    };
    for (let i = 1; i < col.length; i++) {
      const a = col[i - 1].lo;
      const b = col[i].lo;
      const ba = bary(a);
      const bb = bary(b);
      if (ba === bb || Math.abs(ba - bb) <= 1e-6) {
        assert.ok(a.catalogRank < b.catalogRank, `${a.id} before ${b.id}: a tie goes to catalogue order`);
      } else {
        assert.ok(ba < bb, `${a.id} (${ba}) above ${b.id} (${bb})`);
      }
    }
  }
});

test("a tie is broken by catalogue rank, never by order-in-module or input order", () => {
  // Three roots. By book position (orderInParent) A and B tie and C is last;
  // by catalogue rank the order is B, C, A. The extra field is present and
  // must be ignored.
  const roots = [
    { id: "A", layer: 0, prereqIds: [], catalogRank: 2, orderInParent: 1 },
    { id: "B", layer: 0, prereqIds: [], catalogRank: 0, orderInParent: 1 },
    { id: "C", layer: 0, prereqIds: [], catalogRank: 1, orderInParent: 2 },
  ];
  for (const input of [roots, [...roots].reverse()]) {
    const { placed } = layoutSpine(input, 900);
    assert.deepEqual(
      [...placed].sort((a, b) => a.cy - b.cy).map((p) => p.lo.id),
      ["B", "C", "A"]
    );
  }
});

test("a topic with no placed prerequisite sorts after the anchored ones, in catalogue order", () => {
  const los = [
    { id: "r1", layer: 0, prereqIds: [], catalogRank: 0 },
    { id: "r2", layer: 0, prereqIds: [], catalogRank: 1 },
    // an orphan in column 1 (its prerequisite is not on screen), ranked first
    { id: "orphan", layer: 1, prereqIds: ["gone"], catalogRank: 2 },
    { id: "c2", layer: 1, prereqIds: ["r2"], catalogRank: 4 },
    { id: "c1", layer: 1, prereqIds: ["r1"], catalogRank: 3 },
  ];
  const { placed } = layoutSpine(los, 900);
  assert.deepEqual(
    columns(placed)[1].map((p) => p.lo.id),
    ["c1", "c2", "orphan"]
  );
});

test("the same graph in any order lays out identically", () => {
  const reference = positions(layoutSpine(graph.los, IPAD_LANDSCAPE).placed);
  const rand = rng(20260924);
  for (let run = 0; run < 25; run++) {
    const input = shuffled(graph.los, rand).map((lo) => ({
      ...lo,
      prereqIds: shuffled(lo.prereqIds, rand),
    }));
    assert.deepEqual(
      positions(layoutSpine(input, IPAD_LANDSCAPE).placed),
      reference,
      `shuffle ${run}`
    );
  }
});

test("the layout does not mutate its input", () => {
  const input = shuffled(graph.los, rng(7));
  const before = input.map((lo) => lo.id);
  layoutSpine(input, IPAD_LANDSCAPE);
  assert.deepEqual(input.map((lo) => lo.id), before);
});

/* ------------------------------------ FR-3216: packed, centred columns */

test("every column is an evenly spaced stack, one ROW_SPREAD apart, with no other gap", () => {
  const { placed } = layoutSpine(graph.los, IPAD_LANDSCAPE);
  for (const [layer, col] of columns(placed).entries()) {
    for (let i = 1; i < col.length; i++) {
      assert.equal(col[i].cy - col[i - 1].cy, ROW_SPREAD, `column ${layer}, row ${i}`);
    }
    for (const p of col) assert.equal(p.y, p.cy - NODE_H / 2);
  }
});

test("every column is centred on the one midline the map shares", () => {
  const { placed, midY } = layoutSpine(graph.los, IPAD_LANDSCAPE);
  const cols = columns(placed);
  for (const [layer, col] of cols.entries()) {
    const centre = (col[0].cy + col[col.length - 1].cy) / 2;
    assert.equal(centre, midY, `column ${layer} (${col.length} cards)`);
  }
  // a six-card column and a thirteen-card one share it: the short one is
  // centred, not top-aligned and not floated to its parents' height
  assert.equal(cols[0].length, 6);
  assert.equal(cols[0][0].cy, midY - 2.5 * ROW_SPREAD);
});

test("the canvas holds every card: the tallest column starts one headroom down, nothing is clipped", () => {
  const { placed, canvasW, canvasH, nodeW } = layoutSpine(graph.los, IPAD_LANDSCAPE);
  const top = Math.min(...placed.map((p) => p.y));
  assert.equal(top, PAD + ARC_HEADROOM, "the arcs' headroom is above the top row");
  assert.equal(canvasH, Math.max(...placed.map((p) => p.y + NODE_H)) + PAD);
  for (const p of placed) {
    assert.ok(p.y >= PAD + ARC_HEADROOM && p.y + NODE_H <= canvasH - PAD, p.lo.id);
    assert.ok(p.x >= PAD && p.x + nodeW <= canvasW - PAD, p.lo.id);
  }
  // every long-span arc stays on the canvas
  const byId = new Map(placed.map((p) => [p.lo.id, p]));
  for (const e of graph.edges) {
    const curve = edgeCurve(byId.get(e.src)!, byId.get(e.dst)!, nodeW);
    for (const pt of curve) assert.ok(pt.y >= PAD && pt.y <= canvasH, `${e.src} → ${e.dst}`);
  }
});

test("iPad and desktop widths move only x: same rows, no overlapping columns", () => {
  const rows = (w: number) =>
    new Map(layoutSpine(graph.los, w).placed.map((p) => [p.lo.id, p.y]));
  const reference = rows(IPAD_LANDSCAPE);
  for (const w of [820, 1024, 1366, 1920]) {
    assert.deepEqual(rows(w), reference, `width ${w}`);
    const { placed, nodeW } = layoutSpine(graph.los, w);
    assert.ok(nodeW >= MIN_W && nodeW <= MAX_W, `card width ${nodeW} at ${w}`);
    const xs = [...new Set(placed.map((p) => p.x))].sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      assert.ok(xs[i] - xs[i - 1] - nodeW >= GAP_MIN - 1e-9, `gap at ${w}`);
    }
  }
});

test("an empty map is an empty canvas, not a crash", () => {
  const { placed, canvasH } = layoutSpine([], 1000);
  assert.equal(placed.length, 0);
  assert.equal(canvasH, 420);
});

/* ------------------------------------------------------------- layering */

test("computeLayers puts a topic one column past its deepest prerequisite", () => {
  const layers = computeLayers(
    ["a", "b", "c", "d"],
    [
      { src: "a", dst: "b" },
      { src: "b", dst: "c" },
      { src: "a", dst: "c" },
      { src: "a", dst: "d" },
    ]
  );
  assert.deepEqual(Object.fromEntries(layers), { a: 0, b: 1, c: 2, d: 1 });
});
