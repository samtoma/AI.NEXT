"""The S6 pipeline normalisations (families/normalise.py), and the book's own specs passing --check.

@covers FR-4304

A normalisation is MECHANICAL: the items a normalised spec instantiates are the items the author's spec
meant, number for number, and the spec's notes say what the pipeline changed. Anything that is not one of
the two named defects is the author's to fix and is left alone.

    uv run --with pytest python -m pytest -q tests/test_family_normalise.py
"""

from __future__ import annotations

import copy
import hashlib
import json
import subprocess
import sys
import unittest
from pathlib import Path

import generate_questions as G
from families import normalise as N
from families import spec as FS

HERE = Path(__file__).resolve().parent
EX = HERE.parent
SPECS = HERE / "fixtures" / "families" / "g10-specs"
BOOK_FAMILIES = EX / "families" / "g10-math"
SEED = 20260926
KEYS = ("id", "stem", "canonical_solution", "correct_answer", "choices", "question_type")


def load(name):
    return json.loads((SPECS / name).read_text())


def items(raw):
    """Instantiate a spec WITHOUT the structural check (the author's raw spec fails it)."""
    spec = FS.FamilySpec(raw=raw, path=None, sha=hashlib.sha256(json.dumps(raw, sort_keys=True).encode()).hexdigest())
    qs, _, _ = G.run_specs([spec], 8, SEED)
    return [{k: q.get(k) for k in KEYS} for q in qs]


class Normalisations(unittest.TestCase):
    def test_a_redundant_answer_is_dropped_and_the_items_do_not_change(self):
        good = load("g10m1s7-2-1--trinomial.json")
        author = dict(good, answer="(x + {=p})(x + {=q})")
        self.assertTrue(FS.check_spec(author))
        out, done = N.normalise(author)
        self.assertEqual(FS.check_spec(out), [])
        self.assertEqual([d.split(":")[0] for d in done], ["drop-redundant-answer"])
        self.assertNotIn("answer", out)
        self.assertEqual(out["marker"], good["marker"])
        self.assertEqual(items(out), items(good))
        self.assertIn(N.MARK, out["notes"])

    def test_a_shadowing_param_is_renamed_everywhere_but_where_the_built_in_is_called(self):
        good = load("g10m4s2-1-1--balance.json")
        good["solution"].append("So $x = {=num(x)}$.")   # the built-in num(), called
        swap = lambda s: s.replace("paren(b)", "paren(num)").replace("signed(b)", "signed(num)") \
            .replace("c - b", "c - num").replace("linear(a, b)", "linear(a, num)")  # noqa: E731
        author = copy.deepcopy(good)
        author["params"][2] = {"name": "num", "randint": [-12, 12], "resample_while": "num == 0"}
        author["params"][3] = {"name": "c", "let": "a * x + num"}
        author["stem"] = swap(author["stem"])
        author["solution"] = [swap(s) for s in author["solution"]]
        self.assertTrue(any("would hide a built-in" in p for p in FS.check_spec(author)))
        out, done = N.normalise(author)
        self.assertEqual(FS.check_spec(out), [])
        self.assertEqual([d.split(":")[0] for d in done], ["rename-shadowing-param"])
        self.assertEqual([p["name"] for p in out["params"]], ["x", "a", "num_v", "c"])
        self.assertEqual(out["params"][3]["let"], "a * x + num_v")
        self.assertIn("{=num(x)}", out["solution"][-1])        # the call is the built-in: untouched
        self.assertIn("{=paren(num_v)}", out["solution"][0])
        self.assertEqual(items(out), items(good))              # the same numbers, the same words

    def test_a_normalised_spec_is_a_fixpoint_and_a_clean_one_is_left_alone(self):
        author = dict(load("g10m1s7-2-1--trinomial.json"), answer="x")
        once, _ = N.normalise(author)
        self.assertEqual(N.normalise(once), (once, []))
        for f in sorted(SPECS.glob("*.json")):
            raw = json.loads(f.read_text())
            self.assertEqual(N.normalise(raw), (raw, []), f.name)

    def test_an_author_error_is_not_normalised(self):
        # two named unknowns in a values marker: the marker sorts values, so t and b cannot be told apart —
        # a content decision, which goes back to the author
        raw = load("g10m4s7-1-1--interval.json")
        raw = dict(raw, marker=dict(raw["marker"], kind="values", answer="t = {=a} and b = {=b}",
                                    variables=["t", "b"]))
        self.assertEqual(N.normalise(raw)[1], [])


class BlindAnswersWithNames(unittest.TestCase):
    """The Chapter 8 grade: the blind solver wrote "x = [0, 8]" and "H = (3, 1)" — right values, with names.
    The app's marker removes names (a named value, a named point), so the pipeline's comparison does too;
    every value still has to match the key."""

    def q(self, kind, check, variables):
        return {"question_type": "expression", "answer_check": check,
                "choices": {"marker": {"kind": kind, "variables": variables, "tolerance": None}}}

    def test_names_go_values_stay(self):
        vals, pt = self.q("values", "[0, 8]", ["x"]), self.q("coordinates", "(3, 1)", [])
        for said in ("x = [0, 8]", "x = 0 or x = 8", "x = 8; x = 0", "[8, 0]", "0 or 8"):
            self.assertTrue(G.answer_agrees(vals, {"plain": said})[0], said)
        for said in ("x = [0, 9]", "x = 0", "y = [0, 8]", "x = 0 or y = 8"):
            self.assertFalse(G.answer_agrees(vals, {"plain": said})[0], said)
        for said in ("H = (3, 1)", "H(3; 1)", "(3; 1)", "(3, 1)"):
            self.assertTrue(G.answer_agrees(pt, {"plain": said})[0], said)
        for said in ("H = (1, 3)", "(3, 1, 0)", "h = (3, 1)"):
            self.assertFalse(G.answer_agrees(pt, {"plain": said})[0], said)

    @unittest.skipUnless(__import__("shutil").which("node"), "node is not installed")
    def test_the_app_marks_the_named_forms_correct_too(self):
        ts = EX.parents[1] / "app" / "src" / "lib" / "answer-marker.ts"
        cases = [["H = (3, 1)", {"kind": "coordinates", "key": "(3, 1)", "variables": []}],
                 ["H(3; 1)", {"kind": "coordinates", "key": "(3, 1)", "variables": []}],
                 ["x = 0 or x = 8", {"kind": "values", "key": "x = 0 \\text{ or } x = 8", "variables": ["x"]}],
                 ["x = 8; x = 0", {"kind": "values", "key": "x = 0 \\text{ or } x = 8", "variables": ["x"]}]]
        script = ("const m = await import(process.argv[1]); const cs = JSON.parse(process.argv[2]);"
                  "console.log(JSON.stringify(cs.map(([a, s]) => m.mark(a, {form: null, tolerance: null, ...s}).result)))")
        out = subprocess.run(["node", "--no-warnings", "--input-type=module", "-e", script, ts.as_uri(), json.dumps(cases)],
                             capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(out.stdout), ["correct"] * len(cases))


@unittest.skipUnless(BOOK_FAMILIES.is_dir(), "no families/g10-math in this checkout")
class TheBooksSpecsPassTheCheck(unittest.TestCase):
    def test_check_passes_for_every_g10_spec(self):
        r = subprocess.run([sys.executable, str(EX / "generate_questions.py"), "--families", str(BOOK_FAMILIES),
                            "--book", "g10-math", "--check"], capture_output=True, text=True, cwd=EX)
        self.assertEqual(r.returncode, 0, r.stderr)
        n = len([p for p in BOOK_FAMILIES.glob("*.json") if not p.name.startswith("_")])
        self.assertIn(f"{n} spec(s) →", r.stdout)
        self.assertNotIn("=0", r.stdout.split("per family:")[-1], "every family produced items")

    def test_every_normalised_spec_says_so_and_is_a_fixpoint(self):
        for f in sorted(BOOK_FAMILIES.glob("*.json")):
            raw = json.loads(f.read_text())
            self.assertEqual(N.normalise(raw)[1], [], f"{f.name}: still has a mechanical defect")
            if N.MARK in (raw.get("notes") or ""):
                self.assertEqual(FS.check_spec(raw), [], f.name)


if __name__ == "__main__":
    unittest.main()
