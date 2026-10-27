import { currentPrincipal, onboardingRefusal } from "@/lib/auth/principal";
import { offeredCurriculaFor } from "@/lib/curriculum-queries";
import { updateOwnProfile } from "@/lib/student-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/settings/profile — the student's own name and grade (FR-2013).
 *
 * The body carries `displayName` and `grade` and no student id, ever: whose
 * row it is comes from the session, exactly as `/api/settings/appearance`
 * does it. A grade change applies FR-4008 to the curriculum (kept if chosen,
 * re-resolved and recorded if implied); the answer says which happened so the
 * page can tell her.
 *
 * Both reach the tutor on its next turn: the lesson builds its prompt from the
 * profile every turn, and Ask keys its snapshot on the name and the scope.
 */
export async function POST(req: Request) {
  const me = await currentPrincipal();
  if (me.kind !== "student") {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const pending = onboardingRefusal(me);
  if (pending) return pending;

  let body: { displayName?: unknown; grade?: unknown };
  try {
    body = (await req.json()) as { displayName?: unknown; grade?: unknown };
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const res = await updateOwnProfile(me.studentId, body, (grade) => offeredCurriculaFor(grade));
    if (!res.ok) return Response.json({ error: res.reason }, { status: 400 });
    return Response.json(res);
  } catch (err) {
    console.error("[settings] profile update failed:", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
