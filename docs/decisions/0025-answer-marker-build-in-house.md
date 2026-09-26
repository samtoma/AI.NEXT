# ADR-0025 — The maths-expression marker is built in-house, no third-party library

**Status**: Accepted — Samuel, 2026-09-25, gate T413, third round of decisions, answer 2: *"Build our
own (Recommended)."* Recorded in [`specs/003-curriculum-tracks/decisions.md`](../../specs/003-curriculum-tracks/decisions.md),
decision 23 (marking-rules detail: decision 24).
**Not committed** (worktree rule: no commits from this session).
**Amends**: nothing — this is a new capability. **Extended by**: spec 003 FR-4320 (the requirement),
[`contracts/answer-marker.md`](../../specs/003-curriculum-tracks/contracts/answer-marker.md) (the
interface), [`marker-evaluation.md`](../../specs/003-curriculum-tracks/marker-evaluation.md) (the
evidence this ADR is decided from).
**Affects**: `app/src/lib/answer-marker.ts` (new, ≈1,700 lines, no imports — written and evaluated
ahead of this decision, not yet wired in), `app/src/lib/answer-marker.test.mts` (new, 25 tests),
`app/src/app/api/attempts/route.ts` (T416, not yet done — dispatches to the marker only when
`choices.marker` is present; every other question keeps today's `grade()` path byte for byte),
`app/src/components/chat/MathAnswerInput.tsx` (T417, not yet built), `app/package.json` /
`package-lock.json` (**unaffected** — this decision adds no dependency).
**Related**: ADR-0008 (generated question bank — the same "grounded, deterministic, server-side"
discipline this marker follows), ADR-0009 (widgets as questions — the same "server grades the
property asked for" principle FR-1205 states and FR-4320 extends to typed maths answers),
constitution Principle II (grounded teaching — no model ever marks a student's answer).

## Context

54% of the Grade 10 book's exercise items cannot be marked by today's `grade()`
(`api/attempts/route.ts`): it compares a number or an exact string, and even the book's own decimal
comma fails (`3,317` parses as `3`). 1,111 of the book's items have a maths-expression answer —
algebraic expressions, equations, several values, intervals, coordinate pairs, exact surds and
recurring decimals — and FR-4303/FR-4320 (spec 003, decision 20) commit the product to marking them
by mathematical equivalence rather than forcing all of them into multiple choice they were not
written for.

Four candidate approaches existed: build the equality engine ourselves; use a JavaScript computer
algebra system as that engine, keeping our own front end for reading notation, kinds and forms; call
out to a Python (SymPy) sidecar; or some mix. WP-M (backend) built a prototype of the first option and
then measured all the JavaScript candidates against it, using a **test set built from the book's own
printed answers, not invented**: 8,620 labelled cases (typed-as-printed in three notations, equivalent
rewrites, realistic near-misses, wrong-form answers, and unreadable input), derived from the
appendix's 2,281 answer leaves by rebuilding the PDF's flattened maths as LaTeX from glyph geometry,
checked leaf-for-leaf against the S0 scout's own segmentation and glyph multiset, and spot-checked
visually. Full method and results: `marker-evaluation.md`.

## Options considered

1. **No library — an in-house engine.** A recursive-descent parser for typed maths and for the keys'
   LaTeX into one small AST; equality decided by evaluating both sides at fixed, seeded sample points
   (exact BigInt rationals wherever the expression is rational, float64 at 1e-9 relative tolerance
   otherwise); form checks (factorised / expanded / simplest / subject) as structural code over the
   AST, relative to the printed key.
   - **Scores 100.0% on all 8,620 cases.** 0.03 ms p50 / 0.13 ms p95 per mark. Adds 10.6 KB gzipped,
     no dependency.
   - Cost: we own the correctness of the equality engine and its edge cases, not a maintainer.
2. **CortexJS Compute Engine as the equality engine**, our own front end for everything else.
   - Also scores 100.0% (`isIdenticallyEqual`, which evaluates at fixed points then at points from a
     PRNG seeded by the two expressions' hashes — deterministic, the same technique as option 1, in
     float64 only). Its own `isEqual` (structural) scores only 87.1% and refuses 90% of wrong-form
     negatives, so it cannot be used as delivered; `isIdenticallyEqual` is the only usable mode.
   - **~7× slower at p95** (0.892 ms vs 0.129 ms), **adds ~940 KB gzipped / 45 MB installed**, and is
     a 0.x package (`0.135.0`) that published a new version the day of the evaluation.
   - Reading LaTeX natively is excellent, but reading a student's typed `sqrt(8)` or `x^(3t−3)` is
     not (misparsed or invalid) — we would still write and own the typed-input reader.
3. **nerdamer, mathjs, Algebrite** (native or as the engine under option 1's front end). Each fails in
   a way the book actually hits: nerdamer refuses the exponent laws the whole "Exponents" chapter
   needs; Algebrite refuses right answers to algebraic fractions whenever the denominator is written
   expanded (the book's own §1.8 exercise) and one mark took 76 seconds; mathjs cannot prove an
   expanded form equals a factorised key at all (28 of 66 wrong-form answers would be told "wrong"
   when they are right but in the wrong form) and one mark took 31 seconds — a synchronous call that
   would block the Node server for every student while it ran. None reads all three input styles
   (LaTeX, ASCII, phone Unicode) either.
4. **A SymPy sidecar.** Rejected without building it: two JavaScript routes already score 100%, so a
   sidecar would only add a network hop to every marked attempt and a second service to deploy,
   monitor and keep warm, for no correctness gain.

No candidate — including the built-in engine — accepted a single one of the 2,081 realistic near-miss
cases in either mode. Every option errs toward refusing a right answer, which is the safer failure for
a student (told to re-check, never told a correct answer is wrong) — except mathjs and Algebrite's
wrong-form failures above, which are the opposite and worse failure.

## Decision

**Build the marker in-house. No third-party computer-algebra library ships.** The built-in engine
(exact BigInt rationals + seeded float64 sampling) is the marking engine behind a
`mark(answer: string, spec: MarkerSpec, engine): MarkResult` seam
([`contracts/answer-marker.md`](../../specs/003-curriculum-tracks/contracts/answer-marker.md)), so a
symbolic engine can be plugged in later — for trigonometric identities or calculus, where sampling
alone is a weaker proof — without rewriting the front end (notation, kinds, forms) that every
candidate needed built regardless of which engine decided equality.

Pinned with it, from `marker-evaluation.md` §6 (Samuel, third round, decision 24, *"as recommended"*):

- `1/2x` is ambiguous and is **always** read as unreadable ("add brackets"), never guessed.
- A decimal answer to a question whose key is an exact value (a surd, π) returns `wrong_form: exact`,
  not `incorrect` — the student is told to give the exact answer, not told they are wrong.
- A fraction answered for a recurring-decimal key is accepted as mathematically equal, **except** the
  8 items that explicitly ask "write as a decimal", which require a decimal and mark the fraction as
  the wrong form.
- An answer of the wrong shape (a plain number for an interval question, an expression for "find the
  equation of the line") is returned for re-entry, never marked wrong.
- No language model is ever asked to mark an answer (constitution Principle II). A question whose key
  is a number or a multiple-choice option keeps today's `grade()` path, byte for byte (FR-C03,
  SC-212).

## Consequences

**Enabled.** 861 of the Grade 10 book's 1,111 maths-expression answers are in the marker's declared
scope today (the rest are named individually in `marker-evaluation.md` §2, each with the reason it is
out — verbal answers, several-answers-in-one items S3 will split, "standard form" items the contract
has no rule for, and about 24 the oracle itself could not read). Zero new runtime dependency, zero
new network hop, and marking stays a synchronous, sub-millisecond, deterministic server call — the
same operational shape as today's `grade()`.

**Cost, stated plainly.** We now own the correctness of a computer-algebra equality check rather than
delegating it to a maintained library. `marker-evaluation.md` §7 names what is not yet proven: the
box itself was not measured (only this Mac); the test set's typing styles are the evaluation's own,
not real students' (the pilot must log every `unreadable` input as the parser's own to-do list); the
equality test is sampling, not a symbolic proof, so a `MarkerEngine` seam is kept deliberately open for
a symbolic route later rather than closed off by this decision; and SC-212's attempts-replay passes
today only because no existing course's questions carry a marker spec yet, so it proves the dispatch
is safe, not that the engine is — that second proof arrives with the Grade 10 book's answers.

**What still needs building** (unaffected by this decision, tracked as its own tasks): wiring the
marker into `api/attempts/route.ts` (T416) and building the typed-maths input control (T417,
`MathAnswerInput.tsx`). Until both land, `answer-marker.ts` is proven by its own test suite and the
evaluation's replay, not by a student ever using it.

**Revisit when**: trigonometric identities, calculus, or another proof-shaped item type enters the
marker's scope, at which point sampling-only equality is the weaker proof and the `MarkerEngine` seam
is where a symbolic engine (Compute Engine remains the evaluated candidate) would plug in — a new
decision, not a reopening of this one.
