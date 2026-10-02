/**
 * The Your Progress Map's model, layout and navigation rules.
 *
 * @covers FR-3224
 *
 * Built from the REAL maths seeds (`spine-maths-fixture.mts`): ten chapters,
 * 35 lessons, 90 objectives, 112 prerequisite links — not a toy graph.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadMathsGraph } from "./spine-maths-fixture.mts";
import { PREP3_MATH_EN } from "./courses.ts";
import {
  buildSkillMap,
  chapterTitleParts,
  chapterView,
  fitView,
  focusOf,
  lessonStage,
  lessonView,
  lessonsStarted,
  linkDestinationLabel,
  linkStyle,
  objectivesStarted,
  parentSelection,
  selectionPath,
  viewFor,
  zoomLevel,
  DISC_PAD,
  LESSON_RING,
  OBJECTIVE_LEVEL_SCALE,
  TOP_RESERVE,
  type MapObjectiveInput,
} from "./skill-map.ts";

const g = loadMathsGraph();
const scores: Record<string, [number, number]> = {
  // [baseline, current]
  "lo:u1-1-1": [0.3, 0.98],
  "lo:u1-1-2": [0, 0.92],
  "lo:u1-1-3": [0, 0.6],
  "lo:u1-1-4": [0, 0],
};
const input: MapObjectiveInput[] = g.los.map((l) => ({
  id: l.id,
  label: l.label,
  moduleId: l.moduleId,
  moduleLabel: l.moduleId ? (g.moduleLabel.get(l.moduleId) ?? null) : null,
  // the chapter's term comes from its COURSE's rules (feature 003: a course
  // with no terms has none) — these are Prep-3 maths objectives
  courseId: PREP3_MATH_EN,
  syllabusRef: null,
  baseline: scores[l.id]?.[0] ?? 0,
  current: scores[l.id]?.[1] ?? 0,
}));
const titles = { "u1-1": "Cartesian product" };
const m = buildSkillMap(input, g.edges, titles);

test("the real maths curriculum: 10 chapters, 35 lessons, 90 objectives, every link kept", () => {
  assert.equal(m.chapters.length, 10);
  assert.equal(m.lessonBySlug.size, 35);
  assert.equal(m.objectiveById.size, 90);
  assert.equal(m.links.length, g.edges.length);
  assert.equal(m.links.filter((l) => l.across).length, 16);
});

test("two rows: Term 1 above Term 2, each in book order", () => {
  const t1 = m.chapters.filter((c) => c.term === 1);
  const t2 = m.chapters.filter((c) => c.term === 2);
  assert.equal(t1.length, 5);
  assert.equal(t2.length, 5);
  const y1 = new Set(t1.map((c) => c.cy));
  const y2 = new Set(t2.map((c) => c.cy));
  assert.equal(y1.size, 1, "Term 1 shares one row");
  assert.equal(y2.size, 1, "Term 2 shares one row");
  assert.ok([...y1][0]! < [...y2][0]!, "Term 1 is above");
  for (const row of [t1, t2])
    for (let i = 1; i < row.length; i++) assert.ok(row[i]!.cx > row[i - 1]!.cx, "book order left to right");
});

test("no two discs overlap", () => {
  const cs = m.chapters;
  for (let i = 0; i < cs.length; i++)
    for (let j = i + 1; j < cs.length; j++) {
      const d = Math.hypot(cs[i]!.cx - cs[j]!.cx, cs[i]!.cy - cs[j]!.cy);
      assert.ok(d >= cs[i]!.discR + cs[j]!.discR, `${cs[i]!.id} / ${cs[j]!.id}`);
    }
});

test("objectives sit on the outer ring, lessons on the inner one, lesson objectives contiguous", () => {
  for (const c of m.chapters) {
    assert.equal(c.discR, c.ro + DISC_PAD);
    for (const id of c.objectives) {
      const o = m.objectiveById.get(id)!;
      assert.ok(Math.abs(Math.hypot(o.x - c.cx, o.y - c.cy) - c.ro) < 1e-6);
    }
    const order = c.lessons.flatMap((s) => m.lessonBySlug.get(s)!.objectives);
    assert.deepEqual(order, c.objectives, "objectives go round in lesson order");
    if (c.lessons.length > 1)
      for (const s of c.lessons) {
        const l = m.lessonBySlug.get(s)!;
        assert.ok(Math.abs(Math.hypot(l.x - c.cx, l.y - c.cy) - LESSON_RING * c.ro) < 1e-6);
      }
  }
  // the first objective of every chapter is at the top
  for (const c of m.chapters) {
    const first = m.objectiveById.get(c.objectives[0]!)!;
    assert.ok(Math.abs(first.x - c.cx) < 1e-6 && first.y < c.cy);
  }
});

test("chapter titles drop the term and split the unit reference off", () => {
  assert.deepEqual(chapterTitleParts("Term 2 · Unit 4 — The Circle"), { unitRef: "Unit 4", title: "The Circle" });
  assert.deepEqual(chapterTitleParts("Unit 1 — Relations and Functions"), { unitRef: "Unit 1", title: "Relations and Functions" });
  assert.deepEqual(chapterTitleParts("Probability"), { unitRef: null, title: "Probability" });
  assert.equal(m.chapterById.get("module:u1")!.title, "Relations and Functions");
});

test("lesson names: the short title where one exists, else the first objective's label", () => {
  assert.equal(m.lessonBySlug.get("u1-1")!.title, "Cartesian product");
  assert.equal(m.lessonBySlug.get("u1-2")!.title, m.objectiveById.get(m.lessonBySlug.get("u1-2")!.objectives[0]!)!.label);
});

test("stages: a lesson is the rounded mean of its objectives; the toggle switches snapshot", () => {
  // u1-1 today: 4, 4, 3, 0 → 2.75 → 3; at baseline: 1, 0, 0, 0 → 0.25 → 0
  assert.equal(lessonStage(m, "u1-1", "today"), 3);
  assert.equal(lessonStage(m, "u1-1", "baseline"), 0);
  assert.deepEqual(lessonsStarted(m, "module:u1", "today"), { started: 1, total: 4 });
  assert.deepEqual(objectivesStarted(m, "today"), { started: 3, total: 90 });
  assert.deepEqual(objectivesStarted(m, "baseline"), { started: 1, total: 90 });
});

test("fit keeps the top reserve free and the whole map inside the viewport", () => {
  const v = fitView(m, 1000, 600);
  const { minX, minY, maxX, maxY } = m.bounds;
  assert.ok(minY * v.scale + v.ty >= TOP_RESERVE - 1e-6);
  assert.ok(maxY * v.scale + v.ty <= 600);
  assert.ok(minX * v.scale + v.tx >= 0 && maxX * v.scale + v.tx <= 1000);
});

test("zoom levels: chapters, then lessons, then objectives", () => {
  const fit = 0.1;
  assert.equal(zoomLevel(0.12, fit), 0);
  assert.equal(zoomLevel(0.2, fit), 1);
  assert.equal(zoomLevel(OBJECTIVE_LEVEL_SCALE, fit), 2);
});

test("tapping a chapter spaces its nearest lessons at least 150 screen px apart", () => {
  const fit = fitView(m, 1000, 600).scale;
  const v = chapterView(m, "module:geo-u2", 1000, 600, fit)!;
  const ls = m.chapterById.get("module:geo-u2")!.lessons.map((s) => m.lessonBySlug.get(s)!);
  let nearest = Infinity;
  for (let i = 0; i < ls.length; i++)
    for (let j = i + 1; j < ls.length; j++) nearest = Math.min(nearest, Math.hypot(ls[i]!.x - ls[j]!.x, ls[i]!.y - ls[j]!.y));
  assert.ok(nearest * v.scale >= 150 - 1e-6);
  assert.ok(v.scale >= fit * 1.6);
});

test("tapping a lesson zooms to at least 0.7; an objective zooms to its lesson", () => {
  assert.ok(lessonView(m, "u3-1", 1000, 600)!.scale >= 0.7);
  assert.deepEqual(viewFor(m, { kind: "objective", id: "lo:u1-1-2" }, 1000, 600), lessonView(m, "u1-1", 1000, 600));
  assert.deepEqual(viewFor(m, null, 1000, 600), fitView(m, 1000, 600));
});

test("Esc / empty space steps up one level at a time, then clears", () => {
  let s = parentSelection(m, { kind: "objective", id: "lo:u1-1-2" });
  assert.deepEqual(s, { kind: "lesson", slug: "u1-1" });
  s = parentSelection(m, s);
  assert.deepEqual(s, { kind: "chapter", id: "module:u1" });
  assert.equal(parentSelection(m, s), null);
  assert.equal(parentSelection(m, null), null);
});

test("the breadcrumb path of an objective is its chapter and lesson", () => {
  const p = selectionPath(m, { kind: "objective", id: "lo:u1-1-2" });
  assert.equal(p.chapter?.id, "module:u1");
  assert.equal(p.lesson?.slug, "u1-1");
});

test("selection lights its objectives and everything linked to them", () => {
  const across = m.links.find((l) => l.across)!;
  const f = focusOf(m, { kind: "objective", id: across.a })!;
  assert.ok(f.own.has(across.a));
  assert.ok(f.linked.has(across.b));
  assert.ok(f.chapters.has(m.objectiveById.get(across.b)!.chapterId));
  assert.equal(focusOf(m, null), null);
});

test("link visibility: across always (faint when unrelated), within only on selection", () => {
  const across = m.links.find((l) => l.across)!;
  const within = m.links.find((l) => !l.across)!;
  assert.equal(linkStyle(across, null), "normal");
  assert.equal(linkStyle(within, null), "hidden");
  const onAcross = focusOf(m, { kind: "objective", id: across.a });
  assert.equal(linkStyle(across, onAcross), "strong");
  assert.equal(linkStyle(within, onAcross), within.a === across.a || within.b === across.a ? "strong" : "hidden");
  const unrelated = m.links.find((l) => l.across && l.a !== across.a && l.b !== across.a && l.a !== across.b && l.b !== across.b)!;
  assert.equal(linkStyle(unrelated, onAcross), "faint");
  const onWithin = focusOf(m, { kind: "objective", id: within.a });
  assert.equal(linkStyle(within, onWithin), "strong");
});

test("the only lines are objective links — no lesson-to-lesson arrows at any level", () => {
  assert.ok(!("lessonLinks" in m), "the model carries no lesson arrows");
  for (const l of m.links) {
    assert.ok(m.objectiveById.has(l.a) && m.objectiveById.has(l.b));
  }
});

test("a link inside the same lesson names nothing", () => {
  const inside = m.links.find(
    (l) =>
      m.objectiveById.get(l.a)!.lessonSlug === m.objectiveById.get(l.b)!.lessonSlug &&
      !m.links.some((x) => x.a === l.a && m.objectiveById.get(x.b)!.lessonSlug !== m.objectiveById.get(l.a)!.lessonSlug)
  )!;
  assert.equal(linkDestinationLabel(m, inside.a), null);
});

test("a linked objective names its destination: lesson, or chapter › lesson across chapters", () => {
  const across = m.links.find((l) => l.across)!;
  const t = m.objectiveById.get(across.b)!;
  assert.equal(
    linkDestinationLabel(m, across.a),
    `${m.chapterById.get(t.chapterId)!.title} › ${m.lessonBySlug.get(t.lessonSlug)!.title}`
  );
});

// Principle XII (v0.11.0): the map draws no literal stroke width. Every line
// width is a Play stroke or a map stroke derived from one in globals.css.
test("the map's strokes come from tokens, never literals", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../components/spine/SkillMap.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /strokeWidth=\{?\s*[\d"']/);
  assert.doesNotMatch(src, /strokeWidth:\s*[1-9]/);
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  for (const t of ["spoke", "link", "objective", "selected"]) {
    assert.match(css, new RegExp(`--skillmap-stroke-${t}: calc\\(var\\(--play-stroke`));
  }
});
