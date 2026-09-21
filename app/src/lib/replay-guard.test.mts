/**
 * @covers FR-2305
 *
 * **Read-only is a contract, not an intention** (contracts/admin.md §5).
 *
 * A replay opens no path that writes an attempt, moves a mastery estimate,
 * calls the AI runtime, or emits an event attributed to the student. That is a
 * claim about a whole module graph, and a claim about a module graph decays the
 * moment somebody adds a convenient import — which is exactly how it would
 * break, six months from now, in a commit whose message says "reuse the
 * question card".
 *
 * So the graph is walked. Starting from the replay page, every local import is
 * followed transitively, and the closure is checked for two different kinds of
 * reach:
 *
 *  1. **An import of a write path** — `api/ask`, `api/attempts`,
 *     `api/understanding`, `api/uploads`, `lib/analytics` (`emit`) or
 *     `lib/sessions`.
 *  2. **A literal `/api/…` URL anywhere in the closure.** This is the one that
 *     matters in practice: `ChatCore` reaches `/api/ask` through
 *     `fetch("/api/ask")` and `ChatQuestionCard` reaches `/api/attempts` the
 *     same way. Neither is an import, so an import-only check would pass while
 *     the replay carried the answering machinery. The reason the replay renders
 *     its own answered card instead of reusing `ChatQuestionCard` is this
 *     assertion.
 *
 * **What this cannot prove.** It does not prove no write happens — the page
 * writes one row deliberately, the `operator_reads` audit, attributed to the
 * operator and not to the student. It proves the student-facing write paths are
 * unreachable from this page's code. The row-count half of the claim is the
 * live smoke test's: attempts, interactions, mastery and analytics rows for the
 * student must be identical before and after opening a replay.
 *
 * Deliberately a source walk rather than a bundler plugin: it runs under
 * `node --test` in a second, with no build, and it reads the same files a
 * reviewer would.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const HERE = dirname(fileURLToPath(import.meta.url));
/** `app/src` — the root `@/` resolves to. */
const SRC = resolve(HERE, "..");

const ENTRY = join(SRC, "app/(console)/students/[id]/sessions/[sid]/replay/page.console.tsx");

/** Import specifiers no module in the replay's graph may name. */
const FORBIDDEN_IMPORTS = [
  "api/ask",
  "api/attempts",
  "api/understanding",
  "api/uploads",
  "lib/analytics",
  "lib/sessions",
];

/** Any endpoint at all, as a string literal. A replay calls none. */
const API_URL = /["'`]\/api\//;

/**
 * Comments out, code in.
 *
 * Half this repository's modules explain themselves by naming the routes they
 * do or do not touch — including the replay page, whose header exists to say it
 * reaches none of them. Checking raw source would fail on the sentence making
 * the promise, which is the most self-defeating possible test. The `[^:]` guard
 * keeps `https://` from being read as the start of a line comment.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

const EXTENSIONS = [".ts", ".tsx", ".mts", "/index.ts", "/index.tsx"];

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

function specifiersIn(source: string): string[] {
  const out: string[] = [];
  for (const re of [IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) out.push(m[1]!);
  }
  return out;
}

/** A local file path for this specifier, or null for a bare package. */
function resolveLocal(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(fromFile), specifier);
  else return null; // react, next, pg, katex — not ours to walk

  for (const candidate of [base, ...EXTENSIONS.map((e) => base + e)]) {
    try {
      const text = readFileSync(candidate, "utf8");
      // A directory read throws EISDIR, so a successful read is a file.
      void text;
      return candidate;
    } catch {
      // try the next extension
    }
  }
  return null;
}

/** Every local module reachable from `entry`, with its source. */
function closure(entry: string): Map<string, string> {
  const seen = new Map<string, string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    const source = readFileSync(file, "utf8");
    seen.set(file, source);
    for (const spec of specifiersIn(source)) {
      const next = resolveLocal(spec, file);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

const GRAPH = closure(ENTRY);
const rel = (f: string) => f.slice(SRC.length + 1);

test("the replay's import graph is non-trivial and includes the student renderers", () => {
  // A walker that resolved nothing would pass every assertion below. This is
  // the check on the check: the replay MUST be reaching the student's own
  // message renderer and widget dispatch, because reusing them is the point.
  const files = [...GRAPH.keys()].map(rel);
  assert.ok(files.length > 10, `walked only ${files.length} files — the resolver is broken`);
  assert.ok(
    files.some((f) => f === "components/chat/message-blocks.tsx"),
    "the replay must render through the student's own message renderer"
  );
  assert.ok(
    files.some((f) => f === "components/student/widgets/render-math-widget.tsx"),
    "the replay must render widgets through the student's own dispatch"
  );
  assert.ok(
    files.some((f) => f === "components/student/ReportCard.tsx"),
    "the replay must render understanding checks through the student's own report card"
  );
});

test("no module reachable from the replay imports a student write path", () => {
  const offences: string[] = [];
  for (const [file, source] of GRAPH) {
    for (const spec of specifiersIn(stripComments(source))) {
      for (const bad of FORBIDDEN_IMPORTS) {
        if (spec.includes(bad)) offences.push(`${rel(file)} imports ${spec}`);
      }
    }
  }
  assert.deepEqual(
    offences,
    [],
    "a replay must not be able to reach a path that writes an attempt, a turn, a session or an event attributed to the student"
  );
});

test("no module reachable from the replay names an API endpoint at all", () => {
  // `fetch("/api/attempts")` is not an import, and it is how the student's
  // question card submits an answer. An import-only guard would miss it.
  const offences: string[] = [];
  for (const [file, source] of GRAPH) {
    if (API_URL.test(stripComments(source))) offences.push(rel(file));
  }
  assert.deepEqual(
    offences,
    [],
    "a module in the replay's graph names an endpoint; the replay calls none"
  );
});

test("the replay page itself writes exactly one thing, and it is the audit row", () => {
  const page = GRAPH.get(ENTRY)!;
  assert.match(
    page,
    /recordOperatorRead/,
    "opening a replay must write its operator_reads row (FR-2306)"
  );
  assert.match(
    page,
    /surface: "session_replay"/,
    "the audit row must name the surface that was opened"
  );
  // The only database call the page makes is the read model's, and that
  // function is a read plus the audit row. Nothing else here talks to a pool.
  assert.equal(
    /withPrincipal|withMaint|INSERT INTO|UPDATE /.test(page),
    false,
    "the replay page must not carry a write of its own"
  );
});

test("the replay is labelled a reconstruction, persistently", () => {
  // FR-2304: labelled a reconstruction WHEREVER it appears, and never
  // presented as a recording of the screen. Asserted on the source because the
  // banner is the whole honesty of the surface and a refactor could drop it
  // without any other test noticing.
  const page = GRAPH.get(ENTRY)!;
  assert.match(page, /Reconstructed from stored records/);
  assert.match(page, /sticky/, "the label must not scroll out of the reader's view");
  assert.match(
    GRAPH.get(join(SRC, "components/console/ReplayTranscript.tsx"))!,
    /reconstructed/i,
    "each turn carries the mark too, not only the page"
  );
});
