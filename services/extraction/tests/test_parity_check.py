"""parity_check.py per course (B10, G10): a second maths course cannot move Prep-3's fingerprint.

    AINEXT_TEST_PG="host=127.0.0.1 port=5432" uv run python -m unittest discover -s tests -p 'test_parity*' -v

@covers FR-4207
"""

from __future__ import annotations

import contextlib
import io
import tempfile
import unittest
from pathlib import Path

from _scratchdb import ScratchDB, mini_course, run_loader, skip_without_db, write_bundle

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


class ConstantsTest(unittest.TestCase):
    def test_prep3_constant_is_the_one_this_script_always_meant(self):
        import parity_check
        self.assertEqual(parity_check.EXPECTED, {"modules": 10, "learning_objectives": 90,
                                                 "prerequisite_edges": 112,
                                                 "questions_total": 450, "visuals": 212})
        self.assertTrue(parity_check.expected_for(PREP3).require_all_live)


if __name__ == "__main__":
    unittest.main()
