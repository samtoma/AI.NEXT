/**
 * Grading for `number_line_marker` in points mode: the answer is a SET of
 * whole numbers, and a wrong set is diagnosed, not just marked wrong
 * (FR-1206).
 *
 * Pure, so it is tested without rendering (FR-1208) —
 * `lib/widget-number-line-grade.test.mts`. `NumberLineMarker.tsx` calls it and
 * writes the words; `widget-emission.test.mts` reads this file as part of that
 * widget, so a predicate emitted here is held to the contract like one
 * emitted in the component.
 *
 * THE ORDER OF THE CHECKS IS THE DIAGNOSIS.
 *
 *   sign-flipped   every value marked wrongly is the NEGATIVE of a value that
 *                  was missed: the right sizes with the wrong signs. This is
 *                  the error the excluded values of 1/((x − 2)(x + 3)) invite
 *                  — reading the numbers off the factors and marking −2 and 3
 *                  where the answer is 2 and −3. Checked first, because the
 *                  set it describes also misses values, and calling it
 *                  "missed-values" would serve the refutation for stopping
 *                  after one root ("the value you found genuinely does break
 *                  the fraction") to a student who found neither.
 *   missed-values  part of the answer set is not marked — a half-solved
 *                  denominator. Extra values on top are noise, so a set with
 *                  both reports the omission.
 *   extra-values   everything asked for is marked, plus values that are not.
 *
 * Added in v0.9.3, when three stored questions were found holding the
 * sign-flipped set AS their answer key (migration 032): a correct student was
 * marked wrong, and the sign error was marked right.
 */

import { OK } from "@/lib/widget-predicates";

export type PointsGrade = {
  ok: boolean;
  /** `ok`, or one of number_line_marker's predicates. */
  predicate: string;
  /** Answer values the student did not mark, ascending. */
  missing: number[];
  /** Values the student marked that are not in the answer, ascending. */
  extra: number[];
};

export function gradePoints(targets: readonly number[], marks: readonly number[]): PointsGrade {
  const want = [...new Set(targets)].sort((a, b) => a - b);
  const got = [...new Set(marks)].sort((a, b) => a - b);
  const missing = want.filter((v) => !got.includes(v));
  const extra = got.filter((v) => !want.includes(v));
  if (missing.length === 0 && extra.length === 0) {
    return { ok: true, predicate: OK, missing, extra };
  }

  let pred = "extra-values";
  if (missing.length) {
    pred = "missed-values";
    // Right sizes, wrong signs: the wrong marks are exactly the negatives of
    // the missed values, one for one. (Zero cannot be sign-flipped: −0 is 0.)
    const flipped = missing.map((v) => -v).sort((a, b) => a - b);
    if (flipped.length === extra.length && flipped.every((v, i) => v === extra[i])) {
      pred = "sign-flipped";
    }
  }
  return { ok: false, predicate: pred, missing, extra };
}
