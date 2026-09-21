/**
 * Proxy (Next 16's former middleware) — **cookie presence, and nothing else**.
 *
 * Next's own documentation is explicit that proxy should not rely on shared
 * modules, and the authorisation decision needs the database: who you are, what
 * roles you hold, whether your session is still live. None of that can be
 * answered here, and answering a weaker question here and calling it
 * authorisation is exactly the failure FR-2107 names — **not rendering a page
 * is not authorisation**. Every page and route this redirects still performs
 * its own `currentPrincipal()` / `authorize()` check, and would refuse an
 * unauthenticated caller with this file deleted.
 *
 * What this buys is one thing: a signed-out visitor who types `/student` — or,
 * on the console build, any of the console's own addresses (see
 * `lib/proxy-rules.ts`) — gets the sign-in page instead of a page that renders
 * and then bounces. On the console that also means no console data is fetched
 * for a visitor who has no business seeing it, which is the last row of
 * contracts/authorization.md's status table. A student path typed into the
 * console build (`/student`, `/dashboard`) is none of this file's business —
 * those routes still compile there (only the console's own files are excluded
 * at build time, per `next.config.ts`), and it is `(student)/layout.tsx`'s
 * `notFound()` that is meant to answer at runtime. A redirect to `/signin`
 * from here, ahead of that layout running, would pre-empt the 404 with a 307
 * instead.
 *
 * **Known edge, stated rather than discovered**: `ainext_at` lives 15 minutes
 * and `ainext_rt` is scoped to `/api/auth`, so a browser whose access cookie
 * has expired presents no cookie here and is redirected to `/signin` even
 * though its refresh token would still work. The client refreshes ahead of
 * expiry (the same scheduling Talent's frontend does), and `/signin` is the
 * right place to land when it has not. The alternative — a non-HttpOnly
 * "presence" cookie — puts a session signal somewhere a script can read, for a
 * redirect we do not need.
 */

import { NextResponse, type NextRequest } from "next/server";

import { cookieNames, shouldGuard, type Surface } from "./lib/proxy-rules.ts";

/**
 * Which surface this build is. Read straight from `process.env` rather than
 * through `lib/env.ts`: the proxy runs in its own runtime and Next's own
 * documentation says it should not rely on shared modules. The value is
 * resolved once, at module load, exactly as `lib/env.ts` resolves it.
 */
const SURFACE: Surface = process.env.AINEXT_SURFACE === "admin" ? "admin" : "student";

/**
 * F-P2b: the cookie NAME this build checks for is surface-bound too, from the
 * same tiny pure module `cookies.ts` reads it from. On `localhost`, where both
 * builds run on the same host at different ports, this is what stops a
 * browser holding the student build's cookies from reading as "signed in"
 * here on the console — `ainext_at` was never written by an operator
 * sign-in, and this build only ever looks for `ainext_cat`/`ainext_crt`.
 */
const { access: ACCESS_COOKIE, refresh: REFRESH_COOKIE } = cookieNames(SURFACE);

export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Which paths this build's proxy owes a cookie check to is decided in
  // `lib/proxy-rules.ts` (pure, unit-tested there): the console guards only
  // its own paths, and a student path on the console build is left to fall
  // through to `(student)/layout.tsx`'s `notFound()` rather than being
  // redirected to `/signin` first — a 307 before the 404 would leak that the
  // path exists, and would fetch nothing, but still pre-empts the intended
  // "console build has no student surface at all" answer.
  if (!shouldGuard(SURFACE, path)) return NextResponse.next();

  const signedIn =
    req.cookies.has(ACCESS_COOKIE) || req.cookies.has(REFRESH_COOKIE);
  if (signedIn) return NextResponse.next();

  const next = req.nextUrl.pathname + req.nextUrl.search;
  const signin = new URL("/signin", req.nextUrl);
  signin.searchParams.set("next", next);
  return NextResponse.redirect(signin);
}

/**
 * One matcher for both builds — `config` has to be statically analysable, so it
 * cannot branch on the surface. Paths that exist in only one build are inert in
 * the other: nothing resolves them, so nothing reaches this file for them.
 */
export const config = {
  matcher: [
    "/",
    "/student",
    "/student/:path*",
    "/dashboard",
    "/dashboard/:path*",
    // Console-only below (ADR-0014). Absent from the student build entirely,
    // so these entries are inert there. Each bare path is listed beside its
    // `:path*` form, as the student entries above already are: a matcher that
    // covers `/content/x` and not `/content` is the kind of gap that is only
    // found by somebody typing the shorter URL.
    "/students",
    "/students/:path*",
    "/profile",
    "/profile/:path*",
    "/content",
    "/content/:path*",
    "/cost",
    "/cost/:path*",
    "/security",
    "/security/:path*",
    "/overview",
    "/overview/:path*",
    "/pipeline",
    "/pipeline/:path*",
    "/gallery",
    "/gallery/:path*",
    "/dev",
    "/dev/:path*",
  ],
};
