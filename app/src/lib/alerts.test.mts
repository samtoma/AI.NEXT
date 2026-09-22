/**
 * The five alert rules' arithmetic, and the once-per-window property
 * (contracts/admin.md §7, research A5, ADR-0016 §6, FR-2502).
 *
 * Pure: the rules take rows and a `now`, so every threshold and every boundary
 * is testable without a database, a clock or a mail server. The sweep's own
 * half — claiming an `alerts_sent` row before delivering — is the one thing
 * this file cannot reach; what it asserts instead is the property that makes
 * the claim work: **the same condition produces the same
 * `(rule, key, window_start)` on every evaluation**, which is what the primary
 * key then refuses a second time.
 *
 * @covers FR-2502
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CROSS_STUDENT_WINDOW_MS,
  IP_THRESHOLD,
  LOCK_THRESHOLD,
  LOCK_WINDOW_MS,
  LOOKBACK_MS,
  OPERATOR_THRESHOLD,
  OPERATOR_WINDOW_MS,
  accountLockBursts,
  alertMail,
  crossStudentDenials,
  evaluate,
  ipFailureBursts,
  operatorDenials,
  shadowSuspicion,
  windowStart,
  type AlertEventRow,
} from "./alerts.ts";

/* ------------------------------------------------------------- fixtures */

const NOW = Date.parse("2026-09-21T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

let nextId = 1;
function row(over: Partial<AlertEventRow> = {}): AlertEventRow {
  return {
    id: nextId++,
    event: "failed_login",
    actorKind: "account",
    actorId: 7,
    ip: "197.45.1.1",
    reason: "bad_password",
    occurredAt: ago(60_000),
    ...over,
  };
}

const repeat = (n: number, over: Partial<AlertEventRow> = {}) =>
  Array.from({ length: n }, () => row(over));

/* --------------------------------------------------------- thresholds */

test("the thresholds are research A5's, not something rounder", () => {
  assert.equal(LOCK_THRESHOLD, 5);
  assert.equal(IP_THRESHOLD, 20);
  assert.equal(OPERATOR_THRESHOLD, 3);
  assert.equal(LOCK_WINDOW_MS, 15 * 60_000);
  assert.equal(OPERATOR_WINDOW_MS, 60 * 60_000);
});

test("the sweep's lookback covers the longest window any rule reads", () => {
  // Derived rather than written down: a rule with a longer window that forgot
  // to widen the fetch would silently see a truncated history.
  assert.ok(LOOKBACK_MS >= LOCK_WINDOW_MS);
  assert.ok(LOOKBACK_MS >= OPERATOR_WINDOW_MS);
  assert.ok(LOOKBACK_MS >= CROSS_STUDENT_WINDOW_MS);
});

/* ------------------------------------------------------ rule 1: account */

test("four failures for one account do not fire; the fifth does", () => {
  assert.deepEqual(accountLockBursts(repeat(4), NOW), []);
  const fired = accountLockBursts(repeat(5), NOW);
  assert.equal(fired.length, 1);
  assert.equal(fired[0]!.rule, "account_lock_burst");
  assert.equal(fired[0]!.key, "7");
  assert.equal(fired[0]!.detail.failures, 5);
});

test("failures older than the window do not count toward the burst", () => {
  const rows = [
    ...repeat(4),
    row({ occurredAt: ago(LOCK_WINDOW_MS + 1000) }), // just outside
  ];
  assert.deepEqual(accountLockBursts(rows, NOW), [], "a 16-minute-old failure is not in the window");
});

test("five failures spread across two accounts fire for neither", () => {
  const rows = [...repeat(3, { actorId: 7 }), ...repeat(2, { actorId: 8 })];
  assert.deepEqual(accountLockBursts(rows, NOW), []);
});

test("successful sign-ins are not failures", () => {
  assert.deepEqual(accountLockBursts(repeat(9, { event: "successful_login" }), NOW), []);
});

/* ----------------------------------------------------------- rule 2: ip */

test("nineteen failures from one address do not fire; twenty do", () => {
  assert.deepEqual(ipFailureBursts(repeat(19, { actorId: null, actorKind: "anonymous" }), NOW), []);
  const fired = ipFailureBursts(repeat(20, { actorId: null, actorKind: "anonymous" }), NOW);
  assert.equal(fired.length, 1);
  assert.equal(fired[0]!.key, "197.45.1.1");
  assert.equal(fired[0]!.detail.failures, 20);
});

test("failures with no recorded address are counted by no IP rule", () => {
  // A malformed X-Forwarded-For becomes NULL rather than failing the audit row
  // (lib/auth/events.ts). It must not then become a bucket of its own.
  assert.deepEqual(ipFailureBursts(repeat(25, { ip: null }), NOW), []);
});

/* ----------------------------------------------------- rule 3: operator */

test("three refusals for one operator in an hour fire once, with the routes", () => {
  const rows = [
    row({ event: "permission_denied", actorKind: "operator", actorId: 2, reason: "missing_role:cost-billing:/cost" }),
    row({ event: "permission_denied", actorKind: "operator", actorId: 2, reason: "missing_role:cost-billing:/cost" }),
    row({ event: "permission_denied", actorKind: "operator", actorId: 2, reason: "missing_role:student-data:/security" }),
  ];
  const fired = operatorDenials(rows, NOW);
  assert.equal(fired.length, 1);
  assert.equal(fired[0]!.key, "2");
  assert.equal(fired[0]!.detail.denials, 3);
  assert.match(String(fired[0]!.detail.routes), /\/cost/);
  assert.match(String(fired[0]!.detail.routes), /\/security/);
});

test("anonymous and student refusals are not operator refusals", () => {
  // The ordinary traffic of a signed-out browser hitting a console URL must not
  // raise a mail, or the one rule that mails stops being read.
  const rows = [
    ...repeat(5, { event: "permission_denied", actorKind: "anonymous", actorId: null }),
    ...repeat(5, { event: "permission_denied", actorKind: "account", actorId: 3 }),
  ];
  assert.deepEqual(operatorDenials(rows, NOW), []);
});

/* ------------------------------------------------- rule 4: the zero one */

test("a single cross-student denial fires — the threshold is zero", () => {
  const fired = crossStudentDenials([row({ event: "cross_student_access_denied" })], NOW);
  assert.equal(fired.length, 1);
  assert.equal(fired[0]!.severity, "urgent");
  assert.equal(fired[0]!.delivery, "email");
});

test("two cross-student denials are two alerts, not one aggregate", () => {
  // Each is a separate bug or a separate attempt; collapsing them loses one.
  const fired = crossStudentDenials(
    [row({ event: "cross_student_access_denied" }), row({ event: "cross_student_access_denied" })],
    NOW
  );
  assert.equal(fired.length, 2);
  assert.notEqual(fired[0]!.key, fired[1]!.key, "keyed by event id, so neither hides the other");
});

test("the zero rule keys its window on the EVENT's time, not the sweep's", () => {
  // Otherwise a later sweep computes a new bucket for the same event and mails
  // it again — the precise failure that teaches a mailbox to ignore this rule.
  const e = row({ event: "cross_student_access_denied", occurredAt: ago(10 * 60_000) });
  const early = crossStudentDenials([e], NOW);
  const late = crossStudentDenials([e], NOW + 25 * 60_000);
  assert.equal(early[0]!.windowStart, late[0]!.windowStart);
  assert.equal(early[0]!.key, late[0]!.key);
});

/* ------------------------------------------------------- rule 5: shadow */

test("the shadow rule reports and never mails", () => {
  const fired = shadowSuspicion(repeat(3, { event: "suspicious_activity" }), NOW);
  assert.equal(fired.length, 1);
  assert.equal(fired[0]!.delivery, "log", "impossible-travel-lite logs only for the pilot");
  assert.equal(fired[0]!.detail.mode, "shadow");
});

test("no suspicious activity is no alert, not an alert saying zero", () => {
  assert.deepEqual(shadowSuspicion([], NOW), []);
});

/* -------------------------------------------------- once per window */

test("the same condition produces the same idempotency key on every evaluation", () => {
  // This is what `alerts_sent`'s primary key then refuses the second time. If
  // two evaluations of one unchanged history produced different keys, the
  // table could not make the sweep quiet no matter how it was written.
  const rows = repeat(6);
  const first = evaluate(rows, NOW);
  const second = evaluate(rows, NOW + 90_000); // a sweep 90 seconds later
  const keyOf = (a: { rule: string; key: string; windowStart: string }) =>
    `${a.rule}|${a.key}|${a.windowStart}`;
  assert.deepEqual(first.map(keyOf), second.map(keyOf));
});

test("a genuinely new burst in the next window gets a new key", () => {
  const key = (at: number) => windowStart(at, LOCK_WINDOW_MS);
  const a = key(NOW);
  const b = key(NOW + LOCK_WINDOW_MS);
  assert.notEqual(a, b, "the next bucket must alert again, or a real second attack is silent");
});

test("the window is floored against the epoch, not against 'now'", () => {
  // Two sweeps four minutes apart must agree about which fifteen minutes they
  // are looking at, or the key drifts with the cron's jitter.
  const t = Date.parse("2026-09-21T12:07:30.000Z");
  assert.equal(windowStart(t, LOCK_WINDOW_MS), "2026-09-21T12:00:00.000Z");
  assert.equal(
    windowStart(t + 4 * 60_000, LOCK_WINDOW_MS),
    "2026-09-21T12:00:00.000Z",
    "still the same bucket"
  );
});

test("evaluate runs all five rules in a deterministic order", () => {
  const rows = [
    ...repeat(5),
    ...repeat(20, { actorKind: "anonymous", actorId: null }),
    ...repeat(3, { event: "permission_denied", actorKind: "operator", actorId: 2 }),
    row({ event: "cross_student_access_denied" }),
    row({ event: "suspicious_activity" }),
  ];
  const rules = evaluate(rows, NOW).map((a) => a.rule);
  assert.deepEqual(
    [...new Set(rules)],
    [
      "account_lock_burst",
      "ip_failure_burst",
      "operator_permission_denied",
      "cross_student_access_denied",
      "impossible_travel_shadow",
    ]
  );
});

/* ------------------------------------------------------------- the mail */

test("the alert mail carries counts and ids, and no free text from a form", () => {
  const [alert] = crossStudentDenials(
    [row({ event: "cross_student_access_denied", reason: "blocked_write:attempts" })],
    NOW
  );
  const mail = alertMail(alert!, "mvp1");
  assert.match(mail.subject, /^\[URGENT\]/);
  assert.match(mail.subject, /mvp1/);
  assert.match(mail.text, /cross_student_access_denied/);
  assert.equal(mail.text.includes("password"), false);
  assert.equal(mail.text.includes("http"), false, "no link, no click-wrapped URL, no pixel");
});

test("a notice-severity alert is not dressed as an emergency", () => {
  const [alert] = accountLockBursts(repeat(5), NOW);
  assert.equal(alert!.severity, "notice");
  assert.match(alertMail(alert!, "mvp1").subject, /^\[Noor security\]/);
});
