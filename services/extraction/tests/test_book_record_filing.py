"""After G1, statements, tables and figures are filed under the approved objectives (book_record_filing.py,
runbook/filing.workflow.js, and the review tool's Objectives task, kind Filing).

No @covers marker: filing is pipeline policy (Tamer, 2026-10-17, "Sam's way"). Canned agent answers through
tests/workflow_stub.mjs; no model is called. What is proved:
  - only items with no objective that can take one are read (not headings, key terms, linking text, printed objectives);
  - the two readings are blind and B reads in reverse order;
  - an agreement is written into the record, "none" leaves the item unfiled, a disagreement waits for a person;
  - a person's choice in the review tool is written by apply, only while the lesson's objectives are what was read.
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
sys.path.insert(0, str(EX / "groundtruth" / "review"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import _objectives_fixture as fx  # noqa: E402
import book_record_filing as F  # noqa: E402
import objectives as O  # noqa: E402

RECORD = {"lesson": {"slug": "t-1", "title": "Pairs"}, "history": [],
          "learning_objectives": [{"id": "t-1:objective-1", "label": "Equal pairs", "description": "Solve (a, b) = (c, d).", "order_in_parent": 1},
                                  {"id": "t-1:objective-2", "label": "Products", "description": "Find X × Y.", "order_in_parent": 2}],
          "items": [{"id": "t-1:heading-1", "type": "heading", "text": "Pairs", "source_page": 7},
                    {"id": "t-1:exercise-1", "type": "exercise", "lo": "t-1:objective-1", "text": "Find a if (a, 1) = (2, 1)", "source_page": 7},
                    {"id": "t-1:rule-1", "type": "rule", "claim": "(a, b) = (c, d) means a = c and b = d", "source_page": 7},
                    {"id": "t-1:definition-1", "type": "definition", "claim": "X × Y is the set of all pairs", "source_page": 8},
                    {"id": "t-1:figure-1", "type": "figure", "caption": "A cartesian diagram of X × Y", "source_page": 8},
                    {"id": "t-1:prior-knowledge-1", "type": "prior_knowledge", "text": "You know sets", "source_page": 7}]}


class Filing(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.saved = (F.HERE, O.EXTRACTION, O.TEACHING, O.REVIEWS)
        F.HERE = O.EXTRACTION = self.tmp
        O.TEACHING, O.REVIEWS = self.tmp / "teaching", self.tmp / "reviews"
        (self.tmp / "book-records" / "t").mkdir(parents=True)
        (self.tmp / "book-records" / "t" / "t-1.json").write_text(json.dumps(RECORD))
        self.p = [mock.patch.object(F, "unit_slugs", lambda b, u: ["t-1"]), mock.patch("extract_book_record.check", lambda rec: []),
                  mock.patch.object(F.book_config, "load_book", lambda b: type("B", (), {"title": "T"})())]
        for x in self.p:
            x.start()

    def tearDown(self):
        for x in self.p:
            x.stop()
        F.HERE, O.EXTRACTION, O.TEACHING, O.REVIEWS = self.saved
        shutil.rmtree(self.tmp, ignore_errors=True)

    def record(self):
        return json.loads((self.tmp / "book-records" / "t" / "t-1.json").read_text())

    def test_two_readings_then_a_person(self):
        args = F.build_args("t", 1, "sonnet")
        keys = [i["key"] for i in args["lessons"][0]["items"]]
        self.assertEqual(keys, ["t-1:rule-1", "t-1:definition-1", "t-1:figure-1", "t-1:prior-knowledge-1"])
        a = {"filing": [{"key": "t-1:rule-1", "objective": 1, "why": "x"}, {"key": "t-1:definition-1", "objective": 2, "why": "x"},
                        {"key": "t-1:figure-1", "objective": 2, "why": "x"}, {"key": "t-1:prior-knowledge-1", "objective": 0, "why": "x"}]}
        b = {"filing": [{"key": "t-1:rule-1", "objective": 1, "why": "y"}, {"key": "t-1:definition-1", "objective": 2, "why": "y"},
                        {"key": "t-1:figure-1", "objective": 1, "why": "y"}, {"key": "t-1:prior-knowledge-1", "objective": 0, "why": "y"}]}
        rep = fx.run_workflow(EX / "runbook" / "filing.workflow.js", args, {"filing:A:t-1": a, "filing:B:t-1": b}, self.tmp)
        self.assertTrue(rep["ok"], rep.get("error"))
        pa, pb = (c["prompt"] for c in rep["calls"])
        self.assertLess(pa.index("t-1:rule-1"), pa.index("t-1:figure-1"))
        self.assertGreater(pb.index("t-1:rule-1"), pb.index("t-1:figure-1"))     # B reads in reverse
        run = self.tmp / "run.json"
        run.write_text(json.dumps(rep["result"]))
        out = F.accept("t", 1, run)
        self.assertEqual((out["filed"], out["filed_none"], out["waiting"]), (2, 1, ["t-1:figure-1"]))
        lo = {i["id"]: i.get("lo") for i in self.record()["items"]}
        self.assertEqual((lo["t-1:rule-1"], lo["t-1:definition-1"], lo["t-1:figure-1"], lo["t-1:prior-knowledge-1"]),
                         ("t-1:objective-1", "t-1:objective-2", None, None))
        rows = {r["ref"]: r for r in O.summary("t")}
        self.assertEqual(rows["t-1:figure-1"]["kind"], "filing")
        with self.assertRaises(ValueError):
            O.decide({"book": "t", "kind": "filing", "ref": "t-1:figure-1", "decision": "file", "objective": 7, "by": "TD"})
        O.decide({"book": "t", "kind": "filing", "ref": "t-1:figure-1", "decision": "file", "objective": 2, "by": "TD"})
        self.assertEqual(F.apply("t", 1, False)["by_person"], 1)
        self.assertEqual({i["id"]: i.get("lo") for i in self.record()["items"]}["t-1:figure-1"], "t-1:objective-2")
        rec = self.record()
        rec["learning_objectives"] = rec["learning_objectives"][:1]   # G1 again, another set of objectives
        (self.tmp / "book-records" / "t" / "t-1.json").write_text(json.dumps(rec))
        self.assertTrue(F.apply("t", 1, False)["stale"])


if __name__ == "__main__":
    unittest.main()
