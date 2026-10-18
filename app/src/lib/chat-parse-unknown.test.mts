/**
 * An unknown directive never reaches the student as raw braces.
 *
 * A student saw `{{expects_question:q:pp3u1-1-1:bk-drill-1-a}}` printed in a
 * lesson: the tutor blended a hint about maths input with
 * `{{show_question:q:…}}`. The parser now consumes any well-formed `{{name}}`
 * / `{{name:payload}}` it does not know — a `…_question:q:…` near-miss becomes
 * the question card it meant, anything else renders as nothing — and warns in
 * the console so prompt drift stays visible. Maths and single braces are
 * untouched, and the streaming tail still withholds a half-typed one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  directiveEndAt,
  parseMessage,
  stripIncompleteTail,
} from "./chat-parse.ts";

/** Run `fn` with console.warn captured. */
function warnings(fn: () => void): string[] {
  const seen: string[] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]) => void seen.push(a.join(" "));
  try {
    fn();
  } finally {
    console.warn = orig;
  }
  return seen;
}

const visibleText = (text: string, streaming = false) =>
  JSON.stringify(parseMessage(text, streaming));

test("the expects_question near-miss becomes the question card it meant", () => {
  const reply = "Try this one:\n{{expects_question:q:pp3u1-1-1:bk-drill-1-a}}\nTake your time.";
  let blocks: ReturnType<typeof parseMessage> = [];
  const warned = warnings(() => (blocks = parseMessage(reply, false)));
  assert.deepEqual(blocks, [
    { t: "para", inlines: [{ t: "text", v: "Try this one:" }] },
    { t: "question", qid: "q:pp3u1-1-1:bk-drill-1-a" },
    { t: "para", inlines: [{ t: "text", v: "Take your time." }] },
  ]);
  assert.equal(warned.length, 1);
  assert.match(warned[0], /expects_question/);
  // same outcome as the directive it should have been
  assert.deepEqual(
    blocks,
    parseMessage(reply.replace("expects_question", "show_question"), false)
  );
});

test("a _question near-miss without a question id is not turned into a card", () => {
  const blocks = parseMessage("Now {{next_question:soon}} ok", false);
  assert.ok(!blocks.some((b) => b.t === "question"));
  assert.ok(!JSON.stringify(blocks).includes("{{"));
});

test("an unknown bare directive is consumed and renders nothing", () => {
  let blocks: ReturnType<typeof parseMessage> = [];
  const warned = warnings(() => (blocks = parseMessage("Ready?\n{{expects_math_unknown_bare}}\nGo.", false)));
  assert.deepEqual(blocks, [
    { t: "para", inlines: [{ t: "text", v: "Ready?" }] },
    { t: "para", inlines: [{ t: "text", v: "Go." }] },
  ]);
  assert.match(warned.join("\n"), /expects_math_unknown_bare/);
});

test("an unknown directive with a payload is consumed and renders nothing", () => {
  const blocks = parseMessage("Well done {{celebrate_payload:confetti, big}} — next!", false);
  assert.ok(!visibleText("Well done {{celebrate_payload:confetti, big}} — next!").includes("{{"));
  assert.deepEqual(blocks, [
    { t: "para", inlines: [{ t: "text", v: "Well done" }] },
    { t: "para", inlines: [{ t: "text", v: "— next!" }] },
  ]);
});

test("the warning names each unknown directive once, not on every streamed delta", () => {
  const text = "a {{repeat_once_check}} b";
  const warned = warnings(() => {
    for (let i = 0; i < 5; i++) parseMessage(text, false);
  });
  assert.equal(warned.length, 1);
});

test("a known directive with an unknown argument is no longer printed raw", () => {
  // a handoff to a subject the product does not have (the server filter strips
  // it too, FR-4006 — this is the client's half)
  assert.ok(!visibleText("ok {{switch_subject:chemistry}} ok").includes("{{"));
});

test("known directives are unaffected", () => {
  const reply = [
    "{{show_question:q:u1-4-1:002}}",
    "{{highlight:lo:u1-2-1,lo:u1-3-1}}",
    '{{widget:pair_plotter:{"prompt":"Plot (3,2)","target":[3,2]}}}',
    "{{widget:viz_ref:v:geo1-1:001}}",
    "{{show_passage:t:ara1-1:001}}",
    "{{beat}}",
    "{{check_in}}",
    "{{reveal_answer}}",
    "{{answer_submitted:B}}",
    "{{switch_subject:social}}",
    "{{finish_lesson}}",
  ].join("\n");
  let blocks: ReturnType<typeof parseMessage> = [];
  const warned = warnings(() => (blocks = parseMessage(reply, false)));
  assert.deepEqual(
    blocks.map((b) => b.t),
    [
      "question",
      "highlight",
      "widget",
      "widget",
      "passage_ref",
      "beat",
      "check_in",
      "reveal_answer",
      "answer_submitted",
      "switch_subject",
      "finish",
    ]
  );
  assert.deepEqual(warned, [], "a known directive never warns");
});

test("single braces, maths and TeX grouping are ordinary text", () => {
  for (const text of [
    "The set {x} has one element, and {a, b} has two.",
    "Solve $x^{2} = 9$ for $x$.",
    "Expand $x^{{n}}$ and $\\frac{{a}}{b}$.",
    "Use {{ and }} as literal braces here.",
    "A {{Capital}} or {{two words}} is not protocol.",
  ]) {
    const warned = warnings(() => {
      const blocks = parseMessage(text, false);
      assert.deepEqual(blocks, [{ t: "para", inlines: [{ t: "text", v: text }] }], text);
    });
    assert.deepEqual(warned, [], text);
  }
});

test("streaming: a half-typed unknown directive is withheld, then consumed", () => {
  const full = "Try:\n{{expects_question:q:pp3u1-1-1:bk-drill-1-a}}";
  const start = full.indexOf("{{");
  for (let n = start + 1; n < full.length; n++) {
    const shown = stripIncompleteTail(full.slice(0, n));
    assert.ok(!shown.includes("{{"), `prefix of ${n} chars shows "${shown}"`);
    assert.ok(!visibleText(full.slice(0, n), true).includes("expects"), `prefix ${n}`);
  }
  assert.equal(directiveEndAt(full.slice(0, full.length - 1), start), "incomplete");
  assert.equal(directiveEndAt(full, start), full.length);
  assert.ok(visibleText(full, true).includes('"question"'));
});

test("streaming: text that can never be a directive is not held back", () => {
  assert.equal(stripIncompleteTail("Use {{two words"), "Use {{two words");
  assert.equal(directiveEndAt("{{two words}}", 0), null);
  // maths is not held as a directive (the open "$" holds it, as before)
  assert.equal(stripIncompleteTail("Expand $x^{{n}}$ now"), "Expand $x^{{n}}$ now");
});
