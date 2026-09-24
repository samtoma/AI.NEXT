/**
 * FR-3215, read off the source: the skill map's objectives come out of the
 * database in catalogue order, and nothing downstream re-sorts them by the
 * per-module position that caused the "random" map.
 *
 * `lib/queries.ts` cannot be imported under plain `node` (it reaches
 * `next/headers` through the auth modules), so `spineDataOn` is checked as
 * text, comments stripped; the SQL it runs lives in `lib/spine-lo-query.ts`
 * and is imported and checked as the strings it really is.
 *
 * @covers FR-3215
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { MODULE_ORDER } from "./module-order.ts";
import { SPINE_LO_SQL, SPINE_LO_SQL_NO_SUBJECT_VIEW } from "./spine-lo-query.ts";

const path = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const src = (rel: string) => readFileSync(path(rel), "utf8");
/** Source with comments removed, so a comment that explains the old
 *  `ORDER BY order_in_parent` cannot satisfy or trip an assertion. */
const code = (rel: string) =>
  src(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** The body of `spineDataOn`, up to the next top-level function. */
function spineDataOnBody(): string {
  const all = code("lib/queries.ts");
  const start = all.indexOf("async function spineDataOn(");
  assert.ok(start >= 0, "spineDataOn exists");
  const rest = all.slice(start + 1);
  const end = rest.search(/\n(export )?(async )?function /);
  return all.slice(start, end < 0 ? undefined : start + 1 + end);
}

const BARE_ORDER = /ORDER BY\s+(\w+\.)?order_in_parent\b/;

test("spineDataOn runs the catalogue-ordered query in both branches, and no bare order_in_parent sort", () => {
  const body = spineDataOnBody();
  assert.match(
    squash(body),
    /const loQuery = hasSubjectView \? SPINE_LO_SQL : SPINE_LO_SQL_NO_SUBJECT_VIEW;/
  );
  assert.doesNotMatch(body, BARE_ORDER);
  assert.doesNotMatch(body, /FROM graph_nodes/, "no inline objective query left behind");
  assert.match(
    code("lib/queries.ts"),
    /import \{ SPINE_LO_SQL, SPINE_LO_SQL_NO_SUBJECT_VIEW \} from "\.\/spine-lo-query";/
  );
});

test("both variants of the query join the module and ORDER BY MODULE_ORDER, which ends in lo.id", () => {
  for (const [name, sql] of Object.entries({ SPINE_LO_SQL, SPINE_LO_SQL_NO_SUBJECT_VIEW })) {
    const s = squash(sql);
    assert.ok(s.endsWith(`ORDER BY ${squash(MODULE_ORDER)}`), `${name} ends in ORDER BY MODULE_ORDER`);
    assert.doesNotMatch(sql, BARE_ORDER, name);
    // the join MODULE_ORDER's aliases need — LEFT, so an objective with no
    // module keeps its card; open edges only
    assert.match(
      s,
      /FROM graph_nodes lo LEFT JOIN graph_edges te ON te\.dst_id = lo\.id AND te\.edge_type = 'teaches' AND te\.system_to IS NULL LEFT JOIN graph_nodes m ON m\.id = te\.src_id AND m\.kind = 'module'/,
      name
    );
    assert.equal(
      s.match(/\bJOIN\b/g)?.length,
      s.match(/\bLEFT JOIN\b/g)?.length,
      `${name}: every join is a LEFT JOIN`
    );
    assert.match(s, /WHERE lo\.kind = 'learning_objective'/, name);
  }
  // deterministic: the last key is the primary key
  assert.match(squash(MODULE_ORDER), /lo\.id$/);
  assert.match(squash(SPINE_LO_SQL), /LEFT JOIN node_subject ns ON ns\.node_id = lo\.id/);
  assert.match(squash(SPINE_LO_SQL), /, ns\.subject FROM/);
  assert.doesNotMatch(SPINE_LO_SQL_NO_SUBJECT_VIEW, /node_subject|ns\./);
});

test("the catalogue rank is the row index of that ordered, gated query, and prerequisites follow it", () => {
  const body = squash(spineDataOnBody());
  assert.match(body, /const ids = losRes\.rows\.map\(\(r\) => r\.id as string\);/);
  assert.match(body, /const rankOf = new Map\(ids\.map\(\(id, i\) => \[id, i\]\)\);/);
  assert.match(body, /catalogRank: rank\(r\.id\),/);
  assert.match(body, /for \(const list of prereqsOf\.values\(\)\) list\.sort\(\(a, b\) => rank\(a\) - rank\(b\)\);/);
  // the gate and the de-duplication narrow the rows BEFORE ids are taken
  assert.ok(body.indexOf("seenLo.add(id)") < body.indexOf("const ids = losRes.rows"));
});

test("nothing on the skill map re-sorts topics by their position in the module", () => {
  // The layout's only tie-break is catalogRank …
  const layout = code("lib/spine-layout.ts");
  assert.doesNotMatch(layout, /orderInParent/);
  assert.match(layout, /a\.catalogRank - b\.catalogRank/);
  // … and no spine component reads orderInParent or sorts the topic list.
  const dir = path("components/spine");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))) {
    const c = code(`components/spine/${f}`);
    assert.doesNotMatch(c, /orderInParent/, f);
    assert.doesNotMatch(c, /\blos\b[\w.]*\.sort\(|\bLos\b[\w.]*\.sort\(/, `${f} sorts the topics`);
  }
  // GraphCanvas renders the pure layout rather than carrying its own copy
  const canvas = code("components/spine/GraphCanvas.tsx");
  assert.match(canvas, /layoutSpine\(los, width\)/);
  assert.doesNotMatch(canvas, /function layout\(/);
});
