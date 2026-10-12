/**
 * FR-3218: every Term 2 module's label names its term, `module:geo-u1` reads
 * "Term 2 · Unit 4 — The Circle", and nothing that renders a module label
 * says the term twice.
 *
 * Samuel, 2026-09-25: *"Fix that as well for sure, i thought they are all
 * from the same source."* `module:geo-u1` was the one Term 2 module whose label
 * said nothing ("Unit 4 — The Circle"), though its `syllabus_ref` is "Second
 * Term — Geometry Unit 4" — and the check-in carried a special case for it.
 *
 * Three layers, all checked here without a database:
 *   · the seed, which every fresh database is loaded from;
 *   · migration 031 and its rollback, which carry the fix to the database
 *     production already has (its graph was loaded once and deploys do not
 *     reload it) — their SQL is read and its strings decoded, so the value
 *     the migration writes can never drift from the seed's;
 *   · the rendering: the check-in's helpers (lib/module-term.ts) run on every
 *     seeded maths module, and the check-in's source is scanned for the old
 *     special case. `term-labels-db.test.mts` runs the migration for real.
 *
 * @covers FR-3218
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { moduleHeading, termOfModule, termOfSlug, withoutTerm } from "./module-term.ts";
import { PREP3_MATH_EN, US_G10_MATH_EN } from "./courses.ts";
import { slugOfLo } from "./lesson-slug.ts";
import { readMathsSeeds } from "./spine-maths-fixture.mts";

const APP = fileURLToPath(new URL("../..", import.meta.url));
const REPO = fileURLToPath(new URL("../../..", import.meta.url));

const NEW_LABEL = "Term 2 · Unit 4 — The Circle";
const OLD_LABEL = "Unit 4 — The Circle";

const { nodes, edges } = readMathsSeeds();
const modules = nodes.filter((n) => n.kind === "module");
const count = (s: string, sub: string) => s.split(sub).length - 1;

/* ------------------------------------------------------------------ */
/* The seed                                                            */
/* ------------------------------------------------------------------ */

test("the seed: module:geo-u1 reads \"Term 2 · Unit 4 — The Circle\", and is Term 2 by its own syllabus_ref", () => {
  const geo = modules.find((m) => m.id === "module:geo-u1");
  assert.ok(geo);
  assert.equal(geo.label, NEW_LABEL);
  assert.equal(geo.syllabus_ref, "Second Term — Geometry Unit 4");
});

test("every Term 2 maths module's label names its term; no Term 1 label does", () => {
  assert.equal(modules.length, 10);
  const term2 = modules.filter((m) => termOfModule(m.id, PREP3_MATH_EN) === 2);
  assert.deepEqual(
    term2.map((m) => m.id).sort(),
    ["module:geo-u1", "module:geo-u2", "module:t2-u1", "module:t2-u2", "module:t2-u3"]
  );
  for (const m of term2) assert.ok(m.label.startsWith("Term 2 · "), `${m.id}: "${m.label}"`);
  for (const m of modules.filter((m) => termOfModule(m.id, PREP3_MATH_EN) === 1)) {
    assert.doesNotMatch(m.label, /^\s*Term\b/, `${m.id}: a Term 1 label carries no term`);
  }
});

/* ------------------------------------------------------------------ */
/* The rendering                                                       */
/* ------------------------------------------------------------------ */

test("no double prefix: every maths module, as the check-in composes it, says its term exactly once", () => {
  for (const m of modules) {
    const heading = moduleHeading(m.id, m.label, PREP3_MATH_EN);
    assert.equal(count(heading, "Term"), 1, heading);
    assert.ok(heading.startsWith(`Term ${termOfModule(m.id, PREP3_MATH_EN)} · Unit `), heading);
  }
  assert.equal(moduleHeading("module:geo-u1", NEW_LABEL, PREP3_MATH_EN), NEW_LABEL);
  // …and the same on a database migration 031 has not reached yet
  assert.equal(moduleHeading("module:geo-u1", OLD_LABEL, PREP3_MATH_EN), NEW_LABEL);
});

test("the lesson card's subtitle and the picker's eyebrow and title, for every Unit-4 geometry lesson", () => {
  const geoLessons = [
    ...new Set(
      edges.filter((e) => e.type === "teaches" && e.src === "module:geo-u1").map((e) => slugOfLo(e.dst))
    ),
  ];
  assert.deepEqual(geoLessons.sort(), ["geo1-1", "geo1-2", "geo1-3", "geo1-4"]);
  for (const slug of geoLessons) {
    // PlayCheckIn: "Term {termOfSlug} · {withoutTerm(moduleLabel)}"
    const subtitle = `Term ${termOfSlug(slug, PREP3_MATH_EN)} · ${withoutTerm(NEW_LABEL)}`;
    assert.equal(subtitle, NEW_LABEL, slug);
  }
  // the picker splits the plain label on the em dash: eyebrow "Term 2 · Unit 4", title "The Circle"
  const [unitRef, ...rest] = withoutTerm(NEW_LABEL).split(" — ");
  assert.equal(`Term ${termOfModule("module:geo-u1", PREP3_MATH_EN)} · ${unitRef}`, "Term 2 · Unit 4");
  assert.equal(rest.join(" — "), "The Circle");
});

test("003: a course without school terms names no term, and its label is printed as it is (FR-4203)", () => {
  // The Grade 10 book is chapters and sections (lib/courses.ts: terms null).
  assert.equal(termOfModule("module:g10m-c01", US_G10_MATH_EN), null);
  assert.equal(termOfSlug("g10m1s1-1", US_G10_MATH_EN), null);
  assert.equal(moduleHeading("module:g10m-c01", "Chapter 1 — Algebraic expressions", US_G10_MATH_EN), "Chapter 1 — Algebraic expressions");
  // even a G10 module id that looked like a Prep-3 term prefix would not borrow its term
  assert.equal(termOfModule("module:geo-x", US_G10_MATH_EN), null);
  // and a course the registry does not know claims nothing
  assert.equal(termOfModule("module:geo-u1", "course:unknown"), null);
  // National Social Studies and Arabic keep the "Term 1" they have always printed
  assert.equal(termOfModule("module:soc1", "course:prep3-social-ar"), 1);
  assert.equal(termOfModule("module:ara5", "course:prep3-arabic-ar"), 1);
});

/** Source with comments removed. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("the check-in's special case is gone: shared helpers, and no stored label prefixed as-is", () => {
  const src = readFileSync(join(APP, "src/components/student/LessonCheckIn.tsx"), "utf8");
  const c = code(src);
  assert.match(
    c,
    /import \{\s*moduleHeading,\s*termOfModule,\s*termOfSlug,\s*withoutTerm,\s*\} from "@\/lib\/module-term";/
  );
  for (const fn of ["termOfModule", "termOfSlug", "withoutTerm", "moduleHeading"]) {
    assert.doesNotMatch(c, new RegExp(`const ${fn}\\s*=|function ${fn}\\(`), `${fn} is not redefined`);
  }
  // the two literal prefixes the Arabic/Social card put in front of m.label
  assert.doesNotMatch(c, /"Term [12] · "/);
  assert.match(c, /\{moduleHeading\(m\.id, m\.label, m\.courseId\)\}/);
  // nothing in it — code or comment — still names the module or its old label
  assert.doesNotMatch(src, /geo-u1|The Circle/);
});

/* ------------------------------------------------------------------ */
/* No copy of the old label left behind                                */
/* ------------------------------------------------------------------ */

function filesUnder(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "node_modules") out.push(...filesUnder(full, ext));
    } else if (ext.test(entry)) out.push(full);
  }
  return out;
}

test("the old label survives nowhere in the app or the seeds — only in the migration pair that needs it", () => {
  // the new label contains the old one, so it is removed before looking
  const stillOld = (text: string) => text.replaceAll(NEW_LABEL, "").includes(OLD_LABEL);
  assert.ok(stillOld(`module: "${OLD_LABEL}",`) && !stillOld(`module: "${NEW_LABEL}",`));
  const hits = [
    ...filesUnder(join(APP, "src"), /\.(ts|tsx|mts)$/).filter((f) => !/\.test\.mts$/.test(f)),
    ...filesUnder(join(REPO, "services/extraction/seed"), /\.json$/),
  ]
    .filter((f) => stillOld(readFileSync(f, "utf8")))
    .map((f) => relative(REPO, f));
  assert.deepEqual(hits, []);
});

/* ------------------------------------------------------------------ */
/* Migration 031 and its rollback                                      */
/* ------------------------------------------------------------------ */

/** `U&'…'` literals decoded (`\XXXX` → the code point), as Postgres reads them. */
function decodeUnicodeLiterals(sql: string): string[] {
  return [...sql.matchAll(/U&'((?:[^']|'')*)'/g)].map((m) =>
    m[1].replace(/''/g, "'").replace(/\\([0-9A-Fa-f]{4})/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  );
}

const migration = readFileSync(join(REPO, "db/migrations/031-geo-u1-term-label.sql"), "utf8");
const rollback = readFileSync(join(REPO, "db/migrations/rollback/031-geo-u1-term-label.down.sql"), "utf8");
/** SQL with `--` comments removed. */
const sqlOnly = (s: string) => s.replace(/--[^\n]*/g, "");

test("031 writes exactly the seed's label, to module:geo-u1 only, and only over the old text", () => {
  const sql = sqlOnly(migration);
  const strings = decodeUnicodeLiterals(sql);
  const seedLabel = modules.find((m) => m.id === "module:geo-u1")!.label;
  assert.ok(strings.includes(seedLabel), "the value 031 writes is the seed's label");
  assert.ok(strings.includes(OLD_LABEL));
  // one UPDATE, of one column, guarded by the id AND the old text
  const updates = [...sql.matchAll(/UPDATE\s+(\w+)\s+SET\s+([\s\S]*?);/g)];
  assert.equal(updates.length, 1);
  assert.equal(updates[0][1], "graph_nodes");
  assert.match(
    updates[0][2].replace(/\s+/g, " "),
    /^label = U&'Term 2 \\00B7 Unit 4 \\2014 The Circle' WHERE id = 'module:geo-u1' AND label = U&'Unit 4 \\2014 The Circle'$/
  );
  // a re-run finds nothing: the guard is a SELECT for the old text
  assert.match(sql.replace(/\s+/g, " "), /IF EXISTS \(SELECT 1 FROM graph_nodes WHERE id = 'module:geo-u1' AND label = U&'Unit 4 \\2014 The Circle'\) THEN UPDATE/);
  // data only: nothing else in the database is touched
  assert.doesNotMatch(sql, /\b(INSERT|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT)\b/i);
});

test("the rollback is 031 mirrored: the old text back, only over the new text", () => {
  const sql = sqlOnly(rollback);
  const updates = [...sql.matchAll(/UPDATE\s+(\w+)\s+SET\s+([\s\S]*?);/g)];
  assert.equal(updates.length, 1);
  assert.match(
    updates[0][2].replace(/\s+/g, " "),
    /^label = U&'Unit 4 \\2014 The Circle' WHERE id = 'module:geo-u1' AND label = U&'Term 2 \\00B7 Unit 4 \\2014 The Circle'$/
  );
  assert.deepEqual(new Set(decodeUnicodeLiterals(sql)), new Set([NEW_LABEL, OLD_LABEL]));
  assert.doesNotMatch(sql, /\b(INSERT|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT)\b/i);
});

test("the deploy's migration floor counts every migration file (031; 032 since v0.9.3; 033 and 034 since 003)", () => {
  const files = readdirSync(join(REPO, "db/migrations")).filter((f) => f.endsWith(".sql"));
  const floor = Number(
    readFileSync(join(REPO, "deploy/apply-migrations.sh"), "utf8").match(/\[ "\$applied" -ge (\d+) \]/)?.[1]
  );
  assert.ok(files.includes("031-geo-u1-term-label.sql"));
  assert.equal(floor, files.length, "apply-migrations.sh's floor is the number of migration files");
});
