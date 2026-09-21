import type { NextConfig } from "next";

/**
 * Two build targets from one codebase (ADR-0014, plan A4, research R9).
 *
 * `AINEXT_SURFACE` decides which route files are routes at all. It is read
 * directly from `process.env` here rather than through `lib/env.ts` because a
 * Next config is loaded before the application's module graph exists;
 * `lib/env.ts` owns the same resolution for everything that runs after, and
 * `SURFACE_VALUES` below is the single list both agree on.
 *
 * **Why `pageExtensions` and not a `notFound()` layout.** FR-2201 is a
 * *build-scope* obligation — the console's addresses "MUST NOT resolve in that
 * build, so a guessed or shared URL reaches nothing". A runtime guard answers a
 * different question. With the console's files named `page.console.tsx` /
 * `layout.console.tsx` / `route.console.ts`, the student build does not see
 * them as routes: they never reach the route manifest, so FR-2201 is provable
 * from a build artefact (`npm run check:surface`) rather than from a promise
 * about a code path.
 *
 * **The student root page carries a suffix too, and this is the one place the
 * asymmetry breaks down.** Both builds want a page at `/`: the student build
 * wants the product's landing page, the console build wants the student list.
 * Two `page` files resolving to `/` is a hard Next build error, not a
 * precedence rule — so `app/(student)/page.student.tsx` is excluded from the
 * admin build by exactly the mechanism that excludes the console from the
 * student build. Every OTHER student route keeps an ordinary name and is
 * excluded at runtime by `(student)/layout.tsx`, as R9 describes.
 *
 * **The documented trap**: `pageExtensions` governs `proxy.ts` and
 * `instrumentation.ts` too. Both lists keep `tsx` and `ts`, so those keep
 * resolving; dropping the defaults from either list silently disables the
 * proxy.
 *
 * `distDir` differs so the two `next build` runs do not clobber each other and
 * `next start` serves the artefact its own config points at.
 */

const SURFACE_VALUES = ["student", "admin"] as const;
type Surface = (typeof SURFACE_VALUES)[number];

function surface(): Surface {
  const raw = (process.env.AINEXT_SURFACE ?? "").trim().toLowerCase();
  if (!raw) return "student";
  if ((SURFACE_VALUES as readonly string[]).includes(raw)) return raw as Surface;
  throw new Error(
    `AINEXT_SURFACE="${raw}" is not one of ${SURFACE_VALUES.join(" | ")}. ` +
      `Refusing to build rather than produce a surface nobody asked for.`
  );
}

const SURFACE = surface();

const nextConfig: NextConfig = {
  pageExtensions:
    SURFACE === "admin"
      ? ["console.tsx", "console.ts", "tsx", "ts"]
      : ["student.tsx", "tsx", "ts"],
  distDir: SURFACE === "admin" ? ".next-admin" : ".next",
};

export default nextConfig;
