/**
 * "Only an operator changes a curriculum" stays a DATABASE fact (FR-4017;
 * privacy review F8; data-model.md §2).
 *
 * Migration 017 re-runs every deploy and grants the student-facing role
 * (`ainext_app`) a table-wide UPDATE on `students`, which covers
 * `curriculum_system` and every column added later. Migration 033, which
 * sorts after it, revokes that and grants back only the columns the student
 * surface writes. Two ways that could quietly break:
 *
 *   · 033 stops revoking (or grants a curriculum column back), and the
 *     student surface can change its own curriculum again;
 *   · somebody adds an `UPDATE students SET <column>` to a student surface
 *     that 033 does not grant — and the narrower grant turns it into a
 *     "permission denied" in production, found by a student.
 *
 * This file fails on both, with no database: it reads 033 and the app source.
 * What the grants DO on a real database is proved by
 * `scripts/ci-migrations.sh` (`proof_033`): the app role refused on every
 * curriculum column, the Google step once, the console as itself, the
 * rollback restoring 017's grant.
 *
 * @covers FR-4017, FR-4014
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("../..", import.meta.url));
const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const M033 = readFileSync(join(REPO, "db/migrations/033-curriculum-tracks.sql"), "utf8");
const R033 = readFileSync(join(REPO, "db/migrations/rollback/033-curriculum-tracks.down.sql"), "utf8");
const M017 = readFileSync(join(REPO, "db/migrations/017-rls-roles-and-policies.sql"), "utf8");

/** SQL with `--` comments removed, whitespace squashed. */
const sql = (s: string) => s.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");

/** The columns 033 grants `ainext_app` UPDATE on. */
function appUpdateColumns(): string[] {
  const m = sql(M033).match(/GRANT UPDATE \(([^)]*)\) ON students TO ainext_app;/);
  assert.ok(m, "033 grants ainext_app a column-level UPDATE on students");
  return m[1].split(",").map((c) => c.trim());
}

const CURRICULUM_COLUMNS = ["curriculum_system", "curriculum_source", "onboarding_pending"];

test("033 revokes 017's table-wide UPDATE, and grants the student surface no curriculum column", () => {
  // 017 still grants it table-wide on every run — the reason 033 exists
  assert.match(sql(M017), /GRANT SELECT, INSERT, UPDATE ON students TO ainext_app;/);
  const s = sql(M033);
  const revoke = s.indexOf("REVOKE UPDATE ON students FROM ainext_app;");
  const grant = s.indexOf("GRANT UPDATE (");
  assert.ok(revoke >= 0, "033 revokes the table-wide UPDATE");
  assert.ok(revoke < grant, "…before it grants the columns back");
  const cols = appUpdateColumns();
  for (const c of CURRICULUM_COLUMNS) assert.ok(!cols.includes(c), `ainext_app must not be granted ${c}`);
  assert.deepEqual(cols, ["design_variant"], "the one column the student surface writes today");
  // nothing else in 033 hands the student surface a way to write students
  assert.equal((s.match(/ON students TO ainext_app/g) ?? []).length, 1);
  // the console gets the curriculum and how it was set — and not the pending step
  assert.match(s, /GRANT UPDATE \(curriculum_system, curriculum_source\) ON students TO ainext_operator;/);
  // 033 sorts after 017, so its narrowing is the last word on every deploy
  assert.ok("033-curriculum-tracks.sql" > "017-rls-roles-and-policies.sql");
});

test("the once-only step is a definer function the student surface may run, and nobody else (FR-4014)", () => {
  const s = sql(M033);
  assert.match(s, /CREATE OR REPLACE FUNCTION complete_student_onboarding\( p_grade text, p_curriculum text, p_source text \)/);
  assert.match(s, /SECURITY DEFINER SET search_path = pg_catalog, pg_temp/);
  assert.match(s, /WHERE id = acting AND onboarding_pending;/, "acts on the acting student only, while pending");
  assert.match(s, /RAISE EXCEPTION 'onboarding_already_completed' USING ERRCODE = 'AN409'/, "a second call is refused, loudly");
  assert.match(s, /ALTER FUNCTION complete_student_onboarding\(text, text, text\) OWNER TO ainext_maint;/);
  assert.match(s, /REVOKE ALL ON FUNCTION complete_student_onboarding\(text, text, text\) FROM PUBLIC;/);
  assert.match(s, /GRANT EXECUTE ON FUNCTION complete_student_onboarding\(text, text, text\) TO ainext_app;/);
  // the app's caller maps that SQLSTATE, so the step cannot become a silent no-op
  const lib = readFileSync(join(APP, "src/lib/curriculum-queries.ts"), "utf8");
  assert.match(lib, /const ONBOARDING_ALREADY_COMPLETED = "AN409";/);
});

test("the rollback restores 017's grant and keeps the curriculum", () => {
  const r = sql(R033);
  assert.match(r, /GRANT UPDATE ON students TO ainext_app;/);
  assert.match(r, /DROP FUNCTION IF EXISTS complete_student_onboarding\(text, text, text\);/);
  assert.match(r, /DROP TABLE IF EXISTS student_curriculum_changes;/);
  assert.doesNotMatch(r, /DROP COLUMN IF EXISTS curriculum_system/, "curriculum_system predates 033 (009)");
});

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== "node_modules") walk(full);
      } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) {
        out.push(relative(APP, full));
      }
    }
  };
  walk(join(APP, "src"));
  return out;
}

/** Console code runs as `ainext_operator`, whose grants are separate. */
const isConsole = (f: string) => /\.console\.tsx?$/.test(f) || f.includes("/(console)/");

/** The files whose `UPDATE students` runs as the operator role (`withOperator`). */
const OPERATOR_WRITERS = new Set(["src/lib/curriculum-queries.ts"]);

test("every UPDATE the student surface makes to students names only columns 033 grants it", () => {
  const granted = new Set(appUpdateColumns());
  const found: string[] = [];
  for (const f of sourceFiles()) {
    if (isConsole(f) || OPERATOR_WRITERS.has(f)) continue;
    const code = readFileSync(join(APP, f), "utf8");
    for (const m of code.matchAll(/UPDATE\s+students\s+SET\s+([\s\S]*?)\s+WHERE\b/gi)) {
      const cols = [...m[1].matchAll(/(\w+)\s*=/g)].map((c) => c[1]);
      for (const c of cols) {
        found.push(`${f}: ${c}`);
        assert.ok(
          granted.has(c),
          `${f} updates students.${c}, which migration 033 does not grant ainext_app — add it to 033's ` +
            `column list (never a curriculum column: FR-4017), or the write fails with "permission denied"`
        );
      }
    }
  }
  assert.deepEqual(found, ["src/lib/design-variant-queries.ts: design_variant"], "the scan sees today's one writer");
});

test("the operator's curriculum writes run as the operator, and the student's through the definer only", () => {
  const lib = readFileSync(join(APP, "src/lib/curriculum-queries.ts"), "utf8");
  // setStudentCurriculum: inside withOperator, with its history row first
  const set = lib.slice(lib.indexOf("export async function setStudentCurriculum"), lib.indexOf("export type OnboardingResult"));
  assert.match(set, /return withOperator\(operatorId, async \(db\) => \{/);
  assert.ok(set.indexOf("INSERT INTO student_curriculum_changes") < set.indexOf("UPDATE students SET curriculum_system"));
  // completeOnboarding: the definer, never a direct UPDATE
  const onboard = lib.slice(lib.indexOf("export async function completeOnboarding"));
  assert.match(onboard, /SELECT complete_student_onboarding\(\$1, \$2, \$3\)/);
  assert.doesNotMatch(onboard, /UPDATE\s+students/i);
});
