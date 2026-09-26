"""parity_check.py knows a manifest-built book by its source fingerprint (FR-4207, T340).

    AINEXT_TEST_PG="host=127.0.0.1 port=5432" uv run --with pytest python -m pytest -q tests/test_parity_source.py

FR-4207 asks for the book "by its source fingerprint and its counts". The counts are the
book config's `parity` block (tests/test_parity_check.py); this proves the fingerprint half
for a book whose Stage-0 manifest records its PDF's sha256 (Grade 10), and that a book with
no manifest (Prep-3) is unaffected. The Grade 10 COUNT constant is recorded after G5 (T364),
so this file does not cover FR-4207 on its own and carries no marker.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from _scratchdb import ScratchDB, run_loader, skip_without_db
import assemble_lesson_bundle as alb
import book_config
import parity_check

FIX = Path(__file__).resolve().parent / "fixtures" / "g10-math"
G10 = "course:us-g10-math-en"


@skip_without_db()
class SourceFingerprintTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = ScratchDB("psrc").create()
        tmp = Path(tempfile.mkdtemp(prefix="parity_src_"))
        bundles, _ = alb.assemble(book_config.load_book("g10-math"), FIX / "manifest.json",
                                  FIX / "objectives", FIX / "runs" / "lesson")
        paths = []
        for name, b in sorted(bundles.items(), key=lambda kv: "course" not in kv[0]):
            (tmp / name).write_text(alb.dump(b))
            paths.append(str(tmp / name))
        run_loader(cls.db.dsn, *paths, "--course", G10)

    @classmethod
    def tearDownClass(cls):
        cls.db.drop()

    def test_the_loaded_course_carries_the_manifests_sha(self):
        fp = parity_check.fingerprint(self.db.dsn, G10)
        self.assertEqual(fp.source_sha256, parity_check.expected_source_sha(G10))
        self.assertEqual(parity_check.check_source(fp, G10), [])
        self.assertEqual((fp.modules, fp.learning_objectives, fp.questions_total, fp.visuals),
                         (1, 6, 17, 4))

    def test_rows_stamped_with_another_document_are_red(self):
        self.db.q("INSERT INTO source_documents (sha256, title, publisher, language, grade, subject) "
                  "VALUES ('unavailable:0000', 't', 'p', 'en', '10', 'mathematics')")
        self.db.q("UPDATE graph_nodes SET source_sha256 = 'unavailable:0000' WHERE id = 'lo:g10m8s1-1-1'")
        try:
            fp = parity_check.fingerprint(self.db.dsn, G10)
            problems = parity_check.check_source(fp, G10)
            self.assertEqual(len(problems), 1)
            self.assertIn("source_sha256", problems[0])
        finally:
            self.db.q("UPDATE graph_nodes SET source_sha256 = %s WHERE id = 'lo:g10m8s1-1-1'",
                      (parity_check.expected_source_sha(G10),))


class NoManifestTest(unittest.TestCase):
    def test_a_book_without_a_manifest_is_checked_on_counts_only(self):
        self.assertIsNone(parity_check.expected_source_sha("course:prep3-math-en"))


if __name__ == "__main__":
    unittest.main()
