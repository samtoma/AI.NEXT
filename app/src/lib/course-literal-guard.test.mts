/**
 * NO COURSE ID OUTSIDE THE REGISTRY, AND NO SUBJECT → COURSE LOOKUP OUTSIDE
 * THE SCOPE (feature 003; contracts/registry-and-gate.md, guard tests 2 and 3).
 *
 * Two regressions this makes a test failure rather than a review comment:
 *
 *   1. A `course:` id written inline. `PROBING_COURSE_ID = "course:prep3-…"`
 *      in `lib/socratic-probing.ts` and `?subject=math` meaning
 *      `course:prep3-math-en` were both literals in readers, and both assumed
 *      one course per subject. Every course id now lives in `lib/courses.ts`
 *      (named constants and the `COURSES` registry); a reader names a course
 *      by importing it.
 *   2. A subject → course lookup. `?subject=math` names a SUBJECT, and a
 *      student may be able to reach two courses of it; which one she means
 *      depends on her curriculum and what she may see. Only the student scope
 *      answers that (`courseForSubject` in `lib/catalog.ts`, through
 *      `resolveStudentScope` in `lib/catalog-queries.ts`). `courseIdOfSpineKey`
 *      and `SubjectDef.courseId` are gone, and must not come back.
 *
 * Source scan with comments stripped (the order guard's stripper). Tests,
 * fixtures (`*.mts` under `src/`) and the capture harness are exempt: they
 * name courses to build fixtures, which is their job.
 *
 * @covers FR-4001, FR-4006, FR-4212
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("../..", import.meta.url));

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** App source: `src/` .ts/.tsx and `scripts/` .mts/.mjs, tests and fixtures excluded. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string, ext: RegExp) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== "node_modules") walk(full, ext);
      } else if (ext.test(entry) && !/\.test\./.test(entry)) {
        out.push(relative(APP, full));
      }
    }
  };
  walk(join(APP, "src"), /\.(ts|tsx)$/);
  walk(join(APP, "scripts"), /\.(mts|mjs)$/);
  return out;
}

/** Where a course id may be written. */
const REGISTRY = "src/lib/courses.ts";
/** Fixtures and harnesses that name courses to build their cases. */
const EXEMPT = new Set(["scripts/capture-prompts.mts"]);
const isFixture = (f: string) => f.startsWith("src/") && f.endsWith(".mts");

/** A string literal (any quote) holding a course id: `"course:prep3-…"`, or a
 *  single-quoted SQL literal inside a template. A bare `"course:"` prefix
 *  test is not an id and is allowed. */
export const COURSE_LITERAL = /["'`]course:[a-z0-9]/;

/** The files allowed to go from a subject to a course. */
const SUBJECT_TO_COURSE_ALLOWED = new Set([
  "src/lib/courses.ts",
  "src/lib/subjects.ts", // `coursesOfSpineKey`: the registry's list, not a student's answer
  "src/lib/catalog.ts", // `courseForSubject`: THE rule
  "src/lib/catalog-queries.ts", // the scope, which applies it
]);

/** Shapes of a subject → course lookup. */
export const SUBJECT_TO_COURSE: readonly RegExp[] = [
  /\bcourseIdOfSpineKey\b/, // removed in 003
  /\bSUBJECTS\s*\[[^\]]+\]\s*\.\s*courseId\b/, // SubjectDef.courseId, removed in 003
  /\bsubjectDef\([^)]*\)\s*\.\s*courseId\b/,
  /\bspineSubjectDef\([^)]*\)\s*\.\s*courseId\b/,
  /(^|[^.\w])coursesOfSpineKey\(/, // the registry's list, only for the scope
  /(^|[^.\w])courseForSubject\(/, // the rule itself; others call scope.courseForSubject(…)
  /COURSES\s*\[[^\]]+\]\s*\.\s*subject\s*===/, // filtering courses by subject
];

test("no course id is written outside lib/courses.ts", () => {
  const hits: string[] = [];
  for (const f of sourceFiles()) {
    if (f === REGISTRY || EXEMPT.has(f) || isFixture(f)) continue;
    const code = stripComments(readFileSync(join(APP, f), "utf8"));
    code.split("\n").forEach((line, i) => {
      if (COURSE_LITERAL.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(
    hits,
    [],
    "A course id is written inline. Import it from lib/courses.ts (a named constant, or the registry) — a " +
      "course named in a reader is how one course per subject got assumed:\n" +
      hits.join("\n")
  );
});

test("the registry holds every course id the app uses", () => {
  const registry = stripComments(readFileSync(join(APP, REGISTRY), "utf8"));
  for (const id of ["course:prep3-math-en", "course:prep3-social-ar", "course:prep3-arabic-ar", "course:us-g10-math-en"]) {
    assert.ok(registry.includes(`"${id}"`), id);
  }
});

test("no subject → course lookup outside the registries and the scope", () => {
  const hits: string[] = [];
  for (const f of sourceFiles()) {
    if (SUBJECT_TO_COURSE_ALLOWED.has(f) || isFixture(f) || EXEMPT.has(f)) continue;
    const code = stripComments(readFileSync(join(APP, f), "utf8"));
    code.split("\n").forEach((line, i) => {
      if (SUBJECT_TO_COURSE.some((re) => re.test(line))) hits.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(
    hits,
    [],
    "A subject is turned into a course outside the student scope. `?subject=` names a subject, and which " +
      "course a student means by it depends on her curriculum: use `scope.courseForSubject(key)` " +
      "(lib/catalog-queries.ts resolveStudentScope):\n" +
      hits.join("\n")
  );
});

test("the student page resolves ?subject= through the scope", () => {
  const code = stripComments(readFileSync(join(APP, "src/app/(student)/student/page.tsx"), "utf8"));
  assert.match(code, /\(await resolveStudentScope\(studentId\)\)\.courseForSubject\(subject\)/);
});

test("the scanners catch what they must (negative controls)", () => {
  assert.match(`export const PROBING_COURSE_ID = "course:prep3-math-en";`, COURSE_LITERAL);
  assert.match("`WHERE c.id = 'course:prep3-math-en'`", COURSE_LITERAL);
  assert.match("const c = `course:${slug}`;".replace("${slug}", "x1"), COURSE_LITERAL);
  assert.doesNotMatch(`if (id.startsWith("course:")) {}`, COURSE_LITERAL);
  assert.doesNotMatch(stripComments(`// "course:prep3-math-en" was the literal\nconst x = 1;`), COURSE_LITERAL);
  const flagged = (line: string) => SUBJECT_TO_COURSE.some((re) => re.test(line));
  assert.ok(flagged(`const courseId = courseIdOfSpineKey(subject) ?? null;`));
  assert.ok(flagged(`courseId: SUBJECTS["social-ar"].courseId,`));
  assert.ok(flagged(`const c = courseForSubject(coursesOfSpineKey(key), visible, curriculum);`));
  assert.ok(flagged(`const maths = COURSE_IDS.filter((id) => COURSES[id].subject === "math-en");`));
  assert.ok(!flagged(`const courseId = subject == null ? null : scope.courseForSubject(subject);`));
});
