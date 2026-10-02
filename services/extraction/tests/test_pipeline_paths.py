"""B20 (T349): merge_final.py and assemble_fullbook.py take their paths as arguments.

    uv run --with pytest python -m pytest -q tests/test_pipeline_paths.py

The Social Studies run's inputs were never committed, so the book cannot be rebuilt
byte for byte; what is proven here is that no code path reads or writes /tmp, that the
merge keeps its original rules, and that the lesson order now comes from the book config.
"""

from __future__ import annotations

import ast
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from _scratchdb import EX
import book_config
import merge_final


def lesson(lid: str, claims: list[str], questions: list[list[str]]) -> dict:
    return {"lessonId": lid, "subtopics": [{
        "claims": {"claims": [{"claim_ar": c} for c in claims]},
        "questions": {"questions": [{"id": f"{lid}:{i}", "solution": [{"claim_ar": c} for c in sol]}
                                    for i, sol in enumerate(questions)]}}]}


class MergeTest(unittest.TestCase):
    ORDER = [Path(p).stem for p in book_config.load_book("prep3-social-ar").content_files]

    def base(self) -> dict:
        return {"lessons": [lesson(l, ["a", "b"], [["a"], ["a", "b"], []]) for l in self.ORDER]}

    def test_rerun_replaces_and_audit_drops_only_what_rests_on_bad_claims(self):
        rerun = {"lessons": [lesson("soc2-1", ["fresh"], [["fresh"]])]}
        with contextlib.redirect_stdout(io.StringIO()):
            out, dc, dq = merge_final.merge(self.base(), rerun, {"soc1-1": [{"claim_ar": "a"}]},
                                            self.ORDER)
        self.assertEqual([l["lessonId"] for l in out["lessons"]], self.ORDER)
        s11 = out["lessons"][0]["subtopics"][0]
        self.assertEqual([c["claim_ar"] for c in s11["claims"]["claims"]], ["b"])
        # q0 rests only on "a": dropped; q1 also on "b": kept; q2 cites nothing: kept
        self.assertEqual([q["id"] for q in s11["questions"]["questions"]], ["soc1-1:1", "soc1-1:2"])
        self.assertEqual((dc, dq), (1, 1))
        self.assertEqual(out["lessons"][3]["subtopics"][0]["claims"]["claims"], [{"claim_ar": "fresh"}])

    def test_a_missing_lesson_refuses(self):
        base = self.base()
        base["lessons"].pop()
        with self.assertRaises(SystemExit):
            merge_final.merge(base, None, {}, self.ORDER)

    def test_the_cli_reads_and_writes_only_where_it_is_told(self):
        tmp = Path(tempfile.mkdtemp(prefix="merge_test_"))
        (tmp / "base.json").write_text(json.dumps(self.base()))
        (tmp / "audit.json").write_text("{}")
        import sys
        old = sys.argv
        sys.argv = ["merge_final.py", "--base", str(tmp / "base.json"), "--audit",
                    str(tmp / "audit.json"), "--out", str(tmp / "out" / "final.json")]
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(merge_final.main(), 0)
        finally:
            sys.argv = old
        self.assertEqual(len(json.loads((tmp / "out" / "final.json").read_text())["lessons"]), 14)


class NoTmpTest(unittest.TestCase):
    def test_no_code_path_names_tmp(self):
        for name in ("merge_final.py", "assemble_fullbook.py"):
            tree = ast.parse((EX / name).read_text())
            docstrings = {id(n.body[0].value) for n in ast.walk(tree)
                          if isinstance(n, (ast.Module, ast.FunctionDef)) and n.body
                          and isinstance(n.body[0], ast.Expr)
                          and isinstance(n.body[0].value, ast.Constant)}
            literals = [n.value for n in ast.walk(tree) if isinstance(n, ast.Constant)
                        and isinstance(n.value, str) and id(n) not in docstrings]
            self.assertEqual([s for s in literals if "/tmp" in s], [], name)


if __name__ == "__main__":
    unittest.main()
