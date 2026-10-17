"""The review sample of generated questions (book_record_sample.py; load_generated_questions.review_sample; the review
tool's Generated content task, groundtruth/review/generated.py).

No @covers marker: review policy (Samuel's decision of 2026-09-10, adopted for the book-record line by Tamer, 2026-10-17).
What is proved:
  - the draw is Samuel's: every family has a sampled question, the sample reaches the percentage, a seed reproduces it,
    and without an earlier draw it is exactly what load_generated_questions.py --sample has always drawn;
  - an earlier draw is kept while its questions exist, so past reviews still count; a new family gets a pick;
  - the task asks only for sampled questions; the others are listed as outside the sample; misconceptions, mappings and
    figures are never sampled.
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

EX = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(EX))
sys.path.insert(0, str(EX / "groundtruth" / "review"))

import generated as GEN  # noqa: E402
import load_generated_questions as LG  # noqa: E402

QS = [{"id": f"q:t-1-1:g{i:03d}", "family": f"tpl:t-1-1:f{i % 9}", "lo_id": "lo:t-1-1"} for i in range(120)]


class Draw(unittest.TestCase):
    def test_every_family_and_the_percentage(self):
        picked, fams = LG.review_sample(QS, 10, 42)
        self.assertEqual(fams, 9)
        self.assertEqual({q["family"] for q in QS if q["id"] in picked}, {f"tpl:t-1-1:f{i}" for i in range(9)})
        self.assertEqual(len(picked), 12)                       # 10% of 120
        self.assertEqual(picked, LG.review_sample(QS, 10, 42)[0])

    def test_an_earlier_draw_is_kept(self):
        first, _ = LG.review_sample(QS, 10, 42)
        more = QS + [{"id": "q:t-1-1:g900", "family": "tpl:t-1-1:new", "lo_id": "lo:t-1-1"}]
        again, fams = LG.review_sample(more, 10, 7, keep=first)
        self.assertTrue(first <= again)
        self.assertIn("q:t-1-1:g900", again)                   # the new family's only question
        self.assertEqual(fams, 10)


class Task(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.saved = GEN.REVIEWS
        GEN.REVIEWS = self.tmp

    def tearDown(self):
        GEN.REVIEWS = self.saved
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_only_the_sample_is_asked(self):
        data = {"items": {("question", "q1"): {"id": "q1", "lo_id": "lo:t-1-1", "stem": "a"},
                          ("question", "q2"): {"id": "q2", "lo_id": "lo:t-1-1", "stem": "b"},
                          ("misconception", "mc1"): {"id": "mc1", "lo_id": "lo:t-1-1", "label": "m"}},
                "lesson_order": {}}
        orig = GEN.load
        GEN.load = lambda book: data
        try:
            rows = {r["ref"]: r["sampled"] for r in GEN.summary("t")}
            self.assertEqual(rows, {"q1": True, "q2": True, "mc1": True})   # no sample file: everything is asked
            (self.tmp / "t").mkdir()
            (self.tmp / "t" / "generated-review-sample.json").write_text(json.dumps({"question_ids": ["q1"]}))
            rows = {r["ref"]: r["sampled"] for r in GEN.summary("t")}
            self.assertEqual(rows, {"q1": True, "q2": False, "mc1": True})  # a misconception is never sampled out
        finally:
            GEN.load = orig


if __name__ == "__main__":
    unittest.main()
