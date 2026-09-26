"""The S5 misconceptions stage (B11): runbook/misconceptions.workflow.js and assemble_misconceptions.py.

    uv run --with pytest python -m pytest -q tests/test_assemble_misconceptions.py

No model is called. The workflow runs in tests/workflow_stub.mjs, a stub of the Workflow runtime
that answers each agent from a fixture (tests/fixtures/misconceptions/s5-*.json) and checks every
answer against the schema the script asked for. The workflow tests are skipped without `node`.

What these prove, for the pipeline half of spec 003 FR-4307 (the G10 catalogue itself does not
exist yet, so no requirement is marked covered here):
  * grounded: an objective with no canonical solution is skipped, never authored from general
    mathematics; the author prompt carries the canonical solutions and the house style;
  * fail closed: only CONFIRMED entries survive; an entry the verifier is silent on, or a verifier
    that returns nothing, is a drop; an attachment it does not confirm loses its tag (FR-1112);
  * one error, one entry: draft ids are carried and never renamed, an S6/S7 id for an existing
    error becomes an alias (FR-1115), at most 4 entries per objective;
  * the assembler writes the load_misconceptions.py shape, refuses drafts and unconfirmed entries,
    and leaves no S6/S7 tag pointing at nothing.
"""

from __future__ import annotations

import copy
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from _scratchdb import EX

import assemble_misconceptions as am

FX = EX / "tests" / "fixtures" / "misconceptions"
STUB = EX / "tests" / "workflow_stub.mjs"
WORKFLOW = EX / "runbook" / "misconceptions.workflow.js"
BOOK = FX / "zz-test.json"
NODE = shutil.which("node")


def fixture(name: str) -> dict:
    return json.loads((FX / name).read_text())


def run_stub(script: Path, args: dict, responses: dict) -> dict:
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump({"args": args, "responses": responses}, f)
    r = subprocess.run([NODE, str(STUB), str(script), f.name], capture_output=True, text=True, timeout=60)
    Path(f.name).unlink()
    if r.returncode != 0:
        raise AssertionError(f"stub crashed: {r.stderr}")
    return json.loads(r.stdout)


def base_args(stage: str) -> dict:
    a = fixture("s5-args.json")
    a.pop("_about")
    a["stage"] = stage
    return a


def draft_run() -> dict:
    out = run_stub(WORKFLOW, base_args("draft"), fixture("s5-draft-responses.json"))
    assert out["ok"], out["error"]
    return out


def final_args(draft_result: dict) -> tuple[dict, dict]:
    f = fixture("s5-final.json")
    a = base_args("final")
    a["draft"] = draft_result
    a["distractors"] = a["distractors"] + f["extra_distractors"]
    return a, f["responses"]


def record(result: dict, lo: str) -> dict:
    return next(r for r in result["records"] if r["lo"] == lo)


@unittest.skipUnless(NODE, "node is needed to run a workflow script in the stub runtime")
class WorkflowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.draft = draft_run()
        a, responses = final_args(cls.draft["result"])
        cls.final = run_stub(WORKFLOW, a, responses)
        assert cls.final["ok"], cls.final["error"]

    def test_meta_is_a_pure_literal_and_phases_match(self):
        titles = {p["title"] for p in self.final["meta"]["phases"]}
        self.assertEqual(titles, {"Author", "Verify"})
        for c in self.draft["calls"] + self.final["calls"]:
            self.assertIn(c["phase"], titles)
            self.assertEqual(c["model"], "sonnet")

    def test_draft_authors_only_and_skips_what_it_cannot_ground(self):
        self.assertEqual([c["label"] for c in self.draft["calls"]], ["author:lo:zz1s1-1-1", "author:lo:zz1s1-1-2"])
        res = self.draft["result"]
        self.assertEqual(res["stage"], "draft")
        skipped = record(res, "lo:zz1s1-1-3")
        self.assertTrue(skipped["skipped"])
        self.assertEqual(skipped["entries"], [])
        e = record(res, "lo:zz1s1-1-1")["entries"]
        self.assertEqual([x["id"] for x in e], ["mc:zz1s1-1-1:exponents-multiplied", "mc:zz1s1-1-1:bases-multiplied"])
        self.assertTrue(all(x["verified"] is False and "verdict" not in x for x in e))
        self.assertEqual(e[0]["maps"], [{"question_id": "q:zz1s1-1-1:ex1-1", "choice_text": "$3^8$"}])
        self.assertEqual(e[0]["kind"], "book_distractor")
        self.assertEqual(record(res, "lo:zz1s1-1-2")["flags"][0]["kind"], "terminology")

    def test_author_prompt_is_grounded_in_the_book(self):
        p = next(c["prompt"] for c in self.draft["calls"] if c["label"] == "author:lo:zz1s1-1-1")
        self.assertIn("Same base, so add the exponents: $3^{2+4} = 3^6$.", p)   # the canonical solution
        self.assertIn("[caution b:zz1s1:caution-1 p.12]", p)                    # the book's own evidence
        self.assertIn("Step 1 ALWAYS names what the student was thinking WITHOUT calling it stupid", p)
        self.assertIn("The LAST step ALWAYS leaves the student with the move that works", p)
        self.assertIn("never solve anything the book has not solved", p)
        self.assertIn("at most 4 new entries", p)

    def test_verifier_is_a_different_agent_and_sees_the_canonical_solutions(self):
        v = next(c for c in self.final["calls"] if c["label"] == "verify:lo:zz1s1-1-1")
        self.assertIn("You are a DIFFERENT teacher", v["prompt"])
        self.assertIn("Same base, so add the exponents", v["prompt"])
        self.assertNotIn("verify:lo:zz1s1-1-3", [c["label"] for c in self.final["calls"]])

    def test_final_is_fail_closed(self):
        r = record(self.final["result"], "lo:zz1s1-1-1")
        kept = {e["id"]: e for e in r["entries"]}
        self.assertEqual(set(kept), {"mc:zz1s1-1-1:exponents-multiplied", "mc:zz1s1-1-1:exponents-subtracted",
                                     "mc:zz1s1-1-1:different-bases-added"})
        self.assertTrue(all(e["verdict"]["verdict"] == "CONFIRMED" for e in kept.values()))
        self.assertEqual([(d["id"], d["verdict"]) for d in r["dropped"]], [("mc:zz1s1-1-1:bases-multiplied", "UNSUPPORTED")])
        stripped = {(s["origin"], s["text"]): s["reason"] for s in r["stripped"]}
        self.assertIn(("book", "$9^6$"), stripped)                 # its entry was dropped
        self.assertIn(("S6", "(a*a)^(m+n)"), stripped)             # merged into the dropped entry
        self.assertIn(("S6", "a^(n-m)"), stripped)                 # confirmed entry, attachment not
        self.assertIn(("S6", "a^(m+n+2)"), stripped)               # no named error
        # a signal the verifier could not confirm is removed, not shipped
        self.assertIsNone(kept["mc:zz1s1-1-1:exponents-subtracted"]["signal"])
        self.assertEqual(kept["mc:zz1s1-1-1:exponents-subtracted"]["kind"], "conceptual")

    def test_one_error_one_entry(self):
        r = record(self.final["result"], "lo:zz1s1-1-1")
        em = next(e for e in r["entries"] if e["id"] == "mc:zz1s1-1-1:exponents-multiplied")
        # the draft id is carried, never renamed; S6's own id for the same error folds in as an alias
        self.assertEqual(em["aliases"], ["mc:zz1s1-1-1:times-the-exponents"])
        self.assertEqual(em["kind"], "book_distractor")
        self.assertEqual(em["maps"], [{"question_id": "q:zz1s1-1-1:ex1-1", "choice_text": "$3^8$"}])
        # a proposed id that is well formed and free is adopted rather than minted anew
        self.assertIn("mc:zz1s1-1-1:exponents-subtracted", {e["id"] for e in r["entries"]})
        # the author wrote three new entries with room for two: the third is dropped and said so
        self.assertTrue(any("capacity 2" in n for n in r["notes"]))
        self.assertLessEqual(len(r["entries"]) + len(r["dropped"]), 4)

    def test_no_author_call_when_nothing_is_open(self):
        labels = [c["label"] for c in self.final["calls"]]
        self.assertNotIn("author:lo:zz1s1-1-2", labels)
        self.assertIn("verify:lo:zz1s1-1-2", labels)
        e = record(self.final["result"], "lo:zz1s1-1-2")["entries"]
        self.assertEqual([x["kind"] for x in e], ["generated_distractor"])

    def test_verifier_silence_is_a_drop(self):
        a, responses = final_args(self.draft["result"])
        responses = copy.deepcopy(responses)
        responses["verify:lo:zz1s1-1-2"] = None                    # the verifier died
        v = responses["verify:lo:zz1s1-1-1"]["verdicts"]
        responses["verify:lo:zz1s1-1-1"]["verdicts"] = [x for x in v if x["id"] != "mc:zz1s1-1-1:different-bases-added"]
        out = run_stub(WORKFLOW, a, responses)
        self.assertTrue(out["ok"], out["error"])
        r2 = record(out["result"], "lo:zz1s1-1-2")
        self.assertEqual(r2["entries"], [])
        self.assertEqual([d["verdict"] for d in r2["dropped"]], ["NO_VERDICT"])
        r1 = record(out["result"], "lo:zz1s1-1-1")
        self.assertIn(("mc:zz1s1-1-1:different-bases-added", "NO_VERDICT"), [(d["id"], d["verdict"]) for d in r1["dropped"]])

    def test_the_cap_is_never_above_four(self):
        a = base_args("draft")
        a["max_per_objective"] = 9
        out = run_stub(WORKFLOW, a, fixture("s5-draft-responses.json"))
        self.assertEqual(out["result"]["max_per_objective"], 4)

    def test_bad_args_refuse_before_any_agent(self):
        for mutate, msg in [
            (lambda a: a.update(language="ar"), "not supported yet"),
            (lambda a: a.update(stage="both"), "args.stage"),
            (lambda a: a.pop("book"), "args.book"),
            (lambda a: a.update(objectives=[]), "args.objectives"),
            (lambda a: a["distractors"].append({"lo": "lo:zz1s1-1-1", "origin": "book", "text": "x"}), "question_id"),
        ]:
            a = base_args("draft")
            mutate(a)
            out = run_stub(WORKFLOW, a, {})
            with self.subTest(msg):
                self.assertFalse(out["ok"])
                self.assertIn(msg, out["error"])
                self.assertEqual(out["calls"], [])

    def test_the_retired_refutation_workflow_refuses(self):
        out = run_stub(EX / "runbook" / "refutation.workflow.js", {}, {})
        self.assertFalse(out["ok"])
        self.assertIn("RETIRED", out["error"])
        self.assertEqual(out["calls"], [])


@unittest.skipUnless(NODE, "node is needed to produce the final run from the fixtures")
class AssemblerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        draft = draft_run()
        a, responses = final_args(draft["result"])
        final = run_stub(WORKFLOW, a, responses)
        assert final["ok"], final["error"]
        cls.draft_result = draft["result"]
        cls.final_result = final["result"]

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="s5_"))
        self.run_path = self.write("final-run.json", self.final_result)
        self.s6 = self.write("s6.json", fixture("s6-generated.json"))
        self.s7 = self.write("s7.json", fixture("s7-widgets.json"))
        self.out = self.tmp / "out" / "misconceptions.json"

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def write(self, name: str, obj: dict) -> Path:
        p = self.tmp / name
        p.write_text(json.dumps(obj, ensure_ascii=False))
        return p

    def assemble(self, *runs: Path, bundles=(), extra=()) -> int:
        argv = [str(r) for r in runs] + ["--book", str(BOOK), "--out", str(self.out)]
        for b in bundles:
            argv += ["--bundle", str(b)]
        return am.main(argv + list(extra))

    def test_writes_the_loader_shape(self):
        self.assertEqual(self.assemble(self.run_path, bundles=(self.s6, self.s7)), 0)
        cat = json.loads(self.out.read_text())
        self.assertEqual(cat["course_id"], "course:zz-test-en")
        self.assertIs(cat["reviewed"], False)
        self.assertIn("UNREVIEWED", cat["generator"])
        ids = [m["id"] for m in cat["misconceptions"]]
        self.assertEqual(ids, ["mc:zz1s1-1-1:different-bases-added", "mc:zz1s1-1-1:exponents-multiplied",
                               "mc:zz1s1-1-1:exponents-subtracted", "mc:zz1s1-1-2:exponents-added"])
        for m in cat["misconceptions"]:
            self.assertTrue(set(am.LOADER_KEYS) <= set(m))
            self.assertEqual(m["provenance"]["verdict"], "CONFIRMED")
        self.assertEqual(am.validate_catalogue(cat, max_per_objective=4), [])

    def test_bundles_are_left_with_no_tag_pointing_at_nothing(self):
        self.assertEqual(self.assemble(self.run_path, bundles=(self.s6, self.s7)), 0)
        cat = {m["id"]: m for m in json.loads(self.out.read_text())["misconceptions"]}
        g = {q["id"]: {c["key"]: c.get("misconception_id") for c in q["choices"]}
             for q in json.loads(self.s6.read_text())["questions"]}
        em = "mc:zz1s1-1-1:exponents-multiplied"
        self.assertEqual(g["q:zz1s1-1-1:g001-product"], {"A": None, "B": em, "C": None, "D": None})
        self.assertEqual(g["q:zz1s1-1-1:g002-product"], {"A": None, "B": em, "C": None, "D": None})
        self.assertEqual(g["q:zz1s1-1-1:g003-product2"]["B"], em)          # alias rewritten
        s6 = json.loads(self.s6.read_text())
        self.assertEqual([m["id"] for m in s6["misconceptions"]], [em])    # no unverified row declared
        w = json.loads(self.s7.read_text())["questions"][0]["choices"]["diagnostics"]
        self.assertEqual(w, [{"predicate": "exponents-added", "misconception_id": "mc:zz1s1-1-2:exponents-added"}])
        for mid in [em, "mc:zz1s1-1-2:exponents-added"]:
            self.assertIn(mid, cat)

    def test_a_draft_is_never_loadable(self):
        p = self.write("draft.json", self.draft_result)
        self.assertEqual(self.assemble(p), 1)
        self.assertFalse(self.out.exists())

    def test_an_unconfirmed_entry_is_dropped_even_if_the_file_kept_it(self):
        run = copy.deepcopy(self.final_result)
        e = record(run, "lo:zz1s1-1-1")["entries"][0]
        e["verdict"] = {"verdict": "UNCLEAR", "reason": "tampered"}
        cat, dropped, _, problems = am.assemble([self.write("t.json", run)], str(BOOK))
        self.assertEqual(problems, [])
        self.assertNotIn(e["id"], {m["id"] for m in cat["misconceptions"]})
        self.assertIn(e["id"], {d["id"] for d in dropped})

    def test_a_widget_left_without_a_diagnostic_refuses_everything(self):
        s7 = json.loads(self.s7.read_text())
        s7["questions"].append({
            "id": "q:zz1s1-1-1:w001", "lo_id": "lo:zz1s1-1-1", "tier": "basic", "question_type": "widget",
            "stem": "Build it.", "correct_answer": "ok", "canonical_solution": [{"step": 1, "text_md": "x"}],
            "choices": {"kind": "power_builder", "spec": {},
                        "diagnostics": [{"predicate": "bases-multiplied", "misconception_id": "mc:zz1s1-1-1:bases-multiplied"}]}})
        before = json.dumps(s7)
        p = self.write("s7b.json", s7)
        self.assertEqual(self.assemble(self.run_path, bundles=(self.s6, p)), 1)
        self.assertFalse(self.out.exists())
        self.assertEqual(p.read_text(), json.dumps(s7, ensure_ascii=False))
        self.assertEqual(before, json.dumps(s7))

    def test_a_widget_whose_mappings_are_all_held_is_reconciled_not_refused(self):
        # decision 47: held mappings follow the catalogue (aliases rewritten, unknown ids dropped); a widget with
        # only held mappings ships as right/wrong — it is refused only when nothing, active or held, is left
        s7 = json.loads(self.s7.read_text())
        ch = s7["questions"][0]["choices"]
        ch["pending_review"] = ch.pop("diagnostics") + [
            {"predicate": "bases-multiplied", "misconception_id": "mc:zz1s1-1-1:not-in-any-catalogue", "why": "…"}]
        ch["diagnostics"] = []
        p = self.write("s7held.json", s7)
        self.assertEqual(self.assemble(self.run_path, bundles=(self.s6, p)), 0)
        got = json.loads(p.read_text())["questions"][0]["choices"]
        self.assertEqual(got["diagnostics"], [])
        self.assertEqual([h["misconception_id"] for h in got["pending_review"]], ["mc:zz1s1-1-2:exponents-added"])

    def test_an_unfit_item_no_bundle_carries_refuses(self):
        # without the S6 bundle, the unfit a^(n-m) attachment cannot be stripped anywhere
        self.assertEqual(self.assemble(self.run_path, bundles=(self.s7,)), 1)
        self.assertFalse(self.out.exists())

    def test_a_widget_may_lean_on_a_prerequisite_only_with_the_graph(self):
        s7 = json.loads(self.s7.read_text())
        s7["questions"][0]["choices"]["diagnostics"].append(
            {"predicate": "product-rule", "misconception_id": "mc:zz1s1-1-1:exponents-multiplied"})
        p = self.write("s7c.json", s7)
        self.assertEqual(self.assemble(self.run_path, bundles=(self.s6, p)), 1)   # no --graph: cannot check
        graph = self.write("graph.json", {"edges": [{"src": "lo:zz1s1-1-1", "dst": "lo:zz1s1-1-2", "type": "prerequisite_of"}]})
        self.assertEqual(self.assemble(self.run_path, bundles=(self.s6, p), extra=["--graph", str(graph)]), 0)
        diags = json.loads(p.read_text())["questions"][0]["choices"]["diagnostics"]
        self.assertIn("mc:zz1s1-1-1:exponents-multiplied", [d["misconception_id"] for d in diags])

    def test_one_run_per_objective(self):
        a = self.write("a.json", self.final_result)
        cat, _, _, problems = am.assemble([self.run_path, a], str(BOOK))
        self.assertTrue(any("pass one run per objective" in p for p in problems))

    def test_catalogue_rules(self):
        good = json.loads(json.dumps({"misconceptions": [
            {"id": "mc:zz1s1-1-1:a", "lo_id": "lo:zz1s1-1-1", "label": "A", "description": "d", "signal": None,
             "kind": "conceptual", "refutation": [{"step": 1, "text_md": "x"}, {"step": 2, "text_md": "y"}],
             "maps": [], "aliases": []}]}))
        book = am.book_config.load_book(str(BOOK))
        self.assertEqual(am.validate_catalogue(good, max_per_objective=4, book=book), [])

        def bad(**change):
            b = copy.deepcopy(good)
            b["misconceptions"][0].update(change)
            return am.validate_catalogue(b, max_per_objective=4, book=book)

        self.assertTrue(bad(id="mc:zz1s1-1-2:a"))                        # not its own objective
        self.assertTrue(bad(id="misc:zz1s1-1-1:a"))                      # the retired prefix
        self.assertTrue(bad(lo_id="lo:g10m1s1-1-1", id="mc:g10m1s1-1-1:a"))  # not this book's
        self.assertTrue(bad(refutation=[{"step": 1, "text_md": "only one"}]))
        self.assertTrue(bad(kind="book_distractor"))                     # with no map
        self.assertTrue(bad(aliases=["mc:zz1s1-1-1:a"]))                 # an alias that is a live id
        five = copy.deepcopy(good)
        five["misconceptions"] = [dict(good["misconceptions"][0], id=f"mc:zz1s1-1-1:e{i}", label=f"L{i}") for i in range(5)]
        self.assertTrue(am.validate_catalogue(five, max_per_objective=4))
        twins = copy.deepcopy(good)
        twins["misconceptions"].append(dict(good["misconceptions"][0], id="mc:zz1s1-1-1:b"))
        self.assertTrue(any("share the label" in p for p in am.validate_catalogue(twins)))


if __name__ == "__main__":
    unittest.main()


class S5ArgsFromTheLine(unittest.TestCase):
    """--s5-args builds the workflow's args from the assembled bundles and lesson runs, so S5 is
    never hand-stitched (the dry run's missing link)."""

    def test_objectives_questions_sources_and_book_distractors_come_from_the_line(self):
        import assemble_lesson_bundle as alb
        import book_config
        fix = Path(__file__).resolve().parent / "fixtures" / "g10-math"
        book = book_config.load_book("g10-math")
        bundles, _ = alb.assemble(book, fix / "manifest.json", fix / "objectives", fix / "runs" / "lesson")
        runs = [json.loads(p.read_text()) for p in sorted((fix / "runs" / "lesson").glob("*.json"))]
        # a disagreement is a student's error only once G2 kept the book's answer and the re-solve really
        # differed (the Chapter 8 S5 draft): unreviewed, it is not evidence yet
        disputed = [it for r in runs for it in r["items"] if it.get("verification") == "disputed" and it.get("blind_answer")]
        self.assertTrue(disputed)
        self.assertNotIn("resolve_disagreement", {s["kind"] for s in am.s5_args(book, list(bundles.values()), runs, "draft")["sources"]})
        for it in disputed:
            it["g2"] = {"verdict": "accept", "by": "Samuel"}
            it["verify"] = {"pairs": [{"pair_id": f"{it['ref']}|blind~printed", "verdict": "different"}]}
        a = am.s5_args(book, list(bundles.values()), runs, "draft")
        self.assertEqual(a["stage"], "draft")
        self.assertEqual(len(a["objectives"]),
                         sum(1 for b in bundles.values() for n in b["nodes"] if n["kind"] == "learning_objective"))
        self.assertTrue(all(q["canonical_solution"] for q in a["questions"]))
        kinds = {s["kind"] for s in a["sources"]}
        self.assertIn("resolve_disagreement", kinds, "a three-way disagreement is evidence of an error")
        dis = next(s for s in a["sources"] if s["kind"] == "resolve_disagreement")
        self.assertIn(dis["ref"], {q["id"] for q in a["questions"]}, "it names the held question's real id")
        self.assertTrue(all(d["origin"] == "book" for d in a["distractors"]))
        with self.assertRaises(SystemExit):
            am.s5_args(book, list(bundles.values()), runs, "final")
