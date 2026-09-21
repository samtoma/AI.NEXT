/**
 * POST /api/auth/logout — end this sign-in now (FR-2012).
 *
 * Deliberately requires **no valid access token**. Revoking is always the safe
 * direction, so a stolen or expired cookie being used to revoke itself is a
 * feature: the alternative is a student with a broken session who cannot sign
 * out of it. Talent gets this right and it is worth porting verbatim (R1 §2).
 *
 * Always 204, whether or not the cookie matched anything. "Are you signed out"
 * has one answer after this call.
 *
 * **F-P2b**: reads and clears THIS surface's cookie (`cookieNames(SURFACE)`),
 * and `revokeByToken` is given `SURFACE` too, so a token that happens to
 * belong to the other surface's principal is revoked nowhere — it is a live
 * session there and this endpoint has no business ending it.
 */

import { cookies } from "next/headers";

import { applyCookies, clearedAuthCookies, cookieNames } from "@/lib/auth/cookies";
import { recordAuthEvent, requestMeta } from "@/lib/auth/events";
import { revokeByToken, withAuthTx } from "@/lib/auth/session";
import { SURFACE } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const { refresh: REFRESH_COOKIE } = cookieNames(SURFACE);

export async function POST(req: Request) {
  const meta = requestMeta(req);
  const jar = await cookies();
  const presented = jar.get(REFRESH_COOKIE)?.value;

  if (presented) {
    try {
      await withAuthTx((db) => revokeByToken(db, presented, recordAuthEvent, meta, new Date(), SURFACE));
    } catch (err) {
      // The cookies still get cleared below: a failed revoke must not leave the
      // student holding a session they asked to end.
      console.error("[auth] logout revoke failed:", err);
    }
  }

  return applyCookies(new Response(null, { status: 204 }), clearedAuthCookies(undefined, SURFACE));
}
