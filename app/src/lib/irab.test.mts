/**
 * إعراب slot-grader tests — `npm run test:irab` (node's built-in runner, TS
 * type-stripping, zero dependencies).
 *
 * Every case below is a real one from the specs, not a synthetic fixture:
 *   - the worked examples in docs/specs/arabic-viz-widgets.md §1.6 / §2.4
 *   - the three أبيات of the المنادى المبني lesson (arabic-student-experience §2.4)
 *   - the printed sign tables transcribed in arabic-verification.md §2.2
 *   - the adversarial probe of arabic-verification.md §2.4, which the grader
 *     MUST reject — "a grader that accepts any of these is broken and blocks
 *     the release".
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MUNADA_MABNI_ON,
  MUNADA_MURAB_SIGN,
  checkRuleTable,
  foldCompare,
  gradeIrab,
  impliedState,
  parseIrabPhrase,
  signOwners,
  validateIrabKey,
  type IrabAnswer,
} from "./irab.ts";

/* ---------------- keys, exactly as the extraction contract stores them ------- */

/** «يا طالبَ العلمِ» — the canonical معرب example (printed p. 11). */
const MUDAF: IrabAnswer = {
  word_ar: "طالبَ",
  role_ar: "منادى مضاف",
  state: "منصوب",
  sign: "الفتحة",
  sign_kind: "ظاهرة",
  reason_ar: "لأنه مفرد",
  rule_ref: "gc:munada:mudaf-nasb",
  surface_ar: "منادى مضاف منصوب وعلامة نصبه الفتحة الظاهرة",
  accept_ar: ["منادى منصوب وعلامة نصبه الفتحة"],
};

/** «يا طالباتِ المجدِ» — جمع مؤنث سالم takes الكسرة (printed p. 11). */
const MUDAF_JAM_MUANNATH: IrabAnswer = {
  word_ar: "طالباتِ",
  role_ar: "منادى مضاف",
  state: "منصوب",
  sign: "الكسرة",
  sign_kind: "نائبة عن الفتحة",
  reason_ar: "لأنه جمع مؤنث سالم",
  rule_ref: "gc:munada:mudaf-sign-kasra-jam-muannath",
  surface_ar: "منادى مضاف منصوب وعلامة نصبه الكسرة نيابة عن الفتحة",
};

/** «يا خالدُ» — علم مفرد، مبني على الضم في محل نصب (printed p. 17). */
const MABNI_ALAM: IrabAnswer = {
  word_ar: "خالدُ",
  role_ar: "منادى مبني (علم مفرد)",
  state: "مبني",
  position: "في محل نصب",
  sign: "الضم",
  sign_kind: "—",
  rule_ref: "gc:munada:mabni-damm-mufrad",
  surface_ar: "منادى مبني على الضم في محل نصب",
};

/** «يا خالدان» — مثنى، مبني على الألف (printed p. 17). */
const MABNI_MUTHANNA: IrabAnswer = {
  word_ar: "خالدان",
  role_ar: "منادى مبني (علم مفرد)",
  state: "مبني",
  position: "في محل نصب",
  sign: "الألف",
  sign_kind: "—",
  rule_ref: "gc:munada:mabni-alif-muthanna",
  surface_ar: "منادى مبني على الألف في محل نصب",
};

/** «يا خالدون» — جمع مذكر سالم، مبني على الواو (printed p. 17). */
const MABNI_JAM_MUDHAKKAR: IrabAnswer = {
  word_ar: "خالدون",
  role_ar: "منادى مبني (علم مفرد)",
  state: "مبني",
  position: "في محل نصب",
  sign: "الواو",
  sign_kind: "—",
  rule_ref: "gc:munada:mabni-waw-jam-mudhakkar",
  surface_ar: "منادى مبني على الواو في محل نصب",
};

/* ================================================================== */
/* 1. The happy path                                                   */
/* ================================================================== */

test("exact slots → AGREE, correct, full score", () => {
  const r = gradeIrab(
    {
      word_ar: "طالبَ",
      role_ar: "منادى مضاف",
      state: "منصوب",
      sign: "الفتحة",
      sign_kind: "ظاهرة",
    },
    MUDAF
  );
  assert.equal(r.verdict, "AGREE");
  assert.equal(r.correct, true);
  assert.equal(r.score, 1);
  assert.equal(r.diagnosis, null);
});

test("a tapped option phrase is parsed into slots (no typed answer needed)", () => {
  const r = gradeIrab(
    { role_ar: "منادى مضاف", mark_phrase: "منصوب بالفتحة" },
    MUDAF
  );
  assert.equal(r.correct, true, r.note);
  assert.equal(r.verdict, "VARIANT"); // sign_kind omitted = fullness, not error
});

test("the three مبني أبيات of the lesson all grade correct", () => {
  for (const [key, phrase] of [
    [MABNI_ALAM, "مبني على الضم في محل نصب"],
    [MABNI_MUTHANNA, "مبني على الألف في محل نصب"],
    [MABNI_JAM_MUDHAKKAR, "مبني على الواو في محل نصب"],
  ] as const) {
    const r = gradeIrab(
      { word_ar: key.word_ar, role_ar: key.role_ar, mark_phrase: phrase },
      key
    );
    assert.equal(r.correct, true, `${key.word_ar}: ${r.note}`);
  }
});

/* ================================================================== */
/* 2. VARIANT — a fuller (or plainer) إعراب is CORRECT (§2.3.4)        */
/* ================================================================== */

test("VARIANT: the student's answer is FULLER than the key", () => {
  const plainKey: IrabAnswer = {
    ...MUDAF,
    role_ar: "منادى",
    sign_kind: "ظاهرة",
    surface_ar: "منادى منصوب وعلامة نصبه الفتحة",
    accept_ar: [],
  };
  const r = gradeIrab(
    { role_ar: "منادى مضاف", state: "منصوب", sign: "الفتحة", sign_kind: "ظاهرة" },
    plainKey
  );
  assert.equal(r.verdict, "VARIANT");
  assert.equal(r.correct, true);
  assert.equal(r.score, 1, "a fuller answer must not lose credit");
});

test("VARIANT: the student's answer is PLAINER than the key", () => {
  const r = gradeIrab({ role_ar: "منادى", state: "منصوب", sign: "الفتحة" }, MUDAF);
  assert.equal(r.verdict, "VARIANT");
  assert.equal(r.correct, true);
});

test("VARIANT: an approved accept_ar phrasing is accepted whole", () => {
  const r = gradeIrab(
    { surface_ar: "منادى منصوب وعلامة نصبه الفتحة" },
    MUDAF
  );
  assert.equal(r.correct, true, r.note);
  assert.equal(r.score, 1);
});

test("VARIANT: omitting النيابة on جمع المؤنث السالم is not an error", () => {
  const r = gradeIrab(
    { role_ar: "منادى مضاف", mark_phrase: "منصوب بالكسرة" },
    MUDAF_JAM_MUANNATH
  );
  assert.equal(r.correct, true, r.note);
});

test("VARIANT: «الضم» and «الضمة» are the same mark", () => {
  const r = gradeIrab(
    { role_ar: MABNI_ALAM.role_ar, mark_phrase: "مبني على الضمة في محل نصب" },
    MABNI_ALAM
  );
  assert.equal(r.correct, true, r.note);
});

test("the VARIANT note tells the tutor it was fullness, not luck", () => {
  const r = gradeIrab({ role_ar: "منادى", state: "منصوب", sign: "الفتحة" }, MUDAF);
  assert.match(r.note, /VARIANT/);
  assert.match(r.note, /CORRECT/);
});

/* ================================================================== */
/* 3. The adversarial probe (§2.4) — all three MUST be rejected        */
/* ================================================================== */

test("probe 1 — right موقع, wrong علامة (الكسرة on a مفرد) is rejected", () => {
  const r = gradeIrab(
    { word_ar: "طالبَ", role_ar: "منادى مضاف", state: "منصوب", sign: "الكسرة" },
    MUDAF,
    { nounType: "مفرد" }
  );
  assert.equal(r.correct, false);
  assert.equal(r.verdict, "PARTIAL");
  assert.equal(r.diagnosis?.slot, "sign");
  // the diagnosis is COMPUTED: it names what الكسرة would have been right for
  assert.equal(r.diagnosis?.belongs_to_ar, "جمع مؤنث سالم");
  assert.match(r.diagnosis!.message_ar, /الفتحة/);
  assert.ok(r.score > 0 && r.score < 1, "partial credit, not zero");
});

test("probe 2 — wrong حالة (a نكرة مقصودة parsed as معرب منصوب) is rejected", () => {
  const r = gradeIrab(
    {
      word_ar: "خالدُ",
      role_ar: "منادى مبني (علم مفرد)",
      state: "منصوب",
      sign: "الفتحة",
    },
    MABNI_ALAM
  );
  assert.equal(r.correct, false);
  assert.equal(r.diagnosis?.slot, "state");
  assert.match(r.diagnosis!.message_ar, /مبني/);
});

test("probe 3 — right structure, WRONG TOKEN (the مضاف إليه) is rejected", () => {
  const r = gradeIrab(
    { word_ar: "العلمِ", role_ar: "مضاف إليه", state: "مجرور", sign: "الكسرة" },
    MUDAF
  );
  assert.equal(r.correct, false);
  assert.equal(r.verdict, "DISAGREE");
  assert.equal(r.diagnosis?.slot, "token");
  assert.equal(r.score, 0);
});

test("a disjoint موقع is a conflict, not a subset («مضاف إليه» vs «منادى مضاف»)", () => {
  const r = gradeIrab(
    { role_ar: "مضاف إليه", state: "منصوب", sign: "الفتحة" },
    MUDAF
  );
  assert.equal(r.correct, false);
  assert.equal(r.diagnosis?.slot, "role");
});

/* ================================================================== */
/* 4. Partial credit + the computed diagnosis                          */
/* ================================================================== */

test("partial credit ranks a half-right answer above a fully wrong one", () => {
  const halfRight = gradeIrab(
    { role_ar: "منادى مضاف", state: "منصوب", sign: "الياء" },
    MUDAF
  );
  const allWrong = gradeIrab(
    { role_ar: "مضاف إليه", state: "مجرور", sign: "الكسرة" },
    MUDAF
  );
  assert.ok(halfRight.score > allWrong.score, `${halfRight.score} vs ${allWrong.score}`);
  assert.equal(allWrong.verdict, "DISAGREE");
});

test("the diagnosis carries the printed clause so the tutor never re-derives", () => {
  const r = gradeIrab(
    { role_ar: "منادى مضاف", state: "منصوب", sign: "الياء" },
    MUDAF,
    {
      nounType: "مفرد",
      rule: {
        page: 11,
        quote_ar: "يُنصَبُ المنادى المُضافُ بالفتحة أو ما ينوبُ عنها",
      },
    }
  );
  assert.equal(r.diagnosis?.rule_ref, "gc:munada:mudaf-nasb");
  assert.equal(r.diagnosis?.rule_page, 11);
  assert.match(r.diagnosis!.rule_quote_ar!, /المنادى/);
  // the note is the AI's input: it must contain the slot diff verbatim
  assert.match(r.note, /sign: الفتحة → الياء/);
});

test("the diagnosis names ONE slot — the first in teaching order", () => {
  const r = gradeIrab(
    { role_ar: "مضاف إليه", state: "مجرور", sign: "الفتحة" },
    MUDAF
  );
  assert.equal(r.diagnosis?.slot, "role", "role is taught before the علامة");
});

test("an empty submission is unanswered, never a VARIANT pass", () => {
  const r = gradeIrab({}, MUDAF);
  assert.equal(r.correct, false);
  assert.equal(r.verdict, "DISAGREE");
});

/* ================================================================== */
/* 5. The key gate — a key that cannot be licensed marks nobody        */
/* ================================================================== */

test("an إعراب with no printed rule_ref is KEY_INVALID, not a student error", () => {
  const r = gradeIrab(
    { role_ar: "منادى مضاف", state: "منصوب", sign: "الفتحة" },
    { ...MUDAF, rule_ref: "made-up" }
  );
  assert.equal(r.verdict, "KEY_INVALID");
  assert.equal(r.correct, false);
  assert.equal(r.score, 0);
  assert.match(r.note, /student not marked/);
});

test("schemas.py's coherence rules are enforced at runtime too", () => {
  assert.deepEqual(validateIrabKey({ ...MUDAF, rule_ref: "gc:x" }), []);
  // مبني without its محل
  assert.ok(
    validateIrabKey({ ...MABNI_ALAM, position: null }).some((e) => /محل/.test(e))
  );
  // معرب carrying a محل
  assert.ok(
    validateIrabKey({ ...MUDAF, position: "في محل نصب" }).some((e) =>
      /drop position/.test(e)
    )
  );
  // معرب with no علامة
  assert.ok(
    validateIrabKey({ ...MUDAF, sign: null }).some((e) => /علامة/.test(e))
  );
});

/* ================================================================== */
/* 6. The rule table — the deterministic third voter (§2.2)            */
/* ================================================================== */

test("the printed sign tables are encoded as the book prints them", () => {
  assert.equal(MUNADA_MURAB_SIGN["مفرد"], "الفتحة");
  assert.equal(MUNADA_MURAB_SIGN["جمع مؤنث سالم"], "الكسرة");
  assert.equal(MUNADA_MURAB_SIGN["مثنى"], "الياء");
  assert.equal(MUNADA_MURAB_SIGN["جمع مذكر سالم"], "الياء");
  assert.equal(MUNADA_MURAB_SIGN["الأسماء الخمسة"], "الألف");
  assert.equal(MUNADA_MABNI_ON["مفرد"], "الضم");
  assert.equal(MUNADA_MABNI_ON["مثنى"], "الألف");
  assert.equal(MUNADA_MABNI_ON["جمع مذكر سالم"], "الواو");
});

test("the rule table contradicts a key that claims the wrong sign", () => {
  const good = checkRuleTable(MUDAF, "مفرد");
  assert.equal(good?.ok, true);
  const bad = checkRuleTable({ ...MUDAF, sign: "الياء" }, "مفرد");
  assert.equal(bad?.ok, false);
  assert.equal(bad?.expected, "الفتحة");
});

test("the rule table stays silent where the book prints no table", () => {
  assert.equal(checkRuleTable(MUDAF, undefined), null, "no noun type → no ruling");
  assert.equal(
    checkRuleTable({ ...MUDAF, role_ar: "مضاف إليه" }, "مفرد"),
    null,
    "only المنادى is tabulated in this unit"
  );
});

test("impliedState filters the علامة list only where the book states it", () => {
  assert.equal(impliedState("منادى مضاف"), "منصوب");
  assert.equal(impliedState("منادى شبيه بالمضاف"), "منصوب");
  assert.equal(impliedState("منادى مبني (علم مفرد)"), "مبني");
  assert.equal(impliedState("منادى نكرة مقصودة"), "مبني");
  assert.equal(impliedState("مضاف إليه"), "مجرور");
  // no printed ruling → no filter, rather than a guessed one
  assert.equal(impliedState("نعت"), undefined);
  assert.equal(impliedState("حال"), undefined);
});

test("signOwners answers «what would this pick have been right for?»", () => {
  assert.deepEqual(signOwners("الياء", "منصوب"), ["مثنى", "جمع مذكر سالم"]);
  assert.deepEqual(signOwners("الواو", "مبني"), ["جمع مذكر سالم"]);
});

/* ================================================================== */
/* 7. Phrase parsing + COMPARE folding                                 */
/* ================================================================== */

test("phrase → slots covers every shape the pick-lists use", () => {
  assert.deepEqual(parseIrabPhrase("منصوب بالفتحة"), {
    state: "منصوب",
    sign: "الفتحة",
  });
  assert.deepEqual(parseIrabPhrase("مبني على الضم في محل نصب"), {
    state: "مبني",
    position: "في محل نصب",
    sign: "الضم",
  });
  assert.deepEqual(
    parseIrabPhrase("منصوب وعلامة نصبه الياء نيابة عن الفتحة"),
    { state: "منصوب", sign: "الياء", sign_kind: "نائبة عن الفتحة" }
  );
  assert.deepEqual(parseIrabPhrase("مجرور بالكسرة الظاهرة"), {
    state: "مجرور",
    sign: "الكسرة",
    sign_kind: "ظاهرة",
  });
  assert.deepEqual(parseIrabPhrase("مرفوع وعلامة رفعه حذف النون"), {
    state: "مرفوع",
    sign: "حذف النون",
  });
});

test("COMPARE folding strips marks but NEVER Arabic-Indic digits", () => {
  // the diacritic class must stop at U+065F: ٠-٩ (U+0660–U+0669) are content —
  // the book writes «١٧٥٥٠ مترًا», and folding them away would silently equate
  // two different numbers.
  assert.equal(foldCompare("١٧٥٥٠ مترًا"), "١٧٥٥٠ مترا");
  assert.notEqual(foldCompare("٦٣"), foldCompare("٧٠"));
});

test("«الفتحة» is never mistaken for «الألف» (the substring trap)", () => {
  assert.equal(parseIrabPhrase("منصوب بالفتحة").sign, "الفتحة");
  assert.equal(parseIrabPhrase("منصوب بالألف").sign, "الألف");
});

test("COMPARE folding ignores تشكيل but the STORE strings stay untouched", () => {
  assert.equal(foldCompare("طالبَ"), foldCompare("طالب"));
  assert.equal(foldCompare("الفتحةُ"), foldCompare("الفتحه"));
  // and a graded answer survives a student's un-vowelled typing
  const r = gradeIrab(
    { word_ar: "طالب", role_ar: "منادى مضاف", state: "منصوب", sign: "الفتحة" },
    MUDAF
  );
  assert.equal(r.correct, true, r.note);
});

/* ================================================================== */
/* 8. The no-model-call property                                       */
/* ================================================================== */

test("grading performs no I/O — it is a pure function over data", () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("the إعراب grader must never call a model");
  }) as typeof fetch;
  try {
    const r = gradeIrab(
      { role_ar: "منادى مضاف", state: "منصوب", sign: "الفتحة" },
      MUDAF
    );
    assert.equal(r.correct, true);
  } finally {
    globalThis.fetch = realFetch;
  }
});
