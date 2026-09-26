"""Generate the question bank from parameterised template families.

    uv run generate_questions.py --out bundle.json [--per-family 10] [--seed 7]

WHY TEMPLATES RATHER THAN FREE AUTHORING. Samuel authorised generated questions
on the condition that he reviews 10% (ADR-0008). A 10% sample of 450 freely
authored items tells you almost nothing: each item is its own risk, and the 90%
you did not read are 405 independent chances to put broken mathematics in front
of a child.

A template family changes what the sample means. Every item in a family has the
same structure and differs only in sampled numbers, and the answer key is
COMPUTED from those numbers by the same code that builds the stem — so
arithmetic cannot disagree with the question. Reading one instance therefore
validates the family, and a 10% sample of families is a real control rather
than a gesture. What remains reviewable by a human is exactly what a human is
needed for: is this a fair question, is the wording unambiguous, is the
distractor really the mistake it claims to be.

The residual risk is honest and worth stating: a family can be uniformly wrong.
If a template's mathematics is misconceived, every instance is misconceived
identically, and the sample catches it only if the sampled instance is read
carefully. That is why families are small, why each carries its own worked
solution derived from the same computation, and why `verify()` re-derives every
answer independently of the builder before anything is written.

Each item links to a reviewed book question through `parent_question_id`, so a
rejected family can be traced and retired as a unit.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path
from typing import Callable

# --------------------------------------------------------------------------
# formatting helpers — one place, so notation never drifts between families
# --------------------------------------------------------------------------


def num(x) -> str:
    """Render a number the way the textbook would: no trailing .0, no -0."""
    if isinstance(x, Fraction):
        if x.denominator == 1:
            return num(x.numerator)
        # The minus belongs OUTSIDE the fraction. \frac{-1}{5} is what a
        # generator writes; -\frac{1}{5} is what the textbook writes, and a
        # student copying the former learns to write it that way.
        sign = "-" if x.numerator < 0 else ""
        return rf"{sign}\frac{{{abs(x.numerator)}}}{{{x.denominator}}}"
    if isinstance(x, float):
        if abs(x - round(x)) < 1e-9:
            x = int(round(x))
        else:
            s = f"{x:.2f}".rstrip("0").rstrip(".")
            return s
    if x == 0:
        return "0"
    return str(x)


def paren(x) -> str:
    """Wrap a negative in brackets so nothing ever renders as "1 - -1"."""
    return f"({num(x)})" if (not isinstance(x, str)) and x < 0 else num(x)


def signed(x) -> str:
    """' + 3' / ' - 3', for building expressions without '+ -3'."""
    return f" + {num(x)}" if x >= 0 else f" - {num(abs(x))}"


def linear(a, b, var: str = "x") -> str:
    """ax + b with the degenerate cases written the way a person writes them."""
    if a == 0:
        return num(b)
    head = var if a == 1 else (f"-{var}" if a == -1 else f"{num(a)}{var}")
    return head if b == 0 else f"{head}{signed(b)}"


def quadratic(a, b, c, var: str = "x") -> str:
    head = f"{var}^2" if a == 1 else (f"-{var}^2" if a == -1 else f"{num(a)}{var}^2")
    mid = "" if b == 0 else (f" + {var}" if b == 1 else f" - {var}" if b == -1 else f"{signed(b)}{var}")
    tail = "" if c == 0 else signed(c)
    return f"{head}{mid}{tail}"


def pair(x, y) -> str:
    return f"({num(x)},\\ {num(y)})"


def setof(items) -> str:
    return "\\{" + ",\\ ".join(num(i) for i in items) + "\\}"


def frac(n, d) -> str:
    return rf"\frac{{{num(n)}}}{{{num(d)}}}"


def step(i: int, text: str) -> dict:
    return {"step": i, "text_md": text}


# --------------------------------------------------------------------------
# family plumbing
# --------------------------------------------------------------------------


@dataclass
class Item:
    lo_id: str
    tier: str
    question_type: str
    stem: str
    correct_answer: str
    canonical_solution: list
    parent_question_id: str
    source_page: int | None = None
    choices: list | None = None
    family: str = ""

    def as_question(self, qid: str) -> dict:
        q = {
            "id": qid,
            "lo_id": self.lo_id,
            "tier": self.tier,
            "question_type": self.question_type,
            "source": "variant",
            "parent_question_id": self.parent_question_id,
            "source_page": self.source_page,
            "source_note": f"Generated from template family {self.family}.",
            "stem": self.stem,
            "correct_answer": self.correct_answer,
            "canonical_solution": self.canonical_solution,
        }
        if self.choices:
            q["choices"] = self.choices
        return q


@dataclass
class Family:
    id: str
    lo_id: str
    parent: str
    page: int | None
    build: Callable[[random.Random], Item]
    misconceptions: list = field(default_factory=list)


REGISTRY: list[Family] = []
MISCONCEPTIONS: dict[str, dict] = {}


def mc(mid: str, lo_id: str, label: str, description: str) -> str:
    MISCONCEPTIONS[mid] = {
        "id": mid,
        "lo_id": lo_id,
        "label": label,
        "description": description,
    }
    return mid


def family(fid: str, lo_id: str, parent: str, page: int | None = None):
    def deco(fn):
        REGISTRY.append(Family(fid, lo_id, parent, page, fn))
        return fn

    return deco


def mcq(correct: str, wrong: list[tuple[str, str | None]], rng: random.Random):
    """Build a 4-option MCQ.

    Options are SHUFFLED. A generator that always keys 'A' teaches the student
    to answer A, and would quietly inflate every score in the comparison.
    Duplicates are dropped rather than rendered — two options with the same text
    make one of them unselectable and the item unanswerable as written.
    """
    seen = {correct}
    # (text, misconception_id, is_correct). Correctness is carried explicitly:
    # inferring it from "this option has no misconception" breaks the moment a
    # distractor is plausible but unlabelled, which is a legitimate distractor
    # and not every wrong answer names a named error.
    opts = [(correct, None, True)]
    for text, mid in wrong:
        if text in seen:
            continue
        seen.add(text)
        opts.append((text, mid, False))
    if len(opts) < 4:
        return None
    opts = opts[:4]
    rng.shuffle(opts)
    choices = []
    answer_key = None
    for k, (text, mid, is_correct) in zip(["A", "B", "C", "D"], opts):
        entry = {"key": k, "text": text}
        if mid:
            entry["misconception_id"] = mid
        choices.append(entry)
        if is_correct:
            answer_key = k
    return choices, answer_key


# ==========================================================================
# UNIT 1 — Relations and Functions
# ==========================================================================

M_EQ_SWAP = mc("mc:pair-components-swapped", "lo:u1-1-1",
               "First and second components matched crosswise",
               "Equates the first component of one pair with the second of the other instead of like with like.")
M_EQ_SIGN = mc("mc:transposition-sign", "lo:u1-1-1",
               "Sign lost when transposing",
               "Moves a term across the equals sign without changing its sign.")


@family("tpl:u1-1-1:equality", "lo:u1-1-1", "q:u1-1-1:002", 7)
def _u111(rng):
    a, b = rng.randint(2, 12), rng.randint(2, 12)
    x, y = a + rng.randint(2, 9), b + rng.randint(2, 9)
    # (x - a, y) = (p, y' ) style: x - a = p  and  q = y + b
    p = x - a
    q = y + b
    ans = x * y
    stem = (f"If ${pair(f'x - {num(a)}', num(q))} = {pair(num(p), f'y + {num(b)}')}$, "
            f"find the value of $x \\times y$.")
    return Item(
        lo_id="lo:u1-1-1", tier="standard", question_type="numeric",
        stem=stem, correct_answer=num(ans),
        canonical_solution=[
            step(1, f"Two ordered pairs are equal when like components are equal."),
            step(2, f"First components: $x - {num(a)} = {num(p)}$, so $x = {num(x)}$."),
            step(3, f"Second components: ${num(q)} = y + {num(b)}$, so $y = {num(y)}$."),
            step(4, f"$x \\times y = {num(x)} \\times {num(y)} = {num(ans)}$."),
        ],
        parent_question_id="q:u1-1-1:002", source_page=7, family="tpl:u1-1-1:equality")


@family("tpl:u1-1-1:solve-mcq", "lo:u1-1-1", "q:u1-1-1:003", 7)
def _u111b(rng):
    a, b = rng.randint(1, 9), rng.randint(1, 9)
    x, y = rng.randint(2, 14), rng.randint(2, 14)
    stem = (f"If ${pair(f'a - {num(a)}', f'b + {num(b)}')} = {pair(num(x - a), num(y + b))}$, "
            f"then the ordered pair $(a,\\ b) =$ ?")
    built = mcq(f"${pair(x, y)}$", [
        (f"${pair(y, x)}$", M_EQ_SWAP),
        (f"${pair(x - 2 * a, y)}$", M_EQ_SIGN),
        (f"${pair(x, y + 2 * b)}$", M_EQ_SIGN),
    ], rng)
    if not built:
        return None
    choices, key = built
    return Item(
        lo_id="lo:u1-1-1", tier="advanced", question_type="mcq",
        stem=stem, correct_answer=key, choices=choices,
        canonical_solution=[
            step(1, f"First components: $a - {num(a)} = {num(x - a)}$, so $a = {num(x)}$."),
            step(2, f"Second components: $b + {num(b)} = {num(y + b)}$, so $b = {num(y)}$."),
            step(3, f"The ordered pair is ${pair(x, y)}$. Order matters: ${pair(x, y)}$ and ${pair(y, x)}$ are different pairs unless $a = b$."),
        ],
        parent_question_id="q:u1-1-1:003", source_page=7, family="tpl:u1-1-1:solve-mcq")


# mc:cardinality-added (this generator's old id, never emitted: every family on its objective is
# numeric) denotes the catalogue's mc:u1-1-3:product-is-sum; pointed at the live entry, with its own wording,
# so nothing here can re-create an unrefuted duplicate (FR-1115).
M_PROD_SUM = mc("mc:u1-1-3:product-is-sum", "lo:u1-1-3",
    "Cardinalities added instead of multiplied",
    "Computes n(X) + n(Y) where n(X) x n(Y) is required.")


@family("tpl:u1-1-2:cardinality", "lo:u1-1-2", "q:u1-1-2:001", 8)
def _u112(rng):
    nx, ny = rng.randint(2, 7), rng.randint(2, 7)
    ans = nx * ny
    stem = (f"If $n(X) = {num(nx)}$ and $n(Y) = {num(ny)}$, find $n(X \\times Y)$.")
    return Item(
        lo_id="lo:u1-1-2", tier="basic", question_type="numeric",
        stem=stem, correct_answer=num(ans),
        canonical_solution=[
            step(1, "Every element of $X$ pairs with every element of $Y$."),
            step(2, f"$n(X \\times Y) = n(X) \\times n(Y) = {num(nx)} \\times {num(ny)} = {num(ans)}$."),
        ],
        parent_question_id="q:u1-1-2:001", source_page=8, family="tpl:u1-1-2:cardinality")


@family("tpl:u1-1-2:inverse", "lo:u1-1-2", "q:u1-1-2:001", 8)
def _u112b(rng):
    nx, ny = rng.randint(2, 8), rng.randint(2, 8)
    total = nx * ny
    stem = (f"The set $X \\times Y$ has ${num(total)}$ elements and $n(Y) = {num(ny)}$. Find $n(X)$.")
    return Item(
        lo_id="lo:u1-1-2", tier="standard", question_type="numeric",
        stem=stem, correct_answer=num(nx),
        canonical_solution=[
            step(1, f"$n(X \\times Y) = n(X) \\times n(Y)$."),
            step(2, f"${num(total)} = n(X) \\times {num(ny)}$, so $n(X) = {num(total)} \\div {num(ny)} = {num(nx)}$."),
        ],
        parent_question_id="q:u1-1-2:001", source_page=8, family="tpl:u1-1-2:inverse")


M_QUADRANT = mc("mc:quadrant-from-x-only", "lo:u1-1-4",
                "Quadrant named from the first coordinate alone",
                "Chooses the quadrant from the sign of x without checking the sign of y.")

QUADRANT_NAME = {1: "the first quadrant", 2: "the second quadrant",
                 3: "the third quadrant", 4: "the fourth quadrant"}


@family("tpl:u1-1-4:quadrant", "lo:u1-1-4", "q:u1-1-4:001", 11)
def _u114(rng):
    x = rng.choice([-1, 1]) * rng.randint(1, 9)
    y = rng.choice([-1, 1]) * rng.randint(1, 9)
    qd = 1 if (x > 0 and y > 0) else 2 if (x < 0 and y > 0) else 3 if (x < 0 and y < 0) else 4
    wrong = [q for q in (1, 2, 3, 4) if q != qd]
    built = mcq(QUADRANT_NAME[qd],
                [(QUADRANT_NAME[wrong[0]], M_QUADRANT),
                 (QUADRANT_NAME[wrong[1]], M_QUADRANT),
                 (QUADRANT_NAME[wrong[2]], M_QUADRANT)], rng)
    if not built:
        return None
    choices, key = built
    return Item(
        lo_id="lo:u1-1-4", tier="basic", question_type="mcq",
        stem=f"The point ${pair(x, y)}$ lies in…",
        correct_answer=key, choices=choices,
        canonical_solution=[
            step(1, f"The first coordinate is {'positive' if x > 0 else 'negative'} and the second is {'positive' if y > 0 else 'negative'}."),
            step(2, f"Both signs together name the quadrant: this is {QUADRANT_NAME[qd]}."),
        ],
        parent_question_id="q:u1-1-4:001", source_page=11, family="tpl:u1-1-4:quadrant")


# mc:range-equals-codomain (this generator's old id, never emitted: every family on its objective is
# numeric) denotes the catalogue's mc:u1-3-2:range-is-codomain; pointed at the live entry, with its own wording,
# so nothing here can re-create an unrefuted duplicate (FR-1115).
M_RANGE_CODOMAIN = mc("mc:u1-3-2:range-is-codomain", "lo:u1-3-2",
    "Range and codomain treated as the same set",
    "Reports the whole codomain as the range; the range is the set of images actually reached.")


@family("tpl:u1-4-1:evaluate", "lo:u1-4-1", "q:u1-4-1:001", 19)
def _u141(rng):
    a = rng.randint(1, 4)
    b = rng.choice([-6, -5, -4, -3, -2, 2, 3, 4, 5])
    c = rng.choice([-9, -6, -4, -1, 1, 3, 5, 7])
    k = rng.choice([-3, -2, -1, 2, 3, 4])
    val = a * k * k + b * k + c
    stem = f"If $f(x) = {quadratic(a, b, c)}$, find $f({num(k)})$."
    return Item(
        lo_id="lo:u1-4-1", tier="standard", question_type="numeric",
        stem=stem, correct_answer=num(val),
        canonical_solution=[
            step(1, f"Substitute $x = {num(k)}$ into $f(x) = {quadratic(a, b, c)}$."),
            step(2, f"$f({num(k)}) = {'' if a == 1 else num(a)}({num(k)})^2{signed(b)}({num(k)}){signed(c)}$."),
            step(3, f"$= {num(a * k * k)}{signed(b * k)}{signed(c)} = {num(val)}$."),
        ],
        parent_question_id="q:u1-4-1:001", source_page=19, family="tpl:u1-4-1:evaluate")


# mc:slope-intercept-swapped (this generator's old id, never emitted: every family on its objective is
# numeric) denotes the catalogue's mc:u1-4-2:intercept-is-slope; pointed at the live entry, with its own wording,
# so nothing here can re-create an unrefuted duplicate (FR-1115).
M_SLOPE_INTERCEPT = mc("mc:u1-4-2:intercept-is-slope", "lo:u1-4-2",
    "Slope and y-intercept exchanged",
    "Reads b as the slope and a as the intercept in f(x) = ax + b.")


@family("tpl:u1-4-2:two-points", "lo:u1-4-2", "q:u1-4-2:002", 20)
def _u142(rng):
    a = rng.choice([-4, -3, -2, 2, 3, 4, 5])
    b = rng.choice([-9, -6, -5, -3, 3, 4, 6, 8])
    x1 = rng.choice([1, 2, 3, 4])
    y1 = a * x1 + b
    stem = (f"The graph of the linear function $f(x) = ax + b$ passes through "
            f"${pair(0, b)}$ and ${pair(x1, y1)}$. Find the value of $a + b$.")
    return Item(
        lo_id="lo:u1-4-2", tier="advanced", question_type="numeric",
        stem=stem, correct_answer=num(a + b),
        canonical_solution=[
            step(1, f"Substituting ${pair(0, b)}$: $f(0) = b = {num(b)}$."),
            step(2, f"Substituting ${pair(x1, y1)}$: ${num(x1)}a{signed(b)} = {num(y1)}$, so ${num(x1)}a = {num(y1 - b)}$ and $a = {num(a)}$."),
            step(3, f"$a + b = {num(a)}{signed(b)} = {num(a + b)}$."),
        ],
        parent_question_id="q:u1-4-2:002", source_page=20, family="tpl:u1-4-2:two-points")


# NO CATALOGUE ENTRY denotes this error (checked 2026-09-25 against every lo:u1-4-3 entry).
# Never emitted today (the family on lo:u1-4-3 is numeric). Do not put it on a distractor until
# the misconceptions package writes the entry; flagged for it.
M_VERTEX_SIGN = mc("mc:vertex-sign", "lo:u1-4-3",
                   "Vertex x-coordinate taken as +b/2a",
                   "Drops the minus sign in x = -b/(2a).")


@family("tpl:u1-4-3:vertex", "lo:u1-4-3", "q:u1-4-3:001", 22)
def _u143(rng):
    a = rng.choice([1, 1, 2])
    h = rng.choice([-4, -3, -2, -1, 1, 2, 3, 4])
    b = -2 * a * h
    c = rng.choice([-5, -3, -1, 0, 2, 4, 6])
    stem = (f"The curve of $f(x) = {quadratic(a, b, c)}$ has an axis of symmetry. "
            f"Find the $x$-coordinate of its vertex.")
    return Item(
        lo_id="lo:u1-4-3", tier="advanced", question_type="numeric",
        stem=stem, correct_answer=num(h),
        canonical_solution=[
            step(1, "The vertex of $f(x) = ax^2 + bx + c$ sits at $x = -\\frac{b}{2a}$."),
            step(2, f"Here $a = {num(a)}$ and $b = {num(b)}$, so $x = \\frac{{-({num(b)})}}{{2({num(a)})}} = {num(h)}$."),
            step(3, "That value is also the equation of the axis of symmetry."),
        ],
        parent_question_id="q:u1-4-3:001", source_page=22, family="tpl:u1-4-3:vertex")


# ==========================================================================
# UNIT 2 — Ratio, proportion and variation
# ==========================================================================

M_RATIO_UNSIMPLIFIED = mc("mc:ratio-not-reduced", "lo:u2-1-1",
                          "Ratio left unreduced",
                          "Writes the ratio in its raw form without dividing by the common factor.")
# mc:cross-multiply-reversed (this generator's old id, never emitted: every family on its objective is
# numeric) denotes the catalogue's mc:u2-2-2:cross-multiplication-reversed; pointed at the live entry, with its own wording,
# so nothing here can re-create an unrefuted duplicate (FR-1115).
M_PROPORTION_CROSS = mc("mc:u2-2-2:cross-multiplication-reversed", "lo:u2-2-2",
    "Cross-multiplication paired incorrectly",
    "Multiplies numerator by numerator and denominator by denominator, or top-to-bottom on the same side.")


@family("tpl:u2-1-1:simplify", "lo:u2-1-1", "q:u2-1-1:001", 30)
def _u211(rng):
    g = rng.choice([2, 3, 4, 5, 6, 7])
    a, b = rng.randint(2, 9), rng.randint(2, 9)
    while a == b:
        b = rng.randint(2, 9)
    if math.gcd(a, b) != 1:
        return None
    stem = f"Write the ratio ${num(a * g)} : {num(b * g)}$ in its simplest form."
    built = mcq(f"${num(a)} : {num(b)}$", [
        (f"${num(a * g)} : {num(b * g)}$", M_RATIO_UNSIMPLIFIED),
        (f"${num(b)} : {num(a)}$", None),
        (f"${num(a + g)} : {num(b + g)}$", M_RATIO_UNSIMPLIFIED),
    ], rng)
    if not built:
        return None
    choices, key = built
    return Item(
        lo_id="lo:u2-1-1", tier="basic", question_type="mcq",
        stem=stem, correct_answer=key, choices=choices,
        canonical_solution=[
            step(1, f"The highest common factor of ${num(a * g)}$ and ${num(b * g)}$ is ${num(g)}$."),
            step(2, f"Divide both terms by ${num(g)}$: ${num(a * g)} \\div {num(g)} = {num(a)}$ and ${num(b * g)} \\div {num(g)} = {num(b)}$."),
            step(3, f"The ratio in simplest form is ${num(a)} : {num(b)}$."),
        ],
        parent_question_id="q:u2-1-1:001", source_page=30, family="tpl:u2-1-1:simplify")


@family("tpl:u2-2-1:fourth", "lo:u2-2-1", "q:u2-2-1:001", 34)
def _u221(rng):
    a = rng.randint(2, 12)
    b = rng.randint(2, 12)
    k = rng.randint(2, 6)
    c = a * k
    d = b * k
    stem = (f"Find the fourth proportional to ${num(a)}$, ${num(b)}$ and ${num(c)}$.")
    return Item(
        lo_id="lo:u2-2-1", tier="standard", question_type="numeric",
        stem=stem, correct_answer=num(d),
        canonical_solution=[
            step(1, f"The fourth proportional $d$ satisfies ${num(a)} : {num(b)} = {num(c)} : d$."),
            step(2, f"Cross-multiplying: ${num(a)} \\times d = {num(b)} \\times {num(c)}$."),
            step(3, f"$d = \\frac{{{num(b)} \\times {num(c)}}}{{{num(a)}}} = {num(d)}$."),
        ],
        parent_question_id="q:u2-2-1:001", source_page=34, family="tpl:u2-2-1:fourth")


@family("tpl:u2-2-3:middle", "lo:u2-2-3", "q:u2-2-3:001", 37)
def _u223(rng):
    m = rng.randint(2, 15)
    a = rng.choice([1, 2, 3, 4, m])
    c = m * m // a if (m * m) % a == 0 else None
    if c is None or c == a:
        return None
    stem = (f"If ${num(a)}$, $x$, ${num(c)}$ are in continued proportion and $x > 0$, find $x$.")
    return Item(
        lo_id="lo:u2-2-3", tier="advanced", question_type="numeric",
        stem=stem, correct_answer=num(m),
        canonical_solution=[
            step(1, "In a continued proportion the middle term is the middle proportional: $x^2 = $ first $\\times$ last."),
            step(2, f"$x^2 = {num(a)} \\times {num(c)} = {num(a * c)}$."),
            step(3, f"$x = {num(m)}$ (the positive root, since $x > 0$)."),
        ],
        parent_question_id="q:u2-2-3:001", source_page=37, family="tpl:u2-2-3:middle")


# mc:direct-inverse-swapped (this generator's old id, never emitted: every family on its objective is
# numeric) denotes the catalogue's mc:u2-3-2:inverse-solved-as-direct; pointed at the live entry, with its own wording,
# so nothing here can re-create an unrefuted duplicate (FR-1115).
M_VARIATION_SWAP = mc("mc:u2-3-2:inverse-solved-as-direct", "lo:u2-3-2",
    "An inverse relationship solved by matching ratios",
    "Applies the direct-variation move — set the two quotients equal and cross-multiply — to a situation where one quantity falls as the other rises.")


@family("tpl:u2-3-1:direct", "lo:u2-3-1", "q:u2-3-1:001", 39)
def _u231(rng):
    k = rng.randint(2, 9)
    x1 = rng.randint(2, 9)
    x2 = rng.randint(2, 12)
    while x2 == x1:
        x2 = rng.randint(2, 12)
    y1, y2 = k * x1, k * x2
    stem = (f"$y$ varies directly as $x$. When $x = {num(x1)}$, $y = {num(y1)}$. "
            f"Find $y$ when $x = {num(x2)}$.")
    return Item(
        lo_id="lo:u2-3-1", tier="standard", question_type="numeric",
        stem=stem, correct_answer=num(y2),
        canonical_solution=[
            step(1, "Direct variation means $y = kx$ for a constant $k$."),
            step(2, f"$k = \\frac{{{num(y1)}}}{{{num(x1)}}} = {num(k)}$."),
            step(3, f"When $x = {num(x2)}$: $y = {num(k)} \\times {num(x2)} = {num(y2)}$."),
        ],
        parent_question_id="q:u2-3-1:001", source_page=39, family="tpl:u2-3-1:direct")


@family("tpl:u2-3-2:inverse", "lo:u2-3-2", "q:u2-3-2:001", 41)
def _u232(rng):
    k = rng.choice([12, 24, 36, 48, 60, 72])
    divisors = [d for d in range(2, k + 1) if k % d == 0 and d <= 24]
    if len(divisors) < 2:
        return None
    x1, x2 = rng.sample(divisors, 2)
    y1, y2 = k // x1, k // x2
    stem = (f"$y$ varies inversely as $x$. When $x = {num(x1)}$, $y = {num(y1)}$. "
            f"Find $y$ when $x = {num(x2)}$.")
    return Item(
        lo_id="lo:u2-3-2", tier="standard", question_type="numeric",
        stem=stem, correct_answer=num(y2),
        canonical_solution=[
            step(1, "Inverse variation means $xy = k$ for a constant $k$."),
            step(2, f"$k = {num(x1)} \\times {num(y1)} = {num(k)}$."),
            step(3, f"When $x = {num(x2)}$: $y = \\frac{{{num(k)}}}{{{num(x2)}}} = {num(y2)}$."),
        ],
        parent_question_id="q:u2-3-2:001", source_page=41, family="tpl:u2-3-2:inverse")


# ==========================================================================
# UNIT 3 — Statistics
# ==========================================================================

M_RANGE_MEAN = mc("mc:range-is-mean", "lo:u3-2-1",
                  "Range confused with the mean",
                  "Averages the values instead of subtracting the smallest from the largest.")


@family("tpl:u3-2-1:range", "lo:u3-2-1", "q:u3-2-1:001", 55)
def _u321(rng):
    vals = sorted(rng.sample(range(3, 60), 6))
    rng_val = vals[-1] - vals[0]
    mean = sum(vals) / len(vals)
    stem = f"Find the range of the values ${setof(vals)}$."
    built = mcq(num(rng_val), [
        (num(round(mean, 2)), M_RANGE_MEAN),
        (num(vals[-1]), None),
        (num(vals[-1] + vals[0]), None),
    ], rng)
    if not built:
        return None
    choices, key = built
    return Item(
        lo_id="lo:u3-2-1", tier="basic", question_type="mcq",
        stem=stem, correct_answer=key, choices=choices,
        canonical_solution=[
            step(1, "The range measures spread: largest value minus smallest value."),
            step(2, f"Largest $= {num(vals[-1])}$, smallest $= {num(vals[0])}$."),
            step(3, f"Range $= {num(vals[-1])} - {num(vals[0])} = {num(rng_val)}$."),
        ],
        parent_question_id="q:u3-2-1:001", source_page=55, family="tpl:u3-2-1:range")


@family("tpl:u3-2-2:stddev", "lo:u3-2-2", "q:u3-2-2:001", 57)
def _u322(rng):
    mean = rng.randint(5, 20)
    offs = rng.choice([[-2, -1, 0, 1, 2], [-4, -2, 0, 2, 4], [-3, -1, 0, 1, 3]])
    vals = [mean + o for o in offs]
    var = sum(o * o for o in offs) / len(offs)
    sd = math.sqrt(var)
    stem = (f"Find the standard deviation of the values ${setof(vals)}$, "
            f"correct to two decimal places.")
    return Item(
        lo_id="lo:u3-2-2", tier="advanced", question_type="numeric",
        stem=stem, correct_answer=f"{sd:.2f}",
        canonical_solution=[
            step(1, f"The mean is $\\frac{{{num(sum(vals))}}}{{{num(len(vals))}}} = {num(mean)}$."),
            step(2, f"The deviations from the mean are ${setof(offs)}$."),
            step(3, f"The mean of their squares is $\\frac{{{num(sum(o * o for o in offs))}}}{{{num(len(offs))}}} = {num(round(var, 4))}$."),
            step(4, f"The standard deviation is $\\sqrt{{{num(round(var, 4))}}} \\approx {sd:.2f}$."),
        ],
        parent_question_id="q:u3-2-2:001", source_page=57, family="tpl:u3-2-2:stddev")


# ==========================================================================
# UNIT 4 — Trigonometry
# ==========================================================================

# mc:dms-read-as-decimal (this generator's old id, never emitted: every family on its objective is
# numeric) denotes the catalogue's mc:u4-1-1:degree-split-decimally; pointed at the live entry, with its own wording,
# so nothing here can re-create an unrefuted duplicate (FR-1115).
M_DMS_DECIMAL = mc("mc:u4-1-1:degree-split-decimally", "lo:u4-1-1",
    "Degree divided into 100 parts",
    "Applies decimal place-value to degrees and minutes, so 0.25° is read as 25'.")
M_TRIG_RECIPROCAL = mc("mc:sin-cos-swapped", "lo:u4-1-3",
                       "Opposite and adjacent sides exchanged",
                       "Uses the adjacent side where the opposite is required, swapping sine and cosine.")

TRIPLES = [(3, 4, 5), (6, 8, 10), (5, 12, 13), (8, 15, 17), (9, 12, 15),
           (7, 24, 25), (20, 21, 29), (12, 16, 20)]


@family("tpl:u4-1-1:dms", "lo:u4-1-1", "q:u4-1-1:001", 64)
def _u411(rng):
    deg = rng.randint(10, 80)
    mins = rng.choice([6, 12, 15, 18, 24, 30, 36, 42, 45, 48, 54])
    total_minutes = deg * 60 + mins
    stem = (f"Convert ${num(deg)}^\\circ\\ {num(mins)}'$ into minutes.")
    return Item(
        lo_id="lo:u4-1-1", tier="basic", question_type="numeric",
        stem=stem, correct_answer=num(total_minutes),
        canonical_solution=[
            step(1, "One degree is $60$ minutes."),
            step(2, f"${num(deg)}^\\circ = {num(deg)} \\times 60 = {num(deg * 60)}'$."),
            step(3, f"Adding the loose minutes: ${num(deg * 60)} + {num(mins)} = {num(total_minutes)}'$."),
        ],
        parent_question_id="q:u4-1-1:001", source_page=64, family="tpl:u4-1-1:dms")


@family("tpl:u4-1-3:ratio", "lo:u4-1-3", "q:u4-1-3:001", 67)
def _u413(rng):
    """Trig ratios read off a Pythagorean triple.

    Rewritten after the first run exhausted its stem space at six items and,
    worse, offered two options of the SAME VALUE in different clothes —
    9/15 beside 3/5. A student who reduces correctly finds two right answers
    and no way to choose. Distractors are now the other two ratios of the same
    angle plus the reciprocal, all reduced, so four distinct values are
    guaranteed by construction rather than hoped for.
    """
    a, b, c = rng.choice(TRIPLES)          # a opposite A, b adjacent to A, c hypotenuse
    at_a = rng.choice([True, False])       # ask about angle A or angle C
    opp, adj = (a, b) if at_a else (b, a)
    angle = "A" if at_a else "C"
    which = rng.choice(["sin", "cos", "tan"])
    name = {"sin": "\\sin", "cos": "\\cos", "tan": "\\tan"}[which]
    expl = {
        "sin": "the side opposite the angle over the hypotenuse",
        "cos": "the side adjacent to the angle over the hypotenuse",
        "tan": "the opposite side over the adjacent side",
    }[which]
    ratios = {
        "sin": Fraction(opp, c),
        "cos": Fraction(adj, c),
        "tan": Fraction(opp, adj),
    }
    correct = ratios[which]
    candidates = [(v, M_TRIG_RECIPROCAL) for k, v in ratios.items() if k != which]
    candidates.append((Fraction(1) / correct, M_TRIG_RECIPROCAL))
    wrong = []
    seen = {correct}
    for v, mid in candidates:
        if v in seen:
            continue
        seen.add(v)
        wrong.append((f"${num(v)}$", mid))
    built = mcq(f"${num(correct)}$", wrong, rng)
    if not built:
        return None
    choices, key = built
    return Item(
        lo_id="lo:u4-1-3", tier="standard", question_type="mcq",
        stem=(f"In right-angled triangle $ABC$ where $\\angle B = 90^\\circ$, "
              f"$AB = {num(b)}$, $BC = {num(a)}$ and $AC = {num(c)}$. "
              f"Find ${name} {angle}$."),
        correct_answer=key, choices=choices,
        canonical_solution=[
            step(1, f"${name} {angle}$ is {expl}."),
            step(2, f"Relative to $\\angle {angle}$: opposite $= {num(opp)}$, "
                    f"adjacent $= {num(adj)}$, hypotenuse $= {num(c)}$."),
            step(3, f"${name} {angle} = {frac(opp if which != 'cos' else adj, c if which != 'tan' else adj)} = {num(correct)}$."),
        ],
        parent_question_id="q:u4-1-3:001", source_page=67, family="tpl:u4-1-3:ratio")


SPECIAL = {
    30: {"sin": r"\frac{1}{2}", "cos": r"\frac{\sqrt{3}}{2}", "tan": r"\frac{\sqrt{3}}{3}"},
    45: {"sin": r"\frac{\sqrt{2}}{2}", "cos": r"\frac{\sqrt{2}}{2}", "tan": r"1"},
    60: {"sin": r"\frac{\sqrt{3}}{2}", "cos": r"\frac{1}{2}", "tan": r"\sqrt{3}"},
}


@family("tpl:u4-2-1:special", "lo:u4-2-1", "q:u4-2-1:001", 70)
def _u421(rng):
    ang = rng.choice([30, 45, 60])
    fn = rng.choice(["sin", "cos", "tan"])
    correct = SPECIAL[ang][fn]
    wrong_pool = []
    for a2 in SPECIAL:
        for f2 in SPECIAL[a2]:
            v = SPECIAL[a2][f2]
            if v != correct:
                wrong_pool.append(v)
    rng.shuffle(wrong_pool)
    built = mcq(f"${correct}$", [(f"${w}$", None) for w in wrong_pool[:3]], rng)
    if not built:
        return None
    choices, key = built
    name = {"sin": "\\sin", "cos": "\\cos", "tan": "\\tan"}[fn]
    return Item(
        lo_id="lo:u4-2-1", tier="basic", question_type="mcq",
        stem=f"${name} {num(ang)}^\\circ =$ ?",
        correct_answer=key, choices=choices,
        canonical_solution=[
            step(1, f"${name} {num(ang)}^\\circ$ is one of the exact values from the $30$–$60$–$90$ and $45$–$45$–$90$ triangles."),
            step(2, f"${name} {num(ang)}^\\circ = {correct}$."),
        ],
        parent_question_id="q:u4-2-1:001", source_page=70, family="tpl:u4-2-1:special")


# ==========================================================================
# UNIT 5 — Coordinate geometry
# ==========================================================================

M_DIST_NO_ROOT = mc("mc:distance-root-dropped", "lo:u5-1-1",
                    "Square root never taken",
                    "Stops at the sum of the squares and reports it as the distance.")
M_DIST_SUBTRACT = mc("mc:distance-coords-added", "lo:u5-1-1",
                     "Coordinates added instead of subtracted",
                     "Uses (x1 + x2) and (y1 + y2) in place of the differences.")
M_MIDPOINT_DIFF = mc("mc:midpoint-uses-difference", "lo:u5-2-1",
                     "Midpoint built from differences",
                     "Subtracts the coordinates and halves, instead of averaging them.")
M_SLOPE_INVERTED = mc("mc:slope-inverted", "lo:u5-3-1",
                      "Run over rise",
                      "Divides the change in x by the change in y.")
M_PERP_NEGATED_ONLY = mc("mc:perpendicular-not-reciprocal", "lo:u5-3-3",
                         "Sign flipped without taking the reciprocal",
                         "Uses -m for the perpendicular slope instead of -1/m.")


@family("tpl:u5-1-1:distance", "lo:u5-1-1", "q:u5-1-1:001", 80)
def _u511(rng):
    a, b, c = rng.choice(TRIPLES)
    x1, y1 = rng.randint(-6, 6), rng.randint(-6, 6)
    sx, sy = rng.choice([1, -1]), rng.choice([1, -1])
    x2, y2 = x1 + sx * a, y1 + sy * b
    stem = (f"Find the distance between the points $A{pair(x1, y1)}$ and $B{pair(x2, y2)}$.")
    built = mcq(num(c), [
        (num(a * a + b * b), M_DIST_NO_ROOT),
        (num(a + b), M_DIST_SUBTRACT),
        (num(abs(x1 + x2) + abs(y1 + y2)), M_DIST_SUBTRACT),
    ], rng)
    if not built:
        return None
    choices, key = built
    return Item(
        lo_id="lo:u5-1-1", tier="standard", question_type="mcq",
        stem=stem, correct_answer=key, choices=choices,
        canonical_solution=[
            step(1, "$AB = \\sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}$."),
            step(2, f"$x_2 - x_1 = {num(x2 - x1)}$ and $y_2 - y_1 = {num(y2 - y1)}$."),
            step(3, f"$AB = \\sqrt{{{num(a * a)} + {num(b * b)}}} = \\sqrt{{{num(a * a + b * b)}}} = {num(c)}$."),
        ],
        parent_question_id="q:u5-1-1:001", source_page=80, family="tpl:u5-1-1:distance")


@family("tpl:u5-2-1:midpoint", "lo:u5-2-1", "q:u5-2-1:001", 83)
def _u521(rng):
    mx, my = rng.randint(-8, 8), rng.randint(-8, 8)
    dx, dy = rng.randint(1, 7), rng.randint(1, 7)
    x1, y1 = mx - dx, my - dy
    x2, y2 = mx + dx, my + dy
    stem = f"Find the midpoint of the segment joining $A{pair(x1, y1)}$ and $B{pair(x2, y2)}$."
    built = mcq(f"${pair(mx, my)}$", [
        (f"${pair(dx, dy)}$", M_MIDPOINT_DIFF),
        (f"${pair(x1 + x2, y1 + y2)}$", M_MIDPOINT_DIFF),
        (f"${pair(my, mx)}$", None),
    ], rng)
    if not built:
        return None
    choices, key = built
    return Item(
        lo_id="lo:u5-2-1", tier="standard", question_type="mcq",
        stem=stem, correct_answer=key, choices=choices,
        canonical_solution=[
            step(1, "The midpoint is the AVERAGE of the coordinates: $M = \\left(\\frac{x_1 + x_2}{2},\\ \\frac{y_1 + y_2}{2}\\right)$."),
            step(2, f"$\\frac{{{num(x1)} + {paren(x2)}}}{{2}} = {num(mx)}$ and $\\frac{{{num(y1)} + {paren(y2)}}}{{2}} = {num(my)}$."),
            step(3, f"$M = {pair(mx, my)}$."),
        ],
        parent_question_id="q:u5-2-1:001", source_page=83, family="tpl:u5-2-1:midpoint")


@family("tpl:u5-3-1:slope", "lo:u5-3-1", "q:u5-3-1:001", 86)
def _u531(rng):
    x1, y1 = rng.randint(-7, 7), rng.randint(-7, 7)
    dx = rng.choice([1, 2, 3, 4])
    m_num = rng.choice([-3, -2, -1, 1, 2, 3])
    x2, y2 = x1 + dx, y1 + m_num * dx
    slope = Fraction(y2 - y1, x2 - x1)
    stem = f"Find the slope of the straight line passing through $A{pair(x1, y1)}$ and $B{pair(x2, y2)}$."
    inv = Fraction(x2 - x1, y2 - y1) if (y2 - y1) != 0 else None
    wrong = [(f"${num(-slope)}$", None)]
    if inv is not None and inv != slope:
        wrong.insert(0, (f"${num(inv)}$", M_SLOPE_INVERTED))
    wrong.append((f"${num(slope + 1)}$", None))
    wrong.append((f"${num(slope - 1)}$", None))
    built = mcq(f"${num(slope)}$", wrong, rng)
    if not built:
        return None
    choices, key = built
    return Item(
        lo_id="lo:u5-3-1", tier="standard", question_type="mcq",
        stem=stem, correct_answer=key, choices=choices,
        canonical_solution=[
            step(1, "Slope $m = \\frac{y_2 - y_1}{x_2 - x_1}$ — the change in $y$ OVER the change in $x$."),
            step(2, f"$m = \\frac{{{num(y2)} - {paren(y1)}}}{{{num(x2)} - {paren(x1)}}} = \\frac{{{num(y2 - y1)}}}{{{num(x2 - x1)}}} = {num(slope)}$."),
        ],
        parent_question_id="q:u5-3-1:001", source_page=86, family="tpl:u5-3-1:slope")


@family("tpl:u5-3-3:perpendicular", "lo:u5-3-3", "q:u5-3-3:001", 88)
def _u533(rng):
    p = rng.choice([1, 2, 3, 4, 5])
    q = rng.choice([1, 2, 3, 4])
    sign = rng.choice([1, -1])
    m = Fraction(sign * p, q)
    perp = Fraction(-1) / m
    stem = (f"A straight line has slope ${num(m)}$. Find the slope of any line perpendicular to it.")
    built = mcq(f"${num(perp)}$", [
        (f"${num(-m)}$", M_PERP_NEGATED_ONLY),
        (f"${num(m)}$", None),
        (f"${num(Fraction(1) / m)}$", M_PERP_NEGATED_ONLY),
    ], rng)
    if not built:
        return None
    choices, key = built
    return Item(
        lo_id="lo:u5-3-3", tier="advanced", question_type="mcq",
        stem=stem, correct_answer=key, choices=choices,
        canonical_solution=[
            step(1, "Perpendicular slopes multiply to $-1$: $m_1 \\times m_2 = -1$."),
            step(2, f"So $m_2 = \\frac{{-1}}{{{num(m)}}} = {num(perp)}$ — flip the fraction and change the sign."),
            step(3, f"Check: ${num(m)} \\times {num(perp)} = -1$. Flipping the sign alone is not enough — the reciprocal is part of the rule."),
        ],
        parent_question_id="q:u5-3-3:001", source_page=88, family="tpl:u5-3-3:perpendicular")


@family("tpl:u5-4-1:read-mb", "lo:u5-4-1", "q:u5-4-1:001", 90)
def _u541(rng):
    m = rng.choice([-4, -3, -2, -1, 2, 3, 4, 5])
    b = rng.choice([-7, -5, -2, 1, 3, 6, 8])
    stem = f"For the straight line $y = {linear(m, b)}$, find the value of the slope plus the $y$-intercept."
    return Item(
        lo_id="lo:u5-4-1", tier="basic", question_type="numeric",
        stem=stem, correct_answer=num(m + b),
        canonical_solution=[
            step(1, f"In $y = mx + b$ the slope is $m$ and the $y$-intercept is $b$."),
            step(2, f"Here $m = {num(m)}$ and $b = {num(b)}$."),
            step(3, f"$m + b = {num(m)}{signed(b)} = {num(m + b)}$."),
        ],
        parent_question_id="q:u5-4-1:001", source_page=90, family="tpl:u5-4-1:read-mb")


# ==========================================================================
# TERM 2 — Equations, algebraic fractions, probability
# ==========================================================================

# NO CATALOGUE ENTRY denotes this error (checked 2026-09-25 against every lo:t2u1-1-3 entry).
# Never emitted today (the family on lo:t2u1-1-3 is numeric). Do not put it on a distractor until
# the misconceptions package writes the entry; flagged for it.
M_SUBST_SIGN = mc("mc:substitution-sign", "lo:t2u1-1-3",
                  "Sign error on elimination",
                  "Adds the equations where subtraction is required, or the reverse.")
M_DISCRIMINANT = mc("mc:discriminant-misread", "lo:t2u1-2-2",
                    "Discriminant sign misread",
                    "Reports real roots when b^2 - 4ac < 0, or no roots when it is positive.")
M_DOMAIN_NUMERATOR = mc("mc:domain-from-numerator", "lo:t2u2-2-1",
                        "Domain excluded using the numerator",
                        "Solves the numerator equal to zero instead of the denominator.")
M_PROB_OVER_EVENT = mc("mc:probability-denominator", "lo:t2u3-1-1",
                       "Divided by the event instead of the sample space",
                       "Uses n(S)/n(A) or divides by the wrong total.")
M_COMPLEMENT_SUB = mc("mc:complement-not-one-minus", "lo:t2u3-2-1",
                      "Complement not taken from 1",
                      "Reports P(A) itself, or subtracts from the wrong total.")


@family("tpl:t2u1-1-3:system", "lo:t2u1-1-3", "q:t2u1-1-3:001", 6)
def _t2113(rng):
    x, y = rng.randint(-6, 8), rng.randint(-6, 8)
    a1, b1 = rng.choice([1, 2, 3]), rng.choice([1, 2, -1, -2])
    a2, b2 = rng.choice([1, 2, -1]), rng.choice([1, 3, -2, 2])
    if a1 * b2 - a2 * b1 == 0:
        return None
    c1, c2 = a1 * x + b1 * y, a2 * x + b2 * y
    def eqn(a, b, c):
        # "2x - y = -6", never "2x - 1y": a coefficient of 1 is not written.
        lhs = linear(a, 0, "x")
        yterm = "y" if abs(b) == 1 else f"{num(abs(b))}y"
        return f"{lhs} {'+' if b > 0 else '-'} {yterm} = {num(c)}"

    stem = (f"Solve the system ${eqn(a1, b1, c1)}$ and ${eqn(a2, b2, c2)}$, "
            f"then give the value of $x + y$.")
    return Item(
        lo_id="lo:t2u1-1-3", tier="advanced", question_type="numeric",
        stem=stem, correct_answer=num(x + y),
        canonical_solution=[
            step(1, "Eliminate one unknown by making its coefficients match, then subtract."),
            step(2, f"Solving the pair gives $x = {num(x)}$ and $y = {num(y)}$."),
            step(3, f"Check in the first equation: ${num(a1)}({num(x)}) {'+' if b1 > 0 else '-'} {'' if abs(b1) == 1 else num(abs(b1))}({num(y)}) = {num(c1)}$. ✓"),
            step(4, f"$x + y = {num(x)}{signed(y)} = {num(x + y)}$."),
        ],
        parent_question_id="q:t2u1-1-3:001", source_page=6, family="tpl:t2u1-1-3:system")


@family("tpl:t2u1-2-2:roots", "lo:t2u1-2-2", "q:t2u1-2-2:001", 12)
def _t2122(rng):
    r1 = rng.randint(-7, 7)
    r2 = rng.randint(-7, 7)
    b = -(r1 + r2)
    c = r1 * r2
    stem = (f"Find the solution set of $x^2{signed(b)}x{signed(c)} = 0$ in $\\mathbb{{R}}$, "
            f"then give the sum of its elements.")
    ssum = r1 + r2 if r1 != r2 else r1
    return Item(
        lo_id="lo:t2u1-2-2", tier="advanced", question_type="numeric",
        stem=stem, correct_answer=num(ssum),
        canonical_solution=[
            step(1, f"The discriminant is $b^2 - 4ac = ({num(b)})^2 - 4(1)({num(c)}) = {num(b * b - 4 * c)}$."),
            step(2, f"Its roots are $x = {num(r1)}$ and $x = {num(r2)}$."),
            step(3, f"The solution set is ${setof(sorted(set([r1, r2])))}$ and the sum of its elements is ${num(ssum)}$."
                    + (" The repeated root is listed once — a set holds no duplicates." if r1 == r2 else "")),
        ],
        parent_question_id="q:t2u1-2-2:001", source_page=12, family="tpl:t2u1-2-2:roots")


@family("tpl:t2u1-2-1:touch", "lo:t2u1-2-1", "q:t2u1-2-1:003", 10)
def _t2121(rng):
    r = rng.randint(1, 9)
    b = -2 * r
    c = r * r
    stem = (f"The curve of $f(x) = {quadratic(1, b, 0)} + k$ touches the $x$-axis at exactly one point. "
            f"Find the value of $k$.")
    return Item(
        lo_id="lo:t2u1-2-1", tier="advanced", question_type="numeric",
        stem=stem, correct_answer=num(c),
        canonical_solution=[
            step(1, "Touching the axis at exactly one point means one repeated root, so the discriminant is zero."),
            step(2, f"$b^2 - 4ac = ({num(b)})^2 - 4(1)(k) = {num(b * b)} - 4k = 0$."),
            step(3, f"$k = {num(c)}$, and the curve touches the axis at $x = {num(r)}$."),
        ],
        parent_question_id="q:t2u1-2-1:003", source_page=10, family="tpl:t2u1-2-1:touch")


@family("tpl:t2u2-2-1:domain", "lo:t2u2-2-1", "q:t2u2-2-1:001", 26)
def _t2221(rng):
    root = rng.choice([-6, -5, -4, -3, -2, 2, 3, 4, 5, 6])
    numr = rng.choice([1, 2, 3, 5])
    stem = (f"Find the domain of the algebraic fraction $\\frac{{{linear(1, numr)}}}{{{linear(1, -root)}}}$ "
            f"in $\\mathbb{{R}}$ — that is, the value of $x$ that must be excluded.")
    return Item(
        lo_id="lo:t2u2-2-1", tier="standard", question_type="numeric",
        stem=stem, correct_answer=num(root),
        canonical_solution=[
            step(1, "A fraction is undefined exactly where its DENOMINATOR is zero."),
            step(2, f"${linear(1, -root)} = 0$ gives $x = {num(root)}$."),
            step(3, f"The domain is $\\mathbb{{R}} - \\{{{num(root)}\\}}$; the numerator plays no part in this."),
        ],
        parent_question_id="q:t2u2-2-1:001", source_page=26, family="tpl:t2u2-2-1:domain")


@family("tpl:t2u2-1-1:zeroes", "lo:t2u2-1-1", "q:t2u2-1-1:001", 24)
def _t2211(rng):
    r1, r2 = rng.randint(-6, 6), rng.randint(-6, 6)
    if r1 == r2:
        return None
    b, c = -(r1 + r2), r1 * r2
    stem = (f"Find the number of elements in the set of zeroes of $f(x) = {quadratic(1, b, c)}$ in $\\mathbb{{R}}$.")
    return Item(
        lo_id="lo:t2u2-1-1", tier="basic", question_type="numeric",
        stem=stem, correct_answer="2",
        canonical_solution=[
            step(1, "The zeroes are the values of $x$ where $f(x) = 0$."),
            step(2, f"$f(x) = (x{signed(-r1)})(x{signed(-r2)})$, so the zeroes are $x = {num(r1)}$ and $x = {num(r2)}$."),
            step(3, "The set of zeroes has $2$ elements."),
        ],
        parent_question_id="q:t2u2-1-1:001", source_page=24, family="tpl:t2u2-1-1:zeroes")


@family("tpl:t2u3-1-1:probability", "lo:t2u3-1-1", "q:t2u3-1-1:001", 44)
def _t2311(rng):
    total = rng.choice([10, 12, 15, 20, 24, 30])
    favourable = rng.randint(2, total - 2)
    p = Fraction(favourable, total)
    stem = (f"A box holds ${num(total)}$ identical cards numbered $1$ to ${num(total)}$. "
            f"One card is drawn at random. If event $A$ contains ${num(favourable)}$ of these cards, "
            f"find $P(A)$.")
    built = mcq(f"${num(p)}$", [
        (f"${num(Fraction(total, favourable))}$", M_PROB_OVER_EVENT),
        (f"${num(Fraction(favourable, total - favourable))}$", M_PROB_OVER_EVENT),
        (f"${num(Fraction(total - favourable, total))}$", None),
    ], rng)
    if not built:
        return None
    choices, key = built
    return Item(
        lo_id="lo:t2u3-1-1", tier="basic", question_type="mcq",
        stem=stem, correct_answer=key, choices=choices,
        canonical_solution=[
            step(1, "$P(A) = \\frac{n(A)}{n(S)}$ — favourable outcomes over ALL outcomes."),
            step(2, f"$n(A) = {num(favourable)}$ and $n(S) = {num(total)}$."),
            step(3, f"$P(A) = {frac(favourable, total)} = {num(p)}$."),
        ],
        parent_question_id="q:t2u3-1-1:001", source_page=44, family="tpl:t2u3-1-1:probability")


@family("tpl:t2u3-2-1:complement", "lo:t2u3-2-1", "q:t2u3-2-1:001", 47)
def _t2321(rng):
    total = rng.choice([8, 10, 12, 16, 20, 25])
    favourable = rng.randint(1, total - 1)
    p = Fraction(favourable, total)
    comp = 1 - p
    stem = f"If $P(A) = {num(p)}$, find $P(A^c)$ — the probability of the complementary event."
    built = mcq(f"${num(comp)}$", [
        (f"${num(p)}$", M_COMPLEMENT_SUB),
        (f"${num(Fraction(1) / p)}$" if p != 0 else "$1$", M_COMPLEMENT_SUB),
        (f"${num(-p)}$", M_COMPLEMENT_SUB),
    ], rng)
    if not built:
        return None
    choices, key = built
    return Item(
        lo_id="lo:t2u3-2-1", tier="standard", question_type="mcq",
        stem=stem, correct_answer=key, choices=choices,
        canonical_solution=[
            step(1, "An event and its complement together cover the whole sample space: $P(A) + P(A^c) = 1$."),
            step(2, f"$P(A^c) = 1 - {num(p)} = {num(comp)}$."),
        ],
        parent_question_id="q:t2u3-2-1:001", source_page=47, family="tpl:t2u3-2-1:complement")


@family("tpl:t2u3-1-3:union", "lo:t2u3-1-3", "q:t2u3-1-3:001", 46)
def _t2313(rng):
    total = rng.choice([20, 24, 30, 40])
    na = rng.randint(4, total // 2)
    nb = rng.randint(4, total // 2)
    nab = rng.randint(1, min(na, nb))
    nunion = na + nb - nab
    if nunion > total:
        return None
    p = Fraction(nunion, total)
    stem = (f"In a sample space of ${num(total)}$ equally likely outcomes, "
            f"$n(A) = {num(na)}$, $n(B) = {num(nb)}$ and $n(A \\cap B) = {num(nab)}$. "
            f"Find $P(A \\cup B)$.")
    built = mcq(f"${num(p)}$", [
        (f"${num(Fraction(na + nb, total))}$", None),
        (f"${num(Fraction(nab, total))}$", None),
        (f"${num(Fraction(na, total))}$", None),
    ], rng)
    if not built:
        return None
    choices, key = built
    return Item(
        lo_id="lo:t2u3-1-3", tier="advanced", question_type="mcq",
        stem=stem, correct_answer=key, choices=choices,
        canonical_solution=[
            step(1, "The addition rule: $P(A \\cup B) = P(A) + P(B) - P(A \\cap B)$."),
            step(2, f"The overlap is counted twice if it is not subtracted: $n(A \\cup B) = {num(na)} + {num(nb)} - {num(nab)} = {num(nunion)}$."),
            step(3, f"$P(A \\cup B) = {frac(nunion, total)} = {num(p)}$."),
        ],
        parent_question_id="q:t2u3-1-3:001", source_page=46, family="tpl:t2u3-1-3:union")


# ==========================================================================
# GEOMETRY — circle
# ==========================================================================

M_INSCRIBED_DOUBLE = mc("mc:inscribed-doubled", "lo:geo2-2-2",
                        "Inscribed angle doubled instead of halved",
                        "Multiplies the arc measure by two where half is required.")
M_CYCLIC_EQUAL = mc("mc:cyclic-angles-equal", "lo:geo2-5-1",
                    "Opposite angles taken as equal",
                    "Treats opposite angles of a cyclic quadrilateral as equal rather than supplementary.")
M_POINT_POSITION = mc("mc:point-position-reversed", "lo:geo1-2-1",
                      "Inside and outside reversed",
                      "Compares the distance to the radius the wrong way round.")


@family("tpl:geo2-2-2:inscribed", "lo:geo2-2-2", "q:geo2-2-2:001", 46)
def _g222(rng):
    arc = rng.choice([40, 60, 70, 80, 100, 110, 120, 140, 160])
    ins = arc // 2
    stem = (f"In a circle, an inscribed angle subtends an arc of measure ${num(arc)}^\\circ$. "
            f"Find the measure of the inscribed angle.")
    built = mcq(f"${num(ins)}^\\circ$", [
        (f"${num(arc)}^\\circ$", M_INSCRIBED_DOUBLE),
        (f"${num(arc * 2)}^\\circ$", M_INSCRIBED_DOUBLE),
        (f"${num(180 - arc)}^\\circ$", None),
    ], rng)
    if not built:
        return None
    choices, key = built
    return Item(
        lo_id="lo:geo2-2-2", tier="standard", question_type="mcq",
        stem=stem, correct_answer=key, choices=choices,
        canonical_solution=[
            step(1, "An inscribed angle equals HALF the measure of the arc it subtends."),
            step(2, f"$\\frac{{{num(arc)}}}{{2}} = {num(ins)}$."),
            step(3, f"The inscribed angle measures ${num(ins)}^\\circ$. The central angle on the same arc would be the full ${num(arc)}^\\circ$."),
        ],
        parent_question_id="q:geo2-2-2:001", source_page=46, family="tpl:geo2-2-2:inscribed")


@family("tpl:geo2-5-1:cyclic", "lo:geo2-5-1", "q:geo2-5-1:001", 58)
def _g251(rng):
    a = rng.choice([50, 60, 65, 70, 75, 85, 95, 100, 110, 115])
    opp = 180 - a
    stem = (f"$ABCD$ is a cyclic quadrilateral in which $m(\\angle A) = {num(a)}^\\circ$. "
            f"Find $m(\\angle C)$.")
    built = mcq(f"${num(opp)}^\\circ$", [
        (f"${num(a)}^\\circ$", M_CYCLIC_EQUAL),
        (f"${num(360 - a)}^\\circ$", None),
        (f"${num(90)}^\\circ$", None),
    ], rng)
    if not built:
        return None
    choices, key = built
    return Item(
        lo_id="lo:geo2-5-1", tier="standard", question_type="mcq",
        stem=stem, correct_answer=key, choices=choices,
        canonical_solution=[
            step(1, "Opposite angles of a cyclic quadrilateral are SUPPLEMENTARY, not equal."),
            step(2, f"$m(\\angle A) + m(\\angle C) = 180^\\circ$."),
            step(3, f"$m(\\angle C) = 180^\\circ - {num(a)}^\\circ = {num(opp)}^\\circ$."),
        ],
        parent_question_id="q:geo2-5-1:001", source_page=58, family="tpl:geo2-5-1:cyclic")


@family("tpl:geo1-2-1:position", "lo:geo1-2-1", "q:geo1-2-1:001", 42)
def _g121(rng):
    r = rng.randint(3, 12)
    case = rng.choice(["inside", "on", "outside"])
    d = r - rng.randint(1, max(1, r - 1)) if case == "inside" else (r if case == "on" else r + rng.randint(1, 6))
    label = {"inside": "inside the circle", "on": "on the circle", "outside": "outside the circle"}[case]
    others = [v for k, v in
              {"inside": "inside the circle", "on": "on the circle", "outside": "outside the circle"}.items()
              if k != case]
    built = mcq(label, [(others[0], M_POINT_POSITION), (others[1], M_POINT_POSITION),
                        ("cannot be determined", None)], rng)
    if not built:
        return None
    choices, key = built
    rel = "<" if d < r else ("=" if d == r else ">")
    return Item(
        lo_id="lo:geo1-2-1", tier="basic", question_type="mcq",
        stem=(f"A circle $M$ has radius ${num(r)}$ cm and $A$ is a point with $MA = {num(d)}$ cm. "
              f"The point $A$ lies…"),
        correct_answer=key, choices=choices,
        canonical_solution=[
            step(1, "Compare the distance from the centre with the radius."),
            step(2, f"$MA = {num(d)}$ and $r = {num(r)}$, so $MA {rel} r$."),
            step(3, f"Therefore $A$ lies {label}."),
        ],
        parent_question_id="q:geo1-2-1:001", source_page=42, family="tpl:geo1-2-1:position")


@family("tpl:geo2-1-2:arc", "lo:geo2-1-2", "q:geo2-1-2:001", 44)
def _g212(rng):
    r = rng.choice([7, 14, 21, 28])
    ang = rng.choice([30, 45, 60, 90, 120, 180])
    # circumference 2*pi*r with pi = 22/7 keeps the arithmetic exact for these radii
    circ = Fraction(2 * 22 * r, 7)
    arc = circ * Fraction(ang, 360)
    stem = (f"A circle has radius ${num(r)}$ cm. Find the length of an arc subtending a central angle "
            f"of ${num(ang)}^\\circ$, taking $\\pi = \\frac{{22}}{{7}}$.")
    return Item(
        lo_id="lo:geo2-1-2", tier="advanced", question_type="numeric",
        stem=stem, correct_answer=num(float(arc)) if arc.denominator != 1 else num(arc.numerator),
        canonical_solution=[
            step(1, f"The circumference is $2\\pi r = 2 \\times \\frac{{22}}{{7}} \\times {num(r)} = {num(circ)}$ cm."),
            step(2, f"An arc is the same fraction of the circumference as its angle is of $360^\\circ$."),
            step(3, f"Arc $= {num(circ)} \\times \\frac{{{num(ang)}}}{{360}} = {num(arc)}$ cm."),
        ],
        parent_question_id="q:geo2-1-2:001", source_page=44, family="tpl:geo2-1-2:arc")


# ==========================================================================
# driver
# ==========================================================================


def verify(item: Item) -> list[str]:
    """Re-check every item after it is built, before it can reach a bundle.

    This runs over the OUTPUT rather than the builder's intermediate values, so
    a family that formats its answer differently from the way it computes it is
    caught here rather than by a student.
    """
    problems = []
    if not item.stem.strip():
        problems.append("empty stem")
    if not item.canonical_solution:
        problems.append("no canonical solution")
    if item.question_type == "numeric":
        if item.choices:
            problems.append("numeric item carries choices")
        try:
            float(item.correct_answer)
        except ValueError:
            problems.append(f"numeric answer {item.correct_answer!r} is not a number")
    elif item.question_type == "short":
        # A typed maths answer (FR-4320): the marker spec travels in choices,
        # as a widget's does (contracts/answer-marker.md). Only declarative
        # families produce these; none of the 35 below does.
        problems += _verify_marker(item)
    else:
        keys = [c["key"] for c in (item.choices or [])]
        if len(keys) != 4:
            problems.append(f"{len(keys)} choices, expected 4")
        if item.correct_answer not in keys:
            problems.append("answer key is not among the choices")
        texts = [c["text"] for c in (item.choices or [])]
        if len(set(texts)) != len(texts):
            problems.append("duplicate choice text")
        # The KEYED option must never carry a misconception id: that would tell
        # the library to serve a refutation for the right answer. Distractors
        # may be labelled or not — a plausible unlabelled wrong answer is
        # legitimate, it simply has no refutation entry to pull.
        correct_opt = next((c for c in (item.choices or []) if c["key"] == item.correct_answer), None)
        if correct_opt and "misconception_id" in correct_opt:
            problems.append("the correct option is tagged with a misconception")
    # An unbalanced $ means a half-rendered expression on the student's screen.
    option_texts = [c["text"] for c in item.choices] if isinstance(item.choices, list) else []
    for text in [item.stem] + option_texts + [s["text_md"] for s in item.canonical_solution]:
        if text.count("$") % 2 != 0:
            problems.append(f"unbalanced math delimiters in {text[:40]!r}")
    return problems


MARKER_KINDS = {"expression", "equation", "values", "interval", "coordinates", "surd", "recurring"}
MARKER_FORMS = {None, "factorised", "expanded", "simplest"}


def _verify_marker(item: Item) -> list[str]:
    """contracts/answer-marker.md: the stored spec the app's marker reads."""
    problems = []
    m = item.choices.get("marker") if isinstance(item.choices, dict) else None
    if not isinstance(m, dict):
        return ["a typed-answer item carries no choices.marker"]
    if set(item.choices) != {"marker"}:
        problems.append("choices of a typed-answer item hold only the marker")
    if m.get("kind") not in MARKER_KINDS:
        problems.append(f"marker kind {m.get('kind')!r} unknown")
    key = m.get("key")
    if not isinstance(key, str) or not key.strip():
        problems.append("marker key is empty")
    elif "$" in key:
        problems.append("marker key is raw LaTeX, without $ delimiters")
    if key != item.correct_answer:
        problems.append("correct_answer and the marker key disagree")
    form = m.get("form")
    if not (form in MARKER_FORMS or (isinstance(form, dict) and set(form) == {"subject"})):
        problems.append(f"marker form {form!r} unknown")
    if not isinstance(m.get("variables"), list):
        problems.append("marker variables must be a list")
    # The stored shape is schemas.MarkerChoices — the model the lesson line (S3)
    # writes book questions' markers with. Validating against it, not a copy of
    # it, keeps a generated typed answer in exactly the same place and shape.
    from pydantic import ValidationError
    from schemas import MarkerChoices
    try:
        MarkerChoices.model_validate(item.choices)
    except ValidationError as e:
        problems += [f"marker: {err['msg']} at {'.'.join(map(str, err['loc']))}" for err in e.errors()]
    return problems


def rebalance_keys(questions: list[dict], rng: random.Random) -> None:
    """Spread the correct answer evenly across A/B/C/D, in place.

    Shuffling each item independently is unbiased in expectation and still
    lands lopsided on a few hundred items — the first run keyed 74 items 'C'
    and 38 'D'. On a bank this size that is worth removing rather than
    tolerating: a student who learns "pick C when unsure" gains real marks, and
    in a two-environment comparison an artefact like that lands inside the
    number being measured.

    The item is not altered — only the ORDER of its options, so the correct
    text ends up on an assigned key. Distractors keep their relative order.
    """
    mcqs = [q for q in questions if q["question_type"] == "mcq"]
    rng.shuffle(mcqs)
    keys = ["A", "B", "C", "D"]
    for i, q in enumerate(mcqs):
        target = keys[i % 4]
        correct_text = next(c["text"] for c in q["choices"] if c["key"] == q["correct_answer"])
        correct_opt = next(c for c in q["choices"] if c["key"] == q["correct_answer"])
        others = [c for c in q["choices"] if c["key"] != q["correct_answer"]]
        ordered = []
        oi = 0
        for k in keys:
            if k == target:
                ordered.append(dict(correct_opt, key=k))
            else:
                ordered.append(dict(others[oi], key=k))
                oi += 1
        q["choices"] = ordered
        q["correct_answer"] = target
        assert next(c["text"] for c in q["choices"] if c["key"] == target) == correct_text


def legacy_item_id(fam: Family, made: int) -> str:
    return f"{fam.lo_id.replace('lo:', 'q:')}:g{made:03d}-{fam.id.split(':')[-1][:6]}"


def instantiate(
    families: list[Family],
    per_family: int | Callable[[Family], int],
    seed: int,
    *,
    item_id: Callable[[Family, int], str] = legacy_item_id,
    to_row: Callable[[Item, str, Family], dict] | None = None,
    spec_errors: tuple[type[BaseException], ...] = (),
) -> tuple[list[dict], list[str], dict[str, int]]:
    """THE driver: one seeded stream per family, verify(), duplicate stems dropped.

    Shared by the 35 hand-written families and the declarative ones, so the
    two cannot differ in how an item is accepted. `spec_errors` are exceptions a
    declarative spec may raise on one attempt (an evaluation error); they are
    recorded as rejections, never swallowed silently. For the hand-written
    families the tuple is empty and an exception propagates, as it always has.
    """
    questions: list[dict] = []
    rejected: list[str] = []
    per_family_counts: dict[str, int] = {}
    for fam in families:
        target = per_family(fam) if callable(per_family) else per_family
        # Each family gets its own stream, so adding a family never renumbers
        # the items of the families before it.
        rng = random.Random(f"{seed}:{fam.id}")
        seen_stems: set[str] = set()
        made = 0
        attempts = 0
        while made < target and attempts < target * 25:
            attempts += 1
            try:
                item = fam.build(rng)
            except spec_errors as e:  # an empty tuple catches nothing
                rejected.append(f"{fam.id}: evaluation error: {e}")
                continue
            if item is None:
                continue
            if item.stem in seen_stems:
                continue
            problems = verify(item)
            if problems:
                rejected.append(f"{fam.id}: {'; '.join(problems)}")
                continue
            seen_stems.add(item.stem)
            made += 1
            qid = item_id(fam, made)
            questions.append(to_row(item, qid, fam) if to_row else item.as_question(qid))
        per_family_counts[fam.id] = made
    return questions, rejected, per_family_counts


def main() -> int:
    if "--families" in sys.argv[1:]:
        return main_families(sys.argv[1:])
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--per-family", type=int, default=10)
    ap.add_argument("--seed", type=int, default=20260912)
    ap.add_argument("--course", default="course:prep3-math-en")
    args = ap.parse_args()

    questions, rejected, per_family_counts = instantiate(REGISTRY, args.per_family, args.seed)

    rebalance_keys(questions, random.Random(args.seed))

    if rejected:
        print(f"{len(rejected)} item(s) rejected by verification:", file=sys.stderr)
        for r in rejected[:10]:
            print(f"  x {r}", file=sys.stderr)

    # Only ship misconceptions that something actually references. An orphan
    # row is a promise of a refutation entry that will never be looked up.
    used = {c["misconception_id"] for q in questions
            for c in (q.get("choices") or []) if c.get("misconception_id")}
    bundle = {
        "bundle": "generated-questions-v2",
        "generated_at": "2026-09-12",
        "generator": "template families — services/extraction/generate_questions.py",
        "course_id": args.course,
        "reviewed": False,
        "seed": args.seed,
        "note": (
            "Template-generated. Every answer key is COMPUTED from the sampled parameters by the "
            "same code that builds the stem, so the key cannot disagree with the question. Reading "
            "one item validates its family, which is what makes a 10% sample a real control "
            "(ADR-0008). The residual risk is a family that is uniformly wrong — small families and "
            "per-family worked solutions are the mitigation."
        ),
        "families": per_family_counts,
        "misconceptions": [MISCONCEPTIONS[m] for m in sorted(used)],
        "questions": questions,
    }
    args.out.write_text(json.dumps(bundle, indent=2, ensure_ascii=False) + "\n")

    by_tier: dict[str, int] = {}
    by_lo: dict[str, int] = {}
    for q in questions:
        by_tier[q["tier"]] = by_tier.get(q["tier"], 0) + 1
        by_lo[q["lo_id"]] = by_lo.get(q["lo_id"], 0) + 1
    print(f"wrote {args.out} — {len(questions)} questions across "
          f"{len(REGISTRY)} families and {len(by_lo)} objectives")
    print(f"  tiers: {dict(sorted(by_tier.items()))}")
    print(f"  misconceptions referenced: {len(used)} of {len(MISCONCEPTIONS)} defined")
    thin = [f for f, n in per_family_counts.items() if n < args.per_family]
    if thin:
        print(f"  families under target ({args.per_family}): {', '.join(thin)}")
    return 0


# ==========================================================================
# DECLARATIVE FAMILIES (decision 16, FR-4304; pipeline spec §3.9, B12)
#
#   uv run generate_questions.py --families families/<book> --book <book> --check
#   uv run generate_questions.py --families families/<book> --book <book> \
#       --catalogue seed/generated/<book>/misconceptions.json --author-args <args.json> [--by-ref [DIR]]
#   uv run generate_questions.py --families families/<book> --book <book> \
#       --grading-set runs/<book>/families/grading-set.json --grade-args <args.json> [--by-ref [DIR]]
#   uv run generate_questions.py --families families/<book> --book <book> \
#       --catalogue … --grades runs/<book>/families/grade-*.json \
#       --out seed/generated/<book>/generated-questions.json --floor-report coverage/<book>.tier-floor.json
#   uv run generate_questions.py --families families/prep3-math-en --compare-legacy \
#       --per-family 16 --export seed/generated/generated-questions.json
#
# The order is the stage's: author (families.workflow.js, mode "author") →
# --check → --grading-set → blind grader (families.workflow.js, mode "grade") →
# --grades … --out. A family reaches a bundle only with a passing grade for its
# CURRENT spec (the grade names the spec's sha); one disagreement rejects it.
# ==========================================================================

GRADE_SAMPLE = 3
DECLARATIVE_ONLY_KEYS = ("family", "family_spec_sha", "answer_check", "authored")


def _declarative_row(item: Item, qid: str, fam: Family) -> dict:
    from families import spec as FS
    return FS.to_question(item, qid, fam.spec)


def declarative_families(specs) -> list[Family]:
    from families import spec as FS
    out = []
    for s in specs:
        fam = FS.as_family(s)
        fam.spec = s  # the driver's to_row reads it back
        out.append(fam)
    return out


def spec_problems(raw: dict, per_family: int = 10, seed: int = 20260925) -> list[str]:
    """What --check says about ONE spec, as the author should read it: its structural problems, else each
    distinct evaluation error and whether it produced nothing. Empty: the spec passes."""
    import hashlib

    from families import spec as FS
    found = FS.check_spec(raw, str(raw.get("id") if isinstance(raw, dict) else "<spec>"))
    if found:
        return found
    spec = FS.FamilySpec(raw=raw, path=None, sha=hashlib.sha256(FS._canonical(raw)).hexdigest())
    questions, rejected, counts = run_specs([spec], per_family, seed)
    errors = sorted({r.split(": evaluation error: ", 1)[1] for r in rejected if ": evaluation error: " in r})
    out = [f"every attempt to instantiate it failed to evaluate: {e}" if not questions else
           f"some attempts failed to evaluate: {e}" for e in errors]
    if not questions:
        out.append("the family produced no question")
    return out


def revise_args(book, entries: list[dict]) -> dict:
    """families.workflow.js args (mode author) that re-author only these specs: [{spec, problems}]. The
    workflow's revise prompt is the shared one; each spec carries its own reasons (s6 prompts unchanged)."""
    import book_config
    return book_config.workflow_args(book, extra={"mode": "author", "revise": entries})


def run_specs(specs, per_family: int, seed: int) -> tuple[list[dict], list[str], dict[str, int]]:
    """Instantiate declarative specs with the shared driver (pre-rebalance)."""
    from families import evaluator as FE
    from families import spec as FS
    fams = declarative_families(specs)
    by_id = {s.id: s for s in specs}
    return instantiate(
        fams,
        lambda f: 1 if by_id[f.id].kind == "authored" else per_family,
        seed,
        item_id=lambda f, n: FS.item_id(by_id[f.id], n),
        to_row=_declarative_row,
        spec_errors=(FE.EvalError,),
    )


def load_catalogue(path: Path | None) -> tuple[dict[str, dict], dict[str, str]]:
    """The S5 catalogue (load_misconceptions.py shape): entries by id, and alias → id.

    An S5 RUN is read too ({stage, records: [{entries}]}): the author step reads the DRAFT's
    entries (§3.2 order: S5 draft, then S6 names its ids), before any catalogue is assembled.
    The final bundle is still written only against the assembled final catalogue."""
    if path is None:
        return {}, {}
    data = json.loads(Path(path).read_text())
    if "records" in data and "misconceptions" not in data:
        data = {"misconceptions": [e for r in data.get("records") or [] for e in r.get("entries") or []]}
    entries = {m["id"]: m for m in data.get("misconceptions", [])}
    alias = {a: m["id"] for m in entries.values() for a in (m.get("aliases") or [])}
    return entries, alias


def resolve_tags(questions: list[dict], entries: dict, alias: dict) -> tuple[list[str], list[str], set[str]]:
    """Point every distractor at the catalogue's canonical id (FR-1115).

    A tag the catalogue does not hold loses its tag (S5 dropped the entry, or it
    was never written): the option stays a distractor with nothing to serve,
    which FR-1112 prefers to a pointer at nothing. A tag on another objective is
    an error — the loader would refuse it (FR-1106).
    """
    problems, untagged, used = [], [], set()
    for q in questions:
        if not isinstance(q.get("choices"), list):
            continue
        for c in q["choices"]:
            mid = c.get("misconception_id")
            if not mid:
                continue
            canon = alias.get(mid, mid)
            entry = entries.get(canon)
            if entry is None:
                del c["misconception_id"]
                untagged.append(f"{q['id']} option {c['key']}: {mid} is not in the catalogue — tag dropped")
            elif entry.get("lo_id") != q["lo_id"]:
                problems.append(f"{q['id']} option {c['key']}: {canon} belongs to {entry.get('lo_id')}, "
                                f"not {q['lo_id']}")
            else:
                c["misconception_id"] = canon
                used.add(canon)
    return problems, untagged, used


def s5_distractors(specs, questions: list[dict]) -> list[dict]:
    """S6's distractors in the shape S5's final pass reads (misconceptions.workflow.js args.distractors).

    One record per (family, tagged error) and per untagged wrong option, each
    with a rendered example, so S5 can attach it to the entry whose error it
    encodes — or author that entry — and verify the fit (FR-1115, §3.8).
    """
    out, seen = [], set()
    for s in specs:
        proposed = {e["id"]: {"label": e["label"], "description": e["description"]}
                    for e in s.raw.get("proposed_misconceptions") or [] if isinstance(e, dict)}
        for q in questions:
            if q.get("family_spec_sha") != s.sha or not isinstance(q.get("choices"), list):
                continue
            for c in q["choices"]:
                if c["key"] == q["correct_answer"]:
                    continue
                mid = c.get("misconception_id")
                key = (s.id, mid or c["text"])
                if key in seen:
                    continue
                seen.add(key)
                rec = {"lo": s.lo_id, "origin": "S6", "ref": f"{s.id}#{mid or 'untagged'}",
                       "question_id": q["id"], "text": c["text"], "misconception_id": mid}
                if mid in proposed:
                    rec["proposed"] = proposed[mid]
                out.append(rec)
    return out


def _stem_sha(stem: str) -> str:
    import hashlib
    return hashlib.sha256(stem.encode()).hexdigest()[:16]


def grading_set(specs, questions: list[dict], seed: int, n: int = GRADE_SAMPLE) -> dict:
    """What the blind grader sees (``blind``) and what only the comparison sees (``sealed``).

    ``families.workflow.js`` (mode "grade") puts ONLY ``blind`` in the solver's
    prompt. ``sealed`` goes to the separate judge of distractors and to this
    script, which compares answers deterministically (:func:`apply_grades`).
    """
    fams = []
    for s in specs:
        items = [q for q in questions if q.get("family_spec_sha") == s.sha]
        k = min(n, len(items))
        pick = sorted(random.Random(f"{seed}:grade:{s.id}").sample(range(len(items)), k))
        instances = []
        for i in pick:
            q = items[i]
            blind = {"instance_id": q["id"], "stem": q["stem"], "stem_sha": _stem_sha(q["stem"])}
            sealed = {"correct_answer": q["correct_answer"], "canonical_solution": q["canonical_solution"]}
            if q["question_type"] == "mcq":
                blind["options"] = [{"key": c["key"], "text": c["text"]} for c in q["choices"]]
                blind["answer_format"] = {"type": "choice"}
                sealed["choices"] = q["choices"]
            elif q["question_type"] == "short":
                m = q["choices"]["marker"]
                blind["answer_format"] = {"type": "expression", "kind": m["kind"], "form": m["form"],
                                          "variables": m["variables"]}
                sealed["marker"] = m
                sealed["answer_check"] = q.get("answer_check")
            else:
                blind["answer_format"] = {"type": "number"}
            instances.append({"instance_id": q["id"], "blind": blind, "sealed": sealed})
        fams.append({
            "family_id": s.id, "spec_sha": s.sha, "kind": s.kind, "lo_id": s.lo_id, "tier": s.tier,
            "answer_type": s.answer_type, "context": s.raw.get("context"),
            "parent_question_id": s.parent, "instances_available": len(items), "instances": instances,
        })
    return {"format": "ainext.family-grading/1", "seed": seed, "sample_per_family": n, "families": fams}


def _decimals(s: str) -> int:
    return len(s.split(".", 1)[1]) if "." in s else 0


def blind_plain(kind: str, text: str, variables: list[str]) -> str:
    """A blind answer's NAMES removed, as the app's marker removes them (answer-marker.ts parseElements: a named
    value "x = 2", values joined by "or"/"and"/";", a point's name "A(1; 2)" or "A = (1, 2)"), so the pipeline
    never refuses an answer the app would mark correct. Only names go; every value still has to match the key.
      values        "x = [0, 8]", "x = 0 or x = 8", "x = 0; x = 8"  ->  "[0, 8]"
      coordinates   "H = (3, 1)", "H(3; 1)", "(3; 1)"               ->  "(3, 1)"
    """
    import re
    t = text.strip()
    if kind == "values":
        names = "|".join(re.escape(v) for v in variables) or r"(?!)"
        body = re.sub(rf"^\s*(?:{names})\s*=\s*(?=\[)", "", t)
        if body != t:
            return body
        parts = re.split(r"\s*(?:\bor\b|\band\b|;)\s*", t)
        if len(parts) > 1:
            vals = [re.sub(rf"^\s*(?:{names})\s*=\s*", "", p) for p in parts]
            if all(v and "=" not in v for v in vals):
                return "[" + ", ".join(vals) + "]"
        return re.sub(rf"^\s*(?:{names})\s*=\s*(?=[^=]*$)", "", t)
    if kind == "coordinates":
        m = re.fullmatch(r"(?:[A-Z][A-Za-z0-9_']*\s*=?\s*)?\(\s*([^;,()]+?)\s*[;,]\s*([^;,()]+?)\s*\)", t)
        if m:
            return f"({m.group(1)}, {m.group(2)})"
    return t


def answer_agrees(q: dict, given: dict) -> tuple[bool, str]:
    """Deterministic comparison of one blind answer with the family's computed key."""
    from families import evaluator as FE
    t = q["question_type"]
    if t == "mcq":
        correct = next(c["text"] for c in q["choices"] if c["key"] == q["correct_answer"])
        chosen = given.get("choice_text")
        return chosen == correct, f"chose {chosen!r}, key {correct!r}"
    if t == "numeric":
        raw = str(given.get("value", "")).strip().replace(" ", "")
        try:
            got = float(Fraction(raw)) if "/" in raw else float(raw)
        except (ValueError, ZeroDivisionError):
            return False, f"unreadable number {raw!r}"
        key = q["correct_answer"]
        tol = 0.5 * 10 ** -_decimals(key) + 1e-12 if "." in key else 1e-9
        return abs(got - float(key)) <= tol, f"answered {raw}, key {key}"
    m = q["choices"]["marker"]
    try:
        ok = FE.equivalent(m["kind"], q["answer_check"], blind_plain(m["kind"], str(given.get("plain", "")), m["variables"]),
                           m["variables"], (m.get("tolerance") or {}).get("abs"))
    except FE.Unreadable as e:
        return False, f"unreadable answer ({e})"
    return ok, f"answered {given.get('plain')!r}, key {q['answer_check']!r}"


def apply_grades(specs, questions: list[dict], grade_files: list[Path]) -> tuple[dict, dict]:
    """Accept a family only on a clean blind grade of its current spec. Fail closed.

    Returns ({family_id: record} accepted, {family_id: [reasons]} rejected). A
    family with no grade is rejected as "not graded": silence is not approval.
    """
    results: dict[str, dict] = {}
    for gf in grade_files:
        data = json.loads(Path(gf).read_text())
        for r in data.get("results", []):
            results.setdefault(r["family_id"], {"runs": []})["runs"].append((Path(gf).name, r))
    by_id = {q["id"]: q for q in questions}
    accepted, rejected = {}, {}
    for s in specs:
        runs = [(f, r) for f, r in results.get(s.id, {}).get("runs", []) if r.get("spec_sha") == s.sha]
        if not runs:
            stale = results.get(s.id)
            rejected[s.id] = ["not graded" + (" (grades exist for an older version of the spec)" if stale else "")]
            continue
        reasons, graded = [], 0
        for fname, r in runs:
            for a in r.get("answers", []):
                q = by_id.get(a.get("instance_id"))
                if q is None or _stem_sha(q["stem"]) != a.get("stem_sha"):
                    reasons.append(f"{a.get('instance_id')}: graded instance is not in this run")
                    continue
                ok, why = answer_agrees(q, a.get("answer") or {})
                graded += 1
                if not ok:
                    reasons.append(f"{a['instance_id']}: blind answer disagrees — {why}")
            j = r.get("judge") or {}
            for field_ in ("distractors_ok", "key_form_ok", "context_ok", "solution_ok"):
                if j.get(field_) is not True:
                    reasons.append(f"judge: {field_} is {j.get(field_)!r} — {j.get('notes', '')}".strip())
        available = sum(1 for q in questions if q.get("family_spec_sha") == s.sha)
        if graded < min(GRADE_SAMPLE, available):
            reasons.append(f"only {graded} instance(s) graded, {min(GRADE_SAMPLE, available)} required")
        if reasons:
            rejected[s.id] = reasons
        else:
            accepted[s.id] = {"grades": sorted({f for f, _ in runs}), "graded_instances": graded}
    return accepted, rejected


# ---- the book side: objectives, book questions, the tier floor -----------
def book_objectives(book) -> dict[str, dict]:
    """Objectives, their module and their book questions, from the book's bundles."""
    los: dict[str, dict] = {}
    module_of: dict[str, str] = {}
    questions: dict[str, list] = {}
    for path in book.bundle_paths():
        if not path.exists():
            continue
        b = json.loads(path.read_text())
        for n in b.get("nodes", []):
            if n.get("kind") == "learning_objective" and book.owns_lo(n["id"]):
                los[n["id"]] = {"label": n.get("label"), "description": n.get("description"),
                                "source_page": n.get("source_page")}
        for e in b.get("edges", []):
            if e.get("type") == "teaches" and str(e.get("src", "")).startswith("module:"):
                module_of[e["dst"]] = e["src"]
        for q in b.get("questions", []):
            questions.setdefault(q.get("lo"), []).append(q)
    for lo, rec in los.items():
        rec["module"] = module_of.get(lo)
        rec["questions"] = questions.get(lo, [])
    return los


def tier_floor(objectives: dict[str, dict], generated: list[dict]) -> dict:
    """FR-4305 / FR-1109: every objective × tier cell, book and generated together.

    A book question fills a cell only when it will be LIVE: `verified` in its bundle, which is what
    the loader serves and what coverage_report.py's tier_floor counts. A question held at G2 (a
    three-way disagreement, a key the app's marker cannot read) fills nothing, so S6 authors for
    that tier — the Chapter 8 dry run found the two counts disagreeing."""
    cells = {lo: {t: {"book": 0, "generated": 0} for t in ("basic", "standard", "advanced")}
             for lo in objectives}
    for lo, rec in objectives.items():
        for q in rec["questions"]:
            if q.get("tier") in cells[lo] and q.get("verified", True):
                cells[lo][q["tier"]]["book"] += 1
    for q in generated:
        if q["lo_id"] in cells and q["tier"] in cells[q["lo_id"]]:
            cells[q["lo_id"]][q["tier"]]["generated"] += 1
    below = [{"lo_id": lo, "missing": [t for t, c in tiers.items() if c["book"] + c["generated"] == 0]}
             for lo, tiers in cells.items()]
    below = [b for b in below if b["missing"]]
    return {"format": "ainext.tier-floor/1", "objectives": len(cells),
            "cells": len(cells) * 3, "cells_filled": sum(1 for t in cells.values() for c in t.values()
                                                         if c["book"] + c["generated"]),
            "below_floor": below, "by_objective": cells}


def author_args(book, specs, objectives: dict, entries: dict, all_objectives: bool, generated: list[dict],
                figures: dict | None = None) -> dict:
    """``args`` for families.workflow.js (mode "author"): the gap list and its evidence. `figures`
    (question id -> image files, assemble_misconceptions.figures_by_question) puts each book question's
    diagram beside it, so the author sees what a [figure] stem shows (s6-v4)."""
    figures = figures or {}
    import book_config
    floor = tier_floor(objectives, generated)
    gaps = {b["lo_id"]: b["missing"] for b in floor["below_floor"]}
    existing: dict[str, list[str]] = {}
    for s in specs:
        existing.setdefault(s.lo_id, []).append(s.id)
    objs = []
    for lo, rec in sorted(objectives.items()):
        if not all_objectives and lo not in gaps:
            continue
        # parents: the book's verified questions first (a family names a reviewed parent, FR-1101)
        qs = sorted(rec["questions"], key=lambda q: (not q.get("verified", True), q.get("type") != "numeric",
                                                     q.get("id")))[:8]
        objs.append({
            "lo_id": lo, "label": rec["label"], "description": rec["description"],
            "module": rec["module"], "lesson": book_config.lesson_slug(lo),
            "tier_gaps": gaps.get(lo, []), "existing_families": existing.get(lo, []),
            "book_questions": [{**{k: q.get(k) for k in ("id", "tier", "type", "stem", "choices", "answer",
                                                          "solution", "source_page")},
                                **({"figures": figures[q["id"]]} if figures.get(q.get("id")) else {})} for q in qs],
            "misconceptions": [{"id": m["id"], "label": m.get("label"), "description": m.get("description")}
                               for m in entries.values() if m.get("lo_id") == lo],
        })
    return book_config.workflow_args(book, extra={"mode": "author", "objectives": objs})


# ---- packet by reference (packet_ref.py) ---------------------------------
# `--author-args A --by-ref [DIR]` and `--grade-args G --by-ref [DIR]`: the big blocks of
# families.workflow.js's prompts go to shard files, rendered as the workflow renders them, and the
# args keep what its control flow reads. tests/test_packet_ref.py splices them back and compares.
#   author  o/<tail>.book-questions.txt   JSON.stringify(book_questions, null, 1)   that objective's author
#           o/<tail>.misconceptions.txt   JSON.stringify(misconceptions, null, 1)
#   grade   solve/f001-q1.txt …           an instance's STEM only       the BLIND solver of family 1
#           judge/f001.txt …              the family line, then JSON.stringify({id, stem, ...sealed}, null, 1)
#                                         per instance: the judge of family 1
# WHOLE by reference (decision of 2026-09-26, Q2): inline clips these at 12000, 4000 and 5000 characters;
# by reference nothing is cut.
# The solver's shards hold nothing sealed (no key, no worked solution, no misconception tag, no
# instance id): the blind rule holds by construction, and the judge's shards are in another folder.
BOOK_KEYS_S6 = ("book", "title", "language", "grade", "notation")


def _small_book(book_block: dict, keys=BOOK_KEYS_S6) -> dict:
    return {k: book_block.get(k) for k in keys if k in book_block}


def author_args_by_ref(args: dict, directory: Path) -> dict:
    import packet_ref
    shards = packet_ref.Shards(directory, "S6 author")
    refs = []
    for o in args["objectives"]:
        tail = o["lo_id"].removeprefix("lo:")
        shards.put(f"o/{tail}.book-questions.txt", packet_ref.js_json(packet_ref.js_or(o.get("book_questions"), []), 1))
        shards.put(f"o/{tail}.misconceptions.txt", packet_ref.js_json(packet_ref.js_or(o.get("misconceptions"), []), 1))
        n_fig = sum(len(q.get("figures") or []) for q in o.get("book_questions") or [])
        refs.append({**{k: o.get(k) for k in ("lo_id", "label", "description", "module", "lesson", "tier_gaps",
                                              "existing_families")},
                     **({"figures": n_fig} if n_fig else {})})
    out = {k: v for k, v in args.items() if k not in ("objectives", "book")}
    out["book"] = _small_book(args["book"])
    out["by_ref"] = shards.finish({"book": args["book"]["book"], "mode": "author"})
    out["objective_refs"] = refs
    return out


def grade_args(book_block: dict, gs: dict) -> dict:
    """families.workflow.js's args, mode "grade", inline."""
    return {"mode": "grade", "book": book_block, "grading_set": gs}


def _js_judge_head(f: dict) -> str:
    from packet_ref import js, js_truthy
    return (f"Family {js(f.get('family_id'))} on {js(f.get('lo_id'))}, tier {js(f.get('tier'))}, answer type "
            f"{js(f.get('answer_type'))}.\n" + (f"Fixed context: {js(f['context'])}" if js_truthy(f.get("context")) else ""))


def grade_args_by_ref(book_block: dict, gs: dict, directory: Path, limit: int | None = None) -> list[dict]:
    """Compact grade args. Per family: {"f": family_id, "s": spec_sha, "i": instance rows}, an
    instance row being [instance_id, stem_sha, fmt] with fmt = the options as [[key, text], …] (a
    choice), "n" (a number) or the blind answer_format itself (anything else) — what the script
    needs to write the solver's answer instructions and to map a letter back to its option text.
    Everything else the two prompts carry is in the shards.

    A list: one args, or — when one would pass `limit` bytes (default packet_ref.COMPACT_LIMIT) —
    PARTS, each a run of its own over consecutive families (`grading_ref.offset` numbers their
    shards). Every part's return value is a grade file; `--grades` takes them all."""
    import packet_ref
    shards = packet_ref.Shards(directory, "S6 grade")
    fams = []
    for n, f in enumerate(gs["families"], start=1):
        rows = []
        for i, inst in enumerate(f.get("instances") or [], start=1):
            b = inst["blind"]
            shards.put(f"solve/f{n:03d}-q{i}.txt", b["stem"])
            af = b.get("answer_format")
            if "options" in b:
                if (af or {}).get("type") != "choice":
                    raise ValueError(f"{inst['instance_id']}: options without a choice answer format")
                fmt = [[o["key"], o["text"]] for o in b["options"]]
            elif af is None or af.get("type") == "number":
                fmt = "n"
            else:
                fmt = af
            rows.append([inst["instance_id"], b["stem_sha"], fmt])
        if rows:
            shards.put(f"judge/f{n:03d}.txt", _js_judge_head(f) + "\n\nINSTANCES:\n" + "\n\n".join(
                packet_ref.js_json({"id": inst["instance_id"], "stem": inst["blind"]["stem"], **inst["sealed"]}, 1)
                for inst in f["instances"]))
        fams.append({"f": f["family_id"], "s": f["spec_sha"], "i": rows})
    ref = shards.finish({"book": book_block.get("book"), "mode": "grade", "grading_seed": gs.get("seed")})

    def part(offset: int, fs: list) -> dict:
        return {"mode": "grade", "book": _small_book(book_block), "by_ref": ref,
                "grading_ref": {"format": gs["format"], "offset": offset, "families": fs}}
    limit = limit or packet_ref.COMPACT_LIMIT
    whole = part(0, fams)
    if packet_ref.args_size(whole) <= limit or len(fams) < 2:
        return [whole]
    parts, start = [], 0
    for k in range(1, len(fams) + 1):          # greedy: the longest run of families that fits
        if k - start > 1 and packet_ref.args_size(part(start, fams[start:k])) > limit:
            parts.append(part(start, fams[start:k - 1]))
            start = k - 1
    parts.append(part(start, fams[start:]))
    return parts


# ---- the reproduction proof ----------------------------------------------
def _strip(q: dict) -> dict:
    return {k: v for k, v in q.items() if k not in DECLARATIVE_ONLY_KEYS}


def _mc_free(q: dict) -> dict:
    q = json.loads(json.dumps(q))
    for c in q.get("choices") or []:
        c.pop("misconception_id", None)
    return q


def compare_legacy(specs, per_family: int, seed: int, export: Path | None = None) -> dict:
    """Prove a spec reproduces the hand-written family of the same id.

    1. Per family, before key rebalancing: every field of every item equal, except
       misconception ids, which must map one-to-one (legacy id → spec id).
    2. With ``export``: splice the declarative families into the registry in
       place of their hand-written twins, run the whole bank through the one
       driver and ``rebalance_keys()``, and compare with the committed bank.
    """
    legacy = {f.id: f for f in REGISTRY}
    report: dict = {"per_family": per_family, "seed": seed, "families": {}, "all_identical": True}
    for s in specs:
        fam = legacy.get(s.id)
        if fam is None:
            report["families"][s.id] = {"status": "no hand-written twin"}
            continue
        a, _, _ = instantiate([fam], per_family, seed)
        b, rej, _ = run_specs([s], per_family, seed)
        rec: dict = {"items": [len(a), len(b)], "differences": [], "misconception_map": {}}
        if rej:
            rec["differences"].append(f"spec rejections: {rej[:3]}")
        for x, y in zip(a, b):
            y = _strip(y)
            if _mc_free(x) != _mc_free(y):
                rec["differences"].append(f"{x['id']}: {[k for k in x if x.get(k) != y.get(k)]}")
            for cx, cy in zip(x.get("choices") or [], y.get("choices") or []):
                mx, my = cx.get("misconception_id"), cy.get("misconception_id")
                if mx != my:
                    prev = rec["misconception_map"].setdefault(str(mx), my)
                    if prev != my:
                        rec["differences"].append(f"{x['id']}: {mx} maps to both {prev} and {my}")
        if len(a) != len(b):
            rec["differences"].append(f"item counts differ: {len(a)} vs {len(b)}")
        rec["status"] = "identical" if not rec["differences"] else "DIFFERENT"
        report["all_identical"] &= rec["status"] == "identical"
        report["families"][s.id] = rec
    if export is not None:
        report["export"] = compare_with_export(specs, per_family, seed, export)
        report["all_identical"] &= report["export"]["spliced_items_identical"]
    return report


def compare_with_export(specs, per_family: int, seed: int, export: Path) -> dict:
    by_id = {s.id: s for s in specs}
    spliced = [declarative_families([by_id[f.id]])[0] if f.id in by_id else f for f in REGISTRY]
    from families import evaluator as FE
    from families import spec as FS

    def row(item, qid, fam):
        return FS.to_question(item, qid, fam.spec) if hasattr(fam, "spec") else item.as_question(qid)

    questions, _, _ = instantiate(spliced, per_family, seed, to_row=row, spec_errors=(FE.EvalError,))
    rebalance_keys(questions, random.Random(seed))
    committed = {q["id"]: q for q in json.loads(Path(export).read_text())["questions"]}
    export_only = {"status", "reviewed_by", "reviewed_at"}
    out = {"export": str(export), "items": len(questions), "spliced_items": 0, "spliced_differences": [],
           "other_items_differing_only_in_misconception_ids": 0, "other_differences": []}
    for q in questions:
        c = committed.get(q["id"])
        if c is None:
            (out["spliced_differences"] if q.get("family") else out["other_differences"]).append(
                f"{q['id']}: not in the committed bank")
            continue
        # The export omits `source` (the loader forces 'variant') and writes
        # `"choices": null` on a numeric row, where the generator omits the key.
        c = {k: v for k, v in c.items() if k not in export_only and not (k == "choices" and v is None)}
        mine = {k: v for k, v in _strip(q).items() if k != "source"}
        if q.get("family"):
            out["spliced_items"] += 1
            if mine != c:
                keys = sorted(k for k in set(mine) | set(c) if mine.get(k) != c.get(k))
                out["spliced_differences"].append(f"{q['id']}: {keys}")
        elif mine != c:
            if _mc_free(mine) == _mc_free(c):
                out["other_items_differing_only_in_misconception_ids"] += 1
            else:
                out["other_differences"].append(q["id"])
    out["spliced_items_identical"] = not out["spliced_differences"] and out["spliced_items"] > 0
    return out


def main_families(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="declarative question families (decision 16)")
    ap.add_argument("--families", type=Path, required=True, help="families/<book>/ — one spec per *.json")
    ap.add_argument("--book", help="book config name (books/<book>.json): course, bundles, sacred guard")
    ap.add_argument("--course")
    ap.add_argument("--catalogue", type=Path, help="the S5 misconception catalogue (load_misconceptions.py shape)")
    ap.add_argument("--per-family", type=int, default=10,
                    help="a CAP, not a quota: a family stops early when its stems run out (§3.9)")
    ap.add_argument("--seed", type=int, default=20260925)
    ap.add_argument("--check", action="store_true", help="validate and instantiate; write nothing")
    ap.add_argument("--grading-set", type=Path, help="write the blind-grading set for families.workflow.js")
    ap.add_argument("--grade-sample", type=int, default=GRADE_SAMPLE)
    ap.add_argument("--grades", type=Path, nargs="*", default=[], help="families.workflow.js grade outputs")
    ap.add_argument("--out", type=Path, help="the generated-questions bundle (graded families only)")
    ap.add_argument("--floor-report", type=Path, help="FR-4305 tier floor, book and generated together")
    ap.add_argument("--author-args", type=Path, help="write args for families.workflow.js (mode author)")
    ap.add_argument("--lesson-runs", type=Path,
                    help="with --author-args: the lesson runs whose items name each book question's figure images "
                         "(default runs/<book>/lesson/)")
    ap.add_argument("--all-objectives", action="store_true", help="author args for every objective, not only gaps")
    ap.add_argument("--s5-distractors", type=Path, help="write S6's distractors for S5's final pass")
    ap.add_argument("--grade-args", type=Path, help="write families.workflow.js's args for mode grade (the grading set)")
    ap.add_argument("--by-ref", nargs="?", const="", default=None, metavar="DIR",
                    help="with --author-args or --grade-args: packet by reference (packet_ref.py) — the prompts' big "
                         "blocks to shard files in DIR (default work/<book>/packets/s6-<mode>/), compact args naming them")
    ap.add_argument("--revise-args", type=Path,
                    help="write families.workflow.js args (mode author, args.revise) re-authoring only the --revise "
                         "specs, each with its refusal: what --check says, plus every --revise-problem")
    ap.add_argument("--revise", type=Path, nargs="+", default=[], metavar="SPEC", help="with --revise-args")
    ap.add_argument("--revise-problem", nargs=2, action="append", default=[], metavar=("FAMILY_ID", "TEXT"),
                    help="with --revise-args: a reviewer's (or the blind judge's) reason for ONE of the --revise "
                         "specs, given to its author beside the check's own; repeatable")
    ap.add_argument("--compare-legacy", action="store_true", help="prove specs reproduce their hand-written twins")
    ap.add_argument("--export", type=Path, help="with --compare-legacy: the committed bank to compare against")
    args = ap.parse_args(argv)

    from families import spec as FS

    book = None
    if args.book:
        import book_config
        book = book_config.load_book(args.book)
        if book.sacred_content:
            # The variant engine's rule (ADR-0006): sacred text is copied, never
            # produced. A book that carries it gets no generated families at all.
            print(f"REFUSING: {book.book} carries sacred content; families are never generated for it "
                  "(ADR-0006, variant_engine.assert_variable).", file=sys.stderr)
            return 2
    course = args.course or (book.course_id if book else None)

    if args.revise_args:
        if not book or not args.revise:
            print("--revise-args needs --book and --revise SPEC …", file=sys.stderr)
            return 2
        entries = []
        import assemble_misconceptions as am
        runs_dir = args.lesson_runs or Path(__file__).resolve().parent / "runs" / book.book / "lesson"
        figs = am.figures_by_question([json.loads(p.read_text()) for p in sorted(runs_dir.glob("*.json"))])
        raws = [json.loads(Path(f).read_text()) for f in args.revise]
        unknown = {fid for fid, _ in args.revise_problem} - {r.get("id") for r in raws}
        if unknown:
            print(f"--revise-problem names {sorted(unknown)}, which no --revise spec is", file=sys.stderr)
            return 2
        for f, raw in zip(args.revise, raws):
            found = spec_problems(raw, args.per_family, args.seed)
            given = [t for fid, t in args.revise_problem if fid == raw.get("id")]
            if not found and not given:
                print(f"REFUSING: {f} passes --check and no --revise-problem says why it is re-authored", file=sys.stderr)
                return 2
            parent_figs = figs.get(raw.get("parent_question_id")) or []
            entries.append({"spec": raw, "problems": found + given, **({"figures": parent_figs} if parent_figs else {})})
        ra = revise_args(book, entries)
        args.revise_args.parent.mkdir(parents=True, exist_ok=True)
        args.revise_args.write_text(json.dumps(ra, indent=2, ensure_ascii=False) + "\n")
        print(f"wrote {args.revise_args} — {len(entries)} spec(s) to re-author: "
              + "; ".join(f"{e['spec'].get('id')} ({len(e['problems'])} reason(s))" for e in entries))
        return 0

    specs, problems = FS.load_dir(args.families)
    for p in problems:
        print(f"  x {p}", file=sys.stderr)
    if book:
        for s in specs:
            if not book.owns_lo(s.lo_id):
                problems.append(f"{s.id}: {s.lo_id} is not an objective of {book.book}")
                print(f"  x {problems[-1]}", file=sys.stderr)
    if problems:
        print(f"{len(problems)} spec problem(s); nothing instantiated from a malformed spec.", file=sys.stderr)
        if not args.check:
            return 1

    if args.compare_legacy:
        rep = compare_legacy(specs, args.per_family, args.seed if "--seed" in argv else 20260912, args.export)
        print(json.dumps(rep, indent=2, ensure_ascii=False))
        return 0 if rep["all_identical"] else 1

    questions, rejected, counts = run_specs(specs, args.per_family, args.seed)
    rebalance_keys(questions, random.Random(args.seed))
    for r in rejected[:20]:
        print(f"  x rejected: {r}", file=sys.stderr)
    print(f"{len(specs)} spec(s) → {len(questions)} item(s); per family: "
          + ", ".join(f"{k.split(':')[-1]}={v}" for k, v in counts.items()))
    empty = [k for k, v in counts.items() if v == 0]
    if empty:
        print(f"  x families that produced nothing: {', '.join(empty)}", file=sys.stderr)

    entries, alias = load_catalogue(args.catalogue)
    objectives = book_objectives(book) if book else {}

    if args.by_ref and args.author_args and args.grade_args:
        print("--by-ref DIR with both --author-args and --grade-args would write both packets into one "
              "directory: give them separately, or use the default directories (--by-ref with no DIR)",
              file=sys.stderr)
        return 2
    if args.author_args:
        if not book:
            print("--author-args needs --book (the objectives and book questions come from its bundles)",
                  file=sys.stderr)
            return 2
        import assemble_misconceptions as am
        runs_dir = args.lesson_runs or Path(__file__).resolve().parent / "runs" / book.book / "lesson"
        figs = am.figures_by_question([json.loads(p.read_text()) for p in sorted(runs_dir.glob("*.json"))])
        a = author_args(book, specs, objectives, entries, args.all_objectives, [], figs)
        n_obj, extra = len(a["objectives"]), ""
        if args.by_ref is not None:
            import packet_ref
            a = author_args_by_ref(a, Path(args.by_ref) if args.by_ref else packet_ref.default_dir(book.book, "s6", "author"))
            extra = f"; {a['by_ref']['files']} shard(s) in {a['by_ref']['dir']}; " + packet_ref.report(a, "by ref")
        args.author_args.parent.mkdir(parents=True, exist_ok=True)
        import packet_ref
        args.author_args.write_text((packet_ref.dumps(a) if "by_ref" in a   # by ref: one line, to paste
                                     else json.dumps(a, indent=2, ensure_ascii=False)) + "\n")
        print(f"wrote {args.author_args} — {n_obj} objective(s) for the author{extra}")

    if args.grading_set or args.grade_args:
        gs = grading_set(specs, questions, args.seed, args.grade_sample)
        gs.update({"book": book.book if book else None, "per_family": args.per_family})
    if args.grading_set:
        args.grading_set.parent.mkdir(parents=True, exist_ok=True)
        args.grading_set.write_text(json.dumps(gs, indent=2, ensure_ascii=False) + "\n")
        print(f"wrote {args.grading_set} — {sum(len(f['instances']) for f in gs['families'])} instance(s) "
              f"from {len(gs['families'])} famil(ies) for the blind grader")
    if args.grade_args:
        if not book:
            print("--grade-args needs --book", file=sys.stderr)
            return 2
        import book_config
        bb = book_config.workflow_args(book)["book"]
        args.grade_args.parent.mkdir(parents=True, exist_ok=True)
        if args.by_ref is not None:
            import packet_ref
            parts = grade_args_by_ref(bb, gs, Path(args.by_ref) if args.by_ref else packet_ref.default_dir(book.book, "s6", "grade"))
            outs = [args.grade_args] if len(parts) == 1 else \
                [args.grade_args.with_name(f"{args.grade_args.stem}.part{k}{args.grade_args.suffix}")
                 for k in range(1, len(parts) + 1)]
            for stale in [args.grade_args, *args.grade_args.parent.glob(f"{args.grade_args.stem}.part*{args.grade_args.suffix}")]:
                stale.unlink(missing_ok=True)       # never leave an earlier build's args beside these
            for ga, out in zip(parts, outs):
                out.write_text(packet_ref.dumps(ga) + "\n")
                print(f"wrote {out} — families.workflow.js args, mode grade, "
                      f"{len(ga['grading_ref']['families'])} famil(ies); {ga['by_ref']['files']} shard(s) in "
                      f"{ga['by_ref']['dir']}; " + packet_ref.report(ga, "by ref"))
            if len(parts) > 1:
                print(f"  {len(parts)} parts: run the workflow once per part and pass every return value to --grades")
        else:
            args.grade_args.write_text(json.dumps(grade_args(bb, gs), indent=2, ensure_ascii=False) + "\n")
            print(f"wrote {args.grade_args} — families.workflow.js args, mode grade")

    eval_errors = [r for r in rejected if ": evaluation error: " in r]
    if eval_errors:
        print(f"  x {len(eval_errors)} attempt(s) failed to evaluate — a spec bug, fix it with a "
              "constraint or a require", file=sys.stderr)
    if args.s5_distractors:
        # with the blind grades, S5 is told only about the families that passed: a refused family's distractors
        # must not become a misconception's evidence
        graded = None
        if args.grades:
            ok, _ = apply_grades(specs, questions, args.grades)
            graded = [s for s in specs if s.id in ok]
        ds = s5_distractors(specs if graded is None else graded, questions)
        args.s5_distractors.parent.mkdir(parents=True, exist_ok=True)
        args.s5_distractors.write_text(json.dumps({"distractors": ds}, indent=2, ensure_ascii=False) + "\n")
        print(f"wrote {args.s5_distractors} — {len(ds)} distractor(s) for S5 (misconceptions.workflow.js, "
              "stage final, args.distractors)"
              + ("" if graded is None else f", from the {len(graded)} of {len(specs)} famil(ies) the blind grade passed"))

    status = 1 if (problems or empty or eval_errors) and args.check else 0
    if args.out:
        if problems:
            return 1
        if not args.grades:
            print("REFUSING --out without --grades: no family reaches a bundle before its blind grade "
                  "(§3.9). Run --grading-set, then families.workflow.js in grade mode.", file=sys.stderr)
            return 1
        if not args.catalogue:
            print("REFUSING --out without --catalogue: distractor tags must resolve against S5's "
                  "catalogue (FR-1112, FR-1115).", file=sys.stderr)
            return 1
        if "records" in json.loads(args.catalogue.read_text()):
            print("REFUSING --out against an S5 run: the bundle is written only against the ASSEMBLED "
                  "final catalogue (assemble_misconceptions.py), never a draft's unverified entries.",
                  file=sys.stderr)
            return 1
        accepted, refused = apply_grades(specs, questions, args.grades)
        for fid, reasons in refused.items():
            print(f"  x {fid}: REJECTED — {'; '.join(reasons[:3])}", file=sys.stderr)
        accepted_shas = {s.sha for s in specs if s.id in accepted}
        keep = [q for q in questions if q.get("family_spec_sha") in accepted_shas]
        tag_problems, untagged, used = resolve_tags(keep, entries, alias)
        for u in untagged:
            print(f"  ! {u}", file=sys.stderr)
        if tag_problems:
            for p in tag_problems:
                print(f"  x {p}", file=sys.stderr)
            return 1
        bundle = {
            "bundle": "generated-questions-v2",
            "generator": "declarative families — services/extraction/generate_questions.py --families "
                         "(decision 16)",
            "course_id": course,
            "book": book.book if book else None,
            "reviewed": False,
            "seed": args.seed,
            "per_family": args.per_family,
            "note": ("Declarative families: every key computed from the sampled parameters by the safe "
                     "evaluator that writes the stem; each family blind-graded on sampled instances "
                     "before it could reach this file (ADR-0008, decision 16)."),
            "families": {k: v for k, v in counts.items() if k in accepted},
            "family_specs": {s.id: s.sha for s in specs if s.id in accepted},
            "family_grades": accepted,
            "rejected_families": refused,
            "untagged_distractors": untagged,
            "misconceptions": [{k: entries[m].get(k) for k in ("id", "lo_id", "label", "description")}
                               for m in sorted(used)],
            "questions": keep,
        }
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(bundle, indent=2, ensure_ascii=False) + "\n")
        print(f"wrote {args.out} — {len(keep)} item(s) from {len(accepted)} accepted famil(ies); "
              f"{len(refused)} rejected or ungraded")
        questions = keep

    if args.floor_report:
        if not book:
            print("--floor-report needs --book", file=sys.stderr)
            return 2
        fl = tier_floor(objectives, questions)
        args.floor_report.parent.mkdir(parents=True, exist_ok=True)
        args.floor_report.write_text(json.dumps(fl, indent=2, ensure_ascii=False) + "\n")
        print(f"wrote {args.floor_report} — {fl['cells_filled']}/{fl['cells']} objective×tier cells filled; "
              f"{len(fl['below_floor'])} objective(s) below the floor")
    return status


if __name__ == "__main__":
    sys.exit(main())
