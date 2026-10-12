/**
 * THE GRADE 10 COURSE NEVER PROBES — whatever the switch says (feature 003,
 * decision 7, FR-4212).
 *
 * Socratic probing (ADR-0021) may run only in a course whose registry entry
 * says `probing: true` (`lib/courses.ts`, read by `courseMayProbe` in
 * `lib/socratic-probing.ts`). The Grade 10 course says `false`. Proved three
 * ways:
 *
 *   1. the rules: every position of the switch, locked and unlocked, tester or
 *      not, on every surface, with a sitting stored ON — the resolver and the
 *      use-time narrowing both answer no for the Grade 10 course;
 *   2. the registry: exactly one course can probe, Prep-3 maths, and the
 *      console's list of courses probing reaches does not name Grade 10;
 *   3. the prompt: `buildLessonContext` for a Grade 10 lesson, handed a
 *      probing snapshot of TRUE, returns `probing: false` and a learn prompt
 *      with no probing block — while the same call for a Prep-3 lesson (the
 *      positive control) does probe, so this test would see the block if it
 *      reached Grade 10.
 *
 * @covers FR-4212
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { installFixturePool } from "./prompt-fixture-pool.mts";
import {
  G10_COURSE,
  G10_EDGES,
  G10_LESSONS,
  G10_NODES,
  G10_QUESTIONS,
  G10_SOURCE_DOCUMENT,
  G10_VISUALS,
} from "./g10-prompt-fixture.mts";
import { COURSE_IDS, COURSES, PREP3_MATH_EN } from "./courses.ts";
import {
  PROBING_COURSE_ID,
  PROBING_COURSE_IDS,
  PROBING_SETTINGS,
  PROBING_SURFACE,
  courseMayProbe,
  effectiveProbing,
  probingCouldApply,
  resolveProbing,
} from "./socratic-probing.ts";

const SURFACES = ["lesson_learn", "lesson_review", "practice", "student_chat", "spine_chat", null] as const;

// A Prep-3 lesson beside the Grade 10 fixture: the positive control.
const PREP3_SHA = "prep3-control";
installFixturePool({
  docs: [
    { ...G10_SOURCE_DOCUMENT, edition: G10_SOURCE_DOCUMENT.edition },
    { sha256: PREP3_SHA, title: "Prep-3 control", publisher: "MOE", edition: null, grade: "prep-3", subject: "mathematics" },
  ],
  nodes: [
    ...G10_NODES.map((n) => ({ ...n, source_sha256: n.kind === "program" ? null : G10_SOURCE_DOCUMENT.sha256 })),
    { id: PREP3_MATH_EN, kind: "course", label: "Prep-3 maths", source_sha256: PREP3_SHA },
    { id: "module:u1", kind: "module", label: "Unit 1 — Relations and Functions", order_in_parent: 1 },
    { id: "lo:u1-1-1", kind: "learning_objective", label: "Ordered pairs", syllabus_ref: "Lesson 1-1", order_in_parent: 1, source_page: 7 },
  ],
  edges: [
    ...G10_EDGES,
    { src: "module:u1", dst: PREP3_MATH_EN, type: "part_of" },
    { src: "module:u1", dst: "lo:u1-1-1", type: "teaches" },
  ],
  questions: G10_QUESTIONS,
  visuals: G10_VISUALS,
});

const { buildLessonContext } = await import("./lesson.ts");

test("the rules: no switch position, lock, tester mark or surface lets the Grade 10 course probe", () => {
  let cells = 0;
  for (const setting of PROBING_SETTINGS) {
    for (const unlocked of [false, true]) {
      for (const isTester of [false, true]) {
        for (const surface of SURFACES) {
          assert.equal(
            resolveProbing({ setting, isTester, courseId: G10_COURSE, surface }, unlocked),
            false,
            `${setting}/${unlocked ? "unlocked" : "locked"}/${isTester ? "tester" : "student"}/${surface}`
          );
          cells++;
        }
      }
    }
  }
  assert.equal(cells, 3 * 2 * 2 * SURFACES.length);
  // a sitting that opened ON (snapshot true) is narrowed off on every surface
  for (const surface of SURFACES) assert.equal(effectiveProbing(true, surface, G10_COURSE), false, String(surface));
  // the positive control: the same stored ON sitting does probe Prep-3 maths
  assert.equal(effectiveProbing(true, PROBING_SURFACE, PREP3_MATH_EN), true);
  assert.equal(resolveProbing({ setting: "testers", isTester: true, courseId: PREP3_MATH_EN, surface: PROBING_SURFACE }), true);
  // …and "could it apply at all" is still answered for the course that can
  assert.equal(probingCouldApply({ setting: "testers", isTester: true, surface: PROBING_SURFACE }), true);
});

test("the registry: exactly one course can probe — Prep-3 maths — and the Grade 10 course is not it", () => {
  assert.equal(courseMayProbe(G10_COURSE), false);
  assert.equal(COURSES[G10_COURSE].probing, false);
  assert.deepEqual([...PROBING_COURSE_IDS], [PREP3_MATH_EN]);
  assert.equal(PROBING_COURSE_ID, PREP3_MATH_EN, "the value the console prints is unchanged");
  assert.deepEqual(
    COURSE_IDS.filter((id) => courseMayProbe(id)),
    [PREP3_MATH_EN]
  );
  // unknown and course-less never probe
  for (const id of ["course:unknown", "", null, undefined]) assert.equal(courseMayProbe(id), false, String(id));
});

test("the prompt: a Grade 10 learn session handed a probing snapshot of TRUE gets no probing block", async () => {
  for (const slug of G10_LESSONS) {
    const ctx = await buildLessonContext("learn", "probe-test", slug, null, undefined, undefined, true);
    assert.ok(ctx);
    assert.equal(ctx.probing, false, `${slug}: probing declared`);
    assert.doesNotMatch(ctx.systemPrompt, /SOCRATIC/, `${slug}: the probing block reached the prompt`);
    const off = await buildLessonContext("learn", "probe-test", slug, null, undefined, undefined, false);
    assert.equal(ctx.systemPrompt, off?.systemPrompt, `${slug}: snapshot true renders exactly the Off prompt`);
  }
  // positive control: the same call for a Prep-3 lesson DOES probe
  const control = await buildLessonContext("learn", "probe-test", "u1-1", null, undefined, undefined, true);
  assert.ok(control);
  assert.equal(control.probing, true);
  assert.match(control.systemPrompt, /SOCRATIC PROBING/);
});
