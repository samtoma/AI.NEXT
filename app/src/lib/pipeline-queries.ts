import { COURSE_IDS, compareCourses, isCourseId } from "./courses";
import { pool, sequential } from "./db";
import { catalogueObjectivesSql } from "./module-order";
import { scoped, type Db } from "./student-context";

/**
 * `/pipeline` is an internal explainer: how the book became a graph. Everything
 * it shows is CORPUS data — documents, extraction runs, node and edge counts,
 * one exemplar question — except the mastery overlay on the mini-map, which is
 * the viewer's own and is read under their principal.
 *
 * **FR-2104: the latest-turn panel is gone.** Stage 05 ("Context assembly")
 * read `SELECT … FROM ai_interactions ORDER BY created_at DESC LIMIT 1` — the
 * most recent tutor turn written by ANY student — and rendered its prompt
 * slice, its token counts and its cost to whoever opened the page. It was a
 * demo affordance from when there was one student; with accounts it is one
 * student's conversation shown to another. The policy in migration 017 would
 * now return nothing for it anyway, but leaving a query whose only correct
 * result is "empty" invites someone to "fix" it later. So it is deleted, along
 * with the `AiTurn`/`GroundingSlice` types and the stage that rendered them.
 *
 * **ONE COURSE AT A TIME since 003** (FR-4104; contracts/console.md
 * "`/pipeline`, `/gallery`: `COURSE_RANK` order, and each list names its
 * course"). The live stages used to count the whole spine — every course's
 * nodes, edges, objectives and questions in one figure, and "the" source book
 * as whichever row came back first. With a second maths book in the spine
 * that would add two maths courses into one "questions live" number. So every
 * figure here is scoped to ONE course, the page names it, and a switcher
 * (grouped by curriculum) picks it. The objectives still come through the
 * shared catalogue helper (`catalogueObjectivesSql`, course first, then
 * catalogue order) and are narrowed to the course in place.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface PipelineDoc {
  sha256: string;
  title: string;
  publisher: string;
  edition: string | null;
  language: string;
  grade: string;
  subject: string;
  filePath: string | null;
  ingestedAt: string;
}

export interface PipelineRun {
  extractor: string;
  extractorVersion: string;
  schemaVersion: string;
  finishedAt: string | null;
}

export interface PipelineLo {
  id: string;
  label: string;
  sourcePage: number | null;
  layer: number;
  score: number;
}

export interface ReviewQuestion {
  id: string;
  loId: string;
  loLabel: string;
  tier: string;
  questionType: string;
  stem: string;
  choices: { key: string; text: string }[] | null;
  correctAnswer: string;
  solution: { step: number; text_md: string }[];
  sourcePage: number | null;
  sourceNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  status: string;
}

export interface PipelineData {
  /** the course every figure below counts (a registry id) */
  courseId: string;
  /** the registry courses the spine holds, registry order — the switcher */
  loadedCourses: string[];
  /** the course's source book, or null when none is recorded for it */
  doc: PipelineDoc | null;
  run: PipelineRun | null;
  nodesByKind: { kind: string; count: number }[];
  edgesByType: { type: string; count: number }[];
  syllabusVersion: string;
  los: PipelineLo[];
  prereqEdges: { src: string; dst: string }[];
  questionStats: { live: number; reviewed: number };
  reviewQuestion: ReviewQuestion | null;
}

/* ------------------------------------------------------------------ */
/* Longest-path layering over the prerequisite DAG (for the mini map)  */
/* ------------------------------------------------------------------ */

function computeLayers(
  ids: string[],
  edges: { src: string; dst: string }[]
): Map<string, number> {
  const layer = new Map<string, number>(ids.map((id) => [id, 0]));
  for (let i = 0; i < ids.length; i++) {
    let changed = false;
    for (const { src, dst } of edges) {
      const cand = (layer.get(src) ?? 0) + 1;
      if (cand > (layer.get(dst) ?? 0)) {
        layer.set(dst, cand);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return layer;
}

/* ------------------------------------------------------------------ */
/* Query                                                               */
/* ------------------------------------------------------------------ */

export async function getPipelineData(
  studentId: number | null,
  courseId: string | null = null
): Promise<PipelineData> {
  return scoped(studentId, undefined, (db) => pipelineDataOn(db, studentId, courseId));
}

/**
 * The same read, from the console, under `ainext_operator` (ADR-0014, P2).
 *
 * `studentId` is `null` and always will be: on the console there is no student
 * principal, so the mastery overlay is empty and everything else on the page is
 * corpus data — documents, runs, node and edge counts, one exemplar question.
 * That is the point rather than a limitation. `evidence-access` reads content,
 * not students, and this function is what makes that true of the query and not
 * only of the role's description.
 *
 * It is a separate export rather than a parameter on `getPipelineData` because
 * the two differ in the connection they open, not in the data they want, and a
 * boolean that switches database roles is a boolean somebody eventually passes
 * from a request.
 */
export async function getPipelineDataForOperator(
  operatorId: number,
  courseId: string | null = null
): Promise<PipelineData> {
  const { withOperator } = await import("./db");
  return withOperator(operatorId, (db) => pipelineDataOn(db as unknown as Db, null, courseId));
}

/**
 * Which registry courses the spine holds, and which one the page shows: the
 * requested one when it is loaded, else the first loaded in registry order,
 * else the registry's first (a fresh database — every figure is then zero,
 * which is the truth).
 */
async function chooseCourse(
  db: Db,
  requested: string | null
): Promise<{ courseId: string; loadedCourses: string[] }> {
  const res = await db.query(`SELECT id FROM graph_nodes WHERE kind = 'course'`);
  const loadedCourses: string[] = res.rows
    .map((r) => String(r.id))
    .filter((id) => isCourseId(id))
    .sort(compareCourses);
  const courseId =
    requested && loadedCourses.includes(requested)
      ? requested
      : (loadedCourses[0] ?? COURSE_IDS[0]);
  return { courseId, loadedCourses };
}

/** The ids of one course's own subgraph: the course, its modules, its
 *  objectives (`node_subject`, migration 007). `$1` is the course id. */
const COURSE_NODES = `
      SELECT $1::text AS id
      UNION SELECT src_id FROM graph_edges
             WHERE dst_id = $1 AND edge_type = 'part_of' AND system_to IS NULL
      UNION SELECT node_id FROM node_subject WHERE course_id = $1`;

async function pipelineDataOn(
  db: Db,
  studentId: number | null,
  requestedCourse: string | null
): Promise<PipelineData> {
  const { courseId, loadedCourses } = await chooseCourse(db, requestedCourse);
  const [
    courseLoRes,
    docRes,
    runRes,
    nodeKindRes,
    edgeTypeRes,
    loRes,
    prereqRes,
    masteryRes,
    qStatsRes,
    reviewQRes,
    // One client per unit of work, so one query at a time (pg@9).
  ] = await sequential([
    // this course's objectives — what the shared catalogue list is narrowed to
    () => db.query(`SELECT node_id FROM node_subject WHERE course_id = $1`, [courseId]),
    // this course's book, by the course node's own provenance
    () => db.query(`
      SELECT sha256, title, publisher, edition, language, grade, subject,
             file_path, ingested_at
      FROM source_documents
      WHERE sha256 = (SELECT source_sha256 FROM graph_nodes WHERE id = $1)
    `, [courseId]),
    // the latest extraction run of THIS course's book
    () => db.query(`
      SELECT extractor, extractor_version, schema_version, finished_at
      FROM extraction_runs
      WHERE source_sha256 = (SELECT source_sha256 FROM graph_nodes WHERE id = $1)
      ORDER BY id DESC LIMIT 1
    `, [courseId]),
    () => db.query(`
      SELECT kind, count(*)::int AS count FROM graph_nodes
      WHERE id IN (${COURSE_NODES})
      GROUP BY kind
      ORDER BY CASE kind
        WHEN 'program' THEN 0 WHEN 'course' THEN 1 WHEN 'module' THEN 2
        WHEN 'learning_objective' THEN 3 ELSE 4 END
    `, [courseId]),
    // edges with BOTH ends inside the course: its own map, nothing borrowed
    () => db.query(`
      SELECT edge_type AS type, count(*)::int AS count, min(syllabus_version) AS sv
      FROM graph_edges
      WHERE system_to IS NULL
        AND src_id IN (${COURSE_NODES})
        AND dst_id IN (${COURSE_NODES})
      GROUP BY edge_type
      ORDER BY CASE edge_type
        WHEN 'part_of' THEN 0 WHEN 'about' THEN 1
        WHEN 'teaches' THEN 2 ELSE 3 END
    `, [courseId]),
    // The mini-map's objectives — every subject's, so by SUBJECT first, then in
    // CATALOGUE order (FR-3217): the stage lays
    // each prerequisite layer out in the order it receives them, so a bare
    // `ORDER BY order_in_parent` — a position inside a module that the first
    // objective of every unit shares — let Postgres shuffle every column.
    () => db.query(catalogueObjectivesSql("lo.id, lo.label, lo.source_page")),
    () => db.query(`
      SELECT src_id, dst_id FROM graph_edges
      WHERE edge_type = 'prerequisite_of' AND system_to IS NULL
    `),
    // The viewer's own mastery, or nothing at all when nobody is signed in —
    // the overlay is a personal detail on a corpus page, not part of the
    // explainer.
    () =>
      studentId == null
        ? Promise.resolve({ rows: [] as { lo_id: string; score: string }[] })
        : db.query(
            `SELECT lo_id, score FROM mastery
           WHERE student_id = $1 AND system_to IS NULL`,
            [studentId]
          ),
    () => db.query(`
      SELECT
        count(*) FILTER (WHERE status = 'live')::int          AS live,
        count(*) FILTER (WHERE reviewed_by IS NOT NULL)::int  AS reviewed
      FROM questions
      WHERE lo_id IN (SELECT node_id FROM node_subject WHERE course_id = $1)
    `, [courseId]),
    // the exemplar plate: prefer the function-definition question (book p.16,
    // the same page shown in the Source scans); fall back to any live row
    () => db.query(`
      SELECT q.id, q.lo_id, q.tier, q.question_type, q.stem, q.choices,
             q.correct_answer, q.canonical_solution, q.source_page,
             q.source_note, q.reviewed_by, q.reviewed_at, q.status,
             n.label AS lo_label
      FROM questions q
      JOIN graph_nodes n ON n.id = q.lo_id
      WHERE q.status = 'live'
        AND q.lo_id IN (SELECT node_id FROM node_subject WHERE course_id = $1)
      ORDER BY (q.id = 'q:u1-3-1:001') DESC, q.id
      LIMIT 1
    `, [courseId]),
  ] as const);

  const d = docRes.rows[0];
  const doc: PipelineDoc | null = d
    ? {
        sha256: d.sha256,
        title: d.title,
        publisher: d.publisher,
        edition: d.edition,
        language: d.language,
        grade: d.grade,
        subject: d.subject,
        filePath: d.file_path,
        ingestedAt: new Date(d.ingested_at).toISOString(),
      }
    : null;

  const r = runRes.rows[0];
  const run: PipelineRun | null = r
    ? {
        extractor: r.extractor,
        extractorVersion: r.extractor_version,
        schemaVersion: String(r.schema_version),
        finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
      }
    : null;

  // One course's map: its objectives, in the shared catalogue order, and the
  // prerequisite edges between them. Narrowed in place, so the ranks below
  // are this course's (FR-4104).
  const inCourse = new Set(courseLoRes.rows.map((r) => String(r.node_id)));
  loRes.rows = loRes.rows.filter((row) => inCourse.has(row.id as string));
  const prereqEdges = prereqRes.rows
    .filter((e) => inCourse.has(e.src_id as string) && inCourse.has(e.dst_id as string))
    .map((e) => ({
      src: e.src_id as string,
      dst: e.dst_id as string,
    }));
  const loIds = loRes.rows.map((row) => row.id as string);
  const layers = computeLayers(loIds, prereqEdges);
  const score = new Map<string, number>(
    masteryRes.rows.map((row) => [row.lo_id, Number(row.score)])
  );

  const los: PipelineLo[] = loRes.rows.map((row) => ({
    id: row.id,
    label: row.label,
    sourcePage: row.source_page,
    layer: layers.get(row.id) ?? 0,
    score: score.get(row.id) ?? 0,
  }));

  const q = reviewQRes.rows[0];
  const reviewQuestion: ReviewQuestion | null = q
    ? {
        id: q.id,
        loId: q.lo_id,
        loLabel: q.lo_label,
        tier: q.tier,
        questionType: q.question_type,
        stem: q.stem,
        choices: q.choices,
        correctAnswer: q.correct_answer,
        solution: q.canonical_solution ?? [],
        sourcePage: q.source_page,
        sourceNote: q.source_note,
        reviewedBy: q.reviewed_by,
        reviewedAt: q.reviewed_at ? new Date(q.reviewed_at).toISOString() : null,
        status: q.status,
      }
    : null;

  return {
    courseId,
    loadedCourses,
    doc,
    run,
    nodesByKind: nodeKindRes.rows,
    edgesByType: edgeTypeRes.rows.map((row) => ({
      type: row.type,
      count: row.count,
    })),
    syllabusVersion: (edgeTypeRes.rows[0]?.sv as string) ?? "2025-2026",
    los,
    prereqEdges,
    questionStats: qStatsRes.rows[0],
    reviewQuestion,
  };
}

/**
 * Each module's course, for `/gallery` (003, FR-4104: "each list names its
 * course"). `getGalleryData` (`lib/visuals.ts`) already orders the plates by
 * course (`COURSE_RANK`), but groups them by module only, so the page could
 * not say which book a unit belongs to — and its totals added every course's
 * figures into one count. The open `part_of` edges from a module to a course
 * node answer it. Corpus data on the ordinary connection, as the gallery's
 * own read is: `graph_edges` holds no student.
 */
export async function moduleCourses(): Promise<Map<string, string>> {
  const res = await pool.query(
    `SELECT e.src_id AS module_id, e.dst_id AS course_id
       FROM graph_edges e
       JOIN graph_nodes c ON c.id = e.dst_id AND c.kind = 'course'
      WHERE e.edge_type = 'part_of' AND e.system_to IS NULL`
  );
  const out = new Map<string, string>();
  for (const r of res.rows as { module_id: string; course_id: string }[]) {
    // the registry's earliest course, should a module ever belong to two
    const prev = out.get(r.module_id);
    if (!prev || compareCourses(r.course_id, prev) < 0) out.set(r.module_id, r.course_id);
  }
  return out;
}
