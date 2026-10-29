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


if __name__ == "__main__":
    unittest.main()
