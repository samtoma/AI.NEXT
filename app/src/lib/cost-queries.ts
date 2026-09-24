import { sequential, withOperator } from "@/lib/db";
import { ENVIRONMENT } from "@/lib/env";
import {
  EMPTY_FIGURE,
  foldPerStudent,
  reconcile,
  rollupFreshness,
  type CostFigure,
  type PerStudentBucketRow,
  type PerStudentCost,
  type PeriodDays,
  type Reconciliation,
  type RollupFreshness,
  type SeriesRow,
} from "@/lib/cost-model";
import {
  OUTCOMES,
  imputedCostUsd,
  priceDrift,
  driftExceedsThreshold,
  tokensFromUsage,
  type Outcome,
} from "@/lib/pricing";
import {
  readTurnLimitsView,
  type CostDetailAccess,
  type TurnLimitsView,
} from "@/lib/turn-threshold-queries";
import { readUploadsView, type UploadsView } from "@/lib/upload-threshold-queries";

/**
 * What the AI actually costs, per student and over time, honestly labelled
 * (contracts/admin.md §6, FR-2401…FR-2403, FR-2407, SC-109).
 *
 * The instrumentation was never the gap. `ai_interactions` has recorded
 * `surface`, `surface_kind`, `cost_usd`, the token counters, `latency_ms`,
 * `student_id` and `environment` on every model call since migration 009. What
 * did not exist was anything that READ it. v0.4.0 added three groupings; this
 * phase adds the two things a commercial decision actually needs — **a series
 * rather than a window total**, and **figures that reconcile** — and fixes the
 * three write-path defects that made the numbers wrong underneath them
 * (`lib/pricing.ts`).
 *
 * ---------------------------------------------------------------------------
 * WHERE EACH FIGURE COMES FROM, AND WHY IT IS NOT ALL ONE SOURCE
 * ---------------------------------------------------------------------------
 * **Totals, per surface, per kind, per outcome, per student: the ledger.**
 * `ai_interactions` itself, filtered to this environment and this period. The
 * per-student totals and the overall total are therefore the same sum grouped
 * two ways, which is what makes SC-109's reconciliation true by CONSTRUCTION
 * rather than by luck — and the page still computes and prints it, because a
 * property nobody checks is a property that stops holding.
 *
 * **The per-student time series: `cost_daily` for closed days, unioned with a
 * live query for today.** A day is rolled up once it is over
 * (`app/scripts/rollup-cost-daily.mts`); today is never stored, because a
 * stored partial day is a figure that silently halves at midnight. The two
 * halves are labelled so a reader can see which is which.
 *
 * Those two sources can disagree in exactly one way: a closed day nobody
 * rolled up. `rollupFreshness` measures that gap and the page names it, rather
 * than drawing a sparkline with a hole and letting the reader assume the
 * student was on holiday.
 *
 * ---------------------------------------------------------------------------
 * THREE RULES THAT ARE NOT STYLE
 * ---------------------------------------------------------------------------
 *  1. **`withOperator`, never `withMaint`.** Every query here is cross-student
 *     by construction — "what does one child cost" is a table with every child
 *     in it — so `ainext_app` would return an empty report rather than refuse,
 *     which is the worst possible failure for a cost page: a zero that looks
 *     like a fact. The cross-student visibility is migration 017's and 021's
 *     grants with `cost-billing` in front of them, not a policy bypass.
 *  2. **Environment first, always** (constitution XI, FR-2407). A cost figure
 *     that blended the frozen baseline with the comparison build would be worse
 *     than no figure: a plausible wrong number used to set a price.
 *  3. **Sequential, never `Promise.all`.** Every query below shares ONE client
 *     inside the `withOperator` callback; pg@9 removed the implicit queuing
 *     that used to make concurrent calls on one client work (`lib/db.ts`).
 *
 * **No student content, anywhere in this file** (FR-2406). Every column
 * selected is an id, a name, a count, a token figure, a dollar figure, a
 * timestamp or a status word. There is no message, no transcript and no
 * preview. **Since v0.9.0 there IS a reply count per conversation** — the turn
 * thresholds are observed rather than enforced (ADR-0023, FR-3403, FR-3404),
 * and how often a conversation reaches one is a number about spend. It is read
 * by `lib/turn-threshold-queries.ts` and carries a count, a surface, a lesson
 * slug and curriculum labels; never a word the student or the tutor wrote.
 * The upload panel (FR-3409) reads `uploads.student_id` and `created_at` and
 * the ledger's `outcome`, never a file, a path or parsed text
 * (`lib/upload-threshold-queries.ts`). **Both panels send a billing-only
 * operator aggregates only**: a conversation or a student beside a turn or
 * upload count is read only for an operator who also holds `student-data`
 * (`costDetailAccess`), so FR-2406's "no turn count of a conversation" holds
 * for `cost-billing` by what is queried, not by what is drawn.
 */

/* ----------------------------------------------------------------- types */

export type CostBySurface = {
  surface: string;
  turns: number;
  costUsd: number;
  /** UNCACHED input. The cache counters are their own fields (research A0.2). */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** mean, not total — the comparable number across surfaces of different volume */
  avgCostUsd: number;
  avgLatencyMs: number;
  priceBasis: string;
};

export type CostByKind = {
  kind: string;
  turns: number;
  costUsd: number;
  priceBasis: string;
};

export type CostByOutcome = {
  outcome: Outcome | "unrecorded";
  turns: number;
  costUsd: number;
};

/**
 * The CLI's imputation against our own recomputation from the counters
 * (research A4, "alternatives considered"). Agreement is evidence the counters
 * are right; a gap is the signal that would have caught the `input_tokens`
 * defect on the day it shipped.
 */
export type PriceCheck = {
  storedUsd: number;
  /** null when no model in the period has a published price on file. */
  recomputedUsd: number | null;
  drift: number | null;
  exceedsThreshold: boolean;
  /** Turns whose tokens were never counted; they are in neither figure. */
  unpricedTurns: number;
  /**
   * Turns written before this release (`priced_at IS NULL`).
   *
   * Their `input_tokens` was the triple-counted figure research A0.2 describes,
   * so the recomputation is EXPECTED to run high on them. The check would
   * otherwise raise a standing alarm about a defect that has already been
   * fixed, and a standing alarm is one nobody reads.
   */
  legacyTurns: number;
  /** Models seen in the period that have no published price recorded. */
  modelsWithoutPrice: string[];
};

export type CostView = {
  environment: string;
  periodDays: PeriodDays;
  /** null when nothing has been logged — distinct from a period that cost zero. */
  totalCostUsd: number | null;
  totalTurns: number;
  /** Teaching and photo/OCR as two figures, never one (FR-2402). */
  ai: CostFigure;
  upload: CostFigure;
  unattributed: CostFigure;
  bySurface: CostBySurface[];
  byKind: CostByKind[];
  byOutcome: CostByOutcome[];
  perStudent: PerStudentCost[];
  reconciliation: Reconciliation;
  freshness: RollupFreshness;
  priceCheck: PriceCheck;
  /** The most recent day the rollup has stored, or null if it has never run. */
  rolledThrough: string | null;
  /**
   * How often conversations reached the per-surface reply thresholds in the
   * period — observed, not enforced (ADR-0023, FR-3403, FR-3404).
   */
  turnLimits: TurnLimitsView;
  /**
   * Photo uploads in the period: counts, parse outcomes and how often a
   * student reached the old daily limit (ADR-0023, FR-3409). Its spend is NOT
   * here — it is `upload` above, the one photo/OCR figure (FR-2402).
   */
  uploads: UploadsView;
};

const num = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};
const str = (v: unknown, fallback: string): string =>
  typeof v === "string" && v.length > 0 ? v : fallback;

/**
 * One UTC day — the same expression `rollup-cost-daily.mts` groups by.
 *
 * Exported (only these two) so `overview-queries.ts`'s cohort-scoped
 * "live today" figure draws the same boundary this page's per-student series
 * does, rather than a second copy of the expression that could drift from
 * this one — which is exactly the "two sources for one dollar figure" failure
 * mode this module's own header warns about. Nothing else here is exported:
 * the query shapes stay this page's, the boundary is the only piece worth
 * sharing.
 */
export const UTC_DAY = `(ai.created_at AT TIME ZONE 'UTC')::date`;
export const TODAY_UTC = `(now() AT TIME ZONE 'UTC')::date`;

/* ------------------------------------------------------------ the query */

export async function getCostView(
  operatorId: number,
  periodDays: PeriodDays,
  /**
   * What the two threshold panels may carry beyond aggregates — from
   * `costDetailAccess(roles)`, never from the request. A billing-only
   * operator's view is built without the per-conversation and per-student
   * reads at all (FR-2406).
   */
  access: CostDetailAccess
): Promise<CostView> {
  // THE PERIOD IS N WHOLE UTC DAYS ENDING TODAY, and the same N in both
  // sources — not "the last 720 hours" in the ledger and "the last 30 dates" in
  // the rollup. Those two differ by a part-day at the far end, which would put
  // a few cents in the series that the totals exclude, and the freshness check
  // would then announce a stale rollup every afternoon. UTC because every
  // timestamp the console prints says UTC.
  const scope = `ai.environment = $1 AND ${UTC_DAY} > ${TODAY_UTC} - $2::int`;
  const args = [ENVIRONMENT, String(periodDays)];

  const [
    totals,
    bySurface,
    byKind,
    byOutcome,
    perStudentRows,
    seriesRows,
    models,
    rolled,
    turnLimits,
    uploads,
  ] = await withOperator(operatorId, (db) =>
      sequential([
        // 1. The period, as one figure. `cost_usd IS NULL` is an UNPRICED turn
        //    — tokens nobody counted — and is reported as a count rather than
        //    folded into the total as if it were free.
        () =>
          db.query(
            `SELECT count(*) AS turns,
                    coalesce(sum(ai.cost_usd), 0) AS cost,
                    count(*) FILTER (WHERE ai.cost_usd IS NULL) AS unpriced,
                    count(*) FILTER (WHERE ai.priced_at IS NULL) AS legacy
               FROM ai_interactions ai WHERE ${scope}`,
            args
          ),
        // 2. BY SURFACE — which feature is expensive. The one that informs what
        //    we charge for (PRD §10, still unset).
        () =>
          db.query(
            `SELECT ai.surface,
                    count(*)                                   AS turns,
                    coalesce(sum(ai.cost_usd), 0)              AS cost,
                    coalesce(sum(ai.input_tokens), 0)          AS input_tokens,
                    coalesce(sum(ai.output_tokens), 0)         AS output_tokens,
                    coalesce(sum(ai.cache_read_tokens), 0)     AS cache_read_tokens,
                    coalesce(sum(ai.cache_creation_tokens), 0) AS cache_creation_tokens,
                    coalesce(avg(ai.cost_usd), 0)              AS avg_cost,
                    coalesce(avg(ai.latency_ms), 0)            AS avg_latency,
                    CASE WHEN count(DISTINCT ai.price_basis) = 1
                         THEN min(ai.price_basis) ELSE 'mixed' END AS price_basis
               FROM ai_interactions ai WHERE ${scope}
              GROUP BY ai.surface ORDER BY cost DESC`,
            args
          ),
        // 3. BY KIND — the OCR guard. `surface_kind` exists precisely so
        //    image-token cost cannot hide inside a blended teaching figure.
        () =>
          db.query(
            `SELECT coalesce(ai.surface_kind, 'unattributed') AS kind,
                    count(*) AS turns,
                    coalesce(sum(ai.cost_usd), 0) AS cost,
                    CASE WHEN count(DISTINCT ai.price_basis) = 1
                         THEN min(ai.price_basis) ELSE 'mixed' END AS price_basis
               FROM ai_interactions ai WHERE ${scope}
              GROUP BY 1 ORDER BY cost DESC`,
            args
          ),
        // 4. BY OUTCOME — a redacted, failed or timed-out turn appears as a
        //    cost line with its outcome, not as a missing row (contracts §6).
        () =>
          db.query(
            `SELECT ai.outcome, count(*) AS turns, coalesce(sum(ai.cost_usd), 0) AS cost
               FROM ai_interactions ai WHERE ${scope}
              GROUP BY 1 ORDER BY turns DESC`,
            args
          ),
        // 5. PER STUDENT, split by kind — the only basis a price can be built
        //    on. Grouped by kind so the AI and upload figures reach the page
        //    already separate and cannot be blended on the way (FR-2402).
        () =>
          db.query(
            `SELECT ai.student_id,
                    st.display_name,
                    st.subscription_status,
                    coalesce(ai.surface_kind, 'unattributed') AS surface_kind,
                    count(*) AS turns,
                    coalesce(sum(ai.cost_usd), 0) AS cost,
                    coalesce(sum(ai.input_tokens), 0)
                      + coalesce(sum(ai.output_tokens), 0)
                      + coalesce(sum(ai.cache_read_tokens), 0)
                      + coalesce(sum(ai.cache_creation_tokens), 0) AS tokens,
                    count(*) FILTER (WHERE ai.cost_usd IS NULL) AS unpriced,
                    CASE WHEN count(DISTINCT ai.price_basis) = 1
                         THEN min(ai.price_basis) ELSE 'mixed' END AS price_basis,
                    min(ai.created_at) AS first_at,
                    max(ai.created_at) AS last_at
               FROM ai_interactions ai
               LEFT JOIN students st ON st.id = ai.student_id
              WHERE ${scope}
              GROUP BY ai.student_id, st.display_name, st.subscription_status,
                       coalesce(ai.surface_kind, 'unattributed')`,
            args
          ),
        // 6. PER STUDENT OVER TIME — the rollup for closed days, UNION a live
        //    query for today (plan A7). Today is never in `cost_daily`, so the
        //    two halves cannot double-count; `live` says which is which.
        () =>
          db.query(
            `SELECT cd.student_id, cd.day::text AS day,
                    sum(cd.cost_usd) AS cost, sum(cd.turns) AS turns,
                    false AS live
               FROM cost_daily cd
              WHERE cd.environment = $1
                AND cd.day > ${TODAY_UTC} - $2::int
                AND cd.day < ${TODAY_UTC}
              GROUP BY cd.student_id, cd.day
              UNION ALL
             SELECT ai.student_id, ${UTC_DAY}::text AS day,
                    coalesce(sum(ai.cost_usd), 0) AS cost, count(*) AS turns,
                    true AS live
               FROM ai_interactions ai
              WHERE ai.environment = $1 AND ${UTC_DAY} = ${TODAY_UTC}
              GROUP BY ai.student_id, ${UTC_DAY}
              ORDER BY 1, 2`,
            args
          ),
        // 7. The price cross-check's inputs: token sums per model, so the
        //    recomputation uses each model's own published rates.
        () =>
          db.query(
            `SELECT ai.model,
                    coalesce(sum(ai.input_tokens), 0)          AS input_tokens,
                    coalesce(sum(ai.output_tokens), 0)         AS output_tokens,
                    coalesce(sum(ai.cache_read_tokens), 0)     AS cache_read_tokens,
                    coalesce(sum(ai.cache_creation_tokens), 0) AS cache_creation_tokens
               FROM ai_interactions ai WHERE ${scope}
              GROUP BY ai.model`,
            args
          ),
        // 8. How current the rollup is, stated as a date rather than implied by
        //    a gap in a chart.
        () =>
          db.query(
            `SELECT max(cd.day)::text AS through FROM cost_daily cd WHERE cd.environment = $1`,
            [ENVIRONMENT]
          ),
        // 9. THE TURN THRESHOLDS — observed, not enforced (ADR-0023). Same
        //    environment, same whole-UTC-day period, on this same client.
        () => readTurnLimitsView(db, periodDays, access),
        // 10. PHOTO UPLOADS — observed, not enforced (ADR-0023, FR-3409).
        //     Counts and outcomes only; the spend is figure 5's upload bucket.
        () => readUploadsView(db, periodDays, access),
      ] as const)
    );

  const totalTurns = num(totals.rows[0]?.turns);
  const totalCostUsd = num(totals.rows[0]?.cost);

  const bucketRows: PerStudentBucketRow[] = perStudentRows.rows.map((r) => ({
    studentId: num(r.student_id),
    displayName: r.display_name ? String(r.display_name) : null,
    subscriptionStatus: str(r.subscription_status, "none"),
    surfaceKind: r.surface_kind ? String(r.surface_kind) : null,
    turns: num(r.turns),
    costUsd: num(r.cost),
    tokens: num(r.tokens),
    priceBasis: r.price_basis ? String(r.price_basis) : null,
    unpricedTurns: num(r.unpriced),
    firstAt: r.first_at ? new Date(r.first_at as string).toISOString() : null,
    lastAt: r.last_at ? new Date(r.last_at as string).toISOString() : null,
  }));

  const series: SeriesRow[] = seriesRows.rows.map((r) => ({
    studentId: num(r.student_id),
    day: String(r.day).slice(0, 10),
    costUsd: num(r.cost),
    turns: num(r.turns),
    live: Boolean(r.live),
  }));

  const perStudent = foldPerStudent(bucketRows, series);

  // The three buckets at the level of the whole period, folded from the same
  // rows the per-student table is folded from — so "teaching against uploads"
  // and the per-student columns cannot disagree.
  const totalsByBucket = foldPerStudent(
    bucketRows.map((r) => ({ ...r, studentId: 0, displayName: null }))
  )[0];

  return {
    environment: ENVIRONMENT,
    periodDays,
    totalTurns,
    totalCostUsd: totalTurns === 0 ? null : totalCostUsd,
    ai: totalsByBucket?.ai ?? EMPTY_FIGURE,
    upload: totalsByBucket?.upload ?? EMPTY_FIGURE,
    unattributed: totalsByBucket?.unattributed ?? EMPTY_FIGURE,
    bySurface: bySurface.rows.map((r) => ({
      surface: String(r.surface),
      turns: num(r.turns),
      costUsd: num(r.cost),
      inputTokens: num(r.input_tokens),
      outputTokens: num(r.output_tokens),
      cacheReadTokens: num(r.cache_read_tokens),
      cacheCreationTokens: num(r.cache_creation_tokens),
      avgCostUsd: num(r.avg_cost),
      avgLatencyMs: num(r.avg_latency),
      priceBasis: str(r.price_basis, "cli-list-price"),
    })),
    byKind: byKind.rows.map((r) => ({
      kind: String(r.kind),
      turns: num(r.turns),
      costUsd: num(r.cost),
      priceBasis: str(r.price_basis, "cli-list-price"),
    })),
    byOutcome: byOutcome.rows.map((r) => ({
      outcome: (OUTCOMES as readonly string[]).includes(String(r.outcome))
        ? (String(r.outcome) as Outcome)
        : "unrecorded",
      turns: num(r.turns),
      costUsd: num(r.cost),
    })),
    perStudent,
    reconciliation: reconcile(perStudent, totalCostUsd),
    freshness: rollupFreshness(perStudent, totalCostUsd),
    priceCheck: buildPriceCheck(models.rows, totalCostUsd, {
      unpricedTurns: num(totals.rows[0]?.unpriced),
      legacyTurns: num(totals.rows[0]?.legacy),
    }),
    rolledThrough: rolled.rows[0]?.through ? String(rolled.rows[0].through) : null,
    turnLimits,
    uploads,
  };
}

/**
 * Tokens x published list price, against the CLI's own totals.
 *
 * Per model, because the rates are per model, and a model with no published
 * price on file contributes NOTHING to the recomputation and is named instead
 * — a silent zero would make the check pass by pretending those turns were
 * free, which is the failure mode the check exists to catch.
 */
function buildPriceCheck(
  rows: readonly Record<string, unknown>[],
  storedUsd: number,
  counts: { unpricedTurns: number; legacyTurns: number }
): PriceCheck {
  let recomputed: number | null = null;
  const modelsWithoutPrice: string[] = [];

  for (const r of rows) {
    const model = String(r.model ?? "");
    const tokens = tokensFromUsage({
      input_tokens: num(r.input_tokens),
      output_tokens: num(r.output_tokens),
      cache_read_input_tokens: num(r.cache_read_tokens),
      cache_creation_input_tokens: num(r.cache_creation_tokens),
    });
    const usd = imputedCostUsd(model, tokens);
    if (usd === null) {
      if (model) modelsWithoutPrice.push(model);
      continue;
    }
    recomputed = (recomputed ?? 0) + usd;
  }

  return {
    storedUsd,
    recomputedUsd: recomputed,
    drift: recomputed === null ? null : priceDrift(storedUsd, recomputed),
    // Not raised while any turn in the period predates the fix: those rows
    // carry the triple-counted input figure and WILL disagree, and an alarm
    // that is always on is an alarm nobody reads. The legacy count is reported
    // beside the figures instead, so the disagreement is explained rather than
    // hidden.
    exceedsThreshold:
      recomputed !== null &&
      modelsWithoutPrice.length === 0 &&
      counts.legacyTurns === 0 &&
      driftExceedsThreshold(storedUsd, recomputed),
    unpricedTurns: counts.unpricedTurns,
    legacyTurns: counts.legacyTurns,
    modelsWithoutPrice: [...new Set(modelsWithoutPrice)].sort(),
  };
}
