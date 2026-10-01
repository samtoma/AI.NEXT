/**
 * THE CONSOLE REVIEW GATE — the database seam (migration 036; the rules are
 * `lib/review-gate.ts`).
 *
 * Every read here runs as `ainext_operator` (`withOperator`), and every write
 * is one the console already held the grant for before 036 — a question's
 * human stamp, status and widget claims (`questions`, 017/018), a library
 * entry's `reviewed` flag — plus 036's own two tables. Nothing here is reached
 * by a student surface (`review-gate.test.mts` scans for an import).
 *
 * **What a backlog item is, in SQL.** Every reader joins through `SCOPE`: the
 * objectives of a MATHS course (`graph_nodes.subject = 'math'`) with their
 * chapter. Social Studies and Arabic keep their own review queue and are not
 * here at all (answer 37a); nor are Quran/Hadith, which only those subjects
 * carry. Each reader also computes the item's FINGERPRINT — an md5 of exactly
 * the content a reviewer signs, never of its stamps or status — so a decision
 * can be matched against the content it was made on (`resolveItem`).
 *
 *   question    type, tier, objective, stem, answer key, worked solution, the
 *               options / marker / widget setup (NOT its predicate claims —
 *               those are their own items), and its figures
 *   claim       the widget question's fingerprint + predicate + misconception
 *               (NOT whether it is active: activating it must not reopen it)
 *   misconception  objective, label, description, signal and its refutations
 *   worked example objective, type, content, page
 *   objective   label, description, syllabus ref, chapter
 *   link        the two objectives and the rationale
 *   figure      kind, spec, caption, question
 *
 * Kinds the backlog cannot derive from the database today are reported by the
 * agent that built this rather than stored somewhere new (the pipeline's G1
 * coverage verdicts, S0b formula readings, the G3 family sample) — they are
 * pipeline artefacts with no table.
 */

import type { PoolClient } from "pg";

import { courseName } from "./console-course-names";
import { coverageStatus } from "./coverage-status";
import { COURSES, isCourseId } from "./courses";
import { withOperator } from "./db";
import { BOOTSTRAP_OPERATOR_EMAIL, ENVIRONMENT } from "./env";
import { COURSE_RANK, MODULE_ORDER } from "./module-order";
import { readGateRecords, type GateRecordRow } from "./review-gate-files";
import {
  canDecide,
  claimRef,
  deriveClaim,
  deriveContent,
  deriveGate,
  deriveQuestion,
  isDecision,
  isItemKind,
  isQuestionKind,
  itemKey,
  MAX_CORRECTION,
  MAX_NOTE,
  onFixList,
  parseClaimRef,
  pickCandidates,
  planClaimApprove,
  planClaimReject,
  resolveItem,
  stepsOf,
  summarize,
  type BacklogFilters,
  type BacklogSummary,
  type ClaimRow,
  type ContentRow,
  type Decision,
  type DerivedItem,
  type FigurePayload,
  type FixRequestEntry,
  type HistoryEntry,
  type ItemKind,
  type LatestDecision,
  type MisconceptionBrief,
  type QuestionPayload,
  type QuestionRow,
  type ResolvedItem,
  type ReviewItemPayload,
} from "./review-gate";

/** The slice of a client this module uses — a `PoolClient`, or a test's `pg.Client`. */
export type Db = Pick<PoolClient, "query">;

/** How long a reviewer holds an item they opened. */
export const CLAIM_MINUTES = 10;

/* ------------------------------------------------------------------ SQL */

/**
 * Maths objectives → chapter → course, one row per objective, each with its
 * place in the book: `catalogue_rank` is the objective's rank in THE catalogue
 * order (`lib/module-order.ts` — course, term, chapter, position, id), so the
 * queue hands a reviewer a chapter in the order the book prints it and no
 * second ordering of the curriculum exists here.
 */
export const SCOPE_SQL = `
  scope AS (
    SELECT DISTINCT ON (lo.id)
           lo.id AS lo_id, m.id AS module_id, c.id AS course_id,
           dense_rank() OVER (ORDER BY ${COURSE_RANK}, ${MODULE_ORDER}) AS catalogue_rank
      FROM graph_nodes lo
      JOIN graph_edges te ON te.dst_id = lo.id AND te.edge_type = 'teaches' AND te.system_to IS NULL
      JOIN graph_nodes m  ON m.id = te.src_id AND m.kind = 'module'
      JOIN graph_edges pe ON pe.src_id = m.id AND pe.edge_type = 'part_of' AND pe.system_to IS NULL
      JOIN graph_nodes c  ON c.id = pe.dst_id AND c.kind = 'course'
     WHERE lo.kind = 'learning_objective' AND c.subject = 'math'
     ORDER BY lo.id, m.id
  )`;

/** A question's content fingerprint (alias `q`). Stamps, status and predicate claims are NOT in it. */
export const QUESTION_FP = `md5(concat_ws(chr(31),
    q.question_type, q.tier, q.lo_id, q.stem, q.correct_answer,
    coalesce(q.canonical_solution::text, ''),
    coalesce(CASE WHEN jsonb_typeof(q.choices) = 'object'
                  THEN (q.choices - 'diagnostics' - 'pending_review')::text
                  ELSE q.choices::text END, ''),
    coalesce((SELECT string_agg(v.kind || ':' || md5(v.spec::text) || ':' || coalesce(v.caption, ''), ',' ORDER BY v.id)
                FROM visuals v WHERE v.question_id = q.id), '')))`;

const QUESTIONS_SQL = (where: string) => `
  WITH ${SCOPE_SQL}
  SELECT q.id, s.course_id, s.module_id, s.catalogue_rank, q.lo_id, q.question_type, q.source,
         q.status, q.reviewed_by, q.ai_checked_by, q.hold_reason, q.review_note,
         ${QUESTION_FP} AS fingerprint, q.created_at
    FROM questions q JOIN scope s ON s.lo_id = q.lo_id
   WHERE q.status IN ('live', 'review') AND q.materialised_from IS NULL ${where}`;

const CLAIMS_SQL = (where: string) => `
  WITH ${SCOPE_SQL}
  SELECT q.id AS question_id, s.course_id, s.module_id, s.catalogue_rank, q.lo_id,
         d.e->>'predicate' AS predicate, d.e->>'misconception_id' AS misconception_id,
         d.state, d.e->>'why' AS why,
         md5(concat_ws(chr(31), ${QUESTION_FP}, d.e->>'predicate', d.e->>'misconception_id')) AS fingerprint,
         q.created_at
    FROM questions q JOIN scope s ON s.lo_id = q.lo_id
   CROSS JOIN LATERAL (
          SELECT e, 'active'::text AS state
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(q.choices->'diagnostics') = 'array'
                                           THEN q.choices->'diagnostics' ELSE '[]'::jsonb END) e
          UNION ALL
          SELECT e, 'held'::text
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(q.choices->'pending_review') = 'array'
                                           THEN q.choices->'pending_review' ELSE '[]'::jsonb END) e
        ) d
   WHERE q.question_type = 'widget' AND q.status IN ('live', 'review') AND q.materialised_from IS NULL
     AND jsonb_typeof(q.choices) = 'object'
     AND jsonb_typeof(d.e) = 'object' AND d.e ? 'predicate' AND d.e ? 'misconception_id' ${where}
   ORDER BY q.id, d.state`;

const MISCONCEPTIONS_SQL = (where: string) => `
  WITH ${SCOPE_SQL}
  SELECT mc.id AS ref, s.course_id, s.module_id, s.catalogue_rank, mc.lo_id, mc.generated_by,
         md5(concat_ws(chr(31), mc.lo_id, mc.label, mc.description, coalesce(mc.signal, ''),
             coalesce((SELECT string_agg(e.content::text, chr(30) ORDER BY e.id)
                         FROM explanation_library e
                        WHERE e.misconception_id = mc.id AND e.entry_type = 'refutation'), ''))) AS fingerprint,
         mc.created_at
    FROM misconceptions mc JOIN scope s ON s.lo_id = mc.lo_id
   WHERE true ${where}`;

const WORKED_SQL = (where: string) => `
  WITH ${SCOPE_SQL}
  SELECT e.id AS ref, s.course_id, s.module_id, s.catalogue_rank, e.lo_id, e.generated_by,
         e.reviewed, e.reviewed_by,
         md5(concat_ws(chr(31), e.lo_id, e.entry_type, coalesce(e.misconception_id, ''),
                       e.content::text, coalesce(e.source_page::text, ''))) AS fingerprint,
         e.created_at
    FROM explanation_library e JOIN scope s ON s.lo_id = e.lo_id
   WHERE e.entry_type <> 'refutation' ${where}`;

const OBJECTIVES_SQL = (where: string) => `
  WITH ${SCOPE_SQL}
  SELECT lo.id AS ref, s.course_id, s.module_id, s.catalogue_rank, lo.id AS lo_id,
         md5(concat_ws(chr(31), lo.label, coalesce(lo.description, ''), coalesce(lo.syllabus_ref, ''),
                       coalesce(s.module_id, ''))) AS fingerprint,
         lo.created_at
    FROM graph_nodes lo JOIN scope s ON s.lo_id = lo.id
   WHERE true ${where}`;

const LINKS_SQL = (where: string) => `
  WITH ${SCOPE_SQL}
  SELECT DISTINCT ON (e.src_id, e.dst_id)
         e.src_id || '>' || e.dst_id AS ref, s.course_id, s.module_id, s.catalogue_rank, e.dst_id AS lo_id,
         md5(concat_ws(chr(31), e.src_id, e.dst_id, coalesce(e.rationale, ''))) AS fingerprint,
         e.system_from AS created_at
    FROM graph_edges e JOIN scope s ON s.lo_id = e.dst_id
   WHERE e.edge_type = 'prerequisite_of' AND e.system_to IS NULL ${where}
   ORDER BY e.src_id, e.dst_id, e.system_from`;

const FIGURES_SQL = (where: string) => `
  WITH ${SCOPE_SQL}
  SELECT v.id AS ref, s.course_id, s.module_id, s.catalogue_rank, v.lo_id, q.status AS question_status,
         md5(concat_ws(chr(31), v.kind, v.spec::text, coalesce(v.caption, ''), coalesce(v.question_id, ''))) AS fingerprint,
         v.created_at
    FROM visuals v JOIN scope s ON s.lo_id = v.lo_id
    LEFT JOIN questions q ON q.id = v.question_id
   WHERE v.kind = 'book_image' AND jsonb_typeof(v.spec) = 'object' AND (v.spec->>'stand_in') = 'true'
     AND (v.question_id IS NULL OR q.status IN ('live', 'review')) ${where}`;

/* --------------------------------------------------------- derivation */

/**
 * Every backlog candidate, or the one named by `only`. One query per kind;
 * `only` adds a WHERE on the item's own id so the single-item path reads
 * through exactly the SQL the list does.
 */
export async function deriveAll(
  c: Db,
  only?: { kind: ItemKind; ref: string } | null,
  gates: () => Promise<GateRecordRow[]> = readGateRecords
): Promise<DerivedItem[]> {
  const want = (k: ItemKind) => !only || only.kind === k;
  const out: DerivedItem[] = [];

  if (want("book_question") || want("generated_question") || want("widget_question")) {
    const res = await c.query(QUESTIONS_SQL(only ? "AND q.id = $1" : ""), only ? [only.ref] : []);
    for (const r of res.rows as QuestionRow[]) {
      const d = deriveQuestion(r);
      if (d && (!only || d.kind === only.kind)) out.push(d);
    }
  }
  if (want("mapping_claim")) {
    const claim = only ? parseClaimRef(only.ref) : null;
    if (!only || claim) {
      const res = await c.query(CLAIMS_SQL(claim ? "AND q.id = $1" : ""), claim ? [claim.questionId] : []);
      const seen = new Set<string>();
      for (const r of res.rows as ClaimRow[]) {
        const ref = claimRef(r.question_id, r.predicate, r.misconception_id);
        // active sorts before held: a claim stored twice reads as active, once
        if (seen.has(ref) || (only && ref !== only.ref)) continue;
        seen.add(ref);
        out.push(deriveClaim(r));
      }
    }
  }
  const content = async (
    kind: "misconception" | "worked_example" | "objective" | "prerequisite_link" | "figure_stand_in",
    sql: (w: string) => string,
    where: string,
    params: unknown[]
  ) => {
    if (!want(kind)) return;
    const res = await c.query(sql(only ? where : ""), only ? params : []);
    for (const r of res.rows as ContentRow[]) out.push(deriveContent(kind, r));
  };
  await content("misconception", MISCONCEPTIONS_SQL, "AND mc.id = $1", [only?.ref]);
  await content("worked_example", WORKED_SQL, "AND e.id = $1", [only?.ref]);
  await content("objective", OBJECTIVES_SQL, "AND lo.id = $1", [only?.ref]);
  if (want("prerequisite_link")) {
    const [src, dst] = (only?.ref ?? "").split(">");
    if (!only || (src && dst)) {
      await content("prerequisite_link", LINKS_SQL, "AND e.src_id = $1 AND e.dst_id = $2", [src, dst]);
    }
  }
  await content("figure_stand_in", FIGURES_SQL, "AND v.id = $1", [only?.ref]);
  if (want("gate_decision")) {
    const records = (await gates()).filter((r) => !only || r.ref === only.ref);
    if (records.length > 0) {
      const chapters = await chapterIndex(c);
      for (const r of records) {
        out.push(deriveGate(r, r.chapter == null ? null : (chapters.get(`${r.courseId}|${r.chapter}`) ?? null)));
      }
    }
  }
  return out;
}

/**
 * "<course>|<chapter number>" → the chapter's module and its first objective's
 * place in book order, for placing a gate decision with its chapter. A
 * chapter is the module whose position in its course is that number; a
 * position two modules share (Prep 3's terms) names no chapter.
 */
async function chapterIndex(c: Db): Promise<Map<string, { moduleId: string; catalogueRank: number }>> {
  const res = await c.query(
    `WITH ${SCOPE_SQL}
     SELECT s.course_id, s.module_id, m.order_in_parent AS chapter_no, min(s.catalogue_rank)::int AS first_rank
       FROM scope s JOIN graph_nodes m ON m.id = s.module_id
      GROUP BY s.course_id, s.module_id, m.order_in_parent`
  );
  const out = new Map<string, { moduleId: string; catalogueRank: number }>();
  const twice = new Set<string>();
  for (const r of res.rows) {
    if (r.chapter_no == null) continue;
    const key = `${r.course_id}|${r.chapter_no}`;
    if (out.has(key)) twice.add(key);
    out.set(key, { moduleId: r.module_id, catalogueRank: Number(r.first_rank) });
  }
  for (const k of twice) out.delete(k);
  return out;
}

/* ------------------------------------------------------------- Samuel */

/**
 * Whose account signs gate decisions (answer 39: "assigned to Samuel … only an
 * operator whose account is Samuel's can approve/reject"). Configuration,
 * never a request field: `AINEXT_GATE_OWNER_EMAIL`, else the bootstrap
 * operator's address (`AINEXT_BOOTSTRAP_OPERATOR_EMAIL` — the first operator,
 * who is Samuel). Neither set: nobody may decide a gate item (fail closed).
 */
export function gateOwnerEmail(): string | null {
  const v = (process.env.AINEXT_GATE_OWNER_EMAIL ?? "").trim() || (BOOTSTRAP_OPERATOR_EMAIL ?? "").trim();
  return v ? v.toLowerCase() : null;
}

export async function isGateOwner(c: Db, operatorId: number, owner: string | null = gateOwnerEmail()): Promise<boolean> {
  if (!owner) return false;
  const res = await c.query(`SELECT lower(email) = $2 AS owner FROM operators WHERE id = $1 AND status = 'active'`, [
    operatorId,
    owner,
  ]);
  return res.rows[0]?.owner === true;
}

type DecisionRow = {
  id: string | number;
  item_kind: string;
  item_ref: string;
  decision: Decision;
  item_fingerprint: string;
  operator_name: string;
  decided_at: Date | string;
  note: string | null;
  suggested_correction: string | null;
};

const isoOf = (v: Date | string | null): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString();

const toLatest = (r: DecisionRow): LatestDecision => ({
  id: Number(r.id),
  decision: r.decision,
  fingerprint: r.item_fingerprint,
  operatorName: r.operator_name,
  decidedAt: isoOf(r.decided_at)!,
  note: r.note,
  suggestedCorrection: r.suggested_correction,
});

/** The newest decision per item, this environment only. */
export async function latestDecisions(
  c: Db,
  environment: string,
  only?: { kind: ItemKind; ref: string } | null
): Promise<Map<string, LatestDecision>> {
  const res = await c.query(
    `SELECT DISTINCT ON (item_kind, item_ref)
            id, item_kind, item_ref, decision, item_fingerprint, operator_name, decided_at,
            note, suggested_correction
       FROM review_decisions
      WHERE environment = $1 ${only ? "AND item_kind = $2 AND item_ref = $3" : ""}
      ORDER BY item_kind, item_ref, decided_at DESC, id DESC`,
    only ? [environment, only.kind, only.ref] : [environment]
  );
  return new Map((res.rows as DecisionRow[]).map((r) => [itemKey(r.item_kind, r.item_ref), toLatest(r)]));
}

/** Every item with its state — the backlog and everything already done. */
export async function loadBacklog(
  c: Db,
  environment: string,
  only?: { kind: ItemKind; ref: string } | null,
  gates?: () => Promise<GateRecordRow[]>
): Promise<ResolvedItem[]> {
  const derived = await deriveAll(c, only, gates);
  const latest = await latestDecisions(c, environment, only);
  return derived.map((d) => resolveItem(d, latest.get(itemKey(d.kind, d.ref))));
}

/* ------------------------------------------------------------- claims */

export interface ActiveClaim {
  kind: ItemKind;
  ref: string;
  operatorId: number;
  operatorName: string;
  expiresAt: string;
}

export async function activeClaims(c: Db, environment: string): Promise<ActiveClaim[]> {
  const res = await c.query(
    `SELECT rc.item_kind, rc.item_ref, rc.operator_id, o.display_name, rc.expires_at
       FROM review_claims rc JOIN operators o ON o.id = rc.operator_id
      WHERE rc.environment = $1 AND rc.expires_at > now()
      ORDER BY rc.claimed_at`,
    [environment]
  );
  return res.rows.map((r) => ({
    kind: r.item_kind as ItemKind,
    ref: r.item_ref as string,
    operatorId: Number(r.operator_id),
    operatorName: r.display_name as string,
    expiresAt: isoOf(r.expires_at)!,
  }));
}

/**
 * Take (or renew) this operator's claim on one item. Returns its expiry, or
 * null when somebody else holds it and their claim has not expired. Atomic:
 * two reviewers racing for one item serialise on the primary key, and the
 * loser's upsert finds an unexpired claim that is not theirs and writes
 * nothing. RLS (036) refuses the same thing again at the database.
 */
export async function claimItem(
  c: Db,
  environment: string,
  operatorId: number,
  kind: ItemKind,
  ref: string,
  minutes = CLAIM_MINUTES
): Promise<string | null> {
  const res = await c.query(
    `INSERT INTO review_claims (environment, item_kind, item_ref, operator_id, claimed_at, expires_at)
     VALUES ($1, $2, $3, $4, now(), now() + make_interval(mins => $5))
     ON CONFLICT (environment, item_kind, item_ref) DO UPDATE
        SET operator_id = EXCLUDED.operator_id, claimed_at = EXCLUDED.claimed_at,
            expires_at = EXCLUDED.expires_at
      WHERE review_claims.expires_at <= now() OR review_claims.operator_id = EXCLUDED.operator_id
     RETURNING expires_at`,
    [environment, kind, ref, operatorId, minutes]
  );
  return res.rows[0] ? isoOf(res.rows[0].expires_at) : null;
}

/** One item at a time: release every other claim this operator holds. */
export async function releaseOtherClaims(
  c: Db,
  environment: string,
  operatorId: number,
  keep: { kind: ItemKind; ref: string } | null
): Promise<void> {
  await c.query(
    `DELETE FROM review_claims
      WHERE environment = $1 AND operator_id = $2
        AND ($3::text IS NULL OR NOT (item_kind = $3 AND item_ref = $4))`,
    [environment, operatorId, keep?.kind ?? null, keep?.ref ?? null]
  );
}

/* ------------------------------------------------------------- payload */

const family = (note: string | null): string | null =>
  note?.match(/template family (\S+?)\.?(?:\s|$)/)?.[1] ?? null;

function misconceptionIdsIn(choices: unknown): string[] {
  const ids = new Set<string>();
  const visit = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const x of list) {
      if (x && typeof x === "object" && typeof (x as { misconception_id?: unknown }).misconception_id === "string") {
        ids.add((x as { misconception_id: string }).misconception_id);
      }
    }
  };
  if (Array.isArray(choices)) visit(choices);
  else if (choices && typeof choices === "object") {
    const o = choices as Record<string, unknown>;
    visit(o.options);
    visit(o.diagnostics);
    visit(o.pending_review);
  }
  return [...ids];
}

const figureOf = (r: Record<string, unknown>): FigurePayload => ({
  id: r.id as string,
  kind: r.kind as string,
  spec: (r.spec && typeof r.spec === "object" ? r.spec : {}) as Record<string, unknown>,
  caption: (r.caption as string | null) ?? null,
  sourcePage: (r.source_page as number | null) ?? null,
  standIn:
    r.kind === "book_image" &&
    !!r.spec &&
    typeof r.spec === "object" &&
    (r.spec as Record<string, unknown>).stand_in === true,
});

export async function questionPayload(c: Db, id: string): Promise<QuestionPayload | null> {
  const res = await c.query(
    `SELECT q.id, q.question_type, q.tier, q.stem, q.choices, q.correct_answer, q.canonical_solution,
            q.solution_version, q.status, q.source, q.source_page, q.source_note, q.parent_question_id,
            p.stem AS parent_stem, q.reviewed_by, q.reviewed_at, q.ai_checked_by, q.ai_checked_at,
            q.hold_reason, q.review_note
       FROM questions q LEFT JOIN questions p ON p.id = q.parent_question_id
      WHERE q.id = $1`,
    [id]
  );
  const r = res.rows[0];
  if (!r) return null;
  const figs = await c.query(
    `SELECT id, kind, spec, caption, source_page FROM visuals WHERE question_id = $1 ORDER BY id`,
    [id]
  );
  const mcIds = misconceptionIdsIn(r.choices);
  const mcs = mcIds.length
    ? await c.query(`SELECT id, label, description FROM misconceptions WHERE id = ANY($1)`, [mcIds])
    : { rows: [] as Record<string, unknown>[] };
  return {
    id: r.id,
    questionType: r.question_type,
    tier: r.tier,
    stem: r.stem,
    choices: r.choices,
    correctAnswer: r.correct_answer,
    solution: stepsOf(r.canonical_solution),
    solutionVersion: Number(r.solution_version ?? 1),
    status: r.status,
    source: r.source,
    sourcePage: r.source_page ?? null,
    sourceNote: r.source_note ?? null,
    parentId: r.parent_question_id ?? null,
    parentStem: r.parent_stem ?? null,
    family: family(r.source_note ?? null),
    reviewedBy: r.reviewed_by ?? null,
    reviewedAt: isoOf(r.reviewed_at),
    aiCheckedBy: r.ai_checked_by ?? null,
    aiCheckedAt: isoOf(r.ai_checked_at),
    holdReason: r.hold_reason ?? null,
    reviewNote: r.review_note ?? null,
    figures: figs.rows.map(figureOf),
    misconceptions: Object.fromEntries(
      mcs.rows.map((m) => [
        m.id as string,
        { id: m.id as string, label: m.label as string, description: m.description as string } satisfies MisconceptionBrief,
      ])
    ),
  };
}

async function labels(c: Db, ids: (string | null)[]): Promise<Map<string, { label: string; description: string | null }>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (want.length === 0) return new Map();
  const res = await c.query(`SELECT id, label, description FROM graph_nodes WHERE id = ANY($1)`, [want]);
  return new Map(res.rows.map((r) => [r.id as string, { label: r.label as string, description: (r.description as string | null) ?? null }]));
}

async function history(c: Db, environment: string, item: ResolvedItem): Promise<HistoryEntry[]> {
  const res = await c.query(
    `SELECT decision, item_fingerprint, operator_name, decided_at, note, suggested_correction
       FROM review_decisions
      WHERE environment = $1 AND item_kind = $2 AND item_ref = $3
      ORDER BY decided_at DESC, id DESC
      LIMIT 20`,
    [environment, item.kind, item.ref]
  );
  return res.rows.map((r) => ({
    decision: r.decision as Decision,
    operatorName: r.operator_name as string,
    decidedAt: isoOf(r.decided_at)!,
    note: (r.note as string | null) ?? null,
    suggestedCorrection: (r.suggested_correction as string | null) ?? null,
    current: r.item_fingerprint === item.fingerprint,
  }));
}

/** Everything the reviewer view renders for one item. */
export async function itemPayload(
  c: Db,
  environment: string,
  item: ResolvedItem,
  claimExpiresAt: string | null,
  opts: { readOnly?: boolean; gates?: () => Promise<GateRecordRow[]> } = {}
): Promise<ReviewItemPayload> {
  const names = await labels(c, [item.moduleId, item.loId]);
  const base: ReviewItemPayload = {
    kind: item.kind,
    ref: item.ref,
    fingerprint: item.fingerprint,
    state: item.state,
    reasons: item.reasons,
    courseId: item.courseId,
    courseLabel: courseName(item.courseId),
    moduleId: item.moduleId,
    moduleLabel: item.moduleId ? (names.get(item.moduleId)?.label ?? null) : null,
    loId: item.loId,
    loLabel: item.loId ? (names.get(item.loId)?.label ?? null) : null,
    createdAt: item.createdAt,
    claimExpiresAt,
    ...(item.assignee ? { assignee: item.assignee } : {}),
    ...(opts.readOnly ? { readOnly: true } : {}),
    history: await history(c, environment, item),
  };

  if (isQuestionKind(item.kind)) {
    base.question = (await questionPayload(c, item.ref)) ?? undefined;
    return base;
  }

  switch (item.kind) {
    case "mapping_claim": {
      const claim = parseClaimRef(item.ref)!;
      const q = await questionPayload(c, claim.questionId);
      base.question = q ?? undefined;
      const choices = (q?.choices ?? {}) as Record<string, unknown>;
      const held = Array.isArray(choices.pending_review) ? (choices.pending_review as Record<string, unknown>[]) : [];
      const entry = held.find((d) => d.predicate === claim.predicate && d.misconception_id === claim.misconceptionId);
      const mc = await c.query(`SELECT id, label, description, signal FROM misconceptions WHERE id = $1`, [
        claim.misconceptionId,
      ]);
      const ref = await c.query(
        `SELECT content FROM explanation_library
          WHERE misconception_id = $1 AND entry_type = 'refutation' ORDER BY id LIMIT 1`,
        [claim.misconceptionId]
      );
      base.claim = {
        questionId: claim.questionId,
        predicate: claim.predicate,
        misconceptionId: claim.misconceptionId,
        active: item.exposure === "active",
        why: (entry?.why as string | undefined) ?? null,
        verifierRuns: Array.isArray(entry?.verifier_runs) ? (entry!.verifier_runs as string[]) : [],
        misconception: mc.rows[0]
          ? {
              id: mc.rows[0].id,
              label: mc.rows[0].label,
              description: mc.rows[0].description,
              signal: mc.rows[0].signal ?? null,
            }
          : null,
        refutation: stepsOf(ref.rows[0]?.content),
      };
      return base;
    }
    case "misconception": {
      const mc = await c.query(
        `SELECT id, label, description, signal, generated_by FROM misconceptions WHERE id = $1`,
        [item.ref]
      );
      const refs = await c.query(
        `SELECT id, content, reviewed, reviewed_by FROM explanation_library
          WHERE misconception_id = $1 AND entry_type = 'refutation' ORDER BY id`,
        [item.ref]
      );
      const tagged = await c.query(
        `SELECT count(*)::int AS n FROM questions q
          WHERE q.status IN ('live', 'review') AND q.choices::text LIKE '%' || $1 || '%'`,
        [`"${item.ref}"`]
      );
      const m = mc.rows[0];
      if (m) {
        base.misconception = {
          id: m.id,
          label: m.label,
          description: m.description,
          signal: m.signal ?? null,
          generatedBy: m.generated_by,
          refutations: refs.rows.map((r) => ({
            id: r.id,
            steps: stepsOf(r.content),
            reviewed: r.reviewed === true,
            reviewedBy: r.reviewed_by ?? null,
          })),
          taggedQuestions: tagged.rows[0]?.n ?? 0,
        };
      }
      return base;
    }
    case "worked_example": {
      const res = await c.query(
        `SELECT id, entry_type, content, source_page, generated_by, misconception_id
           FROM explanation_library WHERE id = $1`,
        [item.ref]
      );
      const r = res.rows[0];
      if (r) {
        base.workedExample = {
          id: r.id,
          entryType: r.entry_type,
          steps: stepsOf(r.content),
          sourcePage: r.source_page ?? null,
          generatedBy: r.generated_by,
          misconceptionId: r.misconception_id ?? null,
        };
      }
      return base;
    }
    case "objective": {
      const res = await c.query(
        `SELECT lo.id, lo.label, lo.description, lo.syllabus_ref, lo.source_page,
                (SELECT count(*)::int FROM questions q WHERE q.lo_id = lo.id AND q.status = 'live') AS live_questions
           FROM graph_nodes lo WHERE lo.id = $1`,
        [item.ref]
      );
      const edges = await c.query(
        `SELECT e.src_id, e.dst_id, s.label AS src_label, d.label AS dst_label
           FROM graph_edges e
           JOIN graph_nodes s ON s.id = e.src_id
           JOIN graph_nodes d ON d.id = e.dst_id
          WHERE e.edge_type = 'prerequisite_of' AND e.system_to IS NULL
            AND (e.src_id = $1 OR e.dst_id = $1)
          ORDER BY e.src_id, e.dst_id`,
        [item.ref]
      );
      const r = res.rows[0];
      if (r) {
        base.objective = {
          id: r.id,
          label: r.label,
          description: r.description ?? null,
          syllabusRef: r.syllabus_ref ?? null,
          sourcePage: r.source_page ?? null,
          liveQuestions: r.live_questions ?? 0,
          prerequisites: edges.rows
            .filter((e) => e.dst_id === item.ref)
            .map((e) => ({ id: e.src_id as string, label: e.src_label as string })),
          dependents: edges.rows
            .filter((e) => e.src_id === item.ref)
            .map((e) => ({ id: e.dst_id as string, label: e.dst_label as string })),
        };
      }
      return base;
    }
    case "prerequisite_link": {
      const [src, dst] = item.ref.split(">");
      const nodes = await labels(c, [src ?? null, dst ?? null]);
      const e = await c.query(
        `SELECT rationale FROM graph_edges
          WHERE edge_type = 'prerequisite_of' AND system_to IS NULL AND src_id = $1 AND dst_id = $2
          ORDER BY system_from LIMIT 1`,
        [src, dst]
      );
      base.link = {
        src: { id: src!, label: nodes.get(src!)?.label ?? src!, description: nodes.get(src!)?.description ?? null },
        dst: { id: dst!, label: nodes.get(dst!)?.label ?? dst!, description: nodes.get(dst!)?.description ?? null },
        rationale: (e.rows[0]?.rationale as string | null) ?? null,
      };
      return base;
    }
    case "gate_decision": {
      const record = (await (opts.gates ?? readGateRecords)()).find((r) => r.ref === item.ref);
      if (record) {
        const { fingerprint: _fp, courseId: _course, ...rest } = record;
        void _fp;
        void _course;
        const course = isCourseId(record.courseId) ? COURSES[record.courseId] : null;
        const cov = course ? await coverageStatus(course.pipelineBook) : null;
        base.gate = {
          ...rest,
          coverage:
            cov && cov.state !== "none"
              ? { state: cov.state, file: cov.file, summary: cov.summary, failing: cov.failing }
              : null,
        };
      }
      return base;
    }
    case "figure_stand_in": {
      const res = await c.query(
        `SELECT id, kind, spec, caption, source_page, question_id FROM visuals WHERE id = $1`,
        [item.ref]
      );
      const r = res.rows[0];
      if (r) {
        base.figure = { ...figureOf(r), questionId: r.question_id ?? null };
        if (r.question_id) base.question = (await questionPayload(c, r.question_id)) ?? undefined;
      }
      return base;
    }
  }
  return base;
}

/** The content a decision is recorded against — the item-specific part of the payload. */
export function snapshotOf(p: ReviewItemPayload): Record<string, unknown> {
  const q = p.question
    ? {
        id: p.question.id,
        stem: p.question.stem,
        choices: p.question.choices,
        correctAnswer: p.question.correctAnswer,
        solution: p.question.solution,
        status: p.question.status,
        figures: p.question.figures.map((f) => ({ id: f.id, kind: f.kind, standIn: f.standIn })),
      }
    : undefined;
  switch (p.kind) {
    case "mapping_claim":
      return { claim: p.claim && { ...p.claim, refutation: undefined }, question: q && { id: q.id, stem: q.stem } };
    case "misconception":
      return { misconception: p.misconception };
    case "worked_example":
      return { workedExample: p.workedExample };
    case "objective":
      return { objective: p.objective };
    case "prerequisite_link":
      return { link: p.link };
    case "figure_stand_in":
      return { figure: p.figure, question: q && { id: q.id, stem: q.stem, status: q.status } };
    case "gate_decision":
      return {
        gate: p.gate && {
          ...p.gate,
          decisions: p.gate.decisions.slice(0, 300),
          decisionCount: p.gate.decisions.length,
        },
      };
    default:
      return { question: q };
  }
}

/* ------------------------------------------------------------- the queue */

export interface NextResult {
  item: ReviewItemPayload | null;
  /** open items matching the filters, this one included */
  openMatching: number;
  /** who else is reviewing right now */
  othersReviewing: { operatorName: string; kind: ItemKind; ref: string }[];
}

/**
 * Claim and return the next item for this operator: their own live claim
 * first, then the oldest open item that matches, that they did not skip and
 * that nobody else holds. Releases every other claim they held.
 */
export async function nextFor(
  c: Db,
  environment: string,
  operatorId: number,
  filters: BacklogFilters,
  skip: ReadonlySet<string>,
  gateSource: () => Promise<GateRecordRow[]> = readGateRecords
): Promise<NextResult> {
  const records = await gateSource();
  const gates = async () => records;
  const items = await loadBacklog(c, environment, null, gates);
  const claims = await activeClaims(c, environment);
  const owner = await isGateOwner(c, operatorId);
  const mine = claims.find((cl) => cl.operatorId === operatorId) ?? null;
  const others = claims.filter((cl) => cl.operatorId !== operatorId);
  const candidates = pickCandidates(items, filters, {
    mine,
    heldByOthers: new Set(others.map((cl) => itemKey(cl.kind, cl.ref))),
    skip,
    viewerIsOwner: owner,
  });
  const othersReviewing = others.map((cl) => ({ operatorName: cl.operatorName, kind: cl.kind, ref: cl.ref }));
  for (const cand of candidates.slice(0, 25)) {
    if (cand.assignee && !owner) {
      // Samuel's item, shown to another reviewer under "For Samuel": to read,
      // never to decide — and never claimed, so it is never kept from him.
      await releaseOtherClaims(c, environment, operatorId, null);
      return {
        item: await itemPayload(c, environment, cand, null, { readOnly: true, gates }),
        openMatching: candidates.length,
        othersReviewing,
      };
    }
    const expires = await claimItem(c, environment, operatorId, cand.kind, cand.ref);
    if (!expires) continue; // taken a moment ago by somebody else
    await releaseOtherClaims(c, environment, operatorId, cand);
    return {
      item: await itemPayload(c, environment, cand, expires, { gates }),
      openMatching: candidates.length,
      othersReviewing,
    };
  }
  await releaseOtherClaims(c, environment, operatorId, null);
  return { item: null, openMatching: candidates.length, othersReviewing };
}

/* ------------------------------------------------------------- deciding */

export interface DecideInput {
  kind: ItemKind;
  ref: string;
  fingerprint: string;
  decision: Decision;
  note?: string | null;
  suggestedCorrection?: string | null;
}

export type DecideResult =
  | { ok: true; decisionId: number; changes: Record<string, unknown> }
  | {
      ok: false;
      status: 400 | 403 | 404 | 409;
      error:
        | "invalid"
        | "note_required"
        | "not_allowed"
        | "owner_only"
        | "gone"
        | "changed"
        | "claimed_by_other"
        | "conflict";
      message: string;
    };

/** Shape-check a request body; the rules about kinds and decisions are `canDecide`'s. */
export function parseDecideInput(body: unknown): DecideInput | { error: string } {
  if (!body || typeof body !== "object") return { error: "body must be an object" };
  const b = body as Record<string, unknown>;
  if (!isItemKind(b.kind)) return { error: "kind is not a backlog item kind" };
  if (typeof b.ref !== "string" || b.ref.length < 1 || b.ref.length > 400) return { error: "ref is required" };
  if (typeof b.fingerprint !== "string" || !/^[0-9a-f]{32}$/.test(b.fingerprint)) {
    return { error: "fingerprint is required" };
  }
  if (!isDecision(b.decision)) return { error: "decision must be approve, fix_requested or reject" };
  const text = (v: unknown, max: number) =>
    typeof v === "string" && v.trim().length > 0 ? v.trim().slice(0, max) : null;
  return {
    kind: b.kind,
    ref: b.ref,
    fingerprint: b.fingerprint,
    decision: b.decision,
    note: text(b.note, MAX_NOTE),
    suggestedCorrection: text(b.suggestedCorrection, MAX_CORRECTION),
  };
}

/**
 * Record one decision and apply its effect, in the caller's transaction.
 *
 * Refuses — writing nothing — when another reviewer holds the item, when the
 * item is gone, when its content changed since the reviewer opened it (the
 * fingerprint they send is what they saw), when a fix or a rejection carries
 * no note, and when the kind does not admit the decision (`canDecide`).
 *
 * EFFECTS, each recorded in `changes` exactly as written:
 *   question approve   reviewed_by = the operator's display name, reviewed_at =
 *                      now(); a question at 'review' with NO hold reason (loaded
 *                      for review before answer 37a) goes live — a safety hold
 *                      is the pipeline's to clear, never a reviewer's
 *   question reject    status 'retired' (students stop seeing it)
 *   claim approve      a held claim moves into `diagnostics` (active)
 *   claim reject       an active claim leaves `diagnostics` (inactive)
 *   misconception approve  its refutation entries: reviewed, by, at
 *   worked example approve the entry: reviewed, by, at
 *   figure reject      its question goes to 'review' with hold_reason
 *                      'human_hold' (off students until it has a figure)
 *   anything else      recorded only (a gate decision, an objective, a link)
 *
 * A GATE DECISION is Samuel's alone (answer 39): anyone else's decision on one
 * is refused with `owner_only`, whatever role they hold.
 */
export async function decide(
  c: Db,
  environment: string,
  operatorId: number,
  input: DecideInput,
  gates: () => Promise<GateRecordRow[]> = readGateRecords
): Promise<DecideResult> {
  const allowed = canDecide(input.kind, input.decision);
  if (!allowed.ok) return { ok: false, status: 400, error: "not_allowed", message: allowed.why };
  if (input.decision !== "approve" && !input.note) {
    return { ok: false, status: 400, error: "note_required", message: "Say what is wrong — the note is what the fix is made from." };
  }

  // 1. The claim. Somebody else's live claim refuses; an expired one, or none, does not.
  // A plain read, never `FOR UPDATE`: row locking also applies 036's UPDATE
  // policy, which hides another operator's live claim from this operator —
  // the very row this check exists to see. (The content rows below are what
  // gets locked; the fingerprint check is what makes a late decision safe.)
  const claim = await c.query(
    `SELECT operator_id, expires_at > now() AS live FROM review_claims
      WHERE environment = $1 AND item_kind = $2 AND item_ref = $3`,
    [environment, input.kind, input.ref]
  );
  const holder = claim.rows[0];
  if (holder && Number(holder.operator_id) !== operatorId && holder.live === true) {
    return { ok: false, status: 409, error: "claimed_by_other", message: "Another reviewer has this item open." };
  }

  // 2. Lock what the effect writes, then re-derive the item from the locked rows.
  const claimParts = input.kind === "mapping_claim" ? parseClaimRef(input.ref) : null;
  const questionId = isQuestionKind(input.kind) ? input.ref : claimParts?.questionId ?? null;
  if (questionId) await c.query(`SELECT 1 FROM questions WHERE id = $1 FOR UPDATE`, [questionId]);
  if (input.kind === "figure_stand_in") {
    await c.query(
      `SELECT 1 FROM questions WHERE id = (SELECT question_id FROM visuals WHERE id = $1) FOR UPDATE`,
      [input.ref]
    );
  }
  const [item] = await loadBacklog(c, environment, { kind: input.kind, ref: input.ref }, gates);
  if (item?.assignee === "samuel" && !(await isGateOwner(c, operatorId))) {
    return {
      ok: false,
      status: 403,
      error: "owner_only",
      message: "A gate decision is Samuel's to sign (answer 39). You can read it; only his account decides it.",
    };
  }
  if (!item) {
    return { ok: false, status: 404, error: "gone", message: "This item is no longer in the backlog's scope (retired, or reloaded away)." };
  }
  if (item.fingerprint !== input.fingerprint) {
    return { ok: false, status: 409, error: "changed", message: "The item changed while you were reviewing it. Open it again." };
  }

  const payload = await itemPayload(c, environment, item, null, { gates });
  const who = await c.query(`SELECT display_name FROM operators WHERE id = $1`, [operatorId]);
  const operatorName = (who.rows[0]?.display_name as string | undefined)?.trim();
  if (!operatorName) return { ok: false, status: 400, error: "invalid", message: "operator not found" };

  // 3. The effect.
  const changes: Record<string, unknown> = {};
  if (isQuestionKind(item.kind) && input.decision !== "fix_requested") {
    const before = await c.query(
      `SELECT status, reviewed_by, reviewed_at, hold_reason FROM questions WHERE id = $1`,
      [item.ref]
    );
    const b = before.rows[0];
    if (input.decision === "approve") {
      const after = await c.query(
        `UPDATE questions
            SET reviewed_by = $2, reviewed_at = now(),
                status = CASE WHEN status = 'review' AND hold_reason IS NULL THEN 'live' ELSE status END
          WHERE id = $1
          RETURNING status, reviewed_by, reviewed_at`,
        [item.ref, operatorName]
      );
      const a = after.rows[0];
      changes.question = item.ref;
      changes.reviewed_by = { from: b.reviewed_by ?? null, to: a.reviewed_by };
      changes.reviewed_at = { from: isoOf(b.reviewed_at), to: isoOf(a.reviewed_at) };
      if (a.status !== b.status) changes.status = { from: b.status, to: a.status };
      else if (b.status === "review") changes.still_held = b.hold_reason;
    } else {
      await c.query(`UPDATE questions SET status = 'retired' WHERE id = $1`, [item.ref]);
      changes.question = item.ref;
      changes.status = { from: b.status, to: "retired" };
    }
  } else if (item.kind === "mapping_claim" && input.decision !== "fix_requested") {
    const q = await c.query(`SELECT choices FROM questions WHERE id = $1`, [claimParts!.questionId]);
    const plan =
      input.decision === "approve"
        ? planClaimApprove(q.rows[0]?.choices, claimParts!.predicate, claimParts!.misconceptionId)
        : planClaimReject(q.rows[0]?.choices, claimParts!.predicate, claimParts!.misconceptionId);
    if (!plan.ok) {
      return { ok: false, status: plan.error === "conflict" ? 409 : 404, error: plan.error === "conflict" ? "conflict" : "gone", message: plan.message };
    }
    if (plan.changed) {
      await c.query(`UPDATE questions SET choices = $2 WHERE id = $1`, [claimParts!.questionId, JSON.stringify(plan.choices)]);
    }
    changes.question = claimParts!.questionId;
    changes.claim = plan.change;
  } else if (item.kind === "misconception" && input.decision === "approve") {
    const res = await c.query(
      `UPDATE explanation_library SET reviewed = true, reviewed_by = $2, reviewed_at = now()
        WHERE misconception_id = $1 AND entry_type = 'refutation' AND NOT reviewed
        RETURNING id`,
      [item.ref, operatorName]
    );
    changes.refutations_marked_reviewed = res.rows.map((r) => r.id);
  } else if (item.kind === "worked_example" && input.decision === "approve") {
    const res = await c.query(
      `UPDATE explanation_library SET reviewed = true, reviewed_by = $2, reviewed_at = now()
        WHERE id = $1 RETURNING id`,
      [item.ref, operatorName]
    );
    changes.marked_reviewed = res.rows.map((r) => r.id);
  } else if (item.kind === "figure_stand_in" && input.decision === "reject") {
    const res = await c.query(
      `UPDATE questions q SET status = 'review', hold_reason = 'human_hold'
         FROM visuals v
        WHERE v.id = $1 AND q.id = v.question_id AND q.status = 'live'
        RETURNING q.id`,
      [item.ref]
    );
    changes.held_questions = res.rows.map((r) => r.id);
    if (res.rows.length > 0) changes.status = { from: "live", to: "review", hold_reason: "human_hold" };
  }
  if (Object.keys(changes).length === 0) changes.recorded_only = true;

  // 4. The record, then let go of the item.
  const ins = await c.query(
    `INSERT INTO review_decisions
       (environment, item_kind, item_ref, course_id, module_id, lo_id, item_fingerprint, decision,
        note, suggested_correction, snapshot, changes, operator_id, operator_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id`,
    [
      environment,
      item.kind,
      item.ref,
      item.courseId,
      item.moduleId,
      item.loId,
      item.fingerprint,
      input.decision,
      input.note ?? null,
      input.suggestedCorrection ?? null,
      JSON.stringify(snapshotOf(payload)),
      JSON.stringify(changes),
      operatorId,
      operatorName,
    ]
  );
  await c.query(
    `DELETE FROM review_claims WHERE environment = $1 AND item_kind = $2 AND item_ref = $3 AND operator_id = $4`,
    [environment, item.kind, item.ref, operatorId]
  );
  return { ok: true, decisionId: Number(ins.rows[0].id), changes };
}

/* -------------------------------------------------------------- overview */

export interface ReviewerRow {
  operatorId: number;
  name: string;
  today: { approve: number; fix_requested: number; reject: number };
  total: number;
}

export interface RecentDecision {
  id: number;
  kind: ItemKind;
  ref: string;
  decision: Decision;
  operatorName: string;
  decidedAt: string;
  note: string | null;
}

/** The start of today in Cairo — the pilot's day, whatever the server's zone. */
const TODAY_CAIRO = `(date_trunc('day', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo')`;

export async function reviewerStats(c: Db, environment: string): Promise<{ reviewers: ReviewerRow[]; today: RecentDecision[] }> {
  const res = await c.query(
    `SELECT d.operator_id, o.display_name,
            count(*) FILTER (WHERE d.decided_at >= ${TODAY_CAIRO} AND d.decision = 'approve')::int       AS t_approve,
            count(*) FILTER (WHERE d.decided_at >= ${TODAY_CAIRO} AND d.decision = 'fix_requested')::int AS t_fix,
            count(*) FILTER (WHERE d.decided_at >= ${TODAY_CAIRO} AND d.decision = 'reject')::int        AS t_reject,
            count(*)::int AS total
       FROM review_decisions d JOIN operators o ON o.id = d.operator_id
      WHERE d.environment = $1
      GROUP BY d.operator_id, o.display_name
      ORDER BY (count(*) FILTER (WHERE d.decided_at >= ${TODAY_CAIRO})) DESC, count(*) DESC, o.display_name`,
    [environment]
  );
  const recent = await c.query(
    `SELECT id, item_kind, item_ref, decision, operator_name, decided_at, note
       FROM review_decisions
      WHERE environment = $1 AND decided_at >= ${TODAY_CAIRO}
      ORDER BY decided_at DESC, id DESC
      LIMIT 30`,
    [environment]
  );
  return {
    reviewers: res.rows.map((r) => ({
      operatorId: Number(r.operator_id),
      name: r.display_name,
      today: { approve: r.t_approve, fix_requested: r.t_fix, reject: r.t_reject },
      total: r.total,
    })),
    today: recent.rows.map((r) => ({
      id: Number(r.id),
      kind: r.item_kind,
      ref: r.item_ref,
      decision: r.decision,
      operatorName: r.operator_name,
      decidedAt: isoOf(r.decided_at)!,
      note: r.note ?? null,
    })),
  };
}

/** The fix list: open fix requests, and rejections only the pipeline can act on. */
export async function fixList(c: Db, environment: string, items?: ResolvedItem[]): Promise<FixRequestEntry[]> {
  const all = items ?? (await loadBacklog(c, environment));
  const listed = all
    .map((i) => ({ i, action: onFixList(i) }))
    .filter((x): x is { i: ResolvedItem; action: "fix" | "reject" } => x.action !== null && x.i.latest !== null);
  const ids = listed.map((x) => x.i.latest!.id);
  const snaps = ids.length
    ? await c.query(`SELECT id, snapshot FROM review_decisions WHERE id = ANY($1)`, [ids])
    : { rows: [] as { id: string; snapshot: unknown }[] };
  const snapshot = new Map(snaps.rows.map((r) => [Number(r.id), r.snapshot]));
  return listed
    .map(({ i, action }) => ({
      action,
      kind: i.kind,
      ref: i.ref,
      courseId: i.courseId,
      moduleId: i.moduleId,
      loId: i.loId,
      fingerprint: i.fingerprint,
      note: i.latest!.note,
      suggestedCorrection: i.latest!.suggestedCorrection,
      requestedBy: i.latest!.operatorName,
      requestedAt: i.latest!.decidedAt,
      decisionId: i.latest!.id,
      snapshot: snapshot.get(i.latest!.id) ?? null,
    }))
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
}

export interface FilterOptions {
  courses: { id: string; label: string }[];
  modules: { id: string; label: string; courseId: string }[];
}

export interface ForSamuelRow {
  ref: string;
  state: ResolvedItem["state"];
  gate: string;
  chapter: number | null;
  run: string | null;
  summary: string;
  by: string;
  decidedAt: string;
  outcome: string;
}

export interface ReviewOverview {
  environment: string;
  /** is the viewer the account gate decisions belong to (answer 39)? */
  viewerIsOwner: boolean;
  /** is that account configured at all? */
  gateOwnerConfigured: boolean;
  /** every gate decision, open ones first */
  forSamuel: ForSamuelRow[];
  summary: BacklogSummary;
  /** open items matching the page's filters */
  openMatching: number;
  filters: BacklogFilters;
  options: FilterOptions;
  moduleLabels: Record<string, string>;
  reviewers: ReviewerRow[];
  today: RecentDecision[];
  fixes: FixRequestEntry[];
  reviewingNow: { operatorName: string; kind: ItemKind; ref: string; expiresAt: string }[];
}

export async function overview(
  c: Db,
  environment: string,
  filters: BacklogFilters,
  operatorId: number,
  gateSource: () => Promise<GateRecordRow[]> = readGateRecords
): Promise<ReviewOverview> {
  const records = await gateSource();
  const items = await loadBacklog(c, environment, null, async () => records);
  const owner = await isGateOwner(c, operatorId);
  const recordByRef = new Map(records.map((r) => [r.ref, r]));
  const forSamuel: ForSamuelRow[] = items
    .filter((i) => i.assignee === "samuel" && recordByRef.has(i.ref))
    .map((i) => {
      const r = recordByRef.get(i.ref)!;
      return {
        ref: i.ref,
        state: i.state,
        gate: r.gate,
        chapter: r.chapter,
        run: r.run,
        summary: r.summary,
        by: r.by,
        decidedAt: r.decidedAt,
        outcome: r.outcome,
      };
    })
    .sort(
      (a, b) =>
        Number(b.state === "open" || b.state === "fix_requested") - Number(a.state === "open" || a.state === "fix_requested") ||
        a.decidedAt.localeCompare(b.decidedAt)
    );
  const summary = summarize(items);
  const moduleIds = [...new Set(items.map((i) => i.moduleId).filter((m): m is string => !!m))];
  const names = await labels(c, moduleIds);
  const moduleCourse = new Map<string, string>();
  for (const i of items) if (i.moduleId) moduleCourse.set(i.moduleId, i.courseId);
  const stats = await reviewerStats(c, environment);
  const claims = await activeClaims(c, environment);
  const courses = [...new Set(items.map((i) => i.courseId))].sort();
  return {
    environment,
    viewerIsOwner: owner,
    gateOwnerConfigured: gateOwnerEmail() !== null,
    forSamuel,
    summary,
    openMatching: pickCandidates(items, filters, { heldByOthers: new Set(), viewerIsOwner: owner }).length,
    filters,
    options: {
      courses: courses.map((id) => ({ id, label: courseName(id) })),
      modules: summary.byCourse.flatMap((c) =>
        c.modules
          .filter((m) => m.moduleId)
          .map((m) => ({ id: m.moduleId!, label: names.get(m.moduleId!)?.label ?? m.moduleId!, courseId: c.courseId }))
      ),
    },
    moduleLabels: Object.fromEntries(moduleIds.map((id) => [id, names.get(id)?.label ?? id])),
    reviewers: stats.reviewers,
    today: stats.today,
    fixes: (await fixList(c, environment, items)).map((f) => ({ ...f, snapshot: null })),
    reviewingNow: claims.map((cl) => ({ operatorName: cl.operatorName, kind: cl.kind, ref: cl.ref, expiresAt: cl.expiresAt })),
  };
}

/* ------------------------------------------------- the console's entry points */

export const getReviewOverview = (operatorId: number, filters: BacklogFilters) =>
  withOperator(operatorId, (c) => overview(c, ENVIRONMENT, filters, operatorId));

export const nextItemFor = (operatorId: number, filters: BacklogFilters, skip: ReadonlySet<string>) =>
  withOperator(operatorId, (c) => nextFor(c, ENVIRONMENT, operatorId, filters, skip));

/**
 * Decide, in one transaction that commits only when the decision was
 * recorded. A refusal returns from inside `withOperator`, which would COMMIT —
 * harmless here because a refusal is returned before anything is written (the
 * row locks it took are released either way).
 */
export const decideAs = (operatorId: number, input: DecideInput) =>
  withOperator(operatorId, (c) => decide(c, ENVIRONMENT, operatorId, input));

export const exportFixRequests = (operatorId: number) =>
  withOperator(operatorId, (c) => fixList(c, ENVIRONMENT));
