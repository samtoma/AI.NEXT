"""meter_run.py (B16, G8): the ingest cost ledger.

    uv run python -m unittest discover -s tests -p 'test_meter*' -v
"""

from __future__ import annotations

import io
import json
import contextlib
import tempfile
import unittest
from pathlib import Path

import _scratchdb  # noqa: F401
import book_config
import meter_run


def usage(inp, out, w5=0, w1=0, read=0):
    return {"input_tokens": inp, "output_tokens": out, "cache_read_input_tokens": read,
            "cache_creation_input_tokens": w5 + w1,
            "cache_creation": {"ephemeral_5m_input_tokens": w5, "ephemeral_1h_input_tokens": w1}}


def assistant(mid, model, u):
    return {"type": "assistant", "message": {"id": mid, "model": model, "usage": u,
                                             "content": [{"type": "text", "text": "x"}]}}


class MeterTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="meter_test_"))
        self.tdir = self.tmp / "wf_test-001"
        self.tdir.mkdir()
        lines = {
            # one call streamed as two blocks with the SAME message id: count once, final usage
            "a1": [assistant("m1", "claude-sonnet-5", usage(10, 5, w5=1000, read=2000)),
                   assistant("m1", "claude-sonnet-5", usage(10, 400, w5=1000, read=2000)),
                   assistant("m2", "claude-sonnet-5", usage(20, 100, w1=500))],
            # a dated model id resolves to its price entry
            "a2": [assistant("m3", "claude-haiku-4-5-20251001", usage(1000, 1000))],
            # an unknown model: tokens kept, dollars flagged
            "a3": [assistant("m4", "claude-mystery-9", usage(1, 1))],
        }
        for aid, recs in lines.items():
            (self.tdir / f"agent-{aid}.jsonl").write_text("\n".join(json.dumps(r) for r in recs))
        self.record = self.tmp / "wf_test-001.json"
        self.record.write_text(json.dumps({
            "runId": "wf_test-001", "workflowName": "rich-lesson", "status": "completed",
            "workflowProgress": [
                {"type": "workflow_agent", "agentId": "a1", "label": "segment:soc1-2", "phaseTitle": "Segment", "state": "done"},
                {"type": "workflow_agent", "agentId": "a2", "label": "prov:soc1-2:asia", "phaseTitle": "Verify", "state": "done"},
                {"type": "workflow_agent", "agentId": "a3", "label": "critic", "phaseTitle": "Coverage", "state": "done"},
                {"type": "workflow_agent", "agentId": "a4", "label": "lost:soc2-1", "phaseTitle": "Claims", "state": "done"},
            ]}))
        self.book = book_config.load_book("prep3-social-ar")

    def run_meter(self, already=None):
        return meter_run.meter(self.record, self.tdir, self.book, "S2", None, already or {})

    def test_prices_and_dedup(self):
        line = self.run_meter()
        a1 = next(a for a in line["agents"] if a["agent_id"] == "a1")["by_model"]["claude-sonnet-5"]
        self.assertEqual((a1["input"], a1["output"], a1["cache_write_5m"], a1["cache_write_1h"],
                          a1["cache_read"]), (30, 500, 1000, 500, 2000))
        want = (30 * 2 + 500 * 10 + 1000 * 2 * 1.25 + 500 * 2 * 2.0 + 2000 * 2 * 0.1) / 1e6
        self.assertAlmostEqual(a1["usd"], want, places=9)
        a2 = next(a for a in line["agents"] if a["agent_id"] == "a2")["by_model"]
        self.assertAlmostEqual(a2["claude-haiku-4-5-20251001"]["usd"], (1000 * 1 + 1000 * 5) / 1e6)

    def test_lessons_phases_and_honesty_flags(self):
        line = self.run_meter()
        # a4 has no transcript: it is attributed, but carries no tokens to roll up
        self.assertEqual(set(line["by_lesson"]), {"soc1-2", "(book)"})
        self.assertEqual(next(a for a in line["agents"] if a["agent_id"] == "a4")["lesson"], "soc2-1")
        self.assertEqual(line["unpriced_models"], ["claude-mystery-9"])
        self.assertEqual(line["missing_transcripts"], ["a4"])
        self.assertFalse(line["complete"])
        self.assertTrue(line["totals"]["unpriced"])

    def test_lesson_from_lo_label(self):
        math = book_config.load_book("prep3-math-en")
        self.assertEqual(meter_run.lesson_of("misc:lo:u1-1-1", math), "u1-1")
        self.assertEqual(meter_run.lesson_of("verify:geo2-3", math), "geo2-3")
        self.assertIsNone(meter_run.lesson_of("claims:asia", math))

    def test_ledger_is_append_once_and_resume_is_not_billed_twice(self):
        ledger = self.tmp / "cost.jsonl"
        args = lambda: meter_run.main(["record", "--book", "prep3-social-ar", "--stage", "S2",  # noqa: E731
                                       "--run-record", str(self.record), "--transcripts", str(self.tdir),
                                       "--ledger", str(ledger)])
        with contextlib.redirect_stdout(io.StringIO()):
            args()
            args()
        self.assertEqual(len(ledger.read_text().splitlines()), 1)
        line = self.run_meter(already={"a1": "wf_earlier"})
        self.assertEqual([s["agent_id"] for s in line["skipped_already_metered"]], ["a1"])

    def test_a_resume_under_the_same_run_id_meters_only_its_new_agents(self):
        """A resume keeps the run id. `--resumed` records a second line carrying only the agents
        the resume ran; every agent already in the ledger is skipped, so nothing is billed twice
        and nothing the resume spent is lost."""
        ledger = self.tmp / "cost-resume.jsonl"
        base = ["record", "--book", "prep3-social-ar", "--stage", "S2", "--run-record", str(self.record),
                "--transcripts", str(self.tdir), "--ledger", str(ledger)]
        with contextlib.redirect_stdout(io.StringIO()):
            meter_run.main(base)
        first = json.loads(ledger.read_text().splitlines()[0])
        # pretend the first record had only metered a1: the resume then ran the others
        first["agents"] = [a for a in first["agents"] if a["agent_id"] == "a1"]
        ledger.write_text(json.dumps(first) + "\n")
        with contextlib.redirect_stdout(io.StringIO()):
            meter_run.main(base + ["--resumed"])
        lines = [json.loads(l) for l in ledger.read_text().splitlines()]
        self.assertEqual(len(lines), 2)
        self.assertEqual(lines[1]["resume_of"], lines[0]["run_id"])
        self.assertNotIn("a1", [a["agent_id"] for a in lines[1]["agents"]])
        self.assertEqual([s["agent_id"] for s in lines[1]["skipped_already_metered"]], ["a1"])
        with contextlib.redirect_stdout(io.StringIO()):
            meter_run.main(base + ["--resumed"])          # a resume that ran nothing new records nothing
        self.assertEqual(len(ledger.read_text().splitlines()), 2)


if __name__ == "__main__":
    unittest.main()


class DryFormTest(unittest.TestCase):
    """The dry form: a stub run's transcripts carry prompts and answers but no usage. The meter
    estimates what it was sent as input and what it wrote as output, plus the per-call overhead
    the transcript does not show, and flags every such agent `estimated`."""

    def test_an_agent_without_usage_is_estimated_by_role_with_the_overhead(self):
        tmp = Path(tempfile.mkdtemp(prefix="meter_dry_"))
        tdir = tmp / "wf_dry"
        tdir.mkdir()
        (tdir / "agent-s1.jsonl").write_text("\n".join(json.dumps(r) for r in (
            {"type": "user", "message": {"role": "user", "content": "x" * 4000}},
            {"type": "assistant", "message": {"role": "assistant",
                                              "content": [{"type": "text", "text": "y" * 398}]}})))
        rec = tmp / "wf_dry.json"
        rec.write_text(json.dumps({"runId": "wf_dry", "workflowName": "objectives", "status": "completed",
                                   "workflowProgress": [{"type": "workflow_agent", "agentId": "s1",
                                                         "label": "S1:findA:g10m8s2-1", "phaseTitle": "S1 Find",
                                                         "model": "claude-sonnet-5", "state": "done"}]}))
        line = meter_run.meter(rec, tdir, book_config.load_book("g10-math"), "S1", None, {}, 15000)
        t = line["by_model"]["claude-sonnet-5"]
        self.assertEqual((t["input"], t["output"]), (1000 + 15000, 100))   # 400 chars of JSON text / 4
        self.assertEqual(line["estimated_agents"], ["s1"])
        self.assertEqual(list(line["by_lesson"]), ["g10m8s2-1"])
        self.assertAlmostEqual(line["totals"]["usd"], (16000 * 2 + 100 * 10) / 1e6)
