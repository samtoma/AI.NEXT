"""The no-spend dry run of the whole line on Chapter 8 of the Grade 10 book (dryrun_chapter.py).

    AINEXT_TEST_PG="host=127.0.0.1 port=5432" uv run --with pytest python -m pytest -q tests/test_dryrun_chapter.py

It runs the line twice — every workflow's args inline, then by reference (packet_ref.py, the
default; S2–S4 and S5 final as generated copies with their args embedded, embed_workflow.py) — and
checks the two agree prompt for prompt and that every typed args fits the 15 KB bound.
It runs every stage's real command and every workflow through the stub runtime, with the
deterministic stub responder (dryrun/responder.mjs) — no model is called — and proves that each
stage hands valid input to the next, that the chapter loads into a scratch database (dropped
afterwards), that the drift guard stays GREEN for every National course, and that the coverage
audit runs over the result. It needs the gitignored sources' adapter outputs (work/g10-math/),
node and a Postgres server, and is skipped without them.
"""

from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

from _scratchdb import SERVER, skip_without_db
import book_config
import dryrun_chapter

BOOK = book_config.load_book("g10-math")


@skip_without_db()
@unittest.skipUnless(shutil.which("node") and (BOOK.work_dir() / "adapter-summary.json").exists()
                     and (BOOK.work_dir() / "equations").exists(),
                     "needs node and the source adapter's outputs (uv run source_adapter.py g10-math)")
class ChapterEightDryRun(unittest.TestCase):
    def run_line(self, mode: str) -> dict:
        code = dryrun_chapter.main(["--book", "g10-math", "--chapter", "8", "--pg", SERVER, "--mode", mode])
        t = json.loads((BOOK.work_dir() / "dryrun" / "ch08" / "transcript.json").read_text())
        self.assertEqual((code, t["error"], t["mode"]), (0, None, mode))
        return t

    def test_every_stage_hands_valid_input_to_the_next_in_both_modes(self):
        """Inline (the whole packet in the args), then by reference (the default: every stage with a
        by-ref builder runs that way). Both run end to end, and they reach the same outcomes."""
        real = BOOK.work_dir()
        watched = [p for p in [real / f for f in ("blocks.jsonl", "adapter-summary.json", "equations.json", "figures.json",
                                                   "page_map.json", "epub_index.json", "edition-check.json", "pdf_scan.json",
                                                   "maths/recovered.json", "maths/vision-queue.json")] if p.exists()]
        before = {p: p.stat().st_mtime_ns for p in watched}
        inline = self.run_line("inline")
        self.check_line(inline)
        self.assertGreater(inline["args_bytes"]["objectives"], 15_000)
        stub = BOOK.work_dir() / "dryrun" / "ch08" / "stub"
        with tempfile.TemporaryDirectory() as keep:
            shutil.copytree(stub, Path(keep) / "stub")
            t = self.run_line("by-ref")
            self.check_line(t)
            self.same_prompts(Path(keep) / "stub", stub)
        # backlog 67: neither mode rewrote the book's real work directory (S0a ran into a scratch copy)
        self.assertEqual({p: p.stat().st_mtime_ns for p in watched}, before, "the dry run wrote the real work dir")
        # the same stub answers give the same line: the counts every stage reports agree
        for stage, keys in (("S1", ("objectives", "links_kept", "items_mapped", "status")),
                            ("S5 draft", ("entries",)), ("S5 final", ("entries", "dropped", "stripped")),
                            ("S6", ("family_specs", "infeasible")), ("S7", ("templates", "gaps")),
                            ("S8", ("status", "summary", "checks"))):
            a = {s["stage"]: s for s in inline["stages"]}[stage]["counts"]
            b = {s["stage"]: s for s in t["stages"]}[stage]["counts"]
            self.assertEqual({k: a.get(k) for k in keys}, {k: b.get(k) for k in keys}, stage)
        # the typed-args bound (packet_ref.COMPACT_LIMIT): EVERY workflow's typed args fit it. S2–S4 and
        # S5 final run as generated copies with their args embedded (embed_workflow.py, decision of
        # 2026-09-26): their typed args are `{}`, and each copy verifies against its runbook script.
        import embed_workflow
        import packet_ref
        over = {k for k, v in t["args_bytes"].items() if v > packet_ref.COMPACT_LIMIT}
        self.assertEqual(over, set(), t["args_bytes"])
        for k in ("maths-AB", "objectives", "s5-draft", "s6-author", "s7-author", "s7-verify", "lessons", "s5-final"):
            self.assertIn(k, t["args_bytes"])
        self.assertTrue(any(k.startswith("s6-grade") for k in t["args_bytes"]))
        self.assertEqual(set(t["script_bytes"]), {"lessons", "s5-final"})
        emb = BOOK.work_dir() / "dryrun" / "ch08" / "packets" / "embedded"
        for copy, source in (("lesson.ch08.workflow.js", "runbook/lesson.workflow.js"),
                             ("misconceptions.s5-final.workflow.js", "runbook/misconceptions.workflow.js")):
            self.assertEqual(embed_workflow.verify(emb / copy), [])
            self.assertEqual(embed_workflow.embedded_info((emb / copy).read_text())["source"], source)
        runs = BOOK.work_dir() / "dryrun" / "ch08" / "runs"
        for run in (runs / "lessons" / "dryrun.json", runs / "misconceptions" / "final-dryrun.json"):
            self.assertIn("generated_sha256", json.loads(run.read_text())["embedded"], "the run says which script ran")

    def same_prompts(self, inline: Path, byref: Path) -> None:
        """SPLICE EQUALITY on the real chapter: every by-ref agent's prompt (stub/<name>.calls.json, the
        shards still named), with its shards spliced in and cut the way the inline prompt cuts them,
        is the inline agent's prompt, bar the file rule — and a generated copy's prompts are the
        runbook script's, word for word. S0b's list-file mode is older and names its images
        differently; it is excluded."""
        from test_packet_ref import same_as_inline
        compared = 0
        for f in sorted(inline.glob("*.calls.json")):
            if f.name.startswith("maths"):
                continue
            a = json.loads(f.read_text())
            b = json.loads((byref / f.name).read_text())
            self.assertEqual([x["label"] for x in a], [x["label"] for x in b], f.name)
            for xa, xb in zip(a, b):
                x, y = same_as_inline(xa["prompt"], xb["prompt"])
                self.assertEqual(x, y, f"{f.name} {xa['label']}")
                compared += 1
        self.assertGreater(compared, 200)

    def check_line(self, t: dict) -> None:
        self.assertTrue(t["stubbed"])
        stages = [s["stage"] for s in t["stages"]]
        for s in ("S0a", "S0", "S0b", "S1", "S2-S4,S8", "S9", "S10", "S11", "G2 apply", "S5 draft", "S6", "S7",
                  "S5 final", "S6/S7 out", "S8", "Drift"):
            self.assertIn(s, stages)
        by = {s["stage"]: s for s in t["stages"]}
        self.assertTrue(by["S0"]["counts"]["reproduces_committed_manifest"])
        self.assertEqual(by["S0b"]["counts"]["after_g0b"]["unresolved"], 0)
        self.assertEqual(by["S1"]["counts"]["status"], "approved")
        self.assertIn(by["S8"]["counts"]["status"], ("GREEN", "RED"), "the audit ran and said something")
        # answer 15 (b): the stub mappers place every AREA item nowhere, the stubbed G1 rules it outside
        # the chapter's objectives, and the audit excepts it by that named verdict and nothing else
        self.assertGreaterEqual(by["S1"]["counts"]["items_outside"], 1)
        self.assertTrue(by["S8"]["counts"]["checks"]["items_mapped_once"].startswith("excepted"))
        cov = json.loads((BOOK.work_dir() / "dryrun" / "ch08" / "coverage" / "g10-math.json").read_text())
        self.assertEqual(len(cov["g1_exceptions"]), by["S1"]["counts"]["items_outside"])
        self.assertTrue(all("gate G1 NOT passed" in e["signed_by"] for e in cov["g1_exceptions"]))
        self.assertTrue(all(p.startswith("GREEN") for p in by["Drift"]["counts"]["parity"]))
        self.assertTrue(by["Drift"]["counts"]["database_agrees"])
        self.assertGreater(t["meter"]["total_usd_estimate"], 0)
        # every stubbed human gate says it was not passed
        g1 = json.loads((BOOK.work_dir() / "dryrun" / "ch08" / "objectives" / "g10m8s2-1.json").read_text())["g1"]
        self.assertIn("NOT passed", g1["approved_by"])


if __name__ == "__main__":
    unittest.main()
