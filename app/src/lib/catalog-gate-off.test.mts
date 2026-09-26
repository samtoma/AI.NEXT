/**
 * The course gate with its kill switch OFF — the rules suspended, curriculum
 * scoping NOT (FR-4015; 003 decision A; amends FR-2709).
 *
 * Before 003, `AINEXT_COURSE_GATING=off` meant "every course there is" for
 * every student. It now means "every LOADED course of her own curriculum, plus
 * any exception": a loaded American book still reaches no National student
 * with the switch off. This file proves it through the same real functions
 * `catalog-gate.test.mts` drives with the switch on, over a fake client that
 * THROWS on a query it was not expecting — including the rules table, which
 * the suspended gate must not even read.
 *
 * A separate file because `lib/env.ts` resolves the switch once, at module
 * load: a test process proves one side of it.
 *
 * @covers FR-4015, FR-2709, FR-4006, FR-4009
 */

process.env.AINEXT_COURSE_GATING = "off";

import assert from "node:assert/strict";
import { test } from "node:test";
import type { PoolClient } from "pg";

const { getLessonCatalog, getLessonData } = await import("./lesson.ts");
const { getSubjectSummaries } = await import("./subject-queries.ts");
const { resolveStudentScope } = await import("./catalog-queries.ts");

const STUDENT = 42;
const MATH = "course:prep3-math-en";
const SOCIAL = "course:prep3-social-ar";
const ARABIC = "course:prep3-arabic-ar";
const G10 = "course:us-g10-math-en";

type Row = Record<string, unknown>;

const lo = (id: string, moduleId: string, courseId: string): Row => ({
  id,
  label: id,
  description: null,
  syllabus_ref: "1-1",
  source_page: 1,
  order_in_parent: 1,
  module_id: moduleId,
  module_label: moduleId,
  module_order: 1,
  course_id: courseId,
  course_label: courseId,
});

const LO_ROWS: Row[] = [
  lo("lo:u1-1-1", "module:u1", MATH),
  lo("lo:soc1-1-1", "module:soc1", SOCIAL),
  lo("lo:ara1-1-1", "module:ara1", ARABIC),
  lo("lo:g10m1s1-1-1", "module:g10m-c01", G10),
];

type Fixture = {
  grade: string | null;
  curriculum: string;
  /** the courses the spine holds */
  loaded: string[];
  overrides: { course_id: string; state: string }[];
};

function fakeClient(f: Fixture): PoolClient {
  const answer = (text: string): Row[] | null => {
    if (text.includes("FROM course_availability")) return null; // suspended: must not be read
    if (text.includes("FROM student_course_access")) return f.overrides;
    if (text.includes("SELECT grade, curriculum_system FROM students")) {
      return [{ grade: f.grade, curriculum_system: f.curriculum }];
    }
    if (text.includes("SELECT id FROM graph_nodes WHERE kind = 'course'")) {
      return f.loaded.map((id) => ({ id }));
    }
    if (text.includes("FROM students WHERE id")) {
      return [{ id: STUDENT, display_name: "Nour", grade: f.grade, interests: [], interest_detail: null,
        language_pref: "en", curriculum_system: f.curriculum, gender: null }];
    }
    if (text.includes("FROM graph_nodes lo")) {
      const like = text.includes("lo.id LIKE");
      return like ? null : LO_ROWS.filter((r) => f.loaded.includes(String(r.course_id)));
    }
    if (text.includes("FROM mastery") || text.includes("FROM understanding_checks")) return [];
    // the book-section store (migration 034): no split section here
    if (text.includes("FROM course_lessons")) return [];
    return null;
  };
  const query = async (text: string, values?: unknown[]) => {
    if (text.includes("lo.id LIKE")) {
      const prefix = String(values?.[0] ?? "").replace(/%$/, "");
      const rows = LO_ROWS.filter((r) => String(r.id).startsWith(prefix) && f.loaded.includes(String(r.course_id)));
      return { rows, rowCount: rows.length };
    }
    const rows = answer(text);
    if (rows === null) throw new Error(`should not have reached this query:\n${text.trim().slice(0, 200)}`);
    return { rows, rowCount: rows.length };
  };
  return { query, release() {} } as unknown as PoolClient;
}

const ALL = [MATH, SOCIAL, ARABIC, G10];
const NATIONAL_ONLY = [MATH, SOCIAL, ARABIC];

test("switched off: a National student sees every loaded National course — and not the loaded American book", async () => {
  const f: Fixture = { grade: "9", curriculum: "eg-national-en", loaded: ALL, overrides: [] };
  const out = await getLessonCatalog(STUDENT, fakeClient(f));
  assert.deepEqual(out.map((l) => l.slug).sort(), ["ara1-1", "soc1-1", "u1-1"]);
  const scope = await resolveStudentScope(STUDENT, fakeClient(f));
  assert.deepEqual([...(scope.courses ?? [])].sort(), [ARABIC, MATH, SOCIAL]);
});

test("switched off: an American student sees the loaded G10 book only — whatever her grade", async () => {
  for (const grade of ["10", "9", null]) {
    const f: Fixture = { grade, curriculum: "us-american-en", loaded: ALL, overrides: [] };
    const out = await getLessonCatalog(STUDENT, fakeClient(f));
    assert.deepEqual(out.map((l) => l.slug), ["g10m1s1-1"], `grade ${grade}`);
  }
  // not loaded: nothing, and the page shows the empty state
  const f: Fixture = { grade: "10", curriculum: "us-american-en", loaded: NATIONAL_ONLY, overrides: [] };
  assert.deepEqual(await getLessonCatalog(STUDENT, fakeClient(f)), []);
});

test("switched off: the other curriculum's lesson is refused by URL, before any content is read", async () => {
  const f: Fixture = { grade: "9", curriculum: "eg-national-en", loaded: ALL, overrides: [] };
  assert.equal(await getLessonData("g10m1s1-1", STUDENT, fakeClient(f)), null);
});

test("switched off: an exception still applies, both ways (\"plus any exception\")", async () => {
  const preview: Fixture = { grade: "9", curriculum: "eg-national-en", loaded: ALL, overrides: [{ course_id: G10, state: "live" }] };
  const out = await getLessonCatalog(STUDENT, fakeClient(preview));
  assert.deepEqual(out.map((l) => l.slug).sort(), ["ara1-1", "g10m1s1-1", "soc1-1", "u1-1"]);
  const cutOff: Fixture = { grade: "9", curriculum: "eg-national-en", loaded: ALL, overrides: [{ course_id: SOCIAL, state: "hidden" }] };
  const home = await getSubjectSummaries(STUDENT, fakeClient(cutOff));
  assert.deepEqual(home.map((s) => s.subject), ["math", "arabic"]);
});

test("switched off: an unknown curriculum still sees nothing", async () => {
  const f: Fixture = { grade: "9", curriculum: "x", loaded: ALL, overrides: [] };
  assert.deepEqual(await getLessonCatalog(STUDENT, fakeClient(f)), []);
});
