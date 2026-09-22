/**
 * @covers FR-2103, FR-2101
 *
 * The decidable half of the student-context seam.
 *
 * `resolveStudentId`, `resolveStudentContext` and `scoped` all need either
 * `next/headers` or a pool, so what they do is proved by the red-team script
 * and `app/scripts/rls-proof.sql` against a real Postgres — a mock that returns
 * whatever we tell it to proves nothing about a policy.
 *
 * What IS decidable without a database is the rule that decides WHICH SHAPE OF
 * FAILURE a route reports, and that rule is load-bearing in both directions:
 *
 *  - call a missing GRANT an attack and a deployment mistake turns into a 403
 *    plus a `cross_student_access_denied` row — the one event whose alert
 *    threshold is zero — so our own misconfiguration reads as a student
 *    attacking another student, and the alert that should never fire fires
 *    every time;
 *  - call an attack a bug and a genuine cross-student write answers 500,
 *    records nothing, and the isolation proof loses the only evidence it has
 *    that isolation is working.
 *
 * Both errors carry SQLSTATE 42501. Only one of them carries the message.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { isRlsWriteDenied, RLS_SQLSTATE } from "./rls-errors.ts";

/** What node-postgres hands back: an Error with `code` and `message`. */
function pgError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

test("a refused cross-student write is a denial", () => {
  assert.equal(
    isRlsWriteDenied(
      pgError(
        RLS_SQLSTATE,
        'new row violates row-level security policy for table "attempts"'
      )
    ),
    true
  );
});

test("the SELECT-side wording counts too", () => {
  // `USING` failures on an UPDATE/DELETE word it without "new row".
  assert.equal(
    isRlsWriteDenied(
      pgError(RLS_SQLSTATE, 'violates row-level security policy for table "mastery"')
    ),
    true
  );
});

test("a missing GRANT is OUR bug, not an attack", () => {
  // Same SQLSTATE, different sentence. This must stay a 500: a table we forgot
  // to grant is a deployment error, and dressing it up as a security event
  // would make the zero-threshold alert meaningless.
  assert.equal(
    isRlsWriteDenied(pgError(RLS_SQLSTATE, "permission denied for table cost_daily")),
    false
  );
});

test("the right message under the wrong code is not a denial", () => {
  // Defence against a future caller that wraps the error and loses the code:
  // the pair is the evidence, not either half.
  assert.equal(
    isRlsWriteDenied(pgError("23505", "new row violates row-level security policy")),
    false
  );
});

test("ordinary failures are not denials", () => {
  assert.equal(isRlsWriteDenied(pgError("23503", "insert violates foreign key")), false);
  assert.equal(isRlsWriteDenied(new Error("connection terminated")), false);
});

test("nothing at all is not a denial", () => {
  // A route's catch block sees whatever was thrown, which need not be an Error.
  for (const notAnError of [null, undefined, "42501", 42501, {}, []]) {
    assert.equal(isRlsWriteDenied(notAnError), false);
  }
});
