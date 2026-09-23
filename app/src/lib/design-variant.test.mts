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
 *
 * ---------------------------------------------------------------------------
 * BOTH POSITIONS OF THE MASTER SWITCH (ADR-0017 Amendment, 2026-09-23)
 * ---------------------------------------------------------------------------
 * Master is hidden behind `MASTER_VARIANT_ENABLED`. The rule above is not
 * deleted, so the cases that prove it pass `ON` explicitly — they describe
 * what the product does the day Master comes back, and they must still hold
 * then. The section at the end passes `OFF` and proves the other half: while
 * Master is hidden, every student and every operator is Play, whatever the
 * grade and whatever is stored.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_DESIGN_VARIANT,
  DESIGN_VARIANTS,
  DESIGN_VARIANT_LABELS,
  MASTER_VARIANT_ENABLED,
  OPERATOR_DEFAULT_VARIANT,
  asDesignVariant,
  isDesignVariant,
  isSelectableVariant,
  operatorDefaultVariant,
  resolveVariant,
  resolveVariantForOperator,
  selectableVariants,
  variantForGrade,
} from "./design-variant.ts";
import { GRADES, LEGACY_PREP3 } from "./profile.ts";

/** Master enabled — the grade rule as ADR-0017 pins it. */
const ON = { masterEnabled: true } as const;
/** Master hidden — the 2026-09-23 amendment. */
const OFF = { masterEnabled: false } as const;

/* ------------------------------------------------------------------ */
/* The grade rule                                                      */
/* ------------------------------------------------------------------ */

test("Preparatory gets Play — all three years, not just the one we serve", () => {
  // 9 alone passing would leave 7 and 8 unproved, and the product's own
  // signup form offers all six years today.
  assert.equal(variantForGrade("7", ON), "play");
  assert.equal(variantForGrade("8", ON), "play");
  assert.equal(variantForGrade("9", ON), "play");
});

test("with Master enabled, Secondary gets Master — all three years", () => {
  assert.equal(variantForGrade("10", ON), "master");
  assert.equal(variantForGrade("11", ON), "master");
  assert.equal(variantForGrade("12", ON), "master");
});

test("with Master enabled, the boundary is between 9 and 10, and nowhere else", () => {
  // The single assertion the whole key rests on. ADR-0017: "the boundary is
  // the Preparatory/Secondary line; Preparatory 3 is on the Play side."
  assert.notEqual(variantForGrade("9", ON), variantForGrade("10", ON));
  assert.equal(variantForGrade("9", ON), "play");
  assert.equal(variantForGrade("10", ON), "master");
});

test("every grade the product knows resolves to a named variant", () => {
  // Not one of them may fall through to the default by accident: a grade that
  // silently defaulted would look correct for Preparatory and be wrong for
  // Secondary, which is exactly the failure that would go unnoticed in a
  // Prep-3-only pilot.
  for (const grade of GRADES) {
    const v = variantForGrade(grade, ON);
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
  assert.equal(variantForGrade(LEGACY_PREP3, ON), variantForGrade("9", ON));
  assert.equal(variantForGrade(LEGACY_PREP3, ON), "play");
});

test("whitespace around a stored grade does not change the answer", () => {
  assert.equal(variantForGrade(" 10 ", ON), "master");
});

/* ------------------------------------------------------------------ */
/* The default, which is a decision and not a fallthrough               */
/* ------------------------------------------------------------------ */

test("an unknown grade is Play — the safe failure is the legible one", () => {
  // ADR-0017: "Default when grade is unknown or unreadable: Play. Failing to
  // the younger-audience variant is the safe failure: it is larger, higher-
  // contrast and easier to hit."
  assert.equal(variantForGrade(null, ON), "play");
  assert.equal(variantForGrade(undefined, ON), "play");
  assert.equal(variantForGrade("", ON), "play");
  assert.equal(variantForGrade("   ", ON), "play");
  assert.equal(variantForGrade("13", ON), "play");
  assert.equal(variantForGrade("Year 11", ON), "play");
  assert.equal(variantForGrade("première", ON), "play");
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
  assert.equal(resolveVariant("9", null, ON), "play");
  assert.equal(resolveVariant("11", null, ON), "master");
  assert.equal(resolveVariant("9", undefined, ON), "play");
  assert.equal(resolveVariant("11", undefined, ON), "master");
});

test("with Master enabled, the override beats the grade rule in BOTH directions", () => {
  // The case the mechanism exists for, and the one a Prep-3-only pilot cannot
  // produce: a Secondary student who wants the louder skin, and a Preparatory
  // student who wants the quiet one.
  assert.equal(resolveVariant("11", "play", ON), "play");
  assert.equal(resolveVariant("9", "master", ON), "master");
});

test("the override beats the DEFAULT too, not only an explicit grade", () => {
  // A student with no grade on file who has chosen Master must get Master. If
  // the default were applied before the override, this is where it would show.
  assert.equal(resolveVariant(null, "master", ON), "master");
  assert.equal(resolveVariant("", "master", ON), "master");
  assert.equal(resolveVariant("nonsense", "master", ON), "master");
});

test("an override that agrees with the grade is still an override", () => {
  // Storing `play` for a Prep-3 student is not a no-op: it is the record that
  // she chose, and it must survive her grade being corrected later. The
  // resolver cannot see the difference — the STORAGE does, and that is why
  // `null` and `"play"` are kept apart all the way down to the column.
  assert.equal(resolveVariant("9", "play", ON), "play");
  assert.equal(resolveVariant("12", "master", ON), "master");
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

test("with Master enabled, the console defaults to Master and not to the student default", () => {
  // An operator tool is not a children's surface, and no operator has a grade.
  // If these two defaults ever became the same value this assertion is what
  // says so, rather than the console quietly becoming a cartoon.
  assert.equal(operatorDefaultVariant(ON), "master");
  assert.notEqual(operatorDefaultVariant(ON), DEFAULT_DESIGN_VARIANT);
  assert.equal(resolveVariantForOperator(null, ON), "master");
  assert.equal(resolveVariantForOperator(undefined, ON), "master");
});

test("an operator's own preference wins over the console default", () => {
  assert.equal(resolveVariantForOperator("play", ON), "play");
  assert.equal(resolveVariantForOperator("master", ON), "master");
});

test("the console never resolves to no variant", () => {
  // Constitution XII binds the console: it is skinned, not unskinned. An
  // `undefined` here would render the frozen baseline's identity on an
  // operator's screen and look like a deliberate third appearance.
  for (const stored of [null, undefined, "play", "master"] as const) {
    assert.ok(
      (DESIGN_VARIANTS as readonly string[]).includes(resolveVariantForOperator(stored, ON)),
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

/* ------------------------------------------------------------------ */
/* Master hidden — the 2026-09-23 amendment                            */
/* ------------------------------------------------------------------ */

test("Master is hidden today — flipping it is Samuel's decision, not a refactor", () => {
  // A tripwire, not a tautology: turning Master back on is recorded as a
  // decision (ADR-0017, Amendment 2026-09-23) and lands with Master's published
  // tokens. Whoever flips the switch updates this line in the same change.
  assert.equal(MASTER_VARIANT_ENABLED, false);
});

test("with Master hidden, every grade is Play", () => {
  for (const grade of [...GRADES, LEGACY_PREP3, " 10 ", null, undefined, "", "13"]) {
    assert.equal(variantForGrade(grade, OFF), "play", `grade ${String(grade)}`);
  }
});

test("with Master hidden, a stored override does not bring it back", () => {
  // The override stays in the column — nothing is migrated — but it is not
  // honoured while the switch is off, in either direction and with any grade.
  for (const grade of ["9", "10", "11", "12", null, "nonsense"]) {
    assert.equal(resolveVariant(grade, "master", OFF), "play", `grade ${String(grade)} + master`);
    assert.equal(resolveVariant(grade, "play", OFF), "play", `grade ${String(grade)} + play`);
    assert.equal(resolveVariant(grade, null, OFF), "play", `grade ${String(grade)} + none`);
    assert.equal(resolveVariant(grade, undefined, OFF), "play", `grade ${String(grade)} + undefined`);
  }
});

test("with Master hidden, every operator is Play and the console default is Play", () => {
  assert.equal(operatorDefaultVariant(OFF), "play");
  for (const stored of [null, undefined, "play", "master"] as const) {
    assert.equal(resolveVariantForOperator(stored, OFF), "play", `stored=${stored}`);
  }
});

test("with Master hidden, only Play can be chosen; with it enabled, both can", () => {
  assert.deepEqual([...selectableVariants(OFF)], ["play"]);
  assert.deepEqual([...selectableVariants(ON)], ["play", "master"]);

  // What both appearance endpoints use to refuse a write.
  assert.equal(isSelectableVariant("play", OFF), true);
  assert.equal(isSelectableVariant("master", OFF), false);
  assert.equal(isSelectableVariant("master", ON), true);
  assert.equal(isSelectableVariant("noor", ON), false);
  assert.equal(isSelectableVariant(null, ON), false);

  // The VOCABULARY is unchanged: a `master` row stored before the switch was
  // turned off still narrows to itself, so turning it back on restores it.
  assert.equal(asDesignVariant("master"), "master");
  assert.equal(isDesignVariant("master"), true);
});

test("production callers get the switch as it stands", () => {
  // Every resolver's default must be exactly the explicit call with the
  // constant — otherwise the suite above proves a product that is not shipped.
  const now = { masterEnabled: MASTER_VARIANT_ENABLED };
  for (const grade of ["9", "11", null]) {
    assert.equal(variantForGrade(grade), variantForGrade(grade, now));
    for (const override of [null, "play", "master"] as const) {
      assert.equal(resolveVariant(grade, override), resolveVariant(grade, override, now));
    }
  }
  for (const stored of [null, "play", "master"] as const) {
    assert.equal(resolveVariantForOperator(stored), resolveVariantForOperator(stored, now));
  }
  assert.equal(OPERATOR_DEFAULT_VARIANT, operatorDefaultVariant(now));
  assert.deepEqual(selectableVariants(), selectableVariants(now));
});
