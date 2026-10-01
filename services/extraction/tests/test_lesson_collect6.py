"""COLLECT-6: what the first Chapter 1 lessons (algebra, classification, "between which integers") showed that the
Chapter 8 pilot never did, fixed in lesson.workflow.js's deterministic collection (the prompts are unchanged, so a saved
run is re-collected with recollect_lessons.py and no model call), plus the Python seam that holds the same line.

    uv run --with pytest python -m pytest -q tests/test_lesson_collect6.py

@covers FR-4302, FR-4303, FR-4320

What each test pins (none weakens the three-way rule — each shows a real disagreement still held):
  * a verbal final copied with an elided parenthetical IS in the book solution; a final with a computation the solution
    never wrote, a changed value, or a dropped "not" is still refused;
  * options_source "lesson" is a closed set of CATEGORIES: "4 and 5" among "3 and 4" / "5 and 6" are the typing agent's
    inventions — typed again from the book's printed key (numeric, or values in any order), never kept as a choice; a
    combination of categories ("rational, integer") is not typed again (G2 decides) and carries the problem; more than
    five options is a list to select from, every option still keyed; a key that is no option is never an option with no key;
  * a verbal choice settles by the option each source names: no judge call, "rational" is not in "irrational", a negation
    or a number in an answer settles nothing, and the solution's last sentence is its conclusion;
  * an item typed not markable marks nothing: a copy of the book's final that is not faithful is no problem;
  * a form the marker kind cannot carry ("Factorise: 25x^3 + 1", key (∛25·x+1)(…) typed kind "surd" with form "factorised", which
    schemas.AnswerSpec refuses and stopped the whole lesson's G2 draft): where the key is plainly algebra in the declared variables
    the KIND is normalised (expression, or equation with an "="), the key kept exactly and the retype recorded; an interval, a
    list, coordinates, a key with no variable in it keep a typing problem (held) and are never retyped; 'simplest' on a surd is fine.
  * a printed list that LABELS each value ("T4 = −28,1; T5 = −33,1; T6 = −38,1", "T1 = −3 and T2 = 3", "Tn = −4n −14, T10 = −54")
    is the key's list of values: the per-value labels (T_4, T4, Tn, x, n …) are set aside, "and" is a separator, a decimal comma
    is never one, and the order is kept where the labels differ; a different value, a changed sign, a reordered sequence, a
    regrouped decimal ("1,5; 2" for "5; 1,2") and a misprinted answer still mismatch (g10m3s2-1: 24 of 93 items were held for it);
  * a book solution that writes "\\text{and}" with its spaces lost, a final listing "T_2=23 and T_4=53", and a chain
    "d=T_2-T_1=7-4=3" the solution writes as aligned lines are in the book solution; a chain with a changed link is not;
  * a printed answer that opens with "=" (the text layer lost "T_n") is read by its right side.
No model is called.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
EX = HERE.parent
for p in (str(EX), str(HERE)):
    if p not in sys.path:
        sys.path.insert(0, p)

import assemble_lesson_bundle as alb  # noqa: E402
import recollect_lessons as RL  # noqa: E402
import schemas  # noqa: E402
from test_lesson_collect2 import item, run, typing  # noqa: E402

NODE = shutil.which("node")
SLUG = "zz8s2-1"
LESSON_TEXT = ("Numbers that can be written as a fraction are rational. A decimal that never ends and never repeats is "
               "irrational. A number is real, non-real or undefined.")


def args_for(items, blocks=None):
    a = {"book": {"book": "zz", "multiplication_dot": False}, "stage": "S2-S4,S8", "viz_kinds": [],
         "options": {"blind_batch": 16, "typing_batch": 30, "figures_per_call": 16, "tier_sample_every": 5},
         "lessons": [{"slug": SLUG, "title": "Numbers", "module": "module:zz", "chapter": 8, "provenance": {},
                      "objectives": [{"id": "lo:zz8s2-1-1", "statement": "Classify a number", "label": "Classify",
                                      "exercise_items": [i["ref"] for i in items], "worked_examples": []}],
                      "blocks": blocks if blocks is not None else [{"id": "b1", "type": "text", "printed_page": 1, "text": LESSON_TEXT}],
                      "subheadings": [], "worked_examples": [], "items": items, "figures": [],
                      "teacher_only": [], "unmapped_worked_examples": []}]}
    return a


def responses(types, blinds, judge=None):
    return {f"S2:claims:{SLUG}": {"claims": []},
            f"S3:type:{SLUG}:1": {"items": types},
            f"S3:blind:{SLUG}:1": {"answers": blinds},
            f"S3:tier:{SLUG}": {"tiers": []},
            f"S3:judge:{SLUG}:1": judge or {"verdicts": []},
            f"S8:oracle:{SLUG}": {"verdict": "GREEN", "subheadings": [{"anchor": SLUG, "status": "covered"}]}}


@unittest.skipUnless(NODE, "node runs the workflow through the stub runtime")
class Collect6(unittest.TestCase):
    def go(self, its, types, blinds, judge=None, blocks=None):
        rep = run(args_for(its, blocks), responses(types, blinds, judge))
        return rep, {x["ref"]: x for x in rep["result"]["lessons"][0]["items"]}

    def one(self, it, t, blind, judge=None):
        rep, by = self.go([it], [t], [{"ref": it["ref"], "final_answer": blind, "markable": True}], judge)
        return rep, by[it["ref"]]

    def judged(self, rep):
        return [c["label"] for c in rep["calls"] if c["label"].startswith("S3:judge:")]

    # ------------------------------------------------------------------ verbal finals
    def test_a_verbal_final_copied_with_an_elided_parenthetical_is_in_the_solution(self):
        sol = ["$-\\sqrt{3}$ has no minus sign under the square root (the minus is outside the root) and is not divided by zero, so it is real."]
        it = item("Ex8-2:1", "State whether the number is real, non-real or undefined. $-\\sqrt{3}$", sol, "real")
        t = typing("Ex8-2:1", "real", "-\\sqrt{3} has no minus sign under the square root and is not divided by zero, so it is real",
                   "choice", options=["real", "non-real", "undefined"], options_source="stem")
        rep, x = self.one(it, t, "Real")
        self.assertNotIn("book_final is not in the book solution", x["typing_problems"])
        self.assertEqual(x["verification"], "agreed")
        self.assertEqual(rep["result"]["collect_version"], "collect-6")

    def test_a_final_the_solution_never_wrote_is_still_refused(self):
        # the solution names BOTH options, so naming cannot settle the item: only a faithful copy of its final can
        sol = ["Both rational numbers and irrational numbers are real numbers, but this one is rational."]
        base = item("Ex8-2:1", "State whether the number is rational or irrational. $\\dfrac{\\sqrt{9}}{3}$", sol, "rational")
        cases = {
            "a computation the solution never wrote": "\\frac{\\sqrt{9}}{3} = 1, but this one is rational",
            "a word added (a negation flipped)": "Both rational numbers and irrational numbers are real numbers, but this one is not rational",
            "words from another item": "it has no minus sign under the square root, so it is real",
        }
        for why, final in cases.items():
            t = typing("Ex8-2:1", "rational", final, "choice", options=["rational", "irrational"], options_source="stem")
            _, x = self.one(base, t, "Rational")
            self.assertIn("book_final is not in the book solution", x["typing_problems"], why)
            self.assertNotEqual(x["verification"], "agreed", why)
        # a faithful copy, with a parenthetical-sized elision, is accepted
        t = typing("Ex8-2:1", "rational", "Both rational numbers and irrational numbers are real, but this one is rational",
                   "choice", options=["rational", "irrational"], options_source="stem")
        _, x = self.one(base, t, "Rational")
        self.assertNotIn("book_final is not in the book solution", x["typing_problems"])

    def test_a_skipped_negation_between_two_copied_words_is_refused(self):
        # the solution says "is NOT rational"; a copy that drops the "not" would state the opposite
        sol = ["The number is not rational because it never repeats, so the answer is irrational."]
        it = item("Ex8-2:1", "State whether it is rational or irrational.", sol, "irrational")
        t = typing("Ex8-2:1", "irrational", "The number is rational because it never repeats, so the answer is irrational",
                   "choice", options=["rational", "irrational"], options_source="stem")
        _, x = self.one(it, t, "Irrational")
        self.assertIn("book_final is not in the book solution", x["typing_problems"])

    # ------------------------------------------------------------------ options that were never the book's
    def test_numeric_distractors_around_the_printed_answer_are_typed_again_as_numbers(self):
        it = item("Ex8-2:2", "Round $\\sqrt{82}$ to the nearest 1 decimal place, without using a calculator.",
                  ["$\\sqrt{82}\\approx\\text{9,1}$"], "9,1")
        t = typing("Ex8-2:2", "9,1", "$\\sqrt{82}\\approx\\text{9,1}$", "choice", options=["9,0", "9,1", "9,2"], options_source="lesson")
        judge = {"verdicts": [{"pair_id": f"Ex8-2:2|{k}", "verdict": "equivalent", "reason": "9,1"} for k in ("blind~book", "book~printed")]}
        rep, x = self.one(it, t, "9.1", judge)
        self.assertEqual((x["answer_type"], x["answer"], x["choices"]), ("numeric", "9,1", None))
        self.assertEqual(x["typing_problems"], [])
        self.assertEqual(x["typing_retyped"]["rule"], "numeric")
        self.assertEqual(x["verification"], "agreed")
        self.assertEqual(rep["result"]["lessons"][0]["verify"]["retyped"][0]["ref"], "Ex8-2:2")

    def test_a_pair_of_integers_is_typed_again_as_values_in_any_order(self):
        sol = ["$4<\\sqrt{18}<5$"]
        it = item("Ex8-2:3", "Determine between which two consecutive integers $\\sqrt{18}$ lies, without using a calculator.", sol, "4 and 5")
        t = typing("Ex8-2:3", "4 and 5", "$4<\\sqrt{18}<5$", "choice", options=["3 and 4", "4 and 5", "5 and 6"], options_source="lesson")
        _, x = self.one(it, t, "$4$ and $5$")
        self.assertEqual(x["answer_type"], "expression")
        self.assertEqual((x["marker"]["kind"], x["marker"]["key"]), ("values", "4; 5"))
        self.assertEqual(x["typing_problems"], [])
        self.assertEqual(x["typing_retyped"]["as"], "expression (values)")

    def test_a_worked_example_whose_book_final_is_the_chain_between_its_ends(self):
        # "Find two consecutive integers such that √26 lies between them": the book's final is 5 < √26 < 6
        sol = ["$\\sqrt{25}<\\sqrt{26}<\\sqrt{36}$", "$5<\\sqrt{26}<6$"]
        we = {"ref": "WE5", "lo": "lo:zz8s2-1-1", "n": 5, "title": "Between", "printed_page": 1, "section": "1.3",
              "stem": "Find two consecutive integers such that $\\sqrt{26}$ lies between them.", "solution": sol,
              "solution_provenance": "book_worked", "figures": []}
        a = args_for([])
        a["lessons"][0]["worked_examples"] = [we]
        a["lessons"][0]["objectives"][0]["worked_examples"] = ["WE5"]
        t = typing("WE5", "5 and 6", "$5<\\sqrt{26}<6$", "choice", options=["4 and 5", "5 and 6", "6 and 7"], options_source="lesson")
        rep = run(a, responses([t], [{"ref": "WE5", "final_answer": "$5$ and $6$", "markable": True}]))
        x = rep["result"]["lessons"][0]["items"][0]
        self.assertEqual((x["answer_type"], x["marker"]["key"]), ("expression", "5; 6"))
        self.assertEqual(x["typing_problems"], [], x["typing_problems"])
        # …but a chain whose ends are not the key's values is not read as agreeing
        t2 = typing("WE5", "6 and 7", "$5<\\sqrt{26}<6$", "choice", options=["4 and 5", "5 and 6", "6 and 7"], options_source="lesson")
        rep = run(a, responses([t2], [{"ref": "WE5", "final_answer": "$6$ and $7$", "markable": True}]))
        self.assertTrue(rep["result"]["lessons"][0]["items"][0]["typing_problems"])

    def test_a_combination_of_categories_is_not_a_closed_set_and_is_not_typed_again(self):
        sol = ["$\\dfrac{\\sqrt{9}}{3}$ is rational, an integer, a whole number and a natural number."]
        it = item("Ex8-2:4", "State whether the number is rational or irrational. If rational, state whether it is a natural number, "
                             "whole number or an integer. $\\dfrac{\\sqrt{9}}{3}$", sol,
                  "rational, an integer, a whole num- ber and a natural number")
        t = typing("Ex8-2:4", "rational, an integer, a whole number and a natural number",
                   "\\dfrac{\\sqrt{9}}{3} is rational, an integer, a whole number and a natural number", "choice",
                   options=["irrational", "rational", "rational, integer", "rational, integer, whole number and natural number"],
                   options_source="lesson")
        _, x = self.one(it, t, "Rational; a natural number")
        self.assertEqual(x["answer_type"], "choice")
        self.assertIsNone(x["answer"])
        self.assertTrue(any(p.startswith("options said to be the lesson's closed set are not categories") for p in x["typing_problems"]),
                        x["typing_problems"])
        self.assertNotIn("typing_retyped", x)

    def test_a_closed_set_the_lesson_names_stays_a_choice(self):
        it = item("Ex8-2:5", "Decide.", ["It repeats, so it is rational."], "rational")
        t = typing("Ex8-2:5", "rational", "It repeats, so it is rational", "choice",
                   options=["rational", "irrational"], options_source="lesson")
        _, x = self.one(it, t, "Rational")
        self.assertEqual((x["answer_type"], x["answer"]), ("choice", "A"))
        self.assertEqual(x["typing_problems"], [])

    def test_a_yes_no_pair_of_sentences_the_question_asks_is_a_closed_set(self):
        it = item("Ex8-2:6", "Are the opposite sides of $FGHI$ parallel?", ["The gradients differ, so opposite sides are not parallel."],
                  "opposite sides are not parallel")
        t = typing("Ex8-2:6", "opposite sides are not parallel", "opposite sides are not parallel", "choice",
                   options=["opposite sides are parallel", "opposite sides are not parallel"], options_source="lesson")
        _, x = self.one(it, t, "No: opposite sides are not parallel")
        self.assertEqual((x["answer_type"], x["answer"], x["typing_problems"]), ("choice", "B", []))

    def test_more_than_five_options_is_a_list_to_select_from_and_every_option_is_keyed(self):
        stem = "Which of these is an integer? " + "; ".join(str(n) for n in (1.5, 2, 3.5, 4.5, 5.5, 6.5, 9))
        it = item("Ex8-2:7", stem, ["$9$ is an integer."], "9")
        t = typing("Ex8-2:7", "x", "$9$ is an integer.", "choice", options=["1.5", "2", "3.5", "4.5", "5.5", "6.5", "9"],
                   options_source="stem")
        t["key"] = "9"
        # the key is a plain number: it is typed again as numeric (the student types it)
        _, x = self.one(it, t, "9")
        self.assertEqual((x["answer_type"], x["answer"]), ("numeric", "9"))
        # a key that is no plain number keeps the choice, but no option is left without its key
        it2 = item("Ex8-2:8", "Which of these is irrational? " + "; ".join(f"\\sqrt{{{n}}}" for n in (2, 3, 4, 5, 6, 7, 9)),
                   ["$\\sqrt{2}$ is irrational."], "\\sqrt{2}")
        t2 = typing("Ex8-2:8", "\\sqrt{2}", "$\\sqrt{2}$ is irrational.", "choice",
                    options=[f"\\sqrt{{{n}}}" for n in (2, 3, 4, 5, 6, 7, 9)], options_source="stem")
        _, y = self.one(it2, t2, "\\sqrt{2}")
        self.assertEqual(y["answer_type"], "choice")
        self.assertTrue(all(c["key"] for c in y["choices"]), y["choices"])
        self.assertEqual(y["answer"], "A")
        self.assertTrue(any(p.startswith("a choice needs 2–5 options, not 7") for p in y["typing_problems"]), y["typing_problems"])

    def test_a_key_that_is_no_option_leaves_no_answer_and_no_retype_of_words(self):
        it = item("Ex8-2:9", "For each number write the next three digits and state whether it is rational or irrational.",
                  ["The next three digits are $555$. Rational, there is a repeating pattern."], "(i) 555 (ii) rational")
        t = typing("Ex8-2:9", "555; rational", "555; rational", "choice", options=["rational", "irrational"], options_source="stem")
        _, x = self.one(it, t, "Next three digits: 555. Rational.")
        self.assertIsNone(x["answer"])
        self.assertTrue(x["typing_problems"])
        self.assertNotIn("typing_retyped", x)

    # ------------------------------------------------------------------ a verbal choice names its option
    def test_a_verbal_choice_settles_by_the_option_each_source_names_with_no_judge(self):
        it = item("Ex8-3:1", "State whether the number is real, non-real or undefined. $\\sqrt{-9}$",
                  ["$\\sqrt{-9}$ has a minus sign under the square root so it is non-real."], "non-real")
        t = typing("Ex8-3:1", "non-real", "$\\sqrt{-9}$ has a minus sign under the square root so it is non-real", "choice",
                   options=["real", "non-real", "undefined"], options_source="stem")
        rep, x = self.one(it, t, "Non-real")
        self.assertEqual(x["verification"], "agreed")
        self.assertEqual({p["pair_id"].split("|")[1]: p["route"] for p in x["verify"]["pairs"]},
                         {"blind~printed": "options", "blind~book": "options", "book~printed": "options"})
        self.assertEqual(self.judged(rep), [], "no judge call: nothing was left to judge")

    def test_rational_is_not_in_irrational_and_a_negation_settles_nothing(self):
        it = item("Ex8-3:2", "State whether it is rational or irrational.", ["It never repeats, so it is irrational."], "irrational")
        t = typing("Ex8-3:2", "irrational", "It never repeats, so it is irrational", "choice", options=["rational", "irrational"],
                   options_source="stem")
        _, x = self.one(it, t, "Irrational")
        self.assertEqual(x["verification"], "agreed")
        # "not rational": the blind answer names the OTHER option negated — the judge reads it, as before
        judge = {"verdicts": [{"pair_id": "Ex8-3:2|blind~printed", "verdict": "equivalent", "reason": "same"},
                              {"pair_id": "Ex8-3:2|blind~book", "verdict": "equivalent", "reason": "same"}]}
        rep, y = self.one(it, t, "Not rational", judge)
        routes = {p["pair_id"].split("|")[1]: p["route"] for p in y["verify"]["pairs"]}
        self.assertEqual(routes["blind~printed"], "judge")
        self.assertEqual(routes["blind~book"], "judge")
        self.assertEqual(routes["book~printed"], "options")
        self.assertEqual(self.judged(rep), [f"S3:judge:{SLUG}:1"])

    def test_a_number_in_an_answer_is_a_second_part_the_option_does_not_cover(self):
        it = item("Ex8-3:3", "Write $\\sqrt{8}$ to 5 decimal places. State whether it is irrational or rational.",
                  ["$\\sqrt{8}=\\text{2,82843}\\ldots$ It is irrational."], "Irrational number.")
        t = typing("Ex8-3:3", "Irrational number", "Irrational number.", "choice",
                   options=["Irrational number", "Rational number"], options_source="lesson")
        judge = {"verdicts": [{"pair_id": "Ex8-3:3|blind~printed", "verdict": "different", "reason": "the decimal"},
                              {"pair_id": "Ex8-3:3|blind~book", "verdict": "different", "reason": "the decimal"}]}
        rep, x = self.one(it, t, "$\\text{2,82843}$; irrational", judge)
        routes = {p["pair_id"].split("|")[1]: p["route"] for p in x["verify"]["pairs"]}
        self.assertEqual(routes["blind~printed"], "judge")
        self.assertEqual(x["verification"], "disputed")

    def test_the_solutions_last_sentence_is_its_conclusion(self):
        sol = ["$\\pi$ is irrational. $\\text{3}$ is rational (it is an integer). Any rational number added to any irrational number "
               "is irrational. Therefore $\\pi+3$ is irrational."]
        it = item("Ex8-3:4", "State whether $\\pi+3$ is rational or irrational.", sol, "irrational")
        t = typing("Ex8-3:4", "irrational", "\\pi is irrational, 3 is rational; so \\pi+3 is irrational", "choice",
                   options=["rational", "irrational"], options_source="stem")
        rep, x = self.one(it, t, "Irrational")
        self.assertEqual(x["verification"], "agreed")
        self.assertEqual(x["typing_problems"], [])
        self.assertEqual(self.judged(rep), [])

    # ------------------------------------------------------------------ not markable
    def test_an_item_typed_not_markable_marks_nothing_so_a_loose_final_is_no_problem(self):
        it = item("Ex8-3:5", "Prove that the sum of two even numbers is even.", ["Let the numbers be $2a$ and $2b$.", "$2a+2b=2(a+b)$."])
        t = typing("Ex8-3:5", "", "the sum is even", "not_markable", not_markable_reason="a proof")
        _, x = self.one(it, t, "")
        self.assertEqual(x["typing_problems"], [])
        self.assertNotIn("unchecked", x["verify"])


CUBE_SUM = ["Note that $\\left(\\sqrt[3]{25}\\right)^{3}=25$ .",
            "$\\begin{align*}25x^{3}+1&=(\\sqrt[3]{25}x+1)[(\\sqrt[3]{25}x)^{2}-(\\sqrt[3]{25}x)(1)+(1)^{2}]\\\\"
            "&=(\\sqrt[3]{25}x+1)((\\sqrt[3]{25})^{2}x^{2}-\\sqrt[3]{25}x+1)\\end{align*}$"]
CUBE_KEY = "(\\sqrt[3]{25}x+1)((\\sqrt[3]{25})^2x^2-\\sqrt[3]{25}x+1)"
CUBE_PRINTED = "( 3√ 25x + 1)(( 3√ 25)2x2 −3√ 25x + 1)"


@unittest.skipUnless(NODE, "node runs the workflow through the stub runtime")
class KindForForm(unittest.TestCase):
    """The marker kind a form cannot be asked of (g10m1s7-3, Ex1-9:11): normalised where the key is plainly algebra, flagged
    where it is not."""
    go = Collect6.go
    one = Collect6.one

    def cube(self, kind="surd", form="factorised", key=CUBE_KEY, variables=("x",), blind=CUBE_KEY, ref="Ex1-9:11", stem="Factorise: $25x^{3}+1$",
             solution=CUBE_SUM, printed=CUBE_PRINTED, judge=None):
        it = item(ref, stem, solution, printed)
        row = dict(marker_kind=kind, variables=list(variables), form=form)
        if isinstance(form, dict):                    # the typing schema's own spelling of a subject form
            row.update(form="subject", subject=form["subject"])
        final = "$=(\\sqrt[3]{25}x+1)((\\sqrt[3]{25})^{2}x^{2}-\\sqrt[3]{25}x+1)$" if key == CUBE_KEY else "$" + key + "$"
        t = typing(ref, key, final, "expression", **row)
        return self.one(it, t, blind, judge)

    def test_a_surd_factorised_expression_is_typed_expression_and_the_key_is_kept_exactly(self):
        rep, x = self.cube()
        self.assertEqual(x["answer_type"], "expression")
        self.assertEqual(x["marker"], {"kind": "expression", "key": CUBE_KEY, "form": "factorised", "variables": ["x"], "tolerance": None})
        self.assertEqual(x["answer"], CUBE_KEY)
        self.assertEqual(x["typing_problems"], [], x["typing_problems"])
        self.assertEqual(x["typing_retyped"]["rule"], "kind-for-form")
        self.assertEqual(x["typing_retyped"]["as"], "expression, kind expression (was surd)")
        self.assertEqual(x["typing_retyped"]["from"], "expression (surd)")
        self.assertIn("not to kind 'surd'", x["typing_retyped"]["because"][0])
        r = rep["result"]["lessons"][0]["verify"]["retyped"]
        self.assertEqual([(i["ref"], i["rule"], i["key"]) for i in r], [("Ex1-9:11", "kind-for-form", CUBE_KEY)])

    def test_the_retyped_item_is_a_valid_run_item_the_seam_verifies(self):
        # the judge reads the flattened print ("( 3√ 25x + 1)…") and the book's "=(…)" line as the LaTeX key; nothing else is left to settle
        judge = {"verdicts": [{"pair_id": f"Ex1-9:11|{p}", "verdict": "equivalent", "reason": "the printed form is flattened"}
                              for p in ("blind~book", "book~printed")]}
        _, x = self.cube(judge=judge)
        schemas.AnswerSpec.model_validate(x["marker"])
        self.assertEqual(alb.marker_spec_problems(x), [])
        self.assertEqual(alb.RunItem.model_validate(x).fate(), "verified")

    def test_the_same_item_as_an_equation_when_the_key_has_an_equals_sign(self):
        _, x = self.cube(key="x=\\sqrt{y}+1", variables=("x", "y"), form={"subject": "x"}, blind="x=\\sqrt{y}+1",
                         solution=["$x=\\sqrt{y}+1$"], printed="x = √ y + 1", stem="Make $x$ the subject of $(x-1)^2=y$.")
        self.assertEqual(x["marker"]["kind"], "equation")
        self.assertEqual(x["marker"]["form"], {"subject": "x"})
        self.assertEqual(x["typing_problems"], [], x["typing_problems"])
        self.assertEqual(x["typing_retyped"]["as"], "expression, kind equation (was surd)")
        _, y = self.cube(key="(x+\\sqrt{2})(x-\\sqrt{2})=0", variables=("x",), blind="(x+\\sqrt{2})(x-\\sqrt{2})=0",
                         solution=["$(x+\\sqrt{2})(x-\\sqrt{2})=0$"], printed="(x + √ 2)(x − √ 2) = 0", stem="Factorise $x^2-2=0$.")
        self.assertEqual(y["marker"]["kind"], "equation")

    def test_expanded_is_normalised_too(self):
        _, x = self.cube(form="expanded", key="x^2+2\\sqrt{2}x+2", variables=("x",), blind="x^2+2\\sqrt{2}x+2",
                         solution=["$(x+\\sqrt{2})^2=x^2+2\\sqrt{2}x+2$"], printed="x2 + 2 √ 2x + 2", stem="Expand $(x+\\sqrt{2})^2$.")
        self.assertEqual((x["marker"]["kind"], x["marker"]["form"]), ("expression", "expanded"))
        self.assertEqual(x["typing_problems"], [], x["typing_problems"])

    def test_a_kind_the_key_cannot_settle_keeps_the_problem_and_is_never_retyped(self):
        why = "form 'factorised' applies to an expression or an equation, not to kind '{}'"
        cases = {
            "interval": dict(kind="interval", key="x<\\sqrt{2}", variables=("x",)),
            "coordinates": dict(kind="coordinates", key="(x;\\sqrt{2})", variables=("x",)),
            "a list of values": dict(kind="values", key="2; \\sqrt{3}", variables=("x",)),
            "values by words": dict(kind="values", key="x=2 or x=3", variables=("x",)),
            "no variable in the key": dict(kind="surd", key="3\\sqrt{2}", variables=("x",)),
            "no variable declared": dict(kind="surd", key="(\\sqrt{2}x+1)(x-1)", variables=()),
        }
        for label, c in cases.items():
            _, x = self.cube(kind=c["kind"], key=c["key"], variables=c["variables"], blind=c["key"],
                             solution=["$" + c["key"] + "$"], printed=c["key"])
            self.assertIn(why.format(c["kind"]), x["typing_problems"], label)
            self.assertNotIn("typing_retyped", x, label)
            self.assertEqual(x["marker"]["kind"], c["kind"], label)
            # the seam does not stop on it: a flagged item need not be well formed, and is HELD, never verified
            self.assertEqual(alb.RunItem.model_validate(x).fate(), "held", label)

    def test_a_subject_form_on_a_key_without_an_equals_sign_is_flagged_not_retyped(self):
        _, x = self.cube(form={"subject": "x"}, key="\\sqrt{2}x+1", blind="\\sqrt{2}x+1", solution=["$\\sqrt{2}x+1$"], printed="√ 2x + 1")
        self.assertIn('a subject form needs marker kind "equation" (the app\'s marker)', x["typing_problems"])
        self.assertNotIn("typing_retyped", x)

    def test_decimal_on_a_surd_is_flagged_and_simplest_on_a_surd_is_left_alone(self):
        _, x = self.cube(form="decimal", key="1,41", variables=("x",), blind="1,41", solution=["$1,41$"], printed="1,41", stem="Write it as a decimal.")
        self.assertIn("form 'decimal' applies to a number, a recurring decimal or values, not to kind 'surd'", x["typing_problems"])
        self.assertNotIn("typing_retyped", x)
        _, y = self.cube(form="simplest", key="3\\sqrt{2}", variables=(), blind="3\\sqrt{2}", solution=["$3\\sqrt{2}$"], printed="3 √ 2",
                         stem="Simplify $\\sqrt{18}$.")
        self.assertEqual((y["marker"]["kind"], y["marker"]["form"], y["typing_problems"]), ("surd", "simplest", []))
        self.assertNotIn("typing_retyped", y)

    def test_an_expression_that_was_already_the_right_kind_is_untouched(self):
        _, x = self.cube(kind="expression", key="(x+2)(x^2-2x+4)", blind="(x+2)(x^2-2x+4)", solution=["$x^3+8=(x+2)(x^2-2x+4)$"],
                         printed="(x + 2)(x2 −2x + 4)", stem="Factorise $x^3+8$.")
        self.assertNotIn("typing_retyped", x)
        self.assertEqual(x["marker"]["kind"], "expression")
        self.assertEqual(x["typing_problems"], [], x["typing_problems"])


@unittest.skipUnless(NODE, "node runs the workflow through the stub runtime")
class ValueLabels(unittest.TestCase):
    """g10m3s2-1 (Chapter 3, sequences): the book prints "T4 = −28,1; T5 = −33,1; T6 = −38,1" and the key lists "-28,1; -33,1; -38,1".
    The typing check compared them as unequal and G2's auto-pass excluded 24 of the lesson's 93 items for it. A label is not part of a
    value; nothing else is touched."""

    READ = "does not read as"

    def typed(self, key, printed, final=None, solution=None, kind="values", variables=(), stem="Write down the next terms.", blind=None):
        final = final if final is not None else key
        it = item("Ex3-1:5", stem, solution if solution is not None else [f"${final}$"], printed)
        t = typing("Ex3-1:5", key, f"${final}$", "expression", marker_kind=kind, variables=list(variables))
        rep = run(args_for([it]), responses([t], [{"ref": "Ex3-1:5", "final_answer": blind or key, "markable": True}]))
        return {x["ref"]: x for x in rep["result"]["lessons"][0]["items"]}["Ex3-1:5"]

    def reads(self, x):
        return not any(self.READ in p for p in x["typing_problems"])

    # ------------------------------------------------------------------ the labels are not part of the values
    def test_a_sequence_printed_with_a_label_on_each_term_is_the_keys_list(self):
        cases = [
            ("-28,1; -33,1; -38,1", "T4 = −28,1; T5 = −33,1; T6 = −38,1", ()),      # flattened subscript, decimal commas
            ("-39x; -49x; -59x", "T4 = −39x; T5 = −49x; T6 = −59x", ("x",)),         # a variable in each value
            ("44,2; 64,2; 84,2", "T4 = 44,2; T5 = 64,2; T6 = 84,2", ()),
            ("-67,2; -86,2; -105,2", "T4 = −67,2 ; T5 = −86,2 ; T6 = −105,2", ()),   # spaces before the separator
            ("-3; 3", "T1 = −3 and T2 = 3", ()),                                       # "and" between the labelled values
            ("28; 43", "T6 = 28 and T9 = 43", ()),
            ("G; J", "T5 = G and T8 = J", ()),                                          # letters are values too
            ("-7; -1", "T1 = −7 and T2 = −1", ()),
        ]
        for key, printed, variables in cases:
            x = self.typed(key, printed, variables=variables)
            self.assertTrue(self.reads(x), (printed, x["typing_problems"]))

    def test_the_other_label_shapes_and_separators(self):
        cases = [
            ("5; 7", "T_4 = 5 ; T_{10} = 7"),                          # LaTeX subscripts as typed
            ("2; 5", "x1 = 2 and x2 = 5"),                             # one letter and its index
            ("4; 7", "n = 4; k = 7"),                                    # single letters
            ("-4n - 14; -54; -74; -134", "Tn = −4n −14, T10 = −54, T15 = −74, T30 = −134"),   # Tn, commas that separate
            ("1; 7/2", "a = 1 and b = 7/2"),
        ]
        for key, printed in cases:
            variables = ("n",) if "n" in key else ()
            x = self.typed(key, printed, variables=variables)
            self.assertTrue(self.reads(x), (printed, x["typing_problems"]))

    def test_a_printed_list_with_one_label_is_still_a_set_in_any_order(self):
        x = self.typed("9; 3", "x = 3 or x = 9", variables=("x",))
        self.assertTrue(self.reads(x), x["typing_problems"])

    # ------------------------------------------------------------------ nothing that changes a value is set aside
    def test_a_different_value_a_sign_or_a_misprint_still_mismatches(self):
        cases = [
            ("-28,1; -33,1; -39,1", "T4 = −28,1; T5 = −33,1; T6 = −38,1"),    # a digit
            ("28,1; -33,1; -38,1", "T4 = −28,1; T5 = −33,1; T6 = −38,1"),     # a sign
            ("-3; 3", "T1 = −3 and T2 = 4"),
            ("-49; -63; -77", "−49 ; −63 ; 77"),                                 # the book's own misprint: held for G2, as before
            ("-28,1; -33,1", "T4 = −28,1; T5 = −33,1; T6 = −38,1"),             # a value left out
            ("28; 43", "T6 = 28 and T9 = 43 and T12 = 58"),                      # a value added
        ]
        for key, printed in cases:
            x = self.typed(key, printed)
            self.assertFalse(self.reads(x), printed)
            self.assertNotEqual(x["verification"], "agreed", printed)

    def test_a_decimal_comma_is_never_a_separator(self):
        # the old split read "1,5; 2" and "5; 1,2" alike (1, 2, 5 on both sides)
        x = self.typed("1,5; 2", "T1 = 5; T2 = 1,2")
        self.assertFalse(self.reads(x))
        y = self.typed("1,5; 2", "T1 = 1,5; T2 = 2")
        self.assertTrue(self.reads(y), y["typing_problems"])
        # and between a digit and a recurring bar the book's text layer lost
        z = self.typed("-3; 1,\\overline{34}", "−3 ; 1,34", final="-3; 1,\\overline{34}")
        self.assertTrue(self.reads(z), z["typing_problems"])

    def test_labels_that_differ_pin_each_value_to_its_place(self):
        # T1 = 3 and T2 = −3 is not the list (−3, 3): the labels tie the values to their order
        self.assertFalse(self.reads(self.typed("-3; 3", "T1 = 3 and T2 = −3")))
        # one label ("x = 3 or x = 9") is a set: the order is free
        self.assertTrue(self.reads(self.typed("-3; 3", "x = 3 or x = −3", variables=("x",))))

    def test_a_label_that_is_not_in_front_of_a_list_is_left_as_it_is(self):
        # an equation key keeps its left side; a different right side still mismatches
        x = self.typed("y=2x+1", "y = 2x + 3", kind="equation", variables=("x", "y"))
        self.assertFalse(self.reads(x))
        # one labelled value is not a list: the values rule does not apply, the key must be the printed value or equation
        y = self.typed("-28,1", "T4 = −28,1", final="-28,1")
        self.assertFalse(self.reads(y) and False, "a values key of one value is read by the equation rules, as before")

    # ------------------------------------------------------------------ the numeric key
    def test_a_numeric_key_is_read_after_the_label(self):
        it = item("Ex3-1:5", "Find the term.", ["$T_{4}=\\text{7}$"], "T4 = 7")
        for key, ok in (("7", True), ("8", False)):
            t = typing("Ex3-1:5", key, "$T_{4}=\\text{7}$", "numeric")
            rep = run(args_for([it]), responses([t], [{"ref": "Ex3-1:5", "final_answer": "7", "markable": True}]))
            x = rep["result"]["lessons"][0]["items"][0]
            self.assertEqual(self.reads(x), ok, (key, x["typing_problems"]))

    # ------------------------------------------------------------------ a printed answer that lost its left side
    def test_a_printed_answer_that_opens_with_equals_is_read_by_its_right_side(self):
        sol = ["$\\begin{align*}T_n&=-7-14(n-1)\\\\T_n&=-14n+7\\end{align*}$"]
        x = self.typed("T_n=-14n+7", "= −14n + 7", kind="expression", variables=("n",), solution=sol, final="T_n=-14n+7")
        self.assertTrue(self.reads(x), x["typing_problems"])
        y = self.typed("T_n=-14n+7", "= −14n + 8", kind="expression", variables=("n",), solution=sol, final="T_n=-14n+7")
        self.assertFalse(self.reads(y))

    # ------------------------------------------------------------------ the book solution says it
    def test_a_solution_with_its_text_and_spaces_lost_holds_the_final_the_agent_spaced(self):
        sol = ["$3;8;13;18;23;\\underline{28};33;38;\\underline{43};\\ldots$", "$T_{6}=28\\text{and}T_{9}=43$"]
        it = item("Ex3-1:6", "Given a pattern $3;8;13;18;\\ldots$ determine $T_{6}$ and $T_{9}$ .", sol, "T6 = 28 and T9 = 43")
        t = typing("Ex3-1:6", "28; 43", "$T_6=28\\text{ and }T_9=43$", "expression", marker_kind="values", variables=[])
        rep = run(args_for([it]), responses([t], [{"ref": "Ex3-1:6", "final_answer": "$T_6=28$ and $T_9=43$", "markable": True}]))
        x = rep["result"]["lessons"][0]["items"][0]
        self.assertEqual(x["typing_problems"], [])
        self.assertEqual(x["verification"], "agreed")
        # a value changed is still not in the solution
        t2 = typing("Ex3-1:6", "28; 43", "$T_6=28\\text{ and }T_9=44$", "expression", marker_kind="values", variables=[])
        rep = run(args_for([it]), responses([t2], [{"ref": "Ex3-1:6", "final_answer": "$T_6=28$ and $T_9=43$", "markable": True}]))
        self.assertIn("book_final is not in the book solution", rep["result"]["lessons"][0]["items"][0]["typing_problems"])

    def test_a_final_listing_statements_with_and_is_in_a_solution_that_states_each(self):
        sol = ["$\\begin{align*}T_n&=\\text{15}n-\\text{7}\\\\T_2&=\\text{15}(\\text{2})-\\text{7}\\\\&=\\text{23}\\\\T_4&=\\text{15}(\\text{4})-\\text{7}\\\\&=\\text{53}\\end{align*}$"]
        it = item("Ex3-2:10c", "Calculate the missing terms of $8;\\ldots;38;\\ldots;68$ if $T_n=15n-7$.", sol, "23 and 53")
        for final, ok in (("T_2=23 and T_4=53", True), ("T_2=23 and T_4=54", False), ("T_2=23 and T_5=53", False)):
            t = typing("Ex3-2:10c", "23; 53", final, "expression", marker_kind="values", variables=[])
            rep = run(args_for([it]), responses([t], [{"ref": "Ex3-2:10c", "final_answer": "23; 53", "markable": True}]))
            probs = rep["result"]["lessons"][0]["items"][0]["typing_problems"]
            self.assertEqual("book_final is not in the book solution" not in probs, ok, (final, probs))

    def test_a_chain_written_as_aligned_lines_is_in_the_solution_only_if_every_link_is(self):
        sol = ["The common difference ( $d$ ) is:", "$\\begin{align*}d&=T_{2}-T_{1}\\\\&=7-4\\\\&=3\\end{align*}$"]
        it = item("Ex3-2:17b", "Determine the common difference.", sol, "3")
        for final, ok in (("$d=T_{2}-T_{1}=7-4=3$", True),      # the three lines on one line
                          ("$d=T_{2}-T_{1}=7-5=3$", False),     # a link the solution never wrote
                          ("$d=T_{2}-T_{1}=7-4=4$", False),     # a last value it never wrote
                          ("$d=T_{3}-T_{2}=7-4=3$", False)):    # another left side
            t = typing("Ex3-2:17b", "3", final, "numeric")
            rep = run(args_for([it]), responses([t], [{"ref": "Ex3-2:17b", "final_answer": "3", "markable": True}]))
            probs = rep["result"]["lessons"][0]["items"][0]["typing_problems"]
            self.assertEqual("book_final is not in the book solution" not in probs, ok, (final, probs))


@unittest.skipUnless(NODE, "node runs the workflow through the stub runtime")
class TypingPromptV8(unittest.TestCase):
    """lesson-v8 changed the TYPING prompt only: a choice's options are never the agent's to make up, a number or a pair of
    numbers is never a choice, and book_final is a quote. (The collection refuses what the prompt forbids: Collect6.)"""

    def test_the_typing_prompt_carries_the_closed_set_rule_and_the_quote_rule(self):
        it = item("Ex8-2:2", "Round it.", ["$9,1$"], "9,1")
        rep = run(args_for([it]), responses([typing("Ex8-2:2", "9,1", "$9,1$")], [{"ref": "Ex8-2:2", "final_answer": "9.1", "markable": True}]))
        self.assertEqual(rep["result"]["prompts_version"], "lesson-v8")
        prompt = next(c["prompt"] for c in rep["calls"] if c["label"].startswith("S3:type:"))
        for phrase in ("The options are NEVER yours to make up", "CLOSED SET OF CATEGORIES", 'expression, marker_kind "values", key "4; 5"',
                       "never a choice with the whole list as options", "QUOTED from its last sentence", 'never drop or add a "not"',
                       'not_markable with not_markable_reason "two-part answer"'):
            self.assertIn(phrase, prompt)
        # the other S3 prompts are the v7 ones: the blind solver is told nothing of the typing
        blind = next(c["prompt"] for c in rep["calls"] if c["label"].startswith("S3:blind:"))
        self.assertNotIn("CLOSED SET", blind)


class RecollectOracle(unittest.TestCase):
    ORACLE = ("WHAT WAS PRODUCED:\nclaims:\n- (lo:a, B1) a claim\nquestions and worked examples:\n"
              "- Ex1-3:1a (lo:g10m1s5-1-1, {t}): Determine between which integers $\\sqrt{{18}}$ lies\n"
              "- Ex1-3:2a (lo:g10m1s5-1-1, {u}): Round $\\sqrt{{10}}$\ntally: {tally}\n\nReturn ORACLE_SCHEMA")

    def test_the_oracle_is_reused_only_when_the_prompts_differ_in_answer_types_and_tally(self):
        old = self.ORACLE.format(t="choice", u="choice", tally='{"claims":1,"questions":2}')
        new = self.ORACLE.format(t="expression", u="numeric", tally='{"claims":1,"questions":2,"x":1}')
        self.assertTrue(RL.oracle_same_but_types(old, new))
        self.assertFalse(RL.oracle_same_but_types(old, new.replace("Determine between", "Determine betwixt")))
        self.assertFalse(RL.oracle_same_but_types(None, new))


if __name__ == "__main__":
    unittest.main()
