import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  OK, WIDGET_PREDICATES, describePredicate, isKnownPredicate, predicatesFor,
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
