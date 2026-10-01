/**
 * AUTO-PASSED GATE DECISIONS in the review gate (Samuel's answers 37c and 39;
 * `lib/review-gate-records.ts`, `lib/review-gate-files.ts`).
 *
 *   · the record the console relies on (`ainext.gate-decision/1`), and the
 *     auto-pass files `auto_pass_gates.py` writes today, read as gate
 *     decisions — never one a human signed;
 *   · a canonical record replaces what was read from an auto-pass file for the
 *     same gate and chapter;
 *   · every gate decision is a backlog item ASSIGNED TO SAMUEL: never a human
 *     stamp, in his queue, shown to anyone else only under "For Samuel";
 *   · the files are read from `runs/<book>/` for maths books only, and a
 *     changed record is a changed fingerprint.
 *
 * @covers FR-2204
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { readGateRecords } from "./review-gate-files.ts";
import { mergeRecords, parseAutoFile, parseRecord, type GateRecord } from "./review-gate-records.ts";
import { deriveGate, onFixList, parseFilters, pickCandidates, resolveItem } from "./review-gate.ts";

const T = "2026-10-02T09:14:00.000Z";

const RECORD = {
  format: "ainext.gate-decision/1",
  gate: "G1",
  book: "g10-math",
  id: "g1-ch09",
  chapter: 9,
  run: "fanout-2026-10-02",
  decided_at: "2026-10-02T09:14:00Z",
  by: "auto-pass G1 (AI recommendation)",
  auto: true,
  outcome: "pass",
  summary: "13 objectives approved on the evidence check; 1 link kept",
  decisions: [{ key: "lo:g10m9s1-1-1", decision: "approve", basis: "the evidence check kept it" }],
  checks: [{ name: "coverage", state: "green" }],
  evidence: [
    { label: "G1 check", path: "services/extraction/objectives/g10-math/ch09.check.json" },
    { label: "escape", path: "../../etc/passwd" },
  ],
  blocked: [],
  extra_field_from_the_future: true,
};

test("the gate-decision record the console relies on", () => {
  const r = parseRecord(RECORD, "services/extraction/runs/g10-math/gates/g1-ch09.json", T)!;
  assert.equal(r.ref, "g10-math/g1-ch09");
  assert.equal(r.gate, "G1");
  assert.equal(r.chapter, 9);
  assert.equal(r.outcome, "pass");
  assert.equal(r.decidedAt, T);
  assert.deepEqual(r.decisions, [{ key: "lo:g10m9s1-1-1", decision: "approve", basis: "the evidence check kept it" }]);
  assert.deepEqual(
    r.evidence.map((e) => e.path),
    ["services/extraction/objectives/g10-math/ch09.check.json"],
    "a path that climbs out of the repository is dropped"
  );
  assert.equal(r.origin, "record");

  for (const bad of [
    { ...RECORD, format: "something-else" },
    { ...RECORD, gate: "G9" },
    { ...RECORD, book: "../x" },
    { ...RECORD, id: "" },
    null,
  ]) {
    assert.equal(parseRecord(bad, "x.json", T), null);
  }
  const g5 = parseRecord({ ...RECORD, gate: "G5", id: "g5-book", chapter: null, outcome: "weird" }, "x.json", T)!;
  assert.equal(g5.gate, "G5");
  assert.equal(g5.chapter, null);
  assert.equal(g5.outcome, "unknown");
});

test("the auto-pass files G1–G4 write today are read as gate decisions", () => {
  const g1 = parseAutoFile(
    {
      auto: true,
      by: "auto-pass G1 (AI recommendation)",
      objectives: { "lo:g10m9s1-1-1": { action: "approve", why: "the evidence check kept it" } },
      terminology: { "t:gradient": "keep" },
      move_items: { "Ex9-1:3": "lo:g10m9s1-1-2" },
      links: { "lo:a>lo:b": "approve" },
      acknowledged: ["unpractised:lo:x"],
      outside_items: { "Ex9-6:40": { why: "both blind mappers placed it nowhere" } },
    },
    "services/extraction/runs/g10-math/objectives/g1-ch09.auto.json",
    "g10-math",
    T
  );
  assert.equal(g1.length, 1);
  assert.equal(g1[0]!.ref, "g10-math/g1-ch09");
  assert.equal(g1[0]!.gate, "G1");
  assert.equal(g1[0]!.chapter, 9);
  assert.equal(g1[0]!.decisions.length, 6);
  assert.equal(g1[0]!.origin, "auto-file");

  const g3 = parseAutoFile(
    { auto: true, reviewer: "auto-pass G3 (AI recommendation)", at: "2026-10-02T10:00:00+00:00", rule: "answer 37c: …", verdicts: { "q:1": "accept", "q:2": "accept" } },
    "services/extraction/runs/g10-math/g3-ch09.auto.json",
    "g10-math",
    T
  )[0]!;
  assert.equal(g3.gate, "G3");
  assert.equal(g3.decidedAt, "2026-10-02T10:00:00.000Z");
  assert.equal(g3.summary, "answer 37c: …");
  assert.equal(g3.decisions.length, 2);

  const g4 = parseAutoFile(
    { gate: "G4", auto: true, by: "auto-pass G4 (AI recommendation)", kept: ["mc:1", "mc:2"], dropped_by_verifier: ["mc:3"] },
    "services/extraction/runs/g10-math/g4-ch09.auto.json",
    "g10-math",
    T
  )[0]!;
  assert.equal(g4.gate, "G4");
  assert.deepEqual(g4.decisions.map((d) => d.decision), ["kept", "kept", "dropped by the verifier"]);
});

test("G2's file: only its AUTO items, by chapter; a file a human signed is no gate decision", () => {
  const mixed = parseAutoFile(
    {
      by: "Samuel",
      items: {
        "g10m8s1-1:Ex8-1:2": { verdict: "fix", note: "Samuel's own" },
        "g10m9s2-1:Ex9-2:4": { verdict: "accept", auto: true, by: "auto-pass G2 (AI recommendation)" },
        "g10m10s1-1:Ex10-1:1": { verdict: "hold", auto: true, by: "auto-pass G2 (AI recommendation)" },
      },
    },
    "services/extraction/runs/g10-math/g2.json",
    "g10-math",
    T
  );
  assert.deepEqual(
    mixed.map((r) => [r.ref, r.chapter, r.decisions.length]),
    [
      ["g10-math/g2-ch09", 9, 1],
      ["g10-math/g2-ch10", 10, 1],
    ]
  );
  const human = parseAutoFile(
    { by: "Samuel", items: { "g10m8s1-1:Ex8-1:2": { verdict: "fix" } } },
    "services/extraction/runs/g10-math/g2.json",
    "g10-math",
    T
  );
  assert.deepEqual(human, [], "Samuel's own G2 is not his to sign again");
  assert.deepEqual(parseAutoFile({ by: "Samuel Toma", verdicts: { "q:1": "accept" } }, "g3-ch08.auto.json", "g10-math", T), []);
});

test("a gate record replaces what was read from an auto-pass file for the same gate and chapter", () => {
  const record = parseRecord(RECORD, "gates/g1-ch09.json", T)!;
  const adapted = parseAutoFile({ auto: true, by: "auto-pass G1 (AI recommendation)", links: { x: "approve" } }, "objectives/g1-ch09.auto.json", "g10-math", T)[0]!;
  const other = parseAutoFile({ auto: true, by: "auto-pass G1 (AI recommendation)" }, "objectives/g1-ch10.auto.json", "g10-math", T)[0]!;
  const merged = mergeRecords([adapted, record, other]);
  assert.deepEqual(merged.map((r) => [r.ref, r.origin]), [
    ["g10-math/g1-ch09", "record"],
    ["g10-math/g1-ch10", "auto-file"],
  ]);
});

/* -------------------------------------------------------- the backlog item */

const withFp = (r: GateRecord) => ({ ...r, fingerprint: "a".repeat(32), courseId: "course:us-g10-math-en" });

test("a gate decision is Samuel's: never a stamp, in his queue, anyone else reads it under 'For Samuel'", () => {
  const r = parseRecord(RECORD, "gates/g1-ch09.json", T)!;
  const item = deriveGate(withFp(r), { moduleId: "module:g10m-c09", catalogueRank: 120 });
  assert.equal(item.kind, "gate_decision");
  assert.equal(item.assignee, "samuel");
  assert.equal(item.humanStamped, false, "an auto-pass is never a human stamp");
  assert.equal(item.moduleId, "module:g10m-c09");
  assert.equal(item.reasons[0]!.code, "auto_passed");

  const open = [resolveItem(item, null)];
  const none = new Set<string>();
  assert.equal(pickCandidates(open, {}, { heldByOthers: none }).length, 0, "not in Tamer's queue");
  assert.equal(pickCandidates(open, parseFilters({ for: "samuel" }), { heldByOthers: none }).length, 1, "readable under For Samuel");
  assert.equal(pickCandidates(open, {}, { heldByOthers: none, viewerIsOwner: true }).length, 1, "in Samuel's queue");

  const rejected = resolveItem(item, {
    id: 9,
    decision: "reject",
    fingerprint: "a".repeat(32),
    operatorName: "samuel.s.toma",
    decidedAt: T,
    note: "re-run G1 for chapter 9 with the mappers fixed",
    suggestedCorrection: null,
  });
  assert.equal(rejected.state, "rejected");
  assert.equal(onFixList(rejected), "reject", "the pipeline has to act on a rejected gate");
});

/* -------------------------------------------------------- reading the files */

const ROOT = mkdtempSync(path.join(tmpdir(), "review-gate-runs-"));
after(() => rmSync(ROOT, { recursive: true, force: true }));

test("the files are read from runs/<book>/ for maths books only, fingerprinted by content", async () => {
  const runs = path.join(ROOT, "services", "extraction", "runs");
  mkdirSync(path.join(runs, "g10-math", "gates"), { recursive: true });
  mkdirSync(path.join(runs, "g10-math", "objectives"), { recursive: true });
  mkdirSync(path.join(runs, "prep3-social-ar", "gates"), { recursive: true });
  writeFileSync(path.join(runs, "g10-math", "gates", "g1-ch09.json"), JSON.stringify(RECORD));
  writeFileSync(
    path.join(runs, "g10-math", "objectives", "g1-ch10.auto.json"),
    JSON.stringify({ auto: true, by: "auto-pass G1 (AI recommendation)", links: { "lo:a>lo:b": "approve" } })
  );
  writeFileSync(path.join(runs, "g10-math", "gates", "broken.json"), "{ not json");
  writeFileSync(
    path.join(runs, "prep3-social-ar", "gates", "g1.json"),
    JSON.stringify({ ...RECORD, book: "prep3-social-ar", id: "g1-social" })
  );

  const records = await readGateRecords(runs);
  assert.deepEqual(records.map((r) => r.ref).sort(), ["g10-math/g1-ch09", "g10-math/g1-ch10"]);
  const ch09 = records.find((r) => r.ref === "g10-math/g1-ch09")!;
  assert.equal(ch09.courseId, "course:us-g10-math-en");
  assert.match(ch09.fingerprint, /^[0-9a-f]{32}$/);
  assert.equal(ch09.source, "services/extraction/runs/g10-math/gates/g1-ch09.json");

  writeFileSync(path.join(runs, "g10-math", "gates", "g1-ch09.json"), JSON.stringify({ ...RECORD, summary: "re-run" }));
  const again = (await readGateRecords(runs)).find((r) => r.ref === "g10-math/g1-ch09")!;
  assert.notEqual(again.fingerprint, ch09.fingerprint, "a re-run that rewrites the decision reopens it");
});
