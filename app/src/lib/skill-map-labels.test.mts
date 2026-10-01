/**
 * Which names the map writes, and that they never overlap.
 *
 * @covers FR-3224
 *
 * The case this exists for (Tamer, 2026-10-01): select a lesson, then press −;
 * or press Fit, then +. The zoom level changes without the selection, and when
 * labels followed the level alone, every lesson name or every objective box
 * came on at once and piled up.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadMathsGraph } from "./spine-maths-fixture.mts";
import { buildSkillMap, type MapObjectiveInput } from "./skill-map.ts";
import { declutter, labelCandidates, type Rect } from "./skill-map-labels.ts";

const g = loadMathsGraph();
const m = buildSkillMap(
  g.los.map(
    (l): MapObjectiveInput => ({
      id: l.id,
      label: l.label,
      moduleId: l.moduleId,
      moduleLabel: l.moduleId ? (g.moduleLabel.get(l.moduleId) ?? null) : null,
      syllabusRef: null,
      baseline: 0,
      current: 0,
    })
  ),
  g.edges,
  {}
);
const kinds = (picks: ReturnType<typeof labelCandidates>, kind: string) =>
  picks.filter((p) => p.kind === kind).map((p) => p.id);

test("zoomed out with nothing selected: every chapter title, nothing else", () => {
  const p = labelCandidates(m, null, 0);
  assert.equal(kinds(p, "chapter").length, 10);
  assert.equal(kinds(p, "lesson").length, 0);
  assert.equal(kinds(p, "objective").length, 0);
});

test("lesson selected, then zoomed out with −: only that chapter's lesson names, not all 35", () => {
  const p = labelCandidates(m, { kind: "lesson", slug: "u1-1" }, 1);
  assert.deepEqual(kinds(p, "lesson"), m.chapterById.get("module:u1")!.lessons);
  assert.deepEqual(kinds(p, "chapter"), ["module:u1"]);
  assert.equal(p.find((x) => x.id === "u1-1")!.priority, 0, "the selected lesson is never dropped");
});

test("lesson selected, at the objectives level: its objectives and what they link to, nothing more", () => {
  const p = labelCandidates(m, { kind: "lesson", slug: "u3-2" }, 2);
  const objs = new Set(kinds(p, "objective"));
  for (const id of m.lessonBySlug.get("u3-2")!.objectives) assert.ok(objs.has(id));
  assert.ok(objs.size < 20, `${objs.size} boxes`);
  assert.equal(kinds(p, "chapter").length, 0, "chapter titles are off at the objectives level");
});

test("Fit, then +: with nothing selected every box qualifies, at the lowest priority, for declutter to thin", () => {
  const p = labelCandidates(m, null, 2);
  assert.equal(kinds(p, "objective").length, 90);
  assert.ok(p.filter((x) => x.kind === "objective").every((x) => x.priority === 5));
});

test("candidates come most important first", () => {
  const p = labelCandidates(m, { kind: "objective", id: "lo:u1-1-2" }, 2);
  for (let i = 1; i < p.length; i++) assert.ok(p[i - 1]!.priority <= p[i]!.priority);
  assert.equal(p[0]!.id, "lo:u1-1-2");
});

const box = (x: number, y: number, w = 100, h = 30): Rect => ({ x, y, w, h });

test("declutter keeps the important label and drops what would overlap it", () => {
  const kept = declutter(
    [
      { key: "low", priority: 4, rect: box(10, 10) },
      { key: "high", priority: 1, rect: box(40, 20) },
      { key: "apart", priority: 4, rect: box(300, 300) },
    ],
    { w: 800, h: 600 }
  );
  assert.deepEqual([...kept].sort(), ["apart", "high"]);
});

test("declutter: no two kept labels overlap, whatever the input", () => {
  const labels = Array.from({ length: 60 }, (_, i) => ({
    key: `k${i}`,
    priority: 1 + (i % 5),
    rect: box((i * 37) % 500, (i * 53) % 400, 90, 28),
  }));
  const kept = labels.filter((l) => declutter(labels, { w: 800, h: 600 }).has(l.key));
  for (let i = 0; i < kept.length; i++)
    for (let j = i + 1; j < kept.length; j++) {
      const a = kept[i]!.rect;
      const b = kept[j]!.rect;
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert.ok(!overlap, `${kept[i]!.key} / ${kept[j]!.key}`);
    }
});

test("declutter: the selected item (priority 0) is kept even off-screen or overlapping; others off-screen are dropped", () => {
  const kept = declutter(
    [
      { key: "sel", priority: 0, rect: box(-500, -500) },
      { key: "off", priority: 2, rect: box(2000, 10) },
      { key: "first", priority: 0, rect: box(10, 10) },
      { key: "second", priority: 0, rect: box(20, 15) },
    ],
    { w: 800, h: 600 }
  );
  assert.ok(kept.has("sel") && kept.has("first") && kept.has("second"));
  assert.ok(!kept.has("off"));
});
