/**
 * Dependency-free `.env` loader for standalone `node` scripts.
 *
 * `next dev` / `next build` load `app/.env.local` then `app/.env` for you.
 * A bare `node scripts/x.mts` does neither, so anything that calls
 * `withMaint()` (lib/db.ts) fails closed with "DATABASE_URL_MAINT is not
 * set" — the operator/maintenance DSNs live only in `.env.local`.
 * `scripts/local-dev.sh` works around this for its own callers by exporting
 * the DSNs inline (`run_app_script`, ~L307); this is the loader for
 * everyone else — a person at a terminal, cron, or CI.
 *
 * Usage — as a `--import` preload, in front of the type-stripping resolver:
 *
 *   node --import ./scripts/load-env.mjs --import ./scripts/ts-resolver.mjs scripts/rollup-cost-daily.mts
 *
 * Precedence, lowest to highest:
 *
 *   app/.env  <  app/.env.local  <  a variable already in process.env
 *
 * A variable already exported in the shell (or set by
 * `scripts/local-dev.sh`'s inline exports) is never overridden — this
 * loader only ever fills in what is missing. `.env.local` is read before
 * `.env` so its values claim the "missing" slot first, matching Next's own
 * `.env.local`-wins-over-`.env` convention.
 *
 * The parsing (`parseEnv`) and the "fill what's missing" merge (`applyEnv`)
 * are exported as pure functions — neither touches the filesystem or
 * `process.env` unless you pass it one — so `load-env.test.mts` can drive
 * them with fixture strings and a plain object instead of real files.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Parse `.env`-file text into a plain object. Last assignment of a given
 * key within the text wins (matches how a shell would source it).
 *
 * Supported per line, everything else is ignored rather than rejected —
 * an unparsed line in a `.env` file is not a reason to crash a rollup:
 *   - `KEY=value`            (an optional leading `export ` is stripped)
 *   - blank lines and lines whose first non-space character is `#`
 *   - `KEY="value with \n \" \\ escapes"`   (double quotes: escapes decoded)
 *   - `KEY='literal value'`                (single quotes: no escaping)
 *   - `KEY=bare value # trailing comment`  (unquoted only)
 *
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseEnv(text) {
  /** @type {Record<string, string>} */
  const result = {};
  const lines = text.split(/\r\n|\n|\r/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const body = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const eq = body.indexOf("=");
    if (eq === -1) continue;

    const key = body.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = body.slice(eq + 1).trim();

    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value
        .slice(1, -1)
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    } else {
      const commentAt = value.indexOf(" #");
      if (commentAt !== -1) value = value.slice(0, commentAt).trim();
    }

    result[key] = value;
  }

  return result;
}

/**
 * Copy `parsed` into `target` (defaults to `process.env`), skipping any key
 * `target` already has — an already-set value, however it got set, always
 * wins. Returns the keys that were actually newly set, for callers that
 * want to say what happened.
 *
 * `target`'s type is deliberately the loose `Record<string, string |
 * undefined>` rather than `NodeJS.ProcessEnv` — Next augments the latter
 * with a required `NODE_ENV`, which would force every test's fixture
 * object to carry one just to satisfy the type checker.
 *
 * @param {Record<string, string>} parsed
 * @param {Record<string, string | undefined>} [target]
 * @returns {string[]}
 */
export function applyEnv(parsed, target = process.env) {
  /** @type {string[]} */
  const set = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (target[key] === undefined) {
      target[key] = value;
      set.push(key);
    }
  }
  return set;
}

/* --------------------------------------------------------- the preload */

const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadFileInto(filePath, target) {
  if (!existsSync(filePath)) return;
  applyEnv(parseEnv(readFileSync(filePath, "utf8")), target);
}

// .env.local first: its values claim the "not yet set" slot ahead of .env,
// and neither ever overrides a variable the shell already exported.
loadFileInto(path.join(APP_DIR, ".env.local"), process.env);
loadFileInto(path.join(APP_DIR, ".env"), process.env);
