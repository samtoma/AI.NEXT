/**
 * @covers FR-2106, FR-2107, FR-2108, FR-2203, FR-2205
 *
 * The role × requirement matrix (contracts/authorization.md, SC-110).
 *
 * Every refusal is asserted, not just every permission. A matrix test that only
 * checks the ✓ cells proves that the people who should get in do; the cells
 * that matter are the empty ones. This is the test that catches a fifth role
 * quietly implying the other four — which is why FR-2203 says "Samuel holds all
 * four" is four rows and not a fifth role.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  CROSS_STUDENT_READS,
  checkRequirement,
  crossStudentReadAllowed,
  type OperatorRole,
  type Requirement,
} from "./authorize.ts";

const ROLES: OperatorRole[] = [
  "content-review",
  "evidence-access",
  "student-data",
  "cost-billing",
  "teaching-controls",
];

const anonymous = { kind: "anonymous" } as const;
const student = (emailVerified = true) =>
  ({ kind: "student", studentId: 7, accountId: 3, emailVerified }) as const;
const operator = (...roles: OperatorRole[]) =>
  ({ kind: "operator", operatorId: 1, roles }) as const;

test("an unauthenticated visitor is 401, never 403 — the console renders nothing first", () => {
  for (const req of [{}, { student: true }, { role: "student-data" }] as Requirement[]) {
    const d = checkRequirement(anonymous, req);
    assert.equal(d.ok, false);
    if (!d.ok) {
      assert.equal(d.status, 401);
      assert.equal(d.code, "unauthenticated");
    }
  }
});

// FR-2203 — no role implies another and none grants everything.
test("each role opens its own surface and no other", () => {
  for (const held of ROLES) {
    for (const wanted of ROLES) {
      const d = checkRequirement(operator(held), { role: wanted });
      assert.equal(
        d.ok,
        held === wanted,
        `${held} ${held === wanted ? "should" : "must not"} satisfy ${wanted}`
      );
      if (!d.ok) {
        assert.equal(d.status, 403);
        assert.equal(d.code, "permission_denied");
        assert.equal(d.reason, `missing_role:${wanted}`);
      }
    }
  }
});

test("holding all four is four grants, not a fifth role", () => {
  const samuel = operator(...ROLES);
  for (const wanted of ROLES) assert.equal(checkRequirement(samuel, { role: wanted }).ok, true);
  const none = operator();
  for (const wanted of ROLES) assert.equal(checkRequirement(none, { role: wanted }).ok, false);
});

test("the console shell needs a principal and no particular role", () => {
  assert.equal(checkRequirement(operator(), {}).ok, true);
  assert.equal(checkRequirement(student(), {}).ok, true);
  assert.equal(checkRequirement(anonymous, {}).ok, false);
});

// FR-2205 — a student account can never hold an operator role.
test("a student at a console door is refused and the refusal names the door", () => {
  const d = checkRequirement(student(), { role: "student-data" });
  assert.equal(d.ok, false);
  if (!d.ok) {
    assert.equal(d.status, 403);
    assert.equal(d.code, "permission_denied");
    assert.equal(d.reason, "student_on_console:student-data");
  }
});

test("an operator on a student surface is refused too — the seam runs both ways", () => {
  const d = checkRequirement(operator(...ROLES), { student: true });
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.reason, "operator_on_student_surface");
});

// FR-2004 — verification gates LEARNING, not signing in.
test("an unverified student passes a plain student requirement and fails a verified one", () => {
  assert.equal(checkRequirement(student(false), { student: true }).ok, true);
  const d = checkRequirement(student(false), { student: true, verified: true });
  assert.equal(d.ok, false);
  if (!d.ok) {
    assert.equal(d.status, 403);
    assert.equal(d.code, "email_unverified");
  }
  assert.equal(checkRequirement(student(true), { student: true, verified: true }).ok, true);
});

// FR-2108 — the enumerated cross-student reads.
test("every cross-student read is named, roled and owned", () => {
  assert.ok(CROSS_STUDENT_READS.length >= 5);
  const names = new Set(CROSS_STUDENT_READS.map((r) => r.name));
  for (const expected of [
    "student_list",
    "student_360",
    "session_timeline",
    "cost_totals",
    "security_events",
  ]) {
    assert.ok(names.has(expected), `${expected} must be enumerated`);
  }
  for (const entry of CROSS_STUDENT_READS) {
    assert.ok(ROLES.includes(entry.role), `${entry.name} names a real role`);
    assert.ok(entry.owner.length > 0, `${entry.name} has an owner with a name`);
  }
  assert.equal(names.size, CROSS_STUDENT_READS.length, "no duplicate entries");
});

// FR-2406 — cost-billing reads no student content.
test("a read not on the list is refused however many roles you hold", () => {
  assert.equal(crossStudentReadAllowed("session_transcript", ROLES), false);
  assert.equal(crossStudentReadAllowed("", ROLES), false);
  assert.equal(crossStudentReadAllowed("cost_totals", ["cost-billing"]), true);
  assert.equal(
    crossStudentReadAllowed("session_timeline", ["cost-billing"]),
    false,
    "cost-billing does not read a transcript"
  );
});
