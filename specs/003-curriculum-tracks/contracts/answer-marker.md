# Contract: the maths-expression marker

**Files**: new `app/src/lib/answer-marker.ts`, new `app/src/lib/answer-marker.test.mts`;
`app/src/app/api/attempts/route.ts`; new `app/src/components/chat/MathAnswerInput.tsx` in
`app/src/components/chat/ChatQuestionCard.tsx`
**Decision**: 20 (Samuel, 2026-09-25), amending 14 · **Enforces**: FR-4320, FR-4303, SC-212 ·
**Carries**: 001 FR-C03 (deterministic server-side grading), FR-1205's principle (grade the property
asked)

## Why

In the Grade 10 book, 54% of exercise items cannot be marked by today's `grade()`
(`api/attempts/route.ts`), and 1,111 have a maths-expression answer (S0 report §4). `grade()` compares
a number or an exact string. Even the book's own decimal comma fails: `3,317` parses as 3.

## Where the answer spec lives

In the question's existing `choices` JSON, the way widgets carry theirs (ADR-0009):

```jsonc
{ "marker": {
    "kind": "expression" | "equation" | "values" | "interval" | "coordinates" | "surd" | "recurring",
    "key": "<canonical LaTeX>",           // written by S3 (T337) in the marker's canonical form
    "form": null | "factorised" | "expanded" | "simplest" | { "subject": "x" },
    "variables": ["x", "y"],              // the letters the student may use
    "tolerance": null | { "abs": 1e-9 }   // numeric kinds only
} }
```

`question_type` stays `'short'`, and no CHECK is widened. The marker path is taken **only** when
`choices.marker` is present, so every existing question keeps today's path.

## Behaviour

`mark(answer: string, spec: MarkerSpec): { result: "correct" | "incorrect" | "wrong_form" | "unreadable", form?: string }`

1. **Normalise both the answer and the key** (decision 15):
   - a decimal comma reads as a point;
   - `(x; y)` reads as `(x, y)`;
   - `×`, `·` and implicit multiplication are one product;
   - `−` is minus;
   - whitespace is ignored.
2. **Parse.** Accept typed maths and LaTeX. On a parse failure return `unreadable`. The route then
   asks the student to re-enter; it is **never** recorded as wrong.
3. **Equivalence** by kind:
   - `expression`: symbolic equivalence where the library can decide it. Otherwise numeric
     equivalence at several random points in the variables' domain, with a fixed seed, so the result
     is deterministic.
   - `equation`: equivalent solution sets, or proportional equations where that is what is asked.
   - `values`: the same multiset, in any order ("x = 2 or x = −3", "4 and 5"). A set is a `values` key
     (`\{(1, 2), (1, 3)\}`): its braces are dropped and its elements, pairs included, matched in any order.
     Where the decimal-comma reading gives the wrong shape for the key ("{(1,3),(1,2)}" read as single values,
     "3,1,2" as the wrong count), the comma-as-separator reading is taken (Tamer, 2026-10-16, for the Prep-3
     book records; an answer the decimal reading already marks correct is never re-read).
   - `interval`: the same set, whether written in inequality, interval or set notation, with endpoint
     inclusion checked.
   - `coordinates`: ordered-pair equality, component by component.
   - `surd`: exact equality ($2\sqrt{3}$ = $\sqrt{12}$), with decimals refused where the question asks
     for an exact answer.
   - `recurring`: equal rational values.
4. **Form check**, when `spec.form` is set. An equivalent answer not in the asked form returns
   `wrong_form` with the form's name, for example "factorised". The route tells the student which form
   is asked. This is required: equivalence alone would accept $x^2 - 9$ for "factorise $x^2 - 9$".
5. **Deterministic and local**: the same input always gives the same result, and **no language model
   is called**.

## The route

`api/attempts/route.ts`:
- If `choices.marker` is present, call `mark`:
  - `correct` or `incorrect` → recorded as today, and mastery updates as today;
  - `wrong_form` → not recorded as an attempt; the response is `{ "retry": "wrong_form", "form": … }`;
  - `unreadable` → not recorded; the response is `{ "retry": "unreadable" }`.
- If it is absent, today's `grade()` runs, **byte for byte unchanged**.

## Library or approach — decided at gate T413 (Samuel), 2026-09-25

**Decided: build the marker in-house. No third-party library ships.** Samuel, third round, answer 2:
*"Build our own (Recommended)."* Recorded as [ADR-0025](../../../docs/decisions/0025-answer-marker-build-in-house.md).

The evaluation (`marker-evaluation.md`) measured, against 8,620 labelled cases built from the book's
own printed answers (not the 1,111 estimate this contract first named — that was the S0 report's
early typing pass; the built test set found 861 in the marker's declared scope and 253 out of it, each
named):

| Candidate | Result |
|---|---|
| **Built-in engine (no library)** — exact BigInt rationals + seeded float64 sampling | **100.0% on all 8,620 cases.** 0.03 ms p50 / 0.13 ms p95. 10.6 KB gzipped, no dependency. **Chosen.** |
| CortexJS Compute Engine, `isIdenticallyEqual` as the engine | Also 100.0%, but ~7× slower at p95 and ~940 KB gzipped from a 0.x package that published a new version the day of the evaluation. Its own `isEqual` (structural) scores only 87.1% and cannot be used as delivered. |
| nerdamer / mathjs / Algebrite | Each fails a case the book actually hits (exponent laws, algebraic fractions with an expanded denominator, or a multi-second mark that would block the server); none reads all three of the student's typing styles (LaTeX, ASCII, phone Unicode) |
| A SymPy sidecar | Not built: two JavaScript routes already score 100%, so a sidecar would add a network hop and a second service for no correctness gain |

The engine sits behind `mark(answer, spec, engine)`, so a symbolic engine (Compute Engine remains the
evaluated candidate) can be plugged in later — for trigonometric identities or calculus, where
sampling alone is a weaker proof — without rewriting the front end (notation, kinds, forms) every
candidate needed built regardless of which engine decided equality. Full method, the test-set
construction, and every number above: `marker-evaluation.md`.

## Tests (`answer-marker.test.mts`, `@covers FR-4320`, SC-212)

- Every Grade 10 printed answer of an expression kind, typed as printed → `correct`.
- For each kind, at least three equivalent rewrites → `correct`.
- Wrong-form negatives for every `form` value → `wrong_form`.
- Decimal comma and `(x; y)` inputs → marked by meaning.
- Unreadable inputs → `unreadable`.
- A replay of every recorded attempt of the existing courses through the route: results are identical
  (the marker path is never taken for them).

## Amendment: the book's short forms (Tamer, 2026-10-29), Proposed, for Samuel

The Prep-3 book records showed 83 agreed answers that the app could not mark. About 60 of them were short
answers in notation the marker did not read. This amendment makes four additions. Each is deterministic,
and none changes the result for an answer the marker already read; the Grade 10 fixture still passes in
full.

- **`form: "dms"`**, an angle in degrees, minutes and seconds. The marker reads `34° 36′ 0″`, `34°36'0''`
  and `34^\circ 36'` as the number 34 + 36/60. It does this before `normalise`, because ′ is also the
  recurring mark.
  - With `form: "dms"`, the same angle written as a decimal (34.6) is `wrong_form: dms`, not wrong.
  - With `form: "decimal"`, the angle typed back in minutes is `wrong_form: decimal`.
  - The student reads: "That's the right angle, but the question asks for it in degrees, minutes and
    seconds".
- **`tolerance` on an `expression` with no variables**: a number, like σ ≈ 1.483 or an angle to the
  second. `markExpression` already honoured a tolerance. The bundle schema now allows one on a number.
  An expression with letters stays exact.
- **The empty set** in the `values` kind: `∅`, `Ø`, `\emptyset`, `\varnothing`, `{}` and "the empty set"
  all read as `{}`. `φ` and `ϕ` also read as `{}`, except where the question declares φ as a variable.
- **`R − {a, b}`** in the `interval` kind (also `ℝ \ {…}` and `\mathbb{R} \setminus \{…\}`): this is the
  book's notation for a domain, and it reads as `x ≠ a and x ≠ b`. The 12 live Prep-3 questions whose
  key is a domain could not be answered in the book's own notation before this.

On the compile side, `compile_book_records.short_form` types these answers. It also types the answers
from a closed list of words as multiple choice, a path that is `grade()`'s and unchanged:
- a relation between two lengths: <, =, >;
- a straight line and a circle: secant, tangent, outside;
- the number of solutions of a pair of equations: none, one, infinitely many;
- "an infinite number" for a single "how many".

A domain asked as a new part of an answer is numbered `-pd<k>`, so the parts asked before keep the ids
their attempts are recorded against.
