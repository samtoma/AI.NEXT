"""S7 widget questions from JSON templates (B13, §3.10).

@covers FR-4306, FR-1207, FR-1215

FR-4306: every chapter gets widget questions or a recorded gap; new kinds wait for
Samuel. FR-1207: a target the instrument cannot reach is refused — the Python port of
the app's validator is cross-checked against the TypeScript itself. FR-1215: a
diagnostic names a misconception of the question's objective or of a prerequisite,
checked against the graph. Plus the stage's own gates: parent set, blind verifier
verdicts applied fail-closed, and the blind reading of the stem compared with the spec.

    uv run --with pytest python -m pytest -q tests/test_widget_templates.py
"""

from __future__ import annotations

import contextlib
import copy
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import _scratchdb  # noqa: F401
import _widget_defect_fixture as wdf
import generate_widget_questions as GW
import widget_spec as W

HERE = Path(__file__).resolve().parent
EX = HERE.parent
REPO = EX.parents[1]
FIX = HERE / "fixtures" / "families"
TEMPLATES = FIX / "widget-templates"
GRAPH = json.loads((FIX / "widget-graph.json").read_text())


def graph():
    return GW.FixtureGraph(copy.deepcopy(GRAPH))


def built():
    templates, problems = GW.load_templates(TEMPLATES)
    assert problems == [], problems
    questions, render_problems = GW.build_from_templates(templates)
    assert render_problems == [], render_problems
    return templates, questions


def verdict(q, reachable=True, matches=True, reading=None, sha=None):
    return {"question_id": q["id"], "template_sha": sha or q["template_sha"],
            "reading": reading if reading is not None else honest_reading(q),
            "construction": "…", "reachable": reachable,
            "predicates": [{"predicate": d["predicate"], "matches": matches, "why": "…"}
                           for d in q["choices"]["diagnostics"]]}


def honest_reading(q):
    """What a correct blind reader of the STEM returns — the stem's meaning, not the spec."""
    s = q["choices"]["spec"]
    if q["family"] == "wt:t2u2-2-1:domain-excluded":  # the stem's zeros, read off its factors (x ± k)
        shifts = [int(k) for k in re.findall(r"\(x ([+-]\d+)\)", q["stem"])]
        assert len(shifts) == 2, q["stem"]
        return {"mode": "points", "targets": sorted(-k for k in shifts)}
    return {k: v for k, v in s.items() if k in GW.READING_FIELDS[q["choices"]["kind"]]}


class TemplatesReproduceTheHandWrittenOnes(unittest.TestCase):
    """Three of the 48 live Prep-3 templates, as JSON: same questions, now with a parent."""

    def test_same_stems_specs_diagnostics_and_solutions(self):
        _, questions = built()
        legacy = {q["id"]: q for q in GW.build()}
        mine = [q for q in questions if not q["lo_id"].startswith("lo:g10m")]
        self.assertEqual(len(mine), 10)
        for q in mine:
            old = legacy[q["id"]]
            for k in ("lo_id", "tier", "question_type", "stem", "choices", "correct_answer", "canonical_solution"):
                self.assertEqual(q[k], old[k], f"{q['id']}.{k}")
            self.assertTrue(q["parent_question_id"])  # the one intended difference (§2.6: legacy is NULL)
            self.assertIn(q["family"], q["source_note"])


class Reachability(unittest.TestCase):
    CASES = [  # (kind, spec) — the boundaries of app/src/lib/widget-payloads.ts
        ("pair_plotter", {"target": [5, -5]}), ("pair_plotter", {"target": [6, 0]}),
        ("pair_plotter", {"target": [1.5, 2]}),
        ("line_drawer", {"mode": "equation", "m": 0.5, "b": 2}), ("line_drawer", {"mode": "equation", "m": 0.4, "b": 2}),
        ("line_drawer", {"mode": "equation", "m": 6, "b": 0}), ("line_drawer", {"mode": "equation", "m": 1, "b": 2.5}),
        ("line_drawer", {"mode": "equation", "m": 0, "b": 0}),
        ("line_drawer", {"mode": "points", "through": [[1, 1], [1, 1]]}),
        ("line_drawer", {"mode": "points", "through": [[-2, -3], [2, 5]]}),
        ("angle_setter", {"ask": "inscribed", "target": 35}), ("angle_setter", {"ask": "inscribed", "target": 36}),
        ("angle_setter", {"ask": "central", "target": 355}),
        ("triangle_ratio", {"ask": "sin", "target": 1}), ("triangle_ratio", {"ask": "tan", "target": 12}),
        ("triangle_ratio", {"ask": "tan", "target": 12.5}),
        ("bar_builder", {"ask": "mode", "target": 4.5, "n": 5}), ("bar_builder", {"ask": "mean", "target": 4.5, "n": 5}),
        ("bar_builder", {"ask": "mean", "target": 11, "n": 5}), ("bar_builder", {"ask": "mean", "target": 5, "n": 9}),
        ("number_line_marker", {"mode": "points", "range": [-6, 6], "targets": [-3, 2]}),
        ("number_line_marker", {"mode": "points", "range": [-6, 6], "targets": [-3, 7]}),
        ("number_line_marker", {"mode": "points", "range": [-20, 20], "targets": [0]}),
        ("number_line_marker", {"mode": "interval", "range": [-5, 5], "from": -2, "to": 4, "openFrom": True}),
        ("ratio_balance", {"mode": "direct", "a": 3, "b": 4, "c": 9}), ("ratio_balance", {"mode": "direct", "a": 4, "b": 3, "c": 9}),
        ("ratio_balance", {"mode": "inverse", "a": 6, "b": 10, "c": 4}),
        ("sample_space", {"rows": 6, "cols": 6, "rule": {"kind": "sum", "op": "eq", "value": 7}}),
        ("sample_space", {"rows": 9, "cols": 6, "rule": {"kind": "sum", "op": "eq", "value": 7}}),
        ("curve_sketcher", {"fn": "quadratic", "coefs": [0, 1, 2]}), ("curve_sketcher", {"fn": "linear", "coefs": [2, -1]}),
        ("curve_sketcher", {"fn": "linear", "coefs": [11, 0]}),
        ("circle_builder", {"element": "tangent"}), ("circle_builder", {"element": "arc"}),
        ("product_builder", {"X": [1, 2, 3, 4, 5], "Y": [1]}), ("product_builder", {"X": [1, 2], "Y": [5]}),
    ]
    # The kinds of feature 003 (answer 6 / decision 27), each at the boundaries of parseMathWidget and
    # curveReachable. Every case here must be decided the same way by both sides.
    NEW_KIND_CASES = [
        # curve_sketcher's five G10 families (curveReachable), and the old two unchanged
        ("curve_sketcher", {"fn": "hyperbola", "coefs": [2, -1]}), ("curve_sketcher", {"fn": "hyperbola", "coefs": [6, 3]}),
        ("curve_sketcher", {"fn": "hyperbola", "coefs": [7, 0]}), ("curve_sketcher", {"fn": "hyperbola", "coefs": [0, 1]}),
        ("curve_sketcher", {"fn": "hyperbola", "coefs": [2, 4]}), ("curve_sketcher", {"fn": "hyperbola", "coefs": [1.5, 0]}),
        ("curve_sketcher", {"fn": "hyperbola", "coefs": [2, -1, 0]}),
        ("curve_sketcher", {"fn": "exponential", "coefs": [1, 2, 0]}), ("curve_sketcher", {"fn": "exponential", "coefs": [-3, 0.5, 3]}),
        ("curve_sketcher", {"fn": "exponential", "coefs": [1, 4, 0]}), ("curve_sketcher", {"fn": "exponential", "coefs": [4, 2, 0]}),
        ("curve_sketcher", {"fn": "exponential", "coefs": [1, 3, -4]}), ("curve_sketcher", {"fn": "exponential", "coefs": [1, 2]}),
        ("curve_sketcher", {"fn": "sine", "coefs": [4, -3]}), ("curve_sketcher", {"fn": "sine", "coefs": [5, 0]}),
        ("curve_sketcher", {"fn": "cosine", "coefs": [-2, 1]}), ("curve_sketcher", {"fn": "cosine", "coefs": [0, 1]}),
        ("curve_sketcher", {"fn": "tangent", "coefs": [3, 0]}), ("curve_sketcher", {"fn": "tangent", "coefs": [4, 0]}),
        ("curve_sketcher", {"fn": "tangent", "coefs": [1, 0.5]}), ("curve_sketcher", {"fn": "cubic", "coefs": [1, 0, 0, 0]}),
        ("curve_sketcher", {"fn": "quadratic", "coefs": [1, 0, -4]}), ("curve_sketcher", {"fn": "linear", "coefs": [2, -1, 0]}),
        ("curve_sketcher", {"fn": "linear", "coefs": [-10, 10]}),
        # polygon_builder: construct / midsegment / area
        ("polygon_builder", {"mode": "construct", "shape": "rhombus"}), ("polygon_builder", {"mode": "construct", "shape": "kite"}),
        ("polygon_builder", {"mode": "construct", "shape": "right"}), ("polygon_builder", {"mode": "construct", "shape": "equilateral"}),
        ("polygon_builder", {"mode": "construct"}), ("polygon_builder", {"mode": "draw", "shape": "square"}),
        ("polygon_builder", {"mode": "midsegment", "triangle": [[0, 0], [6, 0], [0, 6]], "apex": 0}),
        ("polygon_builder", {"mode": "midsegment", "triangle": [[-6, -6], [6, 0], [0, 6]], "apex": 2}),
        ("polygon_builder", {"mode": "midsegment", "triangle": [[0, 0], [7, 0], [0, 6]], "apex": 0}),
        ("polygon_builder", {"mode": "midsegment", "triangle": [[0, 0], [2, 2], [4, 4]], "apex": 0}),
        ("polygon_builder", {"mode": "midsegment", "triangle": [[0, 0], [6, 0], [0, 6]], "apex": 3}),
        ("polygon_builder", {"mode": "midsegment", "triangle": [[0, 0], [6, 0], [0, 6]], "apex": True}),
        ("polygon_builder", {"mode": "midsegment", "triangle": [[0, 0], [6, 0], [0.5, 6]], "apex": 1}),
        ("polygon_builder", {"mode": "midsegment", "triangle": [[0, 0], [6, 0]], "apex": 0}),
        ("polygon_builder", {"mode": "area", "shape": "triangle", "target": 6}),
        ("polygon_builder", {"mode": "area", "shape": "quadrilateral", "target": 7.5}),
        ("polygon_builder", {"mode": "area", "shape": "triangle", "target": 24}),
        ("polygon_builder", {"mode": "area", "shape": "triangle", "target": 24.5}),
        ("polygon_builder", {"mode": "area", "shape": "triangle", "target": 0}),
        ("polygon_builder", {"mode": "area", "shape": "triangle", "target": 6.25}),
        ("polygon_builder", {"mode": "area", "shape": "pentagon", "target": 6}),
        # solid_scaler: the k the ratio needs must land on a 0.5 stop in 0.5..4; dims (parseSolidDims)
        ("solid_scaler", {"solid": "cylinder", "ask": "volume", "ratio": 8}),
        ("solid_scaler", {"solid": "box", "ask": "volume", "ratio": 64}),
        ("solid_scaler", {"solid": "sphere", "ask": "volume", "ratio": 0.125}),
        ("solid_scaler", {"solid": "cone", "ask": "volume", "ratio": 15.625}),
        ("solid_scaler", {"solid": "cone", "ask": "volume", "ratio": 2}),
        ("solid_scaler", {"solid": "box", "ask": "volume", "ratio": 125}),
        ("solid_scaler", {"solid": "pyramid", "ask": "area", "ratio": 2.25}),
        ("solid_scaler", {"solid": "pyramid", "ask": "area", "ratio": 2}),
        ("solid_scaler", {"solid": "box", "ask": "area", "ratio": 16}),
        ("solid_scaler", {"solid": "box", "ask": "area", "ratio": 0.16}),
        ("solid_scaler", {"solid": "prism", "ask": "area", "ratio": 4}),
        ("solid_scaler", {"solid": "box", "ask": "length", "ratio": 4}),
        ("solid_scaler", {"solid": "box", "ask": "area", "ratio": 0}),
        ("solid_scaler", {"solid": "box", "ask": "volume", "ratio": 8, "dims": {"l": 8, "w": 0.5, "h": 1}}),
        ("solid_scaler", {"solid": "box", "ask": "volume", "ratio": 8, "dims": {"l": 9}}),
        ("solid_scaler", {"solid": "box", "ask": "volume", "ratio": 8, "dims": {"l": 0}}),
        ("solid_scaler", {"solid": "box", "ask": "volume", "ratio": 8, "dims": {"r": 99}}),
        ("solid_scaler", {"solid": "cylinder", "ask": "volume", "ratio": 8, "dims": {"r": None}}),
        ("solid_scaler", {"solid": "sphere", "ask": "volume", "ratio": 8, "dims": [1, 2]}),
        # box_plot_builder
        ("box_plot_builder", {"data": [2, 4, 4, 5, 6, 7, 9, 12, 15]}),
        ("box_plot_builder", {"data": [1, 2, 3, 4]}),
        ("box_plot_builder", {"data": list(range(16))}), ("box_plot_builder", {"data": list(range(17))}),
        ("box_plot_builder", {"data": [1, 2, 3, 4, 5.5]}), ("box_plot_builder", {"data": [1, 2, 3, 4, 501]}),
        ("box_plot_builder", {"data": [-500, 2, 3, 4, 500]}),
        # venn_builder: shade / counts
        ("venn_builder", {"sets": 2, "labels": ["Football", "Chess"], "mode": "shade", "target": "aOnly"}),
        ("venn_builder", {"sets": 2, "labels": ["Football", "Chess"], "mode": "shade", "target": "cOnly"}),
        ("venn_builder", {"sets": 3, "labels": ["A", "B", "C"], "mode": "shade", "target": "complementC"}),
        ("venn_builder", {"sets": 2, "labels": ["Football"], "mode": "shade", "target": "union"}),
        ("venn_builder", {"sets": 2, "labels": ["Football", " "], "mode": "shade", "target": "union"}),
        ("venn_builder", {"sets": 4, "labels": ["A", "B", "C", "D"], "mode": "shade", "target": "union"}),
        ("venn_builder", {"sets": 2, "labels": ["A", "B"], "mode": "shade", "target": "symmetricDifference"}),
        ("venn_builder", {"sets": 2, "labels": ["French", "German"], "mode": "counts", "total": 20,
                          "regions": {"a": 8, "b": 5, "ab": 4, "n": 3}, "clues": {"a": 12, "b": 9}}),
        ("venn_builder", {"sets": 2, "labels": ["French", "German"], "mode": "counts", "total": 21,
                          "regions": {"a": 8, "b": 5, "ab": 4, "n": 3}}),
        ("venn_builder", {"sets": 2, "labels": ["French", "German"], "mode": "counts",
                          "regions": {"a": 8, "b": 5, "ab": 4}}),
        ("venn_builder", {"sets": 2, "labels": ["French", "German"], "mode": "counts",
                          "regions": {"a": 8, "b": 5, "ab": 4, "n": 1000}}),
        ("venn_builder", {"sets": 2, "labels": ["French", "German"], "mode": "counts",
                          "regions": {"a": 8, "b": 5, "ab": 4, "n": 3}, "clues": {"a": -1}}),
        ("venn_builder", {"sets": 3, "labels": ["A", "B", "C"], "mode": "counts",
                          "regions": {"a": 1, "b": 2, "c": 3, "ab": 4, "ac": 5, "bc": 6, "abc": 7, "n": 8},
                          "clues": {"a": 17, "b": 19, "c": 21}}),
        ("venn_builder", {"sets": 2, "labels": ["A", "B"], "mode": "counts", "regions": [1, 2, 3, 4]}),
        # area_model
        ("area_model", {"mode": "expand", "a": 2, "b": -3}), ("area_model", {"mode": "factor", "a": 4, "b": -4}),
        ("area_model", {"mode": "expand", "a": 0, "b": 0}), ("area_model", {"mode": "expand", "a": 5, "b": 1}),
        ("area_model", {"mode": "expand", "a": 1.5, "b": 1}), ("area_model", {"mode": "multiply", "a": 1, "b": 1}),
    ]
    # the one new-kind rule the pipeline adds (a clue must be its set's size; the app accepts any whole clue)
    STRICTER = [
        ("venn_builder", {"sets": 2, "labels": ["French", "German"], "mode": "counts", "total": 20,
                          "regions": {"a": 8, "b": 5, "ab": 4, "n": 3}, "clues": {"a": 8, "b": 9}}),
        ("venn_builder", {"sets": 2, "labels": ["French", "German"], "mode": "counts",
                          "regions": {"a": 8, "b": 5, "ab": 4, "n": 3}, "clues": {"a": 12, "b": 9, "c": 1}}),
    ]

    def test_every_live_widget_is_reachable(self):
        for q in GW.build():
            self.assertEqual(GW.reachability(q["choices"]["kind"], q["choices"]["spec"]), [], q["id"])

    def test_the_pipeline_is_stricter_about_empty_events(self):
        self.assertEqual(GW.reachability("sample_space", {"rows": 6, "cols": 6,
                                                          "rule": {"kind": "sum", "op": "eq", "value": 13}}),
                         ["the event holds no outcome (pipeline rule, stricter than the app)"])

    @staticmethod
    def app_accepts(cases):
        ts = REPO / "app" / "src" / "lib" / "widget-payloads.ts"
        script = ("const m = await import(process.argv[1]); const cases = JSON.parse(process.argv[2]);"
                  "console.log(JSON.stringify(cases.map(([k, s]) => m.parseMathWidget(k, s) !== null)))")
        out = subprocess.run(["node", "--no-warnings", "--input-type=module", "-e", script, ts.as_uri(),
                              json.dumps(cases)], capture_output=True, text=True, check=True)
        app = json.loads(out.stdout)
        assert len(app) == len(cases), "the app answered for every case"
        return app

    @unittest.skipUnless(shutil.which("node"), "node is not installed")
    def test_the_python_port_agrees_with_the_apps_typescript(self):
        for (kind, spec), accepted in zip(self.CASES, self.app_accepts(self.CASES)):
            self.assertEqual(GW.reachability(kind, spec) == [], accepted, f"{kind} {spec}")

    @unittest.skipUnless(shutil.which("node"), "node is not installed")
    def test_every_new_kind_agrees_with_the_apps_typescript(self):
        app = self.app_accepts(self.NEW_KIND_CASES)
        for (kind, spec), accepted in zip(self.NEW_KIND_CASES, app):
            self.assertEqual(GW.reachability(kind, spec) == [], accepted,
                             f"{kind} {spec}: pipeline {GW.reachability(kind, spec)}, app accepts={accepted}")
        # both sides accept and refuse something of every kind, so no kind is tested on one side only
        for kind in ("curve_sketcher", "polygon_builder", "solid_scaler", "box_plot_builder", "venn_builder",
                     "area_model"):
            seen = {a for (k, _), a in zip(self.NEW_KIND_CASES, app) if k == kind}
            self.assertEqual(seen, {True, False}, kind)
        for fn in GW.CURVE_FNS:
            self.assertIn(True, [a for (k, s), a in zip(self.NEW_KIND_CASES, app)
                                 if k == "curve_sketcher" and s["fn"] == fn], fn)

    @unittest.skipUnless(shutil.which("node"), "node is not installed")
    def test_the_pipeline_is_stricter_about_venn_clues_and_says_so(self):
        self.assertEqual(self.app_accepts(self.STRICTER), [True, True])
        for kind, spec in self.STRICTER:
            (why,) = GW.reachability(kind, spec)
            self.assertIn("pipeline rule, stricter than the app", why)

    def test_every_contract_kind_is_registered(self):
        """A kind in contracts/widget-predicates.json with no instrument, no rule or no reading fields is a
        kind the author is offered blind (s7-v4 saw polygon_builder with an empty instrument)."""
        import widget_spec as W
        wf = (EX / "runbook" / "widgets.workflow.js").read_text()
        rules = wf[wf.index("Spec fields per kind"):wf.index("const AUTHOR_RULES")]
        for kind in W.contract()["kinds"]:
            self.assertTrue(GW.INSTRUMENTS.get(kind), kind)
            self.assertTrue(GW.READING_FIELDS.get(kind), kind)
            self.assertNotIn("unknown widget kind", " ".join(GW.reachability(kind, {})), kind)
            self.assertIn(f"{kind} {{", rules, kind)

    def test_the_instruments_carry_the_apps_docs_word_for_word(self):
        docs = (REPO / "app" / "src" / "lib" / "widget-docs.ts").read_text()
        for key, kind in (("polygon_builder", "polygon_builder"), ("solid_scaler", "solid_scaler"),
                          ("box_plot_builder", "box_plot_builder"), ("venn_builder", "venn_builder"),
                          ("area_model", "area_model"), ("curve_sketcher_g10", "curve_sketcher")):
            m = re.search(r"\n  %s: \{\n    name: \"(\w+)\",\n    line: `(.*?)`,\n  \}," % key, docs, re.S)
            self.assertIsNotNone(m, key)
            self.assertEqual(m.group(1), kind)
            d = re.match(r"\{\{widget:(\w+):(\{.*?\})\}\} — (.*)$", m.group(2), re.S)
            example = {k: v for k, v in json.loads(d.group(2)).items() if k != "prompt"}
            text = GW.INSTRUMENTS[kind]
            self.assertIn(d.group(3), text, f"{key}: the DOCS text, word for word")
            self.assertIn(json.dumps(example, ensure_ascii=False, separators=(",", ":")) + " — " + d.group(3), text)
            self.assertEqual(GW.reachability(kind, example), [], f"{key}: the DOCS example is reachable")


class ReadingNewKinds(unittest.TestCase):
    """The blind verifier's reading of a stem, for the kinds of feature 003: agreement is about what the
    student is asked to build, not about the order the question happens to list things in."""

    def agrees(self, kind, spec, reading):
        self.assertEqual(GW.reachability(kind, spec), [], f"{kind} {spec}")
        return GW.reading_agrees(kind, spec, reading)

    def test_an_honest_reading_of_every_docs_example_agrees(self):
        for kind, spec in (("polygon_builder", {"mode": "construct", "shape": "rhombus"}),
                           ("polygon_builder", {"mode": "midsegment", "triangle": [[0, 0], [6, 0], [0, 6]], "apex": 0}),
                           ("polygon_builder", {"mode": "area", "shape": "triangle", "target": 6}),
                           ("solid_scaler", {"solid": "cylinder", "ask": "volume", "ratio": 8}),
                           ("box_plot_builder", {"data": [2, 4, 4, 5, 6, 7, 9, 12, 15]}),
                           ("venn_builder", {"sets": 2, "labels": ["Football", "Chess"], "mode": "shade", "target": "aOnly"}),
                           ("venn_builder", {"sets": 2, "labels": ["French", "German"], "mode": "counts", "total": 20,
                                             "regions": {"a": 8, "b": 5, "ab": 4, "n": 3}, "clues": {"a": 12, "b": 9}}),
                           ("area_model", {"mode": "expand", "a": 2, "b": -3}),
                           ("curve_sketcher", {"fn": "hyperbola", "coefs": [2, -1]})):
            honest = {k: v for k, v in spec.items() if k in GW.READING_FIELDS[kind]}
            self.assertEqual(self.agrees(kind, spec, honest), (True, ""), f"{kind} {spec}")

    def test_polygon_midsegment_is_the_same_triangle_and_apex_in_any_order(self):
        spec = {"mode": "midsegment", "triangle": [[0, 0], [6, 0], [0, 6]], "apex": 0}
        self.assertTrue(self.agrees("polygon_builder", spec, {"mode": "midsegment", "triangle": [[6, 0], [0, 6], [0, 0]],
                                                                "apex": 2})[0])
        self.assertFalse(self.agrees("polygon_builder", spec, {"mode": "midsegment", "triangle": [[0, 0], [6, 0], [0, 6]],
                                                                 "apex": 1})[0])
        self.assertFalse(self.agrees("polygon_builder", spec, {"mode": "construct", "shape": "right"})[0])
        self.assertFalse(self.agrees("polygon_builder", {"mode": "construct", "shape": "rectangle"},
                                     {"mode": "construct", "shape": "square"})[0])

    def test_a_solids_stated_measurements_must_be_the_ones_drawn(self):
        spec = {"solid": "cylinder", "ask": "volume", "ratio": 8}   # drawn with the defaults r 2, h 4
        self.assertTrue(self.agrees("solid_scaler", spec, dict(spec, dims={"r": 2, "h": 4}))[0])
        self.assertFalse(self.agrees("solid_scaler", spec, dict(spec, dims={"r": 3}))[0])
        self.assertTrue(self.agrees("solid_scaler", dict(spec, dims={"r": 3}), dict(spec, dims={"r": 3}))[0])
        self.assertFalse(self.agrees("solid_scaler", spec, dict(spec, ask="area"))[0])
        self.assertFalse(self.agrees("solid_scaler", spec, dict(spec, ratio=27))[0])

    def test_box_plot_data_is_a_multiset(self):
        spec = {"data": [9, 2, 4, 4, 15]}
        self.assertTrue(self.agrees("box_plot_builder", spec, {"data": [2, 4, 4, 9, 15]})[0])
        self.assertFalse(self.agrees("box_plot_builder", spec, {"data": [2, 4, 9, 15]})[0])

    def test_venn_letters_follow_the_labels(self):
        spec = {"sets": 2, "labels": ["Football", "Chess"], "mode": "shade", "target": "aOnly"}
        swapped = {"sets": 2, "labels": ["chess", "Football "], "mode": "shade"}
        self.assertTrue(self.agrees("venn_builder", spec, dict(swapped, target="bOnly"))[0])
        self.assertFalse(self.agrees("venn_builder", spec, dict(swapped, target="aOnly"))[0])
        comp = dict(spec, target="complementA")
        self.assertTrue(self.agrees("venn_builder", comp, dict(swapped, target="complementB"))[0])
        self.assertFalse(self.agrees("venn_builder", spec, dict(swapped, labels=["Chess", "Rugby"], target="bOnly"))[0])
        three = {"sets": 3, "labels": ["A", "B", "C"], "mode": "counts",
                 "regions": {"a": 1, "b": 2, "c": 3, "ab": 4, "ac": 5, "bc": 6, "abc": 7, "n": 8},
                 "clues": {"a": 17, "b": 19, "c": 21}}
        # read as C, A, B: the reading's a is the spec's c, its ab the spec's ac, …
        read = {"sets": 3, "labels": ["C", "A", "B"], "mode": "counts",
                "regions": {"a": 3, "b": 1, "c": 2, "ab": 5, "ac": 6, "bc": 4, "abc": 7, "n": 8},
                "clues": {"a": 21, "b": 17, "c": 19}, "total": 36}
        self.assertEqual(self.agrees("venn_builder", three, read), (True, ""))
        ok, why = self.agrees("venn_builder", three, dict(read, clues={"a": 21, "b": 17, "c": 18}))
        self.assertFalse(ok)
        self.assertIn("regions make it 19", why)
        self.assertFalse(self.agrees("venn_builder", three, dict(read, total=35))[0])
        self.assertFalse(self.agrees("venn_builder", three, dict(read, regions=dict(read["regions"], ab=4, bc=5)))[0])
        # the spec's clues are the word problem's numbers: a stem that never states them is refused
        self.assertFalse(self.agrees("venn_builder", three, {k: v for k, v in read.items() if k != "clues"})[0])

    def test_area_model_reads_the_factors_in_either_order(self):
        spec = {"mode": "factor", "a": 2, "b": -3}
        self.assertTrue(self.agrees("area_model", spec, {"a": -3, "b": 2})[0])
        self.assertFalse(self.agrees("area_model", spec, {"a": 3, "b": -2})[0])

    def test_a_malformed_reading_is_a_disagreement_not_a_crash(self):
        for kind, spec, reading in (
                ("venn_builder", {"sets": 2, "labels": ["A", "B"], "mode": "counts",
                                  "regions": {"a": 1, "b": 2, "ab": 3, "n": 4}},
                 {"sets": 2, "labels": ["A", "B"], "mode": "counts", "regions": [1, 2, 3, 4]}),
                ("polygon_builder", {"mode": "midsegment", "triangle": [[0, 0], [6, 0], [0, 6]], "apex": 0},
                 {"mode": "midsegment", "triangle": [[0, 0], [6, 0], [0, 6]], "apex": 5}),
                ("solid_scaler", {"solid": "box", "ask": "volume", "ratio": 8},
                 {"solid": "box", "ask": "volume", "ratio": 8, "dims": [1, 2, 3]}),
                ("area_model", {"mode": "expand", "a": 1, "b": 2}, {"a": 1})):
            ok, why = GW.reading_agrees(kind, spec, reading)
            self.assertFalse(ok, kind)
            self.assertTrue(why, kind)


class TheChecks(unittest.TestCase):
    def test_the_fixture_templates_pass_every_check(self):
        _, questions = built()
        problems, notes = GW.check_questions(questions, graph())
        self.assertEqual(problems, [])
        self.assertEqual(notes, [])

    def test_a_prerequisites_misconception_is_allowed_and_a_strangers_is_not(self):
        g = graph()
        g.d["misconceptions"]["mc:g10m8s4-1-1:midpoint-difference"] = {"lo_id": "lo:g10m8s4-1-1", "label": "…",
                                                                         "description": "…"}
        _, questions = built()
        q = next(q for q in questions if q["family"] == "wt:g10m8s3-1-2:gradient-line")
        q["choices"]["diagnostics"].append({"predicate": "intercept-wrong",
                                            "misconception_id": "mc:g10m8s4-1-1:midpoint-difference"})
        problems, _ = GW.check_questions([q], g)
        self.assertEqual(len(problems), 1)
        self.assertIn("neither this question's objective nor a prerequisite", problems[0])

    def test_a_dropped_misconception_loses_its_diagnostic_and_an_empty_widget_is_refused(self):
        g = graph()
        del g.d["misconceptions"]["mc:u2-3-1:direct-solved-as-inverse"]
        _, questions = built()
        problems, notes = GW.check_questions(questions, g)
        self.assertEqual(len(notes), 3)
        self.assertTrue(all("no diagnostic left" in p for p in problems))
        self.assertEqual(len(problems), 3)

    def test_before_s5_the_objective_is_read_from_the_id(self):
        g = graph()
        del g.d["misconceptions"]["mc:g10m8s3-1-1:run-over-rise"]
        _, questions = built()
        q = [x for x in questions if x["family"] == "wt:g10m8s3-1-2:gradient-line"]
        self.assertEqual(GW.check_questions(copy.deepcopy(q), g, pre_catalogue=True)[0], [])
        q[0]["choices"]["diagnostics"][0]["misconception_id"] = "mc:g10m2s2-1-1:not-yet-written"
        self.assertTrue(GW.check_questions(q, g, pre_catalogue=True)[0])

    def test_the_parent_must_be_a_question_of_the_objective(self):
        _, questions = built()
        q = copy.deepcopy(next(q for q in questions if q["lo_id"] == "lo:u5-3-1"))
        q["parent_question_id"] = "q:u2-3-1:001"
        problems, _ = GW.check_questions([q], graph())
        self.assertTrue(any("is on lo:u2-3-1" in p for p in problems))

    def test_a_template_of_a_kind_that_does_not_exist_is_a_gap(self):
        raw = json.loads((TEMPLATES / "u5-3-1--line-equation.json").read_text())
        # a kind no contract has (answer 6 approved venn_builder and its siblings, so an invented
        # name stands for "a kind nobody has approved yet")
        raw["kind"] = "zz_unapproved_kind"
        raw["parent_question_id"] = None
        ps = GW.check_template(raw)
        self.assertTrue(any("record a widget GAP" in p for p in ps))
        self.assertTrue(any("parent_question_id is required" in p for p in ps))


class BlindVerdicts(unittest.TestCase):
    def setUp(self):
        self.templates, self.questions = built()

    def apply(self, results):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d, "verify.json")
            p.write_text(json.dumps({"mode": "verify", "results": results}))
            return GW.apply_verdicts(self.templates, self.questions, [p])

    def test_clean_verdicts_accept_all_and_refuse_the_pre_v093_defect(self):
        acc, rej = self.apply([verdict(q) for q in self.questions])
        self.assertEqual(rej, {})
        self.assertEqual(len(acc), 4)
        # the same honest reading of the same stems, against the targets as they were until v0.9.3
        self.templates, self.questions = wdf.pre_v093_templates()
        acc, rej = self.apply([verdict(q) for q in self.questions])
        self.assertEqual(set(rej), {"wt:t2u2-2-1:domain-excluded"})
        self.assertIn("blind reading disagrees with the spec", " ".join(rej["wt:t2u2-2-1:domain-excluded"]))
        self.assertEqual(len(acc), 3)

    def test_each_failure_rejects_its_template_but_a_refused_mapping_is_held(self):
        vs = [verdict(q) for q in self.questions]
        by_family = {}
        for v, q in zip(vs, self.questions):
            by_family.setdefault(q["family"], []).append(v)
        by_family["wt:u5-3-1:line-equation"][0]["reachable"] = False
        by_family["wt:u2-3-1:variation-direct"][1]["predicates"][0]["matches"] = False
        by_family["wt:g10m8s3-1-2:gradient-line"][0]["template_sha"] = "stale"
        acc, rej = self.apply([v for v in vs])
        # decision 47: a refused MAPPING no longer rejects its template (it is held for a human); an
        # unreachable target, a disagreeing reading or a missing verdict still do
        self.assertEqual(acc, {"wt:t2u2-2-1:domain-excluded", "wt:u2-3-1:variation-direct"})
        self.assertEqual(set(rej), {"wt:u5-3-1:line-equation", "wt:g10m8s3-1-2:gradient-line"})
        self.assertIn("not verified", " ".join(rej["wt:g10m8s3-1-2:gradient-line"]))

    def test_silence_is_not_approval(self):
        acc, rej = self.apply([])
        self.assertEqual(acc, set())
        self.assertEqual(len(rej), 4)


class HeldMappings(unittest.TestCase):
    """Decision 47 (Samuel, answer 26: "Keep them, and let's human review"): a mapping the blind verifier did
    not confirm is HELD — out of `diagnostics`, so the app never shows it, never diagnoses with it and S5 never
    takes it as evidence — until a human keeps or drops it. A widget whose every mapping is held ships as a
    plain right/wrong widget; one with no mapping at all is still refused."""

    def setUp(self):
        self.templates, self.questions = built()
        self.fam = "wt:u2-3-1:variation-direct"
        self.mine = [q for q in self.questions if q["family"] == self.fam]

    def scan(self, results):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d, "verify.json")
            p.write_text(json.dumps({"mode": "verify", "run_id": "wf_test", "results": results}))
            return GW.verdict_scan(self.templates, self.questions, [p]) + (p.read_text(),)

    def test_refused_mappings_are_held_confirmed_ones_stay_active(self):
        vs = [verdict(q) for q in self.questions]
        q0 = self.mine[0]
        pred = q0["choices"]["diagnostics"][0]["predicate"]
        v0 = next(v for v in vs if v["question_id"] == q0["id"])
        v0["predicates"][0].update(matches=False, why="fires for a different reason")
        # the verifier writes the whole claim line where it was asked for the name: still that predicate's verdict
        for v in vs:
            for p in v["predicates"]:
                if v is not v0:
                    p["predicate"] = f'{p["predicate"]} ("…") -> mc:whatever'
        acc, rej, status, _ = self.scan(vs)
        self.assertIn(self.fam, acc)
        self.assertEqual(status[q0["id"]][pred], (False, "fires for a different reason"))
        n = GW.hold_pending(self.questions, status, verifier_runs=["wf_test"])
        self.assertEqual(n["held"], 1)
        held = q0["choices"]["pending_review"]
        self.assertEqual([(h["predicate"], h["why"]) for h in held], [(pred, "fires for a different reason")])
        self.assertNotIn(pred, {d["predicate"] for d in q0["choices"]["diagnostics"]})
        # the S5 evidence and the app read `diagnostics` only
        self.assertNotIn(f"{self.fam}#{pred}", {(d["ref"]) for d in GW.s5_widget_distractors([q0])})
        # every other question keeps its mappings active, and carries no held list
        self.assertTrue(all("pending_review" not in q["choices"] for q in self.questions if q is not q0))

    def test_all_held_ships_plain_and_no_mapping_is_still_refused(self):
        q0 = copy.deepcopy(self.mine[0])
        status = {q0["id"]: {d["predicate"]: (False, "no") for d in q0["choices"]["diagnostics"]}}
        GW.hold_pending([q0], status)
        self.assertEqual(q0["choices"]["diagnostics"], [])
        self.assertEqual(W.validate_widget(q0), [], "a widget whose every mapping is held ships as right/wrong")
        del q0["choices"]["pending_review"]
        self.assertTrue(any("no diagnostics" in p for p in W.validate_widget(q0)))

    def test_a_human_keeps_or_drops_a_held_mapping(self):
        q0 = copy.deepcopy(self.mine[0])
        preds = [d["predicate"] for d in q0["choices"]["diagnostics"]]
        status = {q0["id"]: {p: (False, "no") for p in preds}}
        with tempfile.TemporaryDirectory() as d:
            f = Path(d, "review.json")
            f.write_text(json.dumps({"reviewer": "Samuel", "verdicts": {GW.mapping_key(q0["id"], preds[0]): "keep"}}))
            reviews = GW.load_mapping_reviews([f])
            f.write_text(json.dumps({"verdicts": {GW.mapping_key(q0["id"], preds[0]): "maybe"}}))
            with self.assertRaises(ValueError):
                GW.load_mapping_reviews([f])
        n = GW.hold_pending([q0], status, reviews)
        self.assertEqual(n["kept_by_review"], 1)
        self.assertEqual([d["predicate"] for d in q0["choices"]["diagnostics"]], [preds[0]])
        q1 = copy.deepcopy(self.mine[0])
        n = GW.hold_pending([q1], status, {GW.mapping_key(q1["id"], p): {"verdict": "drop"} for p in preds})
        self.assertEqual((n["dropped_by_review"], q1["choices"]["diagnostics"]), (len(preds), []))
        self.assertNotIn("pending_review", q1["choices"])

    def test_the_review_queue_names_the_claim_and_the_reason(self):
        q0 = copy.deepcopy(self.mine[0])
        pred = q0["choices"]["diagnostics"][0]["predicate"]
        GW.hold_pending([q0], {q0["id"]: {pred: (False, "a no-op on these numbers")}})
        with tempfile.TemporaryDirectory() as d:
            p = Path(d, "v.json")
            p.write_text(json.dumps({"results": [verdict(q0)]}))
            queue = GW.pending_queue([q0], graph(), [p])
        (it,) = queue["items"]
        self.assertEqual((it["key"], it["predicate"], it["why"]), (GW.mapping_key(q0["id"], pred), pred,
                                                                  "a no-op on these numbers"))
        self.assertEqual(it["stem"], q0["stem"])
        self.assertTrue(it["misconception_label"])


class ReadingValuesWrittenAsStrings(unittest.TestCase):
    """s7-v5's verify schema typed no reading field, and the Chapter 8 verifier wrote values as strings:
    "[3, -2]", "-1/2", "[1, 0], the midpoint of …". A string that holds a value is read as that value; the
    agreement rule itself is unchanged, so a wrong value — or words — still disagrees."""

    def test_a_value_in_a_string_is_the_value(self):
        pp = {"target": [3, -2]}
        for said in ("[3, -2]", " [3,-2] ", "(3, -2)", "(3; -2)", "[3, -2], the other end point of AB"):
            self.assertEqual(GW.reading_agrees("pair_plotter", pp, {"target": said}), (True, ""), said)
        line = {"mode": "equation", "m": -0.5, "b": 3}
        self.assertTrue(GW.reading_agrees("line_drawer", line, {"mode": "equation", "m": "-1/2", "b": "3"})[0])
        nl = {"mode": "interval", "range": [-6, 6], "from": 2, "to": 6, "openFrom": True, "openTo": False}
        self.assertTrue(GW.reading_agrees("number_line_marker", nl, dict(nl, openFrom="true", openTo="false"))[0])

    def test_a_wrong_value_or_words_still_disagree(self):
        pp = {"target": [3, -2]}
        for said in ("[-2, 3]", "[3, -2, 1]", "B is three to the right", "3, -2", "[3, -2]the end"):
            self.assertFalse(GW.reading_agrees("pair_plotter", pp, {"target": said})[0], said)
        self.assertFalse(GW.reading_agrees("line_drawer", {"mode": "equation", "m": -0.5, "b": 3},
                                           {"mode": "equation", "m": "1/2", "b": 3})[0])
        self.assertFalse(GW.reading_agrees("circle_builder", {"element": "chord"}, {"element": "\"chord\" or a diameter"})[0])


class S5GetsVerifiedMappingsOnly(unittest.TestCase):
    def test_a_rejected_templates_mappings_never_reach_s5(self):
        _, questions = built()
        every = GW.s5_widget_distractors(questions)
        self.assertEqual({d["ref"].split("#")[0] for d in every}, {q["family"] for q in questions})
        keep = {"wt:u5-3-1:line-equation"}
        some = GW.s5_widget_distractors(questions, keep)
        self.assertTrue(some)
        self.assertEqual({d["ref"].split("#")[0] for d in some}, keep)
        self.assertEqual(GW.s5_widget_distractors(questions, set()), [])


class GapReport(unittest.TestCase):
    def test_every_chapter_is_listed_and_gaps_name_the_kind_they_need(self):
        _, questions = built()
        with tempfile.TemporaryDirectory() as d:
            gaps = Path(d, "author.json")
            gaps.write_text(json.dumps({"gaps": [{"lo_id": "lo:g10m2s2-1-1", "need_kind": "power_builder",
                                                   "description": "…", "why": "no kind shows exponent laws"}]}))
            rep = GW.gap_report("g10-math", "course:us-g10-math-en", graph(), questions, [gaps])
        by_mod = {c["module"]: c for c in rep["chapters"]}
        self.assertEqual(by_mod["module:g10m-c08"]["status"], "covered")
        self.assertEqual(by_mod["module:g10m-c08"]["kinds"], ["line_drawer"])
        self.assertEqual(by_mod["module:g10m-c02"]["status"], "gap")
        self.assertEqual(rep["uncovered_chapters"], ["module:g10m-c02"])
        self.assertEqual(rep["proposed_kinds"]["power_builder"]["modules"], ["module:g10m-c02"])
        # the shape coverage_report.py reads: a flat list, each gap naming its module, unsigned
        self.assertEqual([(g["module"], g["signed_off"]) for g in rep["gaps"]], [("module:g10m-c02", None)])

    def test_an_unexamined_uncovered_chapter_still_gets_a_gap(self):
        rep = GW.gap_report("g10-math", "course:us-g10-math-en", graph(), [], [])
        self.assertEqual(sorted(g["module"] for g in rep["gaps"]), ["module:g10m-c02", "module:g10m-c08"])
        self.assertTrue(all(g["need_kind"] == "unexamined" for g in rep["gaps"]))

    def test_a_rerun_keeps_every_human_signature(self):
        first = GW.gap_report("g10-math", "course:us-g10-math-en", graph(), [], [])
        for g in first["gaps"]:
            g["signed_off"] = {"by": "Samuel", "at": "2026-09-26", "note": "accepted for launch"}
        _, questions = built()  # chapter 8 now has widgets; chapter 2 still does not
        again = GW.gap_report("g10-math", "course:us-g10-math-en", graph(), questions, [], previous=first)
        by_mod = {g["module"]: g for g in again["gaps"]}
        self.assertEqual(by_mod["module:g10m-c02"]["signed_off"]["by"], "Samuel")
        self.assertTrue(by_mod["module:g10m-c08"].get("carried"), "a signature is kept, never dropped")

    def test_the_readers_rule_counts_only_signed_gaps(self):
        # coverage_report.py (S8, `module_widgets`) counts a chapter as covered by a gap when
        # {g["module"] for g in gaps if (g.get("signed_off") or {}).get("by")} contains it.
        rep = GW.gap_report("g10-math", "course:us-g10-math-en", graph(), [], [])
        signed = lambda r: {g.get("module") for g in r["gaps"] if (g.get("signed_off") or {}).get("by")}
        self.assertEqual(signed(rep), set())
        rep["gaps"][0]["signed_off"] = {"by": "Samuel", "at": "2026-09-26", "note": "…"}
        self.assertEqual(signed(rep), {rep["gaps"][0]["module"]})


class NormalisingAuthorErrors(unittest.TestCase):
    """The two S7 author errors the pipeline fixes mechanically, recorded in the template's notes; the checks
    keep refusing the raw template, and anything else goes back to the author."""

    def setUp(self):
        self.g = graph()
        self.g.d["misconceptions"]["mc:g10m8s4-1-1:midpoint-difference"] = {"lo_id": "lo:g10m8s4-1-1", "label": "…",
                                                                              "description": "…"}
        self.good = json.loads((TEMPLATES / "g10m8s3-1-2--gradient-line.json").read_text())

    def refused(self, raw):
        with tempfile.TemporaryDirectory() as d:
            Path(d, "t.json").write_text(json.dumps(raw))
            templates, problems = GW.load_templates(Path(d))
            self.assertEqual(problems, [])
            qs, _ = GW.build_from_templates(templates)
            return GW.check_questions(qs, self.g)[0]

    def test_a_strangers_misconception_is_dropped_while_an_own_one_remains(self):
        author = copy.deepcopy(self.good)
        author["diagnostics"].append({"predicate": "intercept-wrong",
                                      "misconception_id": "mc:g10m8s4-1-1:midpoint-difference"})
        self.assertTrue(any("FR-1215" in p for p in self.refused(author)))
        out, done = GW.normalise_template(author, self.g)
        self.assertEqual([x.split(":")[0] for x in done], ["drop-foreign-diagnostic"])
        self.assertEqual(out["diagnostics"], self.good["diagnostics"])   # the prerequisite's (run-over-rise) stays
        self.assertEqual(self.refused(out), [])
        self.assertIn(GW.NORMALISED, out["notes"])
        self.assertEqual(GW.normalise_template(out, self.g), (out, []))   # a fixpoint

    def test_a_predicate_mapped_twice_keeps_its_first_mapping(self):
        author = copy.deepcopy(self.good)
        author["diagnostics"].append({"predicate": "points-swapped", "misconception_id": "mc:g10m8s3-1-1:run-over-rise"})
        self.assertTrue(any("mapped twice" in p for p in self.refused(author)))
        out, done = GW.normalise_template(author, self.g)
        self.assertEqual([x.split(":")[0] for x in done], ["drop-duplicate-predicate"])
        self.assertEqual(out["diagnostics"], self.good["diagnostics"])
        self.assertEqual(self.refused(out), [])

    def test_a_template_with_no_diagnostic_of_its_own_goes_back_to_the_author(self):
        author = dict(self.good, diagnostics=[{"predicate": "points-swapped",
                                               "misconception_id": "mc:g10m8s4-1-1:midpoint-difference"}])
        self.assertEqual(GW.normalise_template(author, self.g), (author, []))

    def test_a_clean_template_is_left_alone(self):
        for f in sorted(TEMPLATES.glob("*.json")):
            raw = json.loads(f.read_text())
            self.assertEqual(GW.normalise_template(raw, graph())[1], [], f.name)


class MergingAuthorRuns(unittest.TestCase):
    """A re-authored lesson (--only-lessons) replaces its earlier record whole; nothing stale survives."""

    def run_file(self, d, name, records, gaps=None, run_id=None):
        p = Path(d, name)
        top = gaps if gaps is not None else [g for r in records for g in r["gaps"]]
        p.write_text(json.dumps({"mode": "author", "book": "g10-math", "prompts_version": "s7-vX",
                                 "run_id": run_id or name, "records": records, "gaps": top}))
        return p

    def tpl(self, lo, slug):
        raw = json.loads((TEMPLATES / "g10m8s3-1-2--gradient-line.json").read_text())
        return dict(raw, id=f"wt:{lo.removeprefix('lo:')}:{slug}", lo_id=lo)

    def test_a_later_run_replaces_a_lessons_record_whole(self):
        with tempfile.TemporaryDirectory() as d:
            old = self.run_file(d, "author-old.json", [
                {"lesson": "g10m8s3-2", "templates": [self.tpl("lo:g10m8s3-2-1", "line-a")],
                 "gaps": [{"lo_id": "lo:g10m8s3-2-2", "need_kind": "classifier", "description": "", "why": ""}]},
                {"lesson": "g10m8s4-1", "templates": [self.tpl("lo:g10m8s4-1-1", "plot-midpoint")], "gaps": []}],
                gaps=[{"lo_id": "lo:g10m8s3-2-2", "need_kind": "classifier", "description": "", "why": ""},
                      {"lo_id": "lo:g10m8s1-1-1", "need_kind": "unexamined", "description": "", "why": "no answer"}])
            new = self.run_file(d, "author-new.json", [
                {"lesson": "g10m8s3-2", "templates": [self.tpl("lo:g10m8s3-2-2", "construct-rectangle")], "gaps": []}])
            m = GW.merge_author_runs([old, new])
            by = {r["lesson"]: r for r in m["records"]}
            self.assertEqual(sorted(by), ["g10m8s1-1", "g10m8s3-2", "g10m8s4-1"])
            self.assertEqual([t["id"] for t in by["g10m8s3-2"]["templates"]], ["wt:g10m8s3-2-2:construct-rectangle"])
            self.assertEqual(by["g10m8s3-2"]["source"], "author-new.json")
            self.assertEqual([g["need_kind"] for g in m["gaps"]], ["unexamined"])   # the closed gap is gone
            # order is the rule: the other way round, the old record wins
            self.assertEqual(GW.merge_author_runs([new, old])["records"][1]["source"], "author-old.json")

            wdir = Path(d, "widgets")
            written, problems = GW.write_templates(m, wdir)
            self.assertEqual(problems, [])
            self.assertEqual(sorted(p.name for p in written),
                             ["g10m8s3-2-2--construct-rectangle.json", "g10m8s4-1-1--plot-midpoint.json"])
            self.assertEqual(GW.write_templates(m, wdir), ([], []))   # idempotent: identical files are left
            # a superseded template on disk, or a hand-edited one, stops the write: nothing is overwritten
            (wdir / "g10m8s3-2-1--line-a.json").write_text("{}")
            _, problems = GW.write_templates(m, wdir)
            self.assertTrue(any("does not hold" in p for p in problems))
            (wdir / "g10m8s3-2-1--line-a.json").unlink()
            (wdir / "g10m8s4-1-1--plot-midpoint.json").write_text("{}\n")
            _, problems = GW.write_templates(m, wdir)
            self.assertTrue(any("differs" in p for p in problems))

    def test_the_command_line_needs_no_database(self):
        with tempfile.TemporaryDirectory() as d:
            a = self.run_file(d, "author-a.json", [
                {"lesson": "g10m8s4-1", "templates": [self.tpl("lo:g10m8s4-1-1", "plot-midpoint")], "gaps": []}])
            env = {k: v for k, v in os.environ.items() if k != "AINEXT_DB_DSN"}
            r = subprocess.run([sys.executable, str(EX / "generate_widget_questions.py"), "--merge-author-runs", str(a),
                                "--merged", str(Path(d, "merged.json")), "--write-templates", str(Path(d, "w"))],
                               capture_output=True, text=True, cwd=EX, env=env)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertTrue(Path(d, "w", "g10m8s4-1-1--plot-midpoint.json").exists())
            self.assertEqual(json.loads(Path(d, "merged.json").read_text())["merged_from"][0]["file"], "author-a.json")


class TheCommandLine(unittest.TestCase):
    def test_no_dsn_no_bundle(self):
        env = {k: v for k, v in os.environ.items() if k != "AINEXT_DB_DSN"}
        with tempfile.TemporaryDirectory() as d:
            r = subprocess.run([sys.executable, str(EX / "generate_widget_questions.py"), "--out", str(Path(d, "w.json"))],
                               capture_output=True, text=True, cwd=EX, env=env)
        self.assertEqual(r.returncode, 2)
        self.assertIn("--dsn", r.stderr)

    def test_the_legacy_templates_build_the_committed_bank(self):
        committed = json.loads((EX / "seed" / "generated" / "widget-questions.json").read_text())["questions"]
        keep = {"id", "lo_id", "tier", "question_type", "stem", "choices", "correct_answer", "canonical_solution",
                "source_note"}
        mine = {q["id"]: q for q in GW.build()}
        self.assertEqual(mine, {q["id"]: {k: v for k, v in q.items() if k in keep} for q in committed})


if __name__ == "__main__":
    with contextlib.redirect_stdout(io.StringIO()):
        unittest.main()
