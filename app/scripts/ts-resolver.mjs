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
 */
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

/** `app/src/`, the target of tsconfig's `"@/*": ["./src/*"]`. */
const SRC = pathToFileURL(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src") + path.sep
).href;

const SUFFIXES = [".ts", ".tsx", ".mts", "/index.ts"];

/** The first candidate that exists on disk, or null. */
function firstExisting(baseHref) {
  for (const suffix of ["", ...SUFFIXES]) {
    const candidate = baseHref + suffix;
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
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
