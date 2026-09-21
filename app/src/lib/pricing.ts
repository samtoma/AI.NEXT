/**
 * What a turn costs, and what that number actually means (research A4.4,
 * data-model §12, constitution VI).
 *
 * **Pure. No database, no Next, no environment.** `node --test` loads it
 * directly, which is the point: the arithmetic that was wrong for three months
 * is now arithmetic a test can look at.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS MODULE EXISTS TO END (research A0.2)
 * ---------------------------------------------------------------------------
 * `api/ask/route.ts` wrote `input_tokens` as
 * `input + cache_creation + cache_read`, with the two cache counters ALSO
 * stored in their own columns. Any sum over the four columns therefore counted
 * cached tokens two or three times, and the console labelled the inflated
 * column "input tokens". The fix is not a smaller expression at one call site —
 * it is one function that three call sites share, so the next surface to log a
 * model call cannot re-derive it wrongly.
 *
 * ---------------------------------------------------------------------------
 * WHAT `cost_usd` IS, AND WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 * The runtime is the **Claude CLI on a subscription**, not an API key. The
 * `total_cost_usd` the CLI reports is what those tokens WOULD have cost at
 * published list price; no money left a bank account per turn. So:
 *
 *   · the stored figure is the CLI's own, unchanged — `PRICE_BASIS` records
 *     that provenance on every row, and `priced_at` records when;
 *   · every console figure says **"imputed at list price"**, never "spent";
 *   · `LIST_PRICES` below is **not** how `cost_usd` is computed. It is the
 *     independent cross-check research A4 recommends in its own "alternatives
 *     considered" — recompute tokens × published price, compare against the
 *     CLI's total, and flag drift over 10%. That check is the one that would
 *     have caught the `input_tokens` defect on the day it shipped, which is the
 *     whole argument for keeping a price table we do not bill from.
 *
 * A price table we do not bill from is a liability if it drifts silently, so
 * `LIST_PRICES` carries the date it was read and a model it does not know
 * produces **no imputation at all** rather than a zero that looks like a fact.
 */

/**
 * How a row's `cost_usd` was arrived at. Three values, and the difference
 * between them is the difference between a figure and a guess.
 *
 *  · `cli-list-price` — the CLI reported `total_cost_usd`. The normal case.
 *  · `list-price-recomputed` — the turn was aborted (the sacred guard tripped,
 *    or it failed) so the CLI's total never arrived, and the cost is this
 *    module's own tokens x published list price from the counters that DID
 *    arrive. Slightly low by construction: generation stopped mid-answer.
 *  · `unpriced` — the turn burned tokens nobody counted. `cost_usd` is NULL,
 *    not zero, and the console reports those turns as a count rather than
 *    folding an unknown into a total as if it were free.
 */
export const PRICE_BASIS = "cli-list-price";
export const PRICE_BASIS_RECOMPUTED = "list-price-recomputed";
export const PRICE_BASIS_UNPRICED = "unpriced";

export const PRICE_BASES = [
  PRICE_BASIS,
  PRICE_BASIS_RECOMPUTED,
  PRICE_BASIS_UNPRICED,
] as const;

/** What a console reader sees instead of the stored word (FR-2211). */
export const PRICE_BASIS_LABEL: Readonly<Record<string, string>> = {
  [PRICE_BASIS]: "imputed at list price, by the CLI",
  [PRICE_BASIS_RECOMPUTED]: "imputed at list price, recomputed from tokens",
  [PRICE_BASIS_UNPRICED]: "not priced — tokens were never counted",
} as const;

/** The shape the `claude` CLI reports usage in, on both `-p` output formats. */
export type CliUsage = {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
};

/** The four counters as the ledger stores them. They do not overlap. */
export type TokenCounts = {
  /** UNCACHED input only. The cache counters are beside it, never inside it. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) && x > 0 ? Math.round(x) : 0;
};

/**
 * The CLI's usage line, split into four non-overlapping counters.
 *
 * This is the only place the split is decided. `inputTokens` is uncached input
 * and nothing else; a caller that wants "everything the model read" asks
 * `totalInputTokens` for it by name, so the two can never be confused by
 * reading a column heading.
 */
export function tokensFromUsage(usage: CliUsage | null | undefined): TokenCounts {
  const u = usage ?? {};
  return {
    inputTokens: n(u.input_tokens),
    outputTokens: n(u.output_tokens),
    cacheReadTokens: n(u.cache_read_input_tokens),
    cacheCreationTokens: n(u.cache_creation_input_tokens),
  };
}

/** Add two turns' counters — the retry loop in `/api/understanding` needs it. */
export function addTokens(a: TokenCounts, b: TokenCounts): TokenCounts {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
  };
}

export const ZERO_TOKENS: TokenCounts = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
};

/**
 * Everything the model read on this turn: uncached input plus both cache
 * counters. **This is what the old `input_tokens` column held** — correct as a
 * concept, wrong as that column's name, and available here for anyone who
 * genuinely wants it.
 */
export function totalInputTokens(t: TokenCounts): number {
  return t.inputTokens + t.cacheReadTokens + t.cacheCreationTokens;
}

/* ===========================================================================
 * The price table — for the cross-check, never for the ledger
 * ======================================================================== */

export type ModelPrice = {
  /** USD per million UNCACHED input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
  /** USD per million tokens written to the 5-minute cache (1.25x input). */
  cacheWrite5m: number;
  /** USD per million tokens read from cache (0.1x input). */
  cacheRead: number;
};

/**
 * Anthropic's published list prices, USD per million tokens, **read
 * 2026-09-21**.
 *
 * Claude Sonnet 5 is the only model this product calls — `api/ask`,
 * `api/understanding` and `lib/uploads` all pass `--model claude-sonnet-5`. The
 * cache multipliers are the published ones: a 5-minute cache write is 1.25x the
 * base input rate and a cache read is 0.1x it.
 *
 * A model NOT in this table yields `null` from `imputedCostUsd`, and the
 * console prints "no published price recorded for this model" rather than a
 * zero. A zero would be indistinguishable from a free turn.
 */
export const LIST_PRICES: Readonly<Record<string, ModelPrice>> = {
  "claude-sonnet-5": { input: 2.0, output: 10.0, cacheWrite5m: 2.5, cacheRead: 0.2 },
} as const;

/** The date the table above was read, printed beside every figure derived from it. */
export const LIST_PRICES_READ_ON = "2026-09-21";

const PER_MILLION = 1_000_000;

/**
 * Tokens x published list price, or `null` for a model with no published price
 * on file.
 *
 * **Not the stored cost.** `ai_interactions.cost_usd` is the CLI's own
 * `total_cost_usd`; this recomputes the same quantity from the counters so the
 * two can be compared. Agreement is evidence the counters are right; divergence
 * is the signal research A4 asked for.
 */
export function imputedCostUsd(model: string, t: TokenCounts): number | null {
  const p = LIST_PRICES[model];
  if (!p) return null;
  return (
    (t.inputTokens * p.input +
      t.outputTokens * p.output +
      t.cacheCreationTokens * p.cacheWrite5m +
      t.cacheReadTokens * p.cacheRead) /
    PER_MILLION
  );
}

/** What a ledger write records about money: the figure, and how it was reached. */
export type LedgerCost = {
  /** NULL when nothing countable is known. Never zero as a stand-in for unknown. */
  costUsd: number | null;
  priceBasis: string;
};

/**
 * The one decision every ledger write makes, in one place.
 *
 * `cliTotalUsd` is the CLI's `total_cost_usd` when its result line arrived, and
 * `null` when it did not — which is exactly what happens on the two paths this
 * phase fixed: the sacred guard kills the child mid-stream, and a failed or
 * timed-out call never reports. In that case the counters seen on the stream so
 * far are repriced here rather than written as zeros.
 */
export function costFor(
  model: string,
  tokens: TokenCounts,
  cliTotalUsd: number | null | undefined
): LedgerCost {
  if (typeof cliTotalUsd === "number" && Number.isFinite(cliTotalUsd)) {
    return { costUsd: cliTotalUsd, priceBasis: PRICE_BASIS };
  }
  const recomputed = imputedCostUsd(model, tokens);
  if (recomputed !== null && totalInputTokens(tokens) + tokens.outputTokens > 0) {
    return { costUsd: recomputed, priceBasis: PRICE_BASIS_RECOMPUTED };
  }
  return { costUsd: null, priceBasis: PRICE_BASIS_UNPRICED };
}

/** How far apart the CLI's figure and the recomputation are, as a fraction. */
export function priceDrift(storedUsd: number, recomputedUsd: number): number {
  if (storedUsd === 0 && recomputedUsd === 0) return 0;
  const base = Math.max(Math.abs(storedUsd), Math.abs(recomputedUsd));
  return base === 0 ? 0 : Math.abs(storedUsd - recomputedUsd) / base;
}

/** Research A4's threshold: over a tenth apart and somebody should look. */
export const DRIFT_THRESHOLD = 0.1;

export function driftExceedsThreshold(storedUsd: number, recomputedUsd: number): boolean {
  return priceDrift(storedUsd, recomputedUsd) > DRIFT_THRESHOLD;
}

/* ===========================================================================
 * Outcomes
 * ======================================================================== */

/** `ai_interactions.outcome` — the CHECK constraint in migration 021, in TypeScript. */
export const OUTCOMES = ["ok", "error", "timeout", "redacted", "refused"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** What a console reader is shown instead of the stored word (FR-2211). */
export const OUTCOME_LABEL: Readonly<Record<Outcome, string>> = {
  ok: "Answered",
  error: "Backend failed",
  timeout: "Timed out",
  redacted: "Suppressed by the sacred guard",
  refused: "Refused by the model",
} as const;

export function isOutcome(v: unknown): v is Outcome {
  return typeof v === "string" && (OUTCOMES as readonly string[]).includes(v);
}
