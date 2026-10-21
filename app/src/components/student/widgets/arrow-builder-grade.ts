/**
 * Grading for `arrow_builder` (Tamer 2026-10-21): the student DRAWS a relation
 * as an arrow diagram — taps an element of X, then where it goes in Y — and
 * the arrows are graded as a set against the relation's pairs.
 *
 * A wrong diagram is named by what its wrong arrows share: every wrong arrow
 * an answer arrow turned round (b → a for a pair (a, b), drawable when X and Y
 * share elements, as in a relation ON a set) is `arrows-reversed`; any other
 * wrong arrow is `extra-arrows`; none wrong but some missing is
 * `missing-arrows`.
 *
 * Pure; `widget-emission.test.mts` reads this file as part of the widget.
 */

import { OK } from "@/lib/widget-predicates";

export type Arrow = readonly [string, string];

const key = (a: Arrow) => `${a[0]}→${a[1]}`;

export interface ArrowsGrade {
  ok: boolean;
  predicate: string;
  hit: Arrow[];
  extra: Arrow[];
  missed: Arrow[];
}

export function gradeArrows(drawn: readonly Arrow[], pairs: readonly Arrow[]): ArrowsGrade {
  const want = new Set(pairs.map(key));
  const mine = new Set(drawn.map(key));
  const hit = drawn.filter((a) => want.has(key(a)));
  const extra = drawn.filter((a) => !want.has(key(a)));
  const missed = pairs.filter((a) => !mine.has(key(a)));
  if (extra.length === 0 && missed.length === 0) return { ok: true, predicate: OK, hit, extra, missed };
  let predicate = "missing-arrows";
  if (extra.length) {
    const turned = new Set(missed.map((a) => key([a[1], a[0]])));
    predicate = extra.every((a) => turned.has(key(a))) ? "arrows-reversed" : "extra-arrows";
  }
  return { ok: false, predicate, hit, extra, missed };
}
