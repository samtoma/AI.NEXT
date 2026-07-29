/**
 * Span-anchoring helper tests (arabic-viz-widgets.md §1.0 / §1.7) — the
 * matcher every VIZ_SPEC v3 kind and every Arabic widget resolves spans with.
 * Run with `npm test`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { locateSpan, tokenizeWords, isVowelled, locateMark, stageVowelled, stripHarakat } from "./arabic.ts";

const VERSE = "أيُّهذا الشَّاكي وما بِكَ داءٌ";

test("locateSpan finds a vowelled needle written bare", () => {
  const r = locateSpan(VERSE, "الشاكي");
  assert.ok(r);
  assert.equal(VERSE.slice(r![0], r![1]), "الشَّاكي");
});

test("locateSpan carries the final tanween", () => {
  const r = locateSpan(VERSE, "داء");
  assert.ok(r);
  assert.equal(VERSE.slice(r![0], r![1]), "داءٌ");
});

test("nth picks the second occurrence", () => {
  const t = "يا طالبَ العلمِ، يا طالبَ المجدِ";
  const a = locateSpan(t, "طالب", 1)!;
  const b = locateSpan(t, "طالب", 2)!;
  assert.ok(b[0] > a[0]);
});

test("wholeWord refuses a sub-word hit", () => {
  const t = "المعلمون في المدرسة";
  assert.equal(locateSpan(t, "علم", 1, { wholeWord: true }), null);
  assert.ok(locateSpan(t, "علم", 1));
});

test("missing needle is a soft null", () => {
  assert.equal(locateSpan(VERSE, "غير موجود"), null);
});

test("tokenizeWords never splits inside a word", () => {
  const toks = tokenizeWords(VERSE).filter(t => t.isWord);
  assert.equal(toks.length, 5);
  assert.equal(toks[0].text, "أيُّهذا");
  for (const t of toks) assert.equal(VERSE.slice(t.start, t.end), t.text);
});

test("isVowelled distinguishes the two line-heights", () => {
  assert.equal(isVowelled(VERSE), true);
  assert.equal(isVowelled("الحملة الفرنسية على مصر"), false);
});

test("stage strings reveal marks one at a time, shaping intact", () => {
  const t = "يا طالبَ العلمِ";
  const m1 = locateMark(t, "طالب", "last", "fatha")!;
  const m2 = locateMark(t, "العلم", "last", "kasra")!;
  const stages = stageVowelled(t, [m1, m2]);
  assert.equal(stages.length, 3);
  assert.equal(stages[0], "يا طالب العلم");
  assert.equal(stages[1], "يا طالبَ العلم");
  assert.equal(stages[2], t);
});

test("locateMark refuses a mark the producer did not describe", () => {
  assert.equal(locateMark("يا طالبَ العلمِ", "طالب", "last", "damma"), null);
});

test("stripHarakat position map points back at the original", () => {
  const { plain, map } = stripHarakat(VERSE);
  assert.equal(plain, "أيهذا الشاكي وما بك داء");
  for (let i = 0; i < plain.length; i++) assert.equal(VERSE[map[i]], plain[i]);
});
