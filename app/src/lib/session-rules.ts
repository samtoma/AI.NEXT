/**
 * Learning-session rules — the DECIDABLE half of lib/sessions.ts (ADR-0015).
 *
 * No `pg`, no imports at all, on purpose: these are the rules, and the SQL in
 * lib/sessions.ts is only how they are applied. Split for the same reason
 * demo-student.ts is split — a module that constructs a connection pool cannot
 * be unit-tested, and "when did this sitting end" is exactly the kind of
 * decision that must be tested rather than watched in production.
 *
 * lib/sessions.ts re-exports everything here, so callers import one module.
 */

export type SessionKind =
  | "lesson_learn"
  | "lesson_review"
  | "practice"
  | "student_chat"
  | "spine_chat";

export type CloseReason = "completed" | "inactivity" | "superseded" | "abandoned";

/**
 * The inactivity window: 30 minutes, DOCUMENTED RATHER THAN DISCOVERED
 * (FR-2302). It is stated here, in contracts/sessions.md and in plan.md's Open
 * list because it is Samuel's to change — not because it is undecided. Nothing
 * else in the codebase may hold a second idea of when a sitting ended.
 */
export const SESSION_IDLE_MS = 30 * 60 * 1000;

export type OpenSession = { id: number; kind: SessionKind; lastSeenAt: Date };

export type SessionPlan =
  | { action: "reuse"; sessionId: number }
  | { action: "open" }
  | { action: "close-then-open"; sessionId: number; reason: CloseReason };

export type ClosedSession = {
  id: number;
  studentId: number;
  kind: SessionKind;
  openedAt: Date;
  closedAt: Date;
};

/** The instant before which an open session counts as idle. */
export function idleCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - SESSION_IDLE_MS);
}

export function isIdle(lastSeenAt: Date, now: Date = new Date()): boolean {
  return lastSeenAt.getTime() <= idleCutoff(now).getTime();
}

/**
 * What to do with the student's open session, given what they just asked for.
 *
 * Inactivity outranks supersession: if the sitting had already ended by the
 * clock, it ended by inactivity, whatever the student opened next. FR-2302
 * requires those two closes stay distinguishable, and recording the later one
 * would erase the gap that is the evidence.
 *
 * `adoptOpen` is the contract's "`practice`, or the lesson's kind when the
 * attempt is inside one": an answer submitted mid-lesson is not the student
 * starting something new, so `kind` then means "what to open if nothing is".
 */
export function planForRequest(
  open: OpenSession | null,
  kind: SessionKind,
  now: Date = new Date(),
  adoptOpen = false
): SessionPlan {
  if (!open) return { action: "open" };
  if (isIdle(open.lastSeenAt, now))
    return { action: "close-then-open", sessionId: open.id, reason: "inactivity" };
  if (adoptOpen || open.kind === kind) return { action: "reuse", sessionId: open.id };
  return { action: "close-then-open", sessionId: open.id, reason: "superseded" };
}

/**
 * The `session_ended` payload, or null when there was nothing to close.
 * Returning null IS the idempotence: closing a closed session emits nothing,
 * rather than raising, and rather than reporting a second ending for one
 * sitting — closing is one-way, and the timeline must not say otherwise.
 */
export function endedEventProperties(
  closed: ClosedSession | null,
  reason: CloseReason
): Record<string, unknown> | null {
  if (!closed) return null;
  return {
    session_id: closed.id,
    kind: closed.kind,
    close_reason: reason,
    duration_ms: Math.max(0, closed.closedAt.getTime() - closed.openedAt.getTime()),
  };
}

/**
 * FR-2309, in one function: a session reference we do not have is NULL. There
 * is deliberately no fallback here — no "nearest open session", no timestamp
 * window. Anything that cannot produce a positive session id produces a gap,
 * because a guess in an audit surface is worse than a gap.
 */
export function attributableSessionId(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
}
