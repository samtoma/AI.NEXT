"""Short answers in a form of their own (Tamer, 2026-10-29: "mark the short forms"): an angle in degrees, minutes and
seconds or as a decimal of degrees, an approximate value, the empty set, and answers from a closed list of words become
questions instead of library worked examples. The app's marker reads each key (`_reads`, marker_check.mjs).

    uv run --with pytest python -m pytest -q tests/test_compile_short_forms.py

No model is called.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import compile_book_records as C  # noqa: E402


def marker(t):
    return t[1]["marker"] if t and t[0] == "short" else None


class Angles(unittest.TestCase):
    def test_degrees_minutes_and_seconds(self):
        m = marker(C.short_form("34° 36' 0''", "Write in degrees, minutes and seconds. $34{,}6^\\circ$"))
        self.assertEqual((m["kind"], m["key"], m["form"]), ("expression", "34° 36' 0''", "dms"))
        self.assertAlmostEqual(m["tolerance"]["abs"], 1.5 / 3600)
        self.assertEqual(marker(C.short_form("83° 14' 45.6''", ""))["key"], "83° 14' 45.6''")

    def test_a_decimal_of_degrees_only_for_an_angle_given_in_minutes(self):
        m = marker(C.short_form("76.2667°", "Write each of the following angles in degrees: $76^\\circ 16'$"))
        self.assertEqual((m["key"], m["form"], m["tolerance"]), ("76.2667", "decimal", {"abs": 0.005}))
        self.assertIsNone(C.short_form("76.2667°", "Find the angle."))


class Approximate(unittest.TestCase):
    def test_a_named_value(self):
        m = marker(C.short_form("σ ≈ 1.483 goals", "Find the standard deviation."))
        self.assertEqual((m["key"], m["tolerance"]), ("1.483", {"abs": 0.005}))

    def test_the_exact_value_of_arithmetic_working(self):
        self.assertEqual(marker(C.short_form("50/360 × 44 = 55/9 ≈ 6.11 cm", "length of arc CD"))["key"], "55/9")

    def test_not_when_the_answer_says_more(self):
        self.assertIsNone(C.short_form("m(EF) = 50°, length of EF = 50/360 × 88 = 110/9 ≈ 12.22 cm", ""))
        self.assertIsNone(C.short_form("Class A: mean = 30, σ ≈ 10.724; Class B: mean = 30, σ ≈ 10.954", ""))


class EmptySet(unittest.TestCase):
    def test_every_way_the_book_writes_it(self):
        for a in ["{} (the empty set, no solution)", "∅ (empty set)", "φ (empty set)", "ϕ"]:
            m = marker(C.short_form(a, ""))
            self.assertEqual((m["kind"], m["key"]), ("values", "\\{\\}"), a)


class ClosedLists(unittest.TestCase):
    def test_a_relation_between_two_lengths(self):
        t = C.short_form("MX = MY", "Complete by using the relation (>, <, and =): MX ......... MY")
        self.assertEqual(t, ("mcq", [{"key": "a", "text": "MX < MY"}, {"key": "b", "text": "MX = MY"},
                                     {"key": "c", "text": "MX > MY"}], "b"))

    def test_a_line_and_a_circle(self):
        q = "If $MA = 4\\sqrt{3}$ cm. Then the straight line L ......"
        self.assertEqual(C.short_form("is a secant to the circle M", q)[2], "a")
        self.assertEqual(C.short_form("is tangent to circle M", q)[2], "b")
        self.assertEqual(C.short_form("is tangent to circle M", q)[1][1]["text"], "is a tangent to circle M")

    def test_the_number_of_solutions(self):
        q = "What is the number of solutions of each pair in the following equations:"
        self.assertEqual(C.short_form("One solution (the pair (2, -2))", q)[2], "b")
        self.assertEqual(C.short_form("no solution", q)[2], "a")

    def test_an_infinite_number_for_one_how_many(self):
        self.assertEqual(C.short_form("Infinite (unlimited) number of diameters", "What are the number of diameters in any circle ?")[2], "c")
        self.assertIsNone(C.short_form("An infinite number of points; an infinite number of circles",
                                       "What are the number of points? What are the number of circles?"))

    def test_words_outside_a_list_stay_unmarked(self):
        self.assertIsNone(C.short_form("Undefined (no slope)", "Find the slope"))
        self.assertIsNone(C.short_form("inside; MA < r", "then A is ....... circle M, because ......"))


if __name__ == "__main__":
    unittest.main()


class ClosedListParts(unittest.TestCase):
    ANS = ("First table: inverse variation (xy = 60 always); second table: direct variation (y/x = 4.5 always); "
           "third table: direct variation (y/x = 1.8); fourth table: neither (y/x is not constant and xy is not constant).")
    Q = "Show which of the following tables represents the direct variation and which represents the inverse variation"

    def test_each_table_is_asked_from_the_list(self):
        parts = C.closed_list_parts(self.ANS, self.Q)
        self.assertEqual([p[0] for p in parts], [f"Answer only for the {o} table." for o in ("first", "second", "third", "fourth")])
        self.assertEqual([p[1][2] for p in parts], ["b", "a", "a", "c"])
        self.assertEqual([c["text"] for c in parts[0][1][1]], ["Direct variation", "Inverse variation", "Neither"])

    def test_nothing_when_a_part_is_off_the_list(self):
        self.assertEqual(C.closed_list_parts("First table: inverse; second table: it depends", self.Q), [])
        self.assertEqual(C.closed_list_parts(self.ANS, "Find y when x = 3"), [])


class Tables(unittest.TestCase):
    XY = {"header": ["x", "y"], "rows": [["3", "6"], ["-2", "-9"]]}

    def test_two_columns_are_written_across(self):
        self.assertEqual(C.table_tex(self.XY), "$\\begin{array}{c|cc} x & 3 & -2 \\\\ \\hline y & 6 & -9 \\end{array}$")

    def test_a_table_takes_the_place_of_the_placeholder(self):
        out = C.with_tables("The distribution shows the goals (table). Find the mean.", [self.XY])
        self.assertTrue(out.startswith("The distribution shows the goals $\\begin{array}"))
        self.assertTrue(out.endswith("\\end{array}$. Find the mean."))

    def test_several_are_named_by_position(self):
        out = C.with_tables("Which is which?", [self.XY, self.XY])
        self.assertIn("First table: $", out)
        self.assertIn("Second table: $", out)

    def test_words_are_text(self):
        self.assertIn("\\text{Number of goals}", C.table_tex({"header": ["Number of goals", "1"], "rows": [["Matches", "4"]]}))
