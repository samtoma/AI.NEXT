"""An explanation or a drawing is agreed on its gradable answer (Tamer, 2026-10-29; answer_gen COMPARE_VERSION v3).

    uv run --with pytest python -m pytest -q tests/test_answer_gradable_agreement.py

"Which of the following figures is cyclic? Explain your answer. Figure 1": both readings said "Yes, …", yet the answer
waited for a person, because an explanation was never compared. Now the part the app marks is compared, as a value's
answer always was; the explanation itself stays unchecked. No model is called.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import answer_gen as A  # noqa: E402


def author(answer, text, stem="", kind="explanation"):
    return {"ref": "x:1", "kind": kind, "answer": answer, "solution": ["a step"], "question": {"text": text, "stem": stem}}


class Agreed(unittest.TestCase):
    def test_a_yes_both_readings_give(self):
        a = author("Yes, Figure 1 is cyclic because ∠DAC = ∠DBC = 50°.",
                   "Which of the following figures is a cyclic quadrilateral? Explain your answer.", "Figure 1")
        r = A.check(a, {"answer": "Yes, Figure 1 is cyclic. The diagonals are perpendicular …", "kind": "explanation"})
        self.assertEqual(r["status"], "agreed")
        self.assertIn("explanation is not checked", r["checks"]["agreed_on"])

    def test_an_if_clause_before_the_question(self):
        a = author("No, they only share the ratio 3:5.", "If $\\frac{a}{b}=\\frac{3}{5}$, is $a=3$, $b=5$?")
        self.assertEqual(A.check(a, {"answer": "No, not necessarily."})["status"], "agreed")


class StillAPerson(unittest.TestCase):
    def test_the_readings_differ(self):
        a = author("Yes, it changes.", "Is the ratio changed if you add a number to each term?")
        self.assertEqual(A.check(a, {"answer": "No, in general the ratio changes."})["status"], "needs_person")

    def test_the_question_also_asks_something_else(self):
        a = author("No, it has a hole at x = 4.", "Is this an identity for all real x? Explain why or why not. "
                   "What specific feature of the graph is hidden at $x=4$?")
        self.assertEqual(A.check(a, {"answer": "No. The two sides are equal only for x ≠ 4."})["status"], "needs_person")

    def test_nothing_to_mark(self):
        a = author("Both sides equal m + 1.", "If a/b = c/d prove that (a+b)/b = (c+d)/d")
        self.assertEqual(A.check(a, {"answer": "Both sides equal m + 1."})["status"], "needs_person")

    def test_a_drawing(self):
        a = author("Plot the points and join them.", "Represent the relation graphically.", kind="drawing")
        self.assertEqual(A.check(a, {"answer": "Plot (1, 15), (2, 30)."})["status"], "needs_person")


if __name__ == "__main__":
    unittest.main()
