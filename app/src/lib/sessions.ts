/**
 * Learning sessions — the durable row behind "one sitting" (ADR-0015, FR-2301).
 *
 * Until this module, a session was an opaque string the browser invented, in
 * three incompatible shapes, never a row of its own. So a tutor turn could be
 * tied to the lesson it belonged to only by timestamp proximity, and the
 * correlation was lost at WRITE time — no later migration recovers it. That is
 * why this ships before the accounts work: it is the only gap losing data daily.
 *
 * Three invariants, in descending order of how quietly they break:
 *
 *  1. **At most one open session per student**, enforced by the partial unique
 *     index in migration 011 rather than by this code. Opening is therefore an
 *     INSERT that may lose a race, not a check-then-insert that pretends it
 *     cannot — two concurrent tabs are the normal case, not the exotic one.
 *  2. **Closing is one-way.** A closed session is never reopened; the next
 *     interaction opens a new one. A reopened session makes "how long did this
 *     sitting last" unanswerable, which is the one question a session exists to
 *     answer.
 *  3. **An interaction we cannot attribute is written with NULL** (FR-2309),
 *     never attached to the nearest session in time.
 *
 * The rules themselves are in lib/session-rules.ts, which has no database in
 * it and is re-exported here so callers import one module.
 *
 * P1 (ADR-0012) replaces the default `pool` path with `withPrincipal`, so every
 * session row is created under the student it belongs to and under no other.
 * The `client` parameter is the seam that makes that a substitution rather than
 * a rewrite: callers already inside a transaction pass their client today.
 */

import type { Pool, PoolClient } from "pg";
import { pool } from "@/lib/db";
import { ENVIRONMENT } from "@/lib/env";
import { emit } from "@/lib/analytics";
import {
  attributableSessionId,
  endedEventProperties,
  idleCutoff,
  planForRequest,
  type CloseReason,
  type OpenSession,
  type SessionKind,
} from "@/lib/session-rules";

export * from "@/lib/session-rules";

type Db = Pool | PoolClient;

export type SessionOpts = {
  /** as `ai_interactions.surface` — 'lesson_learn' | 'student_chat' | … */
  surface?: string;
  /** the objective, when the caller knows it */
  loId?: string;
  /** the legacy chatSession string, during the transition */
  clientKey?: string;
  /** join whatever session is open instead of superseding it — see planForRequest */
  adoptOpen?: boolean;
};

async function selectOpen(db: Db, studentId: number): Promise<OpenSession | null> {
  const res = await db.query(
    `SELECT id, kind, last_seen_at FROM sessions
      WHERE student_id = $1 AND closed_at IS NULL`,
    [studentId]
  );
  const r = res.rows[0];
  return r
    ? { id: Number(r.id), kind: r.kind as SessionKind, lastSeenAt: new Date(r.last_seen_at) }
    : null;
}

async function insertSession(
  db: Db,
  studentId: number,
  kind: SessionKind,
  opts: SessionOpts
): Promise<number> {
  // `client_key` is dropped rather than made to collide: the unique index is
  // per student, and a browser reusing its string after the sitting it named
  // was closed must not reach back into that closed session. The key is a
  // transitional correlation aid, not an identity.
  const res = await db.query(
    `INSERT INTO sessions
       (student_id, kind, surface, lo_id, client_key, environment,
        opened_at, last_seen_at, assigned_at)
     VALUES ($1, $2, $3, $4,
             (SELECT CASE WHEN $5::text IS NULL OR EXISTS (
                            SELECT 1 FROM sessions s
                             WHERE s.student_id = $1 AND s.client_key = $5::text)
                          THEN NULL ELSE $5::text END),
             $6, now(), now(), now())
     RETURNING id`,
    [studentId, kind, opts.surface ?? null, opts.loId ?? null, opts.clientKey ?? null, ENVIRONMENT]
  );
  return Number(res.rows[0].id);
}

function closedRow(r: Record<string, unknown>) {
  return {
    id: Number(r.id),
    studentId: Number(r.student_id),
    kind: r.kind as SessionKind,
    openedAt: new Date(r.opened_at as string),
    closedAt: new Date(r.closed_at as string),
  };
}

/**
 * Find the student's open session, or open one. Called at the top of every
 * interaction, and cheap enough to be: one indexed read on the hot path.
 */
export async function currentSession(
  studentId: number,
  kind: SessionKind,
  opts: SessionOpts = {},
  client?: PoolClient
): Promise<{ sessionId: number; opened: boolean }> {
  const db: Db = client ?? pool;
  const plan = planForRequest(
    await selectOpen(db, studentId),
    kind,
    new Date(),
    opts.adoptOpen === true
  );

  if (plan.action === "reuse") {
    await db.query(
      `UPDATE sessions
          SET last_seen_at = now(),
              surface = coalesce(surface, $2),
              lo_id   = coalesce(lo_id, $3)
        WHERE id = $1 AND closed_at IS NULL`,
      [plan.sessionId, opts.surface ?? null, opts.loId ?? null]
    );
    return { sessionId: plan.sessionId, opened: false };
  }

  // The lazy half of the sweep: this student's stale session closes on their
  // next interaction. `sweepIdleSessions` is the nightly half, for the students
  // who do not come back.
  if (plan.action === "close-then-open")
    await closeSession(plan.sessionId, plan.reason, client);

  let sessionId: number;
  try {
    sessionId = await insertSession(db, studentId, kind, opts);
  } catch (err) {
    // Lost the race for the one-open-session index (23505). Whoever won wrote a
    // session for this student; adopt it rather than insisting on our own.
    if ((err as { code?: string }).code !== "23505") throw err;
    const open = await selectOpen(db, studentId);
    if (!open) throw err;
    return { sessionId: open.id, opened: false };
  }

  void emit({
    event: "session_started",
    studentId,
    sessionId: opts.clientKey ?? null,
    sessionRef: sessionId,
    properties: { session_id: sessionId, kind, surface: opts.surface ?? null },
  });
  return { sessionId, opened: true };
}

/**
 * Session bookkeeping must never cost a student their turn: on any failure the
 * interaction is still written, with NULL (FR-2309). Inside a caller's
 * transaction the failure has already aborted it, so this only softens the
 * standalone paths — which is where it is needed.
 */
export async function currentSessionOrNull(
  studentId: number,
  kind: SessionKind,
  opts: SessionOpts = {},
  client?: PoolClient
): Promise<number | null> {
  try {
    const { sessionId } = await currentSession(studentId, kind, opts, client);
    return attributableSessionId(sessionId);
  } catch (e) {
    console.error("[sessions] could not open a session; writing NULL:", e);
    return null;
  }
}

/** Close explicitly. Idempotent: closing a closed session is a no-op, not an error. */
export async function closeSession(
  sessionId: number,
  reason: CloseReason,
  client?: PoolClient
): Promise<void> {
  const db: Db = client ?? pool;
  // An inactivity close is stamped at `last_seen_at`, not at now(): the sitting
  // ended when the student stopped, not when we noticed. Otherwise every swept
  // session reports a duration padded by however long the sweep took to run.
  // GREATEST keeps that honest in the one direction it could lie — a session
  // cannot end before it began, whatever a backdated row claims.
  const res = await db.query(
    `UPDATE sessions
        SET closed_at = CASE WHEN $2 = 'inactivity'
                             THEN greatest(last_seen_at, opened_at) ELSE now() END,
            close_reason = $2
      WHERE id = $1 AND closed_at IS NULL
      RETURNING id, student_id, kind, opened_at, closed_at`,
    [sessionId, reason]
  );
  if (res.rowCount === 0) return; // already closed — one-way, and not an error
  const closed = closedRow(res.rows[0]);
  void emit({
    event: "session_ended",
    studentId: closed.studentId,
    sessionRef: closed.id,
    properties: endedEventProperties(closed, reason) ?? {},
  });
}

/** Close every session idle longer than the window. Called lazily and nightly. */
export async function sweepIdleSessions(now: Date = new Date()): Promise<number> {
  const res = await pool.query(
    `UPDATE sessions
        SET closed_at = greatest(last_seen_at, opened_at), close_reason = 'inactivity'
      WHERE closed_at IS NULL AND last_seen_at <= $1
      RETURNING id, student_id, kind, opened_at, closed_at`,
    [idleCutoff(now)]
  );
  for (const r of res.rows) {
    const closed = closedRow(r);
    void emit({
      event: "session_ended",
      studentId: closed.studentId,
      sessionRef: closed.id,
      properties: endedEventProperties(closed, "inactivity") ?? {},
    });
  }
  return res.rowCount ?? 0;
}
