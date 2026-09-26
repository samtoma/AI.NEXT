export type Tier = "basic" | "standard" | "advanced";

/**
 * The two subject dimensions are DERIVED from the subject registry
 * (lib/subjects.ts) — they are no longer hand-written unions here, so a new
 * subject cannot exist in the product without existing in the type system:
 *
 *   Subject      — the prompt-contract id ("math-en" | "social-ar" | …).
 *                  Selects the language contract and grounding hard rules.
 *   SpineSubject — the graph-territory / DB key ("math" | "social" | …).
 *                  Subjects are separate territories, bridged by exception
 *                  (docs/specs/multi-subject-spine.md §2).
 *
 * Resolve either one ONLY through the registry's exact lookups. A course id
 * that matches no entry is `null` — never maths (docs/specs/multi-subject-app.md §1.1).
 */
export type { Subject, SpineSubject } from "./subjects";

import type { Subject, SpineSubject } from "./subjects";
import type { Gender } from "./address";
import type {
  DerivedPrereqEdge,
  LessonProvenance,
  SectionRollup,
} from "./book-sections";
import { choiceOptions } from "./question-flags";

export interface Choice {
  key: string;
  text: string;
}

export interface SolutionStep {
  step: number;
  text_md: string;
}

/** One normalized fact inside a social-studies claim-step (dates/numbers/names/places) —
 *  raw material for the cross-consistency check and explanation audits (ADR-0004). */
export interface ClaimFact {
  kind: string; // "date" | "coordinate" | "area" | "name" | "place" | "cause" | "result" | ...
  entity: string;
  value: string;
}

/**
 * Social-studies grounding unit: one claim-step of a model answer with
 * evidence (الإجابة النموذجية بالأدلة). Lives in the same `canonical_solution`
 * jsonb column as math's SolutionStep — see
 * docs/specs/social-extraction-contract.md for the authoring contract.
 */
export interface ClaimStep {
  step: number;
  claim_ar: string;
  evidence_page: number;
  evidence_kind: "text" | "map" | "concept_box" | "enrichment_box";
  facts?: ClaimFact[];
}

/** What actually sits in `canonical_solution` jsonb: math steps or social claim-steps. */
export type CanonicalStep = SolutionStep | ClaimStep;

/**
 * The renderable text of a canonical step, whichever shape it is: math steps
 * carry `text_md`, social claim-steps carry `claim_ar`. Both jsonb shapes land
 * in the same `SolutionStep[]`-typed field, so read defensively.
 */
export function stepText(s: { text_md?: string; claim_ar?: string }): string {
  return s.text_md ?? s.claim_ar ?? "";
}

export interface Provenance {
  source: string;
  /** the reviewed book question a generated item was derived from (ADR-0008) */
  parentQuestionId: string | null;
  sourceSha256: string;
  sourcePage: number | null;
  sourceNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  extractor: string | null;
  extractorVersion: string | null;
  extractionFinishedAt: string | null;
}

/** The `choices` payload of a `question_type = 'widget'` row. The predicate
 *  vocabulary is contracts/widget-predicates.json; the loader validates against
 *  it, so a diagnostic here always names a predicate its kind can emit. */
export interface WidgetQuestionSpec {
  kind: string;
  spec: Record<string, unknown>;
  diagnostics: { predicate: string; misconception_id: string }[];
}

/** The lettered options, or null when this question has none (numeric) or
 *  carries a construction instead (widget). Every site that renders options
 *  goes through this rather than asserting the array — the union exists
 *  precisely so the compiler asks. A choice question that carries a flag
 *  (`less_specific`, `answer_only`) keeps its options under `options`
 *  (`lib/question-flags.ts`); both shapes read the same here. */
export function mcqChoices(q: { choices: unknown }): Choice[] | null {
  return choiceOptions(q.choices);
}

export interface SpineQuestion {
  id: string;
  loId: string;
  tier: Tier;
  questionType: "mcq" | "numeric" | "widget";
  stem: string;
  /** MCQ: the lettered options, each optionally naming a misconception.
   *  WIDGET: the stored construction — `{kind, spec, diagnostics}`, where the
   *  diagnostics are that widget's distractors: a predicate mapped to the
   *  misconception it reveals (ADR-0009). One column, two shapes, because a
   *  widget IS a question and its wrong answers are enumerated the same way. */
  choices: Choice[] | WidgetQuestionSpec | null;
  correctAnswer: string;
  solution: SolutionStep[];
  solutionVersion: number;
  status: string;
  provenance: Provenance;
}

export interface SpineLo {
  id: string;
  label: string;
  description: string | null;
  syllabusRef: string | null;
  sourcePage: number | null;
  /** Position inside this objective's OWN module — nine maths objectives
   *  share every value. Not an order across the map; that is `catalogRank`. */
  orderInParent: number;
  /**
   * Position in catalogue order (FR-3215): the row index of the skill map's
   * objective query, which sorts by `MODULE_ORDER` — the same Term 1 → Term 2
   * → geometry, module, objective order the lesson list and the progression
   * walk use. Unique within one `SpineData`; the only tie-break the map's
   * layout uses.
   */
  catalogRank: number;
  layer: number;
  /** Prerequisites, in catalogue order. */
  prereqIds: string[];
  baseline: number;
  current: number;
  /**
   * Graph-territory key, resolved through the registry from this LO's course.
   * `null` = the course is not in the registry (or the LO has no course at
   * all): the objective is UNFILED and renders in its own neutral band. It is
   * never silently folded into maths.
   */
  subject: SpineSubject | null;
  /**
   * The course this objective is taught in (FR-4009): the skill map shows ONE
   * course at a time, so two courses of one subject — a tester's exception
   * for the other curriculum's maths — are never merged into one map.
   */
  courseId: string | null;
}

/**
 * A cross-subject associative link (`relates_to` edge). NOT a prerequisite:
 * never gates a lesson, never touches the DAG or mastery. Rendered as a rare
 * dashed-gold bridge between territories. `rationale` is the one-line "why".
 */
export interface SpineBridge {
  src: string; // LO id
  dst: string; // LO id
  rationale: string;
}

export interface SpineData {
  los: SpineLo[];
  edges: { src: string; dst: string }[];
  /** cross-subject associative links (rare) — rendered as gold bridges */
  bridges: SpineBridge[];
  questions: SpineQuestion[];
  /** the book of her first visible course — the map's fallback source */
  doc: SpineBook;
  /**
   * Every course on the map, in course order, each with ITS OWN book (FR-4009,
   * FR-4205): the course picker's entries, and the source a page citation or
   * a question's provenance names — the book of the course being looked at,
   * never the first course's. A National student has one course per subject,
   * so her picker reads exactly as the subject picker did.
   */
  courses: SpineCourse[];
  syllabusVersion: string;
  baselineDate: string;
  currentDate: string;
  counts: { los: number; questions: number; edges: number; attempts: number };
  studentName: string;
  /**
   * The book sections split into parts among these objectives (feature 003,
   * FR-4315): the skill map draws each as one visible group, labelled by the
   * section. Empty for a course with no split section — every National course
   * — so the map it draws is exactly the one it drew before.
   */
  sectionGroups: SpineSectionGroup[];
  /**
   * Part n-1 → part n prerequisites, DERIVED from the book-section store and
   * marked as the product's (FR-4317) — never in `edges`, which stays the
   * book's own. Already folded into each objective's `layer` and `prereqIds`,
   * so the map's columns and the topic panel respect them; drawn beside
   * `edges`. Empty with no split section.
   */
  partEdges: DerivedPrereqEdge[];
}

/** One source book, as the skill map names it. */
export interface SpineBook {
  title: string;
  publisher: string;
  edition: string;
  grade: string;
  subject: string;
}

/** One course on the skill map (`SpineData.courses`). */
export interface SpineCourse {
  id: string;
  /** the registry's own name — "Mathematics — Grade 10" (`lib/courses.ts`) */
  label: string;
  /** its graph territory, or `null` for a course the registry does not know */
  subject: SpineSubject | null;
  /** its own book; empty strings when the loader stamped none */
  doc: SpineBook;
}

/** One split book section as the skill map groups it (FR-4315). */
export interface SpineSectionGroup {
  /** `lib/book-sections.ts` `SectionGroup.key` */
  key: string;
  /** the printed section number ("1.7") */
  number: string | null;
  /** the printed section title ("Factorisation") */
  title: string | null;
  /** each part, in part order, with its objectives in catalogue order */
  parts: { slug: string; n: number; of: number; loIds: string[] }[];
}

/**
 * A split section's roll-up (FR-4314, `lib/book-sections.ts`
 * `SectionRollup`), plus whether the student has started it — any objective
 * of any part with evidence. What the subject home and the progress page
 * read.
 */
export interface SectionProgress extends SectionRollup {
  started: boolean;
}

export type PlanReason = "weakest" | "review" | "stretch";

export interface PlanItem {
  questionId: string;
  loId: string;
  loLabel: string;
  loScore: number;
  tier: Tier;
  questionType: "mcq" | "numeric" | "widget";
  stem: string;
  /** MCQ: the lettered options, each optionally naming a misconception.
   *  WIDGET: the stored construction — `{kind, spec, diagnostics}`, where the
   *  diagnostics are that widget's distractors: a predicate mapped to the
   *  misconception it reveals (ADR-0009). One column, two shapes, because a
   *  widget IS a question and its wrong answers are enumerated the same way. */
  choices: Choice[] | WidgetQuestionSpec | null;
  reason: PlanReason;
  sourcePage: number | null;
}

/* ---- Ask the Spine (grounded chat) ---- */

export interface TurnMeta {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  /** prompt-cache observability (migration 005) */
  cacheReadTokens: number;
  cacheCreationTokens: number;
  latencyMs: number;
  model: string;
  interactionId: number | null;
  turnIndex: number;
}

export type ChatRole = "user" | "assistant" | "note";

export interface ChatMsg {
  role: ChatRole;
  text: string;
  meta?: TurnMeta;
  error?: boolean;
  streaming?: boolean;
  /** sent to the model but never rendered (lesson-flow continuations) */
  hidden?: boolean;
  /** rendered but never sent to the model (local latency-theater lines) */
  localOnly?: boolean;
  /** note flavor: "event" = instrumentation ([live event] rows, hidden from
   *  students when debug is off), "say" = student-facing tutor line */
  kind?: "event" | "say";
  /** paced reveal: number of chars of `text` currently revealed (streaming) */
  reveal?: number;
}

/* ---- Adaptive lesson modes (learn / review) ---- */

export type LessonMode = "learn" | "review";

export interface LessonLo {
  id: string;
  label: string;
  description: string | null;
  sourcePage: number | null;
  mastery: number;
}

/** Compact stored-figure reference (lesson grounding + figure library). */
export interface LessonViz {
  id: string;
  kind: string;
  loId: string;
  caption: string | null;
  sourcePage: number | null;
}

/** One selectable school lesson (module + syllabus_ref group of LOs). */
export interface LessonInfo {
  slug: string; // "u1-1", "geo1-2" — LO-id prefix, URL-safe
  ref: string; // "Lesson 1-1" (syllabus_ref)
  title: string;
  moduleId: string;
  moduleLabel: string;
  courseId: string | null; // "course:prep3-math-en" — module's part_of course
  /** registry lookup of `courseId`; `null` = course not in the registry */
  subject: Subject | null;
  los: LessonLo[];
  /**
   * Where the lesson comes from in its book (FR-4311, the `course_lessons`
   * store): printed section number(s) and title, "part n of m", chapter
   * introduction. Present only for a course whose book provenance changes
   * what it shows — one with a split, merged or promoted lesson
   * (`bookShapedCourses`, lib/section-label.ts). Absent for every National
   * course, whose lessons keep exactly the number and title they had.
   */
  provenance?: LessonProvenance;
}

export interface LessonData {
  slug: string; // "u1-1"
  lessonRef: string; // "Lesson 1-1"
  title: string; // "Cartesian product"
  moduleLabel: string; // "Unit 1 — Relations and Functions"
  courseId: string | null; // "course:prep3-math-en"
  /** selects language contract + grounding rules. Non-null by construction:
   *  a lesson whose course is not in the registry cannot be taught, so
   *  getLessonData throws rather than falling back to another subject. */
  subject: Subject;
  los: LessonLo[];
  questions: SpineQuestion[];
  visuals: LessonViz[];
  /** distinct base-map ids referenced by this lesson's stored map_scene
   *  visuals (≤2, first-appearance order) — keys the server-side gazetteer
   *  injection into the social lesson data block (Wave 1). */
  mapBases: string[];
  /** the course's source document title (social lessons only — names
   *  كتاب الوزارة in the data block); null for math (byte-identical prompts) */
  docTitle: string | null;
  studentName: string;
  /** the resolved demo student the mastery numbers belong to — rendered into
   *  the data block so a switched student is never mislabeled as id 1 */
  studentId: number;
  /** the student's own grade (lib/profile.ts GRADES, or the legacy "prep-3"
   *  form) — never a fixed literal, so a grade-7 or grade-12 student is never
   *  narrated as "grade 10" in the prompt. */
  grade: string;
  /** the register the tutor addresses them in (FR-2602) — read from the one
   *  profile query per turn, so a change lands on the next turn (FR-2606).
   *  `null` is "not recorded", which is NOT the masculine: see lib/address.ts. */
  gender: Gender;
  /**
   * The widgets of the lesson's own unit, for a course whose registry facts
   * say its widgets come from its unit's live widget questions
   * (`CourseTutorFacts.lessonWidgets === "module-questions"`, feature 003,
   * FR-1209). Most used first. Absent for every other course, whose widget
   * list is the unit map in `lib/widget-docs.ts` — so their prompts are
   * unchanged.
   */
  unitWidgets?: readonly string[];
  /**
   * True when `unitWidgets` includes "curve_sketcher" AND this unit's live
   * bank holds one drawn from one of the five families `curve_sketcher_g10`
   * documents (hyperbola, exponential, sine, cosine, tangent) rather than only
   * the original two (linear, quadratic) — set only for a course whose
   * widgets come from its unit's live questions (feature 003, T417). The
   * National unit map never sets it, so its prompts are unaffected.
   */
  hasG10CurveFamily?: boolean;
  /** The lesson's book provenance — as `LessonInfo.provenance`, same rule. */
  provenance?: LessonProvenance;
  /**
   * The subjects a `{{switch_subject:…}}` handoff may name for THIS student:
   * those with a course she may see (FR-4006; the 2026-09-26 isolation
   * audit). Set by `buildLessonContext` from her scope, so the tutor never
   * offers a handoff that lands on a course she cannot open (an American
   * student has no Social Studies; the old rule sent her to a 404). Absent =
   * not narrowed — the prompt-capture harness, which has no student — and the
   * rule then reads exactly as it always has.
   */
  handoffSubjects?: readonly SpineSubject[];
}

/**
 * A curated cross-subject connection (`relates_to` edge) touching one of the
 * current lesson's LOs (Wave 1.5, multi-subject spine §5). `otherLo` is the
 * far endpoint (in ANOTHER subject); the tutor MAY surface it as ONE gentle
 * grounded hint at the natural moment — it is never fabricated. */
export interface LessonBridge {
  thisLo: string;
  thisLabel: string;
  otherLo: string;
  otherLabel: string;
  otherSubject: SpineSubject;
  rationale: string;
}

export type Verdict = "got_it" | "nearly" | "needs_work";

export interface UnderstandingCheck {
  id: number;
  mode: LessonMode;
  score: number; // 0–100
  verdict: Verdict;
  strengths: string[];
  gaps: string[];
  nextStep: string;
  turns: number;
}

export interface AttemptResult {
  /** this attempt's own row id — carried back so a following attempt can
   *  link to it via `retry_of_attempt_id` (Socratic-probing confirmation
   *  retries; see api/attempts/route.ts). */
  attemptId: number;
  isCorrect: boolean;
  correctAnswer: string;
  solution: SolutionStep[];
  loId: string;
  loLabel: string;
  oldScore: number;
  newScore: number;
  /** Which instrument produced this attempt (ADR-0009). Every comparison
   *  metric can be sliced by it, so widget evidence is never silently pooled
   *  with question evidence. */
  modality?: "question" | "widget";
  /** The lesson slug this attempt advanced the student TO (ADR-0020), or null
   *  when the pointer did not move — the common case. Carried back so a caller
   *  can tell that the lesson just completed, rather than having to re-derive
   *  it from the mastery numbers and get a different answer. */
  advancedTo?: string | null;
  /** Whether the learning session this attempt joined probes (ADR-0021) —
   *  its answer for this request, narrowed to maths in learn mode. The
   *  client's cards follow this, never a flag of their own. **Present only
   *  when the attempt was written inside a learn-mode lesson sitting**
   *  (`attemptProbingDeclaration`); absent — from any other session, or an
   *  older server — the client keeps what it last had. */
  probing?: boolean;
  /** The named error, when the question itself named it: a chosen distractor
   *  for multiple choice, a construction predicate for a widget. Null means we
   *  do not know why the answer was wrong, which is a real answer. */
  diagnosis?: { misconceptionId: string; via: string } | null;
  /** The library entry actually served for that error — the thing the student
   *  should read next. Null when none is authored yet (the gap is logged). */
  refutation?: {
    misconceptionId: string | null;
    entryId: string;
    entryType: string;
    reviewed: boolean;
    steps: { step: number; text_md: string }[];
  } | null;
}

/* ---- Per-subject roll-up (Wave 1.5 — subject home; never blended) ---- */

/**
 * One subject's overview for the student home. Mastery is rolled up ONLY
 * within a subject — the product never shows a single blended score across
 * math and social (docs/specs/multi-subject-spine.md §4). */
export interface SubjectSummary {
  subject: SpineSubject; // "math" | "social"
  courseId: string | null;
  courseLabel: string; // course node label (math LTR / social Arabic)
  avgMastery: number; // 0–1, over this subject's current-mastery rows
  weakestLo: { id: string; label: string; mastery: number } | null;
  lessonsCount: number; // distinct teachable lessons in this subject
  /** the subject's default lesson slug for "continue" (first in teach order) */
  defaultSlug: string | null;
  lastCheck: {
    score: number;
    verdict: Verdict;
    mode: LessonMode;
    createdAt: string;
  } | null;
  /**
   * The subject's split book sections, "k of m parts mastered" each, in
   * catalogue order (FR-4314). Empty for a course with no split section —
   * every National course — so nothing its card shows changes.
   */
  sections: SectionProgress[];
}
