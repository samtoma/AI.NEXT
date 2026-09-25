"""Generate WIDGET questions — constructions, bound to objectives (ADR-0009).

    uv run generate_widget_questions.py --out seed/widget-questions-v1.json [--dsn ...]

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


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--dsn", default=os.environ.get("AINEXT_DB_DSN"),
                    help="if given, diagnostics are checked against the real "
                         "misconception catalogue and the real prerequisite graph")
    args = ap.parse_args()

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
