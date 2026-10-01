/**
 * Where the lesson transcript scrolls when a message lands.
 *
 * @covers FR-3222
 *
 * The bug, in one sentence: the transcript always pinned to the BOTTOM, so a
 * tall widget arriving after its explanation pushed that explanation, and the
 * widget's own question line, above the fold. The frame — the whole message —
 * is what gets aligned, not the block alone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BLOCK_TOP_MARGIN,
  CHAT_INTERACTIVE_ATTR,
  offsetTopWithin,
  scrollTopFor,
} from "./chat-scroll.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

// A 500px window over 2000px of transcript: bottom-pinned, it shows 1500–2000.
const view = { scrollHeight: 2000, clientHeight: 500 };

test("no interactive block in the newest message: pin to the bottom, as before", () => {
  assert.equal(scrollTopFor({ ...view, frameTop: null }), 1500);
});

test("a message that fits in the bottom-pinned window is left alone", () => {
  // top at 1600, inside 1500–2000: pinning shows all of it
  assert.equal(scrollTopFor({ ...view, frameTop: 1600 }), 1500);
  // a block whose top is exactly the window's top
  assert.equal(scrollTopFor({ ...view, frameTop: 1500 }), 1500);
});

test("a message taller than the window is shown from its top, with the margin", () => {
  // 900px block ending at the bottom: top at 1100, hidden by a bottom pin
  assert.equal(
    scrollTopFor({ ...view, frameTop: 1100 }),
    1100 - BLOCK_TOP_MARGIN
  );
});

test("a message whose top is just above the pinned window is aligned too", () => {
  // block top 1450 is above the pinned window (1500), even though the block is small
  assert.equal(scrollTopFor({ ...view, frameTop: 1450 }), 1450 - BLOCK_TOP_MARGIN);
});

test("never scrolls past the bottom or above the top", () => {
  // the margin cannot push the target past the pinned position
  assert.equal(scrollTopFor({ ...view, frameTop: 1499 }), 1499 - BLOCK_TOP_MARGIN);
  assert.ok(scrollTopFor({ ...view, frameTop: 1499 }) <= 1500);
  // a block at the very top of the transcript
  assert.equal(scrollTopFor({ ...view, frameTop: 3 }), 0);
  assert.equal(scrollTopFor({ ...view, frameTop: 0 }), 0);
});

test("a transcript shorter than the window has nowhere to scroll", () => {
  assert.equal(scrollTopFor({ scrollHeight: 300, clientHeight: 500, frameTop: 40 }), 0);
  assert.equal(scrollTopFor({ scrollHeight: 300, clientHeight: 500, frameTop: null }), 0);
});

test("the margin can be overridden", () => {
  assert.equal(scrollTopFor({ ...view, frameTop: 1100, topMargin: 0 }), 1100);
});

test("offsetTopWithin sums layout offsets up to the container, ignoring transforms", () => {
  const container = {};
  const bubble = { offsetTop: 800, offsetParent: container };
  const widget = { offsetTop: 220, offsetParent: bubble };
  const well = { offsetTop: 60, offsetParent: widget };
  assert.equal(offsetTopWithin(container, bubble), 800);
  assert.equal(offsetTopWithin(container, widget), 1020);
  assert.equal(offsetTopWithin(container, well), 1080);
});

// The three slots a student has to act on carry the marker, and the newest-row
// lookup and the "our own scroll is not the student leaving" guard are wired in.
test("ChatCore aligns the newest row's frame, and re-checks when it resizes", () => {
  const src = read("../components/chat/ChatCore.tsx");
  assert.equal(CHAT_INTERACTIVE_ATTR, "data-chat-interactive");
  assert.equal((src.match(/\{\.\.\.\{ \[CHAT_INTERACTIVE_ATTR\]: "" \}\}/g) ?? []).length, 3);
  assert.match(src, /scrollTopFor\(\{/);
  // the ROW (the frame, explanation included), not the block inside it
  assert.match(src, /const row = el\.lastElementChild as HTMLElement \| null;/);
  assert.match(src, /frameTop: row && acts \? offsetTopWithin\(el, row\) : null/);
  // a widget that grows after it mounts is re-checked
  assert.match(src, /new ResizeObserver\(\(\) => follow\(\)\)/);
  assert.match(src, /programmaticTop\.current = el\.scrollTop/);
  assert.match(src, /Math\.abs\(el\.scrollTop - programmaticTop\.current\) <= 1/);
  assert.match(src, /thin-scroll relative min-h-0 flex-1/);
});

test("the old unconditional bottom pin is gone", () => {
  const src = read("../components/chat/ChatCore.tsx");
  assert.doesNotMatch(src, /el\.scrollTop = el\.scrollHeight/);
});

test("the Your Progress Map chat shows any long tutor reply from its top", () => {
  const chat = read("../components/chat/ChatCore.tsx");
  assert.match(chat, /alignTutorTop = false,/);
  assert.match(chat, /\(alignTutorTop && !!row\?\.querySelector\("\.noor-bubble-tutor"\)\)/);
  assert.match(read("../components/spine/NoorPanel.tsx"), /\n\s+alignTutorTop\n/);
  // the lesson chat keeps the widget/question-only rule
  assert.doesNotMatch(read("../components/student/LessonSession.tsx"), /alignTutorTop/);
});
