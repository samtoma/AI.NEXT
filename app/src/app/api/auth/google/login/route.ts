/**
 * GET /api/auth/google/login — start the handshake.
 *
 * PKCE verifier and `state` travel in one signed, HttpOnly, 10-minute cookie
 * scoped to `/api/auth`. Signed because an unsigned state cookie is an open
 * invitation to CSRF the callback; HttpOnly because there is no reason for a
 * script to read it either.
 *
 * With `AINEXT_GOOGLE_CLIENT_ID` unset the answer is `503 not_configured` —
 * Google is optional, the product signs people in with a password, and a
 * missing optional credential is not a reason to refuse to boot.
 */

import { applyCookies, oauthStateCookie } from "@/lib/auth/cookies";
import { beginGoogleLogin, STATE_TTL_SECONDS } from "@/lib/auth/google";
import { signStateToken } from "@/lib/auth/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const handshake = beginGoogleLogin();
  if (!handshake) return Response.json({ error: "not_configured" }, { status: 503 });

  const envelope = await signStateToken(
    { state: handshake.state, verifier: handshake.codeVerifier },
    STATE_TTL_SECONDS
  );

  // 302 to Google, with nothing in our own redirect but the provider's URL.
  return applyCookies(
    new Response(null, { status: 302, headers: { Location: handshake.url } }),
    [oauthStateCookie(envelope)]
  );
}
