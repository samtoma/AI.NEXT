/**
 * Grading for `pair_plotter`. One point (`target`), as it always was, or a SET
 * of points (`targets`, Tamer 2026-10-21: "plot these ordered pairs", a
 * trapezoid's four vertices, a frequency polygon's points) graded as a set —
 * the order the student taps them in does not matter.
 *
 * A wrong set is diagnosed by what its wrong points have in common: every
 * wrong point a missed target with x and y exchanged is `swapped-coordinates`;
 * every one a missed target reflected (right distances, wrong signs) is
 * `wrong-quadrant`; any other wrong point is `extra-points`; no wrong point,
 * but some missed, is `missing-points`.
 *
 * Pure, so it is tested without rendering; `widget-emission.test.mts` reads
 * this file as part of the widget.
 */

import { OK } from "@/lib/widget-predicates";

export type P = readonly [number, number];

const same = (a: P, b: P) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
const swapOf = (a: P, t: P) => same(a, [t[1], t[0]]);
const mirrorOf = (a: P, t: P) =>
  Math.abs(Math.abs(a[0]) - Math.abs(t[0])) < 1e-9 && Math.abs(Math.abs(a[1]) - Math.abs(t[1])) < 1e-9 && !same(a, t);

/** One point: the original rules, unchanged. */
export function gradePoint(picked: P, target: P): string {
  if (same(picked, target)) return OK;
  if (swapOf(picked, target)) return "swapped-coordinates";
  return mirrorOf(picked, target) ? "wrong-quadrant" : "off-target";
}

export interface PointsGrade {
  ok: boolean;
  predicate: string;
  hit: P[];
  extra: P[];
  missed: P[];
}

/** A set of points against the targets. */
export function gradePoints(picked: readonly P[], targets: readonly P[]): PointsGrade {
  const hit = picked.filter((p) => targets.some((t) => same(p, t)));
  const extra = picked.filter((p) => !targets.some((t) => same(p, t)));
  const missed = targets.filter((t) => !picked.some((p) => same(p, t)));
  if (extra.length === 0 && missed.length === 0) return { ok: true, predicate: OK, hit, extra, missed };
  let predicate = "missing-points";
  if (extra.length) {
    predicate = extra.every((p) => missed.some((t) => swapOf(p, t)))
      ? "swapped-coordinates"
      : extra.every((p) => missed.some((t) => mirrorOf(p, t)))
        ? "wrong-quadrant"
        : "extra-points";
  }
  return { ok: false, predicate, hit, extra, missed };
}
