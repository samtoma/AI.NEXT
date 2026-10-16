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

import { bookStatementsBlock, getBookStatements, statementCount } from "./book-statements.ts";
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
