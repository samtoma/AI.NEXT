// lib/claude-prompt-file.ts — the system prompt travels in a file, never as one exec argument.
//
// The incident of 2026-10-12: on Linux an exec argument over 131,072 bytes (MAX_ARG_STRLEN) is
// refused with E2BIG. The tutor passed its whole system prompt as `--system-prompt <text>`; 8 of
// the Grade 10 book's lessons are larger (the largest 211,529 bytes), so on the box every such turn
// failed with `spawn E2BIG` and the student read "AI backend unavailable". macOS has no such limit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { systemPromptFile } from "./claude-prompt-file.ts";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(SRC, "..");
const LINUX_MAX_ARG_STRLEN = 131_072;

test("a prompt larger than any single argument may be round-trips through the file, byte for byte", () => {
  const text = "Ünïcödé ∑ maths $x^2$ — ".repeat(12_000); // > 211,529 bytes, the largest Grade 10 lesson
  assert.ok(Buffer.byteLength(text) > 2 * LINUX_MAX_ARG_STRLEN);
  const f = systemPromptFile(text);
  try {
    assert.equal(readFileSync(f.path, "utf8"), text);
  } finally {
    f.dispose();
  }
});

test("the file is private to this process (0600 in a 0700 directory) and lives for one call", () => {
  const f = systemPromptFile("secret-ish: a student's name may be in a system prompt");
  try {
    assert.equal(statSync(f.path).mode & 0o777, 0o600);
    assert.equal(statSync(dirname(f.path)).mode & 0o777, 0o700);
  } finally {
    f.dispose();
  }
  assert.equal(existsSync(f.path), false);
  assert.equal(existsSync(dirname(f.path)), false);
  f.dispose(); // a second dispose (close AND error both fire it) is harmless
});

test("no code that starts the claude CLI passes the system prompt inline", () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules") walk(p); }
      else if (/\.(ts|tsx|mts)$/.test(e.name) && !/\.test\.mts$/.test(e.name)) files.push(p);
    }
  };
  walk(SRC);
  walk(join(APP, "scripts"));
  const inline = files.filter((p) => /["']--(append-)?system-prompt["']\s*,/.test(readFileSync(p, "utf8")));
  assert.deepEqual(inline.map((p) => p.slice(APP.length + 1)), [], "pass --system-prompt-file instead");
  const viaFile = files.filter((p) => /["']--system-prompt-file["']/.test(readFileSync(p, "utf8")));
  assert.deepEqual(viaFile.map((p) => p.slice(APP.length + 1)).sort(),
    ["scripts/eval-answer-rules.mts", "scripts/eval-safety.mts", "src/app/api/ask/route.ts", "src/app/api/understanding/route.ts"]);
});
