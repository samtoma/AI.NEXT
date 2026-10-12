/**
 * THE TEST LIST RUNS WHAT IT NAMES (feature 003 integration, backlog #18).
 *
 * `npm test` is one `node --test` command whose files are listed, quoted, in
 * `app/package.json`'s `test` script — and several people append to that
 * line at once. Two failure modes have happened or nearly happened:
 *
 *   · a JOINED entry — `"a.test.mts""b.test.mts"`, when an append lost the
 *     space between two quotes. The shell reads it as ONE path that does not
 *     exist, and neither file runs; a stale list and a green run can then sit
 *     side by side;
 *   · a file listed that no longer exists, or listed twice.
 *
 * This reads the script as text and fails on any of them. It does not ask
 * that every test file be listed: a few database tests are run by their own
 * jobs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("../..", import.meta.url));
const script: string = JSON.parse(readFileSync(path.join(APP, "package.json"), "utf8")).scripts.test;

/** The quoted entries of the `test` script, in order. */
export function testEntries(cmd: string): string[] {
  return [...cmd.matchAll(/"([^"]*)"/g)].map((m) => m[1]!);
}

test("no two entries are joined into one (a lost space between quotes)", () => {
  assert.doesNotMatch(script, /""/, 'two quoted entries touch: `""` — put a space between them');
  assert.doesNotMatch(script, /\.mts"[^\s]/, "an entry's closing quote is not followed by a space");
  assert.doesNotMatch(script, /[^\s]"src\/|[^\s]"scripts\//, "an entry's opening quote is not preceded by a space");
});

test("every listed test file exists, is a test, and is listed once", () => {
  const entries = testEntries(script);
  assert.ok(entries.length > 50, `only ${entries.length} entries parsed from the test script`);
  const missing = entries.filter((e) => !existsSync(path.join(APP, e)));
  assert.deepEqual(missing, [], "listed but not on disk");
  const notTests = entries.filter((e) => !/\.test\.mts$/.test(e));
  assert.deepEqual(notTests, [], "listed but not a *.test.mts file");
  const seen = new Set<string>();
  const twice = entries.filter((e) => (seen.has(e) ? true : (seen.add(e), false)));
  assert.deepEqual(twice, [], "listed more than once");
});

test("the guard's parser sees a joined entry", () => {
  const joined = `node --test "src/a.test.mts""src/b.test.mts" "src/c.test.mts"`;
  assert.match(joined, /""/);
  assert.deepEqual(testEntries(`node --test "src/a.test.mts" "src/b.test.mts"`), [
    "src/a.test.mts",
    "src/b.test.mts",
  ]);
});
