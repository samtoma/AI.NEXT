/**
 * TWO QUESTION FLAGS (Samuel's G2 answers 20 and 22, 2026-09-26;
 * decisions 41 and 43; `lib/question-flags.ts`; contract: spec 003 `contracts/pipeline-handoff.md`).
 *
 *  - `choices.less_specific`: a TRUE but less precise option is sent back for
 *    re-entry — not an attempt, not wrong, no mastery effect — through the same
 *    422 / `AttemptRetryError` path as the maths marker's (FR-4320), and every
 *    surface that grades a choice question shows the message.
 *  - `choices.answer_only`: the tutor is never handed a worked solution to walk
 *    for a question whose book prints none, on every prompt path that would
 *    otherwise carry one (grounded teaching, constitution Principle II; 001 FR-C01).
 *
 * @covers FR-4320
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  ANSWER_ONLY_INSTRUCTION,
  LESS_SPECIFIC_MESSAGE,
  choiceOptions,
  isAnswerOnly,
  lessSpecificKeys,
} from "./question-flags.ts";
import { markAnswer } from "./attempt-grading.ts";
import { AttemptRetryError, submitAttempt } from "./attempts-client.ts";
import { mcqChoices } from "./types.ts";

const OPTIONS = [
  { key: "A", text: "a square" },
  { key: "B", text: "a rectangle" },
  { key: "C", text: "a parallelogram" },
  { key: "D", text: "a trapezium" },
];
/** Ex8-6:36b's shape: the most specific name is the key, two more are true. */
const SHAPE = {
  id: "q:g10m8s6-1-1:ex36b",
  question_type: "mcq",
  correct_answer: "A",
  choices: { options: OPTIONS, less_specific: ["B", "C"] },
};

const src = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/* ---------------- the options, in either shape ---------------- */

test("the options read the same bare or beside a flag; nothing else has options", () => {
  assert.deepEqual(choiceOptions(OPTIONS), OPTIONS);
  assert.deepEqual(choiceOptions(SHAPE.choices), OPTIONS);
  assert.deepEqual(mcqChoices({ choices: SHAPE.choices }), OPTIONS, "every card renders them");
  assert.equal(choiceOptions({ marker: { kind: "expression" } }), null);
  assert.equal(choiceOptions({ kind: "circle_builder", spec: {}, diagnostics: [] }), null);
  assert.equal(choiceOptions(null), null);
  assert.equal(choiceOptions({ options: [{ key: "A" }] }), null, "an option with no text is not an option");
});

/* ---------------- less_specific: re-entry, not a verdict ---------------- */

test("a true but less precise option is a re-entry with the message — not wrong, not an attempt", () => {
  for (const pick of ["B", " c "]) {
    const v = markAnswer(SHAPE, pick, undefined, () => assert.fail("a valid flag warns about nothing"));
    assert.deepEqual(v, { verdict: "retry", retry: "less_specific", message: LESS_SPECIFIC_MESSAGE });
  }
  assert.match(LESS_SPECIFIC_MESSAGE, /true/i);
  assert.doesNotMatch(LESS_SPECIFIC_MESSAGE, /\b(he|she|him|her|his)\b/i, "gender-neutral");
});

test("the key is still correct, and a false option is still wrong", () => {
  assert.deepEqual(markAnswer(SHAPE, "A"), { verdict: "graded", isCorrect: true, by: "grade" });
  assert.deepEqual(markAnswer(SHAPE, "D"), { verdict: "graded", isCorrect: false, by: "grade" });
});

test("without the flag, grading is exactly as before (FR-C03)", () => {
  const plain = { ...SHAPE, choices: OPTIONS };
  assert.deepEqual(markAnswer(plain, "B"), { verdict: "graded", isCorrect: false, by: "grade" });
  assert.deepEqual(markAnswer(plain, "A"), { verdict: "graded", isCorrect: true, by: "grade" });
});

test("a malformed less_specific is ignored with a warning — never a crash, never a re-entry", () => {
  const cases: [unknown, RegExp][] = [
    [["E"], /not one of its options/],
    [["A"], /names the correct answer/],
    [[7], /not one of its options/],
    ["B", /not a list/],
  ];
  for (const [flag, why] of cases) {
    const warnings: string[] = [];
    const q = { ...SHAPE, choices: { options: OPTIONS, less_specific: flag } };
    const pick = flag === "B" ? "B" : "E";
    const v = markAnswer(q, pick, undefined, (m) => warnings.push(m));
    assert.equal(v.verdict, "graded", JSON.stringify(flag));
    assert.ok(warnings.some((w) => why.test(w) && w.includes(SHAPE.id)), `${JSON.stringify(flag)}: ${warnings}`);
  }
  // a good key beside a bad one still counts; the bad one is reported
  const warnings: string[] = [];
  const keys = lessSpecificKeys({ ...SHAPE, choices: { options: OPTIONS, less_specific: ["B", "Z", "A"] } }, (m) => warnings.push(m));
  assert.deepEqual([...keys], ["B"]);
  assert.equal(warnings.length, 2);
});

test("the client turns the route's 422 into AttemptRetryError, like the marker's re-entry", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ retry: "less_specific", message: LESS_SPECIFIC_MESSAGE }), {
      status: 422,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
  try {
    await assert.rejects(
      () => submitAttempt({ questionId: SHAPE.id, givenAnswer: "B", timeMs: 1000 }),
      (e: unknown) => e instanceof AttemptRetryError && e.retry.retry === "less_specific" && e.message === LESS_SPECIFIC_MESSAGE
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("every surface that grades a choice question shows the re-entry message", () => {
  // lesson cards and practice: the note sits with the lettered options
  for (const [file, arm] of [
    ["../components/chat/ChatQuestionCard.tsx", /mcqChoices\(q\)!\.map[\s\S]{0,2500}<ReentryNote message=\{reentry\} \/>/],
    ["../components/student/StudentLoop.tsx", /mcqChoices\(item\)!\.map[\s\S]{0,2500}<ReentryNote message=\{reentry\} \/>/],
  ] as const) {
    const code = src(file);
    assert.match(code, /if \(e instanceof AttemptRetryError\) setReentry\(e\.retry\.message\)/, file);
    assert.match(code, arm, `${file}: the note is rendered with the options`);
  }
  // chat: a chat-typed choice goes through the same client and shows as a local note
  assert.match(src("../components/chat/ChatCore.tsx"), /e instanceof AttemptRetryError[\s\S]{0,300}text: e\.retry\.message/);
  // the route answers 422 for any re-entry verdict markAnswer returns, before any write
  const route = src("../app/api/attempts/route.ts");
  assert.match(route, /const verdict = isWidget \? null : markAnswer\(q, givenAnswer\);\s*if \(verdict\?\.verdict === "retry"\)/);
  assert.match(route, /NextResponse\.json\(err\.body, \{ status: 422 \}\)/);
});

/* ---------------- answer_only: no worked solution in any prompt ---------------- */

test("answer_only is read from the flag and nothing else", () => {
  assert.equal(isAnswerOnly({ marker: { kind: "expression" }, answer_only: true }), true);
  assert.equal(isAnswerOnly({ options: OPTIONS, answer_only: true }), true);
  assert.equal(isAnswerOnly({ options: OPTIONS, answer_only: "yes" }), false);
  assert.equal(isAnswerOnly(OPTIONS), false);
  assert.equal(isAnswerOnly(null), false);
  assert.match(ANSWER_ONLY_INSTRUCTION, /Do NOT work it out/);
  assert.match(ANSWER_ONLY_INSTRUCTION, /worked examples/);
});

test("the Socratic probe's live-event note never hands an answer_only question's material to the tutor", () => {
  const core = src("../components/chat/ChatCore.tsx");
  const arm = core.slice(core.indexOf("if (probingNow && !r.isCorrect && isAnswerOnly(q.choices))"));
  assert.ok(arm.length > 0, "ChatCore branches on answer_only before building probe material");
  const branch = arm.slice(0, arm.indexOf("} else if (probingNow)"));
  assert.match(branch, /ANSWER_ONLY_INSTRUCTION/);
  assert.doesNotMatch(branch, /r\.solution|r\.refutation/, "no worked material in the answer-only branch");
});
