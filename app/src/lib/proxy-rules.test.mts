// @covers FR-2201, FR-2205
/**
 * `shouldGuard` decides, per build, which paths `proxy.ts` redirects an
 * anonymous visitor away from. The bug this guards against: the console
 * build once guarded "every matched path" as a group, which meant it also
 * redirected `/student` and `/dashboard` to `/signin` — paths that build
 * does not serve at all and that `(student)/layout.tsx` is meant to answer
 * with a 404. A student path on the console build must fall through
 * unguarded, exactly like a console path on the student build does (the
 * student build never lists console paths in the first place).
 *
 * Pure: no `NextRequest`, no cookies, no Next runtime. `node --test` only.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { cookieNames, shouldGuard } from "./proxy-rules.ts";

test("student surface: guards the two student trees", () => {
  assert.equal(shouldGuard("student", "/student"), true);
  assert.equal(shouldGuard("student", "/student/42"), true);
  assert.equal(shouldGuard("student", "/dashboard"), true);
  assert.equal(shouldGuard("student", "/dashboard/history"), true);
});

test("student surface: does not guard sign-in or the auth API", () => {
  assert.equal(shouldGuard("student", "/signin"), false);
  assert.equal(shouldGuard("student", "/api/auth/login"), false);
  assert.equal(shouldGuard("student", "/api/auth/refresh"), false);
});

test("student surface: does not guard the public landing page", () => {
  assert.equal(shouldGuard("student", "/"), false);
});

test("admin surface: guards the console's own paths", () => {
  assert.equal(shouldGuard("admin", "/"), true);
  assert.equal(shouldGuard("admin", "/content"), true);
  assert.equal(shouldGuard("admin", "/cost"), true);
  assert.equal(shouldGuard("admin", "/profile"), true);
  assert.equal(shouldGuard("admin", "/students/1"), true);
  assert.equal(shouldGuard("admin", "/pipeline"), true);
  assert.equal(shouldGuard("admin", "/gallery"), true);
  assert.equal(shouldGuard("admin", "/dev/lesson-content"), true);
  assert.equal(shouldGuard("admin", "/security"), true);
  assert.equal(shouldGuard("admin", "/overview"), true);
  assert.equal(shouldGuard("admin", "/overview/definitions"), true);
});

test("admin surface: does not guard student paths — they fall through to the 404", () => {
  assert.equal(shouldGuard("admin", "/student"), false);
  assert.equal(shouldGuard("admin", "/dashboard"), false);
  assert.equal(shouldGuard("admin", "/spine"), false);
});

test("a path prefix does not falsely match a sibling with a longer name", () => {
  // "/students" must not be matched by a hypothetical "/student" guard, and
  // vice versa — the two are different routes on different builds.
  assert.equal(shouldGuard("student", "/students"), false);
  assert.equal(shouldGuard("admin", "/student"), false);
});

// F-P2b — the guard's own cookie-presence check (proxy.ts) must look for the
// console's cookie name on the admin surface, not the student build's, or a
// browser holding only student cookies reads as "signed in" here too.
test("the guard's cookie check uses the console cookie name on the admin surface", () => {
  assert.deepEqual(cookieNames("admin"), { access: "ainext_cat", refresh: "ainext_crt" });
  assert.deepEqual(cookieNames("student"), { access: "ainext_at", refresh: "ainext_rt" });
  assert.notEqual(cookieNames("admin").access, cookieNames("student").access);
});
