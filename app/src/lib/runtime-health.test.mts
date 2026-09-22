/**
 * The runtime health verdicts, and the judgement the whole feature rests on:
 * **a probe that has not run recently is `unknown`, not healthy** (FR-3001,
 * FR-3002, FR-3006, FR-3007).
 *
 * Pure: `probeVerdict` and `turnVerdict` take rows and a `now`, so staleness,
 * the failure runs and the "quiet night" case are all testable with fixture
 * timestamps and no database, no clock and no CLI. `lib/alerts.ts`'s split,
 * for `lib/alerts.test.mts`'s reasons.
 *
 * **The tests that matter most here are the ones asserting a NEGATIVE**: that a
 * stale pass is not reported as a pass, that zero failed turns out of zero
 * turns is not reported as health, and that a `redacted` turn is not counted as
 * a failure. Each of those is a way this tile could quietly lie, and a lying
 * health tile is worse than no tile at all — it is the state the product was
 * already in for seven weeks, with a nicer surface on top.
 *
 * @covers FR-3001, FR-3002, FR-3006, FR-3007
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PROBE_FAILURE_RUN,
  PROBE_INTERVAL_MS,
  PROBE_KEEP_ROWS,
  STALE_AFTER_MS,
  STATE_WORD,
  STILL_WORKING,
  TURN_FAILURE_RUN,
  TURN_FRESH_MS,
  TURN_SAMPLE,
  healthLines,
  humanDuration,
  probeVerdict,
  runtimeVerdict,
  turnVerdict,
  type ProbeRow,
  type TurnRow,
} from "./runtime-health.ts";

/* ------------------------------------------------------------- fixtures */

const NOW = Date.parse("2026-09-22T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

function probeRow(over: Partial<ProbeRow> = {}): ProbeRow {
  return {
    probe: "claude_cli",
    ok: true,
    code: "ok",
    checkedAt: ago(2 * MIN),
    durationMs: 900,
    ...over,
  };
}

function turnRow(over: Partial<TurnRow> = {}): TurnRow {
  return { outcome: "ok", surfaceKind: "chat", at: ago(5 * MIN), ...over };
}

/* ----------------------------------------------------- the numbers hold */

test("the thresholds are the ones the headers argue for", () => {
  // Pinned so a change is a decision somebody makes rather than a number that
  // drifts: every one of these is argued in prose beside its declaration, and
  // the prose and the value have to stay married.
  assert.equal(PROBE_INTERVAL_MS, 15 * MIN);
  assert.equal(STALE_AFTER_MS, 45 * MIN, "45 minutes = three probe intervals");
  assert.equal(PROBE_FAILURE_RUN, 3, "three consecutive failures = 45 minutes");
  assert.equal(TURN_FAILURE_RUN, 3);
  assert.equal(TURN_SAMPLE, 50);
  assert.equal(PROBE_KEEP_ROWS, 300, "just over three days at the 15-minute cadence");
});

test("the keep window survives a weekend", () => {
  // The reason 300 was chosen over anything smaller: a fault that started on
  // Friday night must not be reported as "failing since midnight".
  const hours = (PROBE_KEEP_ROWS * PROBE_INTERVAL_MS) / 3_600_000;
  assert.ok(hours > 72, `${hours}h of history is less than a weekend`);
});

/* ================================================== THE STALENESS RULE */

test("a fresh pass is `ok`", () => {
  const v = probeVerdict([probeRow()], NOW);
  assert.equal(v.state, "ok");
  assert.equal(v.unknownBecause, null);
  assert.equal(v.code, "ok");
});

test("**a STALE PASS is `unknown`, not `ok`** — the judgement this file exists for", () => {
  // The whole feature. A probe that passed three hours ago says nothing about
  // now: the box may have been rebooted, the cron may be dead, the sign-in may
  // have lapsed forty minutes ago. Reporting it as `ok` is exactly the silence
  // that let a seven-week outage go unnoticed, wearing a green light.
  const v = probeVerdict([probeRow({ checkedAt: ago(3 * 60 * MIN) })], NOW);
  assert.equal(v.state, "unknown");
  assert.equal(v.unknownBecause, "stale");
  // And the age is carried out, because "unknown" without "since when" is not
  // actionable — the page prints it beside the verdict, always.
  assert.equal(v.ageMs, 3 * 60 * MIN);
});

test("a stale FAILURE is also `unknown`, and that is deliberate", () => {
  // Symmetry costs something and is still right: a three-hour-old failure may
  // well have been fixed since, and reporting it as current sends somebody to
  // look at a box that is fine. That costs exactly as much trust as the
  // opposite mistake.
  const v = probeVerdict(
    [probeRow({ ok: false, code: "not_signed_in", checkedAt: ago(4 * 60 * MIN) })],
    NOW
  );
  assert.equal(v.state, "unknown");
  assert.equal(v.unknownBecause, "stale");
  // The code survives, so the page can still say what the last thing it heard
  // was — it just may not call it the present tense.
  assert.equal(v.code, "not_signed_in");
});

test("the staleness boundary is exactly three intervals", () => {
  assert.equal(probeVerdict([probeRow({ checkedAt: ago(STALE_AFTER_MS - 1) })], NOW).state, "ok");
  assert.equal(probeVerdict([probeRow({ checkedAt: ago(STALE_AFTER_MS) })], NOW).state, "ok");
  assert.equal(
    probeVerdict([probeRow({ checkedAt: ago(STALE_AFTER_MS + 1) })], NOW).state,
    "unknown"
  );
});

test("no probe at all is `unknown` for a DIFFERENT reason, and says which", () => {
  // "Never run" and "ran and went quiet" need different copy: one is a
  // feature that was never switched on, the other is a schedule that died.
  const v = probeVerdict([], NOW);
  assert.equal(v.state, "unknown");
  assert.equal(v.unknownBecause, "never_run");
  assert.equal(v.lastAt, null);
  assert.equal(v.ageMs, null);
});

/* ============================================= failing, and failing since */

test("a fresh failure is `failing` and carries its code", () => {
  const v = probeVerdict([probeRow({ ok: false, code: "not_signed_in" })], NOW);
  assert.equal(v.state, "failing");
  assert.equal(v.code, "not_signed_in");
});

test("`failingSince` is the OLDEST failure in the unbroken run", () => {
  // The question an operator actually asks at 9am is "how long has it been
  // like this", and this is the only answer to it. A single upserted row could
  // not produce it, which is why migration 026 keeps a history.
  const rows = [
    probeRow({ ok: false, code: "not_signed_in", checkedAt: ago(5 * MIN) }),
    probeRow({ ok: false, code: "not_signed_in", checkedAt: ago(20 * MIN) }),
    probeRow({ ok: false, code: "not_signed_in", checkedAt: ago(35 * MIN) }),
    probeRow({ ok: true, checkedAt: ago(50 * MIN) }),
    probeRow({ ok: false, code: "call_failed", checkedAt: ago(65 * MIN) }),
  ];
  const v = probeVerdict(rows, NOW);
  assert.equal(v.consecutiveFailures, 3);
  assert.equal(v.failingSince, ago(35 * MIN));
  // The older failure is NOT in the run: a success between them ended it, and
  // counting through a success would report an outage that had been fixed and
  // broken again as one long one.
  assert.equal(v.lastOkAt, ago(50 * MIN));
});

test("a success at the head means no run at all", () => {
  const v = probeVerdict(
    [probeRow({ checkedAt: ago(1 * MIN) }), probeRow({ ok: false, code: "call_failed", checkedAt: ago(16 * MIN) })],
    NOW
  );
  assert.equal(v.consecutiveFailures, 0);
  assert.equal(v.failingSince, null);
});

test("rows arriving out of order are sorted, not trusted", () => {
  // The query orders them; depending on an ordering without enforcing it is
  // how a LIMIT in the wrong place becomes a wrong verdict.
  const rows = [
    probeRow({ ok: true, checkedAt: ago(40 * MIN) }),
    probeRow({ ok: false, code: "not_signed_in", checkedAt: ago(2 * MIN) }),
  ];
  assert.equal(probeVerdict(rows, NOW).state, "failing");
});

test("an unparseable timestamp is dropped rather than poisoning the verdict", () => {
  const rows = [probeRow({ checkedAt: "not a date" }), probeRow({ checkedAt: ago(2 * MIN) })];
  assert.equal(probeVerdict(rows, NOW).state, "ok");
});

/* ======================================== the passive signal — real turns */

test("**no turns is `unknown`, not `ok`** — a quiet night is not health", () => {
  // The passive signal's whole weakness, made visible instead of hidden: zero
  // failures out of zero turns is not evidence of anything, and a tile that
  // rendered it as green would be the seven-week outage all over again on any
  // night nobody was studying.
  const v = turnVerdict([], NOW);
  assert.equal(v.state, "unknown");
  assert.equal(v.sampled, 0);
  assert.equal(v.failed, 0);
});

test("turns that succeeded are `ok`, and the newest one's time comes with them", () => {
  // "50 turns, none failed" is worthless without a date on it: if the newest is
  // from August it is a statement about August.
  const v = turnVerdict([turnRow(), turnRow({ at: ago(30 * MIN) })], NOW);
  assert.equal(v.state, "ok");
  assert.equal(v.newestAt, ago(5 * MIN));
  assert.equal(v.oldestAt, ago(30 * MIN));
});

test("three consecutive failed turns is `failing`; two is not", () => {
  const fail = (m: number) => turnRow({ outcome: "error", at: ago(m * MIN) });
  assert.equal(turnVerdict([fail(1), fail(2)], NOW).state, "ok");
  assert.equal(turnVerdict([fail(1), fail(2), fail(3)], NOW).state, "failing");
  assert.equal(turnVerdict([fail(1), fail(2), fail(3)], NOW).failingSince, ago(3 * MIN));
});

test("`timeout` counts as a failed turn and `error` does too", () => {
  const rows = [
    turnRow({ outcome: "timeout", at: ago(1 * MIN) }),
    turnRow({ outcome: "error", at: ago(2 * MIN) }),
    turnRow({ outcome: "timeout", at: ago(3 * MIN) }),
  ];
  assert.equal(turnVerdict(rows, NOW).state, "failing");
});

test("**`redacted` and `refused` are NOT failures** — the product working as designed", () => {
  // The sacred guard killing a turn and the model declining one are both
  // correct behaviour. Counting them would put a permanent baseline of
  // "failures" under the tile, which is the fastest way to make a health
  // signal mean nothing.
  const rows = [
    turnRow({ outcome: "redacted", at: ago(1 * MIN) }),
    turnRow({ outcome: "refused", at: ago(2 * MIN) }),
    turnRow({ outcome: "redacted", at: ago(3 * MIN) }),
  ];
  const v = turnVerdict(rows, NOW);
  assert.equal(v.state, "ok");
  assert.equal(v.failed, 0);
});

test("only the CLI-spawning surfaces are counted", () => {
  // A surface that does not start the CLI leaking in here would make the tile
  // lie about which program is broken.
  const rows = [
    turnRow({ outcome: "error", surfaceKind: "something_else", at: ago(1 * MIN) }),
    turnRow({ outcome: "error", surfaceKind: null, at: ago(2 * MIN) }),
    turnRow({ outcome: "ok", surfaceKind: "upload_parse", at: ago(3 * MIN) }),
  ];
  const v = turnVerdict(rows, NOW);
  assert.equal(v.sampled, 1);
  assert.equal(v.failed, 0);
  assert.equal(v.state, "ok");
});

test("`lastOkAt` is the damning figure when it is old", () => {
  const rows = [
    turnRow({ outcome: "error", at: ago(60 * MIN) }),
    turnRow({ outcome: "error", at: ago(120 * MIN) }),
    turnRow({ outcome: "error", at: ago(180 * MIN) }),
    turnRow({ outcome: "ok", at: ago(7 * 24 * 60 * MIN) }),
  ];
  const v = turnVerdict(rows, NOW);
  assert.equal(v.state, "failing");
  assert.equal(v.lastOkAt, ago(7 * 24 * 60 * MIN));
});

/* ============================================== the two signals together */

test("observed failures beat a passing probe", () => {
  // A probe answering OK while every lesson turn fails means the fault is
  // downstream of the credential. "Failing" is still the honest headline, and
  // the page still shows both lines so the reader can see the disagreement.
  const fail = (m: number) => turnRow({ outcome: "error", at: ago(m * MIN) });
  const v = runtimeVerdict(
    probeVerdict([probeRow()], NOW),
    turnVerdict([fail(1), fail(2), fail(3)], NOW)
  );
  assert.equal(v.state, "failing");
  assert.equal(v.source, "turns");
});

test("with no traffic, the probe decides — which is what it is for", () => {
  const v = runtimeVerdict(
    probeVerdict([probeRow({ ok: false, code: "not_signed_in" })], NOW),
    turnVerdict([], NOW)
  );
  assert.equal(v.state, "failing");
  assert.equal(v.source, "probe");
});

test("a stale probe with healthy traffic falls back to the traffic", () => {
  const v = runtimeVerdict(
    probeVerdict([probeRow({ checkedAt: ago(5 * 60 * MIN) })], NOW),
    turnVerdict([turnRow()], NOW)
  );
  assert.equal(v.state, "ok");
  assert.equal(v.source, "turns");
});

test("**nothing recent from either signal is `unknown`** — a real state, not a default", () => {
  const v = runtimeVerdict(probeVerdict([], NOW), turnVerdict([], NOW));
  assert.equal(v.state, "unknown");
  assert.equal(v.source, "nothing");
});

/* ------------------------------------------------------------- rendering */

test("the three states have three different words", () => {
  const words = new Set(Object.values(STATE_WORD));
  assert.equal(words.size, 3, "a state that shares a word with another is not a visible state");
  assert.equal(STATE_WORD.unknown, "Unknown");
});

test("what still works is named, because 'the tutor is down' reads as 'everything is down'", () => {
  for (const kept of ["Sign-in", "console", "mastery", "analytics", "cost ledger"]) {
    assert.ok(STILL_WORKING.includes(kept), `${kept} is not named as still working`);
  }
});

test("durations read like a person wrote them", () => {
  assert.equal(humanDuration(0), "0 seconds");
  assert.equal(humanDuration(1_000), "1 second");
  assert.equal(humanDuration(90_000), "1 minute");
  assert.equal(humanDuration(4 * MIN), "4 minutes");
  assert.equal(humanDuration(60 * MIN), "1 hour");
  assert.equal(humanDuration(135 * MIN), "2 hours 15 minutes");
  assert.equal(humanDuration(48 * 60 * MIN), "2 days");
  assert.equal(humanDuration(50 * 60 * MIN), "2 days 2 hours");
  assert.equal(humanDuration(null), "unknown");
});

/* ===================================================================
 * THE COPY — what an operator actually reads (FR-3007, FR-3008)
 *
 * The wording is the requirement, not decoration on one. `.tsx` cannot be
 * loaded by `node --test`, so a tile holding its own sentences could only ever
 * be checked by opening a browser — and this feature was written with no dev
 * server available. These assertions are the substitute, and they are stronger
 * than a glance would have been: they fail if "stale" ever starts reading like
 * "healthy".
 * ================================================================ */

// A short, obvious timestamp format, so an assertion about a sentence is about
// the sentence. The console passes `stamp()`, which renders UTC and says so.
const at = (iso: string) => iso.slice(11, 16);
const label = (c: string) => (c === "not_signed_in" ? "Signed out, or the sign-in expired" : c);
const action = (c: string) =>
  c === "not_signed_in" ? "Only Samuel can fix this, and only from a terminal." : "";

const THRESHOLDS = {
  probeIntervalMs: PROBE_INTERVAL_MS,
  staleAfterMs: STALE_AFTER_MS,
  failureRun: PROBE_FAILURE_RUN,
  turnSample: TURN_SAMPLE,
};

const lines = (probes: ProbeRow[], turns: TurnRow[]) =>
  healthLines(
    runtimeVerdict(probeVerdict(probes, NOW), turnVerdict(turns, NOW)),
    THRESHOLDS,
    at,
    label,
    action
  );

test("copy · HEALTHY says when, and says the claim is about that moment only", () => {
  const l = lines([probeRow({ checkedAt: ago(4 * MIN), durationMs: 1200 })], [turnRow()]);
  assert.equal(l.word, "Teaching");
  assert.equal(l.probeLead, "The probe answered 4 minutes ago.");
  assert.ok(l.probeRest.includes("gave the right answer"));
  // The honesty clause: a pass is a statement about an instant, and a tile that
  // implied otherwise would be the seven-week outage with better manners.
  assert.ok(l.probeRest.includes("about that moment and about no other"));
  assert.equal(l.whoFixes, null, "nothing is wrong, so nobody is named");
});

test("copy · **STALE never reads as a pass** — the assertion this file is for", () => {
  const l = lines([probeRow({ checkedAt: ago(3 * 60 * MIN) })], []);
  assert.equal(l.word, "Unknown");
  assert.equal(l.probeLead, "Nobody has looked for 3 hours.");
  assert.ok(l.probeRest.includes("This is not a pass."));
  assert.ok(l.probeRest.includes("a fact about the past, not about now"));
  // Negative control on the same string: none of the healthy phrasing may leak
  // into it. If a future edit made stale reuse the pass copy, this fails.
  assert.ok(!l.probeLead.includes("answered"));
  assert.ok(!l.probeRest.includes("gave the right answer"));
});

test("copy · NEVER RUN is a different `unknown`, and says which", () => {
  const l = lines([], []);
  assert.equal(l.word, "Unknown");
  assert.equal(l.probeLead, "No probe has ever run on this environment.");
  assert.ok(l.probeRest.includes("it says nobody has looked"));
  assert.ok(l.provenance.includes("neither signal has anything recent"));
});

test("copy · FAILING names how long, what it was, and what to do", () => {
  const rows = [
    probeRow({ ok: false, code: "not_signed_in", checkedAt: ago(5 * MIN) }),
    probeRow({ ok: false, code: "not_signed_in", checkedAt: ago(20 * MIN) }),
    probeRow({ ok: false, code: "not_signed_in", checkedAt: ago(35 * MIN) }),
    probeRow({ ok: true, checkedAt: ago(50 * MIN) }),
  ];
  const l = lines(rows, []);
  assert.equal(l.word, "Cannot teach");
  assert.equal(l.probeLead, "The tutor has been unable to answer for 35 minutes.");
  assert.ok(l.probeRest.includes("3 readings in a row"));
  assert.ok(l.probeRest.includes("Signed out, or the sign-in expired"));
  assert.ok(l.probeRest.includes("Only Samuel can fix this, and only from a terminal."));
  assert.ok(l.probeRest.includes("It last answered at 11:10"));
});

test("copy · **the third line always says what still works**", () => {
  // In every state, including the healthy one — an operator should have read
  // the sentence before the night they need it.
  const states: Array<[string, ProbeRow[], TurnRow[]]> = [
    ["healthy", [probeRow()], [turnRow()]],
    ["stale", [probeRow({ checkedAt: ago(4 * 60 * MIN) })], []],
    ["never run", [], []],
    ["failing", [probeRow({ ok: false, code: "not_signed_in" })], []],
  ];
  for (const [name, probes, turns] of states) {
    const l = lines(probes, turns);
    for (const kept of ["Sign-in", "console", "mastery", "analytics", "cost ledger"]) {
      assert.ok(l.stillWorking.includes(kept), `${name}: ${kept} is not named`);
    }
    assert.ok(l.stillWorking.includes("she cannot be taught"), name);
  }
});

test("copy · **a lapsed sign-in names Samuel, the terminal and the command**", () => {
  // The incident of 2026-09-22, and the brief's own requirement: say plainly
  // that only Samuel can fix it, reference the procedure, do not duplicate it.
  const l = lines([probeRow({ ok: false, code: "not_signed_in" })], []);
  assert.ok(l.whoFixes!.includes("Only Samuel"));
  assert.ok(l.whoFixes!.includes("interactive and needs a terminal"));
  assert.ok(l.whoFixes!.includes("TAKEOVER.md §5"), "the runbook is not referenced");
  assert.ok(l.whoFixes!.includes("exec -it app claude"), "the command is not named");
  // Referenced, not duplicated: the page must not become a second copy of a
  // procedure, because the copy on the screen is the one that goes stale.
  assert.ok(!l.whoFixes!.includes("docker compose -p"), "the runbook is being duplicated");
});

test("copy · **`unknown` does NOT send anybody to Samuel** — the remedy must match", () => {
  // The first draft printed the sign-in sentence under every non-ok state,
  // including this one. An operator would have escalated to the one person who
  // cannot be reached, about a problem that was a dead cron line. A wrong
  // instruction costs more than no instruction.
  for (const probes of [[probeRow({ checkedAt: ago(4 * 60 * MIN) })], []]) {
    const l = lines(probes, []);
    assert.ok(l.whoFixes!.includes("Nothing here needs Samuel yet"));
    assert.ok(l.whoFixes!.includes("absence of evidence, not evidence of a fault"));
    assert.ok(l.whoFixes!.includes("probe:runtime"), "it does not say what would fix it");
    assert.ok(!l.whoFixes!.includes("Only Samuel"));
  }
});

test("copy · a failure that is not the sign-in says so, to stop the reflex", () => {
  const l = lines([probeRow({ ok: false, code: "cli_missing" })], []);
  assert.ok(l.whoFixes!.includes("not a sign-in problem"));
});

test("copy · turns failing under a healthy probe points downstream, not at Samuel", () => {
  const fail = (m: number) => turnRow({ outcome: "error", at: ago(m * MIN) });
  const l = lines([probeRow()], [fail(1), fail(2), fail(3)]);
  assert.equal(l.word, "Cannot teach");
  assert.ok(l.whoFixes!.includes("downstream of the sign-in"));
  assert.ok(l.whoFixes!.includes("before anybody is woken up"));
});

test("copy · **a quiet night is never reported as no failures**", () => {
  const l = lines([probeRow()], []);
  assert.ok(l.turns.includes("No student has asked the tutor anything"));
  assert.ok(l.turns.includes("A quiet night and a broken tutor look identical here"));
  assert.ok(!l.turns.includes("none failed"));
});

test("copy · healthy traffic is dated, so a figure about August reads as one", () => {
  const l = lines([probeRow()], [turnRow({ at: ago(20 * MIN) }), turnRow({ at: ago(90 * MIN) })]);
  assert.ok(l.turns.startsWith("Of the last 2 real tutor turns (all there are), none failed."));
  assert.ok(l.turns.includes("Newest 11:40 (20 minutes ago), oldest 10:30."));
});

test("copy · failing traffic prints the last turn that worked", () => {
  const fail = (m: number) => turnRow({ outcome: "error", at: ago(m * MIN) });
  const l = lines(
    [probeRow()],
    [fail(1), fail(2), fail(3), turnRow({ at: ago(7 * 24 * 60 * MIN) })]
  );
  assert.ok(l.turns.startsWith("3 real tutor turns in a row failed"));
  assert.ok(l.turns.includes("The last turn that worked was"));
  // Observed beats simulated: the probe passed and the headline is still bad.
  assert.equal(l.word, "Cannot teach");
  assert.ok(l.provenance.startsWith("reading from: real turns"));
});

test("copy · the provenance line names the thresholds it is judged by", () => {
  const l = lines([probeRow()], []);
  assert.ok(l.provenance.includes("probe runs every 15 minutes"));
  assert.ok(l.provenance.includes("stale after 45 minutes"));
  assert.ok(l.provenance.includes("3 failures in a row raises an email"));
});

/* ===================================================================
 * THE REGRESSION THIS FILE ALMOST MISSED
 *
 * Found by RUNNING the tile against the real local database, not by a test:
 * a probe aged to three hours was correctly `unknown`, and the headline still
 * read "Teaching" — because the passive signal fell back on twenty-two
 * successful turns whose newest was TWENTY-THREE HOURS OLD. Every unit test
 * above passed, because every fixture in them had fresh turns in it.
 *
 * That is a stale reading presented as health, arriving through the second
 * signal instead of the first, and it is the exact failure this whole feature
 * exists to prevent. These tests are the fixtures that were missing.
 * ================================================================ */

test("regression · **yesterday's successful turns do NOT rescue a stale probe**", () => {
  const v = runtimeVerdict(
    probeVerdict([probeRow({ checkedAt: ago(3 * 60 * MIN) })], NOW),
    turnVerdict([turnRow({ at: ago(23 * 60 * MIN) }), turnRow({ at: ago(30 * 60 * MIN) })], NOW)
  );
  assert.equal(v.state, "unknown", "a green headline over two stale signals");
  assert.equal(v.source, "nothing");
  assert.equal(v.turns.unknownBecause, "stale");
});

test("regression · traffic is bounded in BOTH directions", () => {
  // A failure run from four hours ago may well have been fixed since. The same
  // argument that makes a stale pass `unknown` makes a stale failure `unknown`,
  // and the probe — which is fresh — gets to decide.
  const oldFail = (h: number) => turnRow({ outcome: "error", at: ago(h * 60 * MIN) });
  const v = runtimeVerdict(
    probeVerdict([probeRow()], NOW),
    turnVerdict([oldFail(4), oldFail(5), oldFail(6)], NOW)
  );
  assert.equal(v.state, "ok");
  assert.equal(v.source, "probe");
});

test("regression · the freshness boundary is two hours", () => {
  assert.equal(TURN_FRESH_MS, 2 * 60 * MIN);
  assert.equal(turnVerdict([turnRow({ at: ago(TURN_FRESH_MS - MIN) })], NOW).state, "ok");
  assert.equal(turnVerdict([turnRow({ at: ago(TURN_FRESH_MS + MIN) })], NOW).state, "unknown");
});

test("regression · stale traffic still PRINTS everything it knows", () => {
  // The window governs the headline, never the figures. "The last turn that
  // worked was seven weeks ago" is the most damning sentence this tile can
  // produce and must never be suppressed for being old.
  const fail = (h: number) => turnRow({ outcome: "error", at: ago(h * 60 * MIN) });
  const l = lines(
    [probeRow({ checkedAt: ago(5 * 60 * MIN) })],
    [fail(5), fail(6), fail(7), turnRow({ at: ago(7 * 24 * 60 * MIN) })]
  );
  assert.equal(l.word, "Unknown");
  assert.ok(l.turns.includes("include 3 that failed"));
  assert.ok(l.turns.includes("nobody has used the tutor recently enough"));
  assert.ok(l.turns.includes("The last turn that worked was"));
});
