"""load_seed.py course loads (B9, G9): add-only by default, student data never lost.

    AINEXT_TEST_PG="host=127.0.0.1 port=5432" uv run python -m unittest discover -s tests -p 'test_load*' -v

These prove the book-content half of FR-4404 (a re-run adds nothing; another
course is untouched) and the loader half of FR-4210 (a refresh keeps progress or
refuses). They carry no @covers marker: the generated-bank half of FR-4404 (B15)
and the noor retarget of FR-4210 (T326) are not proven here, and a marker would
claim they were.
"""

from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

from _scratchdb import EX, ScratchDB, mini_course, run_loader, skip_without_db, write_bundle

ZZ = "course:zz-test-en"
ZY = "course:zy-test-en"

CONTENT_SQL = {
    "nodes": "SELECT id, kind, label, description, order_in_parent, subject FROM graph_nodes ORDER BY id",
    "edges": "SELECT src_id, dst_id, edge_type FROM graph_edges ORDER BY 1, 2, 3",
    "questions": "SELECT id, lo_id, stem, choices::text, correct_answer, status, source, reviewed_by, "
                 "solution_version FROM questions ORDER BY id",
    "visuals": "SELECT id, lo_id, spec::text FROM visuals ORDER BY id",
    "runs": "SELECT count(*) FROM extraction_runs",
}
STUDENT_SQL = {
    "attempts": "SELECT * FROM attempts ORDER BY id",
    "mastery": "SELECT * FROM mastery ORDER BY id",
    "checks": "SELECT * FROM understanding_checks ORDER BY id",
}


def state(db: ScratchDB, which=CONTENT_SQL) -> dict:
    return {k: db.q(sql) for k, sql in which.items()}


@skip_without_db()
class CourseLoadTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = ScratchDB("load").create()
        cls.tmp = Path(tempfile.mkdtemp(prefix="load_seed_test_"))
        cls.zz = write_bundle(cls.tmp, "zz", mini_course("zz"))
        cls.zy = write_bundle(cls.tmp, "zy", mini_course("zy"))
        run_loader(cls.db.dsn, str(cls.zz), "--course", ZZ)
        run_loader(cls.db.dsn, str(cls.zy), "--course", ZY)
        # A student with history on the zz course, a catalogue entry and a stamp.
        cls.db.q("INSERT INTO students (display_name, grade) VALUES ('Real Student', '10')")
        cls.sid = cls.db.one("SELECT id FROM students")
        cls.db.q("INSERT INTO misconceptions (id, lo_id, label, description, generated_by) "
                 "VALUES ('mc:zz1-1-1:concat', 'lo:zz1-1-1', 'joined digits', 'writes 23', 'tests')")
        cls.db.q("""UPDATE questions SET choices = '[{"key":"A","text":"5"},{"key":"B","text":"6"},
                    {"key":"C","text":"23","misconception_id":"mc:zz1-1-1:concat"}]'::jsonb
                    WHERE id = 'q:zz1-1-1:001'""")
        for qid in ("q:zz1-1-1:001", "q:zz1-1-1:002"):
            cls.db.q("INSERT INTO attempts (student_id, question_id, given_answer, is_correct) "
                     "VALUES (%s, %s, 'x', false)", (cls.sid, qid))
        cls.db.q("INSERT INTO mastery (student_id, lo_id, score) VALUES (%s, 'lo:zz1-1-1', 0.4)",
                 (cls.sid,))
        # a human promoted the unverified question since it loaded
        cls.db.q("UPDATE questions SET status = 'live', reviewed_by = 'samuel' "
                 "WHERE id = 'q:zz1-1-2:001'")

    @classmethod
    def tearDownClass(cls):
        cls.db.drop()

    def bundle(self, mutate=None, prefix="zz") -> Path:
        b = mini_course(prefix)
        if mutate:
            mutate(b)
        return write_bundle(self.tmp, f"{prefix}-variant", b)

    # ---- add-only ------------------------------------------------------------
    def test_rerun_adds_nothing_and_leaves_no_trace(self):
        before = state(self.db)
        out = run_loader(self.db.dsn, str(self.zz), "--course", ZZ)
        self.assertEqual(state(self.db), before, "a re-run changed the database")
        self.assertIn("questions            unchanged 4", out)

    def test_add_only_reports_drift_and_keeps_review_state_and_stamps(self):
        def edit(b):
            b["questions"][0]["stem"] = "2 + 3 equals?"
            b["nodes"][2]["label"] = "Addition"
            b["questions"].append({**b["questions"][3], "id": "q:zz1-2-1:002", "stem": "3 x 3 = ?",
                                   "answer": "9", "solution": ["9"]})
        before = state(self.db)
        out = run_loader(self.db.dsn, str(self.bundle(edit)), "--course", ZZ)
        after = state(self.db)
        self.assertIn("drift", out)
        self.assertEqual([r for r in after["questions"] if r[0] != "q:zz1-2-1:002"],
                         before["questions"], "add-only changed an existing question")
        self.assertEqual(self.db.one("SELECT label FROM graph_nodes WHERE id='lo:zz1-1-1'"), "Add")
        self.assertEqual(self.db.one("SELECT status FROM questions WHERE id='q:zz1-2-1:002'"), "live")
        self.db.q("DELETE FROM questions WHERE id = 'q:zz1-2-1:002'")   # undo for the other tests

    # ---- update ----------------------------------------------------------------
    def test_update_applies_edits_but_not_review_state(self):
        def edit(b):
            b["questions"][2]["solution"] = ["5 - 3 = 2", "check: 2 + 3 = 5"]   # promoted one
            b["questions"][3]["stem"] = "2 times 3 = ?"                          # never attempted
        run_loader(self.db.dsn, str(self.bundle(edit)), "--course", ZZ, "--update")
        row = self.db.q("SELECT status, reviewed_by, solution_version FROM questions "
                        "WHERE id='q:zz1-1-2:001'")[0]
        self.assertEqual(row, ("live", "samuel", 2), "status/review stamp moved or version not bumped")
        self.assertEqual(self.db.one("SELECT stem FROM questions WHERE id='q:zz1-2-1:001'"),
                         "2 times 3 = ?")
        run_loader(self.db.dsn, str(self.zz), "--course", ZZ, "--update")        # restore

    def test_update_keeps_misconception_stamps_on_choices(self):
        def edit(b):
            b["questions"][0]["solution"] = ["2 + 3 = 5", "so A"]
        run_loader(self.db.dsn, str(self.bundle(edit)), "--course", ZZ, "--update")
        choices = self.db.one("SELECT choices FROM questions WHERE id='q:zz1-1-1:001'")
        self.assertEqual([c.get("misconception_id") for c in choices],
                         [None, None, "mc:zz1-1-1:concat"])
        run_loader(self.db.dsn, str(self.zz), "--course", ZZ, "--update")

    def test_update_refuses_to_change_what_an_attempted_question_asks(self):
        def edit(b):
            b["questions"][0]["stem"] = "2 + 30 = ?"
        before = state(self.db)
        with self.assertRaises(SystemExit) as cm:
            run_loader(self.db.dsn, str(self.bundle(edit)), "--course", ZZ, "--update")
        self.assertIn("students have attempted", str(cm.exception))
        self.assertEqual(state(self.db), before)

    # ---- replace ----------------------------------------------------------------
    def test_replace_refuses_when_progress_or_the_catalogue_would_be_lost(self):
        def drop_lo(b):   # lo:zz1-1-1 has mastery, a misconception and attempted questions
            b["nodes"] = [n for n in b["nodes"] if n["id"] != "lo:zz1-1-1"]
            b["edges"] = [e for e in b["edges"] if "lo:zz1-1-1" not in (e["src"], e["dst"])]
            b["questions"] = [q for q in b["questions"] if q["lo"] != "lo:zz1-1-1"]
            b["visuals"] = []
        before, students = state(self.db), state(self.db, STUDENT_SQL)
        with self.assertRaises(SystemExit) as cm:
            run_loader(self.db.dsn, str(self.bundle(drop_lo)), "--course", ZZ, "--replace")
        msg = str(cm.exception)
        for what in ("mastery", "misconception", "lo:zz1-1-1"):
            self.assertIn(what, msg)
        self.assertEqual(state(self.db), before)
        self.assertEqual(state(self.db, STUDENT_SQL), students)

    def test_replace_retires_attempted_deletes_unused_prunes_free_objective(self):
        def drop(b):   # q 002 was attempted; lesson 2 (lo:zz1-2-1) has no dependants
            b["questions"] = [q for q in b["questions"]
                              if q["id"] != "q:zz1-1-1:002" and q["lo"] != "lo:zz1-2-1"]
            b["nodes"] = [n for n in b["nodes"] if n["id"] != "lo:zz1-2-1"]
            b["edges"] = [e for e in b["edges"] if "lo:zz1-2-1" not in (e["src"], e["dst"])]
        students = state(self.db, STUDENT_SQL)
        zy_before = self.db.q("SELECT * FROM questions WHERE id LIKE 'q:zy%' ORDER BY id")
        out = run_loader(self.db.dsn, str(self.bundle(drop)), "--course", ZZ, "--replace")
        self.assertIn("retired", out)
        self.assertEqual(self.db.one("SELECT status FROM questions WHERE id='q:zz1-1-1:002'"),
                         "retired")
        self.assertIsNone(self.db.one("SELECT id FROM questions WHERE id='q:zz1-2-1:001'"))
        self.assertIsNone(self.db.one("SELECT id FROM graph_nodes WHERE id='lo:zz1-2-1'"))
        self.assertEqual(state(self.db, STUDENT_SQL), students, "student rows changed")
        self.assertEqual(self.db.q("SELECT * FROM questions WHERE id LIKE 'q:zy%' ORDER BY id"),
                         zy_before, "another course was touched")
        # put it back: the dropped rows return; the retired question stays retired
        # until a human says otherwise (status is never the loader's to restore)
        run_loader(self.db.dsn, str(self.zz), "--course", ZZ, "--replace")
        self.assertEqual(self.db.one("SELECT status FROM questions WHERE id='q:zz1-2-1:001'"), "live")
        self.db.q("UPDATE questions SET status='live' WHERE id='q:zz1-1-1:002'")

    # ---- guards ------------------------------------------------------------------
    def test_if_absent_changes_nothing_when_the_course_is_present(self):
        before = state(self.db)
        out = run_loader(self.db.dsn, str(self.zz), "--course", ZZ, "--if-absent")
        self.assertIn("already loaded", out)
        self.assertEqual(state(self.db), before)

    def test_question_id_owned_by_another_course_is_refused(self):
        def steal(b):
            b["questions"][0]["id"] = "q:zz1-1-1:001"          # zz's id in the zy bundle
        with self.assertRaises(SystemExit) as cm:
            run_loader(self.db.dsn, str(self.bundle(steal, prefix="zy")), "--course", ZY)
        self.assertIn("collision", str(cm.exception))

    def test_unknown_flag_stops_the_run(self):
        with self.assertRaises(SystemExit):
            run_loader(self.db.dsn, str(self.zz), "--course", ZZ, "--dryrun")


@skip_without_db()
class FullTruncateGuardTest(unittest.TestCase):
    def setUp(self):
        self.db = ScratchDB("trunc").create()
        self.tmp = Path(tempfile.mkdtemp(prefix="load_seed_trunc_"))
        self.zz = write_bundle(self.tmp, "zz", mini_course("zz"))

    def tearDown(self):
        self.db.drop()

    def test_full_reload_refuses_while_real_students_exist(self):
        run_loader(self.db.dsn, str(self.zz), "--course", ZZ)
        self.db.q("INSERT INTO students (display_name, grade) VALUES ('Real Student', '10')")
        with self.assertRaises(SystemExit) as cm:
            run_loader(self.db.dsn, str(self.zz))
        self.assertIn("real student data", str(cm.exception))
        self.assertEqual(self.db.one("SELECT count(*) FROM students"), 1)
        run_loader(self.db.dsn, str(self.zz), "--wipe-students")
        self.assertEqual(self.db.one("SELECT count(*) FROM students"), 0)


@skip_without_db()
class SupersededBundleTest(unittest.TestCase):
    """social-skeleton.json named on a course load registers its document only."""

    def setUp(self):
        self.db = ScratchDB("sup").create()

    def tearDown(self):
        self.db.drop()

    def test_superseded_bundle_contributes_only_its_document(self):
        run_loader(self.db.dsn, str(EX / "seed" / "social-skeleton.json"),
                   "--course", "course:prep3-social-ar")
        self.assertEqual(self.db.one("SELECT count(*) FROM graph_nodes"), 0)
        self.assertEqual(self.db.one("SELECT count(*) FROM questions"), 0)
        self.assertEqual(self.db.one("SELECT file_path FROM source_documents"),
                         "docs/Source/Social_prp3_T1_2.pdf")
        # and the one-pass course load registers it itself on a fresh database
        self.db.q("DELETE FROM source_documents")
        run_loader(self.db.dsn, "--all", "--course", "course:prep3-social-ar")
        self.assertEqual(self.db.one("SELECT count(*) FROM questions"), 762)


@skip_without_db()
class ProgramNodeTest(unittest.TestCase):
    """A book config's `program` (ADR-0024): written by the loader, shared by courses."""

    def setUp(self):
        import shutil
        import book_config
        self.db = ScratchDB("prog").create()
        self.tmp = Path(tempfile.mkdtemp(prefix="load_seed_prog_"))
        books = self.tmp / "books"
        books.mkdir()
        for p in book_config.BOOKS_DIR.glob("*.json"):
            shutil.copy(p, books / p.name)
        for prefix in ("zz", "zy"):
            (books / f"{prefix}-test.json").write_text(json.dumps({
                "book": f"{prefix}-test", "title": "t", "course_id": f"course:{prefix}-test-en",
                "curriculum": "us-american-en", "subject": "math", "grade": "10", "language": "en",
                "direction": "ltr", "id_prefixes": [f"{prefix}"],
                "program": {"id": "program:us-american-en", "label": "American"}}))
        self._old = book_config.BOOKS_DIR
        book_config.BOOKS_DIR = books
        self.zz = write_bundle(self.tmp, "zz", mini_course("zz"))
        self.zy = write_bundle(self.tmp, "zy", mini_course("zy"))

    def tearDown(self):
        import book_config
        book_config.BOOKS_DIR = self._old
        self.db.drop()

    def edges_to_program(self):
        return self.db.q("SELECT src_id FROM graph_edges WHERE dst_id = 'program:us-american-en' "
                         "AND edge_type = 'part_of' ORDER BY 1")

    def test_program_written_once_and_shared(self):
        run_loader(self.db.dsn, str(self.zz), "--course", ZZ)
        run_loader(self.db.dsn, str(self.zy), "--course", ZY)          # program exists: no collision
        self.assertEqual(self.db.one("SELECT label FROM graph_nodes WHERE id='program:us-american-en'"),
                         "American")
        self.assertEqual(self.edges_to_program(), [(ZY,), (ZZ,)])
        run_loader(self.db.dsn, str(self.zz), "--course", ZZ, "--replace")   # kept, not pruned
        self.assertEqual(self.edges_to_program(), [(ZY,), (ZZ,)])
        self.assertEqual(self.db.one("SELECT count(*) FROM graph_nodes WHERE kind='program'"), 1)


class ChoiceMergeTest(unittest.TestCase):
    """No database: the stamp-preserving merge on its own."""

    def test_stamps_follow_the_text_not_the_key(self):
        import load_seed
        db = [{"key": "A", "text": "5"}, {"key": "B", "text": "23", "misconception_id": "mc:x"}]
        bundle = [{"key": "A", "text": "23"}, {"key": "B", "text": "5"}]
        self.assertEqual(load_seed.merged_choices(bundle, db),
                         [{"key": "A", "text": "23", "misconception_id": "mc:x"},
                          {"key": "B", "text": "5"}])

    def test_material_diff_ignores_stamps(self):
        import load_seed
        base = {"lo_id": "l", "question_type": "mcq", "stem": "s", "correct_answer": "A",
                "choices": [{"key": "A", "text": "1"}], "tier": "basic",
                "canonical_solution": [], "source_page": 1, "source_note": "n"}
        stamped = copy.deepcopy(base)
        stamped["choices"][0]["misconception_id"] = "mc:x"
        self.assertEqual(load_seed.question_diff(base, stamped), ([], []))
        changed = copy.deepcopy(base)
        changed["stem"] = "t"
        self.assertEqual(load_seed.question_diff(changed, base)[0], ["stem"])


if __name__ == "__main__":
    unittest.main()
