/**
 * EVERY WIDGET QUESTION'S DIAGNOSTICS CAN FIRE (consistency review
 * 2026-09-27, W1).
 *
 * A widget question maps predicates to misconceptions (ADR-0009): "if the
 * student's construction is X, it reveals mistake Y". A mapping whose
 * predicate the widget, in that question's mode, can never emit is dead — the
 * student who makes that mistake gets a plain "not quite" and never the
 * refutation written for it. The review found 14 such links in the live Prep-3
 * bank and 5 in Grade 10's. The contract now says, per mode, what each widget
 * can emit (`contracts/widget-predicates.json` v2 `can_emit`, mirrored as
 * `canEmit` in `lib/widget-predicates.ts` and kept in sync by its own test);
 * this holds the banks in the repo to it:
 *
 *   · the Prep-3 bank the loader ships — every LIVE question in
 *     `seed/generated/widget-questions.json`;
 *   · Grade 10's bank — `seed/generated/g10-math/widget-questions.json`, and the
 *     export beside it minus retired questions.
 *
 * Each question's mode must be one the table knows, and each diagnostic's
 * predicate one that mode can emit. The data is the pipeline's; a failure here
 * is a mapping to fix there, never in this test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { canEmit } from "./widget-predicates.ts";

const SEED = fileURLToPath(new URL("../../../services/extraction/seed/generated/", import.meta.url));

type WidgetQuestion = {
  id: string;
  status?: string;
  choices: { kind: string; spec?: Record<string, unknown>; diagnostics?: { predicate: string; misconception_id: string }[] };
};

function bank(rel: string, keep: (q: WidgetQuestion) => boolean): WidgetQuestion[] {
  const path = SEED + rel;
  assert.ok(existsSync(path), `${rel} is in the repo`);
  const doc = JSON.parse(readFileSync(path, "utf8")) as { questions: WidgetQuestion[] };
  return doc.questions.filter(keep);
}

/** Every dead or unresolvable mapping, one readable line each. */
export function deadMappings(qs: readonly WidgetQuestion[]): string[] {
  const out: string[] = [];
  for (const q of qs) {
    const allowed = canEmit(q.choices.kind, q.choices.spec);
    if (!allowed) {
      out.push(`${q.id}: ${q.choices.kind} ${JSON.stringify(q.choices.spec ?? {})} — no can_emit row for this mode`);
      continue;
    }
    for (const d of q.choices.diagnostics ?? []) {
      if (!allowed.includes(d.predicate)) {
        out.push(`${q.id}: ${q.choices.kind} can never emit "${d.predicate}" here (→ ${d.misconception_id}); it can emit ${allowed.join(", ")}`);
      }
    }
  }
  return out;
}

const BANKS = [
  ["the live Prep-3 bank", bank("widget-questions.json", (q) => q.status === "live")],
  ["Grade 10's bank", bank("g10-math/widget-questions.json", () => true)],
  ["Grade 10's export (not retired)", bank("g10-math/export/widget-questions.json", (q) => q.status !== "retired")],
] as const;

for (const [name, qs] of BANKS) {
  test(`${name}: every diagnostic uses a predicate its widget's mode can emit`, () => {
    assert.ok(qs.length > 0, `${name} has widget questions`);
    const dead = deadMappings(qs);
    assert.deepEqual(dead, [], `${name}: dead predicate → misconception mappings (fix the data):\n  ${dead.join("\n  ")}`);
  });
}

test("the check catches a dead mapping and an unknown mode (negative control)", () => {
  const dead = deadMappings([
    {
      id: "q:t:w1",
      choices: {
        kind: "line_drawer",
        spec: { mode: "points" },
        diagnostics: [
          { predicate: "points-swapped", misconception_id: "mc:ok" },
          { predicate: "slope-inverted", misconception_id: "mc:dead" },
        ],
      },
    },
    { id: "q:t:w2", choices: { kind: "angle_setter", spec: { ask: "reflex" }, diagnostics: [] } },
  ]);
  assert.equal(dead.length, 2);
  assert.match(dead[0], /q:t:w1: line_drawer can never emit "slope-inverted"/);
  assert.match(dead[1], /q:t:w2: .*no can_emit row/);
});
