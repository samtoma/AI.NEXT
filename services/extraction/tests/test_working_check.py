"""The step-level working checker (answer 30, backlog 78): working_check.py and runbook/working-check.workflow.js.

    uv run --with pytest python -m pytest -q tests/test_working_check.py

What is proved, no model called:
  * the free numeric pre-check flags what the pilot's G2 found by hand (Ex8-6:45a "9 − 5" written for
    9 − 4; the §8.3 misprint m = (3−7)/(3−3)), and does NOT flag the book's deliberate rounding with "=",
    a mixed number, a stated contradiction ("0 = 10"), "= undefined", or anything with a letter or a unit;
  * the packet: one shard per solution with working (a drawing-only solution is skipped, never sent),
    no shard and no prompt carries the pre-check's result (the agent is blind to it), the args are compact
    and split into parts past the per-run cap;
  * the workflow under the stub runtime: one agent per solution, each naming only its own shard; a dead
    agent leaves that solution unchecked; a "consistent" verdict that carries a flag is kept as flagged;
  * the collector merges the agent's flags with the pre-check's (one flag per step, both sources named),
    refuses a flag on a step the solution does not have, and never edits the content.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
EX = HERE.parent
for p in (str(EX), str(HERE)):
    if p not in sys.path:
        sys.path.insert(0, p)

import working_check as W  # noqa: E402

NODE = shutil.which("node")
STUB = HERE / "workflow_stub.mjs"
WORKFLOW = EX / "runbook" / "working-check.workflow.js"


def flags_of(line: str) -> list[dict]:
    return W.check_line(line)


class PreCheck(unittest.TestCase):
    def test_flags_the_pilots_typos(self):
        # Ex8-6:45a as the book printed it: "9 − 5" where the working needs 9 − 4 (G2, decision 45)
        self.assertTrue(flags_of(r"\sqrt{9-5}=\sqrt{5}"))
        self.assertTrue(flags_of(r"x=\frac{9-5}{2}=\frac{5}{2}"))
        # §8.3 worked example 8: m_AC = (3−7)/(3−3) = −4/−6 — an undefined side set equal to a number
        f = flags_of(r"m_{AC}=\frac{3-7}{3-3}=\frac{-4}{-6}=\frac{2}{3}")
        self.assertEqual(len(f), 1)
        self.assertIn("undefined", f[0]["why"])

    def test_does_not_flag_what_the_book_does_on_purpose(self):
        for ok in (r"\sqrt{90}=9.5",                      # rounding with "=", to the places shown
                   r"\sqrt{90}\approx 9.49",
                   r"\frac{13}{3}=4\frac{1}{3}",           # a mixed number is a sum
                   r"0=10",                                # a contradiction the working states
                   r"\frac{-4}{0}=\text{undefined}",       # "= undefined" is the book's point
                   r"\frac{-2-2}{3-3}=\frac{-4}{0}",       # undefined = undefined
                   r"x=\frac{-2+2}{2}=0",
                   r"d=\sqrt{(\text{-2}-\text{7})^{2}+(\text{-5}-(\text{-2}))^{2}}=\sqrt{81+9}=\sqrt{90}",
                   r"A=\pi r^{2}=\pi(3)^{2}",              # letters: skipped, never guessed
                   r"12\text{ cm}=0.12\text{ m}",          # units: skipped
                   r"(2, 3)=(2, 3)",                       # a pair: skipped
                   r"\text{12 566}=12566",                 # Siyavula's thousands space
                   r"3\sqrt{2}\times\sqrt{2}=6",
                   r"2^{3}\cdot 2^{-1}=4",
                   r"50\%=0.5",
                   r"\sin 30^{\circ}=0.5",
                   r"\tan 45^{\circ}=1"):
            self.assertEqual(flags_of(ok), [], ok)

    def test_inequalities_and_not_equal(self):
        self.assertEqual(flags_of(r"\frac{1}{2}<\frac{2}{3}"), [])
        self.assertTrue(flags_of(r"\frac{2}{3}<\frac{1}{2}"))
        self.assertTrue(flags_of(r"2+2\neq 4"))

    def test_aligned_lines_continue_their_chain(self):
        step = r"Substitute: $\begin{aligned}d&=\sqrt{(1-4)^{2}+(2-6)^{2}}\\&=\sqrt{9+16}\\&=\sqrt{24}\end{aligned}$"
        lines = W.maths_lines(step)
        self.assertEqual(len(lines), 1)
        f = W.check_line(lines[0])
        self.assertEqual(len(f), 1)
        self.assertEqual((f[0]["left"], f[0]["right"]), (r"\sqrt{9+16}", r"\sqrt{24}"))

    def test_separated_statements_are_separate_chains(self):
        self.assertEqual(flags_of(r"x_{1}=-2 \quad y_{1}=-5 \quad x_{2}=7"), [])
        self.assertEqual(flags_of(r"a=2, b=3"), [])


# ---------------------------------------------------------------------------- a tiny chapter bundle
def bundle() -> dict:
    return {
        "questions": [
            {"id": "q:g10m8s2-1-1:ex8-2-1", "lo": "lo:g10m8s2-1-1", "stem": "Find the distance between $A(1, 2)$ and $B(4, 6)$.",
             "answer": "5", "source_page": 290,
             "solution": ["Substitute: $\\begin{aligned}d&=\\sqrt{(4-1)^{2}+(6-2)^{2}}\\\\&=\\sqrt{9+16}\\\\&=5\\end{aligned}$"]},
            {"id": "q:g10m8s2-1-1:ex8-2-2", "lo": "lo:g10m8s2-1-1", "stem": "Find the distance between $P(0, 0)$ and $Q(3, 4)$.",
             "answer": "5", "source_page": 290,
             "solution": ["Substitute $P(0, 1)$: $d=\\sqrt{9+16}$", "$d=\\sqrt{25}=6$"]},
        ],
        "explanation_entries": [
            {"id": "expl:g10m8s1-1-1:ex8-6-4a", "lo": "lo:g10m8s1-1-1", "entry_type": "worked_example", "source_page": 316,
             "content": [{"kind": "problem", "text_md": "Represent triangle $DEF$."}, {"step": 1, "text_md": "[figure]"}]},
            {"id": "expl:g10m8s3-1-1:we03", "lo": "lo:g10m8s3-1-1", "entry_type": "worked_example", "source_page": 293,
             "content": [{"kind": "problem", "text_md": "Find the gradient of $AB$."},
                         {"step": 1, "text_md": "$m=\\frac{3-1}{2-1}=2$"}]},
        ],
    }


class Book:
    book = "g10-math"


class Packet(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_one_shard_per_solution_with_working_and_the_agent_is_blind_to_the_precheck(self):
        parts = W.build_args(Book(), bundle(), 8, self.tmp / "sw-ch08")
        self.assertEqual(len(parts), 1)
        a = parts[0]
        self.assertEqual(a["solutions"], ["q:g10m8s2-1-1:ex8-2-1", "q:g10m8s2-1-1:ex8-2-2", "expl:g10m8s3-1-1:we03"])
        d = Path(a["by_ref"]["dir"])
        self.assertEqual(sorted(p.name for p in (d / "s").iterdir()), ["0001.txt", "0002.txt", "0003.txt"])
        pre = json.loads(W.precheck_path(d).read_text())
        self.assertFalse(W.precheck_path(d).is_relative_to(d), "the pre-check must sit outside the shard directory")
        self.assertEqual([s["id"] for s in pre["skipped"]], ["expl:g10m8s1-1-1:ex8-6-4a"])
        self.assertEqual([(f["solution_id"], f["step"]) for f in pre["flags"]], [("q:g10m8s2-1-1:ex8-2-2", 2)])
        for p in (d / "s").iterdir():
            text = p.read_text()
            self.assertNotIn("does not hold", text)
        shard = (d / "s" / "0002.txt").read_text()
        self.assertIn("FINAL ANSWER (the key the student is marked against):\n5", shard)
        self.assertIn("step 2: $d=\\sqrt{25}=6$", shard)
        self.assertNotIn("solution", json.dumps({k: v for k, v in a.items() if k != "solutions"}))

    def test_parts_past_the_cap(self):
        parts = W.build_args(Book(), bundle(), 8, self.tmp / "sw-ch08", max_per_run=2)
        self.assertEqual([len(p["solutions"]) for p in parts], [2, 1])
        self.assertEqual([p["part"] for p in parts], [1, 2])
        self.assertEqual({p["parts"] for p in parts}, {2})
        self.assertNotEqual(parts[0]["by_ref"]["dir"], parts[1]["by_ref"]["dir"])


def run_stub(args: dict, responses: dict, tmp: Path) -> dict:
    fx = tmp / "stub-sw.json"
    fx.write_text(json.dumps({"args": args, "responses": responses}, ensure_ascii=False))
    p = subprocess.run([NODE, str(STUB), str(WORKFLOW), str(fx)], capture_output=True, text=True, timeout=120)
    if p.returncode != 0:
        raise AssertionError(p.stderr[-2000:])
    return json.loads(p.stdout)


@unittest.skipUnless(NODE, "node is needed to run the workflow through the stub runtime")
class Workflow(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.args = W.build_args(Book(), bundle(), 8, self.tmp / "sw-ch08")[0]
        self.responses = {
            "SW:check:q:g10m8s2-1-1:ex8-2-1": {"verdict": "consistent", "flags": []},
            "SW:check:q:g10m8s2-1-1:ex8-2-2": {"verdict": "flagged", "flags": [
                {"step": 1, "quote": "P(0, 1)", "kind": "wrong_value", "expected": "P(0, 0)", "why": "the question gives P(0, 0)"},
                {"step": 2, "quote": "\\sqrt{25}=6", "kind": "arithmetic", "expected": "5", "why": "√25 is 5"}]},
            "SW:check:expl:g10m8s3-1-1:we03": {"verdict": "consistent", "flags": [
                {"step": 1, "quote": "2-1", "kind": "other", "why": "a flag under a consistent verdict is kept"}]},
        }

    def tearDown(self):
        self._tmp.cleanup()

    def test_one_agent_per_solution_reading_only_its_shard(self):
        rep = run_stub(self.args, self.responses, self.tmp)
        self.assertTrue(rep["ok"], rep["error"])
        self.assertEqual(len(rep["calls"]), 3)
        d = self.args["by_ref"]["dir"]
        for i, c in enumerate(rep["calls"], start=1):
            self.assertIn(f"[[file: {d}/s/{i:04d}.txt]]", c["prompt"])
            self.assertEqual(c["prompt"].count("[[file: /"), 1)
            self.assertEqual(c["model"], "sonnet")
            self.assertNotIn("precheck", c["prompt"])
        r = rep["result"]
        self.assertEqual(r["prompts_version"], "sw-v1")
        self.assertEqual([x["verdict"] for x in r["results"]], ["consistent", "flagged", "flagged"])

    def test_a_dead_agent_leaves_its_solution_unchecked(self):
        self.responses["SW:check:q:g10m8s2-1-1:ex8-2-1"] = None
        rep = run_stub(self.args, self.responses, self.tmp)
        self.assertTrue(rep["ok"], rep["error"])
        self.assertIsNone(rep["result"]["results"][0]["verdict"])
        self.assertTrue(rep["result"]["problems"])

    def test_args_that_are_not_the_builders_are_refused(self):
        for bad, words in (({**self.args, "stage": "S3"}, "working_check.py args"),
                           ({**self.args, "solutions": self.args["solutions"][:2]}, "rebuild the args"),
                           ({**self.args, "prompts_version": "sw-v0"}, "rebuild them")):
            rep = run_stub(bad, self.responses, self.tmp)
            self.assertFalse(rep["ok"])
            self.assertIn(words, rep["error"])
            self.assertEqual(rep["calls"], [])

    def test_collect_merges_both_signals_and_corrects_nothing(self):
        rep = run_stub(self.args, self.responses, self.tmp)
        before = json.dumps(bundle(), sort_keys=True)
        out = W.collect([self.args], [rep["result"]])
        self.assertEqual(json.dumps(bundle(), sort_keys=True), before)
        self.assertEqual(out["format"], "ainext.working-check/1")
        self.assertEqual(out["solutions"], 3)
        self.assertEqual(out["verdicts"], {"consistent": 1, "flagged": 2, "unclear": 0})
        by = {(f["solution_id"], f["step"]): f for f in out["flags"]}
        self.assertEqual(by[("q:g10m8s2-1-1:ex8-2-2", 2)]["sources"], ["agent", "numeric"])   # both signals, one flag
        self.assertEqual(by[("q:g10m8s2-1-1:ex8-2-2", 1)]["sources"], ["agent"])
        self.assertEqual(out["flagged_solutions"], 2)
        self.assertEqual([s["id"] for s in out["skipped"]], ["expl:g10m8s1-1-1:ex8-6-4a"])
        self.assertEqual(out["unchecked"], [])

    def test_collect_refuses_a_step_the_solution_does_not_have(self):
        self.responses["SW:check:q:g10m8s2-1-1:ex8-2-1"] = {"verdict": "flagged", "flags": [
            {"step": 9, "quote": "x", "kind": "other", "why": "no such step"}]}
        rep = run_stub(self.args, self.responses, self.tmp)
        out = W.collect([self.args], [rep["result"]])
        self.assertTrue(any("step 9" in p for p in out["problems"]))

    def test_the_generated_copy_runs_with_no_args(self):
        import embed_workflow
        copy = self.tmp / "sw.workflow.js"
        embed_workflow.write(WORKFLOW, self.args, copy)
        self.assertEqual(embed_workflow.verify(copy), [])
        fx = self.tmp / "stub-copy.json"
        fx.write_text(json.dumps({"args": {}, "responses": self.responses}))
        p = subprocess.run([NODE, str(STUB), str(copy), str(fx)], capture_output=True, text=True, timeout=120)
        rep = json.loads(p.stdout)
        self.assertTrue(rep["ok"], rep["error"])
        self.assertEqual(rep["result"]["embedded"]["source"], "runbook/working-check.workflow.js")


if __name__ == "__main__":
    unittest.main()
