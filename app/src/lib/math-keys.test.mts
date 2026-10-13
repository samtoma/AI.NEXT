/**
 * The maths symbol picker's keys (prototype, `feat/proto-math-symbol-keys`): the reader, the default
 * view and recents rules from the design handoff, and coverage of every stored Prep 3 maths question.
 *
 *   node --import ./scripts/ts-resolver.mjs --test src/lib/math-keys.test.mts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MATHS_SEED_FILES } from "./spine-maths-fixture.mts";
import {
  FALLBACK_KEYS,
  LATEX_NO_KEY,
  LATEX_TO_KEY,
  MATH_KEYS,
  MATH_KEY_GROUPS,
  PICKER_SIZE,
  UNICODE_TO_KEY,
  keyIdsIn,
  latexCommandsIn,
  lessonKeyIds,
  pickerKeyIds,
  pushRecent,
} from "./math-keys.ts";
import { hasExpectsMath, parseMessage } from "./chat-parse.ts";

const ids = (text: string) => keyIdsIn(text);
const key = (id: string) => MATH_KEYS.find((k) => k.id === id)!;

test("set notation in a stem asks for the set keys, in order of appearance", () => {
  assert.deepEqual(ids("If $X = \\{1, 2\\}$, find $X \\cap Y$ and $X \\cup Y$."), ["brace", "inter", "union"]);
});

test("number sets are read from \\mathbb's argument", () => {
  assert.deepEqual(ids("$x \\in \\mathbb{R}$, $y \\in \\mathbb{Z}$"), ["in", "R", "Z"]);
});

test("negations: \\not\\in, \\notin and \\not= are their own keys", () => {
  assert.deepEqual(ids("$a \\not\\in A$"), ["notin"]);
  assert.deepEqual(ids("$a \\notin A$, $b \\not= c$"), ["notin", "neq"]);
});

test("geometry from a real Prep 3 stem: ray, segment, angle, degrees", () => {
  const stem =
    "ABCD is a cyclic quadrilateral, $E \\in \\overrightarrow{AB}$, $E \\notin \\overline{AB}$, and $m(\\angle D) = 76°$.";
  assert.deepEqual(ids(stem), ["in", "ray", "notin", "segment", "angle", "deg"]);
});

test("^{\\circ} is a degree sign; ^2 is squared; any other ^ is a power", () => {
  assert.deepEqual(ids("$m(\\angle A) = 40^{\\circ}$"), ["angle", "deg"]);
  assert.deepEqual(ids("$x^2 + y^{2}$"), ["sq"]);
  assert.deepEqual(ids("$2^n + 40^\\circ$"), ["pow", "deg"]);
});

test("Unicode signs typed outside $…$ count too (the tutor writes ∩ plainly)", () => {
  assert.deepEqual(ids("So what is X ∩ Y? And is 3 ∈ X?"), ["inter", "in"]);
});

test("directives and citations are not maths: their JSON and ids ask for nothing", () => {
  assert.deepEqual(ids('Try this {{widget:product_builder:{"X":[1,2],"Y":[4,5]}}} [[page:12]]'), []);
});

test("lessonKeyIds: most relevant text first", () => {
  assert.deepEqual(lessonKeyIds(["What is $X \\cap Y$?", "$\\sqrt{2}$ and $\\angle A$"]), ["inter", "sqrt", "angle"]);
  assert.deepEqual(lessonKeyIds(["no maths here", null]), []);
});

test("the default view: exactly twelve, topped up from the fallback list; none found is the fallback", () => {
  assert.deepEqual(pickerKeyIds([], []), [...FALLBACK_KEYS]);
  assert.deepEqual(pickerKeyIds([], ["inter", "union"]).slice(0, 4), ["inter", "union", "sqrt", "sq"]);
  assert.equal(pickerKeyIds([], ["inter", "union"]).length, PICKER_SIZE);
  assert.equal(pickerKeyIds([], MATH_KEYS.map((k) => k.id)).length, PICKER_SIZE);
});

test("acceptance 6: after × then ∈, the default view starts ∈ × then the lesson's keys, no duplicates", () => {
  const recents = pushRecent(pushRecent([], "times"), "in");
  assert.deepEqual(recents, ["in", "times"]);
  const lesson = ["in", "notin", "subseteq", "times", "brace", "inter", "union", "empty", "paren", "eq", "neq", "plus"];
  assert.deepEqual(pickerKeyIds(recents, lesson), [
    "in", "times", "notin", "subseteq", "brace", "inter", "union", "empty", "paren", "eq", "neq", "plus",
  ]);
  assert.deepEqual(pushRecent(["in", "times"], "union"), ["union", "in"], "at most two");
  assert.deepEqual(pushRecent(["in", "times"], "times"), ["times", "in"], "de-duplicated");
});

test("acceptance 4: ( ), { }, √, a/b and | | leave the caret inside the brackets", () => {
  for (const id of ["paren", "brace", "sqrt", "frac", "abs", "Pf", "nf"]) {
    const { ins, back } = key(id);
    const caret = ins.length - back;
    assert.ok(caret > 0 && caret < ins.length, id);
    assert.match(ins.slice(0, caret), /[({|]$/, id);
  }
});

test("the minus key is U+2212, and every key has a spoken name", () => {
  assert.equal(key("minus").ins, "−");
  for (const k of MATH_KEYS) assert.match(k.name, /[a-z]/i, k.id);
});

test("every table and group points at a real key, every key is in a group, ids are unique", () => {
  const known = new Set(MATH_KEYS.map((k) => k.id));
  assert.equal(known.size, MATH_KEYS.length);
  for (const [cmd, id] of Object.entries(LATEX_TO_KEY)) assert.ok(known.has(id), `\\${cmd} → ${id}`);
  for (const [ch, id] of Object.entries(UNICODE_TO_KEY)) assert.ok(known.has(id), `${ch} → ${id}`);
  for (const g of MATH_KEY_GROUPS) for (const id of g.keys) assert.ok(known.has(id), `${g.id}: ${id}`);
  const grouped = new Set(MATH_KEY_GROUPS.flatMap((g) => g.keys));
  for (const id of known) assert.ok(grouped.has(id), `${id} is in no group`);
  assert.deepEqual(MATH_KEY_GROUPS.slice(0, 4).map((g) => g.label.toUpperCase()), ["SETS", "NUMBER SETS", "COMPARE", "ALGEBRA"]);
  for (const k of MATH_KEYS) assert.ok(k.back >= 0 && k.back <= k.ins.length, k.id);
});

test("{{expects_math}} is a silent signal: detected, and never rendered", () => {
  const text = "What is $X \\cap Y$? Write it as a set.\n{{expects_math}}";
  assert.equal(hasExpectsMath(text), true);
  assert.equal(hasExpectsMath("How is it going?"), false);
  assert.ok(!JSON.stringify(parseMessage(text, false)).includes("expects_math"));
});

/* ---------------- coverage: every stored Prep 3 maths question ---------------- */

type SeedQuestion = { id: string; stem?: string; answer?: unknown; correct_answer?: unknown; solution?: unknown; choices?: unknown };

function seedQuestions(): SeedQuestion[] {
  const files = [...MATHS_SEED_FILES.map((f) => `${f}.json`), "generated/generated-questions.json", "generated/widget-questions.json"];
  const out: SeedQuestion[] = [];
  for (const f of files) {
    const doc = JSON.parse(
      readFileSync(fileURLToPath(new URL(`../../../services/extraction/seed/${f}`, import.meta.url)), "utf8")
    ) as { questions?: SeedQuestion[] };
    out.push(...(doc.questions ?? []));
  }
  return out;
}

/** Everything a student reads about a question: stem, choices, answer, solution. */
const textOf = (q: SeedQuestion) =>
  [q.stem, q.answer, q.correct_answer, q.solution, q.choices].map((v) => (typeof v === "string" ? v : JSON.stringify(v ?? ""))).join(" ");

test("coverage: every LaTeX command in the Prep 3 maths bank has a key or is known to need none", () => {
  const qs = seedQuestions();
  assert.ok(qs.length > 900, `expected the whole bank, read ${qs.length}`);
  const unknown = new Map<string, string>();
  for (const q of qs) {
    // JSON.stringify doubles each backslash; undo it so `\\cap` reads as `\cap`
    for (const cmd of latexCommandsIn(textOf(q).replace(/\\\\/g, "\\"))) {
      if (!(cmd in LATEX_TO_KEY) && !LATEX_NO_KEY.has(cmd) && !/^[^a-zA-Z]$/.test(cmd) && !unknown.has(cmd)) unknown.set(cmd, q.id);
    }
  }
  assert.deepEqual(
    [...unknown].map(([cmd, id]) => `\\${cmd} (first in ${id})`),
    [],
    "add each to LATEX_TO_KEY (a student may need to type it) or LATEX_NO_KEY (display only)"
  );
});

test("coverage: a set question's default view offers ∩ or ∪, an angle question's offers ∠", () => {
  const qs = seedQuestions();
  const sets = qs.filter((q) => /\\cap|\\cup/.test(q.stem ?? ""));
  const angles = qs.filter((q) => /\\angle/.test(q.stem ?? ""));
  assert.ok(sets.length > 0 && angles.length > 0);
  for (const q of sets) assert.ok(pickerKeyIds([], lessonKeyIds([q.stem])).some((id) => id === "inter" || id === "union"), q.id);
  for (const q of angles) assert.ok(pickerKeyIds([], lessonKeyIds([q.stem])).includes("angle"), q.id);
});
