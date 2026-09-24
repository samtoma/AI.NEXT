/**
 * FR-3215 against a real Postgres: the skill map's objective query
 * (`lib/spine-lo-query.ts`), run as written, returns the maths objectives in
 * catalogue order — the same order `MODULE_ORDER` gives the lesson list — in
 * both variants, whatever order the rows were inserted in, and without
 * dropping an objective that has no module.
 *
 * **Opt-in.** It needs a server it may create a database on, so it runs only
 * when `AINEXT_SCRATCH_PG` names one — a DSN to a maintenance database, as a
 * role with CREATEDB:
 *
 *   AINEXT_SCRATCH_PG=postgres://localhost:5432/postgres \
 *     node --import ./scripts/ts-resolver.mjs --test src/lib/spine-order-db.test.mts
 *
 * Without it every test here is reported as skipped (CI has no database for
 * `npm test`; see traceability.md). With it, it creates ONE database named
 * `ainext_spine_order_<pid>_<ms>`, builds only what the query reads —
 * `graph_nodes` and `graph_edges` with the columns it touches, and the
 * `node_subject` view taken verbatim from migration 007 — loads the ten maths
 * seed files plus one objective with no module, and drops that database by its
 * exact name afterwards. It never touches any other database.
 *
 * The expected order is `catalogueCompare` from `spine-maths-fixture.mts`, the
 * TypeScript statement of `MODULE_ORDER` the layout tests rank by; this test
 * is what keeps that statement honest.
 *
 * @covers FR-3215
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { SPINE_LO_SQL, SPINE_LO_SQL_NO_SUBJECT_VIEW } from "./spine-lo-query.ts";
import { catalogueCompare, readMathsSeeds } from "./spine-maths-fixture.mts";

const DSN = process.env.AINEXT_SCRATCH_PG;
const skip = DSN
  ? false
  : "set AINEXT_SCRATCH_PG to a maintenance-database DSN to run against a scratch database";

const DB = `ainext_spine_order_${process.pid}_${Date.now()}`;
const ORPHAN = "lo:zz-no-module";

let admin: pg.Client | null = null;
let db: pg.Client | null = null;

/** migration 007's `CREATE OR REPLACE VIEW node_subject …;`, as shipped */
function nodeSubjectView(): string {
  const sql = readFileSync(
    fileURLToPath(
      new URL("../../../db/migrations/007-course-subject-column.sql", import.meta.url)
    ),
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

before(async () => {
  if (!DSN) return;
  assert.match(DB, /^ainext_spine_order_\d+_\d+$/);
  admin = new pg.Client({ connectionString: DSN });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${DB}" TEMPLATE template0`);
  const url = new URL(DSN);
  url.pathname = `/${DB}`;
  db = new pg.Client({ connectionString: url.toString() });
  await db.connect();

  await db.query(`
    CREATE TABLE graph_nodes (
      id text PRIMARY KEY,
      kind text NOT NULL,
      label text NOT NULL,
      description text,
      syllabus_ref text,
      order_in_parent int,
      source_page int,
      subject text
    );
    CREATE TABLE graph_edges (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      src_id text NOT NULL REFERENCES graph_nodes(id),
      dst_id text NOT NULL REFERENCES graph_nodes(id),
      edge_type text NOT NULL,
      syllabus_version text NOT NULL DEFAULT '2025-2026',
      system_to timestamptz
    );
  `);
  await db.query(nodeSubjectView());

  const { nodes, edges } = readMathsSeeds();
  for (const n of scramble(nodes)) {
    await db.query(
      `INSERT INTO graph_nodes (id, kind, label, description, syllabus_ref, order_in_parent, source_page, subject)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        n.id,
        n.kind,
        n.label,
        n.description ?? null,
        n.syllabus_ref ?? null,
        n.order_in_parent ?? null,
        n.source_page ?? null,
        n.kind === "course" ? "math" : null,
      ]
    );
  }
  // an objective nothing teaches: it must still come back
  await db.query(
    `INSERT INTO graph_nodes (id, kind, label, order_in_parent)
     VALUES ($1, 'learning_objective', 'No module', 1)`,
    [ORPHAN]
  );
  for (const e of scramble(edges.filter((e) => e.type !== "prerequisite_of"))) {
    await db.query(
      `INSERT INTO graph_edges (src_id, dst_id, edge_type) VALUES ($1, $2, $3)`,
      [e.src, e.dst, e.type]
    );
  }
});

after(async () => {
  await db?.end();
  if (admin) {
    // this database, by its exact name, and nothing else
    await admin.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
    await admin.end();
  }
});

/** The expected order: every objective in the scratch database, ranked by
 *  the TypeScript statement of MODULE_ORDER. */
function expectedOrder(): string[] {
  const { nodes, edges } = readMathsSeeds();
  const moduleOrder = new Map(
    nodes.filter((n) => n.kind === "module").map((n) => [n.id, n.order_in_parent ?? null])
  );
  const moduleOf = new Map(
    edges.filter((e) => e.type === "teaches").map((e) => [e.dst, e.src])
  );
  const los = nodes
    .filter((n) => n.kind === "learning_objective")
    .map((n) => ({ id: n.id, order: n.order_in_parent ?? 0 }))
    .concat([{ id: ORPHAN, order: 1 }]);
  return los
    .map((l) => {
      const moduleId = moduleOf.get(l.id) ?? null;
      return {
        id: l.id,
        moduleId,
        moduleOrder: moduleId ? (moduleOrder.get(moduleId) ?? null) : null,
        orderInParent: Number(l.order),
      };
    })
    .sort(catalogueCompare)
    .map((k) => k.id);
}

test("the query returns every maths objective, and the one with no module, in catalogue order", { skip }, async () => {
  const { rows } = await db!.query(SPINE_LO_SQL);
  const ids = rows.map((r) => r.id as string);
  assert.equal(ids.length, 91, "90 maths objectives + the one with no module");
  assert.equal(new Set(ids).size, ids.length, "one row per objective");
  assert.equal(rows.filter((r) => r.subject === "math").length, 90);
  assert.deepEqual(ids, expectedOrder());
  // Term 1 algebra, then Term 2, then geometry — and the moduleless one at
  // the end of Term 1, where MODULE_ORDER's CASE and NULLS LAST put it
  const firstT2 = ids.findIndex((id) => id.startsWith("lo:t2"));
  const firstGeo = ids.findIndex((id) => id.startsWith("lo:geo"));
  assert.ok(ids.indexOf(ORPHAN) === firstT2 - 1, "moduleless objective closes Term 1");
  assert.ok(ids.slice(0, firstT2).every((id) => id.startsWith("lo:u") || id === ORPHAN));
  assert.ok(ids.slice(firstT2, firstGeo).every((id) => id.startsWith("lo:t2")));
  assert.ok(ids.slice(firstGeo).every((id) => id.startsWith("lo:geo")));
});

test("both variants return the same order, and the same again on a re-run", { skip }, async () => {
  const withView = (await db!.query(SPINE_LO_SQL)).rows.map((r) => r.id);
  const without = (await db!.query(SPINE_LO_SQL_NO_SUBJECT_VIEW)).rows.map((r) => r.id);
  assert.deepEqual(without, withView);
  for (let i = 0; i < 3; i++) {
    assert.deepEqual((await db!.query(SPINE_LO_SQL)).rows.map((r) => r.id), withView);
  }
});

test("the old query really was ambiguous: it tied across modules", { skip }, async () => {
  // Not a test of the new code — the evidence that FR-3215 fixed something.
  const { rows } = await db!.query(
    `SELECT order_in_parent, count(*)::int AS n FROM graph_nodes
      WHERE kind = 'learning_objective' AND id <> $1 GROUP BY 1 ORDER BY 1`,
    [ORPHAN]
  );
  const shared = new Map(rows.map((r) => [Number(r.order_in_parent), Number(r.n)]));
  for (const pos of [1, 2, 3, 4, 5]) {
    assert.equal(shared.get(pos), 9, `position ${pos} is shared by nine maths objectives`);
  }
});
