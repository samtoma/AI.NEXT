"""Figure-gap inventory: every figure reference in a book, typed, and each type mapped to a kind
that can draw it or to the native kind that must be built (Samuel's answer 5, 2026-09-25).
Deterministic, no model.

    uv run --project services/extraction services/extraction/figure_inventory.py --book g10-math
    uv run --project services/extraction services/extraction/figure_inventory.py --book g10-math --check

Exit code: 0 every check holds, 1 a check failed (the files are still written, so the failure
can be read), 2 an input is missing.

WHY. Answer 5: a figure no existing visual type can draw gets a NATIVE figure or widget type
built for it, never a static book image. Building those types needs a spec that says which
figures exist, how many, where, and what each one would take to draw. This is that spec. It is
also the §3.7 "viz gap" list before S2 runs: a figure the kinds cannot express is a named gap,
not something forced into the nearest kind.

WHAT IT READS (all under the book's work dir, made by source_adapter.py, plus the contracts):
    work/<book>/blocks.jsonl         the EPUB as typed blocks; figures are ⟦fig:<src>⟧ references
    work/<book>/figures.json         each unique figure image: references, contexts, pages, file
    work/<book>/figures/             the images themselves (PyMuPDF reads them for statistics)
    work/<book>/maths/recovered.json OPTIONAL. S0b's hash-accepted LaTeX: an equation image named
                                     md5(LaTeX) whose LaTeX was found by hashing candidates, so it
                                     is exact. Where present, "y=\\frac{2}{x}" beside a graph is
                                     evidence; where absent the maths is an opaque "M".
    the manifest (book config)       chapters, sections and lessons, for the per-lesson address
    VIZ_SPEC.md, contracts/widget-predicates.json   the kinds that exist today
    coverage/<book>.widget-gaps.json the widget kinds Samuel approved (answer 6), reused by name

WHAT IT WRITES:
    coverage/<book>.figure-gaps.json   format ainext.figure-gaps/1 (below)
    coverage/<book>.figure-gaps.md     the same, as a short page for a human
Both are byte-identical for identical inputs: no timestamps, sorted keys where order is free.
`--check` computes and prints and writes nothing.

HOW A FIGURE IS TYPED. One reference (a figure at one place in the book) gets exactly one type.
The rules run in a fixed order and the first that fires wins; every row records the rule and the
words it matched, so a reader can audit it and disagree with it. The figure's OWN words are read
in layers, nearest first: the caption; the words between it and the next figure either side; the
rest of its part (problem, solution, worked step); the related part (a problem's solution, the
questions under a header); the question's stem; the exercise's header.
    1. not a teaching figure: a JPEG photo, a raster image in prose, a chapter-opener caption
       ("Figure 6.1: …"), an icon no bigger than a letter
    2. a name that settles the type anywhere: Venn, box-and-whisker, histogram, ogive
    3. the chapter's DOMAIN (read from its title: functions, trigonometry, Euclidean geometry, …)
       says which types are possible, and its STRONG words in the figure's own text choose one
       ("parallelogram", "number line", "prism"). In the function chapter the section's family
       (6.2–6.6) is applied before any words, because each section teaches one family and its
       prose ("the line y = x", an asymptote "y = 2") would read as a second
    4. the section title's prior ("5.8 Defining ratios in the Cartesian plane")
    5. the domain's WEAK words ("angle", "triangle", "area"): they fit a type but do not name it
    6. a figure with no words takes the type its question's siblings got from their words
    7. the neighbouring blocks; then the picture (a wide strip is a number line; two long lines
       that cross inside each other are axes); then the chapter's prior where the chapter IS one
       kind of figure (trigonometry, analytical geometry, patterns, probability)
    8. otherwise UNKNOWN. Never forced.

THE AUDIT. `AUDIT_EYE` below holds the true type of every picture in two seeded random samples,
recorded by eye (the data-engineer agent, 2026-09-26). Sample A was checked first and the rules
were tuned on its misses; sample B was drawn afterwards and is the independent measure. Both
first-check results are kept as history, and every run re-scores both samples with the current
rules, so a rule change that breaks an audited figure shows in the number.

FORMAT ainext.figure-gaps/1:
    book, course_id, inputs {name: sha256}, counts (the reference equality and its parts),
    types {type: {label, teaching, count_book, count_solution, unique_images, chapters,
                  covered_by | gap, examples}},
    chapters [per chapter: book, solution, by_type],
    figures [one row per reference, in reading order],
    summary {missing (gap types by count), covered, not_teaching, unknown, by_proposed_kind},
    checks {name: {pass, …}},
    audit {independent_accuracy, checked, right, accuracy, samples [{first_check, now, wrong}]}
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import random
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent            # services/extraction
REPO = HERE.parents[1]
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

FORMAT = "ainext.figure-gaps/1"
VIZ_SPEC = HERE / "VIZ_SPEC.md"
WIDGET_CONTRACT = REPO / "contracts" / "widget-predicates.json"
SOLUTION = "exercise_solution"      # the only context the printed book does not carry


# ============================================================================ the type catalogue
# Every type a reference can take. `covered_by` names kinds that exist today and draw the figure
# faithfully; `limits` says honestly where they fall short. `gap` names the native kind to build
# (answer 5) and, where one fits, the widget kind Samuel approved in answer 6 (widget-gaps.json).
# Sizes: S = days, one renderer change; M = a new renderer or a contract change to a live kind;
# L = a new interactive with its own geometry; L+ = L plus 3-D.
GEOMETRY_DIAGRAM = "geometry_diagram"
FUNCTION_GRAPH_EXT = "function_graph (extended)"

TYPES: dict[str, dict] = {
    # ---- covered today
    "number_line": {
        "label": "Number line, interval or inequality on a line",
        "covered_by": {"viz": ["number_line"], "widget": ["number_line_marker"]}},
    "cartesian_points": {
        "label": "Points, segments and polygons on the Cartesian plane",
        "covered_by": {"viz": ["coordinate_plot"], "widget": ["pair_plotter", "line_drawer"]}},
    "straight_line_graph": {
        "label": "Straight-line graph(s)",
        "covered_by": {"viz": ["function_graph", "coordinate_plot"], "widget": ["line_drawer"]},
        "limits": "function_graph draws one line; two or more lines on one set of axes "
                  "(simultaneous equations) are drawn as coordinate_plot segments."},
    "parabola_graph": {
        "label": "Parabola y = ax² + q",
        "covered_by": {"viz": ["function_graph"], "widget": ["curve_sketcher"]}},
    "right_triangle_trig": {
        "label": "One right-angled triangle for a trigonometric ratio",
        "covered_by": {"viz": ["trig_triangle"], "widget": ["triangle_ratio"]},
        "limits": "trig_triangle draws ONE right triangle and its angleDeg is 30|45|60|θ: a printed "
                  "17° is drawn as θ with the value in the caption. A real-world backdrop "
                  "(building, ladder, escalator) is not drawn."},
    "circle_diagram": {
        "label": "Circle with centre and radius (area, circumference)",
        "covered_by": {"viz": ["geo_scene"], "widget": ["circle_builder"]}},
    "mapping_diagram": {
        "label": "Mapping diagram / function machine (inputs to outputs)",
        "covered_by": {"viz": ["arrow_map"], "widget": []},
        "limits": "A function machine's rule box becomes the caption."},
    "sample_space_diagram": {
        "label": "Sample space: outcome grid, dice or coin outcomes",
        "covered_by": {"viz": ["product_grid"], "widget": ["sample_space"]},
        "limits": "Dice faces and coins are drawn as labels, not pictures."},
    "dot_plot": {
        "label": "Dot plot of a data set",
        "covered_by": {"viz": ["stat_chart"], "widget": []},
        "limits": "stat_chart type \"dots\"."},
    "line_chart": {
        "label": "Line chart of data (relative frequency against trials)",
        "covered_by": {"viz": ["coordinate_plot"], "widget": []},
        "limits": "Drawn as points joined by segments, with a dashed reference line as a segment."},
    # ---- gaps: native kinds to build
    "hyperbola_graph": {
        "label": "Hyperbola y = a/x + q",
        "gap": {"proposed_kind": FUNCTION_GRAPH_EXT + ": fn \"hyperbola\"",
                "widget": "curve_sketcher (extended)", "size": "M",
                "why": "function_graph draws linear and quadratic only; a hyperbola is two "
                       "branches either side of dashed asymptotes, sampled so it never joins "
                       "across x = 0."}},
    "exponential_graph": {
        "label": "Exponential graph y = ab^x + q",
        "gap": {"proposed_kind": FUNCTION_GRAPH_EXT + ": fn \"exponential\"",
                "widget": "curve_sketcher (extended)", "size": "S",
                "why": "One more fn value on the hyperbola's sampler and asymptote: one branch, "
                       "one horizontal asymptote."}},
    "trig_graph": {
        "label": "Sine, cosine or tangent graph over 0°–360°",
        "gap": {"proposed_kind": FUNCTION_GRAPH_EXT + ": fn \"sin\" | \"cos\" | \"tan\"",
                "widget": "curve_sketcher (extended)", "size": "M",
                "why": "A degree axis 0°–360° with 90° ticks, amplitude and period, and tan's "
                       "vertical asymptotes; none of this exists in function_graph."}},
    "multi_function_graph": {
        "label": "Two or more curves on one set of axes (intersections, match-the-graph)",
        "gap": {"proposed_kind": FUNCTION_GRAPH_EXT + ": curves[] on shared axes",
                "widget": "curve_sketcher (extended)", "size": "M",
                "why": "function_graph takes one fn; these figures need several labelled curves, "
                       "possibly of different families, with their intersection points marked."}},
    "cartesian_trig_angle": {
        "label": "Angle in standard position on the Cartesian plane (5.8)",
        "gap": {"proposed_kind": "coordinate_plot (extended): angle arc from +x axis, "
                                 "reference triangle, quadrant labels",
                "widget": None, "size": "S",
                "why": "coordinate_plot has points and segments but no angle arc from the positive "
                       "x-axis, no dashed drop to the axis and no quadrant (CAST) labels."}},
    "lines_and_angles": {
        "label": "Lines and angles: parallel lines, transversals, angle pairs",
        "gap": {"proposed_kind": GEOMETRY_DIAGRAM, "widget": None, "size": "M",
                "why": "geo_scene is circle-centred and has no parallel arrows or equal-angle "
                       "marks; a transversal figure is all parallel arrows and angle arcs."}},
    "triangle_geometry": {
        "label": "Triangle geometry: classification, congruency, similarity, Pythagoras",
        "gap": {"proposed_kind": GEOMETRY_DIAGRAM, "widget": "polygon_builder", "size": "M",
                "why": "geo_scene can place segments and angles but not equal-length ticks, "
                       "right-angle squares or dashed construction lines, which carry the "
                       "argument in a congruency or similarity figure."}},
    "quadrilateral_geometry": {
        "label": "Quadrilaterals and polygons: properties, proofs, naming",
        "gap": {"proposed_kind": GEOMETRY_DIAGRAM, "widget": "polygon_builder", "size": "M",
                "why": "Needs parallel arrows, equal-side ticks, diagonals and numbered angles; "
                       "none is in geo_scene."}},
    "midpoint_theorem": {
        "label": "Mid-point theorem figures",
        "gap": {"proposed_kind": GEOMETRY_DIAGRAM, "widget": "polygon_builder (mid-point mode)",
                "size": "M",
                "why": "A triangle with its mid-points marked by ticks and the joining segment "
                       "marked parallel: the same marks geometry_diagram adds."}},
    "trig_composite_diagram": {
        "label": "Trigonometry on a composite figure (two triangles, rhombus, trapezium)",
        "gap": {"proposed_kind": GEOMETRY_DIAGRAM, "widget": None, "size": "M",
                "why": "trig_triangle draws one right triangle; these share sides between "
                       "triangles or sit inside a quadrilateral."}},
    "plane_shape_measure": {
        "label": "Plane shape with labelled dimensions (area, perimeter)",
        "gap": {"proposed_kind": GEOMETRY_DIAGRAM + " (dimension labels)",
                "widget": "polygon_builder (area mode)", "size": "M",
                "why": "Dimension labels on sides and a dashed perpendicular height; no kind "
                       "draws a labelled polygon today."}},
    "solid_3d": {
        "label": "3-D solid: prism, cylinder, pyramid, cone, sphere",
        "gap": {"proposed_kind": "solid_3d", "widget": "solid_scaler", "size": "L+",
                "why": "No kind draws in 3-D: an oblique projection with hidden edges dashed, "
                       "labelled dimensions, on iPad Safari with keyboard operation."}},
    "solid_net": {
        "label": "Net of a solid (the solid unfolded)",
        "gap": {"proposed_kind": "solid_3d (net mode)", "widget": "solid_scaler", "size": "M",
                "why": "A net is flat faces laid out edge to edge; it shares the solid's model, "
                       "and the fold animation is what makes it teach."}},
    "venn_diagram": {
        "label": "Venn diagram of sets or events",
        "gap": {"proposed_kind": "venn", "widget": "venn_builder", "size": "M",
                "why": "Two or three overlapping sets in a sample-space frame, with counts or "
                       "elements per region and a shaded region; no kind draws sets."}},
    "histogram": {
        "label": "Histogram of grouped data",
        "gap": {"proposed_kind": "stat_chart (extended): type \"histogram\"", "widget": None,
                "size": "S",
                "why": "stat_chart's bars have gaps and categorical labels; a histogram is "
                       "contiguous bars over class intervals on a numeric axis."}},
    "ogive": {
        "label": "Ogive or frequency polygon",
        "gap": {"proposed_kind": "stat_chart (extended): type \"ogive\"", "widget": None,
                "size": "S", "why": "A cumulative-frequency curve over class boundaries."}},
    "box_plot": {
        "label": "Box-and-whisker plot",
        "gap": {"proposed_kind": "box_plot", "widget": "box_plot_builder", "size": "S",
                "why": "Five markers on a number line joined as box and whiskers; small, but "
                       "no kind has it."}},
    "pattern_sequence": {
        "label": "Picture pattern growing term by term (matchsticks, tiles, dots)",
        "gap": {"proposed_kind": "pattern_strip", "widget": None, "size": "M",
                "why": "A motif repeated by a growth rule, term 1, 2, 3, …; nothing draws a "
                       "picture sequence, and a generated one must match the rule exactly."}},
    "annotated_expression": {
        "label": "Expression with labelled arrows (expanding, base and exponent)",
        "gap": {"proposed_kind": "annotated_expression", "widget": None, "size": "S",
                "why": "Typeset maths with curved arrows and labels pointing at its parts."}},
    # ---- not teaching figures
    "photo_decoration": {"label": "Photograph or decoration (chapter opener, history)",
                         "teaching": False},
    "inline_symbol": {"label": "Icon standing in for a word (a die face inside a sentence)",
                      "teaching": False},
    # ---- unresolved
    "unknown": {"label": "No rule fired"},
}
NOT_TEACHING = {t for t, v in TYPES.items() if v.get("teaching") is False}


# ============================================================================ helpers
def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha256_file(p: Path) -> str:
    return sha256_bytes(p.read_bytes())


def rel(p: Path) -> str:
    try:
        return str(p.resolve().relative_to(REPO))
    except ValueError:
        return str(p)


FIG_TOKEN = re.compile(r"⟦fig:([^⟧]+)⟧")
MATH_TOKEN = re.compile(r"⟦m:([0-9a-f]{32})⟧")


def plain(text: str | None, latex: dict) -> str:
    """Lower-case text with maths as its LaTeX (⟨…⟩) where S0b recovered it, else "M"."""
    if not text:
        return ""
    t = MATH_TOKEN.sub(lambda m: f" ⟨{latex[m.group(1)]}⟩ " if m.group(1) in latex else " M ", text)
    t = FIG_TOKEN.sub(" ", t)
    return re.sub(r"\s+", " ", t).strip().lower()


def around(text: str, src: str, nth: int, latex: dict) -> tuple[str, str]:
    """The words between this reference and its neighbouring references in the same text: in a
    table row "Circle ⟦fig⟧" that is the row's name, not the previous row's."""
    if not text:
        return "", ""
    toks = list(FIG_TOKEN.finditer(text))
    mine = [i for i, m in enumerate(toks) if m.group(1) == src]
    if not mine:
        return "", ""
    i = mine[min(nth, len(mine) - 1)]
    start = toks[i - 1].end() if i > 0 else 0
    end = toks[i + 1].start() if i + 1 < len(toks) else len(text)
    return plain(text[start:toks[i].start()], latex)[-300:], plain(text[toks[i].end():end], latex)[:200]


# ============================================================================ image statistics
def image_stats(path: Path) -> dict:
    """Cheap, deterministic picture facts (PyMuPDF only): size, ink, the longest straight runs.

    Only a tie-breaker. Runs are measured on the full-resolution ink mask with byte operations,
    so a 960-image book takes seconds: `ink` is 1 where a pixel is dark and opaque."""
    try:
        import pymupdf as fitz
    except ImportError:                                  # older PyMuPDF
        import fitz  # type: ignore
    fitz.TOOLS.mupdf_display_errors(False)
    pix = fitz.Pixmap(str(path))
    w, h = pix.width, pix.height
    n = pix.n
    dark = bytes(1 if v < 160 else 0 for v in range(256))
    opaque = bytes(1 if v >= 128 else 0 for v in range(256))
    gray = pix if n - (1 if pix.alpha else 0) == 1 else fitz.Pixmap(fitz.csGRAY, pix)
    ink = gray.samples[0::gray.n].translate(dark)
    if pix.alpha:          # a transparent pixel is paper, whatever colour it stores
        a = pix.samples[n - 1::n].translate(opaque)
        ink = (int.from_bytes(ink, "big") & int.from_bytes(a, "big")).to_bytes(w * h, "big")
    total_ink = ink.count(1)

    run = re.compile(b"\x01+")

    def longest(line: bytes) -> tuple[int, int]:
        """(length, start) of the longest run of ink; the first one on a tie."""
        best = (0, 0)
        for m in run.finditer(line):
            if m.end() - m.start() > best[0]:
                best = (m.end() - m.start(), m.start())
        return best

    row_runs = [longest(ink[y * w:(y + 1) * w]) for y in range(h)]
    col_runs = [longest(ink[x::w]) for x in range(w)]
    rows = [r[0] for r in row_runs]
    cols = [c[0] for c in col_runs]

    def lines(runs: list[int], full: int) -> int:
        """Distinct long lines: neighbouring rows of one thick line count once."""
        k, prev = 0, False
        for r in runs:
            on = r >= 0.5 * full
            if on and not prev:
                k += 1
            prev = on
        return k

    hy = max(range(h), key=lambda y: (rows[y], -y)) if h else 0
    vx = max(range(w), key=lambda x: (cols[x], -x)) if w else 0
    # do the two longest lines CROSS, each well inside the other? Axes do; the legs of a right
    # triangle meet at an end of each, however central the corner sits in the picture.
    hx0, vy0 = row_runs[hy][1] if h else 0, col_runs[vx][1] if w else 0
    cross = (h > 0 and w > 0
             and hx0 + 0.15 * rows[hy] <= vx <= hx0 + 0.85 * rows[hy]
             and vy0 + 0.15 * cols[vx] <= hy <= vy0 + 0.85 * cols[vx])
    return {
        "w": w, "h": h, "aspect": round(w / h, 3) if h else 0.0,
        "ink": round(total_ink / (w * h), 4) if w * h else 0.0,
        "hrun": round(rows[hy] / w, 3) if w else 0.0, "hrow": round(hy / h, 3) if h else 0.0,
        "vrun": round(cols[vx] / h, 3) if h else 0.0, "vcol": round(vx / w, 3) if w else 0.0,
        "hlines": lines(rows, w), "vlines": lines(cols, h), "cross": cross,
    }


def stat_flags(st: dict | None) -> dict:
    if not st:
        return {"wide": False, "axes": False}
    return {
        # a number line or a dot plot is a strip at least 3.5 times wider than tall
        "wide": st["aspect"] >= 3.5 and st["hlines"] <= 3,
        # a long horizontal and a long vertical line that cross, each well inside the other:
        # axes. A right triangle's legs are as long, but they meet at their ends.
        "axes": st["hrun"] >= 0.6 and st["vrun"] >= 0.6 and st["cross"],
    }


# ============================================================================ words
def rx(*alts: str) -> re.Pattern:
    return re.compile("|".join(alts))


KW = {
    "venn": rx(r"\bvenn\b"),
    "box_plot": rx(r"box[- ]and[- ]whiskers?", r"\bbox plots?\b", r"five[- ]number summary"),
    "histogram": rx(r"\bhistograms?\b"),
    "ogive": rx(r"\bogives?\b", r"frequency polygon", r"cumulative frequenc"),
    "number_line": rx(r"number line", r"interval notation"),
    "net": rx(r"\bnets?\b", r"\bunfold", r"opened out"),
    "solid": rx(r"\bprisms?\b", r"\bcylinders?\b", r"\bpyramids?\b", r"\bcones?\b", r"\bspheres?\b",
                r"\bcubes?\b", r"tetrahedron", r"\bsolids?\b", r"hemispher", r"cuboid",
                r"\bcontainer\b", r"\breceptacle\b", r"ice-cream", r"\breservoir\b",
                r"surface area", r"\bvolume\b"),
    "circle": rx(r"\bcircles?\b", r"\bradius\b", r"\bdiameter\b", r"circumference"),
    "sample_space": rx(r"sample space", r"\bdice\b", r"\bdie\b", r"\bcoins?\b", r"\boutcomes?\b",
                       r"playing cards", r"\bspinner"),
    "mapping": rx(r"mapping diagram", r"function machine"),
    "plot_points": rx(r"plot the following points"),
    "pattern": rx(r"\bpatterns?\b", r"\bmatch(es|sticks?)\b", r"\bsequences?\b", r"\bterms?\b",
                  r"\bblocks\b", r"\btiles\b", r"figure number"),
    "midpoint": rx(r"mid-?points?\b", r"bisect (their|its|the) (respective )?sides"),
    "naming": rx(r"naming convention"),
    "quad": rx(r"parallelograms?", r"rectangles?\b", r"rhombus", r"\bsquares?\b", r"trapezi",
               r"\bkites?\b", r"quadrilateral", r"polygon", r"pentagon", r"hexagon"),
    # the words that make a triangle figure a congruency / similarity / Pythagoras figure
    "triangle_strong": rx(r"isosceles", r"equilateral", r"scalene", r"congruen", r"\bsimilar\b",
                          r"pythagoras", r"hypotenuse", r"\bproportion"),
    # no word boundary after "triangle": the LaTeX \triangle ABC arrives as "\triangleabc"
    "triangle": rx(r"triangle"),
    "lines_strong": rx(r"transversal", r"corresponding angles", r"alternate",
                       r"co-interior", r"vertically opposite", r"angles on a straight line",
                       r"revolution", r"\breflex", r"\bacute angle", r"\bobtuse angle", r"[fzc] shape"),
    # "name the parallel lines" is asked of mid-point figures too
    "lines_weak": rx(r"parallel lines", r"\bangles?\b", r"\bparallel\b"),
    "trig": rx(r"\bsin\b", r"\bcos\b", r"\btan\b", r"\\sin", r"\\cos", r"\\tan",
               r"trigonometr", r"elevation", r"depression", r"\bopposite\b", r"\badjacent\b",
               r"hypotenuse", r"right-angled", r"\bsine\b", r"\bcosine\b", r"\btangent\b",
               r"\\theta"),
    # a trigonometry figure that is more than one right triangle. No "kite": in chapter 11 a
    # kite is the toy on a string, and its figure is one right triangle.
    "composite": rx(r"parallelograms?", r"rectangles?\b", r"rhombus", r"trapezi", r"quadrilateral",
                    r"\bdiagonals?\b", r"two triangles", r"both triangles", r"perpendicular (line|height)"),
    "cartesian": rx(r"cartesian", r"\bx-axis", r"\by-axis", r"-axis\b", r"\borigin\b",
                    r"quadrant", r"co-?ordinates?\b",
                    r"\(\s*-?[\w.,\\{} ]{1,12};\s*-?[\w.,\\{} ]{1,12}\)"),
    "area": rx(r"\barea\b", r"\bperimeter\b"),
    "graph": rx(r"\bgraphs?\b", r"\bgraphically\b", r"\bcurve\b", r"\bsketch(ed)? the"),
    "dot_plot": rx(r"dot plot", r"each (circle|dot) represents"),
    "percentile": rx(r"percentile", r"\brank\b"),
    "quartile": rx(r"quartile"),
    "relfreq": rx(r"relative frequenc", r"\btrials\b"),
    "similar": rx(r"\bsimilar\b", r"similarity"),
    # several curves on one set of axes: each phrase means at least two graphs are drawn
    "multi": rx(r"points? of intersection", r"graphs intersect", r"same (set of )?axes",
                r"graphs of .{1,60}? and ", r"functions .{1,60}? and .{1,60}?(are|is) (sketched|shown|drawn|given)",
                r"\bare sketched\b", r"two (graphs|parabolas|functions|curves|hyperbolas)",
                r"identify a function that matches", r"corresponding graph", r"graph below shows functions",
                r"\bboth graphs\b", r"(plot|sketch|draw) the graphs:", r"the second function"),
}

# the graph families: words, then LaTeX. A horizontal or vertical line (y = 2, x = 0) is an
# asymptote or an axis far more often than a graph, so it is not a family.
FAMILY_WORDS = {
    "line": rx(r"straight line graph", r"straight-line graph", r"\blinear function", r"\bgradient\b",
               r"join with a straight line", r"system of equations", r"simultaneous"),
    "parabola": rx(r"parabola", r"\bquadratic", r"turning point", r"\bsmile\b", r"\bfrown\b"),
    "hyperbola": rx(r"hyperbol", r"first and third quadrants?", r"second and fourth quadrants?"),
    "exponential": rx(r"exponential", r"compound interest", r"curves (up|down)wards"),
    # in the functions chapter θ is the variable of the trigonometric functions only; "time
    # period" (finance) is not a period of a graph
    "trig": rx(r"amplitude", r"(?<!time )\bperiod\b", r"trigonometric (graph|function)",
               r"sine (graph|function|curve)", r"cosine (graph|function|curve)",
               r"tangent (graph|function|curve)", r"\\theta"),
}
LATEX_EQ = re.compile(r"⟨([^⟩]*=[^⟩]*)⟩")


def latex_family(eq: str) -> str | None:
    """The family of one equation, or None when it is not the equation of a graph."""
    e = eq.replace(" ", "").replace("\\left", "").replace("\\right", "").replace("\\dfrac", "\\frac")
    e = re.sub(r"\{x\}(?=\^)", "x", e)                   # {x}^{2} → x^{2}; \frac{3}{x} stays
    lhs, _, rhs = e.partition("=")
    if re.search(r"\\(sin|cos|tan)", e):
        return "trig"
    if not (re.fullmatch(r"(y|[fghp]\(x\)|\d*y)", lhs) or "y" in rhs):
        return None
    body = rhs if re.fullmatch(r"(y|[fghp]\(x\))", lhs) else e
    if re.search(r"\^\{?\(?-?\(?x", body):
        return "exponential"
    if re.search(r"\\frac\{[^{}]*\}\{\(?x[^{}]*\}", body) or re.search(r"/x", body) or lhs == "xy":
        return "hyperbola"
    if re.search(r"x\^\{?2\}?", body):
        return "parabola"
    if re.search(r"(?<![a-z\\])x(?![a-z])", body):
        return "line"
    return None


def families(text: str) -> list[tuple[str, str]]:
    """(family, the words or LaTeX that showed it), in a fixed order."""
    out = []
    for fam, pat in FAMILY_WORDS.items():
        m = pat.search(text)
        if m:
            out.append((fam, m.group(0)))
    for m in LATEX_EQ.finditer(text):
        f = latex_family(m.group(1))
        if f and f not in [x for x, _ in out]:
            out.append((f, m.group(1)))
    return out


# ============================================================================ the book, as references
def domain_of(chapter_title: str) -> str:
    t = chapter_title.lower()
    for key, pat in (("analytic", r"analytical geometry"), ("euclid", r"euclidean|geometry"),
                     ("functions", r"function"), ("trig", r"trigonometr"),
                     ("stats", r"statistic"), ("probability", r"probabilit"),
                     ("measurement", r"measurement"), ("patterns", r"pattern|sequence"),
                     ("equations", r"equation|inequalit"), ("finance", r"finance|growth|interest"),
                     ("algebra", r"algebra|exponent|expression|number")):
        if re.search(pat, t):
            return key
    return "general"


def load_inputs(work: Path, manifest_path: Path, latex_path: Path | None = None) -> dict:
    blocks = [json.loads(l) for l in (work / "blocks.jsonl").read_text().splitlines() if l.strip()]
    figs = json.loads((work / "figures.json").read_text())
    manifest = json.loads(manifest_path.read_text())
    lp = latex_path if latex_path is not None else work / "maths" / "recovered.json"
    latex = {}
    if lp and lp.exists():
        latex = {h: v["latex"] for h, v in json.loads(lp.read_text()).get("accepted", {}).items()}
    return {"blocks": blocks, "figures": figs, "manifest": manifest, "latex": latex,
            "latex_path": lp if lp and lp.exists() else None}


def parts_of(b: dict) -> list[tuple[str, dict]]:
    """The block's nested texts in document order: (role, {text, figures})."""
    if b["type"] == "worked_example":
        out = []
        if b.get("question"):
            out.append(("we_question", b["question"]))
        for s in b.get("steps") or []:
            out.append(("we_step", {"text": ((s.get("title") or "") + " " + (s.get("text") or "")),
                                    "figures": s.get("figures", [])}))
        if b.get("loose_solution"):
            out.append(("we_loose", b["loose_solution"]))
        return out
    if b["type"] == "exercise_item":
        return [(r, b[r]) for r in ("problem", "solution") if b.get(r)]
    return []


def lesson_resolver(manifest: dict):
    """Address every block by lesson: a section's one lesson, or for a split section the part whose
    anchor (sub-heading code, worked example, exercise set) came last in reading order."""
    by_chapter = {}
    for mod in manifest["modules"]:
        secs = collections.defaultdict(list)
        for l in mod["lessons"]:
            for s in (l.get("sections_merged") or [l["section"]]):
                secs[s].append(l)
        units = {}
        for key in ("introduction", "chapter_summary"):
            if mod.get(key):
                units[mod[key]["section"]] = key
        by_chapter[mod["chapter"]] = {"module": mod["id"], "title": mod["title"], "secs": secs,
                                      "units": units}
    current: dict[str, str] = {}

    def resolve(b: dict) -> tuple[str | None, str | None]:
        ch = by_chapter.get(b["chapter"])
        if ch is None:
            return None, "not in the manifest"
        cands = ch["secs"].get(b["section"], [])
        if not cands:
            return None, ch["units"].get(b["section"], "section not a lesson")
        if len(cands) == 1:
            return cands[0]["id"], None
        ex = b.get("exercise")
        for l in cands:
            codes = {s.get("code") for s in l["subheadings"] if s.get("code")}
            wes = {w["n"] for w in l["worked_examples"]}
            exs = {e["label"] for e in l["exercises"]}
            if ((b["type"] == "heading" and b.get("code") in codes)
                    or (b["type"] == "worked_example" and b.get("n") in wes)
                    or (ex and ex in exs)):
                current[b["section"]] = l["id"]
        if ex and not any(ex in {e["label"] for e in l["exercises"]} for l in cands):
            return None, f"exercise {ex} closes the split section; S1 maps its items"
        return current.get(b["section"], cands[0]["id"]), None

    return resolve, by_chapter


def build_refs(inp: dict, image_dir: Path | None) -> list[dict]:
    blocks, figs, latex = inp["blocks"], inp["figures"], inp["latex"]
    resolve, chapters = lesson_resolver(inp["manifest"])
    sec_title, sub_title = {}, {}
    cur_sub = None
    for b in blocks:                       # section and sub-heading titles as the reader meets them
        if b["type"] == "heading":
            if b.get("level") == 2:
                sec_title[b["section"]] = b.get("title") or ""
                cur_sub = None
            elif b.get("level") == 3:
                cur_sub = b.get("title") or ""
        sub_title[b["id"]] = cur_sub
    stats_cache: dict[str, dict | None] = {}
    refs = []
    for i, b in enumerate(blocks):
        lesson, unit = resolve(b)
        if not b.get("figures"):
            continue
        parts = parts_of(b)
        seen = collections.Counter()
        consumed = collections.Counter()
        for pos, f in enumerate(b["figures"]):
            src = f["src"]
            nth = seen[src]
            seen[src] += 1
            # which nested part holds this occurrence (document order, occurrences consumed)
            role, part = None, None
            k = consumed[src]
            for r, p in parts:
                cnt = sum(1 for x in p.get("figures", []) if x["src"] == src)
                if k < cnt:
                    role, part = r, p
                    break
                k -= cnt
            consumed[src] += 1
            text_holder = part["text"] if part else b.get("text", "")
            before, after = around(text_holder, src, k if part else nth, latex)
            own = plain(text_holder, latex)
            related = []
            if b["type"] == "exercise_item":
                other = "solution" if f["context"] != SOLUTION else "problem"
                related.append(plain((b.get(other) or {}).get("text"), latex))
            elif b["type"] == "worked_example":
                related.append(plain(b.get("title"), latex))
                related += [plain(p.get("text"), latex) for r, p in parts if p is not part]
            elif b["type"] == "exercise_header":
                # a header's figure is asked about in the items under it
                for nb in blocks[i + 1:]:
                    if nb.get("exercise") != b.get("exercise") or nb.get("q") != b.get("q") \
                            or nb["type"] != "exercise_item":
                        break
                    related.append(plain((nb.get("problem") or {}).get("text"), latex))
            stem, ex_header = [], []
            if b["type"] in ("exercise_item", "exercise_header") and b.get("exercise"):
                for pb in reversed(blocks[max(0, i - 80):i]):
                    if pb.get("exercise") != b["exercise"]:
                        break
                    if pb["type"] == "exercise_header":
                        if pb.get("q") is None:
                            ex_header.append(plain(pb.get("text"), latex))
                            break
                        if pb.get("q") == b.get("q"):
                            stem.append(plain(pb.get("text"), latex))
            # prose around a figure in the running text; teacher-only notes are never evidence
            # (FR-4408: no later stage reads them either)
            def prose(x: dict) -> bool:
                return x["section"] == b["section"] and x["type"] != "teacher_only" \
                    and bool(plain(x.get("text"), latex))

            neigh = []
            if b["type"] not in ("exercise_item", "exercise_header", "worked_example"):
                neigh = [plain(x.get("text"), latex) for x in
                         [x for x in blocks[max(0, i - 4):i] if prose(x)][-2:]
                         + [x for x in blocks[i + 1:i + 3] if prose(x)][:1]]
            rec = figs.get(src, {})
            if image_dir is not None and src not in stats_cache:
                p = image_dir / rec.get("file", "") if rec.get("file") else None
                stats_cache[src] = image_stats(p) if p and p.exists() else None
            st = stats_cache.get(src)
            size = (st["w"], st["h"]) if st else tuple(rec.get("size") or ()) or None
            ch = chapters.get(b["chapter"], {})
            refs.append({
                "ref_index": len(refs), "src": src, "block": b["id"], "block_type": b["type"],
                "occurrence": nth,
                "context": f["context"], "chapter": b["chapter"], "section": b["section"],
                "section_title": sec_title.get(b["section"], ""), "subsection": sub_title.get(b["id"]),
                "chapter_title": ch.get("title", ""), "module": ch.get("module"),
                "lesson": lesson, "unit": unit, "printed_page": b.get("printed_page"),
                "exercise": b.get("exercise"), "q": b.get("q"), "role": role,
                "position": pos, "n_in_block": len(b["figures"]),
                "caption": plain(b.get("caption"), latex),
                # nearest first; the words BEFORE a figure introduce it, the words after may
                # already be about the next one (a table row's name precedes its picture)
                "layers": [("caption", plain(b.get("caption"), latex)),
                           ("words before", before),
                           ("words after", after),
                           ("own part", own),
                           ("related part", " | ".join(x for x in related if x)),
                           ("question stem", " | ".join(x for x in stem if x)),
                           ("exercise header", " | ".join(x for x in ex_header if x)),
                           ("neighbouring blocks", " | ".join(x for x in neigh if x))],
                "near_before": before,
                "neighbours_before": [plain(x.get("text"), latex) for x in blocks[max(0, i - 3):i]
                                      if prose(x)],
                "size": list(size) if size else None, "stats": st,
                "raster": not src.startswith("tikzpicture/"),
            })
    return refs


# ============================================================================ the rules
# The figure's own words, nearest first. The neighbouring blocks are read only after the section
# prior: "triangle" two paragraphs up says less about a figure than the sub-heading "Angles" does.
TEXT = ("caption", "words before", "words after", "own part", "related part", "question stem",
        "exercise header")
NEIGHBOURS = ("neighbouring blocks",)
NEAR = ("caption", "words before", "words after")


def first_hit(ref: dict, keys: list[tuple[str, str]], layers) -> tuple[str, str, str] | None:
    """Across the layers nearest first, the first (type, layer, words) whose keyword matches.
    `keys` is [(keyword set, type)] in priority order WITHIN a layer."""
    for lname, text in ref["layers"]:
        if lname not in layers or not text:
            continue
        for kw, typ in keys:
            m = KW[kw].search(text)
            if m:
                return typ, lname, m.group(0)
    return None


def closest_before(ref: dict, keys: list[tuple[str, str]]) -> tuple[str, str, str] | None:
    """The keyword match that ends nearest to the reference, in the words just before it."""
    best = None
    for kw, typ in keys:
        for m in KW[kw].finditer(ref["near_before"]):
            if best is None or m.end() > best[0]:
                best = (m.end(), typ, m.group(0))
    return (best[1], "the words just before", best[2]) if best else None


def hit(rule: str, typ: str, evidence: str) -> dict:
    return {"type": typ, "rule": rule, "evidence": evidence}


def ev(got: tuple[str, str, str]) -> str:
    return f"'{got[2]}' in {got[1]}"


def r_not_teaching(ref: dict) -> dict | None:
    src = ref["src"]
    if src.lower().endswith((".jpg", ".jpeg")):
        return hit("not_teaching:photo", "photo_decoration", f"JPEG photograph {src}")
    if re.match(r"^figure \d+\.\d+:", ref["caption"]):
        return hit("not_teaching:chapter-opener", "photo_decoration",
                   f"caption '{ref['caption'][:60]}'")
    if ref["raster"] and ref["context"] in ("body", "note"):
        return hit("not_teaching:raster-in-prose", "photo_decoration",
                   f"raster image {src} in {ref['context']} text, not a TikZ figure")
    if ref["size"] and max(ref["size"]) <= 40:
        return hit("not_teaching:inline-icon", "inline_symbol",
                   f"{ref['size'][0]}x{ref['size'][1]} px: a glyph inside a sentence")
    return None


def r_named(ref: dict, layers) -> dict | None:
    got = first_hit(ref, [("venn", "venn_diagram"), ("box_plot", "box_plot"),
                          ("histogram", "histogram"), ("ogive", "ogive")], layers)
    return hit(f"named:{got[0]}", got[0], ev(got)) if got else None


FAM_TYPE = {"line": "straight_line_graph", "parabola": "parabola_graph",
            "hyperbola": "hyperbola_graph", "exponential": "exponential_graph", "trig": "trig_graph"}


def graph_decision(ref: dict, prior: str | None, layers, default: str | None = None) -> dict | None:
    """Function graphs. `prior` is the section's family (6.2–6.6), applied before any words; with
    no prior the families named nearest the figure decide, and two of them, or one with a phrase
    that means several curves, make a multi-curve figure. `default` is the family a chapter's
    graphs have when no words name one (the equations chapter solves LINEAR systems)."""
    for lname, text in ref["layers"]:
        if lname not in layers or not text:
            continue
        if lname in NEAR:
            m = KW["mapping"].search(text)
            if m:
                return hit("functions:mapping", "mapping_diagram", f"'{m.group(0)}' in {lname}")
        m = KW["plot_points"].search(text)
        if m:
            return hit("functions:plot-points", "cartesian_points", f"'{m.group(0)}' in {lname}")
        multi = KW["multi"].search(text)
        if prior:
            if multi and prior != "line":
                return hit("functions:section-prior+several-curves", "multi_function_graph",
                           f"section family {prior}; '{multi.group(0)}' in {lname}")
            continue
        fams = families(text)
        kinds = sorted({f for f, _ in fams})
        shown = "; ".join(f"{f} '{w}'" for f, w in fams)
        if kinds == ["line"]:
            # several straight lines are still coordinate_plot segments
            return hit("functions:family", "straight_line_graph", f"{shown} in {lname}")
        if len(kinds) >= 2:
            return hit("functions:families", "multi_function_graph", f"{shown} in {lname}")
        if len(kinds) == 1:
            if multi:
                return hit("functions:family+several-curves", "multi_function_graph",
                           f"{shown}; '{multi.group(0)}' in {lname}")
            return hit("functions:family", FAM_TYPE[kinds[0]], f"{shown} in {lname}")
        if multi:
            if default:
                return hit("functions:several-curves+chapter-family", FAM_TYPE[default],
                           f"'{multi.group(0)}' in {lname}; chapter '{ref['chapter_title']}' "
                           f"graphs {default}s")
            return hit("functions:several-curves", "multi_function_graph",
                       f"'{multi.group(0)}' in {lname}; families not named")
    if prior:
        return hit("prior:section-family", FAM_TYPE[prior],
                   f"section {ref['section']} '{ref['section_title']}' teaches {prior}")
    return None


SECTION_FAMILY = [("line", r"linear"), ("parabola", r"quadratic"), ("hyperbola", r"hyperbol"),
                  ("exponential", r"exponential"), ("trig", r"trigonometric")]


def section_family(ref: dict) -> str | None:
    t = ref["section_title"].lower()
    for fam, pat in SECTION_FAMILY:
        if re.search(pat + r".*function", t):
            return fam
    return None


# Per domain: (keyword set, type, strength), in priority order within one layer. A STRONG word
# names the figure's kind outright ("parallelogram", "number line"); a WEAK one only fits it
# ("angle", "triangle", "area") and is read after the section prior.
DOMAIN_KEYS: dict[str, list[tuple[str, str, str]]] = {
    "equations": [("number_line", "number_line", "strong"), ("graph", "graph", "strong"),
                  ("cartesian", "graph", "strong"), ("composite", "plane_shape_measure", "strong"),
                  ("quad", "plane_shape_measure", "strong"), ("triangle", "plane_shape_measure", "weak")],
    "trig": [("cartesian", "cartesian_trig_angle", "strong"),
             ("composite", "trig_composite_diagram", "strong"),
             ("similar", "triangle_geometry", "strong"),
             ("trig", "right_triangle_trig", "weak"), ("triangle", "right_triangle_trig", "weak")],
    "euclid": [("midpoint", "midpoint_theorem", "strong"), ("quad", "quadrilateral_geometry", "strong"),
               ("triangle_strong", "triangle_geometry", "strong"),
               ("lines_strong", "lines_and_angles", "strong"),
               ("triangle", "triangle_geometry", "weak"), ("lines_weak", "lines_and_angles", "weak")],
    "analytic": [("cartesian", "cartesian_points", "strong"), ("naming", "quadrilateral_geometry", "strong")],
    "measurement": [("solid", "solid_3d", "strong"), ("trig", "right_triangle_trig", "strong"),
                    ("circle", "circle_diagram", "strong"), ("quad", "plane_shape_measure", "strong"),
                    ("triangle_strong", "plane_shape_measure", "strong"),
                    ("triangle", "plane_shape_measure", "weak"), ("area", "plane_shape_measure", "weak")],
    "probability": [("relfreq", "line_chart", "strong"), ("sample_space", "sample_space_diagram", "strong"),
                    ("graph", "line_chart", "weak")],
    "stats": [("dot_plot", "dot_plot", "strong"), ("quartile", "box_plot", "strong"),
              ("number_line", "number_line", "strong"), ("percentile", "number_line", "weak")],
    "patterns": [("pattern", "pattern_sequence", "strong")],
    "algebra": [("quad", "plane_shape_measure", "strong"), ("triangle", "plane_shape_measure", "weak"),
                ("area", "plane_shape_measure", "weak")],
}


def r_domain(ref: dict, strength: str, layers) -> dict | None:
    d = domain_of(ref["chapter_title"])
    if d in ("functions", "finance"):
        if strength != "strong":
            return None
        # a graph's prose names its curves in the paragraph before it ("simple interest is a
        # straight line graph and compound interest is an exponential graph"), so for graphs the
        # neighbours are read here, last, rather than after the section prior
        return graph_decision(ref, section_family(ref) if d == "functions" else None,
                              tuple(layers) + (NEIGHBOURS if layers == TEXT else ()))
    if d == "measurement" and strength == "strong":
        # a solution sketch redraws ONE FACE of the solid to work on it ("we redraw the triangle
        # we are interested in"), or unfolds it ("opened out to a sector"): the words just before
        # the figure say which, so the match CLOSEST to the reference wins
        if ref["context"] in ("we_solution", "exercise_solution"):
            face = closest_before(ref, [("net", "solid_net"), ("trig", "right_triangle_trig"),
                                        ("triangle_strong", "plane_shape_measure"),
                                        ("triangle", "plane_shape_measure")])
            if face:
                trig = KW["trig"].search(ref["near_before"])
                if face[0] != "solid_net" and trig:      # a face worked on with sin/cos/tan
                    return hit("measurement:solution-sketch", "right_triangle_trig",
                               f"{ev(face)}; '{trig.group(0)}' in the words just before")
                return hit("measurement:solution-sketch", face[0], ev(face))
        # a solid shown, then unfolded: in a figure block introduced as nets, every figure after
        # the first is a net (13.2 "Below are examples … unfolded into nets")
        if ref["block_type"] == "figure" and ref["position"] >= 1 \
                and any(KW["net"].search(t) for t in ref["neighbours_before"]):
            return hit("measurement:net-sequence", "solid_net",
                       f"figure {ref['position'] + 1} of {ref['n_in_block']} after text introducing nets")
        near = first_hit(ref, [("net", "solid_net")], [x for x in layers if x in NEAR])
        if near:
            return hit("measurement:net", "solid_net", ev(near))
        # an exercise's figure shows the object the question is about: "ABCD is a square" beside
        # a pyramid describes its base, so a solid named anywhere in the question wins
        if ref["context"] in ("exercise_problem", "exercise_header"):
            solid = first_hit(ref, [("solid", "solid_3d")], layers)
            if solid:
                return hit("measurement:solid_3d-in-question", "solid_3d", ev(solid))
    keys = [(k, t) for k, t, s in DOMAIN_KEYS.get(d, []) if s == strength]
    got = first_hit(ref, keys, layers) if keys else None
    if not got:
        return None
    if got[0] == "graph":                      # the equations chapter: a graph of a system
        return (graph_decision(ref, None, layers, default="line")
                or hit("equations:graph", "straight_line_graph",
                       f"{ev(got)}; chapter '{ref['chapter_title']}' graphs straight lines"))
    tag = "" if strength == "strong" else "-weak"
    return hit(f"{d}:{got[0]}{tag}", got[0], ev(got))


# the section title's prior, for a reference no strong words decided
SECTION_PRIORS: dict[str, list[tuple[str, str]]] = {
    "trig": [(r"similarit", "triangle_geometry"), (r"cartesian", "cartesian_trig_angle"),
             (r"trigonometric ratios|special angles|solving trigonometric|two-dimensional|"
              r"reciprocal|calculator", "right_triangle_trig")],
    "euclid": [(r"mid-point", "midpoint_theorem"), (r"quadrilateral|parallelogram|rectangle|rhombus|"
                r"square|trapezium|kite", "quadrilateral_geometry"),
               (r"triangl|congruen|similar|pythagoras", "triangle_geometry"),
               (r"\bangles\b|parallel lines|properties and notation", "lines_and_angles")],
    "analytic": [(r"cartesian|distance|gradient|mid-point", "cartesian_points")],
    "finance": [(r"compound interest", "exponential_graph")],
    "stats": [(r"grouping data", "histogram"), (r"five number summary", "box_plot")],
    "probability": [(r"venn|union|intersection|identit|mutually exclusive|complementary", "venn_diagram"),
                    (r"theoretical probability", "sample_space_diagram"),
                    (r"relative frequency", "line_chart")],
    "measurement": [(r"area of a polygon", "plane_shape_measure"),
                    (r"prism|cylinder|pyramid|cone|sphere|dimension", "solid_3d")],
    "patterns": [(r"sequence|pattern", "pattern_sequence")],
    "equations": [(r"inequalit", "number_line"), (r"simultaneous", "straight_line_graph")],
    "algebra": [(r"real number system", "venn_diagram")],
}


def r_section_prior(ref: dict) -> dict | None:
    d = domain_of(ref["chapter_title"])
    for title in (ref["subsection"] or "", ref["section_title"]):
        for pat, typ in SECTION_PRIORS.get(d, []):
            if title and re.search(pat, title.lower()):
                return hit("prior:section-title", typ, f"'{title}'")
    # the algebra chapters' prose figures are annotations of an expression (1.6, 1.7, 2.1)
    if d == "algebra" and ref["context"] == "body":
        return hit("prior:algebra-prose-figure", "annotated_expression",
                   f"a figure in the prose of '{ref['section_title']}' (algebra chapter)")
    return None


def r_sibling(i: int, refs: list[dict], first: list[dict | None]) -> dict | None:
    """A figure with no words takes the type its question's other figures got from their words."""
    ref = refs[i]
    group = [j for j, r in enumerate(refs) if j != i and first[j] is not None
             and r["chapter"] == ref["chapter"]
             and ((ref["exercise"] and r["exercise"] == ref["exercise"] and r["q"] == ref["q"])
                  or r["block"] == ref["block"])]
    if not group:
        return None
    j = min(group, key=lambda j: (abs(j - i), j))
    return hit("inherit:question-sibling", first[j]["type"],
               f"no words of its own; sibling ref {j} ({refs[j]['block']}) is "
               f"{first[j]['type']} by {first[j]['rule']}")


# a chapter whose subject IS one kind of figure: the last resort before unknown
CHAPTER_PRIORS = {
    "trig": ("right_triangle_trig", "right-triangle trigonometry"),
    "analytic": ("cartesian_points", "figures on the Cartesian plane"),
    "patterns": ("pattern_sequence", "picture patterns"),
    "probability": ("venn_diagram", "events drawn as Venn diagrams"),
}


def r_chapter_prior(ref: dict) -> dict | None:
    d = domain_of(ref["chapter_title"])
    if d in CHAPTER_PRIORS:
        typ, what = CHAPTER_PRIORS[d]
        return hit("prior:chapter", typ, f"chapter '{ref['chapter_title']}' is about {what}; "
                                         "no words or picture facts said otherwise")
    return None


def r_picture(ref: dict) -> dict | None:
    d = domain_of(ref["chapter_title"])
    fl = stat_flags(ref["stats"])
    if fl["wide"] and d in ("equations", "stats", "algebra"):
        return hit("picture:wide-strip", "number_line",
                   f"aspect {ref['stats']['aspect']} with at most 3 long horizontal lines")
    if fl["axes"] and d == "trig":
        return hit("picture:axes", "cartesian_trig_angle",
                   "a long horizontal and a long vertical line cross inside the picture")
    return None


def classify(refs: list[dict]) -> list[dict]:
    """Type every reference, in three passes; each pass reads only the passes before it, so the
    result cannot depend on the order the references are visited in.
      1. not a teaching figure; a settling name; the domain's strong words in the figure's text
      2. the section title's prior; the domain's weak words in the figure's text
      3. a figure with no words of its own: its question's siblings typed from THEIR words; then
         the neighbouring blocks; the picture; the chapter prior; else unknown"""
    out: list[dict | None] = [r_not_teaching(r) or r_named(r, TEXT) or r_domain(r, "strong", TEXT)
                              for r in refs]
    out = [o or r_section_prior(r) or r_domain(r, "weak", TEXT) for o, r in zip(out, refs)]
    typed = [o if o and not o["rule"].startswith(("not_teaching", "prior", "picture")) else None
             for o in out]
    return [o or r_sibling(i, refs, typed) or r_named(r, NEIGHBOURS)
            or r_domain(r, "strong", NEIGHBOURS) or r_domain(r, "weak", NEIGHBOURS)
            or r_picture(r) or r_chapter_prior(r) or hit("none", "unknown", "no rule fired")
            for i, (o, r) in enumerate(zip(out, refs))]


# ============================================================================ contracts
def viz_kinds() -> set[str]:
    return set(re.findall(r"^\d+\. \*\*([a-z_]+)\*\*", VIZ_SPEC.read_text(), flags=re.M))


def widget_kinds() -> set[str]:
    return set(json.loads(WIDGET_CONTRACT.read_text())["kinds"])


def approved_widgets(gaps_path: Path) -> set[str]:
    if not gaps_path.exists():
        return set()
    return set(json.loads(gaps_path.read_text()).get("proposed_kinds", {}))


def base_kind(name: str) -> str:
    return re.split(r"[ (:]", name, maxsplit=1)[0]


# ============================================================================ the audit
# Verdicts by eye (data-engineer agent, 2026-09-26): the type each sampled PICTURE shows, read off
# contact sheets that carried the reference number but not the classifier's answer. Keyed by
# (src, block, occurrence of that src in the block), so they survive anything that does not change
# the book. Where the picture alone was ambiguous (a figure drawn for a mid-point question that
# shows a plain triangle), the question it illustrates decided.
AUDIT_EYE: dict[tuple[str, str, int], str] = {
    ("images/sunflower.jpg", "b01043", 0): "photo_decoration",  # ref 10, p60
    ("tikzpicture/ecb9f42b122b2cb9b6c4241da8adfc91.png", "b01371", 0): "straight_line_graph",  # ref 32, p89
    ("tikzpicture/dca55ce0fac2faec33a2077033d2340f.png", "b01374", 0): "straight_line_graph",  # ref 35, p89
    ("tikzpicture/24113d6d12cf3c7e538cd16be5f4c854.png", "b01459", 0): "number_line",  # ref 43, p100
    ("tikzpicture/ea03d051cc486c9ceaecf64706652c61.png", "b01474", 0): "number_line",  # ref 56, p100
    ("tikzpicture/2b4da79c3184f14b7716323ccb3fb271.png", "b01622", 0): "triangle_geometry",  # ref 75, p109
    ("tikzpicture/05eee5177868f033f24a0ea2a153ae74.png", "b01650", 0): "right_triangle_trig",  # ref 81, p112
    ("tikzpicture/62a4231852bba661b47749bf340a22e0.png", "b01651", 0): "right_triangle_trig",  # ref 82, p112
    ("tikzpicture/9b31d9ca2f623b0e7ec2bf1ca3344ed0.png", "b01765", 0): "right_triangle_trig",  # ref 102, p124
    ("tikzpicture/3237396662f47d8b0c2b7f00d9840d83.png", "b01944", 0): "right_triangle_trig",  # ref 136, p139
    ("tikzpicture/764b6f8759848c372d5bb0e48d5bd40b.png", "b02130", 0): "straight_line_graph",  # ref 183, p156
    ("tikzpicture/cb51eb52e1618caa0332c02a39a81f67.png", "b02229", 0): "multi_function_graph",  # ref 203, p166
    ("tikzpicture/cc8c3a1c3acd05a3a654e79fcbb96441.png", "b02308", 0): "multi_function_graph",  # ref 222, p177
    ("tikzpicture/f35492c6a290b8950a7ce0e5c3ffd335.png", "b02313", 0): "multi_function_graph",  # ref 224, p177
    ("tikzpicture/65b72863cc37e31cdf3bc1cfd7a1fb84.png", "b02327", 0): "exponential_graph",  # ref 229, p180
    ("tikzpicture/88c7bb650e28ba58734590b60129ba37.png", "b02459", 0): "trig_graph",  # ref 250, p196
    ("tikzpicture/69a14975cc4481bd967091df11984ac8.png", "b02467", 0): "trig_graph",  # ref 254, p198
    ("tikzpicture/023e00229365890a21fa5f4104fbf933.png", "b02513", 0): "trig_graph",  # ref 281, p205
    ("tikzpicture/b7f6f1e1083f0cea9727f90b69fda1f2.png", "b02540", 0): "multi_function_graph",  # ref 294, p212
    ("tikzpicture/ff98350b51c85fe9874c87e33157ac22.png", "b02569", 0): "straight_line_graph",  # ref 300, p215
    ("tikzpicture/ad4625a67355cf1df2fb4cb10872ff16.png", "b02589", 0): "straight_line_graph",  # ref 303, p216
    ("tikzpicture/67b44768abd9052a10a79cb672848dad.png", "b02649", 0): "multi_function_graph",  # ref 327, p221
    ("tikzpicture/efb4627b1404f9206af961a4784b1f66.png", "b02681", 0): "trig_graph",  # ref 332, p222
    ("tikzpicture/4c3e440b2695a56fb5d8181870329604.png", "b02688", 0): "multi_function_graph",  # ref 335, p224
    ("tikzpicture/80b5b76854cefbe39410e7b15c07504e.png", "b02706", 0): "hyperbola_graph",  # ref 350, p226
    ("tikzpicture/aa5d4ca21116d370aa7a9b86d1bcb2c8.png", "b02721", 0): "multi_function_graph",  # ref 357, p230
    ("images/euclids_elements.jpg", "b02771", 0): "photo_decoration",  # ref 371, p237
    ("tikzpicture/fd012353de8d498b0e6b8609e14c7972.png", "b02789", 0): "lines_and_angles",  # ref 374, p237
    ("tikzpicture/9da66805f6b87b881e63590f84d964b2.png", "b02795", 0): "lines_and_angles",  # ref 376, p238
    ("tikzpicture/18e3e01054575d1447fa3057b738bd40.png", "b02812", 0): "lines_and_angles",  # ref 386, p241
    ("tikzpicture/f2508fbc7f1eaebc98f4a4290e2ac59a.png", "b02821", 0): "lines_and_angles",  # ref 388, p241
    ("tikzpicture/878c6b4d3649095ba4e6560c8c791bfa.png", "b02838", 0): "triangle_geometry",  # ref 403, p245
    ("tikzpicture/5c515f20b83990d801cb1e13ac8e8dcc.png", "b02886", 0): "quadrilateral_geometry",  # ref 430, p253
    ("tikzpicture/2be99457a147d898ecc529152fb6f01b.png", "b02900", 0): "quadrilateral_geometry",  # ref 434, p255
    ("tikzpicture/173997eb4e188753779007f845ee14fa.png", "b02917", 0): "quadrilateral_geometry",  # ref 438, p257
    ("tikzpicture/adfe4176a90c3569d646ab64e6146c5d.png", "b02932", 0): "quadrilateral_geometry",  # ref 440, p258
    ("tikzpicture/81754bc34e82a096f371e73e15c48546.png", "b02939", 0): "quadrilateral_geometry",  # ref 444, p260
    ("tikzpicture/a56a5bf9046495102da3612555f0b642.png", "b02951", 0): "midpoint_theorem",  # ref 457, p262
    ("tikzpicture/3e70322db08415fc14e0c261f8367b90.png", "b02956", 0): "midpoint_theorem",  # ref 460, p264
    ("tikzpicture/ca95e3dc876f54fc4e6963ccc43ec436.png", "b02966", 0): "midpoint_theorem",  # ref 468, p265
    ("tikzpicture/14db7a7172c964fa37ae92b1f7725dd9.png", "b02970", 0): "midpoint_theorem",  # ref 472, p266
    ("tikzpicture/f58f8f6914995319d68f724adcd9c54d.png", "b02982", 0): "midpoint_theorem",  # ref 485, p268
    ("tikzpicture/6948f1693098950e2d1ff35888693ee4.png", "b03055", 0): "triangle_geometry",  # ref 502, p272
    ("tikzpicture/9155f78e93a5946889ae37f84424c47b.png", "b03074", 0): "triangle_geometry",  # ref 519, p275
    ("tikzpicture/8dd38a21fac02b16b95c1013a2e10391.png", "b03077", 0): "triangle_geometry",  # ref 522, p276
    ("tikzpicture/2b90ec72ed064e16c082685d42396fad.png", "b03100", 0): "midpoint_theorem",  # ref 538, p279
    ("tikzpicture/9ec2537e5bd6f9d609ef8b154132dd64.png", "b03103", 0): "midpoint_theorem",  # ref 540, p279
    ("tikzpicture/3baf80e429b57b7ed158a7944143c918.png", "b03113", 0): "midpoint_theorem",  # ref 546, p281
    ("tikzpicture/ca470106e22c032748a702dfe2cafb4a.png", "b03135", 0): "cartesian_points",  # ref 554, p286
    ("tikzpicture/69294bf16913bdabaf630c6e7d5c79c0.png", "b03142", 0): "cartesian_points",  # ref 559, p288
    ("tikzpicture/b1051dc533da1c27095f8a3b02e48a85.png", "b03207", 0): "cartesian_points",  # ref 577, p300
    ("tikzpicture/0c0389c4d35c5102de7a0a7f586bdb08.png", "b03264", 0): "cartesian_points",  # ref 596, p313
    ("tikzpicture/371e723301b2a5ea72409ccd46975d11.png", "b03265", 0): "cartesian_points",  # ref 597, p313
    ("tikzpicture/ba1251fe5d23b5eedaa2e46ac6fdfb18.png", "b03289", 0): "quadrilateral_geometry",  # ref 602, p316
    ("tikzpicture/d03a20731bd58eb955f16c2a970b1195.png", "b03777", 0): "histogram",  # ref 647, p366
    ("tikzpicture/228c7f44418f764b133353ce29599c39.png", "b03974", 0): "trig_composite_diagram",  # ref 693, p395
    ("tikzpicture/d6f424eca9eb37c95e64cfcc608ef323.png", "b03994", 0): "right_triangle_trig",  # ref 706, p398
    ("tikzpicture/a9ff16a93bc67e5ae75d9d6f00f99361.png", "b04033", 0): "quadrilateral_geometry",  # ref 728, p405
    ("tikzpicture/89037240883c2fdbe86321a5280a0c8c.png", "b04045", 0): "quadrilateral_geometry",  # ref 738, p408
    ("tikzpicture/273c36346c5740761973c1f4069cb5d1.png", "b04090", 0): "midpoint_theorem",  # ref 746, p412
    ("tikzpicture/db5c101c981e19588b128f911fda5baa.png", "b04104", 0): "quadrilateral_geometry",  # ref 755, p413
    ("tikzpicture/3b65bb9d743b007da3d605294a6b28d3.png", "b04121", 0): "plane_shape_measure",  # ref 765, p417
    ("tikzpicture/52ebaf59f995e05925917d6dac6526a0.png", "b04150", 0): "solid_net",  # ref 788, p421
    ("tikzpicture/c77b31f1c53e40aa7d44ec56407783d4.png", "b04153", 0): "solid_net",  # ref 792, p421
    ("tikzpicture/38a60096eb94af75ed559102d11e0f97.png", "b04161", 0): "plane_shape_measure",  # ref 799, p423
    ("tikzpicture/b1c06d8cb93bc6d94eb3aae3dcdc3987.png", "b04177", 0): "solid_3d",  # ref 810, p427
    ("tikzpicture/222076eaac0cc92cb24c656ff323fc20.png", "b04182", 0): "solid_3d",  # ref 815, p431
    ("tikzpicture/a6ca40ffeb4a1404807965af71847a6b.png", "b04200", 0): "solid_3d",  # ref 833, p436
    ("tikzpicture/c9d6416977cdd913cd5c1592c98de70a.png", "b04208", 0): "solid_3d",  # ref 841, p440
    ("tikzpicture/6e4695aa5235d042bbe48ec8ca3ec075.png", "b04209", 0): "solid_3d",  # ref 842, p440
    ("tikzpicture/23da4349df92b529dc49e3a0bee65cf7.png", "b04211", 0): "solid_3d",  # ref 843, p441
    ("tikzpicture/115ea932606ae315d3b9bce84977c9c6.png", "b04215", 0): "solid_3d",  # ref 851, p444
    ("tikzpicture/da82345c3f30e123e0db3489af0a890b.png", "b04316", 0): "solid_3d",  # ref 901, p463
    ("tikzpicture/45a7a11517b1ecb7d220be4d054d8cf6.png", "b04325", 0): "solid_3d",  # ref 908, p464
    ("tikzpicture/67249e1611ed9b34e44dd05ca0a10943.png", "b04325", 0): "right_triangle_trig",  # ref 909, p464
    ("tikzpicture/ba17ac4beeb710d9f4b00edc65f7d916.png", "b04439", 0): "venn_diagram",  # ref 944, p481
    ("tikzpicture/452084009251e108e19919001d1293da.png", "b04478", 0): "venn_diagram",  # ref 965, p488
    ("tikzpicture/53461b974315e11563549bf0e7e9b62c.png", "b04478", 0): "venn_diagram",  # ref 967, p488
    ("tikzpicture/da39e6464513768b945940ee388795fb.png", "b04577", 0): "venn_diagram",  # ref 980, p495
    ("tikzpicture/5507226d454ae5f6757389274e99939d.png", "b04589", 0): "venn_diagram",  # ref 990, p495
    ("tikzpicture/9464d0532575b65a5fb6e98ea7aecc18.png", "b01120", 0): "pattern_sequence",  # ref 15, p66
    ("tikzpicture/db2da5856d8690ffad68cd091fde5c89.png", "b01652", 0): "right_triangle_trig",  # ref 83, p112
    ("tikzpicture/19be8c548008ad5d57969185a304439a.png", "b01654", 0): "right_triangle_trig",  # ref 85, p112
    ("tikzpicture/9d9f151cf67c17d02be5c42d657ca9a1.png", "b01655", 0): "right_triangle_trig",  # ref 86, p113
    ("tikzpicture/56e3ae28b8fc39c2be46e3d476de30ce.png", "b01762", 0): "right_triangle_trig",  # ref 99, p124
    ("tikzpicture/37debad9720fa54e379c46929c17e5c0.png", "b01768", 0): "right_triangle_trig",  # ref 105, p124
    ("tikzpicture/d9a4d62fb32bbb68d48f1db5dfcef0e7.png", "b01783", 0): "right_triangle_trig",  # ref 114, p127
    ("tikzpicture/6d5934a933feb5823fc4aff1176494e9.png", "b01969", 0): "right_triangle_trig",  # ref 147, p141
    ("tikzpicture/13ce9d32acd9c6b8de0de15df6494a98.png", "b01977", 0): "trig_composite_diagram",  # ref 152, p143
    ("tikzpicture/97708a520ad372724218b8e08dc5939e.png", "b02000", 0): "cartesian_trig_angle",  # ref 156, p144
    ("tikzpicture/3c869903a61ae58bd6ffb513279cf161.png", "b02091", 0): "straight_line_graph",  # ref 171, p152
    ("tikzpicture/c774b6a605ab21629747323bc0820537.png", "b02306", 0): "multi_function_graph",  # ref 220, p177
    ("tikzpicture/8d3ffecb331180371936b0f6164cdae3.png", "b02329", 0): "exponential_graph",  # ref 233, p180
    ("tikzpicture/c7d72293c6319a806d8a4ed60cfda9d5.png", "b02422", 0): "trig_graph",  # ref 244, p191
    ("tikzpicture/bdea7490a9f173bb0c5d89ba2c1685d0.png", "b02542", 0): "multi_function_graph",  # ref 295, p213
    ("tikzpicture/a08b1641a0440c7b1efef1b9f8f08b79.png", "b02680", 0): "trig_graph",  # ref 331, p222
    ("tikzpicture/397d4cd3cf8d84d179b1234e5afb05a9.png", "b02694", 0): "trig_graph",  # ref 340, p224
    ("tikzpicture/c86ef9313e0717126de716f5aa607a49.png", "b02753", 0): "multi_function_graph",  # ref 365, p232
    ("tikzpicture/092dc84eefb0cbeaa875402880ede2d5.png", "b02778", 0): "lines_and_angles",  # ref 372, p236
    ("tikzpicture/7080e01d4bfb6232622f1d460cfe8b5c.png", "b02864", 0): "triangle_geometry",  # ref 415, p248
    ("tikzpicture/4fdfed930be2a83fb8c04ef7584d4680.png", "b02885", 0): "quadrilateral_geometry",  # ref 429, p253
    ("tikzpicture/ca1931c8a1293130c1376281f8c75c46.png", "b03081", 0): "quadrilateral_geometry",  # ref 526, p277
    ("images/animation.png", "b03124", 0): "photo_decoration",  # ref 549, p285
    ("tikzpicture/eb70bd4ae126efedef5ae3c74c2e07e9.png", "b03158", 0): "cartesian_points",  # ref 564, p292
    ("tikzpicture/06e5c8131dc190380a1e0c338d5a69c7.png", "b03240", 0): "cartesian_points",  # ref 587, p307
    ("tikzpicture/a5f95ea0905357132e991b9b187e638a.png", "b03776", 0): "histogram",  # ref 645, p366
    ("tikzpicture/92380ac6e01fbbc05357796f7ce5d2c7.png", "b04018", 0): "trig_composite_diagram",  # ref 724, p400
    ("tikzpicture/c628571fd111bc4ea54f11d869bce339.png", "b04034", 0): "quadrilateral_geometry",  # ref 729, p405
    ("tikzpicture/de0e114f0e5f317006197588944bfb61.png", "b04043", 0): "quadrilateral_geometry",  # ref 735, p407
    ("tikzpicture/f7a2aa0b8ac920d668b5c88098d2b744.png", "b04044", 0): "quadrilateral_geometry",  # ref 736, p408
    ("tikzpicture/c0a1ce8d32c6008af7c18b178619cedf.png", "b04119", 0): "plane_shape_measure",  # ref 759, p417
    ("tikzpicture/4af611bb8f86289851d50d143ae7ebb3.png", "b04153", 0): "solid_net",  # ref 791, p421
    ("tikzpicture/d029260684e1faab093d3a761e05b2da.png", "b04156", 0): "solid_net",  # ref 794, p421
    ("tikzpicture/62891bea8972b49da1b3664b90c303b6.png", "b04180", 0): "solid_3d",  # ref 814, p430
    ("tikzpicture/50b9b7561822cbb02ad293389d98ac9c.png", "b04289", 0): "solid_3d",  # ref 882, p458
    ("tikzpicture/0be07d48fca5159242cac6372918dc19.png", "b04314", 0): "solid_3d",  # ref 900, p462
    ("tikzpicture/89d70611abd4209d4c0e9cc3c75abc8e.png", "b04364", 0): "sample_space_diagram",  # ref 923, p472
    ("tikzpicture/b726e1cf6f5743672a03389940e153dc.png", "b04415", 0): "venn_diagram",  # ref 926, p478
    ("tikzpicture/31ed0f376b23f81a6ecef6171b0921d2.png", "b04578", 0): "venn_diagram",  # ref 981, p495
    ("tikzpicture/f6dbb9b431c22b6dcf1db6af2ae8013b.png", "b04597", 0): "venn_diagram",  # ref 994, p496
}

# Two seeded random samples. A was checked before any rule was tuned on it; its three misses were
# then fixed, so A no longer measures anything by itself. B was drawn AFTER that tuning, from the
# references A did not hold: its first check is the honest accuracy of the rules. The first-check
# results are history and are recorded here; every run re-scores both samples with today's rules.
AUDIT_SAMPLES = [
    {"name": "A", "seed": 20260926, "size": 80, "exclude": None,
     "first_check": {"checked": 80, "right": 77, "wrong_refs": [222, 799, 909],
                     "note": "checked before tuning; the misses (two hyperbolas read as one; a "
                             "solution's face sketches read as a net and as a solid) were then fixed"}},
    {"name": "B", "seed": 20260927, "size": 40, "exclude": "A",
     "first_check": {"checked": 40, "right": 38, "wrong_refs": [147, 152],
                     "note": "drawn after the tuning on A: the independent measure. 147 (a right "
                             "triangle read as axes) was then fixed by a true line-crossing test; "
                             "152 (two triangles sharing a side, described as 'the triangle') "
                             "has no signal and stays wrong"}},
]


def audit_samples(n_refs: int) -> dict[str, list[int]]:
    out: dict[str, list[int]] = {}
    for smp in AUDIT_SAMPLES:
        taken = set(out.get(smp["exclude"], [])) if smp["exclude"] else set()
        idx = [i for i in range(n_refs) if i not in taken]
        random.Random(smp["seed"]).shuffle(idx)
        out[smp["name"]] = sorted(idx[:smp["size"]])
    return out


def audit(refs: list[dict], rows: list[dict]) -> dict:
    samples = audit_samples(len(refs))
    res, tot_checked, tot_right = [], 0, 0
    for smp in AUDIT_SAMPLES:
        checked, right, wrong, missing = 0, 0, [], []
        for i in samples[smp["name"]]:
            eye = AUDIT_EYE.get((refs[i]["src"], refs[i]["block"], refs[i]["occurrence"]))
            if eye is None:
                missing.append(i)
                continue
            checked += 1
            if eye == rows[i]["type"]:
                right += 1
            else:
                wrong.append({"ref_index": i, "src": refs[i]["src"], "page": refs[i]["printed_page"],
                              "classified": rows[i]["type"], "by_eye": eye, "rule": rows[i]["rule"]})
        tot_checked += checked
        tot_right += right
        res.append({"name": smp["name"], "seed": smp["seed"], "size": smp["size"],
                    "excludes": smp["exclude"], "first_check": smp["first_check"],
                    "now": {"checked": checked, "right": right,
                            "accuracy": round(right / checked, 3) if checked else None},
                    "not_yet_checked": missing, "wrong": wrong})
    b = next(r for r in res if r["name"] == "B")["first_check"]
    return {"method": "seeded random samples of references; each picture looked at by eye on a "
                      "contact sheet that did not show the classifier's type, and its true type "
                      "recorded in AUDIT_EYE",
            "independent_accuracy": {"sample": "B", "checked": b["checked"], "right": b["right"],
                                     "accuracy": round(b["right"] / b["checked"], 3)},
            "checked": tot_checked, "right": tot_right,
            "accuracy": round(tot_right / tot_checked, 3) if tot_checked else None,
            "samples": res}


# ============================================================================ the report
def inventory(inp: dict, image_dir: Path | None, gaps_path: Path, book: str = "",
              course_id: str = "", inputs: dict | None = None, adapter_refs: int | None = None) -> dict:
    refs = build_refs(inp, image_dir)
    res = classify(refs)
    rows = []
    for ref, r in zip(refs, res):
        t = TYPES[r["type"]]
        row = {"ref_index": ref["ref_index"], "src": ref["src"], "block": ref["block"],
               "context": ref["context"], "chapter": ref["chapter"], "section": ref["section"],
               "lesson": ref["lesson"], "printed_page": ref["printed_page"],
               "type": r["type"], "rule": r["rule"], "evidence": r["evidence"][:240]}
        if ref["unit"]:
            row["unit"] = ref["unit"]
        if "covered_by" in t:
            row["covered_by"] = t["covered_by"]["viz"] + t["covered_by"]["widget"]
        elif "gap" in t:
            row["gap_kind"] = t["gap"]["proposed_kind"]
        rows.append(row)

    figs = inp["figures"]
    total = len(rows)
    book_n = sum(1 for r in rows if r["context"] != SOLUTION)
    sol_n = total - book_n
    json_refs = sum(f["refs"] for f in figs.values())
    json_sol = sum(f["contexts"].get(SOLUTION, 0) for f in figs.values())
    by_ctx = dict(sorted(collections.Counter(r["context"] for r in rows).items()))

    types = {}
    for typ in TYPES:
        mine = [r for r in rows if r["type"] == typ]
        if not mine:
            continue
        t = TYPES[typ]
        # an unknown is a teaching figure whose type no rule found, so it stays in the count
        entry = {"label": t["label"], "teaching": t.get("teaching", True),
                 "count_book": sum(1 for r in mine if r["context"] != SOLUTION),
                 "count_solution": sum(1 for r in mine if r["context"] == SOLUTION),
                 "unique_images": len({r["src"] for r in mine}),
                 "chapters": sorted({r["chapter"] for r in mine}),
                 "rules": dict(sorted(collections.Counter(r["rule"] for r in mine).items()))}
        if "covered_by" in t:
            entry["covered_by"] = t["covered_by"]
            if t.get("limits"):
                entry["limits"] = t["limits"]
        if "gap" in t:
            entry["gap"] = t["gap"]
        book_first = sorted(mine, key=lambda r: (r["context"] == SOLUTION, r["ref_index"]))
        picked, seen_ch, seen_src = [], set(), set()
        for r in book_first:                       # one example per chapter first, then the rest
            if r["chapter"] not in seen_ch and r["src"] not in seen_src:
                picked.append(r)
                seen_ch.add(r["chapter"])
                seen_src.add(r["src"])
        for r in book_first:
            if r["src"] not in seen_src:
                picked.append(r)
                seen_src.add(r["src"])
        entry["examples"] = [{"src": r["src"], "page": r["printed_page"], "section": r["section"],
                              "context": r["context"], "rule": r["rule"], "evidence": r["evidence"]}
                             for r in picked[:4]]
        types[typ] = entry

    chapters = []
    for ch in sorted({r["chapter"] for r in rows}):
        mine = [r for r in rows if r["chapter"] == ch]
        title = next((x["chapter_title"] for x in refs if x["chapter"] == ch), "")
        chapters.append({"chapter": ch, "title": title,
                         "book": sum(1 for r in mine if r["context"] != SOLUTION),
                         "solution": sum(1 for r in mine if r["context"] == SOLUTION),
                         "by_type": dict(sorted(collections.Counter(r["type"] for r in mine).items(),
                                                key=lambda kv: (-kv[1], kv[0])))})

    def n(typ):
        return types[typ]["count_book"] + types[typ]["count_solution"]

    missing = sorted((t for t in types if "gap" in types[t]), key=lambda t: (-n(t), t))
    covered = sorted((t for t in types if "covered_by" in types[t]), key=lambda t: (-n(t), t))
    by_kind = collections.defaultdict(lambda: {"types": [], "figures": 0, "book": 0, "solution": 0})
    for t in missing:
        k = base_kind(types[t]["gap"]["proposed_kind"])
        by_kind[k]["types"].append(t)
        by_kind[k]["figures"] += n(t)
        by_kind[k]["book"] += types[t]["count_book"]
        by_kind[k]["solution"] += types[t]["count_solution"]
    summary = {
        "missing": [{"type": t, "label": types[t]["label"], "figures": n(t),
                     "book": types[t]["count_book"], "solution": types[t]["count_solution"],
                     "chapters": types[t]["chapters"], "proposed_kind": types[t]["gap"]["proposed_kind"],
                     "widget": types[t]["gap"]["widget"], "size": types[t]["gap"]["size"],
                     "why": types[t]["gap"]["why"]} for t in missing],
        "covered": [{"type": t, "label": types[t]["label"], "figures": n(t),
                     "book": types[t]["count_book"], "solution": types[t]["count_solution"],
                     "covered_by": types[t]["covered_by"]} for t in covered],
        "not_teaching": [{"type": t, "figures": n(t)} for t in sorted(NOT_TEACHING) if t in types],
        "unknown": n("unknown") if "unknown" in types else 0,
        "by_proposed_kind": [{"kind": k, **v} for k, v in
                             sorted(by_kind.items(), key=lambda kv: (-kv[1]["figures"], kv[0]))],
    }

    viz, wid, appr = viz_kinds(), widget_kinds(), approved_widgets(gaps_path)
    named_viz = sorted({k for t in TYPES.values() for k in t.get("covered_by", {}).get("viz", [])})
    named_wid = sorted({k for t in TYPES.values() for k in t.get("covered_by", {}).get("widget", [])})
    # "polygon_builder (area mode)" names the approved polygon_builder; "curve_sketcher
    # (extended)" is itself the approved name
    named_appr = sorted({w if w in appr else w.split(" (")[0]
                         for w in (t.get("gap", {}).get("widget") for t in TYPES.values()) if w})
    type_counts = collections.Counter(r["type"] for r in rows)
    checks = {
        "book_plus_solution_equals_total": {"book": book_n, "solution": sol_n, "total": total,
                                            "pass": book_n + sol_n == total},
        "references_match_figures_json": {"blocks": total, "figures_json": json_refs,
                                          "adapter_summary": adapter_refs,
                                          "pass": total == json_refs and adapter_refs in (None, total)},
        "solution_references_match_figures_json": {"blocks": sol_n, "figures_json": json_sol,
                                                   "pass": sol_n == json_sol},
        "unique_images_match_figures_json": {"referenced": len({r["src"] for r in rows}),
                                             "figures_json": len(figs),
                                             "pass": len({r["src"] for r in rows}) == len(figs)},
        "every_reference_typed_once": {"rows": total, "typed": sum(type_counts.values()),
                                       "pass": total == sum(type_counts.values())
                                       and all(r["type"] in TYPES for r in rows)
                                       and len({r["ref_index"] for r in rows}) == total},
        "covered_kinds_exist": {"viz": named_viz, "widget": named_wid,
                                "missing": sorted(set(named_viz) - viz) + sorted(set(named_wid) - wid),
                                "pass": set(named_viz) <= viz and set(named_wid) <= wid},
        "approved_widgets_exist": {"named": named_appr, "approved": sorted(appr),
                                   "missing": sorted(set(named_appr) - appr),
                                   "pass": set(named_appr) <= appr},
    }
    report = {
        "format": FORMAT, "book": book, "course_id": course_id,
        "rule": "Answer 5 (Samuel, 2026-09-25): a figure no existing visual type can draw gets a "
                "native figure or widget type, never a static book image. This file is that "
                "build's spec: every figure reference typed once, each type covered by a kind that "
                "exists or named as a gap with the kind to build.",
        "generated_by": "services/extraction/figure_inventory.py (deterministic, no model)",
        "inputs": inputs or {},
        "counts": {"references": total, "book": book_n, "solution": sol_n,
                   "equality": f"{book_n} book + {sol_n} solution = {total} references",
                   "unique_images": len({r["src"] for r in rows}),
                   "tikz_images": len({r["src"] for r in rows if r["src"].startswith("tikzpicture/")}),
                   "raster_images": len({r["src"] for r in rows if not r["src"].startswith("tikzpicture/")}),
                   "teaching_references": sum(1 for r in rows if r["type"] not in NOT_TEACHING),
                   "by_context": by_ctx,
                   "by_chapter": {str(c["chapter"]): {"book": c["book"], "solution": c["solution"]}
                                  for c in chapters}},
        "types": types, "chapters": chapters, "summary": summary, "checks": checks,
        "audit": audit(refs, rows), "figures": rows,
    }
    return report


def cell(text: str) -> str:
    """A Markdown table cell: a literal pipe ("30|45|60") would end the cell."""
    return text.replace("|", "\\|")


def render_md(rep: dict) -> str:
    s, c = rep["summary"], rep["counts"]
    out = [f"# Figure-gap inventory: {rep['book']}", "",
           "Generated by `services/extraction/figure_inventory.py` (deterministic, no model). "
           "Do not edit: re-run the script. The JSON beside this file has every reference, "
           "its rule and its evidence.", "",
           f"**{c['equality']}** ({c['unique_images']} unique images: {c['tikz_images']} TikZ, "
           f"{c['raster_images']} raster). Teaching figures: {c['teaching_references']}.", "",
           "## Missing: native types to build (answer 5)", "",
           "| Type | Book | Solutions | Chapters | Proposed kind | Widget (answer 6) | Size | Why |",
           "|---|---:|---:|---|---|---|---|---|"]
    for m in s["missing"]:
        out.append(f"| {m['label']} (`{m['type']}`) | {m['book']} | {m['solution']} | "
                   f"{', '.join(map(str, m['chapters']))} | `{cell(m['proposed_kind'])}` | "
                   f"{('`' + m['widget'] + '`') if m['widget'] else 'none'} | {m['size']} | "
                   f"{cell(m['why'])} |")
    out += ["", "By build (several types share one kind):", "",
            "| Kind to build | Figures | Book | Solutions | Types |", "|---|---:|---:|---:|---|"]
    for k in s["by_proposed_kind"]:
        out.append(f"| `{k['kind']}` | {k['figures']} | {k['book']} | {k['solution']} | "
                   f"{', '.join(k['types'])} |")
    out += ["", "## Covered today", "", "| Type | Book | Solutions | Drawn by | Limits |",
            "|---|---:|---:|---|---|"]
    for cv in s["covered"]:
        kinds = ", ".join(f"`{k}`" for k in cv["covered_by"]["viz"] + cv["covered_by"]["widget"])
        lim = rep["types"][cv["type"]].get("limits", "")
        out.append(f"| {cv['label']} (`{cv['type']}`) | {cv['book']} | {cv['solution']} | {kinds} | "
                   f"{cell(lim)} |")
    out += ["", "## Not teaching figures (no build)", ""]
    for nt in s["not_teaching"]:
        out.append(f"- {rep['types'][nt['type']]['label']} (`{nt['type']}`): {nt['figures']}")
    out += ["", "## Unknown", "",
            f"{s['unknown']} references matched no rule and stay unknown (never forced)."
            + (" A person types these by looking:" if s["unknown"] else ""), ""]
    for r in rep["figures"]:
        if r["type"] == "unknown":
            out.append(f"- ref {r['ref_index']}: section {r['section']}, p{r['printed_page']}, "
                       f"{r['context']}, `{r['src']}`")
    out.append("")
    a = rep["audit"]
    ind = a["independent_accuracy"]
    out += ["## Spot check (pictures looked at by eye)", "",
            f"Independent measure: sample {ind['sample']}, drawn after the rules were tuned, "
            f"{ind['right']} of {ind['checked']} right at first check ({ind['accuracy']:.0%}).", "",
            "| Sample | Seed | Size | First check | With today's rules |", "|---|---|---:|---|---|"]
    for smp in a["samples"]:
        fc, now = smp["first_check"], smp["now"]
        out.append(f"| {smp['name']} | {smp['seed']} | {smp['size']} | {fc['right']}/{fc['checked']} "
                   f"| {now['right']}/{now['checked']} |")
    out.append("")
    for smp in a["samples"]:
        for w in smp["wrong"]:
            out.append(f"- still wrong: ref {w['ref_index']} (p{w['page']}, `{w['src']}`): typed "
                       f"`{w['classified']}` by `{w['rule']}`, the picture shows `{w['by_eye']}`")
        if smp["not_yet_checked"]:
            out.append(f"- sample {smp['name']}: {len(smp['not_yet_checked'])} references not yet "
                       "checked by eye (the book changed since the verdicts were recorded)")
    bad = [k for k, v in rep["checks"].items() if not v["pass"]]
    out += ["", "## Checks", "", "All checks pass." if not bad else "FAILED: " + ", ".join(bad), ""]
    return "\n".join(out)


def summary_text(rep: dict) -> str:
    s, c = rep["summary"], rep["counts"]
    lines = [f"figure-gap inventory {rep['book']}: {c['equality']}",
             f"  missing types (gap → proposed kind, size):"]
    for m in s["missing"]:
        lines.append(f"    {m['figures']:4d}  {m['type']:<24} book {m['book']:3d} sol {m['solution']:3d}  "
                     f"ch {','.join(map(str, m['chapters']))}  → {m['proposed_kind']} [{m['size']}]")
    lines.append("  covered:")
    for cv in s["covered"]:
        lines.append(f"    {cv['figures']:4d}  {cv['type']:<24} → "
                     f"{', '.join(cv['covered_by']['viz'] + cv['covered_by']['widget'])}")
    lines.append("  not teaching: " + ", ".join(f"{x['type']} {x['figures']}" for x in s["not_teaching"]))
    lines.append(f"  unknown: {s['unknown']}")
    a = rep["audit"]
    ind = a["independent_accuracy"]
    lines.append(f"  spot check by eye: independent sample {ind['sample']} {ind['right']}/{ind['checked']} "
                 f"at first check; today's rules {a['right']}/{a['checked']} on all {a['checked']} "
                 "audited pictures")
    bad = [k for k, v in rep["checks"].items() if not v["pass"]]
    lines.append("  checks: " + ("all pass" if not bad else "FAILED " + ", ".join(bad)))
    return "\n".join(lines)


def dumps(obj) -> str:
    return json.dumps(obj, indent=1, ensure_ascii=False) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--book", required=True)
    ap.add_argument("--work", type=Path, help="default: the book's work dir (work/<book>)")
    ap.add_argument("--manifest", type=Path, help="default: the book config's manifest")
    ap.add_argument("--out", type=Path, help="default coverage/<book>.figure-gaps.json (.md beside it)")
    ap.add_argument("--check", action="store_true", help="compute and print, write nothing")
    a = ap.parse_args(argv)

    import book_config
    book = book_config.load_book(a.book)
    work = a.work or book.work_dir()
    manifest_p = a.manifest or (book.repo_path(book.manifest) if book.manifest else None)
    if not (work / "blocks.jsonl").exists() or not (work / "figures.json").exists():
        print(f"ERROR: {rel(work)} has no blocks.jsonl/figures.json: run source_adapter.py {a.book}",
              file=sys.stderr)
        return 2
    if not manifest_p or not manifest_p.exists():
        print(f"ERROR: no manifest for {a.book}", file=sys.stderr)
        return 2
    gaps_p = HERE / "coverage" / f"{book.book}.widget-gaps.json"
    inp = load_inputs(work, manifest_p)
    image_dir = work
    img = hashlib.sha256()
    for src in sorted(inp["figures"]):
        f = work / inp["figures"][src]["file"]
        img.update(src.encode() + b"\0" + (sha256_file(f).encode() if f.exists() else b"missing") + b"\n")
    inputs = {
        rel(work / "blocks.jsonl"): sha256_file(work / "blocks.jsonl"),
        rel(work / "figures.json"): sha256_file(work / "figures.json"),
        rel(work / "figures") + "/*": img.hexdigest(),
        rel(manifest_p): sha256_file(manifest_p),
        rel(VIZ_SPEC): sha256_file(VIZ_SPEC),
        rel(WIDGET_CONTRACT): sha256_file(WIDGET_CONTRACT),
    }
    if gaps_p.exists():
        inputs[rel(gaps_p)] = sha256_file(gaps_p)
    if inp["latex_path"]:
        inputs[rel(inp["latex_path"])] = sha256_file(inp["latex_path"])
    adapter_refs = None
    summ = work / "adapter-summary.json"
    if summ.exists():
        adapter_refs = json.loads(summ.read_text()).get("figures", {}).get("references")
    rep = inventory(inp, image_dir, gaps_p, book=book.book, course_id=book.course_id,
                    inputs=dict(sorted(inputs.items())), adapter_refs=adapter_refs)
    print(summary_text(rep))
    if not a.check:
        out = a.out or HERE / "coverage" / f"{book.book}.figure-gaps.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(dumps(rep))
        out.with_suffix(".md").write_text(render_md(rep))
        print(f"wrote {rel(out)} and {rel(out.with_suffix('.md'))}")
    return 0 if all(v["pass"] for v in rep["checks"].values()) else 1


if __name__ == "__main__":
    sys.exit(main())
