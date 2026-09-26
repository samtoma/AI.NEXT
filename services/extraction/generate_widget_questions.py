"""Generate WIDGET questions — constructions, bound to objectives (ADR-0009).

    uv run generate_widget_questions.py --out seed/widget-questions-v1.json --dsn ...
    uv run generate_widget_questions.py --templates widgets/<book> --book <book> --dsn ... \
        [--author-args A] [--verify-args V] [--by-ref [DIR]] [--verdicts runs/<book>/widgets/verify-*.json] \
        [--gaps runs/<book>/widgets/author-*.json] [--gap-report coverage/<book>.widget-gaps.json] \
        [--out seed/generated/<book>/widget-questions.json]

The second form is stage S7 of the line (docs/specs/extraction-pipeline.md §3.10,
build item B13): JSON templates written by widgets.workflow.js, every mandatory
check (validate_widget, reachability FR-1207, the prerequisite rule FR-1215
against the graph, parent_question_id set), the blind reachability verifier's
verdicts applied fail-closed, and the per-chapter widget-gap report (FR-4306).

A widget question is a question. It carries an `lo_id`, a `tier`, a stem, a
canonical solution and a set of enumerated wrong answers — except that its wrong
answers are PREDICATES over a continuous answer space rather than four lettered
options. Everything downstream treats it like any other item.

WHAT THIS BUYS THAT THE QUESTION BANK COULD NOT. A multiple-choice distractor
tells you a student picked B. A construction tells you what they believe: drag
both ends of a segment onto the circle and call it a radius, and you have shown
your definition. One in four wrong options is a guess; a wrong construction
almost never is. That is why sixteen of the misconceptions these questions
diagnose had no printed distractor anywhere in the book — nobody can write a
multiple-choice item that catches "thinks a diameter is any long chord".

THE PREREQUISITE RULE. For multiple choice, `load_generated_questions.validate`
requires a distractor's misconception to belong to the question's own objective.
Widgets relax that in one specific direction: a diagnostic may name a
misconception on the question's objective **or on any transitive prerequisite of
it**, verified against the curriculum graph rather than asserted here. That is
not a loosening for convenience — it is the point. A student sketching a
quadratic who doubles back has not failed at quadratics; they are missing the
function concept from three lessons earlier, and `lo:u1-3-1` really is a
prerequisite of `lo:u1-4-3` in the graph. Being able to say so is most of the
reason for making widgets questions at all.

Generated content, so: `source='variant'`, `reviewed_by=NULL`, bounded to the
comparison environment, sampled for the human gate (ADR-0008).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from fractions import Fraction
from pathlib import Path

import widget_spec as W

GENERATOR = "services/extraction/generate_widget_questions.py (ADR-0009)"


class T:
    """One widget question template. `n` instances are emitted from it."""

    def __init__(
        self,
        lo: str,
        tier: str,
        kind: str,
        spec: dict,
        stem: str,
        solution: list[str],
        diagnostics: list[tuple[str, str]],
        family: str,
    ):
        self.lo = lo
        self.tier = tier
        self.kind = kind
        self.spec = spec
        self.stem = stem
        self.solution = solution
        self.diagnostics = diagnostics
        self.family = family


TEMPLATES: list[T] = []


def t(**kw) -> None:
    TEMPLATES.append(T(**kw))


# --- THE CIRCLE ---------------------------------------------------------
t(lo="lo:geo1-1-1", tier="basic", kind="circle_builder",
  spec={"element": "radius"}, family="circle-radius",
  stem="Circle $M$ has radius $5$. Construct a **radius** of the circle.",
  solution=["A radius joins the centre to the circle.",
            "Put one end at the centre $M = (0, 0)$.",
            "Put the other on the circle — any of the twelve lattice points at distance $5$ will do, for example $(3, 4)$ or $(-5, 0)$.",
            "Every radius of this circle has the same length, $5$. That fixed distance is what makes it a circle."],
  diagnostics=[("radius-drawn-as-chord", "mc:geo1-1-1:radius-not-from-centre"),
               ("radius-short", "mc:geo1-1-1:radius-any-length")])

t(lo="lo:geo1-1-1", tier="basic", kind="circle_builder",
  spec={"element": "chord"}, family="circle-chord",
  stem="Circle $M$ has radius $5$. Construct a **chord** of the circle.",
  solution=["A chord joins two points that are both on the circle.",
            "Put both ends on the circle — $(-3, 4)$ and $(4, -3)$, for example.",
            "It does not matter where: any two points on the circle give a chord.",
            "Note what is NOT required — a chord need not pass through the centre. The one that does is the diameter."],
  diagnostics=[("ends-not-on-circle", "mc:geo1-1-1:chord-endpoints-off-circle"),
               ("radius-drawn-as-chord", "mc:geo1-1-1:radius-not-from-centre")])

t(lo="lo:geo1-1-2", tier="standard", kind="circle_builder",
  spec={"element": "diameter"}, family="circle-diameter",
  stem="Circle $M$ has radius $5$. Construct a **diameter**.",
  solution=["A diameter is the chord that passes through the centre.",
            "So it needs both: two ends on the circle, AND the segment through $M$.",
            "Take a point on the circle and its opposite — $(3, 4)$ and $(-3, -4)$.",
            "Its length is $2r = 10$, and no other chord is longer. That is the theorem of this lesson, and it holds BECAUSE the diameter passes through the centre."],
  diagnostics=[("chord-not-through-centre", "mc:geo1-1-2:diameter-is-any-long-chord"),
               ("ends-not-on-circle", "mc:geo1-1-1:chord-endpoints-off-circle")])

t(lo="lo:geo1-2-2", tier="standard", kind="circle_builder",
  spec={"element": "tangent"}, family="circle-tangent",
  stem="Circle $M$ has radius $5$. Draw a **tangent** to the circle.",
  solution=["A tangent meets the circle at exactly one point.",
            "The test is a distance: measure from the centre $M$ to the line.",
            "Less than $5$ and the line cuts the circle twice (a secant); more than $5$ and it misses entirely.",
            "Exactly $5$ and it touches once. The vertical line $x = 5$ works, and so does the line through $(3, 4)$ and $(7, 1)$."],
  diagnostics=[("is-secant", "mc:geo1-2-2:tangent-cuts-circle"),
               ("is-external", "mc:geo1-2-2:tangent-need-not-touch")])

# --- ANGLES AND ARCS ----------------------------------------------------
for _target in (30, 35, 45, 55, 70):
    t(lo="lo:geo2-2-2", tier="standard", kind="angle_setter",
      spec={"ask": "inscribed", "target": _target}, family="inscribed-angle",
      stem=f"$A$, $B$ and $C$ lie on circle $M$. Set the inscribed angle $\\angle ACB$ to ${_target}°$.",
      solution=["An inscribed angle is half the arc it faces.",
                f"So for $\\angle ACB = {_target}°$ the arc $AB$ that $C$ looks across at must measure ${2 * _target}°$.",
                "Drag $B$ until the arc reads that, and the angle follows.",
                "Then drag $C$ anywhere else on the same arc and watch: the angle does not move. Every inscribed angle on that arc is the same."],
      diagnostics=[("arc-given-as-angle", "mc:geo2-2-2:inscribed-angle-doubled"),
                   ("angle-given-as-arc", "mc:geo2-2-2:inscribed-angle-doubled")])

for _target in (60, 90, 120, 140):
    t(lo="lo:geo2-2-2", tier="standard", kind="angle_setter",
      spec={"ask": "central", "target": _target}, family="central-angle",
      stem=f"$A$ and $B$ lie on circle $M$. Set the arc $AB$ facing $C$ to ${_target}°$, and read the inscribed angle.",
      solution=[f"Drag $B$ until the arc $AB$ that $C$ faces measures ${_target}°$.",
                f"The central angle $\\angle AMB$ is the same ${_target}°$ — a central angle equals its arc.",
                f"The inscribed angle $\\angle ACB$ then reads ${_target // 2}°$, exactly half.",
                "That 2:1 relationship is the theorem, and it holds for every position of $C$ on that arc."],
      diagnostics=[("angle-given-as-arc", "mc:geo2-2-2:inscribed-angle-doubled"),
                   ("arc-given-as-angle", "mc:geo2-2-2:inscribed-angle-doubled")])

# --- TRIGONOMETRY -------------------------------------------------------
for _ask, _target, _legs in (("sin", 0.6, "3 and 4"), ("cos", 0.8, "3 and 4"),
                             ("tan", 0.75, "3 and 4"), ("sin", 0.8, "4 and 3"),
                             ("tan", 2.4, "12 and 5"), ("cos", 0.6, "4 and 3")):
    t(lo="lo:u4-1-2", tier="standard", kind="triangle_ratio",
      spec={"ask": _ask, "target": _target}, family=f"trig-{_ask}",
      stem=f"Build a right triangle in which $\\{_ask} \\theta = {_target}$.",
      solution=[f"$\\{_ask} \\theta$ compares two particular sides — name them before you drag anything.",
                f"Legs of {_legs} give a hypotenuse you can read off exactly.",
                f"That makes $\\{_ask} \\theta = {_target}$.",
                "Now double both legs. The triangle is twice the size and the ratio has not moved — that is why these ratios depend only on the angle."],
      diagnostics=[("ratio-inverted", "mc:u4-1-2:ratio-inverted")])

# --- STATISTICS ---------------------------------------------------------
for _target in (6, 5, 7):
    t(lo="lo:u3-2-1", tier="standard", kind="bar_builder",
      spec={"ask": "mean", "target": _target, "n": 5}, family="stat-mean",
      stem=f"Build a set of five values whose **mean** is ${_target}$.",
      solution=[f"The mean is the total shared out equally, so for five values averaging ${_target}$ the total must be ${5 * _target}$.",
                f"Any five values adding to ${5 * _target}$ will do — they do not have to be close together.",
                "Watch the median as you drag. It moves independently, which is the point: the mean feels every value, the median only position.",
                "Notice too that many different sets answer this question. The mean pins down the total and nothing else."],
      diagnostics=[("median-for-mean", "mc:u3-2-1:mean-built-as-median"),
                   ("total-wrong", "mc:u3-2-1:mean-built-as-median")])

for _target in (6, 4):
    t(lo="lo:u3-2-1", tier="standard", kind="bar_builder",
      spec={"ask": "median", "target": _target, "n": 5}, family="stat-median",
      stem=f"Build a set of five values whose **median** is ${_target}$.",
      solution=["Put the five values in order; the median is the one in the middle — the third.",
                f"So the third value must be ${_target}$, and the other four can be anything either side of it.",
                "The total is irrelevant here, which is the whole difference from the mean.",
                "Drag the largest value far higher and watch the median stay put while the mean climbs."],
      diagnostics=[("mean-for-median", "mc:u3-2-1:median-built-as-mean")])

t(lo="lo:u3-2-1", tier="basic", kind="bar_builder",
  spec={"ask": "mode", "target": 4, "n": 5}, family="stat-mode",
  stem="Build a set of five values whose **mode** is $4$.",
  solution=["The mode is the value that appears most often.",
            "So at least two of your five values must be $4$, and no other value may appear as often.",
            "If nothing repeats, the set has NO mode — that is a real answer, not a failure to find one.",
            "And if two values tie for most frequent, the set has two modes. The mode is the only average that can be missing or doubled."],
  diagnostics=[("no-mode", "mc:u3-2-1:mode-assumed-to-exist"),
               ("multi-modal", "mc:u3-2-1:mode-assumed-to-exist")])

t(lo="lo:u3-2-1", tier="basic", kind="bar_builder",
  spec={"ask": "range", "target": 7, "n": 5}, family="stat-range",
  stem="Build a set of five values whose **range** is $7$.",
  solution=["The range is the largest value minus the smallest.",
            "So set your highest and lowest seven apart — $2$ and $9$, say — and the three in between can be anything within that.",
            "Only two of the five values matter to the range. That is its weakness as a measure of spread.",
            "Compare the standard deviation shown underneath: change a middle value and the range does not flinch, but the deviation does."],
  diagnostics=[("off-target", "mc:u3-2-1:range-thought-to-use-all-values")])

# --- RATIO AND VARIATION ------------------------------------------------
for _a, _b, _c in ((3, 4, 9), (2, 5, 6), (4, 3, 8)):
    t(lo="lo:u2-3-1", tier="basic", kind="ratio_balance",
      spec={"mode": "direct", "a": _a, "b": _b, "c": _c}, family="variation-direct",
      stem=f"${_a} : {_b} = {_c} : ?$ — balance the beam.",
      solution=[f"Both quantities rise together, so this is DIRECT variation and the two ratios must be equal.",
                f"${_a} \\div {_b}$ and ${_c} \\div ?$ have to give the same number.",
                f"That makes the fourth term ${_b * _c // _a}$.",
                "The beam is level when the quotients match — watch it as you drag."],
      diagnostics=[("direct-solved-as-inverse", "mc:u2-3-1:direct-solved-as-inverse")])

for _a, _b, _c in ((6, 10, 4), (8, 6, 4), (12, 5, 10)):
    t(lo="lo:u2-3-2", tier="standard", kind="ratio_balance",
      spec={"mode": "inverse", "a": _a, "b": _b, "c": _c}, family="variation-inverse",
      stem=f"${_a}$ workers finish a job in ${_b}$ days. How long do ${_c}$ workers take?",
      solution=["Fewer workers means more days, so the quantities move in opposite directions — INVERSE variation.",
                f"What stays fixed is the PRODUCT: ${_a} \\times {_b} = {_a * _b}$ worker-days of work.",
                f"So ${_c}$ workers need ${_a * _b} \\div {_c} = {_a * _b // _c}$ days.",
                "Cross-multiplying the ratios would be the direct rule, and it gives the wrong answer here. Ask first which way the second quantity moves."],
      diagnostics=[("inverse-solved-as-direct", "mc:u2-3-2:inverse-solved-as-direct")])

# --- FUNCTIONS AND GRAPHS ----------------------------------------------
for _coefs, _desc in (([1, 0, -4], "opens upwards, turning at $(0, -4)$"),
                      ([-1, 0, 3], "opens downwards, turning at $(0, 3)$"),
                      ([1, -2, -3], "opens upwards, turning at $(1, -4)$")):
    t(lo="lo:u1-4-3", tier="advanced", kind="curve_sketcher",
      spec={"fn": "quadratic", "coefs": _coefs}, family="sketch-quadratic",
      stem=f"Sketch $y = {_coefs[0]}x^2 + {_coefs[1]}x + {_coefs[2]}$ freehand.",
      solution=[f"Read the sign of $a$ first: it decides the direction. Here the curve {_desc}.",
                "Find the turning point, then a point or two either side.",
                "Draw left to right in one stroke without going back.",
                "If the stroke doubles back, the sketch gives one $x$ two $y$ values — and that is not the graph of a function at all."],
      diagnostics=[("opens-wrong-way", "mc:u1-4-3:parabola-opens-wrong-way"),
                   ("fails-vertical-line-test", "mc:u1-3-1:fails-vertical-line-test")])

for _coefs in ([2, -1], [-1, 2], [1, 0]):
    t(lo="lo:u1-4-2", tier="standard", kind="curve_sketcher",
      spec={"fn": "linear", "coefs": _coefs}, family="sketch-linear",
      stem=f"Sketch $y = {_coefs[0]}x + {_coefs[1]}$ freehand.",
      solution=[f"The gradient is ${_coefs[0]}$, so the line {'rises' if _coefs[0] > 0 else 'falls'} as you go right.",
                f"It crosses the $y$-axis at ${_coefs[1]}$.",
                "Those two facts fix the line completely — start at the intercept and follow the gradient.",
                "One stroke, left to right."],
      diagnostics=[("slope-sign-flipped", "mc:u1-4-2:gradient-sign-misread")])

# --- COORDINATE GEOMETRY ------------------------------------------------
for _m, _b in ((2, -1), (-1, 3), (1, 0), (-2, 2)):
    t(lo="lo:u5-3-1", tier="standard", kind="line_drawer",
      spec={"mode": "equation", "m": _m, "b": _b}, family="line-equation",
      stem=f"Draw the line $y = {_m}x + {_b}$.",
      solution=[f"The gradient is ${_m}$: for each step right, the line climbs ${_m}$.",
                f"It meets the $y$-axis at $(0, {_b})$ — start there.",
                f"One step right lands you at $(1, {_m + _b})$. Put the handles on those two.",
                "Any two points on the line are correct: the line is the answer, not a particular pair of points."],
      diagnostics=[("slope-inverted", "mc:u5-3-1:slope-inverted"),
                   ("slope-sign-flipped", "mc:u5-3-1:slope-sign-flipped")])

# --- PROBABILITY --------------------------------------------------------
for _v, _n in ((7, 6), (5, 4), (9, 4)):
    t(lo="lo:t2u3-1-1", tier="basic", kind="sample_space",
      spec={"rows": 6, "cols": 6, "rule": {"kind": "sum", "op": "eq", "value": _v}},
      family="probability-sum",
      stem=f"Two dice are thrown. Select every outcome whose total is ${_v}$, then read $P$.",
      solution=[f"The sample space is the whole $6 \\times 6$ grid: $n(S) = 36$ outcomes.",
                f"A total of ${_v}$ happens ${_n}$ different ways, and order matters — the first die and the second did different things.",
                f"So $n(E) = {_n}$ and $P = \\frac{{{_n}}}{{36}}$.",
                "Count CELLS, not values. That is the trap: 'a total of 7' is one value and six outcomes."],
      diagnostics=[("counted-once", "mc:t2u3-1-1:compound-outcome-counted-once"),
                   ("missed-outcomes", "mc:t2u3-1-1:compound-outcome-counted-once")])

# --- FRACTIONAL FUNCTIONS ----------------------------------------------
# `_r` and `_s` are the SHIFTS the stem prints, `(x + r)(x + s)`; the values x
# cannot take are the ROOTS, `-r` and `-s`. Until v0.9.3 the targets stored the
# shifts, so the answer key was the sign error itself: a correct student was
# marked wrong and one who read the numbers off the factors was marked right
# (q:t2u2-2-1:w001–w003, migration 032). The targets, the stem and the solution
# now all come from the one pair of roots.
for _r, _s in ((-2, 3), (1, -4), (-5, 2)):
    _roots = sorted([-_r, -_s])
    t(lo="lo:t2u2-2-1", tier="standard", kind="number_line_marker",
      spec={"mode": "points", "range": [-6, 6], "targets": _roots},
      family="domain-excluded",
      stem=f"Mark every value $x$ cannot take in $\\frac{{1}}{{(x {_r:+d})(x {_s:+d})}}$.",
      solution=["The fraction breaks wherever the denominator is zero.",
                "Set the whole denominator to zero and solve it completely — every factor gives one root.",
                f"Here that is $x = {-_r}$ and $x = {-_s}$.",
                "Both are excluded. The domain is every real number except those two."],
      # The sign error first: it is the likelier one on a factored denominator.
      # `mc:u1-1-1:transposition-sign` is on a prerequisite of lo:t2u2-2-1
      # (FR-1215): x − 2 = 0 read as x = −2 is a sign lost across the equals.
      diagnostics=[("sign-flipped", "mc:u1-1-1:transposition-sign"),
                   ("missed-values", "mc:t2u2-2-1:excluded-values-incomplete")])


def build() -> list[dict]:
    out: list[dict] = []
    per_lo: dict[str, int] = {}
    for tpl in TEMPLATES:
        lo_short = tpl.lo.replace("lo:", "")
        per_lo[lo_short] = per_lo.get(lo_short, 0) + 1
        qid = f"q:{lo_short}:w{per_lo[lo_short]:03d}"
        out.append({
            "id": qid,
            "lo_id": tpl.lo,
            "tier": tpl.tier,
            "question_type": "widget",
            "stem": tpl.stem,
            "choices": W.widget_choices(tpl.kind, tpl.spec, tpl.diagnostics),
            "correct_answer": W.OK,
            "canonical_solution": [
                {"step": i, "text_md": s} for i, s in enumerate(tpl.solution, 1)
            ],
            "source_note": f"Generated from template family {tpl.family}.",
        })
    return out


def prerequisite_closure(cur, lo: str) -> set[str]:
    """`lo` plus every objective that is a transitive prerequisite of it."""
    cur.execute(
        """WITH RECURSIVE up(id) AS (
             SELECT %s::text
             UNION
             SELECT e.src_id FROM graph_edges e JOIN up ON e.dst_id = up.id
              WHERE e.edge_type = 'prerequisite_of' AND e.system_to IS NULL)
           SELECT id FROM up""",
        (lo,),
    )
    return {r[0] for r in cur.fetchall()}


# ==========================================================================
# REACHABILITY (FR-1207) — the app's rules, ported
#
# app/src/lib/widget-payloads.ts `parseMathWidget` is the authority: it is what
# refuses a stored widget at render time. A widget it refuses renders nothing,
# so a template the pipeline accepts and the app refuses is a question the
# student can never see. This port runs at generation time, before load;
# tests/test_widget_templates.py cross-checks it against the TypeScript on a
# fixture set whenever node is on the machine, so the two cannot drift quietly.
# One rule is STRICTER here than in the app, and says so: a sample_space event
# with no outcome in it (every answer would be "select nothing").
# ==========================================================================

CIRCLE_ELEMENTS = ("radius", "chord", "diameter", "tangent")
BAR_STATS = ("mean", "median", "mode", "range")
RULE_KINDS = ("sum", "diff", "product", "same", "first", "second")
RULE_OPS = ("eq", "ne", "lt", "le", "gt", "ge")
CURVE_FNS = ("linear", "quadratic")

# What each instrument can express, in words — for the author and for the blind
# reachability verifier (widgets.workflow.js). Same facts as the rules below.
INSTRUMENTS = {
    "pair_plotter": "A lattice grid from -5 to 5 on both axes; the student places ONE point. The target "
                    "must be a whole-number pair within ±5.",
    "product_builder": "Two sets X and Y of at most 4 numbers each, drawn as a grid of pairs; the student "
                       "taps the pairs of X×Y.",
    "line_drawer": "Two handles on lattice points from -5 to 5; the line through them is the answer. Mode "
                   "'equation' (y = mx + b): b a whole number within ±5, m a whole number or the reciprocal "
                   "of one, |m| ≤ 5. Mode 'points': the line through two given distinct lattice points "
                   "within ±5. Any two points on the right line are correct.",
    "circle_builder": "A circle of radius 5 centred at the origin on a lattice; the student constructs a "
                      "radius, chord, diameter or tangent. Graded by the property, so every valid "
                      "construction is correct.",
    "angle_setter": "Points A, B, C on a circle; handles snap to 5°. ask 'central' targets 10–350°, "
                    "'inscribed' 5–175°; the target must be a multiple of 5.",
    "triangle_ratio": "A right triangle whose legs the student drags; ask sin, cos or tan of θ. sin and cos "
                      "targets are strictly between 0 and 1; tan targets are > 0 and ≤ 12.",
    "bar_builder": "n bars (3 ≤ n ≤ 8), each a value from 0 to 10; ask mean, median, mode or range of the "
                   "set. The target is between 0 and 10; mode and range targets are whole numbers.",
    "number_line_marker": "A number line whose range is two whole numbers within ±20, at most 24 wide. Mode "
                          "'points': the student marks 1–4 whole-number values inside the range. Mode "
                          "'interval': whole-number endpoints inside the range, each open or closed.",
    "ratio_balance": "A beam with a : b = c : ? (direct) or a·b = c·? (inverse); the pan holds a whole "
                     "number 1–24, so the fourth term must be one.",
    "sample_space": "A rows × cols grid of outcomes (2–8 each, e.g. two dice); the student taps every "
                    "outcome in the event described by a rule on the two values (sum, diff, product, same, "
                    "first, second; eq, ne, lt, le, gt, ge).",
    "curve_sketcher": "Freehand sketch of y = mx + c (fn 'linear', coefs [m, c]) or y = ax² + bx + c (fn "
                      "'quadratic', coefs [a, b, c], a ≠ 0); every coefficient within ±10.",
}


def _isnum(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) != float("inf")


def _isint(v) -> bool:
    return _isnum(v) and float(v).is_integer()


def _intpair(v, lim) -> list | None:
    if not isinstance(v, list) or len(v) != 2:
        return None
    a, b = v
    if not _isint(a) or not _isint(b) or abs(a) > lim or abs(b) > lim:
        return None
    return [a, b]


def reachability(kind: str, spec: dict) -> list[str]:
    """Why the app would refuse this (kind, spec), or [] if it renders and can be answered."""
    s = spec if isinstance(spec, dict) else {}
    if kind == "pair_plotter":
        return [] if _intpair(s.get("target"), 5) else ["target must be a whole-number pair within ±5"]
    if kind == "product_builder":
        X, Y = s.get("X"), s.get("Y")
        if not isinstance(X, list) or not isinstance(Y, list) or not X or not Y:
            return ["X and Y must be non-empty lists"]
        if not all(_isnum(v) for v in X + Y):
            return ["X and Y hold numbers only"]
        return ["at most 4 elements in X and in Y"] if len(X) > 4 or len(Y) > 4 else []
    if kind == "line_drawer":
        mode = s.get("mode")
        if mode == "points":
            t = s.get("through")
            if not isinstance(t, list) or len(t) != 2:
                return ["through must be two points"]
            a, b = _intpair(t[0], 5), _intpair(t[1], 5)
            if not a or not b:
                return ["both points must be lattice points within ±5"]
            return ["the two points coincide"] if a == b else []
        if mode != "equation":
            return ["mode must be 'equation' or 'points'"]
        m, b = s.get("m"), s.get("b")
        if not _isnum(m) or not _isnum(b):
            return ["m and b must be numbers"]
        if not _isint(b) or abs(b) > 5:
            return ["b must be a whole number within ±5 (the handles sit on lattice points)"]
        inv_ok = m != 0 and _isint(1 / m)
        if not _isint(m) and not inv_ok:
            return ["m must be a whole number or the reciprocal of one"]
        return ["|m| must be at most 5"] if abs(m) > 5 else []
    if kind == "circle_builder":
        return [] if s.get("element") in CIRCLE_ELEMENTS else [f"element must be one of {CIRCLE_ELEMENTS}"]
    if kind == "angle_setter":
        ask, target = s.get("ask"), s.get("target")
        if ask not in ("central", "inscribed") or not _isnum(target):
            return ["ask must be central|inscribed and target a number"]
        if target % 5 != 0:
            return ["target must be a multiple of 5° (the handles snap to 5°)"]
        if ask == "central" and not 10 <= target <= 350:
            return ["a central target is 10–350°"]
        if ask == "inscribed" and not 5 <= target <= 175:
            return ["an inscribed target is 5–175°"]
        return []
    if kind == "triangle_ratio":
        ask, target = s.get("ask"), s.get("target")
        if ask not in ("sin", "cos", "tan") or not _isnum(target) or target <= 0:
            return ["ask must be sin|cos|tan and target a positive number"]
        if ask in ("sin", "cos") and target >= 1:
            return [f"{ask} of an angle in a right triangle is below 1"]
        return ["a tan target is at most 12"] if ask == "tan" and target > 12 else []
    if kind == "bar_builder":
        ask, target = s.get("ask"), s.get("target")
        if ask not in BAR_STATS or not _isnum(target):
            return [f"ask must be one of {BAR_STATS} and target a number"]
        n = s.get("n") if _isint(s.get("n")) else 5
        if not 3 <= n <= 8:
            return ["n must be 3–8"]
        if not 0 <= target <= 10:
            return ["the bars run 0–10, so the target must too"]
        return ["a mode or range target is a whole number"] if ask in ("mode", "range") and not _isint(target) else []
    if kind == "number_line_marker":
        mode, rng = s.get("mode"), _intpair(s.get("range"), 20)
        if mode not in ("points", "interval") or not rng or rng[0] >= rng[1]:
            return ["mode must be points|interval and range two increasing whole numbers within ±20"]
        if rng[1] - rng[0] > 24:
            return ["the range is at most 24 wide"]
        if mode == "points":
            ts = s.get("targets")
            if not isinstance(ts, list):
                return ["targets must be a list"]
            ok = [t for t in ts if _isint(t) and rng[0] <= t <= rng[1]]
            if len(ok) != len(ts):
                return ["every target is a whole number inside the range"]
            return ["1–4 targets"] if not 1 <= len(ts) <= 4 else []
        f, t = s.get("from"), s.get("to")
        if not _isint(f) or not _isint(t) or f > t:
            return ["from and to are whole numbers with from ≤ to"]
        return ["the interval must lie inside the range"] if f < rng[0] or t > rng[1] else []
    if kind == "ratio_balance":
        mode, a, b, c = s.get("mode"), s.get("a"), s.get("b"), s.get("c")
        if mode not in ("direct", "inverse") or not all(_isnum(v) for v in (a, b, c)):
            return ["mode must be direct|inverse and a, b, c numbers"]
        if a <= 0 or b <= 0 or c <= 0:
            return ["a, b and c are positive"]
        ans = (b * c) / a if mode == "direct" else (a * b) / c
        return [] if float(ans).is_integer() and 1 <= ans <= 24 else [
            f"the fourth term is {ans:g}; the pan holds a whole number 1–24"]
    if kind == "sample_space":
        rule = s.get("rule")
        if not isinstance(rule, dict):
            return ["rule must be an object"]
        rk = rule.get("kind")
        op = "eq" if rule.get("op") is None else rule.get("op")
        if rk not in RULE_KINDS or op not in RULE_OPS:
            return [f"rule.kind in {RULE_KINDS}, rule.op in {RULE_OPS}"]
        value = 0 if rule.get("value") is None else rule.get("value")
        if rk != "same" and not _isnum(value):
            return ["rule.value must be a number"]
        rows = s.get("rows") if _isint(s.get("rows")) else 6
        cols = s.get("cols") if _isint(s.get("cols")) else 6
        if not (2 <= rows <= 8 and 2 <= cols <= 8):
            return ["rows and cols are 2–8"]
        if not _event_outcomes(int(rows), int(cols), rk, op, value):
            return ["the event holds no outcome (pipeline rule, stricter than the app)"]
        return []
    if kind == "curve_sketcher":
        fn, coefs = s.get("fn"), s.get("coefs")
        want = 2 if fn == "linear" else 3
        if fn not in CURVE_FNS or not isinstance(coefs, list) or len(coefs) != want \
                or not all(_isnum(k) for k in coefs):
            return ["fn linear (2 coefs) or quadratic (3 coefs), all numbers"]
        if fn == "quadratic" and coefs[0] == 0:
            return ["a quadratic needs a ≠ 0"]
        return ["every coefficient is within ±10"] if any(abs(k) > 10 for k in coefs) else []
    return [f"unknown widget kind {kind!r}"]


def _event_outcomes(rows: int, cols: int, kind: str, op: str, value) -> int:
    return sum(1 for _ in _event_cells(rows, cols, {"kind": kind, "op": op, "value": value}))


# ==========================================================================
# THE GRAPH — the checks that need the curriculum (FR-1215, parents, coverage)
# ==========================================================================


class PgGraph:
    """The curriculum graph and catalogue as a scratch database holds them (S10)."""

    def __init__(self, dsn: str):
        import psycopg
        self.conn = psycopg.connect(dsn)
        self._closures: dict[str, set[str]] = {}

    def _rows(self, sql: str, params=()):
        with self.conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()

    def misconceptions(self) -> dict[str, dict]:
        return {i: {"lo_id": lo, "label": lab, "description": d}
                for i, lo, lab, d in self._rows("SELECT id, lo_id, label, description FROM misconceptions")}

    def objectives(self) -> dict[str, dict]:
        return {i: {"label": lab, "description": d} for i, lab, d in self._rows(
            "SELECT id, label, description FROM graph_nodes WHERE kind = 'learning_objective'")}

    def closure(self, lo: str) -> set[str]:
        if lo not in self._closures:
            with self.conn.cursor() as cur:
                self._closures[lo] = prerequisite_closure(cur, lo)
        return self._closures[lo]

    def questions(self) -> dict[str, dict]:
        return {i: {"lo_id": lo, "source": src, "stem": stem, "type": t, "answer": ans}
                for i, lo, src, stem, t, ans in self._rows(
                    "SELECT id, lo_id, source, stem, question_type, correct_answer FROM questions")}

    def modules(self, course: str) -> list[dict]:
        return [{"id": i, "label": lab, "order": o} for i, lab, o in self._rows(
            """SELECT n.id, n.label, n.order_in_parent FROM graph_edges e
                 JOIN graph_nodes n ON n.id = e.src_id
                WHERE e.edge_type = 'part_of' AND e.dst_id = %s AND n.kind = 'module'
                  AND e.system_to IS NULL ORDER BY n.order_in_parent, n.id""", (course,))]

    def module_of(self) -> dict[str, str]:
        return dict(self._rows(
            """SELECT dst_id, src_id FROM graph_edges
                WHERE edge_type = 'teaches' AND system_to IS NULL AND src_id LIKE 'module:%%'"""))


class FixtureGraph:
    """The same interface over a dict (tests, and dry runs on a fixture course)."""

    def __init__(self, data: dict):
        self.d = data

    def misconceptions(self):
        return self.d.get("misconceptions", {})

    def objectives(self):
        return self.d.get("objectives", {})

    def closure(self, lo):
        up, todo = {lo}, [lo]
        while todo:
            x = todo.pop()
            for src, dst in self.d.get("prerequisites", []):
                if dst == x and src not in up:
                    up.add(src)
                    todo.append(src)
        return up

    def questions(self):
        return self.d.get("questions", {})

    def modules(self, course):
        return self.d.get("modules", [])

    def module_of(self):
        return self.d.get("module_of", {})


# ==========================================================================
# JSON TEMPLATES (--templates; S7, pipeline spec §3.10, B13)
#
#   {"format": "ainext.widget-template/1",
#    "id": "wt:<lo tail>:<slug>", "lo_id": "lo:…", "parent_question_id": "q:<lo tail>:…",
#    "tier": "standard", "kind": "line_drawer",
#    "instances": [{"m": 2, "b": -1}, …],          # optional: one question per row
#    "spec": {"mode": "equation", "m": "{=m}", "b": "{=b}"},
#    "stem": "Draw the line $y = {=linear(m, b)}$.",
#    "solution": ["…", …],
#    "diagnostics": [{"predicate": "slope-inverted", "misconception_id": "mc:…"}, …],
#    "notes": "…"}
#
# A spec value that is exactly one hole ("{=m}") keeps its type; any other
# string is rendered as text. Holes use the family evaluator (families/), so no
# model-written code runs here either. Diagnostics are listed likeliest first.
# ==========================================================================

TEMPLATE_KEYS = {"format", "id", "lo_id", "parent_question_id", "tier", "kind", "instances", "spec",
                 "stem", "solution", "diagnostics", "notes", "source_page"}


def _render_value(v, env):
    from families import evaluator as FE
    if isinstance(v, str):
        hs = FE.holes(v)
        if len(hs) == 1 and v.strip() == "{=" + hs[0] + "}":
            val = FE.evaluate(hs[0], env)
            return int(val) if isinstance(val, Fraction) and val.denominator == 1 else \
                float(val) if isinstance(val, Fraction) else val
        return FE.render(v, env) if hs else v
    if isinstance(v, list):
        return [_render_value(x, env) for x in v]
    if isinstance(v, dict):
        return {k: _render_value(x, env) for k, x in v.items()}
    return v


def check_template(raw: dict) -> list[str]:
    import re
    from families import WIDGET_FORMAT
    from families import evaluator as FE
    p = []
    if not isinstance(raw, dict):
        return ["a template is a JSON object"]
    unknown = set(raw) - TEMPLATE_KEYS
    if unknown:
        p.append(f"unknown key(s) {sorted(unknown)}")
    if raw.get("format") != WIDGET_FORMAT:
        p.append(f"format must be {WIDGET_FORMAT!r}")
    lo = re.match(r"^lo:([a-z0-9-]+)$", str(raw.get("lo_id", "")))
    tail = lo.group(1) if lo else None
    if not lo:
        p.append("lo_id must look like lo:<objective>")
    m = re.match(r"^wt:([a-z0-9-]+):[a-z0-9][a-z0-9-]*$", str(raw.get("id", "")))
    if not m or (tail and m.group(1) != tail):
        p.append("id must be wt:<objective tail>:<slug>, naming its own objective")
    q = re.match(r"^q:([a-z0-9-]+):[A-Za-z0-9._-]+$", str(raw.get("parent_question_id") or ""))
    if not q or (tail and q.group(1) != tail):
        p.append("parent_question_id is required: the objective's anchor book question (FR-1101, §3.10)")
    if raw.get("tier") not in ("basic", "standard", "advanced"):
        p.append("tier must be basic|standard|advanced")
    if raw.get("kind") not in W.contract()["kinds"]:
        p.append(f"kind {raw.get('kind')!r} is not in contracts/widget-predicates.json — record a widget "
                 "GAP instead; a new kind is built only after Samuel approves it (decision 11)")
    inst = raw.get("instances", [{}])
    if not isinstance(inst, list) or not inst or not all(isinstance(r, dict) for r in inst):
        p.append("instances, when present, is a non-empty list of parameter objects")
    if not isinstance(raw.get("spec"), dict):
        p.append("spec must be an object")
    for key in ("stem",):
        if not isinstance(raw.get(key), str) or not raw[key].strip():
            p.append("stem must be a non-empty template")
    if not isinstance(raw.get("solution"), list) or not raw["solution"]:
        p.append("solution must be a non-empty list of step templates")
    ds = raw.get("diagnostics")
    if not isinstance(ds, list) or not ds:
        p.append("diagnostics must map at least one predicate to a misconception (ADR-0009)")
    else:
        for d in ds:
            if not isinstance(d, dict) or set(d) != {"predicate", "misconception_id"}:
                p.append("each diagnostic is {predicate, misconception_id}")
            elif not re.match(r"^mc:[a-z0-9-]+:[a-z0-9][a-z0-9-]*$", str(d["misconception_id"])):
                p.append(f"misconception id {d['misconception_id']!r} must look like mc:<objective tail>:<slug>")
    # every hole parses before anything renders
    texts = [raw.get("stem")] + list(raw.get("solution") or [])
    for tpl in texts:
        if isinstance(tpl, str):
            try:
                for src in FE.holes(tpl):
                    FE.parse(src)
            except FE.EvalError as e:
                p.append(str(e))
    return p


def load_templates(directory: Path) -> tuple[list[dict], list[str]]:
    import hashlib
    out, problems, seen = [], [], set()
    for path in sorted(Path(directory).glob("*.json")):
        if path.name.startswith("_"):
            continue
        try:
            raw = json.loads(path.read_text())
        except json.JSONDecodeError as e:
            problems.append(f"{path.name}: not JSON ({e})")
            continue
        ps = check_template(raw)
        if ps:
            problems += [f"{path.name}: {x}" for x in ps]
            continue
        if raw["id"] in seen:
            problems.append(f"{path.name}: template {raw['id']} defined twice")
            continue
        seen.add(raw["id"])
        raw = dict(raw)
        raw["_sha"] = hashlib.sha256(json.dumps({k: v for k, v in raw.items() if k != "_sha"}, sort_keys=True,
                                                ensure_ascii=False).encode()).hexdigest()
        out.append(raw)
    return out, problems


def build_from_templates(templates: list[dict]) -> tuple[list[dict], list[str]]:
    """Render every instance of every template into a widget question row."""
    from families import evaluator as FE
    questions, problems = [], []
    per_lo: dict[str, int] = {}
    for tpl in sorted(templates, key=lambda t: (t["lo_id"], t["id"])):
        tail = tpl["lo_id"].removeprefix("lo:")
        for i, env in enumerate(tpl.get("instances") or [{}]):
            try:
                spec = _render_value(tpl["spec"], env)
                stem = FE.render(tpl["stem"], env)
                steps = [{"step": n, "text_md": FE.render(s, env)} for n, s in enumerate(tpl["solution"], 1)]
            except FE.EvalError as e:
                problems.append(f"{tpl['id']} instance {i}: {e}")
                continue
            per_lo[tail] = per_lo.get(tail, 0) + 1
            q = {
                "id": f"q:{tail}:w{per_lo[tail]:03d}",
                "lo_id": tpl["lo_id"],
                "tier": tpl["tier"],
                "question_type": "widget",
                "stem": stem,
                "choices": W.widget_choices(tpl["kind"], spec,
                                            [(d["predicate"], d["misconception_id"]) for d in tpl["diagnostics"]]),
                "correct_answer": W.OK,
                "canonical_solution": steps,
                "parent_question_id": tpl["parent_question_id"],
                "source_note": f"Generated from template family {tpl['id']}.",
                "family": tpl["id"],
                "template_sha": tpl["_sha"],
            }
            if tpl.get("source_page") is not None:
                q["source_page"] = tpl["source_page"]
            questions.append(q)
    return questions, problems


def check_questions(questions: list[dict], graph, pre_catalogue: bool = False) -> tuple[list[str], list[str]]:
    """Every mandatory S7 check. Returns (problems, dropped-diagnostic notes).

    ``pre_catalogue``: S7 runs before S5's final catalogue exists (§3.2), so a
    predicate may name an id S5 has not written. The prerequisite rule still
    holds — the objective is read from the id itself (``mc:<lo tail>:…``) — and
    nothing is dropped; the caller refuses to write a bundle in this phase.
    """
    problems, notes = [], []
    mcs = graph.misconceptions() if graph else None
    los = graph.objectives() if graph else None
    qs = graph.questions() if graph else None
    for q in questions:
        problems += W.validate_widget(q)
        problems += [f"{q['id']}: unreachable — {r}" for r in reachability(q["choices"]["kind"], q["choices"]["spec"])]
        if not q.get("parent_question_id"):
            problems.append(f"{q['id']}: no parent_question_id")
        if graph is None:
            continue
        if q["lo_id"] not in los:
            problems.append(f"{q['id']}: lo_id {q['lo_id']} is not in the graph")
            continue
        parent = qs.get(q.get("parent_question_id"))
        if parent is None:
            problems.append(f"{q['id']}: parent {q.get('parent_question_id')} is not a question in the database")
        elif parent["lo_id"] != q["lo_id"]:
            problems.append(f"{q['id']}: parent {q['parent_question_id']} is on {parent['lo_id']}, not {q['lo_id']}")
        allowed = graph.closure(q["lo_id"])
        kept = []
        for d in q["choices"]["diagnostics"]:
            mid = d["misconception_id"]
            if pre_catalogue and mid not in mcs:
                owner = "lo:" + mid.split(":")[1]
                if owner not in allowed:
                    problems.append(f"{q['id']}: names {mid!r} on {owner}, which is neither this question's "
                                    "objective nor a prerequisite of it (FR-1215)")
                kept.append(d)
                continue
            if mid not in mcs:
                # §3.8: a predicate whose misconception S5 dropped loses its mapping
                # rather than pointing at nothing (FR-1112).
                notes.append(f"{q['id']}: {d['predicate']} → {mid} is not in the catalogue — diagnostic dropped")
                continue
            if mcs[mid]["lo_id"] not in allowed:
                problems.append(f"{q['id']}: names {mid!r} on {mcs[mid]['lo_id']}, which is neither this "
                                "question's objective nor a prerequisite of it (FR-1215)")
            kept.append(d)
        q["choices"]["diagnostics"] = kept
        if not kept:
            problems.append(f"{q['id']}: no diagnostic left — a widget that cannot say why is not shipped")
    return problems, notes


# What the blind verifier must read OUT OF THE STEM, per kind, without seeing the
# spec. Comparing that reading with the stored spec is the widget's "blind answer
# agrees with the key": it catches a spec that disagrees with its own question —
# the class of defect in the Prep-3 widgets q:t2u2-2-1:w001–w003 until v0.9.3
# (migration 032), whose targets were the negatives of the values their stems and
# solutions exclude.
READING_FIELDS = {
    "pair_plotter": {"target": "[x, y], the point the question asks for"},
    "product_builder": {"X": "the set X as a list", "Y": "the set Y as a list"},
    "line_drawer": {"mode": "'equation' or 'points'", "m": "gradient (equation mode)", "b": "y-intercept "
                    "(equation mode)", "through": "[[x1, y1], [x2, y2]] (points mode)"},
    "circle_builder": {"element": "radius | chord | diameter | tangent"},
    "angle_setter": {"ask": "'central' or 'inscribed' — which angle the target is", "target": "degrees"},
    "triangle_ratio": {"ask": "sin | cos | tan", "target": "the ratio's value"},
    "bar_builder": {"ask": "mean | median | mode | range", "target": "the value", "n": "how many values"},
    "number_line_marker": {"mode": "'points' or 'interval'", "targets": "every value to mark (points mode)",
                           "from": "left end (interval)", "to": "right end (interval)",
                           "openFrom": "true if the left end is excluded", "openTo": "true if the right end is excluded"},
    "ratio_balance": {"mode": "'direct' or 'inverse'", "a": "first term", "b": "second term", "c": "third term"},
    "sample_space": {"rows": "outcomes of the first trial", "cols": "outcomes of the second",
                     "event": "every outcome in the event as [first, second] pairs"},
    "curve_sketcher": {"fn": "'linear' or 'quadratic'", "coefs": "[m, c] or [a, b, c]"},
}


def _near(a, b) -> bool:
    return _isnum(a) and _isnum(b) and abs(float(a) - float(b)) <= 1e-9


def reading_agrees(kind: str, spec: dict, reading: dict) -> tuple[bool, str]:
    """Does the blind verifier's reading of the stem say what the stored spec says?"""
    if not isinstance(reading, dict):
        return False, "no reading of the stem"
    r, s = reading, spec
    try:
        if kind == "pair_plotter":
            ok = len(r["target"]) == 2 and all(_near(x, y) for x, y in zip(r["target"], s["target"]))
        elif kind == "product_builder":
            ok = sorted(r["X"]) == sorted(s["X"]) and sorted(r["Y"]) == sorted(s["Y"])
        elif kind == "line_drawer":
            if s["mode"] == "equation":
                ok = r.get("mode") == "equation" and _near(r["m"], s["m"]) and _near(r["b"], s["b"])
            else:
                ok = r.get("mode") == "points" and sorted(map(tuple, r["through"])) == sorted(map(tuple, s["through"]))
        elif kind == "circle_builder":
            ok = r["element"] == s["element"]
        elif kind in ("angle_setter", "triangle_ratio"):
            ok = r["ask"] == s["ask"] and _near(r["target"], s["target"])
        elif kind == "bar_builder":
            ok = r["ask"] == s["ask"] and _near(r["target"], s["target"]) and \
                int(r.get("n", 5)) == int(s.get("n", 5))
        elif kind == "number_line_marker":
            if s["mode"] == "points":
                ok = r.get("mode") == "points" and sorted(float(x) for x in r["targets"]) == \
                    sorted(float(x) for x in s["targets"])
            else:
                ok = r.get("mode") == "interval" and _near(r["from"], s["from"]) and _near(r["to"], s["to"]) \
                    and bool(r.get("openFrom")) == bool(s.get("openFrom")) \
                    and bool(r.get("openTo")) == bool(s.get("openTo"))
        elif kind == "ratio_balance":
            ok = r["mode"] == s["mode"] and all(_near(r[k], s[k]) for k in "abc")
        elif kind == "sample_space":
            rows = int(s.get("rows", 6)) if _isint(s.get("rows")) else 6
            cols = int(s.get("cols", 6)) if _isint(s.get("cols")) else 6
            rule = s["rule"]
            want = set(_event_cells(rows, cols, rule))
            got = {tuple(int(v) for v in c) for c in r["event"]}
            ok = int(r.get("rows", rows)) == rows and int(r.get("cols", cols)) == cols and got == want
        elif kind == "curve_sketcher":
            ok = r["fn"] == s["fn"] and len(r["coefs"]) == len(s["coefs"]) and \
                all(_near(x, y) for x, y in zip(r["coefs"], s["coefs"]))
        else:
            return False, f"no reading rule for kind {kind!r}"
    except (KeyError, TypeError, ValueError) as e:
        return False, f"reading incomplete ({e})"
    shown = {k: v for k, v in r.items() if k in READING_FIELDS.get(kind, {})}
    return ok, ("" if ok else f"the stem reads as {json.dumps(shown)}; the spec stores {json.dumps(s)}")


def _event_cells(rows: int, cols: int, rule: dict):
    kind, op = rule.get("kind"), rule.get("op") or "eq"
    value = 0 if rule.get("value") is None else rule.get("value")
    cmp = {"eq": lambda x: x == value, "ne": lambda x: x != value, "lt": lambda x: x < value,
           "le": lambda x: x <= value, "gt": lambda x: x > value, "ge": lambda x: x >= value}[op]
    for a in range(1, rows + 1):
        for b in range(1, cols + 1):
            if kind == "same":
                hit = a == b
            else:
                hit = cmp({"sum": a + b, "diff": abs(a - b), "product": a * b, "first": a, "second": b}[kind])
            if hit:
                yield (a, b)


def apply_verdicts(templates: list[dict], questions: list[dict], files: list[Path]) -> tuple[set, dict]:
    """The blind reachability verifier's verdicts (widgets.workflow.js, mode verify). Fail closed."""
    got: dict[str, list] = {}
    for f in files:
        for r in json.loads(Path(f).read_text()).get("results", []):
            got.setdefault(r.get("question_id"), []).append(r)
    accepted, rejected = set(), {}
    for tpl in templates:
        reasons = []
        mine = [q for q in questions if q["family"] == tpl["id"]]
        for q in mine:
            rs = [r for r in got.get(q["id"], []) if r.get("template_sha") == tpl["_sha"]]
            if not rs:
                reasons.append(f"{q['id']}: not verified")
                continue
            for r in rs:
                if r.get("reachable") is not True:
                    reasons.append(f"{q['id']}: verifier could not reach the target — {r.get('construction')}")
                agrees, why = reading_agrees(q["choices"]["kind"], q["choices"]["spec"], r.get("reading"))
                if not agrees:
                    reasons.append(f"{q['id']}: blind reading disagrees with the spec — {why}")
                preds = {p.get("predicate"): p for p in r.get("predicates", [])}
                for d in q["choices"]["diagnostics"]:
                    v = preds.get(d["predicate"])
                    if not v or v.get("matches") is not True:
                        reasons.append(f"{q['id']}: {d['predicate']} → {d['misconception_id']} not confirmed"
                                       + (f" ({v.get('why')})" if v else ""))
        if reasons or not mine:
            rejected[tpl["id"]] = reasons or ["no instances"]
        else:
            accepted.add(tpl["id"])
    return accepted, rejected


def _gap_key(g: dict) -> tuple:
    return (g.get("module"), g.get("lo_id"), g.get("need_kind"))


def gap_report(book: str, course: str, graph, questions: list[dict], gap_files: list[Path],
               previous: dict | None = None) -> dict:
    """coverage/<book>.widget-gaps.json: every chapter, its widgets, and every gap (FR-4306).

    The shape coverage_report.py reads (S8, check `module_widgets`): a flat `gaps` list,
    each entry naming its `module` and carrying `signed_off` — null until a human signs
    it as {"by": …, "at": …, "note": …}. A chapter counts as covered by a gap only when a
    CHAPTER-scope gap on it is signed (coverage_report.py, integration backlog 1). Signing a
    chapter gap accepts the chapter without a widget for now; signing a lesson gap only
    accepts that lesson's missing kind;
    approving a NEW KIND is a separate decision, recorded in specs/003 decisions.md (T356).

    A re-run never loses a signature: a signed gap from `previous` is carried onto the
    matching new gap (same module, objective and kind) or kept as it was. An uncovered
    chapter that no author examined gets a gap of its own, so it cannot pass unseen.
    """
    module_of = graph.module_of()
    gaps: list[dict] = []
    for f in gap_files:
        for g in json.loads(Path(f).read_text()).get("gaps", []):
            gaps.append({"module": module_of.get(g.get("lo_id")) or g.get("module"),
                         "lo_id": g.get("lo_id"), "need_kind": g.get("need_kind") or "unspecified",
                         "description": g.get("description", ""), "why": g.get("why", ""),
                         "source": Path(f).name, "signed_off": None})
    modules = graph.modules(course)
    chapters, uncovered = [], []
    for m in modules:
        ws = [q for q in questions if module_of.get(q["lo_id"]) == m["id"]]
        if not ws:
            uncovered.append(m["id"])
            if not any(g["module"] == m["id"] for g in gaps):
                gaps.append({"module": m["id"], "lo_id": None, "need_kind": "unexamined", "description": "",
                             "why": "no widget question, and no author recorded a gap for this chapter",
                             "source": "generate_widget_questions.py", "signed_off": None})
        chapters.append({"module": m["id"], "label": m["label"], "status": "covered" if ws else "gap",
                         "widgets": len(ws), "kinds": sorted({q["choices"]["kind"] for q in ws}),
                         "objectives_with_widgets": sorted({q["lo_id"] for q in ws}),
                         "gaps": sum(1 for g in gaps if g["module"] == m["id"])})
    for g in gaps:
        # coverage_report.py counts a chapter as covered only by a signed gap of scope "chapter":
        # signing a "lesson" gap accepts a missing kind for some lessons, never a chapter with no
        # widget question.
        g["scope"] = "chapter" if g["module"] in uncovered else "lesson"
    signed = {_gap_key(g): g for g in (previous or {}).get("gaps", []) if (g.get("signed_off") or {}).get("by")}
    for g in gaps:
        if _gap_key(g) in signed:
            g["signed_off"] = signed.pop(_gap_key(g))["signed_off"]
    for g in signed.values():  # a human's signature is never dropped by a re-run
        gaps.append(dict(g, carried=True))
    proposed: dict[str, dict] = {}
    for g in gaps:
        if g["need_kind"] in ("unexamined", "none", "unspecified"):
            continue
        rec = proposed.setdefault(g["need_kind"], {"modules": [], "objectives": [], "why": []})
        if g["module"] not in rec["modules"]:
            rec["modules"].append(g["module"])
        if g.get("lo_id"):
            rec["objectives"].append(g["lo_id"])
        if g.get("why"):
            rec["why"].append(g["why"])
    return {
        "format": "ainext.widget-gaps/1", "book": book, "course_id": course,
        "rule": "FR-4306 / FR-1201: every chapter has at least one widget question, or a gap a human has "
                "signed. A new kind is built only after Samuel approves it (decision 11, T356).",
        "chapters": chapters, "uncovered_chapters": uncovered, "proposed_kinds": proposed, "gaps": gaps,
    }


def author_args(book, graph, course: str) -> dict:
    """args for widgets.workflow.js (mode author): objectives, anchors, reachable misconceptions, the contract."""
    import book_config
    mcs = graph.misconceptions()
    qs = graph.questions()
    module_of = graph.module_of()
    mods = {m["id"]: m for m in graph.modules(course)}
    objs = []
    for lo, rec in sorted(graph.objectives().items()):
        if module_of.get(lo) not in mods:
            continue
        closure = graph.closure(lo)
        anchors = [{"id": i, "stem": q["stem"], "type": q["type"], "answer": q["answer"]}
                   for i, q in sorted(qs.items()) if q["lo_id"] == lo and q.get("source") == "seed"][:6]
        objs.append({"lo_id": lo, "label": rec["label"], "description": rec["description"],
                     "module": module_of[lo], "module_label": mods[module_of[lo]]["label"],
                     "anchor_questions": anchors,
                     "misconceptions": [{"id": i, "lo_id": m["lo_id"], "label": m["label"],
                                         "description": m["description"], "own": m["lo_id"] == lo}
                                        for i, m in sorted(mcs.items()) if m["lo_id"] in closure]})
    contract = {k: {"predicates": v["predicates"], "instrument": INSTRUMENTS.get(k, "")}
                for k, v in W.contract()["kinds"].items()}
    return book_config.workflow_args(book, extra={"mode": "author", "course_id": course,
                                                  "contract": contract, "objectives": objs})


def verify_args(book, graph, questions: list[dict]) -> dict:
    """args for widgets.workflow.js (mode verify): the stem and the instrument, never the solution."""
    import book_config
    mcs = graph.misconceptions() if graph else {}
    items = []
    for q in questions:
        kind = q["choices"]["kind"]
        preds = W.contract()["kinds"][kind]["predicates"]
        items.append({
            "question_id": q["id"], "template_id": q["family"], "template_sha": q["template_sha"],
            "lo_id": q["lo_id"], "kind": kind, "spec": q["choices"]["spec"], "stem": q["stem"],
            "instrument": INSTRUMENTS.get(kind, ""),
            "reading_fields": READING_FIELDS.get(kind, {}),
            "diagnostics": [{"predicate": d["predicate"], "predicate_meaning": preds.get(d["predicate"]),
                             "misconception_id": d["misconception_id"],
                             "misconception_label": (mcs.get(d["misconception_id"]) or {}).get("label"),
                             "misconception_description": (mcs.get(d["misconception_id"]) or {}).get("description")}
                            for d in q["choices"]["diagnostics"]],
        })
    return book_config.workflow_args(book, extra={"mode": "verify", "widgets": items}) if book else \
        {"mode": "verify", "widgets": items}


# ---- packet by reference (packet_ref.py) ---------------------------------
# `--author-args A --by-ref [DIR]` and `--verify-args V --by-ref [DIR]`: the big blocks of
# widgets.workflow.js's prompts go to shard files, rendered as the workflow renders them, and the
# args keep what its control flow reads. tests/test_packet_ref.py splices them back and compares.
#   author  contract.txt            JSON.stringify(contract, null, 1)            every lesson's author
#           lessons/<lesson>.txt    JSON.stringify(the lesson's objectives, null, 1)   that lesson's author
#           WHOLE by reference (decision of 2026-09-26, Q2): inline clips them at 9000 and 14000
#           characters, which cuts the contract's last kinds (venn_builder, area_model) off the prompt
#   verify  t/t001.txt …            the widgets section of one template: what the student gets (stem,
#                                   instrument, reading fields) and the claimed diagnoses — never the
#                                   stored spec, the solution or the question id (the BLIND verifier)
def _lesson_of(lo: str) -> str:
    import re
    return re.sub(r"-[0-9]+$", "", lo.removeprefix("lo:"))


def author_args_by_ref(args: dict, directory: Path) -> dict:
    import packet_ref
    shards = packet_ref.Shards(directory, "S7 author")
    shards.put("contract.txt", packet_ref.js_json(args["contract"], 1))
    lessons: dict[str, list] = {}
    for o in args["objectives"]:
        lessons.setdefault(_lesson_of(o["lo_id"]), []).append(o)
    refs = []
    for lesson, objs in lessons.items():
        shards.put(f"lessons/{lesson}.txt", packet_ref.js_json(objs, 1))
        refs.append({"lesson": lesson, "module": objs[0].get("module"), "module_label": objs[0].get("module_label"),
                     "lo_ids": [o["lo_id"] for o in objs]})
    out = {k: v for k, v in args.items() if k not in ("objectives", "contract", "book")}
    out["book"] = {k: args["book"].get(k) for k in ("book", "title") if k in args["book"]}
    out["by_ref"] = shards.finish({"book": args["book"]["book"], "mode": "author"})
    out["contract_kinds"] = {k: list((v.get("predicates") or {}).keys()) for k, v in args["contract"].items()}
    out["lesson_refs"] = refs
    return out


def _js_verify_section(ws: list[dict]) -> str:
    """widgets.workflow.js's verifyPrompt widget blocks for one template."""
    from packet_ref import js, js_json, js_or
    out = []
    for i, w in enumerate(ws, start=1):
        diag = "\n".join(f"  - {js(d.get('predicate'))} (\"{js(d.get('predicate_meaning'))}\") → {js(d.get('misconception_id'))}: "
                         f"{js(js_or(d.get('misconception_label'), '?'))} — {js(js_or(d.get('misconception_description'), ''))}"
                         for d in w["diagnostics"])
        out.append(f"WIDGET W{i} (kind {js(w.get('kind'))})\nQuestion: {js(w.get('stem'))}\nInstrument: {js(w.get('instrument'))}\n"
                   f"Fields to read from the question: {js_json(js_or(w.get('reading_fields'), {}))}\n"
                   f"Claimed diagnoses (predicate → misconception):\n{diag}")
    return "\n\n".join(out)


def verify_args_by_ref(args: dict, directory: Path) -> dict:
    import packet_ref
    shards = packet_ref.Shards(directory, "S7 verify")
    groups: dict[str, list] = {}
    for w in args["widgets"]:
        groups.setdefault(w["template_id"], []).append(w)
    refs = []
    for n, (tid, ws) in enumerate(groups.items(), start=1):
        shards.put(f"t/t{n:03d}.txt", _js_verify_section(ws))
        refs.append({"template_id": tid, "widgets": [{"question_id": w["question_id"], "template_sha": w["template_sha"]}
                                                     for w in ws]})
    out = {k: v for k, v in args.items() if k not in ("widgets", "book")}
    out["book"] = {k: args["book"].get(k) for k in ("book", "title") if k in args["book"]}
    out["by_ref"] = shards.finish({"book": out["book"].get("book"), "mode": "verify"})
    out["widget_refs"] = refs
    return out


def main_templates(args) -> int:
    templates, problems = load_templates(args.templates)
    for p in problems:
        print(f"  x {p}", file=sys.stderr)
    if problems:
        print("TEMPLATES REJECTED — a malformed template renders nothing", file=sys.stderr)
        return 1
    book = None
    if args.book:
        import book_config
        book = book_config.load_book(args.book)
    course = args.course or (book.course_id if book else None)
    graph = PgGraph(args.dsn)
    questions, render_problems = build_from_templates(templates)
    s5_view = json.loads(json.dumps(questions))  # before any diagnostic is dropped
    checks, dropped = check_questions(questions, graph, pre_catalogue=args.pre_catalogue)
    for n in dropped:
        print(f"  ! {n}", file=sys.stderr)
    problems = render_problems + checks

    if args.verify_args:
        va = verify_args(book, graph, [q for q in questions if not any(p.startswith(q["id"] + ":") for p in problems)])
        n, extra = len(va["widgets"]), ""
        if args.by_ref is not None:
            import packet_ref
            if not book:
                print("--verify-args --by-ref needs --book", file=sys.stderr)
                return 2
            va = verify_args_by_ref(va, Path(args.by_ref) if args.by_ref else packet_ref.default_dir(book.book, "s7", "verify"))
            extra = f"; {va['by_ref']['files']} shard(s) in {va['by_ref']['dir']}; " + packet_ref.report(va, "by ref")
        args.verify_args.parent.mkdir(parents=True, exist_ok=True)
        import packet_ref
        args.verify_args.write_text((packet_ref.dumps(va) if "by_ref" in va   # by ref: one line, to paste
                                     else json.dumps(va, indent=2, ensure_ascii=False)) + "\n")
        print(f"wrote {args.verify_args} — {n} widget(s) for the blind reachability verifier{extra}")

    if problems:
        print("WIDGET TEMPLATES REJECTED\n", file=sys.stderr)
        for p in problems:
            print(f"  x {p}", file=sys.stderr)
        return 1
    if args.s5_distractors:
        preds = W.contract()["kinds"]
        ds = [{"lo": q["lo_id"], "origin": "S7", "ref": f"{q['family']}#{d['predicate']}",
               "question_id": q["id"], "text": preds[q["choices"]["kind"]]["predicates"].get(d["predicate"], d["predicate"]),
               "misconception_id": d["misconception_id"]}
              for q in s5_view for d in q["choices"]["diagnostics"]]
        uniq = list({(d["ref"], d["misconception_id"]): d for d in ds}.values())
        args.s5_distractors.parent.mkdir(parents=True, exist_ok=True)
        args.s5_distractors.write_text(json.dumps({"distractors": uniq}, indent=2, ensure_ascii=False) + "\n")
        print(f"wrote {args.s5_distractors} — {len(uniq)} predicate mapping(s) for S5")
    if args.gap_report:
        if not course:
            print("--gap-report needs --book or --course", file=sys.stderr)
            return 2
        previous = json.loads(args.gap_report.read_text()) if args.gap_report.exists() else None
        rep = gap_report(book.book if book else "?", course, graph, questions, args.gaps, previous)
        args.gap_report.parent.mkdir(parents=True, exist_ok=True)
        args.gap_report.write_text(json.dumps(rep, indent=2, ensure_ascii=False) + "\n")
        print(f"wrote {args.gap_report} — {len(rep['chapters']) - len(rep['uncovered_chapters'])}/"
              f"{len(rep['chapters'])} chapters covered; proposed kinds: {sorted(rep['proposed_kinds'])}")
    if args.out:
        if args.pre_catalogue:
            print("REFUSING --out with --pre-catalogue: the bundle is written only against S5's final "
                  "catalogue, loaded in the scratch database.", file=sys.stderr)
            return 1
        if not args.verdicts:
            print("REFUSING --out without --verdicts: every widget passes the blind reachability "
                  "verifier first (§3.10). Run --verify-args, then widgets.workflow.js in verify mode.",
                  file=sys.stderr)
            return 1
        accepted, rejected = apply_verdicts(templates, questions, args.verdicts)
        for tid, rs in rejected.items():
            print(f"  x {tid}: REJECTED — {'; '.join(rs[:3])}", file=sys.stderr)
        keep = [q for q in questions if q["family"] in accepted]
        bundle = {"generator": GENERATOR + " --templates", "question_type": "widget", "book": args.book,
                  "course_id": course, "templates": {t["id"]: t["_sha"] for t in templates if t["id"] in accepted},
                  "rejected_templates": rejected, "questions": keep, "misconceptions": []}
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(bundle, indent=2, ensure_ascii=False) + "\n")
        print(f"wrote {args.out} — {len(keep)} widget question(s) from {len(accepted)} template(s); "
              f"{len(rejected)} rejected")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path)
    ap.add_argument("--dsn", default=os.environ.get("AINEXT_DB_DSN"),
                    help="REQUIRED (FR-1215): the scratch database whose graph and misconception "
                         "catalogue every diagnostic is checked against")
    ap.add_argument("--templates", type=Path, help="widgets/<book>/: JSON templates (S7). Without it, the "
                                                   "48 hand-written Prep-3 templates in this file")
    ap.add_argument("--book")
    ap.add_argument("--course")
    ap.add_argument("--verdicts", type=Path, nargs="*", default=[], help="widgets.workflow.js verify outputs")
    ap.add_argument("--gaps", type=Path, nargs="*", default=[], help="widgets.workflow.js author outputs (their gaps)")
    ap.add_argument("--gap-report", type=Path, help="coverage/<book>.widget-gaps.json")
    ap.add_argument("--author-args", type=Path, help="write args for widgets.workflow.js (mode author)")
    ap.add_argument("--verify-args", type=Path, help="write args for widgets.workflow.js (mode verify)")
    ap.add_argument("--s5-distractors", type=Path, help="write S7's predicate mappings for S5's final pass")
    ap.add_argument("--by-ref", nargs="?", const="", default=None, metavar="DIR",
                    help="with --author-args or --verify-args: packet by reference (packet_ref.py) — the prompts' big "
                         "blocks to shard files in DIR (default work/<book>/packets/s7-<mode>/), compact args naming them")
    ap.add_argument("--pre-catalogue", action="store_true",
                    help="S7 before S5's final catalogue is loaded: every check except catalogue "
                         "existence; the prerequisite rule reads the objective from the mc: id; no --out")
    args = ap.parse_args()

    if not args.dsn:
        # The checks that matter most need the graph; skipping them silently was
        # finding G5 in the pipeline audit. No DSN, no bundle.
        print("REFUSING: --dsn (or AINEXT_DB_DSN) is required — the prerequisite rule (FR-1215) and the "
              "misconception catalogue are checked against the graph, never skipped.", file=sys.stderr)
        return 2
    if args.author_args:
        import book_config
        if not args.book:
            print("--author-args needs --book", file=sys.stderr)
            return 2
        book = book_config.load_book(args.book)
        if args.by_ref and args.verify_args:
            print("--by-ref DIR with both --author-args and --verify-args would write both packets into one "
                  "directory: give them separately, or use the default directories (--by-ref with no DIR)",
                  file=sys.stderr)
            return 2
        a = author_args(book, PgGraph(args.dsn), args.course or book.course_id)
        n, extra = len(a["objectives"]), ""
        if args.by_ref is not None:
            import packet_ref
            a = author_args_by_ref(a, Path(args.by_ref) if args.by_ref else packet_ref.default_dir(book.book, "s7", "author"))
            extra = f"; {a['by_ref']['files']} shard(s) in {a['by_ref']['dir']}; " + packet_ref.report(a, "by ref")
        args.author_args.parent.mkdir(parents=True, exist_ok=True)
        import packet_ref
        args.author_args.write_text((packet_ref.dumps(a) if "by_ref" in a   # by ref: one line, to paste
                                     else json.dumps(a, indent=2, ensure_ascii=False)) + "\n")
        print(f"wrote {args.author_args} — {n} objective(s){extra}")
        if not args.templates and not args.out:
            return 0
    if args.templates:
        return main_templates(args)
    if not args.out:
        print("--out is required", file=sys.stderr)
        return 2
    return main_legacy(args)


def main_legacy(args) -> int:
    """The 48 hand-written Prep-3 templates, exactly as generated for the live bank.

    They predate the parent rule (spec §2.6): their parent_question_id is NULL,
    as in the committed export. The graph checks below are unchanged.
    """
    questions = build()
    problems: list[str] = []

    # Structural checks that need no database.
    for q in questions:
        problems += W.validate_widget(q)

    # The checks that matter most need the graph. A diagnostic naming a
    # misconception that does not exist diagnoses correctly and serves nothing:
    # the widget works, the student gets silence, and nothing raises.
    if args.dsn:
        import psycopg

        with psycopg.connect(args.dsn) as conn, conn.cursor() as cur:
            cur.execute("SELECT id, lo_id FROM misconceptions")
            lo_of = dict(cur.fetchall())
            cur.execute("SELECT id FROM graph_nodes WHERE kind = 'learning_objective'")
            known_los = {r[0] for r in cur.fetchall()}

            closures: dict[str, set[str]] = {}
            for q in questions:
                if q["lo_id"] not in known_los:
                    problems.append(f"{q['id']}: lo_id {q['lo_id']} is not in the graph")
                    continue
                if q["lo_id"] not in closures:
                    closures[q["lo_id"]] = prerequisite_closure(cur, q["lo_id"])
                allowed = closures[q["lo_id"]]
                for d in q["choices"]["diagnostics"]:
                    mid = d["misconception_id"]
                    if mid not in lo_of:
                        problems.append(
                            f"{q['id']}: names misconception {mid!r}, which does not exist"
                        )
                    elif lo_of[mid] not in allowed:
                        problems.append(
                            f"{q['id']}: names {mid!r} on {lo_of[mid]}, which is neither this "
                            f"question's objective nor a prerequisite of it"
                        )

    if problems:
        print("WIDGET BUNDLE REJECTED\n", file=sys.stderr)
        for p in problems:
            print(f"  x {p}", file=sys.stderr)
        return 1

    bundle = {
        "generator": GENERATOR,
        "question_type": "widget",
        "questions": questions,
        "misconceptions": [],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(bundle, indent=2, ensure_ascii=False) + "\n")

    by_tier: dict[str, int] = {}
    by_kind: dict[str, int] = {}
    fams: set[str] = set()
    for q in questions:
        by_tier[q["tier"]] = by_tier.get(q["tier"], 0) + 1
        by_kind[q["choices"]["kind"]] = by_kind.get(q["choices"]["kind"], 0) + 1
        fams.add(q["source_note"])
    diag = sum(len(q["choices"]["diagnostics"]) for q in questions)
    print(f"wrote {args.out} — {len(questions)} widget questions")
    print(f"  objectives: {len({q['lo_id'] for q in questions})} · families: {len(fams)}")
    print(f"  tiers: {by_tier}")
    print(f"  kinds: {by_kind}")
    print(f"  diagnostic mappings: {diag}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
