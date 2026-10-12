import { test } from "node:test";
import assert from "node:assert/strict";
import {
  documentedMathWidgets, mathWidgetDocs, mathWidgetsFor, unitOf, WIDGET_UNITS,
} from "./widget-docs.ts";
import { MATH_WIDGETS, parseMathWidget } from "./widget-payloads.ts";

/**
 * @covers FR-1201, FR-1209
 *
 * Every module reachable by a widget, and each lesson told about its own
 * unit's widgets rather than all eleven.
 *
 * The tutor can only reach for a widget it has been told about, so this
 * mapping is the difference between a built widget and a used one. The gap
 * these tests guard is the quiet one: a widget that exists, renders, validates
 * and is never documented to any lesson — working code nobody ever sees.
 */

/** Every unit in the Prep-3 book, as the extraction pipeline names them. */
const UNITS = [
  "u1", "u2", "u3", "u4", "u5",
  "geo1", "geo2", "t2u1", "t2u2", "t2u3",
];

test("every unit in the book is offered at least one widget", () => {
  for (const u of UNITS) {
    const w = mathWidgetsFor(`${u}-1`);
    assert.ok(w.length > 0, `unit ${u} has no widget`);
  }
});

test("the mapping covers all ten units and adds none that do not exist", () => {
  assert.deepEqual([...WIDGET_UNITS].sort(), [...UNITS].sort());
});

/**
 * Kinds that belong to a course with its OWN widget list (feature 003,
 * `ownUnitWidgets` in `lib/lesson.ts`) and are therefore never added to the
 * National BY_UNIT map below — they are documented in DOCS and reach a
 * lesson through `mathWidgetDocsNamed` instead (see the next test). A widget
 * agent adding a new G10-only kind adds its name here alongside its DOCS
 * entry, so this test keeps checking the National mapping only.
 */
const NON_NATIONAL_WIDGETS = [
  "polygon_builder", "solid_scaler", "box_plot_builder",
  "venn_builder", "area_model",
];

test("every built National widget is documented to at least one unit", () => {
  const documented = new Set(UNITS.flatMap((u) => mathWidgetsFor(`${u}-1`)));
  for (const name of MATH_WIDGETS) {
    if (NON_NATIONAL_WIDGETS.includes(name)) continue;
    assert.ok(documented.has(name), `${name} is built but no lesson is ever told about it`);
  }
});

test("every built widget is documented SOMEWHERE it can reach a lesson", () => {
  // Not necessarily the National unit map above: a course with its own widget
  // kinds (feature 003, `ownUnitWidgets` in `lib/lesson.ts`) reads this file's
  // DOCS directly by name (`mathWidgetDocsNamed`) rather than through
  // BY_UNIT, so a G10-only kind is fully documented without ever appearing in
  // `UNITS`. What every kind MUST have, on either path, is a DOCS entry —
  // without one, no course could ever be told about it (FR-1209).
  const documented = documentedMathWidgets(MATH_WIDGETS as unknown as string[]);
  assert.deepEqual(
    [...documented].sort(),
    [...MATH_WIDGETS].sort(),
    "a widget is built but has no entry in widget-docs.ts's DOCS, so no course can ever be told about it"
  );
});

test("no unit is handed more than four widgets", () => {
  // The cost of a long list is a worse choice per beat, not just tokens.
  for (const u of UNITS) {
    assert.ok(mathWidgetsFor(`${u}-1`).length <= 4, `unit ${u} has too many options`);
  }
});

test("an unknown unit falls back to the two originals, not to everything", () => {
  assert.deepEqual(mathWidgetsFor("zz-9"), ["pair_plotter", "product_builder"]);
});

test("the unit is the slug up to the first dash", () => {
  assert.equal(unitOf("geo2-4"), "geo2");
  assert.equal(unitOf("u3-2"), "u3");
  assert.equal(unitOf("t2u1-3"), "t2u1");
});

test("the block always tells the tutor to attribute and to prefer stored", () => {
  // Both are load-bearing. Without the objective an inline widget records
  // nothing (ADR-0009 §3); without the preference the tutor improvises over a
  // reviewed bank that already covers the beat.
  for (const u of UNITS) {
    const doc = mathWidgetDocs(`${u}-1`);
    assert.match(doc, /"lo":"lo:…"/, `unit ${u}: no objective-attribution guidance`);
    assert.match(doc, /show_question/, `unit ${u}: stored constructions never mentioned`);
  }
});

test("each documented line names its own widget and is one line", () => {
  for (const u of UNITS) {
    // Only the DIRECTIVE lines are per-widget; the block also carries general
    // guidance (name the objective, prefer a stored construction) that belongs
    // to no single widget.
    const lines = mathWidgetDocs(`${u}-1`)
      .split("\n")
      .filter((l) => l.startsWith("- ") && l.includes("{{widget:"));
    const names = mathWidgetsFor(`${u}-1`);
    assert.equal(lines.length, names.length, `unit ${u}: a widget lost its doc line`);
    for (const n of names) {
      assert.ok(
        lines.some((l) => l.includes(`{{widget:${n}:`)),
        `unit ${u}: ${n} has no example directive`
      );
    }
  }
});

test("every example payload in the docs actually validates", () => {
  // A documented example that the validator rejects is the worst possible
  // prompt: it teaches the model to emit payloads that silently render
  // nothing. Pull each JSON example out of its directive and run it through.
  const seen = new Set<string>();
  for (const u of UNITS) {
    for (const line of mathWidgetDocs(`${u}-1`).split("\n")) {
      // A non-greedy regex stops at the first closing brace and would cut the
      // sample_space payload in half at its nested rule — which is exactly why
      // chat-parse.ts matches these with a brace counter rather than a regex.
      // The test has to read them the way the runtime does.
      for (const { name, json } of extractDirectives(line)) {
        let props: Record<string, unknown>;
        try {
          props = JSON.parse(json);
        } catch {
          assert.fail(`unit ${u}: ${name} example is not valid JSON: ${json}`);
        }
        assert.ok(
          parseMathWidget(name, props),
          `unit ${u}: the documented ${name} example does not validate: ${json}`
        );
        seen.add(name);
      }
    }
  }
  // Scoped to the NATIONAL mapping this loop actually walks — a course that
  // reads `mathWidgetDocsNamed` with its own list (feature 003) is not walked
  // here at all, so its kinds' examples are not expected to turn up in `seen`.
  const nationalWidgets = new Set(UNITS.flatMap((u) => mathWidgetsFor(`${u}-1`)));
  assert.ok(seen.size >= nationalWidgets.size - 2, "most National widgets should carry a full example");
});

/** Pull `{{widget:name:{…}}}` directives out of a doc line, counting braces so
 *  a nested payload object survives intact. */
function extractDirectives(line: string): { name: string; json: string }[] {
  const out: { name: string; json: string }[] = [];
  const open = "{{widget:";
  let i = line.indexOf(open);
  while (i !== -1) {
    const colon = line.indexOf(":", i + open.length);
    if (colon === -1) break;
    const name = line.slice(i + open.length, colon);
    let depth = 0;
    let j = colon + 1;
    let inStr = false;
    for (; j < line.length; j++) {
      const ch = line[j];
      if (inStr) {
        if (ch === "\\") j++;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth === 0 && j < line.length) out.push({ name, json: line.slice(colon + 1, j + 1) });
    i = line.indexOf(open, j);
  }
  return out;
}
