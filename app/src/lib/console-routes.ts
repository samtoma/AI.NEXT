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
  /**
   * A page an operator opens, or an endpoint the console POSTs to.
   *
   * Both are console addresses and both must be absent from the student build,
   * so both belong in this table — the manifest proof and the role matrix ask
   * the same question of each. What differs is only the file shape
   * (`page.console.tsx` against `route.console.ts`) and that an endpoint is
   * never in the nav. Defaults to `page`, so every row written before
   * endpoints existed still means what it meant.
   */
  kind?: "page" | "route";
  /** Any ONE of these admits. Empty = any operator (the shell's own pages). */
  roles: readonly OperatorRole[];
  /** What the nav calls it, or null for a route reached from another page. */
  nav: string | null;
  /**
   * An optional heading the nav groups this link under.
   *
   * Added with the monitoring surfaces (P5): "Security" and "Overviews" are a
   * different kind of thing from "Students" and "Cost" — they are about the
   * system rather than about one person — and a flat row of eight links makes
   * that invisible. Purely presentational: `navFor` returns the same rows in
   * the same order whether or not a group is set, and grouping is never the
   * authorisation (FR-2107).
   */
  navGroup?: string;
  /**
   * This URL also exists in the STUDENT build, from a different file. True for
   * `/` alone: the student build serves the product's landing page there. The
   * manifest proof skips such paths on the student side and still requires them
   * on the console side (see the header of check-surface-manifest.mts).
   */
  sharedPath?: true;
  /**
   * **This endpoint's entire effect is the calling operator's own record**, and
   * it can read or write nothing about a student, about content, or about
   * another operator.
   *
   * It exists because `console-routes.test.mts` otherwise refuses an endpoint
   * with an empty `roles` list — "a write endpoint open to every operator is a
   * door nobody decided" — and that rule was written when every console
   * endpoint wrote about a STUDENT (commercial status) or about CONTENT (course
   * availability). For those it is exactly right. This is a third category the
   * rule did not contemplate: a preference an operator sets about their own
   * console, posted from a page all four roles may open.
   *
   * Requiring a role here would not make anything safer; it would make the
   * feature wrong. An operator admitted to `/profile` would see a control that
   * refuses them, which is FR-2107's complaint from the other side — a surface
   * lying about its own state.
   *
   * **So the flag is not an exemption from deciding; it IS the decision**, and
   * it is deliberately a field somebody has to write rather than a path the
   * test quietly skips. What still holds: `authorize({})` refuses anonymous,
   * `principal.ts` has already downgraded any student credential presented to
   * this build (FR-2205), and the row the handler writes comes from the
   * principal and never from the request body. Set this on an endpoint that
   * can name another person, and that last sentence stops being true — which
   * is what a reviewer should check when they see it.
   */
  selfOnly?: true;
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
    // The console's first WRITE endpoint (FR-2404, FR-2405). `cost-billing`
    // alone, exactly as the page that offers it — the role that may read a
    // commercial figure is the role that may change a commercial status, and
    // `student-data` may do neither.
    //
    // It is listed here although no nav links to it, because this table is
    // what `check-surface-manifest.mts` and `matrix.test.mts` enumerate from:
    // a console address nobody decided the authorisation for should be a red
    // build, and an endpoint is an address.
    path: "/api/console/students/[id]/subscription",
    file: "api/console/students/[id]/subscription/route.console.ts",
    kind: "route",
    roles: ["cost-billing"],
    nav: null,
  },
  {
    // Migration 023's per-student exception, posted from the Course access
    // panel on the Student 360. `student-data`, NOT `content-review` — this
    // one names a student, unlike `/api/console/courses` above, and
    // `content-review` must not learn a student's name from this feature.
    path: "/api/console/students/[id]/courses",
    file: "api/console/students/[id]/courses/route.console.ts",
    kind: "route",
    roles: ["student-data"],
    nav: null,
  },
  {
    // ADR-0021: mark or unmark one student as a TEST account, posted from the
    // Test account panel on the Student 360. `student-data`, for the reason
    // the course override above is: it names a student, and it is written
    // from the one page that already requires that role. The mark alone
    // changes nothing a student sees — what it does is decided by the
    // teaching switch, which is `teaching-controls` (`/api/console/teaching`
    // below) — so the safety decision stays with that role and this one only
    // records who is a tester.
    path: "/api/console/students/[id]/tester",
    file: "api/console/students/[id]/tester/route.console.ts",
    kind: "route",
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
    // The operator's own console skin (ADR-0017, FR-1011, migration 024).
    // Posted from the Appearance section of `/profile`, and listed here for
    // the reason every console endpoint is: this table is what the manifest
    // proof and the role matrix enumerate from, and an endpoint is an address.
    //
    // **An empty `roles` list, exactly like the page it sits on.** Any
    // signed-in operator may change the colours of their own console; there is
    // no role for which that is a privilege, and inventing one would mean an
    // operator could be admitted to `/profile` and refused the control on it.
    // What stops it reaching anybody else's row is not a role — it is that the
    // body carries no operator id and the handler writes `WHERE id = $1` from
    // `authorize()` (see the route's own header, and migration 024's).
    path: "/api/console/profile/appearance",
    file: "api/console/profile/appearance/route.console.ts",
    kind: "route",
    roles: [],
    nav: null,
    // The whole effect is this operator's own `operators.design_variant`. See
    // `selfOnly` on the type above for why an empty role list is the decision
    // here rather than an omission.
    selfOnly: true,
  },
  {
    // Migration 023, `lib/catalog.ts`. ⚠ NO REQUIREMENT COVERS THIS ROUTE —
    // no FR has been invented for course availability and `traceability.md`
    // was not touched (see the page's own header). `content-review` because
    // this is the broad per-grade rule, a content decision rather than one
    // about a named student — the same boundary FR-2204 already draws on
    // `/content`. Placed immediately before `/content` so the two content
    // decisions read next to each other in the nav.
    path: "/courses",
    file: "(console)/courses/page.console.tsx",
    roles: ["content-review"],
    nav: "Courses",
  },
  {
    // The write endpoint behind `/courses`. Same role as the page it is
    // posted from, for the reason every console write endpoint in this table
    // is: an address that changes what a course shows a child needs the same
    // authority as the page that offers the control.
    path: "/api/console/courses",
    file: "api/console/courses/route.console.ts",
    kind: "route",
    roles: ["content-review"],
    nav: null,
  },
  {
    path: "/content",
    file: "(console)/content/page.console.tsx",
    roles: ["content-review"],
    nav: "Content review",
  },
  {
    // ADR-0021: the teaching switches — today one, Socratic probing (Off /
    // Test accounts only / Everyone, the last locked until #53).
    //
    // **The PAGE is every operator's; the SWITCH is `teaching-controls`'s.**
    // Reading it discloses no student: the position, who last moved it and
    // when, its history, the deployed release, and how many accounts are
    // marked as testers (their names only for a `student-data` holder, the
    // role that already lists students). Every operator should be able to
    // answer "is the tutor probing right now, and since when?" — it explains
    // a lesson that behaved differently, and the console header says it on
    // every page anyway. Changing it is the endpoint below.
    path: "/teaching",
    file: "(console)/teaching/page.console.tsx",
    roles: [],
    nav: "Teaching",
  },
  {
    // The write behind `/teaching`, and the reason `teaching-controls` exists:
    // Samuel split it out of `content-review` (2026-09-24) so who may change
    // how a child is taught can be narrowed without touching who may review
    // content. A safety control, in ADR-0014's sense.
    path: "/api/console/teaching",
    file: "api/console/teaching/route.console.ts",
    kind: "route",
    roles: ["teaching-controls"],
    nav: null,
  },
  {
    path: "/cost",
    file: "(console)/cost/page.console.tsx",
    roles: ["cost-billing"],
    nav: "Cost",
  },
  // --- Monitor (contracts/admin.md §7, §8; ADR-0016) -----------------------
  {
    // `student-data`: the security record names accounts, students and the
    // operators who read their transcripts. Same role as the Student 360, for
    // the same reason — it is about identifiable people, even though it holds
    // none of their learning.
    path: "/security",
    file: "(console)/security/page.console.tsx",
    roles: ["student-data"],
    nav: "Security",
    navGroup: "Monitor",
  },
  {
    // ALL FOUR roles. The overviews carry no individual content — every cell is
    // a count, a share, a duration or a curriculum label — which is why a role
    // that may not open one student's record may still read the cohort's. That
    // is enforced in `lib/overview-queries.ts`, not by this row.
    path: "/overview",
    file: "(console)/overview/page.console.tsx",
    roles: [],
    nav: "Overviews",
    navGroup: "Monitor",
  },
  {
    // The metric dictionary. Listed separately rather than covered by a prefix
    // rule, because `routeAdmits` is an exact-path lookup and a surface nobody
    // enumerated is the door FR-2107 is about.
    path: "/overview/definitions",
    file: "(console)/overview/definitions/page.console.tsx",
    roles: [],
    nav: "Metric dictionary",
    navGroup: "Monitor",
  },
  {
    // In-product feedback (FR-2808, migration 025).
    //
    // **`student-data`, NOT the overviews' all-four**, and the line is the one
    // contracts/admin.md already draws. The overviews are permitted to every
    // role because every cell in them is a count, a share, a duration or a
    // curriculum label — nothing individual. This page's whole content is the
    // opposite: a named child's own free text, which is exactly the category
    // `student-data` exists for. `cost-billing` reads no student content
    // (FR-2406), and `content-review` must not learn a student's name from a
    // feature (FR-2707's argument, applied again).
    //
    // **Monitor is the right group.** It sits beside Security and Overviews
    // because those three answer the same kind of question — "what is
    // happening across the pilot, and is any of it wrong?" — rather than "tell
    // me about this one person" (Students) or "what may they see" (Courses,
    // Content review). Feedback is the only one of the three that carries a
    // human voice rather than a derived number, and that is an argument for
    // putting it next to them rather than off on its own: an operator who
    // opens Overviews to find out whether the product is working should meet,
    // one link away, the students saying whether it is.
    //
    // LAST in the group, after the metric dictionary, because the
    // dictionary belongs to Overviews — it defines that page's words, and
    // a link between the two would read as a third, unrelated surface
    // wedged into a pair. Nav order is this table's order (`navFor`
    // filters, it never sorts), so position here is the only place it is
    // decided.
    path: "/feedback",
    file: "(console)/feedback/page.console.tsx",
    roles: ["student-data"],
    nav: "Feedback",
    navGroup: "Monitor",
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
  // ADR-0021, 2026-09-24: the console's teaching switches.
  "teaching-controls",
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
