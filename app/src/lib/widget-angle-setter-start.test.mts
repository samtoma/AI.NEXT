/**
 * `angle_setter` never OPENS on its answer (consistency review 2026-09-27;
 * q:geo2-2-2:w002, inscribed 35°, opened already solved). No stored question
 * or live data changes: the widget chooses where it starts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  angleReadings,
  angleSetterStart,
  startsOnAnAnswer,
} from "../components/student/widgets/angle-setter-start.ts";

const OLD = { A: 180, B: 250, C: 60 };

test("the old fixed opening was the answer to an inscribed-35° question — the defect", () => {
  assert.deepEqual(angleReadings(OLD), { facing: 70, inscribed: 35, cOnCcw: false });
  assert.equal(startsOnAnAnswer(OLD, "inscribed", 35), true);
  assert.equal(startsOnAnAnswer(OLD, "central", 70), true);
});

test("q:geo2-2-2:w002 (inscribed 35°) now opens unsolved, and on no named mistake", () => {
  const start = angleSetterStart("inscribed", 35);
  assert.notDeepEqual(start, OLD);
  assert.equal(startsOnAnAnswer(start, "inscribed", 35), false);
});

test("every target the widget accepts opens on neither the answer nor a diagnosable mistake", () => {
  for (const [ask, lo, hi] of [["inscribed", 5, 175], ["central", 10, 350]] as const) {
    for (let t = lo; t <= hi; t += 5) {
      assert.equal(startsOnAnAnswer(angleSetterStart(ask, t), ask, t), false, `${ask} ${t}`);
    }
  }
});

test("every other question opens exactly where it always did", () => {
  assert.deepEqual(angleSetterStart("inscribed", 40), OLD);
  assert.deepEqual(angleSetterStart("central", 100), OLD);
});

test("the widget starts from angleSetterStart and reads its geometry from the same module", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../components/student/widgets/AngleSetter.tsx", import.meta.url)),
    "utf8"
  );
  assert.match(src, /useState\(\(\) => angleSetterStart\(ask, target\)\)/);
  assert.match(src, /angleReadings\(deg\)/);
  assert.doesNotMatch(src, /useState\(\{ A: 180, B: 250, C: 60 \}\)/);
});
