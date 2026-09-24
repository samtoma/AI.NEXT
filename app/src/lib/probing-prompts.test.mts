/**
 * With Socratic probing Off, the tutor prompts are BYTE-IDENTICAL to the ones
 * the product sent before the runtime toggle existed (ADR-0021, FR-3108).
 *
 * `probing-prompts.golden.json` beside this file was captured from `main` at
 * `fa2cd29` (release v0.6.0) — BEFORE a single line of the toggle was written —
 * by running this file with `WRITE_GOLDEN=1`, and committed on its own ahead
 * of the change so the history shows it came from unchanged code. It holds
 * `learnPrompt` and `reviewPrompt` for all three subjects × all four address
 * forms (female, male, unspecified, not recorded): 24 prompts.
 *
 * The comparison is `assert.equal` on the whole string. Not "contains the
 * old rule", not "has no SOCRATIC in it" — the full text, so a stray space,
 * a reordered sentence or a new line anywhere in either prompt fails here.
 *
 * @covers FR-3108
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { learnPrompt, reviewPrompt } from "./lesson.ts";
import type { Gender } from "./address.ts";
import type { LessonData } from "./types.ts";

const GOLDEN = fileURLToPath(new URL("./probing-prompts.golden.json", import.meta.url));

const GENDERS: Gender[] = ["female", "male", "unspecified", null];

/** One realistic lesson per subject — enough objectives to exercise the arc. */
const SUBJECT_LESSONS: Record<string, Omit<LessonData, "gender" | "studentName">> = {
  "math-en": {
    slug: "u1-1",
    lessonRef: "1-1",
    title: "Cartesian product",
    moduleLabel: "Unit 1 — Relations and Functions",
    courseId: "course:prep3-math-en",
    subject: "math-en",
    los: [
      { id: "lo:u1-1-1", label: "Ordered pairs", description: "The ordered pair (a, b).", sourcePage: 8, mastery: 0.4 },
      { id: "lo:u1-1-2", label: "Cartesian product", description: "X × Y.", sourcePage: 9, mastery: 0.3 },
      { id: "lo:u1-1-3", label: "Arrow diagrams", description: null, sourcePage: 10, mastery: 0.8 },
    ],
    questions: [],
    visuals: [],
    mapBases: [],
    docTitle: null,
    studentId: 7,
    grade: "9",
  },
  "social-ar": {
    slug: "geo1-2",
    lessonRef: "1-2",
    title: "موقع مصر",
    moduleLabel: "الوحدة الأولى",
    courseId: "course:prep3-social-ar",
    subject: "social-ar",
    los: [
      { id: "lo:geo1-2-1", label: "الموقع الفلكي", description: "دوائر العرض وخطوط الطول.", sourcePage: 12, mastery: 0.3 },
      { id: "lo:geo1-2-2", label: "الموقع الجغرافي", description: null, sourcePage: 13, mastery: 0.5 },
    ],
    questions: [],
    visuals: [],
    mapBases: [],
    docTitle: "كتاب الدراسات الاجتماعية — الصف الثالث الإعدادي",
    studentId: 7,
    grade: "9",
  },
  "arabic-ar": {
    slug: "ar1-1",
    lessonRef: "1-1",
    title: "النحو: المبتدأ والخبر",
    moduleLabel: "الوحدة الأولى",
    courseId: "course:prep3-arabic-ar",
    subject: "arabic-ar",
    los: [
      { id: "lo:ar1-1-1", label: "المبتدأ", description: "اسم مرفوع في أول الجملة.", sourcePage: 20, mastery: 0.3 },
      { id: "lo:ar1-1-2", label: "الخبر", description: null, sourcePage: 21, mastery: 0.3 },
    ],
    questions: [],
    visuals: [],
    mapBases: [],
    docTitle: null,
    studentId: 7,
    grade: "9",
  },
};

const NAMES: Record<string, string> = {
  female: "Salma Adel",
  male: "Omar Hassan",
  unspecified: "Nour Adel",
  null: "Nour Adel",
};

/** Every prompt, keyed `subject/gender/mode`, rendered with probing OFF. */
function renderAllOff(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [subject, base] of Object.entries(SUBJECT_LESSONS)) {
    for (const gender of GENDERS) {
      const data: LessonData = {
        ...base,
        gender,
        studentName: NAMES[String(gender)]!,
      } as LessonData;
      // The second argument is the per-lesson snapshot (ADR-0021). Before the
      // toggle existed `learnPrompt` took one argument and ignored this — so
      // the same call captured the golden and now checks against it.
      out[`${subject}/${gender}/learn`] = learnPrompt(data, false);
      out[`${subject}/${gender}/review`] = reviewPrompt(data);
    }
  }
  return out;
}

if (process.env.WRITE_GOLDEN === "1") {
  writeFileSync(GOLDEN, JSON.stringify(renderAllOff(), null, 2) + "\n");
  console.log(`wrote ${GOLDEN}`);
}

test("probing off: all 24 prompts are byte-identical to the pre-toggle capture", () => {
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, string>;
  const now = renderAllOff();
  assert.deepEqual(Object.keys(now).sort(), Object.keys(golden).sort());
  assert.equal(Object.keys(now).length, 24);
  for (const key of Object.keys(golden)) {
    assert.equal(now[key], golden[key], `${key} drifted from the pre-toggle prompt`);
  }
});

test("probing on changes the learn prompt, and only the learn prompt's wrong-answer rules", () => {
  // The positive control: without it, the test above would also pass for a
  // `learnPrompt` that ignored its second argument entirely.
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, string>;
  const data = {
    ...SUBJECT_LESSONS["math-en"]!,
    gender: "female",
    studentName: NAMES.female!,
  } as LessonData;
  const on = learnPrompt(data, true);
  assert.notEqual(on, golden["math-en/female/learn"]);
  assert.ok(on.includes("SOCRATIC PROBING"));
  // Everything outside the wrong-answer rules is untouched: the prompt is the
  // off prompt with one block swapped, not a different prompt.
  const off = golden["math-en/female/learn"]!;
  const head = off.slice(0, off.indexOf("- From the SECOND message on"));
  assert.ok(on.startsWith(head), "the text before the wrong-answer rules changed");
});
