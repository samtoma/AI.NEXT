/**
 * FR-3217 in the practice plan (`/student?mode=practice`), through the REAL
 * `getStudentPlan` (lib/queries.ts).
 *
 * The plan's own order is "weakest first" (strongest first for its one review
 * item), and that stays the primary key. What FR-3217 changes is every TIE —
 * and for a new student, whose every score is 0, nearly everything is a tie.
 * Before v0.9.2 the objectives came back `ORDER BY order_in_parent`, a
 * position the first objective of every unit shares, so Postgres chose which
 * of them came first: on the local database (2026-09-25) the six maths
 * objectives with no prerequisites came back as Unit 2, Unit 3, Unit 4,
 * geometry, Unit 1, Unit 3 — so a new student who sees only maths got Unit 2,
 * Unit 3 and Unit 4 as her three "weakest" items, and Unit 1's first
 * objective came fifth. And a student who sees every subject got them
 * interleaved: Arabic, Social Studies and maths objectives by unit number.
 * Samuel, 2026-09-25: "Yes they need to split by subject". Now the
 * subject (registry order: maths, then Social Studies, then Arabic) and then
 * the catalogue order break every tie, so the plan opens on Unit 1, lesson 1.
 *
 * `pool.connect` is replaced by a fake `PoolClient` before anything runs, so
 * the unit of work `withPrincipal` opens lands on the fake, with the real SQL,
 * in the real order. **The fake answers the objective read only if it is
 * exactly `catalogueObjectivesSql("lo.id, lo.label")`**, and answers it the
 * way Postgres does for that statement — in catalogue order, which
 * `catalogue-order-db.test.mts` proves on a real database. It THROWS on any
 * read it was not expecting. The curriculum is the real seed: maths alone,
 * then all three subjects.
 *
 * @covers FR-3217
 */
process.env.AINEXT_COURSE_GATING = "off";

import assert from "node:assert/strict";
import { test } from "node:test";
import type { PoolClient } from "pg";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { pool } from "./db.ts";
import { catalogueObjectivesSql } from "./module-order.ts";
import { MATHS_SEED_FILES, catalogueCompare, loadMathsGraph } from "./spine-maths-fixture.mts";
import { SPINE_SUBJECT_KEYS, SUBJECTS, SUBJECT_IDS } from "./subjects.ts";

const { getStudentPlan } = await import("./queries.ts");

const MATH = "course:prep3-math-en";
const STUDENT = 7;
const { los, edges } = loadMathsGraph(); // catalogue order, as MODULE_ORDER gives it
const CATALOGUE = los.map((l) => l.id);
const PLAN_SQL = catalogueObjectivesSql("lo.id, lo.label");
const hasPrereq = new Set(edges.map((e) => e.dst));

type Row = Record<string, unknown>;
type Curriculum = {
  los: { id: string; label: string; moduleId: string | null; courseId: string | null }[];
  edges: { src: string; dst: string }[];
};

/**
 * All three subjects from their seeds, in the order `catalogueObjectivesSql`
 * returns them: registry subject first (`SUBJECT_RANK`), then `MODULE_ORDER`
 * (`catalogueCompare`) — the order `catalogue-order-db.test.mts` holds the
 * SQL to on a real database.
 */
function allSubjects(): Curriculum {
  const nodes = new Map<string, { id: string; kind: string; label: string; order_in_parent?: number | null }>();
  const seedEdges: { src: string; dst: string; type: string }[] = [];
  for (const f of [...MATHS_SEED_FILES, "social-t1", "arabic-t1", "arabic-t2"]) {
    const doc = JSON.parse(
      readFileSync(fileURLToPath(new URL(`../../../services/extraction/seed/${f}.json`, import.meta.url)), "utf8")
    );
    for (const n of doc.nodes) if (!nodes.has(n.id)) nodes.set(n.id, n);
    seedEdges.push(...doc.edges);
  }
  const moduleOf = new Map(seedEdges.filter((e) => e.type === "teaches").map((e) => [e.dst, e.src]));
  const courseOf = new Map(seedEdges.filter((e) => e.type === "part_of").map((e) => [e.src, e.dst]));
  const courses = SUBJECT_IDS.map((id) => SUBJECTS[id].courseId as string);
  const subjectRank = (c: string | null) => (c && courses.includes(c) ? courses.indexOf(c) : courses.length);
  const list = [...nodes.values()]
    .filter((n) => n.kind === "learning_objective")
    .map((n) => {
      const moduleId = moduleOf.get(n.id) ?? null;
      return {
        id: n.id,
        label: n.label,
        moduleId,
        courseId: moduleId ? (courseOf.get(moduleId) ?? null) : null,
        moduleOrder: moduleId ? (nodes.get(moduleId)?.order_in_parent ?? null) : null,
        orderInParent: Number(n.order_in_parent ?? 0),
      };
    })
    .sort((a, b) => subjectRank(a.courseId) - subjectRank(b.courseId) || catalogueCompare(a, b));
  return {
    los: list,
    edges: seedEdges.filter((e) => e.type === "prerequisite_of").map((e) => ({ src: e.src, dst: e.dst })),
  };
}

const MATHS_ONLY: Curriculum = {
  los: los.map((l) => ({ id: l.id, label: l.label, moduleId: l.moduleId, courseId: MATH })),
  edges,
};

function fakeClient(mastery: Record<string, number>, cur: Curriculum = MATHS_ONLY): PoolClient {
  const { los, edges } = cur;
  const answer = (text: string): Row[] | null => {
    const sql = text.replace(/\s+/g, " ").trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return [];
    if (sql.startsWith("SELECT set_config('app.student_id'")) return [];
    if (text === PLAN_SQL) return los.map((l) => ({ id: l.id, label: l.label }));
    if (sql.includes("FROM graph_nodes") && sql.includes("learning_objective") && !sql.includes("AS course_id")) {
      return null; // any OTHER objective read is a regression
    }
    if (sql.includes("edge_type = 'prerequisite_of'")) {
      return edges.map((e) => ({ src_id: e.src, dst_id: e.dst }));
    }
    if (sql.startsWith("SELECT lo_id, score FROM mastery")) {
      return Object.entries(mastery).map(([lo_id, score]) => ({ lo_id, score: String(score) }));
    }
    if (sql.includes("FROM questions q WHERE q.status = 'live'")) {
      return los.map((l) => ({
        id: `q:${l.id.slice(3)}:001`,
        lo_id: l.id,
        tier: "basic",
        question_type: "mcq",
        stem: "stem",
        choices: null,
        source_page: 1,
        recent_attempts: "0",
      }));
    }
    if (sql.startsWith("SELECT display_name FROM students")) return [{ display_name: "Nour Adel" }];
    // the course gate, switched off: every course that exists…
    if (sql === "SELECT id FROM graph_nodes WHERE kind = 'course'") {
      return [...new Set(los.map((l) => l.courseId).filter(Boolean))].map((id) => ({ id }));
    }
    // …and the one walk that maps objectives to their course
    if (sql.includes("AS lo_id, m.id AS module_id, c.id AS course_id")) {
      return los.map((l) => ({ lo_id: l.id, module_id: l.moduleId, course_id: l.courseId }));
    }
    return null;
  };
  const query = async (text: string) => {
    const rows = answer(text);
    if (rows === null) throw new Error(`student-plan-order: unexpected query:\n${text.trim().slice(0, 240)}`);
    return { rows, rowCount: rows.length };
  };
  return { query, release() {} } as unknown as PoolClient;
}

async function planFor(mastery: Record<string, number>, cur?: Curriculum) {
  (pool as unknown as { connect: () => Promise<PoolClient> }).connect = async () => fakeClient(mastery, cur);
  return getStudentPlan(STUDENT);
}

const rank = (id: string) => CATALOGUE.indexOf(id);

test("the plan reads its objectives with the one catalogue query, and lists mastery in that order", async () => {
  const plan = await planFor({});
  assert.deepEqual(plan.mastery.map((m) => m.loId), CATALOGUE);
  // Term 1, then Term 2, then geometry — never interleaved
  const kinds = plan.mastery.map((m) => (m.loId.startsWith("lo:geo") ? 2 : m.loId.startsWith("lo:t2") ? 1 : 0));
  assert.deepEqual(kinds, [...kinds].sort((a, b) => a - b));
  assert.equal(plan.mastery[0].loId, "lo:u1-1-1");
});

test("a new student: every score ties at 0, and the catalogue decides — the plan opens on Unit 1, lesson 1", async () => {
  const plan = await planFor({});
  const items = plan.items.map((i) => [i.loId, i.reason]);
  // weakest: the first three ready objectives (no prerequisites) in catalogue order
  const ready = CATALOGUE.filter((id) => !hasPrereq.has(id));
  assert.deepEqual(ready.slice(0, 3), ["lo:u1-1-1", "lo:u2-1-1", "lo:u3-1-1"]);
  // stretch: the first objective in catalogue order whose prerequisites are not met
  const firstUnready = CATALOGUE.find((id) => hasPrereq.has(id));
  assert.equal(firstUnready, "lo:u1-1-2");
  assert.deepEqual(items, [
    ["lo:u1-1-1", "weakest"],
    ["lo:u2-1-1", "weakest"],
    ["lo:u3-1-1", "weakest"],
    ["lo:u1-1-2", "stretch"],
    // backfill walks the catalogue from the top, skipping questions already used
    ["lo:u1-1-3", "weakest"],
  ]);
});

test("weakest first is still the primary key; catalogue order only breaks its ties", async () => {
  // Everything solid enough to be ready, then four weak spots: one clearly
  // weakest, three tied — in geometry, Unit 4 and Unit 3, i.e. NOT in
  // catalogue order here. All four have no prerequisites, so all are ready.
  const mastery: Record<string, number> = Object.fromEntries(CATALOGUE.map((id) => [id, 0.6]));
  Object.assign(mastery, {
    "lo:geo1-1-1": 0.3,
    "lo:u4-1-1": 0.3,
    "lo:u3-2-1": 0.3,
    "lo:u2-1-1": 0.2,
    // review: two tied at the top — the catalogue-earlier one is reviewed
    "lo:u3-1-1": 0.95,
    "lo:u1-2-1": 0.95,
  });
  const plan = await planFor(mastery);
  const weakest = plan.items.filter((i) => i.reason === "weakest").map((i) => i.loId);
  assert.deepEqual(weakest.slice(0, 3), ["lo:u2-1-1", "lo:u3-2-1", "lo:u4-1-1"]);
  assert.ok(rank("lo:u3-2-1") < rank("lo:u4-1-1") && rank("lo:u4-1-1") < rank("lo:geo1-1-1"));
  assert.deepEqual(plan.items.filter((i) => i.reason === "review").map((i) => i.loId), ["lo:u1-2-1"]);
});

test("a student who sees every subject: split by subject — maths from Unit 1, then Social Studies, then Arabic", async () => {
  const cur = allSubjects();
  const plan = await planFor({}, cur);
  const subjectOf = (id: string) =>
    id.startsWith("lo:ara") ? "arabic" : id.startsWith("lo:soc") ? "social" : "math";
  const order = plan.mastery.map((m) => m.loId);
  assert.equal(order.length, cur.los.length);
  // one block per subject, in registry order, never interleaved
  const blocks = order.map(subjectOf).filter((s, i, xs) => i === 0 || s !== xs[i - 1]);
  assert.deepEqual(blocks, SPINE_SUBJECT_KEYS);
  assert.deepEqual(blocks, ["math", "social", "arabic"], "the registry puts maths first today");
  // maths inside its block is the maths catalogue, Unit 1 first
  assert.deepEqual(order.filter((id) => subjectOf(id) === "math"), CATALOGUE);
  assert.equal(order[0], "lo:u1-1-1");
  // Every subject's first objectives are ready and tie at 0, and every one has
  // a question here — the subject decides, so the plan is maths from Unit 1.
  const ready = order.filter((id) => !cur.edges.some((e) => e.dst === id));
  assert.ok(ready.some((id) => subjectOf(id) !== "math"), "other subjects have ready objectives too");
  assert.deepEqual(
    plan.items.filter((i) => i.reason === "weakest").slice(0, 3).map((i) => i.loId),
    ["lo:u1-1-1", "lo:u2-1-1", "lo:u3-1-1"]
  );
});
