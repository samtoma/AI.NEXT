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
  doc: PipelineDoc;
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
  studentId: number | null
): Promise<PipelineData> {
  return scoped(studentId, undefined, (db) => pipelineDataOn(db, studentId));
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
export async function getPipelineDataForOperator(operatorId: number): Promise<PipelineData> {
  const { withOperator } = await import("./db");
  return withOperator(operatorId, (db) => pipelineDataOn(db as unknown as Db, null));
}

async function pipelineDataOn(
  db: Db,
  studentId: number | null
): Promise<PipelineData> {
  const [
    docRes,
    runRes,
    nodeKindRes,
    edgeTypeRes,
    loRes,
    prereqRes,
    masteryRes,
    qStatsRes,
    reviewQRes,
  ] = await Promise.all([
    db.query(`
      SELECT sha256, title, publisher, edition, language, grade, subject,
             file_path, ingested_at
      FROM source_documents LIMIT 1
    `),
    db.query(`
      SELECT extractor, extractor_version, schema_version, finished_at
      FROM extraction_runs ORDER BY id DESC LIMIT 1
    `),
    db.query(`
      SELECT kind, count(*)::int AS count FROM graph_nodes
      GROUP BY kind
      ORDER BY CASE kind
        WHEN 'program' THEN 0 WHEN 'course' THEN 1 WHEN 'module' THEN 2
        WHEN 'learning_objective' THEN 3 ELSE 4 END
    `),
    db.query(`
      SELECT edge_type AS type, count(*)::int AS count, min(syllabus_version) AS sv
      FROM graph_edges WHERE system_to IS NULL
      GROUP BY edge_type
      ORDER BY CASE edge_type
        WHEN 'part_of' THEN 0 WHEN 'about' THEN 1
        WHEN 'teaches' THEN 2 ELSE 3 END
    `),
    db.query(`
      SELECT id, label, source_page FROM graph_nodes
      WHERE kind = 'learning_objective' ORDER BY order_in_parent
    `),
    db.query(`
      SELECT src_id, dst_id FROM graph_edges
      WHERE edge_type = 'prerequisite_of' AND system_to IS NULL
    `),
    // The viewer's own mastery, or nothing at all when nobody is signed in —
    // the overlay is a personal detail on a corpus page, not part of the
    // explainer.
    studentId == null
      ? Promise.resolve({ rows: [] as { lo_id: string; score: string }[] })
      : db.query(
          `SELECT lo_id, score FROM mastery
           WHERE student_id = $1 AND system_to IS NULL`,
          [studentId]
        ),
    db.query(`
      SELECT
        count(*) FILTER (WHERE status = 'live')::int          AS live,
        count(*) FILTER (WHERE reviewed_by IS NOT NULL)::int  AS reviewed
      FROM questions
    `),
    // the exemplar plate: prefer the function-definition question (book p.16,
    // the same page shown in the Source scans); fall back to any live row
    db.query(`
      SELECT q.id, q.lo_id, q.tier, q.question_type, q.stem, q.choices,
             q.correct_answer, q.canonical_solution, q.source_page,
             q.source_note, q.reviewed_by, q.reviewed_at, q.status,
             n.label AS lo_label
      FROM questions q
      JOIN graph_nodes n ON n.id = q.lo_id
      WHERE q.status = 'live'
      ORDER BY (q.id = 'q:u1-3-1:001') DESC, q.id
      LIMIT 1
    `),
  ]);

  const d = docRes.rows[0];
  const doc: PipelineDoc = {
    sha256: d.sha256,
    title: d.title,
    publisher: d.publisher,
    edition: d.edition,
    language: d.language,
    grade: d.grade,
    subject: d.subject,
    filePath: d.file_path,
    ingestedAt: new Date(d.ingested_at).toISOString(),
  };

  const r = runRes.rows[0];
  const run: PipelineRun | null = r
    ? {
        extractor: r.extractor,
        extractorVersion: r.extractor_version,
        schemaVersion: String(r.schema_version),
        finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
      }
    : null;

  const prereqEdges = prereqRes.rows.map((e) => ({
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
