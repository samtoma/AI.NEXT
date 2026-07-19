export type Tier = "basic" | "standard" | "advanced";

export interface Choice {
  key: string;
  text: string;
}

export interface SolutionStep {
  step: number;
  text_md: string;
}

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
  los: LessonLo[];
}

export interface LessonData {
  slug: string; // "u1-1"
  lessonRef: string; // "Lesson 1-1"
  title: string; // "Cartesian product"
  moduleLabel: string; // "Unit 1 — Relations and Functions"
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
