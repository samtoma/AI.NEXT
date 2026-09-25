/**
 * FR-3217's guard: one catalogue order, and no query that invents its own.
 *
 * Samuel, 2026-09-25, on learning that most readers of curriculum order did
 * not use `MODULE_ORDER` (lib/module-order.ts): *"i thought they are all from
 * the same source."* They do now, and this file is what keeps it true. It
 * reads every app source file and FAILS when any `ORDER BY` sorts by
 * `order_in_parent` — directly, through a column alias of it, or inside a
 * window — without going through `MODULE_ORDER` / `MODULE_RANK`, unless the
 * clause is one of the two EXCEPTIONS below, each with its reason. It also fails
 * when an exception goes stale (its clause is no longer in the file), so the
 * list cannot quietly outlive the code it excuses.
 *
 * AND IT SPLITS MIXED LISTS BY SUBJECT (Samuel, 2026-09-25: "Yes they need
 * to split by subject"). `MODULE_ORDER` has no subject key: maths, Arabic and
 * Social Studies units share positions, so a list of every subject ordered by
 * it alone interleaves them. Any clause that uses `MODULE_ORDER` or
 * `MODULE_RANK` must put `SUBJECT_RANK` in front of it — unless it is one of
 * the SINGLE_SUBJECT readers below, each of which says why it only ever
 * orders one subject (or one course), and each of whose premises is checked
 * against the source. A new reader therefore has to decide, in this file,
 * which kind it is.
 *
 * Why `order_in_parent` is the thing to catch: it is a position INSIDE a
 * parent. Term-1 Unit 1 and Term-2 Unit 1 are both module 1, and the first
 * objective of every unit is objective 1 — nine maths objectives share every
 * position. A sort on it alone leaves Postgres to pick the order of every
 * tie, which is how the skill map came to look "random" (FR-3215) and how the
 * practice plan, /pipeline, the console Overview, /gallery and the progress
 * page each ended up with an order of their own.
 *
 * It is a source scan, like `plan-gate.test.mts` and `spine-order-scan`,
 * because the regression is textual — somebody writing `ORDER BY
 * order_in_parent` in a new query — and this catches it in the second it
 * takes to run. Comments are stripped first, so explaining the old defect in
 * a comment (which several files now do) is not a failure. The scanner is
 * negative-controlled below against the exact shapes the old readers had.
 *
 * @covers FR-3217
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { slugOfLo } from "./lesson-slug.ts";
import { MATHS_SEED_FILES } from "./spine-maths-fixture.mts";

const APP = fileURLToPath(new URL("../..", import.meta.url));
const REPO = fileURLToPath(new URL("../../..", import.meta.url));

/* ------------------------------------------------------------------ */
/* The exceptions — every one named, with its reason                   */
/* ------------------------------------------------------------------ */

type Exception = { file: string; clause: string; why: string };

/**
 * The only clauses in the app allowed to sort by `order_in_parent` without
 * `MODULE_ORDER`. `clause` is the ORDER BY as the scanner extracts it,
 * whitespace squashed; it must match exactly one clause in `file`.
 */
export const EXCEPTIONS: readonly Exception[] = [
  {
    file: "src/lib/lesson.ts",
    clause: 'ORDER BY lo.order_in_parent, lo.id${firstOnly ? " LIMIT 1" : ""}',
    why:
      "resolveLessonLos: the LIKE keeps ONE lesson, a lesson sits in one module, and inside one " +
      "module MODULE_ORDER reduces to exactly `lo.order_in_parent, lo.id` (proved on the seeds " +
      "below). It also feeds the lesson prompt, which ADR-0020 holds.",
  },
  {
    file: "src/lib/visuals.ts",
    clause: "ORDER BY lo.order_in_parent, v.id",
    why:
      "getVisualsForLos: its one caller (lib/lesson.ts) passes one lesson's objectives — the same " +
      "reduction, given that no two objectives of one lesson share a position (proved below). " +
      "Lesson-prompt grounding; ADR-0020.",
  },
];
// There were three more until 2026-09-25, all HELD under ADR-0020: lib/ask.ts's
// objective and unit lists and getAllVisuals. Samuel lifted the hold for that
// ordering ("yes for sure, for decision 2, it is part of the overall
// consistency"), they were rerouted, and ask.ts is now guarded like every
// other reader. Only the two in-lesson reads remain, and neither is held.

/**
 * Readers that use `MODULE_ORDER` WITHOUT `SUBJECT_RANK`, because what they
 * order is only ever one subject (or one course) at a time. `count` is how
 * many such clauses the file holds; `premise` is a check on `premiseFile`'s
 * code (comments stripped) that makes the reason true, run below so the
 * reason cannot go stale.
 */
export const SINGLE_SUBJECT: readonly {
  file: string;
  clause: string;
  count: number;
  why: string;
  premiseFile: string;
  premise: (code: string) => boolean;
}[] = [
  {
    file: "src/lib/progression-db.ts",
    clause: "ORDER BY ${MODULE_ORDER}",
    count: 1,
    why: "the progression reads every course but walks ONE: every read of its catalogue is narrowed to one course before anything is next.",
    premiseFile: "src/lib/progression-db.ts",
    premise: (code) => {
      const reads = code.split("await loadCatalog(db, studentId)").length - 1;
      const narrowed = code.split("lessons.filter((l) => l.courseId === courseId)").length - 1;
      return reads >= 1 && narrowed === reads;
    },
  },
  {
    file: "src/lib/subject-queries.ts",
    clause: "ORDER BY ${MODULE_ORDER}",
    count: 1,
    why: "the subject home files each row under its own subject and orders the subjects by the registry (compareSpineSubjects).",
    premiseFile: "src/lib/subject-queries.ts",
    premise: (code) =>
      /\.sort\(\(a, b\) => compareSpineSubjects\(a\.subject, b\.subject\)\)/.test(code) &&
      /bySubject\.get\(subject\)/.test(code),
  },
  {
    file: "src/lib/spine-lo-query.ts",
    clause: "ORDER BY ${MODULE_ORDER}",
    count: 2,
    why: "the skill map shows one subject at a time: SpineExplorer narrows the objectives to the chosen subject before the layout ranks them (FR-3215 kept as shipped).",
    premiseFile: "src/components/spine/SpineExplorer.tsx",
    premise: (code) =>
      /data\.los\.filter\(\(l\) => l\.subject === subject\)/.test(code),
  },
  {
    file: "src/lib/overview-queries.ts",
    clause: "ORDER BY ${MODULE_ORDER}",
    count: 1,
    why: "the Overview heatmap query reads one subject: WHERE ns.subject = $1.",
    premiseFile: "src/lib/overview-queries.ts",
    premise: (code) => /WHERE ns\.subject = \$1\s+ORDER BY \$\{MODULE_ORDER\}/.test(code),
  },
];

/** Does a clause use the catalogue order, and if so, is the subject first? */
export function subjectKeyStatus(clause: string): "none" | "subject-first" | "missing" {
  const order = clause.search(/\$\{(MODULE_ORDER|MODULE_RANK)\}/);
  if (order < 0) return "none";
  const subject = clause.indexOf("${SUBJECT_RANK}");
  return subject >= 0 && subject < order ? "subject-first" : "missing";
}

/** The one file allowed to spell the order out: the definition itself. */
const DEFINITION = "src/lib/module-order.ts";

/** Names a JavaScript comparator must not sort on — the same positions,
 *  camel- or snake-cased, and the aliases readers give them. */
const JS_ORDER_NAMES =
  /\b(order_in_parent|orderInParent|module_order|moduleOrder|lo_order|loOrder|module_ordinal|moduleOrdinal|lo_ordinal|loOrdinal)\b/;

/* ------------------------------------------------------------------ */
/* The scanner                                                         */
/* ------------------------------------------------------------------ */

/** Comments removed (the stripper `spine-order-scan.test.mts` uses), so an
 *  explanation of the old sort is never read as the sort. */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** `${ … }` from `i` (pointing at `$`), braces balanced; returns its end. */
function interpolationEnd(s: string, i: number): number {
  let depth = 0;
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === "{") depth++;
    else if (s[j] === "}") {
      depth--;
      if (depth === 0) return j + 1;
    }
  }
  return s.length;
}

const STOP_WORD = /^(LIMIT|OFFSET|FETCH|UNION|INTERSECT|EXCEPT|RETURNING|FOR\s+UPDATE)\b/i;

/**
 * Every ORDER BY clause in `code` (comments already stripped), from the
 * keywords to wherever the clause ends: the closing backtick or quote of its
 * string, a `)` that closes a window, `;`, or LIMIT/OFFSET/…. A `${…}` is kept
 * verbatim — `ORDER BY ${MODULE_ORDER}` is how a clause says it uses the one
 * order — and SQL `--` comments inside the clause are skipped.
 */
export function orderClauses(code: string): string[] {
  const out: string[] = [];
  const re = /\bORDER\s+BY\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    let i = m.index + m[0].length;
    let depth = 0;
    let text = "ORDER BY";
    while (i < code.length && text.length < 600) {
      const c = code[i];
      if (c === "`" || c === '"' || c === ";") break;
      if (c === "$" && code[i + 1] === "{") {
        const end = interpolationEnd(code, i);
        text += code.slice(i, end);
        i = end;
        continue;
      }
      if (c === "-" && code[i + 1] === "-") {
        const nl = code.indexOf("\n", i);
        i = nl < 0 ? code.length : nl;
        continue;
      }
      if (c === "(") depth++;
      if (c === ")") {
        if (depth === 0) break;
        depth--;
      }
      if (depth === 0 && /[A-Za-z]/.test(c) && !/[\w.]/.test(code[i - 1] ?? " ")) {
        if (STOP_WORD.test(code.slice(i, i + 12))) break;
      }
      text += c;
      i++;
    }
    out.push(text.replace(/\s+/g, " ").trim());
  }
  return out;
}

/** Column aliases of `order_in_parent` a file defines (`m.order_in_parent AS
 *  module_order`) — sorting on the alias is sorting on the position. */
export function positionAliases(code: string): string[] {
  return [...code.matchAll(/order_in_parent\s+AS\s+(\w+)/gi)].map((a) => a[1]);
}

/** Does this clause sort on a position without the one order? */
export function sortsOnPosition(clause: string, aliases: readonly string[]): boolean {
  const names = ["order_in_parent", ...aliases];
  // what the clause says OUTSIDE its interpolations
  const sql = clause.replace(/\$\{[^}]*\}/g, " ");
  return names.some((n) => new RegExp(`\\b${n}\\b`, "i").test(sql));
}

/** The argument text of every `.sort(` / `.toSorted(` call, parens balanced. */
export function sortComparators(code: string): string[] {
  const out: string[] = [];
  const re = /\.(?:sort|toSorted)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    let depth = 1;
    let j = m.index + m[0].length;
    const start = j;
    for (; j < code.length && depth > 0; j++) {
      if (code[j] === "(") depth++;
      else if (code[j] === ")") depth--;
    }
    out.push(code.slice(start, j - 1));
  }
  return out;
}

/** Every app source file the rule covers: `src/` (.ts, .tsx) and `scripts/`
 *  (.mts, .mjs), tests excluded. Test fixtures are .mts under src/ and are
 *  not app code (`spine-maths-fixture.mts` restates the order on purpose). */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string, ext: RegExp) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== "node_modules") walk(full, ext);
      } else if (ext.test(entry) && !/\.test\./.test(entry)) {
        out.push(full);
      }
    }
  };
  walk(join(APP, "src"), /\.(ts|tsx)$/);
  walk(join(APP, "scripts"), /\.(mts|mjs)$/);
  return out;
}

type Finding = { file: string; clause: string };

function scanAll(): { sorts: Finding[]; jsSorts: Finding[]; clauses: Finding[] } {
  const sorts: Finding[] = [];
  const jsSorts: Finding[] = [];
  const clauses: Finding[] = [];
  for (const full of sourceFiles()) {
    const file = relative(APP, full);
    if (file === DEFINITION) continue;
    const code = stripComments(readFileSync(full, "utf8"));
    const aliases = positionAliases(code);
    for (const clause of orderClauses(code)) {
      clauses.push({ file, clause });
      if (sortsOnPosition(clause, aliases)) sorts.push({ file, clause });
    }
    for (const cmp of sortComparators(code)) {
      if (JS_ORDER_NAMES.test(cmp)) jsSorts.push({ file, clause: cmp.trim() });
    }
  }
  return { sorts, jsSorts, clauses };
}

/* ------------------------------------------------------------------ */
/* The rule                                                            */
/* ------------------------------------------------------------------ */

test("no query orders by order_in_parent without MODULE_ORDER, except the listed exceptions", () => {
  const { sorts } = scanAll();
  const unexcused = sorts.filter(
    (s) => !EXCEPTIONS.some((e) => e.file === s.file && e.clause === s.clause)
  );
  assert.deepEqual(
    unexcused,
    [],
    "A query sorts by a position inside a parent without the catalogue order. Route it " +
      "through MODULE_ORDER / MODULE_RANK / catalogueObjectivesSql (lib/module-order.ts), or — " +
      "if it genuinely needs another order — add it to EXCEPTIONS with the reason:\n" +
      unexcused.map((u) => `  ${u.file}: ${u.clause}`).join("\n")
  );
});

test("every exception is still in its file, exactly once — none has gone stale", () => {
  const { sorts } = scanAll();
  for (const e of EXCEPTIONS) {
    const hits = sorts.filter((s) => s.file === e.file && s.clause === e.clause);
    assert.equal(hits.length, 1, `${e.file}: ${e.clause} — found ${hits.length} times`);
    assert.ok(e.why.length > 40, `${e.file}: the exception says why`);
  }
});

test("every list of more than one subject puts SUBJECT_RANK first; the rest are declared single-subject", () => {
  const { clauses } = scanAll();
  const missing = clauses.filter((c) => subjectKeyStatus(c.clause) === "missing");
  const undeclared = missing.filter(
    (m) => !SINGLE_SUBJECT.some((d) => d.file === m.file && d.clause === m.clause)
  );
  assert.deepEqual(
    undeclared,
    [],
    "A query orders by the catalogue order with no subject key in front. If it can list more " +
      "than one subject, write ORDER BY ${SUBJECT_RANK}, ${MODULE_ORDER} (or MODULE_RANK); if it " +
      "only ever orders one subject, add it to SINGLE_SUBJECT with the reason:\n" +
      undeclared.map((u) => `  ${u.file}: ${u.clause}`).join("\n")
  );
  // …and every declaration is still exactly as many clauses as it says
  for (const d of SINGLE_SUBJECT) {
    const n = missing.filter((m) => m.file === d.file && m.clause === d.clause).length;
    assert.equal(n, d.count, `${d.file}: ${d.clause} — ${n} found, ${d.count} declared`);
  }
  // the mixed readers really do lead with the subject
  const first = (file: string) =>
    clauses.filter((c) => c.file === file && subjectKeyStatus(c.clause) === "subject-first").length;
  assert.equal(first("src/lib/lesson.ts"), 1, "the lesson catalogue");
  assert.equal(first("src/lib/visuals.ts"), 2, "/gallery and the ask context's figure catalogue");
  assert.equal(first("src/lib/dashboard.ts"), 1, "the progress page");
  assert.equal(first("src/lib/ask.ts"), 1, "the ask context's unit list");
});

test("each single-subject reader's reason is still true in the source", () => {
  for (const d of SINGLE_SUBJECT) {
    const code = stripComments(readFileSync(join(APP, d.premiseFile), "utf8"));
    assert.ok(d.premise(code), `${d.file}: ${d.why}`);
  }
});

test("no JavaScript sort re-orders rows by a position inside a parent", () => {
  assert.deepEqual(scanAll().jsSorts, []);
});

test("the rerouted readers are found by the scan — it covers what it claims to", () => {
  // Positive control: if the stripper or the clause parser ever swallowed
  // these, the rule above would pass by seeing nothing.
  const { clauses } = scanAll();
  const uses = (file: string, marker: string) =>
    clauses.filter((c) => c.file === file && c.clause.includes(marker)).length;
  assert.equal(uses("src/lib/lesson.ts", "${MODULE_ORDER}"), 1, "getLessonCatalog");
  assert.equal(uses("src/lib/progression-db.ts", "${MODULE_ORDER}"), 1, "the progression walk");
  assert.equal(uses("src/lib/subject-queries.ts", "${MODULE_ORDER}"), 1, "the subject home");
  assert.equal(uses("src/lib/spine-lo-query.ts", "${MODULE_ORDER}"), 2, "the skill map, both variants");
  assert.equal(uses("src/lib/overview-queries.ts", "${MODULE_ORDER}"), 1, "the Overview heatmap");
  assert.equal(uses("src/lib/visuals.ts", "${MODULE_ORDER}, v.id"), 2, "/gallery and getAllVisuals");
  assert.equal(uses("src/lib/ask.ts", "${MODULE_RANK}"), 1, "the ask context's unit list");
  assert.equal(uses("src/lib/dashboard.ts", "${MODULE_RANK}"), 1, "the progress page");
  // The three readers that take the flat list through the shared helper.
  for (const [file, cols] of [
    ["src/lib/queries.ts", '"lo.id, lo.label"'],
    ["src/lib/pipeline-queries.ts", '"lo.id, lo.label, lo.source_page"'],
    ["src/lib/ask.ts", '"lo.id, lo.label, lo.description, lo.syllabus_ref, lo.source_page"'],
  ]) {
    const code = stripComments(readFileSync(join(APP, file), "utf8"));
    assert.ok(code.includes(`catalogueObjectivesSql(${cols})`), `${file} reads through the helper`);
  }
});

test("the excepted visual reader keeps the one caller that justifies it", () => {
  // A new caller would inherit an order chosen for one lesson.
  const callers = (fn: string) =>
    sourceFiles()
      .map((f) => ({ file: relative(APP, f), code: stripComments(readFileSync(f, "utf8")) }))
      .filter((f) => new RegExp(`\\b${fn}\\(`).test(f.code))
      .map((f) => f.file)
      .sort();
  assert.deepEqual(callers("getVisualsForLos"), ["src/lib/lesson.ts", "src/lib/visuals.ts"]);
});

/* ------------------------------------------------------------------ */
/* The scanner catches what it must (negative controls)                */
/* ------------------------------------------------------------------ */

test("the scanner flags every shape the old readers had, and passes the rerouted ones", () => {
  const flagged = (src: string) => {
    const code = stripComments(src);
    const aliases = positionAliases(code);
    return orderClauses(code).filter((c) => sortsOnPosition(c, aliases));
  };
  // getStudentPlan before v0.9.2, as it was written
  assert.equal(
    flagged("db.query(`\n      SELECT id, label, order_in_parent FROM graph_nodes\n      WHERE kind = 'learning_objective' ORDER BY order_in_parent\n    `)").length,
    1
  );
  // ask.ts's module list: the clause split over two lines
  assert.deepEqual(
    flagged("`SELECT id, label FROM graph_nodes WHERE kind = 'module'\n        ORDER BY CASE WHEN id LIKE 'module:geo%' THEN 1 ELSE 0 END,\n                 order_in_parent, id\n      `"),
    ["ORDER BY CASE WHEN id LIKE 'module:geo%' THEN 1 ELSE 0 END, order_in_parent, id"]
  );
  // the progress page before v0.9.2: a module position, qualified
  assert.equal(flagged("`GROUP BY mod.id ORDER BY (x = 0), mastery ASC, mod.order_in_parent`").length, 1);
  // sorting on an alias of the position
  assert.equal(
    flagged("`SELECT m.order_in_parent AS module_order FROM t ORDER BY module_order, lo_id`").length,
    1
  );
  // inside a window, lowercase, and ahead of a LIMIT
  assert.equal(flagged("`row_number() OVER (PARTITION BY m ORDER BY lo.order_in_parent) AS rn`").length, 1);
  assert.equal(flagged("`select id from graph_nodes order by order_in_parent limit 5`").length, 1);
  // a comment explaining the old sort is not the sort
  assert.equal(flagged("// it used to ORDER BY order_in_parent\nconst x = 1;").length, 0);
  assert.equal(flagged("/* ORDER BY order_in_parent */ const y = 2;").length, 0);
  // the rerouted shapes pass
  assert.equal(flagged("`SELECT lo.id FROM graph_nodes lo ORDER BY ${MODULE_ORDER}`").length, 0);
  assert.equal(flagged("`ORDER BY (a = 0), mastery ASC, ${MODULE_RANK}`").length, 0);
  assert.equal(flagged("`${BASE_SELECT}\n     ORDER BY ${MODULE_ORDER}, v.id`").length, 0);
  // a window's ORDER BY stops at its closing paren, so a later clause is its own
  assert.deepEqual(
    orderClauses("`OVER (PARTITION BY a ORDER BY b, c) AS rn FROM t ORDER BY d`"),
    ["ORDER BY b, c", "ORDER BY d"]
  );
  // the subject key: first, missing, or after the order (which does not count)
  assert.equal(subjectKeyStatus("ORDER BY ${SUBJECT_RANK}, ${MODULE_ORDER}"), "subject-first");
  assert.equal(subjectKeyStatus("ORDER BY (a = 0), mastery ASC, ${SUBJECT_RANK}, ${MODULE_RANK}"), "subject-first");
  assert.equal(subjectKeyStatus("ORDER BY ${MODULE_ORDER}"), "missing");
  assert.equal(subjectKeyStatus("ORDER BY ${MODULE_ORDER}, ${SUBJECT_RANK}"), "missing");
  assert.equal(subjectKeyStatus("ORDER BY lo_id, tier, id"), "none");
  // JavaScript comparators on a position are caught
  const js = sortComparators("rows.sort((a, b) => a.orderInParent - b.orderInParent)");
  assert.ok(JS_ORDER_NAMES.test(js[0]));
  assert.ok(!JS_ORDER_NAMES.test(sortComparators("xs.sort((a, b) => a.catalogRank - b.catalogRank)")[0]));
});

/* ------------------------------------------------------------------ */
/* The premise of the two in-lesson exceptions, checked on the seeds   */
/* ------------------------------------------------------------------ */

test("every seeded lesson sits in ONE module, and no two of its objectives share a position", () => {
  // What makes `lo.order_in_parent, lo.id` (resolveLessonLos) and
  // `lo.order_in_parent, v.id` (getVisualsForLos) the catalogue order inside a
  // lesson: with one module, MODULE_ORDER's term and module keys are
  // constants; with distinct positions, neither id ever decides between two
  // objectives. Checked on every bundle the loader loads for the three
  // subjects (social-t1 supersedes the skeleton).
  const bundles = [...MATHS_SEED_FILES, "arabic-t1", "arabic-t2", "social-t1"];
  const moduleOf = new Map<string, string[]>();
  const positions: { id: string; order: number | null }[] = [];
  for (const f of bundles) {
    const doc = JSON.parse(
      readFileSync(join(REPO, "services/extraction/seed", `${f}.json`), "utf8")
    ) as {
      nodes: { id: string; kind: string; order_in_parent?: number | null }[];
      edges: { src: string; dst: string; type: string }[];
    };
    for (const n of doc.nodes) {
      if (n.kind === "learning_objective") positions.push({ id: n.id, order: n.order_in_parent ?? null });
    }
    for (const e of doc.edges) {
      if (e.type === "teaches") moduleOf.set(e.dst, [...(moduleOf.get(e.dst) ?? []), e.src]);
    }
  }
  const lessons = new Map<string, { id: string; order: number | null }[]>();
  for (const p of positions) {
    const slug = slugOfLo(p.id);
    lessons.set(slug, [...(lessons.get(slug) ?? []), p]);
  }
  assert.ok(lessons.size >= 60, `all three subjects' lessons were read (${lessons.size})`);
  for (const [slug, los] of lessons) {
    // the LIKE the reader runs: 'lo:<slug>-%'
    assert.ok(los.every((l) => l.id.startsWith(`lo:${slug}-`)), slug);
    const modules = new Set(los.flatMap((l) => moduleOf.get(l.id) ?? []));
    assert.equal(modules.size, 1, `lesson ${slug} is taught by one module (${[...modules]})`);
    for (const l of los) assert.equal((moduleOf.get(l.id) ?? []).length, 1, `${l.id}: one teaches edge`);
    const orders = los.map((l) => l.order);
    assert.ok(orders.every((o) => o != null), `${slug}: every objective has a position`);
    assert.equal(new Set(orders).size, orders.length, `${slug}: positions are distinct`);
  }
});
