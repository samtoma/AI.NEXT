/**
 * The sitting's snapshot and its per-request narrowing (ADR-0021, option B),
 * exercised through the REAL session code.
 *
 * `socratic-probing.test.mts` proves the rule. This file proves the WIRING:
 * that `currentSession` resolves the rule exactly once, when it opens a
 * session, stores the answer and the release on the row it inserts, hands a
 * reused session's stored answer back without looking at the switch again,
 * and fails closed. Then — statically, because a Next route handler cannot be
 * driven under `node --test` without a signed-in principal and a database —
 * that `/api/ask`, `/api/attempts` and the console endpoint obey it.
 *
 * **The fake client THROWS on any query it was not expecting**, like
 * `catalog-gate.test.mts`'s. That is how "the course is never looked up with
 * the switch Off" and "a sitting that opened off never re-reads the switch"
 * are assertions rather than hopes: the query that should not run would fail the
 * test by existing.
 *
 * **Nothing here can reach a database.** `pool.connect` is replaced before any
 * test runs, so the one detached write the session code makes — the
 * `session_started` analytics event — fails in `emit`'s own catch instead of
 * writing into whatever database the default DSN points at.
 *
 * @covers FR-3104
 * @covers FR-3105
 * @covers FR-3106
 * @covers FR-3109
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";

import { pool } from "./db.ts";
import { RELEASE_TAG, resolveReleaseTag } from "./env.ts";
import { currentSession, currentSessionSnapshot, peekSessionProbing } from "./sessions.ts";
import { getTeachingStateOrNull } from "./teaching-queries.ts";

// No database, whatever DATABASE_URL says — the operator pool included
// (read lazily from this global by `operatorPool()`).
(pool as unknown as { connect: () => Promise<never> }).connect = async () => {
  throw new Error("teaching-snapshot.test: no database in a unit test");
};
(globalThis as unknown as { pgOperatorPool: unknown }).pgOperatorPool = {
  connect: async () => {
    throw new Error("teaching-snapshot.test: no operator database in a unit test");
  },
};
// …and the one line that refusal produces, which `emit` logs after the call
// under test has returned: expected here, and noise in the test output.
const consoleError = console.error;
console.error = (...a: unknown[]) => {
  if (String(a[0]).startsWith("[analytics] failed to emit")) return;
  consoleError(...a);
};

const MATHS = "course:prep3-math-en";
const SOCIAL = "course:prep3-social-ar";

type OpenRow = {
  id: number;
  kind: string;
  last_seen_at: Date;
  probing: boolean | null;
  /** when the sitting opened; defaults to 10 minutes ago */
  opened_at?: Date;
};

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
/** Long before any sitting in these tests opened. */
const LONG_AGO = new Date("2026-09-01T00:00:00Z");

function fakeClient(opts: {
  open?: OpenRow | null;
  /** the stored switch; undefined = no row */
  setting?: string;
  isTester?: boolean;
  /** `teaching_settings.updated_at` — when the switch last MOVED; default long ago */
  switchUpdatedAt?: Date;
  /** `student_testers.marked_at` of the student's OPEN mark; default long ago */
  markedAt?: Date;
  /** make the probing-inputs read throw */
  inputsFail?: boolean;
  /** make the INSERT lose the one-open-session race to this row */
  loseRaceTo?: OpenRow;
}) {
  const log: string[] = [];
  const inserts: unknown[][] = [];
  let selects = 0;
  const openedAtOf = (id: unknown) => {
    const row = [opts.open, opts.loseRaceTo].find((r) => r?.id === Number(id));
    return row ? (row.opened_at ?? minutesAgo(10)) : null;
  };
  const client = {
    async query(text: string, values: unknown[] = []) {
      const sql = text.replace(/\s+/g, " ").trim();
      log.push(sql.slice(0, 60));
      if (/^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT) /.test(sql)) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("SELECT id, kind, last_seen_at, probing FROM sessions")) {
        selects++;
        const row = selects > 1 && opts.loseRaceTo ? opts.loseRaceTo : opts.open;
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      // The per-request re-read for a sitting that opened ON (fix pass 2):
      // the switch and the mark each count only if unchanged since the
      // sitting opened — `updated_at <= opened_at`, `marked_at <= opened_at`,
      // answered here from the fixture exactly as the SQL answers it.
      if (sql.includes("FROM teaching_settings") && sql.includes("FROM sessions s")) {
        if (opts.inputsFail) throw new Error("relation \"teaching_settings\" does not exist");
        const openedAt = openedAtOf(values[2]);
        if (!openedAt) return { rows: [], rowCount: 0 };
        const switchSame = (opts.switchUpdatedAt ?? LONG_AGO) <= openedAt;
        const markSame = (opts.markedAt ?? LONG_AGO) <= openedAt;
        return {
          rows: [
            {
              setting: switchSame ? (opts.setting ?? null) : null,
              is_tester: opts.isTester === true && markSame,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM teaching_settings") && sql.includes("FROM student_testers")) {
        if (opts.inputsFail) throw new Error("relation \"teaching_settings\" does not exist");
        return {
          rows: [{ setting: opts.setting ?? null, is_tester: opts.isTester === true }],
          rowCount: 1,
        };
      }
      if (sql.startsWith("UPDATE sessions SET closed_at")) return { rows: [], rowCount: 0 };
      if (sql.startsWith("INSERT INTO sessions")) {
        inserts.push(values);
        if (opts.loseRaceTo) {
          throw Object.assign(new Error("duplicate key"), { code: "23505" });
        }
        return { rows: [{ id: 55 }], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE sessions SET last_seen_at")) return { rows: [], rowCount: 1 };
      throw new Error(`unexpected query: ${sql.slice(0, 120)}`);
    },
    release() {},
  };
  return { client: client as unknown as PoolClient, log, inserts };
}

/** The INSERT's probing and release_tag parameters ($7, $8). */
const stored = (insert: unknown[]) => ({ probing: insert[6], releaseTag: insert[7] });

/** Capture console output for the duration of one call, and silence it. */
async function quietly<T>(fn: () => Promise<T>): Promise<{ out: T; info: string[] }> {
  const info: string[] = [];
  const { info: i0, error: e0 } = console;
  console.info = (...a: unknown[]) => void info.push(a.map(String).join(" "));
  console.error = () => {};
  try {
    return { out: await fn(), info };
  } finally {
    console.info = i0;
    console.error = e0;
  }
}

function courseOfSpy(course: string | null) {
  const calls = { n: 0 };
  return { calls, courseOf: async () => (calls.n++, course) };
}

test("switch Off: a new lesson stores probing=false and never looks up the course", async () => {
  const { client, inserts } = fakeClient({ setting: "off", isTester: true });
  const spy = courseOfSpy(MATHS);
  const { out } = await quietly(() =>
    currentSession(7, "lesson_learn", { surface: "lesson_learn", clientKey: "k", courseOf: spy.courseOf }, client)
  );
  assert.equal(out.opened, true);
  assert.equal(out.probing, false);
  assert.equal(spy.calls.n, 0, "with the switch Off the course is never asked for");
  assert.deepEqual(stored(inserts[0]!), { probing: false, releaseTag: RELEASE_TAG });
});

test("no switch row at all is Off", async () => {
  const { client, inserts } = fakeClient({ isTester: true });
  const spy = courseOfSpy(MATHS);
  const { out } = await quietly(() =>
    currentSession(7, "lesson_learn", { courseOf: spy.courseOf }, client)
  );
  assert.equal(out.probing, false);
  assert.equal(spy.calls.n, 0);
  assert.equal(stored(inserts[0]!).probing, false);
});

test("Test accounts only + a marked tester + a maths lesson: stored ON, with the release", async () => {
  const { client, inserts } = fakeClient({ setting: "testers", isTester: true });
  const spy = courseOfSpy(MATHS);
  const { out, info } = await quietly(() =>
    currentSession(7, "lesson_learn", { surface: "lesson_learn", courseOf: spy.courseOf }, client)
  );
  assert.equal(out.probing, true);
  assert.equal(out.kind, "lesson_learn");
  assert.equal(spy.calls.n, 1, "the course is asked for once, at open");
  assert.deepEqual(stored(inserts[0]!), { probing: true, releaseTag: RELEASE_TAG });

  // The structured log line: one per opened session, with both facts.
  const line = info.find((l) => l.startsWith("[sessions] opened"));
  assert.ok(line, "no [sessions] opened line was logged");
  const json = JSON.parse(line!.slice(line!.indexOf("{")));
  assert.equal(json.session_id, 55);
  assert.equal(json.probing, true);
  assert.equal(json.release_tag, RELEASE_TAG);
  assert.equal(json.kind, "lesson_learn");
});

test("Test accounts only + NOT a tester: off, and the course is never asked for", async () => {
  const { client, inserts } = fakeClient({ setting: "testers", isTester: false });
  const spy = courseOfSpy(MATHS);
  const { out } = await quietly(() => currentSession(7, "lesson_learn", { courseOf: spy.courseOf }, client));
  assert.equal(out.probing, false);
  assert.equal(spy.calls.n, 0);
  assert.equal(stored(inserts[0]!).probing, false);
});

test("a tester in a Social Studies lesson does not probe (maths only, #53 P1-6)", async () => {
  const { client, inserts } = fakeClient({ setting: "testers", isTester: true });
  const spy = courseOfSpy(SOCIAL);
  const { out } = await quietly(() => currentSession(7, "lesson_learn", { courseOf: spy.courseOf }, client));
  assert.equal(out.probing, false);
  assert.equal(spy.calls.n, 1);
  assert.equal(stored(inserts[0]!).probing, false);
});

test("a stored Everyone while locked reaches testers only", async () => {
  for (const [isTester, want] of [[false, false], [true, true]] as const) {
    const { client } = fakeClient({ setting: "everyone", isTester });
    const { out } = await quietly(() =>
      currentSession(7, "lesson_learn", { courseOf: async () => MATHS }, client)
    );
    assert.equal(out.probing, want, `everyone(locked), tester=${isTester}`);
  }
});

test("review mode and a practice session never probe, even for a tester with the switch on", async () => {
  for (const kind of ["lesson_review", "practice", "student_chat"] as const) {
    const { client, inserts } = fakeClient({ setting: "testers", isTester: true });
    const spy = courseOfSpy(MATHS);
    const { out } = await quietly(() => currentSession(7, kind, { courseOf: spy.courseOf }, client));
    assert.equal(out.probing, false, kind);
    assert.equal(spy.calls.n, 0, `${kind}: no course lookup`);
    assert.equal(stored(inserts[0]!).probing, false, kind);
  }
});

test("a session that is not a learn-mode lesson opens with no probing query and no savepoint", async () => {
  // Fix pass, 2026-09-24: only `lesson_learn` can ever probe, so every other
  // kind returns before the switch is read — v0.6.0's session open, exactly.
  for (const kind of ["lesson_review", "practice", "student_chat"] as const) {
    const { client, log } = fakeClient({ setting: "testers", isTester: true });
    const { out } = await quietly(() => currentSession(7, kind, { courseOf: async () => MATHS }, client));
    assert.equal(out.probing, false, kind);
    assert.ok(!log.some((q) => q.includes("teaching_settings")), `${kind}: the switch was read`);
    assert.ok(!log.some((q) => /SAVEPOINT probing_/.test(q)), `${kind}: a probing savepoint was taken`);
  }
});

test("On mid-sitting leaves the current sitting off — and the switch is not even read", async () => {
  // ADR-0021, option B: a sitting that opened OFF is never turned on. The
  // switch has since been turned on for this tester; the sitting stays off,
  // with no extra query, until the next sitting opens.
  const now = new Date();
  const f = fakeClient({
    open: { id: 9, kind: "lesson_learn", last_seen_at: now, probing: false },
    setting: "testers",
    isTester: true,
  });
  const r = await quietly(() => currentSession(7, "lesson_learn", { courseOf: async () => MATHS }, f.client));
  assert.deepEqual(
    { id: r.out.sessionId, opened: r.out.opened, probing: r.out.probing, openedProbing: r.out.openedProbing },
    { id: 9, opened: false, probing: false, openedProbing: false }
  );
  assert.ok(!f.log.some((q) => q.includes("teaching_settings")), "an off sitting must not read the switch");
  assert.equal(f.inserts.length, 0);
});

test("Off mid-sitting: the NEXT request of a sitting that opened ON does not probe", async () => {
  const now = new Date();
  const f = fakeClient({
    open: { id: 9, kind: "lesson_learn", last_seen_at: now, probing: true },
    setting: "off",
    isTester: true,
  });
  const r = await quietly(() => currentSession(7, "lesson_learn", {}, f.client));
  assert.equal(r.out.opened, false, "the same sitting, reused");
  assert.equal(r.out.probing, false, "switching Off reaches the next message");
  assert.equal(r.out.openedProbing, true, "the record of how it opened is untouched");
  assert.equal(
    f.log.filter((q) => q.includes("teaching_settings")).length,
    1,
    "exactly one live read of the switch and the mark"
  );
  assert.equal(f.inserts.length, 0, "no new session: Off does not end the sitting");
});

test("un-marking mid-sitting: the tester's NEXT request does not probe", async () => {
  const now = new Date();
  const f = fakeClient({
    open: { id: 9, kind: "lesson_learn", last_seen_at: now, probing: true },
    setting: "testers",
    isTester: false, // the mark was removed after the sitting opened
  });
  const r = await quietly(() => currentSession(7, "lesson_learn", {}, f.client));
  assert.equal(r.out.probing, false);
  assert.equal(r.out.openedProbing, true);
});

test("a sitting that opened ON keeps probing while the switch and the mark still say so", async () => {
  const now = new Date();
  for (const setting of ["testers", "everyone"] as const) {
    const f = fakeClient({
      open: { id: 9, kind: "lesson_learn", last_seen_at: now, probing: true },
      setting,
      isTester: true,
    });
    const r = await quietly(() => currentSession(7, "lesson_learn", {}, f.client));
    assert.equal(r.out.probing, true, setting);
    assert.equal(r.out.openedProbing, true, setting);
  }
});

/* A sitting, once narrowed, never widens (fix pass 2, FR-3105). */

test("Off then On mid-sitting: the sitting that opened ON stays off", async () => {
  // Opened ON ten minutes ago under Test accounts only; the switch has since
  // gone Off and back to Test accounts only (updated_at after opened_at).
  // Stored AND now are both true again — and it must still not probe: the
  // switch it is looking at is not the one it opened under.
  const f = fakeClient({
    open: { id: 9, kind: "lesson_learn", last_seen_at: new Date(), probing: true, opened_at: minutesAgo(10) },
    setting: "testers",
    isTester: true,
    switchUpdatedAt: minutesAgo(2),
  });
  const r = await quietly(() => currentSession(7, "lesson_learn", {}, f.client));
  assert.deepEqual(
    { id: r.out.sessionId, opened: r.out.opened, probing: r.out.probing, openedProbing: r.out.openedProbing },
    { id: 9, opened: false, probing: false, openedProbing: true }
  );
  assert.equal(f.inserts.length, 0, "the sitting is kept — only its probing ends");
});

test("any move of the switch after the sitting opened ends its probing, even to another On position", async () => {
  const f = fakeClient({
    open: { id: 9, kind: "lesson_learn", last_seen_at: new Date(), probing: true, opened_at: minutesAgo(10) },
    setting: "everyone", // testers → everyone, still on for this tester
    isTester: true,
    switchUpdatedAt: minutesAgo(1),
  });
  const r = await quietly(() => currentSession(7, "lesson_learn", {}, f.client));
  assert.equal(r.out.probing, false);
});

test("un-mark then re-mark mid-sitting: the sitting stays off", async () => {
  // The switch has not moved; the student is marked again — but by a NEW mark
  // made after the sitting opened, not the one it opened under.
  const f = fakeClient({
    open: { id: 9, kind: "lesson_learn", last_seen_at: new Date(), probing: true, opened_at: minutesAgo(10) },
    setting: "testers",
    isTester: true,
    switchUpdatedAt: minutesAgo(60),
    markedAt: minutesAgo(3),
  });
  const r = await quietly(() => currentSession(7, "lesson_learn", {}, f.client));
  assert.equal(r.out.probing, false);
  assert.equal(r.out.openedProbing, true);
});

test("untouched since it opened: the sitting keeps probing", async () => {
  const f = fakeClient({
    open: { id: 9, kind: "lesson_learn", last_seen_at: new Date(), probing: true, opened_at: minutesAgo(10) },
    setting: "testers",
    isTester: true,
    switchUpdatedAt: minutesAgo(60),
    markedAt: minutesAgo(45),
  });
  const r = await quietly(() => currentSession(7, "lesson_learn", {}, f.client));
  assert.equal(r.out.probing, true);
});

test("a NEW sitting after re-enabling probes", async () => {
  // Same history as the Off-then-On case, but the old sitting has gone idle
  // (> 30 min): this request closes it and opens a new one, which resolves
  // from the switch and the mark as they stand — and probes.
  const f = fakeClient({
    open: { id: 9, kind: "lesson_learn", last_seen_at: minutesAgo(45), probing: true, opened_at: minutesAgo(50) },
    setting: "testers",
    isTester: true,
    switchUpdatedAt: minutesAgo(40),
    markedAt: minutesAgo(40),
  });
  const r = await quietly(() =>
    currentSession(7, "lesson_learn", { courseOf: async () => MATHS }, f.client)
  );
  assert.deepEqual(
    { id: r.out.sessionId, opened: r.out.opened, probing: r.out.probing },
    { id: 55, opened: true, probing: true }
  );
  assert.equal(stored(f.inserts[0]!).probing, true);
});

test("the live read compares the switch and the mark with the sitting's own opened_at", () => {
  // The fake above answers the comparison; this pins that the shipped SQL
  // makes it, on the session row it is asked about.
  const sessions = code("lib/sessions.ts");
  const live = sessions.slice(sessions.indexOf("function probingInputsSinceOpen"));
  assert.match(live, /ts\.updated_at <= s\.opened_at/);
  assert.match(live, /t\.unmarked_at IS NULL/);
  assert.match(live, /t\.marked_at <= s\.opened_at/);
  assert.match(live, /FROM sessions s\s+WHERE s\.id = \$3 AND s\.student_id = \$2/);
  assert.match(sessions, /probingInputsSinceOpen\(db, studentId, sessionId\)/);
});

test("a failed live read in a sitting that opened ON answers off, and keeps the sitting", async () => {
  const f = fakeClient({
    open: { id: 9, kind: "lesson_learn", last_seen_at: new Date(), probing: true },
    inputsFail: true,
  });
  const r = await quietly(() => currentSession(7, "lesson_learn", {}, f.client));
  assert.deepEqual(
    { id: r.out.sessionId, probing: r.out.probing, openedProbing: r.out.openedProbing },
    { id: 9, probing: false, openedProbing: true }
  );
  assert.ok(f.log.includes("ROLLBACK TO SAVEPOINT probing_inputs"));
});

test("a session opened before v0.7.0 (NULL) is off, with no live read", async () => {
  const f = fakeClient({ open: { id: 9, kind: "lesson_learn", last_seen_at: new Date(), probing: null } });
  const r = await quietly(() => currentSession(7, "lesson_learn", {}, f.client));
  assert.equal(r.out.probing, false);
  assert.equal(r.out.openedProbing, false);
  assert.ok(!f.log.some((q) => q.includes("teaching_settings")));
});

test("an attempt joining an open lesson gets the lesson's answer for THIS request (adoptOpen)", async () => {
  // Opened ON, switch since turned Off: the attempt does not probe.
  let f = fakeClient({
    open: { id: 12, kind: "lesson_learn", last_seen_at: new Date(), probing: true },
    setting: "off",
  });
  let { out } = await quietly(() =>
    currentSessionSnapshot(7, "practice", { surface: "attempt", adoptOpen: true }, f.client)
  );
  assert.deepEqual(out, { sessionId: 12, kind: "lesson_learn", probing: false, openedProbing: true });

  // Opened ON, still a tester under Test accounts only: it does.
  f = fakeClient({
    open: { id: 12, kind: "lesson_learn", last_seen_at: new Date(), probing: true },
    setting: "testers",
    isTester: true,
  });
  ({ out } = await quietly(() =>
    currentSessionSnapshot(7, "practice", { surface: "attempt", adoptOpen: true }, f.client)
  ));
  assert.deepEqual(out, { sessionId: 12, kind: "lesson_learn", probing: true, openedProbing: true });
});

test("a failure reading the switch resolves OFF and still opens the session", async () => {
  const { client, inserts, log } = fakeClient({ inputsFail: true });
  const { out } = await quietly(() => currentSession(7, "lesson_learn", { courseOf: async () => MATHS }, client));
  assert.equal(out.opened, true, "the student keeps her session");
  assert.equal(out.probing, false, "and loses nothing but probing");
  assert.equal(stored(inserts[0]!).probing, false);
  assert.ok(log.includes("ROLLBACK TO SAVEPOINT probing_inputs"));
});

test("losing the one-open-session race adopts the WINNER's stored snapshot, narrowed like any reuse", async () => {
  // The winner opened ON; the switch and the mark still say on → on.
  let f = fakeClient({
    setting: "testers",
    isTester: true,
    loseRaceTo: { id: 77, kind: "lesson_learn", last_seen_at: new Date(), probing: true },
  });
  let { out } = await quietly(() =>
    currentSession(7, "lesson_learn", { courseOf: async () => MATHS }, f.client)
  );
  assert.deepEqual(
    { id: out.sessionId, opened: out.opened, probing: out.probing, openedProbing: out.openedProbing },
    { id: 77, opened: false, probing: true, openedProbing: true }
  );
  // The winner opened ON but the switch reads Off now → this request is off.
  f = fakeClient({
    setting: "off",
    loseRaceTo: { id: 77, kind: "lesson_learn", last_seen_at: new Date(), probing: true },
  });
  ({ out } = await quietly(() => currentSession(7, "lesson_learn", {}, f.client)));
  assert.deepEqual(
    { id: out.sessionId, probing: out.probing, openedProbing: out.openedProbing },
    { id: 77, probing: false, openedProbing: true }
  );
});

test("RELEASE_TAG: the deployed tag first, then v<version> — never the retired PDR1-0- prefix", () => {
  assert.equal(resolveReleaseTag("v0.7.0", "0.7.0"), "v0.7.0");
  assert.equal(resolveReleaseTag("  v0.7.0+abc1234 ", "0.7.0"), "v0.7.0+abc1234");
  assert.equal(resolveReleaseTag(undefined, "0.7.0"), "v0.7.0");
  assert.equal(resolveReleaseTag("", "0.7.0"), "v0.7.0");
  assert.equal(resolveReleaseTag("   ", "0.6.0"), "v0.6.0");
  assert.ok(!RELEASE_TAG.startsWith("PDR1-0-"), `RELEASE_TAG is ${RELEASE_TAG}`);
});

/* A capped turn is refused outside any sitting, and still told its answer (fix pass 2). */

test("peek: an open learn sitting that opened ON, untouched, on a maths lesson → on — and nothing is written", async () => {
  const f = fakeClient({
    open: { id: 9, kind: "lesson_learn", last_seen_at: new Date(), probing: true, opened_at: minutesAgo(10) },
    setting: "testers",
    isTester: true,
  });
  const spy = courseOfSpy(MATHS);
  const { out } = await quietly(() => peekSessionProbing(7, "lesson_learn", { courseOf: spy.courseOf }, f.client));
  assert.equal(out, true);
  assert.equal(spy.calls.n, 1);
  assert.ok(!f.log.some((q) => /^(UPDATE|INSERT|DELETE)/.test(q)), `a peek wrote: ${f.log.join(" | ")}`);
});

test("peek: every reason to say off says off, and never opens, stamps or closes a session", async () => {
  const cases: [string, Parameters<typeof fakeClient>[0], (() => Promise<string | null>) | undefined][] = [
    ["switched Off since", { open: { id: 9, kind: "lesson_learn", last_seen_at: new Date(), probing: true, opened_at: minutesAgo(10) }, setting: "off", switchUpdatedAt: minutesAgo(1) }, async () => MATHS],
    ["Off then On since", { open: { id: 9, kind: "lesson_learn", last_seen_at: new Date(), probing: true, opened_at: minutesAgo(10) }, setting: "testers", isTester: true, switchUpdatedAt: minutesAgo(1) }, async () => MATHS],
    ["opened off", { open: { id: 9, kind: "lesson_learn", last_seen_at: new Date(), probing: false }, setting: "testers", isTester: true }, async () => MATHS],
    ["nothing open", { open: null, setting: "testers", isTester: true }, async () => MATHS],
    ["idle sitting", { open: { id: 9, kind: "lesson_learn", last_seen_at: minutesAgo(45), probing: true, opened_at: minutesAgo(50) }, setting: "testers", isTester: true }, async () => MATHS],
    ["another kind open", { open: { id: 9, kind: "practice", last_seen_at: new Date(), probing: false }, setting: "testers", isTester: true }, async () => MATHS],
    ["a Social Studies lesson", { open: { id: 9, kind: "lesson_learn", last_seen_at: new Date(), probing: true, opened_at: minutesAgo(10) }, setting: "testers", isTester: true }, async () => SOCIAL],
    ["no way to learn the course", { open: { id: 9, kind: "lesson_learn", last_seen_at: new Date(), probing: true, opened_at: minutesAgo(10) }, setting: "testers", isTester: true }, undefined],
    ["the read fails", { open: { id: 9, kind: "lesson_learn", last_seen_at: new Date(), probing: true, opened_at: minutesAgo(10) }, inputsFail: true }, async () => MATHS],
    ["the course read throws", { open: { id: 9, kind: "lesson_learn", last_seen_at: new Date(), probing: true, opened_at: minutesAgo(10) }, setting: "testers", isTester: true }, async () => { throw new Error("boom"); }],
  ];
  for (const [label, fx, courseOf] of cases) {
    const f = fakeClient(fx);
    const { out } = await quietly(() =>
      peekSessionProbing(7, "lesson_learn", courseOf ? { courseOf } : {}, f.client)
    );
    assert.equal(out, false, label);
    assert.ok(!f.log.some((q) => /^(UPDATE|INSERT|DELETE)/.test(q)), `${label}: a peek wrote`);
  }
  // a surface that can never probe asks nothing at all
  const f = fakeClient({});
  const { out } = await quietly(() => peekSessionProbing(7, "lesson_review", {}, f.client));
  assert.equal(out, false);
  assert.equal(f.log.length, 0);
});

test("/api/ask's capped turn carries the request's answer, read without opening a sitting; ChatCore adopts it", () => {
  const ask = code("app/api/ask/route.ts");
  const capped = ask.slice(ask.indexOf("if (cap != null && delivered >= cap)"), ask.indexOf("const session = await currentSessionSnapshot("));
  assert.ok(capped.length > 0);
  assert.match(capped, /peekSessionProbing\(\s*studentId,\s*surface,/);
  assert.match(capped, /courseOf: \(\) => lessonCourseId\(body\.lesson, client\)/);
  assert.match(capped, /capped: true as const, probing/);
  assert.doesNotMatch(capped, /currentSession(Snapshot|OrNull)?\(/, "a capped turn must not open or touch a sitting");
  assert.match(ask, /type: "cap",[\s\S]{0,120}probing: pre\.probing/, "the cap frame must carry probing");
  // the encoder socratic-probing.test.mts parses with is this one
  assert.match(ask, /const sse = \(obj: unknown\) => `data: \$\{JSON\.stringify\(obj\)\}\\n\\n`;/);
  const core = code("components/chat/ChatCore.tsx");
  assert.match(core, /\.find\(\(l\) => l\.startsWith\("data: "\)\)/);
  assert.match(core, /JSON\.parse\(line\.slice\(6\)\)/);
  // the declaration is taken before the per-type dispatch, so the cap branch gets it too
  const parse = core.slice(core.indexOf("const declaredProbing = probingDeclaredBy(j)"));
  assert.ok(parse.indexOf('j.type === "cap"') > 0);
});

test("/api/attempts declares probing only from a learn-mode lesson sitting", () => {
  const attempts = code("app/api/attempts/route.ts");
  assert.match(attempts, /sessionKind: session\.kind/);
  assert.match(attempts, /\.\.\.attemptProbingDeclaration\(sessionKind, probing\)/);
  const result = attempts.slice(attempts.indexOf("const result: AttemptResult = {"), attempts.indexOf("return NextResponse.json(result)"));
  assert.doesNotMatch(result, /^\s*probing,\s*$/m, "no unconditional probing field in the result");
  // …and the row-writing rule is unchanged: still the effective answer
  assert.match(attempts, /acceptedRetryOf\(retryOfAttemptId, probing\)/);
});

/* --------------------------------------------------------------------- */
/* The routes obey the snapshot — read from source                        */
/* --------------------------------------------------------------------- */

const src = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
/** Source with comments removed, so a sentence ABOUT a thing is not the thing. */
const code = (rel: string) =>
  src(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

test("/api/ask builds the prompt from the session's stored snapshot, never the request", () => {
  const ask = code("app/api/ask/route.ts");
  assert.match(ask, /currentSessionSnapshot\(/);
  assert.doesNotMatch(ask, /currentSessionOrNull\(/, "the ask route must read the snapshot with the session");
  assert.match(ask, /buildLessonContext\([\s\S]*?session\.probing\s*\)/, "buildLessonContext must get session.probing");
  assert.match(ask, /probing:\s*session\.probing/, "the context cache must be keyed by the snapshot");
  assert.match(ask, /send\(\{\s*type:\s*"session",\s*probing\s*\}\)/, "the client must be told the snapshot");
  assert.doesNotMatch(ask, /body\.probing|probing\?:\s*(unknown|boolean)/, "no probing field may be read from the request");
});

test("a learn-mode sitting opened by /api/understanding resolves its snapshot with the lesson's course, as /api/ask does", () => {
  // Fix pass 2: the rating route can OPEN a lesson_learn sitting (the
  // lesson's own had closed), and later asks reuse it. With no courseOf the
  // resolver has no course and stores probing=false for a maths lesson.
  const ask = code("app/api/ask/route.ts");
  const und = code("app/api/understanding/route.ts");
  const RESOLVER = /courseOf: \(\) => lessonCourseId\(body\.lesson, client\)/;
  assert.match(ask, RESOLVER, "/api/ask's resolver moved — keep the two routes on the same one");
  assert.match(und, RESOLVER, "/api/understanding must pass the lesson's course to the session resolver");
  const call = und.slice(und.indexOf("currentSessionOrNull("), und.indexOf("client\n        ),"));
  assert.match(call, /mode === "review"\s*\?\s*\{\}\s*:\s*\{ courseOf:/, "only the learn-mode sitting gets a course (review never probes)");
});

test("a sitting opened with the lesson's course stores ON for a maths lesson, and OFF with none", async () => {
  // What the static check above buys, through the real resolver: the same
  // tester, switch and maths lesson, with and without the course.
  for (const [courseOf, want] of [[async () => MATHS, true], [undefined, false]] as const) {
    const f = fakeClient({ setting: "testers", isTester: true });
    const r = await quietly(() =>
      currentSessionSnapshot(7, "lesson_learn", { surface: "understanding_check", ...(courseOf ? { courseOf } : {}) }, f.client)
    );
    assert.equal(r.out.probing, want);
    assert.equal(stored(f.inserts[0]!).probing, want);
  }
});

test("/api/attempts gates the retry link and the probe stance on the session's snapshot", () => {
  const attempts = code("app/api/attempts/route.ts");
  assert.match(attempts, /currentSessionSnapshot\(/);
  assert.match(
    attempts,
    /const probing = effectiveProbing\(session\.probing, session\.kind, q\.course_id\)/
  );
  assert.match(attempts, /acceptedRetryOf\(retryOfAttemptId, probing\)/);
  assert.match(attempts, /retryOf !== null \? "probe"/, "the probe stance follows the accepted link");
  assert.doesNotMatch(attempts, /body\.probing/);
});

test("a declared Off un-sticks the client: pending dropped, cards reveal (ADR-0021, option B)", () => {
  // The rules are pure and tested in socratic-probing.test.mts; this pins
  // that the components actually USE them, so the tested rule is the shipped one.
  const core = code("components/chat/ChatCore.tsx");
  assert.match(
    core,
    /setPendingConfirmation\(\(prev\) => pendingAfterDeclaration\(prev, declared\)\)/,
    "adoptProbing must drop the pending state through pendingAfterDeclaration"
  );
  const card = code("components/chat/ChatQuestionCard.tsx");
  assert.equal(
    (card.match(/cardWithholdsAnswer\(probing, revealAnswer\)/g) ?? []).length,
    2,
    "the answer chip and the worked solution must both ask cardWithholdsAnswer"
  );
  assert.doesNotMatch(card, /probing && !revealAnswer/, "no second, hand-written copy of the rule");
  assert.doesNotMatch(card, /!probing \|\| revealAnswer/);
});

test("the client never sends a probing flag; it adopts what the server declares", () => {
  const core = code("components/chat/ChatCore.tsx");
  const askBody = core.slice(core.indexOf('fetch("/api/ask"'), core.indexOf("if (!res.ok || !res.body)"));
  assert.ok(askBody.length > 0);
  assert.doesNotMatch(askBody, /probing/, "the /api/ask request body must not carry probing");
  assert.match(core, /j\.type === "session"/);
  assert.match(core, /const declaredProbing = probingDeclaredBy\(j\)/);
  assert.match(core, /if \(declaredProbing !== null\) adoptProbing\(declaredProbing\)/);
  assert.match(core, /typeof r\.probing === "boolean"/);
  assert.doesNotMatch(core, /SOCRATIC_PROBING_ENABLED/);
  const lesson = code("components/student/LessonSession.tsx");
  assert.match(lesson, /onProbingChange=\{setProbing\}/);
  assert.match(lesson, /probing=\{probing\}/);
  assert.doesNotMatch(lesson, /probingActive\(/, "the board must mirror the server, not decide");
});

test("the console refuses Everyone and requires teaching-controls before it writes", () => {
  const route = code("app/api/console/teaching/route.console.ts");
  assert.match(route, /authorize\(\{ role: "teaching-controls" \}\)/);
  assert.doesNotMatch(route, /role: "content-review"/);
  const refusal = route.indexOf("settingChangeRefusal(body.probing)");
  const write = route.indexOf("setProbingSetting(");
  assert.ok(refusal > 0 && write > refusal, "the lock must be checked before the write");
  assert.match(route, /status: 409/);

  // The tester mark needs BOTH roles, in one ALL-OF call (fix pass,
  // 2026-09-24) — and never either alone.
  const tester = code("app/api/console/students/[id]/tester/route.console.ts");
  assert.match(tester, /authorize\(\{ allRoles: \["student-data", "teaching-controls"\] \}\)/);
  assert.doesNotMatch(tester, /authorize\(\{ roles:/, "`roles` is ConsoleRoute's ANY-OF; the seam's ALL-OF is `allRoles`");
  assert.doesNotMatch(tester, /authorize\(\{ role: "/);
  assert.match(tester, /parseTesterMarkBody\(body\)/, "the body is read closed (tester-mark-request.test.mts)");
});

test("the console header's switch read: one per request (React cache), and \"unknown\" when it fails", async () => {
  // Fix pass 2. The failure half runs for real: the operator pool refuses,
  // and the answer is null — which the layout prints as "Probing: unknown".
  const { out } = await quietly(() => getTeachingStateOrNull(1));
  assert.equal(out, null);

  // The per-request half is React's `cache()`, which only memoises inside a
  // server render — so it is pinned from source, as `documentVariant` is.
  const q = code("lib/teaching-queries.ts");
  assert.match(q, /import \{ cache \} from "react";/);
  assert.match(q, /export const getTeachingStateOrNull = cache\(async function getTeachingStateOrNull\(/);
  const layout = code("app/(console)/layout.console.tsx");
  assert.match(layout, /await getTeachingStateOrNull\(access\.operatorId\)/);
  assert.doesNotMatch(layout, /getTeachingState\(/, "the header must use the cached, never-throwing read");
  assert.match(layout, /teaching === null\s*\?\s*"unknown"/);
  const s360 = code("app/(console)/students/[id]/page.console.tsx");
  assert.match(s360, /getTeachingStateOrNull\(access\.operatorId\)/, "the Student 360 shares the header's read");
});
