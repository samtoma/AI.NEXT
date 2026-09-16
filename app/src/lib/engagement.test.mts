/**
 * Engagement signal — the half of FR-207 that did not exist.
 *
 * @covers FR-207
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classify,
  engagementBlock,
  MIN_OBSERVATIONS,
  RUSH_MS,
  LABOUR_MS,
  AWAY_HOURS,
  observationsFrom,
  type AttemptRow,
  type EngagementObservations,
} from "./engagement.ts";

/** Fixed clock so the absence tests do not depend on wall time. */
const NOW = Date.UTC(2026, 8, 13, 12, 0, 0);

const obs = (o: Partial<EngagementObservations> = {}): EngagementObservations => ({
  n: 8,
  correct: 4,
  wrongStreak: 0,
  medianTimeMs: 20_000,
  fastWrong: 0,
  hoursSinceLast: 1,
  ...o,
});

test("below the observation floor there is no signal at all", () => {
  assert.equal(classify(obs({ n: MIN_OBSERVATIONS - 1 })), "no_signal");
  // ...even when the little evidence there is looks alarming
  assert.equal(
    classify(obs({ n: 2, wrongStreak: 2, fastWrong: 2 })),
    "no_signal"
  );
});

test("a signal starts exactly at the floor, not after it", () => {
  assert.notEqual(classify(obs({ n: MIN_OBSERVATIONS })), "no_signal");
});

test("someone back after days away is 'returning', not 'struggling'", () => {
  // The whole point of checking absence first: a cold streak after a gap is
  // the SAME evidence as a struggle, and the wrong read is the harmful one.
  assert.equal(
    classify(obs({ hoursSinceLast: AWAY_HOURS + 1, wrongStreak: 5, fastWrong: 4 })),
    "returning"
  );
});

test("a gap just under the threshold is not yet 'returning'", () => {
  assert.equal(classify(obs({ hoursSinceLast: AWAY_HOURS - 1 })), "steady");
});

test("fast wrong answers read as rushing, and rushing outranks struggling", () => {
  // Both are true of this student. Telling someone who is trying hard to slow
  // down reads as a reprimand, so the guessing read must win only when the
  // timings actually support it.
  assert.equal(classify(obs({ fastWrong: 3, wrongStreak: 4 })), "rushing");
});

test("two fast wrong answers are not yet rushing", () => {
  assert.equal(classify(obs({ fastWrong: 2, wrongStreak: 0 })), "steady");
});

test("a wrong streak with ordinary timings is struggling", () => {
  assert.equal(classify(obs({ wrongStreak: 3, fastWrong: 0 })), "struggling");
});

test("slow answers read as labouring", () => {
  assert.equal(
    classify(obs({ medianTimeMs: LABOUR_MS + 1, wrongStreak: 0 })),
    "labouring"
  );
});

test("a missing median never classifies as labouring", () => {
  // time_ms is nullable. Absent timings must not be read as slow.
  assert.equal(classify(obs({ medianTimeMs: null })), "steady");
});

test("working steadily is a state, not the absence of one", () => {
  assert.equal(classify(obs({ wrongStreak: 1, correct: 7 })), "steady");
});

test("no signal renders nothing, keeping the prompt byte-identical", () => {
  assert.equal(engagementBlock(null), "");
  assert.equal(
    engagementBlock({ state: "no_signal", observations: obs({ n: 1 }) }),
    ""
  );
});

test("every state that renders carries a stance", () => {
  for (const state of [
    "returning",
    "rushing",
    "struggling",
    "labouring",
    "steady",
  ] as const) {
    const out = engagementBlock({ state, observations: obs() });
    assert.ok(out.length > 0, `${state} rendered nothing`);
    assert.match(out, /ENGAGEMENT/);
  }
});

test("the block forbids repeating it to the student", () => {
  // PRD §8: the student must never feel reported on. If this guard is ever
  // dropped, the tutor can narrate the surveillance back at the child.
  const out = engagementBlock({ state: "struggling", observations: obs() });
  assert.match(out, /Never tell the student/i);
  assert.match(out, /never mention being timed or tracked/i);
});

test("the block never states a bare label the model could echo", () => {
  // "struggling" as a word must not appear — the block carries what to DO.
  const out = engagementBlock({ state: "struggling", observations: obs() });
  assert.ok(
    !/\bstruggling\b/i.test(out),
    "the raw state name leaked into the prompt"
  );
});

test("the rush threshold is below the labour threshold", () => {
  // Guard against an edit that makes both branches unreachable.
  assert.ok(RUSH_MS < LABOUR_MS);
});

test("no rows means no observations, not zeroed ones", () => {
  // A zeroed reading would classify as 'no_signal' anyway, but returning null
  // keeps "we have never seen this student" distinct from "we saw nothing".
  assert.equal(observationsFrom([]), null);
});

test("the wrong streak counts back from the most recent answer only", () => {
  const rows: AttemptRow[] = [
    { is_correct: false, time_ms: 20_000, attempted_at: NOW },
    { is_correct: false, time_ms: 20_000, attempted_at: NOW },
    { is_correct: true, time_ms: 20_000, attempted_at: NOW },
    { is_correct: false, time_ms: 20_000, attempted_at: NOW },
  ];
  const o = observationsFrom(rows, NOW)!;
  assert.equal(o.wrongStreak, 2, "the older wrong answer is behind a correct one");
  assert.equal(o.correct, 1);
  assert.equal(o.n, 4);
});

test("null timings are excluded from the median rather than counted as zero", () => {
  // time_ms is nullable. Treating null as 0 would read every such student as
  // rushing — the most damaging possible misread.
  const rows: AttemptRow[] = [
    { is_correct: true, time_ms: null, attempted_at: NOW },
    { is_correct: true, time_ms: null, attempted_at: NOW },
    { is_correct: true, time_ms: 30_000, attempted_at: NOW },
  ];
  const o = observationsFrom(rows, NOW)!;
  assert.equal(o.medianTimeMs, 30_000);
  assert.equal(o.fastWrong, 0);
});

test("a fast but CORRECT answer is never counted as rushing", () => {
  const rows: AttemptRow[] = Array.from({ length: 6 }, () => ({
    is_correct: true,
    time_ms: 1_000,
    attempted_at: NOW,
  }));
  const o = observationsFrom(rows, NOW)!;
  assert.equal(o.fastWrong, 0);
  assert.equal(classify(o), "steady");
});

test("hours since last is measured from the newest row", () => {
  const rows: AttemptRow[] = [
    { is_correct: true, time_ms: 1_000, attempted_at: new Date(NOW - 2 * 3_600_000) },
    { is_correct: true, time_ms: 1_000, attempted_at: new Date(NOW - 99 * 3_600_000) },
  ];
  const o = observationsFrom(rows, NOW)!;
  assert.ok(Math.abs(o.hoursSinceLast! - 2) < 0.001);
});

test("an unparseable timestamp yields null rather than NaN hours", () => {
  const o = observationsFrom(
    [{ is_correct: true, time_ms: 1_000, attempted_at: "not a date" }],
    NOW
  )!;
  assert.equal(o.hoursSinceLast, null);
  // and must not classify as 'returning' on the strength of a NaN
  assert.notEqual(classify({ ...o, n: 8 }), "returning");
});
