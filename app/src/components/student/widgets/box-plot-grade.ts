/**
 * Grading for `box_plot_builder`: the five-number summary of a data set,
 * graded against the book's own quartile convention.
 *
 * Pure, so it is tested without rendering (FR-1208) —
 * `widget-box-plot-grade.test.mts`. `BoxPlotBuilder.tsx` calls
 * `fiveNumberSummary` to know where the five markers belong and `gradeBoxPlot`
 * to check what the student built; `widget-emission.test.mts` reads this file
 * as part of that widget.
 *
 * THE BOOK'S QUARTILE METHOD (confirmed against Siyavula Grade 10 §10.4,
 * "Using the percentile formula" and the worked examples that follow it):
 * linear interpolation between closest ranks. For a sorted data set of n
 * values, the rank of the p-th percentile is
 *
 *     rank = 1 + (p / 100) * (n - 1)          (1-indexed into the sorted list)
 *
 * and the value is read off by interpolating between the two data points on
 * either side of that rank when it falls between two integers. Q1, the median
 * and Q3 are the 25th, 50th and 75th percentiles by this formula; the minimum
 * and maximum fall out of the SAME formula at p = 0 and p = 100 (the book
 * confirms this explicitly, worked example 11), which is why `percentile`
 * below is the one function both `median` and the quartiles are built from.
 *
 * This is NOT the "split at the median" (Tukey / exclusive) method some other
 * syllabuses teach, where Q1 and Q3 are the medians of the two halves with the
 * overall median itself excluded on odd n. That method is common enough to be
 * its own misconception here (`quartile-method`) — `altQuartiles` computes it
 * on purpose, so the grader can recognise a student who applied it correctly.
 *
 * REACHABILITY (FR-1207): for whole-number data, `rank`'s fractional part is
 * always an exact multiple of 0.25 — p ∈ {25, 50, 75} divides (n − 1) into
 * quarters for ANY integer n. So every quartile of an all-integer data set is
 * itself an exact multiple of 0.25, and the widget's drag handles snap to a
 * 0.25 grid: reachability holds for every integer data set with no separate
 * check, which is why the payload validator only has to require the data
 * to be integers.
 */

import { OK } from "@/lib/widget-predicates";

export interface FiveNumberSummary {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  /** Values beyond 1.5×IQR from the box — drawn as points, not whisker ends. */
  outliers: number[];
}

/** The book's rank formula (worked example 11): 1-indexed, linear
 *  interpolation between the two closest ranks. */
function percentile(sorted: readonly number[], p: number): number {
  const n = sorted.length;
  const rank = 1 + (p / 100) * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const frac = rank - lo;
  const v0 = sorted[lo - 1];
  const v1 = sorted[hi - 1];
  return v0 + frac * (v1 - v0);
}

/** The median by the same rank formula (p = 50) — equivalent to the usual
 *  "middle value / average of the two middle values" definition. */
export function median(sorted: readonly number[]): number {
  return percentile(sorted, 50);
}

/**
 * The split-at-the-median (Tukey / exclusive) method — a different, common
 * convention, and this widget's `quartile-method` misconception.
 */
export function altQuartiles(sorted: readonly number[]): { q1: number; q3: number } {
  const n = sorted.length;
  const half = Math.floor(n / 2);
  const lower = sorted.slice(0, half);
  const upper = n % 2 === 0 ? sorted.slice(half) : sorted.slice(half + 1);
  return { q1: median(lower), q3: median(upper) };
}

/** The five-number summary by the book's method, with 1.5×IQR fencing so the
 *  whiskers stop at the last non-outlier value rather than the raw extremes. */
export function fiveNumberSummary(data: readonly number[]): FiveNumberSummary {
  const sorted = [...data].sort((a, b) => a - b);
  const q1 = percentile(sorted, 25);
  const med = percentile(sorted, 50);
  const q3 = percentile(sorted, 75);
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  const inFence = sorted.filter((v) => v >= lowerFence && v <= upperFence);
  const outliers = sorted.filter((v) => v < lowerFence || v > upperFence);
  return {
    min: inFence[0] ?? sorted[0],
    q1,
    median: med,
    q3,
    max: inFence[inFence.length - 1] ?? sorted[sorted.length - 1],
    outliers,
  };
}

export interface FiveMarks {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
}

export interface BoxPlotGrade {
  ok: boolean;
  /** `ok`, or one of `box_plot_builder`'s predicates. */
  predicate: string;
}

const eq = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

/**
 * Diagnoses are checked in an order that matters, same discipline as
 * `number-line-grade.ts`: the most specific, most likely explanation first,
 * a generic mismatch last.
 */
export function gradeBoxPlot(data: readonly number[], given: FiveMarks): BoxPlotGrade {
  const sorted = [...data].sort((a, b) => a - b);
  const truth = fiveNumberSummary(sorted);

  const allMatch =
    eq(given.min, truth.min) && eq(given.q1, truth.q1) &&
    eq(given.median, truth.median) && eq(given.q3, truth.q3) && eq(given.max, truth.max);
  if (allMatch) return { ok: true, predicate: OK };

  // The middle value of the data AS GIVEN, not sorted first.
  const n = data.length;
  const unsortedMiddle = n % 2
    ? data[(n - 1) / 2]
    : (data[n / 2 - 1] + data[n / 2]) / 2;
  let pred = "off-target";
  if (eq(given.median, unsortedMiddle) && !eq(unsortedMiddle, truth.median)) {
    pred = "median-of-unsorted";
    return { ok: false, predicate: pred };
  }

  // Q1 at the minimum and Q3 at the maximum: the interquartile range
  // rebuilt as the full range.
  const rawMin = sorted[0];
  const rawMax = sorted[sorted.length - 1];
  if (
    eq(given.q1, rawMin) && eq(given.q3, rawMax) &&
    !eq(truth.q1, rawMin) && !eq(truth.q3, rawMax)
  ) {
    pred = "iqr-as-range";
    return { ok: false, predicate: pred };
  }

  // The split-at-the-median method, correctly applied — just not this book's
  // method.
  const alt = altQuartiles(sorted);
  if (
    eq(given.q1, alt.q1) && eq(given.q3, alt.q3) &&
    (!eq(alt.q1, truth.q1) || !eq(alt.q3, truth.q3))
  ) {
    pred = "quartile-method";
    return { ok: false, predicate: pred };
  }

  // A whisker dragged out to the raw extreme instead of stopping at the
  // fence — only a real diagnosis when an outlier actually moved the fence.
  const minIsOutlierPull = eq(given.min, rawMin) && !eq(rawMin, truth.min);
  const maxIsOutlierPull = eq(given.max, rawMax) && !eq(rawMax, truth.max);
  if (minIsOutlierPull || maxIsOutlierPull) {
    pred = "whisker-to-outlier";
    return { ok: false, predicate: pred };
  }

  return { ok: false, predicate: pred };
}
