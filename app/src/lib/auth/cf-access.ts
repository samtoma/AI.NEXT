/**
 * Cloudflare Access identity — the proof, and the rules for when it counts
 * (ADR-0022, FR-3301…FR-3312).
 *
 * The console (admin-noor.reletix.com) sits behind a Cloudflare Access
 * application: nobody reaches the origin without first proving an email
 * address to Cloudflare with a one-time PIN. On every request that passes,
 * Cloudflare adds a signed token — a JWT, RS256, signed by the team's own
 * keys — in the `Cf-Access-Jwt-Assertion` header. That token is what this
 * module reads, and it is the ONLY thing it reads.
 *
 * **Cloudflare also sends `Cf-Access-Authenticated-User-Email`, and this module
 * never looks at it.** It is a plain header: anything that reaches the origin
 * by another route — a misrouted tunnel, a port someone opened, a local
 * `curl` — can set it to any address it likes. The JWT cannot be forged
 * without Cloudflare's private key, so the email is taken from the VERIFIED
 * payload and from nowhere else. A test (`cf-access.test.mts`) scans the
 * source tree to keep it that way.
 *
 * What "verified" means here, every clause of it checked by `jose`:
 *
 *  - the signature, against the team's published keys
 *    (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, fetched once
 *    and cached — `createRemoteJWKSet` refetches only when a key id it has not
 *    seen turns up, which is how Cloudflare's key rotation lands);
 *  - the algorithm, which must be RS256 — `none`, and HS256 signed with the
 *    public key (the classic confusion attack), are refused by allow-list;
 *  - the issuer, which must be the team domain itself;
 *  - the audience, which must be THIS Access application's AUD tag, so a
 *    token Cloudflare minted for some other application of the same team
 *    cannot be replayed here;
 *  - `exp` (required) and `nbf` (when present), with a small clock tolerance.
 *
 * **It fails closed.** No configuration, half a configuration, a header that
 * is missing, a token that does not verify, keys that cannot be fetched, a
 * payload with no usable email — every one of them is "no proof", and no
 * proof signs nobody in. Half a configuration deserves a sentence of its own:
 * a team domain with no audience would verify tokens for ANY application in
 * the team, so it is treated as the feature being off (and logged), never as
 * "verify without the audience check".
 *
 * **Nothing here runs on the student surface.** `readAccessAssertion` answers
 * null for any surface but `admin` without reading a header at all; the one
 * route that signs somebody in from this proof is a `route.console.ts` file
 * that the student build does not compile (`npm run check:surface` asserts
 * it); and `principal.ts` consults the proof only when `IS_CONSOLE`.
 *
 * This module imports `jose` and nothing from the app — no `@/lib/env`, no
 * database, no `next/*` — for the reason `tokens.ts` gives: it is what lets
 * `node --test` run real RS256 signatures against a locally generated key and
 * a JWKS served from a local stub, rather than a mock of `jose`.
 */

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/** The one header this module reads. Lower-case: `Headers.get` is case-insensitive anyway. */
export const ACCESS_ASSERTION_HEADER = "cf-access-jwt-assertion";

/** Seconds of clock skew tolerated on `exp` / `nbf` / `iat`. Small on purpose. */
export const CLOCK_TOLERANCE_SECONDS = 30;

/**
 * Where a browser is sent to end its Access session: the APPLICATION's own
 * logout, a path on the console's hostname that Cloudflare answers at the edge
 * (it never reaches the origin). Relative on purpose.
 *
 * Not the team-wide `https://<team>.cloudflareaccess.com/cdn-cgi/access/logout`.
 * Both revoke the person's Access tokens, but Cloudflare's revocation takes
 * 20–30 seconds to reach every edge, and each URL deletes the authorisation
 * cookie only on its OWN domain. The team URL leaves the console's
 * `CF_Authorization` cookie in the browser, so for those seconds the next
 * console request still carries a valid assertion and is signed straight back
 * in — a sign-out that silently undoes itself (security review F3). The app
 * URL deletes that cookie at once.
 */
export const ACCESS_APP_LOGOUT_PATH = "/cdn-cgi/access/logout";

/** A Cloudflare Access token is well under 2 KB. Anything this long is not one. */
const MAX_ASSERTION_LENGTH = 8192;

export type CfAccessConfig = {
  /** `https://<team>.cloudflareaccess.com` — no path, no trailing slash. */
  teamDomain: string;
  /** The issuer a token must carry: the team domain itself. */
  issuer: string;
  /** This Access application's AUD tag. */
  audience: string;
  /** Where the team's signing keys are published. */
  certsUrl: string;
  /** Where a browser is sent to end its Access session — `ACCESS_APP_LOGOUT_PATH`. */
  logoutUrl: string;
};

export type CfAccessConfigState =
  | { state: "off" }
  | { state: "on"; config: CfAccessConfig }
  | { state: "misconfigured"; problem: string };

/**
 * `AINEXT_CF_ACCESS_TEAM_DOMAIN` + `AINEXT_CF_ACCESS_AUD`, resolved.
 *
 * - team domain unset or empty → **off**. That is the default, and the state
 *   of the student surface, of local development, and of any stack nobody
 *   configured. Password sign-in is untouched.
 * - both set and well-formed → **on**.
 * - anything else → **misconfigured**, which callers treat exactly as off.
 *
 * The team domain may be written `reletix`, `reletix.cloudflareaccess.com` or
 * `https://reletix.cloudflareaccess.com`; it must end up an https origin on
 * `cloudflareaccess.com`, because the keys are fetched from it and a typo that
 * pointed the key fetch somewhere else would be a typo that chose who we trust.
 */
export function resolveCfAccessConfig(
  env: Readonly<Record<string, string | undefined>> = process.env
): CfAccessConfigState {
  const rawTeam = (env.AINEXT_CF_ACCESS_TEAM_DOMAIN ?? "").trim();
  if (!rawTeam) return { state: "off" };

  const teamDomain = normaliseTeamDomain(rawTeam);
  if (!teamDomain) {
    return {
      state: "misconfigured",
      problem:
        `AINEXT_CF_ACCESS_TEAM_DOMAIN="${rawTeam}" is not a Cloudflare Access team domain ` +
        `(expected https://<team>.cloudflareaccess.com).`,
    };
  }

  const audience = (env.AINEXT_CF_ACCESS_AUD ?? "").trim();
  if (!audience) {
    return {
      state: "misconfigured",
      problem:
        "AINEXT_CF_ACCESS_TEAM_DOMAIN is set but AINEXT_CF_ACCESS_AUD is not. Without the " +
        "application's AUD tag a token for ANY Access application of the team would verify, " +
        "so Cloudflare sign-in stays off until both are set.",
    };
  }
  if (!/^[A-Za-z0-9._:-]{8,256}$/.test(audience)) {
    return {
      state: "misconfigured",
      problem: "AINEXT_CF_ACCESS_AUD does not look like an Access application AUD tag.",
    };
  }

  return {
    state: "on",
    config: {
      teamDomain,
      issuer: teamDomain,
      audience,
      certsUrl: `${teamDomain}/cdn-cgi/access/certs`,
      logoutUrl: ACCESS_APP_LOGOUT_PATH,
    },
  };
}

function normaliseTeamDomain(raw: string): string | null {
  let s = raw;
  if (!s.includes(".") && /^[a-z0-9-]+$/i.test(s)) s = `${s}.cloudflareaccess.com`;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password || u.port || u.search || u.hash) return null;
  if (u.pathname !== "/" && u.pathname !== "") return null;
  const host = u.hostname.toLowerCase();
  if (!host.endsWith(".cloudflareaccess.com") || host === ".cloudflareaccess.com") return null;
  return `https://${host}`;
}

let memo: { key: string; state: CfAccessConfigState } | null = null;
let warned = "";

/**
 * The process's own configuration, resolved once per distinct value and logged
 * once when it is wrong. Reads `process.env` at call time rather than at module
 * load so a test can set the variables before calling.
 */
export function cfAccessConfig(): CfAccessConfigState {
  const key = `${process.env.AINEXT_CF_ACCESS_TEAM_DOMAIN ?? ""}\u0000${process.env.AINEXT_CF_ACCESS_AUD ?? ""}`;
  if (memo && memo.key === key) return memo.state;
  const state = resolveCfAccessConfig(process.env);
  memo = { key, state };
  if (state.state === "misconfigured" && warned !== key) {
    warned = key;
    console.error(`[cf-access] Cloudflare sign-in is OFF: ${state.problem}`);
  }
  return state;
}

/**
 * The assertion this request carries, or null.
 *
 * **The surface is the first argument, and anything but `admin` gets null
 * without a header being read.** On the student build this whole feature does
 * not exist, and "does not exist" includes "does not look".
 *
 * It reads exactly one header. `Cf-Access-Authenticated-User-Email` is not
 * consulted here or anywhere else — see this module's header for why.
 */
export function readAccessAssertion(
  surface: "student" | "admin",
  headers: { get(name: string): string | null }
): string | null {
  if (surface !== "admin") return null;
  const raw = headers.get(ACCESS_ASSERTION_HEADER);
  if (!raw) return null;
  const token = raw.trim();
  return token ? token : null;
}

/**
 * May this request START a session from the proof? Only when it is a
 * top-level navigation (security review F6).
 *
 * `GET /api/auth/cloudflare` creates a session, and a GET is something any
 * other site can make a browser send — `<img src>`, `<iframe src>`, a
 * `<link rel=prefetch>`. Cloudflare admits such a request whenever the browser
 * holds its Access cookie, so without this check a page elsewhere could start
 * (or swap, by FR-3305) a console session on an operator's browser without
 * the operator doing anything. The sign-in page reaches the route by a
 * redirect of a navigation, which browsers label `Sec-Fetch-Dest: document`;
 * an image says `image`, a frame `iframe`, a fetch `empty`.
 *
 * **Absent is allowed.** Every browser the console supports sends the header
 * (Safari since 16.4); a client that sends none — curl on the box, an old
 * browser — still had to pass Access and still needs a verified assertion, so
 * refusing it would only break the fallback checks in `deploy/TAKEOVER.md`.
 * Present and anything but `document` is refused.
 */
export function isSigninNavigation(headers: { get(name: string): string | null }): boolean {
  const dest = headers.get("sec-fetch-dest");
  if (dest === null) return true;
  return dest.trim().toLowerCase() === "document";
}

export type CfRefusal =
  | "no_assertion"
  | "too_long"
  | "malformed"
  | "bad_algorithm"
  | "bad_signature"
  | "unknown_key"
  | "keys_unavailable"
  | "expired"
  | "not_yet_valid"
  | "bad_issuer"
  | "bad_audience"
  | "bad_claims"
  | "no_email"
  | "non_ascii_email"
  | "invalid";

export type CfVerifyResult = { ok: true; email: string } | { ok: false; reason: CfRefusal };

/**
 * One key resolver per certs URL, for the life of the process — that is the
 * cache. `createRemoteJWKSet` holds the fetched keys, refetches at most every
 * 30 seconds and only when a token names a key it does not have, and gives up
 * a fetch after 5 seconds (which this module reports as `keys_unavailable`,
 * i.e. no proof, i.e. no sign-in).
 */
const remoteKeySets = new Map<string, JWTVerifyGetKey>();

function remoteKeys(certsUrl: string): JWTVerifyGetKey {
  let keys = remoteKeySets.get(certsUrl);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(certsUrl), {
      timeoutDuration: 5_000,
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
    });
    remoteKeySets.set(certsUrl, keys);
  }
  return keys;
}

/**
 * THE one definition of "the same operator address" (security review F7).
 *
 * Two places decide whether an address is an operator's: the sign-in route
 * (which looks the operator up in SQL) and `principal.ts` on every console
 * request (which compares the session's operator with the proven address in
 * JS). They used to lower-case with two different rules — Postgres `lower()`
 * and JS `toLowerCase()` — and outside ASCII those disagree (`İ`, the Kelvin
 * sign `K`, collation-dependent folds). An address one of them matched and
 * the other did not would be signed in by the route, unseated by the next
 * request, forwarded back to the route, signed in again: a redirect loop.
 *
 * So both sides go through THIS function, and it accepts printable ASCII only,
 * where every lower-casing rule agrees. Anything else is `null` — never equal
 * to anything. SQL may still find a candidate row (`lower(email) = lower($1)`
 * is how the unique index is searched), but the row counts only if this
 * function says it is the same address.
 */
export function canonicalOperatorEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > 320) return null;
  // Printable ASCII, no spaces: `!` (0x21) to `~` (0x7e).
  if (!/^[\x21-\x7e]+$/.test(s)) return null;
  if (!/^[^@]+@[^@]+$/.test(s)) return null;
  return s.toLowerCase();
}

/**
 * Verify an Access assertion and return the address it proves — or why not.
 *
 * `keys` is the seam the tests use: a key resolver over a locally generated
 * RSA key, served from a local stub. Production passes nothing and gets the
 * team's published keys.
 *
 * The email is returned in `canonicalOperatorEmail` form — trimmed, ASCII,
 * lower-cased — which is the form every comparison uses. A proven address
 * outside ASCII (an internationalised mailbox or domain) is refused as
 * `non_ascii_email`: "no proof", so the password fallback still works for that
 * person, and no two parts of the console can disagree about who it is.
 */
export async function verifyAccessAssertion(
  token: string | null | undefined,
  config: CfAccessConfig,
  opts: { keys?: JWTVerifyGetKey; now?: Date } = {}
): Promise<CfVerifyResult> {
  if (!token) return { ok: false, reason: "no_assertion" };
  if (token.length > MAX_ASSERTION_LENGTH) return { ok: false, reason: "too_long" };

  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(token, opts.keys ?? remoteKeys(config.certsUrl), {
      algorithms: ["RS256"],
      issuer: config.issuer,
      audience: config.audience,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      requiredClaims: ["exp"],
      ...(opts.now ? { currentDate: opts.now } : {}),
    });
    payload = verified.payload as Record<string, unknown>;
  } catch (err) {
    return { ok: false, reason: refusalFor(err) };
  }

  const raw = typeof payload.email === "string" ? payload.email.trim() : "";
  // A service token (machine-to-machine Access credential) carries no email —
  // it proves a machine, not a person, and the console signs in people.
  if (!raw) return { ok: false, reason: "no_email" };
  // Checked before the shape, so the record says WHY a real address was refused.
  if (/[^\x00-\x7f]/.test(raw)) return { ok: false, reason: "non_ascii_email" };
  const email = canonicalOperatorEmail(raw);
  if (!email) return { ok: false, reason: "no_email" };
  return { ok: true, email };
}

/** `jose` error → a short code for `auth_events.reason`. Matched on `code`, not class identity. */
function refusalFor(err: unknown): CfRefusal {
  const code = (err as { code?: string } | null)?.code ?? "";
  const claim = (err as { claim?: string } | null)?.claim ?? "";
  switch (code) {
    case "ERR_JWT_EXPIRED":
      return "expired";
    case "ERR_JWT_CLAIM_VALIDATION_FAILED":
      if (claim === "aud") return "bad_audience";
      if (claim === "iss") return "bad_issuer";
      if (claim === "nbf") return "not_yet_valid";
      return "bad_claims";
    case "ERR_JOSE_ALG_NOT_ALLOWED":
    case "ERR_JOSE_NOT_SUPPORTED":
      return "bad_algorithm";
    case "ERR_JWS_SIGNATURE_VERIFICATION_FAILED":
      return "bad_signature";
    case "ERR_JWKS_NO_MATCHING_KEY":
    case "ERR_JWKS_MULTIPLE_MATCHING_KEYS":
      return "unknown_key";
    case "ERR_JWKS_TIMEOUT":
    case "ERR_JWKS_INVALID":
      return "keys_unavailable";
    case "ERR_JWS_INVALID":
    case "ERR_JWT_INVALID":
      return "malformed";
    default:
      // A fetch that failed outright (DNS, TLS, connection refused) is a plain
      // TypeError from `fetch`, not a JOSE error. It is still "no proof".
      return err instanceof TypeError ? "keys_unavailable" : "invalid";
  }
}

/**
 * Does an existing console session still belong to the person Cloudflare says
 * is at the keyboard?
 *
 * - Not the console → yes (the question does not arise; nothing is read).
 * - No proof, or proof that does not verify → yes. **A broken proof changes
 *   nothing about a session that already exists.** It only ever withholds a
 *   NEW sign-in. That is deliberate: if the Access keys cannot be fetched, or
 *   the AUD is misconfigured, the password fallback (FR-3308) must still be
 *   usable, and it would not be if an unverifiable header ended every session.
 * - A verified proof of the SAME address (by `canonicalOperatorEmail`, the
 *   rule the sign-in route also uses) → yes.
 * - A verified proof of a DIFFERENT address → **no**. The proven person wins
 *   (FR-3305): the session is treated as signed out, and the sign-in route
 *   ends it and signs the proven person in.
 */
export function sessionMatchesAccessIdentity(
  surface: "student" | "admin",
  operatorEmail: string,
  proof: CfVerifyResult | null
): boolean {
  if (surface !== "admin") return true;
  if (!proof || !proof.ok) return true;
  return canonicalOperatorEmail(operatorEmail) === proof.email;
}

/** What `/signin` does on the console, decided without a request in sight. */
export type ConsoleSigninMode =
  | { mode: "forward" }
  | { mode: "refusal"; kind: "no_account" | "disabled" }
  | { mode: "form"; notice: "invalid" | "error" | null };

/**
 * The console sign-in page's one decision.
 *
 * `cf` is the marker the sign-in route puts on its way back to `/signin`
 * (`?cf=invalid` and so on). **Its presence is what stops a loop**: the page
 * forwards a request carrying an assertion to the route exactly once, and the
 * route's answer — whatever it is — comes back with `cf` set, so the page shows
 * that answer instead of forwarding again.
 *
 * The student surface always gets the plain form: the header is not its
 * business (FR-3310).
 */
export function consoleSigninMode(input: {
  surface: "student" | "admin";
  accessOn: boolean;
  hasAssertion: boolean;
  cf: string | null | undefined;
}): ConsoleSigninMode {
  if (input.surface !== "admin") return { mode: "form", notice: null };
  const cf = input.cf ?? null;
  if (cf === "no_account" || cf === "disabled") return { mode: "refusal", kind: cf };
  if (cf === "invalid") return { mode: "form", notice: "invalid" };
  if (cf === "error") return { mode: "form", notice: "error" };
  if (cf !== null) return { mode: "form", notice: null };
  if (input.accessOn && input.hasAssertion) return { mode: "forward" };
  return { mode: "form", notice: null };
}
