/**
 * GET /api/auth/sessions — every place this account is signed in (FR-2009).
 *
 * This is what remains of 001's FR-604 account-sharing deterrence: not a
 * guarantee that nobody shares an account, but the student's own visibility and
 * control over where theirs is open.
 *
 * **No token material** — not the hash, not a prefix, not a length. Device,
 * address, when it was last used, and whether it is this one.
 */

import { listSessions, withAuthTx } from "@/lib/auth/session";
import { currentClaims, currentPrincipal } from "@/lib/auth/principal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const me = await currentPrincipal();
  if (me.kind === "anonymous") {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const claims = await currentClaims();

  try {
    const sessions = await withAuthTx((db) =>
      listSessions(
        db,
        me.kind === "student" ? { accountId: me.accountId } : { operatorId: me.operatorId },
        claims?.sid ?? null
      )
    );
    return Response.json({ sessions });
  } catch (err) {
    console.error("[auth] session list failed:", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
