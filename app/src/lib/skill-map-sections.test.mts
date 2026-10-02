/**
 * FR-4315 on the Your Progress Map: the parts of one split book section are
 * one visible group, labelled by the section — and a subject with no split
 * section gets exactly the map main (v0.11.0) draws.
 *
 * The map is a set of chapter clusters: each chapter's objectives sit on an
 * outer ring in lesson order, so the parts of one section — consecutive
 * lessons (FR-4312) — are a CONTIGUOUS ARC of that ring. The group is that
 * arc (`MapSection`); the canvas draws it as a tray behind those objectives
 * and names it from the lessons level on (`lib/skill-map-labels.ts`); a part
 * lesson's own name carries "part n of m"; and every framed lesson and
 * objective says its section in its accessible name.
 *
 * Replaces the old column map's frame tests (`spine-layout.ts`
 * `sectionFrames`, retired with that map): same fixture (the Grade 10
 * section 1.7, in three parts), same facts, now on the ring.
 *
 * Three parts:
 *   1. placement — which objectives a group holds, where its arc is, what it
 *      is called, what each part says about it;
 *   2. what the canvas is told — label candidates by level and selection, the
 *      arc path, the accessible names and the token-only styling of the code
 *      that draws it;
 *   3. NATIONAL IS UNCHANGED — with no split section the model, the views and
 *      the label rules equal main's v0.11.0 output (`skill-map-main.golden.json`,
 *      written by running the same projection over `git archive origin/main`),
 *      field for field, and the new fields are empty.
 *
 * @covers FR-4315
 * @covers FR-4318
 * @covers FR-3224
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { PREP3_MATH_EN, US_G10_MATH_EN } from "./courses.ts";
import { buildSectionIndex, partPrereqEdges, provenanceFromRow } from "./book-sections.ts";
import { G10_BOOK_SECTIONS, G10_EDGES, G10_NODES } from "./g10-prompt-fixture.mts";
import { lessonNamesOnMap, sectionGroupsOf } from "./section-label.ts";
import { slugOfLo } from "./lesson-slug.ts";
import {
  annularSectorPath,
  buildSkillMap,
  fitView,
  focusOf,
  linkStyle,
  sectionNameOf,
  viewFor,
  type MapObjectiveInput,
  type MapSectionInput,
  type Selection,
} from "./skill-map.ts";
import { labelCandidates } from "./skill-map-labels.ts";
import { loadMathsGraph } from "./spine-maths-fixture.mts";
import type { ProgressionLesson } from "./progression.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** The Grade 10 fixture as the map's inputs: objectives in catalogue order, module and course set. */
function g10Inputs(): MapObjectiveInput[] {
  const moduleOf = new Map(G10_EDGES.filter((e) => e.type === "teaches").map((e) => [e.dst, e.src]));
  const label = new Map(G10_NODES.map((n) => [n.id, n.label]));
  return G10_NODES.filter((n) => n.kind === "learning_objective").map((n) => ({
    id: n.id,
    label: n.label,
    moduleId: moduleOf.get(n.id) ?? null,
    moduleLabel: label.get(moduleOf.get(n.id) ?? "") ?? null,
    courseId: US_G10_MATH_EN,
    syllabusRef: null,
    baseline: 0,
    current: 0,
  }));
}

const G10_ROWS = G10_BOOK_SECTIONS.map((r) =>
  provenanceFromRow({ ...r, sections: [...r.sections], section_titles: [...r.section_titles] })
);
const G10_INDEX = buildSectionIndex(G10_ROWS);

/** The fixture's lessons in catalogue order — what `getSpineData` hands `sectionGroupsOf`. */
function g10Lessons(): ProgressionLesson[] {
  const by = new Map<string, ProgressionLesson>();
  for (const n of G10_NODES) {
    if (n.kind !== "learning_objective") continue;
    const slug = slugOfLo(n.id);
    const l = by.get(slug) ?? { slug, courseId: US_G10_MATH_EN, los: [] };
    by.set(slug, l);
    (l.los as { id: string; mastery: number }[]).push({ id: n.id, mastery: 0 });
  }
  return [...by.values()];
}

const GROUPS = sectionGroupsOf(G10_INDEX, g10Lessons());
const bookEdges = G10_EDGES.filter((e) => e.type === "prerequisite_of").map((e) => ({ src: e.src, dst: e.dst }));
const EDGES = [...bookEdges, ...partPrereqEdges(g10Lessons(), G10_INDEX)];
const TITLES = lessonNamesOnMap(G10_ROWS, {});
const M = buildSkillMap(g10Inputs(), EDGES, TITLES, GROUPS);

/** A hand-built map: `chapters` is chapter id → its lessons → their objective counts. */
function synthetic(
  chapters: Record<string, Record<string, number>>,
  groups: MapSectionInput[]
) {
  const los: MapObjectiveInput[] = [];
  for (const [ch, lessons] of Object.entries(chapters))
    for (const [slug, n] of Object.entries(lessons))
      for (let k = 1; k <= n; k++)
        los.push({
          id: `lo:${slug}-${k}`,
          label: `${slug} ${k}`,
          moduleId: `module:${ch}`,
          moduleLabel: `Chapter ${ch} — Title ${ch}`,
          courseId: US_G10_MATH_EN,
          syllabusRef: null,
          baseline: 0,
          current: 0,
        });
  return buildSkillMap(los, [], {}, groups);
}
const part = (slug: string, n: number, of: number, count: number) => ({
  slug,
  n,
  of,
  loIds: Array.from({ length: count }, (_, k) => `lo:${slug}-${k + 1}`),
});

/* ------------------------------------------------------------------ */
/* 1. Placement                                                        */
/* ------------------------------------------------------------------ */

test("the real shaping: the store's split section becomes one group of three parts, in part order", () => {
  assert.equal(GROUPS.length, 1);
  const [g] = GROUPS;
  assert.deepEqual([g!.number, g!.title], ["1.7", "Factorisation"]);
  assert.deepEqual(
    g!.parts.map((p) => [p.slug, p.n, p.of, p.loIds.length]),
    [
      ["g10m1s7-1", 1, 3, 2],
      ["g10m1s7-2", 2, 3, 2],
      ["g10m1s7-3", 3, 3, 2],
    ]
  );
});

test("FR-4315: 1.7's three parts are ONE group on chapter 1's ring — a contiguous arc, labelled by the section", () => {
  assert.equal(M.sections.length, 1);
  const [s] = M.sections;
  assert.equal(s!.label, "1.7 Factorisation");
  assert.equal(s!.chapterId, "module:g10m-c01");
  assert.deepEqual(s!.lessons, ["g10m1s7-1", "g10m1s7-2", "g10m1s7-3"]);
  assert.deepEqual(s!.objectives, [
    "lo:g10m1s7-1-1", "lo:g10m1s7-1-2", "lo:g10m1s7-2-1", "lo:g10m1s7-2-2", "lo:g10m1s7-3-1", "lo:g10m1s7-3-2",
  ]);

  // the arc runs from the first objective's angle to the last's, and covers
  // exactly the section's objectives: no other objective of the chapter falls
  // inside it (a half step past either end is the tray's own padding)
  const c = M.chapterById.get(s!.chapterId)!;
  const first = M.objectiveById.get(s!.objectives[0]!)!;
  const last = M.objectiveById.get(s!.objectives[s!.objectives.length - 1]!)!;
  assert.equal(s!.a0, first.angle);
  assert.equal(s!.a1, last.angle);
  assert.equal(s!.mid, (first.angle + last.angle) / 2);
  assert.ok(Math.abs(s!.step - (2 * Math.PI) / c.objectives.length) < 1e-12);
  const inside = c.objectives.filter((id) => {
    const a = M.objectiveById.get(id)!.angle;
    return a >= s!.a0 - s!.step / 2 - 1e-9 && a <= s!.a1 + s!.step / 2 + 1e-9;
  });
  assert.deepEqual(inside, s!.objectives, "the arc holds the section's objectives and nothing else");
  // the other chapter has no group
  assert.ok(M.sections.every((x) => x.chapterId !== "module:g10m-c06"));
});

test("FR-4315, FR-4318: each part says which section it belongs to and which part it is; other lessons say nothing", () => {
  assert.equal(sectionNameOf(M, "g10m1s7-1"), "1.7 Factorisation, part 1 of 3");
  assert.equal(sectionNameOf(M, "g10m1s7-2"), "1.7 Factorisation, part 2 of 3");
  assert.equal(sectionNameOf(M, "g10m1s7-3"), "1.7 Factorisation, part 3 of 3");
  assert.equal(sectionNameOf(M, "g10m1s3-1"), null, "a merged lesson is one lesson, not a part");
  assert.equal(sectionNameOf(M, "g10m6s2-1"), null);
  assert.equal(M.sectionOfLesson.get("g10m1s7-2")!.sectionId, M.sections[0]!.id);
});

test("a part lesson is named the way every other surface names it, so its three parts can be told apart", () => {
  assert.equal(M.lessonBySlug.get("g10m1s7-2")!.title, "1.7 Factorisation · part 2 of 3");
  assert.equal(M.lessonBySlug.get("g10m1s3-1")!.title, "1.2–1.3 Rational and irrational numbers");
  assert.equal(M.lessonBySlug.get("g10m6s2-1")!.title, "6.2 Linear functions");
});

test("FR-4317: the part n-1 → part n prerequisites the product adds are links on the map, marked as the product's", () => {
  const key = (a: string, b: string) => `${a}>${b}`;
  const links = new Set(M.links.map((l) => key(l.a, l.b)));
  assert.ok(links.has(key("lo:g10m1s7-1-1", "lo:g10m1s7-2-1")), "part 1 → part 2");
  assert.ok(links.has(key("lo:g10m1s7-2-2", "lo:g10m1s7-3-1")), "part 2 → part 3");
  assert.equal(M.links.length, EDGES.length, "every link kept, none invented");
  // marked as the product's — and only those: the book's own links carry no mark
  const derived = M.links.filter((l) => l.derived === true);
  assert.equal(derived.length, partPrereqEdges(g10Lessons(), G10_INDEX).length);
  assert.ok(M.links.filter((l) => l.derived === undefined).every((l) => !("derived" in l)));
  assert.equal(M.links.length - derived.length, bookEdges.length);
});

test("the product's part links answer a question asked of ONE part: hidden at rest and on a chapter, drawn for a lesson or an objective", () => {
  const part = M.links.find((l) => l.a === "lo:g10m1s7-1-1" && l.b === "lo:g10m1s7-2-1")!;
  assert.equal(part.derived, true);
  assert.equal(part.across, false);
  const at = (sel: Selection) => linkStyle(part, focusOf(M, sel), sel);
  assert.equal(at(null), "hidden", "within a chapter: only when an end is selected");
  assert.equal(at({ kind: "chapter", id: "module:g10m-c01" }), "hidden", "a chapter would light all 15 of them");
  assert.equal(at({ kind: "lesson", slug: "g10m1s7-2" }), "strong");
  assert.equal(at({ kind: "lesson", slug: "g10m1s7-1" }), "strong");
  assert.equal(at({ kind: "objective", id: "lo:g10m1s7-2-1" }), "strong");
  assert.equal(at({ kind: "lesson", slug: "g10m1s6-1" }), "hidden", "a lesson that is not an end of it");
  // the book's own link inside the chapter is unaffected by the rule: still drawn on a chapter
  const book = M.links.find((l) => l.derived === undefined && !l.across)!;
  assert.equal(linkStyle(book, focusOf(M, { kind: "chapter", id: "module:g10m-c01" }), { kind: "chapter", id: "module:g10m-c01" }), "strong");
});

test("a run is broken by another lesson standing between the parts, and by a chapter boundary — each its own group", () => {
  // part 1 and part 2 of "9.9" with a stray lesson between them, then part 3 in the NEXT chapter
  const stray = synthetic(
    { a: { x1: 2, stray: 1, x2: 2 }, b: { x3: 1 } },
    [{ key: "g|9.9", number: "9.9", title: "Split", parts: [part("x1", 1, 3, 2), part("x2", 2, 3, 2), part("x3", 3, 3, 1)] }]
  );
  assert.deepEqual(
    stray.sections.map((s) => [s.id, s.chapterId, s.objectives.length]),
    [
      ["g|9.9#0", "module:a", 2],
      ["g|9.9#1", "module:a", 2],
      ["g|9.9#2", "module:b", 1],
    ]
  );
  const covered = new Set(stray.sections.flatMap((s) => s.objectives));
  assert.ok(!covered.has("lo:stray-1"), "no tray over an objective that is not the section's");
  assert.deepEqual(stray.sections.map((s) => s.label), ["9.9 Split", "9.9 Split", "9.9 Split"]);
});

test("a section that is a whole chapter is a whole ring; a section with a lone present part is still a labelled group", () => {
  const whole = synthetic({ a: { x1: 2, x2: 3 } }, [
    { key: "k", number: "2.1", title: "All", parts: [part("x1", 1, 2, 2), part("x2", 2, 2, 3)] },
  ]);
  assert.equal(whole.sections.length, 1);
  assert.equal(whole.sections[0]!.objectives.length, 5);
  const lone = synthetic({ a: { x1: 2, y: 2 } }, [
    { key: "k", number: "2.1", title: "All", parts: [part("x1", 1, 2, 2), part("x2", 2, 2, 3)] },
  ]);
  assert.deepEqual(lone.sections.map((s) => s.lessons), [["x1"]]);
  assert.equal(sectionNameOf(lone, "x1"), "2.1 All, part 1 of 2");
});

test("a group none of whose objectives is on this map places nothing (another course's section)", () => {
  const m = synthetic({ a: { y: 3 } }, [
    { key: "k", number: "1.7", title: "Elsewhere", parts: [part("x1", 1, 2, 2), part("x2", 2, 2, 2)] },
  ]);
  assert.deepEqual(m.sections, []);
  assert.equal(m.sectionOfLesson.size, 0);
});

test("a section with no printed number or title is still named: by its key", () => {
  const m = synthetic({ a: { x1: 1, x2: 1 } }, [
    { key: "course|g1", number: null, title: null, parts: [part("x1", 1, 2, 1), part("x2", 2, 2, 1)] },
  ]);
  assert.equal(m.sections[0]!.label, "course|g1");
});

/* ------------------------------------------------------------------ */
/* 2. What the canvas is told                                          */
/* ------------------------------------------------------------------ */

const sectionPicks = (sel: Selection, level: 0 | 1 | 2) =>
  labelCandidates(M, sel, level).filter((p) => p.kind === "section");

test("the section's name is written from the lessons level on, never at the chapters level", () => {
  assert.deepEqual(sectionPicks(null, 0), []);
  assert.deepEqual(sectionPicks({ kind: "chapter", id: "module:g10m-c01" }, 0), []);
  assert.equal(sectionPicks(null, 1).length, 1);
  assert.equal(sectionPicks(null, 2).length, 1);
});

test("text follows the selection: with a chapter selected only its own sections are named, the selected lesson's first", () => {
  // nothing selected: every section, at the lowest priority
  assert.equal(sectionPicks(null, 1)[0]!.priority, 4);
  // another chapter's selection names none of chapter 1's
  assert.deepEqual(sectionPicks({ kind: "chapter", id: "module:g10m-c06" }, 1), []);
  // this chapter: kept behind the selection, ahead of the unselected
  assert.equal(sectionPicks({ kind: "chapter", id: "module:g10m-c01" }, 1)[0]!.priority, 2);
  // a part selected: its own section is kept ahead of the chapter's other names
  const own = sectionPicks({ kind: "lesson", slug: "g10m1s7-2" }, 1)[0]!;
  assert.equal(own.priority, 1);
  assert.equal(own.id, M.sections[0]!.id);
  const viaObjective = sectionPicks({ kind: "objective", id: "lo:g10m1s7-3-1" }, 2)[0]!;
  assert.equal(viaObjective.priority, 1);
  // a lesson outside the section selected: the section is named, but not ahead
  assert.equal(sectionPicks({ kind: "lesson", slug: "g10m1s3-1" }, 1)[0]!.priority, 2);
});

test("a section's name is below the selection in priority: it never displaces the selected lesson's own name", () => {
  const picks = labelCandidates(M, { kind: "lesson", slug: "g10m1s7-2" }, 1);
  const selected = picks.find((p) => p.kind === "lesson" && p.id === "g10m1s7-2")!;
  assert.equal(selected.priority, 0);
  assert.ok(picks.find((p) => p.kind === "section")!.priority > selected.priority);
});

test("annularSectorPath: a wedge of the ring, in screen pixels; the large-arc flag follows the span; the full ring is an annulus", () => {
  const quarter = annularSectorPath(100, 100, 40, 60, 0, Math.PI / 2);
  assert.match(quarter, /^M160,100 A60,60 0 0 1 100,160 L100,140 A40,40 0 0 0 140,100 Z$/);
  const big = annularSectorPath(100, 100, 40, 60, 0, 1.5 * Math.PI);
  assert.match(big, / 0 1 1 /, "an arc over half the ring takes the long way round");
  assert.match(big, / 0 1 0 /, "and so does its inner edge, back the other way");
  const ring = annularSectorPath(100, 100, 40, 60, 0, 2 * Math.PI);
  assert.equal((ring.match(/M/g) ?? []).length, 2, "an outer and an inner circle");
  assert.equal((ring.match(/Z/g) ?? []).length, 2);
  // a tray that reaches the centre closes through it
  assert.match(annularSectorPath(100, 100, 0, 60, 0, 1), /L100,100 Z$/);
});

test("the canvas draws the tray, names it and says the section in every framed node's accessible name — with tokens only", () => {
  const canvas = readFileSync(here("../components/spine/SkillMap.tsx"), "utf8");
  // the tray: the page's card colour, the map's own muted outline and thin stroke token
  assert.match(canvas, /model\.sections\.map\(\(sec\) =>/);
  assert.match(canvas, /fill="var\(--card\)"/);
  assert.match(canvas, /stroke="var\(--play-disabled-border\)"/);
  assert.match(canvas, /strokeWidth: "var\(--skillmap-stroke-objective\)"/);
  // decoration for the eye: hidden from assistive technology, no pointer events, no tab stop
  assert.match(canvas, /aria-hidden\s+pointerEvents="none"/);
  // the name tag: card colour with its paired ink, thin Play stroke
  assert.match(canvas, /rounded-\[var\(--play-radius-pill\)\] bg-card px-2\.5 font-display text-\[12px\] font-bold leading-none text-ink/);
  // the accessible names
  assert.match(canvas, /aria-label=\{`Lesson: \$\{plainMath\(l\.title\)\} — \$\{masteryPhrase\(stage\)\}\$\{\s*sectionNameOf\(model, l\.slug\)/);
  assert.match(canvas, /aria-label=\{`\$\{plainMath\(o\.label\)\} — \$\{masteryPhrase\(stage\)\}\$\{\s*sectionNameOf\(model, o\.lessonSlug\)/);
  // and the hover text
  assert.match(canvas, /sectionNameOf\(model, slug\)/);
  assert.match(canvas, /sectionNameOf\(model, o\.lessonSlug\)/);
});

test("Principle XII: the section code adds no literal colour, stroke width, radius or shadow to the canvas or the model", () => {
  for (const f of ["../components/spine/SkillMap.tsx", "./skill-map.ts", "./skill-map-labels.ts"]) {
    const src = readFileSync(here(f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b/, `${f}: a literal colour`);
    assert.doesNotMatch(src, /\b(?:rgb|rgba|hsl|hsla)\(/, `${f}: a literal colour function`);
    assert.doesNotMatch(src, /strokeWidth=["'{]?\d/, `${f}: a literal stroke width`);
    assert.doesNotMatch(src, /strokeWidth:\s*["']?\d/, `${f}: a literal stroke width`);
    assert.doesNotMatch(src, /borderRadius:\s*["']?\d/, `${f}: a literal radius`);
    assert.doesNotMatch(src, /boxShadow:\s*["']\d/, `${f}: a literal shadow`);
  }
});

test("the section code adds no sort to the model, so the map keeps the catalogue's order (FR-3215)", () => {
  assert.doesNotMatch(readFileSync(here("./skill-map.ts"), "utf8"), /\.sort\(/);
});

/* ------------------------------------------------------------------ */
/* 3. National is unchanged                                            */
/* ------------------------------------------------------------------ */

/** The Prep-3 maths map exactly as `skill-map-main.golden.json`'s projection builds it. */
function nationalInputs(withCourse: boolean): MapObjectiveInput[] {
  const g = loadMathsGraph();
  const scores: Record<string, [number, number]> = {
    "lo:u1-1-1": [0.3, 0.98],
    "lo:u1-1-2": [0, 0.92],
    "lo:u1-1-3": [0, 0.6],
    "lo:u1-1-4": [0, 0],
  };
  return g.los.map((l) => ({
    id: l.id,
    label: l.label,
    moduleId: l.moduleId,
    moduleLabel: l.moduleId ? (g.moduleLabel.get(l.moduleId) ?? null) : null,
    ...(withCourse ? { courseId: PREP3_MATH_EN } : {}),
    syllabusRef: null,
    baseline: scores[l.id]?.[0] ?? 0,
    current: scores[l.id]?.[1] ?? 0,
  }));
}

function projection(m: ReturnType<typeof buildSkillMap>) {
  const sels: Selection[] = [
    null,
    { kind: "chapter", id: "module:u1" },
    { kind: "lesson", slug: "u1-1" },
    { kind: "lesson", slug: "u3-2" },
    { kind: "objective", id: "lo:u1-1-2" },
  ];
  const out = {
    chapters: m.chapters,
    lessons: [...m.lessonBySlug.values()],
    objectives: [...m.objectiveById.values()],
    links: m.links,
    bounds: m.bounds,
    fit: fitView(m, 1000, 700),
    views: sels.map((s) => viewFor(m, s, 1000, 700)),
    labels: sels.flatMap((s) => ([0, 1, 2] as const).map((lv) => ({ sel: s, lv, picks: labelCandidates(m, s, lv) }))),
    focus: sels.map((s) => {
      const f = focusOf(m, s);
      return f && { own: [...f.own], linked: [...f.linked], lessons: [...f.lessons], chapters: [...f.chapters] };
    }),
    linkStyles: sels.map((s) => m.links.map((l) => linkStyle(l, focusOf(m, s)))),
  };
  return JSON.parse(JSON.stringify(out)) as unknown;
}

const MAIN = JSON.parse(readFileSync(here("./skill-map-main.golden.json"), "utf8")) as unknown;
const g = loadMathsGraph();
const NATIONAL_TITLES = { "u1-1": "Cartesian product" };

test("National proof: with no section groups the map is main's v0.11.0 map — chapters, lessons, objectives, links, views, label rules", () => {
  const m = buildSkillMap(nationalInputs(true), g.edges, NATIONAL_TITLES);
  assert.deepEqual(projection(m), MAIN);
});

test("National proof: …whether the section argument is omitted, empty, or names sections none of whose objectives is on the map", () => {
  const elsewhere = G10_INDEX.splitGroups.length > 0 ? GROUPS : [];
  assert.ok(elsewhere.length > 0, "the stand-in is a real Grade 10 section");
  for (const groups of [undefined, [], elsewhere] as const) {
    const m = buildSkillMap(nationalInputs(true), g.edges, NATIONAL_TITLES, groups);
    assert.deepEqual(projection(m), MAIN, JSON.stringify(groups?.map((x) => x.key) ?? groups));
    assert.deepEqual(m.sections, []);
    assert.equal(m.sectionById.size, 0);
    assert.equal(m.sectionOfLesson.size, 0);
  }
});

test("National proof: no lesson or objective of a National map names a section, and no label of one is a section's", () => {
  const m = buildSkillMap(nationalInputs(true), g.edges, NATIONAL_TITLES, GROUPS);
  for (const slug of m.lessonBySlug.keys()) assert.equal(sectionNameOf(m, slug), null, slug);
  for (const sel of [null, { kind: "chapter", id: "module:u1" }, { kind: "lesson", slug: "u1-1" }] as Selection[])
    for (const level of [0, 1, 2] as const)
      assert.ok(labelCandidates(m, sel, level).every((p) => p.kind !== "section"));
});

test("National proof: the map's data names every lesson as it always did — the registry's table itself, not a copy", () => {
  // `spineDataOn` hands the model `lessonNamesOnMap(rows, LESSON_TITLES)`: with the loader's one-section rows for
  // every National lesson (T404) it is the very object it was given.
  const registry = { "u1-1": "Cartesian product" };
  const nationalRows = ["u1-1", "u2-1", "geo1-1"].map((slug) =>
    provenanceFromRow({
      course_id: PREP3_MATH_EN,
      lesson_slug: slug,
      title: `Lesson ${slug}`,
      sections: [slug.replace(/^[a-z]+/, "")],
      section_titles: [`Lesson ${slug}`],
      part_n: null,
      part_of: null,
      chapter_intro: false,
      group_key: slug.replace(/^[a-z]+/, ""),
    })
  );
  assert.equal(lessonNamesOnMap(nationalRows, registry), registry);
  assert.equal(lessonNamesOnMap([], registry), registry);
  assert.deepEqual(sectionGroupsOf(buildSectionIndex(nationalRows), []), []);
});

test("a Grade 10 map and a National map built from the same module are told apart by the course, not by luck", () => {
  // A chapter's term is its COURSE's own rule (`termOfModule(id, course)`): Prep-3 maths has two terms, the
  // Grade 10 book none — so its chapters sit in one row sequence, not a Term 2 row.
  assert.ok(M.chapters.every((c) => c.term === 1));
  const maths = buildSkillMap(nationalInputs(true), g.edges, NATIONAL_TITLES);
  assert.equal(maths.chapters.filter((c) => c.term === 2).length, 5);
});
