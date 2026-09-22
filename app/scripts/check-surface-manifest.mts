/**
 * FR-2201, proved from a build artefact rather than from a promise.
 *
 *   node --experimental-strip-types scripts/check-surface-manifest.mts student
 *   node --experimental-strip-types scripts/check-surface-manifest.mts admin
 *
 * (or `npm run check:surface` / `npm run check:surface:admin`.)
 *
 * The requirement is that the console's addresses **MUST NOT resolve** in the
 * student build — "so a guessed or shared URL reaches nothing". A `notFound()`
 * layout is a runtime assertion about a code path; Next's own
 * `app-path-routes-manifest.json` is the list of routes the build actually
 * contains. This reads that list and refuses if it disagrees with
 * `src/lib/console-routes.ts`.
 *
 * **Why the manifest and not the build log.** The log is a rendering for a
 * human; the manifest is the map the server routes from, and it carries the
 * source file beside the URL (`"/(console)/cost/page": "/cost"`). That second
 * half is what makes the student-side assertion strong: `/` exists in both
 * builds, and the only way to tell the student landing page from the console's
 * student list is which file the manifest says answers it.
 *
 * Both directions are checked, because only checking the negative one would
 * pass on a build that shipped no console at all.
 *
 * **Endpoints are routes too.** `CONSOLE_ROUTES` carries the console's API
 * handlers (`kind: "route"`, files named `route.console.ts`) beside its pages,
 * and this file needs no special case for them: the manifest lists a handler
 * as `"/api/…/route": "/api/…"` exactly as it lists a page, and the expected
 * source path below derives the same way for both. A console endpoint that
 * resolved in the student build would be the same FR-2201 failure as a console
 * page doing so, and is caught by the same assertion.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CONSOLE_ROUTES } from "../src/lib/console-routes.ts";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type Surface = "student" | "admin";

const arg = (process.argv[2] ?? process.env.AINEXT_SURFACE ?? "student").trim().toLowerCase();
if (arg !== "student" && arg !== "admin") {
  fail(`usage: check-surface-manifest.mts <student|admin> (got "${arg}")`);
}
const surface = arg as Surface;
const distDir = surface === "admin" ? ".next-admin" : ".next";

const manifestPath = join(APP_DIR, distDir, "app-path-routes-manifest.json");
let manifest: Record<string, string>;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, string>;
} catch {
  fail(
    `no route manifest at ${distDir}/app-path-routes-manifest.json.\n` +
      `Build that surface first:  ${
        surface === "admin" ? "AINEXT_SURFACE=admin npm run build" : "npm run build"
      }`
  );
}

/** URL -> the source file the manifest says answers it. */
const answeredBy = new Map<string, string[]>();
for (const [file, url] of Object.entries(manifest!)) {
  answeredBy.set(url, [...(answeredBy.get(url) ?? []), file]);
}

const problems: string[] = [];
const checked: string[] = [];

const CONSOLE_KEY = "/(console)/";

/**
 * Student-build-only routes that live OUTSIDE the `(student)` group, so the
 * group layout's `notFound()` does not cover them and only a suffixed filename
 * can exclude them at build time.
 *
 * `/signup` is the whole list. It sits in the `(auth)` group, which is shared
 * because both builds sign somebody in — but only one of them lets anybody
 * register. Operators are **seeded or granted, never self-registered**
 * (contracts/auth.md "Operator authentication", ADR-0014): a signup form on the
 * console build would create a `students` account against an `accounts` row, on
 * the surface whose entire purpose is that student credentials do not work
 * there. It is `page.student.tsx` for that reason, and this asserts it in both
 * directions.
 */
const STUDENT_ONLY = ["/signup"] as const;

if (surface === "student") {
  // 1. No console SOURCE file is a route here, whatever URL it would answer.
  for (const [file, url] of Object.entries(manifest!)) {
    if (file.startsWith(CONSOLE_KEY)) {
      problems.push(`console source ${file} is a route in the student build (as ${url})`);
    }
  }

  // 2. No console URL resolves — except `/`, which this build answers with the
  //    product's landing page. `sharedPath` is exactly that exception and is
  //    checked by file below rather than skipped.
  for (const route of CONSOLE_ROUTES) {
    if (route.sharedPath) continue;
    const files = answeredBy.get(route.path);
    if (files) {
      problems.push(`console URL ${route.path} resolves in the student build (${files.join(", ")})`);
    } else {
      checked.push(`${route.path} absent`);
    }
  }

  // 3. The shared paths are answered by the STUDENT file, not the console one.
  for (const route of CONSOLE_ROUTES.filter((r) => r.sharedPath)) {
    const files = answeredBy.get(route.path) ?? [];
    if (files.some((f) => f.startsWith(CONSOLE_KEY))) {
      problems.push(`${route.path} is answered by a console file in the student build`);
    } else if (files.length === 0) {
      problems.push(`${route.path} resolves to nothing in the student build`);
    } else {
      checked.push(`${route.path} answered by ${files.join(", ")}`);
    }
  }

  // 4. The student product is still here. A build that excluded the console by
  //    excluding everything would otherwise pass every assertion above.
  for (const url of ["/student", "/dashboard", "/spine", "/signin", ...STUDENT_ONLY]) {
    if (!answeredBy.has(url)) problems.push(`student URL ${url} is missing from the student build`);
    else checked.push(`${url} present`);
  }
} else {
  // Every console route exists, at the URL the table names, from the file the
  // table names. A row whose file moved without its path being updated is the
  // failure this catches.
  for (const route of CONSOLE_ROUTES) {
    const expected = "/" + route.file.replace(/\.tsx?$/, "").replace(".console", "");
    const files = answeredBy.get(route.path) ?? [];
    if (files.length === 0) {
      problems.push(`console URL ${route.path} does not resolve in the console build`);
    } else if (!files.includes(expected)) {
      problems.push(
        `console URL ${route.path} is answered by ${files.join(", ")}, not by ${expected}`
      );
    } else {
      checked.push(`${route.path} <- ${expected}`);
    }
  }

  // The SIGN-IN page exists on both builds: the console authenticates its
  // operators through the same form and the same endpoint (ADR-0014).
  if (!answeredBy.has("/signin")) problems.push("/signin is missing from the console build");
  else checked.push("/signin present");

  // SIGN-UP does not, and this is the assertion that keeps it that way.
  for (const url of STUDENT_ONLY) {
    const files = answeredBy.get(url);
    if (files) {
      problems.push(`${url} resolves in the console build (${files.join(", ")})`);
    } else {
      checked.push(`${url} absent`);
    }
  }
}

if (problems.length > 0) {
  console.error(`\n✗ surface manifest check FAILED for the ${surface} build (${distDir})\n`);
  for (const p of problems) console.error(`  · ${p}`);
  console.error(
    `\nFR-2201: the console's addresses must not resolve in the student build. ` +
      `The route table is app/src/lib/console-routes.ts.\n`
  );
  process.exit(1);
}

console.log(
  `✓ surface manifest check passed for the ${surface} build (${distDir}) — ` +
    `${checked.length} assertions:`
);
for (const c of checked) console.log(`    ${c}`);

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}
