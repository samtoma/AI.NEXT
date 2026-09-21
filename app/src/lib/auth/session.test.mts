/**
 * @covers FR-2008, FR-2009, FR-2012
 *
 * Session rotation, reuse detection and revocation, against a fake pool.
 *
 * The reuse test is the one that matters. Talent's architecture document lists
 * the absence of reuse detection as a known gap (R1 §8), and the failure mode
 * is silent: everything works, sessions rotate, nobody notices that a stolen
 * refresh token keeps working forever beside the real one. So the assertion
 * here is not "rotation happened" but "presenting a spent token revoked
 * EVERYTHING and said so".
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

process.env.AINEXT_AUTH_SECRET ??= "test-secret-at-least-thirty-two-characters-long";

import {
  deviceNameFromUserAgent,
  listSessions,
  revokeAllForPrincipal,
  revokeByToken,
  revokeSessionById,
  rotateRefreshToken,
} from "./session.ts";
import type { Queryable } from "./throttle.ts";
import type { AuthEventArgs } from "./events.ts";
import { hashToken } from "./tokens.ts";

type Row = Record<string, unknown>;

function fakeDb(rowsFor: (sql: string, values: readonly unknown[]) => Row[]): Queryable & {
  calls: { sql: string; values: readonly unknown[] }[];
} {
  const calls: { sql: string; values: readonly unknown[] }[] = [];
  return {
    calls,
    query: async (sql: string, values: readonly unknown[] = []) => {
      calls.push({ sql, values });
      const rows = rowsFor(sql, values);
      return { rows, rowCount: rows.length };
    },
  };
}

function recorder() {
  const seen: AuthEventArgs[] = [];
  return { seen, record: async (e: AuthEventArgs) => void seen.push(e) };
}

const META = { ip: "10.0.0.1", userAgent: "Mozilla/5.0 (iPad)", environment: "mvp1" };

test("a device name is a hint, and an unknown one says so", () => {
  assert.equal(deviceNameFromUserAgent(null), "Unknown device");
  assert.equal(deviceNameFromUserAgent(""), "Unknown device");
  assert.ok(deviceNameFromUserAgent("Mozilla/5.0 (iPad; CPU OS 18_0) Safari/605").startsWith("iPad"));
  assert.ok(deviceNameFromUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/130").includes("Chrome"));
  assert.equal(deviceNameFromUserAgent("curl/8.0"), "Unknown device");
});

test("a live token rotates in place and comes back with a new secret", async () => {
  const db = fakeDb((sql) =>
    sql.includes("SET token_hash")
      ? [
          {
            id: 5,
            account_id: 3,
            operator_id: null,
            expires_at: "2026-09-27T18:00:00.000Z",
          },
        ]
      : []
  );
  const { seen, record } = recorder();
  const result = await rotateRefreshToken(db, "presented-token", META, record);

  assert.equal(result.kind, "rotated");
  if (result.kind !== "rotated") return;
  assert.equal(result.sessionId, 5);
  assert.deepEqual(result.ref, { accountId: 3 });
  assert.notEqual(result.token, "presented-token", "a rotation issues a NEW token");
  assert.equal(seen.length, 0, "an ordinary rotation is not a security event");

  const update = db.calls[0]!;
  assert.equal(update.values[0], hashToken("presented-token"), "matched by hash, never plaintext");
  assert.equal(update.values[1], hashToken(result.token), "and stored as a hash too");
  assert.ok(update.sql.includes("rotated_from = $1"), "the spent hash is kept for reuse detection");
});

// FR-2008 — the departure from Talent.
test("presenting an already-rotated token revokes EVERY session and reports it", async () => {
  const db = fakeDb((sql) => {
    if (sql.includes("SET token_hash")) return []; // not a live token
    if (sql.includes("WHERE rotated_from = $1")) {
      return [{ id: 5, account_id: 3, operator_id: null }];
    }
    if (sql.includes("SET revoked_at")) return [{ id: 5 }, { id: 9 }, { id: 11 }];
    return [];
  });
  const { seen, record } = recorder();
  const result = await rotateRefreshToken(db, "spent-token", META, record);

  assert.equal(result.kind, "reuse");
  const names = seen.map((e) => e.event);
  assert.deepEqual(names, [
    "suspicious_activity",
    "session_revoked",
    "session_revoked",
    "session_revoked",
  ]);
  assert.equal(seen[0]!.reason, "refresh_token_reuse");
  assert.deepEqual(
    seen.slice(1).map((e) => e.subject?.id),
    [5, 9, 11],
    "one event per session revoked, not one for the batch"
  );
});

test("an unknown token is simply unknown — no event, no revocation", async () => {
  const db = fakeDb(() => []);
  const { seen, record } = recorder();
  const result = await rotateRefreshToken(db, "never-existed", META, record);
  assert.equal(result.kind, "unknown");
  assert.equal(seen.length, 0);
});

// F-P2b / FR-2205 — the console silently rotating a student's refresh token.
test("a live token rotates when the surface matches, filtered IN the UPDATE itself", async () => {
  const db = fakeDb((sql) =>
    sql.includes("SET token_hash")
      ? [{ id: 5, account_id: 3, operator_id: null, expires_at: "2026-09-27T18:00:00.000Z" }]
      : []
  );
  const { record } = recorder();
  const result = await rotateRefreshToken(db, "presented-token", META, record, new Date(), "student");
  assert.equal(result.kind, "rotated");
  assert.ok(
    db.calls[0]!.sql.includes("AND account_id IS NOT NULL"),
    "the kind constraint is part of the WHERE clause, not a check after the fact"
  );
});

test("a live token belonging to the OTHER surface is refused, and NOT touched", async () => {
  const db = fakeDb((sql) => {
    // The surface-filtered UPDATE matches nothing — this token is a student's,
    // and the caller asked for "admin".
    if (sql.includes("SET token_hash")) return [];
    // The read-only probe that tells "wrong surface" apart from "not live":
    // it IS live, just not for this surface.
    if (sql.includes("SELECT account_id, operator_id FROM auth_sessions")) {
      return [{ account_id: 3, operator_id: null }];
    }
    return [];
  });
  const { seen, record } = recorder();
  const result = await rotateRefreshToken(db, "student-token", META, record, new Date(), "admin");

  assert.equal(result.kind, "wrong_surface");
  if (result.kind !== "wrong_surface") return;
  assert.deepEqual(result.ref, { accountId: 3 });

  assert.ok(
    !db.calls.some((c) => c.sql.includes("SET revoked_at")),
    "the foreign session is valid on its own surface and must not be revoked"
  );
  assert.ok(
    !db.calls.some((c) => c.sql.includes("WHERE rotated_from")),
    "this is not reuse detection's question — it must not run that branch " +
      "(the rotate UPDATE itself always SETs rotated_from, so that substring " +
      "alone would false-positive on call #1 — assert on the reuse SELECT's " +
      "own WHERE clause instead)"
  );

  assert.equal(seen.length, 1, "exactly one event, not the reuse branch's four");
  assert.equal(seen[0]!.event, "permission_denied");
  assert.equal(seen[0]!.reason, "cross_surface_refresh");
  assert.deepEqual(seen[0]!.actor, { kind: "account", id: 3 });
});

test("omitting surface keeps the pre-F-P2b behaviour — no kind constraint at all", async () => {
  const db = fakeDb((sql) =>
    sql.includes("SET token_hash")
      ? [{ id: 5, account_id: 3, operator_id: null, expires_at: "2026-09-27T18:00:00.000Z" }]
      : []
  );
  const { record } = recorder();
  const result = await rotateRefreshToken(db, "presented-token", META, record);
  assert.equal(result.kind, "rotated");
  assert.ok(!db.calls[0]!.sql.includes("IS NOT NULL"));
});

test("logout revokes only the presented session", async () => {
  const db = fakeDb((sql) => (sql.includes("SET revoked_at") ? [{ id: 5, account_id: 3 }] : []));
  const { seen, record } = recorder();
  assert.equal(await revokeByToken(db, "rt", record), 1);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.event, "session_revoked");
  assert.equal(seen[0]!.reason, "logout");
});

// F-P2b — logging out of one surface must never end a live session on the other.
test("logout does not revoke a session belonging to the other surface", async () => {
  const db = fakeDb(() => []); // the surface-filtered UPDATE matches nothing
  const { seen, record } = recorder();
  const revoked = await revokeByToken(db, "rt", record, {}, new Date(), "admin");
  assert.equal(revoked, 0);
  assert.equal(seen.length, 0);
  assert.ok(db.calls[0]!.sql.includes("AND operator_id IS NOT NULL"));
});

test("logout still revokes a same-surface session when a surface is given", async () => {
  const db = fakeDb((sql) =>
    sql.includes("SET revoked_at") ? [{ id: 5, account_id: 3, operator_id: null }] : []
  );
  const { seen, record } = recorder();
  const revoked = await revokeByToken(db, "rt", record, {}, new Date(), "student");
  assert.equal(revoked, 1);
  assert.equal(seen.length, 1);
  assert.ok(db.calls[0]!.sql.includes("AND account_id IS NOT NULL"));
});

// FR-2009 — 404, not 403, on somebody else's session.
test("revoking a session that is not mine returns false, not an error", async () => {
  const db = fakeDb(() => []); // the ownership predicate is IN the UPDATE
  const { seen, record } = recorder();
  assert.equal(await revokeSessionById(db, { accountId: 3 }, 999, record), false);
  assert.equal(seen.length, 0, "nothing happened, so nothing is recorded");
  assert.ok(db.calls[0]!.sql.includes("account_id = $2"));
});

test("logout-all emits one row per session and none for an already-empty set", async () => {
  const many = fakeDb(() => [{ id: 1 }, { id: 2 }]);
  const { seen, record } = recorder();
  assert.equal(await revokeAllForPrincipal(many, { accountId: 3 }, record, "logout_all"), 2);
  assert.equal(seen.length, 2);

  const none = fakeDb(() => []);
  const second = recorder();
  assert.equal(
    await revokeAllForPrincipal(none, { accountId: 3 }, second.record, "logout_all"),
    0
  );
  assert.equal(second.seen.length, 0);
});

// FR-2009 — the list carries no token material.
test("the session list returns device and time and nothing that could be replayed", async () => {
  const db = fakeDb(() => [
    {
      id: 5,
      device_name: "iPad · Safari",
      ip: "10.0.0.1",
      last_used_at: "2026-09-20T18:00:00.000Z",
      issued_at: "2026-09-19T08:00:00.000Z",
    },
  ]);
  const sessions = await listSessions(db, { accountId: 3 }, 5);
  assert.deepEqual(Object.keys(sessions[0]!).sort(), [
    "createdAt",
    "current",
    "deviceName",
    "ipAddress",
    "id",
    "lastUsedAt",
  ].sort());
  assert.equal(sessions[0]!.current, true);
  assert.equal(
    JSON.stringify(sessions).includes("token"),
    false,
    "FR-2009: no token material, under any key"
  );
});
