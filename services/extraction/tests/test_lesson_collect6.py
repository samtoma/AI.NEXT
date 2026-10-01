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
  * a printed answer that opens with "=" (the text layer lost "T_n") is read by its right side;
  * Chapter 4 (G2's auto-pass excluded 75 of 88 owed items, most of them correct): a numeric key that is a fraction is typed again as an
    expression (the app's numeric grader reads "-5/3" as -5); the values a sentence states ("There are 5 tricycles and 2 bicycles.") are the
    key's list, in order and with nothing else; "±2" is two values; an inequality, a set membership or an interval is compared whole, with its
    relations, signs, brackets and constraints (a number line's axis and the next part's answer that runs on are not the answer); a list
    typed "surd" and an inequality list typed "equation", which the app's marker cannot read, are typed again as "values" / "interval". What is
    NOT accepted is pinned beside it: a changed bound or relation ("a > 0" for "a > 7", "b < -4" for "b > 4"), another bracket, a constraint
    the key leaves out, an extra number, a reordered list.
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
from test_lesson_collect2 import STUB, WORKFLOW, item, run, typing  # noqa: E402

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


def app_marker(spec, tries=()):
    """The APP'S OWN marker on one spec: {"key_problem": validateKey, "marks": {answer: result}} (the same module the seam test reads)."""
    script = (EX.parent.parent / "app" / "src" / "lib" / "answer-marker.ts").as_uri()
    js = (f"const M = await import({json.dumps(script)});\n"
          "const spec = JSON.parse(process.argv[2]); const tries = JSON.parse(process.argv[3]);\n"
          "const out = { key_problem: M.validateKey(spec), marks: {} };\n"
          "if (!out.key_problem) for (const a of tries) out.marks[a] = M.mark(a, spec).result;\n"
          "console.log(JSON.stringify(out));\n")
    with tempfile.TemporaryDirectory() as d:
        f = Path(d, "m.mjs")
        f.write_text(js)
        proc = subprocess.run([NODE, "--no-warnings", str(f), json.dumps(spec), json.dumps(list(tries))], capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)


class TypedItem:
    """One expression / numeric item through the workflow's typing check (no model: the stub runtime answers from the fixture)."""

    READ = "does not read as"

    def typed(self, key, printed, final=None, solution=None, kind="values", variables=(), stem="Write down the next terms.",
              blind=None, ref="Ex3-1:5", answer_type="expression", unit=None, form=None, raw_final=False):
        final = final if final is not None else key
        wrap = (lambda f: f) if raw_final else (lambda f: f"${f}$")
        it = item(ref, stem, solution if solution is not None else [wrap(final)], printed)
        extra = {"unit": unit} if unit else {}
        if form:
            extra["form"] = form
        marker = {"marker_kind": kind, "variables": list(variables)} if answer_type == "expression" else {}
        t = typing(ref, key, wrap(final), answer_type, **marker, **extra)
        rep = run(args_for([it]), responses([t], [{"ref": ref, "final_answer": blind or key, "markable": True}]))
        return {x["ref"]: x for x in rep["result"]["lessons"][0]["items"]}[ref]

    def reads(self, x):
        return not any(self.READ in p for p in x["typing_problems"])


@unittest.skipUnless(NODE, "node runs the workflow through the stub runtime")
class ValueLabels(TypedItem, unittest.TestCase):
    """g10m3s2-1 (Chapter 3, sequences): the book prints "T4 = −28,1; T5 = −33,1; T6 = −38,1" and the key lists "-28,1; -33,1; -38,1".
    The typing check compared them as unequal and G2's auto-pass excluded 24 of the lesson's 93 items for it. A label is not part of a
    value; nothing else is touched."""

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
        self.assertFalse(self.reads(self.typed("1,5; 2", "5; 1,2")), "no labels: the sorted set of values, never of digits")
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
        self.assertFalse(self.reads(y), "a values key of one value is read by the equation rules, as before")

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
class FractionKeys(TypedItem, unittest.TestCase):
    """Chapter 4: 12 items carried a numeric key written as a fraction ("numeric key \\frac{9}{10} is not a number"), and Chapter 3 two live
    numeric answers "-5/3" and "-1/2". The app's numeric grader reads "a/b" with parseFloat: the key "-5/3" is -5, so a correct "-5/3" or
    "-1.6667" is marked wrong. The expression marker marks the fraction. So the root fix is the KIND: typed again as an expression, the key
    kept exactly."""

    def test_a_numeric_key_that_is_a_fraction_is_typed_again_as_an_expression(self):
        for key, printed in (("\\frac{9}{10}", "9 10"), ("-\\frac{3}{8}", "−3 8"), ("\\dfrac{20}{3}", "20 3"), ("\\frac{-7}{8}", "−7 8"),
                             ("-5/3", "−5 3"), ("-\\frac{22}{6}", "−22 6")):
            x = self.typed(key, printed, answer_type="numeric", solution=[f"$x={key}$"])
            self.assertEqual((x["answer_type"], x["marker"]["kind"], x["marker"]["key"]), ("expression", "expression", key), key)
            self.assertEqual(x["typing_retyped"]["rule"], "fraction-key", key)
            self.assertEqual(x["typing_problems"], [], (key, x["typing_problems"]))

    def test_the_apps_marker_marks_the_retyped_fraction_where_its_numeric_grader_would_not(self):
        x = self.typed("-5/3", "−5 3", answer_type="numeric", solution=["$x=-5/3$"])
        out = app_marker(x["marker"], ["-5/3", "-10/6", "-\\frac{5}{3}", "5/3", "-5", "-1.6667"])
        self.assertIsNone(out["key_problem"])
        self.assertEqual(out["marks"], {"-5/3": "correct", "-10/6": "correct", "-\\frac{5}{3}": "correct", "5/3": "incorrect", "-5": "incorrect",
                                        "-1.6667": "wrong_form"})

    def test_a_different_fraction_a_decimal_and_a_mixed_number_are_not_the_printed_answer(self):
        self.assertFalse(self.reads(self.typed("\\frac{9}{10}", "9 11", answer_type="numeric", solution=["$x=\\frac{9}{10}$"])))
        self.assertFalse(self.reads(self.typed("\\frac{9}{10}", "0,9", answer_type="numeric", solution=["$x=\\frac{9}{10}$"])))
        # a mixed number is not "one fraction": the numeric rule still refuses it, nothing is retyped
        y = self.typed("1\\frac{1}{2}", "1 1 2", answer_type="numeric", solution=["$x=1\\frac{1}{2}$"])
        self.assertEqual(y["answer_type"], "numeric")
        self.assertIn('numeric key "1\\frac{1}{2}" is not a number', y["typing_problems"])
        self.assertNotIn("typing_retyped", y)

    def test_a_plain_number_and_a_decimal_comma_stay_numeric(self):
        for key, printed in (("15", "15"), ("0,5", "0,5"), ("-28,1", "−28,1")):
            x = self.typed(key, printed, answer_type="numeric", solution=[f"$x={key}$"])
            self.assertEqual(x["answer_type"], "numeric", key)
            self.assertNotIn("typing_retyped", x, key)

    def test_a_trailing_unit_is_set_aside_only_when_the_items_own_stem_names_it(self):
        stem = "Stephen has 1 litre of a mixture. How much water must he add? Write your answer as a fraction of a litre."
        x = self.typed("\\frac{19}{50}", "19 50 litres", kind="expression", stem=stem, solution=["$\\frac{19}{50}$"])
        self.assertTrue(self.reads(x), x["typing_problems"])
        # no litre in the stem: "litres" is a word the item never used, nothing is set aside
        y = self.typed("\\frac{19}{50}", "19 50 litres", kind="expression", stem="Write your answer as a fraction.", solution=["$\\frac{19}{50}$"])
        self.assertFalse(self.reads(y))
        # a different fraction is still different, unit or not
        z = self.typed("\\frac{19}{50}", "19 51 litres", kind="expression", stem=stem, solution=["$\\frac{19}{50}$"])
        self.assertFalse(self.reads(z))


@unittest.skipUnless(NODE, "node runs the workflow through the stub runtime")
class ListsFromSentences(TypedItem, unittest.TestCase):
    """Chapter 4: a word problem's printed answer is a sentence ("There are 5 tricycles and 2 bicycles.") and the key is its list of values.
    A match needs the sentence's numbers to BE the key's values, in order, and nothing else; "b = ±2" is two values; a book solution's
    sentence in maths is read by its `var = value` segments."""

    def test_the_values_a_sentence_states_are_the_keys_list_in_order(self):
        cases = [
            ("5; 2", "There are 5 tricycles and 2 bicycles."),
            ("7; 35", "7 and 35 years old."),
            ("80; 68", "Zwelibanzi achieved 80 marks and Jessica achieved 68 marks."),
            ("48; 96; 36", "48 blue beads, 96 red beads and 36 purple beads,"),
            ("6; 4", "length: 6 cm, width: 4 cm"),
            ("34; 27", "a milkshake costs R 34 and a wrap costs R 27."),
            ("9; 11", "One chocolate milkshake costs R9,00 and one fruitshake costs R11,00."),     # 9,00 is 9
            ("-34; -33", "The two consecutive negative integers are -34 and -33."),
            ("28; 45; 53", "width w=28 cm length l=45 cm and diagonal d=53 cm."),
            ("8; 16", "b = 8 cm and l = 2b = 16 cm"),                                                # 2b is a coefficient, not a value
            ("9,96; 8,35", "9,96 mm and 8,35 mm"),                                                     # units alone are no word, and no number
            ("8,7; 5,65; 5,65", "8,7 cm, 5,65 cm and 5,65 cm"),
        ]
        for key, printed in cases:
            x = self.typed(key, printed)
            self.assertTrue(self.reads(x), (printed, x["typing_problems"]))

    def test_a_sentence_that_states_anything_else_is_not_the_keys_list(self):
        cases = [
            ("5; 3", "There are 5 tricycles and 2 bicycles."),                       # a different value
            ("2; 5", "There are 5 tricycles and 2 bicycles."),                       # the same values, the other way round
            ("-5; 2", "There are 5 tricycles and 2 bicycles."),                      # a sign
            ("5; 2", "There are 5 tricycles, 2 bicycles and 3 scooters."),           # a value the key does not list
            ("5; 2; 3", "There are 5 tricycles and 2 bicycles."),                    # a value the sentence does not state
            ("5; 2", "There are 5kg of tricycles and 2 bicycles."),                  # a number glued to a letter is not read
            ("8; 16", "b = 8 cm and l = 2b = 16 cm and 12 cm"),                      # once there is an "=", a number it does not set is refused
            ("5; 2", "5 and 2"),                                                     # no word: not a sentence
            ("9,96; 8,35", "9,96 mm and 8,36 mm"),                                   # units do not make a number right
            ("9,96; 8,35", "8,35 mm and 9,96 mm"),                                   # nor its order
            ("9,96; 8,35", "9,96 mm and 8,35 mm and 4 mm"),
            ("9,96; 8,35", "9,96 mm and 8,35 x"),                                    # a bare variable is not a unit
        ]
        for key, printed in cases:
            x = self.typed(key, printed)
            if printed == "5 and 2":
                continue
            self.assertFalse(self.reads(x), (key, printed))

    def test_a_book_solutions_sentence_in_maths_is_read_by_its_assignments(self):
        sol = "The solution to $3{x}^{2}+2x-1=0$ is $x=-1$ or $x=\\frac{1}{3}$ ."
        ok = self.typed("-1; \\frac{1}{3}", None, final=sol, solution=[sol], raw_final=True)
        self.assertTrue(self.reads(ok), ok["typing_problems"])
        self.assertEqual(ok["typing_problems"], [])
        for key in ("-1; \\frac{1}{2}", "1; \\frac{1}{3}", "-1; 3"):
            bad = self.typed(key, None, final=sol, solution=[sol], raw_final=True)
            self.assertFalse(self.reads(bad), key)
        # a bare value after "or" is the same list ("x=-1 or 1/3"), and a different bare value is not
        for printed_final, ok_ in (("The solutions are $x=-1$ or $\\frac{1}{3}$ .", True), ("The solutions are $x=-1$ or $\\frac{1}{2}$ .", False)):
            y = self.typed("-1; \\frac{1}{3}", None, final=printed_final, solution=[printed_final], raw_final=True)
            self.assertEqual(self.reads(y), ok_, printed_final)

    def test_plus_or_minus_is_two_values_and_one_value_is_not_two(self):
        cases = [
            ("2; -2; 3; -3", "b = ±2 or b = ±3"),
            ("-8; 8", "b = ±8"),
            ("h=16; h=-16", "h = ±16"),
            ("\\sqrt{3}; -\\sqrt{3}; 1; -1", "b = ± √ 3 or b = ±1"),
            ("\\frac{2}{3}; -\\frac{2}{3}; 1; -1", "y = ± 2 3 or y = ±1"),
        ]
        for key, printed in cases:
            x = self.typed(key, printed)
            self.assertTrue(self.reads(x), (printed, x["typing_problems"]))
        for key, printed in (("8; 9", "b = ±8"), ("-8; 9", "b = ±8"), ("-8; 8", "b = ±9"), ("2; -2", "b = ±2 or b = ±3"), ("2; 3", "b = ±2 or b = ±3")):
            self.assertFalse(self.reads(self.typed(key, printed)), (key, printed))
        # one value is not two: the key "8" lost the solution -8 (the old signature read "±8" as "8")
        self.assertFalse(self.reads(self.typed("8", "b = ±8")))
        self.assertFalse(self.reads(self.typed("8", "b = ±8", kind="expression", variables=("b",))))
        # the same four values in another order, with one label, are a set
        self.assertTrue(self.reads(self.typed("2; -3; 3; -2", "b = ±2 or b = ±3")))

    def test_a_list_of_values_typed_surd_is_typed_values_and_the_apps_marker_reads_it(self):
        x = self.typed("\\sqrt{18}; -\\sqrt{18}", "x = √ 18 or x = − √ 18", kind="surd", variables=("x",))
        self.assertEqual((x["marker"]["kind"], x["typing_retyped"]["rule"]), ("values", "kind-for-list"))
        self.assertEqual(x["marker"]["key"], "\\sqrt{18}; -\\sqrt{18}", "the key is kept exactly")
        self.assertTrue(self.reads(x), x["typing_problems"])
        out = app_marker(x["marker"], ["3\\sqrt{2}; -3\\sqrt{2}", "-\\sqrt{18}; \\sqrt{18}", "\\sqrt{18}"])
        self.assertIsNone(out["key_problem"], "the app's marker could not read this key as a surd")
        self.assertEqual(out["marks"]["-\\sqrt{18}; \\sqrt{18}"], "correct")
        self.assertEqual(out["marks"]["\\sqrt{18}"], "incorrect")
        # a single surd, and a list with a variable in it, are not retyped
        y = self.typed("3\\sqrt{2}", "3 √ 2", kind="surd", variables=("x",))
        self.assertNotIn("typing_retyped", y)
        z = self.typed("x+1; x-1", "x + 1; x − 1", kind="expression", variables=("x",))
        self.assertNotIn("typing_retyped", z)


@unittest.skipUnless(NODE, "node runs the workflow through the stub runtime")
class Relations(TypedItem, unittest.TestCase):
    """Chapter 4 (g10m4s7-1): inequalities, set membership and intervals. A match is the same relations, signs, values, brackets and
    constraints, found whole in what the book printed; the flattened print is read first (a solidus + "=" is ≠, "6 5" in an interval
    is 6/5), and a number line's axis and the next part's answer that runs on are not this answer. What the key gets wrong or leaves out
    is NOT a match."""

    def rel(self, key, printed, ref="Ex4-6:4b", kind="interval"):
        return self.typed(key, printed, kind=kind, variables=("x",), ref=ref, stem="Solve and show the answer on a number line.")

    def test_an_inequality_a_membership_or_an_interval_is_found_whole_in_the_printed_answer(self):
        cases = [
            ("b>1; b\\in\\mathbb{Z}", "b 1 2 3 4 5 b > 1; b ∈Z", "Ex4-6:4a"),                          # the axis is not the answer
            ("x < 4; x \\in \\mathbb{N}", "x 0 1 2 3 4 5 x < 4; x ∈N", "Ex4-7:11a"),
            ("x < 0; x \\in \\mathbb{R}", "x −3 −2 −1 0 1 2 3 x < 0; x ∈R", "Ex4-7:11c"),
            ("4.45 \\leq x < 4.55", "x 4.40 4.45 4.50 4.55 4.60 4.45 ≤x < 4.55", "Ex4-7:13"),          # the answer starts with a number
            ("x\\neq3; x\\neq6; x\\in\\mathbb{R}", "x ̸= 3; x ̸= 6; x ∈R", "Ex4-6:1c"),                  # ≠ is a solidus and "="
            ("[\\frac{29}{13};\\infty)", "x ∈ [ 29 13 ; ∞ ) .", "Ex4-6:3c"),                           # a flattened fraction in an endpoint
            ("(-\\infty;-\\frac{21}{11}]", "( −∞; −21 11 ] g) ( −∞; −3 2 ) ∪ ( 1 2 ; ∞ )", "Ex4-6:3f"),  # g) is the next part's answer
            ("(-\\infty;\\frac{6}{5}]", "x ∈ ( −∞; 6 5 ] . e) ( −∞; −55 13 )", "Ex4-6:3d"),
            ("\\left(-\\infty;-\\frac{8}{5}\\right]", "x ∈ ( −∞; −8 5 ] . c) [ 80 31 ; ∞ )", "Ex4-7:10b"),
            ("-3 \\leq k < 2", "−3 ≤k < 2", "Ex4-7:12p"),
        ]
        for key, printed, ref in cases:
            x = self.rel(key, printed, ref)
            self.assertTrue(self.reads(x), (printed, x["typing_problems"]))

    def test_a_changed_bound_relation_bracket_or_constraint_is_never_a_match(self):
        cases = [
            # the two real mismatches Chapter 4 holds (the key says 0 where the book says 7, and the other way round)
            ("a>0; a\\in\\mathbb{N}", "a −1 0 1 2 3 4 5 a > 7; a ∈N", "Ex4-6:4b"),
            ("b < -4; b \\in \\mathbb{Z}", "b −6 −5 −4 −3 −2 −1 0 b > 4; b ∈Z", "Ex4-7:11b"),
            # a constraint the key leaves out (the book's answer is for the naturals, the key is for the reals)
            ("a > 6", "a 5 6 7 8 8 9 10 a > 6; a ∈N", "Ex4-6:4d"),
            ("b < -14", "b −18 −17 −16 −15 −14 −13 −12 b < −14; b ∈R", "Ex4-6:4c"),
            # an extra constraint in the key, a different set
            ("a > 6; a \\in \\mathbb{Z}", "a 5 6 7 8 8 9 10 a > 6; a ∈N", "Ex4-6:4d"),
            # strict where the book is not, and the other way round
            ("x < 4; x \\in \\mathbb{N}", "x 0 1 2 3 4 5 x ≤ 4; x ∈N", "Ex4-7:11a"),
            ("4.45 < x < 4.55", "x 4.40 4.45 4.50 4.55 4.60 4.45 ≤x < 4.55", "Ex4-7:13"),
            # another bracket, another endpoint, another sign, an interval the book did not print, a missing one
            ("(-\\infty;\\frac{6}{5})", "x ∈ ( −∞; 6 5 ] . e) ( −∞; −55 13 )", "Ex4-6:3d"),
            ("(-\\infty;\\frac{5}{6}]", "x ∈ ( −∞; 6 5 ] . e) ( −∞; −55 13 )", "Ex4-6:3d"),
            ("(-\\infty;-\\frac{6}{5}]", "x ∈ ( −∞; 6 5 ] . e) ( −∞; −55 13 )", "Ex4-6:3d"),
            ("[\\frac{29}{13};\\infty)", "x ∈ ( 29 13 ; ∞ ) .", "Ex4-6:3c"),
            ("(-\\infty;-\\frac{21}{11}]", "( −∞; −21 11 ] g) ( −∞; −3 2 ) ∪ ( 1 2 ; ∞ )", "Ex4-6:3e"),     # the part letter is not f: nothing is cut
            ("x\\neq3; x\\neq6; x\\in\\mathbb{R}", "x ̸= 3; x ̸= 7; x ∈R", "Ex4-6:1c"),
            ("x\\neq3; x\\neq6", "x ̸= 3; x ̸= 6; x ∈R", "Ex4-6:1c"),
        ]
        for key, printed, ref in cases:
            x = self.rel(key, printed, ref)
            self.assertFalse(self.reads(x), (key, printed))
            self.assertNotEqual(x["verification"], "agreed", (key, printed))

    def test_the_next_parts_answer_is_cut_only_at_its_own_part_letter(self):
        # the printed answer of d) runs on into "e)": cut there. The union the book printed for f) is f)'s whole answer when no part follows.
        key, printed = "(-\\infty;-\\frac{3}{2})\\cup(\\frac{1}{2};\\infty)", "( −∞; −3 2 ) ∪ ( 1 2 ; ∞ )"
        self.assertTrue(self.reads(self.rel(key, printed, "Ex4-6:3g")))
        self.assertFalse(self.reads(self.rel("(-\\infty;-\\frac{3}{2})", printed, "Ex4-6:3g")), "half of a union is not the union")

    def test_all_real_values_is_the_whole_line_unless_it_says_otherwise(self):
        for printed, ok in (("The inequality is true for all real values of $x$ .", True), ("It holds for any real number.", True),
                            ("The inequality is not true for all real values of $x$ .", False),
                            ("The inequality is true for all real values of $x$ except 3.", False),
                            ("The inequality is true for all integers.", False)):
            it = item("Ex4-6:2e", "Solve the inequality.", [f"{printed}"], None)
            t = typing("Ex4-6:2e", "(-\\infty;\\infty)", printed, "expression", marker_kind="interval", variables=["x"])
            rep = run(args_for([it]), responses([t], [{"ref": "Ex4-6:2e", "final_answer": "(-\\infty;\\infty)", "markable": True}]))
            x = rep["result"]["lessons"][0]["items"][0]
            self.assertEqual(self.reads(x), ok, (printed, x["typing_problems"]))

    def test_an_inequality_list_typed_equation_is_typed_interval_and_the_apps_marker_reads_it(self):
        x = self.rel("b>1; b\\in\\mathbb{Z}", "b 1 2 3 4 5 b > 1; b ∈Z", "Ex4-6:4a", kind="equation")
        self.assertEqual((x["marker"]["kind"], x["typing_retyped"]["rule"]), ("interval", "kind-for-relations"))
        self.assertEqual(x["marker"]["key"], "b>1; b\\in\\mathbb{Z}", "the key is kept exactly")
        out = app_marker(x["marker"], ["b>1", "b>2"])
        self.assertIsNone(out["key_problem"], "the app's marker could not read this key under its equation kind")
        self.assertEqual(out["marks"], {"b>1": "correct", "b>2": "incorrect"})
        # the same for a restriction typed "values" (Ex1-11:37b: "a ≠ b and a ≠ −3")
        r = self.typed("a \\neq b \\text{ and } a \\neq -3", "a ̸= b and a ̸= −3", kind="values", variables=("a",))
        self.assertEqual((r["marker"]["kind"], r["typing_retyped"]["rule"], r["typing_problems"]), ("interval", "kind-for-relations", []))
        self.assertIsNone(app_marker(r["marker"])["key_problem"])
        # an equation is not an inequality: nothing is retyped
        y = self.typed("y=2x+1", "y = 2x + 1", kind="equation", variables=("x", "y"))
        self.assertNotIn("typing_retyped", y)
        self.assertEqual(y["marker"]["kind"], "equation")


    def test_an_equation_typed_expression_or_surd_is_typed_equation_and_the_apps_marker_reads_it(self):
        # g10m3s2-1: "find the general term" keys T_n=4n-1 typed expression (expanded) were held "unanswerable" at assembly: the app's
        # expression kind refuses an equals sign; its equation kind reads it and marks the student's own spelling of it
        for kind, key, printed, variables in (("expression", "T_n=-14n+7", "= −14n + 7", ("n",)), ("expression", "T_n=4n-1", "T_n = 4n − 1", ("n",)),
                                              ("surd", "r=\\pm\\sqrt{\\frac{V}{\\pi h}}", "± √ V πh = r", ("r", "V", "h"))):
            x = self.typed(key, printed, kind=kind, variables=variables, form="expanded" if kind == "expression" else None)
            self.assertEqual((x["marker"]["kind"], x["typing_retyped"]["rule"]), ("equation", "kind-for-equation"), key)
            self.assertEqual(x["marker"]["key"], key, "the key is kept exactly")
        x = self.typed("T_n=4n-1", "T_n = 4n − 1", kind="expression", variables=("n",), form="expanded")
        out = app_marker(x["marker"], ["T_n=4n-1", "T_n = 4n - 1", "4n - 1 = T_n", "T_n=4n+1"])
        self.assertIsNone(out["key_problem"])
        self.assertEqual(out["marks"], {"T_n=4n-1": "correct", "T_n = 4n - 1": "correct", "4n - 1 = T_n": "correct", "T_n=4n+1": "incorrect"})
        # not an equation, or more than one equals sign, or an inequality: the kind stands
        for kind, key in (("expression", "4n-1"), ("expression", "a=b=c"), ("expression", "x=2, x=3"), ("equation", "y=2x+1"), ("values", "T_n=4n-1")):
            y = self.typed(key, key, kind=kind, variables=("n",))
            self.assertNotIn("typing_retyped", y, (kind, key))


    def test_greek_variables_are_told_to_the_marker_by_name_and_pi_is_not_a_variable(self):
        # the seam (schemas.AnswerSpec) refuses a variable written as the sign: "λ" held Ex4-5:8 and "π" would hold Ex4-5:5, 13 and 15
        x = self.typed("\\lambda=\\frac{D}{tf}", "λ = D tf", kind="equation", variables=("λ", "D", "t", "f"))
        self.assertEqual(x["marker"]["variables"], ["\\lambda", "D", "t", "f"])
        schemas.AnswerSpec.model_validate(x["marker"])
        y = self.typed("h=\\frac{A-2\\pi r}{2\\pi r}", "A−2πr 2πr = h", kind="equation", variables=("h", "A", "π", "r"))
        self.assertEqual(y["marker"]["variables"], ["h", "A", "r"])
        schemas.AnswerSpec.model_validate(y["marker"])
        self.assertEqual(alb.marker_spec_problems(y), [])
        out = app_marker(y["marker"], ["h=\\frac{A-2\\pi r}{2\\pi r}", "h=\\frac{A}{2\\pi r}-1"])
        self.assertIsNone(out["key_problem"])
        self.assertEqual(out["marks"], {"h=\\frac{A-2\\pi r}{2\\pi r}": "correct", "h=\\frac{A}{2\\pi r}-1": "correct"})


def run_all_unanswered_null(args, responses):
    """`run` for a fixture with many items: an agent label with no canned answer (a second judge batch) answers nothing, as a skipped agent."""
    with tempfile.TemporaryDirectory() as d:
        f = Path(d, "fx.json")
        f.write_text(json.dumps({"args": args, "responses": responses, "responder": str(EX / "dryrun" / "null_responder.mjs")}))
        out = subprocess.run([NODE, str(STUB), str(WORKFLOW), str(f)], capture_output=True, text=True, check=True)
    rep = json.loads(out.stdout)
    assert rep["ok"], rep["error"]
    return rep


def single_edits(key):
    """Every single-character change of a key that changes what it says: a digit, a sign dropped, a relation or a bracket turned over."""
    out = set()
    for i, c in enumerate(key):
        if c.isdigit():
            out |= {key[:i] + d + key[i + 1:] for d in "0123456789" if d != c}
        for a, b in (("<", ">"), (">", "<"), ("[", "("), ("(", "["), ("]", ")"), (")", "]")):
            if c == a:
                out.add(key[:i] + b + key[i + 1:])
        if c == "-":
            out.add(key[:i] + key[i + 1:])
    return out - {key}


@unittest.skipUnless(NODE, "node runs the workflow through the stub runtime")
class NoSingleEditIsAccepted(unittest.TestCase):
    """The strictness of everything above, all at once: for every true match the tests list (a labelled list, a sentence, ±, an inequality,
    an interval), EVERY key that differs from it by one digit, one dropped sign, one relation or one bracket turned over is still refused.
    (Run against Chapters 1–4's 228 accepted keys, 6,642 such edits were refused: no false accept.)"""

    # (key, printed, ref, marker kind, variables)
    CASES = [
        ("-28,1; -33,1; -38,1", "T4 = −28,1; T5 = −33,1; T6 = −38,1", "Ex3-1:5", "values", ()),
        ("-3; 3", "T1 = −3 and T2 = 3", "Ex3-1:5", "values", ()),
        ("-4n - 14; -54; -74; -134", "Tn = −4n −14, T10 = −54, T15 = −74, T30 = −134", "Ex3-2:5", "values", ("n",)),
        ("5; 2", "There are 5 tricycles and 2 bicycles.", "Ex4-4:5", "values", ()),
        ("48; 96; 36", "48 blue beads, 96 red beads and 36 purple beads,", "Ex4-4:5", "values", ()),
        ("9; 11", "One chocolate milkshake costs R9,00 and one fruitshake costs R11,00.", "Ex4-4:5", "values", ()),
        ("28; 45; 53", "width w=28 cm length l=45 cm and diagonal d=53 cm.", "Ex4-4:5", "values", ()),
        ("8; 16", "b = 8 cm and l = 2b = 16 cm", "Ex4-4:5", "values", ()),
        ("2; -2; 3; -3", "b = ±2 or b = ±3", "Ex4-2:3", "values", ()),
        ("-8; 8", "b = ±8", "Ex4-2:3", "values", ()),
        ("\\sqrt{3}; -\\sqrt{3}; 1; -1", "b = ± √ 3 or b = ±1", "Ex4-2:3", "values", ()),
        ("b>1; b\\in\\mathbb{Z}", "b 1 2 3 4 5 b > 1; b ∈Z", "Ex4-6:4a", "interval", ("b",)),
        ("x < 4; x \\in \\mathbb{N}", "x 0 1 2 3 4 5 x < 4; x ∈N", "Ex4-7:11a", "interval", ("x",)),
        ("4.45 \\leq x < 4.55", "x 4.40 4.45 4.50 4.55 4.60 4.45 ≤x < 4.55", "Ex4-7:13", "interval", ("x",)),
        ("x\\neq3; x\\neq6; x\\in\\mathbb{R}", "x ̸= 3; x ̸= 6; x ∈R", "Ex4-6:1c", "interval", ("x",)),
        ("[\\frac{29}{13};\\infty)", "x ∈ [ 29 13 ; ∞ ) .", "Ex4-6:3c", "interval", ("x",)),
        ("(-\\infty;-\\frac{21}{11}]", "( −∞; −21 11 ] g) ( −∞; −3 2 ) ∪ ( 1 2 ; ∞ )", "Ex4-6:3f", "interval", ("x",)),
        ("(-\\infty;\\frac{6}{5}]", "x ∈ ( −∞; 6 5 ] . e) ( −∞; −55 13 )", "Ex4-6:3d", "interval", ("x",)),
        ("\\left(-\\infty;-\\frac{8}{5}\\right]", "x ∈ ( −∞; −8 5 ] . c) [ 80 31 ; ∞ )", "Ex4-7:10b", "interval", ("x",)),
        ("-3 \\leq k < 2", "−3 ≤k < 2", "Ex4-7:12p", "interval", ("k",)),
    ]

    def test_every_single_edit_of_a_true_match_is_refused(self):
        items, types, blinds, expect_read = [], [], [], {}
        n = 0
        for key, printed, ref, kind, variables in self.CASES:
            part = ref[-1] if ref[-1].isalpha() else ""
            for k in [key, *sorted(single_edits(key))]:
                n += 1
                r = f"{ref.split(':')[0]}:{n}{part}"
                items.append(item(r, "Write down the answer.", [f"${k}$"], printed))
                types.append(typing(r, k, f"${k}$", "expression", marker_kind=kind, variables=list(variables)))
                blinds.append({"ref": r, "final_answer": k, "markable": True})
                expect_read[r] = k == key
        a = args_for(items)
        a["options"].update({"typing_batch": 100000, "blind_batch": 100000})
        rep = run_all_unanswered_null(a, responses(types, blinds))
        by = {x["ref"]: x for x in rep["result"]["lessons"][0]["items"]}
        self.assertGreater(len(items), 500, "the edits were not generated")
        wrong = [(by[r]["answer"], by[r]["printed_answer"]) for r, reads in expect_read.items()
                 if any("does not read as" in p for p in by[r]["typing_problems"]) == reads]
        self.assertEqual(wrong, [], f"{len(wrong)} of {len(items)}: an original that no longer reads, or an edit that does")


@unittest.skipUnless(NODE, "node runs the workflow through the stub runtime")
class ApproximateFinals(TypedItem, unittest.TestCase):
    """Chapter 5 (g10m5s7-1, trigonometry "solving problems"): 75 of 88 items failed "book_final is not in the book solution", none of them wrong. The
    typing agent copies the final as plain text (`x ≈ 76,60`, `θ ≈ 26,6°`, `sin B̂ = AC/AB`); the book's solution is LaTeX with the decimal comma inside
    \\text{…}, `\\approx`, `^{\\circ}`, `\\hat{B}`, `\\frac{AC}{AB}`, and the unrounded value (`\\text{76,60444...}`) in the working. The same signs are read the same;
    a DIGIT never is: the final must be the book's own rounded value, as a whole number."""

    def contained(self, solution, final, key="1", ref="WE4", answer_type="numeric", kind=None, variables=(), printed=None):
        it = item(ref, "Find the unknown.", solution, printed)
        t = typing(ref, key, final, answer_type, **({"marker_kind": kind, "variables": list(variables)} if answer_type == "expression" else {}))
        rep = run(args_for([it]), responses([t], [{"ref": ref, "final_answer": key, "markable": True}]))
        x = rep["result"]["lessons"][0]["items"][0]
        return "book_final is not in the book solution" not in x["typing_problems"]

    WE4 = ["Use your calculator to find the answer: $\\begin{align*}x&=\\text{76,60444...}\\\\x&\\approx\\text{76,60}\\end{align*}$"]
    WE5 = ["Use your calculator: $\\begin{align*}x&=\\frac{7}{\\text{0,90630...}}\\\\&=\\text{7,723645...}\\\\&\\approx\\text{7,72}\\end{align*}$"]
    WE6 = ["$\\begin{align*}x&=\\text{3,26415...}\\\\x&\\approx\\text{3,26}\\\\\\\\y&=\\text{7,72364...}\\\\y&\\approx\\text{7,72}\\end{align*}$"]
    WE7 = ["$\\theta=\\text{26,56505...}\\approx\\text{26,6}$", "Write the final answer: $\\theta\\approx\\text{26,6}^{\\circ}$"]
    ANGLE = ["$\\begin{align*}\\tan\\alpha&=\\frac{4}{9}\\\\&=\\text{0,4444...}\\\\\\alpha&=\\text{23,9624...}\\\\&\\approx\\text{23,96}^{\\circ}\\end{align*}$"]
    H10 = ["$\\begin{align*}\\sin30^{\\circ}&=\\frac{h}{20}\\\\20(\\text{0,5})&=h\\\\h&\\approx10\\end{align*}$"]
    RATIO = ["We note that triangles $ABC$ and $ABD$ both contain angle $B$:", "$\\sin\\hat{B}=\\frac{AC}{AB}=\\frac{AD}{BD}$"]

    def test_the_books_rounded_value_in_the_agents_plain_text_is_in_the_solution(self):
        for sol, final, key in ((self.WE4, "x ≈ 76,60", "76,60"), (self.WE5, "x ≈ 7,72", "7,72"), (self.WE7, "θ ≈ 26,6°", "26,6"),
                                (self.ANGLE, "α ≈ 23,96°", "23,96"), (self.ANGLE, "≈23,96°", "23,96"), (self.H10, "h ≈ 10", "10")):
            self.assertTrue(self.contained(sol, final, key), final)
        self.assertTrue(self.contained(self.WE6, "x ≈ 3,26, y ≈ 7,72", "3,26; 7,72", answer_type="expression", kind="values"))
        self.assertTrue(self.contained(self.RATIO, "sin B̂ = AC/AB = AD/BD", "\\frac{AC}{AB} = \\frac{AD}{BD}", answer_type="expression", kind="equation",
                                       variables=("A", "B", "C", "D")))
        self.assertTrue(self.contained(self.RATIO, "$\\sin\\hat{B}=\\frac{AC}{AB}=\\frac{AD}{BD}$", "\\frac{AC}{AB} = \\frac{AD}{BD}", answer_type="expression",
                                       kind="equation", variables=("A", "B", "C", "D")))

    def test_a_different_rounding_digit_sign_or_relation_is_refused(self):
        cases = [
            (self.WE4, "x ≈ 76,6"),            # 76,6 is not 76,60: a different rounding
            (self.WE4, "x ≈ 76,61"),           # a different digit
            (self.WE4, "x ≈ 77,60"),
            (self.WE4, "x ≈ 6,60"),            # a number is not found inside a longer one
            (self.WE4, "x ≈ 76"),
            (self.WE4, "x = 76,60"),           # the solution says ≈, not =
            (self.WE4, "x ≈ -76,60"),
            (self.WE5, "x ≈ 7,7"),
            (self.WE5, "x ≈ 7,723645"),        # the unrounded value is the working, not the book's final
            (self.WE7, "θ ≈ 26,7°"),
            (self.WE7, "θ ≈ 26,6"),            # the book's final carries the degree sign… (see below: the sign is part of the final's text)
            (self.ANGLE, "α ≈ 23,9°"),
            (self.ANGLE, "α ≈ 24°"),
            (self.H10, "h ≈ 1"),               # 1 is not found inside 10
            (self.H10, "h ≈ 100"),
            (self.RATIO, "sin B̂ = AC/BC = AD/BD"),
            (self.RATIO, "cos B̂ = AC/AB = AD/BD"),
            (self.RATIO, "sin B̂ = AC/AB = AD/DB"),
        ]
        for sol, final in cases:
            if final == "θ ≈ 26,6":
                continue            # (a final without its unit is a shorter copy of the same value: accepted, as before)
            self.assertFalse(self.contained(sol, final, "1"), final)

    def test_the_unrounded_value_alone_is_not_a_final(self):
        # a solution that only works to 7,723645… never states a rounded answer: a final "x ≈ 7,72" is the agent's own rounding
        sol = ["$\\begin{align*}x&=\\frac{7}{\\text{0,90630...}}\\\\&=\\text{7,723645...}\\end{align*}$"]
        self.assertFalse(self.contained(sol, "x ≈ 7,72", "7,72"))

    def test_a_greek_label_on_the_blind_answer_is_a_label_not_a_difference(self):
        # `\theta \approx 42{,}07^{\circ}` against the printed "42,07°": settled by the signature, no judge (the key kept Greek letters visible, so
        # these 13 pairs of g10m5s7-1 were sent to a judge for a label)
        it = item("Ex5-8:17a", "Find θ.", ["$\\begin{align*}\\theta&=\\text{42,07...}\\\\&\\approx\\text{42,07}^{\\circ}\\end{align*}$"], "42,07°")
        t = typing("Ex5-8:17a", "42,07", "$\\theta\\approx\\text{42,07}^{\\circ}$", "numeric", unit="°")
        rep = run(args_for([it]), responses([t], [{"ref": "Ex5-8:17a", "final_answer": "\\theta \\approx 42{,}07^{\\circ}", "markable": True}]))
        x = rep["result"]["lessons"][0]["items"][0]
        routes = {p["pair_id"].split("|")[1]: p["route"] for p in x["verify"]["pairs"]}
        self.assertIn(routes["blind~printed"], ("normalised", "signature"))
        self.assertEqual(x["verification"], "agreed")
        self.assertEqual([c["label"] for c in rep["calls"] if c["label"].startswith("S3:judge:")], [])
        # …and a different angle, or π that is not in the printed answer, is still different
        for blind, printed in (("\\theta \\approx 42{,}08^{\\circ}", "42,07°"), ("2\\pi r", "2r"), ("\\pi", "3")):
            it2 = item("Ex5-8:17a", "Find it.", ["$x$"], printed)
            rep2 = run(args_for([it2]), responses([typing("Ex5-8:17a", "1", "$x$", "numeric")], [{"ref": "Ex5-8:17a", "final_answer": blind, "markable": True}]))
            y = rep2["result"]["lessons"][0]["items"][0]
            self.assertEqual({p["pair_id"].split("|")[1]: p["route"] for p in y["verify"]["pairs"]}["blind~printed"], "judge", blind)


@unittest.skipUnless(NODE, "node runs the workflow through the stub runtime")
class InTheBookSolution(TypedItem, unittest.TestCase):
    """What "book_final is not in the book solution" got wrong in Chapters 3 and 4 (none of it a wrong final)."""

    def final_problem(self, solution, final, ref="Ex4-5:2", stem="Make $a$ the subject of the formula.", key=None, kind="equation", variables=("a",)):
        it = item(ref, stem, solution, "x")
        t = typing(ref, key or final, f"${final}$", "expression", marker_kind=kind, variables=list(variables))
        rep = run(args_for([it]), responses([t], [{"ref": ref, "final_answer": "x", "markable": True}]))
        return "book_final is not in the book solution" in rep["result"]["lessons"][0]["items"][0]["typing_problems"]

    def test_an_equation_the_other_way_round_is_the_solutions_last_line(self):
        sol = ["$\\begin{align*}s&=ut+\\frac{1}{2}at^{2}\\\\2s-2ut&=at^{2}\\\\\\frac{2(s-ut)}{t^{2}}&=a\\end{align*}$"]
        self.assertFalse(self.final_problem(sol, "a=\\frac{2(s-ut)}{t^{2}}"))
        self.assertTrue(self.final_problem(sol, "a=\\frac{2(s-ut)}{t^{3}}"), "another exponent is another final")
        self.assertTrue(self.final_problem(sol, "a=\\frac{2(s+ut)}{t^{2}}"), "another sign is another final")

    def test_an_aligned_array_row_reads_its_relation(self):
        sol = ["$\\begin{align*}\\begin{array}{ccccc}-5&\\le&2k+1&<&5\\\\-6&\\le&2k&<&4\\\\-3&\\le&k&<&2\\end{array}\\end{align*}$"]
        self.assertFalse(self.final_problem(sol, "-3\\le k<2", ref="Ex4-7:12p", kind="interval", variables=("k",)))
        self.assertTrue(self.final_problem(sol, "-3\\le k<3", ref="Ex4-7:12p", kind="interval", variables=("k",)))
        self.assertTrue(self.final_problem(sol, "-3<k<2", ref="Ex4-7:12p", kind="interval", variables=("k",)))

    def test_a_greek_letter_glued_to_the_next_one_in_the_epub_is_still_the_same_formula(self):
        sol = ["$\\begin{align*}V&=\\pir^{2}h\\\\\\frac{V}{\\pih}&=r^{2}\\\\\\pm\\sqrt{\\frac{V}{\\pih}}&=r\\end{align*}$"]
        self.assertFalse(self.final_problem(sol, "r=\\pm\\sqrt{\\frac{V}{\\pi h}}", ref="Ex4-5:5", kind="surd", variables=("r", "V", "h")))
        self.assertTrue(self.final_problem(sol, "r=\\pm\\sqrt{\\frac{V}{2\\pi h}}", ref="Ex4-5:5", kind="surd", variables=("r", "V", "h")))

    def test_a_greek_letter_is_never_invisible_in_the_printed_answers_signature(self):
        # the text layer keeps π: a key with it is not an answer without it, and 2πr is 2πr either way it is written
        sol = ["$h=\\frac{A-2\\pi r}{2\\pi r}$"]
        ok = self.typed("h=\\frac{A-2\\pi r}{2\\pi r}", "A−2πr 2πr = h", kind="equation", variables=("h", "A", "r"), solution=sol)
        self.assertTrue(self.reads(ok), ok["typing_problems"])
        bad = self.typed("h=\\frac{A-2\\pi r}{2\\pi r}", "A−2r 2r = h", kind="equation", variables=("h", "A", "r"), solution=sol)
        self.assertFalse(self.reads(bad))


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
