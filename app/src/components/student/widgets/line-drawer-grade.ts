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
  pts: readonly [LinePt, LinePt],
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
