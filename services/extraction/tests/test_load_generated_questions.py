"""load_generated_questions.py takes the v2 line's bundles (integration backlog 2, B12/B13).

    AINEXT_TEST_PG="host=127.0.0.1 port=5432" uv run --with pytest python -m pytest -q tests/test_load_generated_questions.py

What the S6/S7 bundles need from the loader, and what it must never do:
  * a typed maths answer — `short` with `choices = {"marker": …}` — loads, and one without a
    valid marker spec is refused (FR-4320's spec is what the app marks against);
  * the family is read from the `family` field first; a field that disagrees with the note the
    database keeps is refused, because a review verdict travels to the family by that note;
  * a fresh bundle is checked against the LOADED catalogue: a tag naming an unknown entry is
    refused, a declared entry on another objective is refused, and `--catalogue-only` refuses a
    declared entry S5 never produced;
  * a catalogue entry is never edited by this loader: its label, description and generated_by
    stay the catalogue loader's.

@covers FR-4304, FR-4320
"""

from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

from _scratchdb import ScratchDB, run_loader, skip_without_db
import assemble_lesson_bundle as alb
import book_config
import load_generated_questions as L
from test_export_generated_content import run_main

FIX = Path(__file__).resolve().parent / "fixtures" / "g10-math"
G10 = "course:us-g10-math-en"
MC = "mc:g10m8s2-1-1:forgot-square-root"


def typed(qid="q:g10m8s2-1-1:g001-surd", family="tpl:g10m8s2-1-1:surd", marker=None) -> dict:
    return {"id": qid, "lo_id": "lo:g10m8s2-1-1", "tier": "standard", "question_type": "short",
            "stem": "Find the distance between $(0, 0)$ and $(2, 2)$ in simplest surd form.",
            "choices": {"marker": marker if marker is not None else
                        {"kind": "surd", "key": "2\\sqrt{2}", "form": "simplest", "variables": []}},
            "correct_answer": "2\\sqrt{2}",
            "canonical_solution": [{"step": 1, "text_md": "$d = \\sqrt{2^2 + 2^2} = 2\\sqrt{2}$"}],
            "parent_question_id": "q:g10m8s2-1-1:ex8-2-1", "source_page": 292,
            "source_note": f"Generated from template family {family}.", "family": family}


def mcq(qid="q:g10m8s2-1-1:g001-dist", tag=MC, family="tpl:g10m8s2-1-1:dist") -> dict:
    return {"id": qid, "lo_id": "lo:g10m8s2-1-1", "tier": "basic", "question_type": "mcq",
            "stem": "The distance between $(0, 0)$ and $(3, 4)$ is",
            "choices": [{"key": "A", "text": "$5$"}, {"key": "B", "text": "$25$", "misconception_id": tag},
                        {"key": "C", "text": "$7$"}],
            "correct_answer": "A", "canonical_solution": [{"step": 1, "text_md": "$\\sqrt{9 + 16} = 5$"}],
            "parent_question_id": "q:g10m8s2-1-1:ex8-2-1", "source_page": 292,
            "source_note": f"Generated from template family {family}.", "family": family}


class Validate(unittest.TestCase):
    def test_a_typed_answer_needs_its_marker_spec(self):
        self.assertEqual(L.validate({"questions": [typed()]})[0], [])
        problems, _ = L.validate({"questions": [typed(marker={"kind": "surd"})]})
        self.assertTrue(any("marker spec" in p for p in problems), problems)
        bad = typed()
        bad["choices"] = [{"key": "A", "text": "x"}]
        self.assertTrue(L.validate({"questions": [bad]})[0])

    def test_the_family_field_wins_and_must_agree_with_the_note(self):
        q = typed()
        self.assertEqual(L.family_of(q), "tpl:g10m8s2-1-1:surd")
        legacy = dict(q)
        legacy.pop("family")
        self.assertEqual(L.family_of(legacy), "tpl:g10m8s2-1-1:surd", "the legacy note still reads")
        q["family"] = "tpl:g10m8s2-1-1:other"
        problems, _ = L.validate({"questions": [q]})
        self.assertTrue(any("disagrees with its source_note" in p for p in problems))


class TheAppsMarker(unittest.TestCase):
    @unittest.skipUnless(__import__("shutil").which("node"), "the marker check runs answer-marker.ts in node")
    def test_a_key_the_app_cannot_mark_refuses_a_fresh_load(self):
        import subprocess
        import sys
        with tempfile.TemporaryDirectory() as d:
            p = Path(d, "b.json")
            p.write_text(json.dumps({"generator": "t", "misconceptions": [], "questions": [
                typed(marker={"kind": "expression", "key": "y = 1 3 x", "variables": ["x", "y"]})]}))
            r = subprocess.run([sys.executable, "load_generated_questions.py", str(p), "--dry-run", "--sample", "0"],
                               capture_output=True, text=True, cwd=Path(L.__file__).parent)
        self.assertEqual(r.returncode, 1)
        self.assertIn("cannot mark its key", r.stderr)


@skip_without_db()
class AgainstTheCatalogue(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = ScratchDB("genq").create()
        cls.tmp = Path(tempfile.mkdtemp(prefix="genq_test_"))
        bundles, _ = alb.assemble(book_config.load_book("g10-math"), FIX / "manifest.json",
                                  FIX / "objectives", FIX / "runs" / "lesson")
        paths = []
        for name, b in bundles.items():
            (cls.tmp / name).write_text(alb.dump(b))
            paths.append(str(cls.tmp / name))
        run_loader(cls.db.dsn, *sorted(paths, key=lambda p: "course" not in p), "--course", G10)
        code, out = run_main("load_misconceptions", [str(FIX / "generated" / "misconceptions.json")], cls.db.dsn)
        assert code == 0, out
        cls.db.q("UPDATE misconceptions SET generated_by = 'S5 author (test)' WHERE id = %s", (MC,))

    @classmethod
    def tearDownClass(cls):
        cls.db.drop()

    def load(self, bundle: dict, *extra: str) -> tuple[int, str]:
        p = self.tmp / f"b{abs(hash(json.dumps(bundle, sort_keys=True)))}.json"
        p.write_text(json.dumps(bundle))
        return run_main("load_generated_questions", [str(p), "--sample", "0", *extra], self.db.dsn)

    def test_a_typed_answer_loads_with_its_spec_and_its_family(self):
        code, out = self.load({"generator": "S6 test", "questions": [typed()], "misconceptions": []},
                              "--course", G10)
        self.assertEqual(code, 0, out)
        choices, note, status = self.db.q("SELECT choices, source_note, status FROM questions WHERE id = %s",
                                          ("q:g10m8s2-1-1:g001-surd",))[0]
        self.assertEqual(choices["marker"]["kind"], "surd")
        self.assertIn("template family tpl:g10m8s2-1-1:surd", note)
        self.assertEqual(status, "review")

    def test_an_unknown_tag_is_refused_and_nothing_is_written(self):
        code, out = self.load({"generator": "S6 test", "questions": [mcq(qid="q:g10m8s2-1-1:g002-x",
                                                                        tag="mc:g10m8s2-1-1:never-written")],
                               "misconceptions": []})
        self.assertEqual(code, 1)
        self.assertIn("unknown misconception", out)
        self.assertIsNone(self.db.one("SELECT 1 FROM questions WHERE id = 'q:g10m8s2-1-1:g002-x'"))

    def test_a_declared_entry_never_edits_the_catalogue(self):
        before = self.db.q("SELECT label, description, generated_by FROM misconceptions WHERE id = %s", (MC,))
        declared = {"id": MC, "lo_id": "lo:g10m8s2-1-1", "label": "a rewritten label", "description": "new"}
        code, out = self.load({"generator": "question generator (test)", "questions": [mcq()],
                               "misconceptions": [declared]})
        self.assertEqual(code, 0, out)
        self.assertEqual(self.db.q("SELECT label, description, generated_by FROM misconceptions WHERE id = %s",
                                   (MC,)), before)
        self.assertIn("left exactly as they are", out)

    def test_a_declared_entry_on_another_objective_or_unknown_to_s5_is_refused(self):
        moved = {"id": MC, "lo_id": "lo:g10m8s3-1-1", "label": "l", "description": "d"}
        code, out = self.load({"generator": "t", "questions": [mcq(qid="q:g10m8s2-1-1:g003-y")],
                               "misconceptions": [moved]})
        self.assertEqual(code, 1)
        self.assertIn("the catalogue on lo:g10m8s2-1-1", out)
        new = {"id": "mc:g10m8s2-1-1:brand-new", "lo_id": "lo:g10m8s2-1-1", "label": "l", "description": "d"}
        code, out = self.load({"generator": "t", "questions": [mcq(qid="q:g10m8s2-1-1:g004-z",
                                                                  tag="mc:g10m8s2-1-1:brand-new")],
                               "misconceptions": [new]}, "--catalogue-only")
        self.assertEqual(code, 1)
        self.assertIn("not in the loaded catalogue", out)


if __name__ == "__main__":
    unittest.main()
