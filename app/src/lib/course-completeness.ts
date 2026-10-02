/**
 * A COURSE'S COMPLETENESS, beside its switch (feature 003, FR-4309, T308;
 * contracts/console.md `CourseCompleteness`; backlog #16).
 *
 * FR-4309: "The console MUST show the course's completeness beside its
 * availability switch: chapters and sections; objectives; book questions, live
 * and held, with each kind of solution counted apart; generated questions;
 * widget questions; misconceptions with and without an explanation; and every
 * objective under the tier floor and every chapter without a widget. Every
 * count MUST be computed from the rows shown (FR-3212), so a stocked course
 * cannot be mistaken for a thin one (FR-2701)."
 *
 * Two more things sit beside it on `/courses`, because an operator deciding to
 * switch a course on needs them in the same place:
 *   · the BOOK-SECTION CHECKS (FR-4311, FR-4312) — `sectionProblems` (the
 *     store's own consistency: a split section's parts are exactly 1…m, no
 *     slug claimed twice) and `partOrderProblems` (its parts consecutive and
 *     in part order in the catalogue). Empty for every National course;
 *   · the pipeline's S8 COVERAGE AUDIT (`lib/coverage-status.ts`).
 *
 * This module is PURE — every count is a fold over the rows it is handed,
 * which is what FR-3212 asks and what the test checks — and safe in a client
 * bundle. The read (`lib/course-completeness-queries.ts`) runs under
 * `ainext_operator` (the console's role) and touches content tables only: no
 * student, no attempt, no name.
 *
 * What the contract names and this does not compute: `convertedToMcq` (the
 * database does not record what an item was before assembly) and `drift` (the
 * load's post-flight drift result is printed by `deploy/load-course.sh`, not
 * stored anywhere the console can read). Both are named in the report, not
 * invented here.
 */
import {
  buildSectionIndex,
  partOrderProblems,
  provenanceFromRow,
  sectionProblems,
  type BookSectionRow,
} from "./book-sections";
import { slugOfLo } from "./lesson-slug";
import type { CoverageStatus } from "./coverage-status";

export const TIERS = ["basic", "standard", "advanced"] as const;
export type CompletenessTier = (typeof TIERS)[number];

/** Where a book question's canonical solution comes from (FR-4302, decision 19). */
export const SOLUTION_SOURCES = [
  "book_worked",
  "book_worked_epub",
  "teachers_guide",
  "answer_anchored",
] as const;

export interface CourseCompleteness {
  /** chapters (modules) with at least one objective */
  chapters: number;
  /** lessons (objective groups sharing a slug) */
  lessons: number;
  /** printed sections the book-section store says the lessons cover; `null` with no row */
  sections: number | null;
  objectives: number;
  bookQuestions: {
    live: number;
    held: number;
    /** book questions (live and held) by where their solution comes from;
     *  `unrecorded` for a row whose note names no source (every National book) */
    bySolution: Record<string, number>;
  };
  /** unmarkable book items kept as worked examples for the tutor (FR-4303) */
  workedExamplesOnly: number;
  generated: { live: number; held: number; families: number };
  widget: { live: number; held: number };
  misconceptions: { total: number; withExplanation: number };
  /** every objective missing a live question at a tier (FR-4305) */
  underTierFloor: { loId: string; label: string; missing: CompletenessTier[] }[];
  /** every chapter with no live widget question (FR-4306) */
  chaptersWithoutWidget: { moduleId: string; label: string }[];
  /** the book-section checks: `sectionProblems`, then `partOrderProblems` */
  sectionChecks: string[];
}

/** A course's completeness and its coverage audit, as `/courses` shows them (FR-4309). */
export type CourseCompletenessView = CourseCompleteness & { coverage: CoverageStatus };

/** One objective, in catalogue order. */
export interface ObjectiveRow {
  loId: string;
  label: string;
  moduleId: string | null;
  moduleLabel: string | null;
  courseId: string | null;
}
export interface QuestionRow {
  loId: string;
  tier: string;
  questionType: string;
  status: string;
  source: string | null;
  sourceNote: string | null;
}
export interface MisconceptionRow {
  loId: string;
  explained: boolean;
}
export interface WorkedExampleRow {
  loId: string;
}

const HELD = new Set(["review", "draft"]);

/** The solution source a book question's `source_note` records ("… · solution: book_worked_epub"). */
export function solutionSourceOf(note: string | null): string {
  const m = /\bsolution:\s*([a-z_]+)/.exec(note ?? "");
  return m && (SOLUTION_SOURCES as readonly string[]).includes(m[1]!) ? m[1]! : "unrecorded";
}

/** The template family a generated question's note names ("… template family tpl:u1-1-2:inverse."). */
export function familyOf(note: string | null): string | null {
  const m = /template family\s+(\S+?)\.?$/.exec((note ?? "").trim());
  return m ? m[1]! : null;
}

/**
 * One course's completeness, from the rows of that course only. PURE: every
 * number is a count over the rows given (FR-3212).
 */
export function summariseCompleteness(input: {
  objectives: readonly ObjectiveRow[];
  questions: readonly QuestionRow[];
  misconceptions: readonly MisconceptionRow[];
  workedExamples: readonly WorkedExampleRow[];
  sectionRows: readonly BookSectionRow[];
}): CourseCompleteness {
  const los = input.objectives;
  const loIds = new Set(los.map((l) => l.loId));
  const questions = input.questions.filter((q) => loIds.has(q.loId) && q.status !== "retired");

  const modules = new Map<string, string>();
  for (const l of los) if (l.moduleId) modules.set(l.moduleId, l.moduleLabel ?? l.moduleId);
  const lessonSlugs = [...new Set(los.map((l) => slugOfLo(l.loId)))];

  const provenance = input.sectionRows.map(provenanceFromRow);
  const printed = new Set(provenance.flatMap((p) => p.sections.map((s) => s.number)));

  const book = { live: 0, held: 0, bySolution: {} as Record<string, number> };
  const generated = { live: 0, held: 0, families: 0 };
  const widget = { live: 0, held: 0 };
  const families = new Set<string>();
  const liveTiers = new Map<string, Set<string>>();
  const widgetModules = new Set<string>();
  const moduleOfLo = new Map(los.map((l) => [l.loId, l.moduleId] as const));

  for (const q of questions) {
    const live = q.status === "live";
    const held = HELD.has(q.status);
    if (live) {
      const t = liveTiers.get(q.loId) ?? new Set<string>();
      t.add(q.tier);
      liveTiers.set(q.loId, t);
    }
    if (q.questionType === "widget") {
      if (live) {
        widget.live++;
        const m = moduleOfLo.get(q.loId);
        if (m) widgetModules.add(m);
      } else if (held) widget.held++;
      continue;
    }
    if (q.source === "variant") {
      if (live) generated.live++;
      else if (held) generated.held++;
      const f = familyOf(q.sourceNote);
      if (f) families.add(f);
      continue;
    }
    if (live) book.live++;
    else if (held) book.held++;
    if (live || held) {
      const src = solutionSourceOf(q.sourceNote);
      book.bySolution[src] = (book.bySolution[src] ?? 0) + 1;
    }
  }
  generated.families = families.size;

  const misconceptions = input.misconceptions.filter((m) => loIds.has(m.loId));

  return {
    chapters: modules.size,
    lessons: lessonSlugs.length,
    sections: provenance.length > 0 ? printed.size : null,
    objectives: los.length,
    bookQuestions: book,
    workedExamplesOnly: input.workedExamples.filter((w) => loIds.has(w.loId)).length,
    generated,
    widget,
    misconceptions: {
      total: misconceptions.length,
      withExplanation: misconceptions.filter((m) => m.explained).length,
    },
    underTierFloor: los.flatMap((l) => {
      const have = liveTiers.get(l.loId) ?? new Set<string>();
      const missing = TIERS.filter((t) => !have.has(t));
      return missing.length > 0 ? [{ loId: l.loId, label: l.label, missing }] : [];
    }),
    chaptersWithoutWidget: [...modules]
      .filter(([id]) => !widgetModules.has(id))
      .map(([moduleId, label]) => ({ moduleId, label })),
    sectionChecks: [
      ...sectionProblems(provenance),
      ...partOrderProblems(
        lessonSlugs.map((slug) => ({ slug })),
        buildSectionIndex(provenance)
      ),
    ],
  };
}
