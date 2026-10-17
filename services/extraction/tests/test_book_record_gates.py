"""The book-record line's checks before a load: the coverage audit, the gated load, G5 and the fan-out.

No @covers marker: these are pipeline policy (Samuel's runbook §5, §6, §8 and §10, on book records). No model, no database.
What is proved:
  - coverage (book_record_coverage.audit): a page in no lesson fails unless it is a confirmed unit opener; a prompt neither
    asked nor left out fails; a tier cell counts only a LIVE question (review_policy's rule); a signed exception excepts,
    an unsigned one does not;
  - the load (book_record_load): a RED audit, or one whose inputs changed since, stops it; --scratch loads only on this
    machine; --go needs a person's GO at G5 on the unit as it stands;
  - the fan-out (ingest.run_unit): done stages are skipped, a gate a person owes stops the unit, a failing stage stops it.
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

EX = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(EX))

import book_record_coverage as COV  # noqa: E402
import book_record_load as L  # noqa: E402
import ingest  # noqa: E402

BOOK = SimpleNamespace(book="t", course_id="course:t-math", sources=SimpleNamespace(epub=None, pdf="x.pdf"), maths_source=None)
LMAP = {"page_offset": 1, "lessons": [{"slug": "t-1", "pages": [7, 9]}, {"slug": "t-2", "pages": [11, 12]}]}


def record(slug, pages, items):
    return {"source_document": {"file_path": "x.pdf", "page_offset": 1}, "lesson": {"slug": slug, "pages": pages}, "items": items}


class Coverage(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.saved = COV.HERE
        COV.HERE = self.tmp
        (self.tmp / "book-records" / "t").mkdir(parents=True)

    def tearDown(self):
        COV.HERE = self.saved
        shutil.rmtree(self.tmp, ignore_errors=True)

    def inputs(self, questions=(), generated=(), skipped=()):
        recs = {"t-1": record("t-1", [7, 9], [{"id": "t-1:exercise-1", "type": "exercise", "source_page": 8, "lo": "t-1-1"}]),
                "t-2": record("t-2", [11, 12], [])}
        return {"lmap": LMAP, "records": recs, "nodes": [{"id": "lo:t-1-1", "kind": "learning_objective"}],
                "questions": list(questions), "visuals": [], "entries": [], "generated": list(generated), "widgets": [],
                "catalogue": [], "content": {}, "skipped": list(skipped), "report": {}}

    def check(self, I, cid):
        with mock.patch.object(COV, "objective_of", lambda s, r: {"t-1:exercise-1": "lo:t-1-1"} if s == "t-1" else {}):
            return next(c for c in COV.audit(BOOK, 1, ["t-1", "t-2"], I, self.tmp) if c.id == cid)

    def test_pages_and_openers(self):
        self.assertEqual([f["scope"] for f in self.check(self.inputs(), "pages").failures], ["page 10"])
        (self.tmp / "book-records" / "t" / "lessons.proposed.json").write_text(json.dumps({"unit_openers": [{"printed": 10, "opener": True}]}))
        self.assertEqual(self.check(self.inputs(), "pages").failures, [])

    def test_prompts_must_be_asked_or_left_out(self):
        self.assertEqual(len(self.check(self.inputs(), "mapped_items_accounted").failures), 1)
        I = self.inputs(skipped=[{"lesson": "t-1", "ref": "t-1:exercise-1", "why": "no usable answer yet"}])
        self.assertEqual(self.check(I, "mapped_items_accounted").failures, [])

    def test_tier_floor_counts_live_only(self):
        held = {"id": "q1", "lo": "lo:t-1-1", "tier": "basic", "verified": True, "hold_reason": "unverified", "source_note": ""}
        live = {"id": "q2", "lo": "lo:t-1-1", "tier": "standard", "verified": True, "source_note": ""}
        c = self.check(self.inputs(questions=[held, live]), "tier_floor")
        self.assertEqual(c.got, 1)
        self.assertEqual(sorted(f["scope"] for f in c.failures), ["lo:t-1-1 advanced", "lo:t-1-1 basic"])

    def test_a_shared_boundary_page_needs_a_mid_page_start(self):
        I = self.inputs()
        I["lmap"] = {"page_offset": 1, "lessons": [{"slug": "t-1", "pages": [7, 9]}, {"slug": "t-2", "pages": [9, 12]}]}
        I["records"]["t-2"]["lesson"]["pages"] = [9, 12]
        self.assertEqual([f["scope"] for f in self.check(I, "pages").failures], ["page 9"])
        I["lmap"]["lessons"][1]["starts_mid_page"] = True
        self.assertEqual(self.check(I, "pages").failures, [])

    def test_signed_exceptions_only(self):
        c = self.check(self.inputs(), "pages")
        self.assertEqual(c.as_dict([{"check": "pages", "scope": "page 10"}])["state"], "fails")
        self.assertEqual(c.as_dict([{"check": "pages", "scope": "page 10", "signed_by": "TD"}])["state"], "excepted")


class LoadGates(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.saved = (L.HERE, COV.HERE)
        L.HERE = COV.HERE = self.tmp
        (self.tmp / "coverage").mkdir()
        (self.tmp / "compiled").mkdir()
        (self.tmp / "compiled" / "unit1.json").write_text("{}")

    def tearDown(self):
        L.HERE, COV.HERE = self.saved
        shutil.rmtree(self.tmp, ignore_errors=True)

    def audit(self, status):
        rep = {"status": status, "lessons": ["t-1"], "summary": {"hold": 1, "excepted": 0}, "checks": [{"id": "pages", "state": "fails" if status == "RED" else "holds"}],
               "inputs": COV.fingerprint("t", ["t-1"], self.tmp / "compiled")}
        (self.tmp / "coverage" / "t.unit01.book-records.json").write_text(json.dumps(rep))

    def test_red_stale_green(self):
        self.audit("RED")
        self.assertFalse(L.audit_ok("t", 1, self.tmp / "compiled")[0])
        self.audit("GREEN")
        self.assertTrue(L.audit_ok("t", 1, self.tmp / "compiled")[0])
        (self.tmp / "compiled" / "unit1.json").write_text('{"changed": true}')
        ok, why = L.audit_ok("t", 1, self.tmp / "compiled")
        self.assertFalse(ok)
        self.assertIn("stale", why)

    def test_scratch_is_local_and_go_needs_g5(self):
        self.audit("GREEN")
        with mock.patch.object(L.book_config, "load_book", lambda n: BOOK):
            with self.assertRaises(SystemExit):
                L.main(["t", "1", "--compiled", str(self.tmp / "compiled"), "--dsn", "postgres://u@db.example.com/x", "--scratch"])
            import book_record_gonogo as G5
            with mock.patch.object(G5, "current_go", lambda b, u: (False, "no G5 decision")):
                self.assertEqual(L.main(["t", "1", "--compiled", str(self.tmp / "compiled"), "--dsn", "postgres://127.0.0.1/x", "--go"]), 1)


class FanOut(unittest.TestCase):
    def run_with(self, steps):
        with mock.patch.object(ingest, "stages", lambda *a: (["t-1"], steps)):
            return ingest.run_unit("t", 1, None, None, False)

    def test_skips_done_stops_at_gate(self):
        r = self.run_with([("S0a", True, [["false"]]), ("S1", False, [["true"]]), ("G1", False, "objectives not approved"),
                           ("S2", False, [["true"]])])
        self.assertEqual(r["ran"], ["S1: …"])
        self.assertIn("G1", r["stopped"])

    def test_a_failing_stage_stops(self):
        r = self.run_with([("S1", False, [["false"]]), ("S2", False, [["true"]])])
        self.assertIn("S1 failed", r["stopped"])
        self.assertEqual(r["ran"], [])


if __name__ == "__main__":
    unittest.main()
