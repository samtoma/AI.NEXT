import { ConsoleRefusal } from "@/components/console/ConsoleRefusal";
import { consoleAccess } from "@/lib/console-auth";

/**
 * `evidence-access` for every harness under `/dev` — in a layout, and for the
 * same practical reason the old `dev/layout.tsx` gave: **two of these pages are
 * `"use client"`** and cannot call the seam at all. A layout is a server
 * component regardless of what it wraps, so this covers them and every harness
 * added here later. The failure mode of a per-page guard is the page somebody
 * forgets, and these render the question bank.
 *
 * It guards against `/dev/math-widgets`'s row in `CONSOLE_ROUTES`, which is a
 * simplification worth naming: all four harnesses carry the same role in
 * contracts/authorization.md ("`/gallery`, `/dev/*` — widget and fixture
 * harnesses"), so one lookup decides all four. The matrix test still enumerates
 * each of the four separately, so a harness that is later given a different
 * role fails the test rather than inheriting this one silently.
 *
 * `force-dynamic` for the reason the old layout learned: a prerendered client
 * page evaluates its layout once, at build time, which would bake the
 * authorisation decision into the artefact.
 */
export const dynamic = "force-dynamic";

export default async function ConsoleDevLayout({ children }: { children: React.ReactNode }) {
  const access = await consoleAccess("/dev/math-widgets");
  if (!access.ok) {
    return <ConsoleRefusal status={access.status} roles={["evidence-access"]} />;
  }
  return <>{children}</>;
}
