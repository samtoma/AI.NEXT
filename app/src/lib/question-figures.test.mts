/**
 * A QUESTION'S OWN FIGURE ON ITS CARD, AND NEVER "[figure]" (consistency
 * review 2026-09-27, A3; `lib/question-figures.ts`).
 *
 * The rule is pure and tested here; the readers that attach `figures`
 * (`getLessonData`, `getSpineData`, `getStudentPlan`) are run against
 * Postgres in `curriculum-scope-db.test.mts`; the cards are checked by source.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { displayStem, figuresByQuestion, hasFigurePlaceholder, noteFigureless } from "./question-figures.ts";

const src = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test("the placeholder is never printed, and the words around it stay apart", () => {
  assert.equal(displayStem("In the diagram [figure] find $AB$."), "In the diagram find $AB$.");
  assert.equal(displayStem("[figure]\nFind the gradient."), "Find the gradient.");
  assert.equal(displayStem("Use the figure: [FIGURE]"), "Use the figure:");
  assert.equal(hasFigurePlaceholder(displayStem("a [figure] b [figure] c")), false);
  // every other stem is untouched, byte for byte
  for (const s of ["Find $x$ if $2x = 6$.", "ما أكبر قارات العالم مساحة؟", "  spaced  "]) {
    assert.equal(displayStem(s), s);
  }
});

test("each question's own figures, from the visual rows, in the order given", () => {
  const m = figuresByQuestion([
    { id: "v:a:1", question_id: "q:1" },
    { id: "v:a:2", question_id: null },
    { id: "v:a:3", question_id: "q:1" },
    { id: "v:b:1", questionId: "q:2" },
  ]);
  assert.deepEqual(Object.fromEntries(m), { "q:1": ["v:a:1", "v:a:3"], "q:2": ["v:b:1"] });
});

test("a figureless '[figure]' question is logged once — and one with its figure not at all", () => {
  const logged: string[] = [];
  const real = console.warn;
  console.warn = (m: string) => void logged.push(String(m));
  try {
    noteFigureless({ id: "q:t:1", stem: "See [figure]." });
    noteFigureless({ id: "q:t:1", stem: "See [figure]." });
    noteFigureless({ id: "q:t:2", stem: "See [figure].", figures: ["v:t:2"] });
    noteFigureless({ id: "q:t:3", stem: "No placeholder." });
  } finally {
    console.warn = real;
  }
  assert.equal(logged.length, 1);
  assert.match(logged[0], /q:t:1/);
});

test("every student card that shows a stem hides the placeholder; the question cards show its figure", () => {
  for (const [file, stem, figures] of [
    ["../components/chat/ChatQuestionCard.tsx", "q.stem", "q.figures"],
    ["../components/student/StudentLoop.tsx", "item.stem", "item.figures"],
    ["../components/spine/QuestionModal.tsx", "q.stem", "q.figures"],
  ] as const) {
    const code = src(file);
    assert.ok(code.includes(`<TeX text={displayStem(${stem})} />`), `${file}: the stem goes through displayStem`);
    assert.ok(code.includes(`<QuestionFigures ids={${figures}} />`), `${file}: the question's own figure is shown`);
    assert.ok(!code.includes(`<TeX text={${stem}} />`), `${file}: no raw stem left`);
  }
  assert.ok(src("../components/spine/LoPanel.tsx").includes("<TeX text={displayStem(q.stem)} />"));
  assert.match(src("../components/spine/SpineExplorer.tsx"), /displayStem\(q\.stem\)/);
  // the figure goes through the gated /api/visuals route, like every stored figure
  assert.match(src("../components/viz/QuestionFigures.tsx"), /<VizRefCard key=\{id\} id=\{id\} \/>/);
});
