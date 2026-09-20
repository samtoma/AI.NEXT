/**
 * POST /api/auth/logout-all — end every sign-in for this principal.
 *
 * Unlike `logout`, this one **requires a valid access token**: ending every
 * device is a decision only the account holder gets to make, and a stale cookie
 * is not evidence of who is holding it. One `session_revoked` per row revoked,
 * because the security view counts sessions, not requests.
 */

import { applyCookies, clearedAuthCookies } from "@/lib/auth/cookies";
import { recordAuthEvent, requestMeta } from "@/lib/auth/events";
import { revokeAllForPrincipal, withAuthTx } from "@/lib/auth/session";
import { currentPrincipal } from "@/lib/auth/principal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const meta = requestMeta(req);
  const me = await currentPrincipal();
  if (me.kind === "anonymous") {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  try {
    await withAuthTx((db) =>
      revokeAllForPrincipal(
        db,
        me.kind === "student" ? { accountId: me.accountId } : { operatorId: me.operatorId },
        recordAuthEvent,
        "logout_all",
        meta
      )
    );
  } catch (err) {
    console.error("[auth] logout-all failed:", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }

  return applyCookies(new Response(null, { status: 204 }), clearedAuthCookies());
}
