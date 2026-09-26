"""The lesson conveyor: runbook/lesson.workflow.js (S2–S4, S8; B6, task T337), its args
(`assemble_objectives.py lesson-args`) and its handoff (`lesson-runs`) to assemble_lesson_bundle.py.

@covers FR-4302, FR-4303, FR-4403, FR-4408

FR-4302: canonical solutions are the book's (book_worked / book_worked_epub), never an agent's;
         `agreed` needs blind = printed = book-solution final answer; disagreements and items
         with no printed answer are held and listed for G2.
FR-4303: every item typed once (numeric / choice only where natural / expression with the marker
         spec / not_markable kept as teaching material).
FR-4403: every stage reports what it produced, what it rejected and why, and its call count.
FR-4408: no teacher-only note reaches a prompt or a claim.
(FR-4320's marker spec shape is the schema's; see test_schemas_v2.py.)

The workflow runs through tests/workflow_stub.mjs with canned agent responses; no model is called.
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
from test_objectives import WORKFLOW as S1_WORKFLOW, good_responses  # noqa: E402

WORKFLOW = EX / "runbook" / "lesson.workflow.js"


def fnv(s: str) -> int:
    """The workflow's FNV-1a, to know which items its tier check samples."""
    h = 0x811C9DC5
    for ch in s:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


# What each item's typing and blind re-solve return (by ref), and the judge's answers.
TYPING = {
    "WE1": dict(answer_type="numeric", key="5", book_final="5", tier="basic"),
    "Ex8-2:1": dict(answer_type="numeric", key="5", book_final="5", tier="basic"),
    "Ex8-2:2a": dict(answer_type="expression", key="\\sqrt{29}", marker_kind="surd", form="", variables=[],
                     book_final="d = \\sqrt{29}", tier="standard"),
    "Ex8-2:2b": dict(answer_type="numeric", key="6,5", book_final="d = 6{,}5", tier="standard"),
    "Ex8-2:3": dict(answer_type="not_markable", key="", book_final="the triangle is isosceles",
                    not_markable_reason="show that", tier="standard"),
    "Ex8-6:1": dict(answer_type="numeric", key="5", book_final="d = 5", tier="advanced"),
    "WE3": dict(answer_type="numeric", key="3", book_final="m = 3", tier="basic"),
    "Ex8-3:1": dict(answer_type="numeric", key="3", book_final="3", tier="basic"),
    "Ex8-3:2": dict(answer_type="choice", key="negative", options=["positive", "negative"], options_source="stem",
                    book_final="negative", tier="basic"),
    "Ex8-6:2": dict(answer_type="numeric", key="2", book_final="m = 2", tier="advanced"),
    "WE5": dict(answer_type="expression", key="y = 2x + 1", marker_kind="equation", form="", variables=["x", "y"],
                book_final="y = 2x + 1", tier="standard"),
    "Ex8-4:1": dict(answer_type="expression", key="y = 3x + 2", marker_kind="equation", form="", variables=["x", "y"],
                    book_final="y = 3x + 2", tier="standard"),
    "Ex8-4:2": dict(answer_type="numeric", key="-4", book_final="m = -4", tier="basic"),
    "Ex8-6:3": dict(answer_type="expression", key="y = 5x − 1", marker_kind="equation", form="subject", subject="y",
                    variables=["x", "y"], book_final="y = 5x - 1", tier="advanced"),
}
BLIND = {"WE1": "5", "Ex8-2:1": "5", "Ex8-2:2a": "\\sqrt{29}", "Ex8-2:2b": "6.4", "Ex8-2:3": "",
         "Ex8-6:1": "5", "WE3": "3", "Ex8-3:1": "3", "Ex8-3:2": "negative", "Ex8-6:2": "2",
         "WE5": "y=2x+1", "Ex8-4:1": "y = 3x + 2", "Ex8-4:2": "-4", "Ex8-6:3": "y = 5x - 1"}


class LessonConveyor(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not fx.NODE:
            raise unittest.SkipTest("node is needed to run workflow scripts through the stub runtime")
        cls._tmp = tempfile.TemporaryDirectory()
        tmp = cls.tmp = Path(cls._tmp.name)
        f = cls.f = fx.build(tmp)
        cls.book = book_config.load_book(f["book"])
        cls.manifest = json.loads(f["manifest"].read_text())
        cls.blocks = ao.load_blocks(f["blocks"])
        cls.maths = ao.load_maths(f["maths"])
        s1 = ao.s1_args(cls.book, cls.manifest, cls.blocks, cls.maths, 8)
        rep = fx.run_workflow(S1_WORKFLOW, s1, good_responses(s1), tmp)
        (tmp / "s1.json").write_text(json.dumps(rep["result"]))
        run = ao.read_runs([tmp / "s1.json"])
        vocab = ao.egyptian_vocabulary()
        ev = ao.evaluate_chapter(s1["chapter"], run, vocab)
        v = {"terminology": {d["key"].split(":", 1)[1]: "keep" for d in ev["decisions"] if d["kind"] == "terminology"}}
        res = ao.assemble(cls.book, s1, run, f["objectives"], vocab, v,
                          {"approved_by": "fixture reviewer", "approved_at": "2026-09-25T00:00:00+00:00"})
        assert res["status"] == "approved", res["check"]
        cls.args = ao.lesson_args(cls.book, cls.manifest, cls.blocks, cls.maths, f["objectives"],
                                  ["g10m8s2-1", "g10m8s3-1", "g10m8s3-2"], f["work"])

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    # ---------------------------------------------------------------- canned responses
    def responses(self) -> dict:
        r = {}
        for L in self.args["lessons"]:
            s = L["slug"]
            lo1 = L["objectives"][0]["id"]
            refs = [w["ref"] for w in L["worked_examples"]] + [i["ref"] for i in L["items"]]
            anchor = L["blocks"][1]
            claims = [dict(lo=lo1, type="rule", text=anchor["text"][:80], anchor=anchor.get("anchor") or anchor["id"],
                           printed_page=anchor["printed_page"], quote=anchor["text"][4:40])]
            if s == "g10m8s2-1":
                defn = next(b for b in L["blocks"] if b["type"] == "definition")
                claims = [
                    dict(lo=lo1, type="definition", text="The distance between two points is given by the distance formula.",
                         anchor=defn["id"], printed_page=288, quote="The distance between two points is"),
                    dict(lo=lo1, type="method", text="Substitute the coordinates into the formula and simplify.",
                         anchor="WE1", printed_page=289, quote="Substitute and simplify"),
                    dict(lo=lo1, type="rule", text="A length found this way is never negative.",
                         anchor=defn["id"], printed_page=288, quote="never negative"),       # paraphrase: checked
                    dict(lo=lo1, type="caution", text="The formula is introduced before the gradient.",
                         anchor=defn["id"], printed_page=288, quote="CAPS introduces this formula before the gradient"),
                    dict(lo="lo:g10m9s9-9-9", type="rule", text="Off-lesson.", anchor=defn["id"], printed_page=288,
                         quote="The distance between two points is"),
                ]
                r[f"S2:prov:{s}"] = {"checks": [{"i": 2, "supported": False, "note": "not stated"}]}
                r[f"S2:audit:{s}"] = {"verdicts": [{"i": 2, "verdict": "SUPPORTED", "note": "a square root is not negative"}]}
                r[f"S3:judge:{s}:1"] = {"verdicts": [
                    {"pair_id": "Ex8-2:1|blind~printed", "verdict": "equivalent"},
                    {"pair_id": "Ex8-2:1|book~printed", "verdict": "equivalent"},
                    {"pair_id": "Ex8-2:2b|blind~printed", "verdict": "different", "reason": "6.4 is not 6.5"},
                    {"pair_id": "Ex8-2:2b|blind~book", "verdict": "different", "reason": "6.4 is not 6.5"}]}
                figs = {f["context"]: f["figure_id"] for f in L["figures"]}
                r[f"S4:viz:{s}:1"] = {"figures": [
                    {"figure_id": figs["body"], "decision": "viz", "kind": "coordinate_plot",
                     "spec": {"xRange": [0, 6], "yRange": [0, 7], "points": [{"x": 1, "y": 2}, {"x": 4, "y": 6}],
                              "segments": [[0, 1]], "animate": "plot-sequence"},
                     "caption": "The distance between two points", "lo": lo1},
                    {"figure_id": figs["exercise_problem"], "decision": "gap", "lo": lo1,
                     "gap_reason": "a labelled grid diagram with a hidden point", "needed_kind": "grid_points"}]}
                r[f"S4:compare:{s}"] = {"checks": [{"figure_id": figs["body"], "faithful": True}]}
            r[f"S2:claims:{s}"] = {"claims": claims}
            r[f"S3:type:{s}:1"] = {"items": [dict(TYPING[x], ref=x) for x in refs]}
            r[f"S3:blind:{s}:1"] = {"answers": [{"ref": x, "final_answer": BLIND[x], "markable": x != "Ex8-2:3"}
                                                for x in refs]}
            sampled = [x for x in refs if fnv(f"{s}:{x}") % 5 == 0] or refs[:1]
            r[f"S3:tier:{s}"] = {"tiers": [{"ref": x, "tier": "advanced"} for x in sampled]}
            r[f"S8:oracle:{s}"] = {"verdict": "GREEN", "subheadings": [{"anchor": s, "status": "covered"}]}
        return r

    def run_lessons(self, responses):
        rep = fx.run_workflow(WORKFLOW, self.args, responses, self.tmp)
        self.assertTrue(rep["ok"], rep["error"])
        return rep, {l["lesson"]: l for l in rep["result"]["lessons"]}

    # ---------------------------------------------------------------- the args
    def test_args_carry_the_book_solution_and_nothing_from_a_teacher(self):
        L = {l["slug"]: l for l in self.args["lessons"]}
        s2 = L["g10m8s2-1"]
        refs = [i["ref"] for i in s2["items"]]
        self.assertEqual(refs, ["Ex8-2:1", "Ex8-2:2a", "Ex8-2:2b", "Ex8-2:3", "Ex8-6:1"])
        it = s2["items"][0]
        self.assertEqual(it["solution_provenance"], "book_worked_epub")
        self.assertEqual(it["solution"][1], "$d = \\sqrt{3^2 + 4^2} = 5$")     # display maths: its own step
        self.assertEqual(s2["worked_examples"][0]["solution_provenance"], "book_worked")
        self.assertTrue(s2["items"][1]["figures"][0].endswith("tikzpicture__fig-item.png"))
        self.assertEqual([k["kind"] for k in self.args["viz_kinds"]], list(ao.MATH_VIZ_KINDS))
        blocks_text = json.dumps([l["blocks"] for l in self.args["lessons"]])
        self.assertNotIn("ZZTEACHER", blocks_text)
        self.assertEqual(len(s2["teacher_only"]), 1)                          # for the leak check only

    # ---------------------------------------------------------------- the run
    def test_the_conveyor(self):
        rep, out = self.run_lessons(self.responses())
        res = rep["result"]
        a = out["g10m8s2-1"]
        items = {i["ref"]: i for i in a["items"]}

        # S3: never solved from scratch; three-way agreement or held (FR-4302)
        self.assertEqual({i["solution_provenance"] for i in a["items"]}, {"book_worked", "book_worked_epub"})
        for i in a["items"]:
            src = next((x for x in self.args["lessons"][0]["items"] + self.args["lessons"][0]["worked_examples"]
                        if x["ref"] == i["ref"]))
            self.assertEqual(i["solution"], src["solution"])                   # the book's, verbatim
        self.assertEqual(items["Ex8-2:1"]["verification"], "agreed")           # settled by the judge
        self.assertEqual(items["Ex8-2:2a"]["verification"], "agreed")          # settled by signature (√ 29)
        self.assertEqual({p["route"] for p in items["Ex8-2:2a"]["verify"]["pairs"]}, {"signature", "normalised"})
        self.assertEqual(items["Ex8-2:2b"]["verification"], "disputed")        # blind 6.4, book 6,5
        self.assertEqual(items["Ex8-2:3"]["verification"], "no_printed_answer")
        self.assertEqual(items["WE1"]["verification"], "agreed")
        self.assertEqual([d["ref"] for d in a["verify"]["disagreements"]], ["Ex8-2:2b"])
        self.assertEqual([d["ref"] for d in a["verify"]["no_printed_answer"]], ["Ex8-2:3"])

        # typing (FR-4303, the marker spec of contracts/answer-marker.md)
        self.assertEqual(items["Ex8-2:2a"]["marker"], {"kind": "surd", "key": "\\sqrt{29}", "form": None,
                                                        "variables": [], "tolerance": None})
        self.assertEqual(items["Ex8-2:2b"]["answer"], "6,5")                   # as printed; assembly normalises
        self.assertEqual(items["Ex8-2:3"]["answer_type"], "not_markable")
        c = {i["ref"]: i for i in out["g10m8s3-1"]["items"]}["Ex8-3:2"]
        self.assertEqual(c["choices"], [{"key": "A", "text": "positive"}, {"key": "B", "text": "negative"}])
        self.assertEqual(c["answer"], "B")
        e = {i["ref"]: i for i in out["g10m8s3-2"]["items"]}["Ex8-6:3"]
        self.assertEqual(e["marker"]["form"], {"subject": "y"})
        self.assertEqual(sum(a["counts"]["by_answer_type"].values()), len(a["items"]))   # each typed once

        # the blind re-solve saw no answer and no solution
        for call in rep["calls"]:
            if call["label"].startswith("S3:blind:"):
                for secret in (fx.PRINTED_MARK, fx.SOLUTION_MARK, "6,5", "√ 29"):
                    self.assertNotIn(secret, call["prompt"])
            self.assertNotIn("ZZTEACHER", call["prompt"])                     # FR-4408, every prompt

        # S2: containment, check, re-audit; a teacher echo and an off-lesson claim dropped (FR-4408)
        prov = {c["text"]: c["provenance"] for c in a["claims"]}
        self.assertEqual(prov["Substitute the coordinates into the formula and simplify."], "containment")
        self.assertEqual(prov["A length found this way is never negative."], "re-audited")
        reasons = " | ".join(d["reason"] for d in a["claims_dropped"])
        self.assertIn("teacher-only", reasons)
        self.assertIn("unknown objective", reasons)
        self.assertEqual(a["teacher_only"], {"seen": 1, "dropped": 1, "reached_claim": 0, "caught_in_claims": 1})

        # S4: existing kinds only; a gap blocks the exercise that needs the figure
        self.assertEqual([v["kind"] for v in a["visuals"]], ["coordinate_plot"])
        self.assertEqual(a["viz_gaps"][0]["needed_kind"], "grid_points")
        self.assertTrue(items["Ex8-2:2a"]["blocked_on_figure"])
        self.assertEqual(a["figure_blocked"], ["Ex8-2:2a"])

        # tier check: the sampled items take the blind tier
        sampled = [t["ref"] for t in a["verify"]["tier_checks"]]
        self.assertTrue(sampled)
        self.assertTrue(all(items[x]["tier"] == "advanced" for x in sampled))

        # FR-4403: what each stage cost in calls, per lesson
        self.assertEqual(res["calls"]["per_lesson"], {"g10m8s2-1": 10, "g10m8s3-1": 5, "g10m8s3-2": 5})
        self.assertEqual(set(res["calls"]["by_phase"]), {"S2 Claims", "S2 Provenance", "S3 Typing",
                                                          "S3 Blind re-solve", "S3 Judge", "S3 Tier check",
                                                          "S4 Visuals", "S4 Compare", "S8 Oracle"})
        models = {c["label"].split(":")[0] + ":" + c["label"].split(":")[1]: c["model"] for c in rep["calls"]}
        self.assertEqual(models["S3:type"], "haiku")
        self.assertEqual(models["S3:blind"], "sonnet")
        self.assertEqual(models["S4:compare"], "haiku")
        self.assertIn("--by phase", res["meter"]["by_stage"])
        self.assertEqual(a["oracle"]["verdict"], "GREEN")

        # the handoff: WP-P4's own model accepts every lesson (G2 not yet held)
        files = ao.lesson_runs(res)
        self.assertEqual(sorted(files), ["g10m8s2-1", "g10m8s3-1", "g10m8s3-2"])

    def test_s4_never_forces_a_figure_into_a_kind(self):
        r = self.responses()
        viz = r["S4:viz:g10m8s2-1:1"]["figures"][0]
        viz["kind"] = "triangle_scene"                                   # not an existing kind
        _, out = self.run_lessons(r)
        reasons = [g["reason"] for g in out["g10m8s2-1"]["viz_gaps"]]
        self.assertEqual(out["g10m8s2-1"]["visuals"], [])
        self.assertIn('"triangle_scene" is not an existing VIZ kind', reasons)
        r = self.responses()
        r["S4:compare:g10m8s2-1"]["checks"][0].update(faithful=False, issues="wrong second point")
        _, out = self.run_lessons(r)
        self.assertEqual(out["g10m8s2-1"]["visuals"], [])
        rejected = [g for g in out["g10m8s2-1"]["viz_gaps"] if "rejected_spec" in g]
        self.assertEqual(rejected[0]["rejected_spec"]["kind"], "coordinate_plot")
        self.assertIn("wrong second point", rejected[0]["reason"])

    def test_bad_typing_is_held_for_g2_and_the_handoff_refuses_it_until_fixed(self):
        r = self.responses()
        for t in r["S3:type:g10m8s3-1:1"]["items"]:
            if t["ref"] == "Ex8-3:2":
                t["options"] = ["negative"]                              # a choice with one option
        rep, out = self.run_lessons(r)
        item = {i["ref"]: i for i in out["g10m8s3-1"]["items"]}["Ex8-3:2"]
        self.assertTrue(item["typing_problems"])
        with self.assertRaises(ao.StageError) as e:
            ao.lesson_runs(rep["result"])
        self.assertIn("g10m8s3-1:Ex8-3:2", str(e.exception))
        g2 = {"by": "Samuel", "items": {"g10m8s3-1:Ex8-3:2": {"verdict": "fix", "note": "two options",
              "fields": {"choices": [{"key": "A", "text": "positive"}, {"key": "B", "text": "negative"}],
                         "answer": "B", "typing_problems": []}}}}
        files = ao.lesson_runs(rep["result"], g2)
        fixed = {i["ref"]: i for i in files["g10m8s3-1"]["items"]}["Ex8-3:2"]
        self.assertEqual(fixed["g2"], {"verdict": "fix", "by": "Samuel", "note": "two options"})

    def test_the_books_answer_rules_reach_the_keys(self):
        # backlog 30/31: a form the stem asks for is on the marker whatever the typing said; the
        # raised dot is multiplication; a printed answer not in the asked form is held for G2
        args = copy.deepcopy(self.args)
        args["book"]["multiplication_dot"] = True
        items = {i["ref"]: i for i in args["lessons"][2]["items"]}      # g10m8s3-2
        items["Ex8-4:1"]["asked_form"] = "factorised"                  # a stem rule
        items["Ex8-6:3"].update(asked_form="simplest", printed_form_defect={
            "asked_form": "simplest", "printed": "y = 5x − 1", "note": "fixture: not the asked form"})
        items["Ex8-4:2"].update(raised_dot=True, printed_answer="2 . 3x")
        # a form the app's marker does not know: never in a spec, the item is held (answer-marker.ts)
        next(i for i in args["lessons"][0]["items"] if i["ref"] == "Ex8-2:1")["asked_form"] = "prime_factors"
        r = self.responses()
        for t in r["S3:type:g10m8s3-2:1"]["items"]:
            if t["ref"] == "Ex8-4:2":
                t.update(answer_type="expression", key="2.3^{x}", marker_kind="expression", form="",
                         variables=["x"], book_final="2.3^{x}")
        old, self.args = self.args, args
        try:
            rep, out = self.run_lessons(r)
        finally:
            self.args = old
        typing_prompt = next(c["prompt"] for c in rep["calls"] if c["label"] == "S3:type:g10m8s3-2:1")
        self.assertIn("RAISED DOT", typing_prompt)
        self.assertIn("ASKED FORM: factorised", typing_prompt)
        got = {i["ref"]: i for i in out["g10m8s3-2"]["items"]}
        self.assertEqual(got["Ex8-4:1"]["marker"]["form"], "factorised")
        self.assertEqual(got["Ex8-4:1"]["form_overridden"], {"typing": None, "book_rule": "factorised"})
        self.assertIn("raised dot is multiplication", " ".join(got["Ex8-4:2"]["typing_problems"]))
        self.assertEqual(got["Ex8-6:3"]["verification"], "disputed")
        v = out["g10m8s3-2"]["verify"]
        self.assertEqual([d["ref"] for d in v["printed_not_in_asked_form"]], ["Ex8-6:3"])
        self.assertEqual({d["ref"] for d in v["forms_from_book_rules"]}, {"Ex8-4:1", "Ex8-6:3"})
        pf = {i["ref"]: i for i in out["g10m8s2-1"]["items"]}["Ex8-2:1"]
        self.assertEqual((pf["verification"], pf["form_unsupported"]), ("disputed", "prime_factors"))
        self.assertNotEqual((pf["marker"] or {}).get("form"), "prime_factors", "the app would throw on it")
        self.assertEqual([d["ref"] for d in out["g10m8s2-1"]["verify"]["forms_the_marker_cannot_check"]], ["Ex8-2:1"])

    def test_lesson_args_flag_the_answer_rules_from_the_book_config(self):
        rules = book_config.AnswerRules.model_validate({
            "multiplication_dot": True,
            "forms_from_stem": [{"match": "gradient of", "form": "decimal"}],
            "printed_not_in_asked_form": [{"item": "Ex8-3:1", "asked_form": "simplest", "printed": "3",
                                           "note": "fixture"}]})
        book = self.book.model_copy(update={"answer_rules": rules})
        self.assertEqual(ao.answer_rule_flags(book, "Ex8-4:2", "Write down the gradient of y", "2 . 3x"),
                         {"asked_form": "decimal", "raised_dot": True})
        self.assertEqual(ao.answer_rule_flags(book, "Ex8-3:1", "Find it", "3")["printed_form_defect"]["note"],
                         "fixture")
        self.assertEqual(ao.answer_rule_flags(self.book, "Ex8-3:1", "gradient of", "2 . 3"), {},
                         "a book with no rules gets no flags")

    def test_a_dead_blind_solver_holds_items_it_never_agrees_them(self):
        r = self.responses()
        r["S3:blind:g10m8s3-2:1"] = None
        _, out = self.run_lessons(r)
        ver = {i["ref"]: i["verification"] for i in out["g10m8s3-2"]["items"]}
        self.assertEqual(set(ver.values()), {"disputed"})


if __name__ == "__main__":
    unittest.main()
