import { notFound, redirect } from "next/navigation";

import { WELCOME_PATH } from "@/lib/auth/onboarding";
import { IS_CONSOLE } from "@/lib/env";
import { resolveStudentContext } from "@/lib/student-context";

/**
 * The student product's routes — `/`, `/student`, `/dashboard`, `/spine` —
 * and the **weaker half** of the build split, stated as such rather than
 * smoothed over (ADR-0014, research R9).
 *
 * The direction that matters is a child reaching operator tooling, and that one
 * is a build fact: the console's files are named `page.console.tsx` and are not
 * routes at all in this build. This is the other direction — an operator
 * reaching a lesson page — and it is a **runtime** assertion, because making it
 * symmetric would mean renaming every route file in the application against a
 * threat nobody has.
 *
 * A route group changes no URL. `/student` is still `/student`; the parentheses
 * exist so this one layout can cover the student product without a segment of
 * its own.
 *
 * `force-dynamic` is load-bearing and was learned the hard way on
 * `dev/layout.tsx`: a prerendered page evaluates its layout once, at build
 * time, which would bake the surface into the artefact instead of reading it
 * from the process. The root layout is already dynamic for its own reasons;
 * this states the requirement locally so it survives a change up there.
 *
 * **A first Google sign-in that still owes its step goes to `/welcome`**
 * (feature 003, FR-4014: grade and curriculum "before any lesson opens").
 * Checked on entry to the group, from the principal — the same read that says
 * who she is, never a cookie — through `resolveStudentContext()`, which the
 * root layout has already resolved for this request (React `cache`), so the
 * check costs no query of its own. A layout does not re-run on navigation inside
 * the group, and it need not: the flag only ever goes from pending to done,
 * so a student inside the group is never pending. The data is refused below
 * the page as well — every student API answers 403 while it is
 * (`requireStudent`), which is the half that does not depend on rendering.
 */
export const dynamic = "force-dynamic";

export default async function StudentSurfaceLayout({ children }: { children: React.ReactNode }) {
  if (IS_CONSOLE) notFound();
  if ((await resolveStudentContext())?.onboardingPending) redirect(WELCOME_PATH);
  return <>{children}</>;
}
