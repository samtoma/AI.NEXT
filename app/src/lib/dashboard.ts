/**
 * Per-topic performance (PRD D1, FR-401).
 *
 * The requirement is specific and worth restating: performance is broken down
 * per topic, and NEVER presented as a single blended number. A student who is
 * strong on three units and lost on a fourth is not "68% overall" — that figure
 * hides the only thing worth acting on. So this module deliberately exposes no
 * overall aggregate at all; a caller cannot render one by accident.
 */

import { pool } from "@/lib/db";

export type TopicRow = {
  moduleId: string;
  label: string;
  /** mean P(L) across ALL the module's objectives, unpractised counting as 0 */
  mastery: number;
  loCount: number;
  /** objectives with at least one recorded attempt */
  practisedCount: number;
  attempts: number;
  weakestLoId: string | null;
  weakestLoLabel: string | null;
  weakestLoMastery: number | null;
};

/**
 * Mastery is averaged over ALL of a module's learning objectives, with an
 * un-practised objective counting as 0 — the same definition `/spine` and the
 * student picker already use. Dividing by only the objectives a student has
 * touched would flatter someone who has practised three of twelve, and would
 * make this page disagree with the graph beside it.
 */
export async function getTopicBreakdown(studentId: number): Promise<TopicRow[]> {
  const res = await pool.query(
    `WITH module_lo AS (
       SELECT e.src_id AS module_id, e.dst_id AS lo_id
         FROM graph_edges e
        WHERE e.edge_type = 'teaches'
     ),
     lo_state AS (
       SELECT ml.module_id,
              ml.lo_id,
              n.label AS lo_label,
              coalesce(m.score, 0)::float AS mastery,
              (m.id IS NOT NULL) AS practised,
              (SELECT count(*) FROM attempts a
                 JOIN questions q ON q.id = a.question_id
                WHERE a.student_id = $1 AND q.lo_id = ml.lo_id) AS attempts
         FROM module_lo ml
         JOIN graph_nodes n ON n.id = ml.lo_id
         LEFT JOIN mastery m
           ON m.lo_id = ml.lo_id AND m.student_id = $1 AND m.system_to IS NULL
     ),
     ranked AS (
       -- Weakest among the objectives the student has ACTUALLY ATTEMPTED.
       -- Ranking over all of them surfaces an untouched objective at 0%, which
       -- reads as "you are failing this" when it means "you have not met it
       -- yet" — actively misleading on a module with plenty of attempts.
       SELECT *, row_number() OVER (
                   PARTITION BY module_id
                   ORDER BY (attempts = 0), mastery ASC, lo_id
                 ) AS rn
         FROM lo_state
     )
     SELECT mod.id AS module_id,
            mod.label,
            avg(r.mastery)::float                              AS mastery,
            count(*)                                           AS lo_count,
            count(*) FILTER (WHERE r.practised)                AS practised_count,
            coalesce(sum(r.attempts), 0)                       AS attempts,
            max(CASE WHEN r.rn = 1 AND r.attempts > 0 THEN r.lo_id END)          AS weakest_lo_id,
            max(CASE WHEN r.rn = 1 AND r.attempts > 0 THEN r.lo_label END)       AS weakest_lo_label,
            max(CASE WHEN r.rn = 1 AND r.attempts > 0 THEN r.mastery END)::float AS weakest_lo_mastery
       FROM ranked r
       JOIN graph_nodes mod ON mod.id = r.module_id
      GROUP BY mod.id, mod.label, mod.order_in_parent
      -- Started topics first, weakest of those at the top; untouched topics
      -- after them in curriculum order. A topic you have never opened is not
      -- your weakest topic, and putting it above a genuine 4% weakness buries
      -- the one thing this page exists to surface.
      ORDER BY (coalesce(sum(r.attempts), 0) = 0),
               mastery ASC,
               mod.order_in_parent`,
    [studentId]
  );

  return res.rows.map((r) => ({
    moduleId: r.module_id as string,
    label: r.label as string,
    mastery: Number(r.mastery),
    loCount: Number(r.lo_count),
    practisedCount: Number(r.practised_count),
    attempts: Number(r.attempts),
    weakestLoId: (r.weakest_lo_id as string | null) ?? null,
    weakestLoLabel: (r.weakest_lo_label as string | null) ?? null,
    weakestLoMastery:
      r.weakest_lo_mastery == null ? null : Number(r.weakest_lo_mastery),
  }));
}
