/**
 * How engaged the student appears — the second half of FR-207.
 *
 * FR-207 asks that tone adapt to grade level AND to how engaged the student
 * appears. Grade has always reached the prompt; engagement never existed at
 * all, so the requirement sat PARTIAL with "no engagement signal exists" as
 * its gap. This module is that signal.
 *
 * THE RULE THAT SHAPES EVERYTHING HERE: the student must never feel reported
 * on (PRD §8). This produces a STANCE for the tutor — how warmly to pitch the
 * next turn, whether to slow down, whether to shorten — and never a label to
 * repeat back. Nothing in the rendered block may be said to the student, and
 * the block says so explicitly.
 *
 * IT IS OBSERVATION, NOT INFERENCE ABOUT THE PERSON. Everything below is read
 * from rows we already write on every attempt: correctness, `time_ms` and
 * `attempted_at`. There is no model call, no sentiment analysis, and no claim
 * about mood — "appears rushed" means the timings are short and the answers
 * are wrong, and that is all it ever means.
 *
 * IT FAILS QUIET. Below `MIN_OBSERVATIONS` attempts there is no signal and the
 * block renders nothing, because a confident read off two data points is worse
 * than silence. Same for a database error: the tutor teaches exactly as it did
 * before this layer existed.
 */


/** Fewer attempts than this and we say nothing at all. */
export const MIN_OBSERVATIONS = 4;

/** How many recent attempts the read is taken over. */
export const WINDOW = 12;

/**
 * Faster than this on a WRONG answer is not thinking, it is clicking. Six
 * seconds is deliberately generous: a confident correct answer can land in
 * two, so this threshold is only ever applied together with incorrectness.
 */
export const RUSH_MS = 6_000;

/** Longer than this suggests the question is above where the student is. */
export const LABOUR_MS = 90_000;

/** A gap this long means they have been away rather than struggling. */
export const AWAY_HOURS = 72;

export type EngagementState =
  | "no_signal"
  | "returning"
  | "rushing"
  | "struggling"
  | "labouring"
  | "steady";

export type EngagementObservations = {
  /** Attempts in the window. */
  n: number;
  /** How many of those were correct. */
  correct: number;
  /** Consecutive incorrect attempts counting back from the most recent. */
  wrongStreak: number;
  /** Median `time_ms` across the window; null when no attempt recorded one. */
  medianTimeMs: number | null;
  /** Wrong answers that arrived faster than `RUSH_MS`. */
  fastWrong: number;
  /** Hours since the most recent attempt; null when there are none. */
  hoursSinceLast: number | null;
};

export type EngagementSignal = {
  state: EngagementState;
  observations: EngagementObservations;
};

/**
 * Classify observations into a stance.
 *
 * Pure and exported so the decision can be tested without a database — the
 * ordering below is the whole of the policy, and ordering is exactly the part
 * that goes wrong silently.
 */
export function classify(o: EngagementObservations): EngagementState {
  if (o.n < MIN_OBSERVATIONS) return "no_signal";

  // Checked FIRST and deliberately. Someone back after three days looks
  // identical to someone struggling — a cold streak of wrong answers — and
  // treating a returning student as a failing one is the worse mistake.
  if (o.hoursSinceLast !== null && o.hoursSinceLast >= AWAY_HOURS) {
    return "returning";
  }

  // Rushing before struggling: both show wrong answers, but the response to
  // guessing is "slow down", and the response to genuine effort is support.
  // Telling someone who is trying hard to slow down reads as a reprimand.
  if (o.fastWrong >= 3) return "rushing";

  if (o.wrongStreak >= 3) return "struggling";

  if (o.medianTimeMs !== null && o.medianTimeMs >= LABOUR_MS) return "labouring";

  return "steady";
}

/** What the tutor should DO about each state. Never shown to the student. */
const STANCE: Record<Exclude<EngagementState, "no_signal">, string> = {
  returning:
    "they have been away for a while — reopen warmly, re-anchor the idea in one " +
    "sentence before asking anything, and do not treat the gap as a lapse",
  rushing:
    "recent wrong answers came back very fast, which usually means clicking " +
    "rather than working — slow the turn down, ask for one step of reasoning " +
    "before the answer, and keep it light rather than corrective",
  struggling:
    "several wrong in a row — drop to the smallest next step, name one thing " +
    "they did get right, and do not stack a new idea on top until something lands",
  labouring:
    "answers are taking a long time, which usually means this sits above where " +
    "they are — shorten the question, cut the vocabulary, and check the " +
    "prerequisite rather than pressing on",
  steady:
    "working steadily — keep the pace, stay brief, and do not over-explain what " +
    "is already landing",
};

/**
 * Render the signal as a prompt fragment, or "" when there is nothing to say.
 *
 * The empty string matters: with no signal the assembled prompt stays
 * byte-identical to what it was before this module existed, so the capture
 * harness attributes any diff to a real read rather than to added scaffolding.
 */
export function engagementBlock(sig: EngagementSignal | null): string {
  if (!sig || sig.state === "no_signal") return "";
  return (
    `ENGAGEMENT (observed from their last ${sig.observations.n} answers — ` +
    `THIS IS A STANCE FOR YOU, NOT A TOPIC. Never tell the student how engaged ` +
    `they appear, never mention being timed or tracked, and never quote this ` +
    `line back):\n- ${STANCE[sig.state]}`
  );
}

/** One attempt row, narrowed to the three fields the read uses. */
export type AttemptRow = {
  is_correct: boolean;
  time_ms: number | null;
  /** pg returns a Date; a string or epoch ms is accepted so callers and tests need no adapter. */
  attempted_at: Date | string | number;
};

/**
 * Map recent attempt rows (newest first) to observations.
 *
 * Pure, and separate from the query on purpose: this module imports nothing, so
 * the read can be tested without a database — the same shape `bkt.ts` and
 * `widget-payloads.ts` already use. The SQL lives in `retrieval.ts`.
 *
 * `now` is injectable so the absence test is not wall-clock dependent.
 */
export function observationsFrom(
  rows: readonly AttemptRow[],
  now: number = Date.now()
): EngagementObservations | null {
  if (rows.length === 0) return null;

  const times = rows
    .map((r) => r.time_ms)
    .filter((t): t is number => typeof t === "number" && Number.isFinite(t) && t >= 0)
    .sort((a, b) => a - b);

  let wrongStreak = 0;
  for (const r of rows) {
    if (r.is_correct) break;
    wrongStreak++;
  }

  const last = rows[0]?.attempted_at;
  const lastMs = last ? new Date(last).getTime() : NaN;

  return {
    n: rows.length,
    correct: rows.filter((r) => r.is_correct).length,
    wrongStreak,
    medianTimeMs: times.length ? times[Math.floor(times.length / 2)] : null,
    fastWrong: rows.filter(
      (r) => !r.is_correct && typeof r.time_ms === "number" && r.time_ms < RUSH_MS
    ).length,
    hoursSinceLast: Number.isFinite(lastMs) ? (now - lastMs) / 3_600_000 : null,
  };
}
