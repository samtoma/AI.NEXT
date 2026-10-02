/**
 * Prompt regression capture — constitution IX's proof mechanism.
 *
 * Renders every model-visible prompt surface to files so two states of the tree
 * can be diffed byte-for-byte against the SAME local database. Run it from
 * `app/`:
 *
 *   node --import ./scripts/ts-resolver.mjs scripts/capture-prompts.mts <outDir>
 *
 * or, with the `.env` files loaded for you (the usual case on a fresh shell):
 *
 *   npm run capture:prompts -- <outDir>
 *
 * Take one capture, make the change, take another, `diff -r` the two. The
 * resolver is not optional: the app's lib modules import through the `@/` alias
 * and reach `next/headers`, neither of which plain `node` resolves. Until P6
 * the `next/headers` import failed outright, so every gate that claimed to run
 * this script was reporting the same crash on both sides of its comparison —
 * see `scripts/ts-resolver.mjs`.
 *
 * The script captures with NO student in scope (`studentId` defaults to null).
 * That is deliberate and it is what makes the diff readable: the curriculum
 * half of every prompt is real, the student half is the documented "no signal"
 * state, and nothing in the output depends on which rows happen to be in the
 * local `students` table. Per-student rendering — the address register for a
 * girl, a boy, and a student who has not said — is proved by the unit tests in
 * `src/lib/address.test.mts` and `src/lib/prompt-address.test.mts`, which need
 * no database and therefore no fixtures to keep in sync.
 *
 * It calls only APIs whose signatures exist on both sides of whatever is being
 * compared (extra optional params keep their defaults), and it captures the
 * FULL model-visible payload: systemPrompt + dataBlock + grounding for the ask
 * and lesson surfaces, and both prompts of the two surfaces that were invisible
 * to this harness until P6 — the comprehension grader and the upload parser.
 *
 * FEATURE 003 — A SECOND CURRICULUM (FR-4205, FR-4206). The National question
 * picks below are FIXED: they are what every National capture since P6 has
 * rendered, and the byte-identity proof compares them. A course of any OTHER
 * curriculum gets its picks from its own data instead — its first live
 * question in catalogue order, not a widget where one exists — so a new
 * curriculum is captured without a new line here. A fixed pick that is not a
 * live question in the database being captured is skipped rather than
 * rendered as an empty "question in scope". Neither rule changes a capture of
 * a database holding only the National courses.
 *
 * The Grade 10 course has no content yet, so its prompts are captured from a
 * FIXTURE (`src/lib/g10-prompt-fixture.mts`) loaded into a scratch database
 * that holds nothing else — which is also exactly what the tutor sees for a
 * Grade 10 student, since the course gate shows her that course alone:
 *
 *   createdb ainext_scratch_g10
 *   pg_dump --schema-only --no-owner ainext_mvp1 | psql -q ainext_scratch_g10
 *   node --import ./scripts/ts-resolver.mjs src/lib/g10-prompt-fixture.mts postgres://127.0.0.1/ainext_scratch_g10
 *   DATABASE_URL=postgres://127.0.0.1/ainext_scratch_g10 node --import ./scripts/ts-resolver.mjs scripts/capture-prompts.mts <outDir>
 *   dropdb ainext_scratch_g10
 *
 * `src/lib/g10-prompts.test.mts` holds the same prompts as committed goldens,
 * rendered without a database.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { COURSE_IDS, COURSES } from "../src/lib/courses.ts";
import { DEFAULT_CURRICULUM } from "../src/lib/curricula.ts";

/** The ask-surface combinations captured: a question id (or none) × surface. */
export const ASK_PICKS: readonly (string | null)[] = [
  null,
  "q:geo1-1-1:001",
  "q:soc1-1:africa:01",
];

export const ASK_SURFACES = ["spine_chat", "student_chat"] as const;

/**
 * The courses whose Ask picks come from their own data: every registry course
 * outside the National curriculum (feature 003). The National picks stay the
 * fixed `ASK_PICKS` above.
 */
export const DATA_PICK_COURSES: readonly string[] = COURSE_IDS.filter(
  (id) => COURSES[id].curriculum !== DEFAULT_CURRICULUM
);

/**
 * A course's own Ask pick: its first live question in catalogue order (the
 * catalogue's lesson order, then objective order), preferring a question with
 * an answer to be wrong about (not a widget construction). `null` when it has
 * no live question. Pure, so the rule is tested without a database.
 */
export function coursePick(
  lessonLos: readonly string[],
  live: readonly { id: string; lo_id: string; question_type: string }[]
): string | null {
  const rank = (q: { lo_id: string; question_type: string; id: string }) =>
    [lessonLos.indexOf(q.lo_id), q.question_type === "widget" ? 1 : 0] as const;
  const inCourse = live.filter((q) => lessonLos.includes(q.lo_id));
  const sorted = [...inCourse].sort((a, b) => {
    const [la, wa] = rank(a);
    const [lb, wb] = rank(b);
    return wa - wb || la - lb || a.id.localeCompare(b.id);
  });
  return sorted[0]?.id ?? null;
}

/**
 * Fixed input for the comprehension grader, so its capture is a function of the
 * code alone. A real transcript would make the diff depend on whatever a model
 * said the last time somebody ran a lesson.
 */
export const GRADER_TRANSCRIPT = [
  { role: "user", text: "ready" },
  { role: "assistant", text: "Great - let's start." },
  { role: "note", text: "q:u1-1-1:001 answered correctly" },
] as const;

/** A path the upload parser can be asked about without one existing. */
export const PARSE_SAMPLE_PATH = "/uploads/1/capture-sample.png";

/**
 * Every surface this harness renders, as names rather than files — what the
 * smoke test asserts against, so "the harness covers the grader and the
 * parser" is checked by `npm test` rather than by reading the script.
 * `lesson:*` is per-lesson and expands from the catalog at capture time.
 */
export function surfacePlan(): readonly string[] {
  return [
    "catalog",
    "lesson:<slug>:learn",
    "lesson:<slug>:review",
    ...ASK_PICKS.flatMap((qid) =>
      ASK_SURFACES.map((s) => `ask:${s}:${qid ?? "none"}`)
    ),
    // one per loaded course outside the National curriculum (feature 003)
    ...ASK_SURFACES.map((s) => `ask:${s}:<first live question of each non-National course>`),
    "understanding:learn",
    "understanding:review",
    "understanding:retry",
    "upload:parse",
  ];
}

/** Render every surface into `outDir`. Returns what it wrote. */
export async function capture(
  outDir: string
): Promise<{ lessons: number; askSurfaces: number; files: number }> {
  const lesson = await import("../src/lib/lesson.ts");
  const ask = await import("../src/lib/ask.ts");
  const understanding = await import("../src/lib/understanding-prompt.ts");
  const uploadPrompt = await import("../src/lib/upload-prompt.ts");
  const { pool } = await import("../src/lib/db.ts");

  await mkdir(outDir, { recursive: true });
  let files = 0;
  const write = async (name: string, text: string) => {
    await writeFile(path.join(outDir, name), text ?? "");
    files++;
  };

  // 1) Every lesson surface, both modes: systemPrompt + dataBlock + grounding.
  const catalog = await lesson.getLessonCatalog();
  await write(
    "catalog.txt",
    catalog
      .map((i: { slug: string; title: string }) => `${i.slug}\t${i.title}`)
      .join("\n")
  );
  for (const info of catalog) {
    for (const mode of ["learn", "review"] as const) {
      const ctx = await lesson.buildLessonContext(
        mode,
        "capture-session",
        info.slug
      );
      // `null` is the course gate refusing (migration 023), and it cannot
      // happen here: the harness renders with NO student, and a gate with
      // nobody to refuse refuses nobody. The guard is for the compiler and for
      // the day somebody gives this harness a student id — at which point the
      // diff would silently lose whole lessons instead of failing.
      if (!ctx) throw new Error(`no lesson context for ${info.slug}/${mode}`);
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
  //    in scope (exercises the re-explain mode blocks). Then each loaded course
  //    of another curriculum, by its own first question (feature 003).
  const fixed = ASK_PICKS.filter((q): q is string => q != null);
  const liveFixed = new Set(
    (
      await pool.query(`SELECT id FROM questions WHERE status = 'live' AND id = ANY($1)`, [fixed])
    ).rows.map((r: { id: string }) => r.id)
  );
  const picks: (string | null)[] = ASK_PICKS.filter((q) => q == null || liveFixed.has(q));
  for (const courseId of DATA_PICK_COURSES) {
    const lessonLos = catalog
      .filter((i: { courseId: string | null }) => i.courseId === courseId)
      .flatMap((i: { los: { id: string }[] }) => i.los.map((l) => l.id));
    if (lessonLos.length === 0) continue; // not loaded here
    const live = (
      await pool.query(
        `SELECT id, lo_id, question_type FROM questions WHERE status = 'live' AND lo_id = ANY($1)`,
        [lessonLos]
      )
    ).rows as { id: string; lo_id: string; question_type: string }[];
    const pick = coursePick(lessonLos, live);
    if (pick) picks.push(pick);
  }
  for (const qid of picks) {
    for (const surface of ASK_SURFACES) {
      const ctx = await ask.buildAskContext(
        surface,
        "capture-session",
        qid ?? undefined,
        qid ? "capture-wrong-answer" : undefined
      );
      const slug = `${surface}-${qid ? qid.replace(/[^a-zA-Z0-9]+/g, "_") : "none"}`;
      await write(`ask-${slug}-system.txt`, ctx.systemPrompt);
      await write(`ask-${slug}-data.txt`, ctx.dataBlock);
      await write(
        `ask-${slug}-grounding.json`,
        JSON.stringify(ctx.grounding, null, 2)
      );
    }
  }

  // 3) The comprehension grader (P6). Rendered from the FIRST lesson's real
  //    data and a fixed transcript: real objectives, no model in the loop.
  const graderLesson = await lesson.getLessonData(
    catalog[0]?.slug ?? lesson.DEFAULT_LESSON_SLUG
  );
  // Same guard, same reason: no student in scope means no gate, so a null here
  // is an empty spine rather than a refusal — and rendering the grader prompt
  // from nothing would write a file that diffs clean while meaning nothing.
  if (!graderLesson) throw new Error("no lesson data for the grader capture");
  await write(
    "understanding-system.txt",
    understanding.UNDERSTANDING_SYSTEM_PROMPT
  );
  for (const mode of ["learn", "review"] as const) {
    const basePrompt = understanding.buildUnderstandingPrompt({
      mode,
      los: graderLesson.los,
      studentName: graderLesson.studentName,
      grade: graderLesson.grade,
      lessonRef: graderLesson.lessonRef,
      title: graderLesson.title,
      moduleLabel: graderLesson.moduleLabel,
      transcript: GRADER_TRANSCRIPT,
    });
    await write(`understanding-${mode}.txt`, basePrompt);
    if (mode === "learn") {
      await write(
        "understanding-retry.txt",
        understanding.understandingRetryPrompt(basePrompt, "not json at all")
      );
    }
  }

  // 4) The upload parser (P6). No student, no lesson — one constant plus the
  //    path line the parser is actually handed.
  await write(
    "upload-parse.txt",
    uploadPrompt.buildUploadParsePrompt(PARSE_SAMPLE_PATH)
  );

  await pool.end();
  return {
    lessons: catalog.length,
    askSurfaces: picks.length * ASK_SURFACES.length,
    files,
  };
}

/** Only when run as a script — importing this module renders nothing and
 *  touches no database, which is what lets the smoke test import it. */
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const outDir = process.argv[2];
  if (!outDir) {
    throw new Error("usage: node scripts/capture-prompts.mts <outDir>");
  }
  const { lessons, askSurfaces, files } = await capture(outDir);
  console.log(
    `captured ${lessons} lessons + ${askSurfaces} ask surfaces + grader + parser → ${outDir} (${files} files)`
  );
}
