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


M_PROD_SUM = mc("mc:cardinality-added", "lo:u1-1-2",
                "n(X x Y) computed as n(X) + n(Y)",
                "Adds the cardinalities of the two sets instead of multiplying them.")


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


M_RANGE_CODOMAIN = mc("mc:range-equals-codomain", "lo:u1-3-2",
                      "Range taken to be the whole codomain",
                      "Assumes every element of the codomain is an image; the range can be a proper subset.")


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


M_SLOPE_INTERCEPT = mc("mc:slope-intercept-swapped", "lo:u1-4-2",
                       "Slope and intercept exchanged",
                       "Reads b as the slope and a as the y-intercept in f(x) = ax + b.")


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
M_PROPORTION_CROSS = mc("mc:cross-multiply-reversed", "lo:u2-2-1",
                        "Cross-multiplication taken the wrong way round",
                        "Pairs a:b = c:d as a x c = b x d instead of a x d = b x c.")


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


M_VARIATION_SWAP = mc("mc:direct-inverse-swapped", "lo:u2-3-2",
                      "Direct and inverse variation exchanged",
                      "Uses y = kx where xy = k is required, or the reverse.")


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

M_DMS_DECIMAL = mc("mc:dms-read-as-decimal", "lo:u4-1-1",
                   "Minutes read as a decimal fraction of a degree",
                   "Treats 30' as 0.30 degrees instead of 30/60 of a degree.")
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
    for text in [item.stem] + [c["text"] for c in (item.choices or [])]:
        if text.count("$") % 2 != 0:
            problems.append(f"unbalanced math delimiters in {text[:40]!r}")
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


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--per-family", type=int, default=10)
    ap.add_argument("--seed", type=int, default=20260912)
    ap.add_argument("--course", default="course:prep3-math-en")
    args = ap.parse_args()

    questions: list[dict] = []
    rejected: list[str] = []
    per_family_counts: dict[str, int] = {}

    for fam in REGISTRY:
        # Each family gets its own stream, so adding a family never renumbers
        # the items of the families before it.
        rng = random.Random(f"{args.seed}:{fam.id}")
        seen_stems: set[str] = set()
        made = 0
        attempts = 0
        while made < args.per_family and attempts < args.per_family * 25:
            attempts += 1
            item = fam.build(rng)
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
            qid = f"{fam.lo_id.replace('lo:', 'q:')}:g{made:03d}-{fam.id.split(':')[-1][:6]}"
            questions.append(item.as_question(qid))
        per_family_counts[fam.id] = made

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


if __name__ == "__main__":
    sys.exit(main())
