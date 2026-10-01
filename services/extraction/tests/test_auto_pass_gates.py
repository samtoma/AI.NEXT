"""Auto-passed widget gaps (G3), the audit's reading of them, and the completeness findings G5 hands Samuel.

    uv run --with pytest python -m pytest -q tests/test_auto_pass_gates.py

Samuel's answers 37c and 39 (2026-10-01): the fan-out's gates auto-pass on the AI checks' recommendation, every
auto-pass is recorded for him and is never a human stamp, and the automatic safety checks still block. Chapter 2
was the first chapter whose S7 author wrote no widget template at all, so it had no widget question and every
lesson was a gap; coverage's `module_widgets` wants a chapter-scope gap SIGNED. These tests pin:

  * G3 owns widget gaps: `auto_pass_gates.py g3 --widget-gaps` signs this chapter's chapter-scope gaps
    "auto-pass G3 (AI recommendation)", `auto: true`, and nothing else;
  * a person's sign-off is never overwritten, a re-run changes nothing, a chapter no author examined blocks,
    a lesson-scope gap is listed and not signed, and a proposed kind is NEVER approved by it (decision 11);
  * G5 puts every completeness finding (an objective with no claim, an empty tier cell) and every scope that holds
    only on an auto-pass in its record as a decision line of its own, because the console shows `decisions` and
    `checks` to Samuel and ignores `for_review`;
  * review_policy's live rule, which the audit and the loaders share.

No database, no model.

@covers FR-4306, FR-4509, FR-4305
"""

from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

import _scratchdb  # noqa: F401
import auto_pass_gates as apg
import book_config
import review_policy

MATHS = "course:us-g10-math-en"


class LiveRule(unittest.TestCase):
    """review_policy.generated_item_is_live / book_item_is_live — one rule for the audit and the loaders."""

    def test_a_generated_row_with_no_status_is_live_exactly_when_the_course_is_maths(self):
        row = {"id": "q:g10m2s2-1-1:g001"}
        self.assertTrue(review_policy.generated_item_is_live(row, MATHS))
        self.assertTrue(review_policy.generated_item_is_live(row, "course:prep3-math-en"))
        self.assertFalse(review_policy.generated_item_is_live(row, "course:prep3-social-ar"))
        self.assertFalse(review_policy.generated_item_is_live(row, "course:prep3-arabic-ar"))
        self.assertFalse(review_policy.generated_item_is_live(row, "course:nobody-knows"), "an unknown course is not full")
        self.assertFalse(review_policy.generated_item_is_live(row, None))

    def test_a_row_that_says_what_it_is_is_believed(self):
        self.assertTrue(review_policy.generated_item_is_live({"status": "live"}, "course:prep3-social-ar"))
        for status in ("review", "retired", "rejected"):
            self.assertFalse(review_policy.generated_item_is_live({"status": status}, MATHS), status)
        # a hold reason is a hold, whatever the status says: a live row never keeps one (the CHECK) — a row that does is wrong
        self.assertFalse(review_policy.generated_item_is_live({"status": "live", "hold_reason": "katex_error"}, MATHS))
        self.assertFalse(review_policy.generated_item_is_live({"hold_reason": "human_hold"}, MATHS))

    def test_a_book_question_is_live_when_g2_kept_it_and_no_check_holds_it(self):
        self.assertTrue(review_policy.book_item_is_live({"verified": True}))
        self.assertFalse(review_policy.book_item_is_live({"verified": True, "hold_reason": "figure_reveals_answer"}))
        self.assertFalse(review_policy.book_item_is_live({"verified": False, "hold_reason": "answer_mismatch"}))
        self.assertFalse(review_policy.book_item_is_live({}))


def gap(lo: str | None, *, module: str = "module:g10m-c02", kind: str = "base_matcher", scope: str = "chapter",
        signed_off: dict | None = None, why: str = "no existing kind builds it") -> dict:
    return {"module": module, "lo_id": lo, "need_kind": kind, "description": "d", "why": why, "source": "t.json",
            "signed_off": signed_off, "scope": scope}


def report(*gaps: dict) -> dict:
    return {"format": "ainext.widget-gaps/1", "book": "g10-math", "course_id": MATHS, "gaps": list(gaps)}


HUMAN = {"by": "Samuel Toma", "at": "2026-10-01T09:00:00Z", "note": "accepted"}


class WidgetGapAutoPass(unittest.TestCase):
    def setUp(self):
        self.book = book_config.load_book("g10-math")

    def run_it(self, rep: dict, chapter: int = 2):
        return apg.widget_gap_decisions(rep, self.book, chapter, at="2026-10-01T12:00:00Z")

    def test_this_chapters_chapter_scope_gaps_are_signed_as_an_auto_pass_and_nothing_else_is(self):
        rep = report(gap("lo:g10m2s2-1-1"), gap("lo:g10m2s2-1-2", kind="base_reducer"),
                     gap("lo:g10m8s1-1-1", module="module:g10m-c08"),        # another chapter's: untouched
                     gap(None, module="module:g10m-c01", kind="unexamined"))  # another chapter's, never examined: untouched
        out, decisions, blocked, counts = self.run_it(rep)
        self.assertEqual(blocked, [])
        signed = [g["signed_off"] for g in out["gaps"][:2]]
        for so in signed:
            self.assertEqual({k: so[k] for k in ("by", "auto", "at")},
                             {"by": "auto-pass G3 (AI recommendation)", "auto": True, "at": "2026-10-01T12:00:00Z"})
            self.assertIn("no new kind is approved", so["note"])
        self.assertEqual([g["signed_off"] for g in out["gaps"][2:]], [None, None])
        self.assertEqual(counts, {"signed": 2, "kept_auto": 0, "kept_human": 0, "lesson_scope": 0, "kinds": 2})
        self.assertEqual([d["key"] for d in decisions], ["widget gap lo:g10m2s2-1-1", "widget gap lo:g10m2s2-1-2"])
        self.assertTrue(all("NOT approved, needs Samuel (decision 11)" in d["detail"] for d in decisions))
        self.assertEqual(rep["gaps"][0]["signed_off"], None, "the input report is not edited in place")

    def test_a_person_is_never_overwritten_and_a_rerun_changes_nothing(self):
        rep = report(gap("lo:g10m2s2-1-1", signed_off=HUMAN), gap("lo:g10m2s2-1-2"))
        out, decisions, _, counts = self.run_it(rep)
        self.assertEqual(out["gaps"][0]["signed_off"], HUMAN)
        self.assertEqual(counts["kept_human"], 1)
        self.assertIn("already signed by Samuel Toma", decisions[0]["decision"])
        again, _, _, counts2 = apg.widget_gap_decisions(out, self.book, 2, at="2099-01-01T00:00:00Z")
        self.assertEqual(again, out, "idempotent: not even `at` moves")
        self.assertEqual((counts2["signed"], counts2["kept_auto"], counts2["kept_human"]), (0, 1, 1))

    def test_a_chapter_nobody_examined_blocks_and_signs_nothing(self):
        rep = report(gap(None, kind="unexamined", why="no widget question, and no author recorded a gap for this chapter"))
        out, decisions, blocked, counts = self.run_it(rep)
        self.assertEqual(len(blocked), 1)
        self.assertIn("S7 never examined it", blocked[0])
        self.assertEqual((decisions, out["gaps"][0]["signed_off"], counts["signed"]), ([], None, 0))

    def test_a_lesson_scope_gap_is_listed_not_signed(self):
        """The chapter has widgets: a gap records a missing KIND for one lesson and covers nothing."""
        rep = report(gap("lo:g10m2s2-1-1", scope="lesson"))
        out, decisions, blocked, counts = self.run_it(rep)
        self.assertEqual((blocked, out["gaps"][0]["signed_off"], counts["lesson_scope"], counts["signed"]),
                         ([], None, 1, 0))
        self.assertIn("not signed", decisions[0]["decision"])

    def test_a_gap_is_found_by_its_module_or_its_objective(self):
        for g in (gap("lo:g10m2s2-1-1", module="module:g10m-c02"), gap("lo:g10m2s2-1-1", module=""),
                  gap(None, module="module:g10m-c02")):
            self.assertEqual(apg.gap_chapter(g, ["g10m"]), 2, g)
        self.assertEqual(apg.gap_chapter(gap("lo:g10m12s1-1-1", module="module:g10m-c12"), ["g10m"]), 12)
        self.assertIsNone(apg.gap_chapter(gap(None, module="module:prep3-m02"), ["g10m"]))

    def test_the_cli_signs_the_file_records_it_for_samuel_and_never_approves_a_kind(self):
        d = Path(tempfile.mkdtemp(prefix="gap_cli_"))
        (d / "q.json").write_text(json.dumps({"bundle": "b.json", "question_ids": ["q:g10m2s2-1-1:g001"]}))
        (d / "gaps.json").write_text(json.dumps(report(gap("lo:g10m2s2-1-1"), gap("lo:g10m2s2-1-2", kind="base_reducer"),
                                                       gap("lo:g10m8s1-1-1", module="module:g10m-c08")), indent=2))
        argv = ["g3", "g10-math", "--chapter", "2", "--queue", str(d / "q.json"), "--widget-gaps", str(d / "gaps.json"),
                "--gates-dir", str(d / "gates"), "--out", str(d / "g3.auto.json")]
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(apg.main(argv), 0)
        self.assertIn("2 signed by the auto-pass", out.getvalue())
        self.assertIn("2 proposed kind(s) listed for Samuel, none approved", out.getvalue())
        gaps = json.loads((d / "gaps.json").read_text())["gaps"]
        self.assertEqual([g["signed_off"] is not None for g in gaps], [True, True, False])
        rec = json.loads((d / "gates" / "g3-ch02.json").read_text())
        self.assertEqual((rec["gate"], rec["auto"], rec["by"], rec["outcome"], rec["blocked"]),
                         ("G3", True, "auto-pass G3 (AI recommendation)", "pass_with_holds", []))
        lines = {x["key"]: x for x in rec["decisions"]}
        self.assertEqual(lines["widget gap lo:g10m2s2-1-2"]["decision"], "accepted without a widget for now (auto-pass)")
        self.assertEqual(len(rec["for_review"]), 2)
        self.assertTrue(all("needs your approval before anything is built" in r for r in rec["for_review"]))
        self.assertIn("widget gaps (auto-passed)", [e["label"] for e in rec["evidence"]])
        # a second run: the file is byte-identical (nothing re-signed), the record says the same
        before = (d / "gaps.json").read_text()
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(apg.main(argv), 0)
        self.assertEqual((d / "gaps.json").read_text(), before)

    def test_the_cli_blocks_on_an_unexamined_chapter_and_leaves_the_file_alone(self):
        d = Path(tempfile.mkdtemp(prefix="gap_cli_"))
        (d / "q.json").write_text(json.dumps({"bundle": "b.json", "question_ids": []}))
        text = json.dumps(report(gap(None, kind="unexamined")), indent=2)
        (d / "gaps.json").write_text(text)
        argv = ["g3", "g10-math", "--chapter", "2", "--queue", str(d / "q.json"), "--widget-gaps", str(d / "gaps.json"),
                "--gates-dir", str(d / "gates"), "--out", str(d / "g3.auto.json")]
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()) as err:
            self.assertEqual(apg.main(argv), 1)
        self.assertIn("BLOCKED widget gaps", err.getvalue())
        self.assertEqual((d / "gaps.json").read_text(), text)
        rec = json.loads((d / "gates" / "g3-ch02.json").read_text())
        self.assertEqual(rec["outcome"], "blocked")
        self.assertIn("widget gaps NOT auto-passed", rec["summary"])

    def test_widget_gaps_need_a_chapter(self):
        d = Path(tempfile.mkdtemp(prefix="gap_cli_"))
        (d / "q.json").write_text(json.dumps({"question_ids": []}))
        (d / "gaps.json").write_text(json.dumps(report()))
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as cm:
            apg.main(["g3", "g10-math", "--queue", str(d / "q.json"), "--widget-gaps", str(d / "gaps.json"),
                      "--gates-dir", str(d / "gates"), "--out", str(d / "o.json")])
        self.assertEqual(cm.exception.code, 2)


class G5Findings(unittest.TestCase):
    COV = {"status": "RED", "checks": [
        {"id": "objective_evidence", "state": "fails", "want": 9, "got": 8,
         "failures": [{"scope": "lo:g10m2s4-1-4", "detail": "no claim"}]},
        {"id": "tier_floor", "state": "fails", "want": 27, "got": 26,
         "failures": [{"scope": "lo:g10m2s4-1-1", "detail": "no live item at tier(s) advanced"}]},
        {"id": "module_widgets", "state": "auto_passed", "want": 1, "got": 1, "failures": [],
         "auto_passed": [{"scope": "module:g10m-c02", "by": "auto-pass G3 (AI recommendation)", "at": "t",
                          "detail": "no widget question; 9 widget gap(s) of the chapter were AUTO-PASSED"}]},
        {"id": "katex", "state": "holds", "want": 0, "got": 0, "failures": []}]}

    def test_every_completeness_finding_and_auto_pass_is_a_decision_line_the_console_shows(self):
        lines = {l["key"]: l for l in apg.g5_findings(self.COV)}
        self.assertEqual(set(lines), {"objective_evidence lo:g10m2s4-1-4", "tier_floor lo:g10m2s4-1-1",
                                      "module_widgets module:g10m-c02"})
        self.assertEqual(lines["objective_evidence lo:g10m2s4-1-4"]["detail"], "no claim")
        self.assertIn("for Samuel, not fixed", lines["tier_floor lo:g10m2s4-1-1"]["decision"])
        self.assertIn("never a human sign-off", lines["module_widgets module:g10m-c02"]["decision"])

    def test_a_failing_safety_check_is_blocked_not_a_finding(self):
        cov = {"checks": [{"id": "katex", "state": "fails", "want": 0, "got": 1,
                           "failures": [{"scope": "q:1", "detail": "bad TeX"}]}]}
        self.assertEqual(apg.g5_findings(cov), [])
        blocked, _, _ = apg.g5_evaluate(cov, [("course:prep3-math-en", "GREEN", [])])
        self.assertEqual(len(blocked), 1)

    def test_an_auto_passed_check_passes_but_is_listed_for_samuel_and_named_in_the_check_line(self):
        blocked, review, checks = apg.g5_evaluate(self.COV, [("course:prep3-math-en", "GREEN", [])])
        self.assertEqual(blocked, [], "completeness findings and an auto-pass never block (answer 37c)")
        self.assertEqual(len(review), 3)
        self.assertTrue(any("module_widgets holds only on an auto-pass" in r for r in review))
        line = next(c for c in checks if c["name"] == "coverage module_widgets")
        self.assertEqual(line["state"], "auto_passed")
        self.assertIn("AUTO-PASSED by auto-pass G3 (AI recommendation) — not a human sign-off", line["detail"])


if __name__ == "__main__":
    unittest.main()
