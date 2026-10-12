/**
 * @covers FR-1205, FR-1206, FR-1208
 *
 * `box_plot_builder`'s five-number summary, by the book's own quartile
 * convention (Siyavula Grade 10 §10.4, "the percentile formula" — linear
 * interpolation between closest ranks, confirmed against the worked
 * examples), and its grading. Pure, no rendering.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  altQuartiles, fiveNumberSummary, gradeBoxPlot, median,
} from "../components/student/widgets/box-plot-grade.ts";
import { OK, isKnownPredicate } from "./widget-predicates.ts";

const TEN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/* ------------------------------------------------- the book's own method */

test("the percentile formula on 1..10 matches the book's worked pattern", () => {
  // rank(p) = 1 + p/100 * (n-1); Q1 rank 3.25, median rank 5.5, Q3 rank 7.75 —
  // "between the third and fourth", "halfway between the fifth and sixth"
  // (adjusted for a 10-value set), "between the seventh and eighth".
  const s = fiveNumberSummary(TEN);
  assert.equal(s.min, 1);
  assert.equal(s.q1, 3.25);
  assert.equal(s.median, 5.5);
  assert.equal(s.q3, 7.75);
  assert.equal(s.max, 10);
  assert.deepEqual(s.outliers, []);
});

test("min and max fall out of the same formula, at p=0 and p=100", () => {
  assert.equal(median([5]), 5);
  const s = fiveNumberSummary([4, 1, 3, 2]); // unsorted on purpose
  assert.equal(s.min, 1);
  assert.equal(s.max, 4);
});

test("an odd-sized data set still interpolates correctly", () => {
  // n=9: Q1 rank = 1 + 0.25*8 = 3, exact; median rank 5, exact; Q3 rank 7, exact.
  const nine = [10, 20, 30, 40, 50, 60, 70, 80, 90];
  const s = fiveNumberSummary(nine);
  assert.equal(s.q1, 30);
  assert.equal(s.median, 50);
  assert.equal(s.q3, 70);
});

test("the alternate (split-at-the-median) method differs from the book's", () => {
  const alt = altQuartiles(TEN);
  assert.equal(alt.q1, 3);
  assert.equal(alt.q3, 8);
  const book = fiveNumberSummary(TEN);
  assert.notEqual(alt.q1, book.q1);
  assert.notEqual(alt.q3, book.q3);
});

test("an outlier beyond 1.5×IQR does not stretch the whisker", () => {
  const withOutlier = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
  const s = fiveNumberSummary(withOutlier);
  assert.equal(s.max, 9); // the whisker stops at the last non-outlier value
  assert.deepEqual(s.outliers, [100]);
  assert.equal(s.q1, 3.25);
  assert.equal(s.q3, 7.75);
});

/* -------------------------------------------------------------- grading */

test("the correct five-number summary is accepted", () => {
  const truth = fiveNumberSummary(TEN);
  assert.equal(gradeBoxPlot(TEN, truth).predicate, OK);
});

test("the median of the UNSORTED middle is a named misconception", () => {
  const data = [5, 1, 9, 3, 10, 2, 8, 4, 7, 6]; // a permutation of 1..10
  // unsorted middle = average of data[4], data[5] = (10+2)/2 = 6
  const truth = fiveNumberSummary(data); // q1 3.25, median 5.5, q3 7.75, min 1, max 10
  const g = gradeBoxPlot(data, { ...truth, median: 6 });
  assert.equal(g.ok, false);
  assert.equal(g.predicate, "median-of-unsorted");
});

test("Q1 at the minimum and Q3 at the maximum is the IQR rebuilt as the range", () => {
  const truth = fiveNumberSummary(TEN);
  const g = gradeBoxPlot(TEN, { ...truth, q1: 1, q3: 10 });
  assert.equal(g.ok, false);
  assert.equal(g.predicate, "iqr-as-range");
});

test("the split-at-the-median method, correctly applied, is still the wrong method here", () => {
  const truth = fiveNumberSummary(TEN);
  const alt = altQuartiles(TEN);
  const g = gradeBoxPlot(TEN, { ...truth, q1: alt.q1, q3: alt.q3 });
  assert.equal(g.ok, false);
  assert.equal(g.predicate, "quartile-method");
});

test("dragging the whisker out to the raw outlier is named on its own", () => {
  const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
  const truth = fiveNumberSummary(data); // max (whisker) is 9, not 100
  const g = gradeBoxPlot(data, { ...truth, max: 100 });
  assert.equal(g.ok, false);
  assert.equal(g.predicate, "whisker-to-outlier");
});

test("a data set with no outlier at all never fires whisker-to-outlier", () => {
  const truth = fiveNumberSummary(TEN);
  assert.equal(truth.max, 10); // no fencing needed — the raw max IS the whisker
  assert.equal(gradeBoxPlot(TEN, truth).predicate, OK);
});

test("anything else is the generic predicate", () => {
  const truth = fiveNumberSummary(TEN);
  const g = gradeBoxPlot(TEN, { ...truth, min: 0, q1: 0, median: 0, q3: 0, max: 0 });
  assert.equal(g.ok, false);
  assert.equal(g.predicate, "off-target");
});

test("every predicate this grader can return is in box_plot_builder's vocabulary", () => {
  const truth = fiveNumberSummary(TEN);
  const alt = altQuartiles(TEN);
  const outlierData = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
  const outlierTruth = fiveNumberSummary(outlierData);
  const cases = [
    gradeBoxPlot(TEN, truth),
    gradeBoxPlot(TEN, { ...truth, q1: 1, q3: 10 }),
    gradeBoxPlot(TEN, { ...truth, q1: alt.q1, q3: alt.q3 }),
    gradeBoxPlot(outlierData, { ...outlierTruth, max: 100 }),
    gradeBoxPlot(TEN, { ...truth, min: 0, q1: 0, median: 0, q3: 0, max: 0 }),
  ];
  for (const c of cases) {
    assert.ok(isKnownPredicate("box_plot_builder", c.predicate), `unknown predicate: ${c.predicate}`);
  }
});
