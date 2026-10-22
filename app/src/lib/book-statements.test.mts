/**
 * The book's own statements reach the maths tutor only for a lesson compiled
 * from book records, and only where AINEXT_BOOK_STATEMENTS_DIR is set
 * (Tamer, 2026-10-16: book-record lessons only; learn and review mode).
 *
 *   · unset, the reader returns null for every lesson — the National and
 *     Grade 10 goldens (national-prompts, g10-prompts) prove every prompt is
 *     then byte-identical;
 *   · set, a lesson's file is read defensively (wrong format, another lesson's
 *     file, an unsafe slug: null), and the prompts carry the statements block,
 *     the grounding rule naming it, and the review rule — and a lesson WITHOUT
 *     statements keeps the old rules word for word.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { bookStatementsBlock, contextCount, getBookStatements, statementCount } from "./book-statements.ts";
import { learnPrompt, reviewPrompt } from "./lesson.ts";
import type { LessonData } from "./types.ts";

const DIR = mkdtempSync(path.join(tmpdir(), "book-statements-"));
const FILE = {
  format: "ainext.book-statements/1",
  lesson: "u1-1",
  groups: [
    { lo: "lo:u1-1-2", label: "Find the Cartesian product", statements: [
      { id: "u1-1:definition-2", type: "definition", text: "If X and Y are two finite sets, then $X\\times Y=\\{(a, b): a\\in X, b\\in Y\\}$.", page: 8 },
      { id: "u1-1:rule-5", type: "rule", text: "$X\\times Y\\neq Y\\times X$ where $X\\neq Y$.", page: 8 },
    ] },
    { lo: null, label: null, statements: [{ id: "u1-1:key-term-1", type: "key_term", text: "Ordered pair", page: 7 }] },
  ],
};
writeFileSync(path.join(DIR, "u1-1.json"), JSON.stringify(FILE));
writeFileSync(path.join(DIR, "u1-2.json"), JSON.stringify({ ...FILE, lesson: "u1-9" }));
writeFileSync(path.join(DIR, "u1-3.json"), JSON.stringify({ ...FILE, format: "something-else", lesson: "u1-3" }));
// the book's context per objective (book_record_context.py, S1C; Tamer, 2026-10-22): a group may carry context and
// real-life questions with no statements, and a passage of an unknown kind or a non-question id is never read
writeFileSync(path.join(DIR, "u2-1.json"), JSON.stringify({
  format: "ainext.book-statements/1",
  lesson: "u2-1",
  groups: [
    { lo: "lo:u2-1-1", label: "Geometric sequences", statements: [
      { id: "u2-1:rule-1", type: "rule", text: "Each term is the one before times $r$.", page: 60 },
    ], context: [
      { id: "u2-1:linking-text-3", kind: "concept_intro", text: "Multiplying by the same number each step makes a geometric sequence.", page: 60 },
      { id: "u2-1:linking-text-4", kind: "none", text: "Solve the following problems.", page: 60 },
    ], real_life_questions: ["q:u2-1-1:bk-challenge-2", "u2-1:challenge-2"] },
    { lo: null, label: null, statements: [], context: [
      { id: "u2-1:linking-text-1", kind: "real_life", text: "A single E. coli bacterium enters a bloodstream and doubles every 20 minutes.", page: 59 },
    ] },
  ],
}));
const ON = { AINEXT_BOOK_STATEMENTS_DIR: DIR };

test("unset, no lesson has statements", async () => {
  assert.equal(await getBookStatements("u1-1", {}), null);
  assert.equal(await getBookStatements("u1-1", { AINEXT_BOOK_STATEMENTS_DIR: "  " }), null);
});

test("set, a lesson's own file is read, and nothing else", async () => {
  const s = await getBookStatements("u1-1", ON);
  assert.equal(statementCount(s), 3);
  assert.equal(s?.groups[0].lo, "lo:u1-1-2");
  assert.equal(await getBookStatements("u1-2", ON), null, "a file naming another lesson");
  assert.equal(await getBookStatements("u1-3", ON), null, "a file of another format");
  assert.equal(await getBookStatements("u1-4", ON), null, "no file");
  assert.equal(await getBookStatements("../u1-1", ON), null, "an unsafe slug");
});

test("the block names each objective, the statement's kind and its page", async () => {
  const block = bookStatementsBlock(await getBookStatements("u1-1", ON));
  assert.match(block, /THE BOOK'S STATEMENTS/);
  assert.match(block, /lo:u1-1-2 — Find the Cartesian product\n- \(definition, p\.8\) If X and Y/);
  assert.match(block, /\(the whole lesson\)\n- \(key term, p\.7\) Ordered pair/);
  assert.equal(bookStatementsBlock(null), "");
});

function lesson(extra: Partial<LessonData> = {}): LessonData {
  return {
    slug: "u1-1", lessonRef: "Lesson 1-1", title: "Cartesian product", moduleLabel: "Unit 1",
    courseId: "course:prep3-math-en", subject: "math-en",
    los: [{ id: "lo:u1-1-1", label: "Ordered pairs", description: "The ordered pair (a, b).", sourcePage: 7, mastery: 0.4 }],
    questions: [], visuals: [], mapBases: [], docTitle: null,
    studentName: "Nour Adel", studentId: 7, grade: "9", gender: null,
    ...extra,
  } as LessonData;
}

test("a lesson without statements keeps the maths rules word for word", () => {
  const learn = learnPrompt(lesson(), false);
  assert.match(learn, /derivable from the learning objective descriptions and the canonical solutions provided\./);
  assert.doesNotMatch(learn, /BOOK'S STATEMENTS/);
  assert.doesNotMatch(reviewPrompt(lesson()), /BOOK'S STATEMENTS/);
});

test("a lesson with statements: the grounding rule names them, and both modes may quote them", async () => {
  const bookStatements = await getBookStatements("u1-1", ON);
  const learn = learnPrompt(lesson({ bookStatements }), false);
  assert.match(learn, /learning objective descriptions, THE BOOK'S STATEMENTS and the canonical solutions provided/);
  assert.match(learn, /3\. When you define a term or state a rule, use THE BOOK'S STATEMENTS/);
  assert.match(reviewPrompt(lesson({ bookStatements })), /quote the book's own rule or definition from THE BOOK'S STATEMENTS/);
});

test("the book's context: read beside the statements, a group may carry context alone, and nothing unknown is read", async () => {
  const s = await getBookStatements("u2-1", ON);
  assert.equal(statementCount(s), 1);
  assert.equal(contextCount(s), 2, "the 'none' passage is dropped");
  assert.deepEqual(s?.groups[0].realLifeQuestions, ["q:u2-1-1:bk-challenge-2"], "only question ids");
  assert.equal(s?.groups[1].lo, null, "the whole lesson's opener, with no statements of its own");
  assert.equal(contextCount(await getBookStatements("u1-1", ON)), 0, "a lesson the stage never ran on");
});

test("the context block names each objective's opener, its kind and page, and the real-life questions", async () => {
  const block = bookStatementsBlock(await getBookStatements("u2-1", ON));
  assert.match(block, /THE BOOK'S CONTEXT/);
  assert.match(block, /lo:u2-1-1 — Geometric sequences\n- \(introduction, p\.60\) Multiplying[^\n]*\n- real-life questions: q:u2-1-1:bk-challenge-2/);
  assert.match(block, /\(the whole lesson\)\n- \(real-life opener, p\.59\) A single E\. coli/);
  assert.doesNotMatch(block, /Solve the following problems/);
  // the statements section is the one it always was: a context-only group is not listed in it
  assert.equal(block.split("THE BOOK'S CONTEXT")[0].match(/\(the whole lesson\)/), null);
  assert.equal(bookStatementsBlock(await getBookStatements("u1-1", ON)).includes("THE BOOK'S CONTEXT"), false);
});

test("a lesson with context opens each objective with it; one without keeps the arc word for word", async () => {
  const plain = learnPrompt(lesson({ bookStatements: await getBookStatements("u1-1", ON) }), false);
  assert.match(plain, /greet [^\n]* in one line and start immediately → lo:u1-1-1 "Ordered pairs" \(1–2 messages\)/);
  assert.doesNotMatch(plain, /OBJECTIVE CONTEXT/);
  const withContext = learnPrompt(lesson({ bookStatements: await getBookStatements("u2-1", ON) }), false);
  assert.match(withContext, /in one line and open the first objective with its context → lo:u1-1-1 "Ordered pairs" \(its context, then 1–2 messages\)/);
  assert.match(withContext, /OPEN EACH OBJECTIVE WITH ITS CONTEXT/);
  assert.match(withContext, /THE DRILLS STAY AS THEY ARE: never rephrase a question into the story/);
  assert.match(withContext, /Never invent a situation, a number or a fact/);
  assert.doesNotMatch(reviewPrompt(lesson({ bookStatements: await getBookStatements("u2-1", ON) })), /OBJECTIVE CONTEXT/, "review mode stays a 3-minute lock-in");
});
