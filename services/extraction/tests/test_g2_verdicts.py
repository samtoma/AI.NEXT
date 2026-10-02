"""G2's verdicts reach the database (integration backlog 3): apply_review_verdicts.py --g2.

    AINEXT_TEST_PG="host=127.0.0.1 port=5432" uv run --with pytest python -m pytest -q tests/test_g2_verdicts.py

The loader records a verified book question as AI-checked only (`ai_checked_by` 'ai dual-check',
migration 035). Samuel's G2 verdicts live in one committed file; `--g2` carries each to the question id
the assembler minted, so the database says who read it: accept/fix go live with the reviewer's stamp
(and nothing else in `reviewed_by`), hold goes back to review as a human hold, exclude rejects a row
loaded earlier, a worked example is reported (it is no question row), and a second run changes nothing.
An AUTO-passed verdict (answer 37c) never reaches `reviewed_by`.

@covers FR-4302
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from _scratchdb import EX, ScratchDB, run_loader, skip_without_db
import assemble_lesson_bundle as alb
import book_config

FIX = Path(__file__).resolve().parent / "fixtures" / "g10-math"
G10 = "course:us-g10-math-en"


@skip_without_db()
class G2Apply(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = ScratchDB("g2").create()
        cls.tmp = Path(tempfile.mkdtemp(prefix="g2_test_"))
        bundles, _ = alb.assemble(book_config.load_book("g10-math"), FIX / "manifest.json",
                                  FIX / "objectives", FIX / "runs" / "lesson")
        paths = []
        for name, b in bundles.items():
            (cls.tmp / name).write_text(alb.dump(b))
            paths.append(str(cls.tmp / name))
        run_loader(cls.db.dsn, *sorted(paths, key=lambda p: "course" not in p), "--course", G10)

    @classmethod
    def tearDownClass(cls):
        cls.db.drop()

    def apply(self, g2: dict, *extra: str) -> subprocess.CompletedProcess:
        p = self.tmp / "g2.json"
        p.write_text(json.dumps(g2))
        env = dict(os.environ, AINEXT_DB_DSN=self.db.dsn)
        return subprocess.run([sys.executable, str(EX / "apply_review_verdicts.py"), "--g2", str(p),
                               "--book", "g10-math", "--runs", str(FIX / "runs" / "lesson"), *extra],
                              capture_output=True, text=True, env=env, cwd=EX)

    def row(self, qid: str):
        return self.db.q("SELECT status, reviewed_by FROM questions WHERE id = %s", (qid,))[0]

    def row35(self, qid: str):
        return self.db.q("SELECT status, reviewed_by, hold_reason, review_note, ai_checked_by FROM questions "
                         "WHERE id = %s", (qid,))[0]

    def restore(self, qid: str, snapshot: tuple):
        self.db.q("UPDATE questions SET status = %s, reviewed_by = %s, hold_reason = %s, review_note = %s, "
                  "ai_checked_by = %s WHERE id = %s", (*snapshot, qid))

    def test_verdicts_reach_the_rows_and_a_rerun_changes_nothing(self):
        accepted, held = "q:g10m8s2-1-1:ex8-2-2a", "q:g10m8s2-1-1:ex8-2-1"
        self.assertEqual(self.row(held)[0], "live")
        g2 = {"by": "Samuel", "items": {
            "g10m8s2-1:Ex8-2:2a": {"verdict": "accept", "note": "the book's surd form is right"},
            "g10m8s2-1:Ex8-2:1": {"verdict": "hold", "note": "check the printed answer"},
            "g10m8s1-1:Ex8-1:3": {"verdict": "accept"}}}           # a worked example: no question row
        dry = self.apply(g2, "--dry-run")
        self.assertEqual(dry.returncode, 0, dry.stderr)
        self.assertIn("would stamp 1 live, hold 1 at review", dry.stdout)
        self.assertEqual(self.row(held)[0], "live", "a dry run writes nothing")
        r = self.apply(g2)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.row(accepted), ("live", "Samuel (G2 accept)"))
        self.assertEqual(self.row35(held)[:3], ("review", "Samuel (G2 hold)", "human_hold"))
        self.assertEqual(self.row35(held)[4], "ai dual-check", "the AI check stays recorded beside the human's")
        self.assertIn("1 verdict(s) on worked examples", r.stdout)
        again = self.apply(g2)
        self.assertIn("stamp 0 live, hold 0 at review, reject 0, keep 0 at review for a missing figure; "
                      "2 already as recorded", again.stdout)

    def test_an_accepted_question_whose_figure_is_missing_stays_at_review(self):
        # consistency review A3: G2's accept is recorded, but a stem that shows [figure] with no figure is not live
        qid = "q:g10m8s2-1-1:ex8-6-1"
        self.db.q("UPDATE questions SET stem = stem || ' [figure]' WHERE id = %s", (qid,))
        before = self.row35(qid)
        try:
            r = self.apply({"by": "Samuel", "items": {"g10m8s2-1:Ex8-6:1": {"verdict": "accept"}}})
            self.assertEqual(r.returncode, 0, r.stderr)
            # migration 035: the human's stamp is the stamp; why it is held is hold_reason's job
            self.assertEqual(self.row35(qid)[:3], ("review", "Samuel (G2 accept)", "figure_missing"))
            self.assertIn("keep 1 at review for a missing figure", r.stdout)
            # a book-picture stand-in (answer 37d) IS its figure: the verdict now puts it live
            lo = self.db.one("SELECT lo_id FROM questions WHERE id = %s", (qid,))
            self.db.q("INSERT INTO visuals (id, lo_id, question_id, kind, spec) VALUES (%s, %s, %s, 'book_image', %s)",
                      ("v:g10m8s2-1:bk-ex8-6-1", lo, qid, json.dumps({"src": "/book-figures/g10-math/x.png",
                                                                     "alt": "a", "stand_in": True,
                                                                     "native_kind_needed": None})))
            r = self.apply({"by": "Samuel", "items": {"g10m8s2-1:Ex8-6:1": {"verdict": "accept"}}})
            self.assertEqual(self.row35(qid)[:3], ("live", "Samuel (G2 accept)", None))
        finally:
            self.db.q("DELETE FROM visuals WHERE id = 'v:g10m8s2-1:bk-ex8-6-1'")
            self.db.q("UPDATE questions SET stem = replace(stem, ' [figure]', '') WHERE id = %s", (qid,))
            self.restore(qid, before)

    def test_a_fix_someone_else_applied_keeps_the_reviewers_own_verdict(self):
        # 2026-09-27: Samuel ACCEPTED Ex8-2:2a; the orchestrator then fixed its stem. The stamp says both, apart —
        # never "Samuel (G2 fix)" for a fix he did not make
        qid = "q:g10m8s2-1-1:ex8-2-2a"
        before = self.row35(qid)
        self.addCleanup(self.restore, qid, before)
        g2 = {"by": "Samuel", "items": {"g10m8s2-1:Ex8-2:2a": {
            "verdict": "fix", "samuel_verdict": "accept", "stem_fix_by": "orchestrator (data-engineer agent), 2026-09-27",
            "fields": {}}}}
        r = self.apply(g2)
        self.assertEqual(r.returncode, 0, r.stderr)
        # migration 035: the human stamp is the reviewer's own verdict; who else changed the item is a NOTE
        self.assertEqual(self.row35(qid)[:4], ("live", "Samuel (G2 accept)", None,
                                               "stem fixed by orchestrator (data-engineer agent), 2026-09-27"))
        # and the lesson runs carry the same attribution into the item's g2 record
        import assemble_objectives as ao
        lesson = json.loads((FIX / "runs" / "lesson" / "g10m8s2-1.json").read_text())
        run = {"stage": "S2-S4,S8", "prompts_version": "lesson-v4", "lessons": [lesson]}
        fixed = {"by": "Samuel", "items": {"g10m8s2-1:Ex8-2:2a": {
            "verdict": "fix", "samuel_verdict": "accept", "stem_fix_by": "orchestrator", "fields": {}}}}
        out = ao.lesson_runs(run, fixed, draft=True)
        g2rec = next(i["g2"] for i in out["g10m8s2-1"]["items"] if i["ref"] == "Ex8-2:2a")
        self.assertEqual((g2rec["by"], g2rec["reviewer_verdict"], g2rec["stem_fix_by"]), ("Samuel", "accept", "orchestrator"))

    def test_an_auto_passed_verdict_is_never_a_human_stamp(self):
        # answer 37c: an auto verdict (auto_pass_gates.py g2) goes to ai_checked_by; reviewed_by is untouched,
        # and an auto "hold" is held as unverified — only a human's hold is human_hold
        acc, held = "q:g10m8s2-1-1:ex8-2-2a", "q:g10m8s2-1-1:ex8-2-1"
        before = {q: self.row35(q) for q in (acc, held)}
        for q, snap in before.items():
            self.addCleanup(self.restore, q, snap)
        self.db.q("UPDATE questions SET reviewed_by = NULL, review_note = NULL WHERE id = ANY(%s)", ([acc, held],))
        by = "auto-pass G2 (AI recommendation)"
        r = self.apply({"by": "Samuel", "items": {
            "g10m8s2-1:Ex8-2:2a": {"verdict": "accept", "auto": True, "by": by},
            "g10m8s2-1:Ex8-2:1": {"verdict": "hold", "auto": True, "by": by}}})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.row35(acc), ("live", None, None, None, f"{by} (G2 accept)"))
        self.assertEqual(self.row35(held), ("review", None, "unverified", None, f"{by} (G2 hold)"))

    def test_an_unnamed_reviewer_or_an_unknown_item_writes_nothing(self):
        before = self.db.q("SELECT id, status, reviewed_by FROM questions ORDER BY id")
        r = self.apply({"items": {"g10m8s2-1:Ex8-2:2a": {"verdict": "accept"}}})
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("reviewer", r.stderr + r.stdout)
        r = self.apply({"by": "Samuel", "items": {"g10m8s2-1:Ex8-2:2a": {"verdict": "accept"},
                                                  "g10m8s2-1:Ex8-2:99": {"verdict": "accept"}}})
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("is not an item of lesson g10m8s2-1", r.stderr + r.stdout)
        self.assertEqual(self.db.q("SELECT id, status, reviewed_by FROM questions ORDER BY id"), before)


if __name__ == "__main__":
    unittest.main()
