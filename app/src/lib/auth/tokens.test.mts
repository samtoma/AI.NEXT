/**
 * @covers FR-2007, FR-2008
 *
 * Token material, tested against the real `jose` rather than a mock of it —
 * which is the only version of this test worth having, because what is being
 * checked is that a token we sign verifies and a token we did not sign does
 * not.
 *
 * `tokens.ts` imports nothing from the app for exactly this reason.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

process.env.AINEXT_AUTH_SECRET ??= "test-secret-at-least-thirty-two-characters-long";

import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_ABSOLUTE_MS,
  REFRESH_SLIDING_MS,
  RESET_TTL_MS,
  VERIFICATION_TTL_MS,
  generateToken,
  hashToken,
  refreshExpiry,
  resetExpiry,
  signAccessToken,
  signStateToken,
  verificationExpiry,
  verifyAccessToken,
  verifyStateToken,
} from "./tokens.ts";

const NOW = new Date("2026-09-20T18:00:00Z");

test("the stated lifetimes are the stated lifetimes", () => {
  assert.equal(ACCESS_TOKEN_TTL_SECONDS, 15 * 60);
  assert.equal(REFRESH_SLIDING_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(REFRESH_ABSOLUTE_MS, 30 * 24 * 60 * 60 * 1000);
  assert.equal(VERIFICATION_TTL_MS, 24 * 60 * 60 * 1000);
  assert.equal(RESET_TTL_MS, 60 * 60 * 1000);
});

test("an access token round-trips with exactly the five contracted claims", async () => {
  const token = await signAccessToken({ sub: 12, knd: "student", stu: 7, sid: 99, env: "mvp1" });
  const claims = await verifyAccessToken(token, "mvp1");
  assert.ok(claims);
  assert.deepEqual(claims, { sub: 12, knd: "student", stu: 7, sid: 99, env: "mvp1" });
});

test("an operator token carries no student claim", async () => {
  const token = await signAccessToken({ sub: 3, knd: "operator", sid: 4, env: "mvp1" });
  const claims = await verifyAccessToken(token, "mvp1");
  assert.ok(claims);
  assert.equal(claims.stu, undefined);
  assert.equal(claims.knd, "operator");
});

test("a token minted for the other environment is not honoured", async () => {
  const token = await signAccessToken({ sub: 1, knd: "student", stu: 1, sid: 1, env: "baseline" });
  assert.equal(await verifyAccessToken(token, "mvp1"), null);
  assert.ok(await verifyAccessToken(token, "baseline"));
});

test("an expired token verifies as nothing", async () => {
  const longAgo = new Date(NOW.getTime() - (ACCESS_TOKEN_TTL_SECONDS + 60) * 1000);
  const token = await signAccessToken(
    { sub: 1, knd: "student", stu: 1, sid: 1, env: "mvp1" },
    longAgo
  );
  assert.equal(await verifyAccessToken(token, "mvp1"), null);
});

test("garbage, a tampered payload and the empty string all verify as nothing", async () => {
  const good = await signAccessToken({ sub: 1, knd: "student", stu: 1, sid: 1, env: "mvp1" });
  const [h, , s] = good.split(".");
  const tampered = `${h}.eyJzdWIiOiI5OTkiLCJrbmQiOiJvcGVyYXRvciJ9.${s}`;
  assert.equal(await verifyAccessToken(""), null);
  assert.equal(await verifyAccessToken("not-a-jwt"), null);
  assert.equal(await verifyAccessToken(tampered), null);
});

test("refresh tokens are 32 bytes of base64url and never repeat", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const t = generateToken();
    assert.match(t, /^[A-Za-z0-9_-]{43}$/, "32 bytes base64url is 43 characters");
    assert.equal(seen.has(t), false);
    seen.add(t);
  }
});

test("only the sha256 of a token is ever storable, and it is deterministic", () => {
  const token = "a-known-token";
  assert.equal(hashToken(token), hashToken(token));
  assert.match(hashToken(token), /^[0-9a-f]{64}$/);
  assert.notEqual(hashToken(token), token);
});

// FR-2008 — a session cannot live forever by being used.
test("refresh expiry slides by 7 days but never past 30 from first issue", () => {
  const issued = NOW;
  assert.equal(
    refreshExpiry(issued, issued).getTime(),
    issued.getTime() + REFRESH_SLIDING_MS,
    "a fresh session expires 7 days out"
  );

  const day26 = new Date(issued.getTime() + 26 * 24 * 60 * 60 * 1000);
  assert.equal(
    refreshExpiry(issued, day26).getTime(),
    issued.getTime() + REFRESH_ABSOLUTE_MS,
    "on day 26 the 30-day cap binds, not the 7-day slide"
  );

  const day10 = new Date(issued.getTime() + 10 * 24 * 60 * 60 * 1000);
  assert.equal(
    refreshExpiry(issued, day10).getTime(),
    day10.getTime() + REFRESH_SLIDING_MS,
    "on day 10 the slide still binds"
  );
});

test("verification is 24 hours out and reset is one hour out", () => {
  assert.equal(verificationExpiry(NOW).getTime(), NOW.getTime() + VERIFICATION_TTL_MS);
  assert.equal(resetExpiry(NOW).getTime(), NOW.getTime() + RESET_TTL_MS);
});

test("the OAuth state envelope round-trips and rejects a forgery", async () => {
  const envelope = await signStateToken({ state: "abc", verifier: "xyz" }, 600);
  const payload = await verifyStateToken(envelope);
  assert.equal(payload?.state, "abc");
  assert.equal(payload?.verifier, "xyz");
  assert.equal(await verifyStateToken("forged.state.cookie"), null);
});
