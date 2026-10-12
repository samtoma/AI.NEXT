// The general and map chats retrieve misconceptions and the authored explanation library for the
// FOCUS objectives only — like the detailed question bank and the figure library beside them
// (docs/architecture/anatomy-of-a-tutor-turn.md: "Known mistakes for these objectives").
// Given every objective in the compact index instead, a Grade 10 student's prompt carried the whole
// book's library: 897 KB of a 903 KB prompt, ~440k tokens a turn (2026-10-13).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ask = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ask.ts"), "utf8");

test("buildAskContext retrieves for the focus objectives, never for every objective in the index", () => {
  const calls = [...ask.matchAll(/await retrieve\(\s*studentId,\s*([^,]+),/g)].map((m) => m[1].trim());
  assert.deepEqual(calls, ["[...focusLos]"]);
  assert.doesNotMatch(ask, /retrieve\(\s*studentId,\s*grounding\.lo_ids/);
});
