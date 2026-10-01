/**
 * THE CONSOLE REVIEW GATE — the rules, pure (migration 036; Samuel's answers
 * 33 and 37, 2026-09-27 and 2026-10-01).
 *
 *   "let's prepare in the console a review gate, just internal and the aim
 *    will be that the console has zero backlog, so I, Tamer and Kamil will be
 *    reviewing one by one … keep the student always full as if everything has
 *    been reviewed"                                     — Samuel, answer 37
 *
 * **The backlog is derived, never stored.** Every maths item that no human has
 * signed is a backlog item; the content tables say which those are, and
 * `review_decisions` (036) says what a human has decided since. This module is
 * the whole decision about an item's state, so the page, the "next item"
 * queue, the export and the tests read one rule:
 *
 *   · {@link stampKind} / {@link isHumanStamp} — what counts as reviewed
 *     (answer 33: a HUMAN stamp only). Migration 035 moved AI checks out of
 *     `questions.reviewed_by`; this mirrors 035's classification as defence in
 *     depth, so a loader of an older build writing "ai dual-check (pending
 *     Samuel)" into `reviewed_by` again still reads as "AI-checked, awaiting
 *     human", never as reviewed.
 *   · `derive*` — one content row → one backlog candidate, with the reasons it
 *     needs a human and a fingerprint of its content (computed in SQL,
 *     `lib/review-gate-queries.ts`).
 *   · {@link resolveItem} — candidate + the latest decision → open, fix
 *     requested, approved or rejected. A decision only counts while the item
 *     still has the fingerprint the reviewer saw: content that changed since
 *     goes back in front of a human, and a fix request leaves the fix list by
 *     itself once the item has actually changed.
 *
 * **Review status is an operator fact** (ADR-0019). Nothing a student surface
 * imports reaches this module (`review-gate.test.mts` scans for it), and the
 * student role holds no privilege on either 036 table (036's own verification).
 *
 * Pure: no database, no React, no Node built-ins — the console's client
 * components import its labels.
 */

/* ------------------------------------------------------------------ kinds */

export const ITEM_KINDS = [
  "book_question",
  "generated_question",
  "widget_question",
  "mapping_claim",
  "misconception",
  "worked_example",
  "objective",
  "prerequisite_link",
  "figure_stand_in",
] as const;

export type ItemKind = (typeof ITEM_KINDS)[number];

export const isItemKind = (v: unknown): v is ItemKind =>
  typeof v === "string" && (ITEM_KINDS as readonly string[]).includes(v);

/** What the console calls each kind, singular. */
export const KIND_LABEL: Record<ItemKind, string> = {
  book_question: "Book question",
  generated_question: "Generated question",
  widget_question: "Widget question",
  mapping_claim: "Widget mapping",
  misconception: "Misconception",
  worked_example: "Worked example",
  objective: "Objective",
  prerequisite_link: "Prerequisite link",
  figure_stand_in: "Figure stand-in",
};

/** One line on what a reviewer is signing, per kind. */
export const KIND_SCOPE: Record<ItemKind, string> = {
  book_question:
    "The book's question as the student sees it: stem, figure, options, the answer key and the worked solution the tutor teaches from.",
  generated_question:
    "A question the pipeline wrote from a book question's template: stem, answer key and worked solution.",
  widget_question: "An interactive construction: the task, the widget's setup and what counts as correct.",
  mapping_claim:
    "One claim: when a student's construction shows this pattern, the tutor names this misconception and shows its refutation.",
  misconception:
    "A catalogue entry: the misconception's name and description, and the refutation a student is shown when it is diagnosed.",
  worked_example: "A worked example from the book, as the tutor and the student read it.",
  objective: "A learning objective the pipeline derived from the book: its wording and where it sits.",
  prerequisite_link: "A claim that one objective must come before another.",
  figure_stand_in:
    "The book's own picture, shown to students until a native figure exists (answer 37d).",
};

const QUESTION_KINDS: ReadonlySet<ItemKind> = new Set([
  "book_question",
  "generated_question",
  "widget_question",
]);
export const isQuestionKind = (k: ItemKind) => QUESTION_KINDS.has(k);

/* -------------------------------------------------------------- decisions */

export const DECISIONS = ["approve", "fix_requested", "reject"] as const;
export type Decision = (typeof DECISIONS)[number];
export const isDecision = (v: unknown): v is Decision =>
  typeof v === "string" && (DECISIONS as readonly string[]).includes(v);

export const DECISION_LABEL: Record<Decision, string> = {
  approve: "Approved",
  fix_requested: "Fix requested",
  reject: "Rejected",
};

/** The longest note and suggested correction the gate accepts (036's CHECKs). */
export const MAX_NOTE = 2000;
export const MAX_CORRECTION = 8000;

/**
 * May this decision be taken on this kind? One answer for the button, the
 * endpoint and the test.
 *
 * A figure stand-in cannot be APPROVED: it leaves the backlog when its native
 * figure exists (answer 37d — "each such question stays in the backlog as
 * 'needs native figure'"). A reviewer confirms it needs one (fix requested,
 * with what to draw) or rejects the picture, which takes the question away
 * from students until it has a figure.
 */
export function canDecide(kind: ItemKind, decision: Decision): { ok: true } | { ok: false; why: string } {
  if (kind === "figure_stand_in" && decision === "approve") {
    return {
      ok: false,
      why: "A figure stand-in leaves the backlog when its native figure exists (answer 37d). Ask for the native figure, or reject the picture.",
    };
  }
  return { ok: true };
}

/** What each decision does to students, per kind — said beside the buttons. */
export function decisionEffect(kind: ItemKind, decision: Decision): string {
  if (decision === "fix_requested") {
    return "Nothing changes for students. The item goes on the fix list the pipeline exports, and comes back here once it has changed.";
  }
  if (decision === "approve") {
    switch (kind) {
      case "book_question":
      case "generated_question":
      case "widget_question":
        return "Signs the question with your name. A question loaded for review with no safety hold goes live; one an automatic check holds stays held.";
      case "mapping_claim":
        return "The claim is active for students: this pattern names this misconception.";
      case "misconception":
        return "Signs the catalogue entry and marks its refutation reviewed.";
      case "worked_example":
        return "Marks the worked example reviewed.";
      case "objective":
      case "prerequisite_link":
        return "Recorded. Nothing changes for students.";
      case "figure_stand_in":
        return "Not available for a stand-in.";
    }
  }
  switch (kind) {
    case "book_question":
    case "generated_question":
    case "widget_question":
      return "Retires the question: students stop seeing it.";
    case "mapping_claim":
      return "The claim is inactive for students (an active one is switched off).";
    case "figure_stand_in":
      return "Holds the question back from students until it has a figure.";
    default:
      return "Recorded and put on the export for the pipeline. Nothing changes for students automatically.";
  }
}

/* ----------------------------------------------------------------- stamps */

export type StampKind = "none" | "ai" | "bulk" | "human";

/**
 * Is this `reviewed_by` value a human's stamp? Migration 035's classification,
 * character for character, so the database and the console cannot disagree:
 *
 *   · the stamp is the first "; "-separated segment, with the loader's
 *     " [held: figure missing]" mark removed;
 *   · "ai …" or "… (pending <name>)" is an AI check;
 *   · "local-dev …", "local-docker …" or "… (poc bulk)" is a bulk or dev
 *     promotion — explicitly not a review;
 *   · anything else is a human stamp ("Samuel Toma (G2 fix)", "<name>
 *     (sampled)", "<name> (family <tpl> via <qid>)", an operator's display
 *     name written by this gate).
 *
 * One addition, in the safe direction: "auto-pass G<n> (AI recommendation)"
 * (answer 37c, `services/extraction/review_policy.py`) is an AI check too. The
 * loaders write it to `ai_checked_by`, never to `reviewed_by`; should one ever
 * land in `reviewed_by`, it reads as awaiting a human, not as reviewed.
 */
export function stampKind(raw: string | null | undefined): StampKind {
  if (raw == null) return "none";
  const stamp = raw.replace(" [held: figure missing]", "").split("; ")[0]!.trim();
  if (stamp === "") return "none";
  if (/^ai /i.test(stamp) || /\(pending [^)]*\)$/i.test(stamp) || /^auto-pass /i.test(stamp)) return "ai";
  if (/^local-(dev|docker)/i.test(stamp) || /\(poc bulk\)$/i.test(stamp)) return "bulk";
  return "human";
}

export const isHumanStamp = (raw: string | null | undefined): boolean => stampKind(raw) === "human";

/**
 * Does a review note say a MACHINE changed the item after a human signed it?
 * "stem fixed by orchestrator (data-engineer agent), 2026-09-27 — not Samuel"
 * (035 moved that out of `reviewed_by` into `review_note`). The human stamp
 * then covers content that is no longer what the human read.
 */
export function changedAfterHumanReview(note: string | null | undefined): boolean {
  if (!note) return false;
  return (
    /\b(fixed|changed|edited|rewritten|reworded|corrected|replaced)\b[^;]*\bby\b[^;]*\b(orchestrator|agent|pipeline|script)\b/i.test(
      note
    ) || /—\s*not\s+[A-Z]/.test(note)
  );
}

/* ---------------------------------------------------------------- reasons */

export const REASON_CODES = [
  "ai_checked",
  "unchecked",
  "promoted_without_review",
  "changed_after_review",
  "changed_since_decision",
  "blocked",
  "reverted",
  "active_mapping",
  "held_mapping",
  "ai_authored",
  "needs_native_figure",
  "no_human_review",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];
export const isReasonCode = (v: unknown): v is ReasonCode =>
  typeof v === "string" && (REASON_CODES as readonly string[]).includes(v);

export const REASON_LABEL: Record<ReasonCode, string> = {
  ai_checked: "AI-checked, awaiting human",
  unchecked: "No check recorded",
  promoted_without_review: "Promoted without review",
  changed_after_review: "Changed after a human signed it",
  changed_since_decision: "Changed since a reviewer decided",
  blocked: "Held by an automatic check",
  reverted: "Decision undone by a reload",
  active_mapping: "Active for students, awaiting human",
  held_mapping: "Held inactive: the AI verifier refused it",
  ai_authored: "AI-authored, awaiting human",
  needs_native_figure: "Needs native figure",
  no_human_review: "No human review recorded",
};

export type Reason = { code: ReasonCode; detail?: string };

/* ------------------------------------------------------------- candidates */

/** What students see of an item right now. */
export type Exposure =
  /** a question students are served */
  | "live"
  /** a question an automatic check (or a human hold) keeps from students */
  | "held"
  /** a widget claim the grader uses */
  | "active"
  /** a widget claim stored but not used (decision 47) */
  | "inactive"
  /** catalogue, objective, link: always "shown" in the sense that it shapes teaching */
  | "content";

/** One backlog candidate, derived from a content row, before any decision. */
export interface DerivedItem {
  kind: ItemKind;
  ref: string;
  courseId: string;
  moduleId: string | null;
  loId: string | null;
  /** hash of the content a reviewer signs (SQL, `lib/review-gate-queries.ts`) */
  fingerprint: string;
  /** when the row was written — "oldest first" */
  createdAt: string;
  /** a valid human stamp is already on the row (G2/G3, or this gate's approve) */
  humanStamped: boolean;
  exposure: Exposure;
  /** why it needs a human, before any decision */
  reasons: Reason[];
  /** the objective's rank in the catalogue order (`lib/module-order.ts`), for ties on `createdAt` */
  catalogueRank: number;
}

/** The SQL row every question-backed reader returns (lib/review-gate-queries.ts). */
export interface QuestionRow {
  id: string;
  course_id: string;
  module_id: string | null;
  catalogue_rank: number | null;
  lo_id: string;
  question_type: string;
  source: string;
  status: string;
  reviewed_by: string | null;
  ai_checked_by: string | null;
  hold_reason: string | null;
  review_note: string | null;
  fingerprint: string;
  created_at: string | Date;
}

const iso = (v: string | Date): string => (v instanceof Date ? v.toISOString() : String(v));

/**
 * Which kind a question is. A widget is a widget whoever wrote it; otherwise
 * the book's own rows (`seed`, `authored`) against the pipeline's (`variant`).
 */
export function questionKind(row: { question_type: string; source: string }): ItemKind {
  if (row.question_type === "widget") return "widget_question";
  return row.source === "variant" ? "generated_question" : "book_question";
}

/** Statuses a question can be in and still be a backlog item. */
const BACKLOG_STATUSES = new Set(["live", "review"]);

export function deriveQuestion(row: QuestionRow): DerivedItem | null {
  if (!BACKLOG_STATUSES.has(row.status)) return null; // draft, rejected, retired: not served, not reviewed
  const human = isHumanStamp(row.reviewed_by);
  const changedAfter = human && changedAfterHumanReview(row.review_note);
  const reasons: Reason[] = [];
  if (!human) {
    // An older loader's AI stamp in reviewed_by reads as an AI check too.
    const ai = row.ai_checked_by ?? (stampKind(row.reviewed_by) === "ai" ? row.reviewed_by : null);
    const promoted =
      stampKind(row.reviewed_by) === "bulk"
        ? row.reviewed_by
        : /promoted without review/i.test(row.review_note ?? "")
          ? row.review_note
          : null;
    if (ai) reasons.push({ code: "ai_checked", detail: ai });
    else if (promoted) reasons.push({ code: "promoted_without_review", detail: promoted ?? undefined });
    else reasons.push({ code: "unchecked" });
  } else if (changedAfter) {
    reasons.push({ code: "changed_after_review", detail: `${row.reviewed_by} — ${row.review_note}` });
  }
  if (row.status === "review") {
    reasons.push({ code: "blocked", detail: row.hold_reason ?? "loaded for review, no safety hold recorded" });
  }
  return {
    kind: questionKind(row),
    ref: row.id,
    courseId: row.course_id,
    moduleId: row.module_id,
    loId: row.lo_id,
    fingerprint: row.fingerprint,
    createdAt: iso(row.created_at),
    humanStamped: human && !changedAfter,
    exposure: row.status === "live" ? "live" : "held",
    reasons,
    catalogueRank: row.catalogue_rank ?? 0,
  };
}

/** One widget predicate→misconception claim, as the SQL reader unnests it. */
export interface ClaimRow {
  question_id: string;
  course_id: string;
  module_id: string | null;
  catalogue_rank: number | null;
  lo_id: string;
  predicate: string;
  misconception_id: string;
  state: "active" | "held";
  why: string | null;
  fingerprint: string;
  created_at: string | Date;
}

/** "q:…|predicate|mc:…" — `|` appears in no content id. */
export function claimRef(questionId: string, predicate: string, misconceptionId: string): string {
  return `${questionId}|${predicate}|${misconceptionId}`;
}

export function parseClaimRef(ref: string): { questionId: string; predicate: string; misconceptionId: string } | null {
  const parts = ref.split("|");
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) return null;
  return { questionId: parts[0]!, predicate: parts[1]!, misconceptionId: parts[2]! };
}

export function deriveClaim(row: ClaimRow): DerivedItem {
  return {
    kind: "mapping_claim",
    ref: claimRef(row.question_id, row.predicate, row.misconception_id),
    courseId: row.course_id,
    moduleId: row.module_id,
    loId: row.lo_id,
    fingerprint: row.fingerprint,
    createdAt: iso(row.created_at),
    // No column records a human on a claim: only this gate's decisions do.
    humanStamped: false,
    exposure: row.state === "active" ? "active" : "inactive",
    reasons: [
      row.state === "active"
        ? { code: "active_mapping" }
        : { code: "held_mapping", detail: row.why ?? undefined },
    ],
    catalogueRank: row.catalogue_rank ?? 0,
  };
}

/** Any other content row: misconception, worked example, objective, link, figure. */
export interface ContentRow {
  ref: string;
  course_id: string;
  module_id: string | null;
  catalogue_rank: number | null;
  lo_id: string | null;
  fingerprint: string;
  created_at: string | Date;
  /** misconception / worked example: who wrote it */
  generated_by?: string | null;
  /** worked example: the library's own flag and stamp */
  reviewed?: boolean | null;
  reviewed_by?: string | null;
  /** figure stand-in: its question's status, when it belongs to one */
  question_status?: string | null;
}

const AI_AUTHOR = /\b(UNREVIEWED|workflow|Sonnet|Haiku|Opus|LLM|agent|S5)\b/i;

export function deriveContent(kind: Exclude<ItemKind, "book_question" | "generated_question" | "widget_question" | "mapping_claim">, row: ContentRow): DerivedItem {
  let reasons: Reason[];
  let humanStamped = false;
  let exposure: Exposure = "content";
  switch (kind) {
    case "misconception":
      reasons = [
        row.generated_by && AI_AUTHOR.test(row.generated_by)
          ? { code: "ai_authored", detail: row.generated_by }
          : { code: "no_human_review", detail: row.generated_by ?? undefined },
      ];
      break;
    case "worked_example":
      humanStamped = row.reviewed === true && isHumanStamp(row.reviewed_by);
      reasons = [{ code: "no_human_review", detail: row.generated_by ?? undefined }];
      break;
    case "objective":
      reasons = [{ code: "no_human_review", detail: "derived from the book by the pipeline" }];
      break;
    case "prerequisite_link":
      reasons = [{ code: "no_human_review", detail: "found in the book by the pipeline" }];
      break;
    case "figure_stand_in":
      reasons = [{ code: "needs_native_figure", detail: "the book's own picture is shown until a native figure exists" }];
      exposure = row.question_status == null || row.question_status === "live" ? "live" : "held";
      break;
  }
  return {
    kind,
    ref: row.ref,
    courseId: row.course_id,
    moduleId: row.module_id,
    loId: row.lo_id,
    fingerprint: row.fingerprint,
    createdAt: iso(row.created_at),
    humanStamped,
    exposure,
    reasons,
    catalogueRank: row.catalogue_rank ?? 0,
  };
}

/* ------------------------------------------------------------- resolution */

export type ItemState = "open" | "fix_requested" | "approved" | "rejected";

export interface LatestDecision {
  id: number;
  decision: Decision;
  fingerprint: string;
  operatorName: string;
  decidedAt: string;
  note: string | null;
  suggestedCorrection: string | null;
}

export interface ResolvedItem extends DerivedItem {
  state: ItemState;
  latest: LatestDecision | null;
}

const VERB: Record<Decision, string> = {
  approve: "approved",
  fix_requested: "asked for a fix",
  reject: "rejected",
};

const day = (isoTs: string) => isoTs.slice(0, 10);

/**
 * The item's state, from its content and its latest decision.
 *
 *  · No decision: approved when a valid human stamp is on the row, open
 *    otherwise.
 *  · A decision on DIFFERENT content (the fingerprint moved): open again,
 *    saying who decided what and when — a reload or a pipeline fix changed
 *    what was signed. This is also how a fix request leaves the fix list.
 *  · A decision whose effect a reload undid — a rejected question live
 *    again, an approved claim held again, a rejected claim active again, a
 *    rejected stand-in's question back with students: open, "reverted".
 */
export function resolveItem(item: DerivedItem, latest: LatestDecision | null | undefined): ResolvedItem {
  const done = (state: ItemState, reasons: Reason[] = item.reasons): ResolvedItem => ({
    ...item,
    state,
    reasons,
    latest: latest ?? null,
  });
  if (!latest) return done(item.humanStamped ? "approved" : "open");

  if (latest.fingerprint !== item.fingerprint) {
    return done("open", [
      {
        code: "changed_since_decision",
        detail: `${latest.operatorName} ${VERB[latest.decision]} it on ${day(latest.decidedAt)}; it has changed since`,
      },
      ...item.reasons.filter((r) => r.code !== "changed_after_review"),
    ]);
  }

  const reverted = (what: string) =>
    done("open", [{ code: "reverted", detail: `${latest.operatorName} ${VERB[latest.decision]} it on ${day(latest.decidedAt)}, but ${what}` }]);

  switch (latest.decision) {
    case "fix_requested":
      return done("fix_requested");
    case "approve":
      if (item.kind === "mapping_claim" && item.exposure === "inactive") {
        return reverted("it is held inactive again");
      }
      return done("approved", []);
    case "reject":
      if (isQuestionKind(item.kind) && item.exposure === "live") return reverted("students see it again");
      if (item.kind === "mapping_claim" && item.exposure === "active") return reverted("it is active again");
      if (item.kind === "figure_stand_in" && item.exposure === "live") return reverted("its question is back with students");
      return done("rejected", []);
  }
}

/** Open, or waiting on a fix: still owed to zero backlog. */
export const isOutstanding = (i: { state: ItemState }) => i.state === "open" || i.state === "fix_requested";

/* --------------------------------------------------------------- ordering */

const KIND_RANK = new Map<ItemKind, number>(ITEM_KINDS.map((k, i) => [k, i]));

/**
 * Oldest first, then book order — the objective's `catalogueRank` (course,
 * term, chapter, position: `lib/module-order.ts`, computed in SQL) — then
 * kind, then id. One load writes a whole course in one transaction, so its
 * rows share a timestamp and the tie-break is what puts a chapter in the
 * reviewer's hands in the order the book prints it.
 */
export function compareItems(a: DerivedItem, b: DerivedItem): number {
  return (
    a.createdAt.localeCompare(b.createdAt) ||
    a.catalogueRank - b.catalogueRank ||
    (KIND_RANK.get(a.kind)! - KIND_RANK.get(b.kind)!) ||
    a.ref.localeCompare(b.ref)
  );
}

/* ---------------------------------------------------------------- filters */

export interface BacklogFilters {
  kind?: ItemKind;
  course?: string;
  module?: string;
  reason?: ReasonCode;
}

const COURSE_ID = /^course:[a-z0-9-]{1,80}$/;
const MODULE_ID = /^module:[A-Za-z0-9_.-]{1,80}$/;

/** From a query string or a request body. Anything not on a closed list or of the id's shape is dropped. */
export function parseFilters(raw: Record<string, unknown> | null | undefined): BacklogFilters {
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  const out: BacklogFilters = {};
  const kind = one(raw?.kind);
  const course = one(raw?.course);
  const mod = one(raw?.module);
  const reason = one(raw?.reason);
  if (isItemKind(kind)) out.kind = kind;
  if (typeof course === "string" && COURSE_ID.test(course)) out.course = course;
  if (typeof mod === "string" && MODULE_ID.test(mod)) out.module = mod;
  if (isReasonCode(reason)) out.reason = reason;
  return out;
}

export function matchesFilters(item: ResolvedItem, f: BacklogFilters): boolean {
  if (f.kind && item.kind !== f.kind) return false;
  if (f.course && item.courseId !== f.course) return false;
  if (f.module && item.moduleId !== f.module) return false;
  if (f.reason && !item.reasons.some((r) => r.code === f.reason)) return false;
  return true;
}

/**
 * The next item for a reviewer: their own live claim first (a reload resumes
 * where they were), then the oldest open item that matches the filters, that
 * they have not skipped, and that nobody else holds.
 */
export function pickCandidates(
  items: readonly ResolvedItem[],
  f: BacklogFilters,
  opts: { mine?: { kind: ItemKind; ref: string } | null; heldByOthers: ReadonlySet<string>; skip?: ReadonlySet<string> }
): ResolvedItem[] {
  const key = (i: { kind: string; ref: string }) => `${i.kind}\u0000${i.ref}`;
  const open = items
    .filter((i) => i.state === "open" && matchesFilters(i, f))
    .filter((i) => !opts.heldByOthers.has(key(i)))
    .filter((i) => !opts.skip?.has(key(i)))
    .sort(compareItems);
  if (opts.mine) {
    const at = open.findIndex((i) => i.kind === opts.mine!.kind && i.ref === opts.mine!.ref);
    if (at > 0) open.unshift(...open.splice(at, 1));
  }
  return open;
}

export const itemKey = (kind: string, ref: string) => `${kind}\u0000${ref}`;

/* ---------------------------------------------------------------- summary */

export interface Tally {
  open: number;
  fixRequested: number;
  approved: number;
  rejected: number;
  total: number;
}

const zero = (): Tally => ({ open: 0, fixRequested: 0, approved: 0, rejected: 0, total: 0 });

function add(t: Tally, s: ItemState) {
  t.total += 1;
  if (s === "open") t.open += 1;
  else if (s === "fix_requested") t.fixRequested += 1;
  else if (s === "approved") t.approved += 1;
  else t.rejected += 1;
}

export interface BacklogSummary {
  all: Tally;
  byKind: Record<ItemKind, Tally>;
  /** courses and their chapters in catalogue order (the first objective's rank) */
  byCourse: { courseId: string; tally: Tally; modules: { moduleId: string | null; catalogueRank: number; tally: Tally }[] }[];
  /** open items per reason (an item with two reasons counts under both) */
  openByReason: Partial<Record<ReasonCode, number>>;
}

export function summarize(items: readonly ResolvedItem[]): BacklogSummary {
  const all = zero();
  const byKind = Object.fromEntries(ITEM_KINDS.map((k) => [k, zero()])) as Record<ItemKind, Tally>;
  const courses = new Map<
    string,
    { tally: Tally; catalogueRank: number; modules: Map<string, { moduleId: string | null; catalogueRank: number; tally: Tally }> }
  >();
  const openByReason: Partial<Record<ReasonCode, number>> = {};
  for (const i of items) {
    add(all, i.state);
    add(byKind[i.kind], i.state);
    let c = courses.get(i.courseId);
    if (!c) courses.set(i.courseId, (c = { tally: zero(), catalogueRank: i.catalogueRank, modules: new Map() }));
    c.catalogueRank = Math.min(c.catalogueRank, i.catalogueRank);
    add(c.tally, i.state);
    const mk = i.moduleId ?? "";
    let m = c.modules.get(mk);
    if (!m) c.modules.set(mk, (m = { moduleId: i.moduleId, catalogueRank: i.catalogueRank, tally: zero() }));
    m.catalogueRank = Math.min(m.catalogueRank, i.catalogueRank);
    add(m.tally, i.state);
    if (i.state === "open") {
      for (const code of new Set(i.reasons.map((r) => r.code))) openByReason[code] = (openByReason[code] ?? 0) + 1;
    }
  }
  return {
    all,
    byKind,
    byCourse: [...courses.entries()]
      .sort(([, a], [, b]) => a.catalogueRank - b.catalogueRank)
      .map(([courseId, c]) => ({
        courseId,
        tally: c.tally,
        modules: [...c.modules.values()].sort((a, b) => a.catalogueRank - b.catalogueRank),
      })),
    openByReason,
  };
}

/** Done as a share of everything, for the zero-backlog bar. */
export function doneShare(t: Tally): number {
  return t.total === 0 ? 1 : (t.approved + t.rejected) / t.total;
}

/* ------------------------------------------------------- mapping effects */

type Diagnostic = { predicate: string; misconception_id: string } & Record<string, unknown>;

const asList = (v: unknown): Diagnostic[] =>
  Array.isArray(v)
    ? (v.filter(
        (d) => d && typeof d === "object" && typeof (d as Diagnostic).predicate === "string"
      ) as Diagnostic[])
    : [];

/** The fields the grader reads; the verifier's bookkeeping stays out of `diagnostics`. */
const activeEntry = (d: Diagnostic): Diagnostic => ({ predicate: d.predicate, misconception_id: d.misconception_id });

export type ChoicesPlan =
  | { ok: true; choices: Record<string, unknown>; changed: boolean; change: string }
  | { ok: false; error: "not_found" | "conflict"; message: string };

/**
 * Approving a widget claim. A HELD claim (decision 47) moves from
 * `pending_review` into `diagnostics`, where the grader reads it — unless that
 * predicate already names a different misconception there, which the grader
 * cannot do (one predicate, one diagnosis): refused, so the reviewer rejects
 * one of the two first. An ACTIVE claim stays as it is.
 */
export function planClaimApprove(choices: unknown, predicate: string, mc: string): ChoicesPlan {
  if (!choices || typeof choices !== "object" || Array.isArray(choices)) {
    return { ok: false, error: "not_found", message: "this question carries no widget spec" };
  }
  const c = choices as Record<string, unknown>;
  const active = asList(c.diagnostics);
  const held = asList(c.pending_review);
  if (active.some((d) => d.predicate === predicate && d.misconception_id === mc)) {
    return { ok: true, choices: c, changed: false, change: "already active — no change" };
  }
  const at = held.findIndex((d) => d.predicate === predicate && d.misconception_id === mc);
  if (at < 0) return { ok: false, error: "not_found", message: "the claim is no longer on this question" };
  const clash = active.find((d) => d.predicate === predicate);
  if (clash) {
    return {
      ok: false,
      error: "conflict",
      message: `"${predicate}" already names ${clash.misconception_id} on this question; reject one of the two claims first`,
    };
  }
  const nextHeld = held.filter((_, i) => i !== at);
  const next: Record<string, unknown> = { ...c, diagnostics: [...active, activeEntry(held[at]!)] };
  if (nextHeld.length > 0) next.pending_review = nextHeld;
  else delete next.pending_review;
  return { ok: true, choices: next, changed: true, change: "moved from pending_review into diagnostics (now active)" };
}

/**
 * Rejecting a widget claim. An ACTIVE claim leaves `diagnostics` — the
 * predicate then diagnoses nothing, which is what the grader already does for
 * a predicate with no entry. A HELD claim stays where it is: inactive, with
 * this decision on record.
 */
export function planClaimReject(choices: unknown, predicate: string, mc: string): ChoicesPlan {
  if (!choices || typeof choices !== "object" || Array.isArray(choices)) {
    return { ok: false, error: "not_found", message: "this question carries no widget spec" };
  }
  const c = choices as Record<string, unknown>;
  const active = asList(c.diagnostics);
  const held = asList(c.pending_review);
  if (active.some((d) => d.predicate === predicate && d.misconception_id === mc)) {
    return {
      ok: true,
      choices: { ...c, diagnostics: active.filter((d) => !(d.predicate === predicate && d.misconception_id === mc)) },
      changed: true,
      change: "removed from diagnostics (now inactive)",
    };
  }
  if (held.some((d) => d.predicate === predicate && d.misconception_id === mc)) {
    return { ok: true, choices: c, changed: false, change: "already inactive — stays held" };
  }
  return { ok: false, error: "not_found", message: "the claim is no longer on this question" };
}

/* ----------------------------------------------------------------- export */

/** One line of the fix list the pipeline exports (`GET /api/console/review/fix-requests`). */
export interface FixRequestEntry {
  /** "fix" — change the item; "reject" — a human rejected an item whose rejection has no automatic effect */
  action: "fix" | "reject";
  kind: ItemKind;
  ref: string;
  courseId: string;
  moduleId: string | null;
  loId: string | null;
  fingerprint: string;
  note: string | null;
  suggestedCorrection: string | null;
  requestedBy: string;
  requestedAt: string;
  decisionId: number;
  /** the content the reviewer saw, as recorded with the decision */
  snapshot: unknown;
}

/** Kinds whose REJECT writes nothing to content: the pipeline has to act. */
export const REJECT_NEEDS_PIPELINE: ReadonlySet<ItemKind> = new Set([
  "misconception",
  "worked_example",
  "objective",
  "prerequisite_link",
]);

/** Which resolved items belong on the export. */
export function onFixList(i: ResolvedItem): "fix" | "reject" | null {
  if (i.state === "fix_requested") return "fix";
  if (i.state === "rejected" && i.latest?.decision === "reject" && REJECT_NEEDS_PIPELINE.has(i.kind)) return "reject";
  return null;
}

/* ---------------------------------------------------------------- payload */

/** A step of worked text, normalised from any stored shape. */
export interface TextStep {
  step: number;
  text: string;
}

/** Steps from a stored jsonb value: `[{step, text_md}]`, `{steps: [...]}`, or claim steps. */
export function stepsOf(content: unknown): TextStep[] {
  const list = Array.isArray(content)
    ? content
    : content && typeof content === "object" && Array.isArray((content as { steps?: unknown }).steps)
      ? (content as { steps: unknown[] }).steps
      : [];
  return list
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s, i) => ({
      step: typeof s.step === "number" ? s.step : i + 1,
      text: typeof s.text_md === "string" ? s.text_md : typeof s.claim_ar === "string" ? s.claim_ar : "",
    }))
    .filter((s) => s.text.length > 0);
}

export interface FigurePayload {
  id: string;
  kind: string;
  spec: Record<string, unknown>;
  caption: string | null;
  sourcePage: number | null;
  /** a `book_image` shown until a native figure exists (answer 37d) */
  standIn: boolean;
}

export interface MisconceptionBrief {
  id: string;
  label: string;
  description: string;
}

export interface QuestionPayload {
  id: string;
  questionType: string;
  tier: string;
  stem: string;
  choices: unknown;
  correctAnswer: string;
  solution: TextStep[];
  solutionVersion: number;
  status: string;
  source: string;
  sourcePage: number | null;
  sourceNote: string | null;
  parentId: string | null;
  parentStem: string | null;
  family: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  aiCheckedBy: string | null;
  aiCheckedAt: string | null;
  holdReason: string | null;
  reviewNote: string | null;
  figures: FigurePayload[];
  /** every misconception the question names (options, widget claims) */
  misconceptions: Record<string, MisconceptionBrief>;
}

export interface HistoryEntry {
  decision: Decision;
  operatorName: string;
  decidedAt: string;
  note: string | null;
  suggestedCorrection: string | null;
  /** made on the content as it is now */
  current: boolean;
}

export interface ReviewItemPayload {
  kind: ItemKind;
  ref: string;
  fingerprint: string;
  state: ItemState;
  reasons: Reason[];
  courseId: string;
  courseLabel: string;
  moduleId: string | null;
  moduleLabel: string | null;
  loId: string | null;
  loLabel: string | null;
  createdAt: string;
  claimExpiresAt: string | null;
  question?: QuestionPayload;
  claim?: {
    questionId: string;
    predicate: string;
    misconceptionId: string;
    active: boolean;
    why: string | null;
    verifierRuns: string[];
    misconception: (MisconceptionBrief & { signal: string | null }) | null;
    refutation: TextStep[];
  };
  misconception?: {
    id: string;
    label: string;
    description: string;
    signal: string | null;
    generatedBy: string;
    refutations: { id: string; steps: TextStep[]; reviewed: boolean; reviewedBy: string | null }[];
    taggedQuestions: number;
  };
  workedExample?: {
    id: string;
    entryType: string;
    steps: TextStep[];
    sourcePage: number | null;
    generatedBy: string;
    misconceptionId: string | null;
  };
  objective?: {
    id: string;
    label: string;
    description: string | null;
    syllabusRef: string | null;
    sourcePage: number | null;
    liveQuestions: number;
    prerequisites: { id: string; label: string }[];
    dependents: { id: string; label: string }[];
  };
  link?: {
    src: { id: string; label: string; description: string | null };
    dst: { id: string; label: string; description: string | null };
    rationale: string | null;
  };
  figure?: FigurePayload & { questionId: string | null };
  history: HistoryEntry[];
}
