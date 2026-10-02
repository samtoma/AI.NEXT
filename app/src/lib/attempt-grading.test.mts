/**
 * The attempts route's marking dispatch (T416; FR-4320, 001 FR-C03, SC-212).
 *
 *   node --import ./scripts/ts-resolver.mjs --test src/lib/attempt-grading.test.mts
 *
 * @covers FR-4320
 *
 *  1. `markAnswer`: the marker runs only when `choices.marker` is present; everything else is today's
 *     `grade()`, and `grade()` is v0.9.3's byte for byte.
 *  2. The route, read as source: a re-entry is decided after the course gate and before anything is
 *     written, it leaves the unit of work by throwing (so it rolls back whole), and it is answered 422.
 *  3. The client seam: a 422 re-entry reaches the card as `AttemptRetryError`, never as a result.
 *
 * The same dispatch replayed over every recorded attempt of the local databases is
 * `scripts/marker-eval/replay-attempts.mts` (1,545 of 1,545 identical on 2026-09-26).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { grade, markAnswer } from "./attempt-grading.ts";
import { MarkerKeyError } from "./answer-marker.ts";
import { AttemptRetryError, submitAttempt } from "./attempts-client.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(HERE, rel), "utf8");
const fnText = (src: string) => {
  const start = src.search(/\n(export )?function grade\(/);
  return src.slice(start + 1, src.indexOf("\n}\n", start) + 2).replace(/^export /, "");
};

// ------------------------------------------------------------------ 1. markAnswer

test("grade() is v0.9.3's grader, byte for byte (the replay's frozen copy)", () => {
  assert.equal(fnText(read("attempt-grading.ts")), fnText(read("../../scripts/marker-eval/replay-attempts.mts")));
  assert.ok(!/function grade\(/.test(read("../app/api/attempts/route.ts")), "the route must not keep a second grader");
});

test("no marker spec: every question is marked by grade(), exactly as today (FR-C03)", () => {
  const cases: [string, string, unknown, string][] = [
    ["numeric", "12", null, "12"],
    ["numeric", "12", null, "12.0"],
    ["numeric", "12", null, "3x4"],
    ["numeric", "12", null, "3*4"],
    ["numeric", "12", null, "13"],
    ["numeric", "0.5", null, "0,5"], // today's grader reads 0,5 as text: unchanged, deliberately
    ["numeric", "-3", null, " -3 "],
    ["mcq", "B", [{ key: "A", text: "1" }, { key: "B", text: "2" }], "b"],
    ["mcq", "B", [{ key: "A", text: "1" }, { key: "B", text: "2" }], "A"],
    ["short", "x^2-9", null, "x²−9"],
    ["short", "rhombus", null, " Rhombus "],
    ["numeric", "12", { kind: "number_line", spec: {}, diagnostics: [] }, "12"],
  ];
  for (const [question_type, correct_answer, choices, given] of cases) {
    const v = markAnswer({ question_type, correct_answer, choices }, given);
    assert.deepEqual(v, { verdict: "graded", isCorrect: grade(question_type, correct_answer, given), by: "grade" }, given);
  }
});

test("a marker spec: the marker marks it, and its verdicts are recorded like any other", () => {
  const q = {
    question_type: "short",
    correct_answer: "(x-3)(x+3)",
    choices: { marker: { kind: "expression", key: "(x-3)(x+3)", form: "factorised", variables: ["x"] } },
  };
  assert.deepEqual(markAnswer(q, "(x+3)(x-3)"), { verdict: "graded", isCorrect: true, by: "marker" });
  assert.deepEqual(markAnswer(q, "(x-3)(x-3)"), { verdict: "graded", isCorrect: false, by: "marker" });
  // grade() would have called this wrong: the string differs
  assert.equal(grade(q.question_type, q.correct_answer, "(3+x)(x-3)"), false);
  assert.deepEqual(markAnswer(q, "(3+x)(x-3)"), { verdict: "graded", isCorrect: true, by: "marker" });
});

test("wrong form and unreadable are re-entries, not verdicts, and carry the student's message", () => {
  const q = {
    question_type: "short",
    correct_answer: "(x-3)(x+3)",
    choices: { marker: { kind: "expression", key: "(x-3)(x+3)", form: "factorised", variables: ["x"] } },
  };
  const wf = markAnswer(q, "x^2 - 9");
  assert.equal(wf.verdict, "retry");
  assert.ok(wf.verdict === "retry" && wf.retry === "wrong_form" && wf.form === "factorised");
  assert.match(wf.verdict === "retry" ? wf.message : "", /factorised/);
  const un = markAnswer(q, "1/2x");
  assert.ok(un.verdict === "retry" && un.retry === "unreadable" && un.reason === "ambiguous division: add brackets");
  assert.match(un.verdict === "retry" ? un.message : "", /brackets/);
  const empty = markAnswer(q, "   ");
  assert.ok(empty.verdict === "retry" && empty.retry === "unreadable");
});

test("a spec or key the marker cannot use is a content defect: it throws, it is never the student's", () => {
  const bad = (marker: unknown) => ({ question_type: "short", correct_answer: "x", choices: { marker } });
  assert.throws(() => markAnswer(bad({ kind: "polynomial", key: "x" }), "x"), MarkerKeyError);
  assert.throws(() => markAnswer(bad({ kind: "expression", key: "\\frac{1}{" }), "x"), MarkerKeyError);
  assert.throws(() => markAnswer(bad("x"), "x"), MarkerKeyError);
});

// ------------------------------------------------------------------ 2. the route, as source

const route = read("../app/api/attempts/route.ts");
const at = (needle: string | RegExp) => {
  const i = typeof needle === "string" ? route.indexOf(needle) : route.search(needle);
  assert.ok(i >= 0, `route.ts: ${needle} not found`);
  return i;
};

test("route: the marker runs after the course gate and before anything is written", () => {
  const unit = at("await withPrincipal(studentId, async (client) => {");
  const gate = at("visibleCoursesFor(studentId, client)");
  const decide = at("markAnswer(q, givenAnswer)");
  const reentry = at("throw new ReentryRequested(");
  assert.ok(unit < gate && gate < decide && decide < reentry, "gate → decide → re-entry, inside the unit of work");
  // nothing a re-entry could leave behind is reached before it
  for (const write of ["currentSessionSnapshot(", "INSERT INTO attempts", "INSERT INTO mastery", "INSERT INTO explanation_log", "advanceIfMastered("]) {
    assert.ok(reentry < at(write), `${write} must come after the re-entry decision`);
  }
  // widgets keep their predicate; the marker is never asked about them
  assert.match(route, /const verdict = isWidget \? null : markAnswer\(q, givenAnswer\);/);
});

test("route: a re-entry is answered 422 with the marker's body only, and a key defect 500, both logged", () => {
  const handler = route.slice(at("if (err instanceof ReentryRequested) {"));
  assert.match(handler, /return NextResponse\.json\(err\.body, \{ status: 422 \}\);/);
  assert.match(route, /if \(err instanceof MarkerKeyError\) \{[\s\S]*?status: 500/);
  // the 422 body is the marker's retry, never the answer or the worked solution
  const body = route.slice(at("class ReentryRequested"), at("export async function POST"));
  assert.ok(!/correctAnswer|correct_answer|solution/.test(body));
  // what is logged names the question and the reason, never what was typed
  const log = handler.slice(0, handler.indexOf("return NextResponse.json(err.body"));
  assert.ok(!/givenAnswer/.test(log), "a minor's typed text is not logged");
});

// ------------------------------------------------------------------ 3. the client seam

test("client: a 422 re-entry throws AttemptRetryError; any other failure stays a plain error", async () => {
  const realFetch = globalThis.fetch;
  const answer = (status: number, body: unknown) => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  };
  try {
    const retry = { retry: "wrong_form", form: "factorised", message: "That's equivalent, but…" };
    answer(422, retry);
    await assert.rejects(
      submitAttempt({ questionId: "q", givenAnswer: "x^2-9", timeMs: 1 }),
      (e: unknown) => e instanceof AttemptRetryError && e.retry.form === "factorised" && e.message === retry.message
    );
    answer(422, { error: "something else" });
    await assert.rejects(submitAttempt({ questionId: "q", givenAnswer: "x", timeMs: 1 }), (e: unknown) =>
      e instanceof Error && !(e instanceof AttemptRetryError) && e.message === "API 422"
    );
    answer(500, { error: "internal error" });
    await assert.rejects(submitAttempt({ questionId: "q", givenAnswer: "x", timeMs: 1 }), /API 500/);
    answer(200, { attemptId: 1, isCorrect: true });
    assert.deepEqual(await submitAttempt({ questionId: "q", givenAnswer: "x", timeMs: 1 }), { attemptId: 1, isCorrect: true });
  } finally {
    globalThis.fetch = realFetch;
  }
});
