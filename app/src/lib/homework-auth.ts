import { NextResponse } from "next/server";
import type { Principal } from "@/lib/auth/principal";

/**
 * The homework routes' shared gate: a signed-in student with a confirmed
 * address (FR-2004 — homework help is learning). Returns the student id, or
 * the response to send instead.
 *
 * Each route refuses a pending (onboarding) student itself with
 * `onboardingRefusal(me)` before calling this (FR-4014), so the refusal is
 * visible in the route the way the other student APIs show it.
 */
export function homeworkStudent(me: Principal): number | NextResponse {
  if (me.kind !== "student") {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!me.emailVerified) {
    return NextResponse.json({ error: "email_unverified" }, { status: 403 });
  }
  return me.studentId;
}
