import { redirect } from "next/navigation";

import { OnboardingForm } from "@/components/auth/OnboardingForm";
import { welcomeRoute } from "@/lib/auth/onboarding";
import { CURRICULA, CURRICULUM_IDS } from "@/lib/curricula";
import { offeredCurriculaEveryGrade } from "@/lib/curriculum-queries";
import { resolveStudentContext } from "@/lib/student-context";

export const dynamic = "force-dynamic";

export const metadata = { title: "Welcome — Noor" };

/**
 * /welcome — the one-screen step after a FIRST Google sign-in (feature 003,
 * FR-4014; decision 5; contracts/student-api.md).
 *
 * The Google callback sends a newly created account here, and the `(student)`
 * layout sends it back here from every lesson page until the step is done;
 * every student API answers 403 meanwhile. It asks for grade and — only when
 * that grade offers two or more curricula — curriculum, and for nothing else.
 *
 * Who reaches it, and what they get (`welcomeRoute`):
 *   · nobody signed in → `/signin`, carrying this address;
 *   · a student whose step is done → her lessons. The step works once, and a
 *     page that let her submit it again would be a student-side way to change
 *     a curriculum (decision 4) — the server would refuse it anyway (409);
 *   · a student whose step is owed → the form.
 *
 * `page.student.tsx`, like `/signup`: an account-creating step, so it is not a
 * route in the console build at all (`npm run check:surface:admin`).
 *
 * What each grade offers is computed HERE, on the server, from this
 * environment's live rules (FR-4004) — the same one read sign-up makes — and
 * handed to the form as data. The server re-reads it when the answer arrives,
 * so an offer that changed after the page loaded is caught there (FR-4005).
 */
export default async function WelcomePage() {
  // React-cached per request: the root layout has already resolved it.
  const me = await resolveStudentContext();
  const route = welcomeRoute(me);
  if (route === "signin") redirect("/signin?next=/welcome");
  if (route === "done") redirect("/student");

  const offered = await offeredCurriculaEveryGrade();
  const curricula = CURRICULUM_IDS.map((id) => ({ id, label: CURRICULA[id].label }));
  const firstName = me?.studentName.trim().split(/\s+/)[0] ?? "";

  return (
    <>
      <h1 className="mb-2 text-center font-display text-[1.9rem] font-extrabold text-ink">
        {firstName ? `Welcome, ${firstName}` : "Welcome to Noor"}
      </h1>
      <p className="mb-7 text-center text-[1rem] text-ink-soft">
        Tell Noor which grade you&apos;re in, and your first lesson is ready.
      </p>
      <OnboardingForm offered={offered} curricula={curricula} />
    </>
  );
}
