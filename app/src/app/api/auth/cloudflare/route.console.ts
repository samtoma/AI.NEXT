/**
 * GET /api/auth/cloudflare — sign an operator in from their Cloudflare Access
 * identity (ADR-0022, FR-3301…FR-3306).
 *
 * **Console build only.** The file is `route.console.ts`, so the student build
 * does not compile it and the address does not resolve there
 * (`npm run check:surface` asserts both directions). On the student surface the
 * Access header is not read anywhere, by construction.
 *
 * **Why a route of its own, and why `/signin` sends people here.** A session
 * is two HttpOnly cookies, and a Server Component cannot set a cookie — so the
 * sign-in page cannot do this itself. `proxy.ts` could, but it runs in its own
 * runtime and must not reach the database (its own header says why), and
 * starting a session needs three tables. So the page decides ("this request
 * carries an assertion") and forwards; this handler verifies, looks the person
 * up, starts or rotates the session, and answers with a redirect. It sits under
 * `/api/auth` deliberately: that is the path the console refresh cookie is
 * scoped to, so this handler can see which session the browser already holds.
 *
 * Every answer is a redirect, and every failure lands on `/signin` with `?cf=`
 * set — which is what stops the page forwarding again, so there is no loop:
 *
 *  - assertion verified, active operator → session, cookies, → `next`
 *  - verified, no operator / disabled operator → no session (and any other
 *    operator's session on this browser ended), cookies cleared,
 *    → `/signin?cf=no_account|disabled` — the refusal page, audited
 *  - missing, unverifiable, expired, wrong audience… → nothing signed in,
 *    audited within a per-address and a total budget (so it cannot be used to
 *    flood the record), → `/signin?cf=invalid` — the password form (FR-3308)
 *  - feature off → `/signin?cf=unavailable` — the password form
 *
 * One answer is not a redirect: a request that is not a top-level navigation
 * (`Sec-Fetch-Dest` present and not `document` — an `<img>`, an `<iframe>`, a
 * prefetch another site planted) gets a bare `403` before anything is read,
 * verified or recorded. A session is started by a person arriving, never by a
 * resource loading (`isSigninNavigation`, security review F6).
 *
 * Nothing about the token is logged or stored — not the token, not its
 * signature, not its claims beyond the address it proved.
 */

import { cookies } from "next/headers";

import { safeNext } from "@/components/auth/next-param";
import {
  cfAccessConfig,
  isSigninNavigation,
  readAccessAssertion,
  verifyAccessAssertion,
} from "@/lib/auth/cf-access";
import { accessCookie, applyCookies, clearedAuthCookies, cookieNames, refreshCookie } from "@/lib/auth/cookies";
import { recordAuthEvent, requestMeta } from "@/lib/auth/events";
import { recordUnverifiedAssertion, signInOperator } from "@/lib/auth/operator-signin";
import { withAuthTx } from "@/lib/auth/session";
import { signAccessToken, verifyAccessToken } from "@/lib/auth/tokens";
import { ENVIRONMENT, SURFACE } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NAMES = cookieNames("admin");

/** A relative Location: behind the tunnel `req.url` is the container's own address. */
function to(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: location, "Cache-Control": "no-store" },
  });
}

function backToSignin(next: string, cf: string): Response {
  const q = new URLSearchParams({ next, cf });
  return to(`/signin?${q.toString()}`);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"), "/");

  // The file only exists in the console build; this is the runtime half.
  if (SURFACE !== "admin") return new Response(null, { status: 404 });

  // Not a navigation — an image, a frame, a prefetch: no session, no record.
  if (!isSigninNavigation(req.headers)) {
    return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  const state = cfAccessConfig();
  if (state.state !== "on") return backToSignin(next, "unavailable");

  const meta = requestMeta(req);
  const assertion = readAccessAssertion(SURFACE, req.headers);
  if (!assertion) return backToSignin(next, "unavailable");

  const proof = await verifyAccessAssertion(assertion, state.config);
  if (!proof.ok) {
    // Recorded within a budget (per address and in total), so that callers
    // reaching the origin without Cloudflare cannot flood `auth_events`. The
    // answer is the same either way; only the record is limited.
    try {
      await withAuthTx((db) => recordUnverifiedAssertion(db, proof.reason, recordAuthEvent, meta));
    } catch (err) {
      console.error("[auth] could not record an unverified Cloudflare assertion:", err);
    }
    return backToSignin(next, "invalid");
  }

  const jar = await cookies();
  const refreshToken = jar.get(NAMES.refresh)?.value ?? null;
  const accessRaw = jar.get(NAMES.access)?.value;
  const claims = accessRaw ? await verifyAccessToken(accessRaw, ENVIRONMENT) : null;

  try {
    const outcome = await withAuthTx((db) =>
      signInOperator(
        db,
        { email: proof.email },
        "cloudflare-access",
        {
          refreshToken,
          accessSessionId: claims && claims.knd === "operator" ? claims.sid : null,
        },
        recordAuthEvent,
        { ...meta, environment: ENVIRONMENT }
      )
    );

    switch (outcome.kind) {
      case "no_account":
      case "disabled":
        // Whatever this browser held, it is not the proven person's: clear it.
        return applyCookies(backToSignin(next, outcome.kind), clearedAuthCookies(undefined, "admin"));
      case "unchanged":
        return to(next);
      case "ok": {
        const token = await signAccessToken({
          sub: outcome.operatorId,
          knd: "operator",
          sid: outcome.sessionId,
          env: ENVIRONMENT,
        });
        return applyCookies(to(next), [
          accessCookie(token, undefined, "admin"),
          refreshCookie(outcome.token, outcome.expiresAt, undefined, "admin"),
        ]);
      }
    }
  } catch (err) {
    console.error("[auth] cloudflare sign-in failed:", err);
    // Cookies cleared on the way out, as `/api/auth/refresh` clears them on a
    // 500. Left in place, the sign-in form's silent refresh could revive a
    // session this route was about to end (a different operator's), the shell
    // would refuse it again for not matching the proven person, and the
    // browser would bounce between the two with nobody touching it.
    return applyCookies(backToSignin(next, "error"), clearedAuthCookies(undefined, "admin"));
  }
}
