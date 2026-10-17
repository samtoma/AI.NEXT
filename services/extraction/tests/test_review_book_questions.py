"""The review tool's Book questions (G2) task (groundtruth/review/book_questions.py) and compile applying its decisions
(compile_book_records.apply_g2).

No @covers marker: G2 is pipeline policy (Samuel's gate; Tamer, 2026-10-17: a human path for held book questions).
What is proved:
  - only book questions held on their ANSWER are listed (answer mismatch, unverified, unanswerable), with their state;
  - a fix needs the key and a reason; a decision is fingerprinted on the question as held;
  - compile: release and fix put the question live, stamped as that person's review; a fixed key goes through the app's
    marker check; exclude leaves it out; hold keeps it held and no recommendation releases it; a decision on a question
    that changed since is not applied; the person wins over the recommender.
"""
from __future__ import annotations

import copy
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

EX = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(EX))
sys.path.insert(0, str(EX / "groundtruth" / "review"))

import book_questions as BQ  # noqa: E402
import compile_book_records as C  # noqa: E402

NOTE = "The book's own exercise ({}, printed p.7); answer printed in the book. Compiled from the book record (compile_book_records.py)."
QS = [{"id": f"q:t-1-1:bk-exercise-{n}", "lo": "lo:t-1-1", "tier": "basic", "type": "numeric", "stem": f"Find ${n} + 3$.",
       "answer": str(n + 4), "solution": [f"${n} + 3$"], "source_page": 7, "hold_reason": "answer_mismatch",
       "source_note": NOTE.format(f"t-1:exercise-{n}")} for n in (1, 2, 3, 4)]
QS.append({"id": "q:t-1-1:bk-exercise-9", "lo": "lo:t-1-1", "type": "numeric", "stem": "x", "answer": "1", "hold_reason": "katex_error",
           "source_note": NOTE.format("t-1:exercise-9")})


class BookQuestions(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.saved = (BQ.EXTRACTION, BQ.COMPILED, BQ.REVIEWS, C.HERE)
        BQ.EXTRACTION = C.HERE = self.tmp
        BQ.COMPILED, BQ.REVIEWS = self.tmp / "compiled", self.tmp / "reviews"
        (self.tmp / "compiled" / "t").mkdir(parents=True)
        (self.tmp / "compiled" / "t" / "unit1.json").write_text(json.dumps({"nodes": [], "questions": QS}))

    def tearDown(self):
        BQ.EXTRACTION, BQ.COMPILED, BQ.REVIEWS, C.HERE = self.saved
        shutil.rmtree(self.tmp, ignore_errors=True)

    def decide(self, n, choice, **kw):
        return BQ.decide({"book": "t", "question": f"q:t-1-1:bk-exercise-{n}", "choice": choice, "by": "TD", **kw})

    def test_listing_and_decisions(self):
        self.assertEqual(BQ.books(), ["t"])
        rows = BQ.summary("t")
        self.assertEqual([r["question"][-1] for r in rows], ["1", "2", "3", "4"])          # not the KaTeX hold
        with self.assertRaises(ValueError):
            self.decide(2, "fix", key="5")                                                 # a fix needs a reason
        self.decide(1, "release")
        self.decide(2, "fix", key="5", note="the book adds 4 instead of 3")
        self.decide(3, "exclude", note="ambiguous wording")
        self.decide(4, "hold")
        self.assertEqual({r["question"][-1]: r["state"] for r in BQ.summary("t")}, {"1": "release", "2": "fix", "3": "exclude", "4": "hold"})

    def test_compile_applies_people_first(self):
        self.test_listing_and_decisions()
        qs = {"t-1": copy.deepcopy(QS[:4])}
        qs["t-1"][0]["stem"] = "Find $1 + 3$, again."                   # changed since it was decided: not applied
        report = {"g2": [], "held": [{"question": q["id"]} for q in QS], "skipped": []}
        rec = {"items": {"t-1:Ex1-1:4": {"verdict": "accept"}}, "questions": {"t-1:Ex1-1:4": {"question": QS[3]["id"], "facts": {
               "stem": QS[3]["stem"], "answer": QS[3]["answer"], "hold_reason": "answer_mismatch"}, "book_ref": "t-1:exercise-4"}}}
        (self.tmp / "teaching" / "t" / "g2").mkdir(parents=True)
        (self.tmp / "teaching" / "t" / "g2" / "unit01.json").write_text(json.dumps(rec))  # the recommender says accept #4
        with mock.patch.object(C, "marker_check", lambda qs: {}):
            C.apply_g2("t", qs, report)
        by = {q["id"][-1]: q for q in qs["t-1"]}
        self.assertEqual(by["1"]["hold_reason"], "answer_mismatch")
        self.assertEqual((by["2"]["answer"], by["2"].get("hold_reason"), by["2"]["verified"]), ("5", None, True))
        self.assertEqual(by["2"]["_decision"]["by"], "TD")
        self.assertEqual(by["2"]["_stamp_what"], "book question at G2")
        self.assertNotIn("3", by)                                        # left out
        self.assertEqual(by["4"]["hold_reason"], "answer_mismatch")      # the person's hold wins over the recommender's accept
        self.assertIn("left out at G2 by TD", report["skipped"][0]["why"])

    def test_a_fixed_key_the_marker_refuses_stays_held(self):
        self.decide(2, "fix", key="5", note="x")
        qs = {"t-1": copy.deepcopy(QS[1:2])}
        report = {"g2": [], "held": [], "skipped": []}
        with mock.patch.object(C, "marker_check", lambda qs: {qs[0]["id"]: "cannot read"}):
            C.apply_g2("t", qs, report)
        self.assertEqual(qs["t-1"][0]["hold_reason"], "unanswerable")
        self.assertFalse(report["g2"][0]["applied"])


if __name__ == "__main__":
    unittest.main()
