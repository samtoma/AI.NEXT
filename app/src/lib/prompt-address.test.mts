/**
 * The rendered prompts, per register (FR-2602, FR-2605; plan A9 sample check).
 *
 * `capture-prompts.mts` renders with no student in scope, which is what makes
 * its diff readable but also means it can only ever show ONE register. These
 * tests are the other half: the same four prompt builders — learn, review, ask
 * (both surfaces) and the check-in opening frame — rendered for a girl, a boy
 * and a student who has not said, with no database anywhere near them.
 *
 * The strongest assertion here is the last one in each block: for `unspecified`
 * and `null`, NO masculine form survives. Before P6 the answer was 95 of them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { learnPrompt, reviewPrompt } from "./lesson.ts";
import { askSystemPrompt } from "./ask.ts";
import { learnOpeningFrame } from "./checkin.ts";
import { retrievalBlock } from "./retrieval.ts";
import { buildUnderstandingPrompt } from "./understanding-prompt.ts";
import { addressForms, type Gender } from "./address.ts";
import type { LessonData, LessonLo, SpineQuestion } from "./types.ts";
import type { StudentProfile } from "./student-context.ts";

const MASCULINE = /\b(he|him|his|himself)\b/i;
const FEMININE = /\b(she|her|hers|herself)\b/i;

const LOS: LessonLo[] = [
  {
    id: "lo:u1-1-1",
    label: "Ordered pairs",
    description: "The ordered pair (a, b).",
    sourcePage: 8,
    mastery: 0.4,
  },
];

const QUESTIONS: SpineQuestion[] = [];

function lessonFor(gender: Gender, name = "Nour Adel"): LessonData {
  return {
    slug: "u1-1",
    lessonRef: "1-1",
    title: "Cartesian product",
    moduleLabel: "Unit 1",
    courseId: "course:prep3-math-en",
    subject: "math-en",
    los: LOS,
    questions: QUESTIONS,
    visuals: [],
    mapBases: [],
    docTitle: null,
    studentName: name,
    studentId: 7,
    grade: "10",
    gender,
  };
}

function profileFor(gender: Gender, name = "Nour Adel"): StudentProfile {
  return {
    id: 7,
    displayName: name,
    grade: "10",
    interests: [],
    interestDetail: null,
    languagePref: "en",
    curriculumSystem: "eg-national-en",
    gender,
  };
}

/** Everything the model sees for one turn, for one register. */
function payload(gender: Gender, name?: string): string {
  const data = lessonFor(gender, name);
  const a = addressForms(gender, name ?? "Nour Adel");
  return [
    // Probing off: the register is the subject here, and the Off prompt is
    // every student's unless an operator turns it on (ADR-0021).
    learnPrompt(data, false),
    reviewPrompt(data),
    askSystemPrompt("student_chat", name ?? "Nour Adel", "math-en", a),
    askSystemPrompt("spine_chat", name ?? "Nour Adel", null, a),
    askSystemPrompt("student_chat", name ?? "Nour Adel", "social-ar", a),
    askSystemPrompt("student_chat", name ?? "Nour Adel", "arabic-ar", a),
    retrievalBlock({
      profile: profileFor(gender, name),
      nearestSkills: [],
      misconceptions: [],
      libraryEntries: [],
      uploadText: null,
      engagement: null,
    }),
    ...[0, 1, 2, 4].flatMap((stage) => {
      const f = learnOpeningFrame(stage as 0 | 1 | 2 | 4, "Nour", gender);
      return [f.premise, f.job];
    }),
    buildUnderstandingPrompt({
      mode: "review",
      los: LOS,
      studentName: name ?? "Nour Adel",
      grade: "10",
      lessonRef: "1-1",
      title: "Cartesian product",
      moduleLabel: "Unit 1",
      transcript: [{ role: "user", text: "ready" }],
      gender,
    }),
  ].join("\n\n");
}

test("a female student is addressed in the feminine, with no masculine left", () => {
  const out = payload("female", "Salma Adel");
  assert.equal(MASCULINE.test(out), false, "a masculine form survived");
  assert.ok(FEMININE.test(out), "nothing feminine in a feminine render");
  assert.ok(out.includes("She is an Egyptian grade-10 student"));
  assert.ok(out.includes("she answers by typing back"));
  assert.ok(out.includes("تمام يا بطلة — كده خلصنا، دوسي إنهاء لو جاهزة."));
  assert.ok(out.includes("FEMININE second-person register"));
});

test("a male student renders exactly what the product shipped before P6", () => {
  const out = payload("male", "Omar Hassan");
  assert.ok(out.includes("He is an Egyptian grade-10 student"));
  assert.ok(out.includes("he answers by typing back"));
  assert.ok(out.includes("NEVER STATE A STEP YOU HAVEN'T ASKED HIM TO TRY"));
  assert.ok(out.includes("تمام يا بطل — كده خلصنا، دوس إنهاء لو جاهز."));
  assert.equal(FEMININE.test(out), false);
});

for (const gender of [null, "unspecified"] as const) {
  test(`${gender ?? "null"} gets a form correct for either, never the masculine`, () => {
    const out = payload(gender, "Nour Adel");
    assert.equal(
      MASCULINE.test(out),
      false,
      `FR-2605 violated: a masculine form for ${gender ?? "null"}`
    );
    assert.equal(FEMININE.test(out), false, "a feminine form was guessed");
    assert.ok(out.includes("They are an Egyptian grade-10 student"));
    assert.ok(out.includes("they answer by typing back"));
    assert.ok(out.includes("ASKED THEM TO TRY"));
    // The Arabic closing EXAMPLE loses the gendered vocative entirely. The
    // address block still names «يا بطل» and «يا بطلة» — to forbid them — so
    // the assertion is on the example the model is told to copy, not on the
    // whole payload.
    assert.ok(out.includes("تمام يا Nour"));
    const example = out.slice(out.indexOf("One-line warm wrap"));
    assert.equal(example.slice(0, 400).includes("يا بطل"), false);
  });
}

test("the three registers differ ONLY in address — the teaching is identical", () => {
  // The same shape as the capture gate: same line count, and every line that
  // differs between two registers carries an address form or the address
  // block. A register that changed a rule, a citation or a widget payload
  // would fail here.
  const GENDER_TOKEN =
    /\b(he|him|his|himself|she|her|hers|herself|they|them|their|theirs|themselves|is|are|has|have|does|do)\b/i;
  const AR = ["يا بطل", "يا بطلة", "دوس", "دوسي", "جاهز", "جاهزة", "المخاطب", "الخطاب المباشر", "وزرار الإنهاء", "يا "];
  const BLOCK = ["HOW TO ADDRESS THIS STUDENT", "- English: address", "- Arabic:", "- This decides the FORM"];
  const explains = (line: string) =>
    GENDER_TOKEN.test(line) ||
    AR.some((w) => line.includes(w)) ||
    BLOCK.some((w) => line.includes(w));

  const compare = (a: Gender, b: Gender) => {
    const la = payload(a, "Nour Adel").split("\n");
    const lb = payload(b, "Nour Adel").split("\n");
    assert.equal(la.length, lb.length, `${a} and ${b} produced different line counts`);
    const unexplained = la
      .map((l, i) => [i, l, lb[i]] as const)
      .filter(([, x, y]) => x !== y)
      .filter(([, x, y]) => !explains(x) && !explains(y));
    assert.deepEqual(
      unexplained.map(([i, x]) => `line ${i}: ${x.slice(0, 90)}`),
      [],
      `${a} vs ${b}: a line differs for a reason other than address`
    );
    // and the registers really do differ somewhere, or the test proves nothing
    assert.ok(la.some((l, i) => l !== lb[i]), `${a} and ${b} rendered identically`);
  };

  compare("female", "male");
  compare(null, "male");
  compare("unspecified", "female");
});

test("the address block reaches every surface through one retrieval bundle", () => {
  for (const g of ["female", "male", null, "unspecified"] as const) {
    const block = retrievalBlock({
      profile: profileFor(g),
      nearestSkills: [],
      misconceptions: [],
      libraryEntries: [],
      uploadText: null,
      engagement: null,
    });
    assert.match(block, /HOW TO ADDRESS THIS STUDENT/);
  }
  // and with no profile at all — the case most at risk of a masculine guess
  const anon = retrievalBlock({
    profile: null,
    nearestSkills: [],
    misconceptions: [],
    libraryEntries: [],
    uploadText: null,
    engagement: null,
  });
  assert.match(anon, /HOW TO ADDRESS THIS STUDENT/);
  assert.match(anon, /never fall back to the masculine/);
  assert.equal(MASCULINE.test(anon), false);
});
