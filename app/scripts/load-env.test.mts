/**
 * `load-env.mjs`, exercised against fixture strings only — never against a
 * real `.env` file or the real `process.env`. Importing this module does
 * trigger the loader's own real-file preload (it runs unconditionally at
 * import time, see `load-env.mjs`), but every assertion below passes its
 * own plain object as the merge target, so that side effect never touches
 * what these tests check.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { applyEnv, parseEnv } from "./load-env.mjs";

test("parseEnv: KEY=value, blank lines, and full-line comments", () => {
  const parsed = parseEnv(
    ["# a comment", "", "FOO=bar", "  ", "# another", "BAZ=qux"].join("\n")
  );
  assert.deepEqual(parsed, { FOO: "bar", BAZ: "qux" });
});

test("parseEnv: an optional leading `export ` is stripped", () => {
  assert.deepEqual(parseEnv("export FOO=bar"), { FOO: "bar" });
});

test("parseEnv: double quotes decode escapes, single quotes are literal", () => {
  const parsed = parseEnv(['DQ="line one\\nline two"', "SQ='no \\n escape here'"].join("\n"));
  assert.equal(parsed.DQ, "line one\nline two");
  assert.equal(parsed.SQ, "no \\n escape here");
});

test("parseEnv: an unquoted trailing comment is dropped, a quoted one is kept", () => {
  const parsed = parseEnv(["FOO=bar # trailing note", 'QUOTED="bar # not a comment"'].join("\n"));
  assert.equal(parsed.FOO, "bar");
  assert.equal(parsed.QUOTED, "bar # not a comment");
});

test("parseEnv: last assignment of a key wins within one file", () => {
  assert.deepEqual(parseEnv("FOO=first\nFOO=second"), { FOO: "second" });
});

test("parseEnv: an invalid key is ignored rather than crashing the caller", () => {
  assert.deepEqual(parseEnv("123BAD=nope\nGOOD=yes"), { GOOD: "yes" });
});

test("applyEnv: never overrides a key the target already has", () => {
  const target: Record<string, string | undefined> = { DATABASE_URL_MAINT: "already-exported" };
  applyEnv(parseEnv("DATABASE_URL_MAINT=from-file\nNEW_VAR=filled-in"), target);
  assert.equal(target.DATABASE_URL_MAINT, "already-exported");
  assert.equal(target.NEW_VAR, "filled-in");
});

test("applyEnv: precedence — .env.local applied before .env wins for a shared key", () => {
  const target: Record<string, string | undefined> = {};
  applyEnv(parseEnv("SHARED=from-local\nLOCAL_ONLY=1"), target); // .env.local
  applyEnv(parseEnv("SHARED=from-env\nENV_ONLY=1"), target); // .env
  assert.equal(target.SHARED, "from-local");
  assert.equal(target.LOCAL_ONLY, "1");
  assert.equal(target.ENV_ONLY, "1");
});

test("applyEnv: reports exactly the keys it newly set", () => {
  const target = { EXISTING: "1" };
  const set = applyEnv(parseEnv("EXISTING=2\nADDED=3"), target);
  assert.deepEqual(set, ["ADDED"]);
});
