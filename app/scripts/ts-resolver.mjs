/**
 * Minimal resolver hook so plain `node` (type-stripping) can run scripts that
 * import the app's lib modules, which use extensionless relative imports
 * (`./db`). Maps a failing relative specifier to `.ts`/`.tsx`/`/index.ts`.
 *
 *   node --import ./scripts/ts-resolver.mjs scripts/capture-prompts.mts …
 */
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (
        (specifier.startsWith("./") || specifier.startsWith("../")) &&
        context.parentURL
      ) {
        const base = new URL(specifier, context.parentURL).href;
        for (const suffix of [".ts", ".tsx", ".mts", "/index.ts"]) {
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
