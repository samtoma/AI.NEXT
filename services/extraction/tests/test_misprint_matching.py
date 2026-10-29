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
        r, missed = AG.apply_misprints(item("text", "Is R a subset of $X \\times Z$?", "X × Z", "X × Y"), {})
        self.assertEqual(r["text"], "Is R a subset of $X \\times Y$?")
        self.assertEqual(missed, [])

    def test_spacing_and_commas(self):
        r, _ = AG.apply_misprints(item("caption", "Start → SHIFT, sin, 0,544639035, =", "SHIFT sin 0,544639035", "SHIFT cos 0,544639035"), {})
        self.assertIn("SHIFT cos 0,544639035", r["caption"])

    def test_any_step_of_a_solution(self):
        rec = {"id": "x:1", "solution": ["first", "the pairs (3,0) and (3,b)"],
               "misprints": [{"field": "solution[0]", "printed": "(3,0)", "intended": "(3,a)"}]}
        r, missed = AG.apply_misprints(rec, {})
        self.assertEqual(r["solution"][1], "the pairs (3,a) and (3,b)")
        self.assertEqual(missed, [])

    def test_already_intended_is_not_missed(self):
        _, missed = AG.apply_misprints(item("text", "Subtracting both sides", "Substracting", "Subtracting"), {})
        self.assertEqual(missed, [])


class NotPlaced(unittest.TestCase):
    def test_a_no_op_record_changes_nothing(self):
        r, missed = AG.apply_misprints(item("text", "$4x^2 + 1 = 0$", "4x^2 + 1 = 0", "same"), {})
        self.assertEqual(r["text"], "$4x^2 + 1 = 0$")   # the old code wrote "$same$" here
        self.assertEqual(missed, [])

    def test_a_description_is_reported(self):
        _, missed = AG.apply_misprints(item("text", "y = 2(4) - 3", "(4, 5) with y = 5 when x = 4", "y = 2(4) - 3 = 5"), {})
        self.assertEqual(len(missed), 1)
        self.assertEqual(missed[0]["item"], "x:1")

    def test_never_across_a_dollar(self):
        _, missed = AG.apply_misprints(item("text", "the domain of $n_2=R-\\{-3\\}$", "the domain of n2 = R - {-3}", "R - {3}"), {})
        self.assertEqual(len(missed), 1)


class Decisions(unittest.TestCase):
    """The review decides (2026-10-29): decisions on a book record used to reach nothing downstream."""

    def test_not_a_misprint_keeps_the_printed_text(self):
        rec = item("text", "$X \\times Z$", "X × Z", "X × Y")
        r, missed = AG.apply_misprints(rec, {"x:1#text": {"decision": "not_a_misprint"}})
        self.assertEqual(r["text"], "$X \\times Z$")
        self.assertEqual(missed, [])

    def test_a_different_correction_wins(self):
        rec = item("claim", "(LM)^2 = 9 + 16", "(LM)^2 = 9 + 16", "a long explanation, not a correction")
        r, _ = AG.apply_misprints(rec, {"x:1#claim": {"decision": "corrected", "intended": "(MN)^2 = 9 + 16"}})
        self.assertEqual(r["claim"], "(MN)^2 = 9 + 16")

    def test_match_places_what_the_page_words_cannot(self):
        rec = item("claim", "the cosine of the supplementary (complementary) angle", "supplementary angle", "complementary angle")
        self.assertEqual(len(AG.apply_misprints(rec, {})[1]), 1)
        r, missed = AG.apply_misprints(rec, {"x:1#claim": {"decision": "corrected", "intended": "complementary angle",
                                                         "match": "supplementary (complementary) angle"}})
        self.assertEqual(r["claim"], "the cosine of the complementary angle")
        self.assertEqual(missed, [])

    def test_a_missed_one_carries_its_decision(self):
        rec = item("text", "nothing like it", "printed words", "meant words")
        _, missed = AG.apply_misprints(rec, {"x:1#text": {"decision": "confirmed"}})
        self.assertEqual((missed[0]["ref"], missed[0]["decision"]), ("x:1#text", "confirmed"))

    def test_a_part_has_its_own_ref(self):
        rec = {"id": "x:1", "parts": [{"label": "A", "stem": "$X \\times Z$", "misprints": [{"field": "stem", "printed": "X × Z", "intended": "X × Y"}]}]}
        r, _ = AG.apply_misprints(rec, {"x:1:A#stem": {"decision": "not_a_misprint"}})
        self.assertEqual(r["parts"][0]["stem"], "$X \\times Z$")


if __name__ == "__main__":
    unittest.main()
