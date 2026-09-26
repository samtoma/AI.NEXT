import type { AttemptResult } from "./types";
import type { AttemptRetry } from "./attempt-grading";

/**
 * The maths-expression marker sent the answer back for re-entry (T416, FR-4320): a form the question does
 * not ask for, or not readable as maths — or a choice question's option that is true but less precise
 * than the key (`less_specific`, Samuel's G2 answer 20). The server recorded NOTHING. Thrown rather than returned, so a
 * caller that does not know about re-entry treats it as a failed request — never as a wrong answer.
 */
export class AttemptRetryError extends Error {
  readonly retry: AttemptRetry;
  constructor(retry: AttemptRetry) {
    super(retry.message);
    this.retry = retry;
  }
}

/**
 * The one client-side path to POST /api/attempts. Pulled out of
 * ChatQuestionCard's own submit() (wip/socratic-probing-route-b) so ChatCore
 * can grade a chat-typed answer ({{answer_submitted:…}}) through the exact
 * same call a tapped card makes — one grading pipeline with two entry
 * points, not two pipelines that could drift apart.
 */
export async function submitAttempt(params: {
  questionId: string;
  givenAnswer: string;
  timeMs: number;
  /** Widget attempts only (ADR-0009) — never set from the chat-text path,
   *  a construction has no free-text equivalent. */
  predicate?: string;
  /** Socratic probing: set when this attempt is the same-tier sibling
   *  confirming a pending LO (migration 027). A request, not a decision: the
   *  server records the link only when the learning session it joins was
   *  opened with probing on (ADR-0021). */
  retryOfAttemptId?: number;
}): Promise<AttemptResult> {
  const res = await fetch("/api/attempts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      questionId: params.questionId,
      givenAnswer: params.givenAnswer,
      timeMs: params.timeMs,
      ...(params.predicate != null ? { predicate: params.predicate } : {}),
      ...(params.retryOfAttemptId != null
        ? { retryOfAttemptId: params.retryOfAttemptId }
        : {}),
    }),
  });
  if (res.status === 422) {
    const body = (await res.json().catch(() => null)) as Partial<AttemptRetry> | null;
    if (
      body &&
      (body.retry === "wrong_form" || body.retry === "unreadable" || body.retry === "less_specific") &&
      typeof body.message === "string"
    ) {
      throw new AttemptRetryError(body as AttemptRetry);
    }
  }
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}
