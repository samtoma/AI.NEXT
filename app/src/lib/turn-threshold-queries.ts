import { ENVIRONMENT } from "@/lib/env";
import {
  THRESHOLD_SURFACES,
  TURN_THRESHOLDS,
  sessionTurnLimit,
  type ConversationCount,
  type SessionTurnLimit,
  type SurfaceThresholdSummary,
  type ThresholdSurface,
} from "@/lib/turn-thresholds";

/**
 * How often conversations reach the per-surface reply thresholds — the
 * console's reads (ADR-0023, FR-3403…FR-3406).
 *
 * The thresholds are no longer enforced (FR-3401); this module is how the
 * console learns what enforcing them would have done. Three reads, one set of
 * definitions:
 *
 *  · `readTurnLimitsView` — the Cost page's panel and its list (FR-3403,
 *    FR-3404), over the page's own period, shaped by `costDetailAccess`;
 *  · `readSessionTurnLimits` — the chips on one student's sessions, and on one
 *    session's timeline and replay (FR-3405).
 *
 * ---------------------------------------------------------------------------
 * THE OLD CAP'S DEFINITIONS, WRITTEN ONCE (FR-3406)
 * ---------------------------------------------------------------------------
 * `CONVERSATION_KEY` and `DELIVERED` below are exactly what `api/ask` counted
 * before v0.9.0: a conversation is `(surface, grounding->>'chat_session',
 * student_id)`, and a reply is a row with `outcome = 'ok'`. Every query here
 * builds its count from those two fragments, so the panel, the list and the
 * chips cannot count three different things. A row without a `chat_session`
 * (none are written today) has no conversation and is left out, as the old
 * cap left it out.
 *
 * **Environment first, always** (constitution XI). Every read filters
 * `ai.environment = $1` before anything else, the way `cost-queries.ts` does;
 * a threshold rate pooled across the baseline and the comparison build would
 * be a plausible wrong number about a product nobody is running.
 *
 * **`withOperator`, never `withMaint`** — the caller's transaction. These are
 * cross-student reads by construction and run as `ainext_operator` under
 * migration 017's grants, like every other console query; the functions take
 * the caller's client rather than opening their own, so the Cost page's reads
 * and the timeline's audit row stay in the transactions they already have.
 *
 * **A conversation's count is its whole life.** A conversation belongs to a
 * period when any of its turns falls in it — the period ends today, so that is
 * the same as its LAST turn falling in it — and its reply count is the whole
 * conversation's, the number the old cap read. A session's chip reads the
 * count as it stood at the end of THAT session, so a conversation that ran on
 * into a second sitting shows how far it had got in each.
 *
 * **Student content: none.** Selected here are ids, a display name, a surface,
 * counts, timestamps, a lesson slug and curriculum labels. `chat_session` is
 * an opaque correlation id and is grouped by, never returned. No message and
 * no transcript is read.
 *
 * **A billing-only operator gets aggregates and nothing else** (FR-2406:
 * `cost-billing` never sees a turn count of a conversation). The Cost page's
 * role is `cost-billing`; anything that pairs a count with ONE conversation or
 * ONE student — the list of conversations that reached a threshold, and the
 * highest reply count, which is a single conversation's — is read only when
 * the operator ALSO holds `student-data` (`costDetailAccess`). Without it the
 * list's query is not run and `max(delivered)` is not selected, so the rows
 * never leave the database, rather than leaving it and being hidden.
 */

/** The narrow client shape `withOperator` hands a callback. */
type Db = {
  query: (
    text: string,
    values?: readonly unknown[]
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
};

/* ------------------------------------------------ the shared definitions */

const CHAT_SESSION = `ai.grounding->>'chat_session'`;

/** The old cap's conversation key (`api/ask`, before v0.9.0). */
export const CONVERSATION_KEY = `ai.surface, ${CHAT_SESSION}, ai.student_id`;

/** The old cap's delivered reply: the student received it. */
export const DELIVERED = `ai.outcome = 'ok'`;

/**
 * Replies delivered in this row's conversation up to and including this row.
 * `(created_at, id)` is a total order, so the running count is exact.
 */
export const RUNNING_DELIVERED =
  `count(*) FILTER (WHERE ${DELIVERED}) OVER (` +
  `PARTITION BY ${CONVERSATION_KEY} ORDER BY ai.created_at, ai.id)`;

/** Rows that belong to a conversation on a threshold surface ($n = the surfaces). */
const IN_A_CONVERSATION = (surfacesParam: string) =>
  `ai.surface = ANY(${surfacesParam}::text[]) AND ${CHAT_SESSION} IS NOT NULL AND ai.student_id IS NOT NULL`;

/** One UTC day — `cost-queries.ts`'s boundary, so the panel's period is the page's period. */
const UTC_DAY = `(ai.created_at AT TIME ZONE 'UTC')::date`;
const TODAY_UTC = `(now() AT TIME ZONE 'UTC')::date`;

/**
 * Every turn on a threshold surface in this environment, each with its
 * conversation's running reply count. $1 environment, $3 surfaces.
 */
const TURNS_CTE = `
  turns AS (
    SELECT ai.id, ai.student_id, ai.surface, ${CHAT_SESSION} AS chat_session,
           ai.session_id, ai.created_at, ai.outcome,
           ai.grounding->>'lesson'     AS lesson,
           ai.grounding->'lo_ids'->>0  AS lo_id,
           ${UTC_DAY}                  AS day,
           ${RUNNING_DELIVERED}        AS delivered_so_far
      FROM ai_interactions ai
     WHERE ai.environment = $1 AND ${IN_A_CONVERSATION("$3")}
  )`;

/** Conversations with at least one turn in the last $2 whole UTC days. */
const IN_PERIOD = `max(t.day) > ${TODAY_UTC} - $2::int`;

/** The threshold surfaces and their thresholds, $3 and $4, as a relation. */
const TH_CTE = `th AS (SELECT * FROM unnest($3::text[], $4::int[]) AS x(surface, threshold))`;

/**
 * Q1 — per threshold surface: conversations in the period, how many reached
 * the threshold, how many went past it — one row per surface, a surface with
 * no conversation included as zeros. The comparisons are `thresholdStatus`'s
 * (`>=` reached, `>` past).
 *
 * `withHighest` adds the most replies in one conversation. It is a single
 * conversation's turn count, so it is selected only for an operator who holds
 * `student-data` (FR-2406); without it the column does not exist in the
 * result at all.
 */
export const SURFACE_SUMMARY_SQL = (withHighest: boolean) => `
  WITH ${TH_CTE},
  ${TURNS_CTE},
  conversations AS (
    SELECT t.surface, count(*) FILTER (WHERE t.outcome = 'ok') AS delivered
      FROM turns t
     GROUP BY t.student_id, t.surface, t.chat_session
    HAVING ${IN_PERIOD}
  )
  SELECT th.surface, th.threshold,
         count(c.surface)                                  AS conversations,
         count(*) FILTER (WHERE c.delivered >= th.threshold) AS reached,
         count(*) FILTER (WHERE c.delivered >  th.threshold) AS past${
           withHighest ? `,
         coalesce(max(c.delivered), 0)                     AS highest` : ""
         }
    FROM th
    LEFT JOIN conversations c ON c.surface = th.surface
   GROUP BY th.surface, th.threshold`;

/**
 * Q2 — the most recent conversations that reached their threshold, newest
 * first by WHEN they reached it (the timestamp of the threshold-th reply).
 * $4 thresholds (aligned with $3), $5 the row limit.
 *
 * The session linked is the one the threshold was reached in, falling back to
 * the conversation's latest session when that reply was written without one.
 * The label is curriculum: the lesson slug the grounding recorded and the
 * first objective it was grounded on, with that objective's course.
 */
export const RECENT_SQL = `
  WITH ${TH_CTE},
  ${TURNS_CTE},
  conversations AS (
    SELECT t.student_id, t.surface, th.threshold,
           max(t.delivered_so_far) AS delivered,
           min(t.created_at) FILTER (WHERE t.outcome = 'ok' AND t.delivered_so_far = th.threshold) AS reached_at,
           min(t.session_id) FILTER (WHERE t.outcome = 'ok' AND t.delivered_so_far = th.threshold) AS reached_session_id,
           max(t.session_id) AS last_session_id,
           max(t.created_at) AS last_at,
           max(t.lesson)     AS lesson,
           min(t.lo_id)      AS lo_id
      FROM turns t
      JOIN th ON th.surface = t.surface
     GROUP BY t.student_id, t.surface, t.chat_session, th.threshold
    HAVING ${IN_PERIOD}
  )
  SELECT c.student_id, st.display_name, c.surface, c.threshold, c.delivered,
         c.reached_at, c.last_at, c.lesson, c.lo_id,
         coalesce(c.reached_session_id, c.last_session_id) AS session_id,
         lo.label AS lo_label,
         (SELECT co.id
            FROM graph_edges e
            JOIN graph_nodes m  ON m.id = e.src_id AND m.kind = 'module'
            JOIN graph_edges ec ON ec.src_id = m.id AND ec.edge_type = 'part_of' AND ec.system_to IS NULL
            JOIN graph_nodes co ON co.id = ec.dst_id AND co.kind = 'course'
           WHERE e.dst_id = c.lo_id AND e.edge_type = 'teaches' AND e.system_to IS NULL
           ORDER BY co.id LIMIT 1) AS course_id
    FROM conversations c
    LEFT JOIN students st   ON st.id = c.student_id
    LEFT JOIN graph_nodes lo ON lo.id = c.lo_id
   WHERE c.delivered >= c.threshold
   ORDER BY c.reached_at DESC, c.student_id
   LIMIT $5`;

/**
 * Q3 — one student's conversations, each counted as it stood at the end of
 * each session it touched. $1 environment, $2 student, $3 surfaces, and
 * optionally $4 one session.
 *
 * The session filter is applied OUTSIDE the running count on purpose: the
 * count must see the conversation's turns in every session, or a lesson that
 * carried on into a second sitting would restart at zero in it.
 */
export const SESSIONS_SQL = (oneSession: boolean) => `
  SELECT c.session_id, c.surface, max(c.delivered_so_far) AS delivered
    FROM (
      SELECT ai.session_id, ai.surface, ${CHAT_SESSION} AS chat_session,
             ${RUNNING_DELIVERED} AS delivered_so_far
        FROM ai_interactions ai
       WHERE ai.environment = $1 AND ai.student_id = $2 AND ${IN_A_CONVERSATION("$3")}
    ) c
   WHERE c.session_id IS NOT NULL${oneSession ? " AND c.session_id = $4" : ""}
   GROUP BY c.session_id, c.surface, c.chat_session`;

/* ----------------------------------------------------------------- types */

/** One conversation that reached its threshold, for the Cost page's list (FR-3404). */
export type ThresholdConversation = {
  studentId: number;
  displayName: string | null;
  surface: ThresholdSurface;
  threshold: number;
  delivered: number;
  /** When the threshold-th reply was delivered — when the old cap fired. */
  reachedAt: string;
  lastAt: string;
  /** The session it reached the threshold in; null when no session was recorded. */
  sessionId: number | null;
  lessonSlug: string | null;
  loId: string | null;
  loLabel: string | null;
  courseId: string | null;
};

/** The per-conversation part of the panel, read only with `student-data` (FR-2406). */
export type TurnLimitDetail = {
  recent: ThresholdConversation[];
  /** The list's cap, and whether it cut the list — said on the page when it did. */
  recentLimit: number;
  recentCapped: boolean;
};

export type TurnLimitsView = {
  /** Aggregates, for every operator the Cost page admits. */
  surfaces: SurfaceThresholdSummary[];
  /** `null` for an operator without `student-data`: not read, not passed. */
  detail: TurnLimitDetail | null;
};

/**
 * Which parts of the Cost page's threshold panels an operator may be sent.
 *
 * `studentDetail` — a conversation or a student beside a turn or upload count
 * — needs `student-data` AS WELL AS `cost-billing` (FR-2406, FR-3404,
 * FR-3409). Both are asked for here, not just the one the Cost page does not
 * already require, so the rule reads the same wherever it is called from.
 */
export type CostDetailAccess = { studentDetail: boolean };

export function costDetailAccess(roles: readonly string[]): CostDetailAccess {
  return { studentDetail: roles.includes("cost-billing") && roles.includes("student-data") };
}

/** How many reached conversations the Cost page lists. */
export const RECENT_LIMIT = 50;

const num = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};
const strOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;
const iso = (v: unknown): string => new Date(v as string).toISOString();

/** The surfaces and thresholds as the two aligned arrays the SQL unnests. */
export function thresholdParams(): { surfaces: string[]; thresholds: number[] } {
  return {
    surfaces: [...THRESHOLD_SURFACES],
    thresholds: THRESHOLD_SURFACES.map((s) => TURN_THRESHOLDS[s]),
  };
}

/* ------------------------------------------------------------- the reads */

/**
 * The Cost page's panel and list, over the last `periodDays` whole UTC days in
 * this environment, on the caller's client, one query after the other (a
 * shared client never runs two at once — `lib/db.ts`).
 *
 * Without `access.studentDetail` this is ONE query, the aggregates without
 * the highest count, and `detail` is `null`: the per-conversation list is not
 * queried at all (FR-2406).
 */
export async function readTurnLimitsView(
  db: Db,
  periodDays: number,
  access: CostDetailAccess
): Promise<TurnLimitsView> {
  const { surfaces, thresholds } = thresholdParams();
  const period = String(periodDays);
  const withDetail = access.studentDetail === true;
  const summary = await db.query(SURFACE_SUMMARY_SQL(withDetail), [
    ENVIRONMENT,
    period,
    surfaces,
    thresholds,
  ]);
  const bySurface = new Map(summary.rows.map((r) => [String(r.surface), r]));
  const rows: SurfaceThresholdSummary[] = THRESHOLD_SURFACES.map((surface) => {
    const r = bySurface.get(surface);
    return {
      surface,
      threshold: TURN_THRESHOLDS[surface],
      conversations: num(r?.conversations),
      reached: num(r?.reached),
      past: num(r?.past),
      highest: withDetail ? num(r?.highest) : null,
    };
  });
  if (!withDetail) return { surfaces: rows, detail: null };

  const recent = await db.query(RECENT_SQL, [ENVIRONMENT, period, surfaces, thresholds, RECENT_LIMIT + 1]);
  return {
    surfaces: rows,
    detail: {
      recent: recent.rows.slice(0, RECENT_LIMIT).map(mapConversation),
      recentLimit: RECENT_LIMIT,
      recentCapped: recent.rows.length > RECENT_LIMIT,
    },
  };
}

function mapConversation(r: Record<string, unknown>): ThresholdConversation {
  return {
    studentId: num(r.student_id),
    displayName: strOrNull(r.display_name),
    surface: String(r.surface) as ThresholdSurface,
    threshold: num(r.threshold),
    delivered: num(r.delivered),
    reachedAt: iso(r.reached_at),
    lastAt: iso(r.last_at),
    sessionId: r.session_id == null ? null : num(r.session_id),
    lessonSlug: strOrNull(r.lesson),
    loId: strOrNull(r.lo_id),
    loLabel: strOrNull(r.lo_label),
    courseId: strOrNull(r.course_id),
  };
}

/**
 * The chip for each of one student's sessions that holds a conversation at or
 * past its threshold, keyed by session id — or, with `sessionId`, for that one
 * session. Sessions with nothing to say are absent from the map.
 */
export async function readSessionTurnLimits(
  db: Db,
  studentId: number,
  sessionId?: number
): Promise<Map<number, SessionTurnLimit>> {
  const { surfaces } = thresholdParams();
  const one = sessionId != null;
  const res = await db.query(
    SESSIONS_SQL(one),
    one ? [ENVIRONMENT, studentId, surfaces, sessionId] : [ENVIRONMENT, studentId, surfaces]
  );
  const bySession = new Map<number, ConversationCount[]>();
  for (const r of res.rows) {
    const id = num(r.session_id);
    const list = bySession.get(id) ?? [];
    list.push({ surface: String(r.surface), delivered: num(r.delivered) });
    bySession.set(id, list);
  }
  const out = new Map<number, SessionTurnLimit>();
  for (const [id, convs] of bySession) {
    const limit = sessionTurnLimit(convs);
    if (limit) out.set(id, limit);
  }
  return out;
}
