export type Tier = "basic" | "standard" | "advanced";

/**
 * Subject key, derived from the lesson's course node in the graph
 * (ADR-0004 Wave 0): course:prep3-math-en → "math-en",
 * course:prep3-social-ar → "social-ar". Selects the language contract and
 * grounding hard rules injected into every tutor prompt.
 */
export type Subject = "math-en" | "social-ar";

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

export interface Provenance {
  source: string;
  sourceSha256: string;
  sourcePage: number | null;
  sourceNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  extractor: string | null;
  extractorVersion: string | null;
  extractionFinishedAt: string | null;
}

export interface SpineQuestion {
  id: string;
  loId: string;
  tier: Tier;
  questionType: "mcq" | "numeric";
  stem: string;
  choices: Choice[] | null;
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
  orderInParent: number;
  layer: number;
  prereqIds: string[];
  baseline: number;
  current: number;
}

export interface SpineData {
  los: SpineLo[];
  edges: { src: string; dst: string }[];
  questions: SpineQuestion[];
  doc: {
    title: string;
    publisher: string;
    edition: string;
    grade: string;
    subject: string;
  };
  syllabusVersion: string;
  baselineDate: string;
  currentDate: string;
  counts: { los: number; questions: number; edges: number; attempts: number };
  studentName: string;
}

export type PlanReason = "weakest" | "review" | "stretch";

export interface PlanItem {
  questionId: string;
  loId: string;
  loLabel: string;
  loScore: number;
  tier: Tier;
  questionType: "mcq" | "numeric";
  stem: string;
  choices: Choice[] | null;
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
  capped?: boolean;
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
  subject: Subject;
  los: LessonLo[];
}

export interface LessonData {
  slug: string; // "u1-1"
  lessonRef: string; // "Lesson 1-1"
  title: string; // "Cartesian product"
  moduleLabel: string; // "Unit 1 — Relations and Functions"
  courseId: string | null; // "course:prep3-math-en"
  subject: Subject; // selects language contract + grounding rules
  los: LessonLo[];
  questions: SpineQuestion[];
  visuals: LessonViz[];
  studentName: string;
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
  isCorrect: boolean;
  correctAnswer: string;
  solution: SolutionStep[];
  loId: string;
  loLabel: string;
  oldScore: number;
  newScore: number;
}
