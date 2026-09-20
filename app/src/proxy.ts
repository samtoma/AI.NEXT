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
 * What this buys is one thing: a signed-out visitor who types `/student` gets
 * the sign-in page instead of a page that renders and then bounces.
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

const ACCESS_COOKIE = "ainext_at";
const REFRESH_COOKIE = "ainext_rt";

export function proxy(req: NextRequest) {
  const signedIn =
    req.cookies.has(ACCESS_COOKIE) || req.cookies.has(REFRESH_COOKIE);
  if (signedIn) return NextResponse.next();

  const next = req.nextUrl.pathname + req.nextUrl.search;
  const signin = new URL("/signin", req.nextUrl);
  signin.searchParams.set("next", next);
  return NextResponse.redirect(signin);
}

export const config = {
  matcher: ["/student", "/student/:path*", "/dashboard", "/dashboard/:path*"],
};
