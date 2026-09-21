/**
 * POST /api/auth/reset-password — spend a reset link, set a new password.
 *
 * **The enumeration defence does not apply here**, deliberately: by this point
 * the token is the secret, not the email, and a vague error only strands the
 * person holding a link that expired ten minutes ago. `400` covers unknown,
 * consumed and expired alike, because those three are the same fact to the
 * person reading the screen — this link no longer works, ask for another.
 *
 * **Every session for the principal is revoked in the same transaction.** A
 * password is reset because it may be known to someone else; leaving their
 * existing sign-ins alive makes the reset cosmetic. Both cookies are cleared on
 * the way out for the same reason — including this browser's.
 *
 * **On the console build this consumes an OPERATOR reset row** and writes
 * `operators.password_hash` — the flow ADR-0014 relies on to give the seeded
 * operator a password without one ever sitting in configuration. The arm is
 * part of the SQL predicate, so a student token presented here matches no row
 * at all and cannot even be consumed, let alone honoured.
 */

import { applyCookies, clearedAuthCookies } from "@/lib/auth/cookies";
import { recordAuthEvent, requestMeta } from "@/lib/auth/events";
import { checkPolicy } from "@/lib/auth/password";
import { completeReset } from "@/lib/auth/reset";
import { withAuthTx } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const meta = requestMeta(req);

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* fall through to validation */
  }
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) return Response.json({ error: "invalid_token" }, { status: 400 });

  // The email is not known at this point, so the "not your own local part" half
  // of the policy is checked against an empty address — the length rule still
  // applies, and it is the one that matters here.
  const policy = checkPolicy(body.password, "");
  if (!policy.ok) return Response.json({ error: policy.error, field: policy.field }, { status: 422 });

  try {
    const kind = process.env.AINEXT_SURFACE === "admin" ? "operator" : "account";
    const result = await withAuthTx((db) =>
      completeReset(db, token, body.password as string, kind, recordAuthEvent, meta)
    );
    if (!result.ok) return Response.json({ error: "invalid_token" }, { status: 400 });
    return applyCookies(Response.json({ ok: true }), clearedAuthCookies());
  } catch (err) {
    console.error("[auth] reset-password failed:", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
