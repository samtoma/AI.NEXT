"""variant_engine.assert_variable reads both shapes of `choices` (schemas.Question).

A typed maths answer carries `choices: {"marker": AnswerSpec}` (FR-4320,
contracts/answer-marker.md); multiple choice carries a list of options. The sacred-
content guard must scan every surface of either, and must not crash on the marker
shape — it runs FIRST, before anything could vary a question (ADR-0006).

    uv run --with pytest python -m pytest -q tests/test_variant_engine.py
"""

from __future__ import annotations

import unittest

import _scratchdb  # noqa: F401
import variant_engine as V
from schemas import MarkerChoices, Question

BASE = {"lo": "lo:g10m1s7-2-1", "tier": "standard", "solution": ["…"], "source_page": 25, "source_note": "book"}


class BothShapes(unittest.TestCase):
    def test_a_typed_answer_parent_is_scanned_and_its_key_is_a_surface(self):
        q = Question.model_validate(dict(BASE, id="q:g10m1s7-2-1:ex1-8-1a", type="short",
                                         stem="Factorise $x^2 + 5x + 6$.", answer="(x + 2)(x + 3)",
                                         choices={"marker": {"kind": "expression", "key": "(x + 2)(x + 3)",
                                                             "form": "factorised", "variables": ["x"]}}))
        self.assertIsInstance(q.choices, MarkerChoices)
        self.assertIn("(x + 2)(x + 3)", V._question_text(q))
        V.assert_variable(q)  # maths: no sacred class, no passage — it passes, and does not crash

    def test_multiple_choice_options_are_still_scanned(self):
        q = Question.model_validate(dict(BASE, id="q:g10m1s7-2-1:ex1-8-1b", type="mcq", stem="Pick one.",
                                         answer="A", choices=[{"key": "A", "text": "alpha"},
                                                              {"key": "B", "text": "beta"},
                                                              {"key": "C", "text": "gamma"}]))
        text = V._question_text(q)
        for t in ("alpha", "beta", "gamma"):
            self.assertIn(t, text)
        V.assert_variable(q)


if __name__ == "__main__":
    unittest.main()
