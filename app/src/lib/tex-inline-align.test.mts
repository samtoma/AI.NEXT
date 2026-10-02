/**
 * `align*` INSIDE `$...$` RENDERS (the 2026-09-26 safety net). The app renders
 * every maths segment in KaTeX's inline mode, where the display-only `align` /
 * `align*` environments fail; `inlineSafeTex` renames them to `aligned`, which
 * the pipeline now emits and which KaTeX accepts inline. Checked with the
 * real KaTeX, in the same options `components/TeXRenderer.tsx` passes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import katex from "katex";

import { inlineSafeTex } from "./math-text.ts";

const render = (tex: string) => katex.renderToString(tex, { throwOnError: false, output: "html" });
const OLD = "\\begin{align*} 2x + 3 &= 7 \\\\ x &= 2 \\end{align*}";

test("align* is a KaTeX error inline — the failure this guards against", () => {
  assert.match(render(OLD), /katex-error/);
});

test("rewritten to aligned, the same rows render inline with no error", () => {
  const safe = inlineSafeTex(OLD);
  assert.equal(safe, "\\begin{aligned} 2x + 3 &= 7 \\\\ x &= 2 \\end{aligned}");
  assert.doesNotMatch(render(safe), /katex-error/);
  // the unstarred form too
  assert.equal(inlineSafeTex("\\begin{align}a&=b\\end{align}"), "\\begin{aligned}a&=b\\end{aligned}");
});

test("everything else is returned exactly as it came", () => {
  for (const tex of [
    "x^2 + bx + c",
    "\\begin{aligned} a &= b \\end{aligned}",
    "\\begin{alignedat}{2} a &= b \\end{alignedat}",
    "\\frac{1}{2}",
  ]) {
    assert.equal(inlineSafeTex(tex), tex);
  }
});

test("the renderer applies it before KaTeX", () => {
  const src = readFileSync(fileURLToPath(new URL("../components/TeXRenderer.tsx", import.meta.url)), "utf8");
  assert.match(src, /katex\.renderToString\(inlineSafeTex\(part\.slice\(1, -1\)\)/);
});
