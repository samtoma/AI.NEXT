/**
 * THE HANDOFF FILTER — no card to a subject she may not open (Samuel's answer
 * 17, decision 38; spec 003 FR-4006). The lesson prompt offers a handoff only
 * to an open subject; this is the server-side half, for the reply that ignores
 * the prompt. Proved over the whole text and over EVERY way a stream can split
 * it, because the stream and the ledger must agree.
 *
 * @covers FR-4006
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { makeHandoffFilter, stripClosedHandoffs } from "./handoff-filter.ts";
import { parseMessage } from "./chat-parse.ts";

const MATHS_ONLY = new Set(["math"]);
const BOTH = new Set(["math", "social"]);

const REPLY =
  "Good question, but that one belongs to history class!\n{{switch_subject:social}}\nBack to our pairs: what is $(2,3)$?";

/** Every two-way split, and every character alone — the stream's worst cases. */
function streamed(text: string, open: ReadonlySet<string>, cuts: number[]): string {
  const f = makeHandoffFilter(open);
  let out = "";
  let at = 0;
  for (const c of [...cuts, text.length]) {
    out += f.push(text.slice(at, c));
    at = c;
  }
  return out + f.end();
}

test("a handoff to a closed subject is removed, with its line, and nothing else changes", () => {
  assert.equal(
    stripClosedHandoffs(REPLY, MATHS_ONLY),
    "Good question, but that one belongs to history class!\nBack to our pairs: what is $(2,3)$?"
  );
  // the card is gone as far as the client's parser is concerned
  const blocks = parseMessage(stripClosedHandoffs(REPLY, MATHS_ONLY), false);
  assert.ok(!JSON.stringify(blocks).includes("switch_subject"));
});

test("a handoff to an open subject passes through untouched", () => {
  assert.equal(stripClosedHandoffs(REPLY, BOTH), REPLY);
  assert.ok(JSON.stringify(parseMessage(REPLY, false)).includes("switch_subject"));
});

test("streaming: every split point gives exactly the whole-text answer", () => {
  for (const open of [MATHS_ONLY, BOTH]) {
    const want = stripClosedHandoffs(REPLY, open);
    for (let i = 0; i <= REPLY.length; i++) {
      assert.equal(streamed(REPLY, open, [i]), want, `split at ${i}`);
    }
    const oneByOne = [...Array(REPLY.length).keys()].slice(1);
    assert.equal(streamed(REPLY, open, oneByOne), want, "one character at a time");
  }
});

test("streaming holds back only what could still become a handoff", () => {
  const f = makeHandoffFilter(MATHS_ONLY);
  // other directives are released at once, not held
  assert.equal(f.push("Try this:\n{{show_question:q:u1-1-1:001}}"), "Try this:\n{{show_question:q:u1-1-1:001}}");
  assert.equal(f.push(" and {{beat}} now"), " and {{beat}} now");
  // a possible handoff is held, then released when it turns out to be something else
  assert.equal(f.push(" {{sw"), " ");
  assert.equal(f.push("itcheroo}} ok"), "{{switcheroo}} ok");
  assert.equal(f.end(), "");
  assert.equal(f.removed, 0);
});

test("the filter counts what it removed, and an unknown key is closed too", () => {
  const f = makeHandoffFilter(MATHS_ONLY);
  const out = f.push("a\n{{switch_subject:social}}\nb\n{{switch_subject:chemistry}}") + f.end();
  assert.equal(out, "a\nb");
  assert.equal(f.removed, 2);
});

test("the ask route sends every model delta through the filter, and logs what she saw", () => {
  const route = readFileSync(fileURLToPath(new URL("../app/api/ask/route.ts", import.meta.url)), "utf8");
  assert.match(route, /makeHandoffFilter\(/);
  assert.match(route, /stripClosedHandoffs\(fullText, /);
  // no raw model text is sent as a delta any more — only the filter's output
  assert.doesNotMatch(route, /send\(\{ type: "delta", t: j\.event\.delta\.text \}\)/);
  assert.doesNotMatch(route, /send\(\{ type: "delta", t: fullText\.slice\(/);
});
