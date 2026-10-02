/**
 * A student's curriculum never reaches the anonymous analytics stream
 * (FR-4016; privacy review F4; decisions.md D).
 *
 * `GA_EVENTS` and `GA_PROPS` (`lib/ga.ts`) are closed allow-lists, and the
 * sanitiser drops anything else. That is what keeps `lo_id` out today, and
 * `lib/ga.ts` records that Samuel may yet decide `lo_id` is fine — "one entry
 * in this array". The curriculum gets the opposite ruling, and this file is
 * it: unlike `lo_id` it says something about the FAMILY — in Egypt, "American"
 * is a weak proxy for fee-paying schooling — and a 50-family pilot makes that
 * identifying. It may be recorded in the product's own first-party event table
 * (`lib/analytics.ts`), never sent to a third party.
 *
 * Three ways it could leak, three checks: a curriculum-named event, a
 * curriculum-named property, and a curriculum VALUE smuggled into an allowed
 * property at a `track(…)` call site.
 *
 * @covers FR-4016
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { GA_EVENTS, GA_PROPS, isGaEvent, isGaProp, sanitiseProps } from "./ga.ts";
import { CURRICULUM_IDS } from "./curricula.ts";

const APP = fileURLToPath(new URL("../..", import.meta.url));

const CURRICULUM_WORD = /curricul/i;

test("no GA4 event and no GA4 property is about the curriculum", () => {
  for (const e of GA_EVENTS) assert.doesNotMatch(e, CURRICULUM_WORD, `GA event ${e}`);
  for (const p of GA_PROPS) assert.doesNotMatch(p, CURRICULUM_WORD, `GA property ${p}`);
  for (const name of ["curriculum", "curriculum_system", "curriculumSystem", "curriculum_source", "curriculum_resolved_from"]) {
    assert.equal(isGaProp(name), false, name);
    assert.equal(isGaEvent(name), false, name);
  }
  // …nor any curriculum id, as an event name
  for (const id of CURRICULUM_IDS) assert.equal(isGaEvent(id), false, id);
});

test("the sanitiser drops a curriculum property, whatever it is called", () => {
  const out = sanitiseProps({
    surface: "lesson",
    grade: "10",
    curriculum: "us-american-en",
    curriculum_system: "us-american-en",
    curriculumSource: "chosen",
  });
  assert.deepEqual(out.props, { surface: "lesson", grade: "10" });
  assert.deepEqual(out.dropped.sort(), ["curriculum", "curriculumSource", "curriculum_system"]);
});

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== "node_modules") walk(full);
      } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) {
        out.push(relative(APP, full));
      }
    }
  };
  walk(join(APP, "src"));
  return out;
}

/** The argument text of every `track(` call, parens balanced. */
function trackCalls(code: string): string[] {
  const out: string[] = [];
  const re = /\btrack\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    let depth = 1;
    let j = m.index + m[0].length;
    const start = j;
    for (; j < code.length && depth > 0; j++) {
      if (code[j] === "(") depth++;
      else if (code[j] === ")") depth--;
    }
    out.push(code.slice(start, j - 1));
  }
  return out;
}

test("no track(…) call site hands GA4 a curriculum, under any property name", () => {
  const calls: string[] = [];
  const hits: string[] = [];
  for (const f of sourceFiles()) {
    const code = readFileSync(join(APP, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const args of trackCalls(code)) {
      calls.push(`${f}: ${args}`);
      if (CURRICULUM_WORD.test(args) || CURRICULUM_IDS.some((id) => args.includes(id))) {
        hits.push(`${f}: track(${args.replace(/\s+/g, " ").slice(0, 160)})`);
      }
    }
  }
  assert.ok(calls.length > 0, "the scan sees the app's track() calls");
  assert.deepEqual(hits, [], "a curriculum reaches a GA4 track() call:\n" + hits.join("\n"));
});
