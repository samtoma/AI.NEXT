/**
 * THE NATIONAL PROMPTS ARE BYTE-IDENTICAL TO v0.9.2 (feature 003, FR-4206,
 * SC-207; constitution IX; ADR-0020's hold).
 *
 * Feature 003 moved the facts the tutor states about a book — its name, the
 * "school" lead of a lesson reference, the syllabus line, the lesson titles,
 * the geometry lessons, the fallback figure and example ids, the widget
 * source and review moment, the Ask prompt's example ids — out of the prompt
 * code and into the course registry (`lib/courses.ts` `CourseTutorFacts`). For
 * every National course the registry carries exactly the values the code
 * printed before. This file holds it to that without a database, so it runs
 * in `npm test` and in CI.
 *
 * It renders, through the REAL builders over a fake pool
 * (`prompt-fixture-pool.mts`), one small National curriculum chosen to reach
 * every moved fact:
 *   · u1-1 — a Prep-3 maths lesson whose title comes from the registry map,
 *     with a stored figure and an MCQ;
 *   · geo1-1 — a figure-led geometry lesson with NO stored figure (the
 *     fallback figure id, the geometry guidance and the visual review moment);
 *   · t2u1-1 — a lesson with no question and no page (the fallback example ids);
 *   · soc1-1 and ara1-1 — Social Studies and Arabic, which name their book;
 *   · the Ask surfaces with three books, one book and none, with and without
 *     a question in scope, on both surfaces; and the comprehension grader.
 *
 * `national-prompts.golden.json` was written by running THIS FILE against the
 * v0.9.2 source (`git archive v0.9.2`, with only this file and the fake pool
 * added, and this entrypoint allowed the `next/headers` stub), BEFORE any 003
 * prompt code existed. The comparison is the whole string.
 *
 * The full proof is the capture harness over a real database — 438 files,
 * before and after (`scripts/capture-prompts.mts`); this is its always-on
 * sentinel for the facts 003 moved.
 *
 * @covers FR-4206
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { installFixturePool, type FixtureCurriculum } from "./prompt-fixture-pool.mts";

const GOLDEN = fileURLToPath(new URL("./national-prompts.golden.json", import.meta.url));

const MATH = "course:prep3-math-en";
const SOCIAL = "course:prep3-social-ar";
const ARABIC = "course:prep3-arabic-ar";

const DOCS = [
  { sha256: "sha-math", title: "Mathematics — Student's Book, Preparatory Year Three, First Term", publisher: "Ministry of Education", edition: "2025", grade: "prep-3", subject: "mathematics" },
  { sha256: "sha-social", title: "الدراسات الاجتماعية — كتاب الطالب، الصف الثالث الإعدادي، الفصل الدراسي الأول", publisher: "وزارة التربية والتعليم", edition: null, grade: "prep-3", subject: "social studies" },
  { sha256: "sha-arabic", title: "اللغة العربية — لغتي حياتي، الصف الثالث الإعدادي", publisher: "وزارة التربية والتعليم", edition: null, grade: "prep-3", subject: "arabic language" },
];

const step = (n: number, text_md: string) => ({ step: n, text_md });

const NATIONAL: FixtureCurriculum = {
  docs: DOCS,
  nodes: [
    { id: "program:bakaloreya-track", kind: "program", label: "Bakaloreya track" },
    { id: MATH, kind: "course", label: "Mathematics — Prep 3", source_sha256: "sha-math" },
    { id: SOCIAL, kind: "course", label: "Social Studies — Prep 3", source_sha256: "sha-social" },
    { id: ARABIC, kind: "course", label: "Arabic — Prep 3", source_sha256: "sha-arabic" },
    { id: "module:u1", kind: "module", label: "Unit 1 — Relations and Functions", order_in_parent: 1 },
    { id: "module:t2-u1", kind: "module", label: "Term 2 · Unit 1 — Equations", order_in_parent: 4 },
    { id: "module:geo-u1", kind: "module", label: "Term 2 · Unit 4 — The Circle", order_in_parent: 6 },
    { id: "module:soc-t1-u1", kind: "module", label: "الوحدة الأولى — الجغرافيا الطبيعية للعالم", order_in_parent: 1 },
    { id: "module:ara-u1", kind: "module", label: "الوحدة الأولى — الفصل الأول — اللغة العربية", order_in_parent: 1 },
    // objectives in catalogue order: Term 1 algebra, Term 2 algebra, geometry; then Social, then Arabic
    { id: "lo:u1-1-1", kind: "learning_objective", label: "Ordered pairs and their equality", description: "Two ordered pairs are equal when their first and second projections are equal.", syllabus_ref: "Lesson 1-1", order_in_parent: 1, source_page: 7 },
    { id: "lo:u1-1-2", kind: "learning_objective", label: "Cartesian product of finite sets", description: "X × Y is the set of every ordered pair (x, y) with x in X and y in Y.", syllabus_ref: "Lesson 1-1", order_in_parent: 2, source_page: 8 },
    { id: "lo:t2u1-1-1", kind: "learning_objective", label: "First-degree equations in two variables", description: null, syllabus_ref: "T2 Lesson 1-1", order_in_parent: 1, source_page: null },
    { id: "lo:geo1-1-1", kind: "learning_objective", label: "Basic definitions: circle, center, radius, chord, diameter", description: "A circle is the set of points at a fixed distance from its center.", syllabus_ref: "Lesson 4-1", order_in_parent: 1, source_page: 39 },
    { id: "lo:soc1-1-1", kind: "learning_objective", label: "يوزع على خريطة صماء قارات العالم", description: null, syllabus_ref: null, order_in_parent: 1, source_page: 4 },
    { id: "lo:ara1-1-1", kind: "learning_objective", label: "فهم النص والاستماع", description: null, syllabus_ref: "ara1-1 · عِبادُ الرَّحمنِ", order_in_parent: 1, source_page: 8 },
  ],
  edges: [
    { src: MATH, dst: "program:bakaloreya-track", type: "part_of" },
    { src: "module:u1", dst: MATH, type: "part_of" },
    { src: "module:t2-u1", dst: MATH, type: "part_of" },
    { src: "module:geo-u1", dst: MATH, type: "part_of" },
    { src: "module:soc-t1-u1", dst: SOCIAL, type: "part_of" },
    { src: "module:ara-u1", dst: ARABIC, type: "part_of" },
    { src: "module:u1", dst: "lo:u1-1-1", type: "teaches" },
    { src: "module:u1", dst: "lo:u1-1-2", type: "teaches" },
    { src: "module:t2-u1", dst: "lo:t2u1-1-1", type: "teaches" },
    { src: "module:geo-u1", dst: "lo:geo1-1-1", type: "teaches" },
    { src: "module:soc-t1-u1", dst: "lo:soc1-1-1", type: "teaches" },
    { src: "module:ara-u1", dst: "lo:ara1-1-1", type: "teaches" },
    { src: "lo:u1-1-1", dst: "lo:u1-1-2", type: "prerequisite_of" },
  ],
  questions: [
    {
      id: "q:u1-1-1:001", lo_id: "lo:u1-1-1", tier: "basic", question_type: "mcq",
      stem: "If $(x, 3) = (5, y)$, find $x + y$.",
      choices: [{ key: "A", text: "$8$" }, { key: "B", text: "$15$" }, { key: "C", text: "$2$" }, { key: "D", text: "$5$" }],
      correct_answer: "A",
      canonical_solution: [step(1, "Equal pairs: $x = 5$ and $y = 3$."), step(2, "$x + y = 8$.")],
      source_page: 7, source_sha256: "sha-math",
    },
    {
      id: "q:geo1-1-1:w001", lo_id: "lo:geo1-1-1", tier: "standard", question_type: "widget",
      stem: "Draw a chord of circle M.",
      choices: { kind: "circle_builder", spec: { element: "chord" }, diagnostics: [] },
      correct_answer: "ok",
      canonical_solution: [step(1, "A chord joins two points of the circle.")],
      source_page: 39, source_sha256: "sha-math",
    },
    {
      id: "q:soc1-1-1:001", lo_id: "lo:soc1-1-1", tier: "basic", question_type: "mcq",
      stem: "ما أكبر قارات العالم مساحة؟",
      choices: [{ key: "A", text: "آسيا" }, { key: "B", text: "أفريقيا" }],
      correct_answer: "A",
      canonical_solution: [{ step: 1, claim_ar: "آسيا أكبر القارات مساحة.", evidence_page: 4, evidence_kind: "text" }],
      source_page: 4, source_sha256: "sha-social",
    },
  ],
  visuals: [
    { id: "v:u1-1:001", lo_id: "lo:u1-1-1", kind: "coordinate_plot", spec: { points: [] }, caption: "(2,3) and (3,2) land on different spots.", source_page: 7 },
  ],
};

const lesson = await import("./lesson.ts");
const ask = await import("./ask.ts");
const understanding = await import("./understanding-prompt.ts");

const LESSONS = ["u1-1", "geo1-1", "t2u1-1", "soc1-1", "ara1-1"] as const;
const ASK_PICKS = [null, "q:u1-1-1:001", "q:soc1-1-1:001"] as const;
const SURFACES = ["spine_chat", "student_chat"] as const;
const TRANSCRIPT = [
  { role: "user", text: "ready" },
  { role: "assistant", text: "Great - let's start." },
  { role: "note", text: "q:u1-1-1:001 answered correctly" },
] as const;

async function renderAsk(prefix: string, out: Record<string, string>, picks: readonly (string | null)[]) {
  for (const qid of picks) {
    for (const surface of SURFACES) {
      const ctx = await ask.buildAskContext(surface, "golden", qid ?? undefined, qid ? "wrong" : undefined);
      const key = `${prefix}/${surface}/${qid ?? "none"}`;
      out[`${key}/system`] = ctx.systemPrompt;
      out[`${key}/data`] = ctx.dataBlock;
      out[`${key}/grounding`] = JSON.stringify(ctx.grounding);
    }
  }
}

async function renderAll(cur: FixtureCurriculum = NATIONAL): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  installFixturePool(cur);
  const catalog = await lesson.getLessonCatalog();
  out["catalog"] = catalog.map((i) => `${i.slug}\t${i.title}\t${i.courseId}`).join("\n");
  for (const slug of LESSONS) {
    for (const mode of ["learn", "review"] as const) {
      const ctx = await lesson.buildLessonContext(mode, "golden", slug);
      assert.ok(ctx, `${slug}/${mode}`);
      out[`lesson/${slug}/${mode}/system`] = ctx.systemPrompt;
      out[`lesson/${slug}/${mode}/data`] = ctx.dataBlock;
      out[`lesson/${slug}/${mode}/grounding`] = JSON.stringify(ctx.grounding);
    }
  }
  const g = await lesson.getLessonData("u1-1");
  assert.ok(g);
  out["grader/learn"] = understanding.buildUnderstandingPrompt({
    mode: "learn", los: g.los, studentName: g.studentName, grade: g.grade,
    lessonRef: g.lessonRef, title: g.title, moduleLabel: g.moduleLabel, transcript: TRANSCRIPT,
  });
  // three books (the "Source books (all ingested)" line), one book, none
  await renderAsk("ask3", out, ASK_PICKS);
  installFixturePool({ ...cur, docs: DOCS.slice(0, 1) });
  await renderAsk("ask1", out, [null, "q:u1-1-1:001"]);
  installFixturePool({ ...cur, docs: [] });
  await renderAsk("ask0", out, [null]);
  installFixturePool(NATIONAL);
  return out;
}

if (process.env.WRITE_GOLDEN === "1") {
  writeFileSync(GOLDEN, JSON.stringify(await renderAll(), null, 2) + "\n");
  console.log(`wrote ${GOLDEN}`);
}

test("every National prompt in the fixture is byte-identical to the v0.9.2 golden", async () => {
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, string>;
  const now = await renderAll();
  assert.deepEqual(Object.keys(now).sort(), Object.keys(golden).sort());
  for (const key of Object.keys(golden)) assert.equal(now[key], golden[key], `${key} drifted from v0.9.2`);
});

test("the fixture reaches every fact 003 moved (so the golden above means something)", async () => {
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, string>;
  const all = Object.values(golden).join("\n");
  for (const fact of [
    "Egyptian ministry textbook", // the book name (maths header; social/arabic fallback unused here)
    "(school Lesson 1-1: Cartesian product", // the lead word and the registry title
    "Syllabus 2025–2026.", // the syllabus line
    "{{widget:viz_ref:v:geo1-1:001}}", // the fallback figure (geo1-1 has none of its own)
    "[[q:u1-1-1:001]] / [[page:8]]", // the fallback question id and page (t2u1-1 has neither)
    "This is a GEOMETRY lesson", // the figure-led lessons
    "ONE visual moment", // geometry's review moment
    "{{widget:product_builder:{\"X\":[1,2],\"Y\":[4,5]", // the unit-map review moment
    "[[lo:u1-4-3]]", // the Ask examples
    "{{highlight:lo:u1-2-1,lo:u1-3-1}}",
    "Source books (all ingested):", // several books, one line
    "Source book: \"ministry textbook\"", // no book row
    "كتاب الوزارة «", // Social/Arabic name their book
  ]) {
    assert.ok(all.includes(fact), `the golden no longer exercises: ${fact}`);
  }
});

/*
 * DECISION 13 — THE ARABIC LESSONS' PRINTED NAMES (Samuel, 2026-09-25; the
 * ADR-0020 exception for lesson titles). The loader writes a one-section
 * `course_lessons` row for every National lesson (T404): its number from
 * "Lesson n-m" in `syllabus_ref` (else the slug's digits) and its title from
 * the text after " · " in `syllabus_ref` (else the first objective's label) —
 * `services/extraction/load_seed.py` `_national_number` / `_national_title`.
 * These are those rows for the fixture's five lessons. With them in the
 * store, every maths and Social Studies render is still the v0.9.2 golden,
 * byte for byte; the Arabic lesson's renders differ from it in ONE place
 * each: its title, «فهم النص والاستماع» → «عِبادُ الرَّحمنِ».
 */
const ONE_SECTION_ROWS: NonNullable<FixtureCurriculum["lessons"]> = [
  { course_id: MATH, lesson_slug: "u1-1", title: "Ordered pairs and their equality", sections: ["1-1"], section_titles: ["Ordered pairs and their equality"], group_key: "1-1" },
  { course_id: MATH, lesson_slug: "t2u1-1", title: "First-degree equations in two variables", sections: ["1-1"], section_titles: ["First-degree equations in two variables"], group_key: "1-1" },
  { course_id: MATH, lesson_slug: "geo1-1", title: "Basic definitions: circle, center, radius, chord, diameter", sections: ["4-1"], section_titles: ["Basic definitions: circle, center, radius, chord, diameter"], group_key: "4-1" },
  { course_id: SOCIAL, lesson_slug: "soc1-1", title: "يوزع على خريطة صماء قارات العالم", sections: ["1-1"], section_titles: ["يوزع على خريطة صماء قارات العالم"], group_key: "1-1" },
  { course_id: ARABIC, lesson_slug: "ara1-1", title: "عِبادُ الرَّحمنِ", sections: ["1-1"], section_titles: ["عِبادُ الرَّحمنِ"], group_key: "1-1" },
];

test("decision 13: with the loader's rows in the store, only the Arabic lesson's title changes — «عِبادُ الرَّحمنِ», not its first objective", async () => {
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, string>;
  const now = await renderAll({ ...NATIONAL, lessons: ONE_SECTION_ROWS });
  assert.deepEqual(Object.keys(now).sort(), Object.keys(golden).sort());
  const OBJECTIVE = "فهم النص والاستماع";
  const PRINTED = "عِبادُ الرَّحمنِ";
  let renamed = 0;
  for (const key of Object.keys(golden)) {
    const arabicLesson = key.startsWith("lesson/ara1-1/") || key === "catalog";
    if (!arabicLesson || now[key] === golden[key]) {
      assert.equal(now[key], golden[key], `${key} drifted from v0.9.2`);
      continue;
    }
    // exactly one line differs, and only by the title
    const was = golden[key]!.split("\n");
    const is = now[key]!.split("\n");
    assert.equal(is.length, was.length, key);
    const diff = was.flatMap((line, i) => (line === is[i] ? [] : [i]));
    assert.equal(diff.length, 1, `${key}: ${diff.length} lines changed`);
    assert.equal(is[diff[0]!], was[diff[0]!]!.replace(OBJECTIVE, PRINTED), key);
    renamed++;
  }
  // the catalogue line and the four prompt strings that name the lesson
  // (learn and review, system and data); its grounding is unchanged
  assert.equal(renamed, 5);
  assert.match(now["catalog"]!, /^ara1-1\tعِبادُ الرَّحمنِ\tcourse:prep3-arabic-ar$/m);
  assert.match(now["lesson/ara1-1/learn/data"]!, /^LESSON DATA — your ONLY source of truth \(school ara1-1 · عِبادُ الرَّحمنِ: عِبادُ الرَّحمنِ — /);
});
