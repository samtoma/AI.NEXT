"""COLLECT-2: the Chapter 8 pilot's false "disputed" items, fixed in lesson.workflow.js's deterministic
collection (no prompt changed), plus S0b's aligned-derivation hash and the bundle's align* rendering.

    uv run --with pytest python -m pytest -q tests/test_lesson_collect2.py

@covers FR-4302, FR-4303, FR-4407, FR-4308

What each test pins (none weakens the three-way rule — each shows a real disagreement still held):
  * a final answer stated with the left side of an aligned derivation IS in the book solution; a final
    the solution does not contain (a value changed, a final copied from another item) is still refused;
  * a sentence-form final is compared by its maths; a printed list's "and" is its comma; a flattened
    printed left side ("mAC = −15 7"); an equation either way round; \\frac{-2}{3} is -\\frac{2}{3} —
    and "x = 3" is still NOT the answer "x = 2 or x = 3";
  * a batch an agent left unanswered (off task: the harness relays the user's latest message) is asked
    again once for the missing items only; what is still missing is UNCHECKED, not a book dispute;
  * S0b: an aligned derivation's image is named md5(its lines, no environment, `&` as `&amp;`); a
    transcription is stored with a real `&` in align*, never an entity; md5check proves it;
  * the bundle writes align* inside the app's inline `$…$` as aligned (KaTeX refuses align* inline);
  * lesson-v4: a choice whose options are a figure's labels (options_source "figure") is checked as
    exactly that — the item has a figure, each option is one label, named alike — and still needs the
    blind re-solve to agree.
No model is called.
"""

from __future__ import annotations

import copy
import hashlib
import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

HERE = Path(__file__).resolve().parent
EX = HERE.parent
for p in (str(EX), str(HERE)):
    if p not in sys.path:
        sys.path.insert(0, p)

NODE = shutil.which("node")
WORKFLOW = EX / "runbook" / "lesson.workflow.js"
STUB = HERE / "workflow_stub.mjs"
ALIGN_SOL = ["First we recall the equation for distance: $\\begin{align*}d_{AB}&=\\sqrt{(1+2)^{2}+(-3-3)^{2}}"
             "\\\\&=\\sqrt{45}\\\\&\\approx\\text{6,71}\\end{align*}$"]


def item(ref, stem, solution, printed=None, figures=()):
    return {"ref": ref, "lo": "lo:zz8s2-1-1", "printed_page": 1, "section": "8.2", "shortcode": None,
            "end_of_chapter": False, "stem": stem, "solution": solution, "solution_provenance": "book_worked_epub",
            "printed_answer": printed, "printed_answer_scope": "item" if printed else None,
            "figures": list(figures), "figures_missing": []}


def lesson_args(items):
    return {"book": {"book": "zz", "multiplication_dot": False}, "stage": "S2-S4,S8", "viz_kinds": [],
            "options": {"blind_batch": 16, "typing_batch": 30, "figures_per_call": 16, "tier_sample_every": 5},
            "lessons": [{"slug": "zz8s2-1", "title": "Distance", "module": "module:zz", "chapter": 8, "provenance": {},
                         "objectives": [{"id": "lo:zz8s2-1-1", "statement": "Calculate a distance", "label": "Distance",
                                         "exercise_items": [i["ref"] for i in items], "worked_examples": []}],
                         "blocks": [], "subheadings": [], "worked_examples": [], "items": items, "figures": [],
                         "teacher_only": [], "unmapped_worked_examples": []}]}


def run(args, responses):
    with tempfile.TemporaryDirectory() as d:
        f = Path(d, "fx.json")
        f.write_text(json.dumps({"args": args, "responses": responses}))
        out = subprocess.run([NODE, str(STUB), str(WORKFLOW), str(f)], capture_output=True, text=True, check=True)
    rep = json.loads(out.stdout)
    assert rep["ok"], rep["error"]
    return rep


def typing(ref, key, final, answer_type="numeric", **kw):
    return dict(ref=ref, answer_type=answer_type, key=key, book_final=final, tier="standard", **kw)


def base_responses(items, types, blinds, judge=None):
    r = {"S2:claims:zz8s2-1": {"claims": []},
         "S3:type:zz8s2-1:1": {"items": types},
         "S3:blind:zz8s2-1:1": {"answers": blinds},
         "S3:tier:zz8s2-1": {"tiers": []},
         "S3:judge:zz8s2-1:1": judge or {"verdicts": []},
         "S8:oracle:zz8s2-1": {"verdict": "GREEN", "subheadings": [{"anchor": "zz8s2-1", "status": "covered"}]}}
    return r


@unittest.skipUnless(NODE, "node runs the workflow through the stub runtime")
class Collect2(unittest.TestCase):
    def one(self, it, t, blind_answer, judge=None):
        rep = run(lesson_args([it]), base_responses([it], [t], [{"ref": it["ref"], "final_answer": blind_answer, "markable": True}], judge))
        return rep, rep["result"]["lessons"][0]["items"][0]

    def test_a_final_stated_with_the_aligned_left_side_is_in_the_solution(self):
        it = item("Ex8-2:1", "Calculate $AB$ to 2 decimal places.", ALIGN_SOL, "6,71")
        rep, x = self.one(it, typing("Ex8-2:1", "6,71", "$d_{AB} \\approx\\text{6,71}$"), "6.71")
        self.assertEqual(x["typing_problems"], [])
        self.assertEqual(x["verification"], "agreed")
        self.assertEqual(rep["result"]["collect_version"], "collect-4")

    def test_a_final_the_solution_does_not_contain_is_still_refused(self):
        it = item("Ex8-2:1", "Calculate $AB$.", ALIGN_SOL, "6,71")
        for wrong in ("$d_{AB} \\approx\\text{6,72}$", "Two sides are equal, therefore it is isosceles."):
            _, x = self.one(it, typing("Ex8-2:1", "6,71", wrong), "6.71")
            self.assertIn("book_final is not in the book solution", x["typing_problems"])
            self.assertNotEqual(x["verification"], "agreed")
            self.assertEqual(x["verify"]["unchecked"], ["book_final is not in the book solution"])

    def test_sentence_finals_lists_flattened_left_sides_and_equations_either_way(self):
        cases = [  # (printed, solution, typing, blind, the routes each pair must take)
            ("A(3; −4), B(3; −3) and E(5; −4).", ["$A(3;-4)$ , $B(3;-3)$ and $E(5;-4)$ ."],
             typing("Ex8-1:2", "A(3;-4), B(3;-3), E(5;-4)", "$A(3;-4)$ , $B(3;-3)$ and $E(5;-4)$ .", "expression",
                    marker_kind="coordinates", variables=[]), "A(3;-4), B(3;-3), E(5;-4)",
             # a list's "and" is its comma, on either side (COLLECT-3; COLLECT-2 read it on the printed side only)
             {"blind~printed": "normalised", "blind~book": "normalised", "book~printed": "normalised"}),
            ("mAC = −15 7", ["$\\begin{align*}m_{AC}&=\\frac{-5-10}{3+4}\\\\&=-\\frac{15}{7}\\end{align*}$"],
             typing("Ex8-6:44e", "-\\frac{15}{7}", "$m_{AC}=-\\frac{15}{7}$", "expression", marker_kind="expression",
                    variables=[]), "-\\frac{15}{7}",
             {"blind~printed": "signature", "blind~book": "normalised", "book~printed": "signature"}),
            ("4", ["$\\begin{align*}\\frac{y-2}{1}&=2\\\\4&=y\\end{align*}$"],
             typing("Ex8-3:5", "4", "$4=y$"), "y=4",
             {"blind~printed": "normalised", "blind~book": "normalised", "book~printed": "normalised"}),
            ("−10 3", ["$y=\\frac{-10}{3}$"], typing("Ex8-3:7", "-\\frac{10}{3}", "$y=\\frac{-10}{3}$", "expression",
                                                       marker_kind="expression", variables=[]), "-\\frac{10}{3}",
             {"blind~printed": "signature", "blind~book": "normalised", "book~printed": "signature"}),
        ]
        for printed, sol, t, blind, routes in cases:
            it = item(t["ref"], "Find it.", sol, printed)
            judge = {"verdicts": [{"pair_id": f"{t['ref']}|{k}", "verdict": "equivalent"} for k in routes]}
            _, x = self.one(it, t, blind, judge)
            self.assertEqual(x["typing_problems"], [], (t["ref"], x["typing_problems"]))
            got = {p["pair_id"].split("|")[1]: p["route"] for p in x["verify"]["pairs"]}
            self.assertEqual(got, routes, t["ref"])
            self.assertEqual(x["verification"], "agreed", (t["ref"], x["verify"]))

    def test_one_value_is_still_not_the_answer_of_two(self):
        it = item("Ex8-6:9", "Solve.", ["$x=2$ or $x=3$"], None)
        _, x = self.one(it, typing("Ex8-6:9", "x=3", "$x=2$ or $x=3$", "expression", marker_kind="values",
                                   variables=["x"]), "x=3", judge={"verdicts": [
                                       {"pair_id": "Ex8-6:9|blind~book", "verdict": "different"}]})
        self.assertEqual(x["verification"], "no_printed_answer")
        self.assertEqual(x["verify"]["pairs"][0]["route"], "judge", "never settled as the same answer")
        self.assertIn("does not read as the book final answer", " ".join(x["typing_problems"]))

    def test_an_unanswered_batch_is_asked_again_once_and_what_stays_missing_is_unchecked(self):
        items = [item(f"Ex8-2:{k}", f"Problem {k}: find $d$.", ALIGN_SOL, "6,71") for k in (1, 2, 3)]
        types = [typing(i["ref"], "6,71", "$d_{AB}\\approx\\text{6,71}$") for i in items]
        r = base_responses(items, types, [{"ref": "curriculum-grade-isolation", "final_answer": "Yes", "markable": True},
                                          {"ref": "Ex8-2:1", "final_answer": "6.71", "markable": True}])
        r["S3:blind:zz8s2-1:1:again"] = {"answers": [{"ref": "Ex8-2:2", "final_answer": "6.71", "markable": True}]}
        rep = run(lesson_args(items), r)
        again = next(c for c in rep["calls"] if c["label"] == "S3:blind:zz8s2-1:1:again")
        self.assertIn("[Ex8-2:2]", again["prompt"])
        self.assertIn("[Ex8-2:3]", again["prompt"])
        self.assertNotIn("[Ex8-2:1]", again["prompt"], "only the items left out are asked again")
        les = rep["result"]["lessons"][0]
        v = {i["ref"]: i["verification"] for i in les["items"]}
        self.assertEqual(v, {"Ex8-2:1": "agreed", "Ex8-2:2": "agreed", "Ex8-2:3": "disputed"})
        self.assertEqual(les["verify"]["unchecked"], [{"ref": "Ex8-2:3", "missing": ["no blind re-solve answer"]}])
        self.assertEqual(les["verify"]["off_task"], ["blind 1: curriculum-grade-isolation"])
        self.assertEqual(sum(c["label"].endswith(":again") for c in rep["calls"]), 1, "once")

    def test_versions(self):
        """collect-2 changed no prompt; lesson-v4 changed the TYPING prompt only (options_source "figure")."""
        src = WORKFLOW.read_text()
        self.assertIn("const PROMPTS_VERSION = 'lesson-v4'", src)
        self.assertIn("const COLLECT_VERSION = 'collect-4'", src)


FIG = "/w/figures/tikzpicture__points.png"


@unittest.skipUnless(NODE, "node runs the workflow through the stub runtime")
class FigureOptions(unittest.TestCase):
    """lesson-v4: "Which point lies at (5; −4)?" with the answer one of a figure's labels is a natural
    choice question whose options come from the FIGURE, not the stem. The check is exact about what it
    can know; the label set itself is not data for this book, so the blind re-solve (which reads the
    figure) must still land on the printed label."""

    def typed(self, stem, options, key, figures=(FIG,), printed=None, blind=None):
        it = item("Ex8-1:3", stem, ["Doing so we find that point $E$ lies at the coordinates $(5;-4)$ ."],
                  printed if printed is not None else key, figures)
        t = typing("Ex8-1:3", key, "$E$", "choice", options=options, options_source="figure")
        rep = run(lesson_args([it]), base_responses([it], [t], [{"ref": "Ex8-1:3", "final_answer": blind or key,
                                                                 "markable": True}]))
        return rep["result"]["lessons"][0]["items"][0]

    def test_the_prompt_offers_the_figure_source(self):
        src = WORKFLOW.read_text()
        self.assertIn("enum: ['', 'stem', 'figure', 'lesson']", src)
        self.assertIn('(options_source "figure")', src)

    def test_point_and_shape_labels_are_accepted(self):
        stem = "You are given the following diagram, with various points shown: [figure] Which point lies at $(5;-4)$ ?"
        x = self.typed(stem, ["A", "B", "C", "D", "E"], "E")
        self.assertEqual(x["typing_problems"], [])
        self.assertEqual(x["options_source"], "figure")
        self.assertEqual(x["verification"], "agreed")
        shapes = "You are given the following diagram, with 4 shapes drawn. [figure] Which shape is the reflection?"
        x = self.typed(shapes, ["shape W", "shape X", "shape Y", "Shape Z"], "Shape Z")
        self.assertEqual(x["typing_problems"], [])

    def test_what_is_not_a_figures_label_is_refused(self):
        stem = "You are given the following diagram, with various points shown: [figure] Which point lies at $(5;-4)$ ?"
        cases = [
            (dict(options=["A", "B", "E"], key="E", figures=()), "the item has no figure"),
            (dict(options=["(5; -4)", "(3; 3)"], key="(5; -4)"), "not all single labels"),
            (dict(options=["point A", "shape E"], key="shape E"), "do not name them alike"),
            (dict(options=["vertex A", "vertex E"], key="vertex E"), 'call them "vertex", a word the stem does not use'),
            (dict(options=["A", "E", "E"], key="E"), "repeat a label"),
        ]
        for kw, why in cases:
            x = self.typed(stem, **kw)
            # a typing problem holds the item until G2 fixes or excludes it (assemble_objectives lesson-runs)
            self.assertTrue(any(why in p for p in x["typing_problems"]), (kw, x["typing_problems"]))

    def test_the_blind_re_solve_still_decides(self):
        stem = "You are given the following diagram, with various points shown: [figure] Which point lies at $(5;-4)$ ?"
        x = self.typed(stem, ["A", "B", "C", "D", "E"], "E", blind="D")
        self.assertEqual(x["typing_problems"], [])
        self.assertNotEqual(x["verification"], "agreed", "a label the blind solver did not pick is not agreed")


@unittest.skipUnless(NODE, "node runs the workflow through the stub runtime")
class Collect3(unittest.TestCase):
    """COLLECT-3: the five lesson-v4 runs of Chapter 8. Each fix is shown with the answer it must
    still REFUSE, so no rule is read looser than it was."""

    def one(self, it, t, blind, judge=None, blind_markable=True):
        rep = run(lesson_args([it]), base_responses([it], [t], [{"ref": it["ref"], "final_answer": blind,
                                                                 "markable": blind_markable}], judge))
        return rep, rep["result"]["lessons"][0]["items"][0]

    def problems(self, it, t, blind="x"):
        return self.one(it, t, blind)[1]["typing_problems"]

    def test_a_values_key_reads_as_the_printed_set_and_a_different_set_does_not(self):
        it = item("Ex8-2:6a", "Find the missing coordinate.", ["$x=3$ or $x=9$"], "x = 3 or x = 9")
        ok = typing("Ex8-2:6a", "3; 9", "$x=3$ or $x=9$", "expression", marker_kind="values", variables=["x"])
        self.assertEqual(self.problems(it, ok), [])
        self.assertEqual(self.problems(it, dict(ok, key="9; 3")), [], "a set has no order")
        for wrong in ("3; 8", "3", "3; 9; 12"):
            self.assertTrue(any("does not read as the printed answer" in p for p in self.problems(it, dict(ok, key=wrong))), wrong)

    def test_a_named_point_a_chain_of_names_and_a_sentence_final(self):
        cases = [  # (printed, solution, key, book_final)
            ("M (1; 0)", ["The mid-point is at $M\\left(1;0\\right)$ ."], "(1; 0)", "The mid-point is at $M\\left(1;0\\right)$"),
            ("T ( −1; 1 2 )", ["$T(-1;\\frac{1}{2})$"], "(-1; \\frac{1}{2})", "$T(-1;\\frac{1}{2})$"),
            ("P (x; y) = (8; 12)", ["$\\therefore P(x;y)=(8;12)$"], "(8; 12)", "$\\therefore P(x;y)=(8;12)$"),
            ("dAC = dBD = √ 26", ["Therefore $d_{AC}=d_{BD}=\\sqrt{26}$ ."], "\\sqrt{26}", "Therefore $d_{AC}=d_{BD}=\\sqrt{26}$ ."),
            (None, ["Write the final answer: The coordinates of point $D$ are $\\left(4;-10\\right)$ ."], "(4; -10)",
             "The coordinates of point $D$ are $\\left(4;-10\\right)$"),
        ]
        for printed, sol, key, final in cases:
            it = item("Ex8-5:1", "Find it.", sol, printed)
            kind = "surd" if "sqrt" in key else "coordinates"
            self.assertEqual(self.problems(it, typing("Ex8-5:1", key, final, "expression", marker_kind=kind, variables=[])), [], key)
        # still refused: another point, or a function value read as a pair
        it = item("Ex8-5:1", "Find it.", ["$M(1;0)$"], "M (1; 0)")
        self.assertTrue(self.problems(it, typing("Ex8-5:1", "(1; 1)", "$M(1;0)$", "expression", marker_kind="coordinates", variables=[])))
        it = item("Ex8-5:1", "Find f(2).", ["$f(2)=5$"], "f(2) = 5")
        self.assertTrue(self.problems(it, typing("Ex8-5:1", "2", "$f(2)=5$", "numeric")), "f(2) is not the value 2")

    def test_book_finals_the_solution_holds_and_one_it_does_not(self):
        sol = ["$\\begin{align*}d_{FG}&=\\sqrt{(1-2)^{2}+(5-0)^{2}}\\\\&=\\sqrt{26}\\\\d_{GH}&=\\sqrt{4+4}\\\\&=\\sqrt{8}\\end{align*}$"]
        it = item("Ex8-6:19a", "Find the lengths.", sol, None)
        t = typing("Ex8-6:19a", "\\sqrt{26}; \\sqrt{8}", "$d_{FG}=\\sqrt{26}, d_{GH}=\\sqrt{8}$", "expression", marker_kind="values", variables=[])
        self.assertEqual(self.problems(it, t, "FG=\\sqrt{26}, GH=\\sqrt{8}"), [])
        bad = dict(t, book_final="$d_{FG}=\\sqrt{26}, d_{GH}=\\sqrt{9}$")
        self.assertIn("book_final is not in the book solution", self.problems(it, bad))
        area = ["$\\begin{align*}A&=\\frac{1}{2}bh\\\\&=\\frac{1}{2}(85)\\\\&=\\text{42,5}\\end{align*}$"]
        it = item("Ex8-4:19b", "Find the area.", area, "42,5 units")
        t = typing("Ex8-4:19b", "42,5", "$A=\\frac{1}{2}\\times 85=\\text{42,5}$")
        self.assertEqual(self.problems(it, t, "42.5"), [], "a chain the typing agent wrote out states A = 42,5")
        self.assertIn("book_final is not in the book solution", self.problems(it, dict(t, book_final="$A=\\frac{1}{2}\\times 85=\\text{42,6}$")))
        it = item("Ex8-6:6", "Find x.", ["$\\begin{align*}x&=(3)\\text{ or }(-9)\\end{align*}$ The appropriate value is $\\text{3}$ ."], "3")
        self.assertEqual(self.problems(it, typing("Ex8-6:6", "3", "$x=3$"), "x=3"), [], "the solution states the value as a whole segment")
        it = item("Ex8-6:6", "Find x.", ["$\\begin{align*}x&=(3)\\text{ or }(-9)\\end{align*}$ so $3x$ is ..."], "3")
        self.assertIn("book_final is not in the book solution", self.problems(it, typing("Ex8-6:6", "3", "$x=3$")))
        it = item("WE6", "Prove it.", ["Write the final answer: ${m}_{AB}={m}_{CD}$ therefore line $AB$ is parallel to line $CD$ ."], None)
        t = typing("WE6", "", "$m_{AB}=m_{CD}$ therefore line $AB$ is parallel to line $CD$.", "not_markable", not_markable_reason="proof")
        self.assertEqual(self.problems(it, t), [])

    def test_a_list_of_equations_is_never_read_as_a_chain(self):
        """The regression this round nearly shipped: "FG=√26, GH=2√2" ends like "d_{FG}=√26, d_{GH}=√8"
        only if a list is read as one chain. It is the judge's (√8 = 2√2), never settled here."""
        it = item("Ex8-6:19a", "Find the lengths.", ["$d_{FG}=\\sqrt{26}$ , $d_{GH}=\\sqrt{8}$"], None)
        t = typing("Ex8-6:19a", "\\sqrt{26}; \\sqrt{8}", "$d_{FG}=\\sqrt{26}, d_{GH}=\\sqrt{8}$", "expression", marker_kind="values", variables=[])
        _, x = self.one(it, t, "FG=\\sqrt{26}, GH=2\\sqrt{2}")
        self.assertEqual(x["verify"]["pairs"][0]["route"], "judge")

    def test_a_proof_both_call_not_markable_is_not_missing_a_check(self):
        it = dict(item("WE8", "Prove the points are on a line.", ["$m_{AB}=m_{BC}$ therefore they are collinear."], None),
                  kind="worked_example", solution_provenance="book_worked")
        t = typing("WE8", "", "$m_{AB}=m_{BC}$ therefore they are collinear.", "not_markable", not_markable_reason="proof")
        rep = run(dict(lesson_args([]), lessons=[dict(lesson_args([])["lessons"][0], items=[],
                  worked_examples=[{"ref": "WE8", "lo": "lo:zz8s2-1-1", "stem": it["stem"], "solution": it["solution"],
                                    "printed_page": 1, "figures": []}])]),
                  base_responses([], [t], [{"ref": "WE8", "final_answer": "", "markable": False}]))
        x = rep["result"]["lessons"][0]["items"][0]
        self.assertEqual(x["verification"], "agreed")
        self.assertEqual(x["verify"]["pairs"][0]["route"], "not_markable")
        # typing says markable, the blind solver says not: that disagreement is still held
        t2 = dict(t, answer_type="expression", key="m_{AB}=m_{BC}", marker_kind="equation", variables=[])
        rep = run(rep["meta"] and dict(lesson_args([]), lessons=[dict(lesson_args([])["lessons"][0], items=[],
                  worked_examples=[{"ref": "WE8", "lo": "lo:zz8s2-1-1", "stem": it["stem"], "solution": it["solution"],
                                    "printed_page": 1, "figures": []}])]),
                  base_responses([], [t2], [{"ref": "WE8", "final_answer": "", "markable": False}]))
        self.assertEqual(rep["result"]["lessons"][0]["items"][0]["verification"], "disputed")

    def test_a_figure_the_blind_solver_never_saw_makes_a_disagreement_unchecked_not_a_dispute(self):
        stem = "Given the following diagram: [figure] Find the mid-point of $BD$."
        it = item("Ex8-6:31c", stem, ["$M_{BD}=(\\frac{7}{2};1)$"], "( 7 2 ; 1 )")
        t = typing("Ex8-6:31c", "(\\frac{7}{2}; 1)", "$M_{BD}=(\\frac{7}{2};1)$", "expression", marker_kind="coordinates", variables=[])
        judge = {"verdicts": [{"pair_id": "Ex8-6:31c|blind~printed", "verdict": "different"},
                              {"pair_id": "Ex8-6:31c|blind~book", "verdict": "different"}]}
        rep, x = self.one(it, t, "\\text{Cannot be determined}", judge)
        self.assertEqual(x["verification"], "disputed", "still held")
        self.assertEqual(rep["result"]["lessons"][0]["verify"]["unchecked"],
                         [{"ref": "Ex8-6:31c", "missing": ["the blind solver was not shown the figure"]}])
        _, x = self.one(it, t, "(\\frac{7}{2};1)")    # the text sufficed: agreement stands
        self.assertEqual(x["verification"], "agreed")
        it2 = dict(it, figures=[FIG])                  # shown the figure: a disagreement is a dispute
        rep, x = self.one(it2, t, "(3;1)", judge)
        self.assertEqual(rep["result"]["lessons"][0]["verify"]["unchecked"], [])
        self.assertEqual([p["verdict"] for p in x["verify"]["pairs"][:2]], ["different", "different"])

    def test_a_numeric_key_is_stored_as_the_bare_number_the_check_read(self):
        """COLLECT-4: "\\text{0,5}" passed the check (it reads 0,5) but was stored with its wrapper,
        which assembly refuses as not a number."""
        it = item("Ex8-4:15", "Calculate the gradient.", ["$m=\\text{0,5}$"], "0,5")
        for key, want in (("\\text{0,5}", "0,5"), ("-\\text{0,5}", "-0,5"), ("5\\text{ cm}", "5")):
            _, x = self.one(it, typing("Ex8-4:15", key, "$m=\\text{0,5}$"), "0.5")
            self.assertEqual(x["answer"], want, key)
        _, x = self.one(it, typing("Ex8-4:15", "\\frac{1}{2}", "$m=\\text{0,5}$"), "0.5")
        self.assertIn('numeric key "\\frac{1}{2}" is not a number', x["typing_problems"], "a fraction is still refused")

    def test_three_verdicts_that_contradict_each_other_are_flagged(self):
        it = item("Ex8-4:20c", "Find the line.", ["$y=2x+12$"], "y = 2x + 12")
        t = typing("Ex8-4:20c", "y = 2x + 12", "$y=2x+12$", "expression", marker_kind="equation", variables=["x", "y"])
        judge = {"verdicts": [{"pair_id": "Ex8-4:20c|blind~printed", "verdict": "different"},
                              {"pair_id": "Ex8-4:20c|blind~book", "verdict": "equivalent"}]}
        _, x = self.one(it, t, "y=2x+7", judge)
        self.assertEqual(x["verification"], "disputed")
        self.assertIn("inconsistent", x["verify"])


class HeaderFigures(unittest.TestCase):
    """lesson-args attaches a question's shared figure ("Given the following diagram: [figure]") to
    every part, because every part's stem carries that text (COLLECT-3's cause, fixed at source)."""

    def test_every_part_of_a_question_carries_the_figure_its_lead_in_shows(self):
        if not NODE:
            self.skipTest("node runs S1 through the stub runtime")
        import assemble_objectives as ao
        import book_config
        import _objectives_fixture as fx
        from test_objectives import WORKFLOW as S1_WORKFLOW, good_responses
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            f = fx.build(tmp)
            book = book_config.load_book(f["book"])
            manifest = json.loads(f["manifest"].read_text())
            blocks = ao.load_blocks(f["blocks"])
            maths = ao.load_maths(f["maths"])
            s1 = ao.s1_args(book, manifest, blocks, maths, 8)
            rep = fx.run_workflow(S1_WORKFLOW, s1, good_responses(s1), tmp)
            (tmp / "s1.json").write_text(json.dumps(rep["result"]))
            run_ = ao.read_runs([tmp / "s1.json"])
            vocab = ao.egyptian_vocabulary()
            ev = ao.evaluate_chapter(s1["chapter"], run_, vocab)
            v = {"terminology": {x["key"].split(":", 1)[1]: "keep" for x in ev["decisions"] if x["kind"] == "terminology"}}
            ao.assemble(book, s1, run_, f["objectives"], vocab, v,
                        {"approved_by": "fixture reviewer", "approved_at": "2026-09-25T00:00:00+00:00"})
            # question 2 of 8-2 gets a lead-in with its own figure
            at = next(i for i, b in enumerate(blocks) if b.get("item_key") == "ex8-2-2a")
            hdr = dict(blocks[at], id="b09999", type="exercise_header", q=2, level=2,
                       text="Given the following diagram: ⟦fig:tikzpicture/fig-body.png⟧",
                       figures=[{"src": "tikzpicture/fig-body.png", "context": "exercise_header"}])
            for k in ("item_key", "sub", "problem", "solution", "printed_answer", "shortcode"):
                hdr.pop(k, None)
            blocks = blocks[:at] + [hdr] + blocks[at:]
            args = ao.lesson_args(book, manifest, blocks, maths, f["objectives"], ["g10m8s2-1"], f["work"])
        its = {i["ref"]: i for i in args["lessons"][0]["items"]}
        for ref in ("Ex8-2:2a", "Ex8-2:2b"):
            self.assertIn("[figure]", its[ref]["stem"])
            self.assertTrue(any(p.endswith("tikzpicture__fig-body.png") for p in its[ref]["figures"]), ref)
        self.assertTrue(any(p.endswith("tikzpicture__fig-item.png") for p in its["Ex8-2:2a"]["figures"]),
                        "the part's own figure is kept")
        self.assertEqual(len(its["Ex8-2:2a"]["figures"]), len(set(its["Ex8-2:2a"]["figures"])))


class S0bAlignHash(unittest.TestCase):
    def test_the_book_hashes_an_aligned_derivation_without_its_environment_and_with_amp(self):
        import assemble_maths as am
        stored = "\\begin{align*}c&=5+4\\\\c&=9\\end{align*}"
        name = hashlib.md5("c&amp;=5+4\\\\c&amp;=9".encode()).hexdigest()
        self.assertTrue(am.hash_ok(stored, name))
        self.assertFalse(am.hash_ok(stored.replace("9", "8"), name))
        self.assertEqual(am.canonical("c&amp;=5+4\\\\c&amp;=9"), stored, "an entity form is stored as real & in align*")
        self.assertEqual(am.canonical("\\begin{align*} c &amp;= 9\\end{align*}"), "\\begin{align*} c &= 9\\end{align*}")
        spaced = "\\begin{align*}x-4-2&=0\\\\\\therefore x&=6\\end{align*}"
        self.assertTrue(am.hash_ok(spaced, hashlib.md5("x-4-2&amp;=0\\\\\\thereforex&amp;=6".encode()).hexdigest()),
                        "the book hashed its sources without whitespace")

    def test_md5check_proves_it_and_answers_the_stored_form(self):
        import assemble_maths as am
        name = hashlib.md5("c&amp;=9".encode()).hexdigest()
        line = json.dumps({"md5": name, "candidates": ["c=9", "c&amp;=9"]}) + "\n"
        old = sys.stdin
        try:
            sys.stdin = io.StringIO(line)
            buf = io.StringIO()
            with redirect_stdout(buf):
                am.main(["md5check"])
        finally:
            sys.stdin = old
        self.assertEqual(json.loads(buf.getvalue())["match"], "c&=9")


class BundleAligned(unittest.TestCase):
    def test_align_star_inline_becomes_aligned_and_a_leftover_is_residual(self):
        import assemble_lesson_bundle as alb
        out, c = alb.normalise("$\\begin{align*}d&=\\sqrt{45}\\\\&\\approx\\text{6,71}\\end{align*}$")
        self.assertEqual(out, "$\\begin{aligned}d&=\\sqrt{45}\\\\&\\approx\\text{6.71}\\end{aligned}$")
        self.assertEqual(c["aligned"], 1)
        self.assertEqual(alb.residual_notation(out), [])
        self.assertEqual(alb.residual_notation("$\\begin{align*}a&=b\\end{align*}$"), ["\\begin{align*}", "\\end{align*}"])

    @unittest.skipUnless(shutil.which("node") and (EX.parents[1] / "app" / "node_modules" / "katex").exists(),
                         "checks the app's KaTeX")
    def test_katex_renders_the_aligned_form_inline_and_refuses_align_star(self):
        app = EX.parents[1] / "app"
        js = ("const k=require('katex');const r=(s)=>{try{k.renderToString(s,{throwOnError:true});return 'ok'}"
              "catch(e){return 'error'}};console.log(JSON.stringify([r(process.argv[1]),r(process.argv[2])]))")
        out = subprocess.run(["node", "-e", js, "\\begin{aligned}d&=\\sqrt{45}\\\\&\\approx 6.71\\end{aligned}",
                              "\\begin{align*}d&=\\sqrt{45}\\end{align*}"], cwd=app, capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(out.stdout), ["ok", "error"])


if __name__ == "__main__":
    unittest.main()
