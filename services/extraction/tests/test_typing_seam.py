"""The seam between a lesson run and G2 (Chapter 1, 2026-10-01): a typing the pipeline flagged is never required to be
well formed until a person rules on it; options the book never printed are a typing problem whichever collection made the
run; and the auto-pass gates read the book's own maths, write only their own chapter's file and leave teaching items alone.

    uv run --with pytest python -m pytest -q tests/test_typing_seam.py

@covers FR-4302, FR-4303

The eight validation errors the first Chapter 1 lesson (g10m1s3-1) died on, as fixtures:
  * 4 choice items typed with a compound key no option carries (the answer key came out None), and
  * 4 choice items typed with a list of 14 numbers to select from (options without a key, answer None).
`lesson-runs --draft` could not even write G2's page for them. Now such an item is a pending typing problem: G2 (a person, or
the auto-pass's exclusion) rules on it, and the full shape is required again the moment it is accepted, fixed or held.
No model is called.
"""

from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
EX = HERE.parent
for p in (str(EX), str(HERE)):
    if p not in sys.path:
        sys.path.insert(0, p)

import assemble_lesson_bundle as alb  # noqa: E402
import assemble_objectives as ao  # noqa: E402
import auto_pass_gates as apg  # noqa: E402
import book_config  # noqa: E402
import review_policy  # noqa: E402

NUMBERS = [{"key": k, "text": t} for k, t in zip("ABCDE", ("\\sqrt[3]{26}", "\\frac{3}{2}", "\\sqrt{-24}", "\\sqrt{39}", "7,\\dot{1}\\dot{1}"))] \
    + [{"text": t} for t in ("\\pi^2", "\\frac{\\pi}{2}", "7,12", "-\\sqrt{24}", "9", "\\pi")]        # no key past E: 'ABCDE'[5]


def item(ref="Ex1-1:4c", **kw) -> dict:
    it = {"ref": ref, "kind": "exercise", "lo": "lo:g10m1s3-1-1", "stem": "State whether the number is rational or irrational.",
          "answer_type": "choice", "answer": "A", "choices": [{"key": "A", "text": "rational"}, {"key": "B", "text": "irrational"}],
          "solution": ["It is rational."], "solution_provenance": "book_worked_epub", "printed_answer": "rational",
          "verification": "agreed", "tier": "standard", "printed_page": 10, "typing_problems": [], "options_source": "stem"}
    it.update(kw)
    return it


def compound(ref="Ex1-1:4c") -> dict:       # the 4 compound-key items
    return item(ref, answer=None, options_source="lesson", verification="disputed",
                choices=[{"key": "A", "text": "irrational"}, {"key": "B", "text": "rational"},
                         {"key": "C", "text": "rational, integer"},
                         {"key": "D", "text": "rational, integer, whole number and natural number"}],
                typing_problems=["a choice needs 2–5 options with the key among them"])


def selection(ref="Ex1-11:5c") -> dict:     # the 4 select-from-a-list items
    return item(ref, answer=None, choices=NUMBERS, verification="agreed",
                typing_problems=["options said to be the stem's are not all in the stem"])


def lesson(items, slug="g10m1s3-1") -> dict:
    return {"lesson": slug, "claims": [], "items": items, "visuals": [], "viz_gaps": [], "teacher_only": {}}


def run_of(items) -> dict:
    return {"prompts_version": "lesson-v7", "collect_version": "collect-6", "stage": "S2-S4,S8", "lessons": [lesson(items)]}


class Options(unittest.TestCase):
    def test_options_the_book_never_printed_are_a_problem_whichever_collection_made_the_run(self):
        nums = item("Ex1-3:1a", options_source="lesson", answer="B",
                    choices=[{"key": "A", "text": "3 and 4"}, {"key": "B", "text": "4 and 5"}, {"key": "C", "text": "5 and 6"}])
        self.assertTrue(alb.choice_option_problems(nums)[0].startswith(alb.INVENTED_OPTIONS))
        self.assertEqual(alb.choice_option_problems(compound())[0][:len(alb.INVENTED_OPTIONS)], alb.INVENTED_OPTIONS)
        # a closed set of categories, a yes/no pair of sentences, true / false, and the stem's own alternatives are fine
        for opts in (["rational", "irrational"], ["real", "non-real", "undefined"], ["true", "false"],
                     ["opposite sides are parallel", "opposite sides are not parallel"], ["Irrational number", "Rational number"]):
            ok = item(options_source="lesson", choices=[{"key": "ABCDE"[k], "text": o} for k, o in enumerate(opts)])
            self.assertEqual(alb.choice_option_problems(ok), [], opts)
        self.assertEqual(alb.choice_option_problems(item(options_source="stem", choices=[{"key": "A", "text": "(i)"}, {"key": "B", "text": "(ii)"}])), [])
        # more than five options, and an option with no key
        sel = alb.choice_option_problems(selection())
        self.assertTrue(any(p.startswith(alb.TOO_MANY_OPTIONS) for p in sel) and any(p.startswith(alb.UNKEYED_OPTIONS) for p in sel), sel)

    def test_a_problem_the_collection_already_named_is_not_added_again(self):
        it = compound()
        it["typing_problems"] = [f"{alb.INVENTED_OPTIONS}: \"rational, integer\""]
        self.assertEqual(alb.choice_option_problems(it), [])
        self.assertEqual(alb.choice_option_problems(item(answer_type="numeric", choices=None, answer="3")), [])


class Validator(unittest.TestCase):
    """The 8 errors: LessonRun refused every item whose key was no option, and G2's draft page could not be written."""

    def test_the_first_lessons_eight_items_validate_as_pending_typing_problems(self):
        items = [compound("Ex1-1:4c"), compound("Ex1-1:4g"), selection("Ex1-11:5c"), selection("Ex1-11:5d"),
                 selection("Ex1-11:5e"), selection("Ex1-11:5f")]
        files = ao.lesson_runs(run_of(items), None, draft=True)
        rec = files["g10m1s3-1"]
        self.assertEqual(sorted(rec["pending_g2"]), sorted(f"g10m1s3-1:{i['ref']}" for i in items))
        self.assertTrue(rec["draft"])

    def test_without_a_verdict_a_final_split_still_refuses_them_and_says_so(self):
        with self.assertRaisesRegex(ao.StageError, r"Ex1-1:4c.*needs a G2 fix or exclude"):
            ao.lesson_runs(run_of([compound()]), None)

    def test_an_exclusion_lets_the_malformed_typing_through_and_nothing_else_does(self):
        g2 = {"by": "auto-pass G2 (AI recommendation)", "auto": True,
              "items": {"g10m1s3-1:Ex1-1:4c": {"verdict": "exclude", "auto": True, "note": "typing"}}}
        files = ao.lesson_runs(run_of([compound()]), g2)
        self.assertEqual(files["g10m1s3-1"]["items"][0]["g2"]["verdict"], "exclude")
        # an ACCEPT puts the whole shape back on it: a choice with no key is not a question
        g2["items"]["g10m1s3-1:Ex1-1:4c"] = {"verdict": "accept", "by": "Samuel Toma"}
        with self.assertRaisesRegex(ao.StageError, "needs >= 2 choices and its key among them"):
            ao.lesson_runs(run_of([compound()]), g2)

    def test_an_item_nothing_flagged_is_still_held_to_the_full_shape(self):
        bad = item("Ex1-1:4a", answer=None)          # no key, and nobody (collection or audit) flagged it
        with self.assertRaisesRegex(ao.StageError, "needs >= 2 choices and its key among them"):
            ao.lesson_runs(run_of([bad]), None, draft=True)

    def test_an_item_with_flagged_typing_and_no_verdict_is_never_verified(self):
        it = alb.RunItem.model_validate(compound())
        self.assertEqual(it.fate(), "held")
        ruled = alb.RunItem.model_validate(dict(compound(), g2={"verdict": "exclude", "by": "x"}))
        self.assertEqual(ruled.fate(), "excluded")

    def test_a_run_an_older_collection_made_gets_the_options_problem_added(self):
        # collect-5 let "4 and 5" among "3 and 4" and "5 and 6" through with no typing problem at all
        old = item("Ex1-3:1a", options_source="lesson", answer="B", verification="agreed",
                   choices=[{"key": "A", "text": "3 and 4"}, {"key": "B", "text": "4 and 5"}, {"key": "C", "text": "5 and 6"}])
        files = ao.lesson_runs(run_of([old]), None, draft=True)
        rec = files["g10m1s3-1"]
        self.assertEqual(rec["pending_g2"], ["g10m1s3-1:Ex1-3:1a"])
        self.assertTrue(rec["items"][0]["typing_problems"][0].startswith(alb.INVENTED_OPTIONS))
        with self.assertRaisesRegex(ao.StageError, r"needs a G2 fix or exclude"):
            ao.lesson_runs(run_of([old]), None)


class AutoPass(unittest.TestCase):
    def setUp(self):
        self.book = book_config.load_book("g10-math")

    def test_g2_decides_what_the_audit_flags_and_leaves_teaching_items_alone(self):
        notmarkable = item("WE1", answer_type="not_markable", answer=None, choices=None, verification="disputed")
        run = run_of([compound("Ex1-1:4c"), selection("Ex1-11:5c"), notmarkable, item("Ex1-1:4a")])
        run["lessons"][0]["verify"] = {"disagreements": [{"ref": "WE1"}, {"ref": "Ex1-1:4c"}],
                                       "typing_problems": [{"ref": "Ex1-1:4c", "problems": compound()["typing_problems"]}]}
        owed = apg.g2_items(run, 1, "g10m")
        # the options audit puts an old run's invented options in front of G2 even when its lesson-level lists are empty
        old = item("Ex1-3:1a", options_source="lesson", answer="B",
                   choices=[{"key": "A", "text": "3 and 4"}, {"key": "B", "text": "4 and 5"}])
        owed_old = apg.g2_items(run_of([old]), 1, "g10m")
        self.assertIn("g10m1s3-1:Ex1-3:1a", owed_old)
        self.assertEqual(apg.g2_rule(owed_old["g10m1s3-1:Ex1-3:1a"])[0], "exclude")
        doc, c, decisions = apg.g2_merge(owed, None, None)
        self.assertEqual(doc["items"]["g10m1s3-1:Ex1-1:4c"]["verdict"], "exclude")
        self.assertTrue(doc["auto"] and review_policy.is_auto(doc["by"]))
        self.assertNotIn("g10m1s3-1:WE1", doc["items"], "typed not markable: no verdict is owed")
        self.assertEqual((c["held"], c.get("teaching")), (0, 1))
        self.assertTrue(any(d["key"] == "g10m1s3-1:WE1" and d["decision"].startswith("no verdict needed") for d in decisions))

    def test_the_collections_retyped_choices_are_listed_in_the_record(self):
        it = item("Ex1-3:1a", answer_type="expression", answer="4; 5", choices=None,
                  marker={"kind": "values", "key": "4; 5", "form": None, "variables": [], "tolerance": None})
        run = run_of([it])
        run["lessons"][0]["verify"] = {"retyped": [{"ref": "Ex1-3:1a", "as": "expression (values)", "key": "4; 5",
                                                    "because": ["options said to be the lesson's closed set are not categories"]}]}
        out = apg.g2_retyped(run, 1, "g10m")
        self.assertEqual(out[0]["key"], "g10m1s3-1:Ex1-3:1a")
        self.assertIn("typed again as expression (values)", out[0]["decision"])
        self.assertEqual(apg.g2_retyped(run, 2, "g10m"), [])

    def test_g1_approves_with_the_books_own_maths_not_the_pilots(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            with mock.patch.object(apg, "HERE", root):
                # no book file: the approval's own default
                a = apg.approve_argv(self.book, 1, root / "v.json", None, None)
                self.assertNotIn("--maths", a)
                own = root / "runs" / "g10-math" / "maths" / "book" / "accepted.json"
                own.parent.mkdir(parents=True)
                own.write_text("{}")
                a = apg.approve_argv(self.book, 1, root / "v.json", None, None)
                self.assertEqual(a[a.index("--maths") + 1], str(own))
                self.assertEqual(a[a.index("--by") + 1], "auto-pass G1 (AI recommendation)")
                self.assertTrue(review_policy.is_auto(a[a.index("--by") + 1]))
                # an explicit file wins; the objectives directory the auto-pass read is the one approve reads
                a = apg.approve_argv(self.book, 1, root / "v.json", Path("m.json"), Path("objs"))
                self.assertEqual((a[a.index("--maths") + 1], a[a.index("--objectives-dir") + 1]), ("m.json", "objs"))

    def test_g1_approve_passes_the_maths_through_to_assemble_objectives(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            objs = root / "objs"
            objs.mkdir()
            (objs / "ch01.check.json").write_text(json.dumps({"failures": [], "undecided": [], "pool": {}}))
            seen = []
            with mock.patch.object(apg, "HERE", root), mock.patch("assemble_objectives.main", lambda argv: seen.append(argv) or 0), \
                    redirect_stdout(io.StringIO()):
                rc = apg.main(["g1", "g10-math", "--chapter", "1", "--objectives-dir", str(objs), "--maths", str(root / "m.json"),
                               "--approve", "--gates-dir", str(root / "gates")])
            self.assertEqual(rc, 0)
            argv = seen[0]
            self.assertEqual(argv[:4], ["approve", "g10-math", "--chapter", "1"])
            self.assertEqual(argv[argv.index("--maths") + 1], str(root / "m.json"))
            self.assertEqual(argv[argv.index("--objectives-dir") + 1], str(objs))

    def test_g2_never_writes_a_fan_out_chapter_into_the_pilots_file_by_default(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            pilot = root / "runs" / "g10-math" / "g2.json"
            pilot.parent.mkdir(parents=True)
            pilot.write_text(json.dumps({"by": "Samuel Toma", "items": {"g10m8s3-2:Ex8-6:33a": {"verdict": "accept", "by": "Samuel Toma"}}}))
            runf = root / "run.json"
            runf.write_text(json.dumps(run_of([compound()])))
            with mock.patch.object(apg, "HERE", root), redirect_stderr(io.StringIO()) as err:
                with self.assertRaises(SystemExit):
                    apg.main(["g2", "g10-math", "--chapter", "1", "--lesson-run", str(runf), "--gates-dir", str(root / "gates")])
            self.assertIn("--into", err.getvalue())
            self.assertEqual(json.loads(pilot.read_text())["items"].keys(), {"g10m8s3-2:Ex8-6:33a"}, "the pilot's file is untouched")

    def test_g2_into_its_own_file_records_the_gate_and_splits_with_the_same_maths(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            own = root / "runs" / "g10-math" / "maths" / "book" / "accepted.json"
            own.parent.mkdir(parents=True)
            own.write_text("{}")
            runf = root / "run.json"
            runf.write_text(json.dumps(run_of([compound(), item("Ex1-1:4a")])))
            into = root / "runs" / "g10-math" / "g2-ch01.json"
            seen = []
            with mock.patch.object(apg, "HERE", root), mock.patch("assemble_objectives.main", lambda argv: seen.append(argv) or 0), \
                    redirect_stdout(io.StringIO()):
                rc = apg.main(["g2", "g10-math", "--chapter", "1", "--lesson-run", str(runf), "--into", str(into), "--split",
                               "--gates-dir", str(root / "gates")])
            self.assertEqual(rc, 0)
            doc = json.loads(into.read_text())
            self.assertEqual(doc["items"]["g10m1s3-1:Ex1-1:4c"]["verdict"], "exclude")
            rec = json.loads((root / "gates" / "g2-ch01.json").read_text())
            self.assertEqual((rec["format"], rec["gate"], rec["id"], rec["auto"]), ("ainext.gate-decision/1", "G2", "g2-ch01", True))
            self.assertTrue(review_policy.is_auto(rec["by"]))
            argv = seen[0]
            self.assertEqual(argv[:3], ["lesson-runs", "g10-math", str(runf)])
            self.assertEqual(argv[argv.index("--g2") + 1], str(into))
            self.assertEqual(argv[argv.index("--maths") + 1], str(own), "the split reads the book's own maths too")


if __name__ == "__main__":
    unittest.main()
