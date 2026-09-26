/**
 * The first-Google-sign-in step against a REAL Postgres, with migration 033
 * applied verbatim (feature 003, WP-D; FR-4014, FR-4017, FR-4005).
 *
 * `onboarding.test.mts` proves the decisions and the wiring. This proves the
 * part a fake cannot: that "once" is the DATABASE's promise, reached through
 * the app's own code paths as the app's own role —
 *
 *   · a first Google sign-in (`upsertGoogleAccount`, run as `ainext_app`)
 *     creates the student pending, and the app role cannot clear the flag or
 *     write a curriculum itself (FR-4017);
 *   · `completeOnboarding` sets grade and curriculum by the FR-4005 rule —
 *     implied when the grade offers one, chosen when it offers two and the
 *     student picked, `curriculum_required` (nothing written) when she did not;
 *   · a second submission is `already_completed` and changes nothing, and the
 *     route answers it 409 (`onboardingAnswer`), never 204;
 *   · an account that never owed the step (a password sign-up) cannot use it;
 *   · two submissions racing each other write ONCE.
 *
 * **Opt-in**, like `curriculum-scope-db.test.mts`: it runs only when
 * `AINEXT_SCRATCH_PG` names a maintenance-database DSN (a superuser or a role
 * with CREATEDB that may also `ALTER FUNCTION … OWNER TO ainext_maint`), and it
 * needs the three cluster roles every local database already has
 * (`ainext_app`, `ainext_operator`, `ainext_maint`), with `ainext_app` able to
 * connect the way the app's default DSN does:
 *
 *   AINEXT_SCRATCH_PG=postgres://localhost:5432/postgres \
 *     node --import ./scripts/ts-resolver.mjs --test src/lib/onboarding-db.test.mts
 *
 * It creates ONE database, `ainext_onboarding_<pid>_<ms>`, builds only the
 * tables the step touches with migration 017's grants and `students` policies,
 * applies `db/migrations/033-curriculum-tracks.sql` as written, connects the
 * app's pool to it AS `ainext_app`, and drops that database by its exact name
 * afterwards. It never touches any other database. The course gate is ON.
 *
 * @covers FR-4014, FR-4017, FR-4005
 */
process.env.AINEXT_COURSE_GATING = "on";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

const DSN = process.env.AINEXT_SCRATCH_PG;
const skip = DSN
  ? false
  : "set AINEXT_SCRATCH_PG to a maintenance-database DSN to run against a scratch database";

const DB = `ainext_onboarding_${process.pid}_${Date.now()}`;

// The app's pool must reach the scratch database as the RESTRICTED role, so
// every write below is one the student surface can really make. Set before
// `lib/db.ts` is imported: it builds its pool from DATABASE_URL at load.
if (DSN) {
  const url = new URL(DSN);
  url.username = "ainext_app";
  url.password = "";
  url.pathname = `/${DB}`;
  process.env.DATABASE_URL = url.toString();
}

const { pool } = await import("./db.ts");
const { COURSE_GATING, ENVIRONMENT } = await import("./env.ts");
const { completeOnboarding } = await import("./curriculum-queries.ts");
const { upsertGoogleAccount } = await import("./auth/google.ts");
const { onboardingAnswer } = await import("./auth/onboarding.ts");
const { PREP3_MATH_EN, US_G10_MATH_EN } = await import("./courses.ts");

const M033 = readFileSync(
  fileURLToPath(new URL("../../../db/migrations/033-curriculum-tracks.sql", import.meta.url)),
  "utf8"
);

const NATIONAL = "eg-national-en";
const AMERICAN = "us-american-en";

let admin: pg.Client | null = null;
let db: pg.Client | null = null;

type Row = { grade: string; curriculum_system: string; curriculum_source: string; onboarding_pending: boolean };

async function row(id: number): Promise<Row> {
  const r = await db!.query(
    `SELECT grade, curriculum_system, curriculum_source, onboarding_pending FROM students WHERE id = $1`,
    [id]
  );
  return r.rows[0] as Row;
}

/** A first Google sign-in, exactly as the callback runs it: one transaction on the app pool, no principal. */
async function googleSignIn(email: string, sub: string): Promise<{ studentId: number; pending: boolean; created: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await upsertGoogleAccount(
      client as unknown as Parameters<typeof upsertGoogleAccount>[0],
      { sub, email, emailVerified: true, name: "Scratch Student" },
      ENVIRONMENT,
      async () => {}
    );
    await client.query("COMMIT");
    assert.ok(out.kind === "ok");
    return { studentId: out.studentId, pending: out.onboardingPending, created: out.created };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function setRules(rules: [string, string][]): Promise<void> {
  await db!.query(`DELETE FROM course_availability`);
  for (const [course, grade] of rules) {
    await db!.query(`INSERT INTO course_availability VALUES ($1, $2, $3, 'live')`, [ENVIRONMENT, course, grade]);
  }
}

/** Launch: grade 9 National, grade 10 American only (decision 6). */
const LAUNCH: [string, string][] = [
  [PREP3_MATH_EN, "9"],
  [US_G10_MATH_EN, "10"],
];

before(async () => {
  if (!DSN) return;
  assert.equal(COURSE_GATING, true, "this file runs with the gate ON");
  assert.match(DB, /^ainext_onboarding_\d+_\d+$/);
  admin = new pg.Client({ connectionString: DSN });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${DB}" TEMPLATE template0`);
  const url = new URL(DSN);
  url.pathname = `/${DB}`;
  db = new pg.Client({ connectionString: url.toString() });
  await db.connect();

  // Only what the step touches, with 017's grants and `students` policies.
  await db.query(`
    CREATE TABLE operators (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, display_name text);
    CREATE TABLE accounts (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, email text NOT NULL UNIQUE,
      password_hash text, google_sub text, email_verified_at timestamptz,
      environment text NOT NULL, status text NOT NULL DEFAULT 'active'
    );
    CREATE TABLE students (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, display_name text, grade text NOT NULL,
      interests text[], account_id bigint REFERENCES accounts(id), status text, gender text,
      environment text NOT NULL, curriculum_system text NOT NULL DEFAULT 'eg-national-en',
      design_variant text, subscription_status text
    );
    CREATE TABLE course_availability (environment text, course_id text, grade text, state text);
    CREATE TABLE graph_nodes (id text PRIMARY KEY, kind text NOT NULL);

    GRANT SELECT, INSERT, UPDATE ON students TO ainext_app;
    GRANT SELECT, INSERT, UPDATE ON accounts TO ainext_app;
    GRANT SELECT ON course_availability, graph_nodes TO ainext_app;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ainext_app;
    GRANT ALL PRIVILEGES ON students, accounts TO ainext_maint;

    ALTER TABLE students ENABLE ROW LEVEL SECURITY;
    ALTER TABLE students FORCE ROW LEVEL SECURITY;
    CREATE POLICY students_app_select ON students FOR SELECT TO ainext_app
      USING (id = nullif(current_setting('app.student_id', true), '')::bigint
             OR (nullif(current_setting('app.student_id', true), '') IS NULL AND account_id IS NOT NULL));
    CREATE POLICY students_app_insert ON students FOR INSERT TO ainext_app
      WITH CHECK (nullif(current_setting('app.student_id', true), '') IS NULL);
    CREATE POLICY students_app_update ON students FOR UPDATE TO ainext_app
      USING (id = nullif(current_setting('app.student_id', true), '')::bigint)
      WITH CHECK (id = nullif(current_setting('app.student_id', true), '')::bigint);
  `);

  // The migration itself, as written — its own verification block runs too.
  await db.query(M033);
  await setRules(LAUNCH);
});

after(async () => {
  await pool.end().catch(() => {});
  await db?.end();
  if (admin) {
    // Only this file's database, by its exact name.
    await admin.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
    await admin.end();
  }
});

test("a first Google sign-in is created pending, and the app role cannot clear it or write a curriculum", { skip }, async () => {
  const g = await googleSignIn("first@example.com", "g-first");
  assert.equal(g.created, true);
  assert.equal(g.pending, true);
  assert.deepEqual(await row(g.studentId), {
    grade: "9",
    curriculum_system: NATIONAL,
    curriculum_source: "implied",
    onboarding_pending: true,
  });

  // As the student herself, the direct write is refused by privilege (FR-4017).
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.student_id', $1, true)", [String(g.studentId)]);
    for (const set of ["onboarding_pending = false", `curriculum_system = '${AMERICAN}'`, "curriculum_source = 'chosen'"]) {
      await client.query("SAVEPOINT s");
      await assert.rejects(client.query(`UPDATE students SET ${set} WHERE id = $1`, [g.studentId]), { code: "42501" }, set);
      await client.query("ROLLBACK TO SAVEPOINT s");
    }
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }

  // A returning sign-in before the step is done: the same row, still pending.
  const back = await googleSignIn("first@example.com", "g-first");
  assert.equal(back.created, false);
  assert.equal(back.studentId, g.studentId);
  assert.equal(back.pending, true);
});

test("the step works once: grade 10 offering one curriculum stores it implied; a second submission is 409 and changes nothing", { skip }, async () => {
  const g = await googleSignIn("once@example.com", "g-once");

  const first = await completeOnboarding(g.studentId, { grade: "10" });
  assert.deepEqual(first, { ok: true, grade: "10", curriculum: AMERICAN, source: "implied", resolvedFrom: null });
  assert.equal(onboardingAnswer(first).status, 204);
  const done = { grade: "10", curriculum_system: AMERICAN, curriculum_source: "implied", onboarding_pending: false };
  assert.deepEqual(await row(g.studentId), done);

  // The step is never a student-side way to change a curriculum (decision 4).
  const second = await completeOnboarding(g.studentId, { grade: "9" });
  assert.deepEqual(second, { ok: false, reason: "already_completed" });
  assert.deepEqual(onboardingAnswer(second), { status: 409, body: { error: "onboarding_already_completed" } });
  assert.deepEqual(await row(g.studentId), done, "nothing changed");

  // A returning Google sign-in after the step is unaffected: not pending.
  const back = await googleSignIn("once@example.com", "g-once");
  assert.equal(back.pending, false);
  assert.equal(back.created, false);
});

test("an account that never owed the step — a password sign-up — cannot use it", { skip }, async () => {
  // Sign-up's own INSERT, as the app role: the curriculum is set on creation (FR-4017's first path).
  const acct = await db!.query(
    `INSERT INTO accounts (email, password_hash, environment) VALUES ('pw@example.com', 'x', $1) RETURNING id`,
    [ENVIRONMENT]
  );
  const client = await pool.connect();
  let id: number;
  try {
    const r = await client.query(
      `INSERT INTO students (display_name, grade, account_id, status, environment, curriculum_system, curriculum_source)
       VALUES ('Password', '9', $1, 'active', $2, $3, 'implied') RETURNING id`,
      [acct.rows[0].id, ENVIRONMENT, NATIONAL]
    );
    id = Number(r.rows[0].id);
  } finally {
    client.release();
  }
  const before = await row(id);
  assert.equal(before.onboarding_pending, false);
  const attempt = await completeOnboarding(id, { grade: "10" });
  assert.deepEqual(attempt, { ok: false, reason: "already_completed" });
  assert.deepEqual(await row(id), before);
});

test("a grade offering two curricula: no pick is curriculum_required and writes nothing; a pick is stored chosen", { skip }, async () => {
  await setRules([...LAUNCH, [PREP3_MATH_EN, "10"]]);
  try {
    const g = await googleSignIn("two@example.com", "g-two");

    const none = await completeOnboarding(g.studentId, { grade: "10" });
    assert.deepEqual(none, { ok: false, reason: "curriculum_required", offered: [NATIONAL, AMERICAN] });
    assert.equal(onboardingAnswer(none).status, 409);
    assert.equal((await row(g.studentId)).onboarding_pending, true, "still owed: nothing was written");

    const unknown = await completeOnboarding(g.studentId, { grade: "10", curriculum: "british-igcse" });
    assert.equal(!unknown.ok && unknown.reason, "invalid_curriculum");
    assert.equal(onboardingAnswer(unknown).status, 422);

    const picked = await completeOnboarding(g.studentId, { grade: "10", curriculum: AMERICAN });
    assert.deepEqual(picked, { ok: true, grade: "10", curriculum: AMERICAN, source: "chosen", resolvedFrom: null });
    assert.deepEqual(await row(g.studentId), {
      grade: "10",
      curriculum_system: AMERICAN,
      curriculum_source: "chosen",
      onboarding_pending: false,
    });
  } finally {
    await setRules(LAUNCH);
  }
});

test("two submissions racing each other write once — the loser is already_completed", { skip }, async () => {
  const g = await googleSignIn("race@example.com", "g-race");
  const results = await Promise.all([
    completeOnboarding(g.studentId, { grade: "10" }),
    completeOnboarding(g.studentId, { grade: "9" }),
  ]);
  const won = results.filter((r) => r.ok);
  const lost = results.filter((r) => !r.ok);
  assert.equal(won.length, 1, "exactly one submission wrote");
  assert.deepEqual(lost, [{ ok: false, reason: "already_completed" }]);
  const winner = won[0];
  assert.ok(winner.ok);
  const stored = await row(g.studentId);
  assert.equal(stored.grade, winner.grade);
  assert.equal(stored.curriculum_system, winner.curriculum);
  assert.equal(stored.onboarding_pending, false);
});
