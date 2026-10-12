"""The S6 pipeline normalisations (families/normalise.py), and the book's own specs passing --check.

@covers FR-4304

A normalisation is MECHANICAL: the items a normalised spec instantiates are the items the author's spec
meant, number for number, and the spec's notes say what the pipeline changed. Anything that is not one of
the named defects is the author's to fix and is left alone.

    uv run --with pytest python -m pytest -q tests/test_family_normalise.py
"""

from __future__ import annotations

import copy
import hashlib
import json
import subprocess
import sys
import tempfile
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

    def test_a_one_sentence_mcq_is_marked_distinct_by_choices_and_its_first_item_does_not_change(self):
        raw = {"format": "ainext.family/1", "id": "tpl:g10m1s3-1-2:pick-largest", "kind": "family",
               "lo_id": "lo:g10m1s3-1-2", "parent_question_id": "q:g10m1s3-1-2:ex1-1-4a", "source_page": 9,
               "tier": "basic", "answer_type": "mcq", "context": None,
               "params": [{"name": "a", "randint": [2, 90]}],
               "stem": "Which of the following is the largest number?",
               "solution": ["The largest is ${=a + 40}$."],
               "choices": {"correct": "${=a + 40}$", "distractors": [
                   {"text": "${=a}$", "misconception_id": None}, {"text": "${=a + 1}$", "misconception_id": None},
                   {"text": "${=a + 2}$", "misconception_id": None}]},
               "notes": "Fixture: tests only."}
        self.assertEqual(FS.check_spec(raw), [])
        out, done = N.normalise(raw)
        self.assertEqual([d.split(":")[0] for d in done], ["distinct-by-choices"])
        self.assertIs(out["distinct_by_choices"], True)
        self.assertEqual(FS.check_spec(out), [])
        self.assertIn(N.MARK, out["notes"])
        before, after = items(raw), items(out)
        self.assertEqual(len(before), 1, "the family collapsed to one item")
        self.assertGreater(len(after), 1)
        self.assertEqual(after[0], before[0], "the item that was there is unchanged")
        self.assertEqual(N.normalise(out), (out, []), "a normalised spec is a fixpoint")

    def test_an_mcq_whose_stem_has_a_hole_is_left_to_its_author(self):
        raw = load("g10m14s4-1-1--union.json")
        self.assertEqual(raw["answer_type"], "mcq")
        self.assertTrue(raw["stem"].count("{="))
        self.assertEqual(N.normalise(raw), (raw, []))

    def test_an_author_error_is_not_normalised(self):
        # two named unknowns in a values marker: the marker sorts values, so t and b cannot be told apart —
        # a content decision, which goes back to the author
        raw = load("g10m4s7-1-1--interval.json")
        raw = dict(raw, marker=dict(raw["marker"], kind="values", answer="t = {=a} and b = {=b}",
                                    variables=["t", "b"]))
        self.assertEqual(N.normalise(raw)[1], [])


class SlugCollisions(unittest.TestCase):
    """Two families on one objective whose slugs share their first six letters mint the same item ids, and
    --check refuses both. The normaliser renames the later ones, mechanically and the same way every time —
    and never a family whose items are already loaded (Chapters 1, 2, 8, any bundle, prep3)."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def spec(self, slug, tail="g10m4s2-1-1"):
        """A well-formed family on objective ``tail`` (the balance fixture, re-homed)."""
        text = json.dumps(load("g10m4s2-1-1--balance.json")).replace("g10m4s2-1-1:balance", f"{tail}:{slug}") \
            .replace("g10m4s2-1-1", tail)
        return json.loads(text)

    def put(self, slug, tail="g10m4s2-1-1", where=None) -> Path:
        d = where or self.dir
        d.mkdir(parents=True, exist_ok=True)
        f = d / f"{tail}--{slug}.json"
        f.write_text(json.dumps(self.spec(slug, tail), indent=1, ensure_ascii=False) + "\n")
        return f

    def run_n(self, files, loaded=frozenset(), dry=False):
        return N.process(sorted(files) if files else [], dry_run=dry, loaded=set(loaded))

    def ids(self, where=None):
        return {json.loads(f.read_text())["id"].split(":")[-1]: f.name for f in sorted((where or self.dir).glob("*.json"))}

    def test_the_later_family_is_renamed_and_the_directory_then_passes_the_check(self):
        a, b = self.put("which-irrational"), self.put("which-rational")
        self.assertTrue(FS.load_dir(self.dir)[1], "the collision is real")
        lines, stuck = self.run_n([a, b])
        self.assertEqual(stuck, [])
        self.assertEqual(FS.load_dir(self.dir)[1], [])
        self.assertEqual(self.ids(), {"which-irrational": "g10m4s2-1-1--which-irrational.json",
                                      "rational-which": "g10m4s2-1-1--rational-which.json"},
                         "the first by file name keeps its slug; the other's words rotate and its file follows")
        self.assertTrue(any("rename-colliding-slug: id tpl:g10m4s2-1-1:which-rational -> "
                            "tpl:g10m4s2-1-1:rational-which (file renamed to match)" in l for l in lines))
        out = json.loads((self.dir / "g10m4s2-1-1--rational-which.json").read_text())
        self.assertIn(N.MARK, out["notes"])
        self.assertIn("were shared with a sibling family on the same objective", out["notes"])
        self.assertIn("which-irrational", out["notes"], "the notes name the sibling it collided with")
        # nothing else changed: the same family under another id
        before = self.spec("which-rational")
        self.assertEqual({k: v for k, v in out.items() if k not in ("id", "notes")},
                         {k: v for k, v in before.items() if k not in ("id", "notes")})
        # the spec is the same family; its sampled instances are NOT the same ones (each family draws from a stream
        # keyed on its id), which is exactly why a family whose items are loaded is never renamed
        new_ids = {q["id"] for q in G.run_specs([FS.load_spec(out)], 3, SEED)[0]}
        self.assertTrue(new_ids and all(i.startswith("q:g10m4s2-1-1:g00") and i.endswith("-ration") for i in new_ids), new_ids)

    def test_three_in_a_group_each_get_their_own_six_letters(self):
        fs = [self.put(s, "g10m3s8-1-2") for s in ("divide-common-factor-squares", "divide-reversed-squares",
                                                   "divide-trinomial-squares")]
        self.assertEqual(len(FS.load_dir(self.dir)[1]), 2)
        _, stuck = self.run_n(fs)
        self.assertEqual(stuck, [])
        self.assertEqual(FS.load_dir(self.dir)[1], [])
        self.assertEqual(set(self.ids()), {"divide-common-factor-squares", "reversed-squares-divide",
                                           "trinomial-squares-divide"})

    def test_a_one_word_slug_takes_f2_f3_and_so_on(self):
        fs = [self.put(s, "g10m3s8-1-2") for s in ("balance", "balanced", "balances")]
        _, stuck = self.run_n(fs)
        self.assertEqual(stuck, [])
        self.assertEqual(FS.load_dir(self.dir)[1], [])
        self.assertEqual(set(self.ids()), {"balance", "f2-balanced", "f3-balances"},
                         "f2-bal… is taken by the second, so the third moves on to f3-")

    def test_it_is_deterministic_and_a_fixpoint(self):
        names = ("which-irrational", "which-rational", "divide-a-b", "divide-b-a")
        one, two = self.dir / "one", self.dir / "two"
        for where in (one, two):
            for n in names:
                self.put(n, "g10m3s8-1-2", where)
        self.run_n(sorted(one.glob("*.json")))
        self.run_n(sorted(two.glob("*.json"), reverse=True))          # another order on the command line
        self.assertEqual(self.ids(one), self.ids(two))
        for n in sorted(one.glob("*.json")):
            self.assertEqual(n.read_text(), (two / n.name).read_text(), n.name)
        snapshot = {f.name: f.read_text() for f in sorted(one.glob("*.json"))}
        lines, stuck = self.run_n(sorted(one.glob("*.json")))
        self.assertEqual(stuck, [])
        self.assertTrue(all("nothing to normalise" in l for l in lines), lines)
        self.assertEqual(snapshot, {f.name: f.read_text() for f in sorted(one.glob("*.json"))})

    def test_a_family_whose_items_are_loaded_is_never_renamed(self):
        for tail in ("g10m1s3-1-2", "g10m2s3-1-2", "g10m8s3-1-2", "u4-2-1"):          # Chapters 1, 2, 8 and prep3
            where = self.dir / tail
            fs = [self.put("which-irrational", tail, where), self.put("which-rational", tail, where)]
            before = {f.name: f.read_text() for f in fs}
            lines, stuck = self.run_n(fs)
            self.assertEqual(len(stuck), 1, tail)
            self.assertIn("cannot be renamed here", stuck[0])
            self.assertEqual({f.name: f.read_text() for f in sorted(where.glob("*.json"))}, before, f"{tail} untouched")
            self.assertTrue(all("nothing to normalise" in l for l in lines))

    def test_one_loaded_family_keeps_its_slug_and_the_other_moves(self):
        a, b = self.put("which-irrational"), self.put("which-rational")
        # b is loaded (named in a bundle), so a — first by file name — is the one that moves
        _, stuck = self.run_n([a, b], loaded={"tpl:g10m4s2-1-1:which-rational"})
        self.assertEqual(stuck, [])
        self.assertEqual(set(self.ids()), {"which-rational", "irrational-which"})
        # both loaded: left alone, reported
        c, d = self.put("alpha-one", "g10m5s1-1-1"), self.put("alpha-two", "g10m5s1-1-1")
        both = {"tpl:g10m5s1-1-1:alpha-one", "tpl:g10m5s1-1-1:alpha-two"}
        _, stuck = self.run_n([c, d], loaded=both)
        self.assertEqual(len(stuck), 1)
        self.assertEqual(set(self.ids()) & {"alpha-one", "alpha-two"}, {"alpha-one", "alpha-two"})

    def test_a_sibling_not_named_on_the_command_line_is_never_renamed(self):
        a, b = self.put("which-irrational"), self.put("which-rational")
        _, stuck = self.run_n([a])                                    # only the first is named: it must be the mover
        self.assertEqual(stuck, [])
        self.assertEqual(set(self.ids()), {"irrational-which", "which-rational"})
        self.assertEqual(FS.load_dir(self.dir)[1], [])

    def test_the_command_line_and_its_exit_status(self):
        a, b = self.put("which-irrational"), self.put("which-rational")
        self.assertEqual(N.main([str(a), str(b), "--dry-run"]), 0)
        self.assertEqual(set(self.ids()), {"which-irrational", "which-rational"}, "--dry-run writes nothing")
        self.assertEqual(N.main([str(a), str(b)]), 0)
        self.assertEqual(set(self.ids()), {"which-irrational", "rational-which"})
        pinned = self.dir / "ch1"
        fs = [self.put("which-irrational", "g10m1s3-1-2", pinned), self.put("which-rational", "g10m1s3-1-2", pinned)]
        self.assertEqual(N.main([str(f) for f in fs]), 1, "a collision only a person can settle is not a success")

    def test_a_bundle_names_the_families_that_are_loaded(self):
        (self.dir / "g10-math").mkdir()
        (self.dir / "g10-math" / "generated-questions.json").write_text(json.dumps({
            "families": {"tpl:g10m3s1-1-1:a": 10}, "family_specs": {"tpl:g10m3s1-1-1:b": "sha"},
            "questions": [{"family": "tpl:g10m3s1-1-1:c"}, {"family": None}, {}]}))
        (self.dir / "misconceptions.json").write_text(json.dumps({"misconceptions": []}))     # not a bundle: ignored
        self.assertEqual(N.loaded_family_ids(self.dir), {"tpl:g10m3s1-1-1:a", "tpl:g10m3s1-1-1:b", "tpl:g10m3s1-1-1:c"})

    @unittest.skipUnless(BOOK_FAMILIES.is_dir() and (EX / "seed" / "generated").is_dir(), "no book families / bundles here")
    def test_the_families_already_in_the_repo_are_left_exactly_as_they_are(self):
        dirs = [BOOK_FAMILIES, BOOK_FAMILIES / "ch01", BOOK_FAMILIES / "ch02", EX / "families" / "prep3-math-en"]
        for d in (d for d in dirs if d.is_dir()):
            files = [f for f in sorted(d.glob("*.json")) if not f.name.startswith("_")]
            lines, stuck = N.process(files, dry_run=True)
            self.assertEqual(stuck, [], d.name)
            self.assertTrue(all("nothing to normalise" in l for l in lines), (d.name, [l for l in lines if "nothing" not in l]))
        loaded = N.loaded_family_ids()
        self.assertIn("tpl:g10m8s1-1-3:pentagon-partial-arc", loaded)
        self.assertTrue(any(i.startswith("tpl:g10m2s") for i in loaded))


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
