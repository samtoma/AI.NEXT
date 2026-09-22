/**
 * **The probe spawns the CLI the same way the product does** — asserted
 * against the source rather than promised in a comment (FR-3002).
 *
 * The obligation, in one sentence: *a probe that authenticates differently
 * from the product proves nothing about the product.* Authentication is
 * decided entirely by the environment the child process is given —
 * `CLAUDE_CONFIG_DIR`, `HOME`, and what the CLI reads out of them — so the
 * moment two call sites build that environment separately, the health tile
 * starts reporting on a program nobody serves students from. It would still be
 * green. It would just be green about the wrong thing, which is worse than
 * being absent.
 *
 * **This test IS that obligation.** Nothing else can hold it: the type system
 * cannot express "this object literal must not be written here", and a review
 * catches it only for as long as somebody remembers — and the failure arrives
 * the way these always do, one hurried file at a time, in the middle of an
 * incident when somebody is adding a fourth surface.
 *
 * It is the same mechanism `design-variant-scan.test.mts` and
 * `feedback-isolation.test.mts` use, for the same reason and with the same
 * limits: it reads text, so it can be defeated by somebody determined, and it
 * cannot be defeated by somebody in a hurry — which is who actually breaks
 * things.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT SCANS, AND WHY THOSE FILES
 * ---------------------------------------------------------------------------
 * Every file in the repository that spawns a child process at all, found by
 * searching for `child_process` rather than by listing paths: a list would go
 * stale the day a fifth surface is added, and going stale silently is the
 * whole failure mode here. Of those, the ones that spawn `claude` must take
 * their binary and their environment from `lib/claude-cli.ts`.
 *
 * `lib/claude-cli.ts` itself is the exemption, because it is the definition.
 *
 * @covers FR-3002
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";

/** `app/` — both `src/` and `scripts/` are in scope; the probe lives in the
 *  latter, and it is the file this test exists for. */
const APP = fileURLToPath(new URL("../..", import.meta.url));

const ROOTS = ["src", "scripts"];
const EXTENSIONS = [".ts", ".tsx", ".mts"];

/** The one file allowed to build a PATH for the CLI: it is the definition. */
const DEFINITION = "src/lib/claude-cli.ts";

/** Test files say these names in order to check them. */
const TESTS_THAT_MAY_QUOTE = new Set([
  "src/lib/claude-cli.test.mts",
  "src/lib/claude-cli-seam.test.mts",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTENSIONS.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

const FILES = ROOTS.flatMap((r) => walk(join(APP, r))).map((f) => ({
  path: relative(APP, f).split(sep).join("/"),
  source: readFileSync(f, "utf8"),
}));

/**
 * Comments stripped, so prose about the seam is not itself a violation.
 *
 * This codebase explains WHY at length and every header this feature added
 * discusses `PATH` and `.local/bin` repeatedly. A scan that counted prose would
 * make writing about the design a build failure, which is a tax on exactly the
 * behaviour the repository is trying to encourage. What is scanned is CODE.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SPAWNERS = FILES.filter(
  (f) =>
    code(f.source).includes("child_process") &&
    f.path !== DEFINITION &&
    // The two test files name the seam's symbols in order to check them, and a
    // scanner that matched itself would be permanently red for saying what it
    // scans for.
    !TESTS_THAT_MAY_QUOTE.has(f.path)
);

/* ------------------------------------------------------------- the scan */

test("the files that spawn the CLI are the four we think they are", () => {
  // Enumerated so that a FIFTH one arriving is a visible event rather than a
  // silent one. A new spawner is not a failure — it is a decision, and the
  // decision is "does this need the health probe to speak for it?".
  const claudeSpawners = SPAWNERS.filter((f) => code(f.source).includes("CLAUDE_BIN")).map(
    (f) => f.path
  );
  assert.deepEqual(claudeSpawners.sort(), [
    "scripts/probe-runtime.mts",
    "src/app/api/ask/route.ts",
    "src/app/api/understanding/route.ts",
    "src/lib/uploads.ts",
  ]);
});

test("nothing spawns a binary literally named `claude`", () => {
  // The binary name goes through `CLAUDE_BIN`. A literal would survive a
  // rename of the seam and would be the one call site the probe does not speak
  // for.
  for (const f of SPAWNERS) {
    if (TESTS_THAT_MAY_QUOTE.has(f.path)) continue;
    assert.ok(
      !/spawn\w*\(\s*["'`]claude["'`]/.test(code(f.source)),
      `${f.path} spawns a literal "claude" instead of CLAUDE_BIN — the health ` +
        `probe cannot speak for a call site it does not share a seam with`
    );
  }
});

test("**nothing builds its own PATH for the CLI** — the one that matters", () => {
  // The exact shape that was copied three times before this module existed:
  //
  //   env: { ...process.env, PATH: `${process.env.PATH}:${process.env.HOME}/.local/bin` }
  //
  // Authentication lives in that object. Four copies of it is four things that
  // can drift, and the drift is invisible until a probe says "fine" about a
  // product that is failing every turn.
  for (const f of FILES) {
    if (f.path === DEFINITION) continue;
    if (TESTS_THAT_MAY_QUOTE.has(f.path)) continue;
    assert.ok(
      !code(f.source).includes(".local/bin"),
      `${f.path} builds its own CLI PATH — use claudeEnv() from lib/claude-cli.ts`
    );
  }
});

test("every CLI spawner passes `env: claudeEnv(...)`", () => {
  for (const f of SPAWNERS) {
    const src = code(f.source);
    if (!src.includes("CLAUDE_BIN")) continue;
    assert.ok(
      /env:\s*claudeEnv\(/.test(src),
      `${f.path} spawns the CLI without claudeEnv() — its authentication is ` +
        `then its own, and the probe's verdict says nothing about it`
    );
  }
});

/* ---------------------------------------------- and the probe's own rules */

const PROBE = FILES.find((f) => f.path === "scripts/probe-runtime.mts");

test("the probe exists and is a script, not a route", () => {
  assert.ok(PROBE, "scripts/probe-runtime.mts is missing");
  // A probe reachable from a request handler would spawn the CLI on a page
  // load: it would bill a founder for curiosity, and it would turn one hung
  // CLI into a hung console — on the page an operator opens precisely when
  // they suspect something is wrong.
  assert.ok(
    code(PROBE!.source).includes("withMaint"),
    "the probe must write as ainext_maint; the app role has no grant here at all"
  );
});

test("no request handler spawns the CLI to answer a health question", () => {
  // The three routes that spawn the CLI do so to TEACH. None of them may
  // import the health arithmetic and call the CLI on its behalf, and nothing
  // under `app/` may import the probe.
  for (const f of FILES) {
    if (!f.path.startsWith("src/app/")) continue;
    assert.ok(
      !code(f.source).includes("probe-runtime"),
      `${f.path} imports the probe — a page load must never spawn the CLI`
    );
  }
});

test("the probe stores a code, never the CLI's own words", () => {
  const src = code(PROBE!.source);
  assert.ok(src.includes("classifyCliFailure"), "the probe must classify rather than record text");
  // The INSERT's column list is the assertion: five columns, none of which can
  // hold prose from a CLI. Migration 026 has no `detail` column at all, and
  // this is the application-side half of that refusal.
  assert.ok(
    /INSERT INTO runtime_health \(environment, probe, ok, code, duration_ms\)/.test(src),
    "the probe writes columns other than the five migration 026 defines"
  );
  assert.ok(
    !/errText/.test(src.split("function record")[1] ?? ""),
    "the CLI's stderr reaches the write path"
  );
});
