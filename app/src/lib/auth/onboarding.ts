/**
 * Sign-up's curriculum answer and the first-Google-sign-in step — the
 * DECISIONS, with no database, no cookie and no framework near them
 * (feature 003; FR-4005, FR-4014, FR-4016; contracts/student-api.md).
 *
 * The routes (`api/auth/signup`, `api/auth/onboarding`), the principal
 * (`lib/auth/principal.ts`), the `(student)` layout and `/welcome` all ask the
 * questions below, and each would otherwise answer them in its own words. Kept
 * pure so `node --test` proves every branch without a request behind it
 * (`onboarding.test.mts`), the way `lib/catalog.ts` keeps the gate's rules.
 *
 * **Since Samuel's reversal of 2026-10-01** ("yes the sign up should always
 * ask"; `specs/003-curriculum-tracks/decisions.md`, decision 1, superseded)
 * the curriculum question is asked on every grade, not only where two or more
 * curricula are offered — see `resolveInitialCurriculum` in `lib/catalog.ts`.
 * A missing answer is refused the same way an unknown one always was: `422`,
 * through `curriculumRefusal` below.
 *
 * What is NOT here, on purpose:
 *
 *   · what a grade offers — ONE rule, `offeredCurricula` in `lib/catalog.ts`,
 *     read through `lib/curriculum-queries.ts` (FR-4004); it is display
 *     information only now (which options get a "nothing yet" note), never a
 *     gate on what may be chosen;
 *   · how a submitted curriculum resolves — `resolveInitialCurriculum`, the
 *     same function for sign-up and the Google step (FR-4005);
 *   · "once" — the database's promise, `complete_student_onboarding()`
 *     (migration 033), which refuses a second call at the point of writing.
 *     This module only translates that refusal into HTTP.
 */

import type { CurriculumId } from "../curricula.ts";
import type { CurriculumSource } from "../catalog.ts";
import type { Principal } from "../db.ts";
import type { OnboardingResult } from "../curriculum-queries.ts";

/* ------------------------------------------------------------------ */
/* Pending                                                             */
/* ------------------------------------------------------------------ */

/** The one place a pending step is recognised (FR-4014). */
export function isOnboardingPending(me: Principal): boolean {
  return me.kind === "student" && me.onboardingPending === true;
}

/** The refusal every student API answers while the step is owed. */
export const ONBOARDING_PENDING = "onboarding_pending";

/** Where a pending student is sent, from every student page. */
export const WELCOME_PATH = "/welcome";

/**
 * What `/welcome` does for whoever reaches it, given the request's student
 * context (`resolveStudentContext()`, `null` for nobody): a visitor signs in
 * first, a student whose step is done goes to her lessons (the step is never a
 * way to change a curriculum, decision 4), and only a pending student sees the
 * form.
 */
export function welcomeRoute(
  student: { onboardingPending: boolean } | null
): "signin" | "form" | "done" {
  if (student === null) return "signin";
  return student.onboardingPending ? "form" : "done";
}

/* ------------------------------------------------------------------ */
/* HTTP answers                                                        */
/* ------------------------------------------------------------------ */

export type HttpAnswer = { status: number; body: Record<string, unknown> | null };

/**
 * The refusal when a submitted curriculum does not resolve — sign-up and the
 * Google step answer it identically (contracts/student-api.md). Both are
 * `422`, like `invalid_grade` — a required answer that is missing and an
 * answer the registry does not recognise are the same kind of refusal, a bad
 * request, not a conflict with server state:
 *
 *   · an id the registry does not know → 422 `invalid_curriculum`, with the
 *     field, in the SAME shape sign-up already answers `invalid_grade` in;
 *   · nothing was sent (blank or missing — now true of every grade since
 *     Samuel's 2026-10-01 reversal, not only one offering two or more
 *     curricula) → 422 `curriculum_required`, carrying what the grade offers
 *     NOW so the form's "nothing yet" notes stay current.
 */
export function curriculumRefusal(
  error: "invalid_curriculum" | "curriculum_required",
  offered: readonly CurriculumId[]
): HttpAnswer {
  return error === "invalid_curriculum"
    ? { status: 422, body: { error, field: "curriculum" } }
    : { status: 422, body: { error, field: "curriculum", offered: [...offered] } };
}

/**
 * `POST /api/auth/onboarding`'s answer for what `completeOnboarding` returned.
 * A second submission is **409 `onboarding_already_completed`** — refused
 * loudly, never a silent 204 (FR-4014, privacy review F10).
 */
export function onboardingAnswer(result: OnboardingResult): HttpAnswer {
  if (result.ok) return { status: 204, body: null };
  switch (result.reason) {
    case "invalid_grade":
      return { status: 422, body: { error: "invalid_grade", field: "grade" } };
    case "invalid_curriculum":
    case "curriculum_required":
      return curriculumRefusal(result.reason, result.offered ?? []);
    case "already_completed":
      return { status: 409, body: { error: "onboarding_already_completed" } };
  }
}

/* ------------------------------------------------------------------ */
/* The first-party record                                              */
/* ------------------------------------------------------------------ */

/**
 * `account_created`'s properties (data-model.md §2 "The initial value at
 * sign-up"; FR-4012). FIRST-PARTY ONLY: `lib/analytics.ts` writes
 * `analytics_events` and nothing else, and `account_created` is not a GA4
 * event (`ga-curriculum-guard.test.mts`, FR-4016).
 *
 * No `curriculum_resolved_from` any more (Samuel's 2026-10-01 reversal):
 * sign-up and the Google step never override an explicit, known pick, so
 * there is nothing left to resolve away from.
 */
export function accountCreatedProperties(
  method: "password" | "google",
  grade: string,
  resolved: { curriculum: CurriculumId; source: CurriculumSource }
): Record<string, string> {
  return {
    method,
    grade,
    curriculum: resolved.curriculum,
    curriculum_source: resolved.source,
  };
}

/* ------------------------------------------------------------------ */
/* The question, on the page                                           */
/* ------------------------------------------------------------------ */
//
// Up to 2026-09-30 this section held `asksCurriculum` (asked only where a
// grade offered two or more curricula) and `curriculumToSend` (sent a pick
// only when the grade asked and offered it). Samuel's reversal of 2026-10-01
// ("yes the sign up should always ask") removed the gate: the question is
// shown for every grade once one is chosen, and whatever the student picks —
// offered for that grade or not — is exactly what the form sends. There is no
// decision left here for this module to own; `SignupForm` and `OnboardingForm`
// reveal `CurriculumChoice` directly off their own `grade` state.
