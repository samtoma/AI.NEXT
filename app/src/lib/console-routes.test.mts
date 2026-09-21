/**
 * The console route table is load-bearing for four separate things (the nav,
 * the per-page guard, the manifest proof and the role matrix), so this asserts
 * the table's own shape before any of them trust it.
 *
 * Pure: no database, no Next, no request. `node --test` and nothing else.
 *
 * @covers FR-2201
 * @covers FR-2107
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ALL_ROLES,
  CONSOLE_ROUTES,
  consoleRoute,
  navFor,
  routeAdmits,
  type ConsoleRoute,
} from "./console-routes.ts";

/** What `check-surface-manifest.mts` derives, re-derived here without a build. */
function urlForFile(file: string): string {
  const withoutPage = file.replace(/\/page\.console\.tsx$/, "");
  const segments = withoutPage
    .split("/")
    .filter((s) => s !== "" && !(s.startsWith("(") && s.endsWith(")")));
  return "/" + segments.join("/");
}

test("every path is listed once", () => {
  const paths = CONSOLE_ROUTES.map((r) => r.path);
  assert.deepEqual(paths.length, new Set(paths).size, "a duplicate path is two rows disagreeing");
});

test("every console file is a .console.tsx under the (console) group", () => {
  for (const r of CONSOLE_ROUTES) {
    assert.ok(
      r.file.startsWith("(console)/"),
      `${r.path}: ${r.file} is outside the (console) group, so the student build would compile it`
    );
    assert.ok(
      r.file.endsWith("/page.console.tsx"),
      `${r.path}: ${r.file} is not a page.console.tsx, so pageExtensions would not exclude it`
    );
  }
});

test("each file's directory is the URL it claims", () => {
  // This is the assertion that catches a row copied and half-edited: the table
  // says /cost and the file sits in content/. The manifest check catches the
  // same thing after a build; this catches it in a second.
  for (const r of CONSOLE_ROUTES) {
    assert.equal(urlForFile(r.file), r.path, `${r.file} does not answer ${r.path}`);
  }
});

test("every role named is a real role", () => {
  for (const r of CONSOLE_ROUTES) {
    for (const role of r.roles) {
      assert.ok(ALL_ROLES.includes(role), `${r.path} names ${role}, which is not one of the four`);
    }
  }
});

test("`/` is the only path shared with the student build", () => {
  const shared = CONSOLE_ROUTES.filter((r) => r.sharedPath).map((r) => r.path);
  assert.deepEqual(shared, ["/"]);
});

test("an empty roles list admits any operator, and a non-empty one is any-of", () => {
  const profile = consoleRoute("/profile")!;
  assert.equal(profile.roles.length, 0, "the profile is open to every operator");
  for (const role of ALL_ROLES) {
    assert.equal(routeAdmits(profile, [role]), true, `${role} should reach /profile`);
  }
  assert.equal(routeAdmits(profile, []), true, "an operator with no roles still has an account");

  const list = consoleRoute("/")!;
  assert.equal(routeAdmits(list, ["student-data"]), true);
  assert.equal(routeAdmits(list, ["cost-billing"]), true);
  assert.equal(routeAdmits(list, ["content-review"]), false);
  assert.equal(routeAdmits(list, ["evidence-access"]), false);
});

test("consoleRoute returns nothing for a path that is not in the table", () => {
  assert.equal(consoleRoute("/security"), undefined);
  assert.equal(consoleRoute("/students/1"), undefined, "the table holds the pattern, not an id");
});

test("the nav offers only routes the roles admit, and only routes with a label", () => {
  const evidence = navFor(["evidence-access"]).map((r) => r.path);
  assert.ok(evidence.includes("/pipeline"));
  assert.ok(evidence.includes("/gallery"));
  assert.ok(!evidence.includes("/"), "evidence-access holds no student-list role");
  assert.ok(evidence.includes("/profile"), "every operator has their own account page");

  const all = navFor(ALL_ROLES);
  assert.ok(
    all.every((r: ConsoleRoute) => r.nav !== null),
    "a route with no label is reached from another page, never from the nav"
  );
  assert.ok(
    !all.some((r) => r.path === "/students/[id]"),
    "student 360 is reached by opening a student, not by a nav link"
  );
  assert.ok(
    !all.some((r) => r.path === "/students"),
    "/students redirects to the list; offering both would be two links to one page"
  );
});
