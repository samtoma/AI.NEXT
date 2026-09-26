"""Packet by reference (packet_ref.py): each builder's `--by-ref` output, and each workflow's two modes.

    uv run --with pytest python -m pytest -q tests/test_packet_ref.py

No model is called: every workflow runs through tests/workflow_stub.mjs with canned answers, once
with its whole packet in the args (inline) and once by reference, on the SAME data. What is proved,
per stage (S1, S5 draft and final, S6 author and grade, S7 author and verify):
  * the same answers give the same return value in both modes (plus the echoed `by_ref` block);
  * SPLICE EQUALITY: every by-ref prompt, with each [[file: <path>]] replaced by that file's content,
    is the inline prompt — except that the inline "do not read any file" sentence is READ_RULE (or
    READ_RULE is appended where the inline prompt had none), and that by reference nothing is CLIPPED
    (decision of 2026-09-26): where the inline prompt clips a block (S5's solutions and evidence, S6's
    and S7's JSON), the shard is the whole block, and cut the inline way it is the inline text. So an
    agent gets the text it got inline and, where inline cut it, the rest of that same block — never
    anything else: the blind rules the inline prompts keep hold by construction;
  * no shard holds what the agent that reads it is meant to be blind to (named per stage below), and
    the compact args carry none of the packet's text;
  * the compact args are small (the Chapter-8 sizes are asserted in tests/test_dryrun_chapter.py);
  * both modes at once, or half a by-ref block, is refused before any agent runs;
  * the downstream readers accept a by-ref run as they accept an inline one, and S1's assembler
    proves the shards the run read were the chapter packet's own rendering.
The JavaScript-exact helpers (JSON.stringify, UTF-16 slicing, number printing) are checked against
node itself.
"""

from __future__ import annotations

import copy
import json
import random
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

import packet_ref  # noqa: E402

NODE = shutil.which("node")
INLINE_RULES = ("Everything you need is in this message; do not read any file.",
                "Everything you need is here; do not read any file.",
                "Do not read any file.")


def inline_view(path: Path) -> str:
    """What the INLINE prompt carried where a by-ref prompt names this shard. By reference nothing is
    clipped (decision of 2026-09-26, Q2); inline still clips S5's blocks, S6's JSON and S7's JSON, so
    the shard, cut the inline way, must be exactly the inline text: the by-ref agent gets all of it."""
    import re
    import assemble_misconceptions as am
    d = path.parent
    while not (d / "manifest.json").exists():
        d = d.parent
    stage = json.loads((d / "manifest.json").read_text())["stage"]
    rel, text = path.relative_to(d).as_posix(), path.read_text()
    if stage.startswith("S5"):
        return am._js_clip_text(text, 14000 if rel.endswith(".questions.txt") else 8000, "", [])
    if stage == "S6 author":
        return packet_ref.js_slice(text, 12000 if rel.endswith(".book-questions.txt") else 4000)
    if stage == "S6 grade" and rel.startswith("judge/"):
        head, insts = text.split("\n\nINSTANCES:\n", 1)
        return head + "\n\nINSTANCES:\n" + "\n\n".join(packet_ref.js_slice(x, 5000) for x in re.split(r"\n\n(?=\{)", insts))
    if stage == "S7 author":
        return packet_ref.js_slice(text, 9000 if rel == "contract.txt" else 14000)
    return text


def splice_as_inline(prompt: str) -> str:
    import re
    return re.sub(r"\[\[file: (/[^\]]+)\]\]", lambda m: inline_view(Path(m.group(1))), prompt)


def same_as_inline(inline_prompt: str, byref_prompt: str) -> tuple[str, str]:
    """(inline, by-ref as the inline agent would have seen it), each with the file rule normalised."""
    if packet_ref.READ_RULE not in byref_prompt:            # a prompt that names no file is unchanged
        return inline_prompt, byref_prompt
    s = splice_as_inline(byref_prompt)
    if s.endswith("\n\n" + packet_ref.READ_RULE) and not inline_prompt.endswith(packet_ref.READ_RULE):
        s = s[: -len("\n\n" + packet_ref.READ_RULE)]
    x = inline_prompt
    for r in INLINE_RULES:
        x = x.replace(r, "<<RULE>>")
    return x, s.replace(packet_ref.READ_RULE, "<<RULE>>")


def spliced_equals_inline(testcase: unittest.TestCase, inline: dict, byref: dict) -> None:
    """Every by-ref prompt, its shards spliced in and cut the inline way, is its inline prompt (modulo
    the file rule)."""
    testcase.assertEqual([c["label"] for c in inline["calls"]], [c["label"] for c in byref["calls"]])
    for a, b in zip(inline["calls"], byref["calls"]):
        x, s = same_as_inline(a["prompt"], b["prompt"])
        testcase.assertEqual(x, s, f"{a['label']}: the spliced by-ref prompt differs from the inline one")
        if "[[file: /" in b["prompt"]:
            testcase.assertIn(packet_ref.READ_RULE, b["prompt"], f"{a['label']} names files without the rule")


def files_named(call: dict) -> list[str]:
    import re
    return re.findall(r"\[\[file: (/[^\]]+)\]\]", call["prompt"])


def without_ref(result: dict) -> dict:
    r = dict(result)
    r.pop("by_ref", None)
    return r


# ============================================================================ helpers vs node
@unittest.skipUnless(NODE, "node checks the JavaScript-exact helpers")
class JsHelpers(unittest.TestCase):
    def node(self, expr: str, value) -> str:
        r = subprocess.run([NODE, "-e", f"const v = JSON.parse(process.argv[1]); process.stdout.write({expr})",
                            json.dumps(value)], capture_output=True, text=True, check=True)
        return r.stdout

    def test_stringify_matches_node(self):
        values = [[], {}, {"a": [], "b": {}, "c": [1, 2.5, -0.001, 1e-7, 1.5e-7, 1e21, 123456789012345680000.0, 0.1]},
                  ["é “quoted” \\ \" \n\t\u0001   𝑥 ok"], {"nested": [{"x": None, "y": True, "z": False}]}, 3.0, "s"]
        for v in values:
            self.assertEqual(packet_ref.js_json(v, 1), self.node("JSON.stringify(v, null, 1)", v), v)
            self.assertEqual(packet_ref.js_json(v), self.node("JSON.stringify(v)", v), v)

    def test_utf16_slice_and_length_match_node(self):
        s = "ab𝑥𝑦cd" * 3
        for n in (0, 1, 2, 3, 4, 7, 50):
            want = self.node(f"v.slice(0, {n})", s)
            # a clip that splits a surrogate pair: JavaScript keeps the lone half (printed as U+FFFD),
            # the shard drops it — the one place a shard may differ from inline, by half a character
            self.assertEqual(packet_ref.js_slice(s, n), want.replace("\ufffd", ""))
        self.assertEqual(packet_ref.js_len(s), int(self.node("String(v.length)", s)))

    def test_template_interpolation(self):
        self.assertEqual([packet_ref.js(x) for x in (None, True, 3, 3.0, 0.5, "t")], ["null", "true", "3", "3", "0.5", "t"])
        self.assertTrue(packet_ref.js_truthy([]) and packet_ref.js_truthy({}))
        self.assertFalse(packet_ref.js_truthy("") or packet_ref.js_truthy(0) or packet_ref.js_truthy(None))

    def test_shard_set_hash_and_directory_check(self):
        with tempfile.TemporaryDirectory() as d:
            sh = packet_ref.Shards(Path(d) / "p", "T")
            sh.put("a.txt", "one")
            sh.put("b/c.txt", "two")
            ref = sh.finish()
            self.assertEqual(ref["shards_sha256"], packet_ref.shards_sha256_of_texts({"a.txt": "one", "b/c.txt": "two"}))
            self.assertEqual(packet_ref.check_dir(ref), [])
            (Path(d) / "p" / "a.txt").write_text("changed")
            self.assertTrue(packet_ref.check_dir(ref))
            self.assertEqual(packet_ref.splice(f"x [[file: {Path(d) / 'p' / 'b' / 'c.txt'}]] y [[file: <path>]]"),
                             "x two y [[file: <path>]]")


# ============================================================================ S1
@unittest.skipUnless(NODE, "node is needed to run workflow scripts through the stub runtime")
class S1ByRef(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import _objectives_fixture as fx
        import assemble_objectives as ao
        import book_config
        from test_objectives import WORKFLOW, good_responses
        cls.fx, cls.ao, cls.WF = fx, ao, WORKFLOW
        cls._tmp = tempfile.TemporaryDirectory()
        cls.tmp = Path(cls._tmp.name)
        cls.f = fx.build(cls.tmp)
        cls.book = book_config.load_book(cls.f["book"])
        cls.manifest = json.loads(cls.f["manifest"].read_text())
        cls.blocks = ao.load_blocks(cls.f["blocks"])
        cls.maths = ao.load_maths(cls.f["maths"])
        cls.args = ao.s1_args(cls.book, cls.manifest, cls.blocks, cls.maths, 8)
        cls.compact = ao.s1_args_by_ref(cls.args, cls.tmp / "packets" / "s1-ch08")
        cls.responses = good_responses(cls.args)
        cls.inline = fx.run_workflow(WORKFLOW, cls.args, cls.responses, cls.tmp)
        cls.byref = fx.run_workflow(WORKFLOW, cls.compact, cls.responses, cls.tmp)

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def test_same_result_and_splice_equality(self):
        self.assertTrue(self.inline["ok"], self.inline["error"])
        self.assertTrue(self.byref["ok"], self.byref["error"])
        self.assertEqual(without_ref(self.inline["result"]), without_ref(self.byref["result"]))
        self.assertEqual(self.byref["result"]["by_ref"], self.compact["by_ref"])
        self.assertEqual(self.byref["result"]["prompts_version"], "s1-v5")
        spliced_equals_inline(self, self.inline, self.byref)

    def test_compact_args_carry_no_packet_text(self):
        text = json.dumps(self.compact, ensure_ascii=False)
        self.assertNotIn("chapter", {k for k in self.compact if k != "chapter_ref"})
        for l in self.args["chapter"]["lessons"]:
            for b in l["blocks"]:
                if len(b["text"]) > 30:
                    self.assertNotIn(b["text"], text)
            for i in l["items"]:
                self.assertNotIn(i["problem"], text)
        self.assertEqual(self.compact["packet_sha256"], self.args["packet_sha256"], "the hash still covers the whole packet")
        self.assertLess(packet_ref.args_size(self.compact), packet_ref.args_size(self.args) / 2)

    def test_each_agent_reads_only_its_own_shards_and_no_shard_holds_what_it_must_not_see(self):
        d = Path(self.compact["by_ref"]["dir"])
        shards = {p: p.read_text() for p in d.rglob("*.txt")}
        for text in shards.values():   # never a solution, a printed answer or a teacher-only note
            for secret in (self.fx.SOLUTION_MARK, self.fx.PRINTED_MARK, "ZZTEACHER"):
                self.assertNotIn(secret, text)
        answers = json.dumps(self.responses)
        for o in self.responses["S1:findA:g10m8s2-1"]["objectives"]:   # written before any agent ran
            self.assertTrue(all(o["statement"] not in t for t in shards.values()))
            self.assertIn(o["statement"], answers)
        for c in self.byref["calls"]:
            kind = c["label"].split(":")[1]
            names = [Path(p).relative_to(d).as_posix() for p in files_named(c)]
            slug = c["label"].split(":")[-1]
            allowed = {"findA": lambda n: n in ("context.txt", f"lessons/{slug}.A.txt"),
                       "findB": lambda n: n in ("context.txt", f"lessons/{slug}.B.txt"),
                       "reconcile": lambda n: False,
                       "evidence": lambda n: n.startswith("anchors/"),
                       "map": lambda n: n.startswith("pool/"), "map2": lambda n: n.startswith("pool/"),
                       "links": lambda n: n.startswith("lessons/") and n.endswith(".L.txt"),
                       "linkcheck": lambda n: n.startswith("anchors/")}[kind]
            self.assertTrue(all(allowed(n) for n in names), f"{c['label']} names {names}")
        # finder B's shard is finder A's text in B's order — the same book, never A's answer
        a = (d / "lessons" / "g10m8s2-1.A.txt").read_text()
        b = (d / "lessons" / "g10m8s2-1.B.txt").read_text()
        self.assertEqual(sorted(a.splitlines()), sorted(b.splitlines()))
        self.assertNotEqual(a, b)

    def test_both_modes_or_half_a_reference_is_refused(self):
        both = dict(self.compact, chapter=self.args["chapter"])
        half = {k: v for k, v in self.compact.items() if k != "chapter_ref"}
        neither = {k: v for k, v in self.compact.items() if k not in ("chapter_ref", "by_ref")}
        for bad, words in ((both, "not both"), (half, "needs both"), (neither, "s1-args")):
            rep = self.fx.run_workflow(self.WF, bad, self.responses, self.tmp)
            self.assertFalse(rep["ok"])
            self.assertIn(words, rep["error"])
            self.assertEqual(rep["calls"], [])
        bad = copy.deepcopy(self.compact)
        bad["options"]["pool_batch"] = 7
        rep = self.fx.run_workflow(self.WF, bad, self.responses, self.tmp)
        self.assertIn("pool shards were cut", rep["error"])

    def test_the_assembler_accepts_a_by_ref_run_and_checks_its_shards(self):
        path = self.tmp / "byref.json"
        path.write_text(json.dumps(self.byref["result"], ensure_ascii=False))
        run = self.ao.read_runs([path])
        out = self.ao.assemble(self.book, self.args, run, self.tmp / "objs", self.ao.egyptian_vocabulary())
        ipath = self.tmp / "inline.json"
        ipath.write_text(json.dumps(self.inline["result"], ensure_ascii=False))
        ref = self.ao.assemble(self.book, self.args, self.ao.read_runs([ipath]), self.tmp / "objs2",
                               self.ao.egyptian_vocabulary())
        self.assertEqual(out["status"], ref["status"])
        self.assertEqual(out["check"]["counts"], ref["check"]["counts"])
        tampered = json.loads(path.read_text())
        tampered["by_ref"]["shards_sha256"] = "0" * 64
        path.write_text(json.dumps(tampered))
        with self.assertRaises(self.ao.StageError):
            self.ao.assemble(self.book, self.args, self.ao.read_runs([path]), self.tmp / "objs3",
                             self.ao.egyptian_vocabulary())


# ============================================================================ S5
@unittest.skipUnless(NODE, "node is needed to run workflow scripts through the stub runtime")
class S5ByRef(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import assemble_misconceptions as am
        import test_assemble_misconceptions as T
        cls.am, cls.T = am, T
        cls._tmp = tempfile.TemporaryDirectory()
        cls.tmp = Path(cls._tmp.name)
        cls.draft_args = T.base_args("draft")
        cls.draft_resp = T.fixture("s5-draft-responses.json")
        cls.draft_in = T.run_stub(T.WORKFLOW, cls.draft_args, cls.draft_resp)
        cls.draft_compact = am.s5_args_by_ref(cls.draft_args, cls.tmp / "draft")
        cls.draft_ref = T.run_stub(T.WORKFLOW, cls.draft_compact, cls.draft_resp)
        cls.final_args, cls.final_resp = T.final_args(cls.draft_in["result"])
        cls.final_in = T.run_stub(T.WORKFLOW, cls.final_args, cls.final_resp)
        cls.final_compact = am.s5_args_by_ref(cls.final_args, cls.tmp / "final")
        cls.final_ref = T.run_stub(T.WORKFLOW, cls.final_compact, cls.final_resp)

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def test_same_result_and_splice_equality_draft_and_final(self):
        for i, r, c in ((self.draft_in, self.draft_ref, self.draft_compact), (self.final_in, self.final_ref, self.final_compact)):
            self.assertTrue(r["ok"], r["error"])
            self.assertEqual(without_ref(i["result"]), without_ref(r["result"]))
            self.assertEqual(r["result"]["by_ref"], c["by_ref"])
            spliced_equals_inline(self, i, r)

    def test_shards_are_per_objective_and_the_args_keep_no_solution(self):
        text = json.dumps(self.final_compact, ensure_ascii=False)
        for q in self.final_args["questions"]:
            for s in q["canonical_solution"]:
                self.assertNotIn(s if isinstance(s, str) else s.get("text_md", ""), text)
        d = Path(self.final_compact["by_ref"]["dir"])
        for c in self.final_ref["calls"]:
            lo = c["label"].split(":", 1)[1]
            for p in files_named(c):
                self.assertTrue(Path(p).name.startswith(lo.removeprefix("lo:") + "."), f"{c['label']} reads {p}")
                self.assertEqual(Path(p).parent, d / "o")

    def test_by_reference_nothing_is_clipped(self):
        """Q2 (2026-09-26): the author gets every canonical solution. Inline cuts at 14000 characters and
        notes it; by reference the shard is the whole block and no cut is noted."""
        args = copy.deepcopy(self.draft_args)
        lo = "lo:zz1s1-1-1"
        q0 = next(q for q in args["questions"] if q["lo"] == lo)
        for k in range(40):
            args["questions"].append(dict(copy.deepcopy(q0), id=f"q:zz1s1-1-1:long-{k}",
                                          stem=f"ZZLONG{k:02d} " + "Simplify the product of the powers. " * 12))
        inline = self.T.run_stub(self.T.WORKFLOW, args, self.draft_resp)
        compact = self.am.s5_args_by_ref(args, self.tmp / "long")
        byref = self.T.run_stub(self.T.WORKFLOW, compact, self.draft_resp)
        self.assertTrue(inline["ok"] and byref["ok"], (inline["error"], byref["error"]))
        spliced_equals_inline(self, inline, byref)
        shard = Path(compact["by_ref"]["dir"]) / "o" / "zz1s1-1-1.questions.txt"
        self.assertGreater(packet_ref.js_len(shard.read_text()), 14000)
        self.assertIn("ZZLONG39", shard.read_text())
        p_in = next(c["prompt"] for c in inline["calls"] if c["label"] == f"author:{lo}")
        self.assertNotIn("ZZLONG39", p_in, "inline still cuts it")
        rec = lambda r: next(x for x in r["result"]["records"] if x["lo"] == lo)   # noqa: E731
        self.assertTrue(any("truncated" in n for n in rec(inline)["notes"]))
        self.assertFalse(any("truncated" in n for n in rec(byref)["notes"]))
        self.assertEqual(byref["result"]["prompts_version"], "s5-v3")

    def test_the_assembler_accepts_a_by_ref_final_run(self):
        (self.tmp / "i").mkdir(exist_ok=True)
        (self.tmp / "r").mkdir(exist_ok=True)
        a, b = self.tmp / "i" / "final.json", self.tmp / "r" / "final.json"
        a.write_text(json.dumps(self.final_in["result"]))
        b.write_text(json.dumps(self.final_ref["result"]))
        ca = self.am.assemble([a], str(self.T.BOOK))
        cb = self.am.assemble([b], str(self.T.BOOK))
        self.assertEqual(ca[0]["misconceptions"], cb[0]["misconceptions"])
        self.assertEqual(ca[3], cb[3])

    def test_both_modes_or_half_a_reference_is_refused(self):
        both = dict(self.draft_compact, questions=self.draft_args["questions"])
        half = {k: v for k, v in self.draft_compact.items() if k != "objective_refs"}
        neither = {k: v for k, v in self.draft_args.items() if k not in ("questions", "sources")}
        for bad, words in ((both, "not both"), (half, "needs both"), (neither, "is required")):
            rep = self.T.run_stub(self.T.WORKFLOW, bad, self.draft_resp)
            self.assertFalse(rep["ok"])
            self.assertIn(words, rep["error"])
            self.assertEqual(rep["calls"], [])


# ============================================================================ S6 and S7
@unittest.skipUnless(NODE, "node is needed to run workflow scripts through the stub runtime")
class S6S7ByRef(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import book_config
        import generate_questions as G
        import generate_widget_questions as GW
        import test_family_widget_workflows as T
        from families import spec as FS
        cls.G, cls.GW, cls.T = G, GW, T
        cls._tmp = tempfile.TemporaryDirectory()
        cls.tmp = Path(cls._tmp.name)
        cls.book = T.g10_book()
        cls.specs, _ = FS.load_dir(T.FIX / "g10-specs")
        cls.qs, _, _ = G.run_specs(cls.specs, 5, T.SEED)
        G.rebalance_keys(cls.qs, random.Random(T.SEED))
        cls.gs = G.grading_set(cls.specs, cls.qs, T.SEED)
        grader = T.FamiliesGrade()
        grader.gs, grader.by_id = cls.gs, {q["id"]: q for q in cls.qs}
        cls.spoil, cls.skip = {"tpl:g10m4s2-1-1:balance"}, {"tpl:g10m1s7-2-1:trinomial"}
        cls.grade_resp = grader.responses(cls.spoil, cls.skip)
        cls.graph = GW.FixtureGraph(json.loads((T.FIX / "widget-graph.json").read_text()))
        cls.bookobj = book_config.Book.model_validate_json((book_config.BOOKS_DIR / "g10-math.json").read_text())

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def run2(self, wf, inline_args, compact, responses):
        a = self.T.run_workflow(wf, inline_args, responses)
        b = self.T.run_workflow(wf, compact, responses)
        self.assertTrue(a["ok"], a["error"])
        self.assertTrue(b["ok"], b["error"])
        self.assertEqual(without_ref(a["result"]), without_ref(b["result"]))
        self.assertEqual(b["result"]["by_ref"]["shards_sha256"], compact["by_ref"]["shards_sha256"])
        spliced_equals_inline(self, a, b)
        return a, b

    # ---------------------------------------------------------------- S6 author
    def test_s6_author(self):
        spec = json.loads((self.T.FIX / "g10-specs" / "g10m4s2-1-1--balance.json").read_text())
        objs = [{"lo_id": "lo:g10m4s2-1-1", "label": "Linear equations", "description": "Solve", "tier_gaps": ["basic"],
                 "lesson": "g10m4s2-1", "module": "module:g10m-c04", "existing_families": [],
                 "book_questions": [{"id": "q:g10m4s2-1-1:ex4-2-1", "stem": "Solve $2x = 4$ — “the book's” \\ é",
                                     "solution": ["$x = 2$"], "source_page": 101}],
                 "misconceptions": [{"id": "mc:g10m4s2-1-1:halved", "label": "Halves", "description": None}]}]
        args = {"mode": "author", "book": self.book, "objectives": objs}
        compact = self.G.author_args_by_ref(args, self.tmp / "s6a")
        _, b = self.run2(self.T.FAMILIES_WF, args, compact, {
            "author:lo:g10m4s2-1-1": {"lo_id": "lo:g10m4s2-1-1", "families": [spec], "infeasible": []}})
        self.assertNotIn("Solve $2x = 4$", json.dumps(compact, ensure_ascii=False))
        self.assertEqual(b["result"]["prompts_version"], "s6-v3")
        for bad, words in ((dict(compact, objectives=objs), "not both"),
                           ({k: v for k, v in compact.items() if k != "objective_refs"}, "needs both")):
            rep = self.T.run_workflow(self.T.FAMILIES_WF, bad, {})
            self.assertFalse(rep["ok"])
            self.assertIn(words, rep["error"])

    # ---------------------------------------------------------------- S6 grade (the blind solver)
    def test_s6_author_by_reference_nothing_is_clipped(self):
        long_q = [{"id": f"q:g10m4s2-1-1:ex4-2-{k}", "stem": f"ZZQ{k:02d} " + "Solve the linear equation for x. " * 20,
                   "solution": ["$x = 2$"]} for k in range(30)]
        objs = [{"lo_id": "lo:g10m4s2-1-1", "label": "Linear equations", "tier_gaps": ["basic"], "lesson": "g10m4s2-1",
                 "module": "module:g10m-c04", "book_questions": long_q, "misconceptions": []}]
        args = {"mode": "author", "book": self.book, "objectives": objs}
        compact = self.G.author_args_by_ref(args, self.tmp / "s6a-long")
        resp = {"author:lo:g10m4s2-1-1": {"lo_id": "lo:g10m4s2-1-1", "families": [], "infeasible": []}}
        a, b = self.run2(self.T.FAMILIES_WF, args, compact, resp)
        shard = (Path(compact["by_ref"]["dir"]) / "o" / "g10m4s2-1-1.book-questions.txt").read_text()
        self.assertEqual(json.loads(shard), long_q, "the whole list, valid JSON")
        self.assertNotIn("ZZQ29", a["calls"][0]["prompt"], "inline still cuts at 12000")

    def test_s6_grade_is_blind_and_round_trips(self):
        args = self.G.grade_args(self.book, self.gs)
        [compact] = self.G.grade_args_by_ref(self.book, self.gs, self.tmp / "s6g")
        _, b = self.run2(self.T.FAMILIES_WF, args, compact, self.grade_resp)
        d = Path(compact["by_ref"]["dir"])
        sealed = []
        for fam in self.gs["families"]:
            for inst in fam["instances"]:
                sealed += [s["text_md"] for s in inst["sealed"]["canonical_solution"]] + [inst["instance_id"]]
                if inst["sealed"].get("answer_check"):
                    sealed.append(inst["sealed"]["answer_check"])
        for c in b["calls"]:
            names = [Path(p).relative_to(d).as_posix() for p in files_named(c)]
            if c["label"].startswith("solve:"):
                self.assertTrue(names and all(n.startswith("solve/") for n in names), names)
                for n in names:
                    body = (d / n).read_text()
                    for s in sealed:
                        self.assertNotIn(s, body, f"sealed text in the blind solver's {n}")
                    self.assertNotIn("misconception", body)
            else:
                self.assertTrue(all(n.startswith("judge/") for n in names), names)
        text = json.dumps(compact, ensure_ascii=False)
        for s in sealed[:40]:
            if not s.startswith("q:"):
                self.assertNotIn(s, text, "the compact args carry nothing sealed")
        with tempfile.TemporaryDirectory() as t:
            p = Path(t, "grade.json")
            p.write_text(json.dumps(b["result"]))
            acc, rej = self.G.apply_grades(self.specs, self.qs, [p])
        self.assertEqual(set(rej), self.spoil | self.skip)
        self.assertEqual(set(acc), {s.id for s in self.specs} - self.spoil - self.skip)

    def test_s6_grade_splits_into_parts_that_each_fit(self):
        [whole] = self.G.grade_args_by_ref(self.book, self.gs, self.tmp / "s6g-whole")
        limit = packet_ref.args_size(whole) // 2
        parts = self.G.grade_args_by_ref(self.book, self.gs, self.tmp / "s6g-parts", limit=limit)
        self.assertGreater(len(parts), 1)
        self.assertTrue(all(packet_ref.args_size(p) <= limit for p in parts if len(p["grading_ref"]["families"]) > 1))
        self.assertEqual([f for p in parts for f in p["grading_ref"]["families"]], whole["grading_ref"]["families"])
        results, files = [], []
        for k, p in enumerate(parts):
            rep = self.T.run_workflow(self.T.FAMILIES_WF, p, self.grade_resp)
            self.assertTrue(rep["ok"], rep["error"])
            results += rep["result"]["results"]
            files.append(rep["result"])
        one = self.T.run_workflow(self.T.FAMILIES_WF, self.G.grade_args(self.book, self.gs), self.grade_resp)
        self.assertEqual(results, one["result"]["results"], "the parts together are the one run")
        with tempfile.TemporaryDirectory() as t:
            paths = []
            for k, r in enumerate(files):
                paths.append(Path(t, f"grade-{k}.json"))
                paths[-1].write_text(json.dumps(r))
            acc, rej = self.G.apply_grades(self.specs, self.qs, paths)
        self.assertEqual(set(rej), self.spoil | self.skip)

    # ---------------------------------------------------------------- S7 author
    def test_s7_author(self):
        args = self.GW.author_args(self.bookobj, self.graph, "course:us-g10-math-en")
        compact = self.GW.author_args_by_ref(args, self.tmp / "s7a")
        tpl = json.loads((self.T.FIX / "widget-templates" / "g10m8s3-1-2--gradient-line.json").read_text())
        venn = dict(tpl, id="wt:g10m8s3-1-2:venn", kind="zz_unapproved_kind")
        a, b = self.run2(self.T.WIDGETS_WF, args, compact, {
            "author:g10m8s3-1": {"templates": [tpl, venn], "gaps": []},
            "author:g10m8s4-1": {"templates": [], "gaps": []}, "author:g10m2s2-1": None})
        self.assertIn("zz_unapproved_kind", {g["need_kind"] for g in b["result"]["gaps"]})
        self.assertEqual(set(compact["contract_kinds"]), set(args["contract"]))
        self.assertEqual(b["result"]["prompts_version"], "s7-v3")
        # Q2 (2026-09-26): the author sees the WHOLE contract by reference; inline cuts it at 9000
        # characters, which drops the last kinds (venn_builder, area_model, …) off the prompt
        contract = (Path(compact["by_ref"]["dir"]) / "contract.txt").read_text()
        self.assertEqual(contract, packet_ref.js_json(args["contract"], 1))
        last = list(args["contract"])[-1]
        self.assertIn(f'"{last}"', contract)
        self.assertGreater(packet_ref.js_len(contract), 9000, "today's contract is longer than the inline clip")
        p_in = next(c["prompt"] for c in a["calls"] if c["label"] == "author:g10m8s3-1")
        self.assertNotIn(f'"{last}"', p_in, "inline still cuts the contract")
        for bad, words in ((dict(compact, objectives=args["objectives"]), "not both"),
                           ({k: v for k, v in compact.items() if k != "lesson_refs"}, "by reference needs")):
            rep = self.T.run_workflow(self.T.WIDGETS_WF, bad, {})
            self.assertFalse(rep["ok"])
            self.assertIn(words, rep["error"])

    # ---------------------------------------------------------------- S7 verify (the blind verifier)
    def test_s7_verify_is_blind_and_round_trips(self):
        import _widget_defect_fixture as wdf
        templates, questions = wdf.pre_v093_templates()
        args = self.GW.verify_args(self.bookobj, self.graph, questions)
        compact = self.GW.verify_args_by_ref(args, self.tmp / "s7v")
        qmap = {q["id"]: q for q in questions}
        by_t: dict[str, list] = {}
        for w in args["widgets"]:
            by_t.setdefault(w["template_id"], []).append(w)
        responses = {}
        for tid, ws in by_t.items():
            results = []
            for i, w in enumerate(ws, 1):
                q = qmap[w["question_id"]]
                reading = {k: v for k, v in q["choices"]["spec"].items() if k in self.GW.READING_FIELDS[w["kind"]]}
                if tid == "wt:t2u2-2-1:domain-excluded":
                    reading = {"mode": "points", "targets": sorted(-t for t in q["choices"]["spec"]["targets"])}
                results.append({"widget": f"W{i}", "reading": reading, "construction": "…", "reachable": True,
                                "predicates": [{"predicate": d["predicate"], "matches": True, "why": "…"} for d in w["diagnostics"]]})
            responses[f"verify:{tid}"] = {"results": results}
        responses["verify:wt:u2-3-1:variation-direct"] = None   # a skipped verifier
        _, b = self.run2(self.T.WIDGETS_WF, args, compact, responses)
        d = Path(compact["by_ref"]["dir"])
        packet = "\n".join(p.read_text() for p in d.rglob("*.txt")) + json.dumps(compact, ensure_ascii=False)
        for q in questions:   # the stored spec, the solution and the id never reach the verifier's files
            spec = q["choices"]["spec"]
            self.assertNotIn(json.dumps(spec), packet)
            self.assertNotIn(json.dumps(spec, separators=(",", ":")), packet)
            self.assertNotIn(q["canonical_solution"][-1]["text_md"], packet)
        for c in b["calls"]:
            for p in files_named(c):
                for q in questions:
                    self.assertNotIn(q["id"], Path(p).read_text())
        with tempfile.TemporaryDirectory() as t:
            p = Path(t, "verify.json")
            p.write_text(json.dumps(b["result"]))
            acc, rej = self.GW.apply_verdicts(templates, questions, [p])
        self.assertEqual(acc, {"wt:u5-3-1:line-equation", "wt:g10m8s3-1-2:gradient-line"})
        self.assertIn("blind reading disagrees", " ".join(rej["wt:t2u2-2-1:domain-excluded"]))
        for bad, words in ((dict(compact, widgets=args["widgets"]), "not both"),
                           ({k: v for k, v in compact.items() if k != "widget_refs"}, "needs both")):
            rep = self.T.run_workflow(self.T.WIDGETS_WF, bad, {})
            self.assertFalse(rep["ok"])
            self.assertIn(words, rep["error"])


if __name__ == "__main__":
    unittest.main()
