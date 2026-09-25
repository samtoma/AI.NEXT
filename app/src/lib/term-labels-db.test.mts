/**
 * FR-3218 against a real Postgres: migration 031 and its rollback, run as
 * shipped, change `module:geo-u1`'s label and nothing else, and a second run
 * of either writes nothing at all.
 *
 * "Writes nothing" is checked on the row's `xmin` — the id of the transaction
 * that last wrote it. An UPDATE that set the label to the value it already
 * had would still write a new row version and move `xmin`; an unchanged
 * `xmin` means no row was touched, so no row lock was taken (FR-3213).
 *
 * **Opt-in**, like `spine-order-db.test.mts`: it runs only when
 * `AINEXT_SCRATCH_PG` names a maintenance-database DSN, as a role with
 * CREATEDB:
 *
 *   AINEXT_SCRATCH_PG=postgres://localhost:5432/postgres \
 *     node --import ./scripts/ts-resolver.mjs --test src/lib/term-labels-db.test.mts
 *
 * It creates ONE database, `ainext_term_labels_<pid>_<ms>`, holding only
 * `graph_nodes` (the one table the files touch) with the ten maths modules
 * as production has them, and drops that database by its exact name
 * afterwards. Without the variable every test is reported as skipped.
 *
 * @covers FR-3218
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { readMathsSeeds } from "./spine-maths-fixture.mts";

const DSN = process.env.AINEXT_SCRATCH_PG;
const skip = DSN
  ? false
  : "set AINEXT_SCRATCH_PG to a maintenance-database DSN to run against a scratch database";

const DB = `ainext_term_labels_${process.pid}_${Date.now()}`;
const NEW_LABEL = "Term 2 · Unit 4 — The Circle";
const OLD_LABEL = "Unit 4 — The Circle";

const file = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../../db/migrations/${rel}`, import.meta.url)), "utf8");
const UP = file("031-geo-u1-term-label.sql");
const DOWN = file("rollback/031-geo-u1-term-label.down.sql");

let admin: pg.Client | null = null;
let db: pg.Client | null = null;

/** The ten maths modules, with geo-u1 as production holds it today. */
async function loadModules() {
  await db!.query(`TRUNCATE graph_nodes`);
  for (const m of readMathsSeeds().nodes.filter((n) => n.kind === "module")) {
    await db!.query(`INSERT INTO graph_nodes (id, kind, label) VALUES ($1, 'module', $2)`, [
      m.id,
      m.id === "module:geo-u1" ? OLD_LABEL : m.label,
    ]);
  }
}

/** Every module's label and row version. */
async function snapshot(): Promise<Map<string, { label: string; xmin: string }>> {
  const { rows } = await db!.query(`SELECT id, label, xmin::text AS xmin FROM graph_nodes ORDER BY id`);
  return new Map(rows.map((r) => [r.id as string, { label: r.label as string, xmin: r.xmin as string }]));
}

before(async () => {
  if (!DSN) return;
  assert.match(DB, /^ainext_term_labels_\d+_\d+$/);
  admin = new pg.Client({ connectionString: DSN });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${DB}" TEMPLATE template0 ENCODING 'UTF8'`);
  const url = new URL(DSN);
  url.pathname = `/${DB}`;
  db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  await db.query(`CREATE TABLE graph_nodes (id text PRIMARY KEY, kind text NOT NULL, label text NOT NULL)`);
});

after(async () => {
  await db?.end();
  if (admin) {
    // this database, by its exact name, and nothing else
    await admin.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
    await admin.end();
  }
});

test("031 names the term on geo-u1 and touches no other module; a second run writes nothing", { skip }, async () => {
  await loadModules();
  const before0 = await snapshot();
  await db!.query(UP);
  const once = await snapshot();
  assert.equal(once.get("module:geo-u1")!.label, NEW_LABEL);
  assert.notEqual(once.get("module:geo-u1")!.xmin, before0.get("module:geo-u1")!.xmin);
  for (const [id, row] of before0) {
    if (id !== "module:geo-u1") assert.deepEqual(once.get(id), row, `${id} untouched`);
  }
  await db!.query(UP);
  await db!.query(UP);
  assert.deepEqual(await snapshot(), once, "re-runs write no row");
  // every Term 2 module now names its term
  for (const [id, row] of once) {
    if (/^module:(t2-|geo)/.test(id)) assert.ok(row.label.startsWith("Term 2 · "), id);
  }
});

test("the rollback restores the old text, a second rollback writes nothing, and 031 re-applies", { skip }, async () => {
  await loadModules();
  await db!.query(UP);
  const up = await snapshot();
  await db!.query(DOWN);
  const down = await snapshot();
  assert.equal(down.get("module:geo-u1")!.label, OLD_LABEL);
  for (const [id, row] of up) if (id !== "module:geo-u1") assert.deepEqual(down.get(id), row, id);
  await db!.query(DOWN);
  assert.deepEqual(await snapshot(), down, "a second rollback writes no row");
  await db!.query(UP);
  assert.equal((await snapshot()).get("module:geo-u1")!.label, NEW_LABEL);
});

test("a label somebody changed by hand is left alone by both files", { skip }, async () => {
  await loadModules();
  await db!.query(`UPDATE graph_nodes SET label = 'Unit 4 — Circles (edited)' WHERE id = 'module:geo-u1'`);
  const edited = await snapshot();
  await db!.query(UP);
  await db!.query(DOWN);
  assert.deepEqual(await snapshot(), edited);
});

test("a database with no curriculum yet (CI, a fresh local stack): both files succeed and do nothing", { skip }, async () => {
  await db!.query(`TRUNCATE graph_nodes`);
  await db!.query(UP);
  await db!.query(DOWN);
  assert.equal((await db!.query(`SELECT count(*)::int AS n FROM graph_nodes`)).rows[0].n, 0);
});

test("the match does not depend on the client encoding (the strings are Unicode escapes)", { skip }, async () => {
  await loadModules();
  await db!.query(`SET client_encoding TO 'LATIN1'`);
  try {
    await db!.query(UP);
  } finally {
    await db!.query(`RESET client_encoding`);
  }
  assert.equal((await snapshot()).get("module:geo-u1")!.label, NEW_LABEL);
});
