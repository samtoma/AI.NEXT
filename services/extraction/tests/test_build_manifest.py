"""build_manifest.py (B3, T333, T402, T403): the Grade 10 manifest with G0 applied, and book provenance.

    uv run --project services/extraction --with pytest python -m pytest -q services/extraction/tests/test_build_manifest.py

- The COMMITTED manifest is checked on every run (no sources needed): 65 lessons, every lesson's
  book provenance (FR-4311), the ids of contracts/pipeline-handoff.md, parts consecutive (FR-4312),
  every exercise item placed exactly once.
- The build's own rules are checked on small synthetic records.
- When work/g10-math/ exists (after `source_adapter.py g10-math`), the manifest is rebuilt and must
  equal the committed one byte for byte.

@covers FR-4311, FR-4312
"""

from __future__ import annotations

import collections
import json
import unittest
from pathlib import Path

import _scratchdb  # noqa: F401  (puts services/extraction on sys.path)
import book_config
import build_manifest as bm

BOOK = book_config.load_book("g10-math")
MANIFEST = BOOK.repo_path(BOOK.manifest)
WORK = BOOK.work_dir()


def lessons(m):
    return [l for mod in m["modules"] for l in mod["lessons"]]


class CommittedManifest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = json.loads(MANIFEST.read_text())
        cls.by_id = {l["id"]: l for l in lessons(cls.m)}

    def test_gate_and_ids(self):
        b = self.m["book"]
        self.assertEqual((b["course_id"], b["curriculum"], b["id_prefix"]), ("course:us-g10-math-en", "us-american-en", "g10m"))
        self.assertEqual(b["program"]["id"], "program:us-american-en")
        self.assertEqual(b["edition_check"]["verdict"], "match")
        self.assertIn("G0 passed 2026-09-25", self.m["status"])
        self.assertEqual([mod["id"] for mod in self.m["modules"]], [f"module:g10m-c{c:02d}" for c in range(1, 15)])

    def test_65_lessons_each_with_book_provenance(self):
        ls = lessons(self.m)
        self.assertEqual(len(ls), 65)
        self.assertEqual(self.m["totals"]["lessons_by_provenance"],
                         {"section": 49, "part": 12, "merged": 2, "chapter_intro": 2})
        for l in ls:
            bp = l["book_provenance"]
            self.assertTrue(bp["sections"], l["id"])
            self.assertEqual(set(bp), {"sections", "part", "chapter_intro", "group_key"})
            for s in bp["sections"]:
                self.assertRegex(s["number"], r"^\d{1,2}\.\d{1,2}$")
                self.assertTrue(s["title"])
            self.assertRegex(l["id"], r"^g10m\d{1,2}s\d{1,2}-\d$")
            self.assertTrue(bm.SLUG_RE.match(l["id"]))
            self.assertTrue(l["lo_id_pattern"].startswith(f"lo:{l['id']}-"))

    def test_g0_decisions_as_contracted(self):
        by = self.by_id
        # merges take the slug of the section carrying the practice (contracts/pipeline-handoff.md)
        self.assertEqual([s["number"] for s in by["g10m1s3-1"]["book_provenance"]["sections"]], ["1.2", "1.3"])
        self.assertEqual([s["number"] for s in by["g10m5s3-1"]["book_provenance"]["sections"]], ["5.2", "5.3", "5.4"])
        self.assertNotIn("g10m1s2-1", by)
        self.assertNotIn("g10m5s2-1", by)
        self.assertNotIn("g10m5s4-1", by)
        for intro in ("g10m6s1-1", "g10m7s1-1"):
            self.assertTrue(by[intro]["book_provenance"]["chapter_intro"], intro)
            self.assertEqual(by[intro]["order_in_module"], 1)
        parts = {"1.7": 3, "6.6": 3, "8.3": 2, "13.2": 2, "13.3": 2}
        for sec, n in parts.items():
            ch, s = sec.split(".")
            for k in range(1, n + 1):
                p = by[f"g10m{ch}s{s}-{k}"]["book_provenance"]
                self.assertEqual((p["part"], p["group_key"]), ({"n": k, "of": n}, sec))
        # the optional merges were declined: 14.4–14.7 stay four lessons
        for s in (4, 5, 6, 7):
            self.assertEqual(len(by[f"g10m14s{s}-1"]["book_provenance"]["sections"]), 1)

    def test_part_inventories_are_the_reports(self):
        items = lambda i: sum(x["items"] for x in self.by_id[i]["exercises"])
        we = lambda i: [w["n"] for w in self.by_id[i]["worked_examples"]]
        self.assertEqual([items(f"g10m1s7-{k}") for k in (1, 2, 3)], [52, 26, 27])
        self.assertEqual([items("g10m8s3-1"), items("g10m8s3-2")], [9, 27])
        self.assertEqual([items("g10m13s2-1"), items("g10m13s2-2")], [8, 6])
        self.assertEqual([items("g10m13s3-1"), items("g10m13s3-2")], [7, 11])
        self.assertEqual([we(f"g10m6s6-{k}") for k in (1, 2, 3)], [[16, 17], [18, 19], [20, 21]])
        self.assertEqual((items("g10m6s1-1"), items("g10m7s1-1"), we("g10m7s1-1")), (36, 19, [1]))
        # 6-6 closes 6.6 and belongs to no one part: S1 maps it
        ch6 = next(m for m in self.m["modules"] if m["chapter"] == 6)
        self.assertEqual([(g["section"], [x["label"] for x in g["exercises"]]) for g in ch6["section_exercises_to_map"]],
                         [("6.6", ["6-6"])])

    def test_parts_consecutive_and_items_placed_once(self):
        self.assertEqual(bm.check_manifest(self.m, BOOK), [])
        t = self.m["totals"]
        self.assertEqual(t["exercise_items"], 2531)
        self.assertEqual(t["exercise_items_in_lessons"] + t["exercise_items_end_of_chapter"]
                         + t["exercise_items_in_sets_to_map"] + t["exercise_items_in_unpromoted_introductions"], 2531)
        self.assertEqual(t["worked_examples"], 174)
        self.assertEqual(t["worked_examples_in_lessons"], 174)

    def test_lessons_per_chapter(self):
        per = [len(m["lessons"]) for m in self.m["modules"]]
        self.assertEqual(per, [8, 3, 1, 6, 5, 9, 4, 5, 4, 5, 1, 1, 6, 7])
        self.assertEqual(sum(per), 65)


class Rules(unittest.TestCase):
    def rec(self, sec, title="T", code="EMA1"):
        return {"section": sec, "title": title, "code": code}

    def test_provenance_shape(self):
        p = bm.provenance([self.rec("1.7", "Factorisation")], part={"n": 2, "of": 3}, group_key="1.7")
        self.assertEqual(p, {"sections": [{"number": "1.7", "title": "Factorisation", "code": "EMA1"}],
                             "part": {"n": 2, "of": 3}, "chapter_intro": False, "group_key": "1.7"})
        self.assertEqual(bm.provenance([self.rec("6.1")], chapter_intro=True)["group_key"], "6.1")
        self.assertEqual((bm.slug_for("13.2", 2), bm.slug_for("1.3")), ("g10m13s2-2", "g10m1s3-1"))

    def _manifest(self, ids_parts):
        ls = []
        for i, (lid, part) in enumerate(ids_parts, 1):
            ls.append({"id": lid, "order_in_module": i, "exercises": [],
                       "book_provenance": {"sections": [{"number": "1.7", "title": "F", "code": "E"}],
                                           "part": part, "chapter_intro": False, "group_key": "1.7" if part else lid}})
        return {"modules": [{"id": "module:g10m-c01", "lessons": ls, "end_of_chapter_exercise": None}],
                "totals": {"exercise_items": 0}}

    def test_check_manifest_catches_split_parts_and_bad_ids(self):
        book = book_config.Book.model_validate({**json.loads(BOOK.path.read_text()),
                                                "lesson_unit": None})
        ok = self._manifest([("g10m1s7-1", {"n": 1, "of": 2}), ("g10m1s7-2", {"n": 2, "of": 2})])
        self.assertEqual(bm.check_manifest(ok, book), [])
        apart = self._manifest([("g10m1s7-1", {"n": 1, "of": 2}), ("g10m1s8-1", None), ("g10m1s7-2", {"n": 2, "of": 2})])
        self.assertTrue(any("not consecutive" in p for p in bm.check_manifest(apart, book)))
        wrong_of = self._manifest([("g10m1s7-1", {"n": 1, "of": 3}), ("g10m1s7-2", {"n": 2, "of": 3})])
        self.assertTrue(any("1..m of m" in p for p in bm.check_manifest(wrong_of, book)))
        bad = self._manifest([("geo1-1", None)])
        self.assertTrue(any("Prep-3 term" in p or "not a valid" in p for p in bm.check_manifest(bad, book)))
        bad["modules"][0]["lessons"][0]["book_provenance"] = None
        self.assertTrue(any("no book provenance" in p for p in bm.check_manifest(bad, book)))

    def test_compare_draft_reports_values_the_draft_states(self):
        self.assertEqual(bm.compare_draft([{"a": 1, "extra": 2}], {"n": 1}, {"modules": [{"a": 1}], "totals": {"n": 1}}), [])
        diffs = bm.compare_draft([{"a": 2}], {"n": 1}, {"modules": [{"a": 1}], "totals": {"n": 1}})
        self.assertEqual(diffs, ["modules[0].a: draft 1, build 2"])

    def test_answer_typing_is_the_scouts(self):
        self.assertEqual(bm.answer_type("(2; 3)"), "coordinates")
        self.assertEqual(bm.answer_type("3,317"), "number_decimal_comma")
        self.assertEqual(bm.answer_type("irrational"), "text")
        self.assertEqual(bm.answer_type("x = 2 or x = −3"), "multi_value")


@unittest.skipUnless((WORK / "adapter-summary.json").exists(),
                     "run `uv run source_adapter.py g10-math` first (the sources are gitignored)")
class Regenerate(unittest.TestCase):
    def test_the_committed_manifest_is_what_the_build_makes(self):
        m, diffs, problems = bm.build(BOOK, WORK, json.loads(MANIFEST.read_text())["generated"])
        self.assertEqual(problems, [])
        self.assertEqual(json.dumps(m, ensure_ascii=False, indent=1) + "\n", MANIFEST.read_text(),
                         "manifest/g10-math-american.json is stale: re-run build_manifest.py g10-math")

    def test_the_default_build_is_the_scouts_59_lessons(self):
        inp = bm.load_inputs(BOOK, WORK)
        d = bm.Default(inp, BOOK)
        mods = d.build()
        self.assertEqual(sum(len(m["lessons"]) for m in mods), 59)
        t = d.totals()
        self.assertEqual((t["numbered_sections"], t["introductions"], t["chapter_summaries"]), (81, 8, 14))
        self.assertEqual((t["exercise_sets"], t["exercise_questions_numbered"], t["exercise_items"]), (87, 1058, 2531))
        self.assertEqual((t["items_with_printed_answer"], t["items_without_printed_answer"]), (2270, 261))
        self.assertEqual(t["exercise_items_end_of_chapter"], 1187)
        self.assertEqual((t["figures_book_pdf"], t["figures_book_epub"]), (761, 764))
        self.assertEqual(collections.Counter(t["gradable_today"]),
                         collections.Counter({"no": 1374, "after_normalisation": 632, "yes": 267, "exact_text_only": 258}))

    def test_every_item_ref_is_the_stages_ref_and_every_body_page_is_accounted(self):
        # backlog 7 (format alignment): the manifest names items the way S1 and S3 do, and the
        # coverage audit's page equality holds on the real book with the openers excluded
        import coverage_report
        m = json.loads(MANIFEST.read_text())
        refs = []
        for mod in m["modules"]:
            sets = [x for l in mod["lessons"] for x in l["exercises"]]
            sets += [x for x in ([mod["introduction"]] if mod["introduction"] else []) for x in x["exercises"]]
            sets += [mod["end_of_chapter_exercise"]] if mod["end_of_chapter_exercise"] else []
            sets += [x for g in mod.get("section_exercises_to_map") or [] for x in g["exercises"]]
            for x in sets:
                got, derived = coverage_report.item_refs(x)
                self.assertFalse(derived, f"{x['label']}: the manifest must list item_refs")
                self.assertEqual(len(got), x["items"])
                refs += got
            self.assertTrue(all(e["reason"] for e in mod["excluded_pages"]))
        self.assertEqual(len(refs), len(set(refs)))
        self.assertEqual(len(refs), 2531)
        checks, _ = coverage_report.audit(BOOK, m, {}, {}, [], {}, None, None, None)
        pages = next(c for c in checks if c.id == "pages")
        self.assertEqual((pages.want, pages.got, pages.failures), (pages.want, pages.want, []))


if __name__ == "__main__":
    unittest.main()
