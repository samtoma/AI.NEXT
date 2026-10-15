/**
 * "Can the tutor teach this?" — after a compiled load, build every compiled lesson with the app's OWN lesson code.
 *
 *   DATABASE_URL=postgres://ainext_app:ainext_app@127.0.0.1:5432/<database> \
 *     node --import ./scripts/ts-resolver.mjs scripts/lesson-smoke.mts \
 *     ../services/extraction/compiled/<book>/compile-report.json [--lessons u1-1,u1-2]
 *
 * The compile step (services/extraction/compile_book_records.py) checks what it can about a bundle on its own:
 * notation, KaTeX, the app's field lists. What it cannot see is whether the app, reading the loaded database, can
 * actually teach the lesson. This script asks the same functions `/api/ask` uses, with no student in scope (the
 * capture-prompts convention: the curriculum half is real, the student half is the documented "no signal" state),
 * so it reads and writes nothing a student owns.
 *
 * Per lesson it checks:
 *   1. the lesson resolves (`getLessonData`): its objectives are loaded and its course is one the app knows;
 *   2. its objectives are exactly the compiled ones (count and `lo:<slug>-N` ids), each with a description and a page;
 *   3. they share ONE lesson reference (`syllabus_ref`): the app groups a lesson by it, byte for byte;
 *   4. it has live questions, and every live question carries a worked solution — the tutor teaches "exclusively"
 *      from objective descriptions and live questions' worked solutions; an objective with no live question is
 *      reported (a warning: the tutor can still explain it, but has nothing to practise it with);
 *   5. both tutor surfaces build (learn and review), and what the tutor is given names every objective;
 *   6. what the tutor is given has no unspaced list comma ("{2,3}", read as a decimal) in a decimal-point book and
 *      no `align` environment (KaTeX draws it only in display mode).
 * Exits 1 when any check fails, 0 otherwise. Warnings never fail it.
 */
import { readFileSync } from "node:fs";

import { pool } from "../src/lib/db.ts";
import * as lesson from "../src/lib/lesson.ts";

type Report = {
  book: string;
  printed_decimal?: string;
  lessons: Record<string, { objectives: number; questions: number; held: number }>;
};

const args = process.argv.slice(2);
const reportPath = args.find((a) => !a.startsWith("--"));
if (!reportPath) {
  console.error("usage: lesson-smoke.mts <compile-report.json> [--lessons a,b]");
  process.exit(2);
}
const report = JSON.parse(readFileSync(reportPath, "utf8")) as Report;
const only = args.includes("--lessons") ? args[args.indexOf("--lessons") + 1].split(",") : null;
const slugs = Object.keys(report.lessons).filter((s) => !only || only.includes(s));

let failed = 0;
const fail = (slug: string, msg: string) => {
  failed++;
  console.log(`  ✗ ${slug}: ${msg}`);
};
const warn = (slug: string, msg: string) => console.log(`  ! ${slug}: ${msg}`);

for (const slug of slugs) {
  const expected = report.lessons[slug];
  console.log(`${slug}`);
  let data: Awaited<ReturnType<typeof lesson.getLessonData>> = null;
  try {
    data = await lesson.getLessonData(slug, null);
  } catch (e) {
    fail(slug, `the app cannot build it: ${(e as Error).message}`);
    continue;
  }
  if (!data) {
    fail(slug, "the app found no objectives for it (not loaded, or its course is gated)");
    continue;
  }
  if (data.slug !== slug) {
    fail(slug, `the app resolved it to another lesson, ${data.slug} (an unknown slug falls back to the default lesson)`);
    continue;
  }
  // 2. the compiled objectives, no more and no fewer
  const ids = data.los.map((l) => l.id);
  if (ids.length !== expected.objectives) fail(slug, `${ids.length} objectives loaded, ${expected.objectives} compiled`);
  const foreign = ids.filter((id) => !new RegExp(`^lo:${slug}-\\d+$`).test(id));
  if (foreign.length) fail(slug, `objectives with ids of another lesson: ${foreign.join(", ")}`);
  for (const l of data.los) {
    if (!l.description) fail(slug, `${l.id} has no description: the tutor teaches from it`);
    if (l.sourcePage == null) warn(slug, `${l.id} has no page: the tutor cannot cite one`);
  }
  // 3. one lesson reference
  const refs = await pool.query<{ syllabus_ref: string | null }>(
    "SELECT DISTINCT syllabus_ref FROM graph_nodes WHERE kind = 'learning_objective' AND id LIKE $1",
    [`lo:${slug}-%`]
  );
  if (refs.rows.length !== 1) fail(slug, `objectives carry ${refs.rows.length} different lesson references: ${refs.rows.map((r) => r.syllabus_ref).join(" | ")}`);
  // 4. live questions with worked solutions
  const live = data.questions;
  if (!live.length) fail(slug, "no live question: the tutor has no worked solution to teach from");
  const unsolved = live.filter((q) => !q.solution || q.solution.length === 0);
  if (unsolved.length) fail(slug, `live questions with no worked solution: ${unsolved.map((q) => q.id).join(", ")}`);
  const practised = new Set(live.map((q) => q.loId));
  const bare = data.los.filter((l) => !practised.has(l.id)).map((l) => l.id);
  if (bare.length) warn(slug, `objectives with no live question (explained, not practised): ${bare.join(", ")}`);
  // 5. both surfaces build, and name every objective
  for (const mode of ["learn", "review"] as const) {
    let ctx: Awaited<ReturnType<typeof lesson.buildLessonContext>> = null;
    try {
      ctx = await lesson.buildLessonContext(mode, "lesson-smoke", slug);
    } catch (e) {
      fail(slug, `${mode}: the tutor's context did not build: ${(e as Error).message}`);
      continue;
    }
    if (!ctx) {
      fail(slug, `${mode}: no tutor context`);
      continue;
    }
    const given = `${ctx.systemPrompt}\n${ctx.dataBlock}`;
    const missing = data.los.filter((l) => !given.includes(l.label)).map((l) => l.id);
    if (missing.length) fail(slug, `${mode}: the tutor is not given objective(s) ${missing.join(", ")}`);
    // 6. notation in what the tutor reads
    if (mode === "learn") {
      if ((report.printed_decimal ?? "point") === "point") {
        const commas = ctx.dataBlock.match(/[{(][^{}()]*\d,\d[^{}()]*[})]/g) ?? [];
        if (commas.length) fail(slug, `unspaced list comma(s) the app reads as decimals: ${commas.slice(0, 3).join("  ")}`);
      }
      if (/\\begin\{align\*?\}/.test(ctx.dataBlock)) fail(slug, "an align environment KaTeX cannot draw inline");
    }
  }
  console.log(`  ${data.los.length} objectives, ${live.length} live questions (${expected.held} held at compile)`);
}

await pool.end();
console.log(failed ? `\n${failed} check(s) failed` : `\nevery lesson can be taught (${slugs.length})`);
process.exit(failed ? 1 : 0);
