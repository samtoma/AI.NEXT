/**
 * **No student surface, and no visibility rule, reads `requires_plan`** —
 * asserted against the source rather than promised in a comment.
 *
 * ⚠ NO `@covers` ANNOTATION. `course_availability.requires_plan` is the
 * subscription seam of ADR-0018 and migration 023; the requirement nearest to
 * it is FR-2711 ("visibility never depends on commercial status"), whose own
 * evidence line in `specs/002-.../traceability.md` names this exact gap —
 * *"the guarantee is a grep, not a gate — no test fails if a future query
 * selects the column"*. This file is that gate. Annotating it, or editing the
 * matrix, is Samuel's call and not this pass's (CLAUDE.md on matrix
 * laundering), so neither was done.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS BEING PROTECTED, AND FROM WHAT
 * ---------------------------------------------------------------------------
 * `requires_plan` is a column that exists so that it does not have to be added
 * under time pressure the day PRD §10 sets a price. It is NULL on every row,
 * nothing writes it, and the console prints it (`courseCatalog`, and the Plan
 * column on `/courses`) precisely so an operator can see that it is inert.
 *
 * The failure this guards against is somebody, in six months, adding
 * `AND (requires_plan IS NULL OR …)` to the gate because it looked like the
 * obvious way to switch a subject on for paying families. That would be a
 * commercial condition on what a **child can learn**, decided by code rather
 * than by a requirement — FR-2404 already forbids exactly that for
 * `subscription_status`, and the argument is stronger here, not weaker: this
 * column sits inside the gate's own table, one word away from the WHERE clause
 * that decides what a fifteen-year-old sees.
 *
 * A grep is a weak test in general and the right one here, for the same reason
 * `lib/subscription-gate.test.mts` gives: the regression is textual, and this
 * catches it in the second it takes to run. **This file is deliberately shaped
 * like that one** — same scan, same "the console does read it, so this cannot
 * pass by the feature being deleted" counterweight.
 *
 * ---------------------------------------------------------------------------
 * COMMENTS ARE STRIPPED BEFORE SCANNING
 * ---------------------------------------------------------------------------
 * `lib/catalog.ts` explains this column at length in its header, and so does
 * `lib/student-landing.ts`'s sibling prose; a scan that counted sentences would
 * make *writing down why the column is inert* a build failure, which is the
 * opposite of what this repository wants. What is scanned is CODE. The
 * stripper is `design-variant-scan.test.mts`'s, copied with its reasoning:
 * block comments and whole comment lines go, a TRAILING `// …` stays, because
 * deciding where `//` stops being part of a string literal is how a scan
 * quietly covers less than it claims to.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const APP = fileURLToPath(new URL("../app", import.meta.url));
const SRC = fileURLToPath(new URL("..", import.meta.url));

/** Every spelling the column could be reached by, in SQL and in TypeScript. */
const FORBIDDEN = ["requires_plan", "requiresPlan"];

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...filesUnder(full));
    } else if (/\.(ts|tsx|mts)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Comments removed — see the header. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("//") && !t.startsWith("*");
    })
    .join("\n");
}

/**
 * Everything a signed-in child's request can execute, plus the modules that
 * decide what she may see.
 *
 * `(student)` and `components/student` are her screens. The five API routes are
 * the ones her client calls during a lesson. The four library modules are the
 * gate itself (`catalog.ts`), the landing decision (`student-landing.ts`) and
 * the two readers that apply the gate to her catalogue and her home
 * (`lesson.ts`, `subject-queries.ts`) — the places a commercial condition would
 * actually be written if anybody wrote one.
 *
 * `lib/catalog-queries.ts` is NOT in this list: it holds the student read AND
 * the console read in one file, so it gets the sharper test below instead of a
 * whole-file grep that could only ever say "it is mentioned somewhere".
 */
function studentReachableFiles(): string[] {
  return [
    ...filesUnder(join(APP, "(student)")),
    ...filesUnder(join(SRC, "components/student")),
    join(APP, "api/ask/route.ts"),
    join(APP, "api/attempts/route.ts"),
    join(APP, "api/understanding/route.ts"),
    join(APP, "api/uploads/route.ts"),
    join(APP, "api/uploads/[id]/route.ts"),
    join(SRC, "lib/catalog.ts"),
    join(SRC, "lib/student-landing.ts"),
    join(SRC, "lib/lesson.ts"),
    join(SRC, "lib/subject-queries.ts"),
  ];
}

test("no student surface and no visibility rule reads requires_plan", () => {
  const files = studentReachableFiles();
  assert.ok(
    files.length >= 12,
    "the scan found almost nothing — the paths are wrong, not the code"
  );

  const offenders: string[] = [];
  for (const file of files) {
    const src = code(readFileSync(file, "utf8"));
    for (const needle of FORBIDDEN) {
      if (src.includes(needle)) offenders.push(`${file.slice(SRC.length)} mentions ${needle}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "requires_plan is a seam, not a feature: it is NULL on every row, nothing writes it,\n" +
      "and no student surface or visibility rule may read it. A commercial condition on\n" +
      "what a child can learn is what FR-2404 forbids for subscription_status, and this\n" +
      "column sits one word from the gate's own WHERE clause."
  );
});

/**
 * `lib/catalog-queries.ts` holds both halves of the feature — the student
 * gate's read and the console's — so the useful assertion is not "is it
 * mentioned" but "WHERE".
 */
test("in catalog-queries, requires_plan is selected only by the console's courseCatalog", () => {
  const src = code(readFileSync(join(SRC, "lib/catalog-queries.ts"), "utf8"));

  const start = src.indexOf("export async function courseCatalog");
  assert.ok(start > 0, "courseCatalog is gone or renamed — this test is now checking nothing");
  const after = src.indexOf("\nexport ", start + 1);
  const end = after === -1 ? src.length : after;

  for (let i = src.indexOf("requires_plan"); i !== -1; i = src.indexOf("requires_plan", i + 1)) {
    assert.ok(
      i >= start && i < end,
      `requires_plan is read at character ${i}, outside courseCatalog. The console may print ` +
        `this column; the student gate may not read it and setGradeRule may not write it.`
    );
  }
});

/**
 * The student side's read of the availability table, frozen by its own column
 * list.
 *
 * `availabilityFor` is the ONE query behind `visibleCoursesFor`, which is the
 * one question every student-side gate asks. Asserting the literal means a
 * fourth column added to it — however innocently — fails here rather than in
 * front of a student.
 */
test("the student gate's own read names three columns and no more", () => {
  const src = readFileSync(join(SRC, "lib/catalog-queries.ts"), "utf8");
  assert.ok(
    src.includes("SELECT course_id, grade, state FROM course_availability"),
    "the student-side availability read changed shape; if a column was added, say which and why"
  );
});

/** Nothing writes it either — the endpoint and the writer are both clean. */
test("no path writes requires_plan", () => {
  for (const file of [
    join(APP, "api/console/courses/route.console.ts"),
    join(APP, "api/console/students/[id]/courses/route.console.ts"),
  ]) {
    const src = code(readFileSync(file, "utf8"));
    for (const needle of FORBIDDEN) {
      assert.ok(
        !src.includes(needle),
        `${file.slice(SRC.length)} mentions ${needle} — the column stays NULL in this build`
      );
    }
  }
});

/**
 * The counterweight: a test that would still pass if the column were dropped
 * from the schema and the console is not a test of anything.
 */
test("the console does read and print it, so this cannot pass by the feature being gone", () => {
  const queries = code(readFileSync(join(SRC, "lib/catalog-queries.ts"), "utf8"));
  assert.ok(
    queries.includes("ca.requires_plan"),
    "courseCatalog no longer selects the column — an operator can no longer see that it is inert"
  );

  const grid = code(
    readFileSync(join(SRC, "components/console/CourseAvailabilityGrid.tsx"), "utf8")
  );
  assert.ok(grid.includes("requiresPlan"), "the Plan column is gone from the grid");

  // And the page says, in words an operator reads, that it is in force nowhere.
  const page = readFileSync(join(APP, "(console)/courses/page.console.tsx"), "utf8");
  assert.ok(
    page.includes("requires_plan") && /in force nowhere/i.test(page),
    "the Plan column must be labelled as recorded-only; a bare column reads as a rule"
  );
});
