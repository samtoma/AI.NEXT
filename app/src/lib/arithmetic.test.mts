/**
 * Grading a numeric answer must accept the steps that lead to the right
 * number, not just the number itself — "3x4" for a correct_answer of "12".
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { evaluateArithmeticExpression } from "./arithmetic.ts";

test("multiplication written with x, X, × or ⋅ between numbers", () => {
  assert.equal(evaluateArithmeticExpression("3x4"), 12);
  assert.equal(evaluateArithmeticExpression("3X4"), 12);
  assert.equal(evaluateArithmeticExpression("3 x 4"), 12);
  assert.equal(evaluateArithmeticExpression("3×4"), 12);
  assert.equal(evaluateArithmeticExpression("3⋅4"), 12);
});

test("plain arithmetic: *, /, +, -, parens, decimals, unary minus", () => {
  assert.equal(evaluateArithmeticExpression("3*4"), 12);
  assert.equal(evaluateArithmeticExpression("24/2"), 12);
  assert.equal(evaluateArithmeticExpression("10+2"), 12);
  assert.equal(evaluateArithmeticExpression("(3+1)*3"), 12);
  assert.equal(evaluateArithmeticExpression("-3*-4"), 12);
  assert.equal(evaluateArithmeticExpression("6.5+5.5"), 12);
  assert.equal(evaluateArithmeticExpression("2^2 * 3"), 12);
});

test("a bare number with no binary operator is not an expression — the caller's plain-number path owns it", () => {
  assert.equal(evaluateArithmeticExpression("12"), null);
});

test("garbage, algebra and injection attempts are rejected, never thrown", () => {
  for (const junk of [
    "",
    "twelve",
    "3 * x",              // real algebra, not multiplication-by-x notation
    "3x",                 // no trailing operand — not the "3x4" shorthand
    "3*4)",
    "(3*4",
    "3**4",
    "3/0",
    "process.exit(1)",
    "console.log(1)",
    "3;4",
    "3&&4",
    "<script>1</script>",
  ]) {
    assert.doesNotThrow(() => evaluateArithmeticExpression(junk), `junk: ${junk}`);
  }
  assert.equal(evaluateArithmeticExpression("twelve"), null);
  assert.equal(evaluateArithmeticExpression("3 * x"), null);
  assert.equal(evaluateArithmeticExpression("3x"), null);
  assert.equal(evaluateArithmeticExpression("process.exit(1)"), null);
});

test("division by zero is not a valid grade-able answer", () => {
  const result = evaluateArithmeticExpression("3/0");
  assert.ok(result === null || !Number.isFinite(result));
});
