/**
 * The console's curriculum reads and write against a REAL Postgres (feature
 * 003; contracts/console.md; SC-209's console half; tasks T377, T380, T381).
 *
 *   · **A curriculum change loses nothing** (FR-4011, FR-4012): an operator
 *     changes a student's curriculum and changes it back. Her mastery, answers
 *     and saved place in both courses are byte-for-byte what they were, and
 *     the history holds two rows, newest first, each naming the operator.
 *     Setting the curriculum she already has writes nothing.
 *   · **The headcount is what FR-4103 says it is**: students of that grade and
 *     curriculum with no live exception, this environment only, legacy
 *     records out — as counts.
 *   · **The Overview never pools two maths courses** (FR-4104): each course is
 *     its own cohort; its attempts, mastery and heatmap are its own objectives'
 *     only, over its own curriculum's students.
 *   · **`/pipeline` counts one course** (FR-4104), and names its own book.
 *   · **The students list**: the cost projection's SQL runs without the
 *     curriculum columns (privacy review F7), the full one with them.
 *
 * **Opt-in**, like `curriculum-scope-db.test.mts`: it runs only when
 * `AINEXT_SCRATCH_PG` names a maintenance-database DSN (a role with CREATEDB):
 *
 *   AINEXT_SCRATCH_PG=postgres://localhost:5432/postgres \
 *     node --import ./scripts/ts-resolver.mjs --test src/lib/console-curriculum-db.test.mts
 *
 * It creates ONE database, `ainext_console_curriculum_<pid>_<ms>`, builds only
 * the tables these readers touch (the history table, the `node_subject` view
 * and the book-section store are taken verbatim from migrations 033, 007 and
 * 034), and drops that
 * database by its exact name afterwards. It never touches any other database.
 * Privileges are not what it proves — it runs as the DSN's own role; migration
 * 033's own verification block and `scripts/ci-migrations.sh` prove those.
 *
 *   · **Per lesson** (FR-4319): the Overview's lesson rows are the cohort's
 *     own counts, and add up to the course's.
 *
 * @covers FR-4011, FR-4012, FR-4103, FR-4104, FR-4319
 */
process.env.AINEXT_COURSE_GATING = "on";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";
import type { PoolClient } from "pg";

const { ENVIRONMENT } = await import("./env.ts");
const { PREP3_MATH_EN, US_G10_MATH_EN } = await import("./courses.ts");
const { getStudentList, lastLiveCourseHeadcount, curriculumProjection } = await import(
  "./console-queries.ts"
);
const { setStudentCurriculum, studentCurriculum } = await import("./curriculum-queries.ts");
const { getOverview } = await import("./overview-queries.ts");
const { getPipelineDataForOperator } = await import("./pipeline-queries.ts");
const { addContentFigures, bookSections, contentByLesson, getContentAdminView, rollUpBySection, scopeContentView, sectionChecks } =
  await import("./content-admin.ts");

const DSN = process.env.AINEXT_SCRATCH_PG;
const skip = DSN
  ? false
  : "set AINEXT_SCRATCH_PG to a maintenance-database DSN to run against a scratch database";

const DB = `ainext_console_curriculum_${process.pid}_${Date.now()}`;
const OTHER_ENV = ENVIRONMENT === "mvp1" ? "baseline" : "mvp1";

let admin: pg.Client | null = null;
let db: pg.Client | null = null;

const asClient = (): PoolClient =>
  ({ query: (t: string, v?: unknown[]) => db!.query(t, v), release() {} }) as unknown as PoolClient;

/** A statement cut verbatim out of a migration, so this schema cannot drift from it. */
function fromMigration(file: string, pattern: RegExp): string {
  const sql = readFileSync(
    fileURLToPath(new URL(`../../../db/migrations/${file}`, import.meta.url)),
    "utf8"
  );
  const m = sql.match(pattern);
  assert.ok(m, `${file} defines ${pattern}`);
  return m[0];
}

// The fixture: two maths courses, one per curriculum, two objectives each.
const P_LOS = ["lo:u1-1-1", "lo:u1-1-2"];
const G_LOS = ["lo:g10m1s1-1-1", "lo:g10m1s1-1-2"];

// Students. N9 and T are National grade 9 (T holds an exception for the G10
// course); A10 and A10x are American grade 10 (A10x holds a live exception);
// N10 is a National grade-10 student (nothing live for her); OLD is a legacy
// National grade-9 record; P3 stores the legacy `prep-3` spelling; ELSE is
// another environment's student; ODD has a curriculum the registry does not know.
const N9 = 1, T = 2, A10 = 3, A10X = 4, N10 = 5, OLD = 6, P3 = 7, ELSE = 8, ODD = 9;
const OPERATOR = 42;

before(async () => {
  if (!DSN) return;
  assert.match(DB, /^ainext_console_curriculum_\d+_\d+$/);
  admin = new pg.Client({ connectionString: DSN });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${DB}" TEMPLATE template0`);
  const url = new URL(DSN);
  url.pathname = `/${DB}`;
  db = new pg.Client({ connectionString: url.toString() });
  await db.connect();

  await db.query(`
    CREATE TABLE source_documents (
      sha256 text PRIMARY KEY, title text NOT NULL, publisher text NOT NULL, edition text,
      language text NOT NULL DEFAULT 'en', grade text NOT NULL, subject text NOT NULL,
      file_path text, ingested_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE extraction_runs (
      id bigint PRIMARY KEY, extractor text, extractor_version text, schema_version text,
      finished_at timestamptz, source_sha256 text
    );
    CREATE TABLE graph_nodes (
      id text PRIMARY KEY, kind text NOT NULL, label text NOT NULL, description text,
      syllabus_ref text, order_in_parent int, source_page int, subject text, source_sha256 text
    );
    CREATE TABLE graph_edges (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      src_id text NOT NULL, dst_id text NOT NULL, edge_type text NOT NULL,
      syllabus_version text NOT NULL DEFAULT '2025-2026', system_to timestamptz
    );
    CREATE TABLE questions (
      id text PRIMARY KEY, lo_id text NOT NULL, tier text, question_type text, stem text,
      choices jsonb, correct_answer text, canonical_solution jsonb, source_page int,
      source_note text, reviewed_by text, reviewed_at timestamptz, status text NOT NULL,
      source text NOT NULL DEFAULT 'seed', parent_question_id text, extraction_run_id bigint
    );
    CREATE TABLE operators (id bigint PRIMARY KEY, display_name text, email text);
    CREATE TABLE accounts (
      id bigint PRIMARY KEY, status text, email_verified_at timestamptz, last_login_at timestamptz
    );
    CREATE TABLE students (
      id bigint PRIMARY KEY, environment text NOT NULL, display_name text, grade text,
      gender text, status text, subscription_status text NOT NULL DEFAULT 'none',
      account_id bigint, curriculum_system text NOT NULL DEFAULT 'eg-national-en',
      curriculum_source text NOT NULL DEFAULT 'implied',
      onboarding_pending boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE sessions (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, student_id bigint, environment text,
      opened_at timestamptz, closed_at timestamptz, last_seen_at timestamptz
    );
    CREATE TABLE attempts (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, student_id bigint NOT NULL,
      question_id text NOT NULL, environment text NOT NULL, is_correct boolean,
      attempted_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE mastery (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, student_id bigint NOT NULL,
      lo_id text NOT NULL, environment text NOT NULL, score numeric NOT NULL,
      system_from timestamptz NOT NULL DEFAULT now(), system_to timestamptz
    );
    CREATE TABLE student_progress (
      student_id bigint NOT NULL, course_id text NOT NULL, lesson_slug text NOT NULL,
      environment text NOT NULL, PRIMARY KEY (student_id, course_id)
    );
    CREATE TABLE cost_daily (environment text, student_id bigint, cost_usd numeric, day date);
    CREATE TABLE ai_interactions (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, environment text, student_id bigint,
      cost_usd numeric, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE course_availability (environment text, course_id text, grade text, state text);
    CREATE TABLE student_course_access (environment text, student_id bigint, course_id text, state text);
  `);
  await db.query(fromMigration("007-course-subject-column.sql", /CREATE OR REPLACE VIEW node_subject AS[\s\S]*?;/));
  await db.query(
    fromMigration("033-curriculum-tracks.sql", /CREATE TABLE IF NOT EXISTS student_curriculum_changes \([\s\S]*?\n\);/)
  );
  await db.query(fromMigration("034-book-sections.sql", /CREATE TABLE IF NOT EXISTS course_lessons \([\s\S]*?\n\);/));

  // two books, two courses, one module each, two objectives each, one live question each
  await db.query(`
    INSERT INTO source_documents (sha256, title, publisher, grade, subject) VALUES
      ('sha-p3', 'Prep 3 maths (fixture)', 'fixture', 'prep-3', 'mathematics'),
      ('sha-g10', 'Grade 10 maths (fixture)', 'fixture', '10', 'mathematics');
    INSERT INTO extraction_runs VALUES
      (1, 'p3-extractor', '1', '1', now(), 'sha-p3'),
      (2, 'g10-extractor', '1', '2', now(), 'sha-g10');
    INSERT INTO graph_nodes (id, kind, label, order_in_parent, subject, source_sha256) VALUES
      ('${PREP3_MATH_EN}', 'course', 'Mathematics — Prep 3', NULL, 'math', 'sha-p3'),
      ('${US_G10_MATH_EN}', 'course', 'Mathematics — Grade 10', NULL, 'math', 'sha-g10'),
      ('module:u1', 'module', 'Unit 1', 1, NULL, NULL),
      ('module:g10m-c01', 'module', 'Chapter 1', 1, NULL, NULL),
      ('${P_LOS[0]}', 'learning_objective', 'P3 one', 1, NULL, NULL),
      ('${P_LOS[1]}', 'learning_objective', 'P3 two', 2, NULL, NULL),
      ('${G_LOS[0]}', 'learning_objective', 'G10 one', 1, NULL, NULL),
      ('${G_LOS[1]}', 'learning_objective', 'G10 two', 2, NULL, NULL);
    INSERT INTO graph_edges (src_id, dst_id, edge_type) VALUES
      ('module:u1', '${PREP3_MATH_EN}', 'part_of'),
      ('module:g10m-c01', '${US_G10_MATH_EN}', 'part_of'),
      ('module:u1', '${P_LOS[0]}', 'teaches'),
      ('module:u1', '${P_LOS[1]}', 'teaches'),
      ('module:g10m-c01', '${G_LOS[0]}', 'teaches'),
      ('module:g10m-c01', '${G_LOS[1]}', 'teaches'),
      ('${P_LOS[0]}', '${P_LOS[1]}', 'prerequisite_of'),
      ('${G_LOS[0]}', '${G_LOS[1]}', 'prerequisite_of');
  `);
  for (const lo of [...P_LOS, ...G_LOS]) {
    await db.query(
      `INSERT INTO questions (id, lo_id, tier, question_type, stem, status, reviewed_by)
       VALUES ($1, $2, 'basic', 'mcq', 'stem', 'live', $3)`,
      [`q:${lo.slice(3)}:001`, lo, lo.startsWith("lo:g10") ? null : "reviewer"]
    );
  }
  await db.query(`INSERT INTO operators VALUES (${OPERATOR}, 'Samuel', 'op@example.test')`);
  // the Grade 10 lesson's book provenance (034): printed section 1.1
  await db.query(
    `INSERT INTO course_lessons (course_id, lesson_slug, title, sections, section_titles, group_key)
     VALUES ($1, 'g10m1s1-1', 'The real number system', '{1.1}', '{"The real number system"}', '1.1')`,
    [US_G10_MATH_EN]
  );

  const students: [number, string, string, string, string | null][] = [
    [N9, ENVIRONMENT, "9", "eg-national-en", "active"],
    [T, ENVIRONMENT, "9", "eg-national-en", "active"],
    [A10, ENVIRONMENT, "10", "us-american-en", "active"],
    [A10X, ENVIRONMENT, "10", "us-american-en", "active"],
    [N10, ENVIRONMENT, "10", "eg-national-en", "active"],
    [OLD, ENVIRONMENT, "9", "eg-national-en", "legacy"],
    [P3, ENVIRONMENT, "prep-3", "eg-national-en", null],
    [ELSE, OTHER_ENV, "10", "us-american-en", "active"],
    [ODD, ENVIRONMENT, "10", "american", "active"],
  ];
  for (const [id, env, grade, curriculum, status] of students) {
    await db.query(
      `INSERT INTO students (id, environment, display_name, grade, gender, status, curriculum_system)
       VALUES ($1, $2, $3, $4, 'f', $5, $6)`,
      [id, env, `Student ${id}`, grade, status, curriculum]
    );
  }
  await db.query(
    `INSERT INTO course_availability VALUES ($1, $2, '9', 'live'), ($1, $3, '10', 'live')`,
    [ENVIRONMENT, PREP3_MATH_EN, US_G10_MATH_EN]
  );
  await db.query(
    `INSERT INTO student_course_access VALUES ($1, ${T}, $2, 'live'), ($1, ${A10X}, $3, 'live')`,
    [ENVIRONMENT, US_G10_MATH_EN, PREP3_MATH_EN]
  );

  // Activity. N9: 3 answers on Prep-3 maths (2 right). A10: 4 on Grade 10
  // (1 right). T, a National tester, 2 on Grade 10 by her exception — which
  // must count in NEITHER course's cohort figures below.
  const answer = async (student: number, lo: string, right: boolean) =>
    db!.query(
      `INSERT INTO attempts (student_id, question_id, environment, is_correct) VALUES ($1, $2, $3, $4)`,
      [student, `q:${lo.slice(3)}:001`, ENVIRONMENT, right]
    );
  await answer(N9, P_LOS[0], true);
  await answer(N9, P_LOS[0], true);
  await answer(N9, P_LOS[1], false);
  for (const right of [true, false, false, false]) await answer(A10, G_LOS[0], right);
  await answer(T, G_LOS[0], true);
  await answer(T, G_LOS[1], true);
  await db.query(
    `INSERT INTO mastery (student_id, lo_id, environment, score) VALUES
       (${N9}, '${P_LOS[0]}', $1, 0.9), (${A10}, '${G_LOS[0]}', $1, 0.8),
       (${T}, '${G_LOS[0]}', $1, 0.95), (${T}, '${P_LOS[0]}', $1, 0.4)`,
    [ENVIRONMENT]
  );
  await db.query(
    `INSERT INTO student_progress VALUES
       (${T}, '${PREP3_MATH_EN}', 'u1-1', $1), (${T}, '${US_G10_MATH_EN}', 'g10m1s1-1', $1)`,
    [ENVIRONMENT]
  );

  (globalThis as unknown as { pgOperatorPool: unknown }).pgOperatorPool = {
    connect: async () => asClient(),
  };
});

after(async () => {
  await db?.end();
  if (admin) {
    // this database, by its exact name, and nothing else
    await admin.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
    await admin.end();
  }
});

/** Everything a student has earned, as rows — what a curriculum change must not touch. */
async function progressOf(student: number) {
  const q = async (sql: string) => (await db!.query(sql, [student])).rows;
  return {
    mastery: await q(`SELECT * FROM mastery WHERE student_id = $1 ORDER BY id`),
    attempts: await q(`SELECT * FROM attempts WHERE student_id = $1 ORDER BY id`),
    places: await q(`SELECT * FROM student_progress WHERE student_id = $1 ORDER BY course_id`),
    exceptions: await q(`SELECT * FROM student_course_access WHERE student_id = $1 ORDER BY course_id`),
  };
}

test("a change and back loses nothing, and both are on the record (FR-4011, FR-4012)", { skip }, async () => {
  const before = await progressOf(T);
  const toAmerican = await setStudentCurriculum(OPERATOR, T, "us-american-en", "school confirmed");
  assert.deepEqual(toAmerican, { ok: true, changed: true, from: "eg-national-en", to: "us-american-en" });
  assert.deepEqual(await progressOf(T), before, "nothing earned was deleted, copied or moved");
  const projection = await curriculumProjection(OPERATOR, T);
  assert.deepEqual(projection?.current, [US_G10_MATH_EN], "grade 9 has no American rule; her exception holds");

  const back = await setStudentCurriculum(OPERATOR, T, "eg-national-en", null);
  assert.equal(back.ok && back.changed, true);
  assert.deepEqual(await progressOf(T), before, "changing back restores everything exactly as left");

  const record = await studentCurriculum(OPERATOR, T);
  assert.equal(record?.curriculum, "eg-national-en");
  assert.equal(record?.source, "chosen", "an operator's answer is chosen");
  assert.deepEqual(
    record?.history.map((h) => [h.fromCurriculum, h.toCurriculum, h.toSource, h.changedBy, h.reason, h.note]),
    [
      ["us-american-en", "eg-national-en", "chosen", "Samuel", "operator", null],
      ["eg-national-en", "us-american-en", "chosen", "Samuel", "operator", "school confirmed"],
    ],
    "newest first, each naming the operator"
  );

  // the same curriculum again: nothing written, nothing recorded
  const same = await setStudentCurriculum(OPERATOR, T, "eg-national-en", null);
  assert.deepEqual(same, { ok: true, changed: false, from: "eg-national-en", to: "eg-national-en" });
  assert.equal((await studentCurriculum(OPERATOR, T))?.history.length, 2);
  // another environment's student is not here
  assert.deepEqual(await setStudentCurriculum(OPERATOR, ELSE, "eg-national-en", null), {
    ok: false,
    reason: "no_such_student",
  });
});

test("the headcount: this environment's students with no live exception, counts only (FR-4103)", { skip }, async () => {
  const counts = await lastLiveCourseHeadcount(OPERATOR, ["content-review"]);
  assert.deepEqual(counts, {
    // N9 and P3 (prep-3 is grade 9); T holds a live exception, OLD is legacy
    "eg-national-en": { "9": 2, "10": 1 },
    // A10 only: A10x holds a live exception, ELSE is another environment,
    // and ODD's curriculum is not one the product knows
    "us-american-en": { "10": 1 },
  });
  assert.equal(await lastLiveCourseHeadcount(OPERATOR, ["cost-billing"]), null);
});

test("the Overview: two maths courses are two cohorts, never one figure (FR-4104)", { skip }, async () => {
  const any = await getOverview(OPERATOR);
  const keys = any.options.map((o) => `${o.courseId}|${o.grade}|${o.students}`);
  // Prep-3 maths for the National grades that exist, Grade 10 for the American one
  assert.ok(keys.includes(`${PREP3_MATH_EN}|9|3`), keys.join(", "));
  assert.ok(keys.includes(`${US_G10_MATH_EN}|10|2`), keys.join(", "));
  assert.ok(!keys.some((k) => k.startsWith(`${US_G10_MATH_EN}|9|`)), "no American cohort in a grade with no American student");

  const p3 = await getOverview(OPERATOR, { courseId: PREP3_MATH_EN, grade: "9" });
  assert.equal(p3.selected?.courseId, PREP3_MATH_EN);
  assert.equal(p3.selectedCurriculum, "eg-national-en");
  assert.deepEqual([p3.attempts.attempts, p3.attempts.correct], [3, 2], "the tester's Grade 10 answers are not Prep-3's");
  assert.equal(p3.mastery.objectivesInSubject, 2);
  assert.deepEqual(p3.heatmap.objectives.map((o) => o.loId), P_LOS);
  assert.equal(p3.activation.accounts, 3, "N9, T and OLD: grade 9, National");

  const g10 = await getOverview(OPERATOR, { courseId: US_G10_MATH_EN, grade: "10" });
  assert.equal(g10.selectedCurriculum, "us-american-en");
  assert.deepEqual([g10.attempts.attempts, g10.attempts.correct], [4, 1], "American grade 10 only — not the tester");
  assert.deepEqual(g10.heatmap.objectives.map((o) => o.loId), G_LOS);
  assert.equal(g10.activation.accounts, 2, "A10 and A10x");
  assert.equal(g10.mastery.studentsWithEvidence, 1);

  // per lesson (FR-4319): T, grade 9 National, has a 0.4 estimate on u1-1-1
  assert.deepEqual(p3.byLesson, [
    { lessonSlug: "u1-1", figures: { objectives: 2, attempts: 3, correct: 2, reached: 2, mastered: 1 } },
  ]);
  // no store rows for Prep 3 (the loader writes them, T404): one row per lesson
  assert.deepEqual(p3.bySection.map((sec) => [sec.label, sec.split, sec.figures.attempts]), [["u1-1", false, 3]]);
  assert.deepEqual(g10.byLesson, [
    { lessonSlug: "g10m1s1-1", figures: { objectives: 2, attempts: 4, correct: 1, reached: 1, mastered: 1 } },
  ]);
  // the store names the printed section
  assert.deepEqual(g10.bySection.map((sec) => [sec.label, sec.figures.attempts]), [["1.1 The real number system", 4]]);

  // FR-4319 changes no National figure: with the store's one-section row for
  // the Prep-3 lesson (what the loader writes, T404), every figure of the
  // cohort is exactly what it was without it — only the section's label moves.
  await db!.query(
    `INSERT INTO course_lessons (course_id, lesson_slug, title, sections, section_titles, group_key)
     VALUES ($1, 'u1-1', 'Unit 1, lesson 1', '{1.1}', '{"Unit 1, lesson 1"}', '1.1')`,
    [PREP3_MATH_EN]
  );
  const p3again = await getOverview(OPERATOR, { courseId: PREP3_MATH_EN, grade: "9" });
  const { bySection: before, ...restBefore } = p3;
  const { bySection: after, ...restAfter } = p3again;
  assert.deepEqual(restAfter, restBefore, "no existing figure moved");
  assert.deepEqual(after.map((s) => s.figures), before.map((s) => s.figures));
  assert.deepEqual(after.map((s) => s.label), ["1.1 Unit 1, lesson 1"]);

  // a pre-003 link by subject opens the first maths course, never a merged one
  const legacy = await getOverview(OPERATOR, { subject: "math", grade: "9" });
  assert.equal(legacy.selected?.courseId, PREP3_MATH_EN);
});

test("/pipeline: every live figure is one course's, and the book is that course's own (FR-4104)", { skip }, async () => {
  const g10 = await getPipelineDataForOperator(OPERATOR, US_G10_MATH_EN);
  assert.equal(g10.courseId, US_G10_MATH_EN);
  assert.deepEqual(g10.loadedCourses, [PREP3_MATH_EN, US_G10_MATH_EN]);
  assert.equal(g10.doc?.title, "Grade 10 maths (fixture)");
  assert.equal(g10.run?.extractor, "g10-extractor");
  assert.deepEqual(g10.los.map((l) => l.id), G_LOS);
  assert.deepEqual(g10.prereqEdges, [{ src: G_LOS[0], dst: G_LOS[1] }]);
  assert.deepEqual(g10.questionStats, { live: 2, reviewed: 0 });
  assert.deepEqual(
    Object.fromEntries(g10.nodesByKind.map((k) => [k.kind, k.count])),
    { course: 1, module: 1, learning_objective: 2 }
  );
  assert.ok(G_LOS.includes(g10.reviewQuestion?.loId ?? ""));

  const fallback = await getPipelineDataForOperator(OPERATOR, "course:not-loaded");
  assert.equal(fallback.courseId, PREP3_MATH_EN, "an unknown course falls back to the first loaded one");
  assert.deepEqual(fallback.questionStats, { live: 2, reviewed: 2 });
});

test("the Content page: per course, per lesson in catalogue order, per book section (FR-4104, FR-4319)", { skip }, async () => {
  const bank = await getContentAdminView(OPERATOR);
  const p3 = scopeContentView(bank, PREP3_MATH_EN);
  const g10 = scopeContentView(bank, US_G10_MATH_EN);
  assert.deepEqual([p3.rows.length, g10.rows.length], [2, 2], "each course counts its own questions");
  assert.deepEqual(contentByLesson(g10.rows).map((l) => [l.lessonSlug, l.figures.questions]), [["g10m1s1-1", 2]]);
  const store = await bookSections(OPERATOR, [US_G10_MATH_EN]);
  const sections = rollUpBySection(contentByLesson(g10.rows), store.index, addContentFigures);
  assert.deepEqual(sections.map((s) => [s.label, s.figures.questions]), [["1.1 The real number system", 2]]);
  assert.deepEqual(sectionChecks(contentByLesson(g10.rows), store), []);
});

test("the students list: the cost projection's SQL runs without the curriculum (F7)", { skip }, async () => {
  const cost = await getStudentList(OPERATOR, "cost");
  const full = await getStudentList(OPERATOR, "full");
  assert.ok(cost.rows.length > 0 && cost.rows.every((r) => r.curriculum === null && r.curriculumSource === null));
  const a10 = full.rows.find((r) => r.id === A10);
  assert.equal(a10?.curriculum, "us-american-en");
  assert.ok(!full.rows.some((r) => r.id === ELSE), "this environment only");
});
