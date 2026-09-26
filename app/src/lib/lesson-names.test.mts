/**
 * WHAT A LESSON IS CALLED, AND IN WHICH LANGUAGE THE TUTOR MAY SPEAK
 * (feature 003 integration; Samuel's decisions 9 and 13 of 2026-09-25;
 * backlog #35, #36, #37, #38).
 *
 *   · decision 13 — the Arabic lessons take the book's printed names from the
 *     book-section store (`shownTitles`), while their numbers, chips and
 *     headers stay as they were (`shownProvenance` unchanged). Maths and
 *     Social Studies take nothing from it;
 *   · decision 9 — "Arabic touches" is a per-course registry fact, off only
 *     for the Grade 10 course, and only an English-taught subject may turn
 *     it off;
 *   · #36 — each course cites its own book on a student surface;
 *   · #38 — the section roll-up has an Arabic wording for an RTL card;
 *   · #37 — an objective label's maths reads as plain text where it can only
 *     be a string (an accessible name, a tooltip).
 *
 * The prompt renders themselves are proved in `national-prompts.test.mts`
 * (decision 13) and `g10-prompts.test.mts` (decision 9, #35).
 *
 * @covers FR-4205, FR-4206, FR-4314, FR-4318
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { provenanceFromRow, type BookSectionRow } from "./book-sections.ts";
import { COURSE_IDS, COURSES, PREP3_ARABIC_AR, PREP3_MATH_EN, PREP3_SOCIAL_AR, US_G10_MATH_EN } from "./courses.ts";
import { SUBJECTS } from "./subjects.ts";
import { rollupText, rollupTextAr, shownProvenance, shownTitles } from "./section-label.ts";
import { hasMath, plainMath } from "./math-text.ts";

const row = (course_id: string, lesson_slug: string, title: string, over: Partial<BookSectionRow> = {}): BookSectionRow => ({
  course_id,
  lesson_slug,
  title,
  sections: ["1-1"],
  section_titles: [title],
  part_n: null,
  part_of: null,
  chapter_intro: false,
  group_key: "1-1",
  ...over,
});

/** The loader's one-section rows for the three National books (T404). */
const NATIONAL_ROWS = [
  row(PREP3_MATH_EN, "u1-1", "Ordered pairs and their equality"),
  row(PREP3_SOCIAL_AR, "soc1-1", "يوزع على خريطة صماء قارات العالم"),
  row(PREP3_ARABIC_AR, "ara1-1", "عِبادُ الرَّحمنِ"),
  row(PREP3_ARABIC_AR, "ara1-2", "كُنْ جَمِيلًا", { sections: ["1-2"], section_titles: ["كُنْ جَمِيلًا"], group_key: "1-2" }),
].map(provenanceFromRow);

test("decision 13: only the Arabic lessons are named from the store, and none of them gains provenance", () => {
  const titles = shownTitles(NATIONAL_ROWS);
  assert.deepEqual(
    [...titles],
    [
      ["ara1-1", "عِبادُ الرَّحمنِ"],
      ["ara1-2", "كُنْ جَمِيلًا"],
    ]
  );
  // numbers, chips and headers stay as they were: no National provenance shown
  assert.equal(shownProvenance(NATIONAL_ROWS).size, 0);
});

test("decision 13: an empty stored title is no title — the caller keeps the first objective", () => {
  const titles = shownTitles([provenanceFromRow(row(PREP3_ARABIC_AR, "ara1-1", "  ", { section_titles: [""] }))]);
  assert.equal(titles.size, 0);
});

test("a book-shaped course is named from the store whatever its registry flag says", () => {
  const g10 = [
    row(US_G10_MATH_EN, "g10m1s7-1", "Factorisation", { sections: ["1.7"], section_titles: ["Factorisation"], part_n: 1, part_of: 2, group_key: "1.7" }),
    row(US_G10_MATH_EN, "g10m1s7-2", "Factorisation", { sections: ["1.7"], section_titles: ["Factorisation"], part_n: 2, part_of: 2, group_key: "1.7" }),
  ].map(provenanceFromRow);
  assert.deepEqual([...shownTitles(g10).values()], ["Factorisation", "Factorisation"]);
  assert.equal(shownProvenance(g10).size, 2);
});

test("the registry: Arabic touches off only for the Grade 10 course, and only an English-taught course may turn them off", () => {
  for (const id of COURSE_IDS) {
    const c = COURSES[id];
    if (!c.tutor.arabicTouches) {
      assert.equal(SUBJECTS[c.subject].dir, "ltr", `${id} turns Arabic off but is taught in an RTL subject`);
    }
  }
  assert.deepEqual(
    COURSE_IDS.filter((id) => !COURSES[id].tutor.arabicTouches),
    [US_G10_MATH_EN]
  );
  // decision 13's flag: the Arabic course; the Grade 10 book is book-shaped anyway
  assert.equal(COURSES[PREP3_ARABIC_AR].tutor.bookLessonTitles, true);
  assert.equal(COURSES[PREP3_MATH_EN].tutor.bookLessonTitles, false);
  assert.equal(COURSES[PREP3_SOCIAL_AR].tutor.bookLessonTitles, false);
});

test("#36: every course cites its own book — the National ones as they always did, the Grade 10 book by name", () => {
  for (const id of [PREP3_MATH_EN, PREP3_SOCIAL_AR, PREP3_ARABIC_AR] as const) {
    assert.deepEqual(COURSES[id].cite, { name: "Ministry textbook", edition: "MOETE 2025–2026" }, id);
  }
  const g10 = COURSES[US_G10_MATH_EN].cite;
  assert.doesNotMatch(`${g10.name} ${g10.edition}`, /ministry|MOETE/i);
  assert.match(g10.name, /Everything Maths/);
  // each course names the pipeline book whose coverage audit the console reads
  assert.deepEqual(
    COURSE_IDS.map((id) => COURSES[id].pipelineBook),
    ["prep3-math-en", "prep3-social-ar", "prep3-arabic-ar", "g10-math"]
  );
});

test("#38: the Arabic roll-up needs no gender and no number agreement", () => {
  assert.equal(rollupText({ mastered: 2, parts: 3 }), "2 of 3 parts mastered");
  const ar = rollupTextAr({ mastered: 2, parts: 3 });
  assert.equal(ar, "الأجزاء المتقنة: 2 من 3");
  // no second-person verb (أتقنتَ / أتقنتِ), no dual or plural counted noun
  assert.doesNotMatch(ar, /أتقنت|جزءان|جزأين|أجزاء ٣|ثلاثة/);
});

test("#37: a label's maths as plain text — and every label with no maths untouched", () => {
  assert.equal(hasMath("Cartesian product"), false);
  assert.equal(plainMath("Cartesian product"), "Cartesian product");
  assert.equal(plainMath("Factorise a quadratic trinomial $x^2 + bx + c$"), "Factorise a quadratic trinomial x² + bx + c");
  assert.equal(
    plainMath("Factorise a quadratic trinomial $ax^2 + bx + c$ with $a \\neq 1$"),
    "Factorise a quadratic trinomial ax² + bx + c with a ≠ 1"
  );
  assert.equal(plainMath("Write $\\frac{a}{b}$ and $\\sqrt{2}$"), "Write a/b and √2");
  assert.doesNotMatch(plainMath("Read the gradient and $y$-intercept from $y = mx + c$"), /[$\\]/);
});
