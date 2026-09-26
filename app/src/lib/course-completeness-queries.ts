/**
 * THE READ BEHIND `/courses`' COMPLETENESS (feature 003, FR-4309, T308;
 * backlog #16). The rules are in `lib/course-completeness.ts` (pure); this is
 * the one query batch, under `ainext_operator`, over content tables only —
 * no student, no attempt, no name.
 */
import { BOOK_SECTIONS_SQL, type BookSectionRow } from "./book-sections";
import {
  summariseCompleteness,
  type CourseCompleteness,
  type MisconceptionRow,
  type ObjectiveRow,
  type QuestionRow,
  type WorkedExampleRow,
} from "./course-completeness";
import { COURSE_IDS } from "./courses";
import { sequential, withOperator } from "./db";
import { catalogueObjectivesSql } from "./module-order";

/**
 * Every registry course's completeness, by course id — the console's read
 * (`ainext_operator`). Content tables only. A course with no book loaded
 * reads as zeros, honestly, like `courseCatalog`'s own counts.
 */
export async function courseCompleteness(
  operatorId: number
): Promise<Record<string, CourseCompleteness>> {
  const [losRes, qRes, mcRes, weRes, secRes] = await withOperator(operatorId, (db) =>
    sequential([
      // THE catalogue order (FR-3217), so lessons are listed as the student
      // meets them and `partOrderProblems` checks that order.
      () =>
        db.query(
          catalogueObjectivesSql(`lo.id, lo.label, m.id AS module_id, m.label AS module_label,
            (SELECT pe.dst_id FROM graph_edges pe
               JOIN graph_nodes c ON c.id = pe.dst_id AND c.kind = 'course'
              WHERE pe.src_id = m.id AND pe.edge_type = 'part_of' AND pe.system_to IS NULL
              ORDER BY pe.dst_id LIMIT 1) AS course_id`)
        ),
      () =>
        db.query(
          `SELECT lo_id, tier, question_type, status, source, source_note
             FROM questions WHERE status <> 'retired'`
        ),
      () =>
        db.query(
          `SELECT m.lo_id,
                  EXISTS (SELECT 1 FROM explanation_library e
                           WHERE e.misconception_id = m.id AND e.entry_type = 'refutation') AS explained
             FROM misconceptions m`
        ),
      () => db.query(`SELECT lo_id FROM explanation_library WHERE entry_type = 'worked_example'`),
      () => db.query(BOOK_SECTIONS_SQL, [COURSE_IDS]),
    ] as const)
  );

  const objectives: ObjectiveRow[] = losRes.rows.map((r) => ({
    loId: String(r.id),
    label: String(r.label ?? ""),
    moduleId: (r.module_id as string | null) ?? null,
    moduleLabel: (r.module_label as string | null) ?? null,
    courseId: (r.course_id as string | null) ?? null,
  }));
  const questions: QuestionRow[] = qRes.rows.map((r) => ({
    loId: String(r.lo_id),
    tier: String(r.tier),
    questionType: String(r.question_type),
    status: String(r.status),
    source: (r.source as string | null) ?? null,
    sourceNote: (r.source_note as string | null) ?? null,
  }));
  const misconceptions: MisconceptionRow[] = mcRes.rows.map((r) => ({
    loId: String(r.lo_id),
    explained: r.explained === true,
  }));
  const workedExamples: WorkedExampleRow[] = weRes.rows.map((r) => ({ loId: String(r.lo_id) }));
  const sections = secRes.rows as BookSectionRow[];

  const out: Record<string, CourseCompleteness> = {};
  for (const courseId of COURSE_IDS) {
    out[courseId] = summariseCompleteness({
      objectives: objectives.filter((o) => o.courseId === courseId),
      questions,
      misconceptions,
      workedExamples,
      sectionRows: sections.filter((s) => s.course_id === courseId),
    });
  }
  return out;
}
