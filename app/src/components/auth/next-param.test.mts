// @covers FR-2015
/**
 * `safeNext` — where a sign-in or sign-up is allowed to send the browser.
 *
 * Every value that reaches `?next=` came from a link somebody else may have
 * written. What matters is not the string `safeNext` returns but where a
 * BROWSER goes when handed it, so each refusal below is checked the way a
 * browser would read it: resolved against the real origin, and required to
 * stay there. `/%09/evil.example` was live on noor.reletix.com until this file
 * existed — its decoded form, `/<TAB>/evil.example`, passed the old prefix
 * check and the browser's own tab-stripping turned it into `//evil.example`.
 *
 * Pure: no Next, no request, no DOM. `node --test` only.
 */
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { safeNext } from "./next-param.ts";

const ORIGIN = "https://noor.reletix.com";

/** Where a browser on ORIGIN lands if handed `location` — tabs and newlines stripped first, as the URL standard does. */
const landsOn = (location: string) =>
  new URL(location.replace(/[\t\n\r]/g, ""), ORIGIN).origin;

const ATTACKS = [
  "/\t/evil.example", // ?next=/%09/evil.example after the query string decodes it
  "/\n/evil.example",
  "/\r/evil.example",
  "/\t\t/evil.example",
  "/\\evil.example",
  "/\\/evil.example",
  "//evil.example",
  "//evil.example/student",
  "https://evil.example",
  "http://evil.example/student",
  "javascript:alert(1)",
  "evil.example",
  " /student",
  // dot segments that resolve to a protocol-relative path — the parser
  // produces `//evil.example` from each of these, so the RESULT is checked
  "/.//evil.example",
  "/..//evil.example",
  "/a/..//evil.example",
  "/%2e//evil.example",
  "/%2E%2E//evil.example",
  "/.%2e//evil.example",
];

test("every off-origin form falls back, and none of them would leave the origin", () => {
  for (const raw of ATTACKS) {
    const out = safeNext(raw);
    assert.equal(out, "/student", `${JSON.stringify(raw)} must fall back, got ${JSON.stringify(out)}`);
    assert.equal(landsOn(out), ORIGIN);
  }
});

test("the tab/newline attack, decoded and raw", () => {
  // Decoded — what `searchParams` hands the page for ?next=/%09/evil.example.
  const decoded = decodeURIComponent("/%09/evil.example");
  assert.equal(decoded, "/\t/evil.example");
  assert.equal(safeNext(decoded), "/student");
  assert.equal(safeNext(decodeURIComponent("/%0A/evil.example")), "/student");
  assert.equal(safeNext(decodeURIComponent("/%0D%0A/evil.example")), "/student");

  // Raw — a still-encoded %09 is an ordinary path segment on THIS origin: a
  // browser keeps it percent-encoded and never strips it. Allowed, and it
  // stays home.
  for (const raw of ["/%09/evil.example", "/%0A/evil.example", "/%2F%2Fevil.example"]) {
    const out = safeNext(raw);
    assert.equal(out, raw);
    assert.equal(landsOn(out), ORIGIN, `${raw} left the origin`);
  }
});

test("C0 controls, DEL and the backslash are refused wherever they appear", () => {
  for (let c = 0; c <= 0x1f; c++) {
    assert.equal(safeNext(`/student${String.fromCharCode(c)}x`), "/student", `\\u${c.toString(16)}`);
  }
  assert.equal(safeNext("/student\u007f"), "/student");
  assert.equal(safeNext("/student\\x", "/"), "/");
});

test("an honest in-app path survives with its query and fragment", () => {
  for (const [raw, want] of [
    ["/ok?a=1#h", "/ok?a=1#h"],
    ["/student", "/student"],
    ["/student?mode=learn&lesson=u1-2", "/student?mode=learn&lesson=u1-2"],
    ["/dashboard", "/dashboard"],
    ["/students/14/sessions", "/students/14/sessions"],
    ["/", "/"],
    ["/a/../b", "/b"], // normalised, and still home
  ] as const) {
    assert.equal(safeNext(raw), want);
    assert.equal(landsOn(safeNext(raw)), ORIGIN);
  }
});

test("empty and missing values take the caller's fallback", () => {
  assert.equal(safeNext(undefined), "/student");
  assert.equal(safeNext(null), "/student");
  assert.equal(safeNext(""), "/student");
  assert.equal(safeNext(undefined, "/"), "/", "the console's fallback");
  assert.equal(safeNext("//evil.example", "/"), "/");
});

test("idempotent: the client form re-applies it to what the page already cleaned", () => {
  for (const raw of [...ATTACKS, "/ok?a=1#h", "/%09/x", "/a/../b", "/", undefined]) {
    const once = safeNext(raw);
    assert.equal(safeNext(once), once, JSON.stringify(raw));
  }
});

test("the answer is the fallback or starts with exactly one slash", () => {
  for (const raw of [...ATTACKS, "/ok", "/x/y?z#w", "/%2e%2e/x"]) {
    const out = safeNext(raw, "/fallback");
    assert.ok(out === "/fallback" || (out[0] === "/" && out[1] !== "/"), `${JSON.stringify(raw)} → ${out}`);
  }
});

/* ------------------------------------------------------------------ */
/* Every consumer of `next` goes through safeNext — both surfaces      */
/* ------------------------------------------------------------------ */

const SRC = fileURLToPath(new URL("../../", import.meta.url));

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

test("every page or form that reads a `next` parameter cleans it with safeNext", () => {
  // `sp.next` / `searchParams.get("next")` / a `next` prop that ends in a
  // navigation. The student build and the console build share these files
  // (`/signin` serves both), so one scan covers both surfaces.
  const readsNext = /\bsp\.next\b|searchParams\.get\(\s*["']next["']\s*\)|\bnextUrl\.searchParams\.get\(\s*["']next["']/;
  const consumers = sources(SRC).filter((f) => readsNext.test(readFileSync(f, "utf8")));
  const names = consumers.map((f) => f.slice(SRC.length)).sort();
  // The Cloudflare sign-in route (FR-3301) is the one handler that reads it:
  // it cleans the value on its first line and redirects only through that.
  const ROUTE = "app/api/auth/cloudflare/route.console.ts";
  assert.deepEqual(names, ["app/(auth)/signin/page.tsx", "app/(auth)/signup/page.student.tsx", ROUTE]);
  {
    const src = readFileSync(join(SRC, ROUTE), "utf8");
    assert.match(src, /const next = safeNext\(url\.searchParams\.get\(\s*["']next["']\s*\)/, `${ROUTE} must clean ?next=`);
    assert.equal(src.match(/searchParams\.get\(\s*["']next["']/g)?.length, 1, `${ROUTE} reads ?next= a second time`);
    assert.doesNotMatch(src, /Location:\s*url\.|to\(\s*url\./, `${ROUTE} redirects to an uncleaned value`);
  }
  for (const f of consumers.filter((c) => !c.endsWith(ROUTE))) {
    const src = readFileSync(f, "utf8");
    assert.match(src, /const next = safeNext\(\s*Array\.isArray\(sp\.next\)/, `${f} must clean ?next= before using it`);
    assert.doesNotMatch(src, /redirect\(\s*sp\./, `${f} redirects to an uncleaned value`);
  }
  // The two forms navigate only to their own safeNext of the prop.
  for (const form of ["components/auth/SigninForm.tsx", "components/auth/SignupForm.tsx"]) {
    const src = readFileSync(join(SRC, form), "utf8");
    assert.match(src, /const destination = safeNext\(next\)/, form);
    const navs = src.match(/window\.location\.(assign|replace)\(([^)]*)\)/g) ?? [];
    assert.ok(navs.length > 0, `${form}: no navigation found — has the form changed?`);
    for (const n of navs) assert.match(n, /\(destination\)$/, `${form}: ${n}`);
  }
});
