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
 * a rewrite: callers already inside a transaction pass their client today, and
 * callers who are not get a unit of work of their own from `scoped`.
 *
 * `closeSession` gained a `studentId` for the same reason. It used to need only
 * the session id, because `UPDATE sessions WHERE id = $1` was enough to find
 * the row. Under the policy it is not: with no principal set that UPDATE
 * matches nothing, `rowCount` is 0, and the function's own idempotence rule —
 * "closing a closed session is a no-op, not an error" — would swallow it. Every
 * sitting would then end up swept as `inactivity`, and FR-2302's "did she
 * finish, or walk away" would have one answer for both. A silent wrong answer,
 * from a change three files away; hence the extra argument.
 *
 * **v0.7.0 — the sitting's snapshot, and Off on the next message (ADR-0021).**
 * A session row is now also where two facts about the sitting are FIXED at the
 * moment it opens: which release served it (`release_tag`) and whether
 * Socratic probing was on for it (`probing`). Probing is resolved here and
 * nowhere else — from the console's switch, the student's tester mark, the
 * lesson's course and the session's kind (`resolveProbing`, pure) — and
 * migration 030's trigger refuses any later UPDATE of either column: the row
 * is the record of what the sitting OPENED with.
 *
 * What a REQUEST gets is narrower (Samuel, 2026-09-24, option B): the stored
 * snapshot AND the switch and her tester mark as they stand at this request —
 * each counted only if it has NOT CHANGED since the sitting opened. So
 * switching Off, or removing a student's mark, reaches her next message even
 * mid-lesson; switching On reaches her next sitting only. And a sitting,
 * once narrowed, never widens again: Off then On, or un-marking then
 * re-marking, leaves it off for the rest of the sitting (fix pass 2), because
 * the switch and the mark it is now looking at are not the ones it opened
 * under. The re-read happens only for a sitting that opened ON, so every
 * other request does exactly what it did in v0.6.0.
 */

import type { PoolClient } from "pg";
import { withMaint } from "@/lib/db";
import { scoped, type Db } from "@/lib/student-context";
import { ENVIRONMENT, RELEASE_TAG } from "@/lib/env";
import { emit } from "@/lib/analytics";
import {
  PROBING_SURFACE,
  asProbingSetting,
  probingCouldApply,
  resolveProbing,
  type ProbingSetting,
} from "@/lib/socratic-probing";
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

export type SessionOpts = {
  /** as `ai_interactions.surface` — 'lesson_learn' | 'student_chat' | … */
  surface?: string;
  /** the objective, when the caller knows it */
  loId?: string;
  /** the legacy chatSession string, during the transition */
  clientKey?: string;
  /** join whatever session is open instead of superseding it — see planForRequest */
  adoptOpen?: boolean;
  /**
   * The course of the lesson this session would open on, asked for LAZILY and
   * only when probing could apply at all (ADR-0021: maths only). `/api/ask`
   * passes it for the lesson surfaces; every other caller has no lesson, and
   * a session with no course never probes.
   */
  courseOf?: () => Promise<string | null>;
};

/** What a session is, as the routes that serve inside it need to know it. */
export type SessionSnapshot = {
  /** null when the session could not be opened or attributed (FR-2309) */
  sessionId: number | null;
  kind: SessionKind | null;
  /**
   * Whether Socratic probing applies to THIS REQUEST (ADR-0021, option B):
   * the sitting's stored snapshot AND the switch and the student's tester
   * mark as they stand now — each unchanged since the sitting opened, so a
   * sitting that stopped probing never starts again (fix pass 2). The course
   * half of the rule is applied by the caller, which knows the lesson or
   * question in front of it (`effectiveProbing`). `false` for a session
   * opened before v0.7.0 (NULL in the column), for a session that could not
   * be opened, and whenever the live read fails — fail closed, never on.
   */
  probing: boolean;
  /**
   * The stored snapshot — what the sitting OPENED with, as the console shows
   * it. Never re-resolved; `probing` above can be false while this is true
   * (the switch or the mark changed mid-sitting), never the other way round.
   */
  openedProbing: boolean;
};

async function selectOpen(db: Db, studentId: number): Promise<OpenSession | null> {
  const res = await db.query(
    `SELECT id, kind, last_seen_at, probing FROM sessions
      WHERE student_id = $1 AND closed_at IS NULL`,
    [studentId]
  );
  const r = res.rows[0];
  return r
    ? {
        id: Number(r.id),
        kind: r.kind as SessionKind,
        lastSeenAt: new Date(r.last_seen_at),
        probing: r.probing === true,
      }
    : null;
}

/**
 * The switch and the tester mark, as the resolver reads them — one statement
 * under the student's own principal. `student_testers` is RLS-forced, so the
 * mark read cannot see another child's even if the id were wrong.
 *
 * Its own SAVEPOINT: a failure here must cost the student probing, never
 * their turn and never the session row. The answer on failure is `off`.
 */
async function readProbingInputs(
  db: Db,
  sql: string,
  values: unknown[]
): Promise<{ setting: ProbingSetting; isTester: boolean }> {
  await db.query("SAVEPOINT probing_inputs");
  try {
    const res = await db.query(sql, values);
    await db.query("RELEASE SAVEPOINT probing_inputs");
    return {
      setting: asProbingSetting(res.rows[0]?.setting),
      isTester: res.rows[0]?.is_tester === true,
    };
  } catch (err) {
    await db.query("ROLLBACK TO SAVEPOINT probing_inputs");
    console.error("[sessions] could not read the probing inputs; resolving OFF:", err);
    return { setting: "off", isTester: false };
  }
}

/** At OPEN: this environment's console position, and whether THIS student carries a mark. */
function probingInputs(
  db: Db,
  studentId: number
): Promise<{ setting: ProbingSetting; isTester: boolean }> {
  return readProbingInputs(
    db,
    `SELECT (SELECT socratic_probing FROM teaching_settings
              WHERE environment = $1)                          AS setting,
            EXISTS (SELECT 1 FROM student_testers
                     WHERE environment = $1 AND student_id = $2
                       AND unmarked_at IS NULL)                 AS is_tester`,
    [ENVIRONMENT, studentId]
  );
}

/**
 * For a sitting that opened ON: the same two facts, each counted ONLY IF IT
 * HAS NOT CHANGED SINCE THE SITTING OPENED (fix pass 2, FR-3105).
 *
 *   · the switch counts only while `teaching_settings.updated_at` is at or
 *     before the sitting's `opened_at`. Any move after it — Off, On, a
 *     different position — reads as no switch at all, i.e. off. The console
 *     writes nothing when Save is pressed on the position already in force
 *     (`setProbingSetting`), so an idle click does not end anybody's probing.
 *   · the mark counts only if the open mark was made at or before
 *     `opened_at`. Removing it closes that row; marking again inserts a NEW
 *     row with a later `marked_at` — so un-mark then re-mark mid-sitting is
 *     not the mark the sitting opened under, and reads as unmarked.
 *
 * Why timestamps and not a column: the rule "a sitting never widens after it
 * narrowed" then needs no mutable state on the session row (whose snapshot a
 * trigger freezes) — "was it narrowed?" is answered by whether anything
 * changed, which the rows already record.
 *
 * The comparison is between transaction start times (`now()` on both sides),
 * so a change whose transaction straddles the sitting's own open can land on
 * either side of it. The only direction that matters is covered: the CURRENT
 * values are still read and still have to allow probing, so a straddling
 * change can end a sitting's probing early but cannot turn one on that the
 * switch as it now stands would refuse.
 */
function probingInputsSinceOpen(
  db: Db,
  studentId: number,
  sessionId: number
): Promise<{ setting: ProbingSetting; isTester: boolean }> {
  return readProbingInputs(
    db,
    `SELECT (SELECT ts.socratic_probing FROM teaching_settings ts
              WHERE ts.environment = $1
                AND ts.updated_at <= s.opened_at)              AS setting,
            EXISTS (SELECT 1 FROM student_testers t
                     WHERE t.environment = $1 AND t.student_id = $2
                       AND t.unmarked_at IS NULL
                       AND t.marked_at <= s.opened_at)          AS is_tester
       FROM sessions s
      WHERE s.id = $3 AND s.student_id = $2`,
    [ENVIRONMENT, studentId, sessionId]
  );
}

/**
 * Does a sitting that OPENED with probing on still probe for this request?
 * (ADR-0021, option B — Off and un-marking reach the next message; fix pass
 * 2 — and a sitting, once narrowed, stays narrowed.)
 *
 * Called ONLY for a session whose stored snapshot is true, so it can only
 * ever narrow: a sitting that opened off never reaches here and never turns
 * on. It re-reads the switch and this student's mark as they stood when the
 * sitting opened AND still stand (`probingInputsSinceOpen`), and asks the
 * resolver the same question minus the course, which the caller narrows with
 * the lesson or question actually in front of it. A failed read answers false.
 */
async function probingStillApplies(
  db: Db,
  studentId: number,
  sessionId: number,
  kind: SessionKind
): Promise<boolean> {
  if (kind !== PROBING_SURFACE) return false;
  const { setting, isTester } = await probingInputsSinceOpen(db, studentId, sessionId);
  return probingCouldApply({ setting, isTester, surface: kind });
}

/**
 * A stored snapshot as it applies to this request: false stays false without
 * a query; true is re-checked against the switch and the mark — unchanged
 * since the sitting opened, and still allowing it.
 */
async function liveProbing(db: Db, studentId: number, open: OpenSession): Promise<boolean> {
  return open.probing ? probingStillApplies(db, studentId, open.id, open.kind) : false;
}

/** Resolve the snapshot for a session about to be opened. Runs once per session. */
async function resolveSessionProbing(
  db: Db,
  studentId: number,
  kind: SessionKind,
  opts: SessionOpts
): Promise<boolean> {
  // Only a learn-mode lesson can ever probe (FR-3104). Every other kind —
  // review, practice, open chat, an upload — answers false here, before any
  // query and any savepoint: those sessions open exactly as they did in
  // v0.6.0.
  if (kind !== PROBING_SURFACE) return false;
  const { setting, isTester } = await probingInputs(db, studentId);
  // With the switch Off (the default) this is false and the course is never
  // looked up: an Off build performs one read at a learn-lesson open that
  // v0.6.0 did not (the one above), and nothing else.
  if (!probingCouldApply({ setting, isTester, surface: kind }) || !opts.courseOf) return false;
  let courseId: string | null = null;
  await db.query("SAVEPOINT probing_course");
  try {
    courseId = await opts.courseOf();
    await db.query("RELEASE SAVEPOINT probing_course");
  } catch (err) {
    await db.query("ROLLBACK TO SAVEPOINT probing_course");
    console.error("[sessions] could not resolve the lesson's course; resolving OFF:", err);
    return false;
  }
  return resolveProbing({ setting, isTester, courseId, surface: kind });
}

async function insertSession(
  db: Db,
  studentId: number,
  kind: SessionKind,
  opts: SessionOpts,
  probing: boolean
): Promise<number> {
  // `client_key` is dropped rather than made to collide: the unique index is
  // per student, and a browser reusing its string after the sitting it named
  // was closed must not reach back into that closed session. The key is a
  // transitional correlation aid, not an identity.
  //
  // `probing` and `release_tag` are written HERE and only here (ADR-0021):
  // migration 030's trigger refuses any later change to either.
  const res = await db.query(
    `INSERT INTO sessions
       (student_id, kind, surface, lo_id, client_key, environment,
        opened_at, last_seen_at, assigned_at, probing, release_tag)
     VALUES ($1, $2, $3, $4,
             (SELECT CASE WHEN $5::text IS NULL OR EXISTS (
                            SELECT 1 FROM sessions s
                             WHERE s.student_id = $1 AND s.client_key = $5::text)
                          THEN NULL ELSE $5::text END),
             $6, now(), now(), now(), $7, $8)
     RETURNING id`,
    [
      studentId,
      kind,
      opts.surface ?? null,
      opts.loId ?? null,
      opts.clientKey ?? null,
      ENVIRONMENT,
      probing,
      RELEASE_TAG,
    ]
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
): Promise<{
  sessionId: number;
  opened: boolean;
  kind: SessionKind;
  /** for THIS request: the snapshot narrowed by the switch and mark — unchanged since open */
  probing: boolean;
  /** the stored snapshot the sitting opened with */
  openedProbing: boolean;
}> {
  const outcome = await scoped(studentId, client, async (db) => {
    const open = await selectOpen(db, studentId);
    const plan = planForRequest(open, kind, new Date(), opts.adoptOpen === true);

    if (plan.action === "reuse") {
      await db.query(
        `UPDATE sessions
            SET last_seen_at = now(),
                surface = coalesce(surface, $2),
                lo_id   = coalesce(lo_id, $3)
          WHERE id = $1 AND closed_at IS NULL`,
        [plan.sessionId, opts.surface ?? null, opts.loId ?? null]
      );
      // Reused: the snapshot it OPENED with stands on the row, never
      // re-resolved — but a sitting that opened ON is narrowed by the switch
      // and the mark (option B), and stays narrowed once either has changed
      // since it opened (fix pass 2). One read, and only then.
      return {
        sessionId: plan.sessionId,
        opened: false,
        kind: open!.kind,
        probing: await liveProbing(db, studentId, open!),
        openedProbing: open!.probing,
      };
    }

    // The lazy half of the sweep: this student's stale session closes on their
    // next interaction. `sweepIdleSessions` is the nightly half, for the
    // students who do not come back. It runs on THIS unit's client so the close
    // and the open are one transaction under one principal.
    if (plan.action === "close-then-open")
      await closeSessionOn(db, plan.sessionId, plan.reason);

    // The sitting's snapshot (ADR-0021): resolved once, for the row about to
    // be written, and stored on it — the record of how this sitting opened.
    const probing = await resolveSessionProbing(db, studentId, kind, opts);

    // SAVEPOINT, because the insert below is EXPECTED to fail sometimes and the
    // recovery is a further query. Losing the one-open-session race used to be
    // survivable by simply asking again — on the bare pool a failed statement
    // costs nothing. Inside a transaction it aborts the whole thing, and every
    // later query on the client answers "current transaction is aborted"
    // instead. Now that the default path IS a transaction, the retry needs a
    // point to roll back to or it would turn the normal two-tabs case into a
    // 500.
    await db.query("SAVEPOINT session_insert");
    try {
      const sessionId = await insertSession(db, studentId, kind, opts, probing);
      await db.query("RELEASE SAVEPOINT session_insert");
      // Just resolved from the switch and the mark as they are now, so the
      // request's answer and the stored one are the same.
      return { sessionId, opened: true, kind, probing, openedProbing: probing };
    } catch (err) {
      await db.query("ROLLBACK TO SAVEPOINT session_insert");
      // Lost the race for the one-open-session index (23505). Whoever won wrote
      // a session for this student; adopt it rather than insisting on our own
      // — and adopt ITS snapshot, which the winner resolved and stored,
      // narrowed for this request like any reused sitting's.
      if ((err as { code?: string }).code !== "23505") throw err;
      const winner = await selectOpen(db, studentId);
      if (!winner) throw err;
      return {
        sessionId: winner.id,
        opened: false,
        kind: winner.kind,
        probing: await liveProbing(db, studentId, winner),
        openedProbing: winner.probing,
      };
    }
  });

  // Outside the unit on purpose: `emit` opens its own, and an analytics row
  // must not be able to roll back the session it is reporting.
  if (outcome.opened) {
    // One structured line per opened session, in the shape the rest of the
    // server logs (`[tag] message`): which build served it and whether it
    // probes are the two facts an operator reading the box's logs needs to
    // explain a lesson that behaved differently from the one before it.
    console.info(
      "[sessions] opened %s",
      JSON.stringify({
        session_id: outcome.sessionId,
        student_id: studentId,
        kind,
        surface: opts.surface ?? null,
        environment: ENVIRONMENT,
        release_tag: RELEASE_TAG,
        probing: outcome.probing,
      })
    );
    void emit({
      event: "session_started",
      studentId,
      sessionId: opts.clientKey ?? null,
      sessionRef: outcome.sessionId,
      properties: {
        session_id: outcome.sessionId,
        kind,
        surface: opts.surface ?? null,
        release_tag: RELEASE_TAG,
        probing: outcome.probing,
      },
    });
  }
  return outcome;
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
  return (await currentSessionSnapshot(studentId, kind, opts, client)).sessionId;
}

/**
 * `currentSessionOrNull`, plus what the session says about itself: its kind,
 * its stored probing snapshot, and whether probing applies to THIS request
 * (ADR-0021 — the snapshot narrowed by the switch and the mark now). The two
 * routes that must obey it — `/api/ask` and `/api/attempts` — use this, so
 * the session they write against and the answer they obey come from the same
 * row by construction. Fails exactly as `currentSessionOrNull` does, and a
 * session that could not be opened is never a probing one.
 */
export async function currentSessionSnapshot(
  studentId: number,
  kind: SessionKind,
  opts: SessionOpts = {},
  client?: PoolClient
): Promise<SessionSnapshot> {
  try {
    const s = await currentSession(studentId, kind, opts, client);
    const sessionId = attributableSessionId(s.sessionId);
    return sessionId == null
      ? { sessionId: null, kind: null, probing: false, openedProbing: false }
      : { sessionId, kind: s.kind, probing: s.probing, openedProbing: s.openedProbing };
  } catch (e) {
    console.error("[sessions] could not open a session; writing NULL:", e);
    return { sessionId: null, kind: null, probing: false, openedProbing: false };
  }
}

/**
 * Close explicitly. Idempotent: closing a closed session is a no-op, not an
 * error — see the header for why that rule made `studentId` mandatory.
 */
export async function closeSession(
  studentId: number,
  sessionId: number,
  reason: CloseReason,
  client?: PoolClient
): Promise<void> {
  await scoped(studentId, client, (db) => closeSessionOn(db, sessionId, reason));
}

async function closeSessionOn(
  db: Db,
  sessionId: number,
  reason: CloseReason
): Promise<void> {
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

/**
 * Close every session idle longer than the window. The nightly half of the
 * sweep, for the students who do not come back.
 *
 * It is the one function here that is deliberately CROSS-STUDENT — that is what
 * a sweep is — so it runs under `withMaint`, not under a principal. On the
 * application connection it would match zero rows and report success, which is
 * the worst of both: no sessions closed, no error, and every abandoned sitting
 * left open forever. A scheduled job, never a request path.
 */
export async function sweepIdleSessions(now: Date = new Date()): Promise<number> {
  const res = await withMaint((c) =>
    c.query(
      `UPDATE sessions
          SET closed_at = greatest(last_seen_at, opened_at), close_reason = 'inactivity'
        WHERE closed_at IS NULL AND last_seen_at <= $1
        RETURNING id, student_id, kind, opened_at, closed_at`,
      [idleCutoff(now)]
    )
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
