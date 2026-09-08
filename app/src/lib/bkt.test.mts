import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bktUpdate,
  DEFAULT_PARAMS,
  MIN_SCORE,
  MAX_SCORE,
  type BktParams,
} from "./bkt.ts";

/**
 * The six invariants from contracts/bkt.md. Each one exists because getting it
 * wrong would be invisible in normal use and would corrupt the comparison.
 */

// Invariant 1 — direction
test("a correct observation never lowers the estimate; incorrect never raises it", () => {
  for (let prior = 0.05; prior < 0.98; prior += 0.05) {
    const up = bktUpdate(prior, "correct");
    const down = bktUpdate(prior, "incorrect");
    assert.ok(
      up.posterior >= up.prior - 1e-12,
      `correct lowered the estimate from ${prior} to ${up.posterior}`
    );
    assert.ok(
      down.posterior <= down.prior + 1e-12,
      `incorrect raised the estimate from ${prior} to ${down.posterior}`
    );
  }
});

// Invariant 2 — range
test("output stays within [MIN_SCORE, MAX_SCORE] for any prior in [0,1]", () => {
  for (let prior = 0; prior <= 1.0001; prior += 0.02) {
    for (const obs of ["correct", "incorrect"] as const) {
      const { afterTransit } = bktUpdate(prior, obs);
      assert.ok(
        afterTransit >= MIN_SCORE && afterTransit <= MAX_SCORE,
        `afterTransit ${afterTransit} out of range for prior ${prior} / ${obs}`
      );
      assert.ok(Number.isFinite(afterTransit), "afterTransit must be finite");
    }
  }
});

// Invariant 3 — the clamp is load-bearing (the regression that matters most)
test("a confident estimate remains revisable: 20 correct then 1 incorrect drops below the peak", () => {
  let score = DEFAULT_PARAMS.pInit;
  for (let i = 0; i < 20; i++) score = bktUpdate(score, "correct").afterTransit;

  const peak = score;
  assert.ok(peak <= MAX_SCORE, "peak must respect the clamp");

  const after = bktUpdate(peak, "incorrect").afterTransit;
  assert.ok(
    after < peak,
    `saturated: 20 correct reached ${peak}, and an incorrect answer left it at ${after}. ` +
      `An unrevisable estimate is worse than the Elo model this replaces.`
  );
});

// Invariant 4 — cold-start parity with the Elo implementation it replaces
test("default prior equals the Elo implementation's 0.3, so cold start does not lurch", () => {
  assert.equal(DEFAULT_PARAMS.pInit, 0.3);
});

// Invariant 5 — degenerate parameters are refused
test("pGuess + pSlip >= 1 throws rather than silently inverting the update", () => {
  const degenerate: BktParams = { ...DEFAULT_PARAMS, pGuess: 0.6, pSlip: 0.5 };
  assert.throws(() => bktUpdate(0.5, "correct", degenerate), /degenerate/i);

  for (const bad of [0, 1, -0.1, 1.5, NaN]) {
    assert.throws(
      () => bktUpdate(0.5, "correct", { ...DEFAULT_PARAMS, pTransit: bad }),
      /must be strictly between 0 and 1/,
      `pTransit=${bad} should be rejected`
    );
  }
});

// Invariant 6 — determinism
test("same inputs produce the same output, every time", () => {
  const a = bktUpdate(0.42, "incorrect");
  const b = bktUpdate(0.42, "incorrect");
  assert.deepEqual(a, b);
});

// Behavioural sanity beyond the contract: evidence is reported honestly.
test("evidence reports prior, posterior and after-transit as distinct stages", () => {
  const e = bktUpdate(0.5, "correct");
  assert.equal(e.observation, "correct");
  assert.equal(e.prior, 0.5);
  assert.ok(e.posterior > e.prior, "posterior should move on evidence");
  assert.ok(
    e.afterTransit > e.posterior,
    "the learning step should add to the posterior"
  );
});

test("a wrong answer from a low prior stays low rather than collapsing to zero", () => {
  const e = bktUpdate(0.1, "incorrect");
  assert.ok(e.afterTransit >= MIN_SCORE);
  assert.ok(e.afterTransit < 0.2, "should remain a low estimate");
});
