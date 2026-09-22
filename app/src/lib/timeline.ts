/**
 * The interaction timeline — **a read model, not a table** (ADR-0015 §2,
 * contracts/admin.md §4, FR-2303).
 *
 * Seven sources, one time order, nothing copied. The sources stay
 * authoritative: there is no `timeline` table, no materialised view and no
 * denormalised mirror to fall out of date. What this module does is fetch each
 * source for one session, shape each row into a typed item, and hand the whole
 * set to `lib/timeline-rules.ts`, which owns every decision about order, gaps
 * and reachability and is tested without a database.
 *
 * **Everything is scoped by `(student_id, session_id, environment)`** — the
 * student because these reads run as `ainext_operator`, whose policies are
 * `USING (true)` and whose safety is therefore the query's job rather than the
 * database's; the session because a timeline is per session by definition; the
 * environment because constitution XI forbids pooling across the baseline and
 * the comparison build, and a transcript blended from two stacks would be a
 * conversation that never happened.
 *
 * **Seven round trips, deliberately.** They could be one query with six
 * `UNION ALL` branches over a common column list, and that query would be
 * unreadable and would cast six different row shapes into one. At n ≤ 200
 * students and tens of rows per session the cost is noise; the cost of a merge
 * nobody can read is not. All seven run inside ONE `withOperator` transaction,
 * so they see one snapshot and the audit row commits with them or not at all —
 * and, because they share that transaction's one `PoolClient`, they run
 * `sequential`ly rather than via `Promise.all`: pg queues same-client queries
 * for you today, but pg@9 turns that into a hard "client already executing a
 * query" error, so this module stops relying on the queuing being implicit.
 *
 * **`outcome` is read without being required to exist.** data-model §12 adds
 * four columns to `ai_interactions`; migration 020 adds only
 * `renderer_version`, because `outcome`, `price_basis` and `priced_at` belong
 * to the cost ledger and its phase. `to_jsonb(ai.*)->>'outcome'` returns NULL
 * when the column is absent and its value when it is there, so this module
 * works either side of that migration instead of being a reason the two have to
 * land together. It costs one row-to-jsonb per turn, on a set already narrowed
 * to one session.
 */

import { sequential, withOperator } from "@/lib/db";
import { ENVIRONMENT } from "@/lib/env";
import {
  buildTimeline,
  sessionWallClockMs,
  type AttemptItem,
  type ExplanationItem,
  type MasteryItem,
  type SourceItem,
  type TimelineBuild,
  type TurnItem,
  type UnderstandingItem,
  type UploadItem,
} from "@/lib/timeline-rules";

export * from "@/lib/timeline-rules";

/** The narrow client shape `withOperator` hands a callback. */
type Db = {
  query: (
    text: string,
    values?: readonly unknown[]
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
};

/** One sitting, as the session list and both transcript views head it. */
export type SessionHeader = {
  id: number;
  studentId: number;
  studentName: string;
  kind: string;
  surface: string | null;
  loId: string | null;
  loLabel: string | null;
  openedAt: string;
  closedAt: string | null;
  /** `completed | inactivity | superseded | abandoned`, or null while open. */
  closeReason: string | null;
  /** Wall-clock milliseconds, or null while the session is still open. */
  wallClockMs: number | null;
};

export type SessionTimeline = {
  session: SessionHeader;
  build: TimelineBuild;
  /** Summed `attempts.time_ms` — the OTHER time-on-task number (admin.md §2). */
  attemptTimeMs: number;
  environment: string;
};

const iso = (v: unknown): string => new Date(v as string).toISOString();
const isoOrNull = (v: unknown): string | null => (v == null ? null : iso(v));
const num = (v: unknown, fallback = 0): number => (v == null ? fallback : Number(v));
const str = (v: unknown): string => String(v ?? "");
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));

/** JSONB arrays of strings (`strengths`, `gaps`) arrive as parsed values. */
function stringList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  return [];
}

/**
 * One session's timeline, with the audit row written in the same transaction.
 *
 * `onRead` is the caller's `recordOperatorRead` — the timeline page passes
 * `surface='session_timeline'`, the replay page `'session_replay'`, and the
 * callback runs only AFTER the session row comes back, so no audit row is
 * written for a session that does not exist or is not this student's
 * (FR-2306: the record says what was read, and nothing was).
 *
 * Returns `null` when the session is not this student's, not in this
 * environment, or not there at all. The page answers 404 — it does not
 * distinguish the three, because telling an operator which of them is true
 * about a student they may not open is the distinction itself leaking.
 */
export async function getSessionTimeline(
  operatorId: number,
  studentId: number,
  sessionId: number,
  onRead: (db: Db) => Promise<void>
): Promise<SessionTimeline | null> {
  return withOperator(operatorId, async (db) => {
    const header = await loadSessionHeader(db, studentId, sessionId);
    if (!header) return null;

    // The window a mastery movement has to fall inside to belong to this
    // sitting. An OPEN session ends at `now()`: a movement that happened five
    // seconds ago belongs to the session the student is still in.
    const windowEnd = header.closedAt ?? new Date().toISOString();

    const [turns, attempts, checks, uploads, masteryMoves] = await sequential([
      () => loadTurns(db, studentId, sessionId),
      () => loadAttempts(db, studentId, sessionId),
      () => loadChecks(db, studentId, sessionId),
      () => loadUploads(db, studentId, sessionId),
      () => loadMastery(db, studentId, header.openedAt, windowEnd),
    ] as const);

    // explanation_log has no student_id and only a nullable attempt_id
    // (ADR-0015 Consequences), so the ONLY way in is the set of attempt ids
    // this session already produced. With no attempts there is nothing to ask
    // for — and asking with an empty array would return every explanation
    // whose attempt_id is NULL, i.e. other students' or nobody's.
    const attemptIds = attempts.map((a) => a.attemptId);
    const explanations = attemptIds.length ? await loadExplanations(db, attemptIds) : [];

    const items: SourceItem[] = [
      ...turns,
      ...attempts,
      ...checks,
      ...uploads,
      ...masteryMoves,
      ...explanations,
    ];

    // Same transaction as the read it records (FR-2306). A commit carrying the
    // transcript but not the audit row is the hole the requirement closes.
    await onRead(db);

    return {
      session: header,
      build: buildTimeline(items),
      attemptTimeMs: attempts.reduce((sum, a) => sum + (a.timeMs ?? 0), 0),
      environment: ENVIRONMENT,
    };
  });
}

/* ------------------------------------------------------------------ header */

async function loadSessionHeader(
  db: Db,
  studentId: number,
  sessionId: number
): Promise<SessionHeader | null> {
  const res = await db.query(
    `SELECT s.id, s.student_id, s.kind, s.surface, s.lo_id,
            s.opened_at, s.closed_at, s.close_reason,
            st.display_name,
            n.label AS lo_label
       FROM sessions s
       JOIN students st ON st.id = s.student_id
       LEFT JOIN graph_nodes n ON n.id = s.lo_id
      WHERE s.id = $1 AND s.student_id = $2 AND s.environment = $3`,
    [sessionId, studentId, ENVIRONMENT]
  );
  const r = res.rows[0];
  if (!r) return null;
  const openedAt = iso(r.opened_at);
  const closedAt = isoOrNull(r.closed_at);
  return {
    id: num(r.id),
    studentId: num(r.student_id),
    studentName: str(r.display_name),
    kind: str(r.kind),
    surface: strOrNull(r.surface),
    loId: strOrNull(r.lo_id),
    loLabel: strOrNull(r.lo_label),
    openedAt,
    closedAt,
    closeReason: strOrNull(r.close_reason),
    wallClockMs: sessionWallClockMs(openedAt, closedAt),
  };
}

/* ------------------------------------------------------------------- turns */

async function loadTurns(db: Db, studentId: number, sessionId: number): Promise<TurnItem[]> {
  const res = await db.query(
    `SELECT ai.id, ai.surface, ai.surface_kind, ai.turn_index,
            ai.user_message, ai.assistant_message, ai.citations, ai.model,
            ai.input_tokens, ai.output_tokens,
            ai.cache_read_tokens, ai.cache_creation_tokens,
            ai.cost_usd, ai.latency_ms, ai.created_at, ai.renderer_version,
            -- Reads the ledger's outcome if the cost phase has added it and
            -- NULL if it has not. See this module's header.
            to_jsonb(ai.*)->>'outcome' AS outcome
       FROM ai_interactions ai
      WHERE ai.student_id = $1 AND ai.session_id = $2 AND ai.environment = $3
      ORDER BY ai.created_at ASC, ai.id ASC`,
    [studentId, sessionId, ENVIRONMENT]
  );
  return res.rows.map((r) => ({
    kind: "turn" as const,
    key: `turn:${num(r.id)}`,
    at: iso(r.created_at),
    interactionId: num(r.id),
    surface: str(r.surface),
    surfaceKind: strOrNull(r.surface_kind),
    turnIndex: num(r.turn_index),
    userMessage: str(r.user_message),
    assistantMessage: str(r.assistant_message),
    citations: Array.isArray(r.citations) ? (r.citations as unknown[]) : [],
    model: str(r.model),
    inputTokens: num(r.input_tokens),
    outputTokens: num(r.output_tokens),
    cacheReadTokens: num(r.cache_read_tokens),
    cacheCreationTokens: num(r.cache_creation_tokens),
    costUsd: num(r.cost_usd),
    latencyMs: r.latency_ms == null ? null : num(r.latency_ms),
    // 'ok' is the DEFAULT data-model §12 gives the column, so a pre-migration
    // row reads as what it will become rather than as unknown.
    outcome: strOrNull(r.outcome) ?? "ok",
    rendererVersion: strOrNull(r.renderer_version),
  }));
}

/* ---------------------------------------------------- attempts and widgets */

async function loadAttempts(
  db: Db,
  studentId: number,
  sessionId: number
): Promise<AttemptItem[]> {
  const res = await db.query(
    `SELECT a.id, a.question_id, a.given_answer, a.is_correct, a.time_ms,
            a.attempted_at, a.modality, a.misconception_id,
            q.stem, q.question_type, q.choices, q.correct_answer, q.lo_id,
            n.label  AS lo_label,
            mc.label AS misconception_label
       FROM attempts a
       LEFT JOIN questions q       ON q.id  = a.question_id
       LEFT JOIN graph_nodes n     ON n.id  = q.lo_id
       LEFT JOIN misconceptions mc ON mc.id = a.misconception_id
      WHERE a.student_id = $1 AND a.session_id = $2 AND a.environment = $3
      ORDER BY a.attempted_at ASC, a.id ASC`,
    [studentId, sessionId, ENVIRONMENT]
  );
  return res.rows.map((r) => {
    const modality = str(r.modality) || "question";
    const isWidget = modality === "widget";
    return {
      // A widget outcome and an answer are the same row in the same table
      // (ADR-0009). They differ here only by `kind`, so admin.md §4 can list
      // them as two lines while the merge keeps them as one source.
      kind: (isWidget ? "widget" : "attempt") as AttemptItem["kind"],
      key: `${isWidget ? "widget" : "attempt"}:${num(r.id)}`,
      at: iso(r.attempted_at),
      attemptId: num(r.id),
      questionId: str(r.question_id),
      questionStem: strOrNull(r.stem),
      questionType: strOrNull(r.question_type),
      // `questions.choices` holds two shapes: lettered options for an MCQ and
      // `{kind, spec, diagnostics}` for a widget (ADR-0009, lib/types.ts).
      // Only the second is a construction, and only it is carried here.
      widgetSpec:
        r.choices != null && !Array.isArray(r.choices) ? (r.choices as unknown) : null,
      loId: strOrNull(r.lo_id),
      loLabel: strOrNull(r.lo_label),
      givenAnswer: strOrNull(r.given_answer),
      correctAnswer: strOrNull(r.correct_answer),
      isCorrect: Boolean(r.is_correct),
      timeMs: r.time_ms == null ? null : num(r.time_ms),
      modality,
      misconceptionId: strOrNull(r.misconception_id),
      misconceptionLabel: strOrNull(r.misconception_label),
    };
  });
}

/* ------------------------------------------------------ understanding checks */

async function loadChecks(
  db: Db,
  studentId: number,
  sessionId: number
): Promise<UnderstandingItem[]> {
  const res = await db.query(
    `SELECT u.id, u.lo_id, u.mode, u.score, u.verdict, u.strengths, u.gaps,
            u.next_step, u.turns, u.created_at, n.label AS lo_label
       FROM understanding_checks u
       LEFT JOIN graph_nodes n ON n.id = u.lo_id
      WHERE u.student_id = $1 AND u.session_id = $2 AND u.environment = $3
      ORDER BY u.created_at ASC, u.id ASC`,
    [studentId, sessionId, ENVIRONMENT]
  );
  return res.rows.map((r) => ({
    kind: "understanding" as const,
    key: `understanding:${num(r.id)}`,
    at: iso(r.created_at),
    checkId: num(r.id),
    loId: str(r.lo_id),
    loLabel: strOrNull(r.lo_label),
    mode: str(r.mode),
    score: num(r.score),
    verdict: str(r.verdict),
    strengths: stringList(r.strengths),
    gaps: stringList(r.gaps),
    nextStep: strOrNull(r.next_step),
    turns: num(r.turns),
  }));
}

/* ----------------------------------------------------------------- uploads */

async function loadUploads(
  db: Db,
  studentId: number,
  sessionId: number
): Promise<UploadItem[]> {
  const res = await db.query(
    // `session_ref` is the BIGINT key; `uploads.session_id` is the legacy
    // client TEXT string and must never be joined to `sessions.id`
    // (data-model §2 — the types disagree and matches would be coincidences).
    `SELECT u.id, u.file_type, u.storage_path, u.parse_status, u.parsed_text,
            u.linked_lo_id, u.created_at
       FROM uploads u
      WHERE u.student_id = $1 AND u.session_ref = $2 AND u.environment = $3
      ORDER BY u.created_at ASC, u.id ASC`,
    [studentId, sessionId, ENVIRONMENT]
  );
  return res.rows.map((r) => ({
    kind: "upload" as const,
    key: `upload:${num(r.id)}`,
    at: iso(r.created_at),
    uploadId: num(r.id),
    fileType: str(r.file_type),
    storagePath: str(r.storage_path),
    parseStatus: str(r.parse_status),
    parsedText: strOrNull(r.parsed_text),
    linkedLoId: strOrNull(r.linked_lo_id),
  }));
}

/* ---------------------------------------------------------------- mastery */

async function loadMastery(
  db: Db,
  studentId: number,
  windowStart: string,
  windowEnd: string
): Promise<MasteryItem[]> {
  const res = await db.query(
    // The prior score is the student's PREVIOUS estimate for that objective,
    // which may well predate this session — so the window function runs over
    // every row the student has and the time filter is applied afterwards.
    // Filtering first would make the earliest movement in each session look
    // like the objective's first estimate ever.
    `WITH trajectory AS (
       SELECT m.id, m.lo_id, m.score, m.system_from, m.evidence,
              lag(m.score) OVER (PARTITION BY m.lo_id ORDER BY m.system_from, m.id) AS prior_score
         FROM mastery m
        WHERE m.student_id = $1 AND m.environment = $2
     )
     SELECT t.id, t.lo_id, t.score, t.prior_score, t.system_from, t.evidence,
            n.label AS lo_label
       FROM trajectory t
       LEFT JOIN graph_nodes n ON n.id = t.lo_id
      WHERE t.system_from >= $3 AND t.system_from <= $4
      ORDER BY t.system_from ASC, t.id ASC`,
    [studentId, ENVIRONMENT, windowStart, windowEnd]
  );
  return res.rows.map((r) => ({
    kind: "mastery" as const,
    key: `mastery:${num(r.id)}`,
    at: iso(r.system_from),
    masteryId: num(r.id),
    loId: str(r.lo_id),
    loLabel: strOrNull(r.lo_label),
    priorScore: r.prior_score == null ? null : num(r.prior_score),
    posteriorScore: num(r.score),
    evidence: r.evidence ?? null,
  }));
}

/* ----------------------------------------------------------- explanations */

async function loadExplanations(db: Db, attemptIds: number[]): Promise<ExplanationItem[]> {
  const res = await db.query(
    `SELECT e.id, e.attempt_id, e.question_id, e.model, e.prompt_version,
            e.grounded_ok, e.cached, e.created_at
       FROM explanation_log e
      WHERE e.attempt_id = ANY($1::bigint[]) AND e.environment = $2
      ORDER BY e.created_at ASC, e.id ASC`,
    [attemptIds, ENVIRONMENT]
  );
  return res.rows.map((r) => ({
    kind: "explanation" as const,
    key: `explanation:${num(r.id)}`,
    at: iso(r.created_at),
    explanationId: num(r.id),
    attemptId: num(r.attempt_id),
    questionId: str(r.question_id),
    model: str(r.model),
    promptVersion: str(r.prompt_version),
    groundedOk: Boolean(r.grounded_ok),
    cached: Boolean(r.cached),
  }));
}
