/**
 * The `/courses` headcount is a COUNT and nothing else (feature 003, FR-4103;
 * privacy review F9; tasks T376).
 *
 * Before a rule change hides the last live course of a curriculum for a grade,
 * `/courses` states how many students it leaves with nothing to study. That
 * page belongs to `content-review`, and that role must not learn a student's
 * name or id from a content decision (FR-2707). So this file fails if:
 *
 *   · the `/courses` view or its copy (`courses/page.console.tsx`,
 *     `CourseAvailabilityGrid.tsx`) could interpolate a student's name or id —
 *     it names no student field at all, and takes from the read model only the
 *     count type and the count function;
 *   · the read (`lastLiveCourseHeadcount`, `lib/console-queries.ts`) selects
 *     anything but a grade, a curriculum and `count(*)`, or returns anything
 *     but numbers;
 *   · the read runs without its `CROSS_STUDENT_READS` entry, or that entry
 *     admits a role other than `content-review`.
 *
 * The same shape as `student-scope-guard.test.mts`: a source scan with a
 * negative control, plus the function itself over a fake operator pool.
 *
 * @covers FR-4103
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";

import { CROSS_STUDENT_READS, crossStudentReadAllowed } from "./auth/authorize.ts";
import { ALL_ROLES } from "./console-routes.ts";
import { ENVIRONMENT } from "./env.ts";

const { foldHeadcounts, lastLiveCourseHeadcount } = await import("./console-queries.ts");

const APP = fileURLToPath(new URL("../..", import.meta.url));
const read = (rel: string) => readFileSync(APP + rel, "utf8");

/** Block and whole-line comments out, so the scan reads code and copy only. */
function stripComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** Every token through which a student could be named or pointed at. */
const STUDENT_IDENTIFIER =
  /\b(displayName|display_name|studentName|studentId|student_id|students\.id|st\.id|email|accountId|account_id)\b/g;

function identifiersIn(src: string): string[] {
  return [...stripComments(src).matchAll(STUDENT_IDENTIFIER)].map((m) => m[0]);
}

const VIEW = [
  "src/app/(console)/courses/page.console.tsx",
  "src/components/console/CourseAvailabilityGrid.tsx",
];

test("the /courses view and its copy name no student field at all (F9)", () => {
  for (const file of VIEW) {
    assert.deepEqual(identifiersIn(read(file)), [], `${file} must not be able to print a student`);
  }
});

test("the view takes only the count function and the count type from the read model", () => {
  const page = stripComments(read(VIEW[0]));
  const grid = stripComments(read(VIEW[1]));
  assert.match(page, /import \{ lastLiveCourseHeadcount \} from "@\/lib\/console-queries";/);
  assert.match(grid, /import type \{ CurriculumHeadcounts \} from "@\/lib\/console-queries";/);
  for (const [file, code] of [
    [VIEW[0], page],
    [VIEW[1], grid],
  ] as const) {
    const imports = [...code.matchAll(/from "@\/lib\/console-queries"/g)].length;
    assert.equal(imports, 1, `${file}: one import from the console read models, no more`);
    // nothing on the page reaches the per-student endpoints or the 360
    assert.doesNotMatch(code, /\/api\/console\/students|\/students\/\$\{/, `${file} links no student`);
  }
});

test("the read selects a grade, a curriculum and a count — and returns numbers only", () => {
  const src = read("src/lib/console-queries.ts");
  const start = src.indexOf("export async function lastLiveCourseHeadcount(");
  assert.ok(start > 0, "lastLiveCourseHeadcount exists");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  // its gate comes first, before any database
  assert.match(
    body,
    /^[\s\S]*?if \(!crossStudentReadAllowed\("last_live_course_headcount", roles\)\) return null;\s*const rows = await withOperator/
  );
  const select = body.match(/`SELECT ([\s\S]*?)\n\s*FROM students st/);
  assert.ok(select, "one outer SELECT from students");
  assert.equal(select[1].replace(/\s+/g, " ").trim(), "st.grade, st.curriculum_system, count(*) AS students");
  assert.match(body, /GROUP BY st\.grade, st\.curriculum_system/);
  // the type the page is handed: curriculum → grade → a number
  assert.match(
    src,
    /export type CurriculumHeadcounts = Partial<Record<CurriculumId, Record<string, number>>>;/
  );
});

test("the read is enumerated, owned by content-review, and admits no other role", () => {
  const entry = CROSS_STUDENT_READS.find((r) => r.name === "last_live_course_headcount");
  assert.ok(entry, "listed in CROSS_STUDENT_READS (FR-2108)");
  assert.equal(entry.role, "content-review");
  for (const role of ALL_ROLES) {
    assert.equal(
      crossStudentReadAllowed("last_live_course_headcount", [role]),
      role === "content-review",
      role
    );
  }
});

/* ------------------------------------------------------------------ */
/* The function itself, over a fake operator pool                      */
/* ------------------------------------------------------------------ */

let connects = 0;
let sql: { text: string; values?: unknown[] }[] = [];
let rows: Record<string, unknown>[] = [];

(globalThis as unknown as { pgOperatorPool: unknown }).pgOperatorPool = {
  connect: async () => {
    connects++;
    return {
      query: async (text: string, values?: unknown[]) => {
        sql.push({ text, values });
        const t = text.replace(/\s+/g, " ").trim();
        if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(t) || t.startsWith("SELECT set_config")) return { rows: [] };
        if (t.startsWith("SELECT st.grade, st.curriculum_system, count(*) AS students")) return { rows };
        throw new Error(`unexpected query: ${t.slice(0, 120)}`);
      },
      release() {},
    } as unknown as PoolClient;
  },
};

test("without the role, nothing is read at all", async () => {
  connects = 0;
  for (const role of ALL_ROLES.filter((r) => r !== "content-review")) {
    assert.equal(await lastLiveCourseHeadcount(1, [role]), null, role);
  }
  assert.equal(await lastLiveCourseHeadcount(1, []), null);
  assert.equal(connects, 0, "no connection is opened for a refused read");
});

test("with the role: this environment's counts, folded, numbers as the only values", async () => {
  sql = [];
  rows = [
    { grade: "prep-3", curriculum_system: "eg-national-en", students: "2" },
    { grade: "9", curriculum_system: "eg-national-en", students: "3" },
    { grade: "10", curriculum_system: "us-american-en", students: "4" },
    { grade: "10", curriculum_system: "not-a-curriculum", students: "9" },
    { grade: null, curriculum_system: "eg-national-en", students: "1" },
  ];
  const out = await lastLiveCourseHeadcount(1, ["content-review"]);
  assert.deepEqual(out, { "eg-national-en": { "9": 5 }, "us-american-en": { "10": 4 } });
  const q = sql.find((c) => c.text.includes("FROM students st"));
  assert.deepEqual(q?.values, [ENVIRONMENT], "this environment only (constitution XI)");
  // every leaf is a number: nothing a view could print as a name
  const leaves = Object.values(out ?? {}).flatMap((g) => Object.values(g ?? {}));
  assert.ok(leaves.length > 0 && leaves.every((v) => typeof v === "number"));
});

test("foldHeadcounts: prep-3 is grade 9, an unknown curriculum or a missing grade counts nowhere", () => {
  assert.deepEqual(foldHeadcounts([]), {});
  assert.deepEqual(
    foldHeadcounts([
      { grade: " 9 ", curriculum_system: "eg-national-en", students: 1 },
      { grade: "prep-3", curriculum_system: "eg-national-en", students: "2" },
      { grade: "10", curriculum_system: "US-AMERICAN-EN", students: 7 },
      { grade: "", curriculum_system: "us-american-en", students: 3 },
    ]),
    { "eg-national-en": { "9": 3 } }
  );
});

test("the scanner catches what it must (negative control)", () => {
  const planted = `
    // displayName in a comment is fine
    <p>{row.displayName} #{row.studentId}</p>
    const n = st.id;
  `;
  assert.deepEqual(identifiersIn(planted), ["displayName", "studentId", "st.id"]);
});
