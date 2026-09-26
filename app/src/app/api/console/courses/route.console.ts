/**
 * POST /api/console/courses — set the per-(course, grade) availability rule
 * (migration 023, `lib/catalog.ts`, `lib/catalog-queries.ts` `setGradeRule`).
 *
 * ⚠ **NO REQUIREMENT COVERS THIS ENDPOINT.** No FR has been invented for it
 * and `traceability.md` was not touched — see the header of `lib/catalog.ts`
 * and of `(console)/courses/page.console.tsx`, the only caller.
 *
 * ---------------------------------------------------------------------------
 * MIRRORS `api/console/students/[id]/subscription/route.console.ts`, ON PURPOSE
 * ---------------------------------------------------------------------------
 * Same shape for the same reasons: `.console.ts` is what keeps this address
 * out of the student build (`next.config.ts` `pageExtensions`, FR-2201) —
 * `scripts/check-surface-manifest.mts` proves it from the build artefact, not
 * from a promise. `authorize({ role })` is the only role check anywhere in
 * this application (FR-2106) and records its own refusal as
 * `permission_denied`; nothing here re-decides that. The body is validated
 * against CLOSED lists derived from the same registries the rest of the
 * feature reads — `SUBJECTS` for the course id, `GRADES` for the grade — so an
 * operator who mistypes either is told the real set rather than getting a
 * cryptic constraint violation from Postgres. `updated_by`/`updated_at` are
 * written in the same statement as the state, inside `setGradeRule`, so "a
 * rule with no author" is not a state this endpoint can produce.
 *
 * ---------------------------------------------------------------------------
 * WHY `content-review` AND NOT A NEW ROLE
 * ---------------------------------------------------------------------------
 * A grade rule ("Prep 3 sees Mathematics") is a decision about *content* —
 * which subject reaches which year — not about any one student, which is
 * exactly the boundary `content-review` already draws on `/content`
 * (FR-2204): whoever decides what unreviewed generated content reaches a
 * child is the same authority that decides whether a whole subject with zero
 * reviewed questions reaches one. The PER-STUDENT exception is a different
 * endpoint under a different role (`student-data`,
 * `api/console/students/[id]/courses/route.console.ts`) for the opposite
 * reason: it names a student, and `content-review` must not learn student
 * names from this feature.
 *
 * The honesty confirmation — "this course has zero objectives, are you sure"
 * — is enforced in the browser (`CourseAvailabilityGrid.tsx`), not here. That
 * is a UI courtesy, not a safety boundary: nothing stops an operator from
 * calling this endpoint directly, and that is fine, because the actual safety
 * boundary is `content-review` itself — the same role that already decides
 * whether a generated, unreviewed question may reach a student decides this.
 */

import { authorize } from "@/lib/auth/authorize";
import { AuthError } from "@/lib/auth/principal";
import { GRADES, type CourseState } from "@/lib/catalog";
import { setGradeRule } from "@/lib/catalog-queries";
import { COURSE_IDS as REGISTRY_COURSE_IDS } from "@/lib/courses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATES = ["live", "hidden"] as const;
const isState = (v: unknown): v is CourseState =>
  typeof v === "string" && (STATES as readonly string[]).includes(v);

/** Every course id the course registry knows (`lib/courses.ts`) — the CLOSED
 *  list a rule may name. Since 003 that includes a course of the American
 *  curriculum; a rule for it still reaches only students of that curriculum
 *  (or holding an exception for it) — `lib/catalog.ts`. */
const COURSE_IDS = new Set<string>(REGISTRY_COURSE_IDS);

/** Every grade the product knows — from `lib/catalog.ts`'s own `GRADES`, not a
 *  second hand-written list that could drift from it. */
const GRADE_VALUES = new Set<string>(GRADES.map((g) => g.value));

/** Long enough for an operator's own reason; short enough that this stays a
 *  note and not a second content field. Same bound `SubscriptionEditor` uses. */
const MAX_NOTE = 280;

export async function POST(req: Request) {
  let me;
  try {
    me = await authorize({ role: "content-review" });
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }
  // `authorize` has already refused anyone who is not an operator holding the
  // role; this only narrows the type for the write below.
  if (me.kind !== "operator") {
    return Response.json({ error: "permission_denied" }, { status: 403 });
  }

  let body: { courseId?: unknown; grade?: unknown; state?: unknown; note?: unknown };
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
  if (typeof body.grade !== "string" || !GRADE_VALUES.has(body.grade)) {
    return Response.json(
      { error: "invalid_grade", allowed: [...GRADE_VALUES] },
      { status: 400 }
    );
  }
  if (!isState(body.state)) {
    return Response.json({ error: "invalid_state", allowed: STATES }, { status: 400 });
  }
  const note =
    typeof body.note === "string" && body.note.trim().length > 0
      ? body.note.trim().slice(0, MAX_NOTE)
      : null;

  try {
    await setGradeRule(me.operatorId, body.courseId, body.grade, body.state, note);
    // The caller (`CourseAvailabilityGrid`) reloads the page on a 2xx rather
    // than reading this body — the same choice `SubscriptionEditor` makes, for
    // the same reason: a partial client-side patch could disagree with what
    // the server actually now holds the moment two operators write at once.
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[console] course rule update failed:", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
