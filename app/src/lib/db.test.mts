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

import { maintPool, pool, principalSetting, sequential } from "./db.ts";

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

test("sequential runs thunks one after another, not concurrently", async () => {
  // A fake shared client: `query` refuses to start a second call before the
  // first one finishes, exactly like pg@9 will. If `sequential` ever issued
  // the next thunk before awaiting the previous one, this would throw instead
  // of returning three ordered rows.
  let busy = false;
  const order: number[] = [];
  const fakeQuery = async (n: number): Promise<number> => {
    if (busy) throw new Error("client.query() called while already executing a query");
    busy = true;
    try {
      await new Promise((r) => setTimeout(r, 1));
      order.push(n);
      return n;
    } finally {
      busy = false;
    }
  };

  const [a, b, c] = await sequential([
    () => fakeQuery(1),
    () => fakeQuery(2),
    () => fakeQuery(3),
  ] as const);

  assert.deepEqual([a, b, c], [1, 2, 3]);
  assert.deepEqual(order, [1, 2, 3]);
});

test("sequential preserves each thunk's own result type in a fixed-order tuple", async () => {
  const [n, s, rows] = await sequential([
    () => Promise.resolve(7),
    () => Promise.resolve("seven"),
    () => Promise.resolve([{ id: 7 }]),
  ] as const);

  assert.equal(n, 7);
  assert.equal(s, "seven");
  assert.deepEqual(rows, [{ id: 7 }]);
});

test("sequential stops at the first rejection rather than running the rest", async () => {
  const ran: number[] = [];
  await assert.rejects(
    sequential([
      () => {
        ran.push(1);
        return Promise.resolve(1);
      },
      () => {
        ran.push(2);
        return Promise.reject(new Error("boom"));
      },
      () => {
        ran.push(3);
        return Promise.resolve(3);
      },
    ] as const),
    /boom/
  );
  // Same behaviour as `await`ing three statements in a row inside a
  // transaction: the third never runs once the second throws.
  assert.deepEqual(ran, [1, 2]);
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
