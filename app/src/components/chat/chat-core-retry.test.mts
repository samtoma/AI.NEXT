/**
 * A CHAT-TYPED ANSWER'S RE-ENTRY IS SHOWN TO THE STUDENT (T416, FR-4320).
 *
 * During Socratic probing a chat-typed answer ({{answer_submitted:…}}) is
 * graded through the same `submitAttempt` seam a tapped card uses
 * (`lib/attempts-client.ts`). When the maths-expression marker sends it back
 * for re-entry — a form the question does not ask for, or not readable —
 * NOTHING was recorded, but before this fix the whole event was only
 * `console.error`ed: the student saw no reaction at all and had no way to
 * know their typed answer needed fixing.
 *
 * A `.tsx` cannot be imported by the type-stripping test runner (the
 * constraint `math-answer-input.test.mts` documents), so this reads the
 * source, the way that file and `teaching-snapshot.test.mts` do.
 *
 * @covers FR-4320
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(HERE, "ChatCore.tsx"), "utf8");
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test("the chat-typed submit path imports AttemptRetryError alongside submitAttempt", () => {
  assert.match(code, /import\s*\{\s*AttemptRetryError,\s*submitAttempt\s*\}\s*from\s*"@\/lib\/attempts-client"/);
});

test("a re-entry is shown to the student, told to the tutor as an event (2026-10-29), never counted as an attempt", () => {
  // isolate the catch block that wraps the chat-typed submitAttempt call, up
  // to the fallback log line that already existed (a stable, unique anchor)
  const block = code.match(/const r = await submitAttempt\([\s\S]*?chat-typed answer submission failed:", e\);/)?.[0] ?? "";
  assert.ok(block.length > 0, "the chat-typed submitAttempt call site is present");
  assert.match(block, /if \(e instanceof AttemptRetryError\)/);
  assert.match(
    block,
    /setMessages\(\(prev\) => \[\s*\.\.\.prev,\s*\{ role: "note", kind: "event", text: UNREAD_ANSWER_NOTE \},\s*\{ role: "note", kind: "say", localOnly: true, text: e\.retry\.message \},\s*\]\)/
  );
  // the retry branch must not treat the re-entry as a graded result
  const retryArm = block.match(/if \(e instanceof AttemptRetryError\) \{[\s\S]*?\} else \{/)?.[0] ?? "";
  assert.ok(!/setExternalAttempt/.test(retryArm), "a re-entry must not be synced onto the question card as a result");
  assert.ok(!/handleAttemptRef/.test(retryArm), "a re-entry must not run the attempt side-effects (mastery, progression)");
});

test("the tutor note tells Noor to treat the retyped answer as a first answer, with no remark on the retry (2026-10-29)", () => {
  const note = src.match(/export const UNREAD_ANSWER_NOTE =\s*"((?:[^"\\]|\\.)*)";/)?.[1] ?? "";
  assert.ok(note.length > 0, "UNREAD_ANSWER_NOTE is a single string literal");
  assert.ok(!note.includes("q:"), "an event naming the open card's id would mark it answered");
  assert.ok(note.includes("{{answer_submitted:…}}"));
  assert.match(note, /\(for you only:/);
  assert.match(note, /react only to the maths, exactly as you would to a first answer/);
  assert.match(note, /never mention it, the retry, the format, notation or brackets/);
});

test("a genuine failure (not a re-entry) still just logs, as before", () => {
  assert.match(code, /\} else \{\s*console\.error\("chat-typed answer submission failed:", e\);\s*\}/);
});
