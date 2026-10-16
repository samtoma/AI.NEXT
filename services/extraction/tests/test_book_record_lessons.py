"""S0 for page-image books: runbook/lesson-map.workflow.js + book_record_lessons.py.

No @covers marker: the lesson map is pipeline policy (docs/design/maths-ingestion-pipeline.md). Canned agent answers
through tests/workflow_stub.mjs; no model is called. What is proved:
  - the workflow: two blind contents readers and one page-number agent per probe; the 'openers' mode, one per unit;
  - accept: references compared by their numbers ("(1 - 1)" is "1 - 1"), a real difference becomes a disagreement,
    the offset is the probes' vote, end pages stop before the next lesson and before a confirmed unit opener, the book's
    last lesson is flagged, and a contents that covers only part of the PDF says so;
  - approve: refused while a disagreement is left; an approved map is never replaced, a second part is added under its
    own page_offset with --force.
"""
from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

EX = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(EX))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import _objectives_fixture as fx  # noqa: E402
import book_record_lessons as BL  # noqa: E402

SCRIPT = EX / "runbook" / "lesson-map.workflow.js"
UNITS = [{"number": "1", "title": "Relations and functions", "start": 7, "strand": "Algebra", "lessons": [
            {"ref": "(1 - 1)", "title": "Cartesian product", "start": 7, "kind": "lesson"},
            {"ref": "(1 - 2)", "title": "Relations", "start": 13, "kind": "lesson"}]},
         {"number": "(2)", "title": "Ratio", "start": 25, "strand": "Algebra", "lessons": [
            {"ref": "(2 - 1)", "title": "Ratio", "start": 25, "kind": "lesson"},
            {"ref": "(2 - 2)", "title": "Unit test", "start": 30, "kind": "review"}]}]
ARGS = {"stage": "S0-lesson-map", "book": {"book": "t", "title": "T"}, "pdf_pages": 100,
        "contents": [{"pdf_page": 4, "image": "/x/p004.png"}], "probes": [{"pdf_page": p, "image": f"/x/p{p}.png"} for p in (11, 16, 22)]}


def contents(units):
    return {"contents_pages": [4], "units": units}


class LessonMap(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def run_contents(self, b_units=None, printed=(10, 15, 21)):
        b = copy.deepcopy(b_units or UNITS)
        for u in b:   # reader B writes references without brackets: the same reference
            for l in u["lessons"]:
                l["ref"] = l["ref"].strip("()")
        resp = {"map:contents:A": contents(UNITS), "map:contents:B": contents(b)}
        resp |= {f"map:page:{p['pdf_page']}": {"printed": n} for p, n in zip(ARGS["probes"], printed)}
        rep = fx.run_workflow(SCRIPT, ARGS, resp, self.tmp)
        self.assertTrue(rep["ok"], rep.get("error"))
        return rep

    def save(self, name, obj):
        f = self.tmp / name
        f.write_text(json.dumps(obj))
        return f

    def test_two_blind_readers_and_the_probes(self):
        rep = self.run_contents()
        labels = [c["label"] for c in rep["calls"]]
        self.assertEqual(sorted(labels[:2]), ["map:contents:A", "map:contents:B"])
        self.assertEqual(len(labels), 5)
        self.assertEqual(rep["calls"][0]["prompt"], rep["calls"][1]["prompt"])

    def test_compare_offsets_ends_and_openers(self):
        res = self.run_contents()["result"]
        c = BL.compare(res)
        self.assertEqual(c["page_offset"], 1)
        by = {l["slug"]: l for l in c["lessons"]}
        self.assertEqual(by["u1-1"]["syllabus_ref"], "Lesson 1-1")
        self.assertEqual(by["u1-1"]["module"], "Unit 1 Relations and functions (Algebra)")
        self.assertEqual(by["u2-r1"]["kind"], "review")
        self.assertEqual(by["u1-2"]["pages"], [13, 24])
        self.assertEqual(BL.compare(res, openers={2: 24})["lessons"][1]["pages"], [13, 23])
        self.assertEqual([d["where"] for d in c["disagreements"]], ["u2-r1 end"])   # brackets are not a disagreement
        self.assertIn("another part", c["coverage"]["note"])
        self.assertEqual([o["printed"] for o in BL.opener_candidates(res)], [24])

    def test_a_real_difference_and_a_split_vote(self):
        b = copy.deepcopy(UNITS)
        b[0]["lessons"][1]["start"] = 14
        c = BL.compare(self.run_contents(b, printed=(10, 15, 90))["result"])
        where = [d["where"] for d in c["disagreements"]]
        self.assertIn("u1-2 start", where)
        self.assertIn("page_offset", where)

    def test_the_openers_mode(self):
        rep = fx.run_workflow(SCRIPT, {"stage": "S0-lesson-map", "mode": "openers",
                                       "openers": [{"unit": 2, "unit_title": "Unit 2 Ratio", "printed": 24, "image": "/x/p25.png"}]},
                              {"map:opener:2": {"opener": True}}, self.tmp)
        self.assertTrue(rep["ok"], rep.get("error"))
        self.assertEqual(rep["result"]["openers"], [{"unit": 2, "printed": 24, "opener": True, "notes": ""}])

    def test_approve_gates_and_never_replaces(self):
        orig = BL.mapdir
        BL.mapdir = lambda book: self.tmp / "maps"
        try:
            res = self.run_contents()["result"]
            prop = BL.accept("t", self.save("run.json", res))
            with self.assertRaises(SystemExit):
                BL.approve("t", "TD", False)   # the last lesson's end is still a disagreement
            prop["disagreements"] = []
            (self.tmp / "maps" / "lessons.proposed.json").write_text(json.dumps(prop))
            self.assertEqual(BL.approve("t", "TD", False)["lessons"], 4)
            with self.assertRaises(SystemExit):
                BL.approve("t", "TD", False)   # an approved map is never replaced without --force
            prop["page_offset"] = 73
            prop["lessons"] = [dict(prop["lessons"][0], slug="u3-1", pages=[7, 12])]
            (self.tmp / "maps" / "lessons.proposed.json").write_text(json.dumps(prop))
            self.assertEqual(BL.approve("t", "TD", True)["added"], ["u3-1"])
            m = json.loads((self.tmp / "maps" / "lessons.json").read_text())
            self.assertEqual(m["page_offset"], 1)
            self.assertEqual(m["lessons"][-1]["page_offset"], 73)
            self.assertNotIn("page_offset", m["lessons"][0])
        finally:
            BL.mapdir = orig


if __name__ == "__main__":
    unittest.main()
