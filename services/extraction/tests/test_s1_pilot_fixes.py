"""S1-v4: the causes the Chapter 8 pilot (run wf_02ba66d9-470, rejected at assembly) exposed, fixed at the source.

    uv run --with pytest python -m pytest -q tests/test_s1_pilot_fixes.py

No rule of §3.4 is weakened; each test pins a cause:
  1. anchors copied WITH their brackets ("[EMA69]"): the rules ask for the id without, the workflow and
     the assembler strip one bracket pair only when the id inside is a known anchor (recorded as
     `anchor_written`), and a bracketed id that is NOT an anchor still fails;
  2. body paragraphs cited as "definition": every text line now says which kinds it may be cited as,
     from rule 1's own table — and a paragraph cited as a definition is still dropped;
  3. the evidence check asked a heading to demonstrate a method: it now judges each kind by what that
     kind can show;
  4. the reconciler lost LaTeX backslashes copying JSON-escaped quotes: evidence is listed as plain text;
  5. a distributed item both mappers placed nowhere: the failure says so, with their reasons (rule 2
     unchanged);
and backlog 67: S0a writes atomically.
No model is called (tests/workflow_stub.mjs, canned answers).
"""

from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
EX = HERE.parent
for p in (str(EX), str(HERE)):
    if p not in sys.path:
        sys.path.insert(0, p)

import _objectives_fixture as fx  # noqa: E402
import assemble_objectives as ao  # noqa: E402
import book_config  # noqa: E402
from test_objectives import WORKFLOW, good_responses  # noqa: E402


def bracket_all(r: dict, slug: str) -> dict:
    """What the pilot's finder A did: every evidence anchor of one lesson written with its brackets."""
    r = copy.deepcopy(r)
    for label in (f"S1:findA:{slug}", f"S1:reconcile:{slug}"):
        for o in r[label]["objectives"]:
            for e in o["evidence"]:
                e["anchor"] = f"[{e['anchor']}]"
    return r


@unittest.skipUnless(fx.NODE, "node is needed to run workflow scripts through the stub runtime")
class PilotFixes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls.tmp = Path(cls._tmp.name)
        cls.f = fx.build(cls.tmp)
        cls.book = book_config.load_book(cls.f["book"])
        cls.manifest = json.loads(cls.f["manifest"].read_text())
        cls.blocks = ao.load_blocks(cls.f["blocks"])
        cls.maths = ao.load_maths(cls.f["maths"])
        cls.args = ao.s1_args(cls.book, cls.manifest, cls.blocks, cls.maths, 8)
        cls.vocab = ao.egyptian_vocabulary()

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def run_s1(self, responses, name):
        rep = fx.run_workflow(WORKFLOW, self.args, responses, self.tmp)
        self.assertTrue(rep["ok"], rep["error"])
        path = self.tmp / name
        path.write_text(json.dumps(rep["result"], ensure_ascii=False))
        return rep, ao.read_runs([path])

    def evaluate(self, run):
        return ao.evaluate_chapter(self.args["chapter"], run, self.vocab, {}, [])

    # ---------------------------------------------------------------- 1. bracketed anchors
    def test_1_the_rules_ask_for_the_id_without_its_brackets(self):
        rep, _ = self.run_s1(good_responses(self.args), "plain.json")
        finder = next(c["prompt"] for c in rep["calls"] if c["label"] == "S1:findA:g10m8s2-1")
        self.assertIn("written WITHOUT the brackets", finder)
        self.assertNotIn("copy the bracketed anchor exactly", finder)
        linker = next(c["prompt"] for c in rep["calls"] if c["label"].startswith("S1:links:"))
        self.assertIn("WITHOUT the brackets", linker)
        self.assertEqual(rep["result"]["prompts_version"], "s1-v5")

    def test_1_a_bracketed_known_anchor_is_read_without_its_brackets_and_recorded(self):
        rep, run = self.run_s1(bracket_all(good_responses(self.args), "g10m8s2-1"), "bracketed.json")
        les = next(l for l in run["lessons"] if l["slug"] == "g10m8s2-1")
        ev = les["reconciled"]["objectives"][0]["evidence"][0]
        self.assertEqual((ev["anchor"], ev["anchor_written"]), ("EMA69", "[EMA69]"))
        check = next(c["prompt"] for c in rep["calls"] if c["label"] == "S1:evidence:g10m8s2-1")
        self.assertNotIn("NO SUCH ANCHOR", check, "the evidence check sees the anchored text")
        _, plain = self.run_s1(good_responses(self.args), "plain2.json")
        a, b = self.evaluate(run), self.evaluate(plain)
        self.assertEqual(a["failures"], b["failures"])
        self.assertEqual([len(o["evidence"]) for l in a["lessons"] for o in l["objectives"]],
                         [len(o["evidence"]) for l in b["lessons"] for o in l["objectives"]])

    def test_1_the_assembler_reads_an_older_bracketed_run_the_same_way(self):
        _, run = self.run_s1(good_responses(self.args), "old.json")
        old = copy.deepcopy(run)
        les = next(l for l in old["lessons"] if l["slug"] == "g10m8s2-1")
        for side in ("a", "b"):
            for o in les["finders"][side]["objectives"]:
                for e in o["evidence"]:
                    e["anchor"] = f"[{e['anchor']}]"
        for o in les["reconciled"]["objectives"]:
            for e in o["evidence"]:
                e["anchor"] = f"[{e['anchor']}]"
        self.assertEqual(self.evaluate(old)["failures"], self.evaluate(run)["failures"])
        kept = next(l for l in self.evaluate(old)["lessons"] if l["slug"] == "g10m8s2-1")["objectives"][0]["evidence"]
        self.assertTrue(all(e["anchor_written"].startswith("[") for e in kept))

    def test_1_a_bracketed_id_that_is_no_anchor_still_fails(self):
        idx = ao.anchor_index(self.args["chapter"])
        ev = {"kind": "heading", "anchor": "[EMA99]", "printed_page": 288, "quote": "x"}
        self.assertEqual(ao.unbracket(ev, idx), ev)
        self.assertEqual(ao.unbracket({"anchor": "[[EMA69]]"}, idx), {"anchor": "[[EMA69]]"}, "one pair only")
        self.assertEqual(ao.unbracket({"anchor": "[Ex8-2:2]"}, idx)["anchor"], "Ex8-2:2", "a whole question too")

    # ---------------------------------------------------------------- 2. which kinds a line may be cited as
    def test_2_every_text_line_says_which_kinds_it_may_be_cited_as(self):
        ch = self.args["chapter"]
        s21 = next(l for l in ch["lessons"] if l["slug"] == "g10m8s2-1")
        by_type = {b["type"]: b["cite"] for b in s21["blocks"]}
        self.assertEqual(by_type["para"], ["intro"])
        self.assertEqual(by_type["definition"], ["intro", "definition"])
        self.assertEqual(by_type["heading"], ["heading", "intro"])
        self.assertTrue(all(b["cite"] == ["summary"] for b in ch["summary"] if b["type"] == "summary_item"))
        for kind, types in ao._KIND_TYPES.items():       # the table the assembler checks is the one shown
            for scope in ("intro", "lesson", "summary"):
                for t in types:
                    if kind in ("worked_example", "exercise"):
                        continue
                    shown = kind in ao.cite_kinds(t, scope)
                    allowed = not ((kind == "summary" and scope != "summary") or
                                   (kind == "intro" and scope not in ("intro", "lesson")))
                    self.assertEqual(shown, allowed, (kind, t, scope))
        rep, _ = self.run_s1(good_responses(self.args), "cite.json")
        finder = next(c["prompt"] for c in rep["calls"] if c["label"] == "S1:findB:g10m8s2-1")
        self.assertIn("; cite as: intro)", finder)
        self.assertIn("; cite as: intro or definition)", finder)
        self.assertIn('one of the kinds its line lists after "cite as:"', finder)

    def test_2_a_paragraph_cited_as_a_definition_is_still_dropped(self):
        r = good_responses(self.args)
        para = next(b for l in self.args["chapter"]["lessons"] if l["slug"] == "g10m8s2-1"
                    for b in l["blocks"] if b["type"] == "para")
        bad = {"kind": "definition", "anchor": para["id"], "printed_page": para["printed_page"],
               "quote": para["text"][:20]}
        for label in ("S1:findA:g10m8s2-1", "S1:reconcile:g10m8s2-1"):
            r[label]["objectives"][0]["evidence"].append(copy.deepcopy(bad))
        r["S1:evidence:g10m8s2-1"]["checks"].append({"objective_n": 1, "evidence_index": 3, "present": True, "supports": True})
        _, run = self.run_s1(r, "paradef.json")
        les = next(l for l in self.evaluate(run)["lessons"] if l["slug"] == "g10m8s2-1")
        why = [e["dropped"] for e in les["objectives"][0]["evidence_dropped"]]
        self.assertIn(f"anchor '{para['id']}' is a para block, not definition evidence", why)

    # ---------------------------------------------------------------- 3. the evidence check, per kind
    def test_3_the_evidence_check_judges_each_kind_by_what_it_can_show(self):
        rep, _ = self.run_s1(good_responses(self.args), "check.json")
        p = next(c["prompt"] for c in rep["calls"] if c["label"] == "S1:evidence:g10m8s2-1")
        self.assertIn("heading — the heading names this objective's topic or skill", p)
        self.assertIn("It does NOT support an objective on a different topic that merely shares a word", p)
        self.assertIn("summary — the summary line states the fact, formula or method the objective uses", p)
        self.assertIn("Be strict: when unsure, false.", p)

    # ---------------------------------------------------------------- 4. backslashes
    def test_4_the_reconciler_reads_quotes_as_plain_text_with_their_backslashes(self):
        r = good_responses(self.args)
        q = "where m is the gradient: $\\frac{y_2 - y_1}{x_2 - x_1}$"
        r["S1:findB:g10m8s3-2"]["objectives"][0]["evidence"][0]["quote"] = q
        rep, _ = self.run_s1(r, "latex.json")
        p = next(c["prompt"] for c in rep["calls"] if c["label"] == "S1:reconcile:g10m8s3-2")
        self.assertIn(f"quote: {q}", p, "one backslash, as the finder wrote it")
        self.assertNotIn("\\\\frac", p, "never the JSON-escaped double backslash")
        self.assertNotIn('"quote":', p)

    # ---------------------------------------------------------------- 5. an item no objective practises
    def test_5_an_item_both_mappers_place_nowhere_fails_rule_2_and_says_why(self):
        r = good_responses(self.args)
        for label in ("S1:map:ch08:1", "S1:map2:ch08:1"):
            r[label]["mapping"][0].update(objective="none", reason="asks for an area; no objective practises it")
        _, run = self.run_s1(r, "none.json")
        fails = [f for f in self.evaluate(run)["failures"] if "maps to no objective" in f]
        self.assertEqual(len(fails), 1)
        self.assertIn("both mappers said none", fails[0])
        self.assertIn("asks for an area", fails[0])
        ev = ao.evaluate_chapter(self.args["chapter"], run, self.vocab, {"move_items": {"Ex8-6:1": "lo:g10m8s2-1-1"}}, [])
        self.assertFalse([f for f in ev["failures"] if "maps to no objective" in f], "G1 may place it")


class AtomicAdapterWrites(unittest.TestCase):
    def test_write_atomic_replaces_whole_files(self):
        import source_adapter as sa
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "blocks.jsonl"
            p.write_text("old\n")
            sa.write_atomic(p, "new\n")
            self.assertEqual(p.read_text(), "new\n")
            sa.write_atomic(Path(d) / "x.png", b"\x89PNG")
            self.assertEqual((Path(d) / "x.png").read_bytes(), b"\x89PNG")
            self.assertEqual(sorted(x.name for x in Path(d).iterdir()), ["blocks.jsonl", "x.png"], "no temp file left")


if __name__ == "__main__":
    unittest.main()
