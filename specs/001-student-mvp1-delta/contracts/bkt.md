# Contract: Mastery Update (BKT)

**Module**: `app/src/lib/bkt.ts` · **Tests**: `app/src/lib/bkt.test.mts`
**Replaces**: the inline Elo update in `app/src/app/api/attempts/route.ts` (`K = 0.15`)

## Interface

```ts
export type BktParams = {
  pInit: number;      // P(L0) — prior probability the skill is already known
  pTransit: number;   // P(T)  — probability of learning it on this opportunity
  pGuess: number;     // P(G)  — probability of a correct answer without knowing
  pSlip: number;      // P(S)  — probability of a wrong answer while knowing
};

export type BktEvidence = {
  observation: "correct" | "incorrect";
  prior: number;
  posterior: number;      // after conditioning on the observation
  afterTransit: number;   // after the learning step — this is the stored score
};

export const DEFAULT_PARAMS: BktParams;           // 0.30 / 0.10 / 0.20 / 0.10

export function bktUpdate(
  prior: number,
  observation: "correct" | "incorrect",
  params?: BktParams
): BktEvidence;
```

`bktUpdate` is **pure**: no database, no clock, no I/O. The caller persists.

## Behaviour

```
correct:    posterior = p(1−S)              / [ p(1−S) + (1−p)G       ]
incorrect:  posterior = pS                  / [ pS     + (1−p)(1−G)   ]
then:       afterTransit = posterior + (1 − posterior) · T
finally:    afterTransit clamped to [0.02, 0.98]
```

## Invariants (each is a test)

1. **Direction** — a correct observation never decreases the estimate; an incorrect one never
   increases it, before the transit step.
2. **Range** — output is always within `[0.02, 0.98]` for any prior in `[0, 1]` and any valid params.
3. **Clamp is load-bearing** — from prior `0.98`, a long run of correct answers must not saturate such
   that a subsequent incorrect answer cannot move the estimate. Regression test: 20 correct then 1
   incorrect must produce a strictly lower value than the run's peak.
4. **Cold start parity** — with no evidence, the estimate equals `pInit` (0.30), matching the Elo
   implementation's prior, so cold-start behaviour does not differ between environments for reasons
   unrelated to the hypothesis.
5. **Degenerate params rejected** — `pGuess + pSlip >= 1` throws rather than silently inverting the
   update's meaning.
6. **Determinism** — same inputs, same output. No randomness anywhere in the path.

## Persistence contract (caller's obligation)

Inside the existing transaction in `/api/attempts`:

1. `SELECT ... FOR UPDATE` the current mastery row (`system_to IS NULL`) — unchanged.
2. `prior = row.score ?? params.pInit`.
3. `evidence = bktUpdate(prior, observation, rowParams)`.
4. Close the current row (`system_to = now()`), insert a new one with `score = evidence.afterTransit`
   and the full `evidence` JSON plus `attempt_id`, `question_id`, `misconception_id`, `confidence`.
5. Commit. Mastery history is append-only; rows are never mutated.

## What does not change

Grading stays deterministic and server-side (numeric tolerance `1e-6`, else normalised text compare).
Only the number grading produces changes. `lib/mastery.ts` colouring, `lib/ask.ts` and `lib/lesson.ts`
read paths are untouched — they consume `score` in 0..1 exactly as before.
