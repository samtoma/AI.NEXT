/**
 * Grading for `line_drawer` in points mode: the student places two points,
 * and the target is a PAIR of lattice points, in either order.
 *
 * `points-swapped` — "the right numbers in the wrong order (x first, then y)"
 * — is diagnosed only when BOTH points the student placed are the targets
 * with x and y exchanged (under one pairing of handles to targets), and only
 * when she actually moved BOTH handles (consistency review 2026-09-27, A10).
 * Before, ONE handle at a swapped position was enough, so a handle she never
 * touched — sitting where the widget opened, which can happen to be a
 * target's swap, e.g. (-3, -2) for a target (-2, -3) — produced a false
 * "you swapped the points". A target with x = y is its own swap; that is
 * still a swap under the pairing, and the other point decides.
 *
 * Equation mode's diagnosis lives here too (`gradeLineEquation`), so the
 * SYSTEM mode (two lines on one board, Tamer 2026-10-21: "find the solution
 * set graphically") diagnoses each of its lines by exactly the same rules.
 *
 * Pure, so it is tested without rendering (`lib/widget-line-drawer-grade.test.mts`);
 * `widget-emission.test.mts` reads this file as part of the widget.
 */

import { OK } from "@/lib/widget-predicates";

export type LinePt = { x: number; y: number };
export type LineTarget = readonly [readonly [number, number], readonly [number, number]];

export type LinePointsGrade = {
  ok: boolean;
  /** `ok`, or one of line_drawer's points-mode predicates. */
  predicate: string;
};

const at = (p: LinePt, t: readonly [number, number]) => p.x === t[0] && p.y === t[1];
const atSwap = (p: LinePt, t: readonly [number, number]) => p.x === t[1] && p.y === t[0];

export function gradeLinePoints(
  /** the board's handles: the first two are this line's */
  pts: readonly LinePt[],
  through: LineTarget,
  /** whether the student has moved each handle at all */
  moved: readonly [boolean, boolean]
): LinePointsGrade {
  const [t0, t1] = through;
  const ok = (at(pts[0], t0) && at(pts[1], t1)) || (at(pts[0], t1) && at(pts[1], t0));
  if (ok) return { ok: true, predicate: OK };
  let pred = "off-target";
  const bothMoved = moved[0] && moved[1];
  const bothSwapped =
    (atSwap(pts[0], t0) && atSwap(pts[1], t1)) || (atSwap(pts[0], t1) && atSwap(pts[1], t0));
  if (bothMoved && bothSwapped) pred = "points-swapped";
  return { ok: false, predicate: pred };
}

const close = (u: number, v: number) => Math.abs(u - v) < 1e-6;

/** A drawn line (m null when vertical) against y = tm·x + tb: `ok` or equation mode's predicate. */
export function gradeLineEquation(m: number | null, b: number | null, tm: number, tb: number): string {
  if (m === null) return "vertical-line";
  if (close(m, tm) && close(b ?? 0, tb)) return OK;
  if (close(m, tm)) return "intercept-wrong";
  if (tm !== 0 && close(m, -tm)) return "slope-sign-flipped";
  if (tm !== 0 && m !== 0 && close(m, 1 / tm)) return "slope-inverted";
  return "off-target";
}

export type DrawnLine = { m: number | null; b: number | null };
export type TargetLine = { m: number; b: number };

export interface SystemGrade {
  ok: boolean;
  /** `ok`, or the first wrong line's predicate */
  predicate: string;
  /** per drawn line: its predicate against the target it was paired with */
  each: [string, string];
  /** which target each drawn line was paired with */
  pairing: [number, number];
}

/**
 * Two drawn lines against two target lines, in either order: the pairing
 * that gets more lines right (the drawn order on a tie).
 */
export function gradeSystem(drawn: readonly [DrawnLine, DrawnLine], targets: readonly [TargetLine, TargetLine]): SystemGrade {
  const g = (i: number, j: number) => gradeLineEquation(drawn[i].m, drawn[i].b, targets[j].m, targets[j].b);
  const straight: [string, string] = [g(0, 0), g(1, 1)];
  const crossed: [string, string] = [g(0, 1), g(1, 0)];
  const score = (e: [string, string]) => e.filter((x) => x === OK).length;
  const [each, pairing] = score(crossed) > score(straight)
    ? [crossed, [1, 0] as [number, number]]
    : [straight, [0, 1] as [number, number]];
  const wrong = each.find((x) => x !== OK);
  return { ok: !wrong, predicate: wrong ?? OK, each, pairing };
}

/** Where two lines meet: a point, "parallel" (no common point), or "same" (every point). */
export function meeting(a: TargetLine, b: TargetLine): [number, number] | "parallel" | "same" {
  if (close(a.m, b.m)) return close(a.b, b.b) ? "same" : "parallel";
  const x = (b.b - a.b) / (a.m - b.m);
  return [x, a.m * x + a.b];
}
