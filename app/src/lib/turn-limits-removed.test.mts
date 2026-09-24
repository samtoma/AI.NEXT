/**
 * **No surface refuses a student's turn for count** (ADR-0023, FR-3401) —
 * asserted against the source rather than promised in a comment.
 *
 * Until v0.9.0 `/api/ask` held `TURN_CAPS` and `CAP_MESSAGES`, refused the
 * request after a conversation's 2nd / 18th / 5th delivered reply with a `cap`
 * frame, and the client locked its input ("AI turn limit reached for this
 * question"). The failure this guards against is the obvious one: somebody
 * adds a "sensible" limit back at one call site because cost looked high on a
 * dashboard, and a student is stopped mid-lesson again without anybody having
 * decided it. Reintroducing a limit is an ADR, not a line.
 *
 * What stays is pinned too, so this cannot pass by the feature being gone: the
 * turn index is still counted, the thresholds still exist (as numbers the
 * console counts against), and the review-mode Finish nudge still reads one.
 *
 * Comments are stripped before scanning — the files explain what was removed,
 * and a sentence about a thing is not the thing (`teaching-snapshot.test.mts`'s
 * stripper, copied).
 *
 * @covers FR-3401
 * @covers FR-3402
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const SELF = fileURLToPath(import.meta.url);

const src = (rel: string) => readFileSync(join(SRC, rel), "utf8");
/** Source with comments removed, so a sentence ABOUT a thing is not the thing. */
const code = (rel: string) =>
  src(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Every .ts/.tsx file under src/, tests excluded. */
function sourceFiles(dir = SRC): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.m?ts$/.test(name) && p !== SELF) out.push(p);
  }
  return out;
}

test("/api/ask refuses nothing for count: no caps, no cap messages, no cap frame", () => {
  const ask = code("app/api/ask/route.ts");
  assert.doesNotMatch(ask, /TURN_CAPS/);
  assert.doesNotMatch(ask, /CAP_MESSAGES/);
  assert.doesNotMatch(ask, /\bcapped\b/, "no capped branch and no capped meta field");
  assert.doesNotMatch(ask, /type:\s*"cap"/, "no cap frame");
  assert.doesNotMatch(ask, /TURN_THRESHOLDS|thresholdOf|thresholdStatus/, "the route reads no threshold at all");
  // The only early exits before the model runs are the ones that are not about count.
  assert.doesNotMatch(ask, /delivered\s*>=/, "no comparison against a delivered count");
});

test("/api/ask still counts the conversation's turns, for turn_index and nothing else", () => {
  const ask = code("app/api/ask/route.ts");
  assert.match(
    ask,
    /SELECT count\(\*\) AS logged\s+FROM ai_interactions\s+WHERE surface = \$1 AND grounding->>'chat_session' = \$2 AND student_id = \$3/,
    "the conversation key the console counts by must stay the one this route writes"
  );
  assert.match(ask, /turnIndex: priorTurns \+ 1/);
});

test("ChatCore has no capped lock, no cap-frame handling and no limit placeholder", () => {
  const core = code("components/chat/ChatCore.tsx");
  assert.doesNotMatch(core, /\bcapped\b|setCapped/);
  assert.doesNotMatch(core, /onCapped/);
  assert.doesNotMatch(core, /j\.type === "cap"/);
  assert.doesNotMatch(core, /turn limit/i);
  assert.doesNotMatch(core, /my limit, on purpose/);
  // the input is disabled only while a reply is streaming
  assert.match(core, /disabled=\{streaming\}/);
  assert.match(core, /disabled=\{streaming \|\| !input\.trim\(\)\}/);
});

test("the stream's meta carries no capped field any more", () => {
  const types = code("lib/types.ts");
  const meta = types.slice(types.indexOf("export interface TurnMeta"), types.indexOf("export type ChatRole"));
  assert.ok(meta.length > 0);
  assert.doesNotMatch(meta, /capped/);
});

test("no component anywhere passes or accepts onCapped, and no student copy names a limit", () => {
  for (const file of sourceFiles()) {
    const text = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.doesNotMatch(text, /onCapped/, file);
    assert.doesNotMatch(text, /AI turn limit reached/, file);
    assert.doesNotMatch(text, /max 2 AI turns per question/, file);
  }
});

test("quick revision's Finish nudge reads the threshold, and only nudges", () => {
  const lesson = code("components/student/LessonSession.tsx");
  assert.doesNotMatch(lesson, /REVIEW_TURN_CAP/);
  assert.match(lesson, /import \{ TURN_THRESHOLDS \} from "@\/lib\/turn-thresholds"/);
  assert.match(lesson, /const REVIEW_FINISH_NUDGE_AT = TURN_THRESHOLDS\.lesson_review;/);
  // what the nudge does: arm Finish — nothing that would stop the student typing
  assert.match(lesson, /if \(mode === "review" && t >= REVIEW_FINISH_NUDGE_AT\) setReadyToFinish\(true\);/);
});

test("the out-of-sitting probing read existed only for refused turns, and is gone with them", () => {
  const sessions = code("lib/sessions.ts");
  assert.doesNotMatch(sessions, /peekSessionProbing/);
});
