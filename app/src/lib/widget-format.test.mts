import { test } from "node:test";
import assert from "node:assert/strict";
import { lineText, numText, ratioText } from "../components/student/widgets/format.ts";

/**
 * The readout under a figure is the teaching surface of these widgets — it is
 * what the student watches while they drag. Written in the wrong notation it
 * quietly teaches something the exam will not accept.
 */

test("lattice slopes come out as fractions, never decimals", () => {
  assert.equal(numText(0.75), "3/4");
  assert.equal(numText(0.5), "1/2");
  assert.equal(numText(-1.5), "−3/2");
  assert.equal(numText(2), "2");
  assert.equal(numText(-3), "−3");
});

test("a value that is not a small fraction stays a decimal", () => {
  // Forcing 271/1250 on an irrational-ish value would be worse than useless.
  assert.equal(numText(Math.SQRT2), "1.414");
  assert.equal(numText(6.4, 3), "6.4");
});

test("the sign is a minus sign, not a hyphen", () => {
  assert.ok(numText(-0.75).startsWith("−"));
  assert.ok(!numText(-0.75).includes("-"));
});

test("a fraction never carries a negative denominator", () => {
  assert.equal(ratioText(3, -4), "−3/4");
  assert.equal(ratioText(-3, -4), "3/4");
});

test("a ratio that divides exactly is a whole number", () => {
  assert.equal(ratioText(6, 3), "2");
  assert.equal(ratioText(-6, 3), "−2");
});

test("equations are written the way a marker expects", () => {
  assert.equal(lineText(2, -1), "y = 2x − 1");
  assert.equal(lineText(1, 0), "y = x");          // never "1x"
  assert.equal(lineText(-1, 3), "y = −x + 3");
  assert.equal(lineText(0, 4), "y = 4");           // never "0x"
  assert.equal(lineText(3, 0), "y = 3x");          // never "+ 0"
  assert.equal(lineText(2, -3), "y = 2x − 3");     // never "+ −3"
  assert.equal(lineText(0.75, 0.25), "y = 3/4x + 1/4");
});

test("a vertical line is x = k, not a slope of infinity", () => {
  assert.equal(lineText(null, 0, 3), "x = 3");
  assert.equal(lineText(null, 0, -2), "x = −2");
});
