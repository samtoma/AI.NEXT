/**
 * POST /api/auth/onboarding — the one-screen step after a FIRST Google sign-in
 * (feature 003, FR-4014, FR-2006; decision 5; contracts/student-api.md).
 *
 * Google gives us an email and a name, and no grade. The account was created
 * `onboarding_pending` with a placeholder grade (`lib/auth/google.ts`), and no
 * lesson opens until this answers: grade, and — only when that grade offers
 * two or more curricula — curriculum. Nothing else (FR-4014).
 *
 *   { "grade": "10", "curriculum": "us-american-en" }   // curriculum: only when asked
 *
 * | case                                         | answer                                  |
 * |----------------------------------------------|-----------------------------------------|
 * | not signed in as a student                   | 401 `unauthenticated`                   |
 * | not a JSON request                           | 415 `unsupported_media_type`            |
 * | grade not one of ours / curriculum unknown   | 422 `invalid_grade` / `invalid_curriculum` |
 * | grade offers two or more and none was picked | 409 `curriculum_required` + `offered`   |
 * | the step was already completed               | **409 `onboarding_already_completed`**  |
 * | done                                         | 204                                     |
 *
 * **Once, and loudly.** The write is `complete_student_onboarding()`
 * (migration 033): a definer function that acts only on the acting student,
 * only while her step is pending, and RAISES otherwise. The principal's
 * `onboardingPending` is checked first for a fast, clear answer, but the
 * function is the guarantee — two submissions racing past that check still
 * write once, and the loser gets the same 409. A second submission is never a
 * silent 204: this step must never become a student-side way to change a
 * curriculum (decision 4; privacy review F10). After it, only an operator
 * does (FR-4010, FR-4017).
 *
 * **Why the JSON content type is required here.** The session cookie is
 * `SameSite=Lax`, which keeps it off a cross-SITE form post — but every
 * `*.reletix.com` host is the same site. A plain HTML form cannot send
 * `application/json` without a CORS preflight, which a sibling origin fails,
 * so requiring it closes that door on the one write in this build that can
 * never be undone by the student who made it.
 *
 * `account_created` is recorded HERE for a Google account (first-party only,
 * FR-4016), with the grade and curriculum she gave — the callback no longer
 * records the placeholder grade.
 */

import { currentPrincipal } from "@/lib/auth/principal";
import {
  accountCreatedProperties,
  isOnboardingPending,
  onboardingAnswer,
} from "@/lib/auth/onboarding";
import { emit } from "@/lib/analytics";
import { completeOnboarding } from "@/lib/curriculum-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const me = await currentPrincipal();
  if (me.kind !== "student") {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  const type = req.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(type.trim())) {
    return Response.json({ error: "unsupported_media_type" }, { status: 415 });
  }

  // Done already: refused before anything is read or resolved. The definer
  // function below refuses the same way if two submissions race past this.
  if (!isOnboardingPending(me)) {
    return Response.json({ error: "onboarding_already_completed" }, { status: 409 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* fall through: an empty body is an invalid grade */
  }
  if (body === null || typeof body !== "object") body = {};

  try {
    const result = await completeOnboarding(me.studentId, {
      grade: body.grade,
      curriculum: body.curriculum,
    });
    if (result.ok) {
      void emit({
        event: "account_created",
        studentId: me.studentId,
        properties: accountCreatedProperties("google", result.grade, {
          curriculum: result.curriculum,
          source: result.source,
          resolvedFrom: result.resolvedFrom,
        }),
      });
    }
    const answer = onboardingAnswer(result);
    return answer.body === null
      ? new Response(null, { status: answer.status })
      : Response.json(answer.body, { status: answer.status });
  } catch (err) {
    console.error("[auth] onboarding failed:", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
