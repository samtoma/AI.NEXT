"""Answer forms compile marks (Tamer, 2026-10-29: "mark more answer forms"): a single measure, a count, a comparison sign
and set membership become questions instead of library worked examples. Exercises only; a worked example is unchanged.

    uv run --with pytest python -m pytest -q tests/test_compile_answer_forms.py

No model is called.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import compile_book_records as C  # noqa: E402


class Measures(unittest.TestCase):
    def test_a_measure_is_its_number(self):
        for ans, key in [("40°", "40"), ("5 cm", "5"), ("96 cm²", "96"), ("AB = 9.6 cm", "9.6"),
                         ("m(arc BD) = 32°", "32"), ("m(AB) = m(∠AMB) = 50°", "50"),
                         ("m(BC) = m(ACB) − m(AC) = 180° − 60° = 120°", "120")]:
            self.assertEqual(C.answer_type(ans), ("numeric", None, key), ans)

    def test_a_count_is_its_number(self):
        for ans, key in [("2 circles", "2"), ("1 (one tangent only)", "1"), ("2 (two tangents)", "2")]:
            self.assertEqual(C.answer_type(ans), ("numeric", None, key), ans)

    def test_a_comparison_sign(self):
        for s in "<>=":
            self.assertEqual(C.answer_type(s), ("short", None, s))

    def test_set_membership_is_the_set(self):
        t = C.answer_type("X ∈ {3, -3}")
        self.assertEqual(t[1]["marker"]["kind"], "values")
        self.assertEqual(t[2], "\\{3, -3\\}")


class StillNotMarked(unittest.TestCase):
    def test_what_stays_a_worked_example(self):
        for ans in ["76.2667°",                          # precision asked is not known
                    "34° 36' 0''",                       # degrees, minutes and seconds
                    "50/360 × 44 = 55/9 ≈ 6.11 cm",      # an approximation
                    "MB = 12 cm, NC = √105 cm",          # several values
                    "x = 45, m(arc AB) = 158°",
                    "2 cm or 14 cm. Yes, there is another answer.",
                    "1 circle (its center is the midpoint of AB and AB is its diameter)",
                    "∅ (empty set)"]:
            self.assertIsNone(C.measure_type(ans), ans)
        for ans in ["(x - 3)(x - 1) = 0", "x - 3 = 0"]:   # an equation is the marker's, never the number after "="
            self.assertIsNone(C.measure_type(ans), ans)
        for ans in ["76.2667°", "34° 36' 0''"]:
            self.assertIsNone(C.answer_type(ans), ans)

    def test_a_worked_example_is_unchanged(self):
        for ans in ["40°", "5 cm", "2 circles", ">"]:
            self.assertIsNone(C.answer_type(ans, marker_kinds=False), ans)


class Fractions(unittest.TestCase):
    def test_a_fraction_goes_to_the_marker(self):
        # grade() reads parseFloat("3/7") as 3: a numeric "3/7" marked "3" right and "3/7" wrong
        for k in ["3/7", "-2/3", "1/4"]:
            t = C.answer_type(k)
            self.assertEqual(t[0], "short", k)
            self.assertEqual(t[1]["marker"]["kind"], "expression", k)
        self.assertEqual(C.answer_type("7"), ("numeric", None, "7"))


class Parts(unittest.TestCase):
    def asks(self, ans, stem=""):
        return [(a, t[2]) for a, t in C.answer_parts(ans, stem)]

    def test_named_parts(self):
        self.assertEqual(self.asks("x = 45, m(arc AB) = 158°"),
                         [("Answer only: x = ?", "45"), ("Answer only: m(arc AB) = ?", "158")])
        self.assertEqual(self.asks("CD = AB, X = 3, EM = 6, AM = 10")[1:], [("Answer only: X = ?", "3"),
                         ("Answer only: EM = ?", "6"), ("Answer only: AM = ?", "10")])

    def test_numbered_parts(self):
        self.assertEqual(self.asks("Part 1: {(-1, 2)}. Part 2: {(1, 2)}."),
                         [("Answer only part (1).", "\\{(-1, 2)\\}"), ("Answer only part (2).", "\\{(1, 2)\\}")])

    def test_blanks_in_order(self):
        stem = "The event of having 7 is .......... and the event is called .......... and the probability = ......"
        self.assertEqual(self.asks("φ (empty set); impossible event; 0", stem),
                         [("Answer only the 2nd blank.", "impossible event"), ("Answer only the 3rd blank.", "0")])

    def test_a_domain_is_asked_now_the_marker_reads_it(self):
        # the app's marker reads "R - {-2}" in an answer from 2026-10-29 (exceptValues); compile numbers the domain
        # part apart (-pd1), so the parts asked before keep their ids
        self.assertEqual(self.asks("n(x) = 2, domain R - {-2}"), [("Answer only: n(x) = ?", "2"), ("Answer only: the domain = ?", "x != -2")])

    def test_not_split(self):
        self.assertEqual(self.asks("f(3) = 0 and g(3) = 0, so f(3) = g(3) = 0", "If f(x)=x^2-3x, g(x)=x-3 Prove that f(3)=g(3)=0"), [])
        self.assertEqual(self.asks("MA > r, MB = r, MC < r"), [])                      # relations, not values
        self.assertEqual(self.asks("(1, 1), (3, 5), (-1, -3), (4, 7)", "Tell another four solutions"), [])
        self.assertEqual(self.asks("inside; the point M (the centre)", "A is ...... circle M and represented by ......"),
                         [("Answer only the 1st blank.", "inside")])          # a 3-word phrase is not asked


if __name__ == "__main__":
    unittest.main()
