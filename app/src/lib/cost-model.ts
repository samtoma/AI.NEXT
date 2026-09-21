/**
 * The shape of a cost report, and the arithmetic that has to add up
 * (FR-2401…FR-2403, SC-109, constitution VI).
 *
 * **Pure. No database, no Next, no environment** — `node --test` loads it
 * directly, which is what makes SC-109 ("per-student cost reconciles with the
 * period total to within rounding") a test with fixture rows rather than a
 * claim in a page comment. `lib/cost-queries.ts` owns the SQL and hands its
 * rows here.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE THIS MODULE EXISTS TO HOLD
 * ---------------------------------------------------------------------------
 * **AI spend and upload/OCR spend are separate figures and are never blended**
 * (FR-2402). `surface_kind` separates them at row level so no query can add
 * them by accident; this module keeps them apart all the way to the page, in
 * two named fields rather than one number with a caveat next to it. A single
 * `costUsd` per student is offered ONLY as `reconcileTotal`, and it is named
 * that way so nobody reaches for it to answer "what does a child cost".
 *
 * The third bucket, `unattributed`, is rows written before migration 009 gave
 * the ledger a `surface_kind`. They are not folded into either real bucket:
 * attributing a cost to a function that may not have spent it is precisely
 * what the column exists to prevent.
 */

/* ============================================================== buckets */

export const BUCKETS = ["ai", "upload", "unattributed"] as const;
export type Bucket = (typeof BUCKETS)[number];

/** What a founder reads instead of the stored word (FR-2211). */
export const BUCKET_LABEL: Readonly<Record<Bucket, string>> = {
  ai: "Teaching",
  upload: "Photo / OCR",
  unattributed: "Before cost attribution existed",
};

/**
 * Which bucket a `surface_kind` belongs to.
 *
 * `upload_parse` is the only upload kind and it is named explicitly rather than
 * matched by prefix: a future kind called `upload_something_else` should land
 * here as a deliberate edit, not by accident of its name.
 */
export function bucketOf(surfaceKind: string | null | undefined): Bucket {
  if (surfaceKind === "upload_parse") return "upload";
  if (!surfaceKind || surfaceKind === "unattributed") return "unattributed";
  return "ai";
}

/* ============================================================== figures */

/** A figure and the two things FR-2211 requires beside it: what it counts, how it was priced. */
export type CostFigure = {
  turns: number;
  /** US dollars, imputed at list price. Never described as spent. */
  costUsd: number;
  /** Every token the turns used, all four counters. */
  tokens: number;
  /** `cli-list-price`, `list-price-recomputed`, `unpriced`, or `mixed`. */
  priceBasis: string;
  /** Turns whose tokens were never counted. Their cost is absent, not zero. */
  unpricedTurns: number;
};

export const EMPTY_FIGURE: CostFigure = {
  turns: 0,
  costUsd: 0,
  tokens: 0,
  priceBasis: "cli-list-price",
  unpricedTurns: 0,
};

/** One `(student, bucket)` total, as `cost-queries.ts` selects it. */
export type PerStudentBucketRow = {
  studentId: number;
  displayName: string | null;
  subscriptionStatus: string;
  surfaceKind: string | null;
  turns: number;
  costUsd: number;
  tokens: number;
  priceBasis: string | null;
  unpricedTurns: number;
  firstAt: string | null;
  lastAt: string | null;
};

export type PerStudentCost = {
  studentId: number;
  displayName: string | null;
  subscriptionStatus: string;
  /** Teaching turns: chat and understanding checks. */
  ai: CostFigure;
  /** Photographs: `surface_kind='upload_parse'`. Never added to `ai` for display. */
  upload: CostFigure;
  /** Rows from before the ledger had a `surface_kind`. Usually zero. */
  unattributed: CostFigure;
  /**
   * The three buckets added — for the RECONCILIATION only (SC-109). It is not
   * a per-student headline: FR-2402 says AI and upload/OCR are reported
   * separately, and this is the number the page must not print as "cost".
   */
  reconcileTotalUsd: number;
  firstAt: string | null;
  lastAt: string | null;
  /** Daily imputed cost over the period; the sparkline's only input. */
  series: SeriesPoint[];
};

export type SeriesPoint = {
  /** `YYYY-MM-DD`, a UTC day. */
  day: string;
  costUsd: number;
  turns: number;
  /** True for today, whose figure comes from a live query rather than the rollup. */
  live: boolean;
};

/** One `(student, day)` point as the union query returns it. */
export type SeriesRow = {
  studentId: number;
  day: string;
  costUsd: number;
  turns: number;
  live: boolean;
};

/* ============================================================== folding */

function mergeBasis(a: string, b: string | null | undefined): string {
  if (!b) return a;
  return a === b ? a : "mixed";
}

function addInto(f: CostFigure, r: PerStudentBucketRow): CostFigure {
  return {
    turns: f.turns + r.turns,
    costUsd: f.costUsd + r.costUsd,
    tokens: f.tokens + r.tokens,
    priceBasis: f.turns === 0 ? (r.priceBasis ?? f.priceBasis) : mergeBasis(f.priceBasis, r.priceBasis),
    unpricedTurns: f.unpricedTurns + r.unpricedTurns,
  };
}

/**
 * Bucket rows and day rows into one row per student, ordered by what the page
 * sorts on: total imputed cost, descending, then name.
 *
 * A student with rows in only one bucket still gets both fields, zeroed. A zero
 * here is a real zero — the student is in the list because they have at least
 * one interaction (SC-109) — which is a different fact from a missing row.
 */
export function foldPerStudent(
  bucketRows: readonly PerStudentBucketRow[],
  seriesRows: readonly SeriesRow[] = []
): PerStudentCost[] {
  const byStudent = new Map<number, PerStudentCost>();

  for (const r of bucketRows) {
    let s = byStudent.get(r.studentId);
    if (!s) {
      s = {
        studentId: r.studentId,
        displayName: r.displayName,
        subscriptionStatus: r.subscriptionStatus,
        ai: EMPTY_FIGURE,
        upload: EMPTY_FIGURE,
        unattributed: EMPTY_FIGURE,
        reconcileTotalUsd: 0,
        firstAt: r.firstAt,
        lastAt: r.lastAt,
        series: [],
      };
      byStudent.set(r.studentId, s);
    }
    const bucket = bucketOf(r.surfaceKind);
    s[bucket] = addInto(s[bucket], r);
    s.reconcileTotalUsd += r.costUsd;
    if (r.firstAt && (!s.firstAt || r.firstAt < s.firstAt)) s.firstAt = r.firstAt;
    if (r.lastAt && (!s.lastAt || r.lastAt > s.lastAt)) s.lastAt = r.lastAt;
  }

  for (const p of seriesRows) {
    const s = byStudent.get(p.studentId);
    // A series point for a student with no totals in this period cannot
    // happen, and if it ever does it is dropped rather than inventing a row
    // the totals query never saw.
    if (!s) continue;
    s.series.push({ day: p.day, costUsd: p.costUsd, turns: p.turns, live: p.live });
  }

  for (const s of byStudent.values()) s.series.sort((a, b) => a.day.localeCompare(b.day));

  return [...byStudent.values()].sort(
    (a, b) =>
      b.reconcileTotalUsd - a.reconcileTotalUsd ||
      (a.displayName ?? "").localeCompare(b.displayName ?? "")
  );
}

/* ======================================================= reconciliation */

/**
 * Half a cent. SC-109 says "to within rounding", and the ledger stores six
 * decimal places while the page prints four — so the tolerance is a rounding
 * tolerance and nothing more. A real discrepancy is orders of magnitude bigger
 * than this, because it is a missing student or a double-counted bucket.
 */
export const RECONCILE_EPSILON_USD = 0.000005;

export type Reconciliation = {
  perStudentSumUsd: number;
  periodTotalUsd: number;
  differenceUsd: number;
  matches: boolean;
  studentsCounted: number;
};

/**
 * Does the sum of the per-student figures equal the period total? (SC-109)
 *
 * **Computed, never assumed.** The page prints this, and it prints the
 * difference when it fails rather than hiding the failure behind a tick: a
 * reconciliation line that cannot say "no" is decoration.
 */
export function reconcile(
  perStudent: readonly PerStudentCost[],
  periodTotalUsd: number
): Reconciliation {
  const perStudentSumUsd = perStudent.reduce((n, s) => n + s.reconcileTotalUsd, 0);
  const differenceUsd = perStudentSumUsd - periodTotalUsd;
  return {
    perStudentSumUsd,
    periodTotalUsd,
    differenceUsd,
    matches: Math.abs(differenceUsd) <= RECONCILE_EPSILON_USD,
    studentsCounted: perStudent.length,
  };
}

/**
 * How far the rolled-up series is behind the ledger it is derived from.
 *
 * The series comes from `cost_daily` for closed days; the totals come from
 * `ai_interactions` directly. They agree when the rollup has run. When they do
 * not, the SERIES is the one that is short — a day nobody rolled up — and the
 * console says so instead of drawing a sparkline with a hole in it and letting
 * the reader assume the student was on holiday.
 */
export type RollupFreshness = {
  seriesSumUsd: number;
  ledgerSumUsd: number;
  missingUsd: number;
  /** True when the series accounts for the whole period. */
  complete: boolean;
};

export function rollupFreshness(
  perStudent: readonly PerStudentCost[],
  ledgerTotalUsd: number
): RollupFreshness {
  const seriesSumUsd = perStudent.reduce(
    (n, s) => n + s.series.reduce((m, p) => m + p.costUsd, 0),
    0
  );
  const missingUsd = ledgerTotalUsd - seriesSumUsd;
  return {
    seriesSumUsd,
    ledgerSumUsd: ledgerTotalUsd,
    missingUsd,
    complete: Math.abs(missingUsd) <= RECONCILE_EPSILON_USD,
  };
}

/* ============================================================== periods */

export const PERIODS = [7, 30, 90] as const;
export type PeriodDays = (typeof PERIODS)[number];
export const DEFAULT_PERIOD: PeriodDays = 30;

export function periodOf(v: unknown): PeriodDays {
  const n = Number(v);
  return (PERIODS as readonly number[]).includes(n) ? (n as PeriodDays) : DEFAULT_PERIOD;
}

/**
 * "last 30 days (UTC), ending today" — the period string FR-2211 requires
 * beside every figure, and it says UTC because the ledger and the rollup are
 * both cut on UTC day boundaries and a reader in Cairo is three hours away
 * from assuming otherwise.
 */
export function periodLabel(days: PeriodDays): string {
  return `last ${days} days (UTC), ending today`;
}

/**
 * The UTC days a period covers, oldest first, so a sparkline has an x axis even
 * for a student who was absent most of it. A day with no row is a zero on the
 * chart and is labelled as such — absence of spend, not absence of data.
 */
export function daysOfPeriod(days: PeriodDays, today: Date): string[] {
  const out: string[] = [];
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  for (let i = days - 1; i >= 0; i--) {
    out.push(new Date(end - i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

/** The series padded onto the period's full axis. Missing days become zeros. */
export function denseSeries(
  series: readonly SeriesPoint[],
  days: PeriodDays,
  today: Date
): SeriesPoint[] {
  const byDay = new Map(series.map((p) => [p.day, p]));
  const todayKey = today.toISOString().slice(0, 10);
  return daysOfPeriod(days, today).map(
    (day) => byDay.get(day) ?? { day, costUsd: 0, turns: 0, live: day === todayKey }
  );
}
