"""load_seed.py writes every lesson's book provenance to course_lessons (T404, migration 034).

    AINEXT_TEST_PG="host=127.0.0.1 port=5432" uv run --with pytest python -m pytest -q tests/test_course_lessons.py

The Grade 10 lessons come from the assembled Chapter 8 fixture (8.3 split in two); the
National lessons get one-section rows derived from their existing bundles. Both hold for
every curriculum, which is FR-4311's point. The part prerequisites are derived by the app
from these rows (FR-4317) and are not proven here.

Also here, because they are the same load: the expression marker's spec stored as the
`choices` object, an edit to an attempted marker question refused, the program edge not
duplicated by a chapter-only reload, and the PDF's sha taken from the manifest when the PDF
is absent.

@covers FR-4311
"""

from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

from _scratchdb import ScratchDB, run_loader, skip_without_db, write_bundle
import assemble_lesson_bundle as alb
import book_config
import load_seed

FIX = Path(__file__).resolve().parent / "fixtures" / "g10-math"
G10 = "course:us-g10-math-en"
PREP3 = "course:prep3-math-en"
ROWS = ("SELECT course_id, lesson_slug, title, sections, section_titles, part_n, part_of, "
        "chapter_intro, group_key FROM course_lessons ORDER BY 1, 2")


def assembled(tmp: Path) -> dict[str, Path]:
    bundles, _ = alb.assemble(book_config.load_book("g10-math"), FIX / "manifest.json",
                              FIX / "objectives", FIX / "runs" / "lesson")
    out = {}
    for name, b in bundles.items():
        (tmp / name).write_text(alb.dump(b))
        out[name] = tmp / name
    return out


@skip_without_db()
class G10ProvenanceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = ScratchDB("lessons").create()
        cls.tmp = Path(tempfile.mkdtemp(prefix="course_lessons_"))
        cls.b = assembled(cls.tmp)
        run_loader(cls.db.dsn, str(cls.b["g10m-course.json"]), str(cls.b["g10m-c08.json"]),
                   "--course", G10)

    @classmethod
    def tearDownClass(cls):
        cls.db.drop()

    def variant(self, fn) -> Path:
        d = json.loads(self.b["g10m-c08.json"].read_text())
        fn(d)
        return write_bundle(self.tmp, "c08-variant", d)

    def test_every_g10_lesson_has_its_row(self):
        rows = self.db.q(ROWS)
        self.assertEqual([r[1] for r in rows],
                         ["g10m8s1-1", "g10m8s2-1", "g10m8s3-1", "g10m8s3-2", "g10m8s4-1"])
        parts = [r for r in rows if r[5] is not None]
        self.assertEqual([(r[1], r[5], r[6], r[8]) for r in parts],
                         [("g10m8s3-1", 1, 2, "8.3"), ("g10m8s3-2", 2, 2, "8.3")])
        self.assertEqual(rows[0][2:5], ("Drawing figures on the Cartesian plane", ["8.1"],
                                        ["Drawing figures on the Cartesian plane"]))

    def test_part_prerequisites_are_not_written_to_graph_edges(self):
        self.assertIsNone(self.db.one(
            "SELECT 1 FROM graph_edges WHERE src_id = 'lo:g10m8s3-1-1' AND dst_id LIKE 'lo:g10m8s3-2-%'"))

    def test_a_chapter_only_reload_changes_nothing_and_adds_no_program_edge(self):
        before = (self.db.q(ROWS), self.db.q("SELECT src_id, dst_id, edge_type FROM graph_edges ORDER BY 1,2,3"))
        out = run_loader(self.db.dsn, str(self.b["g10m-c08.json"]), "--course", G10)
        self.assertIn("course_lessons       unchanged 5", out)
        after = (self.db.q(ROWS), self.db.q("SELECT src_id, dst_id, edge_type FROM graph_edges ORDER BY 1,2,3"))
        self.assertEqual(after, before)
        self.assertEqual(self.db.one("SELECT count(*) FROM graph_edges WHERE src_id = %s "
                                     "AND dst_id = 'program:us-american-en'", (G10,)), 1)

    def test_add_only_reports_a_changed_title_and_update_applies_it(self):
        def retitle(d):
            d["lessons"][1]["title"] = "Distance between points"
        p = self.variant(retitle)
        out = run_loader(self.db.dsn, str(p), "--course", G10)
        self.assertIn("drift", out)
        self.assertEqual(self.db.one("SELECT title FROM course_lessons WHERE lesson_slug='g10m8s2-1'"),
                         "Distance between two points")
        run_loader(self.db.dsn, str(p), "--course", G10, "--update")
        self.assertEqual(self.db.one("SELECT title FROM course_lessons WHERE lesson_slug='g10m8s2-1'"),
                         "Distance between points")
        run_loader(self.db.dsn, str(self.b["g10m-c08.json"]), "--course", G10, "--update")

    def test_marker_spec_is_stored_as_the_choices_object(self):
        ch = self.db.one("SELECT choices FROM questions WHERE id = 'q:g10m8s2-1-1:ex8-2-1'")
        self.assertEqual(ch["marker"]["kind"], "surd")
        self.assertEqual(ch["marker"]["key"], "2\\sqrt{2}")
        self.assertEqual(self.db.one("SELECT question_type FROM questions "
                                     "WHERE id = 'q:g10m8s2-1-1:ex8-2-1'"), "short")

    def test_update_refuses_to_change_an_attempted_marker_key(self):
        self.db.q("INSERT INTO students (display_name, grade) VALUES ('Grade 10 student', '10')")
        sid = self.db.one("SELECT max(id) FROM students")
        self.db.q("INSERT INTO attempts (student_id, question_id, given_answer, is_correct) "
                  "VALUES (%s, 'q:g10m8s2-1-1:ex8-2-1', '2\\sqrt{2}', true)", (sid,))

        def rekey(d):
            q = next(x for x in d["questions"] if x["id"] == "q:g10m8s2-1-1:ex8-2-1")
            q["choices"]["marker"]["key"] = "\\sqrt{8}"
        with self.assertRaises(SystemExit) as cm:
            run_loader(self.db.dsn, str(self.variant(rekey)), "--course", G10, "--update")
        self.assertIn("students have attempted", str(cm.exception))
        self.assertIn("choices", str(cm.exception))

    def test_replace_prunes_the_row_of_a_dropped_lesson(self):
        def drop(d):
            gone = {"lo:g10m8s4-1-1"}
            d["nodes"] = [n for n in d["nodes"] if n["id"] not in gone]
            d["edges"] = [e for e in d["edges"] if not ({e["src"], e["dst"]} & gone)]
            d["questions"] = [q for q in d["questions"] if q["lo"] not in gone]
            d["visuals"] = [v for v in d["visuals"] if v["lo"] not in gone]
            d["lessons"] = [l for l in d["lessons"] if l["slug"] != "g10m8s4-1"]
            d["claims"] = [c for c in d["claims"] if c["lo"] not in gone]
        b = json.loads(self.variant(drop).read_text())
        course = json.loads(self.b["g10m-course.json"].read_text())
        p = write_bundle(self.tmp, "with-course", {**b, "nodes": course["nodes"] + b["nodes"],
                                                   "edges": course["edges"] + b["edges"],
                                                   "external_node_refs": []})
        out = run_loader(self.db.dsn, str(p), "--course", G10, "--replace")
        self.assertIn("pruned", out)
        self.assertIsNone(self.db.one("SELECT 1 FROM course_lessons WHERE lesson_slug = 'g10m8s4-1'"))
        run_loader(self.db.dsn, str(self.b["g10m-course.json"]), str(self.b["g10m-c08.json"]),
                   "--course", G10)
        self.assertEqual(self.db.one("SELECT count(*) FROM course_lessons WHERE course_id = %s", (G10,)), 5)


@skip_without_db()
class NationalProvenanceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = ScratchDB("natl").create()
        run_loader(cls.db.dsn, "--all", "--course", PREP3)

    @classmethod
    def tearDownClass(cls):
        cls.db.drop()

    def test_every_national_lesson_gets_one_section_and_no_part(self):
        rows = self.db.q(ROWS)
        self.assertEqual(len(rows), 35)
        self.assertTrue(all(r[0] == PREP3 and r[5] is None and r[6] is None and not r[7]
                            and len(r[3]) == 1 and r[8] == r[3][0] for r in rows))
        by = {r[1]: r for r in rows}
        # Two lessons printed with the same number in different terms: both keep it, and
        # migration 034's rule (no part, own unit) keeps them apart.
        self.assertEqual(by["u4-1"][3], ["4-1"])
        self.assertEqual(by["geo1-1"][3], ["4-1"])

    def test_printed_titles_come_from_the_book_config(self):
        # backlog 5: Prep-3 maths' titles lived only in the app registry; the book config now holds
        # them and the loader writes them. A lesson the config does not name keeps its first
        # objective's label, which is what the app shows for it today.
        by = {r[1]: r for r in self.db.q(ROWS)}
        titles = book_config.load_book("prep3-math-en").lesson_titles
        self.assertEqual(len(titles), 19)
        for slug, t in titles.items():
            self.assertEqual((by[slug][2], by[slug][4]), (t, [t]), slug)
        self.assertEqual(by["t2u1-1"][2], "First-degree equations in two variables")

    def test_a_rerun_writes_nothing(self):
        before = self.db.q(ROWS)
        out = run_loader(self.db.dsn, "--all", "--course", PREP3)
        self.assertIn("course_lessons       unchanged 35", out)
        self.assertEqual(self.db.q(ROWS), before)


@skip_without_db()
class ArabicPrintedTitlesTest(unittest.TestCase):
    """Samuel's answer 13: the Arabic lessons are named by their real printed titles (عِبادُ الرَّحمنِ),
    not by their first objective (فهم النص والاستماع). The loader writes them; the app reads them."""

    @classmethod
    def setUpClass(cls):
        cls.db = ScratchDB("arab").create()
        run_loader(cls.db.dsn, "--all", "--course", "course:prep3-arabic-ar")

    @classmethod
    def tearDownClass(cls):
        cls.db.drop()

    def test_every_arabic_lesson_has_its_printed_name(self):
        book = book_config.load_book("prep3-arabic-ar")
        rows = {r[1]: r for r in self.db.q(ROWS)}
        self.assertEqual(sorted(rows), sorted(book.lesson_titles))
        self.assertEqual(rows["ara1-1"][2], "عِبادُ الرَّحمنِ")
        for slug, t in book.lesson_titles.items():
            self.assertEqual(rows[slug][2], t)
            self.assertNotEqual(t, "فهم النص والاستماع")
            content = json.loads((book_config.HERE / "seed" / "content" / f"{slug}.json").read_text())
            self.assertEqual(content["title"], t, f"{slug}: the content file prints the same name")


@skip_without_db()
class WithoutMigration034Test(unittest.TestCase):
    def setUp(self):
        self.db = ScratchDB("no034").create()
        self.db.q("DROP TABLE course_lessons")
        self.tmp = Path(tempfile.mkdtemp(prefix="no034_"))

    def tearDown(self):
        self.db.drop()

    def test_split_sections_refuse_and_write_nothing(self):
        b = assembled(self.tmp)
        with self.assertRaises(SystemExit) as cm:
            run_loader(self.db.dsn, str(b["g10m-course.json"]), str(b["g10m-c08.json"]),
                       "--course", G10)
        self.assertIn("migration 034", str(cm.exception))
        self.assertEqual(self.db.one("SELECT count(*) FROM graph_nodes"), 0)

    def test_one_section_lessons_load_with_a_note(self):
        out = run_loader(self.db.dsn, "--all", "--course", PREP3)
        self.assertIn("course_lessons (migration 034) is absent", out)
        self.assertEqual(self.db.one("SELECT count(*) FROM questions"), 450)


class ManifestShaTest(unittest.TestCase):
    """No database: the first load on a box without the PDF still stamps the book's sha."""

    def test_absent_pdf_takes_the_sha_the_manifest_records(self):
        from schemas import SourceDocument
        doc = SourceDocument(title="t", publisher="p", language="en", grade="10",
                             subject="mathematics",
                             file_path="docs/Source/Gr10_Mathematics_Learner_Eng_v11.pdf")
        sha = load_seed.doc_sha(doc, Path(tempfile.mkdtemp()))
        self.assertEqual(sha, "c85561eca415a2c4288388f313e0a62a5a25fc8a21c12b7351e13866cfe4453c")

    def test_a_file_no_manifest_knows_still_gets_the_fallback(self):
        from schemas import SourceDocument
        doc = SourceDocument(title="t", publisher="p", language="en", grade="10",
                             subject="mathematics", file_path="docs/Source/nowhere.pdf")
        self.assertTrue(load_seed.doc_sha(doc, Path(tempfile.mkdtemp())).startswith("unavailable:"))


if __name__ == "__main__":
    unittest.main()
