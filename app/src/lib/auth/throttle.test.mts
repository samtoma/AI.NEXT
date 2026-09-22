/**
 * @covers FR-2011, FR-2005
 *
 * The throttle window arithmetic and the lockout count.
 *
 * FR-2011 says the threshold and the period must be **documented rather than
 * discovered**. These assertions are that documentation in executable form: if
 * somebody changes 5 to 3 or 15 minutes to 5, this file says so before a
 * student finds out the hard way the night before an exam.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  ACCOUNT_FAILURE_LIMIT,
  IP_FAILURE_LIMIT,
  LOCKOUT_MS,
  WINDOW_MS,
  bumpThrottle,
  clearExpiredLockout,
  clearFailures,
  isLocked,
  limitReached,
  lockedUntil,
  lockoutExpired,
  noteCredentialFailure,
  retryAfterSeconds,
  windowStart,
  type Queryable,
} from "./throttle.ts";
import type { AuthEventArgs } from "./events.ts";

const NOW = new Date("2026-09-20T18:07:30Z");

function fakeDb(rowsFor: (sql: string) => Record<string, unknown>[] = () => []): Queryable & {
  sql: string[];
} {
  const sql: string[] = [];
  return {
    sql,
    query: async (text: string) => {
      sql.push(text);
      const rows = rowsFor(text);
      return { rows, rowCount: rows.length };
    },
  };
}

function recorder() {
  const seen: AuthEventArgs[] = [];
  return { seen, record: async (e: AuthEventArgs) => void seen.push(e) };
}

test("the documented numbers are the numbers", () => {
  assert.equal(ACCOUNT_FAILURE_LIMIT, 5, "5 failures for one account");
  assert.equal(IP_FAILURE_LIMIT, 20, "20 failures from one address");
  assert.equal(WINDOW_MS, 15 * 60 * 1000, "in 15 minutes");
  assert.equal(LOCKOUT_MS, 15 * 60 * 1000, "locked for 15 minutes");
});

test("a window is the 15-minute boundary below now, not now minus fifteen", () => {
  assert.equal(windowStart(NOW).toISOString(), "2026-09-20T18:00:00.000Z");
  assert.equal(
    windowStart(new Date("2026-09-20T18:14:59.999Z")).toISOString(),
    "2026-09-20T18:00:00.000Z"
  );
  assert.equal(
    windowStart(new Date("2026-09-20T18:15:00.000Z")).toISOString(),
    "2026-09-20T18:15:00.000Z"
  );
});

test("retryAfter counts to the end of the current window and is never zero", () => {
  assert.equal(retryAfterSeconds(NOW), 7 * 60 + 30);
  assert.equal(retryAfterSeconds(new Date("2026-09-20T18:14:59.500Z")), 1);
  assert.ok(retryAfterSeconds(new Date("2026-09-20T18:15:00.000Z")) > 0);
});

test("the limit is reached AT the threshold, not after it", () => {
  assert.equal(limitReached(4, ACCOUNT_FAILURE_LIMIT), false);
  assert.equal(limitReached(5, ACCOUNT_FAILURE_LIMIT), true, "the FIFTH failure locks");
  assert.equal(limitReached(6, ACCOUNT_FAILURE_LIMIT), true);
});

test("a lockout is in force until its deadline and expired at it", () => {
  const until = lockedUntil(NOW);
  assert.equal(until.getTime(), NOW.getTime() + LOCKOUT_MS);
  assert.equal(isLocked(until, NOW), true);
  assert.equal(isLocked(until, new Date(until.getTime() + 1)), false);
  assert.equal(isLocked(null, NOW), false);
  assert.equal(lockoutExpired(null, NOW), false, "never locked is not expired");
  assert.equal(lockoutExpired(until, new Date(until.getTime() + 1)), true);
});

test("the counter is one atomic upsert keyed by the window", async () => {
  const db = fakeDb(() => [{ count: 3 }]);
  const count = await bumpThrottle(db, "ip", "10.0.0.1", NOW);
  assert.equal(count, 3);
  assert.ok(db.sql[0]!.includes("ON CONFLICT (scope, key, window_start)"));
  assert.ok(db.sql[0]!.includes("count = auth_throttle.count + 1"));
});

// FR-2011 — and the event Talent defines and never emits (R1 §5).
test("the fifth failure locks the account for 15 minutes and says so", async () => {
  const db = fakeDb((sql) => (sql.includes("INSERT INTO auth_throttle") ? [{ count: 5 }] : []));
  const { seen, record } = recorder();
  const out = await noteCredentialFailure(db, "accounts", 42, record, {}, NOW);

  assert.equal(out.locked, true);
  assert.equal(out.until?.getTime(), NOW.getTime() + LOCKOUT_MS);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.event, "account_locked");
  assert.equal(seen[0]!.actor?.id, 42);
  assert.ok(db.sql.some((s) => s.includes("status = 'locked'")));
});

test("the fourth failure does not lock and emits nothing", async () => {
  const db = fakeDb((sql) => (sql.includes("INSERT INTO auth_throttle") ? [{ count: 4 }] : []));
  const { seen, record } = recorder();
  const out = await noteCredentialFailure(db, "accounts", 42, record, {}, NOW);

  assert.equal(out.locked, false);
  assert.equal(seen.length, 0);
  assert.ok(db.sql.every((s) => !s.includes("locked_until = $3")));
});

/**
 * Regression, found live against `ainext_app` on 2026-09-20: this used to
 * DELETE the counter row, `ainext_app` has no DELETE on `auth_throttle`, and
 * the JS catch around it swallowed a `permission denied` that had ALREADY
 * aborted the transaction — so the next correct password after a password reset
 * returned 500. A caught SQL error inside a transaction is not a caught error.
 */
test("a clean sign-in zeroes the counter without a DELETE", async () => {
  const db = fakeDb();
  await clearFailures(db, "accounts", 42);
  assert.equal(
    db.sql.some((s) => /delete/i.test(s)),
    false,
    "ainext_app has no DELETE on auth_throttle — a DELETE here poisons the transaction"
  );
  assert.ok(db.sql.some((s) => s.includes("UPDATE auth_throttle SET count = 0")));
  assert.ok(db.sql.some((s) => s.includes("failed_attempts = 0, locked_until = NULL")));
});

test("an expired lockout is cleared once, and clearing is the event", async () => {
  const db = fakeDb();
  const { seen, record } = recorder();
  const past = new Date(NOW.getTime() - 1000);

  assert.equal(await clearExpiredLockout(db, "accounts", 42, past, record, {}, NOW), true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.event, "lockout_cleared");
  assert.equal(seen[0]!.reason, "expired");

  // Still in force, and never locked at all: neither clears, neither emits.
  assert.equal(
    await clearExpiredLockout(db, "accounts", 42, lockedUntil(NOW), record, {}, NOW),
    false
  );
  assert.equal(await clearExpiredLockout(db, "accounts", 42, null, record, {}, NOW), false);
  assert.equal(seen.length, 1);
});
