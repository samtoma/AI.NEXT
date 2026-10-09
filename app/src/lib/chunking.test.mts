/**
 * Chunked tutor turns — docs/design/chunking.md.
 *
 * @covers FR-3501, FR-3502, FR-3503, FR-3504, FR-3505, FR-3506, FR-3507, FR-3508
 *
 * The three complaints this answers (#23): the question at the end of a long
 * reply is missed, one reply carries two topics, and a question arrives in the
 * same breath as the figure it is about. The gate decides when the reveal
 * stops for Next; the ask block makes the question its own thing; the report
 * says, by rule, what a delivered reply broke.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMessage } from "./chat-parse.ts";
import { renderInlineMarkdown } from "./inline-markdown.ts";
import {
  GATE_MIN_WORDS,
  chunkingViolations,
  gateAtBoundary,
  proseWordCount,
} from "./chunking.ts";
import { learnPrompt } from "./lesson.ts";
import { askSystemPrompt } from "./ask.ts";
import { addressForms } from "./address.ts";
import type { LessonData } from "./types.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

/** The worked example from chunking.md §7, as the model writes it. */
const GOOD = `Close, but not quite.
{{beat}}
A function is a **special kind** of relation. [[lo:u1-1-2]]
{{beat}}
A **relation** from X to Y is any set of pairs (a, b). Here a is in X and b is in Y.
{{beat}}
{{ask}}
X = {1, 2} and Y = {2, 4, 6}.
**Can you list a few pairs in X × Y?**`;

/* ------------------------------------------------------------ parsing -- */

test("FR-3502: {{ask}} turns everything after it into one ask block", () => {
  const blocks = parseMessage(GOOD, false);
  const asks = blocks.filter((b) => b.t === "ask");
  assert.equal(asks.length, 1);
  assert.equal(blocks[blocks.length - 1].t, "ask");
  const ask = asks[0] as Extract<(typeof blocks)[number], { t: "ask" }>;
  assert.equal(ask.paras.length, 2, "both question lines belong to the ask");
});

test("FR-3502: an unmarked trailing question after a beat is promoted to the ask", () => {
  const blocks = parseMessage("Nearly.\n{{beat}}\nWhich pairs follow the rule?", false);
  assert.equal(blocks[blocks.length - 1].t, "ask");
});

test("FR-3502: a bold closing question is promoted too — the ? sits inside the **", () => {
  // lesson 1-1's opener, 2026-10-09: no {{ask}}, question bolded
  const opener =
    "An **ordered pair** has two slots.\n{{beat}}\nIf $(a - 2,\\ b + 1) = (b - 4,\\ 3)$, **what do you get when you match the second components first?**";
  assert.equal(parseMessage(opener, false).at(-1)?.t, "ask");
});

test("FR-3502: bold around maths renders as one bold run, never as literal asterisks", () => {
  const html = renderInlineMarkdown(
    "Substitute $b = 2$ in there. **What do you get for $a$?**",
    (tex) => `<m>${tex}</m>`
  );
  assert.equal(
    html,
    "Substitute <m>b = 2</m> in there. <strong>What do you get for <m>a</m>?</strong>"
  );
  assert.ok(!html.includes("*"));
  // multiplication stays literal, maths is never markdown
  assert.equal(renderInlineMarkdown("3 * 4 and $2*x*y$", (t) => `[${t}]`), "3 * 4 and [2*x*y]");
});

test("FR-3502: a one-beat reply ending in a question is left as text, and nothing is promoted while streaming", () => {
  assert.equal(parseMessage("Which pairs follow it?", false).at(-1)?.t, "para");
  assert.equal(
    parseMessage("Nearly.\n{{beat}}\nWhich pairs follow it?", true).at(-1)?.t,
    "para"
  );
});

test("an unclosed **bold** run is held back while streaming, shown once it closes", () => {
  const streaming = parseMessage("Look again.\n{{ask}}\n**Can you point", true);
  assert.ok(!JSON.stringify(streaming).includes("**"));
  const done = parseMessage("Look again.\n{{ask}}\n**Can you point?**", true);
  assert.ok(JSON.stringify(done).includes("**Can you point?**"));
});

test("the {{ask}} marker is held back while it is still streaming in", () => {
  const blocks = parseMessage("Exactly.\n{{as", true);
  assert.deepEqual(
    blocks.map((b) => b.t),
    ["para"]
  );
});

/* --------------------------------------------------------------- gate -- */

const at = (text: string, marker: string) => text.indexOf(marker) + marker.length;

test(`FR-3501: a reply of ${GATE_MIN_WORDS}+ words stops at its beats`, () => {
  const text = `${words(30)}\n{{beat}}\n${words(20)}`;
  assert.ok(proseWordCount(text) >= GATE_MIN_WORDS);
  assert.equal(
    gateAtBoundary({
      text,
      boundaryEnd: at(text, "{{beat}}"),
      streamEnded: true,
      revealedSinceGate: true,
      figureSinceGate: false,
    }),
    "gate"
  );
});

test("FR-3501: a short reply keeps its timed pause", () => {
  const text = "Exactly.\n{{beat}}\nWhich pairs follow it?";
  assert.equal(
    gateAtBoundary({
      text,
      boundaryEnd: at(text, "{{beat}}"),
      streamEnded: true,
      revealedSinceGate: true,
      figureSinceGate: false,
    }),
    "pause"
  );
});

test("FR-3501: below the length, an open stream means wait, not decide", () => {
  const text = "Exactly.\n{{beat}}\nWhich";
  assert.equal(
    gateAtBoundary({
      text,
      boundaryEnd: at(text, "{{beat}}"),
      streamEnded: false,
      revealedSinceGate: true,
      figureSinceGate: false,
    }),
    "wait"
  );
});

test("FR-3501: Next always leads somewhere — no gate before nothing", () => {
  const text = `${words(50)}\n{{beat}}\n{{finish_lesson}}`;
  assert.equal(
    gateAtBoundary({
      text,
      boundaryEnd: at(text, "{{beat}}"),
      streamEnded: true,
      revealedSinceGate: true,
      figureSinceGate: false,
    }),
    "pause"
  );
});

test("FR-3501: two markers in a row never stop twice", () => {
  const text = `${words(50)}\n{{beat}}\n{{ask}}\nWhich?`;
  assert.equal(
    gateAtBoundary({
      text,
      boundaryEnd: at(text, "{{ask}}"),
      streamEnded: true,
      revealedSinceGate: false,
      figureSinceGate: false,
    }),
    "pause"
  );
});

test("FR-3505: a figure always stops before what follows it, whatever the length", () => {
  const text = `{{widget:viz_ref:v:u1-1:001}}\n{{beat}}\n{{ask}}\nWhat do you see?`;
  assert.equal(
    gateAtBoundary({
      text,
      boundaryEnd: at(text, "{{beat}}"),
      streamEnded: true,
      revealedSinceGate: true,
      figureSinceGate: true,
    }),
    "gate"
  );
});

/* --------------------------------------------------------- violations -- */

test("FR-3507: the worked example breaks no rule", () => {
  assert.deepEqual(chunkingViolations(GOOD, { lesson: true }).rules, []);
});

test("FR-3507: the 'before' example from chunking.md breaks the rules it was written to show", () => {
  const before =
    "Ooh, close cousin but not quite — a function is actually a special, extra-strict TYPE of relation, not the whole picture — honestly. Think of it this way: a relation from X to Y is just any set of ordered pairs (a, b) with $a \\in X$ and $b \\in Y$ — really, any subset of X × Y at all, whatever pairs you like to pick from it. So here's my real question: with X = {1, 2} and Y = {2, 4, 6}, what does X × Y even look like?";
  const r = chunkingViolations(before, { lesson: true });
  for (const rule of ["idiom", "all_caps", "dash_overuse", "sentence_too_long", "beat_too_long"]) {
    assert.ok(r.rules.includes(rule as never), `expected ${rule} in ${r.rules.join(",")}`);
  }
});

test("FR-3504: a lesson reply citing two objectives is caught; the Your Progress chat is not held to it", () => {
  const two = "Exactly. [[lo:u1-1-1]]\n{{beat}}\nNow, relations. [[lo:u1-1-2]]";
  assert.ok(chunkingViolations(two, { lesson: true }).rules.includes("multiple_objectives"));
  assert.ok(!chunkingViolations(two, { lesson: false }).rules.includes("multiple_objectives"));
});

test("FR-3503: two asks, or anything after the ask, are caught", () => {
  const two = "Try this.\n{{show_question:q:u1-1-1:001}}\n{{beat}}\n{{ask}}\nAnd why?";
  assert.ok(chunkingViolations(two, { lesson: true }).rules.includes("multiple_asks"));
  const after = "Try this.\n{{ask}}\nWhy?\n{{show_question:q:u1-1-1:001}}";
  assert.ok(chunkingViolations(after, { lesson: true }).rules.includes("ask_not_last"));
});

test("FR-3505: a figure and the ask in one beat are caught", () => {
  const same = "Look.\n{{widget:viz_ref:v:u1-1:001}}\n{{ask}}\nWhat do you see?";
  assert.ok(chunkingViolations(same, { lesson: true }).rules.includes("figure_and_ask_same_beat"));
});

test("FR-3505: a figure sharing its beat with prose is caught", () => {
  const shared = "A **proportion** is two equal ratios.\n{{widget:viz_ref:v:u2-2:001}}\n{{beat}}\n{{ask}}\nWhich?";
  assert.ok(chunkingViolations(shared, { lesson: true }).rules.includes("figure_not_alone"));
});

test("FR-3507: acronyms, bold, math and italics are told apart", () => {
  const ok = "The **LCM** of $ABC$ is in the PDF.";
  assert.deepEqual(chunkingViolations(ok, { lesson: false }).rules, []);
  const r = chunkingViolations("This is *really* a SUBSET.", { lesson: false });
  assert.ok(r.rules.includes("italics"));
  assert.ok(r.rules.includes("all_caps"));
});

test("FR-3507: a forgotten {{ask}} is counted even though the question is still shown in its block", () => {
  const r = chunkingViolations("Nearly.\n{{beat}}\nWhich pairs follow the rule?", { lesson: true });
  assert.ok(r.rules.includes("missing_ask_marker"));
});

/* ------------------------------------------------------------ prompts -- */

const LESSON: LessonData = {
  slug: "u1-1",
  lessonRef: "1-1",
  title: "Cartesian product",
  moduleLabel: "Unit 1",
  courseId: "course:prep3-math-en",
  subject: "math-en",
  los: [
    { id: "lo:u1-1-1", label: "Ordered pairs", description: null, sourcePage: 8, mastery: 0.4 },
  ],
  questions: [],
  visuals: [],
  mapBases: [],
  docTitle: null,
  studentName: "Nour Adel",
  studentId: 7,
  grade: "10",
  gender: "female",
};

test("FR-3504, FR-3506: the lesson prompt states the chunking rules and drops the playful tone", () => {
  for (const probing of [false, true]) {
    const p = learnPrompt(LESSON, probing);
    assert.match(p, /\{\{ask\}\} alone on its own line/);
    assert.match(p, /ONE LEARNING OBJECTIVE PER MESSAGE/);
    assert.match(p, /A FIGURE IS A BEAT OF ITS OWN/);
    assert.match(p, /never CAPITALS for emphasis, never italics/);
    assert.match(p, /no sentence over 20 words/);
    assert.doesNotMatch(p, /playful/);
    assert.match(p, /Never use \{\{check_in\}\}/);
  }
});

test("FR-3503: the Ask surfaces mark their closing question with {{ask}}", () => {
  const a = addressForms("female", "Nour Adel");
  for (const surface of ["student_chat", "spine_chat"] as const) {
    assert.match(askSystemPrompt(surface, "Nour Adel", "math-en", a), /write \{\{ask\}\} alone/);
  }
});

test("FR-3501, FR-3502: the student surface renders the Continue chip and the ask through the shared renderer", () => {
  const core = read("../components/chat/ChatCore.tsx");
  assert.match(core, /gateAtBoundary\(/);
  assert.match(core, /recordChunkAction\("chunk_next"/, "FR-3508: each Continue tap is recorded");
  assert.match(core, /<GateChips/, "the paused reply's moves live in the chip row, not the bubble");
  assert.doesNotMatch(core, /NextBeat/);
  const blocks = read("../components/chat/message-blocks.tsx");
  assert.match(blocks, /b\.t === "ask"/);
  assert.match(blocks, /bg-card-warm/, "the ask is a Honey fill, a token not a literal colour");
});
