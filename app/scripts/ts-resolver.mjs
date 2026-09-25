/**
 * Minimal resolver hook so plain `node` (type-stripping) can run scripts that
 * import the app's lib modules, which use extensionless relative imports
 * (`./db`). Maps a failing relative specifier to `.ts`/`.tsx`/`/index.ts`.
 *
 *   node --import ./scripts/ts-resolver.mjs scripts/capture-prompts.mts …
 *
 * **It also resolves the `@/` alias**, added when `alerts-sweep.mts` needed
 * `lib/mail.ts` (P5) — the first script to reach a module that imports through
 * the alias rather than relatively. `tsconfig.json` maps `@/*` to `src/*` for
 * the bundler and the type checker; plain `node` knows nothing about either, so
 * without this a standalone script fails with "Cannot find package '@/lib'"
 * from a file it never wrote. The mapping below is the same one, applied at
 * resolve time, and it is deliberately hard-coded to this repo's layout rather
 * than parsed out of `tsconfig.json`: a resolver hook that had to read and
 * interpret a JSON config before the first import would be a second, subtler
 * place for the alias to be wrong.
 *
 * **It also substitutes `next/headers` — but only for the capture harness.**
 * `lib/auth/principal.ts` imports `cookies` from `next/headers` at the top
 * level, so importing `lib/lesson.ts` from plain `node` died on a framework
 * module with no request behind it. That single unresolvable import is why
 * every constitution IX gate up to P5 reported "fails identically at HEAD": the
 * harness could not run at all, on either side of the comparison, so there was
 * never a diff to read. `scripts/stubs/next-headers.mjs` answers with an empty
 * cookie jar — the anonymous principal the harness already asks for by passing
 * `studentId = null`.
 *
 * The substitution is gated on the ENTRYPOINT, not on the resolver being
 * loaded. A script that talks to real data (`rollup-cost-daily`,
 * `bootstrap-operator`, `alerts-sweep`, `seed-local-account`) must never be
 * handed a fake auth primitive just because it shares this hook, and a stub
 * that silently applies to the next script somebody writes is a trap. Adding an
 * entrypoint is one line below, deliberately.
 */
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** `app/src/`, the target of tsconfig's `"@/*": ["./src/*"]`. */
const SRC = pathToFileURL(path.join(HERE, "..", "src") + path.sep).href;

/**
 * Bare specifiers replaced by a local stub, and the entrypoints allowed to see
 * them. Keyed by specifier → { stub, entrypoints }, matched on the basename of
 * `process.argv[1]` so the gate reads the same whether the script was invoked
 * by relative or absolute path.
 */
const STUBS = {
  "next/headers": {
    stub: pathToFileURL(path.join(HERE, "stubs", "next-headers.mjs")).href,
    entrypoints: [
      "capture-prompts.mts",
      // renders the same prompt builders for each address register, and
      // reaches `lib/lesson.ts` -> `auth/principal.ts` to do it (P6)
      "prompt-address.test.mts",
      // drives `getLessonCatalog` / `getLessonData` / `getSubjectSummaries`
      // against a fake PoolClient to prove the course gate is wired in, and
      // reaches the same `lib/lesson.ts` -> `auth/principal.ts` import. It
      // resolves no principal of its own: the student id is a parameter, so
      // the empty cookie jar is never consulted.
      "catalog-gate.test.mts",
      // drives the real `getLessonCatalog` against a fake PoolClient and feeds
      // its output to `decideLanding`, so that "a student with no visible
      // course lands on her home rather than a 404" is proved from the
      // availability rows outwards. Same `lib/lesson.ts` ->
      // `auth/principal.ts` import, same reason it needs no real principal:
      // the student id is a parameter.
      "student-landing.test.mts",
      // renders `learnPrompt` with Socratic probing off and on (ADR-0021:
      // the lesson's snapshot is an argument now, not a constant). Same
      // `lib/lesson.ts` -> `auth/principal.ts` import; no principal.
      "socratic-probing.test.mts",
      // renders `learnPrompt` / `reviewPrompt` for three subjects × four
      // address forms with probing off and compares them, whole, against the
      // pre-toggle capture (ADR-0021). Same import chain; no principal.
      "probing-prompts.test.mts",
      // drives the REAL `currentSession` (lib/sessions.ts) against a fake
      // PoolClient to prove the per-lesson snapshot is resolved once, stored,
      // and handed back on reuse (ADR-0021). Reaches `lib/student-context.ts`
      // -> `auth/principal.ts`; the student id is a parameter, no principal.
      "teaching-snapshot.test.mts",
      // drives the REAL `lessonCourseId` and `getLessonData` against a fake
      // PoolClient to prove the session's probing snapshot and the prompt's
      // narrowing resolve a lesson's course the same way (fix pass 2). Same
      // `lib/lesson.ts` -> `auth/principal.ts` import; no principal.
      "lesson-course.test.mts",
      // drives the REAL `getStudentPlan` (lib/queries.ts) over a fake
      // PoolClient to prove catalogue order breaks the plan's ties (FR-3217).
      // Reaches `lib/student-context.ts` -> `auth/principal.ts`; the student
      // id is a parameter, no principal.
      "student-plan-order.test.mts",
      // runs the REAL `getStudentPlan`, `getTopicBreakdown` and
      // `getGalleryData`, and `LO_MODULE_SELECT`, against a scratch database
      // (opt-in, FR-3217). Same import chain; the student id is a parameter.
      "catalogue-order-db.test.mts",
      // drives the REAL `buildAskContext` (lib/ask.ts) over a fake PoolClient
      // to prove the ask context's order (FR-3217). Reaches
      // `lib/student-context.ts` -> `auth/principal.ts`; the student id is a
      // parameter, no principal.
      "ask-order.test.mts",
    ],
  },
};

/** The basename of the script node was asked to run ("" when there is none). */
const ENTRYPOINT = path.basename(process.argv[1] ?? "");

const SUFFIXES = [".ts", ".tsx", ".mts", "/index.ts"];

/** The first candidate that exists on disk, or null. */
function firstExisting(baseHref) {
  for (const suffix of ["", ...SUFFIXES]) {
    const candidate = baseHref + suffix;
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  return null;
}

/** The stub URL for `specifier`, when this entrypoint is allowed one. */
export function stubFor(specifier, entrypoint = ENTRYPOINT) {
  const rule = STUBS[specifier];
  return rule && rule.entrypoints.includes(entrypoint) ? rule.stub : null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    // Framework modules with no request behind them, for the entrypoints that
    // declared they have none. Checked first: `next/headers` DOES resolve as a
    // package on disk, so leaving it to the catch below would never fire.
    const stub = stubFor(specifier);
    if (stub) return nextResolve(stub, context);

    // The alias is handled BEFORE nextResolve rather than in its catch: node
    // treats `@/lib/mail` as a bare package specifier and the error it throws
    // names a package that does not exist, which is a confusing thing to
    // recover from. Rewriting first makes it an ordinary file URL.
    if (specifier.startsWith("@/")) {
      const resolved = firstExisting(SRC + specifier.slice(2));
      if (resolved) return nextResolve(resolved, context);
    }
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (
        (specifier.startsWith("./") || specifier.startsWith("../")) &&
        context.parentURL
      ) {
        const base = new URL(specifier, context.parentURL).href;
        for (const suffix of SUFFIXES) {
          const candidate = base + suffix;
          if (existsSync(fileURLToPath(candidate))) {
            return nextResolve(candidate, context);
          }
        }
      }
      throw err;
    }
  },
});
