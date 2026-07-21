import { pool } from "./db";
import type { LessonBridge, SpineSubject, SubjectSummary, Verdict } from "./types";

/**
 * Per-subject roll-ups + cross-subject bridges (Wave 1.5, the multi-subject
 * spine). "Separated by default, bridged by exception":
 *   - getSubjectSummaries → each subject's mastery, weakest topic and last
 *     check, rolled up ONLY within the subject (never a blended score, §4).
 *   - getLessonBridges → the curated `relates_to` connections touching a
 *     lesson's LOs, so the tutor can surface ONE grounded cross-subject hint
 *     at the natural moment (§5).
 *
 * Both degrade gracefully while Track A's schema lands in parallel: subject is
 * derived from the LO's course (the `node_subject` view's own rule), and the
 * bridge query is skipped until the `graph_edges.rationale` column exists.
 */

const STUDENT_ID = 1;

const COURSE_LABEL: Record<SpineSubject, string> = {
  math: "Mathematics",
  social: "الدراسات الاجتماعية",
};

/** SpineSubject from a course id (the node_subject rule), id-prefix fallback. */
function subjectOf(courseId: string | null | undefined, loId: string): SpineSubject {
  if (courseId) return courseId.endsWith("-social-ar") ? "social" : "math";
  return loId.startsWith("lo:soc") ? "social" : "math";
}

/** "lo:soc1-2-1" → lesson slug "soc1-2" (LO-id minus the trailing part). */
function slugOfLo(loId: string): string {
  return loId.replace(/^lo:/, "").replace(/-[0-9]+$/, "");
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = $1 AND column_name = $2 LIMIT 1`,
    [table, column]
  );
  return (r.rowCount ?? 0) > 0;
}

/* ------------------------------------------------------------------ */
/* Per-subject roll-up (student home)                                  */
/* ------------------------------------------------------------------ */

export async function getSubjectSummaries(
  studentId: number = STUDENT_ID
): Promise<SubjectSummary[]> {
  const [losRes, checksRes] = await Promise.all([
    pool.query(
      `SELECT lo.id, lo.label, lo.order_in_parent,
              m.id AS module_id, m.order_in_parent AS module_order,
              c.id AS course_id, c.label AS course_label,
              ms.score AS mastery
       FROM graph_nodes lo
       LEFT JOIN graph_edges e
         ON e.dst_id = lo.id AND e.edge_type = 'teaches' AND e.system_to IS NULL
       LEFT JOIN graph_nodes m ON m.id = e.src_id AND m.kind = 'module'
       LEFT JOIN graph_edges ec
         ON ec.src_id = m.id AND ec.edge_type = 'part_of' AND ec.system_to IS NULL
       LEFT JOIN graph_nodes c ON c.id = ec.dst_id AND c.kind = 'course'
       LEFT JOIN mastery ms
         ON ms.lo_id = lo.id AND ms.student_id = $1 AND ms.system_to IS NULL
       WHERE lo.kind = 'learning_objective'
       ORDER BY CASE WHEN m.id LIKE 'module:geo%' THEN 1 ELSE 0 END,
                m.order_in_parent NULLS LAST, lo.order_in_parent, lo.id`,
      [studentId]
    ),
    pool.query(
      `SELECT lo_id, score, verdict, mode, created_at
       FROM understanding_checks
       WHERE student_id = $1
       ORDER BY created_at DESC`,
      [studentId]
    ),
  ]);

  interface Acc {
    subject: SpineSubject;
    courseId: string | null;
    courseLabel: string;
    scoreSum: number;
    scoreN: number;
    weakest: { id: string; label: string; mastery: number } | null;
    slugs: Set<string>;
    defaultSlug: string | null;
  }
  const bySubject = new Map<SpineSubject, Acc>();

  for (const r of losRes.rows) {
    const subject = subjectOf(r.course_id, r.id);
    let acc = bySubject.get(subject);
    if (!acc) {
      acc = {
        subject,
        courseId: r.course_id ?? null,
        courseLabel: (r.course_label as string) ?? COURSE_LABEL[subject],
        scoreSum: 0,
        scoreN: 0,
        weakest: null,
        slugs: new Set(),
        defaultSlug: null,
      };
      bySubject.set(subject, acc);
    }
    const mastery = r.mastery == null ? 0 : Number(r.mastery);
    acc.scoreSum += mastery;
    acc.scoreN += 1;
    if (!acc.weakest || mastery < acc.weakest.mastery) {
      acc.weakest = { id: r.id, label: r.label, mastery };
    }
    const slug = slugOfLo(r.id);
    if (!acc.slugs.has(slug)) acc.slugs.add(slug);
    if (acc.defaultSlug == null) acc.defaultSlug = slug; // first in teach order
  }

  // last comprehension check per subject (checks are newest-first already)
  const lastCheck = new Map<
    SpineSubject,
    SubjectSummary["lastCheck"]
  >();
  for (const c of checksRes.rows) {
    const subject = subjectOf(null, c.lo_id as string);
    if (lastCheck.has(subject)) continue;
    lastCheck.set(subject, {
      score: Number(c.score),
      verdict: c.verdict as Verdict,
      mode: c.mode === "review" ? "review" : "learn",
      createdAt: new Date(c.created_at).toISOString(),
    });
  }

  const ORDER: SpineSubject[] = ["math", "social"];
  return [...bySubject.values()]
    .sort((a, b) => ORDER.indexOf(a.subject) - ORDER.indexOf(b.subject))
    .map((a) => ({
      subject: a.subject,
      courseId: a.courseId,
      courseLabel: a.courseLabel,
      avgMastery: a.scoreN ? a.scoreSum / a.scoreN : 0,
      weakestLo: a.weakest,
      lessonsCount: a.slugs.size,
      defaultSlug: a.defaultSlug,
      lastCheck: lastCheck.get(a.subject) ?? null,
    }));
}

/* ------------------------------------------------------------------ */
/* Cross-subject bridges for a lesson (the grounded hint)              */
/* ------------------------------------------------------------------ */

/**
 * The curated `relates_to` connections touching any of `loIds` (this lesson's
 * objectives). Each returned bridge names the FAR endpoint (in another
 * subject) + the human-approved one-line rationale, so the tutor can cite the
 * connection instead of fabricating one. Empty until Track A's `rationale`
 * column + edges land — never throws.
 */
export async function getLessonBridges(loIds: string[]): Promise<LessonBridge[]> {
  if (loIds.length === 0) return [];
  try {
    if (!(await columnExists("graph_edges", "rationale"))) return [];
    const res = await pool.query(
      `SELECT e.src_id, e.dst_id, e.rationale,
              ns.label AS src_label, nd.label AS dst_label
       FROM graph_edges e
       JOIN graph_nodes ns ON ns.id = e.src_id
       JOIN graph_nodes nd ON nd.id = e.dst_id
       WHERE e.edge_type = 'relates_to' AND e.system_to IS NULL
         AND (e.src_id = ANY($1) OR e.dst_id = ANY($1))`,
      [loIds]
    );
    const here = new Set(loIds);
    const out: LessonBridge[] = [];
    const seen = new Set<string>();
    for (const r of res.rows) {
      const srcHere = here.has(r.src_id);
      const thisLo = srcHere ? r.src_id : r.dst_id;
      const otherLo = srcHere ? r.dst_id : r.src_id;
      const thisLabel = srcHere ? r.src_label : r.dst_label;
      const otherLabel = srcHere ? r.dst_label : r.src_label;
      const key = `${thisLo}|${otherLo}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        thisLo,
        thisLabel: (thisLabel as string) ?? thisLo,
        otherLo,
        otherLabel: (otherLabel as string) ?? otherLo,
        otherSubject: subjectOf(null, otherLo),
        rationale: (r.rationale as string) ?? "",
      });
    }
    return out;
  } catch {
    return []; // schema not ready yet — bridges are additive, never fatal
  }
}
