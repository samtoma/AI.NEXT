/**
 * The cost arithmetic, checked.
 *
 * The first test in this file is the one that matters: it is a regression test
 * for research A0.2, the defect that made every input-token figure in the
 * console wrong for three months. `input_tokens` must be UNCACHED input, and
 * the two cache counters must sit beside it rather than inside it.
 *
 * The price table is checked against hand-computed figures, not against itself
 * — a test that recomputed the formula would pass for any prices at all.
 *
 * @covers FR-2401
 * @covers FR-2402
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DRIFT_THRESHOLD,
  LIST_PRICES,
  OUTCOMES,
  OUTCOME_LABEL,
  PRICE_BASES,
  PRICE_BASIS,
  PRICE_BASIS_LABEL,
  PRICE_BASIS_RECOMPUTED,
  PRICE_BASIS_UNPRICED,
  ZERO_TOKENS,
  addTokens,
  costFor,
  driftExceedsThreshold,
  imputedCostUsd,
  isOutcome,
  priceDrift,
  tokensFromUsage,
  totalInputTokens,
} from "./pricing.ts";

/* ------------------------------------------------------------ the defect */

test("input_tokens is UNCACHED input, and the cache counters are beside it", () => {
  // The exact shape the CLI's result line carries.
  const t = tokensFromUsage({
    input_tokens: 1_200,
    cache_creation_input_tokens: 8_000,
    cache_read_input_tokens: 40_000,
    output_tokens: 350,
  });

  assert.equal(t.inputTokens, 1_200, "the old code wrote 49,200 here");
  assert.equal(t.cacheCreationTokens, 8_000);
  assert.equal(t.cacheReadTokens, 40_000);
  assert.equal(t.outputTokens, 350);

  // The four counters partition what the turn used: no token is in two of them.
  assert.equal(
    t.inputTokens + t.cacheCreationTokens + t.cacheReadTokens,
    totalInputTokens(t),
    "the three input counters must sum to everything the model read, exactly once"
  );
  assert.equal(totalInputTokens(t), 49_200);
});

test("a missing, partial or nonsense usage line yields zeros, never NaN", () => {
  assert.deepEqual(tokensFromUsage(undefined), ZERO_TOKENS);
  assert.deepEqual(tokensFromUsage(null), ZERO_TOKENS);
  assert.deepEqual(tokensFromUsage({}), ZERO_TOKENS);
  assert.deepEqual(tokensFromUsage({ output_tokens: 10 }), { ...ZERO_TOKENS, outputTokens: 10 });
  // A NaN in a ledger column is a figure nobody can sum; a negative count is
  // not a thing that happened.
  assert.equal(tokensFromUsage({ input_tokens: Number.NaN }).inputTokens, 0);
  assert.equal(tokensFromUsage({ input_tokens: -5 }).inputTokens, 0);
  assert.equal(tokensFromUsage({ input_tokens: 2.7 }).inputTokens, 3);
});

test("two turns of one rating add counter by counter", () => {
  const a = tokensFromUsage({ input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5 });
  const b = tokensFromUsage({ input_tokens: 300, output_tokens: 40, cache_creation_input_tokens: 7 });
  assert.deepEqual(addTokens(a, b), {
    inputTokens: 400,
    outputTokens: 60,
    cacheReadTokens: 5,
    cacheCreationTokens: 7,
  });
});

/* -------------------------------------------------------- the price table */

test("the published Sonnet 5 rates are what the table says they are", () => {
  // Read from Anthropic's published pricing on 2026-09-21. Written out as
  // literals so a change to the table is a change to this test, deliberately.
  assert.deepEqual(LIST_PRICES["claude-sonnet-5"], {
    input: 2.0,
    output: 10.0,
    cacheWrite5m: 2.5, // 1.25x input
    cacheRead: 0.2, //   0.10x input
  });
});

test("a million of each token type costs the table's own rates", () => {
  const m = 1_000_000;
  assert.equal(
    imputedCostUsd("claude-sonnet-5", { ...ZERO_TOKENS, inputTokens: m }),
    2.0
  );
  assert.equal(
    imputedCostUsd("claude-sonnet-5", { ...ZERO_TOKENS, outputTokens: m }),
    10.0
  );
  assert.equal(
    imputedCostUsd("claude-sonnet-5", { ...ZERO_TOKENS, cacheCreationTokens: m }),
    2.5
  );
  assert.equal(
    imputedCostUsd("claude-sonnet-5", { ...ZERO_TOKENS, cacheReadTokens: m }),
    0.2
  );
});

test("a real turn's imputation matches the figure computed by hand", () => {
  const t = tokensFromUsage({
    input_tokens: 1_200,
    cache_creation_input_tokens: 8_000,
    cache_read_input_tokens: 40_000,
    output_tokens: 350,
  });
  //   1200 * 2.00 / 1e6 = 0.0024
  //    350 * 10.0 / 1e6 = 0.0035
  //   8000 * 2.50 / 1e6 = 0.02
  //  40000 * 0.20 / 1e6 = 0.008
  //                     = 0.0339
  const usd = imputedCostUsd("claude-sonnet-5", t);
  assert.ok(usd !== null);
  assert.equal(Number(usd!.toFixed(6)), 0.0339);
});

test("an unknown model yields no imputation rather than a zero", () => {
  // A zero here would be indistinguishable from a free turn, and the console
  // would print $0.0000 for a model we simply have no published price for.
  assert.equal(imputedCostUsd("claude-opus-5", { ...ZERO_TOKENS, outputTokens: 1_000 }), null);
  assert.equal(imputedCostUsd("", ZERO_TOKENS), null);
});

/* ------------------------------------------------------------- the drift */

test("drift is relative to the larger figure, and symmetric", () => {
  assert.equal(priceDrift(0, 0), 0);
  assert.equal(priceDrift(1, 1), 0);
  assert.equal(priceDrift(1, 0.5), 0.5);
  assert.equal(priceDrift(0.5, 1), 0.5);
  assert.equal(priceDrift(0, 1), 1, "a recomputation against a stored zero is total drift");
});

test("the threshold research A4 named is a tenth, and it is exclusive", () => {
  assert.equal(DRIFT_THRESHOLD, 0.1);
  assert.equal(driftExceedsThreshold(1.0, 0.95), false);
  assert.equal(driftExceedsThreshold(1.0, 0.9), false, "exactly a tenth is not over it");
  assert.equal(driftExceedsThreshold(1.0, 0.8), true);
  // The shape the A0.2 defect would have produced: the recomputation from the
  // real counters is far below a figure inflated by triple-counted cache reads.
  assert.equal(driftExceedsThreshold(0.12, 0.034), true);
});

/* ------------------------------------------------------------- outcomes */

test("the outcome vocabulary matches migration 021's CHECK constraint", () => {
  assert.deepEqual([...OUTCOMES], ["ok", "error", "timeout", "redacted", "refused"]);
  for (const o of OUTCOMES) {
    assert.ok(isOutcome(o));
    assert.ok(OUTCOME_LABEL[o].length > 0, `${o} needs a label a founder can read`);
    assert.ok(
      OUTCOME_LABEL[o] !== o,
      `${o} is a field value, and FR-2211 says no heading is a field name`
    );
  }
  assert.equal(isOutcome("cancelled"), false);
  assert.equal(isOutcome(undefined), false);
});

test("the price basis is the one migration 021 defaults to", () => {
  assert.equal(PRICE_BASIS, "cli-list-price");
});

/* --------------------------------------------------- what a write records */

test("the CLI's own total is taken as given, and labelled as its own", () => {
  const t = tokensFromUsage({ input_tokens: 10, output_tokens: 5 });
  assert.deepEqual(costFor("claude-sonnet-5", t, 0.0123), {
    costUsd: 0.0123,
    priceBasis: PRICE_BASIS,
  });
  // Zero is a real answer from the CLI and must not be mistaken for absence.
  assert.deepEqual(costFor("claude-sonnet-5", t, 0), {
    costUsd: 0,
    priceBasis: PRICE_BASIS,
  });
});

test("an aborted turn is repriced from the counters, not written as free", () => {
  // The sacred-guard path: the child is killed mid-stream, so the result line
  // with total_cost_usd never arrives. The old code wrote five literal zeros.
  const t = tokensFromUsage({
    input_tokens: 1_200,
    cache_read_input_tokens: 40_000,
    output_tokens: 120,
  });
  const c = costFor("claude-sonnet-5", t, null);
  assert.equal(c.priceBasis, PRICE_BASIS_RECOMPUTED);
  assert.ok(c.costUsd !== null && c.costUsd > 0, "a redacted turn cost real money");
  assert.equal(Number(c.costUsd!.toFixed(6)), 0.0116); // 0.0024 + 0.008 + 0.0012
});

test("a turn nobody could count is unpriced, and unpriced is not zero", () => {
  assert.deepEqual(costFor("claude-sonnet-5", ZERO_TOKENS, null), {
    costUsd: null,
    priceBasis: PRICE_BASIS_UNPRICED,
  });
  // An unknown model with real counters is also unpriced rather than free.
  assert.deepEqual(
    costFor("some-future-model", tokensFromUsage({ output_tokens: 900 }), null),
    { costUsd: null, priceBasis: PRICE_BASIS_UNPRICED }
  );
});

test("every basis has a label, and no label is the stored word", () => {
  for (const b of PRICE_BASES) {
    assert.ok(PRICE_BASIS_LABEL[b], `${b} needs a label`);
    assert.notEqual(PRICE_BASIS_LABEL[b], b);
    assert.ok(
      !/spent|paid|charged/i.test(PRICE_BASIS_LABEL[b]!),
      `${b}: no cost label may claim money left an account (research A4.4)`
    );
  }
});
