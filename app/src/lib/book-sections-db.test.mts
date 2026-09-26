/**
 * Book-section grouping against a real Postgres (feature 003, decision 18):
 * the REAL `advanceIfMastered` and `getCurrentLesson` (lib/progression-db.ts)
 * over the REAL `course_lessons` DDL, taken from migration 034 as written.
 *
 *   · The three National courses, loaded from their seeds, each walked from
 *     its first lesson to where it parks, by a student who masters every
 *     lesson the pointer lands on — once with one-section `course_lessons`
 *     rows for every National lesson (their printed references collide:
 *     "Lesson 3-1" is u3-1 and t2u3-1), once with none. The walks are
 *     identical, and identical to the pure rule with no store at all.
 *   · A Grade 10 fixture course (a merged lesson, 1.7 split in three, a
 *     chapter introduction): the walk goes part 1 → 2 → 3 before 1.8, and a
 *     student who passed part 3 through a link is moved part 1 → part 2 →
 *     1.8 (US6 scenario 3).
 *   · `graph_edges` holds exactly the book's edges before and after: the part
 *     prerequisites are derived, never written (FR-4317).
 *
 * **Opt-in**, like `catalogue-order-db.test.mts`: it runs only when
 * `AINEXT_SCRATCH_PG` names a maintenance database it may create one on —
 *
 *   AINEXT_SCRATCH_PG=postgres://localhost:5432/postgres \
 *     node --import ./scripts/ts-resolver.mjs --test src/lib/book-sections-db.test.mts
 *
 * — and is reported as skipped otherwise. It creates ONE database named
 * `ainext_book_sections_<pid>_<ms>` and drops that exact name afterwards. It
 * never touches any other database.
 *
 * @covers FR-4311
 * @covers FR-4313
 * @covers FR-4317
 * @covers SC-211
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";
import type { PoolClient } from "pg";

import { MATHS_SEED_FILES } from "./spine-maths-fixture.mts";
import { slugOfLo } from "./lesson-slug.ts";
import { advanceTarget, resolvePointer, type ProgressionLesson } from "./progression.ts";
import { LESSON_PROVENANCE_SQL, printedLabel, provenanceFromRow } from "./book-sections.ts";

const { advanceIfMastered, getCurrentLesson, getSectionIndex } = await import("./progression-db.ts");

const DSN = process.env.AINEXT_SCRATCH_PG;
const skip = DSN
  ? false
  : "set AINEXT_SCRATCH_PG to a maintenance-database DSN to run against a scratch database";

const DB = `ainext_book_sections_${process.pid}_${Date.now()}`;
const BUNDLES = [...MATHS_SEED_FILES, "social-t1", "arabic-t1", "arabic-t2"];
const NATIONAL = ["course:prep3-math-en", "course:prep3-social-ar", "course:prep3-arabic-ar"];
const G10 = "course:us-g10-math-en";

let admin: pg.Client | null = null;
let db: pg.Client | null = null;
const client = () =>
  ({ query: (t: string, v?: unknown[]) => db!.query(t, v), release() {} }) as unknown as PoolClient;

type SeedNode = { id: string; kind: string; label: string; syllabus_ref?: string | null; order_in_parent?: number | null };
type SeedEdge = { src: string; dst: string; type: string };

function readSeeds() {
  const nodes = new Map<string, SeedNode>();
  const edges: SeedEdge[] = [];
  for (const f of BUNDLES) {
    const doc = JSON.parse(
      readFileSync(fileURLToPath(new URL(`../../../services/extraction/seed/${f}.json`, import.meta.url)), "utf8")
    ) as { nodes: SeedNode[]; edges: SeedEdge[] };
    for (const n of doc.nodes) if (!nodes.has(n.id)) nodes.set(n.id, n);
    edges.push(...doc.edges);
  }
  return { nodes: [...nodes.values()], edges };
}

/** Migration 034's table and index, as written — not a copy of them. */
function migration034Ddl(): string[] {
  const sql = readFileSync(
    fileURLToPath(new URL("../../../db/migrations/034-book-sections.sql", import.meta.url)),
    "utf8"
  );
  const table = sql.match(/CREATE TABLE IF NOT EXISTS course_lessons \([\s\S]*?\n\);/);
  const index = sql.match(/CREATE UNIQUE INDEX course_lessons_one_part_n[\s\S]*?;/);
  assert.ok(table && index, "migration 034 defines course_lessons and its index");
  return [table[0], index[0]];
}

/* The Grade 10 fixture: modules, lessons (objective counts), provenance. */
const G10_LESSONS: { slug: string; module: string; los: number; row: Record<string, unknown> }[] = [
  { slug: "g10m1s3-1", module: "module:g10m-c01", los: 2, row: { sections: ["1.2", "1.3"], section_titles: ["The real number system", "Rational and irrational numbers"], group_key: "1.2" } },
  { slug: "g10m1s6-1", module: "module:g10m-c01", los: 2, row: { sections: ["1.6"], section_titles: ["Products"], group_key: "1.6" } },
  { slug: "g10m1s7-1", module: "module:g10m-c01", los: 3, row: { sections: ["1.7"], section_titles: ["Factorisation"], group_key: "1.7", part_n: 1, part_of: 3 } },
  { slug: "g10m1s7-2", module: "module:g10m-c01", los: 2, row: { sections: ["1.7"], section_titles: ["Factorisation"], group_key: "1.7", part_n: 2, part_of: 3 } },
  { slug: "g10m1s7-3", module: "module:g10m-c01", los: 1, row: { sections: ["1.7"], section_titles: ["Factorisation"], group_key: "1.7", part_n: 3, part_of: 3 } },
  { slug: "g10m1s8-1", module: "module:g10m-c01", los: 1, row: { sections: ["1.8"], section_titles: ["Simplification of fractions"], group_key: "1.8" } },
  { slug: "g10m6s1-1", module: "module:g10m-c06", los: 1, row: { sections: ["6.1"], section_titles: ["Introduction"], group_key: "6.1", chapter_intro: true } },
  { slug: "g10m6s2-1", module: "module:g10m-c06", los: 1, row: { sections: ["6.2"], section_titles: ["Functions in the real world"], group_key: "6.2" } },
];
const g10Los = (slug: string) =>
  Array.from({ length: G10_LESSONS.find((l) => l.slug === slug)!.los }, (_, i) => `lo:${slug}-${i + 1}`);
const G10_BOOK_EDGES: [string, string][] = [
  ["lo:g10m1s6-1-1", "lo:g10m1s7-1-1"],
  ["lo:g10m1s7-3-1", "lo:g10m1s8-1-1"],
  ["lo:g10m6s1-1-1", "lo:g10m6s2-1-1"],
];

const seeds = readSeeds();
/** National lessons per course, first-seen order — only the set matters here. */
const nationalRows = (() => {
  const courseOfModule = new Map(seeds.edges.filter((e) => e.type === "part_of").map((e) => [e.src, e.dst]));
  const moduleOf = new Map(seeds.edges.filter((e) => e.type === "teaches").map((e) => [e.dst, e.src]));
  const out = new Map<string, { course: string; slug: string; ref: string; title: string }>();
  for (const n of seeds.nodes) {
    if (n.kind !== "learning_objective") continue;
    const slug = slugOfLo(n.id);
    const course = courseOfModule.get(moduleOf.get(n.id) ?? "");
    if (!course || out.has(slug)) continue;
    out.set(slug, { course, slug, ref: n.syllabus_ref ?? slug, title: n.label });
  }
  return [...out.values()];
})();

async function setMastery(studentId: number, los: string[], score: number) {
  for (const lo of los) {
    await db!.query(`UPDATE mastery SET system_to = now() WHERE student_id = $1 AND lo_id = $2 AND system_to IS NULL`, [studentId, lo]);
    await db!.query(`INSERT INTO mastery (student_id, lo_id, score) VALUES ($1, $2, $3)`, [studentId, lo, score]);
  }
}

/** Every objective of a lesson, in catalogue order, from the database itself. */
async function losOf(slug: string): Promise<string[]> {
  const r = await db!.query(
    `SELECT id FROM graph_nodes WHERE kind = 'learning_objective' AND id LIKE $1 ORDER BY order_in_parent, id`,
    [`lo:${slug}-%`]
  );
  return r.rows.map((x) => x.id as string).filter((id) => slugOfLo(id) === slug);
}

/** The lessons of one course, in the order the progression walks them. */
async function courseCatalog(courseId: string): Promise<{ slug: string; courseId: string }[]> {
  const { LO_MODULE_SELECT, MODULE_ORDER } = await import("./lesson.ts");
  const r = await db!.query(`${LO_MODULE_SELECT} ORDER BY ${MODULE_ORDER}`);
  const out: { slug: string; courseId: string }[] = [];
  for (const row of r.rows) {
    if (row.course_id !== courseId) continue;
    const slug = slugOfLo(row.id);
    if (!out.some((l) => l.slug === slug)) out.push({ slug, courseId });
  }
  return out;
}

/**
 * Walk one course as student `sid`: master the lesson the pointer is on,
 * answer one of its objectives, let the REAL advance move the pointer; stop
 * where it parks. Returns the lessons visited.
 */
async function walk(sid: number, courseId: string, beforeEach?: (slug: string) => Promise<void>): Promise<string[]> {
  const cat = await courseCatalog(courseId);
  const seen: string[] = [];
  let pointer = await getCurrentLesson(sid, courseId, cat, client());
  while (pointer && seen.length <= cat.length) {
    seen.push(pointer);
    if (beforeEach) await beforeEach(pointer);
    const los = await losOf(pointer);
    await setMastery(sid, los, 0.9);
    const moved = await advanceIfMastered(client(), sid, los[0]);
    if (moved === null) break;
    assert.equal(await getCurrentLesson(sid, courseId, cat, client()), moved, "the stored pointer is the one returned");
    pointer = moved;
  }
  return seen;
}

/** The same walk through the PURE rule with no store: v0.9.2's decisions. */
async function pureWalk(courseId: string): Promise<string[]> {
  const cat = await courseCatalog(courseId);
  const losBySlug = new Map<string, string[]>();
  for (const l of cat) losBySlug.set(l.slug, await losOf(l.slug));
  const edges = await db!.query(`SELECT src_id, dst_id FROM graph_edges WHERE edge_type = 'prerequisite_of' AND system_to IS NULL`);
  const prereqs = new Map<string, string[]>();
  for (const e of edges.rows) prereqs.set(e.dst_id, [...(prereqs.get(e.dst_id) ?? []), e.src_id]);
  const mastery = new Map<string, number>();
  const seen: string[] = [];
  let pointer = resolvePointer(cat, null);
  while (pointer && seen.length <= cat.length) {
    seen.push(pointer);
    for (const lo of losBySlug.get(pointer)!) mastery.set(lo, 0.9);
    const lessons: ProgressionLesson[] = cat.map((l) => ({
      slug: l.slug,
      courseId,
      los: losBySlug.get(l.slug)!.map((id) => ({ id, mastery: mastery.get(id) ?? 0 })),
    }));
    pointer = advanceTarget(lessons, pointer, pointer, mastery, prereqs);
  }
  return seen;
}

const edgeFingerprint = async () =>
  (
    await db!.query(
      `SELECT count(*)::int AS n, md5(string_agg(src_id || '>' || dst_id || ':' || edge_type, ',' ORDER BY src_id, dst_id, edge_type)) AS h
         FROM graph_edges`
    )
  ).rows[0] as { n: number; h: string };

before(async () => {
  if (!DSN) return;
  assert.match(DB, /^ainext_book_sections_\d+_\d+$/);
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
      syllabus_ref text, order_in_parent int, source_page int
    );
    CREATE TABLE graph_edges (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      src_id text NOT NULL, dst_id text NOT NULL, edge_type text NOT NULL, system_to timestamptz
    );
    CREATE TABLE mastery (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, student_id bigint NOT NULL,
      lo_id text NOT NULL, score real NOT NULL,
      system_from timestamptz NOT NULL DEFAULT now(), system_to timestamptz
    );
    -- 028's shape, CHECK included; no students table, so no FK
    CREATE TABLE student_progress (
      student_id bigint NOT NULL, course_id text NOT NULL,
      lesson_slug text NOT NULL CHECK (lesson_slug ~ '^[a-z0-9]{1,12}-[0-9]{1,3}$'),
      advanced_at timestamptz NOT NULL DEFAULT now(), environment text NOT NULL DEFAULT 'mvp1',
      PRIMARY KEY (student_id, course_id)
    );
  `);
  for (const ddl of migration034Ddl()) await db.query(ddl);

  for (const n of seeds.nodes) {
    await db.query(
      `INSERT INTO graph_nodes (id, kind, label, syllabus_ref, order_in_parent) VALUES ($1, $2, $3, $4, $5)`,
      [n.id, n.kind, n.label, n.syllabus_ref ?? null, n.order_in_parent ?? null]
    );
  }
  for (const e of seeds.edges) {
    await db.query(`INSERT INTO graph_edges (src_id, dst_id, edge_type) VALUES ($1, $2, $3)`, [e.src, e.dst, e.type]);
  }

  // The Grade 10 fixture course.
  await db.query(`INSERT INTO graph_nodes (id, kind, label) VALUES ($1, 'course', 'Mathematics — Grade 10')`, [G10]);
  for (const [m, order] of [["module:g10m-c01", 1], ["module:g10m-c06", 6]] as const) {
    await db.query(`INSERT INTO graph_nodes (id, kind, label, order_in_parent) VALUES ($1, 'module', $1, $2)`, [m, order]);
    await db.query(`INSERT INTO graph_edges (src_id, dst_id, edge_type) VALUES ($1, $2, 'part_of')`, [m, G10]);
  }
  const position = new Map<string, number>();
  for (const l of G10_LESSONS) {
    for (const lo of g10Los(l.slug)) {
      const p = (position.get(l.module) ?? 0) + 1;
      position.set(l.module, p);
      await db.query(
        `INSERT INTO graph_nodes (id, kind, label, order_in_parent) VALUES ($1, 'learning_objective', $1, $2)`,
        [lo, p]
      );
      await db.query(`INSERT INTO graph_edges (src_id, dst_id, edge_type) VALUES ($1, $2, 'teaches')`, [l.module, lo]);
    }
    const r = l.row;
    await db.query(
      `INSERT INTO course_lessons (course_id, lesson_slug, title, sections, section_titles, part_n, part_of, chapter_intro, group_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [G10, l.slug, (r.section_titles as string[])[0], r.sections, r.section_titles, r.part_n ?? null, r.part_of ?? null, r.chapter_intro ?? false, r.group_key]
    );
  }
  for (const [src, dst] of G10_BOOK_EDGES) {
    await db.query(`INSERT INTO graph_edges (src_id, dst_id, edge_type) VALUES ($1, $2, 'prerequisite_of')`, [src, dst]);
  }
});

after(async () => {
  await db?.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
    await admin.end();
  }
});

async function writeNationalRows() {
  for (const r of nationalRows) {
    await db!.query(
      `INSERT INTO course_lessons (course_id, lesson_slug, title, sections, section_titles, group_key)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [r.course, r.slug, r.title, [r.ref], [r.title], r.ref]
    );
  }
}

test("migration 034's own CHECKs refuse a malformed part, and its index a second part 2", { skip }, async () => {
  const bad = async (sql: string, code: string) => {
    await db!.query("SAVEPOINT t");
    await assert.rejects(db!.query(sql), (e: { code?: string }) => e.code === code, sql);
    await db!.query("ROLLBACK TO SAVEPOINT t");
  };
  await db!.query("BEGIN");
  const ins = (vals: string) =>
    `INSERT INTO course_lessons (course_id, lesson_slug, title, sections, section_titles, part_n, part_of, group_key) VALUES ${vals}`;
  await bad(ins(`('c', 'x-1', 't', '{1.1}', '{t}', 2, NULL, '1.1')`), "23514");
  await bad(ins(`('c', 'x-1', 't', '{1.1}', '{t}', 4, 3, '1.1')`), "23514");
  await bad(ins(`('c', 'x-1', 't', '{1.1,1.2}', '{t}', NULL, NULL, '1.1')`), "23514");
  await bad(ins(`('c', 'x-1', 't', '{}', '{}', NULL, NULL, '1.1')`), "23514");
  await bad(ins(`('${G10}', 'g10m1s7-9', 't', '{1.7}', '{t}', 2, 3, '1.7')`), "23505");
  await db!.query("ROLLBACK");
});

test("the National walks are the same with one-section rows, with none, and by the pure rule", { skip }, async () => {
  const edges = await edgeFingerprint();
  await writeNationalRows();
  const colliding = await db!.query(
    `SELECT group_key, string_agg(lesson_slug, ',' ORDER BY lesson_slug) AS s FROM course_lessons
      WHERE course_id = 'course:prep3-math-en' GROUP BY group_key HAVING count(*) > 1 ORDER BY group_key`
  );
  assert.ok(colliding.rows.length > 0, "the premise: National printed references collide");

  const withRows: string[][] = [];
  let sid = 100;
  for (const course of NATIONAL) withRows.push(await walk(sid++, course));
  await db!.query(`DELETE FROM course_lessons WHERE course_id = ANY($1)`, [NATIONAL]);
  const withNone: string[][] = [];
  for (const course of NATIONAL) withNone.push(await walk(sid++, course));
  const pure: string[][] = [];
  for (const course of NATIONAL) pure.push(await pureWalk(course));

  assert.deepEqual(withRows, withNone, "rows or no rows, the same walk");
  assert.deepEqual(withRows, pure, "and it is the pre-003 rule's walk");
  for (const [i, w] of withRows.entries()) assert.ok(w.length > 3, `${NATIONAL[i]}: walked ${w.join(" → ")}`);
  assert.deepEqual(await edgeFingerprint(), edges, "graph_edges untouched");
});

test("the Grade 10 walk takes 1.7's three parts in order before 1.8", { skip }, async () => {
  const edges = await edgeFingerprint();
  const w = await walk(200, G10);
  assert.deepEqual(w, G10_LESSONS.map((l) => l.slug));
  assert.deepEqual(await edgeFingerprint(), edges, "no part prerequisite was written to graph_edges (FR-4317)");
});

test("US6 scenario 3: part 3 passed through a link — part 1 → part 2 → 1.8, never past the section early", { skip }, async () => {
  const sid = 201;
  await setMastery(sid, g10Los("g10m1s7-3"), 0.9);
  const w = await walk(sid, G10);
  assert.deepEqual(w, ["g10m1s3-1", "g10m1s6-1", "g10m1s7-1", "g10m1s7-2", "g10m1s8-1", "g10m6s1-1", "g10m6s2-1"]);
});

test("SC-211: the last part passes with part 2 not passed — the place goes to part 2, not to 1.8", { skip }, async () => {
  const sid = 202;
  const cat = await courseCatalog(G10);
  await setMastery(sid, [...g10Los("g10m1s3-1"), ...g10Los("g10m1s6-1")], 0.9);
  await db!.query(`INSERT INTO student_progress (student_id, course_id, lesson_slug) VALUES ($1, $2, 'g10m1s7-3')`, [sid, G10]);
  await setMastery(sid, [...g10Los("g10m1s7-1"), ...g10Los("g10m1s7-3")], 0.9);
  await setMastery(sid, g10Los("g10m1s7-2"), 0.6);
  assert.equal(await advanceIfMastered(client(), sid, g10Los("g10m1s7-3")[0]), "g10m1s7-2");
  assert.equal(await getCurrentLesson(sid, G10, cat, client()), "g10m1s7-2");
  // And while part 2 stays below the gate, answering on it moves nothing.
  assert.equal(await advanceIfMastered(client(), sid, g10Los("g10m1s7-2")[0]), null);
});

test("getSectionIndex reads the store for the courses it is given, and only those", { skip }, async () => {
  const idx = await getSectionIndex(null, [G10], client());
  assert.equal(idx.hasSplits, true);
  assert.deepEqual(idx.groupOf("g10m1s7-2").slugs, ["g10m1s7-1", "g10m1s7-2", "g10m1s7-3"]);
  assert.deepEqual(idx.provenanceOf("g10m1s3-1")?.sections.map((s) => s.number), ["1.2", "1.3"]);
  assert.equal(idx.provenanceOf("g10m6s1-1")?.chapterIntro, true);
  const none = await getSectionIndex(null, ["course:prep3-math-en"], client());
  assert.equal(none.provenanceOf("g10m1s7-1"), null, "another course's rows are not read");
});

test("the one-lesson read gives the printed section title and the part label", { skip }, async () => {
  const one = async (course: string, slug: string) => {
    const r = await db!.query(LESSON_PROVENANCE_SQL, [course, slug]);
    return r.rows[0] ? printedLabel(provenanceFromRow(r.rows[0])) : null;
  };
  const part = await one(G10, "g10m1s7-2");
  assert.deepEqual([part?.numbers, part?.title, part?.partLabel], [["1.7"], "Factorisation", "part 2 of 3"]);
  const merged = await one(G10, "g10m1s3-1");
  assert.deepEqual(merged?.sectionTitles, ["The real number system", "Rational and irrational numbers"]);
  assert.equal(await one("course:prep3-math-en", "g10m1s7-2"), null, "scoped to the course asked for");
});
