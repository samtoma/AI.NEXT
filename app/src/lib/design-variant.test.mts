/**
 * The variant resolution table (ADR-0017, FR-1011).
 *
 * **No `@covers` annotation.** `traceability.md` was not edited by this work
 * and FR-1011's status is Samuel's to set; annotating the test against the
 * requirement would move a row in the matrix from a test file, which CLAUDE.md
 * calls laundering. The requirement is named in prose, here and in every
 * header this feature added, and that is the record until he sets it.
 *
 * What is being proved is the whole of ADR-0017's pinned parameter list, and
 * in particular the three cases that are hard to reach in a running system and
 * therefore never get exercised by hand:
 *
 *   · the Preparatory/Secondary boundary itself — 9 against 10 — which is the
 *     only edge the entire key turns on;
 *   · a grade that is missing, blank or nonsense, where the DEFAULT is a
 *     deliberate choice (Play: larger, higher contrast, bigger targets) and
 *     not an accident of the lookup returning undefined;
 *   · an override that DISAGREES with the grade in both directions, which is
 *     the case the whole override mechanism exists for and the one a pilot
 *     cohort of Prep-3 students can never produce.
 *
 * A suite that only checked "Prep 3 gets Play" would pass identically if the
 * boundary sat anywhere else, if the default were Master, or if the override
 * were ignored outright.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_DESIGN_VARIANT,
  DESIGN_VARIANTS,
  DESIGN_VARIANT_LABELS,
  OPERATOR_DEFAULT_VARIANT,
  asDesignVariant,
  isDesignVariant,
  resolveVariant,
  resolveVariantForOperator,
  variantForGrade,
} from "./design-variant.ts";
import { GRADES, LEGACY_PREP3 } from "./profile.ts";

/* ------------------------------------------------------------------ */
/* The grade rule                                                      */
/* ------------------------------------------------------------------ */

test("Preparatory gets Play — all three years, not just the one we serve", () => {
  // 9 alone passing would leave 7 and 8 unproved, and the product's own
  // signup form offers all six years today.
  assert.equal(variantForGrade("7"), "play");
  assert.equal(variantForGrade("8"), "play");
  assert.equal(variantForGrade("9"), "play");
});

test("Secondary gets Master — all three years", () => {
  assert.equal(variantForGrade("10"), "master");
  assert.equal(variantForGrade("11"), "master");
  assert.equal(variantForGrade("12"), "master");
});

test("the boundary is between 9 and 10, and nowhere else", () => {
  // The single assertion the whole key rests on. ADR-0017: "the boundary is
  // the Preparatory/Secondary line; Preparatory 3 is on the Play side."
  assert.notEqual(variantForGrade("9"), variantForGrade("10"));
  assert.equal(variantForGrade("9"), "play");
  assert.equal(variantForGrade("10"), "master");
});

test("every grade the product knows resolves to a named variant", () => {
  // Not one of them may fall through to the default by accident: a grade that
  // silently defaulted would look correct for Preparatory and be wrong for
  // Secondary, which is exactly the failure that would go unnoticed in a
  // Prep-3-only pilot.
  for (const grade of GRADES) {
    const v = variantForGrade(grade);
    assert.ok(
      (DESIGN_VARIANTS as readonly string[]).includes(v),
      `grade ${grade} resolved to ${v}`
    );
  }
});

test("the legacy prep-3 spelling is the same year as 9", () => {
  // `students.grade` holds both spellings: the PoC pinned every row to the
  // literal "prep-3". Without the fold those rows would land on the default,
  // which happens to be right for Prep 3 — a rule that is accidentally right
  // for today's only cohort is a rule that breaks on the first Secondary
  // student, so it is proved rather than relied on.
  assert.equal(variantForGrade(LEGACY_PREP3), variantForGrade("9"));
  assert.equal(variantForGrade(LEGACY_PREP3), "play");
});

test("whitespace around a stored grade does not change the answer", () => {
  assert.equal(variantForGrade(" 10 "), "master");
});

/* ------------------------------------------------------------------ */
/* The default, which is a decision and not a fallthrough               */
/* ------------------------------------------------------------------ */

test("an unknown grade is Play — the safe failure is the legible one", () => {
  // ADR-0017: "Default when grade is unknown or unreadable: Play. Failing to
  // the younger-audience variant is the safe failure: it is larger, higher-
  // contrast and easier to hit."
  assert.equal(variantForGrade(null), "play");
  assert.equal(variantForGrade(undefined), "play");
  assert.equal(variantForGrade(""), "play");
  assert.equal(variantForGrade("   "), "play");
  assert.equal(variantForGrade("13"), "play");
  assert.equal(variantForGrade("Year 11"), "play");
  assert.equal(variantForGrade("première"), "play");
});

test("the default is stated once and it is Play", () => {
  // If this constant is ever changed, the assertions above go red rather than
  // quietly agreeing with it — they name the literal on purpose.
  assert.equal(DEFAULT_DESIGN_VARIANT, "play");
});

/* ------------------------------------------------------------------ */
/* The override, which wins                                            */
/* ------------------------------------------------------------------ */

test("no override means the grade decides", () => {
  assert.equal(resolveVariant("9", null), "play");
  assert.equal(resolveVariant("11", null), "master");
  assert.equal(resolveVariant("9", undefined), "play");
  assert.equal(resolveVariant("11", undefined), "master");
});

test("the override beats the grade rule in BOTH directions", () => {
  // The case the mechanism exists for, and the one a Prep-3-only pilot cannot
  // produce: a Secondary student who wants the louder skin, and a Preparatory
  // student who wants the quiet one.
  assert.equal(resolveVariant("11", "play"), "play");
  assert.equal(resolveVariant("9", "master"), "master");
});

test("the override beats the DEFAULT too, not only an explicit grade", () => {
  // A student with no grade on file who has chosen Master must get Master. If
  // the default were applied before the override, this is where it would show.
  assert.equal(resolveVariant(null, "master"), "master");
  assert.equal(resolveVariant("", "master"), "master");
  assert.equal(resolveVariant("nonsense", "master"), "master");
});

test("an override that agrees with the grade is still an override", () => {
  // Storing `play` for a Prep-3 student is not a no-op: it is the record that
  // she chose, and it must survive her grade being corrected later. The
  // resolver cannot see the difference — the STORAGE does, and that is why
  // `null` and `"play"` are kept apart all the way down to the column.
  assert.equal(resolveVariant("9", "play"), "play");
  assert.equal(resolveVariant("12", "master"), "master");
});

/* ------------------------------------------------------------------ */
/* Narrowing an unknown stored value                                   */
/* ------------------------------------------------------------------ */

test("only the two variants are variants", () => {
  assert.equal(isDesignVariant("play"), true);
  assert.equal(isDesignVariant("master"), true);
  // `noor` is a CSS selector alias and never a stored value. A row holding it
  // would render Play by accident of the stylesheet rather than by decision.
  assert.equal(isDesignVariant("noor"), false);
  assert.equal(isDesignVariant("ledger"), false);
  assert.equal(isDesignVariant("Play"), false);
  assert.equal(isDesignVariant(null), false);
  assert.equal(isDesignVariant(undefined), false);
  assert.equal(isDesignVariant(1), false);
  assert.equal(isDesignVariant({}), false);
});

test("a stored value narrows to null rather than to a guess", () => {
  // The failure this prevents is specific: a value matching neither
  // `[data-ds="play"]` nor `[data-ds="master"]` would reach the document
  // element and render the frozen baseline's identity — the one appearance
  // that is supposed to mean "nobody chose a variant at all".
  assert.equal(asDesignVariant("play"), "play");
  assert.equal(asDesignVariant("master"), "master");
  assert.equal(asDesignVariant("noor"), null);
  assert.equal(asDesignVariant(null), null);
  assert.equal(asDesignVariant(undefined), null);
  assert.equal(asDesignVariant(""), null);
  assert.equal(asDesignVariant(7), null);
});

/* ------------------------------------------------------------------ */
/* The console, which answers a different question                     */
/* ------------------------------------------------------------------ */

test("the console defaults to Master and not to the student default", () => {
  // An operator tool is not a children's surface, and no operator has a grade.
  // If these two constants ever became the same value this assertion is what
  // says so, rather than the console quietly becoming a cartoon.
  assert.equal(OPERATOR_DEFAULT_VARIANT, "master");
  assert.notEqual(OPERATOR_DEFAULT_VARIANT, DEFAULT_DESIGN_VARIANT);
  assert.equal(resolveVariantForOperator(null), "master");
  assert.equal(resolveVariantForOperator(undefined), "master");
});

test("an operator's own preference wins over the console default", () => {
  assert.equal(resolveVariantForOperator("play"), "play");
  assert.equal(resolveVariantForOperator("master"), "master");
});

test("the console never resolves to no variant", () => {
  // Constitution XII binds the console: it is skinned, not unskinned. An
  // `undefined` here would render the frozen baseline's identity on an
  // operator's screen and look like a deliberate third appearance.
  for (const stored of [null, undefined, "play", "master"] as const) {
    assert.ok(
      (DESIGN_VARIANTS as readonly string[]).includes(resolveVariantForOperator(stored)),
      `console resolved to something that is not a variant for stored=${stored}`
    );
  }
});

/* ------------------------------------------------------------------ */
/* The set itself                                                      */
/* ------------------------------------------------------------------ */

test("there are exactly two variants, and `noor` is not one of them", () => {
  assert.deepEqual([...DESIGN_VARIANTS], ["play", "master"]);
  assert.deepEqual(Object.keys(DESIGN_VARIANT_LABELS).sort(), ["master", "play"]);
});
