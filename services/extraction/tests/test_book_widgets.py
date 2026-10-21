"""Book widgets (book_widgets.py, runbook/widgets-book.workflow.js): the template rules for a teaching parent and for
method hints, and decision 47 applied to a hint — confirmed it is shown, unconfirmed it is held, never read.

    uv run --with pytest python -m pytest -q tests/test_book_widgets.py
"""
from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import book_widgets as BW  # noqa: E402
import generate_widget_questions as GW  # noqa: E402
import widget_spec as W  # noqa: E402

TEMPLATE = {
    "format": "ainext.widget-template/1",
    "id": "wt:pp3u1-4-3:drill-4-1",
    "lo_id": "lo:pp3u1-4-3",
    "book_item": "pp3u1-4:drill-4#1",
    "parent_question_id": "expl:pp3u1-4-3:bk-example-2",
    "parent_kind": "teaching",
    "tier": "basic",
    "kind": "line_drawer",
    "spec": {"mode": "equation", "m": 1, "b": 2},
    "stem": "Represent graphically the function $f(x) = x + 2$.",
    "solution": ["Find $f(0) = 2$ and $f(1) = 3$.", "Draw the line through (0, 2) and (1, 3)."],
    "diagnostics": [],
    "hints": [{"predicate": "intercept-wrong", "step": 1, "text": "Work out $f(0)$: where must the graph meet the y-axis?"}],
}


class Templates(unittest.TestCase):
    def test_a_book_widget_with_hints_and_no_mapping_is_a_template(self):
        self.assertEqual(GW.check_template(TEMPLATE), [])

    def test_samuels_rule_still_holds_without_hints(self):
        t = {k: v for k, v in TEMPLATE.items() if k != "hints"}
        self.assertTrue(any("diagnostics must map" in p for p in GW.check_template(t)))

    def test_a_teaching_parent_must_be_a_worked_example_of_the_same_objective(self):
        t = dict(TEMPLATE, parent_question_id="q:pp3u1-4-3:bk-drill-4-1")
        self.assertTrue(any("parent_question_id" in p for p in GW.check_template(t)))
        t = dict(TEMPLATE, parent_question_id="expl:pp3u1-4-4:bk-example-3")
        self.assertTrue(any("parent_question_id" in p for p in GW.check_template(t)))

    def test_a_hint_is_grounded_in_a_real_step_and_never_shadows_a_misconception(self):
        bad_step = copy.deepcopy(TEMPLATE)
        bad_step["hints"][0]["step"] = 3
        self.assertTrue(any("step must be" in p for p in GW.check_template(bad_step)))
        shadowed = copy.deepcopy(TEMPLATE)
        shadowed["diagnostics"] = [{"predicate": "intercept-wrong", "misconception_id": "mc:pp3u1-4-3:line-always-through-origin"}]
        self.assertTrue(any("already names a misconception" in p for p in GW.check_template(shadowed)))
        unknown = copy.deepcopy(TEMPLATE)
        unknown["hints"][0]["predicate"] = "swapped-coordinates"
        self.assertTrue(any("not one line_drawer declares" in p for p in GW.check_template(unknown)))

    def test_the_built_question_carries_its_hints_and_its_parent_kind(self):
        t = dict(TEMPLATE, _sha=GW.template_sha(TEMPLATE))
        (q,), problems = GW.build_from_templates([t])
        self.assertEqual(problems, [])
        self.assertEqual(q["parent_kind"], "teaching")
        self.assertEqual(q["choices"]["hints"][0]["predicate"], "intercept-wrong")
        self.assertIn("pp3u1-4:drill-4#1", q["source_note"])
        self.assertEqual(W.validate_widget(q), [])


class Verdicts(unittest.TestCase):
    def question(self):
        t = dict(TEMPLATE, _sha=GW.template_sha(TEMPLATE))
        (q,), _ = GW.build_from_templates([t])
        return t, q

    def scan(self, ok: bool):
        t, q = self.question()
        verdict = {"question_id": q["id"], "template_sha": t["_sha"], "reachable": True,
                   "reading": {"mode": "equation", "m": 1, "b": 2}, "construction": "(0, 2) and (1, 3)", "predicates": [],
                   "hints": [{"predicate": "intercept-wrong", "ok": ok, "why": "" if ok else "names the intercept"}]}
        import json
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
            json.dump({"results": [verdict]}, fh)
        accepted, rejected, status = GW.verdict_scan([t], [q], [Path(fh.name)])
        counts = GW.hold_pending([q], status)
        return accepted, q, counts

    def test_a_confirmed_hint_is_shown(self):
        accepted, q, counts = self.scan(True)
        self.assertEqual(accepted, {TEMPLATE["id"]})
        self.assertEqual([h["predicate"] for h in q["choices"]["hints"]], ["intercept-wrong"])
        self.assertNotIn("pending_hints", q["choices"])
        self.assertEqual(counts["hints_active"], 1)

    def test_an_unconfirmed_hint_is_held_never_shown(self):
        accepted, q, counts = self.scan(False)
        self.assertEqual(accepted, {TEMPLATE["id"]}, "the template stands; only the hint is held (decision 47)")
        self.assertNotIn("hints", q["choices"])
        self.assertEqual(q["choices"]["pending_hints"][0]["why"], "names the intercept")
        self.assertEqual(counts["hints_held"], 1)
        self.assertEqual(W.validate_widget(q), [])


class Packet(unittest.TestCase):
    def test_a_book_records_objective_is_named_as_the_graph_names_it(self):
        self.assertEqual(BW.lo_of("pp3u1-4:objective-3"), "lo:pp3u1-4-3")
        self.assertIsNone(BW.lo_of(None))


if __name__ == "__main__":
    unittest.main()
