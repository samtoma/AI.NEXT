/**
 * Staying signed in while a lesson page is open.
 *
 * @covers FR-2016
 * @covers FR-2008
 *
 * FR-2008 revokes every session when a renewal token is presented twice, so the
 * test that matters most here is the concurrency one: two requests failing at
 * once must produce ONE renewal, never two.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACTIVE_WITHIN_MS,
  KEEPALIVE_EVERY_MS,
  RECENT_RENEWAL_MS,
  SIGNED_OUT_MESSAGE,
  authFetch,
  keepAliveDue,
  renewSession,
  renewedRecently,
} from "./client-session.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

/** Replace global fetch for one test; every call is recorded. */
function mockFetch(handler: (url: string, n: number) => Response | Promise<Response>) {
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return handler(url, calls.length);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = real) };
}
const json = (status: number) => new Response("{}", { status });

/* ------------------------------------------------------------ the rules --- */

test("keep-alive renews only for a student who is visibly here", () => {
  const now = 10_000_000;
  const base = { now, visible: true, lastActivityAt: now - 1000, lastRenewedAt: now - KEEPALIVE_EVERY_MS };
  assert.equal(keepAliveDue(base), true);
  assert.equal(keepAliveDue({ ...base, visible: false }), false, "hidden tab: never");
  assert.equal(
    keepAliveDue({ ...base, lastActivityAt: now - ACTIVE_WITHIN_MS - 1 }),
    false,
    "idle past the window: the server's idle expiry must still apply"
  );
  assert.equal(keepAliveDue({ ...base, lastRenewedAt: now - KEEPALIVE_EVERY_MS + 1 }), false);
});

test("keep-alive renews well inside the 15-minute access lifetime", () => {
  assert.ok(KEEPALIVE_EVERY_MS < 15 * 60 * 1000);
});

test("a renewal another tab made moments ago is enough", () => {
  const now = 5_000_000;
  assert.equal(renewedRecently(now - 1000, now), true);
  assert.equal(renewedRecently(now - RECENT_RENEWAL_MS, now), false);
  assert.equal(renewedRecently(null, now), false);
});

/* -------------------------------------------------------- authFetch ---- */

test("a non-401 answer is returned untouched, with no renewal", async () => {
  const m = mockFetch(() => json(500));
  try {
    const r = await authFetch("/api/ask", { method: "POST" });
    assert.equal(r.status, 500);
    assert.deepEqual(m.calls, ["/api/ask"]);
  } finally {
    m.restore();
  }
});

test("a 401 renews once and retries once", async () => {
  let asked = 0;
  const m = mockFetch((url) => {
    if (url === "/api/auth/refresh") return json(200);
    asked++;
    return json(asked === 1 ? 401 : 200);
  });
  try {
    const r = await authFetch("/api/ask", { method: "POST" });
    assert.equal(r.status, 200);
    assert.deepEqual(m.calls, ["/api/ask", "/api/auth/refresh", "/api/ask"]);
  } finally {
    m.restore();
  }
});

test("two 401s at once share ONE renewal — a second would revoke every session", async () => {
  let refreshes = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const seen = new Set<string>();
  const m = mockFetch(async (url) => {
    if (url === "/api/auth/refresh") {
      refreshes++;
      await gate;
      return json(200);
    }
    if (!seen.has(url)) {
      seen.add(url);
      return json(401);
    }
    return json(200);
  });
  try {
    const both = Promise.all([
      authFetch("/api/ask", { method: "POST" }),
      authFetch("/api/attempts", { method: "POST" }),
    ]);
    await new Promise((r) => setTimeout(r, 20));
    release();
    const [a, b] = await both;
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(refreshes, 1);
    // and a direct call while one is in flight joins it too
    assert.equal(renewSession(), renewSession());
  } finally {
    m.restore();
  }
});

test("if renewal fails, the 401 comes back and nothing is retried", async () => {
  const m = mockFetch((url) => (url === "/api/auth/refresh" ? json(401) : json(401)));
  try {
    // a renewal from the previous test is not "recent" for this one
    try { localStorage.removeItem("noor.session.renewedAt"); } catch { /* no storage */ }
    const r = await authFetch("/api/ask", { method: "POST" });
    assert.equal(r.status, 401);
    assert.deepEqual(m.calls, ["/api/ask", "/api/auth/refresh"]);
  } finally {
    m.restore();
  }
});

/* ------------------------------------------------------------ wiring --- */

test("the chat says the student is signed out, not that the AI is down", () => {
  const src = read("../../components/chat/ChatCore.tsx");
  assert.match(src, /await authFetch\("\/api\/ask"/);
  assert.match(src, /res\.status === 401[\s\S]{0,300}text: SIGNED_OUT_MESSAGE/);
  assert.equal(
    SIGNED_OUT_MESSAGE,
    "You have been signed out — try refreshing this page, or sign in again."
  );
});

test("every student API call goes through authFetch; auth endpoints do not", () => {
  const files = [
    "../../components/chat/ChatCore.tsx",
    "../../components/student/LessonSession.tsx",
    "../../components/student/StudentLoop.tsx",
    "../attempts-client.ts",
    "../../components/chat/upload-attachment.tsx",
    "../../components/student/FeedbackPrompt.tsx",
    "../tts-client.ts",
    "../../components/DashboardViewed.tsx",
    "../../components/spine/LoPanel.tsx",
    "../../components/student/WhiteboardPanel.tsx",
    "../../components/viz/VizRefCard.tsx",
  ];
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /(?<![A-Za-z])fetch\([`"']\/api\/(?!auth\/)/, `${f} has a bare fetch to /api`);
    assert.match(src, /authFetch\(/, f);
  }
  // renewal itself uses plain fetch — authFetch on the refresh call would loop
  const lib = read("./client-session.ts");
  assert.match(lib, /await fetch\("\/api\/auth\/refresh"/);
  assert.match(lib, /locks\.request\(LOCK_NAME, renewOnce\)/);
});

test("the keep-alive is mounted for a signed-in student only, and shows nothing itself", () => {
  const layout = read("../../app/layout.tsx");
  assert.match(layout, /\{student !== null && <SessionKeepAlive \/>\}/);
  const comp = read("../../components/auth/SessionKeepAlive.tsx");
  assert.match(comp, /return null;/);
  // the signed-out line lives in the chat only — no page-wide banner
  assert.doesNotMatch(comp, /SIGNED_OUT_MESSAGE|role="alert"/);
  assert.doesNotMatch(read("./client-session.ts"), /dispatchEvent|SIGNED_OUT_EVENT/);
});
