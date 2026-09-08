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
 */

import { pool } from "@/lib/db";
import { ENVIRONMENT } from "@/lib/env";

/** The PRD §13 taxonomy, narrowed to what this build actually has. */
export type AnalyticsEvent =
  // identity (Epic A signup is deferred — decisions.md Q5 — so these replace it)
  | "student_created"
  | "student_selected"
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
  sessionId?: string | null;
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
  properties = {},
}: EmitArgs): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO analytics_events (environment, event, student_id, session_id, properties)
       VALUES ($1, $2, $3, $4, $5)`,
      [ENVIRONMENT, event, studentId, sessionId, JSON.stringify(properties)]
    );
  } catch (err) {
    // Analytics is observability, not behaviour. Log and move on.
    console.error(`[analytics] failed to emit ${event}:`, err);
  }
}

/** Event names a client is allowed to send through /api/analytics. */
const CLIENT_EMITTABLE: ReadonlySet<string> = new Set<AnalyticsEvent>([
  "lesson_step_viewed",
  "dashboard_viewed",
  "parent_view_opened",
  "button_click",
  "session_ended",
]);

export function isClientEmittable(event: string): event is AnalyticsEvent {
  return CLIENT_EMITTABLE.has(event);
}
