import { notFound } from "next/navigation";

import { IS_CONSOLE } from "@/lib/env";

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
 */
export const dynamic = "force-dynamic";

export default function StudentSurfaceLayout({ children }: { children: React.ReactNode }) {
  if (IS_CONSOLE) notFound();
  return <>{children}</>;
}
