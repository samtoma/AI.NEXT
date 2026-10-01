/**
 * THE STEP-LEVEL CHECKER'S FLAGS IN THE REVIEW GATE (FR-4411 → FR-4501;
 * migration 039; `lib/review-gate-working.ts`, `lib/review-gate-files.ts`).
 *
 *   · **Only the canonical `chNN.flags.json` is backlog material.** A
 *     calibration copy (`ch08-cal.flags.json`, `ch08-cal-b5h.flags.json`), a raw
 *     run file and a truth file are measurements of the checker, never findings
 *     about the book — and a file that is not the checker's format, or another
 *     book's, or not a maths book's, is skipped.
 *   · **One item per flagged solution**, all its flags kept, in step order; a
 *     flag the checker wrote before `where` existed (sw-v1) reads as a fault in
 *     the working; a flag that names nothing readable is dropped, not guessed.
 *   · **The calibration truth file classes a flag** (REAL / REAL-BUT-ELSEWHERE /
 *     FALSE, with its evidence) so a false alarm reads as one — and decides
 *     nothing.
 *   · **Decisions**: "Not an error" is `approve`, "Fix needed" is
 *     `fix_requested`, and `reject` is not offered; a flag changes no content.
 *   · **A correction that lands reopens the item** (the fingerprint covers the
 *     solution's text and what was flagged in it) and drops it off the fix list;
 *     the checker rewording itself does not.
 *   · **The numbered working is the checker's numbering** — position, not the
 *     stored `step` field; a worked example's problem is not a step.
 *   · **What the pipeline writes is what the console reads**: the real
 *     Chapter 8 file parses with nothing dropped.
 *
 * The same rules against a real Postgres are `review-gate-db.test.mts`.
 *
 * @covers FR-2204
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { readWorkingFlags, workingFlagFingerprint } from "./review-gate-files.ts";
import {
  CALIBRATION_FORMAT,
  WORKING_CHECK_FORMAT,
  calibrationFileFor,
  canonicalFlagsChapter,
  flagsKey,
  groupFlags,
  parseCalibration,
  parseFlagsFile,
  quoteInStep,
  workingTextOf,
} from "./review-gate-working.ts";
import {
  ITEM_KINDS,
  KIND_LABEL,
  REASON_LABEL,
  canDecide,
  decisionButton,
  decisionEffect,
  decisionLabel,
  deriveWorkingFlag,
  isOutstanding,
  onFixList,
  pickCandidates,
  resolveItem,
  summarize,
  type LatestDecision,
  type WorkingFlagRow,
} from "./review-gate.ts";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const G10 = "course:us-g10-math-en";
const T0 = "2026-09-26T16:14:07.740Z";
const T1 = "2026-10-01T12:00:00.000Z";

/* ------------------------------------------------------------ fixtures */

/** A flags file as `working_check.py collect` writes it — sw-v1: no `where` on a flag. */
const FLAGS_V1 = {
  format: WORKING_CHECK_FORMAT,
  book: "g10-math",
  chapter: 8,
  prompts_version: "sw-v1",
  rule: "Each flag is a backlog item for a human. Nothing here was corrected.",
  solutions: 192,
  skipped: [{ id: "expl:g10m8s1-1-1:ex8-6-4a", why: "no working to check (the solution is a drawing)" }],
  verdicts: { consistent: 169, flagged: 21, unclear: 2 },
  flags: [
    {
      solution_id: "expl:g10m8s3-2-2:ex8-6-26",
      lo: "lo:g10m8s3-2-2",
      step: 5,
      kind: "label",
      quote: "PR\\perp QR",
      expected: "PQ\\perp QR",
      why: "Step 4's product shows PQ is perpendicular to QR.",
      sources: ["agent"],
    },
    {
      solution_id: "expl:g10m8s3-2-2:ex8-6-26",
      lo: "lo:g10m8s3-2-2",
      step: 4,
      kind: "label",
      quote: "m_{PR}\\times m_{QR}",
      expected: "m_{PQ}\\times m_{QR}",
      why: "The values substituted are m_PQ and m_QR.",
      sources: ["agent", "numeric"],
      numeric: { left: "-1/7 × 7", relation: "=", right: "-1", why: "holds" },
    },
    {
      solution_id: "q:g10m8s2-1-1:we01",
      lo: "lo:g10m8s2-1-1",
      step: 5,
      kind: "label",
      quote: "S and $T$",
      expected: "S and $Q$",
      why: "The question names S and Q; the working says T.",
      sources: ["agent"],
    },
    // dropped, never guessed: no readable solution id; a step that is not a whole number
    { solution_id: "somewhere:else", step: 1, kind: "other", quote: "x", why: "y" },
    { solution_id: "q:g10m8s2-1-1:we02", step: 0, kind: "other", quote: "x", why: "y" },
    { solution_id: "q:g10m8s2-1-1:we02", step: 1.5, kind: "other", quote: "x", why: "y" },
    "not an object",
  ],
  flagged_solutions: 2,
  unclear: [],
  unchecked: [],
  problems: [],
  checked_ids: [],
  runs: ["92e155285bf70af84019dece6fa5c8aab0bdff9febfb2e921cfb38b150652f1f"],
};

/** sw-v2 adds `where`: a stem misprint is a question problem, not a working error. */
const FLAGS_V2 = {
  ...FLAGS_V1,
  prompts_version: "sw-v2",
  flags: [
    { solution_id: "q:g10m8s2-1-1:we01", step: 2, kind: "other", where: "question", quote: "S and $T$", expected: "", why: "the stem misprints Q as T", sources: ["agent"] },
    { solution_id: "q:g10m8s2-1-1:we01", step: 3, kind: "arithmetic", where: "unsure", quote: "d=", expected: "", why: "cannot tell", sources: ["agent"] },
    { solution_id: "q:g10m8s2-1-1:we01", step: 4, kind: "sign", where: "no-such-place", quote: "-2", expected: "", why: "w", sources: ["numeric"] },
  ],
};

/** The truth file beside a chapter's flags. */
const CALIBRATION = {
  format: CALIBRATION_FORMAT,
  book: "g10-math",
  chapter: 8,
  source_run: "wf_957393ec-d74 (prompts sw-v1), runs/g10-math/working-check/ch08.flags.json",
  classified_on: "2026-10-01",
  classified_by: "qa-engineer, each flag read against the book's own equation images",
  labels: [
    { solution_id: "expl:g10m8s3-2-2:ex8-6-26", step: 4, verdict: "REAL", evidence: "The book's image prints m_PR; faithful transcription." },
    { solution_id: "q:g10m8s2-1-1:we01", step: 5, verdict: "FALSE", evidence: "The question is about S and T; the checker misread it." },
    { solution_id: "q:g10m8s2-1-1:we01", step: 9, verdict: "REAL-BUT-ELSEWHERE", evidence: "a step this run did not flag" },
    { solution_id: "q:g10m8s2-1-1:we01", step: 1, verdict: "MAYBE", evidence: "not a class" },
    { solution_id: "nonsense", step: 1, verdict: "REAL", evidence: "not a solution" },
  ],
};

const read = (raw: unknown, chapter: number | null = 8) => parseFlagsFile(raw, "g10-math", chapter);
/** One of the fixture's flags, to copy into another file (`FLAGS_V1.flags` also holds the malformed ones). */
const flag = (i: number) => FLAGS_V1.flags[i] as Record<string, unknown>;

/* ------------------------------------------------------------ which files */

test("only the canonical chNN.flags.json is backlog material", () => {
  assert.equal(canonicalFlagsChapter("ch08.flags.json"), 8);
  assert.equal(canonicalFlagsChapter("ch12.flags.json"), 12);
  for (const not of [
    "ch08-cal.flags.json", // a calibration copy
    "ch08-cal-b5h.flags.json",
    "ch08-wf_957393ec-d74.json", // a raw run file
    "ch08.calibration.json", // the truth file
    "ch8.flags.json",
    "ch008.flags.json",
    "flags.json",
    "ch08.flags.json.bak",
  ]) {
    assert.equal(canonicalFlagsChapter(not), null, not);
  }
  assert.equal(calibrationFileFor(8), "ch08.calibration.json");
  assert.equal(calibrationFileFor(12), "ch12.calibration.json");
});

const ROOT = mkdtempSync(path.join(tmpdir(), "review-gate-working-"));
after(() => rmSync(ROOT, { recursive: true, force: true }));

test("the folder is read for maths books, canonical files only, with the truth file beside them", async () => {
  const runs = path.join(ROOT, "services", "extraction", "runs");
  const dir = path.join(runs, "g10-math", "working-check");
  mkdirSync(dir, { recursive: true });
  mkdirSync(path.join(runs, "prep3-social-ar", "working-check"), { recursive: true });
  const put = (file: string, doc: unknown) => writeFileSync(path.join(dir, file), typeof doc === "string" ? doc : JSON.stringify(doc));

  put("ch08.flags.json", FLAGS_V1);
  put("ch08.calibration.json", CALIBRATION);
  // calibration experiments flag OTHER things on the same chapter — none of it is a finding about the book
  put("ch08-cal.flags.json", { ...FLAGS_V1, flags: [{ ...flag(0), solution_id: "q:g10m8s9-9-9:from-a-calibration-copy" }] });
  put("ch08-cal-b5h.flags.json", { ...FLAGS_V1, flags: [{ ...flag(0), solution_id: "q:g10m8s9-9-9:from-another-copy" }] });
  put("ch08-wf_957393ec-d74.json", { stage: "SW", results: [{ solution_id: "q:g10m8s9-9-9:from-a-raw-run", verdict: "flagged" }] });
  put("ch09.flags.json", { ...FLAGS_V1, chapter: 9, book: "some-other-book" }); // another book's
  put("ch10.flags.json", "{ not json"); // unreadable
  put("ch11.flags.json", { ...FLAGS_V1, format: "ainext.something-else/1" }); // not the checker's
  put("ch12.flags.json", { ...FLAGS_V1, chapter: 12, flags: [{ ...flag(2), solution_id: "q:g10m12s1-1-1:ex12-1" }] }); // no truth file beside it
  // a book that is not maths has its own review queue
  writeFileSync(path.join(runs, "prep3-social-ar", "working-check", "ch01.flags.json"), JSON.stringify({ ...FLAGS_V1, book: "prep3-social-ar" }));

  const groups = await readWorkingFlags(runs);
  assert.deepEqual(
    groups.map((g) => g.ref).sort(),
    ["expl:g10m8s3-2-2:ex8-6-26", "q:g10m12s1-1-1:ex12-1", "q:g10m8s2-1-1:we01"],
    "the canonical files only, one group per flagged solution"
  );
  const ch08 = groups.filter((g) => g.chapter === 8);
  assert.ok(ch08.every((g) => g.source === "services/extraction/runs/g10-math/working-check/ch08.flags.json"));
  assert.ok(ch08.every((g) => g.courseId === G10 && g.book === "g10-math" && g.promptsVersion === "sw-v1"));
  const we01 = groups.find((g) => g.ref === "q:g10m8s2-1-1:we01")!;
  assert.equal(we01.flags[0]!.calibration?.verdict, "FALSE", "the truth file beside the chapter classes it");
  assert.equal(we01.calibration?.source, "services/extraction/runs/g10-math/working-check/ch08.calibration.json");
  const ch12 = groups.find((g) => g.chapter === 12)!;
  assert.equal(ch12.calibration, null, "no truth file, no classification");
  assert.equal(ch12.flags[0]!.calibration, undefined);

  // a folder that is not there is not an error
  assert.deepEqual(await readWorkingFlags(path.join(ROOT, "nothing", "here", "runs")), []);
});

/* ------------------------------------------------------------ the item */

test("one group per flagged solution: every flag kept, in step order; an sw-v1 flag reads as the working", () => {
  const file = read(FLAGS_V1)!;
  assert.equal(file.flags.length, 3, "a flag that names nothing readable is dropped, not guessed");
  const groups = groupFlags(file, G10, "services/extraction/runs/g10-math/working-check/ch08.flags.json", null, null);
  assert.deepEqual(groups.map((g) => [g.ref, g.solutionKind, g.flags.map((f) => f.step)]), [
    ["expl:g10m8s3-2-2:ex8-6-26", "worked_example", [4, 5]],
    ["q:g10m8s2-1-1:we01", "question", [5]],
  ]);
  assert.ok(groups.every((g) => g.flags.every((f) => f.where === "working")), "sw-v1 has no `where`: the working");
  assert.equal(groups[0]!.promptsVersion, "sw-v1");
  assert.deepEqual(groups[0]!.runs, ["92e155285bf70af84019dece6fa5c8aab0bdff9febfb2e921cfb38b150652f1f"]);
  assert.deepEqual(groups[0]!.flags[0]!.numeric, { left: "-1/7 × 7", relation: "=", right: "-1", why: "holds" });
  assert.deepEqual(groups[0]!.flags[0]!.sources, ["agent", "numeric"]);
  assert.equal(groups[0]!.lo, "lo:g10m8s3-2-2");
  assert.equal(groups[0]!.calibration, null);
});

test("a file that is not the checker's, or another book's, is no flags file", () => {
  assert.equal(read({ ...FLAGS_V1, format: "ainext.working-check/2" }), null);
  assert.equal(read(null), null);
  assert.equal(read([]), null);
  assert.equal(read({ ...FLAGS_V1, book: "prep3-math-en" }), null);
  assert.equal(parseFlagsFile(FLAGS_V1, "../escape", 8), null);
  assert.equal(read({ ...FLAGS_V1, chapter: undefined }, 8)!.chapter, 8, "the file's name supplies the chapter");
  assert.equal(read({ ...FLAGS_V1, flags: "nope" })!.flags.length, 0);
});

test("sw-v2: where the fault sits is kept; an unknown place reads as the working", () => {
  const groups = groupFlags(read(FLAGS_V2)!, G10, "x", null, null);
  assert.deepEqual(groups[0]!.flags.map((f) => [f.step, f.where]), [[2, "question"], [3, "unsure"], [4, "working"]]);
  assert.equal(groups[0]!.promptsVersion, "sw-v2");
});

test("the calibration truth file classes a flag by solution and step — and decides nothing", () => {
  const cal = parseCalibration(CALIBRATION)!;
  assert.equal(cal.labels.size, 3, "an unknown class and a non-solution are not labels");
  assert.equal(cal.promptsVersion, "sw-v1");
  assert.equal(cal.classifiedOn, "2026-10-01");
  assert.match(cal.classifiedBy ?? "", /^qa-engineer/);
  assert.equal(parseCalibration({ ...CALIBRATION, format: "x" }), null);

  const groups = groupFlags(read(FLAGS_V1)!, G10, "src", cal, "cal-src");
  const label = (ref: string, step: number) => groups.find((g) => g.ref === ref)!.flags.find((f) => f.step === step)!.calibration;
  assert.equal(label("expl:g10m8s3-2-2:ex8-6-26", 4)?.verdict, "REAL");
  assert.equal(label("expl:g10m8s3-2-2:ex8-6-26", 5), undefined, "a flag the truth file does not class stays unclassified");
  assert.equal(label("q:g10m8s2-1-1:we01", 5)?.verdict, "FALSE");
  assert.match(label("q:g10m8s2-1-1:we01", 5)!.evidence, /misread/);
  assert.equal(groups[0]!.calibration?.sourceRun, CALIBRATION.source_run);
  assert.equal(groups[0]!.calibration?.promptsVersion, "sw-v1");

  // a FALSE classification is evidence, never a review: the item is exactly as open as any other
  const row = rowFor(groups.find((g) => g.ref === "q:g10m8s2-1-1:we01")!, "h".repeat(32));
  assert.equal(resolveItem(deriveWorkingFlag(row), null).state, "open");
});

/* ------------------------------------------------------------ derivation */

const rowFor = (g: { ref: string; flags: { step: number; where: "working" | "question" | "unsure" }[]; promptsVersion: string | null }, fingerprint: string): WorkingFlagRow => ({
  ref: g.ref,
  course_id: G10,
  module_id: "module:g10m-c08",
  catalogue_rank: 8,
  lo_id: "lo:g10m8s3-2-2",
  fingerprint,
  created_at: T0,
  flags: g.flags.map((f) => ({ step: f.step, where: f.where })),
  promptsVersion: g.promptsVersion,
});

test("a flagged solution derives to one open item that no machine can close", () => {
  const item = deriveWorkingFlag(rowFor({ ref: "expl:g10m8s3-2-2:ex8-6-26", flags: [{ step: 4, where: "working" }, { step: 5, where: "working" }], promptsVersion: "sw-v1" }, "a".repeat(32)));
  assert.equal(item.kind, "working_flag");
  assert.equal(item.ref, "expl:g10m8s3-2-2:ex8-6-26");
  assert.equal(item.humanStamped, false, "a checker's flag is never a human stamp");
  assert.equal(item.exposure, "content");
  assert.equal(item.createdAt, T0);
  assert.equal(item.moduleId, "module:g10m-c08");
  assert.deepEqual(item.reasons.map((r) => r.code), ["working_flagged"]);
  assert.match(item.reasons[0]!.detail!, /steps 4, 5 .*sw-v1/);
  assert.equal(resolveItem(item, null).state, "open");
  assert.equal(item.assignee, undefined, "any reviewer decides it");
  assert.equal(KIND_LABEL.working_flag, "Working step flagged");
  assert.equal(REASON_LABEL.working_flagged, "Checker flagged a step");
  assert.notEqual(REASON_LABEL.working_flagged, KIND_LABEL.working_flag, "the header does not say the same words twice");
});

test("where the checker puts the fault: a stem misprint reads as a question problem", () => {
  const q = deriveWorkingFlag(rowFor({ ref: "q:a", flags: [{ step: 2, where: "question" }], promptsVersion: "sw-v2" }, "b".repeat(32)));
  assert.deepEqual(q.reasons.map((r) => r.code), ["question_flagged"]);
  assert.match(q.reasons[0]!.detail!, /question text/);
  const mixed = deriveWorkingFlag(
    rowFor({ ref: "q:b", flags: [{ step: 1, where: "working" }, { step: 3, where: "question" }, { step: 3, where: "unsure" }], promptsVersion: null }, "c".repeat(32))
  );
  assert.deepEqual(mixed.reasons.map((r) => r.code), ["working_flagged", "question_flagged"]);
  assert.match(mixed.reasons[0]!.detail!, /unsure/);
  assert.doesNotMatch(mixed.reasons[0]!.detail!, /\(checker /, "no version, none said");
});

/* ------------------------------------------------------------ decisions */

const decided = (over: Partial<LatestDecision>): LatestDecision => ({
  id: 7,
  decision: "approve",
  fingerprint: "a".repeat(32),
  operatorName: "Tamer",
  decidedAt: T1,
  note: null,
  suggestedCorrection: null,
  ...over,
});

test("the three decisions on a flag: Not an error, Fix needed — and no reject", () => {
  assert.deepEqual(canDecide("working_flag", "approve"), { ok: true });
  assert.deepEqual(canDecide("working_flag", "fix_requested"), { ok: true });
  const reject = canDecide("working_flag", "reject");
  assert.equal(reject.ok, false);
  assert.match(!reject.ok ? reject.why : "", /nothing to retire/);
  // …and no other kind lost its reject, or gained a refusal
  for (const kind of ITEM_KINDS.filter((k) => k !== "working_flag")) assert.equal(canDecide(kind, "reject").ok, true, kind);

  assert.equal(decisionButton("working_flag", "approve"), "Not an error");
  assert.equal(decisionButton("working_flag", "fix_requested"), "Fix needed");
  assert.equal(decisionLabel("working_flag", "approve"), "Marked not an error");
  assert.equal(decisionLabel("working_flag", "fix_requested"), "Fix needed");
  // every other kind reads as it did
  assert.equal(decisionButton("book_question", "approve"), "Approve");
  assert.equal(decisionButton("book_question", "fix_requested"), "Needs fix");
  assert.equal(decisionButton("figure_stand_in", "fix_requested"), "Needs native figure");
  assert.equal(decisionLabel("book_question", "reject"), "Rejected");

  assert.match(decisionEffect("working_flag", "approve"), /nothing is wrong .*Nothing changes for students/);
  assert.match(decisionEffect("working_flag", "fix_requested"), /Nothing changes for students.*fix list/);
});

test("Not an error records it; Fix needed puts the solution on the fix list; neither is a retirement", () => {
  const item = deriveWorkingFlag(rowFor({ ref: "q:g10m8s2-1-1:we01", flags: [{ step: 5, where: "working" }], promptsVersion: "sw-v1" }, "d".repeat(32)));

  const dismissed = resolveItem(item, decided({ decision: "approve", fingerprint: item.fingerprint }));
  assert.equal(dismissed.state, "approved");
  assert.equal(onFixList(dismissed), null);
  assert.equal(isOutstanding(dismissed), false);

  const fix = resolveItem(item, decided({ decision: "fix_requested", fingerprint: item.fingerprint, note: "Step 5: T should be Q", suggestedCorrection: "$S$ and $Q$" }));
  assert.equal(fix.state, "fix_requested");
  assert.equal(onFixList(fix), "fix");
  assert.equal(isOutstanding(fix), true, "still owed to zero backlog");

  // an item waiting on a fix is not offered again; a dismissed one is not either
  const none = new Set<string>();
  assert.equal(pickCandidates([fix, dismissed], {}, { heldByOthers: none }).length, 0);
  assert.equal(pickCandidates([resolveItem(item, null)], { kind: "working_flag" }, { heldByOthers: none }).length, 1);
  assert.equal(pickCandidates([resolveItem(item, null)], { kind: "book_question" }, { heldByOthers: none }).length, 0);
  assert.equal(pickCandidates([resolveItem(item, null)], { reason: "working_flagged" }, { heldByOthers: none }).length, 1);

  // the tallies carry the kind
  const s = summarize([resolveItem(item, null), fix, dismissed]);
  assert.deepEqual(s.byKind.working_flag, { open: 1, fixRequested: 1, approved: 1, rejected: 0, total: 3 });
  assert.equal(s.openByReason.working_flagged, 1);
});

/* ------------------------------------------------------------ the fingerprint */

const FLAGS = [
  { step: 4, kind: "label", where: "working" as const, quote: "m_{PR}\\times m_{QR}" },
  { step: 5, kind: "label", where: "working" as const, quote: "PR\\perp QR" },
];

test("the fingerprint covers the solution's text and what was flagged — not how the checker worded it", () => {
  const base = workingFlagFingerprint("s".repeat(32), FLAGS);
  assert.match(base, /^[0-9a-f]{32}$/);
  assert.equal(workingFlagFingerprint("s".repeat(32), [...FLAGS].reverse()), base, "order is not content");
  assert.equal(
    workingFlagFingerprint("s".repeat(32), FLAGS.map((f) => ({ ...f, quote: f.quote.replace("\\times", " \\times ") }))),
    base,
    "LaTeX re-spacing is not a different quote"
  );
  assert.notEqual(workingFlagFingerprint("t".repeat(32), FLAGS), base, "a correction to the solution's text");
  assert.notEqual(workingFlagFingerprint("s".repeat(32), FLAGS.slice(0, 1)), base, "a flag the checker no longer raises");
  assert.notEqual(workingFlagFingerprint("s".repeat(32), [...FLAGS, { step: 6, kind: "sign", where: "working", quote: "-" }]), base, "a new flag");
  assert.notEqual(workingFlagFingerprint("s".repeat(32), [{ ...FLAGS[0]!, where: "question" }, FLAGS[1]!]), base, "a step blamed on the question instead");
  assert.notEqual(workingFlagFingerprint("s".repeat(32), [{ ...FLAGS[0]!, step: 3 }, FLAGS[1]!]), base, "another step");
  assert.equal(flagsKey(FLAGS), flagsKey([...FLAGS].reverse()));
});

test("a correction that lands reopens a decided item and takes it off the fix list by itself", () => {
  const before = deriveWorkingFlag(rowFor({ ref: "expl:g10m8s3-2-2:ex8-6-26", flags: [{ step: 4, where: "working" }], promptsVersion: "sw-v1" }, "a".repeat(32)));
  const fix = decided({ decision: "fix_requested", fingerprint: before.fingerprint, note: "Step 4: m_{PQ}" });
  assert.equal(onFixList(resolveItem(before, fix)), "fix");

  // the same item once its solution's text has changed: a different fingerprint
  const after = deriveWorkingFlag(rowFor({ ref: "expl:g10m8s3-2-2:ex8-6-26", flags: [{ step: 4, where: "working" }], promptsVersion: "sw-v1" }, "e".repeat(32)));
  const reopened = resolveItem(after, fix);
  assert.equal(reopened.state, "open");
  assert.equal(onFixList(reopened), null, "it leaves the fix list by itself");
  assert.equal(reopened.reasons[0]!.code, "changed_since_decision");
  assert.match(reopened.reasons[0]!.detail!, /Tamer asked for a fix it on 2026-10-01; it has changed since/);
  assert.equal(reopened.reasons[1]!.code, "working_flagged", "and still says why it was flagged");

  // a dismissed flag is re-read too: a reviewer said "not an error" about text that has since moved on
  const dismissed = decided({ decision: "approve", fingerprint: before.fingerprint });
  assert.equal(resolveItem(before, dismissed).state, "approved");
  assert.equal(resolveItem(after, dismissed).state, "open");
});

/* ------------------------------------------------------------ the numbered working */

test("the working is numbered the way the checker numbers it — by position, the problem is not a step", () => {
  const example = workingTextOf([
    { kind: "problem", text_md: "Find $m$." },
    { step: 1, text_md: "a" },
    { step: 2, text_md: "" },
    { step: 7, text_md: "c" }, // the stored `step` field does not matter: it is the third line
  ]);
  assert.equal(example.problem, "Find $m$.");
  assert.deepEqual(example.steps, ["a", "", "c"], "an empty step keeps its number");

  assert.deepEqual(workingTextOf({ steps: [{ text_md: "x" }] }), { problem: null, steps: ["x"] });
  assert.deepEqual(workingTextOf(null), { problem: null, steps: [] });
  assert.deepEqual(workingTextOf({ unexpected: "an object, not a list" }), { problem: null, steps: [] });
  assert.deepEqual(workingTextOf(["not", "objects"]), { problem: null, steps: [] });

  assert.equal(quoteInStep("$m_{PR}\\times m_{QR}&=-1$", "m_{PR}\\times  m_{QR}"), true, "whitespace aside, exactly");
  assert.equal(quoteInStep("$m_{PQ}\\times m_{QR}$", "m_{PR}\\times m_{QR}"), false, "a correction landed");
  assert.equal(quoteInStep(undefined, "x"), false);
  assert.equal(quoteInStep("x", ""), false);
});

/* ------------------------------------------------------------ the real files */

test("what the pipeline writes is what the console reads: Chapter 8's real files parse with nothing dropped", () => {
  const dir = path.join(REPO, "services/extraction/runs/g10-math/working-check");
  if (!existsSync(dir)) return; // a checkout without the run files (the production image has none)
  const canonical = readdirSync(dir).filter((f) => canonicalFlagsChapter(f) != null);
  for (const name of canonical) {
    const raw = JSON.parse(readFileSync(path.join(dir, name), "utf8")) as { flags: unknown[]; flagged_solutions: number };
    const file = parseFlagsFile(raw, "g10-math", canonicalFlagsChapter(name));
    assert.ok(file, `${name} is a flags file`);
    assert.equal(file.flags.length, raw.flags.length, `${name}: every flag is readable`);
    const groups = groupFlags(file, G10, name, null, null);
    assert.equal(groups.length, raw.flagged_solutions, `${name}: one group per flagged solution`);
    assert.ok(groups.every((g) => /^(q|expl):/.test(g.ref)));
  }
  for (const name of readdirSync(dir).filter((f) => /\.calibration\.json$/.test(f))) {
    const raw = JSON.parse(readFileSync(path.join(dir, name), "utf8")) as { labels: unknown[] };
    const cal = parseCalibration(raw);
    assert.ok(cal, `${name} is a calibration file`);
    assert.equal(cal.labels.size, raw.labels.length, `${name}: every label is readable`);
  }
});

/* ------------------------------------------------------------ the database vocabulary */

test("migration 039 admits exactly the kinds the gate has, and its rollback restores 036's", () => {
  const list = (sql: string) => {
    const m = sql.match(/CHECK \(item_kind IN \(([^)]+)\)\)/);
    assert.ok(m, "an item_kind CHECK");
    return [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
  };
  const up = list(readFileSync(path.join(REPO, "db/migrations/039-review-gate-working-flag.sql"), "utf8"));
  assert.deepEqual([...up].sort(), [...ITEM_KINDS].sort(), "ITEM_KINDS and the database's list are one vocabulary");
  const down = list(readFileSync(path.join(REPO, "db/migrations/rollback/039-review-gate-working-flag.down.sql"), "utf8"));
  assert.deepEqual([...down].sort(), ITEM_KINDS.filter((k) => k !== "working_flag").sort());
  const sql = readFileSync(path.join(REPO, "db/migrations/039-review-gate-working-flag.sql"), "utf8");
  assert.doesNotMatch(sql.replace(/--.*$/gm, ""), /GRANT|ainext_app\s+TO/i, "no grant: a flag has no effect on content");
  assert.match(sql, /ainext_app holds a privilege on review_decisions/);
});
