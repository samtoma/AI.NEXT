# 003 — The maths-expression marker: evaluation for gate T413

**Status**: Evaluation for Samuel. **Nothing here is decided.** Gate T413 is Samuel's; if he accepts a
recommendation, WP-DOC records it as ADR-0025 and the gate goes into [decisions.md](./decisions.md) →
*Gate record*.
**Contract**: [contracts/answer-marker.md](./contracts/answer-marker.md) · **Enforces**: FR-4320, FR-4303,
SC-212 · **Author**: WP-M (backend), 2026-09-25. Uncommitted.

## 1. Recommendation

**Use no library. Own the marker in the app's TypeScript and keep a `MarkerEngine` seam.**

The marker has three jobs:

1. Reading what a student types, and the key.
2. Knowing the kinds and the forms.
3. Deciding whether two expressions are equal.

Every candidate library needed jobs 1 and 2 written by us anyway:

- None of them reads the book's notation.
- None of them reads the student's typing in all three styles (ASCII, phone Unicode and LaTeX).
- None of them knows "several values", intervals or ±.
- None of them checks a form.

The equality job is where the libraries differ, and the best one (CortexJS Compute Engine) turns out to
decide it by evaluating both sides at sample points. Our built-in engine does the same, but exactly (BigInt
rationals) wherever the expression is rational.

Measured on 8,620 cases built from the book's own printed answers:

- **The prototype, with no library, marks all 8,620 cases as labelled.** Every printed answer typed as
  printed is correct. Every wrong-form rewrite is refused. No near-miss is accepted.
- **It takes 0.03 ms per mark (p50) and 0.13 ms at p95.**
- **It adds 10.6 KB gzipped and no dependency.**

The same prototype with Compute Engine plugged in as the engine also scores 100%. But it is about 7×
slower at p95, adds about 940 KB gzipped (45 MB installed), and is a 0.x package that published a new
version on the day of this evaluation.

Each of the other three fails in a way the book would hit:

- **nerdamer** refuses right answers under the exponent laws (chapter 2);
- **Algebrite** refuses right answers to algebraic fractions (§1.8), and one of its marks took 76 s;
- **mathjs** took 31 s over one quartic from exercise 1-4.

A SymPy sidecar is **not needed**: two JavaScript routes score 100% (the built-in engine and Compute
Engine). A sidecar would add a network hop to every marked attempt, and a second service to deploy and
monitor.

## 2. The test set

It is built from the book's own printed answers, not invented.

**Source.** The appendix *Solutions to exercises* (printed pp. 497–514) holds 2,281 answer leaves.

**Rebuilding the printed maths.** The PDF text layer flattens the maths: `x2 + 8 + 16 x2` is really
x² + 8 + 16/x². So every leaf is rebuilt as LaTeX from glyph geometry, with no model:

- fraction bars and radical vinculums are drawn rules;
- superscripts and subscripts are baseline offsets;
- recurring dots are accents over digits.

**Checks on the rebuild:**

- The leaf segmentation is the S0 scout's own, replayed: 2,281 of 2,281 leaves match it on label and on
  text.
- No glyph is lost or invented: 2,281 of 2,281 leaves have the same glyph multiset as their text layer.
- A visual spot-check of 48 random answers, each crop against its LaTeX, found 48 of 48 right.

**Scope.** The S0 report's maths-expression types cover **1,114 leaves**. The report's "1,111" is the same
set counted per EPUB item.

- **861 are in the marker's scope.** By kind: 410 expression, 225 values, 90 equation, 49 surd,
  46 interval, 33 coordinates, 8 recurring.
- **253 are out of scope, each with a stated reason** (the fixture lists every one):
  - 89 are verbal or mixed words, for multiple choice or a worked example;
  - 41 are a function's or a segment's name, for multiple choice;
  - 21 are a number with a unit, and 7 are a plain number: today's numeric path;
  - 41 are several answers in one (mean/median/mode; two equations; a point and a range; (i)/(ii)),
    which S3 splits into separate questions;
  - 9 ask for "standard form" of an equation, a form the contract does not have;
  - 6 are number-line figures read as text, 6 are geometric statements, and 4 keys contain ≈;
  - 3 contain the book's multiplication dot (§5);
  - the rest (about 24) are keys the oracle could not read: angle hats, two chained equalities, a
    non-real number.

**Forms.** 156 items require factorised, 135 simplest, 105 expanded and 17 "make _v_ the subject". The
form comes from the exercise's and the question's own words ("Factorise:", "Write your answer in expanded
form (not factorised)").

**Cases per item.** 8,620 in all:

| Case type | Count | What it is |
|---|---|---|
| Typed as printed | 2,583 | The key's LaTeX (what a math field sends), an ASCII typing (`^`, `sqrt()`, `pi`) and a phone Unicode typing (`²`, `√`, `π`, `−`, decimal comma, `;`) |
| Equivalent | 2,317 | Rewrites: reordered, expanded, factorised, other notations for sets, intervals and recurring decimals |
| Near-miss | 2,081 | Realistic slips: a sign, a coefficient, an exponent, a value dropped, an endpoint's inclusion flipped |
| Wrong form | 732 | Equivalent answers in a form the question does not accept |
| Unreadable | 861 | Truncated input |

**Labels.** SymPy labels every case through its own parsers, never through a candidate. A variant whose
label disagreed with its intent was dropped; 11 were, and each drop was a generator artefact.

**Where it lives.** The fixture is `app/scripts/marker-eval/g10-marker-testset.json`. It regenerates
byte-identically from the PDF and the S0 scan outputs with the three scripts beside it.

## 3. Results

**Engine mode.** Our front end, kinds and forms, with the candidate deciding "are these two expressions
equal?" symbolically. The built-in engine is the no-library option. Figures are from this Mac (Node 25);
the box was not measured (§7).

| Engine | All cases | Typed as printed | Equivalents | Near-misses refused | Wrong form refused | p50 / p95 ms | Deterministic |
|---|---|---|---|---|---|---|---|
| **Built-in: exact rationals + seeded float64** | 100.0% (8,620/8,620) | 100.0% | 100.0% | 100.0% | 100.0% | 0.029 / 0.129 (max 5.2) | yes |
| Compute Engine `isIdenticallyEqual` | 100.0% (8,620/8,620) | 100.0% | 100.0% | 100.0% | 100.0% | 0.101 / 0.892 (max 10.8) | yes |
| Compute Engine `isEqual` | 87.1% (7,504/8,620) | 99.8% | 81.1% | 100.0% | 10.4% | 0.09 / 0.503 (max 11.4) | yes |
| nerdamer `expand`/`simplify(a−b)` | 99.8% (8,606/8,620) | 100.0% | 99.7% | 100.0% | 99.1% | 0.065 / 2.269 (max 202.2) | yes |
| mathjs `symbolicEqual`, then `rationalize(a−b)` (1-in-10 sample, 2 s cap per mark: 7 timed out) | 94.1% (811/862) | 98.7% | 95.9% | 96.9% | 60.5% | 1.614 / 31.643 (max 2000) | not re-run |
| Algebrite `simplify(a−b)` | 99.8% (8,602/8,620) | 100.0% | 99.7% | 100.0% | 98.7% | 0.62 / 12.409 (max 76021.2) | yes |

**Native mode.** The library alone, on the expression and surd items. It parses the answer itself, with
only decision 15's notation applied, and uses its own equality. There is no form check, because none of
the libraries has one.

| Library | Typed as printed: LaTeX / ASCII / Unicode | Equivalents | Near-misses refused | Wrong form refused | Unreadable detected |
|---|---|---|---|---|---|
| Compute Engine (reads LaTeX) | 99.8% / 81.6% / 91.6% | 91.8% | 96.6% | 12.6% | 100.0% |
| nerdamer | 59.3% / 99.8% / 39.6% | 79.9% | 99.8% | 18.4% | 100.0% |
| mathjs (1-in-10 sample, 2 s cap: 7 timed out) | 24.2% / 98.2% / 35.0% | 55.4% | 94.1% | 51.4% | 100.0% |
| Algebrite | 24.2% / 94.6% / 38.3% | 32.4% | 66.2% | 57.6% | 100.0% |

In native mode, "wrong form refused" counts any verdict other than correct, errors included. It is not a
form check.

What the failures are:

- **mathjs** cannot prove (x+1)² = x²+2x+1 with `symbolicEqual`, because its `simplify` does not expand
  powers. Its `rationalize` does expand, so it was given that as a second route. That route is
  pathologically slow: **31 s** to compare two forms of 8a⁴ − 12a³b + 2a²b² + 3ab³ − b⁴ (exercise 1-4/3f),
  and 8 s for 1-6/20.

  A mark is a synchronous call, so it would block the Node server for every student while it ran. The
  full run did not finish, so the rows are a 1-in-10 sample with a 2 s cap per mark, run in a worker that
  is killed at the cap; 7 of 862 marks hit it.

  Even within the cap, mathjs cannot prove that an expanded form equals a factorised key. So 29 of 66
  wrong-form answers came back `incorrect` instead of `wrong_form`: the student is told "wrong" when the
  answer is right but in the wrong form. It also cannot prove one key equal to itself. Natively it reads
  `4xy` as 4 times a variable called `xy`, and it reads no LaTeX.
- **nerdamer** fails the exponent laws (3^{2a+3} vs 27·3^{2a}), which the whole Exponents chapter needs.
  Natively its LaTeX reader returns wrong results for plain keys such as `2y^{2}+8y`, and it cannot read
  `²`.
- **Algebrite** fails equivalent algebraic fractions whenever the denominator is written expanded:
  `1/(x²−2x−8)` for 1/((x−4)(x+2)). That is the §1.8 Simplify exercise, marked wrong for a right answer.
  - It is slow: p99 65 ms, and one mark took **76 s**.
  - It reads no LaTeX.
  - It has not been released since June 2022.
- **Compute Engine**, alone, reads LaTeX perfectly, but it reads typed `sqrt(8)` as s·q·r·t·8 and
  `x^(3t−3)` as invalid. Its structural `isEqual` refuses 19% of the true equivalents.

**No candidate accepted a single near-miss**, in either mode. Each one errs towards refusing a right
answer, which the student experiences as being marked wrong for a correct answer.

### Size, licence, maintenance

| | Built-in | Compute Engine | mathjs | nerdamer | Algebrite |
|---|---|---|---|---|---|
| Bundled, minified / gzipped | 29 KB / 10.6 KB | 3.3 MB / 943 KB | 671 KB / 191 KB | 443 KB / 166 KB | 362 KB / 87 KB |
| Installed | — | 45 MB | 16 MB | 1.8 MB | 3.1 MB |
| Version, licence | ours | 0.135.0, MIT | 15.2.0, Apache-2.0 | 1.1.13, MIT | 1.4.0, MIT |
| Last published | — | 2026-09-25 | 2026-04-07 | 2026-09-19 | 2022-06-13 |

### Determinism

Every run but mathjs's was repeated, and no verdict changed. The fast engines were re-run on all 8,620
cases, and Algebrite on its first 600. mathjs's capped sample was run once.

- **The built-in engine** uses fixed-seed rational sample points: the same 64 points every time, for a
  given set of variable names.
- **Compute Engine's identity check** (`isIdenticallyEqual`) was read in its source. It evaluates at fixed
  points, then at points from a PRNG seeded by the two expressions' hashes. That is deterministic, and it
  is the same technique as the built-in engine, in float64 only.

## 4. The prototype

**Files:**

- `app/src/lib/answer-marker.ts` (≈1,700 lines, no imports);
- `app/src/lib/answer-marker.test.mts` (25 tests, all passing):

  ```sh
  node --import ./scripts/ts-resolver.mjs --test src/lib/answer-marker.test.mts
  ```

It is **not wired** into `api/attempts`, and nothing imports it yet.

**The pipeline:**

- **Front end.** Decision 15's normalisation, a tokenizer, and a recursive-descent parser for typed maths
  and for the keys' LaTeX, into one small AST.
  - A letter run is split into single-letter variables: `4xy` is 4·x·y. The exceptions are function
    names and the spec's own multi-letter names (θ, `m_{PR}`, `T_{n-1}`).
  - There is no `eval` and no `Function`, and a test asserts it. Sample environments have no prototype.
- **Kinds.** All seven kinds are structural code over the AST.
  - Values are compared as a multiset, with ± expanded.
  - Intervals are one set, read from inequalities, interval notation, set-builder notation or unions, and
    they honour ℤ and ℕ.
  - An equation with an explicit key (v = R) must hold on the key's graph, on every ± branch, and fail
    just off it. Otherwise the two sides' residuals must be proportional.
- **Engine.** The default is `numericEngine`. It evaluates at 64 seeded points, and the second half of
  them are positive-only so that radicands such as A − πR² have a domain.
  - The arithmetic is exact (BigInt) wherever the expression is rational, and float64 at a relative
    tolerance of 1e-9 otherwise.
  - Any library can be plugged in through `mark(answer, spec, engine)`.
- **Form checks.** These are relative to the printed key (§6.1).
- **Key safety.** A key that cannot be read, or that does not mark itself correct, throws
  `MarkerKeyError`: it is a content defect, never "please re-enter". `validateKey()` is the check the
  loader (T337) should run on every key before a course goes live. The route (T416) must treat the error
  as a server error, logged, and record no attempt.

## 5. For S3 (T337) and the solutions gate: what the book's keys need

These must never be corrected silently (FR-4302). The book gets them wrong, or ambiguous:

- **The printed answer is not in the asked form:**
  - 1-5/15 prints `7a+4` for "Factorise";
  - 1-11/29n prints a sum for "Factorise";
  - 1-6/14 prints `(4k−2)(4k+2)`, with a common factor left in both brackets;
  - 1-10/3h and 1-10/3i are not in lowest terms (`2(k+2)/((k²+2)(k+2))`).

  The marker measures forms against the printed key, so these keys still accept the book's own answer.
  They should be listed at the solutions gate.
- **The book's raised multiplication dot.** 6-5/7e `j(x) = 2.3^x` means 2·3^x, and 2-2/9 is the same.
  Decision 15 reads `2.3` as a decimal, so S3 must write `\cdot` in these keys.
- **Prime factorisation (1-11/28, 5 items).** "Represent as a product of prime factors" with key 11×13
  would be marked correct for `143` by today's numeric path. The item needs a form the contract lacks, or
  multiple choice.
- **Key format.** The marker reads keys in the LaTeX the book uses:
  - a decimal comma is fine;
  - a mixed number is `8\frac{4}{5}`;
  - a recurring decimal is `0,\dot{2}\dot{1}`;
  - a named point is `M(1;3)`.

## 6. Decisions for Samuel

1. **Gate T413: the approach.** The recommendation is the built-in engine, no library (§1). The
   alternative is Compute Engine as the engine, for a symbolic-proof path later (trigonometric
   identities, calculus); it would cost the size and churn in §3.
2. **The meaning of each form (FR-4320's "a spec rule, pending Samuel").** The prototype implements the
   following, always relative to the printed key:
   - **Factorised** means the answer is a product with at least as many non-constant factors as the key,
     and no more brackets holding a common factor than the key has. So (2x+2)(x−1) is the wrong form for
     2(x+1)(x−1).
   - **Expanded** means a sum of monomials, with like terms collected.
   - **Simplest** means no numeric power left unevaluated (3²), no like factors left apart (a·a), and a
     total degree, as one fraction, no larger than the key's.
   - **Subject** means _v_ is isolated on one side and the other side is equivalent, ± included. So
     b² = c² − a² is the wrong form for b = ±√(c² − a²), and b = √(c² − a²) is incorrect.
3. **`1/2x` is ambiguous.** The prototype returns it as unreadable ("add brackets"), and never guesses.
   The alternative is a fixed reading, which marks wrong every student who meant the other one.
4. **A decimal for an exact surd** (`0,866` for √3/2) is returned as `wrong_form` with form `exact`, not
   `incorrect`, so the student is told to give the exact answer.
5. **A recurring-decimal question answered with the fraction** (`7/33` for 0,2̇1̇) is correct under the
   contract's "equal rational values". If the question is "write as a decimal", that is the wrong form.
   A `decimal` form would close the gap (8 items).
6. **Smaller readings the prototype chose:**
   - The degree sign is notation, and ignored.
   - An inequality's letter is not checked: `x > 0` for `k > 0` is correct.
   - Bare values for a two-variable key (`13 and −1`) are read in the key's order.
   - `2,3` with no `;` in a values or coordinates answer is read in the shape the key expects.
   - An answer of the wrong shape is returned for re-entry, never marked wrong. Examples are a number for
     an interval question, or `3x+12` for "find the equation of the line". The reason names the expected
     shape ("not an equation", "not an inequality or an interval"). The alternative is `incorrect`.

## 7. Not done, or unsure

- **The box was not measured.** All latencies are from this Mac. The built-in engine has headroom of
  three orders of magnitude, but the contract asks for the box.
- **The test set's typing styles are ours, not students'.** Real typing will differ. The pilot should log
  every `unreadable` input: that list is the parser's to-do list.
- **The equality test is sampling.** It needs agreement at 8 exact rational points, or at least 4 where
  the domain is narrow. Two different rational expressions cannot agree there except in freak cases. For
  surds and π the float tolerance is 1e-9. No false accept was seen in 2,081 near-misses.
- **SC-212's replay passes, but trivially.** The recorded attempts are those of the existing courses (see
  the replay below), and none of their questions carries a marker spec yet.
- **The input control (T417, WP-F) is not built.** The marker reads plain typing and LaTeX, so a MathLive
  field (LaTeX) and a plain text field with a KaTeX preview both work.

## Replay (SC-212)

`app/scripts/marker-eval/replay-attempts.mts` replays every recorded attempt through the T416 dispatch:
the marker only when `choices.marker` is present, and today's `grade()` otherwise.

**How it is kept honest:**

- It carries a verbatim copy of `grade()`, and refuses to run unless that copy is byte-identical to the
  one in `route.ts`. When T416 moves `grade()` into a module, the copy becomes an import.
- It reads each database inside `BEGIN READ ONLY`, which gives the effect of replaying from a copy without
  making one.

**Result, 2026-09-25:**

| Database | Attempts | Dispatch equals `grade()` | Questions with a marker spec | `grade()` today equals stored `is_correct` |
|---|---|---|---|---|
| `ainext_poc` | 1,535 (MCQ 1,021, numeric 514) | 1,535 | 0 | 1,535 |
| `ainext_mvp1` | 10 | 10 | 0 | 10 |

## Reproduce

**Fixture.** Build it with `app/scripts/marker-eval/{extract_answers,classify,build_testset}.py`; the
steps are in the header of `build_testset.py`.

**Candidate comparison.** It ran in a throwaway directory with its own `package.json`, which is not in the
repo:

```sh
npm i mathjs nerdamer algebrite @cortex-js/compute-engine
node run-engines.mjs <builtin|ce|ce-isEqual|mathjs|nerdamer|algebrite> <engine|native>
node summarize.mjs
```

WP-M can add it under `app/scripts/marker-eval/` once a dependency is allowed.
