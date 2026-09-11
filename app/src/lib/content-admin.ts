import { pool } from "@/lib/db";
import { tallyProvenance, type ProvenanceTally } from "@/lib/provenance";

/**
 * The content operator's view of the question bank (FR-1108).
 *
 * The count that matters is not "how many generated questions exist" — it is
 * **how many unchecked ones are live**, because that is the number that says
 * how much ungated mathematics students can actually be served. A bundle
 * sitting in `review` is a decision not yet taken; a row in `live` is one
 * already taken.
 */

export type AdminQuestionRow = {
  id: string;
  loId: string;
  loLabel: string;
  moduleLabel: string | null;
  tier: string;
  questionType: string;
  stem: string;
  status: string;
  source: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  parentQuestionId: string | null;
  generatedBy: string | null;
  sourcePage: number | null;
  attempts: number;
};

export type ContentAdminView = {
  rows: AdminQuestionRow[];
  /** across LIVE rows only — what students can be served */
  live: ProvenanceTally;
  /** across every row regardless of status — what exists */
  all: ProvenanceTally;
  /** generated rows still waiting on a promote decision */
  pendingPromotion: number;
};

export async function getContentAdminView(): Promise<ContentAdminView> {
  const res = await pool.query(
    `SELECT q.id, q.lo_id, q.tier, q.question_type, q.stem, q.status, q.source,
            q.reviewed_by, q.reviewed_at, q.parent_question_id, q.source_page,
            lo.label AS lo_label,
            mod.label AS module_label,
            er.extractor AS generated_by,
            (SELECT count(*) FROM attempts a WHERE a.question_id = q.id) AS attempts
       FROM questions q
       JOIN graph_nodes lo ON lo.id = q.lo_id
       LEFT JOIN graph_edges te
              ON te.dst_id = q.lo_id AND te.edge_type = 'teaches'
       LEFT JOIN graph_nodes mod ON mod.id = te.src_id
       LEFT JOIN extraction_runs er ON er.id = q.extraction_run_id
      WHERE q.status <> 'retired'
      -- Generated items first, unchecked before checked: the rows that need a
      -- human decision sit at the top rather than being found by scrolling.
      ORDER BY (q.source = 'variant') DESC,
               (q.reviewed_by IS NULL) DESC,
               q.lo_id, q.tier, q.id`
  );

  const rows: AdminQuestionRow[] = res.rows.map((r) => ({
    id: r.id,
    loId: r.lo_id,
    loLabel: r.lo_label,
    moduleLabel: r.module_label ?? null,
    tier: r.tier,
    questionType: r.question_type,
    stem: r.stem,
    status: r.status,
    source: r.source,
    reviewedBy: r.reviewed_by ?? null,
    reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null,
    parentQuestionId: r.parent_question_id ?? null,
    generatedBy: r.generated_by ?? null,
    sourcePage: r.source_page ?? null,
    attempts: Number(r.attempts ?? 0),
  }));

  const liveRows = rows.filter((r) => r.status === "live");

  return {
    rows,
    live: tallyProvenance(liveRows),
    all: tallyProvenance(rows),
    pendingPromotion: rows.filter(
      (r) => r.source === "variant" && r.status === "review"
    ).length,
  };
}
