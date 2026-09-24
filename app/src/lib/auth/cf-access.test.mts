/**
 * @covers FR-3302, FR-3305, FR-3306, FR-3310, FR-3311, FR-3312
 *
 * Cloudflare Access assertions, verified for real: a locally generated RSA key
 * pair, tokens signed with it by `jose`, and the public half published as a
 * JWKS by a stub HTTP server on 127.0.0.1 — fetched through the same
 * `createRemoteJWKSet` production uses. No network beyond the loopback, no
 * mock of `jose`.
 *
 * The negative cases are the point. A verifier that accepts a good token is
 * easy; what these prove is that it refuses every way a token can be wrong —
 * wrong audience (another Access app of the same team), wrong issuer (another
 * team), expired, not yet valid, signed by a different key, `alg: none`,
 * HS256 keyed with the public key, no email — and that a spoofed
 * `Cf-Access-Authenticated-User-Email` header with no token does nothing.
 */
import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { createRemoteJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";

import {
  ACCESS_APP_LOGOUT_PATH,
  ACCESS_ASSERTION_HEADER,
  canonicalOperatorEmail,
  IDENTITY_CHECK_BUDGET_MS,
  JWKS_OPTIONS,
  proofWithin,
  consoleSigninMode,
  isSigninNavigation,
  readAccessAssertion,
  resolveCfAccessConfig,
  sessionMatchesAccessIdentity,
  verifyAccessAssertion,
  type CfAccessConfig,
} from "./cf-access.ts";

const TEAM = "https://reletix.cloudflareaccess.com";
const AUD = "d810c05df051342ae930ce6ce545e2347057e3ac62abeeb5c2a0f6b11277c004";
const KID = "test-kid-1";

const CONFIG: CfAccessConfig = {
  teamDomain: TEAM,
  issuer: TEAM,
  audience: AUD,
  certsUrl: `${TEAM}/cdn-cgi/access/certs`,
  logoutUrl: "/cdn-cgi/access/logout",
};

let server: Server;
let keys: JWTVerifyGetKey;
let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;
let publicJwk: Record<string, unknown>;
let certsHits = 0;

before(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey as CryptoKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: "RS256", use: "sig" };
  // A second key whose public half is NOT published — a forger's key that
  // claims the published kid.
  otherPrivateKey = (await generateKeyPair("RS256")).privateKey as CryptoKey;

  server = createServer((req, res) => {
    if (req.url === "/cdn-cgi/access/certs") {
      certsHits += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as { port: number };
  keys = createRemoteJWKSet(new URL(`http://127.0.0.1:${port}/cdn-cgi/access/certs`));
});

after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

type Claims = Record<string, unknown>;

async function mint(
  claims: Claims = {},
  opts: { key?: CryptoKey; kid?: string; iss?: string; aud?: string | string[]; exp?: number; nbf?: number } = {}
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = new SignJWT({ email: "Samuel.S.Toma@Gmail.com", type: "app", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: opts.kid ?? KID })
    .setIssuer(opts.iss ?? TEAM)
    .setAudience(opts.aud ?? [AUD])
    .setIssuedAt(now)
    .setExpirationTime(opts.exp ?? now + 3600)
    .setSubject("cf-user-123");
  if (opts.nbf !== undefined) jwt.setNotBefore(opts.nbf);
  return jwt.sign(opts.key ?? privateKey);
}

function b64url(s: string | Buffer): string {
  return Buffer.from(s).toString("base64url");
}

// --------------------------------------------------------------- the good one

test("a valid assertion verifies, via the JWKS fetched from the stub, and yields the email", async () => {
  const token = await mint();
  const result = await verifyAccessAssertion(token, CONFIG, { keys });
  assert.deepEqual(result, { ok: true, email: "samuel.s.toma@gmail.com" }, "lower-cased for matching");
  assert.ok(certsHits >= 1, "the keys came from the stub's /cdn-cgi/access/certs");
});

test("the key set is fetched once and reused, not once per request", async () => {
  const before = certsHits;
  for (let i = 0; i < 5; i++) {
    const r = await verifyAccessAssertion(await mint(), CONFIG, { keys });
    assert.equal(r.ok, true);
  }
  assert.equal(certsHits, before, "five verifications, zero new fetches");
});

test("a single-string audience is accepted as well as Cloudflare's array form", async () => {
  const r = await verifyAccessAssertion(await mint({}, { aud: AUD }), CONFIG, { keys });
  assert.equal(r.ok, true);
});

test("clock tolerance is small: 20 seconds past exp still verifies, 5 minutes does not", async () => {
  const now = Math.floor(Date.now() / 1000);
  const justExpired = await mint({}, { exp: now - 20 });
  assert.equal((await verifyAccessAssertion(justExpired, CONFIG, { keys })).ok, true);
  const longExpired = await mint({}, { exp: now - 300 });
  assert.deepEqual(await verifyAccessAssertion(longExpired, CONFIG, { keys }), {
    ok: false,
    reason: "expired",
  });
});

// ------------------------------------------------------------ the refusals

test("wrong audience (another Access application of the same team) is refused", async () => {
  const token = await mint({}, { aud: ["0000000000000000000000000000000000000000000000000000000000000000"] });
  assert.deepEqual(await verifyAccessAssertion(token, CONFIG, { keys }), { ok: false, reason: "bad_audience" });
});

test("wrong issuer (another team) is refused", async () => {
  const token = await mint({}, { iss: "https://attacker.cloudflareaccess.com" });
  assert.deepEqual(await verifyAccessAssertion(token, CONFIG, { keys }), { ok: false, reason: "bad_issuer" });
});

test("an expired assertion is refused", async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = await mint({}, { exp: now - 3600 });
  assert.deepEqual(await verifyAccessAssertion(token, CONFIG, { keys }), { ok: false, reason: "expired" });
});

test("an assertion not yet valid (nbf in the future) is refused", async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = await mint({}, { nbf: now + 3600 });
  assert.deepEqual(await verifyAccessAssertion(token, CONFIG, { keys }), {
    ok: false,
    reason: "not_yet_valid",
  });
});

test("a bad signature — a forger's key claiming the published kid — is refused", async () => {
  const token = await mint({}, { key: otherPrivateKey });
  assert.deepEqual(await verifyAccessAssertion(token, CONFIG, { keys }), { ok: false, reason: "bad_signature" });
});

test("a tampered payload (email swapped after signing) is refused", async () => {
  const token = await mint();
  const [h, , s] = token.split(".");
  const forgedPayload = b64url(
    JSON.stringify({ email: "attacker@example.com", iss: TEAM, aud: [AUD], exp: Math.floor(Date.now() / 1000) + 3600 })
  );
  const r = await verifyAccessAssertion(`${h}.${forgedPayload}.${s}`, CONFIG, { keys });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "bad_signature");
});

test("alg: none is refused", async () => {
  const header = b64url(JSON.stringify({ alg: "none", typ: "JWT", kid: KID }));
  const payload = b64url(
    JSON.stringify({ email: "samuel.s.toma@gmail.com", iss: TEAM, aud: [AUD], exp: Math.floor(Date.now() / 1000) + 3600 })
  );
  const r = await verifyAccessAssertion(`${header}.${payload}.`, CONFIG, { keys });
  assert.equal(r.ok, false, "an unsigned token proves nothing");
});

test("HS256 keyed with the PUBLIC key (algorithm confusion) is refused", async () => {
  const secret = new TextEncoder().encode(JSON.stringify(publicJwk));
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ email: "samuel.s.toma@gmail.com" })
    .setProtectedHeader({ alg: "HS256", kid: KID })
    .setIssuer(TEAM)
    .setAudience([AUD])
    .setExpirationTime(now + 3600)
    .sign(secret);
  const r = await verifyAccessAssertion(token, CONFIG, { keys });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "bad_algorithm");
});

test("a key id the team never published is refused", async () => {
  const token = await mint({}, { kid: "not-a-published-kid" });
  const r = await verifyAccessAssertion(token, CONFIG, { keys });
  assert.equal(r.ok, false);
});

test("a verified token with no email (a service token) is refused — it proves a machine, not a person", async () => {
  const token = await mint({ email: undefined, common_name: "ci-bot.access" });
  assert.deepEqual(await verifyAccessAssertion(token, CONFIG, { keys }), { ok: false, reason: "no_email" });
});

test("garbage, empty and oversized assertions are refused without throwing", async () => {
  assert.deepEqual(await verifyAccessAssertion("", CONFIG, { keys }), { ok: false, reason: "no_assertion" });
  assert.deepEqual(await verifyAccessAssertion(null, CONFIG, { keys }), { ok: false, reason: "no_assertion" });
  const junk = await verifyAccessAssertion("not.a.jwt", CONFIG, { keys });
  assert.equal(junk.ok, false);
  assert.deepEqual(await verifyAccessAssertion("x".repeat(9000), CONFIG, { keys }), {
    ok: false,
    reason: "too_long",
  });
});

test("keys that cannot be fetched are 'no proof', never a pass", async () => {
  const dead = createRemoteJWKSet(new URL("http://127.0.0.1:1/cdn-cgi/access/certs"), {
    timeoutDuration: 500,
  });
  const r = await verifyAccessAssertion(await mint(), CONFIG, { keys: dead });
  assert.equal(r.ok, false);
});

// ------------------------------------------------------------ configuration

test("configuration: unset team domain means OFF", () => {
  assert.deepEqual(resolveCfAccessConfig({}), { state: "off" });
  assert.deepEqual(resolveCfAccessConfig({ AINEXT_CF_ACCESS_TEAM_DOMAIN: "  " }), { state: "off" });
});

test("configuration: both values set gives the team's certs, issuer and logout URLs", () => {
  for (const team of ["https://reletix.cloudflareaccess.com", "reletix.cloudflareaccess.com", "reletix", "https://reletix.cloudflareaccess.com/"]) {
    const s = resolveCfAccessConfig({ AINEXT_CF_ACCESS_TEAM_DOMAIN: team, AINEXT_CF_ACCESS_AUD: AUD });
    assert.equal(s.state, "on", team);
    if (s.state !== "on") continue;
    assert.deepEqual(s.config, CONFIG, team);
  }
});

test("sign-out goes to the console's OWN Access logout, not the team-wide one (F3)", () => {
  // The team URL leaves the console's CF_Authorization cookie valid for the
  // 20–30 s revocation takes, and the next request signs the person back in.
  const s = resolveCfAccessConfig({ AINEXT_CF_ACCESS_TEAM_DOMAIN: TEAM, AINEXT_CF_ACCESS_AUD: AUD });
  assert.equal(s.state, "on");
  if (s.state !== "on") return;
  assert.equal(s.config.logoutUrl, ACCESS_APP_LOGOUT_PATH);
  assert.equal(ACCESS_APP_LOGOUT_PATH, "/cdn-cgi/access/logout");
  assert.ok(s.config.logoutUrl.startsWith("/") && !s.config.logoutUrl.startsWith("//"), "relative, same host");
  assert.ok(!s.config.logoutUrl.includes("cloudflareaccess.com"), "never the team domain");
});

test("configuration: a team domain with NO audience is not 'verify without aud' — it is off", () => {
  const s = resolveCfAccessConfig({ AINEXT_CF_ACCESS_TEAM_DOMAIN: TEAM });
  assert.equal(s.state, "misconfigured");
});

test("configuration: a key URL we would not trust is refused, not followed", () => {
  for (const team of [
    "http://reletix.cloudflareaccess.com", // not https
    "https://evil.example.com", // not Cloudflare Access
    "https://reletix.cloudflareaccess.com.evil.example", // suffix trick
    "https://reletix.cloudflareaccess.com/some/path",
    "https://user@reletix.cloudflareaccess.com",
  ]) {
    const s = resolveCfAccessConfig({ AINEXT_CF_ACCESS_TEAM_DOMAIN: team, AINEXT_CF_ACCESS_AUD: AUD });
    assert.equal(s.state, "misconfigured", team);
  }
});

// ------------------------------------------------------------ the surfaces

test("the student surface never reads the assertion, however valid", async () => {
  const token = await mint();
  const h = new Headers({ [ACCESS_ASSERTION_HEADER]: token });
  assert.equal(readAccessAssertion("student", h), null);
  assert.equal(readAccessAssertion("admin", h), token);
  // …and the sign-in page on the student build is always the plain form.
  assert.deepEqual(consoleSigninMode({ surface: "student", accessOn: true, hasAssertion: true, cf: null }), {
    mode: "form",
    notice: null,
  });
  // …and no Access proof can unseat a session there.
  const proof = await verifyAccessAssertion(await mint({ email: "someone.else@example.com" }), CONFIG, { keys });
  assert.equal(sessionMatchesAccessIdentity("student", "samuel.s.toma@gmail.com", proof), true);
});

test("a spoofed Cf-Access-Authenticated-User-Email header with no JWT does nothing", () => {
  const h = new Headers({ "cf-access-authenticated-user-email": "samuel.s.toma@gmail.com" });
  assert.equal(readAccessAssertion("admin", h), null, "no assertion — the plain header is not one");
  assert.deepEqual(
    consoleSigninMode({ surface: "admin", accessOn: true, hasAssertion: readAccessAssertion("admin", h) !== null, cf: null }),
    { mode: "form", notice: null },
    "no forward to the Cloudflare sign-in route"
  );
  assert.equal(
    sessionMatchesAccessIdentity("admin", "someone.else@example.com", null),
    true,
    "and no existing session is disturbed by it"
  );
});

test("no source file reads Cf-Access-Authenticated-User-Email", () => {
  const SRC = fileURLToPath(new URL("../..", import.meta.url));
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.(ts|tsx|mts)$/.test(name) || /\.test\.mts$/.test(name)) continue;
      // Strip comments, then look for the header name as code.
      const code = readFileSync(p, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      if (/authenticated-user-email/i.test(code)) offenders.push(relative(SRC, p));
    }
  };
  walk(SRC);
  assert.deepEqual(offenders, [], "the email is taken from the verified JWT and nowhere else");
});

// ------------------------------------------------------------ binding & page

test("an existing session survives no proof and broken proof, and falls to a DIFFERENT proven person", () => {
  const me = "samuel.s.toma@gmail.com";
  assert.equal(sessionMatchesAccessIdentity("admin", me, null), true);
  assert.equal(sessionMatchesAccessIdentity("admin", me, { ok: false, reason: "expired" }), true);
  assert.equal(sessionMatchesAccessIdentity("admin", "Samuel.S.Toma@gmail.com", { ok: true, email: me }), true);
  assert.equal(sessionMatchesAccessIdentity("admin", me, { ok: true, email: "tamer@example.com" }), false);
});

test("the sign-in page forwards once, and the route's answer (?cf=) stops it forwarding again", () => {
  const base = { surface: "admin" as const, accessOn: true, hasAssertion: true };
  assert.deepEqual(consoleSigninMode({ ...base, cf: null }), { mode: "forward" });
  assert.deepEqual(consoleSigninMode({ ...base, cf: "invalid" }), { mode: "form", notice: "invalid" });
  assert.deepEqual(consoleSigninMode({ ...base, cf: "error" }), { mode: "form", notice: "error" });
  assert.deepEqual(consoleSigninMode({ ...base, cf: "unavailable" }), { mode: "form", notice: null });
  assert.deepEqual(consoleSigninMode({ ...base, cf: "no_account" }), { mode: "refusal", kind: "no_account" });
  assert.deepEqual(consoleSigninMode({ ...base, cf: "disabled" }), { mode: "refusal", kind: "disabled" });
  assert.deepEqual(consoleSigninMode({ ...base, cf: "anything-else" }), { mode: "form", notice: null });
  // Feature off, or no assertion: the ordinary form, as before this feature.
  assert.deepEqual(consoleSigninMode({ ...base, accessOn: false, cf: null }), { mode: "form", notice: null });
  assert.deepEqual(consoleSigninMode({ ...base, hasAssertion: false, cf: null }), { mode: "form", notice: null });
});

// ------------------------------------------------------ only a navigation (F6)

test("a session is started only by a top-level navigation, never by an image, a frame or a fetch", () => {
  const h = (dest?: string) => new Headers(dest === undefined ? {} : { "sec-fetch-dest": dest });
  assert.equal(isSigninNavigation(h("document")), true, "the sign-in page's redirect");
  assert.equal(isSigninNavigation(h("Document")), true);
  for (const dest of ["image", "iframe", "frame", "embed", "object", "empty", "script", "style", "video", ""]) {
    assert.equal(isSigninNavigation(h(dest)), false, `Sec-Fetch-Dest: ${dest || "(empty)"}`);
  }
  assert.equal(isSigninNavigation(h()), true, "absent (curl, an older browser) still needs a verified assertion");
});

test("the sign-in route applies the navigation check before it verifies, records or signs in", () => {
  const route = readFileSync(
    fileURLToPath(new URL("../../app/api/auth/cloudflare/route.console.ts", import.meta.url)),
    "utf8"
  );
  const body = route.slice(route.indexOf("export async function GET"));
  const guard = body.indexOf("isSigninNavigation(req.headers)");
  assert.ok(guard > 0, "the route calls isSigninNavigation");
  for (const later of ["verifyAccessAssertion(", "recordUnverifiedAssertion(", "signInOperator("]) {
    const at = body.indexOf(later);
    assert.ok(at > guard, `${later} comes after the navigation check`);
  }
});

// ------------------------------------------------- one address rule (F7)

test("a proven address outside ASCII is refused as non_ascii_email — no proof, not a guess", async () => {
  for (const email of [
    "s\u00e4muel@example.com", // ä
    "samuel@b\u00fccher.de", // an IDN domain, unencoded
    "\u212Aelvin@example.com", // KELVIN SIGN, which JS lower-cases to a plain k
    "\u0130nci@example.com", // İ — JS and Postgres fold it differently
    "\uff53amuel@example.com", // fullwidth s
  ]) {
    const r = await verifyAccessAssertion(await mint({ email }), CONFIG, { keys });
    assert.deepEqual(r, { ok: false, reason: "non_ascii_email" }, JSON.stringify(email));
  }
});

test("canonicalOperatorEmail: trims and lower-cases ASCII, and is null for everything else", () => {
  assert.equal(canonicalOperatorEmail("  Samuel.S.Toma@Gmail.com "), "samuel.s.toma@gmail.com");
  assert.equal(canonicalOperatorEmail("a+tag@example.co.uk"), "a+tag@example.co.uk");
  for (const bad of ["\u212Aelvin@example.com", "\u0130@x.com", "no-at-sign", "a@b@c", "a b@c.d", "", null, 42]) {
    assert.equal(canonicalOperatorEmail(bad), null, JSON.stringify(bad));
  }
});

test("the per-request check and the sign-in route use ONE rule, so they cannot disagree (no redirect loop)", () => {
  const proof = { ok: true as const, email: "kelvin@example.com" };
  // JS would fold the Kelvin sign to `k`; the one rule refuses to call it the same address.
  assert.equal(sessionMatchesAccessIdentity("admin", "\u212Aelvin@example.com", proof), false);
  assert.equal(sessionMatchesAccessIdentity("admin", "KELVIN@example.com", proof), true);
});

// ------------------------------------------- a hanging key endpoint (F9)

test("a key endpoint that HANGS costs a console request about one second, and keeps the session", async () => {
  // Accepts the connection and never answers — the failure a timeout exists for.
  const hung = createServer(() => {
    /* never respond */
  });
  await new Promise<void>((r) => hung.listen(0, "127.0.0.1", () => r()));
  const { port } = hung.address() as { port: number };
  // Production's own options: a 5-second fetch timeout this check must not wait out.
  const hangingKeys = createRemoteJWKSet(new URL(`http://127.0.0.1:${port}/cdn-cgi/access/certs`), {
    ...JWKS_OPTIONS,
  });
  try {
    let timedOut = false;
    const started = Date.now();
    const proof = await proofWithin(
      verifyAccessAssertion(await mint({ email: "someone.else@example.com" }), CONFIG, { keys: hangingKeys }),
      IDENTITY_CHECK_BUDGET_MS,
      () => void (timedOut = true)
    );
    const took = Date.now() - started;
    assert.equal(proof, null, "no proof");
    assert.equal(timedOut, true, "and the caller is told it timed out");
    assert.ok(took >= IDENTITY_CHECK_BUDGET_MS - 50 && took < 2_500, `waited ${took} ms, not the fetch's 5 s`);
    // No proof keeps the session — even though the (unverified) token named somebody else.
    assert.equal(sessionMatchesAccessIdentity("admin", "samuel.s.toma@gmail.com", proof), true);
  } finally {
    hung.closeAllConnections();
    await new Promise<void>((r) => hung.close(() => r()));
  }
});

test("proofWithin passes a prompt answer through unchanged, and a throw becomes no proof", async () => {
  const ok = await proofWithin(verifyAccessAssertion(await mint(), CONFIG, { keys }), 1_000);
  assert.deepEqual(ok, { ok: true, email: "samuel.s.toma@gmail.com" });
  assert.equal(await proofWithin(Promise.resolve(null), 1_000), null);
  assert.equal(await proofWithin(Promise.reject(new Error("boom")), 1_000), null);
});

test("the per-request budget is shorter than the key fetch's own timeout, and the cache outlives ten minutes", () => {
  assert.ok(IDENTITY_CHECK_BUDGET_MS < JWKS_OPTIONS.timeoutDuration);
  assert.ok(IDENTITY_CHECK_BUDGET_MS <= 1_000);
  assert.ok(JWKS_OPTIONS.cacheMaxAge >= 60 * 60_000, "an hour: a slow endpoint reaches a request at most hourly");
  assert.ok(JWKS_OPTIONS.cacheMaxAge <= 24 * 60 * 60_000, "and a withdrawn key is not believed for days");
});
