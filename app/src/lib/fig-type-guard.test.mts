/**
 * TEXT IN WIDGETS, FIGURES AND QUESTION CARDS IS READABLE AT THE SIZE THE
 * STUDENT SEES IT (owner review 2026-10-26; globals.css, the section of the
 * same name).
 *
 * The Noor Play type scale has three steps a figure may use — read 1rem,
 * label 0.85rem, data 0.72rem (handoff tokens.css `--play-text-*`) — and the
 * data step is the smallest size in the system. Text drawn in an SVG gets
 * them through the `fig-read` / `fig-label` / `fig-data` classes inside a
 * `<FigureSvg>`, which sets them in RENDERED px whatever the viewBox scale;
 * a bare `fontSize="8"` is 8 viewBox units, which on an iPad drew under 9px.
 *
 * Over every `.tsx` in the widget, figure and question-card folders:
 *   · no `fontSize` on an element — a figure's text takes a fig-* class;
 *   · no `<svg>` in a file that draws `<text>` — it is a `<FigureSvg>`;
 *   · no arbitrary Tailwind size below the data step (`text-[11px]`,
 *     `text-[0.6rem]`) — the tokens are `text-read` / `text-label` /
 *     `text-data`, and Arabic takes `--ar-size-min`;
 *   · no `--ink-faint` on text (`text-ink-faint`, a faint `fill`): it is
 *     3.2:1 on the default ground and fails AA. A stroke may stay faint —
 *     a rule or a dash is decoration. Meaning-bearing secondary text uses
 *     `--ink-label` (`text-ink-label`, `INK_LABEL`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const ROOTS = [
  "components/student/widgets",
  "components/student/figures",
  "components/viz",
];
const FILES = [
  "components/chat/ChatQuestionCard.tsx",
];

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(p);
    return p.endsWith(".tsx") ? [p] : [];
  });
}

const files = [
  ...ROOTS.flatMap((r) => tsxFiles(path.join(SRC, r))),
  ...FILES.map((f) => path.join(SRC, f)),
].map((p) => ({ rel: path.relative(SRC, p), text: readFileSync(p, "utf8") }));

/** Every match of `re` in every file, as "file:line  text". */
function offences(re: RegExp, only?: (f: { rel: string; text: string }) => boolean): string[] {
  return files.filter((f) => !only || only(f)).flatMap(({ rel, text }) =>
    text.split("\n").flatMap((line, i) => (re.test(line) ? [`${rel}:${i + 1}  ${line.trim()}`] : []))
  );
}

/** 0.72rem at a 16px root, the data step. */
const DATA_PX = 0.72 * 16;

test("the scan sees the folders it guards", () => {
  assert.ok(files.length > 40, `only ${files.length} files scanned`);
  assert.ok(files.some((f) => f.rel.endsWith("figure-svg.tsx")));
});

test("no fontSize on an element — a figure's text takes a fig-* class", () => {
  assert.deepEqual(offences(/\bfontSize\s*=/), []);
});

test("a file that draws <text> draws it in a <FigureSvg>", () => {
  assert.deepEqual(
    offences(/<svg[\s>]/, (f) => /<text[\s>]/.test(f.text)),
    []
  );
});

test("no arbitrary text size below the data step", () => {
  const small = files.flatMap(({ rel, text }) =>
    [...text.matchAll(/\btext-\[(\d+(?:\.\d+)?)(px|rem)\]/g)]
      .filter((m) => (m[2] === "rem" ? Number(m[1]) * 16 : Number(m[1])) < DATA_PX - 0.01)
      .map((m) => `${rel}  ${m[0]}`)
  );
  assert.deepEqual(small, []);
});

test("no faint ink on text", () => {
  assert.deepEqual(offences(/text-ink-faint|fill=["{]\s*(?:"?var\(--ink-faint\)"?|INK_FAINT)/), []);
  assert.deepEqual(offences(/:\s*"var\(--ink-faint\)"/), [], "a faint fill picked in an expression");
});
