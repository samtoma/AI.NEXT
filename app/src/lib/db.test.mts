/**
 * @covers FR-2101, FR-2102, FR-2105
 *
 * The decidable half of `lib/db.ts`. Whether the policies actually refuse a row
 * is a question only Postgres can answer, and it is answered by
 * `app/scripts/rls-proof.sql` (run AS `ainext_app`, because run as a superuser
 * it proves the opposite of what it claims) and by the red-team script.
 *
 * What IS decidable here is the rule that decides what the database is told:
 * which principals scope a query and which set nothing at all. Getting that
 * wrong in the "sets nothing" direction is invisible — the query simply returns
 * no rows and looks like an empty dashboard — and getting it wrong in the other
 * direction is the bug this whole feature exists to remove.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { maintPool, pool, principalSetting } from "./db.ts";

test("a student principal scopes to their own id", () => {
  assert.equal(
    principalSetting({ kind: "student", studentId: 7, accountId: 3, emailVerified: true }),
    "7"
  );
  // Verification gates learning, not the principal: an unverified student is
  // still exactly one student, and still sees only their own rows.
  assert.equal(
    principalSetting({ kind: "student", studentId: 7, accountId: 3, emailVerified: false }),
    "7"
  );
});

test("a bare number is student-id shorthand", () => {
  assert.equal(principalSetting(12), "12");
});

test("anonymous sets nothing — the fail-closed state", () => {
  // null means "do not set app.student_id at all", which makes every policy
  // predicate NULL, which returns zero rows rather than everybody's.
  assert.equal(principalSetting({ kind: "anonymous" }), null);
});

test("an operator sets no student principal", () => {
  // The console reads through `ainext_operator` and its own connection. Setting
  // a student principal for an operator would silently narrow a cross-student
  // read to one student and look like missing data.
  assert.equal(
    principalSetting({ kind: "operator", operatorId: 1, roles: ["student-data"] }),
    null
  );
});

test("a nonsense student id is refused rather than passed through", () => {
  // `nullif(...)::bigint` would raise inside the policy and surface as a
  // database error from whatever query happened to run first.
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => principalSetting(bad), /not a student id/);
  }
});

test("the pool is sized for units of work, not for one connection per query", () => {
  // research R7: max 5 was sized for a pool lending a connection per query.
  // Holding one for a transaction at 5 exhausts the pool during five concurrent
  // lessons while doing almost no database work.
  const options = (pool as unknown as { options?: { max?: number } }).options;
  assert.equal(options?.max, 20);
});

test("withMaint refuses to fall back to the application role", () => {
  const saved = process.env.DATABASE_URL_MAINT;
  delete process.env.DATABASE_URL_MAINT;
  try {
    assert.throws(() => maintPool(), /DATABASE_URL_MAINT is not set/);
  } finally {
    if (saved !== undefined) process.env.DATABASE_URL_MAINT = saved;
  }
});
