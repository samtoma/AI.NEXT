/**
 * @covers FR-3301, FR-3303, FR-3304, FR-3305, FR-3309, FR-3312
 *
 * Signing an operator in from a proven identity, against a fake pool that
 * behaves like the three tables involved (`operators`, `operator_roles`,
 * `auth_sessions`) closely enough to answer the SQL this path sends.
 *
 * What is asserted is behaviour AND the record of it: a session row is or is
 * not written, the right events fire with the right reason, and — the part a
 * happy-path test would never catch — a refusal writes NO session and a
 * different operator's session on the same browser is ENDED, not left beside
 * the new one.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

process.env.AINEXT_AUTH_SECRET ??= "test-secret-at-least-thirty-two-characters-long";

import type { AuthEventArgs } from "./events.ts";
import { recordUnverifiedAssertion, signInOperator } from "./operator-signin.ts";
import type { Queryable } from "./throttle.ts";
import { hashToken } from "./tokens.ts";

type Operator = { id: number; email: string; status: "active" | "disabled"; roles: string[] };
type Session = {
  id: number;
  operator_id: number | null;
  account_id: number | null;
  token_hash: string;
  rotated_from: string | null;
  revoked_at: Date | null;
  expires_at: Date;
  issued_at: Date;
};

const NOW = new Date("2026-09-24T10:00:00.000Z");
const LATER = new Date("2026-10-01T10:00:00.000Z");

/**
 * A tiny in-memory stand-in for the three tables. It answers by recognising the
 * statements `operator-signin.ts` and `session.ts` send — the same technique
 * `session.test.mts` uses, with state, so a revocation is visible to the next
 * query.
 */
function fakeDb(operators: Operator[], sessions: Session[] = []) {
  const calls: { sql: string; values: readonly unknown[] }[] = [];
  let nextId = 100;
  const verified = new Set<number>();
  const db: Queryable = {
    query: async (sql: string, values: readonly unknown[] = []) => {
      calls.push({ sql, values });
      const rows = ((): Record<string, unknown>[] => {
        if (sql.includes("FROM operators WHERE lower(email) = lower($1)")) {
          const e = String(values[0]).toLowerCase();
          // JS toLowerCase stands in for Postgres lower(): both fold some
          // non-ASCII letters to ASCII ones, which is the case F7 is about.
          return operators
            .filter((o) => o.email.toLowerCase() === e)
            .map((o) => ({ id: o.id, status: o.status, email: o.email }));
        }
        if (sql.includes("FROM operators WHERE id = $1")) {
          return operators.filter((o) => o.id === values[0]).map((o) => ({ id: o.id, status: o.status }));
        }
        if (sql.includes("FROM operator_roles")) {
          return (operators.find((o) => o.id === values[0])?.roles ?? []).map((role) => ({ role }));
        }
        if (sql.includes("SELECT id, operator_id FROM auth_sessions") && sql.includes("token_hash = $1")) {
          return sessions
            .filter((s) => s.token_hash === values[0] && s.operator_id != null && !s.revoked_at && s.expires_at > (values[1] as Date))
            .map((s) => ({ id: s.id, operator_id: s.operator_id }));
        }
        if (sql.includes("SELECT id, operator_id FROM auth_sessions") && sql.includes("WHERE id = $1")) {
          return sessions
            .filter((s) => s.id === values[0] && s.operator_id != null && !s.revoked_at && s.expires_at > (values[1] as Date))
            .map((s) => ({ id: s.id, operator_id: s.operator_id }));
        }
        if (sql.includes("UPDATE auth_sessions SET revoked_at = $2") && sql.includes("WHERE id = $1")) {
          const s = sessions.find((x) => x.id === values[0] && !x.revoked_at);
          if (!s) return [];
          s.revoked_at = values[1] as Date;
          return [{ id: s.id, operator_id: s.operator_id }];
        }
        if (sql.includes("INSERT INTO auth_sessions")) {
          const s: Session = {
            id: nextId++,
            account_id: values[0] as number | null,
            operator_id: values[1] as number | null,
            token_hash: String(values[2]),
            rotated_from: null,
            revoked_at: null,
            issued_at: values[3] as Date,
            expires_at: values[4] as Date,
          };
          sessions.push(s);
          return [{ id: s.id }];
        }
        if (sql.includes("SET token_hash = $2")) {
          // rotateRefreshToken's conditional UPDATE, admin-surface filtered.
          const s = sessions.find(
            (x) => x.token_hash === values[0] && !x.revoked_at && x.expires_at > (values[2] as Date) && x.operator_id != null
          );
          if (!s) return [];
          s.rotated_from = s.token_hash;
          s.token_hash = String(values[1]);
          return [{ id: s.id, account_id: null, operator_id: s.operator_id, expires_at: LATER.toISOString() }];
        }
        if (sql.includes("UPDATE operators SET email_verified_at")) {
          verified.add(Number(values[0]));
          return [];
        }
        return [];
      })();
      return { rows, rowCount: rows.length };
    },
  };
  return { db, calls, sessions, verified };
}

function recorder() {
  const seen: AuthEventArgs[] = [];
  return { seen, record: async (e: AuthEventArgs) => void seen.push(e) };
}

const META = { ip: "203.0.113.7", userAgent: "Mozilla/5.0 (Macintosh) Safari/605", environment: "mvp1" };

const SAMUEL: Operator = {
  id: 1,
  email: "samuel.s.toma@gmail.com",
  status: "active",
  roles: ["content-review", "evidence-access", "student-data", "cost-billing"],
};
const TAMER: Operator = { id: 2, email: "Tamer@Example.com", status: "active", roles: ["content-review"] };
const GONE: Operator = { id: 3, email: "former@example.com", status: "disabled", roles: ["student-data"] };

function liveSession(id: number, operatorId: number, refreshToken: string): Session {
  return {
    id,
    operator_id: operatorId,
    account_id: null,
    token_hash: hashToken(refreshToken),
    rotated_from: null,
    revoked_at: null,
    issued_at: new Date("2026-09-23T10:00:00.000Z"),
    expires_at: new Date("2026-09-30T10:00:00.000Z"),
  };
}

test("a proven, active operator gets a normal console session and an operator_login row", async () => {
  const { db, sessions, verified } = fakeDb([SAMUEL, TAMER]);
  const { seen, record } = recorder();
  const out = await signInOperator(db, { email: "Samuel.S.Toma@Gmail.com" }, "cloudflare-access", {}, record, META, NOW);

  assert.equal(out.kind, "ok");
  if (out.kind !== "ok") return;
  assert.equal(out.operatorId, 1, "matched case-insensitively");
  assert.equal(out.created, true);
  assert.equal(out.ended, null);

  // The SAME session machinery as a password sign-in: one auth_sessions row,
  // operator_id set, account_id not, 7-day first expiry, token stored hashed.
  assert.equal(sessions.length, 1);
  const row = sessions[0]!;
  assert.equal(row.operator_id, 1);
  assert.equal(row.account_id, null);
  assert.equal(row.token_hash, hashToken(out.token), "stored as a hash, never plaintext");
  assert.equal(row.expires_at.getTime(), NOW.getTime() + 7 * 24 * 3600 * 1000);
  assert.equal(out.expiresAt.getTime(), row.expires_at.getTime());

  assert.deepEqual(
    seen.map((e) => [e.event, e.outcome, e.actor?.kind, e.actor?.id, e.reason]),
    [["operator_login", "success", "operator", 1, "cloudflare-access:content-review,evidence-access,student-data,cost-billing"]]
  );
  assert.ok(verified.has(1), "Cloudflare's one-time PIN counts as email verification");
  for (const e of seen) {
    assert.ok(!JSON.stringify(e).includes(out.token), "no token in any event");
  }
});

test("an email with no operator is refused, audited with the proven address, and writes NO session", async () => {
  const { db, sessions, calls } = fakeDb([SAMUEL]);
  const { seen, record } = recorder();
  const out = await signInOperator(db, { email: "Stranger@Example.com" }, "cloudflare-access", {}, record, META, NOW);

  assert.deepEqual(out, { kind: "no_account", ended: null });
  assert.equal(sessions.length, 0);
  assert.ok(!calls.some((c) => c.sql.includes("INSERT INTO auth_sessions")), "no session insert was even attempted");
  assert.deepEqual(
    seen.map((e) => [e.event, e.outcome, e.actor?.kind, e.reason]),
    [["failed_login", "failure", "anonymous", "cloudflare-access:no_operator:stranger@example.com"]]
  );
});

test("a row only a Unicode case rule would match is refused, not signed in (F7: no route/principal disagreement)", async () => {
  // `\u212A` (KELVIN SIGN) lower-cases to a plain `k` — in JS, and in Postgres
  // under common collations — so SQL finds this row for kelvin@example.com.
  // principal.ts would then never accept the session, and the browser would
  // loop. The one rule says it is not the same address, so: no account.
  const { db, sessions } = fakeDb([{ id: 9, email: "\u212Aelvin@example.com", status: "active", roles: ["cost-billing"] }]);
  const { seen, record } = recorder();
  const out = await signInOperator(db, { email: "kelvin@example.com" }, "cloudflare-access", {}, record, META, NOW);
  assert.equal(out.kind, "no_account");
  assert.equal(sessions.length, 0, "no session row");
  assert.equal(seen[0]?.reason, "cloudflare-access:no_operator:kelvin@example.com");
});

test("a disabled operator is refused and gets no session", async () => {
  const { db, sessions } = fakeDb([SAMUEL, GONE]);
  const { seen, record } = recorder();
  const out = await signInOperator(db, { email: "former@example.com" }, "cloudflare-access", {}, record, META, NOW);

  assert.deepEqual(out, { kind: "disabled", operatorId: 3, ended: null });
  assert.equal(sessions.length, 0);
  assert.deepEqual(
    seen.map((e) => [e.event, e.actor?.kind, e.actor?.id, e.reason]),
    [["failed_login", "operator", 3, "cloudflare-access:disabled"]]
  );
});

test("a DIFFERENT operator's session on this browser is ended, and the proven person is signed in", async () => {
  const tamersSession = liveSession(50, 2, "tamers-refresh-token");
  const { db, sessions } = fakeDb([SAMUEL, TAMER], [tamersSession]);
  const { seen, record } = recorder();
  const out = await signInOperator(
    db,
    { email: "samuel.s.toma@gmail.com" },
    "cloudflare-access",
    { refreshToken: "tamers-refresh-token" },
    record,
    META,
    NOW
  );

  assert.equal(out.kind, "ok");
  if (out.kind !== "ok") return;
  assert.deepEqual(out.ended, { operatorId: 2, sessionId: 50 });
  assert.equal(out.created, true);
  assert.ok(tamersSession.revoked_at, "Tamer's session is revoked in the table, not merely overwritten in the cookie");
  assert.equal(sessions.filter((s) => !s.revoked_at).length, 1);
  assert.equal(sessions.find((s) => !s.revoked_at)!.operator_id, 1);

  assert.deepEqual(
    seen.map((e) => [e.event, e.actor?.id, e.subject?.id, e.reason]),
    [
      ["session_revoked", 2, 50, "cloudflare-access:identity_changed"],
      ["operator_login", 1, undefined, "cloudflare-access:content-review,evidence-access,student-data,cost-billing"],
    ]
  );
});

test("a different operator's session found only by the access cookie's sid is ended too", async () => {
  const tamersSession = liveSession(51, 2, "unused");
  const { db } = fakeDb([SAMUEL, TAMER], [tamersSession]);
  const { seen, record } = recorder();
  const out = await signInOperator(db, { email: "samuel.s.toma@gmail.com" }, "cloudflare-access", { accessSessionId: 51 }, record, META, NOW);
  assert.equal(out.kind, "ok");
  assert.ok(tamersSession.revoked_at);
  assert.equal(seen[0]!.reason, "cloudflare-access:identity_changed");
});

test("the proven person has no account: whoever's session this browser held is ended as well", async () => {
  const tamersSession = liveSession(52, 2, "tamers-refresh-token");
  const { db, sessions } = fakeDb([TAMER], [tamersSession]);
  const { seen, record } = recorder();
  const out = await signInOperator(
    db,
    { email: "stranger@example.com" },
    "cloudflare-access",
    { refreshToken: "tamers-refresh-token" },
    record,
    META,
    NOW
  );
  assert.deepEqual(out, { kind: "no_account", ended: { operatorId: 2, sessionId: 52 } });
  assert.ok(tamersSession.revoked_at);
  assert.equal(sessions.filter((s) => !s.revoked_at).length, 0);
  assert.deepEqual(
    seen.map((e) => [e.event, e.reason]),
    [
      ["failed_login", "cloudflare-access:no_operator:stranger@example.com"],
      ["session_revoked", "cloudflare-access:identity_has_no_account"],
    ]
  );
});

test("same operator, existing session: the refresh token is rotated — no second session row, no sign-in event", async () => {
  const mine = liveSession(60, 1, "samuels-refresh-token");
  const { db, sessions } = fakeDb([SAMUEL], [mine]);
  const { seen, record } = recorder();
  const out = await signInOperator(
    db,
    { email: "samuel.s.toma@gmail.com" },
    "cloudflare-access",
    { refreshToken: "samuels-refresh-token" },
    record,
    META,
    NOW
  );
  assert.equal(out.kind, "ok");
  if (out.kind !== "ok") return;
  assert.equal(out.created, false);
  assert.equal(out.sessionId, 60);
  assert.equal(sessions.length, 1, "the session list stays 'the places I am signed in'");
  assert.equal(mine.rotated_from, hashToken("samuels-refresh-token"), "rotated exactly as /api/auth/refresh rotates");
  assert.equal(mine.token_hash, hashToken(out.token));
  assert.deepEqual(seen, [], "an ordinary rotation is not a sign-in and not a security event");
});

test("same operator with only a valid access cookie: nothing to do", async () => {
  const mine = liveSession(61, 1, "x");
  const { db, sessions } = fakeDb([SAMUEL], [mine]);
  const { seen, record } = recorder();
  const out = await signInOperator(db, { email: "samuel.s.toma@gmail.com" }, "cloudflare-access", { accessSessionId: 61 }, record, META, NOW);
  assert.deepEqual(out, { kind: "unchanged", operatorId: 1 });
  assert.equal(sessions.length, 1);
  assert.deepEqual(seen, []);
});

test("a revoked or expired session on the browser is not 'current' and is left alone", async () => {
  const revoked = { ...liveSession(70, 2, "old"), revoked_at: new Date("2026-09-20T00:00:00Z") };
  const expired = { ...liveSession(71, 2, "older"), expires_at: new Date("2026-09-01T00:00:00Z") };
  const { db } = fakeDb([SAMUEL, TAMER], [revoked, expired]);
  const { seen, record } = recorder();
  const out = await signInOperator(db, { email: "samuel.s.toma@gmail.com" }, "cloudflare-access", { refreshToken: "old", accessSessionId: 71 }, record, META, NOW);
  assert.equal(out.kind, "ok");
  if (out.kind === "ok") assert.equal(out.ended, null);
  assert.deepEqual(seen.map((e) => e.event), ["operator_login"]);
});

test("the dev picker signs in by id, records dev-picker, and does NOT mark the email verified", async () => {
  const { db, verified } = fakeDb([SAMUEL, TAMER]);
  const { seen, record } = recorder();
  const out = await signInOperator(db, { operatorId: 2 }, "dev-picker", {}, record, META, NOW);
  assert.equal(out.kind, "ok");
  assert.deepEqual(
    seen.map((e) => [e.event, e.actor?.id, e.reason]),
    [["operator_login", 2, "dev-picker:content-review"]]
  );
  assert.equal(verified.size, 0, "picking a name from a list proves no address");
});

test("the dev picker refuses an unknown id and a disabled operator", async () => {
  const { db, sessions } = fakeDb([SAMUEL, GONE]);
  const { seen, record } = recorder();
  assert.deepEqual(await signInOperator(db, { operatorId: 99 }, "dev-picker", {}, record, META, NOW), {
    kind: "no_account",
    ended: null,
  });
  assert.equal((await signInOperator(db, { operatorId: 3 }, "dev-picker", {}, record, META, NOW)).kind, "disabled");
  assert.equal(sessions.length, 0);
  assert.deepEqual(
    seen.map((e) => e.reason),
    ["dev-picker:no_operator:#99", "dev-picker:disabled"]
  );
});

test("an assertion that did not verify is recorded as anonymous, with the verifier's code and nothing else", async () => {
  const { seen, record } = recorder();
  await recordUnverifiedAssertion("bad_audience", record, { ip: "203.0.113.7", userAgent: "x" });
  assert.deepEqual(
    seen.map((e) => [e.event, e.outcome, e.actor?.kind, e.reason]),
    [["failed_login", "failure", "anonymous", "cloudflare-access:unverified:bad_audience"]]
  );
});
