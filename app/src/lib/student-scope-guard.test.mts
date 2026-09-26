/**
 * THE STUDENT SCOPE GUARD — every student page and API reaches curriculum
 * content through the student scope, or says in this file why it does not
 * (feature 003; plan A2/A3; privacy review §5).
 *
 * The scope (`lib/catalog-queries.ts`: `resolveStudentScope`,
 * `resolveStudentGraphScope`, and the wrappers `visibleCoursesFor` /
 * `visibleGraphFor`, plus `lib/lesson.ts`'s `courseGateFor`) is where a
 * student's grade, curriculum, rules and exceptions become "the courses she
 * may see". A reader that skips it is how, before 003, the progress page
 * listed hidden courses' units, the home page named whichever book `LIMIT 1`
 * returned, the figures API served any diagram by id, and the Ask context
 * named every ingested book to every student's tutor — the four leaks the
 * privacy review made preconditions of loading the Grade 10 book.
 *
 * Source scans, like `catalogue-order-guard.test.mts` and `plan-gate.test.mts`,
 * because the regression is textual — somebody writing a new query or a new
 * route — and this catches it in the second it takes to run. Comments are
 * stripped first. Three checks, each with a written table a new file must be
 * added to, so a new reader has to decide, here, which kind it is:
 *
 *   1. MODULES — every file whose code reads a curriculum table (`graph_*`,
 *      `questions`, `visuals`, `source_documents`, `node_subject`,
 *      `misconceptions`, `explanation_library`) is classified: it consults the
 *      scope itself; or it is console-only (no student surface imports it);
 *      or it defines SQL text that only classified modules use; or its readers
 *      are gated by their caller — and then its importers are listed exactly.
 *   2. ENTRIES — every student page, layout and non-console API route is
 *      declared, with the content readers it imports. An undeclared entry, or
 *      a reader imported and not declared, fails.
 *   3. READERS — every content reader a student entry imports is gated: its
 *      own body (or a function it calls) consults the scope, or the entry
 *      calls a named gate before it, or it returns no curriculum content at
 *      all — each with its reason.
 *
 * And the privacy review's four readers may not be excused: they must be
 * gated by the scope itself (T318).
 *
 * @covers FR-4006, FR-4202, FR-2705
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("../..", import.meta.url));
const REPO = fileURLToPath(new URL("../../..", import.meta.url));

/* ------------------------------------------------------------------ */
/* The scanner                                                         */
/* ------------------------------------------------------------------ */

/** Comments removed (the stripper the order guard uses). */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** A SQL read of a curriculum table. */
export const CONTENT_READ =
  /\b(FROM|JOIN)\s+(graph_nodes|graph_edges|questions|visuals|source_documents|node_subject|misconceptions|explanation_library)\b/i;

/** A call into the student scope. */
export const SCOPE_CALL =
  /\b(resolveStudentScope|resolveStudentGraphScope|visibleCoursesFor|visibleGraphFor|courseGateFor)\(/;

/** Named, non-type imports of a file: local name → resolved file (app-relative). */
export function importsOf(file: string, code: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    if (m[1]) continue; // `import type { … }` pulls no code
    const target = resolveSpecifier(file, m[3]);
    if (!target) continue;
    for (const part of m[2].split(",")) {
      const p = part.trim();
      if (!p || p.startsWith("type ")) continue;
      const [name, alias] = p.split(/\s+as\s+/);
      out.set((alias ?? name).trim(), target);
    }
  }
  return out;
}

function resolveSpecifier(file: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(APP, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = join(APP, dirname(file), spec);
  else return null;
  for (const suffix of ["", ".ts", ".tsx", "/index.ts"]) {
    const candidate = base.endsWith(".ts") && suffix ? null : base + suffix;
    if (candidate && existsSync(candidate) && statSync(candidate).isFile()) return relative(APP, candidate);
  }
  return null;
}

/** The body of a top-level function, up to the next top-level declaration. */
export function bodyOf(code: string, name: string): string | null {
  const start = code.search(new RegExp(`(^|\\n)(export )?(async )?function ${name}\\b`));
  if (start < 0) return null;
  const rest = code.slice(start + 1);
  const end = rest.search(/\n(export )?(async )?function |\nexport const |\nconst [A-Z_]+ =/);
  return code.slice(start, end < 0 ? undefined : start + 1 + end);
}

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== "node_modules") walk(full);
      } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) {
        out.push(relative(APP, full));
      }
    }
  };
  walk(join(APP, "src"));
  return out;
}

const FILES = sourceFiles();
const CODE = new Map(FILES.map((f) => [f, stripComments(readFileSync(join(APP, f), "utf8"))]));
const code = (f: string) => {
  const c = CODE.get(f);
  assert.ok(c !== undefined, `${f} exists`);
  return c;
};
const isConsoleFile = (f: string) => /\.console\.tsx?$/.test(f) || f.includes("/(console)/");

/* ------------------------------------------------------------------ */
/* 1. Every module that reads curriculum content, classified           */
/* ------------------------------------------------------------------ */

type ModuleKind =
  | { kind: "scoped" }
  | { kind: "console"; why: string }
  | { kind: "sql-text"; why: string }
  | { kind: "upstream"; why: string; importers: readonly string[] };

const SCOPED = { kind: "scoped" } as const;

export const MODULES: Readonly<Record<string, ModuleKind>> = {
  "src/lib/catalog-queries.ts": SCOPED,
  "src/lib/lesson.ts": SCOPED,
  "src/lib/queries.ts": SCOPED,
  "src/lib/dashboard.ts": SCOPED,
  "src/lib/ask.ts": SCOPED,
  "src/lib/subject-queries.ts": SCOPED,
  // retrieve() walks one prerequisite hop beyond the objectives it is handed,
  // and that hop is gated by her scope (2026-09-26 isolation audit) — it used
  // to be "upstream", trusting a premise about the seeds instead.
  "src/lib/retrieval.ts": SCOPED,
  "src/app/api/attempts/route.ts": SCOPED,

  "src/lib/visuals.ts": {
    kind: "upstream",
    why:
      "a figure library with no student in it: getVisualsForLos serves one lesson the gate already admitted " +
      "(lib/lesson.ts), getAllVisuals is filtered by the ask context's gate (lib/ask.ts), getVisualById and " +
      "getVisualsForLo are gated by the /api/visuals route, and getGalleryData is the console's.",
    importers: [
      "src/app/(console)/gallery/page.console.tsx",
      "src/app/api/visuals/route.ts",
      "src/lib/ask.ts",
      "src/lib/lesson.ts",
    ],
  },
  "src/lib/explanations.ts": {
    kind: "upstream",
    why:
      "the misconception and explanation library, read for objectives the caller already gated: the attempt " +
      "route gates the question's course first, and retrieval is handed gated objectives.",
    importers: ["src/app/api/attempts/route.ts", "src/lib/retrieval.ts"],
  },
  "src/lib/progression-db.ts": {
    kind: "upstream",
    why:
      "the progression walks ONE course — of a lesson the page just gated, or of an objective the attempt " +
      "route just gated — and getCurrentLesson reads only the student's own pointer, against the gated " +
      "catalogue it is handed.",
    importers: ["src/app/(student)/student/page.tsx", "src/app/api/attempts/route.ts"],
  },
  "src/lib/feedback-queries.ts": {
    kind: "upstream",
    why:
      "resolves the student's OWN session's objective to its course id, to tag her feedback row; it returns " +
      "no curriculum content to anyone. The rest is the console's feedback page.",
    importers: ["src/app/(console)/feedback/page.console.tsx", "src/app/api/feedback/route.ts", "src/lib/console-queries.ts"],
  },
  "src/lib/curriculum-queries.ts": {
    kind: "upstream",
    why:
      "reads which courses are loaded or live to answer which CURRICULA a grade offers (FR-4004) — curriculum " +
      "ids, never course content — for sign-up and the first-Google-sign-in step (WP-D), which also writes " +
      "the student's own grade and curriculum once; the rest is the console's (WP-G).",
    importers: [
      "src/app/(auth)/signup/page.student.tsx",
      "src/app/(auth)/welcome/page.student.tsx",
      "src/app/(console)/courses/page.console.tsx",
      "src/app/(console)/students/[id]/page.console.tsx",
      "src/app/api/auth/onboarding/route.ts",
      "src/app/api/auth/signup/route.ts",
      "src/app/api/console/students/[id]/curriculum/route.console.ts",
    ],
  },

  "src/lib/module-order.ts": {
    kind: "sql-text",
    why: "the catalogue order's SQL fragments; it reads nothing itself (catalogueObjectivesSql returns text).",
  },
  "src/lib/spine-lo-query.ts": {
    kind: "sql-text",
    why: "the skill map's SQL text, run by getSpineData after its gate.",
  },

  "src/lib/console-queries.ts": { kind: "console", why: "Student 360, the students list, the operator card." },
  "src/lib/overview-queries.ts": { kind: "console", why: "the console Overview." },
  "src/lib/pipeline-queries.ts": { kind: "console", why: "/pipeline." },
  "src/lib/content-admin.ts": { kind: "console", why: "the Content page." },
  "src/lib/course-completeness-queries.ts": { kind: "console", why: "/courses: each course's completeness (FR-4309)." },
  "src/lib/timeline.ts": { kind: "console", why: "a session's timeline and replay." },
  "src/lib/turn-threshold-queries.ts": { kind: "console", why: "the Cost page's thresholds." },
  "src/app/(console)/dev/widget-questions/page.console.tsx": { kind: "console", why: "a console dev page." },
};

test("every file that reads curriculum content is classified in MODULES", () => {
  const readers = FILES.filter((f) => CONTENT_READ.test(code(f)));
  const unclassified = readers.filter((f) => !(f in MODULES));
  assert.deepEqual(
    unclassified,
    [],
    "A file reads a curriculum table and is not in MODULES. If a student surface can reach it, it must go " +
      "through the student scope (lib/catalog-queries.ts resolveStudentScope / resolveStudentGraphScope); " +
      "otherwise classify it here, with the reason:\n" +
      unclassified.join("\n")
  );
  // …and no entry has gone stale
  for (const f of Object.keys(MODULES)) {
    assert.ok(CODE.has(f), `${f} is listed and no longer exists`);
    assert.ok(CONTENT_READ.test(code(f)), `${f} is listed and no longer reads curriculum content — remove it`);
  }
});

/** Every (non-type) importer of a file, app-relative. */
function importersOf(target: string): string[] {
  return FILES.filter((f) => [...importsOf(f, code(f)).values()].includes(target)).sort();
}

/** Reached only from the console: every importer is a console file, or a
 *  module that is itself reached only from the console. */
function consoleOnly(file: string, seen = new Set<string>()): boolean {
  if (isConsoleFile(file)) return true;
  if (seen.has(file) || file in ENTRIES) return false;
  seen.add(file);
  const importers = importersOf(file);
  return importers.length > 0 && importers.every((i) => consoleOnly(i, seen));
}

test("each classification's premise holds in the source", () => {
  for (const [file, k] of Object.entries(MODULES)) {
    if (k.kind === "scoped") {
      assert.match(code(file), SCOPE_CALL, `${file} is declared scoped and never calls the scope`);
    } else if (k.kind === "console") {
      assert.ok(consoleOnly(file), `${file} is declared console-only and a student surface can reach it`);
    } else if (k.kind === "sql-text") {
      for (const i of importersOf(file)) {
        assert.ok(isConsoleFile(i) || i in MODULES, `${file}'s SQL is used by ${i}, which is not classified`);
      }
    } else {
      assert.deepEqual(
        importersOf(file),
        [...k.importers].sort(),
        `${file}: its importers changed — each one must gate what it reads (${k.why})`
      );
      for (const i of k.importers) {
        const ik = MODULES[i];
        assert.ok(
          isConsoleFile(i) || ik !== undefined || i in ENTRIES,
          `${file} is imported by ${i}, which is neither classified nor a declared entry`
        );
      }
      assert.ok(k.why.length > 60, `${file}: the reason says why`);
    }
  }
});

/* ------------------------------------------------------------------ */
/* 1b. Inside a "scoped" file, every reader — function by function      */
/* ------------------------------------------------------------------ */

/*
 * "Scoped" used to be a property of a FILE: it called the scope somewhere.
 * That is how `getLessonBridges` slipped through — `lib/subject-queries.ts`
 * gates its roll-up, so the whole file passed, and the unfiltered bridge
 * reader beside it put another course's objective into the tutor's
 * instructions (the 2026-09-26 isolation audit). The check is now per
 * top-level function: every function in a scoped file whose code reads a
 * curriculum table — directly, or through a module-level SQL constant of the
 * same file — must call the scope itself, take the scope as a parameter (a
 * `CourseScope`, `StudentScope` or `StudentGraphScope`, so no caller can reach
 * it without one), or be listed below with its reason.
 */

/** A declaration at the top level of a file (column 0). */
type Decl = { name: string; kind: string; text: string };

export function declarationsOf(code: string): Decl[] {
  const re = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(function\*?|const|let|type|interface|class)\s+([A-Za-z0-9_$]+)/gm;
  const starts: { i: number; kind: string; name: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) starts.push({ i: m.index, kind: m[1], name: m[2] });
  return starts.map((d, k) => ({
    name: d.name,
    kind: d.kind,
    text: code.slice(d.i, k + 1 < starts.length ? starts[k + 1].i : undefined),
  }));
}

const isFunctionDecl = (d: Decl) =>
  d.kind.startsWith("function") ||
  (d.kind === "const" && /^[^=]*=\s*(async\s*)?(\([^)]*\)\s*(:[^=]*)?=>|function\b|[a-zA-Z_$]+\s*\(\s*(async\s+)?(function\b|\())/.test(d.text));

/** The parameter list of a function declaration (balanced parentheses). */
function paramsOf(d: Decl): string {
  const open = d.text.indexOf("(", d.text.indexOf(d.name) + d.name.length);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < d.text.length; i++) {
    if (d.text[i] === "(") depth++;
    else if (d.text[i] === ")" && --depth === 0) return d.text.slice(open + 1, i);
  }
  return "";
}

/** A parameter typed as the student scope: the caller must hand one over. */
export const SCOPE_PARAM = /:\s*(CourseScope|StudentScope|StudentGraphScope)\b/;

/**
 * The reading functions of one file's code that reach the scope by no route
 * the guard accepts, minus `exempt`. Exported for the negative control below.
 */
export function ungatedReaders(source: string, exempt: Readonly<Record<string, string>> = {}): string[] {
  const decls = declarationsOf(source);
  const sqlValues = decls.filter((d) => !isFunctionDecl(d) && CONTENT_READ.test(d.text)).map((d) => d.name);
  return decls
    .filter(isFunctionDecl)
    .filter((d) => CONTENT_READ.test(d.text) || sqlValues.some((v) => new RegExp(`\\b${v}\\b`).test(d.text)))
    .filter((d) => !SCOPE_CALL.test(d.text) && !SCOPE_PARAM.test(paramsOf(d)))
    .map((d) => d.name)
    .filter((name) => !(name in exempt));
}

/**
 * Readers inside a scoped file that are gated some other way, each with why.
 * A new entry is a decision, made here, in review.
 */
export const SCOPED_EXEMPT: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "src/lib/catalog-queries.ts": {
    availabilityFor:
      "the scope's own input: with the gate switched off it reads which course ids are loaded, to decide " +
      "visibility — ids, never content, and it IS the gate's read",
    courseCatalog: "the console's catalogue grid, through withOperator — never a student surface",
    studentAccess: "the console's per-student access view, through withOperator — never a student surface",
  },
  "src/lib/lesson.ts": {
    resolveLessonLos:
      "resolves which objectives a slug names; its two callers gate before anything reaches a student — " +
      "lessonDataOn refuses the lesson's course first thing, and lessonCourseId returns only a course id " +
      "for the probing snapshot, the lesson itself refused in the same request",
  },
};

test("inside every scoped file, each function that reads curriculum content is itself gated", () => {
  for (const [file, k] of Object.entries(MODULES)) {
    if (k.kind !== "scoped") continue;
    const exempt = SCOPED_EXEMPT[file] ?? {};
    assert.deepEqual(
      ungatedReaders(code(file), exempt),
      [],
      `${file}: a function reads a curriculum table and neither calls the student scope nor takes it as a ` +
        "parameter (CourseScope / StudentScope / StudentGraphScope). A file that gates one reader does not " +
        "gate the one beside it — gate this function, or list it in SCOPED_EXEMPT with the reason."
    );
    for (const [fn, why] of Object.entries(exempt)) {
      assert.ok(why.length > 40, `${file}: ${fn}: the reason says why`);
      assert.ok(
        declarationsOf(code(file)).some((d) => d.name === fn),
        `${file}: SCOPED_EXEMPT lists ${fn}, which no longer exists — remove it`
      );
    }
  }
  for (const file of Object.keys(SCOPED_EXEMPT)) {
    assert.equal(MODULES[file]?.kind, "scoped", `SCOPED_EXEMPT lists ${file}, which is not a scoped file`);
  }
});

test("the per-function check catches an unfiltered reader beside a gated one (negative control)", () => {
  // The shape of lib/subject-queries.ts before the fix: a gated roll-up, and
  // an ungated bridge reader in the same file.
  const before = stripComments(`
import { visibleCoursesFor } from "./catalog-queries";
const BRIDGES_SQL = \`SELECT src_id FROM graph_edges WHERE edge_type = 'relates_to'\`;
async function subjectSummariesOn(db, studentId) {
  const visible = await visibleCoursesFor(studentId);
  return db.query(\`SELECT id FROM graph_nodes WHERE kind = 'learning_objective'\`);
}
export async function getLessonBridges(loIds: string[]): Promise<LessonBridge[]> {
  return (await pool.query(BRIDGES_SQL, [loIds])).rows;
}
export const rawReader = async (id: string) => pool.query(\`SELECT * FROM questions WHERE id = $1\`, [id]);
`);
  assert.deepEqual(ungatedReaders(before), ["getLessonBridges", "rawReader"]);
  // …and after: the bridge reader takes her scope
  const after = before.replace(
    "getLessonBridges(loIds: string[])",
    "getLessonBridges(loIds: string[], scope: CourseScope)"
  );
  assert.deepEqual(ungatedReaders(after), ["rawReader"]);
  assert.deepEqual(ungatedReaders(after, { rawReader: "a test exemption" }), []);
});

/* ------------------------------------------------------------------ */
/* 2. Every student entry, declared                                    */
/* ------------------------------------------------------------------ */

type Entry = { reads: readonly string[] } | { none: string };

const IDENTITY = "identity and sessions: accounts, tokens, cookies — no curriculum";

/** Every page, layout and non-console route a student (or a visitor) reaches. */
export const ENTRIES: Readonly<Record<string, Entry>> = {
  "src/app/layout.tsx": { none: "the shell: the student's name and design variant" },
  "src/app/(student)/layout.tsx": { none: "a wrapper" },
  "src/app/(auth)/layout.tsx": { none: "a wrapper" },
  "src/app/(auth)/signin/page.tsx": { none: IDENTITY },
  "src/app/(auth)/signup/page.student.tsx": { reads: ["offeredCurriculaEveryGrade"] },
  "src/app/(auth)/welcome/page.student.tsx": { reads: ["offeredCurriculaEveryGrade"] },
  // Two auth routes read the curriculum offer, so they are declared rather than
  // excused by path like the rest of `api/auth/` (feature 003, WP-D).
  "src/app/api/auth/signup/route.ts": { reads: ["offeredCurriculaFor"] },
  "src/app/api/auth/onboarding/route.ts": { reads: ["completeOnboarding"] },
  "src/app/(auth)/verify/page.tsx": { none: IDENTITY },
  "src/app/(auth)/forgot-password/page.tsx": { none: IDENTITY },
  "src/app/(auth)/reset-password/page.tsx": { none: IDENTITY },
  "src/app/(student)/settings/page.tsx": { none: "her own appearance setting and grade label" },

  "src/app/(student)/page.student.tsx": { reads: ["getHomeStats"] },
  "src/app/(student)/dashboard/page.tsx": { reads: ["getTopicBreakdown"] },
  "src/app/(student)/spine/page.tsx": { reads: ["getSpineData"] },
  "src/app/(student)/student/page.tsx": {
    reads: [
      "getStudentPlan",
      "getLessonCatalog",
      "getLessonData",
      "getLessonContent",
      "getSubjectSummaries",
      "getCurrentLesson",
      "isCourseComplete",
      "resolveStudentScope",
      // the practice loop's book citation: which courses she sees, nothing more (#36)
      "visibleCoursesFor",
    ],
  },

  "src/app/api/ask/route.ts": {
    // resolveStudentScope: her scope keys the per-session snapshot, so a
    // change of scope reaches an open chat on its next turn (lib/session-cache.ts)
    reads: ["buildAskContext", "buildLessonContext", "lessonCourseId", "getAllSacredPassages", "resolveStudentScope"],
  },
  "src/app/api/attempts/route.ts": {
    reads: ["visibleCoursesFor", "getLibraryEntries", "flagAuthoringGap", "advanceIfMastered"],
  },
  "src/app/api/dashboard/route.ts": { reads: ["getTopicBreakdown"] },
  "src/app/api/visuals/route.ts": { reads: ["resolveStudentGraphScope", "getVisualById", "getVisualsForLo"] },
  "src/app/api/feedback/route.ts": { reads: ["dismissFeedback", "feedbackContext", "recordFeedback"] },
  "src/app/api/understanding/route.ts": {
    reads: ["getLessonData", "lessonAnchorLo", "lessonCourseId", "sanitizeLessonSlug"],
  },
  "src/app/api/uploads/route.ts": { none: "stores the student's own photo" },
  "src/app/api/uploads/[id]/route.ts": { none: "reads the student's own upload back" },
  "src/app/api/analytics/route.ts": { none: "first-party events" },
  "src/app/api/tts/route.ts": { none: "speech for text the client already holds" },
  "src/app/api/settings/appearance/route.ts": { none: "her own design variant" },
};

/** Files under `api/auth/`, all identity: declared by path rather than one by one. */
const isAuthRoute = (f: string) => f.startsWith("src/app/api/auth/");

const isEntry = (f: string) =>
  f.startsWith("src/app/") &&
  !isConsoleFile(f) &&
  (/\/(page|layout)(\.student)?\.tsx$/.test(f) || /\/route\.ts$/.test(f));

/**
 * Curriculum content that is read from DISK, not SQL, so the table scan above
 * cannot see it: the lessons' teaching-script bundles (`content/*.json`). Its
 * readers are gated like any other (READERS).
 */
export const FILE_CONTENT_MODULES: readonly string[] = ["src/lib/lesson-content.ts"];

/** The content-reading modules a student could reach. */
const CONTENT_MODULES = new Set([
  ...Object.entries(MODULES)
    .filter(([, k]) => k.kind !== "console" && k.kind !== "sql-text")
    .map(([f]) => f),
  ...FILE_CONTENT_MODULES,
]);

/** The names an entry imports from a content module. */
function contentImports(file: string): string[] {
  return [...importsOf(file, code(file))]
    .filter(([, target]) => CONTENT_MODULES.has(target))
    .map(([name]) => name)
    .sort();
}

test("every student page, layout and API route is declared in ENTRIES — none skips the question", () => {
  const entries = FILES.filter(isEntry);
  assert.ok(entries.length >= 30, `the scan sees the app's entries (${entries.length})`);
  const undeclared = entries.filter((f) => !(f in ENTRIES) && !isAuthRoute(f));
  assert.deepEqual(
    undeclared,
    [],
    "A student surface is not declared. Add it to ENTRIES with the content readers it imports — each of " +
      "which must go through the student scope — or with `none` and why it reads no curriculum:\n" +
      undeclared.join("\n")
  );
  for (const f of Object.keys(ENTRIES)) assert.ok(CODE.has(f), `${f} is declared and no longer exists`);
});

test("each entry imports exactly the content readers it declares; the rest import none", () => {
  for (const f of FILES.filter(isEntry)) {
    const e = ENTRIES[f];
    const got = contentImports(f);
    if (!e || "none" in e) {
      assert.deepEqual(got, [], `${f} is declared to read no curriculum and imports ${got.join(", ")}`);
      assert.doesNotMatch(code(f), CONTENT_READ, `${f} reads a curriculum table itself`);
    } else {
      assert.deepEqual(got, [...e.reads].sort(), `${f}: declared reads`);
      if (CONTENT_READ.test(code(f))) {
        assert.equal(MODULES[f]?.kind, "scoped", `${f} reads curriculum itself, so it must call the scope`);
      }
    }
  }
});

/* ------------------------------------------------------------------ */
/* 3. Every reader a student entry imports is gated                    */
/* ------------------------------------------------------------------ */

type Gate =
  /** the reader's own body — or an inner function it names — calls the scope */
  | { self: string; via?: readonly string[] }
  /** the reader IS the scope */
  | { scope: string }
  /** the entry calls one of these gates first; the reader serves what they admitted */
  | { caller: string; gates: readonly string[] }
  /** the reader hands the student no curriculum content at all */
  | { noContent: string; file: string };

export const READERS: Readonly<Record<string, Gate>> = {
  resolveStudentScope: { scope: "src/lib/catalog-queries.ts" },
  resolveStudentGraphScope: { scope: "src/lib/catalog-queries.ts" },
  visibleCoursesFor: { scope: "src/lib/catalog-queries.ts" },

  getHomeStats: { self: "src/lib/queries.ts" },
  getSpineData: { self: "src/lib/queries.ts", via: ["spineDataOn"] },
  getStudentPlan: { self: "src/lib/queries.ts", via: ["studentPlanOn"] },
  getTopicBreakdown: { self: "src/lib/dashboard.ts" },
  getLessonCatalog: { self: "src/lib/lesson.ts" },
  getLessonData: { self: "src/lib/lesson.ts", via: ["lessonDataOn"] },
  buildLessonContext: { self: "src/lib/lesson.ts" },
  getSubjectSummaries: { self: "src/lib/subject-queries.ts", via: ["subjectSummariesOn"] },
  buildAskContext: { self: "src/lib/ask.ts", via: ["askContextOn"] },

  getLessonContent: {
    caller: "the lesson's content bundle is opened only after getLessonData admitted that same lesson",
    gates: ["getLessonData"],
  },
  getCurrentLesson: {
    caller: "reads only her own pointer, against the gated catalogue it is handed",
    gates: ["getLessonCatalog"],
  },
  isCourseComplete: {
    caller: "walks the course of the lesson getLessonData just admitted",
    gates: ["getLessonData"],
  },
  advanceIfMastered: {
    caller: "walks the course of the objective whose question the route just gated",
    gates: ["visibleCoursesFor"],
  },
  getLibraryEntries: {
    caller: "explanations for the objective whose question the route just gated",
    gates: ["visibleCoursesFor"],
  },
  flagAuthoringGap: {
    caller: "records a gap against the objective whose question the route just gated",
    gates: ["visibleCoursesFor"],
  },
  getVisualById: {
    caller: "the route refuses a figure whose objective is outside her scope (404, like a missing one)",
    gates: ["resolveStudentGraphScope"],
  },
  getVisualsForLo: {
    caller: "the route answers an empty list for an objective outside her scope",
    gates: ["resolveStudentGraphScope"],
  },

  lessonCourseId: {
    noContent:
      "answers only the course id of a lesson slug, for the probing snapshot; the lesson itself is refused " +
      "by buildLessonContext → getLessonData in the same request",
    file: "src/lib/lesson.ts",
  },
  lessonAnchorLo: {
    noContent: "a pure helper: the first objective id of lesson data the caller already holds, gated",
    file: "src/lib/lesson.ts",
  },
  sanitizeLessonSlug: {
    noContent: "a pure helper: a slug, validated; reads nothing",
    file: "src/lib/lesson-slug.ts",
  },
  getAllSacredPassages: {
    noContent: "the sealed corpus the output guard scans the tutor's reply against; never sent to the model or shown",
    file: "src/lib/lesson-content.ts",
  },
  feedbackContext: {
    noContent: "tags her own feedback with her own session's course; returns a decision, no content",
    file: "src/lib/feedback-queries.ts",
  },
  recordFeedback: {
    noContent: "writes her own feedback row",
    file: "src/lib/feedback-queries.ts",
  },
  dismissFeedback: {
    noContent: "records that she dismissed the feedback prompt",
    file: "src/lib/feedback-queries.ts",
  },
  offeredCurriculaFor: {
    noContent:
      "answers which curriculum ids a grade offers (FR-4004), from the availability rules or the loaded course " +
      "ids; no course content and no student",
    file: "src/lib/curriculum-queries.ts",
  },
  offeredCurriculaEveryGrade: {
    noContent: "the same answer for every grade from one read, for sign-up and the Google step; ids only",
    file: "src/lib/curriculum-queries.ts",
  },
  completeOnboarding: {
    noContent:
      "writes the acting student's own grade and curriculum once, through complete_student_onboarding(); " +
      "returns what it stored, no course content",
    file: "src/lib/curriculum-queries.ts",
  },
};

/** Is `name` gated by its own body (or a self-gated function it calls)? */
function selfGated(name: string, seen = new Set<string>()): boolean {
  const g = READERS[name];
  if (!g || seen.has(name)) return false;
  seen.add(name);
  if ("scope" in g) return true;
  if (!("self" in g)) return false;
  const c = code(g.self);
  for (const fn of [name, ...(g.via ?? [])]) {
    const body = bodyOf(c, fn);
    assert.ok(body, `${g.self}: function ${fn} exists`);
    if (SCOPE_CALL.test(body)) return true;
    for (const other of Object.keys(READERS)) {
      if (other !== name && new RegExp(`\\b${other}\\(`).test(body) && selfGated(other, seen)) return true;
    }
  }
  return false;
}

test("every reader a student entry imports is gated — by itself, by the scope, or by its caller", () => {
  const imported = new Set<string>();
  for (const [f, e] of Object.entries(ENTRIES)) {
    if ("none" in e) continue;
    for (const r of e.reads) {
      imported.add(r);
      const g = READERS[r];
      assert.ok(g, `${f} imports ${r}, which READERS does not classify`);
      if ("self" in g || "scope" in g) {
        assert.ok(selfGated(r), `${r} is declared self-gated and its body never reaches the scope`);
      } else if ("caller" in g) {
        const called = g.gates.filter((gate) => new RegExp(`\\b${gate}\\(`).test(code(f)));
        assert.ok(called.length > 0, `${f} imports ${r} but calls none of its gates (${g.gates})`);
        assert.ok(g.caller.length > 30, `${r}: the reason says why`);
      } else {
        assert.ok(g.noContent.length > 20, `${r}: the reason says why`);
        assert.match(code(g.file), new RegExp(`function ${r}\\b`), `${r} lives in ${g.file}`);
      }
    }
  }
  for (const r of Object.keys(READERS)) assert.ok(imported.has(r), `READERS lists ${r}, which no entry imports`);
});

test("the privacy review's four readers are gated by the scope itself — none is excused (T318)", () => {
  // §5.1 the ask context's book list, §5.2 the progress page, §5.3 the home
  // page's counts and book, §5.4 the figures API.
  for (const r of ["buildAskContext", "getTopicBreakdown", "getHomeStats"]) {
    const g = READERS[r];
    assert.ok("self" in g, `${r} must be gated by its own body`);
    assert.ok(selfGated(r), r);
  }
  assert.match(code("src/lib/ask.ts"), /\.filter\(\(d\) => gate\.doc\(d\.sha256\)\)/, "the ask context's books go through gate.doc");
  assert.match(code("src/app/api/visuals/route.ts"), /resolveStudentGraphScope\(me\.studentId\)/);
  assert.match(code("src/app/api/visuals/route.ts"), /scope\?\.lo\(visual\.loId\)/);
  assert.match(code("src/app/api/visuals/route.ts"), /scope\.lo\(lo\)/);
  // …and the book `/` and `/spine` name is the first VISIBLE course's, not LIMIT 1's
  assert.doesNotMatch(code("src/lib/queries.ts"), /FROM source_documents LIMIT 1/);
  assert.match(bodyOf(code("src/lib/queries.ts"), "sourceBooksFor") ?? "", /gate\.course\(/);
  assert.match(bodyOf(code("src/lib/queries.ts"), "sourceBookFor") ?? "", /sourceBooksFor\(db, gate\)/);
});

/* ------------------------------------------------------------------ */
/* The scanner catches what it must (negative controls)                */
/* ------------------------------------------------------------------ */

test("the scanner: a content read, a scope call, imports and bodies", () => {
  assert.match("db.query(`SELECT id FROM graph_nodes WHERE kind = 'course'`)", CONTENT_READ);
  assert.match("`… LEFT JOIN questions q ON q.lo_id = lo.id`", CONTENT_READ);
  assert.match("`select title from source_documents limit 1`", CONTENT_READ);
  assert.doesNotMatch("`SELECT id FROM students`", CONTENT_READ);
  assert.doesNotMatch(stripComments("// it used to SELECT … FROM source_documents LIMIT 1\nconst x = 1;"), CONTENT_READ);
  assert.match("const gate = await visibleGraphFor(db, studentId);", SCOPE_CALL);
  assert.doesNotMatch("import { visibleGraphFor } from './catalog-queries';", SCOPE_CALL);
  const imports = importsOf(
    "src/app/(student)/x/page.tsx",
    'import { getHomeStats as stats, type X } from "@/lib/queries";\nimport type { Y } from "@/lib/visuals";'
  );
  assert.deepEqual([...imports], [["stats", "src/lib/queries.ts"]]);
  const body = bodyOf("export function a() {\n  x();\n}\nexport async function b() {\n  y();\n}\n", "a");
  assert.ok(body?.includes("x()") && !body.includes("y()"));
});

/* ------------------------------------------------------------------ */
/* retrieval's premise, on the seeds                                   */
/* ------------------------------------------------------------------ */

/**
 * Every seed bundle under `services/extraction/seed/`, SUBDIRECTORIES included
 * — a book's chapter bundles live in their own directory (`seed/g10-math/`,
 * `books/g10-math.json`), and a check that read only the top level would pass
 * without ever seeing them.
 */
function seedJsonFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...seedJsonFiles(full));
    else if (entry.endsWith(".json")) out.push(full);
  }
  return out.sort();
}

/**
 * The course of every objective in a set of edges: objective ← module
 * (`teaches`), then `part_of` upward until a `course:` node — through any
 * number of intermediate levels.
 */
export function coursesOfObjectives(edges: readonly { src: string; dst: string; type: string }[]) {
  const parent = new Map<string, string>();
  const moduleOfLo = new Map<string, string>();
  for (const e of edges) {
    if (e.type === "part_of") parent.set(e.src, e.dst);
    if (e.type === "teaches" && !moduleOfLo.has(e.dst)) moduleOfLo.set(e.dst, e.src);
  }
  return (lo: string): string | undefined => {
    let node = moduleOfLo.get(lo);
    for (let hops = 0; node !== undefined && hops < 16; hops++) {
      if (node.startsWith("course:")) return node;
      node = parent.get(node);
    }
    return undefined;
  };
}

test("a prerequisite never crosses courses on the seeds — defence in depth behind retrieval's own gate", () => {
  // Retrieval no longer RELIES on this (it filters its one hop by her scope,
  // 2026-09-26); the loader refuses such an edge unless its allowlist names it
  // (services/extraction/load_seed.py ALLOWED_CROSS_COURSE_PREREQUISITES,
  // empty). This keeps the committed seeds honest as well.
  const files = seedJsonFiles(join(REPO, "services/extraction/seed"));
  const edges: { src: string; dst: string; type: string }[] = [];
  for (const file of files) {
    const doc = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (doc && typeof doc === "object" && Array.isArray((doc as { edges?: unknown }).edges)) {
      edges.push(...((doc as { edges: { src: string; dst: string; type: string }[] }).edges));
    }
  }
  const prereqs = edges.filter((e) => e.type === "prerequisite_of");
  assert.ok(prereqs.length >= 100);
  const courseOf = coursesOfObjectives(edges);
  for (const e of prereqs) {
    const a = courseOf(e.src);
    const b = courseOf(e.dst);
    assert.ok(a && b, `${e.src} -> ${e.dst}: an end is filed under no course`);
    assert.equal(a, b, `${e.src} -> ${e.dst} crosses courses`);
  }
});

test("the seed walk sees subdirectories and multi-level part_of chains (negative control)", () => {
  const courseOf = coursesOfObjectives([
    { src: "module:x-c01", dst: "course:x", type: "part_of" },
    { src: "module:x-s01", dst: "module:x-c01", type: "part_of" },
    { src: "module:x-s01", dst: "lo:x1-1-1", type: "teaches" },
    { src: "module:u1", dst: "course:prep3-math-en", type: "part_of" },
    { src: "module:u1", dst: "lo:u1-1-1", type: "teaches" },
  ]);
  assert.equal(courseOf("lo:x1-1-1"), "course:x");
  assert.equal(courseOf("lo:u1-1-1"), "course:prep3-math-en");
  assert.equal(courseOf("lo:unfiled"), undefined);
  // the directory walk descends: this repo's seeds have a subdirectory with JSON in it
  const files = seedJsonFiles(join(REPO, "services/extraction/seed"));
  assert.ok(files.some((f) => relative(join(REPO, "services/extraction/seed"), f).includes("/")));
});
