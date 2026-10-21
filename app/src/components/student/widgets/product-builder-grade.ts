/**
 * Grading for `product_builder`. The whole product X×Y, as it always was, or
 * a RELATION — a subset of X×Y chosen by a rule ("a R b means b = 2a + 4"),
 * `mode: "relation"` with the answer's `pairs` (Tamer 2026-10-21). In relation
 * mode every pair of X×Y is on the board, so a pair the rule leaves out is a
 * real, nameable error: `extra-pairs`.
 *
 * Pure; `widget-emission.test.mts` reads this file as part of the widget.
 */

import { OK } from "@/lib/widget-predicates";

/** The whole product: a wrong pick is a reversed decoy, so it is order confusion (the original rule). */
export function gradeProduct(wrongPicks: number, missed: number): string {
  if (wrongPicks === 0 && missed === 0) return OK;
  return wrongPicks ? "reversed-pairs" : "missing-pairs";
}

/**
 * A relation. `reversed` are the wrong picks that are an answer pair turned
 * round, `outside` the other wrong picks. Every wrong pick a reversal is
 * order confusion; any other wrong pick is a pair the rule does not give.
 */
export function gradeRelation(reversed: number, outside: number, missed: number): string {
  if (reversed + outside === 0 && missed === 0) return OK;
  if (reversed + outside === 0) return "missing-pairs";
  return outside === 0 ? "reversed-pairs" : "extra-pairs";
}
