/**
 * BYTE-IDENTITY of the two prompts P6 brought into the capture harness.
 *
 * Constitution IX's discipline is "prove the prompts you did not mean to change
 * did not change", and the two prompts below were invisible to the harness when
 * the phase started — so neither the before nor the after capture can prove the
 * MOVE was faithful, only what happened afterwards. The expected strings here
 * were captured by evaluating the inline expressions in
 * `api/understanding/route.ts` and `lib/uploads.ts` at commit f90daee, BEFORE a
 * line of either was touched, and pasted in verbatim.
 *
 * The grader then gained the address seam, so the expectation is stated where
 * it still holds exactly: the MASCULINE register reproduces the pre-P6 bytes
 * character for character, because the pre-P6 text was the masculine register
 * written out by hand for every student alike. That is the whole defect in one
 * assertion — the old prompt is not "the neutral one", it is one of three, and
 * it was being served to girls.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  UNDERSTANDING_SYSTEM_PROMPT,
  buildUnderstandingPrompt,
  understandingRetryPrompt,
} from "./understanding-prompt.ts";
import { PARSE_PROMPT, buildUploadParsePrompt } from "./upload-prompt.ts";
import type { LessonLo } from "./types.ts";

/** The fixed input the pre-refactor capture was evaluated against. */
const LOS: LessonLo[] = [
  {
    id: "lo:u1-1-1",
    label: "Ordered pairs",
    description: "The ordered pair (a, b).",
    sourcePage: 8,
    mastery: 0.4,
  },
  {
    id: "lo:u1-1-2",
    label: "Cartesian product",
    description: "A x B as a set of pairs.",
    sourcePage: 9,
    mastery: 0,
  },
];

const TRANSCRIPT = [
  { role: "user", text: "ready" },
  { role: "assistant", text: "Great - let's start." },
  { role: "note", text: "q:u1-1-1:001 answered correctly" },
] as const;

const BASE = {
  los: LOS,
  studentName: "Omar Hassan",
  grade: "10",
  lessonRef: "1-1",
  title: "Cartesian product",
  moduleLabel: "Unit 1",
  transcript: TRANSCRIPT,
} as const;

/* -------------------------------------------------------------------------
 * Captured at f90daee, verbatim. Do not reformat.
 * ---------------------------------------------------------------------- */

const BEFORE_SYSTEM = `You are the honest comprehension grader of Noor, an adaptive math tutor. You rate how well the student actually understood a lesson, based ONLY on the session transcript. You output STRICT JSON and nothing else — no markdown fences, no prose.`;

const BEFORE_LEARN = `Session: AI-taught lesson (he's had a first go at this one and it's still taking shape).
Student: Omar Hassan, grade 10. Lesson: 1-1 — Cartesian product (Unit 1).
Learning objectives covered:
- lo:u1-1-1 "Ordered pairs": The ordered pair (a, b).
- lo:u1-1-2 "Cartesian product": A x B as a set of pairs.

GRADING RULES:
- Weigh ACTUAL performance — the "[live event]" lines (question attempts ✓/✗, widget results) — far above self-report or politeness.
- Be honest but fair: in learn mode, visible progress across the session counts in his favor; early mistakes that were later corrected are progress, not failure.
- verdict bands: got_it = score >= 80, nearly = 55–79, needs_work < 55.
- strengths and gaps: 1–4 short concrete phrases each, referencing the actual content of THIS lesson (its objectives, figures, and exercises as they appeared in the transcript). gaps may be empty ([]) if there truly are none.
- next_step: ONE actionable, encouraging sentence for tomorrow. Never punitive.

Return STRICT JSON exactly in this shape:
{"score": <integer 0-100>, "verdict": "got_it" | "nearly" | "needs_work", "strengths": ["...", ...], "gaps": ["...", ...], "next_step": "..."}

TRANSCRIPT:
Student: ready
Tutor: Great - let's start.
[live event] q:u1-1-1:001 answered correctly`;

const BEFORE_REVIEW_FIRST_LINE = `Session: quick revision (the student said he understood everything at school).`;

const BEFORE_RETRY = `BASE\n\nYour previous output was INVALID:\nnot json at all\nReturn ONLY the strict JSON object this time. No other text.`;

const BEFORE_PARSE_PROMPT = `Read the file at the path given below and transcribe the mathematics in it.

Rules:
- Transcribe ONLY the academic content: the problem, the working, the answer.
- Do NOT describe or transcribe anything incidental — people, faces, rooms,
  names, addresses, phone numbers, or anything else not part of the maths.
- If part of it is genuinely unreadable, say so explicitly and transcribe the
  rest. Never guess at an unreadable digit, symbol or step.
- If NOTHING is readable, or you cannot open the file at all, reply with exactly: UNREADABLE
- Reply with the transcription only — no preamble, no commentary, no JSON.`;

/* ---------------------------------------------------------------------- */

test("the grader's system prompt is byte-identical to the inline one", () => {
  assert.equal(UNDERSTANDING_SYSTEM_PROMPT, BEFORE_SYSTEM);
});

test("learn mode, masculine register, is byte-identical to the inline prompt", () => {
  assert.equal(
    buildUnderstandingPrompt({ ...BASE, mode: "learn", gender: "male" }),
    BEFORE_LEARN
  );
});

test("review mode, masculine register, is byte-identical to the inline prompt", () => {
  const out = buildUnderstandingPrompt({
    ...BASE,
    mode: "review",
    gender: "male",
  });
  assert.equal(out.split("\n")[0], BEFORE_REVIEW_FIRST_LINE);
  // everything after the premise line is register-free and must not have moved
  assert.equal(
    out.slice(out.indexOf("\n")),
    BEFORE_LEARN.slice(BEFORE_LEARN.indexOf("\n"))
  );
});

test("the retry wrapper is byte-identical to the inline one", () => {
  assert.equal(understandingRetryPrompt("BASE", "not json at all"), BEFORE_RETRY);
});

test("the upload parse prompt is byte-identical, and carries no register", () => {
  assert.equal(PARSE_PROMPT, BEFORE_PARSE_PROMPT);
  assert.equal(
    buildUploadParsePrompt("/uploads/1/x.png"),
    `${BEFORE_PARSE_PROMPT}\n\nFile to read: /uploads/1/x.png\n`
  );
  // it transcribes a file; it addresses nobody, so no pronoun belongs in it
  assert.equal(/\b(he|him|his|she|her|they|them)\b/i.test(PARSE_PROMPT), false);
});
