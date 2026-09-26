/**
 * THE GRADE 10 COURSE'S TUTOR PROMPTS (feature 003, decision 10; ADR-0020's
 * fourth exception, for this course's prompts only).
 *
 * Renders every prompt surface the capture harness renders — both lesson
 * modes, the Ask surfaces with and without a question in scope, the
 * comprehension grader — for the two-lesson Grade 10 fixture
 * (`g10-prompt-fixture.mts`), through the REAL builders over a fake pool
 * (`prompt-fixture-pool.mts`), and compares each, whole, with
 * `g10-prompts.golden.json`. The golden's keys are the harness's file names:
 * a capture of the same fixture from a scratch Postgres
 * (`scripts/capture-prompts.mts`) is byte-identical to it, file for file.
 *
 * Then it checks what decision 10 says, on every rendered string:
 *   · the book is "this book", never the Egyptian ministry textbook;
 *   · no "Syllabus 2025–2026" line;
 *   · no Prep-3 figure, widget or example id;
 *   · lesson references are the printed section numbers;
 *   · no school term;
 *   · only the lesson's own unit's widgets (FR-1209);
 *   · the address rules hold (FR-2602, FR-2605): a student whose gender is not
 *     recorded is never addressed in the masculine.
 *
 * Regenerate the golden, deliberately: `WRITE_GOLDEN=1 node --import
 * ./scripts/ts-resolver.mjs --test src/lib/g10-prompts.test.mts`.
 *
 * BOOK SECTIONS (decision 18; WP-F, T408 and `lessonTitle()`). The fixture's
 * lessons carry their book provenance — the merge 1.2–1.3, 1.7 split in three
 * — and the last three tests check what that changes for the tutor: the
 * printed title in every lesson prompt, the whole section in focus when a
 * question sits in one part, and the part prerequisites listed as the
 * product's.
 *
 * @covers FR-4205, FR-4212, FR-1209, FR-2602, FR-2605, FR-4311, FR-4316, FR-4317
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { installFixturePool } from "./prompt-fixture-pool.mts";
import {
  G10_BOOK_SECTIONS,
  G10_EDGES,
  G10_LESSONS,
  G10_MISCONCEPTION,
  G10_NODES,
  G10_QUESTIONS,
  G10_REFUTATION,
  G10_SOURCE_DOCUMENT,
  G10_VISUALS,
} from "./g10-prompt-fixture.mts";
import type { Gender } from "./address.ts";
import type { LessonData } from "./types.ts";

const GOLDEN = fileURLToPath(new URL("./g10-prompts.golden.json", import.meta.url));

const { sha256, title, publisher, edition, grade, subject } = G10_SOURCE_DOCUMENT;
installFixturePool({
  docs: [{ sha256, title, publisher, edition, grade, subject }],
  nodes: G10_NODES.map((n) => ({ ...n, source_sha256: n.kind === "program" ? null : sha256 })),
  edges: G10_EDGES,
  questions: G10_QUESTIONS.map((q) => ({ ...q, source_sha256: sha256 })),
  visuals: G10_VISUALS,
  misconceptions: [G10_MISCONCEPTION],
  library: [G10_REFUTATION],
  // each lesson's book provenance (migration 034): the merge 1.2–1.3, the
  // three parts of 1.7, and 6.2 (feature 003, decision 18)
  lessons: G10_BOOK_SECTIONS,
});

const lesson = await import("./lesson.ts");
const ask = await import("./ask.ts");
const understanding = await import("./understanding-prompt.ts");
const { GRADER_TRANSCRIPT, ASK_SURFACES } = await import("../../scripts/capture-prompts.mts");

/** The Ask picks the harness makes for this course: none, and its first live question. */
const ASK_PICKS = [null, "q:g10m1s3-1-1:we01"] as const;

/**
 * One pick the harness does NOT make, rendered under `sections/`: a question
 * in part 2 of 1.7, the Ask context FR-4316 changes. Kept out of the
 * harness's own file names so the golden's other keys stay file-for-file
 * equal to a scratch-database capture.
 */
const SECTION_PICK = "q:g10m1s7-2-1:we01";

/** Every surface, keyed by the file name `scripts/capture-prompts.mts` gives it. */
async function renderCaptureSet(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const catalog = await lesson.getLessonCatalog();
  out["catalog.txt"] = catalog.map((i) => `${i.slug}\t${i.title}`).join("\n");
  for (const info of catalog) {
    for (const mode of ["learn", "review"] as const) {
      const ctx = await lesson.buildLessonContext(mode, "capture-session", info.slug);
      assert.ok(ctx, `no lesson context for ${info.slug}/${mode}`);
      out[`lesson-${info.slug}-${mode}-system.txt`] = ctx.systemPrompt;
      out[`lesson-${info.slug}-${mode}-data.txt`] = ctx.dataBlock;
      out[`lesson-${info.slug}-${mode}-grounding.json`] = JSON.stringify(ctx.grounding, null, 2);
    }
  }
  for (const qid of ASK_PICKS) {
    for (const surface of ASK_SURFACES) {
      const ctx = await ask.buildAskContext(
        surface,
        "capture-session",
        qid ?? undefined,
        qid ? "capture-wrong-answer" : undefined
      );
      const slug = `${surface}-${qid ? qid.replace(/[^a-zA-Z0-9]+/g, "_") : "none"}`;
      out[`ask-${slug}-system.txt`] = ctx.systemPrompt;
      out[`ask-${slug}-data.txt`] = ctx.dataBlock;
      out[`ask-${slug}-grounding.json`] = JSON.stringify(ctx.grounding, null, 2);
    }
  }
  for (const surface of ASK_SURFACES) {
    const ctx = await ask.buildAskContext(surface, "capture-session", SECTION_PICK, "capture-wrong-answer");
    const slug = `${surface}-${SECTION_PICK.replace(/[^a-zA-Z0-9]+/g, "_")}`;
    out[`sections/ask-${slug}-system.txt`] = ctx.systemPrompt;
    out[`sections/ask-${slug}-data.txt`] = ctx.dataBlock;
    out[`sections/ask-${slug}-grounding.json`] = JSON.stringify(ctx.grounding, null, 2);
  }
  const graderLesson = await lesson.getLessonData(catalog[0]!.slug);
  assert.ok(graderLesson);
  out["understanding-system.txt"] = understanding.UNDERSTANDING_SYSTEM_PROMPT;
  for (const mode of ["learn", "review"] as const) {
    const base = understanding.buildUnderstandingPrompt({
      mode,
      los: graderLesson.los,
      studentName: graderLesson.studentName,
      grade: graderLesson.grade,
      lessonRef: graderLesson.lessonRef,
      title: graderLesson.title,
      moduleLabel: graderLesson.moduleLabel,
      transcript: GRADER_TRANSCRIPT,
    });
    out[`understanding-${mode}.txt`] = base;
    if (mode === "learn") out["understanding-retry.txt"] = understanding.understandingRetryPrompt(base, "not json at all");
  }
  return out;
}

const GENDERS: Gender[] = ["female", "male", "unspecified", null];
const NAMES: Record<string, string> = { female: "Salma Adel", male: "Omar Hassan", unspecified: "Nour Adel", null: "Nour Adel" };

/** Lesson 1 in each address register, learn and review — what a real student gets. */
async function renderAddressSet(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const base = await lesson.getLessonData(G10_LESSONS[0]);
  assert.ok(base);
  for (const gender of GENDERS) {
    const data: LessonData = { ...base, gender, studentName: NAMES[String(gender)]! };
    out[`address/${gender}/learn`] = lesson.learnPrompt(data, false);
    out[`address/${gender}/review`] = lesson.reviewPrompt(data);
  }
  return out;
}

async function renderAll(): Promise<Record<string, string>> {
  return { ...(await renderCaptureSet()), ...(await renderAddressSet()) };
}

if (process.env.WRITE_GOLDEN === "1") {
  writeFileSync(GOLDEN, JSON.stringify(await renderAll(), null, 2) + "\n");
  console.log(`wrote ${GOLDEN}`);
}

const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, string>;
const now = await renderAll();
/** The model-visible prompt text: everything but the grader's fixed transcript (harness input). */
const promptTexts = Object.entries(now).filter(([k]) => !/^understanding-(learn|review|retry)/.test(k) && !k.endsWith(".json"));

test("every Grade 10 prompt is byte-identical to its golden", () => {
  assert.deepEqual(Object.keys(now).sort(), Object.keys(golden).sort());
  assert.equal(
    Object.keys(now).length,
    61,
    "5 lessons x 2 modes x 3 + 2 picks x 2 surfaces x 3 + catalog + 4 grader + 8 address + the part-2 pick x 2 surfaces x 3"
  );
  for (const key of Object.keys(golden)) assert.equal(now[key], golden[key], `${key} drifted from its golden`);
});

test("decision 10: 'this book' — never the Egyptian ministry textbook, never a syllabus year", () => {
  for (const [key, text] of promptTexts) {
    assert.doesNotMatch(text, /ministry/i, `${key} names the ministry textbook`);
    assert.doesNotMatch(text, /Syllabus 20\d\d/, `${key} carries a syllabus year`);
    assert.doesNotMatch(text, /Egyptian ministry/i, key);
  }
  for (const slug of G10_LESSONS) {
    for (const mode of ["learn", "review"]) {
      // a section number, or the printed range of a merged lesson (backlog #35)
      assert.match(now[`lesson-${slug}-${mode}-data.txt`]!, /^LESSON DATA — your ONLY source of truth \(section \d+\.\d+(?:–\d+\.\d+)?: .*, this book\)$/m);
    }
  }
  // the Ask context names this book and nothing after it
  for (const key of Object.keys(now).filter((k) => /^(sections\/)?ask-.*-data\.txt$/.test(k))) {
    assert.match(now[key]!, /^Source book: "Everything Maths, Grade 10 Mathematics" — Siyavula Education \(with volunteers\) \(edition Version 1\.1 CAPS, mathematics, grade 10\)\.$/m, key);
  }
});

test("decision 10: no Prep-3 figure, widget or example id anywhere in a Grade 10 prompt", () => {
  const PREP3_ID = /\b(?:lo:|q:|v:|module:)?(?:u\d|geo\d|t2u?\d|soc\d|ara\d)[\w-]*[-:]\d/;
  for (const [key, text] of promptTexts) {
    assert.doesNotMatch(text, PREP3_ID, `${key} shows a Prep-3 id`);
    assert.doesNotMatch(text, /v:geo|product_builder|pair_plotter|circle_builder|angle_setter/, `${key} borrows a Prep-3 figure or widget`);
  }
});

test("decision 10: lesson references are the printed section numbers, and no term is named", () => {
  // The merged lesson (P3a) is "1.2–1.3" everywhere — the words its check-in,
  // chip and lesson header print — never "1.3" alone (backlog #35).
  assert.match(now["lesson-g10m1s3-1-learn-system.txt"]!, /Today's lesson is 1\.2–1\.3 — /);
  assert.match(now["lesson-g10m6s2-1-review-system.txt"]!, /today's lesson \(6\.2 — /);
  assert.match(now["understanding-learn.txt"]!, /Lesson: 1\.2–1\.3 — /);
  for (const [key, text] of promptTexts) {
    assert.doesNotMatch(text, /Today's lesson is 1\.3 |\(section 1\.3:|Lesson: 1\.3 /, `${key} calls the merged lesson "1.3"`);
  }
  // the Ask context cites the merged lesson's objectives by the same range
  for (const key of Object.keys(now).filter((k) => /^(sections\/)?ask-.*-data\.txt$/.test(k))) {
    assert.doesNotMatch(now[key]!, /lo:g10m1s3-1-\d \| "[^"]*" \| ref 1\.3 \|/, key);
    assert.match(now[key]!, /lo:g10m1s3-1-1 \| "[^"]*" \| ref 1\.2–1\.3 \|/, key);
  }
  for (const [key, text] of promptTexts) assert.doesNotMatch(text, /\bTerm \d|\bterm [12]\b/, `${key} names a school term`);
});

test("FR-1209: each lesson is told about its own unit's widgets and no others", () => {
  const l1 = now["lesson-g10m1s3-1-learn-system.txt"]!;
  const l2 = now["lesson-g10m6s2-1-learn-system.txt"]!;
  assert.match(l1, /\{\{widget:number_line_marker:/);
  assert.doesNotMatch(l1, /\{\{widget:(line_drawer|curve_sketcher):/);
  assert.match(l2, /\{\{widget:curve_sketcher:/);
  assert.match(l2, /\{\{widget:line_drawer:/);
  assert.doesNotMatch(l2, /\{\{widget:number_line_marker:/);
  // the still-confused tap widgets: only the unit's own
  assert.match(l1, /a tap widget \(figure \/ number_line_marker\)/);
  assert.match(l2, /a tap widget \(figure\)/);
  // the review moment offers the unit's own widgets, most used first
  assert.match(now["lesson-g10m6s2-1-review-system.txt"]!, /ONE widget moment: one of this unit's own widgets \(curve_sketcher \/ line_drawer\)/);
  assert.match(now["lesson-g10m1s3-1-review-system.txt"]!, /ONE widget moment: one of this unit's own widgets \(number_line_marker\)/);
});

test("examples come from the lesson's own data; a lesson with no stored figure gets a placeholder, not another book's", () => {
  assert.match(now["lesson-g10m1s3-1-learn-system.txt"]!, /\{\{widget:viz_ref:v:g10m1s3-1:1\}\}/);
  assert.match(now["lesson-g10m6s2-1-learn-system.txt"]!, /\{\{widget:viz_ref:<id>\}\}/);
  const askSystem = now["ask-spine_chat-none-system.txt"]!;
  assert.match(askSystem, /exactly \[\[lo:g10m1s3-1-1\]\]/);
  assert.match(askSystem, /\{\{show_question:q:g10m1s3-1-1:we01\}\}/);
  assert.match(askSystem, /\{\{highlight:lo:g10m1s3-1-1,lo:g10m1s3-1-2\}\}/);
  assert.match(askSystem, /\{\{widget:viz_ref:v:g10m1s3-1:1\}\}/);
});

test("the explanation path stays grounded: the question in scope carries its canonical solution and the student's wrong answer", () => {
  const data = now["ask-student_chat-q_g10m1s3_1_1_we01-data.txt"]!;
  assert.match(data, /HUMAN-REVIEWED CANONICAL SOLUTION \(v1\) — the ONLY permitted mathematical path/);
  assert.match(data, /the demo student's wrong answer: "capture-wrong-answer"/);
  assert.match(data, /Step 3\. \$\\sqrt\{2\} = 1\.4142\\ldots\$ neither terminates nor recurs/);
  assert.match(now["ask-student_chat-q_g10m1s3_1_1_we01-system.txt"]!, /MODE — RE-EXPLANATION TO THE STUDENT/);
  assert.match(data, /KNOWN MISCONCEPTIONS for these skills:\n- mc:g10m1s3-1-1:every-root-irrational/);
});

test("decision 9: English only — no Arabic in any Grade 10 prompt, and the student is still an Egyptian grade-10 student", () => {
  const ARABIC_SCRIPT = /[؀-ۿ]/;
  // every rendered string, the grader and the four address registers included
  for (const [key, text] of Object.entries(now)) {
    assert.doesNotMatch(text, ARABIC_SCRIPT, `${key} carries Arabic`);
  }
  for (const g of ["female", "male", "unspecified", "null"]) {
    assert.match(now[`address/${g}/learn`]!, /\b(?:is|are) an Egyptian grade-10 student\b/, g);
  }
  // what replaced each touch, and the one line the contract gains
  const review = now["lesson-g10m1s7-2-review-system.txt"]!;
  assert.match(review, /One warm opener line \(e\.g\. "Got all of it\? Nice — let's lock it in\. 3 minutes ⏱"\)/);
  assert.match(review, /\(e\.g\. "Nice work, Omar — that's the revision done, and the Finish button is there whenever you're ready\."\)/);
  assert.match(now["lesson-g10m1s3-1-learn-system.txt"]!, /- After a still-confused signal: re-explain from a DIFFERENT angle/);
  for (const key of [ "lesson-g10m1s3-1-learn-system.txt", "lesson-g10m1s3-1-review-system.txt"]) {
    assert.match(now[key]!, /^- English only in this course: write no Arabic at all/m, key);
  }
  // the address block keeps its English line and the FR-2603 boundary, and
  // loses only its Arabic line
  const data = now["lesson-g10m1s3-1-learn-data.txt"]!;
  assert.match(data, /^HOW TO ADDRESS THIS STUDENT \(grammatical forms only\):\n- English: address the student as "you"\.[^\n]*\n- This decides the FORM/m);
  assert.doesNotMatch(data, /^- Arabic:/m);
});

test("FR-2602, FR-2605: the address rules hold in the Grade 10 prompts", () => {
  const MASCULINE = /\b(he|him|his|himself)\b/i;
  for (const g of ["null", "unspecified"]) {
    for (const mode of ["learn", "review"]) {
      assert.doesNotMatch(now[`address/${g}/${mode}`]!, MASCULINE, `${g}/${mode} falls back to the masculine`);
      assert.match(now[`address/${g}/${mode}`]!, /\bthey\b/);
    }
  }
  assert.match(now["address/female/learn"]!, /\bShe is an Egyptian grade-10 student\b/);
  assert.doesNotMatch(now["address/female/learn"]!, MASCULINE);
  assert.match(now["address/male/learn"]!, /\bHe is an Egyptian grade-10 student\b/);
});

test("FR-4311: a lesson's title is its printed section title, from the book-section store — never its first objective", () => {
  // the merge P3a: its first objective is "Classify numbers as rational or irrational"
  assert.match(now["lesson-g10m1s3-1-learn-system.txt"]!, /Today's lesson is 1\.2–1\.3 — Rational and irrational numbers\b/);
  assert.match(now["lesson-g10m1s3-1-learn-data.txt"]!, /\(section 1\.2–1\.3: Rational and irrational numbers — Chapter 1 — Algebraic expressions, this book\)/);
  assert.match(now["understanding-learn.txt"]!, /Lesson: 1\.2–1\.3 — Rational and irrational numbers\b/);
  assert.match(now["address/female/learn"]!, /Today's lesson is 1\.2–1\.3 — Rational and irrational numbers\b/);
  // each part of 1.7 is "Factorisation"; 6.2 is "Linear functions"
  for (const n of [1, 2, 3]) assert.match(now[`lesson-g10m1s7-${n}-review-system.txt`]!, /today's lesson \(1\.7 — Factorisation\b/);
  assert.match(now["lesson-g10m6s2-1-learn-system.txt"]!, /Today's lesson is 6\.2 — Linear functions\b/);
  assert.equal(
    now["catalog.txt"],
    [
      "g10m1s3-1\tRational and irrational numbers",
      "g10m1s7-1\tFactorisation",
      "g10m1s7-2\tFactorisation",
      "g10m1s7-3\tFactorisation",
      "g10m6s2-1\tLinear functions",
    ].join("\n")
  );
  for (const [key, text] of promptTexts) {
    assert.doesNotMatch(text, /lesson (is|\() ?\d\.\d — Classify numbers/, `${key} still titles the merge by its first objective`);
  }
});

/** The objectives whose descriptions an Ask data block carries — its focus set. */
function focusOf(dataBlock: string): string[] {
  const out: string[] = [];
  const lines = dataBlock.split("\n");
  lines.forEach((line, i) => {
    const m = /^- (lo:[\w-]+) \|/.exec(line);
    if (m && lines[i + 1]?.startsWith("  ")) out.push(m[1]!);
  });
  return out;
}

test("FR-4316: a question in part 2 of 1.7 puts parts 1 and 3 in the tutor's focus, ahead of other lessons", () => {
  const PART = (n: number) => [`lo:g10m1s7-${n}-1`, `lo:g10m1s7-${n}-2`];
  for (const surface of ["spine_chat", "student_chat"]) {
    const data = now[`sections/ask-${surface}-q_g10m1s7_2_1_we01-data.txt`]!;
    const focus = focusOf(data);
    for (const id of [...PART(1), ...PART(2), ...PART(3)]) assert.ok(focus.includes(id), `${surface}: ${id} is in focus`);
    // the other lessons fill what is left, in catalogue order — the merge's
    // last two objectives no longer fit
    assert.deepEqual(focus.filter((id) => !id.startsWith("lo:g10m1s7-")), ["lo:g10m1s3-1-1", "lo:g10m1s3-1-2"]);
    // the whole section's questions are in the detailed bank, where cards may be pushed from
    assert.match(data, /^- q:g10m1s7-1-2:we01 \|/m);
    assert.match(data, /^- q:g10m1s7-3-1:we01 \|/m);
    assert.match(data, /QUESTION IN SCOPE[\s\S]*q:g10m1s7-2-1:we01/);
  }
  // Without FR-4316 the same weakness order would have stopped short of part
  // 3: a question in the merge (no section to pull in) gets catalogue order.
  const plain = focusOf(now["ask-student_chat-q_g10m1s3_1_1_we01-data.txt"]!);
  assert.ok(!PART(3).some((id) => plain.includes(id)), "a question outside 1.7 does not pull part 3 in");
  assert.equal(plain.length, 8);
});

test("FR-4317: part n-1 → part n is listed as the product's prerequisite, beside the book's own edges", () => {
  for (const key of Object.keys(now).filter((k) => /^(sections\/)?ask-.*-data\.txt$/.test(k))) {
    const data = now[key]!;
    const book = data.split("PREREQUISITE EDGES")[1]!.split("\n\n")[0]!;
    // the book's own edges, unchanged: no part edge among them
    assert.doesNotMatch(book, /lo:g10m1s7-1-\d -> lo:g10m1s7-2-/, `${key}: a derived edge is not the book's`);
    const block = data.split("PREREQUISITES ADDED BY THE PRODUCT, not stated by the book.")[1];
    assert.ok(block, `${key} lists the part prerequisites as the product's`);
    const lines = block.split("\n\n")[0]!.split("\n").slice(1);
    assert.deepEqual(lines, [
      "1.7 Factorisation — part 1 g10m1s7-1, part 2 g10m1s7-2, part 3 g10m1s7-3",
      "lo:g10m1s7-1-1 -> lo:g10m1s7-2-1",
      "lo:g10m1s7-1-1 -> lo:g10m1s7-2-2",
      "lo:g10m1s7-1-2 -> lo:g10m1s7-2-1",
      "lo:g10m1s7-1-2 -> lo:g10m1s7-2-2",
      "lo:g10m1s7-2-1 -> lo:g10m1s7-3-1",
      "lo:g10m1s7-2-1 -> lo:g10m1s7-3-2",
      "lo:g10m1s7-2-2 -> lo:g10m1s7-3-1",
      "lo:g10m1s7-2-2 -> lo:g10m1s7-3-2",
    ]);
  }
});
