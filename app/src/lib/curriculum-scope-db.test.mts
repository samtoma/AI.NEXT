/**
 * The student scope against a REAL Postgres, with a second curriculum's book
 * loaded beside the three National ones (feature 003; SC-206; privacy review
 * §5 and F19).
 *
 * The fake-client tests (`catalog-gate.test.mts`, `catalog-gate-off.test.mts`)
 * prove the wiring; this proves what the real SQL returns once a Grade 10
 * American course is in the same database as every National student — the
 * situation the privacy review made a precondition of loading the book:
 *
 *   · the lesson catalogue, the progress page, the home page, the skill map,
 *     the practice plan and the Ask context each show a National student
 *     nothing of the American book — not its lessons, its units, its
 *     objectives, its counts or its title — and an American student nothing
 *     National (FR-4006, FR-4202);
 *   · a figure is inside a student's scope only when its objective is;
 *   · `?subject=math` means her own curriculum's maths;
 *   · a test account with an exception for the other curriculum's maths gets
 *     both books, and every list keeps them apart, course by course — never
 *     interleaved by unit number (FR-4009, privacy review F19).
 *
 * **Opt-in**, like `catalogue-order-db.test.mts`: it runs only when
 * `AINEXT_SCRATCH_PG` names a maintenance-database DSN (a role with CREATEDB):
 *
 *   AINEXT_SCRATCH_PG=postgres://localhost:5432/postgres \
 *     node --import ./scripts/ts-resolver.mjs --test src/lib/curriculum-scope-db.test.mts
 *
 * It creates ONE database, `ainext_curriculum_scope_<pid>_<ms>`, builds only
 * the tables these readers touch, loads the real seed files of the three
 * National courses plus a small Grade 10 FIXTURE course (not the real book,
 * which is not extracted yet), and drops that database by its exact name
 * afterwards. It never touches any other database. The gate is ON.
 *
 * @covers FR-4006, FR-4009, FR-4202
 */
process.env.AINEXT_COURSE_GATING = "on";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";
import type { PoolClient } from "pg";

import { MATHS_SEED_FILES } from "./spine-maths-fixture.mts";
import { slugOfLo } from "./lesson-slug.ts";

// Imported AFTER the switch is set: `lib/env.ts` resolves it once, at load,
// and a static import would be evaluated before the assignment above.
const { pool } = await import("./db.ts");
const { COURSE_GATING, ENVIRONMENT } = await import("./env.ts");
assert.equal(COURSE_GATING, true, "this file proves the gate ON");

const { getLessonCatalog, getLessonData } = await import("./lesson.ts");
const { getTopicBreakdown } = await import("./dashboard.ts");
const { getHomeStats, getSpineData, getStudentPlan } = await import("./queries.ts");
const { buildAskContext } = await import("./ask.ts");
const { resolveStudentScope, resolveStudentGraphScope } = await import("./catalog-queries.ts");

const DSN = process.env.AINEXT_SCRATCH_PG;
const skip = DSN
  ? false
  : "set AINEXT_SCRATCH_PG to a maintenance-database DSN to run against a scratch database";

const DB = `ainext_curriculum_scope_${process.pid}_${Date.now()}`;
const MATH = "course:prep3-math-en";
const SOCIAL = "course:prep3-social-ar";
const ARABIC = "course:prep3-arabic-ar";
const G10 = "course:us-g10-math-en";
const BUNDLES = [...MATHS_SEED_FILES, "arabic-t1", "arabic-t2", "social-t1"];

/** The books, by course. The G10 title is what must never reach a National student. */
const BOOKS: Record<string, { sha: string; title: string; grade: string; subject: string }> = {
  [MATH]: { sha: "sha-math", title: "Mathematics — Prep 3 (fixture title)", grade: "prep-3", subject: "mathematics" },
  [SOCIAL]: { sha: "sha-social", title: "Social Studies — Prep 3 (fixture title)", grade: "prep-3", subject: "social studies" },
  [ARABIC]: { sha: "sha-arabic", title: "Arabic — Prep 3 (fixture title)", grade: "prep-3", subject: "arabic language" },
  [G10]: { sha: "sha-g10", title: "Everything Maths Grade 10 (FIXTURE)", grade: "10", subject: "mathematics" },
};

/** The Grade 10 fixture course: two chapters, four objectives, book order. */
const G10_NODES = [
  { id: "program:us-american-en", kind: "program", label: "American", order: null },
  { id: G10, kind: "course", label: "Mathematics — Grade 10", order: null },
  { id: "module:g10m-c01", kind: "module", label: "Chapter 1 — Algebraic expressions", order: 1 },
  { id: "module:g10m-c02", kind: "module", label: "Chapter 2 — Exponents", order: 2 },
  { id: "lo:g10m1s1-1-1", kind: "learning_objective", label: "Real numbers", order: 1 },
  { id: "lo:g10m1s1-1-2", kind: "learning_objective", label: "Rounding off", order: 2 },
  { id: "lo:g10m1s2-1-1", kind: "learning_objective", label: "Products", order: 3 },
  { id: "lo:g10m2s1-1-1", kind: "learning_objective", label: "Laws of exponents", order: 1 },
];
const G10_EDGES = [
  { src: G10, dst: "program:us-american-en", type: "part_of" },
  { src: "module:g10m-c01", dst: G10, type: "part_of" },
  { src: "module:g10m-c02", dst: G10, type: "part_of" },
  { src: "module:g10m-c01", dst: "lo:g10m1s1-1-1", type: "teaches" },
  { src: "module:g10m-c01", dst: "lo:g10m1s1-1-2", type: "teaches" },
  { src: "module:g10m-c01", dst: "lo:g10m1s2-1-1", type: "teaches" },
  { src: "module:g10m-c02", dst: "lo:g10m2s1-1-1", type: "teaches" },
  { src: "lo:g10m1s1-1-1", dst: "lo:g10m1s2-1-1", type: "prerequisite_of" },
];
const G10_LOS = G10_NODES.filter((n) => n.kind === "learning_objective").map((n) => n.id);

/** The students: National (N), American (A), a National tester with the G10
 *  book by exception (T), a National student cut off from Social (H), and a
 *  National grade-10 student (N10) — whose grade has no National rule, so with
 *  the gate ON she sees nothing (with it off she would see every loaded
 *  National course, which is how this file knows which side it is on). */
const N = 1;
const A = 2;
const T = 3;
const H = 4;
const N10 = 5;

let admin: pg.Client | null = null;
let db: pg.Client | null = null;

type SeedNode = { id: string; kind: string; label: string; order_in_parent?: number | null };
type SeedEdge = { src: string; dst: string; type: string };

function readSeeds(): { nodes: SeedNode[]; edges: SeedEdge[] } {
  const byId = new Map<string, SeedNode>();
  const edges: SeedEdge[] = [];
  for (const f of BUNDLES) {
    const doc = JSON.parse(
      readFileSync(fileURLToPath(new URL(`../../../services/extraction/seed/${f}.json`, import.meta.url)), "utf8")
    ) as { nodes: SeedNode[]; edges: SeedEdge[] };
    for (const n of doc.nodes) if (!byId.has(n.id)) byId.set(n.id, n);
    edges.push(...doc.edges);
  }
  return { nodes: [...byId.values()], edges };
}

const seeds = readSeeds();
const NATIONAL_LOS = seeds.nodes.filter((n) => n.kind === "learning_objective").map((n) => n.id);
const courseOfModule = new Map<string, string>([
  ...seeds.edges.filter((e) => e.type === "part_of" && e.dst.startsWith("course:")).map((e) => [e.src, e.dst] as [string, string]),
  ...G10_EDGES.filter((e) => e.type === "part_of" && e.dst === G10).map((e) => [e.src, e.dst] as [string, string]),
]);

const asClient = (): PoolClient =>
  ({ query: (t: string, v?: unknown[]) => db!.query(t, v), release() {} }) as unknown as PoolClient;

before(async () => {
  if (!DSN) return;
  assert.match(DB, /^ainext_curriculum_scope_\d+_\d+$/);
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
      syllabus_ref text, order_in_parent int, source_page int, subject text, source_sha256 text
    );
    CREATE TABLE graph_edges (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      src_id text NOT NULL, dst_id text NOT NULL, edge_type text NOT NULL,
      syllabus_version text NOT NULL DEFAULT '2025-2026', system_to timestamptz
    );
    CREATE TABLE source_documents (
      sha256 text PRIMARY KEY, title text, publisher text, edition text, grade text, subject text,
      ingested_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE visuals (
      id text PRIMARY KEY, lo_id text NOT NULL, question_id text, kind text NOT NULL,
      spec jsonb, caption text, source_page int
    );
    CREATE TABLE extraction_runs (id bigint PRIMARY KEY, extractor text, extractor_version text, finished_at timestamptz);
    CREATE TABLE questions (
      id text PRIMARY KEY, lo_id text NOT NULL, tier text, question_type text, stem text,
      choices jsonb, correct_answer text, canonical_solution jsonb, solution_version int,
      status text NOT NULL, source text, parent_question_id text, source_sha256 text,
      source_page int, source_note text, reviewed_by text, reviewed_at timestamptz,
      extraction_run_id bigint
    );
    CREATE TABLE attempts (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, student_id bigint NOT NULL,
      question_id text NOT NULL, is_correct boolean, time_ms int,
      attempted_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE mastery (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, student_id bigint NOT NULL,
      lo_id text NOT NULL, score numeric NOT NULL,
      system_from timestamptz NOT NULL DEFAULT now(), system_to timestamptz
    );
    CREATE TABLE students (
      id bigint PRIMARY KEY, display_name text, grade text, interests text[], interest_detail jsonb,
      language_pref text, gender text, curriculum_system text NOT NULL DEFAULT 'eg-national-en',
      -- read by the profile (lib/student-context.ts, migration 033); without it
      -- the profile read fails inside the Ask context's unit of work
      onboarding_pending boolean NOT NULL DEFAULT false
    );
    CREATE TABLE course_availability (environment text, course_id text, grade text, state text);
    CREATE TABLE student_course_access (environment text, student_id bigint, course_id text, state text);
    CREATE TABLE ai_interactions (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, student_id bigint);
    CREATE TABLE understanding_checks (
      student_id bigint, lo_id text, score numeric, verdict text, mode text,
      created_at timestamptz NOT NULL DEFAULT now(), subject text
    );
    CREATE TABLE misconceptions (id text PRIMARY KEY, lo_id text, label text, description text, signal text);
    CREATE TABLE explanation_library (
      id text PRIMARY KEY, lo_id text, misconception_id text, entry_type text, content text,
      source_page int, reviewed boolean
    );
  `);
  // the book-section store the readers consult (migration 034, as shipped) —
  // empty: neither fixture course has a split section here
  {
    const m = readFileSync(
      fileURLToPath(new URL("../../../db/migrations/034-book-sections.sql", import.meta.url)),
      "utf8"
    ).match(/CREATE TABLE IF NOT EXISTS course_lessons \([\s\S]*?\n\);/);
    assert.ok(m, "migration 034 defines course_lessons");
    await db.query(m[0]);
  }

  for (const n of seeds.nodes) {
    await db.query(
      `INSERT INTO graph_nodes (id, kind, label, order_in_parent, source_sha256) VALUES ($1, $2, $3, $4, $5)`,
      [n.id, n.kind, n.label, n.order_in_parent ?? null, n.kind === "course" ? (BOOKS[n.id]?.sha ?? null) : null]
    );
  }
  for (const n of G10_NODES) {
    await db.query(
      `INSERT INTO graph_nodes (id, kind, label, order_in_parent, source_sha256) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [n.id, n.kind, n.label, n.order, n.kind === "course" ? BOOKS[G10].sha : null]
    );
  }
  for (const e of [...seeds.edges, ...G10_EDGES]) {
    await db.query(`INSERT INTO graph_edges (src_id, dst_id, edge_type) VALUES ($1, $2, $3)`, [e.src, e.dst, e.type]);
  }
  for (const [, b] of Object.entries(BOOKS)) {
    await db.query(
      `INSERT INTO source_documents (sha256, title, publisher, edition, grade, subject) VALUES ($1, $2, 'fixture', '1', $3, $4)`,
      [b.sha, b.title, b.grade, b.subject]
    );
  }
  // one live question and one figure per objective of every course
  for (const id of [...NATIONAL_LOS, ...G10_LOS]) {
    await db.query(
      `INSERT INTO questions (id, lo_id, tier, question_type, stem, status, source, canonical_solution, solution_version)
       VALUES ($1, $2, 'basic', 'mcq', 'stem', 'live', 'seed', '[]', 1)`,
      [`q:${id.slice(3)}:001`, id]
    );
    await db.query(`INSERT INTO visuals (id, lo_id, kind, spec) VALUES ($1, $2, 'figure', '{}')`, [`v:${id.slice(3)}:a`, id]);
  }
  await db.query(
    `INSERT INTO students (id, display_name, grade, curriculum_system, language_pref) VALUES
       (${N}, 'National', '9', 'eg-national-en', 'en'),
       (${A}, 'American', '10', 'us-american-en', 'en'),
       (${T}, 'Tester', '9', 'eg-national-en', 'en'),
       (${H}, 'No social', '9', 'eg-national-en', 'en'),
       (${N10}, 'National grade 10', '10', 'eg-national-en', 'en')`
  );
  for (const [course, grade] of [[MATH, "9"], [SOCIAL, "9"], [ARABIC, "9"], [G10, "10"]]) {
    await db.query(`INSERT INTO course_availability VALUES ($1, $2, $3, 'live')`, [ENVIRONMENT, course, grade]);
  }
  await db.query(`INSERT INTO student_course_access VALUES ($1, ${T}, $2, 'live')`, [ENVIRONMENT, G10]);
  await db.query(`INSERT INTO student_course_access VALUES ($1, ${H}, $2, 'hidden')`, [ENVIRONMENT, SOCIAL]);

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

const isG10Lo = (id: string) => G10_LOS.includes(id);
const isG10Slug = (slug: string) => slug.startsWith("g10m");
/** The course each item of a list belongs to, runs collapsed: [A, A, B] → [A, B]. */
const runs = (courses: string[]) => courses.filter((c, i) => i === 0 || courses[i - 1] !== c);

test("the lesson catalogue: each student sees her own curriculum's book — a tester both, apart", { skip }, async () => {
  const n = await getLessonCatalog(N, asClient());
  assert.ok(n.length > 60);
  assert.ok(!n.some((l) => isG10Slug(l.slug)), "no G10 lesson for a National student");
  const a = await getLessonCatalog(A, asClient());
  assert.deepEqual(a.map((l) => l.slug), ["g10m1s1-1", "g10m1s2-1", "g10m2s1-1"], "the book's own order");
  // the gate is ON: grade 10 has no National rule, and the live G10 rule is
  // not hers — decision 6, "grade 10 sees only the American maths course"
  assert.deepEqual(await getLessonCatalog(N10, asClient()), []);
  const h = await getLessonCatalog(H, asClient());
  assert.ok(!h.some((l) => l.courseId === SOCIAL), "her exception hides Social Studies");
  // F19: both maths books, never interleaved — National courses first, then G10
  const t = await getLessonCatalog(T, asClient());
  assert.deepEqual(runs(t.map((l) => l.courseId as string)), [MATH, SOCIAL, ARABIC, G10]);
});

test("a direct request for the other curriculum's lesson answers as if it did not exist", { skip }, async () => {
  assert.equal(await getLessonData("g10m1s1-1", N, asClient()), null);
  assert.equal(await getLessonData("u1-1", A, asClient()), null);
  assert.equal((await getLessonData("g10m1s1-1", A, asClient()))?.courseId, G10);
  assert.equal((await getLessonData("g10m1s1-1", T, asClient()))?.courseId, G10);
});

test("the progress page lists only the units she may see (privacy review §5.2)", { skip }, async () => {
  const courseOf = (moduleId: string) => courseOfModule.get(moduleId);
  const n = await getTopicBreakdown(N, asClient());
  assert.ok(n.length > 10);
  assert.ok(n.every((t) => courseOf(t.moduleId) !== G10), "no G10 chapter for a National student");
  const a = await getTopicBreakdown(A, asClient());
  assert.deepEqual(a.map((t) => t.moduleId), ["module:g10m-c01", "module:g10m-c02"]);
  const h = await getTopicBreakdown(H, asClient());
  assert.ok(h.every((t) => courseOf(t.moduleId) !== SOCIAL), "a hidden course's units are not listed");
  // F19: untouched topics split by course, never interleaved
  const t = await getTopicBreakdown(T, asClient());
  assert.deepEqual(runs(t.map((x) => courseOf(x.moduleId) as string)), [MATH, SOCIAL, ARABIC, G10]);
});

test("the home page counts her courses and names her first course's book (privacy review §5.3)", { skip }, async () => {
  const n = await getHomeStats(N);
  assert.equal(n.los, NATIONAL_LOS.length);
  assert.equal(n.questions, NATIONAL_LOS.length);
  assert.equal(n.doc?.title, BOOKS[MATH].title);
  const a = await getHomeStats(A);
  assert.equal(a.los, G10_LOS.length);
  assert.equal(a.questions, G10_LOS.length);
  assert.equal(a.prereqs, 1);
  assert.equal(a.doc?.title, BOOKS[G10].title);
  const h = await getHomeStats(H);
  assert.ok(h.los < n.los, "Social Studies' objectives are not counted for her");
});

test("the Ask context names no book and no objective she cannot see (privacy review §5.1)", { skip }, async () => {
  const text = async (id: number) => {
    const ctx = await buildAskContext("spine_chat", "scope-db", undefined, undefined, id);
    return `${ctx.systemPrompt}\n${ctx.dataBlock}`;
  };
  const n = await text(N);
  assert.ok(!n.includes(BOOKS[G10].title), "the G10 book's title never reaches a National student's tutor");
  assert.ok(!G10_LOS.some((id) => n.includes(id)), "nor any G10 objective");
  assert.ok(n.includes(BOOKS[MATH].title));
  const a = await text(A);
  assert.ok(a.includes(BOOKS[G10].title));
  for (const c of [MATH, SOCIAL, ARABIC]) assert.ok(!a.includes(BOOKS[c].title), `${c}'s book is not named to her`);
  assert.ok(!a.includes("lo:u1-1-1"));
  const h = await text(H);
  assert.ok(!h.includes(BOOKS[SOCIAL].title), "a hidden course's book is not named either");
});

test("the skill map and the practice plan: her courses only; a tester's two maths books apart", { skip }, async () => {
  const a = await getSpineData(A);
  assert.deepEqual(a.los.map((l) => l.id).sort(), [...G10_LOS].sort());
  assert.equal(a.doc.title, BOOKS[G10].title, "the map names her book, not LIMIT 1's");
  const n = await getSpineData(N);
  assert.ok(!n.los.some((l) => isG10Lo(l.id)));
  assert.equal(n.doc.title, BOOKS[MATH].title);
  // the plan's mastery list is the catalogue order: course by course
  const plan = await getStudentPlan(T);
  const courseOfLo = (id: string) => {
    const e = [...seeds.edges, ...G10_EDGES].find((x) => x.type === "teaches" && x.dst === id);
    return e ? courseOfModule.get(e.src) : undefined;
  };
  assert.deepEqual(runs(plan.mastery.map((m) => courseOfLo(m.loId) as string)), [MATH, SOCIAL, ARABIC, G10]);
});

test("a figure is in scope only when its objective is (privacy review §5.4)", { skip }, async () => {
  const n = await resolveStudentGraphScope(N);
  const a = await resolveStudentGraphScope(A);
  const t = await resolveStudentGraphScope(T);
  assert.equal(n.lo("lo:g10m1s1-1-1"), false);
  assert.equal(n.lo("lo:u1-1-1"), true);
  assert.equal(a.lo("lo:g10m1s1-1-1"), true);
  assert.equal(a.lo("lo:u1-1-1"), false);
  assert.equal(t.lo("lo:g10m1s1-1-1"), true);
  assert.equal(n.doc(BOOKS[G10].sha), false);
  assert.equal(a.doc(BOOKS[G10].sha), true);
});

test("?subject=math means her own curriculum's maths", { skip }, async () => {
  assert.equal((await resolveStudentScope(N)).courseForSubject("math"), MATH);
  assert.equal((await resolveStudentScope(A)).courseForSubject("math"), G10);
  assert.equal((await resolveStudentScope(T)).courseForSubject("math"), MATH, "her own first, though she sees both");
  assert.equal((await resolveStudentScope(A)).courseForSubject("social"), SOCIAL, "hidden from her: the page answers 404");
  assert.equal((await resolveStudentScope(N)).courseForSubject("chemistry"), null);
  const slugs = (await getLessonCatalog(A, asClient())).map((l) => slugOfLo(`lo:${l.slug}-1`));
  assert.ok(slugs.every(isG10Slug));
});

/* ------------------------------------------------------------------ */
/* The 2026-09-26 isolation audit: what reaches the tutor, and the     */
/* views that must not merge two maths books                           */
/* ------------------------------------------------------------------ */

const { getLessonBridges, getSubjectSummaries } = await import("./subject-queries.ts");
const { buildLessonContext } = await import("./lesson.ts");
const { retrieve } = await import("./retrieval.ts");

const SOCIAL_LO = NATIONAL_LOS.find((id) => id.startsWith("lo:soc")) as string;
const G10_LO = "lo:g10m1s1-1-1";
const G10_LABEL = "Real numbers";
let isolationReady = false;

/**
 * What these tests add to the shared database, once, AFTER every test above
 * has run (node:test runs a file's tests in order): the `rationale` column
 * and the `node_subject` view as migrations 006/007 define them, each course's
 * subject, two curated bridges — Prep-3 maths ↔ Social Studies, and Prep-3
 * maths ↔ the Grade 10 book — and one prerequisite that crosses from Prep 3
 * into the Grade 10 book (the loader refuses such an edge; it is written
 * directly here to prove the readers do not depend on that).
 */
async function isolationFixtures() {
  if (isolationReady) return;
  isolationReady = true;
  assert.ok(SOCIAL_LO, "a Social Studies objective in the seeds");
  await db!.query(`ALTER TABLE graph_edges ADD COLUMN IF NOT EXISTS rationale text`);
  await db!.query(`
    CREATE OR REPLACE VIEW node_subject AS
    SELECT lo.id AS node_id, c.id AS course_id, c.subject AS subject
      FROM graph_nodes lo
      JOIN graph_edges te ON te.dst_id = lo.id AND te.edge_type = 'teaches'
      JOIN graph_edges pe ON pe.src_id = te.src_id AND pe.edge_type = 'part_of'
      JOIN graph_nodes c  ON c.id = pe.dst_id AND c.kind = 'course'
     WHERE lo.kind = 'learning_objective'`);
  for (const [course, subject] of [[MATH, "math"], [SOCIAL, "social"], [ARABIC, "arabic"], [G10, "math"]]) {
    await db!.query(`UPDATE graph_nodes SET subject = $2 WHERE id = $1`, [course, subject]);
  }
  await db!.query(
    `INSERT INTO graph_edges (src_id, dst_id, edge_type, rationale) VALUES
       ('lo:u1-1-1', $1, 'relates_to', 'ISO-BRIDGE-SOCIAL'),
       ($2, 'lo:u1-1-1', 'relates_to', 'ISO-BRIDGE-G10'),
       ('lo:u1-1-1', $2, 'prerequisite_of', NULL)`,
    [SOCIAL_LO, G10_LO]
  );
}

test("isolation: a cross-subject bridge reaches her only when both its courses are hers (FR-4006)", { skip }, async () => {
  await isolationFixtures();
  const bridges = async (id: number, los: string[]) =>
    (await getLessonBridges(los, await resolveStudentScope(id, asClient()), asClient()))
      .map((b) => b.rationale)
      .sort();
  assert.deepEqual(await bridges(N, ["lo:u1-1-1"]), ["ISO-BRIDGE-SOCIAL"], "not the Grade 10 book's");
  assert.deepEqual(await bridges(H, ["lo:u1-1-1"]), [], "Social Studies hidden: no bridge carries it in");
  assert.deepEqual(await bridges(T, ["lo:u1-1-1"]), ["ISO-BRIDGE-G10", "ISO-BRIDGE-SOCIAL"], "a tester sees both");
  assert.deepEqual(await bridges(A, [G10_LO]), [], "an American student gets nothing National");
});

test("isolation: the lesson prompt carries neither a hidden course's bridge nor a handoff to it (FR-4006)", { skip }, async () => {
  await isolationFixtures();
  const ctx = async (id: number, slug: string) => {
    const c = await buildLessonContext("learn", `iso-${id}`, slug, id, undefined, asClient());
    assert.ok(c, `${slug} opens for student ${id}`);
    return c;
  };
  const n = await ctx(N, "u1-1");
  assert.match(n.dataBlock, /CROSS-SUBJECT CONNECTIONS/);
  assert.ok(n.dataBlock.includes("ISO-BRIDGE-SOCIAL"));
  assert.ok(!n.dataBlock.includes("ISO-BRIDGE-G10"), "the other curriculum's book never reaches her tutor");
  assert.ok(n.systemPrompt.includes(`where <subject> is exactly "math" or "social"`), "the rule she always had");

  const h = await ctx(H, "u1-1");
  assert.doesNotMatch(h.dataBlock, /CROSS-SUBJECT CONNECTIONS/);
  assert.ok(!h.systemPrompt.includes("{{switch_subject:<subject>}}"), "no handoff offered to a hidden subject");
  assert.ok(h.systemPrompt.includes("Never emit {{switch_subject:…}}"));

  const a = await ctx(A, "g10m1s1-1");
  assert.ok(!a.dataBlock.includes("ISO-BRIDGE-G10"));
  assert.ok(!a.systemPrompt.includes("{{switch_subject:<subject>}}"), "American: no Social Studies to hand off to");
  // the prerequisite into her book from Prep 3 is not walked: no Prep-3
  // objective in her tutor's nearest skills
  assert.ok(!a.dataBlock.includes("lo:u1-1-1"), "a Prep-3 objective reached the Grade 10 prompt");
});

test("isolation: retrieval's one prerequisite hop stays inside the courses she may see (FR-4006)", { skip }, async () => {
  await isolationFixtures();
  const near = async (id: number) =>
    (await retrieve(id, [G10_LO], { client: asClient() })).nearestSkills.map((s) => s.loId);
  assert.ok(!(await near(A)).includes("lo:u1-1-1"), "American: the Prep-3 prerequisite is not hers");
  assert.ok((await near(T)).includes("lo:u1-1-1"), "a tester who sees both books walks the edge");
});

test("isolation: a tester's two maths books are two home cards and two skill maps, each citing its own book (FR-4009, FR-4205)", { skip }, async () => {
  await isolationFixtures();
  const home = await getSubjectSummaries(T, asClient());
  assert.deepEqual(home.map((s) => s.courseId), [MATH, SOCIAL, ARABIC, G10]);
  assert.deepEqual(
    [home[0].courseLabel, home[3].courseLabel],
    ["Mathematics — Prep 3", "Mathematics — Grade 10"]
  );
  assert.deepEqual((await getSubjectSummaries(N, asClient())).map((s) => s.courseId), [MATH, SOCIAL, ARABIC]);

  const map = await getSpineData(T);
  assert.deepEqual(map.courses.map((c) => c.id), [MATH, SOCIAL, ARABIC, G10]);
  assert.equal(map.courses.find((c) => c.id === G10)?.doc.title, BOOKS[G10].title);
  assert.equal(map.courses.find((c) => c.id === MATH)?.doc.title, BOOKS[MATH].title);
  assert.ok(map.los.every((l) => l.courseId != null), "every objective is filed under its course");
  assert.equal(map.los.find((l) => l.id === G10_LO)?.courseId, G10);
  assert.equal(map.los.find((l) => l.id === "lo:u1-1-1")?.courseId, MATH);
  // a National student's map: one course per subject, as the subject picker was
  assert.deepEqual((await getSpineData(N)).courses.map((c) => c.id), [MATH, SOCIAL, ARABIC]);
});

test("isolation: the home page names her own book and syllabus, never another curriculum's (FR-4205, FR-4206)", { skip }, async () => {
  const n = await getHomeStats(N);
  assert.deepEqual(n.sourceWording, { source: "the Egyptian Ministry textbook", syllabus: "syllabus 2025–2026" });
  const a = await getHomeStats(A);
  assert.ok(!/Ministry|2025–2026/.test(`${a.sourceWording.source} ${a.sourceWording.syllabus}`));
  assert.match(a.sourceWording.source, /Everything Maths/);
  const t = await getHomeStats(T);
  assert.ok(!/Ministry|Everything Maths/.test(`${t.sourceWording.source} ${t.sourceWording.syllabus}`), "two books: named neither");
});
