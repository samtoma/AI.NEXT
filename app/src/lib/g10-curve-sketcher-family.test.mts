/**
 * T417 (FR-4320): a Grade 10 unit whose LIVE curve_sketcher bank holds one of
 * the five families `curve_sketcher_g10` documents (hyperbola, exponential,
 * sine, cosine, tangent) is told about that key instead of the original
 * "curve_sketcher" entry (linear, quadratic only) — `lib/widget-docs.ts`'s own
 * comment on that key names this as the reachable fix, and this is it
 * (`lib/lesson.ts`'s `hasG10CurveFamily`).
 *
 * Two tiny units, over the REAL `getLessonData` + `learnPrompt` through a fake
 * pool (`prompt-fixture-pool.mts`, the same seam `g10-prompts.test.mts` uses)
 * — one whose only live curve_sketcher question is "quadratic" (one of the
 * ORIGINAL two families) and one whose only one is "hyperbola" (one of the
 * FIVE NEW ones). Both live in the real Grade 10 course
 * (`course:us-g10-math-en`, `lessonWidgets: "module-questions"`), so
 * `ownUnitWidgets` and the widget-docs substitution run for real, not stubbed.
 *
 * National (Prep-3) never sets `hasG10CurveFamily` — proven by
 * `national-prompts.test.mts`'s and `g10-prompts.test.mts`'s existing goldens
 * staying byte-identical (neither fixture's curve_sketcher questions use a G10
 * family), which this file does not re-prove.
 *
 * @covers FR-4320
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { installFixturePool } from "./prompt-fixture-pool.mts";
import { US_G10_MATH_EN } from "./courses.ts";

const MODULE_ORIGINAL = "module:g10fam-orig";
const MODULE_NEW = "module:g10fam-new";
const LO_ORIGINAL = "lo:g10fa-1-1";
const LO_NEW = "lo:g10fb-1-1";

installFixturePool({
  docs: [],
  nodes: [
    { id: US_G10_MATH_EN, kind: "course", label: "Mathematics — Grade 10" },
    { id: MODULE_ORIGINAL, kind: "module", label: "Quadratics", order_in_parent: 1 },
    { id: MODULE_NEW, kind: "module", label: "Hyperbolas", order_in_parent: 2 },
    {
      id: LO_ORIGINAL,
      kind: "learning_objective",
      label: "Sketch a quadratic",
      syllabus_ref: "9.1",
      order_in_parent: 1,
      source_page: 101,
    },
    {
      id: LO_NEW,
      kind: "learning_objective",
      label: "Sketch a hyperbola",
      syllabus_ref: "9.2",
      order_in_parent: 1,
      source_page: 202,
    },
  ],
  edges: [
    { src: MODULE_ORIGINAL, dst: US_G10_MATH_EN, type: "part_of" },
    { src: MODULE_ORIGINAL, dst: LO_ORIGINAL, type: "teaches" },
    { src: MODULE_NEW, dst: US_G10_MATH_EN, type: "part_of" },
    { src: MODULE_NEW, dst: LO_NEW, type: "teaches" },
  ],
  questions: [
    {
      id: "q:g10fa-1-1:w001",
      lo_id: LO_ORIGINAL,
      tier: "standard",
      question_type: "widget",
      stem: "Sketch $y = x^2 - 4$.",
      choices: { kind: "curve_sketcher", spec: { fn: "quadratic", coefs: [1, 0, -4] }, diagnostics: [] },
      correct_answer: "ok",
      canonical_solution: [],
      source_page: 101,
    },
    {
      id: "q:g10fb-1-1:w001",
      lo_id: LO_NEW,
      tier: "standard",
      question_type: "widget",
      stem: "Sketch $y = 2/x - 1$.",
      choices: { kind: "curve_sketcher", spec: { fn: "hyperbola", coefs: [2, -1] }, diagnostics: [] },
      correct_answer: "ok",
      canonical_solution: [],
      source_page: 202,
    },
  ],
  visuals: [],
});

const { getLessonData, learnPrompt } = await import("./lesson.ts");

// Text unique to each widget-docs entry (widget-docs.ts): the original
// curve_sketcher line names the vertical-line-test rejection; the G10 entry
// names the asymptote-crossed one, which the original does not offer at all.
const ORIGINAL_ONLY = "vertical line test";
const G10_ONLY = "asymptote-crossed";

test("a unit whose live curve_sketcher bank is quadratic-only stays on the original entry", async () => {
  const data = await getLessonData("g10fa-1", null);
  assert.ok(data, "lesson resolved");
  assert.ok(data!.unitWidgets?.includes("curve_sketcher"), "curve_sketcher is one of this unit's live widgets");
  assert.equal(data!.hasG10CurveFamily, undefined, "the original two families never set the flag");

  const prompt = learnPrompt(data!, false);
  assert.ok(prompt.includes(ORIGINAL_ONLY), "the original curve_sketcher entry is documented");
  assert.ok(!prompt.includes(G10_ONLY), "the five-family entry is NOT pulled in for an original-only unit");
});

test("a unit whose live curve_sketcher bank holds a hyperbola/exponential/trig question is told about curve_sketcher_g10 instead", async () => {
  const data = await getLessonData("g10fb-1", null);
  assert.ok(data, "lesson resolved");
  assert.ok(data!.unitWidgets?.includes("curve_sketcher"), "curve_sketcher is one of this unit's live widgets");
  assert.equal(data!.hasG10CurveFamily, true, "a G10 family question sets the flag");

  const prompt = learnPrompt(data!, false);
  assert.ok(prompt.includes(G10_ONLY), "the five-family entry is documented");
  assert.ok(!prompt.includes(ORIGINAL_ONLY), "the original two-family entry is NOT the one pulled in");
});
