"""book_config.py (B1): the per-book configuration every tool and workflow reads.

    uv run python -m unittest discover -s tests -p 'test_book*' -v
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import _scratchdb  # noqa: F401  (puts services/extraction on sys.path)
import book_config
from pydantic import ValidationError


class ConfigsTest(unittest.TestCase):
    def test_the_four_books_are_valid_and_the_three_shipped_ones_agree_with_their_bundles(self):
        books = book_config.all_books()
        self.assertEqual([b.book for b in books],
                         ["prep3-math-en", "prep3-social-ar", "prep3-arabic-ar", "g10-math"])
        self.assertEqual([b.status for b in books], ["loadable", "loadable", "loadable", "ingest"])
        # the repository's own check: green, with the Grade 10 book still going through the line
        self.assertEqual(book_config.check_all(), [])
        # a load asks the strict question: the shipped books pass it, and G10 has nothing to load yet
        for b in books[:3]:
            self.assertEqual(book_config.check_book(b, books), [], b.book)

    def test_every_path_in_a_config_is_repo_relative(self):
        for p in sorted(book_config.BOOKS_DIR.glob("*.json")):
            def walk(v):
                if isinstance(v, str):
                    self.assertFalse(v.startswith("/") or "/tmp" in v or "\\" in v,
                                     f"{p.name}: absolute or temp path {v!r}")
                elif isinstance(v, dict):
                    [walk(x) for x in v.values()]
                elif isinstance(v, list):
                    [walk(x) for x in v]
            walk(json.loads(p.read_text()))

    def test_course_subjects_replace_the_old_hardcoded_map(self):
        self.assertEqual(book_config.course_subjects(), {
            "course:prep3-math-en": "math", "course:prep3-social-ar": "social",
            "course:prep3-arabic-ar": "arabic", "course:us-g10-math-en": "math"})


class Grade10ConfigTest(unittest.TestCase):
    """books/g10-math.json pins the ids of specs/003 contracts/pipeline-handoff.md (T303) and
    carries G0's lesson unit as data (T352, T402). @covers FR-4311"""

    def setUp(self):
        self.g10 = book_config.load_book("g10-math")

    def test_ids_are_the_contracts(self):
        g = self.g10
        self.assertEqual((g.course_id, g.curriculum, g.subject, g.grade, g.id_prefixes),
                         ("course:us-g10-math-en", "us-american-en", "math", "10", ["g10m"]))
        self.assertEqual((g.language, g.direction, g.objectives_mode, g.sacred_content),
                         ("en", "ltr", "derived", False))
        self.assertEqual(g.notation, {"decimal": "point", "pair_separator": "comma"})
        self.assertEqual(g.program.id, "program:us-american-en")
        self.assertEqual(g.maths_source, "epub-images-md5")
        self.assertEqual(g.manifest, "services/extraction/manifest/g10-math-american.json")

    def test_ingest_status_is_green_for_the_repo_check_and_refused_for_a_load(self):
        books = book_config.all_books()
        self.assertEqual(self.g10.status, "ingest")
        # backlog 6: the PLANNED bundles, in load order, the course bundle first (T364); they need
        # not exist while the book is going through the line, and nothing loads them yet
        self.assertEqual([Path(x).name for x in self.g10.bundles],
                         ["g10m-course.json"] + [f"g10m-c{c:02d}.json" for c in range(1, 15)])
        self.assertEqual(len(self.g10.content_files), 65)
        self.assertNotIn(self.g10.bundle_paths()[0], book_config.bundle_order())
        self.assertIsNone(self.g10.parity, "the drift constant comes from the approved bundles (T364)")
        self.assertEqual(book_config.check_book(self.g10, books, allow_ingest=True), [])
        strict = book_config.check_book(self.g10, books)
        self.assertEqual(len(strict), 1)
        self.assertIn("nothing to load", strict[0])

    def test_an_ingest_books_planned_bundles_load_the_course_first(self):
        data = json.loads(self.g10.path.read_text())
        data["bundles"] = data["bundles"][1:] + data["bundles"][:1]
        b = book_config.Book.model_validate(data)
        self.assertTrue(any("loads first" in p
                            for p in book_config.check_book(b, book_config.all_books(), allow_ingest=True)))
        data["bundles"] = [data["bundles"][-1]] * 2
        b = book_config.Book.model_validate(data)
        self.assertTrue(any("listed twice" in p
                            for p in book_config.check_book(b, book_config.all_books(), allow_ingest=True)))

    def test_the_answer_rules_carry_the_books_known_answer_forms(self):
        # backlog 30/31: the raised dot, the product-of-primes and decimal form checks, and the five
        # printed answers that are not in the form their question asks for
        r = self.g10.answer_rules
        self.assertTrue(r.multiplication_dot)
        self.assertEqual(sorted(d.item for d in r.printed_not_in_asked_form),
                         ["Ex1-10:3h", "Ex1-10:3i", "Ex1-11:29n", "Ex1-5:15", "Ex1-6:14"])
        import re
        form = lambda stem: next((f.form for f in r.forms_from_stem if re.search(f.match, stem, re.I)), None)
        self.assertEqual(form("Represent the following as a product of its prime factors: 143"), "prime_factors")
        self.assertEqual(form("Write the following in decimal form, using the recurring decimal notation:"), "decimal")
        self.assertEqual(form("Write the following fractions as decimal numbers:"), "decimal")
        self.assertIsNone(form("Round off to two decimal places"))

    def test_an_ingest_book_may_not_share_a_prefix(self):
        data = json.loads(self.g10.path.read_text())
        data.update(book="rival-g10", course_id="course:rival-g10")
        rival = book_config.Book.model_validate(data)
        problems = book_config.check_book(rival, book_config.all_books(), allow_ingest=True)
        self.assertTrue(any("also g10-math's" in p for p in problems), problems)

    def test_the_gate_record_is_65_lessons(self):
        lu = self.g10.lesson_unit
        self.assertEqual(lu.gate.name, "G0")
        self.assertEqual(lu.expected_lessons, 65)
        self.assertEqual([s.id for s in lu.splits], ["P1a", "P1b", "P1c", "P1d", "P1e"])
        self.assertEqual([len(s.parts) for s in lu.splits], [3, 3, 2, 2, 2])
        self.assertEqual([(p.id, p.section) for p in lu.promotions], [("P2a", "6.1"), ("P2b", "7.1")])
        self.assertEqual([(m.id, m.sections, m.slug_section) for m in lu.merges],
                         [("P3a", ["1.2", "1.3"], "1.3"), ("P3b", ["5.2", "5.3", "5.4"], "5.3")])
        self.assertEqual([d.id for d in lu.declined], ["P3c", "P3d"], "the optional merges are not applied")

    def test_lesson_unit_rejects_contradictions(self):
        base = json.loads(self.g10.path.read_text())["lesson_unit"]
        bad_merge = json.loads(json.dumps(base))
        bad_merge["merges"][0]["slug_section"] = "1.4"
        twice = json.loads(json.dumps(base))
        twice["promotions"].append({"id": "P9", "section": "1.7"})
        one_part = json.loads(json.dumps(base))
        one_part["splits"][0]["parts"] = one_part["splits"][0]["parts"][:1]
        anchorless = json.loads(json.dumps(base))
        anchorless["splits"][0]["parts"][1] = {"title": "x"}
        for bad in (bad_merge, twice, one_part, anchorless):
            with self.assertRaises(ValidationError):
                book_config.LessonUnit.model_validate(bad)

    def test_superseded_bundle_is_ordered_before_its_replacement(self):
        names = [p.name for p in book_config.bundle_order()]
        self.assertLess(names.index("social-skeleton.json"), names.index("social-t1.json"))
        self.assertEqual(names[:1], ["unit1.json"], "the document-declaring bundle must lead")


class LessonOwnershipTest(unittest.TestCase):
    def setUp(self):
        self.math = book_config.load_book("prep3-math-en")

    def test_prefixes_claim_their_own_lessons(self):
        for lo in ("lo:u1-1-1", "lo:geo2-3-1", "lo:t2u1-2-1"):
            self.assertTrue(self.math.owns_lo(lo), lo)

    def test_a_new_curriculum_prefix_is_not_swallowed_by_a_short_one(self):
        # `u` must not claim `us10c…` (specs/003 research §8 example) or g10m…
        for lo in ("lo:us10c3-2-1", "lo:g10m6s3-1-1", "lo:soc1-2-3"):
            self.assertFalse(self.math.owns_lo(lo), lo)

    def test_two_books_claiming_one_lesson_is_reported(self):
        rival = book_config.Book.model_validate({
            "book": "rival", "title": "r", "course_id": "course:rival", "curriculum": "us-american-en",
            "subject": "math", "grade": "10", "language": "en", "direction": "ltr",
            "id_prefixes": ["geo"]})
        problems = book_config.check_book(self.math, [self.math, rival])
        self.assertTrue(any("also matched by rival" in p for p in problems))


class ValidationTest(unittest.TestCase):
    BASE = {"book": "x-book", "title": "x", "course_id": "course:x", "curriculum": "us-american-en",
            "subject": "math", "grade": "10", "language": "en", "direction": "ltr", "id_prefix": "g10m"}

    def test_single_id_prefix_shorthand(self):
        self.assertEqual(book_config.Book.model_validate(self.BASE).id_prefixes, ["g10m"])

    def test_offset_anchor_that_disagrees_with_its_regime_is_rejected(self):
        bad = dict(self.BASE, page_offsets=[{"label": "body", "pdf_minus_printed": 11,
                                             "verified_at": [[6, 17], [10, 22]]}])
        with self.assertRaises(ValidationError):
            book_config.Book.model_validate(bad)

    def test_course_id_and_curriculum_formats(self):
        for k, v in (("course_id", "course:G10 Math"), ("curriculum", "american")):
            with self.assertRaises(ValidationError):
                book_config.Book.model_validate(dict(self.BASE, **{k: v}))

    def test_unknown_keys_are_rejected(self):
        with self.assertRaises(ValidationError):
            book_config.Book.model_validate(dict(self.BASE, pdf_path="docs/x.pdf"))


class WorktreeSourcesTest(unittest.TestCase):
    def test_main_checkout_is_found_from_a_worktree_git_file(self):
        tmp = Path(tempfile.mkdtemp())
        main = tmp / "main"
        (main / ".git" / "worktrees" / "wt").mkdir(parents=True)
        (main / ".git" / "worktrees" / "wt" / "commondir").write_text("../..\n")
        wt = tmp / "wt"
        wt.mkdir()
        (wt / ".git").write_text(f"gitdir: {main / '.git' / 'worktrees' / 'wt'}\n")
        self.assertEqual(book_config.main_checkout_root(wt), main.resolve())
        self.assertIsNone(book_config.main_checkout_root(main))   # .git is a directory

    def test_workflow_args_carry_resolved_paths_at_runtime_only(self):
        args = book_config.workflow_args(book_config.load_book("prep3-social-ar"), ["soc1-2"])
        self.assertEqual(args["only"], ["soc1-2"])
        self.assertEqual(args["book"]["paths"]["repo_root"], str(book_config.REPO_ROOT))
        self.assertEqual(args["book"]["course_id"], "course:prep3-social-ar")
        self.assertEqual(args["book"]["page_offsets"][0]["pdf_minus_printed"], 7)


if __name__ == "__main__":
    unittest.main()
