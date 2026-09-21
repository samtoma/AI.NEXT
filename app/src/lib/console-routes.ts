/**
 * The console's routes, in one table, used by four things that must agree
 * (ADR-0014, contracts/authorization.md, contracts/admin.md).
 *
 *  1. **The nav** in `layout.console.tsx` — which links an operator is offered.
 *     Hiding a link is NEVER the authorisation (FR-2107); it is only what stops
 *     the shell lying about its own state.
 *  2. **The guard** each page calls (`lib/console-auth.ts`), so the role a page
 *     requires and the role the nav advertises cannot drift apart.
 *  3. **The route-manifest proof** (`scripts/check-surface-manifest.mts`) —
 *     every path here must be absent from the student build's manifest and
 *     present in the console build's.
 *  4. **The role × surface matrix test** (`lib/auth/matrix.test.mts`), which
 *     enumerates from this table: a console route that is not listed here fails
 *     the test rather than shipping with nobody having decided who may see it.
 *
 * **`roles` is an ANY-OF, and an empty list means "any signed-in operator".**
 * The shell, the profile page and the own-sessions list are permitted to all
 * four roles in contracts/authorization.md, which is what an empty list
 * encodes. It never means "anyone": `layout.console.tsx` refuses a non-operator
 * before any of this is consulted.
 *
 * This module imports nothing but a type, deliberately: `console-routes.test.mts`
 * and `matrix.test.mts` run under `node --test`, which has no `@/` alias and no
 * Next request context.
 */

import type { OperatorRole } from "./db";

export type { OperatorRole };

export type ConsoleRoute = {
  /** The URL in the console build. The console lives at the ROOT of its build. */
  path: string;
  /** Source file, relative to `app/src/app/`, so the table is checkable by eye. */
  file: string;
  /** Any ONE of these admits. Empty = any operator (the shell's own pages). */
  roles: readonly OperatorRole[];
  /** What the nav calls it, or null for a route reached from another page. */
  nav: string | null;
  /**
   * This URL also exists in the STUDENT build, from a different file. True for
   * `/` alone: the student build serves the product's landing page there. The
   * manifest proof skips such paths on the student side and still requires them
   * on the console side (see the header of check-surface-manifest.mts).
   */
  sharedPath?: true;
};

export const CONSOLE_ROUTES: readonly ConsoleRoute[] = [
  {
    path: "/",
    file: "(console)/page.console.tsx",
    // contracts/admin.md view 1: student-data sees the full row, cost-billing a
    // projection with no content column. Both reach the page; the projection is
    // decided inside it, from the roles the principal actually holds.
    roles: ["student-data", "cost-billing"],
    nav: "Students",
    sharedPath: true,
  },
  {
    // Not a view: a redirect to `/`, which IS the list. Permitted to all four
    // roles for the same reason `/` is — what an operator may see when they
    // arrive there is decided there, not by whether they may type the address.
    path: "/students",
    file: "(console)/students/page.console.tsx",
    roles: [],
    nav: null,
  },
  {
    path: "/students/[id]",
    file: "(console)/students/[id]/page.console.tsx",
    roles: ["student-data"],
    nav: null,
  },
  // The three transcript surfaces (contracts/admin.md §3, §4, §5). All
  // `student-data`, all reached from the 360 rather than from the nav, and all
  // three are listed here separately rather than covered by a prefix rule:
  // `routeAdmits` is a lookup by exact path, and a surface nobody enumerated
  // is the door FR-2107 is about. Their audit behaviour DIFFERS — the list
  // writes no `operator_reads` row and the other two do — which is a property
  // of each page, not of this table.
  {
    path: "/students/[id]/sessions",
    file: "(console)/students/[id]/sessions/page.console.tsx",
    roles: ["student-data"],
    nav: null,
  },
  {
    path: "/students/[id]/sessions/[sid]",
    file: "(console)/students/[id]/sessions/[sid]/page.console.tsx",
    roles: ["student-data"],
    nav: null,
  },
  {
    path: "/students/[id]/sessions/[sid]/replay",
    file: "(console)/students/[id]/sessions/[sid]/replay/page.console.tsx",
    roles: ["student-data"],
    nav: null,
  },
  {
    path: "/profile",
    file: "(console)/profile/page.console.tsx",
    roles: [],
    nav: "My account",
  },
  {
    path: "/content",
    file: "(console)/content/page.console.tsx",
    roles: ["content-review"],
    nav: "Content review",
  },
  {
    path: "/cost",
    file: "(console)/cost/page.console.tsx",
    roles: ["cost-billing"],
    nav: "Cost",
  },
  {
    path: "/pipeline",
    file: "(console)/pipeline/page.console.tsx",
    roles: ["evidence-access"],
    nav: "Pipeline",
  },
  {
    path: "/gallery",
    file: "(console)/gallery/page.console.tsx",
    roles: ["evidence-access"],
    nav: "Gallery",
  },
  {
    path: "/dev/lesson-content",
    file: "(console)/dev/lesson-content/page.console.tsx",
    roles: ["evidence-access"],
    nav: "Lesson content",
  },
  {
    path: "/dev/math-widgets",
    file: "(console)/dev/math-widgets/page.console.tsx",
    roles: ["evidence-access"],
    nav: "Math widgets",
  },
  {
    path: "/dev/social-fixture",
    file: "(console)/dev/social-fixture/page.console.tsx",
    roles: ["evidence-access"],
    nav: "Social fixture",
  },
  {
    path: "/dev/widget-questions",
    file: "(console)/dev/widget-questions/page.console.tsx",
    roles: ["evidence-access"],
    nav: "Widget questions",
  },
] as const;

/** Every role the table can ask for — the matrix test's other axis. */
export const ALL_ROLES: readonly OperatorRole[] = [
  "content-review",
  "evidence-access",
  "student-data",
  "cost-billing",
] as const;

/**
 * The route with this path, or `undefined`.
 *
 * Pages look themselves up by their own literal path, which is why a page added
 * without a row here throws at render instead of rendering unguarded.
 */
export function consoleRoute(path: string): ConsoleRoute | undefined {
  return CONSOLE_ROUTES.find((r) => r.path === path);
}

/** Does holding these roles admit this route? Pure — this is the matrix. */
export function routeAdmits(route: ConsoleRoute, roles: readonly OperatorRole[]): boolean {
  if (route.roles.length === 0) return true; // any operator; the shell decides who is one
  return route.roles.some((r) => roles.includes(r));
}

/** The nav an operator holding these roles is offered, in table order. */
export function navFor(roles: readonly OperatorRole[]): ConsoleRoute[] {
  return CONSOLE_ROUTES.filter((r) => r.nav !== null && routeAdmits(r, roles));
}
