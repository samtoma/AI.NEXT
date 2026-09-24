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

/** One bucket of the per-surface histogram: this many conversations delivered exactly `delivered` replies. */
export type DeliveredBucket = { surface: string; delivered: number; conversations: number };

export type SurfaceThresholdSummary = {
  surface: ThresholdSurface;
  threshold: number;
  /** Conversations with at least one turn in the period. */
  conversations: number;
  /** …of which delivered at least the threshold. */
  reached: number;
  /** …of which delivered more than it (a subset of `reached`). */
  past: number;
  /** The most replies any one conversation delivered; 0 when there were none. */
  highest: number;
};

/**
 * Fold the histogram into one row per threshold surface, every surface
 * present even when it had no conversation (a zero row is a fact; a missing
 * row is a question). The rule is `thresholdStatus`, so the panel and the
 * session chips cannot disagree about what "reached" means.
 */
export function summariseThresholds(
  buckets: readonly DeliveredBucket[]
): SurfaceThresholdSummary[] {
  return THRESHOLD_SURFACES.map((surface) => {
    const row: SurfaceThresholdSummary = {
      surface,
      threshold: TURN_THRESHOLDS[surface],
      conversations: 0,
      reached: 0,
      past: 0,
      highest: 0,
    };
    for (const b of buckets) {
      if (b.surface !== surface || b.conversations <= 0) continue;
      row.conversations += b.conversations;
      const status = thresholdStatus(surface, b.delivered);
      if (status !== "below") row.reached += b.conversations;
      if (status === "past") row.past += b.conversations;
      row.highest = Math.max(row.highest, b.delivered);
    }
    return row;
  });
}

/** True when any conversation in the summary reached its threshold — the panel's attention state. */
export function anyThresholdReached(rows: readonly SurfaceThresholdSummary[]): boolean {
  return rows.some((r) => r.reached > 0);
}
