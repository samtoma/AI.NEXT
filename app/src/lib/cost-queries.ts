import { sequential, withOperator } from "@/lib/db";
import { ENVIRONMENT } from "@/lib/env";

/**
 * What the AI actually costs, broken out by the function that spent it
 * (feedback #39, FR-C04).
 *
 * The instrumentation was never the gap. `ai_interactions` has recorded
 * `surface`, `surface_kind`, `cost_usd`, both token counts, the cache
 * counters, `latency_ms`, `student_id` and `environment` on every single
 * model call since migration 009. What did not exist was anything that READ
 * it: the only query touching the table outside the insert path counted rows
 * for a stat tile. So the honest shape of #39 is a reporting job, not an
 * instrumentation one.
 *
 * Three groupings, because "what does this cost" is three different questions
 * depending on who is asking:
 *
 *   - BY SURFACE answers "which feature is expensive" — a full taught lesson
 *     against a one-off question against the spine demo. This is the one that
 *     informs what we charge for (PRD §10, still unset).
 *   - BY KIND answers "is OCR eating us" — `surface_kind` exists precisely so
 *     image-token cost cannot hide inside a blended teaching figure
 *     (constitution Principle VI).
 *   - PER STUDENT answers "what does one child cost for a month", which is
 *     the only figure a price can be built on.
 *
 * **P2 closed the temporary hole this carried.** Every query here is
 * CROSS-STUDENT by construction — "what does one child cost" is a table with
 * every child in it — so `ainext_app` would return an empty report rather than
 * refuse, which is the worst possible failure for a cost page: a zero that
 * looks like a fact. It used to reach for `withMaint` and its policy bypass;
 * it now runs under `withOperator`, whose cross-student visibility is a grant
 * in migration 017 with `cost-billing` in front of it.
 *
 * Every query is scoped to THIS environment. Principle XI forbids pooling
 * metrics across environments, and a cost figure that silently blends the
 * frozen baseline with the comparison build would be worse than no figure —
 * it would be a plausible wrong number used to set a price.
 */

export type CostBySurface = {
  surface: string;
  turns: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** mean, not total — the comparable number across surfaces of different volume */
  avgCostUsd: number;
  avgLatencyMs: number;
};

export type CostByKind = {
  kind: string;
  turns: number;
  costUsd: number;
};

export type CostPerStudent = {
  studentId: number;
  displayName: string | null;
  turns: number;
  costUsd: number;
  /** first and last model call, so a per-month figure can be derived honestly */
  firstAt: string | null;
  lastAt: string | null;
};

export type CostView = {
  environment: string;
  /** null when nothing has been logged yet — distinct from zero cost */
  totalCostUsd: number | null;
  totalTurns: number;
  bySurface: CostBySurface[];
  byKind: CostByKind[];
  perStudent: CostPerStudent[];
  windowDays: number;
};

const num = (v: unknown): number => Number(v ?? 0);

export async function getCostView(operatorId: number, windowDays = 30): Promise<CostView> {
  // Written out twice rather than rewritten with a regex: the per-student
  // query needs the table alias and a string substitution that has to get
  // both column names right is a silent breakage waiting for the next column.
  const scope = `environment = $1 AND created_at >= now() - ($2 || ' days')::interval`;
  const scopeAliased = `a.environment = $1 AND a.created_at >= now() - ($2 || ' days')::interval`;
  const args = [ENVIRONMENT, String(windowDays)];

  // Four independent reads on withOperator's one shared client: sequential,
  // not Promise.all — see lib/db.ts's `sequential` for why (pg@9 removes the
  // implicit queuing this used to lean on).
  const [totals, bySurface, byKind, perStudent] = await withOperator(operatorId, (db) =>
    sequential([
      () =>
        db.query(
          `SELECT count(*) AS turns, sum(cost_usd) AS cost
         FROM ai_interactions WHERE ${scope}`,
          args
        ),
      () =>
        db.query(
          `SELECT surface,
              count(*)                        AS turns,
              coalesce(sum(cost_usd), 0)      AS cost,
              coalesce(sum(input_tokens), 0)  AS input_tokens,
              coalesce(sum(output_tokens), 0) AS output_tokens,
              coalesce(sum(cache_read_tokens), 0) AS cache_read_tokens,
              coalesce(avg(cost_usd), 0)      AS avg_cost,
              coalesce(avg(latency_ms), 0)    AS avg_latency
         FROM ai_interactions WHERE ${scope}
        GROUP BY surface ORDER BY cost DESC`,
          args
        ),
      () =>
        db.query(
          // A row written before migration 009 has no kind. It is reported as
          // "unattributed" rather than folded into 'chat', because quietly
          // attributing a cost to a function that may not have spent it is the
          // exact failure this table exists to prevent.
          `SELECT coalesce(surface_kind, 'unattributed') AS kind,
              count(*) AS turns, coalesce(sum(cost_usd), 0) AS cost
         FROM ai_interactions WHERE ${scope}
        GROUP BY 1 ORDER BY cost DESC`,
          args
        ),
      () =>
        db.query(
          `SELECT a.student_id,
              s.display_name,
              count(*) AS turns,
              coalesce(sum(a.cost_usd), 0) AS cost,
              min(a.created_at) AS first_at,
              max(a.created_at) AS last_at
         FROM ai_interactions a
         LEFT JOIN students s ON s.id = a.student_id
        WHERE ${scopeAliased}
        GROUP BY a.student_id, s.display_name
        ORDER BY cost DESC`,
          args
        ),
    ] as const)
  );

  const totalTurns = num(totals.rows[0]?.turns);

  return {
    environment: ENVIRONMENT,
    totalTurns,
    totalCostUsd: totalTurns === 0 ? null : num(totals.rows[0]?.cost),
    windowDays,
    bySurface: bySurface.rows.map((r) => ({
      surface: String(r.surface),
      turns: num(r.turns),
      costUsd: num(r.cost),
      inputTokens: num(r.input_tokens),
      outputTokens: num(r.output_tokens),
      cacheReadTokens: num(r.cache_read_tokens),
      avgCostUsd: num(r.avg_cost),
      avgLatencyMs: num(r.avg_latency),
    })),
    byKind: byKind.rows.map((r) => ({
      kind: String(r.kind),
      turns: num(r.turns),
      costUsd: num(r.cost),
    })),
    perStudent: perStudent.rows.map((r) => ({
      studentId: num(r.student_id),
      displayName: r.display_name ? String(r.display_name) : null,
      turns: num(r.turns),
      costUsd: num(r.cost),
      firstAt: r.first_at ? new Date(r.first_at).toISOString() : null,
      lastAt: r.last_at ? new Date(r.last_at).toISOString() : null,
    })),
  };
}
