"""Args in the script (embed_workflow.py): a generated copy of a runbook workflow with its args embedded.

    uv run --with pytest python -m pytest -q tests/test_embed_workflow.py

Decision of 2026-09-26 (Q1, option A): S2–S4 and S5 final, whose args are too big to type even by
reference, run as a generated copy of their runbook script, started with NO args. What is proved, on
the lesson conveyor's fixture chapter and the S5 fixtures, through tests/workflow_stub.mjs (no model):
  * the copy is the runbook script with one line replaced: `export const meta` first and unchanged,
    every prompt identical, the same return value plus `embedded` {source, source_sha256,
    args_sha256, generated_sha256}, which say which script ran;
  * `generated_sha256` is the copy's own hash (with that value zeroed); `verify` catches an edited
    copy and a runbook script that changed since the copy was made;
  * a copy refuses args (it never mixes two inputs), and a script that does not echo ARGS.embedded
    cannot be copied (S1's objectives.workflow.js is not, and is not touched);
  * the downstream readers take a copy's run as they take the runbook script's: lesson-runs for
    S2–S4, assemble_misconceptions.py for S5 final (by reference and embedded together);
  * the `embed_workflow.py lesson-args` and `assemble_misconceptions.py --s5-args … --embed` commands.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
EX = HERE.parent
for p in (str(EX), str(HERE)):
    if p not in sys.path:
        sys.path.insert(0, p)

import embed_workflow as E  # noqa: E402

NODE = shutil.which("node")
LESSON_WF = EX / "runbook" / "lesson.workflow.js"
S5_WF = EX / "runbook" / "misconceptions.workflow.js"


def strip(result: dict) -> dict:
    r = dict(result)
    r.pop("embedded", None)
    return r


@unittest.skipUnless(NODE, "node is needed to run workflow scripts through the stub runtime")
class EmbeddedLessonConveyor(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import _objectives_fixture as fx
        import assemble_objectives as ao
        from test_lesson_workflow import LessonConveyor
        cls.fx, cls.ao = fx, ao
        LessonConveyor.setUpClass.__func__(cls)            # the fixture chapter, S1 run and G1 passed
        cls.responses_ = LessonConveyor.responses(cls)
        cls.inline = fx.run_workflow(LESSON_WF, cls.args, cls.responses_, cls.tmp)
        cls.copy = cls.tmp / "embedded" / "lesson.fixture.workflow.js"
        cls.info = E.write(LESSON_WF, cls.args, cls.copy)
        cls.embedded = fx.run_workflow(cls.copy, {}, cls.responses_, cls.tmp)

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def test_the_copy_runs_the_runbook_script_unchanged(self):
        self.assertTrue(self.inline["ok"], self.inline["error"])
        self.assertTrue(self.embedded["ok"], self.embedded["error"])
        self.assertEqual(self.embedded["meta"], self.inline["meta"])
        text = self.copy.read_text()
        self.assertTrue(text.startswith(LESSON_WF.read_text().split("\n// ---")[0]), "meta first, unchanged")
        self.assertEqual([(c["label"], c["prompt"], c["model"]) for c in self.inline["calls"]],
                         [(c["label"], c["prompt"], c["model"]) for c in self.embedded["calls"]])
        self.assertEqual(strip(self.embedded["result"]), self.inline["result"])
        self.assertNotIn("embedded", self.inline["result"], "the runbook script's own run is as before")

    def test_the_run_says_which_script_ran(self):
        emb = self.embedded["result"]["embedded"]
        self.assertEqual(emb["source"], "runbook/lesson.workflow.js")
        self.assertEqual(emb["source_sha256"], hashlib.sha256(LESSON_WF.read_bytes()).hexdigest())
        self.assertEqual(emb["generated_sha256"], self.info["generated_sha256"])
        self.assertNotEqual(emb["generated_sha256"], hashlib.sha256(self.copy.read_bytes()).hexdigest(),
                            "a file cannot hold its own hash: the field is zeroed for it")
        zeroed = self.copy.read_text().replace(emb["generated_sha256"], E.ZERO, 1)
        self.assertEqual(hashlib.sha256(zeroed.encode()).hexdigest(), emb["generated_sha256"])
        self.assertEqual(E.verify(self.copy), [])
        self.assertEqual(E.read_args(self.copy), self.args)
        self.assertEqual(json.loads(self.copy.with_suffix(".json").read_text())["generated_sha256"], emb["generated_sha256"])

    def test_verify_catches_an_edited_copy_and_a_changed_source(self):
        bad = self.tmp / "edited.workflow.js"
        bad.write_text(self.copy.read_text().replace("Solve each problem below yourself", "Solve each problem below", 1))
        self.assertTrue(any("edited" in p for p in E.verify(bad)))
        src = self.tmp / "runbook-copy.workflow.js"
        src.write_text(LESSON_WF.read_text())
        mine = self.tmp / "mine.workflow.js"
        E.write(src, self.args, mine)
        self.assertEqual(E.verify(mine, src), [])
        src.write_text(src.read_text() + "\n// a later edit\n")
        self.assertTrue(any("has changed" in p for p in E.verify(mine, src)))

    def test_a_copy_refuses_args_and_a_script_that_cannot_say_it_ran_is_refused(self):
        rep = self.fx.run_workflow(self.copy, self.args, self.responses_, self.tmp)
        self.assertFalse(rep["ok"])
        self.assertIn("carries its own args", rep["error"])
        self.assertEqual(rep["calls"], [])
        with self.assertRaises(E.EmbedError):         # S1 does not echo ARGS.embedded: never copied
            E.generate(EX / "runbook" / "objectives.workflow.js", {"stage": "S1"})
        with self.assertRaises(E.EmbedError):
            E.generate(LESSON_WF, dict(self.args, embedded={"x": 1}))

    def test_lesson_runs_takes_the_copys_run_as_the_runbook_scripts(self):
        """The same per-lesson files, and each records which script ran (backlog 67)."""
        a, b = self.ao.lesson_runs(self.inline["result"]), self.ao.lesson_runs(self.embedded["result"])
        self.assertEqual(set(a), set(b))
        for slug in a:
            emb = b[slug]["source_run"].pop("embedded")
            self.assertEqual(emb, self.embedded["result"]["embedded"])
            self.assertNotIn("embedded", a[slug]["source_run"])
        self.assertEqual(a, b)

    def test_the_lesson_args_command(self):
        out = self.tmp / "cli" / "lesson.workflow.js"
        code = E.main(["lesson-args", "g10-math", "--book-config", str(self.f["book"]), "--blocks", str(self.f["blocks"]),
                       "--manifest", str(self.f["manifest"]), "--maths", str(self.f["maths"]),
                       "--objectives-dir", str(self.f["objectives"]), "--lessons", "g10m8s2-1,g10m8s3-1,g10m8s3-2",
                       "--out", str(out)])
        self.assertEqual(code, 0)
        self.assertEqual(E.read_args(out), self.args)
        self.assertEqual(E.main(["verify", str(out)]), 0)


@unittest.skipUnless(NODE, "node is needed to run workflow scripts through the stub runtime")
class EmbeddedS5Final(unittest.TestCase):
    def test_by_reference_and_embedded_together(self):
        import assemble_misconceptions as am
        import test_assemble_misconceptions as T
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            draft = T.run_stub(T.WORKFLOW, T.base_args("draft"), T.fixture("s5-draft-responses.json"))
            args, resp = T.final_args(draft["result"])
            compact = am.s5_args_by_ref(args, d / "packets" / "s5-final")
            byref = T.run_stub(T.WORKFLOW, compact, resp)
            copy = d / "embedded" / "misconceptions.s5-final.workflow.js"
            E.write(S5_WF, compact, copy)
            emb = T.run_stub(copy, {}, resp)
            self.assertTrue(byref["ok"] and emb["ok"], (byref["error"], emb["error"]))
            self.assertEqual([c["prompt"] for c in byref["calls"]], [c["prompt"] for c in emb["calls"]])
            self.assertEqual(strip(emb["result"]), byref["result"])
            self.assertEqual(emb["result"]["embedded"]["source"], "runbook/misconceptions.workflow.js")
            a, b = d / "r1" / "final.json", d / "r2" / "final.json"
            for p, r in ((a, byref), (b, emb)):
                p.parent.mkdir()
                p.write_text(json.dumps(r["result"]))
            ca, cb = am.assemble([a], str(T.BOOK)), am.assemble([b], str(T.BOOK))
            self.assertEqual(ca[0]["misconceptions"], cb[0]["misconceptions"])
            self.assertEqual(cb[3], [])

    def test_the_s5_args_command_writes_the_copy(self):
        """`assemble_misconceptions.py --s5-args … --stage final --by-ref DIR --embed FILE`, from the line's
        own bundles and lesson runs (tests/fixtures/g10-math)."""
        import assemble_lesson_bundle as alb
        import assemble_misconceptions as am
        import book_config
        fix = HERE / "fixtures" / "g10-math"
        book = book_config.load_book("g10-math")
        bundles, _ = alb.assemble(book, fix / "manifest.json", fix / "objectives", fix / "runs" / "lesson")
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            seed = d / "seed"
            seed.mkdir()
            for name, b in bundles.items():
                (seed / f"{Path(name).name}.json").write_text(json.dumps(b))
            draft = d / "draft.json"
            draft.write_text(json.dumps({"book": "g10-math", "stage": "draft", "records": []}))
            out, copy = d / "s5-final.json", d / "embedded" / "misconceptions.s5-final.workflow.js"
            code = am.main(["--s5-args", str(out), "--book", "g10-math", "--stage", "final", "--seed-dir", str(seed),
                            "--lesson-runs", str(fix / "runs" / "lesson"), "--draft", str(draft),
                            "--by-ref", str(d / "packets"), "--embed", str(copy)])
            self.assertEqual(code, 0)
            args = json.loads(out.read_text())
            self.assertIn("by_ref", args)
            self.assertEqual(E.read_args(copy), args)
            self.assertEqual(E.verify(copy), [])
            self.assertEqual(E.embedded_info(copy.read_text())["source"], "runbook/misconceptions.workflow.js")

if __name__ == "__main__":
    unittest.main()
