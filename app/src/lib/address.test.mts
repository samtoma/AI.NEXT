/**
 * The address register itself (FR-2602, FR-2605).
 *
 * The defect these tests exist against is not "the prompt had a bug": it is
 * that the masculine was the default, everywhere, for everyone. So the
 * assertions that matter most are the negative ones — that `unspecified` and
 * `null` produce no masculine form at all, in either language.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  addressBlock,
  addressForms,
  registerOf,
  type Gender,
} from "./address.ts";

const UNKNOWN: Gender[] = [null, "unspecified"];

test("the three registers, and null is not the masculine", () => {
  assert.equal(registerOf("female"), "feminine");
  assert.equal(registerOf("male"), "masculine");
  for (const g of UNKNOWN) assert.equal(registerOf(g), "either");
});

test("English forms agree with their verbs", () => {
  const f = addressForms("female");
  assert.deepEqual(
    [f.they, f.them, f.their, f.themself, f.is, f.has, f.does, f.s],
    ["she", "her", "her", "herself", "is", "has", "does", "s"]
  );
  const m = addressForms("male");
  assert.deepEqual(
    [m.they, m.them, m.their, m.themself, m.is, m.has, m.does, m.s],
    ["he", "him", "his", "himself", "is", "has", "does", "s"]
  );
  const n = addressForms(null);
  assert.deepEqual(
    [n.they, n.them, n.their, n.themself, n.is, n.has, n.does, n.s],
    ["they", "them", "their", "themselves", "are", "have", "do", ""]
  );
  // the contractions the check-in copy needs: "they've had", "they're ready"
  assert.equal(`${n.they}${n.hasContr} had`, "they've had");
  assert.equal(`${n.they}${n.isContr} ready`, "they're ready");
  assert.equal(`${addressForms("female").they}${addressForms("female").isContr} ready`, "she's ready");
});

test("the unknown register contains no masculine form, in either language", () => {
  for (const g of UNKNOWN) {
    const a = addressForms(g, "Nour Adel");
    const en = [a.they, a.them, a.their, a.themself, a.They, a.Their];
    for (const w of en) {
      assert.ok(
        !/^(he|him|his|himself|He|His)$/.test(w),
        `unknown register produced the masculine "${w}"`
      );
    }
    assert.ok(!a.arClosingEg.includes("يا بطل"), "masculine vocative leaked");
    assert.ok(!a.arClosingEg.includes("يا بطلة"), "feminine vocative leaked");
    assert.ok(a.arClosingEg.includes("يا Nour"), "no vocative by name");
  }
});

test("the Arabic vocative example agrees, for the two known registers", () => {
  assert.equal(
    addressForms("male").arClosingEg,
    "تمام يا بطل — كده خلصنا، دوس إنهاء لو جاهز."
  );
  assert.equal(
    addressForms("female").arClosingEg,
    "تمام يا بطلة — كده خلصنا، دوسي إنهاء لو جاهزة."
  );
  assert.equal(addressForms("male").arAddressee, "بصيغة المخاطب");
  assert.equal(addressForms("female").arAddressee, "بصيغة المخاطبة");
});

test("the address block states the register and the FR-2603 boundary", () => {
  const f = addressBlock("female", "Salma Adel");
  assert.match(f, /HOW TO ADDRESS THIS STUDENT/);
  assert.match(f, /use she\/her\/her/);
  assert.match(f, /FEMININE second-person register/);
  assert.ok(f.includes("«يا بطلة»"));
  assert.ok(!/\b(he|him|his)\b/.test(f), "masculine form in a feminine block");

  const m = addressBlock("male", "Omar Hassan");
  assert.match(m, /use he\/him\/his/);
  assert.match(m, /MASCULINE second-person register/);

  for (const g of UNKNOWN) {
    const n = addressBlock(g, "Nour Adel");
    assert.match(n, /singular they/);
    assert.match(n, /never fall back to the masculine/);
    assert.ok(!/\bhis\b|\bhim\b/.test(n));
    assert.ok(n.includes("never «يا بطل»"));
  }

  // every register carries the boundary: address only, never teaching
  for (const b of [f, m, addressBlock(null, "Nour")]) {
    assert.match(b, /never the topic, never which question you push, never how hard it is/);
  }
});

test("with no name at all the block still names a register", () => {
  const b = addressBlock(null);
  assert.match(b, /the student/);
  assert.match(b, /singular they/);
  assert.ok(!/\bhis\b/.test(b));
});
