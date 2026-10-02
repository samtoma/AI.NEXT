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

test("a re-entry is shown as a local note — never sent to the model, never counted as an attempt", () => {
  // isolate the catch block that wraps the chat-typed submitAttempt call, up
  // to the fallback log line that already existed (a stable, unique anchor)
  const block = code.match(/const r = await submitAttempt\([\s\S]*?chat-typed answer submission failed:", e\);/)?.[0] ?? "";
  assert.ok(block.length > 0, "the chat-typed submitAttempt call site is present");
  assert.match(block, /if \(e instanceof AttemptRetryError\)/);
  assert.match(
    block,
    /setMessages\(\(prev\) => \[\s*\.\.\.prev,\s*\{ role: "note", kind: "say", localOnly: true, text: e\.retry\.message \},\s*\]\)/
  );
  // the retry branch must not treat the re-entry as a graded result
  const retryArm = block.match(/if \(e instanceof AttemptRetryError\) \{[\s\S]*?\} else \{/)?.[0] ?? "";
  assert.ok(!/setExternalAttempt/.test(retryArm), "a re-entry must not be synced onto the question card as a result");
  assert.ok(!/handleAttemptRef/.test(retryArm), "a re-entry must not run the attempt side-effects (mastery, progression)");
});

test("a genuine failure (not a re-entry) still just logs, as before", () => {
  assert.match(code, /\} else \{\s*console\.error\("chat-typed answer submission failed:", e\);\s*\}/);
});
