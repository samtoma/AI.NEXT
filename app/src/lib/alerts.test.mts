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
 * **Rule 6 (`tutor_unreachable`) was added on 2026-09-22** and is tested at the
 * end of this file rather than in a file of its own: it is an alert rule, it
 * obeys the same once-per-window contract, and the property most worth
 * asserting about it — that it does NOT fire on a single failure — is only
 * legible beside the five rules whose thresholds it is chosen against.
 *
 * @covers FR-2502, FR-3009
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

/* ===================================================================
 * Rule 6 — the tutor cannot teach (FR-3009), added 2026-09-22
 * ================================================================ */

import {
  PROBE_FAILURE_RUN,
  RUNTIME_ALERT_WINDOW_MS,
  type ProbeRow,
} from "./runtime-health.ts";
import { MINUTE_MS, tutorUnreachable } from "./alerts.ts";

function probeRow(over: Partial<ProbeRow> = {}): ProbeRow {
  return {
    probe: "claude_cli",
    ok: false,
    code: "not_signed_in",
    checkedAt: ago(60_000),
    durationMs: 700,
    ...over,
  };
}

/** n failing readings at the fifteen-minute cadence, newest first. */
const failingRun = (n: number, code = "not_signed_in") =>
  Array.from({ length: n }, (_, i) =>
    probeRow({ code, checkedAt: ago((i + 1) * 15 * MINUTE_MS) })
  );

test("[6] **one failed probe does NOT alert** — the rule's whole design", () => {
  // A single `call_failed` at 3am is a rate limit, a DNS blip or a box under
  // memory pressure. A rule that mailed about those is a rule whose mail gets
  // filtered into a folder — which is research A5's warning applied to the one
  // alert the product most needs somebody to read.
  assert.equal(tutorUnreachable(failingRun(1), NOW).length, 0);
});

test("[6] two in a row still does not alert; three does", () => {
  assert.equal(PROBE_FAILURE_RUN, 3);
  assert.equal(tutorUnreachable(failingRun(2), NOW).length, 0);
  assert.equal(tutorUnreachable(failingRun(3), NOW).length, 1);
});

test("[6] a success inside the run resets it", () => {
  // Broken, fixed, broken again is two outages, not one long one — and two
  // failures either side of a success must not add up to the threshold.
  const rows = [
    probeRow({ checkedAt: ago(15 * MINUTE_MS) }),
    probeRow({ checkedAt: ago(30 * MINUTE_MS) }),
    probeRow({ ok: true, code: "ok", checkedAt: ago(45 * MINUTE_MS) }),
    probeRow({ checkedAt: ago(60 * MINUTE_MS) }),
  ];
  assert.equal(tutorUnreachable(rows, NOW).length, 0);
});

test("[6] a STALE run does not alert, because it may already be fixed", () => {
  // Every reading is a failure and the newest is four hours old: the box may
  // have been repaired, or the schedule may be dead. Mailing "the tutor cannot
  // teach" about either sends somebody to look at something that is fine, which
  // costs as much trust as missing a real outage. The console's `unknown` state
  // reports it instead — a pull, honestly labelled as one.
  const stale = failingRun(5).map((r) => ({
    ...r,
    checkedAt: new Date(Date.parse(r.checkedAt) - 4 * 60 * MINUTE_MS).toISOString(),
  }));
  assert.equal(tutorUnreachable(stale, NOW).length, 0);
});

test("[6] no readings at all never alerts", () => {
  // A box with no cron line, and every developer laptop. The absence of a probe
  // is not an outage and must never mail as one.
  assert.equal(tutorUnreachable([], NOW).length, 0);
});

test("[6] a passing probe never alerts", () => {
  assert.equal(tutorUnreachable([probeRow({ ok: true, code: "ok" })], NOW).length, 0);
});

test("[6] it fires once per window, however many sweeps see it", () => {
  // The property that makes `alerts_sent`'s primary key work: the same outage
  // evaluated at three different moments produces the same
  // (rule, key, window_start), so the second and third INSERTs conflict.
  const rows = failingRun(4);
  const a = tutorUnreachable(rows, NOW)[0];
  const b = tutorUnreachable(rows, NOW + 5 * MINUTE_MS)[0];
  const c = tutorUnreachable(rows, NOW + 10 * MINUTE_MS)[0];
  assert.equal(a.windowStart, b.windowStart);
  assert.equal(b.windowStart, c.windowStart);
  assert.equal(a.key, b.key);
});

test("[6] the window is bucketed on the OUTAGE's start, not the sweep's clock", () => {
  const rows = failingRun(3);
  const alert = tutorUnreachable(rows, NOW)[0];
  const since = Date.parse(rows[rows.length - 1].checkedAt);
  assert.equal(alert.windowStart, windowStart(since, RUNTIME_ALERT_WINDOW_MS));
});

test("[6] a run that changes code part-way is ONE outage, not two", () => {
  // Keyed by the probe rather than by the code: `call_failed` for half an hour
  // and then `not_signed_in` is one incident, and two mails about it would
  // fragment the thing an operator is trying to understand.
  const rows = [
    probeRow({ code: "not_signed_in", checkedAt: ago(15 * MINUTE_MS) }),
    probeRow({ code: "call_failed", checkedAt: ago(30 * MINUTE_MS) }),
    probeRow({ code: "call_failed", checkedAt: ago(45 * MINUTE_MS) }),
  ];
  const alerts = tutorUnreachable(rows, NOW);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].key, "claude_cli");
  // The code a reader needs is in the detail, where it does not fragment.
  assert.equal(alerts[0].detail.code, "not_signed_in");
});

test("[6] it is urgent, it mails, and it names how long", () => {
  const alert = tutorUnreachable(failingRun(4), NOW)[0];
  assert.equal(alert.severity, "urgent");
  assert.equal(alert.delivery, "email");
  assert.equal(alert.detail.consecutive_failures, 4);
  assert.equal(alert.detail.threshold, PROBE_FAILURE_RUN);
  assert.ok(String(alert.detail.failing_since).length > 0);
});

test("[6] **the mail says what is still working** — or it causes the wrong panic", () => {
  // "The tutor is down" reads as "everything is down". Somebody would start
  // rolling back a deployment that is fine.
  const alert = tutorUnreachable(failingRun(3), NOW)[0];
  const { subject, text } = alertMail(alert, "mvp1");
  assert.ok(subject.startsWith("[URGENT]"));
  for (const kept of ["Sign-in", "console", "mastery", "cost ledger"]) {
    assert.ok(text.includes(kept), `the mail does not say ${kept} keeps working`);
  }
  assert.ok(text.includes("TAKEOVER.md"), "the mail does not name the procedure");
  assert.ok(text.includes("Only Samuel"), "the mail does not say who can fix it");
});

test("[6] the guidance prose is NOT stored in `detail`", () => {
  // `detail` becomes a JSONB row somebody queries months later; it holds
  // counts, codes and timestamps. Prose belongs in the message.
  const alert = tutorUnreachable(failingRun(3), NOW)[0];
  const serialised = JSON.stringify(alert.detail);
  assert.ok(!serialised.includes("cost ledger"));
  assert.ok(!serialised.includes("TAKEOVER"));
  assert.ok((alert.guidance ?? []).length === 3);
});

test("[6] `evaluate` runs it alongside the five, and defaults to no probes", () => {
  // The default keeps every existing caller's meaning: no probe rows is "the
  // active signal has nothing to say", which is the right answer on a box with
  // no cron line.
  assert.equal(evaluate([], NOW).length, 0);
  const withProbes = evaluate([], NOW, failingRun(3));
  assert.equal(withProbes.length, 1);
  assert.equal(withProbes[0].rule, "tutor_unreachable");
});

test("[mail] a long detail key never runs into its own value", () => {
  // `consecutive_failures` is 20 characters and the padding used to be a fixed
  // 16, so the line read `consecutive_failures3`. Found by reading the sweep's
  // actual output, not by a test — which is why there is now a test.
  const { text } = alertMail(tutorUnreachable(failingRun(3), NOW)[0], "mvp1");
  assert.ok(text.includes("consecutive_failures  3"), text);
  assert.ok(!text.includes("consecutive_failures3"));
});
