/**
 * POST /api/console/students/{id}/tester — mark or unmark one student as a
 * TEST account (ADR-0021, migration 030, `lib/teaching-queries.ts
 * setTesterMark`).
 *
 *   body: { tester: boolean, note?: string }
 *
 * `student-data`, the role of the Student 360 it is posted from, for the
 * reason the per-student course override is (ADR-0018): it names a person.
 * The mark decides nothing by itself — it matters only while the teaching
 * switch reads "Test accounts only", and that switch is `teaching-controls`'s
 * (`/api/console/teaching`). So the safety decision and the bookkeeping sit
 * under different roles, the way the grade rule and the student override do.
 *
 * **Removable with one click, and never erased.** `tester: false` stamps the
 * open mark with who removed it and when; the console holds no DELETE on the
 * table, so the history of who was a tester, and on whose say-so, survives.
 *
 * **The student surface can never do this for herself.** `ainext_app` holds
 * SELECT on `student_testers` and nothing else (migration 030, proved in
 * `app/scripts/rls-proof.sql` §6), and there is no tester column on
 * `students` for her profile update to reach.
 *
 * A student not in this environment answers 404, as the subscription endpoint
 * does: "not yours" and "not there" are one answer.
 */

import { authorize } from "@/lib/auth/authorize";
import { AuthError } from "@/lib/auth/principal";
import { setTesterMark } from "@/lib/teaching-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_NOTE = 280;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let me;
  try {
    me = await authorize({ role: "student-data" });
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }
  if (me.kind !== "operator") {
    return Response.json({ error: "permission_denied" }, { status: 403 });
  }

  const studentId = Number((await ctx.params).id);
  if (!Number.isInteger(studentId) || studentId <= 0) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  let body: { tester?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof body.tester !== "boolean") {
    return Response.json({ error: "invalid_tester", allowed: [true, false] }, { status: 400 });
  }
  const note =
    typeof body.note === "string" && body.note.trim().length > 0
      ? body.note.trim().slice(0, MAX_NOTE)
      : null;

  try {
    const out = await setTesterMark(me.operatorId, studentId, body.tester, note);
    if (!out) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ ok: true, ...out });
  } catch (err) {
    console.error("[console] tester mark failed:", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
