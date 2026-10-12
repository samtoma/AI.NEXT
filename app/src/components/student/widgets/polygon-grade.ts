/**
 * Grading for `polygon_builder` — properties, not positions (FR-1205).
 *
 * Pure, so it is tested without rendering (FR-1208) — `widget-polygon-grade.test.mts`.
 * `PolygonBuilder.tsx` calls these and writes the words; `widget-emission.test.mts`
 * reads this file as part of that widget, so a predicate emitted here is held to
 * the contract like one emitted in the component.
 *
 * THREE MODES, THREE SHAPES OF CHECK.
 *
 *   construct   the student drags 3 or 4 lattice vertices into a NAMED shape.
 *               Every triangle with the right side/angle pattern is accepted —
 *               there is no stored "the" triangle — and the same for every
 *               quadrilateral. An equilateral triangle is never asked for: three
 *               equal squared-integer side lengths cannot happen on a square
 *               lattice, so the validator refuses that target before this file
 *               ever sees it (FR-1207).
 *   midsegment  the student drags two points that must lie ON two sides of a
 *               FIXED triangle. Graded on the property the midpoint theorem is
 *               about — parallel to the third side, half its length — not on
 *               whether the points sit at the exact midpoint. Because the
 *               points are constrained to the sides (the component's job, not
 *               this one's), "parallel and half" can only be true there in any
 *               case: this is the same "grade the property" idea as the
 *               construct checks, applied to a theorem instead of a shape name.
 *   area        the student drags 3 or 4 FREE vertices to hit a target area.
 *               Any polygon with that area is accepted. The classic slip —
 *               reading off base × height without halving it — lands on
 *               exactly double the target, which is common enough across
 *               triangles and trapezia to name on its own.
 *
 * Side lengths and angles are compared as EXACT INTEGERS wherever the points
 * are lattice points: squared length and the dot/cross product of two integer
 * vectors are themselves integers, so `===` is correct, not an approximation.
 * Only `midsegment` mixes in continuous drag positions, and gets its own
 * tolerance for exactly that reason.
 */

import { OK } from "@/lib/widget-predicates";

export interface Pt {
  x: number;
  y: number;
}

export type TriangleShape = "scalene" | "isosceles" | "right";
export type QuadShape =
  | "parallelogram" | "rectangle" | "rhombus" | "square" | "trapezium" | "kite";
export type PolygonShape = TriangleShape | QuadShape;

export const TRIANGLE_SHAPES: readonly TriangleShape[] = ["scalene", "isosceles", "right"];
export const QUAD_SHAPES: readonly QuadShape[] =
  ["parallelogram", "rectangle", "rhombus", "square", "trapezium", "kite"];

export interface PolygonGrade {
  ok: boolean;
  /** `ok`, or one of polygon_builder's predicates. */
  predicate: string;
}

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x;
const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y;
const len2 = (a: Pt): number => a.x * a.x + a.y * a.y;

/** Signed area × 2 (the shoelace sum) — an exact integer for lattice points. */
function shoelace2(pts: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s;
}

/** Does the interior angle at vertex `i` measure exactly 90°? */
function isRightAt(pts: readonly Pt[], i: number): boolean {
  const n = pts.length;
  const prev = pts[(i - 1 + n) % n];
  const cur = pts[i];
  const next = pts[(i + 1) % n];
  return dot(sub(prev, cur), sub(next, cur)) === 0;
}

function anyRightAngle(pts: readonly Pt[]): boolean {
  return pts.some((_, i) => isRightAt(pts, i));
}

/** Proper crossing test (orientation-based) — used to reject a bowtie
 *  quadrilateral, which is no named shape at all. */
function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const orient = (p: Pt, q: Pt, r: Pt) => cross(sub(q, p), sub(r, p));
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 &&
    (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

/** Non-degenerate and, for a quadrilateral, not self-crossing. */
function isSimplePolygon(pts: readonly Pt[]): boolean {
  if (shoelace2(pts) === 0) return false;
  if (pts.length === 4) {
    if (segmentsCross(pts[0], pts[1], pts[2], pts[3])) return false;
    if (segmentsCross(pts[1], pts[2], pts[3], pts[0])) return false;
  }
  return true;
}

/** Squared side lengths, in vertex order (side i runs from vertex i to i+1). */
function sides2(pts: readonly Pt[]): number[] {
  return pts.map((p, i) => len2(sub(pts[(i + 1) % pts.length], p)));
}

function gradeTriangle(shape: TriangleShape, pts: readonly [Pt, Pt, Pt]): PolygonGrade {
  let pred = "not-the-shape";
  if (!isSimplePolygon(pts)) return { ok: false, predicate: pred };
  const [s0, s1, s2] = sides2(pts);
  const allDifferent = s0 !== s1 && s1 !== s2 && s0 !== s2;
  const twoEqual = s0 === s1 || s1 === s2 || s0 === s2;

  if (shape === "scalene") {
    if (allDifferent) return { ok: true, predicate: OK };
    return { ok: false, predicate: pred }; // no dedicated predicate for "accidentally isosceles"
  }
  if (shape === "isosceles") {
    if (twoEqual) return { ok: true, predicate: OK };
    pred = "sides-not-equal";
    return { ok: false, predicate: pred };
  }
  // right
  if (anyRightAngle(pts)) return { ok: true, predicate: OK };
  pred = "no-right-angle";
  return { ok: false, predicate: pred };
}

function gradeQuad(shape: QuadShape, pts: readonly [Pt, Pt, Pt, Pt]): PolygonGrade {
  let pred = "not-the-shape";
  if (!isSimplePolygon(pts)) return { ok: false, predicate: pred };
  const [A, B, C, D] = pts;
  const sAB = sub(B, A), sBC = sub(C, B), sCD = sub(D, C), sDA = sub(A, D);
  const parAB_CD = cross(sAB, sCD) === 0; // AB ∥ CD
  const parBC_DA = cross(sBC, sDA) === 0; // BC ∥ DA
  const isParallelogram = parAB_CD && parBC_DA;
  const [ab, bc, cd, da] = sides2(pts);
  const allSidesEqual = ab === bc && bc === cd && cd === da;
  const hasRightAngle = anyRightAngle(pts);

  // A parallelogram-family target (parallelogram, rectangle, rhombus, square)
  // starts from the same first check: are both pairs of opposite sides
  // parallel? If not, and exactly one pair is, the student built a trapezium
  // instead — the single most informative thing to say.
  if (!isParallelogram) {
    if (parAB_CD !== parBC_DA) pred = "only-one-pair-parallel";
    if (shape === "parallelogram" || shape === "rectangle" || shape === "rhombus" || shape === "square") {
      return { ok: false, predicate: pred };
    }
  }

  switch (shape) {
    case "parallelogram":
      return { ok: true, predicate: OK }; // isParallelogram is true here

    case "rectangle":
      if (hasRightAngle) return { ok: true, predicate: OK };
      pred = "no-right-angle";
      return { ok: false, predicate: pred };

    case "rhombus":
      if (allSidesEqual) return { ok: true, predicate: OK };
      pred = "sides-not-equal";
      return { ok: false, predicate: pred };

    case "square":
      if (!hasRightAngle) {
        pred = "no-right-angle";
        return { ok: false, predicate: pred };
      }
      if (allSidesEqual) return { ok: true, predicate: OK };
      pred = "sides-not-equal";
      return { ok: false, predicate: pred };

    case "trapezium": {
      // Exclusive definition: EXACTLY one pair of opposite sides parallel.
      // Both pairs parallel is a parallelogram wearing the wrong name; neither
      // pair parallel is not a trapezium at all — neither has a predicate of
      // its own, so both fall to the generic.
      if (parAB_CD !== parBC_DA) return { ok: true, predicate: OK };
      return { ok: false, predicate: pred };
    }

    case "kite": {
      // Two DISTINCT pairs of adjacent sides equal — either axis of symmetry.
      // A rhombus (all four sides equal) satisfies this too and is accepted,
      // same as any other valid instance of the property (FR-1205).
      const kiteOk = (ab === da && bc === cd) || (ab === bc && cd === da);
      if (kiteOk) return { ok: true, predicate: OK };
      pred = "sides-not-equal";
      return { ok: false, predicate: pred };
    }
  }
}

/** `shape ∈ QUAD_SHAPES` picks the four-vertex grader; anything else is a
 *  triangle. Called with the vertex count the payload's `shape` implies. */
export function gradeConstruct(shape: PolygonShape, pts: readonly Pt[]): PolygonGrade {
  if ((QUAD_SHAPES as readonly string[]).includes(shape)) {
    return gradeQuad(shape as QuadShape, pts as [Pt, Pt, Pt, Pt]);
  }
  return gradeTriangle(shape as TriangleShape, pts as [Pt, Pt, Pt]);
}

/**
 * The midpoint theorem, graded as a property.
 *
 * `triangle[apex]` is the vertex shared by the two sides the segment DE
 * connects; the segment is checked against the THIRD side — parallel to it,
 * and half its length. `d` and `e` arrive as whatever the student dragged;
 * the component is what constrains them to the two sides, so a real widget
 * can only ever ask this with points that are already on them, but the pure
 * function itself checks the property alone (so a test can hand it any pair).
 */
export function gradeMidsegment(
  triangle: readonly [Pt, Pt, Pt],
  apex: 0 | 1 | 2,
  d: Pt,
  e: Pt
): PolygonGrade {
  const others = [0, 1, 2].filter((i) => i !== apex) as [number, number];
  const P = triangle[others[0]];
  const Q = triangle[others[1]];
  const pq = sub(Q, P);
  const de = sub(e, d);
  const pqLen = Math.sqrt(len2(pq));
  const deLen = Math.sqrt(len2(de));
  // Scale-relative tolerances: the triangle's own size sets what "on the
  // line" and "half the length" mean, so a fixed epsilon would be too loose
  // on a small triangle and too tight on a large one.
  const parallel = Math.abs(cross(de, pq)) < 1e-6 * Math.max(1, pqLen * deLen);
  const halfLength = Math.abs(deLen - pqLen / 2) < 1e-3 * Math.max(1, pqLen);

  if (parallel && halfLength) return { ok: true, predicate: OK };
  let pred = "not-the-shape";
  if (parallel) pred = "midsegment-not-half";
  return { ok: false, predicate: pred };
}

/**
 * A target area, any polygon shape. The one named misread — base × height
 * with no ÷2 — lands on exactly double the target; it is common to a
 * triangle's ½bh and a trapezium's ½(a+b)h alike, which is why one predicate
 * covers both vertex counts.
 */
export function gradeArea(pts: readonly Pt[], target: number): PolygonGrade {
  let pred = "not-the-shape";
  if (!isSimplePolygon(pts)) return { ok: false, predicate: pred };
  const area = Math.abs(shoelace2(pts)) / 2;
  if (area === target) return { ok: true, predicate: OK };
  if (area === target * 2) pred = "area-missing-half";
  return { ok: false, predicate: pred };
}
