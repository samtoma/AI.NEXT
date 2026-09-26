"""source_adapter.py (B2, T332): the EPUB as typed blocks, linked to printed pages, and the edition check.

    uv run --project services/extraction --with pytest python -m pytest -q services/extraction/tests/test_source_adapter.py

Two layers of test:
- a SYNTHETIC one-chapter book (a tiny EPUB zip and a matching PDF scan, built here, no text from any
  real book): block types, teacher notes, worked examples, exercises (including the Exercise 5.1
  markup, a titled exercise inside an untitled wrapper with continuation blocks), page linking, answer
  pairing by letter, the page map, and the edition check's required rules;
- the REAL Grade 10 outputs under work/g10-math/, when `source_adapter.py g10-math` has been run
  (skipped otherwise: the sources are gitignored).

@covers FR-4408
"""

from __future__ import annotations

import json
import struct
import tempfile
import unittest
import zipfile
import zlib
from pathlib import Path

import _scratchdb  # noqa: F401  (puts services/extraction on sys.path)
import source_adapter as sa
import xml.etree.ElementTree as ET

WORK = Path(sa.HERE) / "work" / "g10-math"
M = {  # md5-shaped names for the synthetic equation images
    "x": "9dd4e461268c8034f5c8564e155c67a6", "two": "c81e728d9d4c2f636f067f89cc14862c",
    "sol": "eccbc87e4b5ce2fe28308fd9f2a7baf3", "tg": "a87ff679a2f3e71d9181a67b7542122c",
    "hdr": "e4da3b7fbbce2345d7772b0674a318d5", "we": "1679091c5a880faf6fb5e6087eb1b2dc",
}


def png(w=4, h=3) -> bytes:
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    raw = b"".join(b"\x00" + b"\xff" * w for _ in range(h))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def eq(k, block=False):
    return f'<img class="math-{"block" if block else "inline"}" src="equation/{M[k]}.png"/>'


LONG = ("This synthetic paragraph explains how a demonstration quantity behaves when learners compare "
        "several careful measurements across repeated trials in the classroom")
FILE1 = f"""<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
<div class="section" id="scEMA1"><h2 class="title" id="toc-id-1">1.1 Demo section </h2>
<p>{LONG}</p>
<p>Solve for {eq("x")} when it equals {eq("two")}.</p>
<div class="teachers-guide"><p>According to the curriculum, teach {eq("tg")} next year.</p></div>
<p data-class="video" id="sc2VID"><a href="https://example.invalid/v">Video: 2VID</a></p>
<div class="section" id="scEMA2"><h3 class="title" id="toc-id-2">Demo sub-heading </h3>
<div class="worked_example"><h1 class="title">Worked example 1: Demo example</h1>
<div class="question"><p>Find the demonstration value of the quantity {eq("we")} for the class.</p></div>
<div class="workstep"><h2 class="title">Write down the rule</h2><p>Use {eq("x")}.</p></div>
<div class="workstep"><h2 class="title">Write the final answer</h2><p>{eq("two", True)}</p></div>
</div>
<div class="figure"><img src="tikzpicture/fig1.png" alt="fig1.png"/><div class="figcaption">A demo figure.</div></div>
</div>
<div class="section"><div class="problemset"><span class="exerciseTitle">Exercise 1.1</span>
<div class="problemset"><div class="header"><p>Answer the following careful demonstration questions for the class {eq("hdr")}:</p></div>
<div class="entry"><div class="problem"><p>What is the value of the demonstration quantity for the first learner?</p></div>
<div class="solution"><p>The value is {eq("sol")}.</p></div></div>
<div class="entry"><div class="problem"><p>{eq("x")}</p></div><div class="solution"><p>{eq("two")}</p></div></div>
</div>
<div class="entry"><div class="problem"><p>Simplify {eq("x")}</p></div><div class="solution"><p>{eq("sol")}</p></div></div>
</div></div>
</div></body></html>"""

FILE2 = f"""<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
<div class="section" id="scEMA3"><h2 class="title" id="toc-id-3">1.2 Second section </h2>
<div class="section"><div class="problemset"><div class="problemset"><span class="exerciseTitle">Exercise 1.2</span>
<div class="header"><p>Complete each of the following:</p></div>
<div class="entry"><div class="problem"><p>{eq("x")}</p></div><div class="solution"><p>{eq("two")}</p></div></div>
<div class="entry"><div class="problem"><p>{eq("two")}</p></div><div class="solution"><p>{eq("x")}</p></div></div>
</div>
<div class="problemset"><div class="header"><p>Now these:</p></div>
<div class="entry"><div class="problem"><p>{eq("x")}</p></div><div class="solution"><p>{eq("sol")}</p></div></div>
</div>
<div class="entry"><div class="problem"><p>{eq("two")}</p></div><div class="solution"><p>{eq("sol")}</p></div></div>
</div></div>
</div></body></html>"""


def build_epub(tmp: Path) -> Path:
    p = tmp / "demo.epub"
    with zipfile.ZipFile(p, "w") as z:
        z.writestr("mimetype", "application/epub+zip")
        z.writestr("META-INF/container.xml",
                   '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">'
                   '<rootfiles><rootfile full-path="OPS/pkg.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
        z.writestr("OPS/pkg.opf",
                   '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
                   '<dc:identifier>demo.epub</dc:identifier><dc:title>demo</dc:title>'
                   '<meta property="dcterms:modified">2015-09-15T00:00:00Z</meta></metadata><manifest>'
                   '<item id="f1" href="xhtml/b/01-demo-01.cnxmlplus.html" media-type="application/xhtml+xml"/>'
                   '<item id="f2" href="xhtml/b/01-demo-02.cnxmlplus.html" media-type="application/xhtml+xml"/>'
                   '</manifest><spine><itemref idref="f1"/><itemref idref="f2"/></spine></package>')
        z.writestr("OPS/xhtml/b/01-demo-01.cnxmlplus.html", FILE1)
        z.writestr("OPS/xhtml/b/01-demo-02.cnxmlplus.html", FILE2)
        for h in M.values():
            z.writestr(f"OPS/xhtml/b/equation/{h}.png", png())
        z.writestr("OPS/xhtml/b/tikzpicture/fig1.png", png(8, 6))
    return p


def build_scan() -> dict:
    """A PDF scan agreeing with the synthetic EPUB: chapter opener PDF 11, body printed = PDF − 11."""
    pages = 16
    text = {n: "" for n in range(1, pages + 1)}
    text[12] = f"1.1 Demo section EMA1\n{LONG}\nSolve for x when it equals 2. See video: 2VID\n"
    text[13] = ("Demo sub-heading EMA2\nWorked example 1: Demo example\nFind the demonstration value of the "
                "quantity for the class.\nExercise 1 – 1:\nAnswer the following careful demonstration questions "
                "for the class:\nWhat is the value of the demonstration quantity for the first learner?\n"
                "1a. 2AAA 1b. 2AAB 2. 2AAC\n")
    text[14] = "1.2 Second section EMA3\nExercise 1 – 2:\nComplete each of the following:\n1a. 2AAD 1b. 2AAF 2. 2AAG 3. 2AAH\n"
    page_map = [{"pdf": n, "printed": (n - 11 if 12 <= n <= 15 else None), "running_head": None} for n in range(1, pages + 1)]
    return {
        "scan_version": sa.ADAPTER_VERSION, "pdf": {"path": "demo.pdf", "sha256": "0" * 64, "bytes": 1},
        "pages": pages, "metadata": {"producer": "demo", "creationDate": "D:20150611"},
        "page_map": page_map,
        "outline": [{"level": 1, "title": "demo", "pdf": 1}, {"level": 2, "title": "Demo chapter", "pdf": 11}],
        "sections": [{"num": "1.1", "title": "Demo section", "code": "EMA1", "pdf": 12, "y": 100},
                     {"num": "1.2", "title": "Second section", "code": "EMA3", "pdf": 14, "y": 50}],
        "subheadings": [{"title": "Demo sub-heading", "code": "EMA2", "pdf": 13, "y": 40}],
        "worked_examples": [{"n": 1, "title": "Demo example", "pdf": 13}],
        "exercises": [
            {"label": "1-1", "end_of_chapter": False, "pdf": 13, "where": "body",
             "shortcodes": [{"label": "1a", "code": "2AAA", "pdf": 13}, {"label": "1b", "code": "2AAB", "pdf": 13},
                            {"label": "2", "code": "2AAC", "pdf": 13}]},
            {"label": "1-2", "end_of_chapter": False, "pdf": 14, "where": "body",
             "shortcodes": [{"label": "1a", "code": "2AAD", "pdf": 14}, {"label": "1b", "code": "2AAF", "pdf": 14},
                            {"label": "2", "code": "2AAG", "pdf": 14}, {"label": "3", "code": "2AAH", "pdf": 14}]}],
        "answers": [
            {"label": "1-1", "pdf_first": 16, "pdf_last": 16, "max_q": 2,
             "leaves": [{"q": 1, "sub": "b", "text": "4", "pdf": 16}, {"q": 2, "sub": None, "text": "7", "pdf": 16}]},
            {"label": "1-2", "pdf_first": 16, "pdf_last": 16, "max_q": 3,
             "leaves": [{"q": 1, "sub": None, "text": "9", "pdf": 16}]}],
        "media": [{"kind": "video", "code": "2VID", "pdf": 12}],
        "figures": [{"xref": 5, "pdf": 13, "bbox": [0, 0, 10, 10]}], "rasters": [], "codes": {},
        "answers_start_pdf": 16, "past_papers_start_pdf": 17,
        "fonts": ["URWClassico-Regular"], "page_text": [text[n] for n in range(1, pages + 1)],
        "page_spans": [[] for _ in range(pages)],
    }


class SyntheticBook(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.epub = sa.Epub(build_epub(cls.tmp))
        cls.scan = build_scan()
        cls.pm = sa.derive_page_map(cls.scan)
        cls.pmap = sa.PageMap(cls.pm)
        cls.index, cls.blocks = [], []
        linker = sa.Linker(cls.scan, cls.pmap)
        spans = sa.section_spans(cls.scan, cls.pmap)
        for href in cls.epub.spine:
            root = ET.fromstring(cls.epub.read(cls.epub.zip_path(href)))
            fname = href.split("/")[-1]
            cls.index.append(sa.index_file(root, fname, href))
            fb = sa.Blocks(root, fname, href, sa.chapter_of(fname)).run()
            sec = "1.1" if "01.cnxml" in fname else "1.2"
            for b in fb:
                b["section"] = sec
            linker.link_file(fb, spans[sec])
            cls.blocks.extend(fb)
        for i, b in enumerate(cls.blocks):
            b["id"] = f"b{i + 1:05d}"
        cls.answer_stats = sa.pair_answers(cls.scan, cls.blocks)

    def of(self, t):
        return [b for b in self.blocks if b["type"] == t]

    def test_teacher_notes_are_their_own_block_and_never_printed(self):
        tg = self.of("teacher_only")
        self.assertEqual(len(tg), 1)
        self.assertIn("According to the curriculum", tg[0]["text"])
        self.assertEqual(tg[0]["maths"], [M["tg"]])
        self.assertEqual((tg[0]["printed_page"], tg[0]["page_method"]), (None, "not_printed"))
        # and the teacher's text is in no other block
        for b in self.blocks:
            if b["type"] != "teacher_only":
                self.assertNotIn("According to the curriculum", b.get("text", ""))

    def test_every_maths_and_figure_reference_lands_in_exactly_one_block(self):
        inv = sum(f["math_inline"] + f["math_block"] for f in self.index)
        self.assertEqual(inv, sum(len(b["maths"]) for b in self.blocks))
        self.assertEqual(sum(len(f["figures"]) for f in self.index), sum(len(b["figures"]) for b in self.blocks))
        para = next(b for b in self.of("para") if "Solve for" in b["text"])
        self.assertEqual(para["text"], f"Solve for ⟦m:{M['x']}⟧ when it equals ⟦m:{M['two']}⟧ .")

    def test_worked_example_keeps_question_and_steps(self):
        we = self.of("worked_example")
        self.assertEqual(len(we), 1)
        we = we[0]
        self.assertEqual((we["n"], we["title"]), (1, "Demo example"))
        self.assertEqual([s["title"] for s in we["steps"]], ["Write down the rule", "Write the final answer"])
        self.assertEqual(we["question"]["maths"], [M["we"]])
        self.assertEqual((we["printed_page"], we["page_method"]), (2, "anchor"))
        self.assertEqual(we["subsection_code"], "EMA2")

    def test_exercise_items_are_identified_by_label_question_and_sub_part(self):
        items = self.of("exercise_item")
        self.assertEqual([b["item_key"] for b in items],
                         ["ex1-1-1a", "ex1-1-1b", "ex1-1-2", "ex1-2-1a", "ex1-2-1b", "ex1-2-2", "ex1-2-3"])
        first = items[0]
        self.assertEqual(first["solution"]["maths"], [M["sol"]], "the EPUB worked solution travels with the item")
        self.assertEqual(first["shortcode"], "2AAA")
        self.assertEqual(items[2]["shortcode"], "2AAC")

    def test_exercise_51_markup_titled_block_inside_a_wrapper(self):
        # the wrapper problemset is walked, its continuation blocks fold in, nothing is unparsed
        self.assertEqual(self.of("unparsed"), [])
        ex12 = [b for b in self.of("exercise_item") if b["exercise"] == "1-2"]
        self.assertEqual([(b["q"], b["sub"]) for b in ex12], [(1, "a"), (1, "b"), (2, None), (3, None)])
        hdr = [b for b in self.of("exercise_header") if b["exercise"] == "1-2"]
        self.assertEqual([(h["q"], h["text"]) for h in hdr],
                         [(None, "Complete each of the following:"), (2, "Now these:")],
                         "the exercise header is emitted once, not again as question 1's")

    def test_printed_answers_pair_by_letter_not_position(self):
        by = {b["item_key"]: b["printed_answer"] for b in self.of("exercise_item")}
        self.assertIsNone(by["ex1-1-1a"], "1a has no printed answer; 1b's must not slide onto it")
        self.assertEqual(by["ex1-1-1b"]["text"], "4")
        self.assertEqual((by["ex1-1-2"]["text"], by["ex1-1-2"]["scope"]), ("7", "item"))
        # an unlettered leaf for a question with several items is kept at question level
        self.assertEqual((by["ex1-2-1a"]["text"], by["ex1-2-1a"]["scope"]), ("9", "question"))

    def test_page_links_stay_inside_the_section_and_never_go_back(self):
        for b in self.blocks:
            if b["page_method"] == "not_printed":
                continue
            self.assertIn(b["printed_page"], (1, 2) if b["section"] == "1.1" else (3,), b["id"])
        long_para = next(b for b in self.of("para") if b["text"].startswith("This synthetic"))
        self.assertEqual((long_para["printed_page"], long_para["page_method"]), (1, "text"))

    def test_page_map_is_derived_from_every_folio(self):
        self.assertEqual([(r["pdf_from"], r["pdf_to"], r["pdf_minus_printed"]) for r in self.pm["regimes"]],
                         [(12, 15, 11)])
        self.assertEqual(self.pmap.printed(16), None)
        self.assertEqual(self.pmap.printed(13), 2)

    def test_edition_check_rules(self):
        ed = sa.edition_check(self.scan, self.index, self.epub, self.pmap)
        self.assertEqual(ed["verdict"], "match", json.dumps(ed["content"]))
        self.assertEqual(ed["required"], {"section_codes_equal": True, "media_codes_equal": True})
        self.assertIsNone(ed["markers"]["epub"]["version_string"], "recorded, not required")
        # a section code only one format carries fails the required rule
        scan = json.loads(json.dumps(self.scan))
        scan["subheadings"][0]["code"] = "EMA9"
        self.assertEqual(sa.edition_check(scan, self.index, self.epub, self.pmap)["verdict"], "content_mismatch")
        scan = json.loads(json.dumps(self.scan))
        scan["media"][0]["code"] = "2ZZZ"
        self.assertFalse(sa.edition_check(scan, self.index, self.epub, self.pmap)["required"]["media_codes_equal"])

    def test_equation_catalogue_classes(self):
        cat = sa.equation_catalogue(self.epub, self.blocks, self.tmp, extract=False)["images"]
        self.assertEqual(cat[M["tg"]]["class"], "teacher_only")
        self.assertEqual(cat[M["sol"]]["class"], "solution_only", "only ever in EPUB worked solutions")
        self.assertEqual(cat[M["x"]]["class"], "printed")
        self.assertEqual(cat[M["x"]]["size"], (4, 3))


class PageOffsetConfigCheck(unittest.TestCase):
    def test_a_config_anchor_that_disagrees_with_the_footers_is_reported(self):
        import book_config
        pm = sa.derive_page_map(build_scan())
        book = book_config.Book.model_validate({
            "book": "demo-book", "title": "d", "course_id": "course:demo", "curriculum": "us-american-en",
            "subject": "math", "grade": "10", "language": "en", "direction": "ltr", "id_prefix": "dm",
            "page_offsets": [{"label": "body", "pdf_minus_printed": 10, "verified_at": [[2, 12]]}]})
        problems = sa.check_page_offsets(book, pm)
        self.assertTrue(any("pdf - printed = 10" in p for p in problems), problems)


@unittest.skipUnless((WORK / "adapter-summary.json").exists(),
                     "run `uv run source_adapter.py g10-math` first (the sources are gitignored)")
class Grade10Outputs(unittest.TestCase):
    """The real book: what the S0 report found, reproduced by the adapter (T332, T351)."""

    @classmethod
    def setUpClass(cls):
        cls.s = json.loads((WORK / "adapter-summary.json").read_text())
        cls.ed = json.loads((WORK / "edition-check.json").read_text())

    def test_all_self_checks_green(self):
        self.assertTrue(self.s["all_checks_pass"], json.dumps(self.s["checks"], indent=1))

    def test_edition_verdict_is_match_on_codes_not_version_strings(self):
        self.assertEqual(self.ed["verdict"], "match")
        self.assertEqual((self.ed["section_codes"]["pdf"], self.ed["section_codes"]["epub"]), (172, 172))
        self.assertEqual((self.ed["media_codes"]["pdf"], self.ed["media_codes"]["epub"]), (78, 78))
        self.assertIsNone(self.ed["markers"]["epub"]["version_string"])

    def test_counts_match_the_s0_report(self):
        b = self.s["blocks"]
        self.assertEqual((b["exercise_item"], b["worked_example"], b["teacher_only"]), (2531, 174, 32))
        self.assertEqual((self.s["equations"]["unique"], self.s["equations"]["references"]), (8561, 16388))
        self.assertEqual(self.s["figures"]["references"], 995)
        self.assertEqual([(r["pdf_from"], r["pdf_to"], r["pdf_minus_printed"]) for r in self.s["page_map"]["regimes"]],
                         [(13, 532, 11)])

    def test_no_teacher_note_is_printed_or_reaches_a_student_block(self):
        n = 0
        with open(WORK / "blocks.jsonl") as f:
            for line in f:
                b = json.loads(line)
                if b["type"] == "teacher_only":
                    n += 1
                    self.assertEqual(b["page_method"], "not_printed")
                else:
                    self.assertNotIn("According to CAPS", b.get("text", ""), b["id"])
        self.assertEqual(n, 32)


if __name__ == "__main__":
    unittest.main()
