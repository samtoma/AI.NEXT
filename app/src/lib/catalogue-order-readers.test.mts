/**
 * FR-3217, reader by reader, read off the source: each reader rerouted in
 * v0.9.2 takes its order from lib/module-order.ts and from nowhere else, and
 * the order itself is the one v0.9.1 shipped (the progression walks it, so it
 * must not move under the students already on it).
 *
 * Most of these readers cannot be imported under plain `node` — they reach
 * `next/headers` through the auth modules — so, like `spine-order-scan`, the
 * functions are checked as text with comments stripped, and the shared SQL
 * is imported and checked as the strings it really is. What the SQL RETURNS
 * is proved against a scratch database in `catalogue-order-db.test.mts`
 * (opt-in), and the practice plan's use of it by `student-plan-order.test.mts`.
 *
 * @covers FR-3217
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  COURSE_RANK,
  LO_MODULE_JOIN,
  MODULE_ORDER,
  MODULE_RANK,
  SUBJECT_RANK,
  catalogueObjectivesSql,
} from "./module-order.ts";
import { COURSE_IDS, COURSES } from "./courses.ts";
import { SUBJECT_IDS } from "./subjects.ts";
import { SPINE_LO_SQL, SPINE_LO_SQL_NO_SUBJECT_VIEW } from "./spine-lo-query.ts";

const src = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const code = (rel: string) =>
  src(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** The body of a top-level function, up to the next top-level function. */
function bodyOf(rel: string, signature: string): string {
  const all = code(rel);
  const start = all.indexOf(signature);
  assert.ok(start >= 0, `${rel}: ${signature} exists`);
  const rest = all.slice(start + 1);
  const end = rest.search(/\n(export )?(async )?function /);
  return all.slice(start, end < 0 ? undefined : start + 1 + end);
}

/** The template literal (backticks, no nested ones) that contains `marker`,
 *  with its SQL `--` comments removed. */
function templateWith(rel: string, marker: string): string {
  const all = code(rel);
  const at = all.indexOf(marker);
  assert.ok(at >= 0, `${rel}: ${marker}`);
  const open = all.lastIndexOf("`", at);
  const close = all.indexOf("`", at);
  return all.slice(open + 1, close).replace(/--[^\n]*/g, "");
}

/* ------------------------------------------------------------------ */
/* The definition                                                      */
/* ------------------------------------------------------------------ */

const TERM_RANK =
  "CASE WHEN m.id LIKE 'module:geo%' THEN 2 WHEN m.id LIKE 'module:t2-%' THEN 1 ELSE 0 END";

test("MODULE_ORDER is exactly the order v0.9.1 shipped — the progression's sequence does not move", () => {
  assert.equal(
    squash(MODULE_ORDER),
    `${TERM_RANK}, m.order_in_parent NULLS LAST, lo.order_in_parent, lo.id`
  );
});

test("MODULE_RANK is the same order for modules: the same term rank and position, then m.id", () => {
  assert.equal(squash(MODULE_RANK), `${TERM_RANK}, m.order_in_parent NULLS LAST, m.id`);
  // built on the one prefix, so the two can never disagree about terms
  const prefix = `${TERM_RANK}, m.order_in_parent NULLS LAST`;
  assert.ok(squash(MODULE_ORDER).startsWith(prefix));
  assert.ok(squash(MODULE_RANK).startsWith(prefix));
  assert.doesNotMatch(MODULE_RANK, /\blo\./, "no objective alias in a module-level order");
});

test("COURSE_RANK is the course registry's order, read from lib/courses.ts — not a second list (003)", () => {
  const r = squash(COURSE_RANK);
  const courses: readonly string[] = COURSE_IDS;
  // What the registry says today (lib/courses.ts): curriculum, then subject,
  // then course. The three National courses keep the positions the subject
  // registry gave them — maths, Social Studies, Arabic — so every list a
  // National student sees is ordered as it was; the American course follows.
  assert.deepEqual(courses, [
    "course:prep3-math-en",
    "course:prep3-social-ar",
    "course:prep3-arabic-ar",
    "course:us-g10-math-en",
  ]);
  assert.deepEqual(
    courses.slice(0, 3).map((c) => COURSES[c as keyof typeof COURSES].subject),
    SUBJECT_IDS,
    "the National courses in subject-registry order"
  );
  const whens = [...r.matchAll(/WHEN '([^']+)' THEN (\d+)/g)].map((m) => [m[1], Number(m[2])]);
  assert.deepEqual(whens, courses.map((c, i) => [c, i]), "one WHEN per registry course, in registry order");
  // the pre-003 name is the same SQL, kept for one release (plan A1)
  assert.equal(SUBJECT_RANK, COURSE_RANK);
  // no course, or a course the registry does not know: after every subject
  assert.ok(r.endsWith(`), ${courses.length})`), "coalesce(…, n): unknown sorts last");
  // the module's own OPEN part_of edges; only the m alias every reader has
  assert.match(r, /FROM graph_edges pe WHERE pe\.src_id = m\.id AND pe\.edge_type = 'part_of' AND pe\.system_to IS NULL/);
  assert.doesNotMatch(r, /\blo\./);
});

test("catalogueObjectivesSql: every objective, LEFT JOINed to its module, course first, then MODULE_ORDER", () => {
  const s = squash(catalogueObjectivesSql("lo.id, lo.label"));
  assert.ok(s.startsWith("SELECT lo.id, lo.label FROM graph_nodes lo "), s);
  assert.ok(
    s.endsWith(`ORDER BY ${squash(COURSE_RANK)}, ${squash(MODULE_ORDER)}`),
    "the course, then the one order"
  );
  assert.match(
    s,
    /FROM graph_nodes lo LEFT JOIN graph_edges te ON te\.dst_id = lo\.id AND te\.edge_type = 'teaches' AND te\.system_to IS NULL LEFT JOIN graph_nodes m ON m\.id = te\.src_id AND m\.kind = 'module' WHERE lo\.kind = 'learning_objective'/
  );
  // LEFT only: an objective with no module is kept, never dropped
  assert.equal(s.match(/\bJOIN\b/g)?.length, s.match(/\bLEFT JOIN\b/g)?.length);
  // the columns are the caller's, and nothing else about the statement is
  assert.equal(
    squash(catalogueObjectivesSql("lo.id")).replace("SELECT lo.id ", ""),
    s.replace("SELECT lo.id, lo.label ", "")
  );
});

test("the skill map shares the same join — it moved to module-order.ts with its text unchanged", () => {
  for (const sql of [SPINE_LO_SQL, SPINE_LO_SQL_NO_SUBJECT_VIEW]) {
    assert.ok(squash(sql).includes(squash(`FROM graph_nodes lo${LO_MODULE_JOIN}`)));
  }
  assert.match(code("lib/spine-lo-query.ts"), /import \{ LO_MODULE_JOIN, MODULE_ORDER \} from "\.\/module-order";/);
  assert.doesNotMatch(code("lib/spine-lo-query.ts"), /const LO_MODULE_JOIN/, "no second copy");
});

/* ------------------------------------------------------------------ */
/* The readers                                                         */
/* ------------------------------------------------------------------ */

test("getStudentPlan (/student?mode=practice): the catalogue read, with catalogue order as the tie-break", () => {
  const body = bodyOf("lib/queries.ts", "async function studentPlanOn(");
  assert.match(body, /\(\) => db\.query\(catalogueObjectivesSql\("lo\.id, lo\.label"\)\),/);
  assert.doesNotMatch(body, /kind = 'learning_objective'/, "no inline objective query left behind");
  assert.doesNotMatch(body, /order_in_parent/);
  const b = squash(body);
  // the rank is the row index of that ordered read
  assert.match(b, /const loIds = losRes\.rows\.map\(\(r\) => r\.id as string\);/);
  assert.match(b, /const rank = new Map\(loIds\.map\(\(id, i\) => \[id, i\]\)\);/);
  // "weakest first" stays the primary key; catalogue order breaks its ties
  assert.match(
    b,
    /const byScoreAsc = \[\.\.\.loIds\]\.sort\( \(a, b\) => \(score\.get\(a\) \?\? 0\) - \(score\.get\(b\) \?\? 0\) \|\| byCatalogue\(a, b\) \);/
  );
  assert.match(
    b,
    /\.sort\( \(a, b\) => \(score\.get\(b\) \?\? 0\) - \(score\.get\(a\) \?\? 0\) \|\| byCatalogue\(a, b\) \);/,
    "review: strongest first, then catalogue order"
  );
  // the gate narrows the rows in place, so the ranks are the gated order
  assert.ok(b.indexOf("losRes.rows = losRes.rows.filter") < b.indexOf("const loIds ="));
  assert.match(code("lib/queries.ts"), /import \{ catalogueObjectivesSql \} from "\.\/module-order";/);
});

test("/pipeline's mini-map reads its objectives through the same helper", () => {
  const body = bodyOf("lib/pipeline-queries.ts", "async function pipelineDataOn(");
  assert.match(body, /\(\) => db\.query\(catalogueObjectivesSql\("lo\.id, lo\.label, lo\.source_page"\)\),/);
  assert.doesNotMatch(body, /kind = 'learning_objective' ORDER BY/);
  // the stage lays each layer out in the order it is handed
  assert.match(squash(body), /const loIds = loRes\.rows\.map\(\(row\) => row\.id as string\);/);
});

test("the console Overview's heatmap rows: the shared join, ORDER BY MODULE_ORDER", () => {
  // One COURSE since 003 (FR-4104): `ns.course_id`, never `ns.subject`, so
  // two maths courses are never one heatmap.
  const sql = squash(templateWith("lib/overview-queries.ts", "AS module_ordinal"));
  assert.match(sql, /FROM node_subject ns JOIN graph_nodes lo ON lo\.id = ns\.node_id\$\{LO_MODULE_JOIN\} WHERE ns\.course_id = \$1 ORDER BY \$\{MODULE_ORDER\}$/);
  assert.match(
    code("lib/overview-queries.ts"),
    /import \{ LO_MODULE_JOIN, MODULE_ORDER \} from "@\/lib\/module-order";/
  );
});

test("/gallery: every course's figures — course first, then MODULE_ORDER, then the figure's id", () => {
  const body = squash(bodyOf("lib/visuals.ts", "export async function getGalleryData("));
  assert.match(body, /`\$\{BASE_SELECT\} ORDER BY \$\{COURSE_RANK\}, \$\{MODULE_ORDER\}, v\.id`/);
  // BASE_SELECT carries the aliases MODULE_ORDER reads
  const base = squash(templateWith("lib/visuals.ts", "FROM visuals v"));
  assert.match(base, /JOIN graph_nodes lo ON lo\.id = v\.lo_id/);
  assert.match(base, /LEFT JOIN graph_nodes m ON m\.id = e\.src_id AND m\.kind = 'module'/);
});

test("the progress page: started topics first, weakest first, then course, then MODULE_RANK", () => {
  const sql = squash(templateWith("lib/dashboard.ts", "WITH module_lo AS"));
  assert.match(sql, /FROM ranked r JOIN graph_nodes m ON m\.id = r\.module_id GROUP BY m\.id, m\.label, m\.order_in_parent/);
  assert.match(sql, /ORDER BY \(coalesce\(sum\(r\.attempts\), 0\) = 0\), mastery ASC, \$\{COURSE_RANK\}, \$\{MODULE_RANK\}$/);
  assert.doesNotMatch(sql, /\bmod\./, "the old alias is gone, so MODULE_RANK's m is the module");
  assert.match(code("lib/dashboard.ts"), /import \{ COURSE_RANK, MODULE_RANK \} from "@\/lib\/module-order";/);
});

test("the lesson catalogue lists every course: course first, then MODULE_ORDER", () => {
  const body = squash(bodyOf("lib/lesson.ts", "export async function getLessonCatalog("));
  assert.match(body, /db\.query\(`\$\{LO_MODULE_SELECT\} ORDER BY \$\{COURSE_RANK\}, \$\{MODULE_ORDER\}`\)/);
  assert.match(code("lib/lesson.ts"), /import \{ COURSE_RANK, MODULE_ORDER \} from "\.\/module-order";/);
});

test("the single-subject readers keep MODULE_ORDER alone — the order progression walks is untouched", () => {
  assert.match(code("lib/progression-db.ts"), /db\.query\(`\$\{LO_MODULE_SELECT\} ORDER BY \$\{MODULE_ORDER\}`\)/);
  assert.match(code("lib/subject-queries.ts"), /WHERE lo\.kind = 'learning_objective'\s+ORDER BY \$\{MODULE_ORDER\}`/);
});

test("the ask context (lib/ask.ts): every course — course first, then the one order; edges fixed", () => {
  // Samuel, 2026-09-25, lifting ADR-0020's hold for this ordering: "yes for
  // sure, for decision 2, it is part of the overall consistency".
  const body = squash(bodyOf("lib/ask.ts", "async function askContextOn("));
  assert.match(
    body,
    /db\.query\( catalogueObjectivesSql\("lo\.id, lo\.label, lo\.description, lo\.syllabus_ref, lo\.source_page"\) \)/
  );
  assert.match(
    body,
    /SELECT m\.id, m\.label FROM graph_nodes m WHERE m\.kind = 'module' ORDER BY \$\{COURSE_RANK\}, \$\{MODULE_RANK\}/
  );
  assert.doesNotMatch(body, /order_in_parent/, "no bare position sort left");
  // the catalogue rank is the row index of the ordered, GATED objective read
  assert.match(body, /const catalogRank = new Map\(losRes\.rows\.map\(\(l, i\) => \[l\.id as string, i\]\)\);/);
  assert.ok(body.indexOf("const losRes = {") < body.indexOf("const catalogRank"));
  // focus: weakest first, catalogue order breaks the ties
  assert.match(
    body,
    /const byWeakness = \[\.\.\.losRes\.rows\]\.sort\( \(a, b\) => \(current\.get\(a\.id\) \?\? 0\) - \(current\.get\(b\.id\) \?\? 0\) \|\| byCatalogue\(a\.id, b\.id\) \);/
  );
  // edges: source, then destination, in catalogue order, then edge id
  assert.match(
    body,
    /\.sort\( \(a, b\) => byCatalogue\(a\.src_id, b\.src_id\) \|\| byCatalogue\(a\.dst_id, b\.dst_id\) \|\| Number\(a\.id\) - Number\(b\.id\) \)/
  );
  assert.match(body, /SELECT id, src_id, dst_id FROM graph_edges WHERE edge_type = 'prerequisite_of' AND system_to IS NULL/);
  assert.match(code("lib/ask.ts"), /import \{ COURSE_RANK, MODULE_RANK, catalogueObjectivesSql \} from "\.\/module-order";/);
});

test("getAllVisuals (the ask context's figure catalogue): course first, then MODULE_ORDER, then the figure's id", () => {
  const body = squash(bodyOf("lib/visuals.ts", "export async function getAllVisuals("));
  assert.match(body, /`\$\{BASE_SELECT\} ORDER BY \$\{COURSE_RANK\}, \$\{MODULE_ORDER\}, v\.id`/);
});
