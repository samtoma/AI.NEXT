"""G2's two new question fields (Chapter 8, 2026-09-26; decisions 41 and 43; pipeline-handoff.md):

  * `less_specific` — a multiple-choice question whose key is the most specific answer, while other
    options are also true, less precisely: choices = {"options": [...], "less_specific": [keys]}.
    The app returns such a pick for re-entry and never marks it wrong (FR-4320's re-entry rule).
  * `answer_only` — a marked expression question with no book working: {"marker": {...},
    "answer_only": true}. The tutor gives no step-by-step explanation.

Checked where they are written (the run item), assembled (the bundle), validated (schemas, so the
loader) and stored (the loader's jsonb shape, misconception stamps kept).

    uv run --with pytest python -m pytest -q tests/test_g2_choices.py

@covers FR-4320, FR-4302
"""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
EX = HERE.parent
for p in (str(EX), str(HERE)):
    if p not in sys.path:
        sys.path.insert(0, p)

import assemble_lesson_bundle as alb  # noqa: E402
import assemble_objectives as ao  # noqa: E402
import book_config  # noqa: E402
import load_seed  # noqa: E402
import schemas  # noqa: E402

FIX = HERE / "fixtures" / "g10-math"
OPTS = [{"key": "A", "text": "square"}, {"key": "B", "text": "rectangle"},
        {"key": "C", "text": "rhombus"}, {"key": "D", "text": "trapezium"}]


def question(**kw) -> dict:
    q = {"id": "q:g10m8s3-2-2:ex8-6-42e", "lo": "lo:g10m8s3-2-2", "tier": "standard", "type": "mcq",
         "stem": "What type of quadrilateral is ABCD?", "answer": "A", "solution": ["It is a square."],
         "source_page": 1, "source_note": "x",
         "choices": {"options": OPTS, "less_specific": ["B", "C"]}}
    q.update(kw)
    return q


class Schema(unittest.TestCase):
    def test_less_specific_names_other_existing_options(self):
        q = schemas.Question.model_validate(question())
        self.assertIsInstance(q.choices, schemas.McqChoices)
        for bad, why in ((dict(choices={"options": OPTS, "less_specific": ["E"]}), "names no option"),
                         (dict(choices={"options": OPTS, "less_specific": ["A", "B"]}), "most specific"),
                         (dict(choices={"options": OPTS, "less_specific": ["B", "B"]}), "repeats"),
                         (dict(choices={"options": OPTS, "less_specific": []}), "at least 1"),
                         (dict(type="short", choices={"options": OPTS, "less_specific": ["B"]}), "mcq")):
            with self.assertRaisesRegex(Exception, why):
                schemas.Question.model_validate(question(**bad))
        plain = schemas.Question.model_validate(question(choices=OPTS))       # an ordinary mcq keeps its list
        self.assertIsInstance(plain.choices, list)

    def test_answer_only_is_true_on_a_marker_spec_or_absent(self):
        spec = {"kind": "surd", "key": "\\sqrt{34}", "form": None, "variables": [], "tolerance": None}
        q = schemas.Question.model_validate(question(type="short", answer="√34",
                                                     choices={"marker": spec, "answer_only": True}))
        self.assertTrue(q.choices.answer_only)
        with self.assertRaises(Exception):
            schemas.Question.model_validate(question(type="short", answer="√34",
                                                     choices={"marker": spec, "answer_only": False}))

    def test_the_loader_stores_them_and_leaves_every_other_question_as_it_was(self):
        spec = {"kind": "surd", "key": "\\sqrt{34}", "form": None, "variables": [], "tolerance": None}
        plain = schemas.Question.model_validate(question(type="short", answer="√34", choices={"marker": spec}))
        self.assertEqual(load_seed.bundle_choices_json(plain), {"marker": spec}, "no answer_only key added")
        only = schemas.Question.model_validate(question(type="short", answer="√34",
                                                        choices={"marker": spec, "answer_only": True}))
        self.assertEqual(load_seed.bundle_choices_json(only), {"marker": spec, "answer_only": True})
        mcq = schemas.Question.model_validate(question())
        stored = load_seed.bundle_choices_json(mcq)
        self.assertEqual(stored, {"options": OPTS, "less_specific": ["B", "C"]})
        # a misconception stamp in the database is kept on a re-load, and is not a material change
        db = {"options": [dict(OPTS[0]), dict(OPTS[1], misconception_id="mc:x"), *OPTS[2:]], "less_specific": ["B", "C"]}
        merged = load_seed.merged_choices(stored, db)
        self.assertEqual(merged["options"][1]["misconception_id"], "mc:x")
        self.assertEqual(load_seed._choice_pairs(merged), load_seed._choice_pairs(stored))


class RunItemAndAssembly(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name) / "g10-math"
        shutil.copytree(FIX, self.root)
        self.run_path = self.root / "runs" / "lesson" / "g10m8s1-1.json"
        self.run = json.loads(self.run_path.read_text())

    def tearDown(self):
        self._tmp.cleanup()

    def item(self, ref):
        return next(i for i in self.run["items"] if i["ref"] == ref)

    def assemble(self):
        self.run_path.write_text(json.dumps(self.run))
        return alb.assemble(book_config.load_book("g10-math"), self.root / "manifest.json",
                            self.root / "objectives", self.root / "runs" / "lesson", None)

    def test_less_specific_is_validated_on_the_item_and_assembled_into_the_choices(self):
        it = self.item("Ex8-1:1")            # key A 'a rectangle'; B 'a rhombus', C 'a kite'
        for bad in (["D"], ["A"], []):
            it["less_specific"] = bad
            with self.assertRaises(Exception):
                alb.RunItem.model_validate(it)
        it["less_specific"] = ["B"]
        bundles, _ = self.assemble()
        q = next(q for b in bundles.values() for q in b.get("questions", []) if q["id"].endswith("ex8-1-1"))
        self.assertEqual(q["choices"]["less_specific"], ["B"])
        self.assertEqual([c["key"] for c in q["choices"]["options"]], ["A", "B", "C"])
        schemas.Question.model_validate(q)

    def test_answer_only_needs_the_key_agreed_by_printed_and_blind(self):
        it = self.item("Ex8-1:2")            # expression, printed (1; 2) = blind (1; 2)
        it["answer_only"] = True
        with self.assertRaisesRegex(Exception, "printed answer AND the blind"):
            alb.RunItem.model_validate(it)   # no recorded blind~printed agreement
        it["verify"] = {"pairs": [{"pair_id": "Ex8-1:2|blind~printed", "route": "normalised", "verdict": "equivalent"}]}
        alb.RunItem.model_validate(it)
        bundles, _ = self.assemble()
        q = next(q for b in bundles.values() for q in b.get("questions", []) if q["id"].endswith("ex8-1-2"))
        self.assertIs(q["choices"]["answer_only"], True)
        self.assertIn("marker", q["choices"])
        it["verify"]["pairs"][0]["verdict"] = "different"
        with self.assertRaises(Exception):
            alb.RunItem.model_validate(it)
        choice = dict(self.item("Ex8-1:1"), answer_only=True)
        with self.assertRaisesRegex(Exception, "expression item only"):
            alb.RunItem.model_validate(choice)

    def test_an_answer_only_fix_leaves_the_books_solution_alone(self):
        run = {"prompts_version": "lesson-v4", "stage": "S2-S4,S8", "lessons": [dict(self.run, lesson="g10m8s1-1")]}
        g2 = {"by": "Samuel Toma", "items": {"g10m8s1-1:Ex8-1:2": {"verdict": "fix",
              "fields": {"answer_only": True, "solution": ["written by someone"]}}}}
        with self.assertRaisesRegex(ao.StageError, "solution as it is"):
            ao.lesson_runs(run, g2)


if __name__ == "__main__":
    unittest.main()
