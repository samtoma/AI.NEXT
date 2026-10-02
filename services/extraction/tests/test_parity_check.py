"""parity_check.py per course (B10, G10): a second maths course cannot move Prep-3's fingerprint.

    AINEXT_TEST_PG="host=127.0.0.1 port=5432" uv run python -m unittest discover -s tests -p 'test_parity*' -v

@covers FR-4207

The drift guard counts SERVABLE rows only (Samuel, 2026-10-02, decision 66): see the
`ServableOnlyTest` class below, and parity_check.py's docstring.
"""

from __future__ import annotations

import contextlib
import io
import re
import tempfile
import unittest
from pathlib import Path

import book_config
from _scratchdb import REPO, ScratchDB, mini_course, run_loader, skip_without_db, write_bundle

PREP3 = "course:prep3-math-en"


@skip_without_db()
class PerCourseParityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = ScratchDB("parity").create()
        run_loader(cls.db.dsn, "--all", "--course", PREP3)
        tmp = Path(tempfile.mkdtemp(prefix="parity_test_"))
        run_loader(cls.db.dsn, str(write_bundle(tmp, "g10", mini_course("zz", "course:zz-g10-math-en"))),
                   "--course", "course:zz-g10-math-en")
        # A second MATHS course — the Grade 10 situation. The loader stamps a
        # subject only for configured books, so set it the way a config would.
        cls.db.q("UPDATE graph_nodes SET subject = 'math' WHERE id = 'course:zz-g10-math-en'")
        cls.db.q("UPDATE questions SET status = 'live'")          # ADR-0019: the maths bank is live

    @classmethod
    def tearDownClass(cls):
        cls.db.drop()

    def test_prep3_constant_holds_with_a_second_maths_course_loaded(self):
        import parity_check
        fp = parity_check.fingerprint(self.db.dsn, PREP3)
        self.assertEqual(parity_check.check_expected(fp, parity_check.expected_for(PREP3)), [])
        self.assertEqual((fp.modules, fp.learning_objectives, fp.prerequisite_edges,
                          fp.questions_total, fp.visuals), (10, 90, 112, 450, 212))

    def test_the_old_subject_scope_would_have_gone_red(self):
        # What parity_check counted before B10: every objective whose course has
        # subject 'math'. With a second maths course that is 90 + 3.
        n = self.db.one("SELECT count(*) FROM node_subject WHERE subject = 'math'")
        self.assertEqual(n, 93)

    def test_each_course_is_fingerprinted_on_its_own(self):
        import parity_check
        fp = parity_check.fingerprint(self.db.dsn, "course:zz-g10-math-en")
        self.assertEqual((fp.modules, fp.learning_objectives, fp.prerequisite_edges,
                          fp.questions_total, fp.visuals), (1, 3, 1, 4, 1))
        prep3 = parity_check.fingerprint(self.db.dsn, PREP3)
        self.assertNotEqual(fp.source_sha256, prep3.source_sha256,
                            "a course's fingerprint must name its own book, not the first one loaded")

    def test_a_course_without_a_constant_is_an_error_not_green(self):
        import parity_check
        err = io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
            code, _ = parity_check.check_course("course:zz-g10-math-en", self.db.dsn, None)
        self.assertEqual(code, 2)
        self.assertIn("no parity constant", err.getvalue())

    def test_drift_is_red(self):
        import parity_check
        self.db.q("UPDATE questions SET status = 'review' WHERE id = 'q:u1-1-1:001'")
        try:
            fp = parity_check.fingerprint(self.db.dsn, PREP3)
            problems = parity_check.check_expected(fp, parity_check.expected_for(PREP3))
            self.assertTrue(any("questions_live" in p for p in problems))
        finally:
            self.db.q("UPDATE questions SET status = 'live' WHERE id = 'q:u1-1-1:001'")


ZZ = "course:zz-servable-en"
Q_WITH_VISUAL_A, Q_WITH_VISUAL_B = "q:zz1-1-1:002", "q:zz1-1-2:001"      # each carries a visual below
Q_PLAIN = "q:zz1-2-1:001"                                                # no visual
Q_FIRST = "q:zz1-1-1:001"                                                # no visual


def _servable_bundle() -> dict:
    """mini_course + two visuals tied to questions (a lesson figure with no question is already there)."""
    b = mini_course("zz", ZZ)
    b["visuals"] += [
        {"id": "v:zz1-1:002", "lo": "lo:zz1-1-1", "question": Q_WITH_VISUAL_A, "kind": "number_line",
         "spec": {"min": 0, "max": 10}, "caption": "a line", "source_page": 1},
        {"id": "v:zz1-1:003", "lo": "lo:zz1-1-2", "question": Q_WITH_VISUAL_B, "kind": "number_line",
         "spec": {"min": 0, "max": 10}, "caption": "a line", "source_page": 2},
    ]
    return b


def _parity(questions_total: int, visuals: int, *, require_all_live: bool = False) -> "book_config.Parity":
    return book_config.Parity(modules=1, learning_objectives=3, prerequisite_edges=1,
                              questions_total=questions_total, visuals=visuals,
                              require_all_live=require_all_live)


@skip_without_db()
class ServableOnlyTest(unittest.TestCase):
    """Parity counts the questions a student could be served, and the visuals attached to them.

    Samuel, 2026-10-02: a G2 `exclude` rejects a row an earlier load inserted, and the assembled
    bundle (the expected side) no longer carries it; the row stays for the audit trail. Counting
    it made chapter 5's G5 RED (1433 vs 1392 questions, 212 vs 209 visuals).
    """

    @classmethod
    def setUpClass(cls):
        cls.db = ScratchDB("paritysv").create()
        tmp = Path(tempfile.mkdtemp(prefix="parity_servable_"))
        run_loader(cls.db.dsn, str(write_bundle(tmp, "zz", _servable_bundle())), "--course", ZZ)

    @classmethod
    def tearDownClass(cls):
        cls.db.drop()

    def setUp(self):
        self.db.q("DELETE FROM questions WHERE id LIKE 'q:zz-extra:%'")
        self.db.q("UPDATE questions SET status = 'live'")

    def fp(self):
        import parity_check
        return parity_check.fingerprint(self.db.dsn, ZZ)

    def problems(self, parity):
        import parity_check
        return parity_check.check_expected(self.fp(), parity)

    def set_status(self, qid: str, status: str):
        self.db.q("UPDATE questions SET status = %s WHERE id = %s", (status, qid))

    def test_nothing_taken_out_counts_everything(self):
        fp = self.fp()
        self.assertEqual((fp.questions_total, fp.questions_live, fp.visuals), (4, 4, 3))
        self.assertEqual(self.problems(_parity(4, 3, require_all_live=True)), [])

    def test_a_rejected_question_and_its_visual_do_not_count_but_stay_in_the_database(self):
        self.set_status(Q_WITH_VISUAL_A, "rejected")
        fp = self.fp()
        self.assertEqual((fp.questions_total, fp.questions_live, fp.visuals), (3, 3, 2))
        # the audit trail: nothing was deleted
        self.assertEqual(self.db.one("SELECT count(*) FROM questions WHERE lo_id IN "
                                     "('lo:zz1-1-1','lo:zz1-1-2','lo:zz1-2-1')"), 4)
        self.assertEqual(self.db.one("SELECT count(*) FROM visuals WHERE id LIKE 'v:zz1-1:%'"), 3)

    def test_a_retired_question_and_its_visual_do_not_count(self):
        self.set_status(Q_WITH_VISUAL_B, "retired")
        fp = self.fp()
        self.assertEqual((fp.questions_total, fp.visuals), (3, 2))

    def test_a_rejected_question_with_no_visual_leaves_the_visuals_alone(self):
        self.set_status(Q_PLAIN, "rejected")
        fp = self.fp()
        self.assertEqual((fp.questions_total, fp.visuals), (3, 3))

    def test_draft_review_and_live_all_count(self):
        self.set_status(Q_FIRST, "draft")
        self.set_status(Q_PLAIN, "review")
        self.set_status(Q_WITH_VISUAL_A, "live")
        self.set_status(Q_WITH_VISUAL_B, "live")
        fp = self.fp()
        self.assertEqual((fp.questions_total, fp.questions_live, fp.visuals), (4, 2, 3))

    def test_a_visual_with_no_question_counts_even_when_every_question_is_out(self):
        for q in (Q_FIRST, Q_PLAIN, Q_WITH_VISUAL_A, Q_WITH_VISUAL_B):
            self.set_status(q, "rejected")
        fp = self.fp()
        self.assertEqual((fp.questions_total, fp.visuals), (0, 1))   # the lesson figure v:zz1-1:001

    def test_the_g10_case_rows_the_bundles_left_out_do_not_make_the_course_red(self):
        # The assembled bundles hold 3 questions and 2 visuals (the excluded exercise and its book
        # picture are not in them); the database still has them, rejected.
        self.set_status(Q_WITH_VISUAL_A, "rejected")
        self.assertEqual(self.problems(_parity(3, 2)), [])
        self.assertEqual(self.problems(_parity(3, 2, require_all_live=True)), [],
                         "a rejected row is not a demotion: live equals total")

    def test_a_row_the_bundles_serve_but_the_database_rejected_is_red(self):
        self.set_status(Q_WITH_VISUAL_A, "rejected")
        problems = self.problems(_parity(4, 3))      # the bundle still says serve it
        self.assertTrue(any(p.startswith("questions_total: 3 != expected 4") for p in problems), problems)
        self.assertTrue(any(p.startswith("visuals: 2 != expected 3") for p in problems), problems)

    def test_an_extra_servable_row_is_red_and_an_extra_rejected_row_is_not(self):
        self.db.q("INSERT INTO questions (id, lo_id, tier, question_type, stem, correct_answer, "
                  "canonical_solution, status, source) VALUES "
                  "('q:zz-extra:001', 'lo:zz1-1-1', 'basic', 'numeric', 'x', '1', '[]'::jsonb, 'live', 'seed')")
        red = self.problems(_parity(4, 3))
        self.assertTrue(any(p.startswith("questions_total: 5 != expected 4") for p in red), red)
        self.set_status("q:zz-extra:001", "rejected")
        self.assertEqual(self.problems(_parity(4, 3)), [])

    def test_a_servable_row_the_bundles_hold_but_the_database_lacks_is_red(self):
        red = self.problems(_parity(5, 4))           # a question and a visual the load never inserted
        self.assertTrue(any(p.startswith("questions_total: 4 != expected 5") for p in red), red)
        self.assertTrue(any(p.startswith("visuals: 3 != expected 4") for p in red), red)

    def test_a_demotion_to_review_is_still_red_for_a_course_that_requires_all_live(self):
        self.set_status(Q_PLAIN, "review")
        red = self.problems(_parity(4, 3, require_all_live=True))
        self.assertTrue(any("questions_live" in p for p in red), red)

    def test_the_rendered_fingerprint_says_it_counts_servable_rows(self):
        import parity_check
        self.assertIn("servable only", parity_check.render("candidate", self.fp()))


class ServableStatusesTest(unittest.TestCase):
    """No database needed: the status vocabulary the guard classifies is the schema's."""

    def test_every_schema_status_is_classified(self):
        import parity_check
        schema = (REPO / "db" / "schema.sql").read_text()
        m = re.search(r"status\s+TEXT NOT NULL DEFAULT 'draft' CHECK \(status IN\s*\(([^)]*)\)\)", schema)
        self.assertIsNotNone(m, "the questions.status CHECK moved: update this test and parity_check.SERVABLE")
        statuses = set(re.findall(r"'([a-z]+)'", m.group(1)))
        self.assertEqual(statuses, {"draft", "review", "live", "rejected", "retired"},
                         "a new question status needs a decision: is it servable? (parity_check.SERVABLE)")
        self.assertEqual(set(parity_check.UNSERVABLE_STATUSES), {"rejected", "retired"})
        self.assertEqual(parity_check.SERVABLE, "status NOT IN ('rejected', 'retired')")


class ConstantsTest(unittest.TestCase):
    def test_prep3_constant_is_the_one_this_script_always_meant(self):
        import parity_check
        self.assertEqual(parity_check.EXPECTED, {"modules": 10, "learning_objectives": 90,
                                                 "prerequisite_edges": 112,
                                                 "questions_total": 450, "visuals": 212})
        self.assertTrue(parity_check.expected_for(PREP3).require_all_live)


if __name__ == "__main__":
    unittest.main()
