/**
 * The student build's header tabs (FR-3219), kept out of `NavLinks.tsx` so a
 * test can read them without a DOM.
 *
 * **The map is back, as "Your Progress" — the student's name for it.** `/spine` lost its
 * tab in #12 because it was an internal tool called "Evidence Walk", offered to
 * a fourteen-year-old beside her lesson. It has since been rebuilt as her own
 * map — her mastery, one subject, none of the graph metadata (see
 * `SpineExplorer`) — so what #12 objected to is gone and the tab returns.
 *
 * **"Where you stand" is off the header for now** (2026-09-29, product call).
 * `/dashboard` is not removed: it still resolves, and the outstanding-account
 * screen still links to it. Only the tab is gone.
 */
export const STUDENT_NAV_LINKS = [
  { href: "/student", label: "Study" },
  { href: "/spine", label: "Your Progress" },
] as const;

/**
 * Where `/` sends a visitor on the student build (FR-3220).
 *
 * Signed in goes straight to Study: the page that used to answer here was the
 * July investor preview — corpus counts, "AI turns logged", demo cards — which
 * is ours, not hers. Signed out keeps the welcome page, because sign-in and
 * signup need a front door and a root that bounces a first-time visitor to a
 * form gives them nothing to decide with.
 *
 * The frozen baseline keeps its Overview ledger: it is not bound by this
 * requirement and its header still links to `/`.
 */
export function rootDestination({
  mvp1,
  signedIn,
}: {
  mvp1: boolean;
  signedIn: boolean;
}): "/student" | "welcome" | "ledger" {
  if (!signedIn) return "welcome";
  return mvp1 ? "/student" : "ledger";
}
