"""load_seed.py reads the v2 schema's shapes (T336 handoff): marker choices and English claims.

    uv run --with pytest python -m pytest -q tests/test_load_seed_shapes.py

No database. The rows these functions build are what the loader writes:
  * a marker question's `choices` is the object {"marker": {...}}, compared as a whole;
  * an English claim step is stored under `text_md`, the key every step reader takes
    first, and every shipped Arabic step is written exactly as before (checked against the
    previous implementation over the whole Social Studies bundle).
"""

from __future__ import annotations

import json
import unittest

from _scratchdb import EX
import assemble_lesson_bundle as alb
import book_config
import load_seed
from schemas import ClaimStep, Question, SeedBundle

FIX = EX / "tests" / "fixtures" / "g10-math"


def old_canonical_solution_json(solution: list) -> str:
    """The implementation before the English claim step (kept here as the reference)."""
    if solution and isinstance(solution[0], ClaimStep):
        return json.dumps([
            {"step": i + 1, "claim_ar": s.claim_ar, "evidence_page": s.evidence_page,
             "evidence_kind": s.evidence_kind,
             "facts": [f.model_dump() for f in (s.facts or [])]}
            for i, s in enumerate(solution)])
    return json.dumps([{"step": i + 1, "text_md": t} for i, t in enumerate(solution)])


class ClaimStepTest(unittest.TestCase):
    def test_every_shipped_arabic_step_is_written_byte_identically(self):
        b = SeedBundle.model_validate_json((EX / "seed" / "social-t1.json").read_text())
        steps = [q for q in b.questions if q.solution and isinstance(q.solution[0], ClaimStep)]
        self.assertGreater(len(steps), 700)
        for q in steps:
            self.assertEqual(load_seed.canonical_solution_json(q.solution),
                             old_canonical_solution_json(q.solution), q.id)

    def test_an_english_claim_step_is_stored_as_text_md_with_its_evidence(self):
        s = ClaimStep(claim="Parallel lines have equal gradients.", lang="en", claim_type="rule",
                      anchor="EMA6C", evidence_page=300, evidence_kind="heading")
        self.assertEqual(json.loads(load_seed.canonical_solution_json([s])), [{
            "step": 1, "text_md": "Parallel lines have equal gradients.", "lang": "en",
            "evidence_page": 300, "evidence_kind": "heading", "facts": [],
            "claim_type": "rule", "anchor": "EMA6C"}])


class MarkerChoicesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        bundles, _ = alb.assemble(book_config.load_book("g10-math"), FIX / "manifest.json",
                                  FIX / "objectives", FIX / "runs" / "lesson")
        cls.questions = bundles["g10m-c08.json"]["questions"]

    def test_the_spec_travels_in_choices_never_as_a_top_level_key(self):
        short = [q for q in self.questions if q["type"] == "short"]
        self.assertEqual(len(short), 5)
        self.assertTrue(all("marker" not in q and "marker" in q["choices"] for q in short))

    def test_question_row_writes_the_object_and_the_diff_compares_it_whole(self):
        q = Question.model_validate(next(x for x in self.questions if x["type"] == "short"))
        row = load_seed.question_row(q)
        self.assertEqual(set(row["choices"]), {"marker"})
        self.assertEqual(load_seed.question_diff(row, dict(row)), ([], []))
        changed = json.loads(json.dumps(row))
        changed["choices"]["marker"]["key"] = "(2, 1)"
        self.assertEqual(load_seed.question_diff(changed, row)[0], ["choices"])
        self.assertEqual(load_seed.merged_choices(row["choices"], None), row["choices"])


if __name__ == "__main__":
    unittest.main()
