/**
 * The maths-expression marker (contracts/answer-marker.md; built in-house, ADR-0025).
 *
 *   node --import ./scripts/ts-resolver.mjs --test src/lib/answer-marker.test.mts
 *
 * @covers FR-4320, FR-4303
 *
 * Three layers:
 *  1. The Grade 10 fixture (`scripts/marker-eval/g10-marker-testset.json`), run in full as a regression
 *     suite (8,620 cases, under a second): every printed answer in the marker's scope, typed as printed
 *     (the key's LaTeX, an ASCII typing, a Unicode typing), with SymPy-labelled equivalent rewrites,
 *     near-misses, wrong-form rewrites and truncated input. SC-212's numbers are asserted on it.
 *  2. Hand-written cases for each rule of the contract and each of Samuel's T413 marking rules.
 *  3. The parts the product uses around `mark`: reading a question's spec, the re-entry copy, and the
 *     live preview the input control renders.
 *
 * Numbers and choices are NOT marked here: a question without `choices.marker` keeps today's `grade()`
 * byte for byte. That half of SC-212 is `attempt-grading.test.mts` and
 * `scripts/marker-eval/replay-attempts.mts` against the recorded attempts.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import katex from "katex";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  mark,
  validateKey,
  MarkerKeyError,
  numericEngine,
  samplePoints,
  readMarkerSpec,
  markerInputOf,
  reentryMessage,
  previewLatex,
  stripUnits,
  type MarkerSpec,
} from "./answer-marker.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

type Case = { input: string; expect: string; why: string; form?: string };
type Item = { id: string; spec?: MarkerSpec; cases?: Case[]; out_of_scope?: string };
const fixture = JSON.parse(readFileSync(path.join(HERE, "../../scripts/marker-eval/g10-marker-testset.json"), "utf8")) as {
  items: Item[];
};

const r = (answer: string, spec: MarkerSpec) => mark(answer, spec).result;
const expr = (key: string, form: MarkerSpec["form"] = null, variables: string[] = []): MarkerSpec => ({
  kind: "expression", key, form, variables, tolerance: null,
});

// ------------------------------------------------------------------ 1. the Grade 10 fixture

test("SC-212: every Grade 10 printed answer in scope, typed as printed, is marked correct", () => {
  const misses: string[] = [];
  let n = 0;
  for (const it of fixture.items) {
    if (!it.spec) continue;
    for (const c of it.cases!) {
      if (!c.why.startsWith("typed_as_printed")) continue;
      n++;
      if (r(c.input, it.spec) !== "correct") misses.push(`${it.id} ${JSON.stringify(c.input)}`);
    }
  }
  assert.ok(n > 2500, `fixture too small: ${n}`);
  assert.deepEqual(misses, []);
});

test("SC-212: every equivalent form in the test set is marked correct", () => {
  const misses: string[] = [];
  for (const it of fixture.items) {
    if (!it.spec) continue;
    for (const c of it.cases!) if (c.expect === "correct" && r(c.input, it.spec) !== "correct") misses.push(`${it.id} ${c.why} ${JSON.stringify(c.input)}`);
  }
  assert.deepEqual(misses, []);
});

test("SC-212: zero answers in a form the question does not accept are marked correct", () => {
  const leaks: string[] = [];
  let n = 0;
  for (const it of fixture.items) {
    if (!it.spec) continue;
    for (const c of it.cases!) {
      if (c.expect !== "wrong_form") continue;
      n++;
      const got = r(c.input, it.spec);
      if (got !== "wrong_form") leaks.push(`${it.id} ${c.why} ${JSON.stringify(c.input)} -> ${got}`);
    }
  }
  assert.ok(n > 600, `too few wrong-form cases: ${n}`);
  assert.deepEqual(leaks, []);
});

test("near-misses are marked incorrect and truncated input is returned for re-entry", () => {
  const bad: string[] = [];
  for (const it of fixture.items) {
    if (!it.spec) continue;
    for (const c of it.cases!) {
      if (c.expect !== "incorrect" && c.expect !== "unreadable") continue;
      const got = r(c.input, it.spec);
      if (got !== c.expect) bad.push(`${it.id} ${c.why} ${JSON.stringify(c.input)} -> ${got}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("every in-scope key is readable and marks itself correct (the loader's check)", () => {
  const bad = fixture.items.filter((it) => it.spec && validateKey(it.spec) !== null).map((it) => it.id);
  assert.deepEqual(bad, []);
});

// ------------------------------------------------------------------ 2. the contract, rule by rule

test("form: 'factorise x^2 - 9' refuses x^2 - 9 (equivalent, wrong form) and names the form", () => {
  const spec = expr("(x-3)(x+3)", "factorised", ["x"]);
  assert.deepEqual(mark("x^2-9", spec), { result: "wrong_form", form: "factorised" });
  assert.equal(r("(x+3)(x-3)", spec), "correct");
  assert.equal(r("(3+x)(x-3)", spec), "correct");
  assert.equal(r("-(3-x)(x+3)", spec), "correct");
  assert.equal(r("(x-3)(x-3)", spec), "incorrect");
});

test("form: fully factorised — a common factor left inside a bracket is the wrong form", () => {
  const spec = expr("2(x+1)(x-1)", "factorised", ["x"]);
  assert.equal(r("2(x-1)(x+1)", spec), "correct");
  assert.equal(r("(2x+2)(x-1)", spec), "wrong_form");
  assert.equal(r("2(x^2-1)", spec), "wrong_form"); // not fully factorised
  assert.equal(r("2x^2-2", spec), "wrong_form");
});

test("form: expanded — a product, or like terms not collected, is the wrong form", () => {
  const spec = expr("x^{2}+7x+10", "expanded", ["x"]);
  assert.equal(r("10+7x+x^2", spec), "correct");
  assert.equal(r("(x+2)(x+5)", spec), "wrong_form");
  assert.equal(r("x^2+2x+5x+10", spec), "wrong_form");
});

test("form: simplest — a common factor not cancelled, or like factors not combined, is the wrong form", () => {
  const frac = expr("\\frac{x+3}{x+2}", "simplest", ["x"]);
  assert.equal(r("(x+3)/(x+2)", frac), "correct");
  assert.equal(r("(x^2+4x+3)/(x^2+3x+2)", frac), "wrong_form");
  const mono = expr("9a^{5}b^{27}", "simplest", ["a", "b"]);
  assert.equal(r("9b^27a^5", mono), "correct");
  assert.equal(r("9a^2a^3b^27", mono), "wrong_form");
  assert.equal(r("3^2a^5b^27", mono), "wrong_form"); // a numeric power left unevaluated
});

test("form: simplest is measured against the printed key (the book's own answer is always accepted)", () => {
  // 1-10/3i: the book prints 2(k+2)/((k^2+2)(k+2)), not in lowest terms
  const spec = expr("\\frac{2(k+2)}{(k^{2}+2)(k+2)}", "simplest", ["k"]);
  assert.equal(r("2(k+2)/((k^2+2)(k+2))", spec), "correct");
  assert.equal(r("2/(k^2+2)", spec), "correct"); // simpler than the key: accepted
});

test("form: make b the subject — a rearranged but unsolved equation is the wrong form", () => {
  const spec: MarkerSpec = { kind: "equation", key: "b=\\pm \\sqrt{c^{2}-a^{2}}", form: { subject: "b" }, variables: ["a", "b", "c"] };
  assert.equal(r("b = ±√(c²−a²)", spec), "correct");
  assert.equal(r("b = +-sqrt(c^2 - a^2)", spec), "correct");
  assert.equal(r("√(c^2-a^2) = b", spec).valueOf(), "incorrect"); // one branch only: a different solution set
  assert.equal(r("±√(c^2-a^2) = b", spec), "correct");
  assert.deepEqual(mark("b^2 = c^2 - a^2", spec), { result: "wrong_form", form: "subject:b" });
  assert.equal(r("b = sqrt(c^2 - a^2)", spec), "incorrect"); // the negative root dropped
});

test("equation: an equivalent equation is correct when no form is asked", () => {
  const spec: MarkerSpec = { kind: "equation", key: "y=3x+12", form: null, variables: ["x", "y"] };
  for (const a of ["y = 3x + 12", "3x + 12 = y", "y - 3x = 12", "3x - y + 12 = 0", "2y = 6x + 24"]) assert.equal(r(a, spec), "correct", a);
  for (const a of ["y = 3x - 12", "y = 12x + 3", "y = 3x"]) assert.equal(r(a, spec), "incorrect", a);
});

test("decision 15: a decimal comma reads as a point; (x; y) reads as (x, y)", () => {
  const pt: MarkerSpec = { kind: "coordinates", key: "M(-0,5;-1,25)", form: null, variables: [] };
  for (const a of ["(-0,5; -1,25)", "(-0.5, -1.25)", "M(-0,5;-1,25)", "(−1/2; −5/4)", "-0.5, -1.25"]) assert.equal(r(a, pt), "correct", a);
  assert.equal(r("(-1,25; -0,5)", pt), "incorrect");
  const vals: MarkerSpec = { kind: "values", key: "x=\\frac{3}{5} \\text{ or } x=3", form: null, variables: ["x"] };
  for (const a of ["x = 0,6 or x = 3", "x=3; x=0.6", "3, 3/5", "x = 3 or x = 3/5"]) assert.equal(r(a, vals), "correct", a);
  assert.equal(r("x = 0,6", vals), "incorrect"); // one value missing
  assert.equal(r("x = 0,6 or x = -3", vals), "incorrect");
});

test("values: several values in any order, ± expanded", () => {
  const spec: MarkerSpec = { kind: "values", key: "b=\\pm 2 \\text{ or } b=\\pm 3", form: null, variables: ["b"] };
  assert.equal(r("b = 3, b = -3, b = 2, b = -2", spec), "correct");
  assert.equal(r("±3; ±2", spec), "correct");
  assert.equal(r("b = 2 or b = 3", spec), "incorrect");
  const sys: MarkerSpec = { kind: "values", key: "x=13 \\text{ and } y=-1", form: null, variables: ["x", "y"] };
  assert.equal(r("y = -1 and x = 13", sys), "correct");
  assert.equal(r("x = -1 and y = 13", sys), "incorrect");
});

test("interval: the same set in inequality, interval or set notation, with endpoint inclusion checked", () => {
  const spec: MarkerSpec = { kind: "interval", key: "-3\\le k<2", form: null, variables: ["k"] };
  for (const a of ["-3 <= k < 2", "[-3; 2)", "k ∈ [-3, 2)", "{k : k ∈ R, -3 ≤ k < 2}", "2 > k >= -3"]) assert.equal(r(a, spec), "correct", a);
  for (const a of ["-3 < k < 2", "[-3; 2]", "-2 <= k < 3", "k >= -3"]) assert.equal(r(a, spec), "incorrect", a);
  const union: MarkerSpec = { kind: "interval", key: "(-\\infty ;\\frac{1}{3})\\cup (\\frac{17}{3};\\infty )", form: null, variables: [] };
  assert.equal(r("x < 1/3 or x > 17/3", union), "correct");
  assert.equal(r("(17/3; ∞) ∪ (−∞; 1/3)", union), "correct");
  assert.equal(r("x <= 1/3 or x > 17/3", union), "incorrect");
});

test("surd: exact equality (2√3 = √12); a decimal approximation is refused as not exact", () => {
  const spec: MarkerSpec = { kind: "surd", key: "\\frac{\\sqrt{3}}{2}", form: null, variables: [], tolerance: null };
  for (const a of ["√3/2", "sqrt(3)/2", "(1/2)√3", "sqrt(3/4)", "3/(2√3)", "\\frac{\\sqrt{3}}{2}"]) assert.equal(r(a, spec), "correct", a);
  assert.deepEqual(mark("0.866", spec), { result: "wrong_form", form: "exact" });
  assert.deepEqual(mark("0,8660254037844", spec), { result: "wrong_form", form: "exact" });
  assert.equal(r("√3/3", spec), "incorrect");
  assert.equal(r("2√3", { ...spec, key: "\\sqrt{12}" }), "correct");
});

test("recurring: equal rational values, in any recurring notation", () => {
  const spec: MarkerSpec = { kind: "recurring", key: "0,\\dot{2}\\dot{1}", form: null, variables: [] };
  for (const a of ["0.(21)", "0,2̇1̇", "0.212121...", "0.\\dot{2}\\dot{1}", "7/33"]) assert.equal(r(a, spec), "correct", a);
  for (const a of ["0.21", "0.(12)", "0.2(1)"]) assert.equal(r(a, spec), "incorrect", a);
});

test("typing: implicit multiplication, ^, √, ², π, ×, − and mixed numbers all read as maths", () => {
  const spec = expr("4\\pi r^{2}", null, ["r"]);
  for (const a of ["4πr²", "4*pi*r^2", "4 pi r^2", "4·π·r^2", "4\\pi r^{2}", "r^2 × 4π"]) assert.equal(r(a, spec), "correct", a);
  assert.equal(r("8 4/5", expr("\\frac{44}{5}")), "correct"); // a mixed number
  assert.equal(r("-8 4/5", expr("-\\frac{44}{5}")), "correct");
  assert.equal(r("4xy", expr("4yx", null, ["x", "y"])), "correct"); // letters are separate variables
});

test("typing: '1/2x' is ambiguous and is returned for re-entry, never guessed (Samuel, T413)", () => {
  const spec = expr("\\frac{1}{2x}", null, ["x"]);
  assert.equal(r("1/2x", spec), "unreadable");
  assert.equal(r("1/(2x)", spec), "correct");
  assert.equal(r("(1/2)x", spec), "incorrect");
});

test("unreadable input is returned for re-entry, never marked wrong", () => {
  const spec = expr("(x-3)(x+3)", "factorised", ["x"]);
  for (const a of ["", "   ", "(x-3)(x+3", "x^^2", "x +", "3x+*2", "hello world!", "x = = 2", "√", "(()", "½x", "x$2", "a".repeat(600)]) {
    assert.equal(r(a, spec), "unreadable", JSON.stringify(a));
  }
});

test("an answer of the wrong shape is returned for re-entry with the shape asked (Samuel, T413)", () => {
  assert.deepEqual(mark("3", { kind: "interval", key: "x>3", form: null, variables: ["x"] }), {
    result: "unreadable",
    reason: "not an inequality or an interval",
  });
  assert.deepEqual(mark("3x+12", { kind: "equation", key: "y=3x+12", form: null, variables: ["x", "y"] }), {
    result: "unreadable",
    reason: "not an equation",
  });
});

test("hostile input is data, never code: no eval, no Function, no prototype access", () => {
  const spec = expr("x+1", null, ["x"]);
  for (const a of ["process.exit(1)", "constructor", "__proto__", "require('fs')", "x+1;DROP TABLE attempts", "${x}", "`x`", "x+1//"]) {
    const got = r(a, spec);
    assert.ok(got === "unreadable" || got === "incorrect", `${a} -> ${got}`);
  }
  const src = readFileSync(path.join(HERE, "answer-marker.ts"), "utf8");
  assert.ok(!/\beval\s*\(|new\s+Function\s*\(|\bFunction\s*\(/.test(src), "the marker must not evaluate code");
});

test("deterministic: the same input always gives the same result, and the sample points never change", () => {
  const spec = expr("\\frac{4a^{2}(a-5)}{6(a+5)^{2}}", "simplest", ["a"]);
  const first = [r("(2a^3-10a^2)/(3(a+5)^2)", spec), r("4a^2(a-5)/(6(a+5)^2)", spec), r("2a^2(a-5)/(3a^2+30a+75)", spec)];
  for (let k = 0; k < 5; k++) assert.deepEqual([r("(2a^3-10a^2)/(3(a+5)^2)", spec), r("4a^2(a-5)/(6(a+5)^2)", spec), r("2a^2(a-5)/(3a^2+30a+75)", spec)], first);
  assert.deepEqual(first, ["correct", "correct", "correct"]);
  assert.deepEqual(samplePoints(["a", "b"], 3), samplePoints(["a", "b"], 3));
  assert.equal(numericEngine.name.startsWith("built-in"), true);
});

test("a key the marker cannot read is a content defect: it throws, it never asks the student to re-enter", () => {
  assert.throws(() => mark("x", expr("\\frac{1}{")), MarkerKeyError);
  assert.throws(() => mark("x", expr("\\unknowncommand{x}")), MarkerKeyError);
});

test("the out-of-scope list says why each item is not marked by the marker", () => {
  const out = fixture.items.filter((it) => it.out_of_scope);
  assert.ok(out.length > 0);
  for (const it of out) assert.ok(typeof it.out_of_scope === "string" && it.out_of_scope.length > 10, it.id);
});

// ------------------------------------------------------------------ 3. Samuel's T413 marking rules

test("T413: a decimal for an exact value is the wrong form 'exact', never 'incorrect', in every kind", () => {
  const e = (key: string, kind: MarkerSpec["kind"] = "expression", variables: string[] = []): MarkerSpec => ({
    kind, key, form: null, variables, tolerance: null,
  });
  // expression and surd: irrationals, and fractions no terminating decimal can write
  assert.deepEqual(mark("1.41", e("\\sqrt{2}")), { result: "wrong_form", form: "exact" });
  assert.deepEqual(mark("0.33", e("\\frac{1}{3}")), { result: "wrong_form", form: "exact" });
  assert.deepEqual(mark("12.57", e("4\\pi")), { result: "wrong_form", form: "exact" });
  assert.deepEqual(mark("0.9", e("\\frac{\\sqrt{3}}{2}", "surd")), { result: "wrong_form", form: "exact" }); // a correct rounding
  // values, coordinates, intervals
  assert.deepEqual(mark("x = 1.41 or x = -1.41", e("x=\\pm\\sqrt{2}", "values", ["x"])), { result: "wrong_form", form: "exact" });
  assert.deepEqual(mark("(1.41; 2)", e("(\\sqrt{2};2)", "coordinates")), { result: "wrong_form", form: "exact" });
  assert.deepEqual(mark("x > 1.41", e("x>\\sqrt{2}", "interval", ["x"])), { result: "wrong_form", form: "exact" });
  // not approximations: exact decimals, recurring decimals, and a decimal part of a mixed key
  assert.equal(r("0.(3)", e("\\frac{1}{3}")), "correct");
  assert.equal(r("8.8", e("\\frac{44}{5}")), "correct");
  assert.equal(r("1.5", e("\\sqrt{\\frac{9}{4}}", "surd")), "correct");
  assert.equal(r("-√8; -1.5; 0.45; 0.45; 27/7; √19; 6; 2π; √51", e("-\\sqrt{8};-\\sqrt{\\frac{9}{4}};0,45;0,45; \\frac{27}{7};\\sqrt{19};6;2\\pi ;\\sqrt{51}", "values")), "correct");
  // a wrong decimal is still wrong: 0.8 is not a rounding of 0.866…, and 8.79 is not 8.8
  assert.equal(r("0.8", e("\\frac{\\sqrt{3}}{2}", "surd")), "incorrect");
  assert.equal(r("8.79", e("\\frac{44}{5}")), "incorrect");
  // a question that allows a tolerance is not exact
  assert.equal(r("1.414", { ...e("\\sqrt{2}"), tolerance: { abs: 0.01 } }), "correct");
});

test("T413: a fraction for a recurring decimal is correct, unless the question asks for a decimal", () => {
  const rec: MarkerSpec = { kind: "recurring", key: "0,\\dot{2}\\dot{1}", form: null, variables: [] };
  assert.equal(r("7/33", rec), "correct");
  const dec: MarkerSpec = { ...rec, form: "decimal" };
  assert.deepEqual(mark("7/33", dec), { result: "wrong_form", form: "decimal" });
  for (const a of ["0.(21)", "0,2̇1̇", "0.212121...", "0.\\dot{2}\\dot{1}"]) assert.equal(r(a, dec), "correct", a);
  assert.equal(r("0.21", dec), "incorrect");
  // the same flag on an expression ("write 3/8 as a decimal"), and a mixed number is not a decimal
  const expr38: MarkerSpec = { kind: "expression", key: "0,375", form: "decimal", variables: [] };
  assert.deepEqual(mark("3/8", expr38), { result: "wrong_form", form: "decimal" });
  assert.equal(r("0,375", expr38), "correct");
  assert.deepEqual(mark("8 4/5", { ...expr38, key: "8,8" }), { result: "wrong_form", form: "decimal" });
});

test("T413: an answer of the wrong shape goes back for re-entry, naming the shape", () => {
  const pt: MarkerSpec = { kind: "coordinates", key: "(2;3)", form: null, variables: [] };
  assert.deepEqual(mark("3", pt), { result: "unreadable", reason: "not a coordinate pair" });
  assert.deepEqual(mark("(1; 2; 3)", pt).result, "unreadable");
  assert.deepEqual(mark("x = 3", { kind: "interval", key: "x>3", form: null, variables: ["x"] }), {
    result: "unreadable",
    reason: "not an inequality or an interval",
  });
});

test("T413: units are notation, and never swallow a variable", () => {
  const surd: MarkerSpec = { kind: "surd", key: "3\\sqrt{2}", form: null, variables: [] };
  for (const a of ["3√2 cm", "3√2cm", "3 sqrt(2) m", "3√2 cm^2", "3√2 cm²"]) assert.equal(r(a, surd), "correct", a);
  assert.equal(r("(2 cm; 3 cm)", { kind: "coordinates", key: "(2;3)", form: null, variables: [] }), "correct");
  assert.equal(r("x = 3 cm or x = 5 cm", { kind: "values", key: "x=3 \\text{ or } x=5", form: null, variables: ["x"] }), "correct");
  // m is a declared variable: 5m is 5·m, not five metres
  assert.equal(r("5 m", { kind: "values", key: "5", form: null, variables: ["m"] }), "incorrect");
  // an expression with variables keeps every letter: 2x + 3m is not 2x + 3
  assert.equal(r("2x + 3m", expr("2x+3", null, ["x"])), "incorrect");
  assert.equal(stripUnits("y = 3 m", { kind: "equation", variables: [] }), "y = 3 m");
});

test("T413: a surd asked for in simplest form refuses an unsimplified root", () => {
  const spec: MarkerSpec = { kind: "surd", key: "5\\sqrt{2}", form: "simplest", variables: [] };
  assert.equal(r("5√2", spec), "correct");
  assert.deepEqual(mark("√50", spec), { result: "wrong_form", form: "simplest" });
  const half: MarkerSpec = { kind: "surd", key: "\\frac{\\sqrt{2}}{2}", form: "simplest", variables: [] };
  assert.equal(r("√2/2", half), "correct");
  assert.deepEqual(mark("1/√2", half), { result: "wrong_form", form: "simplest" });
  assert.deepEqual(mark("√(1/2)", half), { result: "wrong_form", form: "simplest" });
});

test("hostile input: a flood of ± is refused before it can multiply the branches", () => {
  const spec: MarkerSpec = { kind: "values", key: "2", form: null, variables: [] };
  const t0 = Date.now();
  assert.deepEqual(mark("±1".repeat(40), spec), { result: "unreadable", reason: "too many ± signs" });
  assert.ok(Date.now() - t0 < 500);
});

// ------------------------------------------------------------------ 4. around `mark`: spec, copy, preview

test("readMarkerSpec: absent is null (today's grade()), present is the spec, malformed is a content defect", () => {
  assert.equal(readMarkerSpec(null), null);
  assert.equal(readMarkerSpec([{ key: "A", text: "1" }]), null); // an MCQ's options
  assert.equal(readMarkerSpec({ kind: "number_line", spec: {}, diagnostics: [] }), null); // a widget
  assert.equal(readMarkerSpec({ marker: null }), null);
  assert.deepEqual(readMarkerSpec({ marker: { kind: "expression", key: "x+1", variables: ["x"] } }), {
    kind: "expression", key: "x+1", form: null, variables: ["x"], tolerance: null,
  });
  for (const bad of [
    { marker: "x+1" },
    { marker: { kind: "polynomial", key: "x" } },
    { marker: { kind: "expression", key: "" } },
    { marker: { kind: "expression", key: "x", form: "factorized" } },
    { marker: { kind: "expression", key: "x", form: { subject: "x" } } }, // a subject needs an equation
    { marker: { kind: "expression", key: "x", variables: "x" } },
    { marker: { kind: "expression", key: "x", tolerance: { abs: -1 } } },
  ]) assert.throws(() => readMarkerSpec(bad), MarkerKeyError, JSON.stringify(bad));
});

test("markerInputOf: what the input control needs, never the key; null for numbers, choices and widgets", () => {
  const choices = { marker: { kind: "expression", key: "(x-3)(x+3)", form: "factorised", variables: ["x"] } };
  const got = markerInputOf({ questionType: "short", choices });
  assert.deepEqual(got, { kind: "expression", form: "factorised", variables: ["x"] });
  assert.ok(!JSON.stringify(got).includes("x-3"), "the key must not travel to the input");
  assert.equal(markerInputOf({ questionType: "numeric", choices: null }), null);
  assert.equal(markerInputOf({ questionType: "mcq", choices: [{ key: "A", text: "1" }] }), null);
  assert.equal(markerInputOf({ questionType: "widget", choices }), null);
  assert.equal(markerInputOf({ questionType: "short", choices: { marker: { kind: "nope" } } }), null);
});

test("re-entry copy names the form asked, says what to fix, and is gender-neutral English", () => {
  const forms = ["factorised", "expanded", "simplest", "exact", "decimal", "subject:b"];
  const copy = forms.map((form) => reentryMessage({ result: "wrong_form", form }));
  assert.match(copy[0], /factorised/);
  assert.match(copy[1], /expanded/);
  assert.match(copy[2], /simplest/);
  assert.match(copy[3], /exact/);
  assert.match(copy[4], /decimal/);
  assert.match(copy[5], /b isn't the subject/);
  assert.match(reentryMessage({ result: "unreadable", reason: "ambiguous division: add brackets" }), /brackets/);
  assert.match(reentryMessage({ result: "unreadable", reason: "not a coordinate pair" }), /point/);
  assert.match(reentryMessage({ result: "unreadable", reason: "unexpected character \"$\"" }), /can't be read/);
  for (const c of [...copy, reentryMessage({ result: "unreadable", reason: "x" })]) {
    assert.ok(!/\b(he|she|him|her|his|hers)\b/i.test(c), c);
    assert.ok(!/wrong|incorrect/i.test(c), `a re-entry is not a verdict: ${c}`);
  }
});

test("previewLatex reads the answer with the marker's own reader", () => {
  const e = { kind: "expression" as const, variables: ["x", "y"] };
  assert.equal(previewLatex("x^2-9", e).latex, "x^{2} - 9");
  assert.equal(previewLatex("sqrt(3)/2", e).latex, "\\frac{\\sqrt{3}}{2}");
  assert.equal(previewLatex("(x-3)(x+3)", e).latex, "\\left(x - 3\\right) \\left(x + 3\\right)");
  assert.equal(previewLatex("1/(2x)", e).latex, "\\frac{1}{2 x}");
  assert.equal(previewLatex("2 3", e).latex, "2 \\cdot 3"); // never "23"
  // the ambiguity the marker refuses is refused here too, with the marker's reason
  assert.deepEqual(previewLatex("1/2x", e), { latex: null, reason: "ambiguous division: add brackets" });
  assert.deepEqual(previewLatex("", e), { latex: null, reason: null });
  // decision 15's notation, and every kind's shape
  assert.equal(previewLatex("(-0,5; -1,25)", { kind: "coordinates", variables: [] }).latex, "(-0.5;\\;-1.25)");
  assert.equal(previewLatex("0,2̇1̇", { kind: "recurring", variables: [] }).latex, "0.\\dot{2}\\dot{1}");
  assert.equal(previewLatex("[-3; 2)", { kind: "interval", variables: ["k"] }).latex, "[-3;\\;2)");
  assert.equal(previewLatex("-3 <= k < 2", { kind: "interval", variables: ["k"] }).latex, "-3 \\le k < 2");
  assert.equal(previewLatex("3√2 cm", { kind: "surd", variables: [] }).latex, "3 \\sqrt{2}");
});

test("previewLatex never passes typed text to KaTeX: its output is built from the marker's tokens", () => {
  const e = { kind: "expression" as const, variables: ["x"] };
  for (const hostile of ["\\href{javascript:alert(1)}{x}", "\\url{x}", "$x$", "\\htmlClass{a}{x}", "<img src=x>", "x\\\\y"]) {
    const p = previewLatex(hostile, e);
    if (p.latex === null) continue;
    assert.ok(!/href|url|html|\$/.test(p.latex), `${hostile} -> ${p.latex}`);
    // and what KaTeX makes of it carries no markup of the student's
    const html = katex.renderToString(p.latex, { throwOnError: false, output: "html" });
    assert.ok(!/<img|javascript:|href=/i.test(html), `${hostile} -> ${html}`);
  }
});
