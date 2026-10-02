/**
 * @covers FR-1205, FR-1206, FR-1208
 *
 * `polygon_builder`'s three grading modes — construct (a named shape),
 * midsegment (the midpoint theorem, graded as a property), and area (any
 * polygon that hits a target area) — pure, no rendering.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gradeArea, gradeConstruct, gradeMidsegment, type Pt,
} from "../components/student/widgets/polygon-grade.ts";
import { OK, isKnownPredicate } from "./widget-predicates.ts";

const pt = (x: number, y: number): Pt => ({ x, y });

/* --------------------------------------------------- construct: triangles */

test("a scalene triangle with three different side lengths is accepted", () => {
  const tri = [pt(0, 0), pt(4, 0), pt(1, 3)];
  assert.equal(gradeConstruct("scalene", tri).predicate, OK);
});

test("an isosceles triangle needs at least two equal sides", () => {
  const isosceles = [pt(0, 0), pt(4, 0), pt(2, 3)];
  assert.equal(gradeConstruct("isosceles", isosceles).predicate, OK);
  const scalene = [pt(0, 0), pt(4, 0), pt(1, 3)];
  const g = gradeConstruct("isosceles", scalene);
  assert.equal(g.ok, false);
  assert.equal(g.predicate, "sides-not-equal");
});

test("a right triangle needs an actual 90° angle", () => {
  const right = [pt(0, 0), pt(4, 0), pt(0, 3)];
  assert.equal(gradeConstruct("right", right).predicate, OK);
  const isosceles = [pt(0, 0), pt(4, 0), pt(2, 3)];
  const g = gradeConstruct("right", isosceles);
  assert.equal(g.ok, false);
  assert.equal(g.predicate, "no-right-angle");
});

test("scalene asked for but built isosceles has no dedicated predicate", () => {
  const isosceles = [pt(0, 0), pt(4, 0), pt(2, 3)];
  const g = gradeConstruct("scalene", isosceles);
  assert.equal(g.ok, false);
  assert.equal(g.predicate, "not-the-shape");
});

test("three collinear points are not a triangle, whatever is asked", () => {
  const collinear = [pt(0, 0), pt(2, 0), pt(4, 0)];
  assert.equal(gradeConstruct("scalene", collinear).predicate, "not-the-shape");
  assert.equal(gradeConstruct("right", collinear).predicate, "not-the-shape");
});

/* ------------------------------------------------ construct: quadrilaterals */

const PARALLELOGRAM = [pt(0, 0), pt(4, 0), pt(5, 3), pt(1, 3)];
const RECTANGLE = [pt(0, 0), pt(4, 0), pt(4, 3), pt(0, 3)];
const RHOMBUS = [pt(0, 0), pt(3, 4), pt(7, 7), pt(4, 3)];
const SQUARE = [pt(0, 0), pt(3, 0), pt(3, 3), pt(0, 3)];
const TRAPEZIUM = [pt(0, 0), pt(4, 0), pt(3, 2), pt(1, 2)];
const KITE = [pt(0, 3), pt(2, 0), pt(0, -2), pt(-2, 0)];
const BOWTIE = [pt(0, 0), pt(4, 4), pt(4, 0), pt(0, 4)];

test("a parallelogram needs both pairs of opposite sides parallel", () => {
  assert.equal(gradeConstruct("parallelogram", PARALLELOGRAM).predicate, OK);
  const g = gradeConstruct("parallelogram", TRAPEZIUM);
  assert.equal(g.ok, false);
  assert.equal(g.predicate, "only-one-pair-parallel");
});

test("a rectangle is a parallelogram plus a right angle", () => {
  assert.equal(gradeConstruct("rectangle", RECTANGLE).predicate, OK);
  const g = gradeConstruct("rectangle", PARALLELOGRAM);
  assert.equal(g.ok, false);
  assert.equal(g.predicate, "no-right-angle");
});

test("a rhombus is a parallelogram with all four sides equal", () => {
  assert.equal(gradeConstruct("rhombus", RHOMBUS).predicate, OK);
  const g = gradeConstruct("rhombus", PARALLELOGRAM);
  assert.equal(g.ok, false);
  assert.equal(g.predicate, "sides-not-equal");
});

test("a square needs the right angle AND the equal sides", () => {
  assert.equal(gradeConstruct("square", SQUARE).predicate, OK);
  assert.equal(gradeConstruct("square", PARALLELOGRAM).predicate, "no-right-angle");
  assert.equal(gradeConstruct("square", RHOMBUS).predicate, "no-right-angle");
  assert.equal(gradeConstruct("square", RECTANGLE).predicate, "sides-not-equal");
});

test("a trapezium is EXACTLY one pair of parallel sides", () => {
  assert.equal(gradeConstruct("trapezium", TRAPEZIUM).predicate, OK);
  // both pairs parallel — a parallelogram wearing the wrong name
  assert.equal(gradeConstruct("trapezium", PARALLELOGRAM).predicate, "not-the-shape");
});

test("a kite is two distinct pairs of adjacent equal sides; a rhombus counts", () => {
  assert.equal(gradeConstruct("kite", KITE).predicate, OK);
  assert.equal(gradeConstruct("kite", RHOMBUS).predicate, OK);
  const g = gradeConstruct("kite", PARALLELOGRAM);
  assert.equal(g.ok, false);
  assert.equal(g.predicate, "sides-not-equal");
});

test("a self-crossing quadrilateral is refused as no shape at all", () => {
  for (const shape of ["parallelogram", "rectangle", "rhombus", "square", "trapezium", "kite"] as const) {
    assert.equal(gradeConstruct(shape, BOWTIE).predicate, "not-the-shape");
  }
});

/* ------------------------------------------------------------ midsegment */

test("the segment joining the two midpoints is parallel and half the third side", () => {
  const triangle: [Pt, Pt, Pt] = [pt(0, 0), pt(6, 0), pt(0, 6)];
  // apex 0 = A: the two sides touching it are AB and AC; the third is BC.
  const g = gradeMidsegment(triangle, 0, pt(3, 0), pt(0, 3));
  assert.equal(g.predicate, OK);
});

test("parallel but the wrong length is midsegment-not-half", () => {
  const triangle: [Pt, Pt, Pt] = [pt(0, 0), pt(6, 0), pt(0, 6)];
  const g = gradeMidsegment(triangle, 0, pt(2, 0), pt(0, 2));
  assert.equal(g.ok, false);
  assert.equal(g.predicate, "midsegment-not-half");
});

test("not even parallel to the third side falls to the generic predicate", () => {
  const triangle: [Pt, Pt, Pt] = [pt(0, 0), pt(6, 0), pt(0, 6)];
  const g = gradeMidsegment(triangle, 0, pt(3, 0), pt(1, 4));
  assert.equal(g.ok, false);
  assert.equal(g.predicate, "not-the-shape");
});

/* ----------------------------------------------------------------- area */

test("a polygon whose area matches the target is accepted, any shape", () => {
  const square4 = [pt(0, 0), pt(4, 0), pt(4, 4), pt(0, 4)]; // area 16
  assert.equal(gradeArea(square4, 16).predicate, OK);
  const triangle = [pt(0, 0), pt(4, 0), pt(0, 3)]; // area 6
  assert.equal(gradeArea(triangle, 6).predicate, OK);
});

test("exactly double the target is the missing ÷2, named on its own", () => {
  const triangle = [pt(0, 0), pt(4, 0), pt(0, 3)]; // area 6
  const g = gradeArea(triangle, 3);
  assert.equal(g.ok, false);
  assert.equal(g.predicate, "area-missing-half");
});

test("any other area mismatch is the generic predicate", () => {
  const triangle = [pt(0, 0), pt(4, 0), pt(0, 3)]; // area 6
  const g = gradeArea(triangle, 4);
  assert.equal(g.ok, false);
  assert.equal(g.predicate, "not-the-shape");
});

test("every predicate this grader can return is in polygon_builder's vocabulary", () => {
  const cases = [
    gradeConstruct("isosceles", [pt(0, 0), pt(4, 0), pt(1, 3)]),
    gradeConstruct("right", [pt(0, 0), pt(4, 0), pt(2, 3)]),
    gradeConstruct("rectangle", PARALLELOGRAM),
    gradeConstruct("rhombus", PARALLELOGRAM),
    gradeConstruct("kite", PARALLELOGRAM),
    gradeConstruct("trapezium", PARALLELOGRAM),
    gradeConstruct("parallelogram", BOWTIE),
    gradeMidsegment([pt(0, 0), pt(6, 0), pt(0, 6)], 0, pt(2, 0), pt(0, 2)),
    gradeArea([pt(0, 0), pt(4, 0), pt(0, 3)], 3),
    gradeArea([pt(0, 0), pt(4, 0), pt(0, 3)], 4),
  ];
  for (const c of cases) {
    assert.ok(isKnownPredicate("polygon_builder", c.predicate), `unknown predicate: ${c.predicate}`);
  }
});
