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
        self.assertEqual(self.report.visuals_dropped, [], "no fixture figure draws an unknown (A8)")
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

    @unittest.skipUnless(shutil.which("node"), "the marker check runs the app's answer-marker.ts in node")
    def test_a_key_the_typing_agent_wrapped_in_dollars_is_bare_maths_not_a_hold(self):
        # Chapter 1 (2026-10-01): the typing agent copied the EPUB's final "$(a-3)(a+3)$" as the key; the app's marker refuses the
        # "$", and 29 correct questions were held "unanswerable" for a delimiter. The assembly removes one enclosing pair, records it.
        self.assertEqual(self.report.keys_unwrapped, [])
        root = fixture_copy()
        edit(root / "runs" / "lesson" / "g10m8s2-1.json", lambda d: next(
            i for i in d["items"] if i["ref"] == "Ex8-2:1")["marker"].update(key="$" + next(
                i for i in d["items"] if i["ref"] == "Ex8-2:1")["marker"]["key"] + "$"))
        bundles, report = assemble(root)
        q = {x["id"]: x for x in bundles["g10m-c08.json"]["questions"]}["q:g10m8s2-1-1:ex8-2-1"]
        self.assertNotIn("$", q["choices"]["marker"]["key"])
        self.assertNotIn("$", q["answer"], "the answer text is the bare key, rendered")
        self.assertTrue(q["verified"], "marked live, not held for a delimiter")
        self.assertEqual(report.held_by_marker, [])
        self.assertEqual([x["id"] for x in report.keys_unwrapped], ["q:g10m8s2-1-1:ex8-2-1"])
        self.assertTrue(report.keys_unwrapped[0]["was"].startswith("$"))

    def test_unwrap_math_delimiters_only_removes_one_enclosing_pair(self):
        un = alb.unwrap_math_delimiters
        self.assertEqual(un("$(a-3)(a+3)$"), "(a-3)(a+3)")
        self.assertEqual(un("  $$x^{2}$$ "), "x^{2}")
        self.assertEqual(un("$\\frac{(a+3b)^{2}(a-3b)}{3}$"), "\\frac{(a+3b)^{2}(a-3b)}{3}")
        self.assertEqual(un("(a-3)(a+3)"), "(a-3)(a+3)", "a bare key is untouched")
        self.assertEqual(un("$a$ and $b$"), "$a$ and $b$", "two formulas are not one wrapped key")
        self.assertEqual(un("$5"), "$5", "an unbalanced dollar is left for the marker to refuse")
        self.assertIsNone(un(None))
        self.assertEqual(un(""), "")

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


class EscapedDollarTest(unittest.TestCase):
    """Chapter 9's exchange-rate lessons carry a dollar sign written `\\$` inside maths ("$\\text{\\$ 7.00}$", "$\\text{\\$1}&=\\text{R11.42}$", "( $\\$$ )"). The app's
    TeXRenderer splits on `/(\\$[^$]+\\$)/g`, which knows no escape: the `$` of a `\\$` closed the segment, KaTeX saw half a command, and every later segment of
    the string paired its dollars the wrong way round. Normalised at assembly into a form with no `$` character; the validator (katex_check.mjs, the app's
    own split) stays as strict as it was and is what these tests ask."""

    ROWS = {"$\\text{\\$ 7.00}$": "$\\text{\\textdollar{} 7.00}$",
            "$\\text{\\$1}&=\\text{R11.42}$": "$\\text{\\textdollar{}1}&=\\text{R11.42}$",
            "( $\\$$ )": "( $\\text{\\textdollar}$ )",
            "costs $\\$\u00a0\\text{21\\ 900}$ now": "costs $\\text{\\textdollar}\u00a0\\text{21\\ 900}$ now",
            "gets $\\$\\text{12}$ .": "gets $\\text{\\textdollar}\\text{12}$ .",
            "$\\mathrm{\\$}5$": "$\\mathrm{\\text{\\textdollar}}5$",
            "$\\text{a {\\$} b}+\\$$": "$\\text{a {\\textdollar{}} b}+\\text{\\textdollar}$",
            "the dollar, \\$, is not $x$": "the dollar, $\\text{\\textdollar}$, is not $x$"}

    def test_the_sign_is_written_without_a_dollar(self):
        for raw, want in self.ROWS.items():
            got, n = alb.normalise_dollars(raw)
            self.assertEqual(got, want, raw)
            self.assertEqual(n, raw.count("\\$") - raw.count("\\\\$"), raw)

    def test_nothing_else_is_touched(self):
        # a line break before the closing dollar is not an escaped dollar; braces, a lone "\\" and ordinary maths are left as they are
        for raw in ("$\\frac{35.20}{7}=\\text{5.03}\\\\$", "$a\\\\$ and $b$", "$\\{1,2\\}$", "no maths", "$x$ and $\\text{R}\\ 5$", "50% of $x$",
                    "$\\text{text} \\textbf{b}$", "", "$\\\\\\\\$"):
            self.assertEqual(alb.normalise_dollars(raw), (raw, 0), raw)

    def test_nothing_but_the_sign_changes(self):
        # undoing the rewrite gives the input back, so nothing else was added, dropped or moved
        for raw, want in self.ROWS.items():
            back = want.replace("$\\text{\\textdollar}$", "\\$").replace("\\text{\\textdollar}", "\\$").replace("\\textdollar{}", "\\$")
            self.assertEqual(back, raw)

    def test_it_is_idempotent(self):
        for raw in self.ROWS:
            once, _ = alb.normalise_dollars(raw)
            self.assertEqual(alb.normalise_dollars(once), (once, 0), raw)

    @unittest.skipUnless(shutil.which("node"), "the app's KaTeX runs in node")
    def test_the_apps_own_split_and_katex_refuse_the_raw_form_and_accept_the_new_one(self):
        raw = [{"where": f"r{i}", "text": t} for i, t in enumerate(self.ROWS)]
        self.assertTrue(alb.katex_errors(raw), "the validator must keep flagging a raw \\$: that is what the app does with it")
        fixed = [{"where": r["where"], "text": alb.normalise_dollars(r["text"])[0]} for r in raw]
        self.assertEqual(alb.katex_errors(fixed), [])

    @unittest.skipUnless(shutil.which("node"), "the app's KaTeX runs in node")
    def test_the_dollar_still_prints_and_the_text_after_it_still_pairs(self):
        # the app's split on the new text: the maths segments are exactly the ones written, none half a command, and the plain text between is untouched
        import re
        t, _ = alb.normalise_dollars("American tourists $\\text{\\$ 7.00}$ Dutch tourists $\\text{\u20ac 9.70}$ Brazilian")
        parts = re.split(r"(\$[^$]+\$)", t)
        self.assertEqual(parts, ["American tourists ", "$\\text{\\textdollar{} 7.00}$", " Dutch tourists ", "$\\text{\u20ac 9.70}$", " Brazilian"])
        self.assertEqual(alb.katex_errors([{"where": "a", "text": t}]), [])

    def test_a_bundle_and_a_lesson_content_file_are_cleaned_and_the_report_counts_it(self):
        rep = alb.Report()
        out = alb.respace_tree({"questions": [{"id": "q:1", "stem": "He pays $\\text{\\$ 8,49}$ and $\\$\\text{2}$ shipping.",
                                               "solution": ["$\\text{\\$1}&=\\text{R11.42}$"], "source": "$\\$"}],
                               "claims": [{"lo": "lo:x", "quote": "the American dollar ( $\\$$ )"}]}, rep)
        flat = json.dumps(out, ensure_ascii=False)
        q = out["questions"][0]
        self.assertNotIn("\\\\$", flat.replace("\\\\\\\\", "").replace(q["source"].replace("\\", "\\\\"), ""))
        self.assertEqual(q["source"], "$\\$", "metadata is never touched")
        self.assertEqual(out["claims"][0]["quote"], "the American dollar ( $\\text{\\textdollar}$ )")
        self.assertEqual(rep.dollars, 4)
        self.assertEqual(rep.as_dict()["escaped_dollars_normalised"], 4)

    def test_the_entity_pass_sees_the_right_maths_after_it(self):
        # an entity inside `$\\text{\\$ 7&#176;}$` is inside maths: the degree sign is ^{\\circ} there, which needs the segment not to be cut at the `\\$`
        rep = alb.Report()
        out = alb.respace_tree({"stem": "$\\text{\\$ 7}&#176;$ and 5&#176;"}, rep)
        self.assertEqual(out["stem"], "$\\text{\\textdollar{} 7}^{\\circ}$ and 5\u00b0")


if __name__ == "__main__":
    unittest.main()


class ConsistencyReviewTest(unittest.TestCase):
    """The consistency review of 2026-09-27 (section A): what a student would have seen, fixed at assembly.
    A1 the answer text is the marker key; A2 glued LaTeX re-spaced and judged by the app's KaTeX; A3 a question
    that shows [figure] with no figure is held; A4 a pair written with a comma, only where provable; A8 a figure
    never draws the unknown; A9 the book's form rules reach the marker."""

    def test_a4_a_comma_pair_only_where_the_other_side_is_a_pair(self):
        out, c = alb.normalise(r"$\begin{align*}(-1,4)&=(\frac{x_A+0}{2};\frac{y_A+0}{2})\end{align*}$")
        self.assertIn("(-1, 4)&=", out)
        self.assertEqual(c["pair_by_context"], 1)
        out, c = alb.normalise(r"$\sqrt{(7,5)^{2}+(-6)^{2}}$")          # the book's bracketed decimal
        self.assertEqual(out, r"$\sqrt{(7.5)^{2}+(-6)^{2}}$")
        out, c = alb.normalise(r"$\begin{align*}y&=mx+c\\(-2,5)&=(0,5)(-1)+c\end{align*}$")
        self.assertIn("(-2.5)&=(0.5)(-1)+c", out)
        self.assertEqual(c["pair_ambiguous"], 1, "a whole side that is not provably a pair is listed for G2")

    def test_a1_several_values_read_as_the_answer(self):
        self.assertEqual(alb.answer_text({"kind": "values", "key": "3; 9", "variables": ["x"]}),
                         r"x = 3 \text{ or } x = 9")
        self.assertEqual(alb.answer_text({"kind": "values", "key": r"\sqrt{26}; \sqrt{8}", "variables": []}),
                         r"\sqrt{26},\ \sqrt{8}")
        self.assertEqual(alb.answer_text({"kind": "expression", "key": r"\frac{9}{11}"}), r"\frac{9}{11}")
        b = {"questions": [{"id": "q:x:1", "answer": "9 11", "choices": {"marker": {"kind": "expression",
                                                                                     "key": r"\frac{9}{11}"}}}]}
        self.assertEqual(len(alb.answer_problems(b)), 1)

    @unittest.skipUnless(shutil.which("node"), "the app's KaTeX runs in node")
    def test_a2_respacing_follows_katex(self):
        for glued, spaced in ((r"$\triangleABC$", r"$\triangle ABC$"), (r"$2\timesm$", r"$2\times m$"),
                              (r"$\thereforey=2$", r"$\therefore y=2$"), (r"$x=3\m$", r"$x=3\ m$"),
                              (r"$a\neM$", r"$a\ne M$"), (r"$a\neq b$", r"$a\neq b$"),
                              (r"$\frac{1}{2}\\y&=1$", r"$\frac{1}{2}\\y&=1$")):
            self.assertEqual(alb.respace_latex(glued)[0], spaced, glued)
        self.assertEqual(alb.respace_latex("$x_{1}=-2y_{1}=-5x_{2}=7y_{2}=-2$")[0],
                         r"$x_{1}=-2 \quad y_{1}=-5 \quad x_{2}=7 \quad y_{2}=-2$")
        self.assertEqual(alb.respace_latex("$x_{1}=y_{1}=2$")[0], "$x_{1}=y_{1}=2$", "two tokens: not provable")
        errs = alb.katex_errors([{"where": "a", "text": r"$\triangleABC$"}, {"where": "b", "text": r"$\triangle ABC$"}])
        self.assertEqual([e["where"] for e in errs], ["a"])

    def test_a2_a_backslash_before_a_digit_becomes_a_control_space(self):
        # S0b keeps the book's thousands space as \text{57\000\000} (whitespace stripped before hashing); KaTeX
        # refuses \0, which made load_seed refuse chapters 9, 10 and 13. A line break \\ before a digit stays.
        self.assertEqual(alb._digit_escapes(r"$\text{57\000\000}$"), (r"$\text{57\ 000\ 000}$", 2))
        self.assertEqual(alb._digit_escapes(r"$57\000$ and $x\\2$"), (r"$57\ 000$ and $x\\2$", 1))
        self.assertEqual(alb._digit_escapes(r"$\frac{1}{2}$"), (r"$\frac{1}{2}$", 0))
        if shutil.which("node"):
            text, n, _ = alb.respace_latex(r"The population is $\text{57\000\000}$ people.")
            self.assertEqual((text, n), (r"The population is $\text{57\ 000\ 000}$ people.", 2))
            self.assertEqual(alb.katex_errors([{"where": "a", "text": text}]), [])

    def test_a8_a_figure_never_draws_the_unknown(self):
        q = {"id": "q:1", "stem": "[figure] Line $AB$ has gradient 2. Find the missing co-ordinate of $B(1, y)$."}
        drawn = {"spec": {"points": [{"x": -1, "y": 0, "label": "A"}, {"x": 1, "y": 4, "label": "B"}]}}
        self.assertIn("unknown point B", alb.visual_gives_answer(q, drawn))
        own_label = {"spec": {"points": [{"x": 1, "y": 0.8, "label": "B(2;a)"}]}}
        self.assertIn("unknown point", alb.visual_gives_answer({"id": "q:2", "stem": "[figure] Find a."}, own_label))
        mid = {"id": "q:3", "stem": "Find the mid-point $M(x; y)$.", "choices": {"marker": {"kind": "coordinates", "key": "(1, 0)"}}}
        self.assertIn("unknown point M", alb.visual_gives_answer(mid, {"spec": {"points": [{"x": 1, "y": 0, "label": "M"}]}}))
        read = {"id": "q:4", "stem": "[figure] Find the coordinates of point $D$.",
                "choices": {"marker": {"kind": "coordinates", "key": "(3, 3)"}}}
        self.assertIsNone(alb.visual_gives_answer(read, {"spec": {"points": [{"x": 3, "y": 3, "label": "D"}]}}),
                          "a point read off the figure is the question's data (Ex8-1:1)")
        fine = {"spec": {"points": [{"x": -1, "y": 0, "label": "A(-1;0)"}, {"x": 3, "y": 2, "label": "C"}]}}
        self.assertIsNone(alb.visual_gives_answer(q, fine))

    def test_a3_a_question_that_shows_a_figure_it_does_not_have_is_held(self):
        rep = alb.Report()
        b = {"questions": [{"id": "q:1", "stem": "[figure] Find $y$.", "verified": True},
                           {"id": "q:2", "stem": "[figure] Find $x$.", "verified": True},
                           {"id": "q:3", "stem": "Find $x$.", "verified": True}],
             "visuals": [{"id": "v:1", "question": "q:2", "spec": {"points": [{"x": 0, "y": 0, "label": "O"}]}}]}
        alb.police_figures(b, rep)
        self.assertEqual([q["verified"] for q in b["questions"]], [False, True, True])
        self.assertEqual(rep.held_for_figure, ["q:1"])
        # a worked example's figure may show its answer (the book's does); an exercise's may not
        we = {"questions": [{"id": "q:x-1:we07", "stem": "Find $y$ given $D(7, y)$.", "verified": True},
                            {"id": "q:x-1:ex8-4-15", "stem": "[figure] Find $a$ for $B(2, a)$.", "verified": True}],
              "visuals": [{"id": "v:1", "question": "q:x-1:we07", "spec": {"points": [{"x": 7, "y": 4, "label": "D"}]}},
                          {"id": "v:2", "question": "q:x-1:ex8-4-15", "spec": {"points": [{"x": 2, "y": 0.8, "label": "B"}]}}]}
        rep = alb.Report()
        alb.police_figures(we, rep)
        self.assertEqual([v["id"] for v in we["visuals"]], ["v:1"])
        self.assertEqual([x["visual"] for x in rep.visuals_dropped], ["v:2"])

    def test_a9_a_form_rule_reaches_the_marker(self):
        book = book_config.load_book("g10-math")
        rule = book_config.FormRule(match=r"in the form \$?\s*y\s*=\s*mx\s*\+\s*c", form="subject", subject="y")
        book = book.model_copy(update={"answer_rules": book.answer_rules.model_copy(update={"forms_from_stem": [rule]})})
        b = {"questions": [{"id": "q:1", "stem": "Find the equation in the form $y = mx + c$.",
                            "choices": {"marker": {"kind": "equation", "key": "y=2x+1", "form": None}}},
                           {"id": "q:2", "stem": "Find the gradient in the form $y = mx + c$.",
                            "choices": {"marker": {"kind": "expression", "key": "2", "form": None}}}]}
        self.assertEqual(len(alb.form_problems(b, book)), 1)
        rep = alb.Report()
        alb.apply_form_rules(b, book, rep)
        self.assertEqual(b["questions"][0]["choices"]["marker"]["form"], {"subject": "y"})
        self.assertIsNone(b["questions"][1]["choices"]["marker"]["form"], "a subject form needs an equation")
        self.assertEqual(alb.form_problems(b, book), [])
        with self.assertRaises(ValueError):
            book_config.FormRule(match="x", form="subject")


class HtmlEntityTest(unittest.TestCase):
    """Chapter 5's EPUB left numeric HTML character references in its text and inside its maths ("$\\cos30&#176;=$"): KaTeX refuses the "&" and 28
    questions showed a red error. A reference is the character it names; inside $…$ the degree sign is ^{\\circ}, the book's own spelling beside it."""

    def test_a_reference_is_the_character_it_names(self):
        cases = {"$\\cos30&#176;=$": ("$\\cos30^{\\circ}=$", 1),
                 "Use $\\tan45&#176;=1$ and 45&#176; and &deg;.": ("Use $\\tan45^{\\circ}=1$ and 45° and °.", 3),
                 "$\\sin\\text{45}&#176;$": ("$\\sin\\text{45}^{\\circ}$", 1),
                 "$x&#8722;1$": ("$x\u22121$", 1),
                 "$x&#x2212;1$": ("$x\u22121$", 1)}
        for raw, want in cases.items():
            self.assertEqual(alb.unescape_entities(raw), want, raw)

    def test_nothing_else_is_touched(self):
        for raw in ("a & b", "$a&b$", "AT&T", "&#0;", "&#9999999999;", "no entity", "$\\begin{align*}x&=1\\end{align*}$", "&nbsp;"):
            self.assertEqual(alb.unescape_entities(raw), (raw, 0), raw)

    def test_a_bundle_is_cleaned_and_the_report_counts_it(self):
        rep = alb.Report()
        out = alb.respace_tree({"questions": [{"id": "q:1", "stem": "Calculate $\\sin45&#176;\\times\\cos45&#176;$",
                                               "solution": ["$\\tan45&#176;=1$"], "source": "x&#176;"}]}, rep)
        q = out["questions"][0]
        self.assertNotIn("&#", q["stem"] + "".join(q["solution"]))
        self.assertIn("^{\\circ}", q["stem"])
        self.assertEqual(q["source"], "x&#176;", "metadata is never touched")
        self.assertEqual(rep.entities, 3)
        self.assertEqual(rep.as_dict()["html_entities_unescaped"] if hasattr(rep, "as_dict") else 3, 3)


if __name__ == "__main__":
    unittest.main()
