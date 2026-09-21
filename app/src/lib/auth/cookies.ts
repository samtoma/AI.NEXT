/**
 * The two cookies, and their attributes as a string you can assert on.
 *
 * **Both tokens are HttpOnly** (FR-2007). Talent keeps its access token in
 * `localStorage` behind a Bearer interceptor, which means any script injection
 * on any page reads the session (R1 §1). Next route handlers read a cookie
 * server-side, so there is no reason at all to put a token where a script can
 * reach it — and no token is ever returned in a body, a URL, a redirect or a
 * page parameter either.
 *
 * The refresh cookie is scoped to `Path=/api/auth`: it is sent to the four
 * endpoints that rotate or revoke it and to nothing else, so a lesson page
 * request does not carry the credential that can mint new sessions.
 *
 * **F-P2b: the NAME is surface-bound too**, not just what it is scoped to.
 * `ACCESS_COOKIE`/`REFRESH_COOKIE` below are the student build's names, kept
 * as the default because student is the safe default everywhere else in this
 * feature (env.ts's own `resolveSurface` gives the same reasoning). Anything
 * that writes or reads a cookie for a principal that could be an OPERATOR —
 * `login`, `refresh`, `logout`, `logout-all`, `reset-password` — must pass an
 * explicit `surface` rather than rely on the default; `cookieNames(surface)`
 * (re-exported from `./cookie-names.ts`) is how each of those gets the right
 * pair. See that module's header for why the console build needs a name of
 * its own rather than just a narrower scope.
 *
 * This module imports only that tiny pure lookup — not `next/server`, not the
 * app, not `@/lib/env` (whose JSON import and path-aliased specifier plain
 * `node --test` cannot resolve at all). It builds attribute objects and
 * serialises them, which is what makes "the cookie is HttpOnly and
 * SameSite=Lax and scoped to /api/auth" a unit test rather than a thing
 * somebody reads off a screenshot of devtools.
 */

import { cookieNames, type CookieNames, type Surface } from "./cookie-names.ts";

export { cookieNames };
export type { CookieNames, Surface };

export const ACCESS_COOKIE = cookieNames("student").access;
export const REFRESH_COOKIE = cookieNames("student").refresh;
/** Carries the signed OAuth state + PKCE verifier between /google/login and the callback. */
export const OAUTH_STATE_COOKIE = "ainext_oauth";

export const ACCESS_COOKIE_PATH = "/";
export const REFRESH_COOKIE_PATH = "/api/auth";

export type CookieAttrs = {
  name: string;
  value: string;
  path: string;
  httpOnly: true;
  sameSite: "Lax";
  secure: boolean;
  maxAge?: number;
  expires?: Date;
};

/**
 * `Secure` outside development. Not "outside the comparison build" and not
 * "when the request looks like https" — `NODE_ENV`, because a cookie attribute
 * decided by anything a client can influence is a cookie attribute an attacker
 * can turn off.
 */
export function secureCookies(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv === "production";
}

/**
 * `surface` picks the NAME (`cookieNames(surface).access`); everything else is
 * identical either way. Defaults to `"student"` — the one call site that must
 * never guess (`login`, which can issue either kind) passes it explicitly.
 */
export function accessCookie(
  token: string,
  secure = secureCookies(),
  surface: Surface = "student"
): CookieAttrs {
  return {
    name: cookieNames(surface).access,
    value: token,
    path: ACCESS_COOKIE_PATH,
    httpOnly: true,
    sameSite: "Lax",
    secure,
    maxAge: 15 * 60,
  };
}

export function refreshCookie(
  token: string,
  expiresAt: Date,
  secure = secureCookies(),
  surface: Surface = "student"
): CookieAttrs {
  return {
    name: cookieNames(surface).refresh,
    value: token,
    path: REFRESH_COOKIE_PATH,
    httpOnly: true,
    sameSite: "Lax",
    secure,
    expires: expiresAt,
  };
}

export function oauthStateCookie(value: string, secure = secureCookies()): CookieAttrs {
  return {
    name: OAUTH_STATE_COOKIE,
    value,
    path: REFRESH_COOKIE_PATH,
    httpOnly: true,
    sameSite: "Lax",
    secure,
    maxAge: 10 * 60,
  };
}

/**
 * Clearing must repeat the ORIGINAL path, or the browser deletes a different
 * cookie of the same name and leaves the real one in place — the failure that
 * looks exactly like a working logout until the next request.
 */
export function cleared(name: string, path: string, secure = secureCookies()): CookieAttrs {
  return { name, value: "", path, httpOnly: true, sameSite: "Lax", secure, maxAge: 0 };
}

export function clearedAuthCookies(
  secure = secureCookies(),
  surface: Surface = "student"
): CookieAttrs[] {
  const names = cookieNames(surface);
  return [
    cleared(names.access, ACCESS_COOKIE_PATH, secure),
    cleared(names.refresh, REFRESH_COOKIE_PATH, secure),
  ];
}

/** One `Set-Cookie` header value. */
export function serializeCookie(c: CookieAttrs): string {
  const parts = [`${c.name}=${c.value}`, `Path=${c.path}`, "HttpOnly", `SameSite=${c.sameSite}`];
  if (c.secure) parts.push("Secure");
  if (c.maxAge !== undefined) parts.push(`Max-Age=${c.maxAge}`);
  if (c.expires !== undefined) parts.push(`Expires=${c.expires.toUTCString()}`);
  return parts.join("; ");
}

/**
 * Attach cookies to a Response. Append, never set: two cookies, two headers.
 *
 * **Not `Response.redirect()`** — the Fetch spec gives that one an immutable
 * header guard, so appending to it throws a TypeError at runtime and nowhere in
 * the type system. Build redirects as
 * `new Response(null, { status: 302, headers: { Location } })`, which this can
 * write to; every redirect in `api/auth/**` does.
 */
export function applyCookies<T extends Response>(res: T, cookies: CookieAttrs[]): T {
  for (const c of cookies) res.headers.append("Set-Cookie", serializeCookie(c));
  return res;
}

/** Read one cookie out of a raw `Cookie` header, for code that has no `next/headers`. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}
