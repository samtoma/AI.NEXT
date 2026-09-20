/**
 * @covers FR-2501, FR-2003
 *
 * **SC-106: thirteen of thirteen.** One test per named security event,
 * asserting it is emitted FROM ITS BRANCH — not that the name exists in a
 * union.
 *
 * This file exists because of a specific, verified failure next door. Talent
 * defines seven security events and emits three: `suspicious_activity`,
 * `password_changed`, `account_locked` and `permission_denied` are dead code
 * there, and there is no lockout logic anywhere to emit the third from
 * (R1 §5). Every one of them would pass a test that checked the union. So the
 * pattern below is always the same — drive the real function with a fake pool
 * and a fake recorder, then assert on what the recorder saw.
 *
 * The last test is the roll-up: every FR-2501 name must have been observed at
 * least once by the time this file finishes. A new name added to the contract
 * without a branch to emit it fails there.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

process.env.AINEXT_AUTH_SECRET ??= "test-secret-at-least-thirty-two-characters-long";

import {
  ADDITIONAL_EVENT_NAMES,
  REQUIRED_EVENT_NAMES,
  normalizeIp,
  recordCrossStudentDenied,
  recordOperatorRead,
  requestMeta,
  type AuthEventArgs,
} from "./events.ts";
import { authenticateCredential, rotateRefreshToken } from "./session.ts";
import { clearExpiredLockout, noteCredentialFailure, type Queryable } from "./throttle.ts";
import {
  consumeVerificationToken,
  issueVerificationToken,
  resendThrottleKey,
  resolveResendTarget,
} from "./verify.ts";
import { completeReset, issueResetToken } from "./reset.ts";
import { hashPassword } from "./password.ts";

type Row = Record<string, unknown>;

/** Every event this file observes, in order, so the roll-up can check coverage. */
const OBSERVED: string[] = [];

function recorder() {
  const seen: AuthEventArgs[] = [];
  return {
    seen,
    names: () => seen.map((e) => e.event),
    record: async (e: AuthEventArgs) => {
      seen.push(e);
      OBSERVED.push(e.event);
    },
  };
}

function fakeDb(rowsFor: (sql: string, values: readonly unknown[]) => Row[]): Queryable {
  return {
    query: async (sql: string, values: readonly unknown[] = []) => {
      const rows = rowsFor(sql, values);
      return { rows, rowCount: rows.length };
    },
  };
}

const NOW = new Date("2026-09-20T18:00:00Z");
const META = { ip: "10.0.0.1", userAgent: "Mozilla/5.0 (iPad)" };
const SESSION_META = { ...META, environment: "mvp1" };

// ---------------------------------------------------------------------------
// The vocabulary itself
// ---------------------------------------------------------------------------

test("the vocabulary is exactly the contract's thirteen plus five", () => {
  assert.deepEqual(
    [...REQUIRED_EVENT_NAMES],
    [
      "successful_login",
      "failed_login",
      "account_locked",
      "lockout_cleared",
      "password_changed",
      "password_reset_requested",
      "email_verification_sent",
      "email_verification_succeeded",
      "session_revoked",
      "permission_denied",
      "cross_student_access_denied",
      "operator_login",
      "admin_transcript_viewed",
    ]
  );
  assert.equal(REQUIRED_EVENT_NAMES.length, 13, "FR-2501 names thirteen");
  assert.deepEqual(
    [...ADDITIONAL_EVENT_NAMES],
    [
      "suspicious_activity",
      "oauth_login",
      "role_granted",
      "role_revoked",
      "password_reset_completed",
    ]
  );
});

// ---------------------------------------------------------------------------
// 1 · successful_login   2 · failed_login   3 · account_locked   12 · operator_login
// 10 · permission_denied
// ---------------------------------------------------------------------------

async function accountRow(password: string, over: Row = {}): Promise<Row> {
  return {
    id: 42,
    password_hash: await hashPassword(password),
    status: "active",
    email_verified_at: "2026-09-19T00:00:00.000Z",
    locked_until: null,
    student_id: 7,
    display_name: "Omar",
    ...over,
  };
}

test("[1] a correct password emits successful_login from the login branch", async () => {
  const row = await accountRow("right-password-1");
  const db = fakeDb((sql) => (sql.includes("FROM accounts a LEFT JOIN students") ? [row] : []));
  const r = recorder();

  const out = await authenticateCredential(
    db,
    "student",
    "omar@example.com",
    "right-password-1",
    r.record,
    META,
    NOW
  );
  assert.equal(out.kind, "ok");
  assert.deepEqual(r.names(), ["successful_login"]);
  assert.equal(r.seen[0]!.actor?.id, 42);
  assert.equal(r.seen[0]!.outcome, "success");
});

test("[2] a wrong password emits failed_login, and so does an address with no account", async () => {
  const row = await accountRow("right-password-1");
  const wrong = fakeDb((sql) => {
    if (sql.includes("FROM accounts a LEFT JOIN students")) return [row];
    if (sql.includes("INSERT INTO auth_throttle")) return [{ count: 1 }];
    return [];
  });
  const a = recorder();
  const out = await authenticateCredential(
    wrong,
    "student",
    "omar@example.com",
    "WRONG",
    a.record,
    META,
    NOW
  );
  assert.equal(out.kind, "invalid");
  assert.deepEqual(a.names(), ["failed_login"]);
  assert.equal(a.seen[0]!.reason, "wrong_password");

  const unknown = fakeDb(() => []);
  const b = recorder();
  const missing = await authenticateCredential(
    unknown,
    "student",
    "nobody@example.com",
    "WRONG",
    b.record,
    META,
    NOW
  );
  assert.equal(missing.kind, "invalid", "same verdict as a wrong password (FR-2005)");
  assert.deepEqual(b.names(), ["failed_login"]);
  assert.equal(b.seen[0]!.reason, "no_such_account", "the difference goes here and nowhere else");
});

test("[3] the fifth failure emits account_locked", async () => {
  const db = fakeDb((sql) => (sql.includes("INSERT INTO auth_throttle") ? [{ count: 5 }] : []));
  const r = recorder();
  const out = await noteCredentialFailure(db, "accounts", 42, r.record, META, NOW);
  assert.equal(out.locked, true);
  assert.deepEqual(r.names(), ["account_locked"]);
});

test("[4] an expired lockout emits lockout_cleared when it is next observed", async () => {
  const db = fakeDb(() => []);
  const r = recorder();
  const cleared = await clearExpiredLockout(
    db,
    "accounts",
    42,
    new Date(NOW.getTime() - 1),
    r.record,
    META,
    NOW
  );
  assert.equal(cleared, true);
  assert.deepEqual(r.names(), ["lockout_cleared"]);
});

test("[12] a console sign-in emits operator_login carrying the roles in effect", async () => {
  const hash = await hashPassword("operator-password-1");
  const db = fakeDb((sql) => {
    if (sql.includes("FROM operators o")) {
      return [
        {
          id: 1,
          password_hash: hash,
          status: "active",
          email_verified_at: null,
          locked_until: null,
          student_id: null,
          display_name: "Samuel",
        },
      ];
    }
    if (sql.includes("FROM operator_roles")) {
      return [{ role: "student-data" }, { role: "cost-billing" }];
    }
    return [];
  });
  const r = recorder();
  const out = await authenticateCredential(
    db,
    "admin",
    "samuel@example.com",
    "operator-password-1",
    r.record,
    META,
    NOW
  );
  assert.equal(out.kind, "ok");
  assert.deepEqual(r.names(), ["operator_login"], "and NOT successful_login beside it");
  assert.equal(r.seen[0]!.reason, "student-data,cost-billing", "FR-2207: the roles in effect");
});

// FR-2205 — a student credential at the console door.
test("[10] a student credential on the console emits permission_denied", async () => {
  const row = await accountRow("student-password-1");
  const db = fakeDb((sql) => {
    if (sql.includes("FROM operators o")) return []; // no such operator
    if (sql.includes("FROM accounts a LEFT JOIN students")) return [row];
    return [];
  });
  const r = recorder();
  const out = await authenticateCredential(
    db,
    "admin",
    "omar@example.com",
    "student-password-1",
    r.record,
    META,
    NOW
  );
  assert.equal(out.kind, "wrong_surface");
  assert.deepEqual(r.names(), ["permission_denied"]);
  assert.equal(r.seen[0]!.reason, "student_credential_on_console");
});

// ---------------------------------------------------------------------------
// 9 · session_revoked (and suspicious_activity beside it)
// ---------------------------------------------------------------------------

test("[9] refresh-token reuse emits suspicious_activity and one session_revoked per row", async () => {
  const db = fakeDb((sql) => {
    if (sql.includes("SET token_hash")) return [];
    if (sql.includes("WHERE rotated_from = $1")) return [{ id: 5, account_id: 3 }];
    if (sql.includes("SET revoked_at")) return [{ id: 5 }, { id: 9 }];
    return [];
  });
  const r = recorder();
  const out = await rotateRefreshToken(db, "spent", SESSION_META, r.record, NOW);
  assert.equal(out.kind, "reuse");
  assert.deepEqual(r.names(), ["suspicious_activity", "session_revoked", "session_revoked"]);
});

// ---------------------------------------------------------------------------
// 7 · email_verification_sent   8 · email_verification_succeeded
// ---------------------------------------------------------------------------

test("[7] issuing a confirmation link emits email_verification_sent", async () => {
  const db = fakeDb(() => []);
  const r = recorder();
  const issued = await issueVerificationToken(db, 42, "mvp1", r.record, META, NOW);
  assert.match(issued.token, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(r.names(), ["email_verification_sent"]);
});

test("[8] spending one emits email_verification_succeeded, and a spent one emits nothing", async () => {
  const good = fakeDb((sql) =>
    sql.includes("UPDATE verification_tokens") ? [{ account_id: 42 }] : []
  );
  const r = recorder();
  const ok = await consumeVerificationToken(good, "token", r.record, META, NOW);
  assert.equal(ok.ok, true);
  assert.deepEqual(r.names(), ["email_verification_succeeded"]);

  const spent = fakeDb(() => []);
  const second = recorder();
  const no = await consumeVerificationToken(spent, "token", second.record, META, NOW);
  assert.equal(no.ok, false);
  assert.deepEqual(second.names(), [], "a bad token reveals nothing, not even an event");
});

/**
 * The verification banner's resend: a signed-in student sends NO address,
 * because `/api/auth/me` does not hand a page a minor's email. The account id
 * from the session resolves it server-side and the same
 * `email_verification_sent` fires.
 */
test("[7b] a signed-in resend needs no address, and reuses the same branch", async () => {
  const db = fakeDb((sql) =>
    sql.includes("WHERE id = $1 AND email_verified_at IS NULL")
      ? [{ id: 42, email: "omar@example.com" }]
      : []
  );
  const target = await resolveResendTarget(db, { accountId: 42 });
  assert.deepEqual(target, { accountId: 42, email: "omar@example.com" });

  const r = recorder();
  await issueVerificationToken(db, target!.accountId, "mvp1", r.record, META, NOW);
  assert.deepEqual(r.names(), ["email_verification_sent"]);

  // Already verified, or no such account: null, so the 202 sends nothing.
  const verified = fakeDb(() => []);
  assert.equal(await resolveResendTarget(verified, { accountId: 42 }), null);
  assert.equal(await resolveResendTarget(verified, { email: "nobody@example.com" }), null);

  // The budget must not share a key with the sign-in failure counter, or five
  // taps of "send it again" would lock the account out of signing in.
  assert.notEqual(resendThrottleKey(42), "accounts:42");
  assert.ok(resendThrottleKey(42).startsWith("resend:"));
});

// ---------------------------------------------------------------------------
// 5 · password_changed   6 · password_reset_requested
// ---------------------------------------------------------------------------

test("[6] forgot-password emits password_reset_requested", async () => {
  const db = fakeDb(() => []);
  const r = recorder();
  await issueResetToken(db, 42, "mvp1", r.record, META, NOW);
  assert.deepEqual(r.names(), ["password_reset_requested"]);
});

test("[5] completing a reset revokes every session, then emits password_changed", async () => {
  const db = fakeDb((sql) => {
    if (sql.includes("UPDATE password_resets")) return [{ account_id: 42 }];
    if (sql.includes("SET revoked_at")) return [{ id: 1 }, { id: 2 }];
    return [];
  });
  const r = recorder();
  const out = await completeReset(db, "token", "a-new-password-9", r.record, META, NOW);
  assert.equal(out.ok, true);
  assert.deepEqual(r.names(), [
    "session_revoked",
    "session_revoked",
    "password_reset_completed",
    "password_changed",
  ]);
});

// ---------------------------------------------------------------------------
// 11 · cross_student_access_denied   13 · admin_transcript_viewed
// ---------------------------------------------------------------------------

test("[11] a blocked cross-student write emits cross_student_access_denied", async () => {
  const r = recorder();
  await recordCrossStudentDenied(
    { actorAccountId: 3, targetStudentId: 99, resource: "attempts:write", ...META },
    r.record
  );
  assert.deepEqual(r.names(), ["cross_student_access_denied"]);
  assert.equal(r.seen[0]!.subject?.id, 99);
  assert.equal(r.seen[0]!.outcome, "denied");
});

test("[13] an operator_reads row and admin_transcript_viewed cannot come apart", async () => {
  const written: string[] = [];
  const db = fakeDb((sql) => {
    written.push(sql);
    return [];
  });
  const r = recorder();
  await recordOperatorRead(
    db,
    { operatorId: 1, studentId: 7, surface: "session_timeline", environment: "mvp1" },
    r.record
  );
  assert.ok(written.some((s) => s.includes("INSERT INTO operator_reads")));
  assert.deepEqual(r.names(), ["admin_transcript_viewed"]);
});

// ---------------------------------------------------------------------------
// FR-2003 and the roll-up
// ---------------------------------------------------------------------------

test("no branch above ever put password material in an event", async () => {
  const row = await accountRow("a-very-distinctive-password");
  const db = fakeDb((sql) => {
    if (sql.includes("FROM accounts a LEFT JOIN students")) return [row];
    if (sql.includes("INSERT INTO auth_throttle")) return [{ count: 1 }];
    return [];
  });
  const r = recorder();
  await authenticateCredential(
    db,
    "student",
    "omar@example.com",
    "a-very-distinctive-password",
    r.record,
    META,
    NOW
  );
  await authenticateCredential(
    db,
    "student",
    "omar@example.com",
    "another-distinctive-guess",
    r.record,
    META,
    NOW
  );
  const dumped = JSON.stringify(r.seen);
  assert.equal(dumped.includes("a-very-distinctive-password"), false);
  assert.equal(dumped.includes("another-distinctive-guess"), false);
  assert.equal(dumped.includes(row.password_hash as string), false, "not the hash either");
  assert.equal(/"length":\s*\d+/.test(dumped), false, "and not its length");
});

test("an address that is not an address becomes NULL rather than failing an audit row", () => {
  assert.equal(normalizeIp("10.0.0.1"), "10.0.0.1");
  assert.equal(normalizeIp("10.0.0.1, 172.16.0.1"), "10.0.0.1", "the client, not the proxy");
  assert.equal(normalizeIp("2001:db8::1"), "2001:db8::1");
  assert.equal(normalizeIp("999.1.1.1"), null);
  assert.equal(normalizeIp("not-an-ip"), null);
  assert.equal(normalizeIp(null), null);
});

test("requestMeta prefers the Cloudflare hop and truncates a hostile user agent", () => {
  const req = new Request("https://example.com", {
    headers: {
      "cf-connecting-ip": "10.1.1.1",
      "x-forwarded-for": "10.2.2.2",
      "user-agent": "x".repeat(1000),
    },
  });
  const meta = requestMeta(req);
  assert.equal(meta.ip, "10.1.1.1");
  assert.equal(meta.userAgent?.length, 400);
});

// SC-106 — the roll-up. Thirteen of thirteen, observed, not declared.
test("every FR-2501 event was emitted by a branch in this file", () => {
  const observed = new Set(OBSERVED);
  const missing = REQUIRED_EVENT_NAMES.filter((n) => !observed.has(n));
  assert.deepEqual(
    missing,
    [],
    `defining an event is not emitting it — no branch emitted: ${missing.join(", ")}`
  );
  assert.equal(observed.size >= 13, true);
});
