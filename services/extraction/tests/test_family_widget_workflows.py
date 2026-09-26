"""runbook/families.workflow.js and runbook/widgets.workflow.js on a stub runtime (B12, B13).

@covers FR-4304, FR-4306

No model is called: tests/workflow_stub.mjs (shared, read-only here) runs each script
with canned agent answers. What is pinned:
- blindness: the solver's and the verifier's prompts carry nothing sealed (keys, worked
  solutions, misconception tags, instance ids, stored specs);
- the scripts never trust a model for identity: ids and shas come from args;
- fail closed: a skipped agent yields "no answer", never an approval;
- the round trip: each script's return value, fed to the Python gate
  (generate_questions.py --grades, generate_widget_questions.py --verdicts), gives the
  decisions the stage promises — including refusing the Prep-3 widget defect that v0.9.3
  corrected (tests/_widget_defect_fixture.py).

    uv run --with pytest python -m pytest -q tests/test_family_widget_workflows.py
"""

from __future__ import annotations

import json
import random
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import _scratchdb  # noqa: F401
import _widget_defect_fixture as wdf
import book_config
import generate_questions as G
import generate_widget_questions as GW
from families import spec as FS

HERE = Path(__file__).resolve().parent
EX = HERE.parent
STUB = HERE / "workflow_stub.mjs"
FAMILIES_WF = EX / "runbook" / "families.workflow.js"
WIDGETS_WF = EX / "runbook" / "widgets.workflow.js"
FIX = HERE / "fixtures" / "families"
SEED = 20260925


def run_workflow(script: Path, args: dict, responses: dict) -> dict:
    with tempfile.TemporaryDirectory() as d:
        f = Path(d, "fixture.json")
        f.write_text(json.dumps({"args": args, "responses": responses}))
        out = subprocess.run(["node", str(STUB), str(script), str(f)], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def g10_book() -> dict:
    return json.loads(book_config.Book.model_validate_json(
        (book_config.BOOKS_DIR / "g10-math.json").read_text()).model_dump_json(exclude={"path"}))


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class FamiliesAuthor(unittest.TestCase):
    def test_specs_come_back_and_a_misfiled_one_is_dropped(self):
        spec_a = json.loads((FIX / "g10-specs" / "g10m4s2-1-1--balance.json").read_text())
        spec_b = json.loads((FIX / "g10-specs" / "g10m14s4-1-1--union.json").read_text())
        objs = [{"lo_id": "lo:g10m4s2-1-1", "label": "Linear equations", "tier_gaps": ["basic"], "lesson": "g10m4s2-1",
                 "module": "module:g10m-c04", "book_questions": [], "misconceptions": []},
                {"lo_id": "lo:g10m1s7-2-1", "label": "Trinomials", "tier_gaps": ["standard"], "lesson": "g10m1s7-2",
                 "module": "module:g10m-c01", "book_questions": [], "misconceptions": []}]
        out = run_workflow(FAMILIES_WF, {"mode": "author", "book": g10_book(), "objectives": objs}, {
            "author:lo:g10m4s2-1-1": {"lo_id": "lo:g10m4s2-1-1", "families": [spec_a], "infeasible": []},
            "author:lo:g10m1s7-2-1": {"lo_id": "lo:g10m1s7-2-1", "families": [spec_b],
                                      "infeasible": [{"tier": "advanced", "reason": "no honest family"}]},
        })
        self.assertTrue(out["ok"], out["error"])
        recs = {r["lo_id"]: r for r in out["result"]["records"]}
        self.assertEqual([f["id"] for f in recs["lo:g10m4s2-1-1"]["families"]], [spec_a["id"]])
        self.assertEqual(recs["lo:g10m1s7-2-1"]["families"], [], "a spec for another objective is dropped")
        self.assertEqual(recs["lo:g10m1s7-2-1"]["infeasible"][0]["tier"], "advanced")
        self.assertEqual({c["model"] for c in out["calls"]}, {"sonnet"})
        # every spec the author returns still has to pass the Python checks
        self.assertEqual(FS.check_spec(recs["lo:g10m4s2-1-1"]["families"][0]), [])

    def test_bad_args_stop_the_run_before_any_agent(self):
        out = run_workflow(FAMILIES_WF, {"book": g10_book()}, {})
        self.assertFalse(out["ok"])
        self.assertIn("args.mode", out["error"])
        self.assertEqual(out["calls"], [])


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class FamiliesRevise(unittest.TestCase):
    """One refused spec re-authored with its reasons (args.revise), through the SHARED revise prompt: no other
    objective reaches the agent, and the reasons are the check's own plus the reviewer's."""

    def test_one_spec_goes_back_with_its_refusal(self):
        good = json.loads((FIX / "g10-specs" / "g10m4s7-1-1--interval.json").read_text())
        broken = dict(good, marker=dict(good["marker"], kind="values", answer="t = {=a} and b = {=b}",
                                        variables=["t", "b"]))
        found = G.spec_problems(broken)
        self.assertEqual(G.spec_problems(good), [])
        self.assertIn("every attempt to instantiate it failed to evaluate: more than one '='", found)
        self.assertIn("the family produced no question", found)
        why = "The stem asks for two separate values; ask for ONE thing."
        book = book_config.Book.model_validate_json((book_config.BOOKS_DIR / "g10-math.json").read_text())
        args = G.revise_args(book, [{"spec": broken, "problems": found + [why]}])
        fixed = dict(good, version=2)
        out = run_workflow(FAMILIES_WF, json.loads(json.dumps(args)),
                           {f"revise:{broken['id']}": {"spec": fixed, "changes": "one thing asked"}})
        self.assertTrue(out["ok"], out["error"])
        self.assertEqual([c["label"] for c in out["calls"]], [f"revise:{broken['id']}"])
        prompt = out["calls"][0]["prompt"]
        for reason in found + [why]:
            self.assertIn(f"- {reason}", prompt)
        self.assertIn('"t = {=a} and b = {=b}"', prompt)
        self.assertEqual(out["result"]["revised"], [fixed])
        self.assertEqual(out["result"]["prompts_version"], "s6-v5")
        # s6-v5: the revise agent works from its message alone
        self.assertIn("Work from this message alone", prompt)
        self.assertNotIn("The one exception", prompt, "no figures, no file to open")
        with_figs = json.loads(json.dumps(args))
        with_figs["revise"][0]["figures"] = ["/abs/work/g10-math/figures/fig1.png"]
        fig_run = run_workflow(FAMILIES_WF, with_figs, {f"revise:{broken['id']}": {"spec": fixed, "changes": "…"}})
        self.assertIn("you may read with the Read tool: /abs/work/g10-math/figures/fig1.png.", fig_run["calls"][0]["prompt"])
        skipped = run_workflow(FAMILIES_WF, json.loads(json.dumps(args)), {f"revise:{broken['id']}": None})
        self.assertEqual(skipped["result"]["revised"], [], "silence revises nothing")

    def test_the_command_line_gives_each_spec_its_own_reasons(self):
        good = json.loads((FIX / "g10-specs" / "g10m4s7-1-1--interval.json").read_text())
        broken = dict(good, marker=dict(good["marker"], kind="values", answer="t = {=a} and b = {=b}",
                                        variables=["t", "b"]))
        judged = json.loads((FIX / "g10-specs" / "g10m4s2-1-1--balance.json").read_text())   # passes --check
        with tempfile.TemporaryDirectory() as d:
            fa, fb, out = Path(d, "_held--a.json"), Path(d, "_held--b.json"), Path(d, "revise.json")
            fa.write_text(json.dumps(broken))
            fb.write_text(json.dumps(judged))
            cli = ["python", "generate_questions.py", "--families", d, "--book", "g10-math", "--revise-args", str(out),
                   "--revise", str(fa), str(fb)]
            run = lambda extra: subprocess.run(["uv", "run", *cli, *extra], capture_output=True, text=True, cwd=EX)  # noqa: E731
            r = run([])
            self.assertEqual(r.returncode, 2)
            self.assertIn("passes --check and no --revise-problem", r.stderr)
            self.assertEqual(run(["--revise-problem", "tpl:nope:x", "why"]).returncode, 2)
            r = run(["--revise-problem", judged["id"], "judge: step 2 names the wrong edge"])
            self.assertEqual(r.returncode, 0, r.stderr)
            got = {e["spec"]["id"]: e["problems"] for e in json.loads(out.read_text())["revise"]}
            self.assertEqual(got[judged["id"]], ["judge: step 2 names the wrong edge"])
            self.assertIn("the family produced no question", got[broken["id"]])
            self.assertNotIn("judge: step 2 names the wrong edge", got[broken["id"]])


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class FamiliesGrade(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.specs, _ = FS.load_dir(FIX / "g10-specs")
        cls.qs, _, _ = G.run_specs(cls.specs, 5, SEED)
        G.rebalance_keys(cls.qs, random.Random(SEED))
        cls.gs = G.grading_set(cls.specs, cls.qs, SEED)
        cls.by_id = {q["id"]: q for q in cls.qs}

    def honest(self, fam):
        answers = []
        for i, inst in enumerate(fam["instances"], 1):
            q = self.by_id[inst["instance_id"]]
            a = {"question": f"Q{i}", "working": "…"}
            if q["question_type"] == "mcq":
                a["choice"] = q["correct_answer"]
            elif q["question_type"] == "short":
                a["plain"] = q["answer_check"]
            else:
                a["value"] = q["correct_answer"]
            answers.append(a)
        return {"answers": answers}

    def responses(self, spoil=(), skip=()):
        r = {}
        for fam in self.gs["families"]:
            fid = fam["family_id"]
            solved = self.honest(fam)
            if fid in spoil:
                solved["answers"][0].update(value="-12345", choice="Z", plain="x")
            r[f"solve:{fid}"] = None if fid in skip else solved
            r[f"judge:{fid}"] = {"distractors_ok": True, "key_form_ok": True, "context_ok": True,
                                 "solution_ok": True, "notes": ""}
        return r

    def test_the_solver_sees_nothing_sealed(self):
        out = run_workflow(FAMILIES_WF, {"mode": "grade", "book": g10_book(), "grading_set": self.gs}, self.responses())
        self.assertTrue(out["ok"], out["error"])
        solves = {c["label"]: c["prompt"] for c in out["calls"] if c["label"].startswith("solve:")}
        judges = {c["label"]: c["prompt"] for c in out["calls"] if c["label"].startswith("judge:")}
        self.assertEqual(len(solves), len(self.gs["families"]))
        for fam in self.gs["families"]:
            prompt = solves[f"solve:{fam['family_id']}"]
            self.assertNotIn("misconception", prompt)
            self.assertNotIn(fam["family_id"], prompt)
            for inst in fam["instances"]:
                self.assertIn(inst["blind"]["stem"], prompt)
                self.assertNotIn(inst["instance_id"], prompt)
                for step in inst["sealed"]["canonical_solution"]:
                    for form in (step["text_md"], json.dumps(step["text_md"])[1:-1]):
                        self.assertNotIn(form, prompt)
                if inst["sealed"].get("answer_check"):
                    self.assertNotIn(inst["sealed"]["answer_check"], prompt)
            first = fam["instances"][0]["sealed"]["canonical_solution"][0]["text_md"]
            self.assertIn(json.dumps(first)[1:-1], judges[f"judge:{fam['family_id']}"],
                          "the judge does see the sealed block")

    def test_the_round_trip_accepts_honest_families_and_rejects_the_rest(self):
        spoil, skip = {"tpl:g10m4s2-1-1:balance", "tpl:g10m14s4-1-1:union"}, {"tpl:g10m1s7-2-1:trinomial"}
        out = run_workflow(FAMILIES_WF, {"mode": "grade", "book": g10_book(), "grading_set": self.gs},
                           self.responses(spoil, skip))
        self.assertTrue(out["ok"], out["error"])
        res = out["result"]["results"]
        for r in res:  # identity from args, never from the model
            fam = next(f for f in self.gs["families"] if f["family_id"] == r["family_id"])
            self.assertEqual(r["spec_sha"], fam["spec_sha"])
            self.assertEqual([a["stem_sha"] for a in r["answers"]], [i["blind"]["stem_sha"] for i in fam["instances"]])
        union = next(r for r in res if r["family_id"] == "tpl:g10m14s4-1-1:union")
        self.assertIsNone(union["answers"][0]["answer"]["choice_text"], "a letter that is no option maps to nothing")
        with tempfile.TemporaryDirectory() as d:
            p = Path(d, "grade.json")
            p.write_text(json.dumps(out["result"]))
            acc, rej = G.apply_grades(self.specs, self.qs, [p])
        self.assertEqual(set(rej), spoil | skip)
        self.assertEqual(set(acc), {s.id for s in self.specs} - spoil - skip)


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class Widgets(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.graph = GW.FixtureGraph(json.loads((FIX / "widget-graph.json").read_text()))
        cls.book = book_config.Book.model_validate_json((book_config.BOOKS_DIR / "g10-math.json").read_text())
        cls.templates, _ = GW.load_templates(FIX / "widget-templates")
        cls.questions, _ = GW.build_from_templates(cls.templates)

    def test_author_one_call_per_lesson_and_an_invented_kind_becomes_a_gap(self):
        args = GW.author_args(self.book, self.graph, "course:us-g10-math-en")
        self.assertEqual(set(args["contract"]), set(GW.W.contract()["kinds"]))
        tpl = json.loads((FIX / "widget-templates" / "g10m8s3-1-2--gradient-line.json").read_text())
        venn = dict(tpl, id="wt:g10m8s3-1-2:venn", kind="zz_unapproved_kind")   # no contract has it
        out = run_workflow(WIDGETS_WF, args, {
            "author:g10m8s3-1": {"templates": [tpl, venn], "gaps": []},
            "author:g10m8s4-1": {"templates": [], "gaps": [{"lo_id": "lo:g10m8s4-1-1", "need_kind": "none",
                                                             "description": "…", "why": "pair_plotter fits later"}]},
            "author:g10m2s2-1": None,
        })
        self.assertTrue(out["ok"], out["error"])
        self.assertEqual(sorted(c["label"] for c in out["calls"]),
                         ["author:g10m2s2-1", "author:g10m8s3-1", "author:g10m8s4-1"])
        res = out["result"]
        kept = [t["id"] for r in res["records"] for t in r["templates"]]
        self.assertEqual(kept, ["wt:g10m8s3-1-2:gradient-line"])
        needs = {g["need_kind"] for g in res["gaps"]}
        self.assertIn("zz_unapproved_kind", needs, "decision 11: an unknown kind is a gap, never a template")
        self.assertIn("unexamined", needs, "a skipped lesson is an unexamined gap, not coverage")

    def test_verify_is_blind_and_the_round_trip_refuses_the_pre_v093_defect(self):
        # The fixture templates with domain-excluded's targets as they were until v0.9.3: the
        # shifts the stem prints, the negatives of the values it excludes.
        templates, questions = wdf.pre_v093_templates()
        args = GW.verify_args(self.book, self.graph, questions)
        by_t: dict[str, list] = {}
        for w in args["widgets"]:
            by_t.setdefault(w["template_id"], []).append(w)
        responses = {}
        qmap = {q["id"]: q for q in questions}
        for tid, ws in by_t.items():
            results = []
            for i, w in enumerate(ws, 1):
                q = qmap[w["question_id"]]
                reading = {k: v for k, v in q["choices"]["spec"].items() if k in GW.READING_FIELDS[w["kind"]]}
                if tid == "wt:t2u2-2-1:domain-excluded":   # what the STEM asks: its zeros
                    reading = {"mode": "points", "targets": sorted(-t for t in q["choices"]["spec"]["targets"])}
                results.append({"widget": f"W{i}", "reading": reading, "construction": "…", "reachable": True,
                                "predicates": [{"predicate": d["predicate"], "matches": True, "why": "…"}
                                               for d in w["diagnostics"]]})
            responses[f"verify:{tid}"] = {"results": results}
        responses["verify:wt:u2-3-1:variation-direct"] = None  # a skipped verifier
        out = run_workflow(WIDGETS_WF, args, responses)
        self.assertTrue(out["ok"], out["error"])
        for c in out["calls"]:
            for q in questions:  # the stored spec, in either serialisation, never reaches a prompt
                spec = q["choices"]["spec"]
                self.assertNotIn(json.dumps(spec), c["prompt"])
                self.assertNotIn(json.dumps(spec, separators=(",", ":")), c["prompt"])
                self.assertNotIn(q["canonical_solution"][-1]["text_md"], c["prompt"])
                self.assertNotIn(q["id"], c["prompt"])
        res = out["result"]["results"]
        self.assertTrue(all(r["template_sha"] == qmap[r["question_id"]]["template_sha"] for r in res))
        with tempfile.TemporaryDirectory() as d:
            p = Path(d, "verify.json")
            p.write_text(json.dumps(out["result"]))
            acc, rej = GW.apply_verdicts(templates, questions, [p])
        self.assertEqual(acc, {"wt:u5-3-1:line-equation", "wt:g10m8s3-1-2:gradient-line"})
        self.assertIn("blind reading disagrees", " ".join(rej["wt:t2u2-2-1:domain-excluded"]))
        self.assertIn("wt:u2-3-1:variation-direct", rej)


if __name__ == "__main__":
    unittest.main()
