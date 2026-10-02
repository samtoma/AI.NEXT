/**
 * FR-3217 in "Ask the Spine" (`lib/ask.ts`), through the REAL
 * `buildAskContext`. Samuel, 2026-09-25, lifting ADR-0020's prompt hold for
 * this ordering: *"yes for sure, for decision 2, it is part of the overall
 * consistency, so please proceed"*.
 *
 * What the model sees, and why the order matters here more than anywhere:
 *   · the LEARNING OBJECTIVES list — subject first (registry order), then the
 *     catalogue order;
 *   · the 8 FOCUS objectives — the only ones that get a description, question
 *     stems the tutor may push, and captioned figures. They are the weakest
 *     eight, and for a NEW student every score is 0, so the tie-break picks
 *     all eight. It used to be whatever order Postgres returned ties in;
 *   · the "Ingested units" line — subject first, then MODULE_RANK;
 *   · the PREREQUISITE EDGES block — which had no ORDER BY at all, and now
 *     reads in catalogue order of the source, then of the destination, then
 *     edge id: the same data always renders the same block.
 *
 * The fake client answers the objective read ONLY if it is exactly the
 * catalogue helper's SQL, and the unit read only if it is exactly
 * `COURSE_RANK, MODULE_RANK` — in the order Postgres returns for those
 * statements (`catalogue-order-db.test.mts` proves that on a real database).
 * Any other curriculum read throws. `pool` answers the figure catalogue and
 * the explanation library (they read through it) and nothing else. A student
 * who sees only maths is modelled as the maths curriculum — what the course
 * gate narrows every read to for her.
 *
 * @covers FR-3217
 */
process.env.AINEXT_COURSE_GATING = "off";

import assert from "node:assert/strict";
import { test } from "node:test";
import type { PoolClient } from "pg";

import { pool } from "./db.ts";
import { COURSE_RANK, MODULE_RANK, catalogueObjectivesSql } from "./module-order.ts";
import { loadCatalogueFixture } from "./spine-maths-fixture.mts";

const { buildAskContext } = await import("./ask.ts");

type Fixture = ReturnType<typeof loadCatalogueFixture>;
type Row = Record<string, unknown>;

const MATHS = loadCatalogueFixture("maths");
const ALL = loadCatalogueFixture("all");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const LO_SQL = catalogueObjectivesSql("lo.id, lo.label, lo.description, lo.syllabus_ref, lo.source_page");
const MODULE_SQL = squash(
  `SELECT m.id, m.label FROM graph_nodes m WHERE m.kind = 'module' ORDER BY ${COURSE_RANK}, ${MODULE_RANK}`
);

(pool as unknown as { connect: () => Promise<never> }).connect = async () => {
  throw new Error("ask-order.test: no database in a unit test");
};
(pool as unknown as { query: (t: string) => Promise<unknown> }).query = async (text: string) => {
  if (/FROM visuals v|FROM misconceptions|FROM explanation_library/.test(text)) return { rows: [], rowCount: 0 };
  throw new Error(`ask-order.test: unexpected pool query: ${text.slice(0, 120)}`);
};

function fakeClient(
  cur: Fixture,
  opts: { mastery?: Record<string, number>; edges?: Fixture["edges"] } = {}
): PoolClient {
  const answer = (text: string): Row[] | null => {
    const sql = squash(text);
    if (text === LO_SQL) {
      return cur.los.map((l) => ({
        id: l.id,
        label: l.label,
        description: l.description,
        syllabus_ref: l.syllabus_ref,
        source_page: l.source_page,
      }));
    }
    if (sql === MODULE_SQL) return cur.modules.map((m) => ({ id: m.id, label: m.label }));
    if (sql.startsWith("SELECT id, src_id, dst_id FROM graph_edges WHERE edge_type = 'prerequisite_of'")) {
      return (opts.edges ?? cur.edges).map((e) => ({ id: String(e.id), src_id: e.src, dst_id: e.dst }));
    }
    if (sql.startsWith("SELECT lo_id, score, system_from, system_to FROM mastery")) {
      return Object.entries(opts.mastery ?? {}).map(([lo_id, score]) => ({
        lo_id,
        score: String(score),
        system_from: new Date("2026-09-01T00:00:00Z"),
        system_to: null,
      }));
    }
    if (sql.includes("FROM questions WHERE status = 'live'")) return [];
    if (sql.includes("FROM source_documents")) {
      return [{ sha256: "abc", title: "Book", publisher: "MOE", edition: null, grade: "9", subject: "math" }];
    }
    // the course gate, switched off (FR-4015): her exceptions (none), every
    // loaded course, the one walk, and the book each course is built from —
    // the one book here is the maths course's, so a student who sees maths
    // is told about it (the scope's `doc`)
    if (sql.startsWith("SELECT course_id, state FROM student_course_access")) return [];
    if (sql === "SELECT id FROM graph_nodes WHERE kind = 'course'") {
      return [...new Set(cur.los.map((l) => l.courseId).filter(Boolean))].map((id) => ({ id }));
    }
    if (sql === "SELECT id AS course_id, source_sha256 FROM graph_nodes WHERE kind = 'course'") {
      return [...new Set(cur.los.map((l) => l.courseId).filter(Boolean))].map((id) => ({
        course_id: id,
        source_sha256: id === "course:prep3-math-en" ? "abc" : null,
      }));
    }
    if (sql.includes("AS lo_id, m.id AS module_id, c.id AS course_id")) {
      return cur.los.map((l) => ({ lo_id: l.id, module_id: l.moduleId, course_id: l.courseId }));
    }
    // the student half of retrieval (each read is try-wrapped in the app)
    if (sql.includes("FROM students WHERE id")) {
      return [{ id: 7, display_name: "Nour Adel", grade: "9", interests: [], interest_detail: null,
        language_pref: "en", curriculum_system: "eg-national-en", gender: null }];
    }
    if (sql.startsWith("WITH focus AS") || sql.includes("FROM attempts")) return [];
    // the book-section store (migration 034): no split section here
    if (sql.includes("FROM course_lessons")) return [];
    return null; // anything else — above all another curriculum read — is a regression
  };
  const query = async (text: string) => {
    const rows = answer(text);
    if (rows === null) throw new Error(`ask-order.test: unexpected query:\n${text.trim().slice(0, 240)}`);
    return { rows, rowCount: rows.length };
  };
  return { query, release() {} } as unknown as PoolClient;
}

async function contextFor(cur: Fixture, opts: Parameters<typeof fakeClient>[1] = {}, studentId: number | null = null) {
  return buildAskContext("spine_chat", "ask-order-test", undefined, undefined, studentId, undefined, fakeClient(cur, opts));
}

/** The objective lines of the data block, and which of them are focus (a description follows). */
function objectiveLines(dataBlock: string): { ids: string[]; focus: string[] } {
  const lines = dataBlock.split("\n");
  const ids: string[] = [];
  const focus: string[] = [];
  lines.forEach((line, i) => {
    const m = line.match(/^- (lo:[\w-]+) \| "/);
    if (!m) return;
    ids.push(m[1]);
    if (lines[i + 1]?.startsWith("  ")) focus.push(m[1]);
  });
  return { ids, focus };
}

const edgeBlock = (dataBlock: string) =>
  dataBlock.split("PREREQUISITE EDGES")[1].split("\n\n")[0].split("\n").filter((l) => /^lo:\S+ -> lo:/.test(l));

const unitLine = (dataBlock: string) =>
  [...(dataBlock.match(/^Ingested units: (.*)$/m)?.[1] ?? "").matchAll(/(module:[\w-]+)/g)].map((m) => m[1]);

const subjectOf = (id: string) =>
  /^(lo|module):ara/.test(id) ? "arabic" : /^(lo|module):soc/.test(id) ? "social" : "math";
const runs = (ids: string[]) => ids.map(subjectOf).filter((s, i, xs) => i === 0 || s !== xs[i - 1]);

const UNIT_1_FIRST_EIGHT = [
  "lo:u1-1-1", "lo:u1-1-2", "lo:u1-1-3", "lo:u1-1-4",
  "lo:u1-2-1", "lo:u1-2-2", "lo:u1-3-1", "lo:u1-3-2",
];

test("a new student who sees only maths: the focus is Unit 1's first eight objectives", async () => {
  const ctx = await contextFor(MATHS);
  const { ids, focus } = objectiveLines(ctx.dataBlock);
  assert.deepEqual(ids, MATHS.los.map((l) => l.id), "the list is the catalogue");
  assert.deepEqual(focus, UNIT_1_FIRST_EIGHT);
  assert.deepEqual(ids.slice(0, 8), UNIT_1_FIRST_EIGHT);
  assert.deepEqual(ctx.grounding.lo_ids, ids);
  assert.deepEqual(unitLine(ctx.dataBlock), [
    "module:u1", "module:u2", "module:u3", "module:u4", "module:u5",
    "module:t2-u1", "module:t2-u2", "module:t2-u3", "module:geo-u1", "module:geo-u2",
  ]);
});

test("a new student who sees every subject: maths first, per the registry — the focus is still Unit 1", async () => {
  const ctx = await contextFor(ALL);
  const { ids, focus } = objectiveLines(ctx.dataBlock);
  assert.deepEqual(runs(ids), ["math", "social", "arabic"], "one run per subject, registry order");
  assert.deepEqual(focus, UNIT_1_FIRST_EIGHT);
  const units = unitLine(ctx.dataBlock);
  assert.deepEqual(runs(units), ["math", "social", "arabic"]);
  assert.deepEqual(units.slice(0, 10), [
    "module:u1", "module:u2", "module:u3", "module:u4", "module:u5",
    "module:t2-u1", "module:t2-u2", "module:t2-u3", "module:geo-u1", "module:geo-u2",
  ]);
});

test("weakest first is still the primary key for the focus; catalogue order only breaks its ties", async () => {
  const mastery: Record<string, number> = Object.fromEntries(MATHS.los.map((l) => [l.id, 0.6]));
  Object.assign(mastery, { "lo:geo1-1-1": 0.2, "lo:u4-1-1": 0.3, "lo:u2-1-1": 0.3 });
  const ctx = await contextFor(MATHS, { mastery }, 7);
  const { focus } = objectiveLines(ctx.dataBlock);
  // geo1-1-1 (weakest), the two 0.3s, then the 0.6 ties in catalogue order —
  // listed in the order the objective list shows them
  const expected = new Set(["lo:geo1-1-1", "lo:u2-1-1", "lo:u4-1-1", "lo:u1-1-1", "lo:u1-1-2", "lo:u1-1-3", "lo:u1-1-4", "lo:u1-2-1"]);
  assert.deepEqual(new Set(focus), expected);
  assert.equal(focus.length, 8);
});

test("the edges block is deterministic: any input order renders the same block, in catalogue order", async () => {
  const scramble = <T,>(xs: T[], seed: number) =>
    xs.map((x, i) => ({ x, k: (i * 7919 + seed) % 997 })).sort((a, b) => a.k - b.k).map(({ x }) => x);
  const base = (await contextFor(ALL)).dataBlock;
  for (const edges of [[...ALL.edges].reverse(), scramble(ALL.edges, 104729), scramble(ALL.edges, 31)]) {
    assert.equal((await contextFor(ALL, { edges })).dataBlock, base, "same data, same prompt");
  }
  // …and the order is: source in catalogue order, then destination, then id
  const rank = new Map(ALL.los.map((l, i) => [l.id, i]));
  const expected = [...ALL.edges]
    .sort((a, b) => rank.get(a.src)! - rank.get(b.src)! || rank.get(a.dst)! - rank.get(b.dst)! || a.id - b.id)
    .map((e) => `${e.src} -> ${e.dst}`);
  const block = edgeBlock(base);
  assert.deepEqual(block, expected);
  assert.deepEqual(block.slice(0, 3), ["lo:u1-1-1 -> lo:u1-1-2", "lo:u1-1-1 -> lo:t2u1-1-1", "lo:u1-1-2 -> lo:u1-1-3"]);
  assert.equal(block.length, ALL.edges.length, "no edge dropped or repeated");
});
