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

    # ---- the two passes (the Chapter 1 deadlock): the bundles are generated FROM the catalogue ----------------
    def real_format(self) -> dict:
        """The final run as the real generators' refusals read: S6 `ref` = `<family>#<tagged error>`, S7 `ref` =
        `<template>#<predicate name>` and `text` the predicate's MEANING (not its name)."""
        run = copy.deepcopy(self.final_result)
        for r in run["records"]:
            for st in r.get("stripped") or []:
                if st["origin"] == "S6" and st.get("tagged"):
                    st["ref"] = f"{st['ref']}#{st['tagged']}"
                elif st["origin"] == "S7":
                    st["ref"] = f"{st['ref']}#{st['text']}"
                    st["text"] = "The base is changed: the contract's sentence for this predicate, not its name"
        return run

    def test_a_refused_attachment_no_bundle_carries_refuses_unless_this_is_the_catalogue_pass(self):
        self.assertEqual(self.assemble(self.run_path), 1)          # no flag: as strict as ever
        self.assertFalse(self.out.exists())
        self.assertEqual(self.assemble(self.run_path, extra=["--catalogue-only"]), 0)
        cat = json.loads(self.out.read_text())
        self.assertEqual(am.validate_catalogue(cat, max_per_objective=4), [])
        self.assertEqual(json.loads(self.s6.read_text()), fixture("s6-generated.json"))   # no bundle is touched

    def test_the_catalogue_pass_takes_no_bundle_and_keeps_every_rule_on_the_entries(self):
        with self.assertRaises(SystemExit):
            self.assemble(self.run_path, bundles=(self.s6,), extra=["--catalogue-only"])
        # a draft is still never loadable, an unconfirmed entry still dropped: only the bundle check is deferred
        p = self.write("draft.json", self.draft_result)
        self.assertEqual(self.assemble(p, extra=["--catalogue-only"]), 1)
        self.assertFalse(self.out.exists())
        run = copy.deepcopy(self.final_result)
        record(run, "lo:zz1s1-1-1")["entries"][0]["refutation"] = [{"step": 1, "text_md": "only one step"}]
        self.assertEqual(self.assemble(self.write("short.json", run), extra=["--catalogue-only"]), 1)

    def test_the_bundle_pass_after_the_catalogue_pass_strips_what_was_deferred(self):
        self.assertEqual(self.assemble(self.run_path, extra=["--catalogue-only"]), 0)
        first = self.out.read_bytes()
        self.assertEqual(self.assemble(self.run_path, bundles=(self.s6, self.s7)), 0)
        self.assertEqual(self.out.read_bytes(), first)              # the same catalogue both times
        d = {c["key"]: c.get("misconception_id") for c in json.loads(self.s6.read_text())["questions"][0]["choices"]}
        self.assertIsNone(d["D"])                                   # the refused a^(n-m) option lost its tag
        # and it is still the bundle pass that refuses when it cannot strip
        self.assertEqual(self.assemble(self.run_path, bundles=(self.s7,)), 1)

    def test_real_refs_are_matched_by_family_and_by_predicate_name(self):
        # before: `_in_family` compared the whole `family#error` ref with the bundle's family, and an S7 record's
        # `text` (the predicate's meaning) with the predicate's name — neither ever matched real data
        run = self.write("real.json", self.real_format())
        self.assertEqual(self.assemble(run, extra=["--catalogue-only"]), 0)
        self.assertEqual(self.assemble(run, bundles=(self.s6, self.s7)), 0)
        em = "mc:zz1s1-1-1:exponents-multiplied"
        g = {q["id"]: {c["key"]: c.get("misconception_id") for c in q["choices"]}
             for q in json.loads(self.s6.read_text())["questions"]}
        self.assertEqual(g["q:zz1s1-1-1:g001-product"], {"A": None, "B": em, "C": None, "D": None})
        w = json.loads(self.s7.read_text())["questions"][0]["choices"]["diagnostics"]
        self.assertEqual(w, [{"predicate": "exponents-added", "misconception_id": "mc:zz1s1-1-2:exponents-added"}])

    def test_a_predicate_is_stripped_only_in_the_template_the_refusal_names(self):
        run = self.write("real.json", self.real_format())
        s7 = json.loads(self.s7.read_text())
        other = copy.deepcopy(s7["questions"][0])
        other.update({"id": "q:zz1s1-1-2:w002", "family": "tpl:zz1s1-1-2:another-template"})
        s7["questions"].append(other)
        s7["questions"][0]["family"] = "tpl:zz1s1-1-2:power-builder"
        p = self.write("s7two.json", s7)
        self.assertEqual(self.assemble(run, bundles=(self.s6, p)), 0)
        got = {q["id"]: [d["predicate"] for d in q["choices"]["diagnostics"]]
               for q in json.loads(p.read_text())["questions"]}
        self.assertEqual(got["q:zz1s1-1-2:w001"], ["exponents-added"])                       # the named template
        self.assertEqual(got["q:zz1s1-1-2:w002"], ["exponents-added", "base-changed"])       # another template's own

    def test_a_second_bundle_pass_is_a_no_op_and_the_stamp_is_the_only_excuse(self):
        run = self.write("real.json", self.real_format())
        self.assertEqual(self.assemble(run, bundles=(self.s6, self.s7)), 0)
        once = (self.s6.read_bytes(), self.s7.read_bytes(), self.out.read_bytes())
        self.assertEqual(json.loads(self.s6.read_text())["s5_reconciled"]["runs"], ["real.json"])
        self.assertEqual(self.assemble(run, bundles=(self.s6, self.s7)), 0)
        self.assertEqual((self.s6.read_bytes(), self.s7.read_bytes(), self.out.read_bytes()), once)
        # a bundle that carries no stamp cannot prove its strips: refused, never assumed
        doc = json.loads(self.s6.read_text())
        del doc["s5_reconciled"]
        self.s6.write_text(json.dumps(doc))
        self.assertEqual(self.assemble(run, bundles=(self.s6, self.s7)), 1)
        # and a stamp of ANOTHER run excuses nothing
        doc["s5_reconciled"] = {"runs": ["another-run.json"], "refused_attachments_stripped": [
            list(am._unfit_key(u)) for u in am.assemble([run], str(BOOK))[2]]}
        self.s6.write_text(json.dumps(doc))
        self.assertEqual(self.assemble(run, bundles=(self.s6, self.s7)), 1)

    def widget_only_unfit(self) -> Path:
        s7 = json.loads(self.s7.read_text())
        s7["questions"][0]["choices"]["diagnostics"] = [
            {"predicate": "base-changed", "misconception_id": "mc:zz1s1-1-2:exponents-added"}]
        s7["questions"][0]["family"] = "tpl:zz1s1-1-2:power-builder"
        s7["templates"] = {"tpl:zz1s1-1-2:power-builder": "sha-1"}
        return self.write("s7only.json", s7)

    def gap_files(self) -> tuple[Path, Path]:
        graph = self.write("g.json", {"edges": [{"src": "module:zz1", "dst": "lo:zz1s1-1-2", "type": "teaches"}]})
        gaps = self.write("gaps.json", {
            "format": "ainext.widget-gaps/1", "book": "zz-test", "uncovered_chapters": [], "proposed_kinds": {},
            "chapters": [{"module": "module:zz1", "label": "One", "status": "covered", "widgets": 1,
                          "kinds": ["power_builder"], "objectives_with_widgets": ["lo:zz1s1-1-2"], "gaps": 0}],
            "gaps": []})
        return graph, gaps

    def test_a_widget_left_with_no_diagnostic_is_left_out_and_recorded_only_when_asked(self):
        run = self.write("real.json", self.real_format())
        p = self.widget_only_unfit()
        graph, gaps = self.gap_files()
        # by default it is still an error, and the message names the way out
        self.assertEqual(self.assemble(run, bundles=(self.s6, p), extra=["--graph", str(graph)]), 1)
        self.assertFalse(self.out.exists())
        before = gaps.read_text()
        # the flag needs somewhere to record, and a module to record it under
        with self.assertRaises(SystemExit):
            self.assemble(run, bundles=(self.s6, p), extra=["--graph", str(graph), "--drop-undiagnosed-widgets"])
        with self.assertRaises(SystemExit):
            self.assemble(run, bundles=(self.s6, p), extra=["--drop-undiagnosed-widgets", "--widget-gaps", str(gaps)])
        with self.assertRaises(SystemExit):
            self.assemble(run, bundles=(self.s6, p), extra=["--graph", str(graph), "--drop-undiagnosed-widgets",
                                                            "--widget-gaps", str(self.tmp / "missing.json")])
        self.assertEqual(gaps.read_text(), before)
        extra = ["--graph", str(graph), "--drop-undiagnosed-widgets", "--widget-gaps", str(gaps)]
        # --check reports and writes nothing
        self.assertEqual(self.assemble(run, bundles=(self.s6, p), extra=extra + ["--check"]), 0)
        self.assertEqual(gaps.read_text(), before)
        self.assertEqual(self.assemble(run, bundles=(self.s6, p), extra=extra), 0)
        bundle = json.loads(p.read_text())
        self.assertEqual(bundle["questions"], [])                                   # never shipped
        self.assertEqual(bundle["templates"], {})
        self.assertIn("tpl:zz1s1-1-2:power-builder", bundle["rejected_templates"])
        self.assertEqual(bundle["s5_reconciled"]["widgets_left_out"], ["q:zz1s1-1-2:w001"])
        rep = json.loads(gaps.read_text())
        (gap,) = rep["gaps"]
        self.assertEqual((gap["module"], gap["lo_id"], gap["need_kind"], gap["signed_off"], gap["scope"]),
                         ("module:zz1", "lo:zz1s1-1-2", "no-diagnostic", None, "chapter"))
        self.assertIn("mc:zz1s1-1-2:exponents-added", gap["why"])
        self.assertEqual(rep["uncovered_chapters"], ["module:zz1"])                 # no widget left: a human signs it
        self.assertEqual((rep["chapters"][0]["status"], rep["chapters"][0]["widgets"], rep["chapters"][0]["gaps"]),
                         ("gap", 0, 1))
        self.assertEqual(rep["proposed_kinds"], {})                                 # no new kind is proposed from it
        # a rerun changes nothing and records nothing twice
        self.assertEqual(self.assemble(run, bundles=(self.s6, p), extra=extra), 0)
        self.assertEqual(json.loads(gaps.read_text()), rep)

    def test_a_problem_elsewhere_writes_neither_the_bundle_nor_the_gap_report(self):
        run = self.write("real.json", self.real_format())
        p = self.widget_only_unfit()
        graph, gaps = self.gap_files()
        s6 = json.loads(self.s6.read_text())
        s6["questions"][0]["choices"][1]["misconception_id"] = "mc:zz1s1-1-2:a-stranger"   # another objective's entry
        before = (p.read_text(), gaps.read_text())
        extra = ["--graph", str(graph), "--drop-undiagnosed-widgets", "--widget-gaps", str(gaps)]
        # an unfit item that no bundle carries (S6 not passed) is a problem: nothing is written
        self.assertEqual(self.assemble(run, bundles=(p,), extra=extra), 1)
        self.assertEqual((p.read_text(), gaps.read_text()), before)
        self.assertFalse(self.out.exists())

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


class WhatAStudentReads(unittest.TestCase):
    """Consistency review 2026-09-27, A5: 9 of the Chapter 8 pilot's 29 refutations carried the pipeline's own
    bookkeeping — question ids, figures of other questions cited by id, a page number, and Samuel's G2 notes and
    corrections presented as "the book's own". The catalogue refuses them (leak_problems, every catalogue), a fix
    is a pipeline normalisation beside the run (who, why, fail-closed on the exact text), and the S5 prompt
    (s5-v5) forbids them in both agents' prompts. No node needed."""

    ENTRY = {"id": "mc:zz1s1-1-1:a", "lo_id": "lo:zz1s1-1-1", "label": "Flips a sign", "description": "d",
             "signal": None, "kind": "conceptual", "maps": [], "aliases": [], "sources": [], "covers": [],
             "refutation": [{"step": 1, "text_md": "You kept the size and changed the sign."},
                            {"step": 2, "text_md": "Take $q:zz1s1-1-1:ex8-1-4$: the point is at $(-4, -3)$."}],
             "verdict": {"verdict": "CONFIRMED", "reason": "ok"}}

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="s5_leak_"))
        self.run = self.tmp / "final-wf_x.json"
        self.run.write_text(json.dumps({"stage": "final", "book": "zz-test",
                                        "records": [{"lo": "lo:zz1s1-1-1", "entries": [copy.deepcopy(self.ENTRY)]}]}))

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def sidecar(self, **patch):
        p = {"id": "mc:zz1s1-1-1:a", "field": "refutation step 2", "by": "pipeline (test)", "why": "an id",
             "from": self.ENTRY["refutation"][1]["text_md"],
             "to": "Say the point you want is at $(-4, -3)$."}
        p.update(patch)
        am.normalisations_path(self.run).write_text(json.dumps(
            {"format": am.NORMALISATIONS_FORMAT, "run": self.run.name, "patches": [p]}))

    def test_the_pilots_nine_kinds_of_leak_are_refused(self):
        for text in ("Take $q:g10m8s1-1-2:ex8-1-4$: the point you want is at $(-4, -3)$.",
                     "In ex8-1-6, shape Y opens exactly like that",
                     "in every one of its naming questions (ex8-1-5, ex8-1-6, ex8-6-3)",
                     "In Ex8-6:21c, AB is parallel to DC",
                     "the worked example on page 310 tells you to check",
                     "as p. 303 shows",
                     "The book's own review note on 42e makes the same point",
                     "a careful re-solve of this equation had to be corrected back to 'no value of $k$'",
                     "Samuel's approved correction appends a line",
                     "see Figure 8.3"):
            self.assertTrue(am.leak_problems(text), text)

    def test_ordinary_teaching_text_is_not_a_leak(self):
        for text in ("$m_{AB}\\times m_{CD}=3\\times3=9$, nowhere near $-1$",
                     "the ratio $p:q$ stays the same, and so does $q:r$",
                     "The diagram of $FGHI$ shows sides that look parallel",
                     "Look at the graph: point $G_1$ sits above $G_2$",
                     "the book's worked example tells you to check against a quick sketch",
                     "Expand $(x+2)(x-3)$ and look at the next term"):
            self.assertEqual(am.leak_problems(text), [], text)

    def test_every_catalogue_refuses_a_leak(self):
        cat = {"misconceptions": [am.to_loader_shape(dict(copy.deepcopy(self.ENTRY), _run="r"))]}
        problems = am.validate_catalogue(cat)
        self.assertTrue(any("internal id" in p and "refutation step 2" in p for p in problems), problems)
        self.assertTrue(any("book item reference 'ex8-1-4'" in p for p in problems), problems)
        live = json.loads((EX / "seed" / "generated" / "misconceptions.json").read_text())
        self.assertEqual([p for p in am.validate_catalogue(live, new_ids=set()) if "a student reads this" in p], [],
                         "the Prep-3 catalogue carries no bookkeeping")

    def test_without_its_normalisation_the_run_is_refused(self):
        cat, _, _, problems = am.assemble([self.run], str(BOOK))
        self.assertTrue(any("internal id" in p for p in problems), problems)

    def test_a_normalisation_patches_the_text_and_says_who_and_why(self):
        self.sidecar()
        cat, _, _, problems = am.assemble([self.run], str(BOOK))
        self.assertEqual(problems, [])
        (m,) = cat["misconceptions"]
        self.assertEqual(m["refutation"][1]["text_md"], "Say the point you want is at $(-4, -3)$.")
        (n,) = m["provenance"]["normalisations"]
        self.assertEqual((n["field"], n["by"], n["why"]), ("refutation step 2", "pipeline (test)", "an id"))
        self.assertIn("PIPELINE NORMALISATION", cat["generator"])
        saved = json.loads(self.run.read_text())
        self.assertIn("q:zz1s1-1-1", saved["records"][0]["entries"][0]["refutation"][1]["text_md"],
                      "the saved run is never modified")

    def test_a_normalisation_is_fail_closed(self):
        for bad, why in (({"from": "some other text"}, "is not the run's text"),
                         ({"by": ""}, "missing ['by']"),
                         ({"field": "refutation step 9"}, "no refutation step 9"),
                         ({"field": "maps"}, "field must be"),
                         ({"id": "mc:zz1s1-1-1:nope"}, "not a CONFIRMED entry")):
            self.sidecar(**bad)
            _, _, _, problems = am.assemble([self.run], str(BOOK))
            self.assertTrue(any(why in p for p in problems), (bad, problems))


@unittest.skipUnless(NODE, "node runs the workflow through the stub runtime")
class S5PromptRule(unittest.TestCase):
    def test_both_agents_are_told_what_a_student_must_not_read(self):
        draft = draft_run()
        a, responses = final_args(draft["result"])
        out = run_stub(WORKFLOW, a, responses)
        self.assertTrue(out["ok"], out.get("error"))
        self.assertEqual(out["result"]["prompts_version"], "s5-v5")
        author = next(c["prompt"] for c in draft["calls"] if c["label"].startswith("author:"))
        verify = next(c["prompt"] for c in out["calls"] if c["label"].startswith("verify:"))
        self.assertIn("carries no question\n  ids, page numbers, figure references the student can't see, or review history", author)
        self.assertIn("NOT\nthe book's", author)
        self.assertIn("An entry is also UNSUPPORTED when", verify)
        self.assertIn("review history", verify)


class AliasesThatMustNotFold(unittest.TestCase):
    """Chapter 5 S5-final: the author listed `mc:g10m5s3-1-2:reads-sides-from-other-angle` — a live, CONFIRMED entry of
    ANOTHER objective — as an alias of `mc:g10m5s8-1-3:swapped-coordinates`. Folding an alias deletes its row, so the
    assembler refused the whole run; and a saved run cannot be hand-edited (the advance driver re-saves it from the
    workflow's output every time). It now STRIPS that one link, with a warning, and refuses everything else as before.
    No node needed: the runs are built by hand."""

    A = "mc:zz1s1-1-1:exponents-multiplied"      # objective 1
    A2 = "mc:zz1s1-1-1:exponents-subtracted"     # another entry of objective 1
    B = "mc:zz1s1-1-2:exponents-added"           # objective 2 (the "other angle")

    @staticmethod
    def entry(mid: str, lo: str, label: str, aliases=()) -> dict:
        return {"id": mid, "lo_id": lo, "label": label, "description": f"{label}, described.", "signal": None,
                "kind": "conceptual", "maps": [], "aliases": list(aliases), "sources": [], "covers": [],
                "refutation": [{"step": 1, "text_md": "You did one thing."}, {"step": 2, "text_md": "Do the other."}],
                "verdict": {"verdict": "CONFIRMED", "reason": "ok"}}

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="s5_alias_"))
        self.out = self.tmp / "out" / "misconceptions.json"

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def run_with(self, a_aliases=(), b_aliases=(), with_a2=False, a2_aliases=()) -> Path:
        o1 = [self.entry(self.A, "lo:zz1s1-1-1", "Multiplies the exponents", a_aliases)]
        if with_a2:
            o1.append(self.entry(self.A2, "lo:zz1s1-1-1", "Subtracts the exponents", a2_aliases))
        run = {"stage": "final", "book": "zz-test", "records": [
            {"lo": "lo:zz1s1-1-1", "entries": o1},
            {"lo": "lo:zz1s1-1-2", "entries": [self.entry(self.B, "lo:zz1s1-1-2", "Adds the bases", b_aliases)]}]}
        p = self.tmp / "final-wf_alias.json"
        p.write_text(json.dumps(run))
        return p

    def cat(self, run: Path) -> tuple[dict, list[str]]:
        c, _, _, problems = am.assemble([run], str(BOOK))
        return {m["id"]: m for m in c["misconceptions"]}, problems

    def main(self, run: Path, *extra: str) -> tuple[int, str]:
        import contextlib
        import io
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            rc = am.main([str(run), "--book", str(BOOK), "--out", str(self.out), *extra])
        return rc, buf.getvalue()

    # ---- the case from Chapter 5 ----------------------------------------------------------------------------------
    def test_a_live_entry_of_another_objective_is_stripped_with_a_warning_and_both_entries_survive(self):
        control, problems = self.cat(self.run_with())
        self.assertEqual(problems, [])
        cat, problems = self.cat(self.run_with(a_aliases=[self.B]))
        self.assertEqual(problems, [], "it used to refuse: alias … is itself a live id")
        self.assertEqual(set(cat), {self.A, self.B}, "no entry is deleted")
        self.assertEqual(cat[self.A]["aliases"], [])
        (st,) = cat[self.A]["provenance"]["aliases_stripped"]
        self.assertEqual(st["alias"], self.B)
        self.assertIn("another objective (lo:zz1s1-1-2)", st["reason"])
        # nothing but the link changed: the entries are exactly what the same run without the alias gives
        for mid in (self.A, self.B):
            kept = {k: v for k, v in cat[mid].items() if k != "provenance"}
            self.assertEqual(kept, {k: v for k, v in control[mid].items() if k != "provenance"})
        self.assertNotIn("aliases_stripped", cat[self.B]["provenance"])
        # and the stripped catalogue passes the strict validator that refused it
        self.assertEqual(am.validate_catalogue({"misconceptions": list(cat.values())}, max_per_objective=4), [])

    def test_the_warning_is_printed_recorded_and_the_catalogue_written(self):
        rc, said = self.main(self.run_with(a_aliases=[self.B]))
        self.assertEqual(rc, 0, said)
        self.assertIn(f"WARNING {self.A}: alias {self.B} STRIPPED", said)
        self.assertIn("no entry is deleted or edited", said)
        c = json.loads(self.out.read_text())
        self.assertEqual({m["id"] for m in c["misconceptions"]}, {self.A, self.B})
        self.assertIn("1 ALIAS LINK(S) STRIPPED on 1 entries", c["generator"])
        rc, said = self.main(self.run_with(), "--check")
        self.assertNotIn("WARNING", said)

    def test_a_cross_objective_id_that_is_not_live_is_stripped_too(self):
        # the loader sees the whole database, not this chapter: another objective's id may be a live row there
        cat, problems = self.cat(self.run_with(a_aliases=["mc:zz1s1-1-2:dropped-by-the-verifier"]))
        self.assertEqual(problems, [])
        self.assertEqual(cat[self.A]["aliases"], [])
        self.assertIn("another objective's namespace (lo:zz1s1-1-2)", cat[self.A]["provenance"]["aliases_stripped"][0]["reason"])

    def test_a_live_entry_of_the_same_objective_and_the_entrys_own_id_are_stripped(self):
        cat, problems = self.cat(self.run_with(a_aliases=[self.A2, self.A], with_a2=True))
        self.assertEqual(problems, [])
        self.assertEqual(set(cat), {self.A, self.A2, self.B})
        self.assertEqual(cat[self.A]["aliases"], [])
        self.assertEqual([s["alias"] for s in cat[self.A]["provenance"]["aliases_stripped"]], [self.A2, self.A])

    # ---- what does not change ---------------------------------------------------------------------------------------
    def test_a_same_objective_alias_that_is_not_live_still_folds(self):
        for alias in ("mc:zz1s1-1-1:times-the-exponents", "mc:zz1s1-1-1:merged-draft-id"):
            with self.subTest(alias):
                cat, problems = self.cat(self.run_with(a_aliases=[alias]))
                self.assertEqual(problems, [])
                self.assertEqual(cat[self.A]["aliases"], [alias])
                self.assertNotIn("aliases_stripped", cat[self.A]["provenance"])
        rc, said = self.main(self.run_with(a_aliases=["mc:zz1s1-1-1:times-the-exponents"]))
        self.assertEqual(rc, 0)
        self.assertNotIn("STRIPPED", said)

    def test_an_unknown_alias_behaves_as_before(self):
        # a generator's own id, in no catalogue and in no objective's namespace: kept, folded by the loader if a row exists
        for alias in ("mc:legacy-generator-id", "gen:times-the-exponents", "something-else"):
            with self.subTest(alias):
                cat, problems = self.cat(self.run_with(a_aliases=[alias]))
                self.assertEqual(problems, [])
                self.assertEqual(cat[self.A]["aliases"], [alias])
                self.assertNotIn("aliases_stripped", cat[self.A]["provenance"])

    def test_every_other_alias_rule_still_refuses(self):
        # one alias claimed by two entries
        _, problems = self.cat(self.run_with(a_aliases=["mc:legacy-generator-id"], with_a2=True,
                                             a2_aliases=["mc:legacy-generator-id"]))
        self.assertTrue(any("claimed by both" in p for p in problems), problems)
        # an unconfirmed entry is still dropped, so an alias naming IT is not a live id (it folds, as before)
        run = json.loads(self.run_with().read_text())
        dropped = self.entry(self.A2, "lo:zz1s1-1-1", "Subtracts the exponents")
        dropped["verdict"] = {"verdict": "UNSUPPORTED", "reason": "no"}
        run["records"][0]["entries"] = [self.entry(self.A, "lo:zz1s1-1-1", "Multiplies the exponents", [self.A2]), dropped]
        p = self.tmp / "final-wf_dropped.json"
        p.write_text(json.dumps(run))
        cat, problems = self.cat(p)
        self.assertEqual(problems, [])
        self.assertEqual(cat[self.A]["aliases"], [self.A2])

    def test_the_validator_stays_strict_for_a_stored_catalogue(self):
        cat = {"misconceptions": [am.to_loader_shape(dict(self.entry(self.A, "lo:zz1s1-1-1", "One", [self.B]), _run="r")),
                                  am.to_loader_shape(dict(self.entry(self.B, "lo:zz1s1-1-2", "Two"), _run="r"))]}
        self.assertTrue(any("is itself a live id" in p for p in am.validate_catalogue(cat)))
        stored = self.tmp / "stored.json"
        stored.write_text(json.dumps(cat))
        self.assertEqual(am.main(["--validate", str(stored)]), 1)

    # ---- pass 2: a tag naming the stripped alias resolves to the live entry it names, and never folds ----------------
    def test_pass_two_resolves_a_tag_naming_the_stripped_alias_to_the_entry_it_names(self):
        run = self.run_with(a_aliases=[self.B])
        s6 = self.tmp / "s6.json"

        def option(text, mid=None):
            return {"key": "B", "text": text, **({"misconception_id": mid} if mid else {})}

        def question(qid, lo, mid):
            return {"id": qid, "lo_id": lo, "tier": "basic", "question_type": "mcq", "stem": "x", "correct_answer": "A",
                    "choices": [{"key": "A", "text": "ok"}, option("bad", mid)], "canonical_solution": []}
        s6.write_text(json.dumps({"questions": [
            question("q:zz1s1-1-2:g001", "lo:zz1s1-1-2", self.B),    # the entry's own objective: stays B
            question("q:zz1s1-1-1:g001", "lo:zz1s1-1-1", self.B),    # another objective's: stripped, NOT folded into A
            question("q:zz1s1-1-1:g002", "lo:zz1s1-1-1", self.A),    # A's own tag: untouched
        ], "misconceptions": []}))
        rc, said = self.main(run, "--catalogue-only")
        self.assertEqual(rc, 0, said)
        first = self.out.read_bytes()
        rc, said = self.main(run, "--bundle", str(s6))
        self.assertEqual(rc, 0, said)
        self.assertEqual(self.out.read_bytes(), first, "the same catalogue in both passes")
        got = {q["id"]: q["choices"][1].get("misconception_id") for q in json.loads(s6.read_text())["questions"]}
        self.assertEqual(got, {"q:zz1s1-1-2:g001": self.B, "q:zz1s1-1-1:g001": None, "q:zz1s1-1-1:g002": self.A})
        self.assertIn("FR-1106", said)                  # B belongs to objective 2, not 1: stripped
        self.assertNotIn(f"alias {self.B} ->", said)    # never rewritten (folded) to the other entry
        self.assertEqual(sorted(m["id"] for m in json.loads(s6.read_text())["misconceptions"]), [self.A, self.B])
        self.assertEqual({m["id"] for m in json.loads(self.out.read_text())["misconceptions"]}, {self.A, self.B})
