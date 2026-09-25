/**
 * Migration 032 and its rollback against a real Postgres, run as shipped: the
 * three sign-flipped answer keys are corrected, nothing else is touched, and a
 * second run of either file writes nothing at all.
 *
 * "Writes nothing" is checked on each row's `xmin` — the id of the transaction
 * that last wrote it. An UPDATE that wrote the value a row already had would
 * still make a new row version and move `xmin`; an unchanged `xmin` means no
 * row was touched, so no row lock was taken (FR-3213).
 *
 * **Opt-in**, like `term-labels-db.test.mts`: it runs only when
 * `AINEXT_SCRATCH_PG` names a maintenance-database DSN, as a role with
 * CREATEDB:
 *
 *   AINEXT_SCRATCH_PG=postgres://localhost:5432/postgres \
 *     node --import ./scripts/ts-resolver.mjs --test src/lib/widget-excluded-values-db.test.mts
 *
 * It creates ONE database, `ainext_widget_sign_<pid>_<ms>`, holding only
 * `questions (id, choices)` — the one table and column the files touch — with
 * the 48 stored widget rows as production holds them (the three at their
 * pre-032 values), and drops that database by its exact name afterwards.
 * Without the variable every test is reported as skipped.
 *
 * @covers FR-1207, FR-3213
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

const DSN = process.env.AINEXT_SCRATCH_PG;
const skip = DSN
  ? false
  : "set AINEXT_SCRATCH_PG to a maintenance-database DSN to run against a scratch database";

const DB = `ainext_widget_sign_${process.pid}_${Date.now()}`;
const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), "utf8");
const UP = read("db/migrations/032-widget-excluded-values-sign.sql");
const DOWN = read("db/migrations/rollback/032-widget-excluded-values-sign.down.sql");

type Choices = { kind: string; spec: Record<string, unknown>; diagnostics: { predicate: string; misconception_id: string }[] };
const bank: { id: string; choices: Choices }[] = JSON.parse(
  read("services/extraction/seed/generated/widget-questions.json")
).questions;

const FIXED = ["q:t2u2-2-1:w001", "q:t2u2-2-1:w002", "q:t2u2-2-1:w003"];
const seedChoices = new Map(bank.map((q) => [q.id, q.choices]));

/** A row as v0.9.2 left it: the negatives as the key, the omission as the only diagnosis. */
function preFix(c: Choices): Choices {
  const targets = (c.spec.targets as number[]).map((v) => -v).sort((a, b) => a - b);
  return {
    ...c,
    spec: { ...c.spec, targets },
    diagnostics: c.diagnostics.filter((d) => d.predicate !== "sign-flipped"),
  };
}
const productionChoices = new Map(
  bank.map((q) => [q.id, FIXED.includes(q.id) ? preFix(q.choices) : q.choices])
);

let admin: pg.Client | null = null;
let db: pg.Client | null = null;

/** The stored bank as production holds it, plus a decoy outside the three ids. */
async function load() {
  await db!.query(`TRUNCATE questions`);
  for (const [id, c] of productionChoices) {
    await db!.query(`INSERT INTO questions (id, choices) VALUES ($1, $2)`, [id, JSON.stringify(c)]);
  }
  // Same wrong key, different id: 032 is scoped by id, so this must not move.
  await db!.query(`INSERT INTO questions (id, choices) VALUES ('q:decoy:w001', $1)`, [
    JSON.stringify(productionChoices.get("q:t2u2-2-1:w001")),
  ]);
}

async function snapshot(): Promise<Map<string, { choices: Choices; xmin: string }>> {
  const { rows } = await db!.query(`SELECT id, choices, xmin::text AS xmin FROM questions ORDER BY id`);
  return new Map(rows.map((r) => [r.id as string, { choices: r.choices as Choices, xmin: r.xmin as string }]));
}

before(async () => {
  if (!DSN) return;
  assert.match(DB, /^ainext_widget_sign_\d+_\d+$/);
  admin = new pg.Client({ connectionString: DSN });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${DB}" TEMPLATE template0 ENCODING 'UTF8'`);
  const url = new URL(DSN);
  url.pathname = `/${DB}`;
  db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  await db.query(`CREATE TABLE questions (id text PRIMARY KEY, choices jsonb)`);
});

after(async () => {
  await db?.end();
  if (admin) {
    // this database, by its exact name, and nothing else
    await admin.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
    await admin.end();
  }
});

test("032 writes the seed's choices to the three rows and touches nothing else; re-runs write nothing", { skip }, async () => {
  await load();
  const before0 = await snapshot();
  await db!.query(UP);
  const once = await snapshot();
  for (const id of FIXED) {
    assert.deepEqual(once.get(id)!.choices, seedChoices.get(id), `${id} now holds the seed's key and diagnostics`);
    assert.notEqual(once.get(id)!.xmin, before0.get(id)!.xmin);
  }
  for (const [id, row] of before0) {
    if (!FIXED.includes(id)) assert.deepEqual(once.get(id), row, `${id} untouched`);
  }
  await db!.query(UP);
  await db!.query(UP);
  assert.deepEqual(await snapshot(), once, "re-runs write no row");
});

test("the rollback restores exactly the pre-032 rows, a second rollback writes nothing, and 032 re-applies", { skip }, async () => {
  await load();
  const pre = await snapshot();
  await db!.query(UP);
  await db!.query(DOWN);
  const down = await snapshot();
  for (const [id, row] of pre) assert.deepEqual(down.get(id)!.choices, row.choices, `${id} as before 032`);
  await db!.query(DOWN);
  assert.deepEqual(await snapshot(), down, "a second rollback writes no row");
  await db!.query(UP);
  for (const id of FIXED) assert.deepEqual((await snapshot()).get(id)!.choices, seedChoices.get(id));
});

test("a row corrected by hand is left alone; a hand-made sign-flipped mapping is kept, not doubled", { skip }, async () => {
  await load();
  // w001 corrected by hand (targets only); w002 wrong key but an operator mapped sign-flipped already
  const w001 = { ...productionChoices.get("q:t2u2-2-1:w001")!, spec: seedChoices.get("q:t2u2-2-1:w001")!.spec };
  const own = { predicate: "sign-flipped", misconception_id: "mc:t2u1-2-1:roots-read-from-coefficients" };
  const w002pre = productionChoices.get("q:t2u2-2-1:w002")!;
  const w002 = { ...w002pre, diagnostics: [...w002pre.diagnostics, own] };
  await db!.query(`UPDATE questions SET choices = $2 WHERE id = $1`, ["q:t2u2-2-1:w001", JSON.stringify(w001)]);
  await db!.query(`UPDATE questions SET choices = $2 WHERE id = $1`, ["q:t2u2-2-1:w002", JSON.stringify(w002)]);
  const edited = await snapshot();
  await db!.query(UP);
  const after032 = await snapshot();
  assert.deepEqual(after032.get("q:t2u2-2-1:w001"), edited.get("q:t2u2-2-1:w001"), "hand-corrected row: no write");
  const c = after032.get("q:t2u2-2-1:w002")!.choices;
  assert.deepEqual(c.spec, seedChoices.get("q:t2u2-2-1:w002")!.spec, "the key is still corrected");
  assert.deepEqual(c.diagnostics, w002.diagnostics, "the operator's mapping kept, none added");
  // and the rollback removes only the exact entry 032 adds, so the operator's stays
  await db!.query(DOWN);
  assert.deepEqual((await snapshot()).get("q:t2u2-2-1:w002")!.choices.diagnostics, w002.diagnostics);
});

test("a database with no questions yet (CI, a fresh local stack): both files succeed and do nothing", { skip }, async () => {
  await db!.query(`TRUNCATE questions`);
  await db!.query(UP);
  await db!.query(DOWN);
  assert.equal((await db!.query(`SELECT count(*)::int AS n FROM questions`)).rows[0].n, 0);
});
