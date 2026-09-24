/**
 * The per-surface reply thresholds — observed, not enforced (ADR-0023).
 *
 * The numbers are stated here by hand, NOT read back from the module: a table
 * derived from `TURN_THRESHOLDS` would pass for any `TURN_THRESHOLDS`, and the
 * point of this file is that the console counts against the same 2 / 18 / 5
 * the old cap enforced until v0.9.0.
 *
 * @covers FR-3402
 * @covers FR-3403
 * @covers FR-3405
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  THRESHOLD_SURFACES,
  TURN_THRESHOLDS,
  anyThresholdReached,
  sessionTurnLimit,
  summariseThresholds,
  thresholdChipLabel,
  thresholdOf,
  thresholdStatus,
} from "./turn-thresholds.ts";

test("the thresholds are the old caps' numbers: 2 per question, 18 per lesson, 5 per revision", () => {
  assert.deepEqual({ ...TURN_THRESHOLDS }, { student_chat: 2, lesson_learn: 18, lesson_review: 5 });
  assert.equal(thresholdOf("student_chat"), 2);
  assert.equal(thresholdOf("lesson_learn"), 18);
  assert.equal(thresholdOf("lesson_review"), 5);
});

test("Ask the Spine never had a cap and has no threshold; nor does anything unknown", () => {
  assert.equal(thresholdOf("spine_chat"), null);
  assert.equal(thresholdOf("understanding_check"), null);
  assert.equal(thresholdOf(""), null);
  // no inherited property is mistaken for a surface
  assert.equal(thresholdOf("toString"), null);
  assert.equal(thresholdOf("__proto__"), null);
  assert.ok(!THRESHOLD_SURFACES.includes("spine_chat" as never));
});

test("every surface with a threshold is listed once, and only those", () => {
  assert.deepEqual([...THRESHOLD_SURFACES].sort(), Object.keys(TURN_THRESHOLDS).sort());
  assert.equal(new Set(THRESHOLD_SURFACES).size, THRESHOLD_SURFACES.length);
});

test("reached = delivered ≥ threshold; past = delivered > threshold", () => {
  const cases: [string, number, string][] = [
    ["lesson_learn", 0, "below"],
    ["lesson_learn", 17, "below"],
    ["lesson_learn", 18, "reached"],
    ["lesson_learn", 19, "past"],
    ["lesson_learn", 40, "past"],
    ["student_chat", 1, "below"],
    ["student_chat", 2, "reached"],
    ["student_chat", 3, "past"],
    ["lesson_review", 4, "below"],
    ["lesson_review", 5, "reached"],
    ["lesson_review", 6, "past"],
  ];
  for (const [surface, delivered, want] of cases) {
    assert.equal(thresholdStatus(surface, delivered), want, `${surface} at ${delivered}`);
  }
});

test("a surface with no threshold is always below, however long the conversation", () => {
  assert.equal(thresholdStatus("spine_chat", 0), "below");
  assert.equal(thresholdStatus("spine_chat", 500), "below");
  assert.equal(thresholdStatus("lesson_learn", Number.NaN), "below");
});

test("the chip says Reached at the threshold and Past with the real count beyond it", () => {
  assert.equal(thresholdChipLabel("lesson_learn", 17), null);
  assert.equal(thresholdChipLabel("lesson_learn", 18), "Reached 18 replies");
  assert.equal(thresholdChipLabel("lesson_learn", 23), "Past 18 replies · 23");
  assert.equal(thresholdChipLabel("student_chat", 2), "Reached 2 replies");
  assert.equal(thresholdChipLabel("student_chat", 3), "Past 2 replies · 3");
  assert.equal(thresholdChipLabel("lesson_review", 5), "Reached 5 replies");
  assert.equal(thresholdChipLabel("spine_chat", 99), null);
});

test("a session's chip is its furthest conversation, and says how many reached", () => {
  assert.equal(sessionTurnLimit([]), null);
  assert.equal(sessionTurnLimit([{ surface: "lesson_learn", delivered: 12 }]), null);

  assert.deepEqual(sessionTurnLimit([{ surface: "lesson_learn", delivered: 18 }]), {
    surface: "lesson_learn",
    threshold: 18,
    delivered: 18,
    status: "reached",
    conversationsAtThreshold: 1,
  });

  // A practice sitting with three question chats: one below, one reached, one past.
  const three = sessionTurnLimit([
    { surface: "student_chat", delivered: 1 },
    { surface: "student_chat", delivered: 2 },
    { surface: "student_chat", delivered: 4 },
  ]);
  assert.deepEqual(three, {
    surface: "student_chat",
    threshold: 2,
    delivered: 4,
    status: "past",
    conversationsAtThreshold: 2,
  });

  // Past beats reached whatever the raw numbers are.
  const mixed = sessionTurnLimit([
    { surface: "lesson_learn", delivered: 18 },
    { surface: "student_chat", delivered: 3 },
  ]);
  assert.equal(mixed?.status, "past");
  assert.equal(mixed?.surface, "student_chat");

  // Among two past, the one further past its threshold speaks.
  const twoPast = sessionTurnLimit([
    { surface: "lesson_learn", delivered: 20 },
    { surface: "student_chat", delivered: 6 },
  ]);
  assert.equal(twoPast?.surface, "student_chat");
  assert.equal(twoPast?.delivered, 6);

  // Conversations on a surface with no threshold never produce a chip.
  assert.equal(sessionTurnLimit([{ surface: "spine_chat", delivered: 50 }]), null);
});

test("the histogram folds into one row per threshold surface, zeros included", () => {
  const rows = summariseThresholds([
    { surface: "lesson_learn", delivered: 6, conversations: 3 },
    { surface: "lesson_learn", delivered: 18, conversations: 2 },
    { surface: "lesson_learn", delivered: 23, conversations: 1 },
    { surface: "student_chat", delivered: 1, conversations: 7 },
    { surface: "student_chat", delivered: 2, conversations: 4 },
    // spine_chat is not a threshold surface and must not appear or be counted
    { surface: "spine_chat", delivered: 90, conversations: 5 },
  ]);
  assert.deepEqual(
    rows.map((r) => r.surface),
    ["lesson_learn", "lesson_review", "student_chat"]
  );
  const [learn, review, chat] = rows;
  assert.deepEqual(learn, {
    surface: "lesson_learn",
    threshold: 18,
    conversations: 6,
    reached: 3,
    past: 1,
    highest: 23,
  });
  assert.deepEqual(review, {
    surface: "lesson_review",
    threshold: 5,
    conversations: 0,
    reached: 0,
    past: 0,
    highest: 0,
  });
  assert.deepEqual(chat, {
    surface: "student_chat",
    threshold: 2,
    conversations: 11,
    reached: 4,
    past: 0,
    highest: 2,
  });
  assert.equal(anyThresholdReached(rows), true);
});

test("nothing reached means no attention state", () => {
  const rows = summariseThresholds([{ surface: "lesson_learn", delivered: 17, conversations: 9 }]);
  assert.equal(anyThresholdReached(rows), false);
  assert.equal(anyThresholdReached(summariseThresholds([])), false);
});

test("the module is pure: the lesson surface imports it, so it may import nothing", () => {
  const src = readFileSync(fileURLToPath(new URL("./turn-thresholds.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(src, /^\s*import\s/m, "turn-thresholds.ts must stay import-free");
});
