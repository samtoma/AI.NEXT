"""repair_step_titles.py: put back the maths the adapter once dropped from worked-example step titles, in the
artifacts built from the old blocks (saved lesson runs, G2 splits, assembled bundles, the DB's strings). No model.

    uv run --project services/extraction --with pytest python -m pytest -q services/extraction/tests/test_repair_step_titles.py

What is proved, on synthetic books written in source_adapter.py's block format (every sentence is invented):
  - EXACT   the repaired string is the one the lesson packet would carry from today's blocks: the tool's lists are
            compared with `assemble_objectives.build_lesson_packet` on the fixture, for the old title and the new;
            a bundle's string is the assembly's own normalise + re-spacing of that;
  - MINIMAL a rewrite changes the repaired strings and nothing else, byte for byte (formatting reproduced);
  - IDEMPOTENT a second run finds nothing and writes nothing;
  - REFUSES a list that is neither the old nor the new text, a list of another length, a worked example found twice,
            a maths image S0b has not accepted, blocks from before the extractor fix, a file whose formatting cannot be
            reproduced, and a file that changed under the tool; and with --skip-refused it repairs only the rest.

No @covers marker, on purpose: this is pipeline repair (a data fix), and spec 003 carries no FR about it.
"""

from __future__ import annotations

import contextlib
import copy
import io
import json
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

EX = Path(__file__).resolve().parents[1]
if str(EX) not in sys.path:
    sys.path.insert(0, str(EX))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import assemble_objectives as ao  # noqa: E402
import book_config  # noqa: E402
import repair_step_titles as R  # noqa: E402
import _objectives_fixture as fx  # noqa: E402

TOKEN = re.compile(r"⟦m:([0-9a-f]{32})⟧")
NODE_KATEX = bool(shutil.which("node")) and (EX.parents[1] / "app" / "node_modules" / "katex").exists()


def step(title, text):
    return {"title": title, "title_maths": TOKEN.findall(title or ""), "text": text, "maths": TOKEN.findall(text or ""),
            "math_kinds": ["inline"] * len(TOKEN.findall(text or "")), "figures": []}


def we_block(i, chapter, n, steps, loose=None):
    return {"id": f"b{i:05d}", "type": "worked_example", "chapter": chapter, "n": n, "title": "A demo", "section": "8.2",
            "printed_page": 289, "question": {"text": "Q?", "maths": [], "math_kinds": [], "figures": []},
            "steps": steps, "loose_solution": loose}


def dump(obj, indent=1) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=indent) + "\n"


class Fixture:
    """A chapter-8 book with worked examples 1 (one damaged title), 2 (three, one body-less) and 3 (untouched)."""

    def __init__(self, tmp: Path):
        self.tmp = tmp
        self.M = fx.Maths()
        M = self.M
        self.blocks = [
            we_block(1, 8, 1, [step("Write down the rule", M("d = 5")),
                               step(f"Substitute {M('x')} into {M('y = 2x')}", M("y = 2x + 1")),
                               step("Write the final answer", f"The value is {M('3')}.")]),
            we_block(2, 8, 2, [step(f"Calculate {M('z')}", f"So {M('z = 4')}."),
                               step(f"Check that {M('a = 1')} works", ""),          # a title-only step: never in a solution
                               step(f"Divide both sides by {M('-8')}", M("a = 3"))],
                     loose="That completes the working."),
            we_block(3, 8, 3, [step("Plain", M("p = 1"))]),
        ]
        self.accepted = M.accepted
        self.root = tmp / "repo" / "services" / "extraction"
        (self.root / "work" / "g10-math").mkdir(parents=True)
        (self.root / "runs" / "g10-math").mkdir(parents=True)
        self.blocks_path = self.root / "work" / "g10-math" / "blocks.jsonl"
        self.blocks_path.write_text("".join(json.dumps(b, ensure_ascii=False) + "\n" for b in self.blocks))
        self.maths_path = self.root / "runs" / "g10-math" / "maths" / "book" / "accepted.json"
        self.maths_path.parent.mkdir(parents=True)
        self.maths_path.write_text(json.dumps({"accepted": {h: {"latex": l, "accepted_by": "hash"} for h, l in M.accepted.items()}}))
        self.maths = {h: l for h, l in M.accepted.items()}
        self.index = R.build_index(self.blocks, self.maths)

    # the lists a lesson run / bundle would hold
    def old(self, n):
        return self.index.by_key[(8, n)].lines("old")

    def new(self, n):
        return self.index.by_key[(8, n)].lines("new")

    def run_doc(self, items=None, claims=None, wrapper=False):
        d = {"lesson": "g10m8s2-1", "claims": claims or [],
             "items": items if items is not None else [
                 {"ref": "WE1", "kind": "worked_example", "solution": self.old(1)},
                 {"ref": "WE2", "kind": "worked_example", "solution": self.old(2)},
                 {"ref": "WE3", "kind": "worked_example", "solution": self.old(3)}]}
        return {"result": {"lessons": [d]}} if wrapper else d

    def bundle_doc(self, asm, old=True, mode="respaced"):
        pick = (lambda n: self.old(n)) if old else (lambda n: self.new(n))
        conv = lambda lst: [asm(s, mode) for s in lst]                                   # noqa: E731
        return {"questions": [{"id": "q:g10m8s2-1-1:we01", "solution": conv(pick(1)), "stem": "s"},
                              {"id": "q:g10m8s2-1-1:we03", "solution": conv(pick(3)), "stem": "s"}],
                "explanation_entries": [{"id": "expl:g10m8s2-1-1:we02", "entry_type": "worked_example",
                                         "content": [{"kind": "problem", "text_md": "Q?"}]
                                         + [{"step": i + 1, "text_md": s} for i, s in enumerate(conv(pick(2)))]}]}

    def write(self, rel: str, obj, indent=1) -> Path:
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(dump(obj, indent))
        return p

    def run(self, *argv) -> tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = R.main(["g10-math", *argv, "--root", str(self.root), "--blocks", str(self.blocks_path),
                         "--maths", str(self.maths_path)])
        return rc, out.getvalue(), err.getvalue()


class TitleLists(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.f = Fixture(Path(self._tmp.name))

    def tearDown(self):
        self._tmp.cleanup()

    def test_the_old_and_new_lists_are_what_the_lesson_packet_builds(self):
        """The tool's solution lists ARE build_lesson_packet's: the packet built from blocks with the repaired titles gives
        `new`, and from the legacy titles gives `old`."""
        d = self.f.tmp / "packet"
        built = fx.build(d)
        blocks = ao.load_blocks(built["blocks"])
        book = book_config.load_book(built["book"])
        manifest = json.loads(built["manifest"].read_text())
        rec = {"lesson": "g10m8s2-1", "chapter": 8, "title": "Distance", "module": "module:g10m-c08", "provenance": {},
               "objectives": [{"id": "lo:g10m8s2-1-1", "statement": "s", "label": "l", "exercise_items": ["Ex8-2:1"],
                               "worked_examples": ["WE1"]}]}
        accepted = dict(built["accepted"])
        M = fx.Maths()
        M.accepted = accepted
        we1 = next(b for b in blocks if b["type"] == "worked_example" and b["n"] == 1)
        we1["steps"][1] = step(f"Substitute {M('x_1')} and simplify", we1["steps"][1]["text"])
        legacy = copy.deepcopy(blocks)
        next(b for b in legacy if b["id"] == we1["id"])["steps"][1]["title"] = "Substitute and simplify"
        for label, bs in (("new", blocks), ("old", legacy)):
            pk = ao.build_lesson_packet(book, manifest, bs, accepted, rec, built["work"])
            idx = R.build_index(blocks, accepted)
            got = pk["worked_examples"][0]["solution"]
            self.assertEqual(got, idx.by_key[(8, 1)].lines(label), label)
        self.assertIn(f"Substitute $x_1$ and simplify: ", ao.build_lesson_packet(book, manifest, blocks, accepted, rec, built["work"])
                      ["worked_examples"][0]["solution"][1])

    def test_a_body_less_step_is_not_in_the_solution_and_the_loose_solution_is_last(self):
        self.assertEqual(len(self.f.old(2)), 3)                                         # 3 steps, one with no text, + loose
        self.assertEqual(self.f.old(2)[-1], "That completes the working.")
        self.assertEqual(self.f.old(2)[0], "Calculate: So $z = 4$ .")
        self.assertEqual(self.f.new(2)[0], "Calculate $z$: So $z = 4$ .")
        self.assertEqual(self.f.index.damaged[8], 4)                                    # WE1 s1, WE2 s0, s1 (no text), s2

    def test_legacy_title_is_the_title_without_its_maths(self):
        self.assertEqual(R.legacy_title("Extend ⟦m:" + "a" * 32 + "⟧ to ⟦m:" + "b" * 32 + "⟧ and join"), "Extend to and join")
        self.assertEqual(R.legacy_title(None), "")

    def test_exact_old_titles_come_from_the_pre_fix_blocks_when_given(self):
        old = copy.deepcopy(self.f.blocks)
        old[0]["steps"][1]["title"] = "Substitute  into"                                  # a spelling the derivation cannot know
        idx = R.build_index(self.f.blocks, self.f.maths, {b["id"]: b for b in old})
        self.assertEqual(idx.by_key[(8, 1)].steps[1].old_title, "Substitute into")        # (rendered: whitespace collapsed)


class Rewrites(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.f = Fixture(Path(self._tmp.name))
        self.asm = R.Assembler()

    def tearDown(self):
        self._tmp.cleanup()

    def test_dry_run_changes_nothing_and_apply_rewrites_exactly_the_damaged_strings(self):
        run = self.f.write("runs/g10-math/lesson/g10m8s2-1.json", self.f.run_doc())
        bundle = self.f.write("seed/g10-math/g10m-c08.json", self.f.bundle_doc(self.asm), indent=2)
        before = {p: p.read_bytes() for p in (run, bundle)}
        book = book_config.load_book("g10-math")
        rc, out, _ = self.f.run("plan", "--path", str(bundle))
        self.assertEqual(rc, 0, out)
        self.assertEqual(before, {p: p.read_bytes() for p in (run, bundle)}, "plan writes nothing")
        rc, out, err = self.f.run("apply", "--path", str(bundle))
        self.assertEqual(rc, 0, out + err)
        got = json.loads(run.read_text())
        self.assertEqual([i["solution"] for i in got["items"]], [self.f.new(1), self.f.new(2), self.f.new(3)])
        # the bundle holds the assembly's form of the same strings
        b = json.loads(bundle.read_text())
        self.assertEqual(b["questions"][0]["solution"], [self.asm(s, "respaced") for s in self.f.new(1)])
        self.assertEqual([c["text_md"] for c in b["explanation_entries"][0]["content"] if "step" in c],
                         [self.asm(s, "respaced") for s in self.f.new(2)])
        self.assertEqual(b["explanation_entries"][0]["content"][0], {"kind": "problem", "text_md": "Q?"})
        # byte for byte: the file is the original with only those strings replaced
        expect = before[run].decode()
        for o, n in zip(self.f.old(1) + self.f.old(2), self.f.new(1) + self.f.new(2)):
            if o != n:
                expect = expect.replace(json.dumps(o, ensure_ascii=False), json.dumps(n, ensure_ascii=False))
        self.assertEqual(run.read_text(), expect)
        self.assertEqual(sum(1 for o, n in zip(self.f.old(1) + self.f.old(2), self.f.new(1) + self.f.new(2)) if o != n), 4 - 1,
                         "3 of the fixture's 4 damaged titles reach a solution (one step has no body)")
        # originals kept and a ledger written
        ledgers = list((self.f.root / "work" / "g10-math" / "backups").glob("step-title-repair-*/ledger.json"))
        self.assertEqual(len(ledgers), 1)
        entry = json.loads(ledgers[0].read_text())["files"]
        self.assertEqual({e["class"] for e in entry}, {"run", "bundle"})
        for e in entry:
            self.assertEqual(Path(e["backup"]).read_bytes(), before[self.f.root / e["file"]])

    def test_second_run_finds_nothing_and_writes_nothing(self):
        run = self.f.write("runs/g10-math/lessons/wf_x.json", self.f.run_doc(wrapper=True))
        self.assertEqual(self.f.run("apply")[0], 0)
        after = run.read_bytes()
        rc, out, _ = self.f.run("apply")
        self.assertEqual(rc, 0)
        self.assertIn("nothing to rewrite", out)
        self.assertEqual(run.read_bytes(), after)
        self.assertEqual(self.f.run("plan")[0], 0)

    def test_a_partly_repaired_list_is_finished_not_refused(self):
        lst = self.f.old(2)
        lst[0] = self.f.new(2)[0]                                                        # one step repaired already
        run = self.f.write("runs/g10-math/lesson/g10m8s2-1.json",
                           self.f.run_doc(items=[{"ref": "WE2", "kind": "worked_example", "solution": lst}]))
        self.assertEqual(self.f.run("apply")[0], 0)
        self.assertEqual(json.loads(run.read_text())["items"][0]["solution"], self.f.new(2))

    def test_a_wrapped_saved_run_with_several_lessons_is_handled_and_other_chapters_left_alone(self):
        d = self.f.run_doc(wrapper=True)
        other = {"lesson": "g10m9s1-1", "items": [{"ref": "WE1", "kind": "worked_example", "solution": ["Solve for: x"]}]}
        d["result"]["lessons"].append(other)
        run = self.f.write("runs/g10-math/lessons/wf_y.json", d)
        self.assertEqual(self.f.run("apply", "--chapters", "8")[0], 0)
        got = json.loads(run.read_text())["result"]["lessons"]
        self.assertEqual(got[0]["items"][0]["solution"], self.f.new(1))
        self.assertEqual(got[1], other, "chapter 9 was not selected, and has no worked example 1 in these blocks anyway")

    def test_a_claim_quote_that_is_exactly_a_damaged_title_is_rewritten_other_quotes_are_not(self):
        claims = [{"lo": "lo:g10m8s2-1-1", "anchor": "WE2", "quote": "Divide both sides by:", "text": "t"},
                  {"lo": "lo:g10m8s2-1-1", "anchor": "WE2", "quote": "So z = 4", "text": "t"},
                  {"lo": "lo:g10m8s2-1-1", "anchor": "WE1", "quote": "Substitute into", "text": "t"}]
        run = self.f.write("runs/g10-math/lesson/g10m8s2-1.json", self.f.run_doc(claims=claims))
        self.assertEqual(self.f.run("apply")[0], 0)
        q = [c["quote"] for c in json.loads(run.read_text())["claims"]]
        self.assertEqual(q[0], "Divide both sides by $-8$:")
        self.assertEqual(q[1], "So z = 4")
        self.assertEqual(q[2], "Substitute $x$ into $y = 2x$", "the title, without its colon, as the quote had none")


class Refusals(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.f = Fixture(Path(self._tmp.name))

    def tearDown(self):
        self._tmp.cleanup()

    def assert_refused(self, rel, doc, needle, **kw):
        p = self.f.write(rel, doc, **kw)
        before = p.read_bytes()
        rc, out, err = self.f.run("plan")
        self.assertEqual(rc, 1, out + err)
        self.assertIn(needle, out)
        rc, out, err = self.f.run("apply")
        self.assertEqual(rc, 1, out + err)
        self.assertEqual(p.read_bytes(), before, "a refused item is never written")
        return p

    def test_a_string_that_is_neither_old_nor_new_is_refused(self):
        lst = self.f.old(1)
        lst[1] = "Substitute into the rule: y = 2x + 1"                                  # a G2 fix or a hand edit
        self.assert_refused("runs/g10-math/lesson/g10m8s2-1.json", self.f.run_doc(
            items=[{"ref": "WE1", "kind": "worked_example", "solution": lst}]), "neither the old nor the repaired")

    def test_a_list_of_another_length_is_refused(self):
        self.assert_refused("runs/g10-math/lesson/g10m8s2-1.json", self.f.run_doc(
            items=[{"ref": "WE1", "kind": "worked_example", "solution": self.f.old(1)[:2]}]), "2 step(s)")

    def test_a_worked_example_the_blocks_do_not_have_is_refused(self):
        self.assert_refused("runs/g10-math/lesson/g10m8s2-1.json", self.f.run_doc(
            items=[{"ref": "WE9", "kind": "worked_example", "solution": ["Solve for: x"]}]), "no worked example 9")

    def test_a_worked_example_found_twice_in_the_blocks_is_refused(self):
        dup = copy.deepcopy(self.f.blocks[0])
        dup["id"] = "b00099"
        blocks = self.f.blocks + [dup]
        self.f.blocks_path.write_text("".join(json.dumps(b, ensure_ascii=False) + "\n" for b in blocks))
        self.assert_refused("runs/g10-math/lesson/g10m8s2-1.json", self.f.run_doc(), "more than once")

    def test_a_maths_image_s0b_has_not_accepted_is_refused_and_never_written_as_a_token(self):
        accepted = json.loads(self.f.maths_path.read_text())
        h = TOKEN.findall(self.f.blocks[0]["steps"][1]["title"])[0]
        del accepted["accepted"][h]
        self.f.maths_path.write_text(json.dumps(accepted))
        p = self.assert_refused("runs/g10-math/lesson/g10m8s2-1.json", self.f.run_doc(), "not accepted by S0b")
        self.assertNotIn("⟦", p.read_text())

    def test_blocks_from_before_the_extractor_fix_stop_the_tool(self):
        old = copy.deepcopy(self.f.blocks)
        for b in old:
            for s in b["steps"]:
                s.pop("title_maths")
        self.f.blocks_path.write_text("".join(json.dumps(b, ensure_ascii=False) + "\n" for b in old))
        self.f.write("runs/g10-math/lesson/g10m8s2-1.json", self.f.run_doc())
        rc, out, err = self.f.run("plan")
        self.assertEqual(rc, 2, out + err)
        self.assertIn("predates the extractor fix", err)

    def test_a_file_whose_formatting_cannot_be_reproduced_is_refused_not_reformatted(self):
        p = self.f.root / "runs/g10-math/lesson/g10m8s2-1.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(self.f.run_doc(), ensure_ascii=False, indent=1).replace('"lesson"', '"lesson" ', 1) + "\n")
        before = p.read_bytes()
        rc, out, err = self.f.run("apply")
        self.assertEqual(rc, 1, out + err)
        self.assertIn("formatting cannot be reproduced", out)
        self.assertEqual(p.read_bytes(), before)

    def test_skip_refused_repairs_the_rest_and_lists_the_refusal(self):
        good = self.f.write("runs/g10-math/lesson/g10m8s2-1.json", self.f.run_doc())
        lst = self.f.old(1)
        lst[0] = "edited"
        bad = self.f.write("runs/g10-math/lessons/wf_bad.json", self.f.run_doc(
            items=[{"ref": "WE1", "kind": "worked_example", "solution": lst}], wrapper=True))
        before_bad = bad.read_bytes()
        self.assertEqual(self.f.run("apply")[0], 1)
        self.assertEqual(good.read_text(), dump(self.f.run_doc()), "refusals stop apply before any write")
        rc, out, _ = self.f.run("apply", "--skip-refused")
        self.assertEqual(rc, 1, "the refusal is still reported")
        self.assertEqual([i["solution"] for i in json.loads(good.read_text())["items"]],
                         [self.f.new(1), self.f.new(2), self.f.new(3)])
        self.assertEqual(bad.read_bytes(), before_bad)

    def test_a_file_that_changed_since_it_was_planned_is_not_overwritten(self):
        p = self.f.write("runs/g10-math/lesson/g10m8s2-1.json", self.f.run_doc())
        book = book_config.load_book("g10-math")
        maths = ao.load_maths(self.f.maths_path)
        index = R.build_index(ao.load_blocks(self.f.blocks_path), maths)
        fp = R.plan_file(p, self.f.root, "run", index, None, "g10m", None)
        self.assertGreater(fp.changes(), 0)
        concurrent = json.loads(p.read_text())
        concurrent["note"] = "another agent wrote this"
        p.write_text(dump(concurrent))
        mine = p.read_bytes()
        with self.assertRaises(R.RepairError):
            R.apply_plan(fp, self.f.root, "g10m", index, None, None, self.f.root / "bk")
        self.assertEqual(p.read_bytes(), mine)


class AssemblyForm(unittest.TestCase):
    """A bundle's strings are the assembly's own transform of the packet's: decision 15's notation, and S0b's glued
    LaTeX commands re-spaced with the app's KaTeX (assemble_lesson_bundle)."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def fixture_with(self, latex_title, latex_text, other_step=None):
        f = Fixture(self.tmp)
        M = f.M
        steps = [step(f"Prove {M(latex_title)} now", M(latex_text))]
        if other_step:
            steps.append(step("Second", M(other_step)))
        f.blocks = [we_block(1, 8, 1, steps)]
        f.blocks_path.write_text(json.dumps(f.blocks[0], ensure_ascii=False) + "\n")
        f.maths = dict(M.accepted)
        f.maths_path.write_text(json.dumps({"accepted": {h: {"latex": l} for h, l in M.accepted.items()}}))
        f.index = R.build_index(f.blocks, f.maths)
        return f

    def test_a_semicolon_pair_in_a_title_becomes_a_comma_pair_as_the_assembly_writes_it(self):
        f = self.fixture_with("A\\left(x_1; y_1\\right)", "d = 5")
        asm = R.Assembler()
        bundle = {"questions": [{"id": "q:g10m8s2-1-1:we01", "solution": [asm(s, "respaced") for s in f.old(1)]}]}
        p = f.write("seed/g10-math/g10m-c08.json", bundle, indent=2)
        self.assertEqual(f.run("apply", "--path", str(p))[0], 0)
        got = json.loads(p.read_text())["questions"][0]["solution"][0]
        self.assertTrue(got.startswith("Prove $A\\left(x_1, y_1\\right)$ now: "), got)
        self.assertEqual(got, asm(f.new(1)[0], "respaced"))

    @unittest.skipUnless(NODE_KATEX, "node and the app's KaTeX are needed for the re-spacing")
    def test_a_glued_latex_command_in_a_title_is_respaced_like_the_bundle_assembly(self):
        f = self.fixture_with("\\triangleABC\\equiv\\triangleCDA", "x = 1")
        asm = R.Assembler()
        asm.prime(asm.alb.normalise(s)[0] for s in f.old(1) + f.new(1))
        old = [asm(s, "respaced") for s in f.old(1)]
        p = f.write("seed/g10-math/g10m-c08.json", {"questions": [{"id": "q:g10m8s2-1-1:we01", "solution": old}]}, indent=2)
        self.assertEqual(f.run("apply", "--path", str(p))[0], 0)
        got = json.loads(p.read_text())["questions"][0]["solution"][0]
        self.assertIn("\\triangle ABC\\equiv\\triangle CDA", got, "KaTeX does not know \\triangleABC; the assembly splits it")
        # exactly what the assembly itself writes for the whole string
        whole = asm.alb.respace_tree(asm.alb.normalise(f.new(1)[0])[0], asm.alb.Report())
        self.assertEqual(got, whole)

    @unittest.skipUnless(NODE_KATEX, "node and the app's KaTeX are needed for the re-spacing")
    def test_a_bundle_assembled_without_respacing_is_recognised_from_the_strings_that_tell_the_forms_apart(self):
        f = self.fixture_with("\\triangleABC", "x = 1", other_step="\\triangleDEF\\equiv\\triangleGHI")
        asm = R.Assembler()
        asm.prime(asm.alb.normalise(s)[0] for s in f.old(1) + f.new(1))
        # the second step holds a glued command, so a re-spaced bundle would have split it: this one did not
        old = [asm(s, "normalised") for s in f.old(1)]
        self.assertIn("\\triangleDEF", old[1])
        p = f.write("seed/g10-math/g10m-c08.json", {"questions": [{"id": "q:g10m8s2-1-1:we01", "solution": old}]}, indent=2)
        self.assertEqual(f.run("apply", "--path", str(p))[0], 0)
        got = json.loads(p.read_text())["questions"][0]["solution"]
        self.assertEqual(got, [asm(s, "normalised") for s in f.new(1)])
        self.assertIn("\\triangleABC", got[0], "the form the file was assembled in is kept")


class DatabaseScan(unittest.TestCase):
    """The DB scan reads rows the way a bundle holds them: judge() on a solution list, one form, never ambiguous
    for the re-spaced default."""

    def test_a_damaged_and_a_repaired_list_are_told_apart_under_the_assembly_form(self):
        with tempfile.TemporaryDirectory() as t:
            f = Fixture(Path(t))
            asm = R.Assembler()
            we = f.index.by_key[(8, 1)]
            old = [asm(s, "respaced") for s in we.lines("old")]
            new = [asm(s, "respaced") for s in we.lines("new")]
            self.assertEqual(R.judge(old, we, asm).kind, "repair")
            self.assertEqual(R.judge(new, we, asm).kind, "clean")
            self.assertEqual(R.judge(old[:-1], we, asm).kind, "refused")


if __name__ == "__main__":
    unittest.main()
