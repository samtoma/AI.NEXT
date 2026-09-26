/**
 * THE CURRICULUM REGISTRY — which school systems a student can follow
 * (feature 003, FR-4001; Samuel's decisions of 2026-09-25, decision 3).
 *
 * A curriculum is the track of study a student follows: National (the
 * Egyptian ministry books) or American. It is recorded on the student in the
 * column migration 009 created for it, `students.curriculum_system`, whose
 * default `eg-national-en` is what every student created before 003 holds.
 * A course belongs to exactly one curriculum (`lib/courses.ts`), and the
 * course gate (`lib/catalog.ts`) shows a student only the courses of her own
 * curriculum, unless a per-student exception says otherwise.
 *
 * ---------------------------------------------------------------------------
 * WHY APP CODE AND NOT A TABLE, AND WHY NO CHECK CONSTRAINT
 * ---------------------------------------------------------------------------
 * The same argument `lib/subjects.ts` makes: the console needs a curriculum's
 * name before any book of it is loaded, the compiler walks every
 * `Record<CurriculumId, …>` when one is added, and the whole list is testable
 * without a database. The column is validated HERE, server-side, the way
 * `students.grade` is validated by `lib/profile.ts` — never by a CHECK. A CHECK
 * would have to be widened for every new curriculum, and migrations re-run on
 * every deploy: 007 NULLs `understanding_checks.subject` outside its list on
 * each run, and on 2026-09-23 migration 008 re-adding a narrow CHECK over rows
 * 010 had widened took the site down (`886b302`). Migration 033 says the same.
 *
 * **An unknown stored value matches no course.** `asCurriculumId` answers
 * `null` for it, and the gate's default-deny does the rest: a student whose
 * curriculum the registry does not know sees only what an exception grants.
 *
 * Pure and dependency-free apart from `lib/profile.ts` (which imports
 * nothing), so `node --test` loads it with no bundler, like `lib/catalog.ts`.
 */
import { GRADES, type Grade } from "./profile.ts";

export interface CurriculumDef {
  /** The name a student and an operator read: flat and factual, never a tier
   *  (privacy review F1: "American" / "National", nothing else). */
  label: string;
  /** Arabic name, for the Arabic-capable surfaces (constitution V). */
  labelAr: string;
  /** One neutral line for the console. */
  description: string;
  /** What each stored school year is called in this curriculum (FR-4013). */
  gradeLabels: Readonly<Record<Grade, string>>;
  /** The graph's echo of this curriculum: courses are `part_of` this node. */
  programNodeId: string;
}

/**
 * The registry. ORDER MATTERS: it is the order curricula are listed in the
 * console and offered at sign-up, and the first key of the course order
 * (`lib/courses.ts` is written curriculum by curriculum).
 */
export const CURRICULA = {
  "eg-national-en": {
    label: "National",
    labelAr: "المنهج الوطني",
    description: "Egyptian ministry curriculum",
    gradeLabels: {
      "7": "Prep 1",
      "8": "Prep 2",
      "9": "Prep 3",
      "10": "Secondary 1",
      "11": "Secondary 2",
      "12": "Secondary 3",
    },
    // The node the Prep-3 maths bundle already declares (seed/unit1.json).
    programNodeId: "program:bakaloreya-track",
  },
  "us-american-en": {
    label: "American",
    labelAr: "المنهج الأمريكي",
    description: "American curriculum",
    gradeLabels: {
      "7": "Grade 7",
      "8": "Grade 8",
      "9": "Grade 9",
      "10": "Grade 10",
      "11": "Grade 11",
      "12": "Grade 12",
    },
    // Written by the loader with the Grade 10 course (plan A11).
    programNodeId: "program:us-american-en",
  },
} as const satisfies Record<string, CurriculumDef>;

export type CurriculumId = keyof typeof CURRICULA;

/** Registry order. */
export const CURRICULUM_IDS = Object.keys(CURRICULA) as CurriculumId[];

/**
 * The value `students.curriculum_system` defaults to (migration 009), which
 * every student created before feature 003 holds. It is "National", and it is
 * *implied* rather than chosen for all of them (FR-4003).
 */
export const DEFAULT_CURRICULUM: CurriculumId = "eg-national-en";

/**
 * Validate a curriculum coming from OUTSIDE the app — a database column, a
 * request body — against the registry. Exact match only; anything else,
 * including a blank, a different case or a retired id, is `null`, never the
 * default. A caller that wants the default must say so.
 */
export function asCurriculumId(raw: unknown): CurriculumId | null {
  return typeof raw === "string" && Object.hasOwn(CURRICULA, raw)
    ? (raw as CurriculumId)
    : null;
}

/** Type guard form of `asCurriculumId` (contracts/registry-and-gate.md). */
export function isKnownCurriculum(raw: unknown): raw is CurriculumId {
  return asCurriculumId(raw) !== null;
}

/** The name of a curriculum, or the raw text for one the registry does not
 *  know (so an operator can see what is stored and fix it). */
export function curriculumLabel(raw: unknown): string {
  const id = asCurriculumId(raw);
  return id ? CURRICULA[id].label : `unknown curriculum (${String(raw ?? "—")})`;
}

/**
 * A stored school year, named the way this curriculum names it (FR-4013):
 * grade 10 is "Secondary 1" in the National curriculum and "Grade 10" in the
 * American one. `null` or an unknown curriculum uses the National labels,
 * which is what every surface printed before 003. An unknown grade keeps its
 * own text rather than being renamed into a year it is not.
 */
export function curriculumGradeLabel(grade: string, curriculum?: unknown): string {
  const id = asCurriculumId(curriculum) ?? DEFAULT_CURRICULUM;
  return (GRADES as readonly string[]).includes(grade)
    ? CURRICULA[id].gradeLabels[grade as Grade]
    : grade;
}
