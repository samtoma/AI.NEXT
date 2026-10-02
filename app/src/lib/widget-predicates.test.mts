import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  OK, WIDGET_CAN_EMIT, WIDGET_PREDICATES, canEmit, describePredicate, isKnownPredicate, predicatesFor,
} from "./widget-predicates.ts";
import { MATH_WIDGETS } from "./widget-payloads.ts";

const contract = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../contracts/widget-predicates.json", import.meta.url)),
    "utf8"
  )
);

/**
 * @covers FR-1213
 *
 * One predicate vocabulary shared by the app, the pipeline and the stored rows.
 *
 * The drift guard. Three layers have to agree on the spelling of every
 * predicate — this module, `services/extraction/widget_spec.py`, and the rows
 * in `questions.choices`. A predicate misspelled in any one of them maps to no
 * misconception, and the student gets silence where a refutation was meant to
 * be. Nothing at runtime would raise; it would simply stop teaching.
 */

test("the generated module matches contracts/widget-predicates.json exactly", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(WIDGET_PREDICATES)),
    Object.fromEntries(
      Object.entries(contract.kinds).map(([k, v]) => [k, (v as { predicates: unknown }).predicates])
    ),
    "widget-predicates.ts has drifted from the contract — regenerate it"
  );
});

test("every widget that can be built has a predicate vocabulary", () => {
  for (const name of MATH_WIDGETS) {
    assert.ok(
      name in WIDGET_PREDICATES,
      `${name} can be rendered but declares no predicates, so it can never diagnose`
    );
  }
});

test("the vocabulary declares no kind that cannot be built", () => {
  for (const kind of Object.keys(WIDGET_PREDICATES)) {
    assert.ok(
      (MATH_WIDGETS as readonly string[]).includes(kind),
      `${kind} has predicates but no widget renders it`
    );
  }
});

test("'ok' is reserved and never redefined as a failure", () => {
  assert.deepEqual(contract.reserved, [OK]);
  for (const [kind, body] of Object.entries(WIDGET_PREDICATES)) {
    assert.ok(!(OK in body), `${kind} redefines the reserved predicate 'ok'`);
    assert.ok(predicatesFor(kind).includes(OK));
  }
});

test("every kind can express a failure it does not recognise", () => {
  // A widget that can only report named errors has to report SOMETHING when the
  // student is simply wrong in an unremarkable way. Kinds whose wrong answers
  // are always set-shaped say so through missed/extra instead.
  for (const kind of Object.keys(WIDGET_PREDICATES)) {
    const p = predicatesFor(kind);
    const catchAll =
      p.includes("off-target") ||
      p.includes("not-the-shape") || // polygon_builder: no property named asks for
      p.some((x) => x.startsWith("missed-") || x.startsWith("missing-")) ||
      p.some((x) => x.startsWith("interval-") || x.startsWith("endpoint-"));
    assert.ok(catchAll, `${kind} has no way to report an unrecognised wrong answer`);
  }
});

test("predicate names are stable, lowercase, hyphenated identifiers", () => {
  // These strings are stored in the database against real questions; a space or
  // a capital would survive a rename badly.
  for (const [kind, body] of Object.entries(WIDGET_PREDICATES)) {
    for (const p of Object.keys(body)) {
      assert.match(p, /^[a-z][a-z0-9-]*$/, `${kind}.${p} is not a stable identifier`);
    }
  }
});

test("every predicate carries a human description", () => {
  for (const [kind, body] of Object.entries(WIDGET_PREDICATES)) {
    for (const p of Object.keys(body)) {
      const d = describePredicate(kind, p);
      assert.ok(d && d.length > 12, `${kind}.${p} has no usable description`);
    }
  }
  assert.equal(describePredicate("circle_builder", OK), "Correct");
  assert.equal(describePredicate("circle_builder", "not-a-predicate"), null);
  assert.equal(describePredicate("not_a_kind", "anything"), null);
});

test("an unknown kind or predicate is rejected, not tolerated", () => {
  assert.ok(isKnownPredicate("circle_builder", "is-secant"));
  assert.ok(isKnownPredicate("circle_builder", OK));
  assert.ok(!isKnownPredicate("circle_builder", "is-tangent"));   // not in the vocabulary
  assert.ok(!isKnownPredicate("no_such_widget", "is-secant"));
  assert.deepEqual(predicatesFor("no_such_widget"), [OK]);
});

// ---------------------------------------------------------------------------
// CAN EMIT (consistency review 2026-09-27, W1): what each mode / ask / element /
// fn can actually report. The pipeline refuses a mapping outside it, so the
// table must stay the app's own truth.

type Node = readonly string[] | { by: string; cases: Record<string, Node> };
const leaves = (n: Node): string[] =>
  Array.isArray(n) ? [...n] : Object.values((n as { cases: Record<string, Node> }).cases).flatMap(leaves);

test("WIDGET_CAN_EMIT matches the contract's can_emit exactly", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(WIDGET_CAN_EMIT)),
    Object.fromEntries(
      Object.entries(contract.kinds).map(([k, v]) => [k, (v as { can_emit: unknown }).can_emit])
    ),
    "widget-predicates.ts has drifted from the contract's can_emit — regenerate it"
  );
});

test("every kind has a can_emit table, and it names only its own declared predicates", () => {
  for (const kind of Object.keys(WIDGET_PREDICATES)) {
    const table = (WIDGET_CAN_EMIT as Record<string, Node>)[kind];
    assert.ok(table, `${kind} has no can_emit table`);
    const walk = (n: Node, path: string) => {
      if (Array.isArray(n)) {
        assert.ok(n.length > 0, `${kind} ${path}: a case that emits nothing`);
        for (const p of n) {
          assert.ok(p !== OK, `${kind} ${path}: 'ok' is implied, never listed`);
          assert.ok(isKnownPredicate(kind, p), `${kind} ${path}: ${p} is not in ${kind}'s vocabulary`);
        }
      } else {
        const b = n as { by: string; cases: Record<string, Node> };
        assert.ok(b.by && Object.keys(b.cases).length, `${kind} ${path}: a dispatch with no cases`);
        for (const [v, sub] of Object.entries(b.cases)) walk(sub, `${path}${b.by}=${v} `);
      }
    };
    walk(table, "");
  }
});

// Kind -> component, and the pure grading modules it imports ("./x-grade"),
// read together: what they can emit is what the widget can emit.
const WIDGETS = fileURLToPath(new URL("../components/student/widgets/", import.meta.url));
const COMPONENT: Record<string, string> = {
  pair_plotter: "PairPlotter.tsx", product_builder: "ProductBuilder.tsx", line_drawer: "LineDrawer.tsx",
  circle_builder: "CircleBuilder.tsx", angle_setter: "AngleSetter.tsx", triangle_ratio: "TriangleRatio.tsx",
  bar_builder: "BarBuilder.tsx", number_line_marker: "NumberLineMarker.tsx", ratio_balance: "RatioBalance.tsx",
  sample_space: "SampleSpace.tsx", curve_sketcher: "CurveSketcher.tsx", polygon_builder: "PolygonBuilder.tsx",
  solid_scaler: "SolidScaler.tsx", box_plot_builder: "BoxPlotBuilder.tsx", venn_builder: "VennBuilder.tsx",
  area_model: "AreaModel.tsx",
};
const gradingSource = (kind: string): string => {
  const main = readFileSync(WIDGETS + COMPONENT[kind], "utf8");
  const helpers = [...main.matchAll(/from "\.\/([a-z0-9-]+-grade)"/g)].map((m) => m[1]);
  return [main, ...helpers.map((h) => readFileSync(`${WIDGETS}${h}.ts`, "utf8"))].join("\n");
};

test("the table never claims a predicate the widget's code cannot produce", () => {
  assert.deepEqual(Object.keys(COMPONENT).sort(), Object.keys(WIDGET_PREDICATES).sort());
  for (const kind of Object.keys(WIDGET_PREDICATES)) {
    const src = gradingSource(kind);
    for (const p of new Set(leaves((WIDGET_CAN_EMIT as Record<string, Node>)[kind]))) {
      assert.ok(src.includes(`"${p}"`), `${kind}: can_emit lists ${p}, but no "${p}" appears in its grading code`);
    }
  }
});

test("a declared predicate no case lists is never emitted — named here, so it cannot happen quietly", () => {
  // ProductBuilder.check() reports every wrong pick as reversed-pairs (its decoys ARE the reversed pairs), so
  // extra-pairs is vocabulary no product_builder question can fire; NumberLineMarker.check() starts from
  // "off-target" but every wrong answer in either mode is re-named (number-line-grade.ts, or the interval
  // branch), so off-target never leaves it. Change this list only with the code.
  const NEVER: Record<string, string[]> = { product_builder: ["extra-pairs"], number_line_marker: ["off-target"] };
  for (const kind of Object.keys(WIDGET_PREDICATES)) {
    const listed = new Set(leaves((WIDGET_CAN_EMIT as Record<string, Node>)[kind]));
    const unlisted = predicatesFor(kind).filter((p) => p !== OK && !listed.has(p)).sort();
    assert.deepEqual(unlisted, NEVER[kind] ?? [], `${kind}: declared but in no can_emit case`);
  }
});

test("canEmit reads the stored spec the way the widget does", () => {
  assert.deepEqual(canEmit("line_drawer", { mode: "points", through: [[-1, 0], [1, 4]] }), ["points-swapped", "off-target"]);
  assert.ok(canEmit("line_drawer", { mode: "equation", m: 2, b: 1 })!.includes("slope-inverted"));
  assert.ok(!canEmit("angle_setter", { ask: "inscribed", target: 30 })!.includes("angle-given-as-arc"));
  assert.ok(!canEmit("triangle_ratio", { ask: "sin", target: 0.6 })!.includes("ratio-inverted"));
  assert.ok(canEmit("triangle_ratio", { ask: "tan", target: 0.75 })!.includes("ratio-inverted"));
  assert.ok(!canEmit("solid_scaler", { solid: "sphere", ask: "area", ratio: 4 })!.includes("wrong-formula-part"));
  assert.ok(canEmit("venn_builder", { mode: "counts", sets: 2, clues: { a: 12 } })!.includes("overlap-counted-twice"));
  assert.ok(!canEmit("venn_builder", { mode: "counts", sets: 2 })!.includes("overlap-counted-twice"));
  assert.deepEqual(canEmit("pair_plotter", { target: [3, 2] }), ["swapped-coordinates", "wrong-quadrant", "off-target"]);
  assert.equal(canEmit("line_drawer", { mode: "sideways" }), null);
  assert.equal(canEmit("no_such_widget", {}), null);
});
