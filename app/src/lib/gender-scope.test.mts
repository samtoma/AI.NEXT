/**
 * Where gender MUST NOT go (FR-2603, FR-2604) — by reading the source.
 *
 * These are grep tests, and that is deliberate. FR-2603 and FR-2604 are not
 * properties of one function's output; they are properties of the whole reach
 * of one field, and the only honest way to check "nothing over here ever reads
 * it" is to look at everything over here. A behavioural test would pass while
 * somebody quietly added `if (gender === …)` to the selector next month.
 *
 * Two rules:
 *   FR-2603 — gender governs address and voice only. It must never reach
 *             mastery estimation, question selection, retrieval ranking or
 *             difficulty. A tutor that teaches girls different content is a
 *             worse product AND a worse defect than the one P6 removed.
 *   FR-2604 — it must never reach a third-party analytics tool, an event
 *             property, a log line or an error message. It is a datum about a
 *             minor, collected for one stated purpose.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const LIB = path.join(import.meta.dirname, ".");
const SRC = path.join(import.meta.dirname, "..");

const read = (p: string) => readFileSync(p, "utf8");
const GENDER = /\bgender\b/i;

/** Teaching decisions: none of these may so much as mention the field. */
const TEACHING_MODULES = [
  "bkt.ts",
  "mastery.ts",
  "retrieval.ts",
  "session-rules.ts",
  "engagement.ts",
  "arithmetic.ts",
  "sessions.ts",
];

test("FR-2603: no teaching decision reads gender", () => {
  for (const f of TEACHING_MODULES) {
    const src = read(path.join(LIB, f));
    const hits = src
      .split("\n")
      .map((l, i) => [i + 1, l] as const)
      .filter(([, l]) => GENDER.test(l) && !/^\s*(\*|\/\/|\/\*)/.test(l));
    if (f === "retrieval.ts") {
      // retrieval RENDERS the address block; it must not RANK or SELECT on it.
      for (const [n, l] of hits) {
        assert.ok(
          /addressBlock|address seam|FR-260|register|voice/.test(l),
          `retrieval.ts:${n} touches gender outside the address block: ${l.trim()}`
        );
      }
      // the ranking + selection span, CODE only: the doc comment that follows
      // it belongs to `retrievalBlock` and explains the address block.
      const ranking = src
        .slice(
          src.indexOf("async function nearestSkillMastery"),
          src.indexOf("export function retrievalBlock")
        )
        .split("\n")
        .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
        .join("\n");
      assert.equal(
        GENDER.test(ranking),
        false,
        "gender reached retrieval ranking/selection"
      );
      continue;
    }
    assert.deepEqual(
      hits.map(([n]) => `${f}:${n}`),
      [],
      `${f} must not read gender (FR-2603)`
    );
  }
});

/** Every file under src/, minus the places address legitimately lives. */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts)$/.test(p)) out.push(p);
  }
  return out;
}

/**
 * The sinks FR-2604 names. Each is matched as "a call to it, on the same line
 * as the identifier" — the shape an accidental leak actually takes.
 */
const SINKS: [string, RegExp][] = [
  ["analytics event properties", /\bemit\s*\(/],
  ["the GA wrapper", /\btrack\s*\(/],
  ["the auth event log", /\brecordAuthEvent\s*\(/],
  ["a console line", /console\.(log|error|warn|info|debug)\s*\(/],
  ["a thrown error", /new Error\s*\(/],
];

test("FR-2604: gender reaches no event, no analytics call, no log, no error", () => {
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    if (/\.test\.mts$/.test(file)) continue;
    const rel = path.relative(SRC, file);
    // lib/address.ts is the vocabulary itself; its prose explains the rule.
    if (rel === "lib/address.ts") continue;
    const lines = read(file).split("\n");
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!GENDER.test(l)) continue;
      if (/^\s*(\*|\/\/|\/\*)/.test(l)) continue; // comments state the rule
      for (const [what, re] of SINKS) {
        if (re.test(l)) offenders.push(`${rel}:${i + 1} → ${what}: ${l.trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [], "gender reached a forbidden sink (FR-2604)");
});

test("FR-2604: the GA payload allowlist does not carry gender", () => {
  const ga = read(path.join(LIB, "ga.ts"));
  assert.equal(GENDER.test(ga), false, "gender named in the GA layer");
});

test("FR-2603: question selection and difficulty never see it", () => {
  for (const f of ["session-rules.ts", "bkt.ts"]) {
    assert.equal(GENDER.test(read(path.join(LIB, f))), false, f);
  }
  // and the one place that DOES read it says what for
  const profile = read(path.join(LIB, "student-context.ts"));
  assert.match(profile, /address and voice ONLY/i);
});
