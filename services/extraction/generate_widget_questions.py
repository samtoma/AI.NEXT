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
# Two rules are STRICTER here than in the app, and say so: a sample_space event
# with no outcome in it (every answer would be "select nothing"), and a
# venn_builder count clue that is not the size of its set as the regions give it
# (the clue is what the widget's "counted the overlap twice" diagnosis reads).
# ==========================================================================

CIRCLE_ELEMENTS = ("radius", "chord", "diameter", "tangent")
BAR_STATS = ("mean", "median", "mode", "range")
RULE_KINDS = ("sum", "diff", "product", "same", "first", "second")
RULE_OPS = ("eq", "ne", "lt", "le", "gt", "ge")
# widget-payloads.ts CURVE_FNS / CURVE_COEF_COUNT: linear and quadratic, plus the five G10 families
CURVE_COEF_COUNT = {"linear": 2, "quadratic": 3, "hyperbola": 2, "exponential": 3, "sine": 2, "cosine": 2,
                    "tangent": 2}
CURVE_FNS = tuple(CURVE_COEF_COUNT)
POLYGON_SHAPES = ("scalene", "isosceles", "right",
                  "parallelogram", "rectangle", "rhombus", "square", "trapezium", "kite")
SOLID_KINDS = ("box", "cylinder", "cone", "pyramid", "sphere")
# parseSolidDims: the fields each solid takes, and the default each falls back to
SOLID_DIMS = {"box": {"l": 4, "w": 3, "h": 2}, "cylinder": {"r": 2, "h": 4}, "cone": {"r": 2, "h": 4},
              "pyramid": {"s": 4, "h": 3}, "sphere": {"r": 2}}
VENN_TARGETS = ("union", "intersection", "aOnly", "bOnly", "cOnly",
                "complementA", "complementB", "complementC", "neither")
THREE_SET_ONLY_TARGETS = ("cOnly", "complementC")
VENN_REGION_KEYS = {2: ("a", "b", "ab", "n"), 3: ("a", "b", "c", "ab", "ac", "bc", "abc", "n")}

# What each instrument can express, in words — for the author and for the blind
# reachability verifier (widgets.workflow.js). Same facts as the rules below.
# The kinds of feature 003 (polygon_builder … area_model, and curve_sketcher's five
# G10 families) carry app/src/lib/widget-docs.ts DOCS text WORD FOR WORD after the
# spec example (tests/test_widget_templates.py checks it), then any limit
# parseMathWidget enforces that the DOCS line does not state.
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
                      "'quadratic', coefs [a, b, c], a ≠ 0); every coefficient within ±10. Five more families, "
                      "spec example {\"fn\":\"hyperbola\",\"coefs\":[2,-1]} — the same freehand "
                      "curve_sketcher, five more families. fn ∈ hyperbola (coefs [a,q], y=a/x+q, a a nonzero "
                      "whole number |a|≤6, q whole |q|≤3) | exponential (coefs [a,b,q], y=a·b^x+q, a nonzero "
                      "whole |a|≤3, b ∈ {2,3,0.5}, q whole |q|≤3) | sine | cosine | tangent (coefs [a,q], "
                      "amplitude a — nonzero whole, |a|≤4 for sine/cosine or ≤3 for tangent — and vertical "
                      "shift q whole |q|≤3; θ is in DEGREES, domain 0..360, and the period is fixed by the "
                      "book's own convention — 360° for sine/cosine, 180° for tangent — never a parameter you "
                      "set). Hyperbola and tangent have more than one visible branch and CANNOT be drawn as "
                      "one stroke: tell the student to lift their finger and draw each branch separately. "
                      "Drawing straight through where the curve is undefined (x=0 for a hyperbola, θ=90°/270° "
                      "for tangent) is rejected as \"asymptote-crossed\", which is the point — an asymptote is "
                      "a boundary the curve approaches and never crosses.",
    "polygon_builder": "Spec example {\"mode\":\"construct\",\"shape\":\"rhombus\"} — the student drags 3 or 4 "
                       "vertices on a lattice into the named shape; graded on its PROPERTIES (side lengths, "
                       "parallel sides, right angles), so every valid figure is accepted. shape (triangle) ∈ "
                       "scalene | isosceles | right; shape (quadrilateral) ∈ parallelogram | rectangle | "
                       "rhombus | square | trapezium | kite — never equilateral, which a square lattice cannot "
                       "draw. Two other modes: "
                       "{\"mode\":\"midsegment\",\"triangle\":[[0,0],[6,0],[0,6]],\"apex\":0} — the student "
                       "drags a segment onto the two sides touching \"apex\" and it is graded "
                       "parallel-and-half-length against the third side (the midpoint theorem, as a property, "
                       "not a position); and {\"mode\":\"area\",\"shape\":\"triangle\",\"target\":6} — any "
                       "polygon of that vertex count is accepted if its area matches (target must be a whole "
                       "or half number, Pick's theorem). Validator limits (parseMathWidget): a midsegment "
                       "triangle's vertices are whole-number pairs within ±6 and not collinear, apex 0, 1 or "
                       "2; an area target is above 0 and at most 24.",
    "solid_scaler": "Spec example {\"solid\":\"cylinder\",\"ask\":\"volume\",\"ratio\":8} — a simple isometric "
                    "solid the student scales by dragging a factor k; the live readout shows V0·k³ and A0·k² "
                    "together. solid ∈ box | cylinder | cone | pyramid | sphere; ask ∈ volume | area. "
                    "\"ratio\" is the TARGET MULTIPLE (never an absolute number) and its correct k — ∛ratio "
                    "for volume, √ratio for area — must land on the slider's own 0.5 stops from 0.5 to 4 (so "
                    "favour ratio ∈ {1, 2.25, 4, 8, 9, 15.625, 16, 27, 64, …} — check ∛ or √ lands on a half "
                    "before emitting). ask:\"area\" also shows toggles for which face(s) count, so leaving a "
                    "base off is diagnosed on its own. Validator limits (parseMathWidget): ratio above 0; "
                    "optional \"dims\" — box {l, w, h} (default 4, 3, 2), cylinder and cone {r, h} (default 2, "
                    "4), pyramid {s, h} (default 4, 3), sphere {r} (default 2) — each above 0 and at most 8. "
                    "Give dims whenever the question states the solid's measurements, so the drawing shows "
                    "them.",
    "box_plot_builder": "Spec example {\"data\":[2,4,4,5,6,7,9,12,15]} — the student drags five markers "
                        "(minimum, Q1, median, Q3, maximum) onto a number line for the given data set. "
                        "\"data\" must be 5–16 WHOLE numbers (so every quartile lands on the widget's snap "
                        "grid) — never pre-sorted for the student, and include an outlier only when you want "
                        "the whisker-vs-outlier distinction taught. Quartiles are graded by this book's own "
                        "method: linear interpolation between ranks (Siyavula §10.4's \"percentile formula\"), "
                        "not the split-at-the-median method some other syllabuses use. Validator limits "
                        "(parseMathWidget): every value within ±500.",
    "venn_builder": "Spec example "
                    "{\"sets\":2,\"labels\":[\"Football\",\"Chess\"],\"mode\":\"shade\",\"target\":\"aOnly\"} "
                    "— a real 2- or 3-circle Venn diagram; the student taps the region(s) that make the named "
                    "target true. target ∈ union | intersection | aOnly | bOnly | cOnly | complementA | "
                    "complementB | complementC | neither — cOnly/complementC need sets:3. The other mode fills "
                    "in counts instead of shading: "
                    "{\"mode\":\"counts\",\"sets\":2,\"labels\":[\"French\",\"German\"],\"total\":20,\"regions\":{\"a\":8,\"b\":5,\"ab\":4,\"n\":3},\"clues\":{\"a\":12,\"b\":9}} "
                    "— \"regions\" is every exclusive zone's TRUE count (a/b/c/ab/ac/bc/abc/n, whichever the "
                    "set count needs) and must sum to \"total\" when you give one; \"clues\" are the word "
                    "problem's raw, PRE-overlap set sizes, which is what lets the widget name \"counted the "
                    "overlap twice\" as the specific mistake it is. Validator limits (parseMathWidget): "
                    "\"labels\" holds one non-empty name per set; every region count is a whole number 0–999; "
                    "total and clues are whole numbers, not negative. Pipeline rule: each clue is the size of "
                    "its set as the regions give it (a + ab for two sets; a + ab + ac + abc for three).",
    "area_model": "Spec example {\"mode\":\"expand\",\"a\":2,\"b\":-3} — algebra tiles as a grid the student "
                  "builds: one x² tile anchored, x-tiles run out along its top and left edges (the \"a\" and "
                  "\"b\" signs — negative tiles are hatched AND marked \"−\", never colour alone), and the "
                  "block those two runs bound is where the ab unit tiles go. mode ∈ expand | factor — same "
                  "target (x+a)(x+b), same grading, only the prompt differs; a and b are whole numbers, not "
                  "both zero, |a| and |b| ≤ 4 (the grid runs out past that). Prefer this over an explanation "
                  "of FOIL: the cross term is something the student places, not a step they recite.",
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
        if not _is_str(fn) or fn not in CURVE_FNS:
            return [f"fn must be one of {CURVE_FNS}"]
        want = CURVE_COEF_COUNT[fn]
        if not isinstance(coefs, list) or len(coefs) != want or not all(_isnum(k) for k in coefs):
            return [f"a {fn} curve takes {want} coefs, all numbers"]
        return _curve_reachable(fn, coefs)
    if kind == "polygon_builder":
        return _polygon_reachable(s)
    if kind == "solid_scaler":
        return _solid_reachable(s)
    if kind == "box_plot_builder":
        data = s.get("data")
        if not isinstance(data, list) or not 5 <= len(data) <= 16:
            return ["data holds 5–16 values"]
        if not all(_isint(v) for v in data):
            return ["every data value is a whole number (the quartiles land on the 0.25 snap grid)"]
        return ["every data value is within ±500"] if any(abs(v) > 500 for v in data) else []
    if kind == "venn_builder":
        return _venn_reachable(s)
    if kind == "area_model":
        mode, a, b = s.get("mode"), s.get("a"), s.get("b")
        if not _is_str(mode) or mode not in ("expand", "factor") or not _isint(a) or not _isint(b):
            return ["mode must be expand|factor and a, b whole numbers"]
        if a == 0 and b == 0:
            return ["a and b are not both zero"]
        return ["|a| and |b| are at most 4 (the tile grid runs out)"] if abs(a) > 4 or abs(b) > 4 else []
    return [f"unknown widget kind {kind!r}"]


def _is_str(v) -> bool:
    return isinstance(v, str)


def _exact(v, *allowed) -> bool:
    """JavaScript's `v === x` for numbers: a bool is never a number."""
    return _isnum(v) and any(v == x for x in allowed)


def _curve_reachable(fn: str, coefs: list) -> list[str]:
    """widget-payloads.ts `curveReachable`, per family."""
    if fn in ("linear", "quadratic"):
        if fn == "quadratic" and coefs[0] == 0:
            return ["a quadratic needs a ≠ 0"]
        return ["every coefficient is within ±10"] if any(abs(k) > 10 for k in coefs) else []
    whole = lambda v, lim, nonzero: _isint(v) and (v != 0 or not nonzero) and abs(v) <= lim  # noqa: E731
    if fn == "hyperbola":
        a, q = coefs
        return [] if whole(a, 6, True) and whole(q, 3, False) else \
            ["a hyperbola takes a a nonzero whole number |a| ≤ 6 and q whole |q| ≤ 3"]
    if fn == "exponential":
        a, b, q = coefs
        return [] if whole(a, 3, True) and _exact(b, 2, 3, 0.5) and whole(q, 3, False) else \
            ["an exponential takes a nonzero whole |a| ≤ 3, b ∈ {2, 3, 0.5} and q whole |q| ≤ 3"]
    a, q = coefs
    lim = 3 if fn == "tangent" else 4
    return [] if whole(a, lim, True) and whole(q, 3, False) else \
        [f"a {fn} curve takes a nonzero whole amplitude |a| ≤ {lim} and q whole |q| ≤ 3"]


def _polygon_reachable(s: dict) -> list[str]:
    mode = s.get("mode")
    if not _is_str(mode) or mode not in ("construct", "midsegment", "area"):
        return ["mode must be construct|midsegment|area"]
    if mode == "construct":
        shape = s.get("shape")
        return [] if _is_str(shape) and shape in POLYGON_SHAPES else \
            [f"a construct shape is one of {POLYGON_SHAPES} (never equilateral: a square lattice cannot draw one)"]
    if mode == "midsegment":
        tri = s.get("triangle")
        if not isinstance(tri, list) or len(tri) != 3:
            return ["triangle must be three vertices"]
        pts = [_intpair(p, 6) for p in tri]
        if not all(pts):
            return ["every vertex is a whole-number pair within ±6"]
        t0, t1, t2 = pts
        if (t1[0] - t0[0]) * (t2[1] - t0[1]) - (t2[0] - t0[0]) * (t1[1] - t0[1]) == 0:
            return ["the three vertices are collinear: no triangle"]
        return [] if _exact(s.get("apex"), 0, 1, 2) else ["apex must be 0, 1 or 2"]
    shape, target = s.get("shape"), s.get("target")
    if not _is_str(shape) or shape not in ("triangle", "quadrilateral") or not _isnum(target):
        return ["an area shape is triangle|quadrilateral and target a number"]
    if target <= 0 or target > 24:
        return ["an area target is above 0 and at most 24"]
    return [] if float(target * 2).is_integer() else \
        ["an area target is a whole or half number (a lattice polygon's area, Pick's theorem)"]


def _solid_dims(solid: str, raw) -> dict | None:
    """widget-payloads.ts `parseSolidDims`: the stated dims over the defaults, or None if one is out of range."""
    d = raw if isinstance(raw, dict) else {}
    out = {}
    for key, fallback in SOLID_DIMS[solid].items():
        if key not in d:
            out[key] = fallback
        elif _isnum(d[key]) and 0 < d[key] <= 8:
            out[key] = d[key]
        else:
            return None
    return out


def _solid_reachable(s: dict) -> list[str]:
    import math
    solid, ask, ratio = s.get("solid"), s.get("ask"), s.get("ratio")
    if not _is_str(solid) or solid not in SOLID_KINDS or not _is_str(ask) or ask not in ("volume", "area") \
            or not _isnum(ratio) or ratio <= 0:
        return [f"solid in {SOLID_KINDS}, ask volume|area, ratio a positive number"]
    k = math.cbrt(ratio) if ask == "volume" else math.sqrt(ratio)
    if k < 0.5 - 1e-9 or k > 4 + 1e-9:
        return [f"the scale factor this ratio needs is {k:g}; the slider runs 0.5–4"]
    steps = (k - 0.5) / 0.5
    if abs(steps - round(steps)) > 1e-6:
        return [f"the scale factor this ratio needs is {k:g}; the slider stops only at multiples of 0.5"]
    return [] if _solid_dims(solid, s.get("dims")) is not None else \
        ["every stated dimension is above 0 and at most 8, and only the solid's own fields"]


def _venn_set_sizes(sets: int, regions: dict) -> dict:
    keys = VENN_REGION_KEYS[sets]
    return {x: sum(regions[k] for k in keys if k != "n" and x in k) for x in "abc"[:sets]}


def _venn_reachable(s: dict) -> list[str]:
    sets = s.get("sets")
    if not _exact(sets, 2, 3):
        return ["sets must be 2 or 3"]
    sets = int(sets)
    labels = s.get("labels")
    if not isinstance(labels, list) or len(labels) != sets or \
            not all(_is_str(x) and x.strip() for x in labels):
        return ["labels holds one non-empty name per set"]
    mode = s.get("mode")
    if not _is_str(mode) or mode not in ("shade", "counts"):
        return ["mode must be shade|counts"]
    if mode == "shade":
        target = s.get("target")
        if not _is_str(target) or target not in VENN_TARGETS:
            return [f"a shade target is one of {VENN_TARGETS}"]
        return [f"{target} needs a third set (sets: 3)"] if sets == 2 and target in THREE_SET_ONLY_TARGETS else []
    regions = s.get("regions")
    if not isinstance(regions, dict):
        return ["regions must be an object"]
    keys = VENN_REGION_KEYS[sets]
    if not all(_isint(regions.get(k)) and 0 <= regions[k] <= 999 for k in keys):
        return [f"regions gives every zone {keys} a whole-number count 0–999"]
    if "total" in s:
        total = s["total"]
        if not _isint(total) or total < 0:
            return ["total is a whole number, not negative"]
        if sum(regions[k] for k in keys) != total:
            return [f"the regions sum to {sum(regions[k] for k in keys)}, not the total {total}"]
    clues = s.get("clues")
    if isinstance(clues, dict):
        for k in "abc":
            if k in clues and (not _isint(clues[k]) or clues[k] < 0):
                return ["every clue is a whole number, not negative"]
        # the pipeline rule, stricter than the app: a clue is its set's size as the regions give it
        sizes = _venn_set_sizes(sets, regions)
        wrong = [f"{k} {clues[k]} (the regions give {sizes.get(k, 'no such set')})" for k in "abc"
                 if k in clues and clues[k] != sizes.get(k)]
        if wrong:
            return ["each clue is the size of its set as the regions give it: " + ", ".join(wrong)
                    + " (pipeline rule, stricter than the app)"]
    return []


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


class CatalogueOverlay:
    """A graph whose misconceptions also include an S5 catalogue or DRAFT run not yet loaded (§3.2: S7's
    author runs after the S5 draft, before any catalogue is assembled or loaded). Without it the author is
    shown no misconception of the new book to name, and the verifier sees "?" for every draft id — the
    Chapter 8 pilot's S7 would have authored against an empty catalogue."""

    def __init__(self, graph, entries: dict[str, dict]):
        self.graph, self.entries = graph, entries

    def misconceptions(self) -> dict[str, dict]:
        extra = {i: {"lo_id": e.get("lo_id"), "label": e.get("label"), "description": e.get("description")}
                 for i, e in self.entries.items()}
        return {**self.graph.misconceptions(), **extra}

    def __getattr__(self, name):
        return getattr(self.graph, name)


def _with_catalogue(graph, path):
    if not path:
        return graph
    import generate_questions as G
    entries, _alias = G.load_catalogue(path)
    return CatalogueOverlay(graph, entries)


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
    # a widget question shows its instrument, never the book's diagram: a stem that points at a
    # [figure] asks the student (and the blind verifier) about a picture neither will see (s7-v4)
    if isinstance(raw.get("stem"), str) and "[figure]" in raw["stem"]:
        p.append("stem refers to a [figure]: a widget question is answered on its instrument alone — write "
                 "the stem so it needs no book diagram")
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
    "curve_sketcher": {"fn": "'linear', 'quadratic', 'hyperbola', 'exponential', 'sine', 'cosine' or 'tangent'",
                       "coefs": "linear [m, c]; quadratic [a, b, c]; hyperbola y = a/x + q [a, q]; exponential "
                                "y = a·b^x + q [a, b, q]; sine, cosine, tangent [a, q] (amplitude, vertical shift)"},
    "polygon_builder": {"mode": "'construct', 'midsegment' or 'area'",
                        "shape": "construct: the shape to build (scalene, isosceles, right, parallelogram, "
                                 "rectangle, rhombus, square, trapezium or kite); area: 'triangle' or "
                                 "'quadrilateral'",
                        "triangle": "midsegment: the fixed triangle's three vertices as [x, y] pairs",
                        "apex": "midsegment: which vertex (0, 1 or 2, in your triangle's order) the two sides "
                                "the segment joins meet at",
                        "target": "area: the area the polygon must have"},
    "solid_scaler": {"solid": "box | cylinder | cone | pyramid | sphere",
                     "ask": "'volume' or 'area' — which one must be scaled",
                     "ratio": "how many times as large it must become",
                     "dims": "only if the question states the solid's measurements: box {l, w, h}; cylinder "
                             "and cone {r, h}; pyramid {s, h} (base side, height); sphere {r}"},
    "box_plot_builder": {"data": "every value of the data set, as the question gives it"},
    "venn_builder": {"sets": "2 or 3", "labels": "the sets' names, in the order the question names them",
                     "mode": "'shade' (mark a region) or 'counts' (fill in every region's count)",
                     "target": "shade: union | intersection | aOnly | bOnly | cOnly | complementA | "
                               "complementB | complementC | neither — a, b, c being the sets in your labels' order",
                     "total": "counts: the total, only if the question states one",
                     "regions": "counts: every exclusive zone's true count, worked out from the question — "
                                "a, b, ab, n for two sets; a, b, c, ab, ac, bc, abc, n for three (n: in none)",
                     "clues": "counts: the set sizes the question states before any overlap is removed, "
                              "as {a, b(, c)}"},
    "area_model": {"a": "the target is (x + a)(x + b): a, a whole number (to factorise, read it from the "
                        "factors)", "b": "b, likewise"},
}


def _near(a, b) -> bool:
    return _isnum(a) and _isnum(b) and abs(float(a) - float(b)) <= 1e-9


def _reading_value(v):
    """A reading field the verifier wrote as a STRING holding a value — "[3, -2]", "-1/2", "4", "true", or a value
    followed by its own gloss ("[1, 0], the midpoint of A(-1,3) and B(3,-3)") — read as that value. Words that
    are not a value stay words, and then disagree with the spec as before (s7-v5's schema typed no field)."""
    import re
    if not isinstance(v, str):
        return v
    t = v.strip()
    try:
        return json.loads(t)
    except ValueError:
        pass
    m = re.fullmatch(r"(-?\d+)\s*/\s*(\d+)", t)
    if m and int(m.group(2)):
        return int(m.group(1)) / int(m.group(2))
    m = re.fullmatch(r"\(\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*\)", t)   # a point, (x, y) or (x; y)
    if m:
        return [json.loads(m.group(1)), json.loads(m.group(2))]
    try:
        val, end = json.JSONDecoder().raw_decode(t)
    except ValueError:
        return v
    if isinstance(val, (list, int, float)) and not isinstance(val, bool) and t[end:end + 1] in (",", ";", " "):
        return val
    return v


def reading_agrees(kind: str, spec: dict, reading: dict) -> tuple[bool, str]:
    """Does the blind verifier's reading of the stem say what the stored spec says?"""
    if not isinstance(reading, dict):
        return False, "no reading of the stem"
    r, s = {k: _reading_value(v) for k, v in reading.items()}, spec
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
        elif kind == "polygon_builder":
            ok = r["mode"] == s["mode"]
            if ok and s["mode"] == "construct":
                ok = r["shape"] == s["shape"]
            elif ok and s["mode"] == "midsegment":   # the same triangle, whatever order it is read in
                vs = lambda t: sorted(tuple(float(c) for c in p) for p in t)  # noqa: E731
                apex = lambda x: tuple(float(c) for c in x["triangle"][int(x["apex"])])  # noqa: E731
                ok = len(r["triangle"]) == 3 and vs(r["triangle"]) == vs(s["triangle"]) and apex(r) == apex(s)
            elif ok:
                ok = r["shape"] == s["shape"] and _near(r["target"], s["target"])
        elif kind == "solid_scaler":
            ok = r["solid"] == s["solid"] and r["ask"] == s["ask"] and _near(r["ratio"], s["ratio"])
            stated = r.get("dims") or {}
            if ok and stated:   # measurements the question states must be the ones the widget draws
                drawn = _solid_dims(s["solid"], s.get("dims")) or {}
                ok = set(stated) <= set(drawn) and all(_near(v, drawn[k]) for k, v in stated.items())
        elif kind == "box_plot_builder":
            ok = sorted(float(v) for v in r["data"]) == sorted(float(v) for v in s["data"])
        elif kind == "venn_builder":
            ok, why = _venn_reading_agrees(r, s)
            if not ok:
                return False, why
        elif kind == "area_model":
            ok = sorted(float(v) for v in (r["a"], r["b"])) == sorted(float(v) for v in (s["a"], s["b"]))
        else:
            return False, f"no reading rule for kind {kind!r}"
    except (KeyError, TypeError, ValueError, AttributeError, IndexError) as e:
        return False, f"reading incomplete ({e})"
    shown = {k: v for k, v in r.items() if k in READING_FIELDS.get(kind, {})}
    return ok, ("" if ok else f"the stem reads as {json.dumps(shown)}; the spec stores {json.dumps(s)}")


def _norm_label(x) -> str:
    return " ".join(str(x).split()).casefold()


def _venn_reading_agrees(r: dict, s: dict) -> tuple[bool, str]:
    """The reading names the sets in its own order: map its letters onto the spec's by label, then compare
    the target, or every region, the total and the clues, through that map."""
    sets = int(s["sets"])
    if int(r["sets"]) != sets or r["mode"] != s["mode"]:
        return False, f"the stem reads as {r.get('sets')} set(s), mode {r.get('mode')!r}; the spec stores " \
                      f"{sets}, {s['mode']!r}"
    mine, theirs = [_norm_label(x) for x in s["labels"]], [_norm_label(x) for x in r["labels"]]
    if len(theirs) != sets or sorted(mine) != sorted(theirs) or len(set(mine)) != sets:
        return False, f"the stem names the sets {r.get('labels')}; the spec labels them {s['labels']}"
    to_r = {"abc"[i]: "abc"[theirs.index(lab)] for i, lab in enumerate(mine)}   # spec letter -> reading letter
    zone = lambda k: "n" if k == "n" else "".join(sorted(to_r[c] for c in k))  # noqa: E731
    if s["mode"] == "shade":
        t = s["target"]
        want = t if t in ("union", "intersection", "neither") else \
            t[:-1] + to_r[t[-1].lower()].upper() if t.startswith("complement") else to_r[t[0]] + "Only"
        return (r["target"] == want), f"the stem asks for {r.get('target')!r}; the spec stores {t!r} " \
                                      f"(labels {s['labels']})"
    keys = VENN_REGION_KEYS[sets]
    got = r["regions"]
    bad = [k for k in keys if not _near(got.get(zone(k)), s["regions"][k])]
    if bad:
        return False, f"the stem's regions read as {json.dumps(got)}; the spec stores {json.dumps(s['regions'])} " \
                      f"(labels {s['labels']})"
    total = sum(s["regions"][k] for k in keys)   # = the spec's total when it gives one (reachability)
    if r.get("total") is not None and not _near(r["total"], total):
        return False, f"the stem's total reads as {r['total']}; the spec's regions sum to {total}"
    sizes = _venn_set_sizes(sets, s["regions"])
    rc = r.get("clues") or {}
    for k in "abc"[:sets]:
        stated = (s.get("clues") or {}).get(k)
        read = rc.get(to_r[k])
        if (stated is not None or read is not None) and not _near(read, sizes[k]):
            return False, f"the stem gives set {s['labels']['abc'.index(k)]!r} as {read}; the spec's " \
                          f"regions make it {sizes[k]}" + ("" if stated is None else f" (clue {stated})")
    return True, ""


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


def _predicate_of(text, claimed: set) -> str | None:
    """The predicate a verifier's verdict is about. It was asked for the name, and sometimes wrote the whole
    claim line instead ("slope-inverted → mc:…", 'off-target ("…") -> mc:…'): the leading name, if it is one
    of the claimed predicates, is that verdict's predicate; anything else is no verdict."""
    import re
    t = str(text or "").strip()
    if t in claimed:
        return t
    m = re.match(r"[a-z][a-z0-9-]*", t)
    return m.group(0) if m and m.group(0) in claimed else None


def verdict_scan(templates: list[dict], questions: list[dict], files: list[Path]) -> tuple[set, dict, dict]:
    """The blind reachability verifier's verdicts (widgets.workflow.js, mode verify), by decision 47.

    A TEMPLATE is accepted when every instance was verified against its current sha, is reachable, and its
    stem reads as its spec. Fail closed: silence is not approval. A MAPPING (predicate → misconception) is
    judged on its own: `status[question id][predicate]` is (True, "") where the verifier confirmed it on that
    instance, else (False, the verifier's why). An unconfirmed mapping no longer rejects its template
    (decision 47, Samuel: "Keep them, and let's human review"): it is held for a human (`hold_pending`).
    Returns (accepted template ids, {rejected template id: reasons}, status)."""
    got: dict[str, list] = {}
    for f in files:
        for r in json.loads(Path(f).read_text()).get("results", []):
            got.setdefault(r.get("question_id"), []).append(r)
    accepted, rejected, status = set(), {}, {}
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
            claimed = {d["predicate"] for d in q["choices"]["diagnostics"]}
            st = status.setdefault(q["id"], {})
            for pred in claimed:
                vs = [next((v for v in r.get("predicates") or [] if _predicate_of(v.get("predicate"), claimed) == pred), None)
                      for r in rs]
                ok = all(v is not None and v.get("matches") is True for v in vs)
                why = " / ".join(str(v.get("why")) for v in vs if v is not None and v.get("matches") is not True and v.get("why"))
                st[pred] = (ok, "" if ok else (why or "the verifier gave no verdict on this mapping"))
        if reasons or not mine:
            rejected[tpl["id"]] = reasons or ["no instances"]
        else:
            accepted.add(tpl["id"])
    return accepted, rejected, status


def apply_verdicts(templates: list[dict], questions: list[dict], files: list[Path]) -> tuple[set, dict]:
    """(accepted, rejected) templates under decision 47 — see `verdict_scan`; mappings are held, not judged here."""
    accepted, rejected, _ = verdict_scan(templates, questions, files)
    return accepted, rejected


MAPPING_VERDICTS = ("keep", "drop")


def mapping_key(question_id: str, predicate: str) -> str:
    return f"{question_id}#{predicate}"


def load_mapping_reviews(files: list[Path]) -> dict[str, dict]:
    """Human verdicts on held mappings ({reviewer, verdicts: {"<question id>#<predicate>": keep|drop}, notes}),
    the shape render_review_page.py --gate g3-mappings exports. A later file wins for the same key."""
    out: dict[str, dict] = {}
    for f in files:
        d = json.loads(Path(f).read_text())
        for k, v in (d.get("verdicts") or {}).items():
            if v not in MAPPING_VERDICTS:
                raise ValueError(f"{f}: {k}: verdict {v!r} is not keep|drop")
            out[k] = {"verdict": v, "by": d.get("reviewer"), "note": (d.get("notes") or {}).get(k, ""),
                      "file": Path(f).name}
    return out


def hold_pending(questions: list[dict], status: dict, reviews: dict | None = None,
                 verifier_runs: list[str] | None = None) -> dict:
    """Decision 47, applied to each question: a mapping the verifier confirmed stays in `choices.diagnostics`
    (active). One it did not is moved to `choices.pending_review` with the verifier's why — inactive: the app
    reads only `diagnostics`, so it is never shown, never a diagnosis, and never S5 evidence — until a human
    keeps it (back into `diagnostics`) or drops it (gone). A question whose every mapping is held ships as a
    plain right/wrong widget. Returns the counts."""
    reviews = reviews or {}
    n = {"active": 0, "held": 0, "kept_by_review": 0, "dropped_by_review": 0}
    for q in questions:
        ch = q["choices"]
        st = status.get(q["id"], {})
        active, held = [], []
        for d in ch.get("diagnostics") or []:
            ok, why = st.get(d["predicate"], (False, "the verifier gave no verdict on this mapping"))
            if ok:
                active.append(d)
                continue
            rv = reviews.get(mapping_key(q["id"], d["predicate"]))
            if rv and rv["verdict"] == "keep":
                active.append(d)
                n["kept_by_review"] += 1
            elif rv and rv["verdict"] == "drop":
                n["dropped_by_review"] += 1
            else:
                held.append({**d, "why": why, **({"verifier_runs": verifier_runs} if verifier_runs else {})})
        ch["diagnostics"] = active
        if held:
            ch["pending_review"] = held
        else:
            ch.pop("pending_review", None)
        n["active"] += len(active)
        n["held"] += len(held)
    return n


def pending_queue(questions: list[dict], graph, verify_files: list[Path]) -> dict:
    """The held mappings as a review queue for render_review_page.py --gate g3-mappings: per claim, what the
    student sees (stem), what the blind verifier read off it, the claim and the verifier's reason."""
    readings: dict[str, dict] = {}
    for f in verify_files:
        for r in json.loads(Path(f).read_text()).get("results", []):
            readings[r.get("question_id")] = r
    mcs = graph.misconceptions() if graph else {}
    kinds = W.contract()["kinds"]
    items = []
    for q in questions:
        for d in (q["choices"].get("pending_review") or []):
            m = mcs.get(d["misconception_id"]) or {}
            r = readings.get(q["id"]) or {}
            items.append({"key": mapping_key(q["id"], d["predicate"]), "question_id": q["id"],
                          "template_id": q["family"], "lo_id": q["lo_id"], "kind": q["choices"]["kind"],
                          "stem": q["stem"], "reading": r.get("reading"), "construction": r.get("construction"),
                          "predicate": d["predicate"],
                          "predicate_meaning": kinds[q["choices"]["kind"]]["predicates"].get(d["predicate"]),
                          "misconception_id": d["misconception_id"], "misconception_label": m.get("label"),
                          "misconception_description": m.get("description"), "why": d.get("why")})
    return {"format": "ainext.widget-mapping-review/1",
            "rule": "decision 47: a mapping the blind verifier did not confirm is held — never shown, never a "
                    "diagnosis, never S5 evidence — until a human keeps or drops it",
            "items": items}


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


def author_args(book, graph, course: str, figures: dict | None = None) -> dict:
    """args for widgets.workflow.js (mode author): objectives, anchors, reachable misconceptions, the contract.
    `figures` (question id -> image files, assemble_misconceptions.figures_by_question): an anchor whose
    stem shows [figure] names its images, so the author sees the book's diagram (s7-v4)."""
    import book_config
    figures = figures or {}
    mcs = graph.misconceptions()
    qs = graph.questions()
    module_of = graph.module_of()
    mods = {m["id"]: m for m in graph.modules(course)}
    objs = []
    for lo, rec in sorted(graph.objectives().items()):
        if module_of.get(lo) not in mods:
            continue
        closure = graph.closure(lo)
        anchors = [{"id": i, "stem": q["stem"], "type": q["type"], "answer": q["answer"],
                    **({"figures": figures[i]} if figures.get(i) else {})}
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


def only_lessons(args: dict, lessons) -> dict:
    """Author args for a re-run of some lessons only (the rest keep their earlier run's record)."""
    only = {x.strip() for x in lessons if x and x.strip()}
    missing = only - {_lesson_of(o["lo_id"]) for o in args["objectives"]}
    if not only or missing:
        raise ValueError(f"no objective of lesson(s) {sorted(missing) or '(none named)'} in this course")
    return dict(args, objectives=[o for o in args["objectives"] if _lesson_of(o["lo_id"]) in only])


# ---- pipeline normalisations of an S7 author's template ---------------------
# Two author errors that --templates refuses are fixed the same way every time, and each fix is recorded in the
# template's "notes" (the same style as families/normalise.py for S6). Applied by an operator on named files
# (--normalise-templates), never inside the checks, which keep refusing the raw author output:
#   drop-foreign-diagnostic   a diagnostic naming a misconception of an objective that is neither the template's
#                             nor one of its prerequisites (FR-1215) is dropped — only while at least one
#                             diagnostic of its own remains; a template left with none goes back to the author
#   drop-duplicate-predicate  a predicate mapped to more than one misconception keeps its FIRST mapping (the
#                             author lists the likeliest error first, as the prompt asks); the others are dropped
NORMALISED = "PIPELINE NORMALISATION (not an author edit)"


def normalise_template(raw: dict, graph) -> tuple[dict, list[str]]:
    """The template with both normalisations applied, and what was done (empty: nothing to do)."""
    import copy
    out = copy.deepcopy(raw)
    done: list[str] = []
    ds = [d for d in out.get("diagnostics") or [] if isinstance(d, dict)]
    mcs = graph.misconceptions()
    allowed = graph.closure(out.get("lo_id"))
    owner = lambda mid: (mcs.get(mid) or {}).get("lo_id") or "lo:" + str(mid).split(":")[1]  # noqa: E731
    own = [d for d in ds if owner(d.get("misconception_id")) in allowed]
    foreign = [d for d in ds if d not in own]
    if foreign and own:
        ds = own
        done.append("drop-foreign-diagnostic: dropped " + ", ".join(
            f"{d['predicate']} → {d['misconception_id']} (on {owner(d['misconception_id'])})" for d in foreign)
            + f" — neither {out.get('lo_id')} nor a prerequisite of it (FR-1215)")
    seen, kept, dup = set(), [], []
    for d in ds:
        (dup if d.get("predicate") in seen else kept).append(d)
        seen.add(d.get("predicate"))
    if dup:
        ds = kept
        done.append("drop-duplicate-predicate: kept the first mapping of each predicate, dropped " + ", ".join(
            f"{d['predicate']} → {d['misconception_id']}" for d in dup))
    if done:
        out["diagnostics"] = ds
        stamp = f"{NORMALISED}: " + "; ".join(done) + "."
        out["notes"] = (out.get("notes") or "").rstrip() + ("\n\n" if out.get("notes") else "") + stamp
    return out, done


def merge_author_runs(files: list[Path]) -> dict:
    """Several author runs (widgets.workflow.js, mode author) as one, OLDEST FIRST: a lesson's record in a later
    run replaces its record in an earlier one WHOLE — templates and gaps together — so a re-authored lesson
    (`--only-lessons`) never keeps a stale template or a gap its new record closed. A lesson the author did not
    answer has no record, only an "unexamined" gap in the run's top-level list; it is a record of its own here."""
    by_lesson: dict[str, dict] = {}
    runs, book = [], None
    for f in files:
        run = json.loads(Path(f).read_text())
        if run.get("mode") != "author":
            raise ValueError(f"{f}: not an author run (mode {run.get('mode')!r})")
        if book and run.get("book") != book:
            raise ValueError(f"{f}: book {run.get('book')!r}, the other runs are {book!r}")
        book = run.get("book")
        mine = {r["lesson"]: {"lesson": r["lesson"], "templates": r.get("templates") or [],
                              "gaps": r.get("gaps") or [], "notes": r.get("notes", "")}
                for r in run.get("records") or []}
        for g in run.get("gaps") or []:   # a lesson with no record: its unexamined gap is its whole record
            lesson = _lesson_of(g.get("lo_id") or "")
            mine.setdefault(lesson, {"lesson": lesson, "templates": [], "gaps": [], "notes": ""})
            if g not in mine[lesson]["gaps"]:
                mine[lesson]["gaps"].append(g)
        for lesson, rec in mine.items():
            by_lesson[lesson] = dict(rec, source=Path(f).name, run_id=run.get("run_id"))
        runs.append({"file": Path(f).name, "run_id": run.get("run_id"), "prompts_version": run.get("prompts_version"),
                     "lessons": sorted(mine)})
    records = [by_lesson[k] for k in sorted(by_lesson)]
    return {"mode": "author", "book": book, "merged_from": runs,
            "rule": "oldest first; a lesson's record in a later run replaces its earlier one whole",
            "records": records, "gaps": [g for r in records for g in r["gaps"]]}


def write_templates(merged: dict, directory: Path) -> tuple[list[Path], list[str]]:
    """Each template of a merged author record to <directory>/<objective tail>--<slug>.json. Never overwrites or
    deletes: a file that differs, or a template file this merge does not hold, is reported and nothing is written."""
    want: dict[Path, str] = {}
    for r in merged["records"]:
        for t in r["templates"]:
            tail, slug = str(t.get("id", "")).split(":")[1:3] if str(t.get("id", "")).count(":") == 2 else ("", "")
            if not tail or not slug:
                return [], [f"template id {t.get('id')!r} is not wt:<objective tail>:<slug>"]
            path = Path(directory) / f"{tail}--{slug}.json"
            text = json.dumps(t, indent=1, ensure_ascii=False) + "\n"
            if path in want and want[path] != text:
                return [], [f"two templates would be written to {path.name}"]
            want[path] = text
    problems = [f"{p.name} exists and differs from the merged run's template — resolve it by hand"
                + (" (it carries a pipeline normalisation: re-apply --normalise-templates to the merged one)"
                   if NORMALISED in p.read_text() else "")
                for p, text in want.items() if p.exists() and p.read_text() != text]
    problems += [f"{p.name} is a template this merge does not hold (a superseded record?) — move it aside"
                 for p in sorted(Path(directory).glob("*.json")) if not p.name.startswith("_") and p not in want]
    if problems:
        return [], problems
    Path(directory).mkdir(parents=True, exist_ok=True)
    written = []
    for p, text in want.items():
        if not p.exists():
            p.write_text(text)
            written.append(p)
    return written, []


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
        n_fig = sum(len(q.get("figures") or []) for o in objs for q in o.get("anchor_questions") or [])
        refs.append({"lesson": lesson, "module": objs[0].get("module"), "module_label": objs[0].get("module_label"),
                     "lo_ids": [o["lo_id"] for o in objs], **({"figures": n_fig} if n_fig else {})})
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


def s5_widget_distractors(questions: list[dict], verified: set | None = None) -> list[dict]:
    """S7's predicate mappings for S5's final pass: every diagnostic of every question, or — once the blind
    verifier has run — of the verified templates only (`verified`, template ids)."""
    preds = W.contract()["kinds"]
    ds = [{"lo": q["lo_id"], "origin": "S7", "ref": f"{q['family']}#{d['predicate']}",
           "question_id": q["id"], "text": preds[q["choices"]["kind"]]["predicates"].get(d["predicate"], d["predicate"]),
           "misconception_id": d["misconception_id"]}
          for q in questions if verified is None or q["family"] in verified for d in q["choices"]["diagnostics"]]
    return list({(d["ref"], d["misconception_id"]): d for d in ds}.values())


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
    graph = _with_catalogue(PgGraph(args.dsn), args.catalogue)
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
    # With the blind verifier's verdicts (decision 47): a template counts only if accepted, and a mapping the
    # verifier did not confirm is HELD — out of `diagnostics`, so never shown, never a diagnosis and never S5
    # evidence — until a human keeps or drops it (--mapping-review). The gap report counts accepted templates.
    verified = None
    if args.verdicts:
        accepted_v, rejected_v, status = verdict_scan(templates, questions, args.verdicts)
        verified = {t["id"] for t in templates if t["id"] in accepted_v}
        try:
            reviews = load_mapping_reviews(args.mapping_review)
        except ValueError as e:
            print(f"--mapping-review: {e}", file=sys.stderr)
            return 2
        runs = sorted({json.loads(Path(f).read_text()).get("run_id") or Path(f).stem for f in args.verdicts})
        counts = hold_pending(questions, status, reviews, runs)
        hold_pending(s5_view, status, reviews, runs)
        print(f"verdicts: {len(verified)}/{len(templates)} template(s) accepted; mappings: {counts['active']} active, "
              f"{counts['held']} held for human review, {counts['kept_by_review']} kept and "
              f"{counts['dropped_by_review']} dropped by review (decision 47)")
        if args.pending_review:
            queue = pending_queue([q for q in questions if q["family"] in verified], graph, args.verdicts)
            args.pending_review.parent.mkdir(parents=True, exist_ok=True)
            args.pending_review.write_text(json.dumps(queue, indent=2, ensure_ascii=False) + "\n")
            print(f"wrote {args.pending_review} — {len(queue['items'])} held mapping(s) for the human review "
                  "(render_review_page.py --gate g3-mappings)")
    if args.s5_distractors:
        uniq = s5_widget_distractors(s5_view, verified)
        args.s5_distractors.parent.mkdir(parents=True, exist_ok=True)
        args.s5_distractors.write_text(json.dumps({"distractors": uniq}, indent=2, ensure_ascii=False) + "\n")
        print(f"wrote {args.s5_distractors} — {len(uniq)} predicate mapping(s) for S5"
              + ("" if verified is None else f", from the {len(verified)} verified template(s) only"))
    if args.gap_report:
        if not course:
            print("--gap-report needs --book or --course", file=sys.stderr)
            return 2
        previous = json.loads(args.gap_report.read_text()) if args.gap_report.exists() else None
        counted = questions if verified is None else [q for q in questions if q["family"] in verified]
        rep = gap_report(book.book if book else "?", course, graph, counted, args.gaps, previous)
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
        accepted, rejected = verified, rejected_v
        for tid, rs in rejected.items():
            print(f"  x {tid}: REJECTED — {'; '.join(rs[:3])}", file=sys.stderr)
        keep = [q for q in questions if q["family"] in accepted]
        bundle = {"generator": GENERATOR + " --templates", "question_type": "widget", "book": args.book,
                  "course_id": course, "templates": {t["id"]: t["_sha"] for t in templates if t["id"] in accepted},
                  "rejected_templates": rejected, "questions": keep, "misconceptions": [],
                  "mapping_review": {"rule": "decision 47", "verifier_runs": runs, "counts": counts,
                                     "reviews": sorted({v["file"] for v in reviews.values()})}}
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
    ap.add_argument("--catalogue", type=Path,
                    help="with --author-args/--verify-args: the S5 DRAFT run (or a catalogue) whose entries the "
                         "author may name and the verifier reads, before any catalogue is loaded (§3.2)")
    ap.add_argument("--lesson-runs", type=Path,
                    help="with --author-args: the lesson runs whose items name each anchor question's figure "
                         "images (default runs/<book>/lesson/)")
    ap.add_argument("--only-lessons", help="with --author-args: a comma-separated list of lessons (e.g. g10m8s3-2) — "
                                           "re-author only those; the packet holds nothing else")
    ap.add_argument("--merge-author-runs", type=Path, nargs="+", metavar="RUN",
                    help="author runs, OLDEST FIRST: a lesson's record in a later run replaces its earlier one whole. "
                         "Needs --merged (and takes --write-templates); no database")
    ap.add_argument("--merged", type=Path, help="with --merge-author-runs: the merged author record (pass it to --gaps)")
    ap.add_argument("--normalise-templates", type=Path, nargs="+", metavar="TEMPLATE",
                    help="apply the two pipeline normalisations of author errors to these template files, recorded "
                         "in their notes (needs --dsn; --catalogue for the S5 draft); --dry-run to preview")
    ap.add_argument("--dry-run", action="store_true", help="with --normalise-templates: write nothing")
    ap.add_argument("--write-templates", type=Path, metavar="DIR",
                    help="with --merge-author-runs: write each template to DIR (widgets/<book>/); never overwrites")
    ap.add_argument("--verify-args", type=Path, help="write args for widgets.workflow.js (mode verify)")
    ap.add_argument("--s5-distractors", type=Path, help="write S7's predicate mappings for S5's final pass")
    ap.add_argument("--pending-review", type=Path,
                    help="with --verdicts: write the held mappings (decision 47) as the review queue for "
                         "render_review_page.py --gate g3-mappings")
    ap.add_argument("--mapping-review", type=Path, nargs="*", default=[],
                    help="with --verdicts: the human verdicts on held mappings (the g3-mappings page's export): "
                         "keep → active, drop → gone")
    ap.add_argument("--by-ref", nargs="?", const="", default=None, metavar="DIR",
                    help="with --author-args or --verify-args: packet by reference (packet_ref.py) — the prompts' big "
                         "blocks to shard files in DIR (default work/<book>/packets/s7-<mode>/), compact args naming them")
    ap.add_argument("--pre-catalogue", action="store_true",
                    help="S7 before S5's final catalogue is loaded: every check except catalogue "
                         "existence; the prerequisite rule reads the objective from the mc: id; no --out")
    args = ap.parse_args()

    if args.merge_author_runs:   # files only: no graph is read, so no database
        if not args.merged:
            print("--merge-author-runs needs --merged OUT.json", file=sys.stderr)
            return 2
        try:
            merged = merge_author_runs(args.merge_author_runs)
        except (ValueError, KeyError, json.JSONDecodeError) as e:
            print(f"--merge-author-runs: {e}", file=sys.stderr)
            return 2
        args.merged.parent.mkdir(parents=True, exist_ok=True)
        args.merged.write_text(json.dumps(merged, indent=2, ensure_ascii=False) + "\n")
        by_src = {}
        for r in merged["records"]:
            by_src.setdefault(r["source"], []).append(r["lesson"])
        print(f"wrote {args.merged} — {len(merged['records'])} lesson record(s), "
              f"{sum(len(r['templates']) for r in merged['records'])} template(s), {len(merged['gaps'])} gap(s); "
              + "; ".join(f"{k}: {', '.join(v)}" for k, v in by_src.items()))
        if args.write_templates:
            written, problems = write_templates(merged, args.write_templates)
            for x in problems:
                print(f"  x {x}", file=sys.stderr)
            if problems:
                return 1
            print(f"wrote {len(written)} template file(s) to {args.write_templates}")
        return 0

    if not args.dsn:
        # The checks that matter most need the graph; skipping them silently was
        # finding G5 in the pipeline audit. No DSN, no bundle.
        print("REFUSING: --dsn (or AINEXT_DB_DSN) is required — the prerequisite rule (FR-1215) and the "
              "misconception catalogue are checked against the graph, never skipped.", file=sys.stderr)
        return 2
    if args.normalise_templates:
        graph = _with_catalogue(PgGraph(args.dsn), args.catalogue)
        for f in args.normalise_templates:
            out, done = normalise_template(json.loads(Path(f).read_text()), graph)
            print(f"{Path(f).name}: " + ("; ".join(done) if done else "nothing to normalise"))
            if done and not args.dry_run:
                Path(f).write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
        return 0
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
        import assemble_misconceptions as am
        runs_dir = args.lesson_runs or Path(__file__).resolve().parent / "runs" / book.book / "lesson"
        figs = am.figures_by_question([json.loads(p.read_text()) for p in sorted(runs_dir.glob("*.json"))])
        a = author_args(book, _with_catalogue(PgGraph(args.dsn), args.catalogue), args.course or book.course_id, figs)
        if args.only_lessons:
            try:
                a = only_lessons(a, args.only_lessons.split(","))
            except ValueError as e:
                print(f"--only-lessons: {e}", file=sys.stderr)
                return 2
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
