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
 * What is NOT here, on purpose:
 *
 *   · what a grade offers — ONE rule, `offeredCurricula` in `lib/catalog.ts`,
 *     read through `lib/curriculum-queries.ts` (FR-4004);
 *   · how a submitted curriculum resolves — `resolveInitialCurriculum`, the
 *     same function for sign-up and the Google step (FR-4005, privacy review
 *     F12);
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
 * Google step answer it identically (contracts/student-api.md):
 *
 *   · an id the registry does not know → 422 `invalid_curriculum`, with the
 *     field, in the SAME shape sign-up already answers `invalid_grade` in;
 *   · a grade that offers two or more and none of them was sent (or one the
 *     grade stopped offering after the page loaded) → 409
 *     `curriculum_required` with what the grade offers NOW, so the form asks
 *     again with the right options (FR-4005).
 */
export function curriculumRefusal(
  error: "invalid_curriculum" | "curriculum_required",
  offered: readonly CurriculumId[]
): HttpAnswer {
  return error === "invalid_curriculum"
    ? { status: 422, body: { error, field: "curriculum" } }
    : { status: 409, body: { error, field: "curriculum", offered: [...offered] } };
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
 * `curriculum_resolved_from` appears only when a known curriculum was sent
 * and the server stored another, because the grade no longer offered it
 * (FR-4005, privacy review F12).
 */
export function accountCreatedProperties(
  method: "password" | "google",
  grade: string,
  resolved: { curriculum: CurriculumId; source: CurriculumSource; resolvedFrom: CurriculumId | null }
): Record<string, string> {
  return {
    method,
    grade,
    curriculum: resolved.curriculum,
    curriculum_source: resolved.source,
    ...(resolved.resolvedFrom ? { curriculum_resolved_from: resolved.resolvedFrom } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* The question, on the page                                           */
/* ------------------------------------------------------------------ */

/**
 * Does this grade's answer need the curriculum question? Only when it offers
 * two or more (FR-4005, decision 1). One or none is stored without asking.
 */
export function asksCurriculum(offered: readonly CurriculumId[] | undefined): boolean {
  return (offered?.length ?? 0) >= 2;
}

/**
 * The curriculum a form sends for a grade: the student's pick when the grade
 * asks and the pick is among what it offers, otherwise nothing — the server
 * resolves the single or empty case itself, and would refuse a pick the grade
 * does not offer anyway.
 */
export function curriculumToSend(
  offered: readonly CurriculumId[] | undefined,
  picked: CurriculumId | null
): CurriculumId | null {
  return asksCurriculum(offered) && picked !== null && offered!.includes(picked) ? picked : null;
}
