"""Families held or rejected for no fault of their maths (Tamer, 2026-10-29: "the held families").

    uv run --with pytest python -m pytest -q tests/test_held_families.py

Prep 3 held or rejected 17 families on thin objectives. In each case the maths was sound; the causes were these:
- a format slip that Samuel's fan-out normalises, but the book-record S6 path never ran the normaliser;
- a worked-example parent that compile has since made a question;
- a blind solver call that never returned, read as a wrong answer.
No model is called.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import book_record_generation as BRG  # noqa: E402
import generate_questions as GQ  # noqa: E402
from families import normalise as N  # noqa: E402


class Normalise(unittest.TestCase):
    def test_an_mcq_answer_that_repeats_choices_correct_is_dropped(self):
        raw = {"answer_type": "mcq", "answer": "Class {=w}", "choices": {"correct": "Class {=w}", "distractors": []}, "stem": "Which class {=w}?"}
        out, done = N.normalise(raw)
        self.assertNotIn("answer", out)
        self.assertTrue(any(d.startswith("drop-redundant-answer") for d in done))

    def test_an_mcq_answer_that_differs_is_the_authors_and_left(self):
        raw = {"answer_type": "mcq", "answer": "Class A", "choices": {"correct": "Class {=w}", "distractors": []}, "stem": "Which class {=w}?"}
        out, _ = N.normalise(raw)
        self.assertEqual(out["answer"], "Class A")


class Repoint(unittest.TestCase):
    def test_a_worked_example_that_became_a_question_is_the_parent_now(self):
        with tempfile.TemporaryDirectory() as t:
            f = Path(t) / "pp3u9-1-2--axis-length.json"
            f.write_text(json.dumps({"parent_question_id": "expl:pp3u9-1-2:bk-think-1", "parent_kind": "teaching", "notes": "n"}))
            g = Path(t) / "pp3u9-1-2--other.json"   # its worked example is still one: left
            g.write_text(json.dumps({"parent_question_id": "expl:pp3u9-1-2:bk-example-1", "parent_kind": "teaching"}))
            parents = ({"q:pp3u9-1-2:bk-think-1"}, {"expl:pp3u9-1-2:bk-example-1"})
            with mock.patch.object(GQ, "book_parents", return_value=parents), mock.patch.object(BRG.book_config, "load_book"):
                done = BRG.repoint_parents(Path(t), [f, g])
            self.assertEqual(done, [f.name])
            spec = json.loads(f.read_text())
            self.assertEqual((spec["parent_question_id"], spec["parent_kind"]), ("q:pp3u9-1-2:bk-think-1", "question"))
            self.assertIn("PIPELINE NORMALISATION", spec["notes"])
            self.assertEqual(json.loads(g.read_text())["parent_kind"], "teaching")


class Grades(unittest.TestCase):
    def setUp(self):
        self.spec = SimpleNamespace(id="tpl:x:fam", sha="s1")
        self.qs = [{"id": f"q:x:g00{i}", "stem": f"stem {i}", "question_type": "numeric", "correct_answer": "5",
                    "family_spec_sha": "s1"} for i in range(1, 4)]
        self.judge = {k: True for k in ("distractors_ok", "key_form_ok", "context_ok", "solution_ok")}

    def run_grades(self, *runs):
        with tempfile.TemporaryDirectory() as t:
            files = []
            for k, answers in enumerate(runs):
                p = Path(t) / f"g{k}.json"
                p.write_text(json.dumps({"results": [{"family_id": "tpl:x:fam", "spec_sha": "s1", "judge": self.judge, "answers": [
                    {"instance_id": q["id"], "stem_sha": GQ._stem_sha(q["stem"]), **a} for q, a in zip(self.qs, answers)]}]}))
                files.append(p)
            return GQ.apply_grades([self.spec], self.qs, files)

    def test_a_call_that_never_returned_is_no_verdict(self):
        failed = [{"answer": {}, "working": "NO ANSWER"}] * 3
        good = [{"answer": {"value": "5"}, "working": "w"}] * 3
        accepted, rejected = self.run_grades(failed, good)
        self.assertIn("tpl:x:fam", accepted)
        self.assertEqual(accepted["tpl:x:fam"]["graded_instances"], 3)

    def test_still_fails_closed_with_nothing_graded(self):
        _, rejected = self.run_grades([{"answer": {}, "working": "NO ANSWER"}] * 3)
        self.assertEqual(rejected["tpl:x:fam"], ["only 0 instance(s) graded, 3 required"])

    def test_a_wrong_answer_still_rejects(self):
        _, rejected = self.run_grades([{"answer": {"value": "4"}, "working": "w"}] + [{"answer": {"value": "5"}, "working": "w"}] * 2)
        self.assertIn("tpl:x:fam", rejected)


if __name__ == "__main__":
    unittest.main()
