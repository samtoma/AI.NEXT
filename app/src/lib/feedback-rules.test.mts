/**
 * The cadence, as arithmetic (FR-2803…FR-2806).
 *
 * @covers FR-2803
 * @covers FR-2804
 * @covers FR-2805
 * @covers FR-2806
 *
 * Every assertion below is about a child being interrupted or not, and the
 * numbers are the product decision rather than an implementation detail — so
 * the boundaries are asserted on both sides, not only in the middle. A rule
 * tested at "obviously yes" and "obviously no" is a rule whose threshold could
 * move by a factor of ten without a test noticing.
 *
 * Pure: no database, no Next, no clock. `node --test` and nothing else, the
 * same shape `session-rules`' tests take inside `sessions.test.mts`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FEEDBACK_GAP_DAYS,
  FEEDBACK_GAP_MS,
  FEEDBACK_LONG_SESSION_MINUTES,
  FEEDBACK_LONG_SESSION_MS,
  FEEDBACK_MIN_SITTINGS,
  FEEDBACK_NOTE_MAX,
  isFeedbackMoment,
  isFeedbackRating,
  isFeedbackTrigger,
  mayAsk,
  normaliseNote,
  sittingDurationMs,
  triggerFor,
  type FeedbackSitting,
  type MayAskInput,
} from "./feedback-rules.ts";

const NOW = new Date("2026-09-22T19:00:00.000Z");
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** A sitting that ran `minutes` and ended ten minutes ago. */
function sitting(minutes: number, id = 501): FeedbackSitting {
  const endedAt = new Date(NOW.getTime() - 10 * MINUTE);
  return { id, openedAt: new Date(endedAt.getTime() - minutes * MINUTE), endedAt };
}

/** The "everything is fine, please ask" case, which each test perturbs. */
function ok(patch: Partial<MayAskInput> = {}): MayAskInput {
  return {
    moment: "lesson_completed",
    sitting: sitting(15),
    answeredThisSitting: false,
    lastResolvedAt: null,
    closedSittings: FEEDBACK_MIN_SITTINGS,
    now: NOW,
    ...patch,
  };
}

/* ------------------------------------------------------- the numbers hold */

test("the constants say what the product decided, and nothing has drifted", () => {
  // These four numbers are argued at length where they are declared and are
  // quoted to operators on `/feedback`. Asserting them is not tautology: it is
  // what makes changing one a deliberate act with a diff, rather than a tweak.
  assert.equal(FEEDBACK_GAP_DAYS, 14, "a fortnight between asks");
  assert.equal(FEEDBACK_GAP_MS, 14 * DAY);
  assert.equal(FEEDBACK_LONG_SESSION_MINUTES, 45);
  assert.equal(FEEDBACK_LONG_SESSION_MS, 45 * MINUTE);
  assert.equal(FEEDBACK_MIN_SITTINGS, 3);
  assert.equal(FEEDBACK_NOTE_MAX, 600);
});

test("the long-session threshold is longer than the idle window, which is the argument for it", () => {
  // `SESSION_IDLE_MS` is 30 minutes (`lib/session-rules.ts`): a sitting closes
  // after half an hour of nothing. So a sitting that reaches the long-session
  // threshold contains no thirty-minute gap and the student was genuinely
  // there for it. Restated here rather than imported, because importing
  // `session-rules` to check a number would couple the two modules for a fact
  // that is about the RELATIONSHIP between them.
  const SESSION_IDLE_MINUTES = 30;
  assert.ok(
    FEEDBACK_LONG_SESSION_MINUTES > SESSION_IDLE_MINUTES,
    "a long-session threshold below the idle window would measure how long ago she " +
      "started, not how long she worked"
  );
});

/* ------------------------------------------------------------ vocabulary */

test("the closed sets refuse everything outside them", () => {
  assert.equal(isFeedbackMoment("lesson_completed"), true);
  assert.equal(isFeedbackMoment("session_ended"), true);
  // `long_session` is a TRIGGER, never a moment: it is a reason, not a place,
  // and a client naming it would be claiming to know how long the sitting ran.
  assert.equal(isFeedbackMoment("long_session"), false);
  assert.equal(isFeedbackMoment(""), false);
  assert.equal(isFeedbackMoment(null), false);
  assert.equal(isFeedbackMoment(3), false);

  assert.equal(isFeedbackRating("up"), true);
  assert.equal(isFeedbackRating("down"), true);
  // A dismissal is `rating IS NULL` in the row and `dismiss: true` on the
  // wire. It is deliberately not a third rating — see migration 025.
  assert.equal(isFeedbackRating("dismissed"), false);
  assert.equal(isFeedbackRating(null), false);

  assert.equal(isFeedbackTrigger("long_session"), true);
  assert.equal(isFeedbackTrigger("nagged"), false);
});

/* --------------------------------------------------------- the precedence */

test("a long sitting outranks the moment that asked, at the minute", () => {
  assert.equal(triggerFor("lesson_completed", FEEDBACK_LONG_SESSION_MS - 1), "lesson_completed");
  assert.equal(triggerFor("lesson_completed", FEEDBACK_LONG_SESSION_MS), "long_session");
  assert.equal(triggerFor("session_ended", FEEDBACK_LONG_SESSION_MS), "long_session");
  assert.equal(triggerFor("session_ended", 0), "session_ended");
});

test("a sitting whose end predates its start counts as zero, never as negative", () => {
  // An inactivity close is stamped at `last_seen_at`, which a backdated row can
  // put before `opened_at` (`closeSessionOn` guards the same case with
  // GREATEST). Without the clamp a long session would read as an instant one
  // — and worse, an instant one as a long one if the sign ever flipped.
  const backwards: FeedbackSitting = {
    id: 1,
    openedAt: new Date(NOW.getTime()),
    endedAt: new Date(NOW.getTime() - 60 * MINUTE),
  };
  assert.equal(sittingDurationMs(backwards), 0);
  assert.equal(triggerFor("lesson_completed", sittingDurationMs(backwards)), "lesson_completed");
});

/* ------------------------------------------------------------- the asking */

test("the ordinary case asks, and says which sitting it is about", () => {
  const d = mayAsk(ok());
  assert.deepEqual(d, { ask: true, trigger: "lesson_completed", sessionRef: 501 });
});

test("a 46-minute lesson is recorded as a long session, not as a lesson", () => {
  const d = mayAsk(ok({ sitting: sitting(46, 77) }));
  assert.deepEqual(d, { ask: true, trigger: "long_session", sessionRef: 77 });
});

test("no sitting means no prompt — a gap, never a guess", () => {
  // FR-2309's rule, applied to this feature: there is nothing to attach the
  // answer to, so nothing is asked. It is the ONE refusal that is not a policy.
  assert.deepEqual(mayAsk(ok({ sitting: null })), { ask: false, because: "no_sitting" });
});

test("she is never asked twice about the same sitting", () => {
  assert.deepEqual(mayAsk(ok({ answeredThisSitting: true })), {
    ask: false,
    because: "already_answered",
  });
});

test("a child who has barely started is not asked how we are doing", () => {
  // She would be rating the lesson she just had, because she has nothing to
  // compare us with. The boundary is asserted on both sides.
  for (let n = 0; n < FEEDBACK_MIN_SITTINGS; n++) {
    assert.deepEqual(
      mayAsk(ok({ closedSittings: n })),
      { ask: false, because: "too_new" },
      `${n} finished sittings should be too new`
    );
  }
  assert.equal(mayAsk(ok({ closedSittings: FEEDBACK_MIN_SITTINGS })).ask, true);
});

test("the fortnight is measured to the millisecond, from either kind of answer", () => {
  const justInside = new Date(NOW.getTime() - FEEDBACK_GAP_MS + 1);
  const exactly = new Date(NOW.getTime() - FEEDBACK_GAP_MS);
  assert.deepEqual(mayAsk(ok({ lastResolvedAt: justInside })), {
    ask: false,
    because: "asked_recently",
  });
  assert.equal(
    mayAsk(ok({ lastResolvedAt: exactly })).ask,
    true,
    "exactly a fortnight later is a fortnight later"
  );
});

test("a dismissal silences the prompt exactly as long as an answer does", () => {
  // The input does not distinguish them, and that IS the rule: `lastResolvedAt`
  // is the last time she was asked and resolved it either way. Asking her again
  // on Thursday because Tuesday's answer was a "not now" is the behaviour this
  // whole module exists to prevent, and it would be one `if` away.
  const twoDaysAgo = new Date(NOW.getTime() - 2 * DAY);
  assert.deepEqual(mayAsk(ok({ lastResolvedAt: twoDaysAgo })), {
    ask: false,
    because: "asked_recently",
  });
});

test("the refusals are ordered nearest-cause-first", () => {
  // A student who is brand new AND answered this sitting AND was asked
  // yesterday gets `already_answered`, because that is the fact about the
  // sitting in front of her. The order is a debugging property: the reason
  // returned should be the one a person would name.
  const d = mayAsk(
    ok({
      answeredThisSitting: true,
      closedSittings: 0,
      lastResolvedAt: new Date(NOW.getTime() - DAY),
    })
  );
  assert.deepEqual(d, { ask: false, because: "already_answered" });

  // …and with no sitting at all, that outranks everything, because the others
  // are policies and this one is an absence.
  assert.deepEqual(
    mayAsk(ok({ sitting: null, answeredThisSitting: true, closedSittings: 0 })),
    { ask: false, because: "no_sitting" }
  );
});

test("nothing in the decision reads what she said last time", () => {
  // There is deliberately no input for it. Asking the students who said "up"
  // more often than the ones who said "down" is how a feedback channel starts
  // measuring itself — asserted here as the absence of a field, because that
  // is the only way to assert an absence.
  const keys = Object.keys(ok()).sort();
  assert.deepEqual(keys, [
    "answeredThisSitting",
    "closedSittings",
    "lastResolvedAt",
    "moment",
    "now",
    "sitting",
  ]);
});

/* ---------------------------------------------------------------- the note */

test("whitespace is not content, and an empty note is the same row as no note", () => {
  assert.deepEqual(normaliseNote(undefined), { ok: true, note: null });
  assert.deepEqual(normaliseNote(null), { ok: true, note: null });
  assert.deepEqual(normaliseNote(""), { ok: true, note: null });
  assert.deepEqual(normaliseNote("   \n\t "), { ok: true, note: null });
  assert.deepEqual(normaliseNote("  it helped  "), { ok: true, note: "it helped" });
});

test("a non-string body field is not a note and is not an error", () => {
  // The endpoint already refuses a malformed body; this is the case where the
  // field is simply absent-shaped. Turning it into a 400 would fail a student
  // whose rating is perfectly good.
  assert.deepEqual(normaliseNote(42), { ok: true, note: null });
  assert.deepEqual(normaliseNote({ text: "hi" }), { ok: true, note: null });
});

test("an over-long note is refused, never truncated", () => {
  // A note cut at the cap mid-word would be stored as something the child did
  // not write, and attributed to her. The boundary is asserted on both sides.
  const atCap = "x".repeat(FEEDBACK_NOTE_MAX);
  assert.deepEqual(normaliseNote(atCap), { ok: true, note: atCap });

  const over = "x".repeat(FEEDBACK_NOTE_MAX + 1);
  assert.deepEqual(normaliseNote(over), {
    ok: false,
    because: "too_long",
    max: FEEDBACK_NOTE_MAX,
    length: FEEDBACK_NOTE_MAX + 1,
  });
});

test("the cap is counted after trimming, so trailing blank lines never cost a child her note", () => {
  const padded = `  ${"x".repeat(FEEDBACK_NOTE_MAX)}\n\n  `;
  assert.equal(normaliseNote(padded).ok, true);
});

test("an Arabic note of ordinary length fits comfortably inside the cap", () => {
  // The cap was chosen against Arabic rather than English — Arabic runs longer
  // per idea, and a cap chosen for English would quietly be a tighter cap for
  // two of the three live courses. This is that claim, checked rather than
  // asserted in prose.
  const arabic =
    "الدرس كان حلو بس الجزء بتاع المعادلات كان صعب شوية وكنت محتاج أمثلة أكتر عشان أفهمه كويس.";
  assert.ok(arabic.length < FEEDBACK_NOTE_MAX / 3, `an ordinary Arabic remark is ${arabic.length}`);
  assert.deepEqual(normaliseNote(arabic), { ok: true, note: arabic });
});
