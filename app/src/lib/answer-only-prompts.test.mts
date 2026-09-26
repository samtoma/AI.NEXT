/**
 * `answer_only` IN THE TUTOR'S PROMPTS (Samuel's G2 answer 22, 2026-09-26).
 * A question whose book prints no worked solution reaches the lesson prompt's
 * question bank and the Ask context's question in scope with the answer-only
 * instruction IN PLACE of its solution steps — rendered through the REAL
 * builders over the fake pool. The same question without the flag is
 * unchanged, which is also why both prompt goldens are.
 *
 * @covers FR-4320
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { installFixturePool, type FixtureCurriculum } from "./prompt-fixture-pool.mts";
import { ANSWER_ONLY_INSTRUCTION } from "./question-flags.ts";

const COURSE = "course:us-g10-math-en";
const step = (n: number, text_md: string) => ({ step: n, text_md });
const WORKING = "Pythagoras: $3^2 + 5^2 = 34$, so the length is $\\sqrt{34}$.";

/**
 * The contract's shape (`specs/003-curriculum-tracks/contracts/pipeline-handoff.md`): `answer_only`
 * sits beside `"marker"` on a marked expression question; the options shape is accepted too.
 */
type Shape = "marker" | "options";
const MARKER = { kind: "expression", key: "sqrt(34)", form: "exact", variables: [] as string[] };

function choicesOf(shape: Shape, answerOnly: boolean): unknown {
  if (shape === "marker") return answerOnly ? { marker: MARKER, answer_only: true } : { marker: MARKER };
  const options = [{ key: "A", text: "$\\sqrt{34}$" }, { key: "B", text: "$8$" }];
  return answerOnly ? { options, answer_only: true } : options;
}

function curriculum(answerOnly: boolean, shape: Shape = "marker"): FixtureCurriculum {
  return {
    docs: [{ sha256: "sha-g10", title: "Everything Maths Grade 10", publisher: "Siyavula", edition: "1", grade: "10", subject: "mathematics" }],
    nodes: [
      { id: COURSE, kind: "course", label: "Mathematics — Grade 10", source_sha256: "sha-g10" },
      { id: "module:g10m-c08", kind: "module", label: "Chapter 8 — Euclidean geometry", order_in_parent: 8 },
      { id: "lo:g10m8s6-1-1", kind: "learning_objective", label: "Lengths in quadrilaterals", description: "Find a side.", syllabus_ref: "8.6", order_in_parent: 1, source_page: 300 },
    ],
    edges: [
      { src: "module:g10m-c08", dst: COURSE, type: "part_of" },
      { src: "module:g10m-c08", dst: "lo:g10m8s6-1-1", type: "teaches" },
    ],
    questions: [
      {
        id: "q:g10m8s6-1-1:ex24a", lo_id: "lo:g10m8s6-1-1", tier: "standard",
        question_type: shape === "marker" ? "short" : "mcq",
        stem: "Find the length of the diagonal.",
        choices: choicesOf(shape, answerOnly),
        correct_answer: shape === "marker" ? "\\sqrt{34}" : "A",
        canonical_solution: [step(1, WORKING)],
        source_page: 300, source_sha256: "sha-g10",
      },
    ],
    visuals: [],
  };
}

const lesson = await import("./lesson.ts");
const ask = await import("./ask.ts");

async function render(answerOnly: boolean, shape: Shape = "marker") {
  installFixturePool(curriculum(answerOnly, shape));
  const learn = await lesson.buildLessonContext("learn", "ao", "g10m8s6-1");
  const review = await lesson.buildLessonContext("review", "ao", "g10m8s6-1");
  const askCtx = await ask.buildAskContext("student_chat", "ao", "q:g10m8s6-1-1:ex24a", "B");
  assert.ok(learn && review);
  return { learn: learn.dataBlock, review: review.dataBlock, ask: askCtx.dataBlock };
}

test("an answer_only question carries the instruction, never its working, on every prompt path", async () => {
  for (const shape of ["marker", "options"] as const) {
    const flagged = await render(true, shape);
    for (const [path, text] of Object.entries(flagged)) {
      assert.ok(text.includes(ANSWER_ONLY_INSTRUCTION), `${shape}/${path}: the instruction is there`);
      assert.ok(!text.includes(WORKING), `${shape}/${path}: the worked solution is not handed to the tutor`);
      assert.ok(text.includes("q:g10m8s6-1-1:ex24a"), `${shape}/${path}: the question itself still is`);
    }
  }
});

test("the same question without the flag is unchanged — its working is there, the instruction is not", async () => {
  for (const shape of ["marker", "options"] as const) {
    const plain = await render(false, shape);
    for (const [path, text] of Object.entries(plain)) {
      assert.ok(text.includes(WORKING), `${shape}/${path}`);
      assert.ok(!text.includes("ANSWER ONLY"), `${shape}/${path}`);
    }
  }
});
