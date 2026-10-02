/**
 * Export the review gate's fix list as JSON (migration 036; Samuel's answer 37).
 *
 *   npm run review:export-fixes                     # to stdout
 *   npm run review:export-fixes -- --out fixes.json  # to a file
 *
 * which is:
 *
 *   node --import ./scripts/load-env.mjs --import ./scripts/ts-resolver.mjs scripts/export-review-fixes.mts
 *
 * The same list the console's "Export JSON" link downloads
 * (`GET /api/console/review/fix-requests`): every item whose latest human
 * decision is "fix requested" and that has not changed since, and every
 * rejection the gate cannot carry out by itself (a misconception, worked
 * example, objective or prerequisite link). It is what the pipeline and its
 * agents work from; an item they fix leaves the list on its own, because its
 * content fingerprint no longer matches the request, and goes back to the
 * reviewers' queue.
 *
 * READ-ONLY. It runs as `ainext_maint` (scripts' seam, `lib/db.ts`) because a
 * pipeline job has no operator session; it writes nothing, and the
 * environment it reports is `AINEXT_ENVIRONMENT`'s — decisions are never
 * pooled across environments.
 */

import { writeFileSync } from "node:fs";

import { maintPool, withMaint } from "../src/lib/db.ts";
import { ENVIRONMENT } from "../src/lib/env.ts";
import { fixList } from "../src/lib/review-gate-queries.ts";

const at = process.argv.indexOf("--out");
const out = at > 0 ? process.argv[at + 1] : null;
if (at > 0 && !out) {
  console.error("--out needs a file path");
  process.exit(2);
}

const entries = await withMaint((c) => fixList(c, ENVIRONMENT));
const json = JSON.stringify({ environment: ENVIRONMENT, exportedAt: new Date().toISOString(), entries }, null, 2);
if (out) {
  writeFileSync(out, json + "\n");
  console.error(`review fix list: ${entries.length} entr${entries.length === 1 ? "y" : "ies"} → ${out}`);
} else {
  process.stdout.write(json + "\n");
}
await maintPool().end();
