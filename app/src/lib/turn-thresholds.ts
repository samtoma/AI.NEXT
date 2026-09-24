/**
 * The per-surface reply thresholds — **observed, not enforced** (ADR-0023,
 * FR-3402).
 *
 * Until v0.9.0 these numbers were `TURN_CAPS` in `api/ask/route.ts`, and a
 * conversation that reached one was refused its next turn with a limit message
 * and a locked input. On production two of six lessons hit the lesson cap after
 * about ten minutes, with a third of the counted turns being button taps
 * ("Continue.", "Got it — next ✓"). Samuel's call, 2026-09-24: remove the
 * limits, and show in the console how often they WOULD have triggered. So the
 * numbers survive as thresholds a conversation can cross, and nothing anywhere
 * refuses a student's turn because of them (FR-3401).
 *
 * **Pure: no database, no React, no Next.** It is imported by the student
 * lesson surface (the review-mode Finish nudge), by the console's query
 * modules and by the console's pages, and `node --test` loads it directly.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS COUNTED — the old cap's definitions, unchanged (FR-3406)
 * ---------------------------------------------------------------------------
 * A **conversation** is `(surface, grounding->>'chat_session', student_id)` in
 * `ai_interactions`. A **reply** is a row with `outcome = 'ok'`: a turn the
 * student actually received. A turn the backend dropped taught nobody
 * anything, and it did not count against the cap either. The SQL that applies
 * both definitions lives in `lib/turn-threshold-queries.ts`, once.
 *
 * ---------------------------------------------------------------------------
 * "REACHED" AND "PAST", AND WHY HISTORY CAN ONLY SHOW THE FIRST
 * ---------------------------------------------------------------------------
 * `reached` — the conversation delivered at least the threshold's number of
 * replies. Under the old rule its NEXT request was the one refused.
 * `past` — it delivered more than that. That is the turn the old rule would
 * have refused, and it happened.
 *
 * Before v0.9.0 a refused request was never logged — the cap check ran before
 * anything was written — so no conversation from before this release can show
 * `past`. "Reached" on an old conversation means "the limit fired here", or
 * that the student stopped at exactly the threshold; the ledger cannot say
 * which.
 */

/** The surfaces that carry a threshold. `spine_chat` never had a cap and has none. */
export type ThresholdSurface = "student_chat" | "lesson_learn" | "lesson_review";

export const TURN_THRESHOLDS: Readonly<Record<ThresholdSurface, number>> = {
  // PRD §6.3: "max 2 AI turns per question" — the explanation the student
  // asked for, and one more in a different way.
  student_chat: 2,
  // 14 until the Socratic arc (#33, #34, #35) raised it to 18: asking the
  // student to try a step first, asking how they got there and ending on a
  // from-memory retrieval all cost turns, and at 14 a full lesson ran out
  // before its final retrieval. Production then showed 18 reached in about ten
  // minutes, which is why it is a threshold now and not a cap.
  lesson_learn: 18,
  // Quick revision: the "non-annoying" three-minute path, ≤ 5 replies. On the
  // student's side this number is a Finish NUDGE (`LessonSession`), never a
  // block.
  lesson_review: 5,
};

/** The surfaces with a threshold, in the order the console lists them. */
export const THRESHOLD_SURFACES: readonly ThresholdSurface[] = [
  "lesson_learn",
  "lesson_review",
  "student_chat",
];

export type ThresholdStatus = "below" | "reached" | "past";

/** The surface's threshold, or null for a surface that has none (`spine_chat`, anything unknown). */
export function thresholdOf(surface: string): number | null {
  return Object.prototype.hasOwnProperty.call(TURN_THRESHOLDS, surface)
    ? TURN_THRESHOLDS[surface as ThresholdSurface]
    : null;
}

/**
 * Where a conversation with `delivered` replies stands against its surface's
 * threshold. A surface with no threshold is always `below`: it cannot reach
 * what it does not have.
 */
export function thresholdStatus(surface: string, delivered: number): ThresholdStatus {
  const t = thresholdOf(surface);
  if (t == null || !Number.isFinite(delivered) || delivered < t) return "below";
  return delivered > t ? "past" : "reached";
}

/**
 * The console's chip text for a conversation: "Reached 18 replies", or
 * "Past 18 replies · 23" with the actual count, or null when there is nothing
 * to say. One wording for the session list, the timeline and the replay.
 */
export function thresholdChipLabel(surface: string, delivered: number): string | null {
  const status = thresholdStatus(surface, delivered);
  if (status === "below") return null;
  const t = thresholdOf(surface)!;
  const replies = `${t} repl${t === 1 ? "y" : "ies"}`;
  return status === "reached" ? `Reached ${replies}` : `Past ${replies} · ${delivered}`;
}

/* ----------------------------------------------------------- one session */

/** One conversation's reply count as it stood at the end of one session. */
export type ConversationCount = { surface: string; delivered: number };

/** What a session's chip says: its furthest conversation, and how many reached. */
export type SessionTurnLimit = {
  surface: string;
  threshold: number;
  delivered: number;
  status: Exclude<ThresholdStatus, "below">;
  /** Conversations in this session at or past their threshold — usually 1. */
  conversationsAtThreshold: number;
};

const RANK: Record<ThresholdStatus, number> = { below: 0, reached: 1, past: 2 };

/**
 * The chip for one session, from its conversations' counts — or null when no
 * conversation in it reached a threshold. The conversation furthest past its
 * threshold speaks for the session (a practice sitting can hold several
 * question chats); the count of the others is kept so the page can say so.
 */
export function sessionTurnLimit(convs: readonly ConversationCount[]): SessionTurnLimit | null {
  let best: SessionTurnLimit | null = null;
  let atThreshold = 0;
  for (const c of convs) {
    const status = thresholdStatus(c.surface, c.delivered);
    if (status === "below") continue;
    atThreshold++;
    const threshold = thresholdOf(c.surface)!;
    const beats =
      best == null ||
      RANK[status] > RANK[best.status] ||
      (RANK[status] === RANK[best.status] &&
        c.delivered - threshold > best.delivered - best.threshold);
    if (beats) {
      best = { surface: c.surface, threshold, delivered: c.delivered, status, conversationsAtThreshold: 0 };
    }
  }
  return best ? { ...best, conversationsAtThreshold: atThreshold } : null;
}

/* ------------------------------------------------------- the Cost panel */

/**
 * One threshold surface on the Cost page, over one period. Counted in SQL
 * (`lib/turn-threshold-queries.ts`) with the rule `thresholdStatus` states —
 * reached is `delivered >= threshold`, past is `delivered > threshold` — and
 * `turn-threshold-queries.test.mts` pins the two to each other.
 */
export type SurfaceThresholdSummary = {
  surface: ThresholdSurface;
  threshold: number;
  /** Conversations with at least one turn in the period. */
  conversations: number;
  /** …of which delivered at least the threshold. */
  reached: number;
  /** …of which delivered more than it (a subset of `reached`). */
  past: number;
  /**
   * The most replies any one conversation delivered; 0 when there were none.
   * **`null` unless the operator holds `student-data`** (FR-2406): it is the
   * turn count of a single conversation, so it is not even selected for a
   * billing-only operator.
   */
  highest: number | null;
};

/** True when any conversation in the summary reached its threshold — the panel's attention state. */
export function anyThresholdReached(rows: readonly SurfaceThresholdSummary[]): boolean {
  return rows.some((r) => r.reached > 0);
}

/* ===================================================== photo uploads */

/**
 * Uploads per student in 24 hours — **observed, not enforced** (ADR-0023,
 * FR-3407, FR-3408).
 *
 * Until v0.9.0 this was `DAILY_UPLOAD_CAP` in `lib/upload-contract.ts`, and
 * `POST /api/uploads` answered 429 to the upload that would have been the
 * eleventh. It came from T047 (spec 001's research: image tokens cost
 * materially more than text, and an unbounded upload path was the one place
 * the comparison build could quietly outspend the baseline). Samuel,
 * 2026-09-24: "remove the limit of the photo uploads for now as well, and add
 * the monitoring and cost if any in the admin console". So nothing refuses an
 * upload for count any more; size (10 MB) and type (JPEG, PNG, PDF) still
 * refuse, because they are not counts.
 *
 * **"A day" is the old count's, unchanged: the 24 hours before each upload,
 * rolling, not a calendar day, so no timezone enters it.** The retired
 * `uploadsToday` counted `uploads.created_at > now() - interval '1 day'` at
 * the moment of the request; `lib/upload-threshold-queries.ts` reproduces
 * that window for every upload. A student-day is listed under the UTC date the
 * upload landed on (the console's convention, `stamp`), which is only a label:
 * the count behind it is still the rolling 24 hours.
 *
 * "Reached" and "past" mean what they mean for turns: the tenth upload in 24
 * hours reached it (the old rule refused the next one), an eleventh went past
 * it. Refused uploads were never stored, so history before v0.9.0 can show
 * "reached" and never "past".
 */
export const DAILY_UPLOAD_THRESHOLD = 10;

/** Where a student's count of uploads in 24 hours stands against the threshold. */
export function uploadThresholdStatus(inTwentyFourHours: number): ThresholdStatus {
  if (!Number.isFinite(inTwentyFourHours) || inTwentyFourHours < DAILY_UPLOAD_THRESHOLD) {
    return "below";
  }
  return inTwentyFourHours > DAILY_UPLOAD_THRESHOLD ? "past" : "reached";
}

/** "Reached 10 uploads", "Past 10 uploads · 13", or null below it. */
export function uploadChipLabel(inTwentyFourHours: number): string | null {
  const status = uploadThresholdStatus(inTwentyFourHours);
  if (status === "below") return null;
  const t = `${DAILY_UPLOAD_THRESHOLD} uploads`;
  return status === "reached" ? `Reached ${t}` : `Past ${t} · ${inTwentyFourHours}`;
}

/**
 * The upload threshold on the Cost page, over one period — counted in SQL
 * (`lib/upload-threshold-queries.ts`) with `uploadThresholdStatus`'s rule.
 */
export type UploadThresholdSummary = {
  threshold: number;
  /** Student-days with at least one upload. */
  studentDays: number;
  reached: number;
  past: number;
  /**
   * The most uploads one student made in any 24 hours; 0 when none. **`null`
   * unless the operator holds `student-data`** (FR-2406): it is one student's
   * upload count.
   */
  highest: number | null;
};
