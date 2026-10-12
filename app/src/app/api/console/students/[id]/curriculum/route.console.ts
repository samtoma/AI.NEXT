/**
 * POST /api/console/students/[id]/curriculum — an operator changes one
 * student's curriculum (feature 003: FR-4010, FR-4011, FR-4012; decision 4;
 * contracts/console.md).
 *
 * **The only way a curriculum changes after sign-up at launch.** No student
 * surface offers a curriculum control (FR-4010), and the database agrees:
 * migration 033 gives `ainext_app` no UPDATE on the curriculum columns at all
 * (FR-4017). The Student 360's Curriculum panel posts here, after asking in
 * the page — naming the courses the student will stop and start seeing, and
 * saying her progress is kept (`CurriculumEditor.tsx`, FR-2710).
 *
 * Mirrors `api/console/students/[id]/courses/route.console.ts`: `.console.ts`
 * keeps it out of the student build (`check-surface-manifest.mts` proves it
 * from the artefact); `authorize({ role })` is the only role check in the
 * application and records its own refusal as `permission_denied` (FR-2106);
 * the body is validated against a closed list — the curriculum REGISTRY
 * (`lib/curricula.ts`), never a CHECK and never trusted.
 *
 * `student-data` alone (FR-2707): it names a student and decides which
 * courses that child sees. `cost-billing` never reads a per-student
 * curriculum (FR-2406, privacy review F7); `content-review` decides the
 * per-grade rules and must not learn a name from this feature.
 *
 * | Case               | Result                                            |
 * |--------------------|---------------------------------------------------|
 * | role missing       | 403 `permission_denied`, recorded (002)            |
 * | bad id / no student| 404 `not_found` — this environment's students only |
 * | unknown curriculum | 400 `invalid_curriculum`, with the registry's list |
 * | same as current    | 409 `no_change` — nothing written, nothing recorded|
 * | valid              | 200: ONE transaction (`setStudentCurriculum`,      |
 * |                    | `lib/curriculum-queries.ts`) records the change,    |
 * |                    | attributed to this operator, and makes it, as      |
 * |                    | `chosen`; the body names the courses she now sees  |
 *
 * **It deletes nothing and moves nothing** (FR-4011). Mastery and attempts are
 * per objective and the saved place is per course, so the other curriculum's
 * progress stays where it was earned, and changing back finds it exactly as
 * left. Nothing here touches a progress table; `console-curriculum-db.test.mts`
 * proves change-and-back leaves every row as it was.
 */

import { authorize } from "@/lib/auth/authorize";
import { AuthError } from "@/lib/auth/principal";
import { courseName } from "@/lib/console-course-names";
import { curriculumProjection } from "@/lib/console-queries";
import { CURRICULUM_IDS } from "@/lib/curricula";
import { setStudentCurriculum } from "@/lib/curriculum-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Same bound as every console note (`SubscriptionEditor`, the course rules). */
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

  let body: { curriculum?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const note =
    typeof body.note === "string" && body.note.trim().length > 0
      ? body.note.trim().slice(0, MAX_NOTE)
      : null;

  try {
    const result = await setStudentCurriculum(me.operatorId, studentId, body.curriculum, note);
    if (!result.ok) {
      return result.reason === "unknown_curriculum"
        ? Response.json({ error: "invalid_curriculum", allowed: CURRICULUM_IDS }, { status: 400 })
        : Response.json({ error: "not_found" }, { status: 404 });
    }
    if (!result.changed) {
      return Response.json({ error: "no_change", curriculum: result.to }, { status: 409 });
    }
    // What she sees now, decided by the gate's own rule (contracts/console.md:
    // "Returns 200 with the new record and the courses the student now sees").
    // The editor reloads the page on a 2xx rather than trusting this body, as
    // every console editor does; it is here for a caller that is not a page.
    const projection = await curriculumProjection(me.operatorId, studentId);
    return Response.json({
      ok: true,
      from: result.from,
      to: result.to,
      source: "chosen",
      courses: (projection?.current ?? []).map((id) => ({ id, name: courseName(id) })),
    });
  } catch (err) {
    console.error("[console] curriculum change failed:", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
