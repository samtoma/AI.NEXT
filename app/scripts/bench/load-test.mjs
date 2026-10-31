#!/usr/bin/env node
/**
 * Tutor load test — N synthetic students through the same lesson at once.
 *
 * Answers "how many sessions can run in parallel" and "what is the real
 * response time" against a running stack (staging, never production), from
 * the outside, exactly as a browser would: sign in, open a chat session, send
 * turns to /api/ask and read the SSE stream.
 *
 * Zero dependencies: Node 22's fetch and streams. Run it from any machine
 * that can reach the host (this script never touches the box itself).
 *
 *   node app/scripts/bench/load-test.mjs \
 *     --base https://staging-noor.reletix.com \
 *     --accounts /path/to/accounts.json \
 *     --lessons u1-1,u1-2,u1-3,u1-4,u2-1,u2-2,u2-3,u3-1,u3-2,u4-1 \
 *     --turns 5 --concurrency 1,3,5,10 \
 *     --out /path/to/results.jsonl
 *
 * accounts.json: [{"email":"...","password":"..."}, ...] — one STUDENT
 * account per concurrent session (the server allows one open session per
 * student, so two concurrent runs on the same account would collide). The
 * file never leaves the machine and nothing from it is printed.
 *
 * --lessons is a comma list; student k takes lesson k (round-robin), so ten
 * students hit ten DIFFERENT lessons. --lesson <one slug> puts everyone in
 * the same lesson.
 *
 * On the box, in parallel, so the client numbers meet the server's:
 *   docker stats --no-stream ainext-staging-app-1 ; pgrep -c -f 'claude -p'
 *
 * Per turn it records: HTTP status, time to first SSE frame, time to first
 * visible text (the number the student feels), time to `done`, the server's
 * own latencyMs / cost / tokens from the `done` frame, and any `error` frame.
 * Per concurrency level it prints p50 / p95 of each and the error share.
 */

import { readFile, appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------- arguments
const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) =>
    a.startsWith("--") ? [a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? "true" : all[i + 1]] : []
  ).filter((p) => p.length)
);
const BASE = (args.base ?? "").replace(/\/$/, "");
const ACCOUNTS_FILE = args.accounts;
const SURFACE = args.surface ?? "lesson_learn";
const LESSONS = String(args.lessons ?? args.lesson ?? "u1-1").split(",").map((x) => x.trim()).filter(Boolean);
const LESSON = LESSONS[0];
const TURNS = Number(args.turns ?? 5);
const LEVELS = String(args.concurrency ?? "1,3,5,10").split(",").map((n) => Number(n.trim())).filter(Boolean);
const THINK_MS = Number(args.think ?? 2000);
const TURN_TIMEOUT_MS = Number(args.timeout ?? 100_000);
const OUT = args.out ?? `load-test-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.jsonl`;
const LOGIN_ONLY = args["login-only"] === "true";

if (!BASE || !ACCOUNTS_FILE) {
  console.error("usage: --base <url> --accounts <file.json> [--lessons a,b,c | --lesson u1-1] [--turns 5] [--concurrency 1,3,5,10] [--think 2000] [--out file.jsonl] [--login-only]");
  process.exit(2);
}
if (/noor\.reletix\.com$/.test(new URL(BASE).hostname) && !/staging/.test(BASE)) {
  console.error("refusing to load-test production; point --base at the staging host");
  process.exit(2);
}

// What a student says, turn by turn. Fixed, so every run is comparable.
const SCRIPT = [
  "Start now",
  "I think the answer is 5",
  "Why is that?",
  "Can you explain it another way?",
  "Got it — next ✓",
  "I am not sure, can you give me a hint?",
  "Is it 12?",
  "Continue.",
];

// ---------------------------------------------------------------- helpers
const now = () => performance.now();
const pct = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const ms = (x) => (x == null ? "—" : `${(x / 1000).toFixed(2)}s`);
const sleep = (t) => new Promise((r) => setTimeout(r, t));

function cookiesFrom(res) {
  const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return raw.map((c) => c.split(";")[0]).join("; ");
}

async function login(account) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  if (!res.ok) throw new Error(`login ${res.status} for account #${account.index}`);
  const cookie = cookiesFrom(res);
  if (!/ainext_at=/.test(cookie)) throw new Error(`login for account #${account.index} set no access cookie`);
  const j = await res.json().catch(() => ({}));
  return { cookie, studentId: j.studentId ?? null };
}

/** One /api/ask turn; resolves with timings and the reply text. */
async function turn({ cookie, chatSession, transcript, turnIndex, inflight, lesson, account, retried = false, onCookie }) {
  const t0 = now();
  const row = {
    t_request: new Date().toISOString(), turnIndex, status: null,
    ttfb_ms: null, ttft_ms: null, total_ms: null, bytes: 0, deltas: 0,
    error: null, meta: null, inflight_at_start: inflight.n,
  };
  inflight.n++; inflight.max = Math.max(inflight.max, inflight.n);
  const ctrl = new AbortController();
  const killer = setTimeout(() => ctrl.abort(), TURN_TIMEOUT_MS);
  let text = "";
  try {
    const res = await fetch(`${BASE}/api/ask`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ surface: SURFACE, lesson, chatSession, messages: transcript }),
      signal: ctrl.signal,
    });
    row.status = res.status;
    if (res.status === 401 && !retried) {
      // the student access cookie lives 15 minutes; sign in again once and retry
      clearTimeout(killer); inflight.n--;
      const fresh = await login(account);
      onCookie?.(fresh.cookie);
      return turn({ cookie: fresh.cookie, chatSession, transcript, turnIndex, inflight, lesson, account, retried: true, onCookie });
    }
    if (!res.ok || !res.body) { row.error = `http ${res.status}`; return { row, text }; }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (row.ttfb_ms == null) row.ttfb_ms = now() - t0;
      row.bytes += value.byteLength;
      buf += dec.decode(value, { stream: true });
      const frames = buf.split("\n\n");
      buf = frames.pop() ?? "";
      for (const f of frames) {
        const line = f.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        let j; try { j = JSON.parse(line.slice(6)); } catch { continue; }
        if (j.type === "delta" && typeof j.t === "string" && j.t.length) {
          if (row.ttft_ms == null && j.t.trim().length) row.ttft_ms = now() - t0;
          row.deltas++; text += j.t;
        } else if (j.type === "done") {
          row.meta = j.meta ?? null;
        } else if (j.type === "error") {
          row.error = j.message ?? "error frame";
        }
      }
    }
  } catch (e) {
    row.error = e.name === "AbortError" ? `client timeout ${TURN_TIMEOUT_MS}ms` : String(e.message ?? e);
  } finally {
    clearTimeout(killer);
    inflight.n--;
    row.total_ms = now() - t0;
  }
  return { row, text };
}

async function student(account, level, inflight, rows) {
  let { cookie } = await login(account);
  const chatSession = `bench-${randomUUID()}`;
  const lesson = LESSONS[(account.index - 1) % LESSONS.length];
  const transcript = [];
  for (let i = 0; i < TURNS; i++) {
    const say = SCRIPT[i % SCRIPT.length];
    transcript.push({ role: "user", text: say });
    const { row, text } = await turn({ cookie, chatSession, transcript, turnIndex: i, inflight, lesson, account, onCookie: (c) => { cookie = c; } });
    transcript.push({ role: "assistant", text: text || "(no reply)" });
    const out = { level, account: account.index, chatSession, surface: SURFACE, lesson, said: say, replyChars: text.length, ...row };
    rows.push(out);
    await appendFile(OUT, JSON.stringify(out) + "\n");
    if (i < TURNS - 1) await sleep(THINK_MS);
  }
}

function summarise(level, rows) {
  const r = rows.filter((x) => x.level === level);
  const ok = r.filter((x) => !x.error);
  const line = (label, xs) => `${label.padEnd(26)} p50 ${ms(pct(xs, 50)).padStart(7)}   p95 ${ms(pct(xs, 95)).padStart(7)}   max ${ms(xs.length ? Math.max(...xs) : null).padStart(7)}`;
  console.log(`\n== concurrency ${level}: ${r.length} turns, ${r.length - ok.length} errors (${r.length ? Math.round(100 * (r.length - ok.length) / r.length) : 0}%), max in flight seen ${Math.max(0, ...r.map((x) => x.inflight_at_start + 1))}`);
  console.log(line("time to first frame", ok.map((x) => x.ttfb_ms).filter((x) => x != null)));
  console.log(line("time to first text", ok.map((x) => x.ttft_ms).filter((x) => x != null)));
  console.log(line("total (client)", ok.map((x) => x.total_ms)));
  console.log(line("latencyMs (server)", ok.map((x) => x.meta?.latencyMs).filter((x) => x != null)));
  const cost = ok.map((x) => x.meta?.costUsd).filter((x) => typeof x === "number");
  const cacheHit = ok.filter((x) => (x.meta?.cacheReadTokens ?? 0) > 0).length;
  if (cost.length) console.log(`${"cost per turn (imputed)".padEnd(26)} mean $${(cost.reduce((a, b) => a + b, 0) / cost.length).toFixed(4)}   cache-hit turns ${cacheHit}/${ok.length}`);
  const errs = r.filter((x) => x.error).map((x) => x.error);
  if (errs.length) console.log("errors:", [...new Set(errs)].join(" | "));
}

// ---------------------------------------------------------------- main
const accounts = JSON.parse(await readFile(ACCOUNTS_FILE, "utf8")).map((a, i) => ({ ...a, index: i + 1 }));
const need = Math.max(...LEVELS);
if (accounts.length < need) {
  console.error(`need ${need} student accounts for concurrency ${need}, have ${accounts.length}`);
  process.exit(2);
}
if (LOGIN_ONLY) {
  for (const a of accounts) {
    try { await login(a); console.log(`account #${a.index}: ok`); }
    catch (e) { console.log(`account #${a.index}: ${e.message}`); }
  }
  process.exit(0);
}
console.log(`base ${BASE} · surface ${SURFACE} · lessons ${LESSONS.join(",")} · ${TURNS} turns per student · think ${THINK_MS}ms · levels ${LEVELS.join(",")} · out ${OUT}`);
const rows = [];
for (const level of LEVELS) {
  const inflight = { n: 0, max: 0 };
  console.log(`\n-- starting ${level} students at ${new Date().toISOString()}`);
  const started = now();
  await Promise.all(accounts.slice(0, level).map((a) => student(a, level, inflight, rows).catch((e) => {
    const out = { level, account: a.index, error: `student failed: ${e.message}`, t_request: new Date().toISOString() };
    rows.push(out); return appendFile(OUT, JSON.stringify(out) + "\n");
  })));
  console.log(`-- level ${level} done in ${ms(now() - started)}`);
  summarise(level, rows);
  if (level !== LEVELS.at(-1)) await sleep(10_000); // let the box settle between levels
}
console.log(`\nrows written to ${OUT}`);
