"""Samuel's G2 recommender on the book questions compile holds (book_record_g2.py, compile_book_records.apply_g2).

No @covers marker: G2 is pipeline policy (Samuel's answers 37a and 42). Canned agent answers through tests/workflow_stub.mjs,
Samuel's own runbook/g2-recommend.workflow.js and g2_recommend.collect; no model is called. What is proved:
  - a held book question becomes an item his model accepts (a stand-in reference, `disputed`, `answer_anchored`);
  - an accept the independent verifier confirms releases the hold, signed as the AI line's, never a person's;
  - an accept the verifier does not confirm stays held (his policy: never live on one agent's word);
  - a recommendation for a question that has changed since is not applied.
"""
from __future__ import annotations

import copy
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

EX = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(EX))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import _objectives_fixture as fx  # noqa: E402
import book_record_g2 as BG  # noqa: E402
import compile_book_records as C  # noqa: E402
import g2_recommend as G  # noqa: E402
import book_config  # noqa: E402

NOTE = "The book's own exercise ({ref}, printed p.7); answer printed in the book. Compiled from the book record (compile_book_records.py)."
Q = [{"id": "q:t-1-1:bk-exercise-1", "lo": "lo:t-1-1", "tier": "basic", "type": "numeric", "stem": "Find $2 + 3$.", "answer": "5",
      "solution": ["$2 + 3 = 5$"], "source_page": 7, "hold_reason": "answer_mismatch", "source_note": NOTE.format(ref="t-1:exercise-1")},
     {"id": "q:t-1-1:bk-exercise-2", "lo": "lo:t-1-1", "tier": "basic", "type": "numeric", "stem": "Find $4 \\times 3$.", "answer": "12",
      "solution": ["$4 \\times 3 = 12$"], "source_page": 7, "hold_reason": "answer_mismatch", "source_note": NOTE.format(ref="t-1:exercise-2")}]
RECORD = {"items": [{"id": "t-1:exercise-1", "type": "exercise", "source_page": 7, "answer": "5"},
                    {"id": "t-1:exercise-2", "type": "exercise", "source_page": 7, "answer": "12"}]}


class G2(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.saved = (BG.HERE, C.HERE)
        BG.HERE = C.HERE = self.tmp
        (self.tmp / "book-records" / "t").mkdir(parents=True)
        (self.tmp / "book-records" / "t" / "t-1.json").write_text(json.dumps(RECORD))
        (self.tmp / "compiled").mkdir()
        (self.tmp / "compiled" / "unit1.json").write_text(json.dumps({"nodes": [], "questions": Q}))
        (self.tmp / "teaching" / "t" / "printed-checks").mkdir(parents=True)
        (self.tmp / "teaching" / "t" / "printed-checks" / "t-1.json").write_text(json.dumps(
            {"checks": [{"ref": "t-1:exercise-1", "status": "disagreed", "blind": "6"}, {"ref": "t-1:exercise-2", "status": "disagreed", "blind": "7"}]}))

    def tearDown(self):
        BG.HERE, C.HERE = self.saved
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_held_questions_through_samuels_g2(self):
        es = BG.entries("t", ["t-1"], self.tmp / "compiled")
        self.assertEqual([e["item"]["ref"] for e in es], ["Ex1-1:1", "Ex1-1:2"])
        self.assertEqual({e["item"]["verification"] for e in es}, {"disputed"})
        self.assertEqual(es[0]["item"]["solution_provenance"], "answer_anchored")
        args = G.build_args(book_config.load_book("prep3-math-en"), 1, es)
        k1, k2 = es[0]["key"], es[1]["key"]
        rec = {"results": [{"key": k1, "verdict": "accept", "class": "book answer confirmed", "confidence": "high",
                            "note": "2 + 3 is 5; the blind solver slipped.", "book_quote": "5"},
                           {"key": k2, "verdict": "accept", "class": "book answer confirmed", "confidence": "high",
                            "note": "4 × 3 is 12.", "book_quote": "12"}]}
        ver = {"results": [{"key": k1, "own_answer": "5", "verdict": "confirmed", "other_correct_answers": False, "note": "ok"},
                           {"key": k2, "own_answer": "7", "verdict": "wrong", "other_correct_answers": False, "note": "I get 7"}]}
        import embed_workflow as EW
        copy_ = self.tmp / "g2.copy.workflow.js"
        EW.write(G.WORKFLOW, args, copy_)   # his script runs only as a generated copy, as book_record_g2.py run makes it
        rep = fx.run_workflow(copy_, {}, {"G2R:rec:b01:t-1+1": rec, "G2R:ver:b01:t-1+1": ver}, self.tmp)
        self.assertTrue(rep["ok"], rep.get("error"))
        run = self.tmp / "g2run.json"
        run.write_text(json.dumps(rep["result"]))
        out = BG.collect("t", 1, es, run)
        self.assertEqual(out["items"][k1]["verdict"], "accept")
        self.assertEqual(out["items"][k2]["verdict"], "hold")             # unconfirmed: never live on one agent's word
        qs = {"t-1": copy.deepcopy(Q)}
        report = {"g2": [], "held": [{"question": q["id"]} for q in Q], "skipped": []}
        C.apply_g2("t", qs, report)
        a, b = qs["t-1"]
        self.assertTrue(a["verified"])
        self.assertNotIn("hold_reason", a)
        self.assertIn("auto-pass G2", report["g2"][0]["by"])
        self.assertEqual(b["hold_reason"], "answer_mismatch")
        self.assertEqual([h["question"] for h in report["held"]], [b["id"]])

    def test_a_changed_question_is_not_released(self):
        self.test_held_questions_through_samuels_g2()
        qs = {"t-1": copy.deepcopy(Q)}
        qs["t-1"][0]["stem"] = "Find $2 + 4$."
        report = {"g2": [], "held": [], "skipped": []}
        C.apply_g2("t", qs, report)
        self.assertEqual(qs["t-1"][0]["hold_reason"], "answer_mismatch")
        self.assertFalse(report["g2"][0]["applied"])


if __name__ == "__main__":
    unittest.main()
