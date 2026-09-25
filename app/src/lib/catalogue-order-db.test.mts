/**
 * FR-3217 against a real Postgres: every rerouted reader of curriculum order,
 * run as written, comes back in THE catalogue order, with every objective
 * exactly once and Term 1 before Term 2 before geometry — and a reader that
 * lists every subject splits them by subject first, in the registry's order
 * (maths, Social Studies, Arabic), never interleaved (Samuel, 2026-09-25:
 * "Yes they need to split by subject"). Inside one course, the split order
 * and the single-course order the progression walks are the same.
 *
 *   · `catalogueObjectivesSql` — the practice plan's and /pipeline's read;
 *   · the REAL `getLessonCatalog`, against the progression's own read
 *     (`LO_MODULE_SELECT` + `MODULE_ORDER`) course by course, and the skill
 *     map (`SPINE_LO_SQL`) subject by subject;
 *   · the console Overview's heatmap query, taken from the source as written;
 *   · the REAL `getGalleryData`, `getTopicBreakdown` and `getStudentPlan`.
 *
 * **Opt-in.** It needs a server it may create a database on, so it runs only
 * when `AINEXT_SCRATCH_PG` names one — a DSN to a maintenance database, as a
 * role with CREATEDB:
 *
 *   AINEXT_SCRATCH_PG=postgres://localhost:5432/postgres \
 *     node --import ./scripts/ts-resolver.mjs --test src/lib/catalogue-order-db.test.mts
 *
 * Without it every test here is reported as skipped (CI has no database for
 * `npm test`). With it, it creates ONE database named
 * `ainext_catalogue_order_<pid>_<ms>`, builds only the tables these readers
 * touch, loads the real seed files of all three subjects in a scrambled order
 * plus one objective with no module, and drops that database by its exact
 * name afterwards. It never touches any other database. `pool` (lib/db.ts) is
 * pointed at the scratch database for the two readers that use it.
 *
 * The expected order is `catalogueCompare` from `spine-maths-fixture.mts` —
 * the TypeScript statement of `MODULE_ORDER` that `spine-order-db.test.mts`
 * already holds to the SQL — behind the registry position of the course
 * (`SUBJECT_IDS`, lib/subjects.ts) for the readers of every subject.
 *
 * @covers FR-3217
 */
process.env.AINEXT_COURSE_GATING = "off";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";
import type { PoolClient } from "pg";

import { pool } from "./db.ts";
import {
  LO_MODULE_JOIN,
  MODULE_ORDER,
  catalogueObjectivesSql,
} from "./module-order.ts";
import { SPINE_LO_SQL } from "./spine-lo-query.ts";
import { MATHS_SEED_FILES, catalogueCompare, termRank } from "./spine-maths-fixture.mts";
import { SUBJECTS, SUBJECT_IDS } from "./subjects.ts";

const { LO_MODULE_SELECT, getLessonCatalog } = await import("./lesson.ts");
const { getGalleryData } = await import("./visuals.ts");
const { getTopicBreakdown } = await import("./dashboard.ts");
const { getStudentPlan } = await import("./queries.ts");

const DSN = process.env.AINEXT_SCRATCH_PG;
const skip = DSN
  ? false
  : "set AINEXT_SCRATCH_PG to a maintenance-database DSN to run against a scratch database";

const DB = `ainext_catalogue_order_${process.pid}_${Date.now()}`;
const ORPHAN = "lo:zz-no-module";
const BUNDLES = [...MATHS_SEED_FILES, "arabic-t1", "arabic-t2", "social-t1"];
const COURSE_SUBJECT: Record<string, string> = {
  "course:prep3-math-en": "math",
  "course:prep3-arabic-ar": "arabic",
  "course:prep3-social-ar": "social",
};

let admin: pg.Client | null = null;
let db: pg.Client | null = null;

type SeedNode = { id: string; kind: string; label: string; order_in_parent?: number | null };
type SeedEdge = { src: string; dst: string; type: string };

function readSeeds(): { nodes: SeedNode[]; edges: SeedEdge[] } {
  const byId = new Map<string, SeedNode>();
  const edges: SeedEdge[] = [];
  for (const f of BUNDLES) {
    const doc = JSON.parse(
      readFileSync(
        fileURLToPath(new URL(`../../../services/extraction/seed/${f}.json`, import.meta.url)),
        "utf8"
      )
    ) as { nodes: SeedNode[]; edges: SeedEdge[] };
    for (const n of doc.nodes) if (!byId.has(n.id)) byId.set(n.id, n);
    edges.push(...doc.edges);
  }
  return { nodes: [...byId.values()], edges };
}

/** migration 007's `CREATE OR REPLACE VIEW node_subject …;`, as shipped */
function nodeSubjectView(): string {
  const sql = readFileSync(
    fileURLToPath(new URL("../../../db/migrations/007-course-subject-column.sql", import.meta.url)),
    "utf8"
  );
  const m = sql.match(/CREATE OR REPLACE VIEW node_subject AS[\s\S]*?;/);
  assert.ok(m, "migration 007 defines node_subject");
  return m[0];
}

/** Deterministic shuffle, so the physical insert order is not catalogue order. */
function scramble<T>(xs: T[]): T[] {
  return xs
    .map((x, i) => ({ x, k: (i * 7919 + 104729) % 997 }))
    .sort((a, b) => a.k - b.k)
    .map(({ x }) => x);
}

const seeds = readSeeds();
const moduleOrderOf = new Map(
  seeds.nodes.filter((n) => n.kind === "module").map((n) => [n.id, n.order_in_parent ?? null])
);
const moduleOf = new Map(seeds.edges.filter((e) => e.type === "teaches").map((e) => [e.dst, e.src]));
const courseOfModule = new Map(seeds.edges.filter((e) => e.type === "part_of").map((e) => [e.src, e.dst]));
const REGISTRY_COURSES = SUBJECT_IDS.map((id) => SUBJECTS[id].courseId as string);
/** `SUBJECT_RANK` in TypeScript: the registry position of the module's course. */
const subjectRankOfModule = (moduleId: string | null) => {
  const c = moduleId ? courseOfModule.get(moduleId) : undefined;
  return c && REGISTRY_COURSES.includes(c) ? REGISTRY_COURSES.indexOf(c) : REGISTRY_COURSES.length;
};
const subjectOfLo = (id: string) =>
  id.startsWith("lo:ara") ? "arabic" : id.startsWith("lo:soc") ? "social" : id === ORPHAN ? "none" : "math";

/** Every objective in the scratch database, ranked by the TS MODULE_ORDER —
 *  the single-subject order (the skill map, the progression). */
const EXPECTED_SINGLE: string[] = seeds.nodes
  .filter((n) => n.kind === "learning_objective")
  .map((n) => ({ id: n.id, order: n.order_in_parent ?? 0 }))
  .concat([{ id: ORPHAN, order: 1 }])
  .map((l) => {
    const moduleId = moduleOf.get(l.id) ?? null;
    return {
      id: l.id,
      moduleId,
      moduleOrder: moduleId ? (moduleOrderOf.get(moduleId) ?? null) : null,
      orderInParent: Number(l.order),
    };
  })
  .sort(catalogueCompare)
  .map((k) => k.id);

/** The same objectives split by subject first — every reader of all subjects. */
const EXPECTED: string[] = [...EXPECTED_SINGLE].sort(
  (a, b) =>
    subjectRankOfModule(moduleOf.get(a) ?? null) - subjectRankOfModule(moduleOf.get(b) ?? null) ||
    EXPECTED_SINGLE.indexOf(a) - EXPECTED_SINGLE.indexOf(b)
);

/** Consecutive runs of one subject — a split list has one run per subject. */
const blocks = (ids: string[]) =>
  ids.map(subjectOfLo).filter((s, i, xs) => i === 0 || s !== xs[i - 1]);

const isMaths = (id: string) => /^lo:(u\d|t2u|geo)/.test(id);
const MATHS_EXPECTED = EXPECTED.filter(isMaths);

/** Term 1, then Term 2 algebra, then geometry, with no interleaving. */
function assertTermsInOrder(ids: string[], what: string) {
  const term = (id: string) => (id.startsWith("lo:geo") ? 2 : id.startsWith("lo:t2") ? 1 : 0);
  const terms = ids.filter(isMaths).map(term);
  assert.deepEqual(terms, [...terms].sort((a, b) => a - b), `${what}: Term 1 < Term 2 < geometry`);
}

/** A PoolClient over the scratch connection, for the readers that take one. */
const asClient = () =>
  ({ query: (t: string, v?: unknown[]) => db!.query(t, v), release() {} }) as unknown as PoolClient;

before(async () => {
  if (!DSN) return;
  assert.match(DB, /^ainext_catalogue_order_\d+_\d+$/);
  admin = new pg.Client({ connectionString: DSN });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${DB}" TEMPLATE template0`);
  const url = new URL(DSN);
  url.pathname = `/${DB}`;
  db = new pg.Client({ connectionString: url.toString() });
  await db.connect();

  await db.query(`
    CREATE TABLE graph_nodes (
      id text PRIMARY KEY, kind text NOT NULL, label text NOT NULL, description text,
      syllabus_ref text, order_in_parent int, source_page int, subject text
    );
    CREATE TABLE graph_edges (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      src_id text NOT NULL, dst_id text NOT NULL, edge_type text NOT NULL,
      syllabus_version text NOT NULL DEFAULT '2025-2026', system_to timestamptz
    );
    CREATE TABLE visuals (
      id text PRIMARY KEY, lo_id text NOT NULL, question_id text, kind text NOT NULL,
      spec jsonb, caption text, source_page int
    );
    CREATE TABLE questions (
      id text PRIMARY KEY, lo_id text NOT NULL, tier text, question_type text, stem text,
      choices jsonb, source_page int, status text NOT NULL
    );
    CREATE TABLE attempts (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, student_id bigint NOT NULL,
      question_id text NOT NULL, attempted_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE mastery (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, student_id bigint NOT NULL,
      lo_id text NOT NULL, score numeric NOT NULL,
      system_from timestamptz NOT NULL DEFAULT now(), system_to timestamptz
    );
    CREATE TABLE students (id bigint PRIMARY KEY, display_name text);
  `);
  await db.query(nodeSubjectView());

  for (const n of scramble(seeds.nodes)) {
    await db.query(
      `INSERT INTO graph_nodes (id, kind, label, order_in_parent, subject) VALUES ($1, $2, $3, $4, $5)`,
      [n.id, n.kind, n.label, n.order_in_parent ?? null, n.kind === "course" ? (COURSE_SUBJECT[n.id] ?? null) : null]
    );
  }
  await db.query(
    `INSERT INTO graph_nodes (id, kind, label, order_in_parent) VALUES ($1, 'learning_objective', 'No module', 1)`,
    [ORPHAN]
  );
  for (const e of scramble(seeds.edges)) {
    await db.query(`INSERT INTO graph_edges (src_id, dst_id, edge_type) VALUES ($1, $2, $3)`, [e.src, e.dst, e.type]);
  }
  // one figure per Social Studies objective, so /gallery holds two subjects
  for (const id of scramble(EXPECTED.filter((x) => subjectOfLo(x) === "social"))) {
    await db.query(`INSERT INTO visuals (id, lo_id, kind, spec) VALUES ($1, $2, 'map', '{}')`, [
      `viz:${id.slice(3)}:a`,
      id,
    ]);
  }
  // two figures per maths objective, ids chosen so `v.id` decides inside one
  for (const id of scramble(MATHS_EXPECTED)) {
    for (const s of ["b", "a"]) {
      await db.query(`INSERT INTO visuals (id, lo_id, kind, spec) VALUES ($1, $2, 'geo_scene', '{}')`, [
        `viz:${id.slice(3)}:${s}`,
        id,
      ]);
    }
  }
  // one live question per objective of every subject, so the plan's
  // tie-break has all three to choose from
  for (const id of scramble(EXPECTED.filter((x) => x !== ORPHAN))) {
    await db.query(
      `INSERT INTO questions (id, lo_id, tier, question_type, stem, source_page, status)
       VALUES ($1, $2, 'basic', 'mcq', 'stem', 1, 'live')`,
      [`q:${id.slice(3)}:001`, id]
    );
  }
  await db.query(`INSERT INTO students (id, display_name) VALUES (1, 'New'), (2, 'Started'), (3, 'Plan')`);

  (pool as unknown as { query: (t: string, v?: unknown[]) => unknown }).query = (t, v) => db!.query(t, v);
  (pool as unknown as { connect: () => Promise<PoolClient> }).connect = async () => asClient();
});

after(async () => {
  await db?.end();
  if (admin) {
    // this database, by its exact name, and nothing else
    await admin.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
    await admin.end();
  }
});

const ids = async (sql: string, values?: unknown[]) =>
  (await db!.query(sql, values)).rows.map((r) => r.id as string);

test("the shared read returns every objective once, in catalogue order, for both readers' columns", { skip }, async () => {
  for (const cols of ["lo.id, lo.label", "lo.id, lo.label, lo.source_page"]) {
    const got = await ids(catalogueObjectivesSql(cols));
    assert.equal(got.length, EXPECTED.length, `${cols}: every objective, and the one with no module`);
    assert.equal(new Set(got).size, got.length, `${cols}: none twice`);
    assert.deepEqual(got, EXPECTED, cols);
    assertTermsInOrder(got, cols);
    for (let i = 0; i < 2; i++) assert.deepEqual(await ids(catalogueObjectivesSql(cols)), got, "stable on re-run");
  }
  const got = await ids(catalogueObjectivesSql("lo.id"));
  // split by subject, registry order, the moduleless objective last
  assert.deepEqual(blocks(got), ["math", "social", "arabic", "none"]);
  assert.deepEqual(got.slice(0, 90), MATHS_EXPECTED);
  assert.equal(MATHS_EXPECTED.length, 90);
  assert.deepEqual(MATHS_EXPECTED.slice(0, 3), ["lo:u1-1-1", "lo:u1-1-2", "lo:u1-1-3"]);
  // before the subject key, the same read interleaved them by unit number
  assert.ok(blocks(EXPECTED_SINGLE).length > 20, "MODULE_ORDER alone interleaves the subjects");
});

test("one source: the plan, /pipeline and the lesson catalogue read one sequence; the skill map, per subject, the same", { skip }, async () => {
  const plan = await ids(catalogueObjectivesSql("lo.id, lo.label"));
  const pipeline = await ids(catalogueObjectivesSql("lo.id, lo.label, lo.source_page"));
  assert.deepEqual(pipeline, plan);
  // the REAL lesson catalogue, ungated (no student): its lessons in the
  // order of the plan's objectives
  const catalogue = await getLessonCatalog(null, asClient());
  const slugOrder = (xs: string[]) => [...new Set(xs.filter((id) => id !== ORPHAN).map((id) => id.slice(3).replace(/-\d+$/, "")))];
  assert.deepEqual(
    catalogue.map((l) => l.slug).filter((s) => s !== ORPHAN.slice(3)),
    slugOrder(plan)
  );
  assert.deepEqual(
    [...new Set(catalogue.map((l) => l.subject).filter(Boolean))],
    ["math-en", "social-ar", "arabic-ar"],
    "the check-in's picker with no subject named: maths, then Social Studies, then Arabic"
  );
  // the skill map shows one subject at a time: per subject, the same order
  const spine = await ids(SPINE_LO_SQL);
  assert.deepEqual(spine, EXPECTED_SINGLE);
  for (const subj of ["math", "social", "arabic"]) {
    assert.deepEqual(
      spine.filter((id) => subjectOfLo(id) === subj),
      plan.filter((id) => subjectOfLo(id) === subj),
      subj
    );
  }
});

test("inside one course the split order IS the order the progression walks", { skip }, async () => {
  // progression-db.ts reads `${LO_MODULE_SELECT} ORDER BY ${MODULE_ORDER}`
  // and narrows to one course; the lesson catalogue now puts the subject in
  // front. Course by course, the two must be the same lessons in the same order.
  const progression = (await db!.query(`${LO_MODULE_SELECT} ORDER BY ${MODULE_ORDER}`)).rows;
  const catalogue = await getLessonCatalog(null, asClient());
  for (const course of REGISTRY_COURSES) {
    const walk = [
      ...new Set(
        progression.filter((r) => r.course_id === course).map((r) => (r.id as string).slice(3).replace(/-\d+$/, ""))
      ),
    ];
    assert.ok(walk.length > 0, course);
    assert.deepEqual(catalogue.filter((l) => l.courseId === course).map((l) => l.slug), walk, course);
  }
});

test("the console Overview's heatmap query, as written, lists one subject in catalogue order", { skip }, async () => {
  const source = readFileSync(fileURLToPath(new URL("./overview-queries.ts", import.meta.url)), "utf8");
  const at = source.indexOf("AS module_ordinal");
  const sql = source
    .slice(source.lastIndexOf("`", at) + 1, source.indexOf("`", at))
    .replace("${LO_MODULE_JOIN}", LO_MODULE_JOIN)
    .replace("${MODULE_ORDER}", MODULE_ORDER);
  assert.ok(!sql.includes("${"), "every interpolation resolved");
  const rows = (await db!.query(sql, ["math"])).rows;
  assert.deepEqual(rows.map((r) => r.lo_id), MATHS_EXPECTED);
  assertTermsInOrder(rows.map((r) => r.lo_id as string), "heatmap");
  const arabic = (await db!.query(sql, ["arabic"])).rows.map((r) => r.lo_id);
  assert.deepEqual(arabic, EXPECTED.filter((id) => id.startsWith("lo:ara")));
});

test("/gallery (the real getGalleryData): maths units, then Social Studies units, figures in catalogue order", { skip }, async () => {
  const g = await getGalleryData();
  const social = EXPECTED.filter((id) => subjectOfLo(id) === "social");
  assert.deepEqual(
    g.modules.map((m) => m.id),
    ["module:u1", "module:u2", "module:u3", "module:u4", "module:u5",
     "module:t2-u1", "module:t2-u2", "module:t2-u3", "module:geo-u1", "module:geo-u2",
     "module:soc-t1-u1", "module:soc-t1-u2", "module:soc-t1-u3", "module:soc-t1-u4"]
  );
  const flat = g.modules.flatMap((m) => m.visuals);
  assert.equal(g.total, 180 + social.length);
  assert.deepEqual(
    flat.map((v) => v.id),
    [
      ...MATHS_EXPECTED.flatMap((id) => [`viz:${id.slice(3)}:a`, `viz:${id.slice(3)}:b`]),
      ...social.map((id) => `viz:${id.slice(3)}:a`),
    ]
  );
});

test("the progress page (the real getTopicBreakdown): untouched topics by subject, then catalogue order", { skip }, async () => {
  // SUBJECT_RANK, then MODULE_RANK, in TypeScript: subject, term, position (NULLS LAST), id
  const expected = [...moduleOrderOf.keys()].sort((a, b) => {
    const pa = moduleOrderOf.get(a) ?? Infinity;
    const pb = moduleOrderOf.get(b) ?? Infinity;
    return (
      subjectRankOfModule(a) - subjectRankOfModule(b) ||
      termRank(a) - termRank(b) || pa - pb || (a < b ? -1 : a > b ? 1 : 0)
    );
  });
  const fresh = await getTopicBreakdown(1, asClient());
  assert.deepEqual(fresh.map((t) => t.moduleId), expected);
  assert.deepEqual(fresh.map((t) => t.moduleId).slice(0, 10), [
    "module:u1", "module:u2", "module:u3", "module:u4", "module:u5",
    "module:t2-u1", "module:t2-u2", "module:t2-u3", "module:geo-u1", "module:geo-u2",
  ]);
  assert.deepEqual(
    fresh.map((t) => t.moduleId).slice(10).map((id) => (id.startsWith("module:soc") ? "social" : "arabic"))
      .filter((s, i, xs) => i === 0 || s !== xs[i - 1]),
    ["social", "arabic"],
    "maths, then Social Studies, then Arabic — never interleaved"
  );
  // started topics still come first, weakest first; the rest keep the order
  await db!.query(
    `INSERT INTO attempts (student_id, question_id) VALUES (2, 'q:geo1-1-1:001'), (2, 'q:u3-1-1:001');
     INSERT INTO mastery (student_id, lo_id, score) VALUES (2, 'lo:geo1-1-1', 0.9), (2, 'lo:u3-1-1', 0.4);`
  );
  const started = (await getTopicBreakdown(2, asClient())).map((t) => t.moduleId);
  assert.deepEqual(started.slice(0, 2), ["module:u3", "module:geo-u1"], "u3 averages 0.05, geo-u1 0.1");
  assert.deepEqual(started.slice(2), expected.filter((id) => id !== "module:u3" && id !== "module:geo-u1"));
});

test("the practice plan (the real getStudentPlan): split by subject, catalogue order, under weakest-first", { skip }, async () => {
  const plan = await getStudentPlan(3);
  // the course gate refuses an objective that resolves to no course, even
  // with gating off — so the moduleless one is the only objective missing
  assert.deepEqual(
    plan.mastery.map((m) => m.loId),
    EXPECTED.filter((id) => id !== ORPHAN)
  );
  assert.deepEqual(blocks(plan.mastery.map((m) => m.loId)), ["math", "social", "arabic"]);
  // every score is 0 and every subject has ready objectives with live
  // questions, so the subject decides first: maths, Unit 1 first
  const weakest = plan.items.filter((i) => i.reason === "weakest").map((i) => i.loId);
  assert.deepEqual(weakest.slice(0, 3), ["lo:u1-1-1", "lo:u2-1-1", "lo:u3-1-1"]);
  assert.ok(plan.items.every((i) => isMaths(i.loId)));
});
