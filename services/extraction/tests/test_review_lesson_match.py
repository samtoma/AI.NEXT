"""The review tool's Label extraction pairs an extracted record with a ground-truth record by content, never by id alone.

    uv run --with pytest python -m pytest -q tests/test_review_lesson_match.py

A ground truth labelled on an earlier extraction can hold a different record under an id the current extraction
reuses (Prep-3 Lesson 1-1: rule-9 was the quadrant signs, is now "Each point of this net ..."). score_book_record's
match_by_content (behind /api/lesson-match) pairs only what the quote or main text says is the same printed thing; an
equal id only settles which content match wins. The scorer's own match() keeps pairing equal ids first.
No database. No FR marker: the review tool carries none.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

EX = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(EX / "groundtruth"))

import score_book_record as S  # noqa: E402


def rec(rid: str, typ: str, quote: str, page: int = 11) -> dict:
    return {"id": f"u1-1:{rid}", "type": typ, "quote": quote, "source_page": page}


# the current extraction renumbered: its rule-9 is a different statement from the ground truth's rule-9
EXT = [
    rec("rule-9", "rule", "Each point of this net represents one the ordered pairs of N x N"),
    rec("figure-7", "figure", "first quadrant x > 0, y > 0", page=12),
    rec("definition-4", "definition", "This net is known as the coordinat plane of Z x Z."),
    rec("rule-1", "rule", "Each pair is represented by one and only one point in the coordinate plane", page=7),
]
GT = [
    rec("rule-9", "rule", "first quadrent x > 0, y > 0", page=12),
    rec("definition-4", "definition", "the elements of set X is represented horizontally", page=10),
    rec("definition-6", "definition", "This net is known as the coordinat plane of Z×Z"),
    rec("rule-1", "rule", "represented by one and only one point in the coordinate plane", page=7),
]


def pairs_of(result) -> dict[str, str]:
    return {e["id"]: g["id"] for g, e, _how in result[0]}


class MatchByContentTest(unittest.TestCase):
    def test_an_equal_id_with_other_content_is_not_a_pair(self):
        got = pairs_of(S.match_by_content(EXT, GT))
        self.assertNotIn("u1-1:rule-9", got)  # the current rule-9 has no labelled counterpart: shown as itself
        self.assertEqual(got["u1-1:figure-7"], "u1-1:rule-9")  # the old quadrant record is the figure's text
        self.assertEqual(got["u1-1:definition-4"], "u1-1:definition-6")  # not the ground truth's definition-4

    def test_an_equal_id_with_the_same_content_still_pairs(self):
        got = S.match_by_content(EXT, GT)
        self.assertIn((GT[3], EXT[3], "id+content"), got[0])

    def test_every_record_is_either_paired_or_left_over(self):
        pairs, gt_left, ext_left = S.match_by_content(EXT, GT)
        self.assertEqual({e["id"] for _g, e, _h in pairs} | {e["id"] for e in ext_left}, {e["id"] for e in EXT})
        self.assertEqual([g["id"] for g in gt_left], ["u1-1:definition-4"])
        self.assertEqual([e["id"] for e in ext_left], ["u1-1:rule-9"])

    def test_an_equal_id_settles_a_tie_between_content_matches(self):
        ext = [rec("rule-2", "rule", "If a ≠ b then (a, b) ≠ (b, a)"), rec("rule-3", "rule", "If a ≠ b then (a, b) ≠ (b, a)")]
        gt = [rec("rule-3", "rule", "If a ≠ b then (a, b) ≠ (b, a)")]
        self.assertEqual(pairs_of(S.match_by_content(ext, gt)), {"u1-1:rule-3": "u1-1:rule-3"})

    def test_the_scorer_still_pairs_equal_ids_first(self):
        self.assertEqual(pairs_of(S.match(EXT, GT))["u1-1:rule-9"], "u1-1:rule-9")


if __name__ == "__main__":
    unittest.main()
