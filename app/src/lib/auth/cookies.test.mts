/**
 * @covers FR-2007
 *
 * The cookie attributes, asserted as strings.
 *
 * This is the test that would have caught Talent's live defect: its access
 * token is returned in a JSON body and kept in `localStorage`, which no unit
 * test anywhere can fail because there is no attribute to assert on (R1 §1).
 * Here both tokens are cookies, so "HttpOnly, SameSite=Lax, and the refresh one
 * is scoped to /api/auth" is a string comparison rather than a claim.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  ACCESS_COOKIE,
  ACCESS_COOKIE_PATH,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
  accessCookie,
  applyCookies,
  cleared,
  clearedAuthCookies,
  cookieNames,
  oauthStateCookie,
  readCookie,
  refreshCookie,
  secureCookies,
  serializeCookie,
} from "./cookies.ts";

const EXPIRES = new Date("2026-09-27T18:00:00Z");

test("the access cookie is HttpOnly, Lax, site-wide and 15 minutes", () => {
  const s = serializeCookie(accessCookie("TOKEN", false));
  assert.equal(s, "ainext_at=TOKEN; Path=/; HttpOnly; SameSite=Lax; Max-Age=900");
  assert.ok(s.includes("HttpOnly"), "FR-2007: no script may read it");
  assert.equal(s.includes("Secure"), false, "not Secure in development");
});

test("the refresh cookie is scoped to /api/auth and carries an absolute expiry", () => {
  const s = serializeCookie(refreshCookie("RT", EXPIRES, false));
  assert.equal(
    s,
    `ainext_rt=RT; Path=/api/auth; HttpOnly; SameSite=Lax; Expires=${EXPIRES.toUTCString()}`
  );
  assert.ok(
    s.includes("Path=/api/auth"),
    "a lesson page request must not carry the credential that mints sessions"
  );
});

test("Secure is added in production and nowhere else", () => {
  assert.equal(secureCookies("production"), true);
  assert.equal(secureCookies("development"), false);
  assert.equal(secureCookies(undefined), false);
  assert.ok(serializeCookie(accessCookie("T", true)).includes("; Secure"));
});

test("the OAuth state envelope is HttpOnly and short-lived", () => {
  const s = serializeCookie(oauthStateCookie("ENVELOPE", false));
  assert.equal(s, "ainext_oauth=ENVELOPE; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=600");
});

// Clearing on the wrong path deletes a different cookie and leaves the real one.
test("clearing repeats the original path for each cookie", () => {
  const [at, rt] = clearedAuthCookies(false).map(serializeCookie);
  assert.equal(at, "ainext_at=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  assert.equal(rt, "ainext_rt=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0");
  assert.equal(cleared(ACCESS_COOKIE, ACCESS_COOKIE_PATH, false).maxAge, 0);
  assert.equal(cleared(REFRESH_COOKIE, REFRESH_COOKIE_PATH, false).path, "/api/auth");
});

test("two cookies become two Set-Cookie headers, not one", () => {
  const res = applyCookies(new Response(null), [
    accessCookie("A", false),
    refreshCookie("B", EXPIRES, false),
  ]);
  const headers = res.headers.getSetCookie();
  assert.equal(headers.length, 2);
  assert.ok(headers[0]!.startsWith("ainext_at=A"));
  assert.ok(headers[1]!.startsWith("ainext_rt=B"));
});

test("reading one cookie out of a raw header ignores prefixes and whitespace", () => {
  const header = "other=1; ainext_at=VALUE; ainext_at_extra=no";
  assert.equal(readCookie(header, "ainext_at"), "VALUE");
  assert.equal(readCookie(header, "ainext_rt"), null);
  assert.equal(readCookie(null, "ainext_at"), null);
});

// F-P2b: the console gets cookie names of its own, so a browser holding a
// student's cookies from the other surface never presents anything the
// console build recognises as its own session.
test("cookies.ts re-exports the surface lookup, and ACCESS_COOKIE/REFRESH_COOKIE are the student names", () => {
  assert.deepEqual(cookieNames("student"), { access: "ainext_at", refresh: "ainext_rt" });
  assert.deepEqual(cookieNames("admin"), { access: "ainext_cat", refresh: "ainext_crt" });
  assert.equal(ACCESS_COOKIE, "ainext_at");
  assert.equal(REFRESH_COOKIE, "ainext_rt");
});

test("accessCookie and refreshCookie default to the student names but take the console's on request", () => {
  const studentAt = serializeCookie(accessCookie("TOKEN", false));
  assert.ok(studentAt.startsWith("ainext_at=TOKEN"));

  const adminAt = serializeCookie(accessCookie("TOKEN", false, "admin"));
  assert.ok(adminAt.startsWith("ainext_cat=TOKEN"), adminAt);

  const studentRt = serializeCookie(refreshCookie("RT", EXPIRES, false));
  assert.ok(studentRt.startsWith("ainext_rt=RT"));

  const adminRt = serializeCookie(refreshCookie("RT", EXPIRES, false, "admin"));
  assert.ok(adminRt.startsWith("ainext_crt=RT"), adminRt);
  assert.ok(adminRt.includes("Path=/api/auth"), "the path does not change, only the name");
});

test("clearedAuthCookies clears the console's own names on the admin surface", () => {
  const [at, rt] = clearedAuthCookies(false, "admin").map(serializeCookie);
  assert.equal(at, "ainext_cat=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  assert.equal(rt, "ainext_crt=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0");
});
