"""Declarative family specs: checking, instantiating, blind grading, the bundle (B12, §3.9).

@covers FR-4304, FR-4305

FR-4304: families are declarative specs, regenerated deterministically, keys computed
with the stem, each item naming its parent, distractors naming a misconception of the
same objective, validation before load. FR-4305: the tier floor is measured over book
and generated items together. The blind-grading rule (one disagreement rejects the
family) and the fail-closed bundle are the stage's own gates (§3.9).

    uv run --with pytest python -m pytest -q tests/test_family_spec.py
"""

from __future__ import annotations

import contextlib
import copy
import io
import json
import random
import tempfile
import unittest
from pathlib import Path

import _scratchdb  # noqa: F401
import book_config
import generate_questions as G
import load_generated_questions as L
from families import spec as FS

HERE = Path(__file__).resolve().parent
FIX = HERE / "fixtures" / "families"
SPECS = FIX / "g10-specs"
CATALOGUE = FIX / "g10-catalogue.json"
SEED = 20260925


def load(name: str) -> dict:
    return json.loads((SPECS / name).read_text())


def run(specs, n=4):
    return G.run_specs(specs, n, SEED)


def quiet(fn, *a):
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()) as err:
        rc = fn(*a)
    return rc, err.getvalue()


def good_grades(specs, questions, grading_set, spoil: dict | None = None) -> dict:
    """What an honest blind grader returns, with answers optionally spoiled per family."""
    by_id = {q["id"]: q for q in questions}
    results = []
    for fam in grading_set["families"]:
        answers = []
        for i, inst in enumerate(fam["instances"]):
            q = by_id[inst["instance_id"]]
            if q["question_type"] == "mcq":
                text = next(c["text"] for c in q["choices"] if c["key"] == q["correct_answer"])
                ans = {"choice": q["correct_answer"], "choice_text": text}
            elif q["question_type"] == "short":
                ans = {"plain": q["answer_check"]}
            else:
                ans = {"value": q["correct_answer"]}
            if spoil and fam["family_id"] in spoil and i == 0:
                ans = spoil[fam["family_id"]]
            answers.append({"instance_id": inst["instance_id"], "stem_sha": inst["blind"]["stem_sha"],
                            "answer": ans, "working": "…"})
        results.append({"family_id": fam["family_id"], "spec_sha": fam["spec_sha"], "answers": answers,
                        "judge": {"distractors_ok": True, "key_form_ok": True, "context_ok": True,
                                  "solution_ok": True, "notes": ""}})
    return {"mode": "grade", "book": "fixture", "results": results}


class TheFixtureSpecs(unittest.TestCase):
    def test_all_six_load_and_instantiate(self):
        specs, problems = FS.load_dir(SPECS)
        self.assertEqual(problems, [])
        self.assertEqual(len(specs), 6)
        qs, rejected, counts = run(specs)
        self.assertEqual(rejected, [])
        self.assertEqual(counts["tpl:g10m9s5-1-1:rand-dollar"], 1, "an authored one-off is one item")
        self.assertTrue(all(v >= 1 for v in counts.values()))
        for q in qs:
            self.assertTrue(q["parent_question_id"].startswith(q["lo_id"].replace("lo:", "q:") + ":"))
            self.assertIn("family_spec_sha", q)
        self.assertTrue(any(q.get("authored") for q in qs))
        self.assertEqual({q["family"] for q in qs if not q.get("authored")},
                         {s.id for s in specs if s.kind == "family"}, "the family is a FIELD (§3.9)")

    def test_regeneration_is_byte_identical(self):
        specs, _ = FS.load_dir(SPECS)
        a, b = run(specs), run(specs)
        self.assertEqual(json.dumps(a), json.dumps(b))

    def test_typed_answers_carry_the_marker_spec(self):
        specs, _ = FS.load_dir(SPECS)
        qs, _, _ = run(specs)
        short = [q for q in qs if q["question_type"] == "short"]
        self.assertTrue(short)
        for q in short:
            m = q["choices"]["marker"]
            self.assertEqual(set(q["choices"]), {"marker"})
            self.assertEqual(set(m), {"kind", "key", "form", "variables", "tolerance"})
            self.assertEqual(m["key"], q["correct_answer"])
            self.assertNotIn("$", m["key"])
        tri = next(q for q in short if q["family"] == "tpl:g10m1s7-2-1:trinomial")
        self.assertEqual(tri["choices"]["marker"]["form"], "factorised")
        self.assertRegex(tri["correct_answer"], r"^\(x [+-] \d\)\(x [+-] \d\)$")

    def test_a_fixed_context_varies_only_numbers(self):
        specs, _ = FS.load_dir(SPECS)
        qs, _, _ = run([s for s in specs if s.id == "tpl:g10m9s2-1-1:interest"], 6)
        words = {"".join(ch for ch in q["stem"] if not ch.isdigit()) for q in qs}
        self.assertEqual(len(words), 1, "only the numbers may change between instances")


class RefusedSpecs(unittest.TestCase):
    def problems(self, mutate) -> list[str]:
        raw = load("g10m14s4-1-1--union.json")
        mutate(raw)
        return FS.check_spec(raw)

    def test_each_rule(self):
        cases = {
            "unknown key": lambda r: r.update(distracters=[]),
            "does not name its objective": lambda r: r.update(id="tpl:g10m4s2-1-1:union"),
            "not a question of": lambda r: r.update(parent_question_id="q:g10m4s2-1-1:ex4-1-1a"),
            "belongs to another objective": lambda r: r["choices"]["distractors"][0].update(
                misconception_id="mc:g10m4s2-1-1:sign-lost-transposing"),
            "at least three distractors": lambda r: r["choices"].update(distractors=r["choices"]["distractors"][:2]),
            "tier must be": lambda r: r.update(tier="core"),
            "unknown function": lambda r: r.update(stem="${=shell('ls')}$"),
            "has no 'answer'": lambda r: r.update(answer="1"),
            "exactly one of": lambda r: r["params"].append({"name": "z", "randint": [1, 2], "let": "3"}),
            "hide a built-in": lambda r: r["params"].append({"name": "num", "let": "1"}),
        }
        for expect, mutate in cases.items():
            ps = self.problems(mutate)
            self.assertTrue(any(expect in p for p in ps), f"{expect!r} not in {ps}")

    def test_an_authored_one_off_samples_nothing(self):
        raw = load("g10m9s5-1-1--rand-dollar.json")
        raw["params"] = [{"name": "usd", "randint": [10, 50]}]
        self.assertTrue(any("samples nothing" in p for p in FS.check_spec(raw)))

    def test_a_marker_is_checked(self):
        raw = load("g10m1s7-2-1--trinomial.json")
        raw["marker"]["kind"] = "polynomial"
        raw["marker"]["form"] = {"subject": "y"}
        ps = FS.check_spec(raw)
        self.assertTrue(any("marker.kind" in p for p in ps))
        self.assertTrue(any("form.subject" in p for p in ps))

    def test_a_word_in_a_fixed_context_hole_is_an_evaluation_error(self):
        raw = load("g10m9s2-1-1--interest.json")
        raw["params"].insert(0, {"name": "who", "choice": ["Thabo", "Lerato"]})
        raw["stem"] = raw["stem"].replace("Thabo", "{=who}")
        qs, rejected, counts = run([FS.load_spec(raw)])
        self.assertEqual(counts[raw["id"]], 0)
        self.assertTrue(rejected and all("evaluation error" in r and "may vary only numbers" in r for r in rejected))

    def test_an_unformatted_non_whole_answer_is_refused(self):
        raw = load("g10m4s2-1-1--balance.json")
        raw["answer"] = "x / 11"  # never whole for 0 < |x| <= 9
        qs, rejected, _ = run([FS.load_spec(raw)], 2)
        self.assertEqual(qs, [])
        self.assertTrue(any("format a non-whole answer" in r for r in rejected))

    def test_two_families_minting_the_same_item_ids_are_refused(self):
        with tempfile.TemporaryDirectory() as d:
            a = load("g10m4s2-1-1--balance.json")
            b = copy.deepcopy(a)
            b["id"] = "tpl:g10m4s2-1-1:balanced"
            Path(d, "a.json").write_text(json.dumps(a))
            Path(d, "b.json").write_text(json.dumps(b))
            _, problems = FS.load_dir(Path(d))
        self.assertTrue(any("would collide" in p for p in problems))

    def test_duplicate_stems_are_dropped_and_exhaustion_stops_a_family(self):
        raw = load("g10m4s2-1-1--balance.json")
        raw["params"] = [{"name": "x", "choice": [2, 3]}, {"name": "a", "let": "2"}, {"name": "b", "let": "1"},
                         {"name": "c", "let": "a * x + b"}]
        qs, _, counts = run([FS.load_spec(raw)], 10)
        self.assertEqual(counts[raw["id"]], 2, "two stems exist; the family stops there, never repeats")
        self.assertEqual(len({q["stem"] for q in qs}), 2)


class KeysAreRebalanced(unittest.TestCase):
    def test_correct_answers_spread_over_the_letters(self):
        specs, _ = FS.load_dir(SPECS)
        union = [s for s in specs if s.answer_type == "mcq"]
        qs, _, _ = run(union, 12)
        G.rebalance_keys(qs, random.Random(SEED))
        keys = [q["correct_answer"] for q in qs]
        self.assertLessEqual(max(keys.count(k) for k in "ABCD") - min(keys.count(k) for k in "ABCD"), 1)


class BlindGrading(unittest.TestCase):
    def setUp(self):
        self.specs, _ = FS.load_dir(SPECS)
        self.qs, _, _ = run(self.specs, 5)
        G.rebalance_keys(self.qs, random.Random(SEED))
        self.gs = G.grading_set(self.specs, self.qs, SEED)

    def test_the_blind_block_carries_no_key(self):
        for fam in self.gs["families"]:
            self.assertLessEqual(len(fam["instances"]), 3)
            for inst in fam["instances"]:
                blind = json.dumps(inst["blind"])
                sealed = inst["sealed"]
                for step in sealed["canonical_solution"]:
                    self.assertNotIn(json.dumps(step["text_md"])[1:-1], blind)
                self.assertNotIn("misconception_id", blind)
                self.assertNotIn("correct_answer", blind)
                self.assertNotIn("answer_check", blind)

    def test_the_sample_is_reproducible(self):
        self.assertEqual(self.gs, G.grading_set(self.specs, self.qs, SEED))

    def apply(self, grades):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d, "grade.json")
            p.write_text(json.dumps(grades))
            return G.apply_grades(self.specs, self.qs, [p])

    def test_clean_grades_accept_every_family(self):
        acc, rej = self.apply(good_grades(self.specs, self.qs, self.gs))
        self.assertEqual(rej, {})
        self.assertEqual(set(acc), {s.id for s in self.specs})

    def test_one_disagreement_rejects_the_family_and_only_it(self):
        spoil = {"tpl:g10m4s2-1-1:balance": {"value": "99999"},
                 "tpl:g10m1s7-2-1:trinomial": {"plain": "(x+1)*(x+1)"},
                 "tpl:g10m14s4-1-1:union": {"choice": "A", "choice_text": "not the key"}}
        acc, rej = self.apply(good_grades(self.specs, self.qs, self.gs, spoil))
        self.assertEqual(set(rej), set(spoil))
        self.assertTrue(all(any("disagrees" in r for r in rs) for rs in rej.values()))
        self.assertIn("tpl:g10m9s2-1-1:interest", acc)

    def test_an_equivalent_typed_answer_agrees(self):
        tri = next(q for q in self.qs if q["family"] == "tpl:g10m1s7-2-1:trinomial")
        ok, _ = G.answer_agrees(tri, {"plain": tri["answer_check"].replace("*", "").replace("+ -", "-")})
        self.assertTrue(ok)

    def test_mcq_answers_compare_by_text_so_rebalancing_cannot_break_them(self):
        grades = good_grades(self.specs, self.qs, self.gs)
        for q in self.qs:  # re-shuffle every option after grading
            if q["question_type"] == "mcq":
                q["choices"] = list(reversed(q["choices"]))
        acc, rej = self.apply(grades)
        self.assertNotIn("tpl:g10m14s4-1-1:union", rej)

    def test_a_grade_of_an_older_spec_does_not_count(self):
        grades = good_grades(self.specs, self.qs, self.gs)
        grades["results"][0]["spec_sha"] = "0" * 64
        _, rej = self.apply(grades)
        self.assertIn("older version", " ".join(rej[grades["results"][0]["family_id"]]))

    def test_silence_is_not_approval(self):
        grades = good_grades(self.specs, self.qs, self.gs)
        grades["results"] = grades["results"][1:]
        grades["results"][0]["judge"]["distractors_ok"] = None
        _, rej = self.apply(grades)
        self.assertEqual(rej[self.gs["families"][0]["family_id"]], ["not graded"])
        self.assertTrue(any("distractors_ok" in r for r in rej[grades["results"][0]["family_id"]]))


class TheBundle(unittest.TestCase):
    """The CLI end to end, in a temporary directory: fail closed, then a loadable bundle."""

    def test_out_is_refused_without_grades_or_catalogue(self):
        with tempfile.TemporaryDirectory() as d:
            rc, err = quiet(G.main_families, ["--families", str(SPECS), "--out", str(Path(d, "b.json"))])
            self.assertEqual(rc, 1)
            self.assertIn("without --grades", err)

    def test_grading_set_then_grades_then_bundle(self):
        with tempfile.TemporaryDirectory() as d:
            gs_path, out = Path(d, "gs.json"), Path(d, "bundle.json")
            rc, _ = quiet(G.main_families, ["--families", str(SPECS), "--per-family", "5",
                                            "--grading-set", str(gs_path), "--check"])
            self.assertEqual(rc, 0)
            specs, _ = FS.load_dir(SPECS)
            qs, _, _ = run(specs, 5)
            G.rebalance_keys(qs, random.Random(SEED))
            grades = good_grades(specs, qs, json.loads(gs_path.read_text()),
                                 {"tpl:g10m4s7-1-1:interval": {"plain": "interval(-inf, 0, false, true)"}})
            Path(d, "grade.json").write_text(json.dumps(grades))
            rc, err = quiet(G.main_families, ["--families", str(SPECS), "--per-family", "5",
                                              "--catalogue", str(CATALOGUE), "--grades", str(Path(d, "grade.json")),
                                              "--out", str(out)])
            self.assertEqual(rc, 0, err)
            b = json.loads(out.read_text())
        self.assertIn("tpl:g10m4s7-1-1:interval", b["rejected_families"])
        self.assertNotIn("tpl:g10m4s7-1-1:interval", b["family_specs"])
        self.assertFalse(any(q["family"] == "tpl:g10m4s7-1-1:interval" for q in b["questions"]))
        # the proposed misconception S5 has not written loses its tag; the rest resolve (FR-1112)
        self.assertTrue(any("product-rule-misused" in u for u in b["untagged_distractors"]))
        tags = {c.get("misconception_id") for q in b["questions"] for c in (q.get("choices") or [])
                if isinstance(q.get("choices"), list)}
        self.assertLessEqual(tags - {None}, {m["id"] for m in b["misconceptions"]})
        # the loader accepts the whole bundle: numeric, mcq and typed answers (short + choices.marker,
        # integration backlog 2), each with its family as a field
        self.assertIn("short", {q["question_type"] for q in b["questions"]})
        problems, _ = L.validate(b)
        self.assertEqual(problems, [])
        self.assertTrue(all(L.family_of(q) == q["family"] for q in b["questions"] if q.get("family")))

    def test_with_grades_s5_is_told_only_about_the_families_that_passed(self):
        with tempfile.TemporaryDirectory() as d:
            gs_path = Path(d, "gs.json")
            quiet(G.main_families, ["--families", str(SPECS), "--per-family", "5", "--grading-set", str(gs_path), "--check"])
            specs, _ = FS.load_dir(SPECS)
            qs, _, _ = run(specs, 5)
            G.rebalance_keys(qs, random.Random(SEED))
            mcq = next(s.id for s in specs if s.raw["answer_type"] == "mcq")
            wrong = next(c for q in qs if q["family"] == mcq for c in q["choices"] if c["key"] != q["correct_answer"])
            grades = good_grades(specs, qs, json.loads(gs_path.read_text()),
                                 {mcq: {"choice": wrong["key"], "choice_text": wrong["text"]}})
            Path(d, "grade.json").write_text(json.dumps(grades))
            every, graded = Path(d, "all.json"), Path(d, "graded.json")
            quiet(G.main_families, ["--families", str(SPECS), "--per-family", "5", "--s5-distractors", str(every), "--check"])
            rc, err = quiet(G.main_families, ["--families", str(SPECS), "--per-family", "5", "--grades",
                                              str(Path(d, "grade.json")), "--s5-distractors", str(graded), "--check"])
            self.assertEqual(rc, 0, err)
            refs = lambda p: {x["ref"].split("#")[0] for x in json.loads(p.read_text())["distractors"]}  # noqa: E731
            self.assertIn(mcq, refs(every))
            self.assertNotIn(mcq, refs(graded), "a family the blind grade refused tells S5 nothing")
            self.assertEqual(refs(graded), refs(every) - {mcq})

    def test_a_sacred_book_gets_no_families(self):
        raw = json.loads((book_config.BOOKS_DIR / "prep3-math-en.json").read_text())
        raw.update(book="sacred-fixture", sacred_content=True, bundles=[], generated=None, parity=None)
        with tempfile.TemporaryDirectory() as d:
            p = Path(d, "sacred-fixture.json")
            p.write_text(json.dumps(raw))
            rc, err = quiet(G.main_families, ["--families", str(SPECS), "--book", str(p), "--check"])
        self.assertEqual(rc, 2)
        self.assertIn("sacred", err)


class TierFloorAndHandoffs(unittest.TestCase):
    def book(self):
        raw = json.loads((book_config.BOOKS_DIR / "g10-math.json").read_text())
        raw["bundles"] = ["services/extraction/tests/fixtures/families/g10-bundle.json"]
        return book_config.Book.model_validate(raw)

    def test_the_floor_counts_book_and_generated_together(self):
        objs = G.book_objectives(self.book())
        self.assertEqual(len(objs), 6)
        before = G.tier_floor(objs, [])
        self.assertEqual(before["cells"], 18)
        specs, _ = FS.load_dir(SPECS)
        qs, _, _ = run(specs)
        after = G.tier_floor(objs, qs)
        self.assertGreater(after["cells_filled"], before["cells_filled"])
        below = {b["lo_id"]: b["missing"] for b in after["below_floor"]}
        self.assertNotIn("standard", below.get("lo:g10m1s7-2-1", []))
        self.assertEqual(after["by_objective"]["lo:g10m4s2-1-1"]["standard"], {"book": 1, "generated": 0})

    def test_author_args_list_the_gaps_with_their_evidence(self):
        entries, _ = G.load_catalogue(CATALOGUE)
        a = G.author_args(self.book(), [], G.book_objectives(self.book()), entries, False, [])
        self.assertEqual(a["mode"], "author")
        self.assertEqual(a["book"]["book"], "g10-math")
        o = next(o for o in a["objectives"] if o["lo_id"] == "lo:g10m4s2-1-1")
        self.assertEqual(o["tier_gaps"], ["basic"])
        self.assertEqual([m["id"] for m in o["misconceptions"]], ["mc:g10m4s2-1-1:sign-lost-transposing"])
        self.assertEqual(len(o["book_questions"]), 2)

    def test_s5_receives_every_distractor_with_an_example(self):
        specs, _ = FS.load_dir(SPECS)
        qs, _, _ = run(specs)
        ds = G.s5_distractors(specs, qs)
        self.assertTrue(ds)
        for d in ds:
            self.assertEqual(d["origin"], "S6")
            self.assertEqual(set(d) - {"proposed"}, {"lo", "origin", "ref", "question_id", "text", "misconception_id"})
        prop = [d for d in ds if d.get("proposed")]
        self.assertEqual([d["misconception_id"] for d in prop], ["mc:g10m14s4-1-1:product-rule-misused"])

    def test_tags_resolve_through_aliases_and_foreign_tags_fail(self):
        entries, alias = G.load_catalogue(CATALOGUE)
        q = {"id": "q:g10m14s4-1-1:g001-union", "lo_id": "lo:g10m14s4-1-1", "correct_answer": "A", "choices": [
            {"key": "A", "text": "1"}, {"key": "B", "text": "2", "misconception_id": "mc:g10m14s4-1-1:and-or-swapped"},
            {"key": "C", "text": "3", "misconception_id": "mc:g10m14s4-1-1:nowhere"},
            {"key": "D", "text": "4", "misconception_id": "mc:g10m4s2-1-1:sign-lost-transposing"}]}
        problems, untagged, used = G.resolve_tags([q], entries, alias)
        self.assertEqual(q["choices"][1]["misconception_id"], "mc:g10m14s4-1-1:and-for-or")
        self.assertNotIn("misconception_id", q["choices"][2])
        self.assertEqual(len(untagged), 1)
        self.assertEqual(len(problems), 1)
        self.assertEqual(used, {"mc:g10m14s4-1-1:and-for-or"})


if __name__ == "__main__":
    unittest.main()


class TierFloorCountsOnlyLiveBookQuestions(unittest.TestCase):
    """S6's gap list and S8's tier floor count the same thing: a book question held at G2 fills no
    cell, so S6 authors for that tier (found by the Chapter 8 dry run)."""

    def test_a_held_book_question_leaves_its_tier_a_gap(self):
        objs = {"lo:zz1s1-1-1": {"questions": [{"tier": "basic", "verified": True},
                                               {"tier": "advanced", "verified": False}]}}
        floor = G.tier_floor(objs, [])
        self.assertEqual(floor["below_floor"], [{"lo_id": "lo:zz1s1-1-1", "missing": ["standard", "advanced"]}])
