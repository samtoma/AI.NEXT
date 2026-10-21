"""LINKS INTO EARLIER UNITS, v2 (book_record_links.cross_filters, Tamer 2026-10-21): what a run proposes is cut, before
anyone reviews it, to links that are not already decided, not implied by the approved graph, and no more than three
into one objective. Every cut keeps its reason."""
import unittest

import book_record_links as BRL


def link(src: str, dst: str, signal: str = "uses_method", n_ev: int = 1) -> dict:
    return {"key": f"{src}->{dst}", "src": src, "dst": dst, "signal": signal, "evidence": [{}] * n_ev}


class CrossFilters(unittest.TestCase):
    def test_a_link_the_approved_graph_already_implies_is_dropped(self):
        # u9 tangent -> u10 lesson 6 objective, when u9 tangent -> u10 lesson 2 -> u10 lesson 6 is approved
        approved = {("lo:u9-4-1", "lo:u10-2-1"), ("lo:u10-2-1", "lo:u10-6-1")}
        kept, dropped = BRL.cross_filters([link("lo:u9-4-1", "lo:u10-6-1")], set(), approved)
        self.assertEqual(kept, [])
        self.assertIn("implied", dropped[0]["why"])

    def test_the_direct_link_is_kept_when_it_is_the_only_path(self):
        kept, dropped = BRL.cross_filters([link("lo:u9-4-1", "lo:u10-2-1")], set(), {("lo:u10-2-1", "lo:u10-6-1")})
        self.assertEqual([k["key"] for k in kept], ["lo:u9-4-1->lo:u10-2-1"])
        self.assertEqual(dropped, [])

    def test_two_proposals_do_not_cancel_each_other(self):
        # A->B and A->C proposed, B->C approved: A->C is implied through A->B, A->B is kept
        kept, dropped = BRL.cross_filters([link("A", "B"), link("A", "C")], set(), {("B", "C")})
        self.assertEqual([k["key"] for k in kept], ["A->B"])
        self.assertEqual([d["key"] for d in dropped], ["A->C"])

    def test_a_link_already_decided_is_not_proposed_again(self):
        kept, dropped = BRL.cross_filters([link("A", "B")], {("A", "B")}, set())
        self.assertEqual(kept, [])
        self.assertIn("already decided", dropped[0]["why"])

    def test_at_most_three_into_one_objective_and_the_best_evidenced_stay(self):
        props = [link("s1", "D"), link("s2", "D", "recall"), link("s3", "D", n_ev=3), link("s4", "D"), link("s5", "D", "reference")]
        kept, dropped = BRL.cross_filters(props, set(), set())
        self.assertEqual(sorted(k["src"] for k in kept), ["s2", "s3", "s5"])
        self.assertTrue(all("cap" in d["why"] for d in dropped))
        self.assertEqual(len(dropped), 2)


if __name__ == "__main__":
    unittest.main()
