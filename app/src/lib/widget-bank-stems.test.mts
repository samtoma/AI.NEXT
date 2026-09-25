/**
 * @covers FR-1207, FR-1206
 *
 * Every stored widget question's answer key agrees with its own stem.
 *
 * v0.9.3: q:t2u2-2-1:w001–w003 asked for the values x cannot take in
 * 1/((x − 2)(x + 3)) and friends, and stored the NEGATIVES of those values as
 * the answer. Their stems and solutions were right; only the key was wrong,
 * and nothing read the two against each other. FR-1207's rule — "a widget
 * that cannot be answered correctly marks a correct answer wrong, which is
 * worse for the student than a missing widget" — was enforced for payloads a
 * model composes (`widget-payloads.ts`) and never for the stored bank. This
 * file enforces it there, three ways:
 *
 *   1. BLIND READING. Each template family's stem is parsed WITHOUT looking at
 *      the spec — the factors of a denominator, the coefficients of a line,
 *      the terms of a proportion — and the spec that stem asks for is derived
 *      from it deterministically. It must equal the stored spec. The numbers
 *      the canonical solution states (the roots, the fourth term, n(E), the
 *      turning point, …) are checked against the same reading, so the key, the
 *      stem and the solution the tutor grounds on cannot disagree.
 *   2. REACHABILITY. Every stored spec goes through the app's own
 *      `parseMathWidget`, the validator FR-1207 names: a stored widget the
 *      instrument cannot answer is refused here instead of in front of a child.
 *   3. THE FIX ITSELF. The domain-excluded rows map the sign error to its
 *      refutation (FR-1206), and migration 032 — which carries the fix to the
 *      database production already has — writes exactly the seed's values.
 *
 * A family with no reader fails: a new template must say how its stem is read.
 * The seed is the export of the live bank (`export_generated_content.py`), and
 * the three corrected rows were also checked against a fresh run of the
 * generator (`services/extraction/tests/test_widget_stems.py`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseMathWidget } from "./widget-payloads.ts";
import { gradePoints } from "../components/student/widgets/number-line-grade.ts";
import { OK } from "./widget-predicates.ts";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));

type Spec = Record<string, unknown>;
type Q = {
  id: string;
  lo_id: string;
  stem: string;
  status: string;
  source_note: string | null;
  choices: { kind: string; spec: Spec; diagnostics: { predicate: string; misconception_id: string }[] };
  canonical_solution: { step: number; text_md: string }[];
};
const bank: Q[] = JSON.parse(
  readFileSync(join(REPO, "services/extraction/seed/generated/widget-questions.json"), "utf8")
).questions;

const familyOf = (q: Q) => /template family ([a-z0-9-]+)/.exec(q.source_note ?? "")?.[1] ?? null;
const solutionOf = (q: Q) => q.canonical_solution.map((s) => s.text_md).join(" ");
const int = (s: string) => Number.parseInt(s, 10);
const NUM = String.raw`(-?\d+(?:\.\d+)?)`;

function must(re: RegExp, s: string, what: string): RegExpExecArray {
  const m = re.exec(s);
  assert.ok(m, `cannot read ${what} from: ${s}`);
  return m;
}

/** Does the solution say it? Collected, not thrown, so one run lists every miss. */
function says(sol: string, text: string, why: string, out: string[]) {
  if (!sol.includes(text)) out.push(`the solution does not say "${text}" (${why})`);
}

/**
 * The spec a stem asks for, read from the stem alone, and every place the
 * solution disagrees with that reading.
 */
function readStem(q: Q): { spec: Spec; problems: string[] } {
  const st = q.stem;
  const sol = solutionOf(q);
  const problems: string[] = [];
  const fam = familyOf(q) ?? "";

  switch (true) {
    case fam === "domain-excluded": {
      // (x − a) is zero at x = a; (x + a) at x = −a.
      const factors = [...st.matchAll(/\(x\s*([+-])\s*(\d+)\)/g)];
      assert.equal(factors.length, 2, `${q.id}: expected two linear factors in the denominator`);
      const roots = factors.map(([, sign, n]) => (sign === "+" ? -int(n) : int(n))).sort((a, b) => a - b);
      const stated = [...sol.matchAll(/\$x = (-?\d+)\$/g)].map((m) => int(m[1])).sort((a, b) => a - b);
      if (JSON.stringify(stated) !== JSON.stringify(roots))
        problems.push(`the solution excludes x = ${stated.join(", ")}; the stem's roots are ${roots.join(", ")}`);
      return { spec: { mode: "points", range: [-6, 6], targets: roots }, problems };
    }
    case fam === "line-equation": {
      const [, m, b] = must(new RegExp(String.raw`y = ${NUM}x \+ ${NUM}`), st, "y = mx + b").map(Number);
      says(sol, `$(0, ${b})$`, "the intercept", problems);
      says(sol, `$(1, ${m + b})$`, "one step right", problems);
      return { spec: { mode: "equation", m, b }, problems };
    }
    case fam === "sketch-linear": {
      const [, m, c] = must(new RegExp(String.raw`y = ${NUM}x \+ ${NUM}`), st, "y = mx + c").map(Number);
      says(sol, `gradient is $${m}$`, "the gradient", problems);
      says(sol, `axis at $${c}$`, "the intercept", problems);
      says(sol, m > 0 ? "rises" : "falls", "the direction", problems);
      return { spec: { fn: "linear", coefs: [m, c] }, problems };
    }
    case fam === "sketch-quadratic": {
      const [, a, b, c] = must(new RegExp(String.raw`y = ${NUM}x\^2 \+ ${NUM}x \+ ${NUM}`), st, "ax² + bx + c").map(Number);
      const vx = -b / (2 * a);
      const vy = a * vx * vx + b * vx + c;
      assert.ok(Number.isInteger(vx) && Number.isInteger(vy), `${q.id}: a lattice turning point`);
      says(sol, `turning at $(${vx + 0}, ${vy + 0})$`, "the turning point", problems);
      says(sol, a > 0 ? "opens upwards" : "opens downwards", "the sign of a", problems);
      return { spec: { fn: "quadratic", coefs: [a, b, c] }, problems };
    }
    case fam === "variation-direct": {
      const [, a, b, c] = must(/\$(\d+) : (\d+) = (\d+) : \?\$/, st, "a : b = c : ?").map(Number);
      says(sol, `fourth term $${(b * c) / a}$`, "b × c ÷ a", problems);
      return { spec: { mode: "direct", a, b, c }, problems };
    }
    case fam === "variation-inverse": {
      const [, a, b, c] = must(
        /\$(\d+)\$ workers finish a job in \$(\d+)\$ days\. How long do \$(\d+)\$ workers/, st, "workers and days"
      ).map(Number);
      says(sol, `= ${(a * b) / c}$ days`, "a × b ÷ c", problems);
      return { spec: { mode: "inverse", a, b, c }, problems };
    }
    case fam === "probability-sum": {
      const v = int(must(/total is \$(\d+)\$/, st, "the total")[1]);
      let n = 0;
      for (let i = 1; i <= 6; i++) for (let j = 1; j <= 6; j++) if (i + j === v) n++;
      says(sol, `$n(E) = ${n}$`, "the cells of the event", problems);
      says(sol, `\\frac{${n}}{36}`, "the probability", problems);
      return { spec: { rows: 6, cols: 6, rule: { kind: "sum", op: "eq", value: v } }, problems };
    }
    case fam === "inscribed-angle": {
      const t = int(must(/inscribed angle \$\\angle ACB\$ to \$(\d+)°\$/, st, "the inscribed angle")[1]);
      says(sol, `must measure $${2 * t}°$`, "the arc is double", problems);
      return { spec: { ask: "inscribed", target: t }, problems };
    }
    case fam === "central-angle": {
      const t = int(must(/arc \$AB\$ facing \$C\$ to \$(\d+)°\$/, st, "the arc")[1]);
      says(sol, `reads $${t / 2}°$`, "the inscribed angle is half", problems);
      return { spec: { ask: "central", target: t }, problems };
    }
    case fam.startsWith("trig-"): {
      const [, ask, target] = must(new RegExp(String.raw`\$\\(sin|cos|tan) \\theta = ${NUM}\$`), st, "the ratio");
      // The solution's legs are (opposite, adjacent), the template's convention.
      const [, o, a] = must(/Legs of (\d+) and (\d+)/, sol, "the legs").map(Number);
      const h = Math.hypot(o, a);
      const got = { sin: o / h, cos: a / h, tan: o / a }[ask as "sin" | "cos" | "tan"];
      if (Math.abs(got - Number(target)) > 1e-9)
        problems.push(`legs ${o} and ${a} give ${ask} θ = ${got}, not ${target}`);
      return { spec: { ask, target: Number(target) }, problems };
    }
    case fam.startsWith("stat-"): {
      const [, ask, t] = must(/\*\*(mean|median|mode|range)\*\* is \$(\d+)\$/, st, "the statistic");
      const counts: Record<string, number> = { five: 5 };
      const n = counts[must(/a set of (\w+) values/, st, "how many")[1]];
      assert.ok(n, `${q.id}: a count this reader knows`);
      const target = int(t);
      if (ask === "mean") says(sol, `total must be $${n * target}$`, "mean × n", problems);
      if (ask === "median") says(sol, `third value must be $${target}$`, "the middle value", problems);
      if (ask === "range") {
        const [, lo, hi] = must(/\$(\d+)\$ and \$(\d+)\$, say/, sol, "the example").map(Number);
        if (hi - lo !== target) problems.push(`the example ${lo}, ${hi} has range ${hi - lo}, not ${target}`);
      }
      return { spec: { ask, target, n }, problems };
    }
    case fam.startsWith("circle-"): {
      const element = must(/\*\*(radius|chord|diameter|tangent)\*\*/, st, "the element")[1];
      // CircleBuilder draws radius 5; a stem naming another would be unanswerable.
      assert.equal(int(must(/radius \$(\d+)\$/, st, "the radius")[1]), 5, `${q.id}: the instrument's radius`);
      return { spec: { element }, problems };
    }
    default:
      assert.fail(
        `${q.id}: no stem reader for template family ${JSON.stringify(familyOf(q))}. ` +
          "Add one here: a stored widget whose stem is never read against its answer key is how " +
          "q:t2u2-2-1:w001–w003 went live marking correct answers wrong."
      );
  }
}

/** Key order and set order do not matter; values do. */
function norm(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, norm(x)]));
  return v;
}
function stored(q: Q): Spec {
  const s = { ...q.choices.spec };
  if (Array.isArray(s.targets)) s.targets = [...(s.targets as number[])].sort((a, b) => a - b);
  return s;
}

test("the bank this reads is the whole stored widget bank", () => {
  assert.equal(bank.length, 48);
  assert.ok(bank.every((q) => q.choices?.kind), "every row is a widget with a kind");
});

test("every stored widget's answer key is what its stem asks for, and its solution agrees", () => {
  const failures: string[] = [];
  for (const q of bank) {
    const { spec, problems } = readStem(q);
    if (JSON.stringify(norm(stored(q))) !== JSON.stringify(norm(spec)))
      failures.push(`${q.id}: the stem asks for ${JSON.stringify(spec)}; the key stores ${JSON.stringify(q.choices.spec)}`);
    for (const p of problems) failures.push(`${q.id}: ${p}`);
  }
  assert.deepEqual(failures, [], `\n  ${failures.join("\n  ")}`);
});

test("every stored widget can be answered on its instrument (FR-1207's validator, on the stored bank)", () => {
  const refused = bank
    .filter((q) => !parseMathWidget(q.choices.kind, { ...q.choices.spec, prompt: q.stem }))
    .map((q) => `${q.id} (${q.choices.kind} ${JSON.stringify(q.choices.spec)})`);
  assert.deepEqual(refused, []);
});

test("domain-excluded: the roots are the key, the sign error is diagnosed, and the omission still is", () => {
  const rows = bank.filter((q) => familyOf(q) === "domain-excluded");
  assert.deepEqual(rows.map((q) => q.id), ["q:t2u2-2-1:w001", "q:t2u2-2-1:w002", "q:t2u2-2-1:w003"]);
  for (const q of rows) {
    const roots = readStem(q).spec.targets as number[];
    assert.deepEqual(q.choices.diagnostics, [
      { predicate: "sign-flipped", misconception_id: "mc:u1-1-1:transposition-sign" },
      { predicate: "missed-values", misconception_id: "mc:t2u2-2-1:excluded-values-incomplete" },
    ]);
    // graded as the widget grades it
    assert.equal(gradePoints(q.choices.spec.targets as number[], roots).predicate, OK, `${q.id}: the roots are right`);
    assert.equal(gradePoints(q.choices.spec.targets as number[], roots.map((v) => -v)).predicate, "sign-flipped");
    assert.equal(gradePoints(q.choices.spec.targets as number[], [roots[0]]).predicate, "missed-values");
  }
});

/* ------------------------------------------------------------------ */
/* Migration 032 and its rollback                                      */
/* ------------------------------------------------------------------ */

const sqlOnly = (s: string) => s.replace(/--[^\n]*/g, "");
const migration = sqlOnly(readFileSync(join(REPO, "db/migrations/032-widget-excluded-values-sign.sql"), "utf8"));
const rollback = sqlOnly(
  readFileSync(join(REPO, "db/migrations/rollback/032-widget-excluded-values-sign.down.sql"), "utf8")
);
const ADDED = { predicate: "sign-flipped", misconception_id: "mc:u1-1-1:transposition-sign" };

/** The (id, wrong, correct) rows a file's VALUES list names. */
function valuesOf(sql: string): { id: string; wrong: number[]; correct: number[] }[] {
  return [...sql.matchAll(/\('(q:[^']+)',\s*'(\[[^\]]*\])',\s*'(\[[^\]]*\])'\)/g)].map((m) => ({
    id: m[1],
    wrong: JSON.parse(m[2]),
    correct: JSON.parse(m[3]),
  }));
}

test("032 writes exactly the seed's key to the three rows, over the sign-flipped key only", () => {
  const rows = valuesOf(migration);
  assert.deepEqual(rows.map((r) => r.id), ["q:t2u2-2-1:w001", "q:t2u2-2-1:w002", "q:t2u2-2-1:w003"]);
  for (const r of rows) {
    const q = bank.find((x) => x.id === r.id)!;
    assert.deepEqual(r.correct, q.choices.spec.targets, `${r.id}: 032 writes the seed's targets`);
    assert.deepEqual(r.wrong, [...r.correct].map((v) => -v).sort((a, b) => a - b), `${r.id}: over the negatives only`);
  }
  // the diagnostic it adds is the seed's first, and it is added only when no
  // sign-flipped mapping is there already
  const flatSql = migration.replace(/\s+/g, " ");
  const added = /ELSE '(\[[^']*\])'::jsonb \|\| coalesce\(choices -> 'diagnostics', '\[\]'::jsonb\)/.exec(flatSql);
  assert.ok(added, "032 names the diagnostic it adds");
  assert.deepEqual(JSON.parse(added[1]), [ADDED]);
  assert.deepEqual(bank.find((x) => x.id === "q:t2u2-2-1:w001")!.choices.diagnostics[0], ADDED);
  assert.match(flatSql, /WHEN choices -> 'diagnostics' @> '\[\{"predicate": "sign-flipped"\}\]'::jsonb THEN choices -> 'diagnostics'/);
  // one UPDATE, of questions.choices, guarded by id AND the wrong targets, behind a SELECT
  const flat = migration.replace(/\s+/g, " ");
  const updates = [...flat.matchAll(/UPDATE (\w+) SET (\w+) =/g)];
  assert.deepEqual(updates.map((u) => [u[1], u[2]]), [["questions", "choices"]]);
  assert.match(flat, /WHERE id = r\.id AND choices #> '\{spec,targets\}' = r\.wrong;/);
  assert.match(flat, /IF EXISTS \(SELECT 1 FROM questions WHERE id = r\.id AND choices #> '\{spec,targets\}' = r\.wrong\) THEN UPDATE/);
  assert.doesNotMatch(migration, /\b(INSERT|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT)\b/i);
});

test("the rollback is 032 mirrored: the old key back and the added diagnostic removed, over the new key only", () => {
  assert.deepEqual(valuesOf(rollback), valuesOf(migration));
  const flat = rollback.replace(/\s+/g, " ");
  assert.match(flat, /IF EXISTS \(SELECT 1 FROM questions WHERE id = r\.id AND choices #> '\{spec,targets\}' = r\.correct\) THEN UPDATE/);
  assert.match(flat, /jsonb_set\(choices, '\{spec,targets\}', r\.wrong\)/);
  const removed = /e\.d <> '(\{[^']*\})'::jsonb/.exec(rollback);
  assert.ok(removed, "the rollback removes one exact diagnostic");
  assert.deepEqual(JSON.parse(removed[1]), ADDED);
  assert.doesNotMatch(rollback, /\b(INSERT|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT)\b/i);
});

test("the deploy's migration floor counts 032", () => {
  const files = readdirSync(join(REPO, "db/migrations")).filter((f) => f.endsWith(".sql"));
  const floor = Number(
    readFileSync(join(REPO, "deploy/apply-migrations.sh"), "utf8").match(/\[ "\$applied" -ge (\d+) \]/)?.[1]
  );
  assert.ok(files.includes("032-widget-excluded-values-sign.sql"));
  assert.equal(floor, files.length, "apply-migrations.sh's floor is the number of migration files");
});
