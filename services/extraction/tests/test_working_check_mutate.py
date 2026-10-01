"""The unbiased calibration set for the working checker: working_check_mutate.py.

    uv run --with pytest python -m pytest -q tests/test_working_check_mutate.py

What is proved, no model called:
  * each operator (wrong_value, label, sign, final_answer, stem_label) injects exactly ONE defect, in the place
    its truth says, and refuses a solution it cannot honestly corrupt;
  * an operator never changes what the FREE pre-check sees (a mutant it caught would measure the evaluator,
    not the agents);
  * the set is deterministic, never mutates the bundle it reads, builds mutants only from solutions OUTSIDE the
    calibration subset (so a mutant never shares a run with its own original), gives them organic ids, and
    keeps the subset's originals so one run also measures false flags and recall on the real defects;
  * a mutant offers its base's figures to the packet builder;
  * on the real Chapter 8 bundle the committed truth file is exactly what the tool regenerates.
"""

from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
EX = HERE.parent
for p in (str(EX), str(HERE)):
    if p not in sys.path:
        sys.path.insert(0, p)

import working_check as W  # noqa: E402
import working_check_mutate as M  # noqa: E402


def dist_q() -> dict:
    return {"id": "q:g10m8s2-1-1:ex8-2-1", "lo": "lo:g10m8s2-1-1", "stem": "Find the distance between $A(1, 6)$ and $B(4, 2)$.",
            "answer": "5", "solution": ["Substitute: $d=\\sqrt{(4-1)^{2}+(2-6)^{2}}$", "Therefore the distance is $5$ units."]}


def label_q() -> dict:
    return {"id": "q:g10m8s3-2-2:ex8-4-9", "lo": "lo:g10m8s3-2-2", "stem": "Given $A(1, 2)$, $B(3, 8)$ and $C(5, 1)$. Find the gradient of $AB$.",
            "answer": "3", "solution": ["$m_{AB}=\\frac{8-2}{3-1}$", "Therefore $m_{AB}=3$ ."]}


def sign_q() -> dict:
    return {"id": "q:g10m8s3-2-2:ex8-4-10", "lo": "lo:g10m8s3-2-2", "stem": "Line $AB$ has gradient $-1.5$ and passes through $A(-2, 4)$.",
            "answer": "y=-1.5x+1",
            "solution": ["$\\begin{aligned}y&=mx+c\\\\(4)&=(-1.5)(-2)+c\\\\c&=1\\end{aligned}$", "So $y=-1.5x+1$ ."]}


def key_q() -> dict:
    return {"id": "q:g10m8s3-2-2:ex8-4-19b", "lo": "lo:g10m8s3-2-2", "stem": "Find the area.", "answer": "42.5",
            "solution": ["$A=\\frac{1}{2}(85)$", "$A=\\text{42.5}$"]}


def stem_q() -> dict:
    return {"id": "q:g10m8s3-1-1:we04", "lo": "lo:g10m8s3-1-1", "stem": "Given $P(0, 1)$ and $Q(3, 5)$, find $m_{PQ}$.",
            "answer": "4/3", "solution": ["$P$ is $(0, 1)$ and $Q$ is $(3, 5)$.", "$m_{PQ}=\\frac{5-1}{3-0}=\\frac{4}{3}$ . So $PQ$ has gradient $\\frac{4}{3}$"]}


def entry() -> dict:
    return {"id": "expl:g10m8s4-1-1:we10", "lo": "lo:g10m8s4-1-1", "entry_type": "worked_example",
            "content": [{"kind": "problem", "text_md": "Find the midpoint of $E(2, 9)$ and $G(4, 3)$."},
                        {"step": 1, "text_md": "$x=\\frac{2+4}{2}=3$ and the 9 is the first y."},
                        {"step": 2, "text_md": "$y=\\frac{9+3}{2}=6$ ."}]}


class Operators(unittest.TestCase):
    def test_wrong_value_changes_one_coordinate_of_the_question_the_working_still_uses(self):
        it = dist_q()
        new, truth = M.apply(it, "wrong_value")
        self.assertEqual(new["stem"], "Find the distance between $A(1, 7)$ and $B(4, 2)$.")
        self.assertEqual(new["solution"], it["solution"])
        self.assertEqual((truth["kind"], truth["step"], truth["where"], truth["operator"]), ("wrong_value", 1, "question", "wrong_value"))
        self.assertIn("A(1, 6) → A(1, 7)", truth["detail"])

    def test_wrong_value_refuses_what_it_cannot_corrupt_honestly(self):
        small = dict(dist_q(), stem="Between $A(1, 2)$ and $B(2, 1)$.")                       # every number is below 3
        unused = dict(dist_q(), solution=["$d=\\sqrt{25}$", "$5$"])                             # the working never uses 6 or 4
        clash = dict(dist_q(), stem="Between $A(1, 6)$ and $B(4, 7)$.", solution=["$(2-6)^{2}+(7-6)^{2}$"])   # 7 already present
        for it in (small, unused):
            self.assertIsNone(M.apply(it, "wrong_value"))
        new, _ = M.apply(clash, "wrong_value")
        self.assertNotIn("A(1, 7)", new["stem"])                                               # it picked a number that does not clash

    def test_label_changes_one_occurrence_of_a_label_the_solution_uses_twice(self):
        new, truth = M.apply(label_q(), "label")
        self.assertEqual(new["solution"][1], "Therefore $m_{AC}=3$ .")
        self.assertEqual(new["solution"][0], label_q()["solution"][0])
        self.assertEqual((truth["step"], truth["kind"], truth["where"]), (2, "label", "working"))
        once = dict(label_q(), solution=["$m_{AB}=3$"])
        self.assertIsNone(M.apply(once, "label"))                                             # a label used once is not an inconsistency

    def test_sign_flips_a_negative_bracket_in_a_line_with_a_variable_only(self):
        new, truth = M.apply(sign_q(), "sign")
        self.assertIn("(4)&=(-1.5)(2)+c", new["solution"][0])
        self.assertEqual((truth["step"], truth["kind"]), (1, "sign"))
        numeric = dict(sign_q(), solution=["$(-2)^{2}=4$"])                                   # no variable: the free check's ground
        self.assertIsNone(M.apply(numeric, "sign"))

    def test_final_answer_changes_the_key_so_the_last_step_no_longer_states_it(self):
        new, truth = M.apply(key_q(), "final_answer")
        self.assertEqual(new["answer"], "42.6")
        self.assertEqual(new["solution"], key_q()["solution"])
        self.assertEqual((truth["step"], truth["kind"]), (2, "final_answer"))
        self.assertIsNone(M.apply(dict(key_q(), answer="D"), "final_answer"))                  # a letter key
        self.assertIsNone(M.apply(dict(key_q(), answer="7"), "final_answer"))                  # the last step does not state it

    def test_stem_label_renames_a_point_in_the_question_to_a_name_the_working_never_uses(self):
        new, truth = M.apply(stem_q(), "stem_label")
        self.assertEqual(new["stem"], "Given $T(0, 1)$ and $Q(3, 5)$, find $m_{PQ}$.")
        self.assertEqual((truth["step"], truth["kind"], truth["where"]), (None, "label", "question"))
        self.assertIsNone(M.apply(dict(stem_q(), solution=["$m=\\frac{4}{3}$"]), "stem_label"))   # the working never names P

    def test_a_worked_example_entry_is_mutated_in_its_content(self):
        new, truth = M.apply(entry(), "wrong_value")
        self.assertEqual(M.get_stem(new), "Find the midpoint of $E(2, 10)$ and $G(4, 3)$.")
        self.assertEqual(M.get_steps(new), M.get_steps(entry()))
        self.assertEqual(truth["step"], 1)

    def test_an_operator_never_changes_what_the_free_precheck_sees(self):
        with mock.patch.object(M, "_precheck_n", side_effect=[0, 1]):
            self.assertIsNone(M.apply(dist_q(), "wrong_value"))
        for q, op in ((dist_q(), "wrong_value"), (label_q(), "label"), (sign_q(), "sign"), (key_q(), "final_answer"),
                      (stem_q(), "stem_label")):
            new, _ = M.apply(q, op)
            self.assertEqual(len(W.precheck_solution(M._view(new))), len(W.precheck_solution(M._view(q))), op)


def bundle() -> dict:
    qs = [dist_q(), label_q(), sign_q(), key_q(), stem_q()]
    for i in range(6):                                                    # more of each, so --per-op has something to take
        qs.append(dict(dist_q(), id=f"q:g10m8s2-1-1:ex8-2-{i + 20}", stem=f"Find the distance between $A(1, {6 + i})$ and $B(4, 2)$.",
                       solution=[f"Substitute: $d=\\sqrt{{(4-1)^{{2}}+(2-{6 + i})^{{2}}}}$", "Therefore the distance is $5$ units."]))
    return {"source_document": "x", "questions": qs, "explanation_entries": [entry()]}


class Build(unittest.TestCase):
    def setUp(self):
        self.b = bundle()
        self.cal = {"subset": ["q:g10m8s3-2-2:ex8-4-10", "q:g10m8s3-1-1:we04"]}      # sign_q and stem_q are the controls

    def test_deterministic_and_the_bundle_it_reads_is_untouched(self):
        before = copy.deepcopy(self.b)
        a = M.build(self.b, self.cal, per_op=2, rng=5)
        self.assertEqual(self.b, before)
        self.assertEqual(json.dumps(a, sort_keys=True), json.dumps(M.build(self.b, self.cal, per_op=2, rng=5), sort_keys=True))
        self.assertNotEqual(json.dumps(a[1], sort_keys=True), json.dumps(M.build(self.b, self.cal, per_op=2, rng=6)[1], sort_keys=True))

    def test_mutants_come_from_outside_the_subset_one_each_and_the_subset_stays_as_it_was(self):
        out, truth = M.build(self.b, self.cal, per_op=3, rng=5)
        ms = truth["mutants"]
        self.assertTrue(ms)
        self.assertEqual(len({m["base"] for m in ms}), len(ms), "a base is mutated once")
        self.assertFalse({m["base"] for m in ms} & set(self.cal["subset"]), "a mutant must never share a run with its own original")
        ids = [x["id"] for f in ("questions", "explanation_entries") for x in out[f]]
        self.assertEqual(len(ids), len(set(ids)))
        for sid in self.cal["subset"]:
            self.assertIn(sid, ids)                                    # the originals ride along: controls and real defects
        originals = {x["id"]: x for x in self.b["questions"]}
        self.assertEqual([x for x in out["questions"] if x["id"] == "q:g10m8s3-2-2:ex8-4-10"], [originals["q:g10m8s3-2-2:ex8-4-10"]])
        for m in ms:
            self.assertRegex(m["id"], r"^(q|expl):[a-z0-9-]+:ex8-9-1\d\d$")       # organic: an exercise that does not exist
            self.assertNotEqual(m["id"], m["base"])
            self.assertIn(m["operator"], M.OPERATORS)
            self.assertEqual(m["id"].split(":")[:2], m["base"].split(":")[:2])    # same kind and lesson
        self.assertTrue(all(c <= 3 for c in truth["by_operator"].values()))
        self.assertEqual(truth["format"], M.FORMAT)

    def test_the_mutants_truth_scores_and_their_packet_offers_the_bases_figures(self):
        out, truth = M.build(self.b, self.cal, per_op=2, rng=5)
        with tempfile.TemporaryDirectory() as t:
            f = Path(t) / "m.json"
            f.write_text(json.dumps(truth))
            self.assertEqual(W.load_aliases(f), {m["id"]: m["base"] for m in truth["mutants"]})
            self.assertEqual(W.load_aliases(None), {})
            m0 = truth["mutants"][0]
            figs = {m0["base"]: ["/w/figures/a.png"]}
            figs[m0["id"]] = figs[m0["base"]]                          # what `args --aliases` does
            sols = {s["id"]: s for s in W.solutions_from_bundle(out, figs)}
            self.assertEqual(sols[m0["id"]]["figures"], ["/w/figures/a.png"])


RUNS = EX / "runs" / "g10-math" / "working-check"
SEED = EX / "work" / "g10-math" / "pilot" / "seed" / "g10m-c08.json"


@unittest.skipUnless(SEED.exists() and (RUNS / "ch08.calibration.json").exists() and (RUNS / "ch08.mutants.json").exists(),
                     "the pilot seed (work/g10-math/, gitignored) and the committed Chapter 8 files")
class RealChapter(unittest.TestCase):
    def test_the_committed_chapter_8_truth_is_what_the_tool_regenerates(self):
        out, truth = M.build(json.loads(SEED.read_text()), json.loads((RUNS / "ch08.calibration.json").read_text()), 8, 8)
        self.assertEqual(json.dumps(truth, ensure_ascii=False, indent=1) + "\n", (RUNS / "ch08.mutants.json").read_text())
        self.assertEqual(truth["by_operator"], {op: 8 for op in M.OPERATORS})
        sols = W.solutions_from_bundle(out)
        self.assertEqual(len(sols), 51 + 40)
        # not one mutant is something the free pre-check flags that its base did not
        base = {s["id"]: s for s in W.solutions_from_bundle(json.loads(SEED.read_text()))}
        mut = {s["id"]: s for s in sols}
        for m in truth["mutants"]:
            self.assertEqual(len(W.precheck_solution(mut[m["id"]])), len(W.precheck_solution(base[m["base"]])), m["id"])


if __name__ == "__main__":
    unittest.main()
