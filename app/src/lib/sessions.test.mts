/**
 * @covers FR-2301, FR-2302, FR-2309
 *
 * The session lifecycle rules (contracts/sessions.md), tested where they are
 * decidable. lib/sessions.ts itself opens a connection pool, so — as with
 * demo-student.ts — the decisions live in lib/session-rules.ts and the SQL is
 * only how they are applied. Each test below exists because getting it wrong
 * would be invisible in normal use and would put a wrong answer in an audit
 * surface, which is worse than no answer at all.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  SESSION_IDLE_MS,
  attributableSessionId,
  endedEventProperties,
  idleCutoff,
  isIdle,
  planForRequest,
  type OpenSession,
} from "./session-rules.ts";

const NOW = new Date("2026-09-20T18:00:00Z");
const open = (over: Partial<OpenSession> = {}): OpenSession => ({
  id: 7,
  kind: "lesson_learn",
  lastSeenAt: NOW,
  ...over,
});
const agoMs = (ms: number) => new Date(NOW.getTime() - ms);

// FR-2302 — the window is stated, not discovered.
test("the inactivity window is 30 minutes, and the cutoff is that far back", () => {
  assert.equal(SESSION_IDLE_MS, 30 * 60 * 1000);
  assert.equal(idleCutoff(NOW).getTime(), NOW.getTime() - SESSION_IDLE_MS);
});

test("staleness turns over exactly at the window, not around it", () => {
  assert.equal(isIdle(agoMs(SESSION_IDLE_MS - 1000), NOW), false, "29m59s is still live");
  assert.equal(isIdle(agoMs(SESSION_IDLE_MS), NOW), true, "30m00s is idle");
  assert.equal(isIdle(agoMs(SESSION_IDLE_MS + 1000), NOW), true);
});

// FR-2301 — exactly one session, so every request resolves to exactly one plan.
test("with nothing open, the only move is to open one", () => {
  assert.deepEqual(planForRequest(null, "practice", NOW), { action: "open" });
});

test("the same kind, still warm, is the same sitting", () => {
  assert.deepEqual(planForRequest(open({ lastSeenAt: agoMs(60_000) }), "lesson_learn", NOW), {
    action: "reuse",
    sessionId: 7,
  });
});

test("a different kind supersedes: the previous session closes first", () => {
  assert.deepEqual(planForRequest(open(), "student_chat", NOW), {
    action: "close-then-open",
    sessionId: 7,
    reason: "superseded",
  });
});

test("an attempt inside a lesson joins it rather than superseding it", () => {
  // /api/attempts sends nothing new from the client, so `practice` means "what
  // to open if nothing is open". An answered question mid-lesson that closed
  // the lesson would end the sitting the student is still in.
  assert.deepEqual(planForRequest(open(), "practice", NOW, true), {
    action: "reuse",
    sessionId: 7,
  });
});

test("inactivity outranks supersession, so the two closes stay distinguishable", () => {
  const stale = open({ lastSeenAt: agoMs(SESSION_IDLE_MS + 60_000) });
  for (const [kind, adopt] of [
    ["lesson_learn", false],
    ["student_chat", false],
    ["practice", true],
  ] as const) {
    assert.deepEqual(
      planForRequest(stale, kind, NOW, adopt),
      { action: "close-then-open", sessionId: 7, reason: "inactivity" },
      `a sitting that had already timed out must not be reported as ${kind === "lesson_learn" ? "reused" : "superseded"}`
    );
  }
});

// FR-2302 — a close says which kind of ending it was, and how long it lasted.
test("an ended session reports its reason and a non-negative duration", () => {
  const props = endedEventProperties(
    {
      id: 7,
      studentId: 1,
      kind: "lesson_learn",
      openedAt: agoMs(20 * 60_000),
      closedAt: NOW,
    },
    "completed"
  );
  assert.deepEqual(props, {
    session_id: 7,
    kind: "lesson_learn",
    close_reason: "completed",
    duration_ms: 20 * 60_000,
  });
});

test("closing is idempotent: nothing closed means no second ending is reported", () => {
  assert.equal(endedEventProperties(null, "completed"), null);
  assert.equal(endedEventProperties(null, "inactivity"), null);
});

test("a clock that went backwards yields 0, never a negative sitting", () => {
  const props = endedEventProperties(
    { id: 7, studentId: 1, kind: "practice", openedAt: NOW, closedAt: agoMs(5_000) },
    "abandoned"
  );
  assert.equal(props?.duration_ms, 0);
});

// FR-2309 — no session is NULL, and there is no guess to fall back on.
test("an unattributable interaction resolves to NULL, never to a number", () => {
  for (const bad of [null, undefined, 0, -1, 1.5, NaN, "7", new Date(), {}]) {
    assert.equal(
      attributableSessionId(bad),
      null,
      `${String(bad)} must produce a gap, not an attribution`
    );
  }
  assert.equal(attributableSessionId(7), 7);
});
