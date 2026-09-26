/**
 * The book-section rules (feature 003, decision 18): what one unit is, part
 * order, the roll-up, "may the place move past this section?", the derived
 * part prerequisites, and the recommendation named by the section.
 *
 * The fixture is the Grade 10 book's shape after G0 (contracts/
 * pipeline-handoff.md): a merged lesson (1.2 into 1.3, slug `g10m1s3-1`), a
 * split section (1.7 Factorisation, three parts), ordinary sections, and a
 * promoted chapter introduction (6.1). Section numbers and slugs follow the
 * contract; the objective ids are invented, three to a lesson or fewer.
 *
 * The National half is the real one: the Prep-3 seeds, with one-section rows
 * written the way a loader would naively write them — group_key = the printed
 * lesson reference — which COLLIDES ("Lesson 3-1" is both u3-1 and t2u3-1,
 * "Lesson 4-1" both u4-1 and geo1-1). The rules must still see every National
 * lesson as its own unit.
 *
 * @covers FR-4311
 * @covers FR-4312
 * @covers FR-4313
 * @covers FR-4314
 * @covers FR-4317
 * @covers FR-4318
 * @covers SC-211
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BOOK_SECTIONS_SQL,
  LESSON_PROVENANCE_SQL,
  NO_SECTIONS,
  buildSectionIndex,
  printedLabel,
  consecutiveParts,
  mayLeaveSection,
  partOrderProblems,
  partPrereqEdges,
  provenanceFromRow,
  provenanceKind,
  sectionIndexFromRows,
  sectionProblems,
  sectionRecommendation,
  sectionRollup,
  sectionRollups,
  withPartPrereqs,
  type BookSectionRow,
  type LessonProvenance,
} from "./book-sections.ts";
import { lessonGatePassed, type ProgressionLesson } from "./progression.ts";
import { loadCatalogueFixture } from "./spine-maths-fixture.mts";
import { slugOfLo } from "./lesson-slug.ts";

const G10 = "course:us-g10-math-en";

const row = (
  slug: string,
  sections: [string, string][],
  extra: Partial<BookSectionRow> = {}
): BookSectionRow => ({
  course_id: G10,
  lesson_slug: slug,
  title: sections[0][1],
  sections: sections.map(([n]) => n),
  section_titles: sections.map(([, t]) => t),
  part_n: null,
  part_of: null,
  chapter_intro: false,
  group_key: sections[0][0],
  ...extra,
});

/** The G10 fixture's store, deliberately NOT in part order. */
const ROWS: BookSectionRow[] = [
  row("g10m1s3-1", [["1.2", "The real number system"], ["1.3", "Rational and irrational numbers"]]),
  row("g10m1s6-1", [["1.6", "Products"]]),
  row("g10m1s7-3", [["1.7", "Factorisation"]], { part_n: 3, part_of: 3 }),
  row("g10m1s7-1", [["1.7", "Factorisation"]], { part_n: 1, part_of: 3 }),
  row("g10m1s7-2", [["1.7", "Factorisation"]], { part_n: "2", part_of: "3" }), // smallint as text
  row("g10m1s8-1", [["1.8", "Simplification of fractions"]]),
  row("g10m6s1-1", [["6.1", "Introduction"]], { chapter_intro: true }),
  row("g10m6s2-1", [["6.2", "Functions in the real world"]]),
];
const INDEX = sectionIndexFromRows(ROWS);

/** Objectives per lesson, catalogue order. */
const LOS: Record<string, string[]> = {
  "g10m1s3-1": ["lo:g10m1s3-1-1", "lo:g10m1s3-1-2"],
  "g10m1s6-1": ["lo:g10m1s6-1-1", "lo:g10m1s6-1-2"],
  "g10m1s7-1": ["lo:g10m1s7-1-1", "lo:g10m1s7-1-2", "lo:g10m1s7-1-3"],
  "g10m1s7-2": ["lo:g10m1s7-2-1", "lo:g10m1s7-2-2"],
  "g10m1s7-3": ["lo:g10m1s7-3-1"],
  "g10m1s8-1": ["lo:g10m1s8-1-1"],
  "g10m6s1-1": ["lo:g10m6s1-1-1"],
  "g10m6s2-1": ["lo:g10m6s2-1-1"],
};
const ORDER = Object.keys(LOS);

/** The catalogue with every objective at the score `at(lo)` gives it. */
function catalog(at: (lo: string) => number = () => 0, order = ORDER): ProgressionLesson[] {
  return order.map((slug) => ({
    slug,
    courseId: G10,
    los: LOS[slug].map((id) => ({ id, mastery: at(id) })),
  }));
}
/** Every objective of the named lessons at `score`, the rest at `rest`. */
const lessonsAt = (slugs: string[], score: number, rest = 0) => (lo: string) =>
  slugs.includes(slugOfLo(lo)) ? score : rest;

/* ---------------------------------------------------------------- */
/* FR-4311 — provenance, as data                                     */
/* ---------------------------------------------------------------- */

test("each lesson reads as the shape it is: part, merged, chapter introduction, section", () => {
  const kind = (slug: string) => provenanceKind(INDEX.provenanceOf(slug)!);
  assert.equal(kind("g10m1s7-2"), "part");
  assert.equal(kind("g10m1s3-1"), "merged");
  assert.equal(kind("g10m6s1-1"), "chapter-intro");
  assert.equal(kind("g10m1s8-1"), "section");

  const merged = INDEX.provenanceOf("g10m1s3-1")!;
  assert.deepEqual(merged.sections, [
    { number: "1.2", title: "The real number system" },
    { number: "1.3", title: "Rational and irrational numbers" },
  ]);
  assert.deepEqual(INDEX.provenanceOf("g10m1s7-2")!.part, { n: 2, of: 3 });
  assert.equal(INDEX.provenanceOf("nope-1"), null);
});

test("a malformed part is read as no part, never as a unit it cannot be", () => {
  const bad = (part_n: unknown, part_of: unknown) =>
    provenanceFromRow(row("x-1", [["9.9", "X"]], { part_n: part_n as number, part_of: part_of as number })).part;
  assert.equal(bad(4, 3), null, "n > m");
  assert.equal(bad(0, 3), null, "n < 1");
  assert.equal(bad(2, null), null, "m missing");
  assert.equal(bad(null, 3), null, "n missing");
  assert.equal(bad("1.5", 3), null, "not an integer");
  assert.deepEqual(bad(1, 2), { n: 1, of: 2 });
});

/* ---------------------------------------------------------------- */
/* One unit: the section key and part order                          */
/* ---------------------------------------------------------------- */

test("the parts of 1.7 are one unit, in part order, keyed and named by the section", () => {
  assert.equal(INDEX.hasSplits, true);
  const g = INDEX.groupOf("g10m1s7-3");
  assert.equal(g.split, true);
  assert.equal(g.key, `${G10}|1.7`);
  assert.equal(g.number, "1.7");
  assert.equal(g.title, "Factorisation");
  assert.deepEqual(g.slugs, ["g10m1s7-1", "g10m1s7-2", "g10m1s7-3"], "part order, whatever the row order");
  assert.equal(INDEX.groupOf("g10m1s7-1"), g, "every part answers the same unit");
  assert.deepEqual(INDEX.splitGroups.map((x) => x.key), [`${G10}|1.7`]);
});

test("every other lesson is its own unit — a merge, an introduction, an unknown lesson", () => {
  for (const slug of ["g10m1s3-1", "g10m6s1-1", "g10m1s8-1", "nope-1"]) {
    const g = INDEX.groupOf(slug);
    assert.equal(g.split, false, slug);
    assert.deepEqual(g.slugs, [slug], slug);
  }
  assert.equal(INDEX.groupOf("g10m1s3-1").number, "1.2", "a merged lesson is numbered by its first section");
  assert.equal(INDEX.groupOf("nope-1").number, null, "no row, no number");
});

test("a lone part is not a unit of several; the missing siblings are reported instead", () => {
  const rows = [row("g10m2s4-1", [["2.4", "Lone"]], { part_n: 1, part_of: 2 })];
  const idx = sectionIndexFromRows(rows);
  assert.equal(idx.hasSplits, false);
  assert.equal(idx.groupOf("g10m2s4-1").split, false);
  assert.deepEqual(sectionProblems(rows.map(provenanceFromRow)), [`${G10}|2.4: parts 1 stored, 1, 2 expected`]);
});

/* ---------------------------------------------------------------- */
/* The National books: nothing is a unit of several                  */
/* ---------------------------------------------------------------- */

const NATIONAL = loadCatalogueFixture("all");
/** One-section rows for every National lesson, group_key = the printed reference. */
const NATIONAL_ROWS: BookSectionRow[] = (() => {
  const seen = new Map<string, BookSectionRow>();
  for (const lo of NATIONAL.los) {
    const slug = slugOfLo(lo.id);
    if (seen.has(slug) || !lo.courseId) continue;
    const ref = lo.syllabus_ref ?? slug;
    seen.set(slug, {
      course_id: lo.courseId,
      lesson_slug: slug,
      title: lo.label,
      sections: [ref],
      section_titles: [lo.label],
      part_n: null,
      part_of: null,
      chapter_intro: false,
      group_key: ref,
    });
  }
  return [...seen.values()];
})();

test("the National rows' printed references collide — and still no two National lessons are one unit", () => {
  const byKey = new Map<string, string[]>();
  for (const r of NATIONAL_ROWS) {
    const k = `${r.course_id}|${r.group_key}`;
    byKey.set(k, [...(byKey.get(k) ?? []), r.lesson_slug]);
  }
  const collisions = [...byKey.values()].filter((s) => s.length > 1);
  // The premise: without the "only parts group" rule these would be welded.
  assert.ok(
    collisions.some((s) => s.includes("u3-1") && s.includes("t2u3-1")),
    `expected Lesson 3-1 to be shared by u3-1 and t2u3-1, got ${JSON.stringify(collisions)}`
  );
  const idx = sectionIndexFromRows(NATIONAL_ROWS);
  assert.equal(idx.hasSplits, false);
  for (const r of NATIONAL_ROWS) {
    assert.deepEqual(idx.groupOf(r.lesson_slug).slugs, [r.lesson_slug], r.lesson_slug);
  }
});

test("for a National course every rule is the identity or the single-lesson rule", () => {
  const idx = sectionIndexFromRows(NATIONAL_ROWS);
  const lessons: ProgressionLesson[] = [];
  const bySlug = new Map<string, ProgressionLesson>();
  for (const lo of NATIONAL.los) {
    const slug = slugOfLo(lo.id);
    let l = bySlug.get(slug);
    if (!l) {
      l = { slug, courseId: lo.courseId, los: [] };
      bySlug.set(slug, l);
      lessons.push(l);
    }
    (l.los as { id: string; mastery: number }[]).push({ id: lo.id, mastery: 0.8 });
  }
  const prereqs = new Map<string, string[]>();
  for (const e of NATIONAL.edges) prereqs.set(e.dst, [...(prereqs.get(e.dst) ?? []), e.src]);

  for (const index of [idx, NO_SECTIONS]) {
    assert.deepEqual(consecutiveParts(lessons, index).map((l) => l.slug), lessons.map((l) => l.slug));
    assert.deepEqual(index.order(lessons).map((l) => l.slug), lessons.map((l) => l.slug));
    assert.deepEqual(partPrereqEdges(lessons, index), []);
    assert.equal(withPartPrereqs(prereqs, lessons, index), prereqs, "the very same map, not a copy");
    assert.equal(index.prereqsFor(prereqs, lessons), prereqs);
    assert.deepEqual(sectionRollups(lessons, index), [], "no roll-up line appears for a National lesson");
    assert.deepEqual(partOrderProblems(lessons, index), []);
    for (const l of lessons) {
      assert.equal(sectionRecommendation(l.slug, lessons, index), null, l.slug);
      assert.equal(mayLeaveSection(index.groupOf(l.slug), lessons), lessonGatePassed(l.los), l.slug);
    }
  }
  assert.deepEqual(sectionProblems(NATIONAL_ROWS.map(provenanceFromRow)), []);
});

/* ---------------------------------------------------------------- */
/* FR-4312 — parts consecutive, in part order                        */
/* ---------------------------------------------------------------- */

test("a catalogue already in section order is returned as it is", () => {
  const cat = catalog();
  assert.deepEqual(consecutiveParts(cat, INDEX).map((l) => l.slug), ORDER);
  assert.deepEqual(partOrderProblems(cat, INDEX), []);
});

test("a lesson between two parts, or parts out of order, is repaired and reported", () => {
  const stray = ["g10m1s6-1", "g10m1s7-1", "g10m1s8-1", "g10m1s7-3", "g10m1s7-2", "g10m6s1-1"];
  const cat = catalog(() => 0, stray);
  assert.deepEqual(
    consecutiveParts(cat, INDEX).map((l) => l.slug),
    ["g10m1s6-1", "g10m1s7-1", "g10m1s7-2", "g10m1s7-3", "g10m1s8-1", "g10m6s1-1"],
    "the parts move together to where the first stands; 1.8 follows the section"
  );
  assert.deepEqual(partOrderProblems(cat, INDEX), [`${G10}|1.7: parts are not in part order in the catalogue`]);
  const between = catalog(() => 0, ["g10m1s7-1", "g10m1s8-1", "g10m1s7-2", "g10m1s7-3"]);
  assert.deepEqual(partOrderProblems(between, INDEX), [
    `${G10}|1.7: another lesson sits between its parts in the catalogue`,
  ]);
});

test("the store's own consistency: m agreed, parts exactly 1…m, one row per lesson", () => {
  const rows: LessonProvenance[] = [
    provenanceFromRow(row("a-1", [["2.1", "A"]], { part_n: 1, part_of: 3 })),
    provenanceFromRow(row("a-2", [["2.1", "A"]], { part_n: 2, part_of: 2 })),
    provenanceFromRow(row("b-1", [["3.1", "B"]], { part_n: 1, part_of: 2 })),
    provenanceFromRow(row("b-1", [["3.1", "B"]], { part_n: 2, part_of: 2 })),
    provenanceFromRow(row("c-1", [["4.2", "C"]], { part_n: 1, part_of: 2, group_key: "4.1" })),
  ];
  assert.deepEqual(sectionProblems(rows), [
    "b-1: more than one row claims this lesson",
    "c-1: part of 4.1, which is not among the sections it covers",
    `${G10}|2.1: its parts disagree on how many there are (3, 2)`,
    `${G10}|4.1: parts 1 stored, 1, 2 expected`,
  ]);
  assert.deepEqual(sectionProblems(ROWS.map(provenanceFromRow)), [], "the fixture itself is sound");
});

/* ---------------------------------------------------------------- */
/* FR-4317 — part n-1 → part n, derived                              */
/* ---------------------------------------------------------------- */

test("every objective of part n-1 is a prerequisite of every objective of part n, marked as the product's", () => {
  const edges = partPrereqEdges(catalog(), INDEX);
  const want = [
    ...LOS["g10m1s7-2"].flatMap((dst) => LOS["g10m1s7-1"].map((src) => ({ src, dst }))),
    ...LOS["g10m1s7-3"].flatMap((dst) => LOS["g10m1s7-2"].map((src) => ({ src, dst }))),
  ].map((e) => ({ ...e, origin: "part-order" as const }));
  assert.deepEqual(edges, want);
  assert.ok(!edges.some((e) => LOS["g10m1s7-3"].includes(e.dst) && LOS["g10m1s7-1"].includes(e.src)), "n-1 only, not n-2");
});

test("the derived edges join the book's without replacing or mutating them", () => {
  const book = new Map<string, string[]>([
    ["lo:g10m1s7-2-1", ["lo:g10m1s3-1-2", "lo:g10m1s7-1-1"]], // the book already says one of them
    ["lo:g10m1s8-1-1", ["lo:g10m1s7-3-1"]],
  ]);
  const before = JSON.stringify([...book]);
  const merged = withPartPrereqs(book, catalog(), INDEX);
  assert.equal(JSON.stringify([...book]), before, "the book's map is untouched");
  assert.deepEqual(merged.get("lo:g10m1s7-2-1"), [
    "lo:g10m1s3-1-2",
    "lo:g10m1s7-1-1",
    "lo:g10m1s7-1-2",
    "lo:g10m1s7-1-3",
  ]);
  assert.deepEqual(merged.get("lo:g10m1s8-1-1"), ["lo:g10m1s7-3-1"]);
  assert.deepEqual(merged.get("lo:g10m1s7-3-1"), LOS["g10m1s7-2"]);
});

test("a part the catalogue lacks is skipped: part 3 follows part 1 when part 2 is not there", () => {
  const cat = catalog(() => 0, ["g10m1s7-1", "g10m1s7-3"]);
  assert.deepEqual(
    partPrereqEdges(cat, INDEX).map((e) => `${e.src}>${e.dst}`),
    LOS["g10m1s7-1"].map((src) => `${src}>lo:g10m1s7-3-1`)
  );
});

/* ---------------------------------------------------------------- */
/* FR-4313 / FR-4314 — may the place leave, and the roll-up          */
/* ---------------------------------------------------------------- */

test("the place may leave 1.7 only when all three parts pass", () => {
  const g = INDEX.groupOf("g10m1s7-1");
  assert.equal(mayLeaveSection(g, catalog(lessonsAt(["g10m1s7-1", "g10m1s7-3"], 0.9))), false);
  assert.equal(mayLeaveSection(g, catalog(lessonsAt(["g10m1s7-1", "g10m1s7-2", "g10m1s7-3"], 0.9))), true);
  const single = INDEX.groupOf("g10m1s8-1");
  assert.equal(mayLeaveSection(single, catalog(lessonsAt(["g10m1s8-1"], 0.75))), true, "exactly the lesson gate");
  assert.equal(mayLeaveSection(single, catalog(lessonsAt(["g10m1s8-1"], 0.74))), false);
});

test("US6 scenario 4: \"2 of 3 parts mastered\", and mastered only at 3 of 3", () => {
  const g = INDEX.groupOf("g10m1s7-2");
  const two = sectionRollup(g, catalog(lessonsAt(["g10m1s7-1", "g10m1s7-3"], 0.9)), INDEX);
  assert.equal(two.parts, 3);
  assert.equal(two.mastered, 2);
  assert.equal(two.isMastered, false);
  assert.equal(two.title, "Factorisation");
  assert.equal(two.number, "1.7");
  assert.deepEqual(two.partsMastered, [
    { slug: "g10m1s7-1", n: 1, mastered: true },
    { slug: "g10m1s7-2", n: 2, mastered: false },
    { slug: "g10m1s7-3", n: 3, mastered: true },
  ]);
  const all = sectionRollup(g, catalog(lessonsAt(["g10m1s7-1", "g10m1s7-2", "g10m1s7-3"], 0.9)), INDEX);
  assert.deepEqual([all.mastered, all.parts, all.isMastered], [3, 3, true]);
});

test("each part is scored on its own objectives: one weak objective keeps its part unmastered", () => {
  // Part 1's average is 0.75 — the ramp would call it mastered. The gate does not.
  const at = (lo: string) =>
    lo === "lo:g10m1s7-1-3" ? 0.29 : slugOfLo(lo).startsWith("g10m1s7") ? 0.98 : 0;
  const r = sectionRollup(INDEX.groupOf("g10m1s7-1"), catalog(at), INDEX);
  assert.deepEqual(r.partsMastered.map((p) => p.mastered), [false, true, true]);
  assert.equal(r.mastered, 2);
  assert.equal(r.isMastered, false);
});

test("the roll-ups list split sections only, in catalogue order", () => {
  const rs = sectionRollups(catalog(), INDEX);
  assert.deepEqual(rs.map((r) => r.key), [`${G10}|1.7`]);
});

// SC-211: "The section's roll-up agrees with its parts' mastery in 100% of
// sampled students" — here, 2,000 sampled mastery states.
test("SC-211: the roll-up agrees with its parts' mastery, and with the leave rule, in every sample", () => {
  let seed = 211;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const scores = [0, 0.02, 0.3, 0.5, 0.74, 0.75, 0.9, 0.98];
  const g = INDEX.groupOf("g10m1s7-1");
  for (let i = 0; i < 2000; i++) {
    const m = new Map(Object.values(LOS).flat().map((lo) => [lo, scores[Math.floor(rand() * scores.length)]]));
    const cat = catalog((lo) => m.get(lo) ?? 0);
    const r = sectionRollup(g, cat, INDEX);
    const parts = g.slugs.map((s) => cat.find((l) => l.slug === s)!);
    const passing = parts.filter((l) => l.los.every((lo) => lo.mastery >= 0.75)).length;
    assert.equal(r.mastered, passing);
    assert.equal(r.isMastered, passing === 3);
    assert.equal(r.isMastered, mayLeaveSection(g, cat));
  }
});

/* ---------------------------------------------------------------- */
/* FR-4313 — the recommendation names the section                    */
/* ---------------------------------------------------------------- */

test("US6 scenario 2: after part 1, the recommendation into part 2 is named by the section", () => {
  const cat = catalog(lessonsAt(["g10m1s7-1"], 0.9));
  const rec = sectionRecommendation("g10m1s7-2", cat, INDEX);
  assert.ok(rec);
  assert.equal(rec.title, "Factorisation");
  assert.equal(rec.number, "1.7");
  assert.deepEqual(rec.part, { slug: "g10m1s7-2", n: 2, of: 3 });
  assert.deepEqual([rec.rollup.mastered, rec.rollup.parts], [1, 3]);
});

test("a section nobody has started is recommended as its lesson, and a non-part never by a section", () => {
  assert.equal(sectionRecommendation("g10m1s7-1", catalog(), INDEX), null, "not started");
  const started = catalog(lessonsAt(["g10m1s7-1"], 0.3));
  assert.ok(sectionRecommendation("g10m1s7-1", started, INDEX), "one attempt starts it");
  assert.equal(sectionRecommendation("g10m1s8-1", catalog(() => 0.5), INDEX), null);
  assert.equal(sectionRecommendation("g10m1s3-1", catalog(() => 0.5), INDEX), null, "a merge is one lesson");
  assert.equal(sectionRecommendation("g10m1s7-2", started, NO_SECTIONS), null, "no store, no section");
});

/* ---------------------------------------------------------------- */
/* FR-4318 — the printed label: number, printed title, part         */
/* ---------------------------------------------------------------- */

test("the printed label carries the printed section title and the part — never an objective's label", () => {
  const label = (slug: string) => printedLabel(INDEX.provenanceOf(slug)!);
  assert.deepEqual(label("g10m1s7-2"), {
    numbers: ["1.7"],
    title: "Factorisation",
    sectionTitles: ["Factorisation"],
    part: { n: 2, of: 3 },
    partLabel: "part 2 of 3",
    chapterIntro: false,
  });
  const merged = label("g10m1s3-1");
  assert.deepEqual(merged.numbers, ["1.2", "1.3"], "a merge shows every section it covers");
  assert.deepEqual(merged.sectionTitles, ["The real number system", "Rational and irrational numbers"]);
  assert.equal(merged.partLabel, null);
  assert.equal(label("g10m6s1-1").chapterIntro, true);
  // An empty stored title falls back to the printed title of the section it is filed under.
  const untitled = printedLabel(
    provenanceFromRow(row("g10m1s7-1", [["1.7", "Factorisation"]], { title: " ", part_n: 1, part_of: 3 }))
  );
  assert.equal(untitled.title, "Factorisation");
});

test("the one-lesson read selects exactly the columns provenanceFromRow maps, for one course and slug", () => {
  const cols = (sql: string) => sql.replace(/\s+/g, " ").match(/SELECT (.*?) FROM/)![1];
  assert.equal(cols(LESSON_PROVENANCE_SQL), cols(BOOK_SECTIONS_SQL));
  assert.match(LESSON_PROVENANCE_SQL.replace(/\s+/g, " "), /FROM course_lessons WHERE course_id = \$1 AND lesson_slug = \$2$/);
});

test("buildSectionIndex keeps the first row a slug is claimed by", () => {
  const a = provenanceFromRow(row("g10m1s7-1", [["1.7", "Factorisation"]], { part_n: 1, part_of: 2 }));
  const b = provenanceFromRow(row("g10m1s7-1", [["9.9", "Other"]]));
  const idx = buildSectionIndex([a, b]);
  assert.equal(idx.provenanceOf("g10m1s7-1")?.groupKey, "1.7");
});
