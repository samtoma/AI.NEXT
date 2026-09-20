import { sequential } from "./db";
import { visibleGraphFor } from "./catalog-queries";
import { scoped, type Db } from "./student-context";
import type {
  PlanItem,
  PlanReason,
  SpineBridge,
  SpineData,
  SpineLo,
  SpineQuestion,
  Tier,
} from "./types";

import { spineSubjectOf } from "./subjects";

/**
 * Every function here mixes curriculum reads (no policies — the graph is not
 * student data) with student reads (`mastery`, `attempts`, `ai_interactions`,
 * `students`), and the second kind now returns NOTHING without a principal. So
 * each one runs as a single unit of work under the student it is about.
 *
 * One consequence worth naming rather than discovering: these reads never ran
 * in parallel. node-postgres queues statements on a single client, so a unit
 * of work serialises them regardless of how they're written — that is a few
 * milliseconds against this corpus, and it buys one connection per render
 * instead of eight, the trade research R7's pool budget asks for. This used
 * to be written as `Promise.all` for exactly that reason: the shape still
 * expressed "these are independent" even though the client ran them one at a
 * time underneath. **It is `sequential([...])` now instead**, because pg@9
 * removes the implicit queuing `Promise.all` was quietly relying on ("Calling
 * client.query() when the client is already executing a query is
 * deprecated"). The shape carries the same meaning as before — a fixed-order
 * tuple of independent reads — just without a name that promises concurrency
 * this module was never getting.
 *
 * There is no `DEFAULT_STUDENT_ID` any more: a caller with nobody signed in has
 * no business rendering a student's mastery, so `studentId` is required.
 */

/** True if a relation/view exists (avoids querying a table the data agent
 *  hasn't created yet — the multi-subject contract lands in parallel). */
async function relationExists(db: Db, qualified: string): Promise<boolean> {
  const r = await db.query(`SELECT to_regclass($1) AS reg`, [qualified]);
  return r.rows[0]?.reg !== null;
}

async function columnExists(db: Db, table: string, column: string): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = $1 AND column_name = $2 LIMIT 1`,
    [table, column]
  );
  return (r.rowCount ?? 0) > 0;
}

/* ------------------------------------------------------------------ */
/* Home                                                                */
/* ------------------------------------------------------------------ */

export async function getHomeStats(studentId: number) {
  return scoped(studentId, undefined, async (db) => {
    const [counts, doc, student] = await sequential([
      // attempts + AI turns are the STUDENT's ledger (the card reads "by
      // <name>"), everything else is corpus-wide. The `student_id = $1` clauses
      // are now belt and braces — the policy would narrow these to the
      // principal anyway — and they stay because a query that states its own
      // scope is a query a reader can check.
      () =>
        db.query(
          `
      SELECT
        (SELECT count(*) FROM graph_nodes WHERE kind = 'learning_objective') AS los,
        (SELECT count(*) FROM questions WHERE status = 'live')               AS questions,
        (SELECT count(*) FROM attempts WHERE student_id = $1)                AS attempts,
        (SELECT count(*) FROM graph_edges WHERE edge_type = 'prerequisite_of'
           AND system_to IS NULL)                                            AS prereqs,
        (SELECT count(*) FROM ai_interactions WHERE student_id = $1)         AS ai_turns
    `,
          [studentId]
        ),
      () =>
        db.query(
          `SELECT title, publisher, edition, grade, subject FROM source_documents LIMIT 1`
        ),
      () => db.query(`SELECT display_name FROM students WHERE id = $1`, [studentId]),
    ] as const);
    const c = counts.rows[0];
    return {
      los: Number(c.los),
      questions: Number(c.questions),
      attempts: Number(c.attempts),
      prereqs: Number(c.prereqs),
      aiTurns: Number(c.ai_turns),
      doc: doc.rows[0] as {
        title: string;
        publisher: string;
        edition: string;
        grade: string;
        subject: string;
      },
      studentName: (student.rows[0]?.display_name as string) ?? "Student",
    };
  });
}

/* ------------------------------------------------------------------ */
/* Spine (Evidence Walk)                                               */
/* ------------------------------------------------------------------ */

/** Longest-path layering over the prerequisite DAG. */
function computeLayers(
  ids: string[],
  edges: { src: string; dst: string }[]
): Map<string, number> {
  const layer = new Map<string, number>(ids.map((id) => [id, 0]));
  // relax |V| times (tiny graph — simplicity over cleverness)
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

export async function getSpineData(studentId: number): Promise<SpineData> {
  return scoped(studentId, undefined, (db) => spineDataOn(db, studentId));
}

async function spineDataOn(db: Db, studentId: number): Promise<SpineData> {
  // The multi-subject contract (node_subject view, relates_to edges +
  // rationale column) is built in parallel — detect what's live and degrade
  // gracefully (id-prefix subject fallback; no bridges) until it lands.
  const [hasSubjectView, hasRationale] = await sequential([
    () => relationExists(db, "node_subject"),
    () => columnExists(db, "graph_edges", "rationale"),
  ] as const);

  const loQuery = hasSubjectView
    ? `
        SELECT n.id, n.label, n.description, n.syllabus_ref, n.source_page,
               n.order_in_parent, ns.subject
        FROM graph_nodes n
        LEFT JOIN node_subject ns ON ns.node_id = n.id
        WHERE n.kind = 'learning_objective'
        ORDER BY n.order_in_parent
      `
    : `
        SELECT id, label, description, syllabus_ref, source_page, order_in_parent
        FROM graph_nodes
        WHERE kind = 'learning_objective'
        ORDER BY order_in_parent
      `;

  // relates_to bridges: only queryable once the rationale column exists.
  // A thunk, not an already-started query — `db` is one shared client, so this
  // must wait its turn in the `sequential` list below rather than firing
  // before `loQuery` and the rest have even been issued.
  const bridgesThunk = () =>
    hasRationale
      ? db.query(`
        SELECT src_id, dst_id, rationale
        FROM graph_edges
        WHERE edge_type = 'relates_to' AND system_to IS NULL
      `)
      : Promise.resolve({ rows: [] as { src_id: string; dst_id: string; rationale: string }[] });

  const [losRes, edgesRes, masteryRes, questionsRes, docRes, countsRes, studentRes, bridgesRes] =
    await sequential([
      () => db.query(loQuery),
      () =>
        db.query(`
        SELECT src_id, dst_id, syllabus_version
        FROM graph_edges
        WHERE edge_type = 'prerequisite_of' AND system_to IS NULL
      `),
      () =>
        db.query(
          `
        SELECT lo_id, score, system_from, system_to
        FROM mastery
        WHERE student_id = $1
        ORDER BY lo_id, system_from
      `,
          [studentId]
        ),
      () =>
        db.query(`
        SELECT q.id, q.lo_id, q.tier, q.question_type, q.stem, q.choices,
               q.correct_answer, q.canonical_solution, q.solution_version, q.status,
               q.source, q.parent_question_id, q.source_sha256, q.source_page,
               q.source_note, q.reviewed_by, q.reviewed_at,
               er.extractor, er.extractor_version, er.finished_at AS extraction_finished_at
        FROM questions q
        LEFT JOIN extraction_runs er ON er.id = q.extraction_run_id
        WHERE q.status = 'live'
        ORDER BY q.lo_id, q.tier, q.id
      `),
      () =>
        db.query(
          `SELECT title, publisher, edition, grade, subject FROM source_documents LIMIT 1`
        ),
      // this student's attempts (the toolbar chip sits next to HIS avg mastery)
      () =>
        db.query(`SELECT count(*) AS attempts FROM attempts WHERE student_id = $1`, [
          studentId,
        ]),
      () => db.query(`SELECT display_name FROM students WHERE id = $1`, [studentId]),
      bridgesThunk,
    ] as const);

  // THE COURSE GATE (migration 023, lib/catalog.ts). `/spine` is the widest
  // student-facing read in the product: every objective, and every live
  // question WITH its correct answer and canonical solution. Ungated, it is a
  // complete copy of a hidden course's content one click from the lesson
  // report — which is why the filtering happens here, on the raw rows, before
  // the layering and the roll-ups that everything below is built from.
  //
  // A prerequisite edge survives only when BOTH endpoints do: an arrow into a
  // hidden course draws a node for it.
  //
  // The four result objects are local and a few lines old, so they are
  // narrowed IN PLACE deliberately: every projection below reads `.rows`, and
  // a filtered copy beside the original is a second thing to remember to use.
  const gate = await visibleGraphFor(db, studentId);
  losRes.rows = losRes.rows.filter((r) => gate.lo(r.id as string));
  questionsRes.rows = questionsRes.rows.filter((r) => gate.lo(r.lo_id as string));
  edgesRes.rows = edgesRes.rows.filter(
    (r) => gate.lo(r.src_id as string) && gate.lo(r.dst_id as string)
  );
  bridgesRes.rows = bridgesRes.rows.filter(
    (r) => gate.lo(r.src_id as string) && gate.lo(r.dst_id as string)
  );

  const edges = edgesRes.rows.map((r) => ({
    src: r.src_id as string,
    dst: r.dst_id as string,
  }));
  const ids = losRes.rows.map((r) => r.id as string);
  const layers = computeLayers(ids, edges);

  // baseline = earliest mastery row per LO; current = open row (system_to IS NULL)
  const baseline = new Map<string, number>();
  const current = new Map<string, number>();
  let baselineDate = "";
  let currentDate = "";
  for (const row of masteryRes.rows) {
    const lo = row.lo_id as string;
    const systemFrom = new Date(row.system_from).toISOString();
    if (!baseline.has(lo)) {
      baseline.set(lo, Number(row.score));
      // earliest diagnostic row across all LOs, not just the last one seen
      if (!baselineDate || systemFrom < baselineDate) baselineDate = systemFrom;
    }
    if (row.system_to === null) {
      current.set(lo, Number(row.score));
      // most recent open row across all LOs — the true "as of now"
      if (!currentDate || systemFrom > currentDate) currentDate = systemFrom;
    }
  }

  const prereqsOf = new Map<string, string[]>();
  for (const e of edges) {
    const list = prereqsOf.get(e.dst) ?? [];
    list.push(e.src);
    prereqsOf.set(e.dst, list);
  }

  const los: SpineLo[] = losRes.rows.map((r) => ({
    id: r.id,
    label: r.label,
    description: r.description,
    syllabusRef: r.syllabus_ref,
    sourcePage: r.source_page,
    orderInParent: Number(r.order_in_parent),
    layer: layers.get(r.id) ?? 0,
    prereqIds: prereqsOf.get(r.id) ?? [],
    baseline: baseline.get(r.id) ?? 0,
    current: current.get(r.id) ?? 0,
    // `node_subject.subject` validated against the registry. Anything it does
    // not recognise — including migration 006's legacy 'other' — is `null`
    // (UNFILED, its own neutral band), never folded into maths. The old code
    // fell back to `id.startsWith("lo:soc") ? "social" : "math"`, which made
    // every unrecognised objective a maths objective on the graph.
    subject: spineSubjectOf(r.subject),
  }));

  // Cross-subject bridges: keep only edges whose endpoints are both real LOs
  // in this graph (defensive — a bridge to a pruned node is meaningless).
  const loIdSet = new Set(los.map((l) => l.id));
  const bridges: SpineBridge[] = bridgesRes.rows
    .filter((r) => loIdSet.has(r.src_id) && loIdSet.has(r.dst_id))
    .map((r) => ({
      src: r.src_id as string,
      dst: r.dst_id as string,
      rationale: (r.rationale as string) ?? "",
    }));

  const questions: SpineQuestion[] = questionsRes.rows.map((r) => ({
    id: r.id,
    loId: r.lo_id,
    tier: r.tier as Tier,
    questionType: r.question_type,
    stem: r.stem,
    choices: r.choices,
    correctAnswer: r.correct_answer,
    solution: r.canonical_solution ?? [],
    solutionVersion: Number(r.solution_version ?? 1),
    status: r.status,
    provenance: {
      source: r.source,
      parentQuestionId: r.parent_question_id ?? null,
      sourceSha256: r.source_sha256,
      sourcePage: r.source_page,
      sourceNote: r.source_note,
      reviewedBy: r.reviewed_by,
      reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null,
      extractor: r.extractor,
      extractorVersion: r.extractor_version,
      extractionFinishedAt: r.extraction_finished_at
        ? new Date(r.extraction_finished_at).toISOString()
        : null,
    },
  }));

  return {
    los,
    edges,
    bridges,
    questions,
    doc: docRes.rows[0],
    syllabusVersion: (edgesRes.rows[0]?.syllabus_version as string) ?? "2025-2026",
    baselineDate,
    currentDate,
    counts: {
      los: los.length,
      questions: questions.length,
      edges: edges.length,
      attempts: Number(countsRes.rows[0].attempts),
    },
    studentName: (studentRes.rows[0]?.display_name as string) ?? "Student",
  };
}

/* ------------------------------------------------------------------ */
/* Student plan builder                                                */
/* ------------------------------------------------------------------ */

const PREREQ_GATE = 0.5;
const REVIEW_FLOOR = 0.72;

function pickTierFor(score: number): Tier {
  if (score < 0.4) return "basic";
  if (score < 0.7) return "standard";
  return "advanced";
}

interface QRow {
  id: string;
  lo_id: string;
  tier: Tier;
  question_type: "mcq" | "numeric";
  stem: string;
  choices: PlanItem["choices"];
  source_page: number | null;
  recent_attempts: number;
}

/** Pick one question for an LO, preferring the target tier and least-drilled. */
function pickQuestion(
  qs: QRow[],
  loId: string,
  targetTier: Tier,
  used: Set<string>
): QRow | null {
  const pool_ = qs.filter((q) => q.lo_id === loId && !used.has(q.id));
  if (pool_.length === 0) return null;
  const tierRank = (q: QRow) => (q.tier === targetTier ? 0 : 1);
  pool_.sort(
    (a, b) =>
      tierRank(a) - tierRank(b) ||
      a.recent_attempts - b.recent_attempts ||
      a.id.localeCompare(b.id)
  );
  return pool_[0];
}

export async function getStudentPlan(studentId: number): Promise<{
  items: PlanItem[];
  studentName: string;
  mastery: { loId: string; label: string; score: number }[];
}> {
  return scoped(studentId, undefined, (db) => studentPlanOn(db, studentId));
}

async function studentPlanOn(
  db: Db,
  studentId: number
): Promise<{
  items: PlanItem[];
  studentName: string;
  mastery: { loId: string; label: string; score: number }[];
}> {
  const [losRes, edgesRes, masteryRes, qRes, studentRes] = await sequential([
    () =>
      db.query(`
      SELECT id, label, order_in_parent FROM graph_nodes
      WHERE kind = 'learning_objective' ORDER BY order_in_parent
    `),
    () =>
      db.query(`
      SELECT src_id, dst_id FROM graph_edges
      WHERE edge_type = 'prerequisite_of' AND system_to IS NULL
    `),
    () =>
      db.query(
        `SELECT lo_id, score FROM mastery WHERE student_id = $1 AND system_to IS NULL`,
        [studentId]
      ),
    () =>
      db.query(
        `
      SELECT q.id, q.lo_id, q.tier, q.question_type, q.stem, q.choices, q.source_page,
             (SELECT count(*) FROM attempts a
               WHERE a.question_id = q.id AND a.student_id = $1
                 AND a.attempted_at > now() - interval '2 days') AS recent_attempts
      FROM questions q
      WHERE q.status = 'live'
    `,
        [studentId]
      ),
    () => db.query(`SELECT display_name FROM students WHERE id = $1`, [studentId]),
  ] as const);

  // THE COURSE GATE (migration 023, lib/catalog.ts). The practice loop picks
  // from every live question in the database; without this it would hand a
  // student the stem and the options of a course nobody switched on for them.
  // (`/api/attempts` would then refuse the answer, which is the worst of both:
  // the content is shown and the lesson does not work.)
  //
  // Narrowed in place, for the reason `spineDataOn` gives: the selector below
  // reads these rows in four places and a filtered copy is a fifth.
  const gate = await visibleGraphFor(db, studentId);
  losRes.rows = losRes.rows.filter((r) => gate.lo(r.id as string));
  qRes.rows = qRes.rows.filter((r) => gate.lo(r.lo_id as string));
  edgesRes.rows = edgesRes.rows.filter(
    (r) => gate.lo(r.src_id as string) && gate.lo(r.dst_id as string)
  );

  const labels = new Map<string, string>(
    losRes.rows.map((r) => [r.id, r.label])
  );
  const score = new Map<string, number>(
    masteryRes.rows.map((r) => [r.lo_id, Number(r.score)])
  );
  const prereqs = new Map<string, string[]>();
  for (const e of edgesRes.rows) {
    const list = prereqs.get(e.dst_id) ?? [];
    list.push(e.src_id);
    prereqs.set(e.dst_id, list);
  }
  const qs: QRow[] = qRes.rows.map((r) => ({
    ...r,
    recent_attempts: Number(r.recent_attempts),
  }));

  const loIds = losRes.rows.map((r) => r.id as string);
  const eligible = (lo: string) =>
    (prereqs.get(lo) ?? []).every((p) => (score.get(p) ?? 0) >= PREREQ_GATE);

  const byScoreAsc = [...loIds].sort(
    (a, b) => (score.get(a) ?? 0) - (score.get(b) ?? 0)
  );

  const weakestEligible = byScoreAsc.filter(
    (lo) => eligible(lo) && (score.get(lo) ?? 0) < REVIEW_FLOOR
  );
  const reviewPool = [...loIds]
    .filter((lo) => (score.get(lo) ?? 0) >= REVIEW_FLOOR)
    .sort((a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0));
  // stretch: the frontier — weakest LO whose prerequisites are NOT yet met
  const stretchPool = byScoreAsc.filter((lo) => !eligible(lo));

  const used = new Set<string>();
  const items: PlanItem[] = [];

  const add = (lo: string, reason: PlanReason, tierOverride?: Tier) => {
    const s = score.get(lo) ?? 0;
    const q = pickQuestion(qs, lo, tierOverride ?? pickTierFor(s), used);
    if (!q) return false;
    used.add(q.id);
    items.push({
      questionId: q.id,
      loId: lo,
      loLabel: labels.get(lo) ?? lo,
      loScore: s,
      tier: q.tier,
      questionType: q.question_type,
      stem: q.stem,
      choices: q.choices,
      reason,
      sourcePage: q.source_page,
    });
    return true;
  };

  // ~60% weakest (3 of 5), ~25% review (1), ~15% stretch (1)
  let wi = 0;
  while (items.length < 3 && wi < weakestEligible.length * 2) {
    add(weakestEligible[wi % weakestEligible.length], "weakest");
    wi++;
  }
  if (reviewPool.length > 0) add(reviewPool[0], "review");
  if (stretchPool.length > 0) add(stretchPool[0], "stretch", "basic");
  // backfill to 5 from weakest pool if anything above came up dry
  let bi = 0;
  while (items.length < 5 && bi < byScoreAsc.length) {
    add(byScoreAsc[bi], "weakest");
    bi++;
  }

  return {
    items,
    studentName:
      (studentRes.rows[0]?.display_name as string) ?? "Student",
    mastery: loIds.map((lo) => ({
      loId: lo,
      label: labels.get(lo) ?? lo,
      score: score.get(lo) ?? 0,
    })),
  };
}
