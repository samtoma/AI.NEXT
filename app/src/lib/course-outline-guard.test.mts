/**
 * "VISIBLE" IS NOT "TEACHABLE" — the server refuses a lesson the book's
 * outline lists but whose content is not prepared (migration 037; feature
 * 003; constitution II, grounded teaching always).
 *
 * A Grade 10 student now sees all 65 lessons of her book; 60 have nothing
 * loaded to teach from — no objectives, no canonical solutions, no questions.
 * The picker does not link them, but a slug can be typed. Before 037 such a
 * slug was "unknown" and `resolveLessonLos` fell back to the default lesson
 * (`u1-1`): refused for her by the course gate, but TAUGHT, under the
 * unprepared lesson's name, to anyone who may see Prep-3 maths (a tester with
 * both books) — or to the studentless capture path, which has no gate.
 *
 * This drives the REAL functions over a fake PoolClient that answers like
 * Postgres and THROWS on any read it was not expecting:
 *
 *   · `getLessonData` → null, with no read of questions, mastery or figures
 *     and no read of the default lesson — for a student and with none;
 *   · `lessonCourseId` → null (the probing snapshot gets no course);
 *   · `buildLessonContext` → null: no prompt is ever built, so no model call;
 *   · `isUnpreparedLesson` (the ask route's early door) → true only for it;
 *   · a slug no outline lists still falls back exactly as before, and a
 *     database without 037 behaves exactly as before;
 *   · and, in the source, `/api/ask` refuses before it opens a session or
 *     spawns the model, `/api/understanding` refuses before it opens one, and
 *     `/api/attempts` cannot reach an unprepared lesson at all (a question
 *     needs an objective, and an objective-less lesson has none).
 *
 * @covers constitution II
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";

import { pool } from "./db.ts";
import {
  DEFAULT_LESSON_SLUG,
  buildLessonContext,
  getLessonData,
  isUnpreparedLesson,
  lessonCourseId,
} from "./lesson.ts";

(pool as unknown as { connect: () => Promise<never> }).connect = async () => {
  throw new Error("course-outline-guard.test: no database in a unit test");
};
(pool as unknown as { query: (t: string) => Promise<unknown> }).query = async (text: string) => {
  throw new Error(`course-outline-guard.test: unexpected pool query: ${text.slice(0, 120)}`);
};

const G10 = "course:us-g10-math-en";
const MATH = "course:prep3-math-en";
const UNPREPARED = "g10m1s3-1"; // 1.2–1.3 Rational and irrational numbers — listed, not loaded
const PREPARED = "g10m8s1-1"; // 8.1 — loaded

type Row = Record<string, unknown>;
const lo = (id: string, order: number, courseId: string): Row => ({
  id,
  label: id,
  description: null,
  syllabus_ref: null,
  source_page: 1,
  order_in_parent: order,
  module_id: `module:${courseId}`,
  module_label: "Module",
  module_order: 1,
  course_id: courseId,
});

/** Chapter 8 loaded; the default National lesson loaded; Chapter 1 only in the outline. */
const LO_ROWS: Row[] = [
  lo("lo:g10m8s1-1-1", 1, G10),
  lo("lo:g10m8s1-1-2", 2, G10),
  lo("lo:u1-1-1", 1, MATH),
];
const OUTLINE_SLUGS = ["g10m1s3-1", "g10m1s4-1", "g10m8s1-1"]; // the outline lists prepared ones too

function fakeClient(log: string[], opts: { outline?: boolean } = {}): PoolClient {
  const outline = opts.outline ?? true;
  const query = async (text: string, values?: unknown[]) => {
    const sql = text.replace(/\s+/g, " ").trim();
    log.push(sql);
    const prefix = String(values?.[0] ?? "").replace(/%$/, "");
    if (sql.includes("FROM graph_nodes lo")) {
      let rows = LO_ROWS.filter((r) => String(r.id).startsWith(prefix));
      if (/LIMIT 1\b/.test(sql)) rows = rows.slice(0, 1);
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("SELECT 1 FROM graph_nodes WHERE kind = 'learning_objective' AND id LIKE $1")) {
      const rows = LO_ROWS.filter((r) => String(r.id).startsWith(prefix)).slice(0, 1).map(() => ({ "?column?": 1 }));
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("to_regclass('public.course_outline')")) return { rows: [{ present: outline }], rowCount: 1 };
    if (sql.includes("FROM course_outline WHERE lesson_slug = $1")) {
      if (!outline) throw new Error("read course_outline on a database without it");
      const rows = OUTLINE_SLUGS.includes(String(values?.[0])) ? [{ course_id: G10 }] : [];
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("FROM students WHERE id = $1")) {
      return {
        rows: [{ id: 7, display_name: "Test Student", grade: "10", interests: null, interest_detail: null, gender: null }],
        rowCount: 1,
      };
    }
    throw new Error(`course-outline-guard.test: unexpected query: ${sql.slice(0, 160)}`);
  };
  return { query, release() {} } as unknown as PoolClient;
}

const reads = (log: string[], what: RegExp) => log.filter((q) => what.test(q));

test("an unprepared lesson is refused: no lesson data, nothing read past the lesson, never the default lesson", async () => {
  for (const studentId of [null, 7]) {
    const log: string[] = [];
    const data = await getLessonData(UNPREPARED, studentId, fakeClient(log));
    assert.equal(data, null, `student ${studentId}: refused`);
    assert.deepEqual(reads(log, /FROM questions|FROM mastery|FROM visuals|FROM course_lessons/), [], "nothing past the lesson");
    assert.ok(
      log.some((q) => q.includes("FROM graph_nodes lo")),
      "it looked the lesson up"
    );
    assert.deepEqual(
      log.filter((q) => q.includes("FROM graph_nodes lo")).length,
      1,
      `student ${studentId}: ONE objective read — the default lesson ${DEFAULT_LESSON_SLUG} is never substituted`
    );
  }
});

test("its course is unknown to the probing snapshot, and no lesson prompt is ever built — so no model call", async () => {
  assert.equal(await lessonCourseId(UNPREPARED, fakeClient([])), null);
  for (const mode of ["learn", "review"] as const) {
    const log: string[] = [];
    const ctx = await buildLessonContext(mode, "chat-1", UNPREPARED, null, undefined, fakeClient(log));
    assert.equal(ctx, null, `${mode}: no context`);
    assert.deepEqual(reads(log, /FROM questions|FROM explanation_library|FROM misconceptions/), []);
  }
});

test("the ask route's early door: true for the unprepared lesson only", async () => {
  assert.equal(await isUnpreparedLesson(UNPREPARED, fakeClient([])), true);
  assert.equal(await isUnpreparedLesson("g10m1s4-1", fakeClient([])), true);
  assert.equal(await isUnpreparedLesson(PREPARED, fakeClient([])), false, "listed AND loaded: prepared");
  assert.equal(await isUnpreparedLesson("zz9-9", fakeClient([])), false, "listed nowhere: not this guard's");
  assert.equal(await isUnpreparedLesson("../../etc", fakeClient([])), false, "malformed: not a slug at all");
  assert.equal(await isUnpreparedLesson(undefined, fakeClient([])), false);
  // a prepared lesson costs ONE read: the outline is never consulted for it
  const log: string[] = [];
  await isUnpreparedLesson(PREPARED, fakeClient(log));
  assert.equal(log.length, 1);
});

test("a slug no outline lists, and a database without 037, behave exactly as before", async () => {
  // unknown slug → the default lesson's course, as `lesson-course.test.mts` has always asserted
  assert.equal(await lessonCourseId("zz9-9", fakeClient([])), MATH);
  // no table: the unprepared slug is just unknown again (the old fall-back), and nothing reads the table
  const log: string[] = [];
  assert.equal(await lessonCourseId(UNPREPARED, fakeClient(log, { outline: false })), MATH);
  assert.equal(await isUnpreparedLesson(UNPREPARED, fakeClient([], { outline: false })), false);
  // a prepared lesson never asks the outline anything
  const p: string[] = [];
  assert.equal(await lessonCourseId(PREPARED, fakeClient(p)), G10);
  assert.deepEqual(reads(p, /course_outline/), []);
});

/* ------------------------------------------------------------------ */
/* The routes, in their source                                         */
/* ------------------------------------------------------------------ */

const APP = fileURLToPath(new URL("../..", import.meta.url));
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const route = (p: string) => strip(readFileSync(`${APP}/src/app/api/${p}/route.ts`, "utf8"));

test("/api/ask refuses an unprepared lesson before it opens a session, builds a context or spawns the model", () => {
  const src = route("ask");
  const at = (needle: string) => {
    const i = src.indexOf(needle);
    assert.ok(i >= 0, `/api/ask no longer contains ${needle}`);
    return i;
  };
  const guard = at("await isUnpreparedLesson(body.lesson, client)");
  assert.ok(guard < at("currentSessionSnapshot("), "before the session is opened");
  assert.ok(guard < at("buildLessonContext("), "before a lesson context is built");
  assert.ok(guard < at("spawn("), "before the model is spawned");
  // the refusal is the gate's own 404, so "unprepared" and "hidden" stay one answer
  assert.match(src, /if \(pre === null \|\| !pre\.ctx\) \{[\s\S]{0,1200}?status: 404/);
  // and the guard is on the lesson surfaces only
  assert.match(src, /\(surface === "lesson_learn" \|\| surface === "lesson_review"\) &&\s*\(await isUnpreparedLesson/);
});

test("/api/understanding resolves the lesson through getLessonData before it opens a session", () => {
  const src = route("understanding");
  const data = src.indexOf("await getLessonData(");
  const session = src.indexOf("currentSessionOrNull(");
  assert.ok(data >= 0 && session > data, "getLessonData first");
  assert.match(src.slice(data, session), /if \(!d\) return null;/);
});

test("/api/attempts cannot reach an unprepared lesson: a question needs an objective, and a course-less one is 404", () => {
  const src = route("attempts");
  assert.match(src, /JOIN graph_nodes n ON n\.id = q\.lo_id/, "a question is read through its objective");
  assert.match(src, /if \(!q\.course_id \|\| !visible\.has\(q\.course_id\)\) \{\s*throw new HttpError\(404/);
});
