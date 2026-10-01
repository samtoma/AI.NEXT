/**
 * THE CONSOLE REVIEW GATE — the rules, on fixtures (migration 036; Samuel's
 * answers 33 and 37; `lib/review-gate.ts`).
 *
 *   · **Only a human stamp counts** (answer 33): every stamp the pilot
 *     database actually carries, classified — AI checks, bulk and dev
 *     promotions and the fan-out's auto-pass are NOT reviews; a G2 stamp, a
 *     sampled or family stamp and an operator's name ARE; a human stamp a
 *     machine edited afterwards is not a review of the content as it is now.
 *   · **Backlog derivation, per kind**: book, generated and widget questions,
 *     widget claims (active and held under decision 47), misconceptions,
 *     worked examples, objectives, prerequisite links and figure stand-ins.
 *   · **A decision counts only on the content it was made on**: a change
 *     reopens the item, a fix request leaves the fix list once the item
 *     changed, a decision a reload undid is open again.
 *   · **The queue**: oldest first in book order, never an item another
 *     reviewer holds, the reviewer's own claim first.
 *   · **Widget claim effects**: approve moves a held claim into `diagnostics`,
 *     reject takes an active one out, and a predicate never names two
 *     misconceptions.
 *   · **Permission**: `content-review` alone admits the page and its two
 *     endpoints; any other role, a student and anonymous are refused.
 *   · **Students never see review status**: no student surface imports the
 *     gate, its three addresses are console-only, and migration 036 gives
 *     the student role nothing.
 *
 * The same rules against a real Postgres — claims, decisions, stamps, RLS —
 * are `review-gate-db.test.mts`.
 *
 * @covers FR-2204
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { checkRequirement } from "./auth/authorize.ts";
import { ALL_ROLES, CONSOLE_ROUTES, consoleRoute, routeAdmits } from "./console-routes.ts";
import {
  canDecide,
  changedAfterHumanReview,
  claimRef,
  compareItems,
  deriveClaim,
  deriveContent,
  deriveQuestion,
  doneShare,
  isHumanStamp,
  itemKey,
  onFixList,
  parseClaimRef,
  parseFilters,
  pickCandidates,
  planClaimApprove,
  planClaimReject,
  questionKind,
  resolveItem,
  stampKind,
  stepsOf,
  summarize,
  type ClaimRow,
  type ContentRow,
  type DerivedItem,
  type LatestDecision,
  type QuestionRow,
} from "./review-gate.ts";

const SRC = fileURLToPath(new URL("../", import.meta.url));
const REPO = fileURLToPath(new URL("../../../", import.meta.url));

/* ------------------------------------------------------------ fixtures */

const G10 = "course:us-g10-math-en";
const P3 = "course:prep3-math-en";
const T0 = "2026-09-26T16:14:07.740Z";
const T1 = "2026-09-30T10:00:00.000Z";

function qrow(over: Partial<QuestionRow>): QuestionRow {
  return {
    id: "q:g10m8s3-1-1:ex8-6-32a",
    course_id: G10,
    module_id: "module:g10m-c08",
    module_order: 8,
    lo_id: "lo:g10m8s3-1-1",
    question_type: "short",
    source: "seed",
    status: "live",
    reviewed_by: null,
    ai_checked_by: null,
    hold_reason: null,
    review_note: null,
    fingerprint: "a".repeat(32),
    created_at: T0,
    ...over,
  };
}

function crow(over: Partial<ClaimRow>): ClaimRow {
  return {
    question_id: "q:g10m8s2-1-2:w001",
    course_id: G10,
    module_id: "module:g10m-c08",
    module_order: 8,
    lo_id: "lo:g10m8s2-1-2",
    predicate: "extra-values",
    misconception_id: "mc:g10m8s2-1-2:keeps-both-roots-ignores-restriction",
    state: "held",
    why: "There is no restriction in this question to ignore.",
    fingerprint: "c".repeat(32),
    created_at: T0,
    ...over,
  };
}

function content(over: Partial<ContentRow>): ContentRow {
  return {
    ref: "mc:g10m8s1-1-2:flips-a-coordinate-sign",
    course_id: G10,
    module_id: "module:g10m-c08",
    module_order: 8,
    lo_id: "lo:g10m8s1-1-2",
    fingerprint: "d".repeat(32),
    created_at: T0,
    ...over,
  };
}

const decision = (over: Partial<LatestDecision>): LatestDecision => ({
  id: 1,
  decision: "approve",
  fingerprint: "a".repeat(32),
  operatorName: "samuel.s.toma",
  decidedAt: T1,
  note: null,
  suggestedCorrection: null,
  ...over,
});

/* ---------------------------------------------------- what is reviewed */

test("only a human stamp is a review — every stamp the pilot database carries (answer 33)", () => {
  const cases: [string | null, "none" | "ai" | "bulk" | "human"][] = [
    [null, "none"],
    ["", "none"],
    ["ai dual-check (pending Samuel)", "ai"],
    ["ai dual-check (pending Samuel) [held: figure missing]", "ai"],
    ["ai dual-check", "ai"],
    ["auto-pass G3 (AI recommendation)", "ai"],
    ["local-dev (pilot scratch)", "bulk"],
    ["local-dev (dry run)", "bulk"],
    ["samuel (poc bulk)", "bulk"],
    ["Samuel Toma (G2 fix)", "human"],
    ["Samuel Toma (G2 accept); held: its figure is missing", "human"],
    ["Samuel Toma (sampled)", "human"],
    ["Samuel Toma (family tpl:u3-2-1:range via q:u3-2-1:g009-range)", "human"],
    ["samuel.s.toma", "human"],
  ];
  for (const [stamp, kind] of cases) {
    assert.equal(stampKind(stamp), kind, `${JSON.stringify(stamp)} is ${kind}`);
    assert.equal(isHumanStamp(stamp), kind === "human");
  }
});

test("the classification is migration 035's, so the database and the console agree", () => {
  const sql = readFileSync(path.join(REPO, "db/migrations/035-human-review-stamps.sql"), "utf8");
  for (const pattern of ["'^ai '", "'\\(pending [^)]*\\)$'", "'^local-dev'", "'\\(poc bulk\\)$'"]) {
    assert.ok(sql.includes(pattern), `035 classifies with ${pattern}`);
  }
});

test("a human stamp a machine edited afterwards does not cover the content as it is now", () => {
  assert.equal(
    changedAfterHumanReview("stem fixed by orchestrator (data-engineer agent), 2026-09-27 — not Samuel"),
    true
  );
  assert.equal(changedAfterHumanReview("held: its figure is missing"), false);
  assert.equal(changedAfterHumanReview("promoted without review: local-dev (pilot scratch)"), false);
  assert.equal(changedAfterHumanReview(null), false);
});

/* ---------------------------------------------------- derivation, kind by kind */

test("a book question checked only by AI is in the backlog as 'AI-checked, awaiting human'", () => {
  const d = deriveQuestion(qrow({ ai_checked_by: "ai dual-check" }))!;
  assert.equal(d.kind, "book_question");
  assert.equal(d.humanStamped, false);
  assert.equal(d.exposure, "live");
  assert.deepEqual(d.reasons, [{ code: "ai_checked", detail: "ai dual-check" }]);
  assert.equal(resolveItem(d, null).state, "open");
});

test("an older loader's AI stamp left in reviewed_by is still not a review", () => {
  const d = deriveQuestion(qrow({ reviewed_by: "ai dual-check (pending Samuel)" }))!;
  assert.equal(d.humanStamped, false);
  assert.equal(d.reasons[0]!.code, "ai_checked");
  const bulk = deriveQuestion(qrow({ reviewed_by: "local-dev (pilot scratch)" }))!;
  assert.equal(bulk.reasons[0]!.code, "promoted_without_review");
  const noted = deriveQuestion(qrow({ review_note: "promoted without review: samuel (poc bulk)" }))!;
  assert.equal(noted.reasons[0]!.code, "promoted_without_review");
});

test("a G2 human stamp is reviewed; the same stamp on a stem the orchestrator fixed is not", () => {
  const g2 = deriveQuestion(qrow({ reviewed_by: "Samuel Toma (G2 fix)" }))!;
  assert.equal(g2.humanStamped, true);
  assert.equal(resolveItem(g2, null).state, "approved");

  const fixed = deriveQuestion(
    qrow({
      reviewed_by: "Samuel Toma (G2 accept)",
      review_note: "stem fixed by orchestrator (data-engineer agent), 2026-09-27 — not Samuel",
    })
  )!;
  assert.equal(fixed.humanStamped, false);
  assert.equal(fixed.reasons[0]!.code, "changed_after_review");
  assert.equal(resolveItem(fixed, null).state, "open");
});

test("generated, widget and blocked questions; retired and rejected ones are not backlog", () => {
  assert.equal(questionKind({ question_type: "mcq", source: "variant" }), "generated_question");
  assert.equal(questionKind({ question_type: "widget", source: "variant" }), "widget_question");
  assert.equal(questionKind({ question_type: "numeric", source: "authored" }), "book_question");

  const gen = deriveQuestion(qrow({ id: "q:g10m8s1-1-3:g002-quad-r", source: "variant", status: "review" }))!;
  assert.equal(gen.kind, "generated_question");
  assert.equal(gen.exposure, "held");
  assert.deepEqual(
    gen.reasons.map((r) => r.code),
    ["unchecked", "blocked"]
  );

  const held = deriveQuestion(qrow({ status: "review", hold_reason: "katex_error", ai_checked_by: "ai dual-check" }))!;
  assert.deepEqual(held.reasons, [
    { code: "ai_checked", detail: "ai dual-check" },
    { code: "blocked", detail: "katex_error" },
  ]);

  for (const status of ["retired", "rejected", "draft"]) {
    assert.equal(deriveQuestion(qrow({ status })), null, `${status} is not in the backlog`);
  }
});

test("widget claims: an active one and one the AI verifier refused (decision 47)", () => {
  const held = deriveClaim(crow({}));
  assert.equal(held.kind, "mapping_claim");
  assert.equal(held.ref, "q:g10m8s2-1-2:w001|extra-values|mc:g10m8s2-1-2:keeps-both-roots-ignores-restriction");
  assert.equal(held.exposure, "inactive");
  assert.equal(held.reasons[0]!.code, "held_mapping");
  assert.match(held.reasons[0]!.detail!, /no restriction/);

  const active = deriveClaim(crow({ state: "active", why: null, predicate: "wrong-quadrant" }));
  assert.equal(active.exposure, "active");
  assert.equal(active.reasons[0]!.code, "active_mapping");

  assert.deepEqual(parseClaimRef(held.ref), {
    questionId: "q:g10m8s2-1-2:w001",
    predicate: "extra-values",
    misconceptionId: "mc:g10m8s2-1-2:keeps-both-roots-ignores-restriction",
  });
  assert.equal(parseClaimRef("no-pipes"), null);
});

test("misconceptions, worked examples, objectives, links and figure stand-ins", () => {
  const s5 = deriveContent(
    "misconception",
    content({ generated_by: "S5 runbook/misconceptions.workflow.js (Sonnet author, Sonnet fail-closed verifier) … UNREVIEWED" })
  );
  assert.equal(s5.reasons[0]!.code, "ai_authored");
  const p3 = deriveContent(
    "misconception",
    content({ course_id: P3, generated_by: "exported from the live comparison database — export_generated_content.py" })
  );
  assert.equal(p3.reasons[0]!.code, "no_human_review");

  const we = deriveContent("worked_example", content({ ref: "we:1", generated_by: "book (book_worked_epub)" }));
  assert.equal(resolveItem(we, null).state, "open");
  const weSigned = deriveContent("worked_example", content({ ref: "we:2", reviewed: true, reviewed_by: "Tamer Deif" }));
  assert.equal(resolveItem(weSigned, null).state, "approved");
  const weAi = deriveContent("worked_example", content({ ref: "we:3", reviewed: true, reviewed_by: "ai dual-check" }));
  assert.equal(resolveItem(weAi, null).state, "open", "a library entry flagged reviewed by an AI is not reviewed");

  assert.equal(deriveContent("objective", content({ ref: "lo:g10m8s1-1-2" })).reasons[0]!.code, "no_human_review");
  assert.equal(
    deriveContent("prerequisite_link", content({ ref: "lo:g10m8s1-1-1>lo:g10m8s1-1-2" })).reasons[0]!.code,
    "no_human_review"
  );

  const fig = deriveContent("figure_stand_in", content({ ref: "v:g10m8:fig-12", question_status: "live" }));
  assert.equal(fig.reasons[0]!.code, "needs_native_figure");
  assert.equal(fig.exposure, "live");
  assert.equal(deriveContent("figure_stand_in", content({ ref: "v:x", question_status: "review" })).exposure, "held");
});

/* ---------------------------------------------------- resolution */

test("a decision counts only on the content it was made on", () => {
  const item = deriveQuestion(qrow({ ai_checked_by: "ai dual-check" }))!;
  assert.equal(resolveItem(item, decision({})).state, "approved");

  const changed = resolveItem(item, decision({ fingerprint: "b".repeat(32) }));
  assert.equal(changed.state, "open");
  assert.equal(changed.reasons[0]!.code, "changed_since_decision");
  assert.match(changed.reasons[0]!.detail!, /samuel\.s\.toma approved it on 2026-09-30/);
});

test("a fix request waits on the pipeline, and comes back once the item has changed", () => {
  const item = deriveQuestion(qrow({ ai_checked_by: "ai dual-check" }))!;
  const fix = decision({ decision: "fix_requested", note: "the key should be -1/3" });
  const waiting = resolveItem(item, fix);
  assert.equal(waiting.state, "fix_requested");
  assert.equal(onFixList(waiting), "fix");

  const fixed = resolveItem({ ...item, fingerprint: "e".repeat(32) }, fix);
  assert.equal(fixed.state, "open");
  assert.equal(onFixList(fixed), null, "a fixed item leaves the fix list by itself");
});

test("a decision a reload undid is open again", () => {
  const live = deriveQuestion(qrow({ ai_checked_by: "ai dual-check" }))!;
  const rejected = decision({ decision: "reject", note: "wrong chapter" });
  const back = resolveItem(live, rejected);
  assert.equal(back.state, "open");
  assert.equal(back.reasons[0]!.code, "reverted");

  const heldQ = deriveQuestion(qrow({ status: "review", hold_reason: "katex_error" }))!;
  assert.equal(resolveItem(heldQ, rejected).state, "rejected", "rejected and still away from students");

  const approvedButHeld = resolveItem(deriveClaim(crow({ fingerprint: "c".repeat(32) })), decision({ fingerprint: "c".repeat(32) }));
  assert.equal(approvedButHeld.state, "open");
  assert.equal(approvedButHeld.reasons[0]!.code, "reverted");

  const rejectedButActive = resolveItem(
    deriveClaim(crow({ state: "active" })),
    decision({ decision: "reject", note: "x", fingerprint: "c".repeat(32) })
  );
  assert.equal(rejectedButActive.state, "open");

  const mc = deriveContent("misconception", content({}));
  const mcRejected = resolveItem(mc, decision({ decision: "reject", note: "duplicate", fingerprint: "d".repeat(32) }));
  assert.equal(mcRejected.state, "rejected");
  assert.equal(onFixList(mcRejected), "reject", "a rejection only the pipeline can carry out is exported");
});

test("a figure stand-in cannot be approved — it leaves the backlog when its native figure exists (37d)", () => {
  assert.equal(canDecide("figure_stand_in", "approve").ok, false);
  assert.equal(canDecide("figure_stand_in", "fix_requested").ok, true);
  assert.equal(canDecide("figure_stand_in", "reject").ok, true);
  assert.equal(canDecide("book_question", "approve").ok, true);
});

/* ---------------------------------------------------- the queue */

function open(over: Partial<DerivedItem>): DerivedItem {
  return {
    kind: "book_question",
    ref: "q:a",
    courseId: G10,
    moduleId: "module:g10m-c08",
    loId: "lo:g10m8s1-1-1",
    fingerprint: "f".repeat(32),
    createdAt: T0,
    humanStamped: false,
    exposure: "live",
    reasons: [{ code: "ai_checked" }],
    moduleOrder: 8,
    ...over,
  };
}

test("oldest first, then book order; never an item another reviewer holds; my own claim first", () => {
  const items = [
    open({ ref: "q:late", createdAt: T1 }),
    open({ ref: "q:lo2", loId: "lo:g10m8s1-1-2" }),
    open({ ref: "q:lo1", loId: "lo:g10m8s1-1-1" }),
    open({ ref: "lo:g10m8s1-1-1", kind: "objective", loId: "lo:g10m8s1-1-1" }),
    open({ ref: "q:taken" }),
    open({ ref: "q:skipped" }),
    open({ ref: "q:signed", humanStamped: true }),
  ].map((d) => resolveItem(d, null));

  const order = pickCandidates(items, {}, {
    heldByOthers: new Set([itemKey("book_question", "q:taken")]),
    skip: new Set([itemKey("book_question", "q:skipped")]),
  }).map((i) => i.ref);
  assert.deepEqual(order, ["q:lo1", "lo:g10m8s1-1-1", "q:lo2", "q:late"]);

  const mineFirst = pickCandidates(items, {}, {
    heldByOthers: new Set(),
    mine: { kind: "book_question", ref: "q:late" },
  }).map((i) => i.ref);
  assert.equal(mineFirst[0], "q:late", "a reload resumes the item the reviewer holds");

  assert.ok(compareItems(items[2]!, items[1]!) < 0);
});

test("filters: kind, course, chapter, reason — anything else is dropped", () => {
  const items = [
    open({ ref: "q:1" }),
    open({ ref: "q:2", courseId: P3, moduleId: "module:u1", moduleOrder: 1 }),
    open({ ref: "mc:1", kind: "misconception", reasons: [{ code: "ai_authored" }] }),
  ].map((d) => resolveItem(d, null));
  const refs = (f: Record<string, unknown>) =>
    pickCandidates(items, parseFilters(f), { heldByOthers: new Set() }).map((i) => i.ref);
  assert.deepEqual(refs({ kind: "misconception" }), ["mc:1"]);
  assert.deepEqual(refs({ course: P3 }), ["q:2"]);
  assert.deepEqual(refs({ module: "module:u1" }), ["q:2"]);
  assert.deepEqual(refs({ reason: "ai_authored" }), ["mc:1"]);
  assert.deepEqual(parseFilters({ kind: "everything", course: "x'; drop", module: ["module:u1"], reason: 7 }), {
    module: "module:u1",
  });
});

test("the summary counts toward zero backlog, by kind and by course and chapter", () => {
  const items = [
    resolveItem(open({ ref: "q:1" }), null),
    resolveItem(open({ ref: "q:2" }), decision({ fingerprint: "f".repeat(32) })),
    resolveItem(open({ ref: "q:3" }), decision({ decision: "fix_requested", note: "x", fingerprint: "f".repeat(32) })),
    resolveItem(open({ ref: "q:4", courseId: P3, moduleId: "module:u1", moduleOrder: 1 }), null),
  ];
  const s = summarize(items);
  assert.deepEqual(s.all, { open: 2, fixRequested: 1, approved: 1, rejected: 0, total: 4 });
  assert.equal(s.byKind.book_question.total, 4);
  assert.equal(s.byKind.objective.total, 0);
  assert.deepEqual(
    s.byCourse.map((c) => [c.courseId, c.tally.total]),
    [
      [P3, 1],
      [G10, 3],
    ]
  );
  assert.equal(s.openByReason.ai_checked, 2);
  assert.equal(doneShare(s.all), 0.25);
  assert.equal(doneShare({ open: 0, fixRequested: 0, approved: 0, rejected: 0, total: 0 }), 1);
});

/* ---------------------------------------------------- claim effects */

const WIDGET = {
  kind: "number_line_marker",
  spec: { min: -10, max: 10 },
  diagnostics: [{ predicate: "missed-values", misconception_id: "mc:stops-at-first-root" }],
  pending_review: [
    {
      predicate: "extra-values",
      misconception_id: "mc:keeps-both-roots",
      why: "no restriction to ignore",
      verifier_runs: ["wf_0276c362-c6a"],
    },
  ],
};

test("approving a held claim moves it into diagnostics, where the grader reads it", () => {
  const plan = planClaimApprove(WIDGET, "extra-values", "mc:keeps-both-roots");
  assert.ok(plan.ok && plan.changed);
  if (!plan.ok) return;
  assert.deepEqual(plan.choices.diagnostics, [
    { predicate: "missed-values", misconception_id: "mc:stops-at-first-root" },
    { predicate: "extra-values", misconception_id: "mc:keeps-both-roots" },
  ]);
  assert.equal("pending_review" in plan.choices, false, "nothing left held");
  assert.equal(plan.choices.kind, "number_line_marker");
  assert.deepEqual(plan.choices.spec, WIDGET.spec, "the construction itself is untouched");

  const again = planClaimApprove(plan.choices, "extra-values", "mc:keeps-both-roots");
  assert.ok(again.ok && !again.changed, "approving an active claim changes nothing");
});

test("a predicate never names two misconceptions; a vanished claim is refused", () => {
  const clash = planClaimApprove(
    { ...WIDGET, pending_review: [{ predicate: "missed-values", misconception_id: "mc:other" }] },
    "missed-values",
    "mc:other"
  );
  assert.equal(clash.ok, false);
  assert.equal(!clash.ok && clash.error, "conflict");
  assert.equal(planClaimApprove(WIDGET, "nope", "mc:x").ok, false);
  assert.equal(planClaimApprove([{ key: "A" }], "x", "y").ok, false);
});

test("rejecting an active claim switches it off; a held one stays held", () => {
  const off = planClaimReject(WIDGET, "missed-values", "mc:stops-at-first-root");
  assert.ok(off.ok && off.changed);
  assert.deepEqual(off.ok && off.choices.diagnostics, []);
  assert.deepEqual(off.ok && off.choices.pending_review, WIDGET.pending_review);

  const stays = planClaimReject(WIDGET, "extra-values", "mc:keeps-both-roots");
  assert.ok(stays.ok && !stays.changed);
  assert.equal(claimRef("q:1", "p", "mc:1"), "q:1|p|mc:1");
});

test("steps read from every stored shape", () => {
  assert.deepEqual(stepsOf([{ step: 1, text_md: "a" }, { step: 2, text_md: "" }]), [{ step: 1, text: "a" }]);
  assert.deepEqual(stepsOf({ steps: [{ text_md: "b" }] }), [{ step: 1, text: "b" }]);
  assert.deepEqual(stepsOf(null), []);
});

/* ---------------------------------------------------- permission */

const GATE_PATHS = ["/review", "/api/console/review", "/api/console/review/fix-requests"];

test("content-review alone admits the review gate; every other role is refused", () => {
  for (const p of GATE_PATHS) {
    const route = consoleRoute(p);
    assert.ok(route, `${p} is a console route`);
    assert.deepEqual([...route!.roles], ["content-review"]);
    assert.equal(routeAdmits(route!, ["content-review"]), true);
    for (const other of ALL_ROLES.filter((r) => r !== "content-review")) {
      assert.equal(routeAdmits(route!, [other]), false, `${other} must not reach ${p}`);
    }
    assert.equal(routeAdmits(route!, []), false);
  }
  const reviewer = { kind: "operator" as const, operatorId: 7, roles: ["content-review" as const] };
  const billing = { kind: "operator" as const, operatorId: 8, roles: ["cost-billing" as const, "student-data" as const] };
  assert.equal(checkRequirement(reviewer, { role: "content-review" }).ok, true);
  const refused = checkRequirement(billing, { role: "content-review" });
  assert.equal(refused.ok, false);
  assert.equal(refused.ok === false && refused.status, 403);
  assert.equal(refused.ok === false && refused.reason, "missing_role:content-review");
  const student = { kind: "student" as const, studentId: 1, accountId: 1, emailVerified: true };
  assert.equal(checkRequirement(student, { role: "content-review" }).ok, false);
  assert.equal(checkRequirement({ kind: "anonymous" }, { role: "content-review" }).ok, false);
});

test("both endpoints ask the seam for content-review themselves", () => {
  for (const rel of ["app/api/console/review/route.console.ts", "app/api/console/review/fix-requests/route.console.ts"]) {
    const src = readFileSync(path.join(SRC, rel), "utf8");
    assert.match(src, /authorize\(\{ role: "content-review" \}\)/, `${rel} authorizes content-review`);
  }
});

/* ---------------------------------------------------- students never see it */

const STUDENT_ROOTS = [
  "app/(student)",
  "app/(auth)",
  "components/student",
  "components/spine",
  "components/chat",
  "components/viz",
  "components/auth",
];

function walk(dir: string): string[] {
  let out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (/\.(tsx?|mts)$/.test(name) && !/\.test\.mts$/.test(name)) out.push(p);
  }
  return out;
}

test("no student surface — page, component or non-console endpoint — reaches the review gate", () => {
  const files = [
    ...STUDENT_ROOTS.flatMap((r) => walk(path.join(SRC, r))),
    ...walk(path.join(SRC, "app/api")).filter((f) => !f.includes(".console.")),
  ];
  assert.ok(files.length > 50, `only ${files.length} files scanned`);
  const leaks = files.filter((f) =>
    /review-gate|ReviewDesk|ReviewItemView|review_decisions|review_claims/.test(readFileSync(f, "utf8"))
  );
  assert.deepEqual(leaks.map((f) => path.relative(SRC, f)), []);
});

test("the gate's three addresses are console files, so the student build has none of them", () => {
  for (const p of GATE_PATHS) {
    const row = CONSOLE_ROUTES.find((r) => r.path === p)!;
    assert.match(row.file, /\.console\.tsx?$/, `${p} is a .console file`);
  }
});

test("migration 036 gives the student role nothing on either table, and checks it", () => {
  const sql = readFileSync(path.join(REPO, "db/migrations/036-review-gate.sql"), "utf8");
  const grants = sql.match(/^\s*GRANT[^;]+;/gm) ?? [];
  assert.ok(grants.length >= 3);
  for (const g of grants) assert.doesNotMatch(g, /ainext_app/, `036 grants the student role: ${g.trim()}`);
  assert.match(sql, /REVOKE ALL ON review_decisions, review_claims FROM ainext_app, ainext_operator/);
  assert.match(sql, /ainext_app holds a privilege on the review gate/);
});
