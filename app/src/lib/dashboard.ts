/**
 * Per-topic performance (PRD D1, FR-401).
 *
 * The requirement is specific and worth restating: performance is broken down
 * per topic, and NEVER presented as a single blended number. A student who is
 * strong on three units and lost on a fourth is not "68% overall" — that figure
 * hides the only thing worth acting on. So this module deliberately exposes no
 * overall aggregate at all; a caller cannot render one by accident.
 */

import type { PoolClient } from "pg";

import { resolveStudentGraphScope, type StudentGraphScope } from "@/lib/catalog-queries";
import { sequential } from "@/lib/db";
import { COURSE_RANK, MODULE_RANK } from "@/lib/module-order";
import { catalogueObjectivesSql } from "@/lib/module-order";
import { scoped, type Db } from "@/lib/student-context";
import { slugOfLo } from "@/lib/lesson-slug";
import { sectionProgress } from "@/lib/section-label";
import {
  BOOK_SECTIONS_SQL,
  NO_SECTIONS,
  sectionIndexFromRows,
  type BookSectionRow,
} from "@/lib/book-sections";
import type { ProgressionLesson } from "@/lib/progression";
import type { SectionProgress } from "@/lib/types";

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
  /**
   * The module's split book sections, "k of m parts mastered" each (FR-4314;
   * feature 003). A section's parts are always in one chapter, so each roll-up
   * belongs to exactly one row. Empty for a module with no split section —
   * every National module — so nothing a National row shows changes.
   */
  sections: SectionProgress[];
};

/**
 * Mastery is averaged over ALL of a module's learning objectives, with an
 * un-practised objective counting as 0 — the same definition `/spine` and the
 * student picker already use. Dividing by only the objectives a student has
 * touched would flatter someone who has practised three of twelve, and would
 * make this page disagree with the graph beside it.
 *
 * THE COURSE GATE (003; FR-2705, FR-4006). This page used to list every
 * loaded course's modules — a hidden course's units, and once a second
 * curriculum is loaded, the other curriculum's chapters, each by name as "not
 * started". It is narrowed by the student scope now: a module is listed only
 * when its course is one she may see. The rows are filtered after the query
 * rather than inside it so the gate stays ONE implementation
 * (`resolveStudentGraphScope`), and the order of what survives is untouched.
 * A module's objectives all belong to its course, so its average is
 * unaffected by the filter.
 */
export async function getTopicBreakdown(
  studentId: number,
  c?: PoolClient
): Promise<TopicRow[]> {
  const { res, gate, sectionsByModule } = await scoped(studentId, c, async (db) => {
    const gate = await resolveStudentGraphScope(studentId, db);
    const res = await db.query(
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
     SELECT m.id AS module_id,
            m.label,
            avg(r.mastery)::float                              AS mastery,
            count(*)                                           AS lo_count,
            count(*) FILTER (WHERE r.practised)                AS practised_count,
            coalesce(sum(r.attempts), 0)                       AS attempts,
            max(CASE WHEN r.rn = 1 AND r.attempts > 0 THEN r.lo_id END)          AS weakest_lo_id,
            max(CASE WHEN r.rn = 1 AND r.attempts > 0 THEN r.lo_label END)       AS weakest_lo_label,
            max(CASE WHEN r.rn = 1 AND r.attempts > 0 THEN r.mastery END)::float AS weakest_lo_mastery
       FROM ranked r
       -- m is the MODULE here, the alias MODULE_RANK reads (the m inside
       -- lo_state above is the mastery row, in its own scope).
       JOIN graph_nodes m ON m.id = r.module_id
      GROUP BY m.id, m.label, m.order_in_parent
      -- Started topics first, weakest of those at the top; untouched topics
      -- after them by COURSE (registry order; since 003, so two courses of
      -- one subject never interleave), then in CATALOGUE order
      -- inside each (FR-3217) — the lesson list's, Term 1 then Term 2 then
      -- geometry. The list holds every subject's units, and Samuel's rule is
      -- that such a list splits by subject first. A topic you have never opened is not
      -- your weakest topic, and putting it above a genuine 4% weakness buries
      -- the one thing this page exists to surface. The tie-break used to be
      -- the module's position alone, which Term-1 Unit 1 and Term-2 Unit 1
      -- (and the other subjects' first units) share, so Postgres chose.
      ORDER BY (coalesce(sum(r.attempts), 0) = 0),
               mastery ASC,
               ${COURSE_RANK},
               ${MODULE_RANK}`,
      [studentId]
    );
    return { gate, res, sectionsByModule: await sectionsByModuleOn(db, studentId, gate) };
  });

  return res.rows
    .filter((r) => gate.module(r.module_id as string))
    .map((r) => ({
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
      sections: sectionsByModule.get(r.module_id as string) ?? [],
    }));
}

/**
 * The split-section roll-ups of the courses this student may see, by module
 * (FR-4314). One read of the book-section store for her gated courses; only
 * when it holds a split section are her objectives and mastery read to score
 * the parts — so a National student costs this page one small read and
 * nothing else. `gate` is the page's own scope, so the roll-ups count only
 * objectives she may see.
 */
async function sectionsByModuleOn(
  db: Db,
  studentId: number,
  gate: StudentGraphScope
): Promise<Map<string, SectionProgress[]>> {
  const ids = [...(gate.courses ?? [])];
  const index =
    ids.length === 0
      ? NO_SECTIONS
      : sectionIndexFromRows((await db.query(BOOK_SECTIONS_SQL, [ids])).rows as BookSectionRow[]);
  const out = new Map<string, SectionProgress[]>();
  if (!index.hasSplits) return out;

  const [losRes, masteryRes] = await sequential([
    // catalogue order (FR-3217), so the roll-ups come out in the book's order
    () => db.query(catalogueObjectivesSql("lo.id, m.id AS module_id")),
    () =>
      db.query(
        `SELECT lo_id, score FROM mastery WHERE student_id = $1 AND system_to IS NULL`,
        [studentId]
      ),
  ] as const);
  const score = new Map(masteryRes.rows.map((r) => [r.lo_id as string, Number(r.score)]));
  const byModule = new Map<string, Map<string, ProgressionLesson & { los: { id: string; mastery: number }[] }>>();
  for (const r of losRes.rows) {
    const id = r.id as string;
    const moduleId = r.module_id as string | null;
    if (moduleId == null || !gate.lo(id)) continue;
    const lessons = byModule.get(moduleId) ?? new Map();
    byModule.set(moduleId, lessons);
    const slug = slugOfLo(id);
    const lesson = lessons.get(slug) ?? { slug, courseId: null, los: [] };
    lessons.set(slug, lesson);
    lesson.los.push({ id, mastery: score.get(id) ?? 0 });
  }
  for (const [moduleId, lessons] of byModule) {
    const rows = sectionProgress([...lessons.values()], index);
    if (rows.length > 0) out.set(moduleId, rows);
  }
  return out;
}
