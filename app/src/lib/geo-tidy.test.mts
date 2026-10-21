/**
 * A DRAWN ANGLE MARK TOUCHES BOTH ITS LINES (`lib/geo-tidy.ts`). Run over
 * every figure the drawing step wrote for lesson pp3u10-3, where three slips
 * left marks floating: a quadrilateral's corners out of order (figure 16), a
 * diagonals' crossing point written off the crossing (figures 18, 19), and
 * directions read a few degrees off by eye (figure 5).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { angleSpan, armsAt, tidyGeoElements, type GeoEl } from "./geo-tidy.ts";

const LESSON = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../services/extraction/teaching/prep3-parallel/visuals/pp3u10-3.json", import.meta.url)),
    "utf8"
  )
) as { visuals: { figure: string; spec: { elements?: GeoEl[] } }[] };

const wrap = (d: number) => ((d % 360) + 540) % 360 - 180;

test("every angle mark in lesson pp3u10-3 ends on a drawn line at both ends", () => {
  let marks = 0;
  for (const v of LESSON.visuals) {
    const els = tidyGeoElements(v.spec.elements ?? []);
    for (const e of els) {
      if (e.type !== "angle") continue;
      marks++;
      const arms = armsAt(els, e.at as [number, number]);
      const [a0, a1] = angleSpan(els, e);
      for (const end of [a0, a1]) {
        const off = Math.min(...arms.map((r) => Math.abs(wrap(r - end))));
        assert.ok(off < 0.5, `${v.figure}: the ${String(e.label ?? "mark")} at ${JSON.stringify(e.at)} ends ${off.toFixed(1)}° off a line`);
      }
      assert.ok(a1 - a0 > 0 && a1 - a0 < 180, `${v.figure}: the mark is the angle under 180°`);
    }
  }
  assert.ok(marks >= 20, `checked ${marks} marks`);
});

test("a crossed quadrilateral is drawn round, not as a bow-tie", () => {
  // figure 16's corners as written: A, B, C, D — but C and D are both at the top
  const els: GeoEl[] = [{ type: "polygon", points: [[3.83, -3], [-3.83, -3], [3.2, 3.6], [-3.83, 2.9]] }];
  const [poly] = tidyGeoElements(els);
  assert.deepEqual(
    (poly.points as number[][]).map(([x, y]) => `${x},${y}`).sort(),
    ["-3.83,-3", "-3.83,2.9", "3.2,3.6", "3.83,-3"],
    "the same corners"
  );
  // round its centre: the two top corners are neighbours, as are the two bottom ones
  const ys = (poly.points as number[][]).map((p) => p[1] > 0);
  assert.equal(ys.filter((t, i) => t !== ys[(i + 1) % ys.length]).length, 2);
});

test("a point written just off where two lines cross goes onto the crossing, with its angle mark", () => {
  const els: GeoEl[] = [
    { type: "segment", from: [0, 0], to: [4, 4] },
    { type: "segment", from: [0, 4], to: [4, 0] },
    { type: "point", x: 2.15, y: 1.9, label: "E" },
    { type: "angle", at: [2.15, 1.9], fromDeg: 40, toDeg: 140, label: "90°" },
  ];
  const out = tidyGeoElements(els);
  assert.deepEqual([out[2].x, out[2].y], [2, 2]);
  assert.deepEqual(out[3].at, [2, 2]);
});

test("a point that ends a line, or is far from any crossing, never moves", () => {
  const els: GeoEl[] = [
    { type: "segment", from: [0, 0], to: [4, 4] },
    { type: "segment", from: [0, 4], to: [4, 0] },
    { type: "segment", from: [2.1, 2.1], to: [2.1, 5] },
    { type: "point", x: 2.1, y: 2.1, label: "F" },
    { type: "point", x: 3, y: 1.2, label: "G" },
  ];
  const out = tidyGeoElements(els);
  assert.deepEqual([out[3].x, out[3].y], [2.1, 2.1]);
  assert.deepEqual([out[4].x, out[4].y], [3, 1.2]);
});
