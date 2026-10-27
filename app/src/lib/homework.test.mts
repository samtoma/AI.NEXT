/**
 * Homework ask — the rules and the prompt text (spec 004, ADR-0025 — Proposed).
 *
 * @covers FR-3604
 * @covers FR-3605
 * @covers FR-3606
 * @covers FR-3610
 * @covers FR-3611
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GAP,
  DEFAULT_GAP_ASK,
  MAX_QUESTIONS,
  afterDone,
  applyGapAnswers,
  extractJsonObject,
  fillGaps,
  gapsComplete,
  parseSplitReply,
  regapEditedText,
} from "./homework-rules.ts";
import { buildSplitPrompt, homeworkSystemPrompt } from "./homework-prompt.ts";
import { parseMessage } from "./chat-parse.ts";

const VISIBLE = new Set(["u1-4-3", "u2-1-1"]);
const reply = (o: unknown) => "```json\n" + JSON.stringify(o) + "\n```";

test("FR-3604: a fenced reply with two questions splits into two, labels kept as written", () => {
  const r = parseSplitReply(
    reply({
      questions: [
        { label: "Q7", text: "A garden is 3 m longer than wide. Area 40 m². Find its size.", subject: "maths", objective: "u1-4-3", gaps: [] },
        { label: "Q8", text: "Solve $x^2 = 9$.", subject: "maths", objective: null, gaps: [] },
      ],
    }),
    VISIBLE
  );
  assert.equal(r?.kind, "questions");
  assert.deepEqual(r && r.kind === "questions" ? r.questions.map((q) => q.label) : [], ["Q7", "Q8"]);
});

test("FR-3605: an objective the student cannot see is dropped, never shown", () => {
  const r = parseSplitReply(
    reply({ questions: [{ text: "Q", subject: "maths", objective: "hidden-1-1" }] }),
    VISIBLE
  );
  assert.equal(r?.kind === "questions" && r.questions[0].objective, null);
});

test("FR-3605: a non-maths question keeps no objective even if one was named", () => {
  const r = parseSplitReply(
    reply({ questions: [{ text: "Who built the pyramids?", subject: "other", objective: "u1-4-3" }] }),
    VISIBLE
  );
  assert.ok(r?.kind === "questions");
  assert.equal(r.questions[0].subject, "other");
  assert.equal(r.questions[0].objective, null);
});

test("FR-3606: one gap entry per ▒▒, in order — missing asks get the default, extras are dropped", () => {
  const r = parseSplitReply(
    reply({ questions: [{ text: `Its area is ${GAP} m² and width ${GAP} m`, gaps: ["What is that number?"] }] }),
    VISIBLE
  );
  assert.ok(r?.kind === "questions");
  assert.deepEqual(r.questions[0].gaps, [
    { ask: "What is that number?", answer: null },
    { ask: DEFAULT_GAP_ASK, answer: null },
  ]);
  const extra = parseSplitReply(reply({ questions: [{ text: "no gaps", gaps: ["a", "b"] }] }), VISIBLE);
  assert.ok(extra?.kind === "questions");
  assert.deepEqual(extra.questions[0].gaps, []);
});

test("FR-3606: the choices unlock only when every gap is answered, and fill in order", () => {
  const gaps = [
    { ask: "a", answer: "40" },
    { ask: "b", answer: null },
  ];
  assert.equal(gapsComplete(gaps), false);
  assert.equal(fillGaps(`area ${GAP}, width ${GAP}`, gaps), `area 40, width ${GAP}`);
  const full = applyGapAnswers(gaps, ["40", " 5 "]);
  assert.ok(full);
  assert.equal(gapsComplete(full), true);
  assert.equal(fillGaps(`area ${GAP}, width ${GAP}`, full), "area 40, width 5");
});

test("FR-3606: gap answers of the wrong count or type are refused", () => {
  const gaps = [{ ask: "a", answer: null }];
  assert.equal(applyGapAnswers(gaps, ["1", "2"]), null);
  assert.equal(applyGapAnswers(gaps, [3]), null);
  assert.equal(applyGapAnswers(gaps, "1"), null);
});

test("FR-3607: editing the text re-derives the gaps, keeping answers by position", () => {
  const r = regapEditedText(`area 40, width ${GAP}`, [
    { ask: "a", answer: "40" },
    { ask: "b", answer: "5" },
  ]);
  assert.deepEqual(r?.gaps, [{ ask: "a", answer: "40" }]);
  assert.equal(regapEditedText("   ", []), null);
});

test("an unusable reply is null (a failed read), an empty one is unreadable — never a guess", () => {
  assert.equal(parseSplitReply("sorry, I can't", VISIBLE), null);
  assert.equal(parseSplitReply(reply({ nope: 1 }), VISIBLE), null);
  assert.deepEqual(parseSplitReply(reply({ unreadable: true }), VISIBLE), { kind: "unreadable" });
  assert.deepEqual(parseSplitReply(reply({ questions: [{ text: "  " }] }), VISIBLE), { kind: "unreadable" });
});

test("a pasted chapter is capped", () => {
  const many = Array.from({ length: 40 }, (_, k) => ({ text: `Q${k}` }));
  const r = parseSplitReply(reply({ questions: many }), VISIBLE);
  assert.ok(r?.kind === "questions");
  assert.equal(r.questions.length, MAX_QUESTIONS);
});

test("extractJsonObject is string-aware about braces", () => {
  assert.equal(extractJsonObject('x {"a":"}{"} y'), '{"a":"}{"}');
});

test("FR-3611: after a question is done, 'another' only when a maths question is still open", () => {
  const items = [
    { id: 1, status: "done" as const, subject: "maths" as const },
    { id: 2, status: "open" as const, subject: "other" as const },
  ];
  assert.equal(afterDone(items, 1).another, false);
  assert.equal(afterDone([...items, { id: 3, status: "open", subject: "maths" }], 1).another, true);
});

/* ------------------------------------------------------------- prompts -- */

const prompt = (mode: "walk" | "check" = "walk") =>
  homeworkSystemPrompt({
    student: "Omar",
    question: "Area is 40 m².",
    label: "Q7",
    mode,
    fromUpload: true,
    objective: { id: "u1-4-3", label: "Quadratic word problems", description: null, unit: "Unit 4", mastery: "not started" },
  });

test("FR-3610 / ADR-0025: every safeguard is in the homework prompt", () => {
  const p = prompt();
  assert.match(p, /Never write "The answer is"/);
  assert.match(p, /Here's how I'd set it up/);
  assert.match(p, /start the final step with exactly these words, in bold: \*\*Put your answer back into the question\.\*\*/);
  assert.match(p, /▒▒ marks part of the question nobody could read\. Never guess it/);
  assert.match(p, /do not just agree/);
  assert.match(p, /\[\[lo:u1-4-3\]\]/);
  assert.match(p, /Never print a percentage, score or grade/);
});

test("FR-3609: the two modes give different instructions", () => {
  assert.match(prompt("walk"), /MODE — WALK ME THROUGH IT/);
  assert.match(prompt("check"), /MODE — CHECK MY WORK/);
});

test("FR-3611: {{question_done}} is asked for after the check, and is never rendered as text", () => {
  assert.match(prompt(), /When that check succeeds[^]*\{\{question_done\}\}/);
  const blocks = parseMessage("Well done!\n{{question_done}}", false);
  const shown = JSON.stringify(blocks);
  assert.doesNotMatch(shown, /question_done/);
});

test("the homework tutor asks for the symbol picker the way the lesson does, in both modes", () => {
  for (const mode of ["walk", "check"] as const) {
    assert.match(prompt(mode), /\{\{expects_math\}\} — a SIGNAL/);
  }
  // the chat hands the question's own text to the picker, so its symbols lead
  const page = readFileSync(new URL("../components/student/HomeworkSession.tsx", import.meta.url), "utf8");
  assert.match(page, /mathKeys=\{\{ context: \[item\.text\] \}\}/);
});

test("FR-3604: the split prompt forbids guessing and lists only the objectives given", () => {
  const p = buildSplitPrompt("Q1. x + ▒ = 4", [{ id: "u1-4-3", label: "Linear", unit: "Unit 4" }]);
  assert.match(p, /NEVER guess a value/);
  assert.match(p, /u1-4-3 \| Linear \| Unit 4/);
  assert.match(p, /Use only ids from the list/);
});

test("FR-3614: /api/ask accepts the homework surface and builds its context server-side", () => {
  const route = readFileSync(new URL("../app/api/ask/route.ts", import.meta.url), "utf8");
  assert.match(route, /body\.surface === "homework"/);
  assert.match(route, /buildHomeworkContext\(itemId, chatSession, studentId, client, uploadId\)/);
});
