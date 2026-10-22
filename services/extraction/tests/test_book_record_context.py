"""The book's context per objective (book_record_context.py, S1C): the instructions dropped without a model, two readings
compared, a doubtful passage held, and a person's decision winning only while the passage is what they decided on.

    uv run --with pytest python -m pytest -q tests/test_book_record_context.py
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import book_record_context as C  # noqa: E402

OBJS = [{"n": 1, "label": "Geometric sequences", "description": "…"}, {"n": 2, "label": "General term", "description": "…"}]


def passage(key: str, status: str, kind: str | None, objective: int | None) -> dict:
    p = {"key": key, "page": 57, "text": f"text of {key}"}
    return {**p, "status": status, "kind": kind, "objective": objective, "fingerprint": C.fingerprint(p, OBJS)}


class Instructions(unittest.TestCase):
    def test_the_books_instructions_and_margin_notes_never_reach_a_model(self):
        for t in ("Solve the following problems.", "Work with a partner: Collaborate with your group to solve the try section",
                  "Side note: Substitute $c=-2$ into the relation, then simplify both sides.", "Margin note: Transform it.",
                  "Point! Steps to find the general term from a recurrence relation", "Too short to open anything"):
            self.assertTrue(C.is_instruction(t), t)
        self.assertFalse(C.is_instruction("A single E. coli bacterium enters a bloodstream and doubles every 20 minutes."))


class Readings(unittest.TestCase):
    def test_an_answer_outside_the_lists_is_no_answer_and_none_has_no_objective(self):
        ps, qs = C.reading({"passages": [
            {"key": "a", "kind": "real_life", "objective": 1, "why": ""},
            {"key": "b", "kind": "story", "objective": 1, "why": ""},          # not a kind
            {"key": "c", "kind": "real_life", "objective": 7, "why": ""},      # not an objective of the lesson
            {"key": "d", "kind": "none", "objective": 2, "why": ""}], "real_life_questions": ["x"]}, {0, 1, 2})
        self.assertEqual(set(ps), {"a", "d"})
        self.assertEqual(ps["d"]["objective"], 0)
        self.assertEqual(qs, {"x"})
        self.assertEqual(C.reading(None, {0, 1}), ({}, set()))


class Resolved(unittest.TestCase):
    def resolve(self, passages: list[dict], decisions: list[dict]) -> list[dict]:
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "context-review.json"
            f.write_text(json.dumps({"decisions": decisions}))
            with mock.patch.object(C, "review_path", return_value=f):
                return C.resolved("book", {"passages": passages})

    def test_agreements_are_used_and_a_held_passage_never_is(self):
        out = self.resolve([passage("used", "agreed", "real_life", 0), passage("held", "held", None, None),
                            passage("plain", "agreed", "none", 0), passage("instr", "instruction", "none", 0)], [])
        self.assertEqual([(p["key"], p["kind"], p["objective"]) for p in out], [("used", "real_life", 0)])

    def test_a_persons_decision_wins_while_the_passage_is_what_they_decided_on(self):
        held, used = passage("held", "held", None, None), passage("used", "agreed", "real_life", 0)
        out = self.resolve([held, used], [
            {"ref": "held", "decision": "keep", "kind": "concept_intro", "objective": 2, "by": "TD", "fingerprint": held["fingerprint"]},
            {"ref": "used", "decision": "drop", "by": "TD", "fingerprint": used["fingerprint"]}])
        self.assertEqual([(p["key"], p["kind"], p["objective"], p["by"]) for p in out], [("held", "concept_intro", 2, "TD (review tool)")])
        # decided on another wording: the readings decide again (and the held one stays out)
        stale = self.resolve([held, used], [{"ref": "held", "decision": "keep", "kind": "real_life", "objective": 1, "by": "TD",
                                             "fingerprint": "something-else"}])
        self.assertEqual([p["key"] for p in stale], ["used"])


if __name__ == "__main__":
    unittest.main()
