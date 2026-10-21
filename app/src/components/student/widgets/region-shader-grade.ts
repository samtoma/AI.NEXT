/**
 * Grading for `region_shader` (Tamer 2026-10-21): the student marks a
 * rectangle of the plane — X × Y for two intervals, "the location which
 * represents X × X for X = [−2, 3]" — by dragging two opposite corners onto
 * the grid and setting each edge INCLUDED (solid) or EXCLUDED (dashed), as a
 * number line's ends are filled or hollow.
 *
 * Named errors: `region-swapped` (the intervals exchanged — [c, d] × [a, b] for
 * [a, b] × [c, d], which only differs when the two intervals do);
 * `edge-inclusion-wrong` (the right rectangle, a wrong solid or dashed edge);
 * anything else is `off-target`.
 *
 * Pure; `widget-emission.test.mts` reads this file as part of the widget.
 */

import { OK } from "@/lib/widget-predicates";

export type Range = readonly [number, number];

/** Which edges are EXCLUDED (open): the left and right ends of x, the bottom and top ends of y. */
export interface OpenEdges {
  left: boolean;
  right: boolean;
  bottom: boolean;
  top: boolean;
}

export interface Region {
  x: Range;
  y: Range;
  open: OpenEdges;
}

const same = (a: Range, b: Range) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
const sameEdges = (a: OpenEdges, b: OpenEdges) =>
  a.left === b.left && a.right === b.right && a.bottom === b.bottom && a.top === b.top;

export function gradeRegion(drawn: Region, target: Region): string {
  if (same(drawn.x, target.x) && same(drawn.y, target.y)) return sameEdges(drawn.open, target.open) ? OK : "edge-inclusion-wrong";
  if (!same(target.x, target.y) && same(drawn.x, target.y) && same(drawn.y, target.x)) return "region-swapped";
  return "off-target";
}

/** "[−2, 3] × (0, 4]" — the region in the book's interval notation. */
export function regionText(r: Region, num: (v: number) => string = String): string {
  const iv = (lo: number, hi: number, openLo: boolean, openHi: boolean) =>
    `${openLo ? "(" : "["}${num(lo)}, ${num(hi)}${openHi ? ")" : "]"}`;
  return `${iv(r.x[0], r.x[1], r.open.left, r.open.right)} × ${iv(r.y[0], r.y[1], r.open.bottom, r.open.top)}`;
}
