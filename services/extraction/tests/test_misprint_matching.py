"""Misprint corrections reach the record whatever its notation (answer_gen.apply_misprints; found 2026-10-29: 26 of
Prep 3's 36 misprints were matched exactly and never applied, so "Is R a subset of X × Z?" was answered as printed).

    uv run --with pytest python -m pytest -q tests/test_misprint_matching.py

No model is called.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import answer_gen as AG  # noqa: E402


def item(field, value, printed, intended):
    return {"id": "x:1", field: value, "misprints": [{"field": field, "printed": printed, "intended": intended}]}


class Placed(unittest.TestCase):
    def test_latex_for_a_symbol(self):
        r, missed = AG.apply_misprints(item("text", "Is R a subset of $X \\times Z$?", "X × Z", "X × Y"))
        self.assertEqual(r["text"], "Is R a subset of $X \\times Y$?")
        self.assertEqual(missed, [])

    def test_spacing_and_commas(self):
        r, _ = AG.apply_misprints(item("caption", "Start → SHIFT, sin, 0,544639035, =", "SHIFT sin 0,544639035", "SHIFT cos 0,544639035"))
        self.assertIn("SHIFT cos 0,544639035", r["caption"])

    def test_any_step_of_a_solution(self):
        rec = {"id": "x:1", "solution": ["first", "the pairs (3,0) and (3,b)"],
               "misprints": [{"field": "solution[0]", "printed": "(3,0)", "intended": "(3,a)"}]}
        r, missed = AG.apply_misprints(rec)
        self.assertEqual(r["solution"][1], "the pairs (3,a) and (3,b)")
        self.assertEqual(missed, [])

    def test_already_intended_is_not_missed(self):
        _, missed = AG.apply_misprints(item("text", "Subtracting both sides", "Substracting", "Subtracting"))
        self.assertEqual(missed, [])


class NotPlaced(unittest.TestCase):
    def test_a_no_op_record_changes_nothing(self):
        r, missed = AG.apply_misprints(item("text", "$4x^2 + 1 = 0$", "4x^2 + 1 = 0", "same"))
        self.assertEqual(r["text"], "$4x^2 + 1 = 0$")   # the old code wrote "$same$" here
        self.assertEqual(missed, [])

    def test_a_description_is_reported(self):
        _, missed = AG.apply_misprints(item("text", "y = 2(4) - 3", "(4, 5) with y = 5 when x = 4", "y = 2(4) - 3 = 5"))
        self.assertEqual(len(missed), 1)
        self.assertEqual(missed[0]["item"], "x:1")

    def test_never_across_a_dollar(self):
        _, missed = AG.apply_misprints(item("text", "the domain of $n_2=R-\\{-3\\}$", "the domain of n2 = R - {-3}", "R - {3}"))
        self.assertEqual(len(missed), 1)


if __name__ == "__main__":
    unittest.main()
