import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WIDGET_PREDICATES, OK, predicatesFor } from "./widget-predicates.ts";

/**
 * @covers FR-1213
 *
 * The other half of the same contract: no widget emits a predicate the
 * vocabulary does not declare. A lint for a failure that is invisible at runtime.
 *
 * THE DRIFT THE RUNTIME WOULD NEVER RAISE ON.
 *
 * A widget that emits `"is-tangent"` when the contract says `"is-secant"` is
 * not a crash. The predicate arrives at the server, matches no diagnostic on
 * the stored question, and the student gets silence where a refutation was
 * meant to be — with nothing in any log to say so. Typechecking cannot catch it
 * either, because both are just strings.
 *
 * So this reads the widget sources and checks every predicate literal they can
 * emit against the vocabulary. It is a lint, not a unit test, and it exists
 * because the failure it guards is invisible in production.
 */

const DIR = fileURLToPath(new URL("../components/student/widgets/", import.meta.url));

/** Kind → component file. The dispatcher maps these; this is the same map. */
const FILES: Record<string, string> = {
  pair_plotter: "PairPlotter.tsx",
  product_builder: "ProductBuilder.tsx",
  line_drawer: "LineDrawer.tsx",
  circle_builder: "CircleBuilder.tsx",
  angle_setter: "AngleSetter.tsx",
  triangle_ratio: "TriangleRatio.tsx",
  bar_builder: "BarBuilder.tsx",
  number_line_marker: "NumberLineMarker.tsx",
  ratio_balance: "RatioBalance.tsx",
  sample_space: "SampleSpace.tsx",
  curve_sketcher: "CurveSketcher.tsx",
};

/**
 * Every predicate literal a file can actually emit.
 *
 * Scoped deliberately narrowly: `pred = "…"` assignments, and the string
 * literals inside the `predicate:` property of the outcome object. A looser
 * scan picks up Tailwind class ternaries — `? "cursor-default" :` — and
 * reports them as unknown predicates, which is a false alarm that would teach
 * people to ignore this test.
 */
function emitted(src: string): Set<string> {
  const out = new Set<string>();

  const assign = /\bpred\s*=\s*"([a-z][a-z0-9-]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = assign.exec(src))) out.add(m[1]);

  // The `predicate:` property runs until the sibling `given:` key.
  const start = src.indexOf("predicate:");
  if (start !== -1) {
    const end = src.indexOf("given:", start);
    const span = src.slice(start, end === -1 ? start + 400 : end);
    const lit = /"([a-z][a-z0-9-]*)"/g;
    while ((m = lit.exec(span))) {
      // Skip comparison operands — `v === "correct" ? OK : pred` reads a
      // verdict, it does not emit a predicate.
      const before = span.slice(Math.max(0, m.index - 4), m.index);
      if (/[=!]=\s*$/.test(before)) continue;
      out.add(m[1]);
    }
  }
  return out;
}

test("every widget component exists and is mapped", () => {
  const onDisk = new Set(readdirSync(DIR).filter((f) => f.endsWith(".tsx")));
  for (const [kind, file] of Object.entries(FILES)) {
    assert.ok(onDisk.has(file), `${kind}: ${file} is missing`);
  }
  assert.deepEqual(
    Object.keys(FILES).sort(),
    Object.keys(WIDGET_PREDICATES).sort(),
    "a kind has a vocabulary but no component, or the reverse"
  );
});

test("no widget emits a predicate the contract does not declare", () => {
  for (const [kind, file] of Object.entries(FILES)) {
    const src = readFileSync(DIR + file, "utf8");
    const allowed = new Set(predicatesFor(kind));
    for (const p of emitted(src)) {
      assert.ok(
        allowed.has(p),
        `${file} can emit "${p}", which is not in ${kind}'s vocabulary ` +
          `(known: ${[...allowed].sort().join(", ")}). The server would find no ` +
          `diagnostic for it and the student would get silence.`
      );
    }
  }
});

test("every widget declares the reserved correct predicate", () => {
  for (const [kind, file] of Object.entries(FILES)) {
    const src = readFileSync(DIR + file, "utf8");
    assert.ok(
      src.includes("OK") && src.includes("predicate:"),
      `${kind} (${file}) does not report a predicate at all`
    );
    assert.ok(predicatesFor(kind).includes(OK));
  }
});

test("no widget still reports its outcome as a bare string", () => {
  // The old contract. A widget left on it would compile only if its caller
  // also stayed on it, but the mixture is exactly how half a migration hides.
  for (const [kind, file] of Object.entries(FILES)) {
    const src = readFileSync(DIR + file, "utf8");
    assert.ok(
      !src.includes("onResult: (note: string) => void"),
      `${kind} is still on the prose-only contract`
    );
    assert.ok(
      src.includes("WidgetOutcome"),
      `${kind} does not use the structured outcome type`
    );
  }
});
