"""Samuel's answer 15 (2026-09-26): end-of-chapter items that fit no objective — both (c) and (b).

    uv run --with pytest python -m pytest -q tests/test_s1_answer15.py

(c) The finders also read the end-of-chapter items in their lesson's scope, each in its own reading
    order, so an objective practised only there can be found. Proved here: what each agent reads
    (finders yes, in their orders; the linker no; the two blind mappers still place every item); an
    in-scope end-of-chapter item is valid exercise evidence and an out-of-scope one is not; rule 1 is
    unchanged for such an objective; a finder that LISTS an end-of-chapter item fails rule 2; and an
    objective no item ends up mapped to is a decision G1 owes.
(b) A G1 verdict rules a distributed item "outside this chapter's objectives": with a reason it lifts
    rule 2 for that item alone, the item is kept out of practice and named in the lesson records with
    who, when and why; without a reason, for a lesson's own item, or together with a move, it fails.
    (The coverage audit's named exception is in tests/test_coverage_report.py.)
No model is called. Pipeline policy, not a requirement (objectives are not written as FRs).
"""

from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
EX = HERE.parent
for p in (str(EX), str(HERE)):
    if p not in sys.path:
        sys.path.insert(0, p)

import _objectives_fixture as fx  # noqa: E402
import assemble_objectives as ao  # noqa: E402
import book_config  # noqa: E402
from test_objectives import WORKFLOW, ev, good_responses  # noqa: E402

POOL_HEAD = "END-OF-CHAPTER ITEMS IN THIS LESSON'S SCOPE"


@unittest.skipUnless(fx.NODE, "node is needed to run workflow scripts through the stub runtime")
class Answer15(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls.tmp = Path(cls._tmp.name)
        cls.f = fx.build(cls.tmp)
        cls.book = book_config.load_book(cls.f["book"])
        cls.manifest = json.loads(cls.f["manifest"].read_text())
        cls.blocks = ao.load_blocks(cls.f["blocks"])
        cls.maths = ao.load_maths(cls.f["maths"])
        cls.args = ao.s1_args(cls.book, cls.manifest, cls.blocks, cls.maths, 8)
        cls.vocab = ao.egyptian_vocabulary()

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def run_s1(self, responses, name, args=None):
        rep = fx.run_workflow(WORKFLOW, args or self.args, responses, self.tmp)
        self.assertTrue(rep["ok"], rep["error"])
        path = self.tmp / name
        path.write_text(json.dumps(rep["result"], ensure_ascii=False))
        return rep, ao.read_runs([path])

    def evaluate(self, run, verdicts=None, packet=None):
        return ao.evaluate_chapter(packet or self.args["chapter"], run, self.vocab, verdicts or {}, [])

    def eoc_objective(self, r: dict, slug: str, item: str) -> dict:
        """A third objective of `slug` found only from end-of-chapter practice (both finders, agreed)."""
        o = dict(statement="Find the equation of a line from its gradient and y-intercept", label="Equation from m and c",
                 evidence=[ev("heading", "EMA6C", 298, "Straight lines"), ev("exercise", item, 316, "Find the equation")],
                 exercise_items=[], worked_examples=[])
        for side in ("A", "B"):
            r[f"S1:find{side}:{slug}"]["objectives"].append(copy.deepcopy(o))
        rec = r[f"S1:reconcile:{slug}"]["objectives"]
        rec.append(dict(copy.deepcopy(o), confidence="agreed", terms=[],
                        **{"from": {"a": [f"A{len(rec) + 1}"], "b": [f"B{len(rec) + 1}"]}}))
        n = len(rec)
        r[f"S1:evidence:{slug}"]["checks"] += [{"objective_n": n, "evidence_index": i, "present": True, "supports": True}
                                              for i in range(2)]
        return r

    # ------------------------------------------------------------------ (c) what each agent reads
    def test_c_each_finder_reads_the_in_scope_end_of_chapter_items_in_its_own_order(self):
        rep, _ = self.run_s1(good_responses(self.args), "read.json")
        p = {c["label"]: c["prompt"] for c in rep["calls"]}
        a, b = p["S1:findA:g10m8s3-2"], p["S1:findB:g10m8s3-2"]
        for x in (a, b):
            self.assertIn(POOL_HEAD, x)
            for item in ("[Ex8-6:1]", "[Ex8-6:2]", "[Ex8-6:3]"):
                self.assertIn(item, x)
            self.assertIn("never list one in exercise_items", x)
        self.assertLess(a.index("EXERCISE ITEMS —"), a.index(POOL_HEAD), "A: the lesson's practice, then the chapter's")
        self.assertLess(b.index(POOL_HEAD), b.index("TEXT, DEFINITIONS AND HEADINGS"), "B: all practice first")
        self.assertNotIn(POOL_HEAD, p["S1:links:ch08"], "the linker does not read them")
        for m in ("S1:map:ch08:1", "S1:map2:ch08:1"):
            for item in ("[Ex8-6:1]", "[Ex8-6:2]", "[Ex8-6:3]"):
                self.assertIn(item, p[m], "the two blind mappers still place every item")
        self.assertNotIn("A1:", b, "finder B never sees finder A's answer")
        self.assertEqual(rep["result"]["prompts_version"], "s1-v5")

    def test_c_only_the_items_in_scope(self):
        args = copy.deepcopy(self.args)
        args["chapter"]["pool"][0]["scope"] = ["g10m8s2-1"]
        rep, _ = self.run_s1(good_responses(self.args), "scope.json", args)
        p = {c["label"]: c["prompt"] for c in rep["calls"]}
        self.assertIn("[Ex8-6:1]", p["S1:findA:g10m8s2-1"])
        self.assertNotIn("[Ex8-6:1] (p.315)", p["S1:findA:g10m8s3-1"])

    # ------------------------------------------------------------------ (c) rule 1 and rule 2 unchanged
    def test_c_an_objective_practised_only_at_the_end_of_the_chapter(self):
        r = self.eoc_objective(good_responses(self.args), "g10m8s3-2", "Ex8-6:3")
        for m in ("S1:map:ch08:1", "S1:map2:ch08:1"):
            next(x for x in r[m]["mapping"] if x["item_id"] == "Ex8-6:3")["objective"] = "lo:g10m8s3-2-3"
        _, run = self.run_s1(r, "eoc.json")
        e = self.evaluate(run)
        self.assertEqual(e["failures"], [])
        o = next(l for l in e["lessons"] if l["slug"] == "g10m8s3-2")["objectives"][2]
        self.assertEqual({x["kind"] for x in o["evidence"]}, {"heading", "exercise"}, "rule 1: two kinds, one practice")
        self.assertEqual(o["exercise_items"], ["Ex8-6:3"], "the MAPPERS gave it the item")
        self.assertFalse([d for d in e["decisions"] if d["kind"] == "unpractised"])

    def test_c_one_kind_of_evidence_is_still_not_enough(self):
        r = self.eoc_objective(good_responses(self.args), "g10m8s3-2", "Ex8-6:3")
        for label in ("S1:findA:g10m8s3-2", "S1:findB:g10m8s3-2", "S1:reconcile:g10m8s3-2"):
            r[label]["objectives"][2]["evidence"] = r[label]["objectives"][2]["evidence"][1:]
        _, run = self.run_s1(r, "onekind.json")
        self.assertIn("lo:g10m8s3-2-3: 1 kind(s) of valid evidence (exercise); rule 1 needs two different kinds",
                      self.evaluate(run)["failures"])

    def test_c_an_item_outside_the_lessons_scope_is_not_its_evidence(self):
        args = copy.deepcopy(self.args)
        args["chapter"]["pool"][2]["scope"] = ["g10m8s2-1"]           # Ex8-6:3 no longer for 8.3 part 2
        r = self.eoc_objective(good_responses(self.args), "g10m8s3-2", "Ex8-6:3")
        _, run = self.run_s1(r, "outscope.json", args)
        o = next(l for l in self.evaluate(run, packet=args["chapter"])["lessons"]
                 if l["slug"] == "g10m8s3-2")["objectives"][2]
        self.assertIn("end-of-chapter item 'Ex8-6:3' is not in this lesson's scope",
                      [x["dropped"] for x in o["evidence_dropped"]])

    def test_c_listing_an_end_of_chapter_item_is_still_a_rule_2_failure(self):
        r = good_responses(self.args)
        r["S1:reconcile:g10m8s2-1"]["objectives"][1]["exercise_items"].append("Ex8-6:1")   # mapped to s2-1-1 too
        _, run = self.run_s1(r, "listed.json")
        self.assertTrue(any("Ex8-6:1 maps to 2 objectives" in f for f in self.evaluate(run)["failures"]))

    def test_c_an_objective_no_item_is_mapped_to_is_a_decision_g1_owes(self):
        r = self.eoc_objective(good_responses(self.args), "g10m8s3-2", "Ex8-6:3")   # mappers keep Ex8-6:3 on -1
        _, run = self.run_s1(r, "unpractised.json")
        e = self.evaluate(run)
        self.assertEqual(e["failures"], [])
        d = [x for x in ao.undecided(e["decisions"], {}) if x["kind"] == "unpractised"]
        self.assertEqual([x["objective"] for x in d], ["lo:g10m8s3-2-3"])
        e2 = self.evaluate(run, {"move_items": {"Ex8-6:3": "lo:g10m8s3-2-3"}})
        self.assertFalse([x for x in ao.undecided(e2["decisions"], {"move_items": {"Ex8-6:3": "lo:g10m8s3-2-3"}})
                          if x["kind"] == "unpractised"], "G1 moved an item to it")

    # ------------------------------------------------------------------ (b) the G1 verdict
    def both_mappers_say_none(self, item="Ex8-6:2"):
        r = good_responses(self.args)
        for m in ("S1:map:ch08:1", "S1:map2:ch08:1"):
            x = next(x for x in r[m]["mapping"] if x["item_id"] == item)
            x.update(objective="none", reason="asks for an area; no objective practises it")
        return self.run_s1(r, f"none-{item}.json")[1]

    def test_b_outside_lifts_rule_2_for_that_item_alone_and_is_recorded(self):
        run = self.both_mappers_say_none()
        self.assertTrue(any(f.startswith("distributed item Ex8-6:2 maps to no objective") for f in self.evaluate(run)["failures"]))
        v = {"outside_items": {"Ex8-6:2": {"why": "an area question; the chapter teaches no area objective"}}}
        e = self.evaluate(run, v)
        self.assertEqual(e["failures"], [])
        self.assertIsNone(e["pool"]["Ex8-6:2"], "kept out of practice")
        self.assertEqual(e["outside"], [{"item": "Ex8-6:2", "why": v["outside_items"]["Ex8-6:2"]["why"],
                                         "scope": ["g10m8s2-1", "g10m8s3-1", "g10m8s3-2"]}])
        v["acknowledged"] = [d["key"] for d in ao.undecided(e["decisions"], v)]   # the chapter's other decisions
        out = self.tmp / "objs-b"
        g1 = {"approved_by": "Samuel", "approved_at": "2026-09-26T10:00:00+00:00", "verdicts": v}
        res = ao.assemble(self.book, self.args, run, out, self.vocab, v, g1)
        self.assertEqual(res["status"], "approved")
        rec = json.loads((out / "g10m8s3-1.json").read_text())
        self.assertEqual(rec["outside_items"], [{"item": "Ex8-6:2", "why": v["outside_items"]["Ex8-6:2"]["why"],
                                                 "by": "Samuel", "at": "2026-09-26T10:00:00+00:00"}])
        self.assertNotIn("Ex8-6:2", [i for o in rec["objectives"] for i in o["exercise_items"]])
        self.assertEqual(res["check"]["counts"]["items_outside"], 1)
        self.assertEqual(res["check"]["outside_items"][0]["item"], "Ex8-6:2")

    def test_b_the_verdict_needs_a_reason_a_distributed_item_and_no_move(self):
        run = self.both_mappers_say_none()
        for v, words in (({"outside_items": {"Ex8-6:2": {"why": " "}}}, "without a reason"),
                         ({"outside_items": {"Ex8-2:1": "not taught here", "Ex8-6:2": "area"}}, "only a distributed"),
                         ({"outside_items": {"Ex8-6:2": "area"}, "move_items": {"Ex8-6:2": "lo:g10m8s3-1-1"}},
                          "both moved Ex8-6:2")):
            self.assertTrue(any(words in f for f in self.evaluate(run, v)["failures"]), (v, words))


    def test_an_empty_none_none_mapper_row_is_set_aside_and_counted(self):
        """Chapter 8 pilot: a mapper left a placeholder row {"item_id": "none", "objective": "none"} beside
        its 132 real rows. It places nothing, so it is set aside and counted, never read as a mapping; a
        row that names a real item still counts, and a missing real item still fails rule 2."""
        r = good_responses(self.args)
        r["S1:map:ch08:1"]["mapping"].insert(0, {"item_id": "none", "objective": "none", "reason": "placeholder removed"})
        run = self.run_s1(r, "empty-row.json")[1]
        e = self.evaluate(run)
        self.assertFalse(any("the mapper placed none" in f for f in e["failures"]), e["failures"])
        self.assertEqual(e["mapper_empty_rows"], 1)
        r = good_responses(self.args)
        r["S1:map:ch08:1"]["mapping"] = [x for x in r["S1:map:ch08:1"]["mapping"] if x["item_id"] != "Ex8-6:2"]
        r["S1:map:ch08:1"]["mapping"].append({"item_id": "none", "objective": "none", "reason": ""})
        e = self.evaluate(self.run_s1(r, "empty-row-missing.json")[1])
        self.assertTrue(any(f.startswith("distributed item Ex8-6:2 maps to no objective") for f in e["failures"]),
                        "a real item with no row still fails; the empty row does not stand in for it")


if __name__ == "__main__":
    unittest.main()
