/**
 * A FLAGGED WORKING STEP, AS A REVIEWER SEES IT (FR-4411 → FR-4501): the REAL
 * `ReviewItemView`, rendered to HTML with react-dom/server — the pattern of
 * `student/whole-book-render.test.mts`.
 *
 *   · the book's numbered working, one row per step, numbered the way the
 *     checker numbered it; the flagged steps outlined and labelled — in words,
 *     not by colour alone;
 *   · what the checker found: quote, expected, why, where it puts the fault
 *     (a stem misprint reads as a question problem), the prompts version, the
 *     run and the file;
 *   · the calibration class and evidence, so a false alarm reads as one — and
 *     the words that it is evidence, never a review;
 *   · a quote that is no longer in its step says so (a correction may have
 *     landed);
 *   · an earlier decision reads in the kind's own words ("Marked not an error");
 *   · tokens only: no literal colour in what this view draws.
 *
 * `.tsx` has no loader in plain `node --test`, so this file registers one for
 * its own imports (TypeScript's `transpileModule`, JSX to `react/jsx-runtime`,
 * `next/*` subpaths given the `.js` their package needs under ESM).
 *
 * @covers FR-2204
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { ReviewItemPayload } from "../../lib/review-gate.ts";
import type { WorkingFlagItemPayload, WorkingFlagPayload } from "../../lib/review-gate-working.ts";

type Loaded = { format: string; source: string; shortCircuit?: boolean };
type LoadHook = (url: string, context: unknown, nextLoad: (url: string, context: unknown) => Loaded) => Loaded;
const { createRequire, registerHooks } = nodeModule as unknown as {
  createRequire: typeof nodeModule.createRequire;
  registerHooks: (hooks: { load: LoadHook }) => void;
};
const require = createRequire(import.meta.url);
const ts = require("typescript") as typeof import("typescript");
registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith(".tsx")) return nextLoad(url, context);
    const file = fileURLToPath(url);
    const out = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: file,
    });
    const source = out.outputText.replace(/(["'])next\/([a-z/-]+)\1/g, (_m, q: string, sub: string) => `${q}next/${sub}.js${q}`);
    return { format: "module", source, shortCircuit: true };
  },
});

const { createElement: h } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { ReviewItemView } = await import("./ReviewItemView.tsx");

const render = (item: ReviewItemPayload) => renderToStaticMarkup(h(ReviewItemView, { item }) as Parameters<typeof renderToStaticMarkup>[0]);
const SRC = readFileSync(fileURLToPath(new URL("./ReviewItemView.tsx", import.meta.url)), "utf8");

/* ------------------------------------------------------------ fixtures */

const flag = (over: Partial<WorkingFlagPayload>): WorkingFlagPayload => ({
  step: 2,
  kind: "label",
  where: "working",
  quote: "m_{PR}\\times m_{QR}",
  expected: "m_{PQ}\\times m_{QR}",
  why: "The values substituted are m_PQ and m_QR.",
  sources: ["agent"],
  quoteFound: true,
  ...over,
});

const working = (over: Partial<WorkingFlagItemPayload>): WorkingFlagItemPayload => ({
  solutionId: "expl:g10m8s3-2-2:ex8-6-26",
  solutionKind: "worked_example",
  book: "g10-math",
  chapter: 8,
  promptsVersion: "sw-v1",
  runs: ["92e155285bf70af84019dece6fa5c8aab0bdff9febfb2e921cfb38b150652f1f"],
  source: "services/extraction/runs/g10-math/working-check/ch08.flags.json",
  problem: "Show that $\\triangle PQR$ is right angled.",
  sourcePage: 322,
  steps: [
    { n: 1, text: "First draw a sketch." },
    { n: 2, text: "$m_{PR}\\times m_{QR}=-1$" },
    { n: 3, text: "" },
    { n: 4, text: "Therefore $PR\\perp QR$." },
  ],
  flags: [flag({ step: 2 })],
  calibration: null,
  ...over,
});

const item = (wf: WorkingFlagItemPayload, over: Partial<ReviewItemPayload> = {}): ReviewItemPayload => ({
  kind: "working_flag",
  ref: wf.solutionId,
  fingerprint: "a".repeat(32),
  state: "open",
  reasons: [{ code: "working_flagged", detail: "step 2 of the working (checker sw-v1)" }],
  courseId: "course:us-g10-math-en",
  courseLabel: "Mathematics — Grade 10 (American)",
  moduleId: "module:g10m-c08",
  moduleLabel: "Chapter 8 — Analytical geometry",
  loId: "lo:g10m8s3-2-2",
  loLabel: "Parallel and perpendicular lines",
  createdAt: "2026-09-26T16:14:07.740Z",
  claimExpiresAt: null,
  workingFlag: wf,
  history: [],
  ...over,
});

const CALIBRATION = {
  classifiedBy: "qa-engineer, each flag read against the book's own equation images",
  classifiedOn: "2026-10-01",
  sourceRun: "wf_957393ec-d74 (prompts sw-v1), runs/g10-math/working-check/ch08.flags.json",
  promptsVersion: "sw-v1",
  source: "services/extraction/runs/g10-math/working-check/ch08.calibration.json",
};

/* ------------------------------------------------------------ the view */

test("the working is numbered as the checker numbered it, the flagged step outlined and labelled in words", () => {
  const html = render(item(working({})));
  for (const n of [1, 2, 3, 4]) assert.match(html, new RegExp(`id="working-step-${n}"`), `step ${n} has a row`);
  const row = (n: number) => html.match(new RegExp(`<li id="working-step-${n}" class="([^"]*)"`))![1]!;
  assert.match(row(2), /\bbg-gold-wash\b/, "the flagged step is tinted…");
  assert.match(row(2), /\bborder-gold\/50\b/, "…and outlined");
  assert.doesNotMatch(row(1), /gold/);
  assert.doesNotMatch(row(4), /gold/);
  assert.equal(html.match(/⚑ flagged/g)?.length, 1, "…and says so in words, once");
  assert.match(html, /⚑ flagged · label changes/);
  assert.match(html, /\(empty step\)/, "an empty step keeps its row and number");
  assert.match(html, /worked example · book p\.322/);
  assert.match(html, /As the student sees it/);
  // the item's own header
  assert.match(html, /Working step flagged/);
  assert.match(html, /Checker flagged a step/);
  assert.match(html, /expl:g10m8s3-2-2:ex8-6-26/);
});

test("what the checker found: the quote, what it expected, why, where, which run — and that nothing was corrected", () => {
  const html = render(item(working({ flags: [flag({ step: 2, sources: ["agent", "numeric"], numeric: { left: "-1/7 × 7", relation: "=", right: "-1", why: "holds" } })] })));
  assert.match(html, /Step 2/);
  assert.match(html, /href="#working-step-2"/, "the finding points at its step");
  assert.match(html, /m_\{PR\}\\times m_\{QR\}/, "the quote, as the checker wrote it");
  assert.match(html, /m_\{PQ\}\\times m_\{QR\}/, "what it expected");
  assert.match(html, /The values substituted are m_PQ and m_QR\./);
  assert.match(html, /in the working/);
  assert.match(html, /agent/);
  assert.match(html, /numeric/);
  assert.match(html, /Numeric pre-check/);
  assert.match(html, /prompts sw-v1/);
  assert.match(html, /run 92e155285bf7…/, "the run, shortened");
  assert.match(html, /services\/extraction\/runs\/g10-math\/working-check\/ch08\.flags\.json/);
  assert.match(html, /students see the working as the book prints it/);
  assert.match(html, /none on record for this chapter/, "no calibration file, no class");
  assert.doesNotMatch(html, /Read the question too/, "the checker blames a step, not the stem");
});

test("a false alarm reads as one — with the evidence, and the words that it is not a review", () => {
  const html = render(
    item(
      working({
        flags: [
          flag({ step: 2, calibration: { verdict: "FALSE", evidence: "The question is about S and T; the checker misread it." } }),
          flag({ step: 4, kind: "other", quote: "PR\\perp QR", calibration: { verdict: "REAL", evidence: "The book prints PR perp QR." } }),
        ],
        calibration: CALIBRATION,
      })
    )
  );
  assert.match(html, /calibration: false alarm/);
  assert.match(html, /calibration: real/);
  assert.match(html, /false alarm — the checker&#x27;s mistake\./);
  assert.match(html, /The question is about S and T; the checker misread it\./);
  assert.match(html, /real defect in the book\./);
  assert.match(html, /classified 2026-10-01 by qa-engineer/);
  assert.match(html, /evidence, never a review: only your decision closes this item/);
  assert.equal(html.match(/⚑ flagged/g)?.length, 2, "two flagged steps, two labels");
});

test("a calibration run of another checker version says so", () => {
  const html = render(item(working({ promptsVersion: "sw-v2", flags: [flag({ calibration: { verdict: "REAL", evidence: "x" } })], calibration: CALIBRATION })));
  assert.match(html, /a run of sw-v1; this flag is from sw-v2/);
});

test("a stem misprint reads as a question problem, not a working error", () => {
  const onlyQuestion = render(item(working({ flags: [flag({ step: 2, where: "question" })] })));
  assert.match(onlyQuestion, /Read the question too/);
  assert.match(onlyQuestion, /puts the fault in the question text \(a stem misprint\)/);
  assert.match(onlyQuestion, /in the question text/);

  const unsure = render(item(working({ flags: [flag({ step: 2, where: "unsure" })] })));
  assert.match(unsure, /Read the question too/);
  assert.match(unsure, /the checker is unsure/);
});

test("a quote that is no longer in its step says a correction may have landed", () => {
  const gone = render(item(working({ flags: [flag({ quoteFound: false })] })));
  assert.match(gone, /The quoted text is not in step 2 as it reads now/);
  assert.match(gone, /say “Not an error”/);
  assert.doesNotMatch(render(item(working({}))), /The quoted text is not in step/);
});

test("a flagged question is drawn as the card the student sees, with its working outlined", () => {
  const wf = working({ solutionId: "q:g10m8s2-1-1:we01", solutionKind: "question", problem: null, flags: [flag({ step: 2 })] });
  const html = render(
    item(wf, {
      ref: "q:g10m8s2-1-1:we01",
      question: {
        id: "q:g10m8s2-1-1:we01",
        questionType: "numeric",
        tier: "standard",
        stem: "Find the distance between $S(-2, -5)$ and $Q(7, -2)$.",
        choices: null,
        correctAnswer: "9.5",
        solution: [{ step: 1, text: "ignored — the numbered working is drawn instead" }],
        solutionVersion: 2,
        status: "live",
        source: "seed",
        sourcePage: 289,
        sourceNote: null,
        parentId: null,
        parentKind: "question",
        parentStem: null,
        family: null,
        reviewedBy: null,
        reviewedAt: null,
        aiCheckedBy: "ai dual-check",
        aiCheckedAt: "2026-09-26T16:14:07.740Z",
        holdReason: null,
        reviewNote: null,
        figures: [],
        misconceptions: {},
      },
    })
  );
  assert.match(html, /question · numeric/, "the student's card");
  assert.match(html, /Answer key:/);
  assert.match(html, /here&#x27;s how to solve it — the worked solution \(v2\)/);
  assert.match(html, /id="working-step-2"/);
  assert.doesNotMatch(html, /ignored — the numbered working/, "the numbered working replaces the plain list");
  assert.match(html, /Human stamp/, "and who has checked it, as for any question");
});

test("an earlier decision reads in the kind's words", () => {
  const html = render(
    item(working({}), {
      state: "approved",
      history: [
        { decision: "approve", operatorName: "Tamer", decidedAt: "2026-10-01T12:00:00.000Z", note: null, suggestedCorrection: null, current: true },
        { decision: "fix_requested", operatorName: "Kamil", decidedAt: "2026-09-30T12:00:00.000Z", note: "Step 2: m_{PQ}", suggestedCorrection: "$m_{PQ}$", current: false },
      ],
    })
  );
  assert.match(html, /Marked not an error<\/span> by Tamer/);
  assert.match(html, /Fix needed<\/span> by Kamil/);
  assert.match(html, /on an earlier version/);
  assert.match(html, /Suggested:/);
});

test("a flagged item whose payload could not be read says so, rather than failing the page", () => {
  const html = render({ ...item(working({})), workingFlag: undefined });
  assert.match(html, /could not be read/);
});

test("no literal colour in what the view draws (constitution XII: tokens only)", () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.doesNotMatch(code, /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
});
