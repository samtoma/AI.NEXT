import { test } from "node:test";
import assert from "node:assert/strict";

import { widgetHint } from "./widget-hint.ts";

const choices = {
  kind: "line_drawer",
  spec: { mode: "equation", m: 1, b: 2 },
  diagnostics: [{ predicate: "intercept-wrong", misconception_id: "mc:pp3u1-4-3:line-always-through-origin" }],
  hints: [{ predicate: "slope-sign-flipped", step: 2, text: "Check the sign of $f(x)$ at your second point." }],
  pending_hints: [{ predicate: "off-target", step: 1, text: "held", why: "gives the answer" }],
};

test("a confirmed hint is served for its predicate when no misconception was diagnosed", () => {
  assert.deepEqual(widgetHint(choices, "slope-sign-flipped", null), {
    predicate: "slope-sign-flipped",
    step: 2,
    text: "Check the sign of $f(x)$ at your second point.",
  });
});

test("a diagnosed misconception wins: its refutation is served, never the hint", () => {
  assert.equal(widgetHint(choices, "slope-sign-flipped", "mc:x:y"), null);
});

test("a held hint is never read, nor a predicate with no hint", () => {
  assert.equal(widgetHint(choices, "off-target", null), null);
  assert.equal(widgetHint(choices, "vertical-line", null), null);
  assert.equal(widgetHint({ kind: "pair_plotter" }, "swapped-coordinates", null), null);
  assert.equal(widgetHint(null, "x", null), null);
});
