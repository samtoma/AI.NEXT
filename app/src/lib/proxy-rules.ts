/**
 * Which paths the proxy redirects on each build (FR-2201, FR-2205).
 *
 * Pulled out of `proxy.ts` for one reason: `proxy.ts` must not import
 * anything with a database behind it (Next's proxy runs in its own runtime,
 * and Next's own documentation says proxy should not rely on shared
 * modules), so this file does not import `console-routes.ts` — that module
 * type-imports `OperatorRole` from `./db`, and a pure list here is simpler
 * than proving that import stays type-only forever. The console path list
 * below is instead a second, hand-kept statement of the same set
 * `console-routes.ts` enumerates; `proxy-rules.test.mts` and
 * `console-routes.test.mts` are two independent tests of two independent
 * lists, which is deliberate — see `matrix.test.mts` for the same argument
 * made about the roles table.
 *
 * The bug this file fixes: `proxy.ts` used to guard "every matched path, on
 * the console build" — which is right for console paths, but on the console
 * build ALSO redirected anonymous requests to `/student` and `/dashboard`
 * (307 to `/signin`), pre-empting the `(student)/layout.tsx` `notFound()`
 * that is supposed to answer those addresses on the console with a 404. The
 * console build does not serve student paths at all; the proxy must not
 * treat them as its own to protect.
 *
 * `shouldGuard` is pure — no `NextRequest`, no cookies, no I/O — so the
 * redirect decision can be unit-tested without a running server.
 *
 * **F-P2b**: `cookieNames` is re-exported from `./auth/cookie-names.ts` (which
 * imports nothing, so re-exporting it costs this file nothing) purely so
 * `proxy.ts` has ONE relative import for everything surface-shaped — the path
 * guard AND the cookie names it checks for presence of — rather than two
 * separate pure modules to keep in sync by eye. `Surface` below is the same
 * two-value union `cookie-names.ts` exports; kept as its own local type
 * (rather than imported) because it predates that module and nothing here
 * depends on the two staying identical by construction, only by inspection —
 * exactly like `console-routes.ts` and this file's own guarded-path lists,
 * per this header's opening paragraph.
 */

export type Surface = "student" | "admin";

export { cookieNames } from "./auth/cookie-names.ts";

/** The student build's guarded trees. Unaffected by this fix — see F-P2 notes. */
const STUDENT_GUARDED_PATHS = ["/student", "/dashboard"] as const;

/**
 * The console build's guarded trees — every address the console build
 * serves (`console-routes.ts` is the authoritative list; kept in sync by
 * eye and by `proxy-rules.test.mts` asserting each one). `/` is guarded
 * here too: on the console build `/` is the student list, not a public
 * landing page.
 */
const CONSOLE_GUARDED_PATHS = [
  "/",
  "/students",
  "/profile",
  "/content",
  "/cost",
  // The monitoring surfaces (P5, ADR-0016). `/overview` covers
  // `/overview/definitions` through `isPathOrDescendant`.
  "/security",
  "/overview",
  "/pipeline",
  "/gallery",
  "/dev",
] as const;

/** True when `pathname` is exactly `base`, or a descendant of it (`base/…`). */
function isPathOrDescendant(pathname: string, base: string): boolean {
  if (base === "/") return pathname === "/";
  return pathname === base || pathname.startsWith(base + "/");
}

/**
 * Does this build's proxy owe `pathname` a cookie-presence check?
 *
 * `surface: "admin"` guards only the console's own paths — a student path on
 * the console build is not this file's problem; it falls through to the
 * route (or, since the console build does not compile student pages at all,
 * to Next's own 404). `surface: "student"` guards only the two student
 * trees, unchanged from before this fix.
 */
export function shouldGuard(surface: Surface, pathname: string): boolean {
  const paths = surface === "admin" ? CONSOLE_GUARDED_PATHS : STUDENT_GUARDED_PATHS;
  return paths.some((base) => isPathOrDescendant(pathname, base));
}
