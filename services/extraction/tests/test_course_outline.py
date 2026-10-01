"""load_course_outline.py writes a book's whole outline to course_outline (migration 037).

    uv run --with pytest python -m pytest -q tests/test_course_outline.py                       # pure half
    AINEXT_TEST_PG="host=127.0.0.1 port=5432" uv run --with pytest python -m pytest -q tests/test_course_outline.py

Samuel, 2026-10-01: "I want the students to see all chapters as well not only 8!". The rows come
from the REAL Grade 10 manifest (G0 passed: 14 chapters, 65 lessons); Chapter 8's content comes
from the assembled fixture, loaded by load_seed.py exactly as test_course_lessons.py loads it.

  * the rows: every manifest lesson, in the manifest's order, with the book provenance the
    content assembly gives it (the same `book_lesson`), and an ungated manifest refused;
  * the load: 65 rows, re-runs write nothing, a moved or dropped lesson is followed exactly;
  * readiness is NOT stored — the loader reports what is prepared (objectives loaded) and the
    table has no column for it; loading a chapter's content changes nothing here;
  * Chapter 8's course_lessons rows are untouched, and its outline rows name it exactly as
    course_lessons does (no drift).
"""

from __future__ import annotations

import copy
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from _scratchdb import ScratchDB, run_loader, skip_without_db
import assemble_lesson_bundle as alb
import book_config
import load_course_outline as lco

FIX = Path(__file__).resolve().parent / "fixtures" / "g10-math"
G10 = "course:us-g10-math-en"
CH8 = ["g10m8s1-1", "g10m8s2-1", "g10m8s3-1", "g10m8s3-2", "g10m8s4-1"]


def g10_rows(manifest: dict | None = None) -> list[dict]:
    book = book_config.load_book("g10-math")
    m, rel, sha = lco.read_manifest(book)
    return lco.outline_rows(book, manifest if manifest is not None else m, rel, sha)


class OutlineRowsTest(unittest.TestCase):
    """No database: what the rows are."""

    def test_every_lesson_in_book_order(self):
        rows = g10_rows()
        self.assertEqual(len(rows), 65)
        self.assertEqual([r["book_order"] for r in rows], list(range(1, 66)))
        self.assertEqual(len({r["module_id"] for r in rows}), 14)
        self.assertEqual(rows[0]["lesson_slug"], "g10m1s3-1")
        self.assertEqual(rows[-1]["lesson_slug"], "g10m14s7-1")
        # chapters contiguous and in order
        chapters = []
        for r in rows:
            if not chapters or chapters[-1] != r["module_order"]:
                chapters.append(r["module_order"])
        self.assertEqual(chapters, list(range(1, 15)))
        self.assertEqual(rows[0]["module_label"], "Chapter 1 — Algebraic expressions")
        self.assertEqual([r["lesson_slug"] for r in rows if r["module_id"] == "module:g10m-c08"], CH8)

    def test_the_book_provenance_is_the_assemblys(self):
        by = {r["lesson_slug"]: r for r in g10_rows()}
        merged = by["g10m1s3-1"]
        self.assertEqual((merged["sections"], merged["group_key"], merged["title"]),
                         (["1.2", "1.3"], "1.3", "Rational and irrational numbers"))
        part = by["g10m1s7-2"]
        self.assertEqual((part["part_n"], part["part_of"], part["group_key"]), (2, 3, "1.7"))
        self.assertTrue(by["g10m6s1-1"]["chapter_intro"])
        self.assertEqual((by["g10m8s1-1"]["page_from"], by["g10m8s1-1"]["page_to"]), (284, 287))
        self.assertIn("G0 passed 2026-09-25", by["g10m8s1-1"]["source"])

    def test_an_ungated_manifest_is_refused(self):
        book = book_config.load_book("g10-math")
        m, rel, sha = lco.read_manifest(book)
        ungated = copy.deepcopy(m)
        ungated["lesson_unit"]["gate"]["passed"] = None
        with self.assertRaises(SystemExit) as e:
            lco.outline_rows(book, ungated, rel, sha)
        self.assertIn("gate", str(e.exception))

    def test_another_courses_manifest_is_refused(self):
        book = book_config.load_book("g10-math")
        m, rel, sha = lco.read_manifest(book)
        other = copy.deepcopy(m)
        other["book"]["course_id"] = "course:prep3-math-en"
        with self.assertRaises(SystemExit):
            lco.outline_rows(book, other, rel, sha)

    def test_no_arabic(self):
        import re
        arabic = re.compile(r"[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]")
        for r in g10_rows():
            for text in [r["module_label"], r["title"], *r["section_titles"]]:
                self.assertIsNone(arabic.search(text), f"{r['lesson_slug']}: {text}")


@skip_without_db()
class OutlineLoadTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = ScratchDB("outline").create()
        cls.tmp = Path(tempfile.mkdtemp(prefix="course_outline_"))
        bundles, _ = alb.assemble(book_config.load_book("g10-math"), FIX / "manifest.json",
                                  FIX / "objectives", FIX / "runs" / "lesson")
        paths = {}
        for name, b in bundles.items():
            (cls.tmp / name).write_text(alb.dump(b))
            paths[name] = cls.tmp / name
        run_loader(cls.db.dsn, str(paths["g10m-course.json"]), str(paths["g10m-c08.json"]),
                   "--course", G10)

    @classmethod
    def tearDownClass(cls):
        cls.db.drop()

    def load(self) -> tuple[dict, str]:
        import os
        old = os.environ.get("AINEXT_DB_DSN")
        os.environ["AINEXT_DB_DSN"] = self.db.dsn
        out = io.StringIO()
        try:
            with redirect_stdout(out):
                done = lco.load("g10-math")
        finally:
            if old is None:
                os.environ.pop("AINEXT_DB_DSN", None)
            else:
                os.environ["AINEXT_DB_DSN"] = old
        return done, out.getvalue()

    def lessons_rows(self):
        return self.db.q("SELECT * FROM course_lessons WHERE course_id = %s ORDER BY lesson_slug", (G10,))

    def test_1_load_then_rerun(self):
        before = self.lessons_rows()
        done, out = self.load()
        self.assertEqual(len(done["added"]), 65)
        self.assertIn("prepared     5 of 65", out)
        # The fixture's Chapter 8 bundle is assembled from the SCOUTING manifest, which titled
        # the two parts of 8.3 "Gradient between two points" / "Straight lines"; the G0 manifest
        # titles both "Gradient of a line". The drift check names exactly them — reported, not
        # fixed (course_lessons is load_seed.py's). On the pilot database, loaded from the G0
        # manifest's own bundle, there is no drift.
        self.assertIn("WARNING: 2 loaded lesson(s) are named differently", out)
        self.assertIn("g10m8s3-1 (title)", out)
        self.assertIn("g10m8s3-2 (title)", out)
        self.assertEqual(self.db.one("SELECT count(*) FROM course_outline WHERE course_id = %s", (G10,)), 65)
        self.assertEqual(
            [r[0] for r in self.db.q("SELECT lesson_slug FROM course_outline WHERE course_id = %s "
                                     "ORDER BY book_order", (G10,))],
            [r["lesson_slug"] for r in g10_rows()])
        # Chapter 8's loaded provenance is untouched by the outline
        self.assertEqual(self.lessons_rows(), before)
        self.assertEqual([r[1] for r in before], CH8)
        # re-run: nothing written
        done, _ = self.load()
        self.assertEqual((len(done["added"]), len(done["updated"]), len(done["unchanged"]),
                          len(done["removed"])), (0, 0, 65, 0))

    def test_2_readiness_is_not_stored(self):
        cols = {r[0] for r in self.db.q(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'course_outline'")}
        self.assertFalse({"ready", "prepared", "status", "state", "available"} & cols, cols)

    def test_3_outline_matches_course_lessons_for_the_loaded_chapter(self):
        # every provenance column but the two fixture titles above: same slugs, sections,
        # parts, introductions and section keys as the loaded chapter
        self.load()
        diff = self.db.q(
            """SELECT lesson_slug, sections, section_titles, part_n, part_of, chapter_intro, group_key
                 FROM course_lessons WHERE course_id = %s
               EXCEPT
               SELECT lesson_slug, sections, section_titles, part_n, part_of, chapter_intro, group_key
                 FROM course_outline WHERE course_id = %s""", (G10, G10))
        self.assertEqual(diff, [])
        # the outline keeps the MANIFEST's names; it never adopts course_lessons'
        self.assertEqual(self.db.one("SELECT title FROM course_outline WHERE lesson_slug = 'g10m8s3-2'"),
                         "Gradient of a line")

    def test_4_a_moved_or_dropped_lesson_is_followed_exactly(self):
        self.load()
        rows = g10_rows()
        # swap the first two lessons' places and drop the last one
        rows[0]["book_order"], rows[1]["book_order"] = rows[1]["book_order"], rows[0]["book_order"]
        dropped = rows.pop()
        with self.db.connect() as c, c.cursor() as cur:
            done = lco.sync(cur, G10, rows)
        self.assertEqual(done["removed"], [dropped["lesson_slug"]])
        self.assertEqual(sorted(done["updated"]), sorted([rows[0]["lesson_slug"], rows[1]["lesson_slug"]]))
        order = [r[0] for r in self.db.q(
            "SELECT lesson_slug FROM course_outline WHERE course_id = %s ORDER BY book_order", (G10,))]
        self.assertEqual(order[:2], ["g10m1s4-1", "g10m1s3-1"])
        self.assertNotIn(dropped["lesson_slug"], order)
        # and back to the manifest
        done, _ = self.load()
        self.assertEqual(done["added"], [dropped["lesson_slug"]])

    def test_5_the_app_reads_it_and_only_the_loader_writes_it(self):
        priv = lambda role, p: self.db.one("SELECT has_table_privilege(%s, 'course_outline', %s)", (role, p))  # noqa: E731
        self.assertTrue(priv("ainext_app", "SELECT"))
        self.assertTrue(priv("ainext_operator", "SELECT"))
        self.assertFalse(priv("ainext_app", "INSERT"))
        self.assertFalse(priv("ainext_operator", "UPDATE"))
        self.assertTrue(priv("ainext_maint", "INSERT"))


if __name__ == "__main__":
    unittest.main()
