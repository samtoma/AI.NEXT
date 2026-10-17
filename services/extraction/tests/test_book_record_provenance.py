"""S2's provenance check on book records (book_record_provenance.py, runbook/provenance.workflow.js, and the review
tool's Label extraction flags, groundtruth/review/provenance.py).

No @covers marker: pipeline policy (Tamer, 2026-10-17: adopt Samuel's S2 provenance check). Canned agent answers through
tests/workflow_stub.mjs; no model is called. What is proved:
  - Samuel's rule: Haiku first, Sonnet re-audits only what Haiku did not confirm, an UNSUPPORTED statement is kept and
    flagged; his prompts' rule ("nothing added; when unsure, false") reaches the agents;
  - an EPUB book's verbatim statements pass by containment with no model;
  - a statement edited since it was checked is not flagged by that check, and is checked again;
  - the review server's reader computes the same fingerprint as the pipeline (it cannot import it).
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
import book_record_provenance as P  # noqa: E402
import provenance as RP  # noqa: E402

ITEMS = [{"id": "t-1:rule-1", "type": "rule", "claim": "Each point is one ordered pair.", "quote": "Each point represents one", "source_page": 7},
         {"id": "t-1:definition-1", "type": "definition", "claim": "This net is the coordinate plane.", "quote": "the coordinat plane", "source_page": 7},
         {"id": "t-1:key-term-1", "type": "key_term", "term": "Ordered pair", "quote": "Ordered pair", "source_page": 7},
         {"id": "t-1:exercise-1", "type": "exercise", "text": "Find x", "source_page": 7}]


class Provenance(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.saved = (P.HERE, RP.EXTRACTION)
        P.HERE = RP.EXTRACTION = self.tmp
        (self.tmp / "book-records" / "t").mkdir(parents=True)
        self.write({"provenance": {"method": "page image"}, "items": ITEMS})

    def tearDown(self):
        P.HERE, RP.EXTRACTION = self.saved
        shutil.rmtree(self.tmp, ignore_errors=True)

    def write(self, rec):
        (self.tmp / "book-records" / "t" / "t-1.json").write_text(json.dumps(rec))

    def test_haiku_then_sonnet_then_flag(self):
        sts = [{"i": k + 1, "id": it["id"], "type": it["type"], "claim": P.claim_of(it), "quote": it["quote"]} for k, it in enumerate(ITEMS[:3])]
        args = {"stage": "S2-provenance", "book": {"book": "t"}, "pages": [{"lesson": "t-1", "printed": 7, "image": "/x/p7.png", "statements": sts}]}
        haiku = {"checks": [{"i": 1, "supported": False, "note": "page says 'represents one'"}, {"i": 2, "supported": False, "note": "adds 'e'"},
                            {"i": 3, "supported": True}]}
        sonnet = {"verdicts": [{"i": 1, "verdict": "SUPPORTED", "note": "same meaning"}, {"i": 2, "verdict": "UNSUPPORTED", "note": "corrects the spelling"}]}
        rep = fx.run_workflow(EX / "runbook" / "provenance.workflow.js", args, {"S2:prov:t-1:p7": haiku, "S2:audit:t-1:p7": sonnet}, self.tmp)
        self.assertTrue(rep["ok"], rep.get("error"))
        calls = {c["label"]: c for c in rep["calls"]}
        self.assertEqual(calls["S2:prov:t-1:p7"]["model"], "haiku")
        self.assertIn("with nothing added", calls["S2:prov:t-1:p7"]["prompt"])
        self.assertNotIn("Ordered pair", calls["S2:audit:t-1:p7"]["prompt"])          # only what Haiku did not confirm
        run = self.tmp / "run.json"
        run.write_text(json.dumps(rep["result"]))
        self.assertEqual(P.accept("t", run)["t-1"], {"containment": 0, "checked": 1, "re-audited": 1, "unsupported": 1, "unchecked": 0})
        self.assertEqual(list(P.flags("t", "t-1")), ["t-1:definition-1"])
        self.assertEqual(list(RP.flags("t", "t-1")), ["t-1:definition-1"])          # the review server reads the same
        rec = {"provenance": {"method": "page image"}, "items": [dict(ITEMS[0]), dict(ITEMS[1], claim="This net is the coordinat plane."), ITEMS[2], ITEMS[3]]}
        self.write(rec)                                                            # a person edits the flagged statement
        self.assertEqual(P.flags("t", "t-1"), {})
        self.assertEqual(RP.flags("t", "t-1"), {})
        done = P.checked_already("t", "t-1")
        self.assertNotEqual(done["t-1:definition-1"]["fingerprint"], P.fingerprint(rec["items"][1]))   # so the next run checks it

    def test_epub_statements_pass_by_containment(self):
        self.write({"provenance": {"method": "EPUB blocks (source_adapter.py) + S0b maths"}, "items": ITEMS})
        rep = P.record("t", "t-1", [{"id": i["id"], "provenance": "containment"} for i in ITEMS[:3]], None)
        self.assertEqual(rep["containment"], 3)
        self.assertTrue(P.verbatim(json.loads((self.tmp / "book-records/t/t-1.json").read_text())))

    def test_the_two_fingerprints_agree(self):
        for it in ITEMS[:3]:
            self.assertEqual(P.fingerprint(it), RP.fingerprint(it))


if __name__ == "__main__":
    unittest.main()
