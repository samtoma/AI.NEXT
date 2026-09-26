/**
 * THE PRACTICE LOOP'S MATHS INPUT AND RE-ENTRY (T416/T417, FR-4320).
 *
 * `StudentLoop.tsx` (`?mode=practice`) used to have no maths input at all for
 * a question carrying `choices.marker`, and a 422 re-entry surfaced as a raw
 * "API 422" thrown error — the marker's own message never reached the
 * student, and nothing was typed on the field to fix.
 *
 * A `.tsx` cannot be imported by the type-stripping test runner (same
 * constraint `math-answer-input.test.mts` documents), so this reads the
 * component as SOURCE, the way that file reads `MathAnswerInput.tsx` and
 * `teaching-snapshot.test.mts` reads its own subject. What the input actually
 * shows is proven once, on the shared component, by
 * `math-answer-input.test.mts` and `src/lib/answer-marker.test.mts` — this
 * file only proves StudentLoop WIRES it in, through the shared
 * `lib/attempts-client.ts` seam `ChatQuestionCard.tsx` already uses, so a
 * re-entry can never again be a plain thrown error here.
 *
 * @covers FR-4320
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(HERE, "StudentLoop.tsx"), "utf8");
/** Strip comments so a rule is tested against code, not prose. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test("a marked question is answered in the maths input, not the plain numeric one", () => {
  assert.match(code, /import\s*\{\s*MathAnswerInput\s*\}\s*from\s*"@\/components\/chat\/MathAnswerInput"/);
  assert.match(code, /import\s*\{\s*markerInputOf\s*\}\s*from\s*"@\/lib\/answer-marker"/);
  assert.match(code, /const markerInput = useMemo\(/);
  assert.match(code, /markerInputOf\(\{\s*questionType:\s*item\.questionType,\s*choices:\s*item\.choices\s*\}\)/);
  // the ternary offers the marker input as an alternative to the plain field
  assert.match(code, /:\s*markerInput\s*\?\s*\(\s*<MathAnswerInput/);
  assert.match(code, /<MathAnswerInput[\s\S]{0,200}input=\{markerInput\}/);
  assert.match(code, /<MathAnswerInput[\s\S]{0,400}reentry=\{reentry\}/);
});

test("submitting goes through the shared attempts-client seam, not a raw fetch", () => {
  assert.match(code, /import\s*\{\s*AttemptRetryError,\s*submitAttempt\s*\}\s*from\s*"@\/lib\/attempts-client"/);
  assert.match(code, /const result = await submitAttempt\(/);
  assert.ok(!/fetch\("\/api\/attempts"/.test(code), 'no raw fetch("/api/attempts") left in the practice loop');
});

test("a re-entry is caught by kind, keeps the student's typed text, and is never counted as an attempt", () => {
  assert.match(code, /if \(e instanceof AttemptRetryError\) setReentry\(e\.retry\.message\)/);
  // the retry branch must not clear `numeric` or push to `records`
  const catchBlock = code.match(/\} catch \(e\) \{[\s\S]*?\} finally \{/)?.[0] ?? "";
  assert.ok(catchBlock.length > 0, "submit()'s catch block is present");
  assert.ok(!/setNumeric\(/.test(catchBlock), "a re-entry must not clear what the student typed");
  assert.ok(!/setRecords\(/.test(catchBlock), "a re-entry must not be recorded as an attempt");
});

test("the re-entry message is cleared with every other per-question field when the student moves on", () => {
  const advanceBody = code.match(/const advance = \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
  assert.ok(advanceBody.includes("setReentry(null)"), "advance() resets the marker's message for the next question");
});
