"""S1 on book records (book_record_objectives.py): worked examples are named as Samuel's S1 cites them.

No @covers marker: S1 is pipeline policy. Found 2026-10-17: the packet named worked examples by their book-record ids
with no number, while Samuel's prompt tells the agents to cite them `WE<n>`, so 15 of Unit 1's 16 pieces of evidence
were dropped unjudged ("anchor 'WE1' is not in the chapter packet"). What is proved, on prep3-parallel Unit 1's records:
  - the packet numbers worked examples through the chapter, `WE1`…, each keeping its book-record id;
  - the prompt the agents read carries those names, so what they cite is what the evidence check can find;
  - a cited `WE<n>` comes back as its book-record id (`cited_as` keeps the name), in evidence, filing and links.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

EX = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(EX))

import book_record_objectives as BO  # noqa: E402

SLUGS = ["pp3u1-1", "pp3u1-2", "pp3u1-3", "pp3u1-4"]   # the separate book (prep3-parallel)


@unittest.skipUnless((EX / "book-records" / "prep3-parallel" / "pp3u1-1.json").exists(), "needs prep3-parallel Unit 1's book records")
class WorkedExampleNames(unittest.TestCase):
    def test_numbered_through_the_chapter(self):
        a = BO.s1_args("prep3-parallel", 1, SLUGS)
        ws = [w for l in a["chapter"]["lessons"] for w in l["worked_examples"]]
        self.assertEqual([w["anchor"] for w in ws], [f"WE{k}" for k in range(1, len(ws) + 1)])
        self.assertEqual([w["n"] for w in ws], list(range(1, len(ws) + 1)))
        self.assertTrue(all(w["record_id"].startswith(tuple(f"{s}:" for s in SLUGS)) for w in ws))

    def test_cited_names_come_back_as_book_ids(self):
        we = {"WE1": "u1-1:example-1", "WE2": "u1-1:example-2"}
        ev = {"lessons": [{"objectives": [{"evidence": [{"anchor": "WE1", "quote": "q"}, {"anchor": "u1-1:rule-4"}],
                                           "evidence_dropped": [{"anchor": "WE2"}], "worked_examples": ["WE1", "WE2"]}]}],
              "links": {"kept": [{"evidence": [{"anchor": "WE2"}]}], "dropped": []}}
        o = BO.book_ids(ev, we)["lessons"][0]["objectives"][0]
        self.assertEqual(o["evidence"][0], {"cited_as": "WE1", "anchor": "u1-1:example-1", "quote": "q"})
        self.assertEqual(o["evidence"][1], {"anchor": "u1-1:rule-4"})
        self.assertEqual(o["worked_examples"], ["u1-1:example-1", "u1-1:example-2"])
        self.assertEqual(BO.book_ids(ev, we)["links"]["kept"][0]["evidence"][0]["anchor"], "u1-1:example-2")


if __name__ == "__main__":
    unittest.main()


class OwnVocabulary(unittest.TestCase):
    """Tamer, 2026-10-17: S1's terminology questions compare an objective's words with the book's OWN printed text,
    never another course's bundles, and a term the book prints raises no question."""

    def test_printed_in(self):
        vocab = " in each ordered pair (a, b), a is called the first projection. if x and y are two finite sets. n (x × y) = 6 "
        self.assertTrue(BO.printed_in("first projection", vocab))
        self.assertTrue(BO.printed_in("finite set", vocab))          # its plural is printed
        self.assertTrue(BO.printed_in("n(x×y)", vocab))              # maths, without its spacing
        self.assertFalse(BO.printed_in("component", vocab))
        self.assertFalse(BO.printed_in("projection set", vocab))

    @unittest.skipUnless((EX / "book-records" / "prep3-parallel" / "pp3u1-1.json").exists(), "needs prep3-parallel's records")
    def test_the_vocabulary_is_the_books_own(self):
        v = BO.book_vocabulary("prep3-parallel")
        self.assertIn("first projection", v)
        self.assertNotIn("$", v)
