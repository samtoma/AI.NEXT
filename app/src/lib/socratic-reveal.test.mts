/**
 * With Socratic probing on, the answer comes out on the student's SECOND
 * attempt on the objective and not before, whatever they ask (FR-3112).
 *
 * Samuel, 2026-09-24. Three things used to let it out earlier, and each is
 * pinned here:
 *
 *  1. The tutor's instructions allowed "just tell me" after one attempt and
 *     had the model emit `{{reveal_answer}}` — the prompt now says to hold
 *     until the "SOCRATIC PROBE — REVEALED" event, and no longer mentions the
 *     directive (the one prompt edit authorised against ADR-0020's hold).
 *  2. The confirmation-pending live-event note let the tutor quote the
 *     material once the student had "engaged with a guiding question, or
 *     explicitly asks you to just say it" — it now names REVEALED too.
 *  3. ChatCore turned a streamed `{{reveal_answer}}` into `wrongCount: 2`,
 *     so one model slip opened the card — that branch is gone, and the card,
 *     the board and the REVEALED event all read `cardRevealUnlocked`.
 *
 * ChatCore's stream handler is a React closure over a fetch and cannot be
 * driven under `node --test`, so (3) and the live-event note are source scans
 * with comments stripped, in the style of `teaching-snapshot.test.mts`. The
 * prompt rules and the threshold are pure and tested directly; the rule as it
 * sits in the whole learn prompt is asserted in `socratic-probing.test.mts`,
 * which may import `lib/lesson.ts` (`scripts/ts-resolver.mjs`). Probing OFF
 * is covered, byte for byte, by `probing-prompts.test.mts`, which this change
 * does not touch.
 *
 * @covers FR-3112
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { addressForms, type Gender } from "./address.ts";
import { parseMessage } from "./chat-parse.ts";
import {
  REVEAL_AFTER_WRONG_ATTEMPTS,
  cardRevealUnlocked,
  cardWithholdsAnswer,
  learnWrongAnswerRules,
} from "./socratic-probing.ts";

const src = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
/** Source with comments removed, so a sentence ABOUT a thing is not the thing. */
const code = (rel: string) =>
  src(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/* ------------------------------------------------------------ threshold */

test("the reveal unlocks at the second wrong attempt, and the number lives in one place", () => {
  assert.equal(REVEAL_AFTER_WRONG_ATTEMPTS, 2);
  assert.equal(cardRevealUnlocked(0), false);
  assert.equal(cardRevealUnlocked(1), false, "one wrong attempt never opens the card");
  assert.equal(cardRevealUnlocked(2), true);
  assert.equal(cardRevealUnlocked(3), true);
  for (const nothing of [null, undefined, Number.NaN]) {
    assert.equal(cardRevealUnlocked(nothing), false, String(nothing));
  }
  // …and composed with the card's own rule: withheld after one, shown after two
  assert.equal(cardWithholdsAnswer(true, cardRevealUnlocked(1)), true);
  assert.equal(cardWithholdsAnswer(true, cardRevealUnlocked(2)), false);
});

test("the card, the board and the REVEALED event all read cardRevealUnlocked — no second copy of the number", () => {
  const core = code("components/chat/ChatCore.tsx");
  const board = code("components/student/WhiteboardPanel.tsx");
  assert.match(core, /revealAnswer=\{pendingLoId === q\.loId && cardRevealUnlocked\(pendingWrongCount\)\}/);
  assert.match(core, /cardRevealUnlocked\(wrongCountAfter\)\s*\?\s*`\\nSOCRATIC PROBE — REVEALED/);
  assert.match(board, /pendingLoId === focusedQ\.loId && cardRevealUnlocked\(pendingWrongCount\)/);
  for (const [name, text] of [["ChatCore", core], ["WhiteboardPanel", board]] as const) {
    assert.doesNotMatch(text, /[Ww]rongCount(After)?\s*\?\?\s*0\)\s*>=\s*2|[Ww]rongCount(After)?\s*>=\s*2/, `${name} compares against 2 itself`);
  }
});

/* --------------------------------------------- a directive opens nothing */

test("a streamed {{reveal_answer}} no longer changes the pending wrong count or opens the card", () => {
  const core = code("components/chat/ChatCore.tsx");
  assert.doesNotMatch(core, /hasRevealAnswerDirective/, "the stream handler no longer looks for it");
  assert.doesNotMatch(core, /reveal_answer/, "nothing in ChatCore's code acts on the directive");
  assert.doesNotMatch(core, /wrongCount:\s*Math\.max\(/, "no path forces the wrong count up");
  // the only writes to wrongCount are the attempt path's: first wrong = 1, then +1
  // (the two `wrongCount: number;` hits are the state's type, not writes)
  const writes = core.match(/wrongCount:\s*[^,;}\n]+/g) ?? [];
  assert.ok(writes.some((w) => /wrongCountAfter/.test(w)), "the attempt path still writes it");
  for (const w of writes) {
    assert.match(w, /^wrongCount:\s*(number|wrongCountAfter)\s*$/, w);
  }
  // and wrongCountAfter is the attempt path's own: first wrong = 1, then +1
  assert.match(core, /const wrongCountAfter =\s*wasPending\?\.loId === q\.loId \? wasPending\.wrongCount \+ 1 : 1;/);
  assert.doesNotMatch(code("lib/chat-parse.ts"), /export function hasRevealAnswerDirective/);
});

test("the directive, if a model still emits it, never shows as text", () => {
  const blocks = parseMessage("Let's look at it again.\n{{reveal_answer}}", false);
  assert.ok(blocks.some((b) => b.t === "reveal_answer"), "it is parsed as a directive block");
  const shown = JSON.stringify(blocks.filter((b) => b.t !== "reveal_answer"));
  assert.doesNotMatch(shown, /reveal_answer|\{\{/);
  // and the renderer swallows the block
  assert.match(code("components/chat/message-blocks.tsx"), /b\.t === "answer_submitted" \|\| b\.t === "reveal_answer"\) return;/);
});

/* ------------------------------------------------------------- the prompt */

test("probing on: asking to be told the answer does not get it before REVEALED", () => {
  for (const g of ["female", "male", "unspecified", null] as Gender[]) {
    const a = addressForms(g, "Nour Adel");
    const rules = learnWrongAnswerRules(a, "figure / tap", true);
    const ask = rules.split("\n").find((l) => l.includes("to just be told the answer"));
    assert.ok(ask, `gender=${g}: the ask rule is missing`);
    assert.equal(
      ask,
      `  · If ${a.they} explicitly ask${a.s} to just be told the answer / give${a.s} up before the "SOCRATIC PROBE — REVEALED" event for this LO (that is, before ${a.their} second attempt), do NOT reveal, hint at, or confirm the answer — warmly insist on an attempt at your guiding question first ("no worries — even a guess helps, take your best shot"). Once REVEALED has fired, answer the ask by walking the material's own steps, same as the REVEALED case above.`
    );
    // the old permission is gone, and so is every mention of the directive
    assert.doesNotMatch(rules, /reveal_answer/, `gender=${g}`);
    assert.doesNotMatch(rules, /ONLY once a genuine attempt already exists/, `gender=${g}`);
    assert.match(
      rules,
      /· Never emit \{\{answer_submitted:\.\.\.\}\} for a currently-open WIDGET question —/,
      `gender=${g}: the widget rule keeps answer_submitted only`
    );
  }
});

test("probing off: the rules are untouched by FR-3112", () => {
  const off = learnWrongAnswerRules(addressForms("female", "Nour Adel"), "figure / tap", false);
  assert.doesNotMatch(off, /REVEALED|reveal_answer|told the answer/);
});

test("the confirmation-pending live-event note holds the material until REVEALED, asked or not", () => {
  const core = src("components/chat/ChatCore.tsx");
  assert.ok(
    core.includes(
      "(do not quote, hint at or assert it until the SOCRATIC PROBE — REVEALED event for this LO — the student's second attempt — even if the student asks you to just say it)"
    )
  );
  assert.ok(!core.includes("or explicitly asks you to just say it"), "the old escape hatch is gone");
  assert.ok(!core.includes("engaged with at least one guiding question"), "the old one-attempt condition is gone");
});
