/**
 * **No surface hard-codes a variant** (ADR-0017, FR-1011) — asserted against
 * the source rather than promised in a comment.
 *
 * ADR-0017's last pinned parameter, in its own words: *"No surface may
 * hard-code a variant. A component that pins itself to Play or to Master is
 * the mixed build the handoff forbids, arrived at one file at a time."*
 *
 * **This test IS that obligation.** There is no other mechanism behind it: the
 * type system cannot express "this string must not appear", and a review
 * catches it only for as long as somebody remembers the rule. The failure it
 * guards against is textual and incremental — one harness page pinning the
 * skin it wants to look at, then a second, then a component — and it is caught
 * here in the second it takes to read the tree.
 *
 * It is not hypothetical. When FR-1011 was implemented, **two console
 * fixtures were already doing it**: `(console)/dev/math-widgets` and
 * `(console)/dev/widget-questions` each carried `data-ds="noor"` on a nested
 * `<main>`, pinning Play inside a document that was rendering something else.
 * That is the mixed build, and it had arrived exactly one file at a time. Both
 * were unpinned as part of this work, and an operator who wants to see those
 * widgets in the student's skin now picks Play on `/profile` — the setting
 * that replaced the attribute.
 *
 * **No `@covers` annotation**: `traceability.md` was not edited by this work
 * and FR-1011's status is Samuel's to set (CLAUDE.md on matrix laundering).
 *
 * ---------------------------------------------------------------------------
 * WHAT IT SCANS, AND WHY THE BOUNDARIES ARE WHERE THEY ARE
 * ---------------------------------------------------------------------------
 * Every `.ts`/`.tsx`/`.mts`/`.css` file under `app/src`, with **comments
 * stripped first**. Stripping is the difference between a test that can be
 * lived with and one that quietly trains people to stop explaining
 * themselves: this codebase documents WHY at length, every header this feature
 * added names the variants repeatedly, and a scan that counted prose would
 * make writing about the design system a build failure. What is scanned is
 * CODE — what actually reaches a browser.
 *
 * Four files are exempt, and each for a stated reason:
 *
 *   `app/globals.css`      defines the variants. It is the stylesheet.
 *   `app/layout.tsx`       writes the attribute. It is the one writer.
 *   `lib/design-variant.ts`  owns the vocabulary the other two use.
 *   the two test files      say the names in order to check them.
 *
 * Note what is NOT exempt and passes anyway: `lib/design-variant-queries.ts`,
 * both route handlers, `DesignVariantPicker.tsx`, the student settings page
 * and the console profile page all take every variant name from
 * `lib/design-variant.ts` and contain no literal of their own. That is the
 * point of the exemption list being four entries long rather than "everything
 * that touches the feature".
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";

const SRC = fileURLToPath(new URL("..", import.meta.url));

/** Paths under `src/`, in POSIX spelling, that may say a variant's name. */
const EXEMPT = new Set([
  "app/globals.css",
  "app/layout.tsx",
  "lib/design-variant.ts",
  "lib/design-variant.test.mts",
  "lib/design-variant-scan.test.mts",
]);

/**
 * A string literal whose WHOLE content is a variant name.
 *
 * Whole content, not "contains": `followLabel="Console default — Master"` is
 * copy an operator reads and `aria-label="Noor"` is the product's name, while
 * `"play"` on its own is only ever a pin. Lower-case only, for the same
 * reason — the stored value, the attribute value and the CSS selector value
 * are all lower-case, and the capitalised forms are display labels.
 *
 * `noor` is in the list although nothing stores it: it is the CSS alias, and a
 * component writing it would get Play by accident of the stylesheet rather
 * than by anybody's decision.
 */
const PINNED_LITERAL = /(['"`])(play|master|noor)\1/;

/** The attribute itself, wherever it is written with a value. */
const ATTRIBUTE = "data-ds=";

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...filesUnder(full));
    } else if (/\.(ts|tsx|mts|css)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** `src`-relative, POSIX spelling, so the exemption list reads the same on any OS. */
function key(file: string): string {
  return relative(SRC, file).split(sep).join("/");
}

/**
 * Code with comments removed: `/* … *\/` blocks, and whole lines that are
 * `//` or a `*` continuation.
 *
 * A TRAILING `// …` on a line of code is deliberately left alone. Stripping it
 * means finding where a `//` stops being a URL inside a string literal, and
 * getting that wrong produces a test that silently scans less than it claims
 * to. Leaving it means a trailing comment naming a variant would be a false
 * positive — which is a loud failure somebody fixes by moving the sentence up
 * a line, and loud-and-wrong beats quiet-and-weak in a test whose whole job is
 * to catch something nobody is looking for.
 */
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

function scannedFiles(): { path: string; code: string }[] {
  return filesUnder(SRC)
    .filter((f) => !EXEMPT.has(key(f)))
    .map((f) => ({ path: key(f), code: code(readFileSync(f, "utf8")) }));
}

/* ------------------------------------------------------------------ */
/* The obligation                                                      */
/* ------------------------------------------------------------------ */

test("no surface outside the stylesheet and the layout writes data-ds", () => {
  const files = scannedFiles();
  assert.ok(files.length >= 50, "the scan found almost nothing — the path is wrong, not the code");

  const offenders = files
    .filter((f) => f.code.includes(ATTRIBUTE))
    .map((f) => f.path);

  assert.deepEqual(
    offenders,
    [],
    "ADR-0017: exactly one variant per page render, written once by app/layout.tsx.\n" +
      "A nested data-ds is two variants in one document — the mixed build the handoff\n" +
      "forbids. If this surface needs the other skin, that is a PREFERENCE (/settings,\n" +
      "or /profile on the console), not an attribute."
  );
});

test("no surface pins itself to a named variant", () => {
  const offenders: string[] = [];
  for (const f of scannedFiles()) {
    const hit = PINNED_LITERAL.exec(f.code);
    if (hit) offenders.push(`${f.path} contains the literal ${hit[0]}`);
  }

  assert.deepEqual(
    offenders,
    [],
    "ADR-0017: no surface may hard-code a variant.\n" +
      "Take the value from lib/design-variant.ts (DESIGN_VARIANTS, the resolvers,\n" +
      "or a prop resolved on the server) rather than naming one here."
  );
});

/* ------------------------------------------------------------------ */
/* Present, and single                                                 */
/* ------------------------------------------------------------------ */

test("exactly one file in the application writes the attribute", () => {
  // The other half of the assertion above: a test that only forbade the
  // attribute would pass on a build that had stopped writing it at all, and a
  // document with NO data-ds renders the frozen baseline's identity — which
  // ADR-0017 says "is a bug rather than a silent choice".
  const writers = filesUnder(SRC)
    .filter((f) => key(f).endsWith(".tsx") || key(f).endsWith(".ts"))
    .filter((f) => code(readFileSync(f, "utf8")).includes(ATTRIBUTE))
    .map(key);

  assert.deepEqual(writers, ["app/layout.tsx"]);
});

test("the layout writes it ONCE, from the resolved value, never from a literal", () => {
  const layout = code(readFileSync(join(SRC, "app/layout.tsx"), "utf8"));

  // Once. A second `data-ds` on any element inside the shell — a wrapper, a
  // portal root, a branch of a ternary — is a second variant in one document.
  const occurrences = layout.split(ATTRIBUTE).length - 1;
  assert.equal(
    occurrences,
    1,
    `app/layout.tsx writes data-ds ${occurrences} times; ADR-0017 allows exactly one per render`
  );

  // From the resolved value. `data-ds="play"` or a ternary over the
  // environment would both satisfy "once" and neither would be resolution.
  assert.match(
    layout,
    /data-ds=\{variant\}/,
    "the attribute must carry the resolved variant, not a literal or a branch"
  );

  // Resolved SERVER-SIDE, in the same render that produces the document. This
  // is the property the whole feature turns on: a value awaited here is in the
  // first HTML response, and a value computed in the browser is one paint too
  // late by construction.
  assert.match(
    layout,
    /const variant = await documentVariant\(\)/,
    "the variant must be awaited in the layout body — not read in an effect, " +
      "not passed from a client component, not defaulted here"
  );
  assert.ok(
    !layout.includes("use client"),
    "app/layout.tsx must stay a server component, or nothing above holds"
  );
});

/* ------------------------------------------------------------------ */
/* The alias                                                           */
/* ------------------------------------------------------------------ */

test("globals.css names both variants and keeps `noor` working", () => {
  // Comments stripped here too, and for a reason this test would otherwise
  // get wrong: the header above the variant blocks discusses all three
  // spellings at length, and counting prose would make the selector tally
  // below meaningless. What is counted is selectors.
  const css = code(readFileSync(join(SRC, "app/globals.css"), "utf8"));

  assert.ok(css.includes('[data-ds="master"]'), "Master must be a NAMED sibling, not the unnamed default");
  assert.ok(css.includes('[data-ds="play"]'), "Play must be reachable by its own name");
  assert.ok(
    css.includes('[data-ds="noor"]'),
    "the `noor` alias must keep working — the published artifact and the handoff still say it"
  );

  // Every Play rule must carry BOTH spellings. A block that kept only one
  // would un-skin half the product for whichever name is still being written.
  const playRules = css.match(/\[data-ds="play"\]/g)?.length ?? 0;
  const aliasRules = css.match(/\[data-ds="noor"\]/g)?.length ?? 0;
  assert.ok(playRules > 20, `only ${playRules} Play selectors found — the skin did not survive the rename`);
  assert.equal(
    playRules,
    aliasRules,
    "every Play selector must list the `noor` alias beside it, or the alias is partial — " +
      "which is worse than dropping it, because half a skin looks like a bug in a component"
  );
});
