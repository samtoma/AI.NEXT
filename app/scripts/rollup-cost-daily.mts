/**
 * Refresh `cost_daily` from `ai_interactions` (plan A7, data-model §12).
 *
 * ---------------------------------------------------------------------------
 * FOR WHOEVER RUNS THIS
 * ---------------------------------------------------------------------------
 *   npm run rollup:cost                 # yesterday and the six days before it
 *   npm run rollup:cost -- --since 2026-09-01
 *   npm run rollup:cost -- --all        # every closed day on record
 *
 * That `npm run` target is:
 *
 *   node --import ./scripts/load-env.mjs --import ./scripts/ts-resolver.mjs scripts/rollup-cost-daily.mts
 *
 * — a plain `node scripts/rollup-cost-daily.mts` will NOT see
 * `DATABASE_URL_MAINT`: only `next dev`/`next build` load `app/.env.local`
 * automatically, and `withMaint()` (lib/db.ts) fails closed without it.
 * `load-env.mjs` is what fills that in for a standalone `node` run; it never
 * overrides a variable already exported (cron, CI, or `local-dev.sh`'s own
 * inline exports all still win).
 *
 * Safe to run at any time, any number of times: each day is an upsert keyed by
 * (environment, student, day, surface_kind), so a second run over the same
 * range writes the same numbers. Nothing is deleted and no source row is
 * touched — `ai_interactions` is append-only and this only reads it.
 *
 * **Run it nightly** (cron, a little after midnight UTC) once this is on a box.
 * There is no scheduler in this repo yet, deliberately: `scripts/local-dev.sh`
 * invokes it once at the end of setup so a fresh laptop has a populated table,
 * and the console does not depend on it having run — today is always answered
 * by a live query, and a missing closed day shows as a gap rather than as a
 * zero (see `lib/cost-queries.ts`).
 *
 * ---------------------------------------------------------------------------
 * TWO DECISIONS WORTH KNOWING
 * ---------------------------------------------------------------------------
 * **CLOSED DAYS ONLY.** A day is rolled up when it is over. Storing a partial
 * "today" would mean the console had to decide per render whether the stored
 * row was complete, and the first time it got that wrong it would show a
 * student's spend halving at midnight. So today is never in this table; the
 * console unions the stored days with a live query and says which is which.
 * Everything below is in **UTC days**, because every timestamp the console
 * prints says UTC (`components/console/ui.tsx`).
 *
 * **`ainext_maint`, not the console's role.** This writes a cross-student
 * table; `ainext_operator` holds SELECT on it and nothing more, and
 * `ainext_app` holds nothing at all (migration 021). A rollup is a script, and
 * `withMaint` is the seam scripts use.
 */

import { withMaint } from "../src/lib/db.ts";

/* -------------------------------------------------------------- arguments */

const argv = process.argv.slice(2);
const has = (flag: string) => argv.includes(flag);
const valueOf = (flag: string): string | null => {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1]! : null;
};

/** How far back a bare run goes: yesterday and the six days before it. */
const DEFAULT_WINDOW_DAYS = 7;

if (has("--help") || has("-h")) {
  console.log(
    [
      "rollup-cost-daily — refresh cost_daily from ai_interactions",
      "",
      "  --since YYYY-MM-DD   roll up every closed day from this date onward",
      "  --all                roll up every closed day on record",
      "  (no flags)           roll up the last 7 closed days",
      "",
      "Closed days only: today is answered live by the console and is never stored.",
    ].join("\n")
  );
  process.exit(0);
}

const since = valueOf("--since");
if (since !== null && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  console.error(`--since "${since}" is not a YYYY-MM-DD date. Refusing to guess a range.`);
  process.exit(2);
}

/* ------------------------------------------------------------------ query */

/**
 * One UTC day, the same expression the console's live query uses. Every bound
 * below is stated in terms of it, so the range and the grouping cannot disagree
 * about where a day begins.
 */
const UTC_DAY = `(ai.created_at AT TIME ZONE 'UTC')::date`;
const TODAY_UTC = `(now() AT TIME ZONE 'UTC')::date`;

/**
 * The lower bound as a SQL expression plus its parameters.
 *
 * `--all` is deliberately not the default. The ledger grows without bound and
 * a nightly job that rescans all of history to write the same rows again is a
 * job somebody eventually turns off.
 */
const bound =
  has("--all")
    ? { sql: "true", params: [] as string[], label: "every closed day on record" }
    : since !== null
      ? { sql: `${UTC_DAY} >= $1::date`, params: [since], label: `from ${since}` }
      : {
          sql: `${UTC_DAY} >= ${TODAY_UTC} - $1::int`,
          params: [String(DEFAULT_WINDOW_DAYS)],
          label: `the last ${DEFAULT_WINDOW_DAYS} closed days`,
        };

const SQL = `
INSERT INTO cost_daily
  (environment, student_id, day, surface_kind, turns,
   input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
   cost_usd, latency_p50_ms, latency_p95_ms, errors, price_basis, rolled_up_at)
SELECT
  ai.environment,
  ai.student_id,
  ${UTC_DAY}                                            AS day,
  -- A row written before migration 009 has no kind. It is reported as
  -- 'unattributed' rather than folded into 'chat': attributing a cost to a
  -- function that may not have spent it is what surface_kind exists to prevent.
  coalesce(ai.surface_kind, 'unattributed')             AS surface_kind,
  count(*)                                              AS turns,
  coalesce(sum(ai.input_tokens), 0)                     AS input_tokens,
  coalesce(sum(ai.output_tokens), 0)                    AS output_tokens,
  coalesce(sum(ai.cache_read_tokens), 0)                AS cache_read_tokens,
  coalesce(sum(ai.cache_creation_tokens), 0)            AS cache_creation_tokens,
  -- NULL cost_usd is an UNPRICED turn (tokens nobody counted), not a free one.
  -- sum() skips it, and the price_basis below carries 'unpriced'/'mixed' so the
  -- console can say so rather than presenting the day's total as complete.
  coalesce(sum(ai.cost_usd), 0)                         AS cost_usd,
  percentile_cont(0.5)  WITHIN GROUP (ORDER BY ai.latency_ms)::int  AS latency_p50_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY ai.latency_ms)::int  AS latency_p95_ms,
  count(*) FILTER (WHERE ai.outcome <> 'ok')            AS errors,
  CASE WHEN count(DISTINCT ai.price_basis) = 1
       THEN min(ai.price_basis) ELSE 'mixed' END        AS price_basis,
  now()                                                 AS rolled_up_at
FROM ai_interactions ai
WHERE ${UTC_DAY} < ${TODAY_UTC}                         -- closed days only
  AND ${bound.sql}
GROUP BY ai.environment, ai.student_id, ${UTC_DAY}, coalesce(ai.surface_kind, 'unattributed')
ON CONFLICT (environment, student_id, day, surface_kind) DO UPDATE SET
  turns                 = EXCLUDED.turns,
  input_tokens          = EXCLUDED.input_tokens,
  output_tokens         = EXCLUDED.output_tokens,
  cache_read_tokens     = EXCLUDED.cache_read_tokens,
  cache_creation_tokens = EXCLUDED.cache_creation_tokens,
  cost_usd              = EXCLUDED.cost_usd,
  latency_p50_ms        = EXCLUDED.latency_p50_ms,
  latency_p95_ms        = EXCLUDED.latency_p95_ms,
  errors                = EXCLUDED.errors,
  price_basis           = EXCLUDED.price_basis,
  rolled_up_at          = EXCLUDED.rolled_up_at
RETURNING environment, student_id, day, surface_kind
`;

/* ------------------------------------------------------------------- run */

const startedAt = Date.now();

const { rows, pending, total } = await withMaint(async (c) => {
  const res = await c.query(SQL, bound.params);
  // Sequential on one client, never Promise.all — pg@9 removed the implicit
  // queuing (lib/db.ts `sequential`).
  const open = await c.query(
    `SELECT count(*) AS n
       FROM ai_interactions ai
      WHERE ${UTC_DAY} = ${TODAY_UTC}`
  );
  const all = await c.query(`SELECT count(*) AS n FROM cost_daily`);
  return {
    rows: res.rows as { environment: string; student_id: string; day: Date; surface_kind: string }[],
    pending: Number(open.rows[0]?.n ?? 0),
    total: Number(all.rows[0]?.n ?? 0),
  };
});

const days = new Set(rows.map((r) => String(r.day).slice(0, 10)));
const students = new Set(rows.map((r) => String(r.student_id)));
const kinds = new Set(rows.map((r) => r.surface_kind));

console.log(
  `rollup-cost-daily — ${bound.label}\n` +
    `  ${rows.length} row(s) written or refreshed\n` +
    `  ${days.size} day(s), ${students.size} student(s), ${kinds.size} surface kind(s)` +
    (kinds.size ? ` [${[...kinds].sort().join(", ")}]` : "") +
    `\n  ${total} row(s) in cost_daily in total\n` +
    `  ${pending} interaction(s) from today are NOT rolled up — today is a live query\n` +
    `  finished in ${Date.now() - startedAt} ms`
);

process.exit(0);
