/**
 * @covers FR-1205, FR-1206, FR-1208
 *
 * `area_model` (algebra tiles) — pure, no rendering. The grading is
 * GEOMETRIC: a correct construction is checked as an actual rectangle
 * (anchor + two edge runs + a fully, exactly filled interior), not as a
 * count of tiles, so most of these tests build a specific arrangement of
 * cells rather than a total.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  expectedTileCounts,
  gradeAreaModel,
  type Cell,
} from "../components/student/widgets/area-model-grade.ts";
import { isKnownPredicate, OK } from "./widget-predicates.ts";

/** Build the FULLY CORRECT tiling for (x+a)(x+b), anchored at (0,0). */
function correctTiling(a: number, b: number): Cell[] {
  const cells: Cell[] = [{ row: 0, col: 0, kind: "x2" }];
  const topKind = a >= 0 ? "xPos" : "xNeg";
  const leftKind = b >= 0 ? "xPos" : "xNeg";
  const unitKind = a * b >= 0 ? "uPos" : "uNeg";
  for (let i = 1; i <= Math.abs(a); i++) cells.push({ row: 0, col: i, kind: topKind });
  for (let j = 1; j <= Math.abs(b); j++) cells.push({ row: j, col: 0, kind: leftKind });
  for (let i = 1; i <= Math.abs(a); i++) {
    for (let j = 1; j <= Math.abs(b); j++) {
      cells.push({ row: j, col: i, kind: unitKind });
    }
  }
  return cells;
}

/* --------------------------------------------------------------- the happy path */

test("a correct tiling of (x+2)(x+3) grades correct", () => {
  const g = gradeAreaModel(2, 3, correctTiling(2, 3));
  assert.equal(g.predicate, OK);
  assert.equal(g.sum, 5);
  assert.equal(g.product, 6);
});

test("a correct tiling with a negative factor, e.g. (x+2)(x-3), grades correct", () => {
  const g = gradeAreaModel(2, -3, correctTiling(2, -3));
  assert.equal(g.ok, true);
  assert.equal(g.sum, -1);
  assert.equal(g.product, -6);
});

test("a correct tiling with BOTH factors negative grades correct", () => {
  const g = gradeAreaModel(-2, -3, correctTiling(-2, -3));
  assert.equal(g.ok, true);
  assert.equal(g.sum, -5);
  assert.equal(g.product, 6);
});

test("a factor of zero on one side (a plain x·(x+b)) is a valid degenerate rectangle", () => {
  const g = gradeAreaModel(0, 3, correctTiling(0, 3));
  assert.equal(g.ok, true);
  assert.equal(g.sum, 3);
  assert.equal(g.product, 0);
});

/* ------------------------------------------------------------------ not-a-rectangle */

test("no x² tile at all is not-a-rectangle", () => {
  const g = gradeAreaModel(2, 3, [{ row: 0, col: 1, kind: "xPos" }]);
  assert.equal(g.predicate, "not-a-rectangle");
});

test("two x² tiles is not-a-rectangle", () => {
  const cells = correctTiling(2, 3);
  cells.push({ row: 5, col: 5, kind: "x2" });
  const g = gradeAreaModel(2, 3, cells);
  assert.equal(g.predicate, "not-a-rectangle");
});

test("a gap in the interior block is not-a-rectangle", () => {
  const cells = correctTiling(2, 2).filter((c) => !(c.row === 1 && c.col === 1));
  const g = gradeAreaModel(2, 2, cells);
  assert.equal(g.predicate, "not-a-rectangle");
});

test("a stray tile outside the block is not-a-rectangle", () => {
  const cells = correctTiling(2, 2);
  cells.push({ row: 6, col: 6, kind: "uPos" });
  const g = gradeAreaModel(2, 3, cells);
  assert.equal(g.predicate, "not-a-rectangle");
});

test("the wrong kind of tile in an otherwise-right cell is not-a-rectangle", () => {
  const cells = correctTiling(2, 2).map((c) =>
    c.row === 1 && c.col === 1 ? { ...c, kind: "xPos" as const } : c
  );
  const g = gradeAreaModel(2, 2, cells);
  assert.equal(g.predicate, "not-a-rectangle");
});

/* ---------------------------------------------------------------- missing-cross-term */

test("x² plus unit tiles with no x-tiles at all is missing-cross-term", () => {
  // (a+b)^2 read as a^2 + b^2: the corner square and a stray constant block,
  // never connected to it by any x-strip.
  const cells: Cell[] = [
    { row: 0, col: 0, kind: "x2" },
    { row: 5, col: 5, kind: "uPos" },
    { row: 5, col: 6, kind: "uPos" },
  ];
  const g = gradeAreaModel(2, 3, cells);
  assert.equal(g.predicate, "missing-cross-term");
});

/* -------------------------------------------------------------- middle-term-sign / constant-sign */

test("the constant term right, the linear term's sign wrong, is middle-term-sign", () => {
  // Target (x+2)(x-3) = x^2 - x - 6. Build with a and b's roles swapped in
  // sign so the product still comes out -6 but the sum comes out +1 not -1.
  const cells = correctTiling(-2, 3); // sum=1, product=-6
  const g = gradeAreaModel(2, -3, cells); // target sum=-1, product=-6
  assert.equal(g.predicate, "middle-term-sign");
});

test("the linear term right, the constant's sign wrong, is constant-sign", () => {
  // Target (x+2)(x+3) = x² + 5x + 6 (sum 5, product 6). A different pair
  // with the SAME sum but the NEGATED product also exists — 6 and −1 solve
  // t² − 5t − 6 = 0 — so building that pair keeps the linear term right
  // while making the constant term wrong by exactly its sign.
  const g = gradeAreaModel(2, 3, correctTiling(6, -1));
  assert.equal(g.sum, 5);
  assert.equal(g.product, -6);
  assert.equal(g.predicate, "constant-sign");
});

/* ------------------------------------------------------------------------ off-target */

test("a valid rectangle matching neither term is off-target", () => {
  const g = gradeAreaModel(2, 3, correctTiling(1, 1)); // sum=2, product=1 vs target sum=5, product=6
  assert.equal(g.predicate, "off-target");
});

/* --------------------------------------------------------------- expectedTileCounts */

test("expectedTileCounts matches the FOIL expansion", () => {
  assert.deepEqual(expectedTileCounts(2, 3), { x2: 1, x: 5, unit: 6 });
  assert.deepEqual(expectedTileCounts(-2, 3), { x2: 1, x: 1, unit: -6 });
});

/* ------------------------------------------------------------- contract discipline */

test("every predicate gradeAreaModel can return is one the contract declares", () => {
  const cases: Cell[][] = [
    [{ row: 0, col: 1, kind: "xPos" }],
    correctTiling(2, 2).filter((c) => !(c.row === 1 && c.col === 1)),
    [{ row: 0, col: 0, kind: "x2" }, { row: 5, col: 5, kind: "uPos" }],
    correctTiling(-2, 3),
    correctTiling(2, -2),
    correctTiling(1, 1),
  ];
  for (const cells of cases) {
    const g = gradeAreaModel(2, 3, cells);
    assert.ok(isKnownPredicate("area_model", g.predicate), `${JSON.stringify(cells)}: ${g.predicate}`);
  }
});
