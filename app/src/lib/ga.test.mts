/**
 * The GA4 wrapper's allow-lists, its consent defaults and its no-op
 * (contracts/analytics.md "The GA4 wrapper contract", ADR-0016 §2).
 *
 * **SC-113 is verifiable only because the list is short and closed**, and this
 * file is where that closure is asserted: eleven events, five properties, and
 * everything else dropped. A second call site touching `gtag` directly would
 * make every assertion here decorative, which is what
 * `ga-console-guard.test.mts` exists to prevent.
 *
 * Pure: no DOM, no Next, no network. `gtag` is read off `globalThis`, which in a
 * browser IS `window`, so a fake function installed there is exactly what a
 * page would provide.
 *
 * @covers FR-2504
 * @covers FR-2505
 * @covers FR-2506
 * @covers FR-2604
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import {
  GA_EVENTS,
  GA_PROPS,
  consentDefaults,
  gaBootstrap,
  isGaEvent,
  isGaProp,
  sanitiseProps,
  track,
} from "./ga.ts";

/* ------------------------------------------------------------- harness */

type Call = { args: unknown[] };

let calls: Call[] = [];
let warnings: string[] = [];
const realWarn = console.warn;

function installGtag() {
  (globalThis as { gtag?: unknown }).gtag = (...args: unknown[]) => {
    calls.push({ args });
  };
}

function removeGtag() {
  delete (globalThis as { gtag?: unknown }).gtag;
}

beforeEach(() => {
  calls = [];
  warnings = [];
  console.warn = (...a: unknown[]) => {
    warnings.push(a.map(String).join(" "));
  };
});

afterEach(() => {
  console.warn = realWarn;
  removeGtag();
});

/* --------------------------------------------------------- the lists */

test("the event allow-list is exactly eleven names, and no twelfth", () => {
  assert.equal(GA_EVENTS.length, 11);
  assert.equal(new Set(GA_EVENTS).size, 11, "a duplicate name is a list that lost one");
  // Transcribed from contracts/analytics.md by hand, deliberately NOT derived
  // from the module — a test that read its expectation from the list it checks
  // would pass for any list, including a widened one.
  assert.deepEqual([...GA_EVENTS].sort(), [
    "dashboard_viewed",
    "explanation_delivered",
    "lesson_step_viewed",
    "question_asked",
    "retrieval_attempt_started",
    "retrieval_attempt_submitted",
    "session_ended",
    "session_started",
    "unit_completed",
    "unit_started",
    "upload_submitted",
  ]);
});

test("the property allow-list is exactly five names, and no sixth", () => {
  assert.equal(GA_PROPS.length, 5);
  assert.deepEqual([...GA_PROPS].sort(), [
    "environment",
    "grade",
    "module_ordinal",
    "subject",
    "surface",
  ]);
});

test("the four categorically excluded events are not in the list", () => {
  // contracts/analytics.md: `student_created`, `student_selected`,
  // `parent_view_opened` and `safety_flag_raised` never reach GA4. The last is
  // categorical — a signal that a child may be distressed is not telemetry.
  for (const name of [
    "student_created",
    "student_selected",
    "parent_view_opened",
    "safety_flag_raised",
    "account_created",
    "email_verified",
    "button_click",
  ]) {
    assert.equal(isGaEvent(name), false, `${name} must not be sendable to GA4`);
  }
});

test("the never-sent identifiers are not properties", () => {
  for (const name of [
    "student_id",
    "account_id",
    "session_id",
    "lo_id",
    "question_id",
    "attempt_id",
    "is_correct",
    "mastery",
    "band",
    "gender",
    "email",
    "display_name",
    "interests",
    "prompt",
    "answer",
    "user_id",
  ]) {
    assert.equal(isGaProp(name), false, `${name} must never be a GA4 property`);
  }
});

/* ----------------------------------------------------------- dropping */

test("a property outside the five is dropped, not renamed or coerced", () => {
  const { props, dropped } = sanitiseProps({
    surface: "dashboard",
    student_id: 41,
    lo_id: "lo:trig-1",
    gender: "female",
  });
  assert.deepEqual(props, { surface: "dashboard" });
  assert.deepEqual(dropped.sort(), ["gender", "lo_id", "student_id"]);
});

test("a non-scalar value on an allowed key is dropped rather than stringified", () => {
  // `String({answer: "x"})` is how free text reaches a third party under a
  // property name that looked safe.
  const { props, dropped } = sanitiseProps({
    surface: { toString: () => "leaked" } as unknown as string,
    grade: 9,
  });
  assert.deepEqual(props, { grade: 9 });
  assert.deepEqual(dropped, ["surface"]);
});

test("an event outside the eleven is dropped with a warning and never reaches gtag", () => {
  installGtag();
  track("safety_flag_raised", { surface: "lesson" });
  assert.equal(calls.length, 0, "a refused event must not reach gtag at all");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /safety_flag_raised/);
});

test("an allowed event with a forbidden property warns, and sends only the allowed half", () => {
  installGtag();
  track("retrieval_attempt_submitted", {
    surface: "practice",
    question_id: "q:7",
    is_correct: true,
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.args, [
    "event",
    "retrieval_attempt_submitted",
    { surface: "practice" },
  ]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /question_id/);
  assert.match(warnings[0]!, /is_correct/);
});

test("a clean call sends exactly what it was given, and warns about nothing", () => {
  installGtag();
  track("dashboard_viewed", { surface: "dashboard", grade: "9", module_ordinal: 3 });
  assert.deepEqual(calls[0]!.args, [
    "event",
    "dashboard_viewed",
    { surface: "dashboard", grade: "9", module_ordinal: 3 },
  ]);
  assert.deepEqual(warnings, []);
});

/* ------------------------------------------------------------- no-op */

test("track is a no-op when no measurement id configured a tag — but still warns", () => {
  // No `gtag` on globalThis is exactly the state produced by an unset
  // AINEXT_GA_MEASUREMENT_ID, a blocked googletagmanager.com, and a server
  // render. All three must behave identically, and none may throw (FR-2505).
  removeGtag();
  assert.doesNotThrow(() => track("dashboard_viewed", { surface: "dashboard" }));
  assert.equal(calls.length, 0);
  // The allow-list check runs BEFORE the gtag lookup on purpose: a developer
  // with no GA configured is the person most likely to add a bad call site.
  track("not_an_event", {});
  assert.equal(warnings.length, 1);
});

test("a throwing gtag cannot cost the caller a turn", () => {
  (globalThis as { gtag?: unknown }).gtag = () => {
    throw new Error("blocked by extension");
  };
  assert.doesNotThrow(() => track("question_asked", { surface: "student_chat" }));
});

test("track returns undefined, so nothing can be awaited on it", () => {
  installGtag();
  assert.equal(track("session_started", {}), undefined);
});

/* ----------------------------------------------------------- consent */

test("public surface: analytics granted, all three advertising signals denied", () => {
  assert.deepEqual(consentDefaults("public"), {
    analytics_storage: "granted",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
});

test("authenticated student surface: all four denied — cookieless", () => {
  assert.deepEqual(consentDefaults("student-auth"), {
    analytics_storage: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
});

test("the advertising signals are denied on every surface there is", () => {
  // Since 15 June 2026 these three are the sole authority over advertising
  // data — "we turned Google Signals off" is no longer a control (research A1).
  for (const surface of ["public", "student-auth"] as const) {
    const c = consentDefaults(surface);
    assert.equal(c.ad_storage, "denied");
    assert.equal(c.ad_user_data, "denied");
    assert.equal(c.ad_personalization, "denied");
  }
});

/* --------------------------------------------------------- bootstrap */

test("the bootstrap pushes consent BEFORE config — that ordering is the whole control", () => {
  const snippet = gaBootstrap("G-TEST123", "student-auth");
  const consentAt = snippet.indexOf("'consent','default'");
  const configAt = snippet.indexOf("'config'");
  assert.ok(consentAt > -1, "no consent default is set");
  assert.ok(configAt > -1, "no config call is made");
  assert.ok(
    consentAt < configAt,
    "consent must be set before config: GA4 has no cookieless mode, and a default " +
      "denying analytics_storage after config has already run is a cookie already written"
  );
});

test("the bootstrap turns automatic page_view off and strips the query string", () => {
  const snippet = gaBootstrap("G-TEST123", "public");
  assert.match(snippet, /send_page_view:false/);
  assert.match(snippet, /location\.origin\+location\.pathname/);
  assert.equal(
    snippet.includes("location.search"),
    false,
    "/student?lesson=… would hand Google a per-device curriculum path"
  );
});

test("the bootstrap never sets a user_id and never names the Measurement Protocol", () => {
  for (const surface of ["public", "student-auth"] as const) {
    const snippet = gaBootstrap("G-TEST123", surface);
    assert.equal(snippet.includes("user_id"), false);
    assert.equal(snippet.includes("measurement_id"), false);
  }
});

test("the authenticated bootstrap denies analytics_storage in the emitted text", () => {
  // Asserted on the STRING because that string is what the browser executes and
  // what the smoke test greps for in the served HTML.
  assert.match(gaBootstrap("G-X", "student-auth"), /"analytics_storage":"denied"/);
  assert.match(gaBootstrap("G-X", "public"), /"analytics_storage":"granted"/);
});

test("the bootstrap does not carry the googletagmanager domain", () => {
  // The loader URL lives in `components/GaScript.tsx`, a server component whose
  // code never reaches a browser bundle — which is what lets the admin build's
  // client bundle be free of the string entirely (ga-console-guard.test.mts).
  assert.equal(gaBootstrap("G-X", "public").includes("googletagmanager"), false);
});
