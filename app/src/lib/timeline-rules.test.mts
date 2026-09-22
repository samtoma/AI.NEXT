/**
 * @covers FR-2303
 * @covers FR-2309
 *
 * The timeline's merge rules (ADR-0015 §2, contracts/admin.md §4).
 *
 * Every case here is one an operator would never notice was wrong. A timeline
 * that interleaves seven sources plausibly but incorrectly still reads like a
 * transcript: the tutor turn appears, the answer appears, the mastery move
 * appears — and the story they tell is the wrong way round. That is the class
 * of defect this file exists for, which is why the assertions are about ORDER
 * and REACHABILITY rather than about counts.
 *
 * `lib/timeline.ts` holds the SQL and is not tested here: it opens a pool.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  GAP_THRESHOLD_MS,
  buildTimeline,
  humanDuration,
  insertGaps,
  orderTimeline,
  reachableExplanations,
  sessionWallClockMs,
  type AttemptItem,
  type ExplanationItem,
  type MasteryItem,
  type SourceItem,
  type TurnItem,
  type UploadItem,
} from "./timeline-rules.ts";

const T = (s: string) => `2026-09-20T14:${s}Z`;

const turn = (at: string, id = 1): TurnItem => ({
  kind: "turn",
  key: `turn:${id}`,
  at,
  interactionId: id,
  surface: "lesson_learn",
  surfaceKind: "chat",
  turnIndex: 1,
  userMessage: "why is it minus?",
  assistantMessage: "because the sign travels with the term",
  citations: [],
  model: "claude-sonnet-4-5",
  inputTokens: 100,
  outputTokens: 40,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  costUsd: 0.0012,
  latencyMs: 1800,
  outcome: "ok",
  rendererVersion: "PDR1-0-v0.4.0",
});

const attempt = (at: string, id = 1, over: Partial<AttemptItem> = {}): AttemptItem => ({
  kind: "attempt",
  key: `attempt:${id}`,
  at,
  attemptId: id,
  questionId: "q-1",
  questionStem: "Solve 2x + 3 = 11",
  questionType: "numeric",
  widgetSpec: null,
  loId: "lo-1",
  loLabel: "Linear equations",
  givenAnswer: "4",
  correctAnswer: "4",
  isCorrect: true,
  timeMs: 9000,
  modality: "question",
  misconceptionId: null,
  misconceptionLabel: null,
  ...over,
});

const mastery = (at: string, id = 1): MasteryItem => ({
  kind: "mastery",
  key: `mastery:${id}`,
  at,
  masteryId: id,
  loId: "lo-1",
  loLabel: "Linear equations",
  priorScore: 0.3,
  posteriorScore: 0.46,
  evidence: { attempt_id: 1 },
});

const upload = (at: string, id = 1): UploadItem => ({
  kind: "upload",
  key: `upload:${id}`,
  at,
  uploadId: id,
  fileType: "image/jpeg",
  storagePath: "uploads/1.jpg",
  parseStatus: "parsed",
  parsedText: "Exercise 4b",
  linkedLoId: null,
});

const explanation = (at: string, id: number, attemptId: number): ExplanationItem => ({
  kind: "explanation",
  key: `explanation:${id}`,
  at,
  explanationId: id,
  attemptId,
  questionId: "q-1",
  model: "claude-sonnet-4-5",
  promptVersion: "v3",
  groundedOk: true,
  cached: false,
});

const keys = (items: readonly { key: string }[]) => items.map((i) => i.key);

/* ---------------------------------------------------------------- ordering */

test("sources interleave by time, not by source", () => {
  // The defect this catches: rendering six lists one after another and calling
  // it a timeline. Shuffled input, one time order out.
  const ordered = orderTimeline([
    mastery(T("05:10")),
    turn(T("00:00"), 1),
    attempt(T("05:00")),
    upload(T("02:30")),
    turn(T("04:00"), 2),
  ]);
  assert.deepEqual(keys(ordered), [
    "turn:1",
    "upload:1",
    "turn:2",
    "attempt:1",
    "mastery:1",
  ]);
});

test("equal timestamps order cause before consequence", () => {
  // A turn, its attempt, its explanation and the mastery move it caused all
  // land on the same second regularly — different statements, different
  // transactions, one clock tick. Sorting by time alone leaves that to chance.
  const at = T("07:00");
  const ordered = orderTimeline([
    mastery(at),
    explanation(at, 9, 1),
    attempt(at),
    turn(at, 3),
    upload(at),
  ]);
  assert.deepEqual(keys(ordered), [
    "upload:1",
    "turn:3",
    "attempt:1",
    "explanation:9",
    "mastery:1",
  ]);
});

test("a widget outcome is an attempt and is not tie-broken away from one", () => {
  // ADR-0009: a widget IS a question. If widgets carried their own rank, two
  // answers given in the same second would separate into two blocks and read
  // as two episodes.
  const at = T("08:00");
  const ordered = orderTimeline([
    attempt(at, 2, { kind: "widget", key: "widget:2", modality: "widget" }),
    attempt(at, 1),
  ]);
  assert.deepEqual(keys(ordered), ["attempt:1", "widget:2"]);
});

test("the order is stable: the same set in any input order comes out the same", () => {
  const items: SourceItem[] = [
    turn(T("01:00"), 1),
    attempt(T("01:00")),
    mastery(T("01:00")),
    turn(T("01:00"), 2),
  ];
  const forwards = keys(orderTimeline(items));
  const backwards = keys(orderTimeline([...items].reverse()));
  assert.deepEqual(forwards, backwards, "two renders of one session must not differ");
});

test("a row with an unreadable timestamp sorts last, not to 1970", () => {
  const broken = { ...turn("not a date", 9), key: "turn:9" };
  const ordered = orderTimeline([broken, turn(T("03:00"), 1)]);
  assert.deepEqual(keys(ordered), ["turn:1", "turn:9"]);
});

/* -------------------------------------------------------------------- gaps */

test("a pause longer than the threshold becomes an item; a short one does not", () => {
  const ordered = orderTimeline([
    turn(T("00:00"), 1),
    turn(T("00:30"), 2), // 30 s — reading time
    turn(T("09:30"), 3), // 9 min — evidence
  ]);
  const withGaps = insertGaps(ordered);
  assert.deepEqual(keys(withGaps), ["turn:1", "turn:2", "gap:turn:2", "turn:3"]);
  const gap = withGaps[2];
  assert.equal(gap.kind, "gap");
  assert.equal(gap.kind === "gap" && gap.ms, 9 * 60_000);
  assert.equal(gap.kind === "gap" && gap.afterKey, "turn:2");
  assert.equal(gap.at, T("09:30"), "a gap is stamped where the pause ended");
});

test("exactly the threshold is not a gap; one millisecond more is", () => {
  const base = new Date(T("00:00")).getTime();
  const iso = (offset: number) => new Date(base + offset).toISOString();
  const exact = insertGaps(orderTimeline([turn(iso(0), 1), turn(iso(GAP_THRESHOLD_MS), 2)]));
  assert.equal(exact.length, 2, "a pause OF the threshold is still reading time");
  const over = insertGaps(orderTimeline([turn(iso(0), 1), turn(iso(GAP_THRESHOLD_MS + 1), 2)]));
  assert.equal(over.length, 3);
});

test("no gap is inserted before the first item", () => {
  // The distance from the session opening to its first interaction belongs to
  // the session header; a leading gap row would count it twice.
  const out = insertGaps(orderTimeline([turn(T("30:00"), 1)]));
  assert.deepEqual(keys(out), ["turn:1"]);
});

/* ------------------------------------------------------ explanation_log */

test("an explanation reaches the timeline only through its attempt", () => {
  const { kept, unreachable } = reachableExplanations(
    [explanation(T("06:00"), 1, 1), explanation(T("06:01"), 2, 99)],
    new Set([1])
  );
  assert.deepEqual(keys(kept), ["explanation:1"]);
  assert.equal(unreachable, 1);
});

test("buildTimeline drops an orphan explanation and reports how many", () => {
  // explanation_log has no student_id (ADR-0015 Consequences). An orphan is
  // not attributable to anybody, so it must not appear in somebody's record —
  // and the count is surfaced so the absence is not later filed as a merge bug.
  const built = buildTimeline([
    attempt(T("05:00"), 1),
    explanation(T("05:05"), 1, 1),
    explanation(T("05:06"), 2, 4242),
  ]);
  assert.deepEqual(keys(built.items), ["attempt:1", "explanation:1"]);
  assert.equal(built.unreachableExplanations, 1);
  assert.equal(built.counts.explanation, 1);
});

test("counts cover the sources and never the gaps", () => {
  const built = buildTimeline([
    turn(T("00:00"), 1),
    turn(T("20:00"), 2),
    attempt(T("20:01")),
    mastery(T("20:02")),
  ]);
  assert.ok(
    built.items.some((i) => i.kind === "gap"),
    "a twenty-minute pause should be rendered"
  );
  assert.deepEqual(built.counts, {
    turn: 2,
    attempt: 1,
    widget: 0,
    understanding: 0,
    upload: 0,
    mastery: 1,
    explanation: 0,
  });
});

/* --------------------------------------------------------------- durations */

test("a duration carries its unit and a missing one is null, never zero", () => {
  assert.equal(humanDuration(9_000), "9 s");
  assert.equal(humanDuration(90_000), "1 min 30 s");
  assert.equal(humanDuration(120_000), "2 min");
  assert.equal(humanDuration(3_600_000), "1 h");
  assert.equal(humanDuration(5_400_000), "1 h 30 min");
  assert.equal(humanDuration(null), null, "not recorded is not the same claim as 0 s");
  assert.equal(humanDuration(undefined), null);
  assert.equal(humanDuration(-1), null);
});

test("wall clock is null while the session is open, never a running total", () => {
  assert.equal(sessionWallClockMs(T("00:00"), null), null);
  assert.equal(sessionWallClockMs(T("00:00"), T("10:00")), 10 * 60_000);
  assert.equal(sessionWallClockMs(T("10:00"), T("00:00")), null, "a negative span is a defect");
});
