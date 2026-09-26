"""coverage_report.py (B14, T345): the §3.11 integer equalities, GREEN or signed exceptions.

    uv run --with pytest python -m pytest -q tests/test_coverage_report.py

The Chapter 8 fixture is GREEN as written. Each test breaks one thing and shows the audit
names it, with the scope it failed in; a signed exception turns that failure GREEN and an
unsigned one does not. No database.
"""

from __future__ import annotations

import io
import contextlib
import json
import shutil
import tempfile
import unittest
from pathlib import Path

import _scratchdb  # noqa: F401
import assemble_lesson_bundle as alb
import coverage_report

FIX = Path(__file__).resolve().parent / "fixtures" / "g10-math"


class CoverageTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="coverage_test_")) / "g10-math"
        shutil.copytree(FIX, self.root)
        self.seed = self.root.parent / "seed"
        self.out = self.root.parent / "coverage" / "g10-math.json"

    def assemble(self):
        code = alb.main(["--book", "g10-math", "--manifest", str(self.root / "manifest.json"),
                         "--objectives", str(self.root / "objectives"),
                         "--runs", str(self.root / "runs" / "lesson"), "--out", str(self.seed)])
        self.assertEqual(code, 0)

    def audit(self, assemble=True) -> tuple[int, dict]:
        if assemble:
            with contextlib.redirect_stdout(io.StringIO()):
                self.assemble()
        r = self.root
        with contextlib.redirect_stdout(io.StringIO()):
            code = coverage_report.main([
                "--book", "g10-math", "--chapter", "8", "--manifest", str(r / "manifest.json"),
                "--objectives", str(r / "objectives"), "--runs", str(r / "runs" / "lesson"),
                "--seed", str(self.seed), "--generated", str(r / "generated"),
                "--maths", str(r / "maths-summary.json"), "--widget-gaps", str(r / "widget-gaps.json"),
                "--s5", str(r / "runs" / "misconceptions" / "s5-final.json"), "--out", str(self.out)])
        return code, json.loads(self.out.read_text())

    def edit(self, rel: str, fn) -> None:
        p = self.root / rel
        d = json.loads(p.read_text())
        fn(d)
        p.write_text(json.dumps(d, ensure_ascii=False, indent=2))

    def check(self, report: dict, cid: str) -> dict:
        return next(c for c in report["checks"] if c["id"] == cid)

    # ---- green --------------------------------------------------------------------
    def test_the_fixture_is_green_and_every_equality_is_counted(self):
        code, rep = self.audit()
        self.assertEqual((code, rep["status"]), (0, "GREEN"))
        self.assertEqual(rep["summary"], {"checks": 18, "hold": 18, "excepted": 0, "fail": 0})
        served = self.check(rep, "claims_served")
        self.assertEqual((served["want"], served["got"]), (served["want"], served["want"]))
        self.assertGreater(served["want"], 0)
        self.assertEqual({c["id"]: (c["want"], c["got"]) for c in rep["checks"]}["items_mapped_once"],
                         (15, 15))
        self.assertEqual(rep["widgets_per_chapter"], {"module:g10m-c08": 1})
        self.assertEqual(rep["refutations_per_misconception"]["mc:g10m8s4-1-1:halved-difference"], 2)
        self.assertGreater(rep["notation"]["items_printed_in_book_notation"], 0)

    def test_the_report_is_deterministic(self):
        _, first = self.audit()
        text = self.out.read_text()
        self.audit(assemble=False)
        self.assertEqual(self.out.read_text(), text)

    # ---- red, one equality at a time ----------------------------------------------------
    def test_an_unmapped_exercise_item_is_red(self):
        self.edit("manifest.json", lambda m: m["modules"][0]["end_of_chapter_exercise"]["item_refs"]
                  .append("Ex8-6:3"))
        code, rep = self.audit()
        self.assertEqual(code, 1)
        c = self.check(rep, "items_mapped_once")
        self.assertEqual((c["want"], c["got"], c["state"]), (16, 15, "fails"))
        self.assertIn("Ex8-6:3", c["failures"][0]["detail"])

    def test_an_item_g1_ruled_outside_the_chapters_objectives_is_a_named_exception(self):
        """Answer 15 (b): GREEN only because of the named G1 verdict; unapproved, it excepts nothing."""
        self.edit("manifest.json", lambda m: m["modules"][0]["end_of_chapter_exercise"]["item_refs"]
                  .append("Ex8-6:3"))
        ruling = {"item": "Ex8-6:3", "why": "asks for an area; the chapter teaches no area objective",
                  "by": "Samuel", "at": "2026-09-26T10:00:00+00:00"}
        self.edit("objectives/g10m8s1-1.json", lambda d: d.update(outside_items=[ruling]))
        code, rep = self.audit()
        self.assertEqual((code, rep["status"]), (0, "GREEN"))
        c = self.check(rep, "items_mapped_once")
        self.assertEqual((c["want"], c["got"], c["state"]), (16, 15, "excepted"))
        self.assertEqual(c["excepted_scopes"], ["item Ex8-6:3"])
        self.assertIn("ruled outside this chapter's objectives at G1 by Samuel", c["failures"][0]["detail"])
        self.assertEqual(rep["g1_exceptions"], [{"check": "items_mapped_once", "scope": "item Ex8-6:3",
                                                 "reason": ruling["why"], "signed_by": "Samuel",
                                                 "signed_at": ruling["at"],
                                                 "source": "G1 verdict outside_items (answer 15)"}])
        self.assertEqual(rep["summary"]["excepted"], 1)
        self.edit("objectives/g10m8s1-1.json", lambda d: d.update(outside_items=[dict(ruling, by=None, at=None)]))
        code, rep = self.audit()
        self.assertEqual((code, self.check(rep, "items_mapped_once")["state"]), (1, "fails"))
        self.assertIn("NO ONE", self.check(rep, "items_mapped_once")["failures"][0]["detail"])

    def test_a_missing_tier_names_the_objective(self):
        self.edit("generated/generated-questions.json",
                  lambda d: d.update(questions=[q for q in d["questions"]
                                                if q["id"] != "q:g10m8s3-2-2:g001-yesno"]))
        _, rep = self.audit()
        c = self.check(rep, "tier_floor")
        self.assertEqual(c["failures"], [{"scope": "lo:g10m8s3-2-2", "detail": "no live item at tier(s) basic"}])

    def test_a_held_book_question_does_not_fill_a_tier(self):
        # Ex8-6:1 is s2-1-1's only advanced item; hold it at G2
        self.edit("runs/lesson/g10m8s2-1.json", lambda d: next(
            i for i in d["items"] if i["ref"] == "Ex8-6:1").update(
            verification="disputed", blind_answer="12"))
        _, rep = self.audit()
        self.assertIn({"scope": "lo:g10m8s2-1-1", "detail": "no live item at tier(s) advanced"},
                      self.check(rep, "tier_floor")["failures"])

    def test_residual_notation_in_a_bundle_is_red(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assemble()
        p = self.seed / "g10m-c08.json"
        b = json.loads(p.read_text())
        b["visuals"][0]["caption"] = "The point (1; 2,5)."       # a hand edit after assembly
        p.write_text(json.dumps(b))
        _, rep = self.audit(assemble=False)
        c = self.check(rep, "notation")
        self.assertEqual((c["got"], c["state"]), (2, "fails"))

    def test_a_dropped_misconception_in_the_catalogue_is_red(self):
        self.edit("generated/misconceptions.json", lambda d: d["misconceptions"].append(
            {**d["misconceptions"][2], "id": "mc:g10m8s2-1-1:subtracts-in-wrong-order"}))
        _, rep = self.audit()
        self.assertIn("dropped by the verifier but in the catalogue",
                      self.check(rep, "s5_catalogue")["failures"][0]["detail"])

    def test_a_distractor_naming_an_unrefuted_misconception_is_red(self):
        self.edit("generated/misconceptions.json",
                  lambda d: d["misconceptions"][0].update(refutation=[]))
        _, rep = self.audit()
        self.assertEqual(self.check(rep, "distractor_refutations")["state"], "fails")
        self.assertEqual(self.check(rep, "misconception_refutations")["state"], "fails")

    def test_a_figure_with_no_visual_and_no_reasoned_gap_is_red(self):
        self.edit("runs/lesson/g10m8s2-1.json", lambda d: d["viz_gaps"][0].update(reason=""))
        _, rep = self.audit()
        f = self.check(rep, "figures")["failures"][0]
        self.assertEqual(f["scope"], "module:g10m-c08")     # per chapter: distributed items' figures
        self.assertIn("g10m8s2-1", f["detail"])

    def test_a_missing_s0b_summary_is_red(self):
        (self.root / "maths-summary.json").unlink()
        _, rep = self.audit()
        self.assertEqual(self.check(rep, "maths_images")["state"], "fails")

    def test_teacher_only_blocks_must_all_be_dropped(self):
        self.edit("runs/lesson/g10m8s1-1.json", lambda d: d["teacher_only"].update(dropped=1))
        _, rep = self.audit()
        self.assertEqual(self.check(rep, "teacher_only")["failures"][0]["scope"], "g10m8s1-1")

    def test_only_a_signed_chapter_scope_gap_covers_a_chapter_without_a_widget(self):
        # backlog 1: a lesson-scope gap records an accepted missing KIND; it never stands in for
        # the chapter's widget question (FR-4306)
        self.edit("generated/widget-questions.json", lambda d: d.update(questions=[]))
        gap = {"module": "module:g10m-c08", "lo_id": None, "sections": ["8.2"], "need_kind": "polygon_builder",
               "signed_off": {"by": "Samuel", "at": "2026-09-30", "note": "kind accepted as missing"}}
        self.edit("widget-gaps.json", lambda d: d.update(gaps=[{**gap, "scope": "lesson"}]))
        _, rep = self.audit()
        c = self.check(rep, "module_widgets")
        self.assertEqual((c["want"], c["got"], c["state"]), (1, 0, "fails"))
        self.edit("widget-gaps.json", lambda d: d.update(gaps=[{**gap, "scope": "chapter"}]))
        _, rep = self.audit()
        self.assertEqual(self.check(rep, "module_widgets")["state"], "holds")
        self.edit("widget-gaps.json", lambda d: d.update(gaps=[{**gap, "scope": "chapter", "signed_off": None}]))
        _, rep = self.audit()
        self.assertEqual(self.check(rep, "module_widgets")["state"], "fails", "an unsigned gap covers nothing")

    def test_maths_images_are_audited_for_the_chapter_and_count_the_third_reading(self):
        def queue_two(d):
            d["by_chapter"]["8"].update(accepted_by_agreement=70, accepted_by_third_reading=6, unresolved=2)
        self.edit("maths-summary.json", queue_two)
        _, rep = self.audit()
        c = self.check(rep, "maths_images")
        self.assertEqual((c["want"], c["got"], c["state"]), (120, 118, "fails"))
        self.assertEqual(c["failures"][0]["scope"], "chapter 8")
        self.assertIn("third_reading 6", c["notes"][0])
        self.edit("maths-summary.json", lambda d: d["by_chapter"].pop("8"))
        _, rep = self.audit()
        self.assertIn("no count for this chapter", self.check(rep, "maths_images")["failures"][0]["detail"])

    def test_a_lesson_whose_claims_have_no_content_file_is_red(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assemble()
        content = self.seed.parent / "content"
        (content / "g10m8s2-1.json").unlink()
        _, rep = self.audit(assemble=False)
        c = self.check(rep, "claims_served")
        self.assertEqual((c["state"], c["failures"][0]["scope"]), ("fails", "g10m8s2-1"))

    # ---- exceptions --------------------------------------------------------------------
    def test_a_signed_exception_turns_a_failure_green_and_an_unsigned_one_does_not(self):
        self.edit("generated/generated-questions.json",
                  lambda d: d.update(questions=[q for q in d["questions"]
                                                if q["id"] != "q:g10m8s3-2-2:g001-yesno"]))
        code, rep = self.audit()
        self.assertEqual(code, 1)
        exc = {"check": "tier_floor", "scope": "lo:g10m8s3-2-2", "reason": "no natural basic item"}
        self.out.write_text(json.dumps({**rep, "exceptions": [exc]}))
        code, rep = self.audit(assemble=False)
        self.assertEqual((code, rep["status"]), (1, "RED"), "an unsigned exception is ignored")
        self.out.write_text(json.dumps({**rep, "exceptions": [{**exc, "signed_by": "Samuel",
                                                               "signed_at": "2026-09-30"}]}))
        code, rep = self.audit(assemble=False)
        self.assertEqual((code, rep["status"]), (0, "GREEN"))
        self.assertEqual(self.check(rep, "tier_floor")["state"], "excepted")
        self.assertEqual(rep["exceptions"][0]["signed_by"], "Samuel", "a re-run keeps the list")


class ItemRefsTest(unittest.TestCase):
    def test_refs_rebuilt_from_the_scouting_manifest_counts(self):
        refs, derived = coverage_report.item_refs({"label": "8-2", "items_per_question": [1, 3]})
        self.assertTrue(derived)
        self.assertEqual(refs, ["Ex8-2:1", "Ex8-2:2a", "Ex8-2:2b", "Ex8-2:2c"])


if __name__ == "__main__":
    unittest.main()
