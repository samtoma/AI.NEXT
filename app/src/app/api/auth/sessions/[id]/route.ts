/**
 * DELETE /api/auth/sessions/{id} — end one of my own sign-ins.
 *
 * **404 when the session belongs to someone else**, not 403 — the same
 * 404-not-403 rule the rest of this feature applies to cross-student reads,
 * here applied to a principal's own resource boundary exactly as Talent does it
 * (R1 §2). The ownership predicate is baked into the UPDATE, so "not yours" and
 * "not there" are the same query and therefore the same answer, rather than two
 * branches somebody has to remember to make indistinguishable.
 */

import { recordAuthEvent, requestMeta } from "@/lib/auth/events";
import { revokeSessionById, withAuthTx } from "@/lib/auth/session";
import { currentPrincipal } from "@/lib/auth/principal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const meta = requestMeta(req);
  const me = await currentPrincipal();
  if (me.kind === "anonymous") {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  const sessionId = Number((await ctx.params).id);
  if (!Number.isFinite(sessionId)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const revoked = await withAuthTx((db) =>
      revokeSessionById(
        db,
        me.kind === "student" ? { accountId: me.accountId } : { operatorId: me.operatorId },
        sessionId,
        recordAuthEvent,
        meta
      )
    );
    if (!revoked) return Response.json({ error: "not_found" }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("[auth] session revoke failed:", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
