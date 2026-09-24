/**
 * "Which course is this lesson?" has ONE answer (fix pass 2).
 *
 * Two places ask it, and they must agree or probing is stored for one course
 * and narrowed by another:
 *
 *   · `lessonCourseId` — when a learn-mode sitting OPENS, the resolver asks
 *     it for the lesson's course (probing is maths only) and stores the
 *     answer on the session row (ADR-0021);
 *   · `getLessonData(...).courseId` — the lesson the tutor then teaches, whose
 *     `courseId` `buildLessonContext` narrows the prompt's probing by
 *     (`effectiveProbing`).
 *
 * They were two copies of one rule. Both now go through `resolveLessonLos`,
 * and this file drives the REAL functions over a fake curriculum — every
 * lesson slug the catalogue lists, an unknown slug (→ the default lesson), a
 * malformed one, and a lesson whose objectives straddle two courses (the
 * first by `order_in_parent`, then id, must win in both) — and asserts the
 * two answers are the same course, every time.
 *
 * **The fake answers the objective reads the way Postgres would**: `LIKE`
 * prefix, `ORDER BY lo.order_in_parent, lo.id`, and `LIMIT 1` when the SQL
 * says so — so a divergence in order or limit between the two callers would
 * show here as two different courses. It THROWS on any read it was not
 * expecting. `pool` is replaced before anything runs: `getVisualsForLos`
 * reads on the bare pool, and a unit test must not reach a database.
 *
 * @covers FR-3104
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { PoolClient } from "pg";

import { pool } from "./db.ts";
import { DEFAULT_LESSON_SLUG, getLessonCatalog, getLessonData, lessonCourseId } from "./lesson.ts";
import { PROBING_COURSE_ID } from "./socratic-probing.ts";

(pool as unknown as { connect: () => Promise<never> }).connect = async () => {
  throw new Error("lesson-course.test: no database in a unit test");
};
(pool as unknown as { query: (t: string) => Promise<unknown> }).query = async (text: string) => {
  if (/FROM visuals/i.test(text)) return { rows: [], rowCount: 0 };
  throw new Error(`lesson-course.test: unexpected pool query: ${text.slice(0, 120)}`);
};

const MATH = "course:prep3-math-en";
const SOCIAL = "course:prep3-social-ar";
const ARABIC = "course:prep3-arabic-ar";

type Row = Record<string, unknown>;

function lo(id: string, order: number, courseId: string | null): Row {
  return {
    id,
    label: id,
    description: null,
    syllabus_ref: null,
    source_page: 1,
    order_in_parent: order,
    module_id: courseId ? `module:${courseId}` : null,
    module_label: "Module",
    module_order: 1,
    course_id: courseId,
  };
}

/**
 * A curriculum shaped like the real one — maths units and geometry, social
 * studies, Arabic — plus the awkward cases: ids whose lexical order is not
 * their teaching order, and one lesson whose objectives hang off two courses.
 */
const LO_ROWS: Row[] = [
  lo("lo:u1-1-1", 1, MATH),
  lo("lo:u1-1-2", 2, MATH),
  lo("lo:u1-2-10", 1, MATH), // lexically after -2, taught first
  lo("lo:u1-2-2", 2, MATH),
  lo("lo:u5-4-1", 1, MATH),
  lo("lo:geo1-2-1", 1, MATH),
  lo("lo:soc1-1-1", 1, SOCIAL),
  lo("lo:soc1-1-2", 2, SOCIAL),
  lo("lo:ara1-1-1", 1, ARABIC),
  // two courses in one lesson: the SOCIAL objective is taught first (order
  // 1), though the maths one sorts first by id — both callers must say social
  lo("lo:mix1-1-1", 2, MATH),
  lo("lo:mix1-1-2", 1, SOCIAL),
];

const byOrderThenId = (a: Row, b: Row) =>
  Number(a.order_in_parent) - Number(b.order_in_parent) ||
  String(a.id).localeCompare(String(b.id));

function fakeClient(log: string[] = []): PoolClient {
  const query = async (text: string, values?: unknown[]) => {
    const sql = text.replace(/\s+/g, " ").trim();
    log.push(sql);
    if (sql.includes("FROM graph_nodes lo")) {
      let rows = LO_ROWS;
      if (sql.includes("lo.id LIKE")) {
        const prefix = String(values?.[0] ?? "").replace(/%$/, "");
        rows = rows.filter((r) => String(r.id).startsWith(prefix));
      }
      if (/ORDER BY lo\.order_in_parent, lo\.id/.test(sql)) rows = [...rows].sort(byOrderThenId);
      if (/LIMIT 1\b/.test(sql)) rows = rows.slice(0, 1);
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("FROM questions")) return { rows: [], rowCount: 0 };
    if (sql.includes("JOIN source_documents")) return { rows: [], rowCount: 0 };
    throw new Error(`lesson-course.test: unexpected query: ${sql.slice(0, 160)}`);
  };
  return { query, release() {} } as unknown as PoolClient;
}

/** Both answers for one slug, through the shipped functions. */
async function bothAnswers(slug: string | undefined) {
  const client = fakeClient();
  const forSnapshot = await lessonCourseId(slug, client);
  // null student = no course gate (the capture-harness path): the question
  // here is which course, not whether this student may see it
  const data = await getLessonData(slug as string, null, client);
  return { forSnapshot, forPrompt: data?.courseId ?? null };
}

test("every catalogue lesson, an unknown slug and a malformed one: the snapshot and the prompt name the same course", async () => {
  const catalogue = await getLessonCatalog(null, fakeClient());
  const slugs = catalogue.map((l) => l.slug);
  assert.deepEqual(
    [...slugs].sort(),
    ["ara1-1", "geo1-2", "mix1-1", "soc1-1", "u1-1", "u1-2", "u5-4"],
    "the fixture catalogue changed — this test must still cover every lesson in it"
  );
  for (const slug of [...slugs, "zz9-9", "u9-99", "../../etc", "", undefined]) {
    const { forSnapshot, forPrompt } = await bothAnswers(slug);
    assert.equal(forSnapshot, forPrompt, `${JSON.stringify(slug)}: snapshot ${forSnapshot} vs prompt ${forPrompt}`);
    // …and so the probing decision the two make is the same one
    assert.equal(forSnapshot === PROBING_COURSE_ID, forPrompt === PROBING_COURSE_ID);
  }
});

test("the answers are the RIGHT course, not merely equal", async () => {
  const want: Record<string, string | null> = {
    "u1-1": MATH,
    "u1-2": MATH,
    "geo1-2": MATH,
    "soc1-1": SOCIAL,
    "ara1-1": ARABIC,
    "mix1-1": SOCIAL, // the objective taught first, not the one first by id
    "zz9-9": MATH, // unknown → the default lesson
  };
  assert.equal(DEFAULT_LESSON_SLUG, "u1-1");
  for (const [slug, course] of Object.entries(want)) {
    const { forSnapshot, forPrompt } = await bothAnswers(slug);
    assert.deepEqual({ forSnapshot, forPrompt }, { forSnapshot: course, forPrompt: course }, slug);
  }
});

test("the snapshot's read is the prompt's read with LIMIT 1 — one statement, shared", async () => {
  const snapLog: string[] = [];
  await lessonCourseId("soc1-1", fakeClient(snapLog));
  const promptLog: string[] = [];
  await getLessonData("soc1-1", null, fakeClient(promptLog));
  const snapLo = snapLog.filter((q) => q.includes("FROM graph_nodes lo"));
  const promptLo = promptLog.filter((q) => q.includes("FROM graph_nodes lo"));
  assert.equal(snapLo.length, 1);
  assert.equal(promptLo.length, 1);
  assert.equal(snapLo[0], `${promptLo[0]} LIMIT 1`);

  // an unknown slug: one miss, then the default lesson — the same two reads
  const a: string[] = [];
  await lessonCourseId("zz9-9", fakeClient(a));
  const b: string[] = [];
  await getLessonData("zz9-9", null, fakeClient(b));
  assert.deepEqual(
    a.filter((q) => q.includes("FROM graph_nodes lo")),
    b.filter((q) => q.includes("FROM graph_nodes lo")).map((q) => `${q} LIMIT 1`)
  );
});
