"""figure_inventory.py (answer 5): every figure reference typed once, each type covered or a gap.

    uv run --project services/extraction --with pytest python -m pytest -q services/extraction/tests/test_figure_inventory.py

Two layers of test:
- the RULES on synthetic references built here (no book, no text from one): a caption naming a Venn
  diagram is the venn gap; a figure in an analytical-geometry chapter is Cartesian and covered by
  coordinate_plot; a prism in the measurement chapter is the solid_3d gap; a JPEG is not a teaching
  figure; a figure nothing speaks for stays unknown; the picture test that tells axes from the legs
  of a right triangle, on PNGs drawn here;
- the REAL Grade 10 inventory under work/g10-math/, when `source_adapter.py g10-math` has been run
  there (skipped otherwise: the sources are gitignored): 764 book + 231 solution = 995 references,
  each typed exactly once, every check green, and two runs byte-identical.
"""

from __future__ import annotations

import io
import contextlib
import json
import struct
import tempfile
import unittest
import zlib
from pathlib import Path

import _scratchdb  # noqa: F401  (puts services/extraction on sys.path)
import figure_inventory as fi

WORK = fi.HERE / "work" / "g10-math"
HAVE_BOOK = (WORK / "blocks.jsonl").exists() and (WORK / "figures.json").exists()


def ref(**kw) -> dict:
    """A synthetic reference with every field the rules read; `layers` maps a layer name
    (figure_inventory.TEXT / NEIGHBOURS) to its text."""
    layers = kw.pop("layers", {})
    base = {
        "ref_index": 0, "src": "tikzpicture/0000.png", "block": "b00001", "block_type": "exercise_item",
        "occurrence": 0, "context": "exercise_problem", "chapter": 1, "section": "1.2",
        "section_title": "A section", "subsection": None, "chapter_title": "A chapter",
        "module": "module:x-c01", "lesson": None, "unit": None, "printed_page": 1,
        "exercise": None, "q": None, "role": "problem", "position": 0, "n_in_block": 1,
        "caption": "", "near_before": "", "neighbours_before": [], "size": [200, 150],
        "stats": None, "raster": False,
    }
    base.update(kw)
    base["layers"] = [(n, layers.get(n, base["caption"] if n == "caption" else ""))
                      for n in fi.TEXT + fi.NEIGHBOURS]
    if not base["near_before"]:
        base["near_before"] = layers.get("words before", "")
    return base


def one(r: dict) -> dict:
    return fi.classify([r])[0]


def png(pixels: list[list[int]]) -> bytes:
    """An 8-bit greyscale PNG from rows of 0–255 values."""
    h, w = len(pixels), len(pixels[0])

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    raw = b"".join(b"\x00" + bytes(row) for row in pixels)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


class RuleTest(unittest.TestCase):
    def test_a_venn_caption_is_the_venn_gap(self):
        r = one(ref(chapter_title="Probability", caption="a venn diagram of two events"))
        self.assertEqual(r["type"], "venn_diagram")
        self.assertEqual(r["rule"], "named:venn_diagram")
        gap = fi.TYPES["venn_diagram"]["gap"]
        self.assertEqual((gap["proposed_kind"], gap["widget"]), ("venn", "venn_builder"))

    def test_analytical_geometry_is_cartesian_and_covered(self):
        r = one(ref(chapter=8, chapter_title="Analytical geometry",
                    layers={"words before": "you are given the following diagram: point a is at ⟨(2;3)⟩ ."}))
        self.assertEqual(r["type"], "cartesian_points")
        self.assertIn("coordinate_plot", fi.TYPES["cartesian_points"]["covered_by"]["viz"])
        self.assertIn("coordinate_plot", fi.viz_kinds())          # the kind really exists today
        # and with no words at all, the chapter itself is the prior
        self.assertEqual(one(ref(chapter=8, chapter_title="Analytical geometry"))["type"],
                         "cartesian_points")

    def test_a_prism_in_the_measurement_chapter_is_the_solid_gap(self):
        r = one(ref(chapter=13, chapter_title="Measurements",
                    layers={"question stem": "find the volume of the following prisms."}))
        self.assertEqual(r["type"], "solid_3d")
        self.assertEqual(r["rule"], "measurement:solid_3d-in-question")
        gap = fi.TYPES["solid_3d"]["gap"]
        self.assertEqual((gap["size"], gap["widget"]), ("L+", "solid_scaler"))

    def test_a_square_base_does_not_make_a_pyramid_flat(self):
        r = one(ref(chapter=13, chapter_title="Measurements",
                    layers={"words before": "abcd is a square, m .", "question stem": "the pyramid below"}))
        self.assertEqual(r["type"], "solid_3d")

    def test_a_solution_redraws_one_face_of_the_solid(self):
        words = ("this is a triangular pyramid. we can use trigonometry to find the missing length. "
                 "we redraw the triangle we are interested in:")
        r = one(ref(chapter=13, chapter_title="Measurements", context="exercise_solution",
                    layers={"words before": words}))
        self.assertEqual(r["type"], "right_triangle_trig")
        r = one(ref(chapter=13, chapter_title="Measurements", context="we_solution",
                    layers={"words before": "the walls can be opened out to a sector of a circle:"}))
        self.assertEqual(r["type"], "solid_net")

    def test_a_photo_is_not_a_teaching_figure(self):
        r = one(ref(src="images/a_photo.jpg", context="body", raster=True))
        self.assertEqual(r["type"], "photo_decoration")
        self.assertIs(fi.TYPES["photo_decoration"]["teaching"], False)
        self.assertIn("photo_decoration", fi.NOT_TEACHING)
        r = one(ref(caption="figure 6.1: a cricket player facing a delivery."))
        self.assertEqual(r["type"], "photo_decoration")
        # a raster CHART inside a worked solution is still a teaching figure
        r = one(ref(src="images/trials.png", raster=True, context="we_solution",
                    chapter_title="Probability",
                    layers={"words before": "a better way to summarise the relative frequencies is in a graph:"}))
        self.assertEqual(r["type"], "line_chart")

    def test_a_letter_sized_icon_is_a_symbol(self):
        self.assertEqual(one(ref(size=[25, 25]))["type"], "inline_symbol")

    def test_nothing_forces_an_unknown(self):
        r = one(ref(chapter=6, chapter_title="Functions", section_title="Chapter summary"))
        self.assertEqual(r["type"], "unknown")
        self.assertEqual(r["rule"], "none")

    def test_the_function_sections_prior_comes_before_their_words(self):
        # "the line y = x" in a hyperbola section is its axis of symmetry, not a second graph
        r = one(ref(chapter=6, chapter_title="Functions", section_title="Hyperbolic functions",
                    layers={"own part": "the axes of symmetry are ⟨y=x⟩ and ⟨y=-x⟩ ."}))
        self.assertEqual(r["type"], "hyperbola_graph")
        self.assertEqual(r["rule"], "prior:section-family")

    def test_two_families_on_one_set_of_axes_are_a_multi_curve_gap(self):
        r = one(ref(chapter=6, chapter_title="Functions", section_title="Interpretation of graphs",
                    layers={"words before": "the graphs of ⟨y=-{x}^{2}+4⟩ and ⟨y=x-2⟩ are given."}))
        self.assertEqual(r["type"], "multi_function_graph")
        # several straight lines are still covered: coordinate_plot draws them as segments
        r = one(ref(chapter=6, chapter_title="Functions", section_title="Interpretation of graphs",
                    layers={"words before": "the graphs of ⟨y=2x+1⟩ and ⟨y=x-2⟩ are shown."}))
        self.assertEqual(r["type"], "straight_line_graph")

    def test_latex_families(self):
        cases = {"y=2^{x}": "exponential", "y=\\frac{3}{x}+1": "hyperbola",
                 "y=-{x}^{2}+4": "parabola", "y=3x-1": "line", "2y=4-x": "line",
                 "y=2\\sin\\theta+1": "trig", "y=4": None, "x=0": None}
        for eq, fam in cases.items():
            self.assertEqual(fi.latex_family(eq), fam, eq)

    def test_a_wordless_figure_takes_its_question_siblings_type(self):
        a = ref(ref_index=0, chapter=7, chapter_title="Euclidean geometry", exercise="7-1", q=3,
                block="b1", layers={"words before": "prove that abcd is a parallelogram."})
        b = ref(ref_index=1, chapter=7, chapter_title="Euclidean geometry", exercise="7-1", q=3,
                block="b2")
        ra, rb = fi.classify([a, b])
        self.assertEqual(ra["type"], "quadrilateral_geometry")
        self.assertEqual((rb["type"], rb["rule"]), ("quadrilateral_geometry", "inherit:question-sibling"))

    def test_a_section_prior_beats_a_weak_word(self):
        # "angles" fits a transversal figure, but the section says mid-point theorem
        r = one(ref(chapter=7, chapter_title="Euclidean geometry", section_title="The mid-point theorem",
                    layers={"words before": "the following lengths and angles are given."}))
        self.assertEqual(r["type"], "midpoint_theorem")
        self.assertEqual(r["rule"], "prior:section-title")

    def test_every_type_is_covered_or_a_gap_and_says_why(self):
        for name, t in fi.TYPES.items():
            self.assertTrue(t["label"], name)
            if name == "unknown" or t.get("teaching") is False:
                self.assertNotIn("gap", t)
                self.assertNotIn("covered_by", t)
                continue
            self.assertEqual(("gap" in t) + ("covered_by" in t), 1, name)
            if "gap" in t:
                self.assertIn(t["gap"]["size"], ("S", "M", "L", "L+"), name)
                self.assertTrue(t["gap"]["why"] and t["gap"]["proposed_kind"], name)


class PictureTest(unittest.TestCase):
    """The picture tie-breaker on drawn PNGs: axes cross inside each other; a right angle's legs
    meet at their ends however central the corner is; a number line is a wide strip."""

    def stats(self, pixels) -> dict:
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "f.png"
            p.write_bytes(png(pixels))
            return fi.image_stats(p)

    @staticmethod
    def canvas(w, h):
        return [[255] * w for _ in range(h)]

    def test_axes_cross(self):
        px = self.canvas(100, 100)
        for x in range(5, 96):
            px[50][x] = 0
        for y in range(5, 96):
            px[y][50] = 0
        self.assertTrue(fi.stat_flags(self.stats(px))["axes"])

    def test_right_angle_legs_are_not_axes(self):
        px = self.canvas(100, 100)
        for x in range(5, 96):
            px[90][x] = 0
        for y in range(5, 91):
            px[y][90] = 0
        self.assertFalse(fi.stat_flags(self.stats(px))["axes"])

    def test_a_wide_strip_is_a_number_line(self):
        px = self.canvas(400, 40)
        for x in range(5, 396):
            px[20][x] = 0
        st = self.stats(px)
        self.assertTrue(fi.stat_flags(st)["wide"])
        r = one(ref(chapter_title="Equations and inequalities", stats=st, size=[400, 40]))
        self.assertEqual((r["type"], r["rule"]), ("number_line", "picture:wide-strip"))


@unittest.skipUnless(HAVE_BOOK, "run source_adapter.py g10-math first (work/g10-math is gitignored)")
class RealBookTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import book_config
        book = book_config.load_book("g10-math")
        cls.manifest = book.repo_path(book.manifest)
        cls.gaps = fi.HERE / "coverage" / "g10-math.widget-gaps.json"
        cls.rep = cls.build()

    @classmethod
    def build(cls) -> dict:
        inp = fi.load_inputs(WORK, cls.manifest)
        return fi.inventory(inp, WORK, cls.gaps, book="g10-math")

    def test_the_reference_equality(self):
        c = self.rep["counts"]
        self.assertEqual((c["book"], c["solution"], c["references"]), (764, 231, 995))
        self.assertEqual(c["book"] + c["solution"], c["references"])
        self.assertEqual((c["unique_images"], c["tikz_images"], c["raster_images"]), (975, 960, 15))
        figs = json.loads((WORK / "figures.json").read_text())
        self.assertEqual(sum(f["refs"] for f in figs.values()), c["references"])

    def test_every_reference_typed_exactly_once(self):
        rows = self.rep["figures"]
        self.assertEqual([r["ref_index"] for r in rows], list(range(len(rows))))
        self.assertTrue(all(r["type"] in fi.TYPES for r in rows))
        per_type = sum(t["count_book"] + t["count_solution"] for t in self.rep["types"].values())
        self.assertEqual(per_type, len(rows))
        for r in rows:          # a teaching figure names what draws it or what must be built
            t = fi.TYPES[r["type"]]
            self.assertEqual(("covered_by" in r) + ("gap_kind" in r),
                             1 if ("covered_by" in t or "gap" in t) else 0, r["ref_index"])

    def test_every_check_is_green(self):
        bad = {k: v for k, v in self.rep["checks"].items() if not v["pass"]}
        self.assertEqual(bad, {})

    def test_two_runs_are_byte_identical(self):
        again = self.build()
        self.assertEqual(fi.dumps(self.rep), fi.dumps(again))
        self.assertEqual(fi.render_md(self.rep), fi.render_md(again))

    def test_the_audit_scores_every_sampled_picture(self):
        a = self.rep["audit"]
        self.assertEqual(a["checked"], sum(s["size"] for s in fi.AUDIT_SAMPLES))
        for s in a["samples"]:
            self.assertEqual(s["not_yet_checked"], [], s["name"])

    def test_check_mode_writes_nothing(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "gaps.json"
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(fi.main(["--book", "g10-math", "--check", "--out", str(out)]), 0)
            self.assertFalse(out.exists())
            self.assertFalse(out.with_suffix(".md").exists())


if __name__ == "__main__":
    unittest.main()
