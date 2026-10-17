"""S0a's maths second reading: runbook/maths-reading.workflow.js, book_record_maths.py and the review tool's Maths
reading task (groundtruth/review/maths_reading.py).

No @covers marker: reading the book is pipeline policy (docs/design/maths-ingestion-pipeline.md). Canned agent answers
through tests/workflow_stub.mjs; no model is called. What is proved:
  - places: every $…$ of a record's printed fields, the formula field and a worked example's lifted answer left out;
    each place is masked (the second reader never sees the first reading) and an item over a page break is offered
    on each of its pages;
  - accept: LaTeX written two ways for one print agrees, a different print disagrees, a missing one is unread, and a
    page that did not find an item's formula does not hide the page that did;
  - review and apply: a decision is fingerprinted; apply writes only a chosen second or typed reading, only where the
    record still holds the first, with a history line;
  - the third reading (Samuel's pass C): it settles a place when it agrees with the first (the record stays) or the
    second (apply writes the second, no person needed); agreeing with neither leaves it for a person, who still wins.
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
sys.path.insert(0, str(Path(__file__).resolve().parent))

import _objectives_fixture as fx  # noqa: E402
import book_record_maths as M  # noqa: E402
import maths_reading as R  # noqa: E402

SCRIPT = EX / "runbook" / "maths-reading.workflow.js"
RECORD = {"lesson": {"slug": "t-1"}, "source_document": {"page_offset": 1}, "items": [
    {"id": "t-1:rule-1", "type": "rule", "source_page": 7, "quote": "If $a = b$ then", "claim": "If $a = b$ then $(a, b) = (b, a)$",
     "formula": "$a=b \\Rightarrow (a,b)=(b,a)$"},
    {"id": "t-1:example-1", "type": "worked_example", "source_page": 7, "pages": [7, 8], "quote": "Find $X \\times Y$",
     "stem": "Find $X \\times Y$", "solution": ["$\\{1\\} \\times \\{2\\} = \\{(1,2)\\}$"], "answer": "$\\{(1,2)\\}$"},
    {"id": "t-1:exercise-1", "type": "exercise", "source_page": 8, "quote": "Complete", "text": "Complete",
     "parts": [{"label": "A", "stem": "$\\frac{1}{2} \\leq x$", "answer": "$x \\geq 0.5$"}]}]}


class MathsReading(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.root = self.tmp / "ex"
        (self.root / "book-records" / "t").mkdir(parents=True)
        (self.root / "book-records" / "t" / "t-1.json").write_text(json.dumps(RECORD))
        self.saved = (M.HERE, R.EXTRACTION, R.RECORDS, R.REVIEWS)
        M.HERE = self.root
        R.EXTRACTION, R.RECORDS, R.REVIEWS = self.root, self.root / "book-records", self.root / "reviews"

    def tearDown(self):
        M.HERE, R.EXTRACTION, R.RECORDS, R.REVIEWS = self.saved
        shutil.rmtree(self.tmp, ignore_errors=True)

    def places(self):
        return M.lesson_places("t", "t-1")[1]

    def test_places_are_masked_and_cover_page_breaks(self):
        p = {x["ref"]: x for x in self.places()}
        self.assertNotIn("t-1:rule-1|formula|0", p)
        self.assertNotIn("t-1:example-1|answer|0", p)
        self.assertIn("t-1:exercise-1|parts[0].answer|0", p)
        self.assertEqual(p["t-1:rule-1|claim|1"]["context"], "If ⟨…⟩ then ⟨?⟩")
        self.assertEqual(p["t-1:example-1|solution[0]|0"]["pages"], [7, 8])
        self.assertNotIn("$", json.dumps([x["context"] + x["item"] for x in p.values()]))

    def test_the_workflow_sees_no_first_reading(self):
        self.read_twice()

    def read_twice(self):
        places = self.places()
        pages = [{"lesson": "t-1", "printed": g, "image": f"/x/p{g}.png",
                  "places": [{k: x[k] for k in ("ref", "item", "field", "context")} for x in places if g in x["pages"]]} for g in (7, 8)]
        resp = {"maths:t-1:p7": {"readings": [{"ref": "t-1:rule-1|claim|0", "latex": "a=b"},
                                              {"ref": "t-1:rule-1|claim|1", "latex": "\\left(a,b\\right)=(b,a)"},
                                              {"ref": "t-1:example-1|stem|0", "latex": "X × Y"},
                                              {"ref": "t-1:example-1|solution[0]|0", "latex": "", "unreadable": True, "notes": "not on this page"}]},
                "maths:t-1:p8": {"readings": [{"ref": "t-1:example-1|solution[0]|0", "latex": "\\{1\\}\\times\\{3\\}=\\{(1,3)\\}"},
                                              {"ref": "t-1:exercise-1|parts[0].stem|0", "latex": "\\dfrac12 \\le x"}]}}
        rep = fx.run_workflow(SCRIPT, {"stage": "S0a-maths-reading", "book": {"book": "t"}, "pages": pages}, resp, self.tmp)
        self.assertTrue(rep["ok"], rep.get("error"))
        for c in rep["calls"]:
            for x in places:
                self.assertNotIn(x["first"], c["prompt"])
        run = self.tmp / "run.json"
        run.write_text(json.dumps(rep["result"]))
        self.assertEqual(M.accept("t", run)["t-1"], {"agreed": 3, "disagreed": 2, "unread": 1})
        st = {e["ref"]: e["status"] for e in json.loads((self.root / "book-records/t/maths-reading/t-1.json").read_text())["entries"]}
        self.assertEqual(st["t-1:example-1|solution[0]|0"], "disagreed")   # page 8's reading counts, not page 7's
        self.assertEqual(st["t-1:exercise-1|parts[0].stem|0"], "disagreed")  # \dfrac12 is not \frac{1}{2} as written
        self.assertEqual(st["t-1:exercise-1|parts[0].answer|0"], "unread")
        return run

    def test_review_and_apply(self):
        self.read_twice()
        rows = {r["ref"]: r for r in R.summary("t")}
        self.assertEqual(rows["t-1:example-1|solution[0]|0"]["state"], "open")
        with self.assertRaises(ValueError):
            R.decide({"book": "t", "ref": "t-1:example-1|solution[0]|0", "choice": "other", "by": "TD"})
        R.decide({"book": "t", "ref": "t-1:example-1|solution[0]|0", "choice": "second", "by": "TD"})
        R.decide({"book": "t", "ref": "t-1:exercise-1|parts[0].stem|0", "choice": "first", "by": "TD"})
        R.decide({"book": "t", "ref": "t-1:exercise-1|parts[0].answer|0", "choice": "other", "latex": "x \\ge 0.5", "by": "TD"})
        self.assertEqual(M.apply("t", True)["applied"], ["t-1:example-1|solution[0]|0", "t-1:exercise-1|parts[0].answer|0"])
        self.assertEqual(json.loads((self.root / "book-records/t/t-1.json").read_text()), RECORD)   # a dry run writes nothing
        M.apply("t", False)
        rec = json.loads((self.root / "book-records/t/t-1.json").read_text())
        ex = next(i for i in rec["items"] if i["id"] == "t-1:example-1")
        self.assertEqual(ex["solution"][0], "$\\{1\\}\\times\\{3\\}=\\{(1,3)\\}$")
        self.assertEqual(rec["items"][2]["parts"][0]["answer"], "$x \\ge 0.5$")
        self.assertEqual(len(rec["history"]), 2)
        again = M.apply("t", False)
        self.assertEqual((again["applied"], again["skipped"]), ([], []))   # applied already: nothing again, nothing stale
        self.assertEqual(R.summary("t")[0]["state"], "agreed")

    def test_the_third_reading_settles_two_of_three(self):
        self.read_twice()
        f = self.root / "book-records/t/maths-reading/t-1.json"
        open_refs = [e["ref"] for e in json.loads(f.read_text())["entries"] if e["status"] != "agreed"]
        self.assertEqual(sorted(M.unsettled("t", ["t-1"])["t-1"]), sorted(open_refs))
        third = {"stage": "S0a-maths-reading", "mode": "third", "pages": [
            {"lesson": "t-1", "printed": 8, "readings": [
                {"ref": "t-1:example-1|solution[0]|0", "latex": "\\{1\\} \\times \\{3\\} = \\{(1, 3)\\}"},   # = the second
                {"ref": "t-1:exercise-1|parts[0].stem|0", "latex": "\\frac{1}{2}\\le x"},                     # = the first
                {"ref": "t-1:exercise-1|parts[0].answer|0", "latex": "x > 0.5"}]}]}                            # neither
        run = self.tmp / "third.json"
        run.write_text(json.dumps(third))
        self.assertEqual(M.settle("t", run)["t-1"], {"settled_first": 1, "settled_second": 1, "still_open": 1})
        st = {e["ref"]: (e["status"], e.get("sided_with")) for e in json.loads(f.read_text())["entries"]}
        self.assertEqual(st["t-1:example-1|solution[0]|0"], ("settled", "second"))
        self.assertEqual(st["t-1:exercise-1|parts[0].stem|0"], ("settled", "first"))
        self.assertEqual(st["t-1:exercise-1|parts[0].answer|0"][0], "unread")
        self.assertEqual(M.unsettled("t", ["t-1"]), {})                              # read three times: nothing more to read
        self.assertEqual(M.apply("t", False)["applied"], ["t-1:example-1|solution[0]|0"])   # settled for the second: written
        rows = {r["ref"]: r["state"] for r in R.summary("t")}
        self.assertEqual((rows["t-1:example-1|solution[0]|0"], rows["t-1:exercise-1|parts[0].answer|0"]), ("agreed", "open"))


if __name__ == "__main__":
    unittest.main()
