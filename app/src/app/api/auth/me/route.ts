/**
 * GET /api/auth/me — who am I, and nothing else.
 *
 * No session metadata and no token material: the session list is
 * `/api/auth/sessions`' job and token material is nobody's. `emailVerified` is
 * here because it is what the student shell renders the "what is outstanding"
 * banner from (FR-2004) — a product fact, not a credential.
 *
 * Feature 003 adds three (contracts/student-api.md): `curriculum` (the
 * registry id, or `null` when the stored value is not one the product knows),
 * `curriculumKnown`, and `onboardingPending` — whether a first Google sign-in
 * still owes its grade-and-curriculum step (FR-4014). Deliberately NOT how the
 * curriculum was set or its history: those are operator facts. The response
 * goes to her own browser only; the curriculum never goes to GA4 (FR-4016).
 * This route stays open while the step is pending — it is how a client learns
 * that it is.
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
