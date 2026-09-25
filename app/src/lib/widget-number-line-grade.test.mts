/**
 * @covers FR-1206, FR-1208
 *
 * `number_line_marker`'s set grading names the error, and names the RIGHT one.
 *
 * v0.9.3: three stored questions (q:t2u2-2-1:w001–w003) held the sign-flipped
 * set as their answer key. Correcting the key (migration 032) makes that set
 * the wrong answer it always was — and without a predicate of its own it
 * would have been reported as `missed-values`, whose refutation opens "the
 * value you found genuinely does break the fraction". A student who marked
 * −2 and 3 for 1/((x − 2)(x + 3)) found neither value; telling them one was
 * right would be a second wrong answer from the tutor. So the sign error is
 * `sign-flipped`, checked before the omission, and mapped on those rows to
 * `mc:u1-1-1:transposition-sign`.
 *
 * Pure, no rendering (FR-1208): the grader is `number-line-grade.ts`, which
 * `NumberLineMarker.tsx` calls.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { gradePoints } from "../components/student/widgets/number-line-grade.ts";
import { OK, isKnownPredicate } from "./widget-predicates.ts";

type Row = {
  id: string;
  choices: { kind: string; spec: { targets: number[] }; diagnostics: { predicate: string; misconception_id: string }[] };
};
const bank: Row[] = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../services/extraction/seed/generated/widget-questions.json", import.meta.url)),
    "utf8"
  )
).questions;

test("the correct set is ok, in any order, and a repeated tap does not count twice", () => {
  assert.deepEqual(gradePoints([-3, 2], [-3, 2]), { ok: true, predicate: OK, missing: [], extra: [] });
  assert.equal(gradePoints([-3, 2], [2, -3]).predicate, OK);
  assert.equal(gradePoints([-3, 2], [2, -3, 2]).predicate, OK);
});

test("the three corrected rows: the sign error is diagnosed as sign-flipped and served the transposition refutation", () => {
  const rows = bank.filter((q) => /^q:t2u2-2-1:w00[123]$/.test(q.id));
  assert.equal(rows.length, 3);
  for (const q of rows) {
    const targets = q.choices.spec.targets;
    // what the key used to be, and what a student reading the factors marks
    const flipped = targets.map((v) => -v);
    const g = gradePoints(targets, flipped);
    assert.equal(g.ok, false, `${q.id}: the sign-flipped set is wrong`);
    assert.equal(g.predicate, "sign-flipped", `${q.id}: diagnosed as the sign error`);
    const d = q.choices.diagnostics.find((x) => x.predicate === g.predicate);
    assert.equal(d?.misconception_id, "mc:u1-1-1:transposition-sign", `${q.id}: the diagnosis reaches a refutation`);
    // and the right answer is right
    assert.equal(gradePoints(targets, targets).predicate, OK, `${q.id}: the roots are ok`);
  }
});

test("one sign flipped of two is still the sign error", () => {
  // 1/((x − 2)(x + 3)): 2 right, −3 marked as 3
  assert.deepEqual(gradePoints([-3, 2], [2, 3]), {
    ok: false, predicate: "sign-flipped", missing: [-3], extra: [3],
  });
  assert.equal(gradePoints([-3, 2], [-3, -2]).predicate, "sign-flipped");
});

test("stopping after one root is missed-values, not the sign error", () => {
  assert.deepEqual(gradePoints([-3, 2], [2]), { ok: false, predicate: "missed-values", missing: [-3], extra: [] });
  assert.equal(gradePoints([-3, 2], []).predicate, "missed-values");
  // one right, one unrelated: an omission, the wrong mark is not a negative of it
  assert.equal(gradePoints([-3, 2], [2, 4]).predicate, "missed-values");
  // one flipped AND one missing: the wrong marks are not one-for-one negatives
  assert.equal(gradePoints([-3, 2], [3]).predicate, "missed-values");
});

test("everything marked plus something extra is extra-values", () => {
  assert.deepEqual(gradePoints([-3, 2], [-3, 2, 3]), { ok: false, predicate: "extra-values", missing: [], extra: [3] });
});

test("zero cannot be sign-flipped, and a symmetric set is its own negative", () => {
  assert.equal(gradePoints([0, 3], [0, -3]).predicate, "sign-flipped");
  assert.equal(gradePoints([0], []).predicate, "missed-values");
  assert.equal(gradePoints([-2, 2], [2, -2]).predicate, OK);
});

test("every predicate the grader returns is in number_line_marker's vocabulary", () => {
  const cases: [number[], number[]][] = [
    [[-3, 2], [-3, 2]], [[-3, 2], [3, -2]], [[-3, 2], [2]], [[-3, 2], [-3, 2, 5]],
  ];
  for (const [t, m] of cases) {
    assert.ok(isKnownPredicate("number_line_marker", gradePoints(t, m).predicate));
  }
});
