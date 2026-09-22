/**
 * **A student's feedback never reaches the model** — asserted against the
 * source rather than promised in a comment.
 *
 * @covers FR-2802
 *
 * ---------------------------------------------------------------------------
 * WHAT IS BEING PROTECTED, AND FROM WHAT
 * ---------------------------------------------------------------------------
 * `feedback.note` is free text written by a fourteen-year-old at the end of a
 * study session, sometimes straight after being told what she did not
 * understand. It is her opinion of US. It is not learning material, it is not
 * a signal about her mastery, and it is not context for a tutor turn.
 *
 * The failure this guards against is somebody, in six months, adding the last
 * three notes to `retrievalBlock` because it looked like the obvious way to
 * make the tutor "responsive to how the student feels". That single change
 * would put a child's private complaint about the product into the product's
 * own prompt — where it would be paraphrased back at her, cached under a
 * session key, written to `ai_interactions` as prompt text, and billed. It is
 * the kind of change that is one line, reads as kindness, and is wrong.
 *
 * This file is shaped like `lib/plan-gate.test.mts` and
 * `lib/subscription-gate.test.mts` on purpose: same scan, same
 * comment-stripper, same counterweight. It adds one thing neither of those
 * needs — an import-graph walk — because the thing being kept out is a MODULE
 * rather than a column name, and a module can be reached without being named.
 *
 * ---------------------------------------------------------------------------
 * COMMENTS ARE STRIPPED BEFORE SCANNING
 * ---------------------------------------------------------------------------
 * The whole point of this repository's style is that the reason lives beside
 * the code, and several prompt modules will want to say "feedback never
 * arrives here". A scan that counted sentences would make writing that down a
 * build failure. What is scanned is CODE. The stripper is
 * `design-variant-scan.test.mts`'s, copied with its reasoning: block comments
 * and whole comment lines go, a TRAILING `// …` stays, because deciding where
 * `//` stops being part of a string literal is how a scan quietly covers less
 * than it claims to.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const LIB = join(SRC, "lib");
const APP = join(SRC, "app");

/** The module that owns every statement touching the `feedback` table. */
const OWNER = join(LIB, "feedback-queries.ts");

/** This file. It quotes the SQL fragments it forbids, so it excludes itself. */
const SELF = fileURLToPath(import.meta.url);

/**
 * Every module that builds text a model will read, and every route that sends
 * one.
 *
 * The five library modules are the prompt builders `prompt-address.test.mts`
 * already enumerates (`lesson.ts`'s learn/review prompts, `ask.ts`'s system
 * prompt, `checkin.ts`'s opening frame, `retrieval.ts`'s bundle,
 * `understanding-prompt.ts`'s grader) plus the three that build model-visible
 * text for the other surfaces: the photograph prompt, the figure directives,
 * and the grounded-explanation path. `session-cache.ts` is here because a
 * cache key is not a prompt but a cached PREFIX is, and a note folded into one
 * would outlive the turn that carried it.
 *
 * The three routes are every path that calls a model on a student's behalf.
 */
const PROMPT_MODULES = [
  join(LIB, "retrieval.ts"),
  join(LIB, "ask.ts"),
  join(LIB, "lesson.ts"),
  join(LIB, "checkin.ts"),
  join(LIB, "understanding-prompt.ts"),
  join(LIB, "upload-prompt.ts"),
  join(LIB, "viz-prompt.ts"),
  join(LIB, "explanations.ts"),
  join(LIB, "session-cache.ts"),
  join(APP, "api/ask/route.ts"),
  join(APP, "api/understanding/route.ts"),
  join(APP, "api/uploads/route.ts"),
];

/** Every spelling the note could be reached by, in SQL and in TypeScript. */
const FORBIDDEN = [
  "feedback-queries",
  "feedback-rules",
  "FeedbackNote",
  "feedbackContext",
  "recordFeedback",
  "dismissFeedback",
  "studentFeedback",
  "FROM feedback",
  "INTO feedback",
];

/** Comments removed — see the header. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("//") && !t.startsWith("*");
    })
    .join("\n");
}

/**
 * Resolve one import specifier to a file on disk, or null when it is not ours.
 *
 * Handles the two forms this codebase uses — the `@/` alias and a relative
 * path — and the extensions Next allows to be omitted. A bare package name
 * (`pg`, `react`) returns null: `node_modules` cannot reach `lib/` and walking
 * it would take minutes.
 */
function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null;

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && !candidate.endsWith("/")) {
      try {
        if (readFileSync(candidate).length >= 0) return candidate;
      } catch {
        // a directory that exists but is not a file — keep looking
      }
    }
  }
  return null;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+["']([^"']+)["']/g;
const DYNAMIC_RE = /import\(\s*["']([^"']+)["']\s*\)/g;

/** Every module reachable from `entry`, following our own imports only. */
function importClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    let src: string;
    try {
      src = code(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    for (const re of [IMPORT_RE, DYNAMIC_RE]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const target = resolveImport(file, m[1]!);
        if (target && !seen.has(target)) queue.push(target);
      }
    }
  }
  return seen;
}

test("the scan is pointed at files that exist", () => {
  // A path that has been renamed turns this whole file into a test of nothing,
  // and it would still be green. Assert the target set before trusting it.
  for (const file of [OWNER, ...PROMPT_MODULES]) {
    assert.ok(existsSync(file), `${file.slice(SRC.length)} is gone — this scan covers less than it claims`);
  }
});

test("no prompt-building module can reach the module that reads feedback", () => {
  // The strongest assertion here, and the reason this file is not only a grep:
  // `feedback-queries.ts` could be reached WITHOUT being named — through
  // `console-queries.ts`, which legitimately imports it for the Student 360 —
  // and a prompt module that picked up that edge would have the note in scope
  // while mentioning nothing forbidden.
  const offenders: string[] = [];
  for (const entry of PROMPT_MODULES) {
    if (importClosure(entry).has(OWNER)) {
      offenders.push(entry.slice(SRC.length));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "FR-2802: a student's feedback is her opinion of the product, not learning material.\n" +
      "These modules build text a model reads, and lib/feedback-queries.ts is reachable from\n" +
      "them — which means the note is one property access away from a prompt. If the import\n" +
      "is for something else in that module, split the module; do not widen this list."
  );
});

test("no prompt-building module and no model route mentions feedback at all", () => {
  const offenders: string[] = [];
  for (const file of PROMPT_MODULES) {
    const src = code(readFileSync(file, "utf8"));
    for (const needle of FORBIDDEN) {
      if (src.includes(needle)) {
        offenders.push(`${file.slice(SRC.length)} mentions ${needle}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "FR-2802: the note never reaches a model — not in a prompt, not in retrievalBlock,\n" +
      "not in a cached prefix, not in the ask data block. It is what a child thinks of US."
  );
});

test("the retrieval bundle's input type has no slot a note could arrive in", () => {
  // The grep above catches the name; this catches the SHAPE. `retrievalBlock`
  // is the one function every surface's prompt goes through (see
  // `prompt-address.test.mts`), so a field added to its input is a field added
  // to every prompt at once — and it would not have to be called "feedback"
  // to carry one.
  const src = code(readFileSync(join(LIB, "retrieval.ts"), "utf8"));
  const start = src.indexOf("export type RetrievalBundle");
  assert.ok(start > 0, "RetrievalBundle is gone or renamed — this test is now checking nothing");
  const end = src.indexOf("};", start);
  const body = src.slice(start, end);
  for (const needle of ["feedback", "rating", "thumb", "note"]) {
    assert.ok(
      !body.toLowerCase().includes(needle),
      `RetrievalBundle gained a "${needle}" field. Every prompt in the product reads this ` +
        `bundle; a student's verdict on us must not be one of the things it carries.`
    );
  }
});

test("only one module in the whole of src/ writes or reads the feedback table", () => {
  // The import-graph test asserts that the prompt modules cannot reach THIS
  // file. That claim is only worth anything while this file is the only one
  // there is — a second reader somewhere else would make the test pass and the
  // property false.
  const offenders: string[] = [];
  for (const file of allSourceFiles(SRC)) {
    if (file === OWNER || file === SELF) continue;
    const src = code(readFileSync(file, "utf8"));
    if (/\b(FROM|INTO|UPDATE|DELETE FROM)\s+feedback\b/.test(src)) {
      offenders.push(file.slice(SRC.length));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "lib/feedback-queries.ts is supposed to be the only module that touches the table.\n" +
      "Put the query there and import it, or the import-graph guard above stops meaning\n" +
      "anything."
  );
});

test("the console DOES read it, so this cannot pass by the feature being gone", () => {
  // The counterweight `plan-gate.test.mts` and `subscription-gate.test.mts`
  // both carry: a guard that would still be green if the feature were deleted
  // is not a guard.
  const owner = code(readFileSync(OWNER, "utf8"));
  assert.ok(owner.includes("FROM feedback"), "feedback-queries no longer reads the table");
  assert.ok(owner.includes("INTO feedback"), "feedback-queries no longer writes the table");

  const console360 = code(readFileSync(join(LIB, "console-queries.ts"), "utf8"));
  assert.ok(
    console360.includes("studentFeedback"),
    "the Student 360 no longer shows this student's notes — the human path is the surface"
  );

  const page = readFileSync(join(APP, "(console)/feedback/page.console.tsx"), "utf8");
  assert.ok(
    page.includes("getFeedbackOverview"),
    "the global /feedback view is gone; without it a note reaches nobody"
  );
});

test("nothing derives a safety flag from a note, and that is on purpose", () => {
  // Migration 025's central decision, asserted: **no keyword detection**. If
  // somebody adds one, it should fail here and be argued about rather than
  // shipped quietly — a word list applied to teenagers produces false alarms
  // in bulk and false comfort in the other direction, and `safety_flags` holds
  // no excerpt (FR-802), so a flag raised from a note alarms without informing.
  //
  // If this test is ever deleted, the thing being deleted is a decision about
  // children's words, not a test.
  const owner = code(readFileSync(OWNER, "utf8"));
  assert.ok(
    !owner.includes("safety_flags"),
    "lib/feedback-queries.ts writes safety_flags. Nothing may classify a child's note " +
      "automatically — see migration 025's header for the argument, and change the argument " +
      "before changing the code."
  );
  const route = code(readFileSync(join(APP, "api/feedback/route.ts"), "utf8"));
  assert.ok(
    !route.includes("safety_flags"),
    "the feedback endpoint writes safety_flags — see migration 025's header"
  );
});

/** Every `.ts`/`.tsx`/`.mts` under `src` — the same walk `plan-gate.test.mts` uses. */
function allSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...allSourceFiles(full));
    else if (/\.(ts|tsx|mts)$/.test(entry)) out.push(full);
  }
  return out;
}
