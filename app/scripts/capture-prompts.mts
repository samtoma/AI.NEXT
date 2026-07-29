/**
 * Prompt regression capture — the Wave A byte-identity proof
 * (docs/specs/multi-subject-app.md, Wave A step 3).
 *
 * Renders every maths + social prompt surface to files so two checkouts
 * (main vs the registry refactor) can be diffed byte-for-byte against the
 * SAME local database. Run it from app/:
 *
 *   node scripts/capture-prompts.mts /tmp/prompts-branch
 *   (cp the script into a main worktree, run again, then `diff -r`)
 *
 * The script deliberately calls only APIs whose signatures exist on BOTH
 * sides (extra optional params on the branch keep their defaults), and it
 * captures the full model-visible payload: systemPrompt + dataBlock +
 * grounding for the ask surfaces, and both lesson modes for every lesson
 * in the catalog.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const outDir = process.argv[2];
if (!outDir) throw new Error("usage: node scripts/capture-prompts.mts <outDir>");

const lesson = await import("../src/lib/lesson.ts");
const ask = await import("../src/lib/ask.ts");
const { pool } = await import("../src/lib/db.ts");

await mkdir(outDir, { recursive: true });
const write = (name: string, text: string) =>
  writeFile(path.join(outDir, name), text ?? "");

// 1) Every lesson surface, both modes: systemPrompt + dataBlock + grounding.
const catalog = await lesson.getLessonCatalog();
await write(
  "catalog.txt",
  catalog.map((i: { slug: string; title: string }) => `${i.slug}\t${i.title}`).join("\n")
);
for (const info of catalog) {
  for (const mode of ["learn", "review"] as const) {
    const ctx = await lesson.buildLessonContext(mode, "capture-session", info.slug);
    await write(`lesson-${info.slug}-${mode}-system.txt`, ctx.systemPrompt);
    await write(`lesson-${info.slug}-${mode}-data.txt`, ctx.dataBlock);
    await write(
      `lesson-${info.slug}-${mode}-grounding.json`,
      JSON.stringify(ctx.grounding, null, 2)
    );
  }
}

// 2) Ask-the-Spine: observer (no question), one maths question, one social
//    question — on both surfaces, with a wrong answer where a question is
//    in scope (exercises the re-explain mode blocks).
const PICKS: (string | null)[] = [null, "q:geo1-1-1:001", "q:soc1-1:africa:01"];
for (const qid of PICKS) {
  for (const surface of ["spine_chat", "student_chat"] as const) {
    const ctx = await ask.buildAskContext(
      surface,
      "capture-session",
      qid ?? undefined,
      qid ? "capture-wrong-answer" : undefined
    );
    const slug = `${surface}-${qid ? qid.replace(/[^a-zA-Z0-9]+/g, "_") : "none"}`;
    await write(`ask-${slug}-system.txt`, ctx.systemPrompt);
    await write(`ask-${slug}-data.txt`, ctx.dataBlock);
    await write(`ask-${slug}-grounding.json`, JSON.stringify(ctx.grounding, null, 2));
  }
}

await pool.end();
console.log(`captured ${catalog.length} lessons + ${PICKS.length * 2} ask surfaces → ${outDir}`);
