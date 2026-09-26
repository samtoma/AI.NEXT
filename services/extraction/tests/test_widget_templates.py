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

    def test_every_live_widget_is_reachable(self):
        for q in GW.build():
            self.assertEqual(GW.reachability(q["choices"]["kind"], q["choices"]["spec"]), [], q["id"])

    def test_the_pipeline_is_stricter_about_empty_events(self):
        self.assertEqual(GW.reachability("sample_space", {"rows": 6, "cols": 6,
                                                          "rule": {"kind": "sum", "op": "eq", "value": 13}}),
                         ["the event holds no outcome (pipeline rule, stricter than the app)"])

    @unittest.skipUnless(shutil.which("node"), "node is not installed")
    def test_the_python_port_agrees_with_the_apps_typescript(self):
        ts = REPO / "app" / "src" / "lib" / "widget-payloads.ts"
        script = ("const m = await import(process.argv[1]); const cases = JSON.parse(process.argv[2]);"
                  "console.log(JSON.stringify(cases.map(([k, s]) => m.parseMathWidget(k, s) !== null)))")
        out = subprocess.run(["node", "--no-warnings", "--input-type=module", "-e", script, ts.as_uri(),
                              json.dumps(self.CASES)], capture_output=True, text=True, check=True)
        app = json.loads(out.stdout)
        for (kind, spec), accepted in zip(self.CASES, app):
            self.assertEqual(GW.reachability(kind, spec) == [], accepted, f"{kind} {spec}")


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

    def test_each_failure_rejects_its_template(self):
        vs = [verdict(q) for q in self.questions]
        by_family = {}
        for v, q in zip(vs, self.questions):
            by_family.setdefault(q["family"], []).append(v)
        by_family["wt:u5-3-1:line-equation"][0]["reachable"] = False
        by_family["wt:u2-3-1:variation-direct"][1]["predicates"][0]["matches"] = False
        by_family["wt:g10m8s3-1-2:gradient-line"][0]["template_sha"] = "stale"
        acc, rej = self.apply([v for v in vs])
        self.assertEqual(acc, {"wt:t2u2-2-1:domain-excluded"})  # the one template with no failure
        self.assertEqual(set(rej), {"wt:u5-3-1:line-equation", "wt:u2-3-1:variation-direct",
                                    "wt:g10m8s3-1-2:gradient-line"})
        self.assertIn("not verified", " ".join(rej["wt:g10m8s3-1-2:gradient-line"]))

    def test_silence_is_not_approval(self):
        acc, rej = self.apply([])
        self.assertEqual(acc, set())
        self.assertEqual(len(rej), 4)


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
