/**
 * BOOK SECTIONS ON THE STUDENT SURFACES (feature 003, decision 18; WP-F,
 * T407–T410): what the check-in, the subject home, the progress page, the
 * skill map and the tutor's Ask context make of `lib/book-sections.ts`'s
 * rules — through `lib/section-label.ts` and `lib/spine-layout.ts`, pure, no
 * database.
 *
 * Two halves, and the first one is the invariant:
 *
 *   1. NATIONAL IS UNCHANGED. Every National lesson, given the one-section
 *      `course_lessons` row the loader writes for it (T404) — including the
 *      Arabic lessons whose stored title is NOT what the product has always
 *      called them — shows no provenance, is named as before, rolls up
 *      nothing, pulls nothing into the Ask focus, and lays the skill map out
 *      exactly as before.
 *   2. GRADE 10, on the prompts fixture (`g10-prompt-fixture.mts`: the merge
 *      1.2–1.3 and 1.7 split in three), for a student who passed part 1 and —
 *      through a direct link — part 3, and has started part 2 (US6
 *      scenario 3): the check-in reads "1.7 Factorisation · part 2 of 3" under
 *      "Continue Factorisation", the roll-up "2 of 3 parts mastered", the Ask
 *      focus for part 2 holds parts 1 and 3, and the skill map frames the
 *      parts as one labelled group, a column apart.
 *
 * The real prompts over the same fixture are `g10-prompts.test.mts`; the real
 * pages are screenshotted in the WP-F report.
 *
 * @covers FR-4311
 * @covers FR-4314
 * @covers FR-4315
 * @covers FR-4316
 * @covers FR-4318
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  NO_SECTIONS,
  buildSectionIndex,
  partPrereqEdges,
  provenanceFromRow,
  sectionIndexFromRows,
  sectionRecommendation,
  type LessonProvenance,
} from "./book-sections.ts";
import {
  bookShapedCourses,
  continueText,
  lessonChipText,
  lessonHeading,
  lessonHeadingText,
  rollupText,
  sectionFocusObjectives,
  sectionLabel,
  sectionNumbers,
  sectionProgress,
  shownProvenance,
} from "./section-label.ts";
import {
  FRAME_LABEL_H,
  FRAME_PAD,
  NODE_H,
  computeLayers,
  gatherSections,
  layoutSpine,
  sectionFrames,
} from "./spine-layout.ts";
import { slugOfLo } from "./lesson-slug.ts";
import type { ProgressionLesson } from "./progression.ts";
import { MATHS_SEED_FILES, loadMathsGraph } from "./spine-maths-fixture.mts";
import { G10_BOOK_SECTIONS, G10_EDGES, G10_NODES } from "./g10-prompt-fixture.mts";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

type SeedNode = { id: string; kind: string; label: string; syllabus_ref?: string | null };
type SeedEdge = { src: string; dst: string; type: string };

/**
 * The one-section rows the loader writes for every National lesson (T404,
 * `services/extraction/load_seed.py` `lesson_rows`): the printed number from
 * the first objective's "Lesson 4-1" (else the slug's digits), the title from
 * the syllabus reference after " · " (else the first objective's label).
 */
function nationalRows(): LessonProvenance[] {
  const nodes = new Map<string, SeedNode>();
  const edges: SeedEdge[] = [];
  for (const f of [...MATHS_SEED_FILES, "social-t1", "arabic-t1", "arabic-t2"]) {
    const doc = JSON.parse(
      readFileSync(fileURLToPath(new URL(`../../../services/extraction/seed/${f}.json`, import.meta.url)), "utf8")
    ) as { nodes: SeedNode[]; edges: SeedEdge[] };
    for (const n of doc.nodes) if (!nodes.has(n.id)) nodes.set(n.id, n);
    edges.push(...doc.edges);
  }
  const moduleOf = new Map(edges.filter((e) => e.type === "teaches").map((e) => [e.dst, e.src]));
  const courseOf = new Map(edges.filter((e) => e.type === "part_of").map((e) => [e.src, e.dst]));
  const first = new Map<string, SeedNode>();
  for (const n of nodes.values()) {
    if (n.kind !== "learning_objective") continue;
    const slug = slugOfLo(n.id);
    const prev = first.get(slug);
    const k = (x: SeedNode) => Number(x.id.split("-").pop());
    if (!prev || k(n) < k(prev)) first.set(slug, n);
  }
  return [...first].map(([slug, n]) => {
    const ref = n.syllabus_ref ?? "";
    const number = /Lesson\s+([0-9][0-9A-Za-z.-]*)/.exec(ref)?.[1] ?? slug.replace(/^[a-z]+/, "");
    const title = ref.includes(" · ") && ref.split(" · ")[1]!.trim() ? ref.split(" · ")[1]!.trim() : n.label;
    return provenanceFromRow({
      course_id: courseOf.get(moduleOf.get(n.id) ?? "") ?? "course:unknown",
      lesson_slug: slug,
      title,
      sections: [number],
      section_titles: [title],
      part_n: null,
      part_of: null,
      chapter_intro: false,
      group_key: number,
    });
  });
}

const G10_ROWS = G10_BOOK_SECTIONS.map((r) => provenanceFromRow({ ...r, sections: [...r.sections], section_titles: [...r.section_titles] }));
const G10_INDEX = buildSectionIndex(G10_ROWS);

/** The fixture's lessons in catalogue order, with a student's mastery. */
function g10Lessons(mastery: Record<string, number>): ProgressionLesson[] {
  const bySlug = new Map<string, { slug: string; courseId: string; los: { id: string; mastery: number }[] }>();
  for (const n of G10_NODES) {
    if (n.kind !== "learning_objective") continue;
    const slug = slugOfLo(n.id);
    const l = bySlug.get(slug) ?? { slug, courseId: "course:us-g10-math-en", los: [] };
    bySlug.set(slug, l);
    l.los.push({ id: n.id, mastery: mastery[n.id] ?? 0 });
  }
  return [...bySlug.values()];
}

const g10Lo = (slug: string) =>
  G10_NODES.filter((n) => n.kind === "learning_objective" && slugOfLo(n.id) === slug).map((n) => n.id);

/** US6 scenario 3: part 1 passed, part 3 passed through a link, part 2 started. */
const SCENARIO: Record<string, number> = {
  ...Object.fromEntries(g10Lo("g10m1s3-1").map((id) => [id, 0.9])),
  ...Object.fromEntries(g10Lo("g10m1s7-1").map((id) => [id, 0.9])),
  ...Object.fromEntries(g10Lo("g10m1s7-3").map((id) => [id, 0.9])),
  "lo:g10m1s7-2-1": 0.4,
};

/* ------------------------------------------------------------------ */
/* 1. National is unchanged                                            */
/* ------------------------------------------------------------------ */

test("National: the loader's one-section rows show nothing — no course is book-shaped, no lesson is renamed", () => {
  const rows = nationalRows();
  assert.equal(rows.length, 69, "every National lesson has its row");
  assert.equal(bookShapedCourses(rows).size, 0);
  assert.equal(shownProvenance(rows).size, 0);
  // why the rule is per course and not per row: an Arabic lesson's stored
  // title is its real name, which is NOT what the catalogue and the tutor's
  // prompt have always called it (its first objective's label) — reading
  // titles from any row would rename all twenty of them (FR-4206)
  const arabic = rows.filter((r) => r.courseId === "course:prep3-arabic-ar");
  assert.equal(arabic.length, 20);
  assert.ok(arabic.every((r) => r.title !== "فهم النص والاستماع"), "the store's Arabic titles differ from what is shown today");
  // and a National lesson is never a unit of several, whatever its number
  const index = buildSectionIndex(rows);
  assert.equal(index.hasSplits, false);
  assert.deepEqual(sectionProgress([{ slug: "u4-1", courseId: "course:prep3-math-en", los: [{ id: "lo:u4-1-1", mastery: 0.5 }] }], index), []);
  assert.deepEqual(sectionFocusObjectives("lo:u4-1-1", [{ slug: "u4-1", courseId: null, los: [{ id: "lo:u4-1-1", mastery: 0 }] }], index), []);
});

test("National: the skill map lays out exactly as before with a section lookup that finds nothing", () => {
  const { los } = loadMathsGraph();
  for (const width of [744, 1180, 1600]) {
    const before = layoutSpine(los, width);
    const after = layoutSpine(los, width, () => null);
    assert.deepEqual(after, before, `width ${width}`);
    assert.deepEqual(sectionFrames(after.placed, after.nodeW, () => null), []);
  }
});

/* ------------------------------------------------------------------ */
/* 2. Grade 10                                                         */
/* ------------------------------------------------------------------ */

test("FR-4311, FR-4318: the fixture's provenance is shown, and printed as the book prints it", () => {
  assert.deepEqual([...bookShapedCourses(G10_ROWS)], ["course:us-g10-math-en"]);
  const shown = shownProvenance(G10_ROWS);
  assert.deepEqual([...shown.keys()].sort(), ["g10m1s3-1", "g10m1s7-1", "g10m1s7-2", "g10m1s7-3", "g10m6s2-1"]);

  const part2 = lessonHeading(shown.get("g10m1s7-2")!);
  assert.deepEqual(part2, { number: "1.7", title: "Factorisation", part: "part 2 of 3" });
  assert.equal(lessonHeadingText(part2), "1.7 Factorisation · part 2 of 3");
  assert.equal(lessonChipText(part2, shown.get("g10m1s7-2")!), "1.7 · part 2");

  const merged = lessonHeading(shown.get("g10m1s3-1")!);
  assert.deepEqual(merged, { number: "1.2–1.3", title: "Rational and irrational numbers", part: null });
  assert.equal(lessonHeadingText(merged), "1.2–1.3 Rational and irrational numbers");

  assert.equal(lessonHeadingText(lessonHeading(shown.get("g10m6s2-1")!)), "6.2 Linear functions");
});

test("sectionNumbers: a range only for consecutive sections, never claiming one the lesson does not cover", () => {
  assert.equal(sectionNumbers(["1.7"]), "1.7");
  assert.equal(sectionNumbers(["1.2", "1.3"]), "1.2–1.3");
  assert.equal(sectionNumbers(["5.2", "5.3", "5.4"]), "5.2–5.4");
  assert.equal(sectionNumbers(["5.2", "5.4"]), "5.2, 5.4");
  assert.equal(sectionNumbers(["1.9", "2.1"]), "1.9, 2.1");
  assert.equal(sectionNumbers([]), "");
});

test("FR-4314: the roll-up reads '2 of 3 parts mastered', and the section is not mastered until part 2 is", () => {
  const rows = sectionProgress(g10Lessons(SCENARIO), G10_INDEX);
  assert.equal(rows.length, 1, "one split section: 1.7");
  const [r] = rows;
  assert.equal(sectionLabel(r!), "1.7 Factorisation");
  assert.equal(r!.parts, 3);
  assert.equal(r!.mastered, 2);
  assert.equal(r!.isMastered, false);
  assert.equal(r!.started, true);
  assert.equal(rollupText(r!), "2 of 3 parts mastered");
  assert.deepEqual(r!.partsMastered.map((p) => [p.n, p.mastered]), [[1, true], [2, false], [3, true]]);

  // every part passed: mastered; nothing attempted: not started
  const done = sectionProgress(g10Lessons({ ...SCENARIO, "lo:g10m1s7-2-1": 0.9, "lo:g10m1s7-2-2": 0.9 }), G10_INDEX)[0]!;
  assert.equal(rollupText(done), "3 of 3 parts mastered");
  assert.equal(done.isMastered, true);
  const fresh = sectionProgress(g10Lessons({}), G10_INDEX)[0]!;
  assert.equal(fresh.started, false);
  assert.equal(rollupText(fresh), "0 of 3 parts mastered");
});

test("FR-4313 on the check-in: 'Continue Factorisation' once a part is attempted, and not before", () => {
  const rec = sectionRecommendation("g10m1s7-2", g10Lessons(SCENARIO), G10_INDEX);
  assert.ok(rec);
  assert.equal(continueText(rec), "Continue Factorisation");
  assert.deepEqual(rec.part, { slug: "g10m1s7-2", n: 2, of: 3 });
  // an untouched section: the card keeps its own "Up next"
  assert.equal(sectionRecommendation("g10m1s7-1", g10Lessons({}), G10_INDEX), null);
  // a lesson that is not a part never gets one
  assert.equal(sectionRecommendation("g10m1s3-1", g10Lessons(SCENARIO), G10_INDEX), null);
});

test("FR-4316: part 2's section, nearest part first — its own part, then parts 1 and 3", () => {
  const catalog = g10Lessons({});
  assert.deepEqual(sectionFocusObjectives("lo:g10m1s7-2-1", catalog, G10_INDEX), [
    "lo:g10m1s7-2-1",
    "lo:g10m1s7-2-2",
    "lo:g10m1s7-1-1",
    "lo:g10m1s7-1-2",
    "lo:g10m1s7-3-1",
    "lo:g10m1s7-3-2",
  ]);
  assert.deepEqual(sectionFocusObjectives("lo:g10m1s7-3-2", catalog, G10_INDEX), [
    "lo:g10m1s7-3-1",
    "lo:g10m1s7-3-2",
    "lo:g10m1s7-2-1",
    "lo:g10m1s7-2-2",
    "lo:g10m1s7-1-1",
    "lo:g10m1s7-1-2",
  ]);
  assert.deepEqual(sectionFocusObjectives("lo:g10m1s3-1-1", catalog, G10_INDEX), [], "the merge is one lesson, not parts");
  assert.deepEqual(sectionFocusObjectives("lo:g10m1s7-2-1", catalog, NO_SECTIONS), [], "no store, no change");
});

test("FR-4315: the skill map frames 1.7's parts as one labelled group, part n a column right of part n-1", () => {
  // the map's own inputs, as `getSpineData` builds them: the book's edges
  // plus the derived part edges, layered together
  const ids = G10_NODES.filter((n) => n.kind === "learning_objective").map((n) => n.id);
  const bookEdges = G10_EDGES.filter((e) => e.type === "prerequisite_of").map((e) => ({ src: e.src, dst: e.dst }));
  const partEdges = partPrereqEdges(g10Lessons({}), G10_INDEX);
  assert.equal(partEdges.length, 8);
  const layers = computeLayers(ids, [...bookEdges, ...partEdges]);
  const prereqs = new Map<string, string[]>();
  for (const e of [...bookEdges, ...partEdges]) prereqs.set(e.dst, [...(prereqs.get(e.dst) ?? []), e.src]);
  const los = ids.map((id, i) => ({ id, layer: layers.get(id) ?? 0, prereqIds: prereqs.get(id) ?? [], catalogRank: i }));

  const group = new Map<string, { key: string; part: number }>();
  for (const g of G10_INDEX.splitGroups) {
    for (const slug of g.slugs) {
      const n = G10_INDEX.provenanceOf(slug)!.part!.n;
      for (const id of g10Lo(slug)) group.set(id, { key: g.key, part: n });
    }
  }
  const groupOf = (id: string) => group.get(id)?.key ?? null;
  const { placed, nodeW } = layoutSpine(los, 1180, groupOf);
  const frames = sectionFrames(placed, nodeW, groupOf);

  // every part objective is framed, exactly once; nothing else is
  const framed = frames.flatMap((f) => f.loIds).sort();
  assert.deepEqual(framed, [...group.keys()].sort());
  assert.ok(frames.every((f) => f.key === G10_INDEX.splitGroups[0]!.key));

  // part n sits strictly right of every part n-1 objective (FR-4317 drawn)
  const layerOf = new Map(placed.map((p) => [p.lo.id, p.lo.layer]));
  const maxLayer = (n: number) => Math.max(...[...group].filter(([, g]) => g.part === n).map(([id]) => layerOf.get(id)!));
  const minLayer = (n: number) => Math.min(...[...group].filter(([, g]) => g.part === n).map(([id]) => layerOf.get(id)!));
  assert.ok(minLayer(2) > maxLayer(1) && minLayer(3) > maxLayer(2));

  // a frame holds its cards with room for the label, and covers no other card
  for (const f of frames) {
    for (const p of placed) {
      const inside = p.x >= f.x && p.x + nodeW <= f.x + f.width && p.y >= f.y && p.y + NODE_H <= f.y + f.height;
      const overlaps = p.x < f.x + f.width && p.x + nodeW > f.x && p.y < f.y + f.height && p.y + NODE_H > f.y;
      if (f.loIds.includes(p.lo.id)) {
        assert.ok(inside, `${p.lo.id} sits inside its frame`);
        assert.ok(p.y - f.y >= FRAME_PAD + FRAME_LABEL_H - 1e-9 || p.lo.id !== f.loIds[0], "room above the first card for the label");
      } else {
        assert.ok(!overlaps, `the ${f.key} frame covers no other card (${p.lo.id})`);
      }
    }
  }
});

test("gatherSections: a column's members of one section come together, everything else keeps its order", () => {
  const lo = (id: string) => ({ id, layer: 0, prereqIds: [], catalogRank: 0 });
  const col = ["a", "p1", "b", "p2", "c", "q1", "p3"].map(lo);
  const key = (id: string) => (id.startsWith("p") ? "P" : id.startsWith("q") ? "Q" : null);
  assert.deepEqual(gatherSections(col, key).map((l) => l.id), ["a", "p1", "p2", "p3", "b", "c", "q1"]);
  assert.deepEqual(gatherSections(col, () => null).map((l) => l.id), col.map((l) => l.id));
});

test("the store, read as rows: the index the readers build is the fixture's", () => {
  const index = sectionIndexFromRows(
    G10_BOOK_SECTIONS.map((r) => ({ ...r, sections: [...r.sections], section_titles: [...r.section_titles] }))
  );
  assert.equal(index.hasSplits, true);
  assert.deepEqual(index.splitGroups.map((g) => [g.number, g.title, g.slugs]), [
    ["1.7", "Factorisation", ["g10m1s7-1", "g10m1s7-2", "g10m1s7-3"]],
  ]);
});
