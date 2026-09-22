/**
 * When we may ask a child how we are doing, and which moment gets to ask
 * (FR-2801…FR-2806, migration 025).
 *
 * **This module is pure.** No `pg`, no clock of its own, no imports at all —
 * the same split `lib/session-rules.ts` makes from `lib/sessions.ts` and for
 * the same reason: "should this fourteen-year-old be interrupted right now" is
 * exactly the kind of decision that has to be TESTED rather than watched in
 * production, and a module that constructs a connection pool cannot be
 * unit-tested. `lib/feedback-queries.ts` is the impure half; it reads the four
 * facts below and calls `mayAsk`.
 *
 * ---------------------------------------------------------------------------
 * NON-INTRUSIVE IS A PRODUCT REQUIREMENT, NOT A STYLE NOTE
 * ---------------------------------------------------------------------------
 * A child who is asked twice stops answering, and a child who is blocked
 * resents the thing blocking her. The numbers below are chosen for the child
 * who will meet them, not for the sample size we would like to have. Every one
 * of them is argued where it is declared, because a threshold with no argument
 * is a threshold the next person raises.
 *
 * What this module does NOT decide, and cannot: whether the prompt blocks.
 * That is the surface's property — `components/student/FeedbackPrompt.tsx`
 * renders beside the flow, never over it, and the flow works identically
 * whether the prompt is answered, dismissed or ignored. No value returned from
 * here can make it modal, which is the right place for that guarantee to live.
 *
 * ---------------------------------------------------------------------------
 * THREE MOMENTS, TWO PLACES, AND WHY THAT IS NOT A CHEAT
 * ---------------------------------------------------------------------------
 * Samuel named three: the end of a session, finishing a lesson, and after a
 * long session. They are one mechanism, and the argument is about where a
 * prompt can honestly go.
 *
 * The product has exactly two natural ends — the comprehension report card
 * after a taught lesson or a revision, and the practice loop's "Session
 * complete". Those are the two places a student has stopped working and has
 * something to judge. A long sitting has no third place of its own: the only
 * way to notice one *during* the sitting is to interrupt a child who is in the
 * middle of something, which is precisely what "non-intrusive" forbids. So the
 * long session is a REASON, not a PLACE — it changes what the row records and
 * what the prompt says, and it is noticed at whichever of the two ends the
 * student reaches.
 *
 * Hence `trigger_kind` has three values and `FeedbackMoment` has two, and
 * `triggerFor` is the one place the third is derived. An operator filtering
 * `/feedback` by trigger is then asking a real question — "did the long
 * sittings feel worse than the short ones" — rather than reading a label that
 * only ever repeats which screen was on.
 */

/* ------------------------------------------------------------- vocabulary */

/**
 * Where the prompt can appear. Two, and the surfaces that mount it are the
 * only two callers: the report card and the practice summary.
 */
export const FEEDBACK_MOMENTS = ["lesson_completed", "session_ended"] as const;
export type FeedbackMoment = (typeof FEEDBACK_MOMENTS)[number];

/** What gets written to `feedback.trigger_kind` — the moment, or the reason. */
export const FEEDBACK_TRIGGERS = [
  "lesson_completed",
  "session_ended",
  "long_session",
] as const;
export type FeedbackTrigger = (typeof FEEDBACK_TRIGGERS)[number];

/** The closed rating set. `null` is a dismissal and is not a rating. */
export const FEEDBACK_RATINGS = ["up", "down"] as const;
export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number];

export function isFeedbackMoment(v: unknown): v is FeedbackMoment {
  return typeof v === "string" && (FEEDBACK_MOMENTS as readonly string[]).includes(v);
}

export function isFeedbackRating(v: unknown): v is FeedbackRating {
  return typeof v === "string" && (FEEDBACK_RATINGS as readonly string[]).includes(v);
}

export function isFeedbackTrigger(v: unknown): v is FeedbackTrigger {
  return typeof v === "string" && (FEEDBACK_TRIGGERS as readonly string[]).includes(v);
}

/* -------------------------------------------------------------- the numbers */

/**
 * **Fourteen days between one ask and the next.**
 *
 * The unit is a fortnight because a fortnight is a unit a person recognises,
 * and the arithmetic is what makes it the right one here. A pilot student
 * studies perhaps three evenings a week, so this prompt reaches her about once
 * in six sittings; across an eight-week pilot that is at most four asks, of
 * which she will answer the first one or two and ignore the rest. A weekly
 * cadence would double the count and halve the response rate, which is the
 * trade that looks like more data and is less.
 *
 * It is measured from the last time we ASKED AND GOT A RESOLUTION — a rating
 * or a dismissal — not from the last rating. A child who closed the prompt
 * said "not now", and asking her again on Thursday because Tuesday's answer
 * was not the one we wanted is the behaviour this whole module exists to avoid.
 */
export const FEEDBACK_GAP_DAYS = 14;
export const FEEDBACK_GAP_MS = FEEDBACK_GAP_DAYS * 24 * 60 * 60 * 1000;

/**
 * **Forty-five minutes of one sitting is a long session.**
 *
 * A taught lesson is estimated in the ten-to-twenty-minute band on the
 * check-in screen and the quick revision advertises three, so forty-five
 * minutes is two or three of those end to end. That is the case Samuel meant,
 * and it is the case where fatigue rather than the teaching may be what she is
 * actually rating — which is why the row says so instead of filing it beside
 * a fifteen-minute lesson.
 *
 * The number is also chosen against `SESSION_IDLE_MS` (30 minutes,
 * `lib/session-rules.ts`), and that relationship is the real argument: a
 * sitting is closed after thirty idle minutes, so a session that reaches
 * forty-five contains no thirty-minute gap and the student was genuinely
 * there for it. A threshold BELOW the idle window would have measured "how
 * long ago she started" rather than "how long she worked".
 */
export const FEEDBACK_LONG_SESSION_MINUTES = 45;
export const FEEDBACK_LONG_SESSION_MS = FEEDBACK_LONG_SESSION_MINUTES * 60 * 1000;

/**
 * **Not before a student's third finished sitting.**
 *
 * A child asked "how are we doing?" at the end of her first lesson answers
 * about that lesson — she has nothing to compare us with, and a thumb from her
 * measures whether the topic was hard. Two sittings later the question means
 * what it says. Three is the smallest number for which that is true; it is
 * also small enough that a pilot student reaches it in her first week, so the
 * rule delays the first ask rather than suppressing it.
 *
 * Counted over CLOSED sittings, so the one she is finishing right now does not
 * count itself.
 */
export const FEEDBACK_MIN_SITTINGS = 3;

/**
 * **600 characters of note.**
 *
 * Long enough for a real thing said in two or three sentences, in either
 * language — Arabic runs longer per idea than English, and a cap chosen for
 * English would quietly be a tighter cap for two of the three live courses.
 * Short enough that the box reads as a remark rather than an essay, and short
 * enough that the console prints every note IN FULL with no "…more" link,
 * because a truncated note is a note somebody decides not to expand.
 *
 * Declared here and enforced three times: this constant feeds the textarea's
 * `maxLength` (a courtesy to the typist), the endpoint's check (the gate) and
 * migration 025's CHECK constraint (the last word, which holds if either of
 * the other two is ever wrong).
 */
export const FEEDBACK_NOTE_MAX = 600;

/* ------------------------------------------------------------- the decision */

/** The sitting the prompt would be about, narrowed to what the rules read. */
export type FeedbackSitting = {
  id: number;
  openedAt: Date;
  /** `closed_at` when the sitting has ended, otherwise `last_seen_at`. */
  endedAt: Date;
};

export type MayAskInput = {
  moment: FeedbackMoment;
  /** The student's own most recent sitting, or null when she has none. */
  sitting: FeedbackSitting | null;
  /** Is there already a `feedback` row for that sitting? */
  answeredThisSitting: boolean;
  /** When she was last asked and resolved it — rating or dismissal alike. */
  lastResolvedAt: Date | null;
  /** How many of her sittings have closed. The current one is not counted. */
  closedSittings: number;
  now?: Date;
};

/**
 * Why we are not asking. Returned rather than logged, so the endpoint can put
 * it in a developer-facing field and a test can assert which rule fired
 * instead of only that something did.
 */
export type MayAskRefusal =
  | "no_sitting"
  | "already_answered"
  | "too_new"
  | "asked_recently";

export type MayAskDecision =
  | { ask: true; trigger: FeedbackTrigger; sessionRef: number }
  | { ask: false; because: MayAskRefusal };

/**
 * How long the sitting ran, in milliseconds, clamped at zero.
 *
 * `GREATEST`-shaped for the reason `closeSessionOn` is: an inactivity close is
 * stamped at `last_seen_at`, which can be earlier than `opened_at` on a
 * backdated row, and a negative duration would make a long session look like
 * an instant one.
 */
export function sittingDurationMs(s: FeedbackSitting): number {
  return Math.max(0, s.endedAt.getTime() - s.openedAt.getTime());
}

/**
 * The moment, unless the sitting ran long — in which case the length is the
 * more interesting fact and it wins.
 *
 * The precedence is one-way on purpose. `long_session` never hides WHICH
 * screen asked, because the row also carries `lesson_slug` (present for a
 * lesson, null for the practice plan) and `session_ref`; what it adds is the
 * one thing neither of those says.
 */
export function triggerFor(moment: FeedbackMoment, durationMs: number): FeedbackTrigger {
  return durationMs >= FEEDBACK_LONG_SESSION_MS ? "long_session" : moment;
}

/**
 * Whether to offer the prompt, and as which trigger.
 *
 * The rules are applied in this order, and the order is the product decision:
 * the cheapest refusals that are about THIS sitting come before the ones about
 * the student's history, so a debugging reason names the nearest cause.
 *
 *  1. **No sitting → no.** Without one there is nothing to attribute the
 *     answer to, and FR-2309's rule is that a reference we cannot establish is
 *     a gap rather than a guess. Rather than write a row with a null session,
 *     we do not ask; the student loses nothing and the record keeps its shape.
 *  2. **Already answered for this sitting → no.** The database enforces the
 *     same thing (migration 025's partial unique index), so this is the polite
 *     half of a guarantee that also has a hard half.
 *  3. **Fewer than three closed sittings → no.** See `FEEDBACK_MIN_SITTINGS`.
 *  4. **Asked within the fortnight → no.** See `FEEDBACK_GAP_DAYS`.
 *
 * Nothing here consults the rating she gave last time. Asking the students who
 * said "up" more often than the ones who said "down" is how a feedback channel
 * starts measuring itself.
 */
export function mayAsk({
  moment,
  sitting,
  answeredThisSitting,
  lastResolvedAt,
  closedSittings,
  now = new Date(),
}: MayAskInput): MayAskDecision {
  if (!sitting) return { ask: false, because: "no_sitting" };
  if (answeredThisSitting) return { ask: false, because: "already_answered" };
  if (closedSittings < FEEDBACK_MIN_SITTINGS) return { ask: false, because: "too_new" };
  if (lastResolvedAt !== null && now.getTime() - lastResolvedAt.getTime() < FEEDBACK_GAP_MS) {
    return { ask: false, because: "asked_recently" };
  }
  return {
    ask: true,
    trigger: triggerFor(moment, sittingDurationMs(sitting)),
    sessionRef: sitting.id,
  };
}

/* ------------------------------------------------------------------ the note */

/**
 * A note as it will be stored, or a refusal — the one place the note's shape
 * is decided.
 *
 * **Trimmed, then emptied.** Whitespace around a teenager's typing is not
 * content, and a note of only whitespace is a student who tapped the box and
 * left: it becomes `null`, which is the same row as "rated and said nothing"
 * rather than an empty string nobody can tell apart from one.
 *
 * **Never truncated silently.** Over the cap is a refusal the endpoint turns
 * into a 400 naming the limit, because a note cut at 600 characters mid-word
 * would be attributed to the child who did not write the cut version. The
 * textarea's `maxLength` means an ordinary typist never reaches this branch;
 * anything that does is not an ordinary typist.
 */
export type NoteResult =
  | { ok: true; note: string | null }
  | { ok: false; because: "too_long"; max: number; length: number };

export function normaliseNote(raw: unknown): NoteResult {
  if (raw === undefined || raw === null) return { ok: true, note: null };
  if (typeof raw !== "string") return { ok: true, note: null };
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, note: null };
  if (trimmed.length > FEEDBACK_NOTE_MAX) {
    return {
      ok: false,
      because: "too_long",
      max: FEEDBACK_NOTE_MAX,
      length: trimmed.length,
    };
  }
  return { ok: true, note: trimmed };
}
