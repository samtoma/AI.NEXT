import { currentPrincipal, onboardingRefusal } from "@/lib/auth/principal";
import { CURRICULUM_IDS } from "@/lib/curricula";
import { changeOwnCurriculum } from "@/lib/student-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/settings/curriculum — the student chooses her own curriculum
 * (FR-4010 as amended 2026-10-27; Tamer's call, lifting decision 4).
 *
 * Progress is not touched (FR-4011): it stays with the course it was earned
 * in, and switching back shows it again exactly as left. The change is
 * recorded as history with `reason = 'student'` (FR-4012), in the same call
 * that makes it (`change_own_curriculum`, migration 043). Open chats read the
 * new scope on their next turn: it is part of the snapshot key.
 */
export async function POST(req: Request) {
  const me = await currentPrincipal();
  if (me.kind !== "student") {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const pending = onboardingRefusal(me);
  if (pending) return pending;

  let body: { curriculum?: unknown };
  try {
    body = (await req.json()) as { curriculum?: unknown };
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const res = await changeOwnCurriculum(me.studentId, body.curriculum);
    if (!res.ok) {
      return Response.json({ error: res.reason, allowed: CURRICULUM_IDS }, { status: 400 });
    }
    return Response.json(res);
  } catch (err) {
    console.error("[settings] curriculum change failed:", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
