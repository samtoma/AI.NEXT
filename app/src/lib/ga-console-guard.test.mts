/**
 * "GA is **never loaded** on the admin console" — asserted from the source tree
 * (ADR-0016 §2, contracts/analytics.md, research A1).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SOURCE-LEVEL TEST AND NOT A BUNDLE GREP
 * ---------------------------------------------------------------------------
 * The obvious check is `grep -r googletagmanager .next-admin/static | wc -l`
 * → 0. It needs a `next build` of the admin target, which takes minutes and
 * cannot run in `npm test`, so it would be a check nobody runs on the commit
 * that breaks it. Worse, it would answer the wrong question: `pageExtensions`
 * on the admin build keeps plain `.tsx`, so the student routes still compile
 * there and any module a student client component imports is in the admin
 * client bundle too. A passing grep would therefore be a fact about where a
 * string happens to live rather than about whether GA can run.
 *
 * So the invariant is restated as three things a reader can check by eye and a
 * test can check on every commit:
 *
 *  1. **No `(console)` file and no `layout.console.tsx` imports `lib/ga` or the
 *     `GaScript` component.** The console's own tree cannot call `track` and
 *     cannot render a tag.
 *  2. **The `<Script>` is rendered in exactly one place** — the student branch
 *     of `app/layout.tsx` — and that branch is the one the console build skips.
 *  3. **`googletagmanager.com` appears in exactly one source file**, a SERVER
 *     component, whose code never reaches any browser bundle on either build.
 *
 * Together those are stronger than the grep: (1) and (2) say GA cannot execute
 * on the console, and (3) says the domain is not shipped to a console browser
 * even as dead text.
 *
 * @covers FR-2504
 * @covers FR-2505
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    // Tests are excluded from the corpus: none of them ships, and a test that
    // NAMES the forbidden string in order to forbid it would otherwise be its
    // own first offender.
    else if (/\.(ts|tsx|mts)$/.test(entry) && !/\.test\.mts$/.test(entry)) out.push(full);
  }
  return out;
}

const ALL = walk(SRC);
const read = (f: string) => readFileSync(f, "utf8");
const rel = (f: string) => path.relative(SRC, f);

/** Every file the console build renders from: the `(console)` tree, whatever its name. */
const CONSOLE_FILES = ALL.filter(
  (f) => rel(f).includes(`app${path.sep}(console)${path.sep}`) || rel(f).endsWith(".console.tsx") || rel(f).endsWith(".console.ts")
);

test("the console tree is non-empty, so a passing test means something", () => {
  assert.ok(
    CONSOLE_FILES.length > 10,
    `expected the (console) tree to be found; got ${CONSOLE_FILES.length} files`
  );
});

test("no console file imports lib/ga or the GA script component", () => {
  const offenders = CONSOLE_FILES.filter((f) => {
    const src = read(f);
    return (
      /from\s+["'](@\/lib\/ga|\.{1,2}\/[^"']*\/ga|\.{1,2}\/ga)(\.ts)?["']/.test(src) ||
      /from\s+["'][^"']*GaScript["']/.test(src)
    );
  }).map(rel);
  assert.deepEqual(
    offenders,
    [],
    "a console file importing the GA wrapper is the whole control gone: the console " +
      "must never load GA at all, not load it and choose to send nothing"
  );
});

test("no console file mentions gtag, dataLayer or googletagmanager", () => {
  const offenders = CONSOLE_FILES.filter((f) => /gtag|dataLayer|googletagmanager/.test(read(f))).map(
    rel
  );
  assert.deepEqual(offenders, []);
});

test("googletagmanager.com appears in exactly one file, and it is a server component", () => {
  const hits = ALL.filter((f) => read(f).includes("googletagmanager")).map(rel);
  assert.deepEqual(
    hits,
    ["components/GaScript.tsx"],
    "the loader URL belongs to one server component, whose module never reaches a browser bundle"
  );
  assert.equal(
    read(path.join(SRC, "components", "GaScript.tsx")).includes('"use client"'),
    false,
    "GaScript must stay a server component, or the domain ships in the admin client bundle"
  );
});

/**
 * The two files allowed to name the vendor's API at all: the wrapper that owns
 * the call, and the one server component that renders its loader. Anything else
 * naming `gtag` or `dataLayer` is a second door.
 */
const GA_OWNERS = ["lib/ga.ts", "components/GaScript.tsx"];

test("only the wrapper and its one script component mention gtag or dataLayer", () => {
  // `track()` is the product's only door to GA. A second call site would mean
  // an event that no allow-list filtered, which is exactly the failure
  // contracts/analytics.md says ends the control. Asserted on the WORDS rather
  // than on a call-shaped regex: `dataLayer.push(['event', …])` is the same
  // bypass spelled differently, and a check that only caught `gtag(` would miss
  // it — including in a comment, which is where the next one will start.
  const offenders = ALL.filter(
    (f) => !GA_OWNERS.includes(rel(f)) && /gtag|dataLayer/.test(read(f))
  ).map(rel);
  assert.deepEqual(offenders, []);
});

test("the GA script is rendered in exactly one place, inside the student branch", () => {
  const renders = ALL.filter((f) => /<GaScript\b/.test(read(f))).map(rel);
  assert.deepEqual(renders, ["app/layout.tsx"], "one insertion point, by design");

  const layout = read(path.join(SRC, "app", "layout.tsx"));
  const consoleBranchAt = layout.indexOf("IS_CONSOLE ? (");
  const scriptAt = layout.indexOf("<GaScript");
  assert.ok(consoleBranchAt > -1, "the layout no longer branches on IS_CONSOLE");
  assert.ok(
    scriptAt > consoleBranchAt,
    "the tag must render inside the NON-console arm of the IS_CONSOLE ternary; " +
      "above it, it would render on the console build too"
  );
  // The non-console arm opens after `children` and the `) : (`. Assert the tag
  // is past that marker rather than merely past the ternary's start.
  const elseArmAt = layout.indexOf(") : (", consoleBranchAt);
  assert.ok(elseArmAt > -1 && scriptAt > elseArmAt, "the tag is in the console arm");
});

test("the wrapper is guarded by the measurement id, so an unset id renders nothing", () => {
  const src = read(path.join(SRC, "components", "GaScript.tsx"));
  assert.match(
    src,
    /if\s*\(!GA_MEASUREMENT_ID\)\s*return null/,
    "no id must mean no script tag at all, not a tag pointing at an empty id"
  );
});
