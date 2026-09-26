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
 * @covers FR-3102
 * @covers FR-3107
 * @covers FR-4010
 * @covers FR-4105
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
  "/students": ["content-review", "evidence-access", "student-data", "cost-billing", "teaching-controls"],
  "/students/[id]": ["student-data"],
  // The session list, the timeline and the replay (admin.md §3, §4, §5). Each
  // is transcribed on its own line for the reason the whole file is
  // hand-transcribed: "everything under /students is student-data" is a rule,
  // and a rule cannot disagree with the table it is meant to check.
  "/students/[id]/sessions": ["student-data"],
  "/students/[id]/sessions/[sid]": ["student-data"],
  "/students/[id]/sessions/[sid]/replay": ["student-data"],
  "/profile": ["content-review", "evidence-access", "student-data", "cost-billing", "teaching-controls"],
  // ADR-0017 / FR-1011 — the operator's own console skin, posted from the
  // Appearance section of `/profile`. Transcribed with all four roles for the
  // same reason `/profile` carries all four: any signed-in operator may change
  // the colours of their own console, and a role gate on it would admit an
  // operator to the page and refuse them the control it offers. Nothing about
  // a student is readable or writable through this address.
  "/api/console/profile/appearance": [
    "content-review",
    "evidence-access",
    "student-data",
    "cost-billing",
    "teaching-controls",
  ],
  // Migration 023, `lib/catalog.ts` — course availability. NO FR covers this
  // capability (see the page's own header); it is transcribed here anyway
  // because this file's whole argument is that a console route with no row
  // here fails the test, invented requirement or not. `/courses` is the
  // broad per-grade rule: `content-review`, the same role that already
  // decides whether unreviewed generated content reaches a child on
  // `/content`. `.../[id]/courses` is the per-student exception and is
  // `student-data` instead, on purpose — it names a student, and
  // `content-review` must not learn one from this feature.
  "/courses": ["content-review"],
  "/api/console/courses": ["content-review"],
  "/api/console/students/[id]/courses": ["student-data"],
  // Feature 003 (FR-4010, contracts/console.md): a student's curriculum is
  // changed from her console record, by `student-data` only. Not
  // `content-review` (it names a child), not `cost-billing` (FR-2406: no
  // per-student curriculum on any page that role reaches alone).
  "/api/console/students/[id]/curriculum": ["student-data"],
  // ADR-0021 — the tester mark. NO SINGLE ROLE admits it (fix pass,
  // 2026-09-24): it needs `student-data` AND `teaching-controls` together —
  // transcribed in EXPECTED_ALL_OF below, and asserted on its own.
  "/api/console/students/[id]/tester": [],
  "/content": ["content-review"],
  // ADR-0021 — the teaching switches. The page is readable by any ONE of the
  // five roles (it discloses no student: a position, who moved it, a count) —
  // and, since the fix pass, by nobody holding none. The write is
  // `teaching-controls` ALONE — not `content-review`, which it was split out
  // of on 2026-09-24 so it can be narrowed on its own.
  "/teaching": ["content-review", "evidence-access", "student-data", "cost-billing", "teaching-controls"],
  "/api/console/teaching": ["teaching-controls"],
  "/cost": ["cost-billing"],
  // contracts/authorization.md, "Subscription / payment status — read and
  // change": `cost-billing` only. The console's first write endpoint — one of
  // three rows in this matrix that are endpoints rather than pages, alongside
  // the two course-availability routes above. An endpoint asks the same
  // question a page does ("does this role admit"), so it gets the same row.
  "/api/console/students/[id]/subscription": ["cost-billing"],
  // contracts/admin.md §7 Security: `student-data`. The security record names
  // accounts, students and the operators who read their transcripts, so it is
  // the same role the Student 360 needs even though it holds no learning.
  "/security": ["student-data"],
  // In-product feedback (FR-2808, migration 025). `student-data`, and the
  // contrast with the two Overviews rows below is the point of transcribing it
  // by hand: they are all four BECAUSE they carry no individual content, and
  // this page is the opposite — a named child's own free text. The same
  // sentence in contracts/admin.md decides both, in opposite directions.
  "/feedback": ["student-data"],
  // §8 Overviews: "Roles: all four (they carry no individual content)". The
  // metric dictionary is transcribed on its own line rather than covered by a
  // prefix rule, for the reason this whole file exists — a rule cannot disagree
  // with the table it is meant to check.
  "/overview": ["content-review", "evidence-access", "student-data", "cost-billing", "teaching-controls"],
  "/overview/definitions": [
    "content-review",
    "evidence-access",
    "student-data",
    "cost-billing",
    "teaching-controls",
  ],
  "/pipeline": ["evidence-access"],
  "/gallery": ["evidence-access"],
  "/dev/lesson-content": ["evidence-access"],
  "/dev/math-widgets": ["evidence-access"],
  "/dev/social-fixture": ["evidence-access"],
  "/dev/widget-questions": ["evidence-access"],
};

/**
 * The rows that need SEVERAL roles at once, transcribed by hand for the same
 * reason EXPECTED is. For these, EXPECTED lists no single role — none admits
 * alone — and this is the set that must be held together.
 */
const EXPECTED_ALL_OF: Record<string, readonly OperatorRole[]> = {
  "/api/console/students/[id]/tester": ["student-data", "teaching-controls"],
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

test("an ALL-OF row is exactly the transcribed set, and every other row is ANY-OF", () => {
  for (const route of CONSOLE_ROUTES) {
    const pair = EXPECTED_ALL_OF[route.path];
    if (pair === undefined) {
      assert.notEqual(route.allOf, true, `${route.path} is ALL-OF, and the contract says ANY-OF`);
      continue;
    }
    assert.equal(route.allOf, true, `${route.path} must need every one of ${pair.join(" + ")}`);
    assert.deepEqual([...route.roles].sort(), [...pair].sort());
    // Together they admit; each one alone, and every other role, does not.
    assert.equal(routeAdmits(route, pair), true);
    for (const role of ALL_ROLES) {
      assert.equal(routeAdmits(route, [role]), false, `${role} alone must not reach ${route.path}`);
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

test("the teaching switch is teaching-controls' alone, and content-review no longer admits it (ADR-0021)", () => {
  // Samuel, 2026-09-24: the write was specified as `content-review` and moved
  // to a role of its own the same day, so it can be narrowed without touching
  // who reviews content. This is the assertion that stops it drifting back.
  const route = consoleRoute("/api/console/teaching")!;
  assert.equal(routeAdmits(route, ["teaching-controls"]), true);
  for (const role of ["content-review", "evidence-access", "student-data", "cost-billing"] as const) {
    assert.equal(routeAdmits(route, [role]), false, `${role} must not move the teaching switch`);
  }
  assert.equal(routeAdmits(route, []), false, "no role admits no write");

  // And through the seam the handler actually calls — every other role
  // refused, and recorded as the missing role by name.
  const teaching = { kind: "operator" as const, operatorId: 1, roles: ["teaching-controls" as const] };
  assert.equal(checkRequirement(teaching, { role: "teaching-controls" }).ok, true);
  for (const role of ["content-review", "evidence-access", "student-data", "cost-billing"] as const) {
    const refused = checkRequirement(
      { kind: "operator" as const, operatorId: 2, roles: [role] },
      { role: "teaching-controls" }
    );
    assert.equal(refused.ok, false);
    assert.equal(refused.ok === false && refused.status, 403);
    assert.equal(refused.ok === false && refused.reason, "missing_role:teaching-controls");
  }

  // Reading it is any role-holder's — and not an operator's whose every role
  // was revoked (fix pass, 2026-09-24).
  assert.equal(routeAdmits(consoleRoute("/teaching")!, ["cost-billing"]), true);
  assert.equal(routeAdmits(consoleRoute("/teaching")!, []), false);
});

test("a student's curriculum is student-data's alone to read and change (FR-4010, FR-4105, FR-2406)", () => {
  // Feature 003, decision 4 and privacy review F7. The record that SHOWS a
  // curriculum (the Student 360) and the endpoint that CHANGES one admit the
  // same single role. `cost-billing` reaches the student list — whose
  // cost projection carries no curriculum (`console-curriculum.test.mts`) —
  // and nothing else about a student; `content-review` owns the per-grade
  // rule on `/courses` and learns a headcount there, never a name.
  const record = consoleRoute("/students/[id]")!;
  const change = consoleRoute("/api/console/students/[id]/curriculum")!;
  for (const route of [record, change]) {
    assert.equal(routeAdmits(route, ["student-data"]), true, `${route.path}`);
    for (const role of ["content-review", "evidence-access", "cost-billing", "teaching-controls"] as const) {
      assert.equal(routeAdmits(route, [role]), false, `${role} must not reach ${route.path}`);
    }
    assert.equal(routeAdmits(route, []), false, "no role admits no student record");
  }
  assert.equal(change.kind, "route");
  assert.notEqual(change.allOf, true, "one role, not a pair");

  // Through the seam the handler calls: billing-only is refused, and the
  // refusal names the role it lacks.
  const billing = { kind: "operator" as const, operatorId: 1, roles: ["cost-billing" as const] };
  const content = { kind: "operator" as const, operatorId: 2, roles: ["content-review" as const] };
  const data = { kind: "operator" as const, operatorId: 3, roles: ["student-data" as const] };
  assert.equal(checkRequirement(data, { role: "student-data" }).ok, true);
  for (const op of [billing, content]) {
    const refused = checkRequirement(op, { role: "student-data" });
    assert.equal(refused.ok, false);
    assert.equal(refused.ok === false && refused.status, 403);
    assert.equal(refused.ok === false && refused.reason, "missing_role:student-data");
  }
});

test("the tester mark needs student-data AND teaching-controls — neither alone (ADR-0021)", () => {
  // Fix pass, 2026-09-24: it names a child (student-data) and decides who the
  // tutor experiments on (teaching-controls). Either alone would let one of
  // those decisions be made by somebody the other role was meant to stop.
  const route = consoleRoute("/api/console/students/[id]/tester")!;
  assert.equal(routeAdmits(route, ["student-data", "teaching-controls"]), true);
  assert.equal(routeAdmits(route, ["student-data"]), false);
  assert.equal(routeAdmits(route, ["teaching-controls"]), false);
  assert.equal(routeAdmits(route, ["content-review"]), false);
  assert.equal(routeAdmits(route, ["cost-billing"]), false);
  assert.equal(routeAdmits(route, []), false);

  // And through the seam the handler actually calls: one ALL-OF requirement,
  // refused with the first role missing, in order.
  const req = { allRoles: ["student-data", "teaching-controls"] as const };
  const op = (roles: OperatorRole[]) => ({ kind: "operator" as const, operatorId: 1, roles });
  assert.equal(checkRequirement(op(["student-data", "teaching-controls"]), req).ok, true);
  assert.equal(checkRequirement(op([...ALL_ROLES]), req).ok, true);
  const onlyData = checkRequirement(op(["student-data"]), req);
  assert.equal(onlyData.ok === false && onlyData.status, 403);
  assert.equal(onlyData.ok === false && onlyData.reason, "missing_role:teaching-controls");
  const onlyTeaching = checkRequirement(op(["teaching-controls"]), req);
  assert.equal(onlyTeaching.ok === false && onlyTeaching.reason, "missing_role:student-data");
  const student = { kind: "student" as const, studentId: 1, accountId: 1, emailVerified: true };
  const s = checkRequirement(student, req);
  assert.equal(s.ok === false && s.reason, "student_on_console:student-data");
  const anon = checkRequirement({ kind: "anonymous" as const }, req);
  assert.equal(anon.ok === false && anon.status, 401);
});
