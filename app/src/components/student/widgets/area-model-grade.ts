/**
 * Grading for `area_model` (algebra tiles) — pure, so it is tested without
 * rendering (FR-1208). `AreaModel.tsx` calls this and draws the result;
 * `widget-emission.test.mts` reads this file as part of that widget, so a
 * predicate emitted here is held to the contract like one emitted in the
 * component.
 *
 * THE TARGET IS ALWAYS (x + a)(x + b) = x² + (a + b)x + ab. A tile
 * construction answers it by TILING A RECTANGLE: one x² tile anchors a
 * corner, a run of x-tiles extends along the top (the "a" edge) and another
 * along the left (the "b" edge), and the block those two runs bound is
 * filled with unit tiles — `top.len × left.len` of them, one for every
 * (top tile, left tile) pair, which is FOIL made physical rather than
 * recited. `top.sign`/`left.sign` carry the sign of a and of b: a run of
 * NEGATIVE x-tiles is a negative edge, exactly the way this course's tile
 * set (`docs/decisions/` widgets ADR) tells positive and negative tiles
 * apart by a pattern rather than a colour.
 *
 * THE RECTANGLE CHECK IS GEOMETRIC, NOT JUST A COUNT. Two students who place
 * the same five tiles in different arrangements have not made the same
 * claim: only one arrangement tiles a rectangle at all, and grading the
 * counts alone would accept a construction that is not one. `gradeAreaModel`
 * finds the anchor, walks the two runs from it, and then requires EVERY
 * placed tile to sit inside the exact block that anchor and those two runs
 * predict — of the right kind, in the right cell. Anything outside that
 * block, or a gap inside it, is `not-a-rectangle` regardless of what the
 * totals would have said.
 */

export type TileKind = "x2" | "xPos" | "xNeg" | "uPos" | "uNeg";

export interface Cell {
  row: number;
  col: number;
  kind: TileKind;
}

export interface AreaGrade {
  ok: boolean;
  predicate: string;
  /** The (x-coefficient, constant) the placed tiles actually represent, once
   *  a rectangle was found at all — `NaN` when no rectangle was found. */
  sum: number;
  product: number;
}

const key = (row: number, col: number) => `${row},${col}`;

function findAt(placed: readonly Cell[], row: number, col: number): Cell | undefined {
  return placed.find((c) => c.row === row && c.col === col);
}

/** Walk a contiguous run of same-signed x-tiles from `(row0,col0)` stepping
 *  by `(dr,dc)` each time. Stops at the first empty cell, the first tile that
 *  is not an x-tile, or a sign change. */
function walkXRun(
  placed: readonly Cell[],
  row0: number,
  col0: number,
  dr: number,
  dc: number
): { len: number; sign: 1 | -1 } {
  let len = 0;
  let sign: 1 | -1 | null = null;
  let r = row0;
  let c = col0;
  for (;;) {
    const cell = findAt(placed, r, c);
    if (!cell || (cell.kind !== "xPos" && cell.kind !== "xNeg")) break;
    const s: 1 | -1 = cell.kind === "xPos" ? 1 : -1;
    if (sign !== null && sign !== s) break;
    sign = s;
    len++;
    r += dr;
    c += dc;
  }
  return { len, sign: sign ?? 1 };
}

/**
 * Grade a tile construction against the target (x + a)(x + b).
 *
 * ORDER IS THE DIAGNOSIS:
 *
 *   not-a-rectangle     no single x² tile anchors the construction, or the
 *                       placed tiles do not exactly cover the block that
 *                       anchor and its two edge runs predict (a gap, a
 *                       stray tile, or the wrong kind in a cell).
 *   missing-cross-term  the x² tile is isolated — no x-tiles on either edge —
 *                       while unit tiles sit elsewhere: the (a+b)x term was
 *                       skipped outright, as in "(a+b)² = a² + b²".
 *   middle-term-sign    the constant term is right and the linear term is
 *                       not — almost always its sign.
 *   constant-sign       the linear term is right and the constant is not.
 *   off-target          a valid rectangle whose totals match neither term.
 */
export function gradeAreaModel(a: number, b: number, placed: readonly Cell[]): AreaGrade {
  const anchors = placed.filter((c) => c.kind === "x2");
  if (anchors.length !== 1) {
    const pred = "not-a-rectangle";
    return { ok: false, predicate: pred, sum: NaN, product: NaN };
  }
  const anchor = anchors[0];

  const top = walkXRun(placed, anchor.row, anchor.col + 1, 0, 1);
  const left = walkXRun(placed, anchor.row + 1, anchor.col, 1, 0);

  // No edge at all on either side: whatever else is on the board cannot be
  // part of a rectangle grown from this anchor. If it is unit tiles, that is
  // the constant term appearing with no linear term beside it — the FOIL
  // cross-term skipped outright, which is nameable; anything messier (an
  // x-tile stranded elsewhere) is just not a rectangle.
  if (top.len === 0 && left.len === 0 && placed.length > 1) {
    const rest = placed.filter((c) => c !== anchor);
    const allUnits = rest.every((c) => c.kind === "uPos" || c.kind === "uNeg");
    let pred: string;
    if (allUnits) pred = "missing-cross-term";
    else pred = "not-a-rectangle";
    return { ok: false, predicate: pred, sum: allUnits ? 0 : NaN, product: NaN };
  }

  const expected = new Map<string, TileKind>();
  expected.set(key(anchor.row, anchor.col), "x2");
  for (let i = 1; i <= top.len; i++) {
    expected.set(key(anchor.row, anchor.col + i), top.sign > 0 ? "xPos" : "xNeg");
  }
  for (let j = 1; j <= left.len; j++) {
    expected.set(key(anchor.row + j, anchor.col), left.sign > 0 ? "xPos" : "xNeg");
  }
  const unitSign = top.sign * left.sign;
  for (let i = 1; i <= top.len; i++) {
    for (let j = 1; j <= left.len; j++) {
      expected.set(key(anchor.row + j, anchor.col + i), unitSign > 0 ? "uPos" : "uNeg");
    }
  }

  const shapeOk =
    placed.length === expected.size &&
    placed.every((cell) => expected.get(key(cell.row, cell.col)) === cell.kind);
  if (!shapeOk) {
    const pred = "not-a-rectangle";
    return { ok: false, predicate: pred, sum: NaN, product: NaN };
  }

  const sum = top.len * top.sign + left.len * left.sign;
  const product = top.len * left.len * unitSign;
  const targetSum = a + b;
  const targetProduct = a * b;

  let pred: string;
  if (sum === targetSum && product === targetProduct) pred = "ok";
  else if (product === targetProduct && sum !== targetSum) pred = "middle-term-sign";
  else if (sum === targetSum && product !== targetProduct) pred = "constant-sign";
  else if (sum === -targetSum) pred = "middle-term-sign";
  else if (product === -targetProduct) pred = "constant-sign";
  else pred = "off-target";

  return { ok: pred === "ok", predicate: pred, sum, product };
}

/** The tile counts a fully correct construction needs — for the palette's
 *  live readout and for building a worked "what it should look like" hint,
 *  never for grading (grading always re-derives from the placed cells). */
export function expectedTileCounts(a: number, b: number): { x2: number; x: number; unit: number } {
  return { x2: 1, x: a + b, unit: a * b };
}
