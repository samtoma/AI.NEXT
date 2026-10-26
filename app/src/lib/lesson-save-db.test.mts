/**
 * Server-side lesson saves against a REAL Postgres, with migration 042
 * applied verbatim (FR-204, issue #25).
 *
 * `lesson-resume.test.mts` proves the rules and the wiring. This proves what a
 * fake cannot, through the app's own query module as the app's own role:
 *
 *   · a save round-trips, and a second save of the same lesson replaces it
 *     (most recent wins — one row, `at` moves forward);
 *   · another student cannot read, overwrite or delete it (forced RLS);
 *   · another environment does not see it (FR-2109);
 *   · DELETE (Start over / lesson complete) removes it; deleting nothing is fine;
 *   · the migration re-runs cleanly (every deploy re-applies it).
 *
 * **Opt-in**, like `onboarding-db.test.mts`: runs only when `AINEXT_SCRATCH_PG`
 * names a maintenance-database DSN, and needs the cluster roles `ainext_app`,
 * `ainext_operator`, `ainext_maint`:
 *
 *   AINEXT_SCRATCH_PG=postgres://localhost:5432/postgres \
 *     node --import ./scripts/ts-resolver.mjs --test src/lib/lesson-save-db.test.mts
 *
 * It creates ONE database, `ainext_lessonsave_<pid>_<ms>`, and drops it by its
 * exact name afterwards.
 *
 * @covers FR-204
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

const DB = `ainext_lessonsave_${process.pid}_${Date.now()}`;

if (DSN) {
  const url = new URL(DSN);
  url.username = "ainext_app";
  url.password = "";
  url.pathname = `/${DB}`;
  process.env.DATABASE_URL = url.toString();
}

const { pool, withPrincipal } = await import("./db.ts");
const { ENVIRONMENT } = await import("./env.ts");
const { deleteLessonSave, getLessonSave, putLessonSave } = await import("./lesson-save-queries.ts");
const { SAVE_VERSION } = await import("./lesson-resume.ts");

const M042 = readFileSync(
  fileURLToPath(new URL("../../../db/migrations/042-lesson-saves.sql", import.meta.url)),
  "utf8"
);

let admin: pg.Client | null = null;
let db: pg.Client | null = null;
let A = 0;
let B = 0;

const save = (text: string, extra: Record<string, unknown> = {}) => ({
  v: SAVE_VERSION,
  sid: "sid-1",
  messages: [{ role: "assistant", text }],
  board: [],
  focusKey: null,
  covered: ["lo:u1-1-1"],
  ...extra,
});

before(async () => {
  if (!DSN) return;
  admin = new pg.Client({ connectionString: DSN });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${DB}" TEMPLATE template0`);
  const url = new URL(DSN);
  url.pathname = `/${DB}`;
  db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  await db.query(`
    CREATE TABLE students (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, display_name text);
    INSERT INTO students (display_name) VALUES ('A'), ('B');
  `);
  await db.query(M042);
  await db.query(M042); // every deploy re-applies it
  const ids = (await db.query(`SELECT id FROM students ORDER BY id`)).rows.map((r) => Number(r.id));
  [A, B] = ids;
});

after(async () => {
  await pool.end().catch(() => {});
  await db?.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
    await admin.end();
  }
});

test("a save round-trips; the next save of the same lesson replaces it (most recent wins)", { skip }, async () => {
  assert.equal(await getLessonSave(A, "learn", "u1-1"), null);
  const at1 = await putLessonSave(A, "learn", "u1-1", save("first"));
  const got1 = await getLessonSave(A, "learn", "u1-1");
  assert.ok(got1);
  assert.equal((got1.messages[0] as { text: string }).text, "first");
  assert.equal(got1.at, at1);

  // a second device saves the same lesson later
  const at2 = await putLessonSave(A, "learn", "u1-1", save("second", { endedEarly: true }));
  assert.ok(at2 >= at1);
  const got2 = await getLessonSave(A, "learn", "u1-1");
  assert.equal((got2!.messages[0] as { text: string }).text, "second");
  assert.equal(got2!.endedEarly, true);
  const n = await db!.query(`SELECT count(*)::int AS n FROM lesson_saves WHERE student_id = $1`, [A]);
  assert.equal(n.rows[0].n, 1, "one row per lesson");

  // the other mode of the same lesson is a separate place
  assert.equal(await getLessonSave(A, "review", "u1-1"), null);
});

test("another student cannot read, overwrite or delete it (forced RLS)", { skip }, async () => {
  await putLessonSave(A, "learn", "u1-2", save("A's place"));
  assert.equal(await getLessonSave(B, "learn", "u1-2"), null);
  await deleteLessonSave(B, "learn", "u1-2");
  assert.ok(await getLessonSave(A, "learn", "u1-2"), "B's delete touched nothing");

  // Even bypassing the query module's WHERE, B's principal sees no rows and cannot write A's.
  await withPrincipal(B, async (c) => {
    const r = await c.query(`SELECT count(*)::int AS n FROM lesson_saves`);
    assert.equal(r.rows[0].n, 0);
    await assert.rejects(
      c.query(
        `INSERT INTO lesson_saves (student_id, environment, mode, lesson_slug, payload_version, payload)
         VALUES ($1, $2, 'learn', 'u9-9', 1, '{}'::jsonb)`,
        [A, ENVIRONMENT]
      ),
      { code: "42501" }
    );
  });
  // and with no principal, nothing at all
  const none = await pool.query(`SELECT count(*)::int AS n FROM lesson_saves`);
  assert.equal(none.rows[0].n, 0);
});

test("another environment does not see it", { skip }, async () => {
  await putLessonSave(A, "learn", "u2-1", save("here"));
  await db!.query(`UPDATE lesson_saves SET environment = 'elsewhere' WHERE student_id = $1 AND lesson_slug = 'u2-1'`, [A]);
  assert.equal(await getLessonSave(A, "learn", "u2-1"), null);
});

test("Start over / completing the lesson deletes the place; deleting nothing is fine", { skip }, async () => {
  await putLessonSave(A, "review", "u3-1", save("to go"));
  await deleteLessonSave(A, "review", "u3-1");
  assert.equal(await getLessonSave(A, "review", "u3-1"), null);
  await deleteLessonSave(A, "review", "u3-1");
});

test("the table refuses a bad slug or mode even past the route", { skip }, async () => {
  await assert.rejects(putLessonSave(A, "learn", "../x", save("x")), { code: "23514" });
  await assert.rejects(
    putLessonSave(A, "homework" as "learn", "u1-1", save("x")),
    { code: "23514" }
  );
});
