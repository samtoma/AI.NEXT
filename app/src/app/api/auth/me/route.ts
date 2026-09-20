/**
 * GET /api/auth/me — who am I, and nothing else.
 *
 * No session metadata and no token material: the session list is
 * `/api/auth/sessions`' job and token material is nobody's. `emailVerified` is
 * here because it is what the student shell renders the "what is outstanding"
 * banner from (FR-2004) — a product fact, not a credential.
 */

import { currentPrincipal, principalProfile } from "@/lib/auth/principal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const me = await currentPrincipal();
  if (me.kind === "anonymous") {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const profile = await principalProfile(me);
  if (!profile) {
    // A live session whose principal no longer resolves: treat as signed out
    // rather than inventing a shape for a student who is not there.
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  return Response.json(profile);
}
