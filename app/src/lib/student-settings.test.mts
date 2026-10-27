/**
 * The student's own settings (migration 043; FR-2013, FR-4010 as amended
 * 2026-10-27, FR-2310) — the parts that can be checked with no database.
 *
 *   · **Deletion clears every table that points at a student.** 043's
 *     `delete_own_account` deletes children first; a table added later with a
 *     foreign key to `students` and not added to the function would make every
 *     deletion fail with a constraint error, in front of the student. This
 *     reads every migration and fails here instead. (043's own verification
 *     block asserts the same against the live catalogue at deploy.)
 *   · **The student surface still never writes `students` directly**: 043
 *     grants no column, and the new writes are definer functions.
 *   · **The name rule is sign-up's.**
 *
 * What the functions DO on a real database — a rename, a re-resolved implied
 * curriculum recorded, a chosen one refused, a deletion that leaves no row —
 * is exercised against a scratch student in the local database by hand
 * (`docs/PROJECT_STATE.md`, 2026-10-27) until `scripts/ci-migrations.sh`
 * grows a `proof_043`.
 *
 * @covers FR-2013, FR-2310, FR-4010, FR-4012
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const MIGRATIONS = join(REPO, "db/migrations");
const M043 = readFileSync(join(MIGRATIONS, "043-student-settings.sql"), "utf8");
const SIGNUP = readFileSync(
  fileURLToPath(new URL("../app/api/auth/signup/route.ts", import.meta.url)),
  "utf8"
);

/** SQL with `--` comments removed. */
const code = (s: string) => s.replace(/--[^\n]*/g, "");

/** Every table some migration creates with a `student_id … REFERENCES students`. */
function tablesReferencingStudents(): string[] {
  const out = new Set<string>();
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = code(readFileSync(join(MIGRATIONS, f), "utf8"));
    for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g)) {
      if (/REFERENCES students\s*\(id\)/i.test(m[2])) out.add(m[1]);
    }
    for (const m of sql.matchAll(/ALTER TABLE (\w+)[^;]*REFERENCES students\s*\(id\)/gi)) {
      out.add(m[1]);
    }
  }
  return [...out].sort();
}

function deleteFunctionBody(): string {
  const m = code(M043).match(/FUNCTION delete_own_account\(\)[\s\S]*?\$fn\$([\s\S]*?)\$fn\$/);
  assert.ok(m, "043 defines delete_own_account");
  return m[1];
}

test("delete_own_account clears every table that references a student", () => {
  const body = deleteFunctionBody();
  const tables = tablesReferencingStudents();
  assert.ok(tables.length >= 15, `the scan found only ${tables.length} tables — has the migration style changed?`);
  const missing = tables.filter(
    (t) =>
      !new RegExp(`DELETE FROM public\\.${t}\\b`).test(body) &&
      !new RegExp(`UPDATE public\\.${t}\\b`).test(body)
  );
  assert.deepEqual(missing, [], "add these to delete_own_account and to 043's verification list");
});

test("delete_own_account deletes the student, then the account, last", () => {
  const body = deleteFunctionBody();
  const students = body.indexOf("DELETE FROM public.students");
  const accounts = body.indexOf("DELETE FROM public.accounts");
  assert.ok(students > 0 && accounts > students);
  for (const child of ["attempts", "ai_interactions", "sessions", "uploads"]) {
    assert.ok(body.indexOf(`DELETE FROM public.${child}`) < students, `${child} after students`);
  }
});

test("what FR-2306 keeps, deletion keeps", () => {
  const body = deleteFunctionBody();
  assert.doesNotMatch(body, /operator_reads|auth_events|cost_daily/);
});

test("043's writes are definer functions acting on the principal, and grant no column", () => {
  const sql = code(M043);
  assert.doesNotMatch(sql, /GRANT UPDATE/i);
  for (const fn of ["update_own_profile", "change_own_curriculum", "delete_own_account"]) {
    const body = sql.match(new RegExp(`FUNCTION ${fn}\\([\\s\\S]*?\\$fn\\$([\\s\\S]*?)\\$fn\\$`));
    assert.ok(body, `${fn} is defined`);
    assert.match(sql, new RegExp(`FUNCTION ${fn}\\([^)]*\\)[\\s\\S]*?SECURITY DEFINER`));
    assert.match(body[1], /current_setting\('app\.student_id', true\)/, `${fn} acts on the principal`);
    assert.match(sql, new RegExp(`ALTER FUNCTION ${fn}\\([^)]*\\) OWNER TO ainext_maint;`));
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION ${fn}\\([^)]*\\) FROM ainext_operator;`));
  }
});

test("a student's own curriculum change is recorded as hers (FR-4012)", () => {
  const body = code(M043).match(/FUNCTION change_own_curriculum[\s\S]*?\$fn\$([\s\S]*?)\$fn\$/)![1];
  assert.ok(
    body.indexOf("INSERT INTO public.student_curriculum_changes") <
      body.indexOf("UPDATE public.students\n     SET curriculum_system")
  );
  assert.match(body, /NULL, 'student', NULL\);/);
});

test("the settings name rule is sign-up's", async () => {
  const { NAME_MIN, NAME_MAX, validDisplayName } = await import("./student-settings.ts");
  assert.match(SIGNUP, new RegExp(`displayName\\.length < ${NAME_MIN} \\|\\| displayName\\.length > ${NAME_MAX}`));
  assert.equal(validDisplayName("  Mariam "), "Mariam");
  assert.equal(validDisplayName("M"), null);
  assert.equal(validDisplayName("x".repeat(41)), null);
  assert.equal(validDisplayName(42), null);
});
