/**
 * The walk with book sections (feature 003, decision 18; FR-4313, FR-4317,
 * SC-211; the ADR-0020 note of 2026-09-25): a split section's parts are one
 * unit, the place never moves past it until every part passes, and inside it
 * the place moves to the first part not yet passed.
 *
 * Two halves.
 *
 *   1. The Grade 10 shape (the fixture book-sections.test.mts uses): US6
 *      scenarios 2 and 3, entering, parking, the derived part prerequisite, a
 *      catalogue with a stray lesson between parts, and SC-211 simulated over
 *      thousands of random student histories.
 *   2. THE NATIONAL PROOF. On the real Prep-3 catalogue of all three National
 *      courses and the real prerequisite edges, with randomised mastery, the
 *      walk is compared against the v0.9.2 rule COPIED VERBATIM below — with
 *      no section store, with an empty one, with one-section rows for every
 *      National lesson (whose printed references collide), and with a store
 *      that also holds the Grade 10 split section, which forces the
 *      section-aware code path onto a National catalogue. Every decision is
 *      identical. `progression.test.mts` (v0.9.2's own tests) is unchanged and
 *      runs beside this file.
 *
 * @covers FR-4313
 * @covers FR-4317
 * @covers SC-211
 * @covers FR-3202
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  advanceTarget,
  nextLessonSlug,
  lessonGatePassed,
  MASTERED_GATE,
  PREREQ_GATE,
  type ProgressionLesson,
  type ProgressionLo,
} from "./progression.ts";
import { NO_SECTIONS, sectionIndexFromRows, type BookSectionRow, type SectionIndex } from "./book-sections.ts";
import { loadCatalogueFixture } from "./spine-maths-fixture.mts";
import { slugOfLo } from "./lesson-slug.ts";

/* ================================================================ */
/* The v0.9.2 rule, verbatim — the oracle for the National proof    */
/* ================================================================ */

const v092 = (() => {
  function lessonGatePassed(los: readonly ProgressionLo[]): boolean {
    if (los.length === 0) return false;
    return los.every((l) => l.mastery >= MASTERED_GATE);
  }
  function lessonPrereqsMet(
    lesson: ProgressionLesson,
    mastery: ReadonlyMap<string, number>,
    prereqs: ReadonlyMap<string, readonly string[]>
  ): boolean {
    const own = new Set(lesson.los.map((l) => l.id));
    return lesson.los.every((lo) =>
      (prereqs.get(lo.id) ?? []).every(
        (p) => own.has(p) || (mastery.get(p) ?? 0) >= PREREQ_GATE
      )
    );
  }
  function nextLessonSlug(
    catalog: readonly ProgressionLesson[],
    currentSlug: string,
    mastery: ReadonlyMap<string, number>,
    prereqs: ReadonlyMap<string, readonly string[]>
  ): string | null {
    const i = catalog.findIndex((l) => l.slug === currentSlug);
    if (i < 0) return null;
    for (let j = i + 1; j < catalog.length; j++) {
      if (lessonPrereqsMet(catalog[j], mastery, prereqs)) {
        return catalog[j].slug;
      }
    }
    return null;
  }
  function resolvePointer(
    inCourse: readonly { slug: string }[],
    stored: string | null | undefined
  ): string | null {
    if (inCourse.length === 0) return null;
    if (stored && inCourse.some((l) => l.slug === stored)) return stored;
    return inCourse[0].slug;
  }
  function advanceTarget(
    inCourse: readonly ProgressionLesson[],
    storedSlug: string | null | undefined,
    attemptedSlug: string,
    mastery: ReadonlyMap<string, number>,
    prereqs: ReadonlyMap<string, readonly string[]>
  ): string | null {
    const current = resolvePointer(inCourse, storedSlug);
    if (current === null || current !== attemptedSlug) return null;
    const lesson = inCourse.find((l) => l.slug === current);
    if (!lesson || !lessonGatePassed(lesson.los)) return null;
    return nextLessonSlug(inCourse, current, mastery, prereqs);
  }
  return { nextLessonSlug, advanceTarget };
})();

/** A deterministic PRNG (mulberry32), so every run samples the same states. */
function prng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Scores on and around every threshold the rules read. */
const SCORES = [0, 0.02, 0.3, 0.49, 0.5, 0.6, 0.74, 0.75, 0.9, 0.98];

/* ================================================================ */
/* 1. The Grade 10 shape                                            */
/* ================================================================ */

const G10 = "course:us-g10-math-en";
const row = (slug: string, n: string, title: string, extra: Partial<BookSectionRow> = {}): BookSectionRow => ({
  course_id: G10,
  lesson_slug: slug,
  title,
  sections: [n],
  section_titles: [title],
  part_n: null,
  part_of: null,
  chapter_intro: false,
  group_key: n,
  ...extra,
});
const G10_ROWS: BookSectionRow[] = [
  {
    ...row("g10m1s3-1", "1.2", "The real number system"),
    sections: ["1.2", "1.3"],
    section_titles: ["The real number system", "Rational and irrational numbers"],
  },
  row("g10m1s6-1", "1.6", "Products"),
  row("g10m1s7-1", "1.7", "Factorisation", { part_n: 1, part_of: 3 }),
  row("g10m1s7-2", "1.7", "Factorisation", { part_n: 2, part_of: 3 }),
  row("g10m1s7-3", "1.7", "Factorisation", { part_n: 3, part_of: 3 }),
  row("g10m1s8-1", "1.8", "Simplification of fractions"),
  row("g10m6s1-1", "6.1", "Introduction", { chapter_intro: true }),
  row("g10m6s2-1", "6.2", "Functions in the real world"),
];
const SECTIONS = sectionIndexFromRows(G10_ROWS);

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

/**
 * The book's own prerequisites (dst → [src]). Part 2 carries one from OUTSIDE
 * its section (the merged 1.2–1.3 lesson), which is what the in-section park
 * test turns on. No edge between the parts: that one is the product's.
 */
const BOOK = new Map<string, string[]>([
  ["lo:g10m1s7-1-1", ["lo:g10m1s6-1-1"]],
  ["lo:g10m1s7-2-1", ["lo:g10m1s3-1-2"]],
  ["lo:g10m1s8-1-1", ["lo:g10m1s7-3-1"]],
  ["lo:g10m6s2-1-1", ["lo:g10m6s1-1-1"]],
]);

type Scores = Record<string, number>;
/** Every objective of each named lesson at its score; everything else at `rest`. */
function state(lessons: Scores, rest = 0, order = ORDER) {
  const mastery = new Map<string, number>();
  for (const [slug, los] of Object.entries(LOS)) {
    for (const lo of los) mastery.set(lo, lessons[slug] ?? rest);
  }
  const cat: ProgressionLesson[] = order.map((slug) => ({
    slug,
    courseId: G10,
    los: LOS[slug].map((id) => ({ id, mastery: mastery.get(id)! })),
  }));
  return { cat, mastery };
}
const PASS = 0.9;
const advance = (pointer: string, s: ReturnType<typeof state>, sections: SectionIndex = SECTIONS) =>
  advanceTarget(s.cat, pointer, pointer, s.mastery, BOOK, sections);

test("US6 scenario 2: part 1 passes → the place moves to part 2, not to 1.8", () => {
  const s = state({ "g10m1s3-1": PASS, "g10m1s6-1": PASS, "g10m1s7-1": PASS });
  assert.equal(advance("g10m1s7-1", s), "g10m1s7-2");
});

test("US6 scenario 3: parts 1 and 3 passed, part 2 not → the place stays in the section, on part 2", () => {
  const s = state({ "g10m1s3-1": PASS, "g10m1s6-1": PASS, "g10m1s7-1": PASS, "g10m1s7-3": PASS });
  assert.equal(advance("g10m1s7-1", s), "g10m1s7-2", "not part 3 (passed), not 1.8 (past the section)");
});

test("the place leaves the section only when every part has passed", () => {
  const base = { "g10m1s3-1": PASS, "g10m1s6-1": PASS, "g10m1s7-1": PASS, "g10m1s7-2": PASS };
  assert.equal(advance("g10m1s7-2", state(base)), "g10m1s7-3");
  assert.equal(advance("g10m1s7-3", state({ ...base, "g10m1s7-3": PASS })), "g10m1s8-1");
});

test("a part that has since fallen below the gate is where the place goes — inside the section", () => {
  // On part 2, which now passes; part 1 has dropped to 0.6 since.
  const s = state({ "g10m1s3-1": PASS, "g10m1s6-1": PASS, "g10m1s7-1": 0.6, "g10m1s7-2": PASS, "g10m1s7-3": PASS });
  assert.equal(advance("g10m1s7-2", s), "g10m1s7-1");
});

test("FR-3206 unchanged: passing part 3 through a direct link does not move a pointer on part 1", () => {
  const s = state({ "g10m1s6-1": PASS, "g10m1s7-3": PASS });
  assert.equal(advanceTarget(s.cat, "g10m1s7-1", "g10m1s7-3", s.mastery, BOOK, SECTIONS), null);
});

test("entering a section lands on its first part not yet passed", () => {
  const s = state({ "g10m1s3-1": PASS, "g10m1s6-1": PASS, "g10m1s7-1": PASS });
  assert.equal(advance("g10m1s6-1", s), "g10m1s7-2", "part 1 already passed through a link");
  const fresh = state({ "g10m1s3-1": PASS, "g10m1s6-1": PASS });
  assert.equal(advance("g10m1s6-1", fresh), "g10m1s7-1");
});

test("SC-211: a split section with a part not passed is never skipped — the pointer parks before it", () => {
  // 1.6 has just passed. Part 1 of 1.7 gets a book prerequisite the student
  // has not met (6.1's objective, at 0), so it is not ready.
  const s = state({ "g10m1s3-1": PASS, "g10m1s6-1": PASS });
  const book = new Map(BOOK);
  book.set("lo:g10m1s7-1-2", ["lo:g10m6s1-1-1"]);
  assert.equal(
    advanceTarget(s.cat, "g10m1s6-1", "g10m1s6-1", s.mastery, book, SECTIONS),
    null,
    "park: never into part 2 ahead of part 1, never on to 1.8"
  );
  // The rule without sections skips the unready lesson, as ADR-0020 does for
  // any lesson — straight into part 2. That is what grouping forbids.
  assert.equal(advanceTarget(s.cat, "g10m1s6-1", "g10m1s6-1", s.mastery, book), "g10m1s7-2");
});

test("inside a section, a part whose prerequisite is unmet parks the place rather than letting it leave", () => {
  // Part 1 passes; part 2 needs the merged lesson's second objective, which is 0.3.
  const s = state({ "g10m1s6-1": PASS, "g10m1s7-1": PASS, "g10m1s3-1": 0.3 });
  assert.equal(advance("g10m1s7-1", s), null);
});

test("a section whose every part has passed is landed on when ready, and skipped when not", () => {
  const done = { "g10m1s3-1": PASS, "g10m1s6-1": PASS, "g10m1s7-1": PASS, "g10m1s7-2": PASS, "g10m1s7-3": PASS };
  assert.equal(advance("g10m1s6-1", state(done)), "g10m1s7-1", "as a passed lesson is landed on today");
  const book = new Map(BOOK);
  book.set("lo:g10m1s7-1-2", ["lo:g10m6s1-1-1"]); // part 1 unready
  const s = state(done);
  assert.equal(
    advanceTarget(s.cat, "g10m1s6-1", "g10m1s6-1", s.mastery, book, SECTIONS),
    "g10m1s8-1",
    "moving past a MASTERED section is allowed"
  );
});

test("FR-4317: part n-1 is a prerequisite of part n — derived, so part 2 is not ready while part 1 is below 0.5", () => {
  // Pointer on 1.6, which passes. Part 1 was attempted (0.3) — so the section
  // is entered at part 1, the first not passed. Part 2 is never offered first.
  const s = state({ "g10m1s3-1": PASS, "g10m1s6-1": PASS, "g10m1s7-1": 0.3 });
  assert.equal(advance("g10m1s6-1", s), "g10m1s7-1");
  // And the derived edge is what makes part 2 unready on its own.
  const withDerived = SECTIONS.prereqsFor(BOOK, s.cat);
  assert.ok(withDerived.get("lo:g10m1s7-2-2")?.includes("lo:g10m1s7-1-1"));
  assert.equal(BOOK.get("lo:g10m1s7-2-2"), undefined, "the book's own map is not written");
});

test("merged lessons and chapter introductions are walked as any lesson is", () => {
  const all = Object.fromEntries(ORDER.map((s) => [s, PASS]));
  assert.equal(advance("g10m1s8-1", state(all)), "g10m6s1-1");
  assert.equal(advance("g10m6s1-1", state(all)), "g10m6s2-1");
  assert.equal(advance("g10m6s2-1", state(all)), null, "the last lesson parks");
});

test("FR-4312: a stray lesson between the parts cannot make the walk skip it", () => {
  // SQL order with 1.8 wrongly between part 1 and part 2.
  const stray = ["g10m1s3-1", "g10m1s6-1", "g10m1s7-1", "g10m1s8-1", "g10m1s7-2", "g10m1s7-3", "g10m6s1-1", "g10m6s2-1"];
  const all = { "g10m1s3-1": PASS, "g10m1s6-1": PASS, "g10m1s7-1": PASS, "g10m1s7-2": PASS, "g10m1s7-3": PASS };
  const s = state(all, 0, stray);
  assert.equal(advance("g10m1s7-1", state({ ...all, "g10m1s7-2": 0 }, 0, stray)), "g10m1s7-2");
  assert.equal(advance("g10m1s7-3", s), "g10m1s8-1", "1.8 comes after the section, not skipped");
});

test("SC-211 simulated: across 3,000 random histories no pointer ever passes a split section with a part not passed", () => {
  const rand = prng(4313);
  const pos = new Map(ORDER.map((s, i) => [s, i] as const));
  const partSlugs = SECTIONS.groupOf("g10m1s7-1").slugs;
  const first = pos.get(partSlugs[0])!;
  const last = pos.get(partSlugs[partSlugs.length - 1])!;
  let moves = 0;
  let pastSection = 0;
  for (let h = 0; h < 3000; h++) {
    const scores: Scores = {};
    for (const slug of ORDER) scores[slug] = SCORES[Math.floor(rand() * SCORES.length)];
    let pointer: string = ORDER[0];
    for (let step = 0; step < 40; step++) {
      // A random event: practise the pointer's lesson, practise any lesson
      // through a link, or forget something.
      const r = rand();
      if (r < 0.5) scores[pointer] = Math.min(0.98, (scores[pointer] ?? 0) + 0.3);
      else if (r < 0.8) scores[ORDER[Math.floor(rand() * ORDER.length)]] = SCORES[Math.floor(rand() * SCORES.length)];
      else scores[ORDER[Math.floor(rand() * ORDER.length)]] = 0.4;
      const s = state(scores);
      const next = advance(pointer, s);
      if (next === null) continue;
      moves++;
      const from = pos.get(pointer)!;
      const to = pos.get(next)!;
      if (from <= last && to > last) {
        pastSection++;
        for (const p of partSlugs) {
          assert.ok(lessonGatePassed(s.cat[pos.get(p)!].los), `history ${h}: moved ${pointer} → ${next} with ${p} not passed`);
        }
      }
      if (to < from) {
        assert.ok(from >= first && from <= last && to >= first, `history ${h}: ${pointer} → ${next} walked back across a section boundary`);
      }
      pointer = next;
    }
  }
  assert.ok(moves > 1000, `the simulation moved the pointer (${moves})`);
  assert.ok(pastSection > 100, `and left the section often enough to mean something (${pastSection})`);
});

/* ================================================================ */
/* 2. The National proof                                            */
/* ================================================================ */

const NATIONAL = loadCatalogueFixture("all");
const NATIONAL_PREREQS = (() => {
  const m = new Map<string, string[]>();
  for (const e of NATIONAL.edges) m.set(e.dst, [...(m.get(e.dst) ?? []), e.src]);
  return m;
})();
/** Each National course's lessons, in catalogue order, as progression-db builds them. */
const NATIONAL_COURSES: Map<string, { slug: string; los: string[] }[]> = (() => {
  const out = new Map<string, { slug: string; los: string[] }[]>();
  const bySlug = new Map<string, { slug: string; los: string[] }>();
  for (const lo of NATIONAL.los) {
    if (!lo.courseId) continue;
    const slug = slugOfLo(lo.id);
    let l = bySlug.get(slug);
    if (!l) {
      l = { slug, los: [] };
      bySlug.set(slug, l);
      out.set(lo.courseId, [...(out.get(lo.courseId) ?? []), l]);
    }
    l.los.push(lo.id);
  }
  return out;
})();
/** One-section rows for every National lesson, group_key = the printed reference (colliding). */
const NATIONAL_ROWS: BookSectionRow[] = NATIONAL.los
  .filter((lo, i, all) => lo.courseId && all.findIndex((x) => slugOfLo(x.id) === slugOfLo(lo.id)) === i)
  .map((lo) => ({
    course_id: lo.courseId!,
    lesson_slug: slugOfLo(lo.id),
    title: lo.label,
    sections: [lo.syllabus_ref ?? slugOfLo(lo.id)],
    section_titles: [lo.label],
    part_n: null,
    part_of: null,
    chapter_intro: false,
    group_key: lo.syllabus_ref ?? slugOfLo(lo.id),
  }));

const INDEXES: [string, SectionIndex | undefined][] = [
  ["no store", undefined],
  ["an empty store", NO_SECTIONS],
  ["one-section rows for every National lesson", sectionIndexFromRows(NATIONAL_ROWS)],
  // hasSplits is TRUE here, so the section-aware walk runs on the National
  // catalogue: the strongest form of "reduces to today's rule".
  ["those rows plus the Grade 10 split section", sectionIndexFromRows([...NATIONAL_ROWS, ...G10_ROWS])],
];

test("the fixture is the real National catalogue: three courses, their lessons and edges", () => {
  assert.deepEqual([...NATIONAL_COURSES.keys()].sort(), [
    "course:prep3-arabic-ar",
    "course:prep3-math-en",
    "course:prep3-social-ar",
  ]);
  assert.ok(NATIONAL_COURSES.get("course:prep3-math-en")!.length >= 30);
  assert.ok(NATIONAL_PREREQS.size > 50);
  assert.equal(sectionIndexFromRows(NATIONAL_ROWS).hasSplits, false);
  assert.equal(INDEXES[3][1]!.hasSplits, true);
});

test("National proof: every next-lesson and advance decision is v0.9.2's, whatever the store holds", () => {
  const rand = prng(3202);
  let decisions = 0;
  let moved = 0;
  for (const [courseId, lessons] of NATIONAL_COURSES) {
    for (let trial = 0; trial < 150; trial++) {
      const mastery = new Map<string, number>();
      for (const l of lessons) for (const lo of l.los) mastery.set(lo, SCORES[Math.floor(rand() * SCORES.length)]);
      for (const pointer of lessons) {
        // Half the time the pointer's lesson passes, so the advance has somewhere to go.
        if (rand() < 0.5) for (const lo of pointer.los) mastery.set(lo, 0.9);
        const cat: ProgressionLesson[] = lessons.map((l) => ({
          slug: l.slug,
          courseId,
          los: l.los.map((id) => ({ id, mastery: mastery.get(id)! })),
        }));
        const wantNext = v092.nextLessonSlug(cat, pointer.slug, mastery, NATIONAL_PREREQS);
        const wantAdvance = v092.advanceTarget(cat, pointer.slug, pointer.slug, mastery, NATIONAL_PREREQS);
        for (const [name, index] of INDEXES) {
          assert.equal(
            nextLessonSlug(cat, pointer.slug, mastery, NATIONAL_PREREQS, index),
            wantNext,
            `${courseId} ${pointer.slug}, ${name}: next`
          );
          assert.equal(
            advanceTarget(cat, pointer.slug, pointer.slug, mastery, NATIONAL_PREREQS, index),
            wantAdvance,
            `${courseId} ${pointer.slug}, ${name}: advance`
          );
          decisions += 2;
        }
        if (wantAdvance !== null) moved++;
      }
    }
  }
  assert.ok(decisions > 30_000, `compared ${decisions} decisions`);
  assert.ok(moved > 1_000, `of which ${moved} advances actually moved the pointer`);
});

test("National proof: a whole-course walk, lesson by lesson, is v0.9.2's walk", () => {
  for (const [courseId, lessons] of NATIONAL_COURSES) {
    for (const [name, index] of INDEXES) {
      // A student who masters each lesson the pointer lands on, and nothing else.
      const mastery = new Map<string, number>();
      for (const l of lessons) for (const lo of l.los) mastery.set(lo, 0);
      const walk = (rule: "v092" | "now") => {
        const m = new Map(mastery);
        const seen: string[] = [];
        let pointer: string | null = lessons[0].slug;
        while (pointer && seen.length <= lessons.length) {
          seen.push(pointer);
          for (const lo of lessons.find((l) => l.slug === pointer)!.los) m.set(lo, 0.9);
          const cat: ProgressionLesson[] = lessons.map((l) => ({
            slug: l.slug,
            courseId,
            los: l.los.map((id) => ({ id, mastery: m.get(id)! })),
          }));
          pointer =
            rule === "v092"
              ? v092.advanceTarget(cat, pointer, pointer, m, NATIONAL_PREREQS)
              : advanceTarget(cat, pointer, pointer, m, NATIONAL_PREREQS, index);
        }
        return seen;
      };
      const want = walk("v092");
      assert.deepEqual(walk("now"), want, `${courseId}, ${name}`);
      assert.ok(want.length > 1, `${courseId}: the walk goes somewhere`);
    }
  }
});
