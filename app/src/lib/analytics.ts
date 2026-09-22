/**
 * Product analytics (PRD §13 taxonomy, FR-801/FR-901).
 *
 * Distinct from `ai_interactions`, which is the cost/token ledger. This table
 * answers product questions: did students activate, come back, and convert a
 * comprehension moment into a practice attempt.
 *
 * Every row carries `environment` stamped server-side from configuration
 * (lib/env.ts). Callers cannot set it — that is what keeps the two builds
 * comparable rather than pooled (constitution v2.0.0 Principle XI).
 *
 * Emission is fire-and-forget: analytics must never fail a student's lesson.
 * A dropped event costs us a data point; a thrown event costs a turn.
 *
 * **The INSERT is policed** (migration 017, Addendum A.1): `ainext_app` may
 * write a row only when `student_id` equals the principal or is NULL. So a row
 * with a student id has to be written inside `withPrincipal(studentId, …)`, and
 * an anonymous row has to be written with no principal at all. Getting that
 * backwards does not throw anywhere a caller would notice — `emit` swallows its
 * own failures by design — it just quietly stops recording the funnel the pilot
 * verdict is computed from. Hence the branch below rather than a shared path.
 */

import { pool, withPrincipal } from "@/lib/db";
import { ENVIRONMENT } from "@/lib/env";

/** The PRD §13 taxonomy, narrowed to what this build actually has. */
export type AnalyticsEvent =
  // identity — signup is no longer deferred (ADR-0013); these two are emitted
  // by the auth routes, and `student_selected` is what the retired picker left
  // behind rather than something any surface still produces.
  | "account_created"
  | "email_verified"
  | "student_created"
  | "student_selected"
  // these two now have a durable row behind them (lib/sessions.ts, ADR-0015)
  | "session_started"
  | "session_ended"
  // learning
  | "unit_started"
  | "unit_completed"
  | "lesson_step_viewed"
  | "question_asked"
  | "explanation_delivered"
  | "retrieval_attempt_started"
  | "retrieval_attempt_submitted"
  | "upload_submitted"
  // surfaces
  | "dashboard_viewed"
  | "parent_view_opened"
  // safety — flag type only, never detail (FR-802)
  | "safety_flag_raised"
  | "button_click";

export type AnalyticsProperties = Record<string, unknown>;

export type EmitArgs = {
  event: AnalyticsEvent;
  studentId?: number | null;
  /** The LEGACY client string (TEXT). Never joined to `sessions.id` — ADR-0015. */
  sessionId?: string | null;
  /** The learning session this event belongs to, or null when it belongs to none (FR-2309). */
  sessionRef?: number | null;
  properties?: AnalyticsProperties;
};

/**
 * Record one event. Never throws, never blocks the caller's critical path.
 *
 * Deliberately not batched: at pilot volume (10–20 students) a row per event is
 * cheap, and a batch buffer would lose events on container restart — which on a
 * short pilot is a meaningful fraction of the data the comparison rests on.
 */
export async function emit({
  event,
  studentId = null,
  sessionId = null,
  sessionRef = null,
  properties = {},
}: EmitArgs): Promise<void> {
  const sql = `INSERT INTO analytics_events
                 (environment, event, student_id, session_id, session_ref, properties)
               VALUES ($1, $2, $3, $4, $5, $6)`;
  const values = [
    ENVIRONMENT,
    event,
    studentId,
    sessionId,
    sessionRef,
    JSON.stringify(properties),
  ];
  try {
    // A DETACHED write: `emit` is called with `void` from paths that have
    // already answered the student, and often after their unit of work has
    // closed. It therefore opens its own — it never borrows a caller's client,
    // because an analytics row must not be able to roll back an attempt.
    if (studentId == null) {
      await pool.query(sql, values);
    } else {
      await withPrincipal(studentId, (c) => c.query(sql, values));
    }
  } catch (err) {
    // Analytics is observability, not behaviour. Log and move on.
    console.error(`[analytics] failed to emit ${event}:`, err);
  }
}

/** Event names a client is allowed to send through /api/analytics. */
const CLIENT_EMITTABLE: ReadonlySet<string> = new Set<AnalyticsEvent>([
  "student_selected",
  "lesson_step_viewed",
  "dashboard_viewed",
  "parent_view_opened",
  "button_click",
  "session_ended",
]);

export function isClientEmittable(event: string): event is AnalyticsEvent {
  return CLIENT_EMITTABLE.has(event);
}
