"""Question tiers for book records: tier_questions.py (two readings), the review tool's Question tiers task
(groundtruth/review/tiers.py) and how compile_book_records.py chooses a tier. No model is called."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

EX = Path(__file__).resolve().parents[1]
for p in (EX, EX / "groundtruth", EX / "groundtruth" / "review"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

import compile_book_records as C  # noqa: E402
import tier_questions as T  # noqa: E402
import tiers as R  # noqa: E402


class RuleTest(unittest.TestCase):
    def test_the_rule_is_grade_10s_word_for_word(self):
        """Both of Grade 10's tier prompts (S3 Typing and S3 Tier check) carry exactly this rule: if either changes,
        the book-record tiers must change with it."""
        src = (EX / "runbook" / "lesson.workflow.js").read_text()
        self.assertEqual(src.count(T.RULE), 2, "the rule should appear in S3 Typing and in S3 Tier check")
        self.assertEqual(T.TIERS, ("basic", "standard", "advanced"))


def entry(ref, a, b, fp="f1"):
    st = "agreed" if a == b else "disagreed"
    return {"ref": ref, "record_id": ref.rsplit(":", 1)[0], "part": None, "type": "exercise", "page": 7, "question_fingerprint": fp,
            "readings": [{"reading": "typing", "tier": a}, {"reading": "blind", "tier": b}],
            "status": st, "tier": a if st == "agreed" else b}


class PrecedenceTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        (root / "teaching" / "bk" / "tiers").mkdir(parents=True)
        (root / "reviews" / "bk").mkdir(parents=True)
        (root / "teaching" / "bk" / "tiers" / "l1.json").write_text(json.dumps({"lesson": "l1", "source": "x.json", "rule": T.RULE, "tiers": [
            entry("l1:a", "basic", "basic"),            # agreed
            entry("l1:b", "standard", "basic"),         # disagreed, undecided: the blind reading
            entry("l1:c", "standard", "advanced"),      # disagreed, decided
            entry("l1:d", "basic", "standard", "new"),  # decided on an older wording: back to the blind reading
        ]}))
        (root / "reviews" / "bk" / "question-tiers.json").write_text(json.dumps({"decisions": [
            {"ref": "l1:c", "tier": "standard", "by": "TD", "at": "2026-10-16", "fingerprint": "f1"},
            {"ref": "l1:d", "tier": "advanced", "by": "TD", "at": "2026-10-16", "fingerprint": "old"},
        ]}))
        self._here, C.HERE = C.HERE, root
        self._ext, R.EXTRACTION, R.TEACHING, R.REVIEWS = R.EXTRACTION, root, root / "teaching", root / "reviews"

    def tearDown(self):
        C.HERE = self._here
        R.EXTRACTION, R.TEACHING, R.REVIEWS = self._ext, self._ext / "teaching", self._ext / "reviews"
        self._tmp.cleanup()

    def test_a_person_then_both_readings_then_the_blind_reading(self):
        got = C.question_tiers("bk", "l1")
        self.assertEqual(got["l1:a"], ("basic", "both readings"))
        self.assertEqual(got["l1:b"][0], "basic", "Grade 10: the check (the blind reading) wins until a person decides")
        self.assertEqual(got["l1:c"], ("standard", "chosen by TD"))
        self.assertEqual(got["l1:d"][0], "standard", "a decision on an older wording does not count")

    def test_the_review_task_lists_what_needs_a_person(self):
        states = {r["ref"]: r["state"] for r in R.summary("bk")}
        self.assertEqual(states, {"l1:a": "agreed", "l1:b": "open", "l1:c": "decided", "l1:d": "changed"})

    def test_a_decision_needs_a_known_tier_and_initials(self):
        with self.assertRaises(ValueError):
            R.decide({"book": "bk", "ref": "l1:b", "tier": "hard", "by": "TD"})
        with self.assertRaises(ValueError):
            R.decide({"book": "bk", "ref": "l1:b", "tier": "basic", "by": " "})
        out = R.decide({"book": "bk", "ref": "l1:b", "tier": "standard", "by": "TD"})
        self.assertEqual(out["fingerprint"], "f1")
        self.assertEqual(C.question_tiers("bk", "l1")["l1:b"], ("standard", "chosen by TD"))


if __name__ == "__main__":
    unittest.main()
