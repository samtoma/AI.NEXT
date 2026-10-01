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

    def run_main(self, chapter: int | None = 8) -> tuple[int, str, str]:
        """coverage_report.main() as the pipeline calls it (the whole book when `chapter` is None), with its
        stdout and stderr."""
        r = self.root
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = coverage_report.main([
                "--book", "g10-math", *(["--chapter", str(chapter)] if chapter else []), "--manifest", str(r / "manifest.json"),
                "--objectives", str(r / "objectives"), "--runs", str(r / "runs" / "lesson"),
                "--seed", str(self.seed), "--generated", str(r / "generated"),
                "--maths", str(r / "maths-summary.json"), "--widget-gaps", str(r / "widget-gaps.json"),
                "--s5", str(r / "runs" / "misconceptions" / "s5-final.json"), "--out", str(self.out)])
        return code, out.getvalue(), err.getvalue()

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
        # 18 + the consistency review's katex (A2), answer_text (A1) and asked_forms (A9), captions, and
        # answer 37d's book_pictures
        self.assertEqual(rep["summary"], {"checks": 23, "hold": 23, "excepted": 0, "fail": 0})
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

    def test_a_glued_latex_command_is_respaced_and_katex_is_the_judge(self):
        # consistency review A2: S0b stores whitespace-stripped LaTeX ("\\triangleABC", "\\timesm", "\\m"); the
        # assembly re-spaces it and the app's KaTeX then parses every student-facing segment
        self.edit("runs/lesson/g10m8s2-1.json", lambda d: d["items"][0].update(
            stem=d["items"][0]["stem"] + r" Area of $\triangleABC$, $2\timesm$, $x=3\m$ and "
                 r"$x_{1}=-2y_{1}=-5x_{2}=7y_{2}=-2$."))
        _, rep = self.audit()
        self.assertEqual(self.check(rep, "katex")["got"], 0)
        b = json.loads((self.seed / "g10m-c08.json").read_text())
        stem = next(q["stem"] for q in b["questions"] if r"\triangle ABC" in q["stem"])
        self.assertIn(r"2\times m", stem)
        self.assertIn(r"x=3\ m", stem)
        self.assertIn(r"x_{1}=-2 \quad y_{1}=-5 \quad x_{2}=7 \quad y_{2}=-2", stem)
        # a hand edit after assembly that KaTeX refuses is red
        p = self.seed / "g10m-c08.json"
        b["questions"][0]["stem"] += r" $\frac{1}{$"
        p.write_text(json.dumps(b))
        _, rep = self.audit(assemble=False)
        self.assertEqual(self.check(rep, "katex")["got"], 1)

    def test_a_caption_never_shows_a_withheld_point(self):
        # 2026-09-27: "with the midpoint M marked on it" beside a figure that withholds M; the assembly drops the clause
        def withhold(d):
            v = d["visuals"][0]
            v["withheld"] = ["M"]
            v["caption"] = "Points A and B are joined by a segment, with the midpoint M marked on it for you to find."
        self.edit("runs/lesson/g10m8s2-1.json", withhold)
        _, rep = self.audit()
        self.assertEqual(self.check(rep, "captions")["got"], 0)
        b = json.loads((self.seed / "g10m-c08.json").read_text())
        self.assertIn("Points A and B are joined by a segment.", [v["caption"] for v in b["visuals"]])
        # a hand edit after assembly that says M is shown again is red
        p = self.seed / "g10m-c08.json"
        v = next(v for v in b["visuals"] if v["caption"] == "Points A and B are joined by a segment.")
        v["caption"] += " Tick marks show where M falls."
        p.write_text(json.dumps(b))
        _, rep = self.audit(assemble=False)
        self.assertEqual(self.check(rep, "captions")["got"], 1)

    def test_the_answer_text_is_the_marker_key_rendered(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assemble()
        p = self.seed / "g10m-c08.json"
        b = json.loads(p.read_text())
        q = next(q for q in b["questions"] if isinstance(q.get("choices"), dict) and "marker" in q["choices"])
        q["answer"] = "9 11"                                   # the PDF's text layer for 9/11 (A1)
        p.write_text(json.dumps(b))
        _, rep = self.audit(assemble=False)
        self.assertEqual(self.check(rep, "answer_text")["got"], 1)

    def test_a_figures_point_labels_are_normalised_at_assembly(self):
        # the Chapter 8 pilot: coordinate plots labelled points "P(2;1)" — 107 spans the audit caught
        self.edit("runs/lesson/g10m8s2-1.json", lambda d: d["visuals"][0].update(
            spec={**(d["visuals"][0].get("spec") or {}), "points": [{"x": 2, "y": 1, "label": "P(2;1)"}]}))
        _, rep = self.audit()
        self.assertEqual(self.check(rep, "notation")["got"], 0)
        b = json.loads((self.seed / "g10m-c08.json").read_text())
        labels = [p["label"] for v in b["visuals"] for p in (v.get("spec") or {}).get("points") or []]
        self.assertIn("P(2, 1)", labels)

    def test_a_held_mappings_reviewer_prose_is_not_app_notation(self):
        # decision 47: `pending_review` carries the blind verifier's reason for the human reviewer, never shown
        # in the app — "{3,9}" there is not a decimal comma the app would show. A shown field still counts.
        def hold(d):
            q = d["questions"][0]
            q["choices"]["pending_review"] = [{"predicate": "off-target", "misconception_id": "mc:x:y",
                                               "why": "{3,9} is the whole answer set"}]
        self.edit("generated/widget-questions.json", hold)
        _, rep = self.audit()
        self.assertEqual(self.check(rep, "notation")["got"], 0)
        self.edit("generated/widget-questions.json", lambda d: d["questions"][0].update(stem="Mark 3,9."))
        _, rep = self.audit()
        self.assertEqual(self.check(rep, "notation")["got"], 1)

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

    # ---- which generated items are live: the loader's rule, not the bundle's (2026-10-01, Chapter 2) ------------
    def strip_status(self, course_id: str | None = "course:us-g10-math-en") -> None:
        """What the generator writes: no `status` on any row (the loader decides it)."""
        for f in ("generated-questions.json", "widget-questions.json"):
            def go(d, course_id=course_id):
                for q in d["questions"]:
                    q.pop("status", None)
                    q.pop("reviewed_by", None)
                    q.pop("reviewed_at", None)
                if course_id:
                    d["course_id"] = course_id
            self.edit(f"generated/{f}", go)

    def test_a_generated_bundle_with_no_status_is_live_for_a_maths_course(self):
        """The Chapter 2 finding: the report counted only rows that say `status: live`, and a bundle straight from the
        generator says nothing, so 11 filled cells read as empty. A maths course loads its whole bundle live (answer
        37a, review_policy.students_always_full): the report must count what the loader will make live."""
        _, before = self.audit()
        want = {c["id"]: (c["want"], c["got"]) for c in before["checks"]}
        self.strip_status()
        code, rep = self.audit(assemble=False)
        self.assertEqual((code, rep["status"]), (0, "GREEN"))
        self.assertEqual({c["id"]: (c["want"], c["got"]) for c in rep["checks"]}, want)
        self.assertEqual(rep["widgets_per_chapter"], {"module:g10m-c08": 1}, "a widget row with no status is live too")
        self.assertIn("by the loader's rule", self.check(rep, "tier_floor")["notes"][0])

    def test_the_same_bundle_is_not_live_for_a_course_that_is_not_maths(self):
        """Social Studies and Arabic keep their review queue: a row with no status there is awaiting a human."""
        self.strip_status(course_id="course:prep3-social-ar")
        _, rep = self.audit()
        c = self.check(rep, "tier_floor")
        self.assertEqual(c["state"], "fails")
        self.assertIn({"scope": "lo:g10m8s3-2-2", "detail": "no live item at tier(s) basic, advanced"}, c["failures"])
        self.assertEqual(self.check(rep, "module_widgets")["state"], "fails")

    def test_an_exported_row_that_is_held_retired_or_in_review_is_not_live(self):
        """An export says what each loaded row is, and is believed over the course's default."""
        def hold(d):
            by = {q["id"]: q for q in d["questions"]}
            by["q:g10m8s3-2-2:g001-yesno"]["status"] = "retired"        # a human retired the family
            by["q:g10m8s3-2-2:g002-find-k"]["hold_reason"] = "katex_error"   # an automatic check holds it
            by["q:g10m8s3-2-1:g001-perp"]["status"] = "review"
        self.edit("generated/generated-questions.json", hold)
        _, rep = self.audit()
        scopes = {(f["scope"], f["detail"]) for f in self.check(rep, "tier_floor")["failures"]}
        self.assertEqual(scopes, {("lo:g10m8s3-2-2", "no live item at tier(s) basic, advanced"),
                                  ("lo:g10m8s3-2-1", "no live item at tier(s) standard")})

    def test_the_one_genuinely_empty_cell_still_fails_when_the_bundle_has_no_status(self):
        """The fix must not turn the report green: a cell no row fills is named, with or without a status."""
        self.strip_status()
        self.edit("generated/generated-questions.json",
                  lambda d: d.update(questions=[q for q in d["questions"] if q["id"] != "q:g10m8s3-2-2:g001-yesno"]))
        code, rep = self.audit()
        c = self.check(rep, "tier_floor")
        self.assertEqual((code, c["state"]), (1, "fails"))
        self.assertEqual(c["failures"], [{"scope": "lo:g10m8s3-2-2", "detail": "no live item at tier(s) basic"}])

    def test_a_book_question_a_check_holds_does_not_fill_a_tier_even_when_verified(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assemble()
        p = self.seed / "g10m-c08.json"
        b = json.loads(p.read_text())
        q = next(q for q in b["questions"] if q["lo"] == "lo:g10m8s2-1-1" and q["tier"] == "advanced")
        self.assertTrue(q["verified"])
        q["hold_reason"] = "katex_error"
        p.write_text(json.dumps(b))
        _, rep = self.audit(assemble=False)
        self.assertIn({"scope": "lo:g10m8s2-1-1", "detail": "no live item at tier(s) advanced"},
                      self.check(rep, "tier_floor")["failures"])

    # ---- a chapter's widget gap an auto-pass signed (answer 37c): counted, named, never a person's ----------------
    AUTO = {"by": "auto-pass G3 (AI recommendation)", "auto": True, "at": "2026-10-01T10:00:00Z", "note": "n"}

    def gap_only(self, signed_off, scope="chapter") -> None:
        """The chapter has no widget question; its one gap carries `signed_off`."""
        self.edit("generated/widget-questions.json", lambda d: d.update(questions=[]))
        gap = {"module": "module:g10m-c08", "lo_id": "lo:g10m8s1-1-1", "need_kind": "vertex-set plotter",
               "scope": scope, "signed_off": signed_off}
        self.edit("widget-gaps.json", lambda d: d.update(gaps=[gap]))

    def test_an_auto_passed_chapter_gap_covers_the_chapter_and_the_report_says_so(self):
        self.gap_only(self.AUTO)
        code, rep = self.audit()
        c = self.check(rep, "module_widgets")
        self.assertEqual((code, rep["status"], c["state"], c["want"], c["got"]), (0, "GREEN", "auto_passed", 1, 1))
        self.assertEqual(c["failures"], [])
        self.assertEqual([(a["scope"], a["by"], a["at"]) for a in c["auto_passed"]],
                         [("module:g10m-c08", "auto-pass G3 (AI recommendation)", "2026-10-01T10:00:00Z")])
        self.assertIn("not signed by a person", c["auto_passed"][0]["detail"])
        self.assertEqual(rep["widgets_per_chapter"], {"module:g10m-c08": 0}, "still no widget question")
        self.assertEqual(rep["summary"], {"checks": 23, "hold": 22, "excepted": 0, "auto_passed": 1, "fail": 0})
        self.assertEqual(rep["auto_passed"], [{"check": "module_widgets", "scope": "module:g10m-c08",
                                               "by": "auto-pass G3 (AI recommendation)", "at": "2026-10-01T10:00:00Z"}])
        text = self.out.read_text()
        self.audit(assemble=False)
        self.assertEqual(self.out.read_text(), text, "an auto sign-off keeps the report deterministic")

    def test_a_signoff_that_says_it_is_automatic_is_never_a_persons(self):
        # the stamp alone, the flag alone: either marks it
        for so in ({"by": "auto-pass G3 (AI recommendation)", "at": "x"}, {"by": "Samuel", "auto": True, "at": "x"}):
            self.gap_only(so)
            _, rep = self.audit()
            self.assertEqual(self.check(rep, "module_widgets")["state"], "auto_passed", so)
        # a person's holds outright, with no auto_passed anywhere
        self.gap_only({"by": "Samuel", "at": "2026-10-01", "note": "kind accepted as missing"})
        _, rep = self.audit()
        self.assertEqual(self.check(rep, "module_widgets")["state"], "holds")
        self.assertNotIn("auto_passed", rep)
        self.assertNotIn("auto_passed", rep["summary"])

    def test_a_person_beats_an_auto_pass_on_the_same_chapter(self):
        self.gap_only(self.AUTO)
        gaps = json.loads((self.root / "widget-gaps.json").read_text())["gaps"]
        human = dict(gaps[0], lo_id="lo:g10m8s2-1-1", signed_off={"by": "Samuel", "at": "2026-10-01"})
        self.edit("widget-gaps.json", lambda d: d.update(gaps=gaps + [human]))
        _, rep = self.audit()
        self.assertEqual(self.check(rep, "module_widgets")["state"], "holds")

    def test_an_auto_passed_lesson_scope_gap_covers_no_chapter(self):
        self.gap_only(self.AUTO, scope="lesson")
        _, rep = self.audit()
        self.assertEqual(self.check(rep, "module_widgets")["state"], "fails")

    def test_an_unsigned_gap_still_covers_nothing(self):
        self.gap_only(None)
        code, rep = self.audit()
        self.assertEqual((code, self.check(rep, "module_widgets")["state"]), (1, "fails"))

    # ---- a --chapter audit refuses another chapter's generated directory (the Chapter 2 s5_catalogue false alarm) ------
    def to_chapter(self, rel: str, n: int, key: str = "questions", only_first: bool = False) -> None:
        def go(d):
            rows = d[key][:1] if only_first else d[key]
            for r in rows:
                r["lo_id"] = r["lo_id"].replace("g10m8", f"g10m{n}")
        self.edit(rel, go)

    def test_a_chapter_audit_reads_its_own_bundles_and_the_whole_book_audit_reads_them_all(self):
        """The seed directory holds every chapter assembled so far. Chapter 2's audit counted chapters 1–4's questions
        ("940 book questions") and would have gone RED on a defect in chapter 3's bundle."""
        with contextlib.redirect_stdout(io.StringIO()):
            self.assemble()
        _, alone = self.audit(assemble=False)
        want = {c["id"]: (c["want"], c["got"]) for c in alone["checks"]}
        b = json.loads((self.seed / "g10m-c08.json").read_text())
        other = json.loads(json.dumps(b))
        for l in other["lessons"]:
            l["slug"] = l["slug"].replace("g10m8", "g10m9")
        for q in other["questions"]:
            q["solution_provenance"] = None                    # a defect in the OTHER chapter's bundle
        other["questions"][0]["stem"] += r" $\frac{1}{$"       # and a KaTeX error in it
        (self.seed / "g10m-c09.json").write_text(json.dumps(other))
        code, out, _ = self.run_main(chapter=8)
        rep = json.loads(self.out.read_text())
        self.assertEqual((code, rep["status"]), (0, "GREEN"))
        self.assertEqual({c["id"]: (c["want"], c["got"]) for c in rep["checks"]}, want)
        self.assertNotIn("seed/g10m-c09.json", rep["inputs"], "so its re-assembly never changes this chapter's report")
        self.assertIn("with none of chapter(s) [8]'s lessons are not audited here (g10m-c09.json, g10m-course.json)", out)
        # the whole-book audit reads every bundle: the same defect is RED there
        code, _, _ = self.run_main(chapter=None)
        rep = json.loads(self.out.read_text())
        self.assertEqual(code, 1)
        self.assertEqual({c["id"] for c in rep["checks"] if c["state"] == "fails"}, {"solution_sources", "katex"})
        # and a defect in THIS chapter's own bundle is still RED for the chapter
        p = self.seed / "g10m-c08.json"
        b["questions"][0]["solution_provenance"] = None
        p.write_text(json.dumps(b))
        code, _, _ = self.run_main(chapter=8)
        self.assertEqual(code, 1)
        self.assertEqual(self.check(json.loads(self.out.read_text()), "solution_sources")["state"], "fails")

    def test_a_chapter_audit_refuses_a_generated_directory_that_holds_no_row_of_the_chapter(self):
        for f, key in (("generated-questions", "questions"), ("widget-questions", "questions"),
                       ("misconceptions", "misconceptions")):
            self.to_chapter(f"generated/{f}.json", 9, key)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assemble()
        code, out, err = self.run_main()
        self.assertEqual(code, 2)
        self.assertFalse(self.out.exists(), "a refused audit writes no report")
        self.assertEqual(err.count("REFUSING"), 3)
        self.assertIn("another chapter's", err)
        self.assertIn("chapter(s) [9] and none of chapter(s) [8]", err)
        self.assertIn("--generated seed/generated/<book>/chNN", err)

    def test_a_directory_holding_the_chapter_and_others_is_audited_with_a_warning(self):
        def add_other(d):
            d["questions"].append({**d["questions"][0], "id": "q:g10m9s1-1-1:x", "lo_id": "lo:g10m9s1-1-1"})
        self.edit("generated/generated-questions.json", add_other)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assemble()
        code, out, err = self.run_main()
        self.assertEqual((code, err), (0, ""))
        rep = json.loads(self.out.read_text())
        self.assertEqual(len(rep["warnings"]), 1)
        self.assertIn("also holds rows of chapter(s) [9]", rep["warnings"][0])
        self.assertIn("! generated-questions.json also holds", out)

    def test_an_empty_generated_bundle_is_not_another_chapters(self):
        """A chapter whose S6 wrote no family has an empty bundle: nothing foreign was read."""
        self.edit("generated/generated-questions.json", lambda d: d.update(questions=[]))
        with contextlib.redirect_stdout(io.StringIO()):
            self.assemble()
        code, _, err = self.run_main()
        self.assertNotEqual(code, 2)
        self.assertEqual(err, "")
        self.assertNotIn("warnings", json.loads(self.out.read_text()))

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
