/**
 * The per-lesson snapshot (ADR-0021), exercised through the REAL session code.
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
 * the switch Off" and "a reused session never re-reads the switch" are
 * assertions rather than hopes: the query that should not run would fail the
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
import { currentSession, currentSessionSnapshot } from "./sessions.ts";

// No database, whatever DATABASE_URL says.
(pool as unknown as { connect: () => Promise<never> }).connect = async () => {
  throw new Error("teaching-snapshot.test: no database in a unit test");
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

type OpenRow = { id: number; kind: string; last_seen_at: Date; probing: boolean | null };

function fakeClient(opts: {
  open?: OpenRow | null;
  /** the stored switch; undefined = no row */
  setting?: string;
  isTester?: boolean;
  /** make the probing-inputs read throw */
  inputsFail?: boolean;
  /** make the INSERT lose the one-open-session race to this row */
  loseRaceTo?: OpenRow;
}) {
  const log: string[] = [];
  const inserts: unknown[][] = [];
  let selects = 0;
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
      if (sql.includes("FROM teaching_settings") && sql.includes("FROM student_testers")) {
        if (opts.inputsFail) throw new Error("relation \"teaching_settings\" does not exist");
        return {
          rows: [{ setting: opts.setting ?? null, is_tester: opts.isTester === true }],
          rowCount: 1,
        };
      }
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

test("a REUSED session keeps the snapshot it opened with — the switch is not read again", async () => {
  const now = new Date();
  // Opened OFF; the switch has since been turned on for this tester.
  let f = fakeClient({
    open: { id: 9, kind: "lesson_learn", last_seen_at: now, probing: false },
    setting: "testers",
    isTester: true,
  });
  let r = await quietly(() => currentSession(7, "lesson_learn", { courseOf: async () => MATHS }, f.client));
  assert.deepEqual(
    { id: r.out.sessionId, opened: r.out.opened, probing: r.out.probing },
    { id: 9, opened: false, probing: false }
  );
  assert.ok(!f.log.some((q) => q.includes("teaching_settings")), "the switch was re-read mid-lesson");
  assert.equal(f.inserts.length, 0);

  // Opened ON; the switch has since been turned OFF. The lesson keeps probing.
  f = fakeClient({
    open: { id: 9, kind: "lesson_learn", last_seen_at: now, probing: true },
    setting: "off",
  });
  r = await quietly(() => currentSession(7, "lesson_learn", {}, f.client));
  assert.equal(r.out.probing, true, "a switch flipped mid-lesson must not flip the lesson");

  // A session opened before v0.7.0 has NULL, which is off.
  f = fakeClient({ open: { id: 9, kind: "lesson_learn", last_seen_at: now, probing: null } });
  r = await quietly(() => currentSession(7, "lesson_learn", {}, f.client));
  assert.equal(r.out.probing, false);
});

test("an attempt joining an open lesson takes the lesson's snapshot (adoptOpen)", async () => {
  const f = fakeClient({
    open: { id: 12, kind: "lesson_learn", last_seen_at: new Date(), probing: true },
    setting: "off",
  });
  const { out } = await quietly(() =>
    currentSessionSnapshot(7, "practice", { surface: "attempt", adoptOpen: true }, f.client)
  );
  assert.deepEqual(out, { sessionId: 12, kind: "lesson_learn", probing: true });
});

test("a failure reading the switch resolves OFF and still opens the session", async () => {
  const { client, inserts, log } = fakeClient({ inputsFail: true });
  const { out } = await quietly(() => currentSession(7, "lesson_learn", { courseOf: async () => MATHS }, client));
  assert.equal(out.opened, true, "the student keeps her session");
  assert.equal(out.probing, false, "and loses nothing but probing");
  assert.equal(stored(inserts[0]!).probing, false);
  assert.ok(log.includes("ROLLBACK TO SAVEPOINT probing_inputs"));
});

test("losing the one-open-session race adopts the WINNER's stored snapshot", async () => {
  const { client } = fakeClient({
    setting: "off",
    loseRaceTo: { id: 77, kind: "lesson_learn", last_seen_at: new Date(), probing: true },
  });
  const { out } = await quietly(() => currentSession(7, "lesson_learn", {}, client));
  assert.deepEqual(
    { id: out.sessionId, opened: out.opened, probing: out.probing },
    { id: 77, opened: false, probing: true }
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

test("the client never sends a probing flag; it adopts what the server declares", () => {
  const core = code("components/chat/ChatCore.tsx");
  const askBody = core.slice(core.indexOf('fetch("/api/ask"'), core.indexOf("if (!res.ok || !res.body)"));
  assert.ok(askBody.length > 0);
  assert.doesNotMatch(askBody, /probing/, "the /api/ask request body must not carry probing");
  assert.match(core, /j\.type === "session"/);
  assert.match(core, /adoptProbing\(j\.probing === true\)/);
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
  assert.match(tester, /authorize\(\{ roles: \["student-data", "teaching-controls"\] \}\)/);
  assert.doesNotMatch(tester, /authorize\(\{ role: "/);
  assert.match(tester, /typeof body\.tester !== "boolean"/);
});
