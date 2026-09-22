/**
 * @covers FR-2602, FR-2605
 *
 * The retired "Omar" demo persona must never come back into a widget's
 * [live event] narration, and the masculine pronoun must never be a default.
 *
 * Every widget in this directory builds a `detail`/note string for the tutor
 * stream, and until now each one hardcoded the literal name "Omar" — the
 * picker-era demo student ADR-0010 (plan A10) retired — so every real
 * student's widget result was narrated to the model as Omar's. PairPlotter
 * additionally hardcoded the masculine pronoun ("he swapped the
 * coordinates"), the exact FR-2605 defect P6 removed from the server-side
 * prompts in lib/lesson.ts, lib/ask.ts and lib/checkin.ts — missed here
 * because this directory is client-side and scripts/capture-prompts.mts
 * cannot reach it.
 *
 * This is a grep test over the source, in the same spirit as
 * gender-scope.test.mts: the property under test ("nothing in this
 * directory hardcodes it") is a fact about the whole file, not about one
 * function's output, so the only honest check is to read every widget.
 * Comments are excluded so a doc line explaining the history (as this file
 * and the widgets' own JSDoc do) or an unrelated aside (IrabBuilder.tsx's
 * "never leave him stuck") cannot fail it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const DIR = path.join(import.meta.dirname, ".");

function widgetFiles(): string[] {
  return readdirSync(DIR)
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => path.join(DIR, f));
}

/** Strip /* block *\/ comments, then trailing // comments — code only. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

test('no widget hardcodes the retired "Omar" demo persona (FR-2602)', () => {
  const offenders: string[] = [];
  for (const file of widgetFiles()) {
    const code = stripComments(readFileSync(file, "utf8"));
    if (/\bOmar\b/.test(code)) offenders.push(path.basename(file));
  }
  assert.deepEqual(
    offenders,
    [],
    `"Omar" literal found outside comments in: ${offenders.join(", ")}`
  );
});

test("no widget defaults to a masculine pronoun (FR-2605)", () => {
  const offenders: string[] = [];
  for (const file of widgetFiles()) {
    const code = stripComments(readFileSync(file, "utf8"));
    if (/\b(he|him|his)\b/.test(code)) offenders.push(path.basename(file));
  }
  assert.deepEqual(
    offenders,
    [],
    `masculine pronoun found outside comments in: ${offenders.join(", ")}`
  );
});
