/**
 * The role × surface matrix (SC-110, contracts/authorization.md "Tests this
 * contract owes" #1 and #2).
 *
 * **The expected answers below are transcribed from the contract, by hand, and
 * are deliberately NOT derived from `console-routes.ts`.** A test that read its
 * expectations out of the table it is checking would pass for any table,
 * including a wrong one. Two independent statements of the same matrix is the
 * whole mechanism: when they disagree, one of them is a mistake and the diff
 * says which row.
 *
 * **A console route that is not in this file fails the test**, and a row in
 * this file that is not a console route fails it too. That is what makes
 * "somebody added a surface and forgot the guard" a red build rather than an
 * open door — the contract asks for surfaces to be enumerated rather than
 * remembered.
 *
 * Every refusal is asserted, not only every permission. A matrix that checks
 * the ✓ cells is a test of the happy path wearing a security test's name.
 *
 * @covers FR-2106
 * @covers FR-2107
 * @covers FR-2202
 * @covers FR-2203
 * @covers FR-2205
 * @covers FR-2406
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ALL_ROLES, CONSOLE_ROUTES, consoleRoute, routeAdmits } from "../console-routes.ts";
import type { OperatorRole } from "../console-routes.ts";
import { checkRequirement } from "./authorize.ts";

/**
 * contracts/authorization.md, "Roles × surfaces", transcribed.
 *
 * `/` is the student list — `student-data` (full) and `cost-billing` (a
 * projection with no content column). `/students/[id]` is Student 360, which
 * `cost-billing` may not open at all: FR-2406 says the role reads no student
 * content, and the enforcement of that is here rather than in the page's
 * discretion.
 */
const EXPECTED: Record<string, readonly OperatorRole[]> = {
  "/": ["student-data", "cost-billing"],
  // `/students` is the redirect to the list, not a view of its own, so it
  // carries the shell's permission rather than the list's.
  "/students": ["content-review", "evidence-access", "student-data", "cost-billing"],
  "/students/[id]": ["student-data"],
  // The session list, the timeline and the replay (admin.md §3, §4, §5). Each
  // is transcribed on its own line for the reason the whole file is
  // hand-transcribed: "everything under /students is student-data" is a rule,
  // and a rule cannot disagree with the table it is meant to check.
  "/students/[id]/sessions": ["student-data"],
  "/students/[id]/sessions/[sid]": ["student-data"],
  "/students/[id]/sessions/[sid]/replay": ["student-data"],
  "/profile": ["content-review", "evidence-access", "student-data", "cost-billing"],
  "/content": ["content-review"],
  "/cost": ["cost-billing"],
  // contracts/authorization.md, "Subscription / payment status — read and
  // change": `cost-billing` only. The console's first write endpoint, and the
  // only row in this matrix that is an endpoint rather than a page — the
  // question is the same one, so it is asked the same way.
  "/api/console/students/[id]/subscription": ["cost-billing"],
  // contracts/admin.md §7 Security: `student-data`. The security record names
  // accounts, students and the operators who read their transcripts, so it is
  // the same role the Student 360 needs even though it holds no learning.
  "/security": ["student-data"],
  // §8 Overviews: "Roles: all four (they carry no individual content)". The
  // metric dictionary is transcribed on its own line rather than covered by a
  // prefix rule, for the reason this whole file exists — a rule cannot disagree
  // with the table it is meant to check.
  "/overview": ["content-review", "evidence-access", "student-data", "cost-billing"],
  "/overview/definitions": [
    "content-review",
    "evidence-access",
    "student-data",
    "cost-billing",
  ],
  "/pipeline": ["evidence-access"],
  "/gallery": ["evidence-access"],
  "/dev/lesson-content": ["evidence-access"],
  "/dev/math-widgets": ["evidence-access"],
  "/dev/social-fixture": ["evidence-access"],
  "/dev/widget-questions": ["evidence-access"],
};

test("every console route is in the matrix, and every matrix row is a console route", () => {
  const listed = CONSOLE_ROUTES.map((r) => r.path).sort();
  const expected = Object.keys(EXPECTED).sort();
  assert.deepEqual(
    listed,
    expected,
    "a console route with no row here has had its authorisation decided by nobody"
  );
});

test("every role × every console route matches the contract", () => {
  for (const [path, admitted] of Object.entries(EXPECTED)) {
    const route = consoleRoute(path);
    assert.ok(route, `${path} is not in CONSOLE_ROUTES`);
    for (const role of ALL_ROLES) {
      const shouldAdmit = admitted.includes(role);
      assert.equal(
        routeAdmits(route, [role]),
        shouldAdmit,
        `${role} ${shouldAdmit ? "should" : "should NOT"} reach ${path}`
      );
    }
  }
});

test("holding every role reaches every surface; holding none reaches only the shell's own", () => {
  for (const route of CONSOLE_ROUTES) {
    assert.equal(routeAdmits(route, ALL_ROLES), true, `all four roles should reach ${route.path}`);
    assert.equal(
      routeAdmits(route, []),
      route.roles.length === 0,
      `an operator with no role grants should reach ${route.path} only if it needs none`
    );
  }
});

test("cost-billing reaches the student list and nothing that holds a student's record", () => {
  // FR-2406, stated as its own case because it is the one boundary in this
  // matrix that is a privacy rule rather than a tidiness one.
  assert.equal(routeAdmits(consoleRoute("/")!, ["cost-billing"]), true);
  assert.equal(routeAdmits(consoleRoute("/students/[id]")!, ["cost-billing"]), false);
  // The transcript surfaces are the sharpest edge of FR-2406: `cost-billing`
  // exists so somebody can answer "what does this cost" without ever reading a
  // child's conversation, and a replay is the conversation itself.
  assert.equal(routeAdmits(consoleRoute("/students/[id]/sessions")!, ["cost-billing"]), false);
  assert.equal(
    routeAdmits(consoleRoute("/students/[id]/sessions/[sid]")!, ["cost-billing"]),
    false
  );
  assert.equal(
    routeAdmits(consoleRoute("/students/[id]/sessions/[sid]/replay")!, ["cost-billing"]),
    false
  );
  assert.equal(routeAdmits(consoleRoute("/pipeline")!, ["cost-billing"]), false);
  assert.equal(routeAdmits(consoleRoute("/content")!, ["cost-billing"]), false);
});

test("changing a student's commercial status is cost-billing's alone (FR-2405)", () => {
  // The other direction of the same boundary: `student-data` opens the record
  // and may not price it; `cost-billing` prices it and may not open it. The
  // 360 page shows the status to `student-data` as a fact and offers the
  // editor only to an operator who also holds `cost-billing`.
  const route = consoleRoute("/api/console/students/[id]/subscription")!;
  assert.equal(routeAdmits(route, ["cost-billing"]), true);
  assert.equal(routeAdmits(route, ["student-data"]), false);
  assert.equal(routeAdmits(route, ["content-review"]), false);
  assert.equal(routeAdmits(route, ["evidence-access"]), false);
  assert.equal(routeAdmits(route, []), false, "a role list of none must not admit an endpoint");

  // And through the seam the handler actually calls.
  const billing = { kind: "operator" as const, operatorId: 1, roles: ["cost-billing" as const] };
  const data = { kind: "operator" as const, operatorId: 2, roles: ["student-data" as const] };
  assert.equal(checkRequirement(billing, { role: "cost-billing" }).ok, true);
  const refused = checkRequirement(data, { role: "cost-billing" });
  assert.equal(refused.ok, false);
  assert.equal(refused.ok === false && refused.status, 403);
  assert.equal(refused.ok === false && refused.reason, "missing_role:cost-billing");
});

test("a student principal is refused every console route, and recorded as denied", () => {
  // FR-2205 through the seam itself: on the console build `principal.ts` has
  // already downgraded a student token to anonymous, and this is the answer if
  // one ever reached `checkRequirement` anyway.
  const student = {
    kind: "student" as const,
    studentId: 1,
    accountId: 1,
    emailVerified: true,
  };
  for (const route of CONSOLE_ROUTES) {
    // A route with no role requirement is the shell's, and the shell refuses a
    // non-operator in `consoleShellAccess` rather than here — so the roles a
    // route names are what this can assert on.
    for (const role of route.roles) {
      const d = checkRequirement(student, { role });
      assert.equal(d.ok, false, `a student must not reach ${route.path}`);
      assert.equal(d.ok === false && d.status, 403);
      assert.equal(d.ok === false && d.code, "permission_denied");
      assert.equal(d.ok === false && d.reason, `student_on_console:${role}`);
    }
  }
});

test("an anonymous visitor is refused every console route with 401, not 403", () => {
  // contracts/authorization.md's last row: 401 → sign-in. The distinction
  // matters because 403 tells a signed-out visitor to give up, and 401 tells
  // them to sign in.
  const anon = { kind: "anonymous" as const };
  for (const route of CONSOLE_ROUTES) {
    const reqs = route.roles.length > 0 ? route.roles.map((role) => ({ role })) : [{}];
    for (const req of reqs) {
      const d = checkRequirement(anon, req);
      assert.equal(d.ok, false, `anonymous must not reach ${route.path}`);
      assert.equal(d.ok === false && d.status, 401);
      assert.equal(d.ok === false && d.code, "unauthenticated");
    }
  }
});

test("an operator is refused the student surfaces", () => {
  // The other direction of FR-2205's spirit: the console build carries the
  // student routes (they are excluded at runtime, not at build time), so the
  // seam still has to answer for them.
  const operator = { kind: "operator" as const, operatorId: 1, roles: [...ALL_ROLES] };
  const d = checkRequirement(operator, { student: true });
  assert.equal(d.ok, false);
  assert.equal(d.ok === false && d.status, 403);
  assert.equal(d.ok === false && d.reason, "operator_on_student_surface");
});
