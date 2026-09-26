"""export_generated_content.py --course (B15, T346, T422) and the course-scoped generated loaders.

    AINEXT_TEST_PG="host=127.0.0.1 port=5432" uv run --with pytest python -m pytest -q tests/test_export_generated_content.py

One scratch database holds two maths courses: Prep-3 (its book, its catalogue, its generated
and widget banks, loaded the way the deploy loads them) and the Grade 10 Chapter 8 fixture.
Then:
  * file -> database -> export gives back Prep-3's three committed files BYTE FOR BYTE,
    with Grade 10 loaded beside it: kind, aliases and the file's header survive (decision 22);
  * the same round trip holds for the Grade 10 fixture's files;
  * an export refuses a catalogue id only the database (or only the file) holds;
  * an unscoped export refuses two courses; a scoped load refuses another course's items;
  * a second run of the generated loaders duplicates nothing and touches no other course;
  * a catalogue load folds an alias safely even when a student's attempt cites it.

@covers FR-4404, FR-4409
"""

from __future__ import annotations

import contextlib
import filecmp
import importlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

from _scratchdb import EX, ScratchDB, run_loader, skip_without_db
import assemble_lesson_bundle as alb
import book_config

FIX = Path(__file__).resolve().parent / "fixtures" / "g10-math"
GEN = EX / "seed" / "generated"
G10 = "course:us-g10-math-en"
PREP3 = "course:prep3-math-en"
FILES = ("generated-questions.json", "widget-questions.json", "misconceptions.json")


def run_main(module: str, argv: list[str], dsn: str) -> tuple[int, str]:
    """A loader or the export in-process, as its CLI, against `dsn` in the mvp1 environment."""
    mod = importlib.import_module(module)
    old_argv, old_env = sys.argv, dict(os.environ)
    sys.argv = [f"{module}.py", *argv]
    os.environ.update(AINEXT_DB_DSN=dsn, AINEXT_ENVIRONMENT="mvp1")
    out = io.StringIO()
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            try:
                code = mod.main() if module != "export_generated_content" else mod.main(argv)
            except SystemExit as exc:
                code = exc.code if isinstance(exc.code, int) else 1
    finally:
        sys.argv = old_argv
        os.environ.clear()
        os.environ.update(old_env)
    return code or 0, out.getvalue()


def load_bank(dsn: str, gen_dir: Path, course: str | None = None) -> None:
    """The deploy's order: catalogue, both banks restored, catalogue again (it stamps
    generated options its maps name)."""
    scope = ["--course", course] if course else []
    for argv in ([str(gen_dir / "misconceptions.json"), *scope],
                 [str(gen_dir / "generated-questions.json"), "--restore", "--sample", "0", *scope],
                 [str(gen_dir / "widget-questions.json"), "--restore", "--sample", "0", *scope],
                 [str(gen_dir / "misconceptions.json"), *scope]):
        module = "load_misconceptions" if argv[0].endswith("misconceptions.json") else "load_generated_questions"
        code, out = run_main(module, argv, dsn)
        assert code == 0, out


@skip_without_db()
class ExportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = ScratchDB("export").create()
        cls.tmp = Path(tempfile.mkdtemp(prefix="export_test_"))
        run_loader(cls.db.dsn, "--all", "--course", PREP3)
        load_bank(cls.db.dsn, GEN)
        bundles, _ = alb.assemble(book_config.load_book("g10-math"), FIX / "manifest.json",
                                  FIX / "objectives", FIX / "runs" / "lesson")
        paths = []
        for name, b in bundles.items():
            (cls.tmp / name).write_text(alb.dump(b))
            paths.append(str(cls.tmp / name))
        run_loader(cls.db.dsn, *sorted(paths, key=lambda p: "course" not in p), "--course", G10)
        load_bank(cls.db.dsn, FIX / "generated", G10)

    @classmethod
    def tearDownClass(cls):
        cls.db.drop()

    def export(self, course: str | None, prior: Path | None, name: str, *extra: str) -> tuple[int, str, Path]:
        out = self.tmp / name
        argv = (["--course", course] if course else []) + ["--out-dir", str(out), "--dsn", self.db.dsn]
        argv += ["--prior", str(prior)] if prior else []
        code, text = run_main("export_generated_content", argv + list(extra), self.db.dsn)
        return code, text, out

    def assertSameFiles(self, a: Path, b: Path):
        for f in FILES:
            self.assertTrue(filecmp.cmp(a / f, b / f, shallow=False), f"{f} differs")

    def test_prep3_round_trip_is_byte_identical_with_a_second_maths_course_loaded(self):
        code, text, out = self.export(PREP3, GEN, "prep3")
        self.assertEqual(code, 0, text)
        self.assertSameFiles(out, GEN)

    def test_g10_round_trip_is_byte_identical(self):
        code, text, out = self.export(G10, FIX / "generated", "g10")
        self.assertEqual(code, 0, text)
        self.assertSameFiles(out, FIX / "generated")
        cat = json.loads((out / "misconceptions.json").read_text())
        self.assertEqual(cat["misconceptions"][0]["aliases"], ["mc:g10m8s1-1-1:xy-swap"])
        self.assertTrue(all(m["id"].startswith("mc:g10m8") for m in cat["misconceptions"]))

    def test_a_first_export_derives_kind_from_use(self):
        code, text, out = self.export(G10, self.tmp / "nowhere", "g10-first")
        self.assertEqual(code, 0, text)
        kinds = {m["id"]: m["kind"] for m in
                 json.loads((out / "misconceptions.json").read_text())["misconceptions"]}
        self.assertEqual(kinds["mc:g10m8s3-2-1:parallel-for-perpendicular"], "book_distractor")
        self.assertEqual(kinds["mc:g10m8s1-1-1:coordinates-swapped"], "generated_distractor")
        self.assertEqual(kinds["mc:g10m8s2-1-1:forgot-square-root"], "conceptual")

    def test_a_database_only_id_is_refused_and_nothing_is_written(self):
        self.db.q("INSERT INTO misconceptions (id, lo_id, label, description, generated_by) "
                  "VALUES ('mc:u1-1-1:stray', 'lo:u1-1-1', 'stray', 'added by hand', 'tests')")
        try:
            code, text, out = self.export(PREP3, GEN, "drift")
            self.assertEqual(code, 1)
            self.assertIn("mc:u1-1-1:stray", text)
            self.assertFalse((out / "misconceptions.json").exists())
        finally:
            self.db.q("DELETE FROM misconceptions WHERE id = 'mc:u1-1-1:stray'")

    def test_a_file_only_id_is_refused(self):
        prior = self.tmp / "prior-extra"
        prior.mkdir(exist_ok=True)
        cat = json.loads((GEN / "misconceptions.json").read_text())
        cat["misconceptions"].append({**cat["misconceptions"][0], "id": "mc:u1-1-1:never-loaded"})
        (prior / "misconceptions.json").write_text(json.dumps(cat))
        code, text, _ = self.export(PREP3, prior, "file-only")
        self.assertEqual(code, 1)
        self.assertIn("mc:u1-1-1:never-loaded", text)

    def test_an_unscoped_export_refuses_two_courses(self):
        code, text, _ = self.export(None, None, "unscoped")
        self.assertEqual(code, 2)
        self.assertIn("Pass --course", text)

    def test_a_scoped_load_refuses_another_courses_items(self):
        before = self.db.one("SELECT count(*) FROM questions")
        code, text = run_main("load_generated_questions",
                              [str(GEN / "generated-questions.json"), "--restore", "--sample", "0",
                               "--course", G10], self.db.dsn)
        self.assertEqual(code, 1)
        self.assertIn("not on an objective of course:us-g10-math-en", text)
        self.assertEqual(self.db.one("SELECT count(*) FROM questions"), before)
        code, text = run_main("load_misconceptions", [str(GEN / "misconceptions.json"), "--course", G10],
                              self.db.dsn)
        self.assertEqual(code, 1)

    def test_a_rerun_duplicates_nothing_and_leaves_the_other_course_alone(self):
        snap = lambda: self.db.q("SELECT id, status, reviewed_by, choices::text FROM questions "  # noqa: E731
                                 "ORDER BY id")
        mcs = lambda: self.db.q("SELECT id, label FROM misconceptions ORDER BY id")  # noqa: E731
        before, before_mc = snap(), mcs()
        code, text = run_main("load_generated_questions",
                              [str(FIX / "generated" / "generated-questions.json"), "--restore",
                               "--sample", "0", "--add-only", "--course", G10], self.db.dsn)
        self.assertEqual(code, 0, text)
        self.assertIn("course counts: course:us-g10-math-en generated=6 live=6 review=0 "
                      "unreviewed=5 widgets=1", text)
        code, text = run_main("load_misconceptions",
                              [str(FIX / "generated" / "misconceptions.json"), "--add-only",
                               "--course", G10], self.db.dsn)
        self.assertEqual(code, 0, text)
        self.assertIn("course counts: course:us-g10-math-en misconceptions=5 with_refutation=5", text)
        self.assertEqual(snap(), before)
        self.assertEqual(mcs(), before_mc)


@skip_without_db()
class AliasFoldTest(unittest.TestCase):
    """Folding an alias a student's attempt cites must not roll back the catalogue load."""

    def setUp(self):
        self.db = ScratchDB("alias").create()
        self.tmp = Path(tempfile.mkdtemp(prefix="alias_test_"))
        bundles, _ = alb.assemble(book_config.load_book("g10-math"), FIX / "manifest.json",
                                  FIX / "objectives", FIX / "runs" / "lesson")
        paths = []
        for name, b in bundles.items():
            (self.tmp / name).write_text(alb.dump(b))
            paths.append(str(self.tmp / name))
        run_loader(self.db.dsn, *sorted(paths, key=lambda p: "course" not in p), "--course", G10)
        # the generator's old id for the same error, still stamped on a book option and
        # cited by a student's recorded attempt
        self.db.q("INSERT INTO misconceptions (id, lo_id, label, description, generated_by) VALUES "
                  "('mc:g10m8s1-1-1:xy-swap', 'lo:g10m8s1-1-1', 'xy', 'swapped', 'old generator')")
        self.db.q("""UPDATE questions SET choices = jsonb_set(choices, '{1,misconception_id}',
                     '"mc:g10m8s1-1-1:xy-swap"') WHERE id = 'q:g10m8s1-1-1:ex8-1-1'""")
        self.db.q("INSERT INTO students (display_name, grade) VALUES ('Grade 10 student', '10')")
        self.db.q("""INSERT INTO attempts (student_id, question_id, given_answer, is_correct,
                     misconception_id) SELECT max(id), 'q:g10m8s1-1-1:ex8-1-1', 'B', false,
                     'mc:g10m8s1-1-1:xy-swap' FROM students""")

    def tearDown(self):
        self.db.drop()

    def test_the_load_succeeds_keeps_the_cited_alias_and_repoints_its_stamps(self):
        attempts = self.db.q("SELECT * FROM attempts ORDER BY id")
        code, text = run_main("load_misconceptions", [str(FIX / "generated" / "misconceptions.json")],
                              self.db.dsn)
        self.assertEqual(code, 0, text)
        self.assertIn("KEPT", text)
        self.assertEqual(self.db.one("SELECT count(*) FROM misconceptions WHERE id = 'mc:g10m8s1-1-1:xy-swap'"), 1)
        stamp = self.db.one("SELECT choices->1->>'misconception_id' FROM questions "
                            "WHERE id = 'q:g10m8s1-1-1:ex8-1-1'")
        self.assertEqual(stamp, "mc:g10m8s1-1-1:coordinates-swapped")
        self.assertEqual(self.db.q("SELECT * FROM attempts ORDER BY id"), attempts,
                         "a student row was rewritten")
        self.assertEqual(self.db.one("SELECT count(*) FROM misconceptions WHERE lo_id LIKE 'lo:g10m8%'"), 6)


if __name__ == "__main__":
    unittest.main()
