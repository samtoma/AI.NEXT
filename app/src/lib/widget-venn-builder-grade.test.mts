/**
 * @covers FR-1205, FR-1206, FR-1208
 *
 * `venn_builder`'s two modes — shade a named region, fill in every region's
 * count — pure, no rendering.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gradeVennCounts,
  gradeVennShade,
  regionsFor,
  regionsForTarget,
  sumCounts,
  type RegionKey,
} from "../components/student/widgets/venn-builder-grade.ts";
import { isKnownPredicate, OK } from "./widget-predicates.ts";

/* ------------------------------------------------------------- regionsFor / regionsForTarget */

test("regionsFor lists the exclusive zones for 2 and 3 sets", () => {
  assert.deepEqual(regionsFor(2), ["a", "b", "ab", "n"]);
  assert.deepEqual(regionsFor(3), ["a", "b", "c", "ab", "ac", "bc", "abc", "n"]);
});

test("regionsForTarget: union is everything except neither", () => {
  assert.deepEqual([...regionsForTarget("union", 2)].sort(), ["a", "ab", "b"]);
  assert.deepEqual(
    [...regionsForTarget("union", 3)].sort(),
    ["a", "ab", "abc", "ac", "b", "bc", "c"]
  );
});

test("regionsForTarget: intersection is the single centre zone", () => {
  assert.deepEqual([...regionsForTarget("intersection", 2)], ["ab"]);
  assert.deepEqual([...regionsForTarget("intersection", 3)], ["abc"]);
});

test("regionsForTarget: complementA excludes every zone touching A", () => {
  assert.deepEqual([...regionsForTarget("complementA", 2)].sort(), ["b", "n"]);
  assert.deepEqual([...regionsForTarget("complementA", 3)].sort(), ["b", "bc", "c", "n"]);
});

test("regionsForTarget: aOnly/bOnly/cOnly and neither are single zones", () => {
  assert.deepEqual([...regionsForTarget("aOnly", 3)], ["a"]);
  assert.deepEqual([...regionsForTarget("bOnly", 3)], ["b"]);
  assert.deepEqual([...regionsForTarget("cOnly", 3)], ["c"]);
  assert.deepEqual([...regionsForTarget("neither", 3)], ["n"]);
});

/* --------------------------------------------------------------- gradeVennShade */

test("shading exactly the target zones is correct", () => {
  const g = gradeVennShade("aOnly", 2, ["a"]);
  assert.equal(g.predicate, OK);
  assert.equal(g.ok, true);
});

test("shading the whole union when only the intersection was asked for is off-target, not silence", () => {
  const g = gradeVennShade("intersection", 2, ["a", "b", "ab"]);
  assert.equal(g.ok, false);
  assert.ok(isKnownPredicate("venn_builder", g.predicate));
});

test("shading only the overlap when the UNION was asked for is intersection-for-union", () => {
  const g = gradeVennShade("union", 2, ["ab"]);
  assert.equal(g.predicate, "intersection-for-union");
});

test("shading A when the COMPLEMENT of A was asked for is complement-inside-a", () => {
  const g = gradeVennShade("complementA", 2, ["a"]);
  assert.equal(g.predicate, "complement-inside-a");
});

test("shading A and its overlap when 'A only' was asked for is exclusive-drawn-overlapping", () => {
  const g = gradeVennShade("aOnly", 2, ["a", "ab"]);
  assert.equal(g.predicate, "exclusive-drawn-overlapping");
});

test("leaving 'neither' unshaded when the target needs it is neither-region-missed", () => {
  const g = gradeVennShade("complementA", 2, ["b"]); // missing "n"
  assert.equal(g.predicate, "neither-region-missed");
});

test("three-set complementC and cOnly resolve against all three circles", () => {
  const g1 = gradeVennShade("cOnly", 3, ["c"]);
  assert.equal(g1.ok, true);
  const g2 = gradeVennShade("complementC", 3, ["a", "b", "ab", "n"]);
  assert.equal(g2.ok, true);
});

/* -------------------------------------------------------------- gradeVennCounts */

test("filling every region exactly right is correct", () => {
  const target = { a: 8, b: 5, ab: 4, n: 3 };
  const g = gradeVennCounts(2, target, { ...target });
  assert.equal(g.predicate, OK);
});

test("entering the raw clue instead of the exclusive count is overlap-counted-twice", () => {
  // 12 study French, 9 study German, 4 study both, 20 total → exclusive
  // counts are 8, 5, 4, 3. A student who writes the raw 12 into "French
  // only" has double-counted the 4 who study both.
  const target = { a: 8, b: 5, ab: 4, n: 3 };
  const given = { a: 12, b: 5, ab: 4, n: 3 };
  const g = gradeVennCounts(2, target, given, { a: 12, b: 9 });
  assert.equal(g.predicate, "overlap-counted-twice");
});

test("leaving neither at zero when the target has students outside every set is neither-region-missed", () => {
  const target = { a: 8, b: 5, ab: 4, n: 3 };
  const given = { a: 8, b: 5, ab: 4, n: 0 };
  const g = gradeVennCounts(2, target, given);
  assert.equal(g.predicate, "neither-region-missed");
});

test("a wrong count with no nameable cause is off-target", () => {
  const target = { a: 8, b: 5, ab: 4, n: 3 };
  const given = { a: 1, b: 5, ab: 4, n: 3 };
  const g = gradeVennCounts(2, target, given);
  assert.equal(g.predicate, "off-target");
});

test("sumCounts totals every region for the given set count", () => {
  assert.equal(sumCounts(2, { a: 8, b: 5, ab: 4, n: 3 }), 20);
  assert.equal(sumCounts(3, { a: 1, b: 2, c: 3, ab: 4, ac: 5, bc: 6, abc: 7, n: 8 }), 36);
});

/* ------------------------------------------------------------- contract discipline */

test("every predicate either grading function returns is one the contract declares", () => {
  const shadeCases: [Parameters<typeof gradeVennShade>[0], 2 | 3, RegionKey[]][] = [
    ["union", 2, ["ab"]],
    ["complementA", 2, ["a"]],
    ["aOnly", 2, ["a", "ab"]],
    ["complementA", 2, ["b"]],
    ["intersection", 2, ["a"]],
  ];
  for (const [target, sets, shaded] of shadeCases) {
    const g = gradeVennShade(target, sets, shaded);
    assert.ok(isKnownPredicate("venn_builder", g.predicate), `shade ${target}: ${g.predicate}`);
  }

  const target = { a: 8, b: 5, ab: 4, n: 3 };
  const countsCases = [
    { a: 12, b: 5, ab: 4, n: 3 },
    { a: 8, b: 5, ab: 4, n: 0 },
    { a: 1, b: 5, ab: 4, n: 3 },
  ];
  for (const given of countsCases) {
    const g = gradeVennCounts(2, target, given, { a: 12, b: 9 });
    assert.ok(isKnownPredicate("venn_builder", g.predicate), `counts: ${g.predicate}`);
  }
});
