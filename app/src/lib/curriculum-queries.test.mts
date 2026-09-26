/**
 * The server half of the curriculum screens — what a grade offers, the
 * once-only first-Google-sign-in step, and the console's change — with a fake
 * pool (feature 003).
 *
 * What the DATABASE does with these calls is proved on a real Postgres by
 * `scripts/ci-migrations.sh` (`proof_033`): the student role cannot write a
 * curriculum column, `complete_student_onboarding()` works once and raises
 * SQLSTATE AN409 after, the console records a change as itself. This file
 * proves the TypeScript in front of it: that nothing reaches the database
 * before the input is validated against the registry and the offer rule, that
 * the definer is called with the resolved curriculum and how it was set, and
 * that a second call surfaces as `already_completed` — never a silent success.
 *
 * @covers FR-4004, FR-4005, FR-4010, FR-4014
 */
process.env.AINEXT_COURSE_GATING = "on";

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { PoolClient } from "pg";

// Imported AFTER the switch is set: `lib/env.ts` resolves it once, at load,
// and a static import would be evaluated before the assignment above.
const { pool } = await import("./db.ts");
const { COURSE_GATING, ENVIRONMENT } = await import("./env.ts");
const { completeOnboarding, offeredCurriculaFor, setStudentCurriculum } = await import("./curriculum-queries.ts");
assert.equal(COURSE_GATING, true, "this file proves the gate ON");

const MATH = "course:prep3-math-en";
const G10 = "course:us-g10-math-en";

let rules: { course_id: string; grade: string; state: string }[] = [];
let calls: { text: string; values?: unknown[] }[] = [];
let onboardingSpent = false;

/** Rules and the definer, nothing else; anything unexpected throws. */
function answer(text: string, values?: unknown[]) {
  calls.push({ text, values });
  const sql = text.replace(/\s+/g, " ").trim();
  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
  if (sql.startsWith("SELECT set_config('app.student_id'")) return { rows: [] };
  if (sql.startsWith("SELECT course_id, grade, state FROM course_availability WHERE environment = $1")) {
    assert.equal(values?.[0], ENVIRONMENT, "the rules of THIS environment");
    return { rows: rules };
  }
  if (sql.startsWith("SELECT complete_student_onboarding($1, $2, $3)")) {
    if (onboardingSpent) throw Object.assign(new Error("onboarding_already_completed"), { code: "AN409" });
    onboardingSpent = true;
    return { rows: [{}] };
  }
  throw new Error(`unexpected query: ${sql.slice(0, 160)}`);
}

(pool as unknown as { query: (t: string, v?: unknown[]) => unknown }).query = async (t, v) => answer(t, v);
(pool as unknown as { connect: () => Promise<PoolClient> }).connect = async () =>
  ({ query: async (t: string, v?: unknown[]) => answer(t, v), release() {} }) as unknown as PoolClient;

beforeEach(() => {
  rules = [
    { course_id: MATH, grade: "9", state: "live" },
    { course_id: G10, grade: "10", state: "live" },
  ];
  calls = [];
  onboardingSpent = false;
});

const definerCalls = () => calls.filter((c) => c.text.includes("complete_student_onboarding"));

test("offeredCurriculaFor reads this environment's live rules — the one offer rule (FR-4004)", async () => {
  assert.deepEqual(await offeredCurriculaFor("9"), ["eg-national-en"]);
  assert.deepEqual(await offeredCurriculaFor("10"), ["us-american-en"]);
  assert.deepEqual(await offeredCurriculaFor("11"), []);
  rules.push({ course_id: "course:prep3-social-ar", grade: "10", state: "live" });
  assert.deepEqual(await offeredCurriculaFor("10"), ["eg-national-en", "us-american-en"]);
});

test("the Google step validates before it writes: grade, then curriculum, then the offer", async () => {
  assert.deepEqual(await completeOnboarding(7, { grade: "13", curriculum: "us-american-en" }), {
    ok: false,
    reason: "invalid_grade",
  });
  assert.equal(calls.length, 0, "an invalid grade reaches no database");
  const unknown = await completeOnboarding(7, { grade: "10", curriculum: "american" });
  assert.equal(unknown.ok, false);
  assert.equal(!unknown.ok && unknown.reason, "invalid_curriculum");
  // a grade that offers two curricula must be answered, among what it offers
  rules.push({ course_id: "course:prep3-social-ar", grade: "10", state: "live" });
  const unanswered = await completeOnboarding(7, { grade: "10" });
  assert.deepEqual(unanswered, {
    ok: false,
    reason: "curriculum_required",
    offered: ["eg-national-en", "us-american-en"],
  });
  assert.equal(definerCalls().length, 0, "nothing was written");
});

test("the Google step writes once, through the definer, with the resolved curriculum and how it was set", async () => {
  // grade 10 offers only American: stored as implied, whatever was sent
  const first = await completeOnboarding(7, { grade: "10", curriculum: "eg-national-en" });
  assert.deepEqual(first, {
    ok: true,
    grade: "10",
    curriculum: "us-american-en",
    source: "implied",
    resolvedFrom: "eg-national-en",
  });
  assert.deepEqual(definerCalls().map((c) => c.values), [["10", "us-american-en", "implied"]]);
  // a second submission is refused, loudly (FR-4014)
  const second = await completeOnboarding(7, { grade: "9", curriculum: "eg-national-en" });
  assert.deepEqual(second, { ok: false, reason: "already_completed" });
});

test("a chosen curriculum is stored as chosen; the legacy prep-3 grade is the same year as 9", async () => {
  rules.push({ course_id: "course:prep3-social-ar", grade: "10", state: "live" });
  const out = await completeOnboarding(7, { grade: "10", curriculum: "us-american-en" });
  assert.equal(out.ok && out.source, "chosen");
  calls = [];
  onboardingSpent = false;
  const legacy = await completeOnboarding(8, { grade: "prep-3" });
  assert.deepEqual(legacy.ok && [legacy.grade, legacy.curriculum, legacy.source], ["9", "eg-national-en", "implied"]);
});

test("the console's change refuses a curriculum the registry does not know, before any database", async () => {
  for (const bad of ["american", "", null, "US-AMERICAN-EN"]) {
    assert.deepEqual(await setStudentCurriculum(1, 7, bad, null), { ok: false, reason: "unknown_curriculum" });
  }
  assert.equal(calls.length, 0);
});
