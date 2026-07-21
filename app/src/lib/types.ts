export type Tier = "basic" | "standard" | "advanced";

/**
 * Spine-graph subject dimension (Wave 1.5 multi-subject spine).
 * Sourced from the `node_subject` DB view (course join); falls back to the
 * `lo:soc*` id-prefix convention when the view isn't present yet. Distinct from
 * the lesson-prompt `Subject` above ("math-en"/"social-ar") — this is the
 * graph-territory key: math and social are separate territories, bridged by
 * exception. See docs/specs/multi-subject-spine.md §2.
 */
export type SpineSubject = "math" | "social";

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
  /** graph-territory key (math | social) — Wave 1.5 */
  subject: SpineSubject;
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
  /** distinct base-map ids referenced by this lesson's stored map_scene
   *  visuals (≤2, first-appearance order) — keys the server-side gazetteer
   *  injection into the social lesson data block (Wave 1). */
  mapBases: string[];
  /** the course's source document title (social lessons only — names
   *  كتاب الوزارة in the data block); null for math (byte-identical prompts) */
  docTitle: string | null;
  studentName: string;
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
  isCorrect: boolean;
  correctAnswer: string;
  solution: SolutionStep[];
  loId: string;
  loLabel: string;
  oldScore: number;
  newScore: number;
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
}
