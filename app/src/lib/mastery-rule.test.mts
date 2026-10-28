/**
 * "One mastery rule" (2026-10-28, proposal M1–M7): one lesson level on every
 * screen, the higher band cuts, question difficulty in BKT, and the evidence
 * rule for "Nailed it". Pure functions only; the route wiring is exercised in
 * the app.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BAND_CUTS,
  MASTERY_THRESHOLD,
  NAILED_IT_CAP,
  capWithoutEvidence,
  lessonLevel,
  masteryStage,
  reportMastery,
  untriedCount,
} from "./mastery.ts";
import { DEFAULT_PARAMS, bktUpdate, effectiveTier, paramsForQuestion, type QuestionTier } from "./bkt.ts";
import { deriveWeakestSubskill, restIsSolid } from "./checkin.ts";
import { MASTERED_GATE, PREREQ_GATE } from "./progression.ts";
import type { LessonLo } from "./types.ts";

test("M7: the cuts are 0.40 / 0.75 / 0.90, and the gates are stages on them", () => {
  assert.deepEqual(BAND_CUTS, { gettingThere: 0.4, almostThere: 0.75, nailedIt: 0.9 });
  assert.equal(masteryStage(0.39), 1);
  assert.equal(masteryStage(0.4), 2);
  assert.equal(masteryStage(0.74), 2);
  assert.equal(masteryStage(0.75), 3);
  assert.equal(masteryStage(0.89), 3);
  assert.equal(masteryStage(0.9), 4);
  assert.equal(MASTERED_GATE, MASTERY_THRESHOLD, "course complete = every objective at Nailed it");
  assert.equal(PREREQ_GATE, BAND_CUTS.gettingThere, "a prerequisite is ready at Getting there");
});

test("M1: one lesson level — the average score, untried counted as 0", () => {
  assert.equal(lessonLevel([]), 0);
  assert.equal(lessonLevel([0, 0]), 0, "nothing tried is Not started, not the prior");
  // the case the card and the map used to disagree on
  assert.equal(lessonLevel([0.98, 0.4, 0.4, 0.4]), 2);
  // two objectives at the top cannot make a four-objective lesson look done
  assert.equal(lessonLevel([0.98, 0.98, 0, 0]), 2);
  assert.equal(untriedCount([0.98, 0.98, 0, 0]), 2);
  assert.equal(lessonLevel([0.95, 0.92, 0.9]), 4);
});

const lo = (label: string, mastery: number): LessonLo => ({ id: `lo:${label}`, label, description: null, sourcePage: null, mastery });

test("M4: 'shaky' only below Almost there; 'everything else is solid' only when it is", () => {
  // one right answer used to be called shaky
  assert.equal(deriveWeakestSubskill([lo("a", 0.98), lo("b", 0.8)]), null);
  assert.equal(deriveWeakestSubskill([lo("a", 0.98), lo("b", 0.6)])?.label, "b");
  // untried parts are not "solid"
  assert.equal(restIsSolid([lo("a", 0.98), lo("b", 0.6), lo("c", 0)], "b"), false);
  assert.equal(restIsSolid([lo("a", 0.98), lo("b", 0.6), lo("c", 0.92)], "b"), true);
});

/** Run a sequence of (tier, right?) answers from the prior, as the route does. */
function run(seq: [QuestionTier, boolean][]): number {
  let p = DEFAULT_PARAMS.pInit;
  for (const [tier, ok] of seq) {
    p = bktUpdate(p, ok ? "correct" : "incorrect", paramsForQuestion(DEFAULT_PARAMS, { tier, questionType: "numeric" }))
      .afterTransit;
  }
  return p;
}

test("M6: a right answer on a hard question moves mastery more than one on an easy question", () => {
  const easy = run([["basic", true], ["basic", true]]);
  const hard = run([["advanced", true], ["advanced", true]]);
  assert.ok(hard > easy);
  assert.equal(masteryStage(easy), 3, "two easy questions stop at Almost there");
  assert.equal(masteryStage(hard), 4, "two hard questions reach Nailed it");
  // and a slip on a hard question costs less than one on an easy question
  const slipHard = run([["standard", true], ["standard", true], ["advanced", false]]);
  const slipEasy = run([["standard", true], ["standard", true], ["basic", false]]);
  assert.ok(slipHard > slipEasy);
});

test("M6: multiple choice guesses at one in the number of options; tutor-built tasks count as basic", () => {
  const mcq = paramsForQuestion(DEFAULT_PARAMS, { tier: "advanced", questionType: "mcq", optionCount: 4 });
  assert.equal(mcq.pGuess, 0.25);
  assert.equal(mcq.pInit, DEFAULT_PARAMS.pInit);
  assert.equal(mcq.pTransit, DEFAULT_PARAMS.pTransit);
  assert.ok(paramsForQuestion(DEFAULT_PARAMS, { tier: "basic", questionType: "mcq", optionCount: 2 }).pGuess + 0.05 < 1);
  assert.equal(effectiveTier("standard", true), "basic");
  assert.equal(effectiveTier("advanced", false), "advanced");
  assert.equal(effectiveTier(null, false), "basic");
});

test("M6 part 2: Nailed it needs the evidence; without it the score stops just under the cut", () => {
  assert.ok(NAILED_IT_CAP < MASTERY_THRESHOLD);
  assert.equal(masteryStage(NAILED_IT_CAP), 3);
  assert.equal(capWithoutEvidence(0.97, false, 0.8), NAILED_IT_CAP);
  assert.equal(capWithoutEvidence(0.97, true, 0.8), 0.97);
  assert.equal(capWithoutEvidence(0.6, false, 0.3), 0.6, "below the cut nothing changes");
  // a score stored above the cut before this rule is never pulled down by a right answer
  assert.equal(capWithoutEvidence(0.98, false, 0.98), 0.98);
  assert.equal(capWithoutEvidence(0.98, false, 0.95), 0.95);
});

test("M2: the report's level is stored mastery, with what moved this sitting", () => {
  const r = reportMastery(
    [
      { label: "Equal ordered pairs", now: 0.95, atStart: 0.5 },
      { label: "Cartesian product", now: 0.5, atStart: 0.5 },
      { label: "Arrow diagrams", now: 0, atStart: 0 },
    ],
    3
  );
  assert.equal(r.stage, lessonLevel([0.95, 0.5, 0]));
  assert.equal(r.untried, 1);
  assert.equal(r.answered, 3);
  assert.deepEqual(r.moved, [{ label: "Equal ordered pairs", from: 2, to: 4 }]);
});
