"""render_review_page.py --gate g1..g4 (B17, T348): the dossiers for Samuel's gates.

    uv run --with pytest python -m pytest -q tests/test_render_review_page.py

Each page is one self-contained file (nothing fetched), sized for a phone, and shows what
its gate needs: G1 every objective with its evidence; G2 every three-way disagreement,
every item with no printed answer and a seeded sample of the rest; G3 a family-stratified
sample of generated and widget items; G4 the dropped count and a sample of kept entries.
No database. No FR marker: B17 carries none.
"""

from __future__ import annotations

import json
import re
import tempfile
import unittest
from pathlib import Path

import _scratchdb  # noqa: F401
import render_review_page as rrp

FIX = Path(__file__).resolve().parent / "fixtures" / "g10-math"


def render(*argv: str) -> str:
    out = Path(tempfile.mkdtemp(prefix="review_test_")) / "page.html"
    assert rrp.main([*argv, "--out", str(out)]) == 0
    return out.read_text()


def meta(page: str) -> dict:
    return json.loads(re.search(r'<script type="application/json" id="meta">(.*?)</script>',
                                page, re.S).group(1))


class DossierTest(unittest.TestCase):
    BOOK = ("--book", "g10-math", "--manifest", str(FIX / "manifest.json"), "--chapter", "8")

    def assert_self_contained(self, page: str):
        self.assertNotRegex(page, r'(?:src|href)="https?://', "a page must fetch nothing")
        self.assertIn('name="viewport" content="width=device-width', page)
        css = re.search(r"<style>(.*?)</style>", page, re.S).group(1)
        for m in re.finditer(r"#[0-9A-Fa-f]{6}\b", css):
            self.assertRegex(css[:m.start()], r"--play-[a-z-]+:$",
                             "a colour literal outside a Play token definition")
        self.assertNotIn("style=\"color", page)

    def test_g1_shows_every_objective_with_its_evidence(self):
        page = render("--gate", "g1", *self.BOOK, "--objectives", str(FIX / "objectives"))
        self.assert_self_contained(page)
        for lo in ("lo:g10m8s1-1-1", "lo:g10m8s3-2-2", "lo:g10m8s4-1-1"):
            self.assertIn(f'data-id="{lo}"', page)
        self.assertIn("part 2 of 2", page)
        self.assertIn("worked_example</b> · WE4 · p.309", page)

    def test_g2_shows_every_disagreement_every_unanswered_item_and_a_seeded_sample(self):
        a = render("--gate", "g2", *self.BOOK, "--runs", str(FIX / "runs" / "lesson"), "--seed", "7")
        m = meta(a)
        for key in ("g10m8s2-1:Ex8-2:2a", "g10m8s2-1:Ex8-2:2b", "g10m8s1-1:Ex8-1:3", "g10m8s3-2:Ex8-4:2"):
            self.assertIn(key, m["must_review"])
            self.assertIn(f'data-id="{key}"', a)
        self.assertEqual(len(m["sampled"]), 5, "one per lesson is more than 10% here")
        self.assertEqual(meta(render("--gate", "g2", *self.BOOK, "--runs", str(FIX / "runs" / "lesson"),
                                     "--seed", "7"))["sampled"], m["sampled"], "reproducible")
        self.assertIn('class="disagree"', a)
        self.assert_self_contained(a)

    def test_g3_reads_every_family_and_renders_widgets(self):
        page = render("--gate", "g3", "--bundles", str(FIX / "generated" / "generated-questions.json"),
                      "--bundles", str(FIX / "generated" / "widget-questions.json"),
                      "--catalogue", str(FIX / "generated" / "misconceptions.json"))
        m = meta(page)
        self.assertEqual(len(m["sampled"]), 7, "7 families, one item each")
        self.assertIn("Widget <b>pair_plotter</b>", page)
        self.assertIn("swapped-coordinates</b> → Coordinates read in the wrong order", page)
        self.assert_self_contained(page)

    def test_g3_shows_a_pipeline_flag_on_its_family(self):
        with tempfile.TemporaryDirectory() as d:
            flags = Path(d, "g3-flags.json")
            flags.write_text(json.dumps({"flags": {"fam:g10m8s3-2-2:find-k": "tier: advanced, but one step — standard?"}}))
            page = render("--gate", "g3", "--bundles", str(FIX / "generated" / "generated-questions.json"),
                          "--flags", str(flags))
        self.assertEqual(page.count('<span class="tag attention">flagged</span>'), 1)
        self.assertIn("tier: advanced, but one step — standard?", page)
        self.assert_self_contained(page)

    def test_g3_mappings_shows_every_held_claim_with_keep_and_drop(self):
        queue = {"format": "ainext.widget-mapping-review/1", "items": [
            {"key": f"q:g10m8s1-1-2:w00{i}#swapped-coordinates", "question_id": f"q:g10m8s1-1-2:w00{i}",
             "template_id": "wt:g10m8s1-1-2:plot-the-point", "kind": "pair_plotter",
             "stem": f"Plot the point $({i}, {i})$.", "reading": {"target": [i, i]}, "construction": "tap it",
             "predicate": "swapped-coordinates", "predicate_meaning": "x and y exchanged",
             "misconception_id": "mc:g10m8s1-1-2:swaps-x-and-y-values", "misconception_label": "Swaps x and y",
             "misconception_description": "…", "why": "a no-op when x = y"} for i in (3, 4)]}
        with tempfile.TemporaryDirectory() as d:
            q = Path(d, "pending.json")
            q.write_text(json.dumps(queue))
            page = render("--gate", "g3-mappings", "--mappings", str(q))
        m = meta(page)
        self.assertEqual((m["gate"], m["held"]), ("G3", 2))
        self.assertEqual(m["sampled"], [it["key"] for it in queue["items"]], "every held claim, no sample")
        self.assertEqual(page.count('data-v="keep"'), 2)
        self.assertEqual(page.count('data-v="drop"'), 2)
        self.assertIn("a no-op when x = y", page)
        self.assertIn("{reviewer: state.reviewer, verdicts: state.verdicts, notes: state.notes}", page)
        self.assert_self_contained(page)

    def test_g4_counts_the_dropped_and_samples_the_kept(self):
        page = render("--gate", "g4", "--catalogue", str(FIX / "generated" / "misconceptions.json"),
                      "--s5", str(FIX / "runs" / "misconceptions" / "s5-final.json"))
        m = meta(page)
        self.assertEqual(m["dropped"], 2)
        self.assertEqual(len(m["sampled"]), 3, "one per kind")
        self.assertIn("CONTRADICTS_CANONICAL 1, UNSUPPORTED 1", page)
        self.assertNotIn("subtracts-in-wrong-order", page, "a dropped entry is counted, not shown")
        self.assert_self_contained(page)

    def test_verdicts_leave_the_page_in_the_shape_apply_review_verdicts_reads(self):
        page = render("--gate", "g3", "--bundles", str(FIX / "generated" / "generated-questions.json"))
        self.assertIn("{reviewer: state.reviewer, verdicts: state.verdicts, notes: state.notes}", page)
        self.assertIn('data-v="reject"', page)


class TexTest(unittest.TestCase):
    def test_structures_become_readable_and_unknown_commands_show_their_source(self):
        self.assertIn("√", rrp.tex_html(r"\sqrt{8}"))
        self.assertIn("<sub>1</sub>", rrp.tex_html("x_1"))
        self.assertIn("<sup>2</sup>", rrp.tex_html("x^2"))
        raw = rrp.tex_html(r"\overbrace{x}")
        self.assertIn('class="tex"', raw)
        self.assertIn(r"\overbrace{x}", raw)


if __name__ == "__main__":
    unittest.main()
