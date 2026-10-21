"""ONE FIGURE PER PART (compile_book_records.figure_of_part, Tamer 2026-10-20).

"Study each of the following figures, then complete": the book prints several numbered figures for one prompt and asks
a part about each. Every part is its own question, so it is shown its own figure only — all of them at once (pp3u10-3
drill 1, three figures on each of its three questions) had the student hunting for the right one."""
import unittest

import compile_book_records as CBR


def part(i: int, n: int, words: str) -> dict:
    return {"i": i, "n": n, "words": words}


class FigureOfPart(unittest.TestCase):
    def test_the_figure_a_part_names(self):
        # pp3u10-3 drill 1: "m(∠C) = ... °; m(∠BDC) = ... ° (figure 2)"
        self.assertEqual(CBR.figure_of_part(part(1, 3, "m(∠C) = ... °; m(∠BDC) = ... ° (figure 2)"), 3), 2)
        # drill 3: "Figure 3: z = …" — named, even where the parts and figures do not pair up
        self.assertEqual(CBR.figure_of_part(part(0, 2, "Figure 3: $z = \\ldots$"), 3), 3)
        self.assertEqual(CBR.figure_of_part(part(0, 4, "see fig. 1"), 2), 1)

    def test_one_figure_per_part_pairs_them_in_order(self):
        # pp3u10-2 drill 14: six parts that never say "figure", over six figures
        self.assertEqual(CBR.figure_of_part(part(2, 6, "Circle with diameter AB, centre M"), 6), 3)

    def test_otherwise_a_part_is_about_every_figure(self):
        self.assertIsNone(CBR.figure_of_part(part(0, 6, "m(∠MAC) = ...."), 4), "six parts, four figures, no names")
        self.assertIsNone(CBR.figure_of_part(part(0, 3, "(figure 2)"), 1), "one figure: it is every part's")
        self.assertIsNone(CBR.figure_of_part(None, 3), "not a part: the whole prompt's figures")
        self.assertIsNone(CBR.figure_of_part(part(0, 3, "(figure 7)"), 3), "a figure the prompt does not have")


if __name__ == "__main__":
    unittest.main()
