/**
 * How `/api/attempts` marks a typed or chosen answer (T416; FR-4320, 001 FR-C03, SC-212).
 *
 * Two markers, and the question decides which one runs:
 *
 *  - **`choices.marker` present** → the maths-expression marker (`lib/answer-marker.ts`, ADR-0025). Its
 *    `correct`/`incorrect` is recorded like any attempt. Its `wrong_form` and `unreadable` are NOT
 *    verdicts: the route writes nothing and asks the student again with `message` (FR-4320: an unreadable
 *    answer is never marked wrong; an equivalent answer in another form is never marked correct).
 *  - **absent** → `grade()`, today's grader, byte for byte. Every existing course's numbers and choices are
 *    marked exactly as before (FR-C03). `scripts/marker-eval/replay-attempts.mts` proves it on every
 *    recorded attempt, against a frozen copy of this function that must stay byte-identical to it.
 *
 * Widget attempts never come here: the route grades their predicate (ADR-0009).
 *
 * Pure: no database, no request, no clock. The route owns the unit of work around it.
 */
import { evaluateArithmeticExpression } from "./arithmetic";
import { mark, readMarkerSpec, reentryMessage, type MarkerEngine } from "./answer-marker";

export function grade(
  questionType: string,
  correct: string,
  given: string
): boolean {
  if (questionType === "numeric") {
    const a = parseFloat(correct);
    if (!Number.isNaN(a)) {
      const trimmedGiven = given.trim();
      // The common case: a clean numeric literal, no working shown.
      if (/^[+-]?\d+(\.\d+)?$/.test(trimmedGiven)) {
        return Math.abs(a - parseFloat(trimmedGiven)) < 1e-6;
      }
      // The student typed the steps that lead to the answer ("3x4" for 12)
      // instead of the final value. Evaluate deterministically — no model
      // call — before falling back to treating it as text.
      const evaluated = evaluateArithmeticExpression(trimmedGiven);
      if (evaluated !== null) return Math.abs(a - evaluated) < 1e-6;
      const b = parseFloat(trimmedGiven);
      if (!Number.isNaN(b)) return Math.abs(a - b) < 1e-6;
    }
  }
  return correct.trim().toLowerCase() === given.trim().toLowerCase();
}

/**
 * The route's 422 body when an answer goes back for re-entry. Nothing was recorded: no attempt row, no
 * mastery change, no session opened. `form` names the form asked; `message` is the student's copy.
 */
export interface AttemptRetry {
  retry: "wrong_form" | "unreadable";
  /** wrong_form only: "factorised", "expanded", "simplest", "subject:x", "exact" or "decimal". */
  form?: string;
  /** unreadable only: what the marker could not read (never the student's text). */
  reason?: string;
  message: string;
}

export type AnswerVerdict =
  | { verdict: "graded"; isCorrect: boolean; by: "marker" | "grade" }
  | ({ verdict: "retry" } & AttemptRetry);

/**
 * Mark a non-widget answer. The marker runs only when the question carries `choices.marker`; otherwise
 * today's `grade()` runs unchanged. Throws `MarkerKeyError` when the question's spec or key is a content
 * defect: the route turns that into a logged server error and records nothing.
 */
export function markAnswer(
  q: { question_type: string; correct_answer: string; choices: unknown },
  given: string,
  engine?: MarkerEngine
): AnswerVerdict {
  const spec = q.question_type === "widget" ? null : readMarkerSpec(q.choices);
  if (!spec) return { verdict: "graded", isCorrect: grade(q.question_type, q.correct_answer, given), by: "grade" };
  const r = mark(given, spec, engine);
  if (r.result === "correct" || r.result === "incorrect") {
    return { verdict: "graded", isCorrect: r.result === "correct", by: "marker" };
  }
  if (r.result === "wrong_form") return { verdict: "retry", retry: "wrong_form", form: r.form, message: reentryMessage(r) };
  return { verdict: "retry", retry: "unreadable", reason: r.reason, message: reentryMessage(r) };
}
