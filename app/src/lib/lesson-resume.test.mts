/**
 * Where a student left a lesson, and whether she gets it back.
 *
 * @covers FR-204
 *
 * Two bugs, in one sentence each: pressing Finish halfway through a lesson
 * deleted the save (tester report against v0.11.0, 2026-10-03); and the save
 * lived in one browser, so another device, a sign-out or a week away lost it
 * (issue #25). Since #25 the place lives only on the server.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_SAVE_BYTES,
  SAVE_LIMITS,
  SAVE_VERSION,
  clearLegacyLessonSaves,
  createSaveChannel,
  isEarlyFinish,
  isSaveTarget,
  lessonSaveUrl,
  parseSaved,
  resumeStep,
  validateSavePayload,
  type KeyStore,
  type SaveOp,
} from "./lesson-resume.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const NOW = 1_800_000_000_000;
const payload = (over: Record<string, unknown> = {}) => ({
  v: SAVE_VERSION,
  sid: "abc",
  messages: [{ role: "assistant", text: "Let's start." }],
  board: [],
  focusKey: null,
  covered: ["lo:1"],
  ...over,
});

function memStore(init: Record<string, string> = {}): KeyStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
  };
}

/* ------------------------------------------------------------ the rules --- */

test("a Finish before the lesson is over is early", () => {
  assert.equal(isEarlyFinish({ readyToFinish: false, coveredCount: 2, loCount: 5 }), true);
  assert.equal(isEarlyFinish({ readyToFinish: false, coveredCount: 0, loCount: 5 }), true);
});

test("a Finish after the recap, or with every objective covered, is an ending", () => {
  assert.equal(isEarlyFinish({ readyToFinish: true, coveredCount: 2, loCount: 5 }), false);
  assert.equal(isEarlyFinish({ readyToFinish: false, coveredCount: 5, loCount: 5 }), false);
});

test("a save read back with a tutor message is offered, and keeps its endedEarly mark", () => {
  const s = parseSaved({ ...payload({ endedEarly: true }), at: NOW });
  assert.ok(s);
  assert.equal(s.sid, "abc");
  assert.equal(s.endedEarly, true);
  assert.equal(s.at, NOW);
});

test("no expiry: a save is offered however old it is (#25)", () => {
  assert.ok(parseSaved({ ...payload(), at: 0 }));
  assert.ok(parseSaved({ ...payload(), at: NOW - 365 * 24 * 60 * 60 * 1000 }));
  const src = read("./lesson-resume.ts");
  assert.doesNotMatch(src, /TTL/);
});

test("nothing worth offering reads as null", () => {
  assert.equal(parseSaved(null), null);
  assert.equal(parseSaved(undefined), null);
  assert.equal(parseSaved("{}"), null);
  assert.equal(parseSaved({ ...payload({ v: SAVE_VERSION + 1 }), at: NOW }), null);
  assert.equal(parseSaved({ ...payload({ sid: 7 }), at: NOW }), null);
  assert.equal(parseSaved({ ...payload({ messages: [{ role: "user", text: "hi" }] }), at: NOW }), null);
  assert.equal(parseSaved({ ...payload({ messages: [{ role: "assistant", text: "" }] }), at: NOW }), null);
  assert.equal(parseSaved(payload()), null, "no `at` from the server");
});

test("the resume prompt names the step she was on", () => {
  assert.equal(resumeStep([], 5), 1);
  assert.equal(resumeStep(["a", "b"], 5), 3);
  assert.equal(resumeStep(["a", "b", "c", "d", "e"], 5), 5);
});

/* --------------------------------------------------- payload validation --- */

test("the server accepts exactly the resume payload", () => {
  const v = validateSavePayload(payload({ endedEarly: true }));
  assert.ok(v.ok);
  assert.deepEqual(v.save, payload({ endedEarly: true }));
  // a Stopped reply is a settled message and is kept
  const stopped = validateSavePayload(
    payload({ messages: [{ role: "assistant", text: "Half a repl", stopped: true }] })
  );
  assert.ok(stopped.ok);
});

test("unknown fields — a student id above all — are dropped, not stored", () => {
  const v = validateSavePayload(payload({ studentId: 99, name: "Mona", at: 5 }));
  assert.ok(v.ok);
  assert.deepEqual(Object.keys(v.save).sort(), ["board", "covered", "focusKey", "messages", "sid", "v"]);
});

test("malformed saves are refused with a reason", () => {
  const bad: [unknown, string][] = [
    [null, "not_an_object"],
    [[], "not_an_object"],
    [payload({ v: 2 }), "version"],
    [payload({ sid: "" }), "sid"],
    [payload({ sid: "x".repeat(SAVE_LIMITS.sid + 1) }), "sid"],
    [payload({ messages: "hi" }), "messages"],
    [payload({ messages: Array(SAVE_LIMITS.messages + 1).fill({ role: "assistant", text: "a" }) }), "messages"],
    [payload({ messages: [{ role: "system", text: "x" }] }), "message"],
    [payload({ messages: [{ role: "assistant", text: 3 }] }), "message"],
    [payload({ messages: [{ role: "assistant", text: "a", streaming: true }] }), "streaming_message"],
    [payload({ board: {} }), "board"],
    [payload({ board: [{ type: "figure" }] }), "board_item"],
    [payload({ focusKey: 4 }), "focusKey"],
    [payload({ covered: [1] }), "covered"],
    [payload({ endedEarly: "yes" }), "endedEarly"],
    [payload({ messages: [{ role: "user", text: "hi" }] }), "nothing_to_resume"],
  ];
  for (const [body, error] of bad) {
    const v = validateSavePayload(body);
    assert.equal(v.ok, false, JSON.stringify(body).slice(0, 80));
    if (!v.ok) assert.equal(v.error, error);
  }
});

test("the route addresses only real lesson modes and slugs", () => {
  assert.equal(isSaveTarget("learn", "u1-1"), true);
  assert.equal(isSaveTarget("review", "geo1-2"), true);
  assert.equal(isSaveTarget("homework", "u1-1"), false, "lessons only");
  assert.equal(isSaveTarget("learn", "../x"), false);
  assert.equal(isSaveTarget("learn", "U1-1"), false);
  assert.equal(lessonSaveUrl("learn", "u1-1"), "/api/lesson-save/learn/u1-1");
});

/* ---------------------------------------------------------- the channel --- */

function fakeSend() {
  const sent: SaveOp[] = [];
  const pending: ((ok: boolean) => void)[] = [];
  return {
    sent,
    send: (op: SaveOp) => {
      sent.push(op);
      return new Promise<boolean>((r) => pending.push(r));
    },
    settle: async (ok = true) => {
      pending.shift()?.(ok);
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

test("saves go out in order, one at a time, and only the latest queued one is sent", async () => {
  const f = fakeSend();
  const ch = createSaveChannel(f.send);
  ch.put("a");
  ch.put("b");
  ch.put("c");
  assert.deepEqual(f.sent, [{ kind: "put", body: "a" }], "one in flight");
  await f.settle();
  assert.deepEqual(f.sent.map((o) => o.kind === "put" && o.body), ["a", "c"], "b was superseded");
  await f.settle();
  await ch.idle();
  assert.equal(ch.unsent(), null);
});

test("an unchanged save is not re-sent (an idle tab writes nothing)", async () => {
  const f = fakeSend();
  const ch = createSaveChannel(f.send);
  ch.put("a");
  await f.settle();
  ch.put("a");
  assert.equal(f.sent.length, 1);
});

test("a failed save is re-sent by the next attempt and offered to the unload flush", async () => {
  const f = fakeSend();
  const ch = createSaveChannel(f.send);
  ch.put("a");
  await f.settle(false);
  assert.equal(ch.unsent(), "a");
  ch.put("a");
  assert.equal(f.sent.length, 2);
  await f.settle(true);
  assert.equal(ch.unsent(), null);
});

test("completing or starting over deletes after any save in flight, and supersedes queued ones", async () => {
  const f = fakeSend();
  const ch = createSaveChannel(f.send);
  ch.put("a");
  ch.put("b");
  ch.remove();
  assert.equal(ch.unsent(), null, "nothing to flush once the place is discarded");
  await f.settle();
  assert.deepEqual(f.sent, [{ kind: "put", body: "a" }, { kind: "delete" }]);
  await f.settle();
  // a new sitting's first save goes out after the delete, even if identical
  ch.put("a");
  assert.equal(f.sent.length, 3);
});

/* -------------------------------------------------- legacy browser saves --- */

test("legacy browser saves are cleared, and nothing else", () => {
  const store = memStore({
    "ainext-lesson:learn:a:s1": "{}",
    "ainext-lesson:review:b:s2": "{}",
    "ainext-renewed-at": "123",
  });
  clearLegacyLessonSaves(store);
  assert.deepEqual([...store.data.keys()], ["ainext-renewed-at"]);
});

/* ------------------------------------------------------------ the wiring --- */

test("the lesson keeps its place on the server only — no browser save, no TTL", () => {
  const src = read("../components/student/LessonSession.tsx");
  assert.doesNotMatch(src, /sessionStorage\./);
  assert.doesNotMatch(src, /localStorage\.(setItem|getItem)/, "the place lives only on the server (#25)");
  assert.match(src, /clearLegacyLessonSaves\(localStorage\)/, "old keys are cleared on read");
  assert.match(src, /lessonSaveUrl\(mode, lesson\.slug\)/);
  assert.match(src, /isEarlyFinish\(/);
  assert.match(src, /endedEarly: true/);
  assert.match(src, /if \(!early\) saveChannel\.remove\(\)/, "a completed lesson discards its place");
  assert.match(src, /startFresh = useCallback\(\(\) => \{\s*saveChannel\.remove\(\)/, "Start over discards it");
  assert.match(src, /keepalive: true/, "the unload flush is a bonus");
});

test("an early Finish does not close the sitting as completed", () => {
  const src = read("../app/api/understanding/route.ts");
  assert.match(src, /body\.early === true/);
  assert.match(src, /!early\b[\s\S]{0,200}closeSession\(studentId, sessionId, "completed"\)/);
});

test("sign-out keeps the server place and clears only legacy keys", () => {
  const src = read("../components/NavLinks.tsx");
  assert.match(src, /clearLegacyLessonSaves\(localStorage\)[\s\S]{0,400}window\.location\.assign\("\/signin"\)/);
  assert.doesNotMatch(src, /lesson-save/, "sign-out never deletes a server save");
});

test("route ownership: the student comes from the session, never the request", () => {
  const src = read("../app/api/lesson-save/[mode]/[slug]/route.ts");
  assert.match(src, /await requireStudent\(\)/);
  assert.match(src, /studentId: me\.studentId/);
  assert.doesNotMatch(src, /body\.(studentId|student_id)|searchParams|params\)\.studentId/);
  assert.match(src, /MAX_SAVE_BYTES/);
  assert.match(src, /validateSavePayload\(body\)/);
  for (const verb of ["GET", "PUT", "DELETE"]) {
    assert.match(src, new RegExp(`export async function ${verb}\\(`));
  }
  const q = read("./lesson-save-queries.ts");
  assert.equal((q.match(/withPrincipal\(studentId,/g) ?? []).length, 3, "every query runs under the principal");
  assert.equal((q.match(/environment = \$2|VALUES \(\$1, \$2/g) ?? []).length, 3, "every query binds environment");
  assert.ok(MAX_SAVE_BYTES <= 1_000_000);
});

test("migration 042: forced RLS, per-student policy, environment with no default, no operator grant", () => {
  const m = read("../../../db/migrations/042-lesson-saves.sql");
  assert.match(m, /environment\s+TEXT\s+NOT NULL,/);
  assert.doesNotMatch(m, /environment\s+TEXT\s+NOT NULL DEFAULT/);
  assert.match(m, /ALTER TABLE lesson_saves ENABLE ROW LEVEL SECURITY/);
  assert.match(m, /ALTER TABLE lesson_saves FORCE ROW LEVEL SECURITY/);
  assert.match(m, /CREATE POLICY lesson_saves_app ON lesson_saves FOR ALL TO ainext_app/);
  assert.match(m, /PRIMARY KEY \(student_id, environment, mode, lesson_slug\)/);
  assert.match(m, /GRANT SELECT, INSERT, UPDATE, DELETE ON lesson_saves TO ainext_app/);
  assert.doesNotMatch(m, /GRANT[^;]*TO ainext_operator/);
  assert.match(m, /MINORS' DATA/);
});
