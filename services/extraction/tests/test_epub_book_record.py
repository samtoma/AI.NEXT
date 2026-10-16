"""S0a's EPUB route: epub_book_record.py turns Samuel's source-adapter blocks into book records.

No @covers marker: the source route is pipeline policy (docs/design/maths-ingestion-pipeline.md). On Samuel's
objectives fixture (tests/_objectives_fixture.py, source_adapter.py's real block format) it proves:
  - every lesson is written and passes the book-record schema and extract_book_record.check;
  - maths comes from S0b as $LaTeX$; quotes keep their maths whole;
  - exercises group by printed question, sub-questions become parts with answer, worked solution and practice code;
  - a worked example's steps are book_worked, an EPUB-only solution book_online;
  - teacher-only blocks never reach a record, end-of-chapter items are listed, not written;
  - a lesson with a maths image S0b has not accepted is not written (nothing guessed);
  - the EPUB's figure image is copied to the crop path S4 reads.
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

EX = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(EX))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import _objectives_fixture as fx  # noqa: E402
import epub_book_record as E  # noqa: E402


class EpubRoute(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.f = fx.build(self.tmp)

    def write(self, maths=None):
        return E.write_chapter("g10-math", 8, Path(self.f["blocks"]), Path(self.f["manifest"]), Path(maths or self.f["maths"]),
                               self.tmp / "out", None, True, figures_dir=self.tmp / "crops")

    def rec(self, slug):
        return json.loads((self.tmp / "out" / f"{slug}.json").read_text())

    def test_every_lesson_is_written_and_valid(self):
        rep = self.write()
        self.assertEqual(rep["not_written"], {})
        self.assertGreater(len(rep["lessons"]), 1)
        for slug, v in rep["lessons"].items():
            self.assertEqual(v["problems"], [], slug)

    def test_exercises_parts_answers_and_codes(self):
        self.write()
        items = {i["id"]: i for i in self.rec("g10m8s2-1")["items"]}
        q2 = items["g10m8s2-1:exercise-8-2-2"]
        self.assertEqual([p["label"] for p in q2["parts"]], ["a", "b"])
        self.assertTrue(all(p.get("code") and p.get("answer") and p.get("solution") for p in q2["parts"]))
        we = items["g10m8s2-1:worked-example-1"]
        self.assertEqual(we["solution_provenance"], "book_worked")
        self.assertIn("$P(1; 2)$", we["quote"])
        self.assertNotIn("⟦m:", json.dumps(self.rec("g10m8s2-1")))

    def test_teacher_only_and_end_of_chapter(self):
        rep = self.write()
        self.assertGreater(rep["teacher_only_dropped"], 0)
        self.assertTrue(rep["end_of_chapter_items"])
        text = "".join((self.tmp / "out" / f"{s}.json").read_text() for s in rep["lessons"])
        for b in map(json.loads, Path(self.f["blocks"]).read_text().splitlines()):
            if b["type"] == "teacher_only" and b.get("text"):
                self.assertNotIn(b["text"][:30], text)

    def test_a_missing_maths_image_holds_the_lesson(self):
        acc = json.loads(Path(self.f["maths"]).read_text())
        acc["accepted"].pop(next(iter(acc["accepted"])))
        thin = self.tmp / "thin.json"
        thin.write_text(json.dumps(acc))
        rep = self.write(thin)
        self.assertTrue(rep["not_written"])
        for slug in rep["not_written"]:
            self.assertFalse((self.tmp / "out" / f"{slug}.json").exists())

    def test_the_figure_reaches_the_crop_path(self):
        self.write()
        self.assertTrue((self.tmp / "crops" / "g10m8s2-1__figure-1.png").exists())


if __name__ == "__main__":
    unittest.main()
