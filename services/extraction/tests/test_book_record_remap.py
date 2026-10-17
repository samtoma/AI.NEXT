"""After G1, generated content follows its source onto the approved objectives (book_record_remap.py).

No @covers marker: pipeline policy (Tamer, 2026-10-17). Found on Prep-3 Unit 1: 34 of 84 generated questions named
provisional objectives G1 had removed, and objectives are numbered by position, so a number can name another skill.
What is proved:
  - a generated question follows its parent book question to that item's objective now; its parent id becomes the id
    compile mints, its own id never changes, and its source note says it moved;
  - a misconception follows the book items S5 cites, in any form S5 writes them; a tie or no filed source is listed;
  - --dry-run writes nothing.
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

EX = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(EX))

import book_record_remap as R  # noqa: E402

RECORD = {"learning_objectives": [{"id": "t-1:objective-1"}, {"id": "t-1:objective-2"}],
          "items": [{"id": "t-1:drill-3", "type": "exercise", "lo": "t-1:objective-2", "parts": [{"label": "B"}]},
                    {"id": "t-1:rule-5", "type": "rule", "lo": "t-1:objective-1"},
                    {"id": "t-1:example-2", "type": "worked_example", "lo": "t-1:objective-1"},
                    {"id": "t-1:linking-text-1", "type": "linking_text"}]}
GEN = {"questions": [{"id": "q:t-1-5:g001", "lo_id": "lo:t-1-5", "parent_question_id": "q:t-1-5:bk-drill-3-b", "source_note": "Family x."}]}
MISC = {"misconceptions": [{"id": "mc:t-1-3:a", "lo_id": "lo:t-1-3"}, {"id": "mc:t-1-1:b", "lo_id": "lo:t-1-1"}]}
S5 = {"records": [{"entries": [{"id": "mc:t-1-3:a", "lo_id": "lo:t-1-3", "sources": [{"ref": "remark t-1:rule-5 p.8"},
                                                                                   {"ref": "expl:t-1-3:bk-example-2"}]},
                               {"id": "mc:t-1-1:b", "lo_id": "lo:t-1-1", "sources": [{"ref": "t-1:linking-text-1"}]}]}]}


class Remap(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.saved = R.HERE
        R.HERE = self.tmp
        for rel, obj in (("book-records/t/t-1.json", RECORD), ("teaching/t/generated/generated-questions.json", GEN),
                         ("teaching/t/generated/misconceptions.json", MISC), ("runs/t/misconceptions/s5-final.20261017T000000Z.json", S5)):
            p = self.tmp / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(obj))
        import ingest
        self.p = [mock.patch.object(ingest, "unit_lessons", lambda b, r, u: (["t-1"], "Unit")), mock.patch.object(ingest, "route", lambda b: {}),
                  mock.patch.object(R.book_config, "load_book", lambda b: type("B", (), {"book": "t"})())]
        for x in self.p:
            x.start()

    def tearDown(self):
        for x in self.p:
            x.stop()
        R.HERE = self.saved
        shutil.rmtree(self.tmp, ignore_errors=True)

    def gen(self):
        return json.loads((self.tmp / "teaching/t/generated/generated-questions.json").read_text())["questions"][0]

    def test_dry_run_writes_nothing(self):
        r = R.run("t", 1, True)
        self.assertEqual(len(r["questions_moved"]), 1)
        self.assertEqual(self.gen()["lo_id"], "lo:t-1-5")

    def test_questions_and_misconceptions_follow_their_sources(self):
        r = R.run("t", 1, False)
        q = self.gen()
        self.assertEqual((q["id"], q["lo_id"], q["parent_question_id"]), ("q:t-1-5:g001", "lo:t-1-2", "q:t-1-2:bk-drill-3-b"))
        self.assertIn("re-mapped after G1", q["source_note"])
        m = {x["id"]: x["lo_id"] for x in json.loads((self.tmp / "teaching/t/generated/misconceptions.json").read_text())["misconceptions"]}
        self.assertEqual(m["mc:t-1-3:a"], "lo:t-1-1")          # both its sources are filed under objective 1
        self.assertEqual(m["mc:t-1-1:b"], "lo:t-1-1")          # its only source is filed nowhere: kept, listed
        self.assertEqual([u["id"] for u in r["misconceptions_unplaced"]], ["mc:t-1-1:b"])
        self.assertEqual(R.run("t", 1, False)["questions_moved"], [])   # re-runnable


if __name__ == "__main__":
    unittest.main()
