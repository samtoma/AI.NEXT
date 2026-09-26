"""assemble_lesson_bundle.py (B8, T338): run outputs -> one SeedBundle per chapter.

    uv run --with pytest python -m pytest -q tests/test_assemble_lesson_bundle.py

Runs on the Chapter 8 fixture (tests/fixtures/g10-math/: G0 applied, 8.3 split in two;
every item invented for the tests). No database.

What it proves, and what it does not: every lesson in the bundle carries its book
provenance, as data (the store half is test_course_lessons.py); the book's notation is
normalised everywhere a student would read it; part n-1 -> part n prerequisites are
derived and checked for cycles but never written as the book's edges — the app's reading
of them (FR-4317, lib/book-sections.ts) is not proven here, so FR-4317 carries no marker.

@covers FR-4308
"""

from __future__ import annotations

import copy
import json
import shutil
import tempfile
import unittest
from pathlib import Path

import _scratchdb  # noqa: F401  (puts services/extraction on sys.path)
import assemble_lesson_bundle as alb
import book_config
import schemas

FIX = Path(__file__).resolve().parent / "fixtures" / "g10-math"


def fixture_copy() -> Path:
    tmp = Path(tempfile.mkdtemp(prefix="alb_test_"))
    shutil.copytree(FIX, tmp / "g10-math")
    return tmp / "g10-math"


def assemble(root: Path = FIX, chapters=None):
    book = book_config.load_book("g10-math")
    return alb.assemble(book, root / "manifest.json", root / "objectives", root / "runs" / "lesson",
                        chapters)


def edit(path: Path, fn) -> None:
    d = json.loads(path.read_text())
    fn(d)
    path.write_text(json.dumps(d, ensure_ascii=False, indent=2))


class AssembleFixtureTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bundles, cls.report = assemble()
        cls.ch8 = cls.bundles["g10m-c08.json"]

    def test_one_course_bundle_and_one_bundle_per_chapter(self):
        self.assertEqual(sorted(self.bundles), ["g10m-c08.json", "g10m-course.json"])
        course = self.bundles["g10m-course.json"]
        self.assertEqual({n["id"] for n in course["nodes"]},
                         {"course:us-g10-math-en", "program:us-american-en"})
        self.assertEqual(course["edges"], [{"src": "course:us-g10-math-en",
                                            "dst": "program:us-american-en", "type": "part_of"}])
        self.assertEqual(self.ch8["external_node_refs"], ["course:us-g10-math-en"])
        for b in self.bundles.values():
            schemas.SeedBundle.model_validate_json(json.dumps(b))

    def test_ids_are_minted_per_the_handoff_contract(self):
        qids = {q["id"] for q in self.ch8["questions"]}
        for want in ("q:g10m8s2-1-1:we01", "q:g10m8s2-1-1:ex8-2-2a", "q:g10m8s2-1-1:ex8-6-1",
                     "q:g10m8s4-1-1:we04"):
            self.assertIn(want, qids)
        self.assertEqual({v["id"] for v in self.ch8["visuals"]},
                         {"v:g10m8s1-1:001", "v:g10m8s2-1:001", "v:g10m8s3-1:001", "v:g10m8s4-1:001"})
        self.assertEqual(self.ch8["nodes"][0]["id"], "module:g10m-c08")
        los = [n["id"] for n in self.ch8["nodes"] if n["kind"] == "learning_objective"]
        self.assertEqual(los, ["lo:g10m8s1-1-1", "lo:g10m8s2-1-1", "lo:g10m8s3-1-1",
                               "lo:g10m8s3-2-1", "lo:g10m8s3-2-2", "lo:g10m8s4-1-1"])
        self.assertEqual([n["order_in_parent"] for n in self.ch8["nodes"][1:]], [1, 2, 3, 4, 5, 6])

    def test_every_lesson_carries_its_book_provenance(self):
        les = {l["slug"]: l for l in self.ch8["lessons"]}
        self.assertEqual(list(les), ["g10m8s1-1", "g10m8s2-1", "g10m8s3-1", "g10m8s3-2", "g10m8s4-1"])
        self.assertEqual(les["g10m8s3-1"]["part"], {"n": 1, "of": 2})
        self.assertEqual(les["g10m8s3-2"]["part"], {"n": 2, "of": 2})
        self.assertEqual(les["g10m8s3-2"]["sections"], [{"number": "8.3", "title": "Gradient of a line"}])
        self.assertNotIn("part", les["g10m8s2-1"])

    def test_part_prerequisites_are_derived_never_written_as_book_edges(self):
        prereq = {(e["src"], e["dst"]) for e in self.ch8["edges"] if e["type"] == "prerequisite_of"}
        self.assertNotIn(("lo:g10m8s3-1-1", "lo:g10m8s3-2-1"), prereq)
        self.assertEqual(self.report.derived_part_edges, 2)     # s3-1-1 -> s3-2-1, s3-2-2

    def test_answer_types_become_question_types_or_teaching(self):
        q = {x["id"]: x for x in self.ch8["questions"]}
        expr = q["q:g10m8s2-1-1:ex8-2-1"]
        self.assertEqual(expr["type"], "short")
        self.assertEqual(expr["choices"], {"marker": {"kind": "surd", "key": "2\\sqrt{2}",
                                                       "form": "simplest", "variables": []}})
        self.assertEqual(q["q:g10m8s3-2-1:ex8-4-1"]["type"], "mcq")
        # not markable: a worked-example library entry, never a question row (FR-4303)
        self.assertNotIn("q:g10m8s1-1-1:ex8-1-3", q)
        self.assertIn("expl:g10m8s1-1-1:ex8-1-3", {x["id"] for x in self.ch8["explanation_entries"]})
        self.assertTrue(all(x["source"] == "seed" for x in q.values()))

    def test_status_follows_the_three_way_check_and_g2(self):
        q = {x["id"]: x for x in self.ch8["questions"]}
        self.assertTrue(q["q:g10m8s2-1-1:ex8-2-2a"]["verified"], "disputed, accepted at G2")
        self.assertFalse(q["q:g10m8s2-1-1:ex8-2-2b"]["verified"], "disputed, no G2 verdict: held")
        self.assertTrue(q["q:g10m8s2-1-1:we01"]["verified"])

    def test_solution_source_is_a_field_and_in_the_source_note(self):
        for x in self.ch8["questions"]:
            self.assertRegex(x["source_note"], alb.SOLUTION_NOTE_RE)
            self.assertTrue(x["source_note"].endswith(x["solution_provenance"]))
        self.assertEqual(self.report.by_provenance,
                         {"book_worked": 4, "book_worked_epub": 12, "teachers_guide": 1})

    def test_notation_is_normalised_everywhere_a_student_reads(self):
        strings = []

        def walk(v):
            if isinstance(v, str):
                strings.append(v)
            elif isinstance(v, dict):
                [walk(x) for x in v.values()]
            elif isinstance(v, list):
                [walk(x) for x in v]
        walk({k: v for k, v in self.ch8.items() if k not in ("assembled_from", "source_document")})
        self.assertEqual([r for s in strings for r in alb.residual_notation(s)], [])
        q = {x["id"]: x for x in self.ch8["questions"]}
        self.assertEqual(q["q:g10m8s2-1-1:we02"]["answer"], "2.24")
        self.assertEqual(q["q:g10m8s4-1-1:ex8-6-2"]["choices"]["marker"]["key"], "(-1, 2)")
        self.assertIn("$(0, 0.5)$", q["q:g10m8s3-1-1:ex8-3-1"]["stem"])
        claim = next(c for c in self.ch8["claims"] if c["lo"] == "lo:g10m8s4-1-1")
        self.assertIn(r"\left(\frac{x_1 + x_2}{2}, \frac{y_1 + y_2}{2}\right)", claim["claim"])

    def test_claims_have_a_home_in_each_lessons_content_file(self):
        # backlog 4: S2's claims are served from seed/content/<slug>.json, where the lesson surfaces
        # read lesson content (lesson-content.ts); the bundle keeps them as the record
        c = self.report.content
        self.assertEqual(sorted(c), ["g10m8s1-1", "g10m8s2-1", "g10m8s3-1", "g10m8s3-2", "g10m8s4-1"])
        mine = c["g10m8s4-1"]
        self.assertEqual((mine["lessonId"], mine["language"], mine["direction"]), ("g10m8s4-1", "en", "ltr"))
        bundle = [x for x in self.ch8["claims"] if x["lo"].startswith("lo:g10m8s4-1-")]
        self.assertEqual([(x["lo"], x["claim"]) for x in mine["claims"]], [(x["lo"], x["claim"]) for x in bundle])
        self.assertEqual(mine["subtopics"][0]["key"], "lo:g10m8s4-1-1")
        self.assertIn(bundle[0]["claim"], mine["subtopics"][0]["exposition"], "the claims' own words, nothing added")
        for k in ("subtopics", "key_terms", "enrichment", "misconceptions", "interactives", "passages",
                  "out_of_scope", "qadaya"):
            self.assertIsInstance(mine[k], list, f"{k}: the shape lesson-content.ts reads")
        self.assertEqual(set(mine["source"]["assembled_from"]),
                         {"objectives/g10m8s4-1.json", "runs/lesson/g10m8s4-1.json"})

    def test_s1s_prerequisite_links_become_book_edges_with_their_evidence_left_behind(self):
        root = fixture_copy()
        edit(root / "objectives" / "g10m8s3-1.json", lambda d: d["prerequisites"].append(
            {"src": "lo:g10m8s2-1-1", "dst": "lo:g10m8s3-1-1", "signal": "uses_method",
             "evidence": [{"kind": "text", "anchor": "b00001", "printed_page": 293, "quote": "q"}],
             "check": {"verdict": "CONFIRMED"}}))
        bundles, _ = assemble(root)
        edges = [e for e in bundles["g10m-c08.json"]["edges"] if e["type"] == "prerequisite_of"]
        self.assertIn({"src": "lo:g10m8s2-1-1", "dst": "lo:g10m8s3-1-1", "type": "prerequisite_of"}, edges)

    @unittest.skipUnless(shutil.which("node"), "the marker check runs the app's answer-marker.ts in node")
    def test_the_apps_marker_holds_a_key_it_cannot_mark(self):
        # coordinator, 2026-09-26: no bundle may carry a spec or a key the app would reject
        self.assertEqual(self.report.held_by_marker, [], "every fixture key marks itself correct")
        self.assertGreater(self.report.counts["marker_specs_checked"], 0)
        root = fixture_copy()
        edit(root / "runs" / "lesson" / "g10m8s2-1.json", lambda d: next(
            i for i in d["items"] if i["ref"] == "Ex8-2:1")["marker"].update(key="d = 2 2"))   # flattened print
        bundles, report = assemble(root)
        q = {x["id"]: x for x in bundles["g10m-c08.json"]["questions"]}["q:g10m8s2-1-1:ex8-2-1"]
        self.assertFalse(q["verified"], "held: it loads at review, and G2 sees it")
        self.assertEqual([h["id"] for h in report.held_by_marker], ["q:g10m8s2-1-1:ex8-2-1"])
        res = alb.marker_check([{"id": "x", "choices": {"marker": {"kind": "expression", "key": "143",
                                                                   "form": "prime_factors"}}}])
        self.assertIn("unknown form", res["specs_rejected"][0]["why"])

    def test_reassembly_is_byte_identical(self):
        again, _ = assemble()
        self.assertEqual({k: alb.dump(v) for k, v in again.items()},
                         {k: alb.dump(v) for k, v in self.bundles.items()})


class NormaliserTest(unittest.TestCase):
    def test_pairs_intervals_sets_and_decimals(self):
        cases = {
            "(x; y)": "(x, y)", "[2; 5)": "[2, 5)", r"\{1; 2; 3\}": r"\{1, 2, 3\}",
            "(-2,5; 1)": "(-2.5, 1)", "3{,}317": "3.317", "R 3,50": "R 3.50",
            r"\left(\frac{a}{2}; \frac{b}{2}\right)": r"\left(\frac{a}{2}, \frac{b}{2}\right)",
        }
        for src, want in cases.items():
            self.assertEqual(alb.normalise(src)[0], want, src)

    def test_prose_and_top_level_semicolons_are_left_alone(self):
        for src in ("(see the table; then answer)", "x = 2; y = 3", "the Rand; 5 000 rand"):
            self.assertEqual(alb.normalise(src)[0], src)


class RefusalTest(unittest.TestCase):
    def refuses(self, mutate, match: str):
        root = fixture_copy()
        mutate(root)
        with self.assertRaises(alb.AssemblyError) as cm:
            assemble(root)
        self.assertIn(match, str(cm.exception))

    def test_parts_out_of_order_are_refused(self):
        def swap(root):
            def fn(m):
                ls = m["modules"][0]["lessons"]
                ls[2]["order_in_module"], ls[4]["order_in_module"] = 5, 3
            edit(root / "manifest.json", fn)
        self.refuses(swap, "not consecutive")

    def test_a_book_edge_against_the_part_order_is_a_cycle(self):
        def back(root):
            edit(root / "objectives" / "g10m8s3-1.json",
                 lambda d: d["prerequisites"].append({"src": "lo:g10m8s3-2-1", "dst": "lo:g10m8s3-1-1"}))
        self.refuses(back, "prerequisite cycle")

    def test_teacher_only_material_never_reaches_a_bundle(self):
        edit_ = lambda root: edit(root / "runs" / "lesson" / "g10m8s1-1.json",  # noqa: E731
                                  lambda d: d["teacher_only"].update(reached_claim=1))
        self.refuses(edit_, "FR-4408")

    def test_an_item_on_another_lessons_objective_is_refused(self):
        def wrong(root):
            edit(root / "runs" / "lesson" / "g10m8s1-1.json",
                 lambda d: d["items"][0].update(lo="lo:g10m8s2-1-1"))
        self.refuses(wrong, "not one of this lesson's objectives")

    def test_a_numeric_key_that_is_not_a_number_is_refused(self):
        def unit(root):
            edit(root / "runs" / "lesson" / "g10m8s2-1.json",
                 lambda d: d["items"][0].update(answer="5 units"))
        self.refuses(unit, "not a number")

    def test_nothing_is_written_when_validation_fails(self):
        root = fixture_copy()
        edit(root / "runs" / "lesson" / "g10m8s1-1.json",
             lambda d: d["teacher_only"].update(reached_claim=1))
        out = root.parent / "out"
        code = alb.main(["--book", "g10-math", "--manifest", str(root / "manifest.json"),
                         "--objectives", str(root / "objectives"),
                         "--runs", str(root / "runs" / "lesson"), "--out", str(out)])
        self.assertEqual(code, 1)
        self.assertFalse(out.exists())


class HandoffShapeTest(unittest.TestCase):
    """The shapes the neighbouring stages write: B3's manifest and the G2-applied runs."""

    def test_b3s_book_provenance_block_is_read(self):
        les = {"id": "g10m1s3-1", "title": "Rational and irrational numbers", "section": "1.3",
               "book_provenance": {"sections": [{"number": "1.2", "title": "The real number system",
                                                 "code": "EMA3"},
                                                {"number": "1.3", "title": "Rational and irrational numbers",
                                                 "code": "EMA4"}],
                                   "part": None, "chapter_intro": False, "group_key": "1.3"}}
        l = alb.book_lesson({"id": "module:g10m-c01"}, les)
        self.assertEqual([s.number for s in l.sections], ["1.2", "1.3"])
        self.assertIsNone(l.part)

    def test_a_figure_of_an_item_excluded_at_g2_stays_with_its_objective(self):
        root = fixture_copy()

        def exclude(d):
            it = next(i for i in d["items"] if i["ref"] == "Ex8-1:1")
            it["g2"] = {"verdict": "exclude", "by": "fixture reviewer", "note": "ambiguous figure"}
        edit(root / "runs" / "lesson" / "g10m8s1-1.json", exclude)
        bundles, report = assemble(root)
        v = next(x for x in bundles["g10m-c08.json"]["visuals"] if x["id"] == "v:g10m8s1-1:001")
        self.assertIsNone(v["question"])
        self.assertEqual(report.counts["visuals_detached_from_non_questions"], 1)
        self.assertIn({"lesson": "g10m8s1-1", "ref": "Ex8-1:1", "kind": "exercise",
                       "reason": "excluded at G2 by fixture reviewer: ambiguous figure"}, report.excluded)


class CheckLessonsTest(unittest.TestCase):
    def lesson(self, slug, number, part=None):
        return schemas.Lesson(slug=slug, title="t", module="module:x",
                              sections=[{"number": number, "title": "s"}], part=part)

    def test_a_section_claimed_twice_without_parts_is_a_defect(self):
        problems = alb.check_lessons([self.lesson("g10m1s2-1", "1.2"), self.lesson("g10m1s3-1", "1.2")])
        self.assertTrue(any("claimed by both" in p for p in problems))

    def test_parts_numbered_one_to_m(self):
        ok = [self.lesson("g10m1s7-1", "1.7", {"n": 1, "of": 2}),
              self.lesson("g10m1s7-2", "1.7", {"n": 2, "of": 2})]
        self.assertEqual(alb.check_lessons(ok), [])
        gap = [self.lesson("g10m1s7-1", "1.7", {"n": 1, "of": 3}),
               self.lesson("g10m1s7-3", "1.7", {"n": 3, "of": 3})]
        self.assertTrue(alb.check_lessons(gap))


if __name__ == "__main__":
    unittest.main()
