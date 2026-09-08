/**
 * Bayesian Knowledge Tracing — the mastery update for the MVP 1.0 comparison
 * build (ADR-0007, FR-301, contracts/bkt.md).
 *
 * Replaces the Elo-style update that lived inline in /api/attempts:
 *     new = old + K * (outcome - old)      // K = 0.15
 * which is an exponential moving average over exactly the evidence BKT consumes.
 * The storage shape is unchanged — `mastery.score` was already a bitemporal REAL
 * in 0..1 — so every read path keeps working; only the meaning of the number and
 * the rule that produces it change.
 *
 * This module is PURE: no database, no clock, no I/O, no randomness. The caller
 * owns persistence and the transaction. That is what makes the six invariants in
 * contracts/bkt.md testable without a database.
 */

export type Observation = "correct" | "incorrect";

export type BktParams = {
  /** P(L0) — prior probability the skill is already known. */
  pInit: number;
  /** P(T) — probability of learning it on this opportunity. */
  pTransit: number;
  /** P(G) — probability of answering correctly without knowing. */
  pGuess: number;
  /** P(S) — probability of answering incorrectly while knowing. */
  pSlip: number;
};

export type BktEvidence = {
  observation: Observation;
  /** the estimate before this observation */
  prior: number;
  /** after conditioning on the observation, before the learning step */
  posterior: number;
  /** after the learning step, clamped — this is what gets stored as `score` */
  afterTransit: number;
};

/**
 * Literature defaults (Corbett–Anderson starting points), with one deliberate
 * choice: pInit is 0.30 because that is exactly the prior the Elo implementation
 * already used for an unseen LO. Holding it identical means cold-start behaviour
 * does not lurch between the two environments for a reason unrelated to the
 * hypothesis under test.
 *
 * pGuess sits above pSlip because a meaningful share of the 450-item bank is
 * multiple choice, where guessing right is genuinely easier than slipping.
 */
export const DEFAULT_PARAMS: BktParams = {
  pInit: 0.3,
  pTransit: 0.1,
  pGuess: 0.2,
  pSlip: 0.1,
};

/**
 * Retained from the Elo implementation, and load-bearing under BKT.
 *
 * Unclamped, BKT saturates: after a long correct run P(L) approaches 1.0 so
 * closely that a subsequent wrong answer cannot meaningfully move it, and the
 * estimate stops responding to evidence. That would make this model WORSE than
 * the Elo one it replaces, in precisely the dimension the comparison measures.
 * See contracts/bkt.md invariant 3.
 */
export const MIN_SCORE = 0.02;
export const MAX_SCORE = 0.98;

const clamp = (v: number) => Math.min(MAX_SCORE, Math.max(MIN_SCORE, v));

function assertSane(p: BktParams): void {
  for (const [name, v] of Object.entries(p)) {
    if (!Number.isFinite(v) || v <= 0 || v >= 1) {
      throw new Error(`BKT parameter ${name}=${v} must be strictly between 0 and 1`);
    }
  }
  if (p.pGuess + p.pSlip >= 1) {
    // Guess + slip >= 1 inverts the evidence: a correct answer would lower the
    // estimate. Fail loudly rather than quietly teach backwards.
    throw new Error(
      `BKT parameters degenerate: pGuess (${p.pGuess}) + pSlip (${p.pSlip}) must be < 1`
    );
  }
}

/**
 * One observation → one updated belief.
 *
 * Evidence step, then learning step:
 *   correct:    P(L|obs) = p(1-S)      / [ p(1-S) + (1-p)G     ]
 *   incorrect:  P(L|obs) = pS          / [ pS     + (1-p)(1-G) ]
 *   then:       P(L')    = P(L|obs) + (1 - P(L|obs)) * T
 */
export function bktUpdate(
  prior: number,
  observation: Observation,
  params: BktParams = DEFAULT_PARAMS
): BktEvidence {
  assertSane(params);

  const p = clamp(prior);
  const { pTransit: T, pGuess: G, pSlip: S } = params;

  const numerator = observation === "correct" ? p * (1 - S) : p * S;
  const denominator =
    observation === "correct"
      ? p * (1 - S) + (1 - p) * G
      : p * S + (1 - p) * (1 - G);

  // assertSane rules out a zero denominator for any prior in [MIN, MAX], but a
  // guard here means a future parameter change degrades to "no update" rather
  // than writing NaN into a student's mastery row.
  const posterior = denominator > 0 ? numerator / denominator : p;
  const afterTransit = clamp(posterior + (1 - posterior) * T);

  return { observation, prior: p, posterior, afterTransit };
}
