/**
 * The Your Progress chat (the `spine_chat` surface beside the student's map)
 * talks to the student and never quizzes.
 *
 * It was built on 2026-07-19 as an investor demo — "an observer watching the
 * student's graph", with "quizzing" among its typical asks — and kept that
 * prompt after the page became the student's own (#12, FR-3219). No
 * requirement asked it to push question cards. Decided 2026-09-30 (Tamer):
 * explain, plan and cite; practice happens in lessons and "Just practise".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { askSystemPrompt } from "./ask.ts";
import { addressForms, type Gender } from "./address.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const GENDERS: Gender[] = ["female", "male", "unspecified", null];

test("the Your Progress chat has no question-pushing tool, and is told never to quiz", () => {
  for (const g of GENDERS) {
    const p = askSystemPrompt("spine_chat", "Nour Adel", "math-en", addressForms(g, "Nour Adel"));
    assert.doesNotMatch(p, /\{\{show_question:q:/, `no example of the directive (gender=${g})`);
    assert.match(p, /never quiz: do NOT emit \{\{show_question:\.\.\.\}\}/);
    assert.doesNotMatch(p, /quizzing/);
  }
});

test("it speaks to the student, not to an observer or an audience", () => {
  for (const g of GENDERS) {
    const p = askSystemPrompt("spine_chat", "Nour Adel", "math-en", addressForms(g, "Nour Adel"));
    assert.match(p, /You are chatting directly with Nour Adel, beside .* own progress map/);
    assert.match(p, /MODE — YOUR PROGRESS \(you are talking directly to Nour Adel/);
    assert.doesNotMatch(p, /observer|audience|live demo/);
  }
});

test("it says progress in words, never a number", () => {
  const p = askSystemPrompt("spine_chat", "Nour Adel", "math-en", addressForms("female", "Nour Adel"));
  assert.match(p, /Never quote a mastery number, percentage or score/);
});

test("the practice re-explain chat still re-explains, and no longer calls itself a demo", () => {
  const p = askSystemPrompt("student_chat", "Nour Adel", "math-en", addressForms("female", "Nour Adel"));
  assert.match(p, /You are chatting directly with the student Nour Adel\./);
  assert.doesNotMatch(p, /live demo/);
  assert.match(p, /MODE — RE-EXPLANATION TO THE STUDENT/);
});

test("the data block says cite, not push, on the Your Progress chat only", () => {
  const src = read("./ask.ts");
  assert.match(
    src,
    /\$\{surface === "spine_chat" \? "Cite question ids" : "Push question cards"\} ONLY from this list:/
  );
});

test("the panel draws no question card even if the model emits one", () => {
  assert.match(read("../components/spine/NoorPanel.tsx"), /questionCards=\{false\}/);
  const chat = read("../components/chat/ChatCore.tsx");
  assert.match(chat, /questionCards = true,/);
  assert.match(chat, /question: \(b, i\) => \{\s*if \(!questionCards\) return null;/);
});
