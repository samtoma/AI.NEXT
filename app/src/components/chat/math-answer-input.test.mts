/**
 * The typed-maths answer input (T417, FR-4320), read as source: a `.tsx` cannot be imported by the
 * type-stripping test runner, so these assertions read the component the way `teaching-snapshot.test.mts`
 * reads the card. What the input SHOWS (the preview's LaTeX, the re-entry copy) is tested on the pure
 * functions it calls, in `src/lib/answer-marker.test.mts`.
 *
 *   node --import ./scripts/ts-resolver.mjs --test src/components/chat/math-answer-input.test.mts
 *
 * @covers FR-4320
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const input = readFileSync(path.join(HERE, "MathAnswerInput.tsx"), "utf8");
const card = readFileSync(path.join(HERE, "ChatQuestionCard.tsx"), "utf8");
/** The source without its comments, so a rule is tested against code, not prose. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test("maths reads left to right in any direction (Principle V): the field and the preview are LTR", () => {
  const c = code(input);
  assert.match(c, /<input[\s\S]*?dir="ltr"/);
  assert.match(c, /id=\{`\$\{id\}-preview`\}[\s\S]*?<span dir="ltr"/);
  assert.match(c, /role="group" aria-label="Maths symbols"[^>]*dir="ltr"/);
});

test("the iPad keyboard works: letters available, no autocorrect or capitals, Return submits", () => {
  const c = code(input);
  assert.match(c, /inputMode="text"/);
  assert.ok(!/inputMode="(decimal|numeric)"/.test(c), "a numeric keyboard hides the variables");
  for (const attr of ['autoCorrect="off"', 'autoCapitalize="off"', "spellCheck={false}", 'autoComplete="off"']) assert.ok(c.includes(attr), attr);
  assert.match(c, /e\.key === "Enter"[\s\S]{0,80}onSubmit\(\)/);
});

test("the symbol bar: ^, √, a fraction, ±, π and brackets, each a labelled 52px key that keeps the keyboard up", () => {
  const c = code(input);
  for (const insert of ['insert: "^"', 'insert: "√()"', 'insert: "()/()"', 'insert: "±"', 'insert: "π"', 'insert: "("', 'insert: ")"']) {
    assert.ok(c.includes(insert), insert);
  }
  // every key names itself for a screen reader, and its glyph is hidden from it
  assert.ok((c.match(/\{ label: "[^"]+", name: "Insert [^"]+"/g) ?? []).length >= 7);
  assert.match(c, /aria-label=\{k\.name\}/);
  assert.match(c, /<span aria-hidden="true">\{k\.label\}<\/span>/);
  assert.match(c, /type="button"/);
  // a tap on a key must not take focus from the field, or the iPad keyboard drops
  assert.match(c, /onPointerDown=\{\(e\) => e\.preventDefault\(\)\}/);
  assert.match(c, /min-h-\[var\(--noor-touch-min\)\] min-w-\[var\(--noor-touch-min\)\]/);
});

test("accessible: a real label, the preview and the message described on the field, re-entry announced", () => {
  const c = code(input);
  assert.match(c, /<label htmlFor=\{`\$\{id\}-field`\}/);
  assert.match(c, /id=\{`\$\{id\}-field`\}/);
  assert.match(c, /aria-describedby=\{cx\(`\$\{id\}-preview`/);
  assert.match(c, /aria-live="polite"/);
  assert.match(c, /role=\{reentry \? "alert" : undefined\}/);
  assert.match(c, /aria-invalid=\{reentry \? true : undefined\}/);
});

test("the preview is the marker's own reading, typeset by the app's KaTeX, and the input never marks", () => {
  const c = code(input);
  assert.match(c, /import \{ TeX \} from "@\/components\/TeX";/);
  assert.match(c, /previewLatex\(value, input\)/);
  assert.match(c, /<TeX text=\{`\$\$\{preview\.latex\}\$`\} \/>/);
  assert.ok(!/\bmark\(|validateKey|numericEngine/.test(c), "marking is the server's (FR-4320)");
  assert.ok(!/\.key\b/.test(c.replace(/e\.key/g, "").replace(/key=\{k\.label\}/g, "")), "the input never reads an answer key");
});

test("Noor Play tokens only (Principle XII): no literal colour, stroke, radius or shadow, and no red", () => {
  const c = code(input);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(c), "a literal colour");
  assert.ok(!/border-\[\d|rounded-\[\d|shadow-\[|rounded-(sm|md|lg|xl|full)\b/.test(c), "a literal stroke, radius or shadow");
  assert.ok(!/\bred\b|text-red|bg-red/.test(c), "there is no red verdict in Play");
  assert.match(c, /VERDICT_INK\.partial/); // re-entry wears the Honey "close" state
});

test("the card shows the maths input for marker questions only, and a re-entry never becomes a result", () => {
  const c = code(card);
  assert.match(c, /markerInputOf\(\{ questionType: q\.questionType, choices: q\.choices \}\)/);
  assert.match(c, /\) : markerInput \? \(\s*<MathAnswerInput/);
  // every other typed question keeps today's numeric field
  assert.match(c, /inputMode="decimal"/);
  // the re-entry lands as the input's message; nothing is set as a result
  assert.match(c, /if \(e instanceof AttemptRetryError\) setReentry\(e\.retry\.message\);/);
  const onRetry = c.slice(c.indexOf("if (e instanceof AttemptRetryError)"));
  assert.ok(!/setResult/.test(onRetry.slice(0, onRetry.indexOf("finally"))));
});
