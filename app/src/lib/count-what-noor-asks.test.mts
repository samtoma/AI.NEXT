/**
 * "Count what Noor asks" (Tamer, 2026-10-28): more of what a student answers
 * in a lesson reaches mastery, and the second answer to the same question
 * never does.
 *
 *   node --import ./scripts/ts-resolver.mjs --test src/lib/count-what-noor-asks.test.mts
 *
 *  1. The attempts route, read as source: a second answer to the same question
 *     in the same sitting is recorded and writes no mastery and no advance.
 *  2. ChatCore grades a card answered in words on every lesson surface, not
 *     only where Socratic probing is on.
 *  3. Every Social Studies and Arabic widget reports a first-try verdict, and
 *     LessonSession records it; a composed widget with no "lo" falls back to
 *     the objective the lesson is on.
 *  4. The learn prompt sends checks to the QUESTION BANK.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { learnWrongAnswerRules } from "./socratic-probing.ts";
import { addressForms } from "./address.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(HERE, rel), "utf8");

test("1: a repeat answer in the same sitting is recorded and moves nothing", () => {
  const src = read("../app/api/attempts/route.ts");
  const repeatAt = src.indexOf("const repeat =");
  assert.ok(repeatAt > src.indexOf("const attemptId = attemptRes.rows[0].id"), "decided after the attempt row is written");
  assert.match(src, /question_id = \$2\s+AND session_id = \$3 AND id <> \$4/);
  assert.match(src, /const newScore = repeat\s+\? oldScore/);
  assert.match(src, /if \(!repeat\) \{\s+if \(row\) \{/, "the mastery close-and-open is skipped");
  assert.match(src, /if \(!repeat && attemptCanCrossGate\(/, "no lesson advance on a repeat");
  assert.match(src, /\.\.\.\(repeat \? \{ counted: false as const \} : \{\}\)/, "the result says so");
});

test("2: a card answered in words is graded in every lesson", () => {
  const src = read("../components/chat/ChatCore.tsx");
  const at = src.indexOf("const submittedGiven = extractAnswerSubmitted(acc);");
  const guard = src.slice(src.lastIndexOf("if (", at), at);
  assert.match(guard, /if \(lessonSurface\) \{/);
  assert.ok(!guard.includes("probingActive"), "no longer gated on probing");
  // and the tutor hears when an answer did not count
  assert.ok(src.includes("r.counted === false"));
});

const SELF_CORRECTING = [
  "LocateOnMap", "TimelineBuilder", "ChainBuilder", "TermMatch",
  "ExtractSpans", "HamzaSeat", "StylePurpose", "IrabBuilder",
];

test("3: every self-correcting widget reports a first-try verdict, and the lesson records it", () => {
  for (const w of SELF_CORRECTING) {
    const src = read(`../components/student/widgets/${w}.tsx`);
    assert.ok(src.includes("onResult: WidgetResult;"), `${w}: onResult carries the verdict`);
  }
  const lesson = read("../components/student/LessonSession.tsx");
  const body = lesson.slice(lesson.indexOf("const renderWidget = useCallback("), lesson.indexOf("[first, widgetPronoun, recordInlineWidget]"));
  assert.ok(!body.includes("onResult={emitNote}"), "no widget only tells the tutor");
  assert.equal((body.match(/onResult=\{onResult\}/g) ?? []).length, SELF_CORRECTING.length);
  assert.match(lesson, /inlineWidgetLo\(props\) \?\? \(last && loById\.has\(last\) \? last : lesson\.los\[0\]\?\.id\)/);
});

test("4: checks come from the QUESTION BANK; the typed-answer rule is on with probing off", () => {
  assert.ok(read("lesson.ts").includes("- CHECKS COME FROM THE QUESTION BANK."));
  const off = learnWrongAnswerRules(addressForms("female", "Nour Adel"), "figure", false);
  assert.ok(off.includes("{{answer_submitted:<that value>}}"));
  assert.ok(off.includes("only the first answer to a card counts"));
});

test("5: a typed answer may hold braces — a set reaches the grader whole", async () => {
  const { extractAnswerSubmitted } = await import("./chat-parse.ts");
  assert.equal(
    extractAnswerSubmitted("{{answer_submitted:\\{(2, 4), (2, 0), (-1, 4), (-1, 0)\\}}}"),
    "\\{(2, 4), (2, 0), (-1, 4), (-1, 0)\\}"
  );
  assert.equal(extractAnswerSubmitted("{{answer_submitted:{(1,3),(2,3)}}}\n"), "{(1,3),(2,3)}");
  assert.equal(extractAnswerSubmitted("{{answer_submitted:B}}"), "B");
  assert.equal(extractAnswerSubmitted("no tag here"), null);
});

test("6: an unreadable typed answer is told to Noor, and the card stays open", () => {
  const src = read("../components/chat/ChatCore.tsx");
  const branch = src.slice(src.indexOf("if (e instanceof AttemptRetryError) {"), src.indexOf('console.error("chat-typed answer submission failed:"'));
  assert.match(branch, /\{ role: "note", kind: "event", text: UNREAD_ANSWER_NOTE \}/, "the tutor hears it");
  assert.match(branch, /localOnly: true, text: e\.retry\.message/, "the student still sees the marker's words");
  const note = src.match(/export const UNREAD_ANSWER_NOTE =\s*"((?:[^"\\]|\\.)*)";/)?.[1] ?? "";
  assert.ok(note.length > 0, "the note is a single string literal");
  // an event naming the open card's id is what closes it (openQuestionId)
  assert.ok(!/q:/.test(note), "the note must not name a question id");
  assert.ok(note.includes("{{answer_submitted:…}}"));
  assert.ok(note.includes("first answer to this card"), "the retyped answer counts as the first");
  // 2026-10-29 live test: Noor praised a retyped answer as "written properly
  // with braces this time" — the unreadable attempt may be our parser's fault
  assert.match(note, /react only to the maths/, "Noor reacts to the maths alone");
  assert.match(note, /never mention it, the retry, the format/, "Noor must not comment on the retry or the format");
  assert.match(note, /never say \\"this time\\"/, "Noor must not say 'this time'");
});
