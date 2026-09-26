/**
 * POST /api/console/students/{id}/courses — set, change or clear one
 * student's course-access exception (migration 023, `lib/catalog.ts`,
 * `lib/catalog-queries.ts` `setStudentOverride`).
 *
 * ⚠ **NO REQUIREMENT COVERS THIS ENDPOINT.** See the header of
 * `lib/catalog.ts`; nothing was added to `traceability.md` for it.
 *
 * ---------------------------------------------------------------------------
 * A DIFFERENT ROLE FROM `/api/console/courses`, DELIBERATELY
 * ---------------------------------------------------------------------------
 * `api/console/courses/route.console.ts` sets the broad per-grade rule under
 * `content-review` — a decision about a subject, not a person. This endpoint
 * names one student, so it sits under `student-data` instead, the same role
 * that guards the Student 360 page it is written from
 * (`(console)/students/[id]/page.console.tsx`). `content-review` must not
 * learn a student's name from this feature, and holding it grants nothing
 * here — the same separation `contracts/authorization.md` already draws
 * between content and people everywhere else in this console.
 *
 * ---------------------------------------------------------------------------
 * THREE VALUES, NOT TWO — `state` MAY LEGITIMATELY BE `null`
 * ---------------------------------------------------------------------------
 * `setStudentOverride`'s own contract is "set, change, or CLEAR": passing
 * `state: null` DELETES the override row and returns the student to whatever
 * their grade's rule says. That is a normal, common request from this page
 * (clearing a mistaken exception), not a malformed one — so the validation
 * below treats `null` as a third admitted value rather than rejecting it as
 * `invalid_state`.
 *
 * ---------------------------------------------------------------------------
 * WHY NO EXPLICIT "STUDENT EXISTS" CHECK
 * ---------------------------------------------------------------------------
 * `setStudentOverride`'s `INSERT` carries a `REFERENCES students(id)` foreign
 * key; a non-existent id throws and this handler answers `server_error`
 * rather than `not_found`. That is a coarser signal than
 * `.../subscription`'s `UPDATE ... RETURNING`, which can tell "no such row"
 * from "the database is unhappy" — but this endpoint is reachable only from a
 * page that has already resolved the student (the 360 page calls `notFound()`
 * before rendering the control that posts here), so a real client of this
 * route can only ever send an id that exists. Sharpening the distinction
 * would mean adding a lookup query nothing else needs; the brief this feature
 * shipped from asks for a genuinely-needed addition to be reported, not
 * invented on spec, so it stays a 500 rather than gaining a bespoke read.
 */

import { authorize } from "@/lib/auth/authorize";
import { AuthError } from "@/lib/auth/principal";
import type { CourseState } from "@/lib/catalog";
import { setStudentOverride } from "@/lib/catalog-queries";
import { COURSE_IDS as REGISTRY_COURSE_IDS } from "@/lib/courses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATES = ["live", "hidden"] as const;
const isState = (v: unknown): v is CourseState =>
  typeof v === "string" && (STATES as readonly string[]).includes(v);

/** Every course id the course registry knows — the CLOSED list an override may name.
 *  Unlike the grade-rule endpoint, an override is not grade-scoped: it can
 *  name any registry course regardless of the student's own year. */
const COURSE_IDS = new Set<string>(REGISTRY_COURSE_IDS);

/** Same bound as `SubscriptionEditor` and the grade-rule endpoint. */
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

  let body: { courseId?: unknown; state?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (typeof body.courseId !== "string" || !COURSE_IDS.has(body.courseId)) {
    return Response.json(
      { error: "invalid_course", allowed: [...COURSE_IDS] },
      { status: 400 }
    );
  }
  // `null` clears the override (see header); anything else must be one of the
  // two states. A missing key altogether is `undefined`, which matches
  // neither branch and correctly falls through to `invalid_state`.
  if (body.state !== null && !isState(body.state)) {
    return Response.json(
      { error: "invalid_state", allowed: [...STATES, null] },
      { status: 400 }
    );
  }
  const state = body.state as CourseState | null;
  const note =
    typeof body.note === "string" && body.note.trim().length > 0
      ? body.note.trim().slice(0, MAX_NOTE)
      : null;

  try {
    await setStudentOverride(me.operatorId, studentId, body.courseId, state, note);
    // Reload-on-success, same as `SubscriptionEditor` and the grid: the client
    // re-fetches `studentAccess` from the server rather than trusting a local
    // patch to agree with it.
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[console] student course override failed:", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
