"""The step-level working checker (answer 30, backlog 78): working_check.py and runbook/working-check.workflow.js.

    uv run --with pytest python -m pytest -q tests/test_working_check.py

sw-v2 (2026-10-01, the Chapter 8 calibration: sw-v1 metered $0.161 per solution for 23 real flags in 25 and two
false ones). What is proved, no model called:
  * the free numeric pre-check flags what the pilot's G2 found by hand (Ex8-6:45a "9 − 5" written for
    9 − 4; the §8.3 misprint m = (3−7)/(3−3)), and does NOT flag the book's deliberate rounding with "=",
    a mixed number, a stated contradiction ("0 = 10"), "= undefined", or anything with a letter or a unit;
  * the shard shows a multiple-choice question's OPTIONS and what the letter key stands for (sw-v1 omitted
    them and flagged "key D vs shape Z" twice), and offers a figure only when the question text does not
    give its points;
  * the free stub rule flags a numeric-key question whose working never calculates (Ex8-6:24a);
  * the packet: one shard per solution with working (a drawing-only solution is skipped, never sent),
    no shard and no prompt carries the pre-check's result (the agent is blind to it), the args are compact,
    carry batch / effort / model and split into parts past the per-run cap in whole batches;
  * the workflow under the stub runtime: one agent per BATCH, each naming only its own shards, with the tool
    budget and the figure cap in its prompt and the configured model and effort; a dead agent leaves its
    whole batch unchecked, a missing, unknown or doubled answer is named in `problems`; a "consistent"
    verdict that carries a flag is kept as flagged; long strings are cut;
  * the collector merges the agent's flags with the pre-check's (one flag per step, every source named),
    refuses a flag on a step the solution does not have, records the prompts version the RUN used, and never
    edits the content;
  * `calibrate` scores a flags file against the Chapter 8 truth (the 25 sw-v1 flags classified against the
    book's own images): recall of the real defects, the false flags that must not come back.
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


def mcq_bundle() -> dict:
    """The Chapter 8 shape: a letter key, its options (a list, or a dict with `options`), a short-answer marker."""
    return {"questions": [
        {"id": "q:g10m8s1-1-3:ex8-1-5", "lo": "lo:g10m8s1-1-3", "type": "mcq", "answer": "D", "source_page": 287,
         "stem": "You are given the following diagram, with 4 shapes drawn. [figure] Which shape uses the correct naming convention?",
         "choices": [{"key": "A", "text": "shape W"}, {"key": "B", "text": "shape X"}, {"key": "C", "text": "shape Y"},
                     {"key": "D", "text": "shape Z"}],
         "solution": ["We recall the convention. Only shape Z sticks to it. [figure]"]},
        {"id": "q:g10m8s3-2-2:ex8-6-42e", "lo": "lo:g10m8s3-2-2", "type": "mcq", "answer": "A", "source_page": 325,
         "stem": "What type of quadrilateral is $ABCD$ ?",
         "choices": {"options": [{"key": "A", "text": "square"}, {"key": "B", "text": "rectangle"}], "less_specific": ["B"]},
         "solution": ["The diagonals are equal and bisect at right angles: a square."]},
        {"id": "q:g10m8s1-1-2:ex8-1-1", "lo": "lo:g10m8s1-1-2", "type": "short", "answer": "(3, 3)", "source_page": 285,
         "stem": "You are given the following diagram: [figure] Find the coordinates of point $D$ .",
         "choices": {"marker": {"kind": "coordinates", "key": "(3, 3)"}},
         "solution": ["Point $D$ has the coordinates $(3, 3)$ ."]},
    ]}


class Book:
    book = "g10-math"


def sol(**kw) -> dict:
    return {"id": "q:x:1", "lo": "lo:x", "kind": "question", "stem": "Q", "key": "5", "options": [], "type": None,
            "steps": ["a"], "page": 1, "figures": [], **kw}


class Shard(unittest.TestCase):
    def test_a_multiple_choice_shard_shows_its_options_and_what_the_key_stands_for(self):
        sols = {s["id"]: s for s in W.solutions_from_bundle(mcq_bundle())}
        shard = W.render_shard(sols["q:g10m8s1-1-3:ex8-1-5"])
        self.assertIn("OPTIONS (the student picks one; the key below is one of these letters):\n  A. shape W\n  B. shape X", shard)
        self.assertIn("FINAL ANSWER (the key the student is marked against):\nD (shape Z)\n", shard)
        # the dict shape (options + a grading hint) prints only the options
        shard = W.render_shard(sols["q:g10m8s3-2-2:ex8-6-42e"])
        self.assertIn("  A. square\n  B. rectangle", shard)
        self.assertIn("\nA (square)\n", shard)
        self.assertNotIn("less_specific", shard)
        # a short-answer marker is not a list of options
        shard = W.render_shard(sols["q:g10m8s1-1-2:ex8-1-1"])
        self.assertNotIn("OPTIONS", shard)
        self.assertIn("FINAL ANSWER (the key the student is marked against):\n(3, 3)\n", shard)

    def test_a_figure_is_offered_only_when_the_question_text_does_not_give_its_points(self):
        pic = ["/x/figures/a.png"]
        none = sol(stem="You are given the following diagram: [figure] Calculate the length of line $AB$.", figures=pic)
        one = sol(stem="The diagram shows $\\triangle PQR$ with $P(1, -1)$. [figure] Find $m_{QR}$.", figures=pic)
        two = sol(stem="In the diagram, $A$ is the point $(-6, 1)$ and $B$ is the point $(0, 3)$. [figure] Find $AB$.", figures=pic)
        left = sol(stem="Find the distance between $S\\left(-2, -5\\right)$ and $Q\\left(7, -2\\right)$ .", figures=pic)
        texty = sol(stem="Points $A(-\\text{2}, \\text{4})$ and $B(2; y)$ are given. [figure]", figures=pic)
        self.assertEqual([W.points_in(x["stem"]) for x in (none, one, two, left, texty)], [0, 1, 2, 2, 2])
        self.assertEqual(W.figures_offered(none), pic)
        self.assertEqual(W.figures_offered(one), pic)
        for given in (two, left, texty):
            self.assertEqual(W.figures_offered(given), [])
            self.assertIn("FIGURE: not offered", W.render_shard(given))
            self.assertNotIn("a.png", W.render_shard(given))
        shard = W.render_shard(none)
        self.assertIn("FIGURE (the question's points, lengths or labels are shown only in this picture", shard)
        self.assertIn("\n  /x/figures/a.png", shard)
        self.assertNotIn("open it ONLY", shard)
        self.assertNotIn("FIGURE", W.render_shard(sol(stem="no picture")))


class StubRule(unittest.TestCase):
    """Ex8-6:24a: the book's whole solution is 'First draw a sketch: [figure]' and the key is √34."""

    def test_a_working_that_never_calculates_is_flagged_for_free(self):
        f = W.precheck_solution(sol(id="q:g10m8s2-1-1:ex8-6-24a", key="\\sqrt{34}", steps=["First draw a sketch of the quadrilateral: [figure]"]))
        self.assertEqual(len(f), 1)
        self.assertEqual((f[0]["step"], f[0]["kind"], f[0]["source"]), (1, "final_answer", "stub"))
        self.assertIn("never states the key", f[0]["why"])

    def test_what_is_not_a_stub(self):
        for kw in (dict(key="D", steps=["Only shape Z sticks to this convention."]),          # a letter key: reasoned in words
                   dict(key="parallel", steps=["The gradients are equal."]),                  # a word key
                   dict(key="\\sqrt{34}", steps=["$d=\\sqrt{25+9}=\\sqrt{34}$"]),             # it calculates
                   dict(key="34", steps=["The distance is 34 units."]),                       # prose, but it states the key
                   dict(key="5", kind="worked_example", steps=["a sketch"]),                  # no key to reach
                   dict(key=None, steps=["a sketch [figure]"])):
            self.assertEqual(W.precheck_solution(sol(**kw)), [], kw)


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
        self.assertEqual((pre["prompts_version"], pre["batch"], pre["pass_id"]), ("sw-v3", 5, "A"))
        for p in (d / "s").iterdir():
            text = p.read_text()
            self.assertNotIn("does not hold", text)
        shard = (d / "s" / "0002.txt").read_text()
        self.assertIn("FINAL ANSWER (the key the student is marked against):\n5", shard)
        self.assertIn("step 2: $d=\\sqrt{25}=6$", shard)
        self.assertNotIn("solution", json.dumps({k: v for k, v in a.items() if k != "solutions"}))

    def test_the_args_carry_the_run_settings(self):
        a = W.build_args(Book(), bundle(), 8, self.tmp / "a")[0]
        self.assertEqual((a["prompts_version"], a["batch"], a["effort"], a["model"], a["pass_id"], a["order"]),
                         ("sw-v3", 5, "high", "sonnet", "A", "bundle"))
        self.assertEqual((a["fig_dir"], a["figs"]), ("", {}))
        b = W.build_args(Book(), bundle(), 8, self.tmp / "b", batch=2, effort="low", model="haiku", pass_id="B")[0]
        self.assertEqual((b["batch"], b["effort"], b["model"], b["pass_id"]), (2, "low", "haiku", "B"))
        for bad in (dict(batch=0), dict(batch=13), dict(effort="max"), dict(model="opus"), dict(order="random"),
                    dict(pass_id=""), dict(pass_id="a b")):
            with self.assertRaises(SystemExit):
                W.build_args(Book(), bundle(), 8, self.tmp / "c", **bad)

    def test_a_figure_is_named_in_the_args_for_the_solution_that_offers_one(self):
        figs = {"q:g10m8s1-1-3:ex8-1-5": ["/w/figures/tikz__aa.png"], "q:g10m8s1-1-2:ex8-1-1": ["/w/figures/tikz__bb.png", "/elsewhere/c.png"]}
        a = W.build_args(Book(), mcq_bundle(), 8, self.tmp / "f", figures=figs)[0]
        by = {sid: str(i) for i, sid in enumerate(a["solutions"], start=1)}
        self.assertEqual(a["fig_dir"], "/w/figures")
        self.assertEqual(a["figs"][by["q:g10m8s1-1-3:ex8-1-5"]], ["tikz__aa.png"])
        self.assertEqual(a["figs"][by["q:g10m8s1-1-2:ex8-1-1"]], ["tikz__bb.png", "/elsewhere/c.png"])      # a stranger keeps its path
        self.assertEqual(len(a["figs"]), 2)                                                                  # 42e has no figure to offer
        self.assertEqual(W.agents_for(len(a["solutions"]), 2), 2)

    def test_the_second_pass_batches_the_same_solutions_with_other_neighbours(self):
        big = {"questions": [{"id": f"q:g10m8s1-1-1:ex8-1-{i}", "lo": "lo:x", "stem": "Q", "answer": "5",
                              "solution": ["$d=\\sqrt{25}=5$"]} for i in range(1, 25)]}
        a = W.build_args(Book(), big, 8, self.tmp / "p1", batch=4, pass_id="A")[0]
        b = W.build_args(Book(), big, 8, self.tmp / "p2", batch=4, order="shuffled", order_seed=7, pass_id="B")[0]
        c = W.build_args(Book(), big, 8, self.tmp / "p3", batch=4, order="shuffled", order_seed=7, pass_id="B")[0]
        d = W.build_args(Book(), big, 8, self.tmp / "p4", batch=4, order="shuffled", order_seed=8, pass_id="B")[0]
        self.assertEqual(sorted(a["solutions"]), sorted(b["solutions"]))
        self.assertNotEqual(a["solutions"], b["solutions"])
        self.assertEqual(b["solutions"], c["solutions"], "the shuffle is deterministic")
        self.assertNotEqual(b["solutions"], d["solutions"])
        batches = lambda args: {frozenset(args["solutions"][i:i + 4]) for i in range(0, 24, 4)}
        self.assertLess(len(batches(a) & batches(b)), 2, "pass B must not re-form pass A's batches")
        self.assertEqual(b["order"], "shuffled")

    def test_parts_past_the_cap_hold_whole_batches(self):
        parts = W.build_args(Book(), bundle(), 8, self.tmp / "sw-ch08", max_per_run=2, batch=2)
        self.assertEqual([len(p["solutions"]) for p in parts], [2, 1])
        self.assertEqual([p["part"] for p in parts], [1, 2])
        self.assertEqual({p["parts"] for p in parts}, {2})
        self.assertNotEqual(parts[0]["by_ref"]["dir"], parts[1]["by_ref"]["dir"])
        big = W.build_args(Book(), bundle(), 8, self.tmp / "big", max_per_run=3, batch=2)       # 3 is not a whole number of batches: 2
        self.assertEqual([len(p["solutions"]) for p in big], [2, 1])

    def test_only_limits_the_run_to_a_calibration_subset(self):
        a = W.build_args(Book(), bundle(), 8, self.tmp / "o", only={"q:g10m8s2-1-1:ex8-2-2", "expl:g10m8s1-1-1:ex8-6-4a"})[0]
        self.assertEqual(a["solutions"], ["q:g10m8s2-1-1:ex8-2-2"])
        pre = json.loads(W.precheck_path(Path(a["by_ref"]["dir"])).read_text())
        self.assertEqual([s["id"] for s in pre["skipped"]], ["expl:g10m8s1-1-1:ex8-6-4a"])
        with self.assertRaises(SystemExit):
            W.build_args(Book(), bundle(), 8, self.tmp / "o2", only={"q:nope"})
        f = self.tmp / "subset.json"
        f.write_text(json.dumps({"subset": ["q:a", "q:b"]}))
        self.assertEqual(W.load_only(f), {"q:a", "q:b"})
        self.assertIsNone(W.load_only(None))

    def test_the_agent_count_follows_the_batch(self):
        self.assertEqual([W.agents_for(n, 8) for n in (0, 1, 8, 9, 192, 2705)], [0, 1, 1, 2, 24, 339])
        self.assertEqual([W.agents_for(n) for n in (0, 1, 5, 6, 192)], [0, 1, 1, 2, 39])          # the default batch is 5
        self.assertEqual(W.agents_for(192, 5, passes=2), 78)
        self.assertEqual(W.agents_for(192, 1), 192)


def run_stub(args: dict, responses: dict, tmp: Path) -> dict:
    fx = tmp / "stub-sw.json"
    fx.write_text(json.dumps({"args": args, "responses": responses}, ensure_ascii=False))
    p = subprocess.run([NODE, str(STUB), str(WORKFLOW), str(fx)], capture_output=True, text=True, timeout=120)
    if p.returncode != 0:
        raise AssertionError(p.stderr[-2000:])
    return json.loads(p.stdout)


A1, A2, A3 = "q:g10m8s2-1-1:ex8-2-1", "q:g10m8s2-1-1:ex8-2-2", "expl:g10m8s3-1-1:we03"
L1, L2 = f"SW:check:b001:{A1}+1", f"SW:check:b002:{A3}"            # batch 1 = shards 1-2, batch 2 = shard 3


@unittest.skipUnless(NODE, "node is needed to run the workflow through the stub runtime")
class Workflow(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.args = W.build_args(Book(), bundle(), 8, self.tmp / "sw-ch08", batch=2)[0]
        self.fig_args = W.build_args(Book(), mcq_bundle(), 8, self.tmp / "sw-fig", batch=3,
                                     figures={"q:g10m8s1-1-3:ex8-1-5": ["/w/figures/tikz__aa.png"]})[0]
        self.responses = {
            L1: {"results": [
                {"solution_id": A1, "verdict": "consistent"},
                {"solution_id": A2, "verdict": "flagged", "flags": [
                    {"step": 1, "quote": "P(0, 1)", "kind": "wrong_value", "where": "working", "expected": "P(0, 0)",
                     "why": "the question gives P(0, 0)"},
                    {"step": 2, "quote": "\\sqrt{25}=6", "kind": "arithmetic", "expected": "5", "why": "√25 is 5"}]}]},
            L2: {"results": [{"solution_id": A3, "verdict": "consistent", "flags": [
                {"step": 1, "quote": "2-1", "kind": "other", "why": "a flag under a consistent verdict is kept"}]}]},
        }

    def tearDown(self):
        self._tmp.cleanup()

    def test_one_agent_per_batch_reading_only_its_shards_within_a_stated_budget(self):
        rep = run_stub(self.args, self.responses, self.tmp)
        self.assertTrue(rep["ok"], rep["error"])
        self.assertEqual([c["label"] for c in rep["calls"]], [L1, L2])
        d = self.args["by_ref"]["dir"]
        self.assertEqual(rep["calls"][0]["prompt"].count("[[file: /"), 2)
        self.assertEqual(rep["calls"][1]["prompt"].count("[[file: /"), 1)
        for n, i in ((0, 1), (0, 2), (1, 3)):
            self.assertIn(f"[[file: {d}/s/{i:04d}.txt]]", rep["calls"][n]["prompt"])
        self.assertNotIn(f"{d}/s/0003.txt", rep["calls"][0]["prompt"])
        for c in rep["calls"]:
            self.assertEqual((c["model"], c["effort"]), ("sonnet", "high"))
            self.assertNotIn("precheck", c["prompt"])
            self.assertIn("YOUR TOOL BUDGET", c["prompt"])
            self.assertIn("NEVER reconstruct a figure's values from the working itself", c["prompt"])
            self.assertIn("never measure pixels", c["prompt"])
            self.assertIn("TRACE before you answer", c["prompt"])
            self.assertNotIn("ONLY when a value", c["prompt"])
            self.assertIn("never rewrite the solution", c["prompt"])
        r = rep["result"]
        self.assertEqual((r["prompts_version"], r["batch"], r["agents"], r["pass_id"], r["order"]), ("sw-v3", 2, 2, "A", "bundle"))
        self.assertEqual([x["solution_id"] for x in r["results"]], [A1, A2, A3])           # solution order, not answer order
        self.assertEqual([x["verdict"] for x in r["results"]], ["consistent", "flagged", "flagged"])
        self.assertEqual(r["results"][1]["flags"][0]["where"], "working")
        self.assertNotIn("where", r["results"][1]["flags"][1])

    def test_the_model_and_effort_come_from_the_args(self):
        args = W.build_args(Book(), bundle(), 8, self.tmp / "h", batch=3, effort="low", model="haiku")[0]
        label = f"SW:check:b001:{A1}+2"
        rep = run_stub(args, {label: {"results": []}}, self.tmp)
        self.assertEqual([(c["model"], c["effort"]) for c in rep["calls"]], [("haiku", "low")])
        self.assertEqual(len(rep["calls"]), 1)
        self.assertIn("one checking agent each (sw-v3, pass A, haiku, effort low, 0 figure(s) read)", rep["logs"][0])

    def test_a_dead_agent_leaves_its_whole_batch_unchecked(self):
        self.responses[L1] = None
        rep = run_stub(self.args, self.responses, self.tmp)
        self.assertTrue(rep["ok"], rep["error"])
        self.assertEqual([x["verdict"] for x in rep["result"]["results"]], [None, None, "flagged"])
        self.assertTrue(any("2 solution(s) are unchecked" in p for p in rep["result"]["problems"]))
        out = W.collect([self.args], [rep["result"]])
        self.assertEqual([u["id"] for u in out["unchecked"]], [A1, A2])

    def test_a_missing_unknown_or_doubled_answer_is_named(self):
        self.responses[L1] = {"results": [
            {"solution_id": A1, "verdict": "consistent"},
            {"solution_id": A1, "verdict": "flagged", "flags": [{"step": 1, "quote": "x", "kind": "other", "why": "second answer"}]},
            {"solution_id": A3, "verdict": "consistent"}]}                      # A2 missing; A3 is not in this batch
        rep = run_stub(self.args, self.responses, self.tmp)
        res = {x["solution_id"]: x for x in rep["result"]["results"]}
        self.assertEqual(res[A1]["verdict"], "consistent")                      # the first answer is kept
        self.assertIsNone(res[A2]["verdict"])
        pr = " | ".join(rep["result"]["problems"])
        self.assertIn("answered twice", pr)
        self.assertIn(f"{A2}: the checking agent gave no verdict", pr)
        self.assertIn("not in this batch", pr)

    def test_a_consistent_verdict_with_a_flag_is_flagged_a_flagged_one_without_is_unclear_and_long_text_is_cut(self):
        self.responses[L1] = {"results": [
            {"solution_id": A1, "verdict": "flagged"},
            {"solution_id": A2, "verdict": "flagged", "flags": [{"step": 2, "quote": "q" * 900, "kind": "other", "why": "w" * 900,
                                                                 "expected": "e" * 900}], "note": "n" * 900}]}
        rep = run_stub(self.args, self.responses, self.tmp)
        res = {x["solution_id"]: x for x in rep["result"]["results"]}
        self.assertEqual(res[A1]["verdict"], "unclear")
        f = res[A2]["flags"][0]
        self.assertEqual((len(f["quote"]), len(f["why"]), len(f["expected"]), len(res[A2]["note"])), (300, 400, 300, 400))

    def test_a_figure_is_named_in_the_prompt_to_be_read_in_the_first_turn_with_the_shards(self):
        lab = f"SW:check:b001:{self.fig_args['solutions'][0]}+2"
        rep = run_stub(self.fig_args, {lab: {"results": []}}, self.tmp)
        self.assertTrue(rep["ok"], rep["error"])
        prompt = rep["calls"][0]["prompt"]
        i = self.fig_args["solutions"].index("q:g10m8s1-1-3:ex8-1-5") + 1
        self.assertIn(f"Solution {i}: [[file: {self.fig_args['by_ref']['dir']}/s/{self.fig_args['solutions'].index('q:g10m8s1-1-3:ex8-1-5') + 1:04d}.txt]] "
                      "and its FIGURE image: /w/figures/tikz__aa.png", prompt)
        self.assertEqual(prompt.count("and its FIGURE image"), 1, "only the solution that offers a figure names one")
        self.assertIn("reads all 3 files above AND every FIGURE image named above", prompt)
        self.assertIn("1 figure(s) read", rep["logs"][0])

    def test_figs_that_are_not_shard_numbers_with_absolute_paths_are_refused(self):
        for bad in ({"9": ["/x.png"]}, {"1": "x.png"}, {"1": ["rel.png"]}):
            rep = run_stub({**self.fig_args, "fig_dir": "", "figs": bad}, {}, self.tmp)
            self.assertFalse(rep["ok"])
            self.assertIn("args.figs", rep["error"])
        rep = run_stub({k: v for k, v in self.fig_args.items() if k != "figs"}, {}, self.tmp)
        self.assertIn("must carry", rep["error"])

    def test_args_that_are_not_the_builders_are_refused(self):
        for bad, words in (({**self.args, "stage": "S3"}, "working_check.py args"),
                           ({**self.args, "solutions": self.args["solutions"][:2]}, "rebuild the args"),
                           ({**self.args, "prompts_version": "sw-v2"}, "rebuild them"),
                           ({**self.args, "pass_id": "a b"}, "must carry batch"),
                           ({k: v for k, v in self.args.items() if k != "batch"}, "must carry batch"),
                           ({**self.args, "effort": "max"}, "must carry batch"),
                           ({**self.args, "model": "opus"}, "must carry batch")):
            rep = run_stub(bad, self.responses, self.tmp)
            self.assertFalse(rep["ok"])
            self.assertIn(words, rep["error"])
            self.assertEqual(rep["calls"], [])

    def test_collect_merges_every_signal_and_corrects_nothing(self):
        rep = run_stub(self.args, self.responses, self.tmp)
        before = json.dumps(bundle(), sort_keys=True)
        out = W.collect([self.args], [rep["result"]])
        self.assertEqual(json.dumps(bundle(), sort_keys=True), before)
        self.assertEqual(out["format"], "ainext.working-check/1")
        self.assertEqual(out["prompts_version"], "sw-v3")
        self.assertEqual((out["passes"], out["single_pass_ids"]), (["A"], []))
        self.assertEqual(out["solutions"], 3)
        self.assertEqual(out["checked_ids"], sorted([A1, A2, A3]))
        self.assertEqual(out["verdicts"], {"consistent": 1, "flagged": 2, "unclear": 0})
        by = {(f["solution_id"], f["step"]): f for f in out["flags"]}
        self.assertEqual(by[(A2, 2)]["sources"], ["agent", "numeric"])                      # both signals, one flag
        self.assertEqual(by[(A2, 1)]["sources"], ["agent"])
        self.assertEqual((by[(A2, 1)]["where"], by[(A2, 2)]["where"]), ("working", "working"))
        self.assertEqual(out["flagged_solutions"], 2)
        self.assertEqual([s["id"] for s in out["skipped"]], ["expl:g10m8s1-1-1:ex8-6-4a"])
        self.assertEqual(out["unchecked"], [])

    def test_collect_names_the_prompts_version_the_run_used_and_a_stub_only_flag_stands_alone(self):
        rep = run_stub(self.args, self.responses, self.tmp)
        old = dict(rep["result"], prompts_version="sw-v1")
        self.assertEqual(W.collect([self.args], [old])["prompts_version"], "sw-v1")
        a = W.build_args(Book(), {"questions": [{"id": "q:s", "lo": "lo:s", "stem": "Find $QR$.", "answer": "\\sqrt{34}",
                                                  "solution": ["First draw a sketch: [figure]"]}]}, 8, self.tmp / "stub")[0]
        out = W.collect([a], [{"stage": "SW", "results": [{"solution_id": "q:s", "verdict": "consistent", "flags": []}]}])
        self.assertEqual([(f["sources"], f["kind"], f["step"]) for f in out["flags"]], [(["stub"], "final_answer", 1)])
        self.assertEqual(out["verdicts"]["consistent"], 1)         # the agent said consistent; the free rule still flags

    def test_two_passes_are_unioned_and_a_flag_both_raised_says_so(self):
        """The whole-book configuration: two independent blind passes, flags unioned (like S0b's two readings)."""
        argsB = W.build_args(Book(), bundle(), 8, self.tmp / "sw-B", batch=3, order="shuffled", order_seed=3, pass_id="B")[0]
        runA = dict(run_stub(self.args, self.responses, self.tmp)["result"], pass_id="A")
        labB = f"SW:check:b001:{argsB['solutions'][0]}+2"
        respB = {labB: {"results": [
            {"solution_id": A1, "verdict": "flagged", "flags": [{"step": 1, "quote": "x", "kind": "arithmetic", "why": "pass B only"}]},
            {"solution_id": A2, "verdict": "flagged", "flags": [{"step": 2, "quote": "q", "kind": "other", "why": "also here"}]},
            {"solution_id": A3, "verdict": "unclear", "note": "needs an earlier part"}]}}
        runB = run_stub(argsB, respB, self.tmp)["result"]
        self.assertEqual((runB["pass_id"], runB["order"]), ("B", "shuffled"))
        out = W.collect([self.args, argsB], [runA, runB])
        self.assertEqual(out["passes"], ["A", "B"])
        self.assertEqual(out["single_pass_ids"], [])
        by = {(f["solution_id"], f["step"]): f for f in out["flags"]}
        self.assertEqual(by[(A2, 2)]["passes"], ["A", "B"])                  # both raised it: the strongest kind of flag
        self.assertEqual(by[(A2, 2)]["also_kinds"], ["other"])               # B called it "other", A "arithmetic"
        self.assertEqual(by[(A2, 1)]["passes"], ["A"])
        self.assertEqual(by[(A1, 1)]["passes"], ["B"])                       # a flag only one pass raised is kept
        self.assertEqual(by[(A3, 1)]["passes"], ["A"])
        self.assertEqual(out["verdicts"], {"consistent": 0, "flagged": 3, "unclear": 0})   # A3: A flagged, B unclear → flagged
        self.assertEqual(sorted(out["checked_ids"]), sorted([A1, A2, A3]))
        # a pass that never answered a solution leaves it single-pass, still checked
        runB2 = dict(runB, results=[x for x in runB["results"] if x["solution_id"] != A1])
        self.assertEqual(W.collect([self.args, argsB], [runA, runB2])["single_pass_ids"], [A1])
        # the pre-check's flag is merged once, however many passes' args name it
        pre = [f for f in out["flags"] if "numeric" in f["sources"]]
        self.assertEqual([(f["solution_id"], f["step"]) for f in pre], [(A2, 2)])

    def test_the_parts_of_one_pass_are_not_two_passes(self):
        a1, a2 = W.build_args(Book(), bundle(), 8, self.tmp / "sw-parts", max_per_run=2, batch=2)
        r1 = {"stage": "SW", "results": [{"solution_id": s, "verdict": "consistent"} for s in a1["solutions"]]}
        r2 = {"stage": "SW", "results": [{"solution_id": s, "verdict": "consistent"} for s in a2["solutions"]]}
        out = W.collect([a1, a2], [r1, r2])
        self.assertEqual((out["passes"], out["single_pass_ids"], out["solutions"]), (["A"], [], 3))

    def test_collect_refuses_a_step_the_solution_does_not_have(self):
        self.responses[L1] = {"results": [{"solution_id": A1, "verdict": "flagged", "flags": [
            {"step": 9, "quote": "x", "kind": "other", "why": "no such step"}]}, {"solution_id": A2, "verdict": "consistent"}]}
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


TRUTH_FILE = EX / "runs" / "g10-math" / "working-check" / "ch08.calibration.json"
SW_V1_FLAGS = EX / "runs" / "g10-math" / "working-check" / "ch08.flags.json"


class Calibrate(unittest.TestCase):
    def truth(self) -> dict:
        lab = lambda sid, step, v: {"solution_id": sid, "step": step, "verdict": v, "evidence": "e"}
        return {"labels": [lab("r1", 2, "REAL"), lab("r2", 1, "REAL"), lab("e1", 1, "REAL-BUT-ELSEWHERE"), lab("f1", 1, "FALSE")],
                "unclear": [{"solution_id": "u1", "verdict": "REAL-BUT-ELSEWHERE", "evidence": "e"}],
                "controls": {"ids": ["c1", "c2"]}}

    def rep(self, flags, unclear=(), checked=None) -> dict:
        return {"prompts_version": "sw-v2", "flags": [{"solution_id": s, "step": st, "kind": "other", "why": "w", "sources": ["agent"]}
                                                      for s, st in flags],
                "unclear": [{"id": u, "why": ""} for u in unclear], **({"checked_ids": checked} if checked else {})}

    def test_every_real_defect_caught_and_no_false_flag_back(self):
        out = W.calibrate(self.truth(), self.rep([("r1", 2), ("r2", 3), ("e1", 1)], unclear=["u1"]))
        sm = out["summary"]
        self.assertEqual((sm["real_solutions_caught"], sm["real_recall_solution"], sm["real_flags_at_the_step"]), (2, 1.0, 1))
        self.assertEqual((sm["elsewhere_caught"], sm["false_flags_repeated"], sm["missed_real"]), ("1/1", 0, []))
        self.assertEqual(sm["unclear_kept_unclear_or_flagged"], 1)

    def test_a_missed_defect_a_returning_false_flag_and_a_flagged_control_are_reported(self):
        out = W.calibrate(self.truth(), self.rep([("r1", 2), ("f1", 1), ("c2", 4)]))
        sm = out["summary"]
        self.assertEqual((sm["real_solutions_caught"], sm["real_recall_solution"], sm["missed_real"]), (1, 0.5, ["r2"]))
        self.assertEqual(sm["false_flags_repeated"], 1)
        self.assertEqual([c["solution_id"] for c in out["controls_new_flags"]], ["c2"])

    def test_a_subset_run_is_scored_only_on_what_it_ran(self):
        out = W.calibrate(self.truth(), self.rep([("r1", 2)], checked=["r1", "c1"]))
        self.assertEqual(out["summary"]["real_solutions"], 1)
        self.assertEqual(sorted(out["not_run"]), ["e1", "f1", "r2"])

    def test_the_agents_recall_is_reported_apart_from_the_free_checks_and_per_pass(self):
        flags = [{"solution_id": "r1", "step": 2, "kind": "other", "why": "w", "sources": ["agent"], "passes": ["A", "B"]},
                 {"solution_id": "r2", "step": 1, "kind": "final_answer", "why": "w", "sources": ["stub"], "passes": []},
                 {"solution_id": "e1", "step": 1, "kind": "label", "why": "w", "sources": ["agent"], "passes": ["B"]}]
        out = W.calibrate(self.truth(), {"prompts_version": "sw-v3", "flags": flags, "unclear": []})
        sm = out["summary"]
        self.assertEqual((sm["real_recall_solution"], sm["real_recall_agents_only"]), (1.0, 0.5))
        self.assertEqual(sm["missed_real_by_agents"], ["r2"])
        self.assertEqual(sm["real_recall_by_pass"], {"A": 1, "B": 1})

    def test_a_multi_part_defect_counts_as_found_when_an_agent_says_unclear(self):
        out = W.calibrate(self.truth(), self.rep([("r1", 2), ("r2", 1)], unclear=["e1"]))
        self.assertEqual(out["summary"]["elsewhere_caught"], "0/1")
        self.assertEqual(out["summary"]["elsewhere_solutions_flagged_or_unclear"], "1/1")

    def test_injected_defects_are_scored_by_operator_on_the_agents_flags_alone(self):
        mut = {"mutants": [{"id": "m1", "base": "b1", "operator": "label", "kind": "label", "step": 2},
                           {"id": "m2", "base": "b2", "operator": "label", "kind": "label", "step": 1},
                           {"id": "m3", "base": "b3", "operator": "sign", "kind": "sign", "step": 1},
                           {"id": "m4", "base": "b4", "operator": "stem_label", "kind": "label", "step": None}]}
        flags = [{"solution_id": "m1", "step": 2, "kind": "label", "why": "w", "sources": ["agent"], "passes": ["A"]},
                 {"solution_id": "m2", "step": 1, "kind": "arithmetic", "why": "w", "sources": ["numeric"], "passes": []},   # a free flag is not recall
                 {"solution_id": "m4", "step": 3, "kind": "label", "why": "w", "sources": ["agent"], "passes": ["B"]}]
        mu = W.calibrate(self.truth(), self.rep([]) | {"flags": flags}, mut)["summary"]["mutants"]
        self.assertEqual((mu["total"], mu["caught_by_agents"], mu["recall"]), (4, 2, 0.5))
        self.assertEqual(mu["by_operator"], {"label": "1/2", "sign": "0/1", "stem_label": "1/1"})
        self.assertEqual((mu["by_pass"], mu["missed"]), ({"A": 1, "B": 1}, ["m2", "m3"]))

    @unittest.skipUnless(TRUTH_FILE.exists() and SW_V1_FLAGS.exists(), "the Chapter 8 calibration files")
    def test_the_chapter_8_truth_is_exactly_the_sw_v1_flags_classified(self):
        truth = json.loads(TRUTH_FILE.read_text())
        v1 = json.loads(SW_V1_FLAGS.read_text())
        self.assertEqual(sorted((l["solution_id"], l["step"]) for l in truth["labels"]),
                         sorted((f["solution_id"], f["step"]) for f in v1["flags"]))
        self.assertEqual(sorted(u["solution_id"] for u in truth["unclear"]), sorted(u["id"] for u in v1["unclear"]))
        c = truth["counts"]
        self.assertEqual((c["flags"], c["REAL"], c["REAL-BUT-ELSEWHERE"], c["FALSE"]), (25, 18, 5, 2))
        self.assertEqual(c["REAL"] + c["REAL-BUT-ELSEWHERE"] + c["FALSE"], len(truth["labels"]))
        self.assertEqual({l["verdict"] for l in truth["labels"]}, {"REAL", "REAL-BUT-ELSEWHERE", "FALSE"})
        self.assertTrue(all(l["evidence"] for l in truth["labels"]))
        ids = set(truth["subset"])
        self.assertTrue({l["solution_id"] for l in truth["labels"]} | set(truth["controls"]["ids"]) <= ids)
        self.assertEqual(len(ids), 51)
        # sw-v1 itself, scored against its own classification: it caught everything and repeated both false flags
        sm = W.calibrate(truth, v1)["summary"]
        self.assertEqual((sm["real_recall_solution"], sm["false_flags_repeated"]), (1.0, 2))

    @unittest.skipUnless(TRUTH_FILE.exists(), "the Chapter 8 calibration file")
    def test_the_free_checks_alone_already_catch_four_real_chapter_8_defects(self):
        """The pre-check (3 numeric typos) and the stub rule (24a) need no model: sw-v2's floor."""
        seed = EX / "work" / "g10-math" / "pilot" / "seed" / "g10m-c08.json"
        if not seed.exists():
            self.skipTest("the pilot seed (work/g10-math/, gitignored)")
        flags = [f for s in W.solutions_from_bundle(json.loads(seed.read_text())) for f in W.precheck_solution(s)]
        truth = json.loads(TRUTH_FILE.read_text())
        real = {l["solution_id"] for l in truth["labels"] if l["verdict"] == "REAL"}
        self.assertEqual(sorted({f["solution_id"] for f in flags}),
                         sorted(["q:g10m8s2-1-1:ex8-6-24a", "q:g10m8s2-1-1:ex8-6-42a", "expl:g10m8s3-2-2:ex8-6-38d",
                                 "expl:g10m8s3-2-3:ex8-6-42d"]))
        self.assertTrue({f["solution_id"] for f in flags} <= real, "a free flag on a solution the classification calls not-a-defect")


if __name__ == "__main__":
    unittest.main()
