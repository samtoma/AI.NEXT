/**
 * The Stop button's pure logic: how an interrupted turn is recorded, and what
 * of its reply the student keeps.
 *
 * The defect this guards: a client abort killed the model process and the
 * close handler then filed the dead process as `error`, so every Stop counted
 * against the console's runtime-health signal (FR-3006). And on the client the
 * paced reveal (FR-3501) can be behind the stream, so "keep the partial reply"
 * must mean "keep what was revealed", not "keep what arrived".
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  STOPPED_BEFORE_REPLY,
  endedTurnOutcome,
  stopControlLabel,
  stoppedAssistantMessage,
  stoppedLabel,
  stoppedReply,
} from "./stop-turn.ts";
import { FAILING_OUTCOMES } from "./runtime-health.ts";
import { OUTCOMES, isOutcome } from "./pricing.ts";
import { cancelRun, homeworkRunKey, registerRun, uploadRunKey } from "./running-work.ts";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

/* ------------------------------------------------- outcome classification */

test("an aborted turn with no result is `stopped`, not `error`", () => {
  assert.equal(endedTurnOutcome({ completed: false, timedOut: false, stopped: true }), "stopped");
  assert.equal(endedTurnOutcome({ completed: false, timedOut: false, stopped: false }), "error");
});

test("a turn whose result arrived complete is `ok` even if Stop raced the close", () => {
  assert.equal(endedTurnOutcome({ completed: true, timedOut: false, stopped: true }), "ok");
});

test("our own timeout firing first stays a `timeout` — a Stop on a hung reply must not hide it", () => {
  assert.equal(endedTurnOutcome({ completed: false, timedOut: true, stopped: true }), "timeout");
});

test("the sacred guard's redaction outranks everything", () => {
  assert.equal(
    endedTurnOutcome({ redacted: true, completed: false, timedOut: false, stopped: true }),
    "redacted"
  );
});

test("`stopped` is a recorded outcome and is never a runtime failure", () => {
  assert.ok(isOutcome("stopped"));
  assert.ok((OUTCOMES as readonly string[]).includes("stopped"));
  assert.ok(!(FAILING_OUTCOMES as readonly string[]).includes("stopped"));
});

test("migration 041 admits `stopped` in the same CHECK the TypeScript vocabulary mirrors", () => {
  const sql = readFileSync(join(SRC, "..", "..", "db/migrations/041-stopped-turn-outcome.sql"), "utf8");
  const m = sql.match(/CHECK \(outcome IN \(([^)]*)\)\)/);
  assert.ok(m, "041 restates the outcome CHECK");
  const listed = m[1].split(",").map((s) => s.trim().replace(/'/g, ""));
  assert.deepEqual(listed, [...OUTCOMES]);
});

test("the ledger never records an empty assistant message for a stopped turn", () => {
  assert.equal(stoppedAssistantMessage(""), STOPPED_BEFORE_REPLY);
  assert.equal(stoppedAssistantMessage("  \n"), STOPPED_BEFORE_REPLY);
  assert.equal(stoppedAssistantMessage("Let's look at step one.  "), "Let's look at step one.");
});

/* ------------------------------------------------------ reveal truncation */

test("Stop during the paced reveal keeps the revealed prefix only, not the whole arrived reply", () => {
  const arrived = "First, the area is length times width. Next, we set up the equation.";
  const shown = "First, the area is length times width.".length;
  assert.deepEqual(stoppedReply(arrived, shown), {
    text: "First, the area is length times width.",
    localOnly: false,
  });
});

test("Stop with no reveal running keeps everything that arrived", () => {
  assert.equal(stoppedReply("Partial reply ", null).text, "Partial reply");
});

test("a half-arrived directive is dropped, never shown as raw braces", () => {
  const kept = stoppedReply("Look at this figure. {{viz:fig-3", null);
  assert.equal(kept.text, "Look at this figure.");
  assert.ok(!kept.text.includes("{{"));
});

test("a complete directive before the cut is kept", () => {
  const text = "Here it is. {{beat}} And more";
  assert.equal(stoppedReply(text, "Here it is. {{beat}}".length).text, "Here it is. {{beat}}");
});

test("Stop before a word was revealed leaves an empty, local-only row to carry the label", () => {
  assert.deepEqual(stoppedReply("Something that arrived but was not shown", 0), {
    text: "",
    localOnly: true,
  });
  assert.deepEqual(stoppedReply("", null), { text: "", localOnly: true });
});

test("a cursor past the end is clamped, not an error", () => {
  assert.equal(stoppedReply("abc", 99).text, "abc");
});

test("the Stopped label and the control's name are words, in both registers", () => {
  assert.equal(stoppedLabel(false), "Stopped");
  assert.ok(stoppedLabel(true).length > 0 && stoppedLabel(true) !== "Stopped");
  assert.equal(stopControlLabel(false), "Stop the reply");
  assert.ok(stopControlLabel(true).length > 0);
});

/* ------------------------------------------------- background work registry */

test("a registered run is cancelled once, by key, and unregisters cleanly", () => {
  let cancelled = 0;
  const unregister = registerRun(uploadRunKey(7), () => cancelled++);
  assert.equal(cancelRun(uploadRunKey(7)), true);
  assert.equal(cancelled, 1);
  assert.equal(cancelRun(uploadRunKey(7)), false, "a second Stop finds nothing to stop");
  unregister(); // after a cancel: harmless

  const off = registerRun(homeworkRunKey(3), () => cancelled++);
  off();
  assert.equal(cancelRun(homeworkRunKey(3)), false, "finished work cannot be cancelled");
  assert.equal(cancelled, 1);
});

test("a stale unregister does not remove a newer run under the same key", () => {
  let newer = 0;
  const offOld = registerRun(uploadRunKey(9), () => {});
  registerRun(uploadRunKey(9), () => newer++);
  offOld();
  assert.equal(cancelRun(uploadRunKey(9)), true);
  assert.equal(newer, 1);
});

/* ------------------------------------------------------- wiring, by source */

test("every model-spawning path that logs a turn classifies a Stop through endedTurnOutcome", () => {
  for (const p of [
    "app/api/ask/route.ts",
    "app/api/understanding/route.ts",
    "lib/uploads.ts",
    "lib/homework.ts",
  ]) {
    assert.match(read(p), /endedTurnOutcome\(/, `${p} must record a Stop as stopped`);
  }
  // the chat route still kills the child when the request is aborted
  assert.match(read("app/api/ask/route.ts"), /req\.signal\.addEventListener\("abort"/);
  // and the understanding check hands the request's signal to the grader
  assert.match(read("app/api/understanding/route.ts"), /runClaudeJson\(systemPrompt, prompt, req\.signal\)/);
});

test("the lesson chat's request carries an abort signal, so Stop reaches the server", () => {
  const core = read("components/chat/ChatCore.tsx");
  assert.match(core, /authFetch\("\/api\/ask", \{\s*method: "POST",\s*signal: controller\.signal/);
  assert.match(core, /aria-label=\{stopControlLabel\(arabicUi\)\}/);
});
