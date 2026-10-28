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


class Accept(unittest.TestCase):
    def accept(self, A: dict, B: dict) -> dict:
        view = {"slug": "l-1", "title": "L", "objectives": [{"n": 1, "id": "l-1:objective-1", "label": "a", "description": ""},
                                                            {"n": 2, "id": "l-1:objective-2", "label": "b", "description": ""}],
                "passages": [{"key": "p", "page": 1, "text": "a story"}], "dropped": [], "questions": []}
        run = {"stage": "context", "lessons": [{"slug": "l-1", "A": {"passages": [A], "real_life_questions": []},
                                                "B": {"passages": [B], "real_life_questions": []}}]}
        with tempfile.TemporaryDirectory() as d:
            f, out = Path(d) / "run.json", Path(d) / "ch01.json"
            f.write_text(json.dumps(run))
            with mock.patch.object(C, "unit_slugs", return_value=["l-1"]), mock.patch.object(C, "lesson_view", return_value=view), \
                    mock.patch.object(C, "out_path", return_value=out):
                C.accept("book", 1, f)
            return json.loads(out.read_text())["lessons"][0]["passages"][0]

    def test_only_the_place_disputed_between_the_lesson_and_an_objective_goes_to_the_whole_lesson(self):
        e = self.accept({"key": "p", "kind": "real_life", "objective": 0, "why": ""}, {"key": "p", "kind": "real_life", "objective": 2, "why": ""})
        self.assertEqual((e["status"], e["kind"], e["objective"]), ("agreed", "real_life", 0))
        self.assertIn("placed", e)

    def test_two_objectives_or_two_kinds_stay_held(self):
        e = self.accept({"key": "p", "kind": "real_life", "objective": 1, "why": ""}, {"key": "p", "kind": "real_life", "objective": 2, "why": ""})
        self.assertEqual(e["status"], "held")
        e = self.accept({"key": "p", "kind": "real_life", "objective": 0, "why": ""}, {"key": "p", "kind": "concept_intro", "objective": 0, "why": ""})
        self.assertEqual(e["status"], "held")


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
        # a closing reflection is used like the other kinds (it closes its objective in the lesson)
        refl = passage("refl", "agreed", "closing_reflection", 1)
        self.assertEqual([p["kind"] for p in self.resolve([refl], [])], ["closing_reflection"])
        # decided on another wording: the readings decide again (and the held one stays out)
        stale = self.resolve([held, used], [{"ref": "held", "decision": "keep", "kind": "real_life", "objective": 1, "by": "TD",
                                             "fingerprint": "something-else"}])
        self.assertEqual([p["key"] for p in stale], ["used"])


if __name__ == "__main__":
    unittest.main()


class Generated(unittest.TestCase):
    """S1G: a written example is used only when the blind checker confirms it; a doubted one is held, never shown."""

    def test_only_a_confirmed_example_is_used_and_it_is_marked_generated(self):
        lesson = {"slug": "l-1", "title": "L", "objectives": [{"n": 1, "id": "l-1:objective-1", "label": "a", "description": ""},
                                                              {"n": 2, "id": "l-1:objective-2", "label": "b", "description": ""},
                                                              {"n": 3, "id": "l-1:objective-3", "label": "c", "description": ""},
                                                              {"n": 4, "id": "l-1:objective-4", "label": "d", "description": ""}],
                  "passages": [passage("story", "agreed", "real_life", 0)]}
        run = {"stage": "context-gen", "lessons": [{"slug": "l-1",
               "written": [{"objective": 2, "decision": "generate", "text": "Suppose a tank loses 3 litres a day.", "why": "w"},
                           {"objective": 3, "decision": "generate", "text": "Suppose a phone plan doubles.", "why": "w"},
                           {"objective": 4, "decision": "generate", "text": "Choose a (filling, size) sandwich.", "why": "w"},
                           {"objective": 1, "decision": "generate", "text": "not a gap: the lesson's story opens objective 1", "why": "w"}],
               "checked": [{"objective": 2, "verdict": "confirmed", "why": "right"},
                           {"objective": 3, "verdict": "rejected", "why": "the numbers are off"},
                           # v2: a verdict that contradicts its own check is not a confirmation
                           {"objective": 4, "verdict": "confirmed", "shows_the_point": False,
                            "why": "a small cheese sandwich is the same sandwich either way"}]}]}
        with tempfile.TemporaryDirectory() as d:
            ctx = Path(d) / "context"
            ctx.mkdir()
            (ctx / "ch01.json").write_text(json.dumps({"lessons": [lesson]}))
            (Path(d) / "run.json").write_text(json.dumps(run))
            with mock.patch.object(C, "HERE", Path(d)), mock.patch.object(C, "out_path", return_value=ctx / "ch01.json"), \
                    mock.patch.object(C, "gen_out_path", return_value=ctx / "generated-ch01.json"), \
                    mock.patch.object(C, "review_path", return_value=Path(d) / "none.json"):
                (Path(d) / "teaching" / "book").mkdir(parents=True)
                (Path(d) / "teaching" / "book" / "context").symlink_to(ctx, target_is_directory=True)
                rep = C.gen_accept("book", 1, Path(d) / "run.json")
                gen = C.generated_passages("book", "l-1")
        self.assertEqual((rep["generated"], rep["held"]), (1, 2))
        self.assertEqual({(g["objective"], g["status"]) for g in gen}, {(2, "agreed"), (None, "held")})
        self.assertTrue(all(g["generated"] and g["page"] is None for g in gen))

    def test_the_writer_and_checker_both_test_the_objectives_point_in_the_world(self):
        # S1G is run by ingest.py for every new book, from this one workflow file: the rule lives in its prompts
        wf = (Path(C.__file__).parent / "runbook" / "context-gen.workflow.js").read_text()
        self.assertIn("TRUE IN THE WORLD", wf)
        self.assertIn("5. shows_the_point", wf)
        self.assertIn('"shows_the_point": {"type": "boolean"}', wf)

