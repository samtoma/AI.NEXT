"""meter_run.py record refuses a run that has not finished (T347 review).

    uv run --with pytest python -m pytest -q tests/test_meter_guard.py

The ledger takes one line per run id. Metering a run mid-flight would record a partial
cost that a later `record` then refuses to replace.
"""

from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

import _scratchdb  # noqa: F401
import meter_run


class UnfinishedRunTest(unittest.TestCase):
    def record(self, status: str) -> tuple[int, Path]:
        tmp = Path(tempfile.mkdtemp(prefix="meter_guard_"))
        (tmp / "t").mkdir()
        (tmp / "t" / "agent-a1.jsonl").write_text(json.dumps(
            {"type": "assistant", "message": {"id": "m1", "model": "claude-sonnet-5",
                                              "usage": {"input_tokens": 10, "output_tokens": 5}}}))
        (tmp / "run.json").write_text(json.dumps({"runId": "wf_guard", "status": status,
                                                  "workflowProgress": []}))
        ledger = tmp / "cost.jsonl"
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            code = meter_run.main(["record", "--book", "prep3-social-ar", "--stage", "S2",
                                   "--run-record", str(tmp / "run.json"), "--transcripts",
                                   str(tmp / "t"), "--ledger", str(ledger)])
        return code, ledger

    def test_a_running_run_is_refused_and_nothing_is_written(self):
        code, ledger = self.record("running")
        self.assertEqual(code, 1)
        self.assertFalse(ledger.exists())

    def test_a_finished_run_is_recorded(self):
        code, ledger = self.record("completed")
        self.assertEqual(code, 0)
        self.assertEqual(len(ledger.read_text().splitlines()), 1)


if __name__ == "__main__":
    unittest.main()
