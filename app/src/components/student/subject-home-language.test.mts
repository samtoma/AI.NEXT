/**
 * Regression test for the bug Tamer filed after the first `noor.reletix.com`
 * deploy: a grade-12 student, with no live course yet, landed on
 * `SubjectHome` and "got things in Arabic" — the greeting, the empty state,
 * the "more subjects to come" card, all hardcoded Egyptian Arabic with no
 * English form. `SubjectHome` is the home for EVERY student regardless of
 * subject (it is reached before a subject is chosen, and the empty state is
 * reached by definition with none), so its chrome must be English per
 * constitution v3.2.0 Principle V — English is the MVP 1.0 default.
 *
 * Only `SubjectCard`, one per subject, is allowed to speak Arabic, and only
 * for a subject whose registry `dir` is `rtl` (Arabic, Social Studies) — the
 * same `arabicUi`-style split `ChatCore`/`ReportCard` already make for the
 * same data (see `fix(i18n)` 2578277 and `ReportCard`'s `rtl` prop). This test
 * cannot see which branch a `rtl ? ar : en` ternary takes at runtime, so it
 * scans the surrounding PAGE CHROME functions only — `SubjectHome` itself and
 * `MoreSubjectsComing`, which its own comment says "belongs to the page's
 * chrome rather than to any one subject" — and asserts they contain no
 * hardcoded Arabic literal at all. `SubjectCard` and `VERDICT_LABEL_AR` are
 * deliberately out of scope: Arabic there is correct, guarded by `rtl`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FILE = fileURLToPath(new URL("./SubjectHome.tsx", import.meta.url));
const SOURCE = readFileSync(FILE, "utf8");

/** Arabic script (incl. Arabic-Indic digits and presentation forms). */
const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

/** Code with comments removed — same rule `design-variant-scan.test.mts` uses:
 *  `/* … *\/` blocks, and whole lines that are `//` or a `*` continuation. A
 *  trailing `//` comment on a code line is deliberately left alone (see that
 *  file for why); nothing in this component ends a code line with Arabic
 *  prose, so it does not matter here. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("//") && !t.startsWith("*");
    })
    .join("\n");
}

/** Slice out one top-level `function <name>(` … matching `}` — good enough
 *  for this file's flat, unnested function declarations. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `SubjectHome.tsx no longer declares function ${name} — update this test`);
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  throw new Error(`unbalanced braces reading function ${name}`);
}

test("SubjectHome's page chrome renders no Arabic", () => {
  const body = functionBody(code(SOURCE), "SubjectHome");
  const hit = ARABIC.exec(body);
  assert.equal(
    hit,
    null,
    `SubjectHome() (the cross-subject page chrome — greeting, heading, empty state) ` +
      `contains an Arabic character near "${hit ? body.slice(Math.max(0, hit.index! - 20), hit.index! + 20) : ""}". ` +
      "This page is reached before any subject is chosen and by every student in an " +
      "empty grade, so its own copy must be English (constitution v3.2.0 Principle V) — " +
      "only SubjectCard may speak Arabic, gated on the subject's own `rtl`."
  );
});

test("the \"more subjects coming\" chrome card renders no Arabic", () => {
  const body = functionBody(code(SOURCE), "MoreSubjectsComing");
  const hit = ARABIC.exec(body);
  assert.equal(
    hit,
    null,
    `MoreSubjectsComing() contains an Arabic character near "${hit ? body.slice(Math.max(0, hit.index! - 20), hit.index! + 20) : ""}". ` +
      "Its own docstring says it belongs to the page's chrome, not to any one subject — English default applies."
  );
});

test("VERDICT_LABEL (the English map) carries no Arabic", () => {
  // Regression for the specific bug: VERDICT_LABEL used to BE the Arabic map,
  // unconditionally applied regardless of the row's subject.
  const match = code(SOURCE).match(/const VERDICT_LABEL: Record<string, string> = \{[\s\S]*?\};/);
  assert.ok(match, "VERDICT_LABEL declaration not found — update this test");
  assert.equal(ARABIC.exec(match![0]), null, "VERDICT_LABEL must stay the English verdict map; Arabic labels belong in VERDICT_LABEL_AR");
});
