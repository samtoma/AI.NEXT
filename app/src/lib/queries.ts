import { sequential } from "./db";
import { visibleGraphFor, type StudentGraphScope } from "./catalog-queries";
import { compareCourses } from "./courses";
import { scoped, type Db } from "./student-context";
import type {
  PlanItem,
  PlanReason,
  SpineBridge,
  SpineData,
  SpineLo,
  SpineQuestion,
  SpineSectionGroup,
  Tier,
} from "./types";

import { spineSubjectOf } from "./subjects";
import { PREREQ_GATE, type ProgressionLesson } from "./progression";
import { computeLayers } from "./spine-layout";
import { SPINE_LO_SQL, SPINE_LO_SQL_NO_SUBJECT_VIEW } from "./spine-lo-query";
import { catalogueObjectivesSql } from "./module-order";
import { slugOfLo } from "./lesson-slug";
import {
  BOOK_SECTIONS_SQL,
  NO_SECTIONS,
  partPrereqEdges,
  partsInCatalogue,
  sectionIndexFromRows,
  withPartPrereqs,
  type BookSectionRow,
  type SectionIndex,
} from "./book-sections";

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
/* Book sections (feature 003, decision 18)                            */
/* ------------------------------------------------------------------ */

/**
 * The book sections of the courses this student may see (`course_lessons`,
 * migration 034), indexed by `lib/book-sections.ts`. `courses` is the gate's
 * own set — the store holds lesson titles, and a hidden course's are not
 * hers. No course, no read.
 *
 * With no split section in them (every National course) the index's
 * `hasSplits` is false, and each reader below then does exactly what it did
 * before 003: the derived edges are empty and the prerequisite map is the
 * same object.
 */
async function sectionIndexOn(
  db: Db,
  courses: ReadonlySet<string> | null
): Promise<SectionIndex> {
  const ids = [...(courses ?? [])];
  if (ids.length === 0) return NO_SECTIONS;
  const r = await db.query(BOOK_SECTIONS_SQL, [ids]);
  return sectionIndexFromRows(r.rows as BookSectionRow[]);
}

/**
 * Objectives in catalogue order → the lessons they make up, in the same
 * order: the shape `lib/book-sections.ts` reads. Only ids are needed for the
 * derived edges, so mastery is 0 and the course is left unset.
 */
function lessonsOfObjectives(loIds: readonly string[]): ProgressionLesson[] {
  const bySlug = new Map<string, { slug: string; courseId: null; los: { id: string; mastery: number }[] }>();
  for (const id of loIds) {
    const slug = slugOfLo(id);
    let l = bySlug.get(slug);
    if (!l) {
      l = { slug, courseId: null, los: [] };
      bySlug.set(slug, l);
    }
    l.los.push({ id, mastery: 0 });
  }
  return [...bySlug.values()];
}

/* ------------------------------------------------------------------ */
/* Home                                                                */
/* ------------------------------------------------------------------ */

/** One source book, as the home plate and the skill map print it. */
export type SourceBook = {
  title: string;
  publisher: string;
  edition: string;
  grade: string;
  subject: string;
};

/**
 * THE book a student-facing page names as "the source": the book of the first
 * course — in course-registry order — that this student may see. `null` when
 * she may see none.
 *
 * It replaces `SELECT … FROM source_documents LIMIT 1` with no ORDER BY, on
 * `/` and on `/spine`, which named whichever book Postgres returned first:
 * with three books loaded that was non-deterministic, and it named a book the
 * student may not see — once a second curriculum's book is loaded, possibly
 * that one (003 privacy review §5 items 1 and 3). A course's book is the
 * `source_documents` row its node is stamped with by the loader.
 */
export async function sourceBookFor(
  db: Db,
  gate: StudentGraphScope
): Promise<SourceBook | null> {
  const res = await db.query(
    `SELECT c.id AS course_id, d.title, d.publisher, d.edition, d.grade, d.subject
       FROM graph_nodes c
       JOIN source_documents d ON d.sha256 = c.source_sha256
      WHERE c.kind = 'course'`
  );
  const first = res.rows
    .filter((r) => gate.course(r.course_id as string))
    .sort((a, b) => compareCourses(a.course_id, b.course_id) || String(a.course_id).localeCompare(String(b.course_id)))[0];
  if (!first) return null;
  return {
    title: first.title as string,
    publisher: first.publisher as string,
    edition: first.edition as string,
    grade: first.grade as string,
    subject: first.subject as string,
  };
}

/**
 * The home page's ledger.
 *
 * THE COURSE GATE (003; FR-2705, FR-4006). The corpus counts used to be
 * corpus-wide — every objective, live question and prerequisite in the
 * database, a hidden course's included — and the plate named `LIMIT 1`'s book.
 * They are now this student's: objectives, live questions and prerequisite
 * edges of the courses she may see (an edge counts when both ends are
 * visible, the rule `/spine` draws by), and her first course's book. Counted
 * in JavaScript over the scope's predicates rather than in SQL, so the gate
 * stays one implementation (`resolveStudentGraphScope`).
 */
export async function getHomeStats(studentId: number) {
  return scoped(studentId, undefined, async (db) => {
    const gate = await visibleGraphFor(db, studentId);
    const [counts, losRes, questionsRes, edgesRes, student] = await sequential([
      // attempts + AI turns are the STUDENT's ledger (the card reads "by
      // <name>"). The `student_id = $1` clauses are belt and braces — the
      // policy would narrow these to the principal anyway — and they stay
      // because a query that states its own scope is a query a reader can
      // check.
      () =>
        db.query(
          `
      SELECT
        (SELECT count(*) FROM attempts WHERE student_id = $1)                AS attempts,
        (SELECT count(*) FROM ai_interactions WHERE student_id = $1)         AS ai_turns
    `,
          [studentId]
        ),
      () => db.query(`SELECT id FROM graph_nodes WHERE kind = 'learning_objective'`),
      // one row per objective, not per question: the count is summed below
      () =>
        db.query(
          `SELECT lo_id, count(*) AS n FROM questions WHERE status = 'live' GROUP BY lo_id`
        ),
      () =>
        db.query(
          `SELECT src_id, dst_id FROM graph_edges
            WHERE edge_type = 'prerequisite_of' AND system_to IS NULL`
        ),
      () => db.query(`SELECT display_name FROM students WHERE id = $1`, [studentId]),
    ] as const);
    const doc = await sourceBookFor(db, gate);
    const c = counts.rows[0];
    return {
      los: losRes.rows.filter((r) => gate.lo(r.id as string)).length,
      questions: questionsRes.rows
        .filter((r) => gate.lo(r.lo_id as string))
        .reduce((sum, r) => sum + Number(r.n), 0),
      attempts: Number(c.attempts),
      prereqs: edgesRes.rows.filter(
        (r) => gate.lo(r.src_id as string) && gate.lo(r.dst_id as string)
      ).length,
      aiTurns: Number(c.ai_turns),
      /** `null` when she may see no course at all — the plate is not drawn */
      doc,
      studentName: (student.rows[0]?.display_name as string) ?? "Student",
    };
  });
}

/* ------------------------------------------------------------------ */
/* Spine (Evidence Walk)                                               */
/* ------------------------------------------------------------------ */

// Longest-path layering (`computeLayers`) lives in lib/spine-layout.ts with
// the rest of the map's geometry, where it can be tested without a database.

/** What the map names when the student may see no course at all. */
const NO_BOOK: SourceBook = { title: "", publisher: "", edition: "", grade: "", subject: "" };

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

  // Catalogue order (FR-3215): each objective joined to its module and sorted
  // by MODULE_ORDER, never by bare `order_in_parent` — see lib/spine-lo-query.ts
  // for the defect that was. The row index below becomes `catalogRank`.
  const loQuery = hasSubjectView ? SPINE_LO_SQL : SPINE_LO_SQL_NO_SUBJECT_VIEW;

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

  const [losRes, edgesRes, masteryRes, questionsRes, countsRes, studentRes, bridgesRes] =
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
      // (the book the map names is read after the gate — `sourceBookFor`)
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
  // The book the map names as its source: her first visible course's, never
  // `LIMIT 1`'s (see `sourceBookFor`). An empty map has no book to name.
  const doc = (await sourceBookFor(db, gate)) ?? NO_BOOK;
  // One card per objective, at its first (earliest-in-catalogue) row. The
  // module join would fan an objective out if it were ever taught by two open
  // modules; `node_subject` already could. Neither happens in today's data.
  const seenLo = new Set<string>();
  losRes.rows = losRes.rows.filter((r) => {
    const id = r.id as string;
    if (!gate.lo(id) || seenLo.has(id)) return false;
    seenLo.add(id);
    return true;
  });
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

  // BOOK SECTIONS (feature 003; FR-4315, FR-4317). A split section's parts
  // are one visible group on the map, and part n-1 is a prerequisite of part
  // n. Those edges are DERIVED here from the store, over the gated objectives
  // only, and kept apart from `edges` (the book's own): they shape the
  // columns and the topic panel's "worth having first" like any prerequisite,
  // and travel as `partEdges` so the map can draw them and nothing mistakes
  // them for the book's. With no split section — every National course —
  // `layerEdges` IS `edges` and both new fields are empty.
  const sections = await sectionIndexOn(db, gate.courses);
  const lessons = sections.hasSplits ? lessonsOfObjectives(ids) : [];
  const partEdges = sections.hasSplits ? partPrereqEdges(lessons, sections) : [];
  const layerEdges = partEdges.length > 0 ? [...edges, ...partEdges] : edges;
  const sectionGroups: SpineSectionGroup[] = sections.splitGroups
    .map((g) => ({
      key: g.key,
      number: g.number,
      title: g.title,
      parts: partsInCatalogue(g, lessons).map((l, i, all) => {
        const part = sections.provenanceOf(l.slug)?.part;
        return {
          slug: l.slug,
          n: part?.n ?? i + 1,
          of: part?.of ?? all.length,
          loIds: l.los.map((lo) => lo.id),
        };
      }),
    }))
    .filter((g) => g.parts.length > 0);

  const layers = computeLayers(ids, layerEdges);

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

  // Catalogue rank = row index of the ordered, gated query (FR-3215).
  const rankOf = new Map(ids.map((id, i) => [id, i]));
  const rank = (id: string) => rankOf.get(id) ?? ids.length;

  const prereqsOf = new Map<string, string[]>();
  for (const e of edges) {
    const list = prereqsOf.get(e.dst) ?? [];
    list.push(e.src);
    prereqsOf.set(e.dst, list);
  }
  // the derived part edges (none without a split section), each once
  for (const e of partEdges) {
    const list = prereqsOf.get(e.dst) ?? [];
    if (!list.includes(e.src)) list.push(e.src);
    prereqsOf.set(e.dst, list);
  }
  // The edge read has no ORDER BY, so the topic panel's "Worth having first"
  // list came out in whatever order Postgres returned — the same defect as the
  // map's columns, one level down. Catalogue order here too.
  for (const list of prereqsOf.values()) list.sort((a, b) => rank(a) - rank(b));

  const los: SpineLo[] = losRes.rows.map((r) => ({
    id: r.id,
    label: r.label,
    description: r.description,
    syllabusRef: r.syllabus_ref,
    sourcePage: r.source_page,
    orderInParent: Number(r.order_in_parent),
    catalogRank: rank(r.id),
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
    doc,
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
    sectionGroups,
    partEdges,
  };
}

/* ------------------------------------------------------------------ */
/* Student plan builder                                                */
/* ------------------------------------------------------------------ */

// PREREQ_GATE moved to lib/progression.ts (ADR-0020) so the plan builder and
// the lesson-progression walk share one definition of "prerequisites met".
// It lives there, not here, because that module is pure and this one opens a
// connection pool — the import has to point this way round.
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
    // Every objective of every subject, split by SUBJECT (registry order —
    // maths first) and in CATALOGUE order inside each (FR-3217): the order
    // the lesson list, the progression and the skill map use. It used to be
    // `ORDER BY order_in_parent` alone: a position inside a module, shared by
    // the first objective of every unit of every subject, so Postgres chose
    // the order of each tie and the plan's tie-breaks below inherited it.
    () => db.query(catalogueObjectivesSql("lo.id, lo.label")),
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
  const bookPrereqs = new Map<string, string[]>();
  for (const e of edgesRes.rows) {
    const list = bookPrereqs.get(e.dst_id) ?? [];
    list.push(e.src_id);
    bookPrereqs.set(e.dst_id, list);
  }
  const qs: QRow[] = qRes.rows.map((r) => ({
    ...r,
    recent_attempts: Number(r.recent_attempts),
  }));

  const loIds = losRes.rows.map((r) => r.id as string);

  // BOOK SECTIONS (feature 003; FR-4313, FR-4317). Part n-1 of a split
  // section is a prerequisite of part n, so a part's objectives are
  // "eligible" only once the part before it is under way — the same derived
  // edges the progression walks (`withPartPrereqs`, lib/book-sections.ts),
  // over the gated objectives only. With no split section — every National
  // course — `withPartPrereqs` returns `bookPrereqs` itself, and the plan is
  // exactly the plan it was.
  const sections = await sectionIndexOn(db, gate.courses);
  const prereqs: ReadonlyMap<string, readonly string[]> = sections.hasSplits
    ? withPartPrereqs(bookPrereqs, lessonsOfObjectives(loIds), sections)
    : bookPrereqs;
  const eligible = (lo: string) =>
    (prereqs.get(lo) ?? []).every((p) => (score.get(p) ?? 0) >= PREREQ_GATE);

  // The plan's own order is "weakest first" (and "strongest first" for
  // review) — that stays the primary key. The tie-break is the subject, then
  // catalogue order inside it, written out rather than left to sort
  // stability: `rank` is each objective's row index in the read above. It
  // decides almost everything for a new student, whose every score is 0.
  const rank = new Map(loIds.map((id, i) => [id, i]));
  const byCatalogue = (a: string, b: string) =>
    (rank.get(a) ?? 0) - (rank.get(b) ?? 0);

  const byScoreAsc = [...loIds].sort(
    (a, b) => (score.get(a) ?? 0) - (score.get(b) ?? 0) || byCatalogue(a, b)
  );

  const weakestEligible = byScoreAsc.filter(
    (lo) => eligible(lo) && (score.get(lo) ?? 0) < REVIEW_FLOOR
  );
  const reviewPool = [...loIds]
    .filter((lo) => (score.get(lo) ?? 0) >= REVIEW_FLOOR)
    .sort(
      (a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0) || byCatalogue(a, b)
    );
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
