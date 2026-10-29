"""S6 top-up and teaching parents for every book (Tamer, 2026-10-29; Samuel's answer 40, decision 61).

    uv run --with pytest python -m pytest -q tests/test_s6_topup.py

Prep 3 had 43 of 104 objectives with two live questions or fewer and no generated question on any of them: a family
needed a book QUESTION as its parent. The S6 author now sees each objective's worked examples (teaching items) after
its book questions; ingest.py's "S6 top-up" re-authors only the objectives S6 left thin. No model is called.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import book_record_generation as BRG  # noqa: E402
import generate_questions as GQ  # noqa: E402
import ingest  # noqa: E402
from families import spec as FS  # noqa: E402

WE = {"id": "expl:pp3u5-4-2:bk-example-1", "lo": "lo:pp3u5-4-2", "entry_type": "worked_example", "source_page": 61,
      "content": [{"kind": "problem", "text_md": "Find the equation of the line through (1, 2) with slope 3."},
                  {"step": 1, "text_md": "y - 2 = 3(x - 1)"}, {"step": 2, "text_md": "y = 3x - 1"}]}


class TeachingParents(unittest.TestCase):
    def test_a_worked_example_is_offered_under_its_question_twin(self):
        [t] = GQ.teaching_parents({"teaching": [WE]})
        self.assertEqual(t["id"], "q:pp3u5-4-2:bk-example-1")
        self.assertEqual((t["library_entry"], t["parent_kind"]), (WE["id"], "teaching"))
        self.assertTrue(t["teaching_only"])
        self.assertIn("equation of the line", t["stem"])
        self.assertEqual(t["solution"], ["y - 2 = 3(x - 1)", "y = 3x - 1"])

    def test_at_most_four(self):
        many = [{**WE, "id": f"expl:pp3u5-4-2:bk-example-{i}"} for i in range(9)]
        self.assertEqual(len(GQ.teaching_parents({"teaching": many})), GQ.TEACHING_PARENTS)

    def test_the_landing_step_makes_the_parent_a_teaching_one(self):
        spec = {"id": "tpl:pp3u5-4-2:through-point", "parent_question_id": "q:pp3u5-4-2:bk-example-1"}
        out, note = FS.resolve_teaching_parent(spec, set(), {WE["id"]})
        self.assertEqual((out["parent_question_id"], out["parent_kind"]), (WE["id"], "teaching"))
        self.assertIsNotNone(note)


class Targets(unittest.TestCase):
    def objs(self):
        return {
            "lo:a-1-1": {"questions": [], "teaching": [WE]},                                   # thin, a worked example
            "lo:a-1-2": {"questions": [{"verified": True}] * 5, "teaching": []},               # enough
            "lo:a-1-3": {"questions": [{"verified": True}], "teaching": []},                   # thin, has a family
            "lo:a-1-4": {"questions": [], "teaching": []},                                     # nothing to model on
            "lo:a-1-5": {"questions": [{"verified": False}] * 4, "teaching": [WE]},           # held questions only
        }

    def test_thin_with_no_usable_family_and_something_to_model_on(self):
        specs = [SimpleNamespace(lo_id="lo:a-1-3")]
        self.assertEqual(BRG.topup_targets(self.objs(), specs), ["lo:a-1-1", "lo:a-1-5"])


class Pipeline(unittest.TestCase):
    def test_ingest_runs_the_top_up_after_s6_and_records_it(self):
        self.assertIn("S6 top-up", ingest.LEDGER)
        self.assertLess(ingest.LEDGER.index("S6"), ingest.LEDGER.index("S6 top-up"))
        src = (Path(ingest.__file__)).read_text()
        self.assertIn('"s6-topup"', src)


if __name__ == "__main__":
    unittest.main()
