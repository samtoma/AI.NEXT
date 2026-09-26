"""S1 objectives: runbook/objectives.workflow.js + assemble_objectives.py (B4, B5; tasks T334, T335).

No @covers marker, on purpose: deriving objectives is pipeline policy (Samuel's decision 12,
ADR-0005 amendment #1), and spec 003 carries no FR about objectives.

The workflow runs through tests/workflow_stub.mjs with canned agent responses; no model is
called. What is proved:
  - the chapter packet: the G0 lessons (a split section cut at its part's first block),
    items distributed at chapter level, maths from S0b, and nothing a finder must not see
    (no solution, no printed answer, no teacher-only note);
  - the workflow: two blind finders per lesson, a reconciler, a Haiku evidence check, a chapter
    mapper; 4 model calls per lesson plus the mapper;
  - the assembler's rules 1–6, G1's verdicts (drop renumbers, and the mapper's ids follow),
    and that nothing downstream gets args before G1.
"""

from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

EX = Path(__file__).resolve().parents[1]
if str(EX) not in sys.path:
    sys.path.insert(0, str(EX))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import assemble_objectives as ao  # noqa: E402
import book_config  # noqa: E402
import _objectives_fixture as fx  # noqa: E402

WORKFLOW = EX / "runbook" / "objectives.workflow.js"


def ev(kind, anchor, page, quote):
    return {"kind": kind, "anchor": anchor, "printed_page": page, "quote": quote}


def block_id(args, slug, type_, needle):
    lessons = {l["slug"]: l for l in args["chapter"]["lessons"]}
    pool = lessons[slug]["blocks"] if slug else args["chapter"]["summary"]
    return next(b["id"] for b in pool if b["type"] == type_ and needle in b["text"])


def good_responses(args) -> dict:
    """Canned agent outputs for the fixture chapter: every rule satisfied."""
    defn = block_id(args, "g10m8s2-1", "definition", "Distance formula")
    summ = block_id(args, None, "summary_item", "gradient of a line")
    sl_para = block_id(args, "g10m8s3-2", "para", "equation of a straight line")
    L = {
        "g10m8s2-1": [
            dict(statement="Calculate the distance between two points with the distance formula", label="Distance between points",
                 evidence=[ev("heading", "EMA69", 288, "Distance between two points"),
                           ev("worked_example", "WE1", 289, "Using the distance formula"),
                           ev("exercise", "Ex8-2:1", 292, "Find the distance between the points")],
                 exercise_items=["Ex8-2:1", "Ex8-2:2a", "Ex8-2:2b"], worked_examples=["WE1"],
                 terms=["distance formula"]),
            dict(statement="Show that a triangle is isosceles from the lengths of its sides", label="Isosceles by distance",
                 evidence=[ev("definition", defn, 288, "The distance between two points is"),
                           ev("exercise", "Ex8-2:3", 293, "Show that the triangle with vertices")],
                 exercise_items=["Ex8-2:3"], worked_examples=[], terms=["isosceles"]),
        ],
        "g10m8s3-1": [
            dict(statement="Calculate the gradient of a line through two points", label="Gradient from two points",
                 evidence=[ev("heading", "EMA6B", 293, "Gradient of a line"),
                           ev("worked_example", "WE3", 294, "Gradient between two points"),
                           ev("exercise", "Ex8-3:1", 296, "Find the gradient of the line through")],
                 exercise_items=["Ex8-3:1"], worked_examples=["WE3"], terms=["gradient"]),
            dict(statement="Decide whether a line's gradient is positive or negative", label="Sign of a gradient",
                 evidence=[ev("summary", summ, 314, "The gradient of a line is"),
                           ev("exercise", "Ex8-3:2", 296, "positive or negative")],
                 exercise_items=["Ex8-3:2"], worked_examples=[], terms=["gradient"]),
        ],
        "g10m8s3-2": [
            dict(statement="Determine the equation of a straight line from its gradient and a point", label="Equation of a line",
                 evidence=[ev("heading", "EMA6C", 298, "Straight lines"),
                           ev("worked_example", "WE5", 299, "Finding the equation of a straight line"),
                           ev("exercise", "Ex8-4:1", 302, "Find the equation of the line through")],
                 exercise_items=["Ex8-4:1"], worked_examples=["WE5"], terms=["straight line"]),
            dict(statement="Read the gradient from the equation of a straight line", label="Gradient from an equation",
                 evidence=[ev("intro", sl_para, 298, "The equation of a straight line is"),
                           ev("exercise", "Ex8-4:2", 302, "Write down the gradient of")],
                 exercise_items=["Ex8-4:2"], worked_examples=[], terms=["gradient"]),
        ],
    }
    r = {}
    for slug, objs in L.items():
        finder = copy.deepcopy({"objectives": [
            {k: o[k] for k in ("statement", "label", "evidence", "exercise_items", "worked_examples")} for o in objs]})
        r[f"S1:findA:{slug}"] = finder
        r[f"S1:findB:{slug}"] = copy.deepcopy(finder)
        r[f"S1:reconcile:{slug}"] = {
            "objectives": [dict(copy.deepcopy(o), confidence="agreed", **{"from": {"a": [f"A{i}"], "b": [f"B{i}"]}})
                           for i, o in enumerate(objs, 1)],
            "rejected": [], "unmapped_items": []}
        r[f"S1:evidence:{slug}"] = {"checks": [
            {"objective_n": i, "evidence_index": j, "present": True, "supports": True}
            for i, o in enumerate(objs, 1) for j in range(len(o["evidence"]))]}
    r["S1:map:ch08:1"] = {"mapping": [
        {"item_id": "Ex8-6:1", "objective": "lo:g10m8s2-1-1", "reason": "distance"},
        {"item_id": "Ex8-6:2", "objective": "lo:g10m8s3-1-1", "reason": "gradient"},
        {"item_id": "Ex8-6:3", "objective": "lo:g10m8s3-2-1", "reason": "equation"}]}
    # the second blind mapper (answer 12) agrees here; a disagreement is a G1 decision
    r["S1:map2:ch08:1"] = copy.deepcopy(r["S1:map:ch08:1"])
    # prerequisite links (answer 4): one the book evidences, one between the parts of 8.3 (derived,
    # so the assembler drops it), and one the checker rejects
    grad = block_id(args, "g10m8s3-1", "para", "gradient of a line is the ratio")
    line = block_id(args, "g10m8s3-2", "para", "equation of a straight line")
    r["S1:links:ch08"] = {"links": [
        dict(src="lo:g10m8s2-1-1", dst="lo:g10m8s3-1-1", signal="uses_method", reason="coordinates of two points",
             evidence=[ev("text", grad, 293, "the ratio of the vertical change to the horizontal change")]),
        dict(src="lo:g10m8s3-1-1", dst="lo:g10m8s3-2-1", signal="reference", reason="m is the gradient",
             evidence=[ev("text", line, 298, "where m is the gradient")]),
        dict(src="lo:g10m8s2-1-2", dst="lo:g10m8s3-2-2", signal="recall", reason="weak",
             evidence=[ev("exercise", "Ex8-4:2", 302, "Write down the gradient of")])],
        "outside_book": []}
    r["S1:linkcheck:ch08"] = {"checks": [{"i": 0, "verdict": "CONFIRMED"}, {"i": 1, "verdict": "CONFIRMED"},
                                         {"i": 2, "verdict": "REJECTED", "note": "no recall in the text"}]}
    return r


@unittest.skipUnless(fx.NODE, "node is needed to run workflow scripts through the stub runtime")
class ObjectivesStage(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.f = fx.build(self.tmp)
        self.book = book_config.load_book(self.f["book"])
        self.manifest = json.loads(self.f["manifest"].read_text())
        self.blocks = ao.load_blocks(self.f["blocks"])
        self.maths = ao.load_maths(self.f["maths"])
        self.args = ao.s1_args(self.book, self.manifest, self.blocks, self.maths, 8)
        self.vocab = ao.egyptian_vocabulary()

    def tearDown(self):
        self._tmp.cleanup()

    def run_s1(self, responses, name="ch08.json"):
        rep = fx.run_workflow(WORKFLOW, self.args, responses, self.tmp)
        self.assertTrue(rep["ok"], rep["error"])
        path = self.tmp / name
        path.write_text(json.dumps(rep["result"], ensure_ascii=False))
        return rep, ao.read_runs([path])

    def assemble(self, run, verdicts=None, g1=None):
        return ao.assemble(self.book, self.args, run, self.f["objectives"], self.vocab, verdicts, g1)

    # ------------------------------------------------------------------ the packet
    def test_packet_has_the_g0_lessons_and_cuts_the_split_section_at_its_part(self):
        c = self.args["chapter"]
        self.assertEqual([l["slug"] for l in c["lessons"]], ["g10m8s2-1", "g10m8s3-1", "g10m8s3-2"])
        p1, p2 = c["lessons"][1], c["lessons"][2]
        self.assertEqual(p1["provenance"]["part"], {"n": 1, "of": 2})
        self.assertEqual([w["anchor"] for w in p1["worked_examples"]], ["WE3"])
        self.assertEqual([w["anchor"] for w in p2["worked_examples"]], ["WE5"])
        self.assertEqual([i["item_id"] for i in p1["items"]], ["Ex8-3:1", "Ex8-3:2"])
        self.assertEqual([i["item_id"] for i in p2["items"]], ["Ex8-4:1", "Ex8-4:2"])
        self.assertIn("EMA6C", [b.get("anchor") for b in p2["blocks"]])
        self.assertNotIn("EMA6C", [b.get("anchor") for b in p1["blocks"]])
        self.assertEqual([p["item_id"] for p in c["pool"]], ["Ex8-6:1", "Ex8-6:2", "Ex8-6:3"])
        self.assertEqual(c["pool"][0]["scope"], ["g10m8s2-1", "g10m8s3-1", "g10m8s3-2"])
        self.assertEqual(len(c["summary"]), 3)
        self.assertEqual(self.args["teacher_only_dropped"], 2)

    def test_packet_renders_s0b_maths_and_hides_what_a_finder_must_not_see(self):
        text = json.dumps(self.args, ensure_ascii=False)
        self.assertNotIn("⟦m:", text)                                  # every image has its LaTeX
        self.assertIn("$d = \\\\sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}$", text)
        for secret in (fx.SOLUTION_MARK, fx.PRINTED_MARK, "ZZTEACHER"):
            self.assertNotIn(secret, text, f"{secret} reached the S1 packet")
        stem = self.args["chapter"]["lessons"][0]["items"][0]["problem"]
        self.assertTrue(stem.startswith("Find the distance between the points"), stem)   # the set's header

    def test_a_missing_maths_image_holds_the_chapter_for_g0b(self):
        maths = dict(self.maths)
        maths.pop(next(iter(maths)))
        with self.assertRaises(ao.StageError) as e:
            ao.s1_args(self.book, self.manifest, self.blocks, maths, 8)
        self.assertIn("G0b", str(e.exception))

    def test_a_book_that_prints_its_objectives_is_refused(self):
        with self.assertRaises(ao.StageError):
            ao.s1_args(self.book.model_copy(update={"objectives_mode": "printed"}),
                       self.manifest, self.blocks, self.maths, 8)

    # ------------------------------------------------------------------ the workflow
    def test_workflow_calls_and_blindness(self):
        rep, run = self.run_s1(good_responses(self.args))
        labels = [c["label"] for c in rep["calls"]]
        for slug in ("g10m8s2-1", "g10m8s3-1", "g10m8s3-2"):
            mine = [l for l in labels if l.endswith(":" + slug)]
            self.assertEqual(sorted(l.split(":")[1] for l in mine), ["evidence", "findA", "findB", "reconcile"])
        self.assertEqual(labels.count("S1:map:ch08:1"), 1)
        self.assertEqual(labels.count("S1:map2:ch08:1"), 1, "two blind mappers by default (answer 12)")
        # 4 per lesson + 2 mappers + the linker and its checker (answer 4)
        self.assertEqual(run["calls"]["total"], 16)
        self.assertEqual(run["calls"]["per_lesson"]["g10m8s3-1"], 4)
        models = {c["label"].split(":")[1]: c["model"] for c in rep["calls"]}
        self.assertEqual(models, {"findA": "sonnet", "findB": "sonnet", "reconcile": "sonnet",
                                  "evidence": "haiku", "map": "sonnet", "map2": "sonnet",
                                  "links": "sonnet", "linkcheck": "sonnet"})
        m1 = next(c["prompt"] for c in rep["calls"] if c["label"] == "S1:map:ch08:1")
        m2 = next(c["prompt"] for c in rep["calls"] if c["label"] == "S1:map2:ch08:1")
        self.assertNotEqual(m1, m2, "the second mapper has its own framing")
        check = next(c["prompt"] for c in rep["calls"] if c["label"] == "S1:linkcheck:ch08")
        self.assertNotIn("coordinates of two points", check, "the checker never sees the linker's reason")
        self.assertIn("the ratio of the vertical change", check, "it sees the anchored text instead")
        # finder B never sees finder A's output, and the finders read the book differently
        a = next(c["prompt"] for c in rep["calls"] if c["label"] == "S1:findA:g10m8s2-1")
        b = next(c["prompt"] for c in rep["calls"] if c["label"] == "S1:findB:g10m8s2-1")
        self.assertNotIn("A1:", b)
        self.assertIn("TOP-DOWN", a)
        self.assertIn("BOTTOM-UP", b)
        for c in rep["calls"]:
            for secret in (fx.SOLUTION_MARK, fx.PRINTED_MARK, "ZZTEACHER"):
                self.assertNotIn(secret, c["prompt"], f"{secret} reached {c['label']}")
        # finder keys are assigned by the script, not trusted from the model
        self.assertEqual([o["key"] for o in run["lessons"][0]["finders"]["b"]["objectives"]], ["B1", "B2"])
        self.assertEqual(run["packet_sha256"], self.args["packet_sha256"])

    def test_a_dead_finder_does_not_stop_the_chapter(self):
        r = good_responses(self.args)
        r["S1:findA:g10m8s3-1"] = None
        rep, run = self.run_s1(r)
        rec = next(l for l in run["lessons"] if l["slug"] == "g10m8s3-1")
        self.assertEqual(rec["finders"]["a"], {"objectives": []})

    # ------------------------------------------------------------------ the rules
    def test_good_chapter_assembles_awaiting_g1_in_the_bundle_assemblers_shape(self):
        _, run = self.run_s1(good_responses(self.args))
        res = self.assemble(run)
        self.assertEqual(res["check"]["failures"], [])
        self.assertEqual(res["status"], "awaiting_g1")
        rec = json.loads((self.f["objectives"] / "g10m8s2-1.json").read_text())
        self.assertEqual([o["id"] for o in rec["objectives"]], ["lo:g10m8s2-1-1", "lo:g10m8s2-1-2"])
        self.assertEqual(sorted(rec["objectives"][0]["exercise_items"]),
                         ["Ex8-2:1", "Ex8-2:2a", "Ex8-2:2b", "Ex8-6:1"])      # + its distributed item
        self.assertEqual(rec["pool_items"], ["Ex8-6:1"])
        self.assertEqual(rec["objectives"][0]["node"]["syllabus_ref"], "8.2")
        self.assertEqual(rec["objectives"][0]["node"]["source_page"], 288)
        # the shape assemble_lesson_bundle.py reads (WP-P4's own model)
        from assemble_lesson_bundle import ObjectivesFile
        ObjectivesFile.model_validate(rec)
        page = (self.f["objectives"] / "ch08.review.html").read_text()
        self.assertIn("Chapter 8: Analytical geometry", page)
        self.assertIn("var(--ground)", page)
        self.assertNotIn("#fff", page.split("</style>")[1])            # no literal colour in the body
        # rule 3: "gradient" is not in the Egyptian book's vocabulary ("slope" is): flagged, kept
        flags = json.loads((self.f["objectives"] / "terminology-flags.json").read_text())["flags"]
        terms = {f["term"] for f in flags}
        self.assertIn("gradient", terms)                  # the book's word; the Egyptian book says "slope"
        self.assertIn("distance formula", terms)          # absent from the Prep-3 bundles too
        self.assertNotIn("isosceles", terms)              # the Egyptian book uses it
        self.assertNotIn("straight line", terms)
        rec3 = json.loads((self.f["objectives"] / "g10m8s3-1.json").read_text())
        self.assertIn("gradient", rec3["objectives"][0]["statement"])

    def test_prerequisite_links_are_evidenced_checked_and_never_between_parts(self):
        _, run = self.run_s1(good_responses(self.args))
        res = self.assemble(run)
        self.assertEqual(res["check"]["failures"], [])
        c = res["check"]["counts"]
        self.assertEqual((c["links_proposed"], c["links_kept"], c["links_dropped"], c["mappers"]), (3, 1, 2, 2))
        why = {d["key"]: d["dropped"] for d in res["check"]["links"]["dropped"]}
        self.assertIn("derived", why["lo:g10m8s3-1-1->lo:g10m8s3-2-1"])
        self.assertIn("REJECTED", why["lo:g10m8s2-1-2->lo:g10m8s3-2-2"])
        rec = json.loads((self.f["objectives"] / "g10m8s3-1.json").read_text())
        self.assertEqual([(p["src"], p["dst"], p["signal"]) for p in rec["prerequisites"]],
                         [("lo:g10m8s2-1-1", "lo:g10m8s3-1-1", "uses_method")])
        self.assertEqual(rec["prerequisites"][0]["check"]["verdict"], "CONFIRMED")
        from assemble_lesson_bundle import ObjectivesFile
        self.assertEqual([(p.src, p.dst) for p in ObjectivesFile.model_validate(rec).prerequisites],
                         [("lo:g10m8s2-1-1", "lo:g10m8s3-1-1")])
        page = (self.f["objectives"] / "ch08.review.html").read_text()
        self.assertIn("Prerequisite links", page)
        self.assertIn("derived", page)

    def test_a_link_whose_quote_is_not_at_its_anchor_or_that_g1_drops_is_not_kept(self):
        r = good_responses(self.args)
        r["S1:links:ch08"]["links"][0]["evidence"][0]["quote"] = "a sentence the book never prints"
        _, run = self.run_s1(r)
        res = self.assemble(run)
        self.assertEqual(res["check"]["counts"]["links_kept"], 0)
        self.assertIn("not at its anchor", res["check"]["links"]["dropped"][0]["dropped"])
        _, run = self.run_s1(good_responses(self.args), name="again.json")
        res = self.assemble(run, {"links": {"lo:g10m8s2-1-1->lo:g10m8s3-1-1": "drop"}})
        self.assertEqual(res["check"]["counts"]["links_kept"], 0)

    def test_a_backward_link_and_a_dead_linker_are_decisions_g1_owes(self):
        r = good_responses(self.args)
        lk = r["S1:links:ch08"]["links"][0]
        para = block_id(self.args, "g10m8s2-1", "para", "distance formula")
        lk.update(src="lo:g10m8s3-1-1", dst="lo:g10m8s2-1-1",
                  evidence=[ev("text", para, 288, "is found with the distance formula")])
        _, run = self.run_s1(r)
        res = self.assemble(run)
        self.assertIn("link_backward", [d["kind"] for d in res["check"]["undecided"]])
        res = self.assemble(run, {"links": {"lo:g10m8s3-1-1->lo:g10m8s2-1-1": "approve"}})
        self.assertNotIn("link_backward", [d["kind"] for d in res["check"]["undecided"]])
        r = good_responses(self.args)
        r["S1:links:ch08"] = None
        _, run = self.run_s1(r, name="nolinks.json")
        res = self.assemble(run)
        self.assertIn("links_failed", [d["kind"] for d in res["check"]["undecided"]])

    def test_the_second_mapper_is_required_and_its_disagreement_goes_to_g1(self):
        r = good_responses(self.args)
        r["S1:map2:ch08:1"]["mapping"][1]["objective"] = "lo:g10m8s3-1-2"
        _, run = self.run_s1(r)
        res = self.assemble(run)
        self.assertEqual([d["item"] for d in res["check"]["undecided"] if d["kind"] == "mappers_disagree"],
                         ["Ex8-6:2"])
        r["S1:map2:ch08:1"] = None
        _, run = self.run_s1(r, name="nomap2.json")
        res = self.assemble(run)
        self.assertTrue(any("second blind mapper" in f for f in res["check"]["failures"]))

    def test_rule1_evidence_must_be_two_kinds_with_practice_and_come_from_a_finder(self):
        r = good_responses(self.args)
        rec = r["S1:reconcile:g10m8s2-1"]["objectives"]
        rec[1]["evidence"] = [rec[1]["evidence"][0]]                   # a definition only
        rec[0]["evidence"].append(ev("heading", "EMA69", 288, "an invented quote"))   # not from a finder
        _, run = self.run_s1(r)
        res = self.assemble(run)
        f = "\n".join(res["check"]["failures"])
        self.assertIn("lo:g10m8s2-1-2: 1 kind(s) of valid evidence", f)
        self.assertIn("lo:g10m8s2-1-2: no valid worked-example or exercise evidence", f)
        self.assertEqual(res["status"], "rejected")
        dropped = json.loads((self.f["objectives"] / "g10m8s2-1.json").read_text())["objectives"][0]["evidence_dropped"]
        self.assertTrue(any("not cited by either finder" in d["dropped"] for d in dropped))

    def test_rule1_quote_must_be_at_its_anchor_and_page(self):
        r = good_responses(self.args)
        e = r["S1:findA:g10m8s3-1"]["objectives"][0]["evidence"]
        e[2]["quote"] = "words that are not in the item"
        e[1]["printed_page"] = 250
        for side in ("findB", "reconcile"):
            r[f"S1:{side}:g10m8s3-1"]["objectives"][0]["evidence"] = copy.deepcopy(e)
        r["S1:evidence:g10m8s3-1"]["checks"][2]["present"] = False
        _, run = self.run_s1(r)
        res = self.assemble(run)
        rec = json.loads((self.f["objectives"] / "g10m8s3-1.json").read_text())
        why = {d["anchor"]: d["dropped"] for d in rec["objectives"][0]["evidence_dropped"]}
        self.assertIn("not at its anchor", why["Ex8-3:1"])
        self.assertIn("printed page 250", why["WE3"])
        self.assertIn("lo:g10m8s3-1-1: no valid worked-example or exercise evidence",
                      "\n".join(res["check"]["failures"]))

    def test_rule2_every_item_to_exactly_one_objective(self):
        r = good_responses(self.args)
        objs = r["S1:reconcile:g10m8s3-2"]["objectives"]
        objs[1]["exercise_items"] = ["Ex8-4:1"]                        # Ex8-4:1 twice, Ex8-4:2 never
        r["S1:map:ch08:1"]["mapping"][2]["objective"] = "none"
        _, run = self.run_s1(r)
        f = "\n".join(self.assemble(run)["check"]["failures"])
        self.assertIn("Ex8-4:1 maps to 2 objectives", f)
        self.assertIn("Ex8-4:2 maps to no objective", f)
        self.assertIn("distributed item Ex8-6:3 maps to no objective", f)

    def test_rule4_granularity_and_rule5_no_invented_objective(self):
        r = good_responses(self.args)
        objs = r["S1:reconcile:g10m8s2-1"]["objectives"]
        objs[1]["from"] = {"a": [], "b": []}
        r2 = good_responses(self.args)
        _, run = self.run_s1(r)
        f = "\n".join(self.assemble(run)["check"]["failures"])
        self.assertIn("lo:g10m8s2-1-2: no finder found it", f)
        one = r2["S1:reconcile:g10m8s3-1"]
        one["objectives"] = one["objectives"][:1]
        one["objectives"][0]["exercise_items"] = ["Ex8-3:1", "Ex8-3:2"]
        one["rejected"] = [{"key": "A2", "reason": "fixture"}, {"key": "B2", "reason": "fixture"}]
        r2["S1:evidence:g10m8s3-1"]["checks"] = r2["S1:evidence:g10m8s3-1"]["checks"][:3]
        _, run2 = self.run_s1(r2, "ch08b.json")
        self.assertIn("g10m8s3-1: 1 objective(s); rule 4 wants 2–5",
                      "\n".join(self.assemble(run2)["check"]["failures"]))

    def test_rule5_single_and_silently_dropped_finder_objectives_are_g1_decisions(self):
        r = good_responses(self.args)
        r["S1:reconcile:g10m8s3-1"]["objectives"][1]["from"] = {"a": ["A2"], "b": []}   # B2 dropped, no reason
        _, run = self.run_s1(r)
        res = self.assemble(run)
        kinds = {d["kind"] for d in res["check"]["undecided"]}
        self.assertIn("single", kinds)
        self.assertIn("finder_dropped", kinds)
        self.assertIn("terminology", kinds)
        self.assertEqual(res["status"], "awaiting_g1")

    # ------------------------------------------------------------------ G1 and after
    def verdicts_for(self, check):
        v = {"objectives": {}, "terminology": {}, "acknowledged": []}
        for d in check["undecided"]:
            if d["kind"] == "single":
                v["objectives"][d["objective"]] = {"action": "approve"}
            elif d["kind"] == "terminology":
                v["terminology"][d["key"].split(":", 1)[1]] = "keep"
            else:
                v["acknowledged"].append(d["key"])
        return v

    def test_g1_drop_renumbers_and_the_mapper_follows_and_lesson_args_waits_for_g1(self):
        r = good_responses(self.args)
        # a third objective in 8.2, which G1 drops; the distributed item mapped to the objective after it
        extra = copy.deepcopy(r["S1:reconcile:g10m8s2-1"]["objectives"][1])
        extra.update(statement="State the coordinates of a point", exercise_items=[])
        r["S1:reconcile:g10m8s2-1"]["objectives"].insert(1, extra)
        r["S1:evidence:g10m8s2-1"]["checks"] += [{"objective_n": 3, "evidence_index": j, "present": True, "supports": True}
                                                for j in range(2)]
        r["S1:map:ch08:1"]["mapping"][0]["objective"] = "lo:g10m8s2-1-3"
        _, run = self.run_s1(r)
        res = self.assemble(run)
        with self.assertRaises(ao.StageError):                          # before G1: nothing downstream
            ao.lesson_args(self.book, self.manifest, self.blocks, self.maths, self.f["objectives"],
                           ["g10m8s2-1"], self.f["work"])
        v = self.verdicts_for(res["check"])
        v["objectives"]["lo:g10m8s2-1-2"] = {"action": "drop"}
        ev_ = ao.evaluate_chapter(self.args["chapter"], run, self.vocab, v)
        self.assertEqual(ev_["failures"], [])
        self.assertEqual(ao.undecided(ev_["decisions"], v), [])
        g1 = {"approved_by": "fixture reviewer", "approved_at": "2026-09-25T00:00:00+00:00"}
        res = self.assemble(run, v, g1)
        self.assertEqual(res["status"], "approved")
        rec = json.loads((self.f["objectives"] / "g10m8s2-1.json").read_text())
        self.assertEqual([o["id"] for o in rec["objectives"]], ["lo:g10m8s2-1-1", "lo:g10m8s2-1-2"])
        self.assertEqual(rec["objectives"][1]["provisional_id"], "lo:g10m8s2-1-3")
        self.assertIn("Ex8-6:1", rec["objectives"][1]["exercise_items"])   # followed the renumbering
        self.assertEqual(rec["g1"]["approved_by"], "fixture reviewer")
        la = ao.lesson_args(self.book, self.manifest, self.blocks, self.maths, self.f["objectives"],
                            ["g10m8s2-1", "g10m8s3-1", "g10m8s3-2"], self.f["work"])
        self.assertEqual(len(la["lessons"]), 3)

    def test_a_run_on_other_inputs_is_refused(self):
        _, run = self.run_s1(good_responses(self.args))
        run["packet_sha256"] = "0" * 64
        with self.assertRaises(ao.StageError):
            self.assemble(run)


class RealBookPackets(unittest.TestCase):
    """The S1 packets of the whole Grade 10 book, when S0a has run in this checkout (work/ is
    gitignored scratch). Maths is a placeholder here: S0b has not run."""

    def setUp(self):
        self.work = EX / "work" / "g10-math"
        if not (self.work / "blocks.jsonl").exists():
            self.skipTest("no S0a output in services/extraction/work/g10-math")
        self.book = book_config.load_book("g10-math")
        self.manifest = json.loads(self.book.repo_path(self.book.manifest).read_text())
        self.blocks = ao.load_blocks(self.work / "blocks.jsonl")
        hs = set()
        for b in self.blocks:
            hs.update(ao.MATH_REF_RE.findall(json.dumps(b, ensure_ascii=False)))
        self.maths = {h: r"\mathrm{M}" for h in hs}

    def test_every_item_of_the_book_is_in_exactly_one_packet(self):
        items, lessons = [], 0
        for ch in range(1, 15):
            a = ao.s1_args(self.book, self.manifest, self.blocks, self.maths, ch)
            lessons += len(a["chapter"]["lessons"])
            items += [i["item_id"] for l in a["chapter"]["lessons"] for i in l["items"]]
            items += [p["item_id"] for p in a["chapter"]["pool"]]
        self.assertEqual(lessons, 65)                                   # G0
        self.assertEqual(len(items), 2531)                              # S0 report §4
        self.assertEqual(len(set(items)), 2531)


if __name__ == "__main__":
    unittest.main()
